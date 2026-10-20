// Atividade ligada a registro (Lever CRM, Fase 2; api: crm/activity-cards.js).
// Ligação, WhatsApp, e-mail, reunião, tarefa ou follow-up de um lead, cliente,
// integração ou acompanhamento, com dono e dia. É uma tarefa do quadro com o
// registro junto: aparece no "Meu dia" de quem é dono e, concluída, na
// timeline do cliente. O próximo toque da cadência do lead continua à parte.

import React, { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { allUsers, currentUser, displayName } from "../lib/users.js";
import { Modal } from "./overlay.jsx";
import { SelectPopover } from "./select-popover.jsx";
import { toast } from "../atoms.jsx";
import { LeadSection } from "./lead-card.jsx";
import "../screens/customers.css";

export const ACTIVITY = { ligacao: "Ligar", whatsapp: "WhatsApp", email: "E-mail", reuniao: "Reunião", tarefa: "Tarefa", followup: "Follow-up" };
const todayIso = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
const day = (d) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }) : "sem dia");

export function ActivityForm({ record, onClose, onSaved }) {
  const [type, setType] = useState("ligacao");
  const [owner, setOwner] = useState(currentUser()?.id || "");
  const [dueDate, setDueDate] = useState(todayIso());
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const people = allUsers().filter((u) => u.active !== false).map((u) => ({ value: u.id, label: displayName(u.id) }));
  async function save() {
    if (busy) return;
    setBusy(true);
    try {
      const t = await api.createCrmActivity({ type, record: { kind: record.kind, id: record.id }, owner, dueDate, title, note });
      toast("Atividade criada", "pos");
      onSaved?.(t);
    } catch (e) { toast(`${e.message || "Não foi possível criar a atividade"} · tente de novo`, "neg"); } finally { setBusy(false); }
  }
  return <Modal onClose={onClose} fechavel={!busy} label="Nova atividade" painelStyle={{ padding: "20px 22px" }} largura={440} padding={20}>
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div>
        <h2 style={{ margin: 0, fontSize: 17 }}>Nova atividade</h2>
        <div style={{ fontSize: 12.5, color: "var(--fg-3)", marginTop: 2 }}>{record.label}</div>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }} role="radiogroup" aria-label="Tipo">
        {Object.entries(ACTIVITY).map(([k, l]) => <button key={k} type="button" role="radio" aria-checked={type === k} onClick={() => setType(k)}
          style={{ height: 28, padding: "0 12px", borderRadius: 999, fontSize: 12.5, cursor: "pointer", border: `1px solid ${type === k ? "var(--accent)" : "var(--line-2)"}`, background: type === k ? "var(--accent-soft, var(--bg-2))" : "var(--bg-1)", color: "var(--fg-1)", fontWeight: type === k ? 600 : 400 }}>{l}</button>)}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}><div className="kicker">Dono</div><div style={{ marginTop: 4 }}><SelectPopover value={owner} options={people} onChange={setOwner} label="Dono da atividade" searchable /></div></div>
        <div><div className="kicker">Dia</div><input className="inp" type="date" style={{ marginTop: 4 }} value={dueDate} onChange={(e) => setDueDate(e.target.value)} aria-label="Dia da atividade" /></div>
      </div>
      <div><div className="kicker">Título (opcional)</div><input className="inp" style={{ width: "100%", marginTop: 4 }} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={`${ACTIVITY[type]} · ${record.label}`} /></div>
      <div><div className="kicker">Nota</div><textarea className="inp" rows={3} style={{ width: "100%", marginTop: 4, resize: "vertical" }} value={note} onChange={(e) => setNote(e.target.value)} /></div>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button type="button" style={{ padding: "8px 14px", background: "var(--bg-2)", border: "1px solid var(--line-1)", borderRadius: "var(--r-2)", fontSize: 13 }} onClick={onClose} disabled={busy}>Cancelar</button>
        <button type="button" style={{ padding: "8px 14px", background: "var(--btn-bg)", color: "var(--btn-fg)", borderRadius: "var(--r-2)", fontSize: 13, fontWeight: 600 }} onClick={save} disabled={busy}>{busy ? "Criando…" : "Criar atividade"}</button>
      </div>
    </div>
  </Modal>;
}

