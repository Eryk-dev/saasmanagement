// WhatsApp (tela "Inbox") — a caixa de entrada inteira, que era invisível pro
// MCP: `wa_threads` e `wa_messages` são coleções PRIVADAS (routes.js), então
// nem list_records enxergava uma conversa.
//
// Três cuidados moldam este arquivo:
//
//  1. Mensagem é a maior coleção do módulo e a API devolve a thread INTEIRA sem
//     paginação — quem recorta é aqui, e o recorte é dito em voz alta (`page`).
//  2. A janela de 24h da Meta não é campo de nenhuma tabela: nasce da ÚLTIMA
//     mensagem recebida. Sem ela, texto livre é recusado (131047) e só template
//     aprovado passa — por isso toda leitura de conversa já responde "dá pra
//     mandar texto agora?".
//  3. Enviar fala com pessoa de verdade, custa dinheiro (template é a mensagem
//     cobrada) e MOVE o card no funil (markFirstContact → onOutboundMessage).
//     Nenhuma tool aqui adivinha destinatário: ou vem o id da conversa, ou vem
//     o id do lead, explícito.

import { z } from "zod";
import { http } from "../core/http.js";
import { resolveProduct } from "../core/products.js";
import { resolvePeriod, periodInput, delta, today, daysBetween } from "../core/period.js";
import { result } from "../core/envelope.js";
import { select, round2, num } from "../core/shape.js";

const HORA_MS = 3_600_000;
const JANELA_MS = 24 * HORA_MS;

const UNITS = {
  cost: "BRL", custo: "BRL",
  esperaHoras: "h", oldestWaitHours: "h", horasEspera: "h", idadeHoras: "h", maisAntigoHoras: "h", duracaoSeg: "s",
  medianReplyMinutes: "min", answeredRate: "%", conversaoForm: "%", atrasoDo1oToqueMin: "min",
};

const COLS = {
  threads: ["id", "name", "company", "stage", "status", "lastDir", "lastAt", "esperaHoras", "janela24h", "unread", "robo", "callAt", "leadId", "saas", "lastText"],
  mensagens: ["at", "direction", "author", "status", "text", "midia", "errorCode", "error", "id"],
  alertas: ["id", "kind", "name", "company", "stage", "thread", "idadeHoras", "at", "text", "leadId", "saas"],
  templates: ["name", "language", "category", "params", "header", "body"],
  regras: ["id", "name", "active", "trigger", "keyword", "cooldownHours", "reply"],
  fluxos: ["id", "name", "active", "gatilho", "palavra", "passos", "perguntas"],
  sdrTemplates: ["name", "category", "estado", "approved", "event", "body"],
  comparativo: ["metrica", "atual", "anterior", "variacao", "variacao_pct"],
};

// Qualidade e limite do número na língua da operação: "GREEN"/"TIER_1K" não
// dizem nada pra quem lê o relatório.
const QUALIDADE = { GREEN: "verde (boa)", YELLOW: "amarela (atenção)", RED: "vermelha (risco)" };
const TIER = {
  TIER_50: "50 conversas/dia", TIER_250: "250 conversas/dia", TIER_1K: "1 mil conversas/dia",
  TIER_10K: "10 mil conversas/dia", TIER_100K: "100 mil conversas/dia", TIER_UNLIMITED: "sem limite",
};
// Diagnóstico do `reason` que /api/whatsapp/number devolve dentro do corpo.
const DIAGNOSTICO = {
  no_number_for_saas: "esse produto não tem número próprio (waPhoneId) — configure em Ajustes → Integrações.",
  not_configured: "WhatsApp não configurado no servidor (WHATSAPP_TOKEN + número).",
  no_read_permission: "o token não tem whatsapp_business_management: LER os dados do número falha, mas ENVIAR continua funcionando.",
  wrong_id: "o id configurado é o da CONTA (WABA), não o do número — troque por um dos phone number ids listados.",
  meta_error: "a Meta recusou a leitura do número.",
};

const so = (s) => String(s ?? "");
const digitos = (s) => so(s).replace(/\D/g, "");
const horasDesde = (iso) => {
  const t = new Date(iso || 0).getTime();
  return Number.isFinite(t) && t > 0 ? round2((Date.now() - t) / HORA_MS) : null;
};

// Id da conversa = telefone em dígitos (a API resolve qualquer grafia, com ou
// sem o nono dígito). Erro cedo aqui evita um POST de envio no vazio.
function threadKey(v, campo = "thread") {
  const d = digitos(v);
  if (d.length < 8) throw new Error(`\`${campo}\` inválido: "${v}". Use o id da conversa (só dígitos, com DDI) que vem em wa_threads.`);
  return d;
}

// Robô × humano, a mesma régua da tela: handoff pedido vence, senão é "robô"
// enquanto o último out foi dele (humano responder tira sozinho).
const roboDe = (t) => (t.sdrHandoffAt ? "handoff" : t.lastOutAuthor === "sdr-bot" ? "robo" : "");
const aberta = (t) => (t.status || "open") !== "closed";

// Escopo do inbox por produto, igual à tela: conversa do produto; órfã (sem
// saas) só entra se corre pelo número deste produto ou não tem número marcado.
const doProduto = (t, product) => {
  if (!product?.id) return true;
  if (t.saas) return t.saas === product.id;
  if (t.waPhoneId && product.waPhoneId) return t.waPhoneId === product.waPhoneId;
  return true;
};

function linhaThread(t) {
  const espera = t.lastDir === "in" ? horasDesde(t.lastAt) : null;
  return {
    id: t.id,
    name: t.name || "",
    company: t.company || "",
    stage: t.stage || "",
    status: t.status || "open",
    lastDir: t.lastDir || "",
    lastAt: t.lastAt || "",
    esperaHoras: espera,
    // Só dá pra afirmar a janela quando a ÚLTIMA mensagem é dela: se o último
    // foi nosso, o inbound anterior não vem na listagem (use wa_thread).
    janela24h: t.lastDir === "in" ? (espera != null && espera < 24 ? "aberta" : "fechada") : "?",
    unread: num(t.unread),
    robo: roboDe(t),
    callAt: t.callAt || "",
    leadId: t.leadId || null,
    saas: t.saas || "",
    lastText: t.lastText || "",
    phone: t.phone || "",
    waPhoneId: t.waPhoneId || "",
    sdrHandoffAt: t.sdrHandoffAt || "",
  };
}

