import { leadGradeInfo } from "../../../api/src/lead-grade.js";
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
// Matriz histórica, mantida para a legenda dos leads legados.
export { LEGACY_GRID as GRADE_GRID } from "../../../api/src/lead-grade.js";
export const GRADE_ACCOUNTS = ["1", "2", "3-5", "6-10", "10+"];
export const GRADE_LISTINGS = ["≤100", "100-500", "500-2k", "2-10k", "10k+"];
export function leadTier(l) {
  const info = leadGradeInfo(l);
  if (!info.grade) return { key: "sem", grade: null, label: "sem qualificação", tone: "var(--line-strong)", ink: "var(--fg-3)", badgeFg: "#fff" };
  const style = GRADE_STYLE[info.grade];
  return { ...style, ...info, label: `${style.label} · ${info.legacy ? "Legado (contas × anúncios)" : info.revenue != null ? "pedidos × ticket médio" : "contas × anúncios"}` };
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
// Idade do lead = tempo desde a ENTRADA (createdAt), humanizado: "agora" na
// primeira hora, depois "3h", depois "2d". O campo `age` gravado no lead é o
// default "agora" da criação e nunca é recalculado (por isso todo card dizia
// "agora" pra sempre); só vale como fallback de deal migrado sem createdAt —
// string humana ("12m") ou número (dias). `now` é injetável pro teste.
export function leadAge(lead, now = Date.now()) {
  const t = lead?.createdAt ? new Date(lead.createdAt).getTime() : NaN;
  if (Number.isFinite(t)) {
    const h = Math.floor(Math.max(0, now - t) / 3_600_000);
    return h < 1 ? "agora" : h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
  }
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
