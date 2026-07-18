import React from "react";

// Peças de conversa de WhatsApp reusadas pelo inbox (tela) e pelo chat do drawer:
// WaBubbles (histórico) + WaComposer (envio). As mensagens vêm do wa-store
// (GET /api/whatsapp/threads/:id): { direction:"in"|"out", text, at, status }.

function hhmm(iso) {
  const d = new Date(iso || 0);
  return Number.isFinite(d.getTime()) ? d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "";
}

function dayLabel(iso) {
  const d = new Date(iso || 0);
  if (!Number.isFinite(d.getTime())) return "";
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (days <= 0 && new Date().getDate() === d.getDate()) return "hoje";
  if (days <= 1) return "ontem";
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }).replace(".", "");
}

// Ticks de status da mensagem enviada (espelha o WhatsApp).
function StatusTicks({ status }) {
  if (status === "failed") return <span title="falhou" style={{ color: "#e5484d" }}>⚠</span>;
  const read = status === "read";
  return <span title={status || "enviado"} style={{ color: read ? "#4aa3ff" : "var(--fg-4)", letterSpacing: -2 }}>{status === "sent" || status === "received" ? "✓" : "✓✓"}</span>;
}

export function WaBubbles({ messages, emptyHint }) {
  const ref = React.useRef(null);
  React.useEffect(() => { const el = ref.current; if (el) el.scrollTop = el.scrollHeight; }, [messages.length]);
  if (!messages.length) {
    return <div className="mono dim" style={{ fontSize: 11.5, padding: "24px 0", textAlign: "center" }}>{emptyHint || "nenhuma mensagem ainda"}</div>;
  }
  let lastDay = "";
  return (
    <div ref={ref} style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 5, padding: "6px 4px" }}>
      {messages.map((m) => {
        const out = m.direction === "out";
        const day = dayLabel(m.at);
        const sep = day && day !== lastDay ? (lastDay = day) : null;
        return (
          <React.Fragment key={m.id}>
            {sep && (
              <div style={{ alignSelf: "center", margin: "6px 0", fontSize: 10, fontFamily: "var(--mono)", color: "var(--fg-4)", background: "var(--bg-2)", border: "1px solid var(--line-1)", borderRadius: 999, padding: "2px 10px" }}>{sep}</div>
            )}
            <div style={{ alignSelf: out ? "flex-end" : "flex-start", maxWidth: "80%" }}>
              <div style={{
                padding: "7px 10px", borderRadius: 10, fontSize: 12.5, lineHeight: 1.4, whiteSpace: "pre-wrap", overflowWrap: "break-word",
                background: out ? "var(--wa-out, #d6f5cf)" : "var(--bg-3)", color: out ? "#0c2318" : "var(--fg-1)",
                borderBottomRightRadius: out ? 3 : 10, borderBottomLeftRadius: out ? 10 : 3,
              }}>{m.text}</div>
              <div className="mono" style={{ fontSize: 9.5, color: "var(--fg-4)", marginTop: 2, display: "flex", gap: 4, justifyContent: out ? "flex-end" : "flex-start" }}>
                {hhmm(m.at)}{out && <StatusTicks status={m.status} />}
              </div>
            </div>
          </React.Fragment>
        );
      })}
    </div>
  );
}

