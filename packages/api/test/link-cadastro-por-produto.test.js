// Link de cadastro por produto do negócio (28/10/2026):
//   · o convite é um só por cliente; a URL muda por produto (LeverAds em
//     /signup, LeverPrice em /cadastro) e a ficha mostra um botão por produto;
//   · o cadastro do LeverPrice avisa (POST /public/leverprice/org-created) e o
//     cockpit grava `leverpriceOrgId` pelo convite ou pelo e-mail 1 × 1.

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";
import { dealProductsOf, productOfCode, signupProductsOf } from "../src/shared/signup-products.js";
import { ensureSignupInvite, leverpriceSignupUrl, signupLinksOf } from "../src/customers/leverads-orgs.js";
import { handleLeverpriceOrgCreated, leverpriceServiceKeyOk, planLeverpriceLink } from "../src/customers/leverprice-orgs.js";
import { registerLeveradsOrgRoutes } from "../src/customers/routes.leverads-orgs.js";
import { registerLeverpriceOrgRoutes } from "../src/customers/routes.leverprice-orgs.js";

const ORG = "c0000000-0000-4000-8000-000000000001";
const CORE = "d0000000-0000-4000-8000-000000000002";
const TOKEN = "cvt_abcdefghijklmnop";
const KEY = "chave-do-leverprice";

// ── Produtos do negócio ─────────────────────────────────────────────────────

test("productOfCode: prefixo price_ é LeverPrice, men_ é Mentoria, linhas e legados são LeverAds", () => {
  assert.equal(productOfCode("price_escala"), "leverprice");
  assert.equal(productOfCode("men_curso"), "mentoria");
  assert.equal(productOfCode("ads_essencial"), "leverads");
  assert.equal(productOfCode("oem_pack"), "leverads");
  assert.equal(productOfCode("fulloem"), "leverads");
  assert.equal(productOfCode("Projeto sob medida"), "", "Personalizado não diz o produto");
  assert.equal(productOfCode("plano_novo", [{ code: "plano_novo", product: "leverprice" }]), "leverprice", "o catálogo manda");
});

test("signupProductsOf: só LeverAds, só LeverPrice, pacote, Mentoria e sem dado", () => {
  assert.deepEqual(signupProductsOf({ customer: { planCode: "ads_escala" } }), ["leverads"]);
  assert.deepEqual(signupProductsOf({ customer: { planSnapshot: { product: "leverprice" } } }), ["leverprice"]);
  assert.deepEqual(signupProductsOf({ customer: {}, lead: { dealProduct: "price_essencial" } }), ["leverprice"]);
  // Pacote: o retrato do cliente guarda só o 1º item; os itens do negócio completam.
  assert.deepEqual(signupProductsOf({
    customer: { planSnapshot: { product: "leverads" }, planCode: "ads_escala" },
    lead: { dealProduct: "ads_escala", dealItems: [{ product: "ads_escala" }, { product: "price_escala" }] },
  }), ["leverads", "leverprice"]);
  assert.deepEqual(signupProductsOf({ customer: { products: ["leverprice", "leverads"] } }), ["leverads", "leverprice"]);
  // `products` (das assinaturas) manda sobre o resto.
  assert.deepEqual(signupProductsOf({ customer: { products: ["leverprice"], planCode: "ads_escala" } }), ["leverprice"]);
  assert.deepEqual(signupProductsOf({ customer: { planCode: "men_curso" } }), [], "Mentoria não tem página de cadastro");
  assert.deepEqual(signupProductsOf({ customer: {} }), ["leverads"], "sem dado: o link de sempre");
  assert.deepEqual(signupProductsOf({ customer: { planCustom: "x", dealProduct: "Projeto" } }), ["leverads"]);
  assert.deepEqual(dealProductsOf({ customer: { products: ["mentoria", "leverads"] } }), ["mentoria", "leverads"]);
});

// ── Links da rota ───────────────────────────────────────────────────────────

