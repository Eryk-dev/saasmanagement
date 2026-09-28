// Apresentação de CRIAÇÃO DE ANÚNCIOS por código OEM (serviço avulso), pedida
// pelo Leo em 28/09/2026. É um produto novo e diferente da plataforma: a gente
// cria anúncios NOVOS pro cliente — título, compatibilidade, fotos e descrição —
// por fora do sistema, e cobra por anúncio criado. Nada de mensalidade.
//
// Mesmo palco 16:9 da apresentação oficial (proposal-slides-page.js): o
// DECK_CSS vem de lá (um design system só), e navegação, notas do apresentador,
// impressão e aceite se comportam igual. O que muda é o conteúdo e, sobretudo,
// a TELA ZERO: aqui ela tem DOIS números, quantidade de anúncios e valor de
// cada um. O resto do deck é fixo, porque o que entra em cada anúncio não muda
// de cliente pra cliente — é a entrega padrão.
//
// Sem número inventado: quantidade e valor nascem vazios (decisão do Leo) e o
// slide mostra [quantidade] / [valor] / [total] até o closer preencher, do mesmo
// jeito que o deck oficial mostra [contas]. Colchete na tela é recado pro
// closer; número chutado seria mentira na frente do cliente.
//
// Os PRINTS são de um anúncio real nosso (interruptor de vidro GM 93350569),
// servidos pela PRÓPRIA API em /public/deck/oem/ (rota em routes.proposals.js,
// arquivos em packages/api/src/assets/deck-oem). Mesma origem da página em
// produção e em desenvolvimento, sem depender de bucket externo. Print que
// faltar vira espaço reservado escrito na tela — nunca um ícone de imagem
// quebrada no meio da call.
//
// REGRA DO ARQUIVO (igual ao proposal-page.js e ao proposal-slides-page.js): o
// HTML é UM template literal e o script do cliente mora dentro dele — nada de
// crase aqui, e backslash de regex precisa ser dobrado.

import { DECK_CSS } from "./proposal-slides-page.js";

// Caminho público dos prints. Servido pela API (OPEN_PREFIXES "/public/deck/"),
// que em produção é a mesma origem da página /p/:id.
export const OEM_PRINTS_BASE = "/public/deck/oem/";
// Os arquivos esperados na pasta de assets. A ORDEM é a que o Leo colou na
// conversa: a página do anúncio, as cinco fotos, a ficha técnica e a descrição.
export const OEM_PRINTS = [
  { file: "anuncio.jpg", label: "print da página do anúncio" },
  { file: "foto-1.jpg", label: "foto principal (peça + aplicação)" },
  { file: "foto-2.jpg", label: "foto em perspectiva" },
  { file: "foto-3.jpg", label: "foto de frente" },
  { file: "foto-4.jpg", label: "foto do conector" },
  { file: "foto-5.jpg", label: "foto com as medidas" },
  { file: "ficha.jpg", label: "print da ficha técnica" },
  { file: "descricao.jpg", label: "print da descrição" },
];

const OEM_CSS = `
/* ── Prints do anúncio padrão ───────────────────────────────────────────── */
/* O print entra numa moldura clara de card. object-fit:contain porque cada
   print veio num tamanho: cortar a ficha técnica ou a descrição esconderia
   justamente o que o slide existe pra mostrar. */
.print-frame { background: var(--paper-card); border: 1px solid var(--line); border-radius: 12px;
  box-shadow: var(--shadow-card); overflow: hidden; display: flex; flex-direction: column; min-height: 0; }
.print-bar { flex: none; display: flex; align-items: center; gap: 10px; padding: 14px 18px;
  border-bottom: 1px solid var(--line-faint); background: var(--paper-subtle); }
.print-bar i { width: 12px; height: 12px; border-radius: 999px; background: var(--line-strong); display: block; }
.print-bar span { margin-left: 8px; font: 500 20px/1 var(--font-mono); color: var(--ink-faint);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.print-body { flex: 1; min-height: 0; padding: 16px; display: flex; }
.print { width: 100%; height: 100%; object-fit: contain; object-position: top center; display: block; }
/* Print de topo (página comprida): mostra o começo e deixa o resto sangrar pra
   fora do card, que é como um print de página real se lê num slide. */
.print-topo .print { object-fit: cover; object-position: top center; }
/* Moldura que se ajusta à imagem: o card fica do tamanho do print, como uma
   janela de navegador aberta no tamanho da página. Sem isto, um print deitado
   dentro de uma caixa em pé vira tarja branca em cima e embaixo. */
.print-auto { align-self: center; height: auto !important; }
.print-auto .print-body, .print-auto .print { height: auto; }
/* Foto de produto: o assunto fica no meio da caixa, não grudado no topo. */
.print-centro .print { object-position: center; }
/* Espaço reservado: entra no lugar do print que ainda não subiu. */
.print-vazio { flex: 1; display: flex; align-items: center; justify-content: center; text-align: center;
  border: 2px dashed var(--line-strong); border-radius: 10px; color: var(--ink-faint);
  font: 600 22px/1.4 var(--font-sans); padding: 26px; }
`;

