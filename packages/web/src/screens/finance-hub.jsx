import React from "react";
import { createPortal } from "react-dom";
import { api } from "../lib/api.js";
import { useData } from "../data.jsx";
import { StatTile, Card, Pill } from "../components/viz.jsx";
import { AvisoTopo, InfoNota } from "../components/story.jsx";
import { Avatar, EmptyState } from "../atoms.jsx";
import { allUsers } from "../lib/users.js";
import { mpMethodLabel } from "../lib/payments.js";
import { ManualPaidModal } from "../components/manual-paid-modal.jsx";
import { PagamentosLista, KIND_LABEL, kindOf } from "./finance.jsx";
import { SECTOR_CATS, SECTOR_LABEL, PAY_CAT_LABEL, catLabel, money, mesCurto, mesLongo } from "../lib/fin-cats.js";

// As abas do Financeiro (12/10/2026 — quatro, um mês, uma régua de caixa):
//   Resumo      — pendências com prazo no topo, a foto do mês (recebido pela
//                 régua única × PRESUMIDO), fluxo de 6 meses, gastos e DRE
//                 (números do servidor; a UI só desconta IA/WhatsApp).
//   Conciliação — o espelho do Mercado Pago inteiro: fila do que precisa de
//                 dono (entradas de cliente e saídas), lista por tipo (venda,
//                 maquininha, interna, saída, ruído, ignorado), regras
//                 aprendidas e UM botão de sincronizar (entradas + saídas).
//   A pagar     — contas com vencimento, situação, setor e recorrência; a
//                 Folha é a mesma lista na lente por colaborador.
// Receita nasce nas faturas e no espelho; custo automático/percentual na aba
// Custos (mesmo plano de contas, lib/fin-cats.js).

const { useState, useEffect, useCallback, useMemo } = React;

const int = (v) => window.fmt.int(v || 0);
const r2 = (n) => Math.round(n * 100) / 100;
export { SECTOR_CATS };

const RECEITA_LABEL = { renewal: "Assinaturas", installment: "Parcelas de contrato", manual: "Cobranças avulsas", upsell: "Upsell", prorata: "Upgrade de plano", mp: "Pagamentos sem fatura (MP)" };
const dmy = (d) => (d ? `${String(d).slice(8, 10)}/${String(d).slice(5, 7)}` : "");

const inp = { height: 36, padding: "0 10px", borderRadius: 999, border: "1px solid var(--line-1)", background: "var(--bg-1)", color: "var(--fg-1)", fontSize: 13 };
const btn = { height: 32, padding: "0 13px", borderRadius: 999, border: "1px solid var(--line-1)", background: "var(--bg-1)", boxShadow: "var(--shadow-1)", color: "var(--fg-2)", fontSize: 12.5, fontWeight: 600 };
const btnPri = { height: 32, padding: "0 14px", borderRadius: 999, background: "var(--btn-bg)", color: "var(--btn-fg)", fontSize: 12.5, fontWeight: 600 };

// A leitura do mês (GET /api/fin, só leitura) + recarga no SSE. Se faltar
// instância de conta recorrente no mês (payablesMissing), materializa UMA vez
// pelo POST e relê — o GET nunca cria nada.
function useFin(product, month) {
  const { version } = useData();
  const [fin, setFin] = useState(null), [err, setErr] = useState(null);
  const request = React.useRef(0), materialized = React.useRef("");
  const load = useCallback(async () => {
    if (!product?.id) return;
    const seq = ++request.current; setErr(null);
    try {
      let d = await api.fin(product.id, month);
      if (d?.payablesMissing > 0 && materialized.current !== `${product.id}:${month}`) {
        materialized.current = `${product.id}:${month}`;
        await api.finMaterialize(product.id, month).catch(() => null);
        d = await api.fin(product.id, month);
      }
      if (seq === request.current) setFin(d);
    } catch (e) { if (seq === request.current) setErr(e.message); }
  }, [product?.id, month]);
  useEffect(() => { load(); return () => { request.current++; }; }, [load, version]);
  return { fin, err, reload: load };
}
const Carregando = ({ err, retry }) => <div className="finance-notice" role={err ? "alert" : "status"}>{err || "Carregando…"}{err && <button onClick={retry}>Tentar novamente</button>}</div>;

// ── Resumo ───────────────────────────────────────────────────────────────────
function FluxoCard({ fluxo, previsto, month, onMonth }) {
  const max = Math.max(1, ...fluxo.map((f) => Math.max(f.entrada, f.saida)));
  return (
    <Card style={{"--finance-card":"flow"}} title="Fluxo de caixa" hint="realizado por mês · entrada = recebido (régua única) · saída = contas pagas + custos do mês + saídas da conta MP sem dono · clique no mês pra abrir">
      <div style={{ padding: "12px var(--inset-x) 18px", display: "flex", flexDirection: "column", gap: 10 }}>
        {fluxo.map((f) => {
          const saldo = r2(f.entrada - f.saida);
          return (
            <div key={f.month} style={{ display: "grid", gridTemplateColumns: "56px 1fr 110px", gap: 12, alignItems: "center" }}>
              <button type="button" onClick={() => onMonth?.(f.month)} title={`abrir ${mesLongo(f.month)}`}
                style={{ textAlign: "left", fontSize: 12, color: f.month === month ? "var(--fg-1)" : "var(--fg-3)", fontWeight: f.month === month ? 650 : 500, textTransform: "capitalize", padding: 0 }}>{mesCurto(f.month)}</button>
              <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
                <div title={`entrou ${money(f.entrada)}`} style={{ height: 8, borderRadius: 999, background: "var(--pos)", opacity: .85, width: `${Math.max(2, (f.entrada / max) * 100)}%` }} />
                <div title={`saiu ${money(f.saida)}${f.saidasSemDono ? ` (sendo ${money(f.saidasSemDono)} de saídas da conta MP sem dono)` : ""}`} style={{ height: 8, borderRadius: 999, background: "var(--neg)", opacity: .7, width: `${Math.max(2, (f.saida / max) * 100)}%` }} />
              </div>
              <span className="tnum" style={{ fontSize: 12.5, fontWeight: 650, textAlign: "right", color: saldo >= 0 ? "var(--pos)" : "var(--neg)", whiteSpace: "nowrap" }}>
                {saldo >= 0 ? "+" : "−"} {money(Math.abs(saldo))}
              </span>
            </div>
          );
        })}
        <div className="dim" style={{ fontSize: 11.5, marginTop: 2 }}>
          previsto pra {mesLongo(month)}: entra {money(previsto.entrada)} (faturas em aberto do mês) · sai {money(previsto.saida)} (contas abertas + custos)
        </div>
      </div>
    </Card>
  );
}

const EXPENSE_COLORS = [
  "var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--info)",
  "var(--pos)", "var(--neg)", "var(--fg-3)",
  "color-mix(in srgb, var(--chart-2) 55%, var(--neg))",
  "color-mix(in srgb, var(--chart-1) 55%, var(--info))",
];

