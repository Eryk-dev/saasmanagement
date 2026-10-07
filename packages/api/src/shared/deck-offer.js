// Apresentação em slides: a conta do plano e as escolhas da tela zero.
// Fonte única compartilhada pela API (página /p/:id, link do cliente) e pela
// SPA (configuração da apresentação no card de Atividades). Sem dependências
// de servidor; os Dockerfiles de build web copiam a pasta shared/.
//
// As duas funções são injetadas no script da página por toString(): sem crase,
// sem sintaxe que o navegador do cliente não rode (var, function).

// ── A conta do plano ────────────────────────────────────────────────────────
// UMA função, usada no servidor (pra montar o deck do link do cliente) e
// injetada no script da tela zero por toString() — assim o número que o closer
// vê montando e o que o cliente recebe não podem divergir. Sem crases: ela é
// serializada dentro do template literal da página.
export function calcOferta(cat, st) {
  var prods = (cat && cat.products) || {};
  var anual = st.periodo !== "semestral";
  var parcelas = anual ? 12 : 6;
  var fmt = function (n) { return Math.round(Number(n) || 0).toLocaleString("pt-BR"); };
  var contas = Math.max(1, Math.round(Number(st.contas) || 1));
  var extraPer = Number(((cat.addons || {}).contaExtra || {}).per) || 100;
  var mensal = 0, setup = 0, nomes = [], entregaveis = [];

  var plat = st.plataforma ? prods[st.linha + "_" + st.tier] : null;
  if (plat) {
    var per = Number((anual ? plat.anu : plat.sem).per) || 0;
    var inclusas = Number(plat.contas) || 0;
    var extras = Math.max(0, contas - inclusas);
    mensal += per + extras * extraPer;
    nomes.push(plat.name);
    entregaveis.push({
      tag: plat.name,
      itens: ((plat.inclui || {}).motor || []).concat((plat.inclui || {}).plataforma || []),
      notaDestaque: extras ? "Contas extras:" : "Contas inclusas:",
      nota: extras
        ? extras + " conta" + (extras > 1 ? "s" : "") + " além das " + inclusas + " do pacote, R$ " + fmt(extraPer) + " por conta em cada parcela."
        : inclusas + " contas no pacote, prontas pra receber os anúncios."
    });
  }

  var price = st.price ? prods["price_" + st.priceTier] : null;
  if (price) {
    mensal += Number((anual ? price.anu : price.sem).per) || 0;
    nomes.push(price.name);
    entregaveis.push({
      tag: price.name,
      itens: ((price.inclui || {}).motor || []).concat((price.inclui || {}).plataforma || []),
      notaDestaque: "Margem primeiro:",
      nota: "o preço se move sozinho o dia inteiro, sempre acima da margem que você definir."
    });
  }

  var packs = (cat.oemPacks || []);
  var pack = st.oem ? packs.filter(function (x) { return Number(x.qty) === Number(st.oemPack); })[0] : null;
  if (pack) {
    setup += Number(pack.price) || 0;
    nomes.push("OEM " + fmt(pack.qty));
    entregaveis.push({
      tag: "OEM · anúncio perfeito",
      itens: [
        fmt(pack.qty) + " anúncios criados e publicados",
        "Título otimizado por marketplace",
        "Descrição e ficha técnica específicas",
        "Compatibilidade completa de veículos"
      ],
      notaDestaque: "Pagamento único:",
      nota: "R$ " + fmt(setup) + " na contratação, fora das parcelas do plano."
    });
  }

  entregaveis.push({
    tag: "O lado humano",
    itens: [
      "Suporte humano via WhatsApp",
      "Call de plano de ação e setup",
      "Resultado conferido mês a mês",
      "Garantia incondicional de 2 meses"
    ],
    notaDestaque: "Time Lever dentro da sua operação:",
    nota: "quem vende todo dia, cuidando de quem vende todo dia."
  });

  var vistaPct = Math.min(90, Math.max(0, Number(st.vistaPct) || 0));
  var vista = mensal * parcelas * (1 - vistaPct / 100);
  // Ticket e pedidos vêm da CALL (o formulário não pergunta): sem os dois o
  // slide "Na prática" sai da apresentação em vez de mostrar uma conta falsa.
  var ticket = Math.max(0, Number(st.ticket) || 0);
  var vendas = mensal && ticket ? Math.ceil(mensal / ticket) : 0;
  var pedidos = Math.max(0, Number(st.pedidos) || 0);
  var pct = pedidos && vendas ? (vendas / pedidos * 100) : 0;
  var demo = nomes.length ? nomes.join(", ").replace(/, ([^,]*)$/, " e $1") : "a plataforma";

  return {
    planoNome: nomes.length ? nomes.join(" + ") : "Selecione um produto",
    demoLista: demo,
    periodoLabel: anual ? "anual" : "semestral",
    parcelas: parcelas,
    mensal: mensal,
    mensalFmt: fmt(mensal),
    vistaFmt: fmt(vista),
    setupFmt: fmt(setup),
    oemPackFmt: pack ? fmt(pack.qty) : "0",
    pedidosFmt: fmt(pedidos),
    ticketFmt: fmt(ticket),
    vendasNecessarias: vendas,
    percentualExtra: pct ? pct.toFixed(1).replace(".", ",") + "%" : "—",
    entregaveis: entregaveis,
    mostra: {
      ads: !!plat,
      oem: st.linha === "oem" && !!plat ? true : !!pack,
      price: !!price,
      pratica: vendas > 0 && pedidos > 0,
      resultados: true
    }
  };
}

// As escolhas da tela zero, lidas do catálogo (a projeção dos planos de
// Comercial → Planos): toda chave `<linha>_<pacote>` vira um plano escolhível,
// com o nome do plano, e nada aqui é lista fixa. `price_*` é o Lever Price;
// o resto é plataforma (LeverAds), agrupado pelo nome da linha. Plano cuja
// chave não segue `<linha>_<pacote>` não entra: a tela zero guarda a escolha
// como linha + pacote, e a conta acima procura o produto por essa chave.
export function deckChoices(cat) {
  var prods = (cat && cat.products) || {};
  var lines = (cat && cat.lines) || {};
  var plataforma = [], price = [];
  Object.keys(prods).forEach(function (key) {
    var pr = prods[key] || {};
    var line = pr.line && key.indexOf(pr.line + "_") === 0 ? pr.line : key.split("_")[0];
    var tier = key.slice(line.length + 1);
    if (!line || !tier || key !== line + "_" + tier) return;
    var item = {
      key: key, linha: line, tier: tier, name: pr.name || key,
      group: (lines[line] && lines[line].name) || line,
      contas: Number(pr.contas) || 0,
      anual: Number((pr.anu || {}).per) || 0,
      semestral: Number((pr.sem || {}).per) || 0
    };
    if (line === "price") price.push(item); else plataforma.push(item);
  });
  var oemPacks = ((cat && cat.oemPacks) || []).filter(function (pk) { return pk && Number(pk.qty) > 0; })
    .map(function (pk) { return { qty: Number(pk.qty), price: Number(pk.price) || 0 }; });
  return { plataforma: plataforma, price: price, oemPacks: oemPacks };
}
