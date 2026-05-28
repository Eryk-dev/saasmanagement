import React from "react";
import { Avatar, Sparkline } from "../atoms.jsx";
import { BigNumber, DeltaInline } from "../charts.jsx";
// Customers list + drill-down detail panel. The CS persona's home.
// Sortable, filterable by health band, with active CTAs.

const { useState: useStC } = React;

function CustomersScreen({ csFilter }) {
  const { CUSTOMERS, SAAS } = window.SEED;
  const [sel, setSel] = useStC(null);
  const [filter, setFilter] = useStC(csFilter || "all"); // all | red | yellow | green
  const [sortBy, setSortBy] = useStC("health"); // health | arr | renewal

  const filtered = CUSTOMERS.filter(c => {
    if (filter === "red")    return c.health < 50;
    if (filter === "yellow") return c.health >= 50 && c.health < 70;
    if (filter === "green")  return c.health >= 70;
    return true;
  }).sort((a, b) => {
    if (sortBy === "health") return a.health - b.health;
    if (sortBy === "arr")    return b.arr - a.arr;
    if (sortBy === "renewal")return (a.renewal === "—" ? 9999 : parseInt(a.renewal)) - (b.renewal === "—" ? 9999 : parseInt(b.renewal));
    return 0;
  });

  return (
    <div style={{ flex: 1, display: "grid", gridTemplateColumns: sel ? "minmax(0, 1fr) 460px" : "1fr", minHeight: 0 }}>
      <div style={{ display: "flex", flexDirection: "column", borderRight: sel ? "1px solid var(--line-1)" : "none", minHeight: 0 }}>
        <div style={{ padding: "12px 24px", borderBottom: "1px solid var(--line-1)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div style={{ display: "flex", gap: 6 }}>
            {[["all","Todos"],["red","Crítico"],["yellow","Em risco"],["green","Saudável"]].map(([k,l]) => (
              <button key={k} onClick={() => setFilter(k)} style={{
                height: 26, padding: "0 10px",
                borderRadius: "var(--r-2)",
                border: "1px solid " + (filter === k ? "var(--line-strong)" : "var(--line-1)"),
                background: filter === k ? "var(--bg-3)" : "var(--bg-2)",
                color: filter === k ? "var(--fg-1)" : "var(--fg-3)",
                fontSize: 12, fontFamily: "var(--mono)",
              }}>{l} <span className="dim">{k === "all" ? CUSTOMERS.length : k === "red" ? CUSTOMERS.filter(c=>c.health<50).length : k === "yellow" ? CUSTOMERS.filter(c=>c.health>=50&&c.health<70).length : CUSTOMERS.filter(c=>c.health>=70).length}</span></button>
            ))}
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <span className="mono dim" style={{ fontSize: 11 }}>ordenar:</span>
            {[["health","Saúde ↑"],["arr","ARR ↓"],["renewal","Renovação"]].map(([k,l]) => (
              <button key={k} onClick={() => setSortBy(k)} style={{
                height: 24, padding: "0 8px", borderRadius: 4,
                border: "1px solid var(--line-1)",
                background: sortBy === k ? "var(--bg-3)" : "var(--bg-2)",
                color: sortBy === k ? "var(--fg-1)" : "var(--fg-3)",
                fontSize: 11, fontFamily: "var(--mono)",
              }}>{l}</button>
            ))}
          </div>
        </div>

        <div style={{ overflow: "auto", flex: 1 }}>
          <div className="mono" style={{
            display: "grid",
            gridTemplateColumns: "1.6fr 0.7fr 0.6fr 0.7fr 0.7fr 0.7fr 0.5fr 0.5fr 0.8fr",
            gap: 10,
            padding: "10px 24px",
            background: "var(--bg-inset)",
            fontSize: 10, color: "var(--fg-4)", letterSpacing: "0.06em", textTransform: "uppercase",
            borderBottom: "1px solid var(--line-1)",
          }}>
            <span>Conta</span>
            <span>Produto</span>
            <span style={{ textAlign: "right" }}>Saúde</span>
            <span style={{ textAlign: "right" }}>ARR</span>
            <span>Uso 7d</span>
            <span>Último contato</span>
            <span>NPS</span>
            <span>Renovação</span>
            <span>CSM</span>
          </div>
          {filtered.map(c => <CustomerRow key={c.id} c={c} onOpen={() => setSel(c)} active={sel?.id === c.id} />)}
        </div>
      </div>

      {sel && <CustomerDetail c={sel} onClose={() => setSel(null)} />}
    </div>
  );
}

function CustomerRow({ c, onOpen, active }) {
  const { SAAS } = window.SEED;
  const saas = SAAS.find(s => s.id === c.saas);
  const tone = c.health < 50 ? "var(--neg)" : c.health < 70 ? "var(--warn)" : "var(--pos)";
  return (
    <button onClick={onOpen} style={{
      display: "grid",
      gridTemplateColumns: "1.6fr 0.7fr 0.6fr 0.7fr 0.7fr 0.7fr 0.5fr 0.5fr 0.8fr",
      gap: 10,
      width: "100%",
      padding: "10px 24px",
      borderBottom: "1px solid var(--line-1)",
      background: active ? "var(--bg-2)" : "transparent",
      alignItems: "center",
      textAlign: "left",
      fontSize: 13,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span className="dot" style={{ color: tone, width: 7, height: 7 }} />
        <div>
          <div style={{ fontWeight: 500 }}>{c.name}</div>
          <div className="mono dim" style={{ fontSize: 10 }}>{c.plan} · {c.flags.slice(0,2).join(" · ") || "—"}</div>
        </div>
      </div>
      <span className="mono dim" style={{ fontSize: 12 }}>{saas?.name}</span>
      <div style={{ textAlign: "right" }}>
        <span className="mono tnum" style={{ fontSize: 13, color: tone, fontWeight: 500 }}>{c.health}</span>
        <DeltaInline value={c.delta} unit="int" />
      </div>
      <span className="mono tnum" style={{ textAlign: "right", fontSize: 12 }}>{window.fmt.money(c.arr)}</span>
      <span className="mono dim" style={{ fontSize: 12, color: c.usage.startsWith("−") ? "var(--neg)" : c.usage.startsWith("+") ? "var(--pos)" : "var(--fg-3)" }}>{c.usage}</span>
      <span className="mono dim tnum" style={{ fontSize: 12 }}>{c.lastTouch}</span>
      <span className="mono tnum" style={{ fontSize: 12, color: c.nps <= 6 ? "var(--neg)" : c.nps >= 9 ? "var(--pos)" : "var(--fg-2)" }}>{c.nps}</span>
      <span className="mono dim tnum" style={{ fontSize: 12 }}>{c.renewal}</span>
      <Avatar id={c.csm} name={c.csm} size={20} />
    </button>
  );
}

// ─────────────────────────────────────────────── Detail panel
function CustomerDetail({ c, onClose }) {
  const { SAAS, PEOPLE } = window.SEED;
  const saas = SAAS.find(s => s.id === c.saas);
  const csm = PEOPLE[c.csm];
  const tone = c.health < 50 ? "var(--neg)" : c.health < 70 ? "var(--warn)" : "var(--pos)";
  const [tab, setTab] = useStC("Usage");

  return (
    <div style={{ display: "flex", flexDirection: "column", overflow: "hidden", background: "var(--bg-1)" }}>
      <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--line-1)", display: "flex", justifyContent: "space-between", alignItems: "start" }}>
        <div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span style={{ fontSize: 16, fontWeight: 500 }}>{c.name}</span>
            <span className="chip">{saas?.name}</span>
            <span className="chip">{c.plan}</span>
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 18, marginTop: 10 }}>
            <BigNumber value={c.health} label="Saúde" delta={c.delta} dUnit="int" size={32} />
            <BigNumber value={window.fmt.money(c.arr)} label="ARR" size={28} />
            <BigNumber value={c.nps} label="Último NPS" size={28} />
          </div>
          <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 4 }}>
            {c.flags.map(f => <span key={f} className="chip warn">{f}</span>)}
          </div>
        </div>
        <button onClick={onClose} className="mono dim" style={{ fontSize: 14 }}>✕</button>
      </div>

      <div style={{ display: "flex", gap: 2, padding: "8px 12px", borderBottom: "1px solid var(--line-1)" }}>
        {["Usage","Engagement","Support","Satisfaction","Timeline"].map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding: "4px 10px", borderRadius: 4,
            background: tab === t ? "var(--bg-3)" : "transparent",
            color: tab === t ? "var(--fg-1)" : "var(--fg-3)",
            fontSize: 12,
          }}>{({ Usage: "Uso", Engagement: "Engajamento", Support: "Suporte", Satisfaction: "Satisfação", Timeline: "Linha do tempo" })[t] || t}</button>
        ))}
      </div>

      <div style={{ flex: 1, overflow: "auto", padding: "16px 18px" }}>
        {tab === "Usage" && <UsageTab c={c} />}
        {tab === "Engagement" && <EngagementTab c={c} />}
        {tab === "Support" && <SupportTab c={c} />}
        {tab === "Satisfaction" && <SatisfactionTab c={c} />}
        {tab === "Timeline" && <TimelineTab c={c} />}
      </div>

      <div style={{ padding: "12px 18px", borderTop: "1px solid var(--line-1)", background: "var(--bg-inset)" }}>
        <div className="mono" style={{ fontSize: 10, color: "var(--fg-4)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 6 }}>CTAs ativas · CSM {csm?.name}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {c.health < 50 && (
            <CTARow tone="neg" label="Agendar call de retenção · uso caindo há 3sem" cta="agendar" />
          )}
          {c.renewal !== "—" && parseInt(c.renewal) < 90 && (
            <CTARow tone="warn" label={`Renovação em ${c.renewal} · preparar proposta`} cta="rascunho" />
          )}
          {c.flags.includes("expansion") && (
            <CTARow tone="pos" label="Oportunidade de expansão · uso acima do teto do plano" cta="propor" />
          )}
          {c.flags.includes("champion-left") && (
            <CTARow tone="warn" label="Champion saiu · achar novo sponsor" cta="mapear" />
          )}
        </div>
      </div>
    </div>
  );
}

