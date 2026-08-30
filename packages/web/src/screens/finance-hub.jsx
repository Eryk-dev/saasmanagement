import React from "react";
import { api } from "../lib/api.js";
import { useData } from "../data.jsx";
import { StatTile, Card, Pill } from "../components/viz.jsx";
import { Avatar } from "../atoms.jsx";
import { allUsers } from "../lib/users.js";
import { mpMethodLabel } from "../lib/payments.js";

// Abas novas do Financeiro (modelo Conta Azul + P&L de SaaS por setor):
//   Resumo      — tiles do mês + fluxo de caixa 6 meses + DRE por setor
//                 (deduções → COGS → margem bruta → S&M → R&D → G&A)
//   Conciliação — pendências do espelho MP com SUGESTÃO e APRENDIZADO: vinculou
//                 ou desconsiderou com "lembrar" ligado, vira regra e o mesmo
//                 pagador nunca mais é perguntado. Também importa as SAÍDAS da
//                 conta (settlement report) pra casar com as contas a pagar.
//   A pagar     — contas com vencimento, situação, setor e recorrência
//   Folha       — as mesmas contas na lente POR COLABORADOR
// Receita continua nascendo nas faturas; custo automático/percentual na aba
// Custos (que agora soma as contas a pagar do mês no total, tudo conversa).

const { useState, useEffect, useCallback, useMemo } = React;

const money = (v) => window.fmt.money(v || 0);
const int = (v) => window.fmt.int(v || 0);
const r2 = (n) => Math.round(n * 100) / 100;

// ── Plano de categorias por SETOR (espelha CAT_SECTOR do routes.fin.js) ──────
export const SECTOR_CATS = [
  ["deducoes", "Deduções da receita", [["imposto", "Impostos sobre receita (DAS)"]]],
  ["cogs", "Custo do serviço (COGS)", [
    ["infra", "Infra e hosting"], ["apis", "APIs e IA do produto"],
    ["suporte", "Suporte e CS"], ["taxas", "Taxas de pagamento"],
  ]],
  ["sm", "Vendas & Marketing", [
    ["pessoal_com", "Pessoal · comercial"], ["comissao", "Comissões"],
    ["midia", "Mídia paga (manual)"], ["mkt", "Ferramentas de marketing"],
  ]],
  ["rd", "Produto & Desenvolvimento", [
    ["pessoal_dev", "Pessoal · produto e dev"], ["dev", "Ferramentas de dev"],
  ]],
  ["ga", "Administrativo (G&A)", [
    ["prolabore", "Pró-labore"], ["pessoal_adm", "Pessoal · administrativo"],
    ["contab", "Contabilidade e jurídico"], ["escritorio", "Escritório e estrutura"],
    ["bancos", "Tarifas bancárias"], ["outros", "Outros"],
  ]],
];
const SECTOR_LABEL = { deducoes: "Deduções da receita", cogs: "Custo do serviço", sm: "Vendas & Marketing", rd: "Produto & Desenvolvimento", ga: "Administrativo" };
const PAY_CAT_LABEL = {
  ...Object.fromEntries(SECTOR_CATS.flatMap(([, , cats]) => cats)),
  ads: "Mídia paga (Meta, automático)", ia: "IA (APIs, automático)", wa: "WhatsApp (conversas, automático)",
  pessoal: "Pessoal (legado)", ferramenta: "Ferramentas (legado)", fixo: "Custos fixos (legado)",
  estrutura: "Estrutura (legado)", marketing: "Marketing (legado)",
};
const RECEITA_LABEL = { renewal: "Assinaturas", installment: "Parcelas de contrato", manual: "Cobranças avulsas", upsell: "Upsell", prorata: "Upgrade de plano" };

const mesCurto = (mk) => new Date(`${mk}-15T12:00:00`).toLocaleDateString("pt-BR", { month: "short" }).replace(".", "");
const mesLongo = (mk) => {
  const [y, m] = String(mk).split("-");
  const names = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
  return `${names[Number(m) - 1] || m} de ${y}`;
};
const dmy = (d) => (d ? `${String(d).slice(8, 10)}/${String(d).slice(5, 7)}` : "");

const inp = { height: 36, padding: "0 10px", borderRadius: "var(--r-2)", border: "1px solid var(--line-2)", background: "var(--bg-1)", color: "var(--fg-1)", fontSize: 13 };
const btn = { height: 32, padding: "0 13px", borderRadius: "var(--r-2)", border: "1px solid var(--line-2)", background: "var(--bg-1)", boxShadow: "var(--shadow-1)", color: "var(--fg-2)", fontSize: 12.5, fontWeight: 600 };
const btnPri = { height: 32, padding: "0 14px", borderRadius: "var(--r-2)", background: "var(--btn-bg)", color: "var(--btn-fg)", fontSize: 12.5, fontWeight: 600 };

// A leitura do mês (GET /api/fin) + recarga no SSE.
function useFin(product, month) {
  const { version } = useData();
  const [fin, setFin] = useState(null);
  const [err, setErr] = useState(null);
  const load = useCallback(() => {
    if (!product?.id) return;
    api.fin(product.id, month).then((d) => { setFin(d); setErr(null); }).catch((e) => setErr(e.message));
  }, [product?.id, month]);
  useEffect(() => { load(); }, [load, version]);
  return { fin, err, reload: load };
}

