// Catálogo de PLANOS: a coleção `plans` é a fonte única do que se vende
// (linha × pacote, preço por ciclo, limites, entregáveis, produto de acesso).
//
// Até aqui o catálogo morava dentro do template de proposta
// (`proposal_templates.calc.catalog`) e a coleção `plans` era um cadastro solto
// que a venda nunca usou. A dependência inverte: o plano manda, e o
// `calc.catalog` dos templates vira PROJEÇÃO dele. O renderer da proposta não
// muda (continua lendo o mesmo shape), e proposta já gerada não é tocada: a
// projeção só escreve em template, cada proposta carrega a própria cópia.
//
// Plano v2 (`v: 2`, com `code`) convive com o doc antigo de `plans`
// (`{ name, cycle, price }`, sem `code`), que segue pelo CRUD genérico sem regra.
//
// Limites: chave AUSENTE = não se aplica ao plano; `null` = ilimitado.

import { CYCLE_MONTHS } from "./plan-cycles.js";
import {
  PRODUCT_KEYS, PRODUCT_LABEL, LEGACY_PRODUCT_LABEL, DEAL_PRODUCT_LABEL, ONE_OFF_KEY,
  hasCatalog, moneyOf, fmtBR,
} from "./proposal-catalog.js";
import { defaultResources, PLAN_PRODUCTS, planProductOf, planAccessOf } from "./plan-resources.js";
import { MENTORIA_PRODUCT_IDS, MENTORIA_PRODUCTS, MENTORIA_TEMPLATE_ID, hasMentoria } from "./mentoria.js";

export const PLAN_VERSION = 2;
export const PLAN_KINDS = ["subscription", "one_off", "legacy"];
export const ACCESS_PRODUCTS = ["leverads", "leverprice"];
export const PLAN_CODE_RE = /^[a-z0-9_]+$/i;
const PRICE_LOG_MAX = 20;
const SEED_FLAG = "plans_catalog_v1";

// Templates que carregam a projeção do catálogo de cada produto. Lista
// explícita: outro deck do mesmo produto pode ter um catálogo próprio de
// propósito, e a projeção não pode atropelar.
const CATALOG_TEMPLATES = { leverads: ["pt_leverads", "pt_leverads_slides"] };
const MENTORIA_SAAS = "leverads";
const MENTORIA_PRICE_LABEL = "à vista ou 12x no cartão";
// Ciclo do plano ↔ chave do ciclo no catálogo da proposta.
// Nomes dos planos como a planilha "planos lever" os chama (02/10/2026). O
// nome antigo é o que a semente trazia do catálogo das apresentações: plano
// que ainda o tem é renomeado uma vez; nome editado pelo admin fica.
const ENTERPRISE_NAME = { oem: "Ads Enterprise + OEM", ads: "Ads Enterprise" };
const PLAN_RENAMES = {
  oem_essencial: ["Lever OEM \u00b7 Essencial", "Ads Essencial + OEM"],
  oem_escala: ["Lever OEM \u00b7 Escala", "Ads Escala + OEM"],
  oem_enterprise: ["Lever OEM \u00b7 Enterprise", "Ads Enterprise + OEM"],
  ads_essencial: ["Lever Ads \u00b7 Essencial", "Ads Essencial"],
  ads_escala: ["Lever Ads \u00b7 Escala", "Ads Escala"],
  ads_enterprise: ["Lever Ads \u00b7 Enterprise", "Ads Enterprise"],
};
const CATALOG_CYCLE = { annual: "anu", semiannual: "sem" };
const CLOSED_PLAN_OF_CYCLE = { annual: "anual", semiannual: "semestral" };
const CLOSED_PLAN_LABEL_OF_CYCLE = { annual: "Anual", semiannual: "Semestral" };
// Linha do catálogo → produto em que o plano libera acesso.
const ACCESS_OF_LINE = { oem: "leverads", ads: "leverads", price: "leverprice" };
// Linha do catálogo → produto vendido (como a tela de Planos agrupa).
const PRODUCT_OF_LINE = { oem: "leverads", ads: "leverads", price: "leverprice" };

