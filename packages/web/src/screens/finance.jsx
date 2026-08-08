import React from "react";
import { api } from "../lib/api.js";
import { useData } from "../data.jsx";
import { Pill } from "../components/viz.jsx";
import { EmptyState } from "../atoms.jsx";
import { mpMethodLabel, MP_PAY_STATUS } from "../lib/payments.js";
// Pagamentos — aba da tela Financeiro: o espelho dos pagamentos REAIS do Mercado
// Pago (quem pagou, quanto, como, quando), casado com os clientes. O que não
// casou sozinho fica com o seletor de vínculo na própria linha. O dinheiro
// entra pelo webhook + poller do servidor; aqui é leitura + vínculo manual +
// sincronizar agora.

const { useState, useEffect, useMemo, useCallback } = React;

const RANGES = [
  { id: "month", label: "Este mês" },
  { id: "30d", label: "30 dias" },
  { id: "90d", label: "90 dias" },
  { id: "all", label: "Tudo" },
];
const rangeStart = (id) => {
  const now = new Date();
  if (id === "month") return new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  if (id === "30d") return new Date(now.getTime() - 30 * 86400000).toISOString();
  if (id === "90d") return new Date(now.getTime() - 90 * 86400000).toISOString();
  return "";
};
const agoLabel = (iso) => {
  if (!iso) return "";
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  return h < 24 ? `há ${h}h` : `há ${Math.round(h / 24)} dia(s)`;
};
const fmtAt = (iso) => (iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).replace(".", "") : "—");

