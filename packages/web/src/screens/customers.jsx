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
            {[["all","All"],["red","Critical"],["yellow","At risk"],["green","Healthy"]].map(([k,l]) => (
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
            <span className="mono dim" style={{ fontSize: 11 }}>sort:</span>
            {[["health","Health ↑"],["arr","ARR ↓"],["renewal","Renewal soon"]].map(([k,l]) => (
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
            <span>Account</span>
            <span>Product</span>
            <span style={{ textAlign: "right" }}>Health</span>
            <span style={{ textAlign: "right" }}>ARR</span>
            <span>Usage 7d</span>
            <span>Last touch</span>
            <span>NPS</span>
            <span>Renewal</span>
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
            <BigNumber value={c.health} label="Health" delta={c.delta} dUnit="int" size={32} />
            <BigNumber value={window.fmt.money(c.arr)} label="ARR" size={28} />
            <BigNumber value={c.nps} label="Last NPS" size={28} />
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
          }}>{t}</button>
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
        <div className="mono" style={{ fontSize: 10, color: "var(--fg-4)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 6 }}>Active CTAs · CSM {csm?.name}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {c.health < 50 && (
            <CTARow tone="neg" label="Schedule save call · usage decay 3wk" cta="book" />
          )}
          {c.renewal !== "—" && parseInt(c.renewal) < 90 && (
            <CTARow tone="warn" label={`Renewal in ${c.renewal} · prepare proposal`} cta="draft" />
          )}
          {c.flags.includes("expansion") && (
            <CTARow tone="pos" label="Expansion opportunity · usage above plan ceiling" cta="propose" />
          )}
          {c.flags.includes("champion-left") && (
            <CTARow tone="warn" label="Champion left · identify new sponsor" cta="map" />
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
      <div className="mono" style={{ fontSize: 10, color: "var(--fg-4)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 6 }}>Usage · last 7 weeks (vs plan ceiling 100)</div>
      <Sparkline data={series} width={420} height={56} stroke="var(--neg)" />
      <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <MicroStatBlock k="Active users" v="14 / 60" sub="seats utilized" tone={"var(--neg)"} />
        <MicroStatBlock k="Core actions /day" v="142" sub="−54% wow" tone="var(--neg)" />
        <MicroStatBlock k="Aha events" v="2" sub="last 7d · was 18" tone="var(--neg)" />
        <MicroStatBlock k="Time-to-value" v="3.8d" sub="cohort median 1.2d" tone="var(--warn)" />
      </div>
    </div>
  );
}
function EngagementTab({ c }) {
  return (
    <div className="mono" style={{ fontSize: 12, color: "var(--fg-2)", lineHeight: 1.6 }}>
      <div>Last login: <span style={{ color: "var(--fg-1)" }}>{c.lastTouch} ago</span></div>
      <div>Open Slack channel: <span style={{ color: "var(--accent)" }}>#cust-{c.name.toLowerCase().split(" ")[0]}</span></div>
      <div>QBR cadence: <span style={{ color: "var(--fg-1)" }}>quarterly</span> · next in 42d</div>
      <div style={{ marginTop: 8 }}>Champions:</div>
      <ul style={{ paddingLeft: 16, color: "var(--fg-3)" }}>
        <li>Director of Ops <span className="dim">· primary</span></li>
        <li>VP Engineering <span className="dim">· technical</span></li>
      </ul>
    </div>
  );
}
function SupportTab({ c }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {[
        { age: "1h",  pri: "P1", t: "Bulk scanner crash on iOS 17" },
        { age: "1d",  pri: "P2", t: "CSV import truncating long IDs" },
        { age: "3d",  pri: "P3", t: "Webhook retry policy question" },
        { age: "12d", pri: "P2", t: "User can't be removed from team" },
      ].map((t,i) => (
        <div key={i} style={{ padding: "8px 10px", border: "1px solid var(--line-1)", borderRadius: "var(--r-2)", background: "var(--bg-2)", display: "flex", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span className="mono" style={{ fontSize: 10, color: t.pri === "P1" ? "var(--neg)" : t.pri === "P2" ? "var(--warn)" : "var(--fg-3)" }}>{t.pri}</span>
            <span style={{ fontSize: 12 }}>{t.t}</span>
          </div>
          <span className="mono dim" style={{ fontSize: 10 }}>{t.age} ago</span>
        </div>
      ))}
    </div>
  );
}
function SatisfactionTab({ c }) {
  return (
    <div className="mono" style={{ fontSize: 12, color: "var(--fg-2)", lineHeight: 1.7 }}>
      <div>Last NPS: <span style={{ color: c.nps <= 6 ? "var(--neg)" : c.nps >= 9 ? "var(--pos)" : "var(--fg-1)" }}>{c.nps}/10</span> · 18d ago</div>
      <div>Verbatim:</div>
      <div style={{ marginTop: 6, padding: "10px 12px", background: "var(--bg-2)", border: "1px solid var(--line-1)", borderRadius: "var(--r-2)", color: "var(--fg-1)", fontFamily: "var(--sans)", fontSize: 12, lineHeight: 1.5 }}>
        "{c.nps >= 9 ? "Best support I've used. Period." :
           c.nps <= 6 ? "Mobile scanner crashes weekly. Web is great but field team is frustrated." :
           "Works for us. Mobile experience could be better."}"
      </div>
      <div style={{ marginTop: 10 }}>Tag history: <span style={{ color: "var(--accent)" }}>mobile · scanner</span> (×3)</div>
    </div>
  );
}
function TimelineTab({ c }) {
  const items = [
    { d: "today",  t: "Health score dropped to "+c.health, kind: "alert" },
    { d: "2d ago", t: "QBR scheduled with Director of Ops", kind: "meeting" },
    { d: "5d ago", t: "Support ticket P1 opened — scanner crash", kind: "ticket" },
    { d: "1w ago", t: "Active users dropped −18% wow", kind: "alert" },
    { d: "3w ago", t: "Renewal call · proposal sent ($82k ARR)", kind: "deal" },
    { d: "8w ago", t: "Champion (Carlos R.) left the company", kind: "alert" },
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
