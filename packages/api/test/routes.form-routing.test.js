import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";
import { registerRoutes } from "../src/routes.js";
import { FORM_IDS, FORMS_V2 } from "../src/forms-v2.leverads.js";
import { painCode, attributionPain } from "../src/attribution.js";
import { makeMeta } from "../src/meta.js";

const OLD = "fo_diagnostico_leverads";
const CFG = {
  id: "form_ab", enabled: true, pct: 100, onlyForms: [OLD],
  byPain: { OEM: FORM_IDS.oem, ADS: FORM_IDS.ads, PRICE: FORM_IDS.price },
  fallback: FORM_IDS.ads,
};
const inline = (res) => JSON.parse(res.body.match(/window\.__FORM__ = (.*?); window\.__EMBED__/)[1]);

async function fixture(t, meta = { configured: () => false }) {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", metaPixelId: "123456789012345", funnel: [{ stage: "Novo lead", kind: "novo" }] });
  await repo.create("app_config", CFG);
  for (const form of FORMS_V2) await repo.create("forms", { ...form, status: "published" });
  await repo.create("forms", { ...FORMS_V2[0], id: OLD, name: "Controle", formProduct: undefined, status: "published" });
  const app = Fastify();
  registerRoutes(app, repo, { meta, discord: { configured: () => false }, metaCapi: { configured: () => false } });
  t.after(() => app.close());
  return { app, repo };
}

test("etiquetas de produto: PRICE é válido; tags operacionais continuam fora", () => {
  for (const tag of ["OEM", "ADS", "PRICE"]) assert.equal(painCode(`1436 [${tag.toLowerCase()}]`), tag);
  assert.equal(painCode("[TESTE] 1436 [PRICE]"), "PRICE");
  assert.equal(painCode("[TESTE] [REMARKETING]"), null);
  assert.equal(attributionPain({ adName: "[PRICE]", adsetName: "[OEM]", campaignName: "[ADS]" }), "PRICE");
  assert.equal(attributionPain({ adName: "Sem etiqueta", campaignName: "[PRICE]" }), "PRICE");
});

test("100% do controle vai para novos forms por etiqueta, mesmo sem cookie/fbclid", async (t) => {
  const { app, repo } = await fixture(t);
  for (const [i, code] of ["OEM", "ADS", "PRICE"].entries()) {
    await repo.create("ad_insights", { id: `insight-${i}`, saas: "leverads", adId: `1234${i}`, adName: `[${code}]`, date: "2026-09-16" });
    const res = await app.inject(`/f/${OLD}?utm_source=meta&utm_content=1234${i}&utm_campaign=campaign&ref=customer`);
    assert.equal(res.statusCode, 200);
    assert.equal(inline(res).id, FORM_IDS[code.toLowerCase()]);
    assert.match(res.body, /window\.__PAIN__ = "(?:OEM|ADS|PRICE)"/);
    assert.ok(res.body.includes("fbq('init', '123456789012345')"), "preserva o pixel do produto");
    assert.equal(res.headers.location, undefined, "renderiza na URL original, preservando UTMs e indicação");
  }
  assert.equal(inline(await app.inject(`/f/${OLD}`)).id, FORM_IDS.ads);
  assert.equal((await repo.list("leads")).length, 0);
});

test("anúncio ausente dos insights resolve o nome vivo e compartilha consulta entre visitas", async (t) => {
  let reads = 0;
  const { app, repo } = await fixture(t, {
    configured: () => true,
    adAttribution: async (id) => { reads++; assert.equal(id, "120248742384850377"); return { adName: "1395 [OEM]", campaignName: "[ADS]" }; },
  });
  const responses = await Promise.all(Array.from({ length: 5 }, () => app.inject(`/f/${OLD}?utm_content=120248742384850377`)));
  assert.ok(responses.every((r) => inline(r).id === FORM_IDS.oem));
  assert.equal(reads, 1);
  assert.equal((await repo.list("ad_insights")).length, 0, "lookup não inventa métricas para alimentar roteamento");
});

test("sem etiqueta no insight consulta a origem viva; com etiqueta usa o sync mais recente", async (t) => {
  let reads = 0;
  const { app, repo } = await fixture(t, { configured: () => true, adAttribution: async () => { reads++; return { campaignName: "[PRICE]" }; } });
  await repo.create("ad_insights", { id: "unknown", saas: "leverads", adId: "12345", adName: "Sem código", date: "2026-09-16" });
  assert.equal(inline(await app.inject(`/f/${OLD}?utm_content=12345`)).id, FORM_IDS.price);
  for (const [date, code] of [["2026-09-15", "OEM"], ["2026-09-16", "ADS"]]) {
    await repo.create("ad_insights", { id: date, saas: "leverads", adId: "12346", adName: `[${code}]`, date });
  }
  assert.equal(inline(await app.inject(`/f/${OLD}?utm_content=12346`)).id, FORM_IDS.ads);
  assert.equal(reads, 1);
});

