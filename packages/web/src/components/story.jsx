import React from "react";

// As peças que o redesenho de 14/09/2026 repete em quase toda tela, escritas
// uma vez só. Antes cada tela desenhava a sua: o aviso do topo existia inline
// em today, tasks, integrations, agenda, offers e finance-hub com bordas e
// tons diferentes; a corrente do dinheiro vivia em offers e finance-hub; o
// funil de conversão em proposals; a barra de composição em offers (e um
// SplitBar órfão em social-metrics que ninguém importava); o ⓘ era um <span
// title> copiado em oito telas.
//
// Duas réguas do handoff moram DENTRO das peças, pra não precisarem ser
// lembradas tela a tela:
//   1. as fatias da BarraComposicao somam o total (o dev vê o aviso no console
//      quando não somam) e nenhum rótulo de fatia repete o rótulo de um KPI
//      que mede outra grandeza;
//   2. o texto do ⓘ sai em --fg-3 (5,19:1). Só o glifo fica em --fg-4, porque
//      o ⓘ virou o único lugar de métricas que antes eram KPI de 26px.

const CARD = {
  background: "var(--bg-1)",
  border: "1px solid var(--line-1)",
  borderRadius: "var(--r-4)",
  boxShadow: "var(--shadow-card)",
};

const TOM = {
  neg: "var(--neg)",
  warn: "var(--warn)",
  info: "var(--info)",
  pos: "var(--pos)",
  neutro: "var(--fg-1)",
};

const corDe = (tom) => TOM[tom] || TOM.neutro;

