// Perguntas de qualificação do pipeline LeverAds.
//
// Era uma lista escrita à mão (accounts/listings/niche/plan_expand, do form de
// jul/2026). Virou alias da UNIÃO dos formulários v2 (OEM · Ads · Price), que é
// a única fonte das perguntas do card desde 05/10/2026: o form antigo
// (fo_diagnostico_leverads) parou de receber lead e as chaves dele (plan_expand,
// revenue, staff, decider, vende_marketplace, aprender_*) saíram do card.
// Mantido só pelo nome, que o seed e os testes do Levercopy importam.
export { LEAD_QUESTIONS_UNIAO as LEVERADS_LEAD_QUESTIONS } from "./lead-questions.produtos.js";