export function registerWhatsappTools(tool) {
  const GRUPO = "WhatsApp (Inbox)";

  // ── Leitura ───────────────────────────────────────────────────────────────

  tool("wa_threads", {
    group: GRUPO,
    title: "Caixa de entrada",
    description: "Conversas do WhatsApp: quem espera resposta, não lidos, lead ligado e estado do robô.",
    input: {
      saas: z.string().optional(),
      filter: z.enum(["all", "awaiting", "answered", "bot", "handoff", "closed", "orphan", "unread"]).optional()
        .describe("awaiting = cliente por último; answered = nós; orphan = sem lead. Padrão all (só abertas)."),
      q: z.string().optional(),
      ...periodInput(z),
      sort: z.string().optional().describe("Padrão lastAt:desc. Ex.: esperaHoras:desc."),
      limit: z.number().int().optional().describe("Padrão 30."),
      offset: z.number().int().optional(),
    },
    hint: "se vier vazio, confira o produto em `saas` — a listagem da API traz as conversas de todos os números.",
  }, async ({ saas, filter = "all", q, period, since, until, sort = "lastAt:desc", limit = 30, offset = 0 }) => {
    const product = saas ? await resolveProduct(saas) : null;
    const { threads = [] } = await http.get("/api/whatsapp/threads");
    const base = threads.filter((t) => doProduto(t, product)).map(linhaThread);

    // Período é OPCIONAL aqui: a caixa de entrada é estado, não janela. Só
    // filtra por última mensagem quando quem chamou pediu explicitamente.
    const p = period || since || until ? resolvePeriod({ period, since, until }) : null;
    const naJanela = p ? base.filter((t) => so(t.lastAt).slice(0, 10) >= p.since && so(t.lastAt).slice(0, 10) <= p.until) : base;

    const abertas = naJanela.filter((t) => t.status !== "closed");
    const counts = {
      conversas: naJanela.length,
      abertas: abertas.length,
      esperando: abertas.filter((t) => t.lastDir === "in").length,
      respondidas: abertas.filter((t) => t.lastDir === "out").length,
      robo: abertas.filter((t) => t.robo === "robo").length,
      handoff: abertas.filter((t) => t.robo === "handoff").length,
      encerradas: naJanela.length - abertas.length,
      semLead: naJanela.filter((t) => !t.leadId).length,
      naoLidas: naJanela.reduce((a, t) => a + num(t.unread), 0),
    };

    const filtrada = {
      all: () => abertas,
      awaiting: () => abertas.filter((t) => t.lastDir === "in"),
      answered: () => abertas.filter((t) => t.lastDir === "out"),
      bot: () => abertas.filter((t) => t.robo === "robo"),
      handoff: () => abertas.filter((t) => t.robo === "handoff"),
      closed: () => naJanela.filter((t) => t.status === "closed"),
      orphan: () => abertas.filter((t) => !t.leadId),
      unread: () => abertas.filter((t) => num(t.unread) > 0),
    }[filter]();

    const s = select(filtrada, { q, qFields: ["name", "company", "phone", "id"], sort, limit, offset });
    return result({
      kind: "wa.threads",
      title: `Caixa de entrada${product ? ` · ${product.name || product.id}` : ""} (${filter})`,
      scope: { saas: product?.id || "todos", filter },
      period: p || undefined,
      units: UNITS,
      totals: counts,
      columns: COLS.threads,
      rows: s.rows,
      rowsLabel: "Conversas",
      page: s.page,
      notes: [
        "encerradas ficam fora de todas as contagens vivas (mensagem nova do lead reabre sozinha).",
        "janela24h só é afirmável quando a última mensagem foi DELE; com o último out o inbound anterior não vem nesta lista — use wa_thread.",
      ],
      source: { endpoint: "GET /api/whatsapp/threads" },
    });
  });

  tool("wa_thread", {
    group: GRUPO,
    title: "Conversa completa",
    description: "Histórico paginado de uma conversa, com janela de 24h, falhas de entrega e autor de cada mensagem.",
    input: {
      thread: z.string().describe("Id da conversa ou telefone em qualquer grafia."),
      limit: z.number().int().optional().describe("Da MAIS RECENTE (padrão 50)."),
      offset: z.number().int().optional().describe("Paginação para trás."),
      direction: z.enum(["in", "out", "all"]).optional().describe("Padrão all."),
      q: z.string().optional(),
      order: z.enum(["asc", "desc"]).optional().describe("Padrão asc (leitura natural)."),
    },
    hint: "o id da conversa é o telefone em dígitos com DDI (ex.: 5511999999999) — pegue em wa_threads.",
  }, async ({ thread, limit = 50, offset = 0, direction = "all", q, order = "asc" }) => {
    const tid = threadKey(thread);
    const [data, lista] = await Promise.all([
      http.get(`/api/whatsapp/threads/${encodeURIComponent(tid)}`),
      // Cabeçalho (lead, etapa, não lidos): perder isso não pode derrubar a leitura.
      http.get("/api/whatsapp/threads").catch(() => ({ threads: [] })),
    ]);
    const msgs = data.messages || [];
    const canon = data.thread || tid;
    const meta = (lista.threads || []).find((t) => t.id === canon) || null;

    const ultimoIn = [...msgs].reverse().find((m) => m.direction === "in");
    // Data quebrada/vazia numa mensagem antiga não pode derrubar a leitura da
    // conversa inteira (new Date(NaN).toISOString() lança).
    const ultimoInMs = ultimoIn ? new Date(ultimoIn.at || 0).getTime() : NaN;
    const janelaAte = Number.isFinite(ultimoInMs) && ultimoInMs > 0 ? new Date(ultimoInMs + JANELA_MS).toISOString() : null;
    const janelaAberta = !!janelaAte && Date.parse(janelaAte) > Date.now();

    const linhas = msgs.map((m) => ({
      at: m.at || "",
      direction: m.direction || "",
      author: m.author || "",
      status: m.status || "",
      text: m.text || "",
      midia: m.media?.kind || "",
      errorCode: m.errorCode ?? null,
      error: m.error || "",
      id: m.id,
      leadId: m.leadId || null,
    }));

    // Recorte pela ponta NOVA: quem lê uma conversa quer o fim dela.
    const filtradas = linhas.filter((m) => (direction === "all" || m.direction === direction));
    const s = select(filtradas, { q, qFields: ["text", "author"], sort: "at:desc", limit, offset });
    const pagina = order === "desc" ? s.rows : [...s.rows].reverse();

    const AUTOMACAO = new Set(["sdr-bot", "automacao", "fluxo-ligacao"]);
    const totals = {
      mensagens: msgs.length,
      recebidas: msgs.filter((m) => m.direction === "in").length,
      enviadas: msgs.filter((m) => m.direction === "out").length,
      falhas: msgs.filter((m) => m.status === "failed").length,
      automaticas: msgs.filter((m) => AUTOMACAO.has(m.author)).length,
      comMidia: msgs.filter((m) => m.media?.kind).length,
      naoLidas: num(meta?.unread),
      janela24hAberta: janelaAberta,
      janelaFechaEm: janelaAte || null,
      primeiraFoiDele: msgs[0]?.direction === "in",
    };

    const falhas = linhas.filter((m) => m.status === "failed");
    return result({
      kind: "wa.thread",
      title: `Conversa ${canon}${meta?.name ? ` · ${meta.name}` : ""}`,
      scope: {
        thread: canon, lead: meta?.leadId || null, saas: meta?.saas || "",
        etapa: meta?.stage || "", status: meta?.status || "", robo: meta ? roboDe(meta) : "",
      },
      units: UNITS,
      totals,
      columns: COLS.mensagens,
      rows: pagina,
      rowsLabel: "Mensagens",
      page: s.page,
      tables: falhas.length ? { falhas: { label: "Entregas recusadas pela Meta", columns: ["at", "errorCode", "error", "text"], rows: falhas } } : undefined,
      notes: [
        janelaAberta
          ? `janela de 24h ABERTA até ${janelaAte} — texto livre (wa_send) passa.`
          : "janela de 24h FECHADA: a Meta só aceita template aprovado (wa_send_template).",
        "o binário de áudio/imagem não passa pelo MCP — a bolha é servida em GET /api/whatsapp/media/:id (mensagem), aqui vem só o TIPO da mídia; nota de voz recebida não é transcrita em lugar nenhum, então não há texto dela.",
      ],
      source: { endpoint: `GET /api/whatsapp/threads/${canon}` },
    });
  });

  tool("wa_insights", {
    group: GRUPO,
    title: "Relatório do inbox",
    description: "Volume, quem espera, tempo de resposta, janelas de 24h, conversão form→WhatsApp, custo na Meta e saúde da conta, no período.",
    // O custo sai do pricing_analytics da Meta (cache de 10 min no servidor):
    // a leitura sai pra fora, mesmo que o resto venha do banco.
    external: true,
    input: {
      ...periodInput(z),
      compare: z.boolean().optional().describe("Compara com a janela anterior (padrão true)."),
    },
  }, async ({ period, since, until, compare = true }) => {
    // A API só aceita janela CORRIDA (?days=N, terminando hoje): traduzimos o
    // período pedido e avisamos quando ele teve que ser esticado até hoje.
    const p = resolvePeriod({ period, since, until });
    const hoje = today();
    const days = Math.min(365, Math.max(1, daysBetween(p.since, hoje)));
    const atual = await http.get("/api/whatsapp/insights", { days });

    let anterior = null;
    if (compare && days * 2 <= 365) {
      try {
        const dobro = await http.get("/api/whatsapp/insights", { days: days * 2 });
        // Métricas ADITIVAS só: mediana e taxas não se subtraem.
        anterior = {
          inbound: num(dobro.inbound) - num(atual.inbound),
          outbound: num(dobro.outbound) - num(atual.outbound),
          newThreads: num(dobro.newThreads) - num(atual.newThreads),
        };
      } catch { /* comparação é bônus */ }
    }

    const form = atual.form || null;
    const conversaoForm = form?.formLeads ? round2((form.formStarted / form.formLeads) * 100) : null;
    const saude = atual.health || {};

    const totals = {
      conversas: num(atual.threads),
      ativasNoPeriodo: num(atual.activeThreads),
      novasNoPeriodo: num(atual.newThreads),
      recebidas: num(atual.inbound),
      enviadas: num(atual.outbound),
      esperandoResposta: num(atual.awaiting),
      oldestWaitHours: atual.oldestWaitHours ?? null,
      naoLidas: num(atual.unread),
      medianReplyMinutes: atual.medianReplyMinutes ?? null,
      replySample: num(atual.replySample),
      answeredRate: atual.answeredRate ?? null,
      janelas24hAbertas: num(atual.openWindow),
      comLead: num(atual.withLead),
      semLead: num(atual.withoutLead),
      conversaoForm,
      cost: atual.costs?.cost ?? null,
      mensagensCobradas: atual.costs?.messages ?? null,
      saude: saude.level || "?",
    };

    const tables = {};
    if (anterior) {
      tables.comparativo = {
        label: `Volume vs janela anterior (${days} dias antes)`,
        columns: COLS.comparativo,
        rows: [["recebidas", "inbound"], ["enviadas", "outbound"], ["novas conversas", "newThreads"]]
          .map(([rotulo, k]) => {
            const d = delta(num(atual[k]), num(anterior[k]));
            return d && { metrica: rotulo, atual: d.current, anterior: d.previous, variacao: d.abs, variacao_pct: d.pct };
          }).filter(Boolean),
      };
    }
    if (saude.messages?.length) {
      tables.alertasSaude = { label: `Saúde da conta (${saude.level})`, columns: ["aviso"], rows: saude.messages.map((m) => ({ aviso: m })) };
    }
    const tpls = Object.entries(saude.templates || {});
    if (tpls.length) {
      tables.templates = {
        label: "Templates com evento da Meta",
        columns: ["template", "status", "quality", "reason", "at"],
        rows: tpls.map(([name, t]) => ({ template: name, status: t.status || "", quality: t.quality || "", reason: t.reason || "", at: t.at || "" })),
      };
    }
    if (form) {
      tables.form = {
        label: "Form → WhatsApp (quem preencheu e mandou mensagem)",
        columns: ["formLeads", "formStarted", "conversaoForm"],
        rows: [{ formLeads: form.formLeads, formStarted: form.formStarted, conversaoForm }],
      };
    }

    const notes = [
      "esperandoResposta, janelas24hAbertas, naoLidas e oldestWaitHours são ESTADO DE AGORA, não do período — é o que muda a ação do dia.",
      "answeredRate usa todas as conversas como base (inclusive as antigas), não só as do período.",
      "custo vem da Meta (pricing_analytics) com cache de 10 min no servidor; vazio = sem permissão no token.",
    ];
    if (p.until < hoje) notes.push(`a API só entrega janela corrida terminando hoje: o pedido ia até ${p.until} e foi lido como os últimos ${days} dias.`);
    if (!atual.costs) notes.push("custo indisponível nesta leitura (sem permissão de management ou fora do cache).");

    return result({
      kind: "wa.insights",
      title: "Relatório do WhatsApp",
      period: { ...p, label: `últimos ${days} dias (janela corrida)` },
      units: UNITS,
      totals,
      tables,
      notes,
      source: { endpoint: `GET /api/whatsapp/insights?days=${days}`, saudeAtualizadaEm: saude.updatedAt || null },
    });
  });

  tool("wa_number", {
    group: GRUPO,
    title: "Saúde do número",
    description: "Número do produto lido ao vivo na Meta: qualidade, limite diário, throughput e entrega do webhook.",
    external: true,
    input: {
      saas: z.string().optional(),
      include_health: z.boolean().optional().describe("Junta eventos de saúde dos webhooks (padrão true)."),
    },
    hint: "reason=wrong_id significa que o id configurado é o da conta (WABA), não o do número.",
  }, async ({ saas, include_health = true }) => {
    const product = saas ? await resolveProduct(saas) : null;
    const [n, ins] = await Promise.all([
      http.get("/api/whatsapp/number", { saas: product?.id }),
      include_health ? http.get("/api/whatsapp/insights", { days: 1 }).catch(() => null) : null,
    ]);
    const saude = ins?.health || {};
    const webhook = n.webhook || saude.webhook || {};

    const totals = {
      ok: !!n.ok,
      display: n.display || webhook.display || "",
      nome: n.name || "",
      phoneNumberId: n.phoneNumberId || webhook.phoneNumberId || "",
      qualidade: QUALIDADE[so(n.quality).toUpperCase()] || n.quality || "",
      limiteDiario: TIER[so(n.tier).toUpperCase()] || n.tier || "",
      throughput: n.throughput || "",
      registradoNaCloudApi: n.platform ? n.platform === "CLOUD_API" : null,
      ultimaEntregaDoWebhook: webhook.at || "",
      wabaId: webhook.wabaId || "",
      saude: saude.level || "?",
    };

    const tables = {};
    if (saude.messages?.length) tables.avisos = { label: "Avisos de saúde", columns: ["aviso"], rows: saude.messages.map((m) => ({ aviso: m })) };
    if (n.numbers?.length) tables.numeros = { label: "Números disponíveis na conta (use um destes ids)", columns: ["id", "display", "name"], rows: n.numbers };
    if (saude.account?.event) tables.conta = { label: "Evento da conta (WABA)", columns: ["event", "detail", "at"], rows: [saude.account] };

    const notes = [];
    if (!n.ok) notes.push(`${n.reason}: ${DIAGNOSTICO[n.reason] || n.error || "a Meta não devolveu os dados do número."}`);
    if (n.error) notes.push(`Meta: ${n.error}`);
    if (!webhook.at) notes.push("nenhuma entrega registrada do webhook: a Meta pode não estar apontando pra este servidor.");
    if (n.platform && n.platform !== "CLOUD_API") notes.push(`platform_type = ${n.platform}: o número não está registrado na Cloud API, envio não funciona.`);

    return result({
      kind: "wa.number",
      title: `Número do WhatsApp${product ? ` · ${product.name || product.id}` : ""}`,
      scope: { saas: product?.id || "", waPhoneId: product?.waPhoneId || "" },
      totals,
      tables,
      notes,
      source: { endpoint: "GET /api/whatsapp/number" },
    });
  });

  tool("wa_templates", {
    group: GRUPO,
    title: "Templates aprovados",
    description: "Templates aprovados na Meta que o composer dispara, com variáveis e exigência de foto no cabeçalho.",
    external: true,
    input: {
      q: z.string().optional(),
      category: z.enum(["UTILITY", "MARKETING", "all"]).optional(),
      limit: z.number().int().optional().describe("Padrão 50."),
      offset: z.number().int().optional(),
    },
    hint: "erro 404 aqui = o servidor ainda não sabe o id da conta (WABA): mande uma mensagem pro número ou defina WHATSAPP_WABA_ID.",
  }, async ({ q, category = "all", limit = 50, offset = 0 }) => {
    const r = await http.get("/api/whatsapp/templates");
    const todos = r.templates || [];
    const s = select(todos, {
      where: category === "all" ? undefined : { category },
      q, qFields: ["name", "body"], sort: "name", limit, offset,
    });
    return result({
      kind: "wa.templates",
      title: "Templates aprovados na Meta",
      totals: {
        aprovados: todos.length,
        comVariaveis: todos.filter((t) => num(t.params) > 0).length,
        comFotoNoCabecalho: todos.filter((t) => t.header === "image").length,
        naoSuportados: num(r.unsupported),
      },
      columns: COLS.templates,
      rows: s.rows,
      rowsLabel: "Templates",
      page: s.page,
      notes: [
        "a API só devolve o que está APROVADO — template pendente ou reprovado não aparece aqui (veja wa_sdr_status ou wa_insights para o evento da Meta).",
        "template com header=image exige a foto a cada envio: wa_send_template usa a foto padrão salva quando você não passa header_media_id.",
        `${num(r.unsupported)} template(s) aprovado(s) o composer não consegue preencher (cabeçalho/botão fora do padrão).`,
      ],
      source: { endpoint: "GET /api/whatsapp/templates" },
    });
  });

  tool("wa_alerts", {
    group: GRUPO,
    title: "Alertas quentes",
    description: "Alertas abertos do inbox: lead que respondeu e lead novo sem toque, com o tempo parado.",
    input: {
      saas: z.string().optional(),
      kind: z.enum(["hot", "lead", "all"]).optional().describe("hot = respondeu; lead = novo sem toque. Padrão all."),
      limit: z.number().int().optional().describe("Padrão 50."),
      offset: z.number().int().optional(),
    },
  }, async ({ saas, kind = "all", limit = 50, offset = 0 }) => {
    const product = saas ? await resolveProduct(saas) : null;
    const { alerts = [] } = await http.get("/api/whatsapp/alerts");
    const linhas = alerts
      .filter((a) => !product || !a.saas || a.saas === product.id)
      .map((a) => ({
        // Mesma régua do servidor (alertKind): alerta gravado antes do campo
        // existir é de CONVERSA — sem isso o filtro kind=hot os perdia.
        id: a.id, kind: a.kind === "lead" ? "lead" : "hot", name: a.name || "", company: a.company || "", stage: a.stage || "",
        thread: a.thread || "", phone: a.phone || "", idadeHoras: horasDesde(a.at), at: a.at || "",
        text: a.text || "", leadId: a.leadId || null, saas: a.saas || "", permission: a.permission || "",
      }));
    const s = select(linhas, { where: kind === "all" ? undefined : { kind }, sort: "at:desc", limit, offset });
    return result({
      kind: "wa.alerts",
      title: "Alertas abertos do WhatsApp",
      scope: { saas: product?.id || "todos", kind },
      units: UNITS,
      totals: {
        abertos: linhas.length,
        respondeu: linhas.filter((a) => a.kind === "hot").length,
        leadNovo: linhas.filter((a) => a.kind === "lead").length,
        maisAntigoHoras: linhas.reduce((a, x) => Math.max(a, x.idadeHoras || 0), 0) || null,
      },
      columns: COLS.alertas,
      rows: s.rows,
      rowsLabel: "Alertas",
      page: s.page,
      notes: ["responder a conversa fecha o alerta sozinho; wa_alert_done fecha sem responder."],
      source: { endpoint: "GET /api/whatsapp/alerts" },
    });
  });

  tool("wa_automations", {
    group: GRUPO,
    title: "Automações do inbox",
    description: "Tudo que responde sozinho num produto: regras, fluxos, saudação do 1º contato, robô de SDR e respostas rápidas.",
    input: { saas: z.string().optional() },
  }, async ({ saas }) => {
    const product = await resolveProduct(saas);
    const [regras, fluxos, produto] = await Promise.all([
      http.get("/api/wa_automations"),
      http.get("/api/wa_flows"),
      http.get(`/api/products/${encodeURIComponent(product.id)}`),
    ]);
    const meu = (r) => !r.saas || r.saas === product.id;
    const rs = (regras || []).filter(meu).map((r) => ({
      id: r.id, name: r.name || "", active: !!r.active, trigger: r.trigger || "",
      keyword: r.keyword || "", cooldownHours: num(r.cooldownHours) || 24, reply: r.reply || "",
    }));
    const fs = (fluxos || []).filter(meu).map((f) => ({
      id: f.id, name: f.name || "", active: !!f.active,
      gatilho: f.trigger?.type || "", palavra: f.trigger?.keyword || "",
      passos: (f.nodes || []).length,
      perguntas: (f.nodes || []).filter((n) => n.kind === "question").length,
    }));
    const saudacao = produto.waCallFlow || {};
    const bot = produto.sdrBot || {};
    // Override do produto; formato inválido cai em vazio (mesma tolerância do
    // waFlowFor da tela) em vez de derrubar a leitura das automações.
    const rapidas = (Array.isArray(produto.waTemplates) ? produto.waTemplates : [])
      .flatMap((g) => (Array.isArray(g?.items) ? g.items : []).map((i) => ({ grupo: g.group || "", label: i.label || "", text: i.text || "" })));

    return result({
      kind: "wa.automations",
      title: `Automações do inbox · ${product.name || product.id}`,
      scope: { saas: product.id },
      totals: {
        regras: rs.length, regrasAtivas: rs.filter((r) => r.active).length,
        fluxos: fs.length, fluxosAtivos: fs.filter((f) => f.active).length,
        saudacaoAutomatica: !!saudacao.enabled,
        roboSdr: !!bot.enabled,
        conversaComIA: !!bot.conversation,
        respostasRapidas: rapidas.length,
      },
      tables: {
        regras: { label: "Regras reativas (palavra-chave / 1ª mensagem / fora do horário)", columns: COLS.regras, rows: rs },
        fluxos: { label: "Fluxos de conversa", columns: COLS.fluxos, rows: fs },
        respostasRapidas: { label: "Respostas rápidas do composer", columns: ["grupo", "label", "text"], rows: rapidas },
      },
      detail: {
        saudacao: { enabled: !!saudacao.enabled, greeting: saudacao.greeting || "", afterHours: saudacao.afterHours || "", hourStart: saudacao.hourStart ?? null, hourEnd: saudacao.hourEnd ?? null },
        sdrBot: bot,
      },
      notes: [
        "regra/fluxo ATIVO responde a pessoa real a cada mensagem que casar (um fluxo pode mandar até 8 mensagens por inbound).",
        "fluxo captura a conversa: enquanto ele manda, as regras não rodam.",
        "respostasRapidas lista só o que o produto SOBRESCREVEU (product.waTemplates); sem override a tela mostra o catálogo padrão, que mora no front e não passa pela API.",
      ],
      source: { endpoint: "GET /api/wa_automations + /api/wa_flows + /api/products/:id" },
    });
  });

  tool("wa_sdr_status", {
    group: GRUPO,
    title: "Estado do robô de SDR",
    description: "Estado do robô de SDR no produto e a aprovação de cada template dele na Meta.",
    external: true,
    input: { saas: z.string().optional() },
  }, async ({ saas }) => {
    const product = await resolveProduct(saas);
    const r = await http.get("/api/sdr/status", { saas: product.id });
    const cfg = r.config || {};
    const linhas = (r.templates || []).map((t) => ({
      name: t.name, category: t.category || "", body: t.body || "",
      approved: !!t.approved, event: t.event || "",
      estado: t.approved ? "aprovado" : /reject|disabl|paus/i.test(so(t.event)) ? "reprovado/pausado" : "aguardando",
    }));
    const pendentes = linhas.filter((t) => !t.approved).length;
    return result({
      kind: "wa.sdr_status",
      title: `Robô de SDR · ${product.name || product.id}`,
      scope: { saas: product.id },
      units: UNITS,
      totals: {
        ligado: !!r.enabled,
        primeiroToque: cfg.firstTouch !== false,
        segundoToque: cfg.secondTouch !== false,
        lembretes: cfg.reminders !== false,
        resgateNoShow: cfg.rescue !== false,
        conversaComIA: !!cfg.conversation,
        modoTeste: !!cfg.conversationTest,
        escadaDeRetomada: cfg.ladder === true,
        atrasoDo1oToqueMin: cfg.firstTouchDelayMin ?? null,
        templates: linhas.length,
        templatesAprovados: linhas.length - pendentes,
        templatesPendentes: pendentes,
      },
      columns: COLS.sdrTemplates,
      rows: linhas,
      rowsLabel: "Templates do robô",
      detail: { config: r.config },
      notes: [
        pendentes ? `${pendentes} template(s) sem aprovação: o 1º toque fora da janela de 24h fica bloqueado até a Meta aprovar (wa_template_submit action=sdr_setup).` : "todos os templates do robô estão aprovados.",
        r.templatesError ? `leitura dos templates falhou: ${r.templatesError}` : "",
      ].filter(Boolean),
      source: { endpoint: `GET /api/sdr/status?saas=${product.id}` },
    });
  });

  tool("wa_sdr_replay", {
    group: GRUPO,
    title: "Replay do SDR",
    description: "Teste do cérebro de IA contra conversas REAIS passadas: o que ele teria feito × o que o time respondeu.",
    write: true, external: true,
    danger: "action=start gasta tokens da Anthropic (até conversas × turnos chamadas, padrão 75).",
    input: {
      action: z.enum(["get", "start"]).optional().describe("Padrão get (lê o relatório)."),
      saas: z.string().optional().describe("Padrão leverads."),
      threads: z.number().int().optional().describe("Conversas, 1..60 (padrão 25)."),
      turns: z.number().int().optional().describe("Por conversa, 1..5 (padrão 3)."),
      samples: z.number().int().optional().describe("Padrão 10; guarda até 40."),
      offset: z.number().int().optional(),
    },
    hint: "409 = já tem uma bateria rodando; leia com action=get.",
  }, async ({ action = "get", saas, threads, turns, samples = 10, offset = 0 }) => {
    if (action === "start") {
      const product = saas ? await resolveProduct(saas) : null;
      const r = await http.post("/api/sdr/replay", {
        ...(product ? { saas: product.id } : {}),
        ...(threads ? { threads } : {}), ...(turns ? { turns } : {}),
      }, { timeoutMs: 300_000 });
      return result({
        kind: "wa.sdr_replay.start",
        title: "Bateria de replay iniciada",
        scope: { saas: product?.id || "leverads" },
        totals: { iniciada: !!r.started, conversas: threads ?? 25, turnos: turns ?? 3 },
        notes: ["roda em segundo plano: acompanhe com action=get."],
        source: { endpoint: "POST /api/sdr/replay" },
      });
    }
    const r = await http.get("/api/sdr/replay");
    const rep = r.report || {};
    const acoes = Object.entries(rep.actions || {}).map(([acao, n]) => ({ acao, n }));
    const s = select(rep.samples || [], { limit: samples, offset });
    return result({
      kind: "wa.sdr_replay",
      title: `Replay do SDR · ${r.status || "idle"}`,
      scope: { saas: r.saas || "", status: r.status || "idle" },
      totals: {
        status: r.status || "idle",
        progresso: `${r.progress?.done ?? 0}/${r.progress?.total ?? 0}`,
        conversas: num(rep.threads), turnos: num(rep.turns), erros: num(rep.errors),
        agendariaConversas: num(rep.wouldBookThreads),
        agendouDeVerdade: num(rep.realBookedThreads),
        travasDePreco: num(rep.priceGuardHits),
        horariosInvalidos: num(rep.invalidSlotPicks),
        iniciadaEm: r.startedAt || "", terminadaEm: r.finishedAt || "",
      },
      tables: {
        acoes: { label: "O que o robô teria feito", columns: ["acao", "n"], rows: acoes },
        amostras: { label: "Amostras (lead × resposta real × resposta do robô)", columns: ["lead", "stage", "kind", "leadMsg", "real", "realAuthor", "bot"], rows: s.rows },
      },
      page: s.page,
      notes: [r.error ? `erro: ${r.error}` : "", "comparar agendariaConversas com agendouDeVerdade é a leitura que decide ligar (ou não) a conversa com IA."].filter(Boolean),
      source: { endpoint: "GET /api/sdr/replay" },
    });
  });

  tool("wa_call", {
    group: GRUPO,
    title: "Ligação pelo cockpit",
    description: "Estado de uma ligação feita pelo cockpit: status, duração e transcrição.",
    input: { call_id: z.string().describe("Id da ligação (list_records em wa_calls).") },
    hint: "a API não tem rota dedicada de listagem, mas wa_calls é coleção pública: liste com list_records collection=wa_calls e traga o id de volta pra cá.",
  }, async ({ call_id }) => {
    const c = await http.get(`/api/whatsapp/calls/${encodeURIComponent(call_id)}`);
    return result({
      kind: "wa.call",
      title: `Ligação ${call_id} · ${c.status || "?"}`,
      scope: { thread: c.thread || "", lead: c.leadId || null, saas: c.saas || "" },
      units: UNITS,
      totals: {
        status: c.status || "", iniciadaEm: c.startedAt || "", atendidaEm: c.answeredAt || "",
        encerradaEm: c.endedAt || "", duracaoSeg: num(c.duration) || num(c.durationSec),
        transcricaoChars: num(c.transcriptChars), autor: c.author || "",
      },
      detail: { eventos: c.events || [], transcript: c.transcript || "" },
      source: { endpoint: `GET /api/whatsapp/calls/${call_id}` },
    });
  });

  // ── Escrita ───────────────────────────────────────────────────────────────

  tool("wa_send", {
    group: GRUPO,
    title: "Enviar mensagem",
    description: "Manda texto livre numa conversa ou para o lead; só dentro da janela de 24h.",
    write: true, external: true,
    danger: "manda mensagem no WhatsApp de uma PESSOA REAL e move o card do lead no funil (novo→contato→qualificação).",
    input: {
      thread: z.string().optional().describe("Use este OU lead_id, nunca os dois."),
      lead_id: z.string().optional(),
      text: z.string().min(1).describe("Máx. 4096 caracteres."),
    },
    hint: "409 = janela de 24h fechada: use wa_send_template. Confirme o destinatário com wa_thread antes de repetir.",
  }, async ({ thread, lead_id, text }) => {
    if (!!thread === !!lead_id) throw new Error("informe EXATAMENTE um destinatário: `thread` (id da conversa) ou `lead_id`. Nunca envio por dedução.");
    const corpo = so(text).trim();
    if (!corpo) throw new Error("mensagem vazia.");
    const path = thread
      ? `/api/whatsapp/threads/${encodeURIComponent(threadKey(thread))}/send`
      : `/api/leads/${encodeURIComponent(lead_id)}/whatsapp`;
    const r = await http.post(path, { text: corpo });
    return result({
      kind: "wa.send",
      title: "Mensagem enviada",
      scope: { thread: thread ? threadKey(thread) : null, lead: lead_id || null },
      totals: { enviada: !!r.ok, messageId: r.messageId || "", caracteres: corpo.length },
      notes: [
        "o envio fecha os alertas quentes da conversa e avança a etapa do lead (markFirstContact).",
        "entrega/leitura chegam depois pelo webhook — confira o status em wa_thread.",
      ],
      source: { endpoint: `POST ${path}` },
    });
  });

  tool("wa_send_template", {
    group: GRUPO,
    title: "Enviar template aprovado",
    description: "Dispara um template aprovado numa conversa — o único jeito de falar fora da janela de 24h.",
    write: true, external: true,
    danger: "manda mensagem pra PESSOA REAL, CUSTA DINHEIRO (template é a mensagem cobrada; MARKETING ainda queima qualidade do número) e move o card do lead.",
    input: {
      thread: z.string(),
      name: z.string().describe("Template aprovado (wa_templates)."),
      params: z.array(z.string()).optional().describe("Valores de {{1}}…{{N}}, na ordem."),
      language: z.string().optional().describe("Ex.: pt_BR."),
      header_media_id: z.string().optional().describe("Sem isso usa a foto padrão do template."),
    },
    hint: "404 = o template não está entre os aprovados (a lista atualiza em até 5 min). 400 com 'imagem no cabeçalho' = suba a foto padrão pela tela do Inbox.",
  }, async ({ thread, name, params = [], language, header_media_id }) => {
    const tid = threadKey(thread);
    // Checagem local antes do POST: template errado ou variável faltando vira
    // erro 400/404 do outro lado — e cada tentativa é um envio a menos de risco.
    const aprovados = await http.get("/api/whatsapp/templates").catch(() => null);
    const tpl = (aprovados?.templates || []).find((t) => t.name === name && (!language || t.language === language));
    if (aprovados && !tpl) {
      throw new Error(`"${name}" não está entre os templates aprovados. Disponíveis: ${(aprovados.templates || []).map((t) => t.name).join(", ") || "(nenhum)"}`);
    }
    if (tpl && params.filter((p) => so(p).trim()).length < num(tpl.params)) {
      throw new Error(`o template "${name}" tem ${tpl.params} variável(is) e você mandou ${params.filter(Boolean).length}.`);
    }
    const r = await http.post(`/api/whatsapp/threads/${encodeURIComponent(tid)}/send-template`, {
      name, params, ...(language ? { language } : {}), ...(header_media_id ? { headerMediaId: header_media_id } : {}),
    });
    const renderizado = tpl ? so(tpl.body).replace(/\{\{\s*(\d+)\s*\}\}/g, (_, n) => params[Number(n) - 1] || "") : "";
    return result({
      kind: "wa.send_template",
      title: `Template "${name}" enviado`,
      scope: { thread: tid, template: name, categoria: tpl?.category || "" },
      totals: { enviado: !!r.ok, messageId: r.messageId || "", variaveis: num(tpl?.params), cabecalho: tpl?.header || "" },
      detail: renderizado ? { textoRenderizado: renderizado } : undefined,
      notes: [
        "template é mensagem cobrada pela Meta — o custo aparece em wa_insights (janela de cache de 10 min).",
        "o envio reabre a conversa, fecha os alertas quentes e avança a etapa do lead.",
      ],
      source: { endpoint: `POST /api/whatsapp/threads/${tid}/send-template` },
    });
  });

  tool("wa_template_submit", {
    group: GRUPO,
    title: "Submeter template à Meta",
    description: "Submete um template novo à aprovação da Meta, ou o conjunto do robô de SDR de uma vez.",
    write: true, external: true,
    danger: "escreve na conta da Meta: template reprovado ou categorizado errado (MARKETING × UTILITY) prejudica o número e muda o preço por mensagem.",
    input: {
      action: z.enum(["create", "sdr_setup"]).optional().describe("sdr_setup = conjunto do robô de SDR. Padrão create."),
      name: z.string().optional().describe("Só [a-z0-9_]. Obrigatório em create."),
      body: z.string().optional().describe("Com {{1}}…{{N}}. Obrigatório em create."),
      category: z.enum(["UTILITY", "MARKETING"]).optional().describe("Padrão UTILITY."),
      language: z.string().optional().describe("Padrão pt_BR."),
      example: z.array(z.string()).optional().describe("Um exemplo por variável (a Meta exige)."),
    },
    hint: "404 = o servidor não sabe o id da conta (WABA): mande uma mensagem pro número ou defina WHATSAPP_WABA_ID.",
  }, async ({ action = "create", name, body, category, language, example }) => {
    if (action === "sdr_setup") {
      const r = await http.post("/api/whatsapp/templates/sdr-setup", {}, { timeoutMs: 300_000 });
      const rows = r.templates || [];
      return result({
        kind: "wa.template_setup",
        title: "Templates do SDR submetidos",
        totals: {
          templates: rows.length,
          aprovados: rows.filter((t) => t.status === "approved").length,
          pendentes: rows.filter((t) => t.status === "pending").length,
          erros: rows.filter((t) => t.status === "error").length,
        },
        columns: ["name", "status", "error"],
        rows,
        rowsLabel: "Templates",
        notes: ["aprovação da Meta leva de minutos a dias; acompanhe em wa_sdr_status."],
        source: { endpoint: "POST /api/whatsapp/templates/sdr-setup" },
      });
    }
    if (!so(name).trim() || !so(body).trim()) throw new Error("action=create exige `name` e `body`.");
    const r = await http.post("/api/whatsapp/templates", {
      name, body, ...(category ? { category } : {}), ...(language ? { language } : {}), ...(example ? { example } : {}),
    });
    return result({
      kind: "wa.template_create",
      title: `Template "${name}" submetido`,
      totals: { id: r.id || "", status: r.status || "", category: r.category || category || "UTILITY" },
      notes: ["nasce PENDING: aprovado, aparece sozinho em wa_templates (cache de até 5 min)."],
      source: { endpoint: "POST /api/whatsapp/templates" },
    });
  });

  tool("wa_thread_link_lead", {
    group: GRUPO,
    title: "Vincular conversa ao lead",
    description: "Liga uma conversa órfã a um lead, ou desvincula, recarimbando o leadId nas mensagens gravadas.",
    write: true,
    input: {
      thread: z.string(),
      lead_id: z.string().optional().describe("Vazio/omitido = DESVINCULAR."),
    },
    hint: "404 'lead não encontrado' = confira o id do lead; 404 'conversa não encontrada' = confira o id em wa_threads.",
  }, async ({ thread, lead_id }) => {
    const tid = threadKey(thread);
    const r = await http.post(`/api/whatsapp/threads/${encodeURIComponent(tid)}/link`, { leadId: lead_id || "" });
    return result({
      kind: "wa.thread_link",
      title: lead_id ? `Conversa ${tid} vinculada ao lead ${lead_id}` : `Conversa ${tid} desvinculada`,
      scope: { thread: tid, lead: r.leadId ?? lead_id ?? null },
      totals: { ok: !!r.ok, lead: r.lead || lead_id || null, mensagensRecarimbadas: num(r.messages), waPhone: r.waPhone || "" },
      notes: ["reversível, mas reescreve toda mensagem da conversa: confira o lead antes."],
      source: { endpoint: `POST /api/whatsapp/threads/${tid}/link` },
    });
  });

  tool("wa_thread_close", {
    group: GRUPO,
    title: "Encerrar / reabrir conversa",
    description: "Arquiva a conversa no inbox (sai das contagens de espera) ou reabre.",
    write: true,
    input: {
      thread: z.string(),
      closed: z.boolean().optional().describe("true encerra (padrão), false reabre."),
      reason: z.string().optional().describe("Padrão manual."),
    },
  }, async ({ thread, closed = true, reason }) => {
    const tid = threadKey(thread);
    const r = await http.post(`/api/whatsapp/threads/${encodeURIComponent(tid)}/close`, { closed, ...(reason ? { reason } : {}) });
    return result({
      kind: "wa.thread_close",
      title: `Conversa ${tid}: ${r.status || (closed ? "closed" : "open")}`,
      scope: { thread: tid },
      totals: { ok: !!r.ok, status: r.status || "", motivo: reason || (closed ? "manual" : "") },
      source: { endpoint: `POST /api/whatsapp/threads/${tid}/close` },
    });
  });

  tool("wa_thread_mark_read", {
    group: GRUPO,
    title: "Marcar conversa como lida",
    description: "Zera o não-lido e manda o visto pro contato pela Cloud API.",
    write: true, external: true,
    danger: "o contato VÊ os tiques azuis — para ele, alguém leu e não respondeu.",
    input: { thread: z.string() },
  }, async ({ thread }) => {
    const tid = threadKey(thread);
    const r = await http.post(`/api/whatsapp/threads/${encodeURIComponent(tid)}/read`, {});
    return result({
      kind: "wa.thread_read",
      title: `Conversa ${tid} marcada como lida`,
      scope: { thread: tid },
      totals: { ok: !!r.ok },
      source: { endpoint: `POST /api/whatsapp/threads/${tid}/read` },
    });
  });

  tool("wa_alert_done", {
    group: GRUPO,
    title: "Resolver alerta",
    description: "Fecha um alerta quente sem responder.",
    write: true,
    input: { alert_id: z.string() },
  }, async ({ alert_id }) => {
    const r = await http.post(`/api/whatsapp/alerts/${encodeURIComponent(alert_id)}/done`, {});
    return result({
      kind: "wa.alert_done",
      title: `Alerta ${alert_id} resolvido`,
      totals: { ok: !!r.ok, alerta: alert_id },
      source: { endpoint: `POST /api/whatsapp/alerts/${alert_id}/done` },
    });
  });

  tool("wa_automation_set", {
    group: GRUPO,
    title: "Editar automação",
    description: "Cria, edita, ativa, desativa ou apaga uma regra reativa ou um fluxo de conversa.",
    write: true, destructive: true,
    danger: "regra ou fluxo ATIVO faz o servidor responder sozinho a pessoas reais (um fluxo manda até 8 mensagens por mensagem recebida).",
    input: {
      kind: z.enum(["rule", "flow"]),
      action: z.enum(["create", "update", "activate", "deactivate", "delete"]),
      id: z.string().optional().describe("Obrigatório fora de create."),
      saas: z.string().optional().describe("Aplicado em create."),
      data: z.record(z.any()).optional().describe("Regra: {name, trigger:'keyword'|'first_message'|'off_hours', keyword, reply, cooldownHours}. Fluxo: {name, trigger:{type,keyword}, nodes:[{id,kind,text,next,branches,fallbackTo}]}."),
    },
    hint: "para ligar depois de criar, chame de novo com action=activate e o id devolvido.",
  }, async ({ kind, action, id, saas, data }) => {
    const col = kind === "rule" ? "wa_automations" : "wa_flows";
    const product = saas ? await resolveProduct(saas) : null;
    let r;
    if (action === "create") {
      if (!data || !Object.keys(data).length) throw new Error("action=create exige `data` com os campos da regra/fluxo.");
      // Nasce DESATIVADA salvo pedido explícito: mensagem automática pro cliente
      // é opt-in — a mesma regra da tela.
      r = await http.post(`/api/${col}`, {
        ...(product ? { saas: product.id } : {}),
        createdAt: new Date().toISOString(),
        ...data,
        active: data.active === true,
      });
    } else if (!id) {
      throw new Error(`action=${action} exige o \`id\` (leia com wa_automations).`);
    } else if (action === "delete") {
      r = await http.del(`/api/${col}/${encodeURIComponent(id)}`);
    } else {
      r = await http.patch(`/api/${col}/${encodeURIComponent(id)}`, action === "update" ? (data || {}) : { active: action === "activate" });
    }
    return result({
      kind: "wa.automation_set",
      title: `${kind === "rule" ? "Regra" : "Fluxo"} · ${action}`,
      scope: { colecao: col, id: r?.id || id || null, saas: product?.id || "" },
      totals: { ok: true, ativa: r?.active ?? (action === "activate" ? true : action === "deactivate" ? false : null) },
      detail: r || undefined,
      notes: action === "create" && data?.active !== true ? ["criada DESATIVADA de propósito: ative com action=activate depois de revisar o texto."] : [],
      source: { endpoint: `${action === "create" ? "POST" : action === "delete" ? "DELETE" : "PATCH"} /api/${col}` },
    });
  });

  tool("wa_sdr_config", {
    group: GRUPO,
    title: "Configurar robô de SDR",
    description: "Liga/desliga o robô de SDR e seus sub-recursos no produto, a saudação do 1º contato, ou o robô em UM lead só.",
    write: true, destructive: true,
    danger: "ligar o robô (principalmente `conversation`) põe uma IA falando com leads reais 24/7, marcando call e movendo card; `ladder` move card sozinho pra nutrição.",
    input: {
      saas: z.string().optional().describe("Obrigatório quando não for lead_id."),
      lead_id: z.string().optional().describe("Com lead_id só `sdr_off` é aplicado."),
      sdr_off: z.boolean().optional().describe("true para o robô nesse lead; false religa."),
      enabled: z.boolean().optional().describe("Chave mestra do robô."),
      first_touch: z.boolean().optional(),
      second_touch: z.boolean().optional(),
      reminders: z.boolean().optional().describe("Lembretes da call (24h/2h/10min)."),
      rescue: z.boolean().optional().describe("Resgate de no-show."),
      rescue2: z.boolean().optional().describe("2ª tentativa do resgate."),
      conversation: z.boolean().optional().describe("IA responde e agenda sozinha."),
      conversation_test: z.boolean().optional().describe("Só leads internos."),
      ladder: z.boolean().optional().describe("Escada de retomada — MOVE card."),
      ladder_cold_days: z.number().int().optional(),
      first_touch_delay_min: z.number().int().optional().describe("Minutos."),
      greeting: z.record(z.any()).optional().describe("{enabled, greeting, afterHours, hourStart, hourEnd}."),
    },
    hint: "rode wa_sdr_replay e confira wa_sdr_status (templates aprovados) antes de ligar a conversa com IA.",
  }, async ({ saas, lead_id, sdr_off, greeting, ...flags }) => {
    if (lead_id) {
      if (sdr_off === undefined) throw new Error("com `lead_id`, informe `sdr_off` (true para parar o robô nesse lead).");
      const l = await http.patch(`/api/leads/${encodeURIComponent(lead_id)}`, { sdrOff: !!sdr_off });
      return result({
        kind: "wa.sdr_lead_switch",
        title: `Robô ${sdr_off ? "parado" : "religado"} no lead ${lead_id}`,
        scope: { lead: lead_id },
        totals: { sdrOff: !!l.sdrOff, lead: l.name || lead_id },
        source: { endpoint: `PATCH /api/leads/${lead_id}` },
      });
    }
    const product = await resolveProduct(saas);
    const atual = await http.get(`/api/products/${encodeURIComponent(product.id)}`);

    const MAPA = {
      enabled: "enabled", first_touch: "firstTouch", second_touch: "secondTouch", reminders: "reminders",
      rescue: "rescue", rescue2: "rescue2", conversation: "conversation", conversation_test: "conversationTest",
      ladder: "ladder", ladder_cold_days: "ladderColdDays", first_touch_delay_min: "firstTouchDelayMin",
    };
    const patch = {};
    const bot = { ...(atual.sdrBot || {}) };
    let mexeuBot = false;
    for (const [entrada, campo] of Object.entries(MAPA)) {
      if (flags[entrada] !== undefined) { bot[campo] = flags[entrada]; mexeuBot = true; }
    }
    if (mexeuBot) {
      if (bot.enabled && !atual.sdrBot?.enabled) bot.enabledAt = new Date().toISOString();
      patch.sdrBot = bot;
    }
    if (greeting) patch.waCallFlow = { ...(atual.waCallFlow || {}), ...greeting };
    if (!Object.keys(patch).length) throw new Error("nada pra mudar: informe pelo menos uma chave (enabled, conversation, greeting, …).");

    const p = await http.patch(`/api/products/${encodeURIComponent(product.id)}`, patch);
    const novo = p.sdrBot || bot;
    return result({
      kind: "wa.sdr_config",
      title: `Robô de SDR · ${product.name || product.id}`,
      scope: { saas: product.id },
      totals: {
        ligado: !!novo.enabled, primeiroToque: novo.firstTouch !== false, segundoToque: novo.secondTouch !== false,
        lembretes: novo.reminders !== false, resgate: novo.rescue !== false, conversaComIA: !!novo.conversation,
        modoTeste: !!novo.conversationTest, escada: novo.ladder === true,
        saudacaoAutomatica: !!(p.waCallFlow || {}).enabled,
      },
      detail: { sdrBot: novo, waCallFlow: p.waCallFlow || {} },
      notes: [
        novo.enabled ? "robô LIGADO: ele fala com lead real sozinho a partir de agora." : "robô desligado: nada sai automaticamente.",
        novo.conversation ? "conversa com IA ativa: ela responde e marca call sem humano no meio." : "",
      ].filter(Boolean),
      source: { endpoint: `PATCH /api/products/${product.id}` },
    });
  });
}
