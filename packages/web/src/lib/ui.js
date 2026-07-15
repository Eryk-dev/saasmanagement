// Shared chrome button style — lifted out of portfolio.jsx so every screen can
// import it without depending on a screen module. Identical to the original.

export const chromeBtnStyleSmall = {
  display: "inline-flex", alignItems: "center", gap: 6,
  height: 24, padding: "0 8px",
  border: "1px solid var(--line-1)",
  background: "var(--bg-2)",
  borderRadius: "var(--r-2)",
  color: "var(--fg-2)",
};

// Potencial do lead em 3 níveis: soma de pontos de CONTAS (quanto mais contas,
// mais dor de replicação) + ANÚNCIOS na maior conta (quanto mais anúncios, mais
// volume a clonar). Leads antigos sem `listings` usam o campo `volume` legado.
// alto = verde · médio = âmbar · baixo = cinza · sem respostas = neutro.
const TIER_ACCOUNTS = { "1": 0, "2": 1, "3-5": 2, "6-10": 3, "10+": 4 };
const TIER_LISTINGS = { "0-100": 0, "100-500": 1, "500-2000": 2, "2000-10000": 3, "10000+": 4 };
const TIER_VOLUME = { "0-10": 0, "10-50": 1, "50-200": 2, "200+": 3 }; // legado (anúncios novos/semana)
export function leadTier(l) {
  const acc = TIER_ACCOUNTS[l?.accounts];
  const ads = l?.listings != null && l.listings !== "" ? TIER_LISTINGS[l.listings] : TIER_VOLUME[l?.volume];
  if (acc == null && ads == null) return { key: "sem", grade: null, label: "sem qualificação", tone: "var(--line-strong)", ink: "var(--fg-3)", badgeFg: "#fff" };
  const pts = (acc ?? 0) + (ads ?? 0);
  // Cores próprias (não os tokens semânticos) pra separação clara à distância:
  // tone = preenchimentos (badge/tinta do card); ink = variante escura pra texto.
  if (pts >= 5) return { key: "alto", grade: "A", label: "cliente A", tone: "#16a34a", ink: "#15803d", badgeFg: "#fff" };
  if (pts >= 2) return { key: "medio", grade: "B", label: "cliente B", tone: "#eab308", ink: "#a16207", badgeFg: "#463500" };
  return { key: "baixo", grade: "C", label: "cliente C", tone: "#9aa2ad", ink: "#5b6472", badgeFg: "#fff" };
}

// Lead score helpers — score é numérico 0–100; cor e rótulo vêm por banda.
// (Quente = forte/urgente em vermelho, mesmo padrão visual do protótipo.)
export function leadScoreTone(score) {
  const n = Number(score) || 0;
  return n >= 75 ? "var(--neg)" : n >= 50 ? "var(--warn)" : "var(--fg-4)";
}
export function leadScoreLabel(score) {
  const n = Number(score) || 0;
  return n >= 75 ? "Quente" : n >= 50 ? "Morno" : "Frio";
}
// Idade do lead — string humana ("12m"/"2h") ou número (dias, vindo de deals
// migrados). Normaliza sem inventar unidade pra strings.
export function leadAge(lead) {
  const a = lead?.age;
  if (a == null || a === "") return "—";
  return typeof a === "number" ? `${a}d` : String(a);
}

// Link de conversa no WhatsApp a partir de um telefone livre. Sanitiza pra só
// dígitos; número local brasileiro (≤11 dígitos, com DDD) recebe o DDI 55.
// Retorna null quando não há dígitos — a UI esconde o atalho nesse caso.
// Link da proposta aberto DE DENTRO do cockpit (o time conferindo/apresentando):
// marca ?from=cockpit pra o servidor NÃO contar como "o cliente abriu". Os links
// têm rel="noreferrer", então o referer não serve; o parâmetro é a marca segura.
export const cockpitProposalUrl = (url) => (url ? `${url}${String(url).includes("?") ? "&" : "?"}from=cockpit` : url);

export function waLink(phone) {
  const d = waDigits(phone);
  return d ? `https://wa.me/${d}` : null;
}

// Só os dígitos do número (E.164 sem +), mesma normalização do backend
// (digits em whatsapp.js): número local BR (≤11 dígitos) ganha o DDI 55.
// É a chave da conversa no inbox (id do thread).
export function waDigits(phone) {
  if (!phone) return "";
  let d = String(phone).replace(/\D/g, "");
  if (d && d.length <= 11 && !d.startsWith("55")) d = "55" + d;
  return d;
}
