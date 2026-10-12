import React from "react";
import { Pill } from "../components/viz.jsx";
import { EmptyState } from "../atoms.jsx";
import { mpMethodLabel, MP_PAY_STATUS } from "../lib/payments.js";
import { money } from "../lib/fin-cats.js";

// Lista do espelho do Mercado Pago (quem pagou, quanto, como, quando, casado
// com quem). Desde 12/10/2026 mora DENTRO da aba Conciliação do Financeiro —
// a aba "Pagamentos" lia o mesmo espelho e vinculava cliente num segundo
// lugar. Aqui é só leitura + vínculo manual na linha; sync e filtros ficam
// com a Conciliação (um botão, um mês).

const { useState, useMemo } = React;

const fmtAt = (iso) => (iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).replace(".", "") : "—");

// O balde do pagamento no espelho (mp-classify.js): o que soma e o que não.
export const KIND_LABEL = {
  venda: { label: "venda", tone: "pos", title: "pagamento de cliente: soma no recebido" },
  maquininha: { label: "maquininha", tone: "pos", title: "venda presencial na Point: soma no recebido (vincule ao cliente)" },
  interna: { label: "interna", tone: "mut", title: "dinheiro da própria casa (reserva, transferência entre contas): fora do recebido" },
  saida: { label: "saída", tone: "neg", title: "pagamento feito com o saldo da conta (DARF, assinatura): vira conta a pagar" },
  ruido: { label: "ruído", tone: "mut", title: "cashback, rendimento, compra de moeda: fora de tudo" },
};
export const kindOf = (p) => p.kind || "venda";

