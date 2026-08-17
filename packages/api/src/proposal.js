// Domínio do proposal builder NATIVO — provider 'native' do dispatcher de
// propostas (o outro provider é o Levercopy, em levercopy.js).
//
// Modelo (collections schemaless):
//   proposal_templates: { id, saas, name, status: "draft"|"published",
//     theme: { bg, surface, fg, accent, accentFg, font, radius, logoUrl, logoHeight },
//     slides: [{ key, type, ...campos do tipo,
//       showIf?: { key, values: [] },   // slide condicional por resposta do form
//       media?: { url, caption? } }],   // imagem/GIF/vídeo do slide (render no cliente)
//     calc: { salaryMonthly, workHours, minCopy, minCompatEdit, reworkPct,
//             netMargin, revenueUpliftPct, volumeMid: {faixa: número},
//             seatsKey, seatsMap: {resposta: número}, volumeKey,
//             plans: { monthly|quarterly|semiannual|annual: { base, included, extra } },
//             defaultCycle, maxSeats, validDays },
//     acceptStage }   // estágio do funil ao aceitar (opcional)
//
//   proposals (instância por lead — SNAPSHOT do template na geração):
//     { id, saas, template, lead, theme, slides, calc, acceptStage,
//       data: { lead: {name, firstName, company, email, phone}, answers },
//       state: { seats, volume, cycle, customPriceCents, validUntil, frozen },
//       editKey, views, lastViewedAt, accepted, acceptedAt, createdAt }
//
// Tipos de slide v1 (renderer em proposal-page.js):
//   hero · cards · receipt · steps · compare · bignum · pricing · closer · custom
//
// Interpolação ({{lead.x}}, {{answers.x}}, {{calc.x}}, {{state.x}}) e a
// calculadora rodam NO CLIENTE (proposal-page.js) — o painel do closer recalcula
// ao vivo, igual à proposta do Levercopy que serviu de referência.

import { randomBytes } from "node:crypto";
import { CYCLE_MONTHS } from "./billing.js";
import { hasCatalog, applyCatalog, catalogAmount } from "./proposal-catalog.js";
import { mentoriaAmount, mentoriaTemplateOf } from "./mentoria.js";
import { attributionPain, painCode } from "./attribution.js";

export const SLIDE_TYPES = ["hero", "cards", "receipt", "steps", "compare", "bignum", "pricing", "closer", "custom"];

// Campos do lead que NÃO são respostas de qualificação (ficam em data.lead ou fora).
const LEAD_CORE_KEYS = new Set([
  "id", "name", "saas", "email", "phone", "company", "source", "stage", "owner",
  "priority", "score", "icp", "value", "amount", "age", "reason", "flag", "form",
  "proposalUrl", "proposta_id", "proposal_edit_url", "proposalAccepted", "proposalAcceptedAt",
]);

export function splitLeadData(lead) {
  const answers = {};
  for (const [k, v] of Object.entries(lead || {})) {
    if (!LEAD_CORE_KEYS.has(k)) answers[k] = v;
  }
  const name = String(lead?.name || "");
  return {
    lead: {
      name,
      firstName: name.trim().split(/\s+/)[0] || "",
      company: lead?.company || "",
      email: lead?.email || "",
      phone: lead?.phone || "",
      amount: lead?.amount ?? 0,
    },
    answers,
  };
}

function validProposalPain(calc, raw) {
  const code = painCode(`[${String(raw || "").trim()}]`) || "";
  const pains = calc?.catalog?.pains;
  return code && (!pains || pains[code]) ? code : "";
}

