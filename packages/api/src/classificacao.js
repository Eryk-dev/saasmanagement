// Classificação de lead por PRODUTO (OEM · Ads · Price).
//
// Substitui a régua única (matriz contas × anúncios → grau S-E, que sugeria
// full/parcial) por duas notas independentes, porque elas respondem perguntas
// diferentes e misturá-las numa só produz o pior caso: lead grande e frio
// ranqueando acima de lead médio e quente — o grande não aparece na call e o
// slot do closer foi gasto.
//
//   PORTE  (letra S-E) — quanto o lead pode pagar. Eixo primário MUDA por
//                        produto, porque o que gera valor muda: Ads cobra pela
//                        replicação (contas × anúncios), OEM pela criação
//                        (SKUs) e Price pelo volume disputado (anúncios).
//   QUALIF (0-100)     — se ele aparece e compra. Sai só do que foi escrito no
//                        formulário; não usa tamanho de resposta (ver abaixo).
//
// A AÇÃO do SDR sai do cruzamento das duas, nunca de uma isolada.
//
// Tudo aqui é função pura: nenhuma leitura de banco, nenhum efeito. Facilita
// teste e deixa o mesmo cálculo rodar na API e no front sem divergir.

// ── Faixas ────────────────────────────────────────────────────────────────
// Os cortes caem onde o dinheiro muda: 3 contas é o teto do Essencial, 7 o do
// Escala; 1.000 e 10.000 anúncios são as bordas do Price. As faixas antigas
// não expressavam nenhuma dessas fronteiras (o corte de 3 partia o balde
// "3-5" no meio, o de 1.000 partia o "500-2000").
export const ACCOUNTS_OPTIONS = [
  { value: "1", label: "1 conta" },
  { value: "2-3", label: "2 a 3 contas" },
  { value: "4-6", label: "4 a 6 contas" },
  { value: "7-10", label: "7 a 10 contas" },
  { value: "10+", label: "Mais de 10 contas" },
];

export const LISTINGS_OPTIONS = [
  { value: "0-500", label: "Até 500" },
  { value: "500-1000", label: "500 a 1.000" },
  { value: "1000-5000", label: "1.000 a 5.000" },
  { value: "5000-10000", label: "5.000 a 10.000" },
  { value: "10000+", label: "Mais de 10.000" },
];

export const ORDERS_OPTIONS = [
  { value: "0-200", label: "Até 200" },
  { value: "200-500", label: "200 a 500" },
  { value: "500-1000", label: "500 a 1.000" },
  { value: "1000-2000", label: "1.000 a 2.000" },
  { value: "2000+", label: "Mais de 2.000" },
];

export const TICKET_OPTIONS = [
  { value: "0-70", label: "Até R$ 70" },
  { value: "70-150", label: "R$ 70 a 150" },
  { value: "150-300", label: "R$ 150 a 300" },
  { value: "300-600", label: "R$ 300 a 600" },
  { value: "600+", label: "Mais de R$ 600" },
];

export const SKUS_OPTIONS = [
  { value: "0-1000", label: "Até 1.000" },
  { value: "1000-5000", label: "1.000 a 5.000" },
  { value: "5000-20000", label: "5.000 a 20.000" },
  { value: "20000-50000", label: "20.000 a 50.000" },
  { value: "50000+", label: "Mais de 50.000" },
];

