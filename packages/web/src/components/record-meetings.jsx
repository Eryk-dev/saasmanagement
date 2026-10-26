// Reuniões com Meet próprio de um registro do cliente (integração ou
// acompanhamento de CS): lista, marcar, remarcar pela data e cancelar. Mesmo
// desenho do customer-peek; usado no card da Integração e no do Acompanhamento.

import React, { useState } from "react";
import { api } from "../lib/api.js";
import { DateTimeField } from "./datetime-field.jsx";
import { displayName } from "../lib/users.js";
import { toast } from "../atoms.jsx";
import { summaryReason } from "./customer-meeting.jsx";

const when = (iso) => new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

// `collapsed`: o cliente já tem uma reunião marcada em outro lugar (a integração
// do negócio). Marcar outra fica atrás de um botão, em vez de abrir o campo.
export function RecordMeetings({ host, record, onChanged, collapsed = false }) {
  const [at, setAt] = useState("");
  const [opened, setOpened] = useState(false);
  const [busy, setBusy] = useState(false);
  const meetings = (record.meetings || []).filter((m) => m.status === "scheduled").sort((a, b) => String(b.at).localeCompare(String(a.at)));

  async function run(fn, ok) {
    if (busy) return;
    setBusy(true);
    try {
      const r = await fn();
      if (r?.meetError) toast(`Reunião marcada, sem Meet: ${r.meetError}`, "warn");
      else if (r?.ok === false) toast(`Sem resumo: ${summaryReason(r)}`, "warn");
      else if (ok) toast(ok, "pos");
      await onChanged();
    } catch (e) {
      toast(`${e.message || "Não foi possível"} · tente de novo`, "neg");
    } finally {
      setBusy(false);
    }
  }

  return <section>
    <div className="customer-peek-kicker"><span>reuniões</span>{meetings.length ? <b>{meetings.length}</b> : null}</div>
    {meetings.map((m) => {
      const past = Date.parse(m.at) < Date.now();
      return <div key={m.id} className="customer-peek-fact" style={{ alignItems: "flex-start" }}>
        <span>{when(m.at)}</span>
        <strong style={{ textAlign: "left" }}>
          {m.label}{m.responsible ? ` · ${displayName(m.responsible)}` : ""}
          <em style={{ display: "flex", gap: 10, flexWrap: "wrap", fontStyle: "normal", fontWeight: 400, fontSize: 11.5, marginTop: 2 }}>
            {m.meetUrl ? <a className="customer-peek-link" href={m.meetUrl} target="_blank" rel="noopener noreferrer">Meet ↗</a> : <span style={{ color: "var(--warn)" }}>sem sala</span>}
            {past && !m.summaryAt && m.meetUrl && <button type="button" className="customer-peek-link" disabled={busy} onClick={() => run(() => api.summarizeRecordMeeting(host, record.id, m.id), "Resumo pronto")}>gerar resumo</button>}
            {m.summaryAt && <span style={{ color: "var(--pos)" }}>resumida</span>}
            {!past && <button type="button" className="customer-peek-link" style={{ color: "var(--fg-3)" }} disabled={busy}
              onClick={() => window.confirm(`Cancelar a reunião de ${when(m.at)}? O convite é apagado da agenda.`) && run(() => api.cancelRecordMeeting(host, record.id, m.id), "Reunião cancelada")}>cancelar</button>}
          </em>
        </strong>
      </div>;
    })}
    {!meetings.length && !collapsed && <p className="customer-peek-note">Nenhuma reunião marcada.</p>}
    {collapsed && !opened && <button type="button" className="customer-peek-link" style={{ marginTop: 6 }} onClick={() => setOpened(true)}>marcar outra reunião</button>}
    {(!collapsed || opened) && <div style={{ display: "flex", gap: 6, marginTop: 10, alignItems: "center" }}>
      <div style={{ flex: 1, minWidth: 0 }}><DateTimeField value={at} onChange={setAt} placeholder="marcar reunião em…" /></div>
      <button type="button" className="customer-peek-link" disabled={busy || !at}
        onClick={() => run(async () => { const r = await api.scheduleRecordMeeting(host, record.id, { at }); setAt(""); return r; }, "Reunião marcada. Convite enviado.")}>
        {busy ? "marcando…" : "marcar"}
      </button>
    </div>}
  </section>;
}
