import React from "react";
import { api } from "../lib/api.js";
import { Modal } from "./overlay.jsx";
import { MANUAL_PAY_METHODS } from "../lib/payments.js";

// A PROVA do recebimento (12/10/2026): quando entrou, como entrou e uma nota.
// Serve pra TRÊS portas, com a mesma pergunta:
//   · link de pagamento pago por fora (payPaymentLink) — o servidor dá baixa
//     na fatura do link, ou cria a fatura avulsa do cliente;
//   · fatura/parcela baixada à mão (payInvoice) — Clientes, Cobranças, Links;
//   · fatura PRESUMIDA (nasceu paga no fechamento) confirmada (confirmInvoice)
//     — Financeiro → Resumo.
// `target` = { kind: "link" | "invoice" | "confirm", id, amount, title, targetName }.
// `link` continua aceito (compatibilidade com a tela de Links).

const { useState } = React;
const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const inputStyle = { height: 36, padding: "0 12px", borderRadius: "var(--r-2)", border: "1px solid var(--line-1)", background: "var(--bg-1)", color: "var(--fg-1)", fontSize: 13, width: "100%" };
const field = { display: "flex", flexDirection: "column", gap: 4 };
const today = () => new Date().toISOString().slice(0, 10);

const COPY = {
  link: { titulo: "Marcar como pago", botao: "marcar como pago", nota: "vale pra dinheiro que entrou FORA deste link. Pagamento pelo próprio link o Mercado Pago confirma sozinho. Fica registrado na timeline quem marcou." },
  invoice: { titulo: "Dar baixa com prova", botao: "dar baixa", nota: "dinheiro que entrou fora do Mercado Pago (PIX direto, boleto no banco, dinheiro). Sem data e meio a baixa não vale: é o que separa recebido de suposição." },
  confirm: { titulo: "Confirmar recebimento", botao: "confirmar", nota: "essa fatura nasceu paga no fechamento à vista e ninguém provou o dinheiro. Confirmando com data e meio, ela sai de presumido e entra no recebido." },
};

function ManualPaidModal({ link, target, onClose, onDone }) {
  const t = target || (link ? { kind: "link", id: link.id, amount: link.amount, title: link.title, targetName: link.targetName } : null);
  const [at, setAt] = useState(t?.at ? String(t.at).slice(0, 10) : today());
  const [method, setMethod] = useState(t?.method || "pix");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const copy = COPY[t?.kind] || COPY.invoice;

  const submitting = React.useRef(false);
  async function confirm() {
    if (submitting.current || !t) return;
    submitting.current = true;
    setBusy(true); setError(null);
    try {
      const body = { at, method, note: note.trim() };
      const r = t.kind === "link" ? await api.payPaymentLink(t.id, body)
        : t.kind === "confirm" ? await api.confirmInvoice(t.id, body)
        : await api.payInvoice(t.id, body);
      await onDone(r);
    } catch (err) {
      submitting.current = false;
      setBusy(false);
      setError(err.message || String(err));
    }
  }

  return (
    <Modal onClose={onClose} fechavel={!busy} label={copy.titulo} largura={420}
      painelStyle={{ padding: "20px 22px", display: "flex", flexDirection: "column", gap: 12 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 600 }}>{copy.titulo}</div>
          <div className="mono dim" style={{ fontSize: 12, marginTop: 6, lineHeight: 1.5 }}>
            <span style={{ color: "var(--fg-1)", fontWeight: 600 }}>{BRL.format(Number(t?.amount) || 0)}</span>
            {t?.title ? ` · ${t.title}` : ""}{t?.targetName ? ` · ${t.targetName}` : ""}
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
            onKeyDown={(e) => { if (e.key === "Enter") confirm(); }} style={inputStyle} />
        </label>
        <div className="mono dim" style={{ fontSize: 10.5, lineHeight: 1.5 }}>{copy.nota}</div>
        {error && <div role="alert" className="mono" style={{ fontSize: 11, color: "var(--neg)" }}>{error}</div>}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button onClick={onClose} disabled={busy} style={{ padding: "8px 14px", background: "var(--bg-2)", border: "1px solid var(--line-1)", borderRadius: "var(--r-2)", fontSize: 13 }}>Cancelar</button>
          <button onClick={confirm} disabled={busy} style={{ padding: "8px 14px", background: "var(--btn-bg)", color: "var(--btn-fg)", borderRadius: "var(--r-2)", fontSize: 13, fontWeight: 600, opacity: busy ? 0.6 : 1 }}>
            {busy ? "salvando…" : copy.botao}
          </button>
        </div>
    </Modal>
  );
}

export { ManualPaidModal };
