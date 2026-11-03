// Pacote de guias da Lever (03/11/2026): instalar, não duplicar, atualizar o que
// ninguém editou e preservar o que foi editado no Cockpit; os guias reais do
// pacote passam na validação dos guias.

import test from "node:test";
import assert from "node:assert/strict";
import { makeMemRepo } from "./helpers/mem-repo.js";
import { PACK_CALL_KEY, PACK_CHECKLIST_LINKS, installGuidePack, packOrder, packStatus } from "../src/guides/guide-pack.js";
import { GUIDE_PACK } from "../src/guides/pack/index.js";
import { cleanGuide, listGuides, updateGuide } from "../src/guides/guides.js";
import { cleanGuideLink, saveTemplates, templatesOf } from "../src/customers/onboarding-templates.js";

const PNG = Buffer.from("89504e470d0a1a0a", "hex");
const guia = (version, extra = {}) => ({
  key: "teste", version, title: "Teste", summary: "s", audience: "integrador", product: "",
  steps: [{ id: "um", title: "Passo um", body: "texto", tip: "", images: [{ file: "um.png", caption: "tela" }] }], ...extra,
});

test("os guias do pacote são válidos, com chaves e passos únicos", () => {
  const keys = new Set();
  for (const g of GUIDE_PACK) {
    assert.ok(!keys.has(g.key), `chave repetida: ${g.key}`);
    keys.add(g.key);
    assert.ok(Number.isInteger(g.version) && g.version > 0, `${g.key}: version`);
    const clean = cleanGuide(g);
    assert.deepEqual(clean.steps.map((s) => s.id), g.steps.map((s) => s.id), `${g.key}: ids dos passos fixos e únicos`);
  }
});

test("instala, não duplica, atualiza versão nova e preserva guia editado", async () => {
  const repo = makeMemRepo();
  const readImage = async () => PNG;
  const r1 = await installGuidePack(repo, "leverads", { pack: [guia(1)], readImage, by: "eryk" });
  assert.deepEqual(r1.installed, ["teste"]);
  const [g] = await repo.list("guides");
  assert.match(g.id, /^gd_pk[0-9a-f]+$/);
  assert.ok(cleanGuideLink({ id: g.id, step: "um" }), "o checklist consegue apontar para o guia do pacote");
  assert.deepEqual([g.status, g.pack, g.packVersion, g.steps[0].images[0].caption], ["publicado", "teste", 1, "tela"]);
  assert.equal((await repo.list("guide_assets")).length, 1);

  const r2 = await installGuidePack(repo, "leverads", { pack: [guia(1)], readImage });
  assert.deepEqual([r2.current, (await repo.list("guides")).length, (await repo.list("guide_assets")).length], [["teste"], 1, 1]);

  const r3 = await installGuidePack(repo, "leverads", { pack: [guia(2, { title: "Teste 2" })], readImage });
  assert.deepEqual(r3.updated, ["teste"]);
  assert.equal((await repo.get("guides", g.id)).title, "Teste 2");

  const cur = await repo.get("guides", g.id);
  await updateGuide(repo, g.id, { title: "Ajustado à mão", rev: cur.rev });
  assert.equal((await packStatus(repo, "leverads", { pack: [guia(3)] }))[0].state, "editado");
  const r4 = await installGuidePack(repo, "leverads", { pack: [guia(3, { title: "Teste 3" })], readImage });
  assert.deepEqual(r4.edited, ["teste"]);
  assert.equal((await repo.get("guides", g.id)).title, "Ajustado à mão", "edição no Cockpit não é sobrescrita");
});

test("o pacote grava a posição na trilha de cada sistema e a lista sai nessa ordem", async () => {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds" });
  const readImage = async () => PNG;
  const pack = [
    guia(1, { key: "call", title: "Call" }),
    guia(1, { key: "ads-b", title: "LeverAds · Zeta", product: "leverads" }),
    guia(1, { key: "ads-a", title: "LeverAds · Alfa", product: "leverads" }),
    guia(1, { key: "price", title: "LeverPrice · Primeiro", product: "leverprice" }),
  ];
  const orders = packOrder(pack);
  assert.deepEqual(orders, { call: 1, "ads-b": 1, "ads-a": 2, price: 1 });
  await installGuidePack(repo, "leverads", { pack, readImage });
  // Um guia feito à mão, sem posição, vai para o fim da trilha dele.
  await repo.create("guides", { id: "gd_mao", saas: "leverads", title: "LeverAds · Avulso", product: "leverads", status: "publicado", steps: [] });
  const list = await listGuides(repo, { saas: "leverads" });
  assert.deepEqual(list.map((g) => g.title), ["Call", "LeverAds · Zeta", "LeverAds · Alfa", "LeverAds · Avulso", "LeverPrice · Primeiro"]);
  // Guia já instalado sem posição (antes da trilha) recebe a do pacote sem virar edição.
  const ads = list.find((g) => g.pack === "ads-a");
  await repo.update("guides", ads.id, { order: 0 });
  const r = await installGuidePack(repo, "leverads", { pack, readImage });
  assert.deepEqual(r.current.length, 4);
  const back = await repo.get("guides", ads.id);
  assert.deepEqual([back.order, back.rev], [2, ads.rev]);
  assert.equal(cleanGuide({ title: "x", order: 5000 }).order, 0, "posição fora da faixa vira sem ordem");
});

test("a trilha real: comuns, LeverAds e LeverPrice começam pelo primeiro acesso", () => {
  const orders = packOrder();
  assert.deepEqual([orders["call-integracao"], orders["link-cadastro"]], [1, 2]);
  assert.equal(orders["leverads-primeiro-acesso"], 1);
  assert.equal(orders["leverprice-primeiro-acesso"], 1);
});

test("instalar o pacote liga o checklist de implantação ao guia da call, inclusive o que apontava pro rascunho antigo", async () => {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds" });
  const readImage = async () => PNG;
  const call = GUIDE_PACK.find((g) => g.key === PACK_CALL_KEY);
  const stepIds = new Set(call.steps.map((s) => s.id));
  for (const step of Object.values(PACK_CHECKLIST_LINKS)) assert.ok(stepIds.has(step), `passo ${step} existe no guia da call`);
  await repo.create("guides", { id: "gd_velho", saas: "leverads", starter: "implantacao", title: "Implantação", product: "leverads", status: "publicado", steps: [] });
  await repo.create("guides", { id: "gd_outro", saas: "leverads", title: "Outro", product: "", status: "publicado", steps: [] });
  await saveTemplates(repo, "leverads", [{ kind: "implantacao", name: "Implantação", items: [
    { title: "Formulário de integração respondido", guide: { id: "gd_velho", step: "antes-da-call" } },
    { title: "Kickoff com o cliente" },
    { title: "Go-live confirmado com o cliente", guide: { id: "gd_outro", step: "xx" } },
    { title: "Item próprio do time" },
  ] }]);
  const r = await installGuidePack(repo, "leverads", { pack: [call], readImage });
  assert.equal(r.linked, 2);
  const g = (await repo.list("guides")).find((x) => x.pack === PACK_CALL_KEY);
  const items = (await templatesOf(repo, "leverads"))[0].items;
  assert.deepEqual(items.map((it) => it.guide || null), [{ id: g.id, step: "confirmar" }, { id: g.id, step: "entrar" }, { id: "gd_outro", step: "xx" }, null]);
  assert.equal((await installGuidePack(repo, "leverads", { pack: [call], readImage })).linked, 0, "reinstalar não religa");
});
