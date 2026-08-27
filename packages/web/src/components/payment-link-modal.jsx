import React from "react";
import { useEsc } from "../atoms.jsx";
import { waLink } from "../lib/ui.js";
import { api } from "../lib/api.js";
import { PAYMENT_METHODS, CLOSED_PLANS, DEAL_PRODUCTS, dealProductLabel, dealProductsOf } from "../lib/payments.js";
import { ProductOptions } from "./lead-blocks.jsx";

// Modal do LINK DE PAGAMENTO do Mercado Pago — o MESMO em todo lugar que gera
// link: atalho do card do lead (deal.jsx) e tela "Links de pagamento", que abre
// ele já com o seletor de quem vai pagar.
//
// LEAD: cria o checkout com external_reference = id do lead — o pagamento entra
// no Financeiro já casado com a origem (e com o cliente quando o lead vira
// Ganho). Não cria fatura: fatura é do cliente, pós-Ganho. Gerar de novo
// substitui o link salvo no card (o histórico guarda os dois).
//
// O bloco "fechamento" grava DIRETO os campos que o gate de Ganho usa
// (planClosed/amount/paymentMethod): pagamento confirmado + card virado, o
// cliente e a assinatura nascem com plano, duração e valor certos.
//
// CLIENTE: é cobrança avulsa — nasce uma FATURA no financeiro do cliente e o
// link aponta pra ela, então a baixa é automática quando o dinheiro cair.
//
// RECORRENTE (lead): em vez do checkout de uma vez, o link é a AUTORIZAÇÃO de
// uma assinatura no Mercado Pago (preapproval) — o cliente aprova uma vez e o
// MP cobra sozinho a cada N meses. A recorrência fica carimbada no card e, no
// Ganho, a assinatura que nasce do fechamento a adota (cobrança do ciclo dá
// baixa na fatura, cancelar aqui cancela no MP).

const inputStyle = { height: 36, padding: "0 12px", borderRadius: "var(--r-2)", border: "1px solid var(--line-2)", background: "var(--bg-1)", color: "var(--fg-1)", fontSize: 13, width: "100%" };
const field = { display: "flex", flexDirection: "column", gap: 4 };

const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const isEmail = (v) => EMAIL_RX.test(String(v || "").trim());

// E-mail do alvo: o campo próprio quando existe; senão varre o card por uma
// resposta que SEJA um e-mail (o form espalha TODAS as respostas no lead — um
// form sem mapping de e-mail deixa o valor sob a chave da pergunta, ex.:
// `email_contato`).
function emailOf(doc) {
  const direct = String(doc?.email || "").trim();
  if (direct) return direct;
  for (const v of Object.values(doc || {})) {
    if (typeof v === "string" && EMAIL_RX.test(v.trim())) return v.trim();
  }
  return "";
}

// Frequências que o preapproval do Mercado Pago aceita (1/3/6/12 meses).
const FREQUENCIES = [
  { months: 1, label: "todo mês" },
  { months: 3, label: "a cada 3 meses" },
  { months: 6, label: "a cada 6 meses" },
  { months: 12, label: "todo ano" },
];
const freqShort = (m) => ({ 1: "mensal", 3: "trimestral", 6: "semestral", 12: "anual" })[m] || "";

