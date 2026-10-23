// Régua de nota/ICP editável por produto (docs/PLANO-ICP-CONFIGURAVEL.md):
// gravação versionada, histórico, prévia de impacto e recálculo da
// classificação dos leads. As rotas ficam em routes.icp.js.

import { actionFor, defaultRules, gradeRulesOf, GRADES, icpGradesOf, leadGradeInfo, REVENUE_GRADE_VERSION } from "../shared/lead-grade.js";
import { cleanIcpText, rulesKey, validateIcpRules } from "../shared/icp-rules.js";
import { regradePatch } from "./classificacao.js";
import { dayKey } from "../metrics/metrics-core.js";

const DAY_MS = 86400000;
const TEXT_KEYS = ["headline", "pill", "contact", "profile", "redFlags"];

// A régua mudou (ou o boot achou classificação defasada): refaz a nota gravada
// em cada lead do produto. Só grava quem mudou de nota — cada escrita acorda o
// SSE de todas as abas — e nunca toca etapa, responsáveis, agenda ou cadência.
export async function recalcClassifications(repo, product, { rules = gradeRulesOf(product), now = new Date() } = {}) {
  if (!product?.id) return 0;
  let changed = 0;
  for (const lead of await repo.listWhere("leads", { saas: product.id })) {
    const patch = regradePatch(lead, rules, now);
    if (!patch) continue;
    await repo.update("leads", lead.id, patch);
    changed++;
  }
  return changed;
}

// Perguntas com opções que podem virar eixo da régua: as do cadastro do lead
// (product.leadQuestions) e as dos formulários PUBLICADOS do produto — o
// formulário pode perguntar coisa que o cadastro não tem (ex.: "momento" na
// UniqueKids). Mesma chave: as opções se somam, o rótulo do cadastro vence.
export function icpQuestions(product, forms = []) {
  const out = new Map();
  const clean = (label) => String(label || "").replace(/\*/g, "").trim();
  const add = (q, source) => {
    const opts = (Array.isArray(q?.options) ? q.options : []).map((o) => (typeof o === "string" ? { value: o, label: o } : { value: String(o?.value ?? ""), label: clean(o?.label || o?.value) })).filter((o) => o.value);
    if (!q?.key || !opts.length) return;
    const cur = out.get(q.key) || { key: q.key, label: clean(q.label) || q.key, options: [], sources: [] };
    for (const o of opts) if (!cur.options.some((x) => x.value === o.value)) cur.options.push(o);
    if (!cur.sources.includes(source)) cur.sources.push(source);
    out.set(q.key, cur);
  };
  for (const q of product?.leadQuestions || []) add(q, "cadastro");
  for (const f of forms) if (f?.saas === product?.id && f.status === "published") for (const q of f.questions || []) add(q, f.name || f.id);
  return [...out.values()];
}

// Estado da régua do produto pra tela: a vigente (padrão quando não há régua
// gravada), o texto do cartão e as perguntas disponíveis para os eixos.
export function icpState(product, forms = []) {
  const rules = gradeRulesOf(product);
  const icp = product?.icp || {};
  return {
    saas: product.id,
    custom: rules !== defaultRules(product.id),
    rules,
    text: Object.fromEntries(TEXT_KEYS.map((k) => [k, icp[k] ?? (k === "profile" || k === "redFlags" ? [] : "")])),
    questions: icpQuestions(product, forms),
    updatedAt: icp.rulesUpdatedAt || rules.updatedAt || null,
    updatedBy: icp.rulesUpdatedBy || rules.updatedBy || null,
  };
}

