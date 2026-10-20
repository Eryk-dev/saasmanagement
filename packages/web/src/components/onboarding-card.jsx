// Card da Integração (Lever CRM, Fase 1B): a integração é registro do CLIENTE,
// separada do ganho. Mesmo desenho de gaveta do card do cliente
// (customer-peek), com etapa, checklist com o lado da Lever e o do cliente,
// kickoff, go-live, integrador e a linha do tempo do cliente. Abre de
// qualquer tela por lib/open-record.js.

import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../lib/api.js";
import { Drawer } from "./overlay.jsx";
import { SelectPopover } from "./select-popover.jsx";
import { DateTimeField } from "./datetime-field.jsx";
import { Checkbox } from "./form-controls.jsx";
import { RecordTimeline } from "./record-timeline.jsx";
import { allUsers, displayName } from "../lib/users.js";
import { openCustomer, openLeadById } from "../lib/open-record.js";
import { toast } from "../atoms.jsx";
// O desenho de gaveta do card do cliente: estes blocos também abrem fora da
// tela de Clientes (card do Negócio, card da Integração).
import "../screens/customers.css";

export const ONBOARDING_STAGES = [
  { value: "aguardando_kickoff", label: "Aguardando kickoff", tone: "warn" },
  { value: "kickoff", label: "Kickoff realizado", tone: "info" },
  { value: "configuracao", label: "Configuração / migração", tone: "info" },
  { value: "treinamento", label: "Treinamento", tone: "info" },
  { value: "go_live", label: "Go-live", tone: "pos" },
  { value: "concluida", label: "Concluída", tone: "pos" },
  { value: "cancelada", label: "Cancelada", tone: "neg" },
];
export const ONBOARDING_KINDS = [
  { value: "implantacao", label: "Implantação inicial" },
  { value: "novo_produto", label: "Produto novo" },
  { value: "reintegracao", label: "Reintegração" },
  { value: "migracao", label: "Migração" },
  { value: "treinamento", label: "Treinamento" },
];
export const stageLabel = (v) => ONBOARDING_STAGES.find((s) => s.value === v)?.label || v;
export const kindLabel = (v) => ONBOARDING_KINDS.find((k) => k.value === v)?.label || v;
const TONE = { pos: "pos", neg: "neg" };
const isoToLocal = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
const progressOf = (items) => (items.length ? Math.round((items.filter((i) => i.doneAt).length / items.length) * 100) : 0);

