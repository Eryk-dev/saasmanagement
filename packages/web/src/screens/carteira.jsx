// Carteira (CS e suporte, 03/11/2026): o status de cada cliente num lugar só.
//
// Antes, para saber como um cliente estava, era preciso abrir a ficha (ciclo e
// status financeiro), a aba Cobranças (faturas), a integração, os tickets e a
// aba Carteira CS (que só mostrava a coluna). Aqui cada cliente é UMA linha:
// estágio na carteira, saúde com as quatro partes, pagamento, assinatura,
// produtos com conta, o próximo passo e a régua de marcos (que desde 03/11/2026
// vira acompanhamento de CS quando o marco chega). A visão Quadro mantém as colunas da
// carteira com o MRR de cada uma.
//
// Os dados vêm de GET /api/customers/status (customers/customer-status.js): o
// estágio e a saúde são os que o servidor calcula (15 min e 6 h); o pagamento é
// recalculado na leitura. O clique na linha abre o card do cliente aqui mesmo
// (CustomerCard, o mesmo de Clientes, sem sair da tela); o próximo passo abre
// o acompanhamento ou a integração.
//
// A visão Resultados (05/11/2026) escolhe um cliente e mostra o que cada
// produto fez por ele, no formato do slide de cases do deck
// (components/customer-results.jsx, GET /api/customers/:id/results).

import React from "react";
import "./carteira.css";
import { api } from "../lib/api.js";
import { useData } from "../data.jsx";
import { useActiveSaas } from "../lib/workspace.js";
import { currentUser, displayName } from "../lib/users.js";
import { openOnboarding, openRecord } from "../lib/open-record.js";
import { AvisoTopo, BarraComposicao, BarraFiltros, Info } from "../components/story.jsx";
import { Segmented } from "../components/viz.jsx";
import { SelectPopover } from "../components/select-popover.jsx";

const { useState, useEffect, useMemo, Suspense } = React;
// O card do cliente mora no módulo de Clientes: só carrega quando abre.
const CustomerCard = React.lazy(() => import("./customers.jsx").then((m) => ({ default: m.CustomerCard })));
const CustomerResults = React.lazy(() => import("../components/customer-results.jsx"));
const DAY = 86_400_000;

// Estágios da carteira, na ordem em que pedem atenção. "integracao" é o
// cliente que ainda não saiu do pipeline da integração (csStage vazio).
export const STAGES = [
  { id: "em_risco", label: "Em risco", tone: "neg", color: "var(--neg)" },
  { id: "renovacao", label: "Renovação", tone: "info", color: "var(--info)", title: "renovação em negociação (acompanhamento de renovação aberto)" },
  { id: "atencao", label: "Atenção", tone: "warn", color: "var(--warn)" },
  { id: "integracao", label: "Em integração", tone: "mut", color: "var(--fg-4)" },
  { id: "saudavel", label: "Saudável", tone: "pos", color: "var(--pos)" },
  { id: "churn", label: "Churn", tone: "mut", color: "var(--line-strong)" },
];
const STAGE = Object.fromEntries(STAGES.map((s) => [s.id, s]));
const ORDER = Object.fromEntries(STAGES.map((s, i) => [s.id, i]));

export function stageOf(row) {
  if (row.churned || row.lifecycle === "churn" || row.csStage === "churn") return "churn";
  if (row.csStage && STAGE[row.csStage]) return row.csStage;
  if (row.lifecycle === "integracao") return "integracao";
  return row.lifecycle === "risco" ? "em_risco" : "saudavel";
}

// Orçamento da grade (régua do design system): pisos + gaps cabem em 884px,
// o mesmo da tabela de Clientes; abaixo disso a tabela rola dentro do card e,
// no celular, cada linha vira um bloco empilhado.
export const CARTEIRA_GRID = "minmax(196px,1.6fr) minmax(112px,.8fr) minmax(96px,.65fr) minmax(140px,1fr) minmax(124px,.9fr) minmax(140px,1fr)";
export const CARTEIRA_GRID_GAP = 12;
export const CARTEIRA_GRID_BUDGET = 884;

