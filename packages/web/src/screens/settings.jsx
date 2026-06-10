import React from "react";
import { chromeBtnStyleSmall } from "../lib/ui.js";
import { EmptyState, PrimaryButton, RowActions } from "../atoms.jsx";
import { useData } from "../data.jsx";
import { api } from "../lib/api.js";
// SaaS Settings (fase 3) — funil, campos custom, pesos da saúde e Aha EDITÁVEIS
// por SaaS (gravam no produto). Integrações segue mock até a fase 4 (conexões).

const { useState: useStS } = React;

// O App remonta a tela a cada refresh pós-save (key=dataVersion); guardar a
// última visão em módulo preserva aba/SaaS escolhidos entre os remounts.
const lastView = { saas: null, tab: "funnel" };

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
  const [active, setActive] = useStS(lastView.saas || saasId || SAAS[0]?.id);
  const [tab, setTab] = useStS(lastView.tab);
  lastView.saas = active; lastView.tab = tab;
  const s = SAAS.find(x => x.id === active) || SAAS[0];

  const TABS = [
    ["funnel",      "Funil & estágios"],
    ["fields",      "Campos custom"],
    ["health",      "Pesos da saúde"],
    ["aha",         "Definição do Aha"],
    ["integrations","Integrações"],
  ];

  if (!s) return (
    <EmptyState
      title="Nenhum SaaS para configurar"
      hint="Crie um produto e ele aparece aqui para configurar funil, campos, pesos de saúde, Aha e integrações."
      action={<PrimaryButton onClick={() => openForm("products")}>+ Criar SaaS</PrimaryButton>}
    />
  );

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
      <div style={{ padding: "12px 24px", borderBottom: "1px solid var(--line-1)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
        <div style={{ display: "flex", gap: 6 }}>
          {SAAS.map(x => (
            <button key={x.id} onClick={() => setActive(x.id)} style={{
              height: 26, padding: "0 10px", borderRadius: "var(--r-2)",
              border: "1px solid " + (active === x.id ? "var(--line-strong)" : "var(--line-1)"),
              background: active === x.id ? "var(--bg-3)" : "var(--bg-2)",
              color: active === x.id ? "var(--fg-1)" : "var(--fg-3)",
              fontSize: 12, fontFamily: "var(--mono)",
            }}>{x.name}</button>
          ))}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <RowActions onEdit={() => openForm("products", s)} onDelete={() => openDelete("products", s)} />
          <button onClick={() => openForm("products")} style={{ ...chromeBtnStyleSmall, borderColor: "var(--accent-line)", color: "var(--accent)" }}>
            <span style={{ fontSize: 11 }}>+ novo SaaS</span>
          </button>
        </div>
      </div>

      <div style={{ flex: 1, display: "grid", gridTemplateColumns: "200px 1fr", minHeight: 0 }}>
        <nav style={{ borderRight: "1px solid var(--line-1)", padding: 12, background: "var(--bg-1)" }}>
          {TABS.map(([k,l]) => (
            <button key={k} onClick={() => setTab(k)} style={{
              display: "block", width: "100%", padding: "8px 10px",
              borderRadius: "var(--r-2)", marginBottom: 2,
              background: tab === k ? "var(--bg-3)" : "transparent",
              color: tab === k ? "var(--fg-1)" : "var(--fg-3)",
              fontSize: 12, textAlign: "left",
            }}>{l}</button>
          ))}
        </nav>
        <div style={{ overflow: "auto", padding: "20px 24px" }}>
          {tab === "funnel"       && <FunnelSettings s={s} />}
          {tab === "fields"       && <FieldsSettings s={s} />}
          {tab === "health"       && <HealthSettings s={s} />}
          {tab === "aha"          && <AhaSettings s={s} />}
          {tab === "integrations" && <IntegrationsSettings s={s} />}
        </div>
      </div>
    </div>
  );
}

