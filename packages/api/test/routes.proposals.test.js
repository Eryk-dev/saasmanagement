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

test("PATCH: números do deck Starter (cloneCount/newPerMonth) persistem no estado", async () => {
  const { app, repo } = await buildApp();
  await repo.create("leads", { ...LEAD });
  await app.inject({ method: "POST", url: "/api/leads/le_p1/proposal" });
  const { proposta_id } = await repo.get("leads", "le_p1");
  const { editKey } = await repo.get("proposals", proposta_id);

  const ok = await app.inject({
    method: "PATCH", url: `/public/proposals/${proposta_id}`,
    payload: { k: editKey, cloneCount: 300, newPerMonth: 15 },
  });
  assert.equal(ok.statusCode, 200);
  const p = await repo.get("proposals", proposta_id);
  assert.equal(p.state.cloneCount, 300);
  assert.equal(p.state.newPerMonth, 15);

  // valor inválido não corrompe o estado (negativo/NaN ignorados)
  await app.inject({ method: "PATCH", url: `/public/proposals/${proposta_id}`, payload: { k: editKey, cloneCount: -5, newPerMonth: "x" } });
  const p2 = await repo.get("proposals", proposta_id);
  assert.equal(p2.state.cloneCount, 300);
  assert.equal(p2.state.newPerMonth, 15);
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

// ── Versão pro cliente: uma proposta por oferta ─────────────────────────────
// O deck é de apresentação (preço no comando do closer, ofertas 2/3 secretas).
// Mandar pro cliente cria uma proposta própria por oferta, já visível e sem
// edição — ver shareProposalOffer.
const LADDER = {
  ...TEMPLATE,
  id: "pt_ladder",
  slides: [
    TEMPLATE.slides[0],
    {
      key: "investimento", type: "pricing", title: "Investimento",
      revealPrice: true, planTag: "ANUAL", price: "7.188", per: "no ano", cycles: "12x de 599/mês",
      sub: "só no anual", currency: false,
      benefitGroups: [{ title: "O motor", items: ["Clonagem ilimitada"], synth: "economia" }],
      offer2: { planTag: "SEMESTRAL", price: "3.588", per: "no semestre", cycles: "12x de 299/mês", currency: false },
      offer3: { planTag: "SERVIÇO ÚNICO", price: "1.788", per: "à vista", cycles: "12x de 149/mês", currency: false },
      // 4º degrau (Shift+3): oferta de OUTRO escopo, com o recorte no `sub` —
      // a lista de benefícios é do slide e não troca por oferta.
      offer4: { planTag: "OEM SEMESTRAL", price: "2.688", per: "no semestre", cycles: "12x de 224/mês", currency: false, sub: "só o OEM · 100 SKUs por mês" },
      acceptLabel: "Aceitar proposta",
    },
  ],
};

async function buildLadder() {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds", funnel: [{ stage: "Inbox" }, { stage: "Config + Kickoff" }] });
  await repo.create("proposal_templates", { ...LADDER });
  await repo.create("leads", { ...LEAD, id: "le_share" });
  const app = Fastify();
  registerRoutes(app, repo);
  await app.inject({ method: "POST", url: "/api/leads/le_share/proposal?auto=1" });
  return { app, repo };
}

test("proposal-offers: lista a oferta principal + as secretas da escada", async () => {
  const { app } = await buildLadder();
  const body = (await app.inject({ url: "/api/leads/le_share/proposal-offers" })).json();
  assert.deepEqual(body.offers.map((o) => [o.offer, o.label, o.price]), [
    [1, "ANUAL", "7.188"],
    [2, "SEMESTRAL", "3.588"],
    [3, "SERVIÇO ÚNICO", "1.788"],
    [4, "OEM SEMESTRAL", "2.688"],
  ]);

  // lead sem proposta gerada não quebra: devolve lista vazia
  const { app: app2, repo } = await buildLadder();
  await repo.create("leads", { id: "le_sem", saas: "leverads", name: "Zé" });
  assert.deepEqual((await app2.inject({ url: "/api/leads/le_sem/proposal-offers" })).json(), { proposal: null, offers: [] });
  assert.equal((await app2.inject({ url: "/api/leads/nope/proposal-offers" })).statusCode, 404);
  await app.close(); await app2.close();
});

test("proposal-share: oferta secreta vira proposta própria, visível e sem edição", async () => {
  const { app, repo } = await buildLadder();
  const parentId = (await repo.get("leads", "le_share")).proposta_id;

  const res = await app.inject({ method: "POST", url: "/api/leads/le_share/proposal-share", payload: { offer: 2 } });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.offer, 2);
  assert.equal(body.label, "SEMESTRAL");
  assert.notEqual(body.id, parentId);          // proposta PRÓPRIA, link separado
  assert.match(body.url, new RegExp(`/p/${body.id}$`));

  const shared = await repo.get("proposals", body.id);
  assert.equal(shared.showAll, true);           // nada espera comando do closer
  assert.equal(shared.editKey, "");             // link nunca abre a edição
  assert.equal(shared.sharedFrom, parentId);
  assert.equal(shared.lead, "le_share");
  assert.equal(shared.acceptStage, "Config + Kickoff"); // aceite continua valendo

  const price = shared.slides.find((s) => s.type === "pricing");
  assert.equal(price.planTag, "SEMESTRAL");     // secreta promovida a principal
  assert.equal(price.price, "3.588");
  assert.equal(price.cycles, "12x de 299/mês");
  assert.equal(price.sub, undefined);           // campo que a oferta 2 não define não sobra da 1
  assert.equal(price.offer2, undefined);        // escada de negociação não vai pro cliente
  assert.equal(price.offer3, undefined);
  assert.deepEqual(price.benefitGroups, LADDER.slides[1].benefitGroups); // resto do slide intacto

  // a proposta MÃE segue de apresentação (com escada e chave de edição)
  const parent = await repo.get("proposals", parentId);
  assert.ok(parent.editKey.length >= 16);
  assert.equal(parent.slides.find((s) => s.type === "pricing").offer2.planTag, "SEMESTRAL");
  assert.ok(!parent.showAll);

  // timeline registra qual oferta foi enviada
  const acts = (await repo.list("activities")).filter((a) => a.meta?.event === "proposal_shared");
  assert.equal(acts.length, 1);
  assert.equal(acts[0].meta.offer, 2);
  assert.equal(acts[0].lead, "le_share");
  await app.close();
});

test("proposal-share: mesma oferta reusa o link (re-snapshot); outra oferta é outro link", async () => {
  const { app, repo } = await buildLadder();
  const first = (await app.inject({ method: "POST", url: "/api/leads/le_share/proposal-share", payload: { offer: 3 } })).json();

  // deck corrigido depois do envio: re-compartilhar atualiza o MESMO link
  const parentId = (await repo.get("leads", "le_share")).proposta_id;
  const parent = await repo.get("proposals", parentId);
  const slides = parent.slides.map((s) => (s.type === "pricing" ? { ...s, offer3: { ...s.offer3, price: "1.999" } } : s));
  await repo.update("proposals", parentId, { slides });

  const again = (await app.inject({ method: "POST", url: "/api/leads/le_share/proposal-share", payload: { offer: 3 } })).json();
  assert.equal(again.id, first.id);
  assert.equal((await repo.get("proposals", first.id)).slides.find((s) => s.type === "pricing").price, "1.999");

  const other = (await app.inject({ method: "POST", url: "/api/leads/le_share/proposal-share", payload: { offer: 1 } })).json();
  assert.notEqual(other.id, first.id);
  assert.equal((await repo.get("proposals", other.id)).slides.find((s) => s.type === "pricing").planTag, "ANUAL");

  // oferta fora da escada e lead sem proposta são 400
  assert.equal((await app.inject({ method: "POST", url: "/api/leads/le_share/proposal-share", payload: { offer: 9 } })).statusCode, 400);
  await repo.create("leads", { id: "le_nada", saas: "leverads", name: "Zé" });
  assert.equal((await app.inject({ method: "POST", url: "/api/leads/le_nada/proposal-share", payload: { offer: 1 } })).statusCode, 400);
  await app.close();
});

test("página da proposta compartilhada: showAll no payload e ?k não abre edição", async () => {
  const { app } = await buildLadder();
  const shared = (await app.inject({ method: "POST", url: "/api/leads/le_share/proposal-share", payload: { offer: 2 } })).json();

  const page = await app.inject({ url: `/p/${shared.id}` });
  assert.equal(page.statusCode, 200);
  assert.match(page.body, /"showAll":true/);
  assert.match(page.body, /"editable":false/);
  // sem editKey, chute de chave (inclusive vazia) não vira modo closer
  assert.match((await app.inject({ url: `/p/${shared.id}?k=` })).body, /"editable":false/);
  assert.match((await app.inject({ url: `/p/${shared.id}?k=qualquer` })).body, /"editable":false/);
  await app.close();
});

test("escada de 4 degraus: a 4ª oferta entra na lista e vira link do cliente", async () => {
  const { app, repo } = await buildLadder();
  const lead = (await app.inject({ method: "POST", url: "/api/leads", payload: { name: "Higor", saas: "leverads" } })).json();
  await app.inject({ method: "POST", url: `/api/leads/${lead.id}/proposal`, payload: {} });

  const offers = (await app.inject({ method: "GET", url: `/api/leads/${lead.id}/proposal-offers` })).json().offers;
  assert.deepEqual(offers.map((o) => o.offer), [1, 2, 3, 4]);
  assert.equal(offers[3].label, "OEM SEMESTRAL");
  assert.equal(offers[3].price, "2.688");

  const res = await app.inject({ method: "POST", url: `/api/leads/${lead.id}/proposal-share`, payload: { offer: 4 } });
  assert.equal(res.statusCode, 200);
  const shared = await repo.get("proposals", res.json().id);
  const pricing = shared.slides.find((s) => s.type === "pricing");
  // A 4ª virou a principal…
  assert.equal(pricing.price, "2.688");
  assert.equal(pricing.planTag, "OEM SEMESTRAL");
  assert.equal(pricing.sub, "só o OEM · 100 SKUs por mês");
  // …e a escada inteira sumiu do que o cliente recebe.
  assert.equal(pricing.offer2, undefined);
  assert.equal(pricing.offer3, undefined);
  assert.equal(pricing.offer4, undefined);
  assert.equal(shared.showAll, true);
});

test("escada de 4: oferta inexistente é recusada em vez de cair na principal", async () => {
  const { app } = await buildLadder();
  const lead = (await app.inject({ method: "POST", url: "/api/leads", payload: { name: "Higor", saas: "leverads" } })).json();
  await app.inject({ method: "POST", url: `/api/leads/${lead.id}/proposal`, payload: {} });
  const res = await app.inject({ method: "POST", url: `/api/leads/${lead.id}/proposal-share`, payload: { offer: 5 } });
  assert.notEqual(res.statusCode, 200); // mandar preço errado é pior que falhar
});
