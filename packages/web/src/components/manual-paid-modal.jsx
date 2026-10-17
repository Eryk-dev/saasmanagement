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
//
// 17/10/2026 (Leo): o VALOR recebido é editável e o dinheiro pode ter entrado
// em mais de uma vez — cada linha tem data, meio e valor; o servidor grava as
// partes na prova (paidProof.payments), a fatura passa a valer o total que
// entrou (o combinado fica em originalAmount) e o caixa conta cada parte na
// sua data. Pro link (sem fatura própria) continua uma entrada só.

const { useState } = React;
const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const inputStyle = { height: 36, padding: "0 12px", borderRadius: "var(--r-2)", border: "1px solid var(--line-1)", background: "var(--bg-1)", color: "var(--fg-1)", fontSize: 13, width: "100%" };
const field = { display: "flex", flexDirection: "column", gap: 4 };
const today = () => new Date().toISOString().slice(0, 10);
const num = (v) => { const n = Number(String(v ?? "").replace(/\./g, "").replace(",", ".")); return Number.isFinite(n) ? n : 0; };
const r2 = (n) => Math.round(n * 100) / 100;

const COPY = {
  link: { titulo: "Marcar como pago", botao: "marcar como pago", nota: "vale pra dinheiro que entrou FORA deste link. Pagamento pelo próprio link o gateway confirma sozinho. Fica registrado na timeline quem marcou." },
  invoice: { titulo: "Dar baixa com prova", botao: "dar baixa", nota: "dinheiro que entrou fora dos gateways (PIX direto, boleto no banco, dinheiro). Sem data e meio a baixa não vale: é o que separa recebido de suposição." },
  confirm: { titulo: "Confirmar recebimento", botao: "confirmar", nota: "essa fatura nasceu paga no fechamento à vista e ninguém provou o dinheiro. Confirmando com data e meio, ela sai de presumido e entra no recebido." },
};

