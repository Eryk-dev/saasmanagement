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
  {
    id: "C-R031-02", title: "Kelly (20/10): 'Conta jurídica' respondido com 'Perfeito Kelly' ganha a próxima pergunta de descoberta, nunca termina no ack",
    rules: ["R-031", "R-012"],
    world: {
      sdrBot: V2,
      messages: [
        { direction: "out", author: "sdr-bot", text: "Oiii Rafael, tudo bem?", at: ISO("2026-08-18T21:43:00Z") },
        { direction: "out", author: "sdr-bot", text: "Hoje sua maior dificuldade está em gerenciar as contas ou criar os anúncios?", at: ISO("2026-08-18T21:43:05Z") },
        { direction: "in", text: "Tudo bem e vc?", at: ISO("2026-08-18T22:32:00Z") },
        { direction: "out", author: "sdr-bot", text: "Tudo certo também Rafael", at: ISO("2026-08-18T22:32:30Z") },
        { direction: "in", text: "Que bom", at: ISO("2026-08-19T10:01:00Z") },
        { direction: "out", author: "sdr-bot", text: "Rafael, hoje você vende em marketplace com conta própria?", at: ISO("2026-08-19T10:01:30Z") },
      ],
    },
    ai: [{ acao: "responder", mensagens: ["Perfeito Rafael"], oferecer: false }],
    inbounds: ["Conta jurídica"],
    expect: { result: "responder", sent: [/^Perfeito Rafael$/, /\?$/], notSent: [/^Consigo /, /conta própria\?$/], shadowSame: true },
  },
  {
    id: "C-R047-01", title: "Kelly (19/10): 'Tudo bem e vc?' depois da pergunta de dor: responde e REFAZ a pergunta (uma vez)",
    rules: ["R-047"],
    world: {
      sdrBot: V2,
      messages: [
        { direction: "out", author: "sdr-bot", text: "Oiii Rafael, tudo bem?", at: ISO("2026-08-19T12:10:00Z") },
        { direction: "out", author: "sdr-bot", text: "Hoje sua maior dificuldade está em gerenciar as contas ou criar os anúncios?", at: ISO("2026-08-19T12:10:05Z") },
      ],
    },
    ai: [{ acao: "responder", mensagens: ["Tudo certo também Rafael"], oferecer: false }],
    inbounds: ["Tudo bem e vc?"],
    expect: { result: "responder", sent: [/^Tudo certo também Rafael$/, /^Hoje sua maior dificuldade está em gerenciar as contas ou criar os anúncios\?$/], notSent: [/^Consigo /], shadowSame: true },
  },
  {
    id: "C-R031-03", title: "Cristiano (26/10): turno 1 'Oiii Cristiano, tudo bem?' sozinho (a pergunta do modelo caiu com a oferta) ganha a descoberta; saudação com '?' não é pergunta",
    rules: ["R-031", "R-011", "R-003"],
    world: { sdrBot: V2, lead: { sourcePain: "OEM", niche: "autopecas" } },
    ai: [{ acao: "responder", mensagens: ["Oiii Rafael, tudo bem?", "Hoje você monta os anúncios de autopeças manualmente pelo código OEM?"], oferecer: true }],
    inbounds: ["Oi, me chamo Rafael e quero saber mais sobre o Lever OEM. Minha operação: autopeças, Só online, 1 conta, Até 500 anúncios ativos."],
    expect: { result: "responder", sent: [/^Oiii Rafael, tudo bem\?$/, /\?$/], notSent: [/^Consigo /], state: "novo", shadowSame: true },
  },
  {
    id: "C-R011-02", title: "Flavio (22/10): 'Sem dúvida alguma' depois de descrever a dor (compatibilidade) ENGAJA: a oferta sai e a pergunta de dor não volta",
    rules: ["R-011", "R-012"],
    world: {
      sdrBot: V2, todayFree: true,
      lead: { formProduct: "ads", niche: "autopecas" },
      messages: [
        { direction: "out", author: "sdr-bot", text: "Oiii Rafael, tudo bem?", at: ISO("2026-08-19T11:27:00Z") },
        { direction: "out", author: "sdr-bot", text: "Para autopeças, também cria o anúncio completo pelo código OEM, com fotos, título, descrição e compatibilidade. Hoje sua maior dificuldade está em gerenciar as contas ou criar anúncios?", at: ISO("2026-08-19T11:27:10Z") },
        { direction: "in", text: "Compatibilidade", at: ISO("2026-08-19T11:28:00Z") },
        { direction: "in", text: "Preciso principalmente desta ferramenta.", at: ISO("2026-08-19T11:28:10Z") },
        { direction: "out", author: "sdr-bot", text: "Entendi Rafael, então o OEM é o principal pra você", at: ISO("2026-08-19T11:28:30Z") },
        { direction: "out", author: "sdr-bot", text: "No Lever OEM você recebe o anúncio completo pelo código, com a compatibilidade pronta para revisar. Isso ajudaria na sua operação?", at: ISO("2026-08-19T11:29:00Z") },
      ],
    },
    ai: [{ acao: "responder", mensagens: ["Que bom Rafael, nosso especialista roda um código seu ao vivo e mostra a compatibilidade pronta para revisar e publicar"], oferecer: true }],
    inbounds: ["Sem dúvida alguma"],
    expect: { result: "responder", sent: [/Que bom Rafael/, /^Consigo hoje às \d{1,2}h ou às \d{1,2}h, qual fica melhor pra você\?$/], notSent: [/Qual a maior dificuldade da sua operação hoje/], state: "engajado", shadowSame: true },
  },
  {
    id: "C-R083-02", title: "Helano (26/10): 'Não quero começar' é desinteresse: acolhe, avisa gente e para, sem oferta",
    rules: ["R-083", "R-031"],
    world: {
      sdrBot: V2,
      lead: { sourcePain: "PRICE" },
      messages: [
        { direction: "out", author: "sdr-bot", text: "Oiii Rafael, tudo bem?", at: ISO("2026-08-19T12:53:00Z") },
        { direction: "out", author: "sdr-bot", text: "Você vende em marketplace com conta própria?", at: ISO("2026-08-19T12:53:05Z") },
        { direction: "in", text: "Sim", at: ISO("2026-08-19T12:53:30Z") },
      ],
    },
    ai: [{ acao: "responder", mensagens: ["Tranquilo Rafael, sem problemas"], oferecer: true }],
    inbounds: ["Não quero começar"],
    expect: { result: "desinteresse", sent: [/Tranquilo Rafael, sem problemas\. Se fizer sentido retomar/], notSent: [/^Consigo /], lead: { } },
  },
  {
    id: "C-R043-01", title: "Alexandre (22/10): '11998116287 Chama Larissa explica pra ela' com o template aprovado: cria o card da Larissa, manda o template dizendo quem indicou e responde 'acabei de chamar'",
    rules: ["R-043", "R-030"],
    world: { sdrBot: V2, lead: { sourcePain: "OEM", niche: "autopecas" } },
    approved: ["sdr_indicacao"],
    ai: [{ acao: "responder", mensagens: ["Claro Rafael, vou encaminhar seu contato para a Larissa explicar direitinho"], oferecer: false }],
    inbounds: ["11998116287\nChama Larissa explica para ela como funciona\nBom dia"],
    expect: { result: "terceiro", sent: [/^\[template sdr_indicacao\] Larissa \| Rafael \| Lever OEM$/, /^Combinado Rafael, acabei de chamar Larissa no WhatsApp$/], notSent: [/vou encaminhar/], otherLead: { phone: "5511998116287", name: "Larissa", source: /^Indicação · Rafael Silva/, sourcePain: "OEM" }, leadCount: 2 },
  },
  {
    id: "C-R043-02", title: "Alexandre sem o template aprovado: card criado, resposta honesta 'vou pedir pro time chamar' e handoff terceiro",
    rules: ["R-043", "R-081"],
    world: { sdrBot: V2 },
    ai: [{ acao: "responder", mensagens: ["Claro Rafael, vou encaminhar seu contato"], oferecer: false }],
    inbounds: ["Chama a Larissa no 11998116287, ela que cuida disso"],
    expect: { result: "terceiro", sent: [/^Combinado Rafael, vou pedir pro time chamar Larissa ainda hoje$/], notSent: [/\[template/, /vou encaminhar/], lead: { }, otherLead: { phone: "5511998116287" }, leadCount: 2 },
  },
  {
    id: "C-R043-03", title: "Flavio (22/10): cartão 👤 da gerente + 'pedir para chamar minha gerente': o número vem do cartão; sem número, pede o número",
    rules: ["R-043"],
    world: { sdrBot: V2 },
    approved: ["sdr_indicacao"],
    ai: [{ acao: "responder", mensagens: ["Pode sim Rafael"], oferecer: true }, { acao: "responder", mensagens: ["Claro"], oferecer: false }],
    inbounds: ["Pedir para chamar minha gerente de mercado livre. Para ela te passar melhor as demandas", "👤 Vitória Ecommerce Digital · +55 11 92505-5005 · Vitória Ecommerce Digital"],
    expect: { result: "terceiro", sent: [/me manda o número d(a|o) .* aqui que eu chamo|me manda o número dessa pessoa aqui que eu chamo/, /^\[template sdr_indicacao\] Vitória \| Rafael \| LeverAds$/, /acabei de chamar Vitória no WhatsApp$/], otherLead: { phone: "5511925055005" } },
  },
  {
    id: "C-R045-01", title: "Guilherme (21/10): lead de Price descreve a dor de cadastro em massa: o pitch pivota pro OEM, a IA recebe o foco OEM e a oferta sai",
    rules: ["R-045", "R-011"],
    world: {
      sdrBot: V2, todayFree: true,
      lead: { sourcePain: "PRICE", niche: "autopecas" },
      messages: [
        { direction: "out", author: "sdr-bot", text: "Oiii Rafael, tudo bem?", at: ISO("2026-08-19T12:32:00Z") },
        { direction: "out", author: "sdr-bot", text: "Hoje sua maior dificuldade está em manter os preços atualizados sem sair da margem?", at: ISO("2026-08-19T12:32:05Z") },
      ],
    },
    ai: [{ acao: "responder", mensagens: ["Entendi Rafael, cadastrar em massa com qualidade é exatamente o que o Lever OEM resolve: você digita o código e recebe o anúncio completo"], oferecer: true }],
    inbounds: ["Tambem, mas o meu principal problema, e cadastrar produtos em massa com qualidade, atualmente conto com 50 anuncios, tenho capacidade de subir 1000 anuncios de produtos diferentes. Porem tenho dificuldade em titulo, categoria e principalmente pesquisa de mercado."],
    expect: { result: "responder", sent: [/Lever OEM resolve/, /^Consigo /], lead: { declaredPain: "oem", sourcePain: "PRICE" }, aiPainMode: "oem", state: "engajado" },
  },
  {
    id: "C-R048-01", title: "Roberto (27/10): 'só trabalhamos com loja física' não encerra nem chama gente: carimba o perfil e a conversa segue (decisão do Leo: manter a call)",
    rules: ["R-048", "R-018"],
    world: {
      sdrBot: V2,
      lead: { sourcePain: "OEM", niche: "autopecas" },
      messages: [
        { direction: "out", author: "sdr-bot", text: "Oiii Rafael, tudo bem? Vi que você trabalha com autopeças e quer conhecer o Lever OEM", at: ISO("2026-08-19T12:11:00Z") },
        { direction: "out", author: "sdr-bot", text: "Hoje sua maior dificuldade é montar anúncios completos a partir do código OEM?", at: ISO("2026-08-19T12:12:00Z") },
      ],
    },
    ai: [{ acao: "responder", mensagens: ["Ahh tá entendi Rafael, a LeverAds atende quem vende no Mercado Livre e Shopee com conta própria, e na demonstração o especialista mostra como começa", "Você pretende abrir a conta no Mercado Livre em breve?"], oferecer: false }],
    inbounds: ["Na vdd só trabalhamos com loja física"],
    expect: { result: "responder", sent: [/como começa/, /em breve\?$/], sdrLog: { profileNote: /loja física/, handoffKind: undefined } },
  },
  {
    id: "C-R044-01", title: "Janaina (23/10): 'me explica por áudio por aqui?' recebe o resumo oficial + por que a demonstração + vídeo pelo time (handoff material), nunca a recusa seca",
    rules: ["R-044", "R-081"],
    world: {
      sdrBot: V2,
      lead: { sourcePain: "PRICE", niche: "casa" },
      messages: [
        { direction: "out", author: "sdr-bot", text: "Tenho agenda para amanhã às 14h ou às 17h. Qual funciona melhor para você?", at: ISO("2026-08-19T00:16:00Z") },
        { direction: "in", text: "Oiiii", at: ISO("2026-08-19T12:24:00Z") },
        { direction: "in", text: "Não consigo participar da reunião", at: ISO("2026-08-19T12:24:10Z") },
      ],
    },
    ai: [{ acao: "responder", mensagens: ["Ahh entendi Rafael, por áudio por aqui não consigo te mostrar o Price funcionando"], oferecer: false }],
    inbounds: ["Consegue me explicar por áudio por aqui ?"],
    expect: { result: "material", sent: [/^Claro Rafael\. O Lever Price mantém o preço/, /vídeo curto por aqui$/], notSent: [/não consigo te mostrar/], sdrLog: { handoffKind: "material" } },
  },
  {
    id: "C-R050-03", title: "Ronaldo (23/10): 'nao quero fazer call, queria ver os valores dos planos' vai pra gente na hora, com a ponte sem valor",
    rules: ["R-050", "R-083"],
    world: {
      sdrBot: V2,
      messages: [{ direction: "out", author: "sdr-bot", text: PITCH, at: ISO("2026-08-19T12:00:00Z") }],
    },
    ai: [{ acao: "responder", mensagens: ["Te explico o porquê Ronaldo: a gente tem planos diferentes"], oferecer: true }],
    inbounds: ["Nao quero fazer call queria ver os valores dos planos"],
    expect: { result: "preco-humano", sent: [/^Entendo Rafael, vou pedir pra alguém do time falar contigo por aqui$/], notSent: [/^Consigo /, /planos diferentes/], sdrLog: { handoffKind: "preco" } },
  },
  {
    id: "C-R050-04", title: "Leonardo (25/10): 'não entendem muito sobre compatibilidade e valores médios de mercado' NÃO é pedido de preço: é dor (OEM) e a resposta segue a dor",
    rules: ["R-050", "R-045"],
    world: { sdrBot: V2, todayFree: true, lead: { sourcePain: "OEM", niche: "autopecas" }, messages: [{ direction: "out", author: "sdr-bot", text: "Oiii Rafael, tudo bem? Hoje você monta os anúncios de autopeças manualmente pelo código OEM?", at: ISO("2026-08-19T12:00:00Z") }] },
    ai: [{ acao: "responder", mensagens: ["Entendi Rafael, a compatibilidade e a pesquisa de mercado são justamente o que o Lever OEM entrega pronto pelo código"], oferecer: true }],
    inbounds: ["Hoje temos uma equipe de anúncios que executa muito bem o serviço mas não entendem muito sobre compatibilidade e valores médios de mercado"],
    expect: { result: "responder", sent: [/Lever OEM entrega pronto/, /^Consigo /], notSent: [/investimento/i], state: "engajado" },
  },
  {
    id: "C-R050-05", title: "Caio (26/10): 'tem algum custo?' é sobre a demonstração: 'não tem custo nenhum' + a escolha do horário, sem a escada de preço",
    rules: ["R-050"],
    world: {
      sdrBot: V2,
      messages: [
        { direction: "out", author: "sdr-bot", text: PITCH, at: ISO("2026-08-19T12:00:00Z") },
        { direction: "in", text: "sim, ajudaria", at: ISO("2026-08-19T12:30:00Z") },
        { direction: "out", author: "sdr-bot", text: "Consigo amanhã às 9h ou às 11h, qual fica melhor pra você?", at: ISO("2026-08-19T12:31:00Z") },
      ],
    },
    ai: [{ acao: "responder", mensagens: ["O investimento é de acordo com as necessidades da sua operação"], oferecer: false }],
    inbounds: ["tem algum custo ?"],
    expect: { result: "custo-demo", sent: [/^Rafael, a demonstração não tem custo nenhum/, /^Fica melhor amanhã às 9h ou às 11h\?$/], notSent: [/investimento/], sdrLog: { priceGuardAt: undefined } },
  },
  {
    id: "C-R040-03", title: "Gustavo (29/10): 'Pode ser amanhã?' + 'Hoje no período da tarde vou estar ocupado' recebe AMANHÃ, nunca o par de hoje de novo",
    rules: ["R-040", "R-032"],
    world: {
      sdrBot: V2, todayFree: true,
      messages: [
        { direction: "out", author: "sdr-bot", text: PITCH, at: ISO("2026-08-19T12:00:00Z") },
        { direction: "in", text: "sim", at: ISO("2026-08-19T12:30:00Z") },
        { direction: "out", author: "sdr-bot", text: "Consigo hoje às 15h ou às 17h, qual fica melhor pra você?", at: ISO("2026-08-19T12:31:00Z") },
        { direction: "in", text: "Pode ser amanhã?", at: ISO("2026-08-19T12:59:00Z") },
      ],
    },
    ai: [{ acao: "responder", mensagens: ["Tranquilo Rafael, vamos ajustar então"], oferecer: true }],
    inbounds: ["Hoje no período da tarde vou estar ocupado"],
    expect: { result: "responder", sent: [/Tranquilo Rafael/, /^Consigo amanhã às 9h ou às 11h, qual fica melhor pra você\?$/], notSent: [/hoje às 15h/] },
  },
  {
    id: "C-R084-02", title: "Ariel (29/10): 'Estou em viagem' é adiamento: 'me chama quando voltar' sem oferta de horário",
    rules: ["R-084", "R-031"],
    world: { sdrBot: V2, lead: { sourcePain: "OEM", niche: "autopecas" }, messages: [{ direction: "out", author: "sdr-bot", text: PITCH, at: ISO("2026-08-19T12:00:00Z") }, { direction: "in", text: "sim", at: ISO("2026-08-19T12:30:00Z") }] },
    ai: [{ acao: "responder", mensagens: ["Tranquilo Rafael, sem problemas", "Quando estiver de volta, me chama aqui e combinamos a demonstração"], oferecer: true }],
    inbounds: ["Estou em viagem"],
    expect: { result: "responder", sent: [/Quando estiver de volta/], notSent: [/^Consigo /, /Fica melhor/] },
  },
  {
    id: "C-R035-02", title: "Alonso (28/10): '17 horas por favor' ao resgate de no-show remarca ÀS 17h mesmo que a IA escolha outro id",
    rules: ["R-035", "R-116"],
    world: {
      sdrBot: V2, todayFree: true,
      lead: { stage: "No show", callAt: "2026-08-18T09:00", closer: "pl", email: "r@x.com", callUrl: "https://meet.google.com/abc" },
      messages: [{ direction: "out", author: "sdr-bot", text: "Oi Rafael, passei no nosso horário marcado e não te encontrei, acontece! Quer que eu remarque? Tenho amanhã às 10h ou às 17h livres, me diz qual fica bom que eu já reservo.", at: ISO("2026-08-19T12:05:00Z") }],
    },
    ai: [{ acao: "remarcar", slotIds: [], horario: "2026-08-20T10:30" }],
    inbounds: ["17 horas por favor"],
    expect: { result: "remarcar", sent: [/amanhã \(20\/08\) às 17h/], lead: { callAt: "2026-08-20T17:00" } },
  },
  {
    id: "C-R090-03", title: "Gustavo (29/10): 'Quero solicitar a liberação do meu cadastro' é onboarding: encaminha pro time, sem oferta",
    rules: ["R-090", "R-081"],
    world: { sdrBot: V2 },
    ai: [{ acao: "responder", mensagens: ["Claro, com o Lever OEM você digita o código e recebe o anúncio completo"], oferecer: true }],
    inbounds: ["Olá! Quero solicitar a liberação do meu cadastro na LeverAds. Email: comercial@lumosdigital.com.br"],
    expect: { result: "cadastro", sent: [/encaminhar aqui pro time responsável pela liberação/], notSent: [/^Consigo /], sdrLog: { handoffKind: "cadastro" } },
  },
  {
    id: "C-R001-03", title: "Guilherme (28/10): 'Seu robô tá com defeito… odeio esses atendimentos automatizados' pede desculpa e chama gente, sem M2 por cima",
    rules: ["R-001", "R-081"],
    world: {
      sdrBot: V2, lead: { sourcePain: "OEM", niche: "autopecas" },
      messages: [
        { direction: "out", author: "sdr-bot", text: "Oiii Rafael, tudo bem? Recebemos aqui seu interesse, com o Lever OEM você digita o código e recebe o anúncio completo. Isso ajudaria na sua operação?", at: ISO("2026-08-19T12:00:00Z") },
        { direction: "in", text: "Criar anúncio msm", at: ISO("2026-08-19T12:31:00Z") },
      ],
    },
    ai: [{ acao: "responder", mensagens: ["Perfeito Rafael"], oferecer: true }],
    inbounds: ["Seu robô ta com defeito .... Por isso odeio esses atendimentos automatizados"],
    expect: { result: "reclamacao", sent: [/^Desculpa Rafael, vou te passar agora pra alguém do time/], notSent: [/Tenho agenda/, /^Consigo /], sdrLog: { handoffKind: "reclamacao" } },
  },
  {
    id: "C-R083-03", title: "Matheus (28/10): áudio longo com 'não tenho mais de uma conta' NÃO é desinteresse: a conversa segue com a IA",
    rules: ["R-083"],
    world: {
      sdrBot: V2, todayFree: true, lead: { sourcePain: "OEM", niche: "autopecas" },
      messages: [
        { direction: "out", author: "sdr-bot", text: PITCH, at: ISO("2026-08-19T12:00:00Z") },
        { direction: "in", text: "Mercado livre", at: ISO("2026-08-19T12:26:00Z") },
        { direction: "out", author: "sdr-bot", text: "Consigo hoje às 11h ou às 13h, qual fica melhor pra você?", at: ISO("2026-08-19T12:33:00Z") },
      ],
    },
    ai: [{ acao: "responder", mensagens: ["Entendi Rafael, a parte do anúncio é justamente o que o especialista mostra com um código seu"], oferecer: false }],
    inbounds: ["Eu creio que seja isso porque eu tenho uma conta só hoje, não tenho mais de uma. Eh, a parte do anúncio que eu acredito que é algo mais, mais assim, mais, não vou falar difícil, mas ele é pouco mais, ai Jesus, mas gelatinoso, talvez nove, a palavra que eu tô buscando, complexo, mas um pouco mais complexo. E a parte do estoque tá de boa também, o atendimento, eu consigo manter com a demanda atual, mas essa parte dos anúncios, creio que eu acredito que precise de um pouco mais de padrão."],
    expect: { result: "responder", sent: [/Entendi Rafael/], notSent: [/Se fizer sentido retomar mais pra frente/], sdrLog: { handoffKind: undefined } },
  },
  {
    id: "C-R023-02", title: "Leo (29/10): a IA escolheu 10h30 sem o lead pedir hora quebrada: o motor marca 10h (hora cheia)",
    rules: ["R-023", "R-035"],
    world: {
      sdrBot: V2, todayFree: true,
      lead: { stage: "No show", callAt: "2026-08-18T09:00", closer: "pl", email: "r@x.com", callUrl: "https://meet.google.com/abc" },
      messages: [{ direction: "out", author: "sdr-bot", text: "Oi Rafael, passei no nosso horário marcado e não te encontrei, acontece! Quer que eu remarque? Tenho amanhã às 10h ou às 17h livres, me diz qual fica bom que eu já reservo.", at: ISO("2026-08-19T12:05:00Z") }],
    },
    ai: [{ acao: "remarcar", slotIds: [], horario: "2026-08-20T10:30" }],
    inbounds: ["o primeiro, por favor"],
    expect: { result: "remarcar", sent: [/amanhã \(20\/08\) às 10h,/], lead: { callAt: "2026-08-20T10:00" } },
  },
  {
    id: "C-R023-03", title: "Lead pediu 10h30 explicitamente: a hora quebrada vale e a IA recebe os :30 na lista",
    rules: ["R-023"],
    world: {
      sdrBot: V2, todayFree: true,
      messages: [{ direction: "out", author: "sdr-bot", text: PITCH, at: ISO("2026-08-19T12:00:00Z") }, { direction: "in", text: "sim", at: ISO("2026-08-19T12:30:00Z") }, { direction: "out", author: "sdr-bot", text: "Consigo amanhã às 9h ou às 11h, qual fica melhor pra você?", at: ISO("2026-08-19T12:31:00Z") }],
    },
    ai: [{ acao: "agendar", slotIds: [], horario: "2026-08-20T10:30" }],
    inbounds: ["consegue às 10h30?"],
    expect: { result: "agendar", sent: [/amanhã \(20\/08\) às 10h30/], lead: { callAt: "2026-08-20T10:30" } },
  },
];
