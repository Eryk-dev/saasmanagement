// Classificação por produto. O teste que mais importa é o PRIMEIRO: prova que
// nenhum lead da base histórica muda de grau quando as faixas são recortadas.
// Sem essa garantia a mudança reclassifica ~2 mil leads em produção e faz a
// tela de proposta sugerir o plano errado.

import test from "node:test";
import assert from "node:assert/strict";

const {
  classificar, porteAds, porteOem, portePrice, qualificacao, gmvDe,
} = await import("../src/classificacao.js");

// Réplica exata da régua ANTIGA (web/src/lib/ui.js antes do recorte), pra
// comparar grau a grau em vez de confiar em inspeção visual.
const GRID_ANTIGO = [
  ["E", "D", "C", "C", "C"],
  ["D", "C", "C", "B", "B"],
  ["C", "B", "B", "A", "A"],
  ["B", "B", "A", "S", "S"],
  ["A", "A", "A", "S", "S"],
];
const ACCOUNTS_ANTIGO = { "1": 0, "2": 1, "3-5": 2, "6-10": 3, "10+": 4 };
const LISTINGS_ANTIGO = { "0-100": 0, "100-500": 1, "500-2000": 2, "2000-10000": 3, "10000+": 4 };

test("base histórica: todo lead legado mantém exatamente o grau que já tinha", () => {
  for (const [acc, i] of Object.entries(ACCOUNTS_ANTIGO)) {
    for (const [lst, j] of Object.entries(LISTINGS_ANTIGO)) {
      const esperado = GRID_ANTIGO[i][j];
      const obtido = porteAds({ accounts: acc, listings: lst });
      assert.equal(obtido, esperado, `lead legado ${acc} × ${lst} mudou de ${esperado} para ${obtido}`);
    }
  }
});

test("faixas novas caem nas fronteiras comerciais (3 e 7 contas, 1k e 10k anúncios)", () => {
  // 2-3 contas é o teto do Essencial; 4-6 é o vão entre os planos; 7-10 é Escala.
  assert.equal(porteAds({ accounts: "2-3", listings: "500-1000" }), GRID_ANTIGO[1][1]);
  assert.equal(porteAds({ accounts: "4-6", listings: "1000-5000" }), GRID_ANTIGO[2][2]);
  assert.equal(porteAds({ accounts: "7-10", listings: "5000-10000" }), GRID_ANTIGO[3][3]);
});

test("OEM lê SKU, não anúncio ativo — o lojista físico não pode cair no balde do robô", () => {
  const fisico = { niche: "autopecas", partsType: "nova", accounts: "1", listings: "0-500", skus: "20000-50000" };
  // Pela régua de Ads ele é o pior caso possível; pelo potencial de OEM, não.
  assert.equal(porteAds(fisico), "E");
  const oem = porteOem(fisico);
  assert.notEqual(oem, "E");
  assert.equal(oem, GRID_ANTIGO[0][3]);
});

test("OEM não existe para peça usada", () => {
  assert.equal(porteOem({ niche: "autopecas", partsType: "usada", skus: "50000+", accounts: "10+" }), null);
});

test("Price: com o mesmo volume, quem reprecifica na mão é o lead mais quente", () => {
  const naoAjusta = portePrice({ listings: "5000-10000", repriceFreq: "nunca" });
  const ajustaSempre = portePrice({ listings: "5000-10000", repriceFreq: "varias-dia" });
  const ordem = ["E", "D", "C", "B", "A", "S"];
  assert.ok(
    ordem.indexOf(ajustaSempre) > ordem.indexOf(naoAjusta),
    `quem ajusta todo dia (${ajustaSempre}) deveria ranquear acima de quem nunca ajusta (${naoAjusta})`
  );
  // Volume continua mandando: pouco anúncio não vira lead de Price por esforço.
  assert.ok(ordem.indexOf(portePrice({ listings: "0-500", repriceFreq: "varias-dia" })) < ordem.indexOf(ajustaSempre));
});

test("qualificação não premia texto longo — premia detalhe próprio", () => {
  const curtoEspecifico = qualificacao({
    trigger: "abri a 2a conta esse mes, tenho 8000 anuncios pra replicar",
    tried: ["erp"], triedOther: "Bling",
  });
  const longoGenerico = qualificacao({
    trigger: "acho que seria muito bom para a minha empresa porque estamos sempre buscando melhorar "
      + "e crescer no mercado e queremos muito evoluir cada vez mais em tudo que fazemos",
    tried: [],
  });
  assert.ok(
    curtoEspecifico.total > longoGenerico.total,
    `resposta curta e específica (${curtoEspecifico.total}) deveria ganhar da longa e genérica (${longoGenerico.total})`
  );
});