// Atualiza os dados vivos que pertencem ao lead sem refazer o snapshot do deck.
// A proposta nasce junto com o envio do form, mas empresa costuma ser preenchida
// pelo SDR depois. A dor também podia faltar nos snapshots antigos porque antes
// era guardada só na submissão. O override manual da tela zero sempre vence.
export async function syncProposalLeadSnapshot(repo, proposal) {
  if (!proposal?.lead || proposal.sharedFrom) return proposal;
  const lead = await repo.get("leads", proposal.lead);
  if (!lead) return proposal;

  const data = {
    lead: { ...(proposal.data?.lead || {}) },
    answers: { ...(proposal.data?.answers || {}) },
  };
  const fresh = splitLeadData(lead);
  let dataChanged = false;
  for (const key of ["name", "firstName", "company", "email", "phone", "amount"]) {
    if (fresh.lead[key] !== data.lead[key]) {
      data.lead[key] = fresh.lead[key];
      dataChanged = true;
    }
  }
  // Mantém a origem junto do snapshot para auditoria e para um futuro reload
  // não depender novamente das tabelas de marketing.
  if (lead.sourcePain && lead.sourcePain !== data.answers.sourcePain) {
    data.answers.sourcePain = lead.sourcePain;
    dataChanged = true;
  }

  const state = { ...(proposal.state || {}) };
  let stateChanged = false;
  // "none" é escolha manual explícita; só a ausência real autoriza inferir.
  if (state.pain == null || state.pain === "") {
    let inferred = validProposalPain(proposal.calc, lead.sourcePain || data.answers.sourcePain);
    if (!inferred) {
      const submissions = await repo.listWhere("form_submissions", { lead: lead.id }, { fields: ["pain", "createdAt"] });
      const latest = submissions
        .filter((s) => s.pain)
        .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))[0];
      inferred = validProposalPain(proposal.calc, latest?.pain);
    }
    if (!inferred && lead.utm?.content) {
      const rows = await repo.listWhere("ad_insights", {
        adId: String(lead.utm.content),
        ...(lead.saas ? { saas: lead.saas } : {}),
      }, { fields: ["adName", "adsetName", "campaignName", "date"] });
      const latest = rows.sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")))[0];
      inferred = validProposalPain(proposal.calc, attributionPain(latest));
    }
    if (inferred) {
      state.pain = inferred;
      stateChanged = true;
    }
  }

  // A dor não muda mais o produto (a régua decide), mas o re-sync é a chance
  // de re-alinhar o card ao preço da apresentação se o valor driftou (edição
  // manual no drawer) — a menos que o negócio já tenha valor de fechamento
  // (planClosed/wonAt).
  if (stateChanged) {
    const amount = catalogAmount({ ...proposal, state, data });
    if (amount > 0 && !lead.planClosed && !lead.wonAt && Number(lead.amount) !== amount) {
      try {
        await repo.update("leads", lead.id, { amount });
        data.lead.amount = amount;
        dataChanged = true;
      } catch { /* fail-open: o sync do snapshot não pode cair por causa do card */ }
    }
  }

  if (!dataChanged && !stateChanged) return proposal;
  return (await repo.update("proposals", proposal.id, {
    ...(dataChanged ? { data } : {}),
    ...(stateChanged ? { state } : {}),
  })) || proposal;
}

// Slide condicional: showIf = { key, values } → entra no snapshot só se a
// resposta do lead (escalar ou multiselect/array) contiver um dos valores.
// Sem showIf (ou malformado) = sempre visível. Comparação case-insensitive.
export function slideVisible(slide, answers) {
  const cond = slide?.showIf;
  if (!cond || !String(cond.key || "").trim()) return true;
  const want = (Array.isArray(cond.values) ? cond.values : [cond.values])
    .filter((v) => v != null && String(v).trim() !== "")
    .map((v) => String(v).trim().toLowerCase());
  if (!want.length) return true;
  const ans = answers?.[cond.key];
  const got = (Array.isArray(ans) ? ans : [ans]).map((v) => String(v ?? "").trim().toLowerCase());
  return got.some((g) => want.includes(g));
}

