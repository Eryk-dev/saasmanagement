import React from "react";
import { api } from "../lib/api.js";
import { useData } from "../data.jsx";
import { usersByRole, currentUser, displayName } from "../lib/users.js";
import { stageKind, KINDS } from "../lib/funnel.js";
import { SlotGrid, nextBusinessDays, busyView, callBusyKeys, destinationsFor, setupType } from "../screens/today.jsx";
import { moveGate, MoveLeadModal, applyGatedMove } from "./stage-move.jsx";
import { PrimaryButton } from "../atoms.jsx";

// "Próxima ação" do card, dentro do inbox: a conversa andou → o card anda
// junto. O modal lista os DESTINOS certos pra etapa atual (mesma régua do
// roteiro, destinationsFor) e cada um faz o setup completo:
//   · call/follow-up → grade de horário na agenda do closer + Meet + rascunho
//     de confirmação na caixa (nunca envia sozinho);
//   · ganho/perdido/handoff → o mesmo gate do pipeline (MoveLeadModal);
//   · movimento simples → aplica direto.
// TUDO passa pelo PATCH canônico de leads (applyStageMove no servidor), então
// Pipeline, Minhas atividades e Agenda refletem sozinhos via SSE.

const { useState: useS, useEffect: useE } = React;

const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || "").trim());

export function NextActionButton({ thread, onScheduled }) {
  const [open, setOpen] = useS(false);
  const pill = { display: "inline-flex", alignItems: "center", gap: 5, height: 28, padding: "0 11px", borderRadius: "var(--r-2)", fontSize: 12, fontWeight: 600, cursor: "pointer", border: "1px solid var(--line-2)", background: "var(--bg-1)", color: "var(--fg-2)", flexShrink: 0 };
  if (!thread?.leadId) return null;
  return (
    <>
      <button onClick={() => setOpen(true)} style={pill} title="Atualizar o card pra próxima ação: agendar a call, fechar, marcar perda… reflete no pipeline e na fila na hora">
        → Próxima ação
      </button>
      {open && <NextActionModal leadId={thread.leadId} onScheduled={onScheduled} onClose={() => setOpen(false)} />}
    </>
  );
}

