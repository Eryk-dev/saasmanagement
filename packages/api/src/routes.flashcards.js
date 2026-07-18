// Treinamentos — flashcards por vaga (SDR / closer / …) com repetição espaçada
// FSRS POR PESSOA (o mesmo algoritmo do Anki moderno).
//
// Três camadas, três collections:
//   `flashcards`        — a BASE oficial por produto (gestor edita pra todo o time,
//                         mesma forma de offers/metas). Card: { id, role, front, back }.
//   `training_states`   — o agendamento INDIVIDUAL: um doc por usuário×produto com o
//                         estado FSRS de cada card (due, stability, difficulty, …).
//                         Card novo na base nasce "novo" pra todos; card removido some.
//   `training_reviews`  — log append-only de cada resposta (rating 1-4). É o dashboard
//                         da equipe e a matéria-prima pra otimizar o FSRS depois.

import { applyRating, previewIntervals, dayKey, dayEnd, CARD_STATE } from "./fsrs.js";

// Cartão: { id, role, front (pergunta/gatilho), back (resposta/técnica) }.
const ROLE_LABELS = {
  geral_negocio: "Geral · Negócio",
  geral_marketplace: "Geral · Marketplaces",
  sdr: "SDR", closer: "Closer", integrator: "Integrador · CS", social: "Mídia social",
};
// Conhecimentos gerais: todo mundo passa por eles antes do baralho da vaga.
const GENERAL_ROLES = ["geral_negocio", "geral_marketplace"];

