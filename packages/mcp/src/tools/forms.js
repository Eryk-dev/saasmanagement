// Formulários, propostas, links de pagamento e formulário de integração — a
// superfície de CAPTAÇÃO (form público /f/:id) e a de FECHAMENTO (deck /p/:id,
// link de pagamento, questionário de integração /fi/:id).
//
// O que a API entrega aqui é cru de propósito: o funil do form devolve sessões
// por tela e por variante, e QUEM calcula taxa de início, taxa de envio, queda
// por pergunta e o veredito do teste A/B é a tela (forms.jsx). Um relatório
// pedido pelo modelo precisa das mesmas contas — senão cada resposta divide de
// um jeito e o número muda de conversa pra conversa. Então as regras da tela
// (rate, drop-off, campeã com 95% de confiança, insights do funil) vivem aqui
// também, com os mesmos limiares.
//
// Janela: o funil do form filtra `createdAt` por comparação de string ISO, então
// o dia do negócio (BRT) vira instante UTC antes de virar querystring — um
// "2026-08-31" solto no `until` cortaria o dia 31 inteiro fora.

import { z } from "zod";
import { http, API_BASE } from "../core/http.js";
import { resolveProduct } from "../core/products.js";
import { resolvePeriod, periodInput, delta, dayKey, shiftDay } from "../core/period.js";
import { result } from "../core/envelope.js";
import { select, round2, num } from "../core/shape.js";

const GROUP_FORMS = "Formulários (captação)";
const GROUP_PROP = "Propostas (fechamento)";
const GROUP_OFFERS = "Links de pagamento e ofertas";
const GROUP_INT = "Formulário de integração";

const UNITS = {
  startRate: "%", submitRate: "%", convRate: "%", quedaPct: "%", deQuemComecou: "%", taxaAbertura: "%", taxaAceite: "%",
  revenue: "BRL", amount: "BRL", recebido: "BRL", aguardando: "BRL", price: "BRL", valor: "BRL",
  confianca: "%",
};

const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
const pct = (a, b) => (num(b) > 0 ? round2((num(a) / num(b)) * 100) : null);

// Janela do funil: os eventos guardam instante UTC, e o corte do cockpit é o dia
// do negócio em São Paulo (UTC-3). 00:00 BRT = 03:00Z do mesmo dia.
const isoWindow = (p) => ({ since: `${p.since}T03:00:00.000Z`, until: `${shiftDay(p.until, 1)}T02:59:59.999Z` });

// Mesma regra do renderer (forms.js/buildSteps): pergunta sem `stack`, insight,
// ou logo depois de um insight abre TELA nova. É o que define "onde a pessoa
// desistiu" — quem conta pergunta em vez de tela infla o funil.
function stepsOf(questions = []) {
  const steps = [];
  questions.forEach((q, i) => {
    const isInsight = (q.type || "text") === "insight";
    const prev = steps[steps.length - 1];
    const prevIsInsight = prev && (questions[prev[0]].type || "text") === "insight";
    if (!prev || isInsight || prevIsInsight || !q.stack) steps.push([i]);
    else prev.push(i);
  });
  return steps;
}

// ── Veredito do teste A/B (mesma régua de forms.jsx/championVerdicts) ────────
// Elegível com ≥100 visitas e ≥7 dias; campeã com 95% de confiança no z de duas
// proporções sobre começar/visitar, vetada quando perde envio ou fecha menos —
// headline que ganha clique e não vira contrato não é campeã.
const MIN_VIEWS = 100;
const MIN_DAYS = 7;
function normCdf(z0) {
  const x = Math.abs(z0) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const erf = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  const pos = 0.5 * (1 + erf);
  return z0 >= 0 ? pos : 1 - pos;
}
function abVerdicts(variants) {
  const out = new Map();
  const key = (v) => `${v.pain || ""}|${v.id}`;
  const groups = new Map();
  for (const v of variants) {
    const k = v.pain || "";
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(v);
  }
  for (const g0 of groups.values()) {
    const g = g0.filter((v) => num(v.views) > 0).sort((a, b) => b.starts / b.views - a.starts / a.views);
    if (!g.length) continue;
    if (g.length === 1) { out.set(key(g[0]), "sem rival"); continue; }
    const [top, second] = g;
    for (const v of g.slice(1)) out.set(key(v), "");
    const days = top.firstAt ? Math.max(1, Math.ceil((Date.now() - Date.parse(top.firstAt)) / 86_400_000)) : 0;
    if (top.views < MIN_VIEWS || days < MIN_DAYS) {
      out.set(key(top), `coletando · ${top.views}/${MIN_VIEWS} visitas · ${Math.min(days, MIN_DAYS)}/${MIN_DAYS}d`);
      continue;
    }
    const p1 = top.starts / top.views;
    const p2 = second.starts / second.views;
    const pool = (top.starts + second.starts) / (top.views + second.views);
    const se = Math.sqrt(pool * (1 - pool) * (1 / top.views + 1 / second.views));
    const conf = se > 0 ? normCdf((p1 - p2) / se) : 0.5;
    const subTop = top.submits / top.views;
    const subSecond = second.views > 0 ? second.submits / second.views : 0;
    const submitWorse = second.views >= 50 && subSecond > 0 && subTop < 0.7 * subSecond;
    const wonWorse = num(second.won) > num(top.won);
    if (conf >= 0.95 && !submitWorse && !wonWorse) out.set(key(top), "campeã ✓ promova pro texto base");
    else if (conf >= 0.95) out.set(key(top), submitWorse ? "ganha clique, perde envio ⚠" : "ganha clique, fecha menos ⚠");
    else out.set(key(top), `líder · ${Math.round(conf * 100)}% de confiança`);
  }
  return out;
}

// Insights do funil (mesmas regras e volumes mínimos do card da tela): welcome
// que segura pouca gente, pergunta que derruba, origem que converte fora da média.
function funnelInsights(f, steps) {
  const out = [];
  const P = (a, b) => (b > 0 ? Math.round((a / b) * 100) : 0);
  if (num(f.views) >= 30) {
    const r = P(num(f.starts), num(f.views));
    if (r < 40) out.push({ tipo: "Atenção", texto: `só ${r}% das ${f.views} visitas clicam em começar — a headline da boas-vindas é o primeiro suspeito (rode uma variante com form_suggest_welcome).` });
  }
  const chain = [{ label: "começar", sessions: num(f.starts) }, ...steps.filter((s) => !s.insight)];
  let worst = null;
  for (let i = 1; i < chain.length; i++) {
    const prev = num(chain[i - 1].sessions);
    if (prev < 15) continue;
    const drop = 1 - num(chain[i].sessions) / prev;
    if (drop >= 0.25 && (!worst || drop > worst.drop)) worst = { step: chain[i], prev, drop };
  }
  if (worst) out.push({ tipo: "Revisar", texto: `a pergunta “${worst.step.label}” derruba ${Math.round(worst.drop * 100)}% de quem chega nela (${worst.prev} → ${worst.step.sessions} sessões).` });
  const origins = (f.origins || []).filter((o) => num(o.views) >= 15);
  if (origins.length >= 2 && num(f.views) > 0) {
    const rate = (o) => (num(o.views) > 0 ? num(o.submits) / num(o.views) : 0);
    const overall = num(f.submits) / num(f.views);
    const nome = (o) => [o.source || "(sem source)", o.content || o.campaign].filter(Boolean).join(" · ");
    const sorted = [...origins].sort((a, b) => rate(a) - rate(b));
    const weak = sorted[0];
    const best = sorted[sorted.length - 1];
    if (overall > 0 && rate(weak) < overall / 2) out.push({ tipo: "Atenção", texto: `a origem ${nome(weak)} converte ${P(num(weak.submits), num(weak.views))}% das visitas em envio, menos da metade da média do form (${Math.round(overall * 100)}%).` });
    if (best !== weak && rate(best) >= overall * 1.5) out.push({ tipo: "Escalar", texto: `${nome(best)} converte ${P(num(best.submits), num(best.views))}% das visitas em envio (média do form: ${Math.round(overall * 100)}%).` });
  }
  return out;
}

// Só as chaves que o usuário mandou viram patch: um `undefined` no corpo apagaria
// campo do documento (o PATCH é merge raso).
const defined = (obj) => Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));

const formLink = (id) => `${API_BASE}/f/${id}`;

async function resolveForm(ref, saas) {
  const scope = saas ? (await resolveProduct(saas)).id : undefined;
  const forms = (await http.get("/api/forms", { saas: scope })) || [];
  const alvo = norm(ref);
  const hit = forms.find((f) => String(f.id) === String(ref))
    || forms.find((f) => norm(f.name) === alvo)
    || forms.find((f) => norm(f.name).includes(alvo));
  if (!hit) {
    const lista = forms.map((f) => `${f.id} (${f.name || "sem nome"})`).join(", ") || "(nenhum)";
    throw new Error(`formulário "${ref}" não existe${scope ? ` em ${scope}` : ""}. Disponíveis: ${lista}`);
  }
  return hit;
}