function NextActionModal({ leadId, onScheduled, onClose }) {
  const leads = window.SEED?.LEADS || [];
  const lead = leads.find((l) => l.id === leadId) || null;
  const saasCfg = (window.SEED?.SAAS || []).find((s) => s.id === lead?.saas) || null;
  const closers = usersByRole("closer").filter((u) => !u.saas || u.saas === saasCfg?.id);

  const meId = currentUser()?.id || "";
  // Depois de mover o card, recarrega o SEED na hora: a fila do inbox (Minhas
  // atividades) lê window.SEED.LEADS e só se atualizava no tick da SSE — um
  // lead desqualificado ficava aparecendo na fila até o próximo refresh.
  const { refresh } = useData();
  const [dest, setDest] = useS(null);         // destino que pede AGENDA (call/follow-up)
  const [gateMove, setGateMove] = useS(null); // destino com gate (ganho/perda/handoff)
  const [closer, setCloser] = useS(() => lead?.closer || (closers.some((c) => c.id === meId) ? meId : (closers[0]?.id || "")));
  const [day, setDay] = useS(() => nextBusinessDays(1)[0]);
  const [slot, setSlot] = useS(lead?.callAt || "");
  const [email, setEmail] = useS(lead?.email || "");
  const [busy, setBusy] = useS(false);
  const [err, setErr] = useS("");
  const [done, setDone] = useS(null); // { moved, when?, callUrl? }

  useE(() => {
    const h = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  if (!lead) return null;

  // Destinos curados pra etapa atual — ESPELHO de Ajustes → Próximos passos
  // (destinationsFor, mesma régua do roteiro), incluindo o "tentar de novo"
  // (retry): registra o toque e o GPS remarca; em lead novo promove pra
  // qualificação sozinho (regra do servidor). Só a etapa atual fica de fora.
  const dests = destinationsFor(saasCfg, lead).filter((d) => d.retry || d.stage !== lead.stage);

  const agenda = busyView(callBusyKeys(leads, closer, lead.id), closer);
  const whenLabel = (iso) => {
    const d = new Date(iso);
    return d.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit" }) + " às " + d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  };
  // Rascunho de confirmação pro composer (copy do Leo; o SDR revisa e envia).
  const draftFor = (iso) => {
    const d = new Date(iso);
    const today = new Date().toDateString() === d.toDateString();
    const dia = today ? "hoje" : d.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit" });
    const who = displayName(closer) || "nosso closer";
    return `Fechado! ${dia} às ${d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })} então. ${who} te chama aqui um pouco antes da call. Qualquer dúvida, fico à disposição!!`;
  };

  // Destino escolhido: agenda, gate ou movimento direto.
  async function pick(d) {
    const setup = setupType(d.kind);
    if (setup === "call" || setup === "followup") { setDest(d); setErr(""); return; }
    const gate = moveGate(saasCfg, lead, d.stage);
    if (gate) { setGateMove({ toStage: d.stage, gate }); return; }
    setBusy(true); setErr("");
    try {
      await api.update("leads", lead.id, { stage: d.stage });
      refresh();
      setDone({ moved: d.stage });
    } catch (e) { setErr(e?.message || "não deu pra mover"); }
    finally { setBusy(false); }
  }

  // "Tentar de novo": registra o TOQUE (activity whatsapp) — o servidor soma a
  // tentativa, remarca o GPS pela cadência e, em lead novo, promove pra
  // qualificação (onActivityCreated). Igual ao chip de retry do roteiro.
  async function pickRetry(d) {
    setBusy(true); setErr("");
    try {
      await api.logActivity({ saas: lead.saas, lead: lead.id, type: "whatsapp", text: "tentativa de contato (inbox)", author: currentUser()?.id || "" });
      refresh(); // toque re-agenda o GPS no servidor, mas o evento é "activities" (a SSE ignora) — recarrega na mão pra fila andar
      setDone({ retry: true, moved: d.promote ? d.stage : (lead.stage || d.stage) });
    } catch (e) { setErr(e?.message || "não deu pra registrar a tentativa"); }
    finally { setBusy(false); }
  }

  // Agendamento (call/follow-up): grava closer + horário e MOVE pro destino.
  async function schedule(withInvite) {
    if (!closer || !slot || busy || !dest) return;
    setBusy(true); setErr("");
    const patch = {
      closer, callAt: slot, stage: dest.stage,
      ...(withInvite && email.trim() ? { email: email.trim() } : {}),
    };
    try {
      await api.update("leads", lead.id, patch);
      refresh();
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
      setDone({ moved: dest.stage, when: whenLabel(slot), callUrl });
      onScheduled && onScheduled(draftFor(slot));
    } catch (e) {
      setErr(e?.message || "não deu pra agendar");
    } finally { setBusy(false); }
  }

  const field = { height: 34, padding: "0 9px", borderRadius: "var(--r-2)", border: "1px solid var(--line-2)", background: "var(--bg-1)", color: "var(--fg-1)", fontSize: 13, minWidth: 0 };
  const label = { fontSize: 10.5, fontFamily: "var(--mono)", color: "var(--fg-3)", letterSpacing: "0.06em", textTransform: "uppercase", display: "block", marginBottom: 4 };
  const googleOn = !!window.SEED?.CONFIG?.google?.connected;
  const needsAgenda = dest && !done;

  return (
    <>
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 90, background: "color-mix(in srgb, var(--bg-0) 62%, transparent)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "min(560px, calc(100vw - 32px))", maxHeight: "min(92dvh, 100%)", overflowY: "auto", background: "var(--bg-1)", border: "1px solid var(--line-2)", borderRadius: "var(--r-3)", boxShadow: "var(--shadow-pop)", padding: 18, display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {needsAgenda && (
            <button onClick={() => { setDest(null); setErr(""); }} aria-label="Voltar" className="mono dim" style={{ fontSize: 14, width: 30, height: 30, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>‹</button>
          )}
          <span style={{ fontFamily: "var(--display)", fontSize: 16, fontWeight: 700, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {needsAgenda ? `Agendar · ${dest.stage}` : "Próxima ação"} · {lead.name}
          </span>
          <button onClick={onClose} aria-label="Fechar" className="mono dim" style={{ fontSize: 15, width: 32, height: 32, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>✕</button>
        </div>

        {done ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ padding: "10px 12px", borderRadius: "var(--r-2)", background: "var(--pos-soft)", color: "var(--pos)", fontSize: 13, fontWeight: 600 }}>
              {done.retry ? `✓ Tentativa registrada · card em “${done.moved}”` : `✓ Card atualizado pra “${done.moved}”${done.when ? ` · call ${done.when} com ${displayName(closer)}` : ""}`}
            </div>
            <div style={{ fontSize: 12.5, color: "var(--fg-2)", lineHeight: 1.5 }}>
              {done.retry ? "O toque entrou na timeline e o GPS já remarcou a retomada pela cadência. " : null}
              Pipeline, Minhas atividades e Agenda já refletem (tempo real).
              {done.callUrl ? <> Meet criado: <a href={done.callUrl} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)" }}>{done.callUrl}</a>.</> : null}
              {done.when ? <> Deixei a confirmação pronta na caixa de mensagem, é só revisar e enviar.</> : null}
            </div>
            {err && <div className="mono" style={{ fontSize: 11, color: "var(--warn)" }}>{err}</div>}
            <PrimaryButton onClick={onClose}>Voltar pra conversa</PrimaryButton>
          </div>
        ) : !dest ? (
          <>
            <div className="mono dim" style={{ fontSize: 11 }}>
              etapa atual: <b style={{ color: "var(--fg-1)" }}>{lead.stage || "início do funil"}</b> · escolha pra onde o card vai
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {dests.map((d) => {
                // "Tentar de novo" (retry da régua): registra o toque; em lead
                // novo o card segue sozinho pra qualificação (servidor).
                if (d.retry) {
                  return (
                    <button key="retry" disabled={busy} onClick={() => pickRetry(d)}
                      style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: "var(--r-2)", border: "1px dashed var(--line-strong)", background: "var(--bg-1)", textAlign: "left", cursor: "pointer", opacity: busy ? 0.6 : 1 }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = "var(--hover)"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = "var(--bg-1)"; }}>
                      <span className="mono" style={{ flexShrink: 0, width: 18, textAlign: "center", color: "var(--fg-3)" }}>↻</span>
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ display: "block", fontSize: 13.5, fontWeight: 600 }}>{d.promote ? `${d.stage} · registrar tentativa` : "Registrar tentativa"}</span>
                        <span className="mono dim" style={{ fontSize: 10 }}>
                          {d.promote ? "não respondeu ainda: soma o toque e o card segue pra qualificação" : "não respondeu: soma o toque e o GPS remarca a retomada"}
                        </span>
                      </span>
                      <span className="dim" style={{ flexShrink: 0, fontSize: 12 }}>›</span>
                    </button>
                  );
                }
                const meta = KINDS[d.kind] || {};
                const setup = setupType(d.kind);
                return (
                  <button key={d.stage} disabled={busy} onClick={() => pick(d)}
                    style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: "var(--r-2)", border: "1px solid var(--line-2)", background: "var(--bg-1)", textAlign: "left", cursor: "pointer", opacity: busy ? 0.6 : 1 }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = "var(--hover)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = "var(--bg-1)"; }}>
                    <span className="mono" style={{ flexShrink: 0, width: 18, textAlign: "center", color: "var(--accent)" }}>{meta.glyph || "→"}</span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: "block", fontSize: 13.5, fontWeight: 600 }}>{d.stage}</span>
                      <span className="mono dim" style={{ fontSize: 10 }}>
                        {setup === "call" || setup === "followup" ? "escolhe o horário na agenda do closer"
                          : setup === "won" ? "pede valor e forma de pagamento"
                          : setup === "loss" ? "pede o motivo"
                          : setup === "integrator" ? "define o integrador"
                          : meta.label || "move direto"}
                      </span>
                    </span>
                    <span className="dim" style={{ flexShrink: 0, fontSize: 12 }}>›</span>
                  </button>
                );
              })}
              {!dests.length && <div className="mono dim" style={{ fontSize: 11.5 }}>sem próximos passos configurados pra esta etapa — use o seletor de etapa do card</div>}
            </div>
            {err && <div className="mono" style={{ fontSize: 11.5, color: "var(--neg)" }}>{err}</div>}
          </>
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

            {slot && (
              <div className="mono dim" style={{ fontSize: 11 }}>ao agendar, o card vai de “{lead.stage || "início"}” pra “{dest.stage}”</div>
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

    {/* Gate (ganho/perda/handoff) como IRMÃO do overlay: o backdrop dele
        cancela só o gate, sem derrubar o modal de próxima ação. */}
    {gateMove && (
      <MoveLeadModal
        lead={lead}
        toStage={gateMove.toStage}
        gate={gateMove.gate}
        saasCfg={saasCfg}
        onCancel={() => setGateMove(null)}
        onConfirm={(mp, extra) => {
          applyGatedMove(mp, extra, lead.id).then(refresh).catch((err2) => console.warn("movimento não persistido:", err2.message));
          setGateMove(null);
          setDone({ moved: gateMove.toStage });
        }}
      />
    )}
    </>
  );
}

// Nome antigo (só o agendamento) — o botão evoluiu pra "Próxima ação".
export { NextActionButton as ScheduleCallButton };
