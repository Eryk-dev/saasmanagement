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

  // visitas no form no período (2 sessões view, 1 start) + 1 fora do período
  const fe = (sess, event, day) => repo.create("form_events", { id: `fe_${sess}_${event}_${day}`, form: "fo_x", saas: "leverads", session: sess, event, key: "", createdAt: day + "T10:00:00.000Z" });
  await fe("v1", "view", "2026-06-01");
  await fe("v1", "start", "2026-06-01");
  await fe("v2", "view", "2026-06-02");
  await fe("v3", "view", "2026-05-01"); // fora do range

  const m = (await app.inject({ method: "GET", url: "/api/marketing/leverads?since=2026-06-01&until=2026-06-02" })).json();
  // spend total = 100 + 120 + 50.5 = 270.5
  assert.equal(m.totals.spend, 270.5);
  assert.equal(m.totals.leads, 4);
  assert.equal(m.totals.formViews, 2);   // sessões únicas na janela
  assert.equal(m.totals.formStarts, 1);
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

// ── Criativos (upload de vídeo → anúncio pausado) e quebra por dor ──────────

const { painCode, CREATIVE_URL_TAGS } = await import("../src/routes.marketing.js");
const multipart = (await import("@fastify/multipart")).default;

test("painCode: extrai o código [X] de qualquer posição do nome do anúncio", () => {
  assert.equal(painCode("[A] v1 depoimento"), "A");
  assert.equal(painCode("1303 [B]"), "B");            // código no fim (padrão do Leo)
  assert.equal(painCode("[ab] carrossel"), "AB");     // normaliza maiúscula
  assert.equal(painCode("Vídeo sem código"), null);
  assert.equal(painCode("[TESTE] video novo"), null); // 4+ chars: tag, não código de dor
  assert.equal(painCode("[CODIGOLONGODEMAIS] x"), null);
  assert.equal(painCode(""), null);
});

// fetch fake do fluxo de criativo: descoberta de página, upload, thumbnail
// (1ª chamada vazia → poll), creative e ad. Captura os POSTs pra inspeção.
function makeCreativeFetch() {
  const captured = { posts: {} };
  let thumbCalls = 0;
  const f = async (url, init = {}) => {
    const u = String(url);
    const ok = (body) => ({ status: 200, text: async () => JSON.stringify(body) });
    if (init.method === "POST") {
      if (u.includes("/advideos")) {
        captured.videoBody = init.body; // FormData
        return ok({ id: "v99" });
      }
      const params = Object.fromEntries(new URLSearchParams(String(init.body)));
      if (u.includes("/adcreatives")) { captured.posts.creative = params; return ok({ id: "cr9" }); }
      if (u.includes("/ads")) { captured.posts.ad = params; return ok({ id: "ad9" }); }
      return ok({});
    }
    if (u.includes("/thumbnails")) {
      thumbCalls++;
      return ok(thumbCalls === 1 ? { data: [] } : { data: [{ uri: "https://thumb/x.jpg", is_preferred: true }] });
    }
    if (u.includes("fields=creative")) {
      return ok({ data: [{ creative: {} }, { creative: { object_story_spec: { page_id: "pg1", instagram_user_id: "ig1" } } }] });
    }
    if (u.includes("/adsets")) {
      return ok({ data: [{ id: "s1", name: "Lookalike 1%", status: "ACTIVE", effective_status: "ACTIVE" }] });
    }
    return ok({ data: [] });
  };
  f.captured = captured;
  return f;
}

function multipartPayload(fields, fileContent) {
  const B = "----cockpittest";
  let head = "";
  for (const [k, v] of Object.entries(fields)) {
    head += `--${B}\r\ncontent-disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`;
  }
  head += `--${B}\r\ncontent-disposition: form-data; name="video"; filename="video.mp4"\r\ncontent-type: video/mp4\r\n\r\n`;
  return {
    payload: Buffer.concat([Buffer.from(head), fileContent, Buffer.from(`\r\n--${B}--\r\n`)]),
    headers: { "content-type": `multipart/form-data; boundary=${B}` },
  };
}

async function buildCreativeApp(repo, fetchImpl) {
  const app = Fastify();
  await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024, files: 1 } });
  registerRoutes(app, repo, { meta: makeMeta({ fetch: fetchImpl, accessToken: "t", sleep: async () => {} }) });
  return app;
}