const PAYMENT = {
  adimplente: { label: "em dia", tone: "pos" },
  aguardando_pagamento: { label: "aguardando 1º pagamento", tone: "warn" },
  inadimplente: { label: "inadimplente", tone: "neg" },
  "": { label: "sem cobrança", tone: "mut" },
};
const SUBSCRIPTION = {
  active: { label: "ativa", tone: "pos" },
  past_due: { label: "em atraso", tone: "neg" },
  paused: { label: "pausada", tone: "warn" },
  trial: { label: "em teste", tone: "info" },
  canceled: { label: "cancelada", tone: "mut" },
  expired: { label: "expirada", tone: "mut" },
  ended: { label: "encerrada", tone: "mut" },
};
const CYCLE = { monthly: "mensal", quarterly: "trimestral", semiannual: "semestral", annual: "anual", unico: "serviço único" };
const PRODUCT = { leverads: "LeverAds", leverprice: "LeverPrice", mentoria: "Mentoria" };
const FOLLOWUP = { check_in: "Check-in", qbr: "QBR", renovacao: "Renovação", risco: "Conversa de risco" };
const ONBOARDING = { aguardando_kickoff: "aguardando kickoff", kickoff: "kickoff feito", configuracao: "configuração", treinamento: "treinamento", go_live: "go-live" };
const HEALTH_PARTS = [["pagamento", "Pagamento", 40], ["nps", "NPS", 20], ["suporte", "Suporte", 20], ["resultado", "Resultado", 20]];

const money = (v) => window.fmt?.money?.(v) ?? `R$${Math.round(v)}`;
const moneyFull = (v) => window.fmt?.moneyFull?.(v) ?? `R$ ${Math.round(v)}`;
const ddmm = (iso) => (iso ? new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "America/Sao_Paulo" }) : "");
const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;
// Prazo em dias, nunca a data crua (régua do design system).
const inDays = (iso, now = Date.now()) => {
  const t = Date.parse(iso || "");
  if (!Number.isFinite(t)) return "";
  const d = Math.round((t - now) / DAY);
  if (d === 0) return "hoje";
  return d > 0 ? `em ${plural(d, "dia", "dias")}` : `há ${plural(-d, "dia", "dias")}`;
};

function Dot({ tone }) {
  return <span className="carteira-dot" data-tone={tone} aria-hidden="true" />;
}
// Status em linha de tabela: ponto de 6px + palavra, com o contexto embaixo.
function Cell({ tone, label, sub, title }) {
  return <div className="carteira-cell" title={title}>
    <span className="carteira-cell-main"><Dot tone={tone} />{label}</span>
    {sub && <span className="carteira-cell-sub">{sub}</span>}
  </div>;
}

export function healthTone(h) {
  if (!h) return "mut";
  return h < 50 ? "neg" : h < 70 ? "warn" : "pos";
}

// Saúde: o número na cor da faixa e as quatro partes em barrinhas, cada uma
// pelo próprio teto (pagamento vale 40, as outras 20).
function HealthCell({ row }) {
  const parts = row.healthParts;
  if (!row.healthAt && !row.health) return <Cell tone="mut" label="—" sub="ainda sem cálculo" />;
  const title = parts ? HEALTH_PARTS.map(([k, label, max]) => `${label} ${parts[k] ?? "—"}/${max}`).join(" · ") : "";
  return <div className="carteira-cell" title={title}>
    <span className="carteira-health-num tnum" data-tone={healthTone(row.health)}>{row.health}</span>
    {parts && <span className="carteira-health-parts" aria-label={title}>
      {HEALTH_PARTS.map(([k, label, max]) => {
        const r = (Number(parts[k]) || 0) / max;
        return <span key={k} data-tone={r >= 0.75 ? "pos" : r >= 0.4 ? "warn" : "neg"} title={`${label} ${parts[k] ?? 0}/${max}`} />;
      })}
    </span>}
  </div>;
}

