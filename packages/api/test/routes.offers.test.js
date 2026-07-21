// Links de pagamento das ofertas — GET cai nos defaults sem doc; PUT sanitiza
// (só link http, corta lixo) e persiste por produto.

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";

const { registerOfferRoutes } = await import("../src/routes.offers.js");

async function buildApp() {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds" });
  await repo.create("products", { id: "outro", name: "Outro" });
  const app = Fastify();
  registerOfferRoutes(app, repo);
  return { app, repo };
}

test("GET sem doc: LeverAds cai nos 3 links default; produto sem default = vazio", async () => {
  const { app } = await buildApp();
  const lev = (await app.inject({ method: "GET", url: "/api/offers/leverads" })).json();
  assert.equal(lev.items.length, 3);
  assert.deepEqual(lev.items.map((o) => o.key), ["anual", "semestral", "unico"]);
  assert.match(lev.items[0].link, /mpago\.la/);

  const outro = (await app.inject({ method: "GET", url: "/api/offers/outro" })).json();
  assert.deepEqual(outro.items, []);

  const missing = await app.inject({ method: "GET", url: "/api/offers/naoexiste" });
  assert.equal(missing.statusCode, 404);
});

test("PUT sanitiza e persiste; GET seguinte devolve o salvo", async () => {
  const { app, repo } = await buildApp();
  const payload = { items: [
    { key: "anual", label: "Anual", price: "12x 599", link: "https://mpago.la/abc" },
    { label: "Lixo com link inválido", link: "javascript:alert(1)" }, // link cortado, fica só o label
    { label: "", link: "" }, // vazio total → descartado
  ] };
  const put = await app.inject({ method: "PUT", url: "/api/offers/leverads", payload });
  assert.equal(put.statusCode, 200);
  const saved = put.json().items;
  assert.equal(saved.length, 2); // o vazio total saiu
  assert.equal(saved[0].link, "https://mpago.la/abc");
  assert.equal(saved[1].link, ""); // javascript: não é http → cortado

  // persistiu no doc do produto
  const doc = await repo.get("offers", "leverads");
  assert.equal(doc.items.length, 2);

  // GET agora devolve o salvo, não os defaults
  const get = (await app.inject({ method: "GET", url: "/api/offers/leverads" })).json();
  assert.equal(get.items.length, 2);
  assert.equal(get.items[0].label, "Anual");
});

test("PUT com items inválido = 400; produto inexistente = 404", async () => {
  const { app } = await buildApp();
  const bad = await app.inject({ method: "PUT", url: "/api/offers/leverads", payload: { items: "nao é lista" } });
  assert.equal(bad.statusCode, 400);
  const missing = await app.inject({ method: "PUT", url: "/api/offers/naoexiste", payload: { items: [] } });
  assert.equal(missing.statusCode, 404);
});

test("PUT preserva proposalUrl http e corta o inválido", async () => {
  const { app } = await buildApp();
  const payload = { items: [
    { key: "anual", label: "Anual", price: "12x 599", link: "https://mpago.la/abc", proposalUrl: "https://levermoney.com.br/p/pr_env_clone_anual" },
    { key: "semestral", label: "Semestral", link: "https://mpago.la/def", proposalUrl: "javascript:alert(1)" },
  ] };
  const saved = (await app.inject({ method: "PUT", url: "/api/offers/leverads", payload })).json().items;
  assert.equal(saved[0].proposalUrl, "https://levermoney.com.br/p/pr_env_clone_anual");
  assert.equal(saved[1].proposalUrl, ""); // não-http é cortado, igual ao link de pagamento
});
