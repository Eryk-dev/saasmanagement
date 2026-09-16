import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";
import { registerMarketingRoutes, startMarketingAutoSync } from "../src/routes.marketing.js";
import { metaAdAccounts } from "../src/meta-accounts.js";
import { UPSTREAM_FAILED } from "../src/http-status.js";

const range = { since: "2026-09-15", until: "2026-09-16" };
const product = { id: "multi", metaAdAccount: "123", metaAdAccounts: ["act_123", "456"], funnel: [] };
const insight = (id, spend) => ({ date: range.since, campaignId: `c${id}`, adsetId: `s${id}`, adId: `a${id}`, adName: `[OEM] ${id}`, spend, impressions: 100, clicks: 10, metaLeads: 1 });
async function setup(t, meta, p = product) {
  const repo = makeMemRepo();
  await repo.create("products", p);
  const app = Fastify();
  registerMarketingRoutes(app, repo, { meta: { configured: () => true, ...meta } });
  t.after(() => app.close());
  return { repo, app };
}
const sync = (app) => app.inject({ method: "POST", url: "/api/marketing/sync", payload: { saas: "multi", ...range } });

test("contas Meta: normaliza e deduplica a principal e adicionais", () => {
  assert.deepEqual(metaAdAccounts({ metaAdAccount: " 123 ", metaAdAccounts: ["act_123", " 456 ", 456, "", null, {}, "../bad"] }), ["act_123", "act_456"]);
  assert.deepEqual(metaAdAccounts({ metaAdAccounts: "act_456" }), []);
  assert.deepEqual(metaAdAccounts({ metaAdAccounts: ["456"] }), ["act_456"]);
});

test("sync: duas contas somam gastos, mantêm origem e não duplicam no re-sync", async (t) => {
  const calls = [];
  const { app, repo } = await setup(t, { adInsights: async (id) => { calls.push(id); return [insight(id, id === "act_123" ? 10 : 20)]; } });
  await repo.create("products", { id: "outro", metaAdAccount: "789" });
  const first = (await sync(app)).json();
  assert.equal(first.ok, true);
  assert.equal(first.report.multi.rows, 2);
  assert.deepEqual(calls, ["act_123", "act_456"]);
  assert.deepEqual(Object.keys(first.report.multi.accounts), calls);
  await sync(app);
  const rows = await repo.list("ad_insights");
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => r.accountId), ["act_123", "act_456"]);
  assert.ok(rows.every((r) => r.saas === "multi"));
  const metrics = (await app.inject({ url: `/api/marketing/multi?since=${range.since}&until=${range.until}` })).json();
  assert.equal(metrics.totals.spend, 30);
  assert.equal((await repo.get("products", "multi")).metaAdAccount, "123");
});

test("sync parcial: atualiza conta acessível, preserva conta com erro e sinaliza falha", async (t) => {
  let failed = true;
  const { app, repo } = await setup(t, { adInsights: async (id) => {
    if (id === "act_456" && failed) throw new Error("sem permissão ads_read");
    return [insight(id, 20)];
  } });
  await repo.create("ad_insights", { id: "legacy1", saas: "multi", date: range.since, campaignId: "cact_123", spend: 7 });
  await repo.create("ad_insights", { id: "legacy2", saas: "multi", date: range.since, campaignId: "cact_456", spend: 9 });
  const result = (await sync(app)).json();
  assert.equal(result.ok, false);
  assert.equal(result.report.multi.ok, false);
  assert.equal(result.report.multi.rows, 1);
  assert.match(result.report.multi.accounts.act_456.error, /ads_read/);
  assert.equal(await repo.get("ad_insights", "legacy1"), null);
  assert.ok(await repo.get("ad_insights", "legacy2"));
  assert.equal((await repo.list("ad_insights")).reduce((sum, r) => sum + r.spend, 0), 29);
  failed = false;
  assert.equal((await sync(app)).json().ok, true);
  assert.equal((await repo.list("ad_insights")).length, 2);
  assert.equal(await repo.get("ad_insights", "legacy2"), null);
});