// ── Aviso com prazo, com a ação ao lado ────────────────────────────────────
// Regra 1 do handoff: nenhuma tela abre com fileira de número solto. Abre com
// o que tem prazo e o botão que resolve, do lado.
//
// Uma cor forte por linha: o ponto e o TÍTULO tomam a cor do aviso; a nota
// fica em --fg-2 e o botão fica neutro. A variante "barra" (Visão geral) troca
// o ponto por uma faixa vertical de 4px e usa o botão escuro, que é o desenho
// da pilha de avisos daquela tela.
export function AvisoTopo({ tom = "neg", titulo, nota, fim, acao, variante = "ponto", style }) {
  const cor = corDe(tom);
  const escuro = variante === "barra";
  const btn = {
    height: 30,
    padding: "0 14px",
    borderRadius: "var(--r-2)",
    fontSize: 12.5,
    fontWeight: 600,
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    textDecoration: "none",
    whiteSpace: "nowrap",
    border: escuro ? "1px solid var(--btn-bg)" : "1px solid var(--line-1)",
    background: escuro ? "var(--btn-bg)" : "var(--bg-1)",
    color: escuro ? "var(--btn-fg)" : "var(--fg-2)",
  };
  return (
    <section style={{ ...CARD, padding: "13px 18px", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", ...style }}>
      {escuro
        ? <span style={{ width: 4, alignSelf: "stretch", minHeight: 26, borderRadius: 999, background: cor, flexShrink: 0 }} />
        : <span style={{ width: 8, height: 8, borderRadius: 999, background: cor, flexShrink: 0 }} />}
      <span style={{ flex: 1, minWidth: 220, fontSize: 13.5, fontWeight: 650, color: cor, textWrap: "pretty" }}>{titulo}</span>
      {nota != null && nota !== "" && (
        <span style={{ fontSize: 12.5, color: "var(--fg-2)", minWidth: 0, textWrap: "pretty" }}>{nota}</span>
      )}
      {fim}
      {acao && (acao.href
        ? <a href={acao.href} title={acao.title} style={{ ...btn, marginLeft: "auto" }}>{acao.label}</a>
        : <button onClick={acao.onClick} title={acao.title} disabled={acao.disabled} style={{ ...btn, marginLeft: "auto", opacity: acao.disabled ? 0.55 : 1 }}>{acao.label}</button>)}
    </section>
  );
}

// ── Corrente do dinheiro ───────────────────────────────────────────────────
// Passos de um mesmo processo, com a taxa de passagem na seta. É GRID, não
// flex: no flex-wrap o último passo caía sozinho na segunda linha, sem seta
// (crítica 1 da rodada 5 do handoff). A seta viaja DENTRO do passo, então
// quebrar a linha nunca separa um do outro.
//
// passos: [{ rotulo, valor, nota, tom, title, taxa, taxaNota }]
//   taxa/taxaNota descrevem a seta que ENTRA no passo (ignoradas no primeiro).
export function CorrenteDoDinheiro({ passos = [], tamanho = "md", fim, bare = false, style }) {
  const grande = tamanho === "lg";
  const vis = passos.filter(Boolean);
  if (!vis.length) return null;
  return (
    <section style={{ ...(bare ? null : CARD), padding: bare ? 0 : "20px var(--inset-x)", ...style }}>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fit, minmax(${grande ? 170 : 150}px, 1fr))`, gap: "14px 4px", alignItems: "start" }}>
        {vis.map((p, i) => (
          <div key={p.rotulo ?? i} style={{ display: "flex", alignItems: "flex-start", gap: 4, minWidth: 0 }}>
            {i > 0 && (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "0 8px", flexShrink: 0 }}>
                {p.taxa != null && <span className="tnum" style={{ fontSize: 11.5, fontWeight: 600, color: "var(--accent)" }}>{p.taxa}</span>}
                <span style={{ fontSize: 16, color: "var(--line-2)", lineHeight: 1 }}>→</span>
                {p.taxaNota && <span style={{ fontSize: 10.5, color: "var(--fg-4)", whiteSpace: "nowrap" }}>{p.taxaNota}</span>}
              </div>
            )}
            <div style={{ minWidth: 0 }} title={p.title}>
              <div style={{ fontSize: 12.5, color: "var(--fg-3)" }}>{p.rotulo}</div>
              <div className="tnum" style={{ fontFamily: "var(--display)", fontSize: grande ? 26 : 24, fontWeight: 700, letterSpacing: "-0.02em", marginTop: 2, color: corDe(p.tom) }}>{p.valor}</div>
              {p.nota && <div style={{ fontSize: 11.5, color: "var(--fg-4)", marginTop: 3, textWrap: "pretty" }}>{p.nota}</div>}
            </div>
          </div>
        ))}
      </div>
      {fim}
    </section>
  );
}

// ── Funil horizontal ───────────────────────────────────────────────────────
// Três ou mais números que são PASSOS do mesmo processo se desenham como
// funil, com a passagem de cada degrau à direita. A passagem fica vermelha
// abaixo do piso (45% no handoff), que é o sinal de onde o funil vaza.
//
// A cor de cada degrau sai da rampa --line-2 → --accent, distribuída pelo
// número de degraus, pro último passo (o que virou dinheiro) chegar no teal
// mesmo num funil de três.
export function FunilHorizontal({ degraus = [], piso = 45, bare = false, style }) {
  const vis = degraus.filter(Boolean);
  if (!vis.length) return null;
  const topo = Math.max(...vis.map((d) => Number(d.valor) || 0), 0);
  const n = vis.length;
  return (
    <section style={{ ...(bare ? null : CARD), padding: bare ? 0 : "18px var(--inset-x)", display: "flex", flexDirection: "column", gap: 10, ...style }}>
      {vis.map((d, i) => {
        const v = Number(d.valor) || 0;
        const largura = topo > 0 ? Math.max(4, Math.round((v / topo) * 100)) : 4;
        const mix = n > 1 ? Math.round((i / (n - 1)) * 100) : 100;
        const ant = i > 0 ? Number(vis[i - 1].valor) || 0 : 0;
        const passagem = i === 0 ? null : ant > 0 ? Math.round((v / ant) * 100) : 0;
        return (
          <div key={d.rotulo ?? i} style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }} title={d.title}>
            <span style={{ flex: "0 0 128px", fontSize: 12.5, color: "var(--fg-2)" }}>{d.rotulo}</span>
            <span style={{ flex: "1 1 160px", minWidth: 120, height: 22, borderRadius: "var(--r-1)", background: "var(--bg-0)", overflow: "hidden" }}>
              <span style={{ display: "block", height: 22, width: `${largura}%`, background: `color-mix(in srgb, var(--accent) ${mix}%, var(--line-2))` }} />
            </span>
            <span className="tnum" style={{ flex: "0 0 84px", textAlign: "right", fontSize: 14.5, fontWeight: 700 }}>{d.texto ?? window.fmt?.int?.(v) ?? v}</span>
            <span className="tnum" style={{ flex: "0 0 62px", textAlign: "right", fontSize: 12, fontWeight: 600, color: passagem != null && passagem < piso ? "var(--neg)" : "var(--fg-4)" }}>
              {passagem == null ? "—" : `${passagem}%`}
            </span>
            {d.nota && <span style={{ flex: "0 0 90px", fontSize: 11.5, color: "var(--fg-4)" }}>{d.nota}</span>}
          </div>
        );
      })}
    </section>
  );
}

// ── Barra de composição ────────────────────────────────────────────────────
// Part-to-whole com legenda. A régua do handoff tem DUAS partes, e foi por
// conferir só a primeira que Redes sociais passou mostrando "seguidores" numa
// barra que media alcance:
//   as fatias somam o total E nenhum rótulo de fatia repete o rótulo de um KPI
//   que mede outra grandeza.
// A soma é conferida aqui quando o chamador passa `total`; divergência vira
// aviso no console em vez de número errado em silêncio na tela.
export function BarraComposicao({ titulo, sub, fatias = [], total, fina = false, fim, bare = false, style }) {
  const vis = fatias.filter((f) => f && Number(f.valor) >= 0);
  const soma = vis.reduce((a, f) => a + (Number(f.valor) || 0), 0);
  const base = Number(total) > 0 ? Number(total) : soma;
  if (Number(total) > 0 && Math.abs(soma - total) > Math.max(1, total * 0.005)) {
    console.warn(`BarraComposicao "${titulo}": as fatias somam ${soma} e o total diz ${total} — a barra mente sobre a parte que falta.`);
  }
  const alt = fina ? 12 : 26;
  const pct = (v) => (base > 0 ? Math.max(1, Math.round(((Number(v) || 0) / base) * 100)) : 0);
  const fmtN = (v, f) => f.texto ?? window.fmt?.int?.(v) ?? v;
  return (
    <section style={{ ...(bare ? null : CARD), padding: bare ? 0 : "18px var(--inset-x)", ...style }}>
      {titulo && <div style={{ fontSize: 13, fontWeight: 650 }}>{titulo}</div>}
      {sub && <div style={{ fontSize: 12.5, color: "var(--fg-3)", marginTop: 2 }}>{sub}</div>}
      <div style={{ display: "flex", height: alt, borderRadius: fina ? 999 : 7, overflow: "hidden", marginTop: titulo || sub ? 12 : 0, background: "var(--bg-0)" }}>
        {vis.map((f) => (
          <span key={f.rotulo} title={`${f.rotulo} · ${fmtN(f.valor, f)} · ${pct(f.valor)}%`}
            style={{ display: "block", height: alt, width: `${pct(f.valor)}%`, background: f.cor || "var(--accent)" }} />
        ))}
      </div>
      <div style={{ display: "flex", gap: fina ? 16 : 18, marginTop: fina ? 8 : 12, flexWrap: "wrap", alignItems: "center" }}>
        {vis.map((f) => (
          <span key={f.rotulo} style={{ display: "inline-flex", alignItems: "center", gap: fina ? 6 : 7 }}>
            <span style={{ width: fina ? 6 : 9, height: fina ? 6 : 9, borderRadius: fina ? 999 : 3, background: f.cor || "var(--accent)", flexShrink: 0 }} />
            <span style={{ fontSize: fina ? 11.5 : 12.5, color: fina ? "var(--fg-3)" : "var(--fg-2)" }}>{f.rotulo}</span>
            {!fina && <span className="tnum" style={{ fontSize: 13, fontWeight: 700 }}>{fmtN(f.valor, f)}</span>}
            {!fina && <span className="tnum dim" style={{ fontSize: 11 }}>{pct(f.valor)}%</span>}
          </span>
        ))}
        {fim && <span style={{ marginLeft: "auto" }}>{fim}</span>}
      </div>
    </section>
  );
}

// ── O ⓘ, nos três formatos que o handoff usa ───────────────────────────────
// O texto NUNCA sai em --fg-4 (2,75:1 sobre papel). Só o glifo.

// Sufixo de rótulo: "Meta de contratos ⓘ".
export function Info({ texto, style }) {
  return <span title={texto} style={{ fontSize: 10.5, cursor: "help", marginLeft: 5, color: "var(--fg-4)", ...style }}>ⓘ</span>;
}

// Nota de rodapé da tela: é onde caem os números que a história não mostra.
export function InfoNota({ children, style }) {
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "flex-start", maxWidth: 760, ...style }}>
      <span style={{ flexShrink: 0, fontSize: 13, color: "var(--fg-4)", lineHeight: 1.5 }}>ⓘ</span>
      <span style={{ fontSize: 12.5, color: "var(--fg-3)", lineHeight: 1.6, textWrap: "pretty" }}>{children}</span>
    </div>
  );
}

// Link de ajuda: a frase inteira é o alvo ("como o status funciona ⓘ"). Vale
// também como sufixo de cabeçalho de tabela.
export function InfoLink({ texto, children, onClick, style }) {
  const base = { fontSize: 11.5, cursor: "help", color: "var(--fg-3)", border: 0, background: "none", padding: 0, ...style };
  if (onClick) return <button type="button" title={texto} onClick={onClick} style={{ ...base, cursor: "pointer" }}>{children} ⓘ</button>;
  return <span title={texto} style={base}>{children} ⓘ</span>;
}

// ── Barra de filtros: pílulas + "mais ▾" ───────────────────────────────────
// Filtro repetido vira um punhado curto + "mais ▾", nunca mais de quatro
// controles na barra. O filtro escondido que está ATIVO continua aparecendo,
// senão a lista filtra e a barra não diz por quê.
//
// filtros / escondidos: [{ id, label, n, title }]
export function BarraFiltros({ valor, onChange, filtros = [], escondidos = [], style }) {
  const [mais, setMais] = React.useState(false);
  const idsEscondidos = escondidos.map((f) => f.id);
  const abrir = mais || idsEscondidos.includes(valor);
  const lista = abrir ? [...filtros, ...escondidos] : filtros;
  return (
    <div style={{ display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center", ...style }}>
      {lista.map((f) => {
        const on = valor === f.id;
        return (
          <button key={f.id} onClick={() => onChange(f.id)} title={f.title}
            style={{ height: 30, padding: "0 12px", borderRadius: 999, fontSize: 12.5, fontWeight: 600, cursor: "pointer",
              background: on ? "var(--accent-soft)" : "var(--bg-1)", color: on ? "var(--accent)" : "var(--fg-3)",
              border: "1px solid " + (on ? "var(--accent-line)" : "var(--line-1)") }}>
            {f.label}{f.n != null ? <span className="tnum" style={{ marginLeft: 5, opacity: 0.75 }}>{f.n}</span> : null}
          </button>
        );
      })}
      {!abrir && escondidos.length > 0 && (
        <button onClick={() => setMais(true)} className="mono" title={escondidos.map((f) => f.label).join(" · ")}
          style={{ height: 30, padding: "0 10px", borderRadius: 999, fontSize: 11.5, fontWeight: 600, color: "var(--fg-3)", border: "1px dashed var(--line-2)", background: "transparent", cursor: "pointer" }}>
          mais ▾
        </button>
      )}
    </div>
  );
}
