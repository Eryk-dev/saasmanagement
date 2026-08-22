// Copiloto da call (Leo, 22/08/2026): o closer clica em iniciar, escolhe a ABA
// do Meet (marcando "compartilhar áudio da guia") e o cockpit passa a ouvir a
// call: microfone no canal esquerdo, aba no direito (mesmo desenho estéreo da
// ligação do WhatsApp, uma voz por canal). A cada ~15s um pedaço vai pro
// servidor, vira texto, e a cada ~45s a IA devolve: etapas do roteiro já
// cobertas, objeção detectada com resposta pronta e a sugestão da vez.
//
// Por que captura no browser e não a Meet Media API: a Media API está em
// Developer Preview e exige todos os participantes inscritos no programa,
// impossível com o lead. Quando virar GA, troca-se a captação e o painel fica.
import React from "react";
import { api } from "../lib/api.js";
import { DEFAULT_SCRIPTS } from "../lib/scripts.js";

const { useState: useS, useEffect: useE, useRef: useR } = React;

const CHUNK_MS = 15_000; // pedaço fechado e enviado a cada 15s (webm válido por reinício do recorder)

// Checklist = os passos do roteiro da call (a mesma fonte do painel que o
// closer já lê). Título só; a fala/dica ficam no roteiro.
const callChecklist = () =>
  (DEFAULT_SCRIPTS.call?.passos || []).map((p, i) => ({ id: `p${i + 1}`, label: p.t }));

