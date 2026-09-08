import React from "react";
import { EmptyState, useEsc, toast } from "../atoms.jsx";
import { Segmented } from "../components/viz.jsx";
import { api, assetUrl, getKey } from "../lib/api.js";
import { useActiveSaas } from "../lib/workspace.js";
import { useIsMobile } from "../lib/responsive.js";
import { displayName, currentUser } from "../lib/users.js";
import {
  LAYOUTS, COLORS, SHAPES, NODE_MAX_W, normalizeMap, childrenIndex, byId, descendants, isAncestor, depthOf,
  visibleSet, colorIndexer, addChild, addSibling, addRoot, removeSubtrees, moveNode, shiftSibling, cloneSubtrees,
  applyLevels, outlineText, parseOutline, estimateSize, layoutMap, edgePath, edgeModeFor, pathMidpoint, nearestInDirection,
} from "../lib/mindmap.js";

// Mapas mentais / estratégia. Redesenho de 09/2026 (estudo do MindMeister):
// a posição do nó é derivada da árvore (lib/mindmap.js), o teclado manda
// (Tab filho, Enter irmão, setas, espaço recolhe, ⌘Z desfaz), multisseleção,
// arrastar reparenta, nó rico (nota, emoji, imagem, link, forma, limite),
// conexões com rótulo/seta, esboço, busca, foco, exportação e trava de versão
// contra edição simultânea. Cada mapa é um doc na coleção `mindmaps`.

const { useState, useEffect, useRef, useCallback, useMemo, useLayoutEffect } = React;
const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || "");
const MOD = IS_MAC ? "⌘" : "Ctrl";
const EMOJIS = ["⭐", "✅", "❌", "⚠️", "🔥", "💡", "🎯", "🚀", "💰", "📈", "📉", "📌", "🔒", "🔑", "❤️", "👍", "👎", "🧠", "📞", "💬", "📧", "🗓️", "⏰", "🏁", "🛠️", "🐛", "🧪", "📦", "🛒", "🏷️", "👤", "👥", "🏢", "🌎", "🔁", "➡️", "❓", "❗", "1️⃣", "2️⃣", "3️⃣", "🅰️", "🅱️", "🟢", "🟡", "🔴", "🔵", "⚫"];
const MIME_IMG = /^image\//;

// ── Tela ─────────────────────────────────────────────────────────────────────
export function MindmapsScreen() {
  const isMobile = useIsMobile();
  const [activeProduct] = useActiveSaas();
  const [maps, setMaps] = useState(null);
  const [activeId, setActiveId] = useState(null);
  const [renaming, setRenaming] = useState(null);
  const [focus, setFocus] = useState(false); // modo foco: só o canvas

  const load = useCallback(async () => {
    const rows = await api.list("mindmaps");
    return (rows || []).sort((a, b) => String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || "")));
  }, []);
  useEffect(() => {
    let alive = true;
    load().then((list) => { if (!alive) return; setMaps(list); setActiveId((cur) => cur || list[0]?.id || null); }).catch(() => alive && setMaps([]));
    return () => { alive = false; };
  }, [load]);
  // Lista reage ao tempo real só da coleção dela (mapa novo/renomeado por outra
  // pessoa); o conteúdo do mapa aberto é o editor que sincroniza.
  useEffect(() => {
    const on = (e) => {
      if (e.detail?.collection !== "mindmaps") return;
      load().then((list) => setMaps((cur) => {
        if (!cur) return list;
        // não sobrescreve nodes/links do mapa aberto (o editor é a verdade dele)
        return list.map((m) => (m.id === activeId ? { ...m, ...(cur.find((c) => c.id === m.id) || {}), name: m.name } : m));
      })).catch(() => {});
    };
    window.addEventListener("cockpit-change", on);
    return () => window.removeEventListener("cockpit-change", on);
  }, [load, activeId]);

  async function newMap() {
    const doc = { name: "Novo mapa", saas: activeProduct?.id || "", layout: "tree", nodes: [], links: [], createdAt: new Date().toISOString() };
    try {
      const created = await api.create("mindmaps", doc);
      setMaps((m) => [created, ...(m || [])]);
      setActiveId(created.id);
      setRenaming(created.id);
    } catch (e) { toast(`mapa não criado · ${e.message}`, "neg"); }
  }
  async function renameMap(id, name) {
    setMaps((m) => (m || []).map((x) => x.id === id ? { ...x, name } : x));
    setRenaming(null);
    try { await api.update("mindmaps", id, { name }); } catch (e) { toast(`nome não salvo · ${e.message}`, "neg"); }
  }
  async function deleteMap(m) {
    if (!window.confirm(`Apagar o mapa "${m.name || "Sem título"}" com ${(m.nodes || []).length} nós? Não dá pra desfazer.`)) return;
    try {
      await api.remove("mindmaps", m.id);
      setMaps((cur) => (cur || []).filter((x) => x.id !== m.id));
      if (activeId === m.id) setActiveId(null);
    } catch (e) { toast(`não apagou · ${e.message}`, "neg"); }
  }
  async function duplicateMap(m) {
    try {
      const created = await api.create("mindmaps", { name: `${m.name || "Mapa"} (cópia)`, saas: m.saas || activeProduct?.id || "", layout: m.layout || "tree", nodes: m.nodes || [], links: m.links || [], createdAt: new Date().toISOString() });
      setMaps((cur) => [created, ...(cur || [])]);
      setActiveId(created.id);
    } catch (e) { toast(`não duplicou · ${e.message}`, "neg"); }
  }
  const onMapSaved = (saved) => setMaps((m) => (m || []).map((x) => x.id === saved.id ? { ...x, ...saved } : x));

  const visible = (maps || []).filter((m) => !m.saas || m.saas === activeProduct?.id);
  const active = visible.find((m) => m.id === activeId) || null;
  useEffect(() => {
    if (activeId && !visible.some((m) => m.id === activeId)) setActiveId(visible[0]?.id || null);
    else if (!activeId && visible.length) setActiveId(visible[0].id);
  }, [activeProduct?.id, maps]); // eslint-disable-line react-hooks/exhaustive-deps
  async function claimMap(id) {
    const saas = activeProduct?.id || "";
    setMaps((m) => (m || []).map((x) => (x.id === id ? { ...x, saas } : x)));
    try { await api.update("mindmaps", id, { saas }); } catch (e) { toast(`não trouxe · ${e.message}`, "neg"); }
  }

  return (
    <div style={{ flex: 1, display: "flex", minHeight: 0, flexDirection: isMobile ? "column" : "row" }}>
      {!focus && (
        <div style={{ width: isMobile ? "100%" : 230, maxHeight: isMobile ? 150 : undefined, flexShrink: 0, borderRight: isMobile ? "none" : "1px solid var(--line-1)", borderBottom: isMobile ? "1px solid var(--line-1)" : "none", overflow: "auto", padding: isMobile ? "10px 12px" : "16px 12px", background: "var(--bg-1)", display: "flex", flexDirection: "column", gap: 2 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 8px 12px" }}>
            <span className="kicker" style={{ fontWeight: 600 }}>Mapas</span>
            <button onClick={newMap} style={{ height: 24, padding: "0 4px", color: "var(--accent)", fontSize: 12.5, fontWeight: 600 }}>+ novo</button>
          </div>
          {maps === null && <div className="mono dim" style={{ fontSize: 11, padding: 10 }}>carregando…</div>}
          {maps !== null && visible.length === 0 && <div className="dim" style={{ fontSize: 12, padding: 10, lineHeight: 1.5 }}>nenhum mapa {activeProduct?.name ? `da ${activeProduct.name}` : "ainda"} · crie o primeiro em “+ novo”</div>}
          {visible.map((m) => (
            <MapRow key={m.id} m={m} active={m.id === activeId} renaming={renaming === m.id}
              onOpen={() => setActiveId(m.id)} onRename={() => setRenaming(m.id)} onRenamed={(name) => renameMap(m.id, name)} onCancelRename={() => setRenaming(null)}
              onDelete={() => deleteMap(m)} onDuplicate={() => duplicateMap(m)} onClaim={!m.saas ? () => claimMap(m.id) : null} productName={activeProduct?.name} />
          ))}
        </div>
      )}
      <div style={{ flex: 1, minWidth: 0, position: "relative" }}>
        {active
          ? <MapEditor key={active.id} map={active} onSaved={onMapSaved} focus={focus} setFocus={setFocus} isMobile={isMobile} />
          : <EmptyState title="Nenhum mapa aberto" hint={visible.length ? "Escolha um mapa na lista." : `Crie um mapa ${activeProduct?.name ? `da ${activeProduct.name} ` : ""}em “+ novo” pra começar.`} />}
      </div>
    </div>
  );
}

function MapRow({ m, active, renaming, onOpen, onRename, onRenamed, onCancelRename, onDelete, onDuplicate, onClaim, productName }) {
  const [menu, setMenu] = useState(null);
  return (
    <div onClick={onOpen} onDoubleClick={onRename} onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY }); }}
      style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderRadius: "var(--r-2)", cursor: "pointer", background: active ? "var(--accent-soft)" : "transparent" }}>
      <span style={{ fontSize: 12, flexShrink: 0, color: active ? "var(--accent)" : "var(--fg-4)" }}>⌬</span>
      {renaming ? (
        <input autoFocus defaultValue={m.name} className="inp" onClick={(e) => e.stopPropagation()}
          onBlur={(e) => onRenamed(e.target.value.trim() || "Sem título")}
          onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") onCancelRename(); }}
          style={{ flex: 1, minWidth: 0, height: 24, fontSize: 12.5, padding: "0 6px" }} />
      ) : (
        <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: active ? 600 : 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: active ? "var(--fg-1)" : "var(--fg-2)" }}>{m.name || "Sem título"}</span>
      )}
      {onClaim && (
        <button onClick={(e) => { e.stopPropagation(); onClaim(); }}
          title={`Mapa antigo, sem produto definido (aparece em todos os workspaces). Clique pra trazer pra ${productName || "este produto"}.`}
          style={{ flexShrink: 0, height: 18, padding: "0 6px", borderRadius: 999, border: "1px dashed var(--line-2)", background: "transparent", color: "var(--fg-4)", fontSize: 9.5, cursor: "pointer" }}>
          sem produto · trazer
        </button>
      )}
      <span className="mono tnum dim" style={{ fontSize: 10.5, flexShrink: 0 }}>{(m.nodes || []).length}</span>
      {menu && (
        <Menu x={menu.x} y={menu.y} onClose={() => setMenu(null)} items={[
          { label: "Renomear", onClick: onRename },
          { label: "Duplicar", onClick: onDuplicate },
          { label: "Apagar mapa", danger: true, onClick: onDelete },
        ]} />
      )}
    </div>
  );
}

