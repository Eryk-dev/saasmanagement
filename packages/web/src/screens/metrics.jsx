import React from "react";
import { api } from "../lib/api.js";
import { useData } from "../data.jsx";
import { PageHead, Segmented, StatTile, Card, LineChart, Pill } from "../components/viz.jsx";
import { EmptyState } from "../atoms.jsx";
// Métricas — aquisição × funil do produto ativo (substitui a tela Marketing).
// Hoje: investimento (Meta), leads, CPL real e custo por etapa, com séries no
// tempo e quebra por campanha. CAC e LTV entram na fase de métricas de receita,
// nesta mesma tela.

const { useState, useEffect } = React;

const DAY = 86_400_000;
const dayStr = (t) => new Date(t).toISOString().slice(0, 10);
const shortDay = (iso) => new Date(iso + "T12:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }).replace(".", "");

const PERIODS = [
  { value: "30", label: "30 dias" },
  { value: "90", label: "90 dias" },
];

function MetricsScreen() {
  const { SAAS, CONFIG } = window.SEED;
  const { version } = useData();
  const product = SAAS[0];
  const metaOn = !!CONFIG?.meta?.configured;

  const [days, setDays] = useState("30");
  const [data, setData] = useState(null);
  const [biz, setBiz] = useState(null); // CAC/LTV + série mensal
  const [syncing, setSyncing] = useState(false);
  const [note, setNote] = useState(null);

  const [camps, setCamps] = useState(null); // campanhas ao vivo (gerenciamento)
  const [ai, setAi] = useState(null); // gasto com IA (USD)

  const load = () => {
    if (!product) return;
    const since = dayStr(Date.now() - (Number(days) - 1) * DAY);
    setData(null);
    api.marketingMetrics(product.id, { since }).then(setData).catch(() => setData({ error: true }));
    api.metrics(product.id, { days: Number(days), months: 12 }).then(setBiz).catch(() => setBiz(null));
    if (metaOn && product.metaAdAccount) {
      api.metaCampaigns(product.id).then((r) => setCamps(r.campaigns)).catch((e) => setCamps({ error: e.message }));
    }
    api.aiCosts(Number(days)).then(setAi).catch(() => setAi(null));
  };
  useEffect(load, [product?.id, days, version]); // eslint-disable-line react-hooks/exhaustive-deps

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

  async function sync() {
    setSyncing(true); setNote(null);
    try {
      await api.marketingSync({ saas: product.id, since: dayStr(Date.now() - 89 * DAY) });
      setNote({ ok: true, text: "Gasto sincronizado da Meta." });
      load();
    } catch (e) {
      setNote({ ok: false, text: e.message || "Falha ao sincronizar." });
    }
    setSyncing(false);
  }

  if (!product) return <EmptyState title="Nenhum produto cadastrado" hint="Crie o produto em Ajustes pra acompanhar as métricas." />;

  const t = data && !data.error ? data.totals : null;
  const perStage = data && !data.error ? data.perStage : [];
  const costOf = (stage) => perStage.find((s) => s.stage === stage)?.costPer ?? null;
  const money = window.fmt.money;

  const spendSeries = (data?.series || []).map((d) => ({ x: shortDay(d.date), v: d.spend }));
  const leadSeries = (data?.series || []).map((d) => ({ x: shortDay(d.date), v: d.leads }));

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, overflow: "auto" }}>
      <PageHead title="Métricas" sub={`aquisição e funil · ${product.name}`}>
        <button onClick={() => setManual(manual ? null : { date: new Date().toISOString().slice(0, 10), name: "", spend: "" })}
          style={{ padding: "6px 12px", borderRadius: "var(--r-1)", fontSize: 12.5, fontWeight: 500, border: "1px solid var(--line-2)", background: "var(--bg-1)", color: "var(--fg-2)" }}>
          + gasto manual
        </button>
        {metaOn && (
          <button onClick={sync} disabled={syncing} style={{ padding: "6px 12px", borderRadius: "var(--r-1)", fontSize: 12.5, fontWeight: 500, border: "1px solid var(--line-2)", background: "var(--bg-1)", color: "var(--fg-2)", opacity: syncing ? 0.6 : 1 }}>
            {syncing ? "Sincronizando…" : "↻ sincronizar Meta"}
          </button>
        )}
        <Segmented value={days} options={PERIODS} onChange={setDays} />
      </PageHead>

      <div style={{ padding: "20px 24px 40px", display: "flex", flexDirection: "column", gap: 12 }}>
        {note && (
          <div className="mono" style={{ fontSize: 12, color: note.ok ? "var(--pos)" : "var(--neg)" }}>{note.text}</div>
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

        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(0,1fr))", gap: 12 }}>
          <StatTile label={`CAC · ${days}d`} value={biz?.window?.cac != null ? money(biz.window.cac) : "sem dado"}
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

        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", gap: 12 }}>
          <StatTile label="Investimento" value={t ? money(t.spend) : "…"} delta={t?.ctr != null ? `CTR ${String(t.ctr).replace(".", ",")}%` : null} />
          <StatTile label="Leads no período" value={t ? String(t.leads) : "…"} delta={t?.metaLeads ? `${t.metaLeads} reportados pela Meta` : null} />
          <StatTile label="Custo por call" value={costOf("Call closer") != null ? money(costOf("Call closer")) : "sem dado"} delta="leads que chegaram à call" />
          <StatTile label="Custo por ganho" value={costOf("Ganho") != null ? money(costOf("Ganho")) : "sem dado"} delta="leads que fecharam" />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Card title="Investimento por dia" hint="Meta Ads">
            <LineChart data={spendSeries} color="var(--chart-1)" fmtValue={(v) => money(v)} />
          </Card>
          <Card title="Leads por dia" hint="criados no cockpit">
            <LineChart data={leadSeries} color="var(--chart-2)" fmtValue={(v) => String(Math.round(v))} />
          </Card>
        </div>

        {biz?.series?.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Card title="Clientes novos por mês" hint="conversões do pipeline · 12 meses">
              <LineChart data={biz.series.map((m) => ({ x: monthLabel(m.month), v: m.newCustomers }))} color="var(--chart-2)" fmtValue={(v) => String(Math.round(v))} />
            </Card>
            <Card title="MRR por mês" hint="aproximado pela base atual · melhora quando houver histórico de churn">
              <LineChart data={biz.series.map((m) => ({ x: monthLabel(m.month), v: m.mrr }))} color="var(--chart-1)" fmtValue={(v) => money(v)} />
            </Card>
          </div>
        )}

        {data && !data.error && data.campaigns?.length > 0 && (
          <Card title="Por campanha" hint="leads e CPL reais atribuídos por UTM (utm_campaign = nome ou id da campanha)">
            <div style={{ overflowX: "auto", marginTop: 10 }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    {["Campanha", "Investimento", "Cliques", "Leads (UTM)", "CPL real", "Leads (Meta)", "CPL (Meta)"].map((h, i) => (
                      <th key={h} className="mono" style={{ textAlign: i === 0 ? "left" : "right", fontSize: 10.5, fontWeight: 500, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--fg-3)", padding: "10px 16px", borderTop: "1px solid var(--line-1)", borderBottom: "1px solid var(--line-1)", background: "var(--bg-inset)" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.campaigns.map((c) => (
                    <tr key={c.id}>
                      <td style={{ padding: "11px 16px", fontSize: 13, fontWeight: 600, borderBottom: "1px solid var(--line-1)" }}>{c.name || c.id}</td>
                      <td className="tnum" style={tdNum}>{money(c.spend)}</td>
                      <td className="tnum" style={tdNum}>{window.fmt.int(c.clicks)}</td>
                      <td className="tnum" style={tdNum}>{window.fmt.int(c.leads || 0)}</td>
                      <td className="tnum" style={{ ...tdNum, fontWeight: 600 }}>{c.cpl != null ? money(c.cpl) : "sem UTM"}</td>
                      <td className="tnum" style={tdNum}>{window.fmt.int(c.metaLeads)}</td>
                      <td className="tnum" style={tdNum}>{c.cplMeta != null ? money(c.cplMeta) : "sem lead"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        {metaOn && product.metaAdAccount && (
          <Card title="Gerenciar campanhas" hint="direto na Meta · pausar, reativar e ajustar orçamento diário">
            {camps == null && <div style={{ padding: "12px 16px", fontSize: 12.5, color: "var(--fg-4)" }}>carregando campanhas…</div>}
            {camps?.error && <div className="mono" style={{ padding: "12px 16px", fontSize: 12, color: "var(--neg)" }}>{camps.error}</div>}
            {Array.isArray(camps) && camps.length === 0 && <div style={{ padding: "12px 16px", fontSize: 12.5, color: "var(--fg-4)" }}>Nenhuma campanha na conta.</div>}
            {Array.isArray(camps) && camps.length > 0 && (
              <div style={{ overflowX: "auto", marginTop: 10 }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      {["Campanha", "Objetivo", "Orçamento/dia", "Situação", ""].map((h, i) => (
                        <th key={h + i} className="mono" style={{ textAlign: i >= 2 && i <= 3 ? "right" : "left", fontSize: 10.5, fontWeight: 500, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--fg-3)", padding: "10px 16px", borderTop: "1px solid var(--line-1)", borderBottom: "1px solid var(--line-1)", background: "var(--bg-inset)" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {camps.map((c) => {
                      const paused = c.status === "PAUSED";
                      const eff = c.effectiveStatus || c.status;
                      return (
                        <tr key={c.id}>
                          <td style={{ padding: "10px 16px", fontSize: 13, fontWeight: 600, borderBottom: "1px solid var(--line-1)" }}>{c.name}</td>
                          <td style={{ padding: "10px 16px", fontSize: 12, color: "var(--fg-3)", borderBottom: "1px solid var(--line-1)" }}>
                            {String(c.objective || "").replace("OUTCOME_", "").toLowerCase()}
                          </td>
                          <td style={{ padding: "10px 16px", textAlign: "right", borderBottom: "1px solid var(--line-1)" }}>
                            {c.dailyBudget != null ? (
                              <input type="number" min="1" step="1" defaultValue={c.dailyBudget} key={c.id + c.dailyBudget}
                                onBlur={(e) => saveBudget(c, e.target.value)}
                                onKeyDown={(e) => { if (e.key === "Enter") e.target.blur(); }}
                                title="Orçamento diário em R$ (salva ao sair do campo)"
                                style={{ width: 90, height: 26, padding: "0 8px", borderRadius: "var(--r-1)", border: "1px solid var(--line-2)", background: "var(--bg-1)", color: "var(--fg-1)", fontSize: 12.5, fontFamily: "var(--mono)", textAlign: "right" }} />
                            ) : (
                              <span className="mono" style={{ fontSize: 11.5, color: "var(--fg-4)" }} title="Orçamento definido nos conjuntos (ABO)">no conjunto</span>
                            )}
                          </td>
                          <td style={{ padding: "10px 16px", textAlign: "right", borderBottom: "1px solid var(--line-1)" }}>
                            <Pill tone={eff === "ACTIVE" ? "pos" : paused ? "mut" : "warn"}>
                              {eff === "ACTIVE" ? "ativa" : paused ? "pausada" : String(eff).toLowerCase()}
                            </Pill>
                          </td>
                          <td style={{ padding: "10px 16px", textAlign: "right", borderBottom: "1px solid var(--line-1)" }}>
                            <button onClick={() => toggleCampaign(c)}
                              style={{ height: 26, padding: "0 12px", borderRadius: 999, fontSize: 11.5, fontWeight: 600, border: "1px solid var(--line-2)", background: paused ? "var(--accent-soft)" : "var(--bg-2)", color: paused ? "var(--accent)" : "var(--fg-2)" }}>
                              {paused ? "reativar" : "pausar"}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        )}

        {perStage.length > 0 && t?.spend > 0 && (
          <Card title="Custo por etapa do funil" hint="investimento dividido pelos leads que chegaram em cada etapa">
            <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(perStage.length, 6)}, minmax(0,1fr))`, gap: 8, padding: "12px 16px 16px" }}>
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

        {ai && (() => {
          // Mostra em REAIS quando há câmbio (dólar comercial, cache de 1h na
          // API); sem cotação, cai pro dólar puro.
          const fx = ai.usdBrl;
          const cash = (usd) => (fx
            ? `R$ ${(usd * fx).toFixed(2).replace(".", ",")}`
            : `US$ ${usd.toFixed(2).replace(".", ",")}`);
          return (
            <Card title="Gasto com IA" hint={`OpenRouter e OpenAI · últimos ${days} dias${fx ? ` · dólar a R$ ${fx.toFixed(2).replace(".", ",")}` : " · em dólar (sem cotação agora)"}`}>
              <div style={{ display: "flex", gap: 24, alignItems: "flex-start", padding: "12px 16px 16px", flexWrap: "wrap" }}>
                <div style={{ minWidth: 160 }}>
                  <div className="mono" style={{ fontSize: 11, fontWeight: 500, letterSpacing: "0.07em", textTransform: "uppercase", color: "var(--fg-3)" }}>Total no período</div>
                  <div className="tnum" style={{ fontFamily: "var(--display)", fontSize: 28, fontWeight: 700, marginTop: 4 }}>
                    {cash(ai.totalPeriod)}
                  </div>
                  {fx && (
                    <div className="mono" style={{ fontSize: 11.5, color: "var(--fg-4)", marginTop: 2 }}>US$ {ai.totalPeriod.toFixed(2).replace(".", ",")}</div>
                  )}
                </div>
                <div style={{ flex: 1, minWidth: 280, display: "flex", flexDirection: "column", gap: 6 }}>
                  {ai.providers.map((p) => (
                    <div key={p.provider} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13 }}>
                      <span style={{ width: 90, fontWeight: 600 }}>{p.label}</span>
                      {p.ok && p.spend != null && (
                        <span className="tnum mono" style={{ fontWeight: 500 }}>{cash(p.spend)}</span>
                      )}
                      {p.ok && p.spend == null && p.lifetimeSpend != null && (
                        <span className="tnum mono" style={{ color: "var(--fg-2)" }}>
                          {cash(p.lifetimeSpend)} acumulado · saldo {cash(p.remaining)}
                        </span>
                      )}
                      {!p.ok && <span style={{ fontSize: 12, color: "var(--warn)" }}>{p.error}</span>}
                    </div>
                  ))}
                </div>
              </div>
            </Card>
          );
        })()}

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

const monthLabel = (mk) => {
  const [y, m] = String(mk).split("-");
  const names = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  return `${names[Number(m) - 1] || m} ${String(y).slice(2)}`;
};

const tdNum = { padding: "11px 16px", fontSize: 13, textAlign: "right", borderBottom: "1px solid var(--line-1)", fontFamily: "var(--mono)" };

export { MetricsScreen };
