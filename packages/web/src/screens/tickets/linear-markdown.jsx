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
const LIST_RE = /^\s*[-*+]\s+(.*)$/;
const QUOTE_RE = /^\s*>\s?(.*)$/;
const RULE_RE = /^\s*(-{3,}|\*{3,}|_{3,})\s*$/;
// Só http(s) entra no DOM: `javascript:` e afins ficam como texto.
const safeUrl = (u) => (/^https?:\/\//i.test(String(u || "")) ? String(u) : "");

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
  for (const linha of linhas) {
    if (!linha.trim()) { vazia = true; continue; }
    const separado = vazia; // houve linha em branco antes desta
    vazia = false;
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

// Negrito, código, link markdown e URL solta. O resto sai como texto puro.
const INLINE_RE = /(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|\[[^\]]+\]\([^)\s]+\)|https?:\/\/\S+)/g;
export function Inline({ text }) {
  const partes = String(text || "").split(INLINE_RE).filter((p) => p !== "" && p !== undefined);
  return partes.map((p, i) => {
    if (/^\*\*[^*]+\*\*$/.test(p) || /^__[^_]+__$/.test(p)) return <b key={i}>{p.slice(2, -2)}</b>;
    if (/^`[^`]+`$/.test(p)) return <code key={i} className="mono" style={{ fontSize: "0.92em", background: "var(--bg-inset)", padding: "1px 4px", borderRadius: 4 }}>{p.slice(1, -1)}</code>;
    const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(p);
    if (link && safeUrl(link[2])) return <a key={i} href={safeUrl(link[2])} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)" }}>{link[1]}</a>;
    if (/^https?:\/\/\S+$/.test(p)) {
      // URL solta: o rótulo é o domínio (as do Linear têm 600 caracteres de JWT).
      let rotulo = p;
      try { rotulo = new URL(p).hostname.replace(/^www\./, ""); } catch { /* fica a URL */ }
      // Texto num nó só: `{rotulo} ↗` sairia partido por um comentário do React.
      return <a key={i} href={p} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)" }} title={p}>{`${rotulo} ↗`}</a>;
    }
    return <React.Fragment key={i}>{p}</React.Fragment>;
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

export function LinearMarkdown({ text, onExpired }) {
  const blocos = parseBlocks(text);
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
          return <div key={i} style={{ fontWeight: 700, fontSize: b.nivel <= 2 ? 13.5 : 13, color: "var(--fg-1)", marginTop: i ? 4 : 0 }}><Inline text={b.texto} /></div>;
        }
        if (b.tipo === "citacao") {
          return <div key={i} style={{ borderLeft: "2px solid var(--line-strong)", paddingLeft: 8, color: "var(--fg-3)", whiteSpace: "pre-wrap" }}><Inline text={b.texto} /></div>;
        }
        if (b.tipo === "lista") {
          return (
            <ul key={i} style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 2 }}>
              {b.itens.map((it, j) => <li key={j}><Inline text={it} /></li>)}
            </ul>
          );
        }
        if (b.tipo === "regua") return <hr key={i} style={{ border: 0, borderTop: "1px solid var(--line-1)", margin: "2px 0" }} />;
        return <div key={i} style={{ whiteSpace: "pre-wrap" }}><Inline text={b.texto} /></div>;
      })}
    </div>
  );
}
