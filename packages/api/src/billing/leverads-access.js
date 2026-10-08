// Sync de acesso do produto LeverAds (copylever) — o cockpit é o system-of-record
// do que foi pago; o corte/liberação vai pela API do PRÓPRIO produto: a rota de
// serviço do cockpit (PUT /api/service/cockpit/orgs/:id/payment, com
// LEVERADS_SERVICE_KEY) ou, sem ela, a API super-admin (PUT /api/super/orgs/:id).
// As duas são auditadas lá como org_settings_changed. NUNCA SQL direto no banco
// do app — combinado com o Leonardo em 15/08/2026.
//
// Semântica do produto (copylever/app/routers/auth.py, require_active_org):
//   orgs.active=false        → kill switch absoluto (só humano mexe — nunca aqui);
//   orgs.access_until futuro → cortesia allow-only (só humano mexe — nunca aqui);
//   orgs.payment_active      → o paywall de verdade. É SÓ isso que o sync escreve.
//
// Regras (deliberadamente conservadoras):
//   · só clientes do saas do Levercopy COM leveradsOrgId preenchido (de-para
//     explícito) — org fora do de-para nunca é tocada;
//   · assinatura past_due → corta; ativa em dia → garante liberado; cliente
//     encerrado (endedAt) ou só com assinatura cancelada/pausada → corta;
//   · cliente sem assinatura no cockpit → não mexe (não dá pra inferir).
//
// DRY-RUN por padrão: sem LEVERADS_ACCESS_APPLY=1 o tick só reporta o que faria
// (report.planned em GET /api/leverads-access/status) — a ativação em produção
// é revisada antes de valer. POST /api/leverads-access/run {apply:true} força
// um tick aplicando (pra primeira virada assistida).
//
// LIMITES do plano (contas, cota de OEM, Lever Price): o tick também compara o
// que o plano contratado dá (entitlements.js) com o que a org tem, e devolve a
// diferença em `report.limits`. É só relatório: nenhum limite é escrito no
// produto, com apply ou sem — a escrita entra depois de o relatório ser revisado.

import { NOT_CONFIGURED } from "../platform/http-status.js";
import { desiredAccess, desiredEntitlements, leveradsLimitFields, limitsDiff, orgRefOf, plansByCodeOf } from "./entitlements.js";

// A régua do acesso mora em entitlements.js; segue exportada daqui.
export { desiredAccess };

const DEFAULT_BASE_URL = "https://copy.levermoney.com.br";
const DEFAULT_INTERVAL_MS = 10 * 60 * 1000; // mesmo ritmo do espelho MP

const NOT_CONFIGURED_MSG = "sync desligado — defina LEVERADS_SERVICE_KEY (ou LEVERADS_ADMIN_EMAIL/LEVERADS_ADMIN_PASSWORD)";

// Exportado para o espelho de orgs (customers/leverads-orgs.js), que lê a
// mesma lista com a mesma credencial.
export function envClient() {
  return makeLeveradsClient({
    baseUrl: process.env.LEVERADS_API_URL || DEFAULT_BASE_URL,
    serviceKey: process.env.LEVERADS_SERVICE_KEY || "",
    email: process.env.LEVERADS_ADMIN_EMAIL || "",
    password: process.env.LEVERADS_ADMIN_PASSWORD || "",
  });
}

// Cliente HTTP da API do produto. Com `serviceKey` usa a rota de serviço do
// cockpit (/api/service/cockpit/*, header X-Cockpit-Service-Key): só lista
// orgs e muda payment_active, sem senha de super admin — é o caminho que
// sobrevive à virada do login do LeverAds para o LeverId (docs/PLANO-AUTH.md).
// Sem ela, cai no login de super admin por senha (legado, até a chave estar
// configurada nos dois lados).
export function makeLeveradsClient({ baseUrl = "", serviceKey = "", email = "", password = "", fetchImpl = fetch } = {}) {
  const base = baseUrl.replace(/\/+$/, "");
  if (serviceKey) return makeServiceClient({ base, serviceKey, fetchImpl });
  let token = "";

  async function login() {
    const res = await fetchImpl(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) throw new Error(`login no produto falhou (HTTP ${res.status})`);
    token = (await res.json()).token || "";
    if (!token) throw new Error("login no produto não devolveu token");
  }

  async function request(path, opts = {}, retry = true) {
    if (!token) await login();
    const res = await fetchImpl(`${base}${path}`, {
      ...opts,
      headers: { "Content-Type": "application/json", "X-Auth-Token": token, ...(opts.headers || {}) },
    });
    if (res.status === 401 && retry) { token = ""; return request(path, opts, false); }
    if (!res.ok) throw new Error(`${opts.method || "GET"} ${path} → HTTP ${res.status}`);
    return res.json();
  }

  return {
    mode: "password",
    configured: () => Boolean(base && email && password),
    listOrgs: () => request("/api/super/orgs"),
    updateOrg: (id, patch) => request(`/api/super/orgs/${id}`, { method: "PUT", body: JSON.stringify(patch) }),
  };
}

