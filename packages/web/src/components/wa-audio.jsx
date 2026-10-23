import React from "react";
import { api } from "../lib/api.js";

// Player da nota de voz do WhatsApp (Inbox e chat do drawer): play/pausa,
// barra que pula pro ponto clicado, tempo e velocidade 1× → 1,5× → 2×. A
// velocidade vale pra todos os áudios e fica no navegador, como no WhatsApp;
// tocar um áudio pausa o que estava tocando. As cores saem de currentColor pra
// servir na bolha recebida, na enviada e na do robô, nos dois temas.
//
// Embaixo, a transcrição: já vem pronta quando o webhook/robô transcreveu
// (campo `transcript` da mensagem); senão, "Transcrever" pede ao servidor.

const RATES = [1, 1.5, 2];
const RATE_KEY = "wa-audio-rate";
let playing = null; // <audio> tocando agora

function savedRate() {
  try { const r = Number(localStorage.getItem(RATE_KEY)); return RATES.includes(r) ? r : 1; } catch { return 1; }
}
function saveRate(r) {
  try { localStorage.setItem(RATE_KEY, String(r)); } catch { /* só não lembra */ }
}
function clock(s) {
  if (!Number.isFinite(s) || s < 0) return "0:00";
  const t = Math.floor(s);
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
}

const tint = (pct) => `color-mix(in srgb, currentColor ${pct}%, transparent)`;

export function WaAudioPlayer({ src }) {
  const ref = React.useRef(null);
  const [on, setOn] = React.useState(false);
  const [cur, setCur] = React.useState(0);
  const [dur, setDur] = React.useState(0);
  const [rate, setRate] = React.useState(savedRate);

  React.useEffect(() => {
    const a = ref.current;
    if (!a) return;
    const readDur = () => {
      // Gravação do navegador (webm) chega sem duração: pular pro fim força o
      // cálculo e volta pro começo.
      if (a.duration === Infinity) {
        const fix = () => { a.removeEventListener("timeupdate", fix); a.currentTime = 0; setDur(a.duration); };
        a.addEventListener("timeupdate", fix);
        a.currentTime = 1e101;
        return;
      }
      setDur(a.duration);
    };
    const onPlay = () => {
      if (playing && playing !== a) playing.pause();
      playing = a;
      a.playbackRate = savedRate(); // outro player pode ter mudado a velocidade
      setRate(a.playbackRate);
      setOn(true);
    };
    const onPause = () => { if (playing === a) playing = null; setOn(false); };
    const onEnded = () => { onPause(); a.currentTime = 0; setCur(0); };
    const onTime = () => setCur(a.currentTime);
    a.addEventListener("loadedmetadata", readDur);
    a.addEventListener("play", onPlay);
    a.addEventListener("pause", onPause);
    a.addEventListener("ended", onEnded);
    a.addEventListener("timeupdate", onTime);
    return () => {
      a.removeEventListener("loadedmetadata", readDur);
      a.removeEventListener("play", onPlay);
      a.removeEventListener("pause", onPause);
      a.removeEventListener("ended", onEnded);
      a.removeEventListener("timeupdate", onTime);
      if (playing === a) { a.pause(); playing = null; }
    };
  }, [src]);

  const toggle = () => {
    const a = ref.current;
    if (!a) return;
    if (a.paused) a.play().catch(() => {}); else a.pause();
  };
  const cycleRate = () => {
    const next = RATES[(RATES.indexOf(rate) + 1) % RATES.length];
    saveRate(next);
    setRate(next);
    if (ref.current) ref.current.playbackRate = next;
  };
  const seekTo = (sec) => {
    const a = ref.current;
    if (!a || !Number.isFinite(dur) || dur <= 0) return;
    a.currentTime = Math.min(Math.max(sec, 0), dur);
    setCur(a.currentTime);
  };
  const onBar = (e) => {
    const box = e.currentTarget.getBoundingClientRect();
    seekTo(((e.clientX - box.left) / box.width) * dur);
  };
  const onBarKey = (e) => {
    if (e.key === "ArrowRight") { e.preventDefault(); seekTo(cur + 5); }
    if (e.key === "ArrowLeft") { e.preventDefault(); seekTo(cur - 5); }
  };

  const pct = dur > 0 && Number.isFinite(dur) ? Math.min(100, (cur / dur) * 100) : 0;
  const shown = on || cur > 0 ? cur : dur;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, width: 250, maxWidth: "100%" }}>
      <audio ref={ref} src={src} preload="metadata" style={{ display: "none" }} />
      <button type="button" onClick={toggle} aria-label={on ? "pausar áudio" : "tocar áudio"}
        style={{ flex: "none", width: 30, height: 30, borderRadius: 999, border: "none", padding: 0, cursor: "pointer", display: "grid", placeItems: "center", background: tint(12), color: "inherit" }}>
        {on ? (
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><rect x="2" y="1.5" width="2.8" height="9" rx="0.8" fill="currentColor" /><rect x="7.2" y="1.5" width="2.8" height="9" rx="0.8" fill="currentColor" /></svg>
        ) : (
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 1.6v8.8a.6.6 0 0 0 .9.5l7-4.4a.6.6 0 0 0 0-1L3.9 1.1a.6.6 0 0 0-.9.5Z" fill="currentColor" /></svg>
        )}
      </button>
      <div role="slider" tabIndex={0} aria-label="posição do áudio" aria-valuemin={0} aria-valuemax={Math.round(dur) || 0} aria-valuenow={Math.round(cur)}
        onClick={onBar} onKeyDown={onBarKey}
        style={{ flex: 1, minWidth: 0, height: 18, display: "flex", alignItems: "center", cursor: "pointer" }}>
        <div style={{ position: "relative", width: "100%", height: 4, borderRadius: 999, background: tint(18) }}>
          <div style={{ position: "absolute", inset: 0, width: `${pct}%`, borderRadius: 999, background: tint(70) }} />
          <div style={{ position: "absolute", top: "50%", left: `${pct}%`, width: 10, height: 10, marginLeft: -5, marginTop: -5, borderRadius: 999, background: "currentColor" }} />
        </div>
      </div>
      <span className="tnum" style={{ flex: "none", fontSize: 10.5, opacity: 0.75, minWidth: 30, textAlign: "right" }}>{clock(shown)}</span>
      <button type="button" onClick={cycleRate} aria-label={`velocidade ${rate}x, trocar`} title="velocidade"
        style={{ flex: "none", minWidth: 36, height: 22, borderRadius: 999, border: "none", padding: "0 7px", cursor: "pointer", fontFamily: "var(--mono)", fontSize: 10.5, fontWeight: rate === 1 ? 500 : 700, background: tint(rate === 1 ? 10 : 20), color: "inherit" }}>
        {String(rate).replace(".", ",")}×
      </button>
    </div>
  );
}