// Base oficial: 2 baralhos de conhecimentos GERAIS (Negócio + Marketplaces,
// 30 cada, a porta de entrada de todo mundo) e 30 flashcards por vaga, na voz
// da LeverAds (clona anúncios ML/Shopee entre contas). O Leo edita na tela.
const DEFAULTS = {
  leverads: [
    // ── Geral · Negócio (30) ─────────────────────────────────────────────
    { id: "ger_n_1", role: "geral_negocio", front: "O que a LeverAds faz, em 1 frase?", back: "Clona e sincroniza anúncios entre todas as contas de Mercado Livre e Shopee do cliente, sozinha. Mais exposição no marketplace, menos operação manual." },
    { id: "ger_n_2", role: "geral_negocio", front: "Quem é o nosso cliente ideal (ICP)?", back: "Lojista que já vende em marketplace (ML e/ou Shopee), opera ou quer operar mais de uma conta e sofre pra replicar anúncios na mão. Quanto mais contas e anúncios, maior o cliente." },
    { id: "ger_n_3", role: "geral_negocio", front: "As 3 etapas do nosso método", back: "1) Clonagem de anúncios entre contas · 2) Conta-mãe segurando o estoque com baixa automática (sem furo) · 3) IA completando título e atributos pro anúncio chegar com nota máxima." },
    { id: "ger_n_4", role: "geral_negocio", front: "O que é a conta-mãe no método?", back: "A conta matriz da operação: o que o cliente publica nela replica pras outras contas, e o estoque dela comanda a baixa automática em todas. Publicou na mãe, rodou na rede inteira." },
    { id: "ger_n_5", role: "geral_negocio", front: "O que a etapa de IA faz no anúncio clonado?", back: "Completa título e ficha técnica (atributos) pro anúncio chegar na conta nova com nota máxima de qualidade, o que ajuda no ranqueamento da busca." },
    { id: "ger_n_6", role: "geral_negocio", front: "As 5 dores que trazem lead ([A] a [E])", back: "[A] Subir os mesmos anúncios nas outras contas · [B] Conta banida, precisa anunciar em conta nova · [C] Gerenciar SKUs em múltiplas contas · [D] Economizar folha salarial · [E] Mais exposição pra vender mais." },
    { id: "ger_n_7", role: "geral_negocio", front: "Por que o nome do anúncio leva um código tipo [B]?", back: "O código marca a DOR que aquele criativo ataca. Ele viaja com o lead (via UTM) e permite medir qual dor traz lead que FECHA, não só lead barato (relatório Por dor)." },
    { id: "ger_n_8", role: "geral_negocio", front: "As etapas do nosso funil comercial, na ordem", back: "Novo lead → Qualificando → Call agendada → Follow-up → Ganho → Integração → Acompanhamento. Perdas saem em Perdido/Desqualificado; lead frio descansa na Nutrição." },
    { id: "ger_n_9", role: "geral_negocio", front: "Papel de cada vaga no funil", back: "SDR qualifica e AGENDA a call · Closer conduz a call e FECHA · Integrador conecta as contas e entrega · CS acompanha, retém e gera indicação. Mídia social alimenta o topo com criativos." },
    { id: "ger_n_10", role: "geral_negocio", front: "Nossa oferta principal (âncora)", back: "Plano anual: 7.188, em 12x de 599 sem juros, ou 6.488 à vista no Pix (10% de desconto). Preço fixo, sem taxa por pedido." },
    { id: "ger_n_11", role: "geral_negocio", front: "A escada de ofertas completa", back: "Anual 12x 599 (âncora, sempre primeiro) → Semestral 12x 299 → Serviço único 12x 149. Só desce na objeção real de caixa, e com validade: a condição vale naquela call." },
    { id: "ger_n_12", role: "geral_negocio", front: "O teste que oferecemos sem compromisso", back: "Clonar 10 anúncios DO LEAD na criação da conta, ao vivo na call: ~2h de trabalho manual feito em minutos, sem cartão. Ele vê o valor rodando na própria operação." },
    { id: "ger_n_13", role: "geral_negocio", front: "Case Unique: os números", back: "Conta nova clonada da conta mãe fez +105% em vendas, +98,8% em pedidos e +115% em visitas no 1º mês. Prints reais do painel do Mercado Livre." },
    { id: "ger_n_14", role: "geral_negocio", front: "Case Dyno Nutri: o número", back: "R$ 60 mil a mais em 20 dias depois de replicar a operação. É o case pra quem tem pressa de resultado." },
    { id: "ger_n_15", role: "geral_negocio", front: "Cliente pergunta se clonar canibaliza as vendas. E aí?", back: "Não canibaliza, soma: na Unique a conta 2 dobrou e a conta 1 AINDA subiu 20%. Respondemos essa objeção antes mesmo de perguntarem." },
    { id: "ger_n_16", role: "geral_negocio", front: "Por que dizemos 'a gente não quer ser teu sócio'?", back: "Nosso preço é fixo, sem percentual por pedido ou venda. O cliente escala o quanto quiser e o custo não sobe junto. É um diferencial contra concorrentes que cobram por uso." },
    { id: "ger_n_17", role: "geral_negocio", front: "O que está incluso durante o contrato?", back: "Tudo que a LeverAds lançar durante a vigência entra sem custo extra. Funcionalidade nova não vira upsell pra quem já é cliente." },
    { id: "ger_n_18", role: "geral_negocio", front: "De onde vêm nossos leads?", back: "Anúncios no Meta (Instagram/Facebook) com criativos por dor ([A] a [E]) levando pro form de diagnóstico no site, mais indicação e orgânico. O form alimenta o pipeline direto." },
    { id: "ger_n_19", role: "geral_negocio", front: "Os 6 dados da qualificação, na ordem", back: "1) Nicho · 2) Nome da loja/empresa · 3) Quantas contas de marketplace · 4) Quantos anúncios na maior conta · 5) Pretende abrir mais contas · 6) Time de marketing. E-mail por último, depois de marcar a call." },
    { id: "ger_n_20", role: "geral_negocio", front: "O que define um cliente A, B ou C?", back: "Pontos de CONTAS + ANÚNCIOS na maior conta. A = operação grande (muitas contas e milhares de anúncios), B = média, C = pequena. Lead sem resposta fica sem grade." },
    { id: "ger_n_21", role: "geral_negocio", front: "A cadência do SDR num lead novo", back: "Liga 2x em seguida; caiu na caixa, WhatsApp de apresentação. São 3 abordagens no total (1ª no Novo lead + 2 no Qualificando). Sem sucesso, o lead vai pra Nutrição." },
    { id: "ger_n_22", role: "geral_negocio", front: "Como funciona a Nutrição (lead frio)?", back: "3 contatos com 7 dias entre eles, cada um com gancho diferente: prova de resultado (case 105%) → oferta sem risco (teste de 10 anúncios) → saída elegante. Sem resposta, Desqualificado." },
    { id: "ger_n_23", role: "geral_negocio", front: "Cliente furou a call (no-show). Qual o processo?", back: "2 remarcações: a 1ª cai 1h depois do furo ('o especialista separou um novo horário'), a 2ª no dia útil seguinte com decisão clara (retoma ou encerra). Sem resposta, Desqualificado." },
    { id: "ger_n_24", role: "geral_negocio", front: "O ritual de confirmação da call", back: "1h antes: WhatsApp confirmando, com o link, pedindo logins em mãos e decisor junto. Respondeu? Mensagem de 10 min antes. Não respondeu? LIGA 10 min antes. A call já está de pé, o cliente só entra." },
    { id: "ger_n_25", role: "geral_negocio", front: "Onde a venda acontece de verdade?", back: "Na demo AO VIVO: clonar anúncios reais nas contas do lead durante a call. Nas transcrições analisadas, toda call que clonou de verdade fechou ou saiu com integração agendada." },
    { id: "ger_n_26", role: "geral_negocio", front: "Por que exigimos login em mãos e decisor presente na call?", back: "Sem login o teste ao vivo não roda e o fechamento adia. Decisor ausente nunca fechou na hora: se tem sócio, a call é COM ele. O SDR cobra os dois na confirmação." },
    { id: "ger_n_27", role: "geral_negocio", front: "A regra de ouro do fechamento", back: "Pagamento AINDA NA CALL (Pix na hora ou link em 12x) e o fechamento é agendar a integração: 'que horário amanhã pro integrador migrar teus anúncios, 13h ou 17h?'. Quem sai pra pagar depois vira cobrança." },
    { id: "ger_n_28", role: "geral_negocio", front: "O que acontece na integração?", back: "Call de vídeo de ~20 min com tela compartilhada: conecta as contas, define a conta-mãe e roda a primeira clonagem na frente do cliente. Ele sai com a operação rodando." },
    { id: "ger_n_29", role: "geral_negocio", front: "A régua de retenção do cliente", back: "Onboarding na semana 1 · Check-in no mês 1 · Revisão de resultado no mês 3 · Conversa de upsell no mês 6 · Contato de renovação 2 meses antes do fim do contrato." },
    { id: "ger_n_30", role: "geral_negocio", front: "O que fazemos com cliente dando resultado?", back: "Vira case (com autorização, divulgando a loja junto) e fonte de indicação: 'conhece outro lojista que sofre com isso? Indicou e fechou, tenho condição especial pra você'." },

    // ── Geral · Marketplaces (30) ────────────────────────────────────────
    { id: "ger_m_1", role: "geral_marketplace", front: "Por que um lojista opera VÁRIAS contas no marketplace?", back: "Mais anúncios ativos = mais portas de entrada na busca = mais chance de venda. E se uma conta cair, as outras seguram o faturamento. Multi-conta é exposição + proteção." },
    { id: "ger_m_2", role: "geral_marketplace", front: "O que acontece quando o ML suspende uma conta?", back: "Os anúncios saem do ar na hora e o faturamento daquela conta zera. Reconstruir tudo na mão leva meses. Com réplica, uma conta nova recebe os anúncios em minutos." },
    { id: "ger_m_3", role: "geral_marketplace", front: "O que costuma derrubar/suspender uma conta?", back: "Reclamações e cancelamentos em excesso, atraso de despacho, produto proibido ou denúncia de marca, dados inconsistentes. Às vezes bloqueio preventivo da própria plataforma." },
    { id: "ger_m_4", role: "geral_marketplace", front: "O que é a ficha técnica (atributos) e por que importa?", back: "Os campos estruturados do anúncio (marca, modelo, medidas...). Ficha completa melhora a qualidade do anúncio e o ranqueamento na busca. É o que nossa IA preenche pra nota máxima." },
    { id: "ger_m_5", role: "geral_marketplace", front: "O que faz um TÍTULO bom no marketplace?", back: "Produto + marca + modelo + característica principal, com os termos que o comprador busca. Sem encher de palavra repetida ou promessa. Título é o maior peso de busca depois da relevância." },
    { id: "ger_m_6", role: "geral_marketplace", front: "Anúncio Clássico vs Premium no ML", back: "Clássico: comissão menor, sem parcelamento sem juros. Premium: comissão maior e parcela sem juros pro comprador (converte mais em ticket alto). Vendedor experiente usa os dois." },
    { id: "ger_m_7", role: "geral_marketplace", front: "O que é o Catálogo do Mercado Livre?", back: "Página única por produto onde vários vendedores competem pela posição principal (tipo buy box): ganha quem tem melhor combinação de preço, reputação e entrega." },
    { id: "ger_m_8", role: "geral_marketplace", front: "Como funciona a reputação (termômetro) do ML?", back: "Vai de vermelho a verde e pesa MUITO na busca. Cai com reclamações, cancelamentos pelo vendedor e despacho com atraso, em proporção às vendas. Verde escuro é pré-requisito pra escalar." },
    { id: "ger_m_9", role: "geral_marketplace", front: "Por que furo de estoque é tão grave?", back: "Venda sem estoque vira cancelamento pelo vendedor, e cancelamento derruba reputação, que derruba TODAS as vendas. Por isso a conta-mãe faz baixa automática entre as contas." },
    { id: "ger_m_10", role: "geral_marketplace", front: "O que são Bling e Tiny? A gente compete com eles?", back: "ERPs de e-commerce (estoque, notas, pedidos). Não competimos: a LeverAds roda JUNTO com eles. O ERP cuida da retaguarda; a gente cuida da réplica e sincronização de anúncios entre contas." },
    { id: "ger_m_11", role: "geral_marketplace", front: "O que é SKU e por que preservamos na clonagem?", back: "O código interno que identifica cada produto/variação. Se muda na clonagem, o controle de estoque e o ERP do cliente quebram. Clonar mantendo SKU e atributo é parte do nosso padrão." },
    { id: "ger_m_12", role: "geral_marketplace", front: "O que são variações num anúncio?", back: "O mesmo anúncio vendendo versões do produto (cor, tamanho, voltagem), cada uma com SKU e estoque próprios. Clonagem tem que levar as variações certinhas, senão vira bagunça de estoque." },
    { id: "ger_m_13", role: "geral_marketplace", front: "Mercado Envios Full: o que é e o que muda?", back: "O estoque fica no centro de distribuição do ML, que entrega rapidíssimo. Anúncio Full ganha selo, frete melhor e destaque na busca. Exige gestão de estoque mais disciplinada." },
    { id: "ger_m_14", role: "geral_marketplace", front: "Quem paga o frete grátis no ML?", back: "Na maior parte dos casos o VENDEDOR banca (integral ou parte, conforme reputação e valor do item). Por isso margem se calcula com comissão + frete + imposto, não só o preço." },
    { id: "ger_m_15", role: "geral_marketplace", front: "Shopee em 2 traços: público e taxas", back: "Ticket médio menor e comprador muito sensível a preço e frete. Comissão por venda + programa de frete grátis. Volume alto, margem apertada: bom pra girar e ganhar exposição." },
    { id: "ger_m_16", role: "geral_marketplace", front: "Diferença de estratégia ML vs Shopee", back: "ML: catálogo, reputação e ficha técnica mandam; ticket maior. Shopee: preço, frete e volume de anúncios mandam; decisão por impulso. Nosso cliente forte replica nos dois." },
    { id: "ger_m_17", role: "geral_marketplace", front: "O que é Product Ads (ML) e Shopee Ads?", back: "Os anúncios patrocinados DENTRO do marketplace: o vendedor paga pra aparecer no topo da busca. Complementa (não substitui) a estratégia de muitos anúncios bem feitos." },
    { id: "ger_m_18", role: "geral_marketplace", front: "Por que MAIS anúncios geram mais venda?", back: "Cada anúncio é uma porta de entrada na busca: termos, fotos e preços diferentes pescam compradores diferentes. Multiplicar anúncios bons entre contas multiplica vitrine." },
    { id: "ger_m_19", role: "geral_marketplace", front: "Duplicar anúncio na MESMA conta pode?", back: "O ML pune anúncio idêntico duplicado na mesma conta. A estratégia certa é variar (título, foto, kit) ou replicar ENTRE CONTAS diferentes, que é exatamente o que a LeverAds faz." },
    { id: "ger_m_20", role: "geral_marketplace", front: "O que é OEM em autopeças e por que nos importa?", back: "O código original da peça (montadora), que define compatibilidade com os veículos. Criamos anúncios por OEM pra autopeça, com 100 criações por mês inclusas no plano." },
    { id: "ger_m_21", role: "geral_marketplace", front: "Quais anúncios clonar primeiro?", back: "Os campeões: mais vendas e melhor conversão na conta principal. Clonar o que já provou que vende encurta o caminho da conta nova até o primeiro pedido." },
    { id: "ger_m_22", role: "geral_marketplace", front: "O que é kit/combo e por que vendedores usam?", back: "Juntar produtos num anúncio só (ex.: 3 unidades, produto + acessório). Sobe ticket médio, dilui frete e cria mais uma porta de busca. Cada kit precisa de SKU e estoque próprios." },
    { id: "ger_m_23", role: "geral_marketplace", front: "Por que anúncio cai na moderação?", back: "Marca/imagem sem autorização, palavra proibida, categoria errada, promessa irreal, dados de contato no anúncio. Anúncio moderado some da busca até corrigir." },
    { id: "ger_m_24", role: "geral_marketplace", front: "Tempo de despacho: por que é sagrado?", back: "O prazo prometido de postar o pedido. Estourou, conta atraso na reputação. Operação multi-conta sem processo atrasa despacho, mais um motivo pra automatizar a retaguarda." },
    { id: "ger_m_25", role: "geral_marketplace", front: "Perguntas de compradores: qual o padrão de ouro?", back: "Responder rápido e completo. Pergunta respondida em minutos converte muito mais, e o histórico de respostas fica público no anúncio, virando prova social." },
    { id: "ger_m_26", role: "geral_marketplace", front: "Loja oficial vs vendedor comum no ML", back: "Loja oficial é a marca autorizada, com selo e página própria, e exige autorização da marca. Vendedor comum compete por reputação e preço. Nossos clientes são dos dois tipos." },
    { id: "ger_m_27", role: "geral_marketplace", front: "Conta nova ranqueia igual conta antiga?", back: "Não: começa sem histórico. Mas com anúncios campeões clonados, ficha nota máxima e primeiras vendas bem atendidas, acelera muito. O case Unique fez +105% já no 1º mês." },
    { id: "ger_m_28", role: "geral_marketplace", front: "Como se calcula margem num marketplace?", back: "Preço menos: custo do produto, comissão da plataforma, frete (quando o vendedor banca), imposto e embalagem/operação. Vender muito com margem negativa é o erro clássico." },
    { id: "ger_m_29", role: "geral_marketplace", front: "Marketplace vs loja própria (site)", back: "Marketplace dá tráfego pronto e confiança, cobrando comissão e regras. Loja própria dá margem e dados, mas exige gerar tráfego. O lojista maduro usa marketplace como motor de volume." },
    { id: "ger_m_30", role: "geral_marketplace", front: "Por que VELOCIDADE de réplica virou argumento central?", back: "Porque conta cai sem aviso e catálogo grande leva meses pra reconstruir na mão. Subir 150 anúncios em 5 a 10 minutos transforma um desastre em contratempo. É a dor [B] resolvida." },

    // ── SDR (30) ─────────────────────────────────────────────────────────
    { id: "sdr_1", role: "sdr", front: "O que a LeverAds faz, em 1 frase?", back: "Clona e sincroniza seus anúncios entre todas as contas de Mercado Livre e Shopee, sozinha. Mais exposição, menos operação e retrabalho." },
    { id: "sdr_2", role: "sdr", front: "Qual é o SEU objetivo na ligação de SDR?", back: "Confirmar os dados (nicho, contas, anúncios, expansão) e AGENDAR a call com o closer. Você qualifica e marca, não vende aqui." },
    { id: "sdr_3", role: "sdr", front: "Lead: 'me manda por WhatsApp'", back: "'Mando sim! Mas em 10 min no vídeo eu te mostro clonando um anúncio SEU de verdade, entende muito mais rápido. Prefere amanhã de manhã ou no fim da tarde?'" },
    { id: "sdr_4", role: "sdr", front: "Perguntas de qualificação, na ordem", back: "1) Nicho · 2) Nome da loja/empresa · 3) Quantas contas de marketplace · 4) Quantos anúncios na maior conta · 5) Pretende abrir mais contas · 6) Tamanho do time de marketing." },
    { id: "sdr_5", role: "sdr", front: "Lead: 'não tenho tempo agora'", back: "'É rapidinho: 20-30 min e você já sai vendo a ferramenta rodando na SUA conta. Qual o melhor horário essa semana pra eu reservar com o especialista?'" },
    { id: "sdr_6", role: "sdr", front: "Como criar urgência sem forçar?", back: "Ancore na dor ('cada dia com anúncio parado numa conta é venda indo pro concorrente') e use a agenda ('consigo encaixar amanhã 10h, seguro pra você?')." },
    { id: "sdr_7", role: "sdr", front: "Lead: 'já uso outra ferramenta'", back: "'Boa, então já sabe o valor de automatizar. Vale ver como a gente clona ENTRE ML e Shopee e mantém atributo/SKU no lugar, costuma ser o que falta. 15 min pra comparar?'" },
    { id: "sdr_8", role: "sdr", front: "Não atendeu a ligação. E agora?", back: "Liga de novo em seguida. Caiu na caixa 2×, manda o WhatsApp de apresentação e registra o toque (vai pra Qualificando e retoma amanhã). Cadência de até 5 toques." },
    { id: "sdr_9", role: "sdr", front: "O que NUNCA pode faltar antes de passar pro closer?", back: "Call agendada (dia e hora), o closer responsável e o e-mail do lead pro convite do Meet. Sem isso a call não acontece." },
    { id: "sdr_10", role: "sdr", front: "Frase de transição pra agendar a call", back: "'Fechado! Vou te colocar com nosso especialista pra você ver a ferramenta clonando um anúncio de verdade na sua operação. Melhor amanhã de manhã ou no fim da tarde?'" },
    { id: "sdr_11", role: "sdr", front: "Quem é o topo da sua fila, sempre?", back: "O lead que acabou de entrar (Novo lead). Cadastro de fim de semana se trabalha na segunda, nos primeiros horários. Velocidade no 1º toque é o que mais muda conversão." },
    { id: "sdr_12", role: "sdr", front: "WhatsApp de apresentação (não atendeu no 1º ato)", back: "'Olá [nome], tudo bem? Aqui é [eu], da LeverAds. Recebemos o seu cadastro interessado na clonagem de anúncios. Tem algum horário em que a gente possa te retornar pra conversar?'" },
    { id: "sdr_13", role: "sdr", front: "Quantas abordagens um lead recebe antes da Nutrição?", back: "3: a do Novo lead (1º ato) + 2 no Qualificando (2ª e 3ª tentativas). Cada uma com 2 ligações e um WhatsApp diferente. Depois disso, Nutrição." },
    { id: "sdr_14", role: "sdr", front: "WhatsApp da 3ª tentativa (última do Qualificando)", back: "Saída elegante pedindo decisão: 'Tentei falar com você e não consegui. Você ainda quer conhecer a LeverAds pra clonar seus anúncios, ou posso encerrar seu atendimento por enquanto?'" },
    { id: "sdr_15", role: "sdr", front: "Nutrição: ritmo e ganchos, na ordem", back: "3 contatos com 7 dias entre eles: 1º prova de resultado (case +105%) · 2º oferta sem risco (teste de 10 anúncios grátis) · 3º porta aberta (CTA de 1 palavra: 'quero ver'). Sem resposta, Desqualificado." },
    { id: "sdr_16", role: "sdr", front: "Gancho do 1º contato de Nutrição", back: "Prova: 'um cliente nosso subiu 105% as vendas depois de espelhar os anúncios entre as contas. Posso te mostrar como isso ficaria na sua operação? Leva 5 minutinhos.'" },
    { id: "sdr_17", role: "sdr", front: "Gancho do 2º contato de Nutrição", back: "Risco zero: 'a gente clona 10 dos seus melhores anúncios em menos de 1 minuto e você vê o resultado na sua própria conta antes de decidir. Preparo esse teste pra você essa semana?'" },
    { id: "sdr_18", role: "sdr", front: "Na confirmação da call, o que você COBRA do lead?", back: "Entrar já logado no ML e na Shopee (o especialista clona ao vivo nas contas dele) e trazer quem decide junto. Sem login não tem demo; sem decisor não tem fechamento." },
    { id: "sdr_19", role: "sdr", front: "10 min antes da call e o cliente não respondeu a confirmação", back: "LIGA. 'Nossa call é agora, o especialista já está na sala. Tô te mandando o link, entra que já vamos começar.' Não atendeu? Manda o link no WhatsApp com o mesmo recado." },
    { id: "sdr_20", role: "sdr", front: "No-show: como abrir a 1ª remarcação (1h depois)", back: "Sem cobrar: 'Você não conseguiu entrar na call de hoje. O especialista já separou um novo horário exclusivo pra você: prefere amanhã de manhã ou no fim da tarde?'" },
    { id: "sdr_21", role: "sdr", front: "No-show: 2ª remarcação (última)", back: "Decisão na mão dele, com firmeza: 'Ainda faz sentido escalar sua operação com nosso método? Assim eu continuo teu atendimento, ou encerro se agora não for a hora.' Sem resposta, Desqualificado." },
    { id: "sdr_22", role: "sdr", front: "Por que o e-mail é a ÚLTIMA pergunta da qualificação?", back: "Primeiro a call está marcada e o valor construído; o e-mail entra como 'pra te mandar o convite'. Pedir cedo demais soa cadastro e trava a conversa." },
    { id: "sdr_23", role: "sdr", front: "Por que abrir a loja do lead durante a ligação?", back: "Cria assunto na hora ('vi que vocês vendem X'), confirma o porte real da operação e arma o closer com contexto pra call. Loja aberta = conversa concreta." },
    { id: "sdr_24", role: "sdr", front: "Lead tem sócio que decide junto. O que muda?", back: "A call só fecha com o decisor presente. Já convida na qualificação: 'chama teu sócio pra assistir, é rapidinho e vale a pena'. Registra no campo de decisor do card." },
    { id: "sdr_25", role: "sdr", front: "Por que registrar TODO toque no card, na hora?", back: "O toque move o card sozinho (Novo lead → Qualificando), agenda a retomada no GPS e alimenta métricas e SLA. Toque não registrado = lead esquecido e fila mentindo." },
    { id: "sdr_26", role: "sdr", front: "Alternância de canal e horário nas tentativas", back: "Ligação em horário comercial, WhatsApp fora dele; varia o período a cada tentativa (manhã/tarde). Mensagem curta e SEMPRE terminando com pergunta." },
    { id: "sdr_27", role: "sdr", front: "O que é SLA de 1º toque e por que te cobram por ele?", back: "O tempo entre o lead entrar e o primeiro contato. Lead novo esfria por hora, não por dia: tocar dentro do prazo da cadência é o indicador nº 1 da pré-venda." },
    { id: "sdr_28", role: "sdr", front: "Como reconhecer um lead A na qualificação?", back: "Muitas contas (3-5 ou mais) e milhares de anúncios na maior conta, ou plano claro de expansão. Lead A tem prioridade de agenda: encaixa a call o quanto antes." },
    { id: "sdr_29", role: "sdr", front: "Lead responde 'quanto custa?' na qualificação", back: "Não abre preço na pré-venda: 'depende do tamanho da tua operação, por isso a call: o especialista te mostra rodando e o investimento certo pro teu caso. Amanhã de manhã ou fim da tarde?'" },
    { id: "sdr_30", role: "sdr", front: "Marcou a call. O que você faz no sistema, na sequência?", back: "Registra dia/hora em Call agendada, define o closer, gera o link da videochamada e confirma o e-mail pro convite. Depois, a confirmação de 1h antes é sua também." },

    // ── Closer (30) ──────────────────────────────────────────────────────
    { id: "clo_1", role: "closer", front: "Como abrir a call (primeiros 2 min)?", back: "Rapport rápido + confirma o cenário (contas, anúncios, dor). Alinhe a agenda: 'vou te mostrar rodando na sua conta e no fim a gente vê se faz sentido, combinado?'" },
    { id: "clo_2", role: "closer", front: "O teste que desarma quase toda objeção", back: "Clonar 10 anúncios DELE na criação da conta, ~2h de trabalho manual feito em minutos, sem cartão e sem compromisso. Ele vê o valor na própria operação." },
    { id: "clo_3", role: "closer", front: "Objeção: 'tá caro'", back: "Não baixe o preço de cara. Empilhe valor: quanto custa um funcionário pra fazer isso (~R$50 mil/ano), quanto vale a exposição extra. SÓ então a escada de ofertas." },
    { id: "clo_4", role: "closer", front: "A escada de ofertas (de cima pra baixo)", back: "Anual 12x 599 (âncora) → se travar, Semestral 12x 299 → último recurso, Serviço único 12x 149. Nunca comece pela mais barata; desça só na objeção real de preço." },
    { id: "clo_5", role: "closer", front: "Objeção: 'tenho medo de banir a conta'", back: "'Justamente por isso existe processo: atributo e SKU no lugar, clonagem no padrão. Risco é operar tudo na mão. Te mostro contas rodando há meses sem problema.'" },
    { id: "clo_6", role: "closer", front: "Prova social pra usar na call", back: "Case Unique: conta nova clonada da mãe fez +105% em vendas, +98,8% pedidos e +115% visitas no 1º mês. Prints reais do painel do Mercado Livre." },
    { id: "clo_7", role: "closer", front: "Objeção: 'vou pensar'", back: "Isola a real: 'claro! Só pra eu te ajudar: é o preço, o timing ou uma dúvida de como funciona?'. Resolve a objeção verdadeira em vez de deixar esfriar." },
    { id: "clo_8", role: "closer", front: "Como conduzir pro fechamento", back: "Recapitula a dor + o que ele viu no teste + a oferta. Pergunta de compromisso: 'faz sentido começar pelo anual pra travar o melhor preço?'. Depois, silêncio." },
    { id: "clo_9", role: "closer", front: "Objeção: 'preciso falar com meu sócio'", back: "'Decisão boa se toma junto. Topa marcar 15 min com ele ainda essa semana pra eu tirar as dúvidas na fonte? Seguro esse valor até lá.'" },
    { id: "clo_10", role: "closer", front: "Depois do 'sim', o que garantir?", back: "Link de pagamento certo (anual/semestral/único), confirmar o e-mail e já encaminhar pra integração (o setup começa). Não deixe o lead 'no ar' após o aceite." },
    { id: "clo_11", role: "closer", front: "Raio-X da operação (primeiros 5 min): o que levantar?", back: "Quantas contas, quantos anúncios, quem sobe anúncio hoje e o faturamento mensal. Confirma o que o SDR trouxe e completa as lacunas: cada dado desses arma a oferta." },
    { id: "clo_12", role: "closer", front: "A pergunta que define a narrativa da call", back: "'Você já teve conta suspensa ou derrubada no ML? Como foi?'. Se SIM, a call vira PROTEÇÃO (blindar a operação). Se NÃO, vira CRESCIMENTO (multiplicar presença no catálogo)." },
    { id: "clo_13", role: "closer", front: "O que é o 'espelho da dor'?", back: "Devolver a dor nas palavras do próprio lead antes da tese: 'então hoje o gargalo é braço, subir esses anúncios em outra conta na mão levaria meses, é isso?'. Ele diz sim, você apresenta." },
    { id: "clo_14", role: "closer", front: "A vacina da canibalização (quando aplicar?)", back: "ANTES de perguntarem, junto da tese: 'e antes que você pergunte: replicar não canibaliza. A Unique dobrou a conta 2 e a conta 1 ainda subiu 20%.' Desarma a objeção mais comum da fase." },
    { id: "clo_15", role: "closer", front: "Por que a demo ao vivo é o coração da call?", back: "Nas transcrições analisadas, TODA call que clonou anúncio de verdade nas contas do lead fechou ou saiu com integração agendada. A call inteira é desenhada pra chegar nela rápido." },
    { id: "clo_16", role: "closer", front: "Deu erro técnico na demo. O que fazer?", back: "Chama o integrador e corrige NA HORA, na frente do lead: vira prova de suporte. Foi assim que a Juliana fechou, com pagamento ainda na call." },
    { id: "clo_17", role: "closer", front: "Objeção técnica: 'e o estoque, não vai furar?'", back: "Conta-mãe com baixa automática: vendeu em qualquer conta, baixa em todas. E roda junto com Bling e Tiny, sem trocar a retaguarda do cliente." },
    { id: "clo_18", role: "closer", front: "Objeção: 'migrar tudo vai levar uma eternidade'", back: "'Nosso integrador sobe 150 anúncios em 5 a 10 minutos. Teus anúncios migram amanhã, no horário que você escolher.'" },
    { id: "clo_19", role: "closer", front: "Lead pede algo que não temos (Amazon, vídeo, catálogo X)", back: "Honestidade + roadmap: 'hoje não fazemos; está no nosso plano. O que você resolve JÁ com ML e Shopee é isso aqui'. Nunca inventa funcionalidade: quebra confiança na entrega." },
    { id: "clo_20", role: "closer", front: "Como apresentar o preço (âncora única)", back: "'O investimento é o plano anual: 7.188, em 12x de 599 sem juros, ou 6.488 à vista no Pix. Preço fixo, sem taxa por pedido: a gente não quer ser teu sócio. E tudo que lançarmos está incluso.'" },
    { id: "clo_21", role: "closer", front: "Quando (e como) descer a escada de ofertas?", back: "SÓ quando travar em caixa de verdade, nunca preventivamente. E com validade real: 'essa condição vale nesta call'. Semestral 12x 299; último recurso, serviço único 12x 149." },
    { id: "clo_22", role: "closer", front: "Lead questiona a multa de cancelamento", back: "Responde com o valor do primeiro dia, não com a cláusula: 'teus anúncios migram amanhã; o contrato anual é o que garante esse preço. Se a ferramenta entregar, a multa nunca vai te importar.'" },
    { id: "clo_23", role: "closer", front: "A frase de fechamento certa (e a errada)", back: "Errada: 'quer fechar?'. Certa: agendar a entrega: 'bora deixar rodando: que horário amanhã pro nosso integrador migrar teus anúncios, 13h ou 17h?'" },
    { id: "clo_24", role: "closer", front: "Pagamento: qual a regra?", back: "AINDA NA CALL: Pix na hora ou link do cartão em 12x, com o lead na linha. Quem sai 'pra pagar depois' vira follow-up de cobrança e metade esfria." },
    { id: "clo_25", role: "closer", front: "Não fechou na call. Como encerrar do jeito certo?", back: "Tarefa concreta + data marcada + decisor: 'você resolve [logins/sócio] e a gente se fala 5ª às 15h. Se o sócio decide junto, traz ele que eu reapresento em 15 min'. Registra no GPS do lead." },
    { id: "clo_26", role: "closer", front: "Follow-up 1: de onde retomar a conversa?", back: "Do COMBINADO da call (o resumo por IA diz onde parou): 'na nossa call a gente combinou X, como ficou aí do teu lado?'. Nunca reapresente a ferramenta nem mande 'e aí, pensou?'." },
    { id: "clo_27", role: "closer", front: "Follow-up 2 (3 dias sem retorno): a mensagem", back: "Uma só: responde a objeção em aberto com prova ('cliente na mesma situação subiu 105%... teus anúncios migram no 1º dia') e pede sinalização: 'me responde um bora que eu reservo teu horário'." },
    { id: "clo_28", role: "closer", front: "Follow-up 3 (último): como sair com elegância?", back: "'Vou parar de te chamar pra não virar chateação. Só me diz: resolver [a dor] ainda é prioridade? Se for, retomo com prioridade; se não, encerro e deixo a porta aberta.' Sem resposta, Desqualificado." },
    { id: "clo_29", role: "closer", front: "Case certo pra dor certa", back: "Unique (+105% espelhando contas) pra quem duvida da estratégia · Dyno Nutri (60 mil a mais em 20 dias) pra quem tem pressa · criação por OEM com 100/mês inclusos pra autopeça." },
    { id: "clo_30", role: "closer", front: "O que conferir no card ANTES de entrar na call", back: "Contas e anúncios, dor do anúncio (código [X]), histórico de suspensão, quem decide junto e se o SDR cobrou logins + decisor na confirmação. Call boa começa preparada." },

    // ── Integrador · CS (30) ─────────────────────────────────────────────
    { id: "int_1", role: "integrator", front: "Qual o objetivo da call de integração?", back: "Sair com os acessos conectados, a conta-mãe definida e a PRIMEIRA clonagem rodando na frente do cliente, em ~20 minutos de call de vídeo com tela compartilhada." },
    { id: "int_2", role: "integrator", front: "Confirmação da integração: quando e o que pedir?", back: "2h antes, no WhatsApp: confirma o horário, manda o link e pede COMPUTADOR (não celular) e logins das contas em mãos. Sem isso a call não roda." },
    { id: "int_3", role: "integrator", front: "Cliente não respondeu a confirmação. E aí?", back: "30 min antes, LIGA: 'passando pra confirmar nossa integração de hoje às [hora]. Consegue estar no computador com os logins?'. Não atendeu? Reenvia o link e segue pro horário." },
    { id: "int_4", role: "integrator", front: "O que NUNCA falar na integração?", back: "De pagamento. O cliente JÁ pagou na call de venda; confirmar pagamento de novo gera desconforto e insegurança. A integração é 100% entrega." },
    { id: "int_5", role: "integrator", front: "A primeira pergunta da call de integração", back: "'Antes de mexer, me confirma: quais contas entram agora e qual delas é a principal, a que tem os anúncios bons?'. A principal vira a conta-mãe." },
    { id: "int_6", role: "integrator", front: "Como explicar a conta-mãe pro cliente", back: "'Essa vira a matriz: o que você publicar nela replica pras outras, e o que já está nela a gente clona agora. Daqui pra frente é publicar na mãe e deixar replicar.'" },
    { id: "int_7", role: "integrator", front: "O momento-chave da call de integração", back: "A primeira clonagem NA TELA, com o cliente vendo: 'olha rodando: esses anúncios já estão saindo pras outras contas'. Ele precisa SAIR da call com a operação viva." },
    { id: "int_8", role: "integrator", front: "Quanto tempo leva uma migração em massa?", back: "150 anúncios em 5 a 10 minutos. É o número que o closer promete na venda; a integração é onde ele vira verdade." },
    { id: "int_9", role: "integrator", front: "Como funciona o estoque depois da integração?", back: "A conta-mãe comanda: vendeu em qualquer conta, baixa automática em todas. Roda junto com Bling e Tiny, o cliente não troca a retaguarda dele." },
    { id: "int_10", role: "integrator", front: "O que a IA faz nos anúncios clonados?", back: "Completa título e ficha técnica (atributos) pro anúncio chegar na conta nova com nota máxima. Vale mostrar um exemplo na call: prova a qualidade da réplica." },
    { id: "int_11", role: "integrator", front: "Como encerrar a call de integração", back: "'Ficou alguma dúvida do que a gente fez? Eu te acompanho essa semana, me chama a qualquer hora. Semana que vem te procuro pra ver o volume.' Combina o próximo contato ANTES de desligar." },
    { id: "int_12", role: "integrator", front: "Cliente chegou na call sem os logins", back: "Tenta recuperar na hora (SMS/e-mail de acesso) por alguns minutos; não deu, remarca pro dia seguinte JÁ com horário e cobra os acessos na confirmação. Não queime a call inteira esperando." },
    { id: "int_13", role: "integrator", front: "Deu erro/limitação técnica na integração", back: "Transparência na hora: mostra o contorno, registra o problema e dá prazo de retorno. Erro resolvido na frente do cliente vira prova de suporte (foi assim que fechamos a Juliana)." },
    { id: "int_14", role: "integrator", front: "A régua de retenção, marco a marco", back: "Onboarding (semana 1) · Check-in (mês 1) · Revisão de resultado (mês 3) · Conversa de upsell (mês 6) · Contato de renovação (2 meses antes do fim do contrato)." },
    { id: "int_15", role: "integrator", front: "O que é o onboarding da semana 1?", back: "Conferir que a operação está rodando de verdade: clonagens ativas, estoque baixando certo, dúvidas do dia a dia respondidas. Cliente que roda na semana 1 fica." },
    { id: "int_16", role: "integrator", front: "Check-in do mês 1: o que olhar?", back: "Volume clonado, vendas nas contas novas e uso da ferramenta. Ligue COM os números na mão: 'você já tem X anúncios replicados e a conta 2 começou a vender'." },
    { id: "int_17", role: "integrator", front: "Revisão do mês 3: qual a conversa?", back: "Resultado vs expectativa da venda: mostrar a evolução (vendas, exposição), corrigir o que não anda e plantar a semente do case ('posso usar esse resultado?')." },
    { id: "int_18", role: "integrator", front: "Conversa de upsell do mês 6: o que ofertar?", back: "O próximo degrau da operação: mais contas, Shopee além do ML (ou vice-versa), criação por OEM pra autopeça. Upsell nasce de resultado mostrado, não de pressão." },
    { id: "int_19", role: "integrator", front: "Contato de renovação: quando e como?", back: "2 meses ANTES do fim do contrato, com o resumo do que foi entregue no ano (anúncios, vendas, tempo poupado). Renovação se constrói com prova, não com boleto surpresa." },
    { id: "int_20", role: "integrator", front: "Sinais amarelos de churn pra agir na hora", back: "Cliente sem clonar nada há semanas, sem responder contato, reclamação repetida ou queda de vendas. Sinal amarelo = ligação hoje, não no próximo marco da régua." },
    { id: "int_21", role: "integrator", front: "Pós-venda: como abrir um check-in", back: "Com dado na mão, nunca genérico: 'passando pra ver como a LeverAds está rodando aí. Vi que vocês já clonaram X anúncios'. Dado na mão mostra cuidado e abre conversa de verdade." },
    { id: "int_22", role: "integrator", front: "Como transformar resultado em case", back: "'Posso usar esse resultado da [loja] como case nosso? A gente te marca e divulga a loja junto.' Cliente autorizou, vira prova social pro time inteiro (calls, criativos, proposta)." },
    { id: "int_23", role: "integrator", front: "Como pedir indicação sem constranger", back: "'Você conhece outro lojista que sofre pra replicar anúncio entre contas? Se indicar e fechar, tenho uma condição especial pra você.' Cliente bem atendido indica; é só pedir." },
    { id: "int_24", role: "integrator", front: "O que registrar no card depois da integração", back: "Contas conectadas, conta-mãe definida, volume clonado, pendências com prazo e o combinado do próximo contato. O histórico é o que permite o CS ligar com dado na mão." },
    { id: "int_25", role: "integrator", front: "Cliente com ML e Shopee: o que replica onde?", back: "A clonagem roda dentro e ENTRE os marketplaces: anúncio do ML vira anúncio na Shopee (e vice-versa), mantendo SKU e adaptando o formato. É um dos nossos diferenciais." },
    { id: "int_26", role: "integrator", front: "Autopeças: o que tem de especial na entrega?", back: "Criação por OEM (código da montadora define a compatibilidade), com 100 criações por mês inclusas no plano. Confirmar os OEMs certos com o cliente antes de criar em massa." },
    { id: "int_27", role: "integrator", front: "Cliente pergunta 'quanto vou vender a mais?'", back: "Não prometa número: mostre o case ('a Unique fez +105% no 1º mês') e explique do que depende (anúncios campeões, ficha completa, atendimento). Expectativa certa evita frustração no mês 3." },
    { id: "int_28", role: "integrator", front: "Encontrou um bug ou limitação de produto. Fluxo?", back: "Registra com print e contexto, escala pro time técnico e devolve prazo ao cliente. Com o lead na call, honestidade + roadmap; promessa inventada quebra a confiança da entrega." },
    { id: "int_29", role: "integrator", front: "Como a integração entra na agenda do time?", back: "Marcada no card do lead (dia/hora), ocupa 1h na sua agenda e ninguém marca por cima (a agenda trava). A confirmação de 2h antes é sua, não do SDR." },
    { id: "int_30", role: "integrator", front: "Qual o prazo ideal entre o fechamento e a integração?", back: "O DIA SEGUINTE à venda (o closer fecha agendando 13h ou 17h). Quanto mais perto da call de venda, menor a desistência e mais quente a expectativa do cliente." },

    // ── Mídia social (30) ────────────────────────────────────────────────
    { id: "soc_1", role: "social", front: "A convenção do código de dor no nome do anúncio", back: "Todo criativo leva [X] no nome ([A] a [E]), a dor que ele ataca. O código viaja com o lead via UTM e alimenta o relatório Por dor: qual roteiro traz lead que FECHA." },
    { id: "soc_2", role: "social", front: "As 5 dores e o ângulo de criativo de cada uma", back: "[A] replicar anúncios nas outras contas (braço) · [B] conta banida (medo/urgência) · [C] SKUs em várias contas (bagunça) · [D] folha salarial (custo) · [E] mais exposição (crescimento)." },
    { id: "soc_3", role: "social", front: "A convenção de UTM dos anúncios (e por que não mexer)", back: "utm_source=meta, utm_campaign/term/content com os IDs de campanha/conjunto/anúncio. É o que liga cada lead ao anúncio que o trouxe; mexeu, a atribuição (CPL real, ROAS, ABC) quebra." },
    { id: "soc_4", role: "social", front: "CPL real vs CPL da Meta: qual a diferença?", back: "CPL real = investimento ÷ leads que CHEGARAM no cockpit (form). CPL Meta = ÷ leads que a Meta reporta. O real é o que vale; a diferença mostra perda entre clique e cadastro." },
    { id: "soc_5", role: "social", front: "Por que usamos CTR de LINK e não o CTR 'all'?", back: "CTR link = cliques no link ÷ impressões: intenção real de sair pro form. O CTR 'all' infla com qualquer interação (perfil, expandir legenda) e engana a leitura do criativo." },
    { id: "soc_6", role: "social", front: "O que o ROAS mede no nosso contexto?", back: "Receita dos GANHOS atribuídos ao anúncio (via UTM) ÷ investimento. Responde 'qual campanha traz RECEITA', não só lead barato. 1x = empatou; nosso alvo é bem acima." },
    { id: "soc_7", role: "social", front: "Coluna Clientes ABC na Publicidade: o que responde?", back: "Quantos leads A/B/C cada dor/anúncio trouxe e o custo POR grade. Anúncio de CPL baixo que só traz C pode valer menos que CPL alto trazendo A. Grade > volume." },
    { id: "soc_8", role: "social", front: "Métrica de '3s play': o que diz do criativo?", back: "Quantos % dos que viram passaram dos 3 primeiros segundos. Mede a força do GANCHO: 3s fraco, ninguém vê o resto. Primeiro conserta o gancho, depois o meio." },
    { id: "soc_9", role: "social", front: "Estrutura de um criativo de dor que converte", back: "Gancho com a dor nas palavras do lojista (3s) → agitação rápida (o custo de não resolver) → prova concreta (case/print) → CTA pro diagnóstico. Um criativo, UMA dor." },
    { id: "soc_10", role: "social", front: "Que provas sociais temos pra usar em criativo?", back: "Case Unique (+105% vendas, +98,8% pedidos, +115% visitas no 1º mês, com prints do painel) e Dyno Nutri (60 mil a mais em 20 dias). Sempre com número e print real." },
    { id: "soc_11", role: "social", front: "Formato de vídeo pros nossos anúncios", back: "Vertical (9:16), legenda queimada (maioria assiste sem som), gancho nos 3 primeiros segundos e demonstração de tela real da ferramenta quando possível." },
    { id: "soc_12", role: "social", front: "Por que o nome do arquivo de vídeo leva número?", back: "O número identifica o vídeo na convenção ([dor] + número do arquivo) e permite rastrear qual variação performa. O sistema extrai a maior sequência de dígitos do nome." },
    { id: "soc_13", role: "social", front: "Fluxo de criar anúncio novo pelo cockpit", back: "Escolhe a dor → a campanha [dor] resolve sozinha → escolhe o conjunto de origem pra clonar → sobe o vídeo. O sistema duplica o conjunto, renomeia no padrão e troca só o vídeo." },
    { id: "soc_14", role: "social", front: "Por que todo anúncio novo nasce PAUSADO?", back: "Pra revisão humana no Gerenciador antes de gastar: conferir vídeo, copy, UTM e segmentação. Ativar é decisão consciente, não efeito colateral do upload." },
    { id: "soc_15", role: "social", front: "Regra de mexer em orçamento (ABO)", back: "Ajuste gradual: +20% por vez no conjunto, nunca dobrar de uma vez (reseta o aprendizado). Aumenta no que PROVA resultado (ROAS/ABC), não no que só tem CPL bonito." },
    { id: "soc_16", role: "social", front: "Quando pausar um anúncio?", back: "CPL alto SUSTENTADO com amostra decente e sem cliente A/B, criativo com frequência alta (cansou) ou CTR de link caindo semana a semana. Nunca por um dia ruim isolado." },
    { id: "soc_17", role: "social", front: "O que é a fase de aprendizado do conjunto?", back: "O período em que a Meta ainda está descobrindo pra quem entregar. Mexer toda hora (orçamento, público, criativo) reseta o aprendizado e piora o resultado. Paciência com método." },
    { id: "soc_18", role: "social", front: "Frequência alta demais: o que significa e o que fazer?", back: "O mesmo público está vendo o anúncio repetidas vezes: criativo cansou. CTR cai e CPL sobe. Hora de variação nova (outro gancho, outra prova) na mesma dor." },
    { id: "soc_19", role: "social", front: "Pra onde o clique do anúncio leva?", back: "Pro form de diagnóstico no site (5 etapas: nicho, contas, anúncios, expansão, contato). O lead cai direto no pipeline do cockpit com a atribuição do anúncio junto." },
    { id: "soc_20", role: "social", front: "O que é o drop-off do form e por que acompanhar?", back: "Quantos começam e quantos terminam cada etapa do diagnóstico. Queda concentrada numa etapa = atrito ali (pergunta difícil, campo chato). A gente mede isso nativamente." },
    { id: "soc_21", role: "social", front: "Pra que serve o pixel/CAPI da Meta no nosso fluxo?", back: "Manda os eventos (visita, início, lead) de volta pra Meta otimizar a entrega pra quem converte. Sem evento certo, o algoritmo otimiza pro clique errado." },
    { id: "soc_22", role: "social", front: "Teste A/B de headline no form: como funciona?", back: "Variantes de headline servidas no form, com leads e conversão POR variante (inclusive cliente A/B/C e fechamento). A headline vencedora vira o padrão e o teste roda de novo." },
    { id: "soc_23", role: "social", front: "O relatório Por dor responde qual pergunta?", back: "'Qual ROTEIRO/dor traz lead que fecha, não só lead barato': investimento, leads, CPL, calls, clientes ABC, ganhos (com a grade de quem fechou) e ROAS por dor." },
    { id: "soc_24", role: "social", front: "Papel do orgânico (IG) na nossa estratégia", back: "Prova social e aquecimento: cases com print, bastidores da operação, demonstrações da ferramenta. Quem clica no anúncio e visita o perfil precisa encontrar consistência." },
    { id: "soc_25", role: "social", front: "Publicação nas redes: por onde sai?", back: "Pela tela Redes sociais do cockpit: compõe o post, publica direto no IG/FB e acompanha as métricas (alcance, comentários, salvos, compartilhamentos) na mesma tela." },
    { id: "soc_26", role: "social", front: "Quais métricas orgânicas acompanhamos por post?", back: "Alcance, curtidas, comentários, SALVOS e compartilhamentos (os dois últimos pesam mais: indicam valor percebido), e engajamento total. Tendência importa mais que post isolado." },
    { id: "soc_27", role: "social", front: "Metas do papel de mídia social", back: "Ritmo de produção: posts, stories e criativos de anúncio por período (metas configuradas na tela Metas). Constância vence pico: melhor 3 bons por semana toda semana." },
    { id: "soc_28", role: "social", front: "Dor [B] vs dor [E]: como muda a mensagem?", back: "[B] fala com quem JÁ sofreu (medo, urgência, proteção: 'conta caiu? em minutos tudo de volta no ar'). [E] fala com quem quer crescer (ambição: 'multiplique sua vitrine'). Tom oposto." },
    { id: "soc_29", role: "social", front: "O que faz um gancho FORTE nos 3 primeiros segundos?", back: "A dor exata nas palavras do lojista ('perdeu a conta do ML?', 'cansado de subir anúncio um por um?') ou um número que para o dedo ('+105% em 30 dias'). Nada de institucional." },
    { id: "soc_30", role: "social", front: "Subiu um criativo novo. Quando julgar o resultado?", back: "Depois de amostra e prazo mínimos (alguns dias e algumas centenas de impressões), comparando com o benchmark da MESMA dor: CPL real, CTR link, 3s play e, acima de tudo, ABC/ganhos." },
  ],
};