export function GastosCard({ setores, recebidosMes, month }) {
  // Só as categorias da DRE: somar também os subtotais de setor duplicaria
  // as despesas. COGS já chega com IA e WhatsApp, como na DRE ao lado.
  const porCategoria = {};
  for (const itens of Object.values(setores || {})) {
    for (const [key, raw] of Object.entries(itens || {})) {
      const value = Number(raw);
      if (Number.isFinite(value) && value > 0) porCategoria[key] = (porCategoria[key] || 0) + value;
    }
  }
  const itens = Object.entries(porCategoria).sort((a, b) => b[1] - a[1]);
  const total = r2(itens.reduce((sum, [, value]) => sum + value, 0));
  const recebidos = Number.isFinite(Number(recebidosMes)) ? Math.max(0, Number(recebidosMes)) : 0;
  const saldo = r2(recebidos - total);
  // O círculo representa os recebidos, nunca uma normalização das despesas.
  // Sem base ou com déficit, mantemos valores/percentuais na legenda e
  // explicamos o resultado, sem desenhar fatias negativas ou acima de 100%.
  const mostraPizza = recebidos > 0 && saldo >= 0;
  const categorias = itens.map(([key, value], i) => ({
    key, value, label: PAY_CAT_LABEL[key] || key, color: EXPENSE_COLORS[i % EXPENSE_COLORS.length],
  }));
  if (saldo > 0) categorias.push({ key: "__saldo", value: saldo, label: "Saldo após despesas", color: "var(--line-2)" });
  let accumulated = 0;
  const fatias = categorias.map((item) => {
    const share = recebidos > 0 ? item.value / recebidos : 0;
    const start = accumulated * Math.PI * 2 - Math.PI / 2;
    accumulated += share;
    const end = accumulated * Math.PI * 2 - Math.PI / 2;
    return {
      ...item,
      pct: recebidos <= 0 ? "—" : share < 0.001 ? "<0,1%" : window.fmt.pct(share, 1).replace(".", ","),
      path: mostraPizza ? `M 110 110 L ${110 + 104 * Math.cos(start)} ${110 + 104 * Math.sin(start)} A 104 104 0 ${share > 0.5 ? 1 : 0} 1 ${110 + 104 * Math.cos(end)} ${110 + 104 * Math.sin(end)} Z` : null,
    };
  });

  return (
    <Card title="Gastos do mês" hint={`${mesLongo(month)} · custos como % do recebido no mês`}>
      {!fatias.length ? <EmptyState title="Sem recebimentos neste mês" hint="Ainda não há recebimentos nem despesas para comparar." /> : (
        <div style={{ padding: "18px var(--inset-x) 22px", display: "flex", flexWrap: "wrap", gap: 24, alignItems: "center" }}>
          <figure className="finance-donut" style={{ margin: "0 auto", width: 132, maxWidth: "100%", flexShrink: 0 }}>
            {mostraPizza ? <svg viewBox="0 0 220 220" role="img" aria-label={`Custos e saldo sobre os recebimentos de ${mesLongo(month)}`} style={{ display: "block", width: "100%" }}>
              <title>{`Recebido no mês · ${money(recebidos)}`}</title>
              {fatias.map((f) => fatias.length === 1 ? (
                <circle key={f.key} cx="110" cy="110" r="104" fill={f.color}>
                  <title>{`${f.label}: ${money(f.value)} · ${f.pct}`}</title>
                </circle>
              ) : (
                <path key={f.key} d={f.path} fill={f.color} stroke="var(--bg-1)" strokeWidth="1.5" strokeLinejoin="round">
                  <title>{`${f.label}: ${money(f.value)} · ${f.pct}`}</title>
                </path>
              ))}
              <circle cx="110" cy="110" r="60" fill="var(--bg-1)" />
            </svg> : (
              <div style={{ padding: "20px 0", textAlign: "center" }}>
                <div style={{ fontSize: 13.5, fontWeight: 650, color: recebidos > 0 ? "var(--neg)" : "var(--fg-2)" }}>
                  {recebidos > 0 ? "Despesas acima dos recebimentos" : "Sem recebimentos neste mês"}
                </div>
                <div style={{ marginTop: 8, fontSize: 12, lineHeight: 1.5, color: "var(--fg-3)" }}>
                  {recebidos > 0 ? `Déficit de ${money(-saldo)} · custos equivalem a ${window.fmt.pct(total / recebidos, 1).replace(".", ",")} do recebido.` : "Os percentuais ficam disponíveis quando houver recebimentos."}
                </div>
              </div>
            )}
            <figcaption style={{ marginTop: 10, textAlign: "center", fontSize: 12, color: "var(--fg-3)" }}>
              Recebido no mês <strong className="tnum" style={{ display: "block", marginTop: 3, fontSize: 20, color: "var(--fg-1)" }}>{money(recebidos)}</strong>
              <span style={{ display: "block", marginTop: 5 }}>Despesas: {money(total)}</span>
            </figcaption>
          </figure>
          <dl style={{ flex: "1 1 220px", minWidth: 0, margin: 0 }}>
            {fatias.map((f) => (
              <div key={f.key} style={{ display: "flex", alignItems: "baseline", gap: 10, padding: "8px 0", borderBottom: "1px solid var(--line-1)", fontSize: 12.5 }}>
                <dt style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "baseline", gap: 8, color: "var(--fg-2)" }}>
                  <span aria-hidden="true" style={{ width: 9, height: 9, borderRadius: 3, background: f.color, flexShrink: 0 }} />
                  <span style={{ overflowWrap: "anywhere" }}>{f.label}</span>
                </dt>
                <dd className="tnum" style={{ margin: 0, textAlign: "right", flexShrink: 0 }}>
                  <strong style={{ color: "var(--fg-1)" }}>{f.pct}</strong>
                  <span style={{ display: "block", marginTop: 2, fontSize: 11.5, color: "var(--fg-3)" }}>{money(f.value)}</span>
                </dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </Card>
  );
}

function DreRow({ label, value, strong, neg, indent, title }) {
  return (
    <div title={title} style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "6px 0", borderBottom: "1px solid var(--line-faint)", fontSize: strong ? 13.5 : 12.5, cursor: title ? "help" : "default" }}>
      <span style={{ color: strong ? "var(--fg-1)" : "var(--fg-3)", fontWeight: strong ? 650 : 400, paddingLeft: indent ? 14 : 0 }}>{label}</span>
      <span className="tnum" style={{ fontWeight: strong ? 700 : 550, whiteSpace: "nowrap", color: strong ? (value >= 0 ? "var(--fg-1)" : "var(--neg)") : "var(--fg-2)" }}>
        {neg && value > 0 ? "− " : ""}{money(Math.abs(value))}
      </span>
    </div>
  );
}

// Bloco de setor no DRE: linha do total + itens por categoria indentados.
function DreSetor({ sector, itens }) {
  const entries = Object.entries(itens || {}).sort((a, b) => b[1] - a[1]);
  const total = r2(entries.reduce((a, [, v]) => a + v, 0));
  if (!(total > 0)) return null;
  return (
    <>
      <DreRow label={SECTOR_LABEL[sector] || sector} value={total} neg />
      {entries.map(([k, v]) => <DreRow key={k} label={catLabel(k)} value={v} neg indent />)}
    </>
  );
}

// Faturas PRESUMIDAS: nasceram pagas no fechamento à vista e ninguém provou o
// dinheiro. Confirmar com data e meio as tira do presumido e põe no recebido;
// o pagamento do MP de valor exato confirma sozinho.
function PresumidoCard({ presumido, onConfirm }) {
  const [all, setAll] = useState(false);
  const items = all ? presumido.items : presumido.items.slice(0, 8);
  return (
    <Card title="Pendente de confirmação" hint={`${int(presumido.n)} fatura${presumido.n === 1 ? "" : "s"} que nasceram pagas no fechamento à vista sem prova de recebimento · ${money(presumido.total)} fora do recebido até alguém confirmar`}>
      <div style={{ padding: "6px var(--inset-x) 16px", display: "flex", flexDirection: "column" }}>
        {items.map((i) => (
          <div key={i.id} className="finance-presumed-row">
            <span className="tnum dim" style={{ width: 42 }}>{dmy(String(i.paidAt || "").slice(0, 10))}</span>
            <span style={{ flex: 1, minWidth: 160 }}>{i.customerName || i.customer}<span className="dim"> · {RECEITA_LABEL[i.kind] || i.kind}</span></span>
            <span className="tnum" style={{ fontWeight: 650 }}>{money(i.amount)}</span>
            <button onClick={() => onConfirm(i)} style={{ ...btn, height: 28 }}>confirmar recebimento</button>
          </div>
        ))}
        {presumido.items.length > 8 && (
          <button onClick={() => setAll((v) => !v)} style={{ alignSelf: "flex-start", marginTop: 8, fontSize: 12.5, fontWeight: 600, color: "var(--accent)" }}>
            {all ? "ver menos" : `ver todas (${int(presumido.items.length)})`}
          </button>
        )}
        <InfoNota style={{ marginTop: 10 }}>
          O pagamento do Mercado Pago com o valor exato confirma sozinho. Sem ele, confirme com a data e o meio em que o dinheiro entrou (comprovante do banco, por exemplo).
        </InfoNota>
      </div>
    </Card>
  );
}

export function ResumoTab({ product, month, onTab, onMonth }) {
  const { fin, err, reload } = useFin(product, month);
  const { version } = useData();
  const [sum, setSum] = useState(null), [sumErr, setSumErr] = useState(null), [sumRetry,setSumRetry]=useState(0); // IA + WhatsApp (custos externos) vêm do summary existente
  const [confirming, setConfirming] = useState(null);
  useEffect(() => {
    let alive = true;
    setSumErr(null);
    api.expensesSummary(product.id, month).then((s) => alive && setSum(s)).catch(e=>{if(alive)setSumErr(e.message);});
    return () => { alive = false; };
  }, [product.id, month, version, sumRetry]);
  if (!fin || err) return <Carregando err={err} retry={reload} />;

  if (sumErr || !sum) return <Carregando err={sumErr} retry={()=>setSumRetry(v=>v+1)} />;
  const ai = Number(sum?.ai) || 0;
  const wa = Number(sum?.wa) || 0;
  const D = fin.dre, S = D.setores;
  // UMA fórmula (a do servidor): a UI só desconta IA e WhatsApp, que são
  // custo externo de entregar/atender e entram no COGS.
  const cogs = { ...S.cogs, ...(ai > 0 ? { ia: ai } : {}), ...(wa > 0 ? { wa } : {}) };
  const receitaTotal = D.receitaTotal;
  const liquida = D.receitaLiquida;
  const bruto = r2(D.lucroBruto - ai - wa);
  const margem = liquida > 0 ? Math.round((bruto / liquida) * 1000) / 10 : null;
  const resultado = r2(D.resultado - ai - wa);
  const despesasMes = r2(D.despesasMes + ai + wa);
  const abertasTotal = fin.tiles.vencidos.total + fin.tiles.vencemHoje.total + fin.tiles.aVencer.total;
  const presumido = fin.receber.presumido;

  return (
    <div className="finance-content">
      {/* O RESUMO ABRE PELAS PENDÊNCIAS COM PRAZO (13/09), não por seis
          números de peso igual: dinheiro vencido a receber, conta que vence
          esta semana, entrada sem dono no Mercado Pago e recebimento presumido
          sem prova são o que exige alguém hoje. */}
      <div className="finance-pendings">
        {fin.receber.vencidas.n > 0 && (
          <AvisoTopo navy
            titulo={`${money(fin.receber.vencidas.total)} vencidos a receber`}
            nota={`${int(fin.receber.vencidas.n)} ${fin.receber.vencidas.n === 1 ? "fatura" : "faturas"}`}
            acao={{ label: "cobrar em Clientes ↗", href: "#customers" }}
          />
        )}
        {fin.tiles.vencidos.n > 0 && (
          <AvisoTopo navy={fin.receber.vencidas.n === 0} tom="warn"
            titulo={`${int(fin.tiles.vencidos.n)} ${fin.tiles.vencidos.n === 1 ? "conta vencida" : "contas vencidas"} · ${money(fin.tiles.vencidos.total)}`}
            nota={fin.tiles.vencemHoje.n ? `mais ${int(fin.tiles.vencemHoje.n)} vencendo hoje (${money(fin.tiles.vencemHoje.total)})` : "folha e fornecedores"}
            acao={{ label: "abrir A pagar", onClick: () => onTab?.("pagar") }}
          />
        )}
        {fin.conciliacao.pendentes.n > 0 && (
          <AvisoTopo navy={fin.receber.vencidas.n === 0 && fin.tiles.vencidos.n === 0} tom="info"
            titulo={`${int(fin.conciliacao.pendentes.n)} ${fin.conciliacao.pendentes.n === 1 ? "entrada sem dono" : "entradas sem dono"} no Mercado Pago`}
            nota={`${money(fin.conciliacao.pendentes.total)} esperando cliente ou motivo`}
            acao={{ label: "conciliar", onClick: () => onTab?.("conciliacao") }}
          />
        )}
      </div>

      {/* A foto do mês: uma linha, com o detalhe no title de sempre. */}
      <div className="finance-photo">
        {[
          { rot: "recebido no mês", v: money(fin.receber.recebidosMes), nota: `espelho MP ${money(fin.conciliacao.espelhoMes)}`, title: "Dinheiro que ENTROU no mês: pagamento de cliente aprovado no Mercado Pago + fatura baixada com prova. A mesma régua de Clientes, Planos e do imposto." },
          { rot: "presumido", v: money(presumido.mes.total), nota: presumido.n ? `${int(presumido.n)} sem prova no total` : "nada sem prova", tone: presumido.mes.total > 0 ? "warn" : null, title: "Faturas que nasceram pagas no fechamento à vista e ninguém provou o dinheiro. Ficam FORA do recebido até o MP casar ou alguém confirmar." },
          { rot: "a receber", v: money(fin.receber.emAberto.total), nota: fin.receber.vencidas.n ? `${int(fin.receber.vencidas.n)} vencida${fin.receber.vencidas.n > 1 ? "s" : ""}` : "nada vencido", title: "Faturas em aberto agora (qualquer mês)." },
          { rot: "despesas do mês", v: money(despesasMes), nota: "contas + custos automáticos", title: "Contas a pagar com competência no mês + custos da aba Custos (IA e WhatsApp inclusos)." },
          { rot: "a pagar em aberto", v: money(abertasTotal), nota: fin.tiles.vencidos.n ? `${int(fin.tiles.vencidos.n)} vencida${fin.tiles.vencidos.n > 1 ? "s" : ""}` : "nada vencido", title: "Contas em aberto: vencidas + vencendo hoje + a vencer." },
          { rot: "margem bruta", v: margem == null ? "—" : `${String(margem).replace(".", ",")}%`, nota: `lucro bruto ${money(bruto)}`, tone: margem != null && margem < 70 ? "neg" : null, title: "(Receita líquida − custo do serviço) ÷ receita líquida. SaaS saudável opera entre 70% e 85%." },
          { rot: "resultado do mês", v: money(resultado), nota: "recebido − despesas", tone: resultado < 0 ? "neg" : "pos", title: "Regime de caixa na receita (recebido de verdade) e competência nas despesas. A mesma conta do DRE ao lado." },
        ].map((x) => (
          <div key={x.rot} title={x.title} style={{ minWidth: 128 }}>
            <div className="kicker">{x.rot}</div>
            <div className="tnum" style={{ fontFamily: "var(--display)", fontSize: 20, fontWeight: 700, lineHeight: 1.2, color: x.tone === "neg" ? "var(--neg)" : x.tone === "pos" ? "var(--pos)" : x.tone === "warn" ? "var(--warn)" : "var(--fg-1)" }}>{x.v}</div>
            <div style={{ fontSize: 11, color: "var(--fg-4)" }}>{x.nota}</div>
          </div>
        ))}
      </div>

      {presumido.n > 0 && <PresumidoCard presumido={presumido} onConfirm={(i) => setConfirming(i)} />}

      <div className="finance-summary-grid">
        <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
          <FluxoCard fluxo={fin.fluxo} previsto={fin.previsto} month={month} onMonth={onMonth} />
          <GastosCard setores={{ ...S, cogs }} recebidosMes={fin.receber.recebidosMes} month={month} />
        </div>
        <Card title="DRE do mês" hint="P&L de SaaS: receita · deduções · custo do serviço · margem bruta · setores">
          <div style={{ padding: "10px var(--inset-x) 18px" }}>
            {Object.entries(D.receita).sort((a, b) => b[1] - a[1]).map(([k, v]) => (
              <DreRow key={k} label={RECEITA_LABEL[k] || k} value={v} indent />
            ))}
            <DreRow label="Receita recebida" value={receitaTotal} strong />
            <DreSetor sector="deducoes" itens={S.deducoes} />
            {D.deducoes > 0 && <DreRow label="Receita líquida" value={liquida} strong />}
            <DreSetor sector="cogs" itens={cogs} />
            <DreRow label={`Lucro bruto${margem != null ? ` · margem ${String(margem).replace(".", ",")}%` : ""}`} value={bruto} strong
              title="Benchmark de SaaS: margem bruta saudável entre 70% e 85%." />
            <DreSetor sector="sm" itens={S.sm} />
            <DreSetor sector="rd" itens={S.rd} />
            <DreSetor sector="ga" itens={S.ga} />
            <DreRow label="Resultado do mês" value={resultado} strong />
            {fin.conciliacao.pendentes.n > 0 && (
              <div style={{ marginTop: 10, fontSize: 11.5, color: "var(--warn)" }}>
                {int(fin.conciliacao.pendentes.n)} pagamento{fin.conciliacao.pendentes.n > 1 ? "s" : ""} de cliente sem dono na conciliação ({money(fin.conciliacao.pendentes.total)}) já contam no recebido quando vinculados
              </div>
            )}
          </div>
        </Card>
      </div>
      {confirming && createPortal(
        <ManualPaidModal target={{ kind: "confirm", id: confirming.id, amount: confirming.amount, title: RECEITA_LABEL[confirming.kind] || confirming.kind, targetName: confirming.customerName, at: confirming.paidAt }}
          onClose={() => setConfirming(null)}
          onDone={async () => { setConfirming(null); window.toast?.("recebimento confirmado", "pos"); await reload(); }} />,
        document.body)}
    </div>
  );
}

// ── Conciliação ──────────────────────────────────────────────────────────────
const IGNORE_REASONS = ["estorno", "transferência interna", "não é do produto", "teste", "outro"];

// Identidade mais forte disponível do pagador → vira a regra de aprendizado.
// (payerDocMp = o documento era do próprio MP: não identifica ninguém.)
const bestIdOf = (p) => {
  if (String(p.payerDoc || "").replace(/\D+/g, "")) return ["payerDoc", p.payerDoc, `documento ${p.payerDoc}`];
  if (String(p.payerEmail || "").trim()) return ["payerEmail", p.payerEmail, p.payerEmail];
  if (String(p.payerName || "").trim()) return ["payerName", p.payerName, p.payerName];
  return null;
};

const FILTROS = [
  { id: "fila", label: "precisa de dono" },
  { id: "venda", label: "vendas" },
  { id: "maquininha", label: "maquininha" },
  { id: "interna", label: "internas" },
  { id: "saida", label: "saídas" },
  { id: "ruido", label: "ruído" },
  { id: "ignorados", label: "desconsiderados" },
  { id: "todos", label: "todos" },
];

export function ConciliacaoTab({ product, month }) {
  const { fin, err, reload } = useFin(product, month);
  const { version } = useData();
  const { CUSTOMERS } = window.SEED;
  const customers = useMemo(() => (CUSTOMERS || []).filter((c) => c.saas === product?.id), [CUSTOMERS, product?.id]);
  const [payments, setPayments] = useState(null);
  const [rules, setRules] = useState([]);
  const [pick, setPick] = useState({});      // paymentId -> customer escolhido
  const [motivo, setMotivo] = useState({});  // paymentId -> motivo de desconsiderar
  const [lembrar, setLembrar] = useState({}); // paymentId -> lembrar do pagador (default sim)
  const [movPick, setMovPick] = useState({}); // saída -> payable escolhida
  const [note, setNote] = useState(null);
  const [filtro, setFiltro] = useState("fila");
  const [todosMeses, setTodosMeses] = useState(false);

  const [loadErr,setLoadErr] = useState(null), [busy,setBusy] = useState(false);
  const action=React.useRef(false), read=React.useRef(0);
  async function run(fn){if(action.current)return;action.current=true;setBusy(true);try{await fn();}finally{action.current=false;setBusy(false);}}
  const loadAll = useCallback(async () => {
    const seq=++read.current;setLoadErr(null);
    try { const [p,r]=await Promise.all([api.mpPayments({saas:product.id}),api.list("fin_rules")]);
      if(seq===read.current){setPayments(Array.isArray(p)?p:p.payments||[]);setRules(r.filter(x=>!x.saas||x.saas===product.id));}
    }catch(e){if(seq===read.current)setLoadErr(e.message);}
  }, [product.id]);
  useEffect(() => { loadAll(); return()=>{read.current++;}; }, [loadAll, version]);

  if (!fin || err || loadErr || payments == null) return <Carregando err={err || loadErr} retry={()=>{reload();loadAll();}} />;

  const mesDe = (p) => String(p.dateApproved || p.dateCreated || "").slice(0, 7);
  const aprovados = payments.filter((p) => p.status === "approved");
  const isSale = (p) => kindOf(p) === "venda" || kindOf(p) === "maquininha";
  const pendentes = aprovados.filter((p) => isSale(p) && !p.customer && !p.finIgnored)
    .sort((a, b) => String(b.dateApproved || b.dateCreated).localeCompare(String(a.dateApproved || a.dateCreated)));
  const delta = r2(fin.conciliacao.espelhoMes - fin.receber.recebidosMes);
  const querLembrar = (p) => lembrar[p.id] !== false && !!bestIdOf(p);
  const C = fin.conciliacao;
  const naoVenda = r2(C.internas.total + C.saidasMp.total + C.ruido.total);

  // Aprendizado: a ação manual vira regra quando "lembrar" está ligado — o
  // servidor aplica na criação e a cada pagamento novo; o pagador não é
  // perguntado de novo.
  const criarRegra = async (p, action, extra) => {
    const best = bestIdOf(p);
    if (!best) return;
    await api.create("fin_rules", {
      saas: product.id, matchField: best[0], matchValue: best[1],
      action, ...extra, createdAt: new Date().toISOString(),
    });
  };
  const vincular = async (p, customerId) => {
    const cust = customerId || pick[p.id];
    if (!cust) return;
    try {
      await api.mpLinkPayment(p.id, cust);
      if (querLembrar(p)) { try { await criarRegra(p, "vincular", { customer: cust }); } catch(e){ setNote({ok:false,text:`Pagamento vinculado; regra não criada: ${e.message}`}); await reload(); await loadAll(); return; } }
      setNote({ ok: true, text: querLembrar(p) ? "vinculado · regra criada: esse pagador não pergunta mais" : "vinculado" });
      await reload(); await loadAll();
    } catch (e) { setNote({ ok: false, text: e.message }); }
  };
  const desconsiderar = async (p) => {
    try {
      await api.update("mp_payments", p.id, { finIgnored: true, finIgnoredReason: motivo[p.id] || "outro" });
      if (querLembrar(p)) { try { await criarRegra(p, "desconsiderar", { reason: motivo[p.id] || "outro" }); } catch(e){setNote({ok:false,text:`Pagamento desconsiderado; regra não criada: ${e.message}`});await reload();await loadAll();return;} }
      await reload(); await loadAll();
    } catch (e) { setNote({ ok: false, text: e.message }); }
  };
  const reconsiderar = async (p) => {
    try { await api.update("mp_payments", p.id, { finIgnored: false, finIgnoredReason: "" }); await reload(); await loadAll(); } catch (e) { setNote({ ok: false, text: e.message }); }
  };
  const excluirRegra = async (r) => {
    if (!window.confirm(`Excluir a regra de ${r.matchValue}? Os próximos pagamentos voltarão à conciliação.`)) return;
    try { await api.remove("fin_rules", r.id); await loadAll(); } catch (e) { setNote({ ok: false, text: e.message }); }
  };
  const aplicarRegras = async () => {
    try { const r = await api.finRulesApply(product.id); setNote({ ok: true, text: `regras aplicadas: ${int(r.applied)} pendência${r.applied === 1 ? "" : "s"} resolvida${r.applied === 1 ? "" : "s"}, ${int(r.settled)} fatura${r.settled === 1 ? "" : "s"} baixada${r.settled === 1 ? "" : "s"}` }); await reload(); await loadAll(); }
    catch (e) { setNote({ ok: false, text: e.message }); }
  };

  // UM sincronizar: entradas (espelho, com reclassificação), saídas
  // (settlement report, assíncrono do lado do MP) e regras.
  const syncTudo = async () => {
    setNote({ ok: true, text: "sincronizando entradas e saídas…" });
    try {
      const r = await api.finSyncAll(product.id, { reclassify: C.heuristicas > 0 });
      const inTxt = r.in?.error ? `entradas: ${r.in.error}` : `entradas: ${int(r.in?.seen || 0)} lidas, ${int(r.in?.settled || 0)} baixadas${r.in?.reclassified ? `, ${int(r.in.reclassified)} reclassificadas` : ""}`;
      const o = r.out || {};
      const outTxt = o.error ? `saídas: ${o.error}` : o.requestError ? `saídas: ${int(o.imported || 0)} importadas · o MP recusou gerar relatório novo: ${o.requestError}`
        : `saídas: ${int(o.imported || 0)} importadas de ${int(o.filesRead || 0)} relatório${o.filesRead === 1 ? "" : "s"}${o.requested ? " · relatório novo pedido ao MP, sincronize de novo em alguns minutos" : ""}`;
      const rulesTxt = r.rules?.applied ? ` · regras: ${int(r.rules.applied)} resolvida${r.rules.applied === 1 ? "" : "s"}` : "";
      setNote({ ok: !r.in?.error && !o.error && !o.requestError, text: `${inTxt} · ${outTxt}${rulesTxt}` });
      await reload(); await loadAll();
    } catch (e) { setNote({ ok: false, text: e.message }); }
  };

  // Saídas sem dono (settlement + pagamento feito com o saldo): casar com a
  // conta a pagar dá baixa nela; desconsiderar tira da fila.
  const saidas = C.saidasPendentes.items || [];
  const vincularMov = async (m, pid) => {
    if (!pid) return;
    const pay = fin.payables.find((x) => x.id === pid);
    try {
      await api.update(m.source === "mp" ? "mp_payments" : "mp_movements", m.id, { payableId: pid });
      if (pay && pay.status !== "paga") await api.update("payables", pid, { status: "paga", paidAt: `${String(m.at).slice(0, 10)}T12:00:00.000Z`, paidVia: "mp" });
      setNote({ ok: true, text: pay && pay.status !== "paga" ? "saída casada e conta baixada" : "saída casada com a conta" });
      await reload(); await loadAll();
    } catch (e) { setNote({ ok: false, text: e.message }); }
  };
  const ignorarMov = async (m) => {
    try { await api.update(m.source === "mp" ? "mp_payments" : "mp_movements", m.id, { finIgnored: true, ...(m.source === "mp" ? { finIgnoredReason: "saída da conta" } : {}) }); await reload(); await loadAll(); } catch (e) { setNote({ ok: false, text: e.message }); }
  };
  const movSugestao = (m) => fin.payables.find((p) => p.status !== "paga" && Math.abs((Number(p.amount) || 0) - (Number(m.amount) || 0)) <= 0.01);

  // A FILA é uma só (Leo, 30/08): entrada e saída misturadas, por data.
  const fila = [
    ...pendentes.map((x) => ({ kind: "entrada", at: String(x.dateApproved || x.dateCreated || "").slice(0, 10), row: x })),
    ...saidas.map((x) => ({ kind: "saida", at: String(x.at || "").slice(0, 10), row: x })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  // Lista do espelho por tipo, no mês (ou tudo).
  const noMes = (p) => todosMeses || mesDe(p) === month;
  const lista = payments.filter((p) => {
    if (!noMes(p)) return false;
    if (filtro === "ignorados") return !!p.finIgnored;
    if (filtro === "todos") return true;
    if (p.finIgnored) return false;
    return kindOf(p) === filtro;
  });
  const contagem = (id) => payments.filter((p) => noMes(p) && (id === "ignorados" ? p.finIgnored : id === "todos" ? true : (!p.finIgnored && kindOf(p) === id))).length;

  return (
    <fieldset disabled={busy} className="finance-content finance-conciliation">
      {note && <div role={note.ok ? "status" : "alert"} className="finance-notice" style={{ fontSize: 12, color: note.ok ? "var(--pos)" : "var(--neg)" }}>{note.text}</div>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 190px), 1fr))", gap: 12 }}>
        <StatTile label="Precisa de dono" value={int(fila.length)} delta={`${int(pendentes.length)} entrada${pendentes.length === 1 ? "" : "s"} (${money(C.pendentes.total)}) · ${int(saidas.length)} saída${saidas.length === 1 ? "" : "s"} (${money(C.saidasPendentes.total)})`}
          tone={fila.length ? "down" : "flat"} title="Pagamentos de cliente aprovados sem cliente vinculado e saídas da conta ainda sem conta a pagar." />
        <StatTile label={`Vendas em ${mesCurto(month)}`} value={money(C.espelhoMes)}
          delta={delta === 0 ? "bateu com o recebido" : `${delta > 0 ? "+" : "−"} ${money(Math.abs(delta))} vs recebido do mês`}
          title="Pagamentos de cliente aprovados no mês (venda + maquininha). A diferença pro recebido é o que ainda não tem dono, ou baixa manual sem pagamento no MP." />
        <StatTile label="Taxa do MP no mês" value={money(C.taxasMes)} delta="bruto − líquido, por pagamento de cliente"
          title="O que o Mercado Pago descontou de verdade. É a base do custo 'taxa real do MP' na aba Custos." />
        <StatTile label="Não é venda" value={money(naoVenda)} delta={`${int(C.internas.n)} interna${C.internas.n === 1 ? "" : "s"} · ${int(C.saidasMp.n)} saída${C.saidasMp.n === 1 ? "" : "s"} · ${int(C.ruido.n)} ruído`}
          title="O que o espelho traz e NÃO é dinheiro de cliente: reserva/transferência da própria casa, pagamento feito com o saldo, cashback. Fica fora do recebido e da base de taxa." />
      </div>
      {C.heuristicas > 0 && (
        <InfoNota>
          {int(C.heuristicas)} pagamento{C.heuristicas === 1 ? "" : "s"} classificado{C.heuristicas === 1 ? "" : "s"} por heurística (marcado{C.heuristicas === 1 ? "" : "s"} com “?”). Sincronizar pede ao Mercado Pago quem pagou e quem recebeu e confirma a classificação.
        </InfoNota>
      )}

      <Card title="Precisa de dono" hint="entradas de cliente e saídas da conta numa fila só, por data · vincule ao cliente, case com a conta a pagar ou desconsidere"
        action={<span style={{ display: "inline-flex", gap: 8 }}>
          {C.regrasPendentes > 0 && <button onClick={()=>run(aplicarRegras)} style={btn} title={`${int(C.regrasPendentes)} pendência${C.regrasPendentes === 1 ? "" : "s"} que uma regra resolve`}>aplicar regras ({int(C.regrasPendentes)})</button>}
          <button onClick={()=>run(syncTudo)} style={btnPri}>↻ sincronizar</button>
        </span>}>
        <div style={{ padding: "10px var(--inset-x) 18px", display: "flex", flexDirection: "column", gap: 10 }}>
          {!fila.length && (
            <span className="dim" style={{ fontSize: 12.5 }}>
              Tudo conciliado. As entradas chegam sozinhas pelo sync automático; as saídas dependem do
              relatório do MP (assíncrono): sincronize, aguarde alguns minutos e sincronize de novo.
            </span>
          )}
          {fila.map(({ kind, row }) => kind === "entrada" ? (() => {
            const p = row;
            const sug = C.sugestoes?.[p.id];
            const best = bestIdOf(p);
            const k = KIND_LABEL[kindOf(p)];
            return (
              <div key={`entrada:${p.id}`} style={{ padding: "10px 12px", background: "var(--bg-inset)", border: "1px solid var(--line-1)", borderRadius: "var(--r-3)", display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
                  <Pill tone="pos" title={k.title}>{k.label}</Pill>
                  <span className="tnum dim" style={{ fontSize: 12, width: 42 }}>{dmy((p.dateApproved || p.dateCreated || "").slice(0, 10))}</span>
                  <span style={{ flex: 1, minWidth: 160, fontSize: 13, fontWeight: 600 }}>
                    {p.payerName || p.payerEmail || p.description || "pagador sem nome"}
                    <span className="dim" style={{ display: "block", fontSize: 11, fontWeight: 400 }}>
                      {[p.payerDoc, p.payerDocMp && "PIX via MP (sem documento)", p.payerEmail, p.payerBank && `via ${p.payerBank}`].filter(Boolean).join(" · ") || "sem identificação"}
                    </span>
                  </span>
                  <span className="tnum" style={{ fontWeight: 650, whiteSpace: "nowrap" }}>{money(p.amount)}</span>
                  <span className="dim tnum" style={{ fontSize: 11.5, whiteSpace: "nowrap" }}>
                    {[mpMethodLabel(p) || p.method, p.netAmount ? `líq. ${money(p.netAmount)}` : null].filter(Boolean).join(" · ")}
                  </span>
                </div>
                {sug && (
                  <button onClick={() => run(()=>vincular(p, sug.customer))}
                    style={{ alignSelf: "flex-start", padding: "4px 10px", borderRadius: 999, border: "1px solid color-mix(in srgb, var(--accent) 35%, transparent)", background: "var(--accent-soft)", color: "var(--accent)", fontSize: 12, fontWeight: 600 }}
                    title="É só uma sugestão: valor igual não prova nada. Confira o pagador antes.">
                    sugestão: {sug.motivo} →
                  </button>
                )}
                <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                  <select aria-label={`Cliente de ${p.payerName || p.id}`} value={pick[p.id] || ""} onChange={(e) => setPick((s) => ({ ...s, [p.id]: e.target.value }))} style={{ ...inp, minWidth: 150 }}>
                    <option value="">vincular cliente…</option>
                    {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                  <button onClick={() => run(()=>vincular(p))} disabled={!pick[p.id]} style={{ ...btnPri, opacity: pick[p.id] ? 1 : .55 }}>Vincular</button>
                  <select aria-label={`Motivo de ${p.payerName || p.id}`} value={motivo[p.id] || ""} onChange={(e) => setMotivo((s) => ({ ...s, [p.id]: e.target.value }))} style={{ ...inp, width: 150 }}>
                    <option value="">desconsiderar…</option>
                    {IGNORE_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                  <button onClick={() => run(()=>desconsiderar(p))} disabled={!motivo[p.id]} style={{ ...btn, opacity: motivo[p.id] ? 1 : .55 }}>Desconsiderar</button>
                  {best && (
                    <label title={`A regra casa por ${best[2]}. Próximo pagamento desse pagador é resolvido sozinho.`}
                      style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, color: "var(--fg-2)", cursor: "pointer" }}>
                      <input type="checkbox" checked={querLembrar(p)} onChange={(e) => setLembrar((s) => ({ ...s, [p.id]: e.target.checked }))} />
                      lembrar deste pagador
                    </label>
                  )}
                </div>
              </div>
            );
          })() : (() => {
            const m = row;
            const sug = movSugestao(m);
            const chosen = movPick[m.id] || (sug ? sug.id : "");
            return (
              <div key={`saida:${m.id}`} style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", padding: "9px 12px", background: "var(--bg-inset)", border: "1px solid var(--line-1)", borderRadius: "var(--r-3)" }}>
                <Pill tone="neg" title={m.source === "mp" ? "pagamento feito com o saldo da conta (espelho do MP)" : "saque/transferência do relatório da conta (settlement report)"}>saída</Pill>
                <span className="tnum dim" style={{ fontSize: 12, width: 42 }}>{dmy(String(m.at || "").slice(0, 10))}</span>
                <span style={{ flex: 1, minWidth: 140, fontSize: 12.5 }}>
                  {m.source === "mp" ? (m.description || "Pagamento com o saldo da conta") : m.type === "PAYOUT" ? "Transferência enviada" : m.type === "WITHDRAWAL" ? "Saque pra conta bancária" : (m.type || "Saída da conta")}
                  {m.fee > 0 && <span className="dim" style={{ fontSize: 11 }}> · tarifa {money(m.fee)}</span>}
                </span>
                <span className="tnum" style={{ fontWeight: 650, whiteSpace: "nowrap" }}>{money(m.amount)}</span>
                <select aria-label={`Conta da saída ${m.id}`} value={chosen} onChange={(e) => setMovPick((s) => ({ ...s, [m.id]: e.target.value }))} style={{ ...inp, minWidth: 180 }}>
                  <option value="">casar com conta a pagar…</option>
                  {fin.payables.map((x) => <option key={x.id} value={x.id}>{x.description} · {money(x.amount)}{x.status === "paga" ? " (paga)" : ""}</option>)}
                </select>
                <button onClick={() => run(()=>vincularMov(m, chosen))} disabled={!chosen} style={{ ...btnPri, opacity: chosen ? 1 : .55 }}>
                  {sug && !movPick[m.id] ? "casar (mesmo valor)" : "casar"}
                </button>
                <button onClick={() => run(()=>ignorarMov(m))} className="dim" style={{ fontSize: 12, fontWeight: 600 }}>desconsiderar</button>
              </div>
            );
          })())}
        </div>
      </Card>

      <Card title="Espelho do Mercado Pago" hint="tudo que passou pela conta, classificado · venda e maquininha somam no recebido; o resto fica visível e fora dos números"
        action={<button onClick={() => setTodosMeses((v) => !v)} style={{ fontSize: 12.5, fontWeight: 600, color: "var(--accent)" }}>{todosMeses ? `só ${mesCurto(month)}` : "todos os meses"}</button>}>
        <div style={{ padding: "10px var(--inset-x) 18px", display: "flex", flexDirection: "column", gap: 12 }}>
          <div className="finance-filters" role="group" aria-label="Tipo de lançamento">
            {FILTROS.map((f) => <button key={f.id} type="button" aria-pressed={filtro === f.id} onClick={() => setFiltro(f.id)}>{f.label}<b>{int(f.id === "fila" ? fila.length : contagem(f.id))}</b></button>)}
          </div>
          {filtro === "fila"
            ? <span className="dim" style={{ fontSize: 12.5 }}>a fila está no card acima · escolha um tipo pra ver a lista completa</span>
            : <PagamentosLista product={product} payments={lista} customers={customers} busy={busy}
                onLink={(p, cust) => run(() => vincular(p, cust))}
                vazio={`Nenhum lançamento ${FILTROS.find((f) => f.id === filtro)?.label || ""} em ${todosMeses ? "nenhum mês" : mesLongo(month)}.`} />}
          {filtro === "ignorados" && lista.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column" }}>
              {lista.map((p) => (
                <div key={p.id} style={{ display: "flex", gap: 10, alignItems: "baseline", padding: "6px 0", borderBottom: "1px solid var(--line-faint)", fontSize: 12.5 }}>
                  <span style={{ flex: 1, minWidth: 0 }}>{p.payerName || p.payerEmail || p.description || "sem nome"} <span className="dim">· {p.finIgnoredReason || "outro"}</span></span>
                  <span className="tnum" style={{ fontWeight: 600 }}>{money(p.amount)}</span>
                  <button onClick={() => run(()=>reconsiderar(p))} style={{ color: "var(--accent)", fontSize: 12, fontWeight: 600 }}>reconsiderar</button>
                </div>
              ))}
            </div>
          )}
          <InfoNota>
            Pagamento sem produto identificado aparece em todos os workspaces até ser vinculado. O casamento acontece pelo link do cockpit (fatura, lead ou assinatura), pelo e-mail do pagador ou por regra aprendida; valor igual é só sugestão.
          </InfoNota>
        </div>
      </Card>

      {rules.length > 0 && (
        <Card title="Regras de conciliação" hint="aplicadas quando o pagamento chega e no botão aplicar regras · excluir volta a perguntar">
          <div style={{ padding: "6px var(--inset-x) 16px", display: "flex", flexDirection: "column" }}>
            {rules.map((r) => (
              <div key={r.id} style={{ display: "flex", gap: 10, alignItems: "baseline", padding: "7px 0", borderBottom: "1px solid var(--line-faint)", fontSize: 12.5, flexWrap: "wrap" }}>
                <span style={{ flex: 1, minWidth: 200 }}>
                  <b>{r.matchValue}</b>
                  <span className="dim"> ({r.matchField === "payerDoc" ? "documento" : r.matchField === "payerEmail" ? "e-mail" : "nome"}) → {r.action === "vincular" ? `cliente ${customers.find((c) => c.id === r.customer)?.name || r.customer}` : `desconsiderar (${r.reason || "outro"})`}</span>
                </span>
                <span className="dim tnum" style={{ fontSize: 11.5 }}>{int(r.autoCount || 0)} aplicações</span>
                <button onClick={() => run(()=>excluirRegra(r))} className="dim" style={{ fontSize: 12, fontWeight: 600 }}>excluir</button>
              </div>
            ))}
          </div>
        </Card>
      )}
    </fieldset>
  );
}

// ── A pagar ──────────────────────────────────────────────────────────────────
const FORM_ZERO = { description: "", amount: "", dueDate: "", category: "outros", counterpartyType: "fornecedor", userId: "", supplierName: "", recurring: false, endMonth: "" };

function PayableForm({ product, month, preset, onDone }) {
  const [f, setF] = useState({ ...FORM_ZERO, dueDate: `${month}-05`, ...(preset || {}) });
  const [saving, setSaving] = useState(false), [saveErr,setSaveErr] = useState(null);
  const saveBusy = React.useRef(false);
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const ok = f.description.trim() && Number(f.amount) > 0 && /^\d{4}-\d{2}-\d{2}$/.test(f.dueDate);
  const salvar = async () => {
    if (!ok || saveBusy.current) return;
    saveBusy.current=true;setSaving(true);setSaveErr(null);
    try {
      await api.create("payables", {
        saas: product.id,
        description: f.description.trim(), category: f.category,
        counterpartyType: f.counterpartyType,
        userId: f.counterpartyType === "colaborador" ? f.userId : "",
        supplierName: f.counterpartyType === "fornecedor" ? f.supplierName.trim() : "",
        amount: Number(f.amount),
        month: f.dueDate.slice(0, 7), dueDate: f.dueDate,
        status: "aberta", paidAt: "", paidVia: "",
        recurring: !!f.recurring, endMonth: f.recurring ? (f.endMonth || "") : "",
        templateId: "", notes: "", createdAt: new Date().toISOString(),
      });
      // Recorrente: os meses da janela nascem já (o GET não cria nada).
      if (f.recurring) await api.finMaterialize(product.id, month).catch(() => null);
      setF({ ...FORM_ZERO, dueDate: `${month}-05`, ...(preset || {}) });
      onDone && onDone();
    } catch (e) { setSaveErr(e.message); }
    saveBusy.current=false;setSaving(false);
  };
  return (
    <fieldset disabled={saving} className="finance-payable-form">
      {saveErr && <div role="alert" className="finance-notice">{saveErr}</div>}
      <input aria-label="Descrição da conta" placeholder="descrição (ex.: Salário, Contabilidade)" value={f.description} onChange={(e) => set("description", e.target.value)} style={{ ...inp, flex: 2, minWidth: 180 }} />
      <select aria-label="Categoria da conta" value={f.category} onChange={(e) => set("category", e.target.value)} style={{ ...inp, minWidth: 190 }} title="A categoria decide o setor no DRE (COGS, Vendas & Marketing, Produto, Administrativo).">
        {SECTOR_CATS.map(([sk, sl, cats]) => (
          <optgroup key={sk} label={sl}>
            {cats.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </optgroup>
        ))}
      </select>
      {!preset?.counterpartyType && (
        <select aria-label="Tipo de favorecido" value={f.counterpartyType} onChange={(e) => set("counterpartyType", e.target.value)} style={{ ...inp, width: 120 }}>
          <option value="fornecedor">fornecedor</option>
          <option value="colaborador">colaborador</option>
        </select>
      )}
      {f.counterpartyType === "colaborador"
        ? (preset?.userId ? null : (
          <select aria-label="Colaborador" value={f.userId} onChange={(e) => set("userId", e.target.value)} style={{ ...inp, minWidth: 140 }}>
            <option value="">colaborador…</option>
            {allUsers().map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        ))
        : <input aria-label="Fornecedor" placeholder="fornecedor" value={f.supplierName} onChange={(e) => set("supplierName", e.target.value)} style={{ ...inp, minWidth: 140 }} />}
      <input aria-label="Valor da conta" type="number" min="0" step="0.01" placeholder="valor" value={f.amount} onChange={(e) => set("amount", e.target.value)} style={{ ...inp, width: 110, fontFamily: "var(--mono)", textAlign: "right" }} />
      <input aria-label="Vencimento" type="date" value={f.dueDate} onChange={(e) => set("dueDate", e.target.value)} style={{ ...inp, width: 150, fontFamily: "var(--mono)" }} />
      <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "var(--fg-2)", whiteSpace: "nowrap" }} title="Nasce de novo todo mês, com o mesmo dia de vencimento, até o mês-limite (ou até você encerrar).">
        <input type="checkbox" checked={!!f.recurring} onChange={(e) => set("recurring", e.target.checked)} /> repete todo mês
      </label>
      {f.recurring && <input aria-label="Mês limite da recorrência" type="month" value={f.endMonth} onChange={(e) => set("endMonth", e.target.value)} title="mês-limite (opcional)" style={{ ...inp, width: 150, fontFamily: "var(--mono)" }} />}
      <button onClick={salvar} disabled={!ok} style={{ ...btnPri, opacity: ok ? 1 : .55 }}>{saving ? "salvando…" : "lançar"}</button>
    </fieldset>
  );
}

function situacao(p, today) {
  if (p.status === "paga") return <Pill tone="pos">paga {dmy(String(p.paidAt || "").slice(0, 10))}</Pill>;
  if (p.dueDate && p.dueDate < today) return <Pill tone="neg">vencida</Pill>;
  if (p.dueDate === today) return <Pill tone="warn">vence hoje</Pill>;
  return <Pill>em aberto</Pill>;
}

function PayableRow({ p, fin, reload, showPerson = true }) {
  const [busy,setBusy]=useState(false),[err,setErr]=useState(null);
  const [editing, setEditing] = useState(false), [draft, setDraft] = useState("");
  const action=React.useRef(false);
  async function run(fn){if(action.current)return;action.current=true;setBusy(true);setErr(null);try{await fn();await reload();}catch(e){setErr(e.message);}finally{action.current=false;setBusy(false);}}
  const user = p.userId ? allUsers().find((u) => u.id === p.userId) : null;
  // Revisar a folha: valor editado à mão fica (amountManual) e gerar de novo não sobrescreve.
  const salvarValor = () => { const v = Number(String(draft).replace(",", ".")); if (!(v > 0)) return; setEditing(false); return run(()=>api.update("payables",p.id,{amount:v,amountManual:true})); };
  const pagar = () => run(()=>api.update("payables",p.id,{status:"paga",paidAt:new Date().toISOString()}));
  const reabrir = () => run(()=>api.update("payables",p.id,{status:"aberta",paidAt:"",paidVia:""}));
  const excluir = () => {if(window.confirm(`Excluir "${p.description}" (${money(p.amount)})?${p.recurring ? " Os meses futuros param de nascer; os já lançados ficam." : ""}`))return run(()=>api.remove("payables",p.id));};
  const encerrar = () => {if(window.confirm(`Encerrar "${p.description}"? Este mês é o último da recorrência.`))return run(()=>api.update("payables",p.id,{endMonth:fin.month}));};
  return (
    <fieldset disabled={busy} className="finance-payable-row">
      {err && <div role="alert" className="finance-notice">{err}</div>}
      <span className="tnum dim" style={{ fontSize: 12, width: 42 }} title={`vencimento ${p.dueDate}`}>{dmy(p.dueDate)}</span>
      <span style={{ flex: 1, minWidth: 160, fontSize: 13 }}>
        {p.description}
        <span className="dim" style={{ display: "block", fontSize: 11 }}>
          {[catLabel(p.category),
            p.month !== fin.month ? `competência ${mesCurto(p.month)}` : null,
            p.recurring ? "recorrente" : p.templateId ? "da recorrência" : null,
            p.source === "payroll" ? "folha pela Remuneração" : null,
            p.amountManual ? "valor revisado à mão" : null,
            p.paidVia === "mp" ? (p.autoMatched ? "baixada sozinha pela saída do MP" : "baixada pela saída do MP") : null,
          ].filter(Boolean).join(" · ")}
        </span>
        {p.payroll && (
          <span className="dim tnum" style={{ display: "block", fontSize: 11 }} title={p.notes || ""}>
            fixo {money(p.payroll.fixed)} + variável {money(p.payroll.variable)} + time {money(p.payroll.teamBonus)}{p.payroll.stamped ? "" : " · variável entra no fechamento do mês"}
          </span>
        )}
      </span>
      {showPerson && (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, minWidth: 120, fontSize: 12.5 }}>
          {user ? (<><Avatar id={user.id} name={user.name} size={20} /> {user.name}</>) : (p.supplierName || <span className="dim">sem favorecido</span>)}
        </span>
      )}
      {editing
        ? <span style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
            <input aria-label="Novo valor" type="number" min="0" step="0.01" value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") salvarValor(); if (e.key === "Escape") setEditing(false); }} style={{ ...inp, width: 110, height: 28, fontFamily: "var(--mono)", textAlign: "right" }} autoFocus />
            <button onClick={salvarValor} style={{ ...btnPri, height: 28 }}>salvar</button>
            <button onClick={() => setEditing(false)} className="dim" style={{ fontSize: 12 }}>cancelar</button>
          </span>
        : <button className="tnum" onClick={() => { if (p.status !== "paga") { setDraft(String(p.amount)); setEditing(true); } }} title={p.status !== "paga" ? "editar o valor (revisão da folha)" : ""} style={{ fontWeight: 650, whiteSpace: "nowrap", padding: 0, cursor: p.status !== "paga" ? "pointer" : "default" }}>{money(p.amount)}</button>}
      {situacao(p, fin.today)}
      <span style={{ display: "inline-flex", gap: 8 }}>
        {p.status !== "paga"
          ? <button onClick={pagar} style={{ color: "var(--pos)", fontSize: 12.5, fontWeight: 600 }}>informar pagamento</button>
          : <button onClick={reabrir} className="dim" style={{ fontSize: 12, fontWeight: 600 }}>reabrir</button>}
        {p.recurring && !p.endMonth && <button onClick={encerrar} title="Este mês é o último: a recorrência para de gerar meses novos." style={{ color: "var(--warn)", fontSize: 12, fontWeight: 600 }}>encerrar</button>}
        <button onClick={excluir} className="dim" style={{ fontSize: 12, fontWeight: 600 }}>excluir</button>
      </span>
    </fieldset>
  );
}

