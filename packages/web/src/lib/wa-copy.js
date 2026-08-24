// Mensagens prontas do WhatsApp (wa.me?text=) com o link da call ou da
// proposta. A marca vem do produto do LEAD (nunca fixa em LeverAds) e o
// vocabulário acompanha o produto: na UniqueKids a mãe marca uma "sessão" e
// recebe a "apresentação" da mentoria; "call" e "proposta" ali soam empresa
// B2B falando com ela. Produto sem verbete próprio cai no padrão.

const TERMS = { uniquekids: { call: "sessão", proposta: "apresentação" } };

function brandOf(saasId) {
  return (window.SEED?.SAAS || []).find((s) => s.id === saasId)?.name || "LeverAds";
}

// "Oi Debora! Aqui é da UniqueKids." — abertura comum das mensagens com link.
function hi(lead) {
  const first = lead?.name ? " " + String(lead.name).trim().split(/\s+/)[0] : "";
  return `Oi${first}! Aqui é da ${brandOf(lead?.saas)}.`;
}

// "Mandar link no Whats" da call agendada (roteiro do Meu dia e drawer do card).
export function waCallLinkText(lead, url) {
  const t = TERMS[lead?.saas];
  return `${hi(lead)} Nossa ${t?.call || "call"} vai ser por este link: ${url}`;
}

// Envio da proposta a partir do roteiro (ofertas do deck).
export function waProposalText(lead, url) {
  const t = TERMS[lead?.saas];
  const coisa = t?.proposta ? `a ${t.proposta}` : "a sua proposta";
  return `${hi(lead)} Segue ${coisa} com tudo o que a gente conversou: ${url}`;
}

// Envio no meio da conversa (botão do drawer): o closer manda do próprio
// número, então vai sem o "Aqui é da..." de apresentação.
export function waProposalPlainText(lead, url) {
  const t = TERMS[lead?.saas];
  return `Aqui está ${t?.proposta ? "a " + t.proposta : "a proposta"} sobre a qual conversamos: ${url}`;
}