export const planIdOf = (saas, code) => `plan_${saas}_${code}`;
export const isPlanV2 = (p) => Number(p?.v) === PLAN_VERSION && !!p?.code;
const clone = (o) => JSON.parse(JSON.stringify(o));

// Igualdade por CONTEÚDO, sem depender da ordem das chaves: o Postgres (JSONB)
// devolve o objeto com as chaves reordenadas, e comparar por JSON.stringify
// faria a projeção regravar o template a cada boot.
const canon = (v) => {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === "object") {
    return Object.fromEntries(Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => [k, canon(v[k])]));
  }
  return v;
};
export const sameJson = (a, b) => JSON.stringify(canon(a ?? null)) === JSON.stringify(canon(b ?? null));

const productKeysOf = (products) => PRODUCT_KEYS
  .filter((k) => products?.[k])
  .concat(Object.keys(products || {}).filter((k) => !PRODUCT_KEYS.includes(k)));

// ── Catálogo do template → planos ──────────────────────────────────────────
// Campos do produto que o plano guarda com nome próprio; o resto vai em `extra`
// e volta igual na projeção (nada do que está no banco se perde na ida e volta).
const KNOWN_PRODUCT_FIELDS = new Set([
  "line", "tier", "name", "contas", "cota", "cotaAno", "cotaLabel", "equalizacao", "limite", "limiteLabel", "inclui", "anu", "sem",
]);

function planFromProduct(saas, key, P, { lines = {}, order = 0 } = {}) {
  const line = String(P.line || String(key).split("_")[0] || "");
  const tier = String(P.tier || String(key).split("_")[1] || "");
  const prices = {};
  for (const [cycle, k] of Object.entries(CATALOG_CYCLE)) {
    if (P[k]) prices[cycle] = { ...P[k], installments: CYCLE_MONTHS[cycle] };
  }
  const limits = {};
  if ("contas" in P) limits.accounts = P.contas;
  if ("cota" in P) limits.oemPerMonth = Number(P.cota) > 0 ? P.cota : null;
  if ("cotaAno" in P) limits.oemPerYear = Number(P.cotaAno) > 0 ? P.cotaAno : null;
  if ("limite" in P) limits.listings = Number(P.limite) > 0 ? P.limite : null;
  const features = {};
  if ("equalizacao" in P) features.equalizacao = !!P.equalizacao;
  const labels = {};
  if (P.cotaLabel) labels.cotaLabel = P.cotaLabel;
  if (P.limiteLabel) labels.limiteLabel = P.limiteLabel;
  const extra = Object.fromEntries(Object.entries(P).filter(([k]) => !KNOWN_PRODUCT_FIELDS.has(k)));
  return {
    id: planIdOf(saas, key), v: PLAN_VERSION, saas, code: key,
    name: P.name || PRODUCT_LABEL[key] || key,
    kind: "subscription", pricing: "table",
    product: PRODUCT_OF_LINE[line] || "leverads",
    access: { product: ACCESS_OF_LINE[line] || "" },
    line, tier, group: lines[line]?.name || line, order,
    status: "active",
    prices, options: [], limits, features,
    deliverables: clone(P.inclui || {}), labels, extra,
  };
}

