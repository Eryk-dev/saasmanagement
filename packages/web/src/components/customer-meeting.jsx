// Reuniões com o cliente na ficha de Clientes. A reunião mora no LEAD do
// cliente, nos campos da integração (integrationAt / integrationCallUrl): o
// Meet nasce gravado e o resumo de onboarding/CS sai sozinho pelo poller.
// `POST /api/customers/:id/meeting` solta a sala da reunião que já aconteceu,
// pra a nova ter Meet e resumo próprios.
import React, { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { allUsers, currentUser, displayName } from "../lib/users.js";
import { SelectPopover } from "./select-popover.jsx";

const REASONS = {
  not_configured: "a IA não está configurada no servidor",
  not_connected: "nenhuma conta Google conectada consegue ler a gravação: quem organizou a reunião precisa conectar a conta @leverads em Ajustes → Integrações",
  no_meet: "a reunião não teve sala do Meet",
  transcript_not_ready: "a transcrição ainda não está no Google",
  call_in_progress: "a sala do Meet ainda está aberta: o Google só gera a transcrição quando o último participante sai",
  already_done: "essa reunião já tem resumo",
};
export const summaryReason = (r) => [REASONS[r?.reason] || r?.reason || "motivo desconhecido", r?.detail].filter(Boolean).join(" · ");

// "YYYY-MM-DDTHH:MM" (relógio de Brasília) ou ISO → instante.
function momentOf(raw) {
  const s = String(raw || "").trim();
  if (!s) return null;
  const d = new Date(/([Zz]|[+-]\d{2}:?\d{2})$/.test(s) ? s : `${s}${s.length === 16 ? ":00" : ""}-03:00`);
  return Number.isFinite(d.getTime()) ? d : null;
}
const whenLabel = (d) => d.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const dayLabel = (d) => d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit" });

// Seção da ficha lateral: próxima reunião, último resumo e as duas ações.
export function CustomerMeetings({ customer, lead, onSchedule, onOpenHistory }) {
  const [acts, setActs] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const leadId = customer.leadId && lead ? lead.id : "";
  useEffect(() => {
    let alive = true;
    if (!leadId) { setActs([]); return undefined; }
    setActs(null);
    api.listActivities(leadId).then((a) => alive && setActs(a || [])).catch(() => alive && setActs([]));
    return () => { alive = false; };
  }, [leadId]);

  const at = momentOf(lead?.integrationAt);
  const upcoming = at && at.getTime() > Date.now() ? at : null;
  const lastSummary = (acts || []).filter((a) => a.meta?.event === "call_summary" && a.meta?.summary)
    .sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0))[0] || null;
  // Reunião que já aconteceu, com sala, e ainda sem resumo: é o caso que o
  // poller não resolveu sozinho — o botão mostra o motivo em vez de silêncio.
  const unsummarized = !upcoming && at && lead?.integrationCallUrl && lead.integrationSummaryFor !== lead.integrationMeetEventId;

  async function summarize() {
    if (busy) return;
    setBusy(true); setMsg(null);
    try {
      const r = await api.customerMeetingSummary(customer.id);
      if (r?.ok) {
        setMsg({ text: "Resumo pronto." });
        setActs(await api.listActivities(leadId).catch(() => acts));
      } else setMsg({ error: true, text: `Sem resumo: ${summaryReason(r)}.` });
    } catch (e) { setMsg({ error: true, text: e.message || "Falha ao gerar o resumo." }); }
    finally { setBusy(false); }
  }

  return (
    <section className="customer-peek-meetings">
      <div className="customer-peek-kicker"><span>reuniões</span>{upcoming && <b>marcada</b>}</div>
      {!leadId ? (
        <p className="customer-peek-note">Cliente sem lead vinculado: a reunião e o resumo precisam do lead de origem.</p>
      ) : (
        <>
          <div className="customer-peek-fact"><span>Próxima</span><strong>{upcoming ? whenLabel(upcoming) : "nenhuma marcada"}</strong></div>
          {upcoming && lead.integrationCallUrl && (
            <div className="customer-peek-fact"><span>Sala</span><strong><a href={lead.integrationCallUrl} target="_blank" rel="noopener noreferrer">entrar no Meet ↗</a></strong></div>
          )}
          <div className="customer-peek-fact"><span>Último resumo</span><strong>
            {acts === null ? "carregando…" : lastSummary
              ? <button type="button" className="customer-peek-link" onClick={onOpenHistory}>{`${dayLabel(new Date(lastSummary.at))} · ${lastSummary.meta.kind === "integracao" ? "reunião" : "call de venda"} · ver`}</button>
              : "nenhum ainda"}
          </strong></div>
          {unsummarized && (
            <div className="customer-peek-pending">
              <span>{`Reunião de ${dayLabel(at)} sem resumo`}</span>
              <button type="button" onClick={summarize} disabled={busy}>{busy ? "Gerando…" : "Gerar resumo"}</button>
            </div>
          )}
          {msg && <p role={msg.error ? "alert" : "status"} className={`customer-peek-feedback${msg.error ? " is-error" : ""}`}>{msg.text}</p>}
        </>
      )}
      <button type="button" className="customer-peek-action" onClick={onSchedule} disabled={!leadId}>
        {upcoming ? "Remarcar reunião" : "Marcar nova reunião"}
      </button>
    </section>
  );
}

