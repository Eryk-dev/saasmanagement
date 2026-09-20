import React from "react";
import { createPortal } from "react-dom";
import { MoreMenu, toast } from "../atoms.jsx";
import { api } from "../lib/api.js";
import { useActiveSaas } from "../lib/workspace.js";
import { useData } from "../data.jsx";
import { usePeriod } from "../components/period-picker.jsx";
import { PaymentLinkModal } from "../components/payment-link-modal.jsx";
import { ManualPaidModal } from "../components/manual-paid-modal.jsx";
import { linkStatusOf, linkOriginLabel, linkPaidByLabel } from "../lib/payments.js";
import { displayName, usersByRole, isAdminUser } from "../lib/users.js";
import { waLink } from "../lib/ui.js";
import "./offers.css";

// O servidor agrupa os links e calcula saldos/status. A apresentação não
// recalcula dinheiro, não muda a régua de Pagos e não baixa pagamento do MP.
const { useState, useEffect, useRef, useMemo, useCallback } = React;
const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const RECURRING_LABEL = { 1:"mensal", 3:"trimestral", 6:"semestral", 12:"anual" };
const TABS = [["aguardando","Devendo"],["pagos","Pagos"],["recusados","Recusados"],["todos","Todos"]];
const TAB_OF = { todos:()=>true, aguardando:g=>g.totals.waiting>0, pagos:g=>g.totals.paid>0, recusados:g=>g.totals.failed>0 };
const date = iso => iso ? new Date(iso).toLocaleDateString("pt-BR") : "—";
const ago = iso => {
  const at = new Date(iso || "").getTime();
  if (!Number.isFinite(at)) return "";
  const days = Math.floor((Date.now()-at)/86400000);
  return days <= 0 ? "hoje" : `há ${days}d`;
};

