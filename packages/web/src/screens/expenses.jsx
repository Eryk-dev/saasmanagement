import React from "react";
import "./expenses.css";
import { api } from "../lib/api.js";
import { useData } from "../data.jsx";
import { PageHead, StatTile, Card, Pill } from "../components/viz.jsx";
import { useActiveSaas } from "../lib/workspace.js";
import { EmptyState } from "../atoms.jsx";
import { ResumoTab, ConciliacaoTab, PagarTab } from "./finance-hub.jsx";
import { SECTOR_CATS, catLabel, money, moneyFull, mesLongo, mesCurto, monthKeyOf, shiftMonth } from "../lib/fin-cats.js";
// Financeiro — o dinheiro do produto num lugar só, em QUATRO abas (12/10/2026):
//   Resumo      — a foto do mês: pendências com prazo, recebido (régua única
//                 de caixa) × presumido, fluxo de 6 meses, gastos e DRE.
//   Conciliação — o espelho do Mercado Pago inteiro, classificado (venda,
//                 maquininha, interna, saída, ruído), a fila do que precisa de
//                 dono e as regras aprendidas. A antiga aba "Pagamentos" vive
//                 aqui como filtro: era o mesmo espelho em dois lugares.
//   A pagar     — contas com vencimento, situação, setor e recorrência; a
//                 Folha é a MESMA lista na lente por colaborador.
//   Custos      — regras e automáticos por competência (mídia, IA, WhatsApp,
//                 percentuais e taxa real do MP) no MESMO plano de contas.
// UM seletor de mês, obedecido por todas as abas (o filtro global de período
// do topo não aparece nesta tela).

const { useState, useEffect } = React;

// Base do custo percentual — o servidor calcula o R$ mês a mês (e devolve o
// valor da base usada no resumo).
const PCT_BASES = [
  { id: "won", option: "% dos ganhos do mês", pill: "dos ganhos", title: "sobre os ganhos do mês no pipeline (contratado, inclusive upsell)", key: "wonBase" },
  { id: "cartao12x", option: "% dos recebidos no cartão", pill: "do cartão", title: "sobre o dinheiro de cartão de crédito de CLIENTE que entrou no mês (espelho do Mercado Pago, D+0).", key: "cardBase" },
  { id: "received", option: "% dos recebidos no mês", pill: "dos recebidos", title: "sobre o recebido do mês (a mesma régua de caixa do Resumo e de Clientes)", key: "receivedBase" },
  // taxa_real: o valor da linha É a taxa que o Mercado Pago descontou no mês
  // (bruto − líquido de cada pagamento de cliente); o % só cobre pagamento
  // antigo sem líquido informado. Substitui a estimativa "Checkout 12%".
  { id: "taxa_real", option: "taxa real do Mercado Pago (% só de reserva)", pill: "taxa real do MP", title: "soma da taxa que o Mercado Pago descontou de cada pagamento de cliente no mês (bruto − líquido). O % é usado só em pagamento antigo sem líquido informado.", key: "feeBase" },
];
const pctBaseInfo = (id) => PCT_BASES.find((b) => b.id === id) || PCT_BASES[0];

// Seletor de mês do Financeiro: ‹ mês › + o mês digitável (qualquer mês, não
// só os 4 últimos — o fluxo mostra 6 e o histórico vai até julho/2026).
function MonthPicker({ month, onChange }) {
  const max = monthKeyOf(new Date());
  return (
    <div className="finance-month" aria-label="Mês de competência">
      <button type="button" onClick={() => onChange(shiftMonth(month, -1))} aria-label="Mês anterior">‹</button>
      <label>
        <span>{mesLongo(month).replace(/^./, (c) => c.toUpperCase())}</span>
        <input type="month" value={month} max={max} onChange={(e) => { if (/^\d{4}-\d{2}$/.test(e.target.value)) onChange(e.target.value); }} aria-label="Escolher o mês" />
      </label>
      <button type="button" onClick={() => onChange(shiftMonth(month, 1))} disabled={month >= max} aria-label="Mês seguinte">›</button>
    </div>
  );
}

