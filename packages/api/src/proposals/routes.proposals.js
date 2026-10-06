// Rotas públicas do proposal builder nativo. Tudo aqui fica FORA da exigência de
// API key (ver OPEN em index.js): página /p/:id, aceite e o PATCH do closer
// (autenticado pelo editKey opaco da proposta, via ?k / body.k).
//
// Tracking de visualização: cada GET /p/:id SEM o editKey conta uma view
// (closer abrindo o próprio link de edição não infla o número).

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { publicProposal, syncProposalLeadSnapshot, syncProposalCatalog, deckConfigState, leadAmountPatch } from "./proposal.js";
import { pickCases, publicCase } from "./cases.js";
import { applyCatalog, catalogAmount, catalogUI, activeProduct } from "./proposal-catalog.js";
import { proposalPageHtml } from "./proposal-page.js";
import { proposalSlidesPageHtml, deckConfig, calcOferta, slimCatalog } from "./proposal-slides-page.js";
import { proposalOemPageHtml, deckOemConfig, calcOem, OEM_PRINTS_BASE } from "./proposal-oem-page.js";
import { leveradsResults, leveradsPresentationResults } from "../customers/leverads-results.js";
import { liveDeckCases } from "./cases-live.js";
import { makeRateLimiter } from "../forms/forms.js";
import { convertWonLead } from "../crm/won-lead.js";
import { logActivity, applyStageMove } from "../crm/lead-flow.js";
import { gradeBandKnown } from "../metrics/metrics-core.js";

// Proposta "fake" a partir de um template + dados de exemplo — usada pelo
// preview do builder (iframe) e pela página /p/t/:id (preview em aba).
// Deck do produto ativo + payload da tela zero: o transform roda ao SERVIR (o
// snapshot no banco segue genérico); o card de decisão (catalogUI) só entra no
// modo closer. Sem catálogo, tudo passa intacto.
function renderProposal(p, { editable = false, previewBanner = false, configOnly = false } = {}) {
  // Opção C (12/09): apresentação em SLIDES. Outro renderer, mesma proposta —
  // as views, o aceite e o editKey continuam da rota. O catálogo vai como
  // argumento (publicProposal não expõe a tabela de preço ao navegador; aqui
  // ela só chega na página no modo closer, pra tela zero calcular ao vivo).
  // Criação de anúncios por OEM (28/09): serviço avulso, deck próprio, e a
  // única coisa configurável é quantidade × valor por anúncio. Sem catálogo:
  // nada aqui lê tabela de preço.
  if (p.layout === "oem") {
    return proposalOemPageHtml(publicProposal(p, { editable }), { editable, previewBanner, configOnly });
  }
  if (p.layout === "slides") {
    return proposalSlidesPageHtml(publicProposal(p, { editable }), {
      editable, previewBanner, configOnly,
      catalog: (p.calc && p.calc.catalog) || null,
      suggested: activeProduct(p),
      results: !p.saas || p.saas === "leverads" ? leveradsPresentationResults() : null,
    });
  }
  const transformed = applyCatalog(p);
  const pv = publicProposal(transformed ? { ...p, slides: transformed.slides } : p, { editable });
  // Resultado real dos clientes no slide `impacto`, como tokens {{calc.res*}}.
  // Vem do cache em memória (leverads-results.js): a página nunca espera a
  // consulta, e enquanto não houver número o deck usa o literal do fallback.
  // Sem filtro por saas de propósito: o custo é uma leitura de objeto, e deck
  // que não usa os tokens simplesmente os ignora.
  const results = leveradsResults();
  if (results) pv.calc = { ...pv.calc, ...results };
  if (editable) {
    const ui = catalogUI(p);
    if (ui) pv.catalogUI = ui;
  }
  return proposalPageHtml(pv, { previewBanner });
}

// Proposta servida com os cases de HOJE: quem está publicado agora, pela régua
// de nicho/ordem de sempre, com os números refeitos no painel. Nunca lança:
// qualquer tropeço devolve a proposta como está no banco, e sem case publicado
// nenhum fica o que foi congelado no snapshot.
async function withLiveCases(repo, p) {
  const cases = p?.data?.cases;
  if (!Array.isArray(cases)) return p;
  try {
    const vivos = await liveDeckCases(repo, { niche: p?.data?.answers?.niche || "", limit: 4 });
    if (!vivos?.length) return p;
    return { ...p, data: { ...p.data, cases: vivos } };
  } catch { return p; }
}