// Modo EMBUTIDO (?embed=config): o cockpit abre só a tela zero num iframe
// dentro do card do lead (today.jsx → PresentationConfig). Mesmo tratamento do
// deck oficial: o palco para de ser palco, some tudo que é de apresentação e
// sobram os dois números e o total, com o atalho pra abrir a apresentação em
// aba. O cliente e a empresa não aparecem aqui porque estão no card ao lado.
const CFG_ONLY_CSS = `
html, body { height: auto; overflow: auto; background: var(--paper-card); }
.stage, #canvas { position: static; width: 100%; height: auto; overflow: visible; transform: none !important; }
#canvas { box-shadow: none; background: var(--paper-card); }
#canvas > section { display: none !important; }
#canvas > [data-cfg-screen] { display: block !important; position: static; width: 100%; height: auto; padding: 0; background: var(--paper-card) !important; }
[data-cfg-screen] > div { zoom: 1 !important; width: 100% !important; padding: 0 !important; gap: 12px !important; }
[data-cfg-screen] > div > div:first-child { padding: 0 0 8px !important; }
[data-cfg-screen] > div > div:first-child > div:first-child, [data-act="capa"], .hud, .notas { display: none !important; }
[data-cfg-screen] > div > div:nth-child(2) { grid-template-columns: minmax(0,1fr) !important; gap: 12px !important; }
.cfg-card { padding: 0; gap: 8px; min-width: 0; border: 0; box-shadow: none; }
.cfg-client { display: none !important; }
.cfg-kicker { font-size: 11px; }
.cfg-input { height: 30px; font-size: 12px; }
.cfg-value { display: grid !important; grid-template-columns: minmax(0,1fr) auto; align-items: center; padding: 10px 12px !important; gap: 4px 8px !important; }
.cfg-value > div { grid-column: 1; min-width: 0; overflow-wrap: anywhere; }
.cfg-value > div:nth-child(2) { font-size: 18px !important; }
.cfg-present { grid-column: 2; grid-row: 1 / span 3; align-self: center; display: inline-flex; align-items: center; justify-content: center;
  min-height: 34px; padding: 0 9px; border-radius: 999px; background: var(--paper-card); color: var(--ink);
  font-size: 11.5px; font-weight: 600; text-decoration: none; white-space: nowrap; }
.cfg-present:focus-visible { outline: 2px solid var(--brand); outline-offset: 3px; }
@media (pointer: coarse) { .cfg-input, .cfg-present { min-height: 44px; } }
`;

const escJson = (obj) => JSON.stringify(obj).replace(/</g, "\\u003c");
const escHtml = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// Print dentro da moldura. `topo` corta o excesso por baixo (página comprida);
// sem ele a imagem cabe inteira. O texto da barra é o endereço de onde o print
// saiu — ele é que diz "isto é um anúncio de verdade, não uma arte".
function print(file, label, { topo = false, auto = false, centro = false, barra = "mercadolivre.com.br" } = {}) {
  const classes = ["print-frame", topo ? "print-topo" : "", auto ? "print-auto" : "", centro ? "print-centro" : ""].filter(Boolean).join(" ");
  return `<div class="${classes}" style="height:100%">
    <div class="print-bar"><i></i><i></i><i></i><span>${escHtml(barra)}</span></div>
    <div class="print-body"><img class="print" data-print="${escHtml(label)}" src="${OEM_PRINTS_BASE}${file}" alt="${escHtml(label)}"></div>
  </div>`;
}

// Cabeçalho de slide: rótulo à esquerda, número à direita. Igual ao do deck
// oficial, de propósito — é a mesma apresentação, outro produto.
function topo(rotulo, numero, margem = 48) {
  return `<div style="display:flex;align-items:center;justify-content:space-between;gap:24px;padding-bottom:24px;border-bottom:1px solid var(--line);margin-bottom:${margem}px">
    <span style="font-size:24px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:var(--ink-faint)">${rotulo}</span>
    <span style="font-family:var(--font-mono);font-size:24px;color:var(--ink-faint)">${numero}</span>
  </div>`;
}

const LOGO = `<span class="logo" style="height:44px;width:auto;display:block"><svg viewBox="350 380 700 760" fill="currentColor" style="height:100%;width:auto;display:block" aria-hidden="true"><path d="M519.22,843.75l-45.1,15.11c53.94,77.43,143.68,128.2,245.06,128.2,4.38,0,8.76-.08,13.07-.3l-14.13-45.02c-80.76-.3-152.75-38.68-198.9-97.98ZM719.19,390.03c-164.61,0-298.55,133.94-298.55,298.55,0,29.46,4.31,58.02,12.31,84.91l39.13-29.31c-4-17.9-6.12-36.49-6.12-55.6,0-139.6,113.62-253.22,253.22-253.22s253.15,113.62,253.15,253.22c0,99.49-57.71,185.84-141.42,227.16v49.63c109.39-44.27,186.74-151.69,186.74-276.79,0-164.61-133.86-298.55-298.47-298.55Z"></path><polygon points="800.7 535.53 800.7 1103.92 763 983.8 749.25 939.91 691.16 754.61 501.54 817.84 457.65 832.42 362.47 864.14 443.6 803.33 481.22 775.08 800.7 535.53"></polygon></svg></span>`;

// Card de entregável (4 no slide 01). Texto fixo: é o que a gente entrega em
// TODO anúncio, não depende do que o closer configurou.
function entregavel(icone, titulo, texto) {
  return `<div style="background:var(--paper-card);border:1px solid var(--line);border-radius:12px;box-shadow:var(--shadow-card);padding:36px;display:flex;flex-direction:column;justify-content:center;gap:22px;min-width:0">
    <span style="flex:none;width:72px;height:72px;border-radius:12px;background:var(--ink);display:flex;align-items:center;justify-content:center">${icone}</span>
    <div style="font-size:34px;font-weight:600;letter-spacing:-0.015em;line-height:1.15">${titulo}</div>
    <div style="font-size:25px;color:var(--ink-muted);line-height:1.4">${texto}</div>
  </div>`;
}