test("leverpriceSignupUrl: LEVERPRICE_APP_URL/cadastro?convite=, padrão leverprice.com.br", () => {
  assert.equal(leverpriceSignupUrl("cvt_x", {}), "https://leverprice.com.br/cadastro?convite=cvt_x");
  assert.equal(leverpriceSignupUrl("cvt_x", { LEVERPRICE_APP_URL: "http://localhost:5174//" }), "http://localhost:5174/cadastro?convite=cvt_x");
  assert.deepEqual(signupLinksOf("cvt_x", ["leverads", "leverprice", "mentoria"], {}), [
    { product: "leverads", label: "LeverAds", url: "https://leverads.com.br/signup?convite=cvt_x" },
    { product: "leverprice", label: "LeverPrice", url: "https://leverprice.com.br/cadastro?convite=cvt_x" },
  ]);
});

function inviteApp(repo) {
  const app = Fastify();
  registerLeveradsOrgRoutes(app, repo, { mirror: { configured: () => true, last: () => null, run: async () => ({}) } });
  return app;
}

test("POST /api/customers/:id/signup-invite: um link por produto do negócio, o mesmo convite, `url` = o primeiro", async () => {
  const repo = makeMemRepo();
  const lead = await repo.create("leads", { name: "Ana", saas: "leverads", dealProduct: "ads_escala",
    dealItems: [{ product: "ads_escala" }, { product: "price_escala" }] });
  const pacote = await repo.create("customers", { name: "Pacote", saas: "leverads", leadId: lead.id, planCode: "ads_escala" });
  const price = await repo.create("customers", { name: "Só Price", saas: "leverads", planCode: "price_essencial" });
  const ads = await repo.create("customers", { name: "Só Ads", saas: "leverads" });
  const app = inviteApp(repo);
  const post = (id, route = "signup-invite") => app.inject({ method: "POST", url: `/api/customers/${id}/${route}`, payload: {} });

  const a = (await post(pacote.id)).json();
  assert.deepEqual(a.links.map((l) => l.product), ["leverads", "leverprice"]);
  assert.equal(a.links[0].url, `https://leverads.com.br/signup?convite=${a.token}`);
  assert.equal(a.links[1].url, `https://leverprice.com.br/cadastro?convite=${a.token}`);
  assert.equal(a.url, a.links[0].url);

  const p = (await post(price.id)).json();
  assert.deepEqual(p.links.map((l) => [l.product, l.label]), [["leverprice", "LeverPrice"]]);
  assert.match(p.url, /\/cadastro\?convite=cvt_/);

  // A rota antiga segue igual para quem só tem LeverAds.
  const old = await post(ads.id, "leverads-invite");
  assert.equal(old.statusCode, 200);
  assert.match(old.json().url, /leverads\.com\.br\/signup\?convite=cvt_/);
  assert.deepEqual(old.json().links.map((l) => l.product), ["leverads"]);
  assert.equal((await post("nao-existe")).statusCode, 404);
});

test("ensureSignupInvite: o produto pelo plano do catálogo, quando o código não tem prefixo", async () => {
  const repo = makeMemRepo();
  await repo.create("plans", { id: "plan_leverads_lp_sob_medida", v: 2, saas: "leverads", code: "lp_sob_medida", product: "leverprice" });
  const c = await repo.create("customers", { name: "Cliente", saas: "leverads", planCode: "lp_sob_medida" });
  const res = await ensureSignupInvite(repo, c, { env: { LEVERPRICE_APP_URL: "https://lp.test" } });
  assert.deepEqual(res.links, [{ product: "leverprice", label: "LeverPrice", url: `https://lp.test/cadastro?convite=${res.token}` }]);
});

// ── Vínculo do LeverPrice pelo aviso ────────────────────────────────────────

const precoCliente = (extra = {}) => ({ name: "Loja", saas: "leverads", email: "dono@loja.test", planCode: "price_escala", ...extra });

