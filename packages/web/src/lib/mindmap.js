// Mapa mental: a parte PURA (sem React). Árvore, layouts automáticos, arestas,
// migração do formato antigo e utilitários de edição usados pela tela
// screens/mindmaps.jsx. Regra central (estudo de 08/09/2026): a posição do nó
// é DERIVADA da estrutura (parent + order); x/y só valem quando o nó está
// desanexado (auto=false) ou o mapa inteiro é livre (layout "free").

export const LAYOUTS = [
  { value: "tree", label: "Árvore" },
  { value: "radial", label: "Radial" },
  { value: "org", label: "Organograma" },
  { value: "list", label: "Lista" },
  { value: "free", label: "Livre" },
];

// Paleta dos nós: a 1ª é o neutro (raiz/sem cor). Ramos de 1º nível sem cor
// explícita recebem uma cor da paleta em rodízio (como o tema do MindMeister).
export const COLORS = ["#64748b", "#0ea5e9", "#22c55e", "#f59e0b", "#ef4444", "#a855f7", "#ec4899", "#14b8a6", "#f97316"];
export const SHAPES = ["rounded", "rect", "pill", "line"];

export const NODE_MAX_W = 260;
const H_GAP = 44;   // distância pai → filho (árvore/radial)
const V_GAP = 12;   // entre irmãos empilhados
const ROOT_GAP = 56; // entre raízes soltas empilhadas
const LIST_IND = 26; // recuo por nível (lista/organograma)
const LIST_GAP = 8;
const ORG_GAP = 28;  // entre colunas do organograma
const ORG_DROP = 40; // raiz → 1º nível no organograma

export const nid = () => "n" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

// ── Normalização / migração ──────────────────────────────────────────────────
// Mapa antigo: nós com x/y e parent, sem order nem layout. Vira layout "free"
// (nada sai do lugar) e ganha order pela posição vertical; o botão "organizar"
// da tela troca pra árvore quando o usuário quiser.
export function normalizeMap(map) {
  const raw = Array.isArray(map?.nodes) ? map.nodes : [];
  const ids = new Set(raw.map((n) => n && n.id).filter(Boolean));
  const nodes = raw.filter((n) => n && n.id).map((n) => ({
    ...n,
    parent: n.parent && ids.has(n.parent) && n.parent !== n.id ? n.parent : null,
    text: typeof n.text === "string" ? n.text : "",
    x: Number.isFinite(n.x) ? n.x : 0,
    y: Number.isFinite(n.y) ? n.y : 0,
  }));
  const legacy = !map?.layout && nodes.length > 0;
  // order: mantém o que existe; quem não tem entra pela posição y (legado) ou
  // pela ordem do array.
  const groups = {};
  nodes.forEach((n, i) => { (groups[n.parent || ""] ||= []).push({ n, i }); });
  for (const g of Object.values(groups)) {
    g.sort((a, b) => {
      const ao = Number.isFinite(a.n.order) ? a.n.order : null, bo = Number.isFinite(b.n.order) ? b.n.order : null;
      if (ao != null && bo != null) return ao - bo;
      if (ao != null) return -1;
      if (bo != null) return 1;
      return legacy ? (a.n.y - b.n.y) || (a.i - b.i) : a.i - b.i;
    });
    g.forEach((e, k) => { e.n.order = k; });
  }
  const links = (Array.isArray(map?.links) ? map.links : [])
    .filter((l) => l && ids.has(l.from) && ids.has(l.to) && l.from !== l.to)
    .map((l, i) => ({ id: l.id || "l" + i + Math.random().toString(36).slice(2, 5), from: l.from, to: l.to, label: l.label || "", color: l.color || "", arrow: l.arrow || "none" }));
  return {
    layout: LAYOUTS.some((o) => o.value === map?.layout) ? map.layout : (legacy ? "free" : "tree"),
    nodes,
    links,
  };
}

