import React from "react";
import { makeFocusAudio, FOCUS_AUDIO_MODES } from "../lib/focus-audio.js";

// Concha do modo foco dos treinamentos: tela cheia (Fullscreen API, com
// fallback pro overlay que já cobre tudo), fundo preto quase opaco, um glow
// na cor do produto "respirando" atrás do card e a barra de áudio discreta
// (ruído marrom · 40Hz binaural · lofi generativo — ver lib/focus-audio.js).
// O conteúdo (a sessão de cards) vem como children — a lógica fica no pai.

const { useState: useS, useEffect: useE, useRef: useR } = React;

export function FocusShell({ children, onExit }) {
  const audioRef = useR(null);
  if (!audioRef.current) audioRef.current = makeFocusAudio();
  const audio = audioRef.current;
  const [mode, setMode] = useS(null);
  const [vol, setVol] = useS(audio.volume);
  const rootRef = useR(null);

  useE(() => {
    const el = rootRef.current;
    el?.requestFullscreen?.().catch(() => { /* overlay já cobre a tela */ });
    // abrir o foco veio de um clique — mesmo gesto libera o autoplay do áudio
    const m = audio.lastMode || "brown";
    audio.start(m); setMode(m);

    // Esc: o navegador sai do fullscreen sozinho (só dispara fullscreenchange);
    // fora do fullscreen nativo, o keydown cobre.
    function onFsChange() { if (!document.fullscreenElement) onExit(); }
    function onKey(e) { if (e.key === "Escape") onExit(); }
    document.addEventListener("fullscreenchange", onFsChange);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("fullscreenchange", onFsChange);
      window.removeEventListener("keydown", onKey);
      audio.stop();
      if (document.fullscreenElement) document.exitFullscreen().catch(() => { /* ok */ });
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function toggleMode(m) {
    if (m === mode) { audio.stop(); setMode(null); }
    else { audio.start(m); setMode(m); }
  }

  const pill = (on) => ({
    height: 26, padding: "0 12px", borderRadius: 13, fontSize: 11, cursor: "pointer",
    fontFamily: "var(--mono)", letterSpacing: "0.04em",
    border: `1px solid ${on ? "var(--accent)" : "rgba(255,255,255,0.14)"}`,
    background: on ? "color-mix(in oklab, var(--accent) 22%, transparent)" : "transparent",
    color: on ? "var(--accent)" : "rgba(255,255,255,0.55)",
  });

  return (
    <div ref={rootRef} style={{
      position: "fixed", inset: 0, zIndex: 400, background: "rgba(4, 4, 6, 0.97)",
      backdropFilter: "blur(8px)", display: "flex", flexDirection: "column", overflow: "auto",
    }}>
      <style>{`@keyframes focusBreath {
        from { transform: scale(0.85); opacity: 0.65; }
        to   { transform: scale(1.15); opacity: 1; }
      }`}</style>

      {/* glow respirando atrás do card */}
      <div aria-hidden style={{ position: "fixed", inset: 0, display: "grid", placeItems: "center", pointerEvents: "none" }}>
        <div style={{
          width: "min(72vw, 880px)", height: "min(64vh, 620px)", borderRadius: "50%",
          background: "radial-gradient(closest-side, color-mix(in oklab, var(--accent) 38%, transparent), color-mix(in oklab, var(--accent) 14%, transparent) 55%, transparent 74%)",
          filter: "blur(46px)", animation: "focusBreath 7s ease-in-out infinite alternate",
        }} />
      </div>

      <button onClick={onExit} style={{
        position: "fixed", top: 18, right: 22, zIndex: 2, background: "transparent",
        border: "none", color: "rgba(255,255,255,0.4)", fontSize: 12, cursor: "pointer", fontFamily: "var(--mono)",
      }}>
        sair (esc)
      </button>

      {/* conteúdo (sessão) centralizado */}
      <div style={{ position: "relative", zIndex: 1, flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", padding: "56px 20px 88px" }}>
        {children}
      </div>

      {/* barra de áudio — quase invisível até o hover */}
      <div
        onMouseEnter={(e) => { e.currentTarget.style.opacity = 1; }}
        onMouseLeave={(e) => { e.currentTarget.style.opacity = 0.4; }}
        style={{
          position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 2,
          display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
          padding: "14px 20px 18px", opacity: 0.4, transition: "opacity 0.35s",
        }}>
        {FOCUS_AUDIO_MODES.map((m) => (
          <button key={m.id} onClick={() => toggleMode(m.id)} title={mode === m.id ? "clique pra silenciar" : ""}
            style={pill(mode === m.id)}>{m.label}</button>
        ))}
        <input type="range" min={0} max={1} step={0.02} value={vol}
          onChange={(e) => { const v = Number(e.target.value); setVol(v); audio.setVolume(v); }}
          style={{ width: 110, accentColor: "var(--accent)" }} />
        {mode === "wave40" && <span style={{ fontSize: 10.5, fontFamily: "var(--mono)", color: "rgba(255,255,255,0.45)" }}>use fones — o efeito é binaural</span>}
      </div>
    </div>
  );
}