test("planLeverpriceLink: convite casa 1 × 1; convite de cliente já vinculado não cai no e-mail", () => {
  const customers = [
    { id: "c1", ...precoCliente({ signupInvite: { token: TOKEN }, email: "outro@x.test" }) },
    { id: "c2", ...precoCliente() },
  ];
  assert.deepEqual(planLeverpriceLink({ orgId: ORG, invite: TOKEN, email: "dono@loja.test", customers }), { customerId: "c1", via: "convite" });
  customers[0].leverpriceOrgId = "e0000000-0000-4000-8000-000000000009";
  assert.equal(planLeverpriceLink({ orgId: ORG, invite: TOKEN, email: "dono@loja.test", customers }).reason, "customer_linked");
  customers[0].leverpriceOrgId = "";
  customers[0].leverpriceOrgLinkRejected = [ORG];
  assert.equal(planLeverpriceLink({ orgId: ORG, invite: TOKEN, customers }).reason, "rejected");
  // Convite que ninguém tem (trocado): tenta o e-mail.
  assert.deepEqual(planLeverpriceLink({ orgId: ORG, invite: "cvt_velho_0000000000", email: "DONO@loja.test ", customers }), { customerId: "c2", via: "email" });
});

test("planLeverpriceLink: e-mail só liga cliente do LeverPrice, ativo e sem org; o lead da venda vale", () => {
  const leads = [{ id: "l1", email: "compras@loja.test", dealProduct: "price_escala" }];
  const base = { orgId: ORG, email: "compras@loja.test", leads };
  assert.deepEqual(planLeverpriceLink({ ...base, customers: [{ id: "c1", saas: "leverads", leadId: "l1" }] }), { customerId: "c1", via: "email" });
  assert.equal(planLeverpriceLink({ ...base, customers: [{ id: "c1", saas: "leverads", email: "compras@loja.test", planCode: "ads_escala" }] }).reason,
    "email_unknown", "negócio só de LeverAds não liga pelo e-mail do LeverPrice");
  assert.equal(planLeverpriceLink({ ...base, customers: [{ id: "c1", ...precoCliente({ email: "compras@loja.test", endedAt: "2026-01-01" }) }] }).reason,
    "email_unknown", "cliente encerrado não liga");
});

test("handleLeverpriceOrgCreated: grava org, via e core_org_id; não toca a org do LeverAds", async () => {
  const repo = makeMemRepo();
  const leveradsOrg = "a0000000-0000-4000-8000-000000000001";
  const c = await repo.create("customers", precoCliente({ signupInvite: { token: TOKEN }, leveradsOrgId: leveradsOrg, orgId: leveradsOrg }));
  const logs = [];
  const log = { info: (obj, msg) => logs.push({ obj, msg }) };
  const r = await handleLeverpriceOrgCreated(repo, { orgId: ORG.toUpperCase(), coreOrgId: CORE, invite: TOKEN, email: "x@y.test", name: "Loja SA",
    now: () => new Date("2026-10-28T15:00:00Z"), log });
  assert.deepEqual(r, { linked: true, customer: c.id, via: "convite" });
  const saved = await repo.get("customers", c.id);
  assert.equal(saved.leverpriceOrgId, ORG);
  assert.deepEqual(saved.leverpriceOrgLink, { via: "convite", at: "2026-10-28T15:00:00.000Z", coreOrgId: CORE, orgName: "Loja SA" });
  assert.equal(saved.leveradsOrgId, leveradsOrg);
  assert.equal(saved.orgId, leveradsOrg);
  assert.ok(!JSON.stringify(logs).includes("x@y.test"), "o log não leva o e-mail");
});

// ── Rota pública ────────────────────────────────────────────────────────────

async function withKey(fn) {
  const old = process.env.LEVERPRICE_SERVICE_KEY;
  process.env.LEVERPRICE_SERVICE_KEY = KEY;
  try { await fn(); } finally {
    if (old === undefined) delete process.env.LEVERPRICE_SERVICE_KEY; else process.env.LEVERPRICE_SERVICE_KEY = old;
  }
}

function publicApp(repo) {
  const app = Fastify();
  registerLeverpriceOrgRoutes(app, repo);
  const post = async (headers, payload) => {
    const res = await app.inject({ method: "POST", url: "/public/leverprice/org-created", headers, payload });
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    return res;
  };
  return post;
}
const ok = { "x-cockpit-service-key": KEY };
const aviso = (extra = {}) => ({ org_id: ORG, core_org_id: CORE, convite: null, email: "dono@loja.test", name: "Loja", ...extra });