function previewFromTemplate(t, { data, state, answers, cases } = {}) {
  return {
    id: "preview",
    saas: t.saas || "",
    name: t.name || "Proposta",
    layout: t.layout || "",
    theme: t.theme || {},
    slides: t.slides || [],
    calc: t.calc || {},
    data: data || {
      lead: { name: "Ana Souza", firstName: "Ana", company: "Empresa Exemplo", email: "ana@exemplo.com", phone: "(11) 98765-4321", amount: 0 },
      answers: answers || {},
      cases: cases || [],
    },
    // O state recebido MESCLA com os padrões (a tela zero manda só o bloco dela;
    // o resto do estado continua valendo pros decks campo a campo).
    state: { ...(state || {}), ...({
      accounts: Object.keys(t.calc?.seatsMap || {})[0] || "",
      seats: Number((t.calc?.seatsMap || {})[Object.keys(t.calc?.seatsMap || {})[0]]) || t.calc?.plans?.[t.calc?.defaultCycle]?.included || 2,
      volume: Object.keys(t.calc?.volumeMid || {})[0] || "",
      cycle: t.calc?.defaultCycle || "monthly",
      customPriceCents: 0,
      validUntil: new Date(Date.now() + 7 * 86400_000).toLocaleDateString("pt-BR"),
      frozen: false,
    }), ...(state || {}) },
    accepted: false,
  };
}

// Prévia PREENCHIDA (tela de Propostas → "prévia rápida"): os campos da tela
// zero chegam pela query e viram o estado do deck. Nada aqui valida: quem
// sanea é o MESMO deckConfig/deckOemConfig que monta a tela no runtime, então
// lixo na URL vira o padrão em vez de quebrar a página. Só a conversão de
// booleano precisa ser feita aqui: "false" na query é string, e string é
// verdadeira.
const DECK_SLIDES_KEYS = ["nome", "empresa", "contas", "pedidos", "ticket", "vistaPct", "plataforma", "linha", "tier", "price", "priceTier", "oem", "oemPack", "periodo"];
const DECK_OEM_KEYS = ["nome", "empresa", "qtd", "valor"];
function deckFromQuery(q, keys) {
  const out = {};
  let algum = false;
  for (const k of keys) {
    if (q[k] === undefined) continue;
    const v = String(q[k]);
    out[k] = v === "true" ? true : v === "false" ? false : v;
    algum = true;
  }
  return algum ? out : null;
}