function paymentSub(p, now) {
  if (p.overdueCount) return `${moneyFull(p.overdueAmount)} vencido há ${plural(p.overdueDays, "dia", "dias")}`;
  if (p.nextDue) return `próxima ${moneyFull(p.nextDue.amount)} ${inDays(p.nextDue.dueDate, now)}`;
  if (p.lastPaidAt) return `último pago em ${ddmm(p.lastPaidAt)}`;
  return "";
}

function subscriptionCell(s, now) {
  if (!s) return { tone: "mut", label: "sem assinatura", sub: "" };
  const st = SUBSCRIPTION[s.status] || { label: s.status || "—", tone: "mut" };
  const renova = s.renewInDays != null ? (s.renewInDays === 0 ? "renova hoje" : `renova em ${plural(s.renewInDays, "dia", "dias")}`) : s.periodEnd ? `fim ${ddmm(s.periodEnd)}` : "";
  const tone = s.renewInDays != null && s.renewInDays <= 15 && st.tone === "pos" ? "warn" : st.tone;
  return { tone, label: st.label, sub: [CYCLE[s.cycle] || s.cycle, renova, s.live > 1 ? `${s.live} assinaturas` : ""].filter(Boolean).join(" · ") };
}

// O próximo passo da conta, por ordem do que tem prazo: acompanhamento aberto,
// integração em andamento, ticket urgente. Uma ação por linha.
function nextStep(row, now) {
  const f = row.followup;
  if (f) {
    const when = f.dueAt ? inDays(f.dueAt, now) : "sem prazo";
    return {
      tone: f.late ? "neg" : "info", label: f.title || FOLLOWUP[f.kind] || "Acompanhamento",
      sub: [f.late ? `venceu ${when}` : when, f.owner && f.owner !== row.owner ? displayName(f.owner) : "", f.open > 1 ? `+${f.open - 1}` : ""].filter(Boolean).join(" · "),
      open: () => openRecord("followup", f.id), title: "abrir o acompanhamento",
    };
  }
  const o = row.onboarding;
  if (o) {
    const late = o.plannedGoLiveAt && Date.parse(o.plannedGoLiveAt) < now;
    return {
      tone: late ? "neg" : "mut", label: `Integração ${o.progress}%`,
      sub: [ONBOARDING[o.stage] || o.stage, o.plannedGoLiveAt ? `go-live ${inDays(o.plannedGoLiveAt, now)}` : ""].filter(Boolean).join(" · "),
      open: () => openOnboarding(o.id), title: "abrir a integração",
    };
  }
  if (row.tickets?.urgent) return { tone: "neg", label: plural(row.tickets.urgent, "ticket urgente", "tickets urgentes"), sub: plural(row.tickets.open, "aberto", "abertos"), open: () => { location.hash = "#tickets"; }, title: "abrir os tickets" };
  if (row.tickets?.open) return { tone: "mut", label: plural(row.tickets.open, "ticket aberto", "tickets abertos"), sub: "", open: () => { location.hash = "#tickets"; }, title: "abrir os tickets" };
  return null;
}

// Régua de marcos: uma barrinha por marco (feito, atrasado, vence em 7 dias,
// futuro), "N de M" e o próximo marco — que some quando ele já é o
// acompanhamento mostrado no próximo passo (não repetir a mesma coisa).
const MILESTONE_STATUS = { done: "feito", late: "atrasado", soon: "vence em até 7 dias", next: "futuro" };
export function Regua({ m, followup, now }) {
  if (!m) return null;
  const tip = m.steps.map((x) => `${x.label}: ${MILESTONE_STATUS[x.status] || x.status}`).join("\n");
  const next = m.next && followup?.milestone !== m.next.key ? m.next : null;
  const when = next ? (next.status === "late" ? `atrasado ${inDays(next.dueAt, now)}` : inDays(next.dueAt, now)) : "";
  return <span className="carteira-regua" title={tip} aria-label={`Régua de marcos: ${m.done} de ${m.total} feitos`}>
    <span className="carteira-regua-bar" aria-hidden="true">{m.steps.map((x) => <i key={x.key} data-s={x.status} />)}</span>
    <span className="carteira-regua-text" data-late={next?.status === "late" || undefined}>
      {`${m.done} de ${m.total} marcos`}{next ? ` · ${next.label} ${when}` : !m.next ? " · régua completa" : ""}
    </span>
  </span>;
}