// ── Ofertas do slide de preço ───────────────────────────────────────────────
// O slide `pricing` carrega ATÉ QUATRO ofertas: a principal, nos campos do
// próprio slide, e as secretas em `offer2`/`offer3`/`offer4` (o closer revela
// com Shift+1/2/3 na apresentação ao vivo). Estes são os campos que descrevem
// UMA oferta — promover uma secreta a principal é copiar exatamente eles.
// `sub` é onde entra o ESCOPO quando a oferta muda de produto (ex.: as ofertas
// de OEM avulso em autopeças, que não incluem a clonagem): a lista de
// benefícios é do slide e NÃO troca por oferta.
const OFFER_KEYS = ["planTag", "planPill", "priceFrom", "pricePrefix", "currency", "price", "per", "sub", "cyclesLabel", "cyclesFrom", "cycles"];
export const OFFER_SLOTS = [1, 2, 3, 4];
const offerAt = (slide, n) => (n === 2 ? slide?.offer2 : n === 3 ? slide?.offer3 : n === 4 ? slide?.offer4 : slide);
const pricingSlide = (slides) => (slides || []).find((s) => s?.type === "pricing") || null;

// Ofertas disponíveis num deck, na ordem da escada (1 = principal). Usado pelo
// cockpit pra oferecer "qual proposta mandar" e pra validar o pedido de share.
export function proposalOffers(slides) {
  const slide = pricingSlide(slides);
  if (!slide) return [];
  const out = [];
  for (const n of OFFER_SLOTS) {
    const o = offerAt(slide, n);
    // A principal sempre conta; as secretas só quando realmente preenchidas
    // (mesma régua do renderer pra decidir se o card existe).
    if (!o || (n > 1 && !(o.price || o.planTag))) continue;
    out.push({
      offer: n,
      label: String(o.planTag || `Oferta ${n}`),
      price: String(o.price ?? ""),
      per: String(o.per ?? ""),
      cycles: String(o.cycles ?? ""),
    });
  }
  return out;
}

// Deck com UMA oferta só: a escolhida vira a principal e as secretas somem (o
// cliente não pode ver a escada de negociação). Slides não-pricing passam
// intactos; o `revealPrice` fica como está — quem desliga a interação é o
// `showAll` da proposta (o layout encadeado depende do flag pra existir).
export function flattenOffer(slides, offer) {
  const n = OFFER_SLOTS.includes(Number(offer)) ? Number(offer) : 1;
  return (slides || []).map((s) => {
    if (s?.type !== "pricing") return s;
    const out = { ...s };
    delete out.offer2;
    delete out.offer3;
    delete out.offer4;
    const src = offerAt(s, n);
    // n===1 já é o próprio slide; só promoção precisa reescrever os campos (e
    // APAGAR o que a oferta escolhida não define, senão sobra dado da anterior).
    if (n !== 1 && src) {
      for (const k of OFFER_KEYS) {
        if (src[k] !== undefined) out[k] = src[k];
        else delete out[k];
      }
    }
    return out;
  });
}

const CALC_DEFAULTS = {
  salaryMonthly: 3000, workHours: 176, minCopy: 10, minCompatEdit: 2,
  reworkPct: 0.10, netMargin: 0.10, revenueUpliftPct: 50,
  volumeMid: {}, seatsKey: "", seatsMap: {}, volumeKey: "",
  plans: {}, defaultCycle: "monthly", maxSeats: 20, validDays: 7,
};

// Estado inicial da proposta a partir das respostas do lead + parâmetros do calc.
export function initialState(calc, answers) {
  const c = { ...CALC_DEFAULTS, ...(calc || {}) };
  const seatsAns = c.seatsKey ? answers[c.seatsKey] : null;
  // `accounts` = a FAIXA escolhida (ex. "3-5"); `seats` = nº de contas usado na
  // fórmula, derivado do topo da faixa via seatsMap (fallback = incluídas do plano).
  const accounts = seatsAns != null ? String(seatsAns) : "";
  const seats = Number(c.seatsMap?.[accounts]) || c.plans?.[c.defaultCycle]?.included || 2;
  const volume = (c.volumeKey && answers[c.volumeKey]) || Object.keys(c.volumeMid || {})[0] || "";
  const valid = new Date(Date.now() + (Number(c.validDays) || 7) * 86400_000);
  const sourcePain = validProposalPain(c, answers?.sourcePain);
  return {
    accounts, seats, volume, cycle: c.defaultCycle,
    customPriceCents: 0,
    validUntil: valid.toLocaleDateString("pt-BR"),
    frozen: false,
    ...(sourcePain ? { pain: sourcePain } : {}),
  };
}