const Carregando = ({ err }) => (
  <div style={{ padding: "16px var(--pad-x)" }}>
    <span className="mono dim" style={{ fontSize: 12, color: err ? "var(--neg)" : undefined }}>{err || "carregando…"}</span>
  </div>
);

// ── Resumo ───────────────────────────────────────────────────────────────────
function FluxoCard({ fluxo, previsto, month }) {
  const max = Math.max(1, ...fluxo.map((f) => Math.max(f.entrada, f.saida)));
  return (
    <Card title="Fluxo de caixa" hint="realizado por mês · entrada = faturas recebidas · saída = contas pagas + custos do mês">
      <div style={{ padding: "12px var(--inset-x) 18px", display: "flex", flexDirection: "column", gap: 10 }}>
        {fluxo.map((f) => {
          const saldo = r2(f.entrada - f.saida);
          return (
            <div key={f.month} style={{ display: "grid", gridTemplateColumns: "56px 1fr 110px", gap: 12, alignItems: "center" }}>
              <span style={{ fontSize: 12, color: f.month === month ? "var(--fg-1)" : "var(--fg-3)", fontWeight: f.month === month ? 650 : 500, textTransform: "capitalize" }}>{mesCurto(f.month)}</span>
              <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
                <div title={`entrou ${money(f.entrada)}`} style={{ height: 8, borderRadius: 999, background: "var(--pos)", opacity: .85, width: `${Math.max(2, (f.entrada / max) * 100)}%` }} />
                <div title={`saiu ${money(f.saida)}`} style={{ height: 8, borderRadius: 999, background: "var(--neg)", opacity: .7, width: `${Math.max(2, (f.saida / max) * 100)}%` }} />
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
      {entries.map(([k, v]) => <DreRow key={k} label={PAY_CAT_LABEL[k] || k} value={v} neg indent />)}
    </>
  );
}

export function ResumoTab({ product, month }) {
  const { fin, err } = useFin(product, month);
  const { version } = useData();
  const [sum, setSum] = useState(null); // IA + WhatsApp (custos externos) vêm do summary existente
  useEffect(() => {
    let alive = true;
    api.expensesSummary(product.id, month).then((s) => alive && setSum(s)).catch(() => alive && setSum(null));
    return () => { alive = false; };
  }, [product.id, month, version]);
  if (!fin) return <Carregando err={err} />;

  const ai = Number(sum?.ai) || 0;
  const wa = Number(sum?.wa) || 0;
  const S = fin.dre.setores;
  // IA e WhatsApp são custo de entregar/atender → dobram no COGS, no cliente.
  const cogs = { ...S.cogs, ...(ai > 0 ? { ia: ai } : {}), ...(wa > 0 ? { wa } : {}) };
  const somaSet = (o) => r2(Object.values(o || {}).reduce((a, v) => a + v, 0));
  const receitaTotal = r2(Object.values(fin.dre.receita).reduce((a, v) => a + v, 0));
  const ded = somaSet(S.deducoes), cogsT = somaSet(cogs), smT = somaSet(S.sm), rdT = somaSet(S.rd), gaT = somaSet(S.ga);
  const liquida = r2(receitaTotal - ded);
  const bruto = r2(liquida - cogsT);
  const margem = liquida > 0 ? Math.round((bruto / liquida) * 1000) / 10 : null;
  const resultado = r2(bruto - smT - rdT - gaT);
  const despesasMes = r2(fin.dre.despesasMes + ai + wa);
  const abertasTotal = fin.tiles.vencidos.total + fin.tiles.vencemHoje.total + fin.tiles.aVencer.total;

  return (
    <div style={{ padding: "16px var(--pad-x) 56px", display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 190px), 1fr))", gap: 12 }}>
        <StatTile label="Recebido no mês" value={money(fin.receber.recebidosMes)} delta={`espelho MP: ${money(fin.conciliacao.espelhoMes)}`}
          title="Faturas baixadas no mês (a mesma régua de caixa do cockpit). Embaixo, o que entrou na conta do Mercado Pago no mês." />
        <StatTile label="A receber" value={money(fin.receber.emAberto.total)}
          delta={fin.receber.vencidas.n ? `${int(fin.receber.vencidas.n)} vencida${fin.receber.vencidas.n > 1 ? "s" : ""} · ${money(fin.receber.vencidas.total)}` : "nada vencido"}
          tone={fin.receber.vencidas.n ? "down" : "flat"}
          title="Faturas em aberto agora (qualquer mês). Cobrança e baixa moram em Clientes → Assinaturas." />
        <StatTile label="Despesas do mês" value={money(despesasMes)} delta="contas do mês + custos automáticos"
          title="Contas a pagar com competência no mês + custos da aba Custos (mídia, IA, WhatsApp, percentuais)." />
        <StatTile label="A pagar em aberto" value={money(abertasTotal)}
          delta={fin.tiles.vencidos.n ? `${int(fin.tiles.vencidos.n)} vencida${fin.tiles.vencidos.n > 1 ? "s" : ""} · ${money(fin.tiles.vencidos.total)}` : "nada vencido"}
          tone={fin.tiles.vencidos.n ? "down" : "flat"} />
        <StatTile label="Margem bruta" value={margem == null ? "—" : `${String(margem).replace(".", ",")}%`}
          delta={`lucro bruto ${money(bruto)}`} tone={margem != null && margem < 70 ? "down" : "flat"}
          title="(Receita líquida − custo do serviço) ÷ receita líquida. SaaS saudável opera entre 70% e 85%; abaixo de 70% é alerta." />
        <StatTile label="Resultado do mês" value={money(resultado)} tone={resultado < 0 ? "down" : "flat"}
          delta="recebido − despesas do mês" title="Regime de caixa na receita (faturas baixadas) e competência nas despesas." />
      </div>

      <div className="resp-cols" style={{ "--cols": "1fr 1fr", gap: 16 }}>
        <FluxoCard fluxo={fin.fluxo} previsto={fin.previsto} month={month} />
        <Card title="DRE do mês" hint="P&L de SaaS: receita · deduções · custo do serviço · margem bruta · setores">
          <div style={{ padding: "10px var(--inset-x) 18px" }}>
            {Object.entries(fin.dre.receita).sort((a, b) => b[1] - a[1]).map(([k, v]) => (
              <DreRow key={k} label={RECEITA_LABEL[k] || k} value={v} indent />
            ))}
            <DreRow label="Receita recebida" value={receitaTotal} strong />
            <DreSetor sector="deducoes" itens={S.deducoes} />
            {ded > 0 && <DreRow label="Receita líquida" value={liquida} strong />}
            <DreSetor sector="cogs" itens={cogs} />
            <DreRow label={`Lucro bruto${margem != null ? ` · margem ${String(margem).replace(".", ",")}%` : ""}`} value={bruto} strong
              title="Benchmark de SaaS: margem bruta saudável entre 70% e 85%." />
            <DreSetor sector="sm" itens={S.sm} />
            <DreSetor sector="rd" itens={S.rd} />
            <DreSetor sector="ga" itens={S.ga} />
            <DreRow label="Resultado do mês" value={resultado} strong />
            {fin.conciliacao.pendentes.n > 0 && (
              <div style={{ marginTop: 10, fontSize: 11.5, color: "var(--warn)" }}>
                {int(fin.conciliacao.pendentes.n)} pagamento{fin.conciliacao.pendentes.n > 1 ? "s" : ""} sem dono na conciliação ({money(fin.conciliacao.pendentes.total)})
              </div>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

// ── Conciliação ──────────────────────────────────────────────────────────────
const IGNORE_REASONS = ["estorno", "transferência interna", "não é do produto", "teste", "outro"];

// Identidade mais forte disponível do pagador → vira a regra de aprendizado.
const bestIdOf = (p) => {
  if (String(p.payerDoc || "").replace(/\D+/g, "")) return ["payerDoc", p.payerDoc, `documento ${p.payerDoc}`];
  if (String(p.payerEmail || "").trim()) return ["payerEmail", p.payerEmail, p.payerEmail];
  if (String(p.payerName || "").trim()) return ["payerName", p.payerName, p.payerName];
  return null;
};

export function ConciliacaoTab({ product, month }) {
  const { fin, err, reload } = useFin(product, month);
  const { version } = useData();
  const { CUSTOMERS } = window.SEED;
  const customers = useMemo(() => (CUSTOMERS || []).filter((c) => c.saas === product?.id), [CUSTOMERS, product?.id]);
  const [payments, setPayments] = useState(null);
  const [rules, setRules] = useState([]);
  const [movs, setMovs] = useState([]);
  const [pick, setPick] = useState({});      // paymentId -> customer escolhido
  const [motivo, setMotivo] = useState({});  // paymentId -> motivo de desconsiderar
  const [lembrar, setLembrar] = useState({}); // paymentId -> lembrar do pagador (default sim)
  const [movPick, setMovPick] = useState({}); // movementId -> payable escolhida
  const [note, setNote] = useState(null);
  const [showIgnoradas, setShowIgnoradas] = useState(false);

  const loadAll = useCallback(() => {
    api.mpPayments({ saas: product.id }).then((r) => setPayments(Array.isArray(r) ? r : r.payments || [])).catch(() => setPayments([]));
    api.list("fin_rules").then((r) => setRules(r.filter((x) => !x.saas || x.saas === product.id))).catch(() => setRules([]));
    api.list("mp_movements").then(setMovs).catch(() => setMovs([]));
  }, [product.id]);
  useEffect(() => { loadAll(); }, [loadAll, version]);

  if (!fin || payments == null) return <Carregando err={err} />;

  const aprovados = payments.filter((p) => p.status === "approved");
  const pendentes = aprovados.filter((p) => !p.customer && !p.finIgnored)
    .sort((a, b) => String(b.dateApproved || b.dateCreated).localeCompare(String(a.dateApproved || a.dateCreated)));
  const ignoradas = aprovados.filter((p) => p.finIgnored);
  const delta = r2(fin.conciliacao.espelhoMes - fin.receber.recebidosMes);
  const querLembrar = (p) => lembrar[p.id] !== false && !!bestIdOf(p);

  // Aprendizado: a ação manual vira regra quando "lembrar" está ligado — o
  // /api/fin aplica sozinho nas próximas e o pagador não é perguntado de novo.
  const criarRegra = async (p, action, extra) => {
    const best = bestIdOf(p);
    if (!best) return;
    await api.create("fin_rules", {
      saas: product.id, matchField: best[0], matchValue: best[1],
      action, ...extra, createdAt: new Date().toISOString(),
    }).catch(() => {});
  };
  const vincular = async (p, customerId) => {
    const cust = customerId || pick[p.id];
    if (!cust) return;
    try {
      await api.mpLinkPayment(p.id, cust);
      if (querLembrar(p)) await criarRegra(p, "vincular", { customer: cust });
      setNote({ ok: true, text: querLembrar(p) ? "vinculado · regra criada: esse pagador não pergunta mais" : "vinculado" });
      reload(); loadAll();
    } catch (e) { setNote({ ok: false, text: e.message }); }
  };
  const desconsiderar = async (p) => {
    try {
      await api.update("mp_payments", p.id, { finIgnored: true, finIgnoredReason: motivo[p.id] || "outro" });
      if (querLembrar(p)) await criarRegra(p, "desconsiderar", { reason: motivo[p.id] || "outro" });
      reload(); loadAll();
    } catch (e) { setNote({ ok: false, text: e.message }); }
  };
  const reconsiderar = async (p) => {
    try { await api.update("mp_payments", p.id, { finIgnored: false, finIgnoredReason: "" }); reload(); loadAll(); } catch (e) { setNote({ ok: false, text: e.message }); }
  };
  const excluirRegra = async (r) => {
    try { await api.remove("fin_rules", r.id); loadAll(); } catch (e) { setNote({ ok: false, text: e.message }); }
  };

  // Sincronizar TUDO: entradas (espelho de pagamentos) e saídas (settlement
  // report, assíncrono do lado do MP) num botão só — a fila é uma, o sync
  // também (Leo, 30/08).
  const syncTudo = async () => {
    setNote({ ok: true, text: "sincronizando entradas e saídas…" });
    try {
      const rIn = await api.mpSyncNow().catch((e) => ({ error: e.message }));
      const inTxt = rIn?.error ? `entradas: ${rIn.error}` : `entradas: ${int(rIn?.seen || 0)} lidas, ${int(rIn?.settled || 0)} baixadas`;
      const r = await api.finMpOutSync(product.id);
      // O pedido do relatório pode falhar do lado do MP — o servidor manda o
      // motivo e ele TEM que aparecer, senão o botão parece morto.
      if (r.requestError) {
        setNote({ ok: false, text: `${inTxt} · saídas: ${r.imported} importadas · o MP recusou gerar relatório novo: ${r.requestError}` });
      } else {
        const extra = r.requested ? " · relatório novo pedido ao MP, sincronize de novo em alguns minutos" : "";
        setNote({ ok: true, text: `${inTxt} · saídas: ${r.imported} importadas de ${r.filesRead} relatórios (${r.filesTotal ?? r.filesRead} na conta)${extra}` });
      }
      reload(); loadAll();
    } catch (e) { setNote({ ok: false, text: e.message }); }
  };
  const movsPend = movs.filter((m) => !m.payableId && !m.finIgnored).sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const vincularMov = async (m, pid) => {
    if (!pid) return;
    const pay = fin.payables.find((x) => x.id === pid);
    try {
      await api.update("mp_movements", m.id, { payableId: pid });
      if (pay && pay.status !== "paga") await api.update("payables", pid, { status: "paga", paidAt: `${m.date}T12:00:00.000Z`, paidVia: "mp" });
      setNote({ ok: true, text: pay && pay.status !== "paga" ? "saída casada e conta baixada" : "saída casada com a conta" });
      reload(); loadAll();
    } catch (e) { setNote({ ok: false, text: e.message }); }
  };
  const ignorarMov = async (m) => {
    try { await api.update("mp_movements", m.id, { finIgnored: true }); loadAll(); } catch (e) { setNote({ ok: false, text: e.message }); }
  };

  const movSugestao = (m) => fin.payables.find((p) => Math.abs((Number(p.amount) || 0) - (Number(m.amount) || 0)) <= 0.01);

  // A FILA é uma só (Leo, 30/08): entrada e saída misturadas, por data — o
  // trabalho de conciliar é um, não dois cards pra varrer.
  const fila = [
    ...pendentes.map((x) => ({ kind: "entrada", at: String(x.dateApproved || x.dateCreated || "").slice(0, 10), row: x })),
    ...movsPend.map((x) => ({ kind: "saida", at: String(x.date || ""), row: x })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  return (
    <div style={{ padding: "16px var(--pad-x) 56px", display: "flex", flexDirection: "column", gap: 16 }}>
      {note && <div className="mono" style={{ fontSize: 12, color: note.ok ? "var(--pos)" : "var(--neg)" }}>{note.text}</div>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 190px), 1fr))", gap: 12 }}>
        <StatTile label="Pendentes" value={int(pendentes.length)} delta={money(fin.conciliacao.pendentes.total)}
          tone={pendentes.length ? "down" : "flat"} title="Pagamentos aprovados sem cliente vinculado e não desconsiderados." />
        <StatTile label="Regras aprendidas" value={int(rules.length)}
          delta={fin.conciliacao.autoAplicadas ? `${int(fin.conciliacao.autoAplicadas)} aplicadas agora` : "aplicam sozinhas a cada leitura"}
          title="Cada vínculo/desconsideração com o lembrar ligado vira regra: o mesmo pagador nunca mais é perguntado." />
        <StatTile label={`Espelho MP em ${mesCurto(month)}`} value={money(fin.conciliacao.espelhoMes)}
          delta={delta === 0 ? "bateu com as faturas" : `${delta > 0 ? "+" : "−"} ${money(Math.abs(delta))} vs faturas baixadas`}
          title="Diferença normal: pagamento sem fatura (link direto no lead), fatura baixada à mão ou pendência ao lado." />
        <StatTile label="Saídas sem dono" value={int(fin.conciliacao.saidasPendentes.n)} delta={money(fin.conciliacao.saidasPendentes.total)}
          tone={fin.conciliacao.saidasPendentes.n ? "down" : "flat"}
          title="Saques e transferências da conta MP (settlement report) ainda não casados com uma conta a pagar." />
      </div>

      <Card title="Conciliação Mercado Pago" hint="entradas e saídas numa fila só, por data · vincule ao cliente, case com a conta a pagar ou desconsidere"
        action={<button onClick={syncTudo} style={btn}>↻ sincronizar</button>}>
        <div style={{ padding: "10px var(--inset-x) 18px", display: "flex", flexDirection: "column", gap: 10 }}>
          {!fila.length && (
            <span className="dim" style={{ fontSize: 12.5 }}>
              Tudo conciliado. As entradas chegam sozinhas pelo sync automático; as saídas dependem do
              relatório do MP (assíncrono): sincronize, aguarde alguns minutos e sincronize de novo.
            </span>
          )}
          {fila.map(({ kind, row }) => kind === "entrada" ? (() => {
            const p = row;
            const sug = fin.conciliacao.sugestoes?.[p.id];
            const best = bestIdOf(p);
            return (
              <div key={p.id} style={{ padding: "10px 12px", background: "var(--bg-inset)", border: "1px solid var(--line-1)", borderRadius: "var(--r-3)", display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
                  <Pill tone="pos">entrada</Pill>
                  <span className="tnum dim" style={{ fontSize: 12, width: 42 }}>{dmy((p.dateApproved || p.dateCreated || "").slice(0, 10))}</span>
                  <span style={{ flex: 1, minWidth: 160, fontSize: 13, fontWeight: 600 }}>
                    {p.payerName || p.payerEmail || "pagador sem nome"}
                    <span className="dim" style={{ display: "block", fontSize: 11, fontWeight: 400 }}>
                      {[p.payerDoc, p.payerEmail, p.payerBank && `via ${p.payerBank}`].filter(Boolean).join(" · ") || "sem identificação"}
                    </span>
                  </span>
                  <span className="tnum" style={{ fontWeight: 650, whiteSpace: "nowrap" }}>{money(p.amount)}</span>
                  <span className="dim tnum" style={{ fontSize: 11.5, whiteSpace: "nowrap" }}>
                    {[mpMethodLabel(p) || p.method, p.netAmount ? `líq. ${money(p.netAmount)}` : null].filter(Boolean).join(" · ")}
                  </span>
                </div>
                {sug && (
                  <button onClick={() => vincular(p, sug.customer)}
                    style={{ alignSelf: "flex-start", padding: "4px 10px", borderRadius: 999, border: "1px solid color-mix(in srgb, var(--accent) 35%, transparent)", background: "var(--accent-soft)", color: "var(--accent)", fontSize: 12, fontWeight: 600 }}>
                    usar sugestão: {sug.motivo} →
                  </button>
                )}
                <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                  <select value={pick[p.id] || ""} onChange={(e) => setPick((s) => ({ ...s, [p.id]: e.target.value }))} style={{ ...inp, minWidth: 150 }}>
                    <option value="">vincular cliente…</option>
                    {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                  <button onClick={() => vincular(p)} disabled={!pick[p.id]} style={{ ...btnPri, opacity: pick[p.id] ? 1 : .55 }}>ok</button>
                  <select value={motivo[p.id] || ""} onChange={(e) => setMotivo((s) => ({ ...s, [p.id]: e.target.value }))} style={{ ...inp, width: 150 }}>
                    <option value="">desconsiderar…</option>
                    {IGNORE_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                  <button onClick={() => desconsiderar(p)} disabled={!motivo[p.id]} style={{ ...btn, opacity: motivo[p.id] ? 1 : .55 }}>ok</button>
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
            return (
              <div key={m.id} style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", padding: "9px 12px", background: "var(--bg-inset)", border: "1px solid var(--line-1)", borderRadius: "var(--r-3)" }}>
                <Pill tone="neg">saída</Pill>
                <span className="tnum dim" style={{ fontSize: 12, width: 42 }}>{dmy(m.date)}</span>
                <span style={{ flex: 1, minWidth: 140, fontSize: 12.5 }}>
                  {m.type === "PAYOUT" ? "Transferência enviada" : "Saque pra conta bancária"}
                  {m.fee > 0 && <span className="dim" style={{ fontSize: 11 }}> · tarifa {money(m.fee)}</span>}
                </span>
                <span className="tnum" style={{ fontWeight: 650, whiteSpace: "nowrap" }}>{money(m.amount)}</span>
                <select value={movPick[m.id] || (sug ? sug.id : "")} onChange={(e) => setMovPick((s) => ({ ...s, [m.id]: e.target.value }))} style={{ ...inp, minWidth: 180 }}>
                  <option value="">casar com conta a pagar…</option>
                  {fin.payables.map((x) => <option key={x.id} value={x.id}>{x.description} · {money(x.amount)}{x.status === "paga" ? " (paga)" : ""}</option>)}
                </select>
                <button onClick={() => vincularMov(m, movPick[m.id] || sug?.id)}
                  disabled={!(movPick[m.id] || sug)} style={{ ...btnPri, opacity: movPick[m.id] || sug ? 1 : .55 }}>
                  {sug && !movPick[m.id] ? "casar (mesmo valor)" : "casar"}
                </button>
                <button onClick={() => ignorarMov(m)} className="dim" style={{ fontSize: 12, fontWeight: 600 }}>desconsiderar</button>
              </div>
            );
          })())}
        </div>
      </Card>

      {rules.length > 0 && (
        <Card title="Regras de conciliação" hint="aplicadas sozinhas a cada leitura · excluir volta a perguntar">
          <div style={{ padding: "6px var(--inset-x) 16px", display: "flex", flexDirection: "column" }}>
            {rules.map((r) => (
              <div key={r.id} style={{ display: "flex", gap: 10, alignItems: "baseline", padding: "7px 0", borderBottom: "1px solid var(--line-faint)", fontSize: 12.5, flexWrap: "wrap" }}>
                <span style={{ flex: 1, minWidth: 200 }}>
                  <b>{r.matchValue}</b>
                  <span className="dim"> ({r.matchField === "payerDoc" ? "documento" : r.matchField === "payerEmail" ? "e-mail" : "nome"}) → {r.action === "vincular" ? `cliente ${customers.find((c) => c.id === r.customer)?.name || r.customer}` : `desconsiderar (${r.reason || "outro"})`}</span>
                </span>
                <span className="dim tnum" style={{ fontSize: 11.5 }}>{int(r.autoCount || 0)} aplicações</span>
                <button onClick={() => excluirRegra(r)} className="dim" style={{ fontSize: 12, fontWeight: 600 }}>excluir</button>
              </div>
            ))}
          </div>
        </Card>
      )}

      {ignoradas.length > 0 && (
        <Card title="Desconsideradas" hint="fora da conciliação e dos números, com motivo"
          action={<button onClick={() => setShowIgnoradas((v) => !v)} style={{ fontSize: 12.5, fontWeight: 600, color: "var(--accent)" }}>{showIgnoradas ? "esconder" : `mostrar ${ignoradas.length}`}</button>}>
          {showIgnoradas && (
            <div style={{ padding: "6px var(--inset-x) 16px", display: "flex", flexDirection: "column" }}>
              {ignoradas.map((p) => (
                <div key={p.id} style={{ display: "flex", gap: 10, alignItems: "baseline", padding: "7px 0", borderBottom: "1px solid var(--line-faint)", fontSize: 12.5 }}>
                  <span className="tnum dim" style={{ width: 42 }}>{dmy((p.dateApproved || p.dateCreated || "").slice(0, 10))}</span>
                  <span style={{ flex: 1, minWidth: 0 }}>{p.payerName || p.payerEmail || "sem nome"} <span className="dim">· {p.finIgnoredReason}</span></span>
                  <span className="tnum" style={{ fontWeight: 600 }}>{money(p.amount)}</span>
                  <button onClick={() => reconsiderar(p)} style={{ color: "var(--accent)", fontSize: 12, fontWeight: 600 }}>reconsiderar</button>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

// ── A pagar ──────────────────────────────────────────────────────────────────
const FORM_ZERO = { description: "", amount: "", dueDate: "", category: "outros", counterpartyType: "fornecedor", userId: "", supplierName: "", recurring: false, endMonth: "" };

function PayableForm({ product, month, preset, onDone }) {
  const [f, setF] = useState({ ...FORM_ZERO, dueDate: `${month}-05`, ...(preset || {}) });
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const ok = f.description.trim() && Number(f.amount) > 0 && /^\d{4}-\d{2}-\d{2}$/.test(f.dueDate);
  const salvar = async () => {
    if (!ok || saving) return;
    setSaving(true);
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
      setF({ ...FORM_ZERO, dueDate: `${month}-05`, ...(preset || {}) });
      onDone && onDone();
    } catch (e) { alert(e.message); }
    setSaving(false);
  };
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <input placeholder="descrição (ex.: Salário, Contabilidade)" value={f.description} onChange={(e) => set("description", e.target.value)} style={{ ...inp, flex: 2, minWidth: 180 }} />
      <select value={f.category} onChange={(e) => set("category", e.target.value)} style={{ ...inp, minWidth: 190 }} title="A categoria decide o setor no DRE (COGS, Vendas & Marketing, Produto, Administrativo).">
        {SECTOR_CATS.map(([sk, sl, cats]) => (
          <optgroup key={sk} label={sl}>
            {cats.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </optgroup>
        ))}
      </select>
      {!preset?.counterpartyType && (
        <select value={f.counterpartyType} onChange={(e) => set("counterpartyType", e.target.value)} style={{ ...inp, width: 120 }}>
          <option value="fornecedor">fornecedor</option>
          <option value="colaborador">colaborador</option>
        </select>
      )}
      {f.counterpartyType === "colaborador" && !preset?.userId && (
        <select value={f.userId} onChange={(e) => set("userId", e.target.value)} style={{ ...inp, minWidth: 130 }}>
          <option value="">quem…</option>
          {allUsers().map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
      )}
      {f.counterpartyType === "fornecedor" && (
        <input placeholder="fornecedor" value={f.supplierName} onChange={(e) => set("supplierName", e.target.value)} style={{ ...inp, width: 140 }} />
      )}
      <div style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
        <span className="mono dim" style={{ fontSize: 12 }}>R$</span>
        <input type="number" min="0" step="0.01" inputMode="decimal" value={f.amount} onChange={(e) => set("amount", e.target.value)} placeholder="0,00" className="tnum" style={{ ...inp, width: 96, textAlign: "right" }} />
      </div>
      <input type="date" value={f.dueDate} onChange={(e) => set("dueDate", e.target.value)} title="vencimento" style={{ ...inp, width: 140 }} />
      <label title="Todo mês, no mesmo dia, até você encerrar (ou até o mês limite)." style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12.5, color: "var(--fg-2)", cursor: "pointer" }}>
        <input type="checkbox" checked={f.recurring} onChange={(e) => set("recurring", e.target.checked)} /> repete todo mês
      </label>
      {f.recurring && <input type="month" value={f.endMonth} onChange={(e) => set("endMonth", e.target.value)} title="até (opcional)" style={{ ...inp, width: 140 }} />}
      <button onClick={salvar} disabled={!ok || saving} style={{ ...btnPri, opacity: ok && !saving ? 1 : .55 }}>{saving ? "salvando…" : "lançar"}</button>
    </div>
  );
}

function situacao(p, today) {
  if (p.status === "paga") return <Pill tone="pos">paga {dmy(String(p.paidAt).slice(0, 10))}</Pill>;
  if (p.dueDate && p.dueDate < today) return <Pill tone="neg">vencida</Pill>;
  if (p.dueDate === today) return <Pill tone="warn">vence hoje</Pill>;
  return <Pill>em aberto</Pill>;
}

function PayableRow({ p, fin, product, reload, showPerson = true }) {
  const user = p.userId ? allUsers().find((u) => u.id === p.userId) : null;
  const pagar = async () => { try { await api.update("payables", p.id, { status: "paga", paidAt: new Date().toISOString() }); reload(); } catch (e) { alert(e.message); } };
  const reabrir = async () => { try { await api.update("payables", p.id, { status: "aberta", paidAt: "" }); reload(); } catch (e) { alert(e.message); } };
  const excluir = async () => {
    if (!confirm(`Excluir "${p.description}" (${money(p.amount)})?${p.recurring ? " É o modelo da recorrência: os meses futuros param de nascer; os já lançados ficam." : ""}`)) return;
    try { await api.remove("payables", p.id); reload(); } catch (e) { alert(e.message); }
  };
  const encerrar = async () => { try { await api.update("payables", p.id, { endMonth: fin.month }); reload(); } catch (e) { alert(e.message); } };
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "center", padding: "9px 0", borderBottom: "1px solid var(--line-faint)", flexWrap: "wrap" }}>
      <span className="tnum dim" style={{ fontSize: 12, width: 42 }} title={`vencimento ${p.dueDate}`}>{dmy(p.dueDate)}</span>
      <span style={{ flex: 1, minWidth: 160, fontSize: 13 }}>
        {p.description}
        <span className="dim" style={{ display: "block", fontSize: 11 }}>
          {[PAY_CAT_LABEL[p.category] || p.category,
            p.month !== fin.month ? `competência ${mesCurto(p.month)}` : null,
            p.recurring ? "recorrente" : p.templateId ? "da recorrência" : null,
            p.paidVia === "mp" ? "baixada pela saída do MP" : null,
          ].filter(Boolean).join(" · ")}
        </span>
      </span>
      {showPerson && (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, minWidth: 120, fontSize: 12.5 }}>
          {user ? (<><Avatar id={user.id} name={user.name} size={20} /> {user.name}</>) : (p.supplierName || <span className="dim">sem favorecido</span>)}
        </span>
      )}
      <span className="tnum" style={{ fontWeight: 650, whiteSpace: "nowrap" }}>{money(p.amount)}</span>
      {situacao(p, fin.today)}
      <span style={{ display: "inline-flex", gap: 8 }}>
        {p.status !== "paga"
          ? <button onClick={pagar} style={{ color: "var(--pos)", fontSize: 12.5, fontWeight: 600 }}>informar pagamento</button>
          : <button onClick={reabrir} className="dim" style={{ fontSize: 12, fontWeight: 600 }}>reabrir</button>}
        {p.recurring && !p.endMonth && <button onClick={encerrar} title="Este mês é o último: a recorrência para de gerar meses novos." style={{ color: "var(--warn)", fontSize: 12, fontWeight: 600 }}>encerrar</button>}
        <button onClick={excluir} className="dim" style={{ fontSize: 12, fontWeight: 600 }}>excluir</button>
      </span>
    </div>
  );
}

export function PagarTab({ product, month }) {
  const { fin, err, reload } = useFin(product, month);
  if (!fin) return <Carregando err={err} />;
  const t = fin.tiles;
  return (
    <div style={{ padding: "16px var(--pad-x) 56px", display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 180px), 1fr))", gap: 12 }}>
        <StatTile label="Vencidos" value={money(t.vencidos.total)} delta={`${int(t.vencidos.n)} conta${t.vencidos.n === 1 ? "" : "s"}`} tone={t.vencidos.n ? "down" : "flat"} />
        <StatTile label="Vencem hoje" value={money(t.vencemHoje.total)} delta={`${int(t.vencemHoje.n)} conta${t.vencemHoje.n === 1 ? "" : "s"}`} />
        <StatTile label="A vencer no mês" value={money(t.aVencer.total)} delta={`${int(t.aVencer.n)} conta${t.aVencer.n === 1 ? "" : "s"}`} />
        <StatTile label="Pagos no mês" value={money(t.pagos.total)} delta={`${int(t.pagos.n)} conta${t.pagos.n === 1 ? "" : "s"}`} />
      </div>

      <Card title="Nova conta a pagar" hint="a categoria decide o setor no DRE · salário e pró-labore entram como colaborador e aparecem na Folha · custo automático e percentual mora na aba Custos">
        <div style={{ padding: "12px var(--inset-x) 18px" }}>
          <PayableForm product={product} month={month} onDone={reload} />
        </div>
      </Card>

      <Card title={`Contas de ${mesLongo(month)}`} hint="vencidas de meses anteriores aparecem aqui até serem pagas">
        <div style={{ padding: "6px var(--inset-x) 18px", display: "flex", flexDirection: "column" }}>
          {!fin.payables.length && <span className="dim" style={{ fontSize: 12.5, padding: "10px 0" }}>Nenhuma conta lançada nesse mês.</span>}
          {fin.payables.map((p) => <PayableRow key={p.id} p={p} fin={fin} product={product} reload={reload} />)}
        </div>
      </Card>
    </div>
  );
}

// ── Folha (as contas a pagar na lente por colaborador) ───────────────────────
// Categoria default pelo PAPEL da pessoa: comercial → S&M, CS/integrador →
// COGS (suporte), social → S&M, resto → administrativo.
const roleCat = (u) => {
  const roles = u?.roles || [];
  if (roles.includes("sdr") || roles.includes("closer") || roles.includes("social")) return "pessoal_com";
  if (roles.includes("integrator")) return "suporte";
  return "pessoal_adm";
};

export function FolhaTab({ product, month }) {
  const { fin, err, reload } = useFin(product, month);
  const [formFor, setFormFor] = useState(null); // userId com o form aberto
  if (!fin) return <Carregando err={err} />;

  const doMes = fin.payables.filter((p) => p.counterpartyType === "colaborador" && p.month === month);
  const porPessoa = new Map();
  for (const p of doMes) {
    const k = p.userId || "?";
    if (!porPessoa.has(k)) porPessoa.set(k, []);
    porPessoa.get(k).push(p);
  }
  const time = allUsers();
  const linhas = [
    ...time.map((u) => ({ user: u, itens: porPessoa.get(u.id) || [] })),
    ...[...porPessoa.keys()].filter((k) => k === "?" || !time.some((u) => u.id === k))
      .map((k) => ({ user: { id: k, name: "Sem vínculo" }, itens: porPessoa.get(k) })),
  ];
  const soma = (list, f) => r2(list.filter(f).reduce((a, p) => a + (Number(p.amount) || 0), 0));
  const totalPago = soma(doMes, (p) => p.status === "paga");
  const totalAberto = soma(doMes, (p) => p.status !== "paga");

  return (
    <div style={{ padding: "16px var(--pad-x) 56px", display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 200px), 1fr))", gap: 12 }}>
        <StatTile label={`Folha de ${mesCurto(month)}`} value={money(totalPago + totalAberto)} delta={`${int(doMes.length)} lançamento${doMes.length === 1 ? "" : "s"}`}
          title="Todas as contas a pagar do mês com favorecido colaborador (salário, pró-labore, comissão, bônus)." />
        <StatTile label="Pago" value={money(totalPago)} />
        <StatTile label="Em aberto" value={money(totalAberto)} tone={totalAberto > 0 ? "down" : "flat"} />
      </div>

      <Card title="Por colaborador" hint="salário recorrente lançado 1 vez nasce sozinho todo mês · a saída do MP casada na Conciliação dá baixa aqui">
        <div style={{ padding: "6px var(--inset-x) 18px", display: "flex", flexDirection: "column", gap: 4 }}>
          {linhas.map(({ user, itens }) => {
            const pago = soma(itens, (p) => p.status === "paga");
            const aberto = soma(itens, (p) => p.status !== "paga");
            return (
              <div key={user.id} style={{ padding: "10px 0", borderBottom: "1px solid var(--line-faint)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <Avatar id={user.id} name={user.name} size={26} />
                  <span style={{ fontSize: 13.5, fontWeight: 650, flex: 1, minWidth: 120 }}>{user.name}</span>
                  <span className="tnum" style={{ fontSize: 12.5, color: "var(--fg-3)" }}>
                    pago <b style={{ color: "var(--fg-1)" }}>{money(pago)}</b>
                    {aberto > 0 && <> · em aberto <b style={{ color: "var(--warn)" }}>{money(aberto)}</b></>}
                    {!itens.length && <span className="dim"> sem lançamento no mês</span>}
                  </span>
                  <button onClick={() => setFormFor(formFor === user.id ? null : user.id)} style={{ ...btn, height: 28 }}>
                    {formFor === user.id ? "fechar" : "+ pagamento"}
                  </button>
                </div>
                {formFor === user.id && (
                  <div style={{ marginTop: 10 }}>
                    <PayableForm product={product} month={month} onDone={() => { setFormFor(null); reload(); }}
                      preset={{ counterpartyType: "colaborador", userId: user.id, category: roleCat(user), description: `Salário ${mesCurto(month)}` }} />
                  </div>
                )}
                {itens.length > 0 && (
                  <div style={{ marginTop: 4 }}>
                    {itens.map((p) => <PayableRow key={p.id} p={p} fin={fin} product={product} reload={reload} showPerson={false} />)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