// Prévia: o que mudaria se a régua proposta valesse hoje — mudança de nota,
// entradas e saídas do ICP, calls futuras que trocam de pool (sênior × júnior)
// e o "% de ICP por mês" antes e depois. Leads de teste (internal) ficam fora.
export async function icpPreview(repo, product, proposed, { now = new Date(), days = 90, sampleSize = 30 } = {}) {
  const current = gradeRulesOf(product);
  const icpNow = icpGradesOf(current);
  const icpNext = icpGradesOf(proposed);
  const since = new Date(now.getTime() - days * DAY_MS).toISOString();
  const today = now.toISOString();
  const leads = (await repo.listWhere("leads", { saas: product.id })).filter((l) => !l.internal);
  const empty = () => ({ leads: 0, changed: 0, icpIn: 0, icpOut: 0, icpBefore: 0, icpAfter: 0, ungradedBefore: 0, ungradedAfter: 0, actionChanged: 0 });
  const total = empty();
  const recent = empty();
  const moves = {}; // "A→C" -> n (janela)
  const methods = {}; // método da régua proposta -> n (janela)
  const byMonth = new Map();
  const samples = [];
  const callMoves = [];
  for (const l of leads) {
    const a = leadGradeInfo(l, current);
    const b = leadGradeInfo(l, proposed);
    const wasIcp = !!a.grade && icpNow.has(a.grade);
    const isIcp = !!b.grade && icpNext.has(b.grade);
    const inWindow = String(l.createdAt || "") >= since;
    // Ação do SDR (nota × intenção medida) antes e depois — só quem tem a intenção gravada.
    const snap = l.classificacao && typeof l.classificacao === "object" && "intencaoMedida" in l.classificacao ? l.classificacao : null;
    const col = snap?.intencaoMedida ? snap.intencao : "media";
    const actionMoved = !!snap && actionFor(current, a.grade, col) !== actionFor(proposed, b.grade, col);
    for (const bucket of inWindow ? [total, recent] : [total]) {
      bucket.leads++;
      if (actionMoved) bucket.actionChanged++;
      if (a.grade !== b.grade) bucket.changed++;
      if (!wasIcp && isIcp) bucket.icpIn++;
      if (wasIcp && !isIcp) bucket.icpOut++;
      if (wasIcp) bucket.icpBefore++;
      if (isIcp) bucket.icpAfter++;
      if (!a.grade) bucket.ungradedBefore++;
      if (!b.grade) bucket.ungradedAfter++;
    }
    if (inWindow) {
      methods[b.method || "sem nota"] = (methods[b.method || "sem nota"] || 0) + 1;
      if (a.grade !== b.grade) {
        const k = `${a.grade || "–"}→${b.grade || "–"}`;
        moves[k] = (moves[k] || 0) + 1;
        if (samples.length < sampleSize) samples.push({ id: l.id, name: l.name || "", company: l.company || "", from: a.grade, to: b.grade, createdAt: l.createdAt || "" });
      }
    }
    // Call ainda por acontecer cujo lead muda de lado na régua do sênior.
    if (l.callAt && String(l.callAt) >= today.slice(0, 16) && wasIcp !== isIcp) {
      callMoves.push({ id: l.id, name: l.name || "", callAt: l.callAt, closer: l.closer || "", from: a.grade, to: b.grade, pool: isIcp ? "upper" : "junior" });
    }
    const month = l.createdAt ? dayKey(l.createdAt).slice(0, 7) : "";
    if (month) {
      const m = byMonth.get(month) || { month, leads: 0, icpBefore: 0, icpAfter: 0 };
      m.leads++;
      if (wasIcp) m.icpBefore++;
      if (isIcp) m.icpAfter++;
      byMonth.set(month, m);
    }
  }
  const months = [...byMonth.values()].sort((x, y) => x.month.localeCompare(y.month)).slice(-12);
  return {
    saas: product.id, days, total, recent,
    moves: Object.entries(moves).sort((x, y) => y[1] - x[1]).map(([move, n]) => ({ move, n })),
    methods, months, samples, calls: callMoves.slice(0, 50), callsChanging: callMoves.length,
    grades: GRADES,
  };
}

