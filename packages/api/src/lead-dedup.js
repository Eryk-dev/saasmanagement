// Evita CADASTRO DUPLICADO de lead. A mesma pessoa re-submete o form (ou volta
// por outro anúncio, ou o espelho do SaaS externo dispara 2×) e nasceria um card
// novo em vez de cair no que já existe — hoje só o Shopify dedup (por orderId).
//
// `findDuplicateLead` casa pelo TELEFONE normalizado (waMatchKey, a MESMA régua
// que o inbox usa pra casar pessoa por número — trata 9º dígito e DDI) dentro do
// MESMO produto; e-mail é o desempate. Escopo por `saas`: o mesmo número em
// outro produto é outra pessoa no funil de lá, não duplicata. Leads internos
// (teste da equipe) ficam de fora dos dois lados.
//
// `dedupMergePatch` diz o que atualizar no lead que FICA: refresca a atribuição
// (o anúncio/UTM mais recente que trouxe a pessoa de volta) e preenche só os
// campos vazios. NUNCA toca o estado do funil (etapa, dono, GPS, proposta,
// venda), então lead terminal (Perdido/Desqualificado/Ganho) continua fechado —
// decisão do Leo: re-entrada só registra, não ressuscita.
import { waMatchKey } from "./wa-store.js";

export async function findDuplicateLead(repo, { saas = "", phone = "", email = "", excludeId = "" } = {}) {
  const pk = waMatchKey(phone);
  const ek = String(email || "").trim().toLowerCase();
  if (!pk && !ek) return null; // sem nada pra casar → não é duplicata
  const leads = await repo.list("leads");
  const eligible = (l) => l && l.id !== excludeId && !l.internal && (l.saas || "") === (saas || "");
  if (pk) { const byPhone = leads.find((l) => eligible(l) && waMatchKey(l.phone) === pk); if (byPhone) return byPhone; }
  if (ek) { const byEmail = leads.find((l) => eligible(l) && String(l.email || "").trim().toLowerCase() === ek); if (byEmail) return byEmail; }
  return null;
}

// Estado do funil manda — re-entrada NUNCA sobrescreve estes.
const PROTECTED = new Set([
  "id", "saas", "stage", "stageSince", "owner", "closer", "integrator",
  "nextActionAt", "callAt", "integrationAt", "wonAt", "customerId", "amount",
  "paymentMethod", "planClosed", "proposalUrl", "proposta_id", "proposal_edit_url",
  "createdAt", "shopifyOrderId", "internal", "disqualified", "lostReason",
  "lostNote", "formExit",
]);
// Atribuição/marketing: sempre pro clique/anúncio MAIS RECENTE (a pessoa voltou
// por um anúncio novo — é essa origem que interessa medir e mostrar).
const REFRESH = new Set(["utm", "fbc", "fbp", "sourceUrl", "source", "formVariant", "formHeadline", "form"]);
const isEmpty = (v) => v == null || v === "" || (Array.isArray(v) && v.length === 0);
const onlyDigits = (s) => /^\d+$/.test(String(s || "").replace(/\s/g, ""));

export function dedupMergePatch(existing, incoming) {
  const patch = {};
  for (const [k, v] of Object.entries(incoming || {})) {
    if (PROTECTED.has(k) || isEmpty(v)) continue;
    if (REFRESH.has(k)) patch[k] = v;                 // sempre refresca a atribuição
    else if (isEmpty(existing?.[k])) patch[k] = v;    // resto: só preenche buraco, não pisa dado bom
  }
  // Nome de verdade troca vazio ou "só o número" (o que o webhook do WhatsApp
  // gravou antes de a pessoa preencher o form).
  if (incoming?.name && !onlyDigits(incoming.name) && (isEmpty(existing?.name) || onlyDigits(existing.name))) patch.name = incoming.name;
  return patch;
}