// ── Árvore ───────────────────────────────────────────────────────────────────
export function childrenIndex(nodes) {
  const kids = {};
  for (const n of nodes) (kids[n.parent || ""] ||= []).push(n);
  for (const k of Object.keys(kids)) kids[k].sort((a, b) => (a.order || 0) - (b.order || 0));
  return kids;
}
export function byId(nodes) { return Object.fromEntries(nodes.map((n) => [n.id, n])); }

export function descendants(nodes, id, kids = childrenIndex(nodes)) {
  const out = []; const stack = [...(kids[id] || [])];
  while (stack.length) { const n = stack.pop(); out.push(n.id); stack.push(...(kids[n.id] || [])); }
  return out;
}
export function isAncestor(nodes, maybeAncestor, id) {
  const map = byId(nodes); let cur = map[id];
  while (cur && cur.parent) { if (cur.parent === maybeAncestor) return true; cur = map[cur.parent]; }
  return false;
}
export function depthOf(map, id) { let d = 0, cur = map[id]; while (cur && cur.parent && map[cur.parent]) { d++; cur = map[cur.parent]; } return d; }

// Nós que aparecem na tela: descendentes de nó recolhido ficam de fora.
export function visibleSet(nodes) {
  const kids = childrenIndex(nodes); const vis = new Set();
  const walk = (list) => { for (const n of list) { vis.add(n.id); if (!n.collapsed) walk(kids[n.id] || []); } };
  walk(nodes.filter((n) => !n.parent));
  return vis;
}

// Cor efetiva: a explícita, senão a do ramo de 1º nível (rodízio da paleta),
// senão o neutro. A raiz é sempre neutra.
export function colorIndexer(nodes) {
  const map = byId(nodes); const kids = childrenIndex(nodes); const cache = {};
  return (id) => {
    if (cache[id]) return cache[id];
    const n = map[id]; if (!n) return COLORS[0];
    let c = null;
    if (n.color && n.color !== COLORS[0]) c = n.color;
    else if (!n.parent) c = n.color || COLORS[0];
    else {
      // sobe até o nó de 1º nível
      let cur = n; const chain = [n];
      while (cur.parent && map[cur.parent] && map[cur.parent].parent) { cur = map[cur.parent]; chain.push(cur); }
      const explicit = chain.find((x) => x.color && x.color !== COLORS[0]);
      if (explicit) c = explicit.color;
      else {
        const sibs = kids[cur.parent] || []; const i = Math.max(0, sibs.findIndex((s) => s.id === cur.id));
        c = COLORS[1 + (i % (COLORS.length - 1))];
      }
    }
    cache[id] = c; return c;
  };
}