function ManualPaidModal({ link, target, onClose, onDone }) {
  const t = target || (link ? { kind: "link", id: link.id, amount: link.amount, title: link.title, targetName: link.targetName } : null);
  const multi = t?.kind !== "link";
  const [rows, setRows] = useState(() => [{ at: t?.at ? String(t.at).slice(0, 10) : today(), method: t?.method || "pix", amount: t?.amount != null ? String(Number(t.amount).toFixed(2)).replace(".", ",") : "", note: "" }]);
  const [note, setNote] = useState("");
  // Entrada + restante parcelado: liga quando o recebido fica abaixo do
  // combinado e o cliente vai pagar o resto em parcelas.
  const [parcelar, setParcelar] = useState(false);
  const [nParc, setNParc] = useState(2);
  const [firstDue, setFirstDue] = useState(() => { const d = new Date(); d.setDate(d.getDate() + 30); return d.toISOString().slice(0, 10); });
  const [remMethod, setRemMethod] = useState("boleto");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const copy = COPY[t?.kind] || COPY.invoice;
  const total = r2(rows.reduce((a, r) => a + num(r.amount), 0));
  const combinado = r2(Number(t?.amount) || 0);
  const difere = multi && Math.abs(total - combinado) >= 0.01;
  const falta = r2(combinado - total);
  const podeParcelar = multi && falta >= 0.01;
  const setRow = (i, patch) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const addRow = () => setRows((rs) => {
    const falta = r2(combinado - total);
    return [...rs, { at: today(), method: "pix", amount: falta > 0 ? String(falta.toFixed(2)).replace(".", ",") : "", note: "" }];
  });
  const removeRow = (i) => setRows((rs) => rs.filter((_, j) => j !== i));

  const submitting = React.useRef(false);
  async function confirm() {
    if (submitting.current || !t) return;
    if (multi && rows.some((r) => !(num(r.amount) > 0))) { setError("Informe o valor de cada pagamento."); return; }
    submitting.current = true;
    setBusy(true); setError(null);
    try {
      const body = multi
        ? { payments: rows.map((r) => ({ at: r.at, method: r.method, amount: num(r.amount), note: r.note.trim() })), note: note.trim(),
          ...(podeParcelar && parcelar ? { remainder: { installments: Number(nParc) || 1, firstDue, method: remMethod } } : {}) }
        : { at: rows[0].at, method: rows[0].method, note: note.trim() };
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
    <Modal onClose={onClose} fechavel={!busy} label={copy.titulo} largura={multi ? 560 : 420}
      painelStyle={{ padding: "20px 22px", display: "flex", flexDirection: "column", gap: 12 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 600 }}>{copy.titulo}</div>
          <div className="mono dim" style={{ fontSize: 12, marginTop: 6, lineHeight: 1.5 }}>
            <span style={{ color: "var(--fg-1)", fontWeight: 600 }}>{BRL.format(combinado)}</span>
            {t?.title ? ` · ${t.title}` : ""}{t?.targetName ? ` · ${t.targetName}` : ""}
            {multi ? " · valor combinado" : ""}
          </div>
        </div>

        {rows.map((r, i) => (
          <div key={i} style={{ display: "grid", gridTemplateColumns: multi ? "1fr 1fr 110px 28px" : "1fr 1fr", gap: 8, alignItems: "end" }}>
            <label style={field}>
              <span className="kicker">{rows.length > 1 ? `Quando entrou (${i + 1})` : "Quando entrou"}</span>
              <input type="date" value={r.at} max={today()} onChange={(e) => setRow(i, { at: e.target.value })} style={{ ...inputStyle, fontFamily: "var(--mono)" }} />
            </label>
            <label style={field}>
              <span className="kicker">Como entrou</span>
              <select value={r.method} onChange={(e) => setRow(i, { method: e.target.value })} style={inputStyle}>
                {MANUAL_PAY_METHODS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
              </select>
            </label>
            {multi && (
              <label style={field}>
                <span className="kicker">Valor (R$)</span>
                <input type="text" inputMode="decimal" value={r.amount} onChange={(e) => setRow(i, { amount: e.target.value })} placeholder="0,00"
                  style={{ ...inputStyle, fontFamily: "var(--mono)", textAlign: "right" }} />
              </label>
            )}
            {multi && (
              <button type="button" onClick={() => removeRow(i)} disabled={rows.length === 1} aria-label={`Remover pagamento ${i + 1}`} className="dim"
                style={{ height: 36, fontSize: 15, opacity: rows.length === 1 ? 0.3 : 1 }}>✕</button>
            )}
          </div>
        ))}
        {multi && (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <button type="button" onClick={addRow} style={{ fontSize: 12.5, fontWeight: 600, color: "var(--accent)" }}>+ outro pagamento</button>
            <span className="mono" style={{ fontSize: 12, color: difere ? "var(--warn)" : "var(--fg-3)" }}>
              recebido {BRL.format(total)}{difere ? ` · ${total < combinado ? "faltam" : "a mais"} ${BRL.format(Math.abs(combinado - total))}${parcelar && podeParcelar ? "" : " · a fatura passa a valer o recebido"}` : " · igual ao combinado"}
            </span>
          </div>
        )}
        {podeParcelar && (
          <div style={{ padding: "10px 12px", borderRadius: "var(--r-2)", background: "var(--bg-inset)", border: "1px solid var(--line-1)", display: "flex", flexDirection: "column", gap: 8 }}>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, cursor: "pointer" }}>
              <input type="checkbox" checked={parcelar} onChange={(e) => setParcelar(e.target.checked)} />
              foi uma <b>entrada</b>: o restante ({BRL.format(falta)}) ficou parcelado
            </label>
            {parcelar && (
              <div style={{ display: "grid", gridTemplateColumns: "90px 1fr 1fr", gap: 8 }}>
                <label style={field}>
                  <span className="kicker">Parcelas</span>
                  <select value={nParc} onChange={(e) => setNParc(e.target.value)} style={inputStyle}>
                    {Array.from({ length: 36 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}x · {BRL.format(r2(falta / n))}</option>)}
                  </select>
                </label>
                <label style={field}>
                  <span className="kicker">1º vencimento</span>
                  <input type="date" value={firstDue} onChange={(e) => setFirstDue(e.target.value)} style={{ ...inputStyle, fontFamily: "var(--mono)" }} />
                </label>
                <label style={field}>
                  <span className="kicker">Meio combinado</span>
                  <select value={remMethod} onChange={(e) => setRemMethod(e.target.value)} style={inputStyle}>
                    {MANUAL_PAY_METHODS.filter((m) => m.id !== "dinheiro").map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                  </select>
                </label>
                <div className="mono dim" style={{ gridColumn: "1 / -1", fontSize: 10.5 }}>
                  a fatura vira a entrada (paga) e nascem {Number(nParc) || 1} parcela{Number(nParc) > 1 ? "s" : ""} em aberto, mensais a partir do 1º vencimento; elas aparecem em A receber e na ficha do cliente
                </div>
              </div>
            )}
          </div>
        )}

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