const ROLES = new Set(Object.keys(ROLE_LABELS));
const ROLE_ORDER = Object.keys(ROLE_LABELS);

// Tipos de card: basic (frente/verso), cloze (deleções {{c1::...}} no texto —
// cada índice vira um sub-card) e occlusion (imagem + retângulos tapados —
// cada máscara vira um sub-card). Imagem opcional em basic/cloze.
const CARD_TYPES = new Set(["basic", "cloze", "occlusion"]);

function sanitizeMasks(masks) {
  if (!Array.isArray(masks)) return [];
  const clamp01 = (v) => Math.max(0, Math.min(1, Number(v) || 0));
  return masks.slice(0, 30).map((m, i) => ({
    id: /^m\d+$/.test(String(m?.id)) ? m.id : `m${i + 1}`,
    x: clamp01(m?.x), y: clamp01(m?.y), w: clamp01(m?.w), h: clamp01(m?.h),
  })).filter((m) => m.w > 0.005 && m.h > 0.005);
}

function sanitize(cards) {
  if (!Array.isArray(cards)) return null;
  return cards.slice(0, 400).map((c, i) => {
    const type = CARD_TYPES.has(c?.type) ? c.type : "basic";
    return {
      id: String(c?.id || `card_${i + 1}`).slice(0, 60),
      role: ROLES.has(c?.role) ? c.role : "sdr",
      type,
      front: String(c?.front || "").slice(0, 600),
      back: String(c?.back || "").slice(0, 1200),
      image: String(c?.image || "").slice(0, 60),
      ...(type === "occlusion" ? { masks: sanitizeMasks(c?.masks) } : {}),
    };
  }).filter((c) => (c.type === "occlusion" ? (c.image && c.masks.length) : (c.front.trim() || c.back.trim())));
}