function ExpensesScreen() {
  const [product] = useActiveSaas();
  const [tab, setTabState] = useState(() => {
    try {
      const t = localStorage.getItem("cockpit_financeiro_tab") || "resumo";
      // Abas que viraram filtro: Pagamentos → Conciliação, Folha → A pagar.
      return { pagamentos: "conciliacao", folha: "pagar" }[t] || t;
    } catch { return "resumo"; }
  });
  const setTab = (t) => { setTabState(t); try { localStorage.setItem("cockpit_financeiro_tab", t); } catch { /* ignore */ } };
  const [month, setMonth] = useState(monthKeyOf(new Date()));
  const [pagarView, setPagarView] = useState("contas"); // "contas" | "folha"

  if (!product) return <EmptyState title="Nenhum produto cadastrado" hint="Crie o produto em Ajustes." />;

  return (
    <div className="finance-page">
      <PageHead title="Financeiro"
        sub={{
          resumo: `${mesLongo(month)} · a foto do mês: pendências, recebido × presumido, fluxo, gastos e DRE`,
          conciliacao: `${mesLongo(month)} · o espelho do Mercado Pago inteiro: todo pagamento aprovado precisa de dono ou motivo`,
          pagar: `${mesLongo(month)} · contas com vencimento, situação e recorrência · a Folha é a lente por colaborador`,
          custos: `${mesLongo(month)} · automáticos (mídia, IA, WhatsApp, taxa do MP) e lançamentos por competência`,
        }[tab] || ""}>
        <nav className="finance-tabs" aria-label="Abas do financeiro">{[
          { value: "resumo", label: "Resumo" },
          { value: "conciliacao", label: "Conciliação" },
          { value: "pagar", label: "A pagar" },
          { value: "custos", label: "Custos" },
        ].map(o => <button key={o.value} aria-current={tab === o.value ? "page" : undefined} onClick={()=>setTab(o.value)}>{o.label}</button>)}</nav>
        <MonthPicker month={month} onChange={setMonth} />
      </PageHead>

      {/* key={`${product.id}:${month}`}: trocar de produto/mês remonta a aba — rascunho
          de custo e vínculo em andamento nunca vazam pro SaaS errado. */}
      {tab === "resumo" && <ResumoTab key={`${product.id}:${month}`} product={product} month={month} onTab={setTab} onMonth={setMonth} />}
      {tab === "conciliacao" && <ConciliacaoTab key={`${product.id}:${month}`} product={product} month={month} />}
      {tab === "pagar" && <PagarTab key={`${product.id}:${month}`} product={product} month={month} view={pagarView} onView={setPagarView} />}
      {tab === "custos" && <CostsTab key={`${product.id}:${month}`} product={product} month={month} onTab={setTab} />}
    </div>
  );
}

