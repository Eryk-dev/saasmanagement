// Contrato v2 (product.sdrBot.offerContract = "v2"): a IA falsa já devolve o
// shape normalizado (como draftFromAi devolve) e o MOTOR escreve a oferta.
import { ISO } from "../helpers/sdr-world.js";

const PITCH = "Oiii Rafael, tudo bem? A LeverAds faz clonagem de anúncios entre contas, com estoque, atendimento e edição em um lugar só. Isso ajudaria na sua operação?";
const PAIR = [{ at: "2026-08-20T09:00", label: "amanhã às 9h" }, { at: "2026-08-20T11:00", label: "amanhã às 11h" }];
const V2 = { sdrBot: { offerContract: "v2" } };
const after = (msgs) => ({ ...V2, messages: msgs });
const pitched = [{ direction: "out", author: "sdr-bot", text: PITCH, at: ISO("2026-08-19T12:00:00Z") }];

export default [
  {
    id: "C-V2-01", title: "oferecer=true com ids vazios: o motor escreve o par sugerido no fim, reserva e carimba lastOffer",
    rules: ["R-021", "R-022", "R-024"],
    world: after(pitched),
    ai: [{ acao: "responder", mensagens: ["Que bom Rafael, o especialista te mostra ao vivo"], oferecer: true, slotIds: [], slots: [] }],
    inbounds: ["Opa sim"],
    expect: { result: "responder", sent: [/^Que bom Rafael, o especialista te mostra ao vivo$/, /^Consigo amanhã às 9h ou às 11h, qual fica melhor pra você\?$/], shadowSame: true,
      lead: {} },
  },
  {
    id: "C-V2-02", title: "ids escolhidos pela IA fora do mais cedo, sem o lead pedir: a trava do mais cedo primeiro reescreve pro par",
    rules: ["R-022", "R-021"],
    world: after(pitched),
    ai: [{ acao: "responder", mensagens: ["Perfeito"], oferecer: true, slotIds: ["s5", "s9"], slots: [{ at: "2026-08-20T11:00", label: "amanhã às 11h" }, { at: "2026-08-20T14:00", label: "amanhã às 14h" }] }],
    inbounds: ["Opa sim"],
    expect: { result: "responder", sent: [/^Consigo amanhã às 9h ou às 11h, qual fica melhor pra você\?$/], notSent: [/14h/], shadowSame: true },
  },
  {
    id: "C-V2-03", title: "lead pediu quinta: os ids escolhidos valem e o motor escreve a oferta de quinta",
    rules: ["R-032", "R-021"],
    world: after(pitched),
    ai: [{ acao: "responder", mensagens: ["Na quinta consigo sim"], oferecer: true, slotIds: ["s1", "s3"], slots: [{ at: "2026-08-20T09:00", label: "amanhã às 9h" }, { at: "2026-08-20T11:00", label: "amanhã às 11h" }] }],
    inbounds: ["Pode ser amanhã?"],
    expect: { result: "responder", sent: [/^Na quinta consigo sim$/, /^Consigo amanhã às 9h ou às 11h, qual fica melhor pra você\?$/], shadowSame: true },
  },
  {
    id: "C-V2-04", title: "agendar pelo id: horário vem do slot e a confirmação sai",
    rules: ["R-020", "R-035"],
    world: after([...pitched, { direction: "in", text: "sim", at: ISO("2026-08-19T12:30:00Z") }, { direction: "out", author: "sdr-bot", text: "Consigo amanhã às 9h ou às 11h, qual fica melhor pra você?", at: ISO("2026-08-19T12:31:00Z") }]),
    ai: [{ acao: "agendar", mensagens: [], horario: "2026-08-20T09:00", slotIds: ["s1"], slots: [PAIR[0]] }],
    inbounds: ["pode ser às 9h então"],
    expect: { result: "agendar", sent: [/agendado então pra amanhã \(20\/08\) às 9h/], lead: { callAt: "2026-08-20T09:00" } },
  },
  {
    id: "C-V2-05", title: "id inválido (fora da lista) com a HORA dita pelo lead: o motor marca a hora dele (29/10, R-035), não pede desculpa por horário livre",
    rules: ["R-020", "R-035"],
    world: after([...pitched, { direction: "in", text: "sim", at: ISO("2026-08-19T12:30:00Z") }, { direction: "out", author: "sdr-bot", text: "Consigo amanhã às 9h ou às 11h, qual fica melhor pra você?", at: ISO("2026-08-19T12:31:00Z") }]),
    ai: [{ acao: "agendar", mensagens: [], horario: "", slotIds: [], slots: [] }],
    inbounds: ["pode ser às 9h então"],
    expect: { result: "agendar", sent: [/amanhã \(20\/08\) às 9h/], lead: { callAt: "2026-08-20T09:00" } },
  },
  {
    id: "C-V2-05b", title: "id inválido (fora da lista) sem hora no texto do lead: não marca nada, re-oferta com desculpa",
    rules: ["R-020", "R-028"],
    world: after([...pitched, { direction: "in", text: "sim", at: ISO("2026-08-19T12:30:00Z") }, { direction: "out", author: "sdr-bot", text: "Consigo amanhã às 9h ou às 11h, qual fica melhor pra você?", at: ISO("2026-08-19T12:31:00Z") }]),
    ai: [{ acao: "agendar", mensagens: [], horario: "", slotIds: [], slots: [] }],
    inbounds: ["o primeiro"],
    expect: { result: "reoferta", sent: [/me desculpa! Consigo amanhã às 9h ou às 11h/], lead: { callAt: undefined } },
  },
  {
    id: "C-V2-06", title: "IA escreveu dia/hora nas partes mesmo assim: a parte cai e fica só a oferta do motor (uma oferta por resposta)",
    rules: ["R-021", "R-026"],
    world: after(pitched),
    ai: [{ acao: "responder", mensagens: ["Consigo sexta às 15h ou às 17h, qual fica melhor pra você?"], oferecer: true, slotIds: [], slots: [] }],
    inbounds: ["Opa sim"],
    expect: { result: "responder", sent: [/^Consigo amanhã às 9h ou às 11h, qual fica melhor pra você\?$/], notSent: [/sexta/] },
  },
  {
    id: "C-V2-07", title: "oferecer=true com a parte do modelo terminando em pergunta: a pergunta cai e fica só a da oferta (uma pergunta por resposta)",
    rules: ["R-003", "R-021"],
    world: after(pitched),
    ai: [{ acao: "responder", mensagens: ["Que bom Rafael, o especialista mostra ao vivo", "Quer ver funcionando?"], oferecer: true, slotIds: [], slots: [] }],
    inbounds: ["Opa sim"],
    expect: { result: "responder", sent: [/^Que bom Rafael, o especialista mostra ao vivo$/, /^Consigo amanhã às 9h ou às 11h, qual fica melhor pra você\?$/], notSent: [/Quer ver funcionando/], audit: { notRules: ["R-003"] } },
  },
  {
    id: "C-V2-08", title: "oferecer=true com uma parte só, em pergunta: fica (o lead precisa de texto antes da oferta)",
    rules: ["R-003"],
    world: after(pitched),
    ai: [{ acao: "responder", mensagens: ["Quer ver funcionando ao vivo?"], oferecer: true, slotIds: [], slots: [] }],
    inbounds: ["Opa sim"],
    expect: { result: "responder", sent: [/^Quer ver funcionando ao vivo\?$/, /^Consigo amanhã às 9h ou às 11h, qual fica melhor pra você\?$/] },
  },
];
