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
  return {
    accounts, seats, volume, cycle: c.defaultCycle,
    customPriceCents: 0,
    validUntil: valid.toLocaleDateString("pt-BR"),
    frozen: false,
  };
}

// Valor do contrato no ciclo da proposta (preço/mês com assentos × meses do
// ciclo) — vira o `lead.amount` (potencial de ganho no pipeline) na geração.
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
  return {
    id: p.id,
    name: p.name || "",
    theme: p.theme || {},
    slides: p.slides || [],
    calc: { ...CALC_DEFAULTS, ...(p.calc || {}) },
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
  const offers = proposalOffers(parent?.slides);
  // Oferta inválida NÃO cai na principal por silêncio: este link vai pro
  // cliente, mandar o preço errado é pior que falhar.
  const n = offer == null ? 1 : Number(offer);
  const picked = offers.find((o) => o.offer === n);
  if (!picked) return { ok: false, error: "oferta inexistente nesta proposta" };

  const snapshot = {
    saas: parent.saas,
    template: parent.template || "",
    lead: parent.lead || "",
    name: parent.name || "Proposta",
    theme: parent.theme || {},
    calc: parent.calc || {},
    acceptStage: parent.acceptStage || "",
    data: parent.data || { lead: {}, answers: {} },
    state: parent.state || {},
    slides: flattenOffer(parent.slides, n),
    showAll: true,
    sharedFrom: parent.id,
    sharedOffer: n,
  };
  const all = await repo.list("proposals");
  const existing = all.find((p) => p.sharedFrom === parent.id && Number(p.sharedOffer) === n);
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

// Provider nativo do dispatcher de POST /api/leads/:id/proposal. Mesmo contrato
// best-effort do runProposal do Levercopy: nunca lança; { ok, skipped?, error? }.
export async function runNativeProposal(repo, lead, opts = {}) {
  const { auto = false, force = false, baseUrl = "" } = opts;
  if (auto && !force && lead.proposta_id) return { ok: false, skipped: "already_generated", lead };

  const templates = await repo.list("proposal_templates");
  const template = templates.find((t) => t.saas === lead.saas && t.status === "published");
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
      slides: (template.slides || []).filter((s) => slideVisible(s, data.answers)),
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
  const amount = contractValue(calc, proposal.state);
  if (amount > 0) patch.amount = amount;
  const updated = await repo.update("leads", lead.id, patch);
  return { ok: true, lead: updated, proposal };
}