const ICON = {
  titulo: `<svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M4 12h10M4 17h7"></path><path d="m16 15 2 2 4-4"></path></svg>`,
  carro: `<svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 16l1.5-5h11L19 16"></path><rect x="3" y="16" width="18" height="3" rx="1"></rect><circle cx="7" cy="20" r="1.5"></circle><circle cx="17" cy="20" r="1.5"></circle></svg>`,
  foto: `<svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6" width="18" height="14" rx="2"></rect><path d="M8 6l1.5-2h5L16 6"></path><circle cx="12" cy="13" r="3.2"></circle></svg>`,
  busca: `<svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="6.5"></circle><path d="m16 16 4.5 4.5"></path><path d="M8.5 11h5M11 8.5v5"></path></svg>`,
};

const SLIDES = `
<section data-label="Capa" data-screen-label="Capa" data-speaker-notes="Abertura. Diga em uma frase o que vem: o que é um anúncio feito por nós, como ele fica no ar e quanto custa por anúncio." data-theme="dark" style="background:var(--paper);color:var(--ink);font-family:var(--font-sans);padding:96px 112px 88px;display:flex;flex-direction:column;justify-content:space-between">
  <div style="display:flex;align-items:center;gap:18px">${LOGO}<span style="font-size:32px;font-weight:700;letter-spacing:-0.02em">LeverAds</span></div>
  <div style="display:flex;flex-direction:column;gap:32px;max-width:1300px">
    <div style="font-size:24px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:var(--ink-faint)">Criação de anúncios · OEM</div>
    <h1 style="margin:0;font-size:104px;line-height:1.02;letter-spacing:-0.03em;font-weight:700;text-wrap:balance">Seu estoque no ar como anúncio pronto pra vender.</h1>
    <div style="font-size:30px;color:var(--ink-muted);line-height:1.45"><span data-f="qtdFmt"></span> anúncios criados do zero pelo código OEM da peça.</div>
  </div>
  <div style="display:flex;align-items:center;justify-content:space-between;gap:24px;padding-top:28px;border-top:1px solid var(--line);font-size:24px;color:var(--ink-faint)">
    <span><span data-f="f.nome"></span> · <span data-f="f.empresa"></span></span>
    <span style="font-family:var(--font-mono);font-variant-numeric:tabular-nums"><span data-f="hoje"></span></span>
  </div>
</section>

<section data-label="O que entra" data-screen-label="01 O que entra" data-speaker-notes="Os quatro itens da entrega. Não corra: é aqui que fica claro que o anúncio é feito à mão pelo nosso time, não gerado no automático." style="background:var(--paper);color:var(--ink);font-family:var(--font-sans);padding:88px 112px 80px;display:flex;flex-direction:column">
  ${topo("O que entra em cada anúncio", "01", 40)}
  <h2 style="margin:0 0 20px;font-size:60px;line-height:1.05;letter-spacing:-0.025em;font-weight:700;max-width:1400px;text-wrap:balance">Anúncio completo, do título à descrição. <span style="color:var(--brand)">Sem você digitar nada.</span></h2>
  <p style="margin:0 0 44px;font-size:28px;line-height:1.45;color:var(--ink-muted);max-width:1200px;text-wrap:pretty">Você manda os códigos OEM das peças. A gente devolve o anúncio pronto, publicado na sua conta.</p>
  <div style="flex:1;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:24px">
    ${entregavel(ICON.titulo, "Título de 200 caracteres", "Marca, modelos, anos e o código OEM dentro do limite do marketplace. O título é a busca do comprador, escrita inteira.")}
    ${entregavel(ICON.carro, "Compatibilidade completa", "Cada montadora, modelo, versão e ano na ficha de aplicação. A peça aparece na busca por veículo, que é onde o cliente procura.")}
    ${entregavel(ICON.foto, "3 a 5 fotos estilizadas", "Fundo limpo, ângulos reais da peça, aplicação e medidas. Foto tratada por nós, feita pra vender, não pra ilustrar.")}
    ${entregavel(ICON.busca, "Descrição completa pra SEO", "Aplicações ano a ano, especificações, códigos OEM equivalentes e conteúdo da embalagem. Texto escrito pra ranquear.")}
  </div>
</section>

<section data-label="O anúncio padrão" data-screen-label="02 O anúncio padrão" data-speaker-notes="Este é um anúncio nosso, no ar. Mostre o título completo, o box verde de compatibilidade e a galeria de fotos à esquerda." data-theme="dark" style="background:var(--paper);color:var(--ink);font-family:var(--font-sans);padding:88px 112px 80px;display:flex;flex-direction:column">
  ${topo("O anúncio padrão", "02", 40)}
  <div style="flex:1;display:grid;grid-template-columns:minmax(0,0.72fr) minmax(0,1.28fr);gap:56px;align-items:center;min-height:0">
    <div style="min-width:0">
      <h2 style="margin:0 0 24px;font-size:58px;line-height:1.05;letter-spacing:-0.03em;font-weight:700;text-wrap:balance">É assim que ele fica <span style="color:var(--brand)">no ar.</span></h2>
      <p style="margin:0 0 36px;font-size:27px;line-height:1.5;color:var(--ink-muted);text-wrap:pretty">Um anúncio nosso, publicado hoje. Cada detalhe da tela veio do padrão que você acabou de ver.</p>
      <div style="display:flex;flex-direction:column;gap:18px">
        <div style="display:flex;gap:16px;font-size:25px;line-height:1.35;color:var(--ink)"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="var(--brand)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="flex:none;margin-top:4px"><path d="m5 12.5 4.5 4.5L19 7"></path></svg><span>Título com marca, sete modelos, dez anos e o código da peça</span></div>
        <div style="display:flex;gap:16px;font-size:25px;line-height:1.35;color:var(--ink)"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="var(--brand)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="flex:none;margin-top:4px"><path d="m5 12.5 4.5 4.5L19 7"></path></svg><span>Busca por veículo no anúncio: marca, modelo, ano e versão</span></div>
        <div style="display:flex;gap:16px;font-size:25px;line-height:1.35;color:var(--ink)"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="var(--brand)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="flex:none;margin-top:4px"><path d="m5 12.5 4.5 4.5L19 7"></path></svg><span>Galeria com as fotos tratadas, na ordem que vende</span></div>
      </div>
    </div>
    <div style="min-width:0;display:flex;align-items:center;min-height:0">${print("anuncio.jpg", "print da página do anúncio", { auto: true })}</div>
  </div>
</section>

<section data-label="As fotos" data-screen-label="03 As fotos" data-speaker-notes="Cinco fotos do mesmo anúncio. Aponte a primeira (peça + aplicação) e a última (medidas): são as duas que mais tiram dúvida antes da compra." style="background:var(--paper);color:var(--ink);font-family:var(--font-sans);padding:88px 112px 80px;display:flex;flex-direction:column">
  ${topo("As fotos", "03", 36)}
  <h2 style="margin:0 0 16px;font-size:58px;line-height:1.05;letter-spacing:-0.025em;font-weight:700;max-width:1400px;text-wrap:balance">De 3 a 5 fotos por anúncio, <span style="color:var(--brand)">tratadas uma a uma.</span></h2>
  <p style="margin:0 0 40px;font-size:27px;line-height:1.45;color:var(--ink-muted);max-width:1250px;text-wrap:pretty">Principal com a aplicação no veículo, ângulos reais da peça, o conector e uma foto com as medidas. Fundo limpo em todas, do jeito que o marketplace premia.</p>
  <div style="flex:1;display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:20px;min-height:0">
    ${print("foto-1.jpg", "foto principal (peça + aplicação)", { centro: true, barra: "foto 1" })}
    ${print("foto-2.jpg", "foto em perspectiva", { centro: true, barra: "foto 2" })}
    ${print("foto-3.jpg", "foto de frente", { centro: true, barra: "foto 3" })}
    ${print("foto-4.jpg", "foto do conector", { centro: true, barra: "foto 4" })}
    ${print("foto-5.jpg", "foto com as medidas", { centro: true, barra: "foto 5" })}
  </div>
</section>

<section data-label="Ficha e descrição" data-screen-label="04 Ficha e descrição" data-speaker-notes="A parte que ninguém tem paciência de preencher. Ficha técnica completa e descrição com a aplicação ano a ano: é o que faz o anúncio ser encontrado." data-theme="dark" style="background:var(--paper);color:var(--ink);font-family:var(--font-sans);padding:88px 112px 80px;display:flex;flex-direction:column">
  ${topo("Ficha técnica e descrição", "04", 36)}
  <h2 style="margin:0 0 16px;font-size:58px;line-height:1.05;letter-spacing:-0.025em;font-weight:700;max-width:1400px;text-wrap:balance">A parte chata, feita <span style="color:var(--brand)">por inteiro.</span></h2>
  <p style="margin:0 0 40px;font-size:27px;line-height:1.45;color:var(--ink-muted);max-width:1250px;text-wrap:pretty">Ficha preenchida campo a campo (marca, número de peça, código OEM, tipo de veículo) e descrição com todas as aplicações, ano a ano, códigos equivalentes e o que vai na caixa.</p>
  <div style="flex:1;display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:28px;min-height:0">
    ${print("ficha.jpg", "print da ficha técnica", { barra: "ficha técnica" })}
    ${print("descricao.jpg", "print da descrição", { topo: true, barra: "descrição" })}
  </div>
</section>

<section data-label="Como funciona" data-screen-label="05 Como funciona" data-speaker-notes="Três passos e o combinado do prazo. Deixe claro que ele não precisa da plataforma pra contratar isto: é serviço avulso, pagamento único." style="background:var(--paper);color:var(--ink);font-family:var(--font-sans);padding:88px 112px 80px;display:flex;flex-direction:column">
  ${topo("Como funciona", "05", 44)}
  <div style="flex:1;display:flex;flex-direction:column;justify-content:center">
  <h2 style="margin:0 0 20px;font-size:58px;line-height:1.05;letter-spacing:-0.025em;font-weight:700;max-width:1400px;text-wrap:balance">Você manda os códigos. <span style="color:var(--brand)">A gente devolve os anúncios no ar.</span></h2>
  <p style="margin:0 0 64px;font-size:27px;line-height:1.45;color:var(--ink-muted);max-width:1250px;text-wrap:pretty">Serviço avulso: não precisa contratar a plataforma, não tem mensalidade. Você paga uma vez pelos anúncios criados.</p>
  <div style="position:relative;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:40px">
    <div style="position:absolute;left:36px;right:36px;top:35px;height:1px;background:var(--line)"></div>
    <div style="position:relative;display:flex;flex-direction:column;gap:16px">
      <div style="width:72px;height:72px;border-radius:999px;background:var(--ink);color:#FFFFFF;display:flex;align-items:center;justify-content:center;font-family:var(--font-mono);font-weight:600;font-size:28px;border:8px solid var(--paper)">1</div>
      <div style="font-size:24px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:var(--ink-faint)">Você</div>
      <div style="font-size:34px;font-weight:600;letter-spacing:-0.015em;line-height:1.2">Manda a lista de códigos</div>
      <div style="font-size:25px;color:var(--ink-muted);line-height:1.45">Uma planilha com os códigos OEM das peças que você quer anunciar. Só isso.</div>
    </div>
    <div style="position:relative;display:flex;flex-direction:column;gap:16px">
      <div style="width:72px;height:72px;border-radius:999px;background:var(--ink);color:#FFFFFF;display:flex;align-items:center;justify-content:center;font-family:var(--font-mono);font-weight:600;font-size:28px;border:8px solid var(--paper)">2</div>
      <div style="font-size:24px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:var(--ink-faint)">Nosso time</div>
      <div style="font-size:34px;font-weight:600;letter-spacing:-0.015em;line-height:1.2">Cria anúncio por anúncio</div>
      <div style="font-size:25px;color:var(--ink-muted);line-height:1.45">Título, compatibilidade, fotos tratadas e descrição. O padrão que você viu, em cada um.</div>
    </div>
    <div style="position:relative;display:flex;flex-direction:column;gap:16px">
      <div style="width:72px;height:72px;border-radius:999px;background:var(--brand-soft);color:var(--brand);border:8px solid var(--paper);box-shadow:inset 0 0 0 1px var(--brand);display:flex;align-items:center;justify-content:center;font-family:var(--font-mono);font-weight:600;font-size:28px">3</div>
      <div style="font-size:24px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:var(--ink-faint)">Na sua conta</div>
      <div style="font-size:34px;font-weight:600;letter-spacing:-0.015em;line-height:1.2">Publicados e prontos</div>
      <div style="font-size:25px;color:var(--ink-muted);line-height:1.45">Os anúncios sobem na sua conta, revisados. Você confere e começa a vender.</div>
    </div>
  </div>
  </div>
</section>

<section data-label="Investimento" data-screen-label="06 Investimento" data-speaker-notes="Diga o preço por anúncio, deixe o total na tela e fique quieto. Pagamento único, sem mensalidade." data-theme="dark" style="background:var(--paper);color:var(--ink);font-family:var(--font-sans);padding:88px 112px 80px;display:flex;flex-direction:column">
  ${topo("Investimento", "06", 44)}
  <div style="flex:1;display:grid;grid-template-columns:minmax(0,1fr) minmax(0,0.9fr);gap:72px;align-items:center">
    <div style="min-width:0">
      <h2 style="margin:0 0 28px;font-size:60px;line-height:1.04;letter-spacing:-0.03em;font-weight:700;text-wrap:balance">Você paga por anúncio criado. <span style="color:var(--brand)">Uma vez só.</span></h2>
      <div style="display:flex;flex-direction:column;gap:18px;border-top:1px solid var(--line);padding-top:28px">
        <div style="display:flex;align-items:baseline;justify-content:space-between;gap:24px;font-size:28px;color:var(--ink-muted)"><span>Anúncios criados</span><b style="font-size:34px;font-weight:700;color:var(--ink);font-variant-numeric:tabular-nums"><span data-f="qtdFmt"></span></b></div>
        <div style="display:flex;align-items:baseline;justify-content:space-between;gap:24px;font-size:28px;color:var(--ink-muted)"><span>Valor por anúncio</span><b style="font-size:34px;font-weight:700;color:var(--ink);font-variant-numeric:tabular-nums">R$ <span data-f="valorFmt"></span></b></div>
        <div style="display:flex;align-items:baseline;justify-content:space-between;gap:24px;font-size:28px;color:var(--ink-muted);border-top:1px solid var(--line-faint);padding-top:18px"><span>Forma de pagamento</span><b style="font-size:30px;font-weight:600;color:var(--ink)">Pagamento único</b></div>
      </div>
      <p style="margin:32px 0 0;font-size:25px;line-height:1.45;color:var(--ink-faint);text-wrap:pretty">Sem mensalidade e sem fidelidade. Precisou de mais anúncios depois, é só somar ao lote seguinte.</p>
    </div>
    <div style="min-width:0;background:var(--paper-card);border:1px solid var(--line);border-radius:12px;box-shadow:var(--shadow-card);padding:56px 48px;display:flex;flex-direction:column;gap:18px;align-items:flex-start">
      <div style="font-size:24px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:var(--ink-faint)">Total</div>
      <div style="display:flex;align-items:baseline;gap:14px">
        <span style="font-size:52px;font-weight:600;color:var(--ink-muted)">R$</span>
        <span style="font-size:150px;font-weight:700;letter-spacing:-0.05em;line-height:0.86;font-variant-numeric:tabular-nums" data-f="totalFmt"></span>
      </div>
      <div style="font-size:30px;color:var(--ink-muted);line-height:1.35"><span data-f="qtdFmt"></span> anúncios × R$ <span data-f="valorFmt"></span> cada</div>
    </div>
  </div>
</section>

<section data-label="Encerramento" data-screen-label="07 Encerramento" data-speaker-notes="Repita a quantidade, o valor e combine o próximo passo ainda na call: a lista de códigos e a data de entrega." style="background:var(--paper);color:var(--ink);font-family:var(--font-sans);padding:96px 112px 88px;display:flex;flex-direction:column;justify-content:space-between">
  <div style="display:flex;align-items:center;gap:18px">${LOGO}<span style="font-size:32px;font-weight:700;letter-spacing:-0.02em">LeverAds</span></div>
  <div style="display:flex;flex-direction:column;gap:28px">
    <div style="font-size:24px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:var(--ink-faint)">Criação de anúncios · <span data-f="f.empresa"></span></div>
    <div style="font-size:64px;font-weight:700;letter-spacing:-0.03em;line-height:1.05"><span data-f="qtdFmt"></span> anúncios criados do zero</div>
    <div style="font-size:44px;font-weight:600;letter-spacing:-0.02em;color:var(--ink-muted);font-variant-numeric:tabular-nums">R$ <span data-f="totalFmt"></span> <span style="color:var(--brand)">em pagamento único</span></div>
  </div>
  <div style="display:flex;align-items:center;justify-content:space-between;gap:24px;padding-top:28px;border-top:1px solid var(--line);font-size:24px;color:var(--ink-faint)">
    <span class="accept-wrap" data-client-only hidden><button type="button" class="accept-btn" data-act="aceitar">Quero começar</button></span>
    <span>Condições válidas apenas no dia da apresentação</span>
    <span style="font-family:var(--font-mono);font-variant-numeric:tabular-nums"><span data-f="hoje"></span></span>
  </div>
</section>
`;

