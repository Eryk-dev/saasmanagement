// Modo integração (03/11/2026): a call de integração conduzida passo a passo.
//
// Abre do card da Integração por cima de qualquer tela, em três colunas:
//   · o checklist como roteiro (um item por vez, na ordem do modelo);
//   · o item atual com o passo do guia ligado a ele (texto, falas, prints, dica);
//   · o que o operador precisa saber do cliente: contrato e produtos com conta,
//     contatos, respostas do formulário de integração, resumo da venda e as
//     pendências do lado do cliente.
// No topo, o que falta antes de começar. "Feito e seguir" marca o item do
// checklist na integração (PATCH dos itens) e passa para o próximo em aberto.
// Os dados vêm de GET /api/customers/onboardings/:id/kit (onboarding-kit.js).

import React from "react";
import { createPortal } from "react-dom";
import "./onboarding-run.css";
import { api } from "../lib/api.js";
import { displayName } from "../lib/users.js";
import { toast } from "../atoms.jsx";
import { Modal } from "./overlay.jsx";
import { GuideStep, GuideViewer, PRODUCT_LABEL } from "./guide-viewer.jsx";

const { useState, useEffect } = React;
const ROLE = { decisor: "decisor", financeiro: "financeiro", usuario: "usuário", ponto_focal: "ponto focal" };
const PRODUCT = { ...PRODUCT_LABEL, mentoria: "Mentoria" };

function Section({ title, children, open = true }) {
  return <details className="run-section" open={open}>
    <summary>{title}</summary>
    <div className="run-section-body">{children}</div>
  </details>;
}

function CustomerPanel({ kit }) {
  const { customer, form, brief, clientPending, deal } = kit;
  const entregas = brief?.entregas || brief?.vendido || [];
  return <aside className="run-customer" aria-label="O que saber do cliente">
    <Section title="Contrato">
      <div className="run-pair"><span>Plano</span><strong>{customer.plan || "—"}</strong></div>
      <div className="run-pair"><span>Produtos</span><strong>{customer.products.length
        ? customer.products.map((p) => <span key={p.id} className="run-product" data-off={p.account === false || undefined}>{PRODUCT[p.id] || p.id}{p.account === false ? " · sem conta" : p.account ? " · conta ok" : ""}</span>)
        : "—"}</strong></div>
      {deal?.closer && <div className="run-pair"><span>Vendido por</span><strong>{displayName(deal.closer)}</strong></div>}
      {customer.owner && <div className="run-pair"><span>Dono da conta</span><strong>{displayName(customer.owner)}</strong></div>}
    </Section>
    {customer.contacts.length > 0 && <Section title="Contatos">
      {customer.contacts.map((c, i) => <div key={i} className="run-contact">
        <strong>{c.name || c.email || c.phone}</strong>
        <span>{[ROLE[c.role] || (c.primary ? "principal" : ""), c.phone, c.email].filter(Boolean).join(" · ")}</span>
      </div>)}
    </Section>}
    <Section title={form?.status === "respondido" ? "Formulário de integração" : "Formulário de integração · sem resposta"}>
      {!form && <p className="run-note">Ainda não foi enviado ao cliente (tela Formulário de Integração).</p>}
      {form && form.status !== "respondido" && <p className="run-note">Enviado, o cliente ainda não respondeu.</p>}
      {form?.sections.map((sec) => <div key={sec.title} className="run-form-sec">
        <h4>{sec.title}</h4>
        {sec.items.map((it, i) => it.rows
          ? <div key={i} className="run-form-rows"><span>{it.label}</span><ol>{it.rows.map((r, j) => <li key={j}>{r}</li>)}</ol></div>
          : <div key={i} className="run-pair"><span>{it.label}</span><strong>{it.value}</strong></div>)}
      </div>)}
    </Section>
    {brief && <Section title="Resumo da venda">
      {brief.resumo && <p className="run-text">{brief.resumo}</p>}
      {entregas.length > 0 && <><h4 className="run-h4">o que entregar</h4><ul className="run-list">{entregas.map((e, i) => <li key={i}>{typeof e === "string" ? e : e.item || e.texto || JSON.stringify(e)}</li>)}</ul></>}
      {(brief.atencao || []).length > 0 && <><h4 className="run-h4">atenção</h4><ul className="run-list">{brief.atencao.map((a, i) => <li key={i}><b>{a.ponto || a}</b>{a.porque ? ` · ${a.porque}` : ""}</li>)}</ul></>}
    </Section>}
    {clientPending?.open > 0 && <Section title={`Pendências do cliente · ${clientPending.open}`}>
      <ul className="run-list">{(clientPending.items || []).map((p, i) => <li key={i}>{p.item}{p.dueDate ? <span className="run-due"> · até {p.dueDate.split("-").reverse().slice(0, 2).join("/")}</span> : null}</li>)}</ul>
    </Section>}
  </aside>;
}

