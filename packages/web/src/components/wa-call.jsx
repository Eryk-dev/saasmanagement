import React from "react";
import { api } from "../lib/api.js";

// Ligação pelo WhatsApp DIRETO do cockpit (Calling API + WebRTC):
//   1. pega o microfone e gera a oferta SDP não-trickle (ICE completo);
//   2. POST /threads/:id/call — o WhatsApp do lead toca;
//   3. poll de 1s no estado da chamada até o webhook trazer o SDP answer
//      (lead atendeu) → áudio dos dois lados no browser;
//   4. encerra pelo botão (ou quando o lead desliga, via webhook/ICE).
// Só aparece quando a conversa tem a permissão de ligação ACEITA — a Meta
// recusa chamada sem permissão e o gate da API devolve o erro legível.

const { useState: useS, useRef: useR, useEffect: useE } = React;

function fmtDur(s) {
  const m = Math.floor(s / 60), r = s % 60;
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

// Espera o ICE terminar (não-trickle: a oferta precisa ir com os candidates
// dentro). Cap de 3s — rede que demora manda o que tiver.
function waitIceComplete(pc) {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
    const t = setTimeout(resolve, 3000);
    pc.addEventListener("icegatheringstatechange", function on() {
      if (pc.iceGatheringState === "complete") { clearTimeout(t); pc.removeEventListener("icegatheringstatechange", on); resolve(); }
    });
  });
}