// ── A conta ────────────────────────────────────────────────────────────────
// Duas entradas, uma multiplicação. Como no deck oficial, é UMA função: roda no
// servidor (link congelado do cliente) e vai injetada no script da tela zero por
// toString(), pra o número do closer e o do cliente nunca divergirem. Sem crase
// aqui: ela é serializada dentro do template literal da página.
export function calcOem(st) {
  var qtd = Math.max(0, Math.round(Number(st && st.qtd) || 0));
  var valor = Math.max(0, Number(st && st.valor) || 0);
  var total = qtd * valor;
  // Centavos só aparecem quando existem: "R$ 25" é mais limpo que "R$ 25,00" na
  // frente do cliente, e "R$ 24,90" não pode virar "R$ 25".
  var fmt = function (n) {
    var v = Number(n) || 0;
    var casas = Math.round(v * 100) % 100 === 0 ? 0 : 2;
    return v.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: 2 });
  };
  return {
    qtd: qtd,
    valor: valor,
    total: total,
    configurado: qtd > 0 && valor > 0,
    // Colchete enquanto não configurou: o closer vê na tela o que falta e o
    // cliente nunca recebe um número inventado (o link só sai configurado).
    qtdFmt: qtd ? fmt(qtd) : "[quantidade]",
    valorFmt: valor ? fmt(valor) : "[valor]",
    totalFmt: total ? fmt(total) : "[total]",
  };
}