// ── Edição (funções puras que devolvem nodes novos) ──────────────────────────
export function reindex(nodes, parent) {
  const sibs = nodes.filter((n) => (n.parent || null) === (parent || null)).sort((a, b) => (a.order || 0) - (b.order || 0));
  const ord = Object.fromEntries(sibs.map((n, i) => [n.id, i]));
  return nodes.map((n) => (n.id in ord ? { ...n, order: ord[n.id] } : n));
}
export function addChild(nodes, parentId, text = "", opts = {}) {
  const sibs = nodes.filter((n) => n.parent === parentId);
  const n = { id: nid(), parent: parentId, order: sibs.length, text, color: "", x: 0, y: 0, ...opts };
  return { nodes: [...nodes, n], id: n.id };
}
export function addSibling(nodes, refId, text = "", { above = false } = {}) {
  const ref = nodes.find((n) => n.id === refId);
  if (!ref) return addRoot(nodes, text);
  const parent = ref.parent || null;
  const at = (ref.order || 0) + (above ? 0 : 1);
  const shifted = nodes.map((n) => ((n.parent || null) === parent && (n.order || 0) >= at ? { ...n, order: n.order + 1 } : n));
  const n = { id: nid(), parent, order: at, text, color: "", x: ref.x, y: ref.y + 60, auto: parent ? undefined : ref.auto };
  return { nodes: reindex([...shifted, n], parent), id: n.id };
}
export function addRoot(nodes, text = "", pos = null) {
  const roots = nodes.filter((n) => !n.parent);
  const n = { id: nid(), parent: null, order: roots.length, text, color: "", x: pos ? pos.x : 0, y: pos ? pos.y : 0, auto: pos ? false : undefined };
  return { nodes: [...nodes, n], id: n.id };
}
export function removeSubtrees(nodes, links, ids) {
  const kill = new Set();
  const kids = childrenIndex(nodes);
  for (const id of ids) { kill.add(id); for (const d of descendants(nodes, id, kids)) kill.add(d); }
  const parents = new Set(nodes.filter((n) => kill.has(n.id)).map((n) => n.parent || null));
  let next = nodes.filter((n) => !kill.has(n.id));
  for (const p of parents) next = reindex(next, p);
  return { nodes: next, links: links.filter((l) => !kill.has(l.from) && !kill.has(l.to)), removed: kill };
}
// Move `id` pra dentro de `parent` na posição `index` (fim quando null).
export function moveNode(nodes, id, parent, index = null) {
  if (id === parent || (parent && isAncestor(nodes, id, parent))) return nodes;
  const cur = nodes.find((n) => n.id === id); if (!cur) return nodes;
  const oldParent = cur.parent || null;
  let next = nodes.map((n) => (n.id === id ? { ...n, parent: parent || null, auto: undefined } : n));
  next = reindex(next, oldParent);
  const sibs = next.filter((n) => (n.parent || null) === (parent || null) && n.id !== id).sort((a, b) => a.order - b.order);
  const at = index == null ? sibs.length : Math.max(0, Math.min(sibs.length, index));
  const order = Object.fromEntries(sibs.map((n, i) => [n.id, i < at ? i : i + 1]));
  order[id] = at;
  return next.map((n) => (n.id in order ? { ...n, order: order[n.id] } : n));
}
export function shiftSibling(nodes, id, delta) {
  const cur = nodes.find((n) => n.id === id); if (!cur) return nodes;
  const sibs = nodes.filter((n) => (n.parent || null) === (cur.parent || null)).sort((a, b) => a.order - b.order);
  const i = sibs.findIndex((n) => n.id === id); const j = i + delta;
  if (j < 0 || j >= sibs.length) return nodes;
  const a = sibs[i].id, b = sibs[j].id;
  return nodes.map((n) => (n.id === a ? { ...n, order: j } : n.id === b ? { ...n, order: i } : n));
}
// Copia subárvores (de `src`, que pode ser um clipboard) com ids novos,
// pendurando em `parent` (null = raízes) a partir da ordem `orderBase`.
export function cloneSubtrees(src, ids, parent, orderBase = 0, offset = { x: 40, y: 40 }) {
  const kids = childrenIndex(src); const map = byId(src);
  const roots = ids.filter((id) => map[id] && !ids.some((o) => o !== id && isAncestor(src, o, id)));
  const added = [];
  const copy = (id, newParent, ord) => {
    const s = map[id];
    const n = { ...s, id: nid(), parent: newParent, order: ord, x: s.x + offset.x, y: s.y + offset.y, auto: newParent ? undefined : s.auto };
    added.push(n);
    (kids[id] || []).forEach((k, i) => copy(k.id, n.id, i));
    return n.id;
  };
  const newIds = roots.map((r, i) => copy(r, parent || null, orderBase + i));
  return { added, ids: newIds };
}
// Recolhe tudo abaixo do nível N (0 = raiz). null = expande tudo.
export function applyLevels(nodes, level) {
  const map = byId(nodes); const kids = childrenIndex(nodes);
  return nodes.map((n) => {
    const has = (kids[n.id] || []).length > 0;
    if (!has) return n.collapsed ? { ...n, collapsed: false } : n;
    const d = depthOf(map, n.id);
    const c = level == null ? false : d >= level - 1;
    return n.collapsed === c ? n : { ...n, collapsed: c };
  });
}

