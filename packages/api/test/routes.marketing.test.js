// Marketing (Meta Ads × funil) — client com paginação, sync idempotente
// (upsert por saas+campanha+dia) e métricas cruzadas: CPL real (leads do
// Cockpit), custo por estágio do funil (lead em estágio i conta pra 0..i) e
// agregados por campanha (CPL Meta).

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";

const { registerRoutes } = await import("../src/routes.js");
const { makeMeta } = await import("../src/meta.js");

// fetch fake do Graph: 1ª página com paging.next, 2ª sem.
function makeGraphFetch() {
  const page2 = {
    data: [
      { campaign_id: "c2", campaign_name: "Remarketing", date_start: "2026-06-02", spend: "50.5", impressions: "1000", clicks: "40", actions: [{ action_type: "lead", value: "2" }] },
    ],
  };
  const page1 = {
    data: [
      { campaign_id: "c1", campaign_name: "Prospecção", date_start: "2026-06-01", spend: "100", impressions: "5000", clicks: "100", actions: [{ action_type: "lead", value: "5" }, { action_type: "link_click", value: "90" }] },
      { campaign_id: "c1", campaign_name: "Prospecção", date_start: "2026-06-02", spend: "120", impressions: "6000", clicks: "110", actions: [] },
    ],
    paging: { next: "https://graph.facebook.com/v23.0/act_123/insights?after=xyz" },
  };
  let calls = 0;
  const f = async (url) => {
    calls++;
    const body = String(url).includes("after=xyz") ? page2 : page1;
    return { status: 200, text: async () => JSON.stringify(body) };
  };
  f.count = () => calls;
  return f;
}

function buildApp(repo) {
  const app = Fastify();
  const metaClient = makeMeta({ fetch: makeGraphFetch(), accessToken: "test-token" });
  registerRoutes(app, repo, { meta: metaClient });
  return app;
}

test("client: segue a paginação e normaliza spend/leads das actions", async () => {
  const metaClient = makeMeta({ fetch: makeGraphFetch(), accessToken: "t" });
  const rows = await metaClient.campaignInsights("123", { since: "2026-06-01", until: "2026-06-02" });
  assert.equal(rows.length, 3);
  assert.equal(rows[0].metaLeads, 5);       // action_type "lead" (canônico)
  assert.equal(rows[1].metaLeads, 0);       // sem action de lead
  assert.equal(rows[2].spend, 50.5);
});

test("sync: grava ad_insights e re-sync não duplica (upsert por saas+campanha+dia)", async () => {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds", metaAdAccount: "act_123", funnel: [] });
  const app = buildApp(repo);

  const r1 = (await app.inject({ method: "POST", url: "/api/marketing/sync", payload: { since: "2026-06-01", until: "2026-06-02" } })).json();
  assert.equal(r1.report.leverads.rows, 3);
  assert.equal((await repo.list("ad_insights")).length, 3);

  await app.inject({ method: "POST", url: "/api/marketing/sync", payload: { since: "2026-06-01", until: "2026-06-02" } });
  assert.equal((await repo.list("ad_insights")).length, 3); // idempotente

  await app.close();
});