// Formulário do "Marcar nova reunião" (operação do CustomerModal).
export function CustomerMeetingForm({ customer, lead, onDone, onCancel, onBusy }) {
  const at = momentOf(lead?.integrationAt);
  const upcoming = at && at.getTime() > Date.now() ? at : null;
  const me = currentUser()?.id || "";
  const people = allUsers().filter((u) => u.active !== false && !u.disabled);
  const [when, setWhen] = useState("");
  const [who, setWho] = useState(lead?.integrator || customer.owner || me);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { onBusy?.(busy); }, [busy]); // eslint-disable-line react-hooks/exhaustive-deps

  async function submit(force = false) {
    if (busy) return;
    const moment = momentOf(when);
    if (!moment) { setError("Escolha data e hora."); return; }
    if (moment.getTime() <= Date.now()) { setError("A reunião precisa ser no futuro."); return; }
    setBusy(true); setError("");
    try {
      const r = await api.customerMeeting(customer.id, { at: when, responsible: who, force });
      if (r?.meetError) window.toast?.(`Reunião marcada, sem Meet: ${r.meetError}`, "warn");
      else window.toast?.(`Reunião marcada para ${whenLabel(moment)}. Convite enviado.`, "pos");
      onDone?.(r);
    } catch (e) {
      if (e.status === 409 && e.body?.reason === "previous_without_summary" && !force) {
        const ok = window.confirm(`A reunião anterior ainda não tem resumo (${summaryReason(e.body.previous)}).\n\nSe marcar a nova agora, a anterior não será mais resumida automaticamente. Marcar mesmo assim?`);
        setBusy(false);
        if (ok) await submit(true);
        return;
      }
      setError(e.message || "Não foi possível marcar a reunião.");
    } finally { setBusy(false); }
  }

  return (
    <form className="customer-meeting-form" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      {upcoming && <p className="customer-meeting-note">{`Já existe reunião em ${whenLabel(upcoming)}. Outra data remarca essa e o convite é atualizado.`}</p>}
      <div className="customer-meeting-fields">
        <label>
          <span className="kicker">Data e hora</span>
          <input type="datetime-local" className="inp" value={when} onChange={(e) => setWhen(e.target.value)} required disabled={busy} />
        </label>
        <div>
          <span className="kicker">Responsável</span>
          <SelectPopover label="Responsável" value={who} onChange={setWho} disabled={busy}
            options={people.map((u) => ({ value: u.id, label: displayName(u.id) || u.name || u.id }))} />
        </div>
      </div>
      <p className="customer-meeting-hint">
        O Meet nasce gravado na conta @leverads do responsável{lead?.email ? ` e o convite vai para ${lead.email}` : ""}. Depois da reunião, o resumo aparece no histórico do cliente.
      </p>
      {error && <p role="alert" className="customer-meeting-error">{error}</p>}
      <div className="customer-meeting-actions">
        <button type="button" onClick={onCancel} disabled={busy}>Cancelar</button>
        <button type="submit" disabled={busy}>{busy ? "Marcando…" : upcoming ? "Remarcar reunião" : "Marcar reunião"}</button>
      </div>
    </form>
  );
}
