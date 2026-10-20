// Blocos do Lever CRM no card do Cliente. Desenho de 20/10/2026, depois do
// "não entendi": em vez de quatro blocos soltos (integrações, acompanhamento,
// negócios, reuniões), cada um com o seu seletor, o card tem UM bloco "Em
// andamento" com o que está aberto e UM botão "+ novo" para abrir o resto.
// Os estados (estágio de vida, financeiro) ficam em chips no cabeçalho.

import React, { useEffect, useRef, useState } from "react";
import { api } from "../lib/api.js";
import { openLeadById, openOnboarding, openRecord } from "../lib/open-record.js";
import { displayName } from "../lib/users.js";
import { Popover } from "./popover.jsx";
import { toast } from "../atoms.jsx";
import { createExtraDeal } from "./deal-meta.jsx";
import { summaryReason } from "./customer-meeting.jsx";
// O desenho de gaveta do card do cliente: estes blocos também abrem fora da
// tela de Clientes (card do Negócio, card da Integração).
import "../screens/customers.css";

export const LIFECYCLE = {
  integracao: { label: "em integração", tone: "mut" },
  ativo: { label: "ativo", tone: "pos" },
  risco: { label: "em risco", tone: "neg" },
  churn: { label: "churn", tone: "neg" },
};
export const FINANCIAL = {
  aguardando_pagamento: { label: "aguardando 1º pagamento", tone: "mut" },
  adimplente: { label: "pagamento em dia", tone: "pos" },
  inadimplente: { label: "inadimplente", tone: "neg" },
};
const ROLE = { decisor: "decisor", financeiro: "financeiro", usuario: "usuário", ponto_focal: "ponto focal" };
const KIND = { implantacao: "Implantação", novo_produto: "Produto novo", reintegracao: "Reintegração", migracao: "Migração", treinamento: "Treinamento" };
const STAGE = { aguardando_kickoff: "aguardando kickoff", kickoff: "kickoff feito", configuracao: "configuração", treinamento: "treinamento", go_live: "go-live" };
const FOLLOWUP = { check_in: "Check-in", qbr: "QBR", renovacao: "Renovação", risco: "Conversa de risco" };
const DEAL = { upsell: "upsell", renovacao: "renovação", reativacao: "reativação" };
const NEW_DEAL = { upsell: "Novo upsell", renovacao: "Nova renovação", reativacao: "Nova reativação" };
const day = (iso) => (iso ? new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }) : "");
const when = (iso) => new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const hostSegment = (h) => (h?.collection === "onboardings" ? "onboardings" : "followups");

// Os dois estados na mesma linha, no desenho de estado do customer-peek.
export function CustomerStateChips({ customer }) {
  const life = LIFECYCLE[customer?.lifecycle];
  const fin = FINANCIAL[customer?.financialStatus];
  if (!life && !fin) return null;
  return <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
    {life && <span className="customer-peek-state" style={{ marginLeft: 0 }} data-tone={life.tone} title="Estágio de vida do cliente">{life.label}</span>}
    {fin && <span className="customer-peek-state" style={{ marginLeft: 0 }} data-tone={fin.tone} title="Status financeiro (não corta acesso)">{fin.label}</span>}
  </div>;
}

// "+ novo": a lista de tudo que se abre a partir do cliente, num lugar só.
function AddMenu({ groups, busy }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  return <>
    <button ref={ref} type="button" disabled={busy} onClick={() => setOpen((v) => !v)} aria-haspopup="menu" aria-expanded={open}
      style={{ marginLeft: "auto", height: 24, padding: "0 10px", borderRadius: 999, border: "1px solid var(--line-2)", background: "var(--bg-1)", color: "var(--fg-1)", fontSize: 11.5, fontWeight: 600, letterSpacing: "normal", textTransform: "none", cursor: "pointer" }}>
      {busy ? "abrindo…" : "+ novo"}
    </button>
    {open && <Popover anchor={ref} onClose={() => setOpen(false)} width={230} align="end" label="Abrir para o cliente">
      {groups.map(([title, items]) => <div key={title} style={{ padding: "4px 0" }}>
        <div className="kicker" style={{ padding: "4px 10px" }}>{title}</div>
        {items.map((i) => <button key={i.label} type="button" onClick={() => { setOpen(false); i.onClick(); }}
          style={{ display: "block", width: "100%", textAlign: "left", padding: "7px 10px", borderRadius: "var(--r-2)", fontSize: 12.5, color: "var(--fg-2)", background: "transparent", border: 0, cursor: "pointer" }}>
          {i.label}
        </button>)}
      </div>)}
    </Popover>}
  </>;
}

