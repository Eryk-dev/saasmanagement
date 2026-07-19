import React from "react";
import { Avatar } from "../atoms.jsx";
import { api } from "../lib/api.js";
import { displayName, currentUser } from "../lib/users.js";

// Timeline do lead: activities (pontos de contato + eventos automáticos) +
// comments[] legados mesclados visualmente como notas. Append-only na UI.
// Toque registrado aqui re-agenda o próximo passo sozinho (servidor,
// onActivityCreated) — registrar o contato É marcar o próximo.

const TYPE_META = {
  note:     { glyph: "✎", label: "nota" },
  whatsapp: { glyph: "W", label: "whatsapp" },
  call:     { glyph: "✆", label: "call" },
  email:    { glyph: "@", label: "e-mail" },
  meeting:  { glyph: "◈", label: "reunião" },
  stage:    { glyph: "→", label: "estágio" },
  system:   { glyph: "⚙", label: "sistema" },
};

const SYSTEM_TEXT = {
  meet_created: (m) => `Meet criado na agenda${(m.attendees || []).length ? ` · ${m.attendees.length} convidado(s)` : ""}`,
  lead_created: (m) => `Lead criado${m.via === "form" ? " pelo formulário" : ""}${m.stage ? ` em “${m.stage}”` : ""}`,
  proposal_viewed: (m) => `Proposta visualizada${m.viewer === "cliente" ? " pelo cliente" : m.viewer === "time" ? " (pelo time)" : " pela 1ª vez"}${m.device ? ` · ${m.device}` : ""}`,
  proposal_shared: (m) => `Proposta enviada pro cliente${m.label ? ` · ${m.label}` : ""}`,
  proposal_accepted: (m) => `Proposta aceita${m.stage ? ` → “${m.stage}”` : ""}`,
  customer_created: () => "Virou cliente 🎉",
};

function when(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  const hm = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  if (days === 0) return `hoje ${hm}`;
  if (days === 1) return `ontem ${hm}`;
  if (days < 7) return `${days}d atrás`;
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }).replace(".", "");
}

function itemText(a) {
  // Resumo de call e briefing de integração gerados pela IA: texto completo
  // multiline + link da gravação.
  if (a.type === "system" && (a.meta?.event === "call_summary" || a.meta?.event === "integration_brief")) {
    return (
      <div>
        <div style={{ whiteSpace: "pre-wrap", color: "var(--fg-1)" }}>{a.text}</div>
        {a.meta.recordingUrl && (
          <a href={a.meta.recordingUrl} target="_blank" rel="noopener noreferrer"
            style={{ color: "var(--accent)", fontSize: 11.5, display: "inline-block", marginTop: 6 }}>
            🎥 ver gravação no Drive
          </a>
        )}
      </div>
    );
  }
  if (a.type === "stage") {
    const from = a.meta?.from || "?";
    const to = a.meta?.to || "?";
    const lost = a.meta?.lostReason ? ` · motivo: ${a.meta.lostReason}` : "";
    return `${from} → ${to}${lost}`;
  }
  if (a.type === "system") {
    const f = SYSTEM_TEXT[a.meta?.event];
    return f ? f(a.meta || {}) : (a.text || a.meta?.event || "evento");
  }
  return a.text || TYPE_META[a.type]?.label || "";
}

// Mescla comments[] legados (shape { id, author, text, at }) como notas.
export function mergeTimeline(activities, comments) {
  const legacy = (Array.isArray(comments) ? comments : []).map((c) => ({
    id: `cm_${c.id}`, type: "note", text: c.text, author: c.author, at: c.at, _legacy: true,
  }));
  return [...(activities || []), ...legacy]
    .sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")));
}