test("auto-sync inclui contas adicionais mesmo quando a principal falha", async () => {
  const repo = makeMemRepo();
  await repo.create("products", product);
  const calls = [], warnings = [];
  const auto = startMarketingAutoSync(repo, { immediate: false, intervalMs: 3600000, log: { warn: (msg) => warnings.push(msg) }, meta: {
    configured: () => true,
    adInsights: async (id) => { calls.push(id); if (id === "act_123") throw new Error("negado"); return [insight(id, 20)]; },
  } });
  auto.stop();
  await auto.tick();
  assert.deepEqual(calls, ["act_123", "act_456"]);
  assert.equal((await repo.list("ad_insights"))[0].accountId, "act_456");
  assert.match(warnings[0], /act_123.*negado/);
});

test("adobjects mostra as duas contas e mantém resultados quando um nível falha", async (t) => {
  const row = (id) => [{ id, effectiveStatus: "ACTIVE" }, { id: `old${id}`, effectiveStatus: "ARCHIVED" }];
  const { app } = await setup(t, {
    listCampaigns: async (id) => row(`c${id}`), listAccountAdsets: async (id) => row(`s${id}`),
    listAccountAds: async (id) => { if (id === "act_123") throw new Error("sem acesso"); return row(`a${id}`); },
  });
  const r = (await app.inject({ url: "/api/marketing/multi/adobjects" })).json();
  assert.deepEqual(r.campaigns.map((r) => r.accountId), ["act_123", "act_456"]);
  assert.equal(r.adsets.length, 2);
  assert.deepEqual(r.ads.map((r) => r.id), ["aact_456"]);
  assert.match(r.errors.ads, /act_123.*sem acesso/);
});

test("placements soma o mesmo posicionamento e invalida cache ao adicionar conta", async (t) => {
  let calls = 0;
  const { app, repo } = await setup(t, { placementInsights: async (id) => {
    calls++;
    return [{ platform: "instagram", position: "reels", spend: id === "act_123" ? 10 : 20, impressions: 1000, clicks: 50, linkClicks: 20, metaLeads: 2 }];
  } }, { ...product, metaAdAccounts: [] });
  const url = `/api/marketing/multi/placements?since=${range.since}&until=${range.until}`;
  assert.equal((await app.inject({ url })).json().placements[0].spend, 10);
  await repo.update("products", "multi", { metaAdAccounts: ["456"] });
  const r = (await app.inject({ url })).json();
  assert.equal(r.placements.length, 1);
  assert.equal(r.placements[0].spend, 30);
  assert.equal(r.placements[0].metaLeads, 4);
  assert.equal(r.placements[0].cplMeta, 7.5);
  assert.equal(r.placements[0].cpm, 15);
  await app.inject({ url });
  assert.equal(calls, 3);
});

test("placements não apresenta total incompleto como se fosse das duas contas", async (t) => {
  const { app } = await setup(t, { placementInsights: async (id) => {
    if (id === "act_456") throw new Error("negado");
    return [];
  } });
  assert.equal((await app.inject({ url: "/api/marketing/multi/placements" })).statusCode, UPSTREAM_FAILED);
});

test("atribuição usa adicionais, invalida cache e preserva catálogo se outra conta falhar", async (t) => {
  let failed = false;
  const { app, repo } = await setup(t, { listAccountAds: async (id) => {
    if (failed && id === "act_123") throw new Error("negado");
    return [{ id: `a${id}`, name: `[OEM] ${id}` }];
  } }, { ...product, metaAdAccounts: [] });
  const url = "/api/marketing/multi/attribution";
  assert.equal(Object.keys((await app.inject({ url })).json().ads).length, 1);
  await repo.update("products", "multi", { metaAdAccounts: ["456"] });
  failed = true;
  const partial = (await app.inject({ url })).json();
  assert.equal(partial.ads.aact_456.name, "[OEM] act_456");
  failed = false;
  assert.equal(Object.keys((await app.inject({ url })).json().ads).length, 2);
});
