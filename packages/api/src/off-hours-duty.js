// Plantão fora do horário: quando o time comercial não está na operação, quem
// atende é UMA pessoa, no número dela. A janela é o NEGATIVO do expediente, e
// por isso cobre de uma vez a noite de todo dia útil (das 18h de um dia às 8h do
// outro) e o fim de semana inteiro (de sexta 18h a segunda 8h), sem precisar
// listar janela por janela.
//
// Dentro dela:
//   1. o botão do formulário manda o lead pro número do plantonista, e não pro
//      número comercial, onde não tem ninguém (routes.forms.js);
//   2. a saudação automática do fluxo de ligação fica calada, porque quem
//      responde é gente e o robô dizendo "voltamos amanhã" entraria por cima de
//      um atendimento humano acontecendo agora (wa-call-flow.js).
//
// As duas pontas leem daqui, então número novo e robô calado começam e terminam
// juntos. E o expediente vem do business-hours.js, o MESMO que o fluxo de
// ligação usa pra escolher a saudação: mexer no horário em Ajustes reposiciona
// tudo junto, sem uma segunda cópia de "8h às 18h" pra esquecer de atualizar.
//
// Config por PRODUTO (product.duty), porque o plantão é de quem vende aquele
// produto: o fora-de-hora da LeverAds é o Leo, o da UniqueKids seria a Ana.
//
//   duty: {
//     enabled: true,
//     phone: "5541995063622",  // dígitos E.164 sem "+"
//     silenceAuto: true,       // cala a saudação automática na janela
//     hourStart, hourEnd,      // opcionais: plantão com jornada PRÓPRIA, pra
//   }                          // quando ele não começa onde o expediente acaba
import { isBusinessHours } from "./business-hours.js";

// Config normalizada, ou null quando o produto não tem plantão: sem `enabled` e
// sem número não existe pra onde mandar o lead, então não há janela nenhuma.
export function dutyConfig(product) {
  const cfg = product?.duty;
  if (!cfg?.enabled) return null;
  const phone = String(cfg.phone || "").replace(/\D/g, "");
  if (!phone) return null;
  return {
    phone,
    silenceAuto: cfg.silenceAuto !== false,
    hourStart: cfg.hourStart ?? product?.waCallFlow?.hourStart,
    hourEnd: cfg.hourEnd ?? product?.waCallFlow?.hourEnd,
  };
}

export function isDutyTime(product, at = new Date()) {
  const cfg = dutyConfig(product);
  if (!cfg) return false;
  return !isBusinessHours({ waCallFlow: { hourStart: cfg.hourStart, hourEnd: cfg.hourEnd } }, at);
}

// Número que atende AGORA, ou "" quando o plantão não está valendo — o chamador
// só troca quando vem número, e nunca precisa saber que horas são.
export function dutyPhone(product, at = new Date()) {
  return isDutyTime(product, at) ? dutyConfig(product).phone : "";
}

// A saudação automática deve ficar calada agora? Só dentro da janela, e só
// quando o plantão pediu silêncio (dá pra ter plantão com o robô ligado, pra
// quem escreve no número comercial mesmo assim).
export function isAutoSilenced(product, at = new Date()) {
  const cfg = dutyConfig(product);
  return !!cfg?.silenceAuto && isDutyTime(product, at);
}
