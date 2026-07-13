import React from "react";
import { chromeBtnStyleSmall } from "../lib/ui.js";
import { EmptyState, PrimaryButton, RowActions, Avatar } from "../atoms.jsx";
import { useData } from "../data.jsx";
import { api } from "../lib/api.js";
import { useIsMobile } from "../lib/responsive.js";
import { KINDS, KIND_IDS, guessKind, lossReasonsOf, stageKind, stageByKind, phaseOf, NEXT_KINDS, NEXT_STEP_KINDS, NEXT_STEP_LABELS } from "../lib/funnel.js";
import { useActiveSaas } from "../lib/workspace.js";
import { DEFAULT_SCRIPTS, SCRIPT_CATALOG, catalogStageRow, isNoShowStage } from "../lib/scripts.js";
import { usersByRole } from "../lib/users.js";
import { ScriptPanel } from "./today.jsx";
import { ErrorBoundary } from "../components/error-boundary.jsx";
import { NAV } from "../chrome.jsx";
// SaaS Settings (fase 3) — funil, campos custom, pesos da saúde e Aha EDITÁVEIS
// por SaaS (gravam no produto). Equipe (roles sdr/closer/integrator) é global.

const { useState: useStS } = React;

// O App remonta a tela a cada refresh pós-save (key=dataVersion); guardar a
// última visão em módulo preserva a aba escolhida entre os remounts. O SaaS
// ativo vem do workspace global (seletor no pé da sidebar).
const lastView = { tab: "funnel" };

const inputStyle = {
  width: "100%", height: 28, padding: "0 8px",
  background: "var(--bg-2)", border: "1px solid var(--line-1)",
  borderRadius: "var(--r-2)", color: "var(--fg-1)", fontSize: 12, fontFamily: "var(--sans)",
};
const slug = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "")
  .toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);

