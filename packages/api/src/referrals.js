// Indicação de cliente: o vínculo, o carimbo e a auditoria.
//
// O DESENHO (Leo, 12/09/2026). De 2.122 leads do cockpit exatamente 1 tinha
// origem "Indicação" — numa base de 90 clientes de autopeças, onde cada lojista
// conhece vários pares. O que faltava não era vontade: a régua (isReferralLead),
// a meta (referrals) e até a comissão escrita no plano do CS já existiam, mas
// não havia campo dizendo QUEM indicou nem QUEM colheu, então nada era
// perseguível nem pagável.
//
// Duas pontas no lead, e as duas importam:
//   referredByCustomer   o CLIENTE que indicou (id de customers). É a cerca:
//                        sem cliente na base, lead inbound remarcado como
//                        "Indicação" viraria prêmio.
//   referralCollectedBy  o COLABORADOR que colheu. O prêmio é dele (o lojista
//                        que indica não recebe nada), então sem coletor não há
//                        a quem pagar.
//   referralAt           carimbo do servidor, imutável depois do primeiro
//                        registro: a janela da comissão não pode mudar de mês
//                        porque alguém reeditou o card.
//
// O par CAMPO + ACTIVITY é de propósito: o campo serve às telas (ficha do
// cliente, fila, filtro) e pode ser corrigido; a activity `referral_collected`
// é o registro datado com autor, que é o que a auditoria da comissão lê.
import { isPaidReferral } from "./metrics-core.js";
import { logActivity } from "./lead-flow.js";

// O rótulo canônico da origem: casa com a régua de texto (isReferralLead) e com
// as sugestões do form de lead, pro card mostrar "Indicação" na Origem.
export const REFERRAL_SOURCE = "Indicação";

const stripAccents = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const saysReferral = (s) => stripAccents(s).includes("indica");

// O que gravar no lead quando o vínculo de indicação entra (ou sai).
// Devolve { patch } ou { error, code } pro handler responder 422 — mesmo padrão
// do CALL_SEM_HORARIO. `by` = usuário da sessão (nunca a key mestre: "api" não
// é pessoa e não pode virar dono de comissão).
export async function referralPatch(repo, body = {}, { existing = null, by = "" } = {}) {
  if (body.referredByCustomer === undefined) return { patch: {} };
  const cid = String(body.referredByCustomer || "").trim();
  // Correção: limpar o vínculo tira as três pontas juntas, pra não sobrar
  // coletor órfão contando indicação sem cliente.
  if (!cid) {
    return { patch: existing?.referredByCustomer ? { referredByCustomer: "", referralCollectedBy: "", referralAt: "" } : {} };
  }
  const customer = await repo.get("customers", cid);
  if (!customer) {
    return {
      error: `Cliente indicador não encontrado: ${cid}. Indicação só conta apontando um cliente da base.`,
      code: "REFERRAL_CLIENTE_INVALIDO",
    };
  }
  const patch = { referredByCustomer: cid };
  const at = String(body.referralAt || existing?.referralAt || "").trim();
  if (!at) patch.referralAt = new Date().toISOString();
  // O coletor segue a mesma regra do cliente indicador: a PRIMEIRA atribuição
  // vale. Reeditar o card não pode transferir comissão de uma pessoa pra outra;
  // pra corrigir de verdade, limpa o vínculo (as 3 pontas) e registra de novo.
  const collector = String(existing?.referralCollectedBy || body.referralCollectedBy || by || "").trim();
  if (collector && collector !== "api") patch.referralCollectedBy = collector;
  // Origem legível no card. O utm/sourceUrl do clique fica intacto: quem veio
  // pelo link de indicação do cliente tem as duas coisas guardadas.
  const src = body.source ?? existing?.source ?? "";
  if (!saysReferral(src)) patch.source = REFERRAL_SOURCE;
  return { patch, customer };
}

// Registro datado da coleta (auditoria da comissão). Só dispara quando o
// vínculo NASCE: re-gravar o mesmo cliente não cria evento novo.
export async function logReferralCollected(repo, { lead, saas = "", customer = "", by = "", customerName = "" } = {}) {
  if (!lead || !customer) return null;
  try {
    return await logActivity(repo, {
      saas, lead, type: "system",
      text: customerName ? `Indicação de ${customerName}` : "Indicação registrada",
      meta: { event: "referral_collected", customer, collectedBy: by || "" },
      author: by || "system",
    });
  } catch { return null; } // fail-open: auditoria não bloqueia cadastro de lead
}

// Indicação que chega pelo LINK PÚBLICO do form (/f/:id?ref=cu_x&refby=uid).
// Fail-open por construção: link velho, cliente churnado do cadastro ou id
// digitado errado NÃO podem derrubar o envio do formulário — a pessoa está do
// outro lado preenchendo. Sem vínculo válido o lead entra como qualquer outro.
//
// Quem colheu, quando o link não diz (`refby` vazio): o DONO do cliente. O link
// é do cliente, e quem cuida dele é quem plantou o pedido. Cliente sem dono
// deixa o coletor vazio: a indicação conta no funil e na classe semente, mas
// não paga ninguém até alguém assumir o registro.
export async function referralFromRef(repo, { ref = "", by = "" } = {}) {
  const cid = String(ref || "").trim();
  if (!cid) return null;
  try {
    const customer = await repo.get("customers", cid);
    if (!customer) return null;
    let collector = String(by || "").trim();
    if (collector) {
      const user = await repo.get("users", collector);
      if (!user) collector = "";
    }
    if (!collector) collector = String(customer.owner || "").trim();
    return {
      referredByCustomer: cid,
      ...(collector ? { referralCollectedBy: collector } : {}),
      referralAt: new Date().toISOString(),
      source: REFERRAL_SOURCE,
      _customerName: customer.name || "",
    };
  } catch { return null; }
}

// Já houve coleta registrada neste lead? (evita activity duplicada no PATCH)
export const hasReferralEvent = (acts) =>
  (acts || []).some((a) => a?.meta?.event === "referral_collected");

export { isPaidReferral };
