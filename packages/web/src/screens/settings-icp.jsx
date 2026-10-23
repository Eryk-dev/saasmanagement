import React from "react";
import { api } from "../lib/api.js";
import { useData } from "../data.jsx";
import { GRADE_STYLE, chromeBtnStyleSmall } from "../lib/ui.js";
import { canEditIcpUser, userById } from "../lib/users.js";
import { ACTION_IDS, ACTION_LABELS, DEFAULT_ACTIONS, DEFAULT_MQL, GRADES, INTENT_COLS, defaultRules } from "../../../api/src/shared/lead-grade.js";
import { rulesKey, validateIcpRules } from "../../../api/src/shared/icp-rules.js";
// Configurações → ICP & nota (docs/PLANO-ICP-CONFIGURAVEL.md, fase 3).
// A régua decide a nota S–E de todo lead do produto: métricas, agenda do
// closer sênior, prioridade e cadência. Por isso salvar a régua exige ver a
// PRÉVIA do rascunho atual; o texto do cartão salva direto. Ler é aberto;
// editar exige a etiqueta admin ou Editor de ICP (o servidor confere de novo).

const { useState, useEffect, useMemo } = React;
const clone = (v) => JSON.parse(JSON.stringify(v));
const inputStyle = {
  width: "100%", height: 32, padding: "0 10px", background: "var(--bg-1)", border: "1px solid var(--line-1)",
  borderRadius: 999, color: "var(--fg-1)", fontSize: 12, fontFamily: "var(--sans)",
};
const tile = { background: "var(--bg-inset)", borderRadius: 18, padding: "14px 16px" };
const TYPE_LABEL = { produto: "multiplica as respostas", soma: "soma pontos", matriz: "matriz de duas perguntas" };
const lines = (v) => String(v || "").split("\n").map((x) => x.trim()).filter(Boolean);
const fmtNum = (n) => (Number.isFinite(Number(n)) ? Number(n).toLocaleString("pt-BR") : "—");
// Leitura rápida do mínimo da faixa: "R$ 1 mi" em vez de contar os zeros de 1000000.
const fmtShort = (n) => { const v = Number(n); if (!Number.isFinite(v)) return "—"; return v >= 1e6 ? `${(v / 1e6).toLocaleString("pt-BR")} mi` : v >= 1e3 ? `${(v / 1e3).toLocaleString("pt-BR")} mil` : v.toLocaleString("pt-BR"); };
const pct = (n, d) => (d > 0 ? `${Math.round((n / d) * 100)}%` : "—");
// "Mudou?" pela mesma régua limpa que o servidor compara (padrões preenchidos, chaves em ordem).
const comparable = (rules) => { const v = validateIcpRules(rules); return rulesKey(v.ok ? v.rules : rules); };
const INTENT_LABEL = { alta: "intenção alta", media: "média ou não medida", baixa: "intenção baixa" };

// Perguntas que podem virar eixo: as que a API manda (cadastro do lead +
// formulários publicados do produto; sem elas, o cadastro) e qualquer chave que
// a régua já use, mesmo que o formulário tenha mudado.
function questionsOf(product, rules, fromApi) {
  const out = new Map();
  for (const q of fromApi || product?.leadQuestions || []) {
    if (q?.key && Array.isArray(q.options) && q.options.length) {
      out.set(q.key, { key: q.key, label: q.label || q.key, options: q.options.map((o) => (typeof o === "string" ? { value: o, label: o } : { value: o.value, label: o.label || o.value })) });
    }
  }
  const visit = (axis) => {
    if (!axis?.key) return;
    if (!out.has(axis.key)) out.set(axis.key, { key: axis.key, label: axis.key, options: [] });
    const q = out.get(axis.key);
    for (const v of Object.keys(axis.values || axis.index || {})) if (!q.options.some((o) => o.value === v)) q.options.push({ value: v, label: v, outside: true });
    if (axis.fallback) visit(axis.fallback);
  };
  for (const m of rules?.methods || []) { (m.axes || []).forEach(visit); visit(m.rows); visit(m.cols); }
  return [...out.values()];
}