test("falha na Meta mantém formulário utilizável e tem cache; UTM inválida não chama Graph", async (t) => {
  let reads = 0;
  const { app } = await fixture(t, { configured: () => true, adAttribution: async () => { reads++; throw new Error("Meta indisponível"); } });
  for (const query of ["12345", "12345", "{{ad.id}}", "invalid-id"]) {
    const res = await app.inject(`/f/${OLD}?utm_content=${encodeURIComponent(query)}`);
    assert.equal(res.statusCode, 200);
    assert.equal(inline(res).id, FORM_IDS.ads);
  }
  assert.equal(reads, 1);
});

test("links novos respeitam anúncio conhecido e acessos diretos preservam a linha", async (t) => {
  const { app, repo } = await fixture(t);
  await repo.create("ad_insights", { id: "oem", saas: "leverads", adId: "12345", adName: "[OEM]" });
  assert.equal(inline(await app.inject(`/f/${FORM_IDS.ads}?utm_content=12345`)).id, FORM_IDS.oem);
  for (const id of Object.values(FORM_IDS)) assert.equal(inline(await app.inject(`/f/${id}`)).id, id);
});

test("roteamento não serve rascunho nem formulário de outro produto", async (t) => {
  const { app, repo } = await fixture(t);
  await repo.create("ad_insights", { id: "oem", saas: "leverads", adId: "12345", adName: "[OEM]" });
  for (const patch of [{ status: "draft" }, { status: "published", saas: "uniquekids" }]) {
    await repo.update("forms", FORM_IDS.oem, patch);
    assert.equal(inline(await app.inject(`/f/${OLD}?utm_content=12345`)).id, OLD);
  }
});

test("envio preserva linha do form, classificação, atribuição e telemetria no destino servido", async (t) => {
  const { app, repo } = await fixture(t);
  for (const [i, line] of ["oem", "ads", "price"].entries()) {
    const form = FORM_IDS[line];
    const res = await app.inject({ method: "POST", url: `/public/forms/${form}/submissions`, payload: {
      answers: { niche: "autopecas", ...(line === "oem" ? { channel: "online" } : {}), accounts: "2-3", listings: "1000-5000", trigger: "Preciso aumentar as vendas", orders: "500-1000", ticket: "150-300", nome: "Rafael", whatsapp: `4199999000${i}`, email: `${line}@example.com` },
      utm: { source: "meta", content: `1234${i}` }, pain: line.toUpperCase(),
      sourceUrl: `https://levermoney.com.br/f/${OLD}?utm_content=1234${i}`,
    } });
    assert.equal(res.statusCode, 201, res.body);
    const [lead] = (await repo.list("leads")).filter((l) => l.form === form);
    assert.equal(lead.formProduct, line);
    assert.equal(lead.classificacao.primario, line);
    assert.equal(lead.utm.content, `1234${i}`);
    assert.equal(lead.sourcePain, line.toUpperCase());
    const event = await app.inject({ method: "POST", url: `/public/forms/${form}/events`, payload: { session: `session-${line}`, event: "view", utm: { content: `1234${i}` } } });
    assert.equal(event.statusCode, 201);
  }
  assert.deepEqual((await repo.list("form_submissions")).map((s) => s.form).sort(), Object.values(FORM_IDS).sort());
  assert.ok((await repo.list("form_events")).every((e) => e.form !== OLD));
});

test("client Meta: atribuição lê nomes dos três níveis com timeout, sem backoff de jobs", async () => {
  let reads = 0;
  const meta = makeMeta({ accessToken: "fake", fetch: async (url, options) => {
    reads++;
    assert.equal(new URL(url).searchParams.get("fields"), "id,name,adset{id,name},campaign{id,name}");
    assert.ok(options.signal);
    return { status: 200, text: async () => JSON.stringify({ id: "12345", name: "[OEM]", adset: { id: "set", name: "[ADS]" }, campaign: { id: "campaign", name: "[PRICE]" } }) };
  } });
  assert.deepEqual(await meta.adAttribution("12345"), { adId: "12345", adName: "[OEM]", adsetId: "set", adsetName: "[ADS]", campaignId: "campaign", campaignName: "[PRICE]" });
  await assert.rejects(() => meta.adAttribution("invalid"), /inválido/);
  assert.equal(reads, 1);
  let failedReads = 0;
  const limited = makeMeta({ accessToken: "fake", sleep: async () => assert.fail("página não pode esperar retentativa"), fetch: async () => {
    failedReads++;
    return { status: 429, text: async () => JSON.stringify({ error: { code: 4, message: "rate limited" } }) };
  } });
  await assert.rejects(() => limited.adAttribution("12345"), /rate limited/);
  assert.equal(failedReads, 1);
});