function SettingsScreen({ saasId }) {
  const { SAAS } = window.SEED;
  const { openForm, openDelete } = useData();
  const [activeProduct] = useActiveSaas();
  // "health"/"aha" foram removidas; se sobrou salvo na sessão, cai no funil.
  const [tab, setTab] = useStS(lastView.tab === "health" || lastView.tab === "aha" ? "funnel" : lastView.tab);
  const isMobile = useIsMobile();
  lastView.tab = tab;
  const s = activeProduct;

  const TABS = [
    ["funnel",      "Funil & estágios"],
    ["nextsteps",   "Próximos passos"],
    ["scripts",     "Scripts"],
    ["team",        "Equipe"],
    ["fields",      "Campos custom"],
    ["integrations","Integrações"],
  ];

  if (!s) return (
    <EmptyState
      title="Nenhum SaaS para configurar"
      hint="Crie um produto e ele aparece aqui para configurar funil, campos e integrações."
      action={<PrimaryButton onClick={() => openForm("products")}>+ Criar SaaS</PrimaryButton>}
    />
  );

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
      <div style={{ padding: "12px var(--pad-x)", borderBottom: "1px solid var(--line-1)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <span style={{ fontSize: 13.5, fontWeight: 600 }}>{s?.name}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <RowActions onEdit={() => openForm("products", s)} onDelete={() => openDelete("products", s)} />
          <button onClick={() => openForm("products")} style={{ ...chromeBtnStyleSmall, borderColor: "var(--accent-line)", color: "var(--accent)" }}>
            <span style={{ fontSize: 11 }}>+ novo SaaS</span>
          </button>
        </div>
      </div>

      <div style={{ flex: 1, display: "grid", gridTemplateColumns: isMobile ? "1fr" : "200px 1fr", gridTemplateRows: isMobile ? "auto minmax(0, 1fr)" : undefined, minHeight: 0 }}>
        <nav style={isMobile
          ? { display: "flex", gap: 4, overflowX: "auto", borderBottom: "1px solid var(--line-1)", padding: "8px 12px", background: "var(--bg-1)" }
          : { borderRight: "1px solid var(--line-1)", padding: 12, background: "var(--bg-1)" }}>
          {TABS.map(([k,l]) => (
            <button key={k} onClick={() => setTab(k)} style={{
              display: "block", width: isMobile ? "auto" : "100%", padding: "8px 10px",
              borderRadius: "var(--r-2)", marginBottom: isMobile ? 0 : 2,
              whiteSpace: "nowrap", flexShrink: 0,
              background: tab === k ? "var(--bg-3)" : "transparent",
              color: tab === k ? "var(--fg-1)" : "var(--fg-3)",
              fontSize: 12, textAlign: "left",
            }}>{l}</button>
          ))}
        </nav>
        <div style={{ overflow: "auto", padding: "20px var(--pad-x)" }}>
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
      if (!mounted.current) return;
      setBusy(false); setDone(true);
      setTimeout(() => { if (mounted.current) setDone(false); }, 2500);
    } catch (e) {
      if (mounted.current) { setBusy(false); setError(e.message || String(e)); }
    }
  }
  return (
    <div style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 10 }}>
      <PrimaryButton onClick={go} disabled={busy || disabled}>{busy ? busyLabel : done ? "Salvo ✓" : label}</PrimaryButton>
      {hint && <span className="mono dim" style={{ fontSize: 11 }}>{hint}</span>}
      {error && <span className="mono" style={{ fontSize: 11, color: "var(--neg)" }}>{error}</span>}
    </div>
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
  const [scriptOpen, setScriptOpen] = useStS(null); // índice da linha com o editor de roteiro aberto

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
  const cadInput = (i, f, k, ph, title) => (
    <input type="number" min="0" value={cad(f, k)} placeholder={ph} title={title}
      onChange={(e) => setCad(i, k, e.target.value)}
      style={{ ...inputStyle, width: 42, padding: "0 4px", textAlign: "right" }} />
  );

  return (
    <div>
      <SettingHeader title="Estágios do funil" sub="renomear migra os cards junto · TIPO define o comportamento (fase SDR/Closer, ganho/perda, gates) · cadência alimenta os dots e o GPS" />
      <div className="tbl-x" style={{ border: "1px solid var(--line-1)", borderRadius: "var(--r-3)", background: "var(--bg-1)" }}>
        <div className="mono" style={{ display: "grid", gridTemplateColumns: "52px 1fr 128px 62px 76px 100px 176px 56px", gap: 8, padding: "10px 14px", background: "var(--bg-inset)", fontSize: 10, color: "var(--fg-4)", letterSpacing: "0.06em", textTransform: "uppercase", borderBottom: "1px solid var(--line-1)" }}>
          <span></span><span>Estágio</span><span>Tipo</span><span>Cor</span><span>Conv.</span><span>Auto-regra</span><span title="toques máx. · re-toque (dias) · SLA 1º toque (horas)">Cadência (n · d · h)</span><span></span>
        </div>
        {rows.map((f, i) => (
          <React.Fragment key={i}>
          <div style={{ display: "grid", gridTemplateColumns: "52px 1fr 128px 62px 76px 100px 176px 56px", gap: 8, padding: "8px 14px", borderBottom: "1px solid var(--line-1)", alignItems: "center" }}>
            <span style={{ display: "flex" }}>
              <button type="button" onClick={() => move(i, -1)} disabled={i === 0} style={arrowStyle(i === 0)}>↑</button>
              <button type="button" onClick={() => move(i, 1)} disabled={i === rows.length - 1} style={arrowStyle(i === rows.length - 1)}>↓</button>
            </span>
            <input value={f.stage || ""} placeholder="Nome do estágio" onChange={(e) => update(i, { stage: e.target.value })} style={inputStyle} />
            <select value={KIND_IDS.includes(f.kind) ? f.kind : guessKind(f.stage, i)}
              onChange={(e) => update(i, { kind: e.target.value })}
              title="Semântica do estágio — o app decide comportamento por aqui, não pelo nome"
              style={{ ...inputStyle, padding: "0 4px" }}>
              {KIND_IDS.map((k) => <option key={k} value={k}>{KINDS[k].label}</option>)}
            </select>
            <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <input type="color" value={f.color || "#6366f1"} onChange={(e) => update(i, { color: e.target.value })} style={{ width: 26, height: 22, padding: 0, border: "1px solid var(--line-2)", borderRadius: 4, background: "transparent", opacity: f.color ? 1 : 0.35 }} title={f.color || "cor do produto"} />
              {f.color && <button type="button" className="mono dim" onClick={() => update(i, { color: "" })} title="usar a cor do produto" style={{ fontSize: 11 }}>✕</button>}
            </span>
            {i === 0 ? (
              <span className="mono dim" style={{ fontSize: 10, textAlign: "center" }}>entrada</span>
            ) : (
              <div style={{ position: "relative" }}>
                <input type="number" step="any" value={f.conv === "" || f.conv == null ? "" : Math.round(Number(f.conv) * 100)} placeholder="conv"
                  onChange={(e) => update(i, { conv: e.target.value === "" ? "" : Number(e.target.value) / 100 })}
                  style={{ ...inputStyle, paddingRight: 18, textAlign: "right" }} />
                <span className="mono dim" style={{ position: "absolute", right: 6, top: 6, fontSize: 11 }}>%</span>
              </div>
            )}
            <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <span className="mono dim" style={{ fontSize: 10 }}>parado →</span>
              <input type="number" min="0" value={f.staleDays ?? ""} placeholder="—"
                onChange={(e) => update(i, { staleDays: e.target.value === "" ? "" : Number(e.target.value) })}
                style={{ ...inputStyle, width: 44, textAlign: "right" }} />
              <span className="mono dim" style={{ fontSize: 10 }}>d</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              {cadInput(i, f, "maxAttempts", "n", "toques máximos nesta etapa (dots do card)")}
              {cadInput(i, f, "retryDays", "d", "toque registrado → próximo em N dias (GPS)")}
              {cadInput(i, f, "firstTouchHours", "h", "SLA do 1º contato em horas (estágio de entrada)")}
            </div>
            <span style={{ display: "flex", alignItems: "center", gap: 6, justifyContent: "flex-end" }}>
              <button type="button" onClick={() => setScriptOpen(scriptOpen === i ? null : i)}
                title={String(f.script || "").trim() ? "Roteiro personalizado desta etapa (tela Meu dia)" : "Escrever o roteiro desta etapa (tela Meu dia); vazio usa o padrão do tipo"}
                className="mono" style={{ fontSize: 12, color: String(f.script || "").trim() ? "var(--accent)" : "var(--fg-4)" }}>✎</button>
              <button type="button" onClick={() => remove(i)} className="mono dim" style={{ fontSize: 13 }}>✕</button>
            </span>
          </div>
          {scriptOpen === i && (
            <div style={{ padding: "10px 14px 12px 66px", borderBottom: "1px solid var(--line-1)", background: "var(--bg-inset)" }}>
              <div className="mono" style={{ fontSize: 10, color: "var(--fg-4)", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 6 }}>
                Roteiro da etapa · aparece no botão Roteiro da tela Meu dia
              </div>
              <textarea value={f.script || ""} rows={6}
                placeholder={"Bloco separado por linha em branco = um passo.\nLinha terminando em dois-pontos vira o título do passo.\n\nAbertura:\nOlá {{nome}}, tudo bom? Vi que você trabalha com {{nicho}}..."}
                onChange={(e) => update(i, { script: e.target.value })}
                style={{ ...inputStyle, height: "auto", width: "100%", padding: 8, fontSize: 12.5, lineHeight: 1.5, fontFamily: "inherit", resize: "vertical" }} />
              <div className="mono dim" style={{ fontSize: 10.5, marginTop: 5 }}>
                {"tokens: {{nome}} {{nome_completo}} {{empresa}} {{nicho}} {{contas}} {{anuncios}} {{produto}} {{call}} {{link_call}} · vazio volta pro roteiro padrão do tipo"}
              </div>
            </div>
          )}
          </React.Fragment>
        ))}
      </div>
      <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 10 }}>
        <button type="button" onClick={() => setRows(r => [...r, { stage: "", kind: "outro", conv: 1, _orig: null }])} style={{ ...chromeBtnStyleSmall }}>
          <span style={{ fontSize: 11 }}>+ adicionar estágio</span>
        </button>
        {wonCount !== 1 && (
          <span className="mono" style={{ fontSize: 11, color: "var(--warn)" }}>
            {wonCount === 0 ? "nenhum estágio com tipo “ganho” — leads nunca viram cliente" : "mais de um estágio “ganho” — o 1º vale como fechamento"}
          </span>
        )}
      </div>
      <SaveBar onSave={save} hint={migrated != null ? `salvo · ${migrated} card(s) migrados de estágio` : "remover um estágio NÃO move os cards dele (caem no 1º estágio na visualização)"} />

      <LossReasonsSettings s={s} />
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
    <div style={{ marginTop: 26 }}>
      <SettingHeader title="Motivos de perda" sub="opções do modal ao mover pra Perdido/Desqualificado · alimentam o relatório de perdas na Análise do pipeline" />
      <div style={{ border: "1px solid var(--line-1)", borderRadius: "var(--r-3)", background: "var(--bg-1)", padding: "6px 14px" }}>
        {rows.map((r, i) => (
          <div key={i} style={{ display: "flex", gap: 8, alignItems: "center", padding: "6px 0", borderBottom: i < rows.length - 1 ? "1px solid var(--line-1)" : "none" }}>
            <span className="mono dim" style={{ fontSize: 10, width: 120, overflow: "hidden", textOverflow: "ellipsis" }}>{r.id || "novo"}</span>
            <input value={r.label || ""} placeholder="Rótulo do motivo" onChange={(e) => setRows((rs) => rs.map((x, j) => j === i ? { ...x, label: e.target.value } : x))} style={inputStyle} />
            <button type="button" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} className="mono dim" style={{ fontSize: 13 }}>✕</button>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 10 }}>
        <button type="button" onClick={() => setRows((rs) => [...rs, { id: "", label: "" }])} style={{ ...chromeBtnStyleSmall }}>
          <span style={{ fontSize: 11 }}>+ adicionar motivo</span>
        </button>
      </div>
      <SaveBar onSave={save} hint="“não informado” é automático quando alguém move sem escolher motivo (API/MCP)" />
    </div>
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

  return (
    <div>
      <SettingHeader title="Equipe & papéis" sub="quem aparece nos pickers de SDR/closer/integração do pipeline · papel ≠ permissão (todos são admin na v1)" />
      <div style={{ border: "1px solid var(--line-1)", borderRadius: "var(--r-3)", background: "var(--bg-1)" }}>
        <div className="mono" style={{ display: "grid", gridTemplateColumns: "1fr repeat(4, 100px) 140px 120px", gap: 8, padding: "10px 14px", background: "var(--bg-inset)", fontSize: 10, color: "var(--fg-4)", letterSpacing: "0.06em", textTransform: "uppercase", borderBottom: "1px solid var(--line-1)" }}>
          <span>Usuário</span>
          {ROLE_OPTS.map(([k, l, hint]) => <span key={k} title={hint} style={{ textAlign: "center" }}>{l}</span>)}
          <span title="Vazio = aparece nos pickers de todos os produtos; preenchido = só no workspace daquele produto">Produto</span>
          <span title="Quais telas o usuário vê (menu + rotas da API). Nenhuma marcada = todas">Telas</span>
        </div>
        {users === null && <div className="mono dim" style={{ padding: "12px 14px", fontSize: 12 }}>carregando…</div>}
        {Array.isArray(users) && users.map((u) => (
          <div key={u.id} style={{ display: "grid", gridTemplateColumns: "1fr repeat(4, 100px) 140px 120px", gap: 8, padding: "9px 14px", borderBottom: "1px solid var(--line-1)", alignItems: "center", opacity: saving === u.id ? 0.6 : 1 }}>
            <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 500 }}>
              <Avatar id={u.id} name={u.name} size={22} /> {u.name || u.id}
              <span className="mono dim" style={{ fontSize: 10 }}>{u.id}</span>
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
          <button onClick={saveMeta} style={{ ...chromeBtnStyleSmall, borderColor: "var(--accent-line)", color: "var(--accent)" }}><span style={{ fontSize: 11 }}>salvar</span></button>
        </div>
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
                      <button type="button" onClick={() => setPreviewKey(item.key)} className="mono" style={{ fontSize: 11, color: "var(--fg-3)" }}
                        title="Ver como este roteiro aparece no popup das Minhas atividades (com dados de exemplo)">▶ pré-visualizar</button>
                      <button type="button" onClick={() => setOpenKey(open ? null : item.key)} className="mono" style={{ fontSize: 11, color: open ? "var(--accent)" : "var(--fg-3)" }}>{open ? "fechar" : "✎ editar"}</button>
                    </div>
                  </div>
                  {open && (
                    <div style={{ padding: "12px 14px 14px", borderTop: "1px solid var(--line-1)", background: "var(--bg-inset)" }}>
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
                              <span className="mono dim" style={{ fontSize: 11, width: 16 }}>{k + 1}.</span>
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

function SettingHeader({ title, sub }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <h2 style={{ margin: 0, fontSize: 16, fontWeight: 500 }}>{title}</h2>
      <div className="mono dim" style={{ fontSize: 11, marginTop: 3 }}>{sub}</div>
    </div>
  );
}

export { SettingsScreen };
