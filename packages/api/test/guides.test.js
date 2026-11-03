// Guias (03/11/2026): base de conhecimento interna com passos e prints, o guia
// inicial de implantação e o vínculo dos itens do checklist da integração.

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import multipart from "@fastify/multipart";
import { makeMemRepo } from "./helpers/mem-repo.js";
import { canEditGuides, cleanGuide, createGuide, createStarterGuide, updateGuide } from "../src/guides/guides.js";
import { registerGuideRoutes } from "../src/guides/routes.guides.js";
import { STARTER_LINKS } from "../src/guides/guide-starter.js";
import { DEFAULT_TEMPLATES, templatesOf } from "../src/customers/onboarding-templates.js";
import { createOnboarding } from "../src/customers/onboardings.js";

const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4c40000000049454e44ae426082", "hex");

async function setup(user) {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds" });
  const app = Fastify();
  await app.register(multipart);
  app.addHook("preHandler", async (req) => { req.authUser = user; });
  registerGuideRoutes(app, repo);
  return { repo, app };
}
const editor = { id: "bia", roles: ["guias"] };
const leitor = { id: "jon", roles: ["integrator"] };

test("validação: título obrigatório, passos limpos, público e status da lista fechada", () => {
  assert.throws(() => cleanGuide({ title: " " }), /título/);
  assert.throws(() => cleanGuide({ title: "x", audience: "vendas" }), /Público inválido/);
  assert.throws(() => cleanGuide({ title: "x", steps: [{ title: "" }] }), /Passo 1 sem título/);
  const g = cleanGuide({ title: "Conectar contas", steps: [
    { id: "a", title: "Abrir", body: "linha 1\r\nlinha 2  ", images: [{ id: "ga_x1", caption: "tela" }, { id: "javascript:alert(1)" }] },
    { id: "a", title: "Repetido" },
  ] });
  assert.deepEqual([g.audience, g.status, g.product], ["integrador", "rascunho", ""]);
  assert.equal(g.steps[0].body, "linha 1\nlinha 2");
  assert.deepEqual(g.steps[0].images, [{ id: "ga_x1", caption: "tela" }], "só id de print do guia");
  assert.notEqual(g.steps[1].id, "a", "id repetido ganha outro");
});

test("permissão: admin e Editor de guias escrevem; o resto lê", () => {
  assert.equal(canEditGuides({ roles: ["admin"] }), true);
  assert.equal(canEditGuides(editor), true);
  assert.equal(canEditGuides(leitor), false);
  assert.equal(canEditGuides(null), true, "chave mestre");
});

test("rota: editor cria e publica; quem só lê não vê rascunho e não escreve", async () => {
  const ed = await setup(editor);
  const r = await ed.app.inject({ method: "POST", url: "/api/guides", payload: { saas: "leverads", title: "Rascunho", steps: [{ title: "Passo" }] } });
  assert.equal(r.statusCode, 201);
  const pub = (await ed.app.inject({ method: "POST", url: "/api/guides", payload: { saas: "leverads", title: "Publicado", status: "publicado" } })).json();
  assert.ok(pub.publishedAt);
  assert.equal((await ed.app.inject({ url: "/api/guides?saas=leverads" })).json().guides.length, 2);

  const le = await setup(leitor);
  await le.repo.create("guides", { id: "gd_a", saas: "leverads", title: "R", status: "rascunho", steps: [] });
  await le.repo.create("guides", { id: "gd_b", saas: "leverads", title: "P", status: "publicado", steps: [] });
  const lista = (await le.app.inject({ url: "/api/guides?saas=leverads" })).json();
  assert.deepEqual([lista.guides.map((g) => g.id), lista.canEdit], [["gd_b"], false]);
  assert.equal((await le.app.inject({ url: "/api/guides/gd_a" })).statusCode, 404, "rascunho fica escondido");
  assert.equal((await le.app.inject({ method: "POST", url: "/api/guides", payload: { saas: "leverads", title: "x" } })).statusCode, 403);
  assert.equal((await le.app.inject({ method: "PATCH", url: "/api/guides/gd_b", payload: { title: "y" } })).statusCode, 403);
});

test("edição concorrente: salvar com a versão velha devolve 409", async () => {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads" });
  const g = await createGuide(repo, { saas: "leverads", title: "Guia" });
  const v2 = await updateGuide(repo, g.id, { title: "Guia 2", rev: 1 });
  assert.equal(v2.rev, 2);
  await assert.rejects(() => updateGuide(repo, g.id, { title: "Guia velho", rev: 1 }), /Alguém salvou/);
});

test("print: só imagem, servido com sessão, e apagar o guia leva os prints só dele", async () => {
  const { repo, app } = await setup(editor);
  const form = (buf, type) => {
    const boundary = "----guia";
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="p.png"\r\nContent-Type: ${type}\r\n\r\n`),
      buf, Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    return { payload: body, headers: { "content-type": `multipart/form-data; boundary=${boundary}` } };
  };
  const bad = await app.inject({ method: "POST", url: "/api/guides/assets?saas=leverads", ...form(Buffer.from("oi"), "text/plain") });
  assert.equal(bad.statusCode, 400);
  const up = await app.inject({ method: "POST", url: "/api/guides/assets?saas=leverads", ...form(PNG, "image/png") });
  assert.equal(up.statusCode, 201);
  const { id } = up.json();
  const img = await app.inject({ url: `/api/guides/assets/${id}` });
  assert.equal(img.headers["content-type"], "image/png");
  assert.match(img.headers["cache-control"], /private/);
  const g = (await app.inject({ method: "POST", url: "/api/guides", payload: { saas: "leverads", title: "Com print", steps: [{ title: "Tela", images: [{ id, caption: "conectar" }] }] } })).json();
  assert.equal((await app.inject({ method: "DELETE", url: `/api/guides/${g.id}` })).statusCode, 200);
  assert.equal(await repo.get("guide_assets", id), null);
});

test("guia inicial: cria o rascunho uma vez e liga o checklist de implantação aos passos", async () => {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads" });
  const r1 = await createStarterGuide(repo, "leverads", { by: "bia" });
  assert.equal(r1.created, true);
  assert.equal(r1.guide.status, "rascunho");
  const implantacao = DEFAULT_TEMPLATES.find((t) => t.kind === "implantacao");
  assert.equal(r1.linked, implantacao.items.filter((it) => STARTER_LINKS[it.title]).length);
  const stepIds = new Set(r1.guide.steps.map((st) => st.id));
  for (const step of Object.values(STARTER_LINKS)) assert.ok(stepIds.has(step), `passo ${step} existe no guia`);
  const tpl = (await templatesOf(repo, "leverads")).find((t) => t.kind === "implantacao");
  assert.deepEqual(tpl.items.find((it) => it.title === "Kickoff com o cliente").guide, { id: r1.guide.id, step: "abrir-call" });
  const r2 = await createStarterGuide(repo, "leverads");
  assert.deepEqual([r2.created, r2.linked, r2.guide.id], [false, 0, r1.guide.id], "rodar de novo não duplica");
  assert.equal((await repo.list("guides")).length, 1);

  // A integração criada pelo modelo leva o vínculo para o checklist.
  await repo.create("customers", { id: "cu_1", saas: "leverads", name: "Lupa" });
  const ob = await createOnboarding(repo, { customer: "cu_1", kind: "implantacao" });
  const kickoff = ob.items.find((it) => it.title === "Kickoff com o cliente");
  assert.deepEqual(kickoff.guide, { id: r1.guide.id, step: "abrir-call" });
});
