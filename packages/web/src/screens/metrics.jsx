import React from "react";
import { api } from "../lib/api.js";
import { useData } from "../data.jsx";
import { PageHead, Segmented, FilterTab, StatTile, Card } from "../components/viz.jsx";
import { painCodeOf } from "../lib/pains.js";
import { useActiveSaas } from "../lib/workspace.js";
import { EmptyState } from "../atoms.jsx";
import { stageKind } from "../lib/funnel.js";
import { GRADE_STYLE } from "../lib/ui.js";
// Métricas — aquisição × funil do produto ativo (substitui a tela Marketing).
// Hoje: investimento (Meta), leads, CPL real e custo por etapa, com séries no
// tempo e quebra por campanha. CAC e LTV entram na fase de métricas de receita,
// nesta mesma tela.

const { useState, useEffect } = React;

// Número do nome do arquivo (sem extensão, maior sequência de dígitos) — espelha
// o fileNumber do servidor pra o preview do nome final bater.
function fileNumberOf(filename) {
  const base = String(filename || "").replace(/\.[^.]+$/, "");
  const runs = base.match(/\d+/g) || [];
  return runs.sort((a, b) => b.length - a.length || 0)[0] || "";
}

const DAY = 86_400_000;
// Dia LOCAL do navegador (Brasil), não UTC — às 21h de Brasília o toISOString
// já vira o dia seguinte e o filtro "hoje" apontava pra um dia sem dados.
const dayStr = (t) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

// Dinheiro COM CENTAVOS (pedido do Leo, padrão do Gerenciador da Meta) — vale
// pra tiles, tabelas e cards da tela; só os eixos dos gráficos ficam compactos.
const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const money = (v) => BRL.format(Number(v) || 0);

const PERIODS = [
  { value: "7", label: "7 dias" },
  { value: "30", label: "30 dias" },
  { value: "90", label: "90 dias" },
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
  if (r.preset === "yesterday") { const y = dayStr(Date.now() - DAY); return { since: y, until: y }; }
  const n = Number(r.preset) || 30; // "1" = hoje (since = until = hoje)
  return { since: dayStr(Date.now() - (n - 1) * DAY), until: today };
}

