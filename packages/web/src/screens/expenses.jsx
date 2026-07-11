import React from "react";
import { api } from "../lib/api.js";
import { useData } from "../data.jsx";
import { PageHead, StatTile, Card, Pill } from "../components/viz.jsx";
import { useActiveSaas } from "../lib/workspace.js";
import { EmptyState } from "../atoms.jsx";
// Custos operacionais — o ledger mensal do produto. Publicidade (ad_insights)
// e IA (APIs dos provedores, em R$) entram AUTOMÁTICOS; o resto (fixos,
// ferramentas, pessoal) é lançado à mão aqui. O total alimenta o "Resultado
// do mês" da Visão geral.

const { useState, useEffect } = React;

const CATEGORIES = [
  ["fixo", "Custo fixo"],
  ["ferramenta", "Ferramentas"],
  ["pessoal", "Pessoal"],
  ["outros", "Outros"],
];
const CAT_LABEL = Object.fromEntries(CATEGORIES);

const monthKey = (d) => d.toISOString().slice(0, 7);
const monthLabel = (mk) => {
  const [y, m] = String(mk).split("-");
  const names = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
  return `${names[Number(m) - 1] || m} de ${y}`;
};
const lastMonths = (n) => {
  const out = [];
  const now = new Date();
  for (let i = 0; i < n; i++) out.push(monthKey(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1))));
  return out;
};
const brl = (n) => `R$ ${(Number(n) || 0).toFixed(2).replace(".", ",")}`;