// ── Texto (esboço / copiar / colar) ──────────────────────────────────────────
export function outlineText(nodes, rootIds = null) {
  const kids = childrenIndex(nodes);
  const lines = [];
  const walk = (n, d) => {
    lines.push(`${"  ".repeat(d)}- ${(n.text || "").replace(/\n/g, " ")}${n.note ? `  (${n.note.replace(/\n/g, " ")})` : ""}`);
    for (const k of kids[n.id] || []) walk(k, d + 1);
  };
  const roots = rootIds ? rootIds.map((id) => nodes.find((n) => n.id === id)).filter(Boolean) : nodes.filter((n) => !n.parent).sort((a, b) => a.order - b.order);
  for (const r of roots) walk(r, 0);
  return lines.join("\n");
}
// Texto com recuo (2 espaços ou tab, "- " opcional) → subárvore.
export function parseOutline(text) {
  const rows = String(text || "").split(/\r?\n/).filter((l) => l.trim());
  const out = []; const stack = []; // [{depth, id}]
  const orders = {};
  for (const raw of rows) {
    const m = raw.match(/^(\s*)(?:[-*•]\s+)?(.*)$/);
    const depth = Math.floor(m[1].replace(/\t/g, "  ").length / 2);
    while (stack.length && stack[stack.length - 1].depth >= depth) stack.pop();
    const parent = stack.length ? stack[stack.length - 1].id : null;
    const id = nid(); const key = parent || "";
    orders[key] = (orders[key] || 0);
    out.push({ id, parent, order: orders[key]++, text: m[2].trim(), color: "", x: 0, y: 0 });
    stack.push({ depth, id });
  }
  return out;
}

// ── Layout ───────────────────────────────────────────────────────────────────
// size(id) → {w,h} medido na tela (estimativa antes da 1ª medição).
export function estimateSize(node) {
  const t = node.text || "";
  const longest = Math.max(...t.split("\n").map((l) => l.length), 4);
  const w = Math.max(48, Math.min(NODE_MAX_W, 22 + longest * 7.2 + (node.emoji ? 22 : 0)));
  const lines = t.split("\n").reduce((a, l) => a + Math.max(1, Math.ceil((l.length * 7.2) / (NODE_MAX_W - 24))), 0);
  let h = 14 + Math.max(1, lines) * 18;
  if (node.image) h += 96;
  return { w, h };
}

