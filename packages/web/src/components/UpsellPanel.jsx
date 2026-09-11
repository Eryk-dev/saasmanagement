import React from "react";
import { api } from "../lib/api.js";
import { dealProductsOf } from "../lib/payments.js";
import { allUsers, currentUser, displayName } from "../lib/users.js";

// Painel "registrar upsell" da ficha do cliente (Clientes → popup). Mesma
// família do painel de churn: uma faixa inset logo abaixo do cabeçalho.
//
// O que ele grava (POST /customers/:id/upsell):
//   item        o que foi vendido — do catálogo do produto (SEED.CONFIG.
//               proposals.catalog, o mesmo do gate de fechamento) ou texto livre.
//   mode        sempre avulso (venda única): o "acréscimo na mensalidade" saiu
//               em 10/09/2026 junto com a recorrência.
//   amount      o que é cobrado.
//   payment     pago (data) · a receber (vencimento) · link do Mercado Pago.
//   soldBy      quem vendeu (padrão: quem está logado) — é a atribuição do
//               placar e da meta de upsell do CS.
const { useState, useMemo } = React;

const inputSt = { height: 28, padding: "0 8px", borderRadius: "var(--r-2)", border: "1px solid var(--line-2)", background: "var(--bg-1)", color: "var(--fg-1)", fontSize: 12.5 };
const selectSt = { ...inputSt, padding: "0 6px" };
const dateSt = { ...inputSt, padding: "0 6px", fontSize: 12, fontFamily: "var(--mono)" };
const lbl = { fontSize: 10.5, display: "inline-flex", alignItems: "center", gap: 5 };
const OTHER = "__outro__";