function ItemGuide({ item, kit }) {
  const [full, setFull] = useState(false);
  const link = item.guide;
  if (!link?.id) return <p className="run-note run-no-guide">Este item ainda não tem guia. Quem edita os guias liga um passo a ele em Guias → Modelos de checklist.</p>;
  const g = kit.guides[link.id];
  if (!g) return <p className="run-note run-no-guide">O guia deste item ainda não foi publicado.</p>;
  const steps = g.steps || [];
  const idx = Math.max(0, steps.findIndex((s) => s.id === link.step));
  const step = steps[idx];
  return <div className="run-guide">
    <div className="run-guide-head">
      <span>do guia <b>{g.title}</b></span>
      <button type="button" className="guide-link-btn" onClick={() => setFull(true)}>ver o guia inteiro →</button>
    </div>
    {step ? <GuideStep step={step} index={idx} total={steps.length} /> : <p className="run-note">O guia ainda não tem passos.</p>}
    {full && <GuideViewer guideId={g.id} guide={g} stepId={step?.id || ""} onClose={() => setFull(false)} />}
  </div>;
}

export function OnboardingRun({ id, onClose }) {
  const [kit, setKit] = useState(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [changed, setChanged] = useState(false);
  useEffect(() => {
    let alive = true;
    setError("");
    api.onboardingKit(id).then((k) => {
      if (!alive) return;
      setKit(k);
      const first = (k.onboarding.items || []).findIndex((it) => !it.doneAt);
      setIndex(first >= 0 ? first : 0);
    }).catch((e) => alive && setError(e.message || "Não foi possível abrir o modo integração."));
    return () => { alive = false; };
  }, [id, attempt]);

  const items = kit?.onboarding.items || [];
  const item = items[index];
  const done = items.filter((it) => it.doneAt).length;
  const close = () => { if (!busy) onClose(changed); };

  async function toggle(markDone) {
    if (busy || !item) return;
    setBusy(true);
    const next = items.map((it, i) => (i === index ? { ...it, doneAt: markDone ? new Date().toISOString() : "" } : it));
    try {
      const saved = await api.updateOnboarding(kit.onboarding.id, { items: next });
      setKit((k) => ({ ...k, onboarding: saved }));
      setChanged(true);
      if (markDone) {
        const after = saved.items.findIndex((it, i) => i > index && !it.doneAt);
        const any = saved.items.findIndex((it) => !it.doneAt);
        if (after >= 0) setIndex(after);
        else if (any >= 0) setIndex(any);
      }
    } catch (e) { toast(`${e.message || "Não foi possível marcar o item"} · tente de novo`, "neg"); }
    finally { setBusy(false); }
  }

  const when = kit?.deal?.integrationAt ? new Date(kit.deal.integrationAt) : null;
  const callLine = when && Number.isFinite(when.getTime())
    ? `call ${when.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}` : "";

  return createPortal(<Modal onClose={close} fechavel={!busy} label={kit ? `Modo integração · ${kit.customer.name}` : "Modo integração"} largura={1360} padding={12}
    painelStyle={{ display: "flex", flexDirection: "column", overflow: "hidden", height: "calc(100dvh - 24px)" }}>
    <header className="run-head">
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="run-kicker">modo integração</div>
        <h2>{kit?.customer.name || "Integração"}</h2>
        {kit && <p>{[`${done} de ${items.length} itens`, kit.onboarding.integrator ? `integrador ${displayName(kit.onboarding.integrator)}` : "", callLine].filter(Boolean).join(" · ")}
          {kit.deal?.integrationCallUrl && <> · <a href={kit.deal.integrationCallUrl} target="_blank" rel="noopener noreferrer">entrar no Meet ↗</a></>}</p>}
      </div>
      {kit && <div className="run-progress" aria-label={`${done} de ${items.length} itens feitos`}><i style={{ width: `${items.length ? (done / items.length) * 100 : 0}%` }} /></div>}
      <button type="button" className="guide-close" aria-label="Fechar o modo integração" onClick={close} disabled={busy}>✕</button>
    </header>
    {!kit
      ? <div className="guide-viewer-wait" role={error ? "alert" : "status"}>{error || "montando o roteiro da integração…"}{error && <button type="button" onClick={() => setAttempt((n) => n + 1)}>tentar de novo</button>}</div>
      : <>
        {kit.missing.length > 0 && <div className="run-missing" role="note">
          <strong>Antes de começar</strong>
          <ul>{kit.missing.map((m) => <li key={m.key} data-tone={m.tone}>{m.text}</li>)}</ul>
        </div>}
        <div className="run-body">
          <nav className="run-steps" aria-label="Checklist da integração">
            <ol>
              {items.map((it, i) => <li key={it.id || i}>
                <button type="button" aria-current={i === index ? "step" : undefined} data-done={it.doneAt ? "" : undefined} onClick={() => setIndex(i)}>
                  <span className="run-step-mark">{it.doneAt ? "✓" : i + 1}</span>
                  <span className="run-step-title">{it.title}<small>{it.side === "cliente" ? "o cliente entrega" : "a Lever entrega"}</small></span>
                </button>
              </li>)}
            </ol>
            {!items.length && <p className="run-note">A integração está sem checklist: monte os itens no card.</p>}
          </nav>
          <main className="run-main">
            {item ? <>
              <div className="run-item-head">
                <div className="run-kicker">item {index + 1} de {items.length} · {item.side === "cliente" ? "o cliente entrega" : "a Lever entrega"}</div>
                <h3>{item.title}</h3>
                {item.help && <p>{item.help}</p>}
                {item.doneAt && <span className="run-done-chip">feito</span>}
              </div>
              <ItemGuide key={`${index}-${item.guide?.id || ""}-${item.guide?.step || ""}`} item={item} kit={kit} />
            </> : <p className="run-note" style={{ padding: 24 }}>Nada no checklist.</p>}
            {items.length > 0 && <footer className="run-foot">
              <button type="button" className="guide-btn" disabled={index === 0 || busy} onClick={() => setIndex(index - 1)}>‹ anterior</button>
              <span style={{ flex: 1 }} />
              {done === items.length && <span className="run-all-done">checklist completo: conclua a integração no card</span>}
              {item?.doneAt
                ? <button type="button" className="guide-btn" disabled={busy} onClick={() => toggle(false)}>{busy ? "salvando…" : "Desmarcar"}</button>
                : <button type="button" className="guide-btn" disabled={busy || index === items.length - 1} onClick={() => setIndex(index + 1)}>pular ›</button>}
              {!item?.doneAt && <button type="button" className="guide-btn guide-btn-primary" disabled={busy} onClick={() => toggle(true)}>{busy ? "salvando…" : "Feito e seguir ›"}</button>}
              {item?.doneAt && index < items.length - 1 && <button type="button" className="guide-btn guide-btn-primary" disabled={busy} onClick={() => setIndex(index + 1)}>próximo ›</button>}
            </footer>}
          </main>
          <CustomerPanel kit={kit} />
        </div>
      </>}
  </Modal>, document.body);
}