test("GMV separa catálogo girando de catálogo morto", () => {
  const base = { accounts: "7-10", listings: "10000+" };
  const morto = porteAds({ ...base, orders: "0-200", ticket: "0-70" });
  const girando = porteAds({ ...base, orders: "2000+", ticket: "600+" });
  assert.notEqual(morto, girando);
  assert.equal(gmvDe({ orders: "2000+", ticket: "600+" }), 3000 * 800);
});

test("MQL exige porte E intenção — grande e frio não passa", () => {
  // Perguntado e sem resposta. (Sem perguntar, o MQL é indeterminado — está
  // coberto em "lead de formulário sem as perguntas abertas".)
  const grandeFrio = classificar({ accounts: "10+", listings: "10000+", trigger: "", tried: [] });
  assert.equal(grandeFrio.mql, false, "lead grande sem nenhum sinal de intenção não é MQL");

  const grandeQuente = classificar({
    accounts: "10+", listings: "10000+",
    trigger: "abri 3 contas esse mes e nao dou conta de replicar os 12000 anuncios na mao",
    tried: ["outra-ferramenta"], triedOther: "usei o Upseller e nao deu conta",
  });
  assert.equal(grandeQuente.mql, true);
  assert.equal(grandeQuente.acao, "ligar-15min");
});

test("trava do OEM: quem entra por OEM não recebe Price no primeiro contato", () => {
  const r = classificar({
    niche: "autopecas", partsType: "nova", skus: "50000+",
    accounts: "7-10", listings: "10000+", repriceFreq: "nunca",
  });
  assert.equal(r.primario, "oem");
  assert.notEqual(r.crossSell, "price");
});

test("porta errada: autopeças que entrou por um formulário que não é o de OEM", () => {
  const r = classificar({ formProduct: "ads", niche: "autopecas", accounts: "1", listings: "0-500" });
  assert.equal(r.candidatoOem, true);
  assert.equal(r.portaErrada, true, "o SDR precisa saber que o pitch certo é OEM");

  // Pelo formulário certo não há divergência a avisar.
  const certo = classificar({ formProduct: "oem", niche: "autopecas", accounts: "1", listings: "0-500" });
  assert.equal(certo.portaErrada, false);

  // Nicho fora de autopeças nunca é candidato a OEM, entre por onde entrar.
  const outro = classificar({ formProduct: "ads", niche: "moda", accounts: "1", listings: "0-500" });
  assert.equal(outro.candidatoOem, false);
  assert.equal(outro.portaErrada, false);
});

// ── Interação com o catálogo v2 (#880) ────────────────────────────────────
// O catálogo traduz faixa de contas → pacote com `map[accounts] || "essencial"`.
// Chave desconhecida não erra: cai no plano mais barato. Com as faixas
// recortadas isso reproporia Essencial pra lead de 7-10 contas.
test("catálogo: toda faixa de conta (nova e legada) resolve um pacote explícito", async () => {
  const { pkgOf } = await import("../src/proposal-catalog.js");
  const { ACCOUNTS_OPTIONS } = await import("../src/classificacao.js");

  const legadas = ["1", "2", "3-5", "6-10", "10+"];
  const novas = ACCOUNTS_OPTIONS.map((o) => o.value);

  for (const acc of [...legadas, ...novas]) {
    const pkg = pkgOf({}, { accounts: acc });
    assert.ok(["essencial", "escala", "enterprise"].includes(pkg), `faixa ${acc} não resolveu pacote`);
  }

  // O caso que motivou o teste: operação grande não pode cair no mais barato.
  assert.notEqual(pkgOf({}, { accounts: "7-10" }), "essencial", "7-10 contas caindo em Essencial");
  assert.equal(pkgOf({}, { accounts: "10+" }), "enterprise");
  // Teto do Essencial é 3 contas: quem tem 4 já estourou.
  assert.equal(pkgOf({}, { accounts: "2-3" }), "essencial");
  assert.equal(pkgOf({}, { accounts: "4-6" }), "escala");
});

