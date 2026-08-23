// Financeiro · espelho das ASSINATURAS RECORRENTES do Mercado Pago
// (coleção mp_preapprovals) e o vínculo delas com os clientes do cockpit.
//
// O problema que isto resolve: as recorrências que estão cobrando hoje nasceram
// FORA do cockpit (painel do MP, copylever), então o cockpit não conhece nenhum
// preapproval — nenhuma assinatura tem mpPreapprovalId. Resultado: as cobranças
// mensais entram no espelho de pagamentos como "LeverAds: Assinatura recorrente"
// sem external_reference e sem dono, e cancelar/pausar no cockpit não mexe no MP.
//
// O espelho traz TODAS as preapprovals da conta e propõe o dono; o vínculo em si
// é humano (POST /api/mp/preapprovals/:id/link). É de propósito: vincular
// carimba mpPreapprovalId na assinatura, e a partir daí cancelar no cockpit
// CANCELA no MP (mirrorSubscriptionToMp) — um palpite errado cobraria caro.
//
// Casamento automático (só quando é FATO, não palpite):
//   1. assinatura do cockpit que já tem esse mpPreapprovalId (link do cockpit)
//   2. external_reference = id de assinatura do cockpit
// Sugestão (fica no doc pro seletor da tela vir preenchido, sem gravar nada na
// assinatura): e-mail do pagador = e-mail de exatamente UM cliente (ou UM lead
// já convertido).

import { repo as defaultRepo } from "./db.js";
import { mp as defaultMp } from "./mp.js";
import { discord as defaultDiscord } from "./discord.js";
import { cleanMasked } from "./mp-payments.js";
import { syncCustomerArr } from "./billing.js";
import { applyMpCancellationChurn, applyMpReactivationRescue } from "./churn.js";

// frequency/frequency_type do MP → ciclo do cockpit. O MP aceita "months" e
// "days"; recorrência em dias vira o ciclo do mês mais próximo (30d = mensal).
const CYCLE_BY_MONTHS = { 1: "monthly", 3: "quarterly", 6: "semiannual", 12: "annual" };
export function cycleOfAutoRecurring(auto = {}) {
  const n = Number(auto.frequency) || 0;
  const type = String(auto.frequency_type || "").toLowerCase();
  if (type.startsWith("month")) return CYCLE_BY_MONTHS[n] || "";
  if (type.startsWith("day")) return CYCLE_BY_MONTHS[Math.round(n / 30)] || "";
  return "";
}

// Campos do /preapproval do MP → doc do espelho (valores em reais).
export function normalizePreapproval(pre) {
  const auto = pre.auto_recurring || {};
  const sum = pre.summarized || {};
  return {
    mpId: String(pre.id),
    status: pre.status || "",                 // pending|authorized|paused|cancelled
    reason: pre.reason || "",
    amount: Number(auto.transaction_amount) || 0,
    frequency: Number(auto.frequency) || 0,
    frequencyType: auto.frequency_type || "",
    cycle: cycleOfAutoRecurring(auto),
    payerEmail: cleanMasked(pre.payer_email).toLowerCase(),
    payerId: pre.payer_id != null ? String(pre.payer_id) : "",
    externalReference: String(pre.external_reference || ""),
    initPoint: pre.init_point || "",
    dateCreated: pre.date_created || "",
    lastModified: pre.last_modified || "",
    nextPaymentDate: pre.next_payment_date || "",
    lastChargedDate: sum.last_charged_date || "",
    lastChargedAmount: Number(sum.last_charged_amount) || 0,
    chargedQuantity: Number(sum.charged_quantity) || 0,
    chargedAmount: Number(sum.charged_amount) || 0,
  };
}

export const preapprovalDocId = (mpId) => `mps_${String(mpId)}`;

// Assinaturas do cliente que podem receber o vínculo (cancelada não recebe).
export const linkableSubs = (subs, customerId) =>
  subs.filter((s) => s.customer === customerId && s.status !== "canceled");