// LEITURA DUPLA — a parte que protege a base.
//
// ~2 mil leads em produção carregam os valores antigos ("3-5", "500-2000"…).
// O grid indexa por string, e valor desconhecido cairia em `?? 0`, jogando TODO
// lead histórico pra linha de baixo da matriz — inclusive nas propostas
// abertas, que usam o mesmo grid pra sugerir produto.
//
// Como as duas escalas têm 5 faixas na mesma ordem, o legado mapeia pros
// MESMOS índices de antes: nenhum lead existente muda de grau. O preço disso é
// semântico (um "100-500" antigo não é o mesmo intervalo que o balde 1 novo),
// e é o preço certo a pagar — a alternativa é reclassificar a base inteira com
// base em informação que nunca foi coletada ("3-5" tanto pode ser 3 quanto 5).
const IDX_ACCOUNTS = {
  "1": 0, "2-3": 1, "4-6": 2, "7-10": 3, "10+": 4,
  "2": 1, "3-5": 2, "6-10": 3, // legado
};
const IDX_LISTINGS = {
  "0-500": 0, "500-1000": 1, "1000-5000": 2, "5000-10000": 3, "10000+": 4,
  "0-100": 0, "100-500": 1, "500-2000": 2, "2000-10000": 3, // legado
};
const IDX_SKUS = { "0-1000": 0, "1000-5000": 1, "5000-20000": 2, "20000-50000": 3, "50000+": 4 };

// Pontos médios pra estimar GMV. Faixa aberta usa o dobro do piso — subestimar
// o topo é preferível a inflar lead grande com número inventado.
const MID_ORDERS = { "0-200": 100, "200-500": 350, "500-1000": 750, "1000-2000": 1500, "2000+": 3000 };
const MID_TICKET = { "0-70": 50, "70-150": 110, "150-300": 225, "300-600": 450, "600+": 800 };

// Frequência de ajuste de preço: é a dor do Price medida direto. "Não ajusto"
// com muito anúncio é dor MÁXIMA não percebida, não ausência de dor — por isso
// não entra como 0 no eixo, e sim como sinal tratado em portePrice().
const IDX_REPRICE = { nunca: 0, "as-vezes": 1, semanal: 2, diario: 3, "varias-dia": 4 };

// ── Matriz ────────────────────────────────────────────────────────────────
// Mesma forma 5×5 já calibrada (espelho de GRADE_GRID em web/src/lib/ui.js —
// os dois precisam andar juntos). Só os rótulos dos eixos mudaram.
const GRID = [
  ["E", "D", "C", "C", "C"],
  ["D", "C", "C", "B", "B"],
  ["C", "B", "B", "A", "A"],
  ["B", "B", "A", "S", "S"],
  ["A", "A", "A", "S", "S"],
];

const LETRAS = ["E", "D", "C", "B", "A", "S"];
const subir = (letra, passos) => {
  const i = LETRAS.indexOf(letra);
  if (i < 0) return letra;
  return LETRAS[Math.min(LETRAS.length - 1, Math.max(0, i + passos))];
};

// ── GMV: o corretor ───────────────────────────────────────────────────────
// pedidos × ticket é a única leitura que separa "10 mil anúncios girando" de
// "10 mil anúncios mortos" — coisa que contas × anúncios não enxerga. Não é
// eixo (viraria matriz 3D); é ajuste de ±1 letra sobre o eixo do produto.
export function gmvDe(lead) {
  const p = MID_ORDERS[lead?.orders];
  const t = MID_TICKET[lead?.ticket];
  return p != null && t != null ? p * t : null;
}

// Piso de faturamento do ICP. Autopeças é operação de ticket mais alto, então
// o piso sobe junto — é o mesmo ICP lido em reais em vez de quatro limiares
// independentes em AND (que reprovavam 1.900 pedidos a R$300 e aprovavam 2.000
// a R$70, ou seja, barravam o maior e aceitavam o menor).
export const PISO_GMV_GERAL = 140_000;
export const PISO_GMV_AUTOPECAS = 400_000;
export const pisoDe = (lead) => (lead?.niche === "autopecas" ? PISO_GMV_AUTOPECAS : PISO_GMV_GERAL);

function ajustePorGmv(lead) {
  const gmv = gmvDe(lead);
  if (gmv == null) return 0; // não respondeu volume: não penaliza, só não ajuda
  const piso = pisoDe(lead);
  if (gmv < piso * 0.5) return -1;
  if (gmv > piso * 3) return +1;
  return 0;
}