// ── Histórico (desfazer/refazer) ─────────────────────────────────────────────
function useHistory(initial) {
  const [doc, setDoc] = useState(initial);
  const docRef = useRef(doc); docRef.current = doc;
  const hist = useRef({ past: [], future: [] });
  const [, bump] = useState(0);
  const commit = useCallback((fn, { record = true } = {}) => {
    const cur = docRef.current;
    const next = typeof fn === "function" ? fn(cur) : fn;
    if (!next || next === cur) return cur;
    if (record) {
      hist.current.past.push(cur);
      if (hist.current.past.length > 100) hist.current.past.shift();
      hist.current.future = [];
    }
    docRef.current = next; setDoc(next); bump((v) => v + 1);
    return next;
  }, []);
  const undo = useCallback(() => {
    const p = hist.current.past.pop(); if (!p) return false;
    hist.current.future.push(docRef.current); docRef.current = p; setDoc(p); bump((v) => v + 1); return true;
  }, []);
  const redo = useCallback(() => {
    const f = hist.current.future.pop(); if (!f) return false;
    hist.current.past.push(docRef.current); docRef.current = f; setDoc(f); bump((v) => v + 1); return true;
  }, []);
  const reset = useCallback((d) => { hist.current = { past: [], future: [] }; docRef.current = d; setDoc(d); bump((v) => v + 1); }, []);
  return { doc, docRef, commit, undo, redo, reset, canUndo: hist.current.past.length > 0, canRedo: hist.current.future.length > 0 };
}

