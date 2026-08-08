// Financeiro · espelho de pagamentos do Mercado Pago (mp_payments).
//
// A verdade mora no MP; aqui fica o índice que o cockpit consegue mostrar:
// quem pagou, quanto, COMO (PIX/cartão/boleto, parcelas) e casado com qual
// cliente/fatura. Dois caminhos alimentam o espelho com a MESMA função:
//   - webhook /public/mp/webhook (tempo real, topic payment)
//   - poller startMpSync (reconciliação: funciona mesmo SEM webhook no painel)
//
// Casamento (nesta ordem, primeiro que acertar vence):
//   1. external_reference = id de FATURA (links gerados pelo cockpit)
//   2. external_reference = id de ASSINATURA (preapproval, fase 4)
//   3. e-mail do pagador = e-mail de exatamente UM cliente (senão UM lead)
//   4. nada casou → fica na lista de "não identificados" com vínculo manual
//
// Baixa de fatura: só pagamento APROVADO e no máximo UMA fatura por mpPaymentId
// (idempotência global — webhook + poller + redelivery nunca baixam 2x). Por
// e-mail a baixa exige valor EXATO e candidata única: melhor sobrar pro vínculo
// manual do que baixar a fatura errada.

import { repo as defaultRepo } from "./db.js";
import { mp as defaultMp } from "./mp.js";
import { discord as defaultDiscord } from "./discord.js";
import { syncCustomerArr } from "./billing.js";

// O /v1/payments/search devolve o pagador MASCARADO (e-mail "xxxxxxxxxx",
// nome/CPF vazios ou só x's) — máscara não é dado: vira "" pra UI não mostrar
// lixo nem o vínculo por e-mail comparar contra x's. O GET /v1/payments/:id
// (webhook e enriquecimento do sync) é que traz o pagador de verdade.
const masked = (s) => /^x+$/i.test(String(s || "").replace(/[@.\s_-]/g, ""));
const clean = (s) => { const v = String(s || "").trim(); return masked(v) ? "" : v; };

// Nome do pagador com fallback: payer → additional_info (checkout) → titular
// do cartão → banco do PIX. O primeiro costuma vir vazio até no doc completo.
function payerNameOf(pmt) {
  return clean([pmt.payer?.first_name, pmt.payer?.last_name].filter(Boolean).join(" "))
    || clean([pmt.additional_info?.payer?.first_name, pmt.additional_info?.payer?.last_name].filter(Boolean).join(" "))
    || clean(pmt.card?.cardholder?.name)
    || clean(pmt.point_of_interaction?.transaction_data?.bank_info?.payer?.long_name)
    || "";
}

// Campos do /v1/payments do MP → doc do espelho (valores em reais, como o resto).
export function normalizeMpPayment(pmt) {
  return {
    mpId: String(pmt.id),
    status: pmt.status || "",             // approved|pending|in_process|rejected|refunded|cancelled|charged_back
    statusDetail: pmt.status_detail || "",
    amount: Number(pmt.transaction_amount) || 0,
    netAmount: Number(pmt.transaction_details?.net_received_amount) || 0,
    method: pmt.payment_method_id || "",  // pix|bolbradesco|master|visa|account_money…
    methodType: pmt.payment_type_id || "",// bank_transfer|ticket|credit_card|account_money…
    installments: Number(pmt.installments) || 1,
    payerEmail: clean(pmt.payer?.email).toLowerCase(),
    payerName: payerNameOf(pmt),
    payerDoc: clean(pmt.payer?.identification?.number),
    description: pmt.description || "",
    externalReference: String(pmt.external_reference || ""),
    dateCreated: pmt.date_created || "",
    dateApproved: pmt.date_approved || "",
  };
}

// Baixa uma fatura com os dados REAIS do pagamento (data, forma, parcelas) e
// recupera a assinatura past_due quando não sobra vencida — mesma regra do
// applyMpPayment da fase 4, com o "como pagou" carimbado na fatura.
export async function settleInvoice(repo, invoice, pmt, { discord, log } = {}) {
  const paidAt = pmt.date_approved || pmt.date_created || new Date().toISOString();
  const paid = await repo.update("invoices", invoice.id, {
    status: "paid", paidAt, mpPaymentId: String(pmt.id),
    paidMethod: pmt.payment_method_id || "",
    paidMethodType: pmt.payment_type_id || "",
    paidInstallments: Number(pmt.installments) || 1,
  });
  if (invoice.subscription) {
    const sub = await repo.get("subscriptions", invoice.subscription);
    const stillOverdue = (await repo.list("invoices"))
      .some((i) => i.subscription === invoice.subscription && i.status === "overdue");
    if (sub?.status === "past_due" && !stillOverdue) {
      await repo.update("subscriptions", sub.id, { status: "active" });
      await syncCustomerArr(repo, sub.customer);
    }
  }
  if (discord?.configured()) {
    try {
      const customer = invoice.customer ? await repo.get("customers", invoice.customer) : null;
      await discord.invoicePaid({ invoice: paid, customerName: customer?.name, via: "Mercado Pago" });
    } catch (err) { log?.warn?.({ invoice: invoice.id, err: err.message }, "MP: aviso Discord falhou"); }
  }
  return paid;
}

