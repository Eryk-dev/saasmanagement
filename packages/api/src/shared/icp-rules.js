// Validação da régua de nota/ICP (docs/PLANO-ICP-CONFIGURAVEL.md). Pura e
// compartilhada: a API valida antes de gravar e a tela de Ajustes mostra os
// mesmos erros antes de enviar. Devolve a régua LIMPA (só campos conhecidos).
import { ACTION_IDS, DEFAULT_ACTIONS, DEFAULT_MQL, GRADES, INTENT_COLS } from "./lead-grade.js";

const MAX_METHODS = 6;
const MAX_AXES = 4;
const str = (v, max = 120) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const isMap = (v) => !!v && typeof v === "object" && !Array.isArray(v);

function cleanAxis(axis, kind, where, errors, depth = 0) {
  if (!isMap(axis)) { errors.push(`${where}: eixo inválido`); return null; }
  const key = str(axis.key, 60);
  if (!key) errors.push(`${where}: informe a pergunta (chave) do eixo`);
  const field = kind === "matriz" ? "index" : "values";
  const map = isMap(axis[field]) ? axis[field] : null;
  const entries = map ? Object.entries(map) : [];
  if (!entries.length) errors.push(`${where}: o eixo "${key || "?"}" não tem opções com valor`);
  const out = {};
  for (const [opt, raw] of entries) {
    const n = Number(raw);
    const ok = kind === "matriz" ? Number.isInteger(n) && n >= 0 : Number.isFinite(n) && n >= 0;
    if (!ok) errors.push(`${where}: valor inválido para "${opt}" (${kind === "matriz" ? "use 0, 1, 2…" : "use um número ≥ 0"})`);
    else out[String(opt)] = n;
  }
  const clean = { key, [field]: out };
  if (axis.fallback != null) {
    if (depth > 0) errors.push(`${where}: o eixo reserva não pode ter outro reserva`);
    else clean.fallback = cleanAxis(axis.fallback, kind, `${where} (reserva)`, errors, 1);
  }
  return clean;
}

function cleanMethod(m, i, errors) {
  const where = `Método ${i + 1}`;
  if (!isMap(m)) { errors.push(`${where}: inválido`); return null; }
  const type = m.type;
  if (!["produto", "soma", "matriz"].includes(type)) { errors.push(`${where}: tipo deve ser produto, soma ou matriz`); return null; }
  const out = { id: str(m.id, 40) || `m${i + 1}`, type, label: str(m.label, 80) };
  if (m.legacy) out.legacy = true;
  if (type === "matriz") {
    out.rows = cleanAxis(m.rows, "matriz", `${where} (linhas)`, errors);
    out.cols = cleanAxis(m.cols, "matriz", `${where} (colunas)`, errors);
    const grid = Array.isArray(m.grid) ? m.grid : [];
    if (!grid.length || grid.some((row) => !Array.isArray(row) || !row.length)) errors.push(`${where}: a grade precisa de linhas e colunas`);
    else if (grid.flat().some((g) => !GRADES.includes(g))) errors.push(`${where}: a grade só aceita as notas ${GRADES.join(", ")}`);
    out.grid = grid.map((row) => (Array.isArray(row) ? row.map(String) : []));
    const maxIdx = (axis) => Math.max(-1, ...Object.values(axis?.index || {}), ...Object.values(axis?.fallback?.index || {}));
    if (out.rows && maxIdx(out.rows) >= out.grid.length) errors.push(`${where}: há linha apontando para fora da grade`);
    if (out.cols && out.grid.some((row) => maxIdx(out.cols) >= row.length)) errors.push(`${where}: há coluna apontando para fora da grade`);
    return out;
  }
  const axes = Array.isArray(m.axes) ? m.axes : [];
  if (!axes.length) errors.push(`${where}: inclua ao menos um eixo`);
  if (axes.length > MAX_AXES) errors.push(`${where}: no máximo ${MAX_AXES} eixos`);
  out.axes = axes.slice(0, MAX_AXES).map((a, j) => cleanAxis(a, type, `${where}, eixo ${j + 1}`, errors));
  const bands = Array.isArray(m.bands) ? m.bands : [];
  if (!bands.length) errors.push(`${where}: inclua ao menos uma faixa`);
  const seen = new Set();
  const mins = new Set();
  out.bands = [];
  for (const b of bands) {
    const grade = b?.grade;
    const min = Number(b?.min);
    if (!GRADES.includes(grade)) { errors.push(`${where}: faixa com nota inválida`); continue; }
    if (seen.has(grade)) errors.push(`${where}: a nota ${grade} aparece em mais de uma faixa`);
    if (!Number.isFinite(min) || min < 0) errors.push(`${where}: o mínimo da nota ${grade} deve ser um número ≥ 0`);
    else if (mins.has(min)) errors.push(`${where}: duas faixas com o mesmo mínimo (${min})`);
    seen.add(grade);
    mins.add(min);
    out.bands.push({ grade, min });
  }
  // Nota melhor exige valor maior: S acima de A acima de B…
  const ordered = [...out.bands].sort((a, b) => GRADES.indexOf(a.grade) - GRADES.indexOf(b.grade));
  for (let k = 1; k < ordered.length; k++) {
    if (!(ordered[k - 1].min > ordered[k].min)) errors.push(`${where}: a nota ${ordered[k - 1].grade} precisa de mínimo maior que a ${ordered[k].grade}`);
  }
  out.bands = ordered;
  return out;
}

