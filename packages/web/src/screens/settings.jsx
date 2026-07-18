import React from "react";
import { chromeBtnStyleSmall } from "../lib/ui.js";
import { EmptyState, PrimaryButton, Avatar } from "../atoms.jsx";
import { useData } from "../data.jsx";
import { api } from "../lib/api.js";
import { KINDS, KIND_IDS, guessKind, lossReasonsOf, stageKind, stageByKind, phaseOf, NEXT_KINDS, NEXT_STEP_KINDS, NEXT_STEP_LABELS } from "../lib/funnel.js";
import { useActiveSaas } from "../lib/workspace.js";
import { DEFAULT_SCRIPTS, SCRIPT_CATALOG, catalogStageRow, isNoShowStage } from "../lib/scripts.js";
import { usersByRole } from "../lib/users.js";
import { ScriptPanel } from "./today.jsx";
import { ErrorBoundary } from "../components/error-boundary.jsx";
import { NAV } from "../chrome.jsx";
import { FilterTab, PageHead } from "../components/viz.jsx";
// SaaS Settings (fase 3) — funil, campos custom, pesos da saúde e Aha EDITÁVEIS
// por SaaS (gravam no produto). Equipe (roles sdr/closer/integrator) é global.

const { useState: useStS } = React;

// O App remonta a tela a cada refresh pós-save (key=dataVersion); guardar a
// última visão em módulo preserva a aba escolhida entre os remounts. O SaaS
// ativo vem do workspace global (seletor no pé da sidebar).
const lastView = { tab: "funnel" };

const inputStyle = {
  width: "100%", height: 32, padding: "0 9px",
  background: "var(--bg-1)", border: "1px solid var(--line-2)",
  borderRadius: "var(--r-2)", color: "var(--fg-1)", fontSize: 12, fontFamily: "var(--sans)",
};
const slug = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "")
  .toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);

function SettingsScreen({ saasId }) {
  const { SAAS } = window.SEED;
  const { openForm } = useData();
  const [activeProduct] = useActiveSaas();
  // "health"/"aha" foram removidas; se sobrou salvo na sessão, cai no funil.
  const [tab, setTab] = useStS(lastView.tab === "health" || lastView.tab === "aha" ? "funnel" : lastView.tab);
  lastView.tab = tab;
  const s = activeProduct;

  const TABS = [
    ["funnel",      "Funil & estágios"],
    ["nextsteps",   "Próximos passos"],
    ["scripts",     "Scripts"],
    ["team",        "Equipe"],
    ["fields",      "Campos"],
    ["integrations","Integrações"],
  ];

  if (!s) return (
    <EmptyState
      title="Nenhum SaaS para configurar"
      hint="Crie um produto e ele aparece aqui para configurar funil, campos e integrações."
      action={<PrimaryButton onClick={() => openForm("products")}>+ Criar SaaS</PrimaryButton>}
    />
  );

  // Feedback do "salvar alterações": o clique dispara os botões [data-settings-save]
  // das seções montadas; cada um emite settings-saved / settings-save-error no
  // fim, e o botão do topo conta a história (salvando… → salvo ✓ / erro). O
  // timeout cobre o caso de nenhuma seção responder (nada pra salvar).
  const [saveState, setSaveState] = useStS("idle"); // idle | busy | done | error
  React.useEffect(() => {
    const ok = () => setSaveState((v) => (v === "busy" || v === "done" ? "done" : v));
    const bad = () => setSaveState("error");
    window.addEventListener("settings-saved", ok);
    window.addEventListener("settings-save-error", bad);
    return () => { window.removeEventListener("settings-saved", ok); window.removeEventListener("settings-save-error", bad); };
  }, []);
  React.useEffect(() => {
    if (saveState === "idle") return;
    const t = setTimeout(() => setSaveState("idle"), saveState === "busy" ? 5000 : saveState === "error" ? 4000 : 2500);
    return () => clearTimeout(t);
  }, [saveState]);
  function saveAll() {
    const targets = document.querySelectorAll("[data-settings-save]");
    setSaveState(targets.length ? "busy" : "done"); // sem seção pra salvar = já está tudo salvo
    targets.forEach((button) => button.click());
  }
  const saveLook = saveState === "done"
    ? { background: "var(--pos)", color: "#fff" }
    : saveState === "error"
      ? { background: "var(--neg)", color: "#fff" }
      : { background: "var(--btn-bg)", color: "var(--btn-fg)" };

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, maxWidth: 1080, width: "100%" }}>
      <PageHead title="Configurações" sub={`funil, campos e integrações · ${s?.name}`}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button onClick={() => window.location.reload()} style={{ height: 32, padding: "0 13px", border: "1px solid var(--line-2)", borderRadius: "var(--r-2)", background: "var(--bg-1)", boxShadow: "var(--shadow-1)", color: "var(--fg-2)", fontSize: 12.5, fontWeight: 600 }}>descartar</button>
          <button onClick={saveAll} disabled={saveState === "busy"} style={{ height: 32, padding: "0 15px", borderRadius: "var(--r-2)", fontSize: 12.5, fontWeight: 600, transition: "background .15s ease", ...saveLook }}>
            {saveState === "busy" ? "salvando…" : saveState === "done" ? "salvo ✓" : saveState === "error" ? "erro ao salvar" : "salvar alterações"}
          </button>
        </div>
      </PageHead>

      <div style={{ flex: 1, overflow: "auto", padding: "16px var(--pad-x) 56px", display: "flex", flexDirection: "column", gap: 16 }}>
        <nav style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
          {TABS.map(([k,l]) => (
            <FilterTab key={k} active={tab === k} onClick={() => setTab(k)}>{l}</FilterTab>
          ))}
        </nav>
        <div>
          {/* key={s.id}: troca de workspace REMONTA o editor — sem isso o rascunho
              seedado do produto anterior sobrevive e o Salvar gravaria a config
              de um produto por cima do outro. */}
          {tab === "funnel"       && <FunnelSettings key={s.id} s={s} />}
          {tab === "nextsteps"    && <NextStepsSettings key={s.id} s={s} />}
          {tab === "scripts"      && <ScriptsSettings key={s.id} s={s} />}
          {tab === "team"         && <TeamSettings />}
          {tab === "fields"       && <FieldsSettings key={s.id} s={s} />}
          {tab === "integrations" && <IntegrationsSettings key={s.id} s={s} />}
        </div>
      </div>
    </div>
  );
}

// Barra de salvar compartilhada das abas (estado ocupado + erro + dica).
// No sucesso: reseta o "Salvando…" e mostra "Salvo ✓" por alguns segundos (o
// refresh não remonta a árvore, então SEM o reset o botão ficava preso).
function SaveBar({ onSave, disabled, hint, busyLabel = "Salvando…", label = "Salvar" }) {
  const [busy, setBusy] = useStS(false);
  const [error, setError] = useStS(null);
  const [done, setDone] = useStS(false);
  const mounted = React.useRef(true);
  React.useEffect(() => () => { mounted.current = false; }, []);
  async function go() {
    setBusy(true); setError(null); setDone(false);
    try {
      await onSave();
      window.dispatchEvent(new Event("settings-saved")); // feedback do botão do topo
      if (!mounted.current) return;
      setBusy(false); setDone(true);
      setTimeout(() => { if (mounted.current) setDone(false); }, 2500);
    } catch (e) {
      window.dispatchEvent(new Event("settings-save-error"));
      if (mounted.current) { setBusy(false); setError(e.message || String(e)); }
    }
  }
  return (
    <>
      <button data-settings-save onClick={go} disabled={busy || disabled} aria-label={label} style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clipPath: "inset(50%)" }}>{busy ? busyLabel : done ? "Salvo ✓" : label}</button>
      {error && <span style={{ display: "block", marginTop: 10, fontSize: 12, color: "var(--neg)" }}>{error}</span>}
    </>
  );
}

// Botão de salvar VISÍVEL dos cards (Integrações): mesmo contrato do SaveBar
// (data-settings-save responde ao "salvar alterações" do topo + eventos de
// feedback), mas com o estado na cara — salvando… → salvo ✓, erro ao lado.
function CardSaveButton({ onSave, label = "salvar" }) {
  const [busy, setBusy] = useStS(false);
  const [done, setDone] = useStS(false);
  const [error, setError] = useStS("");
  const mounted = React.useRef(true);
  React.useEffect(() => () => { mounted.current = false; }, []);
  async function go() {
    if (busy) return;
    setBusy(true); setError(""); setDone(false);
    try {
      await onSave();
      window.dispatchEvent(new Event("settings-saved"));
      if (!mounted.current) return;
      setBusy(false); setDone(true);
      setTimeout(() => { if (mounted.current) setDone(false); }, 2500);
    } catch (e) {
      window.dispatchEvent(new Event("settings-save-error"));
      if (mounted.current) { setBusy(false); setError(e.message || "não deu pra salvar"); }
    }
  }
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      {error && <span style={{ fontSize: 11.5, color: "var(--neg)" }}>{error}</span>}
      <button data-settings-save onClick={go} disabled={busy}
        style={{ ...chromeBtnStyleSmall, borderColor: done ? "var(--pos)" : "var(--accent-line)", color: done ? "var(--pos)" : "var(--accent)", opacity: busy ? 0.7 : 1 }}>
        <span style={{ fontSize: 11 }}>{busy ? "salvando…" : done ? "salvo ✓" : label}</span>
      </button>
    </span>
  );
}