// {{c1::texto}} ou {{c1::texto::dica}} — mesmo formato do Anki.
const CLOZE_RE = /\{\{c(\d+)::(.*?)\}\}/gs;
export function clozeIndexes(text) {
  const ns = new Set();
  for (const m of String(text || "").matchAll(CLOZE_RE)) ns.add(Number(m[1]));
  return [...ns].sort((a, b) => a - b);
}

// Um card pode virar vários itens de estudo: cloze por índice, occlusion por
// máscara. O estado FSRS (e a fila) é por ENTRY — `id`, `id::c1`, `id::m2`.
function cardEntries(card) {
  if (card.type === "cloze") {
    const ns = clozeIndexes(card.front);
    if (ns.length) return ns.map((n) => ({ entryId: `${card.id}::c${n}`, sub: `c${n}` }));
  } else if (card.type === "occlusion") {
    return (card.masks || []).map((m) => ({ entryId: `${card.id}::${m.id}`, sub: m.id }));
  }
  return [{ entryId: card.id, sub: null }];
}

// Ajustes do treino por produto: quantos cards NOVOS por dia entram na fila
// (limite do Anki; revisões não têm teto) e a prova de checkpoint — a cada
// quantos cards GRADUADOS ela cai (0 = desligada), com quantas questões e
// qual nota mínima. Tudo do gestor, na tela Editar.
const SETTING_BOUNDS = {
  newPerDay: { min: 0, max: 200, def: 10 },
  examEvery: { min: 0, max: 200, def: 30 },   // 0 = prova desligada
  examQuestions: { min: 3, max: 12, def: 6 },
  examPass: { min: 50, max: 100, def: 70 },
};
function sanitizeSettings(input, existing = {}) {
  const out = {};
  for (const [key, b] of Object.entries(SETTING_BOUNDS)) {
    const raw = input && typeof input === "object" && input[key] != null ? input[key] : (existing?.[key] ?? b.def);
    const n = Math.round(Number(raw));
    out[key] = Number.isFinite(n) ? Math.min(b.max, Math.max(b.min, n)) : b.def;
  }
  return out;
}

