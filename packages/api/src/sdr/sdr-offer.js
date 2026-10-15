// A FRASE DA OFERTA DE HORÁRIO, num lugar só (R-021, R-026, R-028).
//
// Até 15/10 ela existia em 8 cópias (cérebro e flow), cada uma com a sua
// variação, e a régua que LÊ a oferta de volta (isOfferMsg/offeredSlotsIn em
// sdr-signals.js) dependia de todas escreverem igual. Aqui ficam todos os
// estilos que o motor usa; test/sdr-acoplamento.test.js garante que cada um
// é reconhecido como oferta pela régua compartilhada.
//
// Os textos são byte a byte os que o cérebro mandava: trocar uma palavra aqui
// muda o que o lead lê E o que o motor reconhece como "já ofereci".

import { slotLabel } from "../crm/agenda-slots.js";

const labelOf = (s, wnow) => s.label || (wnow ? slotLabel(s.at, wnow) : s.at);

export const OFFER_STYLES = ["consigo", "lotou", "fica-melhor", "tenho-agenda", "desculpa"];
export const NO_SLOT_TEXT = {
  "sem-horario": "Não tenho horário disponível nesse dia. Qual outra data fica melhor pra você?",
  "sem-vaga": "Nesse dia não tenho vaga. Qual outra data fica melhor pra você?",
  periodo: "Qual período fica melhor pra você, manhã ou tarde?",
  "periodo-costuma": "Qual período costuma ser melhor pra você, manhã ou tarde?",
};

// Oferta canônica (voz da Manuela): "Consigo X ou Y, qual fica melhor pra você?"
// `empty` escolhe a frase quando não há horário (NO_SLOT_TEXT).
export function offerLine(slots = [], { style = "consigo", wnow = null, nome = "", lotouDay = "", empty = "sem-horario" } = {}) {
  const l = slots.map((s) => labelOf(s, wnow));
  if (style === "tenho-agenda") {
    if (l.length >= 2) return `Tenho agenda para ${l[0]} ou ${l[1]}. Qual funciona melhor para você?`;
    if (l.length === 1) return `Tenho agenda para ${l[0]}. Funciona para você?`;
    return "";
  }
  if (style === "fica-melhor") return l.length >= 2 ? `Fica melhor ${l[0]} ou ${l[1]}?` : offerLine(slots, { style: "consigo", wnow, empty });
  const base = l.length >= 2 ? `Consigo ${l[0]} ou ${l[1]}, qual fica melhor pra você?`
    : l.length === 1 ? `Consigo ${l[0]}, fica bom pra você?`
      : NO_SLOT_TEXT[empty] || NO_SLOT_TEXT["sem-horario"];
  if (style === "lotou") {
    if (!lotouDay || !l.length) return base;
    const lotou = `${lotouDay} já lotou, `;
    return `${lotou.charAt(0).toUpperCase()}${lotou.slice(1)}${base.charAt(0).toLowerCase()}${base.slice(1)}`;
  }
  if (style === "desculpa") {
    // Horário que a gente OFERECEU e o lead escolheu, mas foi preenchido no
    // meio do caminho (Leo, 25/08): a culpa é da nossa agenda, não dele.
    if (!l.length) return NO_SLOT_TEXT["sem-horario"];
    const oi = nome ? `Ahh ${nome}, ` : "Ahh, ";
    return `${oi}esse horário acabou de ser preenchido por outro cliente, me desculpa! ${base}`;
  }
  return base;
}

// Compat com o nome antigo do cérebro.
export const reofferText = (nome, slots, wnow) => offerLine(slots, { style: "desculpa", nome, wnow });