// Barra de salvar compartilhada das abas (estado ocupado + erro + dica).
function SaveBar({ onSave, disabled, hint, busyLabel = "Salvando…", label = "Salvar" }) {
  const [busy, setBusy] = useStS(false);
  const [error, setError] = useStS(null);
  async function go() {
    setBusy(true); setError(null);
    try { await onSave(); }
    catch (e) { setBusy(false); setError(e.message || String(e)); }
  }
  return (
    <div style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 10 }}>
      <PrimaryButton onClick={go} disabled={busy || disabled}>{busy ? busyLabel : label}</PrimaryButton>
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

  async function save() {
    const clean = rows.filter(r => String(r.stage || "").trim());
    const funnel = clean.map(({ _orig, ...f }, i) => ({
      ...f,
      stage: f.stage.trim(),
      conv: i === 0 || f.conv === "" || f.conv == null || Number.isNaN(Number(f.conv)) ? 1 : Number(f.conv),
      staleDays: f.staleDays === "" || f.staleDays == null ? null : Number(f.staleDays),
    }));
    const renames = {};
    clean.forEach((r, i) => { if (r._orig && r._orig !== funnel[i].stage) renames[r._orig] = funnel[i].stage; });
    const res = await api.saveFunnel(s.id, funnel, renames);
    setMigrated(res.migrated);
    await refresh();
  }

  return (
    <div>
      <SettingHeader title="Estágios do funil" sub="renomear aqui migra os cards do pipeline junto · conversão (%) alimenta a previsão · 'parado → Nd' marca cards velhos no kanban" />
      <div style={{ border: "1px solid var(--line-1)", borderRadius: "var(--r-3)", overflow: "hidden", background: "var(--bg-1)" }}>
        <div className="mono" style={{ display: "grid", gridTemplateColumns: "52px 1fr 130px 70px 90px 110px 30px", gap: 8, padding: "10px 14px", background: "var(--bg-inset)", fontSize: 10, color: "var(--fg-4)", letterSpacing: "0.06em", textTransform: "uppercase", borderBottom: "1px solid var(--line-1)" }}>
          <span></span><span>Estágio</span><span>Tipo canônico</span><span>Cor</span><span>Conv.</span><span>Auto-regra</span><span></span>
        </div>
        {rows.map((f, i) => (
          <div key={i} style={{ display: "grid", gridTemplateColumns: "52px 1fr 130px 70px 90px 110px 30px", gap: 8, padding: "8px 14px", borderBottom: "1px solid var(--line-1)", alignItems: "center" }}>
            <span style={{ display: "flex" }}>
              <button type="button" onClick={() => move(i, -1)} disabled={i === 0} style={arrowStyle(i === 0)}>↑</button>
              <button type="button" onClick={() => move(i, 1)} disabled={i === rows.length - 1} style={arrowStyle(i === rows.length - 1)}>↓</button>
            </span>
            <input value={f.stage || ""} placeholder="Nome do estágio" onChange={(e) => update(i, { stage: e.target.value })} style={inputStyle} />
            <span className="mono dim" style={{ fontSize: 11 }}>{canonicalFor(i, rows.length)}</span>
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
            <button type="button" onClick={() => remove(i)} className="mono dim" style={{ fontSize: 13 }}>✕</button>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 10 }}>
        <button type="button" onClick={() => setRows(r => [...r, { stage: "", conv: 1, _orig: null }])} style={{ ...chromeBtnStyleSmall }}>
          <span style={{ fontSize: 11 }}>+ adicionar estágio</span>
        </button>
      </div>
      <SaveBar onSave={save} hint={migrated != null ? `salvo · ${migrated} card(s) migrados de estágio` : "remover um estágio NÃO move os cards dele (caem no 1º estágio na visualização)"} />
    </div>
  );
}

function canonicalFor(i, n) {
  if (i === 0) return "prospecting";
  if (i === n-1) return "closed";
  if (i < n/2) return "qualification";
  if (i < n-1) return "proposal";
  return "closing";
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
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14 }}>
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

// ───────────────────────────────────────────────────────── Pesos da saúde
const HEALTH_KEYS = [["funil", "Funil"], ["vendas", "Vendas"], ["cliente", "Cliente"], ["uso", "Uso"]];

function HealthSettings({ s }) {
  const { refresh } = useData();
  const [w, setW] = useStS(() => {
    const hw = s.healthWeights || {};
    return Object.fromEntries(HEALTH_KEYS.map(([k]) => [k, Number.isFinite(Number(hw[k])) ? Number(hw[k]) : 25]));
  });
  const total = HEALTH_KEYS.reduce((a, [k]) => a + (Number(w[k]) || 0), 0);
  const ok = total === 100;

  async function save() {
    await api.update("products", s.id, { healthWeights: w });
    await refresh();
  }

  return (
    <div>
      <SettingHeader title="Composição da saúde" sub="média ponderada · 0–100 · a decomposição aparece em todo hover no app" />
      <div style={{ border: "1px solid var(--line-1)", borderRadius: "var(--r-3)", background: "var(--bg-1)" }}>
        {HEALTH_KEYS.map(([k, label]) => (
          <div key={k} style={{ display: "grid", gridTemplateColumns: "120px 1fr 80px", gap: 14, padding: "14px 16px", borderBottom: "1px solid var(--line-1)", alignItems: "center" }}>
            <span style={{ fontSize: 13 }}>{label}</span>
            <input type="range" min="0" max="100" value={w[k]} onChange={(e) => setW(x => ({ ...x, [k]: Number(e.target.value) }))} style={{ width: "100%" }} />
            <div style={{ position: "relative" }}>
              <input type="number" min="0" max="100" value={w[k]} onChange={(e) => setW(x => ({ ...x, [k]: e.target.value === "" ? 0 : Number(e.target.value) }))} style={{ ...inputStyle, paddingRight: 20, textAlign: "right" }} />
              <span className="mono dim" style={{ position: "absolute", right: 6, top: 6, fontSize: 11 }}>%</span>
            </div>
          </div>
        ))}
      </div>
      <div className="mono" style={{ fontSize: 11, marginTop: 10, color: ok ? "var(--fg-4)" : "var(--neg)" }}>
        soma: {total}% {ok ? "" : "· os pesos devem somar 100%"}
      </div>
      <SaveBar onSave={save} disabled={!ok} />
    </div>
  );
}