// Devolve { pos: {id:{x,y}}, bounds } pros nós VISÍVEIS. Raízes soltas
// (sem pai ou auto=false) empilham; nó com auto=false fica onde está e a
// subárvore dele é montada a partir dali.
export function layoutMap(nodes, layout, size) {
  const vis = visibleSet(nodes);
  const map = byId(nodes);
  const all = childrenIndex(nodes);
  // filhos visíveis e "presos" (auto !== false) de cada nó
  const kids = {};
  for (const n of nodes) {
    if (!vis.has(n.id)) continue;
    kids[n.id] = n.collapsed ? [] : (all[n.id] || []).filter((k) => vis.has(k.id) && k.auto !== false && layout !== "free");
  }
  const pos = {};
  if (layout === "free") {
    for (const n of nodes) if (vis.has(n.id)) pos[n.id] = { x: n.x, y: n.y };
    return { pos, bounds: boundsOf(pos, size) };
  }
  const roots = nodes.filter((n) => vis.has(n.id) && (!n.parent || !map[n.parent] || n.auto === false));
  const S = (id) => size(id);

  // subárvore em ÁRVORE (dir = 1 direita, -1 esquerda). Devolve altura total.
  const treeH = (id, memo) => {
    if (memo[id] != null) return memo[id];
    const ks = kids[id] || []; const own = S(id).h;
    const span = ks.reduce((a, k) => a + treeH(k.id, memo), 0) + Math.max(0, ks.length - 1) * V_GAP;
    return (memo[id] = Math.max(own, span));
  };
  const placeTree = (id, dir, edgeX, top, memo, out) => {
    const { w, h } = S(id); const H = treeH(id, memo);
    const x = dir > 0 ? edgeX : edgeX - w;
    out[id] = { x, y: top + (H - h) / 2 };
    const ks = kids[id] || [];
    const span = ks.reduce((a, k) => a + treeH(k.id, memo), 0) + Math.max(0, ks.length - 1) * V_GAP;
    let c = top + (H - span) / 2;
    const childEdge = dir > 0 ? x + w + H_GAP : x - H_GAP;
    for (const k of ks) { placeTree(k.id, dir, childEdge, c, memo, out); c += treeH(k.id, memo) + V_GAP; }
  };
  // subárvore em LISTA (vertical, recuo por nível). Devolve y final.
  const placeList = (id, x, top, out) => {
    out[id] = { x, y: top };
    let c = top + S(id).h + LIST_GAP;
    for (const k of kids[id] || []) c = placeList(k.id, x + LIST_IND, c, out);
    return c;
  };
  const listW = (id, d = 0) => Math.max(d * LIST_IND + S(id).w, ...(kids[id] || []).map((k) => listW(k.id, d + 1)));

  const placeRoot = (root) => {
    const out = {}; const memo = {};
    if (layout === "tree") placeTree(root.id, 1, 0, 0, memo, out);
    else if (layout === "radial") {
      const { w, h } = S(root.id);
      const ks = kids[root.id] || [];
      const right = ks.filter((_, i) => i % 2 === 0), left = ks.filter((_, i) => i % 2 === 1);
      const side = (list, dir) => {
        const span = list.reduce((a, k) => a + treeH(k.id, memo), 0) + Math.max(0, list.length - 1) * V_GAP;
        let c = h / 2 - span / 2;
        const edge = dir > 0 ? w + H_GAP : -H_GAP;
        for (const k of list) { placeTree(k.id, dir, edge, c, memo, out); c += treeH(k.id, memo) + V_GAP; }
      };
      out[root.id] = { x: 0, y: 0 };
      side(right, 1); side(left, -1);
    } else if (layout === "org") {
      const { w, h } = S(root.id);
      const ks = kids[root.id] || [];
      const widths = ks.map((k) => listW(k.id));
      const rowW = widths.reduce((a, b) => a + b, 0) + Math.max(0, ks.length - 1) * ORG_GAP;
      const rootX = Math.max(0, (rowW - w) / 2);
      out[root.id] = { x: rootX, y: 0 };
      let cx = rowW < w ? (w - rowW) / 2 : 0;
      ks.forEach((k, i) => { placeList(k.id, cx, h + ORG_DROP, out); cx += widths[i] + ORG_GAP; });
    } else placeList(root.id, 0, 0, out);
    return out;
  };

  let stackY = 0;
  for (const root of roots) {
    const local = placeRoot(root);
    const b = boundsOf(local, size);
    let dx, dy;
    if (root.auto === false || root.parent) { dx = root.x - local[root.id].x; dy = root.y - local[root.id].y; }
    else { dx = -b.minX; dy = stackY - b.minY; stackY += (b.maxY - b.minY) + ROOT_GAP; }
    for (const [id, p] of Object.entries(local)) pos[id] = { x: Math.round(p.x + dx), y: Math.round(p.y + dy) };
  }
  return { pos, bounds: boundsOf(pos, size) };
}

export function boundsOf(pos, size) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [id, p] of Object.entries(pos)) {
    const s = size(id);
    minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x + s.w); maxY = Math.max(maxY, p.y + s.h);
  }
  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return { minX, minY, maxX, maxY };
}