function Products({ list }) {
  if (!list?.length) return null;
  return <span className="carteira-products">
    {list.map((p) => <span key={p.id} className="carteira-product" data-off={p.account === false || undefined}
      title={p.account === false ? `${PRODUCT[p.id] || p.id}: o cliente ainda não tem conta (mande o link de cadastro pelo card)` : p.account ? `${PRODUCT[p.id] || p.id}: conta vinculada` : PRODUCT[p.id] || p.id}>
      {PRODUCT[p.id] || p.id}{p.account === false ? " · sem conta" : ""}
    </span>)}
  </span>;
}

// Cliente com produto que tem resultado medido (LeverAds ou LeverPrice).
export const hasResults = (row) => (row.products || []).some((p) => p.id === "leverads" || p.id === "leverprice");

function Row({ row, now, onOpen, onResults }) {
  const st = STAGE[stageOf(row)];
  const pay = PAYMENT[row.payment?.status || ""] || PAYMENT[""];
  const sub = subscriptionCell(row.subscription, now);
  const step = nextStep(row, now);
  const open = () => onOpen(row.id);
  const lifeSub = row.churned ? (row.endedAt ? `saiu em ${ddmm(row.endedAt)}` : "")
    : row.onboarding && stageOf(row) === "integracao" ? `${row.onboarding.progress}% do checklist`
    : row.nps ? `NPS ${row.nps.score}` : "";
  return <div className="carteira-row" role="button" tabIndex={0} aria-label={`Abrir cliente: ${row.name}`} data-churn={row.churned || undefined}
    onClick={open} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); open(); } }}
    style={{ gridTemplateColumns: CARTEIRA_GRID, gap: CARTEIRA_GRID_GAP }}>
    <div className="carteira-client">
      <div className="carteira-cell carteira-client-main">
        <span className="carteira-name">{row.name || "sem nome"}</span>
        <span className="carteira-cell-sub">
          {[row.mrr ? `${money(row.mrr)}/mês` : "", row.owner ? displayName(row.owner) : "sem dono"].filter(Boolean).join(" · ")}
        </span>
        <Products list={row.products} />
      </div>
      {/* Centralizado na altura da célula do cliente, à direita. */}
      {onResults && hasResults(row) && <button type="button" className="carteira-results-btn" title="ver o que cada produto fez por este cliente"
        aria-label={`Ver resultados: ${row.name}`} onClick={(e) => { e.stopPropagation(); onResults(row.id); }}>
        resultados <span aria-hidden="true">›</span>
      </button>}
    </div>
    <Cell tone={st.tone} label={st.label} sub={lifeSub} title={st.title} />
    <HealthCell row={row} />
    <Cell tone={pay.tone} label={pay.label} sub={paymentSub(row.payment || {}, now)} />
    <Cell tone={sub.tone} label={sub.label} sub={sub.sub} />
    <div className="carteira-cell">
      {step
        ? <button type="button" className="carteira-step" title={step.title} onClick={(e) => { e.stopPropagation(); step.open(); }}>
            <span className="carteira-cell-main"><Dot tone={step.tone} />{step.label}</span>
            {step.sub && <span className="carteira-cell-sub">{step.sub}</span>}
          </button>
        : <Cell tone="mut" label="nada aberto" />}
      <Regua m={row.milestones} followup={row.followup} now={now} />
    </div>
  </div>;
}