// Configuração da apresentação (state.deckOem). Nasce do lead; os dois números
// nascem VAZIOS de propósito (decisão do Leo em 28/09): quantidade e preço são
// combinados na call, não têm padrão de catálogo.
export function deckOemConfig(p) {
  const s = (p && p.state && p.state.deckOem) || {};
  const lead = (p && p.data && p.data.lead) || {};
  const qtd = Math.max(0, Math.round(Number(s.qtd) || 0));
  // Valor por anúncio aceita centavos, com o teto pra não gravar lixo.
  const valor = Math.min(1_000_000, Math.max(0, Math.round((Number(s.valor) || 0) * 100) / 100));
  return {
    nome: String(s.nome || lead.firstName || lead.name || "").slice(0, 60),
    empresa: String(s.empresa || lead.company || "").slice(0, 80),
    qtd: Math.min(1_000_000, qtd),
    valor,
  };
}

// Tela zero: só existe no modo closer (?k=…). Dois cartões — o cliente e o
// lote — e o total já somado do lado, que é o número que ele vai falar.
function cfgScreen(configOnly = false) {
  return `<section data-cfg-screen data-label="Configurar" data-speaker-notes="Tela de preparo: confirme o cliente, a quantidade de anúncios e o valor de cada um. O deck inteiro sai daqui." style="background:var(--paper);color:var(--ink);font-family:var(--font-sans);display:flex;align-items:center;justify-content:center">
  <div style="zoom:1.7;width:1000px;padding:0 40px;display:flex;flex-direction:column;gap:22px">
    <div style="display:flex;align-items:flex-end;justify-content:space-between;gap:20px;padding-bottom:16px;border-bottom:1px solid var(--line)">
      <div>
        <div class="cfg-kicker" style="margin-bottom:6px">Configurar apresentação</div>
        <div style="font-size:26px;font-weight:700;letter-spacing:-0.02em">Quantos anúncios e por quanto</div>
      </div>
      <div style="display:flex;align-items:center;gap:12px">
        <span class="cfg-salvo" data-salvo></span>
        <button type="button" class="cfg-btn" data-act="capa">Começar apresentação</button>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr) 260px;gap:20px;align-items:start">
      <div class="cfg-card cfg-client">
        <div class="cfg-kicker">Cliente</div>
        <label style="display:flex;flex-direction:column;gap:5px;font-size:12.5px;color:var(--ink-muted)"><span>Nome</span>
          <input class="cfg-input" data-cfg="nome"></label>
        <label style="display:flex;flex-direction:column;gap:5px;font-size:12.5px;color:var(--ink-muted)"><span>Empresa</span>
          <input class="cfg-input" data-cfg="empresa"></label>
      </div>
      <div class="cfg-card">
        <div class="cfg-kicker">Lote de anúncios</div>
        <label style="display:flex;flex-direction:column;gap:5px;font-size:12.5px;color:var(--ink-muted)"><span>Quantidade de anúncios</span>
          <input class="cfg-input" type="number" min="0" step="1" placeholder="na call" data-cfg="qtd"></label>
        <label style="display:flex;flex-direction:column;gap:5px;font-size:12.5px;color:var(--ink-muted)"><span>Valor por anúncio (R$)</span>
          <input class="cfg-input" type="number" min="0" step="0.01" placeholder="na call" data-cfg="valor"></label>
        <div style="font-size:12.5px;color:var(--ink-muted);line-height:1.5">Enquanto estiver em branco, o deck mostra [quantidade] e [valor]. Nenhum número inventado entra na apresentação.</div>
      </div>
      <div class="cfg-value" style="background:var(--ink);color:var(--btn-primary-text);border-radius:12px;padding:20px;display:flex;flex-direction:column;gap:6px">
        <div style="font-size:12.5px;opacity:0.7">Total, pagamento único</div>
        <div style="font-size:30px;font-weight:700;letter-spacing:-0.02em;line-height:1;font-variant-numeric:tabular-nums">R$ <span data-f="totalFmt"></span></div>
        <div style="font-size:12.5px;opacity:0.7"><span data-f="qtdFmt"></span> × R$ <span data-f="valorFmt"></span></div>
        ${configOnly ? '<a class="cfg-present" target="_blank" rel="noopener noreferrer">Apresentar ↗</a>' : ""}
      </div>
    </div>
  </div>
</section>`;
}