// ───────────────────────────────────────────────────────── Definição do Aha
function AhaSettings({ s }) {
  const { refresh } = useData();
  const [conds, setConds] = useStS(() => [...(s.aha?.conditions || [])]);

  async function save() {
    await api.update("products", s.id, { aha: { ...(s.aha || {}), conditions: conds.map(c => c.trim()).filter(Boolean) } });
    await refresh();
  }

  return (
    <div>
      <SettingHeader title="Definição do Aha-Moment" sub="o evento único que prevê retenção. Alimenta ativação, time-to-value e alertas de onboarding." />
      <div style={{ border: "1px solid var(--line-1)", borderRadius: "var(--r-3)", background: "var(--bg-1)", padding: "16px 18px" }}>
        <div style={{ fontSize: 13, color: "var(--fg-2)", marginBottom: 10 }}>Um usuário atinge o Aha quando:</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {conds.map((c, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 10px", background: "var(--bg-2)", border: "1px solid var(--line-1)", borderRadius: "var(--r-2)" }}>
              <span style={{ width: 14, height: 14, borderRadius: 3, background: "var(--accent)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--accent-fg)", fontSize: 10, flexShrink: 0 }}>✓</span>
              <input value={c} placeholder="Condição (ex.: conecta 1 fonte de anúncios)" onChange={(e) => setConds(x => x.map((y, j) => j === i ? e.target.value : y))} style={{ ...inputStyle, background: "transparent", border: "none", height: 22 }} />
              <button type="button" onClick={() => setConds(x => x.filter((_, j) => j !== i))} className="mono dim" style={{ fontSize: 13 }}>✕</button>
            </div>
          ))}
          <button type="button" onClick={() => setConds(x => [...x, ""])} style={{ alignSelf: "flex-start", padding: "4px 8px", background: "var(--bg-2)", border: "1px solid var(--line-1)", borderRadius: "var(--r-2)", fontSize: 11, fontFamily: "var(--mono)", color: "var(--fg-2)" }}>+ condição</button>
        </div>
        <div className="mono dim" style={{ fontSize: 11, marginTop: 14 }}>ativação atual: <span style={{ color: "var(--fg-1)" }}>{window.fmt.pct(s.activation)}</span></div>
      </div>
      <SaveBar onSave={save} />
    </div>
  );
}

// ───────────────────────────────────────────────────────── Integrações (mock — fase 4 a cargo do app)
function IntegrationsSettings() {
  const integrations = [
    { k: "Stripe",   status: "connected", desc: "MRR, cobrança, eventos de churn" },
    { k: "Salesforce", status: "synced",   desc: "Bidirecional · contatos, deals" },
    { k: "Segment",  status: "connected", desc: "Eventos de produto, rastreio de Aha" },
    { k: "Slack",    status: "connected", desc: "Alertas de anomalia + fechamento" },
    { k: "HubSpot",  status: "not connected" },
    { k: "Linear",   status: "not connected" },
    { k: "Webhook",  status: "configured", desc: "https://api.cockpit.so/hooks/…" },
  ];
  return (
    <div>
      <SettingHeader title="Integrações" sub="mock — conexões reais (e-mail, webhook, Mercado Pago) chegam na fase 4" />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 10 }}>
        {integrations.map(i => (
          <div key={i.k} style={{ padding: "14px 16px", border: "1px solid var(--line-1)", borderRadius: "var(--r-3)", background: "var(--bg-1)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 500 }}>{i.k}</div>
              <div className="mono dim" style={{ fontSize: 11, marginTop: 3 }}>{i.desc || "—"}</div>
            </div>
            <span className={"chip " + (i.status === "connected" || i.status === "synced" || i.status === "configured" ? "pos" : "")} style={{ height: 22 }}>
              {(i.status === "not connected") ? "conectar" : ({ connected: "conectado", synced: "sincronizado", configured: "configurado" })[i.status] || i.status}
            </span>
          </div>
        ))}
      </div>
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
