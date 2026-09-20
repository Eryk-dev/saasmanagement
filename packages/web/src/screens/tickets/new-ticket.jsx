import React from "react";
import { createPortal } from "react-dom";
import { api } from "../../lib/api.js";
import { PrimaryButton, SecondaryButton, toast } from "../../atoms.jsx";
import { Modal } from "../../components/overlay.jsx";
import { SelectPopover } from "../../components/select-popover.jsx";
import { TICKET_PRIORITIES, agentHandles } from "../../lib/tickets.js";

const { useState, useEffect, useMemo } = React;

// Abrir ticket pela equipe (fila ou ficha do cliente). Escolher o cliente
// preenche o solicitante com o contato dele; o servidor valida produto,
// cliente e responsável e já calcula o SLA.
export function NewTicketModal({ saasId, initial = {}, agents = null, categories = null, onClose, onCreated }) {
  const [form, setForm] = useState(() => ({
    subject: "", description: "", priority: "normal", category: "", assignee: "",
    customerId: initial.customerId || "", requester: { name: "", email: "", phone: "" }, ...initial,
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = React.useRef(false);
  const dirty = React.useRef(false);
  const close = () => { if (pending.current) return; if (dirty.current && !window.confirm("Descartar o ticket que você está preenchendo?")) return; onClose(); };
  const [loaded, setLoaded] = useState({ agents, categories });
  const set = (patch) => { dirty.current = true; setForm((f) => ({ ...f, ...patch })); };
  const setReq = (patch) => { dirty.current = true; setForm((f) => ({ ...f, requester: { ...f.requester, ...patch } })); };

  // Aberto da ficha do cliente, a tela não tem os atendentes/categorias em mãos.
  useEffect(() => {
    if (agents && categories) return;
    let vivo = true;
    Promise.all([agents ? agents : api.supportAgents().catch(() => []), categories ? { categories } : api.supportSettings(saasId).catch(() => ({ categories: [] }))])
      .then(([a, s]) => { if (vivo) setLoaded({ agents: a || [], categories: s?.categories || [] }); });
    return () => { vivo = false; };
  }, [agents, categories, saasId]);

  const customers = useMemo(() => (window.SEED?.CUSTOMERS || []).filter((c) => c.saas === saasId).sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "pt-BR")), [saasId]);
  const customer = customers.find((c) => c.id === form.customerId);
  useEffect(() => {
    if (!customer) return;
    setForm((f) => ({ ...f, requester: {
      name: f.requester.name || customer.contact || customer.name || "",
      email: f.requester.email || customer.email || "",
      phone: f.requester.phone || customer.phone || "",
    } }));
  }, [customer?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const assignable = (loaded.agents || []).filter((a) => agentHandles(a, saasId));

  const submit = async (e) => {
    e?.preventDefault?.();
    if (pending.current) return;
    if (!form.subject.trim()) { setError("Escreva o assunto do ticket."); return; }
    pending.current = true; setBusy(true); setError("");
    try {
      const created = await api.ticketCreate({ ...form, saas: saasId, subject: form.subject.trim() });
      toast(`Ticket #${created.number} aberto`, "pos");
      onCreated && onCreated(created);
    } catch (err) {
      setError(err.message || "Não deu pra abrir o ticket.");
    } finally { pending.current = false; setBusy(false); }
  };

  // Seletor não mora dentro de <label>: o clique na opção do popover subiria
  // até o label e reabriria a lista. Campo de texto continua com <label>.
  const label = (text, child, full = false, asLabel = true) => {
    const Tag = asLabel ? "label" : "div";
    return (
      <Tag style={{ display: "flex", flexDirection: "column", gap: 4, gridColumn: full ? "1 / -1" : undefined, minWidth: 0 }}>
        <span className="kicker">{text}</span>{child}
      </Tag>
    );
  };
  const panel = (
    <Modal onClose={close} fechavel={!busy} label="Novo ticket" largura={620}>
      <form className="ticket-new-form" onChange={() => { dirty.current = true; }} onSubmit={submit} style={{ padding: "20px var(--inset-x)", display: "flex", flexDirection: "column", gap: 14 }}>
        <div>
          <h2 className="card-title" style={{ margin: 0 }}>Novo ticket</h2>
          <div className="card-sub" style={{ marginTop: 3 }}>o prazo de SLA começa a contar quando o ticket é aberto</div>
        </div>
        <fieldset disabled={busy} style={{ margin: 0, padding: 0, border: 0, minWidth: 0, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(220px, 100%), 1fr))", gap: 12 }}>
          {label("Assunto", <input className="inp" autoFocus value={form.subject} maxLength={200} onChange={(e) => set({ subject: e.target.value })} placeholder="Ex.: não consigo acessar o painel" />, true)}
          {label("Cliente", (
            <SelectPopover label="Cliente" value={form.customerId} onChange={(v) => set({ customerId: v })} searchable={customers.length > 6}
              options={[{ value: "", label: "sem cliente vinculado", color: "var(--fg-3)" }, ...customers.map((c) => ({ value: c.id, label: c.name, hint: c.contact || "" }))]} />
          ), false, false)}
          {label("Solicitante", <input className="inp" value={form.requester.name} onChange={(e) => setReq({ name: e.target.value })} placeholder="nome de quem pediu" />)}
          {label("E-mail", <input className="inp" type="email" value={form.requester.email} onChange={(e) => setReq({ email: e.target.value })} placeholder="recebe o link do portal" />)}
          {label("Telefone", <input type="tel" className="inp" value={form.requester.phone} onChange={(e) => setReq({ phone: e.target.value })} />)}
          {label("Prioridade", (
            <SelectPopover label="Prioridade" value={form.priority} onChange={(v) => set({ priority: v })}
              options={TICKET_PRIORITIES.map((p) => ({ value: p.key, label: p.label, tone: p.tone, color: p.key === "urgent" ? "var(--neg)" : undefined }))} />
          ), false, false)}
          {label("Categoria", (
            <SelectPopover label="Categoria" value={form.category} onChange={(v) => set({ category: v })}
              options={[{ value: "", label: "sem categoria", color: "var(--fg-3)" }, ...(loaded.categories || []).map((c) => ({ value: c, label: c }))]} />
          ), false, false)}
          {label("Responsável", (
            <SelectPopover label="Responsável" value={form.assignee} onChange={(v) => set({ assignee: v })}
              options={[{ value: "", label: "sem responsável (avisa os atendentes)", color: "var(--fg-3)" }, ...assignable.map((a) => ({ value: a.id, label: a.name }))]} />
          ), false, false)}
          {label("Descrição", <textarea className="inp" rows={4} value={form.description} onChange={(e) => set({ description: e.target.value })} placeholder="o que aconteceu, desde quando, prints ou links" style={{ height: "auto", padding: "8px 10px", resize: "vertical", font: "inherit", fontSize: 13 }} />, true)}
        </fieldset>
        {error && <div role="alert" style={{ fontSize: 12.5, color: "var(--neg)" }}>{error}</div>}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <SecondaryButton type="button" onClick={close} disabled={busy}>Cancelar</SecondaryButton>
          <PrimaryButton type="submit" disabled={busy}>{busy ? "Abrindo…" : "Abrir ticket"}</PrimaryButton>
        </div>
      </form>
    </Modal>
  );
  return typeof document !== "undefined" && document.body?.nodeType === 1 ? createPortal(panel, document.body) : panel;
}
