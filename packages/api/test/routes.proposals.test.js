// Proposal builder nativo: dispatcher native|levercopy, geração com snapshot,
// página pública /p/:id (view tracking + modo closer), PATCH por editKey,
// aceite (flag no lead + estágio) e preview autenticado. Repo in-memory.

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";

delete process.env.LEVERCOPY_INGEST_KEY;
process.env.LEVERCOPY_API_URL = "";

const { registerRoutes } = await import("../src/routes.js");

const TEMPLATE = {
  id: "pt_lever",
  saas: "leverads",
  name: "Proposta LeverAds",
  status: "published",
  theme: { accent: "#23D8D3", bg: "#051C2C" },
  acceptStage: "Config + Kickoff",
  calc: {
    seatsKey: "accounts", seatsMap: { "1": 2, "2": 2, "3-5": 4, "6-10": 8, "10+": 12 },
    volumeKey: "volume", volumeMid: { "0-10": 5, "10-50": 28, "50-200": 110, "200+": 240 },
    plans: { monthly: { base: 399, included: 2, extra: 50 }, quarterly: { base: 349, included: 2, extra: 50 } },
    defaultCycle: "quarterly",
  },
  slides: [
    { key: "hero", type: "hero", tag: "Proposta personalizada", title: "Quanto a *{{lead.company}}* perde.", meta: [{ label: "Apresentado a", value: "{{lead.name}}" }] },
    { key: "preco", type: "pricing", title: "Investimento", planTag: "LEVERADS · {{calc.plano}}", features: ["Cópias ilimitadas"], acceptLabel: "Aceitar proposta" },
  ],
};

async function buildApp() {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds", funnel: [{ stage: "Inbox" }, { stage: "Config + Kickoff" }] });
  await repo.create("proposal_templates", { ...TEMPLATE });
  const app = Fastify();
  registerRoutes(app, repo);
  return { app, repo };
}

const LEAD = { id: "le_p1", name: "Ana Souza", company: "Loja X", saas: "leverads", accounts: "3-5", volume: "50-200", stage: "Inbox" };