// ── Arestas ──────────────────────────────────────────────────────────────────
// Caminho SVG entre dois retângulos {x,y,w,h}. `mode`: "h" (pai→filho na
// horizontal, tangente reta), "v" (pai em cima), "elbow" (lista: desce pela
// margem do pai e entra no filho) ou "auto" (conexão livre: decide pelo eixo).
export function edgePath(a, b, mode = "auto") {
  if (mode === "elbow") {
    const x0 = a.x + Math.min(14, a.w / 2), y0 = a.y + a.h;
    const y1 = b.y + b.h / 2, x1 = b.x;
    const r = 8;
    return `M ${x0} ${y0} L ${x0} ${y1 - r} Q ${x0} ${y1} ${x0 + r} ${y1} L ${x1} ${y1}`;
  }
  if (mode === "v") {
    const x0 = a.x + a.w / 2, y0 = a.y + a.h, x1 = b.x + b.w / 2, y1 = b.y;
    const my = (y0 + y1) / 2;
    return `M ${x0} ${y0} C ${x0} ${my}, ${x1} ${my}, ${x1} ${y1}`;
  }
  const ac = { x: a.x + a.w / 2, y: a.y + a.h / 2 }, bc = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  const horizontal = mode === "h" || Math.abs(bc.x - ac.x) >= Math.abs(bc.y - ac.y);
  if (horizontal) {
    const right = bc.x >= ac.x;
    const x0 = right ? a.x + a.w : a.x, y0 = ac.y;
    const x1 = right ? b.x : b.x + b.w, y1 = bc.y;
    const mx = (x0 + x1) / 2;
    return `M ${x0} ${y0} C ${mx} ${y0}, ${mx} ${y1}, ${x1} ${y1}`;
  }
  const down = bc.y >= ac.y;
  const x0 = ac.x, y0 = down ? a.y + a.h : a.y, x1 = bc.x, y1 = down ? b.y : b.y + b.h;
  const my = (y0 + y1) / 2;
  return `M ${x0} ${y0} C ${x0} ${my}, ${x1} ${my}, ${x1} ${y1}`;
}
export function edgeModeFor(layout, parent, child, depth) {
  if (layout === "tree" || layout === "radial") return "h";
  if (layout === "list") return "elbow";
  if (layout === "org") return depth <= 1 ? "v" : "elbow";
  return "auto";
}
// Ponto do meio de uma cúbica (pro rótulo da conexão).
export function pathMidpoint(d) {
  const m = d.match(/M ([\d.-]+) ([\d.-]+) C ([\d.-]+) ([\d.-]+), ([\d.-]+) ([\d.-]+), ([\d.-]+) ([\d.-]+)/);
  if (!m) return null;
  const [x0, y0, x1, y1, x2, y2, x3, y3] = m.slice(1).map(Number);
  const t = 0.5, mt = 1 - t;
  return { x: mt ** 3 * x0 + 3 * mt * mt * t * x1 + 3 * mt * t * t * x2 + t ** 3 * x3, y: mt ** 3 * y0 + 3 * mt * mt * t * y1 + 3 * mt * t * t * y2 + t ** 3 * y3 };
}

// ── Navegação por setas ──────────────────────────────────────────────────────
// Nó mais próximo na direção pedida (cone de 90°), medido do centro.
export function nearestInDirection(rects, fromId, dir) {
  const a = rects[fromId]; if (!a) return null;
  const ac = { x: a.x + a.w / 2, y: a.y + a.h / 2 };
  let best = null, bestD = Infinity;
  for (const [id, r] of Object.entries(rects)) {
    if (id === fromId) continue;
    const c = { x: r.x + r.w / 2, y: r.y + r.h / 2 };
    const dx = c.x - ac.x, dy = c.y - ac.y;
    let ok;
    if (dir === "right") ok = dx > 0 && Math.abs(dy) <= dx * 1.2;
    else if (dir === "left") ok = dx < 0 && Math.abs(dy) <= -dx * 1.2;
    else if (dir === "down") ok = dy > 0 && Math.abs(dx) <= dy * 1.2;
    else ok = dy < 0 && Math.abs(dx) <= -dy * 1.2;
    if (!ok) continue;
    const d = dx * dx + dy * dy;
    if (d < bestD) { bestD = d; best = id; }
  }
  return best;
}
