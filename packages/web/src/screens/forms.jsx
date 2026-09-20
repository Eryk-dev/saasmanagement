import React from "react";
import "./marketing.css";
import "./forms.css";
import { api } from "../lib/api.js";
import { useData } from "../data.jsx";
import { chromeBtnStyleSmall, GRADE_STYLE, leadTier } from "../lib/ui.js";
import { EmptyState, PrimaryButton, Skeleton } from "../atoms.jsx";
import { inputStyle, sectionTitle, cardStyle, addBtnStyle, THEME_DEFAULTS, LabeledInput, ThemeEditor } from "../components/theme-inputs.jsx";
import { useActiveSaas } from "../lib/workspace.js";
import { useAttribution } from "../lib/pains.js";
import { InsightsList } from "../components/insights.jsx";
import { sourceLabel } from "../lib/sources.js";
import { AbcCell } from "../components/abc-cell.jsx";
import { CorrenteDoDinheiro } from "../components/story.jsx";
import { Card } from "../components/viz.jsx";
import { usePeriod } from "../components/period-picker.jsx";
// Form builder — formulários de captação por SaaS, estilo Typeform: uma pergunta
// por vez, branching por opção, tema por marca. Lista → editor (com preview
// server-side em iframe) → respostas. A página pública vive na API (/f/:id).

const { useState, useEffect, useRef, useCallback, useMemo } = React;

// Filtro de período da tela. 90 dias existe porque o ciclo de venda passa de um
// mês: numa janela de 30d o lead que fecha aparece sem a submissão que o
// originou (o corte é pela data da SUBMISSÃO), e a coluna Fecharam vive vazia.
const PERIOD_PRESETS = [["hoje", "hoje"], ["ontem", "ontem"], ["7", "7 dias"], ["30", "30 dias"], ["90", "90 dias"], ["", "tudo"]];

const dayStart = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x.toISOString(); };
const dayEnd = (d) => { const x = new Date(d); x.setHours(23, 59, 59, 999); return x.toISOString(); };

// Range SEMPRE ancorado em fronteira de dia: o valor fica estável entre
// re-renders (um since com Date.now() cru mudava a cada tick do tempo real,
// re-disparava o fetch e fazia a tela piscar "carregando…" sem parar).
function periodRange(preset, custom = { since: "", until: "" }) {
  const now = new Date();
  if (preset === "hoje") return { since: dayStart(now), until: "" };
  if (preset === "ontem") { const y = new Date(now); y.setDate(y.getDate() - 1); return { since: dayStart(y), until: dayEnd(y) }; }
  if (preset === "custom") return {
    since: custom.since ? dayStart(custom.since + "T12:00:00") : "",
    until: custom.until ? dayEnd(custom.until + "T12:00:00") : "",
  };
  if (!preset) return { since: "", until: "" };
  const from = new Date(now); from.setDate(from.getDate() - (Number(preset) - 1));
  return { since: dayStart(from), until: "" }; // "últimos N dias" = N dias corridos incluindo hoje
}

const periodLabel = (preset, custom) => (preset === "custom"
  ? [custom?.since, custom?.until].filter(Boolean).join(" a ") || "personalizado"
  : (PERIOD_PRESETS.find(([k]) => k === preset) || [null, "período"])[1]);

const QUESTION_TYPES = [
  ["text", "Texto curto"], ["textarea", "Texto longo"], ["email", "E-mail"],
  ["phone", "Telefone"], ["number", "Número"], ["select", "Escolha única"], ["multiselect", "Múltipla escolha"],
  ["insight", "Tela de insight (loading)"],
];
const LEAD_FIELDS = [["name", "Nome do lead"], ["email", "E-mail"], ["phone", "Telefone"], ["company", "Empresa"], ["amount", "Valor (R$)"]];

// Base das URLs públicas: no dev o proxy do Vite repassa /f e /embed.js pra API.
const publicBase = () => import.meta.env.VITE_API_BASE || window.location.origin;
const formUrl = (f) => `${publicBase()}/f/${f.id}`;

const slug = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "")
  .toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);

// Tabela do teste A/B no card — mesmo desenho da "Por dor" (Publicidade):
// grid fracionário, número forte + contexto pequeno na linha de baixo.
// Uma coluna só "Clientes ABC" (mesma célula da Publicidade), no lugar das 6
// colunas separadas por grade.
const AB_GRID = "minmax(200px,1.7fr) 74px 104px 104px 132px 96px 104px 96px";

// Célula numérica: contagem em negrito em cima, subtexto (%) embaixo; zero
// vira "—" — zero cinza repetido em toda célula é o que deixava a leitura ruim.
function AbNum({ count, sub, ink }) {
  if (!count) return <span className="tnum" style={{ textAlign: "right", color: "var(--fg-4)" }}>—</span>;
  return (
    <span className="tnum" style={{ display: "inline-flex", flexDirection: "column", alignItems: "flex-end", gap: 1, justifySelf: "end" }}>
      <span style={{ fontWeight: 700, color: ink || "var(--fg-1)" }}>{window.fmt.int(count)}</span>
      {sub && <span style={{ fontSize: 10.5, color: "var(--fg-4)", whiteSpace: "nowrap" }}>{sub}</span>}
    </span>
  );
}

