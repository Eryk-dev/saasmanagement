import React from "react";
import { EmptyState } from "../atoms.jsx";
import { api } from "../lib/api.js";
import { useActiveSaas } from "../lib/workspace.js";
import { useIsMobile } from "../lib/responsive.js";
// Mapas mentais / estratégia — um canvas pra pensar em nós: ideias que ramificam
// (árvore pai→filho) e conexões livres entre quaisquer nós (estratégia). Pan/zoom,
// arrastar, cores, auto-organizar (layout em árvore) e vários mapas. Cada mapa é
// um doc na coleção `mindmaps` (nodes[] + links[]), com autosave debounced.

const { useState, useEffect, useRef, useCallback } = React;

// Paleta de cores dos nós (borda + tinta suave). A 1ª é o "neutro".
const COLORS = ["#64748b", "#0ea5e9", "#22c55e", "#f59e0b", "#ef4444", "#a855f7", "#ec4899"];
const nid = () => "n" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
const NODE_W = 172;

// ── Layout em árvore (auto-organizar) ────────────────────────────────────────
// Tidy-tree horizontal: profundidade = coluna (x), folhas empilham (y) e o pai
// centraliza nos filhos. Nós sem pai (ou órfãos) viram raízes empilhadas.
function arrange(nodes) {
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const kids = {}; const roots = [];
  for (const n of nodes) {
    if (n.parent && byId[n.parent] && n.parent !== n.id) (kids[n.parent] ||= []).push(n.id);
    else roots.push(n.id);
  }
  const XG = 230, YG = 82; const pos = {}; let cursor = 0; const seen = new Set();
  const place = (id, depth) => {
    if (seen.has(id)) { const y = cursor; cursor += YG; pos[id] = { x: depth * XG, y }; return y; }
    seen.add(id);
    const cs = kids[id] || [];
    let y;
    if (!cs.length) { y = cursor; cursor += YG; }
    else { const ys = cs.map((c) => place(c, depth + 1)); y = (ys[0] + ys[ys.length - 1]) / 2; }
    pos[id] = { x: depth * XG, y };
    return y;
  };
  roots.forEach((r) => { place(r, 0); cursor += YG * 0.5; });
  return nodes.map((n) => ({ ...n, x: pos[n.id] ? Math.round(pos[n.id].x) : n.x, y: pos[n.id] ? Math.round(pos[n.id].y) : n.y }));
}