function Board({ rows, now, onOpen, stages = STAGES.filter((s) => s.id !== "churn") }) {
  return <div className="carteira-board">
    {stages.map((s) => {
      const list = rows.filter((r) => stageOf(r) === s.id);
      const mrr = list.reduce((n, r) => n + (r.mrr || 0), 0);
      return <section key={s.id} className="carteira-col" aria-label={s.label}>
        <header title={s.title}>
          <Dot tone={s.tone} /><strong>{s.label}</strong>
          <span className="tnum">{list.length}</span>
          {mrr > 0 && <span className="carteira-col-mrr tnum">{money(mrr)}/mês</span>}
        </header>
        <div className="carteira-col-list">
          {list.map((r) => {
            const pay = PAYMENT[r.payment?.status || ""] || PAYMENT[""];
            const step = nextStep(r, now);
            return <button key={r.id} type="button" className="carteira-card" onClick={() => onOpen(r.id)}>
              <span className="carteira-card-top">
                <span className="carteira-name">{r.name || "sem nome"}</span>
                {r.health > 0 && <span className="carteira-health-num tnum" data-tone={healthTone(r.health)}>{r.health}</span>}
              </span>
              <span className="carteira-cell-sub">{[r.mrr ? `${money(r.mrr)}/mês` : "", r.owner ? displayName(r.owner) : "sem dono"].filter(Boolean).join(" · ")}</span>
              <span className="carteira-card-line"><Dot tone={pay.tone} />{pay.label}</span>
              {step && <span className="carteira-card-line"><Dot tone={step.tone} />{step.label}{step.sub ? ` · ${step.sub}` : ""}</span>}
              <Regua m={r.milestones} followup={r.followup} now={now} />
            </button>;
          })}
          {!list.length && <span className="carteira-col-empty">ninguém aqui</span>}
        </div>
      </section>;
    })}
  </div>;
}

const stored = (k, def) => { try { return localStorage.getItem(k) || def; } catch { return def; } };
const store = (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };

