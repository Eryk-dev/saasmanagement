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

// ── Convite formatado (07/10/2026) ──────────────────────────────────────────
// O "copiar link" e o "mandar no Whats" das calls/integrações (roteiro de
// Minhas atividades e ficha do card) iam só com a URL ou uma linha corrida.
// Agora vão como o convite do Google Agenda, mas em mensagem de gente: saudação,
// o que é, dia e hora (sempre de Brasília) e o link em linha própria. Duração
// = a do evento criado pela API (45 min). Sem horário marcado, vai só o link.
const INVITE_TZ = "America/Sao_Paulo";
const MEET_MIN = 45;

// Sem fuso = hora de Brasília (é como callAt/integrationAt são digitados).
export function inviteMs(value) {
  const v = String(value || "").trim();
  if (!v) return NaN;
  const withZone = /[Zz]|[+-]\d{2}:?\d{2}$/.test(v) ? v : `${v.length === 16 ? `${v}:00` : v}-03:00`;
  return new Date(withZone).getTime();
}

const fmt = (ms, opts) => new Intl.DateTimeFormat("pt-BR", { timeZone: INVITE_TZ, ...opts }).format(ms);
const hello = (lead) => {
  const first = String(lead?.name || "").trim().split(/\s+/)[0];
  return `Olá${first ? `, ${first}` : ""}! 👋`;
};

// Call (kind "call") ou integração (kind "integracao") com sala marcada.
export function meetingInviteText(lead, kind = "call") {
  const integ = kind === "integracao";
  const url = integ ? lead?.integrationCallUrl : lead?.callUrl;
  if (!url) return "";
  const what = integ ? String(lead.integrationMeetLabel || "integração").toLowerCase() : (TERMS[lead.saas]?.call || "call");
  const ms = inviteMs(integ ? lead.integrationAt : lead.callAt);
  const lines = [hello(lead), `Sua ${what} com a ${brandOf(lead.saas)} está marcada:`, ""];
  if (Number.isFinite(ms)) {
    const day = fmt(ms, { weekday: "long", day: "numeric", month: "long" });
    lines.push(`📅 ${day.charAt(0).toUpperCase()}${day.slice(1)}`);
    lines.push(`🕐 ${fmt(ms, { hour: "2-digit", minute: "2-digit" })} às ${fmt(ms + MEET_MIN * 60000, { hour: "2-digit", minute: "2-digit" })} (horário de Brasília)`);
  }
  lines.push(`🎥 Link da videochamada: ${url}`, "", "É só entrar pelo link no horário. Até lá!");
  return lines.join("\n");
}

// Link de convite da agenda de quem atende (página de horários disponíveis).
export function bookingInviteText(lead, personName, url, what = "integração") {
  if (!url) return "";
  return [
    hello(lead),
    `Pra agendar sua ${what} com a ${brandOf(lead?.saas)}, é só escolher o melhor horário na agenda de ${personName || "quem vai te atender"}:`,
    "",
    `📅 ${url}`,
    "",
    "Lá você vê os horários disponíveis e já confirma direto. Qualquer dúvida, é só chamar!",
  ].join("\n");
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
