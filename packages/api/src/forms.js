// Domínio do form builder: sanitização pública, validação de respostas com
// branching, mapeamento submission → lead e rate-limit em memória.
//
// Modelo do form (collection `forms`, schemaless):
//   { id, name, saas, status: "draft"|"published",
//     theme: { bg, surface, fg, accent, accentFg, font, radius, logoUrl },
//     welcome: { title, subtitle, button } | null,
//     questions: [{ key, label, type, required, placeholder, help, stack?,
//                   options: [{ value, label, to? }], to?,
//                   stat?, statLabel?, durationMs? }],   // <- tipo "insight"
//     thanks: { title, subtitle, redirectUrl },
//     mapping: { name, email, phone, company, amount } }
//
// Telas (steps): perguntas com `stack: true` rendem NA MESMA TELA da anterior.
// Tipo "insight" = tela de loading com copy persuasiva (stat + auto-avanço),
// sem resposta — sempre tela própria.
//
// Branching: `to` aponta pra `key` de outra pergunta ou "_end". Em perguntas
// `select`, cada opção pode ter seu `to`; o `to` da pergunta vale como fallback.
// Numa tela com várias perguntas, vale o primeiro destino definido (na ordem).
// Sem destino, segue pra próxima tela.

export const QUESTION_TYPES = ["text", "textarea", "email", "phone", "number", "select", "multiselect", "insight"];

// Campos que a página pública pode ver — nada de mapping/saas/metadata interna.
export function publicForm(form) {
  return {
    id: form.id,
    name: form.name,
    theme: form.theme || {},
    welcome: form.welcome || null,
    questions: (form.questions || []).map((q) => ({
      key: q.key, label: q.label, type: q.type || "text", required: !!q.required,
      placeholder: q.placeholder || "", help: q.help || "", stack: !!q.stack,
      options: (q.options || []).map((o) => ({ value: o.value, label: o.label || o.value, to: o.to || "" })),
      to: q.to || "",
      stat: q.stat || "", statLabel: q.statLabel || "",
      durationMs: Number(q.durationMs) > 0 ? Number(q.durationMs) : 2400,
    })),
    thanks: form.thanks || {},
    // Tela final de NÃO-qualificado (branch `_reject`): mensagem de descarte.
    // Sem proposta/redirect/conversão — só a copy. Null = builder ainda não configurou.
    reject: form.reject || null,
  };
}