function makeServiceClient({ base, serviceKey, fetchImpl }) {
  async function request(path, opts = {}) {
    const res = await fetchImpl(`${base}${path}`, {
      ...opts,
      headers: { "Content-Type": "application/json", "X-Cockpit-Service-Key": serviceKey, ...(opts.headers || {}) },
    });
    if (!res.ok) throw new Error(`${opts.method || "GET"} ${path} → HTTP ${res.status}`);
    return res.json();
  }
  return {
    mode: "service",
    configured: () => Boolean(base && serviceKey),
    listOrgs: () => request("/api/service/cockpit/orgs"),
    // A rota de serviço só muda payment_active — é tudo o que o sync escreve.
    updateOrg: (id, patch) => {
      const keys = Object.keys(patch || {});
      if (keys.length !== 1 || keys[0] !== "payment_active") {
        return Promise.reject(new Error(`rota de serviço só muda payment_active (recebeu ${keys.join(", ") || "nada"})`));
      }
      return request(`/api/service/cockpit/orgs/${encodeURIComponent(id)}/payment`, {
        method: "PUT", body: JSON.stringify({ payment_active: Boolean(patch.payment_active) }),
      });
    },
  };
}

// Um tick do sync. Sempre devolve o report completo — em dry-run, `planned`
// lista o que seria feito; em apply, `applied` conta o que foi.
export async function runLeveradsAccessSync(repo, { client, apply = false, log } = {}) {
  const saasId = process.env.LEVERCOPY_SAAS_ID || "leverads";
  const report = {
    mode: apply ? "apply" : "dry-run", at: new Date().toISOString(),
    checked: 0, inSync: 0, applied: 0, planned: [], skipped: [], errors: [],
    // Limites do plano (contas, cota de OEM, Lever Price) × o que a org tem no
    // produto. SÓ RELATÓRIO: nada daqui é escrito, com apply ou sem.
    limits: { mode: "report", inSync: 0, planned: [], skipped: [], unsupported: [] },
  };
  const customers = (await repo.list("customers")).filter((c) => c.saas === saasId && c.leveradsOrgId);
  if (!customers.length) return report;

  const subsAll = await repo.list("subscriptions");
  const plansByCode = plansByCodeOf(await repo.list("plans"));
  const orgById = new Map((await client.listOrgs()).map((o) => [String(o.id), o]));

  for (const customer of customers) {
    report.checked++;
    const subs = subsAll.filter((s) => s.customer === customer.id);
    const want = desiredAccess(customer, subs);
    if (!want) {
      report.skipped.push({ customer: customer.id, name: customer.name, reason: "sem assinatura no cockpit" });
      continue;
    }
    const org = orgById.get(String(customer.leveradsOrgId));
    if (!org) {
      report.errors.push({ customer: customer.id, name: customer.name, error: `org ${customer.leveradsOrgId} não existe no produto` });
      continue;
    }
    if (want.paymentActive) limitsReport(report.limits, customer, org, desiredEntitlements(customer, subs, plansByCode, { defaultProduct: "leverads" }));
    if (Boolean(org.payment_active) === want.paymentActive) { report.inSync++; continue; }
    const action = {
      customer: customer.id, name: customer.name, org: org.id, orgName: org.name,
      from: Boolean(org.payment_active), to: want.paymentActive, reason: want.reason,
    };
    report.planned.push(action);
    if (!apply) continue;
    try {
      await client.updateOrg(org.id, { payment_active: want.paymentActive });
      report.applied++;
    } catch (err) {
      report.errors.push({ ...action, error: err.message });
    }
  }
  if (report.planned.length || report.errors.length) {
    log?.info({ leveradsAccess: report }, `leverads-access: ${report.mode} — ${report.planned.length} mudança(s), ${report.errors.length} erro(s)`);
  }
  return report;
}

// Compara os limites do plano com a org e anota no relatório. Conservador:
// venda personalizada ou sem plano identificado fica com limites manuais, e org
// com assinatura self-service do próprio produto (plan_id) não é comparada, já
// que lá as contas pagas entram na cobrança do produto.
function limitsReport(out, customer, org, entitlements) {
  const who = { customer: customer.id, name: customer.name, org: org.id, orgName: org.name };
  for (const ent of entitlements || []) {
    if (ent.source !== "plan") {
      out.skipped.push({ ...who, product: ent.product, reason: "plano personalizado ou não identificado: limites manuais" });
      continue;
    }
    if (org.plan_id) {
      out.skipped.push({ ...who, product: ent.product, plan: ent.planCode, reason: "org com assinatura self-service no produto (plan_id)" });
      continue;
    }
    const want = leveradsLimitFields(ent);
    if (!Object.keys(want).length) continue;
    const { changes, unsupported } = limitsDiff(org, want);
    if (unsupported.length) out.unsupported.push({ ...who, product: ent.product, plan: ent.planCode, fields: unsupported });
    if (Object.keys(changes).length) out.planned.push({ ...who, product: ent.product, plan: ent.planCode, changes });
    else if (!unsupported.length) out.inSync++;
  }
}

