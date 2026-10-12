// Financeiro · espelho dos pagamentos do ASAAS (mesma collection mp_payments,
// gateway "asaas"). Dois caminhos alimentam o espelho com a MESMA função:
//   - webhook /public/asaas/webhook (tempo real; o evento traz a cobrança)
//   - poller startAsaasSync (reconciliação: funciona mesmo SEM webhook)
//
// Tradução pro dialeto do espelho (o do MP): status RECEIVED/CONFIRMED →
// approved; billingType → method/methodType; value/netValue → amount/
// netAmount/feeAmount; datas sem fuso → BRT (brtToIso).
//
// PARCELAMENTO: o Asaas cria UMA cobrança por parcela (installment = id do
// grupo). Cartão parcelado confirma todas de uma vez; carnê de boleto paga
// uma a uma. O espelho guarda um doc POR PARCELA (o caixa entra parcela a
// parcela, na data certa) com o retrato do grupo (installmentTotal/
// installmentAllPaid) pra fatura/link fecharem quando o grupo fecha.

import { repo as defaultRepo } from "../platform/db.js";
import { asaas as defaultAsaas } from "./asaas.js";
import { discord as defaultDiscord } from "../integrations/discord.js";
import { ingestMirrorPayment } from "./mp-payments.js";
import { MP_CLASS_V } from "./mp-classify.js";
import { brtToIso, phoneKey } from "./gateways.js";

const STATUS = {
  RECEIVED: "approved", CONFIRMED: "approved", RECEIVED_IN_CASH: "approved", DUNNING_RECEIVED: "approved",
  PENDING: "pending", OVERDUE: "pending", DUNNING_REQUESTED: "pending", AWAITING_RISK_ANALYSIS: "in_process",
  REFUNDED: "refunded", REFUND_REQUESTED: "refunded", REFUND_IN_PROGRESS: "refunded",
  CHARGEBACK_REQUESTED: "charged_back", CHARGEBACK_DISPUTE: "charged_back", AWAITING_CHARGEBACK_REVERSAL: "charged_back",
};
// Evento que muda o estado sem (ou antes de) o status da cobrança refletir.
const EVENT_STATUS = {
  PAYMENT_DELETED: "cancelled",
  PAYMENT_REPROVED_BY_RISK_ANALYSIS: "rejected",
  PAYMENT_CREDIT_CARD_CAPTURE_REFUSED: "rejected",
};
const APPROVED = new Set(["RECEIVED", "CONFIRMED", "RECEIVED_IN_CASH", "DUNNING_RECEIVED"]);

const METHOD = {
  PIX: { method: "pix", methodType: "bank_transfer" },
  BOLETO: { method: "boleto", methodType: "ticket" },
  CREDIT_CARD: { method: "credit_card", methodType: "credit_card" },
  DEBIT_CARD: { method: "debit_card", methodType: "debit_card" },
  TRANSFER: { method: "transfer", methodType: "bank_transfer" },
  DEPOSIT: { method: "deposit", methodType: "bank_transfer" },
};

export const asaasStatusOf = (pmt, event) => {
  if (pmt?.deleted) return "cancelled";
  return EVENT_STATUS[String(event || "")] || STATUS[String(pmt?.status || "")] || "pending";
};

// Cobrança do Asaas (+ cliente e retrato do parcelamento) → doc do espelho.
export function normalizeAsaasPayment(pmt, { customer = null, event = "", eventAt = "", linkReference = "", group = null } = {}) {
  const status = asaasStatusOf(pmt, event);
  const value = Number(pmt.value) || 0;
  const net = Number(pmt.netValue) || 0;
  const m = METHOD[String(pmt.billingType || "")] || { method: String(pmt.billingType || "").toLowerCase(), methodType: "" };
  if (m.methodType === "credit_card" && pmt.creditCard?.creditCardBrand) m.method = String(pmt.creditCard.creditCardBrand).toLowerCase();
  const doc = String(customer?.cpfCnpj || "").replace(/\D+/g, "");
  return {
    gateway: "asaas",
    mpId: String(pmt.id),
    status,
    statusDetail: String(pmt.status || ""),
    amount: Math.round(value * 100) / 100,
    netAmount: Math.round(net * 100) / 100,
    ...m,
    installments: group?.count || 1,
    ...(pmt.installment ? {
      installmentId: String(pmt.installment),
      installmentNumber: Number(pmt.installmentNumber) || 0,
      installmentTotal: group ? group.total : 0,
      installmentAllPaid: !!group?.allPaid,
    } : {}),
    payerEmail: String(customer?.email || "").trim().toLowerCase(),
    payerName: String(customer?.name || "").trim(),
    payerDoc: doc,
    payerPhone: phoneKey(customer?.mobilePhone || customer?.phone || ""),
    payerBank: "",
    description: String(pmt.description || ""),
    externalReference: String(pmt.externalReference || linkReference || ""),
    gatewayLink: String(pmt.paymentLink || ""),
    dateCreated: brtToIso(pmt.dateCreated) || brtToIso(eventAt) || new Date().toISOString(),
    dateApproved: status === "approved"
      ? (brtToIso(pmt.confirmedDate) || brtToIso(pmt.paymentDate) || brtToIso(pmt.clientPaymentDate) || brtToIso(eventAt) || brtToIso(pmt.dateCreated))
      : "",
    operationType: "", collectorId: "", payerId: String(pmt.customer || ""), posId: "",
    feeAmount: net > 0 && value > net ? Math.round((value - net) * 100) / 100 : 0,
    kind: "venda", direction: "in", kindSource: "api", classV: MP_CLASS_V,
  };
}