// ── Porte por produto ─────────────────────────────────────────────────────
// Cada produto lê o eixo que gera o valor dele. É por isso que existem três
// funções e não uma com parâmetro: a de OEM nem olha anúncios.

// Ads: o produto é a replicação, então o custo evitado é contas × anúncios.
export function porteAds(lead) {
  const c = IDX_ACCOUNTS[lead?.accounts];
  const a = IDX_LISTINGS[lead?.listings];
  if (c == null && a == null) return null;
  const base = GRID[c ?? 0][a ?? 0];
  return subir(base, ajustePorGmv(lead));
}

// OEM: o produto é a CRIAÇÃO de anúncio, então o eixo é SKU (potencial), não
// anúncio ativo (realizado). É o que salva o lojista físico: 5 mil SKUs e 200
// anúncios é E na matriz de Ads e A no potencial de OEM — classificar pelo
// anúncio jogaria o lead de maior potencial no balde do robô.
export function porteOem(lead) {
  if (lead?.partsType === "usada") return null; // peça usada não tem OEM
  const s = IDX_SKUS[lead?.skus];
  const c = IDX_ACCOUNTS[lead?.accounts];
  if (s == null && c == null) return null;
  const base = GRID[c ?? 0][s ?? 0];
  return subir(base, ajustePorGmv(lead));
}

// Price: o teto do plano é literalmente anúncios, então o eixo primário é ele.
// O secundário é a frequência de ajuste — que mede as duas coisas ao mesmo
// tempo: quanto trabalho manual existe hoje e quanta consciência o lead tem do
// problema. Quem reprecifica na mão várias vezes ao dia é o lead quente; quem
// nunca ajusta tem o mesmo dinheiro em jogo mas não percebe, e por isso é
// venda mais difícil, não mais fácil.
//
// Tentei dar bônus de porte pro "muito anúncio + nunca ajusta" (dor latente) e
// está errado: valor em jogo é porte, percepção do problema é intenção. Somar
// os dois no mesmo eixo faz o lead menos consciente furar a fila do mais
// consciente. Esse caso é alvo de EDUCAÇÃO (a trilha educacional da nutrição),
// não de prioridade de SDR.
export function portePrice(lead) {
  const a = IDX_LISTINGS[lead?.listings];
  if (a == null) return null;
  const r = IDX_REPRICE[lead?.repriceFreq];
  return subir(GRID[r ?? 0][a], ajustePorGmv(lead));
}

// ── Qualificação (0-100) ──────────────────────────────────────────────────
// Mede INTENÇÃO, não tamanho. Deliberadamente NÃO pontua comprimento de texto:
// "tenho 4 contas, 8 mil anúncios, clono na mão, quero ver preço" tem intenção
// máxima em 12 palavras, e um parágrafo genérico não tem nenhuma. Além disso
// seller responde no celular, onde texto longo é caro — pontuar tamanho
// penalizaria sistematicamente a maioria, e principalmente o lojista físico.
//
// O que conta é DENSIDADE DE DETALHE PRÓPRIO.

const RE_NUMERO = /\b\d{2,}\b|\bmil\b|\bR\$\s?\d/i;
const RE_PRIMEIRA_PESSOA = /\b(tenho|temos|estou|estamos|minha|meu|nossa|nosso|preciso|precisamos|faço|fazemos|vendo|vendemos)\b/i;
const RE_TEMPO = /\b(hoje|agora|ontem|semana|mês|meses|ano|anos|desde|acabei|comecei|abri|parei|recente|urgente)\b/i;
const RE_FERRAMENTA = /\b(bling|tiny|upseller|olist|anymarket|ihub|plugg|erp|planilha|excel|agência|agencia|freelancer|na m[ãa]o|manual)\b/i;

