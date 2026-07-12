// UTM: captura no envio do form público (sanitizada, vai pro lead e pra
// submission) e atribuição por campanha em GET /api/marketing/:saas.

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";

const { registerRoutes } = await import("../src/routes.js");

const FORM = {
  id: "fo_utm",
  name: "Diagnóstico",
  saas: "leverads",
  status: "published",
  questions: [{ key: "nome", label: "Nome?", type: "text", required: true }],
  mapping: { name: "nome" },
  thanks: {},
};

async function buildApp() {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds", funnel: [{ stage: "Inbox", conv: 1 }] });
  await repo.create("forms", { ...FORM });
  const app = Fastify();
  registerRoutes(app, repo);
  return { app, repo };
}

test("submissão com utm grava sanitizado no lead e na submission", async () => {
  const { app, repo } = await buildApp();
  const res = await app.inject({
    method: "POST", url: "/public/forms/fo_utm/submissions",
    payload: {
      answers: { nome: "Ana" },
      utm: {
        source: "news", medium: "cpc", campaign: "Lookalike compradores",
        fbclid: "abc123",
        hack: "descartar", nested: { x: 1 }, term: 42, // inválidos: chave desconhecida e tipos errados
      },
    },
  });
  assert.equal(res.statusCode, 201);
  const lead = (await repo.list("leads"))[0];
  assert.deepEqual(lead.utm, { source: "news", medium: "cpc", campaign: "Lookalike compradores", fbclid: "abc123" });
  const sub = (await repo.list("form_submissions"))[0];
  assert.deepEqual(sub.utm, lead.utm);

  // sem utm no body → campo nem existe
  await app.inject({ method: "POST", url: "/public/forms/fo_utm/submissions", payload: { answers: { nome: "Bia" } } });
  const clean = (await repo.list("leads")).find((l) => l.name === "Bia");
  assert.equal(clean.utm, undefined);
  await app.close();
});

test("GET /api/marketing/:saas atribui leads e CPL real por utm_campaign (nome ou id)", async () => {
  const { app, repo } = await buildApp();
  // mesmo recorte de dia da rota: fuso do negócio (UTC-3), não UTC
  const today = new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
  await repo.create("ad_insights", { id: "a1", saas: "leverads", campaignId: "c_1", campaignName: "Lookalike", date: today, spend: 300, impressions: 1000, clicks: 50, metaLeads: 9 });
  await repo.create("ad_insights", { id: "a2", saas: "leverads", campaignId: "c_2", campaignName: "Remarketing", date: today, spend: 100, impressions: 500, clicks: 20, metaLeads: 4 });
  const now = new Date().toISOString();
  // 2 leads pela campanha "Lookalike" (por nome), 1 pela "c_2" (por id), 1 sem utm
  await repo.create("leads", { id: "l1", saas: "leverads", name: "A", stage: "Inbox", createdAt: now, utm: { campaign: "Lookalike" } });
  await repo.create("leads", { id: "l2", saas: "leverads", name: "B", stage: "Inbox", createdAt: now, utm: { campaign: "Lookalike" } });
  await repo.create("leads", { id: "l3", saas: "leverads", name: "C", stage: "Inbox", createdAt: now, utm: { campaign: "c_2" } });
  await repo.create("leads", { id: "l4", saas: "leverads", name: "D", stage: "Inbox", createdAt: now });

  const res = await app.inject({ method: "GET", url: "/api/marketing/leverads" });
  assert.equal(res.statusCode, 200);
  const byName = Object.fromEntries(res.json().campaigns.map((c) => [c.name, c]));
  assert.equal(byName["Lookalike"].leads, 2);
  assert.equal(byName["Lookalike"].cpl, 150);      // 300 / 2
  assert.equal(byName["Remarketing"].leads, 1);    // casado pelo id c_2
  assert.equal(byName["Remarketing"].cpl, 100);
  await app.close();
});

test("utm term/content (conjunto/anúncio) persistem sanitizados no lead", async () => {
  const { app, repo } = await buildApp();
  const res = await app.inject({
    method: "POST", url: "/public/forms/fo_utm/submissions",
    payload: {
      answers: { nome: "Cadu" },
      utm: { source: "meta", medium: "paid", campaign: "c_9", term: "s_9", content: "a_9" },
    },
  });
  assert.equal(res.statusCode, 201);
  const lead = (await repo.list("leads")).find((l) => l.name === "Cadu");
  assert.deepEqual(lead.utm, { source: "meta", medium: "paid", campaign: "c_9", term: "s_9", content: "a_9" });
  await app.close();
});