// Valor do contrato no ciclo da proposta (preço/mês com assentos × meses do
// ciclo) — fallback do `lead.amount` na geração quando o template NÃO tem
// catálogo de produto; com catálogo vale o preço do produto (catalogAmount).
export function contractValue(calc, state) {
  const plan = calc?.plans?.[state?.cycle];
  if (!plan) return 0;
  const perMonth = Number(plan.base || 0) +
    Math.max(0, (Number(state.seats) || 2) - Number(plan.included || 0)) * Number(plan.extra || 0);
  return perMonth * (CYCLE_MONTHS[state.cycle] || 1);
}

// O que a página pública recebe (window.__PROPOSAL__). editKey NUNCA vai junto —
// `editable` é decidido pela rota comparando ?k com o editKey guardado.
export function publicProposal(p, { editable = false } = {}) {
  // O catálogo (tabela de preço por produto, dores, SPIN) é dado do SERVIDOR:
  // a página recebe só o resultado (slides transformados + catalogUI no modo
  // closer), nunca a tabela crua no view-source.
  const { catalog, ...calc } = { ...CALC_DEFAULTS, ...(p.calc || {}) };
  return {
    id: p.id,
    name: p.name || "",
    theme: p.theme || {},
    slides: p.slides || [],
    calc,
    data: p.data || { lead: {}, answers: {} },
    state: p.state || {},
    accepted: !!p.accepted,
    editable,
    // Versão pro cliente: nada espera comando do closer (o preço e os
    // benefícios abrem direto). Ver shareProposalOffer.
    showAll: !!p.showAll,
    frozen: !!p.state?.frozen,
  };
}

// ── Versão pro CLIENTE (o link que vai no WhatsApp) ─────────────────────────
// O deck é desenhado pra APRESENTAÇÃO AO VIVO: o preço só entra no comando do
// closer e as ofertas 2/3 são secretas. Mandado assim, o cliente abre e vê uma
// faixa vazia. Cada oferta ganha então uma proposta PRÓPRIA (id, link e
// tracking separados, dá pra saber qual oferta ele abriu) com: a oferta
// escolhida promovida a principal, as secretas fora, `showAll` (tudo visível
// sem clicar) e SEM editKey (o link nunca abre a edição da apresentação).
// Idempotente por (mãe, oferta): re-compartilhar re-snapshota o mesmo link,
// então correção no deck ou nos dados do lead chega em quem já recebeu.
export async function shareProposalOffer(repo, parent, offer, { baseUrl = "" } = {}) {
  // Catálogo de produto: o cliente recebe o deck do PRODUTO decidido na tela
  // zero (transformado e travado), nunca o snapshot genérico com as duas bases.
  const transformed = applyCatalog(parent);
  // O slide de FECHAMENTO do beta (investimento com tudo à mostra) é ferramenta
  // da apresentação ao vivo: no link do cliente, onde nada espera comando, ele
  // seria só o mesmo preço duas vezes.
  const slidesSrc = (transformed ? transformed.slides : parent?.slides || []).filter((s) => !s?.revealOpen);
  const offers = proposalOffers(slidesSrc);
  // Oferta inválida NÃO cai na principal por silêncio: este link vai pro
  // cliente, mandar o preço errado é pior que falhar.
  const n = offer == null ? 1 : Number(offer);
  const picked = offers.find((o) => o.offer === n);
  if (!picked) return { ok: false, error: "oferta inexistente nesta proposta" };

  // O catálogo não viaja no snapshot do cliente (tabela de preço é do servidor;
  // sem ele o deck compartilhado também nunca re-transforma).
  const { catalog: _catalog, ...calcSansCatalog } = parent.calc || {};
  const snapshot = {
    saas: parent.saas,
    template: parent.template || "",
    lead: parent.lead || "",
    name: parent.name || "Proposta",
    theme: parent.theme || {},
    calc: calcSansCatalog,
    acceptStage: parent.acceptStage || "",
    data: parent.data || { lead: {}, answers: {} },
    state: parent.state || {},
    slides: flattenOffer(slidesSrc, n),
    showAll: true,
    sharedFrom: parent.id,
    sharedOffer: n,
  };
  // Só o id: a proposta inteira é o documento mais pesado do banco (~8 kB por
  // linha) e aqui a lista servia só pra achar UMA linha.
  const [existing] = await repo.listWhere("proposals", { sharedFrom: parent.id, sharedOffer: n }, { fields: [] });
  const saved = existing
    ? await repo.update("proposals", existing.id, snapshot) // mesmo link, mantém views/aceite
    : await repo.create("proposals", {
        ...snapshot,
        editKey: "", // sem chave = editable nunca liga (ver /p/:id)
        views: 0,
        accepted: false,
        createdAt: new Date().toISOString(),
      });
  return { ok: true, proposal: saved, url: `${baseUrl}/p/${saved.id}`, offer: n, label: picked.label };
}