// Caches por passada (poller) — cliente e grupo de parcelas não mudam dentro
// de um tick; o webhook cria caches novos a cada evento.
export const makeAsaasCaches = () => ({ customers: new Map(), groups: new Map() });

async function customerOf(asaas, id, caches) {
  if (!id) return null;
  if (caches.customers.has(id)) return caches.customers.get(id);
  let c = null;
  try { c = await asaas.getCustomer(id); } catch { c = null; }
  caches.customers.set(id, c);
  return c;
}

async function groupOf(asaas, installmentId, caches) {
  if (!installmentId) return null;
  if (caches.groups.has(installmentId)) return caches.groups.get(installmentId);
  let g = null;
  try {
    const res = await asaas.listPayments({ installment: installmentId, limit: 100 });
    const rows = (Array.isArray(res?.data) ? res.data : []).filter((p) => !p.deleted);
    if (rows.length) {
      g = {
        count: rows.length,
        total: Math.round(rows.reduce((a, p) => a + (Number(p.value) || 0), 0) * 100) / 100,
        allPaid: rows.every((p) => APPROVED.has(String(p.status || ""))),
      };
    }
  } catch { g = null; }
  caches.groups.set(installmentId, g);
  return g;
}

// Link de pagamento do Asaas gerado pelo cockpit: o pagamento vem com
// `paymentLink` = id do link; a referência (lead/fatura) mora no recibo.
async function linkReferenceOf(repo, paymentLinkId) {
  if (!paymentLinkId) return "";
  const links = await repo.list("payment_links").catch(() => []);
  const hit = links.find((l) => l.gateway === "asaas" && l.prefId === paymentLinkId);
  return hit?.reference || "";
}

export async function ingestAsaasPayment(repo, asaas, pmt, { discord, log, event = "", eventAt = "", caches = makeAsaasCaches() } = {}) {
  const customer = await customerOf(asaas, pmt.customer, caches);
  const group = pmt.installment ? await groupOf(asaas, pmt.installment, caches) : null;
  const linkReference = pmt.externalReference ? "" : await linkReferenceOf(repo, pmt.paymentLink);
  const base = normalizeAsaasPayment(pmt, { customer, event, eventAt, linkReference, group });
  return ingestMirrorPayment(repo, base, { discord, log, extra: { payerDetail: 2 }, noRegress: true });
}

const dayOf = (d) => new Date(d).toISOString().slice(0, 10);

// Uma passada de reconciliação: cobranças CRIADAS desde o último sync (folga
// de 2 dias; 1º run varre 400 dias) + cobranças PAGAS desde então (boleto
// velho que caiu hoje não aparece pela criação). Carimbo em app_config
// "asaas_sync".
export async function runAsaasSync(repo, asaas, { discord, log, now = new Date(), backfillDays = 400, overlapDays = 2, maxPages = 40 } = {}) {
  if (!asaas?.configured?.()) return { ok: false, error: "not_configured" };
  const cfg = await repo.get("app_config", "asaas_sync");
  const since = cfg?.lastAt
    ? new Date(new Date(cfg.lastAt).getTime() - overlapDays * 86_400_000)
    : new Date(now.getTime() - backfillDays * 86_400_000);
  const caches = makeAsaasCaches();
  const seen = new Set();
  let matched = 0, settled = 0;

  async function sweep(filter) {
    let offset = 0;
    for (let page = 0; page < maxPages; page++) {
      const res = await asaas.listPayments({ ...filter, offset, limit: 100 });
      const rows = Array.isArray(res?.data) ? res.data : [];
      for (const pmt of rows) {
        if (seen.has(pmt.id)) continue;
        seen.add(pmt.id);
        const r = await ingestAsaasPayment(repo, asaas, pmt, { discord, log, caches });
        if (r.matched) matched++;
        if (r.settledNow) settled++;
      }
      offset += rows.length;
      if (!rows.length || res?.hasMore === false) break;
    }
  }
  await sweep({ createdSince: dayOf(since) });
  await sweep({ paidSince: dayOf(since) });

  const stamp = { id: "asaas_sync", lastAt: now.toISOString(), lastSeen: seen.size, updatedAt: now.toISOString() };
  if (cfg) await repo.update("app_config", "asaas_sync", stamp);
  else await repo.create("app_config", stamp);
  return { ok: true, seen: seen.size, matched, settled, since: since.toISOString() };
}

// Poller (modelo do startMpSync): rede de segurança pro webhook. Sem
// ASAAS_API_KEY, fica DORMENTE.
export function startAsaasSync(repo = defaultRepo, { asaas = defaultAsaas, discord = defaultDiscord, intervalMs = 10 * 60_000, log = console } = {}) {
  if (!asaas?.configured?.()) { log.info?.("asaas sync: sem ASAAS_API_KEY — desligado"); return () => {}; }
  let running = false;
  async function tick() {
    if (running) return; running = true;
    try {
      const r = await runAsaasSync(repo, asaas, { discord, log });
      if (r.settled || r.seen) log.info?.(`asaas sync: ${r.seen} cobrança(s) vistas, ${r.matched} casadas, ${r.settled} fatura(s) baixada(s)`);
    } catch (err) { log.warn?.({ err: err.message }, "asaas sync falhou (re-tenta no próximo ciclo)"); }
    finally { running = false; }
  }
  tick();
  const timer = setInterval(tick, intervalMs);
  if (timer.unref) timer.unref();
  return () => clearInterval(timer);
}