// ── Editor ───────────────────────────────────────────────────────────────────
function MapEditor({ map, onSaved, focus, setFocus, isMobile }) {
  const { doc, docRef, commit, undo, redo, reset, canUndo, canRedo } = useHistory(() => normalizeMap(map));
  const { nodes, links, layout } = doc;
  const [sel, setSel] = useState([]);           // ids selecionados (o último é o principal)
  const [selLink, setSelLink] = useState(null); // conexão selecionada
  const [editing, setEditing] = useState(null); // { id, initial }
  const [linkFrom, setLinkFrom] = useState(null);
  const [view, setView] = useState({ x: 80, y: 80, z: 1 });
  const [animView, setAnimView] = useState(false);
  const [dragging, setDragging] = useState(null); // { ids, target:{id,zone} }
  const [marquee, setMarquee] = useState(null);
  const [menu, setMenu] = useState(null);       // { x, y, id }
  const [pop, setPop] = useState(null);         // { kind: note|emoji|link|image, id }
  const [q, setQ] = useState(null);             // busca (null = fechada)
  const [outline, setOutline] = useState(false);
  const [save, setSave] = useState({ state: "saved" }); // saved | dirty | saving | conflict
  const [sizeTick, setSizeTick] = useState(0);
  const wrapRef = useRef(null);
  const worldRef = useRef(null);
  const sizes = useRef(new Map());
  const versionRef = useRef(Number(map.version) || 0);
  const mounted = useRef(false);
  const reveal = useRef(null); // id pra trazer pra tela depois do layout
  const skipSave = useRef(false); // doc que veio do servidor não volta pra ele
  const searchRef = useRef(null);
  const me = currentUser()?.id || "";

  const primary = sel.length ? sel[sel.length - 1] : null;
  const selSet = useMemo(() => new Set(sel), [sel]);
  const nodeMap = useMemo(() => byId(nodes), [nodes]);
  const kids = useMemo(() => childrenIndex(nodes), [nodes]);
  const colorOf = useMemo(() => colorIndexer(nodes), [nodes]);
  const visible = useMemo(() => visibleSet(nodes), [nodes]);
  const selNode = primary ? nodeMap[primary] : null;

  // ── Medidas + layout ──────────────────────────────────────────────────────
  const ro = useMemo(() => (typeof ResizeObserver === "undefined" ? null : new ResizeObserver((entries) => {
    let changed = false;
    for (const en of entries) {
      const id = en.target.dataset.id; if (!id) continue;
      const w = Math.round(en.target.offsetWidth), h = Math.round(en.target.offsetHeight);
      const cur = sizes.current.get(id);
      if (!cur || cur.w !== w || cur.h !== h) { sizes.current.set(id, { w, h }); changed = true; }
    }
    if (changed) setSizeTick((t) => t + 1);
  })), []);
  useEffect(() => () => ro && ro.disconnect(), [ro]);
  const measure = useCallback((el) => { if (el && ro) ro.observe(el); }, [ro]);
  const sizeOf = useCallback((id) => sizes.current.get(id) || estimateSize(nodeMap[id] || {}), [nodeMap]);
  const { pos, bounds } = useMemo(() => layoutMap(nodes, layout, sizeOf), [nodes, layout, sizeOf, sizeTick]);
  const rects = useMemo(() => {
    const r = {};
    for (const [id, p] of Object.entries(pos)) { const s = sizeOf(id); r[id] = { x: p.x, y: p.y, w: s.w, h: s.h }; }
    return r;
  }, [pos, sizeOf]);

  // ── Autosave + trava de versão ───────────────────────────────────────────
  useEffect(() => {
    if (!mounted.current) { mounted.current = true; return; }
    if (skipSave.current) { skipSave.current = false; return; }
    setSave((s) => (s.state === "conflict" ? s : { ...s, state: "dirty" }));
    const t = setTimeout(() => persist(false), 600);
    return () => clearTimeout(t);
  }, [doc]); // eslint-disable-line react-hooks/exhaustive-deps
  async function persist(force) {
    const d = docRef.current;
    setSave((s) => ({ ...s, state: "saving" }));
    try {
      const saved = await api.update("mindmaps", map.id, { nodes: d.nodes, links: d.links, layout: d.layout, baseVersion: force ? undefined : versionRef.current });
      versionRef.current = Number(saved.version) || versionRef.current + 1;
      setSave({ state: "saved" });
      onSaved && onSaved({ ...saved, nodes: d.nodes, links: d.links });
    } catch (e) {
      if (e.status === 409) {
        let current = null;
        try { current = await api.get("mindmaps", map.id); } catch { /* fica sem */ }
        setSave({ state: "conflict", current });
      } else { setSave({ state: "dirty", error: e.message }); toast(`mapa não salvo · ${e.message} · tente de novo`, "neg"); }
    }
  }
  function adoptRemote(current) {
    if (!current) return;
    versionRef.current = Number(current.version) || 0;
    skipSave.current = true;
    reset(normalizeMap(current));
    setSel([]); setEditing(null); setSave({ state: "saved" });
    onSaved && onSaved(current);
  }
  // Tempo real: outra pessoa gravou este mapa e eu não tenho nada pendente →
  // adota em silêncio. Com edição pendente, o próximo save cai no 409.
  useEffect(() => {
    const on = async (e) => {
      if (e.detail?.collection !== "mindmaps") return;
      if (save.state !== "saved" || editing) return;
      try {
        const fresh = await api.get("mindmaps", map.id);
        if ((Number(fresh.version) || 0) > versionRef.current) {
          adoptRemote(fresh);
          if (fresh.updatedBy && fresh.updatedBy !== me) toast(`mapa atualizado por ${displayName(fresh.updatedBy)}`, "neutral", 2500);
        }
      } catch { /* sem rede: fica como está */ }
    };
    window.addEventListener("cockpit-change", on);
    return () => window.removeEventListener("cockpit-change", on);
  }, [save.state, editing, map.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Vista (pan/zoom) ─────────────────────────────────────────────────────
  const toWorld = (clientX, clientY) => {
    const r = wrapRef.current.getBoundingClientRect();
    return { x: (clientX - r.left - view.x) / view.z, y: (clientY - r.top - view.y) / view.z };
  };
  const zoomAt = (cx, cy, f) => setView((v) => {
    const z = Math.min(3, Math.max(0.2, v.z * f)); const k = z / v.z;
    return { z, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k };
  });
  const zoomBy = (f) => { const r = wrapRef.current.getBoundingClientRect(); zoomAt(r.width / 2, r.height / 2, f); };
  const withAnim = (fn) => { setAnimView(true); fn(); setTimeout(() => setAnimView(false), 260); };
  const fitView = useCallback(() => {
    const r = wrapRef.current?.getBoundingClientRect(); if (!r) return;
    if (!Object.keys(pos).length) { setView({ x: 80, y: 80, z: 1 }); return; }
    const pad = 48; const bw = bounds.maxX - bounds.minX + pad * 2, bh = bounds.maxY - bounds.minY + pad * 2;
    const z = Math.min(1.4, Math.max(0.2, Math.min(r.width / bw, r.height / bh)));
    withAnim(() => setView({ z, x: (r.width - (bounds.maxX - bounds.minX) * z) / 2 - bounds.minX * z, y: (r.height - (bounds.maxY - bounds.minY) * z) / 2 - bounds.minY * z }));
  }, [pos, bounds]);
  const centerOn = useCallback((id, zoom) => {
    const rc = rects[id]; const r = wrapRef.current?.getBoundingClientRect(); if (!rc || !r) return;
    withAnim(() => setView((v) => { const z = zoom || v.z; return { z, x: r.width / 2 - (rc.x + rc.w / 2) * z, y: r.height / 2 - (rc.y + rc.h / 2) * z }; }));
  }, [rects]);
  // Traz o nó pra dentro da tela com o menor deslocamento (não centraliza).
  const revealNow = useCallback((id) => {
    const rc = rects[id]; const r = wrapRef.current?.getBoundingClientRect(); if (!rc || !r) return;
    setView((v) => {
      const m = 40; const sx = rc.x * v.z + v.x, sy = rc.y * v.z + v.y, sw = rc.w * v.z, sh = rc.h * v.z;
      let dx = 0, dy = 0;
      if (sx < m) dx = m - sx; else if (sx + sw > r.width - m) dx = r.width - m - (sx + sw);
      if (sy < m) dy = m - sy; else if (sy + sh > r.height - m) dy = r.height - m - (sy + sh);
      if (!dx && !dy) return v;
      return { ...v, x: v.x + dx, y: v.y + dy };
    });
  }, [rects]);
  useLayoutEffect(() => { if (reveal.current && rects[reveal.current]) { const id = reveal.current; reveal.current = null; withAnim(() => revealNow(id)); } }, [rects, revealNow]);
  useEffect(() => { const t = setTimeout(fitView, 80); return () => clearTimeout(t); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const el = wrapRef.current; if (!el) return;
    const onWheel = (e) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) zoomAt(e.clientX - r.left, e.clientY - r.top, e.deltaY < 0 ? 1.1 : 0.9);
      else setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // ── Comandos ─────────────────────────────────────────────────────────────
  const select = (ids, { add = false, toggle = false } = {}) => {
    setSelLink(null);
    setSel((cur) => {
      if (toggle) { const s = new Set(cur); for (const id of ids) { if (s.has(id)) s.delete(id); else s.add(id); } return [...s]; }
      if (add) { const s = [...cur]; for (const id of ids) if (!s.includes(id)) s.push(id); return s; }
      return [...ids];
    });
  };
  const startEdit = (id, initial) => { setEditing({ id, initial }); setSel([id]); };
  const createChild = (parentId, text = "") => {
    const p = nodeMap[parentId]; if (!p) return;
    let nextId;
    const pr = rects[parentId]; const sibs = (kids[parentId] || []).length;
    const at = pr ? { x: Math.round(pr.x + pr.w + 44), y: Math.round(pr.y + sibs * 52) } : { x: p.x + 200, y: p.y + sibs * 52 };
    commit((d) => {
      let ns = d.nodes;
      if (p.collapsed) ns = ns.map((n) => (n.id === parentId ? { ...n, collapsed: false } : n));
      const r = addChild(ns, parentId, text, at); nextId = r.id; return { ...d, nodes: r.nodes };
    });
    reveal.current = nextId; startEdit(nextId, text ? undefined : "");
  };
  const createSibling = (refId, text = "", above = false) => {
    const ref = nodeMap[refId];
    if (ref && !ref.parent && layout !== "free") { createChild(refId, text); return; }
    let nextId;
    commit((d) => { const r = addSibling(d.nodes, refId, text, { above }); nextId = r.id; return { ...d, nodes: r.nodes }; });
    reveal.current = nextId; startEdit(nextId, "");
  };
  const createRootAt = (clientX, clientY) => {
    const p = toWorld(clientX, clientY); let nextId;
    commit((d) => { const r = addRoot(d.nodes, "", { x: Math.round(p.x - 60), y: Math.round(p.y - 18) }); nextId = r.id; return { ...d, nodes: r.nodes }; });
    startEdit(nextId, "");
  };
  const deleteNodes = (ids) => {
    if (!ids.length) return;
    const first = nodeMap[ids[0]];
    const next = first ? (first.parent && nodeMap[first.parent] ? first.parent : null) : null;
    commit((d) => { const r = removeSubtrees(d.nodes, d.links, ids); return { ...d, nodes: r.nodes, links: r.links }; });
    setSel(next ? [next] : []); setEditing(null); setPop(null);
  };
  const patchNodes = (ids, patch, record = true) => commit((d) => ({ ...d, nodes: d.nodes.map((n) => (ids.includes(n.id) ? { ...n, ...(typeof patch === "function" ? patch(n) : patch) } : n)) }), { record });
  const commitText = (id, text) => {
    const n = docRef.current.nodes.find((x) => x.id === id); if (!n) return;
    const t = text.trim();
    // nó novo que ficou vazio (Esc/clique fora) some, como no MindMeister
    if (!t && !(kids[id] || []).length) { commit((d) => { const r = removeSubtrees(d.nodes, d.links, [id]); return { ...d, nodes: r.nodes, links: r.links }; }); setSel(n.parent ? [n.parent] : []); return; }
    if (t !== n.text) patchNodes([id], { text: t });
  };
  const toggleCollapse = (ids) => { const anyOpen = ids.some((id) => !nodeMap[id]?.collapsed && (kids[id] || []).length); patchNodes(ids.filter((id) => (kids[id] || []).length), { collapsed: anyOpen }); };
  const clipboard = useRef(null);
  const copySel = () => {
    if (!sel.length) return;
    const roots = sel.filter((id) => !sel.some((o) => o !== id && isAncestor(nodes, o, id)));
    const take = new Set(); for (const r of roots) { take.add(r); for (const d of descendants(nodes, r, kids)) take.add(d); }
    clipboard.current = { nodes: nodes.filter((n) => take.has(n.id)), roots };
    try { navigator.clipboard?.writeText(outlineText(nodes, roots)); } catch { /* sem permissão */ }
  };
  const pasteInto = async (parentId) => {
    const cb = clipboard.current;
    if (cb) {
      let ids = [];
      commit((d) => {
        const base = d.nodes.filter((n) => (n.parent || null) === (parentId || null)).length;
        const r = cloneSubtrees(cb.nodes, cb.roots, parentId || null, base); ids = r.ids;
        return { ...d, nodes: [...d.nodes, ...r.added] };
      });
      if (ids.length) { setSel(ids); reveal.current = ids[0]; }
      return;
    }
    // texto de fora: cada linha vira um nó (recuo = nível)
    let text = "";
    try { text = await navigator.clipboard?.readText(); } catch { /* sem permissão */ }
    if (!text?.trim()) return;
    const parsed = parseOutline(text); if (!parsed.length) return;
    commit((d) => {
      const base = d.nodes.filter((n) => (n.parent || null) === (parentId || null)).length;
      const ns = parsed.map((n) => (n.parent ? n : { ...n, parent: parentId || null, order: base + n.order }));
      return { ...d, nodes: [...d.nodes, ...ns] };
    });
    setSel(parsed.filter((n) => !n.parent).map((n) => n.id));
  };
  const pasteStyle = () => {
    const src = clipboard.current?.nodes?.find((n) => clipboard.current.roots.includes(n.id)); if (!src || !sel.length) return;
    patchNodes(sel, { color: src.color || "", shape: src.shape || "", bold: !!src.bold });
  };
  const detach = (id) => {
    const n = nodeMap[id]; if (!n) return;
    const r = rects[id];
    if (n.auto === false && layout !== "free") {
      // reanexa: volta pra árvore no pai (ou vira raiz automática)
      patchNodes([id], { auto: undefined });
    } else patchNodes([id], { auto: false, x: r ? r.x : n.x, y: r ? r.y : n.y });
  };
  const connect = (from, to) => {
    if (!from || !to || from === to) return;
    if (links.some((l) => (l.from === from && l.to === to) || (l.from === to && l.to === from))) return;
    commit((d) => ({ ...d, links: [...d.links, { id: "l" + Date.now().toString(36), from, to, label: "", color: "", arrow: "end" }] }));
  };
  const setLayout = (value) => { commitLayout(value); setTimeout(fitView, 60); };
  const commitLayout = (value) => commit((d) => {
    if (value === "free") {
      // congela as posições atuais pra nada pular
      return { ...d, layout: value, nodes: d.nodes.map((n) => (pos[n.id] ? { ...n, x: pos[n.id].x, y: pos[n.id].y } : n)) };
    }
    return { ...d, layout: value };
  });
  const navigate = (dir) => {
    if (!primary) { const first = nodes.find((n) => !n.parent); if (first) setSel([first.id]); return; }
    const vr = {}; for (const [id, r] of Object.entries(rects)) vr[id] = r;
    const next = nearestInDirection(vr, primary, dir);
    if (next) { setSel([next]); reveal.current = next; setSizeTick((t) => t + 1); }
  };

  // ── Teclado ───────────────────────────────────────────────────────────────
  const K = useRef({}); K.current = { sel, primary, editing, linkFrom, nodes, kids, nodeMap, layout, q, menu, pop, selLink, outline };
  useEffect(() => {
    const onKey = (e) => {
      const s = K.current;
      const tag = (e.target.tagName || "").toLowerCase();
      const typing = tag === "input" || tag === "textarea" || e.target.isContentEditable;
      const mod = e.metaKey || e.ctrlKey;
      // busca aberta com foco no input: só Esc/Enter interessam aqui
      if (typing && e.target !== searchRef.current) return;
      if (typing && e.target === searchRef.current) {
        if (e.key === "Escape") { e.preventDefault(); setQ(null); wrapRef.current?.focus(); }
        return;
      }
      if (s.editing || s.outline) return;
      if (mod && e.key.toLowerCase() === "f") { e.preventDefault(); setQ((v) => (v == null ? "" : v)); setTimeout(() => searchRef.current?.focus(), 30); return; }
      if (mod && e.key.toLowerCase() === "z") { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
      if (mod && e.key.toLowerCase() === "y") { e.preventDefault(); redo(); return; }
      if (mod && e.key.toLowerCase() === "a") { e.preventDefault(); setSel(s.nodes.filter((n) => visible.has(n.id)).map((n) => n.id)); return; }
      if (mod && e.key === ".") { e.preventDefault(); setFocus((f) => !f); return; }
      if (mod && e.shiftKey && e.key.toLowerCase() === "h") { e.preventDefault(); fitView(); return; }
      if (mod && e.key.toLowerCase() === "c" && s.sel.length) { e.preventDefault(); copySel(); return; }
      if (mod && e.key.toLowerCase() === "x" && s.sel.length) { e.preventDefault(); copySel(); deleteNodes(s.sel); return; }
      if (mod && e.key.toLowerCase() === "v") { e.preventDefault(); if (e.shiftKey) pasteStyle(); else pasteInto(s.primary || null); return; }
      if (mod && e.altKey && e.key.toLowerCase() === "a" && s.primary) { e.preventDefault(); detach(s.primary); return; }
      if (mod && (e.key === "ArrowUp" || e.key === "ArrowDown") && s.primary) { e.preventDefault(); commit((d) => ({ ...d, nodes: shiftSibling(d.nodes, s.primary, e.key === "ArrowUp" ? -1 : 1) })); return; }
      if (mod && e.key === "Enter" && s.primary) { e.preventDefault(); startEdit(s.primary); return; }
      if (e.altKey && !mod && /^[0-9]$/.test(e.key)) { e.preventDefault(); const n = Number(e.key); commit((d) => ({ ...d, nodes: applyLevels(d.nodes, n === 0 ? null : n) })); return; }
      if (e.altKey && !mod && e.shiftKey && e.key.toLowerCase() === "n" && s.primary) { e.preventDefault(); setPop({ kind: "note", id: s.primary }); return; }
      if (e.altKey && !mod && e.key.toLowerCase() === "c" && s.primary) { e.preventDefault(); setLinkFrom((f) => (f ? null : s.primary)); return; }
      if (mod || e.altKey) return;
      if (e.key === "Escape") {
        e.preventDefault();
        if (s.menu) setMenu(null); else if (s.pop) setPop(null); else if (s.linkFrom) setLinkFrom(null); else if (s.q != null) setQ(null); else if (s.selLink) setSelLink(null); else if (s.sel.length) setSel([]); else if (focus) setFocus(false);
        return;
      }
      if (e.key === "+" || e.key === "=") { e.preventDefault(); zoomBy(1.2); return; }
      if (e.key === "-") { e.preventDefault(); zoomBy(1 / 1.2); return; }
      if (e.key === "0") { e.preventDefault(); withAnim(() => setView((v) => ({ ...v, z: 1 }))); return; }
      if (e.key === "F6" || e.key === "1") { e.preventDefault(); const root = s.nodes.find((n) => !n.parent); if (root) centerOn(root.id); return; }
      if (e.key === "2" && s.primary) { e.preventDefault(); centerOn(s.primary); return; }
      if (e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "ArrowUp" || e.key === "ArrowDown") { e.preventDefault(); navigate(e.key.replace("Arrow", "").toLowerCase()); return; }
      if (s.selLink && (e.key === "Delete" || e.key === "Backspace")) { e.preventDefault(); commit((d) => ({ ...d, links: d.links.filter((l) => l.id !== s.selLink) })); setSelLink(null); return; }
      if (!s.primary) {
        if (e.key === "Tab" || e.key === "Enter") { e.preventDefault(); if (!s.nodes.length) { let id; commit((d) => { const r = addRoot(d.nodes, ""); id = r.id; return { ...d, nodes: r.nodes }; }); startEdit(id, ""); } else setSel([s.nodes.find((n) => !n.parent)?.id].filter(Boolean)); }
        return;
      }
      if (e.key === "Tab" || e.key === "Insert") { e.preventDefault(); createChild(s.primary); return; }
      if (e.key === "Enter") { e.preventDefault(); createSibling(s.primary, "", e.shiftKey); return; }
      if (e.key === "F2") { e.preventDefault(); startEdit(s.primary); return; }
      if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); deleteNodes(s.sel); return; }
      if (e.key === " ") { e.preventDefault(); toggleCollapse(s.sel); return; }
      // digitar com o nó selecionado entra em edição substituindo o texto
      // (o MindMeister perde o que foi digitado; aqui não)
      if (e.key.length === 1 && !e.repeat) { e.preventDefault(); startEdit(s.primary, e.key); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }); // sem deps: lê K.current; handlers fecham sobre o render atual

  // ── Ponteiro: arrastar nó, pan, laço, pinça ──────────────────────────────
  const pointers = useRef(new Map());
  function onNodePointerDown(e, id) {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    e.stopPropagation();
    if (editing?.id === id) return;
    if (linkFrom) { connect(linkFrom, id); setLinkFrom(null); return; }
    const already = selSet.has(id);
    if (e.shiftKey) select([id], { add: true });
    else if (e.metaKey || e.ctrlKey) select([id], { toggle: true });
    else if (!already) select([id]);
    const sx = e.clientX, sy = e.clientY; let moved = false;
    const dragIds = (already && !e.shiftKey && !e.metaKey && !e.ctrlKey ? sel : [id]).filter((x) => x !== undefined);
    const roots = dragIds.filter((x) => !dragIds.some((o) => o !== x && isAncestor(nodes, o, x)));
    const subtree = new Set(); for (const r of roots) { subtree.add(r); for (const d of descendants(nodes, r, kids)) subtree.add(d); }
    const els = [...(worldRef.current?.querySelectorAll("[data-id]") || [])].filter((el) => subtree.has(el.dataset.id));
    let target = null;
    const move = (ev) => {
      const dx = (ev.clientX - sx) / view.z, dy = (ev.clientY - sy) / view.z;
      if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 4) return;
      if (!moved) { moved = true; setDragging({ ids: [...subtree], target: null }); }
      for (const el of els) el.style.transform = `translate(${dx}px, ${dy}px)`;
      // alvo: nó sob o ponteiro (fora da subárvore arrastada)
      const p = toWorld(ev.clientX, ev.clientY); let hit = null;
      for (const [nid_, r] of Object.entries(rects)) {
        if (subtree.has(nid_)) continue;
        if (p.x >= r.x - 6 && p.x <= r.x + r.w + 6 && p.y >= r.y - 6 && p.y <= r.y + r.h + 6) { hit = { id: nid_, r }; break; }
      }
      let t = null;
      if (hit && layout !== "free") {
        const rel = (p.y - hit.r.y) / hit.r.h;
        const canSibling = !!nodeMap[hit.id]?.parent;
        t = { id: hit.id, zone: canSibling && rel < 0.3 ? "before" : canSibling && rel > 0.7 ? "after" : "child" };
      } else if (hit) t = { id: hit.id, zone: "child" };
      if ((t?.id !== target?.id) || (t?.zone !== target?.zone)) { target = t; setDragging({ ids: [...subtree], target: t }); }
    };
    const up = (ev) => {
      window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up);
      // devolve o transform do layout (o NodeView é memoizado: limpar o inline
      // deixava o nó parado em 0,0 até o próximo render dele)
      for (const el of els) { const r = rects[el.dataset.id]; el.style.transform = r ? `translate(${r.x}px, ${r.y}px)` : ""; }
      if (!moved) {
        // clique num nó já selecionado (sem modificador) entra em edição
        if (already && !e.shiftKey && !e.metaKey && !e.ctrlKey && sel.length === 1) startEdit(id);
        return;
      }
      setDragging(null);
      const dx = (ev.clientX - sx) / view.z, dy = (ev.clientY - sy) / view.z;
      if (target) {
        const tid = target.id;
        commit((d) => {
          let ns = d.nodes;
          for (const r of roots) {
            if (target.zone === "child") { ns = moveNode(ns, r, tid, null); ns = ns.map((n) => (n.id === tid && n.collapsed ? { ...n, collapsed: false } : n)); }
            else {
              const t = ns.find((n) => n.id === tid); const idx = (t.order || 0) + (target.zone === "after" ? 1 : 0);
              ns = moveNode(ns, r, t.parent || null, idx);
            }
          }
          return { ...d, nodes: ns };
        });
        setSel(roots);
        return;
      }
      // solto no vazio: livre/desanexado move; em auto-layout, ⌥ desanexa ali; senão volta
      const free = layout === "free";
      commit((d) => ({ ...d, nodes: d.nodes.map((n) => {
        if (!roots.includes(n.id) && !(free && subtree.has(n.id))) return n;
        const r = rects[n.id]; const bx = r ? r.x : n.x, by = r ? r.y : n.y;
        if (free || n.auto === false || !n.parent) return { ...n, x: Math.round(bx + dx), y: Math.round(by + dy), auto: free ? n.auto : false };
        if (ev.altKey) return { ...n, x: Math.round(bx + dx), y: Math.round(by + dy), auto: false };
        return n;
      }) }), { record: true });
    };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
  }
  function onBgPointerDown(e) {
    if (e.target !== wrapRef.current && e.target !== worldRef.current && !e.target.dataset?.bg) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) return; // pinça cuida
    if (e.button !== 0 && e.pointerType === "mouse") return;
    setMenu(null); setPop(null); setSelLink(null);
    if (editing) return; // o blur do textarea fecha a edição
    const sx = e.clientX, sy = e.clientY; const o = { x: view.x, y: view.y };
    if (e.shiftKey) {
      const a = toWorld(sx, sy);
      const move = (ev) => { const b = toWorld(ev.clientX, ev.clientY); setMarquee({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) }); };
      const up = (ev) => {
        window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up);
        const b = toWorld(ev.clientX, ev.clientY);
        const m = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
        const ids = Object.entries(rects).filter(([, r]) => r.x < m.x + m.w && r.x + r.w > m.x && r.y < m.y + m.h && r.y + r.h > m.y).map(([id]) => id);
        setMarquee(null); select(ids);
      };
      window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
      return;
    }
    let moved = false;
    const move = (ev) => {
      if (pointers.current.size >= 2) return;
      if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 3) return; moved = true;
      setView((v) => ({ ...v, x: o.x + (ev.clientX - sx), y: o.y + (ev.clientY - sy) }));
    };
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); if (!moved) { setSel([]); setLinkFrom(null); } };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
  }
  // pinça (2 dedos) = zoom no ponto médio
  useEffect(() => {
    const el = wrapRef.current; if (!el) return;
    let last = null;
    const onMove = (e) => {
      if (!pointers.current.has(e.pointerId)) return;
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.current.size !== 2) { last = null; return; }
      const [a, b] = [...pointers.current.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y); const r = el.getBoundingClientRect();
      const mx = (a.x + b.x) / 2 - r.left, my = (a.y + b.y) / 2 - r.top;
      if (last) zoomAt(mx, my, d / last);
      last = d;
    };
    const onUp = (e) => { pointers.current.delete(e.pointerId); if (pointers.current.size < 2) last = null; };
    window.addEventListener("pointermove", onMove); window.addEventListener("pointerup", onUp); window.addEventListener("pointercancel", onUp);
    return () => { window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); window.removeEventListener("pointercancel", onUp); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Imagem no nó (upload/colar) ──────────────────────────────────────────
  async function attachImage(id, file) {
    if (!file || !MIME_IMG.test(file.type)) { toast("só aceito imagem", "neg"); return; }
    try {
      const fd = new FormData(); fd.append("file", file, file.name || "imagem.png");
      const key = getKey();
      const res = await fetch(`${import.meta.env.VITE_API_BASE || ""}/api/mindmaps/asset`, { method: "POST", headers: key ? { "x-api-key": key } : {}, body: fd });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      patchNodes([id], { image: body.url });
    } catch (e) { toast(`imagem não anexada · ${e.message}`, "neg"); }
  }
  useEffect(() => {
    const onPaste = (e) => {
      const tag = (e.target.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea") return;
      const item = [...(e.clipboardData?.items || [])].find((i) => MIME_IMG.test(i.type));
      if (item && primary) { e.preventDefault(); attachImage(primary, item.getAsFile()); return; }
      const text = e.clipboardData?.getData("text/plain");
      if (text && !clipboard.current) {
        e.preventDefault();
        const parsed = parseOutline(text); if (!parsed.length) return;
        const parentId = primary || null;
        commit((d) => { const base = d.nodes.filter((n) => (n.parent || null) === parentId).length; return { ...d, nodes: [...d.nodes, ...parsed.map((n) => (n.parent ? n : { ...n, parent: parentId, order: base + n.order }))] }; });
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Busca ────────────────────────────────────────────────────────────────
  const matches = useMemo(() => {
    if (!q) return null; const needle = q.toLowerCase();
    return new Set(nodes.filter((n) => (n.text || "").toLowerCase().includes(needle) || (n.note || "").toLowerCase().includes(needle)).map((n) => n.id));
  }, [q, nodes]);
  const nextMatch = () => {
    if (!matches?.size) return;
    const list = nodes.filter((n) => matches.has(n.id)).map((n) => n.id);
    const i = primary ? list.indexOf(primary) : -1; const id = list[(i + 1) % list.length];
    // expande os ancestrais recolhidos
    const anc = []; let cur = nodeMap[id]; while (cur?.parent) { if (nodeMap[cur.parent]?.collapsed) anc.push(cur.parent); cur = nodeMap[cur.parent]; }
    if (anc.length) patchNodes(anc, { collapsed: false });
    setSel([id]); reveal.current = id; setSizeTick((t) => t + 1);
  };

  // ── Exportar ─────────────────────────────────────────────────────────────
  const exportMd = async () => { try { await navigator.clipboard.writeText(outlineText(nodes)); toast("esboço copiado como Markdown", "pos", 2500); } catch { toast("não consegui copiar", "neg"); } };
  const exportImage = async (kind) => {
    try {
      const svg = buildSvg({ nodes, rects, edges, freeEdges, boundaries, colorOf, nodeMap, name: map.name });
      const blob = new Blob([svg.text], { type: "image/svg+xml;charset=utf-8" });
      const name = (map.name || "mapa").replace(/[^\w\- ]+/g, "").trim() || "mapa";
      if (kind === "svg") return download(blob, `${name}.svg`);
      const url = URL.createObjectURL(blob);
      const img = new Image();
      await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error("não consegui desenhar a imagem")); img.src = url; });
      const c = document.createElement("canvas"); c.width = svg.w * 2; c.height = svg.h * 2;
      const ctx = c.getContext("2d"); ctx.scale(2, 2); ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      c.toBlob((png) => { if (png) download(png, `${name}.png`); else toast("não consegui gerar o PNG", "neg"); }, "image/png");
    } catch (e) { toast(`exportação falhou · ${e.message}`, "neg"); }
  };

  // ── Derivados de desenho ─────────────────────────────────────────────────
  const edges = useMemo(() => {
    const out = [];
    for (const n of nodes) {
      if (!n.parent || !rects[n.id] || !rects[n.parent]) continue;
      const mode = n.auto === false ? "auto" : edgeModeFor(layout, n.parent, n.id, depthOf(nodeMap, n.id));
      out.push({ key: "e" + n.id, d: edgePath(rects[n.parent], rects[n.id], mode), color: colorOf(n.id), id: n.id, dashed: n.auto === false && layout !== "free" });
    }
    return out;
  }, [nodes, rects, layout, nodeMap, colorOf]);
  const freeEdges = useMemo(() => links.map((l) => {
    const a = rects[l.from], b = rects[l.to]; if (!a || !b) return null;
    const d = edgePath(a, b, "auto"); return { ...l, d, mid: pathMidpoint(d) };
  }).filter(Boolean), [links, rects]);
  const boundaries = useMemo(() => nodes.filter((n) => n.boundary && rects[n.id]).map((n) => {
    const ids = [n.id, ...descendants(nodes, n.id, kids)].filter((id) => rects[id]);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const id of ids) { const r = rects[id]; minX = Math.min(minX, r.x); minY = Math.min(minY, r.y); maxX = Math.max(maxX, r.x + r.w); maxY = Math.max(maxY, r.y + r.h); }
    return { id: n.id, x: minX - 10, y: minY - 10, w: maxX - minX + 20, h: maxY - minY + 20, color: colorOf(n.id) };
  }), [nodes, rects, kids, colorOf]);
  const selRect = primary && rects[primary] ? rects[primary] : null;
  const toolbarPos = selRect ? { left: selRect.x * view.z + view.x, top: (selRect.y + selRect.h) * view.z + view.y + 10, nodeTop: selRect.y * view.z + view.y, above: (selRect.y * view.z + view.y) > 110 } : null;
  const menuItems = (id) => {
    const n = nodeMap[id]; if (!n) return [];
    const has = (kids[id] || []).length > 0;
    return [
      { label: "Novo tópico filho", kbd: "Tab", onClick: () => createChild(id) },
      { label: "Novo tópico irmão", kbd: "Enter", onClick: () => createSibling(id), disabled: !n.parent && layout !== "free" },
      { label: "Editar texto", kbd: "F2", onClick: () => startEdit(id) },
      { sep: true },
      { label: n.note ? "Editar nota" : "Adicionar nota", kbd: "⌥⇧N", onClick: () => setPop({ kind: "note", id }) },
      { label: "Emoji", onClick: () => setPop({ kind: "emoji", id }) },
      { label: n.image ? "Trocar imagem" : "Imagem", onClick: () => setPop({ kind: "image", id }) },
      { label: n.link ? "Editar link" : "Link", onClick: () => setPop({ kind: "link", id }) },
      { label: "Conectar a outro nó", kbd: "⌥C", onClick: () => { setSel([id]); setLinkFrom(id); } },
      { sep: true },
      { label: n.collapsed ? "Expandir" : "Recolher", kbd: "Espaço", onClick: () => toggleCollapse([id]), disabled: !has },
      { label: n.boundary ? "Tirar limite do ramo" : "Mostrar ramo como limite", onClick: () => patchNodes([id], { boundary: !n.boundary }), disabled: !has },
      { label: n.auto === false && layout !== "free" ? "Reanexar à árvore" : "Desanexar (mover livre)", kbd: `${MOD}⌥A`, onClick: () => detach(id), disabled: layout === "free" },
      { label: "Selecionar subtópicos", kbd: `${MOD}⇧A`, onClick: () => setSel([id, ...descendants(nodes, id, kids)]), disabled: !has },
      { sep: true },
      { label: "Recortar", kbd: `${MOD}X`, onClick: () => { setSel([id]); copySel(); deleteNodes([id]); } },
      { label: "Copiar", kbd: `${MOD}C`, onClick: () => { setSel([id]); setTimeout(copySel, 0); } },
      { label: "Colar como filho", kbd: `${MOD}V`, onClick: () => pasteInto(id) },
      { label: "Colar estilo", kbd: `${MOD}⇧V`, onClick: pasteStyle, disabled: !clipboard.current },
      { sep: true },
      { label: has ? "Apagar nó e filhos" : "Apagar nó", kbd: "Delete", danger: true, onClick: () => deleteNodes(sel.includes(id) ? sel : [id]) },
    ];
  };

  const hidden = (id) => (nodeMap[id]?.collapsed ? descendants(nodes, id, kids).length : 0);
  // Handlers do nó passam por UMA ref estável: senão cada render recriava as
  // funções e o memo do NodeView não segurava nada (arrastar re-renderizava tudo).
  const H = useRef({});
  H.current = {
    onPointerDown: onNodePointerDown,
    onDoubleClick: (id) => startEdit(id),
    onContextMenu: (e, id) => { e.preventDefault(); e.stopPropagation(); if (!selSet.has(id)) setSel([id]); setMenu({ x: e.clientX, y: e.clientY, id }); },
    onCommitText: (id, t) => { setEditing(null); commitText(id, t); },
    onEnterInEdit: (id, t, shift) => { setEditing(null); commitText(id, t); if (docRef.current.nodes.some((x) => x.id === id)) createSibling(id, "", shift); },
    onTabInEdit: (id, t) => { setEditing(null); commitText(id, t); if (docRef.current.nodes.some((x) => x.id === id)) createChild(id); },
    onToggle: (id) => toggleCollapse([id]),
    onAddChild: (id) => createChild(id),
  };
  const sideOf = (id) => { const n = nodeMap[id]; const r = rects[id], p = n?.parent ? rects[n.parent] : null; return p && r.x + r.w / 2 < p.x + p.w / 2 ? "left" : "right"; };
  const stateLabel = save.state === "saved" ? "salvo" : save.state === "saving" ? "salvando…" : save.state === "dirty" ? (save.error ? "não salvo" : "alterado") : "conflito";

  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>
      {/* Barra do mapa */}
      {!focus && (
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", padding: "8px 10px", borderBottom: "1px solid var(--line-1)", background: "var(--bg-1)", flexShrink: 0 }}>
          <Segmented value={outline ? "outline" : "map"} options={[{ value: "map", label: "Mapa" }, { value: "outline", label: "Esboço" }]} onChange={(v) => setOutline(v === "outline")} />
          <span style={{ width: 1, height: 20, background: "var(--line-1)", margin: "0 2px" }} />
          <select className="inp" value={layout} onChange={(e) => setLayout(e.target.value)} title="Layout automático do mapa" style={{ height: 28, fontSize: 12.5, paddingRight: 22 }}>
            {LAYOUTS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <TBtn title={`Desfazer (${MOD}Z)`} onClick={undo} disabled={!canUndo}>↶</TBtn>
          <TBtn title={`Refazer (${MOD}⇧Z)`} onClick={redo} disabled={!canRedo}>↷</TBtn>
          <span style={{ width: 1, height: 20, background: "var(--line-1)", margin: "0 2px" }} />
          <TBtn title="Afastar (−)" onClick={() => zoomBy(1 / 1.2)}>−</TBtn>
          <button onClick={() => withAnim(() => setView((v) => ({ ...v, z: 1 })))} title="Zoom 100% (0)" className="mono tnum" style={{ height: 28, minWidth: 44, fontSize: 11.5, color: "var(--fg-3)" }}>{Math.round(view.z * 100)}%</button>
          <TBtn title="Aproximar (+)" onClick={() => zoomBy(1.2)}>+</TBtn>
          <TBtn title={`Enquadrar tudo (${MOD}⇧H)`} onClick={fitView}>⤢</TBtn>
          <LevelsMenu onPick={(n) => commit((d) => ({ ...d, nodes: applyLevels(d.nodes, n) }))} />
          {q == null
            ? <TBtn title={`Buscar no mapa (${MOD}F)`} onClick={() => { setQ(""); setTimeout(() => searchRef.current?.focus(), 30); }}>⌕</TBtn>
            : <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                <input ref={searchRef} className="inp" value={q} placeholder="buscar…" onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); nextMatch(); } }} style={{ height: 28, width: 160, fontSize: 12.5 }} />
                <span className="mono tnum dim" style={{ fontSize: 11 }}>{matches ? matches.size : 0}</span>
                <TBtn title="Fechar busca (Esc)" onClick={() => setQ(null)}>✕</TBtn>
              </span>}
          <ExportMenu onMd={exportMd} onPng={() => exportImage("png")} onSvg={() => exportImage("svg")} />
          <TBtn title={`Modo foco: só o mapa (${MOD}.)`} onClick={() => setFocus(true)}>◱</TBtn>
          <span style={{ flex: 1 }} />
          <span className="mono dim" style={{ fontSize: 10.5 }} title={map.updatedBy ? `última gravação por ${displayName(map.updatedBy)}` : ""}>{stateLabel}</span>
        </div>
      )}
      {focus && (
        <button onClick={() => setFocus(false)} title={`Sair do foco (Esc ou ${MOD}.)`} style={{ position: "absolute", top: 10, right: 12, zIndex: 6, height: 26, padding: "0 10px", borderRadius: 999, border: "1px solid var(--line-2)", background: "var(--bg-1)", color: "var(--fg-3)", fontSize: 11.5 }}>sair do foco</button>
      )}
      {save.state === "conflict" && (
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", padding: "8px 12px", background: "var(--warn-soft)", color: "var(--fg-1)", fontSize: 12.5, borderBottom: "1px solid var(--line-1)" }}>
          <span><b>{save.current?.updatedBy ? displayName(save.current.updatedBy) : "Outra pessoa"}</b> editou este mapa enquanto você mexia.</span>
          <button onClick={() => adoptRemote(save.current)} style={{ height: 26, padding: "0 10px", borderRadius: "var(--r-2)", border: "1px solid var(--line-2)", background: "var(--bg-1)", fontSize: 12 }}>Recarregar (perde o que mudei)</button>
          <button onClick={() => persist(true)} style={{ height: 26, padding: "0 10px", borderRadius: "var(--r-2)", border: "1px solid var(--line-2)", background: "var(--bg-1)", fontSize: 12 }}>Gravar por cima</button>
        </div>
      )}

      {outline ? (
        <OutlineView nodes={nodes} kids={kids} nodeMap={nodeMap} commit={commit} colorOf={colorOf} />
      ) : (
      <div ref={wrapRef} tabIndex={-1} onPointerDown={onBgPointerDown} onContextMenu={(e) => { if (e.target === wrapRef.current || e.target === worldRef.current) e.preventDefault(); }}
        onDoubleClick={(e) => { if (e.target === wrapRef.current || e.target === worldRef.current) createRootAt(e.clientX, e.clientY); }}
        style={{ flex: 1, position: "relative", overflow: "hidden", outline: "none", cursor: linkFrom ? "crosshair" : "grab", background: "var(--bg-0)", backgroundImage: "radial-gradient(var(--line-1) 0.7px, transparent 0.7px)", backgroundSize: `${22 * view.z}px ${22 * view.z}px`, backgroundPosition: `${view.x}px ${view.y}px`, touchAction: "none" }}>
        <div ref={worldRef} data-bg="1" style={{ position: "absolute", left: 0, top: 0, width: 1, height: 1, transform: `translate(${view.x}px, ${view.y}px) scale(${view.z})`, transformOrigin: "0 0", transition: animView ? "transform 240ms ease" : "none" }}>
          <svg style={{ position: "absolute", overflow: "visible", left: 0, top: 0 }} width="1" height="1">
            <defs>
              <marker id="mm-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke" /></marker>
            </defs>
            {boundaries.map((b) => (
              <rect key={"b" + b.id} x={b.x} y={b.y} width={b.w} height={b.h} rx={14} fill={b.color} fillOpacity={0.07} stroke={b.color} strokeOpacity={0.5} strokeDasharray="6 4" strokeWidth={1.2} style={{ transition: dragging ? "none" : "x 180ms, y 180ms, width 180ms, height 180ms" }} />
            ))}
            {edges.map((e) => (
              <path key={e.key} d={e.d} fill="none" stroke={e.color} strokeWidth={2} opacity={matches && !matches.has(e.id) ? 0.25 : 0.7} strokeDasharray={e.dashed ? "5 4" : ""} strokeLinecap="round"
                style={{ d: `path("${e.d}")`, transition: dragging ? "none" : "d 180ms ease" }} />
            ))}
            {freeEdges.map((l) => (
              <g key={l.id}>
                <path d={l.d} fill="none" stroke="transparent" strokeWidth={14} style={{ pointerEvents: "stroke", cursor: "pointer" }} onPointerDown={(e) => { e.stopPropagation(); setSel([]); setSelLink(l.id); }} />
                <path d={l.d} fill="none" stroke={l.color || "var(--accent)"} strokeWidth={selLink === l.id ? 2.4 : 1.6} strokeDasharray="6 4" opacity={0.85} pointerEvents="none"
                  markerEnd={l.arrow === "end" || l.arrow === "both" ? "url(#mm-arrow)" : undefined} markerStart={l.arrow === "both" ? "url(#mm-arrow)" : undefined} />
                {l.label && l.mid && (
                  <text x={l.mid.x} y={l.mid.y - 6} textAnchor="middle" fontSize={11} fill={l.color || "var(--accent)"} style={{ paintOrder: "stroke", stroke: "var(--bg-0)", strokeWidth: 4, pointerEvents: "none", fontFamily: "var(--sans)" }}>{l.label}</text>
                )}
              </g>
            ))}
            {marquee && <rect x={marquee.x} y={marquee.y} width={marquee.w} height={marquee.h} fill="var(--accent)" fillOpacity={0.08} stroke="var(--accent)" strokeWidth={1} />}
          </svg>

          {nodes.map((n) => {
            if (!rects[n.id]) return null;
            const r = rects[n.id];
            return (
              <NodeView key={n.id} node={n} x={r.x} y={r.y} color={colorOf(n.id)} depth={depthOf(nodeMap, n.id)} side={sideOf(n.id)}
                selected={selSet.has(n.id)} primary={primary === n.id} editing={editing?.id === n.id ? editing : null}
                hasKids={(kids[n.id] || []).length > 0} hiddenCount={hidden(n.id)} dimmed={!!matches && !matches.has(n.id)}
                dragging={!!dragging} dragged={!!dragging?.ids.includes(n.id)} dropZone={dragging?.target?.id === n.id ? dragging.target.zone : null}
                linkSource={linkFrom === n.id} measure={measure} h={H} />
            );
          })}
        </div>

        {/* Toolbar flutuante do nó selecionado */}
        {selNode && toolbarPos && !editing && !dragging && (
          <NodeToolbar node={selNode} color={colorOf(selNode.id)} count={sel.length} pos={toolbarPos} isMobile={isMobile}
            onColor={(c) => patchNodes(sel, { color: c })} onBold={() => patchNodes(sel, { bold: !selNode.bold })}
            onShape={() => patchNodes(sel, { shape: SHAPES[(SHAPES.indexOf(selNode.shape || "rounded") + 1) % SHAPES.length] })}
            onNote={() => setPop({ kind: "note", id: selNode.id })} onEmoji={() => setPop({ kind: "emoji", id: selNode.id })}
            onImage={() => setPop({ kind: "image", id: selNode.id })} onLink={() => setPop({ kind: "link", id: selNode.id })}
            onConnect={() => setLinkFrom((f) => (f ? null : selNode.id))} connecting={linkFrom === selNode.id}
            onMore={(e) => setMenu({ x: e.clientX, y: e.clientY, id: selNode.id })} onDelete={() => deleteNodes(sel)} />
        )}
        {pop && nodeMap[pop.id] && rects[pop.id] && (
          <NodePopover kind={pop.kind} node={nodeMap[pop.id]} onClose={() => setPop(null)}
            pos={{ left: rects[pop.id].x * view.z + view.x, top: (rects[pop.id].y + rects[pop.id].h) * view.z + view.y + (isMobile ? 10 : 48) }}
            onSave={(patch) => { patchNodes([pop.id], patch); }} onImageFile={(f) => attachImage(pop.id, f)} />
        )}
        {selLink && (() => {
          const l = freeEdges.find((x) => x.id === selLink); if (!l?.mid) return null;
          return <LinkPopover link={l} pos={{ left: l.mid.x * view.z + view.x, top: l.mid.y * view.z + view.y + 10 }} onClose={() => setSelLink(null)}
            onChange={(patch) => commit((d) => ({ ...d, links: d.links.map((x) => (x.id === l.id ? { ...x, ...patch } : x)) }))}
            onDelete={() => { commit((d) => ({ ...d, links: d.links.filter((x) => x.id !== l.id) })); setSelLink(null); }} />;
        })()}
        {menu && nodeMap[menu.id] && <Menu x={menu.x} y={menu.y} onClose={() => setMenu(null)} items={menuItems(menu.id)} />}
        {linkFrom && <div style={{ position: "absolute", top: 10, left: "50%", transform: "translateX(-50%)", padding: "5px 12px", borderRadius: 999, background: "var(--accent-soft)", border: "1px solid var(--accent-line)", color: "var(--accent)", fontSize: 12, pointerEvents: "none" }}>clique no nó de destino da conexão · Esc cancela</div>}

        {nodes.length === 0 && (
          <div className="dim" style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12.5, pointerEvents: "none", textAlign: "center", lineHeight: 1.8 }}>
            aperte <kbd>Enter</kbd> ou dê 2 cliques no fundo pra criar o 1º nó<br /><kbd>Tab</kbd> cria filho · <kbd>Enter</kbd> cria irmão · setas navegam · <kbd>{MOD}Z</kbd> desfaz
          </div>
        )}
        {!isMobile && !focus && nodes.length > 0 && (
          <div className="dim" style={{ position: "absolute", left: 12, bottom: 10, fontSize: 11.5, pointerEvents: "none" }}>Tab filho · Enter irmão · espaço recolhe · arraste um nó sobre outro pra mover · {MOD}+roda dá zoom</div>
        )}
      </div>
      )}
    </div>
  );
}

