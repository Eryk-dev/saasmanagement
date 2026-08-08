import React from "react";
import { api } from "../lib/api.js";
import { useData } from "../data.jsx";
import { PageHead, StatTile, Card, Pill, FilterTab, Segmented } from "../components/viz.jsx";
import { useActiveSaas } from "../lib/workspace.js";
import { EmptyState } from "../atoms.jsx";
import { FinanceTab } from "./finance.jsx";
import { ResumoTab, ConciliacaoTab, PagarTab, FolhaTab } from "./finance-hub.jsx";
// Financeiro — o dinheiro do produto num lugar só (modelo Conta Azul):
//   Resumo (fluxo de caixa + DRE) · Conciliação (espelho MP sem dono) ·
//   A pagar (contas com vencimento e recorrência) · Folha (por colaborador)
//   moram em finance-hub.jsx. Pagamentos: o espelho dos pagamentos REAIS do
//   Mercado Pago casado com clientes e faturas (finance.jsx). Custos: regras e
//   automáticos por competência — Publicidade (ad_insights) e IA entram
//   sozinhos, percentuais calculados no servidor; o total alimenta o
//   "Resultado do mês" da Visão geral.

const { useState, useEffect } = React;

const CATEGORIES = [
  ["fixo", "Custo fixo"],
  ["ferramenta", "Ferramentas"],
  ["pessoal", "Pessoal"],
  ["taxas", "Taxas & impostos"],
  ["outros", "Outros"],
];
const CAT_LABEL = Object.fromEntries(CATEGORIES);

// Base do custo percentual — o servidor calcula o R$ mês a mês (e devolve o
// valor da base usada no resumo): ganhos do pipeline, só os ganhos fechados no
// cartão de crédito 12x (checkout da adquirente) ou os recebidos do mês
// (faturas pagas · imposto por regime de caixa).
const PCT_BASES = [
  { id: "won", option: "% dos ganhos do mês", pill: "dos ganhos", title: "sobre os ganhos do mês no pipeline", key: "wonBase" },
  { id: "cartao12x", option: "% dos recebidos no cartão", pill: "do cartão", title: "sobre os pagamentos de cartão de crédito recebidos no mês (espelho do Mercado Pago)", key: "cardBase" },
  { id: "received", option: "% dos recebidos no mês", pill: "dos recebidos", title: "sobre os recebidos do mês (faturas pagas)", key: "receivedBase" },
];
const pctBaseInfo = (id) => PCT_BASES.find((b) => b.id === id) || PCT_BASES[0];

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
  const [product] = useActiveSaas();
  const [tab, setTabState] = useState(() => { try { return localStorage.getItem("cockpit_financeiro_tab") || "resumo"; } catch { return "resumo"; } }); // persiste
  const setTab = (t) => { setTabState(t); try { localStorage.setItem("cockpit_financeiro_tab", t); } catch { /* ignore */ } };
  const [month, setMonth] = useState(monthKey(new Date()));

  if (!product) return <EmptyState title="Nenhum produto cadastrado" hint="Crie o produto em Ajustes." />;

  const shortMonth = (mk) => new Date(`${mk}-01T12:00:00`).toLocaleDateString("pt-BR", { month: "short" }).replace(".", "");

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, overflow: "auto" }}>
      <PageHead title="Financeiro"
        sub={{
          resumo: `${monthLabel(month)} · a foto do mês: fluxo de caixa, DRE e pendências`,
          conciliacao: "todo pagamento aprovado precisa de dono: cliente vinculado ou motivo",
          pagar: `${monthLabel(month)} · contas com vencimento, situação e recorrência`,
          folha: `${monthLabel(month)} · o que foi pago a cada colaborador`,
          pagamentos: "pagamentos da conta Mercado Pago, casados com clientes e faturas",
          custos: `${monthLabel(month)} · o total alimenta o “Resultado do mês” da Visão geral`,
        }[tab] || ""}>
        <Segmented value={tab} onChange={setTab} options={[
          { value: "resumo", label: "Resumo" },
          { value: "conciliacao", label: "Conciliação" },
          { value: "pagar", label: "A pagar" },
          { value: "folha", label: "Folha" },
          { value: "pagamentos", label: "Pagamentos" },
          { value: "custos", label: "Custos" },
        ]} />
        {tab !== "pagamentos" && (
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            {[...lastMonths(4)].reverse().map((mk) => <FilterTab key={mk} active={month === mk} onClick={() => setMonth(mk)}>{shortMonth(mk)}</FilterTab>)}
          </div>
        )}
      </PageHead>

      {/* key={product.id}: trocar de produto remonta a aba — rascunho de custo
          e vínculo em andamento nunca vazam pro SaaS errado. */}
      {tab === "resumo" && <ResumoTab key={product.id} product={product} month={month} />}
      {tab === "conciliacao" && <ConciliacaoTab key={product.id} product={product} month={month} />}
      {tab === "pagar" && <PagarTab key={product.id} product={product} month={month} />}
      {tab === "folha" && <FolhaTab key={product.id} product={product} month={month} />}
      {tab === "pagamentos" && <FinanceTab key={product.id} product={product} />}
      {tab === "custos" && <CostsTab key={product.id} product={product} month={month} />}
    </div>
  );
}

