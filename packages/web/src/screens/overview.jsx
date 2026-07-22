import React from "react";
import { api } from "../lib/api.js";
import { useData } from "../data.jsx";
import { PageHead, FilterTab, StatTile, Card } from "../components/viz.jsx";
import { EmptyState } from "../atoms.jsx";
import { nextMilestone, dueLabel } from "../lib/milestones.js";
import { openStages, isWonLead, wonAtOf, stageKind } from "../lib/funnel.js";
import { bizDay } from "../lib/format.js";
import { displayName } from "../lib/users.js";
import { leadTier } from "../lib/ui.js";
import { useActiveSaas } from "../lib/workspace.js";
import { buildPeople, TeamCards, topPerformer } from "../components/team-cards.jsx";
// Visão geral — cockpit de GESTÃO. Responde: como está o negócio (receita, CAC,
// ROAS) e como está o DESEMPENHO de cada papel (SDR/closer/CS), pessoa a pessoa,
// contra a meta. A execução ("quem contatar agora") mora no Meu dia, não aqui.
// Focada no produto ativo (abas por SaaS quando o portfólio tem mais de um).

const { useState, useEffect, useMemo } = React;

const DAY = 86_400_000;
const shortDay = (d) => d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }).replace(".", "");
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const pctStr = (n) => (n == null ? "" : String(n).replace(".", ",") + "%");

// Filtro de período da Visão geral: presets de N dias (+ hoje/ontem/custom). A
// janela ANTERIOR é a mesma duração imediatamente antes — base da meta dinâmica
// de calls do SDR (leads do período anterior × taxa).
const PRESETS = [
  { key: "today", label: "Hoje", days: 1, off: 0 },
  { key: "yesterday", label: "Ontem", days: 1, off: 1 },
  { key: "3d", label: "3 dias", days: 3, off: 0 },
  { key: "7d", label: "7 dias", days: 7, off: 0 },
  { key: "15d", label: "15 dias", days: 15, off: 0 },
  { key: "30d", label: "30 dias", days: 30, off: 0 },
  { key: "60d", label: "60 dias", days: 60, off: 0 },
  { key: "90d", label: "90 dias", days: 90, off: 0 },
];
// Dias ÚTEIS (seg–sex) no intervalo [since, until], inclusivo. O time não opera
// no fim de semana, então as metas absolutas (mês/semana) se distribuem só nos
// dias úteis — a fatia do fim de semana vira meta a mais nos dias úteis, não
// some. Meio-dia evita borda de fuso; setDate anda o dia certo mesmo com DST.
function businessDaysBetween(sinceYmd, untilYmd) {
  let n = 0;
  const d = new Date(`${sinceYmd}T12:00:00`), end = new Date(`${untilYmd}T12:00:00`);
  while (d <= end) { const w = d.getDay(); if (w !== 0 && w !== 6) n++; d.setDate(d.getDate() + 1); }
  return n;
}
function periodWindow(period, custom, now = new Date()) {
  if (period === "custom" && custom?.since && custom?.until) {
    const s = new Date(`${custom.since}T00:00:00`), u = new Date(`${custom.until}T00:00:00`);
    const days = Math.max(1, Math.round((u - s) / DAY) + 1);
    const prevUntil = new Date(s.getTime() - DAY), prevSince = new Date(prevUntil.getTime() - (days - 1) * DAY);
    const lbl = `${custom.since.slice(5)} a ${custom.until.slice(5)}`;
    return { since: custom.since, until: custom.until, prevSince: ymd(prevSince), prevUntil: ymd(prevUntil), days, businessDays: businessDaysBetween(custom.since, custom.until), short: lbl, label: lbl };
  }
  const p = PRESETS.find((x) => x.key === period) || PRESETS.find((x) => x.key === "30d");
  const end0 = new Date(now); end0.setHours(0, 0, 0, 0);
  const end = new Date(end0.getTime() - (p.off || 0) * DAY);
  const since = new Date(end.getTime() - (p.days - 1) * DAY);
  const prevUntil = new Date(since.getTime() - DAY), prevSince = new Date(prevUntil.getTime() - (p.days - 1) * DAY);
  const short = p.key === "today" ? "hoje" : p.key === "yesterday" ? "ontem" : p.label.toLowerCase();
  const sinceYmd = ymd(since), untilYmd = ymd(end);
  return { since: sinceYmd, until: untilYmd, prevSince: ymd(prevSince), prevUntil: ymd(prevUntil), days: p.days, businessDays: businessDaysBetween(sinceYmd, untilYmd), short, label: short };
}
const dateInp = { height: 32, padding: "0 9px", borderRadius: "var(--r-2)", border: "1px solid var(--line-2)", background: "var(--bg-1)", color: "var(--fg-1)", fontSize: 12, fontFamily: "var(--mono)" };

