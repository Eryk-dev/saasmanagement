// Cenas dos incidentes de produção de 01 a 15/10/2026 (SQL dos 14 dias) e dos
// textos fixos do motor que violam regras do Leo. Em sombra, a auditoria só
// REGISTRA a violação; o conserto é o PR5 (enforce).
import { ISO } from "../helpers/sdr-world.js";

const OFFER = "Consigo amanhã às 9h ou às 11h, qual fica melhor pra você?";
const PITCH = "Oiii Rafael, tudo bem? A LeverAds faz clonagem de anúncios entre contas, com estoque, atendimento e edição em um lugar só. Isso ajudaria na sua operação?";

export default [
  {
    id: "C-R006-01", title: "explicação de preço (2ª vez) do motor: sem 'call' e sem 'horários que te passei' (repesca com os horários ofertados)",
    rules: ["R-006", "R-051"],
    world: {
      lead: { sdrLog: { priceGuardAt: ISO("2026-08-19T12:40:00Z") } },
      messages: [
        { direction: "out", author: "sdr-bot", text: PITCH, at: ISO("2026-08-19T12:00:00Z") },
        { direction: "in", text: "sim, ajudaria", at: ISO("2026-08-19T12:30:00Z") },
        { direction: "out", author: "sdr-bot", text: OFFER, at: ISO("2026-08-19T12:31:00Z") },
        { direction: "in", text: "quanto custa?", at: ISO("2026-08-19T12:39:00Z") },
        { direction: "out", author: "sdr-bot", text: "Rafael, o investimento é de acordo com as necessidades da sua operação: primeiro a gente entende o seu cenário, e aí te mostra os pontos que dá pra alavancar. É exatamente isso que o especialista faz na demonstração.", at: ISO("2026-08-19T12:40:00Z") },
      ],
    },
    ai: [{ acao: "responder", mensagens: ["Depende do plano"] }],
    inbounds: ["mas me dá uma ideia do valor"],
    expect: { result: "preco-explicado", sent: [/Te explico o porquê/, /Fica melhor amanhã às 9h ou às 11h\?/], notSent: [/\bcall\b/, /horários que te passei/], audit: { notRules: ["R-006", "R-050", "R-029"] } },
  },
  {
    id: "C-R009-01", title: "'não' repetido na remarcação: acolheu uma vez, na segunda cala (sem repetir a frase)",
    rules: ["R-009", "R-036"],
    world: {
      lead: { sdrLog: { reschedule: { status: "declined", at: ISO("2026-08-19T12:35:00Z"), afterMessageId: "m3" } } },
      messages: [
        { direction: "out", author: "sdr-bot", text: OFFER, at: ISO("2026-08-19T12:00:00Z") },
        { direction: "in", text: "pode ser 9h", at: ISO("2026-08-19T12:10:00Z") },
        { direction: "in", text: "não vou conseguir, pode cancelar", at: ISO("2026-08-19T12:30:00Z") },
        { direction: "out", author: "sdr-bot", text: "Tranquilo Rafael, sem problemas, já desmarquei aqui", at: ISO("2026-08-19T12:31:00Z") },
        { direction: "out", author: "sdr-bot", text: "Você gostaria de remarcar?", at: ISO("2026-08-19T12:31:05Z") },
        { direction: "in", text: "não", at: ISO("2026-08-19T12:34:00Z") },
        { direction: "out", author: "sdr-bot", text: "Tudo bem, quando quiser remarcar é só me chamar", at: ISO("2026-08-19T12:35:00Z") },
      ],
    },
    inbounds: ["não, obrigado"],
    expect: { result: "remarcacao-aguarda", notSent: [/quando quiser remarcar é só me chamar/] },
  },
  {
    id: "C-R060-01", title: "M3 do roteiro OEM diz '30/40 minutos': conta como isenta (decisão do Leo, 15/10), não como violação",
    rules: ["R-060", "R-070"],
    world: {
      lead: { sourcePain: "OEM", niche: "autopecas", name: "Zé Autopeças" },
      messages: [
        { direction: "out", author: "sdr-bot", text: "Oiii Zé, tudo bem? Recebemos aqui seu interesse, com o Lever OEM você digita o código e recebe o anúncio completo, com fotos, título de 200 caracteres, descrição e compatibilidade. Isso ajudaria na sua operação?", at: ISO("2026-08-19T12:00:00Z") },
        { direction: "in", text: "sim", at: ISO("2026-08-19T12:30:00Z") },
        { direction: "out", author: "sdr-bot", text: "Maravilha Zé. Pelo que você me passou no formulário, faz sentido te mostrar a plataforma.", at: ISO("2026-08-19T12:31:00Z") },
        { direction: "out", author: "sdr-bot", text: "Tenho agenda para amanhã às 9h ou amanhã às 11h. Qual funciona melhor para você?", at: ISO("2026-08-19T12:31:05Z") },
      ],
    },
    ai: [{ acao: "agendar", horario: "2026-08-20T09:00" }],
    inbounds: ["pode ser às 9h"],
    expect: { result: "agendar", sent: [/em torno de 30\/40 minutos/, /Posso contar com sua presença\?/], lead: { callAt: "2026-08-20T09:00" }, audit: { exempt: ["R-060"], notRules: ["R-060"] } },
  },
  {
    id: "C-R032-01", title: "caso Daniel (15/10): 'boa tarde' de ontem não é período, e 'como estaria sua agenda na sexta' oferece a sexta",
    rules: ["R-032", "R-028"],
    world: {
      messages: [
        { direction: "in", text: "Olá, boa tarde", at: ISO("2026-08-18T17:00:00Z") },
        { direction: "out", author: "sdr-bot", text: PITCH, at: ISO("2026-08-18T17:01:00Z") },
      ],
    },
    ai: [{ acao: "responder", mensagens: ["Na sexta consigo sim", "Consigo sexta às 9h ou às 11h, qual fica melhor pra você?"] }],
    inbounds: ["Como estaria sua agenda na sexta-feira?"],
    expect: { result: "responder", sent: [/sexta às 9h ou às 11h/], notSent: [/[Nn]ão tenho horário/, /lotou/], intent: "schedule_ask", shadowSame: true },
  },
  {
    id: "C-R031-01", title: "'sim' seco depois do pitch: a resposta sem pergunta ganha a oferta do par (e a sombra concorda com a cadeia legada)",
    rules: ["R-031", "R-022"],
    world: { messages: [{ direction: "out", author: "sdr-bot", text: PITCH, at: ISO("2026-08-19T12:00:00Z") }] },
    ai: [{ acao: "responder", mensagens: ["Que bom que ajuda Rafael"] }],
    inbounds: ["Opa sim"],
    expect: { result: "responder", sent: [/Que bom que ajuda Rafael/, /^Consigo amanhã às 9h ou às 11h, qual fica melhor pra você\?$/], state: "engajado", intent: "yes", shadowSame: true },
  },
];