// Grava texto e/ou régua. A régua ganha versão nova (trava otimista por
// `baseVersion`), entra no histórico `icp_versions` e dispara o recálculo.
// Erros de validação e conflito voltam com statusCode pra rota.
export async function saveIcp(repo, product, body = {}, { by = "api", now = new Date() } = {}) {
  const fail = (statusCode, error, extra = {}) => Object.assign(new Error(error), { statusCode, ...extra });
  const icp = product.icp || {};
  const patch = { ...icp };
  if (body.text !== undefined) Object.assign(patch, cleanIcpText(body.text));
  let rulesChanged = false;
  const current = gradeRulesOf(product);
  const currentVersion = Number(current.version) || 0;
  if (body.rules !== undefined) {
    if (body.baseVersion !== undefined && Number(body.baseVersion) !== currentVersion) {
      throw fail(409, "A régua foi alterada por outra pessoa. Recarregue antes de salvar.", { currentVersion });
    }
    const v = validateIcpRules(body.rules);
    if (!v.ok) throw fail(400, v.errors[0], { errors: v.errors });
    // A régua atual passa pela mesma limpeza: a padrão, sem tabela de ações
    // gravada, não pode parecer "mudada" só pela forma.
    const cur = validateIcpRules(current);
    rulesChanged = rulesKey(v.rules) !== rulesKey(cur.ok ? cur.rules : current);
    if (rulesChanged) {
      patch.rules = { ...v.rules, version: currentVersion + 1, updatedAt: now.toISOString(), updatedBy: by, note: String(body.note || "").slice(0, 280) };
    }
  }
  const textChanged = TEXT_KEYS.some((k) => JSON.stringify(patch[k]) !== JSON.stringify(icp[k]));
  if (!rulesChanged && !textChanged) return { product, changed: false, recalculated: 0, version: currentVersion };
  if (textChanged) {
    patch.updatedAt = dayKey(now.toISOString());
    // O texto editado vence a atualização única do boot (ensureRevenueClassification).
    patch.classificationVersion ||= REVENUE_GRADE_VERSION;
  }
  const updated = await repo.update("products", product.id, { icp: patch });
  if (rulesChanged || textChanged) {
    const version = Number(patch.rules?.version ?? currentVersion) || 0;
    await repo.create("icp_versions", {
      saas: product.id, version, kind: rulesChanged ? "rules" : "text",
      rules: gradeRulesOf(updated), text: Object.fromEntries(TEXT_KEYS.map((k) => [k, patch[k]])),
      by, at: now.toISOString(), note: String(body.note || "").slice(0, 280),
    });
  }
  const recalculated = rulesChanged ? await recalcClassifications(repo, updated, { now }) : 0;
  return { product: updated, changed: true, recalculated, version: Number(patch.rules?.version ?? currentVersion) || 0 };
}

export async function icpVersions(repo, saas, { limit = 50 } = {}) {
  return (await repo.listWhere("icp_versions", { saas }))
    .sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")))
    .slice(0, limit);
}

// Evolução do ICP pela régua VIGENTE (vale para o passado): leads por mês de
// entrada, quantos são ICP, sem nota e avaliados pelo legado, mais as datas em
// que a régua mudou (marcos). Leitura aberta.
export async function icpTrend(repo, product, { months = 12 } = {}) {
  const rules = gradeRulesOf(product);
  const icp = icpGradesOf(rules);
  const byMonth = new Map();
  for (const l of await repo.listWhere("leads", { saas: product.id })) {
    if (l.internal || !l.createdAt) continue;
    const month = dayKey(l.createdAt).slice(0, 7);
    const info = leadGradeInfo(l, rules);
    const m = byMonth.get(month) || { month, leads: 0, icp: 0, ungraded: 0, legacy: 0 };
    m.leads++;
    if (info.grade && icp.has(info.grade)) m.icp++;
    if (!info.grade) m.ungraded++;
    if (info.legacy) m.legacy++;
    byMonth.set(month, m);
  }
  const markers = (await icpVersions(repo, product.id, { limit: 200 }))
    .filter((v) => v.kind === "rules")
    .map((v) => ({ version: v.version, at: v.at, month: dayKey(v.at).slice(0, 7), note: v.note || "" }));
  return {
    saas: product.id, version: Number(rules.version) || 0, icpGrades: [...icp],
    months: [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month)).slice(-months),
    markers,
  };
}