function OverviewScreen({ onNav, onOpenLead }) {
  const { SAAS, LEADS, CUSTOMERS } = window.SEED;
  const { version } = useData();
  const [product, setActiveSaas] = useActiveSaas();
  const [marketing, setMarketing] = useState(null);
  const [biz, setBiz] = useState(null); // CAC/conversão (30d) — mesmo endpoint da Publicidade
  const [invoices, setInvoices] = useState([]);
  const [costs, setCosts] = useState(null); // custos do mês corrente (tela Custos)
  const [score, setScore] = useState(null); // placar do time da janela do topo
  const [pace, setPace] = useState(null); // meta do mês (caixa) — /api/pipeline-pace
  const [wa, setWa] = useState(null); // inbox do WhatsApp (números globais do time)
  // Período do TOPO governa os tiles de aquisição e o gráfico. Snapshots
  // financeiros (MRR, Clientes, Resultado do mês) seguem a cadência própria.
  const [period, setPeriod] = useState(() => { try { return localStorage.getItem("cockpit_ov_period") || "30d"; } catch { return "30d"; } });
  const setPeriodP = (p) => { setPeriod(p); try { localStorage.setItem("cockpit_ov_period", p); } catch { /* ignore */ } };
  const [custom, setCustom] = useState(() => { try { return JSON.parse(localStorage.getItem("cockpit_ov_custom")) || { since: "", until: "" }; } catch { return { since: "", until: "" }; } });
  const setCustomP = (c) => { setCustom(c); try { localStorage.setItem("cockpit_ov_custom", JSON.stringify(c)); } catch { /* ignore */ } };
  const win = useMemo(() => periodWindow(period, custom), [period, custom.since, custom.until]);
  const pLabel = win.label;
  const pShort = win.short;

  // Troca de PRODUTO zera os painéis; refresh por versão (SSE) ou período refaz.
  const loadedFor = React.useRef(null);
  useEffect(() => {
    if (!product) return;
    if (loadedFor.current !== product.id) {
      loadedFor.current = product.id;
      setMarketing(null); setInvoices([]); setCosts(null); setScore(null); setPace(null);
    }
    let alive = true;
    api.marketingMetrics(product.id, { since: win.since, until: win.until }).then((m) => alive && setMarketing(m)).catch(() => alive && setMarketing(null));
    api.metrics(product.id, { days: win.days }).then((b) => alive && setBiz(b)).catch(() => alive && setBiz(null));
    api.list("invoices").then((rows) => alive && setInvoices(rows.filter((i) => i.saas === product.id))).catch(() => {});
    api.expensesSummary(product.id).then((c) => alive && setCosts(c)).catch(() => alive && setCosts(null));
    return () => { alive = false; };
  }, [product?.id, version, period, custom.since, custom.until]); // eslint-disable-line react-hooks/exhaustive-deps

  // Placar do time: um fetch pra janela do topo (o filtro único rege tudo).
  useEffect(() => {
    if (!product) return;
    let alive = true;
    api.scoreboard(product.id, win).then((s) => alive && setScore(s)).catch(() => {});
    return () => { alive = false; };
  }, [product?.id, version, period, custom.since, custom.until]); // eslint-disable-line react-hooks/exhaustive-deps

  // Meta do mês (pace de caixa) e inbox do WhatsApp: cadência própria (mês /
  // estado atual), não seguem o filtro de período do topo. O inbox é ÚNICO pro
  // time (o guard libera só a leitura agregada), então os números são globais.
  useEffect(() => {
    if (!product) return;
    let alive = true;
    api.pipelinePace(product.id).then((d) => alive && setPace(d)).catch(() => alive && setPace(null));
    api.waInsights(30).then((d) => alive && setWa(d)).catch(() => alive && setWa(null));
    return () => { alive = false; };
  }, [product?.id, version]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sem leads internos (teste) — espelho do isRealLead do metrics-core da API.
  const leads = useMemo(() => (LEADS || []).filter((l) => l.saas === product?.id && !l.internal), [LEADS, product?.id]);

  const now = Date.now();
  const dstr = bizDay; // dia do NEGÓCIO (America/Sao_Paulo) — nunca slice UTC
  const inPeriod = (iso) => { const d = dstr(iso); return d >= win.since && d <= win.until; };
  const inPrevPeriod = (iso) => { const d = dstr(iso); return d >= win.prevSince && d <= win.prevUntil; };
  const leadsPeriod = leads.filter((l) => inPeriod(l.createdAt)).length;
  const leadsPrev = leads.filter((l) => inPrevPeriod(l.createdAt)).length;
  const leadsDeltaPct = leadsPrev > 0 ? Math.round(((leadsPeriod - leadsPrev) / leadsPrev) * 100) : null;

  // Resultado usa o MÊS (custos são mensais), não a janela do topo.
  const thisMonth = (iso) => iso && dstr(iso).slice(0, 7) === dstr(new Date(now)).slice(0, 7);
  const wonValueMonth = leads.filter((l) => isWonLead(product, l) && thisMonth(wonAtOf(l))).reduce((a, l) => a + (l.amount || 0), 0);
  // Resultado do mês = ganhos do mês menos os custos operacionais (mensais).
  const result = costs ? wonValueMonth - (costs.total || 0) : null;

  // Pendências: faturas abertas vencendo em 7d + marcos de pós-venda.
  const dueInvoices = invoices
    .filter((i) => (i.status === "open" || i.status === "overdue") && i.dueDate && new Date(i.dueDate).getTime() - now <= 7 * DAY)
    .sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)))
    .slice(0, 3);

  const cpl = marketing?.totals?.spend > 0 && marketing?.totals?.cpl != null ? marketing.totals.cpl : null;
  const roas = marketing?.totals?.roas != null ? marketing.totals.roas : null;
  const productCustomers = (CUSTOMERS || []).filter((c) => c.saas === product?.id);
  const activeCustomers = productCustomers.length;

  const dueMilestones = productCustomers
    .map((c) => ({ customer: c, m: nextMilestone(c, product) }))
    .filter(({ m }) => m && (m.status === "late" || m.status === "soon"))
    .sort((a, b) => String(a.m.dueAt).localeCompare(String(b.m.dueAt)))
    .slice(0, 3);

  // Sinais extras do "Precisa de atenção", tudo de dado que já existe no
  // cockpit. Parado = 3+ dias sem mudar de etapa e SEM call futura marcada
  // (quem tem call marcada está esperando a call, não esquecido).
  const STALL_DAYS = 3;
  const stalled = (l) => l.stageSince && now - new Date(l.stageSince).getTime() > STALL_DAYS * DAY
    && !(l.callAt && new Date(l.callAt).getTime() > now);
  const openSet = new Set(openStages(product));
  // Negociações paradas = proposta enviada OU pós-call (followup): funil sem
  // etapa de proposta (LeverAds) negocia no Follow-up, então os dois kinds
  // contam. O clique abre o pipeline na primeira etapa dessas.
  const negStages = (product?.funnel || [])
    .map((f) => f.stage)
    .filter((s) => ["proposta", "followup"].includes(stageKind(product, s)));
  const staleProposals = leads.filter((l) => negStages.includes(l.stage) && stalled(l));
  const negStage = negStages[0] || null;
  // Leads quentes (A) parados no MEIO do funil: "novo" já tem o SLA de 1º toque
  // e proposta/follow-up têm o item acima — aqui é o quente esquecido no caminho.
  const staleHot = leads.filter((l) => {
    if (!openSet.has(l.stage)) return false;
    const k = stageKind(product, l.stage);
    if (k === "novo" || k === "proposta" || k === "followup") return false;
    return leadTier(l).grade === "A" && stalled(l);
  });
  // Esperando resposta no WhatsApp = estado ATUAL do inbox (não segue a janela).
  const waAwaiting = wa?.awaiting || 0;
  const fmtWait = (h) => (h >= 48 ? `${Math.round(h / 24)}d` : `${Math.round(h)}h`);

  if (!product) {
    return <EmptyState title="Nenhum produto cadastrado" hint="Crie o produto em Ajustes pra começar a operar o cockpit." />;
  }

  // Clicar num nome do time abre o pipeline filtrado por aquela pessoa (o
  // pipeline lê a pessoa do localStorage; setamos antes de navegar).
  const openPerson = (userId) => {
    try { localStorage.setItem("cockpit_pipeline_person", userId); } catch { /* ignore */ }
    onNav && onNav("pipeline", { saas: product.id });
  };

  const today = new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });
  const slaBreached = (score?.sdr || []).reduce((sum, p) => sum + (Number(p.breached) || 0), 0);

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, overflow: "auto" }}>
      <PageHead title="Visão geral" sub={today}>
        <div style={{ display: "flex", alignItems: "center", gap: 3, flexWrap: "wrap", justifyContent: "flex-end" }}>
          {PRESETS.filter((p) => !["3d", "60d"].includes(p.key)).map((p) => (
            <FilterTab key={p.key} active={period === p.key} onClick={() => setPeriodP(p.key)}>{p.label}</FilterTab>
          ))}
          <FilterTab active={period === "custom"} onClick={() => setPeriodP("custom")}>Personalizado</FilterTab>
          {period === "custom" && (
            <span style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
              <input type="date" value={custom.since} onChange={(e) => setCustomP({ ...custom, since: e.target.value })} style={dateInp} />
              <span className="mono dim" style={{ fontSize: 10 }}>até</span>
              <input type="date" value={custom.until} onChange={(e) => setCustomP({ ...custom, until: e.target.value })} style={dateInp} />
            </span>
          )}
        </div>
      </PageHead>

      <div style={{ padding: "16px var(--pad-x) 56px", display: "flex", flexDirection: "column", gap: 16 }}>
        <PaceStrip pace={pace} onNav={onNav} />

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12 }}>
          <StatTile label="Resultado do mês" value={result != null ? window.fmt.money(result) : "…"}
            delta={costs ? `${window.fmt.money(wonValueMonth)} ganhos · ${window.fmt.money(costs.total || 0)} custos` : "ganhos menos custos"}
            tone={result == null ? "flat" : result >= 0 ? "up" : "down"} />
          <StatTile label="MRR" value={window.fmt.money(product.mrr || 0)} delta={activeCustomers ? "base de " + window.fmt.money(product.arr || 0) + " ARR" : "sem receita ainda"} tone="flat" />
          <StatTile label="Clientes ativos" value={String(activeCustomers)} />
          <StatTile label={`Leads · ${pShort}`} value={String(leadsPeriod)}
            delta={leadsDeltaPct == null ? `${leadsPrev} no ${pShort} anterior` : `${leadsDeltaPct >= 0 ? "↑" : "↓"} ${Math.abs(leadsDeltaPct)}% vs. ${pShort} anterior`}
            tone={leadsDeltaPct == null ? "flat" : leadsDeltaPct >= 0 ? "up" : "down"} />
          <StatTile label={`Custo por lead · ${pShort}`} value={cpl != null ? window.fmt.money(cpl) : "sem gasto"}
            delta={cpl != null ? window.fmt.money(marketing.totals.spend) + " investidos" : "conecte o Meta em Publicidade"} tone="flat" />
          <StatTile label={`ROAS · ${pShort}`} value={roas != null ? String(roas).replace(".", ",") + "x" : "sem receita"}
            delta={roas != null ? "receita ÷ investimento" : "precisa de ganho atribuído"} tone={roas == null ? "flat" : roas >= 1 ? "up" : "down"} />
          <StatTile label={`Lead → cliente · ${pShort}`} value={biz?.window?.convRate != null ? pctStr(biz.window.convRate) : "sem dado"}
            delta={biz?.window?.newCustomers != null ? `${biz.window.newCustomers} ${biz.window.newCustomers === 1 ? "cliente novo" : "clientes novos"}` : null} tone="flat" />
        </div>

        <FunnelConversions team={score?.team} pLabel={pLabel} />

        <TeamPerformance score={score} bizDays={win.businessDays} onPerson={openPerson} />

        <Card title="Precisa de atenção" hint="riscos primeiro · cada item tem ação">
          <div style={{ padding: "10px 24px 18px" }}>
            {slaBreached === 0 && waAwaiting === 0 && staleHot.length === 0 && staleProposals.length === 0 && dueInvoices.length === 0 && dueMilestones.length === 0 && (
              <div style={{ fontSize: 12.5, color: "var(--fg-4)" }}>Tudo em dia por aqui.</div>
            )}
            {slaBreached > 0 && (
              <button onClick={() => onNav && onNav("pipeline", { saas: product.id })} style={{ display: "flex", alignItems: "center", gap: 12, width: "100%", padding: "11px 0", borderBottom: "1px solid var(--line-faint)", textAlign: "left" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600 }}>{slaBreached} {slaBreached === 1 ? "lead fora" : "leads fora"} do SLA de 1º toque</div>
                  <div style={{ fontSize: 12.5, color: "var(--fg-3)", marginTop: 2 }}>Novo lead · nunca contatados além do prazo</div>
                </div>
                <span style={{ fontSize: 12.5, fontWeight: 500, color: "var(--accent)", whiteSpace: "nowrap" }}>abrir pipeline</span>
              </button>
            )}
            {waAwaiting > 0 && (
              <button onClick={() => onNav && onNav("whatsapp")} style={{ display: "flex", alignItems: "center", gap: 12, width: "100%", padding: "11px 0", borderBottom: "1px solid var(--line-faint)", textAlign: "left" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600 }}>{waAwaiting} {waAwaiting === 1 ? "conversa esperando" : "conversas esperando"} resposta no WhatsApp</div>
                  <div style={{ fontSize: 12.5, color: "var(--fg-3)", marginTop: 2 }}>
                    {wa?.oldestWaitHours != null ? `mais antiga há ${fmtWait(wa.oldestWaitHours)} · ` : ""}
                    {wa?.openWindow === 1 ? "1 janela de 24h aberta" : `${wa?.openWindow || 0} janelas de 24h abertas`} · inbox do time
                  </div>
                </div>
                <span style={{ fontSize: 12.5, fontWeight: 500, color: "var(--accent)", whiteSpace: "nowrap" }}>abrir inbox</span>
              </button>
            )}
            {staleHot.length > 0 && (
              <button onClick={() => onNav && onNav("pipeline", { saas: product.id })} style={{ display: "flex", alignItems: "center", gap: 12, width: "100%", padding: "11px 0", borderBottom: "1px solid var(--line-faint)", textAlign: "left" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600 }}>{staleHot.length} {staleHot.length === 1 ? "lead quente (A) parado" : "leads quentes (A) parados"}</div>
                  <div style={{ fontSize: 12.5, color: "var(--fg-3)", marginTop: 2 }}>sem call marcada e sem avançar de etapa há {STALL_DAYS}+ dias</div>
                </div>
                <span style={{ fontSize: 12.5, fontWeight: 500, color: "var(--accent)", whiteSpace: "nowrap" }}>abrir pipeline</span>
              </button>
            )}
            {staleProposals.length > 0 && (
              <button onClick={() => onNav && onNav("pipeline", { saas: product.id, stage: negStage })} style={{ display: "flex", alignItems: "center", gap: 12, width: "100%", padding: "11px 0", borderBottom: "1px solid var(--line-faint)", textAlign: "left" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600 }}>{staleProposals.length} {staleProposals.length === 1 ? "negociação sem resposta" : "negociações sem resposta"}</div>
                  <div style={{ fontSize: 12.5, color: "var(--fg-3)", marginTop: 2 }}>{staleProposals.length === 1 ? "parada" : "paradas"} em {negStages.join(" / ")} há {STALL_DAYS}+ dias · hora do follow-up</div>
                </div>
                <span style={{ fontSize: 12.5, fontWeight: 500, color: "var(--accent)", whiteSpace: "nowrap" }}>fazer follow-up</span>
              </button>
            )}
            {dueMilestones.map(({ customer, m }) => (
              <button key={customer.id + m.key} onClick={() => onNav && onNav("customers")}
                style={{ display: "flex", alignItems: "center", gap: 12, width: "100%", padding: "11px 0", borderBottom: "1px solid var(--line-faint)", textAlign: "left" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600 }}>{m.label}</div>
                  <div style={{ fontSize: 12.5, color: "var(--fg-3)", marginTop: 2 }}>
                    {customer.name} · {m.status === "late" ? "venceu" : "vence"} {dueLabel(m.dueAt)}
                  </div>
                </div>
                <span style={{ fontSize: 12.5, fontWeight: 500, color: "var(--accent)", whiteSpace: "nowrap" }}>agendar</span>
              </button>
            ))}
            {dueInvoices.map((i) => (
              <button key={i.id} onClick={() => onNav && onNav("subscriptions", { saas: product.id })}
                style={{ display: "flex", alignItems: "center", gap: 12, width: "100%", padding: "11px 0", borderBottom: "1px solid var(--line-faint)", textAlign: "left" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600 }}>{i.status === "overdue" ? "Fatura vencida" : "Fatura vencendo"} · {window.fmt.money(i.amount || 0)}</div>
                  <div style={{ fontSize: 12.5, color: "var(--fg-3)", marginTop: 2 }}>
                    {window.fmt.money(i.amount || 0)} · vence {new Date(i.dueDate).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }).replace(".", "")}
                  </div>
                </div>
                <span style={{ fontSize: 12.5, fontWeight: 500, color: "var(--accent)", whiteSpace: "nowrap" }}>{i.status === "overdue" ? "cobrar" : "ver fatura"}</span>
              </button>
            ))}
            <div style={{ marginTop: 10, paddingTop: 12, borderTop: "1px solid var(--line-faint)", display: "flex", gap: 14 }}>
              <button onClick={() => onNav && onNav("customers")} style={{ fontSize: 13, fontWeight: 500, color: "var(--accent)" }}>Ver clientes →</button>
              <button onClick={() => onNav && onNav("subscriptions", { saas: product.id })} style={{ fontSize: 13, fontWeight: 500, color: "var(--accent)" }}>Ver assinaturas →</button>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}