// "Nada ainda" não é ausência de resposta: é resposta honesta de quem ainda
// não tentou — vale menos que quem já apanhou, mas não é zero.
const TENTATIVAS_FORTES = new Set(["erp", "outra-ferramenta", "agencia"]);

// `asked` = chaves que o FORMULÁRIO de origem perguntou. Serve pra distinguir
// duas coisas que um número só confunde: lead que foi perguntado e não deu
// sinal (intenção baixa, legítima) e lead que nunca foi perguntado (intenção
// desconhecida). Tratar o segundo como zero jogaria todo lead do formulário
// antigo — que não tem as perguntas abertas — pra "nutrir", esvaziando a fila
// da SDR de gente que nunca teve chance de pontuar.
export function perguntouIntencao(lead, asked) {
  if (Array.isArray(asked) || asked instanceof Set) {
    const set = asked instanceof Set ? asked : new Set(asked);
    return set.has("trigger") || set.has("tried");
  }
  // Sem lista explícita, infere pela presença dos campos: `trigger` é
  // obrigatório nos formulários v2, então quem veio de lá sempre tem.
  return lead?.trigger !== undefined || lead?.tried !== undefined;
}

export function qualificacao(lead, asked) {
  const gatilho = String(lead?.trigger || "").trim();
  const tentou = Array.isArray(lead?.tried) ? lead.tried : (lead?.tried ? [lead.tried] : []);
  const tentouTexto = String(lead?.triedOther || "").trim();

  // A régua se ADAPTA ao que o formulário pergunta. Os formulários v2 ficaram
  // com uma aberta só (10/09), e manter os pesos antigos travaria o teto em 70
  // — a faixa "alta" (≥70) viraria inalcançável e ninguém nunca seria
  // prioridade. Lead que TEM a resposta do "já tentou" (vindo de API ou de um
  // formulário antigo) segue pontuando pela régua cheia.
  const temTentou = perguntouTentou(lead, asked);
  const PESOS = temTentou
    ? { gatilhoBase: 10, gatilhoTempo: 12, gatilhoNum: 8, espNum: 10, espPessoa: 9, espFerr: 6, compGatilho: 8, compTentou: 7 }
    : { gatilhoBase: 15, gatilhoTempo: 18, gatilhoNum: 12, espNum: 15, espPessoa: 12, espFerr: 8, compGatilho: 20, compTentou: 0 };

  // Gatilho: evento ou marcador de tempo nomeado é o melhor preditor de
  // urgência que cabe num formulário.
  let pGatilho = 0;
  if (gatilho) {
    pGatilho = PESOS.gatilhoBase;
    if (RE_TEMPO.test(gatilho)) pGatilho += PESOS.gatilhoTempo;
    if (RE_NUMERO.test(gatilho)) pGatilho += PESOS.gatilhoNum;
  }

  // Já tentou: quem já pagou por solução compra de novo, e nomear a ferramenta
  // entrega o concorrente pro SDR entrar sabendo contra quem fala.
  let pTentou = 0;
  if (temTentou && (tentou.length || tentouTexto)) {
    const soNada = tentou.length === 1 && tentou[0] === "nada";
    pTentou = soNada ? 8 : 18;
    if (tentou.some((t) => TENTATIVAS_FORTES.has(t))) pTentou += 8;
    if (RE_FERRAMENTA.test(tentouTexto)) pTentou += 4;
  }

  // Especificidade: número próprio e 1ª pessoa separam quem fala da PRÓPRIA
  // operação de quem repete o texto do anúncio.
  let pEspec = 0;
  const livre = [gatilho, tentouTexto].join(" ");
  if (RE_NUMERO.test(livre)) pEspec += PESOS.espNum;
  if (RE_PRIMEIRA_PESSOA.test(livre)) pEspec += PESOS.espPessoa;
  if (RE_FERRAMENTA.test(livre)) pEspec += PESOS.espFerr;

  // Completude: respondeu a aberta em vez de pular.
  let pCompleto = 0;
  if (gatilho) pCompleto += PESOS.compGatilho;
  if (temTentou && (tentou.length || tentouTexto)) pCompleto += PESOS.compTentou;

  const total = Math.min(100, pGatilho + pTentou + pEspec + pCompleto);
  return { total, gatilho: pGatilho, tentou: pTentou, especificidade: pEspec, completude: pCompleto };
}

