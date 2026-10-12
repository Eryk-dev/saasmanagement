// Regras de conciliação aprendidas (fin_rules) — a parte PURA: normalização e
// casamento. Quem aplica (vincular/desconsiderar + baixa) é o ingest do espelho
// (mp-payments.js) e o POST /api/fin/:saas/rules/apply — nunca um GET.
//
// Identidade do pagador em ordem de força: documento > e-mail > nome. A regra
// guarda o valor NORMALIZADO e casa contra o pagamento normalizado igual.

import { HOUSE_DOCS, HOUSE_EMAILS, MP_OWN_DOC } from "./mp-classify.js";

const NORM = {
  payerDoc: (v) => String(v || "").replace(/\D+/g, ""),
  payerEmail: (v) => String(v || "").trim().toLowerCase(),
  payerName: (v) => String(v || "").trim().toLowerCase().replace(/\s+/g, " "),
};
export const RULE_FIELDS = Object.keys(NORM);
export const normalizeRuleValue = (field, value) => (NORM[field] ? NORM[field](value) : "");

export const ruleMatches = (r, p) => {
  const f = NORM[r.matchField];
  if (!f) return false;
  const v = f(r.matchValue);
  return !!v && v === f(p[r.matchField]);
};

// Regra que casaria a conta inteira: documento do próprio MP (vem como
// "pagador" em todo PIX) ou identidade da casa. Não pode nascer nem valer.
export function badRuleReason(rule) {
  const field = rule?.matchField;
  if (!NORM[field]) return "campo da regra inválido (payerDoc, payerEmail ou payerName)";
  const v = normalizeRuleValue(field, rule.matchValue);
  if (!v) return "valor da regra vazio";
  if (field === "payerDoc" && v === MP_OWN_DOC) return "esse CNPJ é do próprio Mercado Pago (aparece em todo PIX recebido), não identifica ninguém";
  if (field === "payerDoc" && HOUSE_DOCS.includes(v)) return "esse documento é da própria casa: dinheiro interno não vincula a cliente";
  if (field === "payerEmail" && HOUSE_EMAILS.includes(v)) return "esse e-mail é da própria conta: dinheiro interno não vincula a cliente";
  if (rule.action === "vincular" && !rule.customer) return "regra de vincular precisa do cliente";
  if (rule.action !== "vincular" && rule.action !== "desconsiderar") return "ação da regra inválida";
  return "";
}

// Regras válidas pro produto (saas vazio = vale pra todos).
export const rulesFor = (rules, saas) =>
  (rules || []).filter((r) => (!r.saas || !saas || r.saas === saas) && !badRuleReason(r));
