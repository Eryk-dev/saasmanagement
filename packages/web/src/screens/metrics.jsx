import React from "react";
import { api } from "../lib/api.js";
import { useData } from "../data.jsx";
import { PageHead, Segmented, FilterTab, StatTile, Card } from "../components/viz.jsx";
import { painCodeOf } from "../lib/pains.js";
import { useActiveSaas } from "../lib/workspace.js";
import { EmptyState, PrimaryButton } from "../atoms.jsx";
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

// Teto do vídeo: a API aceita 500 MB e o nginx 512 MB. Barrar aqui evita subir
// o arquivo inteiro pra receber um 413 do proxy no fim do upload.
const MAX_VIDEO = 500 * 1024 * 1024;
const tooBig = (file) => file && file.size > MAX_VIDEO
  ? `vídeo de ${(file.size / 1024 / 1024).toFixed(0)} MB — o limite é 500 MB, comprima antes de subir`
  : "";

// A API responde o upload com um jobId e segue conversando com a Meta em
// background (subir + processar + clonar passa de 3 minutos, e requisição
// aberta esse tempo todo morre no timeout do proxy). Aqui só acompanhamos.
async function waitForVideoJob(jobId, onStep) {
  const deadline = Date.now() + 25 * 60 * 1000;
  for (;;) {
    await new Promise((r) => setTimeout(r, 3000));
    let job;
    try {
      job = await api.adVideoJob(jobId);
    } catch (e) {
      if (e.status === 404) throw new Error("perdi o acompanhamento (o servidor reiniciou) — confira no Gerenciador da Meta antes de subir de novo");
      throw e;
    }
    if (job.status === "done") return job;
    if (job.status === "error") throw new Error(job.error || "o servidor não conseguiu terminar");
    onStep(job.step || "processando");
    if (Date.now() > deadline) throw new Error("passou de 25 minutos sem terminar — confira no Gerenciador da Meta antes de subir de novo");
  }
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
// Atalhos do filtro de data PRÓPRIO do card Anúncios (o filtro do topo segue
// mandando no resto da tela). Valores no formato que o rangeOf entende.
const ADS_PERIODS = [
  { value: "1", label: "hoje" },
  { value: "yesterday", label: "ontem" },
  { value: "3", label: "3 dias" },
  { value: "7", label: "7 dias" },
  { value: "30", label: "30 dias" },
  { value: "life", label: "máximo" }, // tudo que já foi sincronizado do ad_insights
  { value: "custom", label: "personalizado" },
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

  // Métricas SÓ do card Anúncios, no range do filtro próprio dele — mesma
  // rota (ad_insights por id), busca separada pra não mexer no resto da tela.
  const [adsRange, setAdsRange] = useState({ preset: "30" });
  const { since: adsSince, until: adsUntil } = rangeOf(adsRange);
  const [adsData, setAdsData] = useState(null);
  const adsEpoch = React.useRef(0);
  const loadAds = (reset = false) => {
    if (!product) return;
    const ep = ++adsEpoch.current;
    if (reset) setAdsData(null);
    api.marketingMetrics(product.id, { since: adsSince, until: adsUntil })
      .then((v) => { if (ep === adsEpoch.current) setAdsData(v); })
      .catch(() => { if (ep === adsEpoch.current) setAdsData((prev) => prev || { error: true }); });
  };
  useEffect(() => loadAds(true), [product?.id, adsSince, adsUntil]); // eslint-disable-line react-hooks/exhaustive-deps

  // Mudança vinda do tempo real (SSE: lead criado/movido, sync do servidor)
  // recarrega SEM piscar — os números acompanham o pipeline na hora.
  const firstVersion = React.useRef(version);
  useEffect(() => {
    if (version !== firstVersion.current) { load(false); loadAds(false); }
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
  // O card Anúncios lê as métricas do RANGE PRÓPRIO dele (adsData); o resto da
  // tela segue no range do filtro do topo (data).
  const metricMaps = adsData && !adsData.error ? {
    campaigns: Object.fromEntries((adsData.campaigns || []).map((g) => [String(g.id), g])),
    adsets: Object.fromEntries((adsData.adsets || []).map((g) => [String(g.id), g])),
    ads: Object.fromEntries((adsData.ads || []).map((g) => [String(g.id), g])),
  } : null;
  const compactObjects = objects && !objects.error ? objects : adsData && !adsData.error ? {
    campaigns: adsData.campaigns || [], adsets: adsData.adsets || [], ads: adsData.ads || [],
  } : null;

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, overflow: "auto" }}>
      <PageHead title="Publicidade" sub={<span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>aquisição, funil e campanhas · <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--fg-2)", fontSize: 12.5, fontWeight: 500 }}><span style={{ width: 6, height: 6, borderRadius: 99, background: metaOn && product.metaAdAccount ? "var(--pos)" : "var(--fg-4)" }} />{metaOn && product.metaAdAccount ? "Meta conectada" : "Meta não conectada"}</span></span>}>
        {metaOn && product.metaAdAccount && (
          <PrimaryButton onClick={() => { setCloneAd((v) => !v); setCreative(false); }}>+ criar anúncio</PrimaryButton>
        )}
        {metaOn && product.metaAdAccount && (
          <button onClick={() => { setCreative((v) => !v); setCloneAd(false); }}
            title="Criar um anúncio do zero (escolhe copy, CTA e link)"
            style={{ height: 32, padding: "0 12px", borderRadius: "var(--r-2)", fontSize: 12.5, fontWeight: 500, border: "1px solid var(--line-2)", background: "var(--bg-1)", color: "var(--fg-2)" }}>
            + criativo do zero
          </button>
        )}
        <button onClick={() => setManual(manual ? null : { date: new Date().toISOString().slice(0, 10), name: "", spend: "" })}
          style={{ height: 32, padding: "0 12px", borderRadius: "var(--r-2)", fontSize: 12.5, fontWeight: 500, border: "1px solid var(--line-2)", background: "var(--bg-1)", color: "var(--fg-2)" }}>
          + gasto manual
        </button>
        {metaOn && (
          <button onClick={sync} disabled={syncing}
            title="Sincroniza o período filtrado agora (além do automático do servidor)"
            style={{ height: 32, padding: "0 12px", borderRadius: "var(--r-2)", fontSize: 12.5, fontWeight: 500, border: "1px solid var(--line-2)", background: "var(--bg-1)", color: "var(--fg-2)", opacity: syncing ? 0.6 : 1 }}>
            {syncing ? "Sincronizando…" : "↻ sincronizar"}
          </button>
        )}
        {liveAt && (
          <span className="mono" title="Sync automático no servidor (último horário mostrado); leads chegam na hora via tempo real"
            style={{ fontSize: 10.5, color: "var(--pos)", display: "inline-flex", alignItems: "center", gap: 4 }}>
            <span style={{ width: 6, height: 6, borderRadius: 99, background: "var(--pos)" }} />
            ao vivo · {liveAt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
          </span>
        )}
        {PERIODS.map((period) => <FilterTab key={period.value} active={range.preset === period.value} onClick={() => setRange({ preset: period.value })}>{period.label}</FilterTab>)}
      </PageHead>

      <div style={{ padding: "16px var(--pad-x) 56px", display: "flex", flexDirection: "column", gap: 16 }}>
        {note && (
          <div className="mono" style={{ fontSize: 12, color: note.ok ? "var(--pos)" : "var(--neg)" }}>{note.text}</div>
        )}

        {cloneAd && (
          <CloneAdPanel key={"clone-" + product.id} product={product} campaigns={objects && !objects.error ? objects.campaigns : []}
            onDone={(msg) => { setNote({ ok: true, text: msg }); setCloneAd(false); load(); }}
            onError={(msg) => setNote({ ok: false, text: msg })}
            onClose={() => setCloneAd(false)} />
        )}

        {creative && (
          <NewCreativePanel key={product.id} product={product} campaigns={objects && !objects.error ? objects.campaigns : []}
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
              <button onClick={saveManual} style={{ height: 30, padding: "0 14px", borderRadius: "var(--r-1)", background: "var(--btn-bg, var(--accent))", color: "var(--btn-fg, var(--accent-fg))", fontSize: 13, fontWeight: 600 }}>Registrar</button>
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
                <button onClick={sync} disabled={syncing} style={{ padding: "8px 14px", borderRadius: "var(--r-1)", fontSize: 13, fontWeight: 600, background: "var(--btn-bg, var(--accent))", color: "var(--btn-fg, var(--accent-fg))", opacity: syncing ? 0.6 : 1 }}>
                  {syncing ? "Sincronizando…" : "Sincronizar agora"}
                </button>
              )}
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
                <div key={s.stage} style={{ display: "grid", gridTemplateColumns: "minmax(72px, 150px) 1fr minmax(64px, 92px) minmax(40px, 60px)", gap: 12, alignItems: "center" }}>
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

        <CompactAdsCard saas={product.id} objects={compactObjects} metrics={metricMaps} money={money} busyIds={busyIds}
          range={adsRange} onRange={setAdsRange}
          onToggle={objects && !objects.error ? toggleObject : null}
          onBudget={objects && !objects.error ? commitBudget : null} error={objects?.error} />
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
// Colunas do card Anúncios — modeláveis: o botão "Colunas" liga/desliga cada
// uma (persistido no navegador, chave cockpit_ads_cols). `on` marca o conjunto
// padrão; a ordem aqui é a ordem na tela; width é a trilha do grid.
// Número pra ordenação: vazio/NaN vira -Infinity (cai no fim em qualquer direção).
const numOr = (v) => (v == null || v === "" || Number.isNaN(Number(v)) ? -Infinity : Number(v));

const ADS_COLS = [
  { key: "status", label: "Status", width: "115px", left: true, on: true },
  { key: "budget", label: "Orçamento/dia", width: "150px", on: true, hint: "orçamento diário · editar e confirmar ✓ replica no Gerenciador" },
  { key: "spend", label: "Investido", width: "95px", on: true },
  { key: "leads", label: "Leads", width: "55px", on: true },
  { key: "abc", label: "Clientes ABC", width: "150px", on: true, hint: "clientes A/B/C atribuídos (UTM) · custo por cada" },
  { key: "cpl", label: "CPL", width: "80px", on: true, hint: "investimento ÷ leads reais do cockpit (UTM)" },
  { key: "ctr", label: "CTR link", width: "70px", on: true, hint: "cliques no link ÷ impressões" },
  { key: "cpc", label: "CPC link", width: "85px", on: true, hint: "investido ÷ cliques no link" },
  { key: "won", label: "Conversões", width: "85px", on: true, hint: "conversões: leads atribuídos (UTM) que viraram ganho" },
  { key: "revenue", label: "Valor conv.", width: "95px", on: true, hint: "valor convertido: soma do valor dos negócios ganhos" },
  { key: "play3s", label: "3s play", width: "70px", on: true, hint: "reproduções de 3s ÷ impressões" },
  // Leads/CPL pela ATRIBUIÇÃO DA META (metaLeads do insight) — pra reconciliar
  // com o Gerenciador: a Meta credita pelo modelo dela (clique 7d + view 1d, na
  // data do clique) e cobre a vida toda do anúncio; o cockpit conta lead REAL
  // do CRM por UTM de último clique (cadeia completa só a partir de ~08/07).
  { key: "metaLeads", label: "Leads Meta", width: "80px", on: false, hint: "leads que a META atribui ao anúncio (modelo dela) · compare com Leads (UTM real do CRM)" },
  { key: "cplMeta", label: "CPL Meta", width: "85px", on: false, hint: "investido ÷ leads atribuídos pela Meta" },
  { key: "impressions", label: "Impressões", width: "95px", on: false },
  { key: "linkClicks", label: "Cliques link", width: "90px", on: false, hint: "cliques no link (inline link clicks)" },
  { key: "cpm", label: "CPM", width: "80px", on: false, hint: "custo por mil impressões" },
  { key: "costPerWin", label: "R$ / conversão", width: "105px", on: false, hint: "investimento ÷ conversões do período" },
  { key: "roas", label: "ROAS", width: "70px", on: false, hint: "receita dos ganhos ÷ investimento" },
  { key: "videoP25", label: "Vídeo 25%", width: "85px", on: false, hint: "espectadores que passaram de 25% do vídeo" },
  { key: "videoP50", label: "Vídeo 50%", width: "85px", on: false, hint: "espectadores que passaram da metade do vídeo" },
  { key: "videoP95", label: "Vídeo 95%", width: "85px", on: false, hint: "espectadores que chegaram a 95% do vídeo" },
];
const adsColsDefault = () => new Set(ADS_COLS.filter((c) => c.on).map((c) => c.key));
// Ordem das colunas modeláveis — arrastável pelo cabeçalho. Status fica pregado
// na frente (checkbox/toggle/nome nem entram: são estruturais do grid).
const adsOrderDefault = () => ADS_COLS.map((c) => c.key).filter((k) => k !== "status");
// Altura da tabela: mostra até 10 linhas; o resto fica atrás do "ver mais".
const ADS_MAX_ROWS = 10;
// Inputs de/até do "personalizado" do card Anúncios.
const dateInputStyle = { height: 30, padding: "0 8px", borderRadius: "var(--r-2)", border: "1px solid var(--line-2)", background: "var(--bg-1)", color: "var(--fg-1)", fontSize: 12.5 };

// Filtro de data do card Anúncios: presets + máximo + personalizado com popover
// de calendário. Escolher "personalizado" grava de/até EXPLÍCITOS no range (nada
// de default silencioso) e abre o popover já com o calendário nativo do "de";
// o chip ao lado mostra o intervalo aplicado e reabre o popover. Escolher uma
// data que cruza a outra arrasta a outra junto (sem swap mudo).
function AdsRangePicker({ range, onRange }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const wrapRef = React.useRef(null);
  const sinceRef = React.useRef(null);
  const today = dayStr(Date.now());
  const since = range.since || today, until = range.until || today;
  const openPopover = () => {
    const r = wrapRef.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 6, right: Math.max(8, window.innerWidth - r.right) });
    setOpen(true);
    setTimeout(() => { try { sinceRef.current?.showPicker?.(); } catch { /* navegador sem showPicker */ } }, 60);
  };
  const choose = (v) => {
    if (v === "custom") { onRange({ preset: "custom", since, until }); openPopover(); }
    else { setOpen(false); onRange({ ...range, preset: v }); }
  };
  const setSince = (v) => { if (v) onRange({ preset: "custom", since: v, until: until < v ? v : until }); };
  const setUntil = (v) => { if (v) onRange({ preset: "custom", until: v, since: since > v ? v : since }); };
  const fmt = (s) => `${s.slice(8, 10)}/${s.slice(5, 7)}`;
  return (
    <span ref={wrapRef} style={{ display: "inline-flex", alignItems: "center", gap: 6, maxWidth: "100%", minWidth: 0 }}>
      {/* No mobile as 7 opções não cabem no header do card: o grupo rola na
          horizontal em vez de o overflow:hidden cortar "hoje"/"personalizado". */}
      <span style={{ maxWidth: "100%", overflowX: "auto", display: "inline-flex", flexShrink: 1 }}>
        <Segmented value={range.preset} onChange={choose} options={ADS_PERIODS} />
      </span>
      {range.preset === "custom" && (
        <button className="mono tnum" onClick={openPopover} title="mudar o intervalo"
          style={{ height: 30, padding: "0 10px", borderRadius: "var(--r-2)", border: "1px solid var(--accent-line)", background: "var(--accent-soft)", color: "var(--accent)", fontSize: 12, fontWeight: 600, whiteSpace: "nowrap" }}>
          {fmt(since)} até {fmt(until)}
        </button>
      )}
      {open && pos && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 60 }} />
          <div style={{ position: "fixed", top: pos.top, right: pos.right, zIndex: 61, width: 218, background: "var(--bg-1)", border: "1px solid var(--line-2)", borderRadius: "var(--r-3)", boxShadow: "var(--shadow-pop)", padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
            <span className="mono" style={{ fontSize: 10, letterSpacing: "0.07em", textTransform: "uppercase", color: "var(--fg-4)" }}>Período personalizado</span>
            <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span className="mono dim" style={{ width: 24, fontSize: 10.5 }}>de</span>
              <input ref={sinceRef} type="date" value={since} max={today} onChange={(e) => setSince(e.target.value)} style={{ ...dateInputStyle, flex: 1 }} />
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span className="mono dim" style={{ width: 24, fontSize: 10.5 }}>até</span>
              <input type="date" value={until} min={since} max={today} onChange={(e) => setUntil(e.target.value)} style={{ ...dateInputStyle, flex: 1 }} />
            </label>
            <button onClick={() => setOpen(false)}
              style={{ height: 30, borderRadius: "var(--r-2)", border: "1px solid var(--accent)", background: "var(--accent)", color: "var(--accent-fg)", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>
              aplicar
            </button>
          </div>
        </>
      )}
    </span>
  );
}

// Botão "Colunas" + popover de checkboxes (o "Personalizar colunas" do
// Gerenciador). Posição FIXA calculada do botão — escapa do overflow:hidden
// do card; o overlay fecha no clique fora.
function ColumnPicker({ visible, onToggle, onReset }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const btnRef = React.useRef(null);
  const toggleOpen = () => {
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 6, right: Math.max(8, window.innerWidth - r.right) });
    }
    setOpen((v) => !v);
  };
  return (
    <span style={{ position: "relative", display: "inline-flex" }}>
      <button ref={btnRef} onClick={toggleOpen} title="escolher as colunas da tabela" style={{
        display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 12px",
        borderRadius: "var(--r-2)", border: "1px solid var(--line-2)",
        background: open ? "var(--bg-2)" : "var(--bg-1)", color: "var(--fg-2)", fontSize: 13, fontWeight: 500,
      }}>
        Colunas <span className="mono" style={{ fontSize: 10.5, color: "var(--fg-4)" }}>{visible.size}</span>
      </button>
      {open && pos && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 60 }} />
          <div style={{
            position: "fixed", top: pos.top, right: pos.right, zIndex: 61, width: 232,
            maxHeight: "min(420px, 70vh)", overflowY: "auto", background: "var(--bg-1)",
            border: "1px solid var(--line-2)", borderRadius: "var(--r-3)", boxShadow: "var(--shadow-pop)", padding: 6,
          }}>
            {ADS_COLS.map((c) => (
              <label key={c.key} title={c.hint} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", borderRadius: 6, fontSize: 12.5, color: "var(--fg-1)", cursor: "pointer" }}>
                <input type="checkbox" checked={visible.has(c.key)} onChange={() => onToggle(c.key)}
                  style={{ width: 14, height: 14, accentColor: "var(--accent)", cursor: "pointer", flexShrink: 0 }} />
                {c.label}
              </label>
            ))}
            <button onClick={onReset} style={{ width: "100%", marginTop: 4, padding: "7px 8px", borderRadius: 6, fontSize: 12, color: "var(--fg-3)", background: "var(--bg-2)" }}>
              restaurar padrão
            </button>
          </div>
        </>
      )}
    </span>
  );
}

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