// Planos derivados do catálogo v2 de um template: os produtos com preço, o
// Enterprise sob consulta das linhas que o têm, o pacote de OEM avulso e as
// chaves do catálogo anterior (arquivadas, só pra nomear venda antiga).
export function catalogToPlans(catalog, { saas } = {}) {
  const cat = catalog || {};
  const products = cat.products || {};
  const lines = cat.lines || {};
  const out = [];
  let order = 0;
  for (const key of productKeysOf(products)) {
    out.push(planFromProduct(saas, key, products[key], { lines, order: (order += 10) }));
  }
  for (const [line, def] of Object.entries(lines)) {
    const key = `${line}_enterprise`;
    if (!def?.enterprise || products[key]) continue;
    out.push({
      id: planIdOf(saas, key), v: PLAN_VERSION, saas, code: key,
      name: ENTERPRISE_NAME[line] || `${def.name || line} · Enterprise`,
      kind: "subscription", pricing: "custom",
      product: PRODUCT_OF_LINE[line] || "leverads",
      access: { product: ACCESS_OF_LINE[line] || "" },
      line, tier: "enterprise", group: def.name || line, order: (order += 10),
      status: "active",
      prices: {}, options: [], limits: {}, features: {}, deliverables: {}, labels: { priceLabel: def.enterprise }, extra: {},
    });
  }
  const packs = Array.isArray(cat.oemPacks) ? cat.oemPacks : [];
  if (packs.length) {
    out.push({
      id: planIdOf(saas, ONE_OFF_KEY), v: PLAN_VERSION, saas, code: ONE_OFF_KEY,
      name: DEAL_PRODUCT_LABEL[ONE_OFF_KEY],
      kind: "one_off", pricing: "table", product: "leverads", access: { product: "" },
      line: "oem", tier: "", group: "Adicionais", order: (order += 10),
      status: "active",
      prices: {}, options: clone(packs), limits: {}, features: {}, deliverables: {},
      labels: { optionUnit: "anúncios OEM" }, extra: {},
    });
  }
  for (const [key, name] of Object.entries(LEGACY_PRODUCT_LABEL)) {
    out.push({
      id: planIdOf(saas, key), v: PLAN_VERSION, saas, code: key, name,
      kind: "legacy", pricing: "custom", product: "leverads", access: { product: saas === "leverads" ? "leverads" : "" },
      line: "", tier: "", group: "Catálogo anterior", order: (order += 10),
      status: "archived",
      prices: {}, options: [], limits: {}, features: {}, deliverables: {}, labels: {}, extra: {},
    });
  }
  return out;
}

// O que é do catálogo mas não é plano: nome das linhas, régua contas → pacote e
// os adicionais. Mora em app_config/plan_catalog_<saas>.
export const catalogConfigId = (saas) => `plan_catalog_${saas}`;
// Produto de um id de app_config do catálogo ("" pro marcador da semente);
// null quando o id não é do catálogo de planos.
export function catalogConfigSaas(id) {
  const s = String(id ?? "");
  if (s === SEED_FLAG || s === RESOURCES_FLAG) return "";
  return s.startsWith("plan_catalog_") ? s.slice("plan_catalog_".length) : null;
}
export function catalogToConfig(catalog) {
  const cat = catalog || {};
  return clone({ lines: cat.lines || {}, tierByAccounts: cat.tierByAccounts || {}, addons: cat.addons || {} });
}

export function mentoriaToPlans(block, { saas = MENTORIA_SAAS } = {}) {
  const products = block?.products || {};
  const out = [];
  let order = 1000;
  for (const id of MENTORIA_PRODUCT_IDS.concat(Object.keys(products).filter((k) => !MENTORIA_PRODUCT_IDS.includes(k)))) {
    const db = products[id];
    if (!db) continue;
    const { name, price, ...extra } = db;
    out.push({
      id: planIdOf(saas, id), v: PLAN_VERSION, saas, code: id,
      name: name || MENTORIA_PRODUCTS[id]?.name || id,
      kind: "one_off", pricing: "table", product: "mentoria", access: { product: "" },
      line: "mentoria", tier: "", group: "Mentoria", order: (order += 10),
      status: "active",
      prices: { once: { total: price ?? MENTORIA_PRODUCTS[id]?.price ?? 0 } },
      options: [], limits: {}, features: {}, deliverables: {},
      labels: { priceLabel: MENTORIA_PRICE_LABEL }, extra,
    });
  }
  return out;
}