test("click-ids/referrer sanitizados + fbp/fbc/sourceUrl persistem no lead; fbc deriva do fbclid", async () => {
  const { app, repo } = await buildApp();
  await app.inject({
    method: "POST", url: "/public/forms/fo_utm/submissions",
    payload: {
      answers: { nome: "Ana" },
      utm: { source: "google", gclid: "g123", ttclid: "t456", referrer: "https://instagram.com/leverads" },
      fbp: "fb.1.111.222",
      sourceUrl: "https://levermoney.com.br/f/fo_utm?gclid=g123",
    },
  });
  const ana = (await repo.list("leads")).find((l) => l.name === "Ana");
  assert.deepEqual(ana.utm, { source: "google", gclid: "g123", ttclid: "t456", referrer: "https://instagram.com/leverads" });
  assert.equal(ana.fbp, "fb.1.111.222");
  assert.equal(ana.sourceUrl, "https://levermoney.com.br/f/fo_utm?gclid=g123");
  assert.equal(ana.fbc, undefined); // sem cookie e sem fbclid não inventa fbc

  // fbclid sem cookie _fbc (Pixel bloqueado) → fbc derivado no formato oficial
  await app.inject({
    method: "POST", url: "/public/forms/fo_utm/submissions",
    payload: { answers: { nome: "Bia" }, utm: { fbclid: "abc" } },
  });
  const bia = (await repo.list("leads")).find((l) => l.name === "Bia");
  assert.match(bia.fbc, /^fb\.1\.\d+\.abc$/);

  // cookie _fbc presente vence a derivação
  await app.inject({
    method: "POST", url: "/public/forms/fo_utm/submissions",
    payload: { answers: { nome: "Céu" }, utm: { fbclid: "abc" }, fbc: "fb.1.999.abc" },
  });
  const ceu = (await repo.list("leads")).find((l) => l.name === "Céu");
  assert.equal(ceu.fbc, "fb.1.999.abc");
  await app.close();
});

test("lead sem UTM mas com referrer ganha source derivado", async () => {
  const { app, repo } = await buildApp();
  await app.inject({
    method: "POST", url: "/public/forms/fo_utm/submissions",
    payload: { answers: { nome: "Gio" }, utm: { referrer: "https://www.google.com/" } },
  });
  const gio = (await repo.list("leads")).find((l) => l.name === "Gio");
  assert.equal(gio.utm.source, "google");
  assert.equal(gio.utm.referrer, "https://www.google.com/"); // o cru continua pra auditoria

  // UTM explícita vence: referrer não sobrescreve source de anúncio
  await app.inject({
    method: "POST", url: "/public/forms/fo_utm/submissions",
    payload: { answers: { nome: "Hua" }, utm: { source: "meta", referrer: "https://l.instagram.com/" } },
  });
  const hua = (await repo.list("leads")).find((l) => l.name === "Hua");
  assert.equal(hua.utm.source, "meta");
  await app.close();
});

test("source fb/ig/an/msg normaliza pra meta + placement (duas grafias, uma origem)", async () => {
  const { app, repo } = await buildApp();
  await app.inject({
    method: "POST", url: "/public/forms/fo_utm/submissions",
    payload: { answers: { nome: "Ivo" }, utm: { source: "an", medium: "paid", campaign: "c9", content: "a9" } },
  });
  const ivo = (await repo.list("leads")).find((l) => l.name === "Ivo");
  assert.equal(ivo.utm.source, "meta");
  assert.equal(ivo.utm.placement, "an");
  assert.equal(ivo.utm.campaign, "c9"); // atribuição por campanha/anúncio intacta

  // convenção nova do cockpit: utm_placement explícito passa direto
  await app.inject({
    method: "POST", url: "/public/forms/fo_utm/submissions",
    payload: { answers: { nome: "Jo" }, utm: { source: "meta", placement: "ig", campaign: "c9" } },
  });
  const jo = (await repo.list("leads")).find((l) => l.name === "Jo");
  assert.equal(jo.utm.source, "meta");
  assert.equal(jo.utm.placement, "ig");
  await app.close();
});