function Row({ label, children, onClick, sub }) {
  return <div className="customer-peek-fact" style={{ alignItems: "flex-start" }}>
    <span>{label}</span>
    <strong>
      {onClick ? <button type="button" className="customer-peek-link" onClick={onClick}>{children} →</button> : children}
      {sub && <em style={{ display: "block", fontStyle: "normal", fontSize: 11, fontWeight: 400, color: "var(--fg-4)" }}>{sub}</em>}
    </strong>
  </div>;
}

// "Em andamento": as integrações abertas, os acompanhamentos abertos, a
// próxima reunião e a reunião passada sem resumo. Tudo abre o próprio card.
export function CustomerNow({ customer, lead, onLeave, onScheduleMeeting }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = () => Promise.all([
    api.customerOnboardings(customer.id).catch(() => null),
    api.customerFollowups(customer.id).catch(() => null),
    api.customerRecordMeetings(customer.id).catch(() => null),
  ]).then(([o, f, m]) => setData({ onboardings: (o && o.onboardings) || [], followups: (f && f.followups) || [], meetings: (m && m.meetings) || [] }));
  useEffect(() => { setData(null); load(); }, [customer.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const go = (fn) => { onLeave?.(); fn(); };
  async function run(fn, errorText) {
    if (busy) return;
    setBusy(true);
    try { await fn(); } catch (e) { toast(`${e.message || errorText} · tente de novo`, "neg"); } finally { setBusy(false); }
  }
  const newOnboarding = () => run(async () => {
    const kind = (data?.onboardings || []).length ? "novo_produto" : "implantacao";
    const o = await api.createOnboarding(customer.id, { kind });
    go(() => openOnboarding(o.id));
  }, "Não foi possível abrir a integração");
  const newFollowup = (kind) => run(async () => {
    const f = await api.createFollowup(customer.id, { kind });
    go(() => openRecord("followup", f.id));
  }, "Não foi possível abrir o acompanhamento");
  const newDeal = (type) => run(async () => { onLeave?.(); await createExtraDeal(customer, type); }, "Não foi possível abrir o negócio");

  const now = Date.now();
  const onboardings = (data?.onboardings || []).filter((o) => !["concluida", "cancelada"].includes(o.stage));
  const followups = (data?.followups || []).filter((f) => f.status === "aberto");
  const live = (data?.meetings || []).filter((m) => m.status === "scheduled");
  const next = live.filter((m) => Date.parse(m.at) > now).sort((a, b) => Date.parse(a.at) - Date.parse(b.at))[0];
  const pending = live.find((m) => !m.summaryAt && m.meetUrl && Date.parse(m.at) + 50 * 60_000 < now);
  const legacy = !next && lead?.integrationAt && Date.parse(lead.integrationAt) > now ? lead : null;
  const empty = data && !onboardings.length && !followups.length && !next && !legacy && !pending;

  async function summarize() {
    await run(async () => {
      const r = await api.summarizeRecordMeeting(hostSegment(pending.host), pending.host.id, pending.id);
      if (r?.ok) { toast("Resumo pronto", "pos"); await load(); } else toast(`Sem resumo: ${summaryReason(r)}`, "warn");
    }, "Falha ao gerar o resumo");
  }

  const groups = [
    ["Integração", [{ label: (data?.onboardings || []).length ? "Nova integração (produto novo)" : "Nova integração", onClick: newOnboarding }]],
    ["Acompanhamento", Object.entries(FOLLOWUP).map(([k, l]) => ({ label: l, onClick: () => newFollowup(k) }))],
    ["Reunião", [{ label: "Marcar reunião", onClick: onScheduleMeeting }]],
    ["Negócio", Object.entries(NEW_DEAL).map(([k, l]) => ({ label: l, onClick: () => newDeal(k) }))],
  ];

  return <section>
    <div className="customer-peek-kicker"><span>em andamento</span><AddMenu groups={groups} busy={busy} /></div>
    {data === null && <p className="customer-peek-note mono dim">carregando…</p>}
    {empty && <p className="customer-peek-note">Nada aberto agora. Use "+ novo" para abrir integração, acompanhamento, reunião ou negócio.</p>}
    {onboardings.map((o) => <Row key={o.id} label={`Integração · ${KIND[o.kind] || o.kind}`} onClick={() => go(() => openOnboarding(o.id))}
      sub={o.integrator ? displayName(o.integrator) : "sem integrador"}>{STAGE[o.stage] || o.stage} · {o.progress ?? 0}%</Row>)}
    {followups.map((f) => <Row key={f.id} label={FOLLOWUP[f.kind] || f.kind} onClick={() => go(() => openRecord("followup", f.id))}
      sub={f.owner ? displayName(f.owner) : "sem dono"}>{f.dueAt ? `até ${day(f.dueAt)}` : "sem prazo"}</Row>)}
    {next && <Row label="Próxima reunião" sub={next.host.label}>
      {when(next.at)}{next.meetUrl ? <> · <a className="customer-peek-link" href={next.meetUrl} target="_blank" rel="noopener noreferrer">Meet ↗</a></> : null}
    </Row>}
    {legacy && <Row label="Próxima reunião" sub="implantação (no negócio)">
      {when(legacy.integrationAt)}{legacy.integrationCallUrl ? <> · <a className="customer-peek-link" href={legacy.integrationCallUrl} target="_blank" rel="noopener noreferrer">Meet ↗</a></> : null}
    </Row>}
    {pending && <div className="customer-peek-pending">
      <span>{`Reunião de ${day(pending.at)} sem resumo`}</span>
      <button type="button" onClick={summarize} disabled={busy}>{busy ? "Gerando…" : "Gerar resumo"}</button>
    </div>}
  </section>;
}

// Negócios do cliente: a venda de origem e os que vieram depois. Cada um abre
// o card do Negócio. Criar mora no "+ novo" do bloco Em andamento.
export function CustomerDeals({ customer, onLeave }) {
  const leads = (window.SEED?.LEADS || []).filter((l) => l.id === customer.leadId || l.customerId === customer.id);
  if (!leads.length) return null;
  return <section>
    <div className="customer-peek-kicker"><span>negócios</span><b>{leads.length}</b></div>
    {leads.map((l) => <Row key={l.id} label={l.id === customer.leadId ? "venda de origem" : DEAL[l.dealType] || "negócio"}
      onClick={() => { onLeave?.(); openLeadById(l.id); }}>{l.stage || "—"}{l.closer ? ` · ${displayName(l.closer)}` : ""}</Row>)}
  </section>;
}

// Empresa e contatos com papel (perfil do cliente). Só leitura aqui.
export function CustomerContacts({ customer }) {
  const [profile, setProfile] = useState(null);
  useEffect(() => {
    let alive = true;
    api.customerProfile(customer.id).then((p) => alive && setProfile(p || {})).catch(() => alive && setProfile({}));
    return () => { alive = false; };
  }, [customer.id, customer.lifecycle, customer.financialStatus]);
  const company = profile?.company || {};
  const contacts = profile?.contacts || [];
  if (!profile || (!contacts.length && !company.cnpj)) return null;
  return <section>
    <div className="customer-peek-kicker"><span>empresa e contatos</span></div>
    {company.cnpj && <Row label={company.legalName || "Razão social"}><span className="tnum">{company.cnpj}</span></Row>}
    {contacts.map((c) => <Row key={c.email || c.phone || c.name} label={[ROLE[c.role] || (c.primary ? "principal" : "contato"), c.leverId ? "LeverId" : ""].filter(Boolean).join(" · ")}
      sub={c.email && c.name ? c.email : ""}>{c.name || c.email}</Row>)}
  </section>;
}