function OffersScreen({ onOpenLead }) {
  const [product] = useActiveSaas();
  const { version } = useData();
  const { win } = usePeriod();
  const mpOn = !!window.SEED?.CONFIG?.mp?.configured;
  const admin = isAdminUser();
  const [result,setResult] = useState(null), [err,setErr] = useState(null), [reading,setReading] = useState(false);
  const [tab,setTab] = useState("aguardando"), [q,setQ] = useState(""), [by,setBy] = useState("");
  const [open,setOpen] = useState(()=>new Set());
  const [creating,setCreating] = useState(false), [paying,setPaying] = useState(null);
  const [busy,setBusy] = useState(""), [copied,setCopied] = useState("");
  const copyTimer = useRef(null), sequence = useRef(0), mutation = useRef(false);
  const key = `${product?.id}:${win.since}:${win.until}:${by}`;
  const activeKey = useRef(key);
  activeKey.current = key;
  const data = result && result.product === product?.id ? result.value : null;
  const updating = reading || (!!data && result.key !== key);
  const error = err?.key === key ? err.message : null;
  const load = useCallback(async () => {
    if (!product?.id || key !== activeKey.current) return;
    const request = ++sequence.current;
    setErr(null);setReading(true);
    try {
      const value = await api.paymentLinks({saas:product.id,since:win.since,until:win.until,by});
      if(request===sequence.current) setResult({key,product:product.id,value});
    } catch(e) { if(request===sequence.current) setErr({key,message:e.message || "Não foi possível carregar o histórico."}); }
    finally { if(request===sequence.current) setReading(false); }
  },[product?.id,win.since,win.until,by,key]);
  useEffect(()=>{load();return()=>{sequence.current++;};},[load,version]);
  useEffect(()=>{setOpen(new Set());setCreating(false);setPaying(null);},[product?.id]);
  useEffect(()=>()=>clearTimeout(copyTimer.current),[]);
  const rows = useMemo(()=>{
    const term=q.trim().toLowerCase();
    return (data?.groups || []).filter(TAB_OF[tab]).filter(g=>!term || `${g.name} ${g.phone} ${g.links.map(l=>`${l.title || ""} ${l.payerEmail || ""}`).join(" ")}`.toLowerCase().includes(term));
  },[data,tab,q]);
  const sellers = useMemo(()=>data?.sellers?.length ? data.sellers.map(s=>({id:s.id,name:displayName(s.id)||s.name})) : usersByRole("closer"),[data]);
  function toggle(key) {setOpen(prev=>{const next=new Set(prev);next.has(key)?next.delete(key):next.add(key);return next;});}
  async function copyLink(url,id) {
    if(!url) return;
    try {await navigator.clipboard.writeText(url);} catch {window.prompt("Link de pagamento:",url);return;}
    setCopied(id);clearTimeout(copyTimer.current);copyTimer.current=setTimeout(()=>setCopied(""),1600);
  }
  async function markPaid(link) {
    if(mutation.current) return;
    if(!link.invoice) {setPaying(link);return;}
    if(!window.confirm(`Dar baixa na fatura deste link (${BRL.format(Number(link.amount)||0)})? O mesmo que marcar paga na ficha do cliente.`)) return;
    mutation.current=true;setBusy(link.id);
    try {await api.payInvoice(link.invoice);toast("fatura baixada","pos");await load();}
    catch(e) {toast(e.message || "não deu pra dar baixa na fatura","neg");}
    finally {mutation.current=false;setBusy("");}
  }
  async function undoPaid(link) {
    if(mutation.current || !window.confirm(`Desfazer a baixa de ${BRL.format(Number(link.amount)||0)}? O link voltará para em aberto.`)) return;
    mutation.current=true;setBusy(link.id);
    try {
      if(link.paidBy==="invoice" && link.invoice) await api.unpayInvoice(link.invoice);
      else await api.unpayPaymentLink(link.id);
      toast("baixa desfeita: o link voltou pra em aberto","pos");await load();
    } catch(e) {toast(e.message || "não deu pra desfazer","neg");}
    finally {mutation.current=false;setBusy("");}
  }
  function clear() {setTab("todos");setQ("");setBy("");}
  return <div className="offers-page">
    <header className="offers-header"><h1>Links de pagamento</h1><button onClick={()=>setCreating(true)} disabled={!mpOn}>Gerar link</button></header>
    {!mpOn && <div className="offers-state">Mercado Pago não conectado. O histórico continua disponível; conecte a conta para gerar novos links.</div>}
    {error && <div className="offers-state" role="alert">{data?"Não deu para atualizar o histórico. Os dados anteriores continuam visíveis:":"Não deu para carregar o histórico:"} {error} <button onClick={load}>Tentar novamente</button></div>}
    {!data && !error && <div className="offers-state" role="status">Carregando histórico…</div>}
    {data && <>
      <MoneySummary totals={data.totals} counts={data.counts} onWaiting={()=>{setTab("aguardando");setQ("");}} />
      <section className="offers-card" aria-busy={updating}>
        <div className="offers-toolbar">
          <div className="offers-tabs">{TABS.map(([id,label])=><button key={id} aria-pressed={tab===id} onClick={()=>setTab(id)}>{label} <span>{data.counts.groups?.[id] || 0}</span></button>)}</div>
          {admin && <select className="offers-seller" aria-label="Quem gerou o link" value={by} onChange={e=>setBy(e.target.value)}><option value="">Todos os vendedores</option>{sellers.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select>}
          <label className="offers-search"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7"/><path d="M20.4 20.4l-4.2-4.2"/></svg><input aria-label="Buscar links" value={q} onChange={e=>setQ(e.target.value)} placeholder="buscar por cliente, telefone ou cobrança…" /></label>
        </div>
        <div className="tbl-x" tabIndex={0} aria-label="Clientes e links de pagamento"><div className="offers-table">
          <div className="offers-table-head"><span/><span>Cliente</span><span>Links</span><span>Pago</span><span>Em aberto</span><span>Último link</span><span>Ação</span></div>
          {rows.map(g=>{
            const expanded=open.has(g.key), lead=(window.SEED?.LEADS||[]).find(l=>l.id===g.lead);
            const pill=g.totals.waiting>0?{tone:"warn",label:"em aberto"}:g.totals.paid>0?{tone:"pos",label:"pago"}:g.totals.failed>0?{tone:"neg",label:"recusado"}:{tone:"mut",label:"sem cobrança ativa"};
            const waiting=g.links.find(l=>l.status==="waiting" || l.status==="pending"), wa=waLink(g.phone);
            return <React.Fragment key={g.key}>
              <div className="offers-group" data-open={expanded} onClick={()=>toggle(g.key)}>
                <button className="offers-expand" aria-label={`${expanded?"Recolher":"Expandir"} links de ${g.name}`} aria-expanded={expanded} aria-controls={`offer-${g.key}`} onClick={e=>{e.stopPropagation();toggle(g.key);}}>{expanded?"▾":"▸"}</button>
                <span className="offers-customer">{lead&&onOpenLead?<button onClick={e=>{e.stopPropagation();onOpenLead(lead);}}>{g.name}</button>:<strong>{g.name}</strong>}<small>{[g.kind==="customer"?"cliente":g.kind==="lead"?"lead":"",g.phone].filter(Boolean).join(" · ")}</small></span>
                <span className="offers-count">{g.counts.links}</span>
                <span className="offers-money" data-tone={g.totals.paid>0?"pos":"mut"}>{g.totals.paid>0?BRL.format(g.totals.paid):"—"}</span>
                <span className="offers-balance"><span className="offers-money" data-tone={g.totals.waiting>0?"warn":"mut"}>{g.totals.waiting>0?BRL.format(g.totals.waiting):"—"}</span><span className="offers-pill" data-tone={pill.tone}>{pill.label}</span></span>
                <span className="offers-date"><span>{date(g.lastAt)}</span><small>{ago(g.lastAt)}</small></span>
                <span className="offers-actions" onClick={e=>e.stopPropagation()}>{waiting?.url&&<>{wa&&<a className="offers-charge" href={`${wa}?text=${encodeURIComponent(`Oi${g.name?` ${String(g.name).split(" ")[0]}`:""}, segue o link do pagamento: ${waiting.url}`)}`} target="_blank" rel="noopener noreferrer">Cobrar</a>}<button onClick={()=>copyLink(waiting.url,`g-${g.key}`)}>{copied===`g-${g.key}`?"Copiado ✓":"Copiar"}</button></>}</span>
              </div>
              {expanded&&<div id={`offer-${g.key}`} className="offers-links">{g.links.map(l=><LinkRow key={l.id} link={l} copied={copied===l.id} busy={!!busy} onCopy={copyLink} onPay={markPaid} onUndo={undoPaid}/>)}</div>}
            </React.Fragment>;
          })}
        </div></div>
        {!rows.length&&<div className="offers-empty">{!data.groups.length&&!by?"Nenhum link de pagamento no período.":<>nenhum cliente com esse filtro · <button onClick={clear}>Limpar</button></>}</div>}
      </section>
    </>}
    {creating&&createPortal(<PaymentLinkModal saas={product?.id} origin="tela" onClose={()=>setCreating(false)} onSaved={()=>{toast("link gerado: copie e mande pro cliente","pos");load();}}/>,document.body)}
    {paying&&createPortal(<ManualPaidModal link={paying} onClose={()=>setPaying(null)} onDone={()=>{setPaying(null);toast("marcado como pago","pos");load();}}/>,document.body)}
  </div>;
}
function MoneySummary({totals,counts,onWaiting}) {
  const money=window.fmt.moneyFull,generated=Number(totals.generated)||0;
  const pct=v=>generated>0?Math.max(0,Math.min(100,(Number(v)||0)/generated*100)):0;
  return <section className="offers-summary capsule-navy">
    <svg className="offers-mark" width="180" height="180" viewBox="355 525 455 590" aria-hidden="true"><polygon fill="currentColor" points="800.7 535.53 800.7 1103.92 763 983.8 749.25 939.91 691.16 754.61 501.54 817.84 457.65 832.42 362.47 864.14 443.6 803.33 481.22 775.08 800.7 535.53"/></svg>
    <div className="offers-summary-values">
      <div className="offers-waiting"><h2><i/>em aberto</h2><strong data-waiting={totals.waiting>0}>{money(totals.waiting)}</strong><small>{counts.groups?.aguardando||0} {counts.groups?.aguardando===1?"cliente devendo":"clientes devendo"}</small></div>
      <div className="offers-received"><span>Recebido</span><strong>{money(totals.paid)}</strong><small>{counts.paid||0} {counts.paid===1?"link pago":"links pagos"}</small></div>
      <div className="offers-generated"><span>Links gerados</span><strong>{counts.links||0}</strong><small>{money(generated)} pedidos</small></div>
      {totals.failed>0&&<div className="offers-failed"><span>Recusado</span><strong><i/>{money(totals.failed)}</strong></div>}
      <button onClick={onWaiting}>Ver quem está devendo →</button>
    </div>
    <div className="offers-bar" aria-hidden="true"><span style={{width:`${pct(totals.paid)}%`}}/><span style={{width:`${pct(totals.waiting)}%`}}/><span style={{width:`${pct(totals.failed)}%`}}/></div>
    <div className="offers-legend"><span><i/>pago</span><span><i/>em aberto</span><span><i/>recusado</span><span title="O status vem do Mercado Pago: o pagamento casa pelo link (referência do lead/fatura) ou pelo e-mail do pagador. Baixa manual = dinheiro que entrou por fora e foi marcado à mão. Substituído = link antigo de quem gerou de novo pelo mesmo valor.">como o status funciona ⓘ</span></div>
  </section>;
}
function LinkRow({link:l,copied,busy,onCopy,onPay,onUndo}) {
  const status=linkStatusOf(l.status),wa=waLink(l.targetPhone);
  const canPay=l.status!=="paid"&&l.status!=="superseded",canUndo=l.paidBy==="manual"||l.paidBy==="invoice";
  const description=[l.title||"—",l.recurring?`↻ ${RECURRING_LABEL[l.frequencyMonths]||"recorrente"}`:"",linkOriginLabel(l.origin)].filter(Boolean).join(" · ");
  return <div className="offers-link" data-link={l.id}>
    <span className="offers-pill" data-tone={status.tone}>{status.label}</span><strong>{BRL.format(Number(l.amount)||0)}</strong><span className="offers-description">{description}</span><span className="offers-when">{ago(l.createdAt)?`gerado ${ago(l.createdAt)}`:"—"}</span>
    {l.paidBy&&<span className="offers-paid-via">{linkPaidByLabel(l.paidBy)}</span>}
    {canPay&&<button className="offers-pay" onClick={()=>onPay(l)} disabled={busy}>Dar baixa</button>}
    <span className="offers-link-menu"><MoreMenu size={canPay?26:22} items={[
      l.url&&{label:copied?"Copiado ✓":"Copiar link",onClick:()=>onCopy(l.url,l.id)},
      l.url&&{label:"Abrir checkout ↗",onClick:()=>window.open(l.url,"_blank","noopener,noreferrer")},
      l.url&&wa&&{label:"Enviar no WhatsApp ↗",onClick:()=>window.open(`${wa}?text=${encodeURIComponent(`Segue o link pra pagamento: ${l.url}`)}`,"_blank","noopener,noreferrer")},
      canUndo&&!busy&&{label:"Desfazer baixa",onClick:()=>onUndo(l)},
    ]}/></span>
  </div>;
}
export { OffersScreen };
