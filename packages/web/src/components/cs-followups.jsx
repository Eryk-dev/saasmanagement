// Acompanhamento de CS (Lever CRM, Fase 3): check-in, QBR, renovação ou
// conversa de risco, com dono, prazo, sentimento, próximos passos e reunião.
// A seção do card do cliente lista os abertos e cria; a gaveta edita, fecha e
// marca reunião. Mesmo desenho do customer-peek.

import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../lib/api.js";
import { Drawer } from "./overlay.jsx";
import { SelectPopover } from "./select-popover.jsx";
import { DateTimeField } from "./datetime-field.jsx";
import { RecordMeetings } from "./record-meetings.jsx";
import { RecordTimeline } from "./record-timeline.jsx";
import { allUsers, displayName } from "../lib/users.js";
import { openCustomer, openRecord } from "../lib/open-record.js";
import { toast } from "../atoms.jsx";
import "../screens/customers.css";

export const FOLLOWUP_KINDS = [
  { value: "check_in", label: "Check-in" },
  { value: "qbr", label: "QBR" },
  { value: "renovacao", label: "Renovação" },
  { value: "risco", label: "Conversa de risco" },
];
const SENTIMENTS = [
  { value: "", label: "sem registro" },
  { value: "positivo", label: "positivo", tone: "pos" },
  { value: "neutro", label: "neutro" },
  { value: "negativo", label: "negativo", tone: "neg" },
];
const kindLabel = (v) => FOLLOWUP_KINDS.find((k) => k.value === v)?.label || v;
const day = (iso) => (iso ? new Date(iso).toLocaleDateString("pt-BR") : "sem prazo");
const isoToDay = (iso) => (iso ? new Date(iso).toISOString().slice(0, 10) : "");
export const openFollowup = (id) => openRecord("followup", id);