function CTARow({ tone, label, cta }) {
  const c = tone === "neg" ? "var(--neg)" : tone === "warn" ? "var(--warn)" : "var(--pos)";
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 10px", border: `1px solid oklch(from ${c} l c h / 0.30)`, background: `oklch(from ${c} l c h / 0.07)`, borderRadius: "var(--r-2)" }}>
      <span style={{ fontSize: 12, color: "var(--fg-1)" }}>{label}</span>
      <button style={{ fontSize: 11, color: c, fontFamily: "var(--mono)" }}>{cta} →</button>
    </div>
  );
}

function UsageTab({ c }) {
  // Simulated weekly usage series
  const series = [80, 78, 72, 65, 55, 48, 42];
  return (
    <div>
      <div className="mono" style={{ fontSize: 10, color: "var(--fg-4)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 6 }}>Uso · últimas 7 semanas (vs teto do plano 100)</div>
      <Sparkline data={series} width={420} height={56} stroke="var(--neg)" />
      <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <MicroStatBlock k="Usuários ativos" v="14 / 60" sub="assentos usados" tone={"var(--neg)"} />
        <MicroStatBlock k="Ações core /dia" v="142" sub="−54% s/s" tone="var(--neg)" />
        <MicroStatBlock k="Eventos Aha" v="2" sub="últimos 7d · era 18" tone="var(--neg)" />
        <MicroStatBlock k="Time-to-value" v="3.8d" sub="mediana do coorte 1.2d" tone="var(--warn)" />
      </div>
    </div>
  );
}
function EngagementTab({ c }) {
  return (
    <div className="mono" style={{ fontSize: 12, color: "var(--fg-2)", lineHeight: 1.6 }}>
      <div>Último login: <span style={{ color: "var(--fg-1)" }}>há {c.lastTouch}</span></div>
      <div>Canal no Slack: <span style={{ color: "var(--accent)" }}>#cust-{c.name.toLowerCase().split(" ")[0]}</span></div>
      <div>Cadência de QBR: <span style={{ color: "var(--fg-1)" }}>trimestral</span> · próxima em 42d</div>
      <div style={{ marginTop: 8 }}>Champions:</div>
      <ul style={{ paddingLeft: 16, color: "var(--fg-3)" }}>
        <li>Diretor de Ops <span className="dim">· primário</span></li>
        <li>VP de Engenharia <span className="dim">· técnico</span></li>
      </ul>
    </div>
  );
}
function SupportTab({ c }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {[
        { age: "1h",  pri: "P1", t: "Scanner em massa quebra no iOS 17" },
        { age: "1d",  pri: "P2", t: "Import CSV truncando IDs longos" },
        { age: "3d",  pri: "P3", t: "Dúvida sobre política de retry de webhook" },
        { age: "12d", pri: "P2", t: "Usuário não pode ser removido do time" },
      ].map((t,i) => (
        <div key={i} style={{ padding: "8px 10px", border: "1px solid var(--line-1)", borderRadius: "var(--r-2)", background: "var(--bg-2)", display: "flex", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span className="mono" style={{ fontSize: 10, color: t.pri === "P1" ? "var(--neg)" : t.pri === "P2" ? "var(--warn)" : "var(--fg-3)" }}>{t.pri}</span>
            <span style={{ fontSize: 12 }}>{t.t}</span>
          </div>
          <span className="mono dim" style={{ fontSize: 10 }}>há {t.age}</span>
        </div>
      ))}
    </div>
  );
}
function SatisfactionTab({ c }) {
  return (
    <div className="mono" style={{ fontSize: 12, color: "var(--fg-2)", lineHeight: 1.7 }}>
      <div>Último NPS: <span style={{ color: c.nps <= 6 ? "var(--neg)" : c.nps >= 9 ? "var(--pos)" : "var(--fg-1)" }}>{c.nps}/10</span> · há 18d</div>
      <div>Comentário:</div>
      <div style={{ marginTop: 6, padding: "10px 12px", background: "var(--bg-2)", border: "1px solid var(--line-1)", borderRadius: "var(--r-2)", color: "var(--fg-1)", fontFamily: "var(--sans)", fontSize: 12, lineHeight: 1.5 }}>
        "{c.nps >= 9 ? "O melhor suporte que já usei. Ponto." :
           c.nps <= 6 ? "O scanner do app trava toda semana. A web é ótima, mas o time de campo está frustrado." :
           "Atende a gente. A experiência mobile podia ser melhor."}"
      </div>
      <div style={{ marginTop: 10 }}>Histórico de tags: <span style={{ color: "var(--accent)" }}>mobile · scanner</span> (×3)</div>
    </div>
  );
}
function TimelineTab({ c }) {
  const items = [
    { d: "hoje",   t: "Saúde caiu para "+c.health, kind: "alert" },
    { d: "há 2d",  t: "QBR agendada com o Diretor de Ops", kind: "meeting" },
    { d: "há 5d",  t: "Ticket P1 aberto — scanner travou", kind: "ticket" },
    { d: "há 1sem", t: "Usuários ativos caíram −18% s/s", kind: "alert" },
    { d: "há 3sem", t: "Call de renovação · proposta enviada (R$82k ARR)", kind: "deal" },
    { d: "há 8sem", t: "Champion (Carlos R.) saiu da empresa", kind: "alert" },
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
      {items.map((i, k) => (
        <div key={k} style={{ display: "grid", gridTemplateColumns: "70px 1fr", gap: 10, padding: "10px 0", borderBottom: "1px solid var(--line-1)" }}>
          <span className="mono dim" style={{ fontSize: 10 }}>{i.d}</span>
          <span style={{ fontSize: 12 }}>
            <span className="mono" style={{ fontSize: 10, color: i.kind === "alert" ? "var(--neg)" : i.kind === "deal" ? "var(--pos)" : "var(--accent)", marginRight: 6 }}>{i.kind}</span>
            {i.t}
          </span>
        </div>
      ))}
    </div>
  );
}

function MicroStatBlock({ k, v, sub, tone }) {
  return (
    <div style={{ padding: "10px 12px", background: "var(--bg-2)", border: "1px solid var(--line-1)", borderRadius: "var(--r-2)" }}>
      <div className="mono" style={{ fontSize: 10, color: "var(--fg-4)", letterSpacing: "0.06em", textTransform: "uppercase" }}>{k}</div>
      <div className="mono tnum" style={{ fontSize: 18, marginTop: 2, color: tone || "var(--fg-1)" }}>{v}</div>
      <div className="mono dim" style={{ fontSize: 10, marginTop: 2 }}>{sub}</div>
    </div>
  );
}

export { CustomersScreen, CustomerDetail };