// ── Nó ───────────────────────────────────────────────────────────────────────
const NodeView = React.memo(function NodeView({ node: n, x, y, color, depth, side, selected, primary, editing, hasKids, hiddenCount, dimmed, dragging, dragged, dropZone, linkSource, measure, h }) {
  const onPointerDown = (e, id) => h.current.onPointerDown(e, id);
  const onDoubleClick = (id) => h.current.onDoubleClick(id);
  const onContextMenu = (e, id) => h.current.onContextMenu(e, id);
  const onCommitText = (id, t) => h.current.onCommitText(id, t);
  const onEnterInEdit = (id, t, shift) => h.current.onEnterInEdit(id, t, shift);
  const onTabInEdit = (id, t) => h.current.onTabInEdit(id, t);
  const onToggle = (id) => h.current.onToggle(id);
  const onAddChild = (id) => h.current.onAddChild(id);
  const root = depth === 0;
  const shape = n.shape || (root ? "rounded" : "rounded");
  const radius = shape === "pill" ? 999 : shape === "rect" ? 3 : 8;
  const line = shape === "line";
  const edge = selected ? color : color + "73";
  const ring = selected ? `0 0 0 2px ${color}66` : linkSource ? "0 0 0 2px var(--accent)" : "";
  const dropRing = dropZone === "child" ? `0 0 0 3px var(--accent)` : "";
  return (
    <div ref={measure} data-id={n.id} onPointerDown={(e) => onPointerDown(e, n.id)} onDoubleClick={(e) => { e.stopPropagation(); onDoubleClick(n.id); }} onContextMenu={(e) => onContextMenu(e, n.id)}
      style={{ position: "absolute", left: 0, top: 0, transform: `translate(${x}px, ${y}px)`, transition: dragging ? "none" : "transform 180ms ease, opacity 180ms",
        width: "max-content", maxWidth: NODE_MAX_W, minWidth: 40, boxSizing: "border-box",
        background: line ? "transparent" : "var(--bg-1)", borderRadius: radius,
        borderTop: line ? "1px solid transparent" : `1px solid ${edge}`, borderRight: line ? "1px solid transparent" : `1px solid ${edge}`,
        borderBottom: line ? `2px solid ${color}` : `1px solid ${edge}`,
        borderLeft: line ? "1px solid transparent" : shape === "pill" ? `1px solid ${edge}` : `3px solid ${color}`,
        boxShadow: [dropRing, ring, line ? "" : "var(--shadow-1)"].filter(Boolean).join(", ") || "none",
        padding: root ? "9px 14px" : "7px 10px", cursor: "grab", userSelect: "none", touchAction: "none",
        opacity: dragged ? 0.5 : dimmed ? 0.3 : 1, zIndex: dragged ? 3 : primary ? 2 : 1 }}>
      {(dropZone === "before" || dropZone === "after") && (
        <div style={{ position: "absolute", left: 0, right: 0, height: 3, borderRadius: 2, background: "var(--accent)", top: dropZone === "before" ? -8 : undefined, bottom: dropZone === "after" ? -8 : undefined }} />
      )}
      {n.image && <img src={assetUrl(n.image)} alt="" draggable={false} style={{ display: "block", maxWidth: "100%", maxHeight: 140, borderRadius: 4, marginBottom: 6, pointerEvents: "none" }} />}
      {editing ? (
        <NodeEditor id={n.id} text={editing.initial != null ? editing.initial : n.text} selectAll={editing.initial == null} onCommit={onCommitText} onEnter={onEnterInEdit} onTab={onTabInEdit} root={root} bold={n.bold} />
      ) : (
        <div style={{ display: "flex", gap: 6, alignItems: "baseline", fontSize: root ? 14 : 13, lineHeight: 1.35, color: n.text ? "var(--fg-1)" : "var(--fg-4)", whiteSpace: "pre-wrap", wordBreak: "break-word", fontWeight: root || n.bold ? 700 : 500 }}>
          {n.emoji && <span style={{ flexShrink: 0 }}>{n.emoji}</span>}
          <span style={{ minWidth: 0 }}>{n.text || "escreva…"}</span>
          {n.note && <span title={n.note} style={{ flexShrink: 0, fontSize: 10.5, color: "var(--fg-4)" }}>📝</span>}
          {n.link && <a href={n.link} target="_blank" rel="noreferrer" onPointerDown={(e) => e.stopPropagation()} title={n.link} style={{ flexShrink: 0, fontSize: 10.5, color: "var(--accent)", textDecoration: "none" }}>🔗</a>}
        </div>
      )}
      {/* recolher/expandir: nozinho na borda externa do ramo */}
      {hasKids && (
        <button onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); onToggle(n.id); }} title={n.collapsed ? `Expandir (${hiddenCount} escondidos) · espaço` : "Recolher · espaço"}
          style={{ position: "absolute", [side === "left" ? "left" : "right"]: -9, top: "calc(50% - 8px)", minWidth: 16, height: 16, padding: "0 3px", borderRadius: 999, background: n.collapsed ? color : "var(--bg-1)", color: n.collapsed ? "#fff" : color, border: `1.5px solid ${color}`, fontSize: 9.5, lineHeight: 1, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2 }}>
          {n.collapsed ? hiddenCount : "−"}
        </button>
      )}
      {primary && !editing && !hasKids && (
        <button onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); onAddChild(n.id); }} title="Adicionar filho (Tab)"
          style={{ position: "absolute", [side === "left" ? "left" : "right"]: -11, top: "calc(50% - 11px)", width: 22, height: 22, borderRadius: 999, background: color, color: "#fff", border: "2px solid var(--bg-0)", fontSize: 14, lineHeight: 1, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>+</button>
      )}
    </div>
  );
});