function MetricsScreen() {
  const { SAAS, CONFIG } = window.SEED;
  const { version } = useData();
  const [product, setActiveSaas] = useActiveSaas();
  const metaOn = !!CONFIG?.meta?.configured;

  const [range, setRange] = useState({ preset: "30" });
  const { since, until } = rangeOf(range);
  const rangeDays = Math.max(1, Math.round((new Date(until) - new Date(since)) / DAY) + 1);
  const [data, setData] = useState(null);
  const [biz, setBiz] = useState(null); // CAC/LTV + série mensal
  const [syncing, setSyncing] = useState(false);
  const [note, setNote] = useState(null);

  const [objects, setObjects] = useState(null); // { campaigns, adsets, ads } ao vivo (gerenciamento)
  const [placements, setPlacements] = useState(null); // breakdown plataforma × posição (ao vivo)
  const [creative, setCreative] = useState(false); // painel de novo criativo
  const [cloneAd, setCloneAd] = useState(false);    // painel de "criar anúncio" (clonar + trocar vídeo)
  // Troca de produto (workspace) fecha os painéis e descarta o rascunho de gasto
  // manual — nada pode ser registrado no produto errado. (setManual é declarado
  // abaixo; o efeito roda pós-render, então a captura é segura.)
  useEffect(() => { setCreative(false); setCloneAd(false); setManual(null); setNote(null); }, [product?.id]); // eslint-disable-line no-use-before-define

  // reset=true (troca de range/produto): zera a tela e recarrega TUDO, inclusive
  // a lista viva de campanhas. Silencioso (SSE/tick): só métricas + CAC — nada
  // de bater na Graph a cada lead movido por alguém do time.
  // `loadEpoch` descarta resposta atrasada de um load anterior (troca rápida de
  // produto A→B→A não pode assentar com dados/campanhas do produto errado).
  const loadEpoch = React.useRef(0);
  const load = (reset = true) => {
    if (!product) return;
    const ep = ++loadEpoch.current;
    const fresh = (set) => (v) => { if (ep === loadEpoch.current) set(v); };
    if (reset) { setData(null); setObjects(null); setPlacements(null); setNote(null); }
    api.marketingMetrics(product.id, { since, until }).then(fresh(setData)).catch(() => fresh(setData)({ error: true }));
    api.metrics(product.id, { days: rangeDays, months: 12 }).then(fresh(setBiz)).catch(() => fresh(setBiz)(null));
    if (reset && metaOn && product.metaAdAccount) {
      api.adObjects(product.id).then(fresh(setObjects)).catch((e) => fresh(setObjects)({ error: e.message }));
      // Placements têm cache de 5 min no servidor — recarregar só no reset basta.
      api.marketingPlacements(product.id, { since, until }).then(fresh(setPlacements)).catch(() => fresh(setPlacements)(null));
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
      const ep = loadEpoch.current; // descarta se um load novo (troca de produto) chegou depois
      api.marketingMetrics(product.id, { since, until }).then((v) => { if (ep === loadEpoch.current) setData(v); }).catch(() => { /* próximo tick */ });
    }, 60_000);
    return () => clearInterval(id);
  }, [product?.id, since, until, metaOn]); // eslint-disable-line react-hooks/exhaustive-deps
  const liveAt = data?.syncedAt ? new Date(data.syncedAt) : null;
  const insights = (data && !data.error ? buildInsights(data, placements, objects) : [])
    .map((it) => withInsightAction(it, { data, objects }));
  // Aplicou uma ação (pausa/orçamento) → recarrega o estado vivo da conta,
  // igual ao pós-toggle do card Anúncios.
  const reloadObjects = () => { if (product?.metaAdAccount) api.adObjects(product.id).then(setObjects).catch(() => { /* mantém o atual */ }); };

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
      const ep = loadEpoch.current;
      api.adObjects(product.id).then((v) => { if (ep === loadEpoch.current) setObjects(v); }).catch(() => { /* otimista já aplicado */ });
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

  const totalMilestoneLeads = milestones[0]?.count || 0;
  const metricMaps = data && !data.error ? {
    campaigns: Object.fromEntries((data.campaigns || []).map((g) => [String(g.id), g])),
    adsets: Object.fromEntries((data.adsets || []).map((g) => [String(g.id), g])),
    ads: Object.fromEntries((data.ads || []).map((g) => [String(g.id), g])),
  } : null;
  const compactObjects = objects && !objects.error ? objects : data && !data.error ? {
    campaigns: data.campaigns || [], adsets: data.adsets || [], ads: data.ads || [],
  } : null;

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, overflow: "auto" }}>
      <PageHead title="Publicidade" sub={<span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>aquisição, funil e campanhas · <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--fg-2)", fontSize: 12.5, fontWeight: 500 }}><span style={{ width: 6, height: 6, borderRadius: 99, background: metaOn && product.metaAdAccount ? "var(--pos)" : "var(--fg-4)" }} />{metaOn && product.metaAdAccount ? "Meta conectada" : "Meta não conectada"}</span></span>}>
        {PERIODS.map((period) => <FilterTab key={period.value} active={range.preset === period.value} onClick={() => setRange({ preset: period.value })}>{period.label}</FilterTab>)}
      </PageHead>

      <div style={{ padding: "16px var(--pad-x) 56px", display: "flex", flexDirection: "column", gap: 16 }}>
        {note && (
          <div className="mono" style={{ fontSize: 12, color: note.ok ? "var(--pos)" : "var(--neg)" }}>{note.text}</div>
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
            </div>
          </Card>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
          <StatTile label="Investimento" value={t ? money(t.spend) : "…"} delta={t?.ctr != null ? `CTR ${String(t.ctr).replace(".", ",")}%` : null} />
          <StatTile label="Visitas no form" value={t?.formViews != null ? window.fmt.int(t.formViews) : "…"}
            delta={t?.formViews > 0 ? `conversão do form ${((t.formStarts / t.formViews) * 100).toFixed(1).replace(".", ",")}%` : "sem visitas no período"} />
          <StatTile label="Lead → cliente" value={biz?.window?.convRate != null ? `${String(biz.window.convRate).replace(".", ",")}%` : "sem dado"}
            delta={biz?.window?.newCustomers != null ? `${biz.window.newCustomers} ${biz.window.newCustomers === 1 ? "cliente novo" : "clientes novos"}` : "conversão no período"} />
          <StatTile label={`CAC · ${rangeDays}d`} value={biz?.window?.cac != null ? money(biz.window.cac) : "sem dado"} delta="investimento ÷ clientes" />
          <StatTile label="LTV estimado" value={biz?.ltv?.value != null ? money(biz.ltv.value) : "sem dado"}
            delta={biz?.ltv?.ticket != null ? "ticket × tempo de casa" : "precisa de assinaturas ativas"} />
          <StatTile label="LTV / CAC" value={biz?.ltv?.ltvCac != null ? window.fmt.ratio(biz.ltv.ltvCac) : "sem dado"}
            delta={biz?.ltv?.ltvCac != null ? (biz.ltv.ltvCac >= 3 ? "saudável acima de 3x" : "abaixo do saudável (3x)") : null}
            tone={biz?.ltv?.ltvCac != null ? (biz.ltv.ltvCac >= 3 ? "up" : "down") : "flat"} />
        </div>

        <Card title="Custo por etapa do funil" hint="investimento ÷ leads que chegaram em cada marco · % = quantos chegaram até ali">
          <div style={{ padding: "16px 24px 22px", display: "flex", flexDirection: "column", gap: 10 }}>
            {milestones.map((s, i) => {
              const conv = i === 0 ? (totalMilestoneLeads ? 100 : 0) : totalMilestoneLeads ? Math.round((s.count / totalMilestoneLeads) * 1000) / 10 : 0;
              const won = stageKind(product, s.stage) === "ganho";
              return (
                <div key={s.stage} style={{ display: "grid", gridTemplateColumns: "150px 1fr 92px 60px", gap: 12, alignItems: "center" }}>
                  <span style={{ fontSize: 13, fontWeight: 500, color: "var(--fg-3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.stage}</span>
                  <div style={{ height: 20, borderRadius: 6, background: "var(--bg-2)", overflow: "hidden" }}><div style={{ height: "100%", width: `${Math.max(conv ? 3 : 0, conv)}%`, background: won ? "var(--pos)" : "var(--accent)", borderRadius: 6 }} /></div>
                  <span className="tnum" style={{ textAlign: "right", fontSize: 13.5, fontWeight: 700 }}>{s.costPer != null ? money(s.costPer) : "—"}</span>
                  <span className="tnum" style={{ textAlign: "right", fontSize: 12, color: "var(--fg-3)" }}>{String(conv).replace(".", ",")}%</span>
                </div>
              );
            })}
            {!milestones.length && <span style={{ color: "var(--fg-4)", fontSize: 13 }}>sem dados do funil no período</span>}
          </div>
        </Card>

        <Card title="Por dor" hint="código [X] no nome do anúncio · qual roteiro traz lead que fecha, não só lead barato" style={{ overflow: "hidden" }}>
          <PainTable pains={(data && !data.error ? data.pains : []) || []} money={money} />
        </Card>

        <CompactAdsCard objects={compactObjects} metrics={metricMaps} money={money} busyIds={busyIds}
          onToggle={objects && !objects.error ? toggleObject : null} error={objects?.error} />
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
  { key: "costPerWin", label: "R$ / ganho", kind: "money", empty: "sem ganho", hint: "coorte: investimento ÷ leads do período que fecharam" },
  { key: "revenue", label: "Receita", kind: "money", hint: "soma do valor dos negócios ganhos atribuídos (UTM)" },
  { key: "roas", label: "ROAS", kind: "x", empty: "sem receita", bold: true, hint: "receita dos ganhos ÷ investimento" },
];

// Toggle Off/On no padrão do Gerenciador — controla o status PRÓPRIO da linha
// (a coluna Veiculação mostra o efetivo, com pausa herdada).
function Toggle({ on, label, busy, disabled = false, onChange }) {
  const action = busy ? "enviando pra Meta" : on ? "pausar" : "ativar";
  return (
    <button onClick={onChange} disabled={busy || disabled} role="switch" aria-checked={on} aria-busy={busy || undefined}
      title={`${action} ${busy ? "" : label}`.trim()} aria-label={`${action} ${label}`} style={{
        width: 38, height: 22, borderRadius: 999, padding: 2, flexShrink: 0,
        background: on ? "var(--accent)" : "var(--bg-3)",
        border: "1px solid " + (on ? "var(--accent)" : "var(--line-2)"),
        display: "inline-flex", alignItems: "center",
        justifyContent: on ? "flex-end" : "flex-start",
        transition: "background 120ms ease",
        opacity: busy ? 0.55 : disabled ? 0.7 : 1,
        cursor: busy ? "wait" : disabled ? "default" : "pointer",
      }}>
      <span style={{ width: 16, height: 16, borderRadius: 999, background: "#fff", boxShadow: "0 1px 2px oklch(0 0 0 / 0.3)" }} />
    </button>
  );
}

function CompactAdsCard({ objects, metrics, money, busyIds, onToggle, error }) {
  const [level, setLevel] = useState("campaigns");
  const levels = [
    { value: "campaigns", label: "Campanhas", singular: "Campanha" },
    { value: "adsets", label: "Conjuntos", singular: "Conjunto" },
    { value: "ads", label: "Anúncios", singular: "Anúncio" },
  ];
  const current = levels.find((item) => item.value === level);
  const rows = objects?.[level] || [];
  const delivery = (object) => {
    const status = object.effectiveStatus || object.status;
    return DELIVERY[status] || { label: status ? String(status).toLowerCase().replaceAll("_", " ") : "sem status", tone: "var(--fg-4)" };
  };

  return (
    <Card title="Anúncios" hint="estilo Gerenciador · toggle pausa na Meta"
      action={<Segmented value={level} onChange={setLevel} options={levels.map(({ value, label }) => ({ value, label }))} />}
      style={{ overflow: "hidden" }}>
      <div style={{ display: "grid", gridTemplateColumns: "46px 1.7fr .7fr .75fr .5fr .9fr .65fr", gap: 12, padding: "10px 24px", fontSize: 11, fontWeight: 600, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--fg-4)", borderTop: "1px solid var(--line-1)", background: "var(--bg-inset)" }}>
        <span /><span>{current.singular}</span><span>Status</span><span style={{ textAlign: "right" }}>Investido</span><span style={{ textAlign: "right" }}>Leads</span><span title="clientes A/B/C atribuídos (UTM) · custo por cada" style={{ textAlign: "right" }}>Clientes ABC</span><span style={{ textAlign: "right" }}>CPL</span>
      </div>
      {error && <div style={{ padding: "16px 24px", borderTop: "1px solid var(--line-faint)", color: "var(--neg)", fontSize: 12.5 }}>{error}</div>}
      {!objects && !error && <div style={{ padding: "16px 24px", borderTop: "1px solid var(--line-faint)", color: "var(--fg-4)", fontSize: 12.5 }}>carregando conta de anúncios…</div>}
      {objects && !rows.length && <div style={{ padding: "16px 24px", borderTop: "1px solid var(--line-faint)", color: "var(--fg-4)", fontSize: 12.5 }}>nenhum item neste nível</div>}
      {rows.map((object) => {
        const m = metrics?.[level]?.[String(object.id)] || object;
        const state = delivery(object);
        const leads = Number(m?.leads) || 0;
        const spend = Number(m?.spend) || 0;
        const cpl = m?.cpl != null ? m.cpl : leads ? spend / leads : null;
        const active = object.status ? object.status !== "PAUSED" : state.label !== "pausado";
        return (
          <div key={object.id} style={{ display: "grid", gridTemplateColumns: "46px 1.7fr .7fr .75fr .5fr .9fr .65fr", gap: 12, padding: "12px 24px", alignItems: "center", borderTop: "1px solid var(--line-faint)", fontSize: 13.5, opacity: active ? 1 : .7 }}>
            <Toggle on={active} label={object.name || object.id} busy={busyIds?.has(object.id)} disabled={!onToggle || !object.status} onChange={() => onToggle?.(level, object)} />
            <span style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{object.name || object.id}</span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--fg-2)" }}><span style={{ width: 7, height: 7, borderRadius: 99, background: state.tone }} />{state.label}</span>
            <span className="tnum" style={{ textAlign: "right" }}>{money(spend)}</span>
            <span className="tnum" style={{ textAlign: "right" }}>{window.fmt.int(leads)}</span>
            {/* uma linha por grade que o anúncio trouxe: "2 A · R$ 43,00 cada" */}
            <span className="tnum" style={{ display: "inline-flex", flexDirection: "column", alignItems: "flex-end", gap: 1, fontSize: 11.5 }}>
              {m?.abc && GRADES.some((g) => m.abc[g] > 0)
                ? GRADES.filter((g) => m.abc[g] > 0).map((g) => (
                  <span key={g} style={{ whiteSpace: "nowrap", color: "var(--fg-3)" }}>
                    <span style={{ fontWeight: 700, color: GRADE_STYLE[g].ink }}>{m.abc[g]} {g}</span>
                    {m.abcCost?.[g] != null ? ` · ${money(m.abcCost[g])} cada` : ""}
                  </span>
                ))
                : <span style={{ color: "var(--fg-4)", fontSize: 13.5 }}>—</span>}
            </span>
            <span className="tnum" style={{ textAlign: "right" }}>{cpl != null ? money(cpl) : "—"}</span>
          </div>
        );
      })}
    </Card>
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
      background: tone === "ok" ? "var(--btn-bg, var(--accent))" : "var(--bg-2)",
      color: tone === "ok" ? "var(--btn-fg, var(--accent-fg))" : "var(--fg-3)",
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
  // Seleção estilo Gerenciador: checkbox nas linhas; campanhas marcadas filtram
  // a aba de conjuntos, conjuntos marcados filtram a de anúncios (os rótulos
  // das abas viram "Conjuntos de N campanhas" etc.). Clique no nome = atalho
  // que seleciona SÓ aquela linha e desce um nível.
  const [selCampaigns, setSelCampaigns] = useState(() => new Set());
  const [selAdsets, setSelAdsets] = useState(() => new Set());
  const [statusFilter, setStatusFilter] = useState("all");
  const [sort, setSort] = useState({ key: "spend", dir: -1 });

  const matchStatus = (o) => {
    if (statusFilter === "all") return true;
    const eff = o.effectiveStatus || o.status;
    return statusFilter === "active" ? eff === "ACTIVE" : eff !== "ACTIVE";
  };
  // Poda conjuntos selecionados que saíram do recorte quando a seleção de
  // campanhas muda (senão a aba Anúncios filtraria por um conjunto invisível).
  const pruneAdsets = (camps) => setSelAdsets((prev) => (camps.size
    ? new Set([...prev].filter((sid) => {
        const st = (objects.adsets || []).find((x) => String(x.id) === sid);
        return st && camps.has(String(st.campaignId));
      }))
    : prev));
  const toggleSel = (lv, id) => {
    const key = String(id);
    if (lv === "campaigns") {
      setSelCampaigns((prev) => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); pruneAdsets(n); return n; });
    } else if (lv === "adsets") {
      setSelAdsets((prev) => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });
    }
  };
  const baseOf = (lv) => {
    if (lv === "campaigns") return objects.campaigns || [];
    if (lv === "adsets") return (objects.adsets || []).filter((s) => !selCampaigns.size || selCampaigns.has(String(s.campaignId)));
    return (objects.ads || []).filter((a) =>
      (!selCampaigns.size || selCampaigns.has(String(a.campaignId))) &&
      (!selAdsets.size || selAdsets.has(String(a.adsetId))));
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
    for (const k of ["spend", "impressions", "linkClicks", "leads", "won", "revenue", "video3s", "videoP25", "videoP50", "videoP95"]) acc[k] += Number(m[k]) || 0;
    return acc;
  }, { spend: 0, impressions: 0, linkClicks: 0, leads: 0, won: 0, revenue: 0, video3s: 0, videoP25: 0, videoP50: 0, videoP95: 0 });
  const hasMetrics = rows.some(({ m }) => m);
  const totals = {
    spend: sums.spend, leads: sums.leads, won: sums.won, revenue: sums.revenue,
    video3s: sums.video3s, videoP25: sums.videoP25, videoP50: sums.videoP50, videoP95: sums.videoP95,
    cpl: sums.leads > 0 ? sums.spend / sums.leads : null,
    ctr: sums.impressions > 0 ? Math.round((sums.linkClicks / sums.impressions) * 10000) / 100 : null,
    cpm: sums.impressions > 0 ? (sums.spend / sums.impressions) * 1000 : null,
    costPerLinkClick: sums.linkClicks > 0 ? sums.spend / sums.linkClicks : null,
    costPerWin: sums.won > 0 ? sums.spend / sums.won : null,
    roas: sums.spend > 0 && sums.revenue > 0 ? Math.round((sums.revenue / sums.spend) * 100) / 100 : null,
  };

  const drill = (o) => {
    if (level === "campaigns") { const n = new Set([String(o.id)]); setSelCampaigns(n); pruneAdsets(n); setLevel("adsets"); }
    else if (level === "adsets") { setSelAdsets(new Set([String(o.id)])); setLevel("ads"); }
  };
  // Trocar de aba NÃO limpa a seleção (igual ao Gerenciador) — limpar é nos
  // chips ✕ ou desmarcando os checkboxes.
  const gotoLevel = (lv) => setLevel(lv);

  const td = { padding: "10px 14px", borderBottom: "1px solid var(--line-1)" };
  const tdM = { ...td, textAlign: "right", fontFamily: "var(--mono)", fontSize: 12.5, whiteSpace: "nowrap" };
  const fmtCell = (m, col) => {
    if (!m) return "";
    const v = m[col.key];
    if (col.kind === "int") return window.fmt.int(v || 0);
    if (col.kind === "pct") return v != null ? String(v).replace(".", ",") + "%" : "";
    if (col.kind === "x") return v != null ? String(v).replace(".", ",") + "x" : (col.empty || "");
    return v != null ? money(v) : (col.empty || "");
  };
  const arrow = (key) => (sort.key === key ? (sort.dir === 1 ? " ↑" : " ↓") : "");
  const chip = (label, onClear) => (
    <span className="mono" style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 24, padding: "0 4px 0 10px", borderRadius: 999, fontSize: 11, border: "1px solid var(--accent-line)", background: "var(--accent-soft)", color: "var(--accent)" }}>
      {label}
      <button onClick={onClear} title="limpar filtro" style={{ fontSize: 12, padding: "0 6px", color: "var(--accent)" }}>✕</button>
    </span>
  );
  const nameOf = (lv, id) => ((objects[lv] || []).find((x) => String(x.id) === String(id))?.name) || id;
  const plural = (n, um, muitos) => (n === 1 ? um : muitos);
  const LEVELS = [
    ["campaigns", selCampaigns.size ? `Campanhas · ${selCampaigns.size} selecionada${selCampaigns.size > 1 ? "s" : ""}` : "Campanhas"],
    ["adsets", selCampaigns.size ? `Conjuntos de ${selCampaigns.size} ${plural(selCampaigns.size, "campanha", "campanhas")}` : "Conjuntos"],
    ["ads", selAdsets.size ? `Anúncios de ${selAdsets.size} ${plural(selAdsets.size, "conjunto", "conjuntos")}`
      : selCampaigns.size ? `Anúncios de ${selCampaigns.size} ${plural(selCampaigns.size, "campanha", "campanhas")}` : "Anúncios"],
  ];

  const selSetOf = (lv) => (lv === "campaigns" ? selCampaigns : lv === "adsets" ? selAdsets : null);
  const isChecked = (o) => !!selSetOf(level)?.has(String(o.id));
  const allChecked = level !== "ads" && rows.length > 0 && rows.every(({ o }) => isChecked(o));
  const toggleSelAll = () => {
    const ids = rows.map(({ o }) => String(o.id));
    if (level === "campaigns") {
      setSelCampaigns((prev) => { const n = new Set(prev); ids.forEach((id) => (allChecked ? n.delete(id) : n.add(id))); pruneAdsets(n); return n; });
    } else if (level === "adsets") {
      setSelAdsets((prev) => { const n = new Set(prev); ids.forEach((id) => (allChecked ? n.delete(id) : n.add(id))); return n; });
    }
  };
  const checkboxStyle = { width: 14, height: 14, accentColor: "var(--accent)", cursor: "pointer" };

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
        {selCampaigns.size > 0 && chip(
          selCampaigns.size === 1 ? `campanha: ${nameOf("campaigns", [...selCampaigns][0])}` : `${selCampaigns.size} campanhas`,
          () => { setSelCampaigns(new Set()); })}
        {selAdsets.size > 0 && chip(
          selAdsets.size === 1 ? `conjunto: ${nameOf("adsets", [...selAdsets][0])}` : `${selAdsets.size} conjuntos`,
          () => setSelAdsets(new Set()))}
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
              <th style={{ ...thStyle, width: 34 }}>
                {level !== "ads" && (
                  <input type="checkbox" checked={allChecked} onChange={toggleSelAll}
                    title={allChecked ? "desmarcar todos os visíveis" : "selecionar todos os visíveis (filtra os níveis de baixo)"}
                    style={checkboxStyle} />
                )}
              </th>
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
              const checked = isChecked(o);
              return (
                <tr key={o.id} style={checked ? { background: "var(--accent-soft)" } : undefined}>
                  <td style={{ ...td, paddingRight: 0 }}>
                    {level !== "ads" && (
                      <input type="checkbox" checked={checked} onChange={() => toggleSel(level, o.id)}
                        title="selecionar pra filtrar os níveis de baixo (como no Gerenciador)"
                        style={checkboxStyle} />
                    )}
                  </td>
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
                    : c.kind === "x" ? (totals[c.key] != null ? String(totals[c.key]).replace(".", ",") + "x" : "")
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

// ── Insights de escala ───────────────────────────────────────────────────────
// Sugestões por REGRA (explicáveis, sem IA): cruzam ROAS/receita por dor, CPL
// por anúncio e o breakdown de placement. Cada item diz o porquê com os números;
// a ação (pausar/orçamento) continua manual no card Anúncios. Render + dispensa
// (✕, 7 dias) no componente compartilhado components/insights.jsx — por isso os
// ids são estáveis por regra+alvo (sem números), senão a dispensa ressuscita.
const PLATFORM_LABEL = { facebook: "Facebook", instagram: "Instagram", audience_network: "Audience Network", messenger: "Messenger" };
const placementLabel = (r) => `${PLATFORM_LABEL[r.platform] || r.platform} · ${String(r.position || "").replaceAll("_", " ")}`;

function buildInsights(data, placements, objects) {
  const out = [];
  const x = (v) => String(v).replace(".", ",") + "x";
  const pains = (data.pains || []).filter((p) => p.code);

  // Melhor dor por ROAS → escalar (precisa de receita real, não só ganho).
  const withRoas = pains.filter((p) => p.roas != null);
  if (withRoas.length) {
    const best = [...withRoas].sort((a, b) => b.roas - a.roas)[0];
    out.push({ id: `escalar-dor:${best.code}`, meta: { kind: "raiseBudget", code: best.code }, tone: "escalar", tag: "Escalar", text: `A dor [${best.code}] ${best.label} tem o melhor retorno do período: ROAS ${x(best.roas)} (${money(best.revenue)} de receita sobre ${money(best.spend)} investidos). Vale subir o orçamento dos conjuntos que rodam essa dor.` });
  }
  // Dor que gasta, gera lead e não fecha nenhum → problema de fundo de funil.
  for (const p of pains.filter((p) => p.spend >= 100 && p.leads >= 3 && !p.won).slice(0, 2)) {
    out.push({ id: `dor-nao-fecha:${p.code}`, tone: "atencao", tag: "Atenção", text: `A dor [${p.code}] ${p.label} investiu ${money(p.spend)} e trouxe ${p.leads} leads, mas nenhum fechou. Antes de escalar, revise a qualificação desse público ou o pitch da call.` });
  }
  // Anúncio queimando: gastou ≥ 3× o CPL médio da conta sem gerar nenhum lead.
  // O gasto é do PERÍODO (ad_insights), então só vira insight se o anúncio está
  // veiculando AGORA (effectiveStatus vivo da conta) — anúncio já pausado ou com
  // campanha/conjunto pausado é histórico, não candidato a corte. Sem a lista
  // viva carregada, a regra fica muda em vez de sugerir corte de anúncio morto.
  const cplRef = data.totals?.cpl;
  const liveAds = objects && !objects.error ? new Map((objects.ads || []).map((o) => [String(o.id), o])) : null;
  if (cplRef && liveAds) {
    const delivering = (a) => (liveAds.get(String(a.id))?.effectiveStatus || liveAds.get(String(a.id))?.status) === "ACTIVE";
    for (const a of (data.ads || []).filter((a) => a.leads === 0 && a.spend >= 3 * cplRef && delivering(a))
      .sort((a, b) => b.spend - a.spend).slice(0, 2)) {
      out.push({ id: `ad-sem-lead:${a.id}`, meta: { kind: "pauseAd", adId: a.id, adName: a.name }, tone: "cortar", tag: "Cortar", text: `O anúncio “${a.name}” já gastou ${money(a.spend)} (3× o CPL médio de ${money(cplRef)}) sem gerar nenhum lead. Candidato a pausar no card Anúncios.` });
    }
  }
  // Placements: fatia relevante do gasto sem nenhum lead na visão da Meta.
  const rows = placements?.placements || [];
  const totalSpend = rows.reduce((s, r) => s + r.spend, 0);
  if (totalSpend > 0) {
    for (const r of rows.filter((r) => r.spend / totalSpend >= 0.12 && r.metaLeads === 0).slice(0, 2)) {
      out.push({ id: `placement-sem-lead:${r.platform}|${r.position}`, tone: "cortar", tag: "Cortar", text: `${placementLabel(r)} consome ${Math.round((r.spend / totalSpend) * 100)}% do investimento (${money(r.spend)}) sem nenhum lead na visão da Meta. Considere excluir esse posicionamento nos conjuntos.` });
    }
    // Diferença grande de CPL entre posicionamentos com gasto relevante.
    const withLeads = rows.filter((r) => r.cplMeta != null && r.spend >= totalSpend * 0.08);
    if (withLeads.length >= 2) {
      const sorted = [...withLeads].sort((a, b) => a.cplMeta - b.cplMeta);
      const best = sorted[0];
      const worst = sorted[sorted.length - 1];
      if (worst.cplMeta >= best.cplMeta * 2) {
        out.push({ id: `placement-gap:${best.platform}|${best.position}:${worst.platform}|${worst.position}`, tone: "atencao", tag: "Atenção", text: `${placementLabel(best)} converte a ${money(best.cplMeta)} por lead vs ${money(worst.cplMeta)} em ${placementLabel(worst)} (visão da Meta). Se a diferença persistir, concentre o orçamento no posicionamento mais barato.` });
      }
    }
  }
  return out.slice(0, 6);
}

// Ação executável de um insight (botão "aplicar" + popup de confirmação): só
// entra quando dá pra fazer com segurança pelas rotas que o cockpit já usa —
// pausar anúncio e orçamento de conjunto ABO. Insights de copy/pitch/placement
// ficam sem botão (a mudança é manual). Os `steps` do popup são os passos
// EXATOS, com valores; nada além deles é executado.
function withInsightAction(it, { data, objects }) {
  const m = it.meta;
  if (!m || !objects || objects.error) return it;
  if (m.kind === "pauseAd") {
    return {
      ...it,
      action: {
        label: "Pausar anúncio",
        steps: [`Pausar o anúncio “${m.adName}” na Meta — para de veicular na hora; dá pra reativar quando quiser no card Anúncios.`],
        execute: () => api.metaObjectStatus(m.adId, "PAUSED"),
      },
    };
  }
  if (m.kind === "raiseBudget") {
    // Conjuntos ABO ativos que rodam anúncios da dor; CBO (orçamento na
    // campanha) fica de fora pra não mexer na verba de outras dores junto.
    const adsetIds = new Set((data.ads || []).filter((a) => painCodeOf(a.name) === m.code).map((a) => String(a.adsetId || "")).filter(Boolean));
    const targets = (objects.adsets || []).filter((s) => adsetIds.has(String(s.id)) && s.dailyBudget > 0 && s.status !== "PAUSED");
    if (!targets.length) return it; // só CBO/pausados → sem ação automática segura
    const bump = (v) => Math.ceil(v * 1.2);
    return {
      ...it,
      action: {
        label: "Subir orçamento (+20%)",
        steps: targets.map((s) => `Conjunto “${s.name}”: orçamento diário ${money(s.dailyBudget)} → ${money(bump(s.dailyBudget))} (+20%), aplicado direto no Gerenciador da Meta.`),
        execute: async () => { for (const s of targets) await api.metaObjectBudget(s.id, bump(s.dailyBudget)); },
      },
    };
  }
  return it;
}

// Breakdown por placement: onde o dinheiro roda (plataforma × posição). Sem
// cruzamento com lead do cockpit — UTM não carrega placement — então leads/CPL
// são os reportados pela Meta.
function PlacementTable({ placements, money }) {
  const total = placements.reduce((s, r) => s + r.spend, 0);
  const ths = ["Posicionamento", "Investimento", "% do gasto", "Impressões", "Cliques link", "Leads (Meta)", "CPL (Meta)", "CPM"];
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
          {placements.map((r, i) => (
            <tr key={i}>
              <td style={{ padding: "11px 16px", fontSize: 13, fontWeight: 600, borderBottom: "1px solid var(--line-1)", whiteSpace: "nowrap" }}>{placementLabel(r)}</td>
              <td className="tnum" style={tdNum}>{money(r.spend)}</td>
              <td className="tnum" style={tdNum}>{total > 0 ? Math.round((r.spend / total) * 100) + "%" : ""}</td>
              <td className="tnum" style={tdNum}>{window.fmt.int(r.impressions)}</td>
              <td className="tnum" style={tdNum}>{window.fmt.int(r.linkClicks)}</td>
              <td className="tnum" style={tdNum}>{window.fmt.int(r.metaLeads)}</td>
              <td className="tnum" style={{ ...tdNum, fontWeight: 600 }}>{r.cplMeta != null ? money(r.cplMeta) : "sem lead"}</td>
              <td className="tnum" style={tdNum}>{r.cpm != null ? money(r.cpm) : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Quebra por dor: cada linha é um código "[X]" da nomenclatura dos anúncios.
// O que decide escala é a última coluna (ROAS: receita dos ganhos ÷ investimento),
// não o CPL.
// Célula de cliente A/B/C: contagem forte na cor da grade + quanto custou CADA
// um daquela grade (investido do grupo ÷ clientes da grade). "—" quando a
// dor/anúncio não trouxe ninguém da grade.
const GRADES = ["A", "B", "C"];
function GradeCell({ grade, count, cost, money }) {
  if (!count) return <span className="tnum" style={{ textAlign: "right", color: "var(--fg-4)" }}>—</span>;
  return (
    <span className="tnum" style={{ display: "inline-flex", flexDirection: "column", alignItems: "flex-end", gap: 1 }}>
      <span style={{ fontWeight: 700, color: GRADE_STYLE[grade].ink }}>{window.fmt.int(count)}</span>
      <span style={{ fontSize: 10.5, color: "var(--fg-4)", whiteSpace: "nowrap" }}>{cost != null ? `${money(cost)} cada` : ""}</span>
    </span>
  );
}

function PainTable({ pains, money }) {
  const cols = "1.6fr .8fr .55fr .7fr .6fr .6fr .6fr .55fr .6fr";
  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ display: "grid", gridTemplateColumns: cols, gap: 12, padding: "10px 24px", fontSize: 11, fontWeight: 600, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--fg-4)", borderTop: "1px solid var(--line-1)", background: "var(--bg-inset)" }}>
        <span>Dor</span><span style={{ textAlign: "right" }}>Investido</span><span style={{ textAlign: "right" }}>Leads</span><span style={{ textAlign: "right" }}>CPL</span>
        {GRADES.map((g) => (
          <span key={g} title={`clientes ${g} que a dor trouxe · custo por cada`} style={{ textAlign: "right", color: GRADE_STYLE[g].ink }}>Cliente {g}</span>
        ))}
        <span style={{ textAlign: "right" }}>Ganhos</span><span style={{ textAlign: "right" }}>ROAS</span>
      </div>
      {pains.filter((p) => p.code).map((p) => (
        <div key={p.code} style={{ display: "grid", gridTemplateColumns: cols, gap: 12, padding: "12px 24px", alignItems: "center", borderTop: "1px solid var(--line-faint)", fontSize: 13.5 }}>
          <span style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}><span className="mono code" style={{ marginRight: 7, fontSize: 12, color: "var(--fg-4)" }}>[{String(p.code).replace(/^\[|\]$/g, "")}]</span>{p.label}</span>
          <span className="tnum" style={{ textAlign: "right" }}>{money(p.spend)}</span>
          <span className="tnum" style={{ textAlign: "right" }}>{window.fmt.int(p.leads)}</span>
          <span className="tnum" style={{ textAlign: "right" }}>{p.cpl != null ? money(p.cpl) : "—"}</span>
          {GRADES.map((g) => (
            <GradeCell key={g} grade={g} count={p.abc?.[g] || 0} cost={p.abcCost?.[g]} money={money} />
          ))}
          <span className="tnum" style={{ textAlign: "right", fontWeight: 600 }}>{window.fmt.int(p.won)}</span>
          <span className="tnum" style={{ textAlign: "right", fontWeight: 600, color: p.roas == null ? "var(--fg-4)" : p.roas >= 3 ? "var(--pos)" : "var(--warn)" }}>{p.roas != null ? String(p.roas).replace(".", ",") + "x" : "—"}</span>
        </div>
      ))}
      {!pains.some((p) => p.code) && <div style={{ padding: "16px 24px", borderTop: "1px solid var(--line-faint)", color: "var(--fg-4)", fontSize: 12.5 }}>nenhuma dor atribuída no período</div>}
    </div>
  );
}

// Painel de novo criativo: vídeo do videomaker + dor + copy → anúncio PAUSADO
// no conjunto escolhido, nome "[A] variação" e UTMs da convenção. A revisão e a
// ativação seguem no Gerenciador da Meta.
// Criar anúncio CLONANDO um conjunto (o fluxo do Leo): escolhe a dor → a
// campanha [dor] é resolvida sozinha → escolhe o conjunto de origem pra clonar
// → sobe o vídeo. O servidor duplica o conjunto (leva público/orçamento/copy/
// anúncio), renomeia pra "<número do arquivo> [dor]" e troca só o vídeo. Pausado.
function CloneAdPanel({ product, campaigns, onDone, onError, onClose }) {
  const [defaults, setDefaults] = useState(null); // { painMap }
  const [pain, setPain] = useState("");           // código escolhido ou "_new"
  const [newPain, setNewPain] = useState({ code: "", label: "" });
  const [campaignId, setCampaignId] = useState("");
  const [adsets, setAdsets] = useState(null);
  const [sourceAdsetId, setSourceAdsetId] = useState("");
  const [file, setFile] = useState(null);
  const [numOverride, setNumOverride] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.creativeDefaults(product.id).then(setDefaults).catch(() => setDefaults({ painMap: {} }));
  }, [product.id]);

  const painMap = defaults?.painMap || {};
  const painCodeSel = pain === "_new" ? newPain.code.trim().toUpperCase() : pain;
  const painLabelSel = pain === "_new" ? newPain.label.trim() : painMap[pain] || "";
  const activeCamps = campaigns.filter((c) => c.effectiveStatus !== "ARCHIVED" && c.effectiveStatus !== "DELETED");
  // Campanhas cujo nome carrega o código da dor ([B]) — o alvo natural.
  const matches = painCodeSel ? activeCamps.filter((c) => painCodeOf(c.name) === painCodeSel) : [];

  // Ao escolher a dor, resolve a campanha sozinho quando há exatamente uma [dor].
  useEffect(() => {
    if (matches.length === 1) setCampaignId(matches[0].id);
    else if (matches.length === 0) setCampaignId("");
  }, [painCodeSel]); // eslint-disable-line react-hooks/exhaustive-deps

  // Conjuntos da campanha resolvida — o usuário escolhe qual clonar.
  useEffect(() => {
    if (!campaignId) { setAdsets(null); setSourceAdsetId(""); return; }
    setAdsets(null); setSourceAdsetId("");
    api.metaAdsets(campaignId)
      .then((r) => { setAdsets(r.adsets); if (r.adsets.length === 1) setSourceAdsetId(r.adsets[0].id); })
      .catch((e) => { setAdsets([]); onError(e.message || "Falha ao listar conjuntos."); });
  }, [campaignId]); // eslint-disable-line react-hooks/exhaustive-deps

  const detectedNumber = numOverride.trim() || (file ? fileNumberOf(file.name) : "");
  const finalName = painCodeSel && detectedNumber ? `${detectedNumber} [${painCodeSel}]` : "";
  const valid = painCodeSel && (pain !== "_new" || painLabelSel) && campaignId && sourceAdsetId && file && detectedNumber && !busy;

  async function submit() {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("painCode", painCodeSel);
      if (painLabelSel) fd.append("painLabel", painLabelSel);
      fd.append("sourceAdsetId", sourceAdsetId);
      if (numOverride.trim()) fd.append("number", numOverride.trim());
      fd.append("video", file, file.name);
      const r = await api.adFromVideo(product.id, fd);
      onDone(`Anúncio "${r.adsetName}" criado PAUSADO (conjunto clonado + vídeo trocado) — revise e ative no Gerenciador.`);
    } catch (e) {
      onError(e.message || "Falha ao criar o anúncio.");
    }
    setBusy(false);
  }

  const lbl = { display: "flex", flexDirection: "column", gap: 4 };
  const cap = { fontSize: 10.5, letterSpacing: "0.07em", textTransform: "uppercase", color: "var(--fg-3)" };
  const inp = { height: 30, padding: "0 10px", borderRadius: "var(--r-1)", border: "1px solid var(--line-2)", background: "var(--bg-1)", color: "var(--fg-1)", fontSize: 13 };

  return (
    <Card title="Criar anúncio" hint="clona o conjunto da dor e troca só o vídeo · nasce pausado com o nome «número [dor]»">
      <div style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10 }}>
          <label style={lbl}>
            <span className="mono" style={cap}>1 · Vídeo</span>
            <input type="file" accept="video/*" onChange={(e) => setFile(e.target.files?.[0] || null)}
              style={{ ...inp, paddingTop: 4, height: 30 }} />
          </label>
          <label style={lbl}>
            <span className="mono" style={cap}>2 · Dor do anúncio</span>
            <select value={pain} onChange={(e) => setPain(e.target.value)} style={inp}>
              <option value="">Selecione…</option>
              {Object.entries(painMap).map(([c, l]) => <option key={c} value={c}>[{c}] {l}</option>)}
              <option value="_new">+ nova dor…</option>
            </select>
          </label>
          <label style={lbl}>
            <span className="mono" style={cap}>Número (do arquivo)</span>
            <input type="text" placeholder={file ? (fileNumberOf(file.name) || "sem número no nome") : "sobe o vídeo"}
              value={numOverride} onChange={(e) => setNumOverride(e.target.value.replace(/[^\w-]/g, ""))}
              style={{ ...inp, fontFamily: "var(--mono)" }} />
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

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
          <label style={lbl}>
            <span className="mono" style={cap}>3 · Campanha {matches.length === 1 ? "(resolvida pela dor)" : matches.length > 1 ? "(várias [" + painCodeSel + "], escolha)" : ""}</span>
            <select value={campaignId} onChange={(e) => setCampaignId(e.target.value)} style={inp}>
              <option value="">{painCodeSel ? (matches.length ? "Selecione…" : `nenhuma campanha [${painCodeSel}] — escolha`) : "escolha a dor antes"}</option>
              {activeCamps.map((c) => <option key={c.id} value={c.id}>{painCodeOf(c.name) === painCodeSel ? "● " : ""}{c.name}</option>)}
            </select>
          </label>
          <label style={lbl}>
            <span className="mono" style={cap}>4 · Conjunto de origem (será clonado)</span>
            <select value={sourceAdsetId} onChange={(e) => setSourceAdsetId(e.target.value)} disabled={!campaignId} style={inp}>
              <option value="">{!campaignId ? "escolha a campanha" : adsets == null ? "carregando…" : "Selecione…"}</option>
              {(adsets || []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <button onClick={submit} disabled={!valid}
            style={{ height: 32, padding: "0 16px", borderRadius: "var(--r-1)", background: "var(--btn-bg, var(--accent))", color: "var(--btn-fg, var(--accent-fg))", fontSize: 13, fontWeight: 600, opacity: !valid ? 0.55 : 1 }}>
            {busy ? "Subindo vídeo e clonando… (pode levar uns minutos)" : "Criar anúncio pausado"}
          </button>
          <button onClick={onClose} disabled={busy} style={{ height: 32, padding: "0 10px", fontSize: 12.5, color: "var(--fg-3)" }}>cancelar</button>
          {finalName && <span className="mono dim" style={{ fontSize: 11.5 }}>nome final do conjunto e do anúncio: <b style={{ color: "var(--fg-2)" }}>{finalName}</b></span>}
        </div>
        <div className="mono dim" style={{ fontSize: 10.5, lineHeight: 1.5 }}>
          clona o conjunto escolhido (mantém público, orçamento, posicionamento, copy e CTA), troca só o vídeo pelo que você subiu e renomeia conjunto e anúncio pra «número [dor]». Nada gasta até você ativar no Gerenciador.
        </div>
      </div>
    </Card>
  );
}

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
            style={{ height: 32, padding: "0 16px", borderRadius: "var(--r-1)", background: "var(--btn-bg, var(--accent))", color: "var(--btn-fg, var(--accent-fg))", fontSize: 13, fontWeight: 600, opacity: !valid || busy ? 0.55 : 1 }}>
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