function CompactAdsCard({ saas, objects, metrics, money, busyIds, range, onRange, onToggle, onBudget, error }) {
  const [level, setLevel] = useState("campaigns");
  const [creativeAd, setCreativeAd] = useState(null); // anúncio com o criativo aberto no modal
  // Seleção estilo Gerenciador: checkbox nas linhas — campanhas marcadas
  // filtram a aba Conjuntos, conjuntos marcados filtram a de Anúncios. Clicar
  // no NOME é o atalho que seleciona SÓ aquela linha e desce um nível. Trocar
  // de aba NÃO limpa a seleção (igual ao Gerenciador) — limpar é no chip ✕,
  // desmarcando o checkbox ou pelo "todos" do cabeçalho.
  const [selCampaigns, setSelCampaigns] = useState(() => new Set());
  const [selAdsets, setSelAdsets] = useState(() => new Set());
  // Filtro de veiculação com "ativas" pré-selecionado — julga pelo status
  // EFETIVO (pausa herdada do pai conta como pausada); item sem estado vivo
  // (fallback só com métricas históricas) não some da lista.
  const [statusFilter, setStatusFilter] = useState("active");
  // Colunas modeláveis: a escolha vive no navegador; chave desconhecida de
  // versão antiga é descartada (se não sobrar nada, volta pro padrão).
  const [visCols, setVisCols] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("cockpit_ads_cols") || "null");
      if (Array.isArray(saved)) {
        const known = saved.filter((k) => ADS_COLS.some((c) => c.key === k));
        if (known.length) return new Set(known);
      }
    } catch { /* padrão */ }
    return adsColsDefault();
  });
  const toggleCol = (key) => setVisCols((prev) => {
    const n = new Set(prev);
    n.has(key) ? n.delete(key) : n.add(key);
    try { localStorage.setItem("cockpit_ads_cols", JSON.stringify(ADS_COLS.map((c) => c.key).filter((k) => n.has(k)))); } catch { /* fica só na sessão */ }
    return n;
  });
  const resetCols = () => {
    try { localStorage.removeItem("cockpit_ads_cols"); localStorage.removeItem("cockpit_ads_cols_order"); } catch { /* ignore */ }
    setVisCols(adsColsDefault());
    setColOrder(adsOrderDefault());
  };
  // Ordem das colunas: arrasta o CABEÇALHO pra esquerda/direita (HTML5 DnD).
  // Checkbox, toggle, nome e Status ficam fixos; o resto reordena e persiste
  // no navegador (cockpit_ads_cols_order; chave desconhecida é descartada e
  // coluna nova de versão futura entra no fim, na ordem padrão).
  const [colOrder, setColOrder] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("cockpit_ads_cols_order") || "null");
      if (Array.isArray(saved)) {
        const known = saved.filter((k) => k !== "status" && ADS_COLS.some((c) => c.key === k));
        if (known.length) return [...known, ...adsOrderDefault().filter((k) => !known.includes(k))];
      }
    } catch { /* padrão */ }
    return adsOrderDefault();
  });
  const [dragCol, setDragCol] = useState(null);
  const [overCol, setOverCol] = useState(null);
  // Ordenação por coluna: clicar no cabeçalho cicla desc → asc → nenhuma (volta
  // pra ordem da Meta). Só uma coluna ativa por vez; "—" (sem valor) sempre no fim.
  const [sort, setSort] = useState({ key: null, dir: "desc" });
  const toggleSort = (key) => setSort((s) => (s.key !== key ? { key, dir: "desc" } : s.dir === "desc" ? { key, dir: "asc" } : { key: null, dir: "desc" }));
  const moveCol = (fromKey, toKey) => {
    if (!fromKey || !toKey || fromKey === toKey) return;
    setColOrder((prev) => {
      const from = prev.indexOf(fromKey), to = prev.indexOf(toKey);
      if (from < 0 || to < 0) return prev;
      // solta em cima de uma coluna: indo pra direita entra DEPOIS dela, indo
      // pra esquerda entra ANTES — o mesmo gesto do Gerenciador.
      const arr = prev.filter((k) => k !== fromKey);
      arr.splice(arr.indexOf(toKey) + (from < to ? 1 : 0), 0, fromKey);
      try { localStorage.setItem("cockpit_ads_cols_order", JSON.stringify(arr)); } catch { /* fica só na sessão */ }
      return arr;
    });
  };
  // "ver mais": a lista mostra até ADS_MAX_ROWS linhas; expandir vale até
  // trocar de aba de nível (aí volta a encolher).
  const [expanded, setExpanded] = useState(false);

  const levels = [
    { value: "campaigns", label: "Campanhas", singular: "Campanha" },
    { value: "adsets", label: "Conjuntos", singular: "Conjunto" },
    { value: "ads", label: "Anúncios", singular: "Anúncio" },
  ];
  const current = levels.find((item) => item.value === level);

  const matchStatus = (o) => {
    if (statusFilter === "all") return true;
    const eff = o.effectiveStatus || o.status;
    if (!eff) return true; // sem estado vivo (só métricas) — não esconde
    return statusFilter === "active" ? eff === "ACTIVE" : eff !== "ACTIVE";
  };
  const all = objects?.[level] || [];
  const base = level === "campaigns" ? all
    : level === "adsets" ? all.filter((s) => !selCampaigns.size || selCampaigns.has(String(s.campaignId)))
    : all.filter((a) => (!selCampaigns.size || selCampaigns.has(String(a.campaignId))) && (!selAdsets.size || selAdsets.has(String(a.adsetId))));
  const rows = base.filter(matchStatus);

  // Valor numérico de uma coluna pra ordenar (mesma fonte do render, `m`).
  // NaN/ausente vira -Infinity → cai no fim em qualquer direção (regra do "—").
  const sortNum = (key, object, m) => {
    if (key === "budget") { const b = object?.dailyBudget ?? object?.lifetimeBudget; return b == null ? -Infinity : Number(b); }
    if (key === "cpc") return numOr(m?.costPerLinkClick);
    if (key === "play3s") { const imp = Number(m?.impressions) || 0; return imp > 0 && m?.video3s != null ? Number(m.video3s) / imp : -Infinity; }
    if (key === "abc") { const a = m?.abc; return a ? (a.A + a.B + a.C + a.D + a.E) : -Infinity; }
    return numOr(m?.[key]);
  };
  const sortedRows = sort.key
    ? [...rows].sort((a, b) => {
        const va = sortNum(sort.key, a, metrics?.[level]?.[String(a.id)] || a);
        const vb = sortNum(sort.key, b, metrics?.[level]?.[String(b.id)] || b);
        if (va === -Infinity && vb === -Infinity) return 0;
        if (va === -Infinity) return 1;
        if (vb === -Infinity) return -1;
        return sort.dir === "asc" ? va - vb : vb - va;
      })
    : rows;

  // Poda conjuntos selecionados que saíram do recorte quando a seleção de
  // campanhas muda (senão a aba Anúncios filtraria por um conjunto invisível).
  const pruneAdsets = (camps) => setSelAdsets((prev) => (camps.size
    ? new Set([...prev].filter((sid) => {
        const st = (objects?.adsets || []).find((x) => String(x.id) === sid);
        return st && camps.has(String(st.campaignId));
      }))
    : prev));
  const toggleSel = (o) => {
    const key = String(o.id);
    if (level === "campaigns") {
      setSelCampaigns((prev) => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); pruneAdsets(n); return n; });
    } else if (level === "adsets") {
      setSelAdsets((prev) => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });
    }
  };
  const selSet = level === "campaigns" ? selCampaigns : level === "adsets" ? selAdsets : null;
  const allChecked = !!selSet && rows.length > 0 && rows.every((o) => selSet.has(String(o.id)));
  const toggleSelAll = () => {
    const ids = rows.map((o) => String(o.id));
    if (level === "campaigns") {
      setSelCampaigns((prev) => { const n = new Set(prev); ids.forEach((id) => (allChecked ? n.delete(id) : n.add(id))); pruneAdsets(n); return n; });
    } else if (level === "adsets") {
      setSelAdsets((prev) => { const n = new Set(prev); ids.forEach((id) => (allChecked ? n.delete(id) : n.add(id))); return n; });
    }
  };
  const changeLevel = (v) => { setLevel(v); setExpanded(false); };
  const drill = (o) => {
    if (level === "campaigns") { const n = new Set([String(o.id)]); setSelCampaigns(n); pruneAdsets(n); changeLevel("adsets"); }
    else if (level === "adsets") { setSelAdsets(new Set([String(o.id)])); changeLevel("ads"); }
  };

  const delivery = (object) => {
    const status = object.effectiveStatus || object.status;
    return DELIVERY[status] || { label: status ? String(status).toLowerCase().replaceAll("_", " ") : "sem status", tone: "var(--fg-4)" };
  };
  const nameOf = (lv, id) => ((objects?.[lv] || []).find((x) => String(x.id) === String(id))?.name) || id;
  const chip = (label, onClear) => (
    <span className="mono" style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 24, padding: "0 4px 0 10px", borderRadius: 999, fontSize: 11, border: "1px solid var(--accent-line)", background: "var(--accent-soft)", color: "var(--accent)" }}>
      {label}
      <button onClick={onClear} title="limpar seleção" style={{ fontSize: 12, padding: "0 6px", color: "var(--accent)" }}>✕</button>
    </span>
  );
  const pct = (v) => (v != null ? String(v).replace(".", ",") + "%" : "—");
  const right = { textAlign: "right" };

  // Régua do grid: checkbox + toggle + nome flexível + colunas VISÍVEIS (a
  // mesma no cabeçalho e nas linhas); o card rola na horizontal por arrasto
  // (DragScroll) — a largura mínima acompanha as colunas ligadas.
  const visible = ["status", ...colOrder]
    .filter((k) => visCols.has(k))
    .map((k) => ADS_COLS.find((c) => c.key === k))
    .filter(Boolean);
  const cols = "28px 46px minmax(190px,1.6fr) " + visible.map((c) => c.width).join(" ");
  const minW = 28 + 46 + 190 + visible.reduce((a, c) => a + parseInt(c.width, 10), 0) + 12 * (visible.length + 2) + 48;
  const checkboxStyle = { width: 14, height: 14, accentColor: "var(--accent)", cursor: "pointer" };

  // Linha de TOTAIS do bloco: soma TODAS as linhas do recorte atual (filtro de
  // status + seleção), inclusive as que estão atrás do "ver mais". Só o que é
  // contagem/dinheiro soma; taxa e custo são RECALCULADOS do total, porque
  // média de CPL não é o CPL do bloco (linha cara com 1 lead pesaria igual a
  // uma barata com 40).
  const SUMMABLE = ["spend", "leads", "metaLeads", "won", "revenue", "impressions", "linkClicks", "video3s", "videoP25", "videoP50", "videoP95"];
  const round2 = (n) => Math.round(n * 100) / 100;
  const totals = (() => {
    if (!rows.length) return null;
    const t = { abc: { A: 0, B: 0, C: 0 } };
    const has = new Set();
    let dailyBudget = 0, hasBudget = false;
    for (const o of rows) {
      const m = metrics?.[level]?.[String(o.id)] || o;
      for (const k of SUMMABLE) {
        const v = Number(m?.[k]);
        if (Number.isFinite(v)) { t[k] = (t[k] || 0) + v; has.add(k); }
      }
      if (m?.abc) { for (const g of GRADES) t.abc[g] += Number(m.abc[g]) || 0; has.add("abc"); }
      if (o.dailyBudget != null) { dailyBudget += Number(o.dailyBudget) || 0; hasBudget = true; }
    }
    for (const k of SUMMABLE) if (!has.has(k)) t[k] = null;
    if (!has.has("abc")) t.abc = null;
    const spend = t.spend || 0;
    t.spend = round2(spend);
    t.cpl = t.leads > 0 ? round2(spend / t.leads) : null;
    t.cplMeta = t.metaLeads > 0 ? round2(spend / t.metaLeads) : null;
    t.ctr = t.impressions > 0 ? Math.round((t.linkClicks / t.impressions) * 10000) / 100 : null;
    t.cpm = t.impressions > 0 ? round2((spend / t.impressions) * 1000) : null;
    t.costPerLinkClick = t.linkClicks > 0 ? round2(spend / t.linkClicks) : null;
    t.costPerWin = t.won > 0 ? round2(spend / t.won) : null;
    t.roas = spend > 0 && t.revenue > 0 ? round2(t.revenue / spend) : null;
    t.abcCost = t.abc ? Object.fromEntries(GRADES.map((g) => [g, t.abc[g] > 0 ? round2(spend / t.abc[g]) : null])) : null;
    return { m: t, dailyBudget: hasBudget ? dailyBudget : null };
  })();

  // Célula de cada coluna — todas leem `m` (métricas do período por id) e o
  // objeto vivo; "—" = ainda sem dado sincronizado naquele range, não é zero.
  const cell = (col, object, m, state) => {
    const leads = Number(m?.leads) || 0;
    const spend = Number(m?.spend) || 0;
    switch (col.key) {
      case "status": return (
        <span key={col.key} style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--fg-2)" }}>
          <span style={{ width: 7, height: 7, borderRadius: 99, background: state.tone }} />{state.label}
        </span>
      );
      case "budget":
        if (object.dailyBudget != null && onBudget) return <BudgetCell key={col.key} o={object} onCommit={(v) => onBudget(level, object, v)} />;
        if (object.lifetimeBudget != null) return (
          <span key={col.key} style={{ display: "inline-flex", flexDirection: "column", alignItems: "flex-end", gap: 1 }}>
            <span className="mono" style={{ fontSize: 12.5 }}>{money(object.lifetimeBudget)}</span>
            <span className="mono" style={{ fontSize: 9, color: "var(--fg-4)" }}>total</span>
          </span>
        );
        return (
          <span key={col.key} className="mono" style={{ textAlign: "right", fontSize: 10.5, color: "var(--fg-4)" }}
            title={level === "campaigns" ? "orçamento definido nos conjuntos (ABO)" : "orçamento definido na campanha (CBO)"}>
            {object.status && level === "campaigns" ? "no conjunto" : object.status && level === "adsets" ? "na campanha" : ""}
          </span>
        );
      case "spend": return <span key={col.key} className="tnum" style={right}>{money(spend)}</span>;
      case "leads": return <span key={col.key} className="tnum" style={right}>{window.fmt.int(leads)}</span>;
      case "abc": return <AbcCell key={col.key} abc={m?.abc} abcCost={m?.abcCost} money={money} />;
      case "cpl": {
        const cpl = m?.cpl != null ? m.cpl : leads ? spend / leads : null;
        return <span key={col.key} className="tnum" style={right}>{cpl != null ? money(cpl) : "—"}</span>;
      }
      case "ctr": return <span key={col.key} className="tnum" style={right}>{pct(m?.ctr)}</span>;
      case "cpc": return <span key={col.key} className="tnum" style={right}>{m?.costPerLinkClick != null ? money(m.costPerLinkClick) : "—"}</span>;
      case "won": return <span key={col.key} className="tnum" style={{ ...right, fontWeight: 600 }}>{m?.won != null ? window.fmt.int(m.won) : "—"}</span>;
      case "revenue": return <span key={col.key} className="tnum" style={{ ...right, fontWeight: 600 }}>{m?.revenue != null && m.revenue > 0 ? money(m.revenue) : "—"}</span>;
      case "play3s": {
        const impressions = Number(m?.impressions) || 0;
        const play3s = impressions > 0 && m?.video3s != null ? Math.round((Number(m.video3s) / impressions) * 1000) / 10 : null;
        return <span key={col.key} className="tnum" style={right}>{pct(play3s)}</span>;
      }
      case "metaLeads": return <span key={col.key} className="tnum" style={right}>{m?.metaLeads != null ? window.fmt.int(m.metaLeads) : "—"}</span>;
      case "cplMeta": return <span key={col.key} className="tnum" style={right}>{m?.cplMeta != null ? money(m.cplMeta) : "—"}</span>;
      case "impressions": return <span key={col.key} className="tnum" style={right}>{m?.impressions != null ? window.fmt.int(m.impressions) : "—"}</span>;
      case "linkClicks": return <span key={col.key} className="tnum" style={right}>{m?.linkClicks != null ? window.fmt.int(m.linkClicks) : "—"}</span>;
      case "cpm": return <span key={col.key} className="tnum" style={right}>{m?.cpm != null ? money(m.cpm) : "—"}</span>;
      case "costPerWin": return <span key={col.key} className="tnum" style={right}>{m?.costPerWin != null ? money(m.costPerWin) : "—"}</span>;
      case "roas": return <span key={col.key} className="tnum" style={{ ...right, fontWeight: 600 }}>{m?.roas != null ? String(m.roas).replace(".", ",") + "x" : "—"}</span>;
      case "videoP25": case "videoP50": case "videoP95":
        return <span key={col.key} className="tnum" style={right}>{m?.[col.key] != null ? window.fmt.int(m[col.key]) : "—"}</span>;
      default: return <span key={col.key} />;
    }
  };

  return (
    <Card title="Anúncios" hint="estilo Gerenciador · seleção filtra os níveis de baixo · colunas no botão"
      action={
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
          {range && onRange && <AdsRangePicker range={range} onRange={onRange} />}
          <Segmented value={statusFilter} onChange={setStatusFilter}
            options={[{ value: "active", label: "ativas" }, { value: "paused", label: "pausadas" }, { value: "all", label: "todas" }]} />
          <Segmented value={level} onChange={changeLevel} options={levels.map(({ value, label }) => ({ value, label }))} />
          <ColumnPicker visible={visCols} onToggle={toggleCol} onReset={resetCols} />
        </span>
      }
      style={{ overflow: "hidden" }}>
      {(selCampaigns.size > 0 || selAdsets.size > 0) && (
        <div style={{ display: "flex", gap: 8, padding: "12px 24px 12px", flexWrap: "wrap" }}>
          {selCampaigns.size > 0 && chip(
            selCampaigns.size === 1 ? `campanha: ${nameOf("campaigns", [...selCampaigns][0])}` : `${selCampaigns.size} campanhas selecionadas`,
            () => setSelCampaigns(new Set()))}
          {selAdsets.size > 0 && chip(
            selAdsets.size === 1 ? `conjunto: ${nameOf("adsets", [...selAdsets][0])}` : `${selAdsets.size} conjuntos selecionados`,
            () => setSelAdsets(new Set()))}
        </div>
      )}
      {metrics && Object.keys(metrics.campaigns || {}).length === 0 && Object.keys(metrics.ads || {}).length === 0 && (
        <div style={{ padding: "10px 24px 0", fontSize: 12, color: "var(--warn)" }}>
          sem dados da Meta sincronizados nesse período · ajuste o intervalo ou rode o sync
        </div>
      )}
      <DragScroll>
        <div style={{ minWidth: minW }}>
          <div style={{ display: "grid", gridTemplateColumns: cols, gap: 12, padding: "10px 24px", fontSize: 11, fontWeight: 600, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--fg-4)", borderTop: "1px solid var(--line-1)", background: "var(--bg-inset)", alignItems: "center" }}>
            <span style={{ display: "flex", alignItems: "center" }}>
              {level !== "ads" && (
                <input type="checkbox" checked={allChecked} onChange={toggleSelAll}
                  title={allChecked ? "desmarcar todos os visíveis" : "selecionar todos os visíveis (filtra os níveis de baixo)"}
                  style={checkboxStyle} />
              )}
            </span>
            <span /><span>{current.singular}</span>
            {visible.map((c) => {
              const fixed = c.key === "status";
              const sortable = !fixed; // status é o único sem ordenação
              const arrow = sort.key === c.key ? (sort.dir === "asc" ? " ▲" : " ▼") : "";
              return (
                <span key={c.key}
                  draggable={!fixed}
                  title={fixed ? c.hint : [c.hint, "clique pra ordenar · arraste pra reordenar"].filter(Boolean).join(" · ")}
                  onMouseDown={fixed ? undefined : (e) => e.stopPropagation()}
                  onClick={sortable ? () => toggleSort(c.key) : undefined}
                  onDragStart={fixed ? undefined : (e) => { e.dataTransfer.effectAllowed = "move"; setDragCol(c.key); }}
                  onDragOver={fixed ? undefined : (e) => { if (dragCol) { e.preventDefault(); e.dataTransfer.dropEffect = "move"; if (overCol !== c.key) setOverCol(c.key); } }}
                  onDrop={fixed ? undefined : (e) => { e.preventDefault(); moveCol(dragCol, c.key); setDragCol(null); setOverCol(null); }}
                  onDragEnd={fixed ? undefined : () => { setDragCol(null); setOverCol(null); }}
                  style={{
                    ...(c.left ? {} : right),
                    ...(fixed ? {} : { cursor: "grab", userSelect: "none" }),
                    ...(dragCol === c.key ? { opacity: 0.35 } : {}),
                    ...(sort.key === c.key ? { color: "var(--accent)" } : {}),
                    ...(overCol === c.key && dragCol && dragCol !== c.key ? { color: "var(--accent)" } : {}),
                  }}>{c.label}{arrow}</span>
              );
            })}
          </div>
          {error && <div style={{ padding: "16px 24px", borderTop: "1px solid var(--line-faint)", color: "var(--neg)", fontSize: 12.5 }}>{error}</div>}
          {!objects && !error && <div style={{ padding: "16px 24px", borderTop: "1px solid var(--line-faint)", color: "var(--fg-4)", fontSize: 12.5 }}>carregando conta de anúncios…</div>}
          {objects && !rows.length && <div style={{ padding: "16px 24px", borderTop: "1px solid var(--line-faint)", color: "var(--fg-4)", fontSize: 12.5 }}>{all.length ? "nada neste nível com os filtros atuais (mude o filtro de status ou limpe a seleção ✕)" : "nenhum item neste nível"}</div>}
          {(expanded ? sortedRows : sortedRows.slice(0, ADS_MAX_ROWS)).map((object) => {
            const m = metrics?.[level]?.[String(object.id)] || object;
            const state = delivery(object);
            const active = object.status ? object.status !== "PAUSED" : state.label !== "pausado";
            const canDrill = level !== "ads";
            const checked = !!selSet?.has(String(object.id));
            return (
              <div key={object.id} style={{ display: "grid", gridTemplateColumns: cols, gap: 12, padding: "12px 24px", alignItems: "center", borderTop: "1px solid var(--line-faint)", fontSize: 13.5, opacity: active ? 1 : .7, background: checked ? "var(--accent-soft)" : undefined }}>
                <span style={{ display: "flex", alignItems: "center" }}>
                  {level !== "ads" && (
                    <input type="checkbox" checked={checked} onChange={() => toggleSel(object)}
                      title="selecionar pra filtrar os níveis de baixo (como no Gerenciador)"
                      style={checkboxStyle} />
                  )}
                </span>
                <Toggle on={active} label={object.name || object.id} busy={busyIds?.has(object.id)} disabled={!onToggle || !object.status} onChange={() => onToggle?.(level, object)} />
                <span style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                  {level === "ads" && (
                    <button onClick={(e) => { e.stopPropagation(); setCreativeAd(object); }} title="ver o criativo (vídeo/imagem)"
                      style={{ flexShrink: 0, fontSize: 10, lineHeight: 1, color: "var(--accent)", padding: 2 }}>▶</button>
                  )}
                  <span onClick={canDrill ? () => drill(object) : undefined}
                    title={canDrill ? `ver ${level === "campaigns" ? "os conjuntos" : "os anúncios"} de "${object.name || object.id}"` : undefined}
                    style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", cursor: canDrill ? "pointer" : "default", color: canDrill ? "var(--accent)" : "var(--fg-1)" }}>
                    {object.name || object.id}
                  </span>
                </span>
                {visible.map((c) => cell(c, object, m, state))}
              </div>
            );
          })}
          {rows.length > ADS_MAX_ROWS && (
            <div style={{ borderTop: "1px solid var(--line-faint)", padding: "10px 24px" }}>
              {/* sticky pra ficar visível mesmo com a tabela rolada na horizontal */}
              <button onClick={() => setExpanded((v) => !v)} style={{ position: "sticky", left: 24, fontSize: 12.5, fontWeight: 600, color: "var(--accent)" }}>
                {expanded ? "ver menos" : `ver mais ${rows.length - ADS_MAX_ROWS}`}
              </button>
            </div>
          )}
          {totals && (
            <div style={{ display: "grid", gridTemplateColumns: cols, gap: 12, padding: "12px 24px", alignItems: "center", borderTop: "1px solid var(--line-2)", background: "var(--bg-inset)", fontSize: 13.5, fontWeight: 700 }}>
              <span /><span />
              <span title="soma de todas as linhas do recorte atual (filtro e seleção), inclusive as escondidas atrás do «ver mais»; taxas e custos são recalculados sobre o total">
                Total · {rows.length} {rows.length === 1 ? current.singular.toLowerCase() : current.label.toLowerCase()}
              </span>
              {visible.map((c) => {
                if (c.key === "status") return <span key={c.key} />;
                if (c.key === "budget") return (
                  <span key={c.key} style={{ display: "inline-flex", flexDirection: "column", alignItems: "flex-end", gap: 1 }}>
                    <span className="tnum">{totals.dailyBudget != null ? money(totals.dailyBudget) : "—"}</span>
                    {totals.dailyBudget != null && (
                      <span className="mono" style={{ fontSize: 9, fontWeight: 400, color: "var(--fg-4)" }} title="só os orçamentos definidos NESTE nível (os que ficam no nível de baixo não entram)">diário</span>
                    )}
                  </span>
                );
                return cell(c, {}, totals.m, {});
              })}
            </div>
          )}
        </div>
      </DragScroll>
      {creativeAd && <CreativeModal saas={saas} ad={creativeAd} onClose={() => setCreativeAd(null)} />}
    </Card>
  );
}

