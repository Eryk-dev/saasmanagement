import React from "react";
import { api } from "../lib/api.js";
import { Avatar, useEsc, toast } from "../atoms.jsx";
import { displayName, canSeeScreen } from "../lib/users.js";
import { setActiveSaas, getActiveSaasId } from "../lib/workspace.js";
import { useIsMobile } from "../lib/responsive.js";
import { taskHash } from "../lib/tasks.js";

// Sino da topbar: caixa de entrada das tarefas (atribuído, mencionado,
// comentário, prazo). Badge de não lidas; abas Todas / Menções / Atribuídas;
// clicar abre a tarefa (#tasks/<id>, trocando o workspace se for de outro
// produto) e marca como lida. Atualiza pelo cockpit-change (notifications) e
// a cada 60s com a aba visível.

const { useState, useEffect, useRef, useCallback } = React;

function when(iso) {
  if (!iso) return "";
  const d = new Date(iso); const diff = Date.now() - d.getTime();
  if (diff < 60_000) return "agora";
  if (diff < 3_600_000) return `há ${Math.round(diff / 60_000)} min`;
  if (diff < 86_400_000) return `há ${Math.round(diff / 3_600_000)} h`;
  return d.toLocaleDateString("pt-BR", { day: "numeric", month: "short" }).replace(".", "");
}
const TABS = [["all", "Todas"], ["mention", "Menções"], ["assigned", "Atribuídas a mim"]];
const inTab = (n, tab) => tab === "all" || (tab === "mention" ? n.type === "mention" : n.type === "assigned");