// ── Planos → catálogo do template (projeção) ───────────────────────────────
const byOrder = (a, b) => (Number(a.order) || 0) - (Number(b.order) || 0) || String(a.code).localeCompare(String(b.code));
const selling = (p) => isPlanV2(p) && p.status !== "archived";
const isMentoriaPlan = (p) => p.line === "mentoria";
const deckPlans = (plans) => plans.filter((p) => selling(p) && p.kind === "subscription" && p.pricing !== "custom").sort(byOrder);

function productFromPlan(p) {
  const P = { ...(p.extra || {}), line: p.line, tier: p.tier, name: p.name };
  const limits = p.limits || {};
  if ("accounts" in limits) P.contas = limits.accounts;
  if ("oemPerMonth" in limits) P.cota = limits.oemPerMonth ?? 0;
  if ("oemPerYear" in limits) P.cotaAno = limits.oemPerYear ?? 0;
  if ("listings" in limits) P.limite = limits.listings ?? 0;
  if (p.features && "equalizacao" in p.features) P.equalizacao = !!p.features.equalizacao;
  if (p.labels?.cotaLabel) P.cotaLabel = p.labels.cotaLabel;
  if (p.labels?.limiteLabel) P.limiteLabel = p.labels.limiteLabel;
  P.inclui = clone(p.deliverables || {});
  for (const [cycle, k] of Object.entries(CATALOG_CYCLE)) {
    if (!p.prices?.[cycle]) continue;
    const { installments, ...price } = p.prices[cycle];
    P[k] = price;
  }
  return P;
}

// Devolve o catálogo do template com a parte de PRODUTO vinda dos planos. Régua
// (grid, accounts, volLabels), dores/SPIN e os marcadores de versão ficam como
// estão em `currentCatalog`.
export function plansToCatalog(plans, config, currentCatalog) {
  const mine = (plans || []).filter((p) => !isMentoriaPlan(p));
  const products = {};
  for (const p of deckPlans(mine)) products[p.code] = productFromPlan(p);
  const pack = mine.find((p) => selling(p) && p.code === ONE_OFF_KEY);
  const cfg = config || {};
  return {
    ...(currentCatalog || {}),
    products,
    lines: clone(cfg.lines || currentCatalog?.lines || {}),
    addons: clone(cfg.addons || currentCatalog?.addons || {}),
    tierByAccounts: clone(cfg.tierByAccounts || currentCatalog?.tierByAccounts || {}),
    oemPacks: pack ? clone(pack.options || []) : [],
  };
}

export function plansToMentoriaBlock(plans, currentBlock) {
  const products = {};
  for (const p of (plans || []).filter((x) => selling(x) && isMentoriaPlan(x)).sort(byOrder)) {
    products[p.code] = { ...(p.extra || {}), name: p.name, price: p.prices?.once?.total ?? 0 };
  }
  return { ...(currentBlock || {}), products };
}

// ── Planos → catálogo do fechamento (CONFIG.proposals.catalog[saas]) ───────
// Mesmo contrato do dealCatalog/mentoriaDealCatalog: é o que o gate de
// fechamento do card usa pra montar o select de produto e sugerir o valor.
export function dealCatalogFromPlans(plans) {
  const out = [];
  const all = (plans || []).filter(selling).sort(byOrder);
  for (const p of all.filter((x) => !isMentoriaPlan(x) && x.kind === "subscription" && x.pricing !== "custom")) {
    const prices = [];
    for (const cycle of Object.keys(CATALOG_CYCLE)) {
      const total = moneyOf(p.prices?.[cycle]?.total);
      if (total) prices.push({ plan: CLOSED_PLAN_OF_CYCLE[cycle], label: CLOSED_PLAN_LABEL_OF_CYCLE[cycle], value: total });
    }
    out.push({ id: p.code, label: p.name, group: p.group, prices });
  }
  for (const p of all.filter((x) => x.kind === "one_off")) {
    const options = (Array.isArray(p.options) ? p.options : []).filter((k) => k && moneyOf(k.price));
    const prices = options.length
      ? options.map((k) => ({ plan: "unico", label: k.label || `${fmtBR(k.qty)} ${p.labels?.optionUnit || ""}`.trim(), value: moneyOf(k.price) }))
      : [{ plan: "unico", label: p.labels?.priceLabel || "", value: Math.round(Number(p.prices?.once?.total)) || 0 }].filter((x) => x.value);
    if (!prices.length) continue;
    out.push({ id: p.code, label: p.name, group: p.group, oneOff: true, prices });
  }
  return out;
}