test("criativos: sobe vídeo e cria anúncio PAUSADO com dor no nome, UTMs e aprendizado no produto", async () => {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds", metaAdAccount: "act_123", funnel: [] });
  const graph = makeCreativeFetch();
  const app = await buildCreativeApp(repo, graph);

  const { payload, headers } = multipartPayload({
    adsetId: "s1", name: "v1 depoimento", message: "Copy do anúncio",
    link: "https://leverads.com.br/diagnostico", painCode: "a", painLabel: "Conta banida",
  }, Buffer.from("fake-video-bytes"));
  const res = await app.inject({ method: "POST", url: "/api/marketing/leverads/creatives", payload, headers });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.ok, true);
  assert.equal(body.adId, "ad9");
  assert.equal(body.name, "[A] v1 depoimento"); // convenção garantida no nome
  assert.equal(body.status, "PAUSED");

  // creative: página descoberta dos anúncios atuais, vídeo + thumbnail, UTMs da convenção
  const spec = JSON.parse(graph.captured.posts.creative.object_story_spec);
  assert.equal(spec.page_id, "pg1");
  assert.equal(spec.instagram_user_id, "ig1");
  assert.equal(spec.video_data.video_id, "v99");
  assert.equal(spec.video_data.image_url, "https://thumb/x.jpg");
  assert.equal(spec.video_data.call_to_action.value.link, "https://leverads.com.br/diagnostico");
  assert.equal(graph.captured.posts.creative.url_tags, CREATIVE_URL_TAGS);

  // ad: no conjunto certo e pausado
  assert.equal(graph.captured.posts.ad.adset_id, "s1");
  assert.equal(graph.captured.posts.ad.status, "PAUSED");

  // aprendizado: dor nova no painMap, página persistida, link vira default
  const prod = await repo.get("products", "leverads");
  assert.deepEqual(prod.painMap, { A: "Conta banida" });
  assert.equal(prod.metaPageId, "pg1");
  assert.equal(prod.metaLink, "https://leverads.com.br/diagnostico");

  // defaults pro próximo criativo
  const d = (await app.inject({ url: "/api/marketing/leverads/creative-defaults" })).json();
  assert.equal(d.pageId, "pg1");
  assert.equal(d.link, "https://leverads.com.br/diagnostico");
  assert.deepEqual(d.painMap, { A: "Conta banida" });

  // adsets da campanha (formulário)
  const s = (await app.inject({ url: "/api/marketing/campaigns/c1/adsets" })).json();
  assert.equal(s.adsets[0].id, "s1");
  await app.close();
});

test("criativos: valida campos e exige vídeo", async () => {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds", metaAdAccount: "act_123", funnel: [] });
  const app = await buildCreativeApp(repo, makeCreativeFetch());
  const { payload, headers } = multipartPayload({ adsetId: "s1", name: "x" }, Buffer.from("v")); // sem message/link
  const res = await app.inject({ method: "POST", url: "/api/marketing/leverads/creatives", payload, headers });
  assert.equal(res.statusCode, 400);
  await app.close();
});

function makePainFetch() {
  const page = {
    data: [
      { campaign_id: "c1", campaign_name: "006", adset_id: "s1", adset_name: "LAL", ad_id: "a1", ad_name: "[A] v1", date_start: "2026-06-01", spend: "60", impressions: "1", clicks: "1",
        inline_link_clicks: "2",
        actions: [{ action_type: "video_view", value: "50" }],
        video_p25_watched_actions: [{ action_type: "video_view", value: "40" }],
        video_p50_watched_actions: [{ action_type: "video_view", value: "30" }],
        video_p95_watched_actions: [{ action_type: "video_view", value: "10" }] },
      { campaign_id: "c1", campaign_name: "006", adset_id: "s1", adset_name: "LAL", ad_id: "a2", ad_name: "[B] v1", date_start: "2026-06-01", spend: "40", impressions: "1", clicks: "1", actions: [] },
      { campaign_id: "c1", campaign_name: "006", adset_id: "s1", adset_name: "LAL", ad_id: "a3", ad_name: "[A] v2", date_start: "2026-06-02", spend: "100", impressions: "1", clicks: "1", actions: [] },
      { campaign_id: "c1", campaign_name: "006", adset_id: "s1", adset_name: "LAL", ad_id: "a4", ad_name: "antigo sem código", date_start: "2026-06-02", spend: "10", impressions: "1", clicks: "1", actions: [] },
    ],
  };
  return async () => ({ status: 200, text: async () => JSON.stringify(page) });
}

