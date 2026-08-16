// Mentoria Lever no cockpit — espelho de packages/api/src/mentoria.js (a tabela
// de verba e os ids dos produtos andam juntos; preço e nome vêm do SEED, então
// só existem num lugar).
//
// Quem responde "ainda não vendo" no form sai pela lateral (formExit
// "mentoria") e cai na coluna Mentoria, fora do funil de venda e fora do CPL.
// A VERBA declarada nesse ramo é o que decide qual oferta encaixa: é pra isso
// que ela é perguntada, e é isso que este módulo lê pro card, pro roteiro e
// pro gate de fechamento.

import { dealProductsOf } from "./payments.js";

export const isMentoriaLead = (l) => String(l?.formExit || "") === "mentoria";

// Faixa de verba → o que oferecer. `offer` abre a conversa, `rescue` é o degrau
// de baixo (o Curso, revelado só se o preço travar) e `upsell` marca quem é
// candidato ao módulo de importação DEPOIS de comprar.
export const VERBA_FIT = {
  "ate-1k": {
    label: "Até R$ 1 mil",
    offer: "men_curso",
    rescue: "",
    upsell: false,
    note: "Verba curta: abre no Curso. Se ele quiser mão na massa, o Assistido em 12x de R$250 cabe no mesmo bolso e o valor do Curso vira crédito em 30 dias.",
  },
  "1k-5k": {
    label: "R$ 1 mil a R$ 5 mil",
    offer: "men_assistido",
    rescue: "men_curso",
    upsell: false,
    note: "Abre no Assistido: o nosso produto validado segura as primeiras vendas e a verba dele fica livre pro estoque próprio. Curso só se travar no preço.",
  },
  "5k-20k": {
    label: "R$ 5 mil a R$ 20 mil",
    offer: "men_assistido",
    rescue: "men_curso",
    upsell: true,
    note: "Assistido com folga de caixa pro estoque. Candidato natural ao upsell de importação (+R$2.000) durante a mentoria, quando ele sentir a margem.",
  },
  "20k+": {
    label: "Mais de R$ 20 mil",
    offer: "men_assistido",
    rescue: "",
    upsell: true,
    note: "Verba de operação, não de teste. Assistido na entrada e importação já no primeiro mês. Se descobrir na conversa que ele JÁ vende, a rota é a trilha Escalar.",
  },
};

const VERBA_DEFAULT = {
  label: "não declarada",
  offer: "men_assistido",
  rescue: "men_curso",
  upsell: false,
  note: "Sem verba declarada: pergunta antes de falar preço. Sem esse número não dá pra saber se ele compra o Curso ou o Assistido.",
};

// Ordem da fila: quem declarou mais verba primeiro. Serve pro closer atacar a
// coluna Mentoria pelo dinheiro que está nela, não pela ordem de chegada.
export const VERBA_RANK = { "20k+": 0, "5k-20k": 1, "1k-5k": 2, "ate-1k": 3 };

// Nome e preço saem do catálogo do SEED (CONFIG.proposals.catalog), que é o
// mesmo que alimenta o gate de fechamento: preço mexido no banco vale aqui na
// hora, sem deploy.
function productOf(saas, id) {
  const row = dealProductsOf(saas).find((p) => p.id === id) || null;
  return row ? { id, label: row.label, price: Number(row.prices?.[0]?.value) || 0 } : null;
}

// A oferta que encaixa neste lead. `null` quando não é lead da mentoria.
export function mentoriaFit(lead) {
  if (!isMentoriaLead(lead)) return null;
  const band = String(lead?.aprender_verba || "");
  const fit = VERBA_FIT[band] || VERBA_DEFAULT;
  const offer = productOf(lead.saas, fit.offer);
  const rescue = fit.rescue ? productOf(lead.saas, fit.rescue) : null;
  return {
    verba: band,
    verbaLabel: fit.label,
    declared: !!VERBA_FIT[band],
    offer,           // { id, label, price } ou null (catálogo ainda não carregado)
    rescue,
    upsell: !!fit.upsell,
    note: fit.note,
  };
}

const money = (v) => (typeof window !== "undefined" && window.fmt?.money?.(v)) || `R$ ${v}`;

// Linha curta pro card do pipeline e pro grid de fatos: "Assistido · R$ 3.000".
export function mentoriaOfferLine(fit) {
  if (!fit?.offer) return "";
  const name = String(fit.offer.label || "").replace(/^Mentoria\s*·\s*/, "");
  return fit.offer.price ? `${name} · ${money(fit.offer.price)}` : name;
}