function NodeEditor({ id, text, selectAll, onCommit, onEnter, onTab, root, bold }) {
  const ref = useRef(null);
  const done = useRef(false);
  const fit = (el) => { el.style.height = "auto"; el.style.height = el.scrollHeight + "px"; };
  useEffect(() => {
    const el = ref.current; if (!el) return;
    fit(el); el.focus();
    if (selectAll) el.select(); else el.setSelectionRange(el.value.length, el.value.length);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const finish = (fn) => { if (done.current) return; done.current = true; fn(); };
  return (
    <textarea ref={ref} defaultValue={text} rows={1} onPointerDown={(e) => e.stopPropagation()} onInput={(e) => fit(e.target)}
      onBlur={(e) => finish(() => onCommit(id, e.target.value))}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !e.altKey && !e.metaKey && !e.ctrlKey) {
          // Shift+Enter = quebra de linha; Enter = confirma e cria irmão
          if (e.shiftKey) return;
          e.preventDefault(); const v = e.currentTarget.value; finish(() => onEnter(id, v, false));
        } else if (e.key === "Tab") { e.preventDefault(); const v = e.currentTarget.value; finish(() => onTab(id, v)); }
        else if (e.key === "Escape") { e.preventDefault(); const v = e.currentTarget.value; finish(() => onCommit(id, v)); }
        e.stopPropagation();
      }}
      style={{ width: "100%", minWidth: 120, border: "none", outline: "none", resize: "none", background: "transparent", color: "var(--fg-1)", fontSize: root ? 14 : 13, fontWeight: root || bold ? 700 : 500, fontFamily: "inherit", lineHeight: 1.35, padding: 0, display: "block" }} />
  );
}