// Quem vai pagar: busca sobre os leads e clientes do workspace ativo (o SEED já
// vem filtrado pela permissão de quem está logado). Lista curta e digitável —
// são 1.200+ leads, então select não serve.
function TargetPicker({ saas, onPick }) {
  const [kind, setKind] = React.useState("lead");
  const [q, setQ] = React.useState("");
  const rows = React.useMemo(() => {
    const src = kind === "lead" ? (window.SEED?.LEADS || []) : (window.SEED?.CUSTOMERS || []);
    const term = q.trim().toLowerCase();
    const mine = src.filter((d) => !saas || d.saas === saas);
    const hit = term
      ? mine.filter((d) => `${d.name || ""} ${d.company || ""} ${d.email || ""} ${d.phone || ""}`.toLowerCase().includes(term))
      : mine;
    // Sem busca, os mais recentes primeiro (id cresce com o tempo).
    return [...hit].sort((a, b) => String(b.id).localeCompare(String(a.id))).slice(0, 8);
  }, [kind, q, saas]);

  const tab = (id, label) => (
    <button key={id} onClick={() => setKind(id)} className="chip" style={{
      cursor: "pointer", fontWeight: 600,
      background: kind === id ? "var(--accent-soft)" : "var(--bg-2)",
      color: kind === id ? "var(--accent)" : "var(--fg-3)",
      boxShadow: kind === id ? "inset 0 0 0 1px var(--accent-line)" : "none",
    }}>{label}</button>
  );

  return (
    <div style={{ ...field, gap: 10 }}>
      <span className="kicker accent">quem vai pagar</span>
      <div style={{ display: "flex", gap: 6 }}>
        {tab("lead", "Lead do pipeline")}
        {tab("customer", "Cliente")}
      </div>
      <input type="search" autoFocus value={q} onChange={(e) => setQ(e.target.value)}
        placeholder={kind === "lead" ? "buscar lead por nome, e-mail ou telefone…" : "buscar cliente…"}
        style={inputStyle} />
      <div style={{ display: "flex", flexDirection: "column", gap: 2, maxHeight: 260, overflowY: "auto" }}>
        {rows.map((d) => (
          <button key={d.id} onClick={() => onPick({ kind, doc: d })}
            style={{ textAlign: "left", padding: "8px 10px", borderRadius: "var(--r-2)", background: "transparent", border: "1px solid transparent", cursor: "pointer" }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-2)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}>
            <div style={{ fontSize: 13, fontWeight: 500 }}>{d.name || "(sem nome)"}</div>
            <div className="mono dim" style={{ fontSize: 10.5 }}>
              {[kind === "lead" ? d.stage : d.plan, emailOf(d), d.phone].filter(Boolean).join(" · ") || "—"}
            </div>
          </button>
        ))}
        {!rows.length && (
          <div className="mono dim" style={{ fontSize: 11.5, padding: "10px 2px" }}>
            {q ? "ninguém com esse nome por aqui" : "nenhum registro neste produto"}
          </div>
        )}
      </div>
    </div>
  );
}

function PaymentLinkModal({ lead, customer, saas, origin = "card", onClose, onSaved }) {
  useEsc(onClose);
  const [target, setTarget] = React.useState(() =>
    lead ? { kind: "lead", doc: lead } : customer ? { kind: "customer", doc: customer } : null);
  const pickable = !lead && !customer; // aberto pela tela: dá pra trocar de alvo

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "oklch(0 0 0 / 0.45)", zIndex: 130, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "min(100%, 500px)", maxHeight: "90vh", overflowY: "auto", background: "var(--bg-1)", border: "1px solid var(--line-1)", borderRadius: "var(--r-3)", boxShadow: "var(--shadow-pop)", padding: "16px 18px", display: "flex", flexDirection: "column", gap: 14 }}>
        {!target ? (
          <>
            <Header title="Novo link de pagamento" sub="escolha o lead ou o cliente que vai pagar" onClose={onClose} />
            <TargetPicker saas={saas} onPick={setTarget} />
          </>
        ) : (
          <LinkForm key={`${target.kind}:${target.doc.id}`} target={target} origin={origin} saas={saas}
            onBack={pickable ? () => setTarget(null) : null} onClose={onClose} onSaved={onSaved} />
        )}
      </div>
    </div>
  );
}

function Header({ title, sub, onClose, onBack }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</div>
        <div className="mono dim" style={{ fontSize: 11, marginTop: 2 }}>
          {onBack && <button onClick={onBack} className="mono" style={{ color: "var(--accent)", marginRight: 6 }}>← trocar</button>}
          {sub}
        </div>
      </div>
      <button onClick={onClose} aria-label="Fechar" className="mono dim" style={{ fontSize: 15 }}>✕</button>
    </div>
  );
}