export function NotificationsBell() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState("all");
  const [items, setItems] = useState(null);
  const [unread, setUnread] = useState(0);
  const ref = useRef(null);
  const isMobile = useIsMobile();
  useEsc(open ? () => setOpen(false) : null);

  const load = useCallback(async (full = false) => {
    try {
      const r = await api.notifications(!full && !open);
      setUnread(r.unread || 0);
      if (full || open) setItems(r.items || []);
    } catch { /* sem sessão ou API fora: o sino só não conta */ }
  }, [open]);
  useEffect(() => { load(open); }, [open, load]);
  useEffect(() => {
    let t = 0;
    const on = (e) => { if (e.detail?.collection !== "notifications") return; clearTimeout(t); t = setTimeout(() => load(open), 500); };
    const iv = setInterval(() => { if (!document.hidden) load(open); }, 60_000);
    const onVis = () => { if (!document.hidden) load(open); };
    window.addEventListener("cockpit-change", on);
    document.addEventListener("visibilitychange", onVis);
    return () => { clearTimeout(t); clearInterval(iv); window.removeEventListener("cockpit-change", on); document.removeEventListener("visibilitychange", onVis); };
  }, [load, open]);
  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const markAll = async () => {
    try { await api.notificationsRead({ all: true }); setItems((l) => (l || []).map((n) => ({ ...n, read: true }))); setUnread(0); }
    catch (err) { toast(`Não deu pra marcar como lidas · ${err.message}`, "neg"); }
  };
  const openItem = async (n) => {
    if (!n.read) {
      setItems((l) => (l || []).map((x) => (x.id === n.id ? { ...x, read: true } : x)));
      setUnread((u) => Math.max(0, u - 1));
      api.notificationsRead({ ids: [n.id] }).catch(() => {});
    }
    setOpen(false);
    if (!n.task) return;
    if (!canSeeScreen("tasks")) { toast("Você não tem acesso à tela de Tarefas", "warn"); return; }
    if (n.saas && n.saas !== getActiveSaasId()) setActiveSaas(n.saas);
    location.hash = taskHash(n.task);
  };
  const list = (items || []).filter((n) => inTab(n, tab));
  const count = (k) => (items || []).filter((n) => !n.read && inTab(n, k)).length;

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button type="button" onClick={() => setOpen((o) => !o)} title="Caixa de entrada" aria-label={`Caixa de entrada${unread ? `, ${unread} não lidas` : ""}`}
        style={{ position: "relative", width: 34, height: 34, borderRadius: "var(--r-2)", display: "inline-flex", alignItems: "center", justifyContent: "center", color: "var(--fg-3)", background: open ? "var(--hover)" : "transparent" }}>
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10 21a2 2 0 0 0 4 0" /></svg>
        {unread > 0 && <span className="tnum" style={{ position: "absolute", top: 2, right: 2, minWidth: 16, height: 16, padding: "0 4px", borderRadius: 999, background: "var(--fg-1)", color: "var(--bg-1)", fontSize: 10.5, fontWeight: 700, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>{unread > 9 ? "9+" : unread}</span>}
      </button>
      {open && (
        <div role="dialog" aria-label="Caixa de entrada" style={isMobile
          ? { position: "fixed", left: 8, right: 8, top: 64, zIndex: 80, background: "var(--bg-1)", border: "1px solid var(--line-2)", borderRadius: "var(--r-3)", boxShadow: "var(--shadow-pop)", maxHeight: "70vh", display: "flex", flexDirection: "column" }
          : { position: "absolute", top: "calc(100% + 5px)", right: 0, width: 400, zIndex: 80, background: "var(--bg-1)", border: "1px solid var(--line-2)", borderRadius: "var(--r-3)", boxShadow: "var(--shadow-pop)", maxHeight: "min(70vh, 560px)", display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 14px 6px" }}>
            <span className="card-title">Caixa de entrada</span>
            <button type="button" onClick={markAll} disabled={!unread} style={{ marginLeft: "auto", fontSize: 12, color: unread ? "var(--accent)" : "var(--fg-4)", fontWeight: 600 }}>Marcar todas como lidas</button>
          </div>
          <div style={{ display: "flex", gap: 2, padding: "0 10px 8px" }}>
            {TABS.map(([k, l]) => (
              <button key={k} type="button" onClick={() => setTab(k)} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "5px 10px", borderRadius: "var(--r-2)", fontSize: 12.5, fontWeight: tab === k ? 600 : 500, background: tab === k ? "var(--bg-2)" : "transparent", color: tab === k ? "var(--fg-1)" : "var(--fg-3)" }}>
                {l}{count(k) > 0 && <span className="tnum" style={{ fontSize: 11, color: "var(--fg-4)" }}>{count(k)}</span>}
              </button>
            ))}
          </div>
          <div style={{ overflowY: "auto", minHeight: 0, borderTop: "1px solid var(--line-1)" }}>
            {items === null && <div className="mono dim" style={{ fontSize: 12, padding: 14 }}>carregando…</div>}
            {items !== null && list.length === 0 && (
              <div style={{ padding: "26px 14px", textAlign: "center" }}>
                <div style={{ fontSize: 13.5, fontWeight: 600 }}>Nenhuma notificação</div>
                <div className="dim" style={{ fontSize: 12, marginTop: 4 }}>Menções, atribuições, comentários e prazos das suas tarefas aparecem aqui.</div>
              </div>
            )}
            {list.map((n) => (
              <button key={n.id} type="button" onClick={() => openItem(n)} style={{ display: "flex", gap: 10, width: "100%", padding: "10px 14px", textAlign: "left", background: n.read ? "transparent" : "var(--bg-2)", borderBottom: "1px solid var(--line-1)", alignItems: "flex-start" }}>
                <span style={{ position: "relative", flexShrink: 0 }}>
                  <Avatar id={n.by} name={n.by === "api" ? "Cockpit" : displayName(n.by) || n.by} size={26} />
                  {!n.read && <span style={{ position: "absolute", top: -2, right: -2, width: 8, height: 8, borderRadius: 999, background: "var(--accent)", border: "1.5px solid var(--bg-1)" }} />}
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: 12.5, color: "var(--fg-2)", lineHeight: 1.4 }}>{n.text}</span>
                  <span className="mono dim" style={{ fontSize: 10.5 }}>{when(n.at)}{n.saas ? ` · ${n.saas}` : ""}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