// Composer: textarea + enviar. onSend(text) → Promise; devolve erro pra mostrar.
// `templates` = [{ group, items:[{ label, text }] }] com os tokens JÁ
// preenchidos: escolher só ESCREVE na caixa (nunca dispara), porque a última
// palavra sobre o que vai pro cliente é de quem está na conversa.
export function WaComposer({ onSend, disabled, placeholder, templates }) {
  const [text, setText] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState("");
  const [openTpl, setOpenTpl] = React.useState(false);
  const boxRef = React.useRef(null);

  async function send() {
    const t = text.trim();
    if (!t || busy || disabled) return;
    setBusy(true); setErr("");
    try { await onSend(t); setText(""); }
    catch (e) { setErr(e?.message || "não foi possível enviar"); }
    finally { setBusy(false); }
  }

  // Caixa com rascunho não é sobrescrita: o modelo entra embaixo do que já
  // estava escrito (dois modelos seguidos viram uma mensagem só).
  function useTemplate(t) {
    setText((prev) => (prev.trim() ? `${prev.replace(/\s+$/, "")}\n\n${t}` : t));
    setOpenTpl(false);
    requestAnimationFrame(() => {
      const el = boxRef.current;
      if (el) { el.focus(); el.selectionStart = el.selectionEnd = el.value.length; }
    });
  }

  const groups = Array.isArray(templates) ? templates.filter((g) => g?.items?.length) : [];

  return (
    <div>
      {err && <div style={{ fontSize: 11, color: "#e5484d", marginBottom: 6 }}>{err}</div>}
      {groups.length > 0 && (
        <div style={{ position: "relative", marginBottom: 6 }}>
          <button onClick={() => setOpenTpl((v) => !v)} disabled={disabled}
            title="Mensagens prontas do fluxo de qualificação"
            style={{ display: "inline-flex", alignItems: "center", gap: 5, height: 26, padding: "0 10px", borderRadius: "var(--r-2)", border: "1px solid var(--line-2)", background: openTpl ? "var(--bg-2)" : "var(--bg-1)", color: "var(--fg-2)", fontSize: 11.5, fontWeight: 600, cursor: "pointer", opacity: disabled ? 0.5 : 1 }}>
            ⚡ modelos
          </button>
          {openTpl && (
            <>
              <div onClick={() => setOpenTpl(false)} style={{ position: "fixed", inset: 0, zIndex: 60 }} />
              <div style={{ position: "absolute", bottom: "calc(100% + 6px)", left: 0, zIndex: 61, width: 340, maxHeight: "min(52vh, 460px)", overflowY: "auto", background: "var(--bg-1)", border: "1px solid var(--line-2)", borderRadius: "var(--r-3)", boxShadow: "var(--shadow-pop)", padding: 6 }}>
                {groups.map((g) => (
                  <div key={g.group} style={{ marginBottom: 4 }}>
                    <div className="mono" style={{ fontSize: 9.5, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--fg-4)", padding: "6px 8px 4px" }}>{g.group}</div>
                    {g.items.map((it) => (
                      <button key={it.label} onClick={() => useTemplate(it.text)} title={it.text}
                        style={{ display: "block", width: "100%", textAlign: "left", padding: "6px 8px", borderRadius: 6, border: 0, background: "transparent", color: "var(--fg-1)", fontSize: 12, cursor: "pointer", lineHeight: 1.35 }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-2)"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}>
                        {it.label}
                        <span style={{ display: "block", color: "var(--fg-4)", fontSize: 10.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.text.replace(/\n+/g, " ")}</span>
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
      <div style={{ display: "flex", gap: 6, alignItems: "flex-end" }}>
        <textarea
          ref={boxRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
          rows={1}
          disabled={disabled}
          placeholder={disabled ? (placeholder || "sem telefone") : (placeholder || "mensagem… (↵ envia, Shift+↵ quebra linha)")}
          style={{ flex: 1, padding: "9px 11px", background: "var(--bg-1)", border: "1px solid var(--line-2)", borderRadius: "var(--r-2)", color: "var(--fg-1)", fontSize: 12.5, resize: "vertical", maxHeight: 140 }}
        />
        <button disabled={busy || !text.trim() || disabled} onClick={send} style={{
          height: 38, padding: "0 16px", borderRadius: "var(--r-2)", fontSize: 12.5, fontWeight: 700,
          background: "#25D366", color: "#06120c", border: "none", cursor: "pointer", opacity: busy || !text.trim() || disabled ? 0.55 : 1, flexShrink: 0,
        }}>{busy ? "…" : "Enviar"}</button>
      </div>
    </div>
  );
}