// Qual fatura um pagamento aprovado baixa, dado o vínculo encontrado?
function settleTarget(invoices, link, base) {
  const open = (i) => i.status === "open" || i.status === "overdue";
  if (link.invoice) {
    const inv = invoices.find((i) => i.id === link.invoice);
    return inv && open(inv) ? inv : null;
  }
  if (link.subscription) {
    return invoices
      .filter((i) => i.subscription === link.subscription && open(i))
      .sort((a, b) => String(a.dueDate || "").localeCompare(String(b.dueDate || "")))[0] || null;
  }
  if (link.customer) {
    const cand = invoices.filter((i) =>
      i.customer === link.customer && open(i) && Math.abs(Number(i.amount) - base.amount) < 0.01);
    return cand.length === 1 ? cand[0] : null;
  }
  return null;
}

const sameDoc = (a, b, keys) => a && keys.every((k) => JSON.stringify(a[k] ?? null) === JSON.stringify(b[k] ?? null));

// Upsert do espelho + casamento + baixa. Idempotente e barata quando nada mudou
// (o poller repassa a mesma janela a cada tick — sem escrita não há SSE/refresh).
export async function ingestMpPayment(repo, pmt, { discord, log, extra } = {}) {
  const mpId = String(pmt.id);
  const mirrorId = `mpp_${mpId}`;
  const prev = await repo.get("mp_payments", mirrorId);
  const base = normalizeMpPayment(pmt);

  // O poller re-varre a janela com o doc MAGRO do search — pagador já
  // enriquecido (webhook/GET por id) não pode regredir pra vazio. clean() no
  // prev também: espelho antigo pode ter guardado a máscara crua.
  if (prev) {
    base.payerName = base.payerName || clean(prev.payerName);
    base.payerEmail = base.payerEmail || clean(prev.payerEmail).toLowerCase();
    base.payerDoc = base.payerDoc || clean(prev.payerDoc);
  }

  // Vínculo já feito (ingest anterior ou manual) é preservado.
  const link = {
    saas: prev?.saas || "", customer: prev?.customer || "", lead: prev?.lead || "",
    subscription: prev?.subscription || "", invoice: prev?.invoice || "",
    matchedBy: prev?.matchedBy || "",
  };
  let payerMismatch = !!prev?.payerMismatch;

  const invoices = await repo.list("invoices");
  const alreadySettled = invoices.find((i) => i.mpPaymentId === mpId) || null;
  if (alreadySettled && !link.invoice) {
    link.invoice = alreadySettled.id;
    link.customer = link.customer || alreadySettled.customer || "";
    link.saas = link.saas || alreadySettled.saas || "";
    link.subscription = link.subscription || alreadySettled.subscription || "";
    link.matchedBy = link.matchedBy || "reference";
  }

  if (!link.customer && !link.invoice && !link.lead) {
    const ref = base.externalReference;
    const refInvoice = ref ? invoices.find((i) => i.id === ref) : null;
    const refSub = !refInvoice && ref ? await repo.get("subscriptions", ref) : null;
    if (refInvoice) {
      Object.assign(link, {
        saas: refInvoice.saas || "", customer: refInvoice.customer || "",
        subscription: refInvoice.subscription || "", invoice: refInvoice.id, matchedBy: "reference",
      });
    } else if (refSub) {
      // Payer cross-check (padrão da fase 4): referência forjada com pagador
      // diferente não casa nem baixa — fica visível como não identificado.
      if (refSub.payerEmail && base.payerEmail && String(refSub.payerEmail).toLowerCase() !== base.payerEmail) {
        payerMismatch = true;
        log?.error?.({ payment: mpId, sub: refSub.id }, "MP: payer mismatch no pagamento — sem vínculo");
      } else {
        Object.assign(link, {
          saas: refSub.saas || "", customer: refSub.customer || "",
          subscription: refSub.id, matchedBy: "subscription",
        });
      }
    } else if (base.payerEmail) {
      const byEmail = (await repo.list("customers"))
        .filter((c) => String(c.email || "").toLowerCase() === base.payerEmail);
      if (byEmail.length === 1) {
        Object.assign(link, { saas: byEmail[0].saas || "", customer: byEmail[0].id, matchedBy: "email" });
      } else if (!byEmail.length) {
        const byLead = (await repo.list("leads"))
          .filter((l) => String(l.email || "").toLowerCase() === base.payerEmail);
        if (byLead.length === 1) {
          Object.assign(link, {
            saas: byLead[0].saas || "", lead: byLead[0].id,
            customer: byLead[0].customerId || "", matchedBy: "email",
          });
        }
      }
    }
  }

  let settledNow = null;
  if (base.status === "approved" && !alreadySettled) {
    const target = settleTarget(invoices, link, base);
    if (target) {
      settledNow = await settleInvoice(repo, target, pmt, { discord, log });
      link.invoice = target.id;
      link.customer = link.customer || target.customer || "";
      link.saas = link.saas || target.saas || "";
    }
  }

  const doc = { ...base, ...link, ...extra, ...(payerMismatch ? { payerMismatch: true } : {}) };
  const KEYS = Object.keys(doc);
  let saved;
  if (!prev) saved = await repo.create("mp_payments", { id: mirrorId, ...doc, syncedAt: new Date().toISOString() });
  else if (!sameDoc(prev, doc, KEYS)) saved = await repo.update("mp_payments", mirrorId, { ...doc, syncedAt: new Date().toISOString() });
  else saved = prev;

  return {
    payment: saved,
    matched: !!(link.customer || link.lead),
    settledNow: settledNow?.id || null,
    alreadySettled: alreadySettled?.id || null,
  };
}