export function WaCallButton({ threadId, contactName }) {
  const [phase, setPhase] = useS("idle"); // idle | prep | ringing | connected | done
  const [note, setNote] = useS("");       // status/erro visível
  const [secs, setSecs] = useS(0);
  const pcRef = useR(null);
  const micRef = useR(null);
  const callIdRef = useR("");
  const timersRef = useR([]);
  const audioRef = useR(null);
  // Nome congelado no início da chamada: trocar de conversa no meio não pode
  // trocar o rótulo do card (a ligação segue com quem atendeu).
  const nameRef = useR("");

  const clearTimers = () => { timersRef.current.forEach(clearInterval); timersRef.current = []; };

  // phase dentro dos callbacks (poll/ICE) sem stale closure.
  const phaseRef = useR(phase);
  useE(() => { phaseRef.current = phase; }, [phase]);

  function cleanup(finalNote) {
    clearTimers();
    try { micRef.current?.getTracks().forEach((t) => t.stop()); } catch { /* já parado */ }
    try { pcRef.current?.close(); } catch { /* já fechada */ }
    pcRef.current = null; micRef.current = null;
    if (finalNote != null) { setNote(finalNote); setPhase("done"); }
  }

  // Sair da conversa/tela com chamada viva: encerra pra não ficar tocando.
  useE(() => () => {
    if (callIdRef.current && pcRef.current) api.waCallEnd(callIdRef.current).catch(() => {});
    cleanup(null);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function start() {
    nameRef.current = contactName || "Ligação";
    setPhase("prep"); setNote("preparando o microfone…"); setSecs(0);
    let mic;
    try { mic = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch { setPhase("idle"); setNote("microfone bloqueado — libere o acesso no navegador"); return; }
    micRef.current = mic;

    const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
    pcRef.current = pc;
    mic.getTracks().forEach((t) => pc.addTrack(t, mic));
    pc.ontrack = (ev) => { if (audioRef.current) audioRef.current.srcObject = ev.streams[0] || new MediaStream([ev.track]); };
    // Lead desligou/caiu: o ICE percebe antes do webhook às vezes.
    pc.oniceconnectionstatechange = () => {
      if (["failed", "disconnected", "closed"].includes(pc.iceConnectionState) && callIdRef.current && phaseRef.current === "connected") {
        endCall("ligação encerrada");
      }
    };

    const offer = await pc.createOffer({ offerToReceiveAudio: true });
    await pc.setLocalDescription(offer);
    await waitIceComplete(pc);

    setNote("chamando no WhatsApp…");
    let callId;
    try { ({ callId } = await api.waCallStart(threadId, pc.localDescription.sdp)); }
    catch (e) { cleanup(e?.message || "não deu pra iniciar a chamada"); return; }
    callIdRef.current = callId;
    setPhase("ringing");

    // Poll do estado. IMPORTANTE (visto nas chamadas reais): o SDP answer chega
    // com o telefone AINDA TOCANDO (é o caminho de mídia/ringback) — aplica o
    // áudio mas SEGUE em "chamando"; o cronômetro só dispara no atendimento de
    // verdade (evento da Meta ou o botão "atendeu"). Cap de 75s tocando.
    const startedAt = Date.now();
    const poll = setInterval(async () => {
      let st;
      try { st = await api.waCallState(callId); } catch { return; }
      if (st.sdpAnswer && pcRef.current && pcRef.current.signalingState === "have-local-offer") {
        try {
          await pcRef.current.setRemoteDescription({ type: "answer", sdp: st.sdpAnswer });
          if (phaseRef.current === "ringing") setNote("tocando no WhatsApp dele… o áudio abre sozinho quando atender");
        } catch (e) { await api.waCallEnd(callId).catch(() => {}); cleanup("falha no áudio: " + (e?.message || e)); return; }
      }
      if ((st.status === "accepted" || st.answeredAt) && phaseRef.current === "ringing") { markConnected(); return; }
      if (["rejected", "missed", "canceled", "ended"].includes(st.status)) {
        cleanup(st.status === "rejected" ? "o lead recusou" : st.status === "missed" ? "não atendeu" : "ligação encerrada");
        return;
      }
      if (phaseRef.current === "ringing" && Date.now() - startedAt > 75_000) {
        await api.waCallEnd(callId).catch(() => {});
        cleanup("não atendeu");
      }
    }, 1000);
    timersRef.current.push(poll);
  }

  // Atendeu de verdade: agora sim vira "em ligação" e o cronômetro parte do
  // zero. Vem do evento da Meta (poll) ou do clique manual do SDR — o botão
  // existe enquanto o journal de eventos calibra o nome real do atendimento.
  function markConnected() {
    if (phaseRef.current === "connected") return;
    setPhase("connected"); setNote("");
    const t0 = Date.now();
    timersRef.current.push(setInterval(() => setSecs(Math.round((Date.now() - t0) / 1000)), 1000));
  }

  async function endCall(msg = "ligação encerrada") {
    if (callIdRef.current) await api.waCallEnd(callIdRef.current).catch(() => {});
    cleanup(msg);
  }

  const active = phase === "prep" || phase === "ringing" || phase === "connected";
  const pill = { display: "inline-flex", alignItems: "center", gap: 5, height: 28, padding: "0 11px", borderRadius: "var(--r-2)", fontSize: 12, fontWeight: 600, cursor: "pointer", border: "1px solid var(--line-2)", background: "var(--bg-1)", color: "var(--fg-2)", flexShrink: 0 };

  return (
    <>
      <audio ref={audioRef} autoPlay style={{ display: "none" }} />
      {!active && (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          {/* O botão VERDE da conversa: com permissão aceita, "Ligar" é ligar
              MESMO — disca daqui, o lead atende no WhatsApp. */}
          <button onClick={start} style={{ ...pill, background: "#25D366", color: "#06120c", border: "none", fontWeight: 700 }}
            title="Disca agora pelo cockpit (áudio no navegador) — o lead atende a chamada no WhatsApp">
            ✆ Ligar
          </button>
          {phase === "done" && note && <span className="mono dim" style={{ fontSize: 10.5 }}>{note}</span>}
          {phase === "idle" && note && <span className="mono" style={{ fontSize: 10.5, color: "var(--warn)" }}>{note}</span>}
        </span>
      )}
      {active && (
        // No MEIO da conversa (pedido do Leo): centrado na tela, sem backdrop —
        // dá pra seguir digitando/lendo o chat com a ligação rolando.
        <div style={{
          position: "fixed", left: "50%", top: "50%", transform: "translate(-50%, -50%)", zIndex: 95,
          minWidth: 280, maxWidth: "min(360px, calc(100vw - 32px))",
          background: "var(--bg-1)", border: "1px solid var(--line-2)", borderRadius: "var(--r-3)",
          boxShadow: "var(--shadow-pop)", padding: 16, display: "flex", flexDirection: "column", gap: 10,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span className="led pulse" style={{ color: phase === "connected" ? "var(--pos)" : "var(--warn)" }} />
            <span style={{ fontSize: 13.5, fontWeight: 700 }}>{nameRef.current || contactName || "Ligação"}</span>
            {phase === "connected" && <span className="mono tnum" style={{ marginLeft: "auto", fontSize: 12.5 }}>{fmtDur(secs)}</span>}
          </div>
          <div className="mono dim" style={{ fontSize: 11 }}>
            {phase === "connected" ? "em ligação pelo WhatsApp" : note || "chamando…"}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {phase === "ringing" && (
              <button onClick={markConnected} title="Ele atendeu e o evento da Meta não chegou? Inicia a contagem daqui"
                style={{ flex: 1, height: 34, borderRadius: "var(--r-2)", fontSize: 12.5, fontWeight: 700, background: "var(--pos)", color: "#fff", border: "none", cursor: "pointer" }}>
                Atendeu
              </button>
            )}
            <button onClick={() => endCall(phase === "ringing" ? "chamada cancelada" : "ligação encerrada")} style={{
              flex: 1, height: 34, borderRadius: "var(--r-2)", fontSize: 12.5, fontWeight: 700,
              background: "var(--neg)", color: "#fff", border: "none", cursor: "pointer",
            }}>{phase === "ringing" ? "Cancelar" : "Encerrar"}</button>
          </div>
        </div>
      )}
    </>
  );
}