// Estado que a tela derivar de uma proposta: o que interessa é "o cliente abriu?
// fechou?", não o documento de 8 kB de slides.
const proposalStatus = (p) => (p.accepted ? "fechou" : num(p.views) > 0 ? "aberta pelo lead" : "enviada");
const proposalKind = (p) => (p.sharedFrom ? "link do cliente" : p.origin === "custom" ? "personalizada" : "deck");
const proposalRow = (p) => ({
  id: p.id,
  createdAt: p.createdAt || "",
  lead: p.lead || "",
  leadName: p.data?.lead?.name || "",
  company: p.data?.lead?.company || "",
  name: p.name || "",
  template: p.template || "",
  kind: proposalKind(p),
  offer: p.sharedOffer || "",
  status: proposalStatus(p),
  views: num(p.views),
  lastViewedAt: p.lastViewedAt || "",
  acceptedAt: p.acceptedAt || "",
  url: `${API_BASE}/p/${p.id}`,
});

export function registerFormsTools(tool) {
  // ══════════════════════════ FORMULÁRIOS ══════════════════════════

  tool("forms_list", {
    group: GROUP_FORMS,
    title: "Formulários do produto",
    description: "Formulários do produto com link /f/:id e o funil da janela: visitas, começaram, enviaram, conversão.",
    input: {
      saas: z.string().optional(),
      status: z.enum(["published", "draft", "any"]).optional().describe("Padrão any."),
      q: z.string().optional(),
      ...periodInput(z),
      funnel: z.boolean().optional().describe("Padrão true."),
      limit: z.number().int().optional().describe("Padrão 25."),
    },
  }, async ({ saas, status = "any", q, period, since, until, funnel = true, limit = 25 }) => {
    const scope = saas ? (await resolveProduct(saas)).id : undefined;
    const p = resolvePeriod({ period, since, until });
    const forms = (await http.get("/api/forms", { saas: scope })) || [];
    const s = select(forms, {
      where: status === "any" ? undefined : { status },
      q, qFields: ["name", "id"],
      sort: "name", limit,
    });

    const win = isoWindow(p);
    // Só form publicado tem página no ar (e portanto funil); e o funil é uma
    // chamada por form, então o teto evita 40 requisições numa listagem.
    const publicados = s.rows.filter((f) => f.status === "published");
    const alvos = funnel ? publicados.slice(0, 12) : [];
    const funis = new Map(await Promise.all(alvos.map(async (f) => {
      try { return [f.id, await http.get(`/api/forms/${encodeURIComponent(f.id)}/funnel`, win)]; }
      catch { return [f.id, null]; }
    })));

    const rows = s.rows.map((f) => {
      const fu = funis.get(f.id) || null;
      return {
        id: f.id,
        name: f.name || "",
        status: f.status || "draft",
        saas: f.saas || "",
        perguntas: (f.questions || []).length,
        telas: stepsOf(f.questions || []).length,
        variantes: (f.welcome?.variants || []).length + Object.values(f.welcome?.byPain || {}).reduce((a, v) => a + (v.variants || []).length, 0),
        views: fu ? num(fu.views) : null,
        starts: fu ? num(fu.starts) : null,
        submits: fu ? num(fu.submits) : null,
        startRate: fu ? pct(fu.starts, fu.views) : null,
        submitRate: fu ? pct(fu.submits, fu.starts) : null,
        convRate: fu ? pct(fu.submits, fu.views) : null,
        link: f.status === "published" ? formLink(f.id) : "",
      };
    });

    const somaFunil = (k) => rows.reduce((a, r) => a + num(r[k]), 0);
    return result({
      kind: "forms.list",
      title: `Formulários${scope ? ` · ${scope}` : ""}`,
      scope: { saas: scope || "todos", status },
      period: p,
      units: UNITS,
      totals: {
        formularios: s.page.total,
        publicados: forms.filter((f) => f.status === "published").length,
        views: somaFunil("views"),
        starts: somaFunil("starts"),
        submits: somaFunil("submits"),
        convRate: pct(somaFunil("submits"), somaFunil("views")),
      },
      columns: ["id", "name", "status", "saas", "perguntas", "telas", "variantes", "views", "starts", "submits", "startRate", "submitRate", "convRate", "link"],
      rows,
      rowsLabel: "Formulários",
      page: s.page,
      notes: [
        "startRate = começaram ÷ visitas; submitRate = enviaram ÷ começaram; convRate = enviaram ÷ visitas (a conversão total da tela).",
        funnel && publicados.length > 12 ? `funil buscado só nos 12 primeiros publicados (de ${publicados.length}) — filtre com \`q\` ou \`saas\` para o resto.` : "",
        "rascunho não tem página pública: /f/:id responde 404 até publicar (form_update com status=published).",
      ].filter(Boolean),
      source: { endpoint: "GET /api/forms · GET /api/forms/:id/funnel" },
    });
  });

  tool("form_get", {
    group: GROUP_FORMS,
    title: "Definição de um formulário",
    description: "Definição completa: perguntas por tela com opções e desvios, tema, boas-vindas A/B e mapeamento pro lead.",
    input: {
      form: z.string().describe("id ou nome."),
      saas: z.string().optional(),
    },
  }, async ({ form, saas }) => {
    const f = await resolveForm(form, saas);
    const questions = f.questions || [];
    const steps = stepsOf(questions);
    const telaDe = new Map();
    steps.forEach((idxs, si) => idxs.forEach((qi) => telaDe.set(qi, si + 1)));

    const rows = questions.map((q, i) => ({
      tela: telaDe.get(i),
      ordem: i + 1,
      key: q.key,
      label: q.label || "",
      type: q.type || "text",
      required: !!q.required,
      stack: !!q.stack,
      opcoes: (q.options || []).map((o) => o.value).join(" | "),
      desvios: (q.options || []).filter((o) => o.to).map((o) => `${o.value}→${o.to}`).join(" | ") || q.to || "",
      saidas: (q.options || []).filter((o) => o.exit).map((o) => `${o.value}→${o.exit}`).join(" | "),
    }));

    const variantes = [
      ...(f.welcome?.variants || []).map((v) => ({ dor: "", ...v })),
      ...Object.entries(f.welcome?.byPain || {}).flatMap(([dor, w]) => (w.variants || []).map((v) => ({ dor, ...v }))),
    ].map((v) => ({ dor: v.dor, id: v.id, title: v.title || "", subtitle: v.subtitle || "", button: v.button || "" }));

    return result({
      kind: "forms.definition",
      title: `Formulário · ${f.name || f.id}`,
      scope: { form: f.id, saas: f.saas || "", status: f.status || "draft" },
      totals: {
        perguntas: questions.length,
        telas: steps.length,
        obrigatorias: questions.filter((q) => q.required).length,
        variantes: variantes.length,
        saidasLaterais: Object.keys(f.exits || {}).length,
        link: f.status === "published" ? formLink(f.id) : "(rascunho, sem página)",
      },
      columns: ["tela", "ordem", "key", "label", "type", "required", "stack", "opcoes", "desvios", "saidas"],
      rows,
      rowsLabel: "Perguntas",
      tables: {
        variantes: { label: "Variantes de boas-vindas (teste A/B)", columns: ["dor", "id", "title", "subtitle", "button"], rows: variantes },
        exits: {
          label: "Saídas laterais (quem sai do produto principal)",
          columns: ["chave", "stage", "title", "subtitle"],
          rows: Object.entries(f.exits || {}).map(([k, v]) => ({ chave: k, stage: v.stage || "", title: v.title || "", subtitle: v.subtitle || "" })),
        },
      },
      detail: {
        mapping: f.mapping || {},
        welcome: { title: f.welcome?.title || "", subtitle: f.welcome?.subtitle || "", button: f.welcome?.button || "" },
        thanks: f.thanks || {},
        reject: f.reject || null,
        submitLabel: f.submitLabel || "",
        theme: f.theme || {},
      },
      notes: [
        "`desvios` é o branching: `_end` fecha como qualificado e `_reject` como não-qualificado (o servidor decide, não a página).",
        "`mapping` diz qual resposta vira nome/e-mail/telefone/empresa/valor do lead — sem ele o card nasce sem contato.",
      ],
      source: { endpoint: `GET /api/forms/${f.id}` },
    });
  });

  const formBody = {
    name: z.string().optional(),
    saas: z.string().optional(),
    status: z.enum(["draft", "published"]).optional().describe("published põe /f/:id no ar."),
    questions: z.array(z.record(z.any())).optional().describe("Ordem: {key,label,type(text|textarea|email|phone|number|select|multiselect|insight),required,stack,placeholder,help,options:[{value,label,to,exit}],to}. SUBSTITUI tudo."),
    theme: z.record(z.any()).optional().describe("{ bg, surface, fg, accent, accentFg, font, radius, logoUrl }"),
    welcome: z.record(z.any()).optional().describe("{ title, subtitle, button, variants:[{id,title,subtitle,button}], byPain:{ CODIGO:{...} } }"),
    thanks: z.record(z.any()).optional().describe("{ title, subtitle, redirectUrl }"),
    reject: z.record(z.any()).optional().describe("Não-qualificado (_reject)."),
    exits: z.record(z.any()).optional().describe("{ chave: { stage, title, subtitle } }; opção aponta pela `exit`."),
    mapping: z.record(z.any()).optional().describe("{name,email,phone,company,amount} → chaves de perguntas."),
    submitLabel: z.string().optional().describe("CTA da última tela."),
  };

  tool("form_create", {
    group: GROUP_FORMS,
    title: "Criar formulário",
    description: "Cria um formulário; nasce rascunho salvo status=published.",
    write: true,
    hint: "toda pergunta precisa de `key` única e `type` válido; `mapping` precisa apontar pra chaves que existem em `questions`.",
    input: { ...formBody, name: z.string(), saas: z.string() },
  }, async (args) => {
    const product = await resolveProduct(args.saas);
    const body = defined({ ...args, saas: product.id, status: args.status || "draft" });
    const created = await http.post("/api/forms", body);
    return result({
      kind: "forms.created",
      title: `Formulário criado · ${created.name || created.id}`,
      scope: { form: created.id, saas: product.id },
      totals: {
        id: created.id,
        status: created.status || "draft",
        perguntas: (created.questions || []).length,
        link: created.status === "published" ? formLink(created.id) : "(rascunho, sem página)",
      },
      notes: ["as perguntas viram automaticamente as perguntas de qualificação do card do lead (leadQuestions do produto)."],
      source: { endpoint: "POST /api/forms" },
    });
  });

  tool("form_update", {
    group: GROUP_FORMS,
    title: "Editar / publicar formulário",
    description: "Edita e publica/despublica o formulário; `questions` substitui a lista inteira.",
    write: true, destructive: true,
    danger: "status=draft tira a página /f/:id do ar na hora; trocar `questions` sem ler antes apaga perguntas.",
    hint: "leia o form com form_get, altere o array inteiro e mande de volta.",
    input: { form: z.string().describe("id ou nome."), ...formBody },
  }, async ({ form, saas, ...campos }) => {
    // Sem escopo na busca: aqui `saas` é o produto DESTINO (mover o form de
    // marca), não o filtro — buscar dentro dele não acharia o form de origem.
    const alvo = await resolveForm(form);
    const patch = defined({ ...campos, ...(saas ? { saas: (await resolveProduct(saas)).id } : {}) });
    if (!Object.keys(patch).length) throw new Error("nada pra mudar: mande ao menos um campo (name, status, questions, welcome, theme, mapping, exits…).");
    const updated = await http.patch(`/api/forms/${encodeURIComponent(alvo.id)}`, patch);
    return result({
      kind: "forms.updated",
      title: `Formulário atualizado · ${updated.name || updated.id}`,
      scope: { form: updated.id, saas: updated.saas || "" },
      totals: {
        campos: Object.keys(patch).join(", "),
        status: updated.status || "draft",
        perguntas: (updated.questions || []).length,
        link: updated.status === "published" ? formLink(updated.id) : "(rascunho, sem página)",
      },
      notes: ["mexer em `questions` também mescla as perguntas de qualificação do PRODUTO (leadQuestions) — o card do lead muda junto."],
      source: { endpoint: `PATCH /api/forms/${updated.id}` },
    });
  });

  tool("form_funnel", {
    group: GROUP_FORMS,
    title: "Funil do formulário",
    description: "Conversão do formulário na janela: queda tela a tela, teste A/B das headlines e drop-off por origem.",
    input: {
      form: z.string().describe("id ou nome."),
      saas: z.string().optional(),
      ...periodInput(z),
      limit: z.number().int().optional().describe("Padrão 50 por tabela."),
    },
  }, async ({ form, saas, period, since, until, limit = 50 }) => {
    const f = await resolveForm(form, saas);
    const p = resolvePeriod({ period, since, until });
    const fu = await http.get(`/api/forms/${encodeURIComponent(f.id)}/funnel`, isoWindow(p));

    // Queda por tela: o denominador é quem chegou na tela anterior (é assim que
    // a tela lê "essa pergunta derruba 30%"), e a primeira compara com "começou".
    const steps = fu.steps || [];
    let anterior = num(fu.starts);
    const stepRows = steps.map((s, i) => {
      const row = {
        ordem: i + 1,
        key: s.key,
        label: s.label || s.key,
        insight: !!s.insight,
        sessions: num(s.sessions),
        deQuemComecou: pct(s.sessions, fu.starts),
        quedaPct: anterior > 0 ? round2((1 - num(s.sessions) / anterior) * 100) : null,
      };
      anterior = num(s.sessions);
      return row;
    });

    // Headline real de cada variante: o funil só guarda o id, o título mora no
    // form (welcome base ou a da dor, com herança de campo vazio).
    const defs = [
      ...(f.welcome?.variants || []).map((v) => ({ pain: "", ...v })),
      ...Object.entries(f.welcome?.byPain || {}).flatMap(([pain, w]) => (w.variants || []).map((v) => ({ pain, ...v }))),
    ];
    const vistos = (fu.variants || []).filter((v) => num(v.views) > 0);
    const vereditos = abVerdicts(vistos);
    const variantRows = vistos.map((v) => {
      const def = defs.find((d) => String(d.id) === String(v.id));
      const g = v.grades || {};
      return {
        dor: v.pain || "",
        id: v.id,
        headline: def ? (def.title || f.welcome?.byPain?.[v.pain]?.title || f.welcome?.title || "") : `(variante ${v.id} encerrada)`,
        views: num(v.views),
        starts: num(v.starts),
        startRate: pct(v.starts, v.views),
        submits: num(v.submits),
        // Envio ÷ VISITAS (é a régua da tela pra comparar variante), e por isso
        // `convRate` e não `submitRate`: submitRate nos totais é ÷ começaram.
        convRate: pct(v.submits, v.views),
        leads: num(v.leads),
        clientes: ["S", "A", "B", "C"].map((k) => (num(g[k]) ? `${k}${num(g[k])}` : "")).filter(Boolean).join("·"),
        calls: num(v.calls),
        won: num(v.won),
        revenue: round2(num(v.revenue)),
        veredito: vereditos.get(`${v.pain || ""}|${v.id}`) || "",
        firstAt: v.firstAt || "",
      };
    }).sort((a, b) => (b.startRate || 0) - (a.startRate || 0));

    const originRows = (fu.origins || []).map((o) => ({
      source: o.source || "",
      campaign: o.campaign || "",
      content: o.content || "",
      placement: o.placement || "",
      views: num(o.views),
      starts: num(o.starts),
      submits: num(o.submits),
      startRate: pct(o.starts, o.views),
      convRate: pct(o.submits, o.views),
    }));

    const cortada = (rows) => select(rows, { limit });
    const sv = cortada(variantRows);
    const so = cortada(originRows);

    return result({
      kind: "forms.funnel",
      title: `Funil do formulário · ${f.name || f.id}`,
      scope: { form: f.id, saas: f.saas || "", status: f.status || "draft" },
      period: p,
      units: UNITS,
      totals: {
        views: num(fu.views),
        starts: num(fu.starts),
        submits: num(fu.submits),
        startRate: pct(fu.starts, fu.views),
        submitRate: pct(fu.submits, fu.starts),
        convRate: pct(fu.submits, fu.views),
      },
      columns: ["ordem", "key", "label", "insight", "sessions", "deQuemComecou", "quedaPct"],
      rows: stepRows,
      rowsLabel: "Telas do formulário",
      tables: {
        variantes: { label: "Teste A/B das headlines (por dor)", columns: ["dor", "id", "headline", "views", "starts", "startRate", "submits", "convRate", "leads", "clientes", "calls", "won", "revenue", "veredito", "firstAt"], rows: sv.rows, page: sv.page },
        origens: { label: "Drop-off por origem do tráfego", columns: ["source", "campaign", "content", "placement", "views", "starts", "submits", "startRate", "convRate"], rows: so.rows, page: so.page },
        insights: { label: "Insights do funil", columns: ["tipo", "texto"], rows: funnelInsights(fu, steps) },
      },
      notes: [
        sv.page.truncated || so.page.truncated
          ? `tabelas cortadas em ${limit} linhas (variantes ${sv.page.returned}/${sv.page.total}, origens ${so.page.returned}/${so.page.total}) — aumente \`limit\`.` : "",
        "startRate = começaram ÷ visitas; submitRate (totais) = enviaram ÷ começaram; convRate = enviaram ÷ VISITAS, e é o convRate que compara variante e origem.",
        "sessão anônima por visita: uma pessoa que abre duas vezes conta duas visitas; `views/starts/submits` são sessões únicas por evento.",
        "campeã do A/B exige ≥100 visitas e ≥7 dias e é vetada quando perde envio ou fecha menos que a vice — clique não é contrato.",
        "won/revenue usam a DATA DA SUBMISSÃO no recorte, então numa janela curta o lead que fechou depois some da coluna (use 90 dias ou mais).",
        "`content` é o id do anúncio na Meta — traduza para nome com ads_attribution.",
      ].filter(Boolean),
      source: { endpoint: `GET /api/forms/${f.id}/funnel` },
    });
  });

  tool("form_submissions", {
    group: GROUP_FORMS,
    title: "Respostas dos formulários",
    description: "Respostas enviadas com contato do mapeamento, variante/dor vista e lead gerado.",
    input: {
      form: z.string().optional().describe("id ou nome."),
      saas: z.string().optional(),
      ...periodInput(z),
      q: z.string().optional(),
      include_internal: z.boolean().optional().describe("Padrão false."),
      only_orphans: z.boolean().optional().describe("Só envios sem lead."),
      include_answers: z.boolean().optional().describe("Padrão false."),
      limit: z.number().int().optional().describe("Padrão 25."),
      offset: z.number().int().optional(),
    },
  }, async ({ form, saas, period, since, until, q, include_internal = false, only_orphans = false, include_answers = false, limit = 25, offset = 0 }) => {
    const f = form ? await resolveForm(form, saas) : null;
    const scope = saas ? (await resolveProduct(saas)).id : undefined;
    const p = resolvePeriod({ period, since, until });
    const all = (await http.get("/api/form_submissions", { form: f?.id, saas: scope })) || [];
    const janela = all.filter((s) => {
      const d = dayKey(s.createdAt);
      return d >= p.since && d <= p.until;
    });

    const m = f?.mapping || {};
    const label = new Map((f?.questions || []).map((qq) => [qq.key, qq.label || qq.key]));
    // `answers` pode vir null em registro antigo: sem o `|| {}` o relatório
    // inteiro morre por causa de uma linha.
    const contato = (a, k) => (m[k] && (a || {})[m[k]] != null ? String(a[m[k]]) : "");
    const resumo = (a) => {
      const chaves = Object.values(m);
      return Object.entries(a || {})
        .filter(([k, v]) => !chaves.includes(k) && v != null && v !== "")
        .slice(0, 3)
        .map(([k, v]) => `${label.get(k) || k}: ${Array.isArray(v) ? v.join(", ") : v}`)
        .join(" · ")
        .slice(0, 200);
    };

    const rows = janela.map((s) => ({
      createdAt: s.createdAt || "",
      form: s.form,
      name: contato(s.answers, "name"),
      email: contato(s.answers, "email"),
      phone: contato(s.answers, "phone"),
      lead: s.lead || "",
      variant: s.variant || "",
      pain: s.pain || "",
      origem: s.utm?.source || "",
      resumo: resumo(s.answers),
      interno: !!s.internal,
      id: s.id,
      ...(include_answers ? { answers: s.answers || {} } : {}),
    }));

    const filtrada = rows
      .filter((r) => include_internal || !r.interno)
      .filter((r) => !only_orphans || !r.lead);
    const sel = select(filtrada, { q, qFields: ["name", "email", "phone", "resumo", "lead", "id"], sort: "createdAt:desc", limit, offset });

    return result({
      kind: "forms.submissions",
      title: `Respostas${f ? ` · ${f.name || f.id}` : ""}`,
      scope: { form: f?.id || "todos", saas: scope || "todos" },
      period: p,
      totals: {
        envios: filtrada.length,
        comLead: filtrada.filter((r) => r.lead).length,
        semLead: filtrada.filter((r) => !r.lead).length,
        testesDaEquipe: rows.filter((r) => r.interno).length,
      },
      columns: ["createdAt", "name", "email", "phone", "lead", "variant", "pain", "origem", "resumo", ...(include_answers ? ["answers"] : []), "id"],
      rows: sel.rows,
      rowsLabel: "Respostas",
      page: sel.page,
      notes: [
        "sem `form`, o rótulo das respostas não é resolvido (o mapeamento é por formulário) — passe `form` para ver nome/e-mail/telefone.",
        "envio sem lead = saída lateral antes das perguntas de contato, ou envio de quem já existia (a re-entrada mescla no card antigo).",
      ],
      source: { endpoint: "GET /api/form_submissions" },
    });
  });

  tool("form_preview", {
    group: GROUP_FORMS,
    title: "Pré-visualizar formulário",
    description: "Renderiza a página do formulário (salvo ou rascunho no corpo) sem publicar.",
    input: {
      form: z.string().optional().describe("id ou nome."),
      saas: z.string().optional(),
      draft: z.record(z.any()).optional().describe("Form inteiro; sobrepõe `form`."),
    },
  }, async ({ form, saas, draft }) => {
    // Sem alvo, em vez de erro: diz o que dá pra pré-visualizar (a pergunta
    // seguinte já vem com o id certo).
    if (!draft && !form) {
      const forms = (await http.get("/api/forms", { saas: saas ? (await resolveProduct(saas)).id : undefined })) || [];
      return result({
        kind: "forms.preview",
        title: "Pré-visualização: escolha o formulário",
        totals: { formularios: forms.length },
        columns: ["id", "name", "status", "saas"],
        rows: forms.map((f) => ({ id: f.id, name: f.name || "", status: f.status || "draft", saas: f.saas || "" })),
        rowsLabel: "Formulários",
        notes: ["chame de novo com `form` (um destes) ou com `draft` (o rascunho inteiro no corpo)."],
        source: { endpoint: "GET /api/forms" },
      });
    }
    const base = draft || await resolveForm(form, saas);
    const r = await http.post("/api/forms/preview", base);
    const html = String(r?.html || "");
    return result({
      kind: "forms.preview",
      title: `Pré-visualização · ${base.name || base.id || "rascunho"}`,
      scope: { form: base.id || "(rascunho)" },
      totals: {
        renderizou: html.length > 0,
        bytes: html.length,
        perguntas: (base.questions || []).length,
        link: base.id && base.status === "published" ? formLink(base.id) : "",
      },
      detail: { trecho: html.slice(0, 800) },
      notes: ["o HTML completo não entra na resposta de propósito (dezenas de kB); abra o link público para ver o visual."],
      source: { endpoint: "POST /api/forms/preview" },
    });
  });

  tool("form_suggest_welcome", {
    group: GROUP_FORMS,
    title: "Sugerir headline (IA)",
    description: "Sugere via IA uma variante nova de boas-vindas; não grava.",
    external: true,
    danger: "gasta crédito de IA.",
    input: {
      form: z.string().describe("id ou nome."),
      saas: z.string().optional(),
      start_rate: z.number().optional().describe("Taxa de início atual em %."),
    },
  }, async ({ form, saas, start_rate }) => {
    const f = await resolveForm(form, saas);
    const s = await http.post(`/api/forms/${encodeURIComponent(f.id)}/suggest-welcome`, defined({ startRate: start_rate }));
    return result({
      kind: "forms.welcome_suggestion",
      title: `Nova headline sugerida · ${f.name || f.id}`,
      scope: { form: f.id, saas: f.saas || "" },
      detail: s,
      notes: ["nada foi salvo: para publicar a variante, mande o objeto em `welcome.variants` via form_update (com um id novo)."],
      source: { endpoint: `POST /api/forms/${f.id}/suggest-welcome` },
    });
  });

  // ══════════════════════════ PROPOSTAS ══════════════════════════

  tool("proposals_list", {
    group: GROUP_PROP,
    title: "Propostas geradas",
    description: "Propostas por lead com status (enviada, aberta, fechou), aberturas e comparação com o anterior.",
    input: {
      saas: z.string().optional(),
      lead: z.string().optional(),
      template: z.string().optional(),
      status: z.enum(["enviada", "aberta", "fechou", "any"]).optional().describe("Padrão any."),
      kind: z.enum(["deck", "cliente", "personalizada", "any"]).optional().describe("deck = apresentação; cliente = link de oferta; personalizada = combinado."),
      q: z.string().optional(),
      ...periodInput(z),
      limit: z.number().int().optional().describe("Padrão 25."),
      offset: z.number().int().optional(),
    },
  }, async ({ saas, lead, template, status = "any", kind = "any", q, period, since, until, limit = 25, offset = 0 }) => {
    const scope = saas ? (await resolveProduct(saas)).id : undefined;
    const p = resolvePeriod({ period, since, until });
    const all = (await http.get("/api/proposals", { saas: scope, lead, template })) || [];
    const rows = all.map(proposalRow);
    const naJanela = (r, a, b) => { const d = dayKey(r.createdAt); return d >= a && d <= b; };
    const atual = rows.filter((r) => naJanela(r, p.since, p.until));
    const anterior = rows.filter((r) => naJanela(r, p.previous.since, p.previous.until));

    const rotulo = { enviada: "enviada", aberta: "aberta pelo lead", fechou: "fechou" };
    const kinds = { deck: "deck", cliente: "link do cliente", personalizada: "personalizada" };
    const filtrada = atual
      .filter((r) => status === "any" || r.status === rotulo[status])
      .filter((r) => kind === "any" || r.kind === kinds[kind]);
    const sel = select(filtrada, { q, qFields: ["leadName", "company", "lead", "id", "name"], sort: "createdAt:desc", limit, offset });

    const conta = (arr) => ({
      geradas: arr.length,
      abertas: arr.filter((r) => r.views > 0).length,
      fechadas: arr.filter((r) => r.acceptedAt).length,
    });
    const a = conta(atual);
    const b = conta(anterior);

    return result({
      kind: "proposals.list",
      title: `Propostas geradas${scope ? ` · ${scope}` : ""}`,
      scope: { saas: scope || "todos", status, kind },
      period: p,
      units: UNITS,
      totals: {
        geradas: delta(a.geradas, b.geradas),
        abertas: delta(a.abertas, b.abertas),
        fechadas: delta(a.fechadas, b.fechadas),
        taxaAbertura: pct(a.abertas, a.geradas),
        taxaAceite: pct(a.fechadas, a.geradas),
      },
      columns: ["createdAt", "leadName", "company", "name", "kind", "offer", "status", "views", "lastViewedAt", "acceptedAt", "lead", "id", "url"],
      rows: sel.rows,
      rowsLabel: "Propostas",
      page: sel.page,
      notes: [
        "abertura do TIME não conta: o link aberto de dentro do cockpit fica só no viewLog, `views` é o cliente.",
        "cada oferta compartilhada vira uma proposta própria (kind = link do cliente), com id e tracking separados da apresentação.",
      ],
      source: { endpoint: "GET /api/proposals" },
    });
  });

  tool("proposal_get", {
    group: GROUP_PROP,
    title: "Uma proposta",
    description: "Detalhe de uma proposta: estado da apresentação, aberturas, aceite e link do closer.",
    input: { id: z.string() },
  }, async ({ id }) => {
    const p = await http.get(`/api/proposals/${encodeURIComponent(id)}`);
    const slides = (p.slides || []).map((s, i) => ({ ordem: i + 1, key: s.key || "", type: s.type || "", titulo: s.title || s.eyebrow || "", oferta: s.planTag || "", preco: s.price || "" }));
    const todasAberturas = Array.isArray(p.viewLog) ? p.viewLog : [];
    const log = todasAberturas.slice(-10).reverse()
      .map((v) => ({ at: v.at || "", quem: v.viewer || "", dispositivo: v.device || "", ip: v.ip || "" }));
    return result({
      kind: "proposals.detail",
      title: `Proposta · ${p.data?.lead?.name || p.lead || p.id}`,
      scope: { id: p.id, saas: p.saas || "", lead: p.lead || "", template: p.template || "" },
      units: UNITS,
      totals: {
        status: proposalStatus(p),
        tipo: proposalKind(p),
        views: num(p.views),
        lastViewedAt: p.lastViewedAt || "",
        aceita: !!p.accepted,
        acceptedAt: p.acceptedAt || "",
        acceptStage: p.acceptStage || "",
        criadaEm: p.createdAt || "",
        url: `${API_BASE}/p/${p.id}`,
        urlCloser: p.editKey ? `${API_BASE}/p/${p.id}?k=${p.editKey}` : "(sem edição: é link de cliente)",
      },
      columns: ["ordem", "key", "type", "titulo", "oferta", "preco"],
      rows: slides,
      rowsLabel: "Slides",
      tables: { aberturas: { label: `Últimas aberturas (${log.length} de ${todasAberturas.length} registradas)`, columns: ["at", "quem", "dispositivo", "ip"], rows: log } },
      detail: {
        state: p.state || {},
        lead: p.data?.lead || {},
        answers: p.data?.answers || {},
        ...(p.spec ? { specPersonalizada: p.spec } : {}),
        ...(p.sharedFrom ? { compartilhadaDe: p.sharedFrom, oferta: p.sharedOffer } : {}),
      },
      notes: [
        "o link do closer (?k=) abre a tela zero e edita a apresentação — não mande esse pro cliente, use proposal_share.",
        "o log de aberturas guarda no máximo as 30 últimas no servidor; a tabela mostra as 10 mais recentes.",
      ],
      source: { endpoint: `GET /api/proposals/${id}` },
    });
  });

  tool("proposal_templates", {
    group: GROUP_PROP,
    title: "Templates de proposta",
    description: "Decks do produto com slides, publicação e desempenho em 30 dias; action=get abre um, preview renderiza.",
    input: {
      saas: z.string().optional(),
      id: z.string().optional().describe("Obrigatório em get/preview."),
      action: z.enum(["list", "get", "preview"]).optional().describe("Padrão list."),
      limit: z.number().int().optional().describe("Padrão 25."),
      offset: z.number().int().optional(),
    },
  }, async ({ saas, id, action = "list", limit = 25, offset = 0 }) => {
    const scope = saas ? (await resolveProduct(saas)).id : undefined;

    if (action !== "list") {
      if (!id) throw new Error("action=get/preview exige `id` do template (veja com action=list).");
      const t = await http.get(`/api/proposal_templates/${encodeURIComponent(id)}`);
      if (action === "preview") {
        const r = await http.post("/api/proposals/preview", { template: t });
        const html = String(r?.html || "");
        return result({
          kind: "proposals.template_preview",
          title: `Pré-visualização do template · ${t.name || t.id}`,
          scope: { template: t.id, saas: t.saas || "" },
          totals: { renderizou: html.length > 0, bytes: html.length, slides: (t.slides || []).length, url: `${API_BASE}/p/t/${t.id}` },
          detail: { trecho: html.slice(0, 800) },
          notes: ["preview usa dados de exemplo (Ana Souza); o link /p/t/:id abre o mesmo deck em modo closer, sem salvar nada."],
          source: { endpoint: "POST /api/proposals/preview" },
        });
      }
      return result({
        kind: "proposals.template",
        title: `Template · ${t.name || t.id}`,
        scope: { template: t.id, saas: t.saas || "", status: t.status || "draft" },
        totals: { slides: (t.slides || []).length, acceptStage: t.acceptStage || "", cicloPadrao: t.calc?.defaultCycle || "", preview: `${API_BASE}/p/t/${t.id}` },
        columns: ["ordem", "key", "type", "titulo", "oferta", "preco", "showIf"],
        rows: (t.slides || []).map((s, i) => ({ ordem: i + 1, key: s.key || "", type: s.type || "", titulo: s.title || s.eyebrow || "", oferta: s.planTag || "", preco: s.price || "", showIf: s.showIf ? JSON.stringify(s.showIf) : "" })),
        rowsLabel: "Slides",
        detail: { calc: t.calc || {}, theme: t.theme || {} },
        notes: ["`calc` é a calculadora do deck (faixas de contas/anúncios, planos por ciclo, validade) e o catálogo de produto quando existe."],
        source: { endpoint: `GET /api/proposal_templates/${t.id}` },
      });
    }

    const [templates, propostas] = await Promise.all([
      http.get("/api/proposal_templates", { saas: scope }),
      http.get("/api/proposals", { saas: scope }),
    ]);
    const corte = Date.now() - 30 * 86_400_000;
    const rows = (templates || []).map((t) => {
      const linked = (propostas || []).filter((x) => x.template === t.id);
      return {
        id: t.id,
        name: t.name || "",
        saas: t.saas || "",
        status: t.status || "draft",
        slides: (t.slides || []).length,
        acceptStage: t.acceptStage || "",
        geradas30d: linked.filter((x) => !x.createdAt || Date.parse(x.createdAt) >= corte).length,
        abertas: linked.filter((x) => num(x.views) > 0).length,
        fecharam: linked.filter((x) => x.accepted).length,
        preview: `${API_BASE}/p/t/${t.id}`,
      };
    });
    const st = select(rows, { sort: "name", limit, offset });
    return result({
      kind: "proposals.templates",
      title: `Templates de proposta${scope ? ` · ${scope}` : ""}`,
      scope: { saas: scope || "todos" },
      totals: { templates: rows.length, publicados: rows.filter((r) => r.status === "published").length },
      columns: ["id", "name", "saas", "status", "slides", "acceptStage", "geradas30d", "abertas", "fecharam", "preview"],
      rows: st.rows,
      rowsLabel: "Templates",
      page: st.page,
      notes: ["o deck usado na geração é o PUBLICADO do produto; rascunho só entra quando o closer escolhe na mão (proposal_generate com `template`)."],
      source: { endpoint: "GET /api/proposal_templates · GET /api/proposals" },
    });
  });

  tool("proposal_template_save", {
    group: GROUP_PROP,
    title: "Salvar template de proposta",
    description: "Grava o deck: slides, calculadora, tema, estágio de aceite, publicação; duplicate copia como rascunho.",
    write: true, destructive: true,
    danger: "publicar (status=published) troca o deck que TODA proposta nova do produto vai usar; `slides` substitui a lista inteira.",
    hint: "leia o template com proposal_templates action=get, altere e mande de volta — `slides` substitui a lista inteira.",
    input: {
      action: z.enum(["create", "update", "duplicate"]).optional().describe("Padrão update com `id`, senão create."),
      id: z.string().optional().describe("Obrigatório em update/duplicate."),
      saas: z.string().optional(),
      name: z.string().optional(),
      description: z.string().optional(),
      status: z.enum(["draft", "published"]).optional().describe("published = deck padrão do produto."),
      slides: z.array(z.record(z.any())).optional().describe("Na ordem, com showIf e mídia. SUBSTITUI a lista inteira."),
      calc: z.record(z.any()).optional().describe("{ seatsMap, volumeMid, plans:{ciclo:{base,included,extra}}, defaultCycle, maxSeats, validDays, catalog }"),
      theme: z.record(z.any()).optional(),
      acceptStage: z.string().optional().describe("Estágio do funil ao aceitar."),
    },
  }, async ({ action, id, saas, ...campos }) => {
    const acao = action || (id ? "update" : "create");
    if (acao !== "create" && !id) throw new Error(`action=${acao} exige o \`id\` do template (veja com proposal_templates).`);
    const product = saas ? await resolveProduct(saas) : null;

    let alvo;
    if (acao === "update") {
      alvo = await http.patch(`/api/proposal_templates/${encodeURIComponent(id)}`, defined({ ...campos, ...(product ? { saas: product.id } : {}) }));
    } else {
      // Duplicar = ler o original e criar cópia como RASCUNHO: publicar duas
      // vezes o mesmo produto deixaria o dispatcher escolhendo no escuro.
      const base = acao === "duplicate" ? await http.get(`/api/proposal_templates/${encodeURIComponent(id)}`) : {};
      const { id: _antigo, createdAt: _c, updatedAt: _u, ...limpo } = base;
      alvo = await http.post("/api/proposal_templates", {
        ...limpo,
        ...defined({ ...campos, ...(product ? { saas: product.id } : {}) }),
        name: campos.name || (acao === "duplicate" ? `${base.name || "Template"} · cópia` : "Proposta"),
        status: campos.status || "draft",
      });
    }
    return result({
      kind: "proposals.template_saved",
      title: `Template ${acao === "update" ? "atualizado" : acao === "duplicate" ? "duplicado" : "criado"} · ${alvo.name || alvo.id}`,
      scope: { template: alvo.id, saas: alvo.saas || "" },
      totals: {
        id: alvo.id,
        status: alvo.status || "draft",
        slides: (alvo.slides || []).length,
        acceptStage: alvo.acceptStage || "",
        preview: `${API_BASE}/p/t/${alvo.id}`,
      },
      notes: [
        alvo.status === "published" ? "publicado: é este o deck que proposal_generate vai usar para o produto." : "rascunho: só entra numa proposta se o closer pedir esse template na mão.",
        "propostas já geradas são snapshots — editar o template não muda o que o cliente já recebeu.",
      ],
      source: { endpoint: acao === "update" ? `PATCH /api/proposal_templates/${id}` : "POST /api/proposal_templates" },
    });
  });

  // Geração da proposta: `generate_proposal` é o nome antigo, já usado por
  // integrações em produção — os dois nomes registram o MESMO handler.
  const geraProposta = async ({ lead_id, force = false, template = "", unpin = false, auto = false }) => {
    const query = [
      force ? "force=1" : "",
      auto ? "auto=1" : "",
      unpin ? "unpin=1" : "",
      template ? `template=${encodeURIComponent(template)}` : "",
    ].filter(Boolean).join("&");
    const r = await http.post(`/api/leads/${encodeURIComponent(lead_id)}/proposal${query ? `?${query}` : ""}`, {}, { timeoutMs: 180_000 });
    const p = r.proposal || null;
    return result({
      kind: "proposals.generated",
      title: r.ok ? `Proposta gerada · lead ${lead_id}` : `Proposta NÃO gerada · lead ${lead_id}`,
      scope: { lead: lead_id, provider: r.provider || "" },
      units: UNITS,
      totals: {
        ok: !!r.ok,
        provider: r.provider || "",
        pulou: r.skipped || "",
        erro: r.error || "",
        proposta: p?.id || r.lead?.proposta_id || "",
        url: r.lead?.proposalUrl || (p ? `${API_BASE}/p/${p.id}` : ""),
        urlCloser: r.lead?.proposal_edit_url || "",
        amount: num(r.lead?.amount) || null,
      },
      notes: [
        r.skipped === "already_generated" ? "o lead já tinha proposta: mande force=true para re-gerar." : "",
        r.skipped === "pinned" ? "o deck está FIXADO nesse lead (feito à mão): mande unpin=true para trocar." : "",
        r.skipped === "no_template" ? "não há template publicado para o produto do lead — publique um em proposal_templates." : "",
        "o link do closer (?k=) é para apresentar; o que vai pro cliente sai de proposal_share.",
      ].filter(Boolean),
      source: { endpoint: `POST /api/leads/${lead_id}/proposal` },
    });
  };

  const geraInput = {
    lead_id: z.string(),
    force: z.boolean().optional().describe("Sobrescreve a proposta atual."),
    template: z.string().optional().describe("Deck alternativo; vazio = o publicado."),
    unpin: z.boolean().optional().describe("Troca mesmo com deck fixado."),
    auto: z.boolean().optional().describe("Respeita idempotência."),
  };

  tool("proposal_generate", {
    group: GROUP_PROP,
    title: "Gerar proposta de um lead",
    description: "Gera (ou re-gera com force) a proposta do lead; provider `native` com template publicado, senão `levercopy`.",
    write: true, external: true,
    danger: "cria uma página PÚBLICA com o preço do lead; o provider levercopy chama um SaaS externo e consome IA.",
    hint: "o id é o do LEAD, não o da proposta; veja o lead com list_records/get_record.",
    input: geraInput,
  }, geraProposta);

  tool("generate_proposal", {
    group: GROUP_PROP,
    title: "Gerar proposta (nome antigo)",
    description: "Alias antigo de proposal_generate.",
    write: true, external: true,
    danger: "cria uma página PÚBLICA com o preço do lead; o provider levercopy chama um SaaS externo e consome IA.",
    input: geraInput,
  }, geraProposta);

  tool("proposal_custom", {
    group: GROUP_PROP,
    title: "Proposta personalizada (o combinado)",
    description: "Proposta sob medida (capa, entregáveis, valor) no layout do deck; o link é estável.",
    write: true,
    danger: "salvar cria/reescreve uma página PÚBLICA com o valor combinado (preview=true só renderiza).",
    input: {
      lead_id: z.string(),
      title: z.string().describe("Título da capa."),
      subtitle: z.string().optional(),
      deliverables: z.array(z.string()).optional().describe("Até 20."),
      price: z.string().optional().describe("Reais, só o número (ex.: \"6000\")."),
      price_caption: z.string().optional().describe("Sobrescreve o rótulo do ciclo."),
      cycle: z.enum(["avista", "mensal", "parcelado"]).optional().describe("Padrão avista."),
      preview: z.boolean().optional().describe("true = só renderiza, não salva."),
    },
  }, async ({ lead_id, title, subtitle, deliverables, price, price_caption, cycle = "avista", preview = false }) => {
    const body = defined({ title, subtitle, deliverables, price, priceCaption: price_caption, cycle, preview: preview || undefined });
    const r = await http.post(`/api/leads/${encodeURIComponent(lead_id)}/proposal/custom`, body);
    if (preview) {
      const html = String(r?.html || "");
      return result({
        kind: "proposals.custom_preview",
        title: `Pré-visualização da proposta personalizada · lead ${lead_id}`,
        scope: { lead: lead_id },
        totals: { renderizou: html.length > 0, bytes: html.length, entregaveis: (deliverables || []).length },
        detail: { trecho: html.slice(0, 800) },
        notes: ["nada foi salvo (preview=true)."],
        source: { endpoint: `POST /api/leads/${lead_id}/proposal/custom` },
      });
    }
    return result({
      kind: "proposals.custom",
      title: `Proposta personalizada salva · lead ${lead_id}`,
      scope: { lead: lead_id, id: r.id },
      totals: { id: r.id, url: r.url, entregaveis: (deliverables || []).length, valor: price || "a combinar", ciclo: cycle },
      notes: ["o link é estável: salvar de novo reescreve o mesmo id e mantém as aberturas já contadas.", "não substitui a proposta automática do lead (proposta_id fica intacto)."],
      source: { endpoint: `POST /api/leads/${lead_id}/proposal/custom` },
    });
  });

  tool("proposal_share", {
    group: GROUP_PROP,
    title: "Link da proposta pro cliente",
    description: "Sem `offer`, lista as ofertas do deck do lead; com `offer`, cria o link do cliente daquela oferta.",
    write: true,
    danger: "o link gerado é o que vai pro cliente com o preço da oferta escolhida.",
    hint: "o lead precisa ter proposta gerada (proposal_generate) antes de compartilhar.",
    input: {
      lead_id: z.string(),
      offer: z.number().int().optional().describe("1 = principal, 2/3 = secretas. Omitido = só lista."),
    },
  }, async ({ lead_id, offer }) => {
    if (offer == null) {
      const r = await http.get(`/api/leads/${encodeURIComponent(lead_id)}/proposal-offers`);
      return result({
        kind: "proposals.offers",
        title: `Ofertas do deck · lead ${lead_id}`,
        scope: { lead: lead_id, proposta: r.proposal || "" },
        totals: { proposta: r.proposal || "(lead sem proposta gerada)", ofertas: (r.offers || []).length },
        columns: ["offer", "label", "price", "per", "cycles"],
        rows: r.offers || [],
        rowsLabel: "Ofertas",
        notes: ["nada foi enviado: chame de novo com `offer` para gerar o link do cliente."],
        source: { endpoint: `GET /api/leads/${lead_id}/proposal-offers` },
      });
    }
    const r = await http.post(`/api/leads/${encodeURIComponent(lead_id)}/proposal-share`, { offer });
    return result({
      kind: "proposals.shared",
      title: `Link do cliente · oferta ${r.offer} (${r.label})`,
      scope: { lead: lead_id, id: r.id },
      totals: { id: r.id, url: r.url, oferta: r.offer, label: r.label },
      notes: [
        "re-compartilhar a mesma oferta reusa o MESMO link (re-snapshot), então correção no deck chega em quem já recebeu.",
        "as ofertas secretas não aparecem nesse link: o cliente vê só a que você escolheu.",
      ],
      source: { endpoint: `POST /api/leads/${lead_id}/proposal-share` },
    });
  });

  tool("proposal_setup", {
    group: GROUP_PROP,
    title: "Tela zero do closer",
    description: "Ajusta a apresentação antes da call (produto, faixas, ciclo, desconto, OEM, capa) e escreve no lead.",
    write: true,
    danger: "reescreve nome, empresa, nicho, faixas e o valor do negócio no card do lead.",
    hint: "só a proposta de APRESENTAÇÃO tem editKey — link de cliente (proposal_share) não pode ser editado.",
    input: {
      id: z.string(),
      product: z.string().optional().describe("Produto do catálogo; \"\" volta à régua."),
      accounts: z.string().optional().describe("Chave do seatsMap; deriva os assentos."),
      volume: z.string().optional().describe("Chave do volumeMid."),
      cycle: z.enum(["monthly", "quarterly", "semiannual", "annual"]).optional(),
      discount_pct: z.number().optional().describe("0 a 15%; fora disso clampa."),
      oem: z.boolean().optional(),
      oem_cota: z.number().optional().describe("Cota do OEM avulso."),
      pain: z.string().optional().describe("Até 8 caracteres."),
      deck_order: z.enum(["A", "B"]).optional().describe("Ordem do deck (A/B)."),
      seats: z.number().int().optional(),
      custom_price_cents: z.number().int().optional().describe("Preço manual em centavos."),
      valid_until: z.string().optional().describe("Texto livre."),
      frozen: z.boolean().optional().describe("Congela o preço na tela."),
      clone_count: z.number().int().optional(),
      new_per_month: z.number().int().optional(),
      dores: z.array(z.string()).optional().describe("Até 12."),
      name: z.string().optional().describe("Capa e lead."),
      company: z.string().optional().describe("Capa e lead."),
      niche: z.string().optional().describe("Capa e lead."),
    },
  }, async ({ id, discount_pct, oem_cota, deck_order, custom_price_cents, valid_until, clone_count, new_per_month, ...campos }) => {
    const p = await http.get(`/api/proposals/${encodeURIComponent(id)}`);
    if (!p.editKey) throw new Error(`a proposta ${id} não tem chave de edição (é um link de cliente ou personalizada) — abra a proposta de apresentação do lead.`);
    const body = defined({
      ...campos,
      k: p.editKey,
      discountPct: discount_pct,
      oemCota: oem_cota,
      deckOrder: deck_order,
      customPriceCents: custom_price_cents,
      validUntil: valid_until,
      cloneCount: clone_count,
      newPerMonth: new_per_month,
    });
    const r = await http.patch(`/public/proposals/${encodeURIComponent(id)}`, body);
    return result({
      kind: "proposals.setup",
      title: `Apresentação ajustada · ${p.data?.lead?.name || id}`,
      scope: { id, lead: p.lead || "", saas: p.saas || "" },
      detail: { state: r.state || {} },
      notes: [
        "o valor do card do lead recalcula pelo preço do produto ativo — negócio já fechado (planClosed/wonAt) não é tocado.",
        "faixa de contas manda nos assentos: mudar `accounts` sobrescreve `seats`.",
      ],
      source: { endpoint: `PATCH /public/proposals/${id}` },
    });
  });

  tool("proposal_accept", {
    group: GROUP_PROP,
    title: "Marcar proposta como aceita",
    description: "Registra o aceite: move o lead pro acceptStage do template e converte em cliente no estágio de ganho.",
    write: true, destructive: true,
    danger: "move o lead no funil e pode criar o cliente — não tem desfazer pelo MCP.",
    input: { id: z.string() },
  }, async ({ id }) => {
    const antes = await http.get(`/api/proposals/${encodeURIComponent(id)}`);
    const r = await http.post(`/public/proposals/${encodeURIComponent(id)}/accept`);
    return result({
      kind: "proposals.accepted",
      title: `Proposta aceita · ${antes.data?.lead?.name || id}`,
      scope: { id, lead: antes.lead || "", saas: antes.saas || "" },
      totals: { ok: !!r.ok, jaEstavaAceita: !!antes.accepted, acceptStage: antes.acceptStage || "(o template não define estágio de aceite)" },
      notes: ["re-chamar é inofensivo: só o primeiro aceite move o funil e avisa o time."],
      source: { endpoint: `POST /public/proposals/${id}/accept` },
    });
  });

  // ══════════════════ LINKS DE PAGAMENTO E OFERTAS ══════════════════

  tool("offers_get", {
    group: GROUP_OFFERS,
    title: "Ofertas fixas do produto",
    description: "Links fixos das ofertas do produto: rótulo, preço, link do Mercado Pago e da proposta.",
    input: { saas: z.string().optional() },
  }, async ({ saas }) => {
    const product = await resolveProduct(saas);
    const r = await http.get(`/api/offers/${encodeURIComponent(product.id)}`);
    return result({
      kind: "offers.fixed",
      title: `Ofertas fixas · ${product.name || product.id}`,
      scope: { saas: product.id },
      totals: { ofertas: (r.items || []).length, comLink: (r.items || []).filter((i) => i.link).length },
      columns: ["key", "label", "price", "link", "proposalUrl"],
      rows: r.items || [],
      rowsLabel: "Ofertas",
      notes: ["produto que nunca editou cai nos links padrão do servidor; salvar uma vez passa a valer o documento."],
      source: { endpoint: `GET /api/offers/${product.id}` },
    });
  });

  tool("offers_save", {
    group: GROUP_OFFERS,
    title: "Salvar ofertas fixas",
    description: "Grava as ofertas fixas do produto; substitui a lista inteira.",
    write: true, destructive: true,
    danger: "sobrescreve os links que o time inteiro usa para cobrar — leia com offers_get antes e mande a lista completa.",
    input: {
      saas: z.string().optional(),
      items: z.array(z.object({
        key: z.string().optional(),
        label: z.string().optional(),
        price: z.string().optional(),
        link: z.string().optional().describe("URL http(s); inválida vira vazia."),
        proposalUrl: z.string().optional(),
      })).describe("Lista completa (até 20)."),
    },
  }, async ({ saas, items }) => {
    const product = await resolveProduct(saas);
    const r = await http.put(`/api/offers/${encodeURIComponent(product.id)}`, { items });
    return result({
      kind: "offers.saved",
      title: `Ofertas salvas · ${product.name || product.id}`,
      scope: { saas: product.id },
      totals: { ofertas: (r.items || []).length },
      columns: ["key", "label", "price", "link", "proposalUrl"],
      rows: r.items || [],
      rowsLabel: "Ofertas",
      notes: ["link fora do formato http(s) é descartado pelo servidor: confira a coluna `link` na resposta."],
      source: { endpoint: `PUT /api/offers/${product.id}` },
    });
  });

  tool("offers_payment_links", {
    group: GROUP_OFFERS,
    title: "Histórico de links de pagamento",
    description: "Links de cobrança gerados com o status do dinheiro no Mercado Pago.",
    input: {
      saas: z.string().optional(),
      status: z.enum(["todos", "aguardando", "pagos", "recusados", "substituidos"]).optional().describe("Padrão todos."),
      q: z.string().optional(),
      ...periodInput(z),
      limit: z.number().int().optional().describe("Padrão 25."),
      offset: z.number().int().optional(),
    },
  }, async ({ saas, status = "todos", q, period, since, until, limit = 25, offset = 0 }) => {
    const product = saas ? await resolveProduct(saas) : null;
    const p = resolvePeriod({ period, since, until });
    const r = await http.get("/api/payment-links", { saas: product?.id });
    const WAITING = new Set(["waiting", "pending", "in_process", "authorized"]);
    const FAILED = new Set(["rejected", "cancelled", "refunded", "charged_back"]);
    const GRUPO = {
      todos: () => true,
      aguardando: (s) => WAITING.has(s),
      pagos: (s) => s === "paid",
      recusados: (s) => FAILED.has(s),
      substituidos: (s) => s === "superseded",
    };

    const todos = (r.links || []).filter((l) => {
      const d = dayKey(l.createdAt);
      return d >= p.since && d <= p.until;
    }).map((l) => ({
      createdAt: l.createdAt || "",
      targetName: l.targetName || "",
      title: l.title || "",
      amount: round2(num(l.amount)),
      status: l.status || "",
      pagoEm: l.paidAt || "",
      metodo: l.payment?.method || l.payment?.methodType || "",
      parcelas: num(l.payment?.installments) || null,
      recorrente: !!l.recurring,
      origem: l.origin || "",
      alvo: l.kind || "",
      lead: l.lead || "",
      customer: l.customer || "",
      payerEmail: l.payerEmail || "",
      url: l.url || "",
      id: l.id,
    }));

    const filtrada = todos.filter((l) => GRUPO[status](l.status));
    const sel = select(filtrada, { q, qFields: ["targetName", "title", "payerEmail"], sort: "createdAt:desc", limit, offset });
    const pagos = todos.filter((l) => l.status === "paid");
    const aguardando = todos.filter((l) => WAITING.has(l.status));

    return result({
      kind: "offers.payment_links",
      title: `Links de pagamento${product ? ` · ${product.name || product.id}` : ""}`,
      scope: { saas: product?.id || "todos", status },
      period: p,
      units: UNITS,
      totals: {
        gerados: todos.length,
        recebido: round2(pagos.reduce((a, l) => a + num(l.amount), 0)),
        pagos: pagos.length,
        aguardando: round2(aguardando.reduce((a, l) => a + num(l.amount), 0)),
        aguardandoCount: aguardando.length,
        recusados: todos.filter((l) => FAILED.has(l.status)).length,
      },
      columns: ["createdAt", "targetName", "title", "amount", "status", "pagoEm", "metodo", "parcelas", "recorrente", "origem", "alvo", "payerEmail", "url"],
      rows: sel.rows,
      rowsLabel: "Links",
      page: sel.page,
      notes: [
        "`substituido` (superseded) é link sem pagamento que já tem outro mais novo pro mesmo alvo e valor — não é cobrança esperando.",
        "o status vem do espelho do Mercado Pago gravado no banco; fatura baixada na mão também conta como paga.",
        "`recebido` soma o valor do LINK; o valor efetivamente aprovado pode diferir em centavos.",
      ],
      source: { endpoint: "GET /api/payment-links" },
    });
  });

  // ══════════════════ FORMULÁRIO DE INTEGRAÇÃO ══════════════════

  tool("intform_list", {
    group: GROUP_INT,
    title: "Formulários de integração",
    description: "Pedidos do questionário de integração: quem falta responder, o que veio e o link de cada um.",
    input: {
      saas: z.string().optional(),
      status: z.enum(["pendente", "respondido", "any"]).optional().describe("Padrão any."),
      customer: z.string().optional(),
      q: z.string().optional(),
      limit: z.number().int().optional().describe("Padrão 25."),
      offset: z.number().int().optional(),
    },
  }, async ({ saas, status = "any", customer, q, limit = 25, offset = 0 }) => {
    const product = saas ? await resolveProduct(saas) : null;
    const docs = (await http.get("/api/integration_forms", defined({ saas: product?.id, customer, status: status === "any" ? undefined : status }))) || [];
    const resumo = (d) => {
      const a = d.answers || {};
      const partes = [];
      if (Array.isArray(a.contas) && a.contas.length) partes.push(`${a.contas.length} ${a.contas.length === 1 ? "conta" : "contas"}`);
      if (Array.isArray(a.rotas) && a.rotas.length) partes.push(`${a.rotas.length} ${a.rotas.length === 1 ? "rota" : "rotas"}`);
      if (a.erp && a.erp !== "Não uso") partes.push(String(a.erp));
      if (String(a.sync || "").startsWith("Sim")) partes.push("sincroniza estoque");
      return partes.join(" · ");
    };
    const rows = docs.map((d) => ({
      id: d.id,
      cliente: d.customerName || "",
      status: d.status || "pendente",
      oQueVeio: resumo(d),
      pedidoEm: d.createdAt || "",
      respondidoEm: d.respondedAt || "",
      pedidoPor: d.author || "",
      lead: d.leadId || "",
      customer: d.customerId || "",
      link: `${API_BASE}/fi/${d.id}`,
    }));
    const sel = select(rows, { q, qFields: ["cliente", "id"], sort: "pedidoEm:desc", limit, offset });
    return result({
      kind: "intform.list",
      title: `Formulários de integração${product ? ` · ${product.name || product.id}` : ""}`,
      scope: { saas: product?.id || "todos", status },
      totals: {
        total: rows.length,
        aguardando: rows.filter((r) => r.status !== "respondido").length,
        respondidos: rows.filter((r) => r.status === "respondido").length,
      },
      columns: ["cliente", "status", "oQueVeio", "pedidoEm", "respondidoEm", "pedidoPor", "link", "id"],
      rows: sel.rows,
      rowsLabel: "Pedidos",
      page: sel.page,
      notes: ["o id É o token do link: quem tiver a URL responde, então não publique a lista fora do time."],
      source: { endpoint: "GET /api/integration_forms" },
    });
  });

  tool("intform_get", {
    group: GROUP_INT,
    title: "Respostas da integração",
    description: "Respostas do cliente seção por seção, com rótulos da versão assinada e a assinatura.",
    input: { id: z.string() },
  }, async ({ id }) => {
    const d = await http.get(`/api/integration_forms/${encodeURIComponent(id)}`);
    const a = d.answers || {};
    const asText = (v, q) => {
      if (Array.isArray(v)) {
        return v.map((item, i) => (item && typeof item === "object"
          ? `${i + 1}) ${(q.fields || Object.keys(item).map((k) => ({ key: k, label: k }))).map((f) => `${f.label}: ${item[f.key] ?? "—"}`).join(" · ")}`
          : `${i + 1}) ${item}`)).join(" | ");
      }
      if (typeof v === "boolean") return v ? "sim" : "não";
      return String(v ?? "");
    };
    const rows = [];
    for (const sec of d.sections || []) {
      for (const q of sec.questions || []) {
        if (a[q.key] === undefined) continue;
        rows.push({ secao: sec.title || sec.key, pergunta: q.label || q.key, key: q.key, resposta: asText(a[q.key], q) });
      }
    }
    return result({
      kind: "intform.answers",
      title: `Integração · ${d.customerName || d.id}`,
      scope: { id: d.id, saas: d.saas || "", customer: d.customerId || "", lead: d.leadId || "" },
      totals: {
        status: d.status || "pendente",
        respondidoEm: d.respondedAt || "",
        versao: d.version || "",
        respostas: rows.length,
        assinadoPor: d.respondent?.name || "",
        documento: d.respondent?.doc || "",
        link: `${API_BASE}/fi/${d.id}`,
      },
      columns: ["secao", "pergunta", "resposta"],
      rows,
      rowsLabel: "Respostas",
      detail: d.respondent ? { assinatura: d.respondent } : undefined,
      notes: [
        d.status === "respondido" ? "respondido é FINAL: o cliente assinou esse conteúdo e o link não aceita reenvio." : "ainda não respondido — as respostas aparecem quando o cliente enviar.",
        "as perguntas ficam congeladas no documento (snapshot da versão), então rótulo antigo continua legível mesmo depois de o questionário mudar.",
      ],
      source: { endpoint: `GET /api/integration_forms/${id}` },
    });
  });

  tool("intform_questions", {
    group: GROUP_INT,
    title: "Perguntas da integração",
    description: "Questionário de integração atual (seções, perguntas, condicionais) e a versão do termo.",
  }, async () => {
    const d = await http.get("/api/integration-forms/questions");
    const rows = (d.sections || []).flatMap((s) => (s.questions || []).map((q) => ({
      secao: s.title || s.key,
      key: q.key,
      label: q.label || "",
      tipo: q.type || "text",
      obrigatoria: q.required !== false,
      condicional: q.showIf ? JSON.stringify(q.showIf) : "",
    })));
    return result({
      kind: "intform.questions",
      title: "Perguntas do formulário de integração",
      totals: { versao: d.version, secoes: (d.sections || []).length, perguntas: rows.length, preview: `${API_BASE}/fi/preview` },
      columns: ["secao", "key", "label", "tipo", "obrigatoria", "condicional"],
      rows,
      rowsLabel: "Perguntas",
      detail: { termo: String(d.term || "").slice(0, 1200) },
      source: { endpoint: "GET /api/integration-forms/questions" },
    });
  });

  tool("intform_request", {
    group: GROUP_INT,
    title: "Solicitar formulário de integração",
    description: "Cria o pedido de integração de um cliente ou lead; devolve o link /fi/:id.",
    write: true,
    danger: "gera um link público (o id é o token) feito pra ir a uma pessoa real; o formulário coleta CPF e assinatura eletrônica.",
    hint: "informe customer_id OU lead_id; `customer_name` é o que aparece na saudação do formulário.",
    input: {
      saas: z.string().optional(),
      customer_name: z.string().describe("Aparece no formulário."),
      customer_id: z.string().optional().describe("Quando já existe ficha."),
      lead_id: z.string().optional(),
      phone: z.string().optional().describe("Só fica anotado; nada é enviado."),
    },
  }, async ({ saas, customer_name, customer_id, lead_id, phone }) => {
    const product = saas ? await resolveProduct(saas) : null;
    if (!customer_id && !lead_id) throw new Error("informe `customer_id` (cliente) ou `lead_id` (lead que fechou).");
    const created = await http.post("/api/integration_forms", defined({
      saas: product?.id,
      customerName: customer_name,
      customerId: customer_id || "",
      leadId: lead_id || "",
      phone,
    }));
    return result({
      kind: "intform.created",
      title: `Formulário solicitado · ${created.customerName || created.id}`,
      scope: { id: created.id, saas: created.saas || "" },
      totals: { id: created.id, status: created.status || "pendente", link: `${API_BASE}/fi/${created.id}`, pedidoEm: created.createdAt || "" },
      notes: ["o id/token é gerado no servidor: qualquer pessoa com o link responde, então mande direto pro cliente."],
      source: { endpoint: "POST /api/integration_forms" },
    });
  });

  tool("intform_delete", {
    group: GROUP_INT,
    title: "Excluir pedido de integração",
    description: "Apaga o pedido: o link morre e as respostas enviadas somem.",
    write: true, destructive: true,
    danger: "apaga as respostas assinadas pelo cliente — não tem desfazer.",
    input: { id: z.string() },
  }, async ({ id }) => {
    const antes = await http.get(`/api/integration_forms/${encodeURIComponent(id)}`).catch(() => null);
    await http.del(`/api/integration_forms/${encodeURIComponent(id)}`);
    return result({
      kind: "intform.deleted",
      title: `Pedido excluído · ${antes?.customerName || id}`,
      scope: { id },
      totals: { id, cliente: antes?.customerName || "", status: antes?.status || "", tinhaRespostas: !!antes?.respondedAt },
      source: { endpoint: `DELETE /api/integration_forms/${id}` },
    });
  });

  // ══════════════════ ANÁLISE DE PITCH (roteiro da call) ══════════════════

}
