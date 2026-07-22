// Shared chrome button style — lifted out of portfolio.jsx so every screen can
// import it without depending on a screen module. Identical to the original.

export const chromeBtnStyleSmall = {
  display: "inline-flex", alignItems: "center", gap: 6,
  height: 30, padding: "0 10px",
  border: "1px solid var(--line-2)",
  background: "var(--bg-1)",
  borderRadius: "var(--r-2)",
  color: "var(--fg-2)",
  fontSize: 13,
  fontWeight: 500,
  boxShadow: "var(--shadow-1)",
};

// Potencial do lead em 3 níveis: soma de pontos de CONTAS (quanto mais contas,
// mais dor de replicação) + ANÚNCIOS na maior conta (quanto mais anúncios, mais
// volume a clonar). Leads antigos sem `listings` usam o campo `volume` legado.
// alto = verde · médio = âmbar · baixo = cinza · sem respostas = neutro.
// A API espelha essa régua em leadGrade() (routes.marketing.js) pras colunas
// A/B/C de Publicidade — mudou aqui, muda lá.
const TIER_ACCOUNTS = { "1": 0, "2": 1, "3-5": 2, "6-10": 3, "10+": 4 };
const TIER_LISTINGS = { "0-100": 0, "100-500": 1, "500-2000": 2, "2000-10000": 3, "10000+": 4 };
const TIER_VOLUME = { "0-10": 0, "10-50": 1, "50-200": 2, "200+": 3 }; // legado (anúncios novos/semana)
// Cores próprias (não os tokens semânticos) pra separação clara à distância:
// tone = preenchimentos (badge/tinta do card); ink = variante escura pra texto.
// 5 níveis (A maior … E menor), gradiente verde→cinza. `key` = a própria letra
// (o TIER_ORDER do Meu dia ordena por ela; "sem" = lead que não respondeu).
export const GRADE_STYLE = {
  S: { key: "S", grade: "S", label: "cliente S", tone: "#7c3aed", ink: "#6d28d9", badgeFg: "#fff" },
  A: { key: "A", grade: "A", label: "cliente A", tone: "#16a34a", ink: "#15803d", badgeFg: "#fff" },
  B: { key: "B", grade: "B", label: "cliente B", tone: "#65a30d", ink: "#4d7c0f", badgeFg: "#fff" },
  C: { key: "C", grade: "C", label: "cliente C", tone: "#eab308", ink: "#a16207", badgeFg: "#463500" },
  D: { key: "D", grade: "D", label: "cliente D", tone: "#ea580c", ink: "#c2410c", badgeFg: "#fff" },
  E: { key: "E", grade: "E", label: "cliente E", tone: "#9aa2ad", ink: "#5b6472", badgeFg: "#fff" },
};
// Matriz de qualidade (linha = contas, coluna = anúncios), redesenhada pelo Leo
// em 21/07. É TABELA DE CONSULTA, não fórmula, pra bater exato com o desenho.
// Índices: contas 1/2/3-5/6-10/10+ (0-4) × anúncios ≤100/100-500/500-2k/2k-10k/
// 10k+ (0-4). Sem resposta cai no índice 0 (menor). A API espelha em
// leadGrade() (routes.marketing.js) — mudou aqui, muda lá.
//        ≤100 100-500 500-2k 2-10k 10k+
const GRADE_GRID = [
  ["E", "D", "D", "C", "C"], // 1 conta
  ["D", "C", "C", "B", "B"], // 2 contas
  ["C", "B", "B", "A", "A"], // 3-5 contas
  ["B", "B", "A", "S", "S"], // 6-10 contas
  ["A", "A", "A", "S", "S"], // 10+ contas
];
export function leadTier(l) {
  const acc = TIER_ACCOUNTS[l?.accounts];
  const ads = l?.listings != null && l.listings !== "" ? TIER_LISTINGS[l.listings] : TIER_VOLUME[l?.volume];
  if (acc == null && ads == null) return { key: "sem", grade: null, label: "sem qualificação", tone: "var(--line-strong)", ink: "var(--fg-3)", badgeFg: "#fff" };
  return GRADE_STYLE[GRADE_GRID[acc ?? 0][ads ?? 0]];
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