test("métricas por dor: agrupa [X] do nome do anúncio, rotula pelo painMap e conta ganhos", async () => {
  const repo = makeMemRepo();
  await repo.create("products", {
    id: "leverads", name: "LeverAds", metaAdAccount: "act_123",
    funnel: [{ stage: "Inbox", conv: 1 }, { stage: "Ganho", conv: 1 }],
    painMap: { A: "Conta banida", B: "Múltiplas abas" },
  });
  const app = Fastify();
  registerRoutes(app, repo, { meta: makeMeta({ fetch: makePainFetch(), accessToken: "t" }) });
  await app.inject({ method: "POST", url: "/api/marketing/sync", payload: { since: "2026-06-01", until: "2026-06-02" } });

  const now = "2026-06-02T10:00:00.000Z";
  // UTM completo como nos leads reais (campaign/term/content dinâmicos da Meta).
  const mk = (id, content, stage, extra = {}) => repo.create("leads", { id, saas: "leverads", stage, createdAt: now, utm: { campaign: "c1", term: "s1", content }, ...extra });
  await mk("l1", "a1", "Ganho", { amount: 600 }); // valor pedido pelo modal de fechamento
  await mk("l2", "a1", "Inbox");
  await mk("l3", "a3", "Inbox");

  const m = (await app.inject({ url: "/api/marketing/leverads?since=2026-06-01&until=2026-06-02" })).json();
  const A = m.pains.find((p) => p.code === "A");
  assert.equal(A.label, "Conta banida");
  assert.equal(A.adsCount, 2);
  assert.equal(A.spend, 160);           // 60 + 100
  assert.equal(A.leads, 3);
  assert.equal(A.cpl, 53.33);
  assert.equal(A.won, 1);               // l1 em Ganho
  assert.equal(A.costPerWin, 160);
  assert.equal(A.revenue, 600);         // amount do l1
  assert.equal(A.roas, 3.75);           // 600 / 160
  const B = m.pains.find((p) => p.code === "B");
  assert.equal(B.label, "Múltiplas abas");
  assert.equal(B.leads, 0);
  assert.equal(B.cpl, null);
  assert.equal(B.revenue, 0);
  assert.equal(B.roas, null);           // sem receita não inventa ROAS
  const sem = m.pains.find((p) => p.code === null);
  assert.equal(sem.label, "Sem código");
  assert.equal(sem.spend, 10);

  // métricas de decisão por nó (tabela unificada): ganhos, custo por ganho, CTR,
  // CPM, custo por clique no link e funil de vídeo (3s + 25/50/95%)
  const a1 = m.ads.find((a) => a.id === "a1");
  assert.equal(a1.won, 1);
  assert.equal(a1.costPerWin, 60);
  assert.equal(a1.revenue, 600);
  assert.equal(a1.roas, 10); // 600 / 60
  assert.equal(a1.ctr, 200); // link CTR: 2 cliques no link / 1 impressão
  assert.equal(a1.cpm, 60000); // 60 / 1 impressão × 1000
  assert.equal(a1.costPerLinkClick, 30); // 60 / 2 cliques no link
  assert.equal(a1.video3s, 50);
  assert.equal(a1.videoP25, 40);
  assert.equal(a1.videoP50, 30);
  assert.equal(a1.videoP95, 10);
  const c1 = m.campaigns.find((c) => c.id === "c1");
  assert.equal(c1.won, 1);
  assert.equal(c1.costPerWin, 210); // spend total 210 / 1 ganho
  assert.equal(c1.revenue, 600);
  assert.equal(c1.roas, 2.86); // 600 / 210

  // Totais do período: ganhos, receita e ROAS geral (todos os leads, não só os
  // atribuídos por UTM).
  assert.equal(m.totals.won, 1);
  assert.equal(m.totals.costPerWin, 210);
  assert.equal(m.totals.revenue, 600);
  assert.equal(m.totals.roas, 2.86);
  await app.close();
});

// ── Gerenciamento por nível (campanha/conjunto/anúncio) ─────────────────────