export function IcpSettings({ s, Header }) {
  const { refresh } = useData();
  const canEdit = canEditIcpUser();
  const [state, setState] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [draft, setDraft] = useState(null);
  const [note, setNote] = useState("");
  const [preview, setPreview] = useState(null); // { key, data }
  const [busy, setBusy] = useState(""); // "preview" | "save"
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [versions, setVersions] = useState([]);
  const [trend, setTrend] = useState(null);

  async function load() {
    setLoadError("");
    try {
      const [st, vs, tr] = await Promise.all([api.icp(s.id), api.icpVersions(s.id).catch(() => ({ versions: [] })), api.icpTrend(s.id).catch(() => null)]);
      setState(st);
      setVersions(vs.versions || []);
      setTrend(tr);
      setDraft({ text: { ...st.text, profile: (st.text.profile || []).join("\n"), redFlags: (st.text.redFlags || []).join("\n") }, rules: clone(st.rules) });
      setPreview(null);
    } catch (e) { setLoadError(e.message || "Não foi possível ler a régua."); }
  }
  useEffect(() => { load(); }, [s.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const questions = useMemo(() => questionsOf(s, draft?.rules, state?.questions), [s, draft?.rules, state?.questions]);
  const validation = useMemo(() => (draft ? validateIcpRules(draft.rules) : { ok: false, errors: [] }), [draft]);
  if (loadError) return <div><Header title="ICP & nota" sub="régua de nota do produto" /><div className="settings-notice">{loadError}<button onClick={load}>tentar de novo</button></div></div>;
  if (!state || !draft) return <div><Header title="ICP & nota" sub="carregando a régua…" /></div>;

  const rulesKey = comparable(draft.rules);
  const rulesChanged = rulesKey !== comparable(state.rules);
  const textOut = { ...draft.text, profile: lines(draft.text.profile), redFlags: lines(draft.text.redFlags) };
  const textChanged = JSON.stringify(textOut) !== JSON.stringify(state.text);
  const previewFresh = preview?.key === rulesKey;
  const canSave = canEdit && !busy && (textChanged || rulesChanged) && (!rulesChanged || (validation.ok && previewFresh));
  const setRules = (fn) => { setSaved(""); setDraft((d) => ({ ...d, rules: fn(clone(d.rules)) })); };
  const setText = (patch) => { setSaved(""); setDraft((d) => ({ ...d, text: { ...d.text, ...patch } })); };

  async function runPreview() {
    if (!validation.ok) return;
    setBusy("preview"); setError("");
    try { setPreview({ key: rulesKey, data: await api.icpPreview(s.id, validation.rules) }); }
    catch (e) { setError(e.message || "Não foi possível calcular a prévia."); }
    finally { setBusy(""); }
  }
  async function save() {
    if (!canSave) return;
    setBusy("save"); setError("");
    try {
      const body = { ...(textChanged ? { text: textOut } : {}), ...(rulesChanged ? { rules: validation.rules, baseVersion: Number(state.rules.version) || 0, note } : {}) };
      const out = await api.saveIcp(s.id, body);
      setSaved(rulesChanged ? `Régua v${out.version} salva · ${out.recalculated} lead${out.recalculated === 1 ? "" : "s"} reclassificado${out.recalculated === 1 ? "" : "s"}.` : "Texto do ICP salvo.");
      setNote("");
      await refresh();
      await load();
    } catch (e) {
      setError(e.status === 409 ? "Outra pessoa salvou a régua enquanto você editava. Recarregue para ver a versão atual." : e.message || "Não foi possível salvar.");
    } finally { setBusy(""); }
  }

  const ro = !canEdit || !!busy;
  return (
    <>
      <div>
        <Header title="ICP & nota" sub="a régua que dá a nota S–E de cada lead deste produto: vale para métricas, agenda do closer sênior, prioridade e cadência" />
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", fontSize: 12.5, color: "var(--fg-2)" }}>
          <span className="chip">{state.custom ? `régua personalizada · v${state.rules.version}` : "régua padrão"}</span>
          {state.custom && state.updatedAt && <span className="dim">alterada em {new Date(state.updatedAt).toLocaleString("pt-BR")}{state.updatedBy ? ` por ${userById(state.updatedBy)?.name || state.updatedBy}` : ""}</span>}
          {!canEdit && <span style={{ color: "var(--warn)" }}>Só leitura: editar exige a etiqueta Admin ou Editor de ICP (Equipe).</span>}
        </div>
      </div>

      <div>
        <Header title="Cartão do ICP" sub="o selo da topbar e o cartão da Visão geral e dos Treinamentos · salva sem prévia" />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 260px), 1fr))", gap: 12 }}>
          <label className="kicker" style={{ display: "flex", flexDirection: "column", gap: 6 }}>Selo (topbar)
            <input disabled={ro} value={draft.text.pill || ""} maxLength={60} onChange={(e) => setText({ pill: e.target.value })} style={inputStyle} /></label>
          <label className="kicker" style={{ display: "flex", flexDirection: "column", gap: 6 }}>Título
            <input disabled={ro} value={draft.text.headline || ""} maxLength={200} onChange={(e) => setText({ headline: e.target.value })} style={inputStyle} /></label>
          <label className="kicker" style={{ display: "flex", flexDirection: "column", gap: 6 }}>Contato ideal
            <input disabled={ro} value={draft.text.contact || ""} maxLength={200} onChange={(e) => setText({ contact: e.target.value })} style={inputStyle} /></label>
          <label className="kicker" style={{ display: "flex", flexDirection: "column", gap: 6 }}>Perfil ideal · um por linha
            <textarea disabled={ro} rows={4} value={draft.text.profile} onChange={(e) => setText({ profile: e.target.value })} style={{ ...inputStyle, height: "auto", borderRadius: 16, padding: "8px 12px" }} /></label>
          <label className="kicker" style={{ display: "flex", flexDirection: "column", gap: 6 }}>Sinais vermelhos · um por linha
            <textarea disabled={ro} rows={4} value={draft.text.redFlags} onChange={(e) => setText({ redFlags: e.target.value })} style={{ ...inputStyle, height: "auto", borderRadius: 16, padding: "8px 12px" }} /></label>
        </div>
      </div>

      <div>
        <Header title="Régua da nota" sub="os métodos são tentados em ordem: vale o primeiro que o lead consegue responder · sem resposta em nenhum, o lead fica sem nota" />
        <div style={{ ...tile, marginBottom: 12 }}>
          <div className="kicker" style={{ marginBottom: 8 }}>Notas que contam como ICP · vão para o closer sênior</div>
          <div role="group" aria-label="Notas que contam como ICP" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {GRADES.map((g) => {
              const on = (draft.rules.icpGrades || []).includes(g);
              return <button key={g} type="button" disabled={ro} aria-pressed={on}
                onClick={() => setRules((r) => ({ ...r, icpGrades: on ? r.icpGrades.filter((x) => x !== g) : GRADES.filter((x) => x === g || r.icpGrades.includes(x)) }))}
                style={{ width: 40, height: 32, borderRadius: 999, fontWeight: 700, fontSize: 13, border: `1px solid ${on ? GRADE_STYLE[g].tone : "var(--line-1)"}`, background: on ? GRADE_STYLE[g].tone : "var(--bg-1)", color: on ? GRADE_STYLE[g].badgeFg : "var(--fg-3)" }}>{g}</button>;
            })}
          </div>
        </div>
        <div style={{ ...tile, marginBottom: 12, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 160px), 1fr))", gap: 10 }}>
          <label className="kicker" style={{ display: "flex", flexDirection: "column", gap: 6, gridColumn: "span 2" }}>O que o valor mede
            <input disabled={ro} value={draft.rules.value?.label || ""} placeholder="ex.: faturamento mensal estimado" onChange={(e) => setRules((r) => ({ ...r, value: { ...r.value, label: e.target.value } }))} style={inputStyle} /></label>
          <label className="kicker" style={{ display: "flex", flexDirection: "column", gap: 6 }}>Prefixo
            <input disabled={ro} value={draft.rules.value?.prefix || ""} placeholder="R$" onChange={(e) => setRules((r) => ({ ...r, value: { ...r.value, prefix: e.target.value } }))} style={inputStyle} /></label>
          <label className="kicker" style={{ display: "flex", flexDirection: "column", gap: 6 }}>Sufixo
            <input disabled={ro} value={draft.rules.value?.suffix || ""} placeholder="/mês" onChange={(e) => setRules((r) => ({ ...r, value: { ...r.value, suffix: e.target.value } }))} style={inputStyle} /></label>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {draft.rules.methods.map((m, i) => (
            <MethodEditor key={`${i}:${m.id}`} m={m} i={i} n={draft.rules.methods.length} ro={ro} questions={questions} value={draft.rules.value}
              onChange={(next) => setRules((r) => { r.methods[i] = next; return r; })}
              onMove={(d) => setRules((r) => { const [x] = r.methods.splice(i, 1); r.methods.splice(i + d, 0, x); return r; })}
              onRemove={() => setRules((r) => { r.methods.splice(i, 1); return r; })} />
          ))}
        </div>
        {canEdit && <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
          <button type="button" disabled={ro} style={chromeBtnStyleSmall} onClick={() => setRules((r) => ({ ...r, methods: [...r.methods, { id: `m${Date.now().toString(36)}`, type: "produto", label: "", axes: [{ key: "", values: {} }], bands: [{ grade: "A", min: 1 }, { grade: "E", min: 0 }] }] }))}>+ método que multiplica respostas</button>
          <button type="button" disabled={ro} style={chromeBtnStyleSmall} onClick={() => setRules((r) => ({ ...r, methods: [...r.methods, { id: `m${Date.now().toString(36)}`, type: "soma", label: "", axes: [{ key: "", values: {} }], bands: [{ grade: "A", min: 50 }, { grade: "E", min: 0 }] }] }))}>+ método por pontos</button>
          {state.custom && <button type="button" disabled={ro} style={chromeBtnStyleSmall} onClick={() => setRules(() => clone(defaultRules(s.id)))}>voltar à régua padrão</button>}
          {rulesChanged && <button type="button" disabled={ro} style={chromeBtnStyleSmall} onClick={() => setRules(() => clone(state.rules))}>descartar mudanças na régua</button>}
        </div>}
        {!validation.ok && validation.errors.length > 0 && (
          <ul role="alert" style={{ margin: "12px 0 0", paddingLeft: 18, color: "var(--neg)", fontSize: 12.5, lineHeight: 1.6 }}>
            {validation.errors.slice(0, 8).map((e) => <li key={e}>{e}</li>)}
          </ul>
        )}
      </div>

      <div>
        <Header title="O que o SDR faz" sub="nota × intenção medida no formulário → ação; a cadência acompanha a ação (ligar: prioritária · WhatsApp: padrão · nutrir: leve) · mudar aqui também pede prévia" />
        <div className="tbl-x"><table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12.5 }}>
          <thead><tr><th className="kicker" style={{ padding: "8px 10px", textAlign: "left" }}>Nota</th>{INTENT_COLS.map((c) => <th key={c} className="kicker" style={{ padding: "8px 10px", textAlign: "left" }}>{INTENT_LABEL[c]}</th>)}</tr></thead>
          <tbody>{GRADES.map((g) => (
            <tr key={g}>
              <td style={{ padding: "6px 10px", borderTop: "1px solid var(--line-1)", fontWeight: 700, color: GRADE_STYLE[g].ink }}>{g}</td>
              {INTENT_COLS.map((c) => {
                const cur = draft.rules.actions?.[g]?.[c] ?? DEFAULT_ACTIONS[g][c];
                return <td key={c} style={{ padding: "6px 10px", borderTop: "1px solid var(--line-1)" }}>
                  <select disabled={ro} aria-label={`Ação para nota ${g}, ${INTENT_LABEL[c]}`} value={cur}
                    onChange={(e) => setRules((r) => { const a = clone(r.actions || DEFAULT_ACTIONS); a[g] = { ...a[g], [c]: e.target.value }; return { ...r, actions: a }; })}
                    style={{ ...inputStyle, minWidth: 170 }}>
                    {ACTION_IDS.map((id) => <option key={id} value={id}>{ACTION_LABELS[id]}</option>)}
                  </select>
                </td>;
              })}
            </tr>
          ))}</tbody>
        </table></div>
        <div style={{ ...tile, marginTop: 12, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div className="kicker" style={{ flexBasis: "100%" }}>MQL · lead pronto pro SDR</div>
          <label className="kicker" style={{ display: "flex", flexDirection: "column", gap: 6 }}>Nota mínima
            <select disabled={ro} value={draft.rules.mql?.minGrade ?? DEFAULT_MQL.minGrade} onChange={(e) => setRules((r) => ({ ...r, mql: { ...DEFAULT_MQL, ...r.mql, minGrade: e.target.value } }))} style={{ ...inputStyle, width: 120 }}>
              {GRADES.map((g) => <option key={g} value={g}>{g} ou melhor</option>)}
            </select></label>
          <label className="kicker" style={{ display: "flex", flexDirection: "column", gap: 6 }}>Qualificação mínima (0–100)
            <input type="number" min="0" max="100" disabled={ro} value={draft.rules.mql?.minQualificacao ?? DEFAULT_MQL.minQualificacao} onChange={(e) => setRules((r) => ({ ...r, mql: { ...DEFAULT_MQL, ...r.mql, minQualificacao: e.target.value === "" ? "" : Number(e.target.value) } }))} style={{ ...inputStyle, width: 120, textAlign: "right" }} /></label>
          <span className="dim" style={{ fontSize: 12, flex: "1 1 220px" }}>Sem intenção medida (o formulário não perguntou), o MQL fica indeterminado.</span>
        </div>
      </div>

      <div>
        <Header title="Prévia e salvar" sub={rulesChanged ? "a régua mudou: veja o impacto antes de salvar · o recálculo não mexe em etapa, responsável nem agenda" : "nada mudou na régua · o texto do cartão salva direto"} />
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          {rulesChanged && <button type="button" onClick={runPreview} disabled={!canEdit || !!busy || !validation.ok} style={chromeBtnStyleSmall}>{busy === "preview" ? "calculando…" : previewFresh ? "recalcular prévia" : "prever impacto"}</button>}
          {rulesChanged && canEdit && <input value={note} maxLength={280} disabled={!!busy} onChange={(e) => setNote(e.target.value)} placeholder="por que a régua mudou (fica no histórico)" aria-label="Motivo da mudança" style={{ ...inputStyle, flex: "1 1 260px", width: "auto" }} />}
          <button type="button" onClick={save} disabled={!canSave}
            title={rulesChanged && !previewFresh ? "veja a prévia do rascunho atual antes de salvar" : undefined}
            style={{ height: 32, padding: "0 15px", borderRadius: 999, fontSize: 12.5, fontWeight: 600, background: "var(--btn-bg)", color: "var(--btn-fg)" }}>
            {busy === "save" ? "salvando…" : rulesChanged ? "salvar régua" : "salvar texto"}
          </button>
          {error && <span role="alert" style={{ color: "var(--neg)", fontSize: 12.5 }}>{error}</span>}
          {saved && <span role="status" style={{ color: "var(--pos)", fontSize: 12.5 }}>{saved}</span>}
        </div>
        {rulesChanged && preview && !previewFresh && <div className="dim" style={{ fontSize: 12, marginTop: 8 }}>A régua mudou depois da última prévia. Calcule de novo para salvar.</div>}
        {previewFresh && <PreviewResult data={preview.data} />}
      </div>

      {trend && trend.months.length > 0 && <div>
        <Header title="Evolução do ICP" sub={`leads por mês de entrada, todos avaliados pela régua vigente${trend.version ? ` (v${trend.version})` : ""} · os marcos mostram quando a régua mudou`} />
        <div className="tbl-x"><table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12.5 }}>
          <thead><tr>{["Mês", "Leads", "% ICP", "Sem nota", "Pelo legado", ""].map((h, k) => <th key={k} className="kicker" style={{ padding: "8px 10px", textAlign: k === 0 || k === 5 ? "left" : "right" }}>{h}</th>)}</tr></thead>
          <tbody>{trend.months.map((m) => {
            const marks = trend.markers.filter((x) => x.month === m.month);
            return <tr key={m.month}>
              <td style={{ padding: "6px 10px", borderTop: "1px solid var(--line-1)" }}>{m.month}</td>
              <td className="tnum" style={{ padding: "6px 10px", borderTop: "1px solid var(--line-1)", textAlign: "right" }}>{fmtNum(m.leads)}</td>
              <td className="tnum" style={{ padding: "6px 10px", borderTop: "1px solid var(--line-1)", textAlign: "right", fontWeight: 600 }}>{pct(m.icp, m.leads)}</td>
              <td className="tnum" style={{ padding: "6px 10px", borderTop: "1px solid var(--line-1)", textAlign: "right" }}>{fmtNum(m.ungraded)}</td>
              <td className="tnum" style={{ padding: "6px 10px", borderTop: "1px solid var(--line-1)", textAlign: "right" }}>{fmtNum(m.legacy)}</td>
              <td style={{ padding: "6px 10px", borderTop: "1px solid var(--line-1)" }}>{marks.map((x) => <span key={x.version} className="chip" title={x.note || undefined} style={{ marginRight: 4 }}>régua v{x.version} · {new Date(x.at).toLocaleDateString("pt-BR")}</span>)}</td>
            </tr>;
          })}</tbody>
        </table></div>
      </div>}

      <div>
        <Header title="Histórico" sub="cada régua salva vira uma versão · carregar uma versão antiga põe ela no rascunho, e salvar cria uma versão nova" />
        {versions.length === 0 ? <div className="dim" style={{ fontSize: 12.5 }}>Nenhuma versão salva ainda: o produto usa a régua padrão.</div> : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {versions.map((v) => (
              <div key={v.id} style={{ ...tile, padding: "10px 14px", display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", fontSize: 12.5 }}>
                <b className="tnum">{v.kind === "rules" ? `régua v${v.version}` : "texto"}</b>
                <span className="dim">{new Date(v.at).toLocaleString("pt-BR")} · {userById(v.by)?.name || v.by}</span>
                {v.note && <span style={{ color: "var(--fg-2)" }}>{v.note}</span>}
                {v.kind === "rules" && canEdit && <button type="button" disabled={!!busy} style={{ ...chromeBtnStyleSmall, marginLeft: "auto" }} onClick={() => setRules(() => clone(v.rules))}>carregar no rascunho</button>}
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function MethodEditor({ m, i, n, ro, questions, value, onChange, onMove, onRemove }) {
  const set = (patch) => onChange({ ...m, ...patch });
  const isMatrix = m.type === "matriz";
  return (
    <div style={tile}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
        <span className="mono" style={{ fontSize: 11, color: "var(--accent)", fontWeight: 600 }}>{i + 1}º</span>
        <input disabled={ro} aria-label={`Nome do método ${i + 1}`} value={m.label || ""} placeholder="nome que aparece no badge (ex.: pedidos × ticket médio)" onChange={(e) => set({ label: e.target.value })} style={{ ...inputStyle, flex: "1 1 240px", width: "auto" }} />
        <span className="chip">{TYPE_LABEL[m.type] || m.type}</span>
        <label style={{ display: "inline-flex", gap: 6, alignItems: "center", fontSize: 12 }} title="Nota marcada com L (Legado) no badge">
          <input type="checkbox" disabled={ro} checked={!!m.legacy} onChange={(e) => set({ legacy: e.target.checked || undefined })} style={{ accentColor: "var(--accent)" }} /> legado
        </label>
        {!ro && <span style={{ display: "inline-flex", gap: 4 }}>
          <button type="button" aria-label={`Subir método ${i + 1}`} disabled={i === 0} onClick={() => onMove(-1)} style={chromeBtnStyleSmall}>↑</button>
          <button type="button" aria-label={`Descer método ${i + 1}`} disabled={i === n - 1} onClick={() => onMove(1)} style={chromeBtnStyleSmall}>↓</button>
          <button type="button" aria-label={`Remover método ${i + 1}`} disabled={n === 1} onClick={onRemove} style={chromeBtnStyleSmall}>✕</button>
        </span>}
      </div>
      {isMatrix ? <MatrixView m={m} questions={questions} /> : <>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 280px), 1fr))", gap: 10 }}>
          {(m.axes || []).map((axis, j) => (
            <AxisEditor key={j} axis={axis} j={j} kind={m.type} ro={ro} questions={questions}
              onChange={(next) => { const axes = [...m.axes]; axes[j] = next; set({ axes }); }}
              onRemove={m.axes.length > 1 ? () => set({ axes: m.axes.filter((_, k) => k !== j) }) : null} />
          ))}
        </div>
        {!ro && m.axes.length < 4 && <button type="button" style={{ ...chromeBtnStyleSmall, marginTop: 8 }} onClick={() => set({ axes: [...m.axes, { key: "", values: {} }] })}>+ pergunta</button>}
        <BandsEditor bands={m.bands || []} ro={ro} value={value} kind={m.type} onChange={(bands) => set({ bands })} />
      </>}
    </div>
  );
}

function AxisEditor({ axis, j, kind, ro, questions, onChange, onRemove }) {
  const q = questions.find((x) => x.key === axis.key);
  const values = axis.values || {};
  return (
    <div style={{ background: "var(--bg-1)", borderRadius: 16, padding: "10px 12px" }}>
      <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 8 }}>
        <select disabled={ro} aria-label={`Pergunta ${j + 1}`} value={axis.key || ""} onChange={(e) => onChange({ key: e.target.value, values: {} })} style={{ ...inputStyle, flex: 1 }}>
          <option value="">escolha a pergunta…</option>
          {questions.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
        </select>
        {onRemove && !ro && <button type="button" aria-label={`Remover pergunta ${j + 1}`} onClick={onRemove} style={chromeBtnStyleSmall}>✕</button>}
      </div>
      {q && <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <div className="kicker" style={{ display: "flex", justifyContent: "space-between" }}><span>resposta</span><span>{kind === "soma" ? "pontos" : "valor"}</span></div>
        {q.options.map((o) => (
          <label key={o.value} style={{ display: "grid", gridTemplateColumns: "1fr 110px", gap: 8, alignItems: "center", fontSize: 12.5 }}>
            <span style={{ color: o.outside ? "var(--warn)" : "var(--fg-2)" }} title={o.outside ? "opção que não está mais nas perguntas do produto" : undefined}>{o.label}{o.outside ? " · fora do formulário" : ""}</span>
            <input type="number" min="0" disabled={ro} aria-label={`${q.label}: ${o.label}`} value={values[o.value] ?? ""} placeholder="sem valor"
              onChange={(e) => { const next = { ...values }; if (e.target.value === "") delete next[o.value]; else next[o.value] = Number(e.target.value); onChange({ ...axis, values: next }); }}
              style={{ ...inputStyle, textAlign: "right" }} />
          </label>
        ))}
        {q.options.some((o) => values[o.value] == null) && <div className="dim" style={{ fontSize: 11.5 }}>Resposta sem valor não dá nota por este método{kind === "produto" ? " (o lead cai no próximo)" : ""}.</div>}
      </div>}
    </div>
  );
}

function BandsEditor({ bands, ro, value, kind, onChange }) {
  const sorted = [...bands].sort((a, b) => GRADES.indexOf(a.grade) - GRADES.indexOf(b.grade));
  const unit = (n) => `${value?.prefix ? `${value.prefix} ` : ""}${fmtNum(n)}${value?.suffix || ""}`;
  const free = GRADES.filter((g) => !bands.some((b) => b.grade === g));
  return (
    <div style={{ marginTop: 12 }}>
      <div className="kicker" style={{ marginBottom: 6 }}>Faixas · nota a partir de {kind === "soma" ? "quantos pontos" : "qual valor"}</div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {sorted.map((b) => (
          <label key={b.grade} style={{ display: "inline-flex", gap: 6, alignItems: "center", background: "var(--bg-1)", borderRadius: 999, padding: "4px 6px 4px 12px", fontSize: 12.5 }} title={`${b.grade}: ${unit(b.min)} ou mais`}>
            <b style={{ color: GRADE_STYLE[b.grade].ink, width: 12 }}>{b.grade}</b>≥
            <input type="number" min="0" disabled={ro} aria-label={`Mínimo da nota ${b.grade}`} value={b.min}
              onChange={(e) => onChange(bands.map((x) => (x.grade === b.grade ? { ...x, min: e.target.value === "" ? "" : Number(e.target.value) } : x)))}
              style={{ ...inputStyle, width: 120, height: 28, textAlign: "right" }} />
            <span className="dim tnum" style={{ fontSize: 11.5, minWidth: 54 }}>{value?.prefix ? `${value.prefix} ` : ""}{fmtShort(b.min)}</span>
            {!ro && <button type="button" aria-label={`Remover faixa ${b.grade}`} onClick={() => onChange(bands.filter((x) => x.grade !== b.grade))} className="mono dim" style={{ fontSize: 12, padding: "0 4px" }}>✕</button>}
          </label>
        ))}
        {!ro && free.length > 0 && (
          <select aria-label="Adicionar faixa" value="" onChange={(e) => e.target.value && onChange([...bands, { grade: e.target.value, min: 0 }])} style={{ ...inputStyle, width: 130 }}>
            <option value="">+ faixa</option>
            {free.map((g) => <option key={g} value={g}>nota {g}</option>)}
          </select>
        )}
      </div>
    </div>
  );
}

function MatrixView({ m, questions }) {
  const opts = (axis) => {
    const q = questions.find((x) => x.key === axis?.key);
    const idx = axis?.index || {};
    const byIndex = new Map();
    for (const [v, i] of Object.entries(idx)) if (!byIndex.has(i)) byIndex.set(i, q?.options.find((o) => o.value === v)?.label || v);
    return byIndex;
  };
  const rows = opts(m.rows);
  const cols = opts(m.cols);
  const label = (axis) => questions.find((x) => x.key === axis?.key)?.label || axis?.key || "?";
  return (
    <div>
      <div className="dim" style={{ fontSize: 12, marginBottom: 8 }}>
        Linhas: {label(m.rows)} · colunas: {label(m.cols)}{m.cols?.fallback ? ` (ou ${label(m.cols.fallback)})` : ""}. Resposta em branco lê a primeira linha ou coluna.
        A grade fica como está; dá para reordenar, marcar como legado ou remover o método.
      </div>
      <div className="tbl-x"><table style={{ borderCollapse: "collapse", fontSize: 12 }}>
        <thead><tr><th className="kicker" style={{ padding: "6px 8px" }} />{(m.grid?.[0] || []).map((_, c) => <th key={c} className="kicker" style={{ padding: "6px 8px", textAlign: "center" }}>{cols.get(c) || c}</th>)}</tr></thead>
        <tbody>{(m.grid || []).map((row, r) => (
          <tr key={r}><th className="kicker" style={{ padding: "6px 8px", textAlign: "left" }}>{rows.get(r) || r}</th>
            {row.map((g, c) => <td key={c} style={{ padding: "6px 8px", textAlign: "center", fontWeight: 700, color: GRADE_STYLE[g]?.ink }}>{g}</td>)}</tr>
        ))}</tbody>
      </table></div>
    </div>
  );
}

function PreviewResult({ data }) {
  const r = data.recent;
  const Stat = ({ label, v, sub, tone }) => (
    <div style={{ ...tile, padding: "12px 14px" }}>
      <div style={{ fontSize: 12, color: "var(--fg-3)" }}>{label}</div>
      <div className="tnum" style={{ fontSize: 24, fontWeight: 700, color: tone || "var(--fg-1)" }}>{v}</div>
      {sub && <div className="dim" style={{ fontSize: 11.5 }}>{sub}</div>}
    </div>
  );
  return (
    <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 12 }}>
      <div className="kicker">Últimos {data.days} dias · {fmtNum(r.leads)} leads</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 140px), 1fr))", gap: 10 }}>
        <Stat label="Mudam de nota" v={fmtNum(r.changed)} sub={`${pct(r.changed, r.leads)} dos leads`} />
        <Stat label="Entram no ICP" v={fmtNum(r.icpIn)} tone={r.icpIn ? "var(--pos)" : undefined} />
        <Stat label="Saem do ICP" v={fmtNum(r.icpOut)} tone={r.icpOut ? "var(--neg)" : undefined} />
        <Stat label="% de ICP" v={`${pct(r.icpBefore, r.leads)} → ${pct(r.icpAfter, r.leads)}`} />
        <Stat label="Mudam de ação do SDR" v={fmtNum(r.actionChanged ?? 0)} sub="ligar, WhatsApp ou nutrir" />
        <Stat label="Calls marcadas que trocam de closer" v={fmtNum(data.callsChanging)} tone={data.callsChanging ? "var(--warn)" : undefined} sub="sênior ↔ júnior nas próximas ofertas" />
      </div>
      <div className="dim" style={{ fontSize: 12 }}>Base inteira: {fmtNum(data.total.leads)} leads · {fmtNum(data.total.changed)} mudam de nota · ICP {pct(data.total.icpBefore, data.total.leads)} → {pct(data.total.icpAfter, data.total.leads)} · sem nota {fmtNum(data.total.ungradedBefore)} → {fmtNum(data.total.ungradedAfter)}</div>
      {data.moves.length > 0 && <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{data.moves.map((m) => <span key={m.move} className="chip">{m.move} · {m.n}</span>)}</div>}
      {data.months.length > 0 && (
        <div className="tbl-x"><table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12.5 }}>
          <thead><tr>{["Mês de entrada", "Leads", "% ICP hoje", "% ICP com a régua nova"].map((h) => <th key={h} className="kicker" style={{ padding: "8px 10px", textAlign: h === "Mês de entrada" ? "left" : "right" }}>{h}</th>)}</tr></thead>
          <tbody>{data.months.map((m) => (
            <tr key={m.month}><td style={{ padding: "6px 10px", borderTop: "1px solid var(--line-1)" }}>{m.month}</td>
              <td className="tnum" style={{ padding: "6px 10px", borderTop: "1px solid var(--line-1)", textAlign: "right" }}>{fmtNum(m.leads)}</td>
              <td className="tnum" style={{ padding: "6px 10px", borderTop: "1px solid var(--line-1)", textAlign: "right" }}>{pct(m.icpBefore, m.leads)}</td>
              <td className="tnum" style={{ padding: "6px 10px", borderTop: "1px solid var(--line-1)", textAlign: "right", fontWeight: 600 }}>{pct(m.icpAfter, m.leads)}</td></tr>
          ))}</tbody>
        </table></div>
      )}
      {data.calls.length > 0 && (
        <div>
          <div className="kicker" style={{ marginBottom: 6 }}>Calls que trocam de closer</div>
          {data.calls.map((c) => <div key={c.id} style={{ fontSize: 12.5, padding: "3px 0" }}>{c.name || c.id} · {String(c.callAt).replace("T", " ")} · {c.from || "–"} → {c.to || "–"} · vai para o {c.pool === "upper" ? "sênior" : "júnior"}</div>)}
        </div>
      )}
      {data.samples.length > 0 && (
        <details>
          <summary style={{ cursor: "pointer", fontSize: 12.5 }}>Exemplos de leads que mudam de nota ({data.samples.length})</summary>
          <div style={{ marginTop: 6 }}>{data.samples.map((x) => <div key={x.id} style={{ fontSize: 12.5, padding: "3px 0" }}>{x.name || x.company || x.id}{x.company && x.name ? ` · ${x.company}` : ""} · {x.from || "–"} → {x.to || "–"}</div>)}</div>
        </details>
      )}
    </div>
  );
}
