// Sequências de e-mail (2026-08-16) — as 10 réguas do plano de e-mail marketing,
// uma por etapa do funil da LeverAds, criadas TODAS EM RASCUNHO pro Leo revisar
// e editar na tela Disparos → Sequências antes de ativar.
//
// Roda da RAIZ do repo: lê .env e escreve no DB compartilhado (= prod).
//   node packages/api/scripts/2026-08-16-seed-sequencias-email.mjs
//
// Idempotente: cada régua carrega um `code` (F1..F10) e o script PULA a que já
// existe, então rodar de novo não duplica nem sobrescreve o que o Leo editou.
//
// Por que o e-mail agora: o campo entrou no formulário do diagnóstico em
// 16/08/2026 (migrateFormEmailContato), então todo lead novo passa a chegar com
// endereço. Antes disso a base tinha 163 e-mails em 999 leads.
//
// Regras de copy: primeira pessoa, frase curta, um número por e-mail, pergunta
// no fim, sem travessão. Os tokens {{contas}} {{anuncios}} {{nicho}} carregam a
// resposta CRUA do formulário ("3-5", "500-2000") e ficam VAZIOS em lead antigo,
// então só entram nas réguas que atendem lead novo (F1). O resto usa {{nome}},
// que está preenchido em toda a base.
import fs from "node:fs";
import pg from "pg";

const SAAS = "leverads";
const AUTOR = "seed-2026-08-16";

// Saídas: as três primeiras nascem ligadas na API; `stageLeft` é opt-in e é o
// que impede o lead de ficar em duas réguas vizinhas ao mesmo tempo.
const SAIDA_PADRAO = { won: true, booked: true, optOut: true, stageLeft: true };
// Pré-call e resgate: a call é a ENTRADA da régua, não a saída.
const SAIDA_PRECALL = { won: true, booked: false, optOut: true, stageLeft: true };
// Cliente: sair por "fechou" apagaria o público inteiro no primeiro ciclo.
const SAIDA_CLIENTE = { won: false, booked: false, optOut: true, stageLeft: true };

const email = (delayDays, subject, body) => ({ channel: "email", delayDays, subject, body: body.trim() });
const whats = (delayDays, text) => ({ channel: "whatsapp", delayDays, text: text.trim() });