export function PagamentosLista({ product, payments = [], customers = [], onLink, busy = false, vazio = "Nenhum pagamento com esse filtro." }) {
  const [linking, setLinking] = useState({}); // paymentId -> customerId escolhido
  const customerName = (id) => customers.find((c) => c.id === id)?.name || (window.SEED?.CUSTOMERS || []).find((c) => c.id === id)?.name || "";
  const rows = useMemo(() => [...payments].sort((a, b) => String(b.dateApproved || b.dateCreated || "").localeCompare(String(a.dateApproved || a.dateCreated || ""))), [payments]);

  if (!rows.length) return <EmptyState title={vazio} hint="Troque o filtro ou o mês, ou sincronize. O 1º sync varre 400 dias da conta." />;

  return (
    <div className="tbl-x finance-payments-table">
      <table style={{ width: "100%", minWidth: 860, borderCollapse: "collapse" }}>
        <thead>
          <tr>
            {["Data", "Pagador", "Tipo", "Cliente", "Valor", "Forma", "Status", "Fatura"].map((h) => (
              <th key={h} className="kicker" style={{ textAlign: h === "Valor" ? "right" : "left", padding: "10px 14px", borderBottom: "1px solid var(--line-1)", background: "var(--bg-inset)" }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => {
            const st = MP_PAY_STATUS[p.status] || { label: p.status, tone: "mut" };
            const k = KIND_LABEL[kindOf(p)] || KIND_LABEL.venda;
            const isSale = kindOf(p) === "venda" || kindOf(p) === "maquininha";
            const matched = p.customer || p.lead;
            const td = { padding: "10px 14px", fontSize: 13, borderBottom: "1px solid var(--line-faint)" };
            return (
              <tr key={p.id} style={p.finIgnored ? { opacity: .55 } : undefined}>
                <td className="mono dim tnum" style={{ ...td, fontSize: 12, whiteSpace: "nowrap" }}>{fmtAt(p.dateApproved || p.dateCreated)}</td>
                <td style={td}>
                  <div style={{ fontWeight: 500 }}>{p.payerName || (p.description && !isSale ? p.description : "—")}</div>
                  {(p.payerDoc || p.payerEmail || p.payerDocMp) && (
                    <div className="mono dim" style={{ fontSize: 10.5 }}>
                      {[p.payerDoc && `CPF/CNPJ ${p.payerDoc}`, p.payerDocMp && "sem documento (PIX via MP)", p.payerEmail].filter(Boolean).join(" · ")}
                    </div>
                  )}
                  {p.payerBank && <div className="mono dim" title={p.payerBank} style={{ fontSize: 10.5, maxWidth: 380, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>via {p.payerBank}</div>}
                </td>
                <td style={td}>
                  <Pill tone={k.tone} title={`${k.title}${p.kindSource === "heuristic" ? " · classificado por heurística, o próximo sync confirma com o MP" : ""}`}>{k.label}{p.kindSource === "heuristic" ? "?" : ""}</Pill>
                  {p.finIgnored && <span className="mono dim" style={{ display: "block", fontSize: 9.5, marginTop: 2 }}>desconsiderado · {p.finIgnoredReason || "outro"}</span>}
                </td>
                <td style={td}>
                  {p.customer ? (
                    <span title={{ reference: "casado pela fatura/link do cockpit", subscription: "casado pela assinatura", preapproval: "casado pela assinatura recorrente do MP vinculada a este cliente", email: "casado pelo e-mail do pagador", manual: "vinculado manualmente", rule: "vinculado por regra aprendida" }[p.matchedBy] || ""}>
                      {customerName(p.customer) || p.customer}
                    </span>
                  ) : p.lead ? (
                    <span className="dim" title="pagador casou com um LEAD (ainda não é cliente)">
                      lead: {(window.SEED?.LEADS || []).find((l) => l.id === p.lead)?.name || p.lead}
                    </span>
                  ) : isSale && !p.finIgnored && onLink ? (
                    <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                      <select aria-label={`Cliente do pagamento ${p.id}`} value={linking[p.id] || ""} onChange={(e) => setLinking((m) => ({ ...m, [p.id]: e.target.value }))}
                        style={{ height: 26, maxWidth: 160, padding: "0 6px", borderRadius: "var(--r-2)", border: "1px solid var(--line-1)", background: "var(--bg-1)", color: "var(--fg-2)", fontSize: 12 }}>
                        <option value="">vincular a…</option>
                        {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                      {linking[p.id] && <button disabled={busy} onClick={() => { onLink(p, linking[p.id]); setLinking((m) => ({ ...m, [p.id]: "" })); }} style={{ height: 26, padding: "0 10px", borderRadius: "var(--r-2)", border: "none", background: "var(--accent)", color: "var(--accent-fg, #fff)", fontSize: 11.5, fontWeight: 600 }}>Vincular</button>}
                    </span>
                  ) : <span className="dim">—</span>}
                </td>
                <td className="tnum" style={{ ...td, fontWeight: 600, textAlign: "right", whiteSpace: "nowrap" }}>
                  {money(p.amount || 0)}
                  {p.feeAmount > 0 && <span className="mono dim" style={{ display: "block", fontSize: 10, fontWeight: 400 }}>taxa {money(p.feeAmount)}</span>}
                </td>
                <td style={{ ...td, fontSize: 12.5, color: "var(--fg-2)", whiteSpace: "nowrap" }}>{mpMethodLabel(p) || p.methodType || "—"}</td>
                <td style={td}>
                  <Pill tone={st.tone}>{st.label}</Pill>
                  {p.payerMismatch && <span className="mono" title="o pagador não bate com o payer da assinatura referenciada — confira antes de vincular" style={{ display: "block", fontSize: 9, color: "var(--warn)", marginTop: 2 }}>payer difere</span>}
                </td>
                <td style={{ ...td, fontSize: 12, whiteSpace: "nowrap" }}>
                  {p.invoice
                    ? <span className="mono" style={{ fontSize: 10.5, color: "var(--pos)" }}>✓ baixada</span>
                    : matched && p.status === "approved" && isSale
                      ? <span className="mono dim" style={{ fontSize: 10.5 }} title="nenhuma fatura aberta ou presumida com esse valor exato — conta como recebido mesmo assim (pagamento sem fatura)">sem fatura</span>
                      : <span className="mono dim" style={{ fontSize: 10.5 }}>—</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