// ── Proposta PERSONALIZADA (objetiva) ───────────────────────────────────────
// Cliente que fechou soluções sob medida numa conversa: o closer não monta o
// deck inteiro, só transcreve o COMBINADO (entregáveis) e o VALOR. Duas telas no
// MESMO layout da apresentação (herda o tema do template publicado): capa +
// "o combinado" (entregáveis + valor). Sem escada de ofertas, sem reveal, sem
// calculadora — é objetiva, já está fechado.
//
// A `spec` (título/subtítulo/entregáveis/valor/ciclo) é a fonte da verdade: fica
// gravada na proposta pra reabrir o formulário, e os slides são derivados dela a
// cada save. Editar = regravar a spec no mesmo id (link estável).

const BRL = (n) => new Intl.NumberFormat("pt-BR").format(Math.round(Number(n) || 0));

// Sufixo do preço por ciclo. O número é o que o closer digitou (o significado é
// dele); o ciclo só rotula. Mantido curto pra caber no card de preço.
const CYCLE_LABELS = {
  avista: { per: "", cycles: "pagamento único" },
  mensal: { per: "/ mês", cycles: "cobrança mensal" },
  parcelado: { per: "", cycles: "parcelado" },
};

export function sanitizeCustomSpec(raw = {}) {
  const cycle = ["avista", "mensal", "parcelado"].includes(raw.cycle) ? raw.cycle : "avista";
  const deliverables = (Array.isArray(raw.deliverables) ? raw.deliverables : [])
    .map((d) => String(d || "").trim()).filter(Boolean).slice(0, 20);
  return {
    title: String(raw.title || "").trim().slice(0, 120) || "Proposta personalizada",
    subtitle: String(raw.subtitle || "").trim().slice(0, 240),
    deliverables,
    // Valor cru (só dígitos): o closer digita "6.000" ou "6000"; guardamos o
    // número e formatamos na hora de exibir.
    price: String(raw.price ?? "").replace(/[^\d]/g, ""),
    priceCaption: String(raw.priceCaption || "").trim().slice(0, 80), // sobrescreve o rótulo do ciclo, se quiser
    cycle,
  };
}

// spec → os dois slides no layout do deck.
export function customSlides(spec, lead = {}) {
  const s = sanitizeCustomSpec(spec);
  const company = String(lead.company || "").trim();
  const cyc = CYCLE_LABELS[s.cycle] || CYCLE_LABELS.avista;
  const hero = {
    key: "capa", type: "hero",
    tag: company || "Proposta sob medida",
    title: s.title,
    ...(s.subtitle ? { subtitle: s.subtitle } : {}),
  };
  const combinado = {
    key: "combinado", type: "pricing",
    eyebrow: "O combinado",
    title: "O que vamos entregar",
    featuresTitle: "Entregáveis",
    features: s.deliverables.length ? s.deliverables : ["A combinar"],
    planTag: "Investimento",
    // Sem valor, o card de preço não entra (proposta só de escopo).
    ...(s.price ? {
      price: BRL(s.price),
      per: cyc.per,
      cycles: s.priceCaption || cyc.cycles,
    } : { price: "a combinar", per: "", cycles: s.priceCaption || "" }),
  };
  return [hero, combinado];
}