// Vagas que o usuário treina: os DOIS baralhos de conhecimentos gerais entram
// pra todo mundo, primeiro (a porta de entrada do treinamento); a partir deles
// a pessoa segue no fluxo da vaga dela (etiquetas do cadastro, roles do
// funil). Sem etiqueta (ex.: admin) = vê todos os baralhos.
function rolesForUser(user) {
  const tags = (user?.roles || []).filter((r) => ROLES.has(r));
  if (!tags.length) return [...ROLE_ORDER];
  return ROLE_ORDER.filter((r) => GENERAL_ROLES.includes(r) || tags.includes(r));
}

const stateDocId = (saas, userId) => `${saas}__${userId}`;
const EMPTY_STATES = (saas, userId) => ({ id: stateDocId(saas, userId), saas, user: userId, cards: {}, newDone: {} });

// ── Fila do dia (o coração do Anki) ──────────────────────────────────────────
// Por baralho (vaga): aprendendo (due até o fim do dia) → revisões vencidas →
// novos até o limite diário. Cada card sai com o preview dos 4 intervalos.
function buildDeckQueue(cards, statesDoc, { now, newBudget }) {
  const end = dayEnd(now);
  const learning = [], review = [], fresh = [];
  let learned = 0; // entries já graduadas (em revisão) = a pontuação do tema
  for (const card of cards) {
    for (const { entryId, sub } of cardEntries(card)) {
      const st = statesDoc.cards[entryId] || null;
      const item = { card, entryId, sub, st };
      if (!st || st.state === CARD_STATE.new) fresh.push(item);
      else if (st.state === CARD_STATE.review) { learned++; if (new Date(st.due) <= end) review.push(item); }
      else if (new Date(st.due) <= end) learning.push(item); // learning/relearning
    }
  }
  const byDue = (a, b) => new Date(a.st.due) - new Date(b.st.due);
  learning.sort(byDue); review.sort(byDue);
  const newToday = fresh.slice(0, Math.max(0, newBudget));
  const pack = ({ card, entryId, sub, st }) => ({ ...card, entryId, sub, srs: st, preview: previewIntervals(st, now) });
  return {
    counts: { new: newToday.length, learning: learning.length, review: review.length },
    learned,
    cards: [...learning.map(pack), ...review.map(pack), ...newToday.map(pack)],
  };
}

