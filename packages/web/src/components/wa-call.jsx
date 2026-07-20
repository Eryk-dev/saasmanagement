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

// Gravação da ligação: os dois lados passam por AQUI (o microfone é nosso e a
// voz do lead chega pelo WebRTC), então dá pra gravar em ESTÉREO com uma voz
// em cada canal — nós na esquerda, o lead na direita. Isso entrega a separação
// de quem falou o quê pra transcrição de graça, sem depender de diarização.
// Navegador sem MediaRecorder/AudioContext simplesmente não grava: a ligação
// nunca pode quebrar por causa disso.
function makeRecorder(micStream) {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx || typeof MediaRecorder === "undefined") return null;
    const ctx = new Ctx();
    const merger = ctx.createChannelMerger(2);
    const dest = ctx.createMediaStreamDestination();
    merger.connect(dest);
    ctx.createMediaStreamSource(micStream).connect(merger, 0, 0); // eu → esquerda
    const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((m) => MediaRecorder.isTypeSupported?.(m)) || "";
    const rec = new MediaRecorder(dest.stream, mime ? { mimeType: mime, audioBitsPerSecond: 32000 } : undefined);
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data); };
    return {
      ctx, merger, rec, chunks, mime: mime || "audio/webm",
      // A faixa do lead chega depois (ontrack): pluga no canal da direita.
      addRemote(stream) { try { ctx.createMediaStreamSource(stream).connect(merger, 0, 1); } catch { /* sem o lado dele, grava o nosso */ } },
      start() { try { rec.start(1000); } catch { /* segue sem gravar */ } },
      // Devolve o arquivo fechado (o último chunk só chega no onstop).
      stop() {
        return new Promise((resolve) => {
          if (rec.state === "inactive") return resolve(chunks.length ? new Blob(chunks, { type: mime || "audio/webm" }) : null);
          rec.onstop = () => resolve(chunks.length ? new Blob(chunks, { type: mime || "audio/webm" }) : null);
          try { rec.stop(); } catch { resolve(null); }
        }).finally(() => { try { ctx.close(); } catch { /* já fechado */ } });
      },
    };
  } catch { return null; }
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
  const recRef = useR(null);
  const connectedAtRef = useR(0);
  const aliveRef = useR(true); // componente ainda montado (o upload sobrevive a ele)
  // Nome congelado no início da chamada: trocar de conversa no meio não pode
  // trocar o rótulo do card (a ligação segue com quem atendeu).
  const nameRef = useR("");

  const clearTimers = () => { timersRef.current.forEach(clearInterval); timersRef.current = []; };

  // Fecha a gravação e manda pro servidor transcrever. Chamada curta (< 8s) ou
  // que ninguém atendeu não vale transcrição — só custo.
  async function flushRecording(callId) {
    const r = recRef.current;
    recRef.current = null;
    if (!r) return;
    const secs = connectedAtRef.current ? Math.round((Date.now() - connectedAtRef.current) / 1000) : 0;
    const blob = await r.stop().catch(() => null);
    if (!blob || !callId || secs < 8) return;
    const say = (t) => { if (aliveRef.current) setNote(t); };
    say("transcrevendo a ligação…");
    try {
      const res = await api.waCallRecording(callId, blob, secs);
      say(res?.summarized ? "transcrição e resumo no histórico do lead ✓" : res?.skipped ? "" : "transcrição salva na ligação ✓");
    } catch (e) {
      // Transcrição é bônus: a ligação já aconteceu, então o erro só informa.
      say(`ligação encerrada · transcrição falhou (${String(e.message || e).slice(0, 60)})`);
    }
  }

  // phase dentro dos callbacks (poll/ICE) sem stale closure.
  const phaseRef = useR(phase);
  useE(() => { phaseRef.current = phase; }, [phase]);

  function cleanup(finalNote) {
    clearTimers();
    try { micRef.current?.getTracks().forEach((t) => t.stop()); } catch { /* já parado */ }
    try { pcRef.current?.close(); } catch { /* já fechada */ }
    pcRef.current = null; micRef.current = null;
    if (finalNote != null) { setNote(finalNote); setPhase("done"); }
    // Fim por qualquer caminho (lead desligou, ICE caiu, botão): a gravação
    // sobe do mesmo jeito. Segunda chamada é no-op (o ref já foi zerado).
    flushRecording(callIdRef.current);
  }

  // Sair da conversa/tela com chamada viva: encerra pra não ficar tocando.
  useE(() => () => {
    aliveRef.current = false;
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
    recRef.current = makeRecorder(mic);
    connectedAtRef.current = 0;

    const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
    pcRef.current = pc;
    mic.getTracks().forEach((t) => pc.addTrack(t, mic));
    pc.ontrack = (ev) => {
      const stream = ev.streams[0] || new MediaStream([ev.track]);
      if (audioRef.current) audioRef.current.srcObject = stream;
      recRef.current?.addRemote(stream); // a voz dele entra no canal direito
    };
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
    connectedAtRef.current = t0;
    // Grava só a CONVERSA (do atendimento em diante), não o tempo tocando.
    recRef.current?.start();
    timersRef.current.push(setInterval(() => setSecs(Math.round((Date.now() - t0) / 1000)), 1000));
  }

  async function endCall(msg = "ligação encerrada") {
    const callId = callIdRef.current;
    if (callId) await api.waCallEnd(callId).catch(() => {});
    cleanup(msg);
    flushRecording(callId); // em segundo plano: o card já mostra o resultado
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
          {/* Gravando à vista: quem está na ligação precisa saber (e avisar o
              cliente) — gravação escondida não se faz. */}
          {phase === "connected" && recRef.current && (
            <div className="mono" style={{ fontSize: 10, color: "var(--neg)", display: "flex", alignItems: "center", gap: 5 }}>
              <span style={{ width: 7, height: 7, borderRadius: 99, background: "var(--neg)", flexShrink: 0 }} />
              gravando · vira transcrição e resumo no card do lead
            </div>
          )}
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
