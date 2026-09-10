// Disparos, sequências (drip) e radar de outbound — as telas "Disparos" e
// "Outbound" inteiras.
//
// Três máquinas de contato que a API guarda como coleção crua e a TELA resume
// no navegador: o mapa `campaigns.sent` (leadId → {whatsapp,email}) só vira
// "12 enviados, 4 pendentes" dentro do React; a taxa de conversão do disparo
// (won/sent) é calculada no browser; a contagem por status do radar também.
// Nada disso existia fora da tela — então é aqui que vira relatório: totais
// somados, taxas com unidade, e o join lead↔campanha↔sequência já feito.
//
// A régua de atribuição das métricas é da API (routes.disparos.js /
// routes.sequences.js): conversão = activity de mudança de etapa nos 30 dias
// DEPOIS do envio/inscrição. Está declarada em `notes` de toda tool que a usa,
// porque sem isso o número parece causalidade e não é.

import { z } from "zod";
import { http } from "../core/http.js";
import { resolveProduct } from "../core/products.js";
import { resolvePeriod, periodInput } from "../core/period.js";
import { result } from "../core/envelope.js";
import { select, groupBy, round2, num } from "../core/shape.js";

const G_CAMP = "Disparos (campanhas)";
const G_SEQ = "Sequências (drip)";
const G_OUT = "Outbound (radar de contas)";

const UNITS = {
  taxa_avanco: "%", taxa_call: "%", taxa_ganho: "%", taxa_conversao: "%", taxa_optout: "%",
  disparos_taxa_ganho: "%", sequencias_taxa_ganho: "%",
  receita: "BRL", valor: "BRL",
  dias_sem_toque: "d", dias_esperando: "d", espera_dias: "d", duracao_dias: "d",
  espera_mais_antiga_dias: "d",
};

// Janela de atribuição do envio → conversão (ATTR_WINDOW na API).
const ATTR_DIAS = 30;

// Os 8 status de conta do Cold Calling 2.0, na ordem da tela Outbound.
const OUT_STATUS = [
  ["fria", "Fria · nenhuma atividade ainda"],
  ["prospectando", "Em prospecção · SDR contatando"],
  ["nutrir", "Nutrir · revisitar a cada 3 meses"],
  ["oportunidade", "Oportunidade ativa · virou lead"],
  ["encerrada", "Oport. encerrada · perdeu"],
  ["cliente", "Cliente da casa · nunca prospectar"],
  ["sem-perfil", "Sem perfil · fora do PIC"],
  ["duplicada", "Duplicada"],
];
const OUT_KEYS = OUT_STATUS.map(([k]) => k);
const OUT_LABEL = Object.fromEntries(OUT_STATUS);
// Fila de trabalho da tela: só o que o SDR deve olhar hoje.
const FILA = new Set(["fria", "prospectando", ""]);

// Ordem dos campos da importação em massa da tela (uma conta por linha, ";").
const IMPORT_COLS = ["name", "phone", "email", "instagram", "listings", "niche", "marketplace", "city", "site"];

// Kinds que a tela Disparos considera "público qualificado" (o default do
// segmento): venda ativa + em contato. Fora ficam novo, pós-venda e terminais.
const QUALIFICADOS = new Set(["qualificacao", "call", "proposta", "followup", "contato"]);
const TERMINAIS = new Set(["ganho", "perdido", "desqualificado"]);

const pct = (parte, todo) => (num(todo) > 0 ? round2((num(parte) / num(todo)) * 100) : null);
const dias = (iso) => {
  const t = Date.parse(iso || "");
  return Number.isFinite(t) ? Math.max(0, Math.floor((Date.now() - t) / 86_400_000)) : null;
};
const corta = (s, n = 120) => {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};
const nowIso = () => new Date().toISOString();

// Heurística de kind por nome — espelho do guessKind da API (stages.js), pra
// funil antigo sem `kind` não deixar o público padrão vazio.
function guessKind(stage, i = -1) {
  const n = String(stage || "").toLowerCase();
  if (/ganho|won|fechad/.test(n)) return "ganho";
  if (/perdid|lost|sem resposta/.test(n)) return "perdido";
  if (/desqualific/.test(n)) return "desqualificado";
  if (/integra/.test(n)) return "integracao";
  if (/acompanhament|p[óo]s.?venda|sucesso/.test(n)) return "posvenda";
  if (/follow/.test(n)) return "followup";
  if (/proposta|proposal|negocia/.test(n)) return "proposta";
  if (/call|reuni|demo/.test(n)) return "call";
  if (/qualific/.test(n)) return "qualificacao";
  if (/contato|contact/.test(n)) return "contato";
  if (/novo|inbox|new|entrada/.test(n)) return "novo";
  return i === 0 ? "novo" : "outro";
}
const funnelOf = (product) => (Array.isArray(product?.funnel) ? product.funnel : []);
function kindOf(product, stage) {
  const f = funnelOf(product);
  const i = f.findIndex((x) => x?.stage === stage);
  if (i >= 0 && f[i].kind) return f[i].kind;
  return guessKind(stage, i);
}
const stagesQualificadas = (product) => funnelOf(product).map((f) => f?.stage).filter(Boolean)
  .filter((s) => QUALIFICADOS.has(kindOf(product, s)));

// A API não filtra /api/leads por saas (listFilter só cobre `priority`), então
// o recorte por produto é feito aqui — vale pra todas as tools deste módulo.
async function leadsDo(saas) {
  const all = await http.get("/api/leads");
  return (all || []).filter((l) => l.saas === saas);
}
const porId = (rows) => new Map((rows || []).map((r) => [r.id, r]));

// Mesma normalização do waDigits do SPA: número local BR ganha DDI.
const temWhats = (l) => {
  const d = String(l?.phone || "").replace(/\D/g, "");
  return d.length >= 10 && !l?.whatsappInvalid && !l?.whatsappOptOut;
};
const temEmail = (l) => !!l?.email && !l?.emailOptOut;

// Tokens da mensagem — espelho do leadTokens/interpolate (disparos-util.js),
// pra a prévia daqui sair IGUAL ao que o lead recebe.
const tokensDo = (lead) => ({
  nome: String(lead?.name || "").trim().split(/\s+/)[0] || "",
  empresa: lead?.company || "",
  nicho: lead?.niche || "",
  contas: lead?.accounts || "",
  anuncios: lead?.listings || "",
});
const interpola = (texto, toks) =>
  String(texto || "").replace(/\{\{(\w+)\}\}/g, (_, k) => (toks && toks[k] != null ? toks[k] : `{{${k}}}`));
const tokensUsados = (...textos) => [...new Set(textos.join(" ").match(/\{\{(\w+)\}\}/g) || [])].join(" ");

// Resumo do mapa `sent` de uma campanha (leadId → {whatsapp, email}).
function progressoDe(camp) {
  const sent = camp?.sent || {};
  const ids = Object.keys(sent);
  const carimbos = ids.flatMap((id) => [sent[id]?.whatsapp, sent[id]?.email]).filter(Boolean).sort();
  return {
    leads: ids.length,
    whatsapp: ids.filter((id) => sent[id]?.whatsapp).length,
    email: ids.filter((id) => sent[id]?.email).length,
    primeiro: carimbos[0] || null,
    ultimo: carimbos[carimbos.length - 1] || null,
  };
}

// `steps` pode vir null num registro antigo — Array.isArray, não default de
// parâmetro, que só cobre undefined.
const passosResumo = (steps) => {
  const list = Array.isArray(steps) ? steps : [];
  return {
    passos: list.length,
    duracao_dias: list.reduce((a, s) => a + num(s?.delayDays), 0),
    canais: [...new Set(list.map((s) => s?.channel).filter(Boolean))].join("+"),
  };
};
// exitOn da API: won/booked/optOut nascem LIGADOS, stageLeft nasce desligado.
const saidasDe = (ex = {}) => [
  ex.won !== false && "fechou",
  ex.booked !== false && "marcou call",
  ex.optOut !== false && "descadastrou",
  ex.stageLeft === true && "saiu da etapa",
].filter(Boolean).join(", ");

const COLS = {
  campanhas: ["id", "nome", "status", "canais", "etapas", "enviados", "whatsapp", "email", "primeiro_envio", "ultimo_envio"],
  campMetrics: ["id", "campanha", "status", "canais", "enviados", "avancou", "marcou_call", "fechou", "taxa_avanco", "taxa_call", "taxa_ganho"],
  publico: ["lead_id", "nome", "empresa", "etapa", "whatsapp_ok", "email_ok", "email_optout", "enviado_whatsapp", "enviado_email", "dias_sem_toque"],
  sequencias: ["id", "nome", "status", "gatilho", "passos", "duracao_dias", "canais", "inscritos", "ativos", "esperando", "sai_quando"],
  seqMetrics: ["id", "sequencia", "status", "inscritos", "ativos", "esperando", "concluidos", "sairam", "avancou", "marcou_call", "fechou", "taxa_ganho"],
  inscricoes: ["enrollment_id", "sequencia", "lead", "empresa", "telefone", "status", "passo", "canal", "mensagem", "proximo_em", "dias_esperando", "motivo_saida", "lead_id"],
  templates: ["id", "nome", "canal", "assunto", "previa", "tokens"],
  contas: ["id", "conta", "status", "nicho", "marketplace", "anuncios", "cidade", "telefone", "email", "instagram", "dias_sem_toque", "lead_id", "notas"],
  funilOut: ["conta", "status_conta", "lead_id", "etapa_lead", "dono", "valor", "ganho", "dias_sem_toque"],
};