// Categoria default pelo PAPEL da pessoa: comercial → S&M, CS/integrador →
// COGS (suporte), social → S&M, resto → administrativo.
const roleCat = (u) => {
  const roles = u?.roles || [];
  if (roles.includes("sdr") || roles.includes("closer") || roles.includes("social")) return "pessoal_com";
  if (roles.includes("integrator")) return "suporte";
  return "pessoal_adm";
};

// ── Folha salarial (aba própria, 12/10/2026) ─────────────────────────────────
// A folha NASCE da Remuneração: "gerar folha" calcula, por pessoa, fixo do
// nível/regime (ou fixo da pessoa) + duas pernas pelo atingimento carimbado +
// bônus de time + VR/VT + acordos recorrentes da FICHA ± ajustes do mês, e
// cria/atualiza a conta de cada um (paga não muda; valor revisado à mão é
// respeitado). Gerar e revisar antes de pagar (Leo). Papel e nível vivem no
// usuário (Equipe / Metas → Meta por pessoa); o que foge do plano mora na ficha.
const KIND_EXTRA = { beneficio: "benefício", acordo: "acordo", desconto: "desconto" };
const ROLE_LABEL = { sdr: "SDR", closer: "Closer", cs: "Integrador · CS", social: "Mídia social", manual: "sócio · retirada" };
const dmyFull = (d) => (d ? `${String(d).slice(8, 10)}/${String(d).slice(5, 7)}/${String(d).slice(2, 4)}` : "");
const sign = (v) => `${v < 0 ? "−" : "+"} ${money(Math.abs(v))}`;