function CostsTab({ product, month }) {
  const { version } = useData();
  const [data, setData] = useState(null);
  // unit "brl" = valor fixo em R$; "pct" = percentual sobre a base escolhida
  // (ganhos, cartão 12x ou recebidos) — o servidor calcula o R$ mês a mês.
  const [form, setForm] = useState({ category: "fixo", name: "", amount: "", unit: "brl", base: "won", recurring: false });
  const [note, setNote] = useState(null);

  const load = () => {
    setData(null);
    api.expensesSummary(product.id, month).then(setData).catch(() => setData({ error: true }));
  };
  useEffect(load, [product.id, month, version]); // eslint-disable-line react-hooks/exhaustive-deps

  async function addExpense() {
    const value = Number(String(form.amount).replace(",", "."));
    const isPct = form.unit === "pct";
    if (!form.name.trim() || !Number.isFinite(value) || value <= 0 || (isPct && value > 100)) {
      setNote({ ok: false, text: isPct ? "Preencha descrição e um percentual entre 0 e 100." : "Preencha descrição e valor." });
      return;
    }
    try {
      await api.create("expenses", {
        saas: product.id, month, category: form.category, name: form.name.trim(),
        ...(isPct ? { pct: value, base: form.base } : { amount: value }),
        recurring: !!form.recurring,
      });
      setForm({ category: form.category, name: "", amount: "", unit: form.unit, base: form.base, recurring: form.recurring });
      setNote({ ok: true, text: isPct ? `Custo percentual registrado, o valor em R$ é calculado ${pctBaseInfo(form.base).title} a cada mês.` : (form.recurring ? "Custo recorrente registrado (vale deste mês em diante)." : "Custo registrado.") });
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

  const inputStyle = { height: 38, padding: "0 12px", borderRadius: "var(--r-2)", border: "1px solid var(--line-2)", background: "var(--bg-1)", color: "var(--fg-1)", fontSize: 13 };

  return (
    <div style={{ padding: "16px var(--pad-x) 56px", display: "flex", flexDirection: "column", gap: 16 }}>
        {note && <div className="mono" style={{ fontSize: 12, color: note.ok ? "var(--pos)" : "var(--neg)" }}>{note.text}</div>}
        {data?.error && <div className="mono" style={{ fontSize: 12, color: "var(--neg)" }}>Falha ao carregar os custos.</div>}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12 }}>
          <StatTile label="Total do mês" value={data ? brl(data.total) : "…"} delta="publicidade + IA + WhatsApp + manuais" />
          <StatTile label="Publicidade" value={data ? brl(data.ads) : "…"} delta="automático · Meta e entradas manuais de anúncio" />
          <StatTile label="IA" value={data ? (data.ai != null ? brl(data.ai) : "sem dado no mês") : "…"}
            delta={data?.aiUSD != null ? `US$ ${data.aiUSD.toFixed(2).replace(".", ",")} · automático` : "automático via APIs dos provedores"} />
          {/* Conversas cobradas pela Meta (conversation_analytics, BRL). */}
          <StatTile label="WhatsApp" value={data ? (data.wa != null ? brl(data.wa) : "sem dado no mês") : "…"}
            delta={data?.waConversations != null ? `${data.waConversations} conversas cobradas · automático` : "automático via Meta"} />
          <StatTile label="Lançados à mão" value={data ? brl(data.manualTotal) : "…"} delta={`${data?.manual?.length ?? 0} ${(data?.manual?.length ?? 0) === 1 ? "lançamento" : "lançamentos"}`} />
        </div>

        <Card title="Lançamentos do mês" hint="custos fixos, ferramentas, pessoal e outros">
          <div style={{ display: "flex", gap: 10, alignItems: "flex-end", padding: "14px 24px", borderTop: "1px solid var(--line-1)", background: "var(--bg-inset)", flexWrap: "wrap" }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              <span className="kicker" style={{ fontWeight: 600 }}>Categoria</span>
              <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} style={{ ...inputStyle, width: 140 }}>
                {CATEGORIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 5, flex: 1, minWidth: 180 }}>
              <span className="kicker" style={{ fontWeight: 600 }}>Descrição</span>
              <input type="text" placeholder="Servidor, contador, assinatura…" value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                onKeyDown={(e) => { if (e.key === "Enter") addExpense(); }}
                style={inputStyle} />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              <span className="kicker" style={{ fontWeight: 600 }}>{form.unit === "pct" ? "Percentual (%)" : "Valor (R$)"}</span>
              <div style={{ display: "flex", gap: 4 }}>
                <input type="number" min="0" step="0.01" placeholder={form.unit === "pct" ? "12" : "0,00"} value={form.amount}
                  onChange={(e) => setForm({ ...form, amount: e.target.value })}
                  onKeyDown={(e) => { if (e.key === "Enter") addExpense(); }}
                  style={{ ...inputStyle, width: 110, fontFamily: "var(--mono)", textAlign: "right" }} />
                <select value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })}
                  title="R$ = valor fixo · % = percentual sobre a base ao lado (ganhos, cartão 12x ou recebidos)"
                  style={{ ...inputStyle, width: 58, fontFamily: "var(--mono)", padding: "0 4px" }}>
                  <option value="brl">R$</option>
                  <option value="pct">%</option>
                </select>
              </div>
            </label>
            {form.unit === "pct" && (
              <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                <span className="kicker" style={{ fontWeight: 600 }}>Sobre o quê</span>
                <select value={form.base} onChange={(e) => setForm({ ...form, base: e.target.value })}
                  title="ganhos = tudo que fechou no mês · cartão 12x = só vendas no cartão de crédito em 12x (checkout) · recebidos = faturas pagas no mês (imposto por caixa)"
                  style={{ ...inputStyle, width: 210 }}>
                  {PCT_BASES.map((b) => <option key={b.id} value={b.id}>{b.option}</option>)}
                </select>
              </label>
            )}
            <label style={{ display: "inline-flex", alignItems: "center", gap: 8, height: 38, fontSize: 13, color: "var(--fg-2)", whiteSpace: "nowrap" }}
              title="Vale deste mês em diante, todo mês, até você encerrar">
              <input type="checkbox" checked={!!form.recurring} onChange={(e) => setForm({ ...form, recurring: e.target.checked })} />
              recorrente todo mês
            </label>
            <button onClick={addExpense} style={{ height: 32, padding: "0 14px", borderRadius: "var(--r-2)", background: "var(--btn-bg)", color: "var(--btn-fg)", fontSize: 12.5, fontWeight: 600 }}>
              + registrar
            </button>
          </div>

          {data && !data.error && data.manual.length === 0 && (
            <div style={{ padding: "16px 24px", borderTop: "1px solid var(--line-faint)", fontSize: 12.5, color: "var(--fg-4)" }}>
              Nenhum lançamento manual em {monthLabel(month)}. Publicidade e IA já entram sozinhos no total.
            </div>
          )}
          {data && !data.error && data.manual.length > 0 && (
            <div>
              {data.manual.map((e) => (
                <div key={e.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "13px var(--inset-x)", borderTop: "1px solid var(--line-faint)", flexWrap: "wrap" }}>
                  <Pill tone="mut">{CAT_LABEL[e.category] || e.category}</Pill>
                  <span style={{ flex: 1, fontSize: 13, fontWeight: 500, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.name}</span>
                  {Number(e.pct) > 0 && (
                    <Pill tone="warn" title={`${e.pct}% ${pctBaseInfo(e.base).title}${data?.[pctBaseInfo(e.base).key] != null ? ` (${brl(data[pctBaseInfo(e.base).key])} em ${monthLabel(month)})` : ""}`}>
                      {String(e.pct).replace(".", ",")}% {pctBaseInfo(e.base).pill}
                    </Pill>
                  )}
                  {e.recurring && (
                    <Pill tone="accent" title={`recorrente desde ${e.month}${e.endMonth ? `, encerrado em ${e.endMonth}` : ""}`}>
                      {e.endMonth ? `recorrente até ${e.endMonth}` : `recorrente · desde ${e.month}`}
                    </Pill>
                  )}
                  <span className="tnum" style={{ fontSize: 13.5, fontWeight: 600 }}>{brl(e.amount)}</span>
                  {e.recurring && !e.endMonth && (
                    <button onClick={() => endRecurring(e)} title="Parar de contar a partir do mês seguinte"
                      style={{ fontSize: 12.5, fontWeight: 600, color: "var(--accent)", padding: "2px 4px" }}>
                      encerrar
                    </button>
                  )}
                  <button onClick={() => removeExpense(e)} className="mono dim" title="Remover lançamento" style={{ fontSize: 13, padding: "0 4px" }}>✕</button>
                </div>
              ))}
            </div>
          )}
        </Card>

    </div>
  );
}

export { ExpensesScreen };
