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
//             plans: { monthly|quarterly|annual: { base, included, extra } },
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
  const seats = Number(c.seatsMap?.[seatsAns]) || c.plans?.[c.defaultCycle]?.included || 2;
  const volume = (c.volumeKey && answers[c.volumeKey]) || Object.keys(c.volumeMid || {})[0] || "";
  const valid = new Date(Date.now() + (Number(c.validDays) || 7) * 86400_000);
  return {
    seats, volume, cycle: c.defaultCycle,
    customPriceCents: 0,
    validUntil: valid.toLocaleDateString("pt-BR"),
    frozen: false,
  };
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
    frozen: !!p.state?.frozen,
  };
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
  const updated = await repo.update("leads", lead.id, {
    proposta_id: proposal.id,
    proposalUrl,
    proposal_edit_url: `${proposalUrl}?k=${proposal.editKey}`,
  });
  return { ok: true, lead: updated, proposal };
}