export function registerOutboundTools(tool) {
  // ─────────────────────────────────────────── Campanhas (disparos) ─────────

  tool("campaigns_list", {
    group: G_CAMP,
    title: "Campanhas de disparo",
    description: "Disparos do produto com o progresso resumido por canal e as datas de primeiro e último envio.",
    input: {
      saas: z.string().optional(),
      status: z.enum(["draft", "sending", "any"]).optional().describe("Padrão any."),
      q: z.string().optional(),
      limit: z.number().int().optional(),
      offset: z.number().int().optional(),
    },
  }, async ({ saas, status = "any", q, limit = 25, offset = 0 }) => {
    const product = await resolveProduct(saas);
    const camps = (await http.get("/api/campaigns", { saas: product.id })) || [];
    const rows = camps.map((c) => {
      const p = progressoDe(c);
      return {
        id: c.id,
        nome: c.name || "sem nome",
        status: c.status || "draft",
        canais: [c.channels?.whatsapp !== false && "whatsapp", c.channels?.email && "email"].filter(Boolean).join("+"),
        etapas: (c.stages || []).join(", "),
        enviados: p.leads,
        whatsapp: p.whatsapp,
        email: p.email,
        primeiro_envio: p.primeiro,
        ultimo_envio: p.ultimo,
        criada_em: c.createdAt || "",
        criada_por: c.createdBy || "",
      };
    });
    const s = select(rows, {
      where: status === "any" ? undefined : { status },
      q, qFields: ["nome", "id"],
      sort: "ultimo_envio:desc", limit, offset,
    });
    const tocados = new Set(camps.flatMap((c) => Object.keys(c.sent || {})));
    return result({
      kind: "campaigns.list",
      title: `Disparos · ${product.name || product.id}`,
      scope: { saas: product.id },
      totals: {
        campanhas: camps.length,
        rascunhos: rows.filter((r) => r.status === "draft").length,
        disparando: rows.filter((r) => r.status === "sending").length,
        leads_tocados: tocados.size,
        envios_whatsapp: rows.reduce((a, r) => a + r.whatsapp, 0),
        envios_email: rows.reduce((a, r) => a + r.email, 0),
      },
      columns: COLS.campanhas,
      rows: s.rows,
      rowsLabel: "Campanhas",
      page: s.page,
      notes: ["`leads_tocados` conta lead único em qualquer campanha: o mesmo lead em dois disparos conta uma vez."],
      source: { endpoint: "GET /api/campaigns" },
    });
  });

  tool("campaign_get", {
    group: G_CAMP,
    title: "Campanha em detalhe",
    description: "Uma campanha em detalhe: copy, público por etapa, quem já recebeu por canal e quem falta.",
    input: {
      campaign_id: z.string(),
      limit: z.number().int().optional(),
    },
    hint: "confira o id com campaigns_list.",
  }, async ({ campaign_id, limit = 50 }) => {
    const camp = await http.get(`/api/campaigns/${encodeURIComponent(campaign_id)}`);
    const leads = await leadsDo(camp.saas);
    const byId = porId(leads);
    const sent = camp.sent || {};
    const etapas = new Set(camp.stages || []);
    const publico = leads.filter((l) => etapas.has(l.stage));

    const linhaDe = (l, id) => ({
      lead_id: id,
      nome: l?.name || "(lead removido)",
      empresa: l?.company || "",
      etapa: l?.stage || "",
      whatsapp_ok: l ? temWhats(l) : false,
      email_ok: l ? temEmail(l) : false,
      email_optout: !!l?.emailOptOut,
      enviado_whatsapp: sent[id]?.whatsapp || null,
      enviado_email: sent[id]?.email || null,
      dias_sem_toque: dias(l?.lastActivityAt || l?.stageSince || l?.createdAt),
    });

    const enviados = Object.keys(sent).map((id) => linhaDe(byId.get(id), id));
    const pendentes = publico.filter((l) => !sent[l.id]).map((l) => linhaDe(l, l.id));
    const eEnv = select(enviados, { sort: "enviado_email:desc", limit });
    const ePen = select(pendentes, { sort: "dias_sem_toque:desc", limit });
    const p = progressoDe(camp);

    return result({
      kind: "campaigns.campaign",
      title: `Disparo · ${camp.name || camp.id}`,
      scope: { saas: camp.saas, id: camp.id, status: camp.status || "draft" },
      units: UNITS,
      totals: {
        publico: publico.length,
        enviados: p.leads,
        envios_whatsapp: p.whatsapp,
        envios_email: p.email,
        pendentes: pendentes.length,
        pendentes_email: pendentes.filter((r) => r.email_ok).length,
        pendentes_whatsapp: pendentes.filter((r) => r.whatsapp_ok).length,
        descadastrados_email: publico.filter((l) => l.emailOptOut).length,
        primeiro_envio: p.primeiro,
        ultimo_envio: p.ultimo,
      },
      detail: {
        nome: camp.name || "",
        status: camp.status || "draft",
        etapas: camp.stages || [],
        canais: camp.channels || {},
        email: { subject: camp.email?.subject || "", body: camp.email?.body || "" },
        whatsapp: camp.wa?.text || "",
        criada_em: camp.createdAt || "",
        criada_por: camp.createdBy || "",
      },
      tables: {
        enviados: { label: "Já receberam", columns: COLS.publico, rows: eEnv.rows, page: eEnv.page },
        pendentes: { label: "Ainda no público, sem envio", columns: COLS.publico, rows: ePen.rows, page: ePen.page },
      },
      notes: [
        eEnv.page.truncated || ePen.page.truncated ? `tabelas cortadas em limit=${limit} (enviados ${eEnv.page.returned}/${eEnv.page.total}, pendentes ${ePen.page.returned}/${ePen.page.total}) — aumente limit para o resto.` : null,
        etapas.size ? null : "campanha sem etapas no público: `pendentes` sai vazio porque não há segmento definido.",
        "lead que recebeu e depois MUDOU de etapa continua em `enviados`, mas some do público.",
      ].filter(Boolean),
      source: { endpoint: `GET /api/campaigns/${camp.id}` },
    });
  });

  tool("campaigns_audience", {
    group: G_CAMP,
    title: "Público de um disparo",
    description: "Leads por etapa do funil com WhatsApp válido, e-mail e descadastro; sem stages, usa as etapas qualificadas.",
    input: {
      saas: z.string().optional(),
      stages: z.array(z.string()).optional().describe("Padrão: as etapas qualificadas."),
      campaign_id: z.string().optional().describe("Marca quem já recebeu."),
      q: z.string().optional(),
      limit: z.number().int().optional(),
    },
  }, async ({ saas, stages, campaign_id, q, limit = 50 }) => {
    const product = await resolveProduct(saas);
    const alvo = stages?.length ? stages : stagesQualificadas(product);
    const [leads, camp] = await Promise.all([
      leadsDo(product.id),
      campaign_id ? http.get(`/api/campaigns/${encodeURIComponent(campaign_id)}`) : Promise.resolve(null),
    ]);
    const sent = camp?.sent || {};
    const set = new Set(alvo);
    const publico = leads.filter((l) => set.has(l.stage));
    const rows = publico.map((l) => ({
      lead_id: l.id,
      nome: l.name || "",
      empresa: l.company || "",
      etapa: l.stage || "",
      whatsapp_ok: temWhats(l),
      email_ok: temEmail(l),
      email_optout: !!l.emailOptOut,
      enviado_whatsapp: sent[l.id]?.whatsapp || null,
      enviado_email: sent[l.id]?.email || null,
      dias_sem_toque: dias(l.lastActivityAt || l.stageSince || l.createdAt),
    }));
    const s = select(rows, { q, qFields: ["nome", "empresa"], sort: "dias_sem_toque:desc", limit });
    const porEtapa = groupBy(rows, { by: "etapa", count: "leads", label: "etapa" }).map((g) => {
      const mine = rows.filter((r) => r.etapa === g.etapa);
      return { ...g, com_whatsapp: mine.filter((r) => r.whatsapp_ok).length, com_email: mine.filter((r) => r.email_ok).length };
    });

    return result({
      kind: "campaigns.audience",
      title: `Público do disparo · ${product.name || product.id}`,
      scope: { saas: product.id, campanha: camp?.id || null },
      units: UNITS,
      totals: {
        etapas: alvo.length,
        leads: rows.length,
        com_whatsapp: rows.filter((r) => r.whatsapp_ok).length,
        com_email: rows.filter((r) => r.email_ok).length,
        descadastrados_email: rows.filter((r) => r.email_optout).length,
        whatsapp_bloqueado: publico.filter((l) => l.whatsappInvalid || l.whatsappOptOut).length,
        ja_receberam: rows.filter((r) => r.enviado_whatsapp || r.enviado_email).length,
        pendentes_email: rows.filter((r) => r.email_ok && !r.enviado_email).length,
        pendentes_whatsapp: rows.filter((r) => r.whatsapp_ok && !r.enviado_whatsapp).length,
      },
      columns: COLS.publico,
      rows: s.rows,
      rowsLabel: "Leads no público",
      page: s.page,
      tables: { por_etapa: { label: "Por etapa", columns: ["etapa", "leads", "com_whatsapp", "com_email"], rows: porEtapa } },
      notes: [
        `etapas usadas: ${alvo.join(", ") || "(nenhuma — o funil do produto não tem etapa qualificada)"}.`,
        "`whatsapp_ok` exige telefone com DDD e nenhuma marca de número inválido/descadastrado; `email_ok` exige e-mail sem opt-out.",
      ],
      source: { endpoint: "GET /api/leads (recortado por saas no MCP)" },
    });
  });

  tool("campaign_create", {
    group: G_CAMP,
    title: "Criar campanha",
    description: "Cria um disparo em rascunho (público por etapa, canais e copy). Não envia nada.",
    write: true,
    input: {
      saas: z.string().optional(),
      name: z.string(),
      stages: z.array(z.string()).optional().describe("Padrão: as etapas qualificadas."),
      whatsapp: z.boolean().optional().describe("Padrão true."),
      email: z.boolean().optional().describe("Padrão false."),
      email_subject: z.string().optional().describe("Aceita {{nome}} {{empresa}} {{nicho}} {{contas}} {{anuncios}}."),
      email_body: z.string().optional().describe("Rodapé de descadastro é anexado."),
      wa_text: z.string().optional(),
    },
  }, async ({ saas, name, stages, whatsapp = true, email = false, email_subject = "", email_body = "", wa_text = "" }) => {
    const product = await resolveProduct(saas);
    const body = {
      name, saas: product.id, status: "draft",
      stages: stages?.length ? stages : stagesQualificadas(product),
      channels: { email, whatsapp },
      email: { subject: email_subject, body: email_body },
      wa: { text: wa_text },
      sent: {},
      createdAt: nowIso(),
    };
    const c = await http.post("/api/campaigns", body);
    return result({
      kind: "campaigns.created",
      title: `Campanha criada · ${c.name || c.id}`,
      scope: { saas: product.id, id: c.id },
      totals: { id: c.id, status: c.status, etapas: (c.stages || []).length },
      detail: c,
      notes: ["nasce em rascunho e não envia nada: o envio é campaign_send_email (e-mail nativo) ou campaign_mark (assistido)."],
      source: { endpoint: "POST /api/campaigns" },
    });
  });

  tool("campaign_update", {
    group: G_CAMP,
    title: "Editar campanha",
    description: "Edita nome, público, canais ou copy de um disparo; o resto e o progresso de envio ficam intactos.",
    write: true,
    input: {
      campaign_id: z.string(),
      name: z.string().optional(),
      status: z.enum(["draft", "sending"]).optional(),
      stages: z.array(z.string()).optional(),
      whatsapp: z.boolean().optional(),
      email: z.boolean().optional(),
      email_subject: z.string().optional(),
      email_body: z.string().optional(),
      wa_text: z.string().optional(),
    },
    hint: "confira o id com campaigns_list.",
  }, async ({ campaign_id, name, status, stages, whatsapp, email, email_subject, email_body, wa_text }) => {
    // PATCH é merge RASO: mandar `email:{subject}` apagaria o corpo, então o
    // objeto aninhado é remontado a partir do que já está gravado.
    const atual = await http.get(`/api/campaigns/${encodeURIComponent(campaign_id)}`);
    const patch = {};
    if (name !== undefined) patch.name = name;
    if (status !== undefined) patch.status = status;
    if (stages !== undefined) patch.stages = stages;
    if (whatsapp !== undefined || email !== undefined) {
      patch.channels = {
        whatsapp: whatsapp !== undefined ? whatsapp : atual.channels?.whatsapp !== false,
        email: email !== undefined ? email : !!atual.channels?.email,
      };
    }
    if (email_subject !== undefined || email_body !== undefined) {
      patch.email = {
        subject: email_subject !== undefined ? email_subject : (atual.email?.subject || ""),
        body: email_body !== undefined ? email_body : (atual.email?.body || ""),
      };
    }
    if (wa_text !== undefined) patch.wa = { text: wa_text };
    if (!Object.keys(patch).length) throw new Error("nada pra mudar: passe ao menos um campo (name, stages, email_body…).");
    const c = await http.patch(`/api/campaigns/${encodeURIComponent(campaign_id)}`, patch);
    return result({
      kind: "campaigns.updated",
      title: `Campanha atualizada · ${c.name || c.id}`,
      scope: { saas: c.saas, id: c.id },
      totals: { campos: Object.keys(patch).join(", "), status: c.status },
      detail: { nome: c.name, etapas: c.stages, canais: c.channels, email: c.email, whatsapp: c.wa?.text || "" },
      source: { endpoint: `PATCH /api/campaigns/${campaign_id}` },
    });
  });

  tool("campaign_metrics", {
    group: G_CAMP,
    title: "Relatório de disparo",
    description: "Conversão por campanha: enviados → avançou de etapa → marcou call → fechou, com as taxas prontas.",
    input: {
      saas: z.string().optional(),
      sort_by: z.enum(["fechou", "avancou", "marcou_call", "enviados", "taxa_ganho"]).optional().describe("Padrão fechou."),
      limit: z.number().int().optional(),
    },
  }, async ({ saas, sort_by = "fechou", limit = 25 }) => {
    const product = await resolveProduct(saas);
    const r = await http.get(`/api/campaigns/metrics/${encodeURIComponent(product.id)}`);
    const rows = (r?.campaigns || []).map((c) => ({
      id: c.id,
      campanha: c.name || "sem nome",
      status: c.status || "draft",
      canais: [c.channels?.whatsapp !== false && "whatsapp", c.channels?.email && "email"].filter(Boolean).join("+"),
      enviados: num(c.sent),
      avancou: num(c.advanced),
      marcou_call: num(c.booked),
      fechou: num(c.won),
      taxa_avanco: pct(c.advanced, c.sent),
      taxa_call: pct(c.booked, c.sent),
      taxa_ganho: pct(c.won, c.sent),
    }));
    const s = select(rows, { sort: `${sort_by}:desc`, limit });
    const soma = (k) => rows.reduce((a, x) => a + num(x[k]), 0);
    const enviados = soma("enviados");
    return result({
      kind: "campaigns.metrics",
      title: `Resultado dos disparos · ${product.name || product.id}`,
      scope: { saas: product.id },
      units: UNITS,
      totals: {
        campanhas: rows.length,
        enviados,
        avancou: soma("avancou"),
        marcou_call: soma("marcou_call"),
        fechou: soma("fechou"),
        taxa_avanco: pct(soma("avancou"), enviados),
        taxa_call: pct(soma("marcou_call"), enviados),
        taxa_ganho: pct(soma("fechou"), enviados),
      },
      columns: COLS.campMetrics,
      rows: s.rows,
      rowsLabel: "Campanhas",
      page: s.page,
      notes: [
        `atribuição: mudança de etapa nos ${ATTR_DIAS} dias DEPOIS do envio — é correlação por janela, não prova de causa.`,
        "`enviados` conta LEADS que receberam (não mensagens): o mesmo lead em dois canais conta uma vez.",
        "sem período: o endpoint mede a campanha inteira, desde o primeiro envio.",
      ],
      source: { endpoint: `GET /api/campaigns/metrics/${product.id}` },
    });
  });

  tool("campaign_send_email", {
    group: G_CAMP,
    title: "Disparar e-mail em massa",
    description: "Envia o e-mail da campanha pela conta Google conectada, pulando quem descadastrou.",
    write: true, external: true, destructive: true,
    danger: "manda e-mail DE VERDADE para pessoas reais, um por lead, sem desfazer.",
    hint: "424 = conecte o Google com permissão de e-mail (Ajustes → Integrações → reconectar Google).",
    input: {
      campaign_id: z.string().describe("Precisa ter assunto ou corpo."),
      lead_ids: z.array(z.string()).optional().describe("Omitido exige pending=true."),
      pending: z.boolean().optional().describe("Todos os pendentes do público."),
      confirm: z.literal(true).describe("E-mails reais serão enviados agora."),
    },
  }, async ({ campaign_id, lead_ids, pending, confirm }) => {
    if (confirm !== true) throw new Error("passe confirm=true: esta tool envia e-mail real.");
    const camp = await http.get(`/api/campaigns/${encodeURIComponent(campaign_id)}`);
    const leads = await leadsDo(camp.saas);
    const byId = porId(leads);
    let ids = lead_ids || [];
    if (!ids.length) {
      if (!pending) throw new Error("informe lead_ids, ou pending=true para enviar a todos os pendentes do público.");
      const etapas = new Set(camp.stages || []);
      ids = leads.filter((l) => etapas.has(l.stage) && temEmail(l) && !camp.sent?.[l.id]?.email).map((l) => l.id);
      if (!ids.length) throw new Error("nenhum lead pendente com e-mail no público desta campanha.");
    }
    const r = await http.post(`/api/campaigns/${encodeURIComponent(camp.id)}/send-email`, { leadIds: ids }, { timeoutMs: 300_000 });
    const rows = (r?.results || []).map((x) => ({
      lead_id: x.leadId,
      lead: byId.get(x.leadId)?.name || "",
      email: byId.get(x.leadId)?.email || "",
      ok: !!x.ok,
      motivo: x.reason || null,
    }));
    const motivos = groupBy(rows.filter((x) => !x.ok), { by: "motivo", count: "leads", label: "motivo" });
    return result({
      kind: "campaigns.send_email",
      title: `Disparo de e-mail · ${camp.name || camp.id}`,
      scope: { saas: camp.saas, id: camp.id },
      totals: {
        pedidos: num(r?.total) || ids.length,
        enviados: num(r?.ok),
        pulados: rows.filter((x) => !x.ok).length,
        total_da_campanha: Object.keys(r?.sent || {}).length,
      },
      columns: ["lead_id", "lead", "email", "ok", "motivo"],
      rows,
      rowsLabel: "Envios",
      tables: motivos.length ? { motivos: { label: "Por que pulou", columns: ["motivo", "leads"], rows: motivos } } : {},
      notes: [
        "cada envio vira activity de e-mail na timeline do lead e tira a campanha de rascunho.",
        "quem descadastrou (emailOptOut) é pulado pelo servidor — não dá pra forçar por aqui.",
      ],
      source: { endpoint: `POST /api/campaigns/${camp.id}/send-email` },
    });
  });

  tool("campaign_mark", {
    group: G_CAMP,
    title: "Marcar envio assistido",
    description: "Registra um envio feito na mão para um lead, no progresso da campanha e na timeline.",
    write: true,
    danger: "escreve um toque na timeline de um lead real — não use para teste.",
    input: {
      campaign_id: z.string(),
      lead_id: z.string(),
      channel: z.enum(["whatsapp", "email"]),
    },
  }, async ({ campaign_id, lead_id, channel }) => {
    const c = await http.post(`/api/campaigns/${encodeURIComponent(campaign_id)}/mark`, { leadId: lead_id, channel });
    const p = progressoDe(c);
    return result({
      kind: "campaigns.mark",
      title: `Envio marcado · ${channel}`,
      scope: { saas: c.saas, id: c.id, lead: lead_id },
      totals: { status: c.status, enviados: p.leads, envios_whatsapp: p.whatsapp, envios_email: p.email, marcado_em: c.sent?.[lead_id]?.[channel] || null },
      notes: ["marcar não promove etapa nem gasta tentativa da cadência: é só o registro do toque."],
      source: { endpoint: `POST /api/campaigns/${campaign_id}/mark` },
    });
  });

  tool("campaign_ai_copy", {
    group: G_CAMP,
    title: "Copy do disparo por IA",
    description: "Sugere assunto, corpo de e-mail e mensagem de WhatsApp para um disparo, sem gravar nada.",
    external: true,
    danger: "consome IA paga (OpenRouter/Anthropic) a cada chamada.",
    hint: "424/400 = IA não configurada no servidor (OPENROUTER_API_KEY ou ANTHROPIC_API_KEY).",
    input: {
      saas: z.string().optional(),
      channel: z.enum(["whatsapp", "email", "ambos"]).optional().describe("Padrão whatsapp."),
      objetivo: z.string().optional().describe("Padrão: reengajar e agendar conversa."),
      publico: z.string().optional(),
    },
  }, async ({ saas, channel = "whatsapp", objetivo = "", publico = "" }) => {
    const product = await resolveProduct(saas);
    const r = await http.post("/api/campaigns/ai-copy", { channel, objetivo, publico, productName: product.name || product.id }, { timeoutMs: 180_000 });
    return result({
      kind: "campaigns.ai_copy",
      title: `Copy sugerida · ${channel}`,
      scope: { saas: product.id, channel },
      detail: { subject: r?.subject || "", body: r?.body || "", whatsapp: r?.whatsapp || "" },
      notes: [
        "tokens disponíveis: {{nome}} {{empresa}} {{nicho}} {{contas}} {{anuncios}}.",
        "a rota descarta o consumo do modelo, então esta chamada não aparece no relatório de custo de IA.",
      ],
      source: { endpoint: "POST /api/campaigns/ai-copy" },
    });
  });

  tool("campaigns_optout", {
    group: G_CAMP,
    title: "Descadastro de e-mail",
    description: "Quem saiu da lista de e-mail, a taxa sobre a base e a origem do último e-mail no período.",
    input: {
      saas: z.string().optional(),
      ...periodInput(z),
      limit: z.number().int().optional(),
    },
  }, async ({ saas, period, since, until, limit = 50 }) => {
    const product = await resolveProduct(saas);
    const p = resolvePeriod({ period, since, until });
    const [leads, acts, camps, seqs] = await Promise.all([
      leadsDo(product.id),
      http.get("/api/activities", { saas: product.id, type: "email", since: p.since }),
      http.get("/api/campaigns", { saas: product.id }),
      http.get("/api/sequences", { saas: product.id }),
    ]);
    const naJanela = (acts || []).filter((a) => String(a.at || "") >= p.since && String(a.at || "") <= `${p.until}T23:59:59Z`);
    const nomeCamp = new Map((camps || []).map((c) => [c.id, c.name || c.id]));
    const nomeSeq = new Map((seqs || []).map((s) => [s.id, s.name || s.id]));

    const ultimoEmail = new Map(); // leadId → activity mais recente
    for (const a of naJanela) {
      const cur = ultimoEmail.get(a.lead);
      if (!cur || String(a.at) > String(cur.at)) ultimoEmail.set(a.lead, a);
    }
    const origem = (a) => (a?.meta?.campaign ? `campanha · ${nomeCamp.get(a.meta.campaign) || a.meta.campaign}`
      : a?.meta?.sequence ? `sequência · ${nomeSeq.get(a.meta.sequence) || a.meta.sequence}` : a ? "avulso" : "");

    const comEmail = leads.filter((l) => l.email);
    const fora = comEmail.filter((l) => l.emailOptOut);
    const rows = fora.map((l) => {
      const a = ultimoEmail.get(l.id);
      return {
        lead_id: l.id, nome: l.name || "", email: l.email, etapa: l.stage || "",
        ultimo_email: a?.at || null, origem: origem(a),
      };
    });
    const s = select(rows, { sort: "ultimo_email:desc", limit });

    const porOrigem = groupBy(naJanela, {
      by: (a) => origem(a) || "avulso", count: "emails", label: "origem",
    }).map((g) => {
      const ids = new Set(naJanela.filter((a) => (origem(a) || "avulso") === g.origem).map((a) => a.lead));
      const saiu = [...ids].filter((id) => fora.some((l) => l.id === id)).length;
      return { ...g, leads: ids.size, descadastrou: saiu, taxa_optout: pct(saiu, ids.size) };
    }).sort((a, b) => b.emails - a.emails);

    return result({
      kind: "campaigns.optout",
      title: `Descadastro de e-mail · ${product.name || product.id}`,
      scope: { saas: product.id },
      period: p,
      units: UNITS,
      totals: {
        leads_com_email: comEmail.length,
        descadastrados: fora.length,
        taxa_optout: pct(fora.length, comEmail.length),
        emails_no_periodo: naJanela.length,
        leads_alcancados_no_periodo: new Set(naJanela.map((a) => a.lead)).size,
      },
      columns: ["lead_id", "nome", "email", "etapa", "ultimo_email", "origem"],
      rows: s.rows,
      rowsLabel: "Leads descadastrados",
      page: s.page,
      tables: { por_origem: { label: "E-mails enviados no período, por origem", columns: ["origem", "emails", "leads", "descadastrou", "taxa_optout"], rows: porOrigem, units: UNITS } },
      notes: [
        "o opt-out é um ESTADO do lead (emailOptOut), sem data: `descadastrados` e a taxa são acumulados, não do período. O período recorta só os e-mails enviados.",
        "por isso `descadastrou` por origem atribui ao ÚLTIMO e-mail que o lead recebeu na janela — é a melhor pista disponível, não uma prova.",
        "descadastro entra pelo link público /u/:token; não há API para desfazer.",
      ],
      source: { endpoint: "GET /api/activities?type=email" },
    });
  });

  // ─────────────────────────────────────────── Sequências (drip) ────────────

  tool("sequences_list", {
    group: G_SEQ,
    title: "Sequências de nutrição",
    description: "Cadências do produto com gatilho, passos, saídas, inscritos, ativos e parados na fila; com sequence_id, abre os passos.",
    input: {
      saas: z.string().optional(),
      sequence_id: z.string().optional().describe("Abre os passos dessa sequência."),
      status: z.enum(["draft", "active", "paused", "any"]).optional().describe("Padrão any."),
      limit: z.number().int().optional(),
    },
  }, async ({ saas, sequence_id, status = "any", limit = 25 }) => {
    const product = await resolveProduct(saas);
    const [seqs, ens] = await Promise.all([
      http.get("/api/sequences", { saas: product.id }),
      http.get("/api/sequence_enrollments", { saas: product.id }),
    ]);
    const contaDe = (id, st) => (ens || []).filter((e) => e.sequence === id && (!st || e.status === st)).length;
    const rows = (seqs || []).map((s) => ({
      id: s.id,
      nome: s.name || "sem nome",
      status: s.status || "draft",
      gatilho: (s.trigger?.stages || []).join(", "),
      ...passosResumo(s.steps),
      inscritos: contaDe(s.id),
      ativos: contaDe(s.id, "active"),
      esperando: contaDe(s.id, "waiting"),
      sai_quando: saidasDe(s.exitOn),
    }));
    const sel = select(rows, { where: status === "any" ? undefined : { status }, sort: "inscritos:desc", limit });

    const tables = {};
    if (sequence_id) {
      const seq = (seqs || []).find((s) => s.id === sequence_id);
      if (!seq) throw new Error(`sequência "${sequence_id}" não existe neste produto.`);
      tables.passos = {
        label: `Passos · ${seq.name || seq.id}`,
        columns: ["passo", "canal", "espera_dias", "assunto", "mensagem"],
        rows: (seq.steps || []).map((st, i) => ({
          passo: i + 1, canal: st.channel, espera_dias: num(st.delayDays),
          assunto: st.subject || "", mensagem: corta(st.body || st.text, 160),
        })),
        units: UNITS,
      };
    }
    return result({
      kind: "sequences.list",
      title: `Sequências · ${product.name || product.id}`,
      scope: { saas: product.id, id: sequence_id || null },
      units: UNITS,
      totals: {
        sequencias: rows.length,
        ativas: rows.filter((r) => r.status === "active").length,
        pausadas: rows.filter((r) => r.status === "paused").length,
        rascunhos: rows.filter((r) => r.status === "draft").length,
        inscritos: (ens || []).length,
        esperando_whatsapp: (ens || []).filter((e) => e.status === "waiting").length,
      },
      columns: COLS.sequencias,
      rows: sel.rows,
      rowsLabel: "Sequências",
      page: sel.page,
      tables,
      notes: ["só sequência `active` roda: o motor passa de 5 em 5 minutos, auto-inscreve quem está na etapa-gatilho e envia os passos de e-mail."],
      source: { endpoint: "GET /api/sequences" },
    });
  });

  tool("sequences_upsert", {
    group: G_SEQ,
    title: "Criar/editar/apagar sequência",
    description: "Monta a cadência: gatilho, passos e regras de saída. action=delete apaga; status=active LIGA o envio automático.",
    write: true, destructive: true,
    danger: "com status=active a sequência passa a inscrever leads e mandar e-mail sozinha, sem nova aprovação; delete para as inscrições em curso.",
    input: {
      action: z.enum(["create", "update", "delete"]).optional().describe("Padrão: create sem sequence_id, update com."),
      saas: z.string().optional(),
      sequence_id: z.string().optional().describe("Obrigatório em update/delete."),
      name: z.string().optional(),
      status: z.enum(["draft", "active", "paused"]).optional().describe("active liga a automação."),
      trigger_stages: z.array(z.string()).optional().describe("Etapas que auto-inscrevem."),
      steps: z.array(z.object({
        channel: z.enum(["email", "whatsapp"]),
        delay_days: z.number().optional().describe("Dias de espera; 0 = imediato."),
        subject: z.string().optional().describe("Só e-mail."),
        body: z.string().optional().describe("Só e-mail."),
        text: z.string().optional().describe("Só whatsapp."),
      })).optional().describe("Substitui a lista inteira de passos."),
      exit_on: z.object({
        won: z.boolean().optional(), booked: z.boolean().optional(),
        opt_out: z.boolean().optional(), stage_left: z.boolean().optional(),
      }).optional().describe("won/booked/opt_out nascem ligadas; stage_left desligada."),
    },
    hint: "para só ativar/pausar, passe sequence_id + status.",
  }, async ({ action, saas, sequence_id, name, status, trigger_stages, steps, exit_on }) => {
    const act = action || (sequence_id ? "update" : "create");
    if (act !== "create" && !sequence_id) throw new Error(`action=${act} exige sequence_id.`);

    if (act === "delete") {
      const seq = await http.get(`/api/sequences/${encodeURIComponent(sequence_id)}`);
      await http.del(`/api/sequences/${encodeURIComponent(sequence_id)}`);
      return result({
        kind: "sequences.deleted",
        title: `Sequência apagada · ${seq.name || sequence_id}`,
        scope: { saas: seq.saas, id: sequence_id },
        notes: ["as inscrições continuam gravadas, mas param de andar: o motor ignora enrollment de sequência que sumiu."],
        source: { endpoint: `DELETE /api/sequences/${sequence_id}` },
      });
    }

    const mapSteps = (list) => list.map((s) => (s.channel === "whatsapp"
      ? { channel: "whatsapp", delayDays: num(s.delay_days), text: s.text || "" }
      : { channel: "email", delayDays: num(s.delay_days), subject: s.subject || "", body: s.body || "" }));
    const mapExit = (ex, base = {}) => ({
      won: ex?.won ?? (base.won !== false),
      booked: ex?.booked ?? (base.booked !== false),
      optOut: ex?.opt_out ?? (base.optOut !== false),
      stageLeft: ex?.stage_left ?? (base.stageLeft === true),
    });

    let seq;
    if (act === "create") {
      const product = await resolveProduct(saas);
      if (!name) throw new Error("create exige `name`.");
      seq = await http.post("/api/sequences", {
        name, saas: product.id, status: status || "draft",
        trigger: { stages: trigger_stages || [] },
        steps: mapSteps(steps || []),
        exitOn: mapExit(exit_on),
        createdAt: nowIso(),
      });
    } else {
      const atual = await http.get(`/api/sequences/${encodeURIComponent(sequence_id)}`);
      const patch = {};
      if (name !== undefined) patch.name = name;
      if (status !== undefined) patch.status = status;
      if (trigger_stages !== undefined) patch.trigger = { stages: trigger_stages };
      if (steps !== undefined) patch.steps = mapSteps(steps);
      if (exit_on !== undefined) patch.exitOn = mapExit(exit_on, atual.exitOn || {});
      if (!Object.keys(patch).length) throw new Error("nada pra mudar: passe name, status, trigger_stages, steps ou exit_on.");
      seq = await http.patch(`/api/sequences/${encodeURIComponent(sequence_id)}`, patch);
    }

    const r = passosResumo(seq.steps);
    return result({
      kind: act === "create" ? "sequences.created" : "sequences.updated",
      title: `Sequência ${act === "create" ? "criada" : "atualizada"} · ${seq.name || seq.id}`,
      scope: { saas: seq.saas, id: seq.id, status: seq.status },
      units: UNITS,
      totals: { id: seq.id, status: seq.status || "draft", passos: r.passos, duracao_dias: r.duracao_dias, gatilho: (seq.trigger?.stages || []).join(", ") || "(nenhum)", sai_quando: saidasDe(seq.exitOn) },
      tables: {
        passos: {
          label: "Passos",
          columns: ["passo", "canal", "espera_dias", "assunto", "mensagem"],
          rows: (seq.steps || []).map((st, i) => ({ passo: i + 1, canal: st.channel, espera_dias: num(st.delayDays), assunto: st.subject || "", mensagem: corta(st.body || st.text, 160) })),
          units: UNITS,
        },
      },
      notes: [
        seq.status === "active" ? `LIGADA: no próximo ciclo (≤5 min) ela inscreve todo lead nas etapas ${(seq.trigger?.stages || []).join(", ") || "(nenhuma)"} e começa a enviar.` : "em rascunho/pausada nada é enviado.",
        (seq.trigger?.stages || []).length ? null : "sem gatilho ninguém entra sozinho — use sequence_enroll para inscrever na mão.",
        "passo de WhatsApp nunca é automático: para na fila assistida (sequences_enrollments status=waiting).",
      ].filter(Boolean),
      source: { endpoint: act === "create" ? "POST /api/sequences" : `PATCH /api/sequences/${sequence_id}` },
    });
  });

  tool("sequence_metrics", {
    group: G_SEQ,
    title: "Relatório de sequências",
    description: "Conversão por cadência: inscritos, onde estão e quantos avançaram, marcaram call e fecharam.",
    input: {
      saas: z.string().optional(),
      sort_by: z.enum(["fechou", "avancou", "marcou_call", "inscritos", "taxa_ganho"]).optional().describe("Padrão fechou."),
      limit: z.number().int().optional(),
    },
  }, async ({ saas, sort_by = "fechou", limit = 25 }) => {
    const product = await resolveProduct(saas);
    const r = await http.get(`/api/sequences/metrics/${encodeURIComponent(product.id)}`);
    const rows = (r?.sequences || []).map((s) => ({
      id: s.id,
      sequencia: s.name || "sem nome",
      status: s.status || "draft",
      inscritos: num(s.enrolled),
      ativos: num(s.statusCounts?.active),
      esperando: num(s.statusCounts?.waiting),
      concluidos: num(s.statusCounts?.done),
      sairam: num(s.statusCounts?.exited),
      avancou: num(s.advanced),
      marcou_call: num(s.booked),
      fechou: num(s.won),
      taxa_avanco: pct(s.advanced, s.enrolled),
      taxa_call: pct(s.booked, s.enrolled),
      taxa_ganho: pct(s.won, s.enrolled),
    }));
    const sel = select(rows, { sort: `${sort_by}:desc`, limit });
    const soma = (k) => rows.reduce((a, x) => a + num(x[k]), 0);
    const inscritos = soma("inscritos");
    return result({
      kind: "sequences.metrics",
      title: `Resultado das sequências · ${product.name || product.id}`,
      scope: { saas: product.id },
      units: UNITS,
      totals: {
        sequencias: rows.length,
        inscritos,
        ativos: soma("ativos"),
        esperando: soma("esperando"),
        concluidos: soma("concluidos"),
        sairam: soma("sairam"),
        avancou: soma("avancou"),
        marcou_call: soma("marcou_call"),
        fechou: soma("fechou"),
        taxa_ganho: pct(soma("fechou"), inscritos),
      },
      columns: COLS.seqMetrics,
      rows: sel.rows,
      rowsLabel: "Sequências",
      page: sel.page,
      notes: [
        `atribuição: mudança de etapa nos ${ATTR_DIAS} dias DEPOIS da inscrição — janela, não causa.`,
        "sem período: mede a sequência desde que existe. Para ver quem saiu e por quê, use sequences_enrollments.",
      ],
      source: { endpoint: `GET /api/sequences/metrics/${product.id}` },
    });
  });

  tool("sequences_enrollments", {
    group: G_SEQ,
    title: "Inscrições e fila WhatsApp",
    description: "Progresso dos leads nas cadências, com passo e mensagem interpolada. Padrão waiting: a fila de WhatsApp assistido.",
    input: {
      saas: z.string().optional(),
      status: z.enum(["active", "waiting", "done", "exited", "any"]).optional().describe("Padrão waiting."),
      sequence_id: z.string().optional(),
      lead_id: z.string().optional(),
      limit: z.number().int().optional(),
    },
  }, async ({ saas, status = "waiting", sequence_id, lead_id, limit = 50 }) => {
    const product = await resolveProduct(saas);
    const [ens, seqs, leads] = await Promise.all([
      http.get("/api/sequence_enrollments", { saas: product.id, sequence: sequence_id, lead: lead_id }),
      http.get("/api/sequences", { saas: product.id }),
      leadsDo(product.id),
    ]);
    const seqById = porId(seqs);
    const leadById = porId(leads);
    const todos = (ens || []).map((e) => {
      const seq = seqById.get(e.sequence);
      const lead = leadById.get(e.lead);
      const step = (seq?.steps || [])[num(e.stepIndex)];
      const toks = lead ? tokensDo(lead) : null;
      return {
        enrollment_id: e.id,
        sequencia: seq?.name || e.sequence,
        sequencia_id: e.sequence,
        lead: lead?.name || "(lead removido)",
        lead_id: e.lead,
        empresa: lead?.company || "",
        telefone: lead?.phone || "",
        email: lead?.email || "",
        status: e.status || "",
        passo: num(e.stepIndex) + 1,
        canal: step?.channel || e.pendingChannel || "",
        mensagem: corta(interpola(step?.text || step?.subject || "", toks), 160),
        proximo_em: e.nextRunAt || "",
        dias_esperando: e.status === "waiting" ? dias(e.lastAt || e.enrolledAt) : null,
        inscrito_em: e.enrolledAt || "",
        motivo_saida: e.exitReason || "",
      };
    });
    const s = select(todos, {
      where: status === "any" ? undefined : { status },
      sort: status === "waiting" ? "dias_esperando:desc" : "proximo_em", limit,
    });
    const esperando = todos.filter((r) => r.status === "waiting");
    const conta = (st) => todos.filter((r) => r.status === st).length;

    return result({
      kind: "sequences.enrollments",
      title: `Inscrições · ${product.name || product.id} (${status})`,
      scope: { saas: product.id, sequencia: sequence_id || null, status },
      units: UNITS,
      totals: {
        inscricoes: todos.length,
        ativos: conta("active"),
        esperando_whatsapp: esperando.length,
        concluidos: conta("done"),
        sairam: conta("exited"),
        espera_mais_antiga_dias: esperando.reduce((a, r) => Math.max(a, num(r.dias_esperando)), 0) || null,
      },
      columns: COLS.inscricoes,
      rows: s.rows,
      rowsLabel: "Inscrições",
      page: s.page,
      tables: {
        motivos_saida: {
          label: "Por que saíram",
          columns: ["motivo", "leads"],
          rows: groupBy(todos.filter((r) => r.status === "exited"), { by: "motivo_saida", count: "leads", label: "motivo" }).sort((a, b) => b.leads - a.leads),
        },
      },
      notes: [
        "`mensagem` já vem interpolada com os dados do lead: é o texto exato pra mandar. Depois de mandar, chame sequence_wa_sent.",
        "um lead nunca é reinscrito na mesma sequência (a existência da inscrição é a chave de idempotência).",
      ],
      source: { endpoint: "GET /api/sequence_enrollments" },
    });
  });

  tool("sequence_enroll", {
    group: G_SEQ,
    title: "Inscrever leads na sequência",
    description: "Inscreve leads numa cadência na mão, no passo 0 já vencido: numa sequência ativa o primeiro passo sai já.",
    write: true,
    danger: "se a sequência estiver ativa, estes leads começam a receber e-mail real em até 5 minutos.",
    input: {
      sequence_id: z.string(),
      lead_ids: z.array(z.string()),
      confirm: z.literal(true).describe("Os leads passam a receber a cadência."),
    },
    hint: "os ids de lead vêm de campaigns_audience ou das tools de pipeline.",
  }, async ({ sequence_id, lead_ids, confirm }) => {
    if (confirm !== true) throw new Error("passe confirm=true: os leads passam a receber a cadência.");
    if (!lead_ids?.length) throw new Error("informe lead_ids.");
    const seq = await http.get(`/api/sequences/${encodeURIComponent(sequence_id)}`);
    const [antes, leads] = await Promise.all([
      http.get("/api/sequence_enrollments", { sequence: seq.id }),
      leadsDo(seq.saas),
    ]);
    const jaTinha = new Set((antes || []).map((e) => e.lead));
    const existe = porId(leads);
    const r = await http.post(`/api/sequences/${encodeURIComponent(seq.id)}/enroll`, { leadIds: lead_ids });
    const rows = lead_ids.map((id) => ({
      lead_id: id,
      lead: existe.get(id)?.name || "",
      etapa: existe.get(id)?.stage || "",
      resultado: jaTinha.has(id) ? "já inscrito" : !existe.has(id) ? "lead não encontrado" : "inscrito",
    }));
    return result({
      kind: "sequences.enroll",
      title: `Inscrição · ${seq.name || seq.id}`,
      scope: { saas: seq.saas, id: seq.id, status: seq.status || "draft" },
      totals: {
        pedidos: lead_ids.length,
        inscritos: num(r?.enrolled),
        ja_inscritos: rows.filter((x) => x.resultado === "já inscrito").length,
        lead_inexistente: rows.filter((x) => x.resultado === "lead não encontrado").length,
        sequencia_ativa: (seq.status || "draft") === "active",
      },
      columns: ["lead_id", "lead", "etapa", "resultado"],
      rows,
      rowsLabel: "Leads",
      notes: [
        (seq.status || "draft") === "active"
          ? "sequência ATIVA: o primeiro passo sai no próximo ciclo do motor (≤5 min), ou já em sequence_run."
          : "sequência não está ativa: as inscrições ficam paradas até alguém ligar a sequência (sequences_upsert status=active).",
        "quem já estava inscrito é ignorado pelo servidor — não recomeça a régua.",
      ],
      source: { endpoint: `POST /api/sequences/${seq.id}/enroll` },
    });
  });

  tool("sequence_wa_sent", {
    group: G_SEQ,
    title: "Marcar WhatsApp enviado",
    description: "Fecha um passo da fila assistida: loga o toque e destrava a inscrição para o próximo passo.",
    write: true,
    danger: "escreve um toque de WhatsApp na timeline de um lead real e avança a régua — não use para teste.",
    input: { enrollment_id: z.string().describe("Inscrição em waiting.") },
  }, async ({ enrollment_id }) => {
    const antes = await http.get(`/api/sequence_enrollments/${encodeURIComponent(enrollment_id)}`);
    const depois = await http.post("/api/sequences/wa-sent", { enrollmentId: enrollment_id });
    return result({
      kind: "sequences.wa_sent",
      title: "Passo de WhatsApp marcado como enviado",
      scope: { saas: depois.saas, id: enrollment_id, lead: depois.lead },
      totals: {
        passo_antes: num(antes.stepIndex) + 1,
        passo_agora: num(depois.stepIndex) + 1,
        status: depois.status,
        proximo_em: depois.nextRunAt || null,
        concluida: depois.status === "done",
      },
      source: { endpoint: "POST /api/sequences/wa-sent" },
    });
  });

  tool("sequence_run", {
    group: G_SEQ,
    title: "Rodar motor de drip",
    description: "Roda um ciclo do motor agora em todas as sequências ativas: inscreve, envia os e-mails vencidos e aplica as saídas.",
    write: true, external: true, destructive: true,
    danger: "dispara e-mails REAIS de todas as sequências ativas e cria inscrições — é a operação mais pesada do domínio.",
    input: { confirm: z.literal(true).describe("E-mails reais serão enviados neste ciclo.") },
    hint: "o poller já roda sozinho a cada 5 minutos: só force quando precisar do resultado agora.",
  }, async ({ confirm }) => {
    if (confirm !== true) throw new Error("passe confirm=true: este ciclo envia e-mail real.");
    const r = await http.post("/api/sequences/run", {}, { timeoutMs: 300_000 });
    return result({
      kind: "sequences.run",
      title: "Ciclo do motor de drip",
      totals: {
        inscritos: num(r?.enrolled),
        emails_enviados: num(r?.sent),
        pararam_no_whatsapp: num(r?.waiting),
        sairam: num(r?.exited),
        concluiram: num(r?.done),
        rodado_em: nowIso(),
      },
      notes: [
        "o ciclo cobre TODOS os produtos com sequência ativa, não só um.",
        "sem Gmail conectado o passo de e-mail não avança: fica pendente e tenta de novo no próximo ciclo.",
      ],
      source: { endpoint: "POST /api/sequences/run" },
    });
  });

  tool("drip_templates", {
    group: G_SEQ,
    title: "Biblioteca de templates",
    description: "Conteúdo reutilizável de e-mail e WhatsApp, com os tokens que cada um usa.",
    input: {
      saas: z.string().optional(),
      channel: z.enum(["email", "whatsapp", "any"]).optional().describe("Padrão any."),
      q: z.string().optional(),
      full: z.boolean().optional().describe("Texto inteiro em vez da prévia."),
      limit: z.number().int().optional(),
    },
  }, async ({ saas, channel = "any", q, full = false, limit = 50 }) => {
    const product = await resolveProduct(saas);
    const list = (await http.get("/api/drip_templates", { saas: product.id, channel: channel === "any" ? undefined : channel })) || [];
    const rows = list.map((t) => ({
      id: t.id,
      nome: t.name || "sem nome",
      canal: t.channel || "email",
      assunto: t.subject || "",
      previa: full ? (t.body || t.text || "") : corta(t.body || t.text, 160),
      tokens: tokensUsados(t.subject || "", t.body || "", t.text || ""),
    }));
    const s = select(rows, { q, qFields: ["nome", "assunto", "previa"], sort: "nome", limit });
    return result({
      kind: "sequences.templates",
      title: `Templates · ${product.name || product.id}`,
      scope: { saas: product.id },
      totals: {
        templates: rows.length,
        email: rows.filter((r) => r.canal === "email").length,
        whatsapp: rows.filter((r) => r.canal === "whatsapp").length,
      },
      columns: COLS.templates,
      rows: s.rows,
      rowsLabel: "Templates",
      page: s.page,
      notes: ["o passo COPIA o conteúdo do template quando é escolhido: editar o template depois não muda as sequências já montadas."],
      source: { endpoint: "GET /api/drip_templates" },
    });
  });

  tool("drip_template_save", {
    group: G_SEQ,
    title: "Salvar ou apagar template",
    description: "Cria, edita ou apaga um template da biblioteca; não altera sequências já montadas.",
    write: true, destructive: true,
    input: {
      action: z.enum(["create", "update", "delete"]).optional().describe("Padrão create sem template_id, update com."),
      saas: z.string().optional(),
      template_id: z.string().optional().describe("Obrigatório em update/delete."),
      name: z.string().optional(),
      channel: z.enum(["email", "whatsapp"]).optional().describe("Padrão email."),
      subject: z.string().optional().describe("Só e-mail."),
      body: z.string().optional().describe("Só e-mail."),
      text: z.string().optional().describe("Só whatsapp."),
    },
  }, async ({ action, saas, template_id, name, channel, subject, body, text }) => {
    const act = action || (template_id ? "update" : "create");
    if (act !== "create" && !template_id) throw new Error(`action=${act} exige template_id.`);
    if (act === "delete") {
      await http.del(`/api/drip_templates/${encodeURIComponent(template_id)}`);
      return result({
        kind: "sequences.template_deleted",
        title: `Template apagado · ${template_id}`,
        source: { endpoint: `DELETE /api/drip_templates/${template_id}` },
      });
    }
    let t;
    if (act === "create") {
      const product = await resolveProduct(saas);
      if (!name) throw new Error("create exige `name`.");
      t = await http.post("/api/drip_templates", {
        name, saas: product.id, channel: channel || "email",
        subject: subject || "", body: body || "", text: text || "",
      });
    } else {
      const patch = {};
      for (const [k, v] of Object.entries({ name, channel, subject, body, text })) if (v !== undefined) patch[k] = v;
      if (!Object.keys(patch).length) throw new Error("nada pra mudar: passe name, channel, subject, body ou text.");
      t = await http.patch(`/api/drip_templates/${encodeURIComponent(template_id)}`, patch);
    }
    return result({
      kind: act === "create" ? "sequences.template_created" : "sequences.template_updated",
      title: `Template ${act === "create" ? "criado" : "atualizado"} · ${t.name || t.id}`,
      scope: { saas: t.saas, id: t.id },
      totals: { id: t.id, canal: t.channel, tokens: tokensUsados(t.subject || "", t.body || "", t.text || "") },
      detail: { assunto: t.subject || "", corpo: t.body || "", whatsapp: t.text || "" },
      source: { endpoint: act === "create" ? "POST /api/drip_templates" : `PATCH /api/drip_templates/${template_id}` },
    });
  });

  // ─────────────────────────────────────────── Outbound (radar) ─────────────

  tool("outbound_accounts", {
    group: G_OUT,
    title: "Radar de contas",
    description: "Contas-alvo do outbound por status, com a fila de trabalho e dias sem toque.",
    input: {
      saas: z.string().optional(),
      status: z.enum([...OUT_KEYS, "any"]).optional().describe("Padrão any."),
      queue: z.boolean().optional().describe("Só fria + prospectando."),
      q: z.string().optional(),
      stale_days: z.number().int().optional().describe("Sem toque há N dias ou mais."),
      limit: z.number().int().optional(),
      offset: z.number().int().optional(),
    },
  }, async ({ saas, status = "any", queue = false, q, stale_days, limit = 50, offset = 0 }) => {
    const product = await resolveProduct(saas);
    const contas = (await http.get("/api/outbound_accounts", { saas: product.id, status: status === "any" ? undefined : status })) || [];
    let rows = contas.map((a) => ({
      id: a.id,
      conta: a.name || "",
      status: a.status || "fria",
      nicho: a.niche || "",
      marketplace: a.marketplace || "",
      anuncios: a.listings || "",
      cidade: a.city || "",
      telefone: a.phone || "",
      email: a.email || "",
      instagram: a.instagram || "",
      site: a.site || "",
      dias_sem_toque: dias(a.lastTouchAt),
      ultimo_toque: a.lastTouchAt || null,
      lead_id: a.leadId || "",
      dono: a.owner || "",
      notas: corta(a.notes, 90),
      criada_em: a.createdAt || "",
    }));
    if (queue) rows = rows.filter((r) => FILA.has(r.status));
    if (stale_days != null) rows = rows.filter((r) => r.dias_sem_toque == null || r.dias_sem_toque >= stale_days);
    const s = select(rows, {
      q, qFields: ["conta", "nicho", "marketplace", "cidade", "instagram", "email"],
      sort: ["dias_sem_toque:desc", "conta"], limit, offset,
    });
    // Totais e resumo por status falam do RECORTE pedido (queue/stale_days já
    // aplicados), senão "340 contas" apareceria em cima de uma tabela de 12.
    const porStatus = OUT_KEYS.map((k) => ({
      status: k, descricao: OUT_LABEL[k],
      contas: rows.filter((r) => r.status === k).length,
    })).filter((r) => r.contas);

    return result({
      kind: "outbound.accounts",
      title: `Radar de outbound · ${product.name || product.id}`,
      scope: { saas: product.id, status, fila: queue, stale_days: stale_days ?? null },
      units: UNITS,
      totals: {
        contas: rows.length,
        contas_no_radar: contas.length,
        fila_trabalho: rows.filter((r) => FILA.has(r.status)).length,
        viraram_lead: rows.filter((r) => r.lead_id).length,
        nunca_tocadas: rows.filter((r) => !r.ultimo_toque).length,
        sem_contato: rows.filter((r) => !r.telefone && !r.email).length,
      },
      columns: COLS.contas,
      rows: s.rows,
      rowsLabel: "Contas",
      page: s.page,
      tables: { por_status: { label: "Por status", columns: ["status", "descricao", "contas"], rows: porStatus } },
      notes: [
        "régua do livro: profundo > raso (10 contas trabalhadas 10x valem mais que 100 tocadas 1x); nunca prospectar cliente da casa.",
        "conta nunca tocada aparece com dias_sem_toque vazio e entra em stale_days.",
        rows.length === contas.length ? null : `os totais falam do recorte (${rows.length}); \`contas_no_radar\` (${contas.length}) é a base antes de queue/stale_days.`,
      ].filter(Boolean),
      source: { endpoint: "GET /api/outbound_accounts" },
    });
  });

  tool("outbound_import", {
    group: G_OUT,
    title: "Importar contas no radar",
    description: "Adiciona contas-alvo em lote, por lista de objetos ou por texto colado da planilha. Pula nome repetido.",
    write: true,
    input: {
      saas: z.string().optional(),
      accounts: z.array(z.object({
        name: z.string(),
        phone: z.string().optional(), email: z.string().optional(), instagram: z.string().optional(),
        listings: z.string().optional(), niche: z.string().optional(), marketplace: z.string().optional(),
        city: z.string().optional(), site: z.string().optional(), cnpj: z.string().optional(),
        reputation: z.string().optional(), notes: z.string().optional(),
      })).optional(),
      text: z.string().optional().describe("Uma conta por linha: nome; whatsapp; email; instagram; anúncios; nicho; marketplace; cidade; site"),
      skip_duplicates: z.boolean().optional().describe("Padrão true: pula nome já existente."),
    },
    hint: "só o nome é obrigatório; o resto completa depois com outbound_update.",
  }, async ({ saas, accounts, text, skip_duplicates = true }) => {
    const product = await resolveProduct(saas);
    const doTexto = String(text || "").split("\n").map((l) => l.trim()).filter(Boolean).map((linha) => {
      const partes = linha.split(";").map((x) => (x || "").trim());
      return Object.fromEntries(IMPORT_COLS.map((c, i) => [c, partes[i] || ""]));
    });
    const lista = [...(accounts || []), ...doTexto];
    if (!lista.length) throw new Error("informe `accounts` (lista) ou `text` (uma conta por linha, campos separados por ;).");

    const existentes = (await http.get("/api/outbound_accounts", { saas: product.id })) || [];
    const nomes = new Set(existentes.map((a) => String(a.name || "").trim().toLowerCase()));
    const rows = [];
    for (const a of lista) {
      const nome = String(a.name || "").trim();
      if (!nome) { rows.push({ conta: "(sem nome)", id: null, ok: false, motivo: "sem nome" }); continue; }
      if (skip_duplicates && nomes.has(nome.toLowerCase())) { rows.push({ conta: nome, id: null, ok: false, motivo: "já está no radar" }); continue; }
      try {
        const criada = await http.post("/api/outbound_accounts", {
          saas: product.id, name: nome,
          phone: a.phone || "", email: a.email || "", instagram: a.instagram || "",
          listings: a.listings || "", niche: a.niche || "", marketplace: a.marketplace || "",
          city: a.city || "", site: a.site || "", cnpj: a.cnpj || "", reputation: a.reputation || "",
          notes: a.notes || "", status: "fria", createdAt: nowIso(),
        });
        nomes.add(nome.toLowerCase());
        rows.push({ conta: nome, id: criada.id, ok: true, motivo: null });
      } catch (e) {
        // Falha de uma linha não pode derrubar o lote: o relatório diz quais entraram.
        rows.push({ conta: nome, id: null, ok: false, motivo: e.message });
      }
    }
    return result({
      kind: "outbound.import",
      title: `Importação no radar · ${product.name || product.id}`,
      scope: { saas: product.id },
      totals: {
        pedidos: lista.length,
        criadas: rows.filter((r) => r.ok).length,
        duplicadas: rows.filter((r) => r.motivo === "já está no radar").length,
        sem_nome: rows.filter((r) => r.motivo === "sem nome").length,
        falhas: rows.filter((r) => !r.ok && r.motivo && !["já está no radar", "sem nome"].includes(r.motivo)).length,
      },
      columns: ["conta", "id", "ok", "motivo"],
      rows,
      rowsLabel: "Contas",
      notes: ["toda conta nasce com status fria e sem toque: quem trabalha a fila é o SDR."],
      source: { endpoint: "POST /api/outbound_accounts" },
    });
  });

  tool("outbound_update", {
    group: G_OUT,
    title: "Atualizar conta do radar",
    description: "Muda status, notas, dono ou contato de uma conta-alvo; mark_touch carimba o toque e promove fria.",
    write: true,
    input: {
      account_id: z.string(),
      status: z.enum(OUT_KEYS).optional(),
      mark_touch: z.boolean().optional().describe("Toque agora; promove fria → prospectando."),
      notes: z.string().optional(),
      owner: z.string().optional().describe("id do SDR."),
      name: z.string().optional(),
      phone: z.string().optional(), email: z.string().optional(), instagram: z.string().optional(),
      niche: z.string().optional(), marketplace: z.string().optional(), listings: z.string().optional(),
      city: z.string().optional(), site: z.string().optional(), cnpj: z.string().optional(), reputation: z.string().optional(),
    },
  }, async ({ account_id, status, mark_touch, ...campos }) => {
    const antes = await http.get(`/api/outbound_accounts/${encodeURIComponent(account_id)}`);
    const patch = {};
    for (const [k, v] of Object.entries(campos)) if (v !== undefined) patch[k] = v;
    if (status) patch.status = status;
    if (mark_touch) {
      patch.lastTouchAt = nowIso();
      if (!status && (!antes.status || antes.status === "fria")) patch.status = "prospectando";
    }
    if (!Object.keys(patch).length) throw new Error("nada pra mudar: passe status, notes, owner, mark_touch ou um campo de contato.");
    const a = await http.patch(`/api/outbound_accounts/${encodeURIComponent(account_id)}`, patch);
    return result({
      kind: "outbound.account_updated",
      title: `Conta atualizada · ${a.name || a.id}`,
      scope: { saas: a.saas, id: a.id },
      units: UNITS,
      totals: {
        status_antes: antes.status || "fria",
        status: a.status || "fria",
        ultimo_toque: a.lastTouchAt || null,
        dias_sem_toque: dias(a.lastTouchAt),
        lead_id: a.leadId || null,
      },
      source: { endpoint: `PATCH /api/outbound_accounts/${account_id}` },
    });
  });

  tool("outbound_to_lead", {
    group: G_OUT,
    title: "Virar lead",
    description: "Converte uma conta do radar em lead do pipeline e marca a conta como oportunidade ativa.",
    write: true, destructive: true,
    danger: "cria um card real no pipeline, com dono e cadência automáticos — e a conta sai da fila de prospecção.",
    input: {
      account_id: z.string(),
      confirm: z.literal(true).describe("Um lead novo entra no pipeline."),
    },
  }, async ({ account_id, confirm }) => {
    if (confirm !== true) throw new Error("passe confirm=true: isto cria um lead real no pipeline.");
    const acc = await http.get(`/api/outbound_accounts/${encodeURIComponent(account_id)}`);
    if (acc.leadId) {
      const lead = await http.get(`/api/leads/${encodeURIComponent(acc.leadId)}`).catch(() => null);
      return result({
        kind: "outbound.to_lead",
        title: `Conta já convertida · ${acc.name || acc.id}`,
        scope: { saas: acc.saas, id: acc.id, lead: acc.leadId },
        totals: { ja_convertida: true, lead_id: acc.leadId, etapa: lead?.stage || null, dono: lead?.owner || null },
        notes: ["nada foi criado: a conta já aponta para um lead. Use as tools de pipeline para trabalhar o card."],
        source: { endpoint: `GET /api/outbound_accounts/${account_id}` },
      });
    }
    // Mesma carga da tela: `source` + `outbound` são o que carimba a classe
    // ALVO nas métricas (leadClassOf, metrics-core).
    const lead = await http.post("/api/leads", {
      saas: acc.saas,
      name: acc.name || "",
      company: acc.name || "",
      phone: acc.phone || "",
      email: acc.email || "",
      niche: acc.niche || "",
      listings: acc.listings || "",
      sourceUrl: acc.site || "",
      source: "Outbound · radar",
      outbound: true,
      comments: [acc.marketplace && `marketplace: ${acc.marketplace}`, acc.instagram && `IG: ${acc.instagram}`, acc.notes].filter(Boolean).join(" · "),
    });
    const a = await http.patch(`/api/outbound_accounts/${encodeURIComponent(account_id)}`, {
      status: "oportunidade", leadId: lead?.id || "", lastTouchAt: nowIso(),
    });
    return result({
      kind: "outbound.to_lead",
      title: `Conta virou lead · ${acc.name || acc.id}`,
      scope: { saas: acc.saas, id: acc.id, lead: lead?.id },
      totals: {
        lead_id: lead?.id || null,
        etapa: lead?.stage || "",
        dono: lead?.owner || "",
        classe: "alvo (outbound)",
        status_conta: a.status,
      },
      detail: { nome: lead?.name, empresa: lead?.company, telefone: lead?.phone, email: lead?.email, source: lead?.source },
      notes: ["o lead nasce com dono e próximo toque pela cadência do estágio de entrada — o SDR já o vê na fila."],
      source: { endpoint: "POST /api/leads + PATCH /api/outbound_accounts/:id" },
    });
  });

  tool("outbound_funnel", {
    group: G_OUT,
    title: "Funil do outbound",
    description: "Do radar ao dinheiro: contas tocadas, quantas viraram lead, em que etapa estão e quanto fecharam.",
    input: {
      saas: z.string().optional(),
      ...periodInput(z),
      limit: z.number().int().optional(),
    },
  }, async ({ saas, period, since, until, limit = 50 }) => {
    const product = await resolveProduct(saas);
    // Radar é acumulado: a leitura padrão é a base inteira, não os últimos 30d.
    const p = resolvePeriod({ period: period || "all", since, until });
    const [contas, leads] = await Promise.all([
      http.get("/api/outbound_accounts", { saas: product.id }),
      leadsDo(product.id),
    ]);
    const naJanela = (contas || []).filter((a) => !a.createdAt || (a.createdAt.slice(0, 10) >= p.since && a.createdAt.slice(0, 10) <= p.until));
    const byId = porId(leads);
    const rows = naJanela.map((a) => {
      const l = a.leadId ? byId.get(a.leadId) : null;
      const ganho = l ? kindOf(product, l.stage) === "ganho" : false;
      return {
        conta: a.name || "",
        conta_id: a.id,
        status_conta: a.status || "fria",
        lead_id: a.leadId || "",
        etapa_lead: l?.stage || "",
        dono: l?.owner || "",
        valor: l ? num(l.amount) : null,
        ganho,
        dias_sem_toque: dias(a.lastTouchAt),
      };
    });
    const s = select(rows, { sort: ["ganho:desc", "valor:desc"], limit });
    const viraram = rows.filter((r) => r.lead_id);
    const ganhos = viraram.filter((r) => r.ganho);
    return result({
      kind: "outbound.funnel",
      title: `Funil do outbound · ${product.name || product.id}`,
      scope: { saas: product.id },
      period: p,
      units: UNITS,
      totals: {
        contas: rows.length,
        tocadas: naJanela.filter((a) => a.lastTouchAt).length,
        viraram_lead: viraram.length,
        taxa_conversao: pct(viraram.length, rows.length),
        ganhos: ganhos.length,
        taxa_ganho: pct(ganhos.length, viraram.length),
        receita: round2(ganhos.reduce((a, r) => a + num(r.valor), 0)),
      },
      columns: COLS.funilOut,
      rows: s.rows,
      rowsLabel: "Contas",
      page: s.page,
      tables: {
        por_status: { label: "Contas por status", columns: ["status_conta", "contas"], rows: groupBy(rows, { by: "status_conta", count: "contas", label: "status_conta" }).sort((a, b) => b.contas - a.contas) },
        leads_por_etapa: { label: "Leads gerados, por etapa", columns: ["etapa_lead", "leads"], rows: groupBy(viraram, { by: "etapa_lead", count: "leads", label: "etapa_lead" }).sort((a, b) => b.leads - a.leads) },
      },
      notes: [
        "o período recorta pela criação da CONTA; conta sem createdAt (registro antigo) entra sempre, pra não sumir do total.",
        "`receita` soma o valor dos leads em etapa de ganho — é o valor gravado no card, não a receita reconhecida no financeiro.",
        "conta que virou lead e depois teve o lead apagado aparece com etapa vazia.",
      ],
      source: { endpoint: "GET /api/outbound_accounts + GET /api/leads" },
    });
  });

  tool("outbound_overview", {
    group: G_OUT,
    title: "Panorama disparos e outbound",
    description: "Campanhas, sequências, fila de WhatsApp, radar e descadastro do produto, tudo somado.",
    input: { saas: z.string().optional() },
  }, async ({ saas }) => {
    const product = await resolveProduct(saas);
    const [campMetrics, seqMetrics, ens, contas, camps, leads] = await Promise.all([
      http.get(`/api/campaigns/metrics/${encodeURIComponent(product.id)}`),
      http.get(`/api/sequences/metrics/${encodeURIComponent(product.id)}`),
      http.get("/api/sequence_enrollments", { saas: product.id }),
      http.get("/api/outbound_accounts", { saas: product.id }),
      http.get("/api/campaigns", { saas: product.id }),
      leadsDo(product.id),
    ]);
    const cm = campMetrics?.campaigns || [];
    const sm = seqMetrics?.sequences || [];
    const soma = (rows, k) => rows.reduce((a, x) => a + num(x[k]), 0);
    const esperando = (ens || []).filter((e) => e.status === "waiting");
    const comEmail = leads.filter((l) => l.email);
    const fora = comEmail.filter((l) => l.emailOptOut);
    const enviados = soma(cm, "sent");
    const inscritos = soma(sm, "enrolled");

    const topCamp = [...cm].sort((a, b) => num(b.won) - num(a.won) || num(b.sent) - num(a.sent)).slice(0, 5)
      .map((c) => ({ id: c.id, campanha: c.name || "sem nome", enviados: num(c.sent), fechou: num(c.won), taxa_ganho: pct(c.won, c.sent) }));
    const topSeq = [...sm].sort((a, b) => num(b.won) - num(a.won) || num(b.enrolled) - num(a.enrolled)).slice(0, 5)
      .map((s) => ({ id: s.id, sequencia: s.name || "sem nome", status: s.status, inscritos: num(s.enrolled), fechou: num(s.won), taxa_ganho: pct(s.won, s.enrolled) }));

    return result({
      kind: "outbound.overview",
      title: `Máquina de contato · ${product.name || product.id}`,
      scope: { saas: product.id },
      units: UNITS,
      totals: {
        campanhas: (camps || []).length,
        disparos_enviados: enviados,
        disparos_fechou: soma(cm, "won"),
        disparos_taxa_ganho: pct(soma(cm, "won"), enviados),
        sequencias: sm.length,
        sequencias_ativas: sm.filter((s) => s.status === "active").length,
        inscritos: inscritos,
        sequencias_fechou: soma(sm, "won"),
        sequencias_taxa_ganho: pct(soma(sm, "won"), inscritos),
        fila_whatsapp: esperando.length,
        espera_mais_antiga_dias: esperando.reduce((a, e) => Math.max(a, num(dias(e.lastAt || e.enrolledAt))), 0) || null,
        radar_contas: (contas || []).length,
        radar_fila: (contas || []).filter((a) => FILA.has(a.status || "fria")).length,
        radar_viraram_lead: (contas || []).filter((a) => a.leadId).length,
        descadastrados: fora.length,
        taxa_optout: pct(fora.length, comEmail.length),
      },
      tables: {
        campanhas: { label: "Top campanhas", columns: ["campanha", "enviados", "fechou", "taxa_ganho", "id"], rows: topCamp, units: UNITS },
        sequencias: { label: "Top sequências", columns: ["sequencia", "status", "inscritos", "fechou", "taxa_ganho", "id"], rows: topSeq, units: UNITS },
      },
      notes: [
        `conversão atribuída por janela de ${ATTR_DIAS} dias após o envio/inscrição.`,
        "números acumulados desde sempre: os endpoints de métrica deste domínio não aceitam período.",
        esperando.length ? `${esperando.length} passo(s) de WhatsApp parados esperando o operador — veja sequences_enrollments.` : null,
      ].filter(Boolean),
      source: { endpoint: "GET /api/campaigns/metrics/:saas + /api/sequences/metrics/:saas + coleções do domínio" },
    });
  });
}