// As atividades abertas de um lead ou cliente (ou só as de um registro dele,
// com `recordId`), com ✓ para concluir. `reload` muda quando a ficha cria uma.
export function OpenActivities({ lead = "", customer = "", recordId = "", reload = 0, onCount }) {
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState("");
  const load = () => api.crmActivities({ lead, customer }).then((r) => setRows((r && r.activities) || [])).catch(() => setRows([]));
  useEffect(() => { load(); }, [lead, customer, reload]); // eslint-disable-line react-hooks/exhaustive-deps
  const open = (rows || []).filter((t) => !t.completed && (!recordId || t.record?.id === recordId));
  useEffect(() => { if (rows) onCount?.(open.length); }, [rows, open.length]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!open.length) return null;
  const today = todayIso();
  async function done(t) {
    setBusy(t.id);
    try { await api.completeCrmActivity(t.id); await load(); } catch (e) { toast(`${e.message || "Não foi possível concluir"} · tente de novo`, "neg"); } finally { setBusy(""); }
  }
  return open.map((t) => <div key={t.id} className="customer-peek-fact" style={{ alignItems: "flex-start" }}>
    <span>{ACTIVITY[t.activityType] || "Atividade"}</span>
    <strong style={{ display: "flex", alignItems: "flex-start", gap: 8, justifyContent: "flex-end" }}>
      <span style={{ textAlign: "right" }}>
        {t.title}
        <em style={{ display: "block", fontStyle: "normal", fontSize: 11, fontWeight: 400, color: t.dueDate && t.dueDate < today ? "var(--neg)" : "var(--fg-4)" }}>
          {(t.assignees || []).map(displayName).join(", ") || "sem dono"} · {day(t.dueDate)}</em>
      </span>
      <button type="button" aria-label={`Concluir: ${t.title}`} title="Concluir" disabled={busy === t.id} onClick={() => done(t)}
        style={{ width: 24, height: 24, borderRadius: 999, border: "1px solid var(--line-2)", background: "var(--bg-1)", color: "var(--fg-2)", cursor: "pointer", flex: "none" }}>{busy === t.id ? "…" : "✓"}</button>
    </strong>
  </div>);
}

// Bloco "atividades" nos cards em gaveta (integração, acompanhamento).
export function ActivitySection({ record, customer = "", lead = "" }) {
  const [creating, setCreating] = useState(false);
  const [reload, setReload] = useState(0);
  const [count, setCount] = useState(0);
  return <section>
    <div className="customer-peek-kicker"><span>atividades</span>{count > 0 && <b>{count}</b>}
      <button type="button" className="customer-peek-link" style={{ marginLeft: "auto", textTransform: "none", letterSpacing: "normal" }} onClick={() => setCreating(true)}>+ atividade</button></div>
    <OpenActivities customer={customer} lead={customer ? "" : lead} recordId={record.id} reload={reload} onCount={setCount} />
    {!count && <p className="customer-peek-note">Nenhuma atividade aberta.</p>}
    {creating && <ActivityForm record={record} onClose={() => setCreating(false)} onSaved={() => { setCreating(false); setReload((n) => n + 1); }} />}
  </section>;
}

// No card do Negócio: as atividades do lead, além do próximo toque da cadência.
export function LeadActivities({ lead }) {
  const [creating, setCreating] = useState(false);
  const [reload, setReload] = useState(0);
  return <LeadSection title="Atividades" action={<button className="lead-script-copy-button" onClick={() => setCreating(true)}>+ atividade</button>}>
    <OpenActivities lead={lead.id} reload={reload} />
    {creating && <ActivityForm record={{ kind: "lead", id: lead.id, label: lead.name || lead.company || "lead" }} onClose={() => setCreating(false)}
      onSaved={() => { setCreating(false); setReload((n) => n + 1); }} />}
  </LeadSection>;
}