// Base oficial de um produto (doc salvo ou defaults) — usada pelas rotas e
// pelo lembrete diário.
export async function flashcardsBase(repo, saas) {
  const doc = saas ? await repo.get("flashcards", saas) : null;
  return doc?.cards || DEFAULTS[saas] || [];
}

// ── Prova de checkpoint ──────────────────────────────────────────────────────
// A cada `examEvery` cards graduados cai uma prova sobre exatamente esses
// cards: múltipla escolha com distratores tirados dos gabaritos de OUTROS
// cards (plausíveis por construção, sem trabalho manual) e, com IA
// configurada, 2 digitadas corrigidas semanticamente. Abaixo de 70% reprova
// e os cards errados voltam pra fila como novos.
const EXAM_PASS = 70; // fallback pra prova antiga sem passScore congelado

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// pergunta e resposta certa de uma entry (occlusion fica fora — é visual)
function entryQA(card, sub) {
  if (!card || card.type === "occlusion") return null;
  if (card.type === "cloze") {
    const target = Number(String(sub || "").slice(1));
    let answer = null;
    const prompt = String(card.front || "").replace(CLOZE_RE, (m, n, body) => {
      const content = body.split("::")[0];
      if (Number(n) === target) { answer = content; return "_____"; }
      return content;
    });
    return answer ? { prompt: `Complete: ${prompt}`, answer } : null;
  }
  if (!card.front?.trim() || !card.back?.trim()) return null;
  return { prompt: card.front, answer: card.back };
}

function buildExamQuestions(cards, coveredEntries, { typedCount = 0, questionCount = SETTING_BOUNDS.examQuestions.def } = {}) {
  const byId = new Map(cards.map((c) => [c.id, c]));
  const qas = [];
  for (const entryId of shuffle(coveredEntries)) {
    const baseId = entryId.split("::")[0];
    const card = byId.get(baseId);
    const sub = entryId.includes("::") ? entryId.slice(baseId.length + 2) : null;
    const qa = entryQA(card, sub);
    if (qa) qas.push({ entryId, role: card.role, ...qa });
    if (qas.length >= questionCount) break;
  }
  // distratores: respostas de outros cards, preferindo o mesmo baralho
  const pool = cards.flatMap((c) => cardEntries(c)
    .map((e) => entryQA(c, e.sub)).filter(Boolean)
    .map((q) => ({ role: c.role, answer: q.answer })));
  const typed = Math.min(typedCount, Math.max(0, qas.length - 3)); // digitadas só se sobrar MC suficiente
  return qas.map((qa, i) => {
    if (i >= qas.length - typed) return { kind: "typed", entryId: qa.entryId, prompt: qa.prompt, ideal: qa.answer };
    const cand = pool.filter((p) => p.answer !== qa.answer);
    const ds = [...new Set([
      ...shuffle(cand.filter((p) => p.role === qa.role)).map((p) => p.answer),
      ...shuffle(cand.filter((p) => p.role !== qa.role)).map((p) => p.answer),
    ])].slice(0, 3);
    const options = shuffle([qa.answer, ...ds]);
    return { kind: "mc", entryId: qa.entryId, prompt: qa.prompt, options, answerIdx: options.indexOf(qa.answer) };
  });
}

