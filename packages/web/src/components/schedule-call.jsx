import React from "react";
import { api } from "../lib/api.js";
import { usersByRole, currentUser, displayName } from "../lib/users.js";
import { stageKind } from "../lib/funnel.js";
import { SlotGrid, nextBusinessDays, busyView, callBusyKeys } from "../screens/today.jsx";
import { PrimaryButton } from "../atoms.jsx";

// Atalho "Agendar call" do inbox de WhatsApp: o agendamento nasceu na conversa
// ("conseguimos hoje às 13h?" → "Sim"), então marca TUDO dali mesmo — horário na
// grade que respeita a agenda do closer (calls + bloqueios, a mesma SlotGrid do
// roteiro), move o card pra etapa de call, cria o Meet com convite se tiver
// e-mail e devolve um rascunho de confirmação pra caixa de mensagem (nunca
// envia sozinho). Lead avançado (follow-up/ganho…) só ganha callAt/closer — a
// etapa não anda pra trás.

const { useState: useS, useEffect: useE } = React;

const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || "").trim());

export function ScheduleCallButton({ thread, onScheduled }) {
  const [open, setOpen] = useS(false);
  const pill = { display: "inline-flex", alignItems: "center", gap: 5, height: 28, padding: "0 11px", borderRadius: "var(--r-2)", fontSize: 12, fontWeight: 600, cursor: "pointer", border: "1px solid var(--line-2)", background: "var(--bg-1)", color: "var(--fg-2)", flexShrink: 0 };
  if (!thread?.leadId) return null;
  return (
    <>
      <button onClick={() => setOpen(true)} style={pill} title="Marcar a call combinada na conversa: horário livre na agenda, card na etapa de call e Meet">
        ▦ Agendar call
      </button>
      {open && <ScheduleCallModal leadId={thread.leadId} onScheduled={onScheduled} onClose={() => setOpen(false)} />}
    </>
  );
}