// Uma passada de reconciliação: busca paginada dos pagamentos da conta desde o
// último sync (com folga de 2 dias; 1º run varre 400 dias = backfill sozinho) e
// ingere um a um. Carimbo em app_config "mp_sync" — a UI mostra o último sync.
export async function runMpSync(repo, mp, { discord, log, now = new Date(), backfillDays = 400, overlapDays = 2, maxPages = 40, enrichLimit = 40 } = {}) {
  if (!mp?.configured?.()) return { ok: false, error: "not_configured" };
  const cfg = await repo.get("app_config", "mp_sync");
  const since = cfg?.lastAt
    ? new Date(new Date(cfg.lastAt).getTime() - overlapDays * 86_400_000)
    : new Date(now.getTime() - backfillDays * 86_400_000);

  let offset = 0, seen = 0, matched = 0, settled = 0, enriched = 0;
  for (let page = 0; page < maxPages; page++) {
    const res = await mp.searchPayments({ begin: since.toISOString(), end: now.toISOString(), limit: 50, offset });
    const results = Array.isArray(res?.results) ? res.results : [];
    for (const pmt of results) {
      // Search sem nome de pagador → busca o doc COMPLETO uma única vez
      // (payerDetail carimba a tentativa: PIX que não traz nome nem no doc
      // completo não vira re-fetch eterno). Cap por passada segura o backfill.
      let full = pmt, extra;
      if (!payerNameOf(pmt) && enriched < enrichLimit) {
        const prev = await repo.get("mp_payments", `mpp_${pmt.id}`);
        if (!prev?.payerName && !prev?.payerDetail) {
          try { full = await mp.getPayment(pmt.id); extra = { payerDetail: true }; enriched++; }
          catch { /* segue com o resumo; tenta de novo no próximo tick */ }
        }
      }
      const r = await ingestMpPayment(repo, full, { discord, log, extra });
      seen++;
      if (r.matched) matched++;
      if (r.settledNow) settled++;
    }
    offset += results.length;
    const total = Number(res?.paging?.total ?? 0);
    if (!results.length || (total && offset >= total)) break;
  }

  // Retro-enriquecimento: docs do espelho que ficaram sem nome (ingeridos antes
  // do fallback existir, ou já fora da janela deslizante do search) ganham o
  // GET por id na mesma cota — cada um tenta uma vez (payerDetail).
  if (enriched < enrichLimit) {
    const stale = (await repo.list("mp_payments")).filter((d) => !d.payerName && !d.payerDetail);
    for (const d of stale) {
      if (enriched >= enrichLimit) break;
      try {
        const full = await mp.getPayment(d.mpId);
        enriched++;
        await ingestMpPayment(repo, full, { discord, log, extra: { payerDetail: true } });
      } catch { /* tenta no próximo tick */ }
    }
  }

  const stamp = { id: "mp_sync", lastAt: now.toISOString(), lastSeen: seen, updatedAt: now.toISOString() };
  if (cfg) await repo.update("app_config", "mp_sync", stamp);
  else await repo.create("app_config", stamp);
  return { ok: true, seen, matched, settled, since: since.toISOString() };
}

// Poller de reconciliação (modelo do startShopifySync): rede de segurança pro
// webhook — mesmo sem ele configurado no painel do MP, os pagamentos entram no
// próximo tick. Sem MERCADOPAGO_ACCESS_TOKEN, fica DORMENTE.
export function startMpSync(repo = defaultRepo, { mp = defaultMp, discord = defaultDiscord, intervalMs = 10 * 60_000, log = console } = {}) {
  if (!mp?.configured?.()) { log.info?.("mp sync: sem MERCADOPAGO_ACCESS_TOKEN — desligado"); return () => {}; }
  let running = false;
  async function tick() {
    if (running) return; running = true;
    try {
      const r = await runMpSync(repo, mp, { discord, log });
      if (r.settled || r.seen) log.info?.(`mp sync: ${r.seen} pagamento(s) vistos, ${r.matched} casados, ${r.settled} fatura(s) baixada(s)`);
    } catch (err) { log.warn?.({ err: err.message }, "mp sync falhou (re-tenta no próximo ciclo)"); }
    finally { running = false; }
  }
  tick(); // corre no boot (faz o backfill imediato)
  const timer = setInterval(tick, intervalMs);
  if (timer.unref) timer.unref();
  return () => clearInterval(timer);
}