// Retrato da equipe num produto (rota /team e lembrete diário do Discord).
// True retention (métrica clássica do Anki): % de acerto (rating ≥ 2, Difícil
// conta como lembrou) SÓ nas revisões de cards que JÁ estavam em revisão
// (prevState = review) — mede memória de verdade, sem misturar o aprendizado
// do dia. `null` quando não há amostra.
function retentionOf(reviews) {
  const rs = reviews.filter((r) => r.prevState === CARD_STATE.review);
  if (!rs.length) return { pct: null, n: 0 };
  return { pct: Math.round((rs.filter((r) => r.rating >= 2).length / rs.length) * 100), n: rs.length };
}

export async function teamSnapshot(repo, saas, cardsBase, now = new Date()) {
  const end = dayEnd(now);
  const today = dayKey(now);
  const users = (await repo.list("users"))
    .filter((u) => !u.saas || u.saas === saas) // respeita o escopo de produto do usuário
    .map((u) => ({ id: u.id, name: u.name, roles: Array.isArray(u.roles) ? u.roles : [] }));
  const reviews = (await repo.list("training_reviews")).filter((r) => r.saas === saas);
  const exams = (await repo.list("training_exams")).filter((e) => e.saas === saas);
  const rows = [];
  for (const u of users) {
    const roles = rolesForUser(u);
    // o baralho conta ENTRIES (cloze/occlusion viram vários itens de estudo)
    const deck = cardsBase.filter((c) => roles.includes(c.role)).flatMap((c) => cardEntries(c).map((e) => ({ ...e, role: c.role })));
    const statesDoc = (await repo.get("training_states", stateDocId(saas, u.id))) || EMPTY_STATES(saas, u.id);
    let dueToday = 0, overdue = 0, seen = 0, mature = 0, young = 0;
    const forecast = Array.from({ length: 7 }, (_, i) => ({ day: dayKey(new Date(end.getTime() + i * 864e5)), n: 0 }));
    for (const { entryId } of deck) {
      const st = statesDoc.cards[entryId];
      if (!st || st.state === CARD_STATE.new) continue;
      seen++;
      if (st.state === CARD_STATE.review) { if ((st.scheduled_days || 0) >= 21 ) mature++; else young++; }
      const due = new Date(st.due);
      if (due <= end) { dueToday++; if (dayKey(due) < today) overdue++; }
      else if (due <= new Date(end.getTime() + 7 * 864e5)) {
        forecast[Math.min(6, Math.floor((due - end) / 864e5))].n++;
      }
    }

    const mine = reviews.filter((r) => r.user === u.id);
    const inWindow = (days) => mine.filter((r) => now - new Date(r.at) <= days * 864e5);
    const last7 = inWindow(7), last30 = inWindow(30);
    const doneToday = mine.filter((r) => dayKey(new Date(r.at)) === today).length;
    const again7dPct = last7.length ? Math.round((last7.filter((r) => r.rating === 1).length / last7.length) * 100) : null;

    // memória e aprendizado
    const retention7d = retentionOf(last7);
    const retention30d = retentionOf(last30);
    const firstTries = last30.filter((r) => r.prevState === CARD_STATE.new);
    const firstTryPct = firstTries.length ? Math.round((firstTries.filter((r) => r.rating >= 3).length / firstTries.length) * 100) : null;
    const retentionByRole = roles.map((role) => ({ role, label: ROLE_LABELS[role], ...retentionOf(last30.filter((r) => r.role === role)) }))
      .filter((x) => x.n > 0);
    // 8 semanas de true retention (da mais antiga pra atual) pro gráfico;
    // back=1 é a semana corrente (idade 0..7 dias)
    const weekly = Array.from({ length: 8 }, (_, i) => {
      const back = 8 - i;
      const ws = mine.filter((r) => {
        const age = (now - new Date(r.at)) / 864e5;
        return age > (back - 1) * 7 && age <= back * 7;
      });
      return { start: dayKey(new Date(now.getTime() - (back * 7 - 1) * 864e5)), ...retentionOf(ws) };
    });

    // ritmo de resposta (anti-burla): mediana e % de respostas relâmpago
    const timed = last30.filter((r) => (r.ms || 0) > 0).map((r) => r.ms).sort((a, b) => a - b);
    const medianMs = timed.length ? timed[Math.floor(timed.length / 2)] : null;
    const rushPct = timed.length ? Math.round((timed.filter((v) => v < 1500).length / timed.length) * 100) : null;

    // constância
    const dayCounts = {};
    for (const r of mine) { const d = dayKey(new Date(r.at)); dayCounts[d] = (dayCounts[d] || 0) + 1; }
    const activeDays30d = Object.keys(dayCounts).filter((d) => (now - Date.parse(`${d}T12:00:00Z`)) / 864e5 <= 30).length;
    const reviewsPerDay30d = Math.round((last30.length / 30) * 10) / 10;
    const since = dayKey(new Date(now.getTime() - 27 * 7 * 864e5));
    const days = Object.fromEntries(Object.entries(dayCounts).filter(([d]) => d >= since).sort());
    let streak = 0;
    for (let d = new Date(now.getTime() - (dayCounts[today] ? 0 : 864e5)); dayCounts[dayKey(d)]; d = new Date(d.getTime() - 864e5)) streak++;
    const lastAt = mine.reduce((m, r) => (r.at > m ? r.at : m), "");

    // provas de checkpoint
    const myExams = exams.filter((e) => e.user === u.id);
    const doneExams = myExams.filter((e) => e.status !== "pending").sort((a, b) => (a.finishedAt || "").localeCompare(b.finishedAt || ""));
    const lastExam = doneExams.at(-1) || null;

    rows.push({
      ...u, deckSize: deck.length, seen, dueToday, overdue, doneToday, again7dPct, streak, lastReviewAt: lastAt || null,
      mature, young, forecast,
      retention7d, retention30d, firstTryPct, retentionByRole, weekly,
      activeDays30d, reviewsPerDay30d, days, medianMs, rushPct,
      examsDone: doneExams.length,
      examsFailed: doneExams.filter((e) => e.status === "failed").length,
      lastExam: lastExam ? { score: lastExam.score, status: lastExam.status } : null,
      examPending: myExams.some((e) => e.status === "pending"),
    });
  }
  return rows;
}

