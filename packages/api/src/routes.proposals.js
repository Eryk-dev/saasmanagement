// Rotas públicas do proposal builder nativo. Tudo aqui fica FORA da exigência de
// API key (ver OPEN em index.js): página /p/:id, aceite e o PATCH do closer
// (autenticado pelo editKey opaco da proposta, via ?k / body.k).
//
// Tracking de visualização: cada GET /p/:id SEM o editKey conta uma view
// (closer abrindo o próprio link de edição não infla o número).

import { publicProposal, syncProposalLeadSnapshot } from "./proposal.js";
import { applyCatalog, catalogAmount, catalogUI, oemCotasOf } from "./proposal-catalog.js";
import { proposalPageHtml } from "./proposal-page.js";
import { leveradsResults } from "./leverads-results.js";
import { makeRateLimiter } from "./forms.js";
import { convertWonLead } from "./routes.js";
import { logActivity, applyStageMove } from "./lead-flow.js";
import { gradeBandKnown } from "./routes.marketing.js";

// Proposta "fake" a partir de um template + dados de exemplo — usada pelo
// preview do builder (iframe) e pela página /p/t/:id (preview em aba).
// Deck do produto ativo + payload da tela zero: o transform roda ao SERVIR (o
// snapshot no banco segue genérico); o card de decisão (catalogUI) só entra no
// modo closer. Sem catálogo, tudo passa intacto.
function renderProposal(p, { editable = false, previewBanner = false } = {}) {
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

function previewFromTemplate(t, { data, state, answers } = {}) {
  return {
    id: "preview",
    name: t.name || "Proposta",
    theme: t.theme || {},
    slides: t.slides || [],
    calc: t.calc || {},
    data: data || {
      lead: { name: "Ana Souza", firstName: "Ana", company: "Empresa Exemplo", email: "ana@exemplo.com", phone: "(11) 98765-4321", amount: 0 },
      answers: answers || {},
    },
    state: state || {
      accounts: Object.keys(t.calc?.seatsMap || {})[0] || "",
      seats: Number((t.calc?.seatsMap || {})[Object.keys(t.calc?.seatsMap || {})[0]]) || t.calc?.plans?.[t.calc?.defaultCycle]?.included || 2,
      volume: Object.keys(t.calc?.volumeMid || {})[0] || "",
      cycle: t.calc?.defaultCycle || "monthly",
      customPriceCents: 0,
      validUntil: new Date(Date.now() + 7 * 86400_000).toLocaleDateString("pt-BR"),
      frozen: false,
    },
    accepted: false,
  };
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
    if (typeof q.product === "string") fake.state.product = q.product.slice(0, 20);
    if (typeof q.pain === "string") fake.state.pain = q.pain.slice(0, 8);
    if (q.oem === "1") fake.state.oem = true;
    if (typeof q.oemCota === "string") fake.state.oemCota = Number(q.oemCota) || 0;
    if (typeof q.order === "string") fake.state.deckOrder = q.order.toUpperCase() === "B" ? "B" : "";
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
    if (editable) p = await syncProposalLeadSnapshot(repo, p);
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
    // no-store: sem isso o navegador reusa HTML antigo por cache heurístico e o
    // closer apresenta uma versão velha do deck (re-snapshots são frequentes).
    return reply.type("text/html").header("cache-control", "no-store").send(renderProposal(p, { editable }));
  });

  // Painel do closer: só os campos de estado, só com o editKey certo.
  app.patch("/public/proposals/:id", async (req, reply) => {
    const p = await repo.get("proposals", req.params.id);
    if (!p) return reply.code(404).send({ error: "Not found" });
    const body = req.body && typeof req.body === "object" ? req.body : {};
    if (!body.k || body.k !== p.editKey) return reply.code(401).send({ error: "Unauthorized" });
    const state = { ...(p.state || {}) };
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
    // Camada de produto (catálogo): o select "Apresentar" da tela zero. Vazio =
    // seguir a sugestão da régua; produto fora do catálogo não entra.
    const catalogProducts = (p.calc && p.calc.catalog && p.calc.catalog.products) || {};
    if (typeof body.product === "string" && (body.product === "" || catalogProducts[body.product])) state.product = body.product;
    if (typeof body.pain === "string") state.pain = body.pain.slice(0, 8);
    if (typeof body.oem === "boolean") state.oem = body.oem;
    // Cota do OEM avulso (select da tela zero): só cota do leque do catálogo
    // entra; vazio ou fora do leque = volta a seguir o porte da régua.
    if (body.oemCota !== undefined) {
      const cota = Number(body.oemCota) || 0;
      state.oemCota = oemCotasOf(catalogProducts).includes(cota) ? cota : "";
    }
    // Ordem da apresentação (teste A/B da tela zero): A = padrão, B = beta.
    if (typeof body.deckOrder === "string") state.deckOrder = body.deckOrder.toUpperCase() === "B" ? "B" : "";

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
    // dor, régua, cota OEM), o valor do lead recalcula pelo preço do produto
    // ativo. Negócio já fechado (planClosed/wonAt) tem valor de venda — não mexe.
    const amount = catalogAmount(updated);
    if (amount > 0 && p.lead) {
      try {
        const lead = await repo.get("leads", p.lead);
        if (lead && !lead.planClosed && !lead.wonAt && Number(lead.amount) !== amount) leadPatch.amount = amount;
      } catch { /* fail-open */ }
    }
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

  // Preview autenticado pro builder (rota /api → exige key): recebe o template
  // (rascunho) + dados de exemplo e devolve o MESMO HTML da página pública.
  app.post("/api/proposals/preview", async (req, reply) => {
    const body = req.body && typeof req.body === "object" ? req.body : null;
    if (!body || typeof body.template !== "object") return reply.code(400).send({ error: "JSON body { template, data? } required" });
    const fake = previewFromTemplate(body.template, { data: body.data, state: body.state, answers: body.answers });
    return { html: proposalPageHtml(publicProposal(fake, { editable: false })) };
  });
}