function CostsTab({ product, month, onTab }) {
  const { version } = useData();
  const [data, setData] = useState(null);
  // unit "brl" = valor fixo em R$; "pct" = percentual sobre a base escolhida
  // (ganhos, cartão, recebidos ou a taxa real do MP) — o servidor calcula o R$.
  const [form, setForm] = useState({ category: "escritorio", name: "", amount: "", unit: "brl", base: "won", recurring: false });
  const [note, setNote] = useState(null);
  const [busy,setBusy] = useState(false);
  const action = React.useRef(false), request = React.useRef(0);
  async function run(fn) { if(action.current) return; action.current=true;setBusy(true);try{await fn();}finally{action.current=false;setBusy(false);} }

  const load = () => {
    const seq=++request.current;
    return api.expensesSummary(product.id, month).then(d=>{if(seq===request.current)setData(d);}).catch(e=>{if(seq===request.current)setData({error:e.message});});
  };
  useEffect(()=>{load();return()=>{request.current++;};}, [product.id, month, version]); // eslint-disable-line react-hooks/exhaustive-deps

  async function addExpense() {
    if (action.current) return;
    const value = Number(String(form.amount).replace(",", "."));
    const isPct = form.unit === "pct";
    if (!form.name.trim() || !Number.isFinite(value) || value <= 0 || (isPct && value > 100)) {
      setNote({ ok: false, text: isPct ? "Preencha descrição e um percentual entre 0 e 100." : "Preencha descrição e valor." });
      return;
    }
    await run(async()=>{ try {
      await api.create("expenses", {
        saas: product.id, month, category: form.category, name: form.name.trim(),
        ...(isPct ? { pct: value, base: form.base } : { amount: value }),
        recurring: !!form.recurring,
      });
      setForm({ category: form.category, name: "", amount: "", unit: form.unit, base: form.base, recurring: form.recurring });
      setNote({ ok: true, text: isPct ? `Custo percentual registrado, o valor em R$ é calculado ${pctBaseInfo(form.base).title} a cada mês.` : (form.recurring ? "Custo recorrente registrado (vale deste mês em diante)." : "Custo registrado.") });
      await load();
    } catch (e) { setNote({ ok: false, text: e.message || "Falha ao registrar." }); } });
  }

  async function removeExpense(e) {
    const msg = e.recurring
      ? `Remover "${e.name}" (${moneyFull(e.amount)}) de TODOS os meses? Pra parar só daqui em diante, use "encerrar".`
      : `Remover "${e.name}" (${moneyFull(e.amount)})?`;
    if (!window.confirm(msg)) return;
    await run(async()=>{try { await api.remove("expenses", e.id); await load(); }
    catch (err) { setNote({ ok: false, text: err.message || "Falha ao remover." }); }});
  }

  // Encerra a recorrência NO MÊS EXIBIDO (inclusive): continua no histórico,
  // some dos meses seguintes.
  async function endRecurring(e) {
    if (!window.confirm(`Encerrar "${e.name}" em ${mesLongo(month)}? Ele continua contando até este mês e some dos próximos.`)) return;
    await run(async()=>{try { await api.update("expenses", e.id, { endMonth: month }); await load(); }
    catch (err) { setNote({ ok: false, text: err.message || "Falha ao encerrar." }); }});
  }

  const inputStyle = { height: 38, padding: "0 12px", borderRadius: 999, border: "1px solid var(--line-1)", background: "var(--bg-1)", color: "var(--fg-1)", fontSize: 13 };
  const v = (f) => (data && !data.error ? money(f(data)) : "…");

  return (
    <fieldset disabled={busy} className="finance-content finance-costs">
        {note && <div role={note.ok ? "status" : "alert"} className="finance-notice" style={{ fontSize: 12, color: note.ok ? "var(--pos)" : "var(--neg)" }}>{note.text}</div>}
        {data?.error && <div role="alert" className="finance-notice">Falha ao carregar os custos: {data.error} <button onClick={load}>Tentar novamente</button></div>}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12 }}>
          <StatTile label="Total do mês" value={v((d) => d.total)} delta="mídia + IA + WhatsApp + lançamentos + contas a pagar"
            title="Tudo que custou no mês por competência: automáticos, lançamentos desta aba e as contas a pagar do mês. É o mesmo total das despesas do Resumo." />
          <StatTile label="Publicidade" value={v((d) => d.ads)} delta="automático · Meta e entradas manuais de anúncio" />
          <StatTile label="IA" value={data && !data.error ? (data.ai != null ? money(data.ai) : "sem dado no mês") : "…"}
            delta={data?.aiUSD != null ? `US$ ${data.aiUSD.toFixed(2).replace(".", ",")} · automático` : "automático via APIs dos provedores"} />
          <StatTile label="WhatsApp" value={data && !data.error ? (data.wa != null ? money(data.wa) : "sem dado no mês") : "…"}
            delta={data?.waConversations != null ? `${data.waConversations} conversas cobradas · automático` : "automático via Meta"} />
          <StatTile label="Lançados aqui" value={v((d) => d.manualTotal)} delta={`${data?.manual?.length ?? 0} ${(data?.manual?.length ?? 0) === 1 ? "lançamento" : "lançamentos"}`} />
          <StatTile label="Contas a pagar do mês" value={v((d) => d.payablesTotal || 0)}
            delta={<button onClick={() => onTab?.("pagar")} style={{ color: "var(--accent)", fontWeight: 600 }}>{`${data?.payablesCount ?? 0} ${(data?.payablesCount ?? 0) === 1 ? "conta" : "contas"} · abrir A pagar`}</button>}
            title="Folha e fornecedores lançados em A pagar, por competência. Gasto COM favorecido (salário, fornecedor) mora lá; regra, automático e percentual moram aqui." />
        </div>

        <Card title="Lançamentos do mês" hint="regra ou automático (sem favorecido) · a categoria decide o setor no DRE, o mesmo plano de contas do A pagar">
          <div style={{ display: "flex", gap: 10, alignItems: "flex-end", padding: "14px 24px", borderTop: "1px solid var(--line-1)", background: "var(--bg-inset)", flexWrap: "wrap" }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              <span className="kicker" style={{ fontWeight: 600 }}>Categoria</span>
              <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} style={{ ...inputStyle, width: 190 }} title="A categoria decide o setor no DRE (deduções, COGS, Vendas & Marketing, Produto, Administrativo).">
                {SECTOR_CATS.map(([sk, sl, cats]) => (
                  <optgroup key={sk} label={sl}>{cats.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</optgroup>
                ))}
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
                <select aria-label="Unidade do custo" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })}
                  title="R$ = valor fixo · % = percentual sobre a base ao lado"
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
                  title="ganhos = tudo que fechou no mês · cartão = dinheiro de cliente no cartão · recebidos = o caixa do mês · taxa real = o que o MP descontou"
                  style={{ ...inputStyle, width: 230 }}>
                  {PCT_BASES.map((b) => <option key={b.id} value={b.id}>{b.option}</option>)}
                </select>
              </label>
            )}
            <label style={{ display: "inline-flex", alignItems: "center", gap: 8, height: 38, fontSize: 13, color: "var(--fg-2)", whiteSpace: "nowrap" }}
              title="Vale deste mês em diante, todo mês, até você encerrar">
              <input type="checkbox" checked={!!form.recurring} onChange={(e) => setForm({ ...form, recurring: e.target.checked })} />
              recorrente todo mês
            </label>
            <button onClick={addExpense} style={{ height: 32, padding: "0 14px", borderRadius: 999, background: "var(--btn-bg)", color: "var(--btn-fg)", fontSize: 12.5, fontWeight: 600 }}>
              + registrar
            </button>
          </div>

          {data && !data.error && data.manual.length === 0 && (
            <div style={{ padding: "16px 24px", borderTop: "1px solid var(--line-faint)", fontSize: 12.5, color: "var(--fg-4)" }}>
              Nenhum lançamento em {mesLongo(month)}. Publicidade, IA e WhatsApp já entram sozinhos no total.
            </div>
          )}
          {data && !data.error && data.manual.length > 0 && (
            <div>
              {data.manual.map((e) => (
                <div key={e.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "13px var(--inset-x)", borderTop: "1px solid var(--line-faint)", flexWrap: "wrap" }}>
                  <Pill tone="mut">{catLabel(e.category)}</Pill>
                  <span style={{ flex: 1, fontSize: 13, fontWeight: 500, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.name}</span>
                  {Number(e.pct) > 0 && (
                    <Pill tone="warn" title={`${e.pct}% ${pctBaseInfo(e.base).title}${data?.[pctBaseInfo(e.base).key] != null ? ` (${moneyFull(data[pctBaseInfo(e.base).key])} em ${mesLongo(month)})` : ""}`}>
                      {e.base === "taxa_real" ? pctBaseInfo(e.base).pill : `${String(e.pct).replace(".", ",")}% ${pctBaseInfo(e.base).pill}`}
                    </Pill>
                  )}
                  {e.recurring && (
                    <Pill tone="accent" title={`recorrente desde ${e.month}${e.endMonth ? `, encerrado em ${e.endMonth}` : ""}`}>
                      {e.endMonth ? `recorrente até ${mesCurto(e.endMonth)}` : `recorrente · desde ${mesCurto(e.month)}`}
                    </Pill>
                  )}
                  <span className="tnum" style={{ fontSize: 13.5, fontWeight: 600 }}>{money(e.amount)}</span>
                  {e.recurring && !e.endMonth && (
                    <button onClick={() => endRecurring(e)} title="Parar de contar a partir do mês seguinte"
                      style={{ fontSize: 12.5, fontWeight: 600, color: "var(--accent)", padding: "2px 4px" }}>
                      encerrar
                    </button>
                  )}
                  <button aria-label={`Remover ${e.name}`} onClick={() => removeExpense(e)} className="mono dim" title="Remover lançamento" style={{ fontSize: 13, padding: "0 4px" }}>✕</button>
                </div>
              ))}
            </div>
          )}
        </Card>

    </fieldset>
  );
}

export { ExpensesScreen };
