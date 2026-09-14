import React from "react";
import { api } from "../lib/api.js";
import { toast } from "../atoms.jsx";
import { Popover } from "./popover.jsx";
import { displayName, canSeeScreen } from "../lib/users.js";
import { setActiveSaas, getActiveSaasId } from "../lib/workspace.js";
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
  const [error, setError] = useState("");
  const [marking, setMarking] = useState(false);

  const load = useCallback(async (full = false) => {
    try {
      const r = await api.notifications(!full && !open);
      setUnread(r.unread || 0);
      if (full || open) { setItems(r.items || []); setError(""); }
    } catch { if (full || open) setError("Não foi possível carregar as notificações."); }
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
  const markAll = async () => {
    if (marking) return;
    setMarking(true);
    try { await api.notificationsRead({ all: true }); setItems((l) => (l || []).map((n) => ({ ...n, read: true }))); setUnread(0); }
    catch (err) { toast(`Não deu pra marcar como lidas · ${err.message}`, "neg"); }
    finally { setMarking(false); }
  };
  const openItem = async (n) => {
    if (!n.read) {
      setItems((l) => (l || []).map((x) => (x.id === n.id ? { ...x, read: true } : x)));
      setUnread((u) => Math.max(0, u - 1));
      api.notificationsRead({ ids: [n.id] }).catch(() => {
        toast("Não deu para marcar a notificação como lida · tente novamente", "neg");
        load(true);
      });
    }
    setOpen(false);
    // Destino que não é tarefa (13/09): o aviso de silêncio no WhatsApp abre a
    // conversa. Tela fechada pra pessoa = aviso, não navegação quebrada.
    if (n.link?.screen) {
      if (!canSeeScreen(n.link.screen)) { toast("Você não tem acesso a essa tela", "warn"); return; }
      if (n.saas && n.saas !== getActiveSaasId()) setActiveSaas(n.saas);
      location.hash = n.link.thread ? `${n.link.screen}/${n.link.thread}` : n.link.screen;
      return;
    }
    if (!n.task) return;
    if (!canSeeScreen("tasks")) { toast("Você não tem acesso à tela de Tarefas", "warn"); return; }
    if (n.saas && n.saas !== getActiveSaasId()) setActiveSaas(n.saas);
    location.hash = taskHash(n.task);
  };
  const list = (items || []).filter((n) => inTab(n, tab));
  const count = (k) => (items || []).filter((n) => !n.read && inTab(n, k)).length;

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button type="button" onClick={() => setOpen((o) => !o)} className="chrome-control chrome-bell"
        title="Notificações" aria-expanded={open} aria-haspopup="dialog" aria-label={`Notificações${unread ? `, ${unread} não lidas` : ""}`}>
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10 21a2 2 0 0 0 4 0" /></svg>
        {unread > 0 && <span className="chrome-unread tnum">{unread > 99 ? "99+" : unread}</span>}
      </button>
      {open && (
        <Popover anchor={ref} onClose={() => setOpen(false)} width={360} align="end" gap={16} label="Notificações"
          style={{ padding: 0, borderRadius: "var(--r-4)", overflow: "hidden" }} maxHeight="min(70dvh, 560px)">
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 14px 6px" }}>
            <span style={{ fontSize: 14, fontWeight: 700 }}>Notificações</span>
            <button type="button" onClick={markAll} disabled={!unread || marking} style={{ marginLeft: "auto", fontSize: 12, color: unread ? "var(--accent)" : "var(--fg-4)", fontWeight: 600 }}>{marking ? "Marcando…" : "Marcar todas como lidas"}</button>
          </div>
          <div style={{ display: "flex", gap: 2, padding: "0 10px 8px" }}>
            {TABS.map(([k, l]) => (
              <button key={k} type="button" onClick={() => setTab(k)} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "5px 10px", borderRadius: "var(--r-2)", fontSize: 12.5, fontWeight: tab === k ? 600 : 500, background: tab === k ? "var(--bg-2)" : "transparent", color: tab === k ? "var(--fg-1)" : "var(--fg-3)" }}>
                {l}{count(k) > 0 && <span className="tnum" style={{ fontSize: 11, color: "var(--fg-4)" }}>{count(k)}</span>}
              </button>
            ))}
          </div>
          <div style={{ overflowY: "auto", minHeight: 0, borderTop: "1px solid var(--line-1)" }}>
            {!error && items === null && <div className="mono dim" style={{ fontSize: 12, padding: 14 }}>carregando…</div>}
            {error && <div role="alert" style={{ padding: 16, fontSize: 12.5, color: "var(--fg-3)" }}>
              {error}<button onClick={() => load(true)} className="chrome-menu-item" style={{ color: "var(--accent)", marginTop: 8 }}>Tentar novamente</button>
            </div>}
            {!error && items !== null && list.length === 0 && (
              <div style={{ padding: "26px 14px", textAlign: "center" }}>
                <div style={{ fontSize: 13.5, fontWeight: 600 }}>Nenhuma notificação</div>
                <div className="dim" style={{ fontSize: 12, marginTop: 4 }}>Menções, atribuições, comentários e prazos das suas tarefas aparecem aqui.</div>
              </div>
            )}
            {list.map((n) => (
              <button key={n.id} type="button" onClick={() => openItem(n)} className="notification-item" data-read={n.read || undefined}>
                <span className="notification-dot" style={{ background: n.read ? "var(--line-2)" : n.type === "wa_waiting" ? "var(--neg)" : "var(--accent)" }} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span className="notification-text">{n.text}</span>
                  <span className="notification-meta">
                    {(n.task || n.link?.screen) && <span className="notification-action">
                      {n.type === "wa_waiting" ? "Responder" : n.type === "mention" ? "Responder" : n.type === "assigned" ? "Abrir tarefa" : "Abrir"} →
                    </span>}
                    <span title={n.by === "api" ? "Cockpit" : displayName(n.by) || n.by}>{when(n.at)}{n.saas ? ` · ${n.saas}` : ""}</span>
                  </span>
                </span>
              </button>
            ))}
          </div>
        </Popover>
      )}
    </div>
  );
}
