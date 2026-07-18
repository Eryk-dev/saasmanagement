import React from "react";
import { api } from "../lib/api.js";
import { useData } from "../data.jsx";
import { currentUser, userById } from "../lib/users.js";

// Pop-up de lead quente do WhatsApp (fluxo de permissão de ligação): quando o
// lead responde com o fluxo aberto, o alerta salta em QUALQUER tela pro SDR
// responder na hora — o timing do lead quente é a taxa de conexão. Responder
// daqui (ou qualquer envio na conversa) resolve o alerta pra todo mundo via
// SSE; "depois" só esconde NESTA sessão por alguns minutos.

const SNOOZE_MS = 5 * 60_000;

// Bip curto de atenção (WebAudio). Navegador sem gesto prévio bloqueia — ok.
function beep() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.frequency.value = 880; g.gain.value = 0.05;
    o.start();
    o.frequency.setValueAtTime(660, ctx.currentTime + 0.12);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.35);
    o.stop(ctx.currentTime + 0.4);
    setTimeout(() => ctx.close().catch(() => {}), 500);
  } catch { /* sem som, sem drama */ }
}

function ago(iso) {
  const ms = Date.now() - new Date(iso || 0).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "";
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  return `há ${Math.floor(min / 60)} h`;
}

export function WaHotAlert({ onOpenThread }) {
  const { version } = useData();
  const [alerts, setAlerts] = React.useState([]);
  const [reply, setReply] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState("");
  const [, force] = React.useReducer((x) => x + 1, 0); // re-render pós-snooze
  const snoozed = React.useRef(new Map()); // alertId -> timestamp até quando fica escondido
  const seen = React.useRef(new Set());    // ids que já biparam
  const fails = React.useRef(0);           // 403 (tela restrita) desliga o componente
  const box = React.useRef(null);

  React.useEffect(() => {
    if (fails.current >= 2) return;
    let alive = true;
    api.waAlerts()
      .then((r) => { if (!alive) return; fails.current = 0; setAlerts(r.alerts || []); })
      .catch(() => { fails.current += 1; });
    return () => { alive = false; };
  }, [version]);

  // Escopo por produto do usuário (Ana só vê UniqueKids); sem usuário casado,
  // mostra tudo — alerta perdido é pior que alerta a mais.
  const me = userById(currentUser()?.id || "");
  const now = Date.now();
  const visible = alerts.filter((a) => {
    if (me?.saas && a.saas && a.saas !== me.saas) return false;
    const until = snoozed.current.get(a.id) || 0;
    return until < now;
  });
  const cur = visible[0] || null;

  // Bip só quando um alerta NOVO aparece (não re-bipa a cada tick do SSE).
  React.useEffect(() => {
    let fresh = false;
    for (const a of visible) if (!seen.current.has(a.id)) { seen.current.add(a.id); fresh = true; }
    if (fresh) beep();
  }, [visible.map((a) => a.id).join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  // Alerta trocou → limpa o rascunho e foca a resposta.
  React.useEffect(() => {
    setReply(""); setErr("");
    const t = setTimeout(() => box.current?.focus?.(), 60);
    return () => clearTimeout(t);
  }, [cur?.id]);

  if (!cur) return null;

  const saasName = (window.SEED?.SAAS || []).find((s) => s.id === cur.saas)?.name || cur.saas || "";
  const accepted = cur.permission === "accepted";
  const declined = cur.permission === "declined";

  function snooze(id, ms = SNOOZE_MS) {
    snoozed.current.set(id, Date.now() + ms);
    force();
  }
  async function send() {
    const text = reply.trim();
    if (!text || busy) return;
    setBusy(true); setErr("");
    try {
      await api.waThreadSend(cur.thread, text); // o servidor resolve o alerta pra todo mundo
      setAlerts((a) => a.filter((x) => x.id !== cur.id));
      setReply("");
    } catch (e) { setErr(e.message || "não deu pra enviar"); }
    setBusy(false);
  }
  async function done() {
    if (busy) return;
    setBusy(true);
    try { await api.waAlertDone(cur.id); setAlerts((a) => a.filter((x) => x.id !== cur.id)); }
    catch { snooze(cur.id); }
    setBusy(false);
  }
  function open() {
    snooze(cur.id, 10 * 60_000); // o SDR está NA conversa; o pop-up não precisa cobrir o inbox
    onOpenThread?.(cur);
  }

  const btn = { height: 30, padding: "0 12px", borderRadius: "var(--r-2)", border: "1px solid var(--line-2)", background: "var(--bg-1)", color: "var(--fg-2)", fontSize: 12, fontWeight: 600, cursor: "pointer" };
  const chipStyle = (bg, fg) => ({ display: "inline-flex", alignItems: "center", gap: 5, height: 22, padding: "0 9px", borderRadius: 999, fontSize: 11, fontWeight: 700, background: bg, color: fg });

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 110, background: "color-mix(in srgb, var(--bg-0) 55%, transparent)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ width: 480, maxWidth: "94vw", background: "var(--bg-1)", border: "1px solid var(--line-1)", borderRadius: "var(--r-3)", boxShadow: "0 24px 80px -24px rgba(0,0,0,.45)", overflow: "hidden" }}>
        <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--line-1)", display: "flex", alignItems: "center", gap: 10, background: "var(--bg-2)" }}>
          <span style={{ fontSize: 16 }}>🔥</span>
          <span className="mono" style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--fg-1)", flex: 1 }}>
            Lead respondeu no WhatsApp
          </span>
          {visible.length > 1 && <span className="mono dim" style={{ fontSize: 10.5 }}>+{visible.length - 1} esperando</span>}
          {saasName && <span className="mono" style={{ fontSize: 10, color: "var(--fg-3)", border: "1px solid var(--line-2)", borderRadius: 999, padding: "2px 8px" }}>{saasName}</span>}
        </div>

        <div style={{ padding: "14px 16px" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 15.5, fontWeight: 700 }}>{cur.name || "+" + cur.phone}</span>
            {cur.stage && <span className="mono dim" style={{ fontSize: 11 }}>{cur.stage}</span>}
            <span className="mono dim" style={{ fontSize: 11, marginLeft: "auto" }}>{ago(cur.at)}</span>
          </div>

          {accepted && <div style={{ marginTop: 8 }}><span style={chipStyle("var(--pos-soft, #DCFCE7)", "var(--pos, #15803D)")}>✆ topou receber a ligação, liga AGORA</span></div>}
          {declined && <div style={{ marginTop: 8 }}><span style={chipStyle("var(--warn-soft, #FEF3C7)", "var(--warn, #B45309)")}>prefere sem ligação, resolve por mensagem</span></div>}

          <div style={{ marginTop: 10, padding: "10px 12px", background: "var(--bg-2)", border: "1px solid var(--line-1)", borderRadius: "var(--r-2)", fontSize: 13.5, lineHeight: 1.45, color: "var(--fg-1)" }}>
            {cur.text || "…"}
          </div>

          <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
            {accepted ? (
              <button style={{ ...btn, height: 26, fontSize: 11 }} onClick={() => setReply("Perfeito! Vou te ligar agora, tá?")}>usar: vou te ligar agora</button>
            ) : (
              <button style={{ ...btn, height: 26, fontSize: 11 }} onClick={() => setReply("Consigo te ligar hoje ainda. Qual horário fica melhor pra você?")}>usar: propor horário</button>
            )}
          </div>

          <textarea ref={box} value={reply} onChange={(e) => setReply(e.target.value)} rows={2}
            placeholder="responde na hora que o lead está quente…"
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            style={{ width: "100%", marginTop: 10, padding: "9px 11px", background: "var(--bg-0)", border: "1px solid var(--line-2)", borderRadius: "var(--r-2)", color: "var(--fg-1)", fontSize: 13, resize: "vertical", fontFamily: "inherit" }} />
          {err && <div style={{ marginTop: 6, fontSize: 12, color: "var(--neg)" }}>{err}</div>}

          <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center" }}>
            <button onClick={send} disabled={busy || !reply.trim()}
              style={{ ...btn, background: "#25D366", borderColor: "transparent", color: "#06120c", fontWeight: 700, opacity: busy || !reply.trim() ? 0.6 : 1 }}>
              Responder agora
            </button>
            <button onClick={open} style={btn}>Abrir conversa</button>
            <span style={{ flex: 1 }} />
            <button onClick={done} style={{ ...btn, borderColor: "transparent", background: "transparent" }} title="fecha o alerta pra todo mundo sem responder (ex.: vai ligar por fora)">resolvido</button>
            <button onClick={() => snooze(cur.id)} style={{ ...btn, borderColor: "transparent", background: "transparent", color: "var(--fg-4)" }} title="esconde só pra você por 5 minutos">depois</button>
          </div>
        </div>
      </div>
    </div>
  );
}
