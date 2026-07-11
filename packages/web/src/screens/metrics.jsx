import React from "react";
import { api } from "../lib/api.js";
import { useData } from "../data.jsx";
import { PageHead, Segmented, StatTile, Card, LineChart } from "../components/viz.jsx";
import { SaasTabs } from "../components/saas-tabs.jsx";
import { EmptyState } from "../atoms.jsx";
import { stageKind } from "../lib/funnel.js";
// Métricas — aquisição × funil do produto ativo (substitui a tela Marketing).
// Hoje: investimento (Meta), leads, CPL real e custo por etapa, com séries no
// tempo e quebra por campanha. CAC e LTV entram na fase de métricas de receita,
// nesta mesma tela.

const { useState, useEffect } = React;

const DAY = 86_400_000;
const dayStr = (t) => new Date(t).toISOString().slice(0, 10);
const shortDay = (iso) => new Date(iso + "T12:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }).replace(".", "");

// Dinheiro COM CENTAVOS (pedido do Leo, padrão do Gerenciador da Meta) — vale
// pra tiles, tabelas e cards da tela; só os eixos dos gráficos ficam compactos.
const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const money = (v) => BRL.format(Number(v) || 0);

const PERIODS = [
  { value: "3", label: "3 dias" },
  { value: "7", label: "7 dias" },
  { value: "30", label: "30 dias" },
  { value: "life", label: "lifetime" },
];
// A Meta só devolve insights de até ~37 meses; o sync respeita esse teto.
const META_LOOKBACK_DAYS = 1125;

// Contêiner com rolagem horizontal por ARRASTO (a tabela unificada é larga).
// Clique em linha/controle continua funcionando: só vira arrasto depois de
// mover alguns pixels, e aí o click seguinte é engolido pra não expandir linha.
function DragScroll({ children }) {
  const ref = React.useRef(null);
  const drag = React.useRef(null);
  const moved = React.useRef(false);
  const onDown = (e) => {
    if (e.button !== 0 || e.target.closest("input,button,select,textarea,a")) return;
    drag.current = { x: e.clientX, left: ref.current.scrollLeft };
    moved.current = false;
  };
  const onMove = (e) => {
    if (!drag.current) return;
    const dx = e.clientX - drag.current.x;
    if (Math.abs(dx) > 4) {
      moved.current = true;
      ref.current.style.cursor = "grabbing";
      ref.current.style.userSelect = "none";
    }
    ref.current.scrollLeft = drag.current.left - dx;
  };
  const end = () => {
    drag.current = null;
    if (ref.current) { ref.current.style.cursor = ""; ref.current.style.userSelect = ""; }
  };
  const onClickCapture = (e) => {
    if (moved.current) { e.stopPropagation(); e.preventDefault(); moved.current = false; }
  };
  return (
    <div ref={ref} className="tbl-x" style={{ marginTop: 10 }}
      onMouseDown={onDown} onMouseMove={onMove} onMouseUp={end} onMouseLeave={end} onClickCapture={onClickCapture}>
      {children}
    </div>
  );
}

// Range efetivo do filtro: preset relativo, lifetime ou intervalo custom
// (de/até no mesmo dia = filtro de um dia específico).
function rangeOf(r) {
  const today = dayStr(Date.now());
  if (r.preset === "custom") {
    const since = r.since || today;
    const until = r.until || today;
    return since <= until ? { since, until } : { since: until, until: since };
  }
  if (r.preset === "life") return { since: "2020-01-01", until: today };
  const n = Number(r.preset) || 30;
  return { since: dayStr(Date.now() - (n - 1) * DAY), until: today };
}

function MetricsScreen() {
  const { SAAS, CONFIG } = window.SEED;
  const { version } = useData();
  const [activeSaas, setActiveSaas] = useState(null);
  const product = SAAS.find((s) => s.id === activeSaas) || SAAS[0];
  const metaOn = !!CONFIG?.meta?.configured;

  const [range, setRange] = useState({ preset: "30" });
  const { since, until } = rangeOf(range);
  const rangeDays = Math.max(1, Math.round((new Date(until) - new Date(since)) / DAY) + 1);
  const [data, setData] = useState(null);
  const [biz, setBiz] = useState(null); // CAC/LTV + série mensal
  const [syncing, setSyncing] = useState(false);
  const [note, setNote] = useState(null);

  const [objects, setObjects] = useState(null); // { campaigns, adsets, ads } ao vivo (gerenciamento)
  const [creative, setCreative] = useState(false); // painel de novo criativo

  // reset=true (troca de range/produto): zera a tela e recarrega TUDO, inclusive
  // a lista viva de campanhas. Silencioso (SSE/tick): só métricas + CAC — nada
  // de bater na Graph a cada lead movido por alguém do time.
  const load = (reset = true) => {
    if (!product) return;
    if (reset) setData(null);
    api.marketingMetrics(product.id, { since, until }).then(setData).catch(() => setData({ error: true }));
    api.metrics(product.id, { days: rangeDays, months: 12 }).then(setBiz).catch(() => setBiz(null));
    if (reset && metaOn && product.metaAdAccount) {
      api.adObjects(product.id).then(setObjects).catch((e) => setObjects({ error: e.message }));
    }
  };
  useEffect(() => load(true), [product?.id, since, until]); // eslint-disable-line react-hooks/exhaustive-deps
  // Mudança vinda do tempo real (SSE: lead criado/movido, sync do servidor)
  // recarrega SEM piscar — os números acompanham o pipeline na hora.
  const firstVersion = React.useRef(version);
  useEffect(() => {
    if (version !== firstVersion.current) load(false);
  }, [version]); // eslint-disable-line react-hooks/exhaustive-deps

  // O sync da Meta roda no SERVIDOR (1 execução pro time, a cada ~3 min); aqui
  // só um refresh leve por minuto pra manter o relógio do "ao vivo" em dia
  // mesmo quando nada mudou (mudança de verdade já chega via SSE).
  useEffect(() => {
    if (!metaOn || !product?.metaAdAccount) return;
    const id = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      api.marketingMetrics(product.id, { since, until }).then(setData).catch(() => { /* próximo tick */ });
    }, 60_000);
    return () => clearInterval(id);
  }, [product?.id, since, until, metaOn]); // eslint-disable-line react-hooks/exhaustive-deps
  const liveAt = data?.syncedAt ? new Date(data.syncedAt) : null;

  // Toggle Off/On e orçamento em QUALQUER nível — sem confirmação, como no
  // Gerenciador: otimista aqui, reverte se a Meta recusar.
  const LEVEL_LABEL = { campaigns: "Campanha", adsets: "Conjunto", ads: "Anúncio" };
  function patchObject(level, id, patch) {
    setObjects((prev) => (prev && !prev.error
      ? { ...prev, [level]: (prev[level] || []).map((x) => (x.id === id ? { ...x, ...patch } : x)) }
      : prev));
  }
  // Efetivo REAL ao ativar: pai pausado segura a entrega (a bolinha não pode
  // ficar verde só porque o status próprio virou ACTIVE).
  function effOnActivate(level, o) {
    const camp = (objects?.campaigns || []).find((c) => String(c.id) === String(o.campaignId));
    if (camp && camp.status === "PAUSED") return "CAMPAIGN_PAUSED";
    if (level === "ads") {
      const set = (objects?.adsets || []).find((s) => String(s.id) === String(o.adsetId));
      if (set && set.status === "PAUSED") return "ADSET_PAUSED";
    }
    return "ACTIVE";
  }
  // Pausa herdada nos FILHOS quando pausa campanha/conjunto (e o inverso ao
  // reativar) — a tela não pode mostrar filho "ativo" de pai pausado.
  function cascadeStatus(level, o, target) {
    setObjects((prev) => {
      if (!prev || prev.error) return prev;
      const inherit = level === "campaigns" ? "CAMPAIGN_PAUSED" : "ADSET_PAUSED";
      const isChild = (x) => (level === "campaigns" ? String(x.campaignId) === String(o.id) : String(x.adsetId) === String(o.id));
      const apply = (x) => {
        if (!isChild(x)) return x;
        if (target === "PAUSED") return x.effectiveStatus === "ACTIVE" ? { ...x, effectiveStatus: inherit } : x;
        return x.effectiveStatus === inherit && x.status !== "PAUSED" ? { ...x, effectiveStatus: "ACTIVE" } : x;
      };
      return {
        ...prev,
        adsets: level === "campaigns" ? (prev.adsets || []).map(apply) : prev.adsets,
        ads: (prev.ads || []).map(apply),
      };
    });
  }
  // Ids com chamada em voo — o toggle mostra estado "enviando" em vez de fingir
  // que já aplicou (a confirmação de verdade vem da resposta da Meta).
  const [busyIds, setBusyIds] = useState(() => new Set());
  const markBusy = (id, on) => setBusyIds((prev) => { const n = new Set(prev); if (on) n.add(id); else n.delete(id); return n; });
  async function toggleObject(level, o) {
    if (busyIds.has(o.id)) return;
    const target = o.status === "PAUSED" ? "ACTIVE" : "PAUSED";
    patchObject(level, o.id, { status: target, effectiveStatus: target === "PAUSED" ? "PAUSED" : effOnActivate(level, o) });
    if (level !== "ads") cascadeStatus(level, o, target);
    markBusy(o.id, true);
    try {
      await api.metaObjectStatus(o.id, target);
      setNote({ ok: true, text: `${LEVEL_LABEL[level]} "${o.name}" ${target === "PAUSED" ? "pausado(a)" : "ativado(a)"} na Meta ✓` });
      // Verdade da Meta em seguida (efetivo herdado, revisão, etc.) — sem piscar.
      api.adObjects(product.id).then(setObjects).catch(() => { /* otimista já aplicado */ });
    } catch (e) {
      patchObject(level, o.id, { status: o.status, effectiveStatus: o.effectiveStatus });
      if (level !== "ads") cascadeStatus(level, o, o.status === "PAUSED" ? "PAUSED" : "ACTIVE");
      setNote({ ok: false, text: `NÃO aplicado na Meta: ${e.message || "falha desconhecida"}` });
    } finally {
      markBusy(o.id, false);
    }
  }
  // Orçamento: quem confirma é o BudgetCell (dirty → enviando → aplicado no
  // Gerenciador / erro com revert). Aqui só a chamada + patch com o valor
  // normalizado; lança pro cell mostrar o erro, e a note carrega a msg da Meta.
  async function commitBudget(level, o, v) {
    try {
      const r = await api.metaObjectBudget(o.id, v);
      const applied = r?.dailyBudget ?? v;
      patchObject(level, o.id, { dailyBudget: applied });
      return applied;
    } catch (e) {
      setNote({ ok: false, text: `Orçamento de "${o.name}" NÃO aplicado na Meta: ${e.message || "falha desconhecida"}` });
      throw e;
    }
  }

  // Premissa de permanência (meses) usada no LTV — editável aqui mesmo.
  async function saveLtvMonths(v) {
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) return;
    try { await api.update("products", product.id, { ltvMonths: n }); load(); } catch { /* fail-open */ }
  }

  // Entrada manual de gasto (alternativa/complemento ao sync da Meta): vira uma
  // linha em ad_insights, então soma nas mesmas métricas e séries.
  const [manual, setManual] = useState(null); // { date, name, spend }
  async function saveManual() {
    const spend = Number(manual?.spend);
    if (!manual?.date || !Number.isFinite(spend) || spend <= 0) { setNote({ ok: false, text: "Preencha data e valor do gasto." }); return; }
    const name = (manual.name || "").trim() || "Entrada manual";
    const campaignId = "manual_" + name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "_").slice(0, 40);
    try {
      await api.create("ad_insights", { saas: product.id, campaignId, campaignName: name, date: manual.date, spend, impressions: 0, clicks: 0, metaLeads: 0 });
      setManual(null); setNote({ ok: true, text: "Gasto registrado." });
      load();
    } catch (e) { setNote({ ok: false, text: e.message || "Falha ao registrar gasto." }); }
  }

  // Sincroniza o PERÍODO filtrado (mínimo 90 dias, teto de ~37 meses da Meta) —
  // filtrar um range antigo e sincronizar puxa aquele histórico sob demanda.
  async function sync() {
    setSyncing(true); setNote(null);
    const floor = dayStr(Date.now() - META_LOOKBACK_DAYS * DAY);
    const def = dayStr(Date.now() - 89 * DAY);
    const syncSince = [since < def ? since : def, floor].sort()[1]; // max(min(since, 90d), teto)
    try {
      await api.marketingSync({ saas: product.id, since: syncSince, until });
      setNote({ ok: true, text: `Gasto sincronizado da Meta (${syncSince} a ${until}).` });
      load();
    } catch (e) {
      setNote({ ok: false, text: e.message || "Falha ao sincronizar." });
    }
    setSyncing(false);
  }

  if (!product) return <EmptyState title="Nenhum produto cadastrado" hint="Crie o produto em Ajustes pra acompanhar as métricas." />;

  const t = data && !data.error ? data.totals : null;
  const perStage = data && !data.error ? data.perStage : [];
  // Custo por etapa só nos MARCOS do funil: entrada (leads + CPL, que moravam
  // nos tiles) → call → proposta → integração → ganho. As etapas de cadência
  // (contato/qualificação/follow-up) repetem os vizinhos e não orientam verba.
  const MILESTONE_KINDS = new Set(["call", "proposta", "integracao", "ganho"]);
  const milestones = perStage.filter((s, i) => i === 0 || MILESTONE_KINDS.has(stageKind(product, s.stage)));

  const spendSeries = (data?.series || []).map((d) => ({ x: shortDay(d.date), v: d.spend }));
  const leadSeries = (data?.series || []).map((d) => ({ x: shortDay(d.date), v: d.leads }));

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, overflow: "auto" }}>
      <PageHead title="Publicidade" sub={`aquisição, funil e campanhas · ${product.name}`}>
        <SaasTabs active={product.id} onSelect={setActiveSaas} />
        {metaOn && product.metaAdAccount && (
          <button onClick={() => setCreative((v) => !v)}
            style={{ padding: "6px 12px", borderRadius: "var(--r-1)", fontSize: 12.5, fontWeight: 600, background: "var(--accent)", color: "var(--accent-fg)" }}>
            + criativo
          </button>
        )}
        <button onClick={() => setManual(manual ? null : { date: new Date().toISOString().slice(0, 10), name: "", spend: "" })}
          style={{ padding: "6px 12px", borderRadius: "var(--r-1)", fontSize: 12.5, fontWeight: 500, border: "1px solid var(--line-2)", background: "var(--bg-1)", color: "var(--fg-2)" }}>
          + gasto manual
        </button>
        {metaOn && (
          <button onClick={sync} disabled={syncing} style={{ padding: "6px 12px", borderRadius: "var(--r-1)", fontSize: 12.5, fontWeight: 500, border: "1px solid var(--line-2)", background: "var(--bg-1)", color: "var(--fg-2)", opacity: syncing ? 0.6 : 1 }}
            title="Sincroniza o período filtrado agora (além do automático de 1 em 1 minuto)">
            {syncing ? "Sincronizando…" : "↻ sincronizar Meta"}
          </button>
        )}
        {liveAt && (
          <span className="mono" title="Sync automático no servidor a cada ~3 min (último horário mostrado); leads chegam na hora via tempo real"
            style={{ fontSize: 10.5, color: "var(--pos)", display: "inline-flex", alignItems: "center", gap: 4 }}>
            <span style={{ width: 6, height: 6, borderRadius: 99, background: "var(--pos)" }} />
            ao vivo · {liveAt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
          </span>
        )}
        <Segmented value={range.preset} options={PERIODS} onChange={(v) => setRange({ preset: v })} />
        <div style={{ display: "flex", gap: 4, alignItems: "center" }} title="Intervalo específico (de/até no mesmo dia filtra um dia só)">
          <input type="date" value={since} max={until}
            onChange={(e) => e.target.value && setRange({ preset: "custom", since: e.target.value, until })}
            style={{ height: 28, padding: "0 6px", borderRadius: "var(--r-1)", border: range.preset === "custom" ? "1px solid var(--accent)" : "1px solid var(--line-2)", background: "var(--bg-1)", color: "var(--fg-1)", fontSize: 11.5, fontFamily: "var(--mono)" }} />
          <span className="mono dim" style={{ fontSize: 10 }}>até</span>
          <input type="date" value={until} max={dayStr(Date.now())}
            onChange={(e) => e.target.value && setRange({ preset: "custom", since, until: e.target.value })}
            style={{ height: 28, padding: "0 6px", borderRadius: "var(--r-1)", border: range.preset === "custom" ? "1px solid var(--accent)" : "1px solid var(--line-2)", background: "var(--bg-1)", color: "var(--fg-1)", fontSize: 11.5, fontFamily: "var(--mono)" }} />
        </div>
      </PageHead>

      <div style={{ padding: "20px var(--pad-x) 40px", display: "flex", flexDirection: "column", gap: 12 }}>
        {note && (
          <div className="mono" style={{ fontSize: 12, color: note.ok ? "var(--pos)" : "var(--neg)" }}>{note.text}</div>
        )}

        {creative && (
          <NewCreativePanel product={product} campaigns={objects && !objects.error ? objects.campaigns : []}
            onDone={(msg) => { setNote({ ok: true, text: msg }); setCreative(false); load(); }}
            onError={(msg) => setNote({ ok: false, text: msg })}
            onClose={() => setCreative(false)} />
        )}

        {manual && (
          <Card>
            <div style={{ padding: "14px 16px", display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
              <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span className="mono" style={{ fontSize: 10.5, letterSpacing: "0.07em", textTransform: "uppercase", color: "var(--fg-3)" }}>Data</span>
                <input type="date" value={manual.date} onChange={(e) => setManual({ ...manual, date: e.target.value })}
                  style={{ height: 30, padding: "0 8px", borderRadius: "var(--r-1)", border: "1px solid var(--line-2)", background: "var(--bg-1)", color: "var(--fg-1)", fontSize: 12.5, fontFamily: "var(--mono)" }} />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1, minWidth: 180 }}>
                <span className="mono" style={{ fontSize: 10.5, letterSpacing: "0.07em", textTransform: "uppercase", color: "var(--fg-3)" }}>Campanha (opcional)</span>
                <input type="text" placeholder="Entrada manual" value={manual.name} onChange={(e) => setManual({ ...manual, name: e.target.value })}
                  style={{ height: 30, padding: "0 10px", borderRadius: "var(--r-1)", border: "1px solid var(--line-2)", background: "var(--bg-1)", color: "var(--fg-1)", fontSize: 13 }} />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span className="mono" style={{ fontSize: 10.5, letterSpacing: "0.07em", textTransform: "uppercase", color: "var(--fg-3)" }}>Gasto (R$)</span>
                <input type="number" min="0" step="0.01" placeholder="0,00" value={manual.spend} onChange={(e) => setManual({ ...manual, spend: e.target.value })}
                  style={{ width: 120, height: 30, padding: "0 8px", borderRadius: "var(--r-1)", border: "1px solid var(--line-2)", background: "var(--bg-1)", color: "var(--fg-1)", fontSize: 12.5, fontFamily: "var(--mono)", textAlign: "right" }} />
              </label>
              <button onClick={saveManual} style={{ height: 30, padding: "0 14px", borderRadius: "var(--r-1)", background: "var(--accent)", color: "var(--accent-fg)", fontSize: 13, fontWeight: 600 }}>Registrar</button>
              <button onClick={() => setManual(null)} style={{ height: 30, padding: "0 10px", fontSize: 12.5, color: "var(--fg-3)" }}>cancelar</button>
            </div>
          </Card>
        )}

        {data && !data.error && !data.synced && (
          <Card>
            <div style={{ padding: "16px 18px", display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: 260 }}>
                <div style={{ fontFamily: "var(--display)", fontSize: 15, fontWeight: 700 }}>Sem dados de anúncio no período</div>
                <div style={{ fontSize: 13, color: "var(--fg-3)", marginTop: 4, lineHeight: 1.55 }}>
                  {metaOn
                    ? "A integração com a Meta está ativa. Configure a conta de anúncio do produto em Ajustes (Integrações) e sincronize."
                    : "Conecte a Meta (variável META_ACCESS_TOKEN na API + conta de anúncio em Ajustes) ou aguarde a entrada manual de gasto, que chega na fase de marketing."}
                </div>
              </div>
              {metaOn && (
                <button onClick={sync} disabled={syncing} style={{ padding: "8px 14px", borderRadius: "var(--r-1)", fontSize: 13, fontWeight: 600, background: "var(--accent)", color: "var(--accent-fg)", opacity: syncing ? 0.6 : 1 }}>
                  {syncing ? "Sincronizando…" : "Sincronizar agora"}
                </button>
              )}
            </div>
          </Card>
        )}

        {/* Uma fileira só — leads e custo por lead moram no card de custo por
            etapa (marco de entrada do funil). */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12 }}>
          <StatTile label="Investimento" value={t ? money(t.spend) : "…"} delta={t?.ctr != null ? `CTR ${String(t.ctr).replace(".", ",")}%` : null} />
          <StatTile label="Lead → cliente" value={biz?.window?.convRate != null ? `${String(biz.window.convRate).replace(".", ",")}%` : "sem dado"}
            delta="conversão no período" />
          <StatTile label={`CAC · ${rangeDays}d`} value={biz?.window?.cac != null ? money(biz.window.cac) : "sem dado"}
            delta={biz?.window?.newCustomers != null ? `${biz.window.newCustomers} ${biz.window.newCustomers === 1 ? "cliente novo" : "clientes novos"}` : null} />
          <StatTile label="LTV estimado" value={biz?.ltv?.value != null ? money(biz.ltv.value) : "sem dado"}
            delta={biz?.ltv?.ticket != null ? `ticket ${money(biz.ltv.ticket)} × ${biz.ltv.months}m` : "precisa de assinaturas ativas"} />
          <StatTile label="LTV / CAC" value={biz?.ltv?.ltvCac != null ? window.fmt.ratio(biz.ltv.ltvCac) : "sem dado"}
            delta={biz?.ltv?.ltvCac != null ? (biz.ltv.ltvCac >= 3 ? "saudável acima de 3x" : "abaixo do saudável (3x)") : null}
            tone={biz?.ltv?.ltvCac != null ? (biz.ltv.ltvCac >= 3 ? "up" : "down") : "flat"} />
        </div>

        <div className="resp-cols" style={{ "--cols": "1fr 1fr", gap: 12 }}>
          <Card title="Investimento por dia" hint="Meta Ads">
            <LineChart data={spendSeries} color="var(--chart-1)" fmtValue={(v) => window.fmt.money(v)} />
          </Card>
          <Card title="Leads por dia" hint="criados no cockpit">
            <LineChart data={leadSeries} color="var(--chart-2)" fmtValue={(v) => String(Math.round(v))} />
          </Card>
        </div>

        {milestones.length > 0 && t?.spend > 0 && (
          <Card title="Custo por etapa do funil" hint="investimento dividido pelos leads que chegaram em cada marco · % = quantos dos leads do período chegaram até ali">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 8, padding: "12px 16px 16px" }}>
              {milestones.map((s, i) => {
                // Conversão sobre o TOTAL de leads (marco de entrada), não sobre
                // o marco anterior — "quantos % dos leads viram call/ganho".
                const total = milestones[0]?.count || 0;
                const conv = i > 0 && total > 0 ? Math.round((s.count / total) * 1000) / 10 : null;
                return (
                  <div key={s.stage} style={{ border: "1px solid var(--line-1)", borderRadius: "var(--r-2)", padding: "9px 11px", background: "var(--bg-inset)" }}>
                    <span style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 6 }}>
                      <span className="tnum" style={{ fontFamily: "var(--display)", fontSize: 18, fontWeight: 700 }}>
                        {s.costPer != null ? money(s.costPer) : "sem lead"}
                      </span>
                      {conv != null && (
                        <span className="mono" title={`${s.count} de ${total} leads chegaram em ${s.stage}`}
                          style={{ fontSize: 11, fontWeight: 600, color: "var(--fg-3)" }}>
                          {String(conv).replace(".", ",")}%
                        </span>
                      )}
                    </span>
                    <span style={{ fontSize: 11.5, color: "var(--fg-3)", display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {s.stage} · {s.count}
                    </span>
                    {i === 0 && t?.metaLeads > 0 && (
                      <span className="mono" style={{ fontSize: 10.5, color: "var(--fg-4)", display: "block", marginTop: 2 }}
                        title={t?.cplMeta != null ? `CPL na visão da Meta: ${money(t.cplMeta)}` : undefined}>
                        {t.metaLeads} na visão da Meta{t?.cplMeta != null ? ` · ${money(t.cplMeta)}` : ""}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </Card>
        )}

        {data && !data.error && (data.pains || []).some((p) => p.code) && (
          <Card title="Por dor" hint="código [X] no nome do anúncio · qual roteiro traz lead que fecha, não só lead barato">
            <PainTable pains={data.pains} money={money} />
          </Card>
        )}

        {/* Sem Meta conectada, a visão por campanha vem só do ad_insights (gasto manual/histórico). */}
        {data && !data.error && data.campaigns?.length > 0 && !(metaOn && product.metaAdAccount) && (
          <Card title="Por campanha" hint="expanda pra ver conjuntos e anúncios · atribuição por UTM (campaign/term/content = id ou nome)">
            <CampaignDrilldown data={data} money={money} />
          </Card>
        )}

        {metaOn && product.metaAdAccount && (
          <Card title="Anúncios" hint="estilo Gerenciador: abas por nível, toggle pra pausar, clique no nome pra descer de nível · métricas do período filtrado">
            {objects == null && <div style={{ padding: "12px 16px", fontSize: 12.5, color: "var(--fg-4)" }}>carregando conta de anúncios…</div>}
            {objects?.error && <div className="mono" style={{ padding: "12px 16px", fontSize: 12, color: "var(--neg)" }}>{objects.error}</div>}
            {objects?.errors && (
              <div className="mono" style={{ padding: "8px 16px 0", fontSize: 11, color: "var(--warn)" }}>
                a Meta falhou ao listar: {Object.keys(objects.errors).map((k) => ({ campaigns: "campanhas", adsets: "conjuntos", ads: "anúncios" })[k] || k).join(", ")} · tente recarregar
              </div>
            )}
            {objects && !objects.error && (
              <AdsManager objects={objects} money={money} busyIds={busyIds}
                metrics={data && !data.error ? {
                  campaigns: Object.fromEntries((data.campaigns || []).map((g) => [String(g.id), g])),
                  adsets: Object.fromEntries((data.adsets || []).map((g) => [String(g.id), g])),
                  ads: Object.fromEntries((data.ads || []).map((g) => [String(g.id), g])),
                } : null}
                onToggle={toggleObject} onBudget={commitBudget} />
            )}
          </Card>
        )}

        <div style={{ display: "flex", gap: 10, alignItems: "center", padding: "10px 14px", border: "1px dashed var(--line-2)", borderRadius: "var(--r-2)", color: "var(--fg-2)", fontSize: 12.5, flexWrap: "wrap" }}>
          <span>Premissa do LTV enquanto não há histórico de churn: permanência média de</span>
          <input type="number" min="1" defaultValue={biz?.ltv?.months ?? 12} key={biz?.ltv?.months}
            onBlur={(e) => saveLtvMonths(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") e.target.blur(); }}
            style={{ width: 56, height: 24, padding: "0 6px", borderRadius: "var(--r-1)", border: "1px solid var(--line-2)", background: "var(--bg-1)", color: "var(--fg-1)", fontSize: 12, fontFamily: "var(--mono)", textAlign: "right" }} />
          <span>meses. O CAC usa clientes convertidos do pipeline (lead em Ganho vira cliente automaticamente).</span>
        </div>
      </div>
    </div>
  );
}

// Gerenciador estilo Meta Ads (o Leo vive nele): ABAS por nível (Campanhas →
// Conjuntos → Anúncios), toggle Off/On por linha (sem confirmação, otimista),
// colunas ordenáveis, linha de TOTAIS no rodapé e drill-down clicando no nome
// (vira chip de filtro no nível de baixo). Status/orçamento são vivos da conta;
// as métricas do período entram por id (ad_insights) — célula vazia = ainda
// sem dado sincronizado naquele range, não é zero.
const DELIVERY = {
  ACTIVE: { label: "ativo", tone: "var(--pos)" },
  PAUSED: { label: "pausado", tone: "var(--fg-4)" },
  CAMPAIGN_PAUSED: { label: "pausado pela campanha", tone: "var(--fg-4)" },
  ADSET_PAUSED: { label: "pausado pelo conjunto", tone: "var(--fg-4)" },
  PENDING_REVIEW: { label: "em análise", tone: "var(--warn)" },
  IN_PROCESS: { label: "processando", tone: "var(--warn)" },
  WITH_ISSUES: { label: "com problemas", tone: "var(--neg)" },
  DISAPPROVED: { label: "reprovado", tone: "var(--neg)" },
};
const METRIC_COLS = [
  { key: "spend", label: "Investimento", kind: "money" },
  { key: "leads", label: "Leads", kind: "int" },
  { key: "cpl", label: "CPL", kind: "money", empty: "sem lead", hint: "investimento ÷ leads reais do cockpit (UTM)" },
  { key: "ctr", label: "CTR", kind: "pct", hint: "cliques no link ÷ impressões (link CTR)" },
  { key: "cpm", label: "CPM", kind: "money", hint: "custo por mil impressões" },
  { key: "costPerLinkClick", label: "R$ / clique link", kind: "money" },
  { key: "video3s", label: "Vídeo 3s", kind: "int" },
  { key: "videoP25", label: "Vídeo 25%", kind: "int" },
  { key: "videoP50", label: "Vídeo 50%", kind: "int" },
  { key: "videoP95", label: "Vídeo 95%", kind: "int" },
  { key: "won", label: "Ganhos", kind: "int" },
  { key: "costPerWin", label: "R$ / ganho", kind: "money", empty: "sem ganho", bold: true, hint: "coorte: investimento ÷ leads do período que fecharam" },
];

// Toggle Off/On no padrão do Gerenciador — controla o status PRÓPRIO da linha
// (a coluna Veiculação mostra o efetivo, com pausa herdada).
function Toggle({ on, label, busy, onChange }) {
  const action = busy ? "enviando pra Meta" : on ? "pausar" : "ativar";
  return (
    <button onClick={onChange} disabled={busy} role="switch" aria-checked={on} aria-busy={busy || undefined}
      title={`${action} ${busy ? "" : label}`.trim()} aria-label={`${action} ${label}`} style={{
        width: 34, height: 19, borderRadius: 999, padding: 2, flexShrink: 0,
        background: on ? "var(--accent)" : "var(--bg-3)",
        border: "1px solid " + (on ? "var(--accent)" : "var(--line-2)"),
        display: "inline-flex", alignItems: "center",
        justifyContent: on ? "flex-end" : "flex-start",
        transition: "background 120ms ease",
        opacity: busy ? 0.55 : 1,
        cursor: busy ? "wait" : "pointer",
      }}>
      <span style={{ width: 13, height: 13, borderRadius: 999, background: "#fff", boxShadow: "0 1px 2px oklch(0 0 0 / 0.3)" }} />
    </button>
  );
}

// Campo de orçamento com CONFIRMAÇÃO explícita de que replicou pro Gerenciador:
// editar mostra ✓/✕, salvar passa por "enviando…" e termina em "✓ no Gerenciador"
// (ou erro em vermelho com o valor revertido pro vigente). Enter salva, Esc cancela.
function BudgetCell({ o, onCommit, sub = "diário" }) {
  const [val, setVal] = useState(String(o.dailyBudget));
  const [phase, setPhase] = useState("idle"); // idle | saving | saved | error
  useEffect(() => { setVal(String(o.dailyBudget)); setPhase("idle"); }, [o.id, o.dailyBudget]); // eslint-disable-line react-hooks/exhaustive-deps
  const num = Number(val);
  const valid = Number.isFinite(num) && num > 0;
  const dirty = String(val).trim() !== "" && num !== o.dailyBudget;
  async function commit() {
    if (!valid || !dirty || phase === "saving") return;
    setPhase("saving");
    try {
      const applied = await onCommit(num);
      setVal(String(applied));
      setPhase("saved");
      setTimeout(() => setPhase((p) => (p === "saved" ? "idle" : p)), 3000);
    } catch {
      setVal(String(o.dailyBudget)); // reverte pro valor VIGENTE na Meta
      setPhase("error");
      setTimeout(() => setPhase((p) => (p === "error" ? "idle" : p)), 4000);
    }
  }
  function cancel() { setVal(String(o.dailyBudget)); setPhase("idle"); }
  const miniBtn = (label, title, onClick, tone) => (
    <button onClick={onClick} title={title} style={{
      width: 22, height: 22, borderRadius: 5, fontSize: 12, fontWeight: 700, flexShrink: 0,
      border: "1px solid " + (tone === "ok" ? "var(--accent-line)" : "var(--line-2)"),
      background: tone === "ok" ? "var(--accent)" : "var(--bg-2)",
      color: tone === "ok" ? "var(--accent-fg)" : "var(--fg-3)",
    }}>{label}</button>
  );
  return (
    <span style={{ display: "inline-flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
        <input type="number" min="1" step="1" value={val} disabled={phase === "saving"}
          onChange={(e) => { setVal(e.target.value); if (phase !== "idle") setPhase("idle"); }}
          onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") cancel(); }}
          title="Orçamento diário em R$ · Enter ou ✓ envia pra Meta"
          style={{
            width: 86, height: 25, padding: "0 8px", borderRadius: "var(--r-1)",
            border: "1px solid " + (phase === "error" ? "var(--neg)" : dirty ? "var(--accent-line)" : "var(--line-2)"),
            background: "var(--bg-1)", color: "var(--fg-1)", fontSize: 12.5, fontFamily: "var(--mono)", textAlign: "right",
            opacity: phase === "saving" ? 0.6 : 1,
          }} />
        {dirty && phase !== "saving" && miniBtn("✓", valid ? "aplicar na Meta" : "valor inválido", commit, valid ? "ok" : undefined)}
        {dirty && phase !== "saving" && miniBtn("✕", "descartar (volta pro valor vigente)", cancel)}
      </span>
      <span className="mono" style={{
        fontSize: 9,
        color: phase === "saved" ? "var(--pos)" : phase === "error" ? "var(--neg)" : phase === "saving" ? "var(--warn)" : "var(--fg-4)",
        whiteSpace: "nowrap",
      }}>
        {phase === "saving" ? "enviando pra Meta…"
          : phase === "saved" ? "✓ aplicado no Gerenciador"
          : phase === "error" ? "não aplicado · revertido"
          : dirty ? (valid ? "não salvo ainda" : "valor inválido")
          : sub}
      </span>
    </span>
  );
}

function AdsManager({ objects, metrics, money, onToggle, onBudget, busyIds }) {
  const [level, setLevel] = useState("campaigns"); // campaigns | adsets | ads
  const [selCampaign, setSelCampaign] = useState(null); // drill-down herdado
  const [selAdset, setSelAdset] = useState(null);
  const [statusFilter, setStatusFilter] = useState("all");
  const [sort, setSort] = useState({ key: "spend", dir: -1 });

  const matchStatus = (o) => {
    if (statusFilter === "all") return true;
    const eff = o.effectiveStatus || o.status;
    return statusFilter === "active" ? eff === "ACTIVE" : eff !== "ACTIVE";
  };
  const baseOf = (lv) => {
    if (lv === "campaigns") return objects.campaigns || [];
    if (lv === "adsets") return (objects.adsets || []).filter((s) => !selCampaign || String(s.campaignId) === String(selCampaign.id));
    return (objects.ads || []).filter((a) =>
      (!selCampaign || String(a.campaignId) === String(selCampaign.id)) &&
      (!selAdset || String(a.adsetId) === String(selAdset.id)));
  };
  const mOf = (id) => metrics?.[level]?.[String(id)] || null;
  const rows = baseOf(level).filter(matchStatus).map((o) => ({ o, m: mOf(o.id) }));

  const sortVal = ({ o, m }) => {
    if (sort.key === "name") return String(o.name || "").toLowerCase();
    if (sort.key === "dailyBudget") return o.dailyBudget ?? -1;
    const v = m?.[sort.key];
    return v == null ? -Infinity : v;
  };
  rows.sort((a, b) => { const x = sortVal(a), y = sortVal(b); return (x < y ? -1 : x > y ? 1 : 0) * sort.dir; });
  const clickSort = (key) => setSort((s) => (s.key === key ? { key, dir: -s.dir } : { key, dir: key === "name" ? 1 : -1 }));

  // Totais do que está NA TELA (nível + drill + filtro), derivados dos brutos.
  const sums = rows.reduce((acc, { m }) => {
    if (!m) return acc;
    for (const k of ["spend", "impressions", "linkClicks", "leads", "won", "video3s", "videoP25", "videoP50", "videoP95"]) acc[k] += Number(m[k]) || 0;
    return acc;
  }, { spend: 0, impressions: 0, linkClicks: 0, leads: 0, won: 0, video3s: 0, videoP25: 0, videoP50: 0, videoP95: 0 });
  const hasMetrics = rows.some(({ m }) => m);
  const totals = {
    spend: sums.spend, leads: sums.leads, won: sums.won,
    video3s: sums.video3s, videoP25: sums.videoP25, videoP50: sums.videoP50, videoP95: sums.videoP95,
    cpl: sums.leads > 0 ? sums.spend / sums.leads : null,
    ctr: sums.impressions > 0 ? Math.round((sums.linkClicks / sums.impressions) * 10000) / 100 : null,
    cpm: sums.impressions > 0 ? (sums.spend / sums.impressions) * 1000 : null,
    costPerLinkClick: sums.linkClicks > 0 ? sums.spend / sums.linkClicks : null,
    costPerWin: sums.won > 0 ? sums.spend / sums.won : null,
  };

  const drill = (o) => {
    if (level === "campaigns") { setSelCampaign({ id: o.id, name: o.name }); setSelAdset(null); setLevel("adsets"); }
    else if (level === "adsets") { setSelAdset({ id: o.id, name: o.name }); setLevel("ads"); }
  };
  const gotoLevel = (lv) => {
    if (lv === "campaigns") { setSelCampaign(null); setSelAdset(null); }
    if (lv === "adsets") setSelAdset(null);
    setLevel(lv);
  };

  const td = { padding: "10px 14px", borderBottom: "1px solid var(--line-1)" };
  const tdM = { ...td, textAlign: "right", fontFamily: "var(--mono)", fontSize: 12.5, whiteSpace: "nowrap" };
  const fmtCell = (m, col) => {
    if (!m) return "";
    const v = m[col.key];
    if (col.kind === "int") return window.fmt.int(v || 0);
    if (col.kind === "pct") return v != null ? String(v).replace(".", ",") + "%" : "";
    return v != null ? money(v) : (col.empty || "");
  };
  const arrow = (key) => (sort.key === key ? (sort.dir === 1 ? " ↑" : " ↓") : "");
  const chip = (label, onClear) => (
    <span className="mono" style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 24, padding: "0 4px 0 10px", borderRadius: 999, fontSize: 11, border: "1px solid var(--accent-line)", background: "var(--accent-soft)", color: "var(--accent)" }}>
      {label}
      <button onClick={onClear} title="limpar filtro" style={{ fontSize: 12, padding: "0 6px", color: "var(--accent)" }}>✕</button>
    </span>
  );
  const LEVELS = [["campaigns", "Campanhas"], ["adsets", "Conjuntos"], ["ads", "Anúncios"]];

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 16px 0", flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 2, border: "1px solid var(--line-1)", borderRadius: "var(--r-2)", padding: 3, background: "var(--bg-inset)" }}>
          {LEVELS.map(([lv, label]) => (
            <button key={lv} onClick={() => gotoLevel(lv)} style={{
              padding: "4px 12px", borderRadius: 5, fontSize: 12.5,
              fontWeight: level === lv ? 600 : 500,
              background: level === lv ? "var(--bg-1)" : "transparent",
              color: level === lv ? "var(--fg-1)" : "var(--fg-3)",
              boxShadow: level === lv ? "var(--shadow-1)" : "none",
            }}>
              {label} <span className="mono" style={{ fontSize: 10.5, color: "var(--fg-4)" }}>{baseOf(lv).filter(matchStatus).length}</span>
            </button>
          ))}
        </div>
        {selCampaign && chip(`campanha: ${selCampaign.name}`, () => { setSelCampaign(null); setSelAdset(null); })}
        {selAdset && chip(`conjunto: ${selAdset.name}`, () => setSelAdset(null))}
        <span style={{ flex: 1 }} />
        <Segmented value={statusFilter} onChange={setStatusFilter}
          options={[{ value: "all", label: "todas" }, { value: "active", label: "ativas" }, { value: "paused", label: "pausadas" }]} />
      </div>
      {rows.length === 0 && (
        <div className="mono" style={{ padding: "12px 16px", fontSize: 11.5, color: "var(--fg-4)" }}>
          nada neste nível com os filtros atuais
        </div>
      )}
      {rows.length > 0 && (
      <DragScroll>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={{ ...thStyle, width: 46 }} />
              <th style={{ ...thStyle, textAlign: "left", cursor: "pointer" }} onClick={() => clickSort("name")}>Nome{arrow("name")}</th>
              <th style={thStyle}>Veiculação</th>
              <th style={{ ...thStyle, cursor: "pointer" }} onClick={() => clickSort("dailyBudget")}>Orçamento/dia{arrow("dailyBudget")}</th>
              {METRIC_COLS.map((c) => (
                <th key={c.key} title={c.hint} style={{ ...thStyle, cursor: "pointer" }} onClick={() => clickSort(c.key)}>{c.label}{arrow(c.key)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ o, m }) => {
              const eff = o.effectiveStatus || o.status;
              const d = DELIVERY[eff] || { label: String(eff || "").toLowerCase().replaceAll("_", " "), tone: "var(--fg-4)" };
              const canDrill = level !== "ads";
              return (
                <tr key={o.id}>
                  <td style={{ ...td, paddingRight: 0 }}>
                    <Toggle on={o.status !== "PAUSED"} label={o.name} busy={busyIds?.has(o.id)} onChange={() => onToggle(level, o)} />
                  </td>
                  <td onClick={canDrill ? () => drill(o) : undefined} title={canDrill ? "ver o nível de baixo filtrado" : o.name} style={{
                    ...td, fontSize: 13, fontWeight: 600, cursor: canDrill ? "pointer" : "default",
                    color: canDrill ? "var(--accent)" : "var(--fg-1)",
                    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 300, minWidth: 170,
                  }}>{o.name}</td>
                  <td style={{ ...td, whiteSpace: "nowrap", fontSize: 12, color: "var(--fg-2)" }}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                      <span style={{ width: 7, height: 7, borderRadius: 999, background: d.tone, flexShrink: 0 }} />
                      {d.label}
                    </span>
                  </td>
                  <td style={{ ...td, textAlign: "right", whiteSpace: "nowrap" }}>
                    {o.dailyBudget != null ? (
                      <BudgetCell o={o} onCommit={(v) => onBudget(level, o, v)} />
                    ) : o.lifetimeBudget != null ? (
                      <span style={{ display: "inline-flex", flexDirection: "column", alignItems: "flex-end", gap: 1 }}>
                        <span className="mono" style={{ fontSize: 12.5 }}>{money(o.lifetimeBudget)}</span>
                        <span className="mono" style={{ fontSize: 9, color: "var(--fg-4)" }}>total</span>
                      </span>
                    ) : level === "ads" ? "" : (
                      <span className="mono" style={{ fontSize: 11, color: "var(--fg-4)" }} title={level === "campaigns" ? "orçamento definido nos conjuntos (ABO)" : "orçamento definido na campanha (CBO)"}>
                        {level === "campaigns" ? "no conjunto" : "na campanha"}
                      </span>
                    )}
                  </td>
                  {METRIC_COLS.map((c) => (
                    <td key={c.key} className="tnum" style={{ ...tdM, fontWeight: c.bold ? 600 : 400 }}>{fmtCell(m, c)}</td>
                  ))}
                </tr>
              );
            })}
            {/* Linha de totais, como o rodapé do Gerenciador. */}
            <tr style={{ background: "var(--bg-inset)" }}>
              <td style={td} />
              <td style={{ ...td, fontSize: 12, fontWeight: 600, color: "var(--fg-2)", whiteSpace: "nowrap" }}>
                Resultados de {rows.length} {rows.length === 1 ? "item" : "itens"}
              </td>
              <td style={td} />
              <td style={td} />
              {METRIC_COLS.map((c) => (
                <td key={c.key} className="tnum" style={{ ...tdM, fontWeight: 600 }}>
                  {!hasMetrics ? "" /* período sem sync: vazio ≠ zero, igual às linhas */
                    : c.kind === "int" ? window.fmt.int(totals[c.key] || 0)
                    : c.kind === "pct" ? (totals[c.key] != null ? String(totals[c.key]).replace(".", ",") + "%" : "")
                    : totals[c.key] != null ? money(totals[c.key]) : ""}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </DragScroll>
      )}
    </>
  );
}

const thStyle = {
  textAlign: "right", fontSize: 10.5, fontWeight: 500, letterSpacing: "0.08em", textTransform: "uppercase",
  color: "var(--fg-3)", padding: "10px 14px", borderTop: "1px solid var(--line-1)", borderBottom: "1px solid var(--line-1)",
  background: "var(--bg-inset)", whiteSpace: "nowrap", fontFamily: "var(--mono)", userSelect: "none",
};

// Quebra por dor: cada linha é um código "[X]" da nomenclatura dos anúncios.
// O que decide escala é a última coluna (custo por ganho), não o CPL.
function PainTable({ pains, money }) {
  const ths = ["Dor", "Anúncios", "Investimento", "Leads (UTM)", "CPL real", "Ganhos", "Custo por ganho"];
  return (
    <div className="tbl-x" style={{ marginTop: 10 }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            {ths.map((h, i) => (
              <th key={h} className="mono" style={{ textAlign: i === 0 ? "left" : "right", fontSize: 10.5, fontWeight: 500, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--fg-3)", padding: "10px 16px", borderTop: "1px solid var(--line-1)", borderBottom: "1px solid var(--line-1)", background: "var(--bg-inset)" }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {pains.map((p) => (
            <tr key={p.code || "_sem"} style={{ opacity: p.code ? 1 : 0.55 }}>
              <td style={{ padding: "11px 16px", fontSize: 13, fontWeight: 600, borderBottom: "1px solid var(--line-1)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 300 }}>
                {p.code && <span className="mono" style={{ marginRight: 8, fontSize: 11, color: "var(--accent)", border: "1px solid var(--line-2)", borderRadius: 5, padding: "1px 6px" }}>{p.code}</span>}
                {p.label}
              </td>
              <td className="tnum" style={tdNum}>{p.adsCount}</td>
              <td className="tnum" style={tdNum}>{money(p.spend)}</td>
              <td className="tnum" style={tdNum}>{window.fmt.int(p.leads)}</td>
              <td className="tnum" style={tdNum}>{p.cpl != null ? money(p.cpl) : "sem lead"}</td>
              <td className="tnum" style={tdNum}>{window.fmt.int(p.won)}</td>
              <td className="tnum" style={{ ...tdNum, fontWeight: 600 }}>{p.costPerWin != null ? money(p.costPerWin) : "sem ganho"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Painel de novo criativo: vídeo do videomaker + dor + copy → anúncio PAUSADO
// no conjunto escolhido, nome "[A] variação" e UTMs da convenção. A revisão e a
// ativação seguem no Gerenciador da Meta.
function NewCreativePanel({ product, campaigns, onDone, onError, onClose }) {
  const [defaults, setDefaults] = useState(null); // { pageId, link, painMap }
  const [campaignId, setCampaignId] = useState("");
  const [adsets, setAdsets] = useState(null);
  const [adsetId, setAdsetId] = useState("");
  const [pain, setPain] = useState("");           // código escolhido ou "_new"
  const [newPain, setNewPain] = useState({ code: "", label: "" });
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [link, setLink] = useState("");
  const [cta, setCta] = useState("LEARN_MORE");
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.creativeDefaults(product.id)
      .then((d) => { setDefaults(d); if (d.link) setLink((v) => v || d.link); })
      .catch(() => setDefaults({ painMap: {} }));
  }, [product.id]);

  useEffect(() => {
    if (!campaignId) { setAdsets(null); setAdsetId(""); return; }
    setAdsets(null);
    api.metaAdsets(campaignId)
      .then((r) => { setAdsets(r.adsets); if (r.adsets.length === 1) setAdsetId(r.adsets[0].id); })
      .catch((e) => { setAdsets([]); onError(e.message || "Falha ao listar conjuntos."); });
  }, [campaignId]); // eslint-disable-line react-hooks/exhaustive-deps

  const painMap = defaults?.painMap || {};
  const painCodeSel = pain === "_new" ? newPain.code.trim().toUpperCase() : pain;
  const painLabelSel = pain === "_new" ? newPain.label.trim() : painMap[pain] || "";
  const valid = adsetId && name.trim() && message.trim() && link.trim() && file && (pain !== "_new" || (painCodeSel && painLabelSel));

  async function submit() {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("adsetId", adsetId);
      fd.append("name", name.trim());
      fd.append("message", message.trim());
      if (title.trim()) fd.append("title", title.trim());
      fd.append("link", link.trim());
      fd.append("ctaType", cta);
      if (painCodeSel) { fd.append("painCode", painCodeSel); fd.append("painLabel", painLabelSel); }
      fd.append("video", file, file.name);
      const r = await api.uploadCreative(product.id, fd);
      onDone(`Anúncio "${r.name}" criado PAUSADO — revise e ative no Gerenciador.`);
    } catch (e) {
      onError(e.message || "Falha ao criar o criativo.");
    }
    setBusy(false);
  }

  const lbl = { display: "flex", flexDirection: "column", gap: 4 };
  const cap = { fontSize: 10.5, letterSpacing: "0.07em", textTransform: "uppercase", color: "var(--fg-3)" };
  const inp = { height: 30, padding: "0 10px", borderRadius: "var(--r-1)", border: "1px solid var(--line-2)", background: "var(--bg-1)", color: "var(--fg-1)", fontSize: 13 };
  const activeCamps = campaigns.filter((c) => c.effectiveStatus !== "ARCHIVED" && c.effectiveStatus !== "DELETED");

  return (
    <Card title="Novo criativo" hint="o anúncio nasce pausado, com a dor no nome e as UTMs do mapeamento">
      <div style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10 }}>
          <label style={lbl}>
            <span className="mono" style={cap}>Campanha</span>
            <select value={campaignId} onChange={(e) => setCampaignId(e.target.value)} style={inp}>
              <option value="">Selecione…</option>
              {activeCamps.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label style={lbl}>
            <span className="mono" style={cap}>Conjunto</span>
            <select value={adsetId} onChange={(e) => setAdsetId(e.target.value)} disabled={!campaignId} style={inp}>
              <option value="">{!campaignId ? "escolha a campanha" : adsets == null ? "carregando…" : "Selecione…"}</option>
              {(adsets || []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <label style={lbl}>
            <span className="mono" style={cap}>Dor (roteiro)</span>
            <select value={pain} onChange={(e) => setPain(e.target.value)} style={inp}>
              <option value="">Sem código</option>
              {Object.entries(painMap).map(([c, l]) => <option key={c} value={c}>[{c}] {l}</option>)}
              <option value="_new">+ nova dor…</option>
            </select>
          </label>
        </div>

        {pain === "_new" && (
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <label style={lbl}>
              <span className="mono" style={cap}>Código (1-3 letras)</span>
              <input type="text" maxLength={3} placeholder="C" value={newPain.code}
                onChange={(e) => setNewPain({ ...newPain, code: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "") })}
                style={{ ...inp, width: 80, fontFamily: "var(--mono)", textTransform: "uppercase" }} />
            </label>
            <label style={{ ...lbl, flex: 1, minWidth: 220 }}>
              <span className="mono" style={cap}>Nome da dor</span>
              <input type="text" placeholder="ex.: Medo de banimento da conta" value={newPain.label}
                onChange={(e) => setNewPain({ ...newPain, label: e.target.value })} style={inp} />
            </label>
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10 }}>
          <label style={lbl}>
            <span className="mono" style={cap}>Variação (vira o nome do anúncio)</span>
            <input type="text" placeholder="ex.: v1 depoimento cliente" value={name} onChange={(e) => setName(e.target.value)} style={inp} />
          </label>
          <label style={lbl}>
            <span className="mono" style={cap}>Título (headline)</span>
            <input type="text" placeholder="opcional" value={title} onChange={(e) => setTitle(e.target.value)} style={inp} />
          </label>
          <label style={lbl}>
            <span className="mono" style={cap}>Botão (CTA)</span>
            <select value={cta} onChange={(e) => setCta(e.target.value)} style={inp}>
              <option value="LEARN_MORE">Saiba mais</option>
              <option value="SIGN_UP">Cadastre-se</option>
              <option value="GET_OFFER">Ver oferta</option>
              <option value="CONTACT_US">Fale conosco</option>
            </select>
          </label>
        </div>

        <label style={lbl}>
          <span className="mono" style={cap}>Texto principal</span>
          <textarea rows={3} placeholder="Copy do anúncio (aparece acima do vídeo)" value={message} onChange={(e) => setMessage(e.target.value)}
            style={{ ...inp, height: "auto", minHeight: 64, padding: "8px 10px", resize: "vertical", fontFamily: "var(--sans)" }} />
        </label>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 10 }}>
          <label style={lbl}>
            <span className="mono" style={cap}>Link de destino (form)</span>
            <input type="url" placeholder="https://…" value={link} onChange={(e) => setLink(e.target.value)} style={{ ...inp, fontFamily: "var(--mono)", fontSize: 12 }} />
          </label>
          <label style={lbl}>
            <span className="mono" style={cap}>Vídeo</span>
            <input type="file" accept="video/*" onChange={(e) => setFile(e.target.files?.[0] || null)}
              style={{ ...inp, paddingTop: 4, height: 30 }} />
          </label>
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button onClick={submit} disabled={!valid || busy}
            style={{ height: 32, padding: "0 16px", borderRadius: "var(--r-1)", background: "var(--accent)", color: "var(--accent-fg)", fontSize: 13, fontWeight: 600, opacity: !valid || busy ? 0.55 : 1 }}>
            {busy ? "Enviando vídeo… (pode levar uns minutos)" : "Criar anúncio pausado"}
          </button>
          <button onClick={onClose} disabled={busy} style={{ height: 32, padding: "0 10px", fontSize: 12.5, color: "var(--fg-3)" }}>cancelar</button>
          {painCodeSel && name.trim() && (
            <span className="mono dim" style={{ fontSize: 11.5 }}>nome final: [{painCodeSel}] {name.trim()}</span>
          )}
        </div>
      </div>
    </Card>
  );
}

// Tabela campanha → conjunto → anúncio (linhas expansíveis). Conjuntos/anúncios
// só existem depois do 1º sync nível-anúncio — sem eles, a campanha não expande.
function CampaignDrilldown({ data, money }) {
  const [open, setOpen] = React.useState(() => new Set());
  const toggle = (id) => setOpen((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const adsetsOf = (cid) => (data.adsets || []).filter((s) => s.campaignId === cid);
  const adsOf = (sid) => (data.ads || []).filter((a) => a.adsetId === sid);

  const cells = (g, { bold } = {}) => (
    <>
      <td className="tnum" style={tdNum}>{money(g.spend)}</td>
      <td className="tnum" style={tdNum}>{window.fmt.int(g.clicks)}</td>
      <td className="tnum" style={tdNum}>{window.fmt.int(g.leads || 0)}</td>
      <td className="tnum" style={{ ...tdNum, fontWeight: bold ? 600 : 400 }}>{g.cpl != null ? money(g.cpl) : "sem UTM"}</td>
      <td className="tnum" style={tdNum}>{window.fmt.int(g.metaLeads)}</td>
      <td className="tnum" style={tdNum}>{g.cplMeta != null ? money(g.cplMeta) : "sem lead"}</td>
    </>
  );
  const nameTd = (label, depth, expandable, isOpen, onClick) => (
    <td onClick={onClick} style={{
      padding: "11px 16px", paddingLeft: 16 + depth * 22, fontSize: depth ? 12.5 : 13,
      fontWeight: depth === 2 ? 400 : 600, color: depth === 2 ? "var(--fg-2)" : "var(--fg-1)",
      borderBottom: "1px solid var(--line-1)", cursor: expandable ? "pointer" : "default",
      whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 340,
    }}>
      {expandable && <span className="mono" style={{ marginRight: 7, color: "var(--fg-4)", fontSize: 10 }}>{isOpen ? "▾" : "▸"}</span>}
      {depth === 1 && <span className="mono" style={{ marginRight: 6, color: "var(--fg-4)", fontSize: 10 }}>conj</span>}
      {depth === 2 && <span className="mono" style={{ marginRight: 6, color: "var(--fg-4)", fontSize: 10 }}>ad</span>}
      {label}
    </td>
  );

  return (
    <div className="tbl-x" style={{ marginTop: 10 }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            {["Campanha", "Investimento", "Cliques", "Leads (UTM)", "CPL real", "Leads (Meta)", "CPL (Meta)"].map((h, i) => (
              <th key={h} className="mono" style={{ textAlign: i === 0 ? "left" : "right", fontSize: 10.5, fontWeight: 500, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--fg-3)", padding: "10px 16px", borderTop: "1px solid var(--line-1)", borderBottom: "1px solid var(--line-1)", background: "var(--bg-inset)" }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.campaigns.map((c) => {
            const sets = adsetsOf(c.id);
            const cOpen = open.has(c.id);
            return (
              <React.Fragment key={c.id}>
                <tr>
                  {nameTd(c.name || c.id, 0, sets.length > 0, cOpen, sets.length ? () => toggle(c.id) : undefined)}
                  {cells(c, { bold: true })}
                </tr>
                {cOpen && sets.map((s) => {
                  const ads = adsOf(s.id);
                  const sOpen = open.has(s.id);
                  return (
                    <React.Fragment key={s.id}>
                      <tr style={{ background: "var(--bg-inset)" }}>
                        {nameTd(s.name || s.id, 1, ads.length > 0, sOpen, ads.length ? () => toggle(s.id) : undefined)}
                        {cells(s)}
                      </tr>
                      {sOpen && ads.map((a) => (
                        <tr key={a.id} style={{ background: "var(--bg-inset)" }}>
                          {nameTd(a.name || a.id, 2, false, false)}
                          {cells(a)}
                        </tr>
                      ))}
                    </React.Fragment>
                  );
                })}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const tdNum = { padding: "11px 16px", fontSize: 13, textAlign: "right", borderBottom: "1px solid var(--line-1)", fontFamily: "var(--mono)" };

export { MetricsScreen };