export function CustomerFollowups({ customer, onLeave }) {
  const [rows, setRows] = useState(null);
  const [kind, setKind] = useState("check_in");
  const [busy, setBusy] = useState(false);
  const load = () => api.customerFollowups(customer.id).then((r) => setRows(r.followups || [])).catch(() => setRows([]));
  useEffect(() => { load(); }, [customer.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const open = (rows || []).filter((f) => f.status === "aberto").sort((a, b) => String(a.dueAt || "9").localeCompare(String(b.dueAt || "9")));

  async function create() {
    if (busy) return;
    setBusy(true);
    try {
      const f = await api.createFollowup(customer.id, { kind });
      onLeave?.();
      openFollowup(f.id);
    } catch (e) {
      toast(`${e.message || "Não foi possível abrir o acompanhamento"} · tente de novo`, "neg");
    } finally {
      setBusy(false);
    }
  }

  return <section>
    <div className="customer-peek-kicker"><span>acompanhamento</span>{rows && <b>{open.length ? `${open.length} aberto${open.length === 1 ? "" : "s"}` : "nada aberto"}</b>}</div>
    {rows === null && <p className="customer-peek-note mono dim">carregando…</p>}
    {open.map((f) => <div key={f.id} className="customer-peek-fact">
      <span>{kindLabel(f.kind)}</span>
      <strong><button type="button" className="customer-peek-link" onClick={() => { onLeave?.(); openFollowup(f.id); }}>{day(f.dueAt)}{f.owner ? ` · ${displayName(f.owner)}` : ""} →</button></strong>
    </div>)}
    <div style={{ display: "flex", gap: 6, marginTop: 10, alignItems: "center" }}>
      <div style={{ flex: 1, minWidth: 0 }}><SelectPopover size="sm" value={kind} options={FOLLOWUP_KINDS} onChange={setKind} label="Tipo de acompanhamento" /></div>
      <button type="button" className="customer-peek-link" onClick={create} disabled={busy}>{busy ? "abrindo…" : "novo acompanhamento"}</button>
    </div>
  </section>;
}

export function FollowupDrawer({ id, onClose }) {
  const [f, setF] = useState(null);
  const [draft, setDraft] = useState(null);
  const [customer, setCustomer] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    (async () => {
      const row = await api.followup(id).catch(() => null);
      if (!alive) return;
      if (!row) { setError("Acompanhamento não encontrado."); return; }
      setF(row);
      setDraft(row);
      const c = await api.get("customers", row.customer).catch(() => null);
      if (alive) setCustomer(c);
    })();
    return () => { alive = false; };
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (patch) => setDraft((d) => ({ ...d, ...patch }));
  const dirty = f && draft && JSON.stringify(f) !== JSON.stringify(draft);

  async function save(extra = {}) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const saved = await api.updateFollowup(f.id, {
        kind: draft.kind, owner: draft.owner || "", dueAt: draft.dueAt || "", sentiment: draft.sentiment || "",
        notes: draft.notes || "", nextSteps: draft.nextSteps || "", ...extra,
      });
      setF(saved);
      setDraft(saved);
      toast(extra.status === "feito" ? "Acompanhamento concluído" : "Acompanhamento salvo", "pos");
      if (extra.status) onClose();
    } catch (e) {
      setError(e.message || "Não foi possível salvar.");
    } finally {
      setBusy(false);
    }
  }
  async function reloadMeetings() {
    const fresh = await api.followup(id).catch(() => null);
    if (!fresh) return;
    setF((p) => ({ ...p, meetings: fresh.meetings }));
    setDraft((d) => ({ ...d, meetings: fresh.meetings }));
  }
  const close = () => { if (dirty && !window.confirm("Descartar as mudanças neste acompanhamento?")) return; onClose(); };
  const users = allUsers().map((u) => ({ value: u.id, label: u.name || u.id }));

  return createPortal(
    <Drawer onClose={close} fechavel={!busy} label="Acompanhamento" largura={440} style={{ background: "transparent", padding: 0 }}
      painelStyle={{ position: "fixed", right: 26, top: 90, bottom: 26, height: "auto", maxWidth: "calc(100vw - 28px)", overflow: "hidden" }}>
      <div className="customer-peek">
        <header className="customer-peek-head">
          <div>
            <div className="customer-peek-title"><h2>{draft ? kindLabel(draft.kind) : "Acompanhamento"}</h2></div>
            <p>{customer ? <button type="button" className="customer-peek-link" onClick={() => { onClose(); openCustomer(customer.id); }}>{customer.name} →</button> : ""}</p>
          </div>
          <button aria-label="Fechar acompanhamento" onClick={close} disabled={busy}>✕</button>
        </header>
        {!draft && <div className="customer-peek-body"><p className="customer-peek-note" role={error ? "alert" : "status"}>{error || "carregando…"}</p></div>}
        {draft && <div className="customer-peek-body">
          <section>
            <div className="customer-peek-kicker"><span>o quê, quando e quem</span></div>
            <div className="customer-peek-fact"><span>Tipo</span><strong><SelectPopover size="sm" value={draft.kind} options={FOLLOWUP_KINDS} onChange={(v) => set({ kind: v })} label="Tipo" /></strong></div>
            <div className="customer-peek-fact"><span>Dono</span><strong><SelectPopover size="sm" value={draft.owner || ""} options={[{ value: "", label: "sem dono" }, ...users]} onChange={(v) => set({ owner: v })} label="Dono" /></strong></div>
            <div className="customer-peek-fact"><span>Prazo</span><strong><DateTimeField withTime={false} value={isoToDay(draft.dueAt)} onChange={(v) => set({ dueAt: v ? new Date(`${v}T12:00`).toISOString() : "" })} /></strong></div>
            <div className="customer-peek-fact"><span>Sentimento</span><strong><SelectPopover size="sm" value={draft.sentiment || ""} options={SENTIMENTS} onChange={(v) => set({ sentiment: v })} label="Sentimento do cliente" /></strong></div>
          </section>
          <RecordMeetings host="followups" record={draft} onChanged={reloadMeetings} />
          <section>
            <div className="customer-peek-kicker"><span>notas e próximos passos</span></div>
            <textarea className="inp" rows={3} style={{ width: "100%", marginTop: 8, height: "auto", padding: 8 }} value={draft.notes || ""} onChange={(e) => set({ notes: e.target.value })} placeholder="o que o cliente disse…" />
            <textarea className="inp" rows={2} style={{ width: "100%", marginTop: 8, height: "auto", padding: 8 }} value={draft.nextSteps || ""} onChange={(e) => set({ nextSteps: e.target.value })} placeholder="próximos passos combinados…" />
          </section>
          {customer && <section><div className="customer-peek-kicker"><span>linha do tempo do cliente</span></div><RecordTimeline customerId={customer.id} limit={5} /></section>}
          {error && <p role="alert" className="customer-peek-feedback">{error}</p>}
        </div>}
        <footer className="customer-peek-footer">
          <button disabled={busy || !draft || draft.status !== "aberto"} onClick={() => save({ status: "feito" })}>{busy ? "Salvando…" : "Concluir acompanhamento"}</button>
          {draft && <button type="button" disabled={busy || !dirty} onClick={() => save()}>{dirty ? "Salvar" : "Sem mudanças"}</button>}
        </footer>
      </div>
    </Drawer>, document.body);
}
