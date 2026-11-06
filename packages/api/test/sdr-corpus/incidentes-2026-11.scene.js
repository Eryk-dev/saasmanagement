// Cenas da varredura de 05/11/2026 (pedido do Leo: "o robô SDR está fazendo
// loucura" — Kassio, Rinaldo, Rita), no contrato v2 em enforce, como roda em
// produção. Nomes trocados pelo Rafael do mundo de teste.
// Regras cobertas aqui (o meta-teste do rulebook lê a tag no fonte): #R-117 #R-118 #R-047 #R-113 #R-121 #R-084 #R-031 #R-023
import { ISO } from "../helpers/sdr-world.js";

const V2 = { offerContract: "v2", promptVersion: "v2", guardsMode: "enforce" };
const PITCH_OEM = "Oiii Rafael, tudo bem? Com o Lever OEM você digita o código e recebe o anúncio completo, com fotos, título de 200 caracteres, descrição e compatibilidade, pronto para revisar e publicar no Mercado Livre e Shopee. Isso ajudaria na sua operação?";
const FORM_OEM = "Oi, me chamo Rafael e quero saber mais sobre o Lever OEM. Minha operação: autopeças, Online + loja física, 1 conta, Até 500 anúncios ativos.";
const OEM_LEAD = { sourcePain: "OEM", niche: "autopecas" };
// Conversa do Caio (06/11) até o template de retomada, com as datas do mundo.
const CAIO_HISTORY = [
  { direction: "in", text: "Oi, me chamo Rafael e quero saber mais sobre o Lever OEM. Minha operação: autopeças, Só online, 1 conta, 1.000 a 5.000 anúncios ativos.", at: ISO("2026-08-17T21:24:00Z") },
  { direction: "out", author: "sdr-bot", text: "No Lever OEM você digita o código da peça e recebe o anúncio completo, com fotos, título, descrição e compatibilidade", at: ISO("2026-08-17T21:25:00Z") },
  { direction: "out", author: "sdr-bot", text: "Isso ajudaria na sua operação?", at: ISO("2026-08-17T21:25:10Z") },
  { direction: "in", text: "Sim", at: ISO("2026-08-17T21:41:00Z") },
  { direction: "out", author: "sdr-bot", text: "Consigo amanhã às 9h ou às 11h, qual fica melhor pra você?", at: ISO("2026-08-17T21:42:00Z") },
  { direction: "out", author: "sdr-bot", text: "Bom dia Rafael! Os horários de ontem já não estão mais livres, mas consigo hoje às 11h ou amanhã às 16h, qual fica melhor pra você?", at: ISO("2026-08-18T12:21:00Z") },
  { direction: "out", author: "sdr-bot", via: "flow", text: "Oiii Rafael, tudo bem? Vamos retomar nossa conversa sobre a LeverAds? Me dá um ok aqui, por favor", at: ISO("2026-08-19T12:21:00Z") },
];
// Rinaldo: call marcada pelo robô em 03/08 (16 dias antes do NOW), nunca
// marcada como no-show; o card segue em "Call agendada".
const RINALDO_MSGS = [
  { direction: "out", author: "sdr-bot", text: PITCH_OEM, at: ISO("2026-08-02T12:00:00Z") },
  { direction: "in", text: "Sim", at: ISO("2026-08-02T12:30:00Z") },
  { direction: "out", author: "sdr-bot", text: "Consigo amanhã às 11h, fica bom pra você?", at: ISO("2026-08-02T12:31:00Z") },
  { direction: "in", text: "Sim", at: ISO("2026-08-02T12:40:00Z") },
  { direction: "out", author: "sdr-bot", text: "Perfeito. Ficou então para amanhã (03/08) às 11h.", at: ISO("2026-08-02T12:41:00Z") },
];
const RINALDO = { stage: "Call agendada", callAt: "2026-08-03T11:00", closer: "pl", callUrl: "https://meet.google.com/kkv-dmrm-tij", ...OEM_LEAD };

