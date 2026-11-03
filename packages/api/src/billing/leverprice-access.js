// Liberação do LeverPrice pelo status pago (03/11/2026). O cadastro pelo link da
// venda cria a org do LeverPrice TRANCADA (`payment_active` e
// `leverprice_enabled` falsos): o cliente via "Sua organização ainda não tem o
// LeverPrice liberado" até alguém ligar as duas marcações no Super Admin.
// Decisão do usuário: liberar sozinho quando o Cockpit vê a venda PAGA.
//
// Regra (leverpriceReleaseOf): libera quando
//   · o cliente tem org do LeverPrice vinculada (`leverpriceOrgId`);
//   · a venda inclui o LeverPrice (direito do produto em entitlements.js ou o
//     produto no negócio, shared/signup-products.js);
//   · a assinatura do LeverPrice está ativa (não vencida, não cancelada);
//   · e o pagamento está em dia: ao menos uma fatura paga e nenhuma vencida
//     (financialStatusOf, a régua do status financeiro do cliente).
//
// SÓ LIBERA, nunca corta (mesma decisão do LeverAds, leverads-access.js). Quem
// recebe é a rota de serviço do PRÓPRIO produto, nunca SQL no banco dele:
//   PUT {LEVERPRICE_API_URL}/api/service/cockpit/orgs/:id/leverprice-access
//   header X-Cockpit-Service-Key = LEVERPRICE_SERVICE_KEY (a mesma chave do
//   aviso de cadastro, nos dois sentidos).
// Depois de liberar, o cliente ganha o carimbo `leverpriceAccess` e sai da
// lista: o produto é idempotente, mas não há por que repetir.
//
// DRY-RUN por padrão, como o LeverAds: sem LEVERPRICE_ACCESS_APPLY=1 o tick só
// relata (GET /api/leverprice-access/status). Liberar acontece no tick (10 min,
// pega quem pagou depois do cadastro) e na hora do vínculo pelo link de
// cadastro (customers/leverprice-orgs.js), para quem já tinha pago.

import { NOT_CONFIGURED } from "../platform/http-status.js";
import { desiredAccess, desiredEntitlements, plansByCodeOf } from "./entitlements.js";
import { isChurnedCustomer } from "./churn.js";
import { financialStatusOf } from "../customers/lifecycle.js";
import { dealProductsOf } from "../shared/signup-products.js";

export { NOT_CONFIGURED };
const DEFAULT_INTERVAL_MS = 10 * 60 * 1000;
export const NOT_CONFIGURED_MSG = "liberação do LeverPrice desligada: defina LEVERPRICE_SERVICE_KEY (e LEVERPRICE_API_URL fora do padrão)";

export function makeLeverpriceClient({ baseUrl = "", serviceKey = "", fetchImpl = fetch } = {}) {
  const base = String(baseUrl || "").replace(/\/+$/, "");
  async function request(path, opts = {}) {
    const res = await fetchImpl(`${base}${path}`, {
      ...opts,
      headers: { "Content-Type": "application/json", "X-Cockpit-Service-Key": serviceKey, ...(opts.headers || {}) },
    });
    if (!res.ok) throw new Error(`${opts.method || "GET"} ${path} → HTTP ${res.status}`);
    return res.json();
  }
  const path = (orgId) => `/api/service/cockpit/orgs/${encodeURIComponent(orgId)}/leverprice-access`;
  return {
    configured: () => Boolean(base && serviceKey),
    release: (orgId, body) => request(path(orgId), { method: "PUT", body: JSON.stringify({ ...body, liberar: true }) }),
    status: (orgId) => request(path(orgId)),
  };
}

// A API mora no mesmo host do app (o link de cadastro usa LEVERPRICE_APP_URL).
export function envLeverpriceClient(env = process.env) {
  return makeLeverpriceClient({
    baseUrl: env.LEVERPRICE_API_URL || env.LEVERPRICE_APP_URL || "https://leverprice.com.br",
    serviceKey: env.LEVERPRICE_SERVICE_KEY || "",
  });
}