export function UpsellPanel({ customer, product, mpOn, onDone, onCancel }) {
  const saas = customer.saas || product?.id || "";
  // Catálogo do produto achatado em opções "Produto · plano (R$)" — o valor
  // sugerido preenche o campo, mas o CS pode ajustar (desconto, pró-rata).
  const options = useMemo(() => {
    const rows = [];
    for (const p of dealProductsOf(saas)) {
      const prices = Array.isArray(p.prices) && p.prices.length ? p.prices : [null];
      for (const pr of prices) {
        const label = pr ? `${p.label} · ${pr.label}` : p.label;
        rows.push({ key: `${p.id}|${pr?.label || ""}`, product: p.id, label, value: pr?.value || 0 });
      }
    }
    return rows;
  }, [saas]);
  const [pick, setPick] = useState(options.length ? "" : OTHER);
  const [itemTxt, setItemTxt] = useState("");
  const mode = "oneoff";
  const [amount, setAmount] = useState("");
  const [payment, setPayment] = useState("paid");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [inst, setInst] = useState("12");
  const [soldBy, setSoldBy] = useState(() => currentUser()?.id || customer.owner || "");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const picked = options.find((o) => o.key === pick) || null;
  const item = pick === OTHER ? itemTxt.trim() : (picked?.label || "");
  function choose(key) {
    setPick(key);
    const o = options.find((x) => x.key === key);
    if (!o) return;
    if (o.value > 0) setAmount(String(o.value));
  }
  const amountN = Number(amount) || 0;
  const canSave = !!item && !saving && soldBy && amountN > 0;

  async function save() {
    if (!canSave) return;
    setSaving(true); setErr("");
    try {
      const r = await api.customerUpsell(customer.id, {
        item, product: picked?.product || "", mode, amount: amountN,
        payment, date, dueDate: payment === "open" ? dueDate : undefined,
        maxInstallments: payment === "link" ? Number(inst) || undefined : undefined,
        soldBy, note: note.trim(),
      });
      if (r?.url) {
        try { await navigator.clipboard.writeText(r.url); } catch { window.prompt("Link de pagamento:", r.url); }
      }
      onDone && onDone(r);
    } catch (e) {
      setErr(e?.message || "não deu pra registrar o upsell");
    } finally { setSaving(false); }
  }

  const users = allUsers();
  return (
    <div style={{ marginTop: 12, display: "grid", gap: 8, padding: "10px 12px", borderRadius: "var(--r-2)", background: "var(--bg-inset)", border: "1px solid var(--line-1)" }}>
      {/* Linha 1: o que foi vendido + modo */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <span className="mono dim" style={{ fontSize: 10.5 }}>upsell</span>
        {options.length > 0 && (
          <select value={pick} onChange={(e) => choose(e.target.value)} autoFocus
            style={{ ...selectSt, flex: "1 1 200px", minWidth: 160, color: pick ? "var(--fg-1)" : "var(--fg-4)" }}>
            <option value="">o que foi vendido…</option>
            {options.map((o) => <option key={o.key} value={o.key}>{o.label}{o.value > 0 ? ` (${window.fmt.money(o.value)})` : ""}</option>)}
            <option value={OTHER}>Outro (escrever)</option>
          </select>
        )}
        {pick === OTHER && (
          <input type="text" value={itemTxt} onChange={(e) => setItemTxt(e.target.value)} placeholder="o que foi vendido" autoFocus={!options.length}
            style={{ ...inputSt, flex: "1 1 180px", minWidth: 140 }} />
        )}
      </div>

      {/* Linha 2: valores + pagamento */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <label className="mono dim" style={lbl} title="Valor da venda.">
          R$
          <input type="number" min="0" step="0.01" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="valor"
            onKeyDown={(e) => e.key === "Enter" && save()}
            className="tnum" style={{ ...inputSt, width: 96, textAlign: "right" }} />
        </label>
        <select value={payment} onChange={(e) => setPayment(e.target.value)} style={selectSt}>
          <option value="paid">já pago</option>
          <option value="open">a receber</option>
          {mpOn && <option value="link">gerar link do Mercado Pago</option>}
        </select>
        {payment === "paid" && (
          <label className="mono dim" style={lbl}>em <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={dateSt} /></label>
        )}
        {payment === "open" && (
          <label className="mono dim" style={lbl}>vence <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} style={dateSt} /></label>
        )}
        {payment === "link" && (
          <label className="mono dim" style={lbl}>até
            <select value={inst} onChange={(e) => setInst(e.target.value)} style={selectSt}>
              {[1, 2, 3, 6, 10, 12].map((n) => <option key={n} value={n}>{n}x</option>)}
            </select>
          </label>
        )}
      </div>

      {/* Linha 3: quem vendeu + observação + confirmar */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <label className="mono dim" style={lbl} title="Atribuição do upsell no placar e na meta do CS.">
          vendido por
          <select value={soldBy} onChange={(e) => setSoldBy(e.target.value)} style={selectSt}>
            {!users.some((u) => u.id === soldBy) && soldBy && <option value={soldBy}>{displayName(soldBy)}</option>}
            {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </label>
        <input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="observação (opcional)"
          onKeyDown={(e) => e.key === "Enter" && save()}
          style={{ ...inputSt, flex: "1 1 160px", minWidth: 130 }} />
        <button onClick={onCancel} style={{ height: 28, padding: "0 10px", borderRadius: "var(--r-2)", border: "1px solid var(--line-2)", background: "var(--bg-1)", color: "var(--fg-3)", fontSize: 12.5 }}>cancelar</button>
        <button onClick={save} disabled={!canSave}
          style={{ height: 28, padding: "0 12px", borderRadius: "var(--r-2)", border: "none", background: "var(--accent)", color: "#fff", fontSize: 12.5, fontWeight: 600, opacity: canSave ? 1 : 0.5 }}>
          {saving ? "registrando…" : payment === "link" ? "registrar e gerar link" : "registrar upsell"}
        </button>
      </div>
      {err && <div className="mono" style={{ fontSize: 10.5, color: "var(--neg)" }}>{err}</div>}
    </div>
  );
}