let lastReport = null;

const isAdmin = (u) => !u || (u.roles || []).includes("admin"); // sem sessão = key mestre

export function startLeveradsAccessSync(repo, { log, intervalMs, client } = {}) {
  const cli = client || envClient();
  if (!cli.configured()) {
    log?.info(`leverads-access: desligado (${NOT_CONFIGURED_MSG.replace("sync desligado — ", "")})`);
    return () => {};
  }
  const apply = process.env.LEVERADS_ACCESS_APPLY === "1";
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try { lastReport = await runLeveradsAccessSync(repo, { client: cli, apply, log }); }
    catch (err) { log?.warn({ err: err.message }, "leverads-access: tick falhou"); }
    finally { running = false; }
  };
  tick();
  const timer = setInterval(tick, intervalMs || DEFAULT_INTERVAL_MS);
  timer.unref?.();
  return () => clearInterval(timer);
}

export function registerLeveradsAccessRoutes(app, repo, { client } = {}) {
  // Tick manual. {apply:true} no body aplica MESMO com o env em dry-run — é o
  // caminho da primeira virada assistida em produção. Por escrever no produto
  // (corta/libera cliente), forçar o apply pede etiqueta admin; sem sessão é a
  // key mestre (MCP/integrações), que passa.
  const run = async (req, reply) => {
    if (req.body?.apply === true && !isAdmin(req.authUser)) {
      return reply.code(403).send({ error: "Aplicar o sync de acesso exige etiqueta admin" });
    }
    const cli = client || envClient();
    if (!cli.configured()) {
      return reply.code(NOT_CONFIGURED).send({ error: NOT_CONFIGURED_MSG });
    }
    const apply = req.body?.apply === true || process.env.LEVERADS_ACCESS_APPLY === "1";
    lastReport = await runLeveradsAccessSync(repo, { client: cli, apply, log: req.log });
    return lastReport;
  };
  app.post("/api/leverads-access/run", run);
  app.post("/api/entitlements/run", run);
  // Último report (do poller ou de um run manual) — é aqui que o dry-run é revisado.
  const status = async () => lastReport || { mode: "never-ran" };
  app.get("/api/leverads-access/status", status);
  // Mesma coisa sob o nome novo: o report traz acesso + limites por plano.
  app.get("/api/entitlements/status", status);
  // O direito de UM cliente (ficha): o que o plano dá, a org vinculada em cada
  // sistema e o que o último report achou dele.
  app.get("/api/entitlements/customers/:id", async (req, reply) => {
    const customer = await repo.get("customers", req.params.id);
    if (!customer) return reply.code(404).send({ error: "cliente não encontrado" });
    const subs = (await repo.list("subscriptions")).filter((s) => s.customer === customer.id);
    const saasId = process.env.LEVERCOPY_SAAS_ID || "leverads";
    const entitlements = desiredEntitlements(customer, subs, plansByCodeOf(await repo.list("plans")), {
      defaultProduct: customer.saas === saasId ? "leverads" : "",
    });
    const mine = (rows) => (rows || []).filter((r) => r.customer === customer.id);
    return {
      customer: customer.id, orgs: orgRefOf(customer), entitlements,
      lastReport: lastReport ? {
        at: lastReport.at, mode: lastReport.mode,
        access: mine(lastReport.planned), errors: mine(lastReport.errors),
        limits: { planned: mine(lastReport.limits?.planned), skipped: mine(lastReport.limits?.skipped), unsupported: mine(lastReport.limits?.unsupported) },
      } : null,
    };
  });
  // Lista enxuta das orgs do produto pro select "Org na LeverAds" do cadastro
  // de cliente (vínculo manual do de-para — clientes antigos sem match e os
  // futuros). O value do select é o id da org.
  app.get("/api/leverads-access/orgs", async (req, reply) => {
    const cli = client || envClient();
    if (!cli.configured()) {
      return reply.code(NOT_CONFIGURED).send({ error: NOT_CONFIGURED_MSG });
    }
    const orgs = await cli.listOrgs();
    return orgs
      .map((o) => ({
        id: o.id, name: o.name || "", email: o.email || "",
        active: Boolean(o.active), paymentActive: Boolean(o.payment_active),
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  });
}