// Carimba o vínculo NA ASSINATURA do cockpit: daqui em diante o webhook acha a
// assinatura por mpPreapprovalId (status do MP espelhado, cobrança recorrente
// dando baixa na fatura) e o espelho de pagamentos casa as cobranças com o
// cliente certo. Não mexe no `status` do cockpit de propósito — a foto do MP
// fica em mpStatus e quem decide dar baixa/cancelar é a tela.
export async function attachPreapprovalToSub(repo, sub, doc) {
  return repo.update("subscriptions", sub.id, {
    mpPreapprovalId: doc.mpId,
    mpStatus: doc.status,
    ...(doc.payerEmail && !sub.payerEmail ? { payerEmail: doc.payerEmail } : {}),
    ...(doc.initPoint && !sub.mpInitPoint ? { mpInitPoint: doc.initPoint } : {}),
  });
}

const sameDoc = (a, b, keys) => a && keys.every((k) => JSON.stringify(a[k] ?? null) === JSON.stringify(b[k] ?? null));

// Upsert do espelho + casamento por FATO + sugestão de dono. Idempotente: o
// poller repassa a mesma lista a cada tick e, sem mudança, não escreve (sem
// escrita não há SSE/refresh).
export async function ingestPreapproval(repo, pre, { log, discord } = {}) {
  const docId = preapprovalDocId(pre.id);
  const prev = await repo.get("mp_preapprovals", docId);
  const base = normalizePreapproval(pre);
  // A busca pode devolver o pagador mascarado — e-mail já conhecido não regride.
  if (prev) {
    base.payerEmail = base.payerEmail || String(prev.payerEmail || "").toLowerCase();
    base.payerId = base.payerId || prev.payerId || "";
  }

  const subs = await repo.list("subscriptions");
  // Vínculo já feito (aqui ou pelo /mp/link) é a verdade — mas some se alguém
  // desvinculou/apagou a assinatura do lado do cockpit.
  let linked = subs.find((s) => s.mpPreapprovalId === base.mpId) || null;
  if (!linked && base.externalReference) {
    const byRef = subs.find((s) => s.id === base.externalReference) || null;
    if (byRef && !byRef.mpPreapprovalId) {
      linked = await attachPreapprovalToSub(repo, byRef, base);
      log?.info?.({ preapproval: base.mpId, sub: byRef.id }, "MP: recorrência casada por external_reference");
    }
  }

  const link = linked
    ? { subscription: linked.id, customer: linked.customer || "", saas: linked.saas || "", matchedBy: prev?.matchedBy || "reference" }
    : { subscription: "", customer: "", saas: "", matchedBy: "" };

  // Sugestão (não grava nada na assinatura): e-mail exato de UM cliente, senão
  // de UM lead já convertido. Recalculada a cada sync — cliente cadastrado
  // depois passa a ser sugerido sem intervenção.
  const suggest = { suggestedCustomer: "", suggestedSubscription: "", suggestedBy: "" };
  if (!linked && base.payerEmail) {
    const byEmail = (await repo.list("customers"))
      .filter((c) => String(c.email || "").trim().toLowerCase() === base.payerEmail);
    let customerId = byEmail.length === 1 ? byEmail[0].id : "";
    if (!customerId && !byEmail.length) {
      const byLead = (await repo.list("leads"))
        .filter((l) => String(l.email || "").trim().toLowerCase() === base.payerEmail && l.customerId);
      if (byLead.length === 1) customerId = byLead[0].customerId;
    }
    if (customerId) {
      const cand = linkableSubs(subs, customerId).filter((s) => !s.mpPreapprovalId);
      Object.assign(suggest, {
        suggestedCustomer: customerId,
        suggestedSubscription: cand.length === 1 ? cand[0].id : "",
        suggestedBy: "email",
      });
    }
  }

  const doc = { ...base, ...link, ...suggest };
  const KEYS = Object.keys(doc);
  let saved;
  if (!prev) saved = await repo.create("mp_preapprovals", { id: docId, ...doc, syncedAt: new Date().toISOString() });
  else if (!sameDoc(prev, doc, KEYS)) saved = await repo.update("mp_preapprovals", docId, { ...doc, syncedAt: new Date().toISOString() });
  else saved = prev;

  // Assinatura já vinculada: espelha o retrato do MP com o MESMO mapeamento do
  // webhook — o poller é a rede de segurança quando o webhook não está
  // configurado no painel, então cancelar/pausar/reativar lá tem que chegar
  // aqui também (antes só o mpStatus mudava e o cliente ficava "ativo" pra
  // sempre). Cancelamento carimba canceledAt e pode churnar o CLIENTE
  // (applyMpCancellationChurn); reativação resgata churn feito pelo MP.
  if (linked && (linked.mpStatus !== base.status)) {
    const mapped = { authorized: "active", cancelled: "canceled", paused: "paused" }[base.status];
    const statusChanges = !!mapped && linked.status !== mapped;
    const updatedSub = await repo.update("subscriptions", linked.id, {
      mpStatus: base.status,
      ...(statusChanges ? { status: mapped } : {}),
      ...(mapped === "canceled" && !linked.canceledAt ? { canceledAt: new Date().toISOString() } : {}),
    });
    if (statusChanges) {
      if (base.status === "cancelled") await applyMpCancellationChurn(repo, updatedSub, { discord, log });
      else if (base.status === "authorized") await applyMpReactivationRescue(repo, updatedSub, { log });
      // Depois do churn de propósito: cliente churnado congela o arr (billing.js).
      await syncCustomerArr(repo, updatedSub.customer);
      log?.info?.({ preapproval: base.mpId, sub: linked.id, status: mapped }, "MP: status da recorrência espelhado pelo poller");
    }
  }

  return { preapproval: saved, linked: !!linked };
}