// ── Toolbar do nó, popovers e menus ──────────────────────────────────────────
function TBtn({ title, onClick, disabled, active, children, style }) {
  return (
    <button title={title} onClick={onClick} disabled={disabled} style={{ height: 28, minWidth: 28, padding: "0 7px", borderRadius: "var(--r-2)", border: `1px solid ${active ? "var(--accent-line)" : "var(--line-2)"}`, background: active ? "var(--accent-soft)" : "var(--bg-1)", color: active ? "var(--accent)" : "var(--fg-2)", fontSize: 13, cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.4 : 1, display: "inline-flex", alignItems: "center", justifyContent: "center", ...style }}>{children}</button>
  );
}
function NodeToolbar({ node, color, count, pos, isMobile, onColor, onBold, onShape, onNote, onEmoji, onImage, onLink, onConnect, connecting, onMore, onDelete }) {
  const style = { position: "absolute", zIndex: 5, display: "flex", gap: 4, alignItems: "center", flexWrap: "wrap", maxWidth: "calc(100% - 20px)", background: "var(--bg-1)", border: "1px solid var(--line-1)", borderRadius: "var(--r-3)", padding: "5px 6px", boxShadow: "var(--shadow-pop)" };
  const place = isMobile ? { left: 8, right: 8, bottom: 8 } : pos.above ? { left: Math.max(8, pos.left), top: pos.nodeTop - 8, transform: "translateY(-100%)" } : { left: Math.max(8, pos.left), top: pos.top };
  return (
    <div style={{ ...style, ...place }} onPointerDown={(e) => e.stopPropagation()}>
      {COLORS.map((c) => (
        <button key={c} onClick={() => onColor(c === COLORS[0] ? "" : c)} title={c === COLORS[0] ? "cor do ramo (automática)" : "cor"}
          style={{ width: 16, height: 16, borderRadius: 999, background: c, cursor: "pointer", border: (node.color || "") === (c === COLORS[0] ? "" : c) ? "2px solid var(--fg-1)" : "2px solid transparent", boxSizing: "border-box" }} />
      ))}
      <span style={{ width: 1, height: 18, background: "var(--line-1)", margin: "0 2px" }} />
      <TBtn title="Negrito" onClick={onBold} active={!!node.bold} style={{ fontWeight: 800 }}>B</TBtn>
      <TBtn title={`Forma: ${node.shape || "arredondado"} (clique pra trocar)`} onClick={onShape}>{node.shape === "pill" ? "◖◗" : node.shape === "rect" ? "▭" : node.shape === "line" ? "▁" : "▢"}</TBtn>
      <TBtn title="Nota (⌥⇧N)" onClick={onNote} active={!!node.note}>📝</TBtn>
      <TBtn title="Emoji" onClick={onEmoji} active={!!node.emoji}>{node.emoji || "☺"}</TBtn>
      <TBtn title="Imagem (ou cole uma com o nó selecionado)" onClick={onImage} active={!!node.image}>🖼</TBtn>
      <TBtn title="Link" onClick={onLink} active={!!node.link}>🔗</TBtn>
      <TBtn title="Conectar a outro nó (⌥C)" onClick={onConnect} active={connecting}>⤳</TBtn>
      <TBtn title="Mais opções" onClick={onMore}>…</TBtn>
      <TBtn title={count > 1 ? `Apagar ${count} nós (Delete)` : "Apagar nó e filhos (Delete)"} onClick={onDelete} style={{ color: "var(--neg)" }}>✕</TBtn>
      {count > 1 && <span className="mono tnum dim" style={{ fontSize: 10.5, marginLeft: 2 }}>{count} nós</span>}
    </div>
  );
}
function Popover({ pos, onClose, children, width = 280 }) {
  useEsc(onClose);
  return (
    <div onPointerDown={(e) => e.stopPropagation()} style={{ position: "absolute", left: Math.max(8, Math.min(pos.left, (window.innerWidth || 1200) - width - 260)), top: pos.top, zIndex: 7, width, background: "var(--bg-1)", border: "1px solid var(--line-1)", borderRadius: "var(--r-3)", padding: 10, boxShadow: "var(--shadow-pop)", display: "flex", flexDirection: "column", gap: 8 }}>
      {children}
    </div>
  );
}
function NodePopover({ kind, node, pos, onClose, onSave, onImageFile }) {
  const [val, setVal] = useState(kind === "note" ? node.note || "" : kind === "link" ? node.link || "" : "");
  const save = () => { onSave(kind === "note" ? { note: val.trim() } : { link: val.trim() }); onClose(); };
  if (kind === "emoji") {
    return (
      <Popover pos={pos} onClose={onClose} width={300}>
        <div className="kicker">emoji do nó</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(8, 1fr)", gap: 2 }}>
          {EMOJIS.map((e) => <button key={e} onClick={() => { onSave({ emoji: e }); onClose(); }} style={{ height: 30, fontSize: 17, borderRadius: 6, background: node.emoji === e ? "var(--accent-soft)" : "transparent" }}>{e}</button>)}
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <input className="inp" placeholder="ou digite/cole um emoji" onChange={(e) => { const v = e.target.value.trim(); if (v) { onSave({ emoji: [...v][0] }); onClose(); } }} style={{ flex: 1, height: 28, fontSize: 12.5 }} />
          {node.emoji && <button onClick={() => { onSave({ emoji: "" }); onClose(); }} style={{ fontSize: 12, color: "var(--neg)" }}>tirar</button>}
        </div>
      </Popover>
    );
  }
  if (kind === "image") {
    return (
      <Popover pos={pos} onClose={onClose}>
        <div className="kicker">imagem do nó</div>
        <input type="file" accept="image/*" onChange={(e) => { const f = e.target.files?.[0]; if (f) { onImageFile(f); onClose(); } }} style={{ fontSize: 12 }} />
        <div className="dim" style={{ fontSize: 11.5 }}>ou copie uma imagem e cole (⌘V) com o nó selecionado</div>
        {node.image && <button onClick={() => { onSave({ image: "" }); onClose(); }} style={{ alignSelf: "flex-start", fontSize: 12, color: "var(--neg)" }}>tirar imagem</button>}
      </Popover>
    );
  }
  return (
    <Popover pos={pos} onClose={onClose} width={kind === "note" ? 320 : 300}>
      <div className="kicker">{kind === "note" ? "nota do nó" : "link do nó"}</div>
      {kind === "note"
        ? <textarea autoFocus className="inp" value={val} onChange={(e) => setVal(e.target.value)} rows={5} placeholder="detalhe que não cabe no nó…" onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) save(); e.stopPropagation(); }} style={{ height: "auto", padding: 8, fontSize: 12.5, lineHeight: 1.45, resize: "vertical" }} />
        : <input autoFocus className="inp" value={val} onChange={(e) => setVal(e.target.value)} placeholder="https://…" onKeyDown={(e) => { if (e.key === "Enter") save(); e.stopPropagation(); }} style={{ height: 30, fontSize: 12.5 }} />}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", alignItems: "center" }}>
        {(kind === "note" ? node.note : node.link) && <button onClick={() => { onSave(kind === "note" ? { note: "" } : { link: "" }); onClose(); }} style={{ fontSize: 12, color: "var(--neg)", marginRight: "auto" }}>tirar</button>}
        <button onClick={onClose} style={{ fontSize: 12, color: "var(--fg-3)" }}>cancelar</button>
        <button onClick={save} style={{ height: 28, padding: "0 12px", borderRadius: "var(--r-2)", background: "var(--btn-bg)", color: "var(--btn-fg)", fontSize: 12.5, fontWeight: 600 }}>{kind === "note" ? `salvar (${MOD}↵)` : "salvar"}</button>
      </div>
    </Popover>
  );
}
function LinkPopover({ link, pos, onClose, onChange, onDelete }) {
  return (
    <Popover pos={pos} onClose={onClose} width={300}>
      <div className="kicker">conexão</div>
      <input className="inp" defaultValue={link.label} placeholder="rótulo (ex.: depende de)" onBlur={(e) => onChange({ label: e.target.value.trim() })} onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); e.stopPropagation(); }} style={{ height: 28, fontSize: 12.5 }} />
      <div style={{ display: "flex", gap: 4, alignItems: "center", flexWrap: "wrap" }}>
        {[["none", "sem seta"], ["end", "→"], ["both", "↔"]].map(([v, l]) => <TBtn key={v} active={(link.arrow || "none") === v} onClick={() => onChange({ arrow: v })} title="ponta da linha">{l}</TBtn>)}
        <span style={{ width: 1, height: 18, background: "var(--line-1)", margin: "0 2px" }} />
        {["", ...COLORS.slice(1)].map((c) => <button key={c || "auto"} onClick={() => onChange({ color: c })} title={c || "cor padrão"} style={{ width: 16, height: 16, borderRadius: 999, background: c || "var(--accent)", border: (link.color || "") === c ? "2px solid var(--fg-1)" : "2px solid transparent", boxSizing: "border-box" }} />)}
        <button onClick={onDelete} title="Apagar conexão (Delete)" style={{ marginLeft: "auto", fontSize: 12, color: "var(--neg)" }}>apagar</button>
      </div>
    </Popover>
  );
}
function Menu({ x, y, items, onClose }) {
  useEsc(onClose);
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.right > window.innerWidth - 8) el.style.left = Math.max(8, x - r.width) + "px";
    if (r.bottom > window.innerHeight - 8) el.style.top = Math.max(8, y - r.height) + "px";
    const onDown = (e) => { if (!el.contains(e.target)) onClose(); };
    setTimeout(() => window.addEventListener("pointerdown", onDown), 0);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [x, y, onClose]);
  return (
    <div ref={ref} onPointerDown={(e) => e.stopPropagation()} onContextMenu={(e) => e.preventDefault()} style={{ position: "fixed", left: x, top: y, zIndex: 90, minWidth: 230, background: "var(--bg-1)", border: "1px solid var(--line-1)", borderRadius: "var(--r-3)", boxShadow: "var(--shadow-pop)", padding: 4 }}>
      {items.map((it, i) => it.sep
        ? <div key={"s" + i} style={{ height: 1, background: "var(--line-1)", margin: "4px 6px" }} />
        : <button key={it.label} disabled={it.disabled} onClick={() => { onClose(); it.onClick && it.onClick(); }}
            style={{ display: "flex", width: "100%", alignItems: "center", gap: 12, padding: "6px 10px", borderRadius: 6, fontSize: 12.5, textAlign: "left", color: it.danger ? "var(--neg)" : "var(--fg-1)", opacity: it.disabled ? 0.4 : 1, cursor: it.disabled ? "default" : "pointer" }}
            onMouseEnter={(e) => { if (!it.disabled) e.currentTarget.style.background = "var(--bg-2)"; }} onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}>
            <span style={{ flex: 1 }}>{it.label}</span>
            {it.kbd && <span className="mono dim" style={{ fontSize: 10.5 }}>{it.kbd}</span>}
          </button>)}
    </div>
  );
}
function LevelsMenu({ onPick }) {
  const [open, setOpen] = useState(null);
  return (
    <>
      <TBtn title="Mostrar só N níveis (⌥1…⌥9, ⌥0 = todos)" onClick={(e) => setOpen({ x: e.clientX, y: e.clientY + 10 })}>≡</TBtn>
      {open && <Menu x={open.x} y={open.y} onClose={() => setOpen(null)} items={[1, 2, 3, 4, 5].map((n) => ({ label: `mostrar ${n} ${n === 1 ? "nível" : "níveis"}`, kbd: `⌥${n}`, onClick: () => onPick(n) })).concat([{ sep: true }, { label: "expandir tudo", kbd: "⌥0", onClick: () => onPick(null) }])} />}
    </>
  );
}
function ExportMenu({ onMd, onPng, onSvg }) {
  const [open, setOpen] = useState(null);
  return (
    <>
      <TBtn title="Exportar" onClick={(e) => setOpen({ x: e.clientX, y: e.clientY + 10 })}>⇩</TBtn>
      {open && <Menu x={open.x} y={open.y} onClose={() => setOpen(null)} items={[
        { label: "Copiar esboço (Markdown)", onClick: onMd },
        { label: "Baixar PNG", onClick: onPng },
        { label: "Baixar SVG", onClick: onSvg },
      ]} />}
    </>
  );
}