test("métricas: CPL real, custo por estágio do funil e campanhas", async () => {
  const repo = makeMemRepo();
  await repo.create("products", {
    id: "leverads", name: "LeverAds", metaAdAccount: "act_123",
    funnel: [{ stage: "Inbox", conv: 1 }, { stage: "Call closer", conv: 0.5 }, { stage: "Ganho", conv: 0.4 }],
  });
  // 4 leads no período: 2 no Inbox, 1 na Call, 1 Ganho; 1 lead FORA do período.
  const mk = (id, stage, day) => repo.create("leads", { id, saas: "leverads", stage, createdAt: day + "T12:00:00.000Z" });
  await mk("l1", "Inbox", "2026-06-01");
  await mk("l2", "Inbox", "2026-06-02");
  await mk("l3", "Call closer", "2026-06-02");
  await mk("l4", "Ganho", "2026-06-02");
  await mk("l5", "Ganho", "2026-05-01"); // fora do range
  const app = buildApp(repo);
  await app.inject({ method: "POST", url: "/api/marketing/sync", payload: { since: "2026-06-01", until: "2026-06-02" } });

  const m = (await app.inject({ method: "GET", url: "/api/marketing/leverads?since=2026-06-01&until=2026-06-02" })).json();
  // spend total = 100 + 120 + 50.5 = 270.5
  assert.equal(m.totals.spend, 270.5);
  assert.equal(m.totals.leads, 4);
  assert.equal(m.totals.cpl, 67.63);            // 270.5 / 4
  assert.equal(m.totals.metaLeads, 7);
  assert.equal(m.totals.cplMeta, 38.64);        // 270.5 / 7

  // custo por estágio: Inbox 4 leads; Call 2 (l3+l4); Ganho 1 (l4)
  assert.deepEqual(m.perStage.map((s) => [s.stage, s.count, s.costPer]), [
    ["Inbox", 4, 67.63],
    ["Call closer", 2, 135.25],
    ["Ganho", 1, 270.5],
  ]);

  // campanhas ordenadas por spend; CPL Meta por campanha
  assert.equal(m.campaigns[0].id, "c1");
  assert.equal(m.campaigns[0].spend, 220);
  assert.equal(m.campaigns[0].cplMeta, 44);     // 220 / 5
  assert.equal(m.campaigns[1].cplMeta, 25.25);  // 50.5 / 2

  // série diária: spend + leads por dia
  assert.deepEqual(m.series.map((d) => [d.date, d.spend, d.leads]), [
    ["2026-06-01", 100, 1],
    ["2026-06-02", 170.5, 3],
  ]);

  await app.close();
});

test("sync sem Meta configurada → 503; sem ad account → 400; saas inexistente nas métricas → 404", async () => {
  const repo = makeMemRepo();
  const app = Fastify();
  registerRoutes(app, repo, { meta: makeMeta({}) }); // sem token
  assert.equal((await app.inject({ method: "POST", url: "/api/marketing/sync", payload: {} })).statusCode, 503);
  assert.equal((await app.inject({ method: "GET", url: "/api/marketing/nao-existe" })).statusCode, 404);
  await app.close();

  const repo2 = makeMemRepo();
  await repo2.create("products", { id: "p1", name: "P1" }); // sem metaAdAccount
  const app2 = buildApp(repo2);
  assert.equal((await app2.inject({ method: "POST", url: "/api/marketing/sync", payload: {} })).statusCode, 400);
  await app2.close();
});

// ── Nível anúncio (atribuição campanha → conjunto → anúncio) ────────────────

function makeAdLevelFetch() {
  const page = {
    data: [
      { campaign_id: "c1", campaign_name: "Prospecção", adset_id: "s1", adset_name: "Lookalike 1%", ad_id: "a1", ad_name: "Vídeo depoimento", date_start: "2026-06-01", spend: "60", impressions: "3000", clicks: "60", actions: [{ action_type: "lead", value: "3" }] },
      { campaign_id: "c1", campaign_name: "Prospecção", adset_id: "s1", adset_name: "Lookalike 1%", ad_id: "a2", ad_name: "Carrossel dor", date_start: "2026-06-01", spend: "40", impressions: "2000", clicks: "40", actions: [{ action_type: "lead", value: "2" }] },
      { campaign_id: "c1", campaign_name: "Prospecção", adset_id: "s2", adset_name: "Interesse ML", ad_id: "a3", ad_name: "Vídeo depoimento", date_start: "2026-06-02", spend: "100", impressions: "4000", clicks: "50", actions: [] },
    ],
  };
  return async () => ({ status: 200, text: async () => JSON.stringify(page) });
}