function makeManageFetch() {
  const captured = { posts: [] };
  const f = async (url, init = {}) => {
    const u = String(url);
    const ok = (body) => ({ status: 200, text: async () => JSON.stringify(body) });
    if (init.method === "POST") {
      captured.posts.push({ url: u, params: Object.fromEntries(new URLSearchParams(String(init.body))) });
      return ok({ success: true });
    }
    if (u.includes("/adsets")) {
      return ok({ data: [
        { id: "s1", name: "LAL 1%", status: "ACTIVE", effective_status: "ACTIVE", daily_budget: "10500" },
        { id: "s2", name: "Interesse", status: "PAUSED", effective_status: "PAUSED" },
      ] });
    }
    if (u.includes("/ads?")) {
      return ok({ data: [{ id: "a1", name: "[A] v1", status: "ACTIVE", effective_status: "ACTIVE" }] });
    }
    return ok({ data: [] });
  };
  f.captured = captured;
  return f;
}

test("gerenciamento: adsets com orçamento em reais, ads do conjunto e status/orçamento genéricos por nó", async () => {
  const repo = makeMemRepo();
  const graph = makeManageFetch();
  const app = Fastify();
  registerRoutes(app, repo, { meta: makeMeta({ fetch: graph, accessToken: "t" }) });

  const sets = (await app.inject({ url: "/api/marketing/campaigns/c1/adsets" })).json().adsets;
  assert.equal(sets[0].dailyBudget, 105);       // centavos → reais
  assert.equal(sets[1].dailyBudget, null);      // CBO: orçamento na campanha

  const ads = (await app.inject({ url: "/api/marketing/adsets/s1/ads" })).json().ads;
  assert.deepEqual(ads[0], { id: "a1", name: "[A] v1", status: "ACTIVE", effectiveStatus: "ACTIVE" });

  // status genérico: mesmo POST serve conjunto e anúncio; campanha segue na rota antiga
  const r1 = (await app.inject({ method: "POST", url: "/api/marketing/objects/a1/status", payload: { status: "PAUSED" } })).json();
  assert.deepEqual(r1, { ok: true, id: "a1", status: "PAUSED" });
  const r2 = (await app.inject({ method: "POST", url: "/api/marketing/campaigns/c1/status", payload: { status: "ACTIVE" } })).json();
  assert.equal(r2.ok, true);
  assert.equal((await app.inject({ method: "POST", url: "/api/marketing/objects/a1/status", payload: { status: "ARCHIVED" } })).statusCode, 400);

  // orçamento genérico (conjunto ABO) em reais → centavos
  const r3 = (await app.inject({ method: "POST", url: "/api/marketing/objects/s1/budget", payload: { dailyBudget: 150 } })).json();
  assert.deepEqual(r3, { ok: true, id: "s1", dailyBudget: 150 });
  const budgetPost = graph.captured.posts.find((p) => p.url.endsWith("/s1"));
  assert.equal(budgetPost.params.daily_budget, "15000");

  await app.close();
});

// ── Auto-sync no servidor + catálogo com anúncios vivos ─────────────────────

const { startMarketingAutoSync } = await import("../src/routes.marketing.js");

test("auto-sync do servidor: tick sincroniza, expõe syncedAt e não regrava linha idêntica", async () => {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds", metaAdAccount: "act_123", funnel: [] });
  const metaClient = makeMeta({ fetch: makeAdLevelFetch(), accessToken: "t" });
  const auto = startMarketingAutoSync(repo, { meta: metaClient, intervalMs: 3_600_000, log: { warn: () => {} }, immediate: false });
  auto.stop();

  await auto.tick();
  assert.equal((await repo.list("ad_insights")).length, 3);

  // segunda leva com os MESMOS dados: nenhum update (linha igual não vira evento SSE)
  let updates = 0;
  const origUpdate = repo.update.bind(repo);
  repo.update = (c, id, patch) => { if (c === "ad_insights") updates++; return origUpdate(c, id, patch); };
  await auto.tick();
  assert.equal(updates, 0);
  assert.equal((await repo.list("ad_insights")).length, 3);
  repo.update = origUpdate;

  // o "ao vivo" da tela lê o syncedAt carimbado pelo auto-sync
  const app = Fastify();
  registerRoutes(app, repo, { meta: metaClient });
  const m = (await app.inject({ url: "/api/marketing/leverads?since=2026-06-01&until=2026-06-02" })).json();
  assert.ok(m.syncedAt, "syncedAt presente após auto-sync");
  await app.close();
});