export function proposalOemPageHtml(p, { editable = false, previewBanner = false, configOnly = false } = {}) {
  // Só o closer configura: embutido no link do cliente não existe.
  configOnly = !!editable && !!configOnly;
  const cfg = deckOemConfig(p);
  // Link do CLIENTE: a oferta vai congelada no snapshot (shareProposalOffer) —
  // reconfigurar depois do envio não pode mudar o número que ele já viu.
  const oferta = (!editable && p.state && p.state.deckOemOferta) ? p.state.deckOemOferta : calcOem(cfg);
  const titulo = escHtml(p.name || "Proposta");
  const dados = {
    id: p.id,
    editable: !!editable,
    configOnly,
    salvavel: !!editable && p.id !== "preview",
    aceito: !!p.accepted,
    cfg,
    oferta,
    hoje: new Date().toLocaleDateString("pt-BR"),
  };
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${titulo}</title>
<meta name="robots" content="noindex,nofollow">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<style>${DECK_CSS}${OEM_CSS}${configOnly ? CFG_ONLY_CSS : ""}</style>
</head>
<body>
${previewBanner ? '<div class="fita">Pré-visualização do template · nada aqui é salvo</div>' : ""}
<div class="stage">
  <div class="canvas" id="canvas">${editable ? cfgScreen(configOnly) : ""}${SLIDES}</div>
</div>
<div class="hud" id="hud">
  <button type="button" data-act="prev" aria-label="Slide anterior">‹</button>
  <span class="num"><span id="hud-i">1</span> / <span id="hud-n">1</span></span>
  <button type="button" data-act="next" aria-label="Próximo slide">›</button>
  <span class="dica" id="hud-dica">setas pra navegar${editable ? " · N pra ver as notas" : ""}</span>
</div>
${editable ? '<div class="notas" id="notas"><b>Notas do apresentador</b><span id="notas-txt"></span></div>' : ""}
<script>
(function () {
  var D = ${escJson(dados)};
  var calcOem = ${calcOem.toString()};
  var cfg = D.cfg;
  var canvas = document.getElementById("canvas");
  var todos = [].slice.call(canvas.children);

  // Embutido no cockpit: o "Apresentar" abre a MESMA proposta sem o embed, e a
  // altura do iframe acompanha a tela zero (o card do lead não tem scroll
  // próprio).
  var presentLink = document.querySelector(".cfg-present");
  if (presentLink) {
    var presentationUrl = new URL(window.location.href);
    presentationUrl.searchParams.delete("embed");
    presentLink.href = presentationUrl.href;
  }
  if (D.configOnly && window.parent !== window) {
    var configScreen = document.querySelector("[data-cfg-screen]");
    var parentOrigin = "";
    try { parentOrigin = new URL(document.referrer).origin; } catch (_) {}
    if (parentOrigin && configScreen) new ResizeObserver(function () {
      window.parent.postMessage({ type: "cockpit:proposal-config-height", height: configScreen.scrollHeight + 2 }, parentOrigin);
    }).observe(configScreen);
  }

  // ── Os números do deck ────────────────────────────────────────────────
  // No modo closer a conta é ao vivo (tela zero); no link do cliente ela já
  // veio congelada do servidor.
  function oferta() { return D.editable ? calcOem(cfg) : D.oferta; }
  function pintar() {
    var o = oferta();
    var vals = {
      "f.nome": cfg.nome, "f.empresa": cfg.empresa || "sua operação",
      hoje: D.hoje, qtdFmt: o.qtdFmt, valorFmt: o.valorFmt, totalFmt: o.totalFmt
    };
    [].forEach.call(document.querySelectorAll("[data-f]"), function (el) {
      var v = vals[el.getAttribute("data-f")];
      el.textContent = v == null ? "" : String(v);
    });
  }

  // Print que não carregou vira espaço reservado escrito: no meio de uma call,
  // um ícone de imagem quebrada custa mais caro que a foto vale.
  function printVazio(img) {
    var vazio = document.createElement("div");
    vazio.className = "print-vazio";
    vazio.textContent = "[" + (img.getAttribute("data-print") || "print") + "]";
    if (img.parentNode) img.parentNode.replaceChild(vazio, img);
  }
  [].forEach.call(document.querySelectorAll("[data-print]"), function (img) {
    img.addEventListener("error", function () { printVazio(img); });
    // O script roda no fim do body: a imagem que faltava já falhou ANTES do
    // listener existir (era o print quebrado no primeiro slide de cada fileira).
    if (img.complete && !img.naturalWidth) printVazio(img);
  });

  // ── Palco ─────────────────────────────────────────────────────────────
  var atual = 0, vis = [];
  function recontar() {
    vis = todos.filter(function (s) { return !s.hidden; });
    if (atual >= vis.length) atual = Math.max(0, vis.length - 1);
    mostrar(atual, "recount");
  }
  function fit() {
    if (D.configOnly) return;
    var w = window.innerWidth, h = window.innerHeight;
    var k = Math.min(w / 1920, h / 1080);
    canvas.style.transform = "scale(" + k + ")";
    canvas.style.left = Math.round((w - 1920 * k) / 2) + "px";
    canvas.style.top = Math.round((h - 1080 * k) / 2) + "px";
  }
  function mostrar(i, motivo) {
    if (D.configOnly) i = 0;
    if (!vis.length) return;
    atual = Math.max(0, Math.min(vis.length - 1, i));
    todos.forEach(function (s) { s.removeAttribute("data-deck-active"); });
    var s = vis[atual];
    s.setAttribute("data-deck-active", "");
    document.getElementById("hud-i").textContent = String(atual + 1);
    document.getElementById("hud-n").textContent = String(vis.length);
    var nt = document.getElementById("notas-txt");
    if (nt) nt.textContent = s.getAttribute("data-speaker-notes") || "sem notas neste slide";
    if (motivo !== "recount") hudAcordar();
  }
  function ir(d) { mostrar(atual + d, "nav"); }
  window.deckGoTo = function (i) { mostrar(i, "api"); };

  var hud = document.getElementById("hud"), hudT = null;
  function hudAcordar() {
    hud.setAttribute("data-on", "");
    clearTimeout(hudT);
    hudT = setTimeout(function () { hud.removeAttribute("data-on"); }, 1800);
  }
  window.addEventListener("mousemove", hudAcordar);
  hud.addEventListener("mouseenter", function () { clearTimeout(hudT); });
  hud.addEventListener("mouseleave", hudAcordar);

  document.addEventListener("keydown", function (e) {
    if (D.configOnly) return;
    if (/^(INPUT|SELECT|TEXTAREA)$/.test((e.target && e.target.tagName) || "")) return;
    var k = e.key;
    if (k === "ArrowRight" || k === "ArrowDown" || k === "PageDown" || k === " ") { e.preventDefault(); ir(1); }
    else if (k === "ArrowLeft" || k === "ArrowUp" || k === "PageUp") { e.preventDefault(); ir(-1); }
    else if (k === "Home") { e.preventDefault(); mostrar(0, "nav"); }
    else if (k === "End") { e.preventDefault(); mostrar(vis.length - 1, "nav"); }
    else if (/^[0-9]$/.test(k)) { mostrar(Number(k) === 0 ? 9 : Number(k) - 1, "nav"); }
    else if (k === "r" || k === "R") { mostrar(0, "nav"); }
    else if (k === "n" || k === "N") {
      var n = document.getElementById("notas");
      if (n) { if (n.hasAttribute("data-on")) n.removeAttribute("data-on"); else n.setAttribute("data-on", ""); }
    }
  });
  // Toque: metade esquerda volta, metade direita avança.
  canvas.addEventListener("click", function (e) {
    if (D.configOnly) return;
    if (e.target.closest('a[href], button, input, select, textarea, label, [data-act]')) return;
    if (!window.matchMedia("(hover: none)").matches) return;
    ir(e.clientX < window.innerWidth / 2 ? -1 : 1);
  });
  document.addEventListener("click", function (e) {
    var b = e.target.closest("[data-act]");
    if (!b) return;
    var a = b.getAttribute("data-act");
    if (a === "prev") ir(-1);
    else if (a === "next") ir(1);
    else if (a === "capa") mostrar(D.editable ? 1 : 0, "api");
    else if (a === "aceitar") aceitar(b);
  });
  window.addEventListener("resize", fit);

  // ── Aceite (só no link do cliente) ────────────────────────────────────
  function aceitar(btn) {
    btn.disabled = true;
    fetch("/public/proposals/" + encodeURIComponent(D.id) + "/accept", { method: "POST" })
      .then(function (r) { if (!r.ok) throw new Error("falha"); marcarAceito(); })
      .catch(function () { btn.disabled = false; btn.textContent = "tente de novo"; });
  }
  function marcarAceito() {
    var w = document.querySelector(".accept-wrap");
    if (w) w.innerHTML = '<span class="accept-ok">✓ Proposta aceita, vamos te chamar</span>';
  }
  if (!D.editable) {
    [].forEach.call(document.querySelectorAll("[data-client-only]"), function (el) { el.hidden = false; });
    if (D.aceito) marcarAceito();
  }

  // ── Tela zero ─────────────────────────────────────────────────────────
  if (D.editable) {
    var salvoEl = document.querySelector("[data-salvo]");
    var salvarT = null;
    function salvar() {
      if (!D.salvavel) { if (salvoEl) salvoEl.textContent = "pré-visualização, nada é salvo"; return; }
      clearTimeout(salvarT);
      if (salvoEl) salvoEl.textContent = "salvando…";
      salvarT = setTimeout(function () {
        fetch("/public/proposals/" + encodeURIComponent(D.id), {
          method: "PATCH", headers: { "content-type": "application/json" },
          body: JSON.stringify({ k: new URLSearchParams(location.search).get("k"), deckOem: cfg })
        }).then(function (r) {
          if (salvoEl) salvoEl.textContent = r.ok ? "salvo" : "não salvou, tente de novo";
        }).catch(function () { if (salvoEl) salvoEl.textContent = "não salvou, tente de novo"; });
      }, 600);
    }
    function pintarCfg() {
      [].forEach.call(document.querySelectorAll("[data-cfg]"), function (el) {
        var k = el.getAttribute("data-cfg");
        // Campo numérico em branco continua em branco: escrever 0 no input
        // apagaria o placeholder "na call" no primeiro pintar.
        if (el.type === "number") el.value = cfg[k] ? String(cfg[k]) : "";
        else el.value = cfg[k];
      });
    }
    document.addEventListener("input", function (e) {
      var el = e.target.closest("[data-cfg]");
      if (!el) return;
      var k = el.getAttribute("data-cfg");
      cfg[k] = el.type === "number" ? (Number(el.value) || 0) : el.value;
      pintar(); salvar();
    });
    pintarCfg();
  }

  fit();
  pintar();
  recontar();
  mostrar(0, "init");
  hudAcordar();
})();
</script>
</body>
</html>`;
}