// Versão enxuta pro bootstrap (CONFIG.plans[saas]): o que as telas precisam pra
// rotular e escolher plano, sem entregáveis nem histórico de preço.
export const slimPlan = (p) => ({
  id: p.id, code: p.code, name: p.name, kind: p.kind, pricing: p.pricing, product: planProductOf(p), group: p.group,
  line: p.line, tier: p.tier, status: p.status, prices: p.prices || {}, options: p.options || [],
  limits: p.limits || {}, features: p.features || {}, accessProduct: p.access?.product || "", priceVersion: Number(p.priceVersion) || 1,
});

// ── Normalização e versão de preço (escrita pelo REST) ─────────────────────
function normalizePrices(prices) {
  const out = {};
  for (const [cycle, raw] of Object.entries(prices && typeof prices === "object" ? prices : {})) {
    if (!raw || typeof raw !== "object") continue;
    const months = CYCLE_MONTHS[cycle];
    const price = { ...raw };
    if (months) {
      // O valor do negócio é o total do período; o mensal é a parcela dele.
      if (price.per != null && price.total == null) price.total = Math.round(Number(price.per) * months * 100) / 100;
      if (price.total != null && price.per == null) price.per = Math.round((Number(price.total) / months) * 100) / 100;
      price.installments = months;
    }
    out[cycle] = price;
  }
  return out;
}

// Espelho legado (`price`/`cycle`): telas e seletores que ainda leem o plano no
// formato antigo (ChangeModal, planOptions) seguem funcionando.
function legacyMirror(plan) {
  const cycle = ["annual", "semiannual", "quarterly", "monthly"].find((c) => plan.prices?.[c]);
  if (cycle) return { price: moneyOf(plan.prices[cycle].total), cycle };
  return { price: Math.round(Number(plan.prices?.once?.total ?? plan.options?.[0]?.price)) || 0, cycle: "" };
}

const PRICED_FIELDS = ["prices", "limits", "options"];

// Aplica uma mudança a um plano v2: normaliza preço, incrementa a versão de
// preço quando preço/limite/opção muda e recalcula o espelho legado. `before`
// nulo = plano nascendo.
export function nextPlan(before, patch, { by = "", now = new Date().toISOString() } = {}) {
  const next = { ...(before || {}), ...patch };
  next.prices = normalizePrices(next.prices);
  if (!Array.isArray(next.options)) next.options = [];
  if (!next.limits || typeof next.limits !== "object") next.limits = {};
  const priced = (p) => Object.fromEntries(PRICED_FIELDS.map((k) => [k, p?.[k] ?? null]));
  if (!before) {
    next.priceVersion = 1;
    next.priceUpdatedAt = now;
    next.priceLog = [{ v: 1, at: now, by, ...priced(next) }];
  } else if (!sameJson(priced(before), priced(next))) {
    next.priceVersion = (Number(before.priceVersion) || 1) + 1;
    next.priceUpdatedAt = now;
    next.priceLog = [...(Array.isArray(before.priceLog) ? before.priceLog : []), { v: next.priceVersion, at: now, by, ...priced(next) }].slice(-PRICE_LOG_MAX);
  }
  return { ...next, ...legacyMirror(next) };
}