export function CallCopilot({ lead }) {
  const [phase, setPhase] = useS("idle"); // idle | arming | live | stopping
  const [err, setErr] = useS(null);
  const [state, setState] = useS(null);   // GET /copilot
  const [elapsed, setElapsed] = useS(0);
  const live = useR(false);
  const media = useR(null); // { streams, ctx, dest, mime, timer }

  useE(() => () => { live.current = false; teardown(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function teardown() {
    const m = media.current;
    if (!m) return;
    try { clearTimeout(m.timer); } catch { /* ok */ }
    for (const s of m.streams || []) for (const t of s.getTracks()) { try { t.stop(); } catch { /* ok */ } }
    try { m.ctx?.close(); } catch { /* ok */ }
    media.current = null;
  }

  // Um ciclo de gravação: recorder novo → 15s → stop → blob completo → upload →
  // próximo ciclo. Reiniciar o MediaRecorder (em vez de timeslice) garante que
  // CADA pedaço é um webm válido sozinho — timeslice só manda header no 1º.
  function cycle() {
    const m = media.current;
    if (!m || !live.current) return;
    let chunks = [];
    const rec = new MediaRecorder(m.dest.stream, m.mime ? { mimeType: m.mime, audioBitsPerSecond: 40000 } : undefined);
    rec.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data); };
    rec.onstop = async () => {
      const blob = new Blob(chunks, { type: m.mime || "audio/webm" });
      chunks = [];
      if (live.current) cycle(); // o próximo ciclo começa JÁ (sem buraco de áudio)
      if (blob.size > 2000) {
        try {
          const r = await api.copilotChunk(lead.id, blob);
          if (r?.cues || r?.text) setState((prev) => prev ? { ...prev, cues: r.cues || prev.cues } : prev);
        } catch { /* pedaço perdido não derruba a call — o próximo segue */ }
      }
    };
    try { rec.start(); } catch { setErr("gravador falhou — reinicie o copiloto"); return; }
    m.timer = setTimeout(() => { try { rec.state !== "inactive" && rec.stop(); } catch { /* ok */ } }, CHUNK_MS);
  }

  async function start() {
    setErr(null); setPhase("arming");
    try {
      // 1) microfone (o closer) …
      const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
      // 2) … e a ABA do Meet (o cliente). O Chrome exige vídeo no picker; o
      // track de vídeo é parado na sequência, só o áudio interessa.
      const disp = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      for (const t of disp.getVideoTracks()) t.stop();
      if (!disp.getAudioTracks().length) {
        for (const t of [...mic.getTracks(), ...disp.getTracks()]) t.stop();
        setPhase("idle");
        setErr("a aba veio SEM áudio. Reinicie e, na janelinha do Chrome, escolha a guia do Meet e marque “Compartilhar áudio da guia”.");
        return;
      }
      // Estéreo: mic → esquerda (Vendedor), aba → direita (Cliente).
      const Ctx = window.AudioContext || window.webkitAudioContext;
      const ctx = new Ctx();
      const merger = ctx.createChannelMerger(2);
      const dest = ctx.createMediaStreamDestination();
      ctx.createMediaStreamSource(mic).connect(merger, 0, 0);
      ctx.createMediaStreamSource(new MediaStream(disp.getAudioTracks())).connect(merger, 0, 1);
      merger.connect(dest);
      const mime = ["audio/webm;codecs=opus", "audio/webm"].find((x) => MediaRecorder.isTypeSupported?.(x)) || "";
      media.current = { streams: [mic, disp], ctx, dest, mime, timer: null };

      await api.copilotStart(lead.id, callChecklist());
      live.current = true;
      setPhase("live"); setElapsed(0);
      cycle();
      // se o closer parar o compartilhamento pelo aviso do Chrome, encerra junto
      disp.getAudioTracks()[0].addEventListener("ended", stop);
    } catch (e) {
      teardown(); setPhase("idle");
      if (e?.name !== "NotAllowedError") setErr(e.message || "não deu pra iniciar a captura");
    }
  }

  async function stop() {
    if (!live.current) return;
    live.current = false; setPhase("stopping");
    teardown();
    try { await api.copilotStop(lead.id); } catch { /* ok */ }
    setPhase("idle");
    try { setState(await api.copilotStatus(lead.id)); } catch { /* ok */ }
  }

  // Polling do estado enquanto a sessão roda (cues + checklist pintado).
  useE(() => {
    if (phase !== "live") return;
    let alive = true;
    const iv = setInterval(async () => {
      try { const s = await api.copilotStatus(lead.id); if (alive) setState(s); } catch { /* ok */ }
      if (alive) setElapsed((e) => e + 6);
    }, 6000);
    return () => { alive = false; clearInterval(iv); };
  }, [phase, lead.id]);

  const checklist = state?.checklist?.length ? state.checklist : callChecklist();
  const doneIds = new Set((state?.cues?.steps || []).filter((x) => x.done).map((x) => x.id));
  const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const ss = String(elapsed % 60).padStart(2, "0");

  return (
    <div style={{ border: "1px solid var(--line-1)", borderRadius: "var(--r-3)", background: "var(--bg-inset)", padding: "10px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span className="kicker accent">Copiloto da call</span>
        {phase === "live" && <span className="mono tnum" style={{ fontSize: 11, color: "var(--neg)" }}>● {mm}:{ss}</span>}
        <span style={{ flex: 1 }} />
        {phase === "idle" && (
          <button onClick={start}
            title={'Ouve a call ao vivo e orienta: transcrição em tempo real, etapas do roteiro se marcando e resposta pronta quando cair objeção. Na janelinha do Chrome, escolha a GUIA do Meet e marque "Compartilhar áudio da guia".'}
            style={{ height: 28, padding: "0 12px", borderRadius: "var(--r-2)", background: "var(--btn-bg, var(--accent))", color: "var(--btn-fg, var(--accent-fg))", fontSize: 11.5, fontWeight: 600 }}>
            🎙 iniciar
          </button>
        )}
        {phase === "arming" && <span className="mono dim" style={{ fontSize: 11 }}>escolha a guia do Meet e marque "compartilhar áudio da guia"…</span>}
        {(phase === "live" || phase === "stopping") && (
          <button onClick={stop} disabled={phase === "stopping"} style={{ height: 28, padding: "0 12px", borderRadius: "var(--r-2)", border: "1px solid var(--neg)", color: "var(--neg)", background: "transparent", fontSize: 11.5, fontWeight: 600 }}>
            {phase === "stopping" ? "salvando…" : "■ parar"}
          </button>
        )}
      </div>
      {err && <div className="mono" style={{ fontSize: 11, color: "var(--neg)" }}>{err}</div>}

      {(phase === "live" || state?.cues) && (<>
        {/* Checklist do pitch se marcando sozinho */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
          {checklist.map((c) => (
            <span key={c.id} title={c.label}
              style={{ fontSize: 10.5, padding: "2px 8px", borderRadius: 999, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                background: doneIds.has(c.id) ? "var(--accent-soft)" : "var(--bg-1)",
                color: doneIds.has(c.id) ? "var(--accent)" : "var(--fg-4)",
                border: "1px solid " + (doneIds.has(c.id) ? "var(--accent-line)" : "var(--line-1)") }}>
              {doneIds.has(c.id) ? "✓ " : ""}{c.label.split(" · ")[0]}
            </span>
          ))}
        </div>
        {/* Objeção detectada + resposta pronta */}
        {state?.cues?.objecao && (
          <div style={{ border: "1px solid var(--warn)", borderRadius: "var(--r-2)", background: "var(--warn-soft)", padding: "8px 10px" }}>
            <div className="kicker" style={{ color: "var(--warn)" }}>objeção: {state.cues.objecao.resumo}</div>
            <div style={{ fontSize: 12.5, marginTop: 4, lineHeight: 1.45 }}>{state.cues.objecao.resposta}</div>
            <button className="mono dim" style={{ fontSize: 10.5, marginTop: 4 }}
              onClick={() => navigator.clipboard?.writeText(state.cues.objecao.resposta)}>copiar resposta</button>
          </div>
        )}
        {/* A sugestão da vez + alerta de processo */}
        {state?.cues?.sugestao && (
          <div style={{ fontSize: 12.5, lineHeight: 1.45 }}>
            <span className="kicker accent">agora </span>{state.cues.sugestao}
          </div>
        )}
        {state?.cues?.alerta && <div className="mono" style={{ fontSize: 11, color: "var(--warn)" }}>⚠ {state.cues.alerta}</div>}
        {/* Transcrição (cauda) — colapsada por padrão, ninguém lê em call */}
        {state?.transcriptTail && (
          <details>
            <summary className="mono dim" style={{ fontSize: 10.5, cursor: "pointer" }}>transcrição ao vivo ({Math.round((state.chars || 0) / 1000)}k)</summary>
            <div className="mono" style={{ fontSize: 10.5, whiteSpace: "pre-wrap", maxHeight: 140, overflow: "auto", color: "var(--fg-3)", marginTop: 4 }}>{state.transcriptTail}</div>
          </details>
        )}
      </>)}
    </div>
  );
}