test("attribution: mescla anúncios VIVOS da conta sem sobrescrever o insight", async () => {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds", metaAdAccount: "act_123", funnel: [] });
  await repo.create("ad_insights", { id: "x1", saas: "leverads", campaignId: "c1", campaignName: "006", adsetId: "s1", adsetName: "LAL", adId: "a1", adName: "[A] v1", date: "2026-07-01", spend: 1, impressions: 1, clicks: 1, metaLeads: 0 });
  const f = async (url) => {
    const u = String(url);
    if (u.includes("/ads?")) {
      return { status: 200, text: async () => JSON.stringify({ data: [
        { id: "aNEW", name: "[C] recém-criado", adset_id: "s9", campaign_id: "c9" },
        { id: "a1", name: "nome vivo NÃO sobrescreve", adset_id: "s1", campaign_id: "c1" },
      ] }) };
    }
    return { status: 200, text: async () => JSON.stringify({ data: [] }) };
  };
  const app = Fastify();
  registerRoutes(app, repo, { meta: makeMeta({ fetch: f, accessToken: "t" }) });
  const cat = (await app.inject({ url: "/api/marketing/leverads/attribution" })).json();
  assert.equal(cat.ads.aNEW.name, "[C] recém-criado"); // anúncio novo resolve antes do 1º sync
  assert.equal(cat.ads.a1.name, "[A] v1");             // insight tem precedência
  await app.close();
});

test("adobjects: três níveis vivos, arquivados fora, falha parcial não derruba o resto", async () => {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds", metaAdAccount: "act_123", funnel: [] });
  const f = async (url) => {
    const u = String(url);
    const ok = (body) => ({ status: 200, text: async () => JSON.stringify(body) });
    if (u.includes("/campaigns?")) return ok({ data: [{ id: "c1", name: "006", status: "ACTIVE", effective_status: "ACTIVE", objective: "OUTCOME_LEADS", daily_budget: "10500" }] });
    if (u.includes("/adsets?")) return ok({ data: [
      { id: "s1", name: "LAL", status: "ACTIVE", effective_status: "ACTIVE", daily_budget: "20000", campaign_id: "c1" },
      { id: "s2", name: "Velho", status: "ARCHIVED", effective_status: "ARCHIVED", campaign_id: "c1" },
    ] });
    if (u.includes("/ads?")) return ok({ data: [{ id: "a1", name: "[A] v1", adset_id: "s1", campaign_id: "c1", status: "PAUSED", effective_status: "PAUSED" }] });
    return ok({ data: [] });
  };
  const app = Fastify();
  registerRoutes(app, repo, { meta: makeMeta({ fetch: f, accessToken: "t" }) });
  const r = (await app.inject({ url: "/api/marketing/leverads/adobjects" })).json();
  assert.equal(r.campaigns[0].dailyBudget, 105);
  assert.deepEqual(r.adsets.map((s) => s.id), ["s1"]); // ARCHIVED fica de fora
  assert.equal(r.adsets[0].dailyBudget, 200);
  assert.equal(r.ads[0].status, "PAUSED");             // toggle da visão por nível lê daqui
  assert.equal(r.errors, undefined);
  await app.close();

  // guards: sem token → 503; sem conta → 400
  const off = Fastify();
  registerRoutes(off, repo, { meta: makeMeta({}) });
  assert.equal((await off.inject({ url: "/api/marketing/leverads/adobjects" })).statusCode, 503);
  await off.close();
  const repo2 = makeMemRepo();
  await repo2.create("products", { id: "p1", name: "P1" });
  const app2 = Fastify();
  registerRoutes(app2, repo2, { meta: makeMeta({ fetch: f, accessToken: "t" }) });
  assert.equal((await app2.inject({ url: "/api/marketing/p1/adobjects" })).statusCode, 400);
  await app2.close();

  // falha parcial: ads quebra → 200 com campaigns/adsets + errors.ads
  const fPartial = async (url) => {
    const u = String(url);
    if (u.includes("/ads?")) return { status: 500, text: async () => JSON.stringify({ error: { message: "rate limit" } }) };
    return f(url);
  };
  const app3 = Fastify();
  registerRoutes(app3, repo, { meta: makeMeta({ fetch: fPartial, accessToken: "t" }) });
  const r3raw = await app3.inject({ url: "/api/marketing/leverads/adobjects" });
  assert.equal(r3raw.statusCode, 200);
  const r3 = r3raw.json();
  assert.equal(r3.campaigns.length, 1);
  assert.deepEqual(r3.ads, []);
  assert.ok(r3.errors.ads.includes("rate limit"));
  await app3.close();
});