// Corpo de um POST de plano v2 → doc pronto pra criar. Lança { statusCode }.
export function newPlanDoc(body, opts) {
  const fail = (statusCode, message) => Object.assign(new Error(message), { statusCode });
  const saas = String(body?.saas || "").trim();
  const code = String(body?.code || "").trim();
  if (!saas) throw fail(400, "saas é obrigatório");
  if (!PLAN_CODE_RE.test(code)) throw fail(400, "code deve ter só letras, números e _");
  const kind = PLAN_KINDS.includes(body.kind) ? body.kind : "subscription";
  // O PRODUTO vendido define o acesso; `access.product` explícito só vale
  // quando o corpo não diz o produto (integração antiga).
  const sold = PLAN_PRODUCTS.some((p) => p.id === body.product) ? body.product : planProductOf(body);
  const product = body.product ? planAccessOf(sold, kind) : String(body.access?.product || "");
  return nextPlan(null, {
    name: String(body.name || code),
    kind, pricing: body.pricing === "custom" ? "custom" : "table",
    product: sold,
    access: { product: ACCESS_PRODUCTS.includes(product) ? product : "" },
    line: String(body.line || ""), tier: String(body.tier || ""), group: String(body.group || ""),
    order: Number(body.order) || 9000,
    status: body.status === "archived" ? "archived" : "active",
    prices: body.prices, options: body.options, limits: body.limits,
    features: body.features && typeof body.features === "object" ? body.features : {},
    deliverables: body.deliverables && typeof body.deliverables === "object" ? body.deliverables : {},
    labels: body.labels && typeof body.labels === "object" ? body.labels : {},
    extra: {},
    id: planIdOf(saas, code), v: PLAN_VERSION, saas, code,
  }, opts);
}

// ── Acesso ao repositório ──────────────────────────────────────────────────
export async function plansOf(repo, saas) {
  return (await repo.list("plans")).filter((p) => isPlanV2(p) && (!saas || p.saas === saas));
}
export const catalogConfigOf = (repo, saas) => repo.get("app_config", catalogConfigId(saas)).catch(() => null);

// Regrava nos templates o que mudou nos planos. Só escreve quando o conteúdo
// difere. Sem plano v2 do produto (banco ainda não semeado) não faz nada.
export async function syncPlanCatalogProjection(repo, saas) {
  const plans = await plansOf(repo, saas);
  if (!plans.length) return 0;
  let changed = 0;
  const config = await catalogConfigOf(repo, saas);
  for (const id of CATALOG_TEMPLATES[saas] || []) {
    const t = await repo.get("proposal_templates", id);
    if (!t || !hasCatalog(t.calc)) continue;
    const catalog = plansToCatalog(plans, config, t.calc.catalog);
    if (sameJson(catalog, t.calc.catalog)) continue;
    await repo.update("proposal_templates", id, { calc: { ...t.calc, catalog } });
    changed++;
  }
  if (saas === MENTORIA_SAAS && plans.some(isMentoriaPlan)) {
    const t = await repo.get("proposal_templates", MENTORIA_TEMPLATE_ID);
    if (t && hasMentoria(t.calc)) {
      const mentoria = plansToMentoriaBlock(plans, t.calc.mentoria);
      if (!sameJson(mentoria, t.calc.mentoria)) {
        await repo.update("proposal_templates", MENTORIA_TEMPLATE_ID, { calc: { ...t.calc, mentoria } });
        changed++;
      }
    }
  }
  return changed;
}

const CATALOG_LIMIT_KEYS = ["accounts", "oemPerMonth", "oemPerYear", "listings"];
const CATALOG_FEATURE_KEYS = ["equalizacao"];
const omit = (obj, keys) => Object.fromEntries(Object.entries(obj || {}).filter(([k]) => !keys.includes(k)));

