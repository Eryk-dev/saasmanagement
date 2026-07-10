import React from "react";
import { api } from "../lib/api.js";
import { useData } from "../data.jsx";
import { PageHead, Segmented, StatTile, Card, LineChart, Pill } from "../components/viz.jsx";
import { EmptyState } from "../atoms.jsx";
import { stageByKind } from "../lib/funnel.js";
// Métricas — aquisição × funil do produto ativo (substitui a tela Marketing).
// Hoje: investimento (Meta), leads, CPL real e custo por etapa, com séries no
// tempo e quebra por campanha. CAC e LTV entram na fase de métricas de receita,
// nesta mesma tela.

const { useState, useEffect } = React;

const DAY = 86_400_000;
const dayStr = (t) => new Date(t).toISOString().slice(0, 10);
const shortDay = (iso) => new Date(iso + "T12:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }).replace(".", "");

const PERIODS = [
  { value: "3", label: "3 dias" },
  { value: "7", label: "7 dias" },
  { value: "30", label: "30 dias" },
  { value: "life", label: "lifetime" },
];
// A Meta só devolve insights de até ~37 meses; o sync respeita esse teto.
const META_LOOKBACK_DAYS = 1125;

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
  const product = SAAS[0];
  const metaOn = !!CONFIG?.meta?.configured;

  const [range, setRange] = useState({ preset: "30" });
  const { since, until } = rangeOf(range);
  const rangeDays = Math.max(1, Math.round((new Date(until) - new Date(since)) / DAY) + 1);
  const [data, setData] = useState(null);
  const [biz, setBiz] = useState(null); // CAC/LTV + série mensal
  const [syncing, setSyncing] = useState(false);
  const [note, setNote] = useState(null);

  const [camps, setCamps] = useState(null); // campanhas ao vivo (gerenciamento)
  const [creative, setCreative] = useState(false); // painel de novo criativo

  const load = () => {
    if (!product) return;
    setData(null);
    api.marketingMetrics(product.id, { since, until }).then(setData).catch(() => setData({ error: true }));
    api.metrics(product.id, { days: rangeDays, months: 12 }).then(setBiz).catch(() => setBiz(null));
    if (metaOn && product.metaAdAccount) {
      api.metaCampaigns(product.id).then((r) => setCamps(r.campaigns)).catch((e) => setCamps({ error: e.message }));
    }
  };
  useEffect(load, [product?.id, since, until, version]); // eslint-disable-line react-hooks/exhaustive-deps

  // Pausar/reativar com atualização otimista; orçamento salva no blur.
  async function toggleCampaign(c) {
    const target = c.status === "PAUSED" ? "ACTIVE" : "PAUSED";
    const verb = target === "PAUSED" ? "Pausar" : "Reativar";
    if (!window.confirm(`${verb} a campanha "${c.name}" na Meta?`)) return;
    setCamps((prev) => prev.map((x) => (x.id === c.id ? { ...x, status: target, effectiveStatus: target } : x)));
    try { await api.metaCampaignStatus(c.id, target); setNote({ ok: true, text: `Campanha ${target === "PAUSED" ? "pausada" : "reativada"}.` }); }
    catch (e) { setNote({ ok: false, text: e.message || "Falha na Meta." }); load(); }
  }
  async function saveBudget(c, value) {
    const v = Number(value);
    if (!Number.isFinite(v) || v <= 0 || v === c.dailyBudget) return;
    try { await api.metaCampaignBudget(c.id, v); setNote({ ok: true, text: "Orçamento atualizado." }); load(); }
    catch (e) { setNote({ ok: false, text: e.message || "Falha ao atualizar orçamento." }); }
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
  // Custo por etapa pelo KIND do estágio (call/ganho) — funciona com qualquer
  // nome de funil (o antigo procurava "Call closer"/"Ganho" literais).
  const costOfKind = (kind) => {
    const st = stageByKind(product, kind);
    return st ? perStage.find((s) => s.stage === st)?.costPer ?? null : null;
  };
  const money = window.fmt.money;

  const spendSeries = (data?.series || []).map((d) => ({ x: shortDay(d.date), v: d.spend }));
  const leadSeries = (data?.series || []).map((d) => ({ x: shortDay(d.date), v: d.leads }));

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, overflow: "auto" }}>
      <PageHead title="Publicidade" sub={`aquisição, funil e campanhas · ${product.name}`}>
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
          <button onClick={sync} disabled={syncing} style={{ padding: "6px 12px", borderRadius: "var(--r-1)", fontSize: 12.5, fontWeight: 500, border: "1px solid var(--line-2)", background: "var(--bg-1)", color: "var(--fg-2)", opacity: syncing ? 0.6 : 1 }}>
            {syncing ? "Sincronizando…" : "↻ sincronizar Meta"}
          </button>
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
          <NewCreativePanel product={product} campaigns={Array.isArray(camps) ? camps : []}
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

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12 }}>
          <StatTile label={`CAC · ${rangeDays}d`} value={biz?.window?.cac != null ? money(biz.window.cac) : "sem dado"}
            delta={biz?.window?.newCustomers != null ? `${biz.window.newCustomers} ${biz.window.newCustomers === 1 ? "cliente novo" : "clientes novos"}` : null} />
          <StatTile label="LTV estimado" value={biz?.ltv?.value != null ? money(biz.ltv.value) : "sem dado"}
            delta={biz?.ltv?.ticket != null ? `ticket ${money(biz.ltv.ticket)} × ${biz.ltv.months}m` : "precisa de assinaturas ativas"} />
          <StatTile label="LTV / CAC" value={biz?.ltv?.ltvCac != null ? window.fmt.ratio(biz.ltv.ltvCac) : "sem dado"}
            delta={biz?.ltv?.ltvCac != null ? (biz.ltv.ltvCac >= 3 ? "saudável acima de 3x" : "abaixo do saudável (3x)") : null}
            tone={biz?.ltv?.ltvCac != null ? (biz.ltv.ltvCac >= 3 ? "up" : "down") : "flat"} />
          <StatTile label="Lead → cliente" value={biz?.window?.convRate != null ? `${String(biz.window.convRate).replace(".", ",")}%` : "sem dado"}
            delta={biz?.window?.leads != null ? `de ${biz.window.leads} leads no período` : null} />
          <StatTile label="Custo por lead" value={t?.cpl != null ? money(t.cpl) : "sem gasto"} delta={t?.cplMeta != null ? `${money(t.cplMeta)} na visão da Meta` : null} />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12 }}>
          <StatTile label="Investimento" value={t ? money(t.spend) : "…"} delta={t?.ctr != null ? `CTR ${String(t.ctr).replace(".", ",")}%` : null} />
          <StatTile label="Leads no período" value={t ? String(t.leads) : "…"} delta={t?.metaLeads ? `${t.metaLeads} reportados pela Meta` : null} />
          <StatTile label="Custo por call" value={costOfKind("call") != null ? money(costOfKind("call")) : "sem dado"} delta="leads que chegaram à call" />
          <StatTile label="Custo por ganho" value={costOfKind("ganho") != null ? money(costOfKind("ganho")) : "sem dado"} delta="leads que fecharam" />
        </div>

        <div className="resp-cols" style={{ "--cols": "1fr 1fr", gap: 12 }}>
          <Card title="Investimento por dia" hint="Meta Ads">
            <LineChart data={spendSeries} color="var(--chart-1)" fmtValue={(v) => money(v)} />
          </Card>
          <Card title="Leads por dia" hint="criados no cockpit">
            <LineChart data={leadSeries} color="var(--chart-2)" fmtValue={(v) => String(Math.round(v))} />
          </Card>
        </div>

        {biz?.series?.length > 0 && (
          <div className="resp-cols" style={{ "--cols": "1fr 1fr", gap: 12 }}>
            <Card title="Clientes novos por mês" hint="conversões do pipeline · 12 meses">
              <LineChart data={biz.series.map((m) => ({ x: monthLabel(m.month), v: m.newCustomers }))} color="var(--chart-2)" fmtValue={(v) => String(Math.round(v))} />
            </Card>
            <Card title="MRR por mês" hint="aproximado pela base atual · melhora quando houver histórico de churn">
              <LineChart data={biz.series.map((m) => ({ x: monthLabel(m.month), v: m.mrr }))} color="var(--chart-1)" fmtValue={(v) => money(v)} />
            </Card>
          </div>
        )}

        {data && !data.error && (data.pains || []).some((p) => p.code) && (
          <Card title="Por dor" hint="código [X] no nome do anúncio · qual roteiro traz lead que fecha, não só lead barato">
            <PainTable pains={data.pains} money={money} />
          </Card>
        )}

        {data && !data.error && data.campaigns?.length > 0 && (
          <Card title="Por campanha" hint="expanda pra ver conjuntos e anúncios · atribuição por UTM (campaign/term/content = id ou nome)">
            <CampaignDrilldown data={data} money={money} />
          </Card>
        )}

        {metaOn && product.metaAdAccount && (
          <Card title="Gerenciar anúncios" hint="campanha → conjunto → anúncio · expanda e pause, reative ou ajuste orçamento em qualquer nível">
            {camps == null && <div style={{ padding: "12px 16px", fontSize: 12.5, color: "var(--fg-4)" }}>carregando campanhas…</div>}
            {camps?.error && <div className="mono" style={{ padding: "12px 16px", fontSize: 12, color: "var(--neg)" }}>{camps.error}</div>}
            {Array.isArray(camps) && camps.length === 0 && <div style={{ padding: "12px 16px", fontSize: 12.5, color: "var(--fg-4)" }}>Nenhuma campanha na conta.</div>}
            {Array.isArray(camps) && camps.length > 0 && (
              <ManageTree camps={camps} onToggleCampaign={toggleCampaign} onBudgetCampaign={saveBudget} onNote={setNote} />
            )}
          </Card>
        )}

        {perStage.length > 0 && t?.spend > 0 && (
          <Card title="Custo por etapa do funil" hint="investimento dividido pelos leads que chegaram em cada etapa">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 8, padding: "12px 16px 16px" }}>
              {perStage.slice(0, 6).map((s) => (
                <div key={s.stage} style={{ border: "1px solid var(--line-1)", borderRadius: "var(--r-2)", padding: "9px 11px", background: "var(--bg-inset)" }}>
                  <span className="tnum" style={{ display: "block", fontFamily: "var(--display)", fontSize: 18, fontWeight: 700 }}>
                    {s.costPer != null ? money(s.costPer) : "sem lead"}
                  </span>
                  <span style={{ fontSize: 11.5, color: "var(--fg-3)", display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {s.stage} · {s.count}
                  </span>
                </div>
              ))}
            </div>
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

// Gerenciamento em árvore no mesmo bloco: campanha → conjunto → anúncio.
// Conjuntos e anúncios carregam AO VIVO da Meta ao expandir; pausar/reativar
// vale em qualquer nível (POST genérico pelo id do nó) e orçamento diário
// edita campanha CBO ou conjunto ABO.
function ManageTree({ camps, onToggleCampaign, onBudgetCampaign, onNote }) {
  const [open, setOpen] = useState(() => new Set());
  const [adsetsBy, setAdsetsBy] = useState({}); // campId  -> rows | "loading" | { error }
  const [adsBy, setAdsBy] = useState({});       // adsetId -> rows | "loading" | { error }

  const flip = (id) => setOpen((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const openCampaign = (c) => {
    flip(c.id);
    if (!adsetsBy[c.id]) {
      setAdsetsBy((p) => ({ ...p, [c.id]: "loading" }));
      api.metaAdsets(c.id)
        .then((r) => setAdsetsBy((p) => ({ ...p, [c.id]: r.adsets })))
        .catch((e) => setAdsetsBy((p) => ({ ...p, [c.id]: { error: e.message || "falha ao listar conjuntos" } })));
    }
  };
  const openAdset = (s) => {
    flip(s.id);
    if (!adsBy[s.id]) {
      setAdsBy((p) => ({ ...p, [s.id]: "loading" }));
      api.metaAds(s.id)
        .then((r) => setAdsBy((p) => ({ ...p, [s.id]: r.ads })))
        .catch((e) => setAdsBy((p) => ({ ...p, [s.id]: { error: e.message || "falha ao listar anúncios" } })));
    }
  };

  const patchRow = (setter, groupId) => (id, patch) =>
    setter((p) => (Array.isArray(p[groupId]) ? { ...p, [groupId]: p[groupId].map((x) => (x.id === id ? { ...x, ...patch } : x)) } : p));

  async function toggleStatus(level, obj, applyLocal) {
    const target = obj.status === "PAUSED" ? "ACTIVE" : "PAUSED";
    const verb = target === "PAUSED" ? "Pausar" : "Reativar";
    if (!window.confirm(`${verb} ${level} "${obj.name}" na Meta?`)) return;
    applyLocal({ status: target, effectiveStatus: target });
    try {
      await api.metaObjectStatus(obj.id, target);
      onNote({ ok: true, text: `${level} ${target === "PAUSED" ? "pausado(a)" : "reativado(a)"}: ${obj.name}` });
    } catch (e) {
      applyLocal({ status: obj.status, effectiveStatus: obj.effectiveStatus });
      onNote({ ok: false, text: e.message || "Falha na Meta." });
    }
  }
  async function saveAdsetBudget(campId, s, value) {
    const v = Number(value);
    if (!Number.isFinite(v) || v <= 0 || v === s.dailyBudget) return;
    try {
      await api.metaObjectBudget(s.id, v);
      patchRow(setAdsetsBy, campId)(s.id, { dailyBudget: v });
      onNote({ ok: true, text: `Orçamento do conjunto "${s.name}" atualizado.` });
    } catch (e) { onNote({ ok: false, text: e.message || "Falha ao atualizar orçamento." }); }
  }

  const td = { padding: "10px 16px", borderBottom: "1px solid var(--line-1)" };
  const budgetInput = (obj, onBlur, title) => (
    <input type="number" min="1" step="1" defaultValue={obj.dailyBudget} key={obj.id + obj.dailyBudget}
      onBlur={(e) => onBlur(e.target.value)}
      onKeyDown={(e) => { if (e.key === "Enter") e.target.blur(); }}
      title={title}
      style={{ width: 90, height: 26, padding: "0 8px", borderRadius: "var(--r-1)", border: "1px solid var(--line-2)", background: "var(--bg-1)", color: "var(--fg-1)", fontSize: 12.5, fontFamily: "var(--mono)", textAlign: "right" }} />
  );
  const statusPill = (obj) => {
    const eff = obj.effectiveStatus || obj.status;
    const paused = obj.status === "PAUSED";
    return (
      <Pill tone={eff === "ACTIVE" ? "pos" : paused ? "mut" : "warn"}>
        {eff === "ACTIVE" ? "ativo" : paused ? "pausado" : String(eff).toLowerCase().replaceAll("_", " ")}
      </Pill>
    );
  };
  const toggleBtn = (obj, onClick) => {
    const paused = obj.status === "PAUSED";
    return (
      <button onClick={onClick}
        style={{ height: 26, padding: "0 12px", borderRadius: 999, fontSize: 11.5, fontWeight: 600, border: "1px solid var(--line-2)", background: paused ? "var(--accent-soft)" : "var(--bg-2)", color: paused ? "var(--accent)" : "var(--fg-2)" }}>
        {paused ? "reativar" : "pausar"}
      </button>
    );
  };
  const nameTd = (label, depth, expandable, isOpen, onClick, tag) => (
    <td onClick={onClick} style={{
      ...td, paddingLeft: 16 + depth * 22, fontSize: depth ? 12.5 : 13,
      fontWeight: depth === 2 ? 400 : 600, color: depth === 2 ? "var(--fg-2)" : "var(--fg-1)",
      cursor: expandable ? "pointer" : "default",
      whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 340,
    }}>
      {expandable && <span className="mono" style={{ marginRight: 7, color: "var(--fg-4)", fontSize: 10 }}>{isOpen ? "▾" : "▸"}</span>}
      {tag && <span className="mono" style={{ marginRight: 6, color: "var(--fg-4)", fontSize: 10 }}>{tag}</span>}
      {label}
    </td>
  );
  const infoRow = (key, depth, text, isErr) => (
    <tr key={key} style={{ background: "var(--bg-inset)" }}>
      <td colSpan={5} className="mono" style={{ ...td, paddingLeft: 16 + depth * 22, fontSize: 11.5, color: isErr ? "var(--neg)" : "var(--fg-4)" }}>{text}</td>
    </tr>
  );

  return (
    <div className="tbl-x" style={{ marginTop: 10 }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            {["Campanha / conjunto / anúncio", "Objetivo", "Orçamento/dia", "Situação", ""].map((h, i) => (
              <th key={h + i} className="mono" style={{ textAlign: i >= 2 ? "right" : "left", fontSize: 10.5, fontWeight: 500, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--fg-3)", padding: "10px 16px", borderTop: "1px solid var(--line-1)", borderBottom: "1px solid var(--line-1)", background: "var(--bg-inset)" }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {camps.map((c) => {
            const cOpen = open.has(c.id);
            const sets = adsetsBy[c.id];
            return (
              <React.Fragment key={c.id}>
                <tr>
                  {nameTd(c.name, 0, true, cOpen, () => openCampaign(c))}
                  <td style={{ ...td, fontSize: 12, color: "var(--fg-3)" }}>{String(c.objective || "").replace("OUTCOME_", "").toLowerCase()}</td>
                  <td style={{ ...td, textAlign: "right" }}>
                    {c.dailyBudget != null
                      ? budgetInput(c, (v) => onBudgetCampaign(c, v), "Orçamento diário da campanha em R$ (salva ao sair do campo)")
                      : <span className="mono" style={{ fontSize: 11.5, color: "var(--fg-4)" }} title="Orçamento definido nos conjuntos (ABO)">no conjunto</span>}
                  </td>
                  <td style={{ ...td, textAlign: "right" }}>{statusPill(c)}</td>
                  <td style={{ ...td, textAlign: "right" }}>{toggleBtn(c, () => onToggleCampaign(c))}</td>
                </tr>
                {cOpen && sets === "loading" && infoRow(c.id + "_l", 1, "carregando conjuntos…")}
                {cOpen && sets?.error && infoRow(c.id + "_e", 1, sets.error, true)}
                {cOpen && Array.isArray(sets) && sets.length === 0 && infoRow(c.id + "_0", 1, "campanha sem conjuntos")}
                {cOpen && Array.isArray(sets) && sets.map((s) => {
                  const sOpen = open.has(s.id);
                  const ads = adsBy[s.id];
                  const patchSet = patchRow(setAdsetsBy, c.id);
                  return (
                    <React.Fragment key={s.id}>
                      <tr style={{ background: "var(--bg-inset)" }}>
                        {nameTd(s.name, 1, true, sOpen, () => openAdset(s), "conj")}
                        <td style={td} />
                        <td style={{ ...td, textAlign: "right" }}>
                          {s.dailyBudget != null
                            ? budgetInput(s, (v) => saveAdsetBudget(c.id, s, v), "Orçamento diário do conjunto em R$ (salva ao sair do campo)")
                            : <span className="mono" style={{ fontSize: 11.5, color: "var(--fg-4)" }} title="Orçamento definido na campanha (CBO)">na campanha</span>}
                        </td>
                        <td style={{ ...td, textAlign: "right" }}>{statusPill(s)}</td>
                        <td style={{ ...td, textAlign: "right" }}>{toggleBtn(s, () => toggleStatus("conjunto", s, (patch) => patchSet(s.id, patch)))}</td>
                      </tr>
                      {sOpen && ads === "loading" && infoRow(s.id + "_l", 2, "carregando anúncios…")}
                      {sOpen && ads?.error && infoRow(s.id + "_e", 2, ads.error, true)}
                      {sOpen && Array.isArray(ads) && ads.length === 0 && infoRow(s.id + "_0", 2, "conjunto sem anúncios")}
                      {sOpen && Array.isArray(ads) && ads.map((a) => {
                        const patchAd = patchRow(setAdsBy, s.id);
                        return (
                          <tr key={a.id} style={{ background: "var(--bg-inset)" }}>
                            {nameTd(a.name, 2, false, false, undefined, "ad")}
                            <td style={td} />
                            <td style={td} />
                            <td style={{ ...td, textAlign: "right" }}>{statusPill(a)}</td>
                            <td style={{ ...td, textAlign: "right" }}>{toggleBtn(a, () => toggleStatus("anúncio", a, (patch) => patchAd(a.id, patch)))}</td>
                          </tr>
                        );
                      })}
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

const monthLabel = (mk) => {
  const [y, m] = String(mk).split("-");
  const names = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  return `${names[Number(m) - 1] || m} ${String(y).slice(2)}`;
};

const tdNum = { padding: "11px 16px", fontSize: 13, textAlign: "right", borderBottom: "1px solid var(--line-1)", fontFamily: "var(--mono)" };

export { MetricsScreen };