export function MindmapsScreen() {
  const isMobile = useIsMobile();
  const [activeProduct] = useActiveSaas();
  const [maps, setMaps] = useState(null); // lista de mapas
  const [activeId, setActiveId] = useState(null);
  const [renaming, setRenaming] = useState(null);

  // Carrega a lista UMA vez (não re-sincroniza pelo SSE pra não atropelar edição).
  useEffect(() => {
    let alive = true;
    api.list("mindmaps").then((rows) => {
      if (!alive) return;
      const list = (rows || []).sort((a, b) => String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || "")));
      setMaps(list);
      setActiveId((cur) => cur || list[0]?.id || null);
    }).catch(() => alive && setMaps([]));
    return () => { alive = false; };
  }, []);

  async function newMap() {
    const doc = { name: "Novo mapa", saas: activeProduct?.id || "", nodes: [], links: [], createdAt: new Date().toISOString() };
    try {
      const created = await api.create("mindmaps", doc);
      setMaps((m) => [created, ...(m || [])]);
      setActiveId(created.id);
      setRenaming(created.id);
    } catch (e) { console.warn("mapa não criado:", e.message); }
  }
  async function renameMap(id, name) {
    setMaps((m) => (m || []).map((x) => x.id === id ? { ...x, name } : x));
    setRenaming(null);
    try { await api.update("mindmaps", id, { name }); } catch { /* ignore */ }
  }
  const onMapSaved = (saved) => setMaps((m) => (m || []).map((x) => x.id === saved.id ? { ...x, ...saved } : x));

  const active = (maps || []).find((m) => m.id === activeId) || null;

  return (
    <div style={{ flex: 1, display: "flex", minHeight: 0, flexDirection: isMobile ? "column" : "row" }}>
        {/* Sidebar: lista de mapas — no mobile vira uma faixa no topo (230px
            fixos deixariam ~160px pro canvas). */}
        <div style={{ width: isMobile ? "100%" : 230, maxHeight: isMobile ? 150 : undefined, flexShrink: 0, borderRight: isMobile ? "none" : "1px solid var(--line-1)", borderBottom: isMobile ? "1px solid var(--line-1)" : "none", overflow: "auto", padding: isMobile ? "10px 12px" : "16px 12px", background: "var(--bg-1)", display: "flex", flexDirection: "column", gap: 2 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 8px 12px" }}>
            <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--fg-4)" }}>Mapas</span>
            <button onClick={newMap} style={{ height: 24, padding: "0 4px", color: "var(--accent)", fontSize: 12.5, fontWeight: 600 }}>+ novo</button>
          </div>
          {maps === null && <div className="mono dim" style={{ fontSize: 11, padding: 10 }}>carregando…</div>}
          {maps !== null && maps.length === 0 && <div className="dim" style={{ fontSize: 12, padding: 10, lineHeight: 1.5 }}>nenhum mapa ainda · crie o primeiro em “+ novo”</div>}
          {(maps || []).map((m) => (
            <div key={m.id} onClick={() => setActiveId(m.id)} onDoubleClick={() => setRenaming(m.id)}
              style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderRadius: "var(--r-2)", cursor: "pointer",
                background: m.id === activeId ? "var(--accent-soft)" : "transparent" }}>
              <span style={{ fontSize: 12, flexShrink: 0, color: m.id === activeId ? "var(--accent)" : "var(--fg-4)" }}>⌬</span>
              {renaming === m.id ? (
                <input autoFocus defaultValue={m.name} onClick={(e) => e.stopPropagation()}
                  onBlur={(e) => renameMap(m.id, e.target.value.trim() || "Sem título")}
                  onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") setRenaming(null); }}
                  style={{ flex: 1, minWidth: 0, height: 22, fontSize: 12.5, background: "var(--bg-2)", border: "1px solid var(--line-2)", borderRadius: 4, color: "var(--fg-1)", padding: "0 6px" }} />
              ) : (
                <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: m.id === activeId ? 600 : 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: m.id === activeId ? "var(--fg-1)" : "var(--fg-2)" }}>{m.name || "Sem título"}</span>
              )}
              <span className="mono tnum dim" style={{ fontSize: 10.5, flexShrink: 0 }}>{(m.nodes || []).length}</span>
            </div>
          ))}
        </div>

        {/* Editor */}
        <div style={{ flex: 1, minWidth: 0, position: "relative" }}>
          {active
            ? <MapEditor key={active.id} map={active} onSaved={onMapSaved} />
            : <EmptyState title="Nenhum mapa aberto" hint={maps && maps.length ? "Escolha um mapa na lista." : "Crie um mapa em “+ novo” pra começar."} />}
        </div>
    </div>
  );
}