async function upsertDerived(repo, derived, { by, now, create = true } = {}) {
  let n = 0;
  for (const d of derived) {
    const cur = await repo.get("plans", d.id);
    if (!cur) {
      if (create) { await repo.create("plans", nextPlan(null, d, { by, now })); n++; }
      continue;
    }
    // Do template só vem o que o catálogo descreve; status, ordem e produto de
    // acesso são do plano e ficam como estão.
    const { status, order, access, kind, pricing, product, ...fromCatalog } = d;
    // Limite e recurso que o catálogo da proposta não conhece (cópias por dia,
    // módulos do produto) são do plano: a edição pelo template não os apaga.
    fromCatalog.limits = { ...omit(cur.limits, CATALOG_LIMIT_KEYS), ...d.limits };
    fromCatalog.features = { ...omit(cur.features, CATALOG_FEATURE_KEYS), ...d.features };
    const next = nextPlan(cur, fromCatalog, { by, now });
    if (sameJson(next, cur)) continue;
    await repo.update("plans", d.id, next);
    n++;
  }
  return n;
}

// Semente: cria os planos a partir do catálogo QUE ESTÁ NO BANCO (preço editado
// pelo dono é o que vale, não o default do código). Uma vez por fonte, com
// marcador em app_config; a mentoria semeia quando o template dela existir.
// `defaults` = catálogo padrão por produto (o da semente das propostas):
// banco em que o produto existe mas o template de proposta ainda não tem
// catálogo (ambiente novo) ganha os planos do padrão, pra a tela de Planos não
// nascer vazia. Com o template presente, é sempre o catálogo DELE que vale.
export async function ensurePlansCatalog(repo, { defaults = {} } = {}) {
  const flag = await repo.get("app_config", SEED_FLAG).catch(() => null);
  const done = { ...(flag?.seeded || {}) };
  const now = new Date().toISOString();
  let created = 0;
  for (const [saas, [source]] of Object.entries(CATALOG_TEMPLATES)) {
    if (done[saas]) continue;
    const t = await repo.get("proposal_templates", source);
    let catalog = t && hasCatalog(t.calc) ? t.calc.catalog : null;
    if (!catalog && defaults[saas] && await repo.get("products", saas).catch(() => null)) catalog = defaults[saas];
    if (!catalog) continue;
    for (const d of catalogToPlans(catalog, { saas })) {
      if (await repo.get("plans", d.id)) continue;
      await repo.create("plans", nextPlan(null, d, { by: "migration", now }));
      created++;
    }
    const cfgId = catalogConfigId(saas);
    if (!(await repo.get("app_config", cfgId).catch(() => null))) {
      await repo.create("app_config", { id: cfgId, ...catalogToConfig(catalog), updatedAt: now });
    }
    done[saas] = true;
  }
  if (!done.mentoria) {
    const t = await repo.get("proposal_templates", MENTORIA_TEMPLATE_ID);
    if (t && hasMentoria(t.calc)) {
      for (const d of mentoriaToPlans(t.calc.mentoria)) {
        if (await repo.get("plans", d.id)) continue;
        await repo.create("plans", nextPlan(null, d, { by: "migration", now }));
        created++;
      }
      done.mentoria = true;
    }
  }
  if (!sameJson(done, flag?.seeded || {})) {
    if (flag) await repo.update("app_config", SEED_FLAG, { seeded: done, at: now });
    else await repo.create("app_config", { id: SEED_FLAG, seeded: done, at: now });
  }
  return created;
}

