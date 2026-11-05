// Resultados do cliente por produto (Carteira → Resultados, 05/11/2026).
//
// O palco imita o slide 06 do deck ("Quem já está dentro", cardCase em
// api/src/proposals/proposal-slides-page.js): o número grande do produto, as
// linhas de apoio e a régua em uma frase. Embaixo, os últimos 30 dias contra
// os 30 anteriores e o mês a mês. Serve pra quem cuida da conta abrir na call
// (botão Apresentar, tela cheia) ou salvar em PDF.
//
// Cada produto conta a própria história: LeverAds mede o que os anúncios da
// Lever venderam; LeverPrice mede o vendido com o preço do robô e o rebate
// recuperado. As definições (o que é cada número, a régua de horas e custo)
// moram na API, em GET /api/customers/:id/results → `products`; aqui só se
// desenha o que vem de lá.

import React from "react";
import "./customer-results.css";
import { api } from "../lib/api.js";
import { useWidth, Segmented } from "./viz.jsx";
import { PrimaryButton, SecondaryButton } from "../atoms.jsx";

const { useState, useEffect, useRef } = React;

const nf = (max = 0) => new Intl.NumberFormat("pt-BR", { maximumFractionDigits: max });
const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const MESES_LONGOS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

// Número curto no tom do deck ("R$ 442 mil", "1,2 mi"): uma casa só onde ela informa.
export function short(n) {
  const v = Math.abs(Number(n) || 0);
  const s = Number(n) < 0 ? "−" : "";
  if (v >= 1e6) return `${s}${nf(1).format(v / 1e6)} mi`;
  if (v >= 1e3) return `${s}${nf(v < 1e5 ? 1 : 0).format(v / 1e3)} mil`;
  return `${s}${nf(0).format(v)}`;
}
export function fmtValue(v, format, { full = false } = {}) {
  if (v == null || v === "") return "—"; // sem dado (produto fora do ar) não vira zero
  const n = Number(v) || 0;
  if (format === "money") return full ? `R$ ${new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)}` : `R$ ${short(n)}`;
  if (format === "pct") return `${nf(1).format(n)}%`;
  if (format === "hours") return `${full ? nf(0).format(n) : short(n)} h`;
  return full || n < 1e4 ? nf(0).format(n) : short(n);
}
const monthLabel = (ym, long = false) => {
  const [y, m] = String(ym || "").split("-").map(Number);
  if (!y || !m) return ym || "";
  return long ? `${MESES_LONGOS[m - 1]} de ${y}` : MESES[m - 1];
};
const ddmmyyyy = (iso) => {
  if (!iso) return "";
  const d = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T12:00:00Z`) : new Date(iso);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "";
};

// Variação contra os 30 dias anteriores, em palavras. Sem base, não inventa %.
export function delta(current, previous) {
  const c = Number(current) || 0, p = Number(previous);
  if (current == null || previous == null || !Number.isFinite(p)) return null;
  if (p <= 0) return c > 0 ? { tone: "pos", text: "sem base nos 30 dias anteriores" } : null;
  const pct = ((c - p) / p) * 100;
  if (Math.abs(pct) < 0.5) return { tone: "flat", arrow: "=", text: "igual aos 30 dias anteriores" };
  return { tone: pct > 0 ? "pos" : "neg", arrow: pct > 0 ? "▲" : "▼", text: `${pct > 0 ? "+" : "−"}${nf(Math.abs(pct) < 10 ? 1 : 0).format(Math.abs(pct))}% sobre os 30 dias anteriores` };
}

// Topo do eixo num número redondo (R$ 300 mil, não R$ 281 mil): a metade
// também fica redonda e a grade lê sem esforço.
export function niceMax(v) {
  if (!(v > 0)) return 1;
  const pow = 10 ** Math.floor(Math.log10(v));
  const m = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find((x) => x * pow >= v);
  return m * pow;
}

// Barra com só o topo arredondado (a base encosta no eixo).
function barPath(x, y, w, h, r = 4) {
  if (h <= 0 || w <= 0) return "";
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}

// Mês a mês: barras de uma série (`main`), opcionalmente aninhadas dentro do
// todo (`context`, em cinza: o faturamento da loja contém o que veio da Lever).
// Um eixo só; o resto das séries vira gráfico próprio embaixo (nunca eixo duplo).
export function MonthBars({ rows = [], main, context = null, color = "var(--chart-1)", height = 220, label }) {
  const [ref, w] = useWidth(720);
  const [hover, setHover] = useState(-1);
  const padL = 52, padR = 8, padT = 22, padB = 26;
  const iw = Math.max(60, w - padL - padR);
  const ih = height - padT - padB;
  const vals = rows.flatMap((r) => [Number(r[main.key]) || 0, context ? Number(r[context.key]) || 0 : 0]);
  const max = niceMax(Math.max(0, ...vals));
  const n = Math.max(1, rows.length);
  const slot = iw / n;
  const bw = Math.max(4, Math.min(44, slot - 8));
  const X = (i) => padL + i * slot + (slot - bw) / 2;
  const Y = (v) => padT + ih - (v / max) * ih;
  const H = (v) => (Math.max(0, v) / max) * ih;
  const every = slot < 30 ? 2 : 1;
  const last = rows.length - 1;
  const lastMain = Number(rows[last]?.[main.key]) || 0;
  const r = hover >= 0 ? rows[hover] : null;
  const tipLeft = hover >= 0 ? Math.min(Math.max(X(hover) + bw / 2, 90), w - 90) : 0;

  return <div ref={ref} className="cres-chart" style={{ height }} onMouseLeave={() => setHover(-1)}>
    <svg width={w} height={height} role="img" aria-label={label || main.label}>
      {[max, max / 2, 0].map((g, i) => <g key={i}>
        <line x1={padL} x2={w - padR} y1={Y(g)} y2={Y(g)} stroke="var(--line-1)" strokeWidth="1" />
        <text x={padL - 8} y={Y(g) + 3.5} textAnchor="end" className="cres-axis">{fmtValue(g, main.format)}</text>
      </g>)}
      {rows.map((row, i) => {
        const cv = context ? Number(row[context.key]) || 0 : 0;
        const mv = Number(row[main.key]) || 0;
        return <g key={row.month}>
          {context && cv > 0 && <path d={barPath(X(i), Y(cv), bw, H(cv))} fill="var(--cres-context)" />}
          {mv > 0 && <path d={barPath(X(i), Y(mv), bw, H(mv))} fill={color} opacity={hover >= 0 && hover !== i ? 0.55 : 1} />}
          {(i % every === 0 || i === last) && <text x={X(i) + bw / 2} y={height - 8} textAnchor="middle" className="cres-axis">{monthLabel(row.month)}</text>}
          <rect x={padL + i * slot} y={padT} width={slot} height={ih} fill="transparent" onMouseEnter={() => setHover(i)}
            onFocus={() => setHover(i)} onBlur={() => setHover(-1)} tabIndex={0} aria-label={`${monthLabel(row.month, true)}: ${main.label} ${fmtValue(mv, main.format, { full: true })}`} />
        </g>;
      })}
      {lastMain > 0 && hover < 0 && <text x={Math.min(X(last) + bw / 2, w - padR)} y={Y(lastMain) - 7} textAnchor="end" className="cres-axis cres-axis-strong">{fmtValue(lastMain, main.format)}</text>}
    </svg>
    {r && <div className="cres-tip" style={{ left: tipLeft }} role="status">
      <strong>{monthLabel(r.month, true)}</strong>
      {context && <span><i style={{ background: "var(--cres-context)" }} />{context.label}<b className="tnum">{fmtValue(r[context.key], context.format, { full: true })}</b></span>}
      <span><i style={{ background: color }} />{main.label}<b className="tnum">{fmtValue(r[main.key], main.format, { full: true })}</b></span>
      {context && Number(r[context.key]) > 0 && <span className="cres-tip-sub">{nf(1).format((Number(r[main.key]) || 0) / Number(r[context.key]) * 100)}% do faturamento do mês</span>}
    </div>}
  </div>;
}

function Legend({ items }) {
  return <div className="cres-legend">
    {items.map((x) => <span key={x.label}><i style={{ background: x.color }} />{x.label}</span>)}
  </div>;
}

// Tabela do mês a mês: a mesma informação dos gráficos, para ler o número exato.
function MonthTable({ rows, series }) {
  return <div className="cres-table-wrap">
    <table className="cres-table">
      <thead><tr><th>Mês</th>{series.map((s) => <th key={s.key}>{s.label}</th>)}</tr></thead>
      <tbody>{rows.map((r) => <tr key={r.month}><td>{monthLabel(r.month, true)}</td>{series.map((s) => <td key={s.key} className="tnum">{fmtValue(r[s.key], s.format, { full: true })}</td>)}</tr>)}</tbody>
    </table>
  </div>;
}

const EXTRA_COLORS = ["var(--chart-2)", "var(--chart-3)"];

// O palco de UM produto.
export function ProductResults({ product: p, customerName }) {
  const [table, setTable] = useState(false);
  if (p.status !== "ok") {
    return <div className="cres-empty">
      <strong>{p.status === "sem_vinculo" ? `Sem conta do ${p.label} vinculada` : `${p.label} indisponível agora`}</strong>
      <span>{p.reason || (p.status === "sem_vinculo" ? "Vincule a conta do produto no cadastro do cliente para ter os números." : "Não deu para falar com o produto. Tente de novo em instantes.")}</span>
    </div>;
  }
  const series = p.monthly?.series || [];
  const rows = p.monthly?.rows || [];
  const main = series.find((s) => s.role === "main");
  const context = series.find((s) => s.role === "context");
  const extras = series.filter((s) => s.role === "extra");
  const hasMonthly = main && rows.some((r) => series.some((s) => Number(r[s.key]) > 0));
  const recent = p.recent?.items || [];

  return <>
    <h2 className="cres-title">{customerName || "Cliente"} com o {p.label}. <span>O que mudou.</span></h2>
    {(p.note || p.since) && <p className="cres-lede">
      {p.note}{p.note && p.since ? " " : ""}{p.since ? `Dados desde ${ddmmyyyy(p.since)}.` : ""}
    </p>}

    <div className="cres-top">
      {/* O card do deck: número grande, linhas de apoio. */}
      <section className="cres-case" aria-label={`Resultado no ${p.label}`}>
        <div className="cres-case-name">{customerName}{` · ${p.label}`}</div>
        <div className="cres-hero tnum" title={fmtValue(p.hero?.value, p.hero?.format, { full: true })}>{fmtValue(p.hero?.value, p.hero?.format)}</div>
        <div className="cres-hero-label">{p.hero?.label}{p.hero?.period ? ` (${p.hero.period})` : ""}</div>
        {!!p.metrics?.length && <div className="cres-case-lines">
          {p.metrics.slice(0, 3).map((m) => <div key={m.key} title={fmtValue(m.value, m.format, { full: true })}>
            <b className="tnum">{fmtValue(m.value, m.format)}</b> {m.label}{m.period && m.period !== p.hero?.period ? ` (${m.period})` : ""}
          </div>)}
        </div>}
      </section>

      {/* Últimos 30 dias contra os 30 anteriores. */}
      {!!recent.length && <section className="cres-recent" aria-label={`Últimos ${p.recent.days || 30} dias`}>
        <div className="cres-kicker">Últimos {p.recent.days || 30} dias</div>
        <div className="cres-recent-grid">
          {recent.map((it) => {
            const d = delta(it.current, it.previous);
            return <div key={it.key} className="cres-recent-item">
              <span className="cres-recent-label">{it.label}</span>
              <span className="cres-recent-value tnum" title={fmtValue(it.current, it.format, { full: true })}>{fmtValue(it.current, it.format)}</span>
              {d && <span className="cres-delta" data-tone={d.tone}>{d.arrow && <i aria-hidden="true">{d.arrow}</i>}{d.text}</span>}
              {!d && it.previous == null && <span className="cres-delta" data-tone="flat">sem comparação</span>}
            </div>;
          })}
        </div>
      </section>}
    </div>

    {main && <section className="cres-monthly" aria-label="Mês a mês">
      <div className="cres-monthly-head">
        <div className="cres-kicker">Mês a mês</div>
        {hasMonthly && <button type="button" className="cres-link cres-noprint" onClick={() => setTable((t) => !t)}>{table ? "ver gráfico" : "ver tabela"}</button>}
      </div>
      {!hasMonthly
        ? <div className="cres-chart-empty">ainda sem venda registrada nos últimos meses</div>
        : table
          ? <MonthTable rows={rows} series={series} />
          : <>
            <Legend items={[...(context ? [{ label: context.label, color: "var(--cres-context)" }] : []), ...(context ? [{ label: main.label, color: "var(--chart-1)" }] : [])]} />
            {!context && <div className="cres-chart-title">{main.label}</div>}
            <MonthBars rows={rows} main={main} context={context} />
            {!!extras.length && <div className="cres-extras">
              {extras.map((s, i) => <div key={s.key} className="cres-extra">
                <div className="cres-chart-title">{s.label}</div>
                <MonthBars rows={rows} main={s} color={EXTRA_COLORS[i % EXTRA_COLORS.length]} height={150} />
              </div>)}
            </div>}
          </>}
    </section>}
  </>;
}

const stored = (k) => { try { return localStorage.getItem(k) || ""; } catch { return ""; } };
const store = (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };

// Busca os resultados do cliente e desenha o palco do produto escolhido, com
// Apresentar (tela cheia) e Salvar PDF (impressão só do palco).
export function CustomerResults({ customerId, customerName, toolbar = null }) {
  const [state, setState] = useState({ id: null, data: null, error: null });
  const [attempt, setAttempt] = useState(0);
  const [product, setProductState] = useState(() => stored("cockpit_carteira_resultado_produto"));
  const [full, setFull] = useState(false);
  const stageRef = useRef(null);
  const setProduct = (v) => { setProductState(v); store("cockpit_carteira_resultado_produto", v); };

  useEffect(() => {
    if (!customerId) return undefined;
    let alive = true;
    setState((s) => (s.id === customerId ? { ...s, error: null } : { id: customerId, data: null, error: null }));
    api.customerResults(customerId)
      .then((data) => alive && setState({ id: customerId, data, error: null }))
      .catch((error) => alive && setState({ id: customerId, data: null, error }));
    return () => { alive = false; };
  }, [customerId, attempt]);

  useEffect(() => {
    const onChange = () => setFull(document.fullscreenElement === stageRef.current && !!stageRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const products = state.id === customerId ? state.data?.products || [] : [];
  const current = products.find((p) => p.id === product) || products.find((p) => p.status === "ok") || products[0] || null;
  const loading = state.id !== customerId || (!state.data && !state.error);

  const apresentar = () => {
    const el = stageRef.current;
    if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen?.();
    else el.requestFullscreen?.().catch(() => window.toast?.("O navegador não deixou abrir em tela cheia", "neg"));
  };
  const salvarPdf = () => {
    const done = () => { document.body.classList.remove("cres-printing"); window.removeEventListener("afterprint", done); };
    document.body.classList.add("cres-printing");
    window.addEventListener("afterprint", done);
    window.print();
  };

  return <section className="cres-wrap">
    <div className="cres-toolbar">
      {toolbar}
      {products.length > 1 && <Segmented value={current?.id} onChange={setProduct} options={products.map((p) => ({ value: p.id, label: p.label }))} />}
      <span className="cres-toolbar-actions">
        <SecondaryButton size="sm" type="button" onClick={salvarPdf} disabled={!current || current.status !== "ok"}>Salvar PDF</SecondaryButton>
        <PrimaryButton size="sm" type="button" onClick={apresentar} disabled={!current || current.status !== "ok"}>Apresentar</PrimaryButton>
      </span>
    </div>

    {!customerId
      ? <div className="cres-empty"><strong>Escolha um cliente</strong><span>Os resultados aparecem por produto, no formato do slide de cases do deck.</span></div>
      : loading
        ? <div className="cres-empty" role="status"><span>Carregando os resultados…</span></div>
        : state.error
          ? <div className="cres-empty" role="alert"><span>Não foi possível carregar os resultados. <button type="button" className="cres-link" onClick={() => setAttempt((n) => n + 1)}>Tentar novamente</button></span></div>
          : !current
            ? <div className="cres-empty"><strong>Nenhum produto com resultado</strong><span>Este cliente não tem LeverAds nem LeverPrice no negócio ou no cadastro.</span></div>
            : <div ref={stageRef} className="cres-stage" data-full={full || undefined}>
              <div className="cres-stage-head">
                <span className="cres-kicker">Resultados · {current.label}</span>
                {current.asOf && <span className="cres-asof">atualizado em {ddmmyyyy(current.asOf)}</span>}
              </div>
              <ProductResults product={current} customerName={customerName} />
              {full && <button type="button" className="cres-exit cres-noprint" onClick={apresentar}>sair (Esc)</button>}
            </div>}
  </section>;
}

export default CustomerResults;