function FinanceTab({ product }) {
  const { CUSTOMERS } = window.SEED;
  const { version } = useData();
  const mpOn = !!window.SEED?.CONFIG?.mp?.configured;
  const money = window.fmt.money;

  const [data, setData] = useState(null); // { payments, sync }
  const [range, setRange] = useState("month");
  const [syncing, setSyncing] = useState(false);
  const [toast, setToast] = useState(null);
  const [linking, setLinking] = useState({}); // paymentId -> customerId escolhido

  const load = useCallback(() => {
    if (!product?.id || !mpOn) return;
    api.mpPayments({ saas: product.id }).then(setData).catch(() => {});
  }, [product?.id, mpOn]);
  useEffect(() => { load(); }, [load, version]);

  function flash(msg) { setToast(msg); setTimeout(() => setToast(null), 3200); }

  async function syncNow() {
    if (syncing) return;
    setSyncing(true);
    try {
      const r = await api.mpSyncNow();
      flash(`sincronizado: ${r.seen} pagamento(s) vistos · ${r.settled} fatura(s) baixada(s)`);
      load();
    } catch (err) { flash(err.message || "MP não respondeu"); }
    finally { setSyncing(false); }
  }

  async function linkPayment(p) {
    const customer = linking[p.id];
    if (!customer) return;
    try {
      const r = await api.mpLinkPayment(p.id, customer);
      flash(r.invoice ? "vinculado — fatura de mesmo valor baixada junto" : "vinculado ao cliente");
      setLinking((m) => ({ ...m, [p.id]: "" }));
      load();
    } catch (err) { flash(err.message || "não deu pra vincular"); }
  }

  const customers = useMemo(() => (CUSTOMERS || []).filter((c) => c.saas === product?.id), [CUSTOMERS, product?.id]);
  const customerName = (id) => customers.find((c) => c.id === id)?.name || (CUSTOMERS || []).find((c) => c.id === id)?.name || "";

  const payments = useMemo(() => {
    const start = rangeStart(range);
    return (data?.payments || []).filter((p) => !start || String(p.dateCreated || "") >= start);
  }, [data, range]);

  const stats = useMemo(() => {
    const ok = payments.filter((p) => p.status === "approved");
    const pend = payments.filter((p) => p.status === "pending" || p.status === "in_process" || p.status === "authorized");
    const byMethod = {};
    for (const p of ok) {
      const k = mpMethodLabel({ method: p.method, methodType: p.methodType }) || "outros";
      byMethod[k] = (byMethod[k] || 0) + (p.amount || 0);
    }
    return {
      received: ok.reduce((a, p) => a + (p.amount || 0), 0),
      count: ok.length,
      pending: pend.reduce((a, p) => a + (p.amount || 0), 0),
      pendingCount: pend.length,
      rejected: payments.filter((p) => p.status === "rejected").length,
      unmatched: payments.filter((p) => !p.customer && !p.lead).length,
      byMethod,
    };
  }, [payments]);

  if (!mpOn) {
    return (
      <div style={{ padding: "24px var(--pad-x) 56px" }}>
        <EmptyState
          title="Mercado Pago não conectado"
          hint="Defina MERCADOPAGO_ACCESS_TOKEN no env do servidor (EasyPanel) e reinicie. Só com o token o cockpit já puxa os pagamentos da conta a cada 10 minutos, casa com os clientes e dá baixa nas faturas; o webhook (Ajustes → Integrações) é opcional, pro tempo real." />
      </div>
    );
  }

  const TILE = { border: "1px solid var(--line-1)", borderRadius: "var(--r-2)", background: "var(--bg-1)", padding: "12px 16px", flex: "1 1 150px", minWidth: 140 };
  const btn = { height: 28, padding: "0 12px", borderRadius: "var(--r-2)", border: "1px solid var(--line-2)", background: "var(--bg-1)", color: "var(--fg-2)", fontSize: 12 };

  return (
    <div style={{ padding: "16px var(--pad-x) 56px", display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 6 }}>
          {RANGES.map((r) => (
            <button key={r.id} onClick={() => setRange(r.id)} style={{
              height: 26, padding: "0 10px", borderRadius: "var(--r-2)", fontSize: 12,
              border: "1px solid " + (range === r.id ? "var(--line-strong)" : "var(--line-1)"),
              background: range === r.id ? "var(--bg-3)" : "var(--bg-2)",
              color: range === r.id ? "var(--fg-1)" : "var(--fg-3)",
            }}>{r.label}</button>
          ))}
        </div>
        <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 8 }}>
          {data?.sync?.lastAt && <span className="mono dim" style={{ fontSize: 11 }}>sincronizado {agoLabel(data.sync.lastAt)}</span>}
          <button onClick={syncNow} disabled={syncing} style={{ ...btn, opacity: syncing ? 0.6 : 1 }} title="busca os pagamentos da conta MP agora (o servidor também faz sozinho a cada 10 min)">
            {syncing ? "sincronizando…" : "↻ sincronizar"}
          </button>
        </span>
      </div>

      {toast && <div className="mono" style={{ fontSize: 11, color: "var(--accent)" }}>{toast}</div>}

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <div style={TILE}>
          <div className="mono dim" style={{ fontSize: 10, letterSpacing: "0.07em", textTransform: "uppercase" }}>Recebido</div>
          <div className="tnum" style={{ fontSize: 21, fontWeight: 700, marginTop: 3 }}>{money(stats.received)}</div>
          <div className="mono dim" style={{ fontSize: 10.5, marginTop: 2 }}>{stats.count} pagamento(s) aprovados</div>
        </div>
        <div style={TILE}>
          <div className="mono dim" style={{ fontSize: 10, letterSpacing: "0.07em", textTransform: "uppercase" }}>Aguardando</div>
          <div className="tnum" style={{ fontSize: 21, fontWeight: 700, marginTop: 3 }}>{money(stats.pending)}</div>
          <div className="mono dim" style={{ fontSize: 10.5, marginTop: 2 }}>{stats.pendingCount} pendente(s) · {stats.rejected} recusado(s)</div>
        </div>
        <div style={TILE}>
          <div className="mono dim" style={{ fontSize: 10, letterSpacing: "0.07em", textTransform: "uppercase" }}>Por forma de pagamento</div>
          <div style={{ display: "flex", gap: "4px 14px", flexWrap: "wrap", marginTop: 6 }}>
            {Object.entries(stats.byMethod).sort((a, b) => b[1] - a[1]).map(([k, v]) => (
              <span key={k} style={{ fontSize: 12.5 }}><b>{k}</b> <span className="tnum" style={{ color: "var(--fg-3)" }}>{money(v)}</span></span>
            ))}
            {!Object.keys(stats.byMethod).length && <span className="mono dim" style={{ fontSize: 11 }}>nada no período</span>}
          </div>
        </div>
        {stats.unmatched > 0 && (
          <div style={{ ...TILE, borderColor: "var(--warn)", flex: "0 1 170px" }}>
            <div className="mono" style={{ fontSize: 10, letterSpacing: "0.07em", textTransform: "uppercase", color: "var(--warn)" }}>Não identificados</div>
            <div className="tnum" style={{ fontSize: 21, fontWeight: 700, marginTop: 3 }}>{stats.unmatched}</div>
            <div className="mono dim" style={{ fontSize: 10.5, marginTop: 2 }}>vincule na tabela abaixo</div>
          </div>
        )}
      </div>

      {!payments.length ? (
        <EmptyState title="Nenhum pagamento no período"
          hint={data ? "Troque o período acima ou clique em sincronizar. O 1º sync varre 400 dias da conta." : "carregando…"} />
      ) : (
        <div className="tbl-x" style={{ border: "1px solid var(--line-1)", borderRadius: "var(--r-3)", background: "var(--bg-1)" }}>
          <table style={{ width: "100%", minWidth: 860, borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {["Data", "Pagador", "Cliente", "Valor", "Forma", "Status", "Fatura"].map((h) => (
                  <th key={h} style={{ textAlign: h === "Valor" ? "right" : "left", fontSize: 10.5, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--fg-4)", padding: "10px 14px", borderBottom: "1px solid var(--line-1)", background: "var(--bg-inset)" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => {
                const st = MP_PAY_STATUS[p.status] || { label: p.status, tone: "mut" };
                const matched = p.customer || p.lead;
                return (
                  <tr key={p.id}>
                    <td className="mono dim tnum" style={{ padding: "10px 14px", fontSize: 12, borderBottom: "1px solid var(--line-faint)", whiteSpace: "nowrap" }}>{fmtAt(p.dateApproved || p.dateCreated)}</td>
                    <td style={{ padding: "10px 14px", fontSize: 13, borderBottom: "1px solid var(--line-faint)" }}>
                      <div style={{ fontWeight: 500 }}>{p.payerName || "—"}</div>
                      {(p.payerEmail || p.payerDoc) && <div className="mono dim" style={{ fontSize: 10.5 }}>{p.payerEmail || `CPF/CNPJ ${p.payerDoc}`}</div>}
                    </td>
                    <td style={{ padding: "10px 14px", fontSize: 13, borderBottom: "1px solid var(--line-faint)" }}>
                      {p.customer ? (
                        <span title={{ reference: "casado pela fatura/link do cockpit", subscription: "casado pela assinatura", email: "casado pelo e-mail do pagador", manual: "vinculado manualmente" }[p.matchedBy] || ""}>
                          {customerName(p.customer) || p.customer}
                        </span>
                      ) : p.lead ? (
                        <span className="dim" title="pagador casou com um LEAD (ainda não é cliente)">lead: {p.lead}</span>
                      ) : (
                        <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                          <select value={linking[p.id] || ""} onChange={(e) => setLinking((m) => ({ ...m, [p.id]: e.target.value }))}
                            style={{ height: 26, maxWidth: 160, padding: "0 6px", borderRadius: "var(--r-2)", border: "1px solid var(--line-2)", background: "var(--bg-1)", color: "var(--fg-2)", fontSize: 12 }}>
                            <option value="">vincular a…</option>
                            {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                          </select>
                          {linking[p.id] && <button onClick={() => linkPayment(p)} style={{ height: 26, padding: "0 10px", borderRadius: "var(--r-2)", border: "none", background: "var(--accent)", color: "var(--accent-fg, #fff)", fontSize: 11.5, fontWeight: 600 }}>ok</button>}
                        </span>
                      )}
                    </td>
                    <td className="tnum" style={{ padding: "10px 14px", fontSize: 13, fontWeight: 600, textAlign: "right", borderBottom: "1px solid var(--line-faint)", whiteSpace: "nowrap" }}>{money(p.amount || 0)}</td>
                    <td style={{ padding: "10px 14px", fontSize: 12.5, color: "var(--fg-2)", borderBottom: "1px solid var(--line-faint)", whiteSpace: "nowrap" }}>{mpMethodLabel(p) || "—"}</td>
                    <td style={{ padding: "10px 14px", borderBottom: "1px solid var(--line-faint)" }}>
                      <Pill tone={st.tone}>{st.label}</Pill>
                      {p.payerMismatch && <span className="mono" title="o pagador não bate com o payer da assinatura referenciada — confira antes de vincular" style={{ display: "block", fontSize: 9, color: "var(--warn)", marginTop: 2 }}>payer difere</span>}
                    </td>
                    <td style={{ padding: "10px 14px", fontSize: 12, borderBottom: "1px solid var(--line-faint)", whiteSpace: "nowrap" }}>
                      {p.invoice
                        ? <span className="mono" style={{ fontSize: 10.5, color: "var(--pos)" }}>✓ baixada</span>
                        : matched && p.status === "approved"
                          ? <span className="mono dim" style={{ fontSize: 10.5 }} title="nenhuma fatura aberta com esse valor exato — baixe pela aba Assinaturas se for o caso">sem fatura</span>
                          : <span className="mono dim" style={{ fontSize: 10.5 }}>—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="mono dim" style={{ fontSize: 10.5, lineHeight: 1.5 }}>
        pagamentos sem produto identificado aparecem em todos os workspaces até serem vinculados · a baixa automática de fatura acontece por link do cockpit, assinatura ou e-mail + valor exato
      </div>
    </div>
  );
}

export { FinanceTab };
