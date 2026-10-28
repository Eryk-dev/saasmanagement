// Cenas dos prints do Leo de 28/10/2026 (raio-x de 23 a 28/10), no contrato
// v2 em enforce, como roda em produção desde 16/10. Cada cena reproduz a
// conversa real (nomes trocados pelo Rafael do mundo de teste) e o que o
// robô tem que fazer agora.
import { ISO } from "../helpers/sdr-world.js";

const V2 = { offerContract: "v2", promptVersion: "v2", guardsMode: "enforce" };
const PITCH = "Oiii Rafael, tudo bem? A LeverAds faz clonagem de anúncios entre contas, com estoque, atendimento e edição em um lugar só. Isso ajudaria na sua operação?";

export default [
  {
    id: "C-R040-01", title: "Wilian (20/10): 'nesse horário não consigo' ao par de hoje recebe par DIFERENTE, nunca o mesmo",
    rules: ["R-040"],
    world: {
      sdrBot: V2, todayFree: true,
      messages: [
        { direction: "out", author: "sdr-bot", text: PITCH, at: ISO("2026-08-19T12:00:00Z") },
        { direction: "in", text: "sim, ajudaria", at: ISO("2026-08-19T12:30:00Z") },
        { direction: "out", author: "sdr-bot", text: "Consigo hoje às 14h ou às 16h, qual fica melhor pra você?", at: ISO("2026-08-19T12:31:00Z") },
      ],
    },
    ai: [{ acao: "responder", mensagens: ["Ah que pena Rafael, esses horários não dão certo então"], oferecer: true }],
    inbounds: ["Nesse horario não consigo"],
    expect: { result: "responder", sent: [/Ah que pena Rafael/, /^Consigo /], notSent: [/hoje às 14h ou às 16h/, /às 14h/, /às 16h/], shadowSame: true },
  },
  {
    id: "C-R040-02", title: "Alberto (23/10): rajada 'não consigo / hj não consigo / só semana que vem / agenda hj tá cheia' pede a semana que vem, sem repetir hoje às 14h",
    rules: ["R-040", "R-032"],
    world: {
      sdrBot: V2, todayFree: true,
      messages: [
        { direction: "out", author: "sdr-bot", text: PITCH, at: ISO("2026-08-19T12:00:00Z") },
        { direction: "in", text: "Oi sim", at: ISO("2026-08-19T12:30:00Z") },
        { direction: "out", author: "sdr-bot", text: "Consigo hoje às 14h, fica bom pra você?", at: ISO("2026-08-19T12:31:00Z") },
        { direction: "in", text: "Não consigo", at: ISO("2026-08-19T12:58:00Z") },
        { direction: "in", text: "Hj não consigo", at: ISO("2026-08-19T12:58:10Z") },
        { direction: "in", text: "Esse horário só semana que vem", at: ISO("2026-08-19T12:58:20Z") },
      ],
    },
    ai: [{ acao: "responder", mensagens: ["Tranquilo Rafael, hoje não dá então"], oferecer: true }],
    inbounds: ["Minha agenda hj tá cheia 🙈"],
    expect: { result: "responder", sent: [/Tranquilo Rafael, hoje não dá então/, /^Consigo segunda às 9h ou às 11h, qual fica melhor pra você\?$/], notSent: [/hoje às 14h/], shadowSame: true },
  },
  {
    id: "C-R041-01", title: "Claudenilson (20/10): 'Hoje não conseguirei! / Na sexta feira estarei livre' oferece a SEXTA, e 'na sexta já lotou' da IA não sai",
    rules: ["R-041", "R-032", "R-040"],
    world: {
      sdrBot: V2, todayFree: true,
      messages: [
        { direction: "out", author: "sdr-bot", text: PITCH, at: ISO("2026-08-19T12:00:00Z") },
        { direction: "in", text: "Sim vendo!", at: ISO("2026-08-19T12:30:00Z") },
        { direction: "out", author: "sdr-bot", text: "Consigo hoje às 14h ou às 16h, qual fica melhor pra você?", at: ISO("2026-08-19T12:31:00Z") },
        { direction: "in", text: "Hoje não conseguirei!", at: ISO("2026-08-19T12:59:30Z") },
      ],
    },
    ai: [{ acao: "responder", mensagens: ["Na sexta já lotou Rafael"], oferecer: true }],
    inbounds: ["Na sexta feira estarei livre"],
    expect: { result: "responder", sent: [/^Consigo sexta às 9h ou às 11h, qual fica melhor pra você\?$/], notSent: [/lotou/, /hoje às 14h/], shadowSame: true },
  },
  {
    id: "C-R041-02", title: "Alberto (23/10): 'hj só consigo depois das 1800' com nada livre à noite: o motor diz que o pedido lotou (com prova), a IA não inventa",
    rules: ["R-041", "R-032"],
    world: {
      sdrBot: V2, todayFree: true,
      messages: [
        { direction: "out", author: "sdr-bot", text: PITCH, at: ISO("2026-08-19T12:00:00Z") },
        { direction: "in", text: "Oi sim", at: ISO("2026-08-19T12:30:00Z") },
      ],
    },
    ai: [{ acao: "responder", mensagens: ["Hoje depois das 18h já lotou Rafael"], oferecer: true }],
    inbounds: ["Hj só consigo depois das 1800"],
    expect: { result: "responder", sent: [/^Consigo hoje às 18h ou às 19h, qual fica melhor pra você\?$/], notSent: [/lotou/], shadowSame: true },
  },
  {
    id: "C-R029-02", title: "Alberto (16→23/10): oferta de 7 dias atrás não é oferta; 'qual dos dois horários?' vira par novo por extenso",
    rules: ["R-029"],
    world: {
      sdrBot: V2, todayFree: true,
      messages: [
        { direction: "out", author: "sdr-bot", text: PITCH, at: ISO("2026-08-12T12:00:00Z") },
        { direction: "in", text: "Oi sim", at: ISO("2026-08-12T12:30:00Z") },
        { direction: "out", author: "sdr-bot", text: "Consigo amanhã às 14h ou às 16h, qual fica melhor pra você?", at: ISO("2026-08-12T12:31:00Z") },
        { direction: "out", author: "sdr-bot", text: "Oiii Rafael, tudo bem? Vamos retomar nossa conversa sobre a LeverAds? Me dá um ok aqui, por favor", at: ISO("2026-08-19T11:10:00Z") },
      ],
    },
    ai: [{ acao: "responder", mensagens: ["Perfeito Rafael", "Qual dos dois horários fica melhor pra você?"], oferecer: false }],
    inbounds: ["Oi"],
    expect: { result: "responder", sent: [/Perfeito Rafael/, /^Consigo hoje às \d{1,2}h ou às \d{1,2}h, qual fica melhor pra você\?$/], notSent: [/[Qq]ual dos dois horários/], state: "engajado", shadowSame: true },
  },
  {
    id: "C-R042-01", title: "Roberto (22/10): 'podemos deixar pra outra semana?' com a call de hoje no card libera a call e oferece a semana que vem, sem link e sem 'te passo as opções'",
    rules: ["R-042", "R-030", "R-038"],
    world: {
      sdrBot: V2,
      lead: { stage: "Call agendada", callAt: "2026-08-19T13:00", closer: "pl", callUrl: "https://meet.google.com/jqi-vhfd-dmu", confirmLog: { at: "2026-08-19T13:00", manha: ISO("2026-08-19T11:00:00Z") } },
      messages: [
        { direction: "out", author: "sdr-bot", text: "Bom dia Rafael, tudo bom? Temos um horário reservado para hoje às 13h, tudo certo?", at: ISO("2026-08-19T11:00:00Z") },
        { direction: "in", text: "Bom dia", at: ISO("2026-08-19T12:59:00Z") },
      ],
    },
    ai: [{ acao: "responder", mensagens: ["Claro Rafael, tranquilo", "Te passo as próximas opções disponíveis para remarcar"], oferecer: false }],
    inbounds: ["Podemos deixar pra outra semana?"],
    expect: { result: "remarcar-direto", sent: [/^Claro Rafael, já liberei hoje \(19\/08\) às 13h aqui$/, /^Consigo segunda às 9h ou às 11h, qual fica melhor pra você\?$/], notSent: [/link/, /te passo/i, /Te espero/], lead: { callAt: "" } },
  },
  {
    id: "C-R046-01", title: "Janaina (23/10): 'Não consigo participar da reunião' + 'me explica por áudio?' em dois balões: o cancelamento é lido da rajada inteira",
    rules: ["R-046", "R-036"],
    world: {
      sdrBot: V2,
      lead: { stage: "Call agendada", callAt: "2026-08-19T14:00", closer: "pl" },
      messages: [
        { direction: "out", author: "sdr-bot", text: "Bom dia Rafael! Ainda consigo hoje às 14h ou às 17h, qual fica melhor pra você?", at: ISO("2026-08-19T12:20:00Z") },
        { direction: "in", text: "Oiiii", at: ISO("2026-08-19T12:58:00Z") },
        { direction: "in", text: "Não consigo participar da reunião", at: ISO("2026-08-19T12:59:00Z") },
      ],
    },
    ai: [{ acao: "responder", mensagens: ["Ahh entendi Rafael, por áudio por aqui não consigo te mostrar o Price funcionando"], oferecer: false }],
    inbounds: ["Consegue me explicar por áudio por aqui?"],
    expect: { result: "desmarcar", sent: [/desmarquei/i], lead: { callAt: "" } },
  },
  {
    id: "C-R090-02", title: "Margarete (26/10): lead desqualificado em julho manda o formulário de novo: o card reabre e o robô atende",
    rules: ["R-090"],
    world: {
      sdrBot: V2,
      lead: { disqualified: true, stage: "Qualificando", createdAt: ISO("2026-07-04T22:00:00Z"), sourcePain: "PRICE" },
    },
    ai: [{ acao: "responder", mensagens: ["Oiii Rafael, tudo bem?", "Você vende em marketplace com conta própria?"], oferecer: false }],
    inbounds: ["Oi, me chamo Rafael e quero saber mais sobre o Lever Price. Minha operação: Casa & Decoração, Até 500 anúncios ativos, Até 200 pedidos por mês."],
    // O card reabre em Novo lead e a resposta do robô já o move pra Qualificando (fluxo normal de etapa).
    expect: { result: "responder", sent: [/Oiii Rafael, tudo bem\?/], lead: { disqualified: false, stage: "Qualificando" } },
  },
];