const SEQUENCIAS = [

  // ── F1 ────────────────────────────────────────────────────────────────────
  {
    code: "F1",
    name: "F1 · Novo lead · o diagnóstico prometido",
    trigger: { stages: ["Novo lead"] },
    exitOn: SAIDA_PADRAO,
    steps: [
      email(0, "Seu diagnóstico ficou pronto, {{nome}}", `
Oi {{nome}}, aqui é o Leo, da LeverAds.

Você acabou de responder que opera {{contas}} contas somando Mercado Livre e Shopee, e que a maior tem {{anuncios}} anúncios publicados.

Nesse tamanho, manter as contas iguais na mão come dezenas de horas por mês do seu time, todo mês, só pra preço e estoque não desencontrarem. É trabalho que não aparece em lugar nenhum e sai caro.

O que a gente faz é transformar isso numa operação só. O catálogo da conta principal sobe nas outras em horas, com preço e atributo certos, sem ninguém recadastrando nada.

Duas perguntas, que dá pra responder aqui mesmo:

1. Hoje vocês replicam na mão ou já tentaram alguma ferramenta?
2. Tem alguma conta parada esperando catálogo?

Abraço,
Leo
`),
      email(1, "Como {{contas}} contas viram uma operação só", `
Oi {{nome}},

Ontem te mandei o número. Hoje quero te mostrar como funciona, porque quase todo mundo imagina errado.

São três etapas:

1. Clonagem. A gente lê o catálogo da sua conta principal e publica nas outras, com título, foto, ficha e variação. O que levava semanas passa a levar horas.

2. Conta-mãe. Uma das contas vira a referência. Mudou preço ou estoque nela, as outras acompanham no mesmo dia. Ninguém precisa lembrar de replicar.

3. Atributos. É onde a maioria perde venda. Ficha incompleta não aparece no filtro de busca do marketplace, e anúncio que não aparece não vende, por melhor que seja o preço.

Não tem instalação, não tem plugin, e seu time não precisa aprender ferramenta nova. A gente opera.

Faz sentido pra sua operação hoje?

Leo
`),
      whats(2, `
Oi {{nome}}, aqui é da LeverAds. Te mandei dois e-mails com o diagnóstico da sua operação. Queria só entender uma coisa antes de te propor qualquer coisa: hoje quem cuida de subir anúncio nas suas contas é alguém do time ou é você mesmo?
`),
      email(3, "105% em seis meses, sem contratar ninguém", `
Oi {{nome}},

Não vou insistir muito, mas queria te deixar um caso antes de sumir.

Um cliente nosso espelhou a conta principal em mais contas e subiu 105% de faturamento em seis meses. Não contratou ninguém pra isso. O catálogo era o mesmo, o produto era o mesmo, o que mudou foi quantas vitrines estavam mostrando ele.

Se quiser ver funcionando antes de qualquer conversa de preço, a gente faz o seguinte: escolhe 10 dos seus melhores anúncios e sobe numa outra conta sua em até 2 horas. Sem call, sem contrato, sem cartão. Você só olha o resultado na sua conta.

Topa?

Leo
`),
    ],
  },

  // ── F2 ────────────────────────────────────────────────────────────────────
  {
    code: "F2",
    name: "F2 · Qualificando · quando o SDR não alcança",
    trigger: { stages: ["Qualificando"] },
    exitOn: SAIDA_PADRAO,
    steps: [
      email(1, "{{nome}}, uma pergunta sobre a sua operação", `
Oi {{nome}}, aqui é o Leo, da LeverAds.

A gente tentou falar com você por telefone e não conseguiu, então vou direto ao ponto por escrito.

Quantas horas por semana alguém do seu time gasta copiando anúncio de uma conta pra outra?

Pergunto porque na maioria das operações que a gente atende essa resposta é maior do que o dono imagina. Quando a pessoa senta e conta, costuma passar de um dia de trabalho por semana. Isso é uma pessoa quase inteira, só pra deixar contas iguais.

É esse o seu caso?

Leo
`),
      email(2, "Se sua conta principal cair amanhã", `
Oi {{nome}},

Outro ângulo, porque nem toda operação sente o problema do jeito que descrevi ontem.

Se sua conta principal for bloqueada amanhã de manhã, quanto tempo sua operação aguenta?

A parte que dói não é o bloqueio em si. É que reconstruir o catálogo em outra conta leva semanas de cadastro na mão, e nesse tempo o faturamento simplesmente para. Quem tem as outras contas já abastecidas troca de vitrine no mesmo dia e mal sente.

Não é discurso de medo, é a razão pela qual metade dos nossos clientes chegou aqui.

Sua operação depende de uma conta só?

Leo
`),
      whats(2, `
Oi {{nome}}, aqui é da LeverAds. Te mandei dois e-mails e não quero ficar insistindo à toa. Me responde só uma coisa: replicar anúncio entre contas é assunto pra agora ou pra daqui uns meses? Qualquer uma das duas respostas me serve.
`),
      email(2, "Seu concorrente aparece cinco vezes na busca", `
Oi {{nome}},

Último ângulo e paro.

Faz uma busca pelo seu principal produto no Mercado Livre. Conta quantos resultados da primeira página são do mesmo vendedor.

Quem opera várias contas ocupa mais espaço na vitrine. Não é truque, é aritmética: mais anúncios do mesmo produto, mais chance de ser o escolhido. E o marketplace não penaliza isso, é assim que os grandes operam.

Se o seu catálogo já é bom, esse é o crescimento mais barato que existe, porque não depende de comprar mais estoque nem de gastar mais em anúncio.

Quantas contas você tem hoje?

Leo
`),
      email(3, "Fecho seu arquivo?", `
Oi {{nome}},

Te escrevi algumas vezes nas últimas duas semanas e não quero virar barulho na sua caixa.

Se replicar anúncio entre contas não é prioridade agora, eu fecho seu arquivo por aqui e volto num momento melhor. Sem ressentimento, faz parte do meu trabalho saber a hora de parar.

Se ainda faz sentido, me responde só com um "ok" que eu retomo daqui.

Leo
`),
    ],
  },

  // ── F3 ────────────────────────────────────────────────────────────────────
  {
    code: "F3",
    name: "F3 · Call agendada · pré-call contra o furo",
    trigger: { stages: ["Call agendada"] },
    exitOn: SAIDA_PRECALL,
    steps: [
      email(1, "Quem mais entra na call?", `
Oi {{nome}}, call confirmada.

Um pedido antes: se tem mais alguém que decide contratação aí com você, me manda o nome e o e-mail que eu incluo no convite.

Não é formalidade. Na call eu abro as suas contas e mostro o catálogo sendo espelhado ao vivo, e quem vê isso costuma decidir na hora. Quando a pessoa que decide não está na sala, a gente perde duas semanas repetindo a demo por WhatsApp, e o assunto esfria.

Se decide sozinho, melhor ainda, é só me dizer que seguimos assim.

Até lá,
Leo
`),
      email(1, "Três minutos de preparo", `
Oi {{nome}},

Pra call render, separa três coisas:

1. O nome das suas contas no Mercado Livre e Shopee.
2. Quantos anúncios tem na maior delas, mesmo que seja por alto.
3. Se existe alguma conta parada, sem catálogo.

Com isso eu abro a demo já apontando pro seu catálogo real, e não pra uma conta de exemplo. A diferença é grande: você vai ver os seus produtos subindo, não os de outro vendedor.

Não precisa mandar nada antes, é só ter em mãos.

Leo
`),
      whats(1, `
Oi {{nome}}, passando só pra confirmar nossa call. Vai dar certo pra você no horário combinado? Se precisar remarcar, me fala agora que eu ajusto sem problema.
`),
    ],
  },

  // ── F4 ────────────────────────────────────────────────────────────────────
  {
    code: "F4",
    name: "F4 · No show · resgate em cinco dias",
    trigger: { stages: ["No show"] },
    exitOn: SAIDA_PADRAO,
    steps: [
      email(1, "Apareceu alguma coisa na hora?", `
Oi {{nome}},

A gente tinha uma call marcada e você não conseguiu entrar. Sem problema, acontece toda semana por aqui.

Não vou perguntar o motivo, vou só te devolver a escolha: prefere no começo da manhã ou no fim da tarde?

Me responde com uma dessas duas e eu mando o convite novo hoje mesmo.

Leo
`),
      whats(1, `
Oi {{nome}}, nossa call acabou não rolando. Sem stress. Quer que eu remarque pra manhã ou pra fim de tarde? Me diz só isso que eu já mando o convite.
`),
      email(3, "Remarco ou fecho?", `
Oi {{nome}},

Tentei duas vezes e não quero ficar te perseguindo na agenda.

Se ainda faz sentido ver a ferramenta rodando nas suas contas, me responde com um horário qualquer e eu me viro pra encaixar.

Se o momento passou, também tudo bem. Me avisa que eu paro por aqui e volto quando você quiser.

Leo
`),
    ],
  },

  // ── F5 ────────────────────────────────────────────────────────────────────
  {
    code: "F5",
    name: "F5 · Follow-up · a proposta na mesa",
    trigger: { stages: ["Follow-up"] },
    exitOn: SAIDA_PADRAO,
    steps: [
      email(1, "O resumo do que combinamos", `
Oi {{nome}},

Deixando por escrito o que a gente conversou, pra você poder repassar pra quem precisar decidir junto:

1. A gente espelha o catálogo da sua conta principal nas outras contas, com preço, ficha e variação certos.
2. Depois disso, mudança na conta principal reflete nas outras no mesmo dia, sem ninguém replicar na mão.
3. A operação é nossa. Seu time não precisa aprender ferramenta nem parar o que está fazendo.
4. A entrada é o cadastro inicial, e o acompanhamento segue depois dele.

Se ficou alguma dúvida que eu não respondi na call, me manda que eu respondo aqui mesmo, por escrito.

Leo
`),
      email(2, "Por que semestral e não mensal", `
Oi {{nome}},

A pergunta que mais aparece depois da call é sobre o plano, então vou explicar o raciocínio.

O trabalho pesado é o começo: subir o catálogo inteiro nas contas novas e deixar os atributos certos. Isso acontece uma vez e é o que mais custa. O que vem depois é manutenção, e é aí que o valor se acumula.

Num plano curto demais, você paga o começo e sai antes de colher. É como abrir uma conta nova no marketplace e fechar no segundo mês, quando o algoritmo ainda está aprendendo que seus anúncios existem.

Compara com o outro lado: quanto custa por mês a pessoa que hoje faz esse trabalho na mão na sua operação, contando salário e encargos. Na maioria das operações que a gente atende, essa conta sozinha já paga o plano.

Quer que eu simule com os seus números?

Leo
`),
      email(3, "Começar agora custa menos que começar em janeiro", `
Oi {{nome}},

Uma coisa prática sobre timing.

Conta nova no marketplace não vende bem no primeiro dia. Leva de duas a três semanas pro algoritmo entender que aqueles anúncios existem e começar a mostrar. Isso não tem atalho, e vale pra qualquer vendedor.

Ou seja: quem sobe catálogo agora chega na alta com as contas já maduras. Quem sobe na véspera paga o mesmo e colhe menos, porque gasta a melhor parte da temporada esperando o marketplace aprender.

Não é pressa artificial, é só como o calendário funciona.

Faz sentido a gente começar esse mês?

Leo
`),
      email(4, "Dez anúncios seus, rodando em duas horas", `
Oi {{nome}},

Se o que está travando é dúvida se funciona mesmo na sua operação, resolve assim.

A gente pega 10 dos seus melhores anúncios e sobe numa outra conta sua em até 2 horas. Sem contrato, sem cartão, sem call nova. Você abre a conta e vê.

Se o resultado não te convencer, a gente encerra o assunto e eu não te escrevo mais sobre isso.

Me manda um "pode" que eu coloco na fila hoje.

Leo
`),
      email(5, "Fecho seu arquivo?", `
Oi {{nome}},

A gente conversou, você viu a ferramenta e eu te mandei o que precisava. De lá pra cá não tivemos retorno, e isso normalmente quer dizer uma de três coisas: mudou a prioridade, faltou verba, ou apareceu outra urgência.

Qualquer uma dessas é resposta legítima e não muda em nada o que eu penso da sua operação.

Se for pra pausar, me diz que eu fecho seu arquivo e volto daqui uns meses. Se for pra seguir, me diz o que falta que eu resolvo.

Leo
`),
    ],
  },

  // ── F6 ────────────────────────────────────────────────────────────────────
  {
    code: "F6",
    name: "F6 · Nutrição · presença por oito semanas",
    trigger: { stages: ["Nutrição"] },
    exitOn: SAIDA_PADRAO,
    steps: [
      email(1, "105% em seis meses espelhando a conta principal", `
Oi {{nome}}, aqui é o Leo, da LeverAds.

A gente chegou a conversar sobre replicar seus anúncios entre contas e o assunto ficou parado. Sem cobrança, é assim mesmo, cada coisa tem sua hora.

Enquanto isso, um caso que talvez te interesse: um cliente nosso espelhou a conta principal em outras contas e subiu 105% de faturamento em seis meses. Mesmo catálogo, mesmo produto, sem contratar ninguém. O que mudou foi quantas vitrines estavam mostrando ele.

Vou te mandar uma coisa por semana daqui pra frente, sempre curta. Se em algum momento fizer sentido retomar, é só responder.

Leo
`),
      email(7, "Quanto custa abrir uma conta nova na mão", `
Oi {{nome}},

A conta que quase ninguém faz.

Cadastrar um anúncio direito leva de 4 a 8 minutos, contando título, ficha, foto e variação. Numa conta com 500 anúncios, isso é entre 33 e 66 horas de trabalho. Perto de duas semanas de uma pessoa, só pra abastecer uma conta.

E não acaba aí. Depois de abastecida, cada mudança de preço ou estoque tem que ser repetida em toda conta, pra sempre.

É por isso que muita operação abre a segunda conta, se cansa, e deixa ela parada com meia dúzia de anúncios.

Sua operação tem alguma conta nessa situação?

Leo
`),
      email(7, "Clonagem, conta-mãe, atributos", `
Oi {{nome}},

Como a gente resolve isso, em três etapas:

1. Clonagem. Lemos o catálogo da conta principal e publicamos nas outras, com título, ficha, foto e variação.

2. Conta-mãe. Uma conta vira a referência. Mudou preço ou estoque nela, as outras acompanham no mesmo dia.

3. Atributos. É onde a maioria perde venda sem perceber. Ficha incompleta não entra nos filtros de busca do marketplace, e anúncio que não aparece no filtro não vende, mesmo com preço bom.

Sem instalação e sem plugin. A operação é nossa, seu time não muda de rotina.

Leo
`),
      email(7, "Bloqueio não avisa", `
Oi {{nome}},

Um assunto desconfortável, mas que aparece toda semana nas conversas.

Conta bloqueada não manda aviso prévio. E quando acontece, a diferença entre uma semana ruim e um trimestre perdido é uma só: ter ou não ter as outras contas já abastecidas.

Quem tem, troca a vitrine no mesmo dia e o faturamento mal sente. Quem não tem, passa semanas recadastrando catálogo na mão enquanto a receita fica parada.

Não é venda de medo. É a razão pela qual boa parte dos nossos clientes chegou aqui depois do susto, e não antes.

Sua operação hoje aguentaria perder a conta principal?

Leo
`),
      email(7, "Peça sem compatibilidade não aparece na busca", `
Oi {{nome}},

Este vale pra quem vende autopeças. Se não é o seu caso, ignora que semana que vem volto ao normal.

Quem procura peça no Mercado Livre busca pelo carro ou pelo código original. Se o seu anúncio não tem a compatibilidade preenchida, ele simplesmente não entra nesse resultado. Não é questão de preço nem de reputação, ele não é mostrado.

Preencher isso na mão é inviável: uma peça pode servir em dezenas de modelos e anos.

A gente publica pelo código original e monta a compatibilidade junto. Você manda a lista de códigos, a gente devolve os anúncios publicados na sua conta.

Quantas peças do seu estoque ainda não estão anunciadas?

Leo
`),
      email(7, "O que a gente faz nas primeiras duas horas", `
Oi {{nome}},

Uma dúvida que sempre aparece: quanto trabalho isso dá pro time do cliente.

A resposta honesta é quase nenhum. O que a gente precisa de você é o acesso às contas. Daí em diante:

Nas primeiras 2 horas, o catálogo da conta principal começa a subir nas outras.
No mesmo dia, você já consegue abrir as contas e ver os anúncios publicados.
Nas semanas seguintes, o marketplace vai dando tração pros anúncios novos.

Seu time não instala nada, não aprende ferramenta nova e não muda a rotina.

Leo
`),
      whats(7, `
Oi {{nome}}! Aqui é da LeverAds. Proposta sem call e sem custo: eu clono 10 dos seus melhores anúncios pra outra conta sua em menos de 2 horas, e você só olha o resultado rodando. Topa ver?
`),
      email(7, "Fecho seu arquivo?", `
Oi {{nome}},

Cheguei ao fim do que tinha pra te mandar e não quero encher sua caixa sem retorno.

Se replicar anúncio entre contas não é prioridade agora, eu fecho seu arquivo e volto num momento melhor. Sem ressentimento.

Se ainda faz sentido, me responde com um "ok" que eu te mostro rodando nas suas contas, sem call.

Leo
`),
    ],
  },

  // ── F7 ────────────────────────────────────────────────────────────────────
  {
    code: "F7",
    name: "F7 · Desqualificado · só os recuperáveis (conferir público)",
    trigger: { stages: [] },
    exitOn: SAIDA_PADRAO,
    steps: [
      email(1, "Mudou alguma coisa aí desde a última vez?", `
Oi {{nome}}, aqui é o Leo, da LeverAds.

A gente conversou faz um tempo e na época não era o momento. Estou voltando por um motivo simples: operação de marketplace muda rápido, e o que não fazia sentido há alguns meses às vezes faz agora.

Três coisas que costumam mudar o cenário: abriu conta nova, tomou algum bloqueio, ou o time que cuidava dos anúncios diminuiu.

Alguma dessas aconteceu por aí?

Leo
`),
      email(7, "O que mudou aqui", `
Oi {{nome}},

Justo é eu contar o que mudou do meu lado também, porque quando a gente falou o cardápio era menor.

Hoje tem porta de entrada pra operação de qualquer tamanho:

1. Um plano parcial, pra quem tem poucas contas e não precisa do pacote cheio.
2. Publicação por código original com compatibilidade pronta, cobrada por cota mensal de anúncios. Vale muito pra autopeças.
3. Clonagem avulsa, cobrada uma vez só, sem mensalidade. Você paga o cadastro do catálogo e pronto.

Essa terceira não existia quando a gente conversou, e é a que costuma resolver pra quem achou o plano grande demais.

Alguma delas encaixa melhor no seu momento?

Leo
`),
      email(14, "Último e-mail", `
Oi {{nome}},

Este é o último. Se não fizer sentido, não te escrevo mais sobre isso.

Se um dia você abrir uma conta nova, tomar um bloqueio, ou simplesmente cansar de replicar anúncio na mão, é só responder este e-mail que a gente retoma de onde parou.

Obrigado pela atenção até aqui.

Leo
`),
    ],
  },

  // ── F8 ────────────────────────────────────────────────────────────────────
  {
    code: "F8",
    name: "F8 · Mentoria · quem ainda não vende",
    trigger: { stages: ["Mentoria"] },
    exitOn: SAIDA_PADRAO,
    steps: [
      email(1, "O primeiro anúncio é o mais difícil", `
Oi {{nome}}, aqui é o Leo.

Você preencheu nosso diagnóstico e respondeu que ainda não vende em marketplace. A LeverAds é pra quem já vende e quer escalar, então na hora ela não te serve, e eu não vou te empurrar.

Mas eu levo essa lista a sério, então vou te mandar de vez em quando o que a gente aprendeu vendo centenas de operações começarem.

Começo pelo mais importante: o primeiro anúncio é o mais difícil e quase ninguém acerta de primeira. Não porque seja complicado, mas porque a maioria começa escolhendo o produto errado. Produto que o dono gosta, e não produto que o marketplace já mostra que vende.

Você já tem produto definido ou ainda está escolhendo?

Leo
`),
      email(14, "Os três erros que travam a primeira venda", `
Oi {{nome}},

Os três que mais aparecem, na ordem:

1. Produto escolhido pelo gosto. O marketplace mostra a demanda de graça, na própria busca. Dá pra escolher olhando o que já vende, em vez de apostar.

2. Ficha técnica pela metade. Anúncio com ficha incompleta não entra nos filtros de busca. A pessoa procura, seu produto existe, e mesmo assim não aparece.

3. Preço definido pela margem que se quer ter, e não pela faixa em que o produto é comprado. Fora da faixa, o anúncio não recebe visita, e sem visita não tem venda pra ajustar depois.

Os três são de graça pra corrigir. Custam atenção, não dinheiro.

Leo
`),
      email(14, "Como a gente acompanha quem está começando", `
Oi {{nome}},

Falei dos erros. Agora o que a gente faz com quem quer começar de verdade.

É um acompanhamento em consultas, uma a uma, olhando a sua operação e não um curso gravado. A gente escolhe o produto junto, monta o primeiro anúncio junto, e ajusta o que não estiver funcionando na consulta seguinte.

Não é conteúdo. É alguém olhando a sua conta e dizendo o que fazer em seguida.

Se quiser saber como funciona e quanto custa, me responde que eu te explico sem compromisso.

Leo
`),
      email(14, "Quando você começar a vender, a gente volta a conversar", `
Oi {{nome}},

Fecho por aqui pra não virar barulho.

Se em algum momento você começar a vender e chegar no ponto de precisar de mais de uma conta, me escreve. Aí sim a LeverAds passa a fazer sentido, e a conversa é outra.

E se quiser o acompanhamento pra chegar lá mais rápido, é só responder este e-mail.

Boa sorte,
Leo
`),
    ],
  },

  // ── F9 ────────────────────────────────────────────────────────────────────
  {
    code: "F9",
    name: "F9 · Ganho e Integração · onboarding",
    trigger: { stages: ["Ganho", "Integração"] },
    exitOn: SAIDA_CLIENTE,
    steps: [
      email(1, "Bem-vindo. O que acontece nos próximos sete dias", `
Oi {{nome}}, bem-vindo à LeverAds.

Pra você não ficar no escuro, este é o roteiro:

Dias 1 e 2: a gente pega os acessos das suas contas e mapeia o catálogo da principal.
Dias 3 e 4: o catálogo começa a subir nas outras contas, com ficha e variação.
Dias 5 a 7: revisão dos atributos, que é o que decide se o anúncio aparece na busca.

O que precisa de você é só o acesso às contas. O resto é nosso.

A partir daí, anúncio novo na conta principal passa a aparecer nas outras sem ninguém replicar na mão.

Qualquer dúvida no meio do caminho, é só responder aqui.

Leo
`),
      email(2, "Faltam duas coisas suas", `
Oi {{nome}},

Só um lembrete rápido do que ainda depende de você:

1. Acesso às contas do Mercado Livre e Shopee que entram na operação.
2. Confirmar qual delas é a conta principal, a que vai servir de referência pras outras.

É o único ponto do processo em que a gente fica parado esperando. Assim que chegar, o catálogo começa a subir no mesmo dia.

Se tiver qualquer dificuldade com o acesso, me fala que a gente faz junto por chamada.

Leo
`),
      email(5, "Suas contas já estão espelhadas", `
Oi {{nome}},

Está no ar. O catálogo da sua conta principal já subiu nas outras contas, com ficha, foto e variação.

De hoje em diante, anúncio novo na principal aparece nas outras sem ninguém replicar. Mudou preço ou estoque, as outras acompanham.

Uma coisa importante pro seu planejamento: conta nova leva de duas a três semanas pra ganhar tração na busca. Não estranha se a primeira semana vier fraca, é o marketplace aprendendo que aqueles anúncios existem. É assim com todo vendedor e não tem atalho.

Pode abrir as contas e conferir. Se achar algo fora do lugar, me fala que a gente ajusta.

Leo
`),
      email(14, "Uma pergunta só", `
Oi {{nome}},

Três semanas de operação. Quero saber como está indo, e prometo que é rápido.

De 0 a 10, o quanto você recomendaria a LeverAds pra outro vendedor?

Pode responder só com o número. Se quiser escrever o motivo, melhor ainda, mas o número já me serve.

Se tiver algo travando, este é o melhor momento pra me contar, enquanto dá pra corrigir.

Leo
`),
      email(9, "Duas pessoas que você indicaria", `
Oi {{nome}},

Um mês de casa. Se o resultado está fazendo sentido, tenho um pedido.

Pensa em duas pessoas que também vendem em marketplace e sofrem com o mesmo problema que você tinha. Me manda o nome delas e eu falo com elas, sem usar o seu nome se preferir.

Indicação é de longe a melhor origem de cliente que a gente tem, porque chega com confiança que anúncio nenhum compra.

E se o resultado ainda não está no ponto de você indicar, me diz o que falta. Isso me serve tanto quanto a indicação.

Leo
`),
    ],
  },

  // ── F10 ───────────────────────────────────────────────────────────────────
  {
    code: "F10",
    name: "F10 · Acompanhamento · expansão e renovação",
    trigger: { stages: ["Acompanhamento"] },
    exitOn: SAIDA_CLIENTE,
    steps: [
      email(1, "Seu mês na LeverAds", `
Oi {{nome}},

Resumo curto do que rodou na sua operação neste mês:

1. Anúncios espelhados entre as suas contas.
2. Contas ativas recebendo catálogo da principal.
3. Atributos revisados, que é o que mantém seus anúncios aparecendo nos filtros de busca.

Se quiser o detalhe por conta, me responde que eu mando.

E se tiver alguma conta que você quer priorizar no próximo mês, é só falar.

Leo
`),
      email(30, "A conta que você ainda não abriu", `
Oi {{nome}},

Uma pergunta que vale dinheiro: quantas contas você poderia estar operando hoje e não está?

Pra você a matemática é diferente de quando começou. O catálogo já está montado e a operação já roda. Abrir mais uma conta agora não é recomeçar do zero, é apontar o mesmo catálogo pra mais uma vitrine.

O custo de subir a próxima conta é uma fração do que foi a primeira, porque o trabalho pesado já foi feito.

Quer que eu simule o que a próxima conta somaria no seu faturamento?

Leo
`),
      email(30, "As peças do seu estoque que ainda não estão anunciadas", `
Oi {{nome}},

Este é pra quem vende autopeças. Se não for o seu caso, me avisa que eu tiro você desta lista.

Quase toda operação de peças tem uma parte do estoque que nunca virou anúncio, porque cadastrar compatibilidade na mão é inviável. Uma peça serve em dezenas de modelos e anos, e ninguém tem tempo pra isso.

A gente publica pelo código original com a compatibilidade montada, por cota mensal de anúncios. Você manda a lista de códigos e recebe os anúncios publicados na sua conta.

Tem lista de códigos parada aí?

Leo
`),
      email(30, "Sua renovação está chegando", `
Oi {{nome}},

Seu contrato está perto de renovar, então quero fazer isso do jeito certo, com o resultado na frente e não na pressa do vencimento.

Antes de qualquer coisa, me diz: o que funcionou melhor neste período e o que você mudaria?

Se quiser, eu monto o resumo do período pra você olhar antes de decidir. E se fizer sentido subir de plano ou incluir mais contas na renovação, esse é o melhor momento pra ajustar.

Leo
`),
      email(30, "Duas indicações, um mês por conta", `
Oi {{nome}},

Se a operação está te devolvendo o que prometemos, tenho um pedido e uma contrapartida.

Pensa em duas pessoas que vendem em marketplace e penam com o que você penava. Me manda os nomes e eu falo com elas.

Pra cada uma que fechar, você ganha um mês. E se preferir que eu não cite o seu nome, é só dizer.

Leo
`),
    ],
  },
];