// A régua: libera ou não, e por quê (o motivo aparece no relatório).
export function leverpriceReleaseOf(customer, { subs = [], invoices = [], plans = [], now = Date.now() } = {}) {
  if (!String(customer?.leverpriceOrgId || "").trim()) return { release: false, reason: "sem conta do LeverPrice vinculada" };
  if (isChurnedCustomer(customer, now)) return { release: false, reason: "cliente encerrado" };
  const ent = (desiredEntitlements(customer, subs, plansByCodeOf(plans)) || []).find((e) => e.product === "leverprice") || null;
  const sold = Boolean(ent) || dealProductsOf({ customer, plans }).includes("leverprice");
  if (!sold) return { release: false, reason: "a venda não inclui o LeverPrice" };
  // Sem plano do catálogo (venda antiga ou personalizada): a régua de acesso
  // das assinaturas do cliente, a mesma do LeverAds.
  const access = ent ? { active: ent.access.active, reason: ent.access.reason } : (() => {
    const a = desiredAccess(customer, subs);
    return a ? { active: a.paymentActive, reason: a.reason } : { active: false, reason: "sem assinatura ativa" };
  })();
  if (!access.active) return { release: false, reason: access.reason };
  const fin = financialStatusOf(subs, invoices);
  if (fin === "inadimplente") return { release: false, reason: "fatura vencida" };
  if (fin !== "adimplente") return { release: false, reason: "aguardando o 1º pagamento" };
  return { release: true, reason: "pagamento em dia", ref: ent?.ref || "" };
}

const alreadyReleased = (c) => Boolean(c.leverpriceAccess?.releasedAt) && c.leverpriceAccess.orgId === String(c.leverpriceOrgId || "").trim().toLowerCase();

// Um tick. `only` restringe a um cliente (o vínculo pelo link de cadastro).
export async function runLeverpriceAccess(repo, { client, apply = false, only = "", now = new Date(), log } = {}) {
  const report = { mode: apply ? "apply" : "dry-run", at: now.toISOString(), checked: 0, released: [], planned: [], waiting: [], errors: [] };
  const all = only ? [await repo.get("customers", only)].filter(Boolean) : await repo.list("customers");
  const targets = all.filter((c) => String(c.leverpriceOrgId || "").trim() && !alreadyReleased(c));
  if (!targets.length) return report;
  const plans = await repo.list("plans").catch(() => []);
  for (const c of targets) {
    report.checked++;
    const [subs, invoices] = await Promise.all([
      repo.listWhere("subscriptions", { customer: c.id }),
      repo.listWhere("invoices", { customer: c.id }),
    ]);
    const d = leverpriceReleaseOf(c, { subs, invoices, plans, now: now.getTime() });
    const row = { customer: c.id, name: c.name || "", org: String(c.leverpriceOrgId).trim().toLowerCase(), reason: d.reason };
    if (!d.release) { report.waiting.push(row); continue; }
    if (!apply) { report.planned.push(row); continue; }
    try {
      const res = await client.release(row.org, { cliente: c.id, motivo: `Cockpit: ${d.reason}`, ref: d.ref || "" });
      await repo.update("customers", c.id, {
        leverpriceAccess: { releasedAt: now.toISOString(), orgId: row.org, reason: d.reason, changed: Boolean(res?.changed) },
      }, { silent: true });
      report.released.push({ ...row, changed: Boolean(res?.changed) });
      log?.info?.({ customer: c.id, org: row.org, changed: Boolean(res?.changed) }, "leverprice-access: liberado");
    } catch (err) {
      report.errors.push({ ...row, error: err.message });
      log?.warn?.({ customer: c.id, err: err.message }, "leverprice-access: falhou");
    }
  }
  return report;
}

// Liberação de um cliente, na hora do vínculo pelo link de cadastro. Nunca
// quebra quem chamou: sem chave, desligado ou com erro, só relata.
export async function releaseLeverpriceFor(repo, customerId, { client = envLeverpriceClient(), apply = process.env.LEVERPRICE_ACCESS_APPLY === "1", log } = {}) {
  if (!client.configured()) return { mode: "not-configured" };
  try { return await runLeverpriceAccess(repo, { client, apply, only: customerId, log }); }
  catch (err) { log?.warn?.({ customer: customerId, err: err.message }, "leverprice-access: liberação no vínculo falhou"); return { mode: "error", error: err.message }; }
}

let lastReport = null;
export const leverpriceAccessReport = () => lastReport;
export async function runAndKeep(repo, opts) {
  lastReport = await runLeverpriceAccess(repo, opts);
  return lastReport;
}

export function startLeverpriceAccess(repo, { log, intervalMs = DEFAULT_INTERVAL_MS, client = envLeverpriceClient() } = {}) {
  if (!client.configured()) {
    log?.info?.(`leverprice-access: ${NOT_CONFIGURED_MSG}`);
    return () => {};
  }
  const apply = process.env.LEVERPRICE_ACCESS_APPLY === "1";
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try { await runAndKeep(repo, { client, apply, log }); }
    catch (err) { log?.warn?.({ err: err.message }, "leverprice-access: tick falhou"); }
    finally { running = false; }
  };
  const first = setTimeout(tick, 60_000);
  first.unref?.();
  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  return () => { clearTimeout(first); clearInterval(timer); };
}