// Objeto de proposta (sem persistir) pronto pro renderer/preview.
export function buildCustomProposal(lead, spec, { theme = {} } = {}) {
  const s = sanitizeCustomSpec(spec);
  return {
    name: s.title,
    theme: theme || {},
    slides: customSlides(s, lead),
    calc: {},
    acceptStage: "",
    data: splitLeadData(lead),
    state: {},
    spec: s,
    showAll: true, // versão do cliente: tudo visível, nada espera comando
  };
}

// Provider nativo do dispatcher de POST /api/leads/:id/proposal. Mesmo contrato
// best-effort do runProposal do Levercopy: nunca lança; { ok, skipped?, error? }.
export async function runNativeProposal(repo, lead, opts = {}) {
  const { auto = false, force = false, template: templateId = "", baseUrl = "" } = opts;
  if (auto && !force && lead.proposta_id) return { ok: false, skipped: "already_generated", lead };

  const templates = await repo.list("proposal_templates");
  // `templateId` (opcional) permite o closer escolher um deck alternativo (ex.:
  // Starter pra cliente D/E), inclusive rascunho; sem ele vai o publicado padrão.
  //
  // Exceção: o deck SEGUE O LEAD na fila da Mentoria. Quem trabalha essa fila é
  // o SDR, que não tem a tela de Propostas e portanto não recebe o select de
  // deck do card — sem isso ele geraria a apresentação da PLATAFORMA pra quem
  // ainda não vende, que é justamente o que a fila existe pra evitar.
  const template = templateId
    ? templates.find((t) => t.id === templateId && (!t.saas || t.saas === lead.saas))
    : (mentoriaTemplateOf(templates, lead)
      || templates.find((t) => t.saas === lead.saas && t.status === "published"));
  if (!template) return { ok: false, skipped: "no_template" };

  const data = splitLeadData(lead);
  const calc = { ...CALC_DEFAULTS, ...(template.calc || {}) };
  let proposal;
  try {
    proposal = await repo.create("proposals", {
      saas: lead.saas,
      template: template.id,
      lead: lead.id,
      name: template.name || "Proposta",
      theme: template.theme || {},
      // Com catálogo, os slides de pricing são MATÉRIA-PRIMA do produto (o
      // transform escolhe/reconstrói na hora de servir): entram no snapshot
      // mesmo com showIf de nicho — senão um override pra +OEM FULL num lead
      // fora de autopeças ficaria sem a base do slide.
      slides: (template.slides || []).filter((s) => (hasCatalog(calc) && s?.type === "pricing") || slideVisible(s, data.answers)),
      calc,
      acceptStage: template.acceptStage || "",
      data,
      state: initialState(calc, data.answers),
      editKey: randomBytes(16).toString("hex"),
      views: 0,
      accepted: false,
      createdAt: new Date().toISOString(),
    });
  } catch (e) {
    return { ok: false, error: e.message, status: 0 };
  }

  const proposalUrl = `${baseUrl}/p/${proposal.id}`;
  const patch = {
    proposta_id: proposal.id,
    proposalUrl,
    proposal_edit_url: `${proposalUrl}?k=${proposal.editKey}`,
  };
  // Potencial do card = o preço que a APRESENTAÇÃO vai mostrar: o produto
  // sugerido pela régua (semestral) quando há catálogo; na mentoria, a oferta
  // que a verba declarada encaixa; sem nenhum dos dois, a fórmula por assentos.
  const amount = catalogAmount(proposal) || mentoriaAmount(lead, calc) || contractValue(calc, proposal.state);
  if (amount > 0) patch.amount = amount;
  const updated = await repo.update("leads", lead.id, patch);
  return { ok: true, lead: updated, proposal };
}