function FichaForm({ product, uid, profile, onDone, onCancel }) {
  const [f, setF] = useState({ regime: profile?.regime || "", fixed: profile?.fixed ?? "", benefits: profile?.benefits !== false, vrDay: profile?.vrDay ?? "", vtDay: profile?.vtDay ?? "", vr: profile?.vr || "", vt: profile?.vt || "", notes: profile?.notes || "", extras: Array.isArray(profile?.extras) ? profile.extras.map((e) => ({ ...e })) : [] });
  const [saving, setSaving] = useState(false), [err, setErr] = useState(null);
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const setExtra = (i, k, v) => setF((s) => ({ ...s, extras: s.extras.map((e, j) => (j === i ? { ...e, [k]: v } : e)) }));
  const numOrNull = (v) => (v === "" || v == null ? null : Number(String(v).replace(",", ".")));
  const salvar = async () => {
    if (saving) return;
    setSaving(true); setErr(null);
    try {
      const doc = {
        id: uid, uid, saas: product.id, regime: f.regime || "", fixed: numOrNull(f.fixed),
        benefits: !!f.benefits, vrDay: numOrNull(f.vrDay), vtDay: numOrNull(f.vtDay),
        vr: Number(numOrNull(f.vr)) || 0, vt: Number(numOrNull(f.vt)) || 0, notes: f.notes.trim(),
        extras: f.extras.filter((e) => String(e.label || "").trim() && numOrNull(e.amount) != null).map((e) => ({ label: e.label.trim(), amount: Number(numOrNull(e.amount)), kind: e.kind || "acordo" })),
        updatedAt: new Date().toISOString(),
      };
      if (profile?.id) await api.update("payroll_profiles", profile.id, doc); else await api.create("payroll_profiles", doc);
      onDone && onDone();
    } catch (e) { setErr(e.message); }
    setSaving(false);
  };
  return (
    <fieldset disabled={saving} className="finance-payable-form" style={{ flexDirection: "column", alignItems: "stretch", gap: 8, padding: "10px 12px", background: "var(--bg-inset)", borderRadius: "var(--r-3)" }}>
      {err && <div role="alert" className="finance-notice">{err}</div>}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 11 }}><span className="kicker">Regime</span>
          <select aria-label="Regime" value={f.regime} onChange={(e) => set("regime", e.target.value)} style={{ ...inp, width: 120 }}><option value="">do plano (CLT)</option><option value="clt">CLT</option><option value="pj">PJ</option></select></label>
        <label style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 11 }}><span className="kicker">Fixo da pessoa (R$)</span>
          <input aria-label="Fixo da pessoa" type="number" min="0" step="0.01" placeholder="vazio = fixo do plano" value={f.fixed} onChange={(e) => set("fixed", e.target.value)} style={{ ...inp, width: 150, fontFamily: "var(--mono)", textAlign: "right" }} /></label>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, height: 36 }} title="VR e VT por dia útil (segunda a sexta do mês). Padrão da casa: R$ 30 e R$ 12.">
          <input type="checkbox" checked={!!f.benefits} onChange={(e) => set("benefits", e.target.checked)} /> VR e VT
        </label>
        {f.benefits && (<>
          <label style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 11 }}><span className="kicker">VR / dia útil</span>
            <input aria-label="VR por dia" type="number" min="0" step="0.01" placeholder="30 (padrão)" value={f.vrDay} onChange={(e) => set("vrDay", e.target.value)} style={{ ...inp, width: 120, fontFamily: "var(--mono)", textAlign: "right" }} /></label>
          <label style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 11 }}><span className="kicker">VT / dia útil</span>
            <input aria-label="VT por dia" type="number" min="0" step="0.01" placeholder="12 (padrão)" value={f.vtDay} onChange={(e) => set("vtDay", e.target.value)} style={{ ...inp, width: 120, fontFamily: "var(--mono)", textAlign: "right" }} /></label>
          <label style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 11 }} title="Se preenchido, vale por cima do diário × dias úteis."><span className="kicker">VR mensal fechado</span>
            <input aria-label="VR mensal" type="number" min="0" step="0.01" placeholder="vazio = por dia" value={f.vr} onChange={(e) => set("vr", e.target.value)} style={{ ...inp, width: 130, fontFamily: "var(--mono)", textAlign: "right" }} /></label>
          <label style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 11 }} title="Se preenchido, vale por cima do diário × dias úteis."><span className="kicker">VT mensal fechado</span>
            <input aria-label="VT mensal" type="number" min="0" step="0.01" placeholder="vazio = por dia" value={f.vt} onChange={(e) => set("vt", e.target.value)} style={{ ...inp, width: 130, fontFamily: "var(--mono)", textAlign: "right" }} /></label>
        </>)}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span className="kicker">Acordos recorrentes (todo mês) · benefício e acordo somam, desconto subtrai</span>
        {f.extras.map((e, i) => (
          <div key={i} style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            <input aria-label={`Descrição do acordo ${i + 1}`} placeholder="ex.: ajuda de custo, plano de saúde, adiantamento" value={e.label || ""} onChange={(ev) => setExtra(i, "label", ev.target.value)} style={{ ...inp, flex: 1, minWidth: 180 }} />
            <input aria-label={`Valor do acordo ${i + 1}`} type="number" step="0.01" value={e.amount ?? ""} onChange={(ev) => setExtra(i, "amount", ev.target.value)} style={{ ...inp, width: 110, fontFamily: "var(--mono)", textAlign: "right" }} />
            <select aria-label={`Tipo do acordo ${i + 1}`} value={e.kind || "acordo"} onChange={(ev) => setExtra(i, "kind", ev.target.value)} style={{ ...inp, width: 120 }}>{Object.entries(KIND_EXTRA).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
            <button onClick={() => set("extras", f.extras.filter((_, j) => j !== i))} className="dim" style={{ fontSize: 12 }}>remover</button>
          </div>
        ))}
        <button onClick={() => set("extras", [...f.extras, { label: "", amount: "", kind: "acordo" }])} style={{ ...btn, height: 28, alignSelf: "flex-start" }}>+ acordo recorrente</button>
      </div>
      <input aria-label="Notas da ficha" placeholder="notas (o combinado, desde quando, quem autorizou)" value={f.notes} onChange={(e) => set("notes", e.target.value)} style={{ ...inp }} />
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={salvar} style={btnPri}>{saving ? "salvando…" : "salvar ficha"}</button>
        <button onClick={onCancel} className="dim" style={{ fontSize: 12.5, fontWeight: 600 }}>cancelar</button>
      </div>
    </fieldset>
  );
}