test("dispatcher: template publicado → provider native, lead recebe URLs, snapshot criado", async () => {
  const { app, repo } = await buildApp();
  await repo.create("leads", { ...LEAD });

  const res = await app.inject({ method: "POST", url: "/api/leads/le_p1/proposal?auto=1" });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.provider, "native");
  assert.equal(body.ok, true);

  const lead = await repo.get("leads", "le_p1");
  assert.ok(lead.proposta_id);
  assert.match(lead.proposalUrl, /\/p\//);
  assert.match(lead.proposal_edit_url, /\?k=/);

  const proposal = await repo.get("proposals", lead.proposta_id);
  assert.equal(proposal.saas, "leverads");
  assert.equal(proposal.lead, "le_p1");
  assert.equal(proposal.slides.length, 2);          // snapshot do template
  assert.equal(proposal.state.seats, 4);            // seatsMap["3-5"]
  assert.equal(proposal.state.volume, "50-200");
  assert.equal(proposal.state.cycle, "quarterly");
  assert.equal(proposal.data.lead.firstName, "Ana");
  assert.equal(proposal.data.answers.accounts, "3-5"); // resposta de qualificação
  assert.equal(proposal.state.accounts, "3-5");      // faixa escolhida fica no estado
  assert.equal(proposal.data.answers.name, undefined); // core não vaza pra answers
  assert.ok(proposal.editKey.length >= 16);

  // potencial de ganho no pipeline = valor do ciclo padrão da proposta:
  // quarterly 349 + 2 contas extras × 50 = 449/mês × 3 meses = 1347
  assert.equal(lead.amount, 1347);

  // sem COCKPIT_PUBLIC_URL, a base do link vem da request (proxy headers)
  const re = await app.inject({
    method: "POST",
    url: "/api/leads/le_p1/proposal?force=1",
    headers: { "x-forwarded-host": "cockpit.example.com", "x-forwarded-proto": "https" },
  });
  assert.equal(re.json().ok, true);
  const releads = await repo.get("leads", "le_p1");
  assert.match(releads.proposalUrl, /^https:\/\/cockpit\.example\.com\/p\//);

  // idempotência: 2ª chamada auto pula
  const again = (await app.inject({ method: "POST", url: "/api/leads/le_p1/proposal?auto=1" })).json();
  assert.equal(again.skipped, "already_generated");
  await app.close();
});

test("POST /api/leads (espelho de SaaS externo) auto-gera a proposta nativa e sobrescreve o proposalUrl externo", async () => {
  const { app, repo } = await buildApp();
  // simula o espelho do leverads.com.br: lead criado pela rota genérica já com um
  // proposalUrl externo (renderer do copylever). Com template publicado, o create
  // deve disparar o builder nativo e trocar o link pelo /p/.
  const res = await app.inject({
    method: "POST",
    url: "/api/leads",
    payload: { name: "Externo", company: "Loja Ext", saas: "leverads", accounts: "3-5", volume: "50-200", stage: "Inbox", proposalUrl: "https://leverads.com.br/proposta/ext123" },
  });
  assert.equal(res.statusCode, 201);
  const created = res.json();
  assert.ok(created.proposta_id, "deveria ter gerado a proposta nativa no create");
  assert.match(created.proposalUrl, /\/p\//);
  assert.doesNotMatch(created.proposalUrl, /\/proposta\//);

  const proposal = await repo.get("proposals", created.proposta_id);
  assert.equal(proposal.saas, "leverads");
  assert.equal(proposal.slides.length, 2); // snapshot do template publicado
  await app.close();
});

test("POST /api/leads de SaaS SEM template publicado não dispara proposta no create", async () => {
  const { app, repo } = await buildApp();
  await repo.create("products", { id: "outro", name: "Outro", funnel: [{ stage: "Inbox" }] });
  const res = await app.inject({
    method: "POST", url: "/api/leads",
    payload: { name: "Z", saas: "outro", stage: "Inbox" },
  });
  assert.equal(res.statusCode, 201);
  assert.equal(res.json().proposta_id, undefined);
  await app.close();
});

test("showIf: slide condicional entra no snapshot só quando a resposta do lead bate", async () => {
  const { app, repo } = await buildApp();
  const compat = { key: "compat_sku", type: "steps", title: "Compatibilidade SKU", showIf: { key: "niche", values: ["autopecas"] } };
  await repo.update("proposal_templates", "pt_lever", { slides: [...TEMPLATE.slides, compat] });

  await repo.create("leads", { ...LEAD, id: "le_auto", niche: "autopecas" });
  await app.inject({ method: "POST", url: "/api/leads/le_auto/proposal" });
  const pAuto = await repo.get("proposals", (await repo.get("leads", "le_auto")).proposta_id);
  assert.equal(pAuto.slides.length, 3);
  assert.ok(pAuto.slides.some((s) => s.key === "compat_sku"));

  await repo.create("leads", { ...LEAD, id: "le_moda", niche: "moda" });
  await app.inject({ method: "POST", url: "/api/leads/le_moda/proposal" });
  const pModa = await repo.get("proposals", (await repo.get("leads", "le_moda")).proposta_id);
  assert.equal(pModa.slides.length, 2);
  assert.ok(!pModa.slides.some((s) => s.key === "compat_sku"));

  // resposta multiselect (array) também bate
  await repo.create("leads", { ...LEAD, id: "le_multi", niche: ["autopecas", "moda"] });
  await app.inject({ method: "POST", url: "/api/leads/le_multi/proposal" });
  const pMulti = await repo.get("proposals", (await repo.get("leads", "le_multi")).proposta_id);
  assert.equal(pMulti.slides.length, 3);
  await app.close();
});

test("dispatcher: provider explícito 'levercopy' no produto vence o template nativo", async () => {
  const { app, repo } = await buildApp();
  await repo.update("products", "leverads", { proposalProvider: "levercopy" });
  await repo.create("leads", { ...LEAD });
  const body = (await app.inject({ method: "POST", url: "/api/leads/le_p1/proposal" })).json();
  assert.equal(body.provider, "levercopy");
  assert.equal(body.skipped, "not_configured"); // levercopy sem env → skip gracioso
  await app.close();
});

test("GET /p/:id — HTML sem editKey, view conta; com ?k certo → editable e não conta", async () => {
  const { app, repo } = await buildApp();
  await repo.create("leads", { ...LEAD });
  await app.inject({ method: "POST", url: "/api/leads/le_p1/proposal" });
  const { proposta_id } = await repo.get("leads", "le_p1");
  const { editKey } = await repo.get("proposals", proposta_id);

  const pub = await app.inject({ method: "GET", url: `/p/${proposta_id}` });
  assert.equal(pub.statusCode, 200);
  assert.match(pub.headers["content-type"], /text\/html/);
  assert.match(pub.body, /__PROPOSAL__/);
  assert.doesNotMatch(pub.body, new RegExp(editKey)); // segredo nunca vai pro HTML
  assert.match(pub.body, /"editable":false/);

  const closer = await app.inject({ method: "GET", url: `/p/${proposta_id}?k=${editKey}` });
  assert.match(closer.body, /"editable":true/);

  const p = await repo.get("proposals", proposta_id);
  assert.equal(p.views, 1); // só o GET público contou
  assert.equal((await app.inject({ method: "GET", url: "/p/nope" })).statusCode, 404);
  await app.close();
});

test("GET /p/:id — abertura do TIME (?from=cockpit) não conta como cliente; abertura do cliente registra quem/dispositivo", async () => {
  const { app, repo } = await buildApp();
  await repo.create("leads", { ...LEAD });
  await app.inject({ method: "POST", url: "/api/leads/le_p1/proposal" });
  const { proposta_id } = await repo.get("leads", "le_p1");

  // Time abrindo de dentro do cockpit: entra no viewLog como "time", NÃO conta view nem loga proposal_viewed.
  await app.inject({ method: "GET", url: `/p/${proposta_id}?from=cockpit`, headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0) Chrome/120" } });
  let p = await repo.get("proposals", proposta_id);
  assert.equal(Number(p.views) || 0, 0, "abertura do time não conta");
  assert.equal((p.viewLog || []).at(-1).viewer, "time");
  let acts = (await repo.list("activities")).filter((a) => a.meta?.event === "proposal_viewed");
  assert.equal(acts.length, 0, "abertura do time não loga proposal_viewed");

  // Cliente abrindo do celular: conta, loga proposal_viewed com viewer=cliente + device.
  await app.inject({ method: "GET", url: `/p/${proposta_id}`, headers: { "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17) Safari" } });
  p = await repo.get("proposals", proposta_id);
  assert.equal(p.views, 1);
  assert.equal((p.viewLog || []).at(-1).viewer, "cliente");
  acts = (await repo.list("activities")).filter((a) => a.meta?.event === "proposal_viewed");
  assert.equal(acts.length, 1);
  assert.equal(acts[0].meta.viewer, "cliente");
  assert.match(acts[0].meta.device, /celular/);
  await app.close();
});

test("PATCH /public/proposals/:id — k errado 401; k certo atualiza só o estado", async () => {
  const { app, repo } = await buildApp();
  await repo.create("leads", { ...LEAD });
  await app.inject({ method: "POST", url: "/api/leads/le_p1/proposal" });
  const { proposta_id } = await repo.get("leads", "le_p1");
  const { editKey } = await repo.get("proposals", proposta_id);

  const bad = await app.inject({ method: "PATCH", url: `/public/proposals/${proposta_id}`, payload: { k: "wrong", seats: 9 } });
  assert.equal(bad.statusCode, 401);

  const ok = await app.inject({
    method: "PATCH", url: `/public/proposals/${proposta_id}`,
    payload: { k: editKey, seats: 9, cycle: "monthly", customPriceCents: 29900, frozen: true, slides: "hack" },
  });
  assert.equal(ok.statusCode, 200);
  const p = await repo.get("proposals", proposta_id);
  assert.equal(p.state.seats, 9);
  assert.equal(p.state.cycle, "monthly");
  assert.equal(p.state.customPriceCents, 29900);
  assert.equal(p.state.frozen, true);
  assert.equal(p.slides.length, 2); // PATCH não toca nos slides
  await app.close();
});

test("PATCH: faixa de contas é autoritativa — deriva seats do topo (seatsMap)", async () => {
  const { app, repo } = await buildApp();
  await repo.create("leads", { ...LEAD });
  await app.inject({ method: "POST", url: "/api/leads/le_p1/proposal" });
  const { proposta_id } = await repo.get("leads", "le_p1");
  const { editKey } = await repo.get("proposals", proposta_id);

  const ok = await app.inject({
    method: "PATCH", url: `/public/proposals/${proposta_id}`,
    payload: { k: editKey, accounts: "6-10" },
  });
  assert.equal(ok.statusCode, 200);
  const p = await repo.get("proposals", proposta_id);
  assert.equal(p.state.accounts, "6-10");
  assert.equal(p.state.seats, 8); // seatsMap["6-10"] do fixture

  // faixa fora do seatsMap é ignorada (não corrompe o estado)
  await app.inject({ method: "PATCH", url: `/public/proposals/${proposta_id}`, payload: { k: editKey, accounts: "999" } });
  const p2 = await repo.get("proposals", proposta_id);
  assert.equal(p2.state.accounts, "6-10");
  await app.close();
});

test("PATCH: campos da capa (empresa/nome/nicho) gravam no snapshot E no lead", async () => {
  const { app, repo } = await buildApp();
  await repo.create("leads", { ...LEAD });
  await app.inject({ method: "POST", url: "/api/leads/le_p1/proposal" });
  const { proposta_id } = await repo.get("leads", "le_p1");
  const { editKey } = await repo.get("proposals", proposta_id);

  const ok = await app.inject({
    method: "PATCH", url: `/public/proposals/${proposta_id}`,
    payload: { k: editKey, company: "Nova Loja", name: "João Pedro Silva", niche: "casa" },
  });
  assert.equal(ok.statusCode, 200);
  // snapshot da proposta
  const p = await repo.get("proposals", proposta_id);
  assert.equal(p.data.lead.company, "Nova Loja");
  assert.equal(p.data.lead.name, "João Pedro Silva");
  assert.equal(p.data.lead.firstName, "João"); // firstName re-derivado do nome
  assert.equal(p.data.answers.niche, "casa");
  // writeback no lead do pipeline
  const lead = await repo.get("leads", "le_p1");
  assert.equal(lead.company, "Nova Loja");
  assert.equal(lead.name, "João Pedro Silva");
  assert.equal(lead.niche, "casa");
  await app.close();
});

test("aceite: marca proposta + lead e move o estágio configurado", async () => {
  const { app, repo } = await buildApp();
  await repo.create("leads", { ...LEAD });
  await app.inject({ method: "POST", url: "/api/leads/le_p1/proposal" });
  const { proposta_id } = await repo.get("leads", "le_p1");

  const res = await app.inject({ method: "POST", url: `/public/proposals/${proposta_id}/accept`, payload: {} });
  assert.equal(res.statusCode, 200);
  const p = await repo.get("proposals", proposta_id);
  assert.equal(p.accepted, true);
  const lead = await repo.get("leads", "le_p1");
  assert.equal(lead.proposalAccepted, true);
  assert.equal(lead.stage, "Config + Kickoff"); // acceptStage existe no funil
  await app.close();
});

test("POST /api/proposals/preview → html do rascunho com dados de exemplo", async () => {
  const { app } = await buildApp();
  const res = await app.inject({
    method: "POST", url: "/api/proposals/preview",
    payload: { template: TEMPLATE },
  });
  assert.equal(res.statusCode, 200);
  assert.match(res.json().html, /__PROPOSAL__/);
  assert.match(res.json().html, /Proposta LeverAds/);
  await app.close();
});

test("GET /p/t/:id — preview do template em página própria (banner, sem persistir)", async () => {
  const { app } = await buildApp();
  const res = await app.inject({ method: "GET", url: "/p/t/pt_lever" });
  assert.equal(res.statusCode, 200);
  assert.match(res.headers["content-type"], /text\/html/);
  assert.match(res.body, /Preview do template/);
  assert.match(res.body, /Empresa Exemplo/); // dados de exemplo interpoláveis
  assert.equal((await app.inject({ method: "GET", url: "/p/t/nope" })).statusCode, 404);
  await app.close();
});