function LinkForm({ target, origin, saas, onBack, onClose, onSaved }) {
  const doc = target.doc;
  const isLead = target.kind === "lead";
  const product = (window.SEED?.SAAS || []).find((s) => s.id === (doc.saas || saas));
  // Mesmo rótulo do servidor (PLAN_LABEL/PRODUCT_LABEL em routes.mp.js):
  // título default do checkout = produto do catálogo + plano.
  const PLAN_TITLE = { anual: "Plano Anual", semestral: "Plano Semestral", mensal: "Assinatura mensal", unico: "Serviço único" };
  const titleFor = (p, prod) => [dealProductLabel(prod, doc.saas) || product?.name || doc.saas, PLAN_TITLE[p] || "pagamento"].filter(Boolean).join(" · ");

  const [amount, setAmount] = React.useState(isLead ? (doc.mpChargeAmount || "") : "");
  const [installments, setInstallments] = React.useState(12);
  // Cobrança única (checkout) × assinatura recorrente (preapproval). O card que
  // já tem recorrência abre no modo recorrente — é o combinado dele.
  const [mode, setMode] = React.useState(isLead && doc.mpChargeKind === "recurring" ? "recurring" : "once");
  const [freq, setFreq] = React.useState(Number(doc.mpPreapprovalMonths) || 1);
  const recurring = isLead && mode === "recurring";
  const [plan, setPlan] = React.useState(doc.planClosed || "anual");
  const [dealProduct, setDealProduct] = React.useState(doc.dealProduct || "");
  const [contract, setContract] = React.useState(isLead && Number(doc.amount) > 0 ? String(doc.amount) : "");
  const [method, setMethod] = React.useState(doc.paymentMethod || "");
  const [payerEmail, setPayerEmail] = React.useState(emailOf(doc));
  const [title, setTitle] = React.useState(isLead
    ? (doc.mpChargeTitle || titleFor(doc.planClosed || "anual", doc.dealProduct || ""))
    : [product?.name || doc.saas, "cobrança"].filter(Boolean).join(" · "));
  const [titleDirty, setTitleDirty] = React.useState(isLead ? !!doc.mpChargeTitle : true);
  const [description, setDescription] = React.useState("");
  const [url, setUrl] = React.useState(isLead ? (doc.mpChargeUrl || "") : "");
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState(null);
  const [copied, setCopied] = React.useState(false);
  const wa = waLink(doc.phone);

  // Título acompanha produto e plano até o closer mexer nele na mão.
  function pickPlan(p) {
    setPlan(p);
    if (!titleDirty) setTitle(titleFor(p, dealProduct));
  }
  function pickProduct(prod) {
    setDealProduct(prod);
    if (!titleDirty) setTitle(titleFor(plan, prod));
  }

  // Trocar pra recorrente já deixa o combinado do card coerente (é uma
  // assinatura no cartão), sem sobrescrever escolha que o closer já fez.
  function pickMode(m) {
    setMode(m);
    if (m === "recurring" && !method) setMethod("cartao_recorrente");
  }

  async function create() {
    const value = Number(String(amount).replace(",", "."));
    if (!(value > 0)) { setErr("Informe o valor da cobrança."); return; }
    // Preapproval EXIGE e-mail válido (é a conta que autoriza a cobrança
    // automática): sem ele o MP recusa a assinatura inteira.
    if (recurring && !isEmail(payerEmail)) {
      setErr("Assinatura recorrente precisa do e-mail do pagador: o Mercado Pago exige um e-mail válido pra autorizar a cobrança automática.");
      return;
    }
    const contractValue = Number(String(contract).replace(",", "."));
    setBusy(true); setErr(null);
    try {
      const r = isLead
        ? await api.mpLeadLink(doc.id, {
          amount: value,
          ...(recurring
            ? { mode: "recurring", frequencyMonths: Number(freq) || 1 }
            : { maxInstallments: Number(installments) || undefined }),
          title: title.trim() || undefined, description: description.trim() || undefined,
          payerEmail: payerEmail.trim() || undefined,
          plan, product: dealProduct || undefined,
          contractValue: contractValue > 0 ? contractValue : undefined,
          paymentMethod: method || undefined,
          origin,
        })
        : await api.createCharge(doc.id, {
          amount: value, title: title.trim() || undefined,
          maxInstallments: Number(installments) || undefined, origin,
        });
      setUrl(r.url || "");
      setCopied(false);
      onSaved && onSaved(r);
    } catch (e) { setErr(e.message || "MP não respondeu"); }
    finally { setBusy(false); }
  }

  async function copy() {
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1800); }
    catch { window.prompt("Link:", url); }
  }

  return (
    <>
      <Header
        title={`Link de pagamento · ${doc.name || (isLead ? "lead" : "cliente")}`}
        sub={isLead
          ? `${product?.name || doc.saas} · ${recurring
            ? "a recorrência fica no card e vira a assinatura do cliente no Ganho"
            : "o pagamento entra no Financeiro já casado com este lead"}`
          : `${product?.name || doc.saas} · cria a fatura no cliente e a baixa é automática quando pagar`}
        onClose={onClose} onBack={onBack} />

      {/* O que o cliente vê ao abrir o checkout do MP. */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <span className="kicker accent">{recurring ? "assinatura recorrente" : "checkout"}</span>
        {/* Cobrança única × recorrente: muda o TIPO do link no Mercado Pago. */}
        {isLead && (
          <div style={{ display: "flex", gap: 6 }}>
            {[["once", "cobrança única"], ["recurring", "assinatura recorrente"]].map(([id, label]) => (
              <button key={id} onClick={() => pickMode(id)} className="chip" style={{
                cursor: "pointer", fontWeight: 600,
                background: mode === id ? "var(--accent-soft)" : "var(--bg-2)",
                color: mode === id ? "var(--accent)" : "var(--fg-3)",
                boxShadow: mode === id ? "inset 0 0 0 1px var(--accent-line)" : "none",
              }} title={id === "once"
                ? "checkout de uma vez (PIX, boleto ou cartão parcelado)"
                : "o cliente autoriza uma vez e o Mercado Pago cobra sozinho a cada ciclo, no cartão"}>{label}</button>
            ))}
          </div>
        )}
        <div style={{ display: "grid", gridTemplateColumns: recurring ? "1fr 150px" : "1fr 96px", gap: 8 }}>
          <label style={field}>
            <span className="kicker">{recurring ? "Valor de cada cobrança (R$)" : "Valor da cobrança (R$)"}</span>
            <input type="number" min="0" step="0.01" placeholder="0,00" value={amount} autoFocus
              onChange={(e) => setAmount(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") create(); }}
              style={{ ...inputStyle, fontFamily: "var(--mono)", textAlign: "right" }} />
          </label>
          {recurring ? (
            <label style={field}>
              <span className="kicker">Cobrar</span>
              <select value={freq} onChange={(e) => setFreq(Number(e.target.value))} style={inputStyle}>
                {FREQUENCIES.map((f) => <option key={f.months} value={f.months}>{f.label}</option>)}
              </select>
            </label>
          ) : (
            <label style={field}>
              <span className="kicker">Parcelas até</span>
              <select value={installments} onChange={(e) => setInstallments(e.target.value)} style={inputStyle}>
                {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}x</option>)}
              </select>
            </label>
          )}
        </div>
        <label style={field}>
          <span className="kicker">Título no checkout</span>
          <input type="text" value={title} placeholder={isLead ? titleFor(plan, dealProduct) : "o que está sendo cobrado"}
            onChange={(e) => { setTitle(e.target.value); setTitleDirty(true); }}
            style={inputStyle} />
        </label>
        {isLead && (
          <>
            <label style={field}>
              <span className="kicker">Descrição (opcional)</span>
              <input type="text" value={description} placeholder="ex.: 12 meses de LeverAds com contas ilimitadas"
                onChange={(e) => setDescription(e.target.value)}
                style={inputStyle} />
            </label>
            <label style={field}>
              <span className="kicker">E-mail do pagador{recurring ? " (obrigatório)" : ""}</span>
              <input type="email" value={payerEmail}
                placeholder={recurring ? "a conta que vai autorizar a cobrança automática" : "pré-preenche o checkout e reforça o casamento"}
                onChange={(e) => setPayerEmail(e.target.value)}
                style={{ ...inputStyle, ...(recurring && !isEmail(payerEmail) ? { borderColor: "var(--neg)" } : {}) }} />
            </label>
          </>
        )}
        {recurring && (
          <div className="mono dim" style={{ fontSize: 10.5 }}>
            esse link é a AUTORIZAÇÃO da assinatura: o cliente aprova uma vez no cartão e o Mercado Pago cobra R$ {Number(String(amount).replace(",", ".")) > 0 ? Number(String(amount).replace(",", ".")).toLocaleString("pt-BR", { minimumFractionDigits: 2 }) : "…"} de forma {freqShort(Number(freq))} sozinho, até alguém cancelar
          </div>
        )}
      </div>

      {/* O combinado do negócio: mesmos campos do gate de Ganho — virar o
          card depois do pagamento vira 1 clique com tudo certo. */}
      {isLead && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <span className="kicker accent">fechamento</span>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 8 }}>
            <label style={field}>
              <span className="kicker">Produto</span>
              <select value={dealProduct} onChange={(e) => pickProduct(e.target.value)} style={inputStyle}
                title="produto do catálogo da apresentação — vai pro card, pro cliente e pro card da Integração">
                <option value="">escolher…</option>
                {/* catálogo real do SaaS (SEED); sem catálogo, a lista estática */}
                <ProductOptions products={dealProductsOf(doc.saas).length ? dealProductsOf(doc.saas) : DEAL_PRODUCTS} />
              </select>
            </label>
            <label style={field}>
              <span className="kicker">Plano · duração</span>
              <select value={plan} onChange={(e) => pickPlan(e.target.value)} style={inputStyle}>
                {CLOSED_PLANS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            </label>
            <label style={field}>
              <span className="kicker">Valor do contrato (R$)</span>
              <input type="number" min="0" step="0.01" placeholder="se a cobrança for só a entrada" value={contract}
                onChange={(e) => setContract(e.target.value)}
                title="valor do negócio inteiro — a cobrança do link pode ser só a entrada"
                style={{ ...inputStyle, fontFamily: "var(--mono)", textAlign: "right" }} />
            </label>
            <label style={field}>
              <span className="kicker">Forma combinada</span>
              <select value={method} onChange={(e) => setMethod(e.target.value)} style={inputStyle}>
                <option value="">escolher…</option>
                {PAYMENT_METHODS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
              </select>
            </label>
          </div>
          <div className="mono dim" style={{ fontSize: 10.5 }}>
            esses campos vão pro card: quando o pagamento cair e você virar pra Ganho, cliente e assinatura já nascem com produto, plano, duração e valor certos
          </div>
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button onClick={create} disabled={busy}
          style={{ height: 36, padding: "0 16px", borderRadius: "var(--r-2)", background: "var(--btn-bg)", color: "var(--btn-fg)", fontSize: 12.5, fontWeight: 600, opacity: busy ? 0.6 : 1 }}>
          {busy ? "gerando…" : (url ? "gerar novo link" : (recurring ? "gerar link da assinatura" : "gerar link"))}
        </button>
      </div>

      {err && <div className="mono" style={{ fontSize: 12, color: "var(--neg)" }}>{err}</div>}

      {url && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", padding: "10px 12px", borderRadius: "var(--r-2)", background: "var(--bg-inset)", border: "1px solid var(--line-1)", minWidth: 0 }}>
          <span className="mono" style={{ flex: 1, fontSize: 11.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={url}>{url}</span>
          <button className="mono" onClick={copy} title="Copiar link"
            style={{ fontSize: 11, flexShrink: 0, color: copied ? "var(--pos)" : "var(--fg-4)" }}>
            {copied ? "✓ copiado" : "copiar"}
          </button>
          {wa && (
            <a className="mono" style={{ fontSize: 11, flexShrink: 0, color: "var(--accent)", textDecoration: "none" }}
              href={`${wa}?text=${encodeURIComponent(`${recurring ? "Segue o link pra ativar a assinatura" : "Segue o link pra pagamento"}: ${url}`)}`}
              target="_blank" rel="noopener noreferrer" title="Enviar o link no WhatsApp">mandar no Whats ↗</a>
          )}
        </div>
      )}
    </>
  );
}

export { PaymentLinkModal };
