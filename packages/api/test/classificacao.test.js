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
  const grandeFrio = classificar({ accounts: "10+", listings: "10000+" });
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

test("porta errada é detectada pelo núcleo comum", () => {
  const r = classificar({
    formProduct: "ads", niche: "autopecas", partsType: "nova",
    skus: "50000+", accounts: "1", listings: "0-500",
  });
  assert.equal(r.candidatoOem, true);
  assert.equal(r.portaErrada, true);
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
