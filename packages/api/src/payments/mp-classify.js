// Classificação do espelho do Mercado Pago: o /v1/payments/search devolve TUDO
// que passou pela conta — venda de cliente, maquininha Point, dinheiro da
// própria casa indo pra reserva (POTS), DARF/OpenAI pagos com saldo, compra
// de dólar, cashback do Mercado Livre. Antes tudo isso era "aprovado" e somava
// como recebido (R$ 573 mil de reserva interna em ago+set/2026 viraram
// "espelho MP" e base de taxa de checkout).
//
// Cada doc do espelho ganha:
//   kind       venda | maquininha | interna | saida | ruido
//   direction  in | out
//   kindSource api (operation_type + collector_id + payer.id) | heuristic
//
// Só `venda` e `maquininha` (as DUAS portas de dinheiro de cliente) entram em
// qualquer total, vínculo ou base de custo — `isMpSale`. O resto fica visível
// na Conciliação, em baldes próprios, pra virar conta a pagar ou ser ignorado.

export const MP_CLASS_V = 1;
export const SALE_KINDS = new Set(["venda", "maquininha"]);

// CNPJ do PRÓPRIO Mercado Pago: o /v1/payments/:id devolve esse número como
// "identificação do pagador" em PIX recebido e na maquininha — NÃO é
// identidade de ninguém (uma regra por payerDoc casaria todo PIX da conta).
export const MP_OWN_DOC = "10573521000191";

// Identidade da CASA (quem opera a conta). Dinheiro em que o pagador é a casa
// não é venda: é reserva interna (POTS), compra ou despesa paga com o saldo.
// Env sobrescreve (lista separada por vírgula); o default é a Lever Ads
// Software House (CNPJ do contrato B2B) e o e-mail da conta MP.
const envList = (k) => String(process.env[k] || "").split(",").map((s) => s.trim()).filter(Boolean);
export const HOUSE_DOCS = envList("MERCADOPAGO_HOUSE_DOCS").length ? envList("MERCADOPAGO_HOUSE_DOCS") : ["67931740000112"];
export const HOUSE_EMAILS = (envList("MERCADOPAGO_HOUSE_EMAILS").length ? envList("MERCADOPAGO_HOUSE_EMAILS") : ["lever@netair.com.br"]).map((e) => e.toLowerCase());

const digits = (v) => String(v || "").replace(/\D+/g, "");
const lower = (v) => String(v || "").trim().toLowerCase();

// Descrições que a conta MP usa pra pagamento FEITO com o saldo (saída) e
// pra lançamentos que não são dinheiro de cliente (ruído).
const OUT_RE = /\b(darf|das\b|openai|chatgpt|iugu|boleto pago|pagamento de conta|conta de luz|anthropic|google|meta ads|facebook)/i;
const NOISE_RE = /\b(buy-?musd|musd|cashback|rendimento|yield|cdb|mercado fundo)/i;
const POS_RE = /venda presencial|point\b/i;

const isHouse = (p) => {
  const doc = digits(p.payerDoc ?? p.payer?.identification?.number);
  const email = lower(p.payerEmail ?? p.payer?.email);
  return (doc && HOUSE_DOCS.includes(doc)) || (email && HOUSE_EMAILS.includes(email));
};
const isMpPlatformPayer = (p) => /@(mercadolibre|mercadolivre|mercadopago)\.com/i.test(lower(p.payerEmail ?? p.payer?.email));

// Doc cru da API (operation_type, collector_id, payer.id) OU doc do espelho
// (operationType, collectorId, payerId). `collectorId` da conta vem do
// GET /users/me (app_config mp_account) ou da env MERCADOPAGO_COLLECTOR_ID.
export function classifyMpPayment(p, { collectorId } = {}) {
  const op = lower(p.operation_type ?? p.operationType);
  const collector = String(p.collector_id ?? p.collectorId ?? p.collector?.id ?? "");
  const payer = String(p.payer?.id ?? p.payerId ?? "");
  const me = String(collectorId || "");
  const desc = String(p.description || "");
  const extRef = String(p.external_reference ?? p.externalReference ?? "");
  const pos = !!(p.pos_id ?? p.posId) || POS_RE.test(desc) || lower(p.point_of_interaction?.type) === "point";

  // ── Caminho forte: a API diz quem paga e quem recebe ──────────────────────
  if (me && (payer || collector)) {
    const payerIsMe = payer && payer === me;
    const collectorIsMe = collector && collector === me;
    if (payerIsMe && collectorIsMe) return { kind: "interna", direction: "in", kindSource: "api" };
    if (payerIsMe) return { kind: NOISE_RE.test(desc) ? "ruido" : "saida", direction: "out", kindSource: "api" };
    if (collectorIsMe) {
      if (isHouse(p) || /^POTS_/i.test(extRef)) return { kind: "interna", direction: "in", kindSource: "api" };
      if (isMpPlatformPayer(p) || NOISE_RE.test(desc)) return { kind: "ruido", direction: "in", kindSource: "api" };
      if (op === "account_fund" || op === "investment" || op === "cellphone_recharge") return { kind: "ruido", direction: "in", kindSource: "api" };
      if (op === "pos_payment" || pos) return { kind: "maquininha", direction: "in", kindSource: "api" };
      return { kind: "venda", direction: "in", kindSource: "api" };
    }
    // Nem pagador nem recebedor somos nós: não é dinheiro da conta.
    return { kind: "ruido", direction: "in", kindSource: "api" };
  }

  // ── Heurística (sem id da conta): o que dá pra ler do próprio doc ─────────
  if (isHouse(p) || /^POTS_/i.test(extRef)) return { kind: "interna", direction: "in", kindSource: "heuristic" };
  if (NOISE_RE.test(desc) || isMpPlatformPayer(p)) return { kind: "ruido", direction: "in", kindSource: "heuristic" };
  if (OUT_RE.test(desc)) return { kind: "saida", direction: "out", kindSource: "heuristic" };
  if (op === "account_fund" || op === "investment" || op === "cellphone_recharge") return { kind: "ruido", direction: "in", kindSource: "heuristic" };
  if (op === "pos_payment" || pos) return { kind: "maquininha", direction: "in", kindSource: "heuristic" };
  return { kind: "venda", direction: "in", kindSource: "heuristic" };
}

// Dinheiro de CLIENTE que entrou: a régua única do que o espelho soma. Doc
// ainda sem classificação (fixture antiga, espelho de antes da versão) conta
// como venda — a reclassificação do poller carimba todos em poucos ticks.
export const isMpSale = (p) =>
  !!p && p.status === "approved" && !p.finIgnored && (!p.kind || SALE_KINDS.has(p.kind));

// Pagador com o CNPJ do próprio MP não tem documento (payerDocMp marca que
// veio assim, pra UI explicar e pra ninguém criar regra em cima).
export function scrubMpOwnDoc(doc) {
  if (digits(doc.payerDoc) !== MP_OWN_DOC) return null;
  return { payerDoc: "", payerDocMp: true, payerName: doc.cnpjLookup && /mercado ?pago/i.test(String(doc.payerName || "")) ? "" : (doc.payerName || "") };
}