// Pré-visualização do criativo de um anúncio: busca a mídia sob demanda (a URL
// do vídeo da Meta é temporária) e mostra o vídeo (ou a imagem) num modal.
function CreativeModal({ saas, ad, onClose }) {
  const [st, setSt] = useState({ loading: true });
  useEffect(() => {
    let alive = true;
    api.adCreative(saas, ad.id)
      .then((m) => { if (alive) setSt({ loading: false, media: m }); })
      .catch((e) => { if (alive) setSt({ loading: false, error: e.message }); });
    return () => { alive = false; };
  }, [saas, ad.id]);
  const media = st.media;
  // Fundo CLARO (não preto): se o vídeo não carregar, o modal não fica uma tela
  // preta — mostra a superfície do tema e o poster. Sem autoplay.
  const box = { width: "100%", maxHeight: "64dvh", borderRadius: "var(--r-2)", background: "var(--bg-2)" };
  const mediaUrl = media?.videoUrl || media?.imageUrl || "";
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 95, background: "color-mix(in srgb, var(--bg-0) 62%, transparent)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "min(520px, 100%)", maxHeight: "88dvh", overflowY: "auto", background: "var(--bg-1)", border: "1px solid var(--line-2)", borderRadius: "var(--r-3)", boxShadow: "var(--shadow-2)", padding: 18 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 12 }}>
          <span style={{ fontFamily: "var(--display)", fontSize: 14.5, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ad.name || ad.id}</span>
          <span style={{ flex: 1 }} />
          <button onClick={onClose} className="dim" style={{ fontSize: 12.5 }}>fechar ✕</button>
        </div>
        {st.loading && <div className="mono dim" style={{ fontSize: 12, padding: "32px 0", textAlign: "center" }}>carregando criativo…</div>}
        {st.error && <div className="mono" style={{ fontSize: 12, color: "var(--neg)", padding: "8px 0" }}>{st.error}</div>}
        {media?.type === "video" && (
          <video src={media.videoUrl} poster={media.thumbnail || undefined} controls playsInline preload="metadata"
            onError={() => setSt((s) => ({ ...s, mediaError: true }))} style={box} />
        )}
        {media?.type === "image" && (
          <img src={media.imageUrl} alt={ad.name || ""} onError={() => setSt((s) => ({ ...s, mediaError: true }))}
            style={{ ...box, objectFit: "contain" }} />
        )}
        {media?.type === "none" && <div className="mono dim" style={{ fontSize: 12, padding: "24px 0", textAlign: "center" }}>sem mídia disponível pra este anúncio</div>}
        {mediaUrl && (
          <a href={mediaUrl} target="_blank" rel="noopener noreferrer" style={{ display: "inline-block", marginTop: 10, fontSize: 12.5, color: "var(--accent)" }}>
            abrir em nova aba ↗{st.mediaError ? " · não carregou aqui" : ""}
          </a>
        )}
      </div>
    </div>
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
const GRADES = ["S", "A", "B", "C", "D", "E"];
// Clientes A/B/C numa célula só, uma linha por grade ("2 A · R$ 43,00 cada") —
// o MESMO formato da coluna Clientes ABC da tabela de anúncios. Exportado pra
// o teste A/B dos Formulários usar a MESMA célula (sem custo lá).
export function AbcCell({ abc, abcCost, money }) {
  return (
    <span className="tnum" style={{ display: "inline-flex", flexDirection: "column", alignItems: "flex-end", gap: 1, fontSize: 11.5 }}>
      {abc && GRADES.some((g) => abc[g] > 0)
        ? GRADES.filter((g) => abc[g] > 0).map((g) => (
          <span key={g} style={{ whiteSpace: "nowrap", color: "var(--fg-3)" }}>
            <span style={{ fontWeight: 700, color: GRADE_STYLE[g].ink }}>{abc[g]} {g}</span>
            {abcCost?.[g] != null ? ` · ${money(abcCost[g])} cada` : ""}
          </span>
        ))
        : <span style={{ color: "var(--fg-4)", fontSize: 13.5 }}>—</span>}
    </span>
  );
}

// Ganhos com a grade de quem fechou: "2 A · 1 B" embaixo do total. Ganho sem
// grade (lead sem dados de contas/anúncios) vira "s/ grade" pra conta fechar.
function WonAbcCell({ won, wonAbc }) {
  const graded = wonAbc ? GRADES.reduce((a, g) => a + (wonAbc[g] || 0), 0) : 0;
  const ungraded = Math.max(0, (won || 0) - graded);
  if (!won) return <span className="tnum" style={{ textAlign: "right", fontWeight: 600 }}>0</span>;
  return (
    <span className="tnum" style={{ display: "inline-flex", flexDirection: "column", alignItems: "flex-end", gap: 1 }}>
      <span style={{ fontWeight: 600 }}>{window.fmt.int(won)}</span>
      <span style={{ fontSize: 11.5, whiteSpace: "nowrap" }}>
        {GRADES.filter((g) => wonAbc?.[g] > 0).map((g, i) => (
          <span key={g}>
            {i > 0 && <span style={{ color: "var(--fg-4)" }}> · </span>}
            <span style={{ fontWeight: 700, color: GRADE_STYLE[g].ink }}>{wonAbc[g]} {g}</span>
          </span>
        ))}
        {ungraded > 0 && <span style={{ color: "var(--fg-4)" }}>{graded > 0 ? " · " : ""}{ungraded} s/ grade</span>}
      </span>
    </span>
  );
}

function PainTable({ pains, money }) {
  const cols = "1.6fr .8fr .55fr .7fr .6fr .9fr .55fr .6fr";
  return (
    // .tbl-x: 8 colunas não cabem em tela de celular — rola na horizontal
    // dentro do card em vez de o overflow:hidden clipar os valores.
    <div className="tbl-x" style={{ marginTop: 14 }}>
     <div>
      <div style={{ display: "grid", gridTemplateColumns: cols, gap: 12, padding: "10px 24px", fontSize: 11, fontWeight: 600, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--fg-4)", borderTop: "1px solid var(--line-1)", background: "var(--bg-inset)" }}>
        <span>Dor</span><span style={{ textAlign: "right" }}>Investido</span><span style={{ textAlign: "right" }}>Leads</span><span style={{ textAlign: "right" }}>CPL</span>
        <span title="leads da dor que marcaram call" style={{ textAlign: "right" }}>Calls</span>
        <span title="clientes A/B/C que a dor trouxe · custo por cada" style={{ textAlign: "right" }}>Clientes ABC</span>
        <span title="ganhos da dor · com a grade A/B/C de cada cliente fechado" style={{ textAlign: "right" }}>Ganhos</span><span style={{ textAlign: "right" }}>ROAS</span>
      </div>
      {pains.filter((p) => p.code).map((p) => (
        <div key={p.code} style={{ display: "grid", gridTemplateColumns: cols, gap: 12, padding: "12px 24px", alignItems: "center", borderTop: "1px solid var(--line-faint)", fontSize: 13.5 }}>
          <span style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}><span className="mono code" style={{ marginRight: 7, fontSize: 12, color: "var(--fg-4)" }}>[{String(p.code).replace(/^\[|\]$/g, "")}]</span>{p.label}</span>
          <span className="tnum" style={{ textAlign: "right" }}>{money(p.spend)}</span>
          <span className="tnum" style={{ textAlign: "right" }}>{window.fmt.int(p.leads)}</span>
          <span className="tnum" style={{ textAlign: "right" }}>{p.cpl != null ? money(p.cpl) : "—"}</span>
          <span className="tnum" style={{ textAlign: "right" }}>{p.calls > 0 ? window.fmt.int(p.calls) : "—"}</span>
          <AbcCell abc={p.abc} abcCost={p.abcCost} money={money} />
          <WonAbcCell won={p.won} wonAbc={p.wonAbc} />
          <span className="tnum" style={{ textAlign: "right", fontWeight: 600, color: p.roas == null ? "var(--fg-4)" : p.roas >= 3 ? "var(--pos)" : "var(--warn)" }}>{p.roas != null ? String(p.roas).replace(".", ",") + "x" : "—"}</span>
        </div>
      ))}
      {!pains.some((p) => p.code) && <div style={{ padding: "16px 24px", borderTop: "1px solid var(--line-faint)", color: "var(--fg-4)", fontSize: 12.5 }}>nenhuma dor atribuída no período</div>}
     </div>
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
// Barra do upload + passo do servidor. Vídeo de 150 MB leva minutos; sem isso a
// tela fica idêntica a travada e o time sobe o mesmo vídeo duas vezes.
function JobProgress({ pct, step }) {
  const sending = pct > 0 && pct < 1;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 11.5, color: "var(--fg-3)" }}>
      <span style={{ width: 90, height: 4, borderRadius: 2, background: "var(--line-2)", overflow: "hidden" }}>
        <span style={{ display: "block", height: "100%", width: `${Math.round((sending ? pct : 1) * 100)}%`, background: "var(--accent)", transition: "width .2s" }} />
      </span>
      <span className="mono">{sending ? `enviando o vídeo · ${Math.round(pct * 100)}%` : (step || "processando na Meta…")}</span>
    </span>
  );
}

function CloneAdPanel({ product, campaigns, onDone, onError, onClose }) {
  const [defaults, setDefaults] = useState(null); // { painMap }
  const [pain, setPain] = useState("");           // código escolhido ou "_new"
  const [newPain, setNewPain] = useState({ code: "", label: "" });
  const [campaignId, setCampaignId] = useState("");
  const [adsets, setAdsets] = useState(null);
  const [sourceAdsetId, setSourceAdsetId] = useState("");
  const [file, setFile] = useState(null);
  const [numOverride, setNumOverride] = useState("");
  const [budget, setBudget] = useState("");     // orçamento diário do conjunto novo
  const [busy, setBusy] = useState(false);
  const [pct, setPct] = useState(0);            // progresso do upload (0..1)
  const [step, setStep] = useState("");         // passo do trabalho no servidor

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

  // Orçamento nasce com o do conjunto de origem — o valor que o clone teria de
  // qualquer jeito. Editar aqui é o atalho pra testar a dor com outro budget.
  const sourceAdset = (adsets || []).find((s) => s.id === sourceAdsetId) || null;
  useEffect(() => {
    setBudget(sourceAdset?.dailyBudget != null ? String(sourceAdset.dailyBudget).replace(".", ",") : "");
  }, [sourceAdsetId]); // eslint-disable-line react-hooks/exhaustive-deps

  const detectedNumber = numOverride.trim() || (file ? fileNumberOf(file.name) : "");
  const finalName = painCodeSel && detectedNumber ? `${detectedNumber} [${painCodeSel}]` : "";
  const valid = painCodeSel && (pain !== "_new" || painLabelSel) && campaignId && sourceAdsetId && file && detectedNumber && !busy;

  async function submit() {
    const big = tooBig(file);
    if (big) return onError(big);
    setBusy(true); setPct(0); setStep("");
    try {
      const fd = new FormData();
      fd.append("painCode", painCodeSel);
      if (painLabelSel) fd.append("painLabel", painLabelSel);
      fd.append("sourceAdsetId", sourceAdsetId);
      if (numOverride.trim()) fd.append("number", numOverride.trim());
      if (budget.trim()) fd.append("dailyBudget", budget.trim());
      fd.append("video", file, file.name);
      const { jobId } = await api.adFromVideo(product.id, fd, setPct);
      setStep("a Meta está processando o vídeo");
      const job = await waitForVideoJob(jobId, setStep);
      const orc = job.result?.dailyBudget ? ` · orçamento R$ ${String(job.result.dailyBudget).replace(".", ",")}/dia` : "";
      onDone(job.warning
        ? `Anúncio "${job.result.adsetName}" criado PAUSADO, mas ATENÇÃO: ${job.warning}`
        : `Anúncio "${job.result.adsetName}" criado PAUSADO (conjunto clonado + vídeo trocado)${orc} — revise e ative no Gerenciador.`);
    } catch (e) {
      onError(e.message || "Falha ao criar o anúncio.");
    }
    setBusy(false); setPct(0); setStep("");
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
          <label style={lbl}>
            <span className="mono" style={cap}>5 · Orçamento diário do conjunto (R$)</span>
            <input type="text" inputMode="decimal" placeholder={sourceAdset ? (sourceAdset.dailyBudget != null ? "igual ao de origem" : "orçamento na campanha (CBO)") : "escolha o conjunto"}
              value={budget} onChange={(e) => setBudget(e.target.value.replace(/[^\d.,]/g, ""))}
              style={{ ...inp, fontFamily: "var(--mono)" }} />
          </label>
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <button onClick={submit} disabled={!valid}
            style={{ height: 32, padding: "0 16px", borderRadius: "var(--r-1)", background: "var(--btn-bg, var(--accent))", color: "var(--btn-fg, var(--accent-fg))", fontSize: 13, fontWeight: 600, opacity: !valid ? 0.55 : 1 }}>
            {busy ? "Trabalhando… não feche a tela" : "Criar anúncio pausado"}
          </button>
          <button onClick={onClose} disabled={busy} style={{ height: 32, padding: "0 10px", fontSize: 12.5, color: "var(--fg-3)" }}>cancelar</button>
          {busy
            ? <JobProgress pct={pct} step={step} />
            : finalName && <span className="mono dim" style={{ fontSize: 11.5 }}>nome final do conjunto e do anúncio: <b style={{ color: "var(--fg-2)" }}>{finalName}</b></span>}
        </div>
        <div className="mono dim" style={{ fontSize: 10.5, lineHeight: 1.5 }}>
          clona o conjunto escolhido (mantém público, posicionamento, copy e CTA), troca só o vídeo pelo que você subiu, renomeia conjunto e anúncio pra «número [dor]» e aplica o orçamento diário acima (vazio mantém o do conjunto de origem). Nada gasta até você ativar no Gerenciador.
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
  const [pct, setPct] = useState(0);
  const [step, setStep] = useState("");

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
    const big = tooBig(file);
    if (big) return onError(big);
    setBusy(true); setPct(0); setStep("");
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
      const { jobId } = await api.uploadCreative(product.id, fd, setPct);
      setStep("a Meta está processando o vídeo");
      const job = await waitForVideoJob(jobId, setStep);
      onDone(`Anúncio "${job.result.name}" criado PAUSADO — revise e ative no Gerenciador.`);
    } catch (e) {
      onError(e.message || "Falha ao criar o criativo.");
    }
    setBusy(false); setPct(0); setStep("");
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
            {busy ? "Trabalhando… não feche a tela" : "Criar anúncio pausado"}
          </button>
          <button onClick={onClose} disabled={busy} style={{ height: 32, padding: "0 10px", fontSize: 12.5, color: "var(--fg-3)" }}>cancelar</button>
          {busy
            ? <JobProgress pct={pct} step={step} />
            : painCodeSel && name.trim() && (
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