export function registerProposalRoutes(app, repo, opts = {}) {
  const discord = opts.discord; // injetado por routes.js (fail-open, pode faltar em teste direto)
  const allow = makeRateLimiter({
    limit: opts.rateLimit ?? Number(process.env.PROPOSAL_RATE_LIMIT || 30),
    windowMs: opts.rateWindowMs ?? 60_000,
  });
  const clientIp = (req) =>
    String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.ip || "?";
  // Dispositivo aproximado a partir do user-agent (sem lib): celular/computador +
  // sistema + navegador. Só pra dar contexto de QUEM abriu (não identifica pessoa).
  const deviceFromUA = (ua) => {
    if (!ua) return "desconhecido";
    const mobile = /Mobile|Android|iPhone|iPad|iPod/i.test(ua);
    const os = /iPhone|iPad|iPod/i.test(ua) ? "iPhone/iPad" : /Android/i.test(ua) ? "Android"
      : /Windows/i.test(ua) ? "Windows" : /Mac OS X|Macintosh/i.test(ua) ? "Mac" : /Linux/i.test(ua) ? "Linux" : "";
    const browser = /Edg\//i.test(ua) ? "Edge" : /OPR\/|Opera/i.test(ua) ? "Opera" : /Chrome\//i.test(ua) ? "Chrome"
      : /Firefox\//i.test(ua) ? "Firefox" : /Safari\//i.test(ua) ? "Safari" : "";
    return [mobile ? "celular" : "computador", os, browser].filter(Boolean).join(" · ");
  };

  // ── Prints do deck de criação de anúncios ────────────────────────────────
  // Os prints do anúncio padrão (packages/api/src/assets/deck-oem) saem pela
  // PRÓPRIA API: em produção é a mesma origem da página /p/:id (o nginx manda
  // /public/ pra cá), então o deck não depende de bucket externo nem de deploy
  // do front. Nome na lista branca e leitura direta da pasta — nunca caminho
  // montado com o que veio na URL.
  const DECK_OEM_DIR = fileURLToPath(new URL("../assets/deck-oem/", import.meta.url));
  const MIME_PRINT = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };
  app.get(OEM_PRINTS_BASE + ":file", async (req, reply) => {
    const nome = String(req.params.file || "");
    const m = /^[a-z0-9][a-z0-9-]{0,39}\.(jpg|jpeg|png|webp)$/.exec(nome);
    if (!m) return reply.code(404).send({ error: "Not found" });
    let buf;
    try {
      buf = await readFile(DECK_OEM_DIR + nome);
    } catch {
      // Print que ainda não subiu vira espaço reservado na página (a própria
      // apresentação trata o erro), então 404 aqui é estado esperado.
      return reply.code(404).send({ error: "Not found" });
    }
    return reply.type(MIME_PRINT[m[1]]).header("cache-control", "public, max-age=604800").send(buf);
  });

  // Preview do TEMPLATE em aba própria (dados de exemplo, nada persiste).
  // Funciona pra rascunho também — é ferramenta do dono, id é opaco.
  app.get("/p/t/:id", async (req, reply) => {
    const t = await repo.get("proposal_templates", req.params.id);
    if (!t) {
      return reply.code(404).type("text/html").send("<!doctype html><meta charset=utf-8><title>404</title><p style='font-family:system-ui;padding:40px'>Template não encontrado.</p>");
    }
    // editable: o preview roda o modo closer em demonstração — tela zero (setup)
    // antes da capa + edição ao vivo, sem salvar nada (a página detecta o id
    // "preview" e desliga o auto-save). Assim dá pra testar o deck inteiro,
    // inclusive o preço calculado do Starter, sem gerar proposta.
    const fake = previewFromTemplate(t);
    // Sem proposta pra salvar, a tela zero do catálogo simula via QUERY: cada
    // mudança recarrega com ?accounts=…&product=… e o estado nasce daqui.
    const q = req.query || {};
    if (typeof q.accounts === "string" && (t.calc?.seatsMap || {})[q.accounts] != null) {
      fake.state.accounts = q.accounts;
      fake.state.seats = Number(t.calc.seatsMap[q.accounts]);
    }
    if (typeof q.volume === "string" && (t.calc?.volumeMid || {})[q.volume] != null) fake.state.volume = q.volume;
    if (typeof q.niche === "string" && q.niche) fake.data.answers.niche = q.niche.slice(0, 40);
    // Preview usa a mesma seleção das novas propostas: só autopeças no deck C
    // de LeverAds, nicho da query nos outros decks.
    try {
      const autopecas = t.layout === "slides" && t.saas === "leverads";
      fake.data.cases = pickCases(await repo.list("cases"), { niche: autopecas ? "autopecas" : fake.data.answers.niche || "", strictNiche: autopecas, limit: 4 }).map(publicCase);
    } catch { fake.data.cases = []; }
    if (typeof q.product === "string") fake.state.product = q.product.slice(0, 20);
    if (typeof q.pain === "string") fake.state.pain = q.pain.slice(0, 8);
    if (q.oem === "1") fake.state.oem = true;
    if (typeof q.desc === "string") fake.state.discountPct = Math.min(15, Math.max(0, Math.round(Number(q.desc) || 0)));
    if (typeof q.order === "string") fake.state.deckOrder = q.order.toUpperCase() === "B" ? "B" : "";
    if (typeof q.dores === "string") fake.state.dores = q.dores.split("|").map((d) => d.slice(0, 120)).filter(Boolean).slice(0, 12);
    // Tela zero preenchida pela query (prévia rápida da tela de Propostas).
    const cfgQuery = t.layout === "oem" ? deckFromQuery(q, DECK_OEM_KEYS)
      : t.layout === "slides" ? deckFromQuery(q, DECK_SLIDES_KEYS) : null;
    if (cfgQuery) {
      if (t.layout === "oem") fake.state.deckOem = cfgQuery;
      else fake.state.deckC = cfgQuery;
      // O nome e a empresa também vão pro "lead" da prévia: é deles que saem os
      // padrões quando o campo da tela zero fica em branco.
      if (typeof q.nome === "string" && q.nome.trim()) {
        fake.data.lead.name = q.nome.slice(0, 60);
        fake.data.lead.firstName = fake.data.lead.name.trim().split(/\s+/)[0] || "";
      }
      if (typeof q.empresa === "string" && q.empresa.trim()) fake.data.lead.company = q.empresa.slice(0, 80);
    }
    return reply.type("text/html").header("cache-control", "no-store").send(renderProposal(fake, { editable: true, previewBanner: true }));
  });

  app.get("/p/:id", async (req, reply) => {
    let p = await repo.get("proposals", req.params.id);
    if (!p) {
      return reply.code(404).type("text/html").send("<!doctype html><meta charset=utf-8><title>404</title><p style='font-family:system-ui;padding:40px'>Proposta não encontrada.</p>");
    }
    const editable = !!req.query.k && req.query.k === p.editKey;
    // O link de apresentação pode ter sido gerado antes de o SDR preencher a
    // empresa. Reabre sempre com os dados atuais e recupera a dor dos snapshots
    // antigos, sem mexer no deck nem em escolhas manuais do closer.
    if (editable) p = await syncProposalCatalog(repo, await syncProposalLeadSnapshot(repo, p));
    if (!editable) {
      // QUEM abriu: link aberto de DENTRO do cockpit (?from=cockpit ou referer do
      // cockpit) é do TIME (SDR/closer conferindo), não é o cliente. Aberturas do
      // time NÃO contam como "cliente abriu", não alertam e não consomem a 1ª view.
      const ref = String(req.headers["referer"] || "");
      const internal = req.query.from === "cockpit" || /levermoney\.com\.br|localhost/i.test(ref);
      const viewer = internal ? "time" : "cliente";
      const device = deviceFromUA(String(req.headers["user-agent"] || ""));
      const ip = clientIp(req);
      const at = new Date().toISOString();
      // Log de aberturas na PRÓPRIA proposta (todas, com quem/dispositivo), capado.
      const viewLog = [...(Array.isArray(p.viewLog) ? p.viewLog : []), { at, viewer, device, ip }].slice(-30);

      if (internal) {
        try { await repo.update("proposals", p.id, { viewLog }); } catch { /* ignore */ }
      } else {
        const firstView = !(Number(p.views) > 0);
        try {
          await repo.update("proposals", p.id, { views: (Number(p.views) || 0) + 1, lastViewedAt: at, viewLog });
        } catch { /* ignore */ }
        // Timeline + Discord só na PRIMEIRA visualização do CLIENTE (re-aberturas
        // não spamam); closer abrindo com ?k ou ?from=cockpit não passa por aqui.
        if (firstView) {
          try {
            await logActivity(repo, {
              saas: p.saas || "", lead: p.lead || "", type: "system",
              meta: { event: "proposal_viewed", proposal: p.id, viewer, device, ip }, author: "lead",
            });
          } catch { /* timeline é best-effort */ }
          if (discord?.configured()) {
            const lead = p.lead ? await repo.get("leads", p.lead) : null;
            await discord.proposalViewed({ proposal: p, lead: lead || {} });
          }
        }
      }
    }
    // Cases de hoje no slide 06 (cases-live.js): a lista vem do que está
    // publicado agora e os números do painel. Mesmo fail-open do resto — sem
    // case publicado ou sem banco, vale o que foi congelado no snapshot.
    p = await withLiveCases(repo, p);
    // no-store: sem isso o navegador reusa HTML antigo por cache heurístico e o
    // closer apresenta uma versão velha do deck (re-snapshots são frequentes).
    return reply.type("text/html").header("cache-control", "no-store").send(renderProposal(p, { editable, configOnly: editable && req.query.embed === "config" }));
  });

  // Painel do closer: só os campos de estado, só com o editKey certo.
  app.patch("/public/proposals/:id", async (req, reply) => {
    let p = await repo.get("proposals", req.params.id);
    if (!p) return reply.code(404).send({ error: "Not found" });
    const body = req.body && typeof req.body === "object" ? req.body : {};
    if (!body.k || body.k !== p.editKey) return reply.code(401).send({ error: "Unauthorized" });
    // A tela zero salva contra os planos de hoje (a mesma tabela que ela mostrou).
    if (body.deckC && typeof body.deckC === "object") p = await syncProposalCatalog(repo, p);
    let state = { ...(p.state || {}) };
    if (Number.isFinite(Number(body.seats)) && Number(body.seats) >= 1) state.seats = Number(body.seats);
    if (typeof body.volume === "string") state.volume = body.volume;
    if (["monthly", "quarterly", "semiannual", "annual"].includes(body.cycle)) state.cycle = body.cycle;
    if (Number.isFinite(Number(body.customPriceCents)) && Number(body.customPriceCents) >= 0) state.customPriceCents = Number(body.customPriceCents);
    if (typeof body.validUntil === "string") state.validUntil = body.validUntil.slice(0, 20);
    if (typeof body.frozen === "boolean") state.frozen = body.frozen;
    // Números do deck Starter (preço por clone): setados na tela zero do closer.
    if (Number.isFinite(Number(body.cloneCount)) && Number(body.cloneCount) >= 0) state.cloneCount = Math.round(Number(body.cloneCount));
    if (Number.isFinite(Number(body.newPerMonth)) && Number(body.newPerMonth) >= 0) state.newPerMonth = Math.round(Number(body.newPerMonth));
    // A FAIXA de contas é autoritativa: deriva os assentos do topo da faixa via o
    // seatsMap do snapshot (faixa → nº de contas usado na fórmula de preço/custo).
    const seatsMap = (p.calc && p.calc.seatsMap) || {};
    if (typeof body.accounts === "string" && seatsMap[body.accounts] != null) {
      state.accounts = body.accounts;
      state.seats = Number(seatsMap[body.accounts]);
    }
    const catalogProducts = (p.calc && p.calc.catalog && p.calc.catalog.products) || {};
    // Tela zero do deck de SLIDES (opção C): chega um objeto só, saneado pelo
    // mesmo deckConfig que monta a tela (corta texto, arredonda número, valida
    // linha/pacote). O produto escolhido vira `state.product` e o período vira
    // `state.cycle` — é o que o resto do cockpit lê (valor do lead, gate de
    // Ganho, link de pagamento), então a opção C não cria um mundo paralelo.
    if (body.deckC && typeof body.deckC === "object") state = deckConfigState(p, state, body.deckC);
    // Tela zero do deck de CRIAÇÃO DE ANÚNCIOS (OEM): dois números, saneados
    // pelo mesmo deckOemConfig que monta a tela. Não mexe em state.product nem
    // em state.cycle — este deck não vende plano, vende lote de anúncio.
    if (body.deckOem && typeof body.deckOem === "object") {
      state.deckOem = deckOemConfig({ state: { deckOem: body.deckOem }, data: p.data });
    }
    // Camada de produto (catálogo): o select "Apresentar" da tela zero. Vazio =
    // seguir a sugestão da régua; produto fora do catálogo não entra.
    if (typeof body.product === "string" && (body.product === "" || catalogProducts[body.product])) state.product = body.product;
    if (typeof body.pain === "string") state.pain = body.pain.slice(0, 8);
    if (typeof body.oem === "boolean") state.oem = body.oem;
    // Ordem da apresentação (teste A/B da tela zero): A = padrão, B = beta.
    if (typeof body.deckOrder === "string") state.deckOrder = body.deckOrder.toUpperCase() === "B" ? "B" : "";
    // Desconto da negociação (tela zero): inteiro de 0 a 15%, fora disso clampa.
    if (body.discountPct !== undefined) {
      state.discountPct = Math.min(15, Math.max(0, Math.round(Number(body.discountPct) || 0)));
    }
    // Dores anotadas pelo closer na tela zero (texto livre, alimentam o recap
    // do roteiro): posições vazias ficam (a ordem dos campos importa na tela).
    if (Array.isArray(body.dores)) state.dores = body.dores.slice(0, 12).map((d) => String(d ?? "").slice(0, 120));

    // Campos de texto da capa (editados inline no modo closer): gravam no SNAPSHOT
    // da proposta e — porque o dado do lead costuma estar errado/incompleto — no
    // LEAD do pipeline também. Só o que muda entra no patch do lead (writeback).
    const data = { lead: { ...(p.data?.lead || {}) }, answers: { ...(p.data?.answers || {}) } };
    let dataChanged = false;
    const leadPatch = {};
    if (typeof body.company === "string" && body.company !== data.lead.company) {
      data.lead.company = body.company; leadPatch.company = body.company; dataChanged = true;
    }
    if (typeof body.name === "string" && body.name !== data.lead.name) {
      data.lead.name = body.name;
      data.lead.firstName = body.name.trim().split(/\s+/)[0] || "";
      leadPatch.name = body.name; dataChanged = true;
    }
    if (typeof body.niche === "string" && body.niche !== data.answers.niche) {
      data.answers.niche = body.niche; leadPatch.niche = body.niche; dataChanged = true;
    }
    // Contas × anúncios: a régua da tela zero é a nota REAL do cliente. O closer
    // confirma esses dois na call ("são 2 contas, não 3"), então o que ele
    // ajusta aqui vira a resposta do lead — senão a proposta apresenta um
    // cliente C e o card do pipeline segue mostrando B. Os nomes dos campos vêm
    // do template (seatsKey/volumeKey = accounts/listings na LeverAds) e só
    // valem se a faixa for uma que a régua entende.
    const seatsKey = p.calc && p.calc.seatsKey;
    const volumeKey = p.calc && p.calc.volumeKey;
    if (seatsKey && gradeBandKnown(seatsKey, state.accounts) && state.accounts !== data.answers[seatsKey]) {
      data.answers[seatsKey] = state.accounts; leadPatch[seatsKey] = state.accounts; dataChanged = true;
    }
    // Anúncios têm um porém: quando o lead não respondeu, o estado nasce na
    // PRIMEIRA faixa do volumeMid (fallback do initialState). Esse palpite não
    // pode virar resposta do lead, então ele é o único caso que não espelha.
    const volumeGuess = !data.answers[volumeKey] && state.volume === (Object.keys((p.calc && p.calc.volumeMid) || {})[0] || "");
    if (volumeKey && !volumeGuess && gradeBandKnown(volumeKey, state.volume) && state.volume !== data.answers[volumeKey]) {
      data.answers[volumeKey] = state.volume; leadPatch[volumeKey] = state.volume; dataChanged = true;
    }

    const patch = { state };
    if (dataChanged) patch.data = data;
    const updated = await repo.update("proposals", p.id, patch);
    // O card do pipeline acompanha a APRESENTAÇÃO: mexeu na tela zero (produto,
    // dor, régua), o valor do lead recalcula pelo preço do produto
    // ativo. Negócio já fechado (planClosed/wonAt) tem valor de venda — não mexe.
    // Valor do card: no deck de criação de anúncios é o lote (quantidade ×
    // valor por anúncio); nos outros, o preço do produto ativo do catálogo.
    const amount = p.layout === "oem" ? calcOem(state.deckOem || {}).total : catalogAmount(updated);
    Object.assign(leadPatch, await leadAmountPatch(repo, p, amount));
    // Writeback best-effort no lead (nunca derruba o save da proposta).
    if (Object.keys(leadPatch).length && p.lead) {
      try { await repo.update("leads", p.lead, leadPatch); } catch { /* fail-open */ }
    }
    return { ok: true, state: updated.state };
  });

  // Aceite do lead: marca a proposta + o lead; move o estágio se o template
  // definiu acceptStage e ele existir no funil do produto.
  app.post("/public/proposals/:id/accept", async (req, reply) => {
    if (!allow(clientIp(req))) return reply.code(429).send({ error: "Tente de novo em instantes." });
    const p = await repo.get("proposals", req.params.id);
    if (!p) return reply.code(404).send({ error: "Not found" });
    if (!p.accepted) {
      const acceptedAt = new Date().toISOString();
      await repo.update("proposals", p.id, { accepted: true, acceptedAt });
      const lead = p.lead ? await repo.get("leads", p.lead) : null;
      let movedStage = "";
      if (lead) {
        let patch = { proposalAccepted: true, proposalAcceptedAt: acceptedAt };
        if (p.acceptStage && p.acceptStage !== lead.stage) {
          const product = await repo.get("products", lead.saas);
          if ((product?.funnel || []).some((f) => f.stage === p.acceptStage)) {
            patch.stage = p.acceptStage;
            // Movimento canônico: recarimba stageSince, re-agenda GPS e loga a
            // activity `stage` — igual ao PATCH genérico (antes o aceite movia
            // por update cru e o contador "dias na etapa" não zerava).
            patch = { ...patch, ...(await applyStageMove(repo, { lead, toStage: p.acceptStage, patch, author: "lead" })) };
          }
        }
        const updated = await repo.update("leads", lead.id, patch);
        movedStage = patch.stage || "";
        // Se o acceptStage é o estágio de ganho, o cliente nasce aqui também
        // (antes só o PATCH genérico convertia). Idempotente e best-effort.
        if (patch.stage) { try { await convertWonLead(repo, updated, { metaCapi: opts.metaCapi }); } catch { /* fail-open */ } }
      }
      try {
        await logActivity(repo, {
          saas: p.saas || "", lead: p.lead || "", type: "system",
          meta: { event: "proposal_accepted", proposal: p.id, ...(movedStage ? { stage: movedStage } : {}) },
          author: "lead", at: acceptedAt,
        });
      } catch { /* timeline é best-effort */ }
      // Aviso no Discord (só no primeiro aceite — re-POST cai fora do if).
      if (discord?.configured()) {
        await discord.proposalAccepted({ proposal: p, lead: lead || {}, stage: movedStage });
      }
    }
    return { ok: true };
  });

  // ── Link avulso pro cliente ──────────────────────────────────────────────
  // A apresentação sem lead: o closer preenche os dados na tela de Propostas e
  // manda o link. É uma proposta DE VERDADE (conta view, aceita, aparece na
  // lista de geradas), só que sem card no pipeline — por isso `lead` vazio e
  // `acceptStage` vazio: sem lead não existe etapa pra mover.
  //
  // O link nasce como o do cliente: `editKey` vazio (nunca abre a tela zero),
  // `showAll` ligado e a oferta CONGELADA no snapshot, igual ao
  // shareProposalOffer. Mexer no template depois não muda o que o cliente já viu.
  app.post("/api/proposal_templates/:id/link", async (req, reply) => {
    const t = await repo.get("proposal_templates", req.params.id);
    if (!t) return reply.code(404).send({ error: "Template não encontrado" });
    if (t.layout !== "oem" && t.layout !== "slides") {
      return reply.code(422).send({ error: "Este deck não tem tela zero: gere a apresentação pelo card do lead." });
    }
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const entrada = body.config && typeof body.config === "object" ? body.config : {};
    const nome = String(entrada.nome || "").slice(0, 60);
    const empresa = String(entrada.empresa || "").slice(0, 80);
    const data = {
      lead: { name: nome, firstName: nome.trim().split(/\s+/)[0] || "", company: empresa },
      answers: {},
    };
    let state;
    if (t.layout === "oem") {
      const cfg = deckOemConfig({ state: { deckOem: entrada }, data });
      const oferta = calcOem(cfg);
      if (!oferta.configurado) return reply.code(422).send({ error: "Preencha a quantidade de anúncios e o valor de cada um antes de gerar o link." });
      state = { deckOem: cfg, deckOemOferta: oferta };
    } else {
      const cfg = deckConfig({ state: { deckC: entrada }, data }, { catalog: t.calc?.catalog || null });
      const oferta = calcOferta(slimCatalog(t.calc?.catalog || {}), cfg);
      if (!oferta.mensal) return reply.code(422).send({ error: "Monte o plano antes de gerar o link." });
      state = { deckC: cfg, deckOferta: oferta };
    }
    // A tabela de preço não viaja no snapshot (é dado do servidor), igual ao
    // link compartilhado de um lead.
    const { catalog: _catalog, ...calcSemCatalogo } = t.calc || {};
    const saved = await repo.create("proposals", {
      saas: t.saas || "",
      template: t.id,
      lead: "",
      name: t.name || "Proposta",
      theme: t.theme || {},
      layout: t.layout,
      calc: calcSemCatalogo,
      acceptStage: "",
      data,
      state,
      slides: [],
      showAll: true,
      standalone: true,
      editKey: "",
      views: 0,
      accepted: false,
      createdAt: new Date().toISOString(),
    });
    return { ok: true, id: saved.id };
  });

  // Preview autenticado pro builder (rota /api → exige key): recebe o template
  // (rascunho) + dados de exemplo e devolve o MESMO HTML da página pública.
  app.post("/api/proposals/preview", async (req, reply) => {
    const body = req.body && typeof req.body === "object" ? req.body : null;
    if (!body || typeof body.template !== "object") return reply.code(400).send({ error: "JSON body { template, data? } required" });
    const fake = previewFromTemplate(body.template, { data: body.data, state: body.state, answers: body.answers });
    // Mesmo caminho da página servida (renderProposal), e não o renderer antigo
    // na marra: a apresentação em slides é outro layout, e o preview do editor
    // mostrava uma página vazia pra ela. Deck de slides vai no modo closer —
    // é assim que ele é usado (tela zero + palco), e o id "preview" já desliga
    // o auto-save na página.
    return { html: renderProposal(fake, { editable: fake.layout === "slides" || fake.layout === "oem" }) };
  });
}