// Transcrição debaixo do player. `msg.transcript` chega pelo polling da
// conversa; o texto pedido aqui fica local até o próximo refresh trazê-lo.
export function WaAudioTranscript({ msg }) {
  const [text, setText] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [note, setNote] = React.useState("");
  const transcript = msg.transcript || text;

  const run = () => {
    setBusy(true);
    setNote("");
    api.waTranscribe(msg.id)
      .then((r) => { if (r?.transcript) setText(r.transcript); else setNote("nenhuma fala reconhecida"); })
      .catch((e) => setNote(e?.message || "não deu pra transcrever"))
      .finally(() => setBusy(false));
  };

  if (transcript) {
    return <div style={{ marginTop: 6, paddingTop: 6, borderTop: `1px solid ${tint(15)}`, fontSize: "0.95em", lineHeight: 1.45, opacity: 0.85, whiteSpace: "pre-wrap" }}>{transcript}</div>;
  }
  return (
    <div style={{ marginTop: 4, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: 11 }}>
      <button type="button" onClick={run} disabled={busy}
        style={{ background: "none", border: "none", padding: 0, cursor: busy ? "default" : "pointer", color: "inherit", fontSize: 11, opacity: 0.8, textDecoration: busy ? "none" : "underline" }}>
        {busy ? "transcrevendo…" : "Transcrever"}
      </button>
      {note && <span style={{ opacity: 0.7 }}>{note}</span>}
    </div>
  );
}