export function OnboardingDrawer({ id, onClose }) {
  const [o, setO] = useState(null);
  const [customer, setCustomer] = useState(null);
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [newItem, setNewItem] = useState({ title: "", side: "lever" });

  useEffect(() => {
    let alive = true;
    api.onboarding(id).then(async (row) => {
      if (!alive) return;
      setO(row);
      setDraft(row);
      const c = await api.get("customers", row.customer).catch(() => null);
      if (alive) setCustomer(c);
    }).catch((e) => alive && setError(e.message || "Integração não encontrada."));
    return () => { alive = false; };
  }, [id]);

  const set = (patch) => setDraft((d) => ({ ...d, ...patch }));
  const dirty = o && draft && JSON.stringify(o) !== JSON.stringify(draft);
  const items = draft?.items || [];
  const pending = items.filter((i) => !i.doneAt).length;

  async function save() {
    if (busy || !dirty) return;
    setBusy(true);
    setError("");
    try {
      const saved = await api.updateOnboarding(o.id, {
        stage: draft.stage, kind: draft.kind, integrator: draft.integrator || "", notes: draft.notes || "",
        kickoffAt: draft.kickoffAt || "", plannedGoLiveAt: draft.plannedGoLiveAt || "", items,
      });
      setO(saved);
      setDraft(saved);
      toast("Integração salva", "pos");
    } catch (e) {
      setError(e.message || "Não foi possível salvar.");
    } finally {
      setBusy(false);
    }
  }

  function addItem() {
    const title = newItem.title.trim();
    if (!title) return;
    set({ items: [...items, { id: "", title, side: newItem.side, dueAt: "", doneAt: "" }] });
    setNewItem({ title: "", side: newItem.side });
  }

  const close = () => {
    if (dirty && !window.confirm("Descartar as mudanças nesta integração?")) return;
    onClose();
  };
  const stage = ONBOARDING_STAGES.find((s) => s.value === draft?.stage);
  const users = allUsers().map((u) => ({ value: u.id, label: u.name || u.id }));

  return createPortal(
    <Drawer onClose={close} fechavel={!busy} label="Integração" largura={460} style={{ background: "transparent", padding: 0 }}
      painelStyle={{ position: "fixed", right: 26, top: 90, bottom: 26, height: "auto", maxWidth: "calc(100vw - 28px)", overflow: "hidden" }}>
      <div className="customer-peek">
        <header className="customer-peek-head">
          <div>
            <div className="customer-peek-title"><h2>{draft ? kindLabel(draft.kind) : "Integração"}</h2></div>
            <p>{customer ? <button type="button" className="customer-peek-link" onClick={() => { onClose(); openCustomer(customer.id); }}>{customer.name} →</button> : (draft ? "cliente" : "")}</p>
          </div>
          <button aria-label="Fechar integração" onClick={close} disabled={busy}>✕</button>
        </header>
        {!draft && <div className="customer-peek-body"><p className="customer-peek-note" role={error ? "alert" : "status"}>{error || "carregando…"}</p></div>}
        {draft && <div className="customer-peek-body">
          <section>
            <div className="customer-peek-kicker"><span>etapa</span><span className="customer-peek-state" data-tone={TONE[stage?.tone] || "mut"}>{progressOf(items)}% do checklist</span></div>
            <div style={{ marginTop: 10 }}><SelectPopover value={draft.stage} options={ONBOARDING_STAGES} onChange={(v) => set({ stage: v })} label="Etapa da integração" /></div>
            {draft.stage === "concluida" && pending > 0 && <p className="customer-peek-note" role="alert" style={{ color: "var(--neg)" }}>Faltam {pending} {pending === 1 ? "item" : "itens"} do checklist: a integração só conclui com tudo feito.</p>}
            <div className="customer-peek-bar"><i style={{ width: `${progressOf(items)}%`, background: "var(--accent)" }} /></div>
          </section>
          <section>
            <div className="customer-peek-kicker"><span>quando e quem</span></div>
            <div className="customer-peek-fact"><span>Tipo</span><strong><SelectPopover size="sm" value={draft.kind} options={ONBOARDING_KINDS} onChange={(v) => set({ kind: v })} label="Tipo de integração" /></strong></div>
            <div className="customer-peek-fact"><span>Integrador</span><strong><SelectPopover size="sm" value={draft.integrator || ""} options={[{ value: "", label: "sem integrador" }, ...users]} onChange={(v) => set({ integrator: v })} label="Integrador" /></strong></div>
            <div className="customer-peek-fact"><span>Kickoff</span><strong><DateTimeField value={isoToLocal(draft.kickoffAt)} onChange={(v) => set({ kickoffAt: v ? new Date(v).toISOString() : "" })} /></strong></div>
            <div className="customer-peek-fact"><span>Go-live previsto</span><strong><DateTimeField withTime={false} value={draft.plannedGoLiveAt ? isoToLocal(draft.plannedGoLiveAt).slice(0, 10) : ""} onChange={(v) => set({ plannedGoLiveAt: v ? new Date(`${v}T12:00`).toISOString() : "" })} /></strong></div>
            {draft.goLiveAt && <div className="customer-peek-fact"><span>Go-live real</span><strong>{new Date(draft.goLiveAt).toLocaleDateString("pt-BR")}</strong></div>}
            {draft.lead && <div className="customer-peek-fact"><span>Negócio de origem</span><strong><button type="button" className="customer-peek-link" onClick={() => { onClose(); openLeadById(draft.lead); }}>abrir negócio →</button></strong></div>}
          </section>
          <section>
            <div className="customer-peek-kicker"><span>checklist</span><b>{items.length - pending} de {items.length}</b></div>
            <div className="customer-peek-checks">
              {items.map((it, i) => <div key={it.id || `novo-${i}`} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 4px" }}>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <Checkbox checked={!!it.doneAt} onChange={(v) => set({ items: items.map((x, j) => (j === i ? { ...x, doneAt: v ? new Date().toISOString() : "" } : x)) })}>
                    <span style={{ fontSize: 12.5, color: it.doneAt ? "var(--fg-4)" : "var(--fg-2)", textDecoration: it.doneAt ? "line-through" : "none" }}>{it.title}</span>
                  </Checkbox>
                </span>
                <span className="mono dim" style={{ fontSize: 11 }}>{it.side === "cliente" ? "cliente" : "Lever"}</span>
                <button type="button" aria-label={`Tirar ${it.title}`} title="Tirar do checklist" onClick={() => set({ items: items.filter((_, j) => j !== i) })} style={{ color: "var(--fg-4)" }}>✕</button>
              </div>)}
              {!items.length && <p className="customer-peek-note">Sem itens: monte o checklist do que a Lever e o cliente precisam entregar.</p>}
            </div>
            <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
              <input className="inp" style={{ flex: 1 }} placeholder="novo item…" value={newItem.title} onChange={(e) => setNewItem({ ...newItem, title: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter") addItem(); }} />
              <SelectPopover size="sm" value={newItem.side} options={[{ value: "lever", label: "Lever" }, { value: "cliente", label: "cliente" }]} onChange={(v) => setNewItem({ ...newItem, side: v })} label="De quem é o item" />
              <button type="button" className="customer-peek-link" onClick={addItem} disabled={!newItem.title.trim()}>incluir</button>
            </div>
          </section>
          <section>
            <div className="customer-peek-kicker"><span>notas</span></div>
            <textarea className="inp" rows={3} style={{ width: "100%", marginTop: 8, height: "auto", padding: 8 }} value={draft.notes || ""} onChange={(e) => set({ notes: e.target.value })} placeholder="combinados, acessos, pendências…" />
          </section>
          {customer && <section>
            <div className="customer-peek-kicker"><span>linha do tempo do cliente</span></div>
            <RecordTimeline customerId={customer.id} limit={5} />
          </section>}
          {error && <p role="alert" className="customer-peek-feedback">{error}</p>}
        </div>}
        <footer className="customer-peek-footer">
          <button disabled={busy || !dirty} onClick={save}>{busy ? "Salvando…" : dirty ? "Salvar integração" : "Sem mudanças"}</button>
          {draft && <button type="button" disabled={busy} onClick={close}>Fechar</button>}
        </footer>
      </div>
    </Drawer>, document.body);
}

// Lista de integrações de um cliente, com "Nova integração" (sem negócio novo).
export function CustomerOnboardings({ customer, onOpen }) {
  const [rows, setRows] = useState(null);
  const [creating, setCreating] = useState(false);
  const [kind, setKind] = useState("novo_produto");
  const [busy, setBusy] = useState(false);
  const load = () => api.customerOnboardings(customer.id).then((r) => setRows(r.onboardings || [])).catch(() => setRows([]));
  useEffect(() => { load(); }, [customer.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function create() {
    if (busy) return;
    setBusy(true);
    try {
      const o = await api.createOnboarding(customer.id, { kind });
      setCreating(false);
      await load();
      onOpen(o.id);
    } catch (e) {
      toast(`${e.message || "Não foi possível abrir a integração"} · tente de novo`, "neg");
    } finally {
      setBusy(false);
    }
  }
  const open = (rows || []).filter((o) => !["concluida", "cancelada"].includes(o.stage));
  return <section className="customer-peek-onboardings">
    <div className="customer-peek-kicker"><span>integrações</span>{rows && <b>{open.length ? `${open.length} em andamento` : "nenhuma aberta"}</b>}</div>
    {rows === null && <p className="customer-peek-note mono dim">carregando…</p>}
    {(rows || []).map((o) => <div key={o.id} className="customer-peek-fact">
      <span>{kindLabel(o.kind)}</span>
      <strong><button type="button" className="customer-peek-link" onClick={() => onOpen(o.id)}>{stageLabel(o.stage)} · {o.progress ?? 0}% →</button>
        {o.integrator && <em style={{ display: "block", fontStyle: "normal", fontSize: 11, color: "var(--fg-4)", fontWeight: 400 }}>{displayName(o.integrator)}</em>}</strong>
    </div>)}
    {creating
      ? <div style={{ display: "flex", gap: 6, marginTop: 10, alignItems: "center" }}>
        <SelectPopover size="sm" value={kind} options={ONBOARDING_KINDS} onChange={setKind} label="Tipo de integração" />
        <button type="button" className="customer-peek-link" onClick={create} disabled={busy}>{busy ? "abrindo…" : "abrir"}</button>
        <button type="button" className="customer-peek-link" style={{ color: "var(--fg-3)" }} onClick={() => setCreating(false)} disabled={busy}>cancelar</button>
      </div>
      : <button type="button" className="customer-peek-action" onClick={() => setCreating(true)}>Nova integração</button>}
  </section>;
}
