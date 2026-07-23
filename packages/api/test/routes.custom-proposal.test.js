// Proposta PERSONALIZADA (objetiva): capa + o combinado (entregáveis + valor),
// no layout do deck. POST /api/leads/:id/proposal/custom faz preview (sem salvar)
// e upsert idempotente por lead, sem tocar na proposta automática.

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";

const { registerRoutes } = await import("../src/routes.js");
const { buildCustomProposal, customSlides, sanitizeCustomSpec } = await import("../src/proposal.js");

function buildApp(repo) {
  const app = Fastify();
  registerRoutes(app, repo);
  return app;
}

async function seed() {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds", funnel: [] });
  await repo.create("proposal_templates", { id: "tpl1", saas: "leverads", status: "published", theme: { accent: "#0F766E", font: "Inter", logoUrl: "x.svg" }, slides: [], calc: {} });
  await repo.create("leads", { id: "l1", saas: "leverads", name: "Thiago 4U", company: "4U", stage: "Call agendada" });
  return repo;
}

const SPEC = { title: "Proposta 4U", subtitle: "Solução sob medida", deliverables: ["Clonagem ML→Shopee", "Conta-mãe com estoque", ""], price: "6.000", cycle: "avista" };

test("sanitize + slides: capa (hero) + combinado (pricing com entregáveis e valor)", () => {
  const s = sanitizeCustomSpec(SPEC);
  assert.equal(s.price, "6000", "valor vira só dígitos");
  assert.deepEqual(s.deliverables, ["Clonagem ML→Shopee", "Conta-mãe com estoque"], "entregável vazio some");

  const slides = customSlides(SPEC, { company: "4U" });
  assert.deepEqual(slides.map((x) => x.type), ["hero", "pricing"]);
  assert.equal(slides[0].title, "Proposta 4U");
  assert.equal(slides[0].tag, "4U", "capa mostra a empresa");
  assert.deepEqual(slides[1].features, ["Clonagem ML→Shopee", "Conta-mãe com estoque"]);
  assert.equal(slides[1].price, "6.000", "valor formatado pt-BR");
  assert.equal(slides[1].cycles, "pagamento único");
});

test("herda o tema do template publicado (mesma cara do deck)", () => {
  const built = buildCustomProposal({ company: "4U" }, SPEC, { theme: { accent: "#0F766E", logoUrl: "x.svg" } });
  assert.equal(built.theme.accent, "#0F766E");
  assert.equal(built.theme.logoUrl, "x.svg");
  assert.equal(built.showAll, true, "versão do cliente: tudo visível");
});

test("preview renderiza o HTML sem persistir", async () => {
  const repo = await seed();
  const app = buildApp(repo);
  const r = await app.inject({ method: "POST", url: "/api/leads/l1/proposal/custom", payload: { ...SPEC, preview: true } });
  assert.equal(r.statusCode, 200);
  const html = r.json().html;
  assert.match(html, /Proposta 4U/);
  assert.match(html, /Clonagem ML/);
  assert.match(html, /6\.000/);
  assert.equal((await repo.list("proposals")).length, 0, "preview não salva nada");
  await app.close();
});

test("salvar: cria proposta, vincula ao lead SEM tocar na automática, e é idempotente", async () => {
  const repo = await seed();
  await repo.update("leads", "l1", { proposta_id: "pr_auto", proposalUrl: "/p/pr_auto" }); // proposta automática já existe
  const app = buildApp(repo);

  const r1 = (await app.inject({ method: "POST", url: "/api/leads/l1/proposal/custom", payload: SPEC })).json();
  assert.equal(r1.ok, true);
  assert.match(r1.url, /\/p\//);
  let proposals = await repo.list("proposals");
  assert.equal(proposals.length, 1);
  assert.equal(proposals[0].origin, "custom");
  assert.equal(proposals[0].editKey, "", "sem editKey: o link nunca abre edição");
  assert.deepEqual(proposals[0].spec.deliverables, ["Clonagem ML→Shopee", "Conta-mãe com estoque"], "guarda a spec pra reabrir o form");

  let lead = await repo.get("leads", "l1");
  assert.equal(lead.customProposalId, r1.id);
  assert.equal(lead.customProposalUrl, r1.url);
  assert.equal(lead.proposta_id, "pr_auto", "a proposta automática fica intacta");
  assert.equal(lead.proposalUrl, "/p/pr_auto");

  // Re-salvar (editar): MESMO id/link, não duplica.
  const r2 = (await app.inject({ method: "POST", url: "/api/leads/l1/proposal/custom", payload: { ...SPEC, price: "7.000" } })).json();
  assert.equal(r2.id, r1.id, "mesmo link ao editar");
  proposals = await repo.list("proposals");
  assert.equal(proposals.length, 1, "não duplica");
  assert.equal(proposals[0].slides[1].price, "7.000");

  // A timeline registra criação e edição.
  const acts = (await repo.list("activities")).filter((a) => a.lead === "l1");
  assert.ok(acts.some((a) => a.meta?.event === "custom_proposal_created"));
  assert.ok(acts.some((a) => a.meta?.event === "custom_proposal_updated"));
  await app.close();
});

test("sem valor: proposta só de escopo (sem card de preço), e 404 pra lead inexistente", async () => {
  const repo = await seed();
  const app = buildApp(repo);
  const r = (await app.inject({ method: "POST", url: "/api/leads/l1/proposal/custom", payload: { title: "Escopo", deliverables: ["Consultoria"], price: "" } })).json();
  const p = (await repo.list("proposals"))[0];
  assert.equal(p.slides[1].price, "a combinar");
  assert.equal((await app.inject({ method: "POST", url: "/api/leads/nao/proposal/custom", payload: SPEC })).statusCode, 404);
  await app.close();
});
