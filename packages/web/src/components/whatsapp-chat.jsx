import React from "react";
import { api } from "../lib/api.js";
import { waLink } from "../lib/ui.js";

// Chat de WhatsApp dentro do drawer do lead (Cloud API): o SDR lê a conversa e
// responde sem sair do cockpit. As mensagens são as activities `whatsapp` do
// lead (meta.direction in|out + status); enviar chama /api/leads/:id/whatsapp.
// "Ligar" abre a conversa no app do WhatsApp (deep-link) — a Cloud API não faz
// chamada de voz pelo navegador, então ligar é sempre no app.

function hhmm(iso) {
  const d = new Date(iso || 0);
  return Number.isFinite(d.getTime()) ? d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "";
}

// Ticks de status da mensagem enviada (espelha o WhatsApp: 1 traço enviado,
// 2 entregue, 2 azuis lido, ⚠ falhou).
function StatusTicks({ status }) {
  if (status === "failed") return <span title="falhou" style={{ color: "#e5484d" }}>⚠</span>;
  const read = status === "read";
  return (
    <span title={status || "enviado"} style={{ color: read ? "#4aa3ff" : "var(--fg-4)", letterSpacing: -2 }}>
      {status === "sent" ? "✓" : "✓✓"}
    </span>
  );
}

export function WhatsappChat({ lead, activities, onSent }) {
  const [text, setText] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState("");
  const scrollRef = React.useRef(null);
  const configured = !!window.SEED?.CONFIG?.whatsapp?.configured;
  const wa = waLink(lead.phone); // deep-link (abre a conversa no WhatsApp)

  // Só as mensagens de WhatsApp, em ordem de conversa (mais antiga em cima).
  const msgs = React.useMemo(
    () => (activities || [])
      .filter((a) => a.type === "whatsapp")
      .sort((a, b) => String(a.at || "").localeCompare(String(b.at || ""))),
    [activities],
  );

  // Rola pro fim quando chega/parte mensagem.
  React.useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs.length]);

  async function send() {
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true); setErr("");
    try {
      await api.sendWhatsapp(lead.id, t);
      setText("");
      onSent && onSent();
    } catch (e) {
      setErr(e?.message || "não foi possível enviar");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ ...box, display: "flex", flexDirection: "column", minHeight: 200 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <span className="mono" style={{ fontSize: 10.5, letterSpacing: 1, textTransform: "uppercase", color: "var(--fg-4)" }}>WhatsApp</span>
        <span className="mono dim" style={{ fontSize: 10.5 }}>{lead.phone || "sem telefone"}</span>
        {wa && (
          <a href={wa} target="_blank" rel="noopener noreferrer" title="Ligar / abrir no WhatsApp"
            style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 5, height: 26, padding: "0 10px", borderRadius: 6, background: "#25D366", color: "#06120c", fontSize: 12, fontWeight: 700, textDecoration: "none" }}>
            ✆ Ligar
          </a>
        )}
      </div>

      {/* histórico da conversa */}
      <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", maxHeight: 300, display: "flex", flexDirection: "column", gap: 6, padding: "4px 2px" }}>
        {msgs.length === 0 ? (
          <div className="mono dim" style={{ fontSize: 11.5, padding: "16px 0", textAlign: "center" }}>
            nenhuma mensagem ainda{configured ? " · manda a primeira abaixo" : ""}
          </div>
        ) : msgs.map((m) => {
          const out = m.meta?.direction === "out";
          return (
            <div key={m.id} style={{ alignSelf: out ? "flex-end" : "flex-start", maxWidth: "82%" }}>
              <div style={{
                padding: "7px 10px", borderRadius: 10, fontSize: 12.5, lineHeight: 1.4, whiteSpace: "pre-wrap", overflowWrap: "break-word",
                background: out ? "var(--wa-out, #d6f5cf)" : "var(--bg-3)",
                color: out ? "#0c2318" : "var(--fg-1)",
                borderBottomRightRadius: out ? 3 : 10, borderBottomLeftRadius: out ? 10 : 3,
              }}>
                {m.text}
              </div>
              <div className="mono" style={{ fontSize: 9.5, color: "var(--fg-4)", marginTop: 2, textAlign: out ? "right" : "left", display: "flex", gap: 4, justifyContent: out ? "flex-end" : "flex-start" }}>
                {hhmm(m.at)}
                {out && <StatusTicks status={m.meta?.status} />}
              </div>
            </div>
          );
        })}
      </div>

      {/* composer */}
      {configured ? (
        <div style={{ marginTop: 8 }}>
          {err && <div style={{ fontSize: 11, color: "#e5484d", marginBottom: 6 }}>{err}</div>}
          <div style={{ display: "flex", gap: 6, alignItems: "flex-end" }}>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
              rows={1}
              placeholder={lead.phone ? "mensagem… (↵ envia, Shift+↵ quebra linha)" : "lead sem telefone"}
              disabled={!lead.phone}
              style={{ flex: 1, padding: "8px 10px", background: "var(--bg-1)", border: "1px solid var(--line-2)", borderRadius: "var(--r-2)", color: "var(--fg-1)", fontSize: 12.5, resize: "vertical", maxHeight: 120 }}
            />
            <button disabled={busy || !text.trim() || !lead.phone} onClick={send} style={{
              height: 36, padding: "0 14px", borderRadius: "var(--r-2)", fontSize: 12.5, fontWeight: 700,
              background: "#25D366", color: "#06120c", border: "none", cursor: "pointer", opacity: busy || !text.trim() ? 0.55 : 1, flexShrink: 0,
            }}>{busy ? "…" : "Enviar"}</button>
          </div>
          <div className="mono dim" style={{ fontSize: 9.5, marginTop: 5 }}>
            fora de 24h desde a última resposta do cliente, a Meta exige um template aprovado
          </div>
        </div>
      ) : (
        <div className="mono dim" style={{ fontSize: 11, marginTop: 8, padding: "8px 10px", border: "1px dashed var(--line-2)", borderRadius: "var(--r-2)" }}>
          WhatsApp ainda não configurado no servidor. Enquanto isso, o botão “Ligar” abre a conversa no app.
        </div>
      )}
    </div>
  );
}

const box = {
  background: "var(--bg-inset)", border: "1px solid var(--line-1)", borderRadius: "var(--r-2)", padding: "12px 14px",
};