// { ok, errors: string[], rules } — `rules` só vale quando ok.
export function validateIcpRules(input) {
  const errors = [];
  if (!isMap(input)) return { ok: false, errors: ["Régua inválida"], rules: null };
  const methods = Array.isArray(input.methods) ? input.methods : [];
  if (!methods.length) errors.push("Inclua ao menos um método de nota");
  if (methods.length > MAX_METHODS) errors.push(`No máximo ${MAX_METHODS} métodos`);
  const clean = methods.slice(0, MAX_METHODS).map((m, i) => cleanMethod(m, i, errors)).filter(Boolean);
  const ids = clean.map((m) => m.id);
  if (new Set(ids).size !== ids.length) errors.push("Dois métodos com o mesmo identificador");
  const icp = Array.isArray(input.icpGrades) ? [...new Set(input.icpGrades)] : [];
  if (!icp.length) errors.push("Escolha ao menos uma nota que conta como ICP");
  if (icp.some((g) => !GRADES.includes(g))) errors.push(`Notas de ICP aceitas: ${GRADES.join(", ")}`);
  const value = isMap(input.value)
    ? { label: str(input.value.label, 80), prefix: str(input.value.prefix, 8), suffix: str(input.value.suffix, 12) }
    : undefined;
  // Tabela nota × intenção → ação (o que o SDR faz) e corte de MQL; ausentes, valem os padrões.
  const actionsIn = input.actions == null ? DEFAULT_ACTIONS : input.actions;
  if (!isMap(actionsIn)) errors.push("Tabela de ações inválida");
  const actions = {};
  for (const g of GRADES) {
    const row = isMap(actionsIn?.[g]) ? actionsIn[g] : DEFAULT_ACTIONS[g];
    actions[g] = {};
    for (const col of INTENT_COLS) {
      const a = row[col] ?? DEFAULT_ACTIONS[g][col];
      if (!ACTION_IDS.includes(a)) errors.push(`Ação inválida para nota ${g} com intenção ${col}`);
      actions[g][col] = a;
    }
  }
  const mqlIn = isMap(input.mql) ? input.mql : DEFAULT_MQL;
  const minGrade = mqlIn.minGrade ?? DEFAULT_MQL.minGrade;
  const minQualificacao = Number(mqlIn.minQualificacao ?? DEFAULT_MQL.minQualificacao);
  if (!GRADES.includes(minGrade)) errors.push("Nota mínima do MQL inválida");
  if (!Number.isFinite(minQualificacao) || minQualificacao < 0 || minQualificacao > 100) errors.push("Qualificação mínima do MQL deve ficar entre 0 e 100");
  const rules = { methods: clean, icpGrades: GRADES.filter((g) => icp.includes(g)), ...(value ? { value } : {}), actions, mql: { minGrade, minQualificacao } };
  return { ok: errors.length === 0, errors, rules: errors.length ? null : rules };
}

// Texto do selo e do cartão de ICP (o que a topbar e a Visão geral mostram).
export function cleanIcpText(input) {
  const list = (v) => (Array.isArray(v) ? v.map((x) => str(x, 240)).filter(Boolean).slice(0, 12) : []);
  const t = isMap(input) ? input : {};
  return { headline: str(t.headline, 200), pill: str(t.pill, 60), contact: str(t.contact, 200), profile: list(t.profile), redFlags: list(t.redFlags) };
}

// Chave estável da régua para "mudou?": ignora versão/autoria e a ordem das chaves.
export function rulesKey(rules) {
  const { version, updatedAt, updatedBy, note, ...r } = rules || {};
  const sort = (v) => (Array.isArray(v) ? v.map(sort) : isMap(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sort(v[k])])) : v);
  return JSON.stringify(sort(r));
}