// ── Esboço (mesmo mapa como lista recuada, editável) ─────────────────────────
function OutlineView({ nodes, kids, nodeMap, commit, colorOf }) {
  const rows = useMemo(() => {
    const out = [];
    const walk = (n, d) => { out.push({ n, d }); if (!n.collapsed) for (const k of kids[n.id] || []) walk(k, d + 1); };
    for (const r of nodes.filter((n) => !n.parent).sort((a, b) => a.order - b.order)) walk(r, 0);
    return out;
  }, [nodes, kids]);
  const [focusId, setFocusId] = useState(null);
  const refs = useRef({});
  useEffect(() => { if (focusId && refs.current[focusId]) { refs.current[focusId].focus(); setFocusId(null); } }, [rows, focusId]);
  const setText = (id, text) => commit((d) => ({ ...d, nodes: d.nodes.map((n) => (n.id === id && n.text !== text ? { ...n, text } : n)) }));
  const onKey = (e, row, i) => {
    const id = row.n.id;
    if (e.key === "Enter") {
      e.preventDefault(); setText(id, e.currentTarget.value);
      let nid_; commit((d) => { const r = addSibling(d.nodes, id, ""); nid_ = r.id; return { ...d, nodes: r.nodes }; }); setFocusId(nid_);
    } else if (e.key === "Tab") {
      e.preventDefault(); setText(id, e.currentTarget.value);
      if (e.shiftKey) { const p = nodeMap[id]?.parent; if (!p) return; const gp = nodeMap[p]?.parent || null; const pi = nodeMap[p]?.order || 0; commit((d) => ({ ...d, nodes: moveNode(d.nodes, id, gp, pi + 1) })); }
      else { const prev = rows.slice(0, i).reverse().find((r) => r.d === row.d && (r.n.parent || null) === (row.n.parent || null)); if (!prev) return; commit((d) => ({ ...d, nodes: moveNode(d.nodes, id, prev.n.id, null).map((n) => (n.id === prev.n.id ? { ...n, collapsed: false } : n)) })); }
      setFocusId(id);
    } else if (e.key === "Backspace" && !e.currentTarget.value && !(kids[id] || []).length) {
      e.preventDefault(); const prev = rows[i - 1]?.n.id;
      commit((d) => { const r = removeSubtrees(d.nodes, d.links, [id]); return { ...d, nodes: r.nodes, links: r.links }; }); if (prev) setFocusId(prev);
    } else if (e.key === "ArrowUp" && rows[i - 1]) { e.preventDefault(); refs.current[rows[i - 1].n.id]?.focus(); }
    else if (e.key === "ArrowDown" && rows[i + 1]) { e.preventDefault(); refs.current[rows[i + 1].n.id]?.focus(); }
    else if (e.key === "Escape") { e.currentTarget.blur(); }
    e.stopPropagation();
  };
  return (
    <div style={{ flex: 1, overflow: "auto", padding: "20px var(--pad-x)" }}>
      <div style={{ maxWidth: 820 }}>
        {rows.length === 0 && <div className="dim" style={{ fontSize: 12.5 }}>mapa vazio · volte pra vista de Mapa e aperte Enter pra criar o 1º nó</div>}
        {rows.map((row, i) => {
          const has = (kids[row.n.id] || []).length > 0; const c = colorOf(row.n.id);
          return (
            <div key={row.n.id} style={{ display: "flex", alignItems: "center", gap: 6, paddingLeft: row.d * 24, borderLeft: row.d ? undefined : "none" }}>
              <button onClick={() => commit((d) => ({ ...d, nodes: d.nodes.map((n) => (n.id === row.n.id ? { ...n, collapsed: !n.collapsed } : n)) }))} disabled={!has} title={has ? (row.n.collapsed ? "expandir" : "recolher") : ""}
                style={{ width: 16, height: 16, borderRadius: 999, fontSize: 10, color: has ? c : "var(--line-2)", border: `1.5px solid ${has ? c : "var(--line-2)"}`, background: row.n.collapsed ? c : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{has ? (row.n.collapsed ? "+" : "−") : ""}</button>
              {row.n.emoji && <span style={{ fontSize: 13 }}>{row.n.emoji}</span>}
              <input ref={(el) => { refs.current[row.n.id] = el; }} defaultValue={row.n.text} key={row.n.id + row.n.text} placeholder="escreva…"
                onBlur={(e) => setText(row.n.id, e.target.value.trim())} onKeyDown={(e) => onKey(e, row, i)}
                style={{ flex: 1, height: 30, border: "none", borderBottom: "1px solid transparent", background: "transparent", fontSize: row.d === 0 ? 15 : 13, fontWeight: row.d === 0 || row.n.bold ? 700 : 500, color: "var(--fg-1)", padding: "0 4px", outline: "none" }}
                onFocus={(e) => { e.target.style.borderBottomColor = "var(--accent-line)"; }} onBlurCapture={(e) => { e.target.style.borderBottomColor = "transparent"; }} />
              {row.n.note && <span className="dim" title={row.n.note} style={{ fontSize: 11.5, maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.n.note}</span>}
            </div>
          );
        })}
        <div className="dim" style={{ fontSize: 11.5, marginTop: 14 }}>Enter cria irmão · Tab recua (vira filho do de cima) · Shift+Tab sobe · Backspace em linha vazia apaga</div>
      </div>
    </div>
  );
}

// ── Exportar (SVG com o mesmo desenho; PNG via canvas) ───────────────────────
function cssVar(name, fallback) {
  try { return getComputedStyle(document.body).getPropertyValue(name).trim() || fallback; } catch { return fallback; }
}
function esc(s) { return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
function buildSvg({ nodes, rects, edges, freeEdges, boundaries, colorOf, nodeMap, name }) {
  const ids = Object.keys(rects); if (!ids.length) throw new Error("mapa vazio");
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const id of ids) { const r = rects[id]; minX = Math.min(minX, r.x); minY = Math.min(minY, r.y); maxX = Math.max(maxX, r.x + r.w); maxY = Math.max(maxY, r.y + r.h); }
  for (const b of boundaries) { minX = Math.min(minX, b.x); minY = Math.min(minY, b.y); maxX = Math.max(maxX, b.x + b.w); maxY = Math.max(maxY, b.y + b.h); }
  const pad = 40; const w = Math.ceil(maxX - minX + pad * 2), h = Math.ceil(maxY - minY + pad * 2);
  const bg = cssVar("--bg-0", "#f7f8fa"), card = cssVar("--bg-1", "#ffffff"), ink = cssVar("--fg-1", "#0c1d2b"), accent = cssVar("--accent", "#0f766e");
  const font = "Instrument Sans, Helvetica Neue, Arial, sans-serif";
  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${minX - pad} ${minY - pad} ${w} ${h}">`,
    `<title>${esc(name)}</title><rect x="${minX - pad}" y="${minY - pad}" width="${w}" height="${h}" fill="${bg}"/>`,
    `<defs><marker id="a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="${accent}"/></marker></defs>`];
  for (const b of boundaries) parts.push(`<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="14" fill="${b.color}" fill-opacity="0.07" stroke="${b.color}" stroke-opacity="0.5" stroke-dasharray="6 4"/>`);
  for (const e of edges) parts.push(`<path d="${e.d}" fill="none" stroke="${e.color}" stroke-width="2" opacity="0.7" stroke-linecap="round"${e.dashed ? ' stroke-dasharray="5 4"' : ""}/>`);
  for (const l of freeEdges) {
    parts.push(`<path d="${l.d}" fill="none" stroke="${l.color || accent}" stroke-width="1.6" stroke-dasharray="6 4" opacity="0.85"${l.arrow === "end" || l.arrow === "both" ? ' marker-end="url(#a)"' : ""}${l.arrow === "both" ? ' marker-start="url(#a)"' : ""}/>`);
    if (l.label && l.mid) parts.push(`<text x="${l.mid.x}" y="${l.mid.y - 6}" text-anchor="middle" font-size="11" font-family="${font}" fill="${l.color || accent}">${esc(l.label)}</text>`);
  }
  for (const id of ids) {
    const n = nodeMap[id]; const r = rects[id]; const c = colorOf(id); const root = !n.parent;
    const shape = n.shape || "rounded"; const rx = shape === "pill" ? r.h / 2 : shape === "rect" ? 3 : 8;
    if (shape !== "line") parts.push(`<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" rx="${rx}" fill="${card}" stroke="${c}" stroke-opacity="0.6"/>`);
    else parts.push(`<line x1="${r.x}" y1="${r.y + r.h}" x2="${r.x + r.w}" y2="${r.y + r.h}" stroke="${c}" stroke-width="2"/>`);
    if (shape !== "line" && shape !== "pill") parts.push(`<rect x="${r.x}" y="${r.y}" width="3" height="${r.h}" rx="1.5" fill="${c}"/>`);
    const padX = root ? 14 : 10, padY = root ? 9 : 7;
    parts.push(`<foreignObject x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}"><div xmlns="http://www.w3.org/1999/xhtml" style="box-sizing:border-box;width:${r.w}px;height:${r.h}px;padding:${padY}px ${padX}px;font-family:${font};font-size:${root ? 14 : 13}px;line-height:1.35;font-weight:${root || n.bold ? 700 : 500};color:${ink};white-space:pre-wrap;word-break:break-word;display:flex;gap:6px;align-items:baseline">${n.emoji ? `<span>${esc(n.emoji)}</span>` : ""}<span>${esc(n.text)}</span>${n.note ? '<span style="font-size:10px;opacity:.6">📝</span>' : ""}</div></foreignObject>`);
  }
  parts.push("</svg>");
  return { text: parts.join(""), w, h };
}
function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