function AjusteForm({ product, uid, month, onDone }) {
  const [f, setF] = useState({ label: "", amount: "", kind: "acordo" });
  const [saving, setSaving] = useState(false), [err, setErr] = useState(null);
  const ok = f.label.trim() && Number.isFinite(Number(String(f.amount).replace(",", "."))) && Number(String(f.amount).replace(",", ".")) !== 0;
  const salvar = async () => {
    if (!ok || saving) return;
    setSaving(true); setErr(null);
    try {
      const v = Number(String(f.amount).replace(",", "."));
      await api.create("payroll_adjustments", { saas: product.id, month, uid, label: f.label.trim(), amount: f.kind === "desconto" ? -Math.abs(v) : Math.abs(v), kind: f.kind, createdAt: new Date().toISOString() });
      setF({ label: "", amount: "", kind: "acordo" });
      onDone && onDone();
    } catch (e) { setErr(e.message); }
    setSaving(false);
  };
  return (
    <fieldset disabled={saving} className="finance-payable-form">
      {err && <div role="alert" className="finance-notice">{err}</div>}
      <input aria-label="Descrição do ajuste" placeholder={`ajuste só em ${mesCurto(month)} (bônus, hora extra, desconto…)`} value={f.label} onChange={(e) => setF((s) => ({ ...s, label: e.target.value }))} style={{ ...inp, flex: 1, minWidth: 200 }} />
      <input aria-label="Valor do ajuste" type="number" min="0" step="0.01" placeholder="valor" value={f.amount} onChange={(e) => setF((s) => ({ ...s, amount: e.target.value }))} style={{ ...inp, width: 110, fontFamily: "var(--mono)", textAlign: "right" }} />
      <select aria-label="Tipo do ajuste" value={f.kind} onChange={(e) => setF((s) => ({ ...s, kind: e.target.value }))} style={{ ...inp, width: 120 }}>{Object.entries(KIND_EXTRA).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
      <button onClick={salvar} disabled={!ok} style={{ ...btnPri, height: 28, opacity: ok ? 1 : .55 }}>lançar no mês</button>
    </fieldset>
  );
}

export function FolhaTab({ product, month }) {
  const { fin, err, reload } = useFin(product, month);
  const { version } = useData();
  const [calc, setCalc] = useState(null), [calcErr, setCalcErr] = useState(null);
  const [profiles, setProfiles] = useState([]), [adjs, setAdjs] = useState([]), [allPay, setAllPay] = useState([]);
  const [fichaFor, setFichaFor] = useState(null), [ajusteFor, setAjusteFor] = useState(null), [formFor, setFormFor] = useState(null), [histFor, setHistFor] = useState(null);
  const [gerando, setGerando] = useState(false), [note, setNote] = useState(null);
  const read = React.useRef(0);
  const loadAll = useCallback(async () => {
    const seq = ++read.current; setCalcErr(null);
    try {
      const [c, p, a, all] = await Promise.all([api.payrollPreview(product.id, month), api.list("payroll_profiles"), api.list("payroll_adjustments"), api.list("payables")]);
      if (seq === read.current) { setCalc(c); setProfiles(p || []); setAdjs((a || []).filter((x) => x.month === month && (!x.saas || x.saas === product.id))); setAllPay((all || []).filter((x) => x.saas === product.id && x.counterpartyType === "colaborador")); }
    } catch (e) { if (seq === read.current) setCalcErr(e.message); }
  }, [product.id, month]);
  useEffect(() => { loadAll(); return () => { read.current++; }; }, [loadAll, version]);
  const refreshAll = async () => { await reload(); await loadAll(); };
  const gerar = async () => {
    if (gerando) return;
    setGerando(true); setNote(null);
    try {
      const r = await api.payrollGenerate(product.id, month);
      setNote({ ok: true, text: `folha de ${mesCurto(month)}: ${int(r.created)} criada${r.created === 1 ? "" : "s"} · ${int(r.updated)} atualizada${r.updated === 1 ? "" : "s"} · ${int(r.kept)} já paga${r.kept === 1 ? "" : "s"} · total ${money(r.total)}${r.stamped ? "" : " · mês ainda não fechado na Remuneração: a variável entra no fechamento, gere de novo depois"}` });
      await refreshAll();
    } catch (e) { setNote({ ok: false, text: e.message }); }
    finally { setGerando(false); }
  };
  if (!fin || err) return <Carregando err={err} retry={reload} />;
  if (calcErr) return <Carregando err={calcErr} retry={loadAll} />;
  if (!calc) return <Carregando />;

  const doMes = fin.payables.filter((p) => p.counterpartyType === "colaborador" && p.month === month);
  const soma = (list, f = () => true) => r2(list.filter(f).reduce((a, p) => a + (Number(p.amount) || 0), 0));
  const totalPago = soma(doMes, (p) => p.status === "paga");
  const totalAberto = soma(doMes, (p) => p.status !== "paga");
  const time = allUsers();
  const rows = calc.rows || [];
  const profileOf = (uid) => profiles.find((p) => p.id === uid || p.uid === uid) || null;
  const payablesOf = (uid) => doMes.filter((p) => p.userId === uid);
  const semVinculo = doMes.filter((p) => !p.userId || !rows.some((r) => r.uid === p.userId));
  // Histórico de pagamentos da pessoa (todos os meses), do mais novo pro mais velho.
  const historicoDe = (uid) => allPay.filter((p) => p.userId === uid).sort((a, b) => String(b.month).localeCompare(String(a.month)) || String(b.dueDate || "").localeCompare(String(a.dueDate || "")));
  const ano = month.slice(0, 4);
  const excluirAjuste = async (a) => { if (!window.confirm(`Remover o ajuste "${a.label}" (${money(Math.abs(a.amount))})?`)) return; try { await api.remove("payroll_adjustments", a.id); await refreshAll(); } catch (e) { setNote({ ok: false, text: e.message }); } };

  return (
    <div className="finance-content">
      {note && <div role={note.ok ? "status" : "alert"} className="finance-notice" style={{ fontSize: 12, color: note.ok ? "var(--pos)" : "var(--neg)" }}>{note.text}</div>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 190px), 1fr))", gap: 12 }}>
        <StatTile label={`Folha de ${mesCurto(month)} · calculada`} value={money(calc.total)} delta={`${int(rows.length)} pessoa${rows.length === 1 ? "" : "s"} no plano${calc.stamped ? "" : " · mês ainda não fechado"}`}
          title="O que a Remuneração calcula pra este mês: fixo + variável + bônus de time + VR/VT + acordos ± ajustes." />
        <StatTile label="Gerada em A pagar" value={money(totalPago + totalAberto)} delta={`${int(doMes.length)} conta${doMes.length === 1 ? "" : "s"} · vence dia 1 do mês seguinte`} />
        <StatTile label="Pago" value={money(totalPago)} />
        <StatTile label="Em aberto" value={money(totalAberto)} tone={totalAberto > 0 ? "down" : "flat"} />
      </div>

      <Card title="Por colaborador" hint="fixo do nível ou da pessoa + variável pelo atingimento + bônus de time + VR/VT + acordos ± ajustes do mês · a saída do MP com o mesmo valor dá baixa sozinha"
        action={<button onClick={gerar} disabled={gerando} style={btnPri}>{gerando ? "gerando…" : (doMes.length ? `atualizar folha de ${mesCurto(month)}` : `gerar folha de ${mesCurto(month)}`)}</button>}>
        <div style={{ padding: "6px var(--inset-x) 18px", display: "flex", flexDirection: "column", gap: 4 }}>
          {!rows.length && <span className="dim" style={{ fontSize: 12.5, padding: "10px 0" }}>Ninguém cadastrado na folha deste produto. O papel na folha (SDR, closer, CS, mídia social, sócio) é definido no usuário.</span>}
          {rows.map((r) => {
            const u = time.find((x) => x.id === r.uid) || { id: r.uid, name: r.name };
            const prof = profileOf(r.uid);
            const contas = payablesOf(r.uid);
            const ajustes = adjs.filter((a) => a.uid === r.uid);
            return (
              <div key={r.uid} style={{ padding: "12px 0", borderBottom: "1px solid var(--line-faint)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <Avatar id={u.id} name={u.name} size={26} />
                  <span style={{ fontSize: 13.5, fontWeight: 650, minWidth: 120 }}>{u.name}</span>
                  <span className="dim" style={{ fontSize: 11.5 }}>{ROLE_LABEL[r.role] || r.role}{r.role === "sdr" || r.role === "closer" || r.role === "cs" ? ` · nível ${r.level}` : ""}{r.role === "closer" ? ` · ${r.regime.toUpperCase()}` : ""}{r.role === "manual" && r.fixedFrom === "sem retirada definida" ? " · sem retirada definida" : ""}</span>
                  <span className="tnum" style={{ marginLeft: "auto", fontSize: 14, fontWeight: 700 }}>{money(r.total)}</span>
                  <button onClick={() => setFichaFor(fichaFor === r.uid ? null : r.uid)} style={{ ...btn, height: 28 }}>{fichaFor === r.uid ? "fechar ficha" : "ficha"}</button>
                  <button onClick={() => setAjusteFor(ajusteFor === r.uid ? null : r.uid)} style={{ ...btn, height: 28 }}>{ajusteFor === r.uid ? "fechar" : "+ ajuste do mês"}</button>
                  {r.role === "manual" && <button onClick={() => setFormFor(formFor === r.uid ? null : r.uid)} style={{ ...btn, height: 28 }}>{formFor === r.uid ? "fechar" : "+ pagamento"}</button>}
                  <button onClick={() => setHistFor(histFor === r.uid ? null : r.uid)} className="dim" style={{ fontSize: 12, fontWeight: 600 }} title="todos os pagamentos dessa pessoa, mês a mês">{histFor === r.uid ? "fechar histórico" : `histórico (${int(historicoDe(r.uid).length)})`}</button>
                </div>
                <div className="tnum dim" style={{ display: "flex", gap: 12, flexWrap: "wrap", fontSize: 11.5, marginTop: 6 }} title={r.notes}>
                  <span>fixo <b style={{ color: "var(--fg-1)" }}>{money(r.fixed)}</b> <span style={{ color: "var(--fg-4)" }}>({r.fixedFrom})</span></span>
                  <span>variável <b style={{ color: "var(--fg-1)" }}>{money(r.variable)}</b>{!r.stamped && <span style={{ color: "var(--warn)" }}> · entra no fechamento</span>}</span>
                  <span>time <b style={{ color: "var(--fg-1)" }}>{money(r.teamBonus)}</b></span>
                  <span title={r.benefitsOn ? `${r.vrDay}/dia × ${r.businessDays} dias úteis` : "sem VR na ficha"}>VR <b style={{ color: "var(--fg-1)" }}>{money(r.vr)}</b></span>
                  <span title={r.benefitsOn ? `${r.vtDay}/dia × ${r.businessDays} dias úteis` : "sem VT na ficha"}>VT <b style={{ color: "var(--fg-1)" }}>{money(r.vt)}</b></span>
                  {r.extras?.length > 0 && <span>acordos <b style={{ color: r.extrasTotal < 0 ? "var(--neg)" : "var(--fg-1)" }}>{sign(r.extrasTotal)}</b></span>}
                  {ajustes.length > 0 && <span>ajustes do mês <b style={{ color: r.adjustmentsTotal < 0 ? "var(--neg)" : "var(--fg-1)" }}>{sign(r.adjustmentsTotal)}</b></span>}
                </div>
                {(r.extras?.length > 0 || prof?.notes) && (
                  <div className="dim" style={{ fontSize: 11.5, marginTop: 4 }}>
                    {r.extras.map((e, i) => <span key={i} style={{ marginRight: 10 }}>{e.label} {sign(e.signed)} <span style={{ color: "var(--fg-4)" }}>({KIND_EXTRA[e.kind] || e.kind})</span></span>)}
                    {prof?.notes && <span style={{ color: "var(--fg-4)" }}>· {prof.notes}</span>}
                  </div>
                )}
                {ajustes.length > 0 && (
                  <div style={{ marginTop: 4, display: "flex", flexDirection: "column", gap: 2 }}>
                    {ajustes.map((a) => (
                      <div key={a.id} className="dim" style={{ fontSize: 11.5, display: "flex", gap: 8, alignItems: "baseline" }}>
                        <span>{a.label} <b style={{ color: a.amount < 0 ? "var(--neg)" : "var(--fg-1)" }}>{sign(a.amount)}</b> <span style={{ color: "var(--fg-4)" }}>({KIND_EXTRA[a.kind] || a.kind} só em {mesCurto(month)})</span></span>
                        <button onClick={() => excluirAjuste(a)} className="dim" style={{ fontSize: 11, fontWeight: 600 }}>remover</button>
                      </div>
                    ))}
                  </div>
                )}
                {fichaFor === r.uid && <div style={{ marginTop: 10 }}><FichaForm product={product} uid={r.uid} profile={prof} onDone={async () => { setFichaFor(null); await refreshAll(); }} onCancel={() => setFichaFor(null)} /></div>}
                {ajusteFor === r.uid && <div style={{ marginTop: 10 }}><AjusteForm product={product} uid={r.uid} month={month} onDone={refreshAll} /></div>}
                {formFor === r.uid && (
                  <div style={{ marginTop: 10 }}>
                    <PayableForm product={product} month={month} onDone={() => { setFormFor(null); refreshAll(); }}
                      preset={{ counterpartyType: "colaborador", userId: r.uid, category: "prolabore", description: "Retirada" }} />
                  </div>
                )}
                {histFor === r.uid && (() => {
                  const hist = historicoDe(r.uid);
                  const pagoAno = soma(hist, (p) => p.status === "paga" && String(p.month).startsWith(ano));
                  const abertoTot = soma(hist, (p) => p.status !== "paga");
                  return (
                    <div style={{ marginTop: 10, padding: "10px 12px", background: "var(--bg-inset)", borderRadius: "var(--r-3)" }}>
                      <div className="kicker" style={{ marginBottom: 6 }}>histórico de pagamentos · pago em {ano} {money(pagoAno)}{abertoTot > 0 ? ` · em aberto ${money(abertoTot)}` : ""}</div>
                      {!hist.length && <span className="dim" style={{ fontSize: 12 }}>nenhum pagamento registrado ainda</span>}
                      {hist.map((p) => (
                        <div key={p.id} style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap", padding: "5px 0", borderBottom: "1px solid var(--line-faint)", fontSize: 12.5 }} title={p.notes || ""}>
                          <span className="tnum" style={{ width: 56, textTransform: "capitalize" }}>{mesCurto(p.month)}/{String(p.month).slice(2, 4)}</span>
                          <span style={{ flex: 1, minWidth: 140 }}>{p.description}<span className="dim"> · {catLabel(p.category)}{p.source === "payroll" ? " · folha" : ""}{p.amountManual ? " · revisado" : ""}</span></span>
                          <span className="tnum" style={{ fontWeight: 650 }}>{money(p.amount)}</span>
                          {p.status === "paga"
                            ? <Pill tone="pos">pago {dmyFull(String(p.paidAt || "").slice(0, 10))}{p.paidVia === "mp" ? " · MP" : ""}</Pill>
                            : p.dueDate && p.dueDate < fin.today ? <Pill tone="neg">vencida {dmyFull(p.dueDate)}</Pill> : <Pill>vence {dmyFull(p.dueDate)}</Pill>}
                        </div>
                      ))}
                    </div>
                  );
                })()}
                {contas.length > 0 && (
                  <div style={{ marginTop: 6 }}>
                    {contas.map((p) => <PayableRow key={p.id} p={p} fin={fin} reload={refreshAll} showPerson={false} />)}
                  </div>
                )}
                {!contas.length && <div className="dim" style={{ fontSize: 11.5, marginTop: 6 }}>conta ainda não gerada neste mês</div>}
              </div>
            );
          })}
        </div>
      </Card>

      {semVinculo.length > 0 && (
        <Card title="Contas de colaborador sem vínculo com a folha" hint="lançadas à mão pra alguém que não está na folha deste produto">
          <div style={{ padding: "6px var(--inset-x) 18px", display: "flex", flexDirection: "column" }}>
            {semVinculo.map((p) => <PayableRow key={p.id} p={p} fin={fin} reload={refreshAll} />)}
          </div>
        </Card>
      )}
      <InfoNota>
        Papel na folha e nível ficam no usuário (Ajustes → Equipe; promoção em Metas → Meta por pessoa). VR R$ 30 e VT R$ 12 por dia útil são o padrão da casa; a ficha guarda o que foge do plano: regime, fixo da pessoa, VR/VT diferentes e acordos recorrentes. Ajuste do mês vale uma vez. O vencimento é dia 1 do mês seguinte; a saída do Mercado Pago com o mesmo valor, até 5 dias do vencimento, dá baixa sozinha.
      </InfoNota>
    </div>
  );
}

export function PagarTab({ product, month }) {
  const { fin, err, reload } = useFin(product, month);
  if (!fin || err) return <Carregando err={err} retry={reload} />;
  const t = fin.tiles;
  return (
    <div className="finance-content">
      {(
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 180px), 1fr))", gap: 12 }}>
            <StatTile label="Vencidos" value={money(t.vencidos.total)} delta={`${int(t.vencidos.n)} conta${t.vencidos.n === 1 ? "" : "s"}`} tone={t.vencidos.n ? "down" : "flat"} />
            <StatTile label="Vencem hoje" value={money(t.vencemHoje.total)} delta={`${int(t.vencemHoje.n)} conta${t.vencemHoje.n === 1 ? "" : "s"}`} />
            <StatTile label="A vencer no mês" value={money(t.aVencer.total)} delta={`${int(t.aVencer.n)} conta${t.aVencer.n === 1 ? "" : "s"}`} />
            <StatTile label="Pagos no mês" value={money(t.pagos.total)} delta={`${int(t.pagos.n)} conta${t.pagos.n === 1 ? "" : "s"}`} />
          </div>

          <Card title="Nova conta a pagar" hint="a categoria decide o setor no DRE · salário sai da aba Folha (gerado pela Remuneração) · regra, automático e percentual moram na aba Custos">
            <div style={{ padding: "12px var(--inset-x) 18px" }}>
              <PayableForm product={product} month={month} onDone={reload} />
            </div>
          </Card>

          <Card title={`Contas de ${mesLongo(month)}`} hint="vencidas de meses anteriores aparecem aqui até serem pagas">
            <div style={{ padding: "6px var(--inset-x) 18px", display: "flex", flexDirection: "column" }}>
              {!fin.payables.length && <span className="dim" style={{ fontSize: 12.5, padding: "10px 0" }}>Nenhuma conta lançada nesse mês.</span>}
              {fin.payables.map((p) => <PayableRow key={p.id} p={p} fin={fin} reload={reload} />)}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
