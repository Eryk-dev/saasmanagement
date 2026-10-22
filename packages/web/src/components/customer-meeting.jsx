// Reuniões com o cliente na ficha de Clientes (Lever CRM, Fase 1B-b). A
// reunião mora num REGISTRO do cliente, com Meet próprio: na integração aberta
// ou, sem ela, num check-in de CS (POST /api/customers/:id/meeting). O resumo
// da IA sai sozinho pelo poller e vai pra timeline. A reunião da implantação
// que nasceu no card do lead (integrationAt) continua aparecendo aqui.
import { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { allUsers, currentUser, displayName, userById } from "../lib/users.js";
import { waLink } from "../lib/ui.js";
import { bookingInviteText } from "../lib/wa-copy.js";
import { SelectPopover } from "./select-popover.jsx";
import { Choice } from "./plan-editor.jsx";
import { bookingShareUrl } from "./booking-link.jsx";

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

const KIND = { implantacao: "implantação", novo_produto: "produto novo", reintegracao: "reintegração", migracao: "migração", treinamento: "treinamento" };
const FOLLOWUP = { check_in: "Check-in", qbr: "QBR", renovacao: "Renovação", risco: "Conversa de risco" };
// Como a reunião aparece no convite ("Pra agendar sua reunião de check-in…").
const INVITE = { check_in: "reunião de check-in", qbr: "reunião de QBR", renovacao: "reunião de renovação", risco: "conversa" };

// Tipos de reunião que a ficha oferece (22/10/2026: "não entendi que tipo de
// reunião é essa"): cada integração aberta, cada acompanhamento aberto e um
// acompanhamento de CS novo de cada tipo. `host` vai pro servidor
// (meetingHostFor); `responsible` é quem já cuida daquele registro.
export function meetingTypeOptions({ customer, onboardings = [], followups = [] }) {
  const out = [];
  for (const o of onboardings.filter((x) => !["concluida", "cancelada"].includes(x.stage))) {
    out.push({
      value: `onboardings:${o.id}`, host: { collection: "onboardings", id: o.id }, responsible: o.integrator || "",
      group: "Integração aberta", label: `Integração · ${KIND[o.kind] || o.kind || "aberta"}`,
      hint: o.integrator ? displayName(o.integrator) || o.integrator : "",
      place: "na integração aberta", invite: "integração", what: "integracao",
    });
  }
  for (const f of followups.filter((x) => x.status === "aberto")) {
    const name = FOLLOWUP[f.kind] || "Acompanhamento";
    out.push({
      value: `cs_followups:${f.id}`, host: { collection: "cs_followups", id: f.id }, responsible: f.owner || customer.owner || "",
      group: "Acompanhamento de CS aberto", label: `${name} (aberto)`,
      place: `no ${name.toLowerCase()} que já está aberto`, invite: INVITE[f.kind] || "reunião", what: "reuniao",
    });
  }
  for (const k of ["check_in", "qbr", "renovacao", "risco"]) {
    out.push({
      value: `new:${k}`, host: { kind: k }, responsible: customer.owner || "",
      group: "Acompanhamento de CS novo", label: `${FOLLOWUP[k]} (novo)`,
      place: `num ${FOLLOWUP[k].toLowerCase()} novo`, invite: INVITE[k], what: "reuniao",
    });
  }
  return out;
}

// Formulário do "Reunião com o cliente" (operação do CustomerModal): reunião
// de pós-venda, numa integração ou num acompanhamento de CS; nunca mexe no
// lead. Dois jeitos: marcar o horário aqui ou mandar o link da agenda de quem
// atende, e o cliente escolhe (a marcação cai no registro sozinha).
export function CustomerMeetingForm({ customer, lead, onDone, onCancel, onBusy }) {
  const me = currentUser()?.id || "";
  const people = allUsers().filter((u) => u.active !== false && !u.disabled);
  const [types, setTypes] = useState(null);
  const [type, setType] = useState("");
  const [mode, setMode] = useState("horario");
  const [when, setWhen] = useState("");
  const [who, setWho] = useState(customer.owner || lead?.integrator || me);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { onBusy?.(busy); }, [busy]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    let alive = true;
    Promise.all([api.customerOnboardings(customer.id).catch(() => null), api.customerFollowups(customer.id).catch(() => null)]).then(([o, f]) => {
      if (!alive) return;
      const list = meetingTypeOptions({ customer, onboardings: o?.onboardings || [], followups: f?.followups || [] });
      setTypes(list);
      setType(list[0].value);
      if (list[0].responsible) setWho(list[0].responsible);
    });
    return () => { alive = false; };
  }, [customer.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const chosen = (types || []).find((t) => t.value === type) || null;
  const pickType = (v) => {
    setType(v);
    const t = (types || []).find((x) => x.value === v);
    if (t?.responsible) setWho(t.responsible);
  };

  async function submit() {
    if (busy || !chosen) return;
    const moment = momentOf(when);
    if (!moment) { setError("Escolha data e hora."); return; }
    if (moment.getTime() <= Date.now()) { setError("A reunião precisa ser no futuro."); return; }
    setBusy(true); setError("");
    try {
      const r = await api.customerMeeting(customer.id, { at: when, responsible: who, host: chosen.host });
      const name = r?.host?.label || "Reunião";
      if (r?.meetError) window.toast?.(`${name} marcada, sem Meet: ${r.meetError}`, "warn");
      else window.toast?.(`${name} marcada para ${whenLabel(moment)}. Convite enviado.`, "pos");
      onDone?.(r);
    } catch (e) {
      setError(e.message || "Não foi possível marcar a reunião.");
    } finally { setBusy(false); }
  }

  const peopleOptions = people.map((u) => ({ value: u.id, label: displayName(u.id) || u.name || u.id }));
  return (
    <form className="customer-meeting-form" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <p className="customer-meeting-note">
        Reunião de pós-venda com o cliente: integração, com quem integra, ou acompanhamento de CS. Call de venda com vendedor (upsell, renovação) é pelo <b>+ novo → Negócio</b>.
      </p>
      <div className="customer-meeting-fields">
        <div>
          <span className="kicker">Tipo de reunião</span>
          {types
            ? <SelectPopover label="Tipo de reunião" value={type} onChange={pickType} disabled={busy}
                options={types.map((t) => ({ value: t.value, label: t.label, hint: t.hint, group: t.group }))} />
            : <span className="mono dim" style={{ fontSize: 12 }}>carregando…</span>}
        </div>
        <div>
          <span className="kicker">Quem atende</span>
          <SelectPopover label="Quem atende" value={who} onChange={setWho} disabled={busy} options={peopleOptions} />
        </div>
      </div>
      <Choice label="Como agendar" size="sm" value={mode} onChange={(v) => { setMode(v); setError(""); }}
        options={[{ value: "horario", label: "Escolher horário" }, { value: "link", label: "Enviar link da agenda" }]} />
      {mode === "horario" && <>
        <label className="customer-meeting-when">
          <span className="kicker">Data e hora</span>
          <input type="datetime-local" className="inp" value={when} onChange={(e) => setWhen(e.target.value)} required disabled={busy} />
        </label>
        <p className="customer-meeting-hint">
          O Meet nasce gravado na conta @leverads de quem atende e o convite vai para os contatos do cliente. O resumo aparece na linha do tempo.
        </p>
      </>}
      {mode === "link" && chosen && <CustomerBookingLink customer={customer} lead={lead} userId={who} type={chosen} />}
      {error && <p role="alert" className="customer-meeting-error">{error}</p>}
      <div className="customer-meeting-actions">
        <button type="button" onClick={onCancel} disabled={busy}>{mode === "link" ? "Fechar" : "Cancelar"}</button>
        {mode === "horario" && <button type="submit" disabled={busy || !chosen}>{busy ? "Marcando…" : "Marcar reunião"}</button>}
      </div>
    </form>
  );
}

// Link da agenda de quem atende, mandado pela ficha. Copiar ou abrir no
// WhatsApp avisa o servidor UMA vez (o registro fica esperando a marcação; um
// tipo "novo" abre o acompanhamento nessa hora), e os cliques seguintes reusam
// o mesmo registro.
function CustomerBookingLink({ customer, lead, userId, type }) {
  const [sent, setSent] = useState(null); // { key, host }
  const [copied, setCopied] = useState(false);
  const user = userById(userId);
  const name = displayName(userId) || "quem vai atender";
  if (!userId) return <p className="customer-meeting-hint">Escolha quem vai atender.</p>;
  if (!user?.bookingUrl) {
    return <p className="customer-meeting-hint">{name} ainda não cadastrou o link de convite da agenda (Configurações → Integrações → Minha conta Google).</p>;
  }
  const key = `${type.value}|${userId}`;
  const contact = { name: customer.contact || lead?.name || customer.name, saas: customer.saas };
  const phone = customer.phone || lead?.phone || (customer.contacts || []).find((c) => c.phone)?.phone || "";
  const text = bookingInviteText(contact, name, bookingShareUrl(userId, customer.saas, type.what, "", customer.id), type.invite);
  const wa = waLink(phone);
  async function markSent() {
    if (sent?.key === key) return;
    try {
      const r = await api.customerMeetingLink(customer.id, { host: type.host, responsible: userId });
      setSent({ key, host: r.host });
    } catch (e) { window.toast?.(`${e.message || "Não registrou o envio"} · a marcação pode não cair no registro sozinha`, "warn"); }
  }
  async function copy() {
    markSent();
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); }
    catch { window.prompt("Mensagem:", text); }
  }
  return (
    <div className="customer-meeting-link" role="group" aria-label={`Link da agenda de ${name}`}>
      <p>O cliente abre a agenda de <b>{name}</b>, vê os horários livres e marca sozinho. A marcação entra {type.place}, com a sala do Meet.</p>
      {sent?.key === key && <p className="mono" style={{ color: "var(--warn)" }}>link enviado · aguardando o cliente marcar</p>}
      <div className="customer-meeting-link-actions">
        <button type="button" onClick={copy}>{copied ? "copiado ✓" : "Copiar mensagem"}</button>
        {wa && <a href={`${wa}?text=${encodeURIComponent(text)}`} target="_blank" rel="noopener noreferrer" onClick={markSent}>Enviar no WhatsApp</a>}
        <a href={user.bookingUrl} target="_blank" rel="noopener noreferrer">Abrir agenda ↗</a>
      </div>
    </div>
  );
}