function FormsScreen({ saasId }) {
  const { SAAS } = window.SEED;
  const { version } = useData();
  // Produto do WORKSPACE (seletor no pé da sidebar) — sem abas próprias.
  const [activeProduct] = useActiveSaas();
  const active = activeProduct?.id;
  const [forms, setForms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [publishing, setPublishing] = useState(null);
  const loadEpoch = useRef(0);
  const [counts, setCounts] = useState({}); // formId -> nº de respostas
  const [stats, setStats] = useState({});
  const [statsLoading,setStatsLoading]=useState(true), [statsError,setStatsError]=useState(null), [statsAttempt,setStatsAttempt]=useState(0);
  const currentProduct=useRef(active);currentProduct.current=active;
  const publishWriting=useRef(false);   // formId -> { views, submits } · 30d (funil)
  const [submissions, setSubmissions] = useState([]);
  const [view, setView] = useState({ mode: "list" }); // list | edit | subs
  const [toast, setToast] = useState(null);
  // Janela GLOBAL do cockpit (filtro único no topo, 08/08): o formFunnel corta
  // por datetime completo, então a janela vira bordas de dia em ISO.
  const { win } = usePeriod();
  const range = useMemo(() => ({
    since: dayStart(win.since + "T12:00:00"),
    until: dayEnd(win.until + "T12:00:00"),
  }), [win.since, win.until]);

  const load = useCallback(async () => {
    if (!active) return;
    const epoch = ++loadEpoch.current;
    setLoading(true); setLoadError("");
    try {
      // Uma ida só: forms ordenados, contagem por form e as 6 respostas mais
      // recentes (antes baixava TODAS as respostas do produto só pra isso).
      const ov = await api.formsOverview(active);
      if (epoch !== loadEpoch.current) return;
      setForms(ov.forms || []); setCounts(ov.counts || {}); setSubmissions(ov.recent || []);
    } catch (e) {
      if (epoch === loadEpoch.current) setLoadError(e.message || "Tente carregar novamente.");
    } finally {
      if (epoch === loadEpoch.current) setLoading(false);
    }
  }, [active]);

  useEffect(() => { load(); return () => { loadEpoch.current++; }; }, [load, version]);

  // Métricas de funil dos forms publicados (tiles do topo E tabela do A/B saem
  // daqui, então o período manda nas duas). Fetch SEPARADO do load e disparado
  // JUNTO com ele (não espera a lista chegar): trocar de período não precisa
  // rebuscar forms e respostas, que não dependem da janela. Uma chamada só pro
  // produto inteiro em vez de uma por form.
  useEffect(() => {
    if (!active) { setStats({}); return; }
    let alive = true;setStatsLoading(true);setStatsError(null);
    api.formFunnels(active, range).then((st) => { if (alive) setStats(st || {}); }).catch(e=>{if(alive)setStatsError(e.message);}).finally(()=>{if(alive)setStatsLoading(false);});
    return () => { alive = false; };
  }, [active, range.since, range.until, version, statsAttempt]);

  // Troca de produto (workspace) volta pra lista e limpa as linhas antigas —
  // editor/respostas do produto anterior não podem ficar abertos sob a marca
  // do outro, nem as linhas dele aparecer sob o cabeçalho novo.
  useEffect(() => {
    setView((v) => (v.mode === "list" ? v : { mode: "list" }));
    setForms([]); setCounts({}); setStats({}); setSubmissions([]);
  }, [active]);

  function flash(msg) { setToast(msg); setTimeout(() => setToast(null), 1800); }
  async function copy(text, msg) {
    try { await navigator.clipboard.writeText(text); flash(msg); }
    catch { window.prompt("Copie:", text); }
  }
  async function togglePublish(f) {
    if (publishWriting.current) return;
    publishWriting.current=true;setPublishing(f.id);
    try {
      await api.update("forms", f.id, { status: f.status === "published" ? "draft" : "published" });
      if(currentProduct.current!==active)return;
      await load();setStatsAttempt(n=>n+1);
      flash(f.status === "published" ? "Formulário despublicado" : "Formulário publicado");
    } catch (e) { window.toast?.(`Não deu para alterar a publicação: ${e.message}`, "neg"); }
    finally { publishWriting.current=false;setPublishing(null); }
  }

  if (!SAAS.length) return (
    <EmptyState title="Nenhum SaaS ainda" hint="Crie um produto em Ajustes — cada form pertence a um SaaS (tema, pipeline e propostas da marca)." />
  );

  if (view.mode === "edit") return (
    <FormEditor
      key={view.form?.id || `new-${active}`} form={view.form} saasId={active}
      onDone={async () => { if(currentProduct.current!==active)return; setView({ mode: "list" }); await load(); }}
      onCancel={() => setView({ mode: "list" })}
    />
  );
  if (view.mode === "subs") return (
    <SubmissionsView key={view.form.id} form={view.form} initialOpen={view.subId} stat={stats[view.form.id]} statsLoading={statsLoading} statsError={statsError} retryStats={()=>setStatsAttempt(n=>n+1)} periodLabel={win.label} onBack={() => setView({ mode: "list" })} />
  );


  return (
    <div className="marketing-page forms-page">
      <header className="forms-head"><h1>Formulários</h1><PrimaryButton onClick={() => setView({ mode: "edit", form: null })}>Criar formulário</PrimaryButton></header>
      <div className="forms-body">
        {loadError && <EmptyState title="Não deu para carregar os formulários" hint={loadError} action={<button className="inp" onClick={load}>Tentar de novo</button>} />}
        {loading && !forms.length && <FormsSkeleton />}
        {!forms.length ? (!loading && !loadError && (
          <EmptyState
            title="Nenhum form neste SaaS"
            hint="Crie um formulário de captação: uma pergunta por vez, com branching e o tema da marca. Cada resposta vira um lead no pipeline."
            action={<PrimaryButton onClick={() => setView({ mode: "edit", form: null })}>+ Criar form</PrimaryButton>}
          />
        )) : (
          <div className="forms-list">
            {[...forms].sort((a, b) => (b.status === "published" ? 1 : 0) - (a.status === "published" ? 1 : 0)).map((f) => {
              const pub = f.status === "published";
              const stat = stats[f.id];
              const visits = Number(stat?.views) || 0;
              const starts = Number(stat?.starts) || 0;
              const leads = Number(stat?.submits) || 0;
              const callsShown = Number(stat?.callsShown) || 0;
              const pct = (a, b) => b > 0 ? `${((a / b) * 100).toFixed(1).replace(".", ",")}%` : "0%";
              // Teste A/B visível no card: headline REAL de cada variante (base e
              // por dor, com herança de campo vazio), agrupado por dor e com o
              // veredito do campeão — mesmo critério da análise completa.
              const abVariants = (stat?.variants || []).filter((v) => v.views > 0);
              const abVerdicts = championVerdicts(abVariants);
              const abGroups = [];
              for (const v of abVariants) {
                const key = v.pain || "";
                let g = abGroups.find((x) => x.pain === key);
                if (!g) { g = { pain: key, rows: [] }; abGroups.push(g); }
                g.rows.push(v);
              }
              abGroups.sort((a, b) => (a.pain === "" ? -1 : b.pain === "" ? 1 : a.pain.localeCompare(b.pain)));
              for (const g of abGroups) g.rows.sort((a, b) => (b.views ? b.starts / b.views : 0) - (a.views ? a.starts / a.views : 0));
              const vDefs = [...(f.welcome?.variants || []), ...Object.values(f.welcome?.byPain || {}).flatMap((p) => p.variants || [])];
              const variantTitle = (v) => {
                const def = vDefs.find((x) => String(x.id) === String(v.id));
                if (!def) return `Variante ${v.id} (encerrada)`;
                return def.title || f.welcome?.byPain?.[v.pain]?.title || f.welcome?.title || `Variante ${v.id}`;
              };
              const painMap = (SAAS.find((x) => x.id === f.saas) || {}).painMap || {};
              return (
                // Publicado ocupa a LARGURA TODA (a tabela do teste A/B precisa de
                // área); rascunho/backup vira um bloco compacto abaixo, sem esticar.
                <section key={f.id} className="forms-card" data-published={pub}>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "inline-flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 15.5, fontWeight: 600, letterSpacing: "-.01em" }}>{f.name || f.id}</span>
                        <button disabled={!!publishing} onClick={() => togglePublish(f)} title={pub ? "despublicar" : "publicar"} style={{ display: "inline-flex", alignItems: "center", gap: 6, color: pub ? "var(--pos)" : "var(--warn)", fontSize: 12, fontWeight: 600 }}><span style={{ width: 6, height: 6, borderRadius: 99, background: "currentColor" }} />{publishing === f.id ? "salvando…" : pub ? "publicado" : "rascunho"}</button>
                      </div>
                      <div className="forms-url" style={{ fontSize: 11.5, color: "var(--fg-4)", marginTop: 4 }}>/f/{f.id}</div>
                    </div>
                    <div className="forms-card-actions">
                      {pub && <button onClick={() => copy(formUrl(f), "Link copiado")} style={{ ...chromeBtnStyleSmall, height: 30, padding: "0 11px" }}>Copiar link</button>}
                      <button onClick={() => setView({ mode: "edit", form: f })} style={{ ...chromeBtnStyleSmall, height: 30, padding: "0 11px" }}>Editar</button>
                      {!pub && <button disabled={!!publishing} onClick={() => togglePublish(f)} style={{ height: 30, padding: "0 12px", borderRadius: 999, background: "var(--btn-bg)", color: "var(--btn-fg)", fontSize: 12.5, fontWeight: 600 }}>Publicar</button>}
                    </div>
                  </div>

                  {pub ? (statsLoading || statsError ? <div className="forms-metrics-state" role={statsError ? "alert" : "status"}>{statsError ? <>Não foi possível carregar os indicadores. <button onClick={()=>setStatsAttempt(n=>n+1)}>Tentar novamente</button></> : "Carregando indicadores…"}</div> : <>
                      <div className="forms-funnel" style={{ marginTop: 18 }}>
                        <CorrenteDoDinheiro bare passos={[
                          { rotulo: `visitas · ${win.label}`, valor: window.fmt.int(visits) },
                          { rotulo: "começaram", valor: window.fmt.int(starts), taxa: pct(starts, visits), taxaNota: "das visitas" },
                          { rotulo: "envios", valor: window.fmt.int(leads), taxa: pct(leads, starts), taxaNota: "de quem começou" },
                          { rotulo: "calls realizadas", valor: window.fmt.int(callsShown), taxa: pct(callsShown, leads), taxaNota: "dos envios", title: "Leads dos envios do período que compareceram à call, contados uma vez por formulário." },
                          { rotulo: "viraram cliente", valor: window.fmt.int(Number(stat?.won) || 0), taxa: pct(Number(stat?.won) || 0, callsShown), taxaNota: "das calls", tom: "pos" },
                          { rotulo: "receita fechada", valor: window.fmt.moneyFull(Number(stat?.revenue) || 0), tom: "pos" },
                        ]} />
                        <div className="marketing-toolbar forms-funnel-footer">
                          <span style={{ fontSize: 11.5, color: "var(--fg-3)" }}>{stat?.lastSubmitAt ? `último envio ${new Date(stat.lastSubmitAt).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })}` : "sem envios no período"}</span>
                          <button onClick={() => setView({ mode: "subs", form: f })} style={{ fontSize: 12, fontWeight: 600, color: "var(--accent)" }}>Ver respostas →</button>
                        </div>
                      </div>
                      {abVariants.length > 1 && (
                        <div style={{ marginTop: 16 }}>
                          <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 8 }}>
                            <span className="kicker" style={{ fontWeight: 600 }}>Teste A/B · headline</span>
                            <span style={{ flex: 1 }} />
                            <button onClick={() => setView({ mode: "subs", form: f })} style={{ fontSize: 11.5, fontWeight: 600, color: "var(--accent)" }}>análise completa →</button>
                          </div>
                          {/* Tabela por variante no padrão da "Por dor" (Publicidade): grid
                              com respiro, número forte + contexto pequeno embaixo e "—" no
                              lugar de zero (zero cinza em toda célula vira ruído) — funil
                              (visitas → começar → lead), potencial (cliente A/B/C), call
                              agendada e fechamento (ganhos + receita). */}
                          <div className="tbl-x forms-ab">
                            <div style={{ minWidth: 1030 }}>
                              <div className="kicker" style={{ display: "grid", gridTemplateColumns: AB_GRID, gap: 12, padding: "10px 18px", fontWeight: 600, background: "var(--bg-inset)" }}>
                                <span title="texto da welcome que o lead viu">Headline</span>
                                <span style={{ textAlign: "right" }} title="sessões únicas que viram a variante">Visitas</span>
                                <span style={{ textAlign: "right" }} title="clicaram em começar · % das visitas">Começaram</span>
                                <span style={{ textAlign: "right" }} title="finalizaram o form · % das visitas">Leads</span>
                                <span style={{ textAlign: "right" }} title="clientes por potencial (A/B/C) que a variante trouxe, na mesma leitura da Publicidade">Clientes ABC</span>
                                <span style={{ textAlign: "right" }} title="leads com call agendada com o closer · % dos leads">Call</span>
                                <span style={{ textAlign: "right" }} title="viraram contrato (Ganho) · % dos leads">Fecharam</span>
                                <span style={{ textAlign: "right" }} title="soma do valor dos contratos fechados">Receita</span>
                              </div>
                              {abGroups.map((g) => (
                                <React.Fragment key={g.pain || "base"}>
                                  {abGroups.length > 1 && (
                                    <div style={{ padding: "11px 18px 3px", fontSize: 11.5, color: "var(--fg-4)" }}>
                                      <span className="mono code" style={{ fontSize: 10.5, fontWeight: 700, color: "var(--accent)" }}>{g.pain ? `[${g.pain}]` : "BASE"}</span>
                                      {" "}{g.pain ? (painMap[g.pain] || `dor ${g.pain}`) : "sem dor (tráfego direto)"}
                                    </div>
                                  )}
                                  {g.rows.map((v) => {
                                    const verdict = abVerdicts[`${v.pain || ""}|${v.id}`];
                                    const gr = v.grades || {};
                                    const vLeads = v.leads ?? v.submits;
                                    return (
                                      <div key={v.id} style={{ display: "grid", gridTemplateColumns: AB_GRID, gap: 12, padding: "13px 18px", alignItems: "center", borderTop: "1px solid var(--line-faint)", fontSize: 13 }}>
                                        <div style={{ minWidth: 0 }}>
                                          <div style={{ display: "flex", alignItems: "baseline", gap: 7, minWidth: 0 }}>
                                            <span className="mono code" style={{ flexShrink: 0, fontSize: 10.5, fontWeight: 700, color: "var(--fg-4)" }}>{v.id}</span>
                                            <span style={{ flex: 1, minWidth: 0, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={variantTitle(v)}>“{variantTitle(v)}”</span>
                                          </div>
                                          {verdict?.label && <div className="mono" style={{ fontSize: 10, fontWeight: 600, color: verdict.tone, marginTop: 3 }}>{verdict.label}</div>}
                                        </div>
                                        <span className="tnum" style={{ textAlign: "right" }}>{window.fmt.int(v.views)}</span>
                                        <AbNum count={v.starts} sub={`${pct(v.starts, v.views)} das visitas`} />
                                        <AbNum count={vLeads} sub={`${pct(v.submits, v.views)} das visitas`} />
                                        <span style={{ justifySelf: "end" }}><AbcCell abc={gr} abcCost={null} money={window.fmt.moneyFull} /></span>
                                        <AbNum count={v.calls || 0} sub={`${pct(v.calls || 0, vLeads || 0)} dos leads`} />
                                        <AbNum count={v.won || 0} sub={`${pct(v.won || 0, vLeads || 0)} dos leads`} ink="var(--pos)" />
                                        <span className="tnum" style={{ textAlign: "right", fontWeight: 600, color: v.revenue ? "var(--fg-1)" : "var(--fg-4)" }}>{v.revenue ? window.fmt.moneyFull(v.revenue) : "—"}</span>
                                      </div>
                                    );
                                  })}
                                </React.Fragment>
                              ))}
                            </div>
                          </div>
                        </div>
                      )}
                    </>
                  ) : (
                    <div style={{ marginTop: 10, fontSize: 12.5, color: "var(--fg-4)" }}>
                      {(f.questions || []).length} perguntas · rascunho guardado, publique para começar a captar leads.
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        )}

        {forms.length > 0 && <RecentSubmissions submissions={submissions} forms={forms} onOpen={(form,subId) => setView({ mode: "subs", form, subId })} />}
      </div>

      {toast && (
        <div className="mono" style={{ position: "fixed", bottom: 22, left: "50%", transform: "translateX(-50%)", background: "var(--bg-3)", border: "1px solid var(--line-1)", borderRadius: "var(--r-2)", padding: "8px 14px", fontSize: 12, boxShadow: "var(--shadow-pop)", zIndex: 90 }}>
          {toast}
        </div>
      )}
    </div>
  );
}

// Estrutura da lista enquanto o overview carrega: 3 cards com a medida real
// (título, status, 4 tiles), no lugar do texto solto ou do EmptyState falso.
function FormsSkeleton() {
  return (
    <div role="status" aria-label="carregando formulários" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 380px), 1fr))", gap: 14 }}>
      {[0, 1, 2].map((i) => (
        <div key={i} className="marketing-card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <Skeleton w="55%" h={16} />
            <Skeleton w={72} h={20} r={999} />
          </div>
          <Skeleton w="80%" h={12} />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
            {[0, 1, 2, 3].map((k) => <Skeleton key={k} h={46} r={8} />)}
          </div>
        </div>
      ))}
    </div>
  );
}

function RecentSubmissions({ submissions, forms, onOpen }) {
  const formById = Object.fromEntries(forms.map((form) => [form.id, form]));
  const rows = submissions.filter((submission) => !submission.internal).slice(0, 6);
  const mapped = (submission, field) => {
    const form = formById[submission.form];
    const key = form?.mapping?.[field];
    return (key && submission.answers?.[key]) || submission.answers?.[field] || submission.answers?.[{ name: "nome", company: "empresa" }[field]] || "";
  };
  const when = (iso) => {
    if (!iso) return "—";
    const value = new Date(iso);
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const day = new Date(value.getFullYear(), value.getMonth(), value.getDate());
    const diff = Math.round((start - day) / 86400e3);
    if (diff === 0) return value.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    if (diff === 1) return "ontem";
    return value.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }).replace(".", "");
  };

  return (
    <Card title="Envios recentes" hint="cada envio vira lead em Novo lead" style={{ overflow: "hidden" }}>
     {/* .tbl-x: as 5 colunas rolam na horizontal no mobile em vez de virar
         colunas de 30px ilegíveis. */}
     <div className="tbl-x"><div style={{ minWidth: 640 }}>
      <div className="kicker" style={{ display: "grid", gridTemplateColumns: "1.2fr 1.4fr 1fr 1.2fr .6fr", gap: 12, padding: "10px 24px", fontWeight: 600, borderTop: "1px solid var(--line-1)", background: "var(--bg-inset)" }}>
        <span>Nome</span><span>E-mail</span><span>Empresa</span><span>Origem</span><span style={{ textAlign: "right" }}>Quando</span>
      </div>
      {rows.map((submission) => {
        const form = formById[submission.form];
        const source = sourceLabel(submission.utm) || "direto";
        const attribution = submission.utm?.content || submission.utm?.campaign;
        return (
          <div key={submission.id} style={{ display: "grid", gridTemplateColumns: "1.2fr 1.4fr 1fr 1.2fr .6fr", gap: 12, padding: "13px 24px", alignItems: "center", borderTop: "1px solid var(--line-faint)", fontSize: 13.5 }}>
            <button onClick={() => form && onOpen(form,submission.id)} style={{ textAlign: "left", fontSize: 13.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{mapped(submission, "name") || "Sem nome"}</button>
            <span className="mono code" style={{ fontSize: 12, color: "var(--fg-3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{mapped(submission, "email") || "—"}</span>
            <span style={{ color: "var(--fg-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{mapped(submission, "company") || "—"}</span>
            <span className="mono code" style={{ fontSize: 12, color: "var(--fg-4)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{source}{attribution ? ` · ${attribution}` : ""}</span>
            <span className="tnum" style={{ textAlign: "right", color: "var(--fg-3)" }}>{when(submission.createdAt)}</span>
          </div>
        );
      })}
      {!rows.length && <div style={{ padding: "18px 24px", borderTop: "1px solid var(--line-1)", color: "var(--fg-4)", fontSize: 13 }}>nenhum envio ainda</div>}
     </div></div>
    </Card>
  );
}

// ── Editor ──────────────────────────────────────────────────────────────────

function newForm(saasId) {
  return {
    name: "", saas: saasId, status: "draft",
    theme: { ...THEME_DEFAULTS },
    welcome: null,
    questions: [{ key: "nome", label: "Qual é o seu nome?", type: "text", required: true, placeholder: "", help: "", options: [] }],
    thanks: { title: "Recebido! Obrigado.", subtitle: "", redirectUrl: "", whatsapp: "", whatsappMsg: "", whatsappPrefill: "", whatsappAuto: false },
    reject: { title: "", subtitle: "" },
    mapping: { name: "nome" },
  };
}

function FormEditor({ form, saasId, onDone, onCancel }) {
  const isEdit = !!form?.id;
  const [draft, setDraft] = useState(() => form
    ? { ...newForm(saasId), ...structuredClone(form), theme: { ...THEME_DEFAULTS, ...(form.theme || {}) } }
    : newForm(saasId));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const writing=useRef(false), original=useRef(JSON.stringify(draft));
  const dirty=JSON.stringify(draft)!==original.current;
  const set = (patch) => {if(!writing.current)setDraft((d) => ({ ...d, ...patch }));};
  const close=()=>{if(writing.current)return;if(dirty&&!window.confirm("Descartar as alterações não salvas do formulário?"))return;onCancel();};
  useEffect(()=>{if(!dirty)return;const guard=e=>{e.preventDefault();e.returnValue="";};window.addEventListener("beforeunload",guard);return()=>window.removeEventListener("beforeunload",guard);},[dirty]);

  // Preview server-side (mesmo HTML da página pública), debounced.
  const [previewHtml, setPreviewHtml] = useState("");
  const timer = useRef(null);
  const [previewError,setPreviewError]=useState(null),[previewAttempt,setPreviewAttempt]=useState(0),[previewLoading,setPreviewLoading]=useState(false);
  useEffect(() => {
    let alive=true;clearTimeout(timer.current);setPreviewLoading(true);setPreviewError(null);
    timer.current = setTimeout(async () => {
      try {const result=await api.formPreview(draft);if(alive)setPreviewHtml(result.html);}
      catch(e) {if(alive)setPreviewError(e.message);}
      finally {if(alive)setPreviewLoading(false);}
    }, 500);
    return () => {alive=false;clearTimeout(timer.current);};
  }, [draft,previewAttempt]);

  function validate() {
    if (!String(draft.name).trim()) return "Dê um nome ao form";
    const qs = (draft.questions || []).filter((q) => String(q.label).trim());
    if (!qs.length) return "Adicione ao menos uma pergunta";
    const keys = qs.map((q) => q.key);
    if (keys.some((k) => !String(k).trim())) return "Toda pergunta precisa de uma chave";
    if (new Set(keys).size !== keys.length) return "Chaves de pergunta duplicadas";
    return null;
  }

  async function save() {
    if(writing.current)return;
    const err = validate();
    if (err) { setError(err); return; }
    writing.current=true;setBusy(true); setError(null);
    const payload = {
      name: draft.name.trim(), saas: draft.saas, status: draft.status,
      theme: draft.theme,
      submitLabel: String(draft.submitLabel || '').trim(),
      welcome: draft.welcome && String(draft.welcome.title || "").trim() ? draft.welcome : null,
      questions: (draft.questions || [])
        .filter((q) => String(q.label).trim() && String(q.key).trim())
        .map((q, i) => {
          const base = { key: q.key.trim(), label: q.label.trim(), type: q.type || "text", required: !!q.required };
          if (q.stack && i > 0 && q.type !== "insight") base.stack = true;
          if (q.placeholder) base.placeholder = q.placeholder;
          if (q.help) base.help = q.help;
          if (q.to) base.to = q.to;
          if (q.type === "insight") {
            base.required = false;
            if (q.stat) base.stat = q.stat;
            if (q.statLabel) base.statLabel = q.statLabel;
            if (Number(q.durationMs) > 0) base.durationMs = Number(q.durationMs);
          }
          if (q.type === "select" || q.type === "multiselect") {
            base.options = (q.options || [])
              .filter((o) => String(o.value || "").trim())
              .map((o) => {
                const opt = { value: o.value.trim(), label: String(o.label || o.value).trim() };
                if (o.to) opt.to = o.to;
                if (o.exit) opt.exit = o.exit;
                return opt;
              });
          }
          return base;
        }),
      thanks: draft.thanks,
      // Tela de descarte: só persiste se o builder configurou algum texto.
      reject: draft.reject && (String(draft.reject.title || "").trim() || String(draft.reject.subtitle || "").trim()) ? draft.reject : null,
      exits: Object.keys(draft.exits || {}).length ? draft.exits : null,
      mapping: Object.fromEntries(Object.entries(draft.mapping || {}).filter(([, v]) => v)),
    };
    try {
      if (isEdit) await api.update("forms", form.id, payload);
      else await api.create("forms", payload);
      await onDone();
    } catch (e) {
      setError(e.message || String(e));
    } finally {writing.current=false;setBusy(false);}
  }

  const qKeys = (draft.questions || []).filter((q) => q.key && q.type !== "insight").map((q) => ({ value: q.key, label: q.label || q.key }));

  return (
    <div className="marketing-page forms-page forms-editor">
      <header className="forms-head"><h1>{isEdit ? "Editar formulário" : "Novo formulário"}</h1><div className="forms-editor-actions"><span className="dim">{draft.status==="published" ? "Publicado" : "Rascunho"}</span><button disabled={busy} onClick={close}>Cancelar</button><PrimaryButton onClick={save} disabled={busy}>{busy ? "Salvando…" : "Salvar"}</PrimaryButton></div></header>
      <div className="forms-editor-grid">
        <fieldset disabled={busy} className="forms-editor-fields">
          {error && <div role="alert" className="forms-error">{error}</div>}
          <LabeledInput label="Nome do form" value={draft.name} onChange={(v) => set({ name: v })} placeholder="Diagnóstico · LeverAds" />

          <div className="kicker" style={sectionTitle}>Boas-vindas (opcional)</div>
          {!draft.welcome ? (
            <button onClick={() => set({ welcome: { title: "", subtitle: "", button: "Começar" } })} style={addBtnStyle}>+ adicionar tela de boas-vindas</button>
          ) : (
            <div style={cardStyle}>
              <LabeledInput label="Título" value={draft.welcome.title} onChange={(v) => set({ welcome: { ...draft.welcome, title: v } })} />
              <details className="forms-advanced"><summary>Opções de boas-vindas e teste A/B</summary>
              <LabeledInput label="Subtítulo" value={draft.welcome.subtitle} onChange={(v) => set({ welcome: { ...draft.welcome, subtitle: v } })} />
              <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
                <LabeledInput label="Texto do botão" value={draft.welcome.button} onChange={(v) => set({ welcome: { ...draft.welcome, button: v } })} />
                <button onClick={() => set({ welcome: null })} className="mono dim" style={{ fontSize: 12, padding: "8px 6px" }}>remover</button>
              </div>
              <VariantsEditor welcome={draft.welcome} onChange={(w) => set({ welcome: w })} />
              <PainWelcomesEditor welcome={draft.welcome} saas={draft.saas} onChange={(w) => set({ welcome: w })} />
              </details>
            </div>
          )}

          <div className="kicker" style={sectionTitle}>Perguntas</div>
          <div className="mono dim" style={{ fontSize: 11, marginBottom: 8, lineHeight: 1.5 }}>
            Nos títulos, *palavra* vira itálico na cor da marca. "Tela de insight" mostra copy + estatística entre perguntas e avança sozinha.
          </div>
          <QuestionsBuilder
            questions={draft.questions || []}
            exits={draft.exits || {}}
            onChange={(qs) => set({ questions: qs })}
          />

          <div className="kicker" style={sectionTitle}>Tela final (qualificado)</div>
          <LabeledInput label="Texto do botão de enviar (última tela)" value={draft.submitLabel || ""} onChange={(v) => set({ submitLabel: v })} placeholder="Enviar" />

          <div style={cardStyle}>
            <LabeledInput label="Título" value={draft.thanks?.title || ""} onChange={(v) => set({ thanks: { ...draft.thanks, title: v } })} />
            <LabeledInput label="Subtítulo" value={draft.thanks?.subtitle || ""} onChange={(v) => set({ thanks: { ...draft.thanks, subtitle: v } })} />
            <LabeledInput label="Redirecionar para (URL, opcional)" value={draft.thanks?.redirectUrl || ""} onChange={(v) => set({ thanks: { ...draft.thanks, redirectUrl: v } })} placeholder="https://…" />
            <LabeledInput label="WhatsApp do time (vazio = o número conectado no cockpit)" value={draft.thanks?.whatsapp || ""} onChange={(v) => set({ thanks: { ...draft.thanks, whatsapp: v } })} placeholder="usa o número do cockpit" />
            <LabeledInput label="Texto acima do botão WhatsApp" value={draft.thanks?.whatsappMsg || ""} onChange={(v) => set({ thanks: { ...draft.thanks, whatsappMsg: v } })} placeholder="Caso tenha ficado com alguma dúvida, você pode falar com nosso time agora." />
            <LabeledInput label="Mensagem que o LEAD envia no WhatsApp (opcional)" value={draft.thanks?.whatsappPrefill || ""} onChange={(v) => set({ thanks: { ...draft.thanks, whatsappPrefill: v } })} placeholder="Oi, me chamo {{nome}} e quero saber mais. Resumo: nicho - {{niche}}, contas - {{accounts}}." />
            <div className="mono dim" style={{ fontSize: 11, margin: "-4px 0 8px", lineHeight: 1.5 }}>
              Vai pré-preenchida no WhatsApp do lead pro número acima, então o time recebe o contato já com o resumo. Campos disponíveis: {(draft.questions || []).filter((q) => q.key).map((q) => "{{" + q.key + "}}").join("  ") || "(nenhum ainda)"}
            </div>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer", opacity: draft.thanks?.whatsappPrefill ? 1 : 0.5 }}>
              <input type="checkbox" checked={!!draft.thanks?.whatsappAuto} onChange={(e) => set({ thanks: { ...draft.thanks, whatsappAuto: e.target.checked } })} />
              Abrir o WhatsApp automaticamente ao finalizar (encaminha o lead pro chat com a mensagem pronta)
            </label>
          </div>

          <div className="kicker" style={sectionTitle}>Tela final (não qualificado)</div>
          <div className="mono dim" style={{ fontSize: 11, marginBottom: 8, lineHeight: 1.5 }}>
            Mostrada quando uma opção rota para <b>→ fim (não qualificado)</b>. O contato ainda é
            registrado (marcado como desqualificado), mas <b>sem proposta e sem contar como conversão</b> (Pixel/CAPI).
          </div>
          <div style={cardStyle}>
            <LabeledInput label="Título" value={draft.reject?.title || ""} onChange={(v) => set({ reject: { ...draft.reject, title: v } })} placeholder="Obrigado pelo seu interesse!" />
            <LabeledInput label="Subtítulo" value={draft.reject?.subtitle || ""} onChange={(v) => set({ reject: { ...draft.reject, subtitle: v } })} placeholder="No momento não é um fit, mas agradecemos o contato." />
          </div>

          <div className="kicker" style={sectionTitle}>Saídas laterais</div>
          <div className="mono dim" style={{ fontSize: 11, marginBottom: 8, lineHeight: 1.5 }}>
            Pra quem <b>não é deste produto, mas também não é lixo</b> (ex.: ainda não vende em marketplace).
            A opção da pergunta aponta pra saída, a pessoa segue respondendo normalmente e o lead nasce
            na <b>coluna escolhida</b>, sem dono e <b>sem contar como conversão</b> (senão a Meta passa a
            trazer mais gente fora do perfil). Sem coluna, o contato só é registrado se ele chegou a ser pedido.
          </div>
          {Object.entries(draft.exits || {}).map(([k, ex]) => (
            <div key={k} style={{ ...cardStyle, marginBottom: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <span className="mono" style={{ fontSize: 11.5, color: "var(--fg-2)" }}>{k}</span>
                <button type="button" onClick={() => { const e = { ...draft.exits }; delete e[k]; set({ exits: e }); }}
                  className="mono dim" style={{ fontSize: 13, padding: "0 6px", marginLeft: "auto" }}>✕</button>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <LabeledInput label="Nome da saída" value={ex.label || ""} placeholder="Ainda não vende"
                  onChange={(v) => set({ exits: { ...draft.exits, [k]: { ...ex, label: v } } })} />
                <LabeledInput label="Coluna do pipeline" value={ex.stage || ""} placeholder="Mentoria"
                  onChange={(v) => set({ exits: { ...draft.exits, [k]: { ...ex, stage: v } } })} />
              </div>
              <LabeledInput label="Título da tela final" value={ex.title || ""}
                onChange={(v) => set({ exits: { ...draft.exits, [k]: { ...ex, title: v } } })} />
              <LabeledInput label="Subtítulo" value={ex.subtitle || ""}
                onChange={(v) => set({ exits: { ...draft.exits, [k]: { ...ex, subtitle: v } } })} />
            </div>
          ))}
          <button type="button" style={addBtnStyle}
            onClick={() => {
              const k = (prompt("Chave da saída (ex.: mentoria)") || "").trim().toLowerCase().replace(/[^a-z0-9_]/g, "");
              if (k) set({ exits: { ...(draft.exits || {}), [k]: { label: "", stage: "", title: "", subtitle: "" } } });
            }}>+ adicionar saída</button>

          <div className="kicker" style={{ ...sectionTitle, marginTop: 18 }}>Mapeamento → lead</div>
          <div className="mono dim" style={{ fontSize: 11, marginBottom: 8, lineHeight: 1.5 }}>
            Cada envio vira um lead no pipeline deste SaaS. Aponte qual pergunta alimenta cada campo do lead — as demais respostas vão juntas no lead.
          </div>
          <div style={{ ...cardStyle, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            {LEAD_FIELDS.map(([k, label]) => (
              <label key={k} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span className="kicker">{label}</span>
                <select value={draft.mapping?.[k] || ""} onChange={(e) => set({ mapping: { ...draft.mapping, [k]: e.target.value } })} style={inputStyle}>
                  <option value="">—</option>
                  {qKeys.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </label>
            ))}
          </div>

          <div className="kicker" style={sectionTitle}>Tema da marca</div>
          <ThemeEditor theme={draft.theme} onChange={(theme) => set({ theme })} />
        </fieldset>

      {/* coluna do preview */}
      <div className="forms-preview">
        <div style={{ padding: "10px 16px", borderBottom: "1px solid var(--line-1)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span className="kicker">Preview ao vivo</span>
          {isEdit && draft.status === "published" && (
            <a href={formUrl(draft)} target="_blank" rel="noreferrer" className="mono" style={{ fontSize: 11, color: "var(--accent)" }}>abrir página pública ↗</a>
          )}
        </div>
        {previewError && <div className="forms-error" role="alert">Não foi possível atualizar a prévia. <button onClick={()=>setPreviewAttempt(n=>n+1)}>Tentar novamente</button></div>}
        {previewLoading && <div className="forms-preview-status" role="status">Atualizando prévia…</div>}
        <iframe
          title="Preview do form"
          srcDoc={previewHtml}
          sandbox="allow-scripts allow-same-origin"
          style={{ flex: 1, border: 0, width: "100%", background: draft.theme.bg }}
        />
      </div>
      </div>
    </div>
  );
}

// Editor da lista de perguntas — espelha o QuestionsEditor do EntityForm, com os
// tipos extras (email/phone/textarea) e branching por opção ("pular para").
function QuestionsBuilder({ questions, onChange, exits }) {
  const update = (i, patch) => { const next = [...questions]; next[i] = { ...next[i], ...patch }; onChange(next); };
  const remove = (i) => onChange(questions.filter((_, j) => j !== i));
  const move = (i, dir) => {
    const j = i + dir;
    if (j < 0 || j >= questions.length) return;
    const next = [...questions];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  const updateOpt = (qi, oi, patch) => {
    const opts = [...(questions[qi].options || [])];
    opts[oi] = { ...opts[oi], ...patch };
    update(qi, { options: opts });
  };
  const arrowStyle = (disabled) => ({ fontSize: 12, padding: "0 3px", color: "var(--fg-3)", opacity: disabled ? 0.3 : 1, fontFamily: "var(--mono)", cursor: disabled ? "default" : "pointer" });

  // Destinos de branching: outra pergunta ou um dos fins. Exclui a própria pergunta.
  // "_reject" = fim de NÃO-qualificado (tela negativa, sem proposta/conversão).
  const jumpOptions = (selfKey) => [
    { value: "", label: "(próxima pergunta)" },
    ...questions.filter((q) => q.key && q.key !== selfKey).map((q) => ({ value: q.key, label: `→ ${q.label || q.key}` })),
    { value: "_end", label: "→ fim do form" },
    { value: "_reject", label: "→ fim (não qualificado)" },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {questions.map((q, i) => {
        const isInsight = q.type === "insight";
        const hasOptions = q.type === "select" || q.type === "multiselect";
        return (
          <div className="forms-question" key={i} style={cardStyle}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span className="mono dim tnum" style={{ fontSize: 11, width: 18 }}>{String(i + 1).padStart(2, "0")}</span>
              <input aria-label={`Pergunta ${i+1}`}
                value={q.label || ""} placeholder={isInsight ? "Título do insight (*palavra* destaca)" : "Pergunta"}
                onChange={(e) => {
                  const patch = { label: e.target.value };
                  if (!q._keyTouched && (q._keyAuto || !String(q.key || "").trim())) patch.key = slug(e.target.value);
                  update(i, patch);
                }}
                style={{ ...inputStyle, flex: 1 }}
              />
              <input aria-label={`Chave da pergunta ${i+1}`}
                value={q.key || ""} placeholder="chave" title="Chave da resposta (vira campo do lead)"
                onChange={(e) => update(i, { key: slug(e.target.value) || e.target.value, _keyTouched: true })}
                className="mono" style={{ ...inputStyle, width: 120, fontSize: 12 }}
              />
              <div style={{ display: "flex" }}>
                <button type="button" aria-label={`Mover pergunta ${i+1} para cima`} onClick={() => move(i, -1)} disabled={i === 0} style={arrowStyle(i === 0)}>↑</button>
                <button type="button" aria-label={`Mover pergunta ${i+1} para baixo`} onClick={() => move(i, 1)} disabled={i === questions.length - 1} style={arrowStyle(i === questions.length - 1)}>↓</button>
              </div>
              <button type="button" aria-label={`Remover pergunta ${i+1}`} onClick={() => remove(i)} className="mono dim" style={{ fontSize: 13, padding: "0 6px" }}>✕</button>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 10, paddingLeft: 24, flexWrap: "wrap" }}>
              <select aria-label={`Tipo da pergunta ${i+1}`} value={q.type || "text"} onChange={(e) => update(i, { type: e.target.value })} style={{ ...inputStyle, width: 180 }}>
                {QUESTION_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
              {!isInsight && (
                <label style={{ display: "inline-flex", gap: 5, alignItems: "center", fontSize: 12 }}>
                  <input type="checkbox" checked={!!q.required} onChange={(e) => update(i, { required: e.target.checked })} />
                  obrigatória
                </label>
              )}
              {!isInsight && i > 0 && (
                <label style={{ display: "inline-flex", gap: 5, alignItems: "center", fontSize: 12 }} title="Renderiza na mesma tela da pergunta anterior (ex.: nome + e-mail + telefone juntos)">
                  <input type="checkbox" checked={!!q.stack} onChange={(e) => update(i, { stack: e.target.checked })} />
                  mesma tela que a anterior
                </label>
              )}
              {!isInsight && !hasOptions && (
                <input value={q.placeholder || ""} placeholder="placeholder (opcional)" onChange={(e) => update(i, { placeholder: e.target.value })} style={{ ...inputStyle, flex: 1, minWidth: 140 }} />
              )}
            </div>

            {isInsight && (
              <div style={{ display: "flex", alignItems: "center", gap: 6, paddingLeft: 24 }}>
                <input value={q.stat || ""} placeholder="stat (ex.: +50%)" onChange={(e) => update(i, { stat: e.target.value })} className="mono" style={{ ...inputStyle, width: 120, fontSize: 12 }} />
                <input value={q.statLabel || ""} placeholder="legenda do stat (opcional)" onChange={(e) => update(i, { statLabel: e.target.value })} style={{ ...inputStyle, flex: 1 }} />
                <input type="number" value={q.durationMs ?? ""} placeholder="2400" title="Duração em ms antes de avançar" onChange={(e) => update(i, { durationMs: e.target.value === "" ? "" : Number(e.target.value) })} className="mono" style={{ ...inputStyle, width: 90, fontSize: 12 }} />
                <span className="mono dim" style={{ fontSize: 10 }}>ms</span>
              </div>
            )}

            <div style={{ paddingLeft: 24 }}>
              <input value={q.help || ""} placeholder="texto de apoio (opcional)" onChange={(e) => update(i, { help: e.target.value })} style={inputStyle} />
            </div>

            {hasOptions && (
              <div style={{ display: "flex", flexDirection: "column", gap: 4, paddingLeft: 24 }}>
                {(q.options || []).map((o, oi) => (
                  <div key={oi} style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    <input value={o.label || ""} placeholder="Rótulo" onChange={(e) => updateOpt(i, oi, { label: e.target.value, value: o._valTouched ? o.value : slug(e.target.value) })} style={{ ...inputStyle, flex: 1, minWidth: 120 }} />
                    <input value={o.value || ""} placeholder="valor" onChange={(e) => updateOpt(i, oi, { value: e.target.value, _valTouched: true })} className="mono" style={{ ...inputStyle, width: 110, fontSize: 12 }} />
                    {q.type === "select" && (
                      <select value={o.to || ""} title="Pular para…" onChange={(e) => updateOpt(i, oi, { to: e.target.value })} style={{ ...inputStyle, width: 170, fontSize: 12 }}>
                        {jumpOptions(q.key).map((j) => <option key={j.value} value={j.value}>{j.label}</option>)}
                      </select>
                    )}
                    {q.type === "select" && Object.keys(exits || {}).length > 0 && (
                      <select value={o.exit || ""} title="Sai por…" onChange={(e) => updateOpt(i, oi, { exit: e.target.value })} style={{ ...inputStyle, width: 160, fontSize: 12 }}>
                        <option value="">(fluxo de venda)</option>
                        {Object.entries(exits).map(([k, e]) => <option key={k} value={k}>↴ {e.label || k}</option>)}
                      </select>
                    )}
                    <button type="button" onClick={() => update(i, { options: (q.options || []).filter((_, j) => j !== oi) })} className="mono dim" style={{ fontSize: 13, padding: "0 6px" }}>✕</button>
                  </div>
                ))}
                <button type="button" onClick={() => update(i, { options: [...(q.options || []), { value: "", label: "" }] })} style={addBtnStyle}>+ opção</button>
              </div>
            )}

            <div style={{ display: "flex", alignItems: "center", gap: 8, paddingLeft: 24, flexWrap: "wrap" }}>
              <span className="mono dim" style={{ fontSize: 10, letterSpacing: "0.04em" }}>depois desta pergunta:</span>
              <select aria-label={`Destino da pergunta ${i+1}`} value={q.to || ""} onChange={(e) => update(i, { to: e.target.value })} style={{ ...inputStyle, width: 200, maxWidth: "100%", fontSize: 12 }}>
                {jumpOptions(q.key).map((j) => <option key={j.value} value={j.value}>{j.label}</option>)}
              </select>
            </div>
          </div>
        );
      })}
      <button type="button" onClick={() => onChange([...questions, { key: "", label: "", type: "text", required: false, options: [], _keyAuto: true }])} style={addBtnStyle}>+ adicionar pergunta</button>
    </div>
  );
}

// ── Respostas ───────────────────────────────────────────────────────────────

function SubmissionsView({ form, onBack, stat, statsLoading, statsError, retryStats, periodLabel, initialOpen }) {
  useData();
  const [subs,setSubs]=useState(null),[error,setError]=useState(null),[attempt,setAttempt]=useState(0);
  const [open,setOpen]=useState(initialOpen || null),[filter,setFilter]=useState("all");
  const labels=Object.fromEntries((form.questions || []).map(q=>[q.key,q.label]));
  useEffect(()=>{let alive=true;setError(null);api.list("form_submissions",{form:form.id}).then(rows=>{if(alive)setSubs(rows.slice().sort((a,b)=>String(b.createdAt||"").localeCompare(String(a.createdAt||""))));}).catch(e=>{if(alive)setError(e.message);});return()=>{alive=false;};},[form.id,attempt]);
  const leads=new Map((window.SEED?.LEADS || []).filter(l=>l.saas===form.saas).map(l=>[String(l.id),l]));
  const mapped=(s,field)=>s.answers?.[form.mapping?.[field]] || s.answers?.[field] || s.answers?.[{name:"nome",company:"empresa"}[field]] || "";
  const grade=s=>{const lead=leads.get(String(s.lead));return lead ? leadTier(lead)?.grade : null;};
  const recent=s=>{const age=Date.now()-new Date(s.createdAt).getTime();return age>=0 && age<=48*3600_000;};
  const filters=[["all","Todas",subs?.length || 0],["hot","Nível S e A",(subs || []).filter(s=>["S","A"].includes(grade(s))).length],["recent","Últimas 48h",(subs || []).filter(recent).length]];
  const rows=(subs || []).filter(s=>filter==="all" || (filter==="hot" ? ["S","A"].includes(grade(s)) : recent(s)));
  const date=iso=>iso ? new Date(iso).toLocaleString("pt-BR",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"}) : "—";
  return <div className="marketing-page forms-page forms-submissions">
    <header className="forms-head"><h1>{form.name || "Respostas"}</h1><button onClick={onBack}>← Formulários</button></header>
    <div className="forms-body">
      {statsLoading ? <div role="status">Carregando indicadores…</div> : statsError ? <div role="alert" className="forms-error">Não foi possível carregar os indicadores. <button onClick={retryStats}>Tentar novamente</button></div> : <section className="forms-response-kpis">{[
        ["Respostas",window.fmt.int(stat?.submits || 0),periodLabel],
        ["Conversão",stat?.views>0 ? `${((stat.submits || 0)/stat.views*100).toFixed(1).replace(".",",")}%` : "—","visita → envio"],
        ["Viraram cliente",window.fmt.int(stat?.won || 0),"envios do período"],
        ["Receita",window.fmt.moneyFull(stat?.revenue || 0),"receita fechada"],
      ].map(([label,value,note])=><div key={label}><span>{label}</span><strong>{value}</strong><small>{note}</small></div>)}</section>}
      <section className="forms-responses-card">
        <div className="forms-response-filters"><div>{filters.map(([id,label,count])=><button key={id} aria-pressed={filter===id} onClick={()=>setFilter(id)}>{label} <span>{count}</span></button>)}</div><span>Histórico completo · nível atual do lead</span></div>
        {error && <div role="alert" className="forms-error">Não foi possível carregar as respostas. <button onClick={()=>setAttempt(n=>n+1)}>Tentar novamente</button></div>}
        {!subs && !error && <div role="status" className="forms-response-empty">Carregando respostas…</div>}
        <div className="tbl-x"><div className="forms-response-table">
          <div className="forms-response-row forms-response-labels"><span>Quem respondeu</span><span>Empresa</span><span>Contas</span><span>Nível</span><span>Variante</span><span>Enviado</span></div>
          {rows.map(s=>{const level=grade(s),lead=leads.get(String(s.lead));return <React.Fragment key={s.id}>
            <div className="forms-response-row"><button aria-expanded={open===s.id} onClick={()=>setOpen(open===s.id ? null : s.id)}><strong>{mapped(s,"name") || Object.values(s.answers || {})[0] || "Sem nome"}</strong><small>{mapped(s,"email") || mapped(s,"phone") || "—"}</small></button><span>{mapped(s,"company") || "—"}</span><span className="tnum">{lead?.accounts || s.answers?.accounts || "—"}</span><span title="Classificação atual do lead vinculado" style={{color:level ? GRADE_STYLE[level]?.ink : "var(--fg-3)",fontWeight:700}}>{level || "—"}</span><span>{[s.variant,s.pain && `[${s.pain}]`].filter(Boolean).join(" · ") || "—"}</span><time>{date(s.createdAt)}</time></div>
            {open===s.id && <div className="forms-response-detail">{Object.entries(s.answers || {}).map(([k,v])=><div key={k}><span>{labels[k] || k}: </span>{Array.isArray(v) ? v.join(", ") : String(v)}</div>)}{s.lead && <small>Lead vinculado: {s.lead}</small>}</div>}
          </React.Fragment>;})}
        </div></div>
        {subs && !rows.length && !error && <div className="forms-response-empty">{subs.length ? "Nenhuma resposta com este filtro." : "Nenhuma resposta ainda. Publique o formulário e compartilhe o link para começar."}</div>}
      </section>
    </div>
  </div>;
}

// ── Welcome por DOR (anúncio → headline) ─────────────────────────────────────
// A página /f/:id resolve a dor do anúncio de origem (utm_content → nome →
// "[X]") e mostra a welcome daquela dor — consistência anúncio → página sem
// duplicar o form. Cada dor pode ter o próprio teste A/B (ids das variantes
// ganham o prefixo da dor pra não colidir no funil).
function PainWelcomesEditor({ welcome, saas, onChange }) {
  const painMap = ((window.SEED?.SAAS || []).find((x) => x.id === saas) || {}).painMap || {};
  const codes = Object.keys(painMap);
  if (!codes.length) return null;
  const byPain = welcome.byPain || {};
  const setPain = (code, patch) => onChange({ ...welcome, byPain: { ...byPain, [code]: { ...(byPain[code] || {}), ...patch } } });
  const removePain = (code) => {
    const next = { ...byPain };
    delete next[code];
    onChange({ ...welcome, ...(Object.keys(next).length ? { byPain: next } : { byPain: undefined }) });
  };
  return (
    <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px dashed var(--line-2)" }}>
      <div className="kicker" style={{ marginBottom: 6 }}>
        Headline por dor (anúncio → página)
      </div>
      <div className="mono dim" style={{ fontSize: 11, lineHeight: 1.5, marginBottom: 8 }}>
        Quem chega por um anúncio com código de dor vê a welcome daquela dor (campo vazio herda a base). Sem dor resolvida, vale a base acima.
      </div>
      {codes.map((code) => {
        const pw = byPain[code];
        if (!pw) {
          return (
            <button key={code} onClick={() => setPain(code, { title: "", subtitle: "", button: "" })} style={{ ...addBtnStyle, marginBottom: 6 }}>
              + headline pra dor [{code}] · {painMap[code]}
            </button>
          );
        }
        return (
          <div key={code} style={{ border: "1px solid var(--line-1)", borderRadius: "var(--r-2)", padding: 10, marginBottom: 8, background: "var(--bg-inset)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <span className="mono code" style={{ fontSize: 11, fontWeight: 700, color: "var(--accent)", border: "1px solid var(--accent-line)", borderRadius: 5, padding: "1px 7px" }}>[{code}]</span>
              <span style={{ fontSize: 12, color: "var(--fg-3)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{painMap[code]}</span>
              <button onClick={() => removePain(code)} className="mono dim" style={{ fontSize: 12 }}>✕</button>
            </div>
            <LabeledInput label="Título" value={pw.title || ""} onChange={(x) => setPain(code, { title: x })} placeholder="vazio = herda o título base" />
            <LabeledInput label="Subtítulo" value={pw.subtitle || ""} onChange={(x) => setPain(code, { subtitle: x })} placeholder="vazio = herda" />
            <LabeledInput label="Texto do botão (CTA)" value={pw.button || ""} onChange={(x) => setPain(code, { button: x })} placeholder="vazio = herda" />
            <VariantsEditor welcome={pw} idPrefix={code + "-"} onChange={(w) => setPain(code, w)} />
          </div>
        );
      })}
    </div>
  );
}

// ── Teste A/B da tela de boas-vindas ─────────────────────────────────────────
// Cada variante sobrescreve título/subtítulo/botão da welcome base (campo vazio
// herda). A página sorteia por navegador (sticky) e carimba a variante nos
// eventos do funil e no lead (formVariant) — o funil compara as versões.
function VariantsEditor({ welcome, onChange, idPrefix = "" }) {
  const variants = welcome.variants || [];
  const setV = (i, patch) => onChange({ ...welcome, variants: variants.map((v, j) => (j === i ? { ...v, ...patch } : v)) });
  const add = () => {
    // Numeração B-001, B-002… monotônica (variantSeq nunca decresce): id de
    // variante NUNCA se repete entre rodadas — o histórico do funil não mistura
    // copies diferentes na mesma linha.
    const seq = (Number(welcome.variantSeq) || 0) + 1;
    const id = `${idPrefix}${String(seq).padStart(3, "0")}`;
    onChange({ ...welcome, variantSeq: seq, variants: [...variants, { id, title: "", subtitle: "", button: "" }] });
  };
  const remove = (i) => {
    const next = variants.filter((_, j) => j !== i);
    onChange({ ...welcome, ...(next.length ? { variants: next } : { variants: undefined }) });
  };
  return (
    <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px dashed var(--line-2)" }}>
      <div className="kicker" style={{ marginBottom: 6 }}>
        Teste A/B da headline {variants.length > 0 && `· ${variants.length} variante${variants.length > 1 ? "s" : ""} ativas`}
      </div>
      {variants.length === 0 && (
        <div className="mono dim" style={{ fontSize: 11, lineHeight: 1.5, marginBottom: 8 }}>
          Com 2+ variantes, cada visitante vê UMA versão (sorteio fixo por navegador) e o funil compara view → começar → envio por versão. Campo vazio herda o da welcome acima.
        </div>
      )}
      {variants.map((v, i) => (
        <div key={i} style={{ border: "1px solid var(--line-1)", borderRadius: "var(--r-2)", padding: 10, marginBottom: 8, background: "var(--bg-inset)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <span className="mono code" style={{ fontSize: 11, fontWeight: 700, color: "var(--accent)", border: "1px solid var(--accent-line)", borderRadius: 5, padding: "1px 7px" }}>{v.id}</span>
            <span style={{ flex: 1 }} />
            <button onClick={() => remove(i)} className="mono dim" style={{ fontSize: 12 }}>✕</button>
          </div>
          <LabeledInput label="Título" value={v.title || ""} onChange={(x) => setV(i, { title: x })} placeholder="vazio = herda o título base" />
          <LabeledInput label="Subtítulo" value={v.subtitle || ""} onChange={(x) => setV(i, { subtitle: x })} placeholder="vazio = herda" />
          <LabeledInput label="Texto do botão (CTA)" value={v.button || ""} onChange={(x) => setV(i, { button: x })} placeholder="vazio = herda" />
        </div>
      ))}
      <button onClick={add} style={addBtnStyle}>+ variante {idPrefix + String((Number(welcome.variantSeq) || 0) + 1).padStart(3, "0")}</button>
    </div>
  );
}

// ── Regras do campeão do teste A/B ───────────────────────────────────────────
// Elegibilidade: ≥100 visitas E ≥7 dias corridos na variante líder. Decisão:
// líder pela % de começar com ≥95% de confiança (z de duas proporções vs. a
// vice) e SEM regressão de envio (% envio ≥ 70% da vice, quando a vice tem
// amostra). Ganhos desempatam e vetam: campeã de clique que não fecha, não é
// campeã. Comparação sempre DENTRO da mesma dor (ou da base).
const MIN_VIEWS = 100;
const MIN_DAYS = 7;
function normCdf(z) {
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const erf = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  const pos = 0.5 * (1 + erf);
  return z >= 0 ? pos : 1 - pos;
}
function championVerdicts(variants) {
  const out = {}; // `${pain}|${id}` -> { label, tone }
  const groups = {};
  for (const v of variants) (groups[v.pain || ""] = groups[v.pain || ""] || []).push(v);
  for (const pain of Object.keys(groups)) {
    const g = groups[pain].filter((v) => v.views > 0).sort((a, b) => b.starts / b.views - a.starts / a.views);
    const key = (v) => `${v.pain || ""}|${v.id}`;
    if (g.length === 0) continue;
    if (g.length === 1) { out[key(g[0])] = { label: "sem rival", tone: "var(--fg-4)" }; continue; }
    const [top, second] = g;
    const days = top.firstAt ? Math.max(1, Math.ceil((Date.now() - new Date(top.firstAt).getTime()) / 86400e3)) : 0;
    for (const v of g.slice(1)) out[key(v)] = { label: "", tone: "var(--fg-4)" };
    if (top.views < MIN_VIEWS || days < MIN_DAYS) {
      out[key(top)] = { label: `coletando · ${top.views}/${MIN_VIEWS} visitas · ${Math.min(days, MIN_DAYS)}/${MIN_DAYS}d`, tone: "var(--warn)" };
      continue;
    }
    const p1 = top.starts / top.views;
    const p2 = second.starts / second.views;
    const pool = (top.starts + second.starts) / (top.views + second.views);
    const se = Math.sqrt(pool * (1 - pool) * (1 / top.views + 1 / second.views));
    const conf = se > 0 ? normCdf((p1 - p2) / se) : 0.5;
    const subTop = top.submits / top.views;
    const subSecond = second.views > 0 ? second.submits / second.views : 0;
    const submitWorse = second.views >= 50 && subSecond > 0 && subTop < 0.7 * subSecond;
    const wonWorse = second.won > top.won; // fechou menos contrato que a vice
    if (conf >= 0.95 && !submitWorse && !wonWorse) out[key(top)] = { label: "campeã ✓ promova pro texto base", tone: "var(--pos)" };
    else if (conf >= 0.95 && (submitWorse || wonWorse)) out[key(top)] = { label: submitWorse ? "ganha clique, perde envio ⚠" : "ganha clique, fecha menos ⚠", tone: "var(--neg)" };
    else out[key(top)] = { label: `líder · ${Math.round(conf * 100)}% de confiança`, tone: "var(--fg-3)" };
  }
  return out;
}

// Rótulo do ANÚNCIO de uma origem: utm_content (ad id) resolvido pra nome pelo
// catálogo; sem content, cai no nome da campanha; orgânico (só source, derivado
// do referrer) mostra "(orgânico)".
function originAdLabel(o, cat) {
  if (o.content) return cat?.ads?.[o.content]?.name || o.content;
  if (o.campaign) return cat?.campaigns?.[o.campaign]?.name || o.campaign;
  return "(orgânico)";
}

// ── Insights do funil do form ────────────────────────────────────────────────
// Mesma filosofia do card da Publicidade (regras explicáveis, cada uma com os
// números do porquê); render/dispensa no components/insights.jsx. Ids estáveis
// por regra+alvo. Volumes mínimos evitam insight de amostra pequena.
function buildFormInsights(data, form, cat) {
  if (!data || data.error) return [];
  const out = [];
  const pctN = (a, b) => (b > 0 ? Math.round((a / b) * 100) : 0);

  // Welcome segurando pouca gente: poucas visitas viram "começar".
  if (data.views >= 30 && form.welcome) {
    const startRate = pctN(data.starts, data.views);
    if (startRate < 40) {
      out.push({ id: "welcome-starts", meta: { kind: "newHeadline", startRate }, tone: "atencao", tag: "Atenção", text: `Só ${startRate}% das ${data.views} visitas clicam em começar. A headline/promessa da boas-vindas é o primeiro suspeito, vale rodar uma variante nova no teste A/B.` });
    }
  }
  // Etapa que mais derruba: maior queda relativa entre telas consecutivas.
  const steps = (data.steps || []).filter((s) => !s.insight);
  const chain = [{ key: "_start", label: "começar", sessions: data.starts }, ...steps];
  let worst = null;
  for (let i = 1; i < chain.length; i++) {
    const prev = chain[i - 1].sessions;
    if (prev < 15) continue; // amostra pequena não vira insight
    const drop = 1 - chain[i].sessions / prev;
    if (drop >= 0.25 && (!worst || drop > worst.drop)) worst = { step: chain[i], prev, drop };
  }
  if (worst) {
    out.push({ id: `drop-step:${worst.step.key}`, meta: { kind: "makeOptional", key: worst.step.key }, tone: "cortar", tag: "Revisar", text: `A pergunta “${worst.step.label}” derruba ${Math.round(worst.drop * 100)}% de quem chega nela (${worst.prev} → ${worst.step.sessions} sessões). Simplifique a pergunta, torne opcional ou mova pra mais perto do fim.` });
  }
  // Origens: taxa de envio muito abaixo/acima da média do form.
  const origins = (data.origins || []).filter((o) => o.views >= 15);
  if (origins.length >= 2 && data.views > 0) {
    const rate = (o) => (o.views > 0 ? o.submits / o.views : 0);
    const overall = data.submits / data.views;
    const name = (o) => `${sourceLabel(o) || "(sem source)"}${o.content || o.campaign ? ` · ${originAdLabel(o, cat)}` : ""}`;
    const sorted = [...origins].sort((a, b) => rate(a) - rate(b));
    const weak = sorted[0];
    const best = sorted[sorted.length - 1];
    if (overall > 0 && rate(weak) < overall / 2) {
      out.push({ id: `origin-weak:${weak.source || ""}|${weak.content || weak.campaign || ""}`, meta: { kind: "pauseCampaign", campaign: weak.campaign || "" }, tone: "atencao", tag: "Atenção", text: `A origem ${name(weak)} converte ${pctN(weak.submits, weak.views)}% das visitas em envio, menos da metade da média do form (${Math.round(overall * 100)}%). O público desse tráfego pode não casar com a promessa ou com as perguntas.` });
    }
    if (best !== weak && rate(best) >= overall * 1.5) {
      out.push({ id: `origin-best:${best.source || ""}|${best.content || best.campaign || ""}`, meta: { kind: "raiseCampaignBudget", campaign: best.campaign || "" }, tone: "escalar", tag: "Escalar", text: `${name(best)} converte ${pctN(best.submits, best.views)}% das visitas em envio (média do form: ${Math.round(overall * 100)}%). Tráfego com esse perfil rende mais form completo — vale priorizar.` });
    }
  }
  return out.slice(0, 5);
}

// Ação executável dos insights do form (botão "aplicar" + confirmação), na
// mesma regra da Publicidade: só quando a plataforma consegue fazer sozinha e
// com segurança. Pergunta que derruba → tornar opcional (edição do próprio
// form); origem fraca/campeã → pausar campanha / subir orçamento na Meta, e
// nesses casos a campanha precisa estar VIVA (effectiveStatus ACTIVE na
// listagem da conta) — sem listagem (sem permissão de metrics, Meta fora) ou
// com campanha parada, o insight fica só informativo.
const moneyBRL = (v) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(v) || 0);
function withFormInsightAction(it, { form, adObjects }) {
  const m = it.meta;
  if (!m) return it;
  if (m.kind === "newHeadline") {
    // A IA escreve a variante; os campos chegam EDITÁVEIS no popup (regra do
    // Leo pra ação de texto) e o confirmar publica como variante nova do A/B,
    // com o id monotônico do builder (variantSeq nunca repete entre rodadas).
    return {
      ...it,
      action: {
        label: "Criar variante de headline (IA)",
        prepare: async () => {
          const s = await api.suggestWelcome(form.id, { startRate: m.startRate });
          return [
            { key: "title", label: "Título", value: s.title || "" },
            { key: "subtitle", label: "Subtítulo", value: s.subtitle || "", multiline: true, optional: true },
            { key: "button", label: "Botão", value: s.button || "" },
          ];
        },
        steps: [
          "Ajuste os textos acima se quiser (o que estiver nos campos é o que vai pro ar).",
          `Confirmar publica a copy como VARIANTE NOVA do teste A/B da welcome do form “${form.name || form.id}”: a versão atual continua no ar e o sorteio por visitante decide quem vê qual.`,
          "O funil passa a comparar as duas versões; a campeã você promove no builder, como sempre.",
        ],
        execute: (v) => {
          const w = form.welcome || {};
          const seq = (Number(w.variantSeq) || 0) + 1;
          const variant = { id: String(seq).padStart(3, "0"), title: v.title, subtitle: v.subtitle || "", button: v.button };
          return api.update("forms", form.id, { welcome: { ...w, variantSeq: seq, variants: [...(w.variants || []), variant] } });
        },
      },
    };
  }
  if (m.kind === "makeOptional") {
    const q = (form.questions || []).find((x) => x.key === m.key);
    if (!q || !q.required) return it; // já é opcional (ou saiu do form)
    return {
      ...it,
      action: {
        label: "Tornar a pergunta opcional",
        steps: [
          `Marcar a pergunta “${q.label || q.key}” do form “${form.name || form.id}” como opcional — quem não quiser responder consegue avançar.`,
          "A mudança vale na hora na página pública do form.",
        ],
        execute: () => api.update("forms", form.id, { questions: (form.questions || []).map((x) => (x.key === m.key ? { ...x, required: false } : x)) }),
      },
    };
  }
  const live = (adObjects?.campaigns || []).find((c) => String(c.id) === String(m.campaign) || (c.name && c.name === m.campaign));
  const active = live && (live.effectiveStatus || live.status) === "ACTIVE";
  if (m.kind === "pauseCampaign" && active) {
    return {
      ...it,
      action: {
        label: "Pausar campanha",
        steps: [`Pausar a campanha “${live.name}” na Meta — todos os conjuntos e anúncios dela param de veicular na hora; dá pra reativar na tela Publicidade.`],
        execute: () => api.metaObjectStatus(live.id, "PAUSED"),
      },
    };
  }
  if (m.kind === "raiseCampaignBudget" && active) {
    const bump = (v) => Math.ceil(v * 1.2);
    if (live.dailyBudget > 0) {
      return {
        ...it,
        action: {
          label: "Subir orçamento (+20%)",
          steps: [`Campanha “${live.name}” (orçamento na campanha): diário ${moneyBRL(live.dailyBudget)} → ${moneyBRL(bump(live.dailyBudget))} (+20%), aplicado direto no Gerenciador da Meta.`],
          execute: () => api.metaObjectBudget(live.id, bump(live.dailyBudget)),
        },
      };
    }
    const targets = (adObjects?.adsets || []).filter((s) => String(s.campaignId) === String(live.id) && s.dailyBudget > 0 && s.status !== "PAUSED");
    if (!targets.length) return it;
    return {
      ...it,
      action: {
        label: "Subir orçamento (+20%)",
        steps: targets.map((s) => `Conjunto “${s.name}”: orçamento diário ${moneyBRL(s.dailyBudget)} → ${moneyBRL(bump(s.dailyBudget))} (+20%), aplicado direto no Gerenciador da Meta.`),
        execute: async () => { for (const s of targets) await api.metaObjectBudget(s.id, bump(s.dailyBudget)); },
      },
    };
  }
  return it;
}

// ── Dashboard de métricas (visão principal da tela) ─────────────────────────
// Seletor de form (quando há mais de um publicado), filtros completos (hoje/
// ontem/3/7/30/tudo + data personalizada), tiles do topo, RESULTADOS DOS
// TESTES A/B agrupados por dor (veredito de campeã por grupo) e o funil de
// drop-off. A lista de forms fica logo abaixo, só gestão.
const DASH_PRESETS = PERIOD_PRESETS;

function FormsDashboard({ forms }) {
  const [formId, setFormId] = useState(forms[0]?.id);
  const form = forms.find((f) => f.id === formId) || forms[0];
  const [preset, setPreset] = useState("30"); // chave em PERIOD_PRESETS ou "custom"
  const [custom, setCustom] = useState({ since: "", until: "" });
  const [data, setData] = useState(null);

  const range = periodRange(preset, custom);

  useEffect(() => {
    if (!form) return;
    setData(null);
    api.formFunnel(form.id, range).then(setData).catch(() => setData({ error: true }));
  }, [form?.id, range.since, range.until]); // eslint-disable-line react-hooks/exhaustive-deps

  // Campanha nos eventos chega como id dinâmico da Meta — resolve pra nome.
  const cat = useAttribution(form?.saas, !!(data && !data.error && data.origins?.length));

  // Estado VIVO da conta de anúncios (mesma listagem do card Anúncios da
  // Publicidade): valida se a campanha de um insight de origem ainda veicula
  // antes de oferecer o "aplicar" e dá nome/orçamento pros passos do popup.
  // Falha (sem permissão de metrics, Meta fora) só tira os botões de ação.
  const [adObjects, setAdObjects] = useState(null);
  const saasProd = (window.SEED?.SAAS || []).find((x) => x.id === form?.saas);
  const wantAds = !!(saasProd?.metaAdAccount && data && !data.error && (data.origins || []).length);
  const fetchAdObjects = () => api.adObjects(form.saas).then((v) => { if (!v?.error) setAdObjects(v); }).catch(() => { /* insights ficam informativos */ });
  useEffect(() => { setAdObjects(null); }, [form?.saas]);
  useEffect(() => { if (wantAds) fetchAdObjects(); }, [wantAds, form?.saas]); // eslint-disable-line react-hooks/exhaustive-deps

  const formInsights = (data && !data.error ? buildFormInsights(data, form, cat) : [])
    .map((it) => withFormInsightAction(it, { form, adObjects }));

  if (!form) return null;
  const painMap = ((window.SEED?.SAAS || []).find((x) => x.id === form.saas) || {}).painMap || {};
  const rows = data && !data.error ? [
    { label: "Abriu a página", sessions: data.views, mono: true },
    ...(form.welcome ? [{ label: "Clicou em começar", sessions: data.starts, mono: true }] : []),
    ...(data.steps || []).map((st, i) => ({ label: st.label, sessions: st.sessions, insight: st.insight, n: i + 1 })),
    { label: "Enviou o form", sessions: data.submits, mono: true },
  ] : [];
  const top = rows.length ? Math.max(rows[0].sessions, 1) : 1;
  const pct = (a, b) => (b > 0 ? ((a / b) * 100).toFixed(1).replace(".", ",") + "%" : "0%");
  const tile = (label, value, sub) => (
    <div style={{ border: "1px solid var(--line-1)", borderRadius: "var(--r-2)", padding: "10px 13px", background: "var(--bg-1)" }}>
      <span className="kicker" style={{ display: "block" }}>{label}</span>
      <span className="tnum" style={{ display: "block", fontFamily: "var(--display)", fontSize: 22, fontWeight: 700, marginTop: 2 }}>{value}</span>
      {sub && <span className="mono" style={{ display: "block", fontSize: 10, color: "var(--fg-4)", marginTop: 1 }}>{sub}</span>}
    </div>
  );
  const dateInput = (key) => (
    <input type="date" value={custom[key]}
      onChange={(e) => { setCustom((c) => ({ ...c, [key]: e.target.value })); setPreset("custom"); }}
      style={{ height: 24, padding: "0 6px", borderRadius: 999, fontSize: 10.5, fontFamily: "var(--mono)",
        border: "1px solid " + (preset === "custom" ? "var(--accent-line)" : "var(--line-1)"),
        background: "var(--bg-1)", color: "var(--fg-1)" }} />
  );

  // Testes A/B agrupados por dor (base primeiro) — visão completa por grupo.
  const variants = data && !data.error ? (data.variants || []) : [];
  const verdicts = championVerdicts(variants);
  const groups = [];
  for (const v of variants) {
    const key = v.pain || "";
    let g = groups.find((x) => x.pain === key);
    if (!g) { g = { pain: key, rows: [] }; groups.push(g); }
    g.rows.push(v);
  }
  groups.sort((a, b) => (a.pain === "" ? -1 : b.pain === "" ? 1 : a.pain.localeCompare(b.pain)));
  const vDefs = [
    ...(form.welcome?.variants || []),
    ...Object.values(form.welcome?.byPain || {}).flatMap((pn) => pn.variants || []),
  ];
  const titleOf = (v) => vDefs.find((d) => String(d.id) === String(v.id))?.title
    || form.welcome?.byPain?.[v.pain]?.title || form.welcome?.title || v.id;
  const thAB = (h, i) => (
    <th key={h + i} className="kicker" style={{ textAlign: i < 2 ? "left" : "right", padding: "6px 8px", borderBottom: "1px solid var(--line-1)" }}>{h}</th>
  );
  const tdAB = { padding: "7px 8px", fontSize: 12, textAlign: "right", borderBottom: "1px solid var(--line-1)" };

  return (
    <div style={{ border: "1px solid var(--line-1)", borderRadius: "var(--r-3)", background: "var(--bg-1)", padding: "14px 16px 16px", marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        {forms.length > 1 ? (
          <select value={form.id} onChange={(e) => setFormId(e.target.value)}
            style={{ height: 26, padding: "0 8px", borderRadius: 999, border: "1px solid var(--line-1)", background: "var(--bg-1)", color: "var(--fg-1)", fontSize: 12.5, fontWeight: 600 }}>
            {forms.map((f) => <option key={f.id} value={f.id}>{f.name || f.id}</option>)}
          </select>
        ) : (
          <span style={{ fontSize: 14, fontWeight: 600 }}>{form.name}</span>
        )}
        <span className="mono dim" style={{ fontSize: 10.5 }}>métricas · testes A/B · funil</span>
        <span style={{ flex: 1 }} />
        {DASH_PRESETS.map(([v, label]) => (
          <button key={v || "all"} onClick={() => setPreset(v)} className="mono" style={{
            height: 24, padding: "0 10px", borderRadius: 999, fontSize: 11,
            border: "1px solid " + (preset === v ? "var(--line-strong)" : "var(--line-1)"),
            background: preset === v ? "var(--bg-3)" : "var(--bg-2)",
            color: preset === v ? "var(--fg-1)" : "var(--fg-3)",
          }}>{label}</button>
        ))}
        {dateInput("since")}
        <span className="mono dim" style={{ fontSize: 10 }}>até</span>
        {dateInput("until")}
      </div>

      {!data && <div className="mono dim" style={{ fontSize: 12 }}>carregando…</div>}
      {data?.error && <div className="mono" style={{ fontSize: 12, color: "var(--neg)" }}>Falha ao carregar as métricas.</div>}

      {data && !data.error && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 8, marginBottom: 14 }}>
          {tile("Visitas", window.fmt.int(data.views))}
          {tile("Começaram", window.fmt.int(data.starts), pct(data.starts, data.views) + " das visitas")}
          {tile("Enviaram", window.fmt.int(data.submits), pct(data.submits, Math.max(data.starts, 1)) + " dos que começaram")}
          {tile("Conversão", pct(data.submits, data.views), "envios ÷ visitas")}
        </div>
      )}

      {data && !data.error && (
        <InsightsList items={formInsights} scope={`form:${form.id}`}
          style={{ marginBottom: 14 }}
          onApplied={() => { if (wantAds) fetchAdObjects(); }}
          header={
            <div className="kicker" style={{ marginBottom: 8 }}>
              Insights do funil · aplicar mostra os passos e pede confirmação · ✕ dispensa por 7 dias
            </div>
          } />
      )}

      {data && !data.error && groups.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <div className="kicker" style={{ marginBottom: 8 }}>
            Resultados dos testes A/B · por dor
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {groups.map((g) => {
              const leader = g.rows.map((v) => verdicts[`${v.pain || ""}|${v.id}`]).find((x) => x?.label);
              return (
                <div key={g.pain || "base"} style={{ border: "1px solid var(--line-1)", borderRadius: "var(--r-2)", background: "var(--bg-inset)", padding: "10px 12px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
                    <span className="mono code" style={{ fontSize: 11, fontWeight: 700, color: "var(--accent)", border: "1px solid var(--accent-line)", borderRadius: 5, padding: "1px 7px" }}>
                      {g.pain ? `[${g.pain}]` : "BASE"}
                    </span>
                    <span style={{ fontSize: 12.5, fontWeight: 600 }}>{g.pain ? (painMap[g.pain] || "dor " + g.pain) : "Sem dor identificada (tráfego direto)"}</span>
                    <span style={{ flex: 1 }} />
                    {leader && <span className="mono" style={{ fontSize: 10.5, fontWeight: 600, color: leader.tone }}>{leader.label}</span>}
                  </div>
                  <div className="tbl-x">
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                      <thead><tr>{["Variante", "Título mostrado", "Visitas", "Começou", "% começar", "Enviou", "% envio", "A", "B", "C", "Call", "Ganhos", "% fechou", "Receita"].map(thAB)}</tr></thead>
                      <tbody>
                        {g.rows.map((v) => {
                          const verdict = verdicts[`${v.pain || ""}|${v.id}`];
                          const isLeader = !!verdict?.label;
                          const gr = v.grades || {};
                          return (
                            <tr key={v.id}>
                              <td className="mono code" style={{ ...tdAB, textAlign: "left", fontWeight: 700, color: isLeader ? "var(--fg-1)" : "var(--fg-2)" }}>{v.id}</td>
                              <td style={{ ...tdAB, textAlign: "left", maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--fg-2)" }} title={titleOf(v)}>{titleOf(v)}</td>
                              <td className="mono tnum" style={tdAB}>{v.views}</td>
                              <td className="mono tnum" style={tdAB}>{v.starts}</td>
                              <td className="mono tnum" style={{ ...tdAB, fontWeight: 600 }}>{v.views > 0 ? pct(v.starts, v.views) : ""}</td>
                              <td className="mono tnum" style={tdAB}>{v.submits}</td>
                              <td className="mono tnum" style={tdAB}>{v.views > 0 ? pct(v.submits, v.views) : ""}</td>
                              <td className="mono tnum" style={{ ...tdAB, fontWeight: 700, color: gr.A ? GRADE_STYLE.A.ink : "var(--fg-4)" }}>{gr.A || 0}</td>
                              <td className="mono tnum" style={{ ...tdAB, fontWeight: 700, color: gr.B ? GRADE_STYLE.B.ink : "var(--fg-4)" }}>{gr.B || 0}</td>
                              <td className="mono tnum" style={{ ...tdAB, fontWeight: 700, color: gr.C ? GRADE_STYLE.C.ink : "var(--fg-4)" }}>{gr.C || 0}</td>
                              <td className="mono tnum" style={tdAB}>{v.calls || 0}</td>
                              <td className="mono tnum" style={tdAB}>{v.won || 0}</td>
                              <td className="mono tnum" style={tdAB}>{v.leads > 0 ? pct(v.won, v.leads) : ""}</td>
                              <td className="mono tnum" style={tdAB}>{v.revenue ? window.fmt.money(v.revenue) : "—"}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mono dim" style={{ fontSize: 10.5, marginTop: 6, lineHeight: 1.6 }}>
            regras da campeã: ≥100 visitas e ≥7 dias na líder · ≥95% de confiança na % de começar vs. a vice (z de 2 proporções) · sem regressão de envio nem de ganhos. Campeã eleita: promova a copy pro texto base e remova as variantes; teste novo = variante nova (numeração nunca repete).
          </div>
        </div>
      )}

      {data && !data.error && (data.origins || []).length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <div className="kicker" style={{ marginBottom: 8 }}>
            Origens do tráfego · drop-off por anúncio (orgânico entra pelo referrer: google, instagram, site)
          </div>
          <div className="tbl-x" style={{ border: "1px solid var(--line-1)", borderRadius: "var(--r-2)", background: "var(--bg-inset)", padding: "4px 12px 8px" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr>{["Origem", "Anúncio", "Visitas", "Começou", "% começar", "Enviou", "% envio"].map(thAB)}</tr></thead>
              <tbody>
                {data.origins.map((o, i) => (
                  <tr key={i}>
                    <td className="mono" style={{ ...tdAB, textAlign: "left", fontWeight: 600 }}>{sourceLabel(o) || "(sem source)"}</td>
                    <td style={{ ...tdAB, textAlign: "left", maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--fg-2)" }} title={originAdLabel(o, cat)}>
                      {originAdLabel(o, cat)}
                    </td>
                    <td className="mono tnum" style={tdAB}>{o.views}</td>
                    <td className="mono tnum" style={tdAB}>{o.starts}</td>
                    <td className="mono tnum" style={{ ...tdAB, fontWeight: 600 }}>{o.views > 0 ? pct(o.starts, o.views) : ""}</td>
                    <td className="mono tnum" style={tdAB}>{o.submits}</td>
                    <td className="mono tnum" style={tdAB}>{o.views > 0 ? pct(o.submits, o.views) : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {data && !data.error && rows[0].sessions > 0 && (
        <div>
          <div className="kicker" style={{ marginBottom: 8 }}>
            Funil de drop-off por etapa
          </div>
          <div className="tbl-x" style={{ border: "1px solid var(--line-1)", borderRadius: "var(--r-2)", background: "var(--bg-inset)" }}>
            {rows.map((r, i) => {
              const prev = i > 0 ? rows[i - 1].sessions : null;
              const drop = prev > 0 ? Math.round((1 - r.sessions / prev) * 100) : 0;
              return (
                <div key={i} style={{ display: "grid", gridTemplateColumns: "220px 1fr 60px 70px", gap: 12, alignItems: "center", padding: "9px 12px", borderBottom: "1px solid var(--line-1)", opacity: r.insight ? 0.6 : 1 }}>
                  <span className={r.mono ? "mono dim" : ""} style={{ fontSize: 12.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.label}>
                    {r.n ? `${String(r.n).padStart(2, "0")} · ` : ""}{r.label}{r.insight ? " (insight)" : ""}
                  </span>
                  <div style={{ height: 8, background: "var(--bg-1)", borderRadius: 999, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${Math.round((r.sessions / top) * 100)}%`, background: "var(--accent)", borderRadius: 999 }} />
                  </div>
                  <span className="mono tnum" style={{ fontSize: 12, textAlign: "right" }}>{r.sessions}</span>
                  <span className="mono tnum" style={{ fontSize: 11, textAlign: "right", color: drop > 0 ? "var(--neg)" : "var(--fg-4)" }}>
                    {prev != null && prev > 0 ? `-${Math.max(drop, 0)}%` : ""}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
      {data && !data.error && rows.length > 0 && !rows[0].sessions && (
        <div className="mono dim" style={{ fontSize: 12 }}>Nenhum evento no período selecionado.</div>
      )}
    </div>
  );
}

export { FormsScreen };