// ── carga ────────────────────────────────────────────────────────────────────

const env = Object.fromEntries(
  fs.readFileSync(".env", "utf8").split("\n").filter((l) => l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const url = new URL(env.COCKPIT_DB_URL);
url.searchParams.delete("sslmode");
const pool = new pg.Pool({ connectionString: url.toString(), ssl: { rejectUnauthorized: false } });

// Mesmo formato do genId do db.js: prefixo de 2 letras + timestamp base36.
let seq = 0;
const genId = () => `se_${Date.now().toString(36)}${(seq++).toString(36).padStart(2, "0")}`;

const { rows } = await pool.query("SELECT json FROM cockpit.sequences");
const existentes = new Set(rows.map((r) => r.json?.code).filter(Boolean));

const agora = new Date().toISOString();
let criadas = 0;
for (const s of SEQUENCIAS) {
  if (existentes.has(s.code)) {
    console.log(`· ${s.code} já existe, pulando`);
    continue;
  }
  const doc = {
    id: genId(),
    code: s.code,
    saas: SAAS,
    name: s.name,
    status: "draft", // TODO do Leo: revisar a copy e ativar UMA por vez
    trigger: s.trigger,
    exitOn: s.exitOn,
    steps: s.steps,
    createdAt: agora,
    createdBy: AUTOR,
  };
  await pool.query("INSERT INTO cockpit.sequences (id, json) VALUES ($1, $2::jsonb)", [doc.id, JSON.stringify(doc)]);
  const passos = s.steps.length;
  const emails = s.steps.filter((p) => p.channel === "email").length;
  console.log(`✔ ${s.code} ${doc.id} · ${passos} passos (${emails} e-mail, ${passos - emails} WhatsApp) · gatilho: ${s.trigger.stages.join(", ") || "(nenhum, inscrição manual)"}`);
  criadas++;
}

console.log(`\n${criadas} sequências criadas em RASCUNHO, ${SEQUENCIAS.length - criadas} já existiam.`);
await pool.end();