// ── Intenção não perguntada ≠ intenção baixa ──────────────────────────────
// O formulário antigo não tem `trigger`/`tried`. Se um lead dele nascesse com
// qualificação 0, a tabela de ação mandaria TODOS pra "nutrir" — esvaziando a
// fila da SDR de gente que nunca teve chance de pontuar.
test("lead de formulário sem as perguntas abertas fica com intenção não medida", () => {
  const antigo = { accounts: "3-5", listings: "500-2000", niche: "autopecas" };
  const r = classificar(antigo, { asked: ["accounts", "listings", "niche"] });

  assert.equal(r.qualificacao, null, "não pode inventar nota de intenção");
  assert.equal(r.intencao, "nao-medida");
  assert.equal(r.intencaoMedida, false);
  assert.equal(r.mql, null, "MQL indeterminado, não reprovado");
  assert.ok(r.porte, "o porte, esse dá pra calcular");
  assert.notEqual(r.acao, "nutrir", "não pode ir pra nutrição por pergunta que ninguém fez");
});

test("lead perguntado que não deu sinal fica com intenção baixa de verdade", () => {
  const asked = ["accounts", "listings", "niche", "trigger", "tried"];
  const r = classificar({ accounts: "3-5", listings: "500-2000", trigger: "", tried: [] }, { asked });

  assert.equal(r.intencaoMedida, true);
  assert.equal(r.qualificacao, 0);
  assert.equal(r.intencao, "baixa");
  assert.equal(r.mql, false, "perguntado e sem sinal: reprovado de verdade");
});

test("sem lista de perguntas, infere pela presença dos campos", () => {
  const semCampos = classificar({ accounts: "2-3", listings: "500-1000" });
  assert.equal(semCampos.intencaoMedida, false);

  const comCampos = classificar({ accounts: "2-3", listings: "500-1000", trigger: "abri a 2a conta esse mes" });
  assert.equal(comCampos.intencaoMedida, true);
  assert.ok(comCampos.qualificacao > 0);
});

test("porte alto sem intenção medida continua indo pra ligação, não pra nutrição", () => {
  const r = classificar({ accounts: "10+", listings: "10000+" }, { asked: ["accounts", "listings"] });
  assert.equal(r.acao, "ligar-hoje");
});

// ── Régua adaptativa (formulários v2 com uma aberta só) ───────────────────
test("com uma aberta só, a faixa 'alta' continua alcançável", () => {
  // Sem rebalancear, o teto cairia pra 70 e ≥70 nunca aconteceria — ninguém
  // seria prioridade e a tabela de ação colapsaria em média/baixa.
  const asked = ["niche", "accounts", "listings", "trigger", "orders", "ticket"];
  const q = qualificacao({ trigger: "abri a 2a conta esse mes e ja tenho 8000 anuncios pra replicar" }, asked);
  assert.ok(q.total >= 70, `melhor resposta possível deu ${q.total}, e a faixa alta exige 70`);
  assert.ok(q.total <= 100);
  assert.equal(q.tentou, 0, "não pontua pergunta que o formulário não faz");
});

test("lead que TEM a resposta do 'já tentou' segue na régua cheia", () => {
  const asked = ["trigger", "tried"];
  const q = qualificacao({ trigger: "abri a 2a conta esse mes", tried: ["erp"], triedOther: "Bling" }, asked);
  assert.ok(q.tentou > 0, "quem respondeu não pode perder os pontos");
  assert.ok(q.total <= 100);
});

test("resposta vazia continua valendo zero nas duas réguas", () => {
  assert.equal(qualificacao({ trigger: "" }, ["trigger"]).total, 0);
  assert.equal(qualificacao({ trigger: "" }, ["trigger", "tried"]).total, 0);
});

test("a linha vem do formulário; sem ele, cai no ranking", () => {
  const base = { niche: "moda", accounts: "7-10", listings: "10000+" };
  assert.equal(classificar({ ...base, formProduct: "price" }).primario, "price");
  assert.equal(classificar({ ...base, formProduct: "oem" }).primario, "oem");
  assert.ok(classificar(base).primario, "lead sem formProduct ainda precisa de uma linha");
});

test("lead de OEM sem as perguntas específicas não fica sem porte", () => {
  // O formulário enxuto não pergunta SKU, então porteOem não resolve sozinho —
  // o porte cai no eixo genérico de contas × anúncios em vez de sumir.
  const r = classificar({ formProduct: "oem", niche: "autopecas", accounts: "7-10", listings: "5000-10000" });
  assert.equal(r.primario, "oem");
  assert.ok(r.porte, "sem porte o lead sumiria da fila do SDR");
});