export default [
  {
    id: "C-R047-02", title: "Kassio (05/11): 'Certo' ao lembrete de confirmação com a call marcada NÃO reabre a descoberta de 18 dias atrás",
    rules: ["R-047", "R-113"],
    world: {
      sdrBot: V2,
      lead: {
        stage: "Call agendada", callAt: "2026-08-19T15:00", closer: "pl", callUrl: "https://meet.google.com/bxf-zaih-hdh", callConfirmed: true,
        confirmLog: { at: "2026-08-19T15:00", manha: ISO("2026-08-19T11:01:00Z"), confirmed: ISO("2026-08-19T12:58:00Z") },
        sdrLog: { ladder: { at: ISO("2026-08-01T21:53:00Z"), done: true, step: 1, warm: false, lastAt: ISO("2026-08-09T11:13:00Z") } },
      },
      messages: [
        { direction: "out", author: "sdr-bot", text: "Oiii Rafael, tudo certo?", at: ISO("2026-08-01T21:54:00Z") },
        { direction: "out", author: "sdr-bot", text: "Hoje você vende em marketplace com conta própria?", at: ISO("2026-08-01T21:54:30Z") },
        { direction: "out", author: "sdr-bot", text: "Oiii Rafael, tudo bem? Vamos retomar nossa conversa sobre a LeverAds? Me dá um ok aqui, por favor", at: ISO("2026-08-03T11:00:00Z") },
        { direction: "out", author: "sdr-bot", text: "Oiii Rafael, tudo bem? Como não consegui falar com você por aqui, vou encerrar seu atendimento e parar de te chamar. Se ainda fizer sentido conhecer a LeverAds, me manda um ok que eu retomo na hora", at: ISO("2026-08-09T11:13:00Z") },
        { direction: "out", author: "sdr-bot", text: "Bom dia Rafael! Nossa conversa é hoje às 15h, nosso especialista já separou o horário. O link pra entrar é este: https://meet.google.com/bxf-zaih-hdh. Se for entrar pelo celular, vale ter um computador por perto: na tela grande você acompanha e entende melhor a demonstração. Me confirma por aqui que está tudo certo?", at: ISO("2026-08-19T11:01:00Z") },
      ],
    },
    ai: [{ acao: "responder", mensagens: ["Tudo bem por aqui Rafael", "Você já vende no Mercado Livre ou Shopee com uma conta própria?"], oferecer: false }],
    inbounds: ["Certo"],
    expect: { result: "confirmado", notSent: [/conta própria/, /Tudo bem por aqui/] },
  },
  {
    id: "C-R117-01", title: "Rinaldo (05/11): reenviou o form 16 dias depois da call que ninguém marcou como no-show: nada de 'segue marcada pra 03/08'; reconhece e oferece o par",
    rules: ["R-117", "R-118"],
    world: { sdrBot: V2, lead: RINALDO, messages: RINALDO_MSGS },
    ai: [{ acao: "responder", mensagens: ["Oi Rafael! Nossa conversa acabou não acontecendo, vamos remarcar"], oferecer: true }],
    inbounds: [FORM_OEM],
    expect: { result: "responder", state: "pos_call", sent: [/^Oi Rafael! Nossa conversa acabou não acontecendo, vamos remarcar$/, /^Consigo amanhã às 9h ou às 11h, qual fica melhor pra você\?$/], notSent: [/segue marcada/] },
  },
  {
    id: "C-R117-02", title: "Rinaldo (05/11): 'esse horário já passou' com a call vencida no card: reconhece e oferece o par, sem 'pode ser sim' vazio",
    rules: ["R-117", "R-030"],
    world: { sdrBot: V2, lead: RINALDO, messages: [...RINALDO_MSGS, { direction: "in", text: FORM_OEM, at: ISO("2026-08-19T12:16:00Z") }, { direction: "out", author: "sdr-bot", text: "Oi Rafael! Nossa conversa acabou não acontecendo, vamos remarcar", at: ISO("2026-08-19T12:16:30Z") }] },
    ai: [{ acao: "responder", mensagens: ["Verdade Rafael, esse horário já passou"], oferecer: true }],
    inbounds: ["Boa tarde, o dia 03/08 já passou"],
    expect: { result: "responder", state: "pos_call", sent: [/^Verdade Rafael, esse horário já passou$/, /^Consigo amanhã às 9h ou às 11h, qual fica melhor pra você\?$/], notSent: [/segue marcada/, /pode ser sim$/] },
  },
  {
    id: "C-R117-03", title: "call vencida: aceite do horário remarca pelo id e a antiga vai pro histórico; o card não se move",
    rules: ["R-117", "R-020"],
    world: {
      sdrBot: V2, lead: RINALDO,
      messages: [...RINALDO_MSGS,
        { direction: "in", text: "Boa tarde, o dia 03/08 já passou", at: ISO("2026-08-19T12:16:00Z") },
        { direction: "out", author: "sdr-bot", text: "Verdade Rafael, esse horário já passou", at: ISO("2026-08-19T12:16:30Z") },
        { direction: "out", author: "sdr-bot", text: "Consigo amanhã às 9h ou às 11h, qual fica melhor pra você?", at: ISO("2026-08-19T12:16:31Z") },
      ],
    },
    ai: [{ acao: "agendar", mensagens: [], horario: "2026-08-20T09:00", slotIds: ["s1"], slots: [{ id: "s1", at: "2026-08-20T09:00", label: "amanhã às 9h" }] }],
    inbounds: ["pode ser às 9h então"],
    expect: { result: "agendar", sent: [/amanhã \(20\/08\) às 9h/], lead: { callAt: "2026-08-20T09:00", stage: "Call agendada" } },
  },
  {
    id: "C-R118-01", title: "Rita (05/11): em No show, reenviou o form de madrugada e ouviu o pitch do zero: o pitch cai, sobra o reconhecimento e o par",
    rules: ["R-118", "R-117"],
    world: {
      sdrBot: V2,
      lead: { stage: "No show", callAt: "", callHistory: [{ at: "2026-08-18T13:00", closer: "pl" }], ...OEM_LEAD },
      messages: [
        { direction: "out", author: "sdr-bot", text: PITCH_OEM, at: ISO("2026-08-17T12:00:00Z") },
        { direction: "in", text: "Sim", at: ISO("2026-08-17T12:30:00Z") },
        { direction: "out", author: "sdr-bot", text: "Consigo amanhã às 13h, fica bom pra você?", at: ISO("2026-08-17T12:31:00Z") },
        { direction: "in", text: "Sim", at: ISO("2026-08-17T12:40:00Z") },
        { direction: "out", author: "sdr-bot", text: "Perfeito. Ficou então para amanhã (18/08) às 13h.", at: ISO("2026-08-17T12:41:00Z") },
        { direction: "in", text: "Desculpa, tive um imprevisto e não deu tempo de avisar", at: ISO("2026-08-18T22:00:00Z") },
        { direction: "out", author: "sdr-bot", text: "Tranquilo Rafael, a gente pode remarcar a conversa", at: ISO("2026-08-18T22:01:00Z") },
      ],
    },
    ai: [{ acao: "responder", mensagens: ["Oiii Rafael, claro", "Com o Lever OEM você digita o código e recebe o anúncio completo, com fotos, título de 200 caracteres, descrição e compatibilidade"], oferecer: true }],
    inbounds: [FORM_OEM],
    expect: { result: "responder", state: "engajado", sent: [/^Oiii Rafael, claro$/, /^Consigo amanhã às 9h ou às 11h, qual fica melhor pra você\?$/], notSent: [/título de 200/] },
  },
  {
    id: "C-R118-02", title: "primeira mensagem do form logo depois do 1º toque NÃO é volta: a descoberta segue normal (R-101)",
    rules: ["R-118", "R-101"],
    world: {
      sdrBot: V2,
      messages: [{ direction: "out", author: "sdr-bot", text: "Oiii Rafael, tudo bem? A LeverAds faz clonagem de anúncios entre contas, com estoque, atendimento e edição em um lugar só. Isso ajudaria na sua operação?", at: ISO("2026-08-19T12:00:00Z") }],
    },
    ai: [{ acao: "responder", mensagens: ["Oiii Rafael! Hoje você vende em marketplace com conta própria?"], oferecer: false }],
    inbounds: ["Oi, me chamo Rafael e quero saber mais sobre a LeverAds. Minha operação: Outro, 1 conta, 500 a 1.000 anúncios ativos."],
    expect: { result: "responder", state: "descoberta", sent: [/conta própria\?$/], notSent: [/^Consigo /] },
  },

  // ── Caio (06/11/2026, le_mstiy7n10p): "No momento não consigo. Semana que
  // vem retorno contato" recebeu "Combinado" + "Fica melhor segunda às 9h ou
  // às 11h?", e o "Ok" seguinte recebeu "qual das duas opções você prefere?".
  // Histórico igual ao real (form, pitch, "Sim", oferta, cobrança da manhã,
  // template de retomada via flow); NOW é quarta 19/08, "semana que vem" =
  // segunda 24/08.
  {
    id: "C-R121-01", title: "Caio (06/11) turno 1: 'No momento não consigo. Semana que vem retorno contato' recebe só o 'Combinado' (sem 'Fica melhor…') e o dia vira callbackAt",
    rules: ["R-121", "R-084", "R-031"],
    world: { sdrBot: V2, lead: OEM_LEAD, messages: CAIO_HISTORY },
    ai: [{ acao: "responder", mensagens: ["Combinado Rafael, te chamo aqui na semana que vem"], oferecer: false }],
    inbounds: ["Olá.\n\nNo momento não consigo.\n\nSemana que vem retorno contato"],
    expect: { result: "responder", intent: "postpone", sent: [/^Combinado Rafael, te chamo aqui na semana que vem$/], notSent: [/Fica melhor/, /^Consigo /, /qual fica melhor/], sdrLog: { callbackAt: /^2026-08-24T12:30/ }, audit: { notRules: ["R-031"] } },
  },
  {
    id: "C-R121-02", title: "Caio (06/11) turno 2: 'Ok' em cima do 'Combinado' fica sem resposta (nada de 'qual das duas opções você prefere?') e o retorno de segunda continua de pé",
    rules: ["R-121", "R-084"],
    world: {
      sdrBot: V2,
      lead: { ...OEM_LEAD, sdrLog: { callbackAt: "2026-08-24T12:30:00.000Z", callbackSetAt: ISO("2026-08-19T12:58:20Z"), callbackDoneAt: null } },
      messages: [...CAIO_HISTORY,
        { direction: "in", text: "Olá.\n\nNo momento não consigo.\n\nSemana que vem retorno contato", at: ISO("2026-08-19T12:58:00Z") },
        { direction: "out", author: "sdr-bot", text: "Combinado Rafael, te chamo aqui na semana que vem", at: ISO("2026-08-19T12:58:20Z") }],
    },
    ai: [{ acao: "responder", mensagens: ["Perfeito Rafael, qual das duas opções você prefere?"], oferecer: false }],
    inbounds: ["Ok"],
    expect: { result: "silencio", notSent: [/opções/, /prefere/, /./], sdrLog: { callbackAt: "2026-08-24T12:30:00.000Z", callbackDoneAt: null } },
  },
  {
    id: "C-R121-03", title: "retorno combinado pendente + pedido explícito de horário: a agenda sai normalmente (o pedido do lead vence)",
    rules: ["R-121"],
    world: {
      sdrBot: V2,
      lead: { ...OEM_LEAD, sdrLog: { callbackAt: "2026-08-24T12:30:00.000Z", callbackSetAt: ISO("2026-08-19T12:58:20Z"), callbackDoneAt: null } },
      messages: [...CAIO_HISTORY,
        { direction: "in", text: "Semana que vem retorno contato", at: ISO("2026-08-19T12:58:00Z") },
        { direction: "out", author: "sdr-bot", text: "Combinado Rafael, te chamo aqui na semana que vem", at: ISO("2026-08-19T12:58:20Z") }],
    },
    ai: [{ acao: "responder", mensagens: ["Claro Rafael"], oferecer: true }],
    inbounds: ["Na verdade, quais horários você tem amanhã?"],
    expect: { result: "responder", sent: [/^Claro Rafael$/, /^Consigo amanhã às 9h ou às 11h, qual fica melhor pra você\?$/] },
  },
  {
    id: "C-R121-04", title: "retorno combinado pendente + fala substantiva sem pedir horário: responde sem oferta e o retorno segue",
    rules: ["R-121", "R-084"],
    world: {
      sdrBot: V2,
      lead: { ...OEM_LEAD, sdrLog: { callbackAt: "2026-08-24T12:30:00.000Z", callbackSetAt: ISO("2026-08-19T12:58:20Z"), callbackDoneAt: null } },
      messages: [...CAIO_HISTORY,
        { direction: "in", text: "Semana que vem retorno contato", at: ISO("2026-08-19T12:58:00Z") },
        { direction: "out", author: "sdr-bot", text: "Combinado Rafael, te chamo aqui na semana que vem", at: ISO("2026-08-19T12:58:20Z") }],
    },
    ai: [{ acao: "responder", mensagens: ["Boa Rafael, o Lever OEM trabalha junto com o Bling"], oferecer: true }],
    inbounds: ["Tenho 3 contas no Mercado Livre e uso o Bling"],
    expect: { result: "responder", sent: [/Bling/], notSent: [/^Consigo /, /Fica melhor/], sdrLog: { callbackAt: "2026-08-24T12:30:00.000Z" } },
  },
  {
    id: "C-R084-04", title: "a IA promete 'te chamo segunda' sem o lead ter dito o dia: a promessa é saída (nada emendado) e vira callbackAt",
    rules: ["R-084", "R-031"],
    world: { sdrBot: V2, lead: OEM_LEAD, messages: CAIO_HISTORY },
    ai: [{ acao: "responder", mensagens: ["Tranquilo Rafael", "Combinado, te chamo segunda"], oferecer: true }],
    inbounds: ["Estou em viagem"],
    expect: { result: "responder", sent: [/^Combinado, te chamo segunda$/], notSent: [/^Consigo /, /Fica melhor/], sdrLog: { callbackAt: /^2026-08-24T12:30/ } },
  },
  {
    id: "C-R023-03", title: "Caio (04/11): 'Pode ser.' ao 'Consigo amanhã às 9h30' que NÓS oferecemos marca às 9h30 (sem 'acabou de ser preenchido')",
    rules: ["R-023", "R-028"],
    world: {
      sdrBot: V2, lead: OEM_LEAD,
      messages: [...CAIO_HISTORY.slice(0, 4), { direction: "out", author: "sdr-bot", text: "Consigo amanhã às 9h30, fica bom pra você?", at: ISO("2026-08-19T12:42:00Z") }],
    },
    ai: [{ acao: "agendar", horario: "2026-08-20T09:30", mensagens: [] }],
    inbounds: ["Pode ser."],
    expect: { result: "agendar", lead: { callAt: "2026-08-20T09:30" }, sent: [/amanhã \(20\/08\) às 9h30/], notSent: [/preenchido por outro cliente/] },
  },
];
