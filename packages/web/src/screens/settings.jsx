import React from "react";
import { chromeBtnStyleSmall } from "../lib/ui.js";
import { EmptyState, PrimaryButton, RowActions } from "../atoms.jsx";
import { useData } from "../data.jsx";
// SaaS Settings — funnels, custom fields, health weights, Aha definition, integrations

const { useState: useStS } = React;

function SettingsScreen({ saasId }) {
  const { SAAS } = window.SEED;
  const { openForm, openDelete } = useData();
  const [active, setActive] = useStS(saasId || "leverads");
  const [tab, setTab] = useStS("funnel");
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

function FunnelSettings({ s }) {
  const { openForm } = useData();
  return (
    <div>
      <SettingHeader title="Estágios do funil" sub="mapeie pra tipos canônicos (prospecting/qualification/proposal/closing) pra comparar entre SaaS" />
      <div style={{ border: "1px solid var(--line-1)", borderRadius: "var(--r-3)", overflow: "hidden", background: "var(--bg-1)" }}>
        <div className="mono" style={{ display: "grid", gridTemplateColumns: "30px 1fr 200px 100px 80px", padding: "10px 14px", background: "var(--bg-inset)", fontSize: 10, color: "var(--fg-4)", letterSpacing: "0.06em", textTransform: "uppercase", borderBottom: "1px solid var(--line-1)" }}>
          <span></span><span>Estágio</span><span>Tipo canônico</span><span>Cor</span><span>Auto-regras</span>
        </div>
        {s.funnel.map((f, i) => (
          <div key={f.stage} style={{ display: "grid", gridTemplateColumns: "30px 1fr 200px 100px 80px", padding: "10px 14px", borderBottom: "1px solid var(--line-1)", alignItems: "center", fontSize: 13 }}>
            <span className="mono dim">⋮⋮</span>
            <span>{f.stage}</span>
            <span className="mono dim" style={{ fontSize: 11 }}>{canonicalFor(i, s.funnel.length)}</span>
            <span><span style={{ display: "inline-block", width: 12, height: 12, borderRadius: 3, background: window.productTone(s), border: "1px solid var(--line-2)" }} /></span>
            <span className="mono dim" style={{ fontSize: 10 }}>{i === 2 ? "parado → 14d" : "nenhuma"}</span>
          </div>
        ))}
      </div>
      <button onClick={() => openForm("products", s)} style={{ marginTop: 12, ...chromeBtnStyleSmall }}><span style={{ fontSize: 11 }}>+ editar estágios</span></button>
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

function FieldsSettings({ s }) {
  return (
    <div>
      <SettingHeader title="Campos custom" sub="por deal, por cliente, por contato. Mapeie pra campos padrão quando der." />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        {[
          { obj: "Deal",     fields: ["Segmento ICP","Tamanho do comitê","Email do champion","Concorrência ganhou/perdeu","URL da calc de ROI"] },
          { obj: "Cliente",  fields: ["Data de renovação","Champion","Tier","Canal Slack","CSM"] },
          { obj: "Contato",  fields: ["Cargo","LinkedIn","Função","Influência","Detrator"] },
        ].map(g => (
          <div key={g.obj} style={{ border: "1px solid var(--line-1)", borderRadius: "var(--r-3)", background: "var(--bg-1)", padding: "14px 16px" }}>
            <div style={{ fontSize: 12, fontWeight: 500, color: "var(--fg-2)", marginBottom: 10 }}>{g.obj}</div>
            {g.fields.map(f => (
              <div key={f} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid var(--line-1)", fontSize: 12 }}>
                <span>{f}</span>
                <span className="mono dim">texto</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function HealthSettings({ s }) {
  return (
    <div>
      <SettingHeader title="Composição da saúde" sub="média ponderada · 0–100 · a decomposição aparece em todo hover no app" />
      <div style={{ border: "1px solid var(--line-1)", borderRadius: "var(--r-3)", background: "var(--bg-1)" }}>
        {s.decomp.map((d) => (
          <div key={d.k} style={{ display: "grid", gridTemplateColumns: "120px 1fr 60px 100px", gap: 14, padding: "14px 16px", borderBottom: "1px solid var(--line-1)", alignItems: "center" }}>
            <span style={{ fontSize: 13 }}>{d.k}</span>
            <input type="range" min="0" max="100" defaultValue={Math.round(d.w*100)} style={{ width: "100%" }} />
            <span className="mono tnum" style={{ textAlign: "right" }}>{(d.w*100).toFixed(0)}%</span>
            <span className="mono dim" style={{ fontSize: 11 }}>sinal: {d.k.toLowerCase()}</span>
          </div>
        ))}
      </div>
      <div className="mono dim" style={{ fontSize: 11, marginTop: 10 }}>os pesos devem somar 100% · última edição há 4d por você</div>
    </div>
  );
}

function AhaSettings({ s }) {
  return (
    <div>
      <SettingHeader title="Definição do Aha-Moment" sub="o evento único que prevê retenção. Alimenta ativação, time-to-value e alertas de onboarding." />
      <div style={{ border: "1px solid var(--line-1)", borderRadius: "var(--r-3)", background: "var(--bg-1)", padding: "16px 18px" }}>
        <div style={{ fontSize: 13, color: "var(--fg-2)", marginBottom: 10 }}>Um usuário atinge o Aha quando:</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {s.id === "leverads" ? [
            "Conecta ao menos 1 fonte de anúncios",
            "Roda uma campanha por ≥ 7 dias",
            "Vê o dashboard de atribuição ≥ 3 vezes",
          ].map(c => <Cond key={c} c={c} />) :
           s.id === "quill" ? [
            "Cria 3 documentos",
            "Gera ≥ 1.000 palavras via IA",
            "Em até 7 dias do signup",
          ].map(c => <Cond key={c} c={c} />) :
          [
            "Escaneia ≥ 50 SKUs",
            "Faz 1 contagem de ciclo",
            "Adiciona ao menos 1 colega",
          ].map(c => <Cond key={c} c={c} />)}
        </div>
        <div className="mono dim" style={{ fontSize: 11, marginTop: 14 }}>ativação atual: <span style={{ color: "var(--fg-1)" }}>{window.fmt.pct(s.activation)}</span> · mediana do coorte até o Aha: ~3.2d</div>
      </div>
    </div>
  );
}

function Cond({ c }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", background: "var(--bg-2)", border: "1px solid var(--line-1)", borderRadius: "var(--r-2)" }}>
      <span style={{ width: 14, height: 14, borderRadius: 3, background: "var(--accent)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--accent-fg)", fontSize: 10 }}>✓</span>
      <span style={{ fontSize: 12 }}>{c}</span>
    </div>
  );
}

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
      <SettingHeader title="Integrações" sub="sync bidirecional onde dá · webhooks pro resto" />
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