test("leverpriceServiceKeyOk: chave própria; sem a env ninguém passa; a do LeverAds não serve", () => {
  assert.equal(leverpriceServiceKeyOk("k", {}), false);
  assert.equal(leverpriceServiceKeyOk("", { LEVERPRICE_SERVICE_KEY: "k" }), false);
  assert.equal(leverpriceServiceKeyOk("k", { LEVERPRICE_SERVICE_KEY: "k" }), true);
  assert.equal(leverpriceServiceKeyOk("k", { LEVERADS_SERVICE_KEY: "k" }), false);
  assert.equal(leverpriceServiceKeyOk("kk", { LEVERPRICE_SERVICE_KEY: "k" }), false);
});

test("POST /public/leverprice/org-created: 401 sem chave ou com chave errada, 400 com org_id inválido", async () => {
  await withKey(async () => {
    const repo = makeMemRepo();
    const c = await repo.create("customers", precoCliente());
    const post = publicApp(repo);
    assert.equal((await post({}, aviso())).statusCode, 401);
    assert.equal((await post({ "x-cockpit-service-key": "errada" }, aviso())).statusCode, 401);
    assert.equal((await post(ok, aviso({ org_id: "nao-e-uuid" }))).statusCode, 400);
    assert.equal((await repo.get("customers", c.id)).leverpriceOrgId, undefined, "nada gravado");
  });
});

test("POST /public/leverprice/org-created: vincula pelo convite (outro e-mail) e responde 202", async () => {
  await withKey(async () => {
    const repo = makeMemRepo();
    const c = await repo.create("customers", precoCliente({ signupInvite: { token: TOKEN } }));
    const post = publicApp(repo);
    const res = await post(ok, aviso({ convite: TOKEN, email: "socio@outra.test" }));
    assert.equal(res.statusCode, 202);
    assert.deepEqual(res.json(), { received: true });
    const saved = await repo.get("customers", c.id);
    assert.equal(saved.leverpriceOrgId, ORG);
    assert.equal(saved.leverpriceOrgLink.via, "convite");
    assert.equal(saved.leverpriceOrgLink.coreOrgId, CORE);
  });
});

test("POST /public/leverprice/org-created: e-mail 1 × 1 vincula; e-mail ambíguo não grava", async () => {
  await withKey(async () => {
    const repo = makeMemRepo();
    const c = await repo.create("customers", precoCliente());
    const post = publicApp(repo);
    assert.equal((await post(ok, aviso({ core_org_id: null }))).statusCode, 202);
    const saved = await repo.get("customers", c.id);
    assert.equal(saved.leverpriceOrgId, ORG);
    assert.deepEqual({ via: saved.leverpriceOrgLink.via, core: saved.leverpriceOrgLink.coreOrgId }, { via: "email", core: null });

    const repo2 = makeMemRepo();
    const a = await repo2.create("customers", precoCliente({ name: "A" }));
    const b = await repo2.create("customers", precoCliente({ name: "B" }));
    const post2 = publicApp(repo2);
    assert.equal((await post2(ok, aviso())).statusCode, 202);
    assert.equal((await repo2.get("customers", a.id)).leverpriceOrgId, undefined);
    assert.equal((await repo2.get("customers", b.id)).leverpriceOrgId, undefined);
  });
});

test("POST /public/leverprice/org-created: org já vinculada a outro cliente não é gravada de novo", async () => {
  await withKey(async () => {
    const repo = makeMemRepo();
    const dono = await repo.create("customers", precoCliente({ name: "Dono", email: "a@a.test", leverpriceOrgId: ORG }));
    const outro = await repo.create("customers", precoCliente({ name: "Outro", signupInvite: { token: TOKEN } }));
    const post = publicApp(repo);
    assert.equal((await post(ok, aviso({ convite: TOKEN }))).statusCode, 202);
    assert.equal((await repo.get("customers", outro.id)).leverpriceOrgId, undefined);
    assert.equal((await repo.get("customers", dono.id)).leverpriceOrgId, ORG);
  });
});