function ExpensesScreen() {
  const { SAAS } = window.SEED;
  const { version } = useData();
  const [product, setActiveSaas] = useActiveSaas();
  const [month, setMonth] = useState(monthKey(new Date()));
  const [data, setData] = useState(null);
  const [form, setForm] = useState({ category: "fixo", name: "", amount: "", recurring: false });
  const [note, setNote] = useState(null);

  const load = () => {
    if (!product) return;
    setData(null);
    api.expensesSummary(product.id, month).then(setData).catch(() => setData({ error: true }));
  };
  useEffect(load, [product?.id, month, version]); // eslint-disable-line react-hooks/exhaustive-deps

  // Troca de produto: descarta rascunho e aviso — o custo em digitação não pode
  // ser registrado silenciosamente no SaaS errado.
  useEffect(() => {
    setForm({ category: "fixo", name: "", amount: "", recurring: false });
    setNote(null);
  }, [product?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function addExpense() {
    const amount = Number(String(form.amount).replace(",", "."));
    if (!form.name.trim() || !Number.isFinite(amount) || amount <= 0) {
      setNote({ ok: false, text: "Preencha descrição e valor." });
      return;
    }
    try {
      await api.create("expenses", { saas: product.id, month, category: form.category, name: form.name.trim(), amount, recurring: !!form.recurring });
      setForm({ category: form.category, name: "", amount: "", recurring: form.recurring });
      setNote({ ok: true, text: form.recurring ? "Custo recorrente registrado (vale deste mês em diante)." : "Custo registrado." });
      load();
    } catch (e) { setNote({ ok: false, text: e.message || "Falha ao registrar." }); }
  }

  async function removeExpense(e) {
    const msg = e.recurring
      ? `Remover "${e.name}" (${brl(e.amount)}) de TODOS os meses? Pra parar só daqui em diante, use "encerrar".`
      : `Remover "${e.name}" (${brl(e.amount)})?`;
    if (!window.confirm(msg)) return;
    try { await api.remove("expenses", e.id); load(); }
    catch (err) { setNote({ ok: false, text: err.message || "Falha ao remover." }); }
  }

  // Encerra a recorrência NO MÊS EXIBIDO (inclusive): continua no histórico,
  // some dos meses seguintes.
  async function endRecurring(e) {
    if (!window.confirm(`Encerrar "${e.name}" em ${monthLabel(month)}? Ele continua contando até este mês e some dos próximos.`)) return;
    try { await api.update("expenses", e.id, { endMonth: month }); load(); }
    catch (err) { setNote({ ok: false, text: err.message || "Falha ao encerrar." }); }
  }

  if (!product) return <EmptyState title="Nenhum produto cadastrado" hint="Crie o produto em Ajustes." />;

  const inputStyle = { height: 30, padding: "0 10px", borderRadius: "var(--r-1)", border: "1px solid var(--line-2)", background: "var(--bg-1)", color: "var(--fg-1)", fontSize: 13 };

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, overflow: "auto" }}>
      <PageHead title="Custos operacionais" sub={monthLabel(month)}>
        <select value={month} onChange={(e) => setMonth(e.target.value)}
          style={{ ...inputStyle, fontFamily: "var(--mono)", fontSize: 12.5 }}>
          {lastMonths(12).map((mk) => <option key={mk} value={mk}>{mk}</option>)}
        </select>
      </PageHead>

      <div style={{ padding: "20px var(--pad-x) 40px", display: "flex", flexDirection: "column", gap: 12 }}>
        {note && <div className="mono" style={{ fontSize: 12, color: note.ok ? "var(--pos)" : "var(--neg)" }}>{note.text}</div>}
        {data?.error && <div className="mono" style={{ fontSize: 12, color: "var(--neg)" }}>Falha ao carregar os custos.</div>}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12 }}>
          <StatTile label="Total do mês" value={data ? brl(data.total) : "…"} delta="publicidade + IA + manuais" />
          <StatTile label="Publicidade" value={data ? brl(data.ads) : "…"} delta="automático · Meta e entradas manuais de anúncio" />
          <StatTile label="IA" value={data ? (data.ai != null ? brl(data.ai) : "sem dado no mês") : "…"}
            delta={data?.aiUSD != null ? `US$ ${data.aiUSD.toFixed(2).replace(".", ",")} · automático` : "automático via APIs dos provedores"} />
          <StatTile label="Lançados à mão" value={data ? brl(data.manualTotal) : "…"} delta={`${data?.manual?.length ?? 0} ${(data?.manual?.length ?? 0) === 1 ? "lançamento" : "lançamentos"}`} />
        </div>

        <Card title="Lançamentos do mês" hint="custos fixos, ferramentas, pessoal e outros">
          <div style={{ display: "flex", gap: 8, alignItems: "flex-end", padding: "12px 16px", borderBottom: "1px solid var(--line-1)", flexWrap: "wrap" }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span className="mono" style={{ fontSize: 10.5, letterSpacing: "0.07em", textTransform: "uppercase", color: "var(--fg-3)" }}>Categoria</span>
              <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} style={inputStyle}>
                {CATEGORIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1, minWidth: 180 }}>
              <span className="mono" style={{ fontSize: 10.5, letterSpacing: "0.07em", textTransform: "uppercase", color: "var(--fg-3)" }}>Descrição</span>
              <input type="text" placeholder="Servidor, contador, assinatura…" value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                onKeyDown={(e) => { if (e.key === "Enter") addExpense(); }}
                style={inputStyle} />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span className="mono" style={{ fontSize: 10.5, letterSpacing: "0.07em", textTransform: "uppercase", color: "var(--fg-3)" }}>Valor (R$)</span>
              <input type="number" min="0" step="0.01" placeholder="0,00" value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
                onKeyDown={(e) => { if (e.key === "Enter") addExpense(); }}
                style={{ ...inputStyle, width: 120, fontFamily: "var(--mono)", textAlign: "right" }} />
            </label>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 30, fontSize: 12.5, color: "var(--fg-2)", whiteSpace: "nowrap" }}
              title="Vale deste mês em diante, todo mês, até você encerrar">
              <input type="checkbox" checked={!!form.recurring} onChange={(e) => setForm({ ...form, recurring: e.target.checked })} />
              recorrente todo mês
            </label>
            <button onClick={addExpense} style={{ height: 30, padding: "0 14px", borderRadius: "var(--r-1)", background: "var(--accent)", color: "var(--accent-fg)", fontSize: 13, fontWeight: 600 }}>
              + registrar
            </button>
          </div>

          {data && !data.error && data.manual.length === 0 && (
            <div style={{ padding: "14px 16px", fontSize: 12.5, color: "var(--fg-4)" }}>
              Nenhum lançamento manual em {monthLabel(month)}. Publicidade e IA já entram sozinhos no total.
            </div>
          )}
          {data && !data.error && data.manual.length > 0 && (
            <div>
              {data.manual.map((e) => (
                <div key={e.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "9px 16px", borderBottom: "1px solid var(--line-1)" }}>
                  <Pill tone="mut">{CAT_LABEL[e.category] || e.category}</Pill>
                  <span style={{ flex: 1, fontSize: 13, fontWeight: 500, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.name}</span>
                  {e.recurring && (
                    <Pill tone="accent" title={`recorrente desde ${e.month}${e.endMonth ? `, encerrado em ${e.endMonth}` : ""}`}>
                      {e.endMonth ? `recorrente até ${e.endMonth}` : `recorrente · desde ${e.month}`}
                    </Pill>
                  )}
                  <span className="tnum mono" style={{ fontSize: 13, fontWeight: 500 }}>{brl(e.amount)}</span>
                  {e.recurring && !e.endMonth && (
                    <button onClick={() => endRecurring(e)} className="mono" title="Parar de contar a partir do mês seguinte"
                      style={{ fontSize: 11, color: "var(--fg-3)", border: "1px solid var(--line-2)", borderRadius: 999, padding: "2px 9px" }}>
                      encerrar
                    </button>
                  )}
                  <button onClick={() => removeExpense(e)} className="mono dim" title="Remover lançamento" style={{ fontSize: 13, padding: "0 4px" }}>✕</button>
                </div>
              ))}
            </div>
          )}
        </Card>

        <div style={{ display: "flex", gap: 8, alignItems: "center", padding: "10px 14px", border: "1px dashed var(--line-2)", borderRadius: "var(--r-2)", color: "var(--fg-2)", fontSize: 12.5 }}>
          O total deste mês alimenta o "Resultado do mês" na Visão geral (valor ganho no pipeline menos estes custos).
        </div>
      </div>
    </div>
  );
}

export { ExpensesScreen };