test("sync nível anúncio: linhas por ad, limpa legado na janela, preserva manual e fora da janela", async () => {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds", metaAdAccount: "act_123", funnel: [] });
  // legado nível-campanha DENTRO da janela (vira dupla contagem → some)
  await repo.create("ad_insights", { id: "ai_leverads_c1_2026-06-01", saas: "leverads", campaignId: "c1", campaignName: "Prospecção", date: "2026-06-01", spend: 99, impressions: 1, clicks: 1, metaLeads: 1 });
  // legado FORA da janela (fica)
  await repo.create("ad_insights", { id: "ai_leverads_c1_2026-05-01", saas: "leverads", campaignId: "c1", campaignName: "Prospecção", date: "2026-05-01", spend: 10, impressions: 1, clicks: 1, metaLeads: 1 });
  // gasto manual DENTRO da janela (fica)
  await repo.create("ad_insights", { id: "manual1", saas: "leverads", campaignId: "manual_influ", campaignName: "Influenciador", date: "2026-06-01", spend: 500, impressions: 0, clicks: 0, metaLeads: 0 });

  const app = Fastify();
  registerRoutes(app, repo, { meta: makeMeta({ fetch: makeAdLevelFetch(), accessToken: "t" }) });

  const r = (await app.inject({ method: "POST", url: "/api/marketing/sync", payload: { since: "2026-06-01", until: "2026-06-02" } })).json();
  assert.equal(r.report.leverads.rows, 3);

  const all = await repo.list("ad_insights");
  assert.equal(all.length, 5); // 3 ad-level + manual + legado fora da janela
  assert.ok(!all.some((x) => x.id === "ai_leverads_c1_2026-06-01"), "legado na janela removido");
  assert.ok(all.some((x) => x.id === "ai_leverads_c1_2026-05-01"), "legado fora da janela fica");
  assert.ok(all.some((x) => x.id === "manual1"), "gasto manual fica");
  assert.ok(all.some((x) => x.id === "ai_leverads_a1_2026-06-01"), "id por anúncio");

  // re-sync idempotente
  await app.inject({ method: "POST", url: "/api/marketing/sync", payload: { since: "2026-06-01", until: "2026-06-02" } });
  assert.equal((await repo.list("ad_insights")).length, 5);
  await app.close();
});

test("métricas: adsets/ads agregados com CPL real por utm.term/utm.content (id ou nome)", async () => {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds", metaAdAccount: "act_123", funnel: [] });
  const app = Fastify();
  registerRoutes(app, repo, { meta: makeMeta({ fetch: makeAdLevelFetch(), accessToken: "t" }) });
  await app.inject({ method: "POST", url: "/api/marketing/sync", payload: { since: "2026-06-01", until: "2026-06-02" } });

  const now = "2026-06-02T10:00:00.000Z";
  const mk = (id, utm) => repo.create("leads", { id, saas: "leverads", stage: "", createdAt: now, ...(utm ? { utm } : {}) });
  await mk("l1", { campaign: "c1", term: "s1", content: "a1" });
  await mk("l2", { campaign: "Prospecção", term: "Lookalike 1%", content: "a1" }); // match por nome
  await mk("l3", { campaign: "c1", term: "s2", content: "a3" });
  await mk("l4", null);

  const m = (await app.inject({ url: "/api/marketing/leverads?since=2026-06-01&until=2026-06-02" })).json();
  const s1 = m.adsets.find((s) => s.id === "s1");
  assert.equal(s1.spend, 100);          // 60 + 40
  assert.equal(s1.leads, 2);            // l1 (id) + l2 (nome)
  assert.equal(s1.cpl, 50);
  const a1 = m.ads.find((a) => a.id === "a1");
  assert.equal(a1.leads, 2);
  assert.equal(a1.cpl, 30);             // 60 / 2
  const a3 = m.ads.find((a) => a.id === "a3");
  assert.equal(a3.leads, 1);
  assert.equal(m.campaigns[0].leads, 3); // c1 por id e por nome

  // catálogo de atribuição pro drawer
  const cat = (await app.inject({ url: "/api/marketing/leverads/attribution" })).json();
  assert.equal(cat.campaigns.c1.name, "Prospecção");
  assert.equal(cat.adsets.s1.name, "Lookalike 1%");
  assert.deepEqual(cat.ads.a1, { name: "Vídeo depoimento", adsetId: "s1", campaignId: "c1" });
  await app.close();
});