function ScheduleCallModal({ leadId, onScheduled, onClose }) {
  const leads = window.SEED?.LEADS || [];
  const lead = leads.find((l) => l.id === leadId) || null;
  const saasCfg = (window.SEED?.SAAS || []).find((s) => s.id === lead?.saas) || null;
  const closers = usersByRole("closer").filter((u) => !u.saas || u.saas === saasCfg?.id);

  const meId = currentUser()?.id || "";
  const [closer, setCloser] = useS(() => lead?.closer || (closers.some((c) => c.id === meId) ? meId : (closers[0]?.id || "")));
  const [day, setDay] = useS(() => nextBusinessDays(1)[0]);
  const [slot, setSlot] = useS(lead?.callAt || "");
  const [email, setEmail] = useS(lead?.email || "");
  const [busy, setBusy] = useS(false);
  const [err, setErr] = useS("");
  const [done, setDone] = useS(null); // { when, movedTo, callUrl }

  useE(() => {
    const h = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  if (!lead) return null;

  // Etapa de destino: a primeira de kind "call" do funil — mas só ANDA se o
  // lead ainda está na fase SDR (novo/contato/qualificação); de call em diante
  // o agendamento não rebaixa o card.
  const callStage = (saasCfg?.funnel || []).find((f) => stageKind(saasCfg, f.stage) === "call")?.stage || "";
  const curKind = stageKind(saasCfg, lead.stage || saasCfg?.funnel?.[0]?.stage);
  const movesStage = !!callStage && ["novo", "contato", "qualificacao", "outro"].includes(curKind) && lead.stage !== callStage;

  const agenda = busyView(callBusyKeys(leads, closer, lead.id), closer);

  const whenLabel = (iso) => {
    const d = new Date(iso);
    return d.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit" }) + " às " + d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  };
  // Rascunho de confirmação pro composer (o SDR edita/envia — nunca sai sozinho).
  // Copy do Leo, com o CLOSER escolhido no lugar do nome.
  const draftFor = (iso) => {
    const d = new Date(iso);
    const today = new Date().toDateString() === d.toDateString();
    const dia = today ? "hoje" : d.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit" });
    const who = displayName(closer) || "nosso closer";
    return `Fechado! ${dia} às ${d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })} então. ${who} te chama aqui um pouco antes da call. Qualquer dúvida, fico à disposição!!`;
  };

  async function schedule(withInvite) {
    if (!closer || !slot || busy) return;
    setBusy(true); setErr("");
    const patch = {
      closer, callAt: slot,
      ...(movesStage ? { stage: callStage } : {}),
      ...(withInvite && email.trim() ? { email: email.trim() } : {}),
    };
    try {
      await api.update("leads", lead.id, patch);
      let callUrl = "";
      if (withInvite) {
        try {
          const r = await api.createMeet(lead.id, email.trim() ? { email: email.trim() } : undefined);
          callUrl = r?.callUrl || "";
        } catch (e) {
          // Call marcada; só o Meet falhou — mostra sem desfazer o agendamento.
          setErr("call marcada, mas o Meet falhou: " + (e?.message || e));
        }
      }
      setDone({ when: whenLabel(slot), movedTo: movesStage ? callStage : "", callUrl });
      onScheduled && onScheduled(draftFor(slot));
    } catch (e) {
      setErr(e?.message || "não deu pra agendar");
    } finally { setBusy(false); }
  }

  const field = { height: 34, padding: "0 9px", borderRadius: "var(--r-2)", border: "1px solid var(--line-2)", background: "var(--bg-1)", color: "var(--fg-1)", fontSize: 13, minWidth: 0 };
  const label = { fontSize: 10.5, fontFamily: "var(--mono)", color: "var(--fg-3)", letterSpacing: "0.06em", textTransform: "uppercase", display: "block", marginBottom: 4 };
  const googleOn = !!window.SEED?.CONFIG?.google?.connected;

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 90, background: "color-mix(in srgb, var(--bg-0) 62%, transparent)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "min(560px, calc(100vw - 32px))", maxHeight: "min(92dvh, 100%)", overflowY: "auto", background: "var(--bg-1)", border: "1px solid var(--line-2)", borderRadius: "var(--r-3)", boxShadow: "var(--shadow-pop)", padding: 18, display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontFamily: "var(--display)", fontSize: 16, fontWeight: 700, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            Agendar call · {lead.name}
          </span>
          <button onClick={onClose} aria-label="Fechar" className="mono dim" style={{ fontSize: 15, width: 32, height: 32, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>✕</button>
        </div>

        {done ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ padding: "10px 12px", borderRadius: "var(--r-2)", background: "var(--pos-soft)", color: "var(--pos)", fontSize: 13, fontWeight: 600 }}>
              ✓ Call agendada {done.when} com {displayName(closer)}
            </div>
            <div style={{ fontSize: 12.5, color: "var(--fg-2)", lineHeight: 1.5 }}>
              {done.movedTo ? <>Card movido pra <b>{done.movedTo}</b>. </> : <>Card já estava adiante no funil, só marquei o horário. </>}
              {done.callUrl ? <>Meet criado: <a href={done.callUrl} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)" }}>{done.callUrl}</a>. </> : null}
              Deixei a confirmação pronta na caixa de mensagem, é só revisar e enviar.
            </div>
            {err && <div className="mono" style={{ fontSize: 11, color: "var(--warn)" }}>{err}</div>}
            <PrimaryButton onClick={onClose}>Voltar pra conversa</PrimaryButton>
          </div>
        ) : (
          <>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
              <div style={{ flex: 1, minWidth: 160 }}>
                <span style={label}>Closer da call</span>
                <select value={closer} onChange={(e) => { setCloser(e.target.value); setSlot(""); }} style={{ ...field, width: "100%" }}>
                  {!closers.length && <option value="">nenhum closer no time</option>}
                  {closers.map((c) => <option key={c.id} value={c.id}>{c.name || c.id}</option>)}
                </select>
              </div>
              <div style={{ flex: 1.4, minWidth: 180 }}>
                <span style={label}>E-mail pro convite do Meet (opcional)</span>
                <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email@dolead.com.br" style={{ ...field, width: "100%" }} />
              </div>
            </div>

            <div>
              <span style={label}>Horário · ocupado da agenda de {displayName(closer) || "…"} já bloqueado</span>
              <SlotGrid days={nextBusinessDays(6)} day={day} setDay={setDay} slot={slot} setSlot={setSlot} busy={agenda} />
            </div>

            {movesStage && slot && (
              <div className="mono dim" style={{ fontSize: 11 }}>ao agendar, o card vai de “{lead.stage || "início"}” pra “{callStage}”</div>
            )}
            {err && <div className="mono" style={{ fontSize: 11.5, color: "var(--neg)" }}>{err}</div>}

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              {googleOn && (
                <PrimaryButton onClick={() => schedule(true)} disabled={!closer || !slot || busy || (email.trim() && !validEmail(email))}>
                  {busy ? "agendando…" : "Agendar + convite Meet"}
                </PrimaryButton>
              )}
              <button onClick={() => schedule(false)} disabled={!closer || !slot || busy}
                style={{ height: 36, padding: "0 14px", borderRadius: "var(--r-2)", border: "1px solid var(--line-2)", background: googleOn ? "var(--bg-1)" : "var(--btn-bg, var(--accent))", color: googleOn ? "var(--fg-2)" : "var(--btn-fg, var(--accent-fg))", fontSize: 13, fontWeight: googleOn ? 500 : 600, cursor: "pointer", opacity: !closer || !slot || busy ? 0.55 : 1 }}>
                {busy ? "agendando…" : googleOn ? "só agendar (sem convite)" : "Agendar"}
              </button>
              {email.trim() && !validEmail(email) && <span className="mono dim" style={{ fontSize: 10.5 }}>e-mail inválido</span>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
