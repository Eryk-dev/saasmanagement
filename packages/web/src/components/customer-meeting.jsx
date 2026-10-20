// Reuniões com o cliente na ficha de Clientes (Lever CRM, Fase 1B-b). A
// reunião mora num REGISTRO do cliente, com Meet próprio: na integração aberta
// ou, sem ela, num check-in de CS (POST /api/customers/:id/meeting). O resumo
// da IA sai sozinho pelo poller e vai pra timeline. A reunião da implantação
// que nasceu no card do lead (integrationAt) continua aparecendo aqui.
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

const hostSegment = (h) => (h?.collection === "onboardings" ? "onboardings" : "followups");

// Seção da ficha lateral: próxima reunião, último resumo e as ações.
export function CustomerMeetings({ customer, lead, onSchedule, onOpenHistory }) {
  const [meetings, setMeetings] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const load = () => api.customerRecordMeetings(customer.id).then((r) => setMeetings(r.meetings || [])).catch(() => setMeetings([]));
  useEffect(() => { setMeetings(null); load(); }, [customer.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const now = Date.now();
  const live = (meetings || []).filter((m) => m.status === "scheduled");
  const next = live.filter((m) => Date.parse(m.at) > now).sort((a, b) => Date.parse(a.at) - Date.parse(b.at))[0] || null;
  const legacyAt = momentOf(lead?.integrationAt);
  const legacyNext = !next && legacyAt && legacyAt.getTime() > now ? legacyAt : null;
  const lastSummary = live.filter((m) => m.summaryAt).sort((a, b) => String(b.summaryAt).localeCompare(String(a.summaryAt)))[0] || null;
  // Reunião que já aconteceu, com sala e sem resumo: o poller não resolveu
  // sozinho — o botão mostra o motivo em vez de silêncio.
  const pending = live.find((m) => !m.summaryAt && m.meetUrl && Date.parse(m.at) + 50 * 60_000 < now) || null;

  async function summarize() {
    if (busy || !pending) return;
    setBusy(true); setMsg(null);
    try {
      const r = await api.summarizeRecordMeeting(hostSegment(pending.host), pending.host.id, pending.id);
      if (r?.ok) { setMsg({ text: "Resumo pronto." }); await load(); }
      else setMsg({ error: true, text: `Sem resumo: ${summaryReason(r)}.` });
    } catch (e) { setMsg({ error: true, text: e.message || "Falha ao gerar o resumo." }); }
    finally { setBusy(false); }
  }
  async function cancel() {
    if (busy || !next || !window.confirm(`Cancelar a reunião de ${whenLabel(new Date(next.at))}? O convite é apagado da agenda.`)) return;
    setBusy(true);
    try { await api.cancelRecordMeeting(hostSegment(next.host), next.host.id, next.id); await load(); }
    catch (e) { window.toast?.(`${e.message || "Não foi possível cancelar"} · tente de novo`, "neg"); }
    finally { setBusy(false); }
  }

  return (
    <section className="customer-peek-meetings">
      <div className="customer-peek-kicker"><span>reuniões</span>{(next || legacyNext) && <b>marcada</b>}</div>
      <div className="customer-peek-fact"><span>Próxima</span><strong>
        {meetings === null ? "carregando…" : next ? `${whenLabel(new Date(next.at))} · ${next.host.label.toLowerCase()}`
          : legacyNext ? `${whenLabel(legacyNext)} · implantação` : "nenhuma marcada"}
      </strong></div>
      {(next?.meetUrl || (legacyNext && lead?.integrationCallUrl)) && (
        <div className="customer-peek-fact"><span>Sala</span><strong><a href={next?.meetUrl || lead.integrationCallUrl} target="_blank" rel="noopener noreferrer">entrar no Meet ↗</a></strong></div>
      )}
      <div className="customer-peek-fact"><span>Último resumo</span><strong>
        {lastSummary
          ? <button type="button" className="customer-peek-link" onClick={onOpenHistory}>{`${dayLabel(new Date(lastSummary.at))} · ${lastSummary.host.label.toLowerCase()} · ver`}</button>
          : "nenhum ainda"}
      </strong></div>
      {pending && (
        <div className="customer-peek-pending">
          <span>{`Reunião de ${dayLabel(new Date(pending.at))} sem resumo`}</span>
          <button type="button" onClick={summarize} disabled={busy}>{busy ? "Gerando…" : "Gerar resumo"}</button>
        </div>
      )}
      {msg && <p role={msg.error ? "alert" : "status"} className={`customer-peek-feedback${msg.error ? " is-error" : ""}`}>{msg.text}</p>}
      <button type="button" className="customer-peek-action" onClick={onSchedule} disabled={busy}>Marcar nova reunião</button>
      {next && <button type="button" className="customer-peek-link" style={{ marginTop: 8 }} onClick={cancel} disabled={busy}>cancelar a próxima</button>}
    </section>
  );
}

// Formulário do "Marcar nova reunião" (operação do CustomerModal). A reunião
// entra na integração aberta ou num check-in novo; nunca mexe no lead.
export function CustomerMeetingForm({ customer, lead, onDone, onCancel, onBusy }) {
  const me = currentUser()?.id || "";
  const people = allUsers().filter((u) => u.active !== false && !u.disabled);
  const [when, setWhen] = useState("");
  const [who, setWho] = useState(customer.owner || lead?.integrator || me);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { onBusy?.(busy); }, [busy]); // eslint-disable-line react-hooks/exhaustive-deps

  async function submit() {
    if (busy) return;
    const moment = momentOf(when);
    if (!moment) { setError("Escolha data e hora."); return; }
    if (moment.getTime() <= Date.now()) { setError("A reunião precisa ser no futuro."); return; }
    setBusy(true); setError("");
    try {
      const r = await api.customerMeeting(customer.id, { at: when, responsible: who });
      if (r?.meetError) window.toast?.(`Reunião marcada, sem Meet: ${r.meetError}`, "warn");
      else window.toast?.(`Reunião marcada para ${whenLabel(moment)}. Convite enviado.`, "pos");
      onDone?.(r);
    } catch (e) {
      setError(e.message || "Não foi possível marcar a reunião.");
    } finally { setBusy(false); }
  }

  return (
    <form className="customer-meeting-form" onSubmit={(e) => { e.preventDefault(); submit(); }}>
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
        O Meet nasce gravado na conta @leverads do responsável e o convite vai para os contatos do cliente. A reunião entra na integração aberta (ou num check-in) e o resumo aparece na linha do tempo.
      </p>
      {error && <p role="alert" className="customer-meeting-error">{error}</p>}
      <div className="customer-meeting-actions">
        <button type="button" onClick={onCancel} disabled={busy}>Cancelar</button>
        <button type="submit" disabled={busy}>{busy ? "Marcando…" : "Marcar reunião"}</button>
      </div>
    </form>
  );
}