// Agrupa perguntas em telas: nova tela quando a pergunta não tem `stack`, é
// insight, ou vem logo depois de um insight (insight nunca compartilha tela).
export function buildSteps(questions) {
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

// Percorre o branching do renderer (andando por telas) e devolve tanto o caminho
// (perguntas visitadas) quanto o terminal alcançado: "_end" (qualificado, padrão)
// ou "_reject" (não-qualificado). Guarda contra loops (cada tela visita 1x).
function walkPath(questions, answers) {
  const steps = buildSteps(questions);
  const stepOfKey = new Map();
  steps.forEach((idxs, si) => idxs.forEach((qi) => stepOfKey.set(questions[qi].key, si)));
  const path = [];
  const seen = new Set();
  let s = 0;
  let terminal = "_end"; // chegar ao fim naturalmente = qualificado
  while (s >= 0 && s < steps.length) {
    if (seen.has(s)) break;
    seen.add(s);
    const qs = steps[s].map((i) => questions[i]);
    path.push(...qs);
    let to = "";
    for (const q of qs) {
      if (q.type === "select") {
        const opt = (q.options || []).find((o) => o.value === answers[q.key]);
        if (opt && opt.to) { to = opt.to; break; }
      }
      if (q.to) { to = q.to; break; }
    }
    if (to === "_end" || to === "_reject") { terminal = to; break; }
    s = to && stepOfKey.has(to) ? stepOfKey.get(to) : s + 1;
  }
  return { path, terminal };
}

// Caminho efetivamente percorrido (perguntas) dado um conjunto de respostas.
export function computePath(questions, answers) {
  return walkPath(questions, answers).path;
}

// Terminal alcançado: "_reject" (não-qualificado) ou "_end" (qualificado). É a
// decisão server-authoritative — o frontend não é confiável pra marcar descarte.
export function submissionTerminal(questions, answers) {
  return walkPath(questions, answers).terminal;
}

const isBlank = (v) => v == null || (Array.isArray(v) ? v.length === 0 : String(v).trim() === "");
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_TEXT = 5000;

// Valida `answers` contra a definição do form. Retorna lista de erros (vazia = ok).
// Obrigatoriedade só vale pra perguntas no caminho percorrido (branching pode pular).
export function validateAnswers(form, answers) {
  const errors = [];
  if (!answers || typeof answers !== "object" || Array.isArray(answers)) {
    return ["answers deve ser um objeto { chave: resposta }"];
  }
  const questions = form.questions || [];
  const byKey = new Map(questions.map((q) => [q.key, q]));

  for (const [key, val] of Object.entries(answers)) {
    const q = byKey.get(key);
    if (!q) { errors.push(`pergunta desconhecida: ${key}`); continue; }
    const type = q.type || "text";
    if (type === "insight") { errors.push(`${key}: não aceita resposta`); continue; }
    if (isBlank(val)) continue;
    if (type === "number") {
      if (!Number.isFinite(Number(val))) errors.push(`${key}: número inválido`);
    } else if (type === "email") {
      if (typeof val !== "string" || !EMAIL_RE.test(val.trim())) errors.push(`${key}: e-mail inválido`);
    } else if (type === "select") {
      const ok = (q.options || []).some((o) => o.value === val);
      if (!ok) errors.push(`${key}: opção inválida`);
    } else if (type === "multiselect") {
      const opts = new Set((q.options || []).map((o) => o.value));
      if (!Array.isArray(val) || !val.every((v) => opts.has(v))) errors.push(`${key}: opções inválidas`);
    } else {
      if (typeof val !== "string") errors.push(`${key}: texto esperado`);
      else if (val.length > MAX_TEXT) errors.push(`${key}: texto longo demais`);
    }
  }

  for (const q of computePath(questions, answers)) {
    if (q.type === "insight") continue; // tela de copy — não tem resposta
    if (q.required && isBlank(answers[q.key])) errors.push(`${q.key}: obrigatória`);
  }
  return errors;
}

// Submission → payload de lead. Respostas entram flat (mesmo padrão das perguntas
// de qualificação do pipeline); os campos núcleo vêm do mapping e sempre vencem.
export function leadFromSubmission(form, answers) {
  const m = form.mapping || {};
  const mapped = (k) => {
    const v = m[k] ? answers[m[k]] : undefined;
    return isBlank(v) ? undefined : v;
  };
  const lead = { ...answers };
  lead.name = mapped("name") != null ? String(mapped("name")) : `Lead · ${form.name}`;
  lead.saas = form.saas;
  lead.source = `Form · ${form.name}`;
  for (const k of ["email", "phone", "company"]) {
    const v = mapped(k);
    if (v != null) lead[k] = String(v);
  }
  const amount = Number(mapped("amount"));
  if (Number.isFinite(amount) && amount > 0) lead.amount = amount;
  lead.form = form.id;
  return lead;
}

// Rate-limit de janela fixa por chave (IP). Em memória — suficiente pra um
// processo único; o limite real de abuso fica no captcha/honeypot + infra.
export function makeRateLimiter({ limit = 10, windowMs = 60_000 } = {}) {
  const hits = new Map(); // key -> { count, reset }
  return function allow(key) {
    const now = Date.now();
    const cur = hits.get(key);
    if (!cur || now >= cur.reset) {
      // janela nova; aproveita pra varrer entradas expiradas de vez em quando
      if (hits.size > 10_000) for (const [k, v] of hits) { if (now >= v.reset) hits.delete(k); }
      hits.set(key, { count: 1, reset: now + windowMs });
      return true;
    }
    cur.count += 1;
    return cur.count <= limit;
  };
}