// O formulário de origem tem a pergunta do "já tentou"? Decide qual régua vale.
export function perguntouTentou(lead, asked) {
  if (Array.isArray(asked) || asked instanceof Set) {
    const set = asked instanceof Set ? asked : new Set(asked);
    return set.has("tried");
  }
  return lead?.tried !== undefined || lead?.triedOther !== undefined;
}

export const faixaIntencao = (nota) => (nota >= 70 ? "alta" : nota >= 40 ? "media" : "baixa");

// ── Cruzamento: o que o SDR faz ───────────────────────────────────────────
// Nota isolada não diz o que fazer. O cruzamento diz — e é o que preserva a
// hora do SDR: perfil "leve" praticamente já é nutrição.
const ACOES = {
  "S/A": { alta: "ligar-15min", media: "ligar-hoje", baixa: "whats-depois-ligar" },
  "B/C": { alta: "ligar-hoje", media: "whats", baixa: "nutrir" },
  "D/E": { alta: "whats", media: "nutrir", baixa: "nutrir" },
};
const CADENCIA_DA_ACAO = {
  "ligar-15min": "prioritario",
  "ligar-hoje": "prioritario",
  "whats-depois-ligar": "padrao",
  whats: "padrao",
  nutrir: "leve",
};
const grupoDe = (letra) =>
  letra === "S" || letra === "A" ? "S/A" : letra === "B" || letra === "C" ? "B/C" : "D/E";