// Recursos do plano modelados em cima da org do LeverAds (plan-resources.js):
// os planos de assinatura do LeverAds que ainda não declaram cópias por dia e
// módulos ganham o padrão da tabela "Planos × Recursos". Uma vez POR PLANO
// (carimbo `resourcesV` no doc): plano semeado depois também passa por aqui, e
// daí em diante quem manda é a edição do admin. Não mexe em preço, e limite que
// o plano já tinha (contas, cota de OEM) fica como está.
const RESOURCES_FLAG = "plan_resources_v1"; // marcador antigo (global); segue reservado
const RESOURCES_V = 1;
export async function ensurePlanResources(repo) {
  const all = (await plansOf(repo)).filter((p) => Number(p.resourcesV) !== RESOURCES_V);
  if (!all.length) return null;
  const now = new Date().toISOString();
  let changed = 0;
  for (const p of all) {
    const withResources = p.kind === "subscription" && p.pricing !== "custom" && p.access?.product === "leverads";
    const rename = PLAN_RENAMES[p.code] && p.name === PLAN_RENAMES[p.code][0] ? { name: PLAN_RENAMES[p.code][1] } : {};
    const next = nextPlan(p, { ...(withResources ? defaultResources(p) : {}), ...rename, resourcesV: RESOURCES_V }, { by: "migration", now });
    await repo.update("plans", p.id, next);
    if (withResources || rename.name) changed++;
  }
  return changed;
}

// O que um PATCH de template muda na parte de PRODUTO do catálogo (o que é
// preço/limite e por isso pede admin). null = não mexe em produto.
export function templateCatalogChange(template, patch) {
  const calc = patch?.calc;
  if (!calc || !template) return null;
  const saas = template.saas;
  const out = {};
  if ((CATALOG_TEMPLATES[saas] || []).includes(template.id) && hasCatalog(calc)) {
    const pick = (c) => ({ products: c?.products || {}, lines: c?.lines || {}, addons: c?.addons || {}, oemPacks: c?.oemPacks || [], tierByAccounts: c?.tierByAccounts || {} });
    if (!sameJson(pick(calc.catalog), pick(template.calc?.catalog))) out.catalog = calc.catalog;
  }
  if (template.id === MENTORIA_TEMPLATE_ID && hasMentoria(calc)
    && !sameJson(calc.mentoria.products, template.calc?.mentoria?.products)) out.mentoria = calc.mentoria;
  return Object.keys(out).length ? { saas, ...out } : null;
}

// Tabela de preço editada pelo template (editor da tela de Propostas): a edição
// vira mudança nos PLANOS e a projeção devolve o resultado aos templates. O
// editor não cria nem remove produto, então plano ausente do catálogo editado
// fica como está.
export async function applyTemplateCatalogEdit(repo, change, { by = "" } = {}) {
  const now = new Date().toISOString();
  const { saas } = change;
  if (change.catalog) {
    // Plano sob consulta (Enterprise) e os legados não têm preço no catálogo:
    // o que o admin ajustou neles (limites negociados) não é do template.
    await upsertDerived(repo, catalogToPlans(change.catalog, { saas }).filter((d) => d.pricing !== "custom"), { by, now });
    const cfgId = catalogConfigId(saas);
    const config = catalogToConfig(change.catalog);
    const cur = await repo.get("app_config", cfgId).catch(() => null);
    if (!cur) await repo.create("app_config", { id: cfgId, ...config, updatedAt: now });
    else if (!sameJson(config, { lines: cur.lines, tierByAccounts: cur.tierByAccounts, addons: cur.addons })) {
      await repo.update("app_config", cfgId, { ...config, updatedAt: now });
    }
  }
  if (change.mentoria) await upsertDerived(repo, mentoriaToPlans(change.mentoria, { saas }), { by, now });
  return syncPlanCatalogProjection(repo, saas);
}

// Plano em uso não se apaga (arquiva): assinatura, cliente ou negócio fechado
// apontam pra ele pelo id ou pelo código.
export async function planReferences(repo, plan) {
  const subs = (await repo.list("subscriptions")).filter((s) => s.plan === plan.id || (s.saas === plan.saas && s.planCode === plan.code)).length;
  const customers = (await repo.list("customers")).filter((c) => c.saas === plan.saas && (c.planCode === plan.code || c.dealProduct === plan.code)).length;
  const leads = (await repo.listWhere("leads", { saas: plan.saas, dealProduct: plan.code }, { fields: [] })).length;
  return { subs, customers, leads, total: subs + customers + leads };
}