// ───────────────────────────────────────────────────────── Funil & estágios
// Editor real: nome (rename migra leads/deals no servidor), cor, conversão e
// regra "parado → Nd". `_orig` rastreia o nome original pra montar o mapa de
// renames do PUT /api/products/:id/funnel.
function FunnelSettings({ s }) {
  const { refresh } = useData();
  const [rows, setRows] = useStS(() => (s.funnel || []).map(f => ({ ...f, _orig: f.stage })));
  const [migrated, setMigrated] = useStS(null);

  const update = (i, patch) => setRows(r => r.map((x, j) => j === i ? { ...x, ...patch } : x));
  const remove = (i) => setRows(r => r.filter((_, j) => j !== i));
  const move = (i, dir) => setRows(r => {
    const j = i + dir;
    if (j < 0 || j >= r.length) return r;
    const next = [...r];
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  });
  const arrowStyle = (disabled) => ({ fontSize: 12, padding: "0 3px", color: "var(--fg-3)", opacity: disabled ? 0.3 : 1, fontFamily: "var(--mono)", cursor: disabled ? "default" : "pointer" });

  // Cadência: 3 números opcionais por estágio (toques máx., re-toque em N dias,
  // SLA do 1º contato em horas) — alimentam os dots do kanban e o GPS.
  const cad = (f, k) => (f.cadence && f.cadence[k] != null ? f.cadence[k] : "");
  const setCad = (i, k, v) => update(i, {
    cadence: { ...(rows[i].cadence || {}), [k]: v === "" ? undefined : Number(v) },
  });

  async function save() {
    const clean = rows.filter(r => String(r.stage || "").trim());
    const funnel = clean.map(({ _orig, ...f }, i) => {
      const cadence = {};
      for (const k of ["maxAttempts", "retryDays", "firstTouchHours"]) {
        const v = Number(f.cadence?.[k]);
        if (Number.isFinite(v) && v > 0) cadence[k] = v;
      }
      return {
        ...f,
        stage: f.stage.trim(),
        kind: KIND_IDS.includes(f.kind) ? f.kind : guessKind(f.stage.trim(), i),
        conv: i === 0 || f.conv === "" || f.conv == null || Number.isNaN(Number(f.conv)) ? 1 : Number(f.conv),
        staleDays: f.staleDays === "" || f.staleDays == null ? null : Number(f.staleDays),
        ...(Object.keys(cadence).length ? { cadence } : { cadence: undefined }),
        // Roteiro da etapa (tela Meu dia): vazio some do registro e a tela cai
        // no roteiro padrão do tipo (lib/scripts.js).
        script: String(f.script || "").trim() ? f.script : undefined,
      };
    });
    const renames = {};
    clean.forEach((r, i) => { if (r._orig && r._orig !== funnel[i].stage) renames[r._orig] = funnel[i].stage; });
    const res = await api.saveFunnel(s.id, funnel, renames);
    setMigrated(res.migrated);
    await refresh();
  }

  const wonCount = rows.filter(r => r.kind === "ganho").length;
  const cadInput = (i, f, k, ph, title, width = 36) => (
    <input type="number" min="0" value={cad(f, k)} placeholder={ph} title={title}
      onChange={(e) => setCad(i, k, e.target.value)}
      style={{ ...inputStyle, width, height: 32, padding: "0 5px", textAlign: "right" }} />
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <section style={{ background: "var(--bg-1)", border: "1px solid var(--line-1)", borderRadius: "var(--r-4)", boxShadow: "var(--shadow-card)" }}>
        <div style={{ padding: "24px 28px 0" }}><SettingHeader number="01" title="Etapas do funil" sub="a ordem define a régua de progresso" /></div>
        <div style={{ padding: "16px 28px 20px" }}>
          <div className="tbl-x">
            <div style={{ minWidth: 690 }}>
              <div style={{ display: "grid", gridTemplateColumns: "32px 1.4fr 1fr 1.2fr 40px", gap: 12, padding: "8px 0", fontSize: 11, fontWeight: 600, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--fg-4)", borderBottom: "1px solid var(--line-1)" }}>
                <span /><span>Etapa</span><span>Tipo</span><span>Cadência</span><span />
              </div>
              {rows.map((f, i) => (
                <div key={i} style={{ display: "grid", gridTemplateColumns: "32px 1.4fr 1fr 1.2fr 40px", gap: 12, padding: "10px 0", alignItems: "center", borderBottom: i < rows.length - 1 ? "1px solid var(--line-faint)" : "none" }}>
                  <span style={{ display: "flex", flexDirection: "column", alignItems: "center", lineHeight: 1 }} title="mover etapa">
                    <button type="button" onClick={() => move(i, -1)} disabled={i === 0} style={arrowStyle(i === 0)}>↑</button>
                    <button type="button" onClick={() => move(i, 1)} disabled={i === rows.length - 1} style={arrowStyle(i === rows.length - 1)}>↓</button>
                  </span>
                  <input value={f.stage || ""} placeholder="Nome da etapa" onChange={(e) => update(i, { stage: e.target.value })} style={{ ...inputStyle, height: 34, padding: "0 2px", borderColor: "transparent", background: "transparent", fontSize: 13.5, fontWeight: 600 }} />
                  <select value={KIND_IDS.includes(f.kind) ? f.kind : guessKind(f.stage, i)} onChange={(e) => update(i, { kind: e.target.value })} style={{ ...inputStyle, height: 32, fontSize: 12, background: "var(--bg-2)", borderColor: "transparent" }}>
                    {KIND_IDS.map((k) => <option key={k} value={k}>{KINDS[k].label}</option>)}
                  </select>
                  <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12.5, color: "var(--fg-3)", whiteSpace: "nowrap" }}>
                    {i === 0 ? <><span>1º toque em até</span>{cadInput(i, f, "firstTouchHours", "—", "SLA do 1º contato em horas")}<span>h</span></> : <>{cadInput(i, f, "maxAttempts", "—", "toques máximos")}<span>tentativas</span>{cad(f, "retryDays") !== "" && <><span>· retry</span>{cadInput(i, f, "retryDays", "—", "retry em dias")}<span>d</span></>}</>}
                  </div>
                  <button type="button" onClick={() => remove(i)} style={{ color: "var(--fg-4)", fontSize: 13 }}>✕</button>
                </div>
              ))}
            </div>
          </div>
          <div style={{ paddingTop: 14, display: "flex", alignItems: "center", gap: 10 }}>
            <button type="button" onClick={() => setRows((current) => [...current, { stage: "", kind: "outro", conv: 1, _orig: null }])} style={{ height: 32, padding: "0 13px", border: "1px solid var(--line-2)", borderRadius: "var(--r-2)", background: "var(--bg-1)", boxShadow: "var(--shadow-1)", fontSize: 12.5, fontWeight: 600 }}>+ etapa</button>
            {wonCount !== 1 && <span style={{ fontSize: 12, color: "var(--warn)" }}>{wonCount === 0 ? "adicione um estágio do tipo ganho" : "mantenha apenas um estágio do tipo ganho"}</span>}
          </div>
          <SaveBar onSave={save} hint={migrated != null ? `salvo · ${migrated} card(s) migrados` : ""} />
        </div>
      </section>

      <LossReasonsSettings s={s} />
      <AutomaticConversionSettings />
    </div>
  );
}