// ── Entrada única ─────────────────────────────────────────────────────────
export function classificar(lead, { asked } = {}) {
  const portes = { ads: porteAds(lead), oem: porteOem(lead), price: portePrice(lead) };

  // Porta errada: o lead preenche o form do anúncio que clicou, não o do
  // produto que precisa. O núcleo comum é o que permite corrigir — sem ele o
  // SDR pitcha o produto errado sem saber.
  const candidatoOem = lead?.niche === "autopecas" && lead?.partsType !== "usada";

  // Desempate EXPLÍCITO. Empate é comum (Ads e OEM leem eixos diferentes mas
  // caem na mesma matriz), e sem regra o vencedor saía da ordem das chaves do
  // objeto — bug silencioso. Em autopeças o OEM ganha porque entrega tudo que
  // o Ads entrega MAIS a criação por código de peça, pelo mesmo preço; o Price
  // nunca vence empate, é produto de attach.
  const PREFERENCIA = candidatoOem ? ["oem", "ads", "price"] : ["ads", "oem", "price"];

  // O produto primário é o de maior porte. O SEGUNDO vira backlog de
  // cross-sell com gatilho — não é pitch de primeira conversa.
  const ranking = Object.entries(portes)
    .filter(([, l]) => l)
    .sort((a, b) => {
      const dif = LETRAS.indexOf(b[1]) - LETRAS.indexOf(a[1]);
      return dif !== 0 ? dif : PREFERENCIA.indexOf(a[0]) - PREFERENCIA.indexOf(b[0]);
    });

  // A LINHA vem do formulário que o lead preencheu, não do score. Com os
  // formulários v2 enxutos (10/09) as perguntas específicas de cada linha
  // saíram, então não há mais dado pra OEM ou Price pontuarem sozinhos — e não
  // precisa haver: quem clicou no anúncio de OEM e preencheu o form de OEM já
  // declarou a linha. O score decide o NÍVEL, que é o que ele sabe medir.
  // Sem `formProduct` (lead de API, importação), cai no ranking como antes.
  let primario = lead?.formProduct && portes[lead.formProduct] !== undefined
    ? lead.formProduct
    : ranking[0]?.[0] || null;
  let crossSell = ranking.find(([k]) => k !== primario)?.[0] || null;

  // Trava do OEM: quem entra por OEM não compra Price direto (decisão
  // comercial 09/2026). O Price fica no backlog, nunca no primeiro contato.
  if (primario === "oem" && crossSell === "price") crossSell = ranking[2]?.[0] || null;

  // "Porta errada" mudou de sentido quando a linha passou a vir do formulário:
  // comparar formProduct com o primário virou tautologia. O que sobra — e é o
  // que o SDR precisa saber — é o lead de AUTOPEÇAS que entrou por um
  // formulário que não é o de OEM. Ele clicou no criativo de Ads, mas o pitch
  // certo é OEM. É o único cruzamento que o núcleo comum ainda enxerga.
  const portaErrada = Boolean(candidatoOem && lead?.formProduct && lead.formProduct !== "oem");

  const medida = perguntouIntencao(lead, asked);
  const q = medida ? qualificacao(lead, asked) : null;
  const intencao = medida ? faixaIntencao(q.total) : "nao-medida";
  // Porte da linha escolhida; se ela não tem eixo próprio preenchido (form
  // enxuto), cai no eixo genérico de contas × anúncios, que todo formulário
  // pergunta. Sem isso o lead de OEM ficaria sem porte e sumiria da fila.
  const letra = primario ? (portes[primario] || portes.ads || null) : null;
  // Sem intenção medida a tabela de cruzamento não se aplica: cai na coluna
  // neutra (a do meio), que é o tratamento honesto pra quem não foi perguntado.
  const acao = letra ? ACOES[grupoDe(letra)][medida ? intencao : "media"] : "nutrir";

  // MQL sai do formulário; SQL é do SDR (decisor + dor + orçamento) e por isso
  // não se calcula aqui — nenhuma dessas três perguntas está no form, de
  // propósito: no form elas assustam e envelhecem mal.
  // MQL sem intenção medida é INDETERMINADO, não falso: não dá pra reprovar
  // alguém por uma pergunta que ninguém fez.
  const mql = !letra ? false
    : !medida ? null
    : LETRAS.indexOf(letra) >= LETRAS.indexOf("C") && q.total >= 40;

  return {
    portes,
    primario,
    crossSell,
    porte: letra,
    qualificacao: medida ? q.total : null,
    detalheQualificacao: q,
    intencaoMedida: medida,
    intencao,
    acao,
    cadencia: CADENCIA_DA_ACAO[acao],
    mql,
    candidatoOem,
    portaErrada,
    gmv: gmvDe(lead),
    piso: pisoDe(lead),
    calculadoEm: new Date().toISOString(),
  };
}

// ── Contrato do Levercopy ─────────────────────────────────────────────────
// `POST /api/proposta/generate` (DiagnosticoIn + compute_score) espera os
// valores ANTIGOS de accounts/listings. DiagnosticoIn é todo opcional e tem
// fallback, então valor desconhecido não quebra — degrada em silêncio, que é
// pior. Traduz na fronteira preservando o ÍNDICE da faixa, mesma lógica da
// leitura dupla: o balde é o mesmo, só o rótulo mudou.
const PARA_LEVERCOPY = {
  accounts: { "1": "1", "2-3": "2", "4-6": "3-5", "7-10": "6-10", "10+": "10+" },
  listings: { "0-500": "0-100", "500-1000": "100-500", "1000-5000": "500-2000", "5000-10000": "2000-10000", "10000+": "10000+" },
};

export function traduzirParaLevercopy(key, valor) {
  const tabela = PARA_LEVERCOPY[key];
  if (!tabela || typeof valor !== "string") return valor;
  return tabela[valor] ?? valor; // já legado, ou valor fora da tabela: passa direto
}