// ── Editor do mapa ───────────────────────────────────────────────────────────
function MapEditor({ map, onSaved }) {
  const [nodes, setNodes] = useState(() => (map.nodes || []).map((n) => ({ ...n })));
  const [links, setLinks] = useState(() => (map.links || []).map((l) => ({ ...l })));
  const [sel, setSel] = useState(null);        // nó selecionado
  const [editing, setEditing] = useState(null); // nó em edição de texto
  const [linkFrom, setLinkFrom] = useState(null); // modo conectar: nó de origem
  const [view, setView] = useState({ x: 60, y: 60, z: 1 });
  const [sizes, setSizes] = useState({});       // {id: {w,h}} medidos (pra ligar as arestas)
  const [saved, setSaved] = useState(true);
  const wrapRef = useRef(null);
  const mounted = useRef(false);

  // Autosave debounced (pula o 1º run = montagem).
  useEffect(() => {
    if (!mounted.current) { mounted.current = true; return; }
    setSaved(false);
    const t = setTimeout(() => {
      api.update("mindmaps", map.id, { nodes, links, updatedAt: new Date().toISOString() })
        .then((doc) => { setSaved(true); onSaved && onSaved(doc); })
        .catch(() => setSaved(true));
    }, 700);
    return () => clearTimeout(t);
  }, [nodes, links]); // eslint-disable-line react-hooks/exhaustive-deps

  // Zoom com a roda (listener nativo pra poder preventDefault).
  useEffect(() => {
    const el = wrapRef.current; if (!el) return;
    const onWheel = (e) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const cx = e.clientX - r.left, cy = e.clientY - r.top;
      setView((v) => {
        const z = Math.min(2.4, Math.max(0.3, v.z * (e.deltaY < 0 ? 1.12 : 0.89)));
        const k = z / v.z;
        return { z, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // Zoom centrado na tela (botões −/+ da toolbar; no touch não há roda).
  const zoomBy = (f) => {
    const el = wrapRef.current; if (!el) return;
    const r = el.getBoundingClientRect();
    const cx = r.width / 2, cy = r.height / 2;
    setView((v) => {
      const z = Math.min(2.4, Math.max(0.3, v.z * f));
      const k = z / v.z;
      return { z, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k };
    });
  };

  // Atalhos de teclado (quando não está editando texto).
  useEffect(() => {
    const onKey = (e) => {
      const tag = (e.target.tagName || "").toLowerCase();
      if (editing || tag === "input" || tag === "textarea") return;
      if (!sel) return;
      if (e.key === "Tab") { e.preventDefault(); addChild(sel); }
      else if (e.key === "Enter") { e.preventDefault(); setEditing(sel); }
      else if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); delSubtree(sel); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }); // sem deps: fecha sobre o estado atual a cada render (barato)

  const measure = useCallback((id, el) => {
    if (!el) return;
    const w = el.offsetWidth, h = el.offsetHeight;
    setSizes((s) => (s[id] && s[id].w === w && s[id].h === h) ? s : { ...s, [id]: { w, h } });
  }, []);
  const center = (n) => ({ x: n.x + (sizes[n.id]?.w || NODE_W) / 2, y: n.y + (sizes[n.id]?.h || 46) / 2 });

  // Converte ponto de tela → coordenada do mundo (canvas).
  const toWorld = (clientX, clientY) => {
    const r = wrapRef.current.getBoundingClientRect();
    return { x: (clientX - r.left - view.x) / view.z, y: (clientY - r.top - view.y) / view.z };
  };

  function addNodeAt(clientX, clientY, parent = null, color = COLORS[0]) {
    const p = toWorld(clientX, clientY);
    const id = nid();
    setNodes((ns) => [...ns, { id, x: Math.round(p.x - NODE_W / 2), y: Math.round(p.y - 20), text: "", color, parent }]);
    setSel(id); setEditing(id);
  }
  function addChild(parentId) {
    const p = nodes.find((n) => n.id === parentId); if (!p) return;
    const id = nid();
    // posiciona à direita do pai, empilhando abaixo dos filhos já existentes.
    const sibs = nodes.filter((n) => n.parent === parentId);
    setNodes((ns) => [...ns, { id, x: p.x + 220, y: p.y + sibs.length * 70, text: "", color: p.color, parent: parentId }]);
    setSel(id); setEditing(id);
  }
  function delSubtree(id) {
    const kill = new Set([id]); let more = true;
    while (more) { more = false; for (const n of nodes) if (n.parent && kill.has(n.parent) && !kill.has(n.id)) { kill.add(n.id); more = true; } }
    setNodes((ns) => ns.filter((n) => !kill.has(n.id)));
    setLinks((ls) => ls.filter((l) => !kill.has(l.from) && !kill.has(l.to)));
    setSel(null); setEditing(null);
  }
  const setText = (id, text) => setNodes((ns) => ns.map((n) => n.id === id ? { ...n, text } : n));
  const setColor = (id, color) => setNodes((ns) => ns.map((n) => n.id === id ? { ...n, color } : n));

  // Clique num nó: seleciona; no modo conectar, fecha a ligação.
  function clickNode(id) {
    if (linkFrom) {
      if (linkFrom !== id && !links.some((l) => (l.from === linkFrom && l.to === id) || (l.from === id && l.to === linkFrom)))
        setLinks((ls) => [...ls, { from: linkFrom, to: id }]);
      setLinkFrom(null);
      return;
    }
    setSel(id);
  }

  // Arrastar nó.
  function dragNode(e, id) {
    e.stopPropagation();
    if (linkFrom) return;
    setSel(id);
    const sx = e.clientX, sy = e.clientY;
    const o = nodes.find((n) => n.id === id);
    const ox = o.x, oy = o.y; let moved = false;
    const move = (ev) => {
      moved = true;
      const dx = (ev.clientX - sx) / view.z, dy = (ev.clientY - sy) / view.z;
      setNodes((ns) => ns.map((n) => n.id === id ? { ...n, x: Math.round(ox + dx), y: Math.round(oy + dy) } : n));
    };
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); if (!moved) clickNode(id); };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
  }
  // Pan do canvas (arrastar o fundo).
  function panBg(e) {
    if (e.button !== 0) return;
    setSel(null); setLinkFrom(null);
    const sx = e.clientX, sy = e.clientY; const o = { x: view.x, y: view.y };
    const move = (ev) => setView((v) => ({ ...v, x: o.x + (ev.clientX - sx), y: o.y + (ev.clientY - sy) }));
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
  }

  function autoOrganize() { setNodes((ns) => arrange(ns)); setTimeout(fitView, 30); }
  function fitView() {
    if (!nodes.length) { setView({ x: 60, y: 60, z: 1 }); return; }
    const xs = nodes.map((n) => n.x), ys = nodes.map((n) => n.y);
    const minX = Math.min(...xs) - 40, minY = Math.min(...ys) - 40;
    const maxX = Math.max(...xs.map((x, i) => x + (sizes[nodes[i].id]?.w || NODE_W))) + 40;
    const maxY = Math.max(...ys.map((y, i) => y + (sizes[nodes[i].id]?.h || 46))) + 40;
    const r = wrapRef.current.getBoundingClientRect();
    const z = Math.min(1.4, Math.max(0.3, Math.min(r.width / (maxX - minX), r.height / (maxY - minY))));
    setView({ z, x: (r.width - (maxX - minX) * z) / 2 - minX * z, y: (r.height - (maxY - minY) * z) / 2 - minY * z });
  }

  const selNode = nodes.find((n) => n.id === sel);
  const edges = nodes.filter((n) => n.parent && nodes.some((p) => p.id === n.parent))
    .map((n) => ({ key: "e" + n.id, a: center(nodes.find((p) => p.id === n.parent)), b: center(n), tree: true, color: n.color }));
  const freeEdges = links.map((l, i) => {
    const a = nodes.find((n) => n.id === l.from), b = nodes.find((n) => n.id === l.to);
    return a && b ? { key: "l" + i, a: center(a), b: center(b), tree: false } : null;
  }).filter(Boolean);

  const btn = (extra) => ({ height: 28, minWidth: 28, padding: "0 9px", borderRadius: "var(--r-2)", border: "1px solid var(--line-2)", background: "var(--bg-1)", color: "var(--fg-2)", fontSize: 12, cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center", ...extra });

  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
      {/* Toolbar flutuante */}
      <div style={{ position: "absolute", top: 14, left: 14, zIndex: 5, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", background: "var(--bg-1)", border: "1px solid var(--line-1)", borderRadius: "var(--r-3)", padding: "6px 8px", boxShadow: "var(--shadow-card)" }}>
        <button style={btn()} title="Novo nó (ou dê 2 cliques no fundo)" onClick={() => addNodeAt(wrapRef.current.getBoundingClientRect().left + 260, wrapRef.current.getBoundingClientRect().top + 160)}>+ nó</button>
        <button style={btn(sel ? {} : { opacity: 0.4, cursor: "default" })} title="Adicionar filho (Tab)" onClick={() => sel && addChild(sel)}>+ filho</button>
        <button style={btn(linkFrom ? { background: "var(--accent-soft)", borderColor: "var(--accent-line)", color: "var(--accent)" } : (sel ? {} : { opacity: 0.4, cursor: "default" }))}
          title="Conectar a outro nó (clique aqui e depois no destino)" onClick={() => { if (sel) setLinkFrom((f) => f ? null : sel); }}>{linkFrom ? "conectando…" : "↔ conectar"}</button>
        <span style={{ width: 1, height: 20, background: "var(--line-1)", margin: "0 2px" }} />
        <button style={btn()} title="Organizar em árvore" onClick={autoOrganize}>organizar</button>
        <button style={btn()} title="Enquadrar tudo" onClick={fitView}>enquadrar</button>
        {/* Zoom por botão: no touch não tem roda do mouse. */}
        <button style={btn()} title="Afastar" onClick={() => zoomBy(0.82)}>−</button>
        <button style={btn()} title="Aproximar" onClick={() => zoomBy(1.22)}>+</button>
        {selNode && (
          <>
            <span style={{ width: 1, height: 20, background: "var(--line-1)", margin: "0 2px" }} />
            {COLORS.map((c) => (
              <button key={c} onClick={() => setColor(sel, c)} title="cor do nó"
                style={{ width: 18, height: 18, borderRadius: 999, background: c, cursor: "pointer", border: selNode.color === c ? "2px solid var(--fg-1)" : "2px solid transparent" }} />
            ))}
            <button style={btn({ color: "var(--neg)" })} title="Apagar nó e filhos (Delete)" onClick={() => delSubtree(sel)}>✕</button>
          </>
        )}
        <span className="mono dim" style={{ fontSize: 10, marginLeft: 4 }}>{saved ? "salvo" : "salvando…"}</span>
      </div>

      {/* Canvas */}
      <div ref={wrapRef} onPointerDown={panBg} onDoubleClick={(e) => { if (e.target === wrapRef.current || e.target === e.currentTarget.firstChild) addNodeAt(e.clientX, e.clientY); }}
        style={{ position: "absolute", inset: 0, overflow: "hidden", cursor: linkFrom ? "crosshair" : "grab", background: "var(--bg-0)", backgroundImage: "radial-gradient(var(--line-1) 0.7px, transparent 0.7px)", backgroundSize: `${22 * view.z}px ${22 * view.z}px`, backgroundPosition: `${view.x}px ${view.y}px` }}>
        <div style={{ position: "absolute", left: 0, top: 0, transform: `translate(${view.x}px, ${view.y}px) scale(${view.z})`, transformOrigin: "0 0" }}>
          {/* Arestas (SVG grande, coordenadas do mundo) */}
          <svg style={{ position: "absolute", overflow: "visible", pointerEvents: "none", left: 0, top: 0 }} width="1" height="1">
            {[...edges, ...freeEdges].map((e) => {
              const mx = (e.a.x + e.b.x) / 2;
              return <path key={e.key} d={`M ${e.a.x} ${e.a.y} C ${mx} ${e.a.y}, ${mx} ${e.b.y}, ${e.b.x} ${e.b.y}`}
                fill="none" stroke={e.tree ? (e.color || "var(--line-strong)") : "var(--accent)"} strokeWidth={e.tree ? 2 : 1.5}
                strokeDasharray={e.tree ? "" : "5 4"} opacity={e.tree ? 0.5 : 0.7} />;
            })}
          </svg>

          {/* Nós */}
          {nodes.map((n) => {
            const c = n.color || COLORS[0];
            const isSel = n.id === sel, isFrom = n.id === linkFrom;
            return (
              <div key={n.id} ref={(el) => measure(n.id, el)} onPointerDown={(e) => dragNode(e, n.id)} onDoubleClick={(e) => { e.stopPropagation(); setEditing(n.id); setSel(n.id); }}
                style={{ position: "absolute", left: n.x, top: n.y, width: NODE_W, minHeight: 40, boxSizing: "border-box",
                  background: "var(--bg-1)", borderRadius: "var(--r-2)", borderLeft: `4px solid ${c}`,
                  border: `1px solid ${isSel || isFrom ? c : "var(--line-2)"}`, borderLeftWidth: 4, borderLeftColor: c,
                  boxShadow: isSel ? `0 0 0 2px ${c}55, var(--shadow-1)` : "var(--shadow-1)",
                  padding: "8px 10px", cursor: "grab", userSelect: "none", touchAction: "none" }}>
                {editing === n.id ? (
                  <textarea autoFocus defaultValue={n.text} rows={1}
                    onPointerDown={(e) => e.stopPropagation()}
                    onFocus={(e) => { e.target.style.height = "auto"; e.target.style.height = e.target.scrollHeight + "px"; e.target.select(); }}
                    onInput={(e) => { e.target.style.height = "auto"; e.target.style.height = e.target.scrollHeight + "px"; }}
                    onBlur={(e) => { setText(n.id, e.target.value.trim()); setEditing(null); }}
                    onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); e.currentTarget.blur(); } if (e.key === "Escape") e.currentTarget.blur(); }}
                    style={{ width: "100%", border: "none", outline: "none", resize: "none", background: "transparent", color: "var(--fg-1)", fontSize: 13, fontFamily: "inherit", lineHeight: 1.35, padding: 0 }} />
                ) : (
                  <div style={{ fontSize: 13, lineHeight: 1.35, color: n.text ? "var(--fg-1)" : "var(--fg-4)", whiteSpace: "pre-wrap", wordBreak: "break-word", fontWeight: !n.parent ? 600 : 500 }}>{n.text || "escreva…"}</div>
                )}
                {isSel && !editing && (
                  <button onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); addChild(n.id); }}
                    title="Adicionar filho" style={{ position: "absolute", right: -11, top: "calc(50% - 11px)", width: 22, height: 22, borderRadius: 999, background: c, color: "#fff", border: "2px solid var(--bg-0)", fontSize: 14, lineHeight: 1, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>+</button>
                )}
              </div>
            );
          })}
        </div>

        {nodes.length === 0 && (
          <div className="mono dim" style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12.5, pointerEvents: "none", textAlign: "center", lineHeight: 1.7 }}>
            dê 2 cliques em qualquer lugar pra criar o 1º nó<br />arraste pra mover · roda do mouse pra zoom · Tab cria filho
          </div>
        )}
        <div style={{ position: "absolute", left: 14, bottom: 14, fontSize: 12, color: "var(--fg-4)", pointerEvents: "none" }}>2 cliques cria nó · Tab cria filho · roda do mouse dá zoom</div>
      </div>
    </div>
  );
}