export function CarteiraScreen() {
  const { version } = useData();
  const [product] = useActiveSaas();
  const saas = product?.id || "";
  const me = currentUser()?.id || "";
  const [data, setData] = useState({ key: null, rows: [], error: null, loaded: false });
  const [attempt, setAttempt] = useState(0);
  const [view, setViewState] = useState(() => stored("cockpit_carteira_view", "lista"));
  const [stage, setStage] = useState("ativos");
  const [owner, setOwnerState] = useState(() => stored("cockpit_carteira_dono", "todos"));
  const [q, setQ] = useState("");
  const [openId, setOpenId] = useState(null); // cliente com o card aberto
  const [resultId, setResultIdState] = useState(() => stored("cockpit_carteira_resultado", ""));
  const setResultId = (v) => { setResultIdState(v); store("cockpit_carteira_resultado", v); };
  const verResultados = (id) => { setResultId(id); setView("resultados"); document.querySelector(".carteira-page")?.scrollTo?.(0, 0); };
  const setView = (v) => { setViewState(v); store("cockpit_carteira_view", v); };
  const setOwner = (v) => { setOwnerState(v); store("cockpit_carteira_dono", v); };
  const now = Date.now();

  useEffect(() => {
    if (!saas) return undefined;
    let alive = true;
    setData((d) => (d.key === saas ? { ...d, error: null } : { key: saas, rows: [], error: null, loaded: false }));
    api.customerStatus(saas)
      .then((r) => alive && setData({ key: saas, rows: r?.rows || [], error: null, loaded: true }))
      .catch((error) => alive && setData((d) => ({ ...d, key: saas, error })));
    return () => { alive = false; };
  }, [saas, version, attempt]);

  const rows = data.key === saas ? data.rows : [];
  const owners = useMemo(() => [...new Set(rows.map((r) => r.owner).filter(Boolean))]
    .sort((a, b) => displayName(a).localeCompare(displayName(b))), [rows]);
  const ownerOptions = [
    { value: "todos", label: "Todos os donos" },
    ...(me && owners.includes(me) ? [{ value: me, label: "Meus clientes" }] : []),
    { value: "sem", label: "Sem dono" },
    ...owners.filter((id) => id !== me).map((id) => ({ value: id, label: displayName(id) })),
  ];
  const ownerValue = ownerOptions.some((o) => o.value === owner) ? owner : "todos";

  // Recorte por dono e busca primeiro: as contagens dos estágios respeitam o dono.
  const mine = rows.filter((r) => (ownerValue === "todos" ? true : ownerValue === "sem" ? !r.owner : r.owner === ownerValue));
  const term = q.trim().toLowerCase();
  const searched = term ? mine.filter((r) => `${r.name} ${(r.products || []).map((p) => PRODUCT[p.id] || p.id).join(" ")}`.toLowerCase().includes(term)) : mine;
  const active = searched.filter((r) => stageOf(r) !== "churn");
  const count = (id) => searched.filter((r) => stageOf(r) === id).length;
  const shown = (stage === "ativos" ? active
    : stage === "inadimplente" ? active.filter((r) => r.payment?.status === "inadimplente")
    : stage === "renova30" ? active.filter((r) => r.subscription?.renewInDays != null && r.subscription.renewInDays <= 30)
    : stage === "marco" ? active.filter((r) => r.milestones?.late > 0)
    : searched.filter((r) => stageOf(r) === stage))
    .slice().sort((a, b) => ORDER[stageOf(a)] - ORDER[stageOf(b)] || (a.health || 101) - (b.health || 101) || (b.mrr || 0) - (a.mrr || 0));

  const late = active.filter((r) => r.followup?.late);
  const overdue = active.filter((r) => r.payment?.status === "inadimplente");
  const overdueAmount = overdue.reduce((n, r) => n + (r.payment?.overdueAmount || 0), 0);
  const renewSoon = active.filter((r) => r.subscription?.renewInDays != null && r.subscription.renewInDays <= 30);
  const mrrTotal = active.reduce((n, r) => n + (r.mrr || 0), 0);

  const filtros = [
    { id: "ativos", label: "Ativos", n: active.length },
    ...STAGES.filter((s) => s.id !== "churn").map((s) => ({ id: s.id, label: s.label, n: count(s.id), title: s.title })),
  ];
  const escondidos = [
    { id: "inadimplente", label: "Inadimplentes", n: overdue.length },
    { id: "renova30", label: "Renovam em 30 dias", n: renewSoon.length },
    { id: "marco", label: "Marco atrasado", n: active.filter((r) => r.milestones?.late > 0).length, title: "marco da régua de pós-venda que venceu sem ser concluído" },
    { id: "churn", label: "Churn", n: count("churn") },
  ];
  const boardStages = stage === "churn" ? [STAGE.churn] : STAGES.filter((s) => s.id !== "churn");

  // Resultados: clientes do dono escolhido (ativos primeiro, churn no fim), por nome.
  const resultOptions = mine.slice()
    .sort((a, b) => (stageOf(a) === "churn") - (stageOf(b) === "churn") || String(a.name || "").localeCompare(String(b.name || ""), "pt-BR"))
    .map((r) => ({
      value: r.id, label: r.name || "sem nome",
      hint: [(r.products || []).filter((p) => p.id !== "mentoria").map((p) => PRODUCT[p.id] || p.id).join(" · "), stageOf(r) === "churn" ? "churn" : ""].filter(Boolean).join(" · "),
    }));
  const resultValue = resultOptions.some((o) => o.value === resultId) ? resultId
    : (mine.find((r) => stageOf(r) !== "churn" && (r.products || []).some((p) => p.account)) || mine[0])?.id || "";
  const resultRow = rows.find((r) => r.id === resultValue);

  return <div className="carteira-page">
    <header className="carteira-header">
      <div style={{ minWidth: 0 }}>
        <h1 className="page-title">Carteira</h1>
        <div className="page-sub">{view === "resultados" ? "o que cada produto fez pelo cliente, no formato do slide de cases do deck" : "cada cliente numa linha: estágio, saúde, pagamento, assinatura, produtos e o próximo passo"}</div>
      </div>
      <Segmented value={view} onChange={setView} options={[{ value: "lista", label: "Lista" }, { value: "quadro", label: "Quadro" }, { value: "resultados", label: "Resultados" }]} />
    </header>

    {data.key !== saas || (!data.loaded && !data.error)
      ? <div className="carteira-load" role="status">Carregando a carteira…</div>
      : data.error && !data.loaded
        ? <div className="carteira-load" role="alert">Não foi possível carregar a carteira. <button onClick={() => setAttempt((n) => n + 1)}>Tentar novamente</button></div>
        : view === "resultados"
          ? <Suspense fallback={<div className="carteira-load" role="status">Carregando os resultados…</div>}>
              <CustomerResults customerId={resultValue} customerName={resultRow?.name || ""}
                toolbar={<>
                  <div className="carteira-result-pick"><SelectPopover label="Cliente" value={resultValue} options={resultOptions} onChange={setResultId} size="sm" searchable placeholder="Escolha um cliente" /></div>
                  <div className="carteira-owner"><SelectPopover label="Dono da conta" value={ownerValue} options={ownerOptions} onChange={setOwner} size="sm" /></div>
                </>} />
            </Suspense>
          : <>
          {overdue.length > 0
            ? <AvisoTopo tom="neg" titulo={`${plural(overdue.length, "cliente inadimplente", "clientes inadimplentes")} · ${moneyFull(overdueAmount)} vencidos`}
                nota={late.length ? `e ${plural(late.length, "acompanhamento vencido", "acompanhamentos vencidos")}` : "cobre antes que vire churn"}
                acao={{ label: "ver inadimplentes", onClick: () => { setStage("inadimplente"); setView("lista"); } }} />
            : late.length > 0
              ? <AvisoTopo tom="warn" titulo={plural(late.length, "acompanhamento passou do prazo", "acompanhamentos passaram do prazo")}
                  nota="check-in, renovação ou conversa de risco sem retorno" acao={{ label: "ver na lista", onClick: () => { setStage("ativos"); setView("lista"); } }} />
              : null}

          {mrrTotal > 0 && <BarraComposicao titulo="Onde está o MRR da carteira" sub={`${moneyFull(mrrTotal)}/mês em ${plural(active.length, "cliente ativo", "clientes ativos")}`}
            total={mrrTotal}
            fatias={STAGES.filter((s) => s.id !== "churn").map((s) => ({ rotulo: s.label, valor: active.filter((r) => stageOf(r) === s.id).reduce((n, r) => n + (r.mrr || 0), 0), cor: s.color }))
              .filter((f) => f.valor > 0).map((f) => ({ ...f, texto: money(f.valor) }))}
            fim={<Info texto="Estágio e saúde são recalculados pelo servidor (a carteira a cada 15 min, a saúde a cada 6 h). Saúde = pagamento (40) + NPS (20) + suporte (20) + resultado nos anúncios (20); sem dado, cada parte entra no meio." />} />}

          <section className="carteira-card-wrap">
            <div className="carteira-filters">
              <BarraFiltros valor={stage} onChange={setStage} filtros={filtros} escondidos={escondidos} />
              <div className="carteira-owner"><SelectPopover label="Dono da conta" value={ownerValue} options={ownerOptions} onChange={setOwner} size="sm" /></div>
              <label className="carteira-search">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20.4 20.4-4.2-4.2" /></svg>
                <input aria-label="Buscar cliente" value={q} onChange={(e) => setQ(e.target.value)} placeholder="buscar cliente…" />
              </label>
            </div>

            {view === "quadro"
              ? <Board rows={stage === "ativos" || stage === "churn" ? searched : shown} now={now} stages={boardStages} onOpen={setOpenId} />
              : <div className="carteira-table">
                  <div className="carteira-head" style={{ gridTemplateColumns: CARTEIRA_GRID, gap: CARTEIRA_GRID_GAP }}>
                    {["Cliente", "Estágio", "Saúde", "Pagamento", "Assinatura", "Próximo passo"].map((h) => <span key={h} className="kicker">{h}</span>)}
                  </div>
                  {shown.map((r) => <Row key={r.id} row={r} now={now} onOpen={setOpenId} onResults={verResultados} />)}
                  {!shown.length && <div className="carteira-empty">{rows.length ? "nenhum cliente com esses filtros" : "nenhum cliente neste produto ainda"}</div>}
                </div>}
          </section>
        </>}
    {openId && <Suspense fallback={null}><CustomerCard customerId={openId} onClose={() => setOpenId(null)} /></Suspense>}
  </div>;
}

// Linha e quadro exportados para o smoke renderizar com dados fixos.
export { Row as CarteiraRow, Board as CarteiraBoard };
export default CarteiraScreen;