export function registerFlashcardRoutes(app, repo, { anthropic = null } = {}) {
  async function baseDoc(saas) {
    const doc = saas ? await repo.get("flashcards", saas) : null;
    return {
      cards: doc?.cards || DEFAULTS[saas] || [],
      settings: sanitizeSettings(null, doc?.settings),
    };
  }

  // Fila/revisão são POR PESSOA — exigem sessão de usuário (a key mestre de
  // integração não tem "quem").
  function requireUser(req, reply) {
    if (req.authUser?.id) return req.authUser;
    reply.code(401).send({ error: "treino é por pessoa — faça login no cockpit (sessão de usuário)" });
    return null;
  }

  app.get("/api/flashcards/:saas", async (req, reply) => {
    const product = await repo.get("products", req.params.saas);
    if (!product) return reply.code(404).send({ error: "produto não encontrado" });
    const { cards, settings } = await baseDoc(product.id);
    return { saas: product.id, roleLabels: ROLE_LABELS, cards, settings };
  });

  // A fila do dia do usuário logado: um baralho por vaga dele (sem etiqueta =
  // todos), com contadores novo/aprendendo/revisar e os cards prontos pra sessão.
  app.get("/api/flashcards/:saas/queue", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const product = await repo.get("products", req.params.saas);
    if (!product) return reply.code(404).send({ error: "produto não encontrado" });
    const now = new Date();
    const { cards, settings } = await baseDoc(product.id);
    const statesDoc = (await repo.get("training_states", stateDocId(product.id, user.id))) || EMPTY_STATES(product.id, user.id);
    const doneByRole = statesDoc.newDone[dayKey(now)] || {};
    const decks = [], queue = {};
    for (const role of rolesForUser(user)) {
      const deck = buildDeckQueue(cards.filter((c) => c.role === role), statesDoc, {
        now, newBudget: settings.newPerDay - (doneByRole[role] || 0),
      });
      decks.push({ role, label: ROLE_LABELS[role], total: cards.filter((c) => c.role === role).flatMap(cardEntries).length, counts: deck.counts, learned: deck.learned });
      queue[role] = deck.cards;
    }
    const pendingExam = (await repo.list("training_exams"))
      .find((e) => e.saas === product.id && e.user === user.id && e.status === "pending");
    return {
      saas: product.id, today: dayKey(now), dayEnd: dayEnd(now).toISOString(), newPerDay: settings.newPerDay, decks, queue,
      exam: pendingExam ? { id: pendingExam.id, count: pendingExam.coveredEntries.length } : null,
    };
  });

  // Prova de checkpoint — gera as questões na primeira abertura. O gabarito
  // NUNCA vai pro cliente; a correção é toda no servidor.
  app.post("/api/flashcards/:saas/exam/:id/start", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const exam = await repo.get("training_exams", req.params.id);
    if (!exam || exam.saas !== req.params.saas || exam.user !== user.id) return reply.code(404).send({ error: "prova não encontrada" });
    if (exam.status !== "pending") return reply.code(400).send({ error: "prova já respondida" });
    let questions = exam.questions;
    let passScore = exam.passScore;
    if (!questions?.length) {
      const { cards, settings } = await baseDoc(exam.saas);
      questions = buildExamQuestions(cards, exam.coveredEntries, {
        typedCount: anthropic?.configured?.() ? 2 : 0,
        questionCount: settings.examQuestions,
      });
      if (!questions.length) return reply.code(400).send({ error: "sem questões possíveis — os cards desta prova saíram da base" });
      passScore = settings.examPass; // congela a régua vigente na abertura
      await repo.update("training_exams", exam.id, { questions, passScore });
    }
    return {
      id: exam.id, count: exam.coveredEntries.length, passScore: passScore ?? EXAM_PASS,
      questions: questions.map((q) => ({ kind: q.kind, prompt: q.prompt, options: q.options || null })),
    };
  });

  app.post("/api/flashcards/:saas/exam/:id/submit", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const product = await repo.get("products", req.params.saas);
    const exam = await repo.get("training_exams", req.params.id);
    if (!exam || exam.saas !== req.params.saas || exam.user !== user.id) return reply.code(404).send({ error: "prova não encontrada" });
    if (exam.status !== "pending" || !exam.questions?.length) return reply.code(400).send({ error: "prova não está aberta" });
    const answers = Array.isArray(req.body?.answers) ? req.body.answers : [];

    const results = [];
    for (let i = 0; i < exam.questions.length; i++) {
      const q = exam.questions[i];
      const a = answers[i] || {};
      if (q.kind === "mc") {
        const choice = Number.isInteger(a.choice) ? a.choice : -1;
        results.push({ ...q, choice, correct: choice === q.answerIdx, feedback: "" });
      } else {
        const text = String(a.text || "").trim();
        let correct = false, feedback = "";
        if (text && anthropic?.configured?.()) {
          try {
            const g = await anthropic.gradeAnswer({ question: q.prompt, ideal: q.ideal, answer: text, productName: product?.name });
            correct = g.score >= 60;
            feedback = g.feedback || "";
          } catch {
            correct = true; feedback = "IA indisponível na correção — questão contou como certa";
          }
        }
        results.push({ ...q, text, correct, feedback });
      }
    }
    const passScore = exam.passScore ?? EXAM_PASS;
    const score = Math.round((results.filter((r) => r.correct).length / results.length) * 100);
    const passed = score >= passScore;

    // reprovou: os cards das questões erradas voltam pra fila como novos
    let resetCount = 0;
    if (!passed) {
      const docId = stateDocId(exam.saas, user.id);
      const statesDoc = await repo.get("training_states", docId);
      if (statesDoc) {
        for (const r of results.filter((x) => !x.correct)) {
          if (statesDoc.cards[r.entryId]) { delete statesDoc.cards[r.entryId]; resetCount++; }
        }
        await repo.update("training_states", docId, { cards: statesDoc.cards });
      }
    }
    await repo.update("training_exams", exam.id, {
      status: passed ? "passed" : "failed", score, finishedAt: new Date().toISOString(), questions: results,
    });
    return {
      score, passed, passScore, resetCount,
      questions: results.map((q) => ({
        kind: q.kind, prompt: q.prompt, options: q.options || null,
        answerIdx: q.answerIdx ?? null, choice: q.choice ?? null,
        text: q.text ?? "", ideal: q.ideal || null, correct: q.correct, feedback: q.feedback,
      })),
    };
  });

  // Uma resposta: aplica o rating (1 Errei · 2 Difícil · 3 Bom · 4 Fácil) no
  // FSRS, persiste o estado do usuário e loga a revisão. Devolve o novo estado
  // + preview (o front decide se o card volta ainda nesta sessão).
  app.post("/api/flashcards/:saas/review", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const product = await repo.get("products", req.params.saas);
    if (!product) return reply.code(404).send({ error: "produto não encontrado" });
    const rating = Number(req.body?.rating);
    if (![1, 2, 3, 4].includes(rating)) return reply.code(400).send({ error: "rating deve ser 1..4" });
    const { cards, settings } = await baseDoc(product.id);
    // `cardId` é o ENTRY id: `id` (basic), `id::c1` (cloze) ou `id::m2` (occlusion)
    const entryId = String(req.body?.cardId || "");
    const baseId = entryId.split("::")[0];
    const card = cards.find((c) => c.id === baseId);
    if (!card || !cardEntries(card).some((e) => e.entryId === entryId)) {
      return reply.code(404).send({ error: "card não encontrado na base" });
    }

    const now = new Date();
    const docId = stateDocId(product.id, user.id);
    const statesDoc = (await repo.get("training_states", docId)) || EMPTY_STATES(product.id, user.id);
    const prev = statesDoc.cards[entryId] || null;
    const wasNew = !prev || prev.state === CARD_STATE.new;
    const { card: next, log } = applyRating(prev, rating, now);
    statesDoc.cards[entryId] = next;

    if (wasNew) {
      const today = dayKey(now);
      const day = { ...(statesDoc.newDone[today] || {}) };
      day[card.role] = (day[card.role] || 0) + 1;
      // só os últimos 14 dias interessam (o limite é diário)
      statesDoc.newDone = Object.fromEntries(
        Object.entries({ ...statesDoc.newDone, [today]: day }).sort().slice(-14)
      );
    }

    // graduou (chegou em "revisão" pela primeira vez)? alimenta a prova de
    // checkpoint; ao juntar `examEvery` graduados, cria a prova pendente.
    const graduated = next.state === CARD_STATE.review && (!prev || prev.state !== CARD_STATE.review);
    if (graduated && settings.examEvery > 0) {
      const pool = [...new Set([...(statesDoc.gradPool || []), entryId])];
      if (pool.length >= settings.examEvery) {
        statesDoc.gradPool = pool.slice(settings.examEvery);
        try {
          await repo.create("training_exams", {
            id: `ex_${now.getTime().toString(36)}_${user.id}_${Math.random().toString(36).slice(2, 6)}`,
            saas: product.id, user: user.id, status: "pending",
            coveredEntries: pool.slice(0, settings.examEvery), createdAt: now.toISOString(),
          });
        } catch { /* fail-open */ }
      } else {
        statesDoc.gradPool = pool;
      }
    }

    const existing = await repo.get("training_states", docId);
    if (existing) await repo.update("training_states", docId, { cards: statesDoc.cards, newDone: statesDoc.newDone, gradPool: statesDoc.gradPool || [] });
    else await repo.create("training_states", statesDoc);

    // log da revisão (dashboard/otimização) — best-effort, nunca trava o estudo.
    // id explícito: o gerador do repo colide quando 2 creates caem no mesmo ms
    // (2 pessoas revisando juntas), e a colisão apagaria uma revisão em silêncio.
    try {
      await repo.create("training_reviews", {
        id: `rv_${now.getTime().toString(36)}_${user.id}_${Math.random().toString(36).slice(2, 8)}`,
        saas: product.id, user: user.id, cardId: entryId, role: card.role,
        rating, prevState: log.state, prevIvl: prev?.scheduled_days || 0,
        // tempo frente→resposta (anti-burla: ninguém lembra de verdade em <1,5s)
        ms: Math.max(0, Math.min(300000, Math.round(Number(req.body?.ms) || 0))),
        due: next.due, at: now.toISOString(),
      });
    } catch { /* fail-open */ }

    return { cardId: entryId, srs: next, preview: previewIntervals(next, now) };
  });

  // Imagem dos cards (colada/enviada no editor): base64 na collection (máx
  // 3MB) e servida em /public/training/:id — rota ABERTA (a tag <img> não
  // manda header; o id randômico é a chave, mesmo desenho de /public/social).
  app.post("/api/flashcards/:saas/asset", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const product = await repo.get("products", req.params.saas);
    if (!product) return reply.code(404).send({ error: "produto não encontrado" });
    const file = await req.file();
    if (!file) return reply.code(400).send({ error: "envie uma imagem (multipart, campo file)" });
    if (!/^image\//.test(file.mimetype || "")) return reply.code(400).send({ error: "só aceito imagem" });
    const buf = await file.toBuffer();
    if (buf.length > 3 * 1024 * 1024) return reply.code(413).send({ error: "imagem acima de 3MB — recorte ou comprima" });
    const id = `ta_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    await repo.create("training_assets", {
      id, saas: product.id, mime: file.mimetype, size: buf.length,
      data: buf.toString("base64"), by: user.id, at: new Date().toISOString(),
    });
    return { id, url: `/public/training/${id}` };
  });

  app.get("/public/training/:id", async (req, reply) => {
    const doc = await repo.get("training_assets", req.params.id);
    if (!doc) return reply.code(404).send({ error: "imagem não encontrada" });
    reply.header("cache-control", "public, max-age=86400, immutable");
    return reply.type(doc.mime || "image/png").send(Buffer.from(doc.data || "", "base64"));
  });

  // Consistência do usuário logado: revisões por dia (~27 semanas, heatmap),
  // sequência atual e a melhor de todos os tempos.
  app.get("/api/flashcards/:saas/stats", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const product = await repo.get("products", req.params.saas);
    if (!product) return reply.code(404).send({ error: "produto não encontrado" });
    const now = new Date();
    const today = dayKey(now);
    const mine = (await repo.list("training_reviews")).filter((r) => r.saas === product.id && r.user === user.id);
    const counts = {};
    for (const r of mine) {
      const d = dayKey(new Date(r.at));
      counts[d] = (counts[d] || 0) + 1;
    }
    const since = dayKey(new Date(now.getTime() - 27 * 7 * 864e5));
    const days = Object.fromEntries(Object.entries(counts).filter(([d]) => d >= since).sort());
    let streak = 0;
    for (let d = new Date(now.getTime() - (counts[today] ? 0 : 864e5)); counts[dayKey(d)]; d = new Date(d.getTime() - 864e5)) streak++;
    // melhor sequência: varre os dias com revisão em ordem, contando corridas.
    let bestStreak = 0, run = 0, prev = null;
    for (const d of Object.keys(counts).sort()) {
      run = prev && (Date.parse(d) - Date.parse(prev) === 864e5) ? run + 1 : 1;
      bestStreak = Math.max(bestStreak, run);
      prev = d;
    }
    return { saas: product.id, today, streak, bestStreak, doneToday: counts[today] || 0, days };
  });

  // Dashboard da equipe: quem está em dia, quem acumulou, acerto e sequência.
  app.get("/api/flashcards/:saas/team", async (req, reply) => {
    const product = await repo.get("products", req.params.saas);
    if (!product) return reply.code(404).send({ error: "produto não encontrado" });
    const { cards } = await baseDoc(product.id);
    return { saas: product.id, today: dayKey(new Date()), roleLabels: ROLE_LABELS, users: await teamSnapshot(repo, product.id, cards) };
  });

  app.put("/api/flashcards/:saas", async (req, reply) => {
    const product = await repo.get("products", req.params.saas);
    if (!product) return reply.code(404).send({ error: "produto não encontrado" });
    const cards = sanitize(req.body?.cards);
    if (!cards) return reply.code(400).send({ error: "cards deve ser uma lista" });
    const existing = await repo.get("flashcards", product.id);
    const settings = sanitizeSettings(req.body?.settings, existing?.settings);
    const saved = existing
      ? await repo.update("flashcards", product.id, { cards, settings })
      : await repo.create("flashcards", { id: product.id, cards, settings });
    return { saas: product.id, cards: saved.cards, settings: saved.settings };
  });
}

export const FLASHCARD_DEFAULTS = DEFAULTS;
