import React from "react";
import { api } from "../lib/api.js";
import { useEsc } from "../atoms.jsx";
import { MANUAL_PAY_METHODS } from "../lib/payments.js";

// Baixa MANUAL de um link de pagamento (tela Links de pagamento): o cliente
// pagou por fora do link (PIX direto, boleto, dinheiro) e alguém confirma à
// mão. Só muda o status do link e os totais da tela: não cria fatura nem mexe
// no cliente (essas portas são a ficha do cliente e o Financeiro).

const { useState } = React;
const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const inputStyle = { height: 36, padding: "0 12px", borderRadius: "var(--r-2)", border: "1px solid var(--line-2)", background: "var(--bg-1)", color: "var(--fg-1)", fontSize: 13, width: "100%" };
const field = { display: "flex", flexDirection: "column", gap: 4 };
const today = () => new Date().toISOString().slice(0, 10);

function ManualPaidModal({ link, onClose, onDone }) {
  const [at, setAt] = useState(today());
  const [method, setMethod] = useState("pix");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  useEsc(onClose);

  async function confirm() {
    setBusy(true); setError(null);
    try {
      const r = await api.payPaymentLink(link.id, { at, method, note: note.trim() });
      await onDone(r);
    } catch (err) {
      setBusy(false);
      setError(err.message || String(err));
    }
  }

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "oklch(0 0 0 / 0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 80 }}
      onClick={onClose}
    >
      <div onClick={(e) => e.stopPropagation()} style={{ width: "min(420px, calc(100vw - 32px))", background: "var(--bg-1)", border: "1px solid var(--line-2)", borderRadius: "var(--r-3)", boxShadow: "var(--shadow-pop)", padding: "20px 22px", display: "flex", flexDirection: "column", gap: 12 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 600 }}>Marcar como pago</div>
          <div className="mono dim" style={{ fontSize: 12, marginTop: 6, lineHeight: 1.5 }}>
            <span style={{ color: "var(--fg-1)", fontWeight: 600 }}>{BRL.format(Number(link.amount) || 0)}</span>
            {link.title ? ` · ${link.title}` : ""}{link.targetName ? ` · ${link.targetName}` : ""}
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <label style={field}>
            <span className="kicker">Quando entrou</span>
            <input type="date" value={at} max={today()} onChange={(e) => setAt(e.target.value)} style={{ ...inputStyle, fontFamily: "var(--mono)" }} />
          </label>
          <label style={field}>
            <span className="kicker">Como entrou</span>
            <select value={method} onChange={(e) => setMethod(e.target.value)} style={inputStyle}>
              {MANUAL_PAY_METHODS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </label>
        </div>
        <label style={field}>
          <span className="kicker">Observação</span>
          <input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="opcional: comprovante, quem confirmou…"
            onKeyDown={(e) => { if (e.key === "Enter") confirm(); }} style={inputStyle} autoFocus />
        </label>
        <div className="mono dim" style={{ fontSize: 10.5, lineHeight: 1.5 }}>
          vale pra dinheiro que entrou FORA deste link. Pagamento pelo próprio link o Mercado Pago confirma sozinho. Fica registrado na timeline quem marcou.
        </div>
        {error && <div className="mono" style={{ fontSize: 11, color: "var(--neg)" }}>{error}</div>}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{ padding: "8px 14px", background: "var(--bg-2)", border: "1px solid var(--line-2)", borderRadius: "var(--r-2)", fontSize: 13 }}>Cancelar</button>
          <button onClick={confirm} disabled={busy} style={{ padding: "8px 14px", background: "var(--btn-bg)", color: "var(--btn-fg)", borderRadius: "var(--r-2)", fontSize: 13, fontWeight: 600, opacity: busy ? 0.6 : 1 }}>
            {busy ? "marcando…" : "marcar como pago"}
          </button>
        </div>
      </div>
    </div>
  );
}

export { ManualPaidModal };
