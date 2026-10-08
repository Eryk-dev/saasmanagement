import React from "react";

// Markdown do Linear na aba do ticket. Não é um renderizador completo de
// propósito: é o subconjunto que aparece nas issues (cabeçalho, citação, lista,
// negrito, código, link e IMAGEM) e mais nada. O texto NUNCA entra por
// innerHTML — cada pedaço vira elemento React, então nada do que foi escrito na
// issue executa aqui.
//
// A parte que importa são as imagens: a descrição vinha com dez linhas de
// `![print](https://uploads.linear.app/…jwt gigante…)`, que é ilegível. Elas
// viram miniaturas clicáveis, agrupadas em galeria quando estão em sequência.
//
// As URLs de anexo do Linear são ASSINADAS e expiram em ~5 minutos. Por isso
// uma imagem que falha não vira ícone quebrado: vira um botão que pede a
// releitura da issue (que devolve URLs novas).

const { useState } = React;

const IMG_RE = /^!\[([^\]]*)\]\(([^)\s]+)\)\s*$/;
const HEAD_RE = /^(#{1,6})\s+(.*)$/;
const LIST_RE = /^\s*(?:[-*+]|\d{1,3}[.)])\s+(.*)$/;
const QUOTE_RE = /^\s*>\s?(.*)$/;
const RULE_RE = /^\s*(-{3,}|\*{3,}|_{3,})\s*$/;
// Seção recolhível: o `<details>` que agentes (o Hermes) escrevem e o
// `+++ título … +++` que o editor do Linear grava. O conteúdo é o apêndice
// técnico — aberto, ele soterrava a pergunta que vem antes.
const DETAILS_OPEN_RE = /^\s*<details[^>]*>\s*(.*)$/i;
const DETAILS_CLOSE_RE = /^(.*?)\s*<\/details>\s*$/i;
const SUMMARY_RE = /^\s*<summary[^>]*>(.*?)<\/summary>\s*(.*)$/i;
const FOLD_RE = /^\s*\+\+\+\s*(.*)$/;
// Só http(s) entra no DOM: `javascript:` e afins ficam como texto.
const safeUrl = (u) => (/^https?:\/\//i.test(String(u || "")) ? String(u) : "");

// Separa as linhas de uma seção recolhível: devolve título, miolo e onde parar.
function recolhivel(linhas, i) {
  const fold = FOLD_RE.exec(linhas[i]);
  if (fold && !DETAILS_OPEN_RE.test(linhas[i])) {
    let fim = i + 1;
    while (fim < linhas.length && !/^\s*\+\+\+\s*$/.test(linhas[fim])) fim++;
    return { titulo: fold[1].trim(), miolo: linhas.slice(i + 1, fim), proxima: fim + 1 };
  }
  const miolo = [];
  let resto = DETAILS_OPEN_RE.exec(linhas[i])[1];
  let titulo = "";
  let nivel = 1;
  let j = i;
  for (;;) {
    const summary = !titulo && SUMMARY_RE.exec(resto);
    if (summary) { titulo = summary[1].trim(); resto = summary[2]; }
    if (DETAILS_OPEN_RE.test(resto)) nivel++;
    const fecha = DETAILS_CLOSE_RE.exec(resto);
    if (fecha && --nivel === 0) { if (fecha[1].trim()) miolo.push(fecha[1]); break; }
    if (resto.trim() || miolo.length) miolo.push(resto);
    if (++j >= linhas.length) break;
    resto = linhas[j];
  }
  return { titulo, miolo, proxima: j + 1 };
}

// O apêndice técnico do Hermes chega em parágrafos corridos: rótulo, fluxo
// com ";" entre as etapas e frases que abrem outro assunto ("Sucesso: …",
// "Negativos: …") no meio da linha. Dentro do recolhível isso vira estrutura:
// cada frase rotulada ganha parágrafo próprio e uma enumeração de 3+ partes
// separadas por ";" vira lista sob o rótulo. Linhas que já são markdown
// (lista, título, citação, imagem) passam intactas.
const ROTULO_RE = /^(\p{Lu}[^:\n]{0,44}?):(?:\s+(.*))?$/u;
const rotuloOk = (r) => !/[,;.]\s|`|\*\*|→|\(/.test(r);
const FRASE_ROTULADA_RE = /(?<=[.)])\s+(?=\p{Lu}[\p{L}\d ]{1,28}:\s)/u;
function estruturar(linhas) {
  const saida = [];
  for (const linha of linhas) {
    if (!linha.trim() || /^\s*(?:[-*+>#!<]|\d{1,3}[.)]\s|\+\+\+)/.test(linha)) { saida.push(linha); continue; }
    for (const frase of linha.split(FRASE_ROTULADA_RE)) {
      const r = ROTULO_RE.exec(frase);
      const rotulo = r && rotuloOk(r[1]) ? r[1] : "";
      const partes = (rotulo ? r[2] || "" : frase).split(/;\s+/);
      if (partes.length >= 3) {
        if (rotulo) saida.push(`${rotulo}:`);
        for (const parte of partes) saida.push(`- ${parte}`);
      } else saida.push(frase);
      saida.push("");
    }
  }
  return saida;
}

// Texto → blocos. Puro e exportado: o smoke do web testa por aqui.
export function parseBlocks(text) {
  const linhas = String(text || "").replace(/\r\n/g, "\n").split("\n");
  const blocos = [];
  // Linha em branco separa PARÁGRAFO, mas não quebra uma galeria: o Linear
  // escreve um print por linha com uma linha vazia entre eles, e cada print
  // virando bloco próprio devolveria a poluição que a galeria veio resolver.
  const empurra = (b, branco) => {
    const ultimo = blocos[blocos.length - 1];
    if (b.tipo === "img" && ultimo?.tipo === "galeria") { ultimo.itens.push(b); return; }
    if (b.tipo === "img") { blocos.push({ tipo: "galeria", itens: [b] }); return; }
    if (b.tipo === "item" && ultimo?.tipo === "lista") { ultimo.itens.push(b.texto); return; }
    if (b.tipo === "item") { blocos.push({ tipo: "lista", itens: [b.texto] }); return; }
    if (!branco && b.tipo === "citacao" && ultimo?.tipo === "citacao") { ultimo.texto += `\n${b.texto}`; return; }
    if (!branco && b.tipo === "texto" && ultimo?.tipo === "texto") { ultimo.texto += `\n${b.texto}`; return; }
    blocos.push(b);
  };
  let vazia = false;
  for (let i = 0; i < linhas.length; i++) {
    const linha = linhas[i];
    if (!linha.trim()) { vazia = true; continue; }
    const separado = vazia; // houve linha em branco antes desta
    vazia = false;
    if (DETAILS_OPEN_RE.test(linha) || (FOLD_RE.test(linha) && FOLD_RE.exec(linha)[1].trim())) {
      const { titulo, miolo, proxima } = recolhivel(linhas, i);
      blocos.push({ tipo: "detalhes", titulo, blocos: parseBlocks(estruturar(miolo).join("\n")) });
      i = proxima - 1;
      continue;
    }
    const img = IMG_RE.exec(linha);
    if (img) {
      // Sem URL http(s) confiável a imagem não entra: sobra a legenda, que já
      // diz o que era — melhor do que despejar o markdown cru na tela.
      if (safeUrl(img[2])) empurra({ tipo: "img", alt: img[1], url: safeUrl(img[2]) }, separado);
      else empurra({ tipo: "texto", texto: img[1] || "(imagem)" }, separado);
      continue;
    }
    if (RULE_RE.test(linha)) { blocos.push({ tipo: "regua" }); continue; }
    const head = HEAD_RE.exec(linha);
    if (head) { blocos.push({ tipo: "titulo", nivel: head[1].length, texto: head[2] }); continue; }
    const quote = QUOTE_RE.exec(linha);
    if (quote) { empurra({ tipo: "citacao", texto: quote[1] }, separado); continue; }
    const item = LIST_RE.exec(linha);
    if (item) { empurra({ tipo: "item", texto: item[1] }, separado); continue; }
    empurra({ tipo: "texto", texto: linha }, separado);
  }
  return blocos;
}

// Negrito, código, link markdown, URL solta e referência de código (arquivo
// com linha, rota da API) — esta em fonte de código, que é o que separa
// "compat.py:349-519" do texto em volta. O resto sai como texto puro.
const LINHAS = String.raw`(?::\d+(?:-\d+)?)?(?:\/:\d+(?:-\d+)?)*`;
const REF = String.raw`(?:[\w.-]+\/)+[\w.-]*\w\.\w{1,5}${LINHAS}|\b[\w-]+\.(?:py|tsx?|jsx?|mjs|cjs|md|sql|json|ya?ml|css)${LINHAS}|\b(?:GET|POST|PUT|PATCH|DELETE) \/[\w/{}:.-]*\w`;
const REF_RE = new RegExp(`^(?:${REF})$`);
const INLINE_RE = new RegExp(String.raw`(\*\*[^*]+\*\*|__[^_]+__|` + "`[^`]+`" + String.raw`|\[[^\]]+\]\([^)\s]+\)|https?:\/\/\S+|${REF})`, "g");
// O Linear devolve `\_`, `\[`, `\*` escapados; na tela é só o caractere.
const unescape = (s) => s.replace(/\\([\\`*_{}[\]()#+\-.!<>|~])/g, "$1");
// `[Eryk] Pode anexar…`: quem precisa responder, no começo do pedido.
const DESTINO_RE = /^\\?\[([^\]\\]{1,40})\\?\]\s+(?!\()/;
export function Inline({ text, rotulo = true }) {
  // Checklist do Linear: `- [ ] item` / `- [x] item`.
  const check = /^\[([ xX])\]\s+/.exec(String(text || ""));
  if (check) {
    const on = check[1] !== " ";
    return <><span className="linear-md-check" data-on={on ? "1" : "0"} role="img" aria-label={on ? "feito" : "a fazer"}>{on ? "✓" : ""}</span><Inline text={String(text).slice(check[0].length)} /></>;
  }
  const destino = DESTINO_RE.exec(String(text || ""));
  if (destino) return <><b>{destino[1]}</b>{" · "}<Inline text={String(text).slice(destino[0].length)} /></>;
  // "Hipóteses testáveis: …" — o rótulo do começo da linha sai em negrito.
  const r = rotulo && ROTULO_RE.exec(String(text || ""));
  if (r && rotuloOk(r[1])) return <><b>{`${unescape(r[1])}:`}</b>{r[2] ? <>{" "}<Inline text={r[2]} rotulo={false} /></> : null}</>;
  const partes = String(text || "").split(INLINE_RE).filter((p) => p !== "" && p !== undefined);
  return partes.map((p, i) => {
    if (/^\*\*[^*]+\*\*$/.test(p) || /^__[^_]+__$/.test(p)) return <b key={i}>{unescape(p.slice(2, -2))}</b>;
    if (/^`[^`]+`$/.test(p)) return <code key={i} className="mono" style={{ fontSize: "0.92em", background: "var(--bg-inset)", padding: "1px 4px", borderRadius: 4 }}>{p.slice(1, -1)}</code>;
    const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(p);
    if (link && safeUrl(link[2])) return <a key={i} href={safeUrl(link[2])} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)" }}>{link[1]}</a>;
    if (REF_RE.test(p)) return <code key={i} className="mono linear-md-ref">{p}</code>;
    if (/^https?:\/\/\S+$/.test(p)) {
      // URL solta: o rótulo é o domínio (as do Linear têm 600 caracteres de JWT).
      let rotulo = p;
      try { rotulo = new URL(p).hostname.replace(/^www\./, ""); } catch { /* fica a URL */ }
      // Texto num nó só: `{rotulo} ↗` sairia partido por um comentário do React.
      return <a key={i} href={p} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)" }} title={p}>{`${rotulo} ↗`}</a>;
    }
    return <React.Fragment key={i}>{unescape(p)}</React.Fragment>;
  });
}

function Figura({ item, onExpired }) {
  const [quebrou, setQuebrou] = useState(false);
  if (quebrou) {
    return (
      <button type="button" onClick={onExpired} title={item.alt}
        style={{ width: 132, height: 96, borderRadius: "var(--r-2)", border: "1px dashed var(--line-strong)", background: "var(--bg-inset)", color: "var(--fg-3)", fontSize: 11, padding: 6, textAlign: "center" }}>
        imagem expirada<br />recarregar
      </button>
    );
  }
  return (
    <figure style={{ margin: 0, width: 132 }}>
      <a href={item.url} target="_blank" rel="noopener noreferrer" title={item.alt || "abrir imagem"}>
        <img src={item.url} alt={item.alt || "print da issue"} loading="lazy" onError={() => setQuebrou(true)}
          style={{ width: 132, height: 96, objectFit: "cover", borderRadius: "var(--r-2)", border: "1px solid var(--line-1)", display: "block", background: "var(--bg-inset)" }} />
      </a>
      {item.alt && <figcaption className="dim" style={{ fontSize: 10.5, lineHeight: 1.3, marginTop: 3, whiteSpace: "normal" }}>{item.alt}</figcaption>}
    </figure>
  );
}

// Tamanho do que aparece sem abrir nada: decide se o comentário entra
// recolhido. Contar o apêndice dentro de <details> cortava a pergunta curta
// e, aberto o apêndice, prendia ele numa caixa de 200px.
const textoDe = (b) => b.texto || (b.itens || []).map((it) => it.alt ?? it).join("\n");
export const visibleLength = (text) =>
  parseBlocks(text).reduce((n, b) => n + (b.tipo === "detalhes" ? b.titulo.length : textoDe(b).length), 0);

export function LinearMarkdown({ text, onExpired }) {
  return <Blocos blocos={parseBlocks(text)} onExpired={onExpired} />;
}

function Blocos({ blocos, onExpired }) {
  if (!blocos.length) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, whiteSpace: "normal" }}>
      {blocos.map((b, i) => {
        if (b.tipo === "galeria") {
          return (
            <div key={i} style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {b.itens.map((item, j) => <Figura key={j} item={item} onExpired={onExpired} />)}
            </div>
          );
        }
        if (b.tipo === "titulo") {
          // ## vira faixa de seção; ### e abaixo, subtítulo em negrito.
          if (b.nivel <= 2) return <div key={i} className="linear-md-h" role="heading" aria-level={b.nivel + 2}><Inline text={b.texto} rotulo={false} /></div>;
          return <div key={i} style={{ fontWeight: 700, fontSize: 13, color: "var(--fg-1)", marginTop: i ? 4 : 0 }}><Inline text={b.texto} rotulo={false} /></div>;
        }
        if (b.tipo === "citacao") {
          return <div key={i} style={{ borderLeft: "2px solid var(--line-strong)", paddingLeft: 8, color: "var(--fg-3)", whiteSpace: "pre-wrap" }}><Inline text={b.texto} /></div>;
        }
        if (b.tipo === "lista") {
          // Checklist (`- [ ]`): a caixinha já é o marcador, sem bolinha junto.
          const checklist = b.itens.every((it) => /^\[[ xX]\]\s/.test(it));
          return (
            <ul key={i} style={{ margin: 0, paddingLeft: checklist ? 0 : 18, listStyle: checklist ? "none" : undefined, display: "flex", flexDirection: "column", gap: 2 }}>
              {b.itens.map((it, j) => <li key={j}><Inline text={it} /></li>)}
            </ul>
          );
        }
        if (b.tipo === "detalhes") {
          return (
            <details key={i} className="linear-md-details">
              <summary><Inline text={b.titulo || "Detalhes técnicos"} /></summary>
              <Blocos blocos={b.blocos} onExpired={onExpired} />
            </details>
          );
        }
        if (b.tipo === "regua") return <hr key={i} style={{ border: 0, borderTop: "1px solid var(--line-1)", margin: "2px 0" }} />;
        // Linha a linha: o rótulo em negrito vale no começo de cada uma.
        return <div key={i} style={{ whiteSpace: "pre-wrap" }}>{b.texto.split("\n").map((l, j) => <React.Fragment key={j}>{j > 0 && "\n"}<Inline text={l} /></React.Fragment>)}</div>;
      })}
    </div>
  );
}