// ── Formato e cor (compartilhados) ───────────────────────────────────────────
// Helpers de número/dinheiro e de cor por saúde das taxas, usados pela faixa de
// conversões do funil (FunnelConversions) e pela Meta do mês (PaceStrip).
const money = (v) => window.fmt.money(v || 0);
const int = (v) => window.fmt.int(v || 0);

// Cor por saúde das TAXAS do SDR (maior = melhor). Cortes padrão abaixo — ajuste
// fácil aqui se o Leo quiser outra régua:
//   taxa de agendamento  bom ≥30%  ok ≥15%
//   % compareceram       bom ≥70%  ok ≥50%
//   calls → ganho        bom ≥25%  ok ≥10%
const rateTone = (pct, good, ok) => (pct == null ? "var(--fg-3)" : pct >= good ? "var(--pos)" : pct >= ok ? "var(--warn)" : "var(--neg)");

// Cortes de cor da taxa: a META (quando configurada em Ajustes → Equipe) vira o
// "bom"; "ok" é 2/3 dela. Sem meta, cai no benchmark padrão do argumento.
const tiers = (goal, fallbackGood) => {
  const good = goal?.target > 0 ? goal.target : fallbackGood;
  return { good, ok: Math.round(good * 0.66) };
};

// ── Desempenho do time ───────────────────────────────────────────────────────
// Os mesmos cartões da tela Análises → Equipe (TeamCards): um "quadradinho" por
// pessoa com as métricas do papel e o progresso vs. meta, aqui embutido na Visão
// geral. Segue o período do topo; clicar num nome abre o pipeline daquela pessoa.
function TeamPerformance({ score, bizDays, onPerson }) {
  const people = buildPeople(score);
  const highlight = topPerformer(people);
  return (
    <Card title="Desempenho do time" hint="segue o período do topo · clique num nome pra abrir o pipeline">
      <div style={{ padding: "8px 24px 24px" }}>
        {score == null && <div className="mono dim" style={{ fontSize: 12 }}>carregando…</div>}
        {score != null && !people.length && <div style={{ fontSize: 12.5, color: "var(--fg-4)" }}>Sem atividade nesse período.</div>}
        {people.length > 0 && <TeamCards people={people} bizDays={bizDays} onPerson={onPerson} highlight={highlight} />}
      </div>
    </Card>
  );
}