// Uma passada: varre as preapprovals da conta e ingere uma a uma. Carimbo em
// app_config "mp_preapproval_sync" — a tela mostra o último sync.
export async function runPreapprovalSync(repo, mp, { log, discord, now = new Date(), maxPages = 20, pageSize = 50 } = {}) {
  if (!mp?.configured?.()) return { ok: false, error: "not_configured" };
  let offset = 0, seen = 0, linked = 0;
  for (let page = 0; page < maxPages; page++) {
    const res = await mp.searchPreapprovals({ limit: pageSize, offset });
    const results = Array.isArray(res?.results) ? res.results : [];
    for (const pre of results) {
      const r = await ingestPreapproval(repo, pre, { log, discord });
      seen++;
      if (r.linked) linked++;
    }
    offset += results.length;
    const total = Number(res?.paging?.total ?? 0);
    if (!results.length || (total && offset >= total)) break;
  }
  const cfg = await repo.get("app_config", "mp_preapproval_sync");
  const stamp = { id: "mp_preapproval_sync", lastAt: now.toISOString(), lastSeen: seen, updatedAt: now.toISOString() };
  if (cfg) await repo.update("app_config", "mp_preapproval_sync", stamp);
  else await repo.create("app_config", stamp);
  return { ok: true, seen, linked, unlinked: seen - linked };
}

// Poller (mesmo modelo do startMpSync): recorrência criada/cancelada no painel
// do MP aparece sozinha. Cadência folgada — preapproval muda pouco.
export function startPreapprovalSync(repo = defaultRepo, { mp = defaultMp, discord = defaultDiscord, intervalMs = 30 * 60_000, log = console } = {}) {
  if (!mp?.configured?.()) { log.info?.("mp preapprovals: sem MERCADOPAGO_ACCESS_TOKEN — desligado"); return () => {}; }
  let running = false;
  async function tick() {
    if (running) return; running = true;
    try {
      const r = await runPreapprovalSync(repo, mp, { log, discord });
      if (r.seen) log.info?.(`mp preapprovals: ${r.seen} recorrência(s) na conta, ${r.linked} vinculada(s)`);
    } catch (err) { log.warn?.({ err: err.message }, "mp preapprovals: sync falhou (re-tenta no próximo ciclo)"); }
    finally { running = false; }
  }
  tick();
  const timer = setInterval(tick, intervalMs);
  if (timer.unref) timer.unref();
  return () => clearInterval(timer);
}