// ───────────────────────────────────────────────────────── Motivos de perda
// product.lossReasons — as opções do modal de perda/desqualificação. O id é
// estável (histórico dos leads guarda o id); renomear o rótulo não quebra nada.
function LossReasonsSettings({ s }) {
  const { refresh } = useData();
  const [rows, setRows] = useStS(() => lossReasonsOf(s).map((r) => ({ ...r })));

  async function save() {
    const lossReasons = rows
      .filter((r) => String(r.label || "").trim())
      .map((r) => ({ id: r.id || slug(r.label), label: r.label.trim() }));
    await api.update("products", s.id, { lossReasons });
    await refresh();
  }

  return (
    <section style={{ background: "var(--bg-1)", border: "1px solid var(--line-1)", borderRadius: "var(--r-4)", boxShadow: "var(--shadow-card)" }}>
      <div style={{ padding: "24px 28px 0" }}><SettingHeader number="02" title="Motivos de perda" sub="aparecem ao marcar Perdido/Desqualificado" /></div>
      <div style={{ padding: "16px 28px 24px", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        {rows.map((r, i) => (
          <span key={i} style={{ display: "inline-flex", alignItems: "center", height: 34, border: "1px solid var(--line-2)", borderRadius: "var(--r-2)", background: "var(--bg-1)", padding: "0 8px 0 12px" }}>
            <input value={r.label || ""} placeholder="Novo motivo" onChange={(e) => setRows((current) => current.map((item, index) => index === i ? { ...item, label: e.target.value } : item))} style={{ width: Math.max(64, String(r.label || "Novo motivo").length * 7.5), border: 0, background: "transparent", fontSize: 12.5, fontWeight: 600, color: "var(--fg-2)" }} />
            <button type="button" onClick={() => setRows((current) => current.filter((_, index) => index !== i))} style={{ color: "var(--fg-4)", fontSize: 11, padding: "0 2px" }}>✕</button>
          </span>
        ))}
        <button type="button" onClick={() => setRows((current) => [...current, { id: "", label: "" }])} style={{ height: 32, padding: "0 6px", color: "var(--accent)", fontSize: 12.5, fontWeight: 600 }}>+ motivo</button>
        <SaveBar onSave={save} />
      </div>
    </section>
  );
}

function AutomaticConversionSettings() {
  const Toggle = ({ on }) => (
    <span style={{ width: 38, height: 22, borderRadius: 999, background: on ? "var(--accent)" : "var(--bg-3)", position: "relative", flexShrink: 0 }}>
      <span style={{ position: "absolute", top: 3, left: on ? 19 : 3, width: 16, height: 16, borderRadius: 999, background: "white", boxShadow: "var(--shadow-1)" }} />
    </span>
  );
  const items = [
    [true, "Criar cliente ao marcar Ganho", "o lead vira cliente com “cliente desde” carimbado e a régua de marcos ativa"],
    [true, "Criar assinatura junto", "usa o valor do lead como preço do ciclo · o MRR do produto deriva daqui"],
    [false, "Exigir API key nas escritas", "leitura fica aberta pra UI · defina COCKPIT_API_KEY no servidor"],
  ];
  return (
    <section style={{ background: "var(--bg-1)", border: "1px solid var(--line-1)", borderRadius: "var(--r-4)", boxShadow: "var(--shadow-card)" }}>
      <div style={{ padding: "24px 28px 0" }}><SettingHeader number="03" title="Conversão automática" sub="quando o lead vira cliente" /></div>
      <div style={{ padding: "16px 28px 24px", display: "flex", flexDirection: "column", gap: 16 }}>
        {items.map(([on, title, description]) => (
          <div key={title} style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
            <Toggle on={on} />
            <div><div style={{ fontSize: 14, fontWeight: 600 }}>{title}</div><div style={{ fontSize: 13, color: "var(--fg-3)", marginTop: 2 }}>{description}</div></div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ─────────────────────────────────────── Próximos passos (bloco "Depois da ação")
// product.nextSteps[scriptKey] = [destKind,...] — POR ROTEIRO (a MESMA quebra da
// aba Scripts: 1º ato, 2ª/3ª tentativa, 1º/2º/3º contato...), define QUAIS botões
// "Depois da ação" aparecem na tela Meu dia e em que ORDEM. Assim cada tentativa
// tem seu próximo passo. Default = NEXT_KINDS do kind da etapa. O today.jsx
// (destinationsFor) resolve a chave via scriptKeyFor e cada destino pra etapa real.
function NextStepsSettings({ s }) {
  const { refresh } = useData();
  const funnel = Array.isArray(s.funnel) ? s.funnel : [];

  // Destinos que ESTE produto consegue mostrar (têm etapa no funil, ou especiais).
  const resolvable = (k) => {
    if (k === "retry") return true;
    if (k === "noshow") return funnel.some((f) => isNoShowStage(f.stage));
    return !!stageByKind(s, k);
  };
  const avail = NEXT_STEP_KINDS.filter(resolvable);

  // Uma linha por VARIANTE de roteiro (igual à aba Scripts), menos a confirmação
  // (não tem "Depois da ação") e as que não têm etapa no funil deste produto.
  const items = SCRIPT_CATALOG
    .filter((c) => c.key !== "confirmacao")
    .map((c) => ({ ...c, row: catalogStageRow(s, c) }))
    .filter((c) => c.row)
    .map((c) => ({ ...c, kind: stageKind(s, c.row.stage) }));

  // Estado por roteiro: destinos disponíveis, ligados primeiro (na ordem salva)
  // e desligados depois. Sem override salvo, parte do default do kind da etapa.
  const initFor = (item) => {
    const chosen = (s.nextSteps?.[item.key] || NEXT_KINDS[item.kind] || []).filter((d) => avail.includes(d));
    const rest = avail.filter((d) => !chosen.includes(d));
    return [...chosen.map((d) => ({ kind: d, on: true })), ...rest.map((d) => ({ kind: d, on: false }))];
  };
  const [rows, setRows] = useStS(() => Object.fromEntries(items.map((it) => [it.key, initFor(it)])));
  const [open, setOpen] = useStS(() => new Set(items.slice(0, 1).map((it) => it.key)));

  const move = (key, i, dir) => setRows((r) => {
    const arr = r[key]; const j = i + dir;
    if (j < 0 || j >= arr.length) return r;
    const next = [...arr]; [next[i], next[j]] = [next[j], next[i]];
    return { ...r, [key]: next };
  });
  const toggle = (key, i) => setRows((r) => ({ ...r, [key]: r[key].map((x, j) => (j === i ? { ...x, on: !x.on } : x)) }));
  const toggleOpen = (key) => setOpen((o) => { const n = new Set(o); n.has(key) ? n.delete(key) : n.add(key); return n; });
  const arrowStyle = (disabled) => ({ fontSize: 13, padding: "0 4px", color: "var(--fg-3)", opacity: disabled ? 0.25 : 1, fontFamily: "var(--mono)", cursor: disabled ? "default" : "pointer" });

  async function save() {
    const nextSteps = { ...(s.nextSteps || {}) };
    for (const it of items) nextSteps[it.key] = rows[it.key].filter((x) => x.on).map((x) => x.kind);
    await api.update("products", s.id, { nextSteps });
    await refresh();
  }

  const phases = [...new Set(items.map((it) => it.phase))];

  return (
    <div>
      <SettingHeader title="Próximos passos" sub="por roteiro (a mesma quebra da aba Scripts): escolha QUAIS botões “Depois da ação” aparecem na tela Meu dia e em que ordem · assim cada tentativa/contato pode ter um próximo passo diferente" />
      {phases.map((phase) => (
        <div key={phase} style={{ marginBottom: 20 }}>
          <div className="mono" style={{ fontSize: 10.5, color: "var(--fg-4)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8 }}>{phase}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 540 }}>
            {items.filter((it) => it.phase === phase).map((it) => {
              const arr = rows[it.key] || [];
              const enabled = arr.filter((x) => x.on);
              const isOpen = open.has(it.key);
              return (
                <div key={it.key} style={{ border: "1px solid var(--line-1)", borderRadius: "var(--r-3)", background: "var(--bg-1)", overflow: "hidden" }}>
                  <button type="button" onClick={() => toggleOpen(it.key)} style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "10px 14px", background: "var(--bg-inset)", textAlign: "left" }}>
                    <span className="mono dim" style={{ fontSize: 11, width: 12 }}>{isOpen ? "▾" : "▸"}</span>
                    <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--fg-1)" }}>{it.label}</span>
                    <span className="mono dim" style={{ fontSize: 10 }}>{it.row.stage}</span>
                    <span className="mono dim" style={{ marginLeft: "auto", fontSize: 10.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 220 }}>
                      {enabled.length ? enabled.map((x) => NEXT_STEP_LABELS[x.kind].replace(/ .*/, "")).join(" · ") : "nenhum botão"}
                    </span>
                  </button>
                  {isOpen && (
                    <div style={{ padding: "4px 14px" }}>
                      {arr.map((x, i) => (
                        <div key={x.kind} style={{ display: "flex", gap: 10, alignItems: "center", padding: "8px 0", borderBottom: i < arr.length - 1 ? "1px solid var(--line-1)" : "none", opacity: x.on ? 1 : 0.55 }}>
                          <button type="button" onClick={() => toggle(it.key, i)}
                            title={x.on ? "aparece — clique pra esconder" : "escondido — clique pra mostrar"}
                            style={{ width: 18, height: 18, flexShrink: 0, borderRadius: 4, border: "1px solid " + (x.on ? "var(--accent-line)" : "var(--line-strong)"), background: x.on ? "var(--accent)" : "transparent", color: "#fff", fontSize: 11, lineHeight: "16px", textAlign: "center" }}>
                            {x.on ? "✓" : ""}
                          </button>
                          <span style={{ fontSize: 12.5, color: "var(--fg-1)", flex: 1 }}>{NEXT_STEP_LABELS[x.kind] || x.kind}</span>
                          <span style={{ display: "flex" }}>
                            <button type="button" onClick={() => move(it.key, i, -1)} disabled={i === 0} style={arrowStyle(i === 0)}>↑</button>
                            <button type="button" onClick={() => move(it.key, i, 1)} disabled={i === arr.length - 1} style={arrowStyle(i === arr.length - 1)}>↓</button>
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
      <SaveBar onSave={save} hint="“Retomar amanhã” registra a tentativa sem trocar de etapa · os demais movem o card pro tipo escolhido" />
    </div>
  );
}

// ───────────────────────────────────────────────────────── Equipe (global)
// Etiquetas de papel do funil (sdr/closer/integrator) — alimentam os pickers do
// board, o modal de handoff e a agenda. NÃO é permissão (todos seguem admin).
const ROLE_OPTS = [
  ["sdr", "SDR", "qualifica leads (fase pré-call)"],
  ["closer", "Closer", "conduz call/proposta/follow-up"],
  ["integrator", "Integração", "faz o setup pós-venda"],
  ["social", "Mídia social", "cuida das redes sociais e do conteúdo"],
  ["admin", "Admin", "dono da operação: não é vaga do funil e não é cobrado no treinamento"],
];

function TeamSettings() {
  const { SAAS } = window.SEED;
  const [users, setUsers] = useStS(null);
  const [saving, setSaving] = useStS("");
  const [invite, setInvite] = useStS(null); // { name, password }

  const load = () => api.listUsers().then(setUsers).catch(() => setUsers([]));
  React.useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function toggleRole(u, role) {
    const roles = (u.roles || []).includes(role)
      ? (u.roles || []).filter((r) => r !== role)
      : [...(u.roles || []), role];
    setUsers((us) => us.map((x) => (x.id === u.id ? { ...x, roles } : x)));
    setSaving(u.id);
    try { await api.updateUser(u.id, { roles }); } catch (e) { console.warn("roles não salvas:", e.message); load(); }
    setSaving("");
  }

  // Escopo de produto: vazio = aparece nos pickers de TODOS os workspaces;
  // preenchido = só no workspace daquele produto (ex.: Ana só na UniqueKids).
  async function setUserSaas(u, saas) {
    setUsers((us) => us.map((x) => (x.id === u.id ? { ...x, saas } : x)));
    setSaving(u.id);
    try { await api.updateUser(u.id, { saas }); } catch (e) { console.warn("produto não salvo:", e.message); load(); }
    setSaving("");
  }

  // Telas permitidas: lista vazia = todas. O servidor também bloqueia as rotas
  // (screens.js) — aqui é a gestão; o menu do usuário muda no próximo refresh.
  async function setUserScreens(u, screens) {
    setUsers((us) => us.map((x) => (x.id === u.id ? { ...x, screens } : x)));
    setSaving(u.id);
    try { await api.updateUser(u.id, { screens }); } catch (e) { console.warn("telas não salvas:", e.message); load(); }
    setSaving("");
  }

  async function createUser() {
    if (!invite?.name || !invite?.password) return;
    try {
      const res = await api.createUser(invite);
      setUsers((us) => [...(us || []), res]);
      setInvite(null);
    } catch (e) { alert("não criou: " + e.message); }
  }

  // Remover usuário. O servidor bloqueia (409) quem ainda é responsável por
  // leads; aí perguntamos se quer forçar (o dono reatribui depois).
  async function removeUser(u) {
    if (!window.confirm(`Remover ${u.name || u.id} do time? (some dos pickers e do placar)`)) return;
    setSaving(u.id);
    try {
      await api.removeUser(u.id);
      setUsers((us) => us.filter((x) => x.id !== u.id));
    } catch (e) {
      if (e.status === 409 && window.confirm(`${e.message}.\n\nRemover mesmo assim? Os leads ficam sem esse responsável até você reatribuir.`)) {
        try { await api.removeUser(u.id, true); setUsers((us) => us.filter((x) => x.id !== u.id)); }
        catch (e2) { alert("não removeu: " + e2.message); }
      } else if (e.status !== 409) { alert("não removeu: " + e.message); }
    }
    setSaving("");
  }

  return (
    <div>
      <SettingHeader title="Equipe & papéis" sub="quem aparece nos pickers de SDR/closer/integração do pipeline · papel ≠ permissão (todos são admin na v1)" />
      <div style={{ border: "1px solid var(--line-1)", borderRadius: "var(--r-3)", background: "var(--bg-1)" }}>
        <div className="mono" style={{ display: "grid", gridTemplateColumns: `1fr repeat(${ROLE_OPTS.length}, 92px) 140px 120px 44px`, gap: 8, padding: "10px 14px", background: "var(--bg-inset)", fontSize: 10, color: "var(--fg-4)", letterSpacing: "0.06em", textTransform: "uppercase", borderBottom: "1px solid var(--line-1)" }}>
          <span>Usuário</span>
          {ROLE_OPTS.map(([k, l, hint]) => <span key={k} title={hint} style={{ textAlign: "center" }}>{l}</span>)}
          <span title="Vazio = aparece nos pickers de todos os produtos; preenchido = só no workspace daquele produto">Produto</span>
          <span title="Quais telas o usuário vê (menu + rotas da API). Nenhuma marcada = todas">Telas</span>
          <span />
        </div>
        {users === null && <div className="mono dim" style={{ padding: "12px 14px", fontSize: 12 }}>carregando…</div>}
        {Array.isArray(users) && users.map((u) => (
          <div key={u.id} style={{ display: "grid", gridTemplateColumns: `1fr repeat(${ROLE_OPTS.length}, 92px) 140px 120px 44px`, gap: 8, padding: "9px 14px", borderBottom: "1px solid var(--line-1)", alignItems: "center", opacity: saving === u.id ? 0.6 : 1 }}>
            <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 500 }}>
              <Avatar id={u.id} name={u.name} size={22} /> {u.name || u.id}
              <span className="mono dim code" style={{ fontSize: 10 }}>{u.id}</span>
            </span>
            {ROLE_OPTS.map(([k]) => (
              <span key={k} style={{ textAlign: "center" }}>
                <input type="checkbox" checked={(u.roles || []).includes(k)} onChange={() => toggleRole(u, k)} style={{ accentColor: "var(--accent)", width: 15, height: 15, cursor: "pointer" }} />
              </span>
            ))}
            <select value={u.saas || ""} onChange={(e) => setUserSaas(u, e.target.value)} style={{ ...inputStyle, height: 26, fontSize: 12 }}>
              <option value="">todos os produtos</option>
              {SAAS.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
            <ScreensPicker screens={u.screens || []} onChange={(screens) => setUserScreens(u, screens)} />
            <button onClick={() => removeUser(u)} title={`Remover ${u.name || u.id} do time`}
              style={{ justifySelf: "center", width: 26, height: 26, borderRadius: "var(--r-2)", border: "1px solid var(--line-2)", background: "var(--bg-1)", color: "var(--fg-4)", fontSize: 13, cursor: "pointer" }}
              onMouseEnter={(e) => { e.currentTarget.style.color = "var(--neg)"; e.currentTarget.style.borderColor = "var(--neg)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = "var(--fg-4)"; e.currentTarget.style.borderColor = "var(--line-2)"; }}>✕</button>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 10, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        {invite ? (
          <>
            <input value={invite.name} placeholder="Nome" onChange={(e) => setInvite({ ...invite, name: e.target.value })} style={{ ...inputStyle, width: 160 }} />
            <input value={invite.password} type="password" placeholder="Senha (4+)" onChange={(e) => setInvite({ ...invite, password: e.target.value })} style={{ ...inputStyle, width: 140 }} />
            <PrimaryButton onClick={createUser} disabled={!invite.name || String(invite.password).length < 4}>criar usuário</PrimaryButton>
            <button onClick={() => setInvite(null)} className="mono dim" style={{ fontSize: 11 }}>cancelar</button>
          </>
        ) : (
          <button type="button" onClick={() => setInvite({ name: "", password: "" })} style={{ ...chromeBtnStyleSmall }}>
            <span style={{ fontSize: 11 }}>+ usuário do time</span>
          </button>
        )}
        <span className="mono dim" style={{ fontSize: 11 }}>papéis salvam ao clicar · senha troca em Ajustes do usuário (ou peça pro admin resetar)</span>
      </div>
    </div>
  );
}

// Metas do time saíram daqui: viraram a ferramenta dedicada (tela Metas), que
// cobre todas as métricas por vaga + ajuste por pessoa. Ver screens/metas.jsx.

// Seletor compacto de telas permitidas: botão-resumo ("todas" / "N telas") com
// popover de checkboxes (espelho do NAV). Nenhuma marcada = todas as telas. O
// menu do usuário e o guard das rotas na API seguem essa lista.
function ScreensPicker({ screens, onChange }) {
  const [open, setOpen] = useStS(false);
  const ref = React.useRef(null);
  React.useEffect(() => {
    function onDoc(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);
  const toggle = (id) => onChange(screens.includes(id) ? screens.filter((s) => s !== id) : [...screens, id]);
  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button onClick={() => setOpen((o) => !o)}
        style={{ ...inputStyle, height: 26, fontSize: 12, textAlign: "left", cursor: "pointer", border: "1px solid " + (open ? "var(--accent-line)" : "var(--line-1)") }}>
        {screens.length ? `${screens.length} tela${screens.length > 1 ? "s" : ""}` : "todas"}
      </button>
      {open && (
        <div style={{ position: "absolute", top: "calc(100% + 4px)", right: 0, width: 200, zIndex: 60, background: "var(--bg-1)", border: "1px solid var(--line-2)", borderRadius: "var(--r-3)", boxShadow: "var(--shadow-pop)", padding: 8 }}>
          {NAV.map((n) => (
            <label key={n.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px", fontSize: 12.5, cursor: "pointer" }}>
              <input type="checkbox" checked={screens.includes(n.id)} onChange={() => toggle(n.id)} style={{ accentColor: "var(--accent)" }} />
              {n.label}
            </label>
          ))}
          <button onClick={() => onChange([])} className="mono dim" style={{ fontSize: 10.5, padding: 4 }}>limpar (todas as telas)</button>
        </div>
      )}
    </div>
  );
}


// ───────────────────────────────────────────────────────── Campos custom
// product.customFields.{deals|customers|leads} — cada campo vira input no
// formulário daquela entidade (EntityForm) quando o registro é deste SaaS.
const FIELD_GROUPS = [
  ["deals", "Deal"],
  ["customers", "Cliente"],
  ["leads", "Lead / Contato"],
];
const FIELD_TYPES = [
  ["text", "texto"], ["textarea", "texto longo"], ["number", "número"],
  ["money", "R$"], ["select", "escolha única"],
];

function FieldsSettings({ s }) {
  const { refresh } = useData();
  const [cf, setCf] = useStS(() => {
    const base = s.customFields || {};
    return Object.fromEntries(FIELD_GROUPS.map(([k]) => [k, (base[k] || []).map(f => ({ ...f, options: (f.options || []).map(o => (typeof o === "string" ? o : o.value)).join(", ") }))]));
  });

  const update = (g, i, patch) => setCf(c => ({ ...c, [g]: c[g].map((f, j) => j === i ? { ...f, ...patch } : f) }));
  const add = (g) => setCf(c => ({ ...c, [g]: [...c[g], { key: "", label: "", type: "text", options: "" }] }));
  const remove = (g, i) => setCf(c => ({ ...c, [g]: c[g].filter((_, j) => j !== i) }));

  async function save() {
    const customFields = Object.fromEntries(FIELD_GROUPS.map(([g]) => [g,
      cf[g].filter(f => String(f.label || "").trim()).map(f => {
        const out = { key: f.key || slug(f.label), label: f.label.trim(), type: f.type || "text" };
        if (f.type === "select") out.options = String(f.options || "").split(",").map(o => o.trim()).filter(Boolean);
        return out;
      }),
    ]));
    await api.update("products", s.id, { customFields });
    await refresh();
  }

  return (
    <div>
      <SettingHeader title="Campos custom" sub="aparecem no formulário de criar/editar a entidade quando o registro é deste SaaS · a chave é gravada no registro" />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: 14 }}>
        {FIELD_GROUPS.map(([g, label]) => (
          <div key={g} style={{ border: "1px solid var(--line-1)", borderRadius: "var(--r-3)", background: "var(--bg-1)", padding: "14px 16px" }}>
            <div style={{ fontSize: 12, fontWeight: 500, color: "var(--fg-2)", marginBottom: 10 }}>{label}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {cf[g].map((f, i) => (
                <div key={i} style={{ border: "1px solid var(--line-1)", borderRadius: "var(--r-2)", background: "var(--bg-2)", padding: 8, display: "flex", flexDirection: "column", gap: 6 }}>
                  <div style={{ display: "flex", gap: 6 }}>
                    <input value={f.label || ""} placeholder="Rótulo" onChange={(e) => update(g, i, { label: e.target.value, key: f.key || slug(e.target.value) })} style={{ ...inputStyle, flex: 1 }} />
                    <button type="button" onClick={() => remove(g, i)} className="mono dim" style={{ fontSize: 13 }}>✕</button>
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <input value={f.key || ""} placeholder="chave" onChange={(e) => update(g, i, { key: slug(e.target.value) })} className="mono" style={{ ...inputStyle, width: 110, fontFamily: "var(--mono)", fontSize: 11 }} />
                    <select value={f.type || "text"} onChange={(e) => update(g, i, { type: e.target.value })} style={{ ...inputStyle, flex: 1 }}>
                      {FIELD_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                  </div>
                  {f.type === "select" && (
                    <input value={f.options || ""} placeholder="opções separadas por vírgula" onChange={(e) => update(g, i, { options: e.target.value })} style={inputStyle} />
                  )}
                </div>
              ))}
              <button type="button" onClick={() => add(g)} style={{ alignSelf: "flex-start", padding: "4px 8px", background: "var(--bg-2)", border: "1px solid var(--line-1)", borderRadius: "var(--r-2)", fontSize: 11, fontFamily: "var(--mono)", color: "var(--fg-2)" }}>+ campo</button>
            </div>
          </div>
        ))}
      </div>
      <SaveBar onSave={save} />
    </div>
  );
}

// ───────────────────────────────────────────────────────── Integrações
// Status real — nada fake. Tokens vivem no env do servidor; o que é POR SAAS
// (conta de anúncio da Meta) é editado aqui e gravado no produto.
// Conexão Google PESSOAL: cada usuário conecta a PRÓPRIA conta pra que suas
// calls (como closer) e integrações (como integrador) apareçam na agenda dele.
// Convive com a conta única do time (Google Meet, acima) — é aditivo.
function MyGoogleCalendarCard() {
  const [st, setSt] = useStS(null); // { configured, connected, account }
  const [busy, setBusy] = useStS(false);
  const load = React.useCallback(async () => {
    try { setSt(await api.googleUserStatus()); }
    catch { setSt({ configured: false, connected: false, account: "" }); }
  }, []);
  React.useEffect(() => { load(); }, [load]);

  async function connect() {
    try {
      const r = await api.googleUserAuthUrl();
      window.open(r.url, "_blank", "noopener,width=520,height=680");
      // A conexão acontece na aba nova; ao voltar o foco pro cockpit, re-checa.
      const iv = setInterval(load, 2500);
      const stop = () => { clearInterval(iv); load(); window.removeEventListener("focus", stop); };
      window.addEventListener("focus", stop);
      setTimeout(() => clearInterval(iv), 120_000);
    } catch (e) { window.alert(e.message || "Google não configurado no servidor."); }
  }
  async function disconnect() {
    if (!window.confirm("Desconectar sua conta Google? Suas calls e integrações deixam de aparecer na sua agenda.")) return;
    setBusy(true);
    try { await api.googleUserDisconnect(); await load(); } finally { setBusy(false); }
  }

  const connected = !!st?.connected;
  const configured = !!st?.configured;
  return (
    <div style={{ padding: "14px 16px", border: connected ? "1px solid var(--line-1)" : "1px dashed var(--line-2)", borderRadius: "var(--r-3)", background: "var(--bg-1)", marginBottom: 10, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
      <div>
        <div style={{ fontSize: 13, fontWeight: 500 }}>Minha agenda Google</div>
        <div className="mono dim" style={{ fontSize: 11, marginTop: 3 }}>
          suas calls (como closer) e integrações (como integrador) agendadas aparecem na SUA agenda pessoal do Google
        </div>
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        {connected && <span className="chip pos" style={{ height: 22 }}>conectada · {st.account || "sua conta"}</span>}
        {!connected && !configured && st && <span className="chip" style={{ height: 22 }}>indisponível no servidor</span>}
        {configured && (
          <button onClick={connect} style={{ ...chromeBtnStyleSmall, borderColor: "var(--accent-line)", color: "var(--accent)" }}>
            <span style={{ fontSize: 11 }}>{connected ? "reconectar" : "Conectar minha conta"}</span>
          </button>
        )}
        {connected && (
          <button onClick={disconnect} disabled={busy} style={chromeBtnStyleSmall}>
            <span style={{ fontSize: 11 }}>{busy ? "…" : "desconectar"}</span>
          </button>
        )}
      </div>
    </div>
  );
}

function IntegrationsSettings({ s }) {
  const { refresh } = useData();
  const mpOn = !!window.SEED?.CONFIG?.mp?.configured;
  const metaOn = !!window.SEED?.CONFIG?.meta?.configured;
  const [adAccount, setAdAccount] = useStS(s.metaAdAccount || "");
  // Pixel POR SAAS: dispara na página pública do form (/f/:id) e no CAPI
  // server-side. Independe do META_ACCESS_TOKEN (que é só Marketing API).
  const [pixelId, setPixelId] = useStS(s.metaPixelId || "");

  async function saveMeta() {
    await api.update("products", s.id, { metaAdAccount: adAccount.trim(), metaPixelId: pixelId.replace(/\D/g, "") });
    await refresh();
  }

  // WhatsApp POR SAAS: cada produto conversa pelo SEU número (Cloud API). O
  // token é global (env); o phone number id vive aqui. Produto sem id não fala
  // pelo número de outro — o inbox avisa em vez de sair pelo número errado.
  const waOn = !!window.SEED?.CONFIG?.whatsapp?.configured;
  const [waPhoneId, setWaPhoneId] = useStS(s.waPhoneId || "");
  // Fluxo de permissão de ligação: 1º contato de um lead novo no inbox responde
  // sozinho pedindo a permissão NATIVA de chamada; a resposta do lead salta
  // como pop-up pro SDR. DUAS saudações pelo relógio do time (seg a sex, no
  // horário configurado): dentro pede pra ligar agora; fora avisa quando o
  // time volta ({volta}) e pede a autorização pra esse retorno. Exige "Allow
  // voice calls" ligado no número (WhatsApp Manager → Call settings).
  const [cfOn, setCfOn] = useStS(!!s.waCallFlow?.enabled);
  const [cfGreeting, setCfGreeting] = useStS(s.waCallFlow?.greeting || "");
  const [cfAfter, setCfAfter] = useStS(s.waCallFlow?.afterHours || "");
  const [cfStart, setCfStart] = useStS(s.waCallFlow?.hourStart ?? 8);
  const [cfEnd, setCfEnd] = useStS(s.waCallFlow?.hourEnd ?? 18);
  // Painel de variáveis das saudações: clique insere no campo que estava em
  // edição, na posição do cursor (o textarea guarda a seleção mesmo no blur).
  const [cfVars, setCfVars] = useStS(false);
  const cfGreetRef = React.useRef(null);
  const cfAfterRef = React.useRef(null);
  const cfLastField = React.useRef("greeting");
  const CF_VARS = [
    { t: "{nome}", d: "primeiro nome do lead (some se não tiver)" },
    { t: "{empresa}", d: "empresa do lead (some se não tiver)" },
    { t: "{produto}", d: `nome do produto (${s.name})` },
    { t: "{volta}", d: "quando o time volta: \"hoje às 8h\" / \"amanhã às 8h\" / \"segunda às 8h\" (pro texto de fora do horário)" },
  ];
  function cfInsertVar(tok) {
    const after = cfLastField.current === "after";
    const el = (after ? cfAfterRef : cfGreetRef).current;
    const val = after ? cfAfter : cfGreeting;
    const set = after ? setCfAfter : setCfGreeting;
    const start = el?.selectionStart ?? val.length;
    const end = el?.selectionEnd ?? val.length;
    set(val.slice(0, start) + tok + val.slice(end));
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(start + tok.length, start + tok.length); });
  }
  async function saveWa() {
    const hour = (v, fb) => { const n = Number(v); return Number.isFinite(n) && n >= 0 && n < 24 ? n : fb; };
    await api.update("products", s.id, {
      waPhoneId: waPhoneId.replace(/\D/g, ""),
      waCallFlow: {
        enabled: !!cfOn,
        greeting: cfGreeting.trim(),
        afterHours: cfAfter.trim(),
        hourStart: hour(cfStart, 8),
        hourEnd: hour(cfEnd, 18),
      },
    });
    await refresh();
  }

  const g = window.SEED?.CONFIG?.google || {};
  async function connectGoogle() {
    try {
      const r = await api.googleAuthUrl();
      window.open(r.url, "_blank", "noopener");
    } catch (e) { window.alert(e.message || "Configure GOOGLE_CLIENT_ID/SECRET no servidor primeiro."); }
  }

  const items = [
    { k: "Mercado Pago", desc: "assinaturas (preapproval) + baixa automática de fatura via webhook", on: mpOn, off: "configurar MERCADOPAGO_ACCESS_TOKEN" },
    { k: "E-mail", desc: "envio de proposta + notificações (Resend/SMTP)", on: false, off: "em breve" },
    { k: "Webhook", desc: "POST em eventos: lead novo, proposta vista/aceita", on: false, off: "em breve" },
  ];
  return (
    <div>
      <SettingHeader title="Integrações" sub="tokens vivem no env do servidor · a conta de anúncio da Meta é por SaaS (abaixo)" />

      {/* Meta Ads: status global + ad account deste SaaS */}
      <div style={{ padding: "14px 16px", border: metaOn ? "1px solid var(--line-1)" : "1px dashed var(--line-2)", borderRadius: "var(--r-3)", background: "var(--bg-1)", marginBottom: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 500 }}>Meta Ads</div>
            <div className="mono dim" style={{ fontSize: 11, marginTop: 3 }}>insights de campanha → tela Marketing (CPL, custo por estágio)</div>
          </div>
          <span className={"chip " + (metaOn ? "pos" : "")} style={{ height: 22 }}>{metaOn ? "conectado" : "configurar META_ACCESS_TOKEN"}</span>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 12, flexWrap: "wrap" }}>
          {metaOn && (
            <>
              <span className="mono" style={{ fontSize: 10, color: "var(--fg-4)", letterSpacing: "0.06em", textTransform: "uppercase", whiteSpace: "nowrap" }}>ad account de {s.name}</span>
              <input value={adAccount} placeholder="act_1234567890" onChange={(e) => setAdAccount(e.target.value)} className="mono" style={{ ...inputStyle, width: 220, fontFamily: "var(--mono)" }} />
            </>
          )}
          <span className="mono" title="Pixel disparado na página pública do form deste SaaS (/f/:id) e no CAPI. Vazio = pixel padrão do env."
            style={{ fontSize: 10, color: "var(--fg-4)", letterSpacing: "0.06em", textTransform: "uppercase", whiteSpace: "nowrap" }}>pixel de {s.name}</span>
          <input value={pixelId} placeholder="971201888623790" onChange={(e) => setPixelId(e.target.value)} className="mono" style={{ ...inputStyle, width: 170, fontFamily: "var(--mono)" }} />
          <CardSaveButton onSave={saveMeta} />
        </div>
      </div>

      {/* WhatsApp Cloud API: token global no env; o NÚMERO é por SaaS. */}
      <div style={{ padding: "14px 16px", border: waOn ? "1px solid var(--line-1)" : "1px dashed var(--line-2)", borderRadius: "var(--r-3)", background: "var(--bg-1)", marginBottom: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 500 }}>WhatsApp</div>
            <div className="mono dim" style={{ fontSize: 11, marginTop: 3 }}>inbox + envio pela Cloud API · cada SaaS conversa pelo SEU número (sem número, o envio bloqueia em vez de sair pelo número de outro produto)</div>
          </div>
          <span className={"chip " + (waOn ? "pos" : "")} style={{ height: 22 }}>{waOn ? "conectado" : "configurar WHATSAPP_TOKEN"}</span>
        </div>
        {waOn && (
          <>
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 12, flexWrap: "wrap" }}>
              <span className="mono" title="Phone number ID do número deste SaaS (WhatsApp Manager → API Setup, é o id do NÚMERO, não o da conta). O número precisa estar no mesmo WABA do token."
                style={{ fontSize: 10, color: "var(--fg-4)", letterSpacing: "0.06em", textTransform: "uppercase", whiteSpace: "nowrap" }}>número de {s.name}</span>
              <input value={waPhoneId} placeholder="712249848640591" onChange={(e) => setWaPhoneId(e.target.value)} className="mono" style={{ ...inputStyle, width: 200, fontFamily: "var(--mono)" }} />
            </div>
            {/* Fluxo de ligação: pedido automático de permissão no 1º contato. */}
            <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px dashed var(--line-2)" }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                <input type="checkbox" checked={cfOn} onChange={(e) => setCfOn(e.target.checked)} />
                Fluxo de ligação no 1º contato
              </label>
              <div className="mono dim" style={{ fontSize: 11, marginTop: 4, lineHeight: 1.5 }}>
                a primeira mensagem de um lead novo (ex.: vindo do formulário) recebe sozinha o pedido NATIVO de permissão de ligação · a resposta do lead salta como pop-up pro SDR · precisa do "Allow voice calls" ligado no número (WhatsApp Manager → Call settings)
              </div>
              {cfOn && (
                <>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10, flexWrap: "wrap" }}>
                    <span className="mono" style={{ fontSize: 10, color: "var(--fg-4)", letterSpacing: "0.06em", textTransform: "uppercase" }}>horário do time · seg a sex, das</span>
                    <input type="number" min={0} max={23} value={cfStart} onChange={(e) => setCfStart(e.target.value)} className="mono" style={{ ...inputStyle, width: 58, fontFamily: "var(--mono)" }} />
                    <span className="mono" style={{ fontSize: 10, color: "var(--fg-4)", letterSpacing: "0.06em", textTransform: "uppercase" }}>às</span>
                    <input type="number" min={1} max={24} value={cfEnd} onChange={(e) => setCfEnd(e.target.value)} className="mono" style={{ ...inputStyle, width: 58, fontFamily: "var(--mono)" }} />
                    <span className="mono dim" style={{ fontSize: 10 }}>fim de semana conta como fora do horário</span>
                  </div>
                  <div className="mono" style={{ fontSize: 10, color: "var(--fg-4)", letterSpacing: "0.06em", textTransform: "uppercase", marginTop: 10 }}>dentro do horário (pede pra ligar agora)</div>
                  <textarea ref={cfGreetRef} value={cfGreeting} onChange={(e) => setCfGreeting(e.target.value)} rows={2}
                    onFocus={() => { cfLastField.current = "greeting"; }}
                    placeholder={'Olá {nome}! Recebi seu formulário aqui. Posso te ligar pra uma breve conversa sobre a plataforma?'}
                    style={{ ...inputStyle, width: "100%", height: "auto", minHeight: 52, marginTop: 6, padding: "8px 12px", fontSize: 12.5, lineHeight: 1.45, resize: "vertical", fontFamily: "inherit" }} />
                  <div className="mono" style={{ fontSize: 10, color: "var(--fg-4)", letterSpacing: "0.06em", textTransform: "uppercase", marginTop: 10 }}>fora do horário (avisa quando volta e já pede a autorização)</div>
                  <textarea ref={cfAfterRef} value={cfAfter} onChange={(e) => setCfAfter(e.target.value)} rows={2}
                    onFocus={() => { cfLastField.current = "after"; }}
                    placeholder={'Olá {nome}! Recebi seu formulário aqui. Nosso time está fora do horário agora, mas volta {volta}. Posso te ligar quando voltarmos pra falar sobre a plataforma? Já deixa a autorização aqui embaixo.'}
                    style={{ ...inputStyle, width: "100%", height: "auto", minHeight: 52, marginTop: 6, padding: "8px 12px", fontSize: 12.5, lineHeight: 1.45, resize: "vertical", fontFamily: "inherit" }} />
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                    <button onClick={() => setCfVars((v) => !v)} className="mono"
                      style={{ height: 24, padding: "0 10px", borderRadius: 999, border: "1px solid var(--line-2)", background: cfVars ? "var(--accent-soft)" : "var(--bg-1)", color: cfVars ? "var(--accent)" : "var(--fg-3)", fontSize: 10.5, fontWeight: 700, cursor: "pointer" }}>
                      {"{ }"} variáveis
                    </button>
                    <span className="mono dim" style={{ fontSize: 10 }}>texto vazio usa o padrão</span>
                  </div>
                  {cfVars && (
                    <div style={{ marginTop: 8, padding: "10px 12px", border: "1px solid var(--line-1)", borderRadius: "var(--r-2)", background: "var(--bg-2)", display: "flex", flexDirection: "column", gap: 6 }}>
                      {CF_VARS.map((v) => (
                        <div key={v.t} style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                          <button onClick={() => cfInsertVar(v.t)} className="mono" title="clique pra inserir no texto, na posição do cursor"
                            style={{ flexShrink: 0, padding: "2px 8px", borderRadius: "var(--r-2)", border: "1px solid var(--line-2)", background: "var(--bg-1)", color: "var(--accent)", fontSize: 11.5, fontWeight: 700, cursor: "pointer" }}>
                            {v.t}
                          </button>
                          <span style={{ fontSize: 11.5, color: "var(--fg-2)", lineHeight: 1.45 }}>{v.d}</span>
                        </div>
                      ))}
                      <span className="mono dim" style={{ fontSize: 10, marginTop: 2 }}>clique numa variável pra inserir no campo que você estava editando</span>
                    </div>
                  )}
                </>
              )}
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 10 }}>
              <CardSaveButton onSave={saveWa} />
            </div>
          </>
        )}
      </div>

      {/* Google Meet: calls criadas direto na agenda da conta conectada. */}
      <div style={{ padding: "14px 16px", border: g.connected ? "1px solid var(--line-1)" : "1px dashed var(--line-2)", borderRadius: "var(--r-3)", background: "var(--bg-1)", marginBottom: 10, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 500 }}>Google Meet</div>
          <div className="mono dim" style={{ fontSize: 11, marginTop: 3 }}>
            call do lead criada direto na agenda Google (com Meet e convite por e-mail)
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {g.connected && <span className="chip pos" style={{ height: 22 }}>conectado · {g.account || "conta do time"}</span>}
          {!g.connected && !g.configured && <span className="chip" style={{ height: 22 }}>configurar GOOGLE_CLIENT_ID/SECRET</span>}
          {g.configured && (
            <button onClick={connectGoogle} style={{ ...chromeBtnStyleSmall, borderColor: "var(--accent-line)", color: "var(--accent)" }}>
              <span style={{ fontSize: 11 }}>{g.connected ? "reconectar" : "Conectar Google"}</span>
            </button>
          )}
        </div>
      </div>

      <MyGoogleCalendarCard />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 10 }}>
        {items.map(i => (
          <div key={i.k} style={{ padding: "14px 16px", border: i.on ? "1px solid var(--line-1)" : "1px dashed var(--line-2)", borderRadius: "var(--r-3)", background: "var(--bg-1)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 500 }}>{i.k}</div>
              <div className="mono dim" style={{ fontSize: 11, marginTop: 3 }}>{i.desc}</div>
            </div>
            <span className={"chip " + (i.on ? "pos" : "")} style={{ height: 22 }}>{i.on ? "conectado" : i.off}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────── Scripts & cadências
// Todos os roteiros do processo (lib/scripts.js) num lugar só, com a cadência de
// contato de cada estágio ao lado. Editar o roteiro grava um override em
// product.scripts[chave] (substitui só o passo a passo; a postura/objetivo e as
// dicas seguem do padrão). Editar a cadência grava no funil (mesmo endpoint do
// Funil, sem renomear nada). Campo vazio volta pro padrão do código.
function CadBox({ val, onChange, unit, title }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }} title={title}>
      <input type="number" min="0" value={val} onChange={(e) => onChange(e.target.value)}
        style={{ ...inputStyle, width: 40, padding: "0 4px", textAlign: "right", height: 24 }} />
      <span className="mono dim" style={{ fontSize: 9.5 }}>{unit}</span>
    </span>
  );
}

// Estrutura editável de um roteiro a partir do padrão (DEFAULT_SCRIPTS).
function defScriptStruct(key) {
  const d = DEFAULT_SCRIPTS[key] || {};
  return {
    resumo: d.resumo || "",
    objetivo: d.objetivo || "",
    passos: (d.passos || []).map((p) => ({ t: p.t || "", fala: p.fala || "", dica: p.dica || "" })),
  };
}

// Lead fictício pra pré-visualizar um roteiro no popup das Minhas atividades:
// preenche os campos que os {{tokens}} usam (nome, empresa, nicho, contas,
// anúncios…) com dados de exemplo, puxando as opções reais do formulário do
// produto quando existem. Id fixo e nunca persistido — é só visualização.
function samplePreviewLead(s) {
  const q = Object.fromEntries((s.leadQuestions || []).map((x) => [x.key, x]));
  const opt = (key) => q[key]?.options?.[0]?.value ?? "";
  const call = new Date(); call.setDate(call.getDate() + 1); call.setHours(10, 0, 0, 0);
  return {
    id: "__preview__", saas: s.id,
    name: "Maria Souza", company: "Loja Encanto", phone: "5541999990000", email: "maria@lojaencanto.com.br",
    niche: opt("niche") || "Casa & Decoração",
    accounts: opt("accounts"), listings: opt("listings"), plan_expand: opt("plan_expand"), staff: opt("staff"),
    score: 72, icp: 0.82, value: "", amount: 0, source: "Form", priority: "P1",
    closer: usersByRole("closer")[0]?.id || "",
    callAt: call.toISOString(), stageAttempts: 0,
  };
}

// Etapa de exemplo pra cada roteiro do catálogo (define chip/kind/fase do popup):
// a etapa real do funil quando existe, senão um nome que o guessKind reconhece.
const PREVIEW_STAGE_FALLBACK = {
  novo: "Novo lead", qualificacao2: "Qualificando", qualificacao3: "Qualificando",
  confirmacao: "Call agendada", noshow1: "No show", noshow2: "No show",
  nutricao1: "Nutrição", nutricao2: "Nutrição", nutricao3: "Nutrição",
  call: "Call agendada", proposta: "Proposta",
  followup1: "Follow-up", followup2: "Follow-up", followup3: "Follow-up",
  integracao: "Integração", posvenda: "Pós-venda",
};
function buildPreviewItem(s, catItem) {
  const stage = catItem.key === "confirmacao"
    ? (stageByKind(s, "call") || PREVIEW_STAGE_FALLBACK.confirmacao)
    : (catalogStageRow(s, catItem)?.stage
       || (catItem.stageKind && stageByKind(s, catItem.stageKind))
       || PREVIEW_STAGE_FALLBACK[catItem.key] || catItem.label);
  const kind = stageKind(s, stage);
  return { l: { ...samplePreviewLead(s), stage }, kind, phase: phaseOf(kind), stage, who: "", due: null, done: false, group: "novo", confirm: false };
}

function ScriptsSettings({ s }) {
  const { refresh } = useData();
  // drafts[key] = override estruturado { resumo, objetivo, passos } — existe só
  // pras chaves que o usuário de fato editou (ou que já vinham personalizadas).
  const [drafts, setDrafts] = useStS(() => {
    const seed = {};
    for (const [k, v] of Object.entries(s.scripts || {})) if (v && typeof v === "object" && Array.isArray(v.passos)) seed[k] = v;
    return seed;
  });
  const [funnelDraft, setFunnelDraft] = useStS(() => (s.funnel || []).map((f) => ({ ...f })));
  const [openKey, setOpenKey] = useStS(null);
  const [previewKey, setPreviewKey] = useStS(null); // roteiro aberto no popup de pré-visualização
  const [aiBusy, setAiBusy] = useStS(null);         // chave sendo melhorada pela IA
  const [aiInfo, setAiInfo] = useStS({});           // key -> { diagnostico, objecoes, base }

  // Roteiro pronto pro popup de pré-visualização: mostra o RASCUNHO em edição
  // (view = override ou padrão), assim dá pra ver a fala do jeitinho que vai
  // ficar antes de salvar. Falls back pro padrão do código quando algo faltar.
  const previewScriptFor = (key) => {
    const base = DEFAULT_SCRIPTS[key] || DEFAULT_SCRIPTS.outro;
    const v = view(key);
    return {
      ...base,
      resumo: v.resumo || base.resumo,
      objetivo: v.objetivo || base.objetivo,
      passos: (v.passos && v.passos.length) ? v.passos : base.passos,
      custom: isCustom(key),
    };
  };

  // índice no funnelDraft do estágio de um item do catálogo (cadência).
  const stageIdxOf = (item) => {
    const row = catalogStageRow(s, item);
    return row ? funnelDraft.findIndex((f) => f.stage === row.stage) : -1;
  };
  // Só o 1º roteiro de cada estágio mostra a cadência (evita repetir 3x).
  const cadenceOwner = {};
  for (const item of SCRIPT_CATALOG) {
    const idx = stageIdxOf(item);
    if (idx >= 0 && cadenceOwner[idx] == null) cadenceOwner[idx] = item.key;
  }
  const cadVal = (idx, k) => (idx >= 0 && funnelDraft[idx].cadence && funnelDraft[idx].cadence[k] != null ? funnelDraft[idx].cadence[k] : "");
  const setCad = (idx, k, v) => setFunnelDraft((rows) => rows.map((f, j) => j === idx
    ? { ...f, cadence: { ...(f.cadence || {}), [k]: v === "" ? undefined : Number(v) } } : f));

  // Leitura/edição do roteiro: mostra o override se existir, senão o padrão.
  const view = (key) => {
    const o = drafts[key];
    return (o && typeof o === "object" && Array.isArray(o.passos)) ? o : defScriptStruct(key);
  };
  const isCustom = (key) => drafts[key] != null;
  // Materializa o draft (a partir do que está na tela) e aplica a mutação.
  const mutate = (key, fn) => setDrafts((d) => {
    const o = d[key];
    const cur = (o && typeof o === "object" && Array.isArray(o.passos)) ? o : defScriptStruct(key);
    const clone = { resumo: cur.resumo, objetivo: cur.objetivo, passos: cur.passos.map((p) => ({ ...p })) };
    return { ...d, [key]: fn(clone) };
  });
  const setField = (key, field, val) => mutate(key, (x) => { x[field] = val; return x; });
  const setPasso = (key, i, field, val) => mutate(key, (x) => { x.passos = x.passos.map((p, j) => j === i ? { ...p, [field]: val } : p); return x; });
  const addPasso = (key) => mutate(key, (x) => { x.passos = [...x.passos, { t: "", fala: "", dica: "" }]; return x; });
  const removePasso = (key, i) => mutate(key, (x) => { x.passos = x.passos.filter((_, j) => j !== i); return x; });
  const movePasso = (key, i, dir) => mutate(key, (x) => {
    const j = i + dir; if (j < 0 || j >= x.passos.length) return x;
    const n = [...x.passos]; [n[i], n[j]] = [n[j], n[i]]; x.passos = n; return x;
  });
  const resetScript = (key) => setDrafts((d) => { const n = { ...d }; delete n[key]; return n; });

  // "IA das calls": manda o roteiro atual + o padrão das últimas calls do
  // produto pro servidor, recebe uma versão melhorada e joga no rascunho (o
  // usuário revisa e salva com "Salvar e replicar"). Não grava sozinho.
  async function improveWithCalls(key) {
    const label = SCRIPT_CATALOG.find((c) => c.key === key)?.label || key;
    const cur = view(key);
    setAiBusy(key);
    try {
      const r = await api.improvePitch(s.id, {
        scriptKey: key, scriptLabel: label,
        currentScript: { resumo: cur.resumo, objetivo: cur.objetivo, passos: cur.passos },
      });
      const sg = r?.sugestao;
      if (sg) {
        setDrafts((d) => ({ ...d, [key]: {
          resumo: String(sg.resumo || cur.resumo || ""),
          objetivo: String(sg.objetivo || cur.objetivo || ""),
          passos: (Array.isArray(sg.passos) && sg.passos.length)
            ? sg.passos.map((p) => ({ t: String(p.t || ""), fala: String(p.fala || ""), dica: String(p.dica || "") }))
            : cur.passos,
        } }));
        setAiInfo((m) => ({ ...m, [key]: { diagnostico: r.diagnostico || "", objecoes: r.objecoesRecorrentes || [], base: r.base || 0 } }));
        setOpenKey(key);
      }
    } catch (e) {
      alert(e?.status === 422
        ? "Ainda não há calls resumidas por IA neste produto pra analisar. As calls agendadas pelo cockpit viram resumo automático quando o Meet gera a transcrição."
        : `Não deu pra gerar a sugestão: ${e?.message || e}`);
    }
    setAiBusy(null);
  }

  async function save() {
    // 1) overrides de roteiro (só as chaves editadas; passos vazios saem)
    const clean = {};
    for (const [k, v] of Object.entries(drafts)) {
      if (!v || typeof v !== "object") continue;
      const passos = (v.passos || [])
        .map((p) => ({ t: String(p.t || "").trim(), fala: String(p.fala || "").trim(), dica: String(p.dica || "").trim() }))
        .filter((p) => p.t || p.fala)
        .map((p) => { const o = { t: p.t, fala: p.fala }; if (p.dica) o.dica = p.dica; return o; });
      clean[k] = { resumo: String(v.resumo || "").trim(), objetivo: String(v.objetivo || "").trim(), passos };
    }
    await api.update("products", s.id, { scripts: clean });
    // 2) cadências — grava o funil inteiro sem renomear (só a cadência muda)
    const funnel = funnelDraft.map((f) => {
      const cadence = {};
      for (const k of ["maxAttempts", "retryDays", "firstTouchHours"]) {
        const n = Number(f.cadence?.[k]);
        if (Number.isFinite(n) && n > 0) cadence[k] = n;
      }
      return { ...f, ...(Object.keys(cadence).length ? { cadence } : { cadence: undefined }) };
    });
    await api.saveFunnel(s.id, funnel, {});
    await refresh();
  }

  const phases = [...new Set(SCRIPT_CATALOG.map((c) => c.phase))];
  const miniLabel = { display: "block", fontSize: 10, color: "var(--fg-4)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 };
  const taStyle = { ...inputStyle, height: "auto", width: "100%", padding: "6px 8px", fontSize: 12.5, lineHeight: 1.5, fontFamily: "inherit", resize: "vertical" };

  return (
    <div>
      <SettingHeader title="Scripts & cadências" sub="todos os roteiros do processo num lugar só · edite as falas direto no passo a passo (é o roteiro pronto, é só alterar) · a cadência é a mesma do Funil" />
      {phases.map((phase) => (
        <div key={phase} style={{ marginBottom: 22 }}>
          <div className="mono" style={{ fontSize: 10.5, color: "var(--fg-4)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8 }}>{phase}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {SCRIPT_CATALOG.filter((c) => c.phase === phase).map((item) => {
              const idx = stageIdxOf(item);
              const showCad = idx >= 0 && cadenceOwner[idx] === item.key;
              const custom = isCustom(item.key);
              const open = openKey === item.key;
              const v = view(item.key);
              return (
                <div key={item.key} style={{ border: "1px solid var(--line-1)", borderRadius: "var(--r-3)", background: "var(--bg-1)", overflow: "hidden" }}>
                  <div style={{ padding: "10px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                    <div style={{ minWidth: 220, flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>
                        {item.label}
                        {custom && <span className="mono" style={{ fontSize: 10, color: "var(--accent)", marginLeft: 8 }}>editado</span>}
                      </div>
                      <div className="mono dim" style={{ fontSize: 11, marginTop: 2 }}>{v.resumo ? v.resumo.slice(0, 120) + (v.resumo.length > 120 ? "…" : "") : ""}</div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      {showCad ? (
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }} title="cadência de contato deste estágio (mesma do Funil)">
                          <span className="mono dim" style={{ fontSize: 10 }}>cadência</span>
                          <CadBox val={cadVal(idx, "maxAttempts")} onChange={(x) => setCad(idx, "maxAttempts", x)} unit="toques" title="toques máximos nesta etapa" />
                          <CadBox val={cadVal(idx, "retryDays")} onChange={(x) => setCad(idx, "retryDays", x)} unit="dias" title="toque registrado → próximo em N dias úteis" />
                          <CadBox val={cadVal(idx, "firstTouchHours")} onChange={(x) => setCad(idx, "firstTouchHours", x)} unit="h entrada" title="SLA/atraso do 1º contato em horas (ex.: Nutrição entra 168h = 7 dias depois)" />
                        </div>
                      ) : idx >= 0 ? (
                        <span className="mono dim" style={{ fontSize: 10 }}>cadência acima ↑</span>
                      ) : (
                        <span className="mono dim" style={{ fontSize: 10 }}>{item.key === "confirmacao" ? "janelas fixas: 1h e 10min antes" : "sem cadência de estágio"}</span>
                      )}
                      {item.phase === "Closer" && (
                        <button type="button" onClick={() => improveWithCalls(item.key)} disabled={aiBusy === item.key} className="mono"
                          title="Analisa os resumos das últimas calls e propõe uma versão melhor deste roteiro (você revisa e salva)"
                          style={{ fontSize: 11, color: "var(--accent)", opacity: aiBusy === item.key ? 0.6 : 1 }}>
                          {aiBusy === item.key ? "analisando calls…" : "✨ IA das calls"}
                        </button>
                      )}
                      <button type="button" onClick={() => setPreviewKey(item.key)} className="mono" style={{ fontSize: 11, color: "var(--fg-3)" }}
                        title="Ver como este roteiro aparece no popup das Minhas atividades (com dados de exemplo)">▶ pré-visualizar</button>
                      <button type="button" onClick={() => setOpenKey(open ? null : item.key)} className="mono" style={{ fontSize: 11, color: open ? "var(--accent)" : "var(--fg-3)" }}>{open ? "fechar" : "✎ editar"}</button>
                    </div>
                  </div>
                  {open && (
                    <div style={{ padding: "12px 14px 14px", borderTop: "1px solid var(--line-1)", background: "var(--bg-inset)" }}>
                      {aiInfo[item.key] && (
                        <div style={{ border: "1px solid var(--accent-line)", background: "var(--accent-soft)", borderRadius: "var(--r-2)", padding: "9px 11px", marginBottom: 12 }}>
                          <div className="mono" style={{ fontSize: 10, color: "var(--accent)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>✨ Sugestão da IA · {aiInfo[item.key].base} calls analisadas</div>
                          {aiInfo[item.key].diagnostico && <div style={{ fontSize: 12, lineHeight: 1.5, marginBottom: aiInfo[item.key].objecoes?.length ? 6 : 0 }}>{aiInfo[item.key].diagnostico}</div>}
                          {aiInfo[item.key].objecoes?.length > 0 && (
                            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                              {aiInfo[item.key].objecoes.map((o, oi) => (
                                <div key={oi} style={{ fontSize: 11.5, lineHeight: 1.45 }}><b>{o.objecao}</b>{o.frequencia ? ` (${o.frequencia})` : ""}: {o.comoTratarNoPitch}</div>
                              ))}
                            </div>
                          )}
                          <div className="mono dim" style={{ fontSize: 10, marginTop: 6 }}>revise os campos abaixo e clique em “Salvar e replicar” pra aplicar</div>
                        </div>
                      )}
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
                        <div>
                          <label style={miniLabel}>Postura (como se comportar)</label>
                          <textarea rows={3} value={v.resumo} onChange={(e) => setField(item.key, "resumo", e.target.value)} style={taStyle} />
                        </div>
                        <div>
                          <label style={miniLabel}>Objetivo</label>
                          <textarea rows={3} value={v.objetivo} onChange={(e) => setField(item.key, "objetivo", e.target.value)} style={taStyle} />
                        </div>
                      </div>
                      <label style={miniLabel}>Passo a passo · edite as falas direto</label>
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        {v.passos.map((p, k) => (
                          <div key={k} style={{ border: "1px solid var(--line-1)", borderRadius: "var(--r-2)", background: "var(--bg-1)", padding: 8 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5 }}>
                              <span className="mono dim tnum" style={{ fontSize: 11, width: 16 }}>{k + 1}.</span>
                              <input value={p.t} placeholder="Título do passo" onChange={(e) => setPasso(item.key, k, "t", e.target.value)} style={{ ...inputStyle, flex: 1, fontWeight: 600 }} />
                              <button type="button" onClick={() => movePasso(item.key, k, -1)} disabled={k === 0} className="mono" style={{ fontSize: 12, color: "var(--fg-4)", opacity: k === 0 ? 0.3 : 1 }}>↑</button>
                              <button type="button" onClick={() => movePasso(item.key, k, 1)} disabled={k === v.passos.length - 1} className="mono" style={{ fontSize: 12, color: "var(--fg-4)", opacity: k === v.passos.length - 1 ? 0.3 : 1 }}>↓</button>
                              <button type="button" onClick={() => removePasso(item.key, k)} className="mono dim" style={{ fontSize: 13 }}>✕</button>
                            </div>
                            <textarea rows={2} value={p.fala} placeholder="Fala pro cliente (passo só de ação pode ficar sem)" onChange={(e) => setPasso(item.key, k, "fala", e.target.value)} style={{ ...taStyle, marginBottom: 5 }} />
                            <input value={p.dica} placeholder="Dica interna (opcional, não é falada)" onChange={(e) => setPasso(item.key, k, "dica", e.target.value)} style={{ ...inputStyle, fontSize: 11.5, color: "var(--fg-3)" }} />
                          </div>
                        ))}
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 8, flexWrap: "wrap" }}>
                        <button type="button" onClick={() => addPasso(item.key)} style={{ ...chromeBtnStyleSmall }}><span style={{ fontSize: 11 }}>+ passo</span></button>
                        {custom && <button type="button" className="mono" onClick={() => resetScript(item.key)} style={{ fontSize: 10.5, color: "var(--neg)" }}>voltar ao padrão</button>}
                        <span className="mono dim" style={{ fontSize: 10.5 }}>{"tokens: {{nome}} {{eu}} {{produto}} {{nicho}} {{contas}} {{anuncios}} {{closer_responsavel}} {{hora_call}} {{link_call}}"}</span>
                      </div>
                      <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--line-1)" }}>
                        <SaveBar onSave={save} label="Salvar e replicar" busyLabel="Replicando…" hint="salva e aplica na hora pra quem estiver usando o cockpit (tempo real)" />
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
      <SaveBar onSave={save} label="Salvar e replicar" busyLabel="Replicando…" hint="salva tudo e aplica em tempo real pra quem estiver usando o cockpit · a cadência é compartilhada com a aba Funil" />

      {/* Pré-visualização: o MESMO popup das Minhas atividades, com um lead de
          exemplo e o roteiro que está sendo editado (mostra o rascunho, sem
          precisar salvar). Ações que gravam ficam desligadas no modo preview. */}
      {previewKey && (
        <ErrorBoundary variant="modal" label="pré-visualização" resetKey={previewKey} onReset={() => setPreviewKey(null)}>
          <ScriptPanel
            preview
            previewScript={previewScriptFor(previewKey)}
            item={buildPreviewItem(s, SCRIPT_CATALOG.find((c) => c.key === previewKey) || { key: previewKey })}
            saasCfg={s}
            leads={[]}
            onPatch={() => {}}
            onMove={() => {}}
            onMoveMeet={async () => ({ ok: true })}
            onAfter={() => {}}
            onTouch={() => {}}
            onOpenLead={() => {}}
            onClose={() => setPreviewKey(null)}
          />
        </ErrorBoundary>
      )}
    </div>
  );
}

function SettingHeader({ number, title, sub }) {
  return (
    <div style={{ marginBottom: number ? 0 : 14, display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
      {number && <span className="mono" style={{ fontSize: 11, fontWeight: 600, color: "var(--accent)" }}>{number}</span>}
      <h2 style={{ margin: 0, fontSize: number ? 15.5 : 16, fontWeight: 600, letterSpacing: "-.01em" }}>{title}</h2>
      {sub && <div className="dim" style={{ fontSize: number ? 12.5 : 12, color: "var(--fg-4)" }}>{sub}</div>}
    </div>
  );
}

export { SettingsScreen };