export function ActivityList({ activities, comments, compact }) {
  const items = mergeTimeline(activities, comments);
  if (!items.length) {
    return <div className="mono dim" style={{ fontSize: 11.5, padding: "10px 0" }}>nenhum contato registrado ainda</div>;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {items.map((a) => {
        const meta = TYPE_META[a.type] || TYPE_META.note;
        const auto = a.type === "stage" || a.type === "system";
        return (
          <div key={a.id} style={{ display: "flex", gap: 9, padding: compact ? "5px 0" : "7px 0", borderBottom: "1px solid var(--line-1)", alignItems: "flex-start" }}>
            <span className="mono" title={meta.label} style={{
              width: 20, height: 20, borderRadius: 6, flexShrink: 0, marginTop: 1,
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              fontSize: 11, background: auto ? "var(--bg-2)" : "var(--bg-3)",
              border: "1px solid var(--line-1)", color: auto ? "var(--fg-4)" : "var(--fg-2)",
            }}>{meta.glyph}</span>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: compact ? 12 : 12.5, color: auto ? "var(--fg-3)" : "var(--fg-1)", overflowWrap: "break-word" }}>
                {itemText(a)}
              </div>
              <div className="mono" style={{ fontSize: 10, color: "var(--fg-4)", marginTop: 2, display: "flex", alignItems: "center", gap: 5 }}>
                {when(a.at)}
                {a.author && a.author !== "system" && a.author !== "api" && a.author !== "lead" && (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                    · <Avatar id={a.author} name={displayName(a.author)} size={13} /> {displayName(a.author)}
                  </span>
                )}
                {a.author === "lead" && <span>· lead</span>}
                {a._legacy && <span title="comentário antigo (pré-timeline)">· comentário</span>}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Composer: registra toque/nota + atalho de próximo contato. O atalho faz PATCH
// de nextActionAt junto — sem ele, toque re-agenda sozinho pela cadência.
const NEXT_PRESETS = [
  { key: "+1d", label: "+1d", ms: 86_400_000 },
  { key: "+2d", label: "+2d", ms: 2 * 86_400_000 },
  { key: "+1sem", label: "+1sem", ms: 7 * 86_400_000 },
];

export function ActivityComposer({ lead, onLogged }) {
  const [type, setType] = React.useState("whatsapp");
  const [text, setText] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  async function log(nextMs) {
    if (busy) return;
    const t = text.trim();
    if (!t && type === "note") return; // nota vazia não existe
    setBusy(true);
    try {
      const a = await api.logActivity({
        saas: lead.saas, lead: lead.id, type, text: t,
        author: currentUser()?.id || "",
        // preset de próximo contato vence o re-agendamento automático da cadência
        ...(nextMs ? { meta: { reschedule: false } } : {}),
      });
      if (nextMs) {
        await api.update("leads", lead.id, { nextActionAt: new Date(Date.now() + nextMs).toISOString() });
      }
      setText("");
      onLogged && onLogged(a);
    } catch (err) {
      console.warn("activity não registrada:", err.message);
    } finally {
      setBusy(false);
    }
  }

  const seg = (k, label) => (
    <button key={k} onClick={() => setType(k)} style={{
      height: 24, padding: "0 9px", borderRadius: 4, fontSize: 11, fontFamily: "var(--mono)",
      background: type === k ? "var(--bg-3)" : "transparent",
      color: type === k ? "var(--fg-1)" : "var(--fg-3)",
      border: "1px solid " + (type === k ? "var(--line-2)" : "transparent"),
    }}>{label}</button>
  );

  return (
    <div style={{ border: "1px solid var(--line-1)", borderRadius: "var(--r-2)", background: "var(--bg-inset)", padding: 8 }}>
      <div style={{ display: "flex", gap: 2, marginBottom: 6, flexWrap: "wrap" }}>
        {seg("whatsapp", "wpp")}{seg("call", "call")}{seg("meeting", "reunião")}{seg("email", "e-mail")}{seg("note", "nota")}
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) log(); }}
        rows={2}
        placeholder={type === "note" ? "anotação…" : "o que rolou nesse contato? (⌘↵ registra)"}
        style={{ width: "100%", padding: "7px 9px", background: "var(--bg-1)", border: "1px solid var(--line-2)", borderRadius: "var(--r-2)", color: "var(--fg-1)", fontSize: 12.5, resize: "vertical" }}
      />
      <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 6, flexWrap: "wrap" }}>
        <span className="mono" style={{ fontSize: 10, color: "var(--fg-4)" }}>registrar + próximo:</span>
        {NEXT_PRESETS.map((p) => (
          <button key={p.key} disabled={busy} onClick={() => log(p.ms)} title={`registra o ${TYPE_META[type].label} e marca o próximo contato pra ${p.label}`}
            style={{ height: 22, padding: "0 8px", borderRadius: 4, fontSize: 10.5, fontFamily: "var(--mono)", background: "var(--bg-2)", border: "1px solid var(--line-2)", color: "var(--fg-2)", cursor: "pointer" }}>
            {p.label}
          </button>
        ))}
        <button disabled={busy} onClick={() => log()} style={{
          marginLeft: "auto", height: 24, padding: "0 12px", borderRadius: 4, fontSize: 11.5, fontWeight: 600,
          background: "var(--btn-bg, var(--accent))", color: "var(--btn-fg, var(--accent-fg, #fff))", border: "none", cursor: "pointer", opacity: busy ? 0.6 : 1,
        }}>registrar</button>
      </div>
    </div>
  );
}