// ── Meta do mês (pace de caixa) ──────────────────────────────────────────────
// A manchete da Análise de Pace aqui no topo: "estamos no caminho?". Caixa
// = faturas pagas no mês (mesma conta do /api/pipeline-pace); o desdobramento
// do gap (ganhos → calls → agendamentos → contatos → leads) vem pronto no plan.
const PACE_STATUS = {
  ahead: { label: "no ritmo", tone: "var(--pos)" },
  attention: { label: "quase no ritmo", tone: "var(--warn)" },
  behind: { label: "atrás do ritmo", tone: "var(--neg)" },
};
const PACE_BLOCKED = {
  averageEntry: "sem ticket médio (nenhuma venda registrada e sem meta de ticket)",
  closeRate: "taxa de fechamento zerada no histórico",
  showRate: "comparecimento zerado no histórico",
  bookingRate: "taxa de agendamento zerada no histórico",
  contactRate: "taxa de contato zerada no histórico",
};
const fmtPerDay = (v) => Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 1 });

function PaceStrip({ pace, onNav }) {
  // A meta mede o VENDIDO no mês (contrato cheio, bloco `sale` do pace) —
  // decisão do Leo em 20/07; caixa e dinheiro futuro moram na aba Clientes.
  const c = pace?.sale;
  if (!c) return null;
  const st = PACE_STATUS[c.status] || PACE_STATUS.attention;
  const done = (c.gap || 0) === 0;
  const pct = Math.min(100, Math.round((c.progress || 0) * 100));
  const expPct = Math.min(100, Math.round((c.expectedProgress || 0) * 100));
  const plan = pace.plan || {};
  const steps = [
    { key: "wins", label: "ganhos" },
    { key: "calls", label: "calls" },
    { key: "callsBooked", label: "agendamentos" },
    { key: "contacts", label: "contatos" },
    { key: "leads", label: "leads" },
  ].map((s) => ({ ...s, ...(plan[s.key] || {}) }));
  const havePlan = steps.some((s) => s.remaining != null);
  return (
    <Card title="Meta do mês" hint="vendido no mês, contrato cheio · caixa e dinheiro futuro na aba Clientes">
      <div style={{ padding: "4px 24px 20px", display: "flex", flexWrap: "wrap", gap: "16px 36px", alignItems: "flex-start" }}>
        <div style={{ flex: "1 1 320px", minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
            <span className="tnum" style={{ fontFamily: "var(--display)", fontSize: 27, fontWeight: 700 }}>{money(c.sold)}</span>
            <span style={{ fontSize: 13, color: "var(--fg-3)" }}>de {money(c.target)} · {pct}%</span>
            <span style={{ fontSize: 11, fontWeight: 700, color: st.tone, border: `1px solid color-mix(in srgb, ${st.tone} 40%, transparent)`, background: `color-mix(in srgb, ${st.tone} 10%, transparent)`, borderRadius: 999, padding: "2px 9px", whiteSpace: "nowrap" }}>
              {done ? "meta batida" : st.label}
            </span>
          </div>
          <div title={`esperado até hoje: ${money(c.expectedToDate)} (${expPct}%)`}
            style={{ position: "relative", height: 8, borderRadius: 999, background: "var(--bg-3)", margin: "10px 0 8px", overflow: "hidden" }}>
            <span style={{ position: "absolute", inset: 0, width: `${pct}%`, borderRadius: 999, background: done ? "var(--pos)" : "var(--accent)" }} />
            <span style={{ position: "absolute", top: 0, bottom: 0, left: `${expPct}%`, width: 2, background: "var(--fg-2)", opacity: 0.65 }} />
          </div>
          <div style={{ fontSize: 12, color: "var(--fg-3)" }}>
            hoje {money(c.soldToday)} vendidos · ritmo {money(c.actualDailyPace)}/dia útil
            {c.requiredDailyPace != null ? ` · precisa ${money(c.requiredDailyPace)}/dia` : ""} · {int(c.remainingBusinessDays)} dias úteis restantes
          </div>
          {c.targetConfigured === false && (
            <button onClick={() => onNav && onNav("metas")} style={{ marginTop: 6, fontSize: 12, fontWeight: 600, color: "var(--warn)", textAlign: "left" }}>
              essa é a meta padrão do sistema · defina a sua em Metas → Empresa
            </button>
          )}
        </div>
        <div style={{ flex: "1 1 340px", minWidth: 0 }}>
          <div style={{ fontSize: 12.5, marginBottom: 10 }}>
            <span style={{ color: "var(--fg-3)" }}>projeção do mês </span>
            <b className="tnum">{money(c.projected)}</b>
            <button onClick={() => onNav && onNav("customers")} style={{ marginLeft: 12, fontSize: 12, fontWeight: 500, color: "var(--accent)" }}>caixa e dinheiro futuro → Clientes</button>
          </div>
          {done && <div style={{ fontSize: 12.5, color: "var(--pos)", fontWeight: 600 }}>Meta do mês batida.</div>}
          {!done && havePlan && (
            <>
              <div className="mono" style={{ fontSize: 9.5, letterSpacing: "0.07em", textTransform: "uppercase", color: "var(--fg-4)", marginBottom: 6 }}>Pra bater a meta faltam</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {steps.map((s) => (
                  <span key={s.key} title={s.perDay != null ? `${fmtPerDay(s.perDay)}/dia útil · hoje: ${int(s.today || 0)}` : undefined}
                    style={{ fontSize: 11.5, border: "1px solid var(--line-2)", background: "var(--bg-inset)", borderRadius: 999, padding: "3px 10px", whiteSpace: "nowrap" }}>
                    <b className="tnum">{s.remaining != null ? int(s.remaining) : "—"}</b> {s.label}
                    {s.perDay != null && <span className="dim"> · {fmtPerDay(s.perDay)}/dia</span>}
                  </span>
                ))}
              </div>
            </>
          )}
          {!done && !havePlan && (
            <div style={{ fontSize: 12, color: "var(--fg-4)" }}>
              não dá pra desdobrar a meta ainda: {PACE_BLOCKED[plan.blockedBy] || "sem histórico suficiente"}.
            </div>
          )}
          <button onClick={() => onNav && onNav("analise")} style={{ marginTop: 10, fontSize: 13, fontWeight: 500, color: "var(--accent)" }}>Ver análise completa →</button>
        </div>
      </div>
    </Card>
  );
}

// ── Conversões do funil (time inteiro) ───────────────────────────────────────
// A régua que o Leo pediu: contatados → call agendada → realizada → ganho, com
// a taxa entre cada etapa colorida pela meta do papel (Metas) ou benchmark.
// Números = leads DISTINTOS do produto na janela do topo (bloco `team` do
// /api/scoreboard); o recorte por pessoa fica no Desempenho do time.
function StepBox({ value, label, sub }) {
  return (
    <div style={{ flex: "1 1 108px", minWidth: 104, padding: "10px 12px", textAlign: "center", borderRadius: "var(--r-3)", background: "var(--bg-inset)", border: "1px solid var(--line-1)" }}>
      <div className="tnum" style={{ fontFamily: "var(--display)", fontSize: 20, fontWeight: 700 }}>{int(value)}</div>
      <div style={{ fontSize: 11.5, color: "var(--fg-3)" }}>{label}</div>
      {sub && <div className="mono" style={{ fontSize: 9.5, color: "var(--fg-4)", marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function StepRate({ pct, label, num, den, good, ok }) {
  return (
    <div title={num != null && den != null ? `${int(num)} de ${int(den)}` : undefined}
      style={{ flex: "0 0 auto", alignSelf: "center", textAlign: "center", padding: "0 2px", minWidth: 86 }}>
      <div className="tnum" style={{ fontSize: 14.5, fontWeight: 700, color: pct == null ? "var(--fg-4)" : rateTone(pct, good, ok) }}>
        {pct == null ? "—" : pctStr(pct)}
      </div>
      <div className="mono" style={{ fontSize: 9, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--fg-4)", whiteSpace: "nowrap" }}>{label}</div>
      <div style={{ fontSize: 14, lineHeight: 1.1, color: "var(--fg-4)" }}>→</div>
    </div>
  );
}

function FunnelConversions({ team, pLabel }) {
  const cw = team ? tiers(team.goals?.callWinRate, 25) : null;
  return (
    <Card title="Conversões do funil" hint={`${pLabel} · time inteiro · taxa colorida pela meta (Metas) ou benchmark`}>
      <div style={{ padding: "6px 24px 18px" }}>
        {team == null && <div className="mono dim" style={{ fontSize: 12 }}>carregando…</div>}
        {team != null && (
          <>
            {team.paceAdjust && (
              <div style={{ marginBottom: 12, padding: "8px 12px", borderRadius: "var(--r-2)", background: "var(--bg-inset)", border: "1px solid var(--line-1)", fontSize: 11.5, color: "var(--fg-3)" }}>
                <b>Inclui histórico pré-cockpit</b> (dados reais de antes do registro):{" "}
                {[
                  team.paceAdjust.leads && `+${team.paceAdjust.leads} leads`,
                  team.paceAdjust.contacted && `+${team.paceAdjust.contacted} contatos`,
                  team.paceAdjust.booked && `+${team.paceAdjust.booked} agendadas`,
                  team.paceAdjust.shown && `+${team.paceAdjust.shown} comparecimentos`,
                  team.paceAdjust.won && `+${team.paceAdjust.won} ganhos`,
                ].filter(Boolean).join(" · ")}.
              </div>
            )}
            <div className="tbl-x">
              <div style={{ display: "flex", gap: 8, alignItems: "stretch", minWidth: 640 }}>
                <StepBox value={team.contacted} label="Contatados" sub={`${int(team.leadsNew)} leads novos`} />
                <StepRate pct={team.bookingRate} label="agendamento" num={team.callsBooked} den={team.contacted} {...tiers(team.goals?.bookingRate, 30)} />
                <StepBox value={team.callsBooked} label="Calls agendadas" />
                <StepRate pct={team.showRate} label="comparecimento" num={team.shown} den={team.callsBooked} {...tiers(team.goals?.showRate, 70)} />
                <StepBox value={team.shown} label="Calls realizadas" sub={team.noShow > 0 ? `${int(team.noShow)} no-show` : null} />
                <StepRate pct={team.closeRate} label="fechamento" num={team.wonFromCalls} den={team.shown} {...tiers(team.goals?.closeRate, 40)} />
                <StepBox value={team.wonFromCalls} label="Ganhos da safra" sub="das calls do período" />
              </div>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 18px", marginTop: 12, fontSize: 12.5 }}>
              <span title="da safra de calls agendadas no período, quantas já fecharam (inclui no-show no denominador)">
                <span style={{ color: "var(--fg-3)" }}>Call agendada → ganho </span>
                <b className="tnum" style={{ color: team.callWinRate == null ? "var(--fg-4)" : rateTone(team.callWinRate, cw.good, cw.ok) }}>
                  {team.callWinRate == null ? "—" : pctStr(team.callWinRate)}
                </b>
              </span>
              <span title="ganhos do período ÷ leads criados no período (as safras se misturam: o ganho de hoje costuma ser lead de semanas atrás)">
                <span style={{ color: "var(--fg-3)" }}>Lead → ganho </span>
                <b className="tnum">{team.leadToWin == null ? "—" : pctStr(team.leadToWin)}</b>
              </span>
              <span title="fechamentos no período (transição pra integração/ganho), independente de quando a call foi marcada">
                <span style={{ color: "var(--fg-3)" }}>Ganhos no período </span>
                <b className="tnum">{int(team.won)}</b>
                {team.revenue > 0 && <span style={{ color: "var(--fg-4)" }}> · {money(team.revenue)}</span>}
              </span>
            </div>
          </>
        )}
      </div>
    </Card>
  );
}

export { OverviewScreen, TeamPerformance, PaceStrip, FunnelConversions, periodWindow, PRESETS };
