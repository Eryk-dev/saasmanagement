import React from "react";
import { PageHead } from "../components/viz.jsx";

// Estáticos — editor de criativos da marca pro Instagram, direto no cockpit.
// 18 templates fixos (6 stories 1080×1920 · 6 posts de feed 1080×1350 · 6
// carrosséis de 4 slides 1080×1350) com a identidade LeverAds das superfícies
// públicas (proposta/form): navy #051C2C em gradiente, teal #23D8D3, Space
// Grotesk + JetBrains Mono.
//
// Cada template é uma LISTA DE ELEMENTOS (logo, texto, foto, pílula, painel…)
// com posição default; o preview é interativo: arraste qualquer elemento pra
// reposicionar (o offset fica em `pos`, por elemento), clique num slot de foto
// pra escolher a imagem (upload local, vira Image em memória) e adicione
// elementos avulsos (texto/botão/foto) pra posicionar livre. `*palavra*` vira
// destaque em teal. Download em PNG na resolução nativa via canvas 2D puro —
// fontes do Google Fonts aguardadas antes do desenho e logo como data-URI,
// nada de asset remoto que suje o canvas.
//
// Posições encadeadas: `y: { after: "title", gap: 48 }` ancora o topo do
// elemento no fim do anterior JÁ COM o arrasto aplicado — mover o título leva
// o corpo junto, como num layout de verdade.

const { useState: useS, useEffect: useE, useRef: useR } = React;

// ── Marca ────────────────────────────────────────────────────────────────────
const B = {
  navy: "#051C2C",
  grad: ["#073143", "#051C2C", "#03141D"], // mesmo gradiente da proposta
  ice: "#F3FBFF",
  teal: "#23D8D3",        // teal do logo — brilha no navy
  tealDeep: "#0C8F83",    // teal legível sobre fundo claro
};
const FD = "'Space Grotesk'";
const FM = "'JetBrains Mono'";
const FONTS_HREF = "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap";

// Paleta resolvida por modo do fundo (escuro = navy, claro = gelo).
function pal(mode) {
  return mode === "dark"
    ? { fg: B.ice, soft: "rgba(243,251,255,0.72)", dim: "rgba(243,251,255,0.45)", accent: B.teal,
        panel: "rgba(243,251,255,0.06)", panelAccent: "rgba(35,216,211,0.10)", line: "rgba(243,251,255,0.25)" }
    : { fg: B.navy, soft: "rgba(5,28,44,0.72)", dim: "rgba(5,28,44,0.45)", accent: B.tealDeep,
        panel: "rgba(5,28,44,0.05)", panelAccent: "rgba(12,143,131,0.10)", line: "rgba(5,28,44,0.25)" };
}

// Ícone oficial (mesmos paths do logo da sidebar). `main` = cor do círculo:
// ice no fundo escuro, navy no claro; o raio teal é fixo.
const iconSvg = (main) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="291" height="299" viewBox="0 0 1453.13 1493.95">` +
  `<path fill="${main}" d="M519.22,843.75l-45.1,15.11c53.94,77.43,143.68,128.2,245.06,128.2,4.38,0,8.76-.08,13.07-.3l-14.13-45.02c-80.76-.3-152.75-38.68-198.9-97.98ZM719.19,390.03c-164.61,0-298.55,133.94-298.55,298.55,0,29.46,4.31,58.02,12.31,84.91l39.13-29.31c-4-17.9-6.12-36.49-6.12-55.6,0-139.6,113.62-253.22,253.22-253.22s253.15,113.62,253.15,253.22c0,99.49-57.71,185.84-141.42,227.16v49.63c109.39-44.27,186.74-151.69,186.74-276.79,0-164.61-133.86-298.55-298.47-298.55Z"/>` +
  `<polygon fill="#23D8D3" points="800.7 535.53 800.7 1103.92 763 983.8 749.25 939.91 691.16 754.61 501.54 817.84 457.65 832.42 362.47 864.14 443.6 803.33 481.22 775.08 800.7 535.53"/></svg>`;

const ASSETS = { iconIce: null, iconNavy: null };

function loadImg(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

// Fontes (Google Fonts) + logos prontos pra desenhar. Idempotente.
let assetsPromise = null;
function loadAssets() {
  if (assetsPromise) return assetsPromise;
  assetsPromise = (async () => {
    if (!document.getElementById("creative-fonts")) {
      const link = document.createElement("link");
      link.id = "creative-fonts";
      link.rel = "stylesheet";
      link.href = FONTS_HREF;
      document.head.appendChild(link);
    }
    const uri = (svg) => "data:image/svg+xml;utf8," + encodeURIComponent(svg);
    [ASSETS.iconIce, ASSETS.iconNavy] = await Promise.all([
      loadImg(uri(iconSvg(B.ice))), loadImg(uri(iconSvg(B.navy))),
    ]);
    const want = [
      `700 100px ${FD}`, `600 60px ${FD}`, `500 44px ${FD}`, `400 40px ${FD}`,
      `600 32px ${FM}`, `500 30px ${FM}`, `400 28px ${FM}`,
    ];
    await Promise.all(want.map((f) => document.fonts.load(f, "LeverAds ✓ →").catch(() => {})));
    await document.fonts.ready;
  })();
  return assetsPromise;
}

// ── Primitivas ───────────────────────────────────────────────────────────────
function bg(ctx, W, H, mode) {
  if (mode === "dark") {
    const g = ctx.createLinearGradient(0, 0, W * 0.55, H);
    g.addColorStop(0, B.grad[0]); g.addColorStop(0.52, B.grad[1]); g.addColorStop(1, B.grad[2]);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  } else {
    ctx.fillStyle = B.ice;
    ctx.fillRect(0, 0, W, H);
  }
  const glow = ctx.createRadialGradient(W * 0.88, H * 0.08, 0, W * 0.88, H * 0.08, W * 0.75);
  glow.addColorStop(0, mode === "dark" ? "rgba(35,216,211,0.14)" : "rgba(35,216,211,0.16)");
  glow.addColorStop(1, "rgba(35,216,211,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);
}

function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Divide o texto em palavras marcando o trecho entre *asteriscos* como destaque.
function richTokens(text) {
  const out = [];
  let hl = false;
  for (const part of String(text || "").split("*")) {
    for (const w of part.split(/[ \t]+/)) if (w) out.push({ w, hl });
    hl = !hl;
  }
  return out;
}

// Texto com wrap, destaque, \n manual, riscado e modo dry (só mede).
// y é o TOPO do bloco. Retorna { w, h } do que foi (seria) desenhado.
function drawRichText(ctx, o) {
  const size = o.size, lh = o.lineH || Math.round(size * 1.16);
  ctx.font = `${o.weight || 700} ${size}px ${o.font || FD}`;
  const space = ctx.measureText(" ").width;
  const lines = [];
  for (const para of String(o.text || "").split("\n")) {
    let line = [], w = 0;
    for (const t of richTokens(para)) {
      const tw = ctx.measureText(t.w).width;
      if (line.length && w + space + tw > o.maxW) { lines.push({ line, w }); line = [t]; w = tw; }
      else { w += (line.length ? space : 0) + tw; line.push(t); }
    }
    lines.push({ line, w });
  }
  const maxLineW = Math.max(...lines.map((L) => L.w), 0);
  const h = size + (lines.length - 1) * lh + Math.round(size * 0.28);
  if (!o.dry) {
    let base = o.y + size;
    for (const L of lines) {
      let xx = o.align === "center" ? o.x + (o.maxW - L.w) / 2 : o.x;
      const x0 = xx;
      for (const t of L.line) {
        ctx.fillStyle = t.hl ? o.hl : o.color;
        ctx.fillText(t.w, xx, base);
        xx += ctx.measureText(t.w).width + space;
      }
      if (o.strike && L.w > 0) {
        ctx.fillStyle = o.color;
        ctx.fillRect(x0, base - Math.round(size * 0.32), L.w, Math.max(4, Math.round(size * 0.09)));
      }
      base += lh;
    }
  }
  return { w: maxLineW, h };
}

// Pílula de CTA (teal, texto navy). Retorna { w, h }.
function drawPillShape(ctx, text, x, y, size = 40) {
  ctx.font = `600 ${size}px ${FD}`;
  const tw = ctx.measureText(text || "").width;
  const h = Math.round(size * 2.1), w = tw + size * 2.2;
  ctx.fillStyle = B.teal;
  rr(ctx, x, y, w, h, h / 2);
  ctx.fill();
  ctx.fillStyle = B.navy;
  ctx.fillText(text || "", x + size * 1.1, y + h / 2 + size * 0.36);
  return { w, h };
}

// Foto cover-fit num retângulo arredondado; sem imagem vira o slot pontilhado.
function drawPhotoBox(ctx, box, x, y, env) {
  const { w, h, r = 24 } = box;
  const img = env.imgs[box.id];
  const p = pal(env.mode);
  if (img) {
    ctx.save();
    rr(ctx, x, y, w, h, r);
    ctx.clip();
    const s = Math.max(w / img.width, h / img.height);
    const dw = img.width * s, dh = img.height * s;
    ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
    ctx.restore();
    ctx.strokeStyle = "rgba(35,216,211,0.35)";
    ctx.lineWidth = 3;
    rr(ctx, x, y, w, h, r);
    ctx.stroke();
  } else {
    ctx.fillStyle = p.panel;
    rr(ctx, x, y, w, h, r);
    ctx.fill();
    ctx.save();
    ctx.setLineDash([16, 12]);
    ctx.strokeStyle = p.line;
    ctx.lineWidth = 3;
    rr(ctx, x, y, w, h, r);
    ctx.stroke();
    ctx.restore();
    ctx.font = `500 30px ${FM}`;
    ctx.fillStyle = p.dim;
    const label = "clique pra escolher a foto";
    ctx.fillText(label, x + (w - ctx.measureText(label).width) / 2, y + h / 2 + 10);
  }
  return { x, y, w, h };
}

function pageDots(ctx, W, y, i, n) {
  const gap = 26, r = 7;
  let x = W / 2 - ((n - 1) * gap) / 2;
  for (let k = 0; k < n; k++) {
    ctx.fillStyle = k === i ? B.teal : "rgba(243,251,255,0.25)";
    ctx.beginPath(); ctx.arc(x, y, k === i ? r + 1 : r, 0, Math.PI * 2); ctx.fill();
    x += gap;
  }
}

function arrowHint(ctx, W, H, M) {
  ctx.font = `600 32px ${FM}`;
  ctx.fillStyle = B.teal;
  const t = "arrasta →";
  ctx.fillText(t, W - M - ctx.measureText(t).width, H - 78);
}

// ── Elementos ────────────────────────────────────────────────────────────────
// Cada drawer: (ctx, el, x, y, env) → bbox {x,y,w,h}. env = {vals, imgs, mode}.
// `el.color`/`el.hl` são chaves da paleta (fg/soft/dim/accent).

const elText = (el, env) => (el.field != null ? env.vals[el.field] : el.text) ?? "";

const EL = {
  logo(ctx, el, x, y, env) {
    const h = el.h;
    const icon = env.mode === "dark" ? ASSETS.iconIce : ASSETS.iconNavy;
    if (icon) ctx.drawImage(icon, x - h * 0.16, y, h * 0.973, h);
    let w = h * 0.78;
    if (el.wordmark !== false) {
      ctx.font = `700 ${Math.round(h * 0.42)}px ${FD}`;
      ctx.fillStyle = pal(env.mode).fg;
      ctx.textBaseline = "middle";
      ctx.fillText("LeverAds", x + h * 0.78, y + h * 0.52);
      ctx.textBaseline = "alphabetic";
      w = h * 0.78 + ctx.measureText("LeverAds").width;
    }
    return { x, y, w, h };
  },

  eyebrow(ctx, el, x, y, env) {
    const size = el.size || 30;
    const p = pal(env.mode);
    const text = String(elText(el, env)).toUpperCase();
    ctx.fillStyle = p.accent;
    ctx.beginPath(); ctx.arc(x + size * 0.22, y + size * 0.62, size * 0.16, 0, Math.PI * 2); ctx.fill();
    ctx.font = `600 ${size}px ${FM}`;
    ctx.letterSpacing = `${Math.round(size * 0.18)}px`;
    ctx.fillText(text, x + size * 0.75, y + size);
    const w = size * 0.75 + ctx.measureText(text).width;
    ctx.letterSpacing = "0px";
    return { x, y, w, h: Math.round(size * 1.3) };
  },

  rich(ctx, el, x, y, env) {
    const p = pal(env.mode);
    const m = drawRichText(ctx, {
      text: elText(el, env), x, y, maxW: el.maxW || 880,
      size: el.size, weight: el.weight || 700, lineH: el.lineH,
      color: p[el.color || "fg"], hl: p[el.hl || "accent"],
      font: el.font === "mono" ? FM : FD, align: el.align, strike: el.strike,
    });
    const w = el.align === "center" ? (el.maxW || 880) : m.w;
    return { x, y, w, h: m.h };
  },

  pill(ctx, el, x, y, env) {
    const m = drawPillShape(ctx, elText(el, env), x, y, el.size || 40);
    return { x, y, w: m.w, h: m.h };
  },

  handle(ctx, el, x, y, env) {
    const size = el.size || 30;
    ctx.font = `500 ${size}px ${FM}`;
    ctx.fillStyle = pal(env.mode).dim;
    const text = elText(el, env);
    const w = ctx.measureText(text).width;
    const x0 = el.align === "center" ? x - w / 2 : el.align === "right" ? x - w : x;
    ctx.fillText(text, x0, y + size);
    return { x: x0, y, w, h: Math.round(size * 1.3) };
  },

  photo(ctx, el, x, y, env) {
    return drawPhotoBox(ctx, el, x, y, env);
  },

  // Item de lista: quadrado teal com ✓ + texto.
  check(ctx, el, x, y, env) {
    const text = elText(el, env);
    if (!String(text).trim()) return { x, y, w: 0, h: 0 };
    const p = pal(env.mode);
    ctx.fillStyle = B.teal;
    rr(ctx, x, y, 58, 58, 14); ctx.fill();
    ctx.fillStyle = B.navy;
    ctx.font = `700 38px ${FD}`;
    ctx.fillText("✓", x + 15, y + 42);
    const m = drawRichText(ctx, { text, x: x + 88, y: y - 2, maxW: (el.maxW || 860) - 88, size: 44, weight: 600, lineH: 56, color: p.fg, hl: p.accent });
    return { x, y, w: 88 + m.w, h: Math.max(58, m.h) };
  },

  // Caixa com kicker mono + texto (antes/depois, mito/verdade, FAQ).
  panel(ctx, el, x, y, env) {
    const p = pal(env.mode);
    const w = el.w, pad = 36, size = el.size || 42;
    const text = elText(el, env);
    const opts = { text, maxW: w - pad * 2, size, weight: el.weight || 500, lineH: Math.round(size * 1.35), color: p.fg, hl: p.accent, strike: el.strike };
    const m = drawRichText(ctx, { ...opts, x: 0, y: 0, dry: true });
    const h = pad + 30 + 24 + m.h + pad - 10;
    ctx.fillStyle = el.accent ? p.panelAccent : p.panel;
    rr(ctx, x, y, w, h, 24); ctx.fill();
    if (el.accent) {
      ctx.strokeStyle = "rgba(35,216,211,0.4)";
      ctx.lineWidth = 3;
      rr(ctx, x, y, w, h, 24); ctx.stroke();
    }
    ctx.font = `600 28px ${FM}`;
    ctx.letterSpacing = "4px";
    ctx.fillStyle = el.accent ? p.accent : p.dim;
    ctx.fillText(String(el.kicker || "").toUpperCase(), x + pad, y + pad + 20);
    ctx.letterSpacing = "0px";
    drawRichText(ctx, { ...opts, x: x + pad, y: y + pad + 30 + 24 });
    return { x, y, w, h };
  },

  // Fileira de chips mono (data · hora · lugar) separados por "|".
  chips(ctx, el, x, y, env) {
    const p = pal(env.mode);
    const parts = String(elText(el, env)).split("|").map((s) => s.trim()).filter(Boolean);
    const size = el.size || 34, h = Math.round(size * 2.1);
    ctx.font = `600 ${size}px ${FM}`;
    let xx = x;
    for (const part of parts) {
      const tw = ctx.measureText(part).width;
      ctx.fillStyle = p.panel;
      rr(ctx, xx, y, tw + size * 1.6, h, 16); ctx.fill();
      ctx.strokeStyle = p.line;
      ctx.lineWidth = 3;
      rr(ctx, xx, y, tw + size * 1.6, h, 16); ctx.stroke();
      ctx.fillStyle = p.fg;
      ctx.fillText(part, xx + size * 0.8, y + h / 2 + size * 0.36);
      xx += tw + size * 1.6 + 20;
    }
    return { x, y, w: Math.max(0, xx - x - 20), h };
  },

  // Área reservada (ex.: caixinha de resposta do IG) — guia pontilhada.
  zone(ctx, el, x, y, env) {
    const p = pal(env.mode);
    ctx.fillStyle = p.panel;
    rr(ctx, x, y, el.w, el.h, 28); ctx.fill();
    ctx.save();
    ctx.setLineDash([16, 12]);
    ctx.strokeStyle = "rgba(35,216,211,0.45)";
    ctx.lineWidth = 3;
    rr(ctx, x, y, el.w, el.h, 28); ctx.stroke();
    ctx.restore();
    ctx.font = `500 30px ${FM}`;
    ctx.fillStyle = p.dim;
    const label = el.hint || "";
    ctx.fillText(label, x + (el.w - ctx.measureText(label).width) / 2, y + el.h / 2 + 10);
    return { x, y, w: el.w, h: el.h };
  },

  // Barrinha decorativa teal.
  bar(ctx, el, x, y) {
    ctx.fillStyle = B.teal;
    rr(ctx, x, y, el.w || 220, el.h || 16, (el.h || 16) / 2); ctx.fill();
    return { x, y, w: el.w || 220, h: el.h || 16 };
  },
};

// Elemento avulso adicionado pelo usuário (texto / botão / foto).
function drawExtra(ctx, ex, x, y, env) {
  const p = pal(env.mode);
  if (ex.type === "pill") {
    const m = drawPillShape(ctx, ex.text, x, y, ex.size || 40);
    return { x, y, w: m.w, h: m.h };
  }
  if (ex.type === "photo") {
    return drawPhotoBox(ctx, { id: "extra:" + ex.id, w: ex.w || 520, h: ex.h || 520, r: 24 }, x, y, env);
  }
  const m = drawRichText(ctx, { text: ex.text, x, y, maxW: 880, size: ex.size || 54, weight: 600, lineH: Math.round((ex.size || 54) * 1.2), color: p.fg, hl: p.accent });
  return { x, y, w: m.w, h: m.h };
}

// Renderiza um slide inteiro e devolve os bounding boxes (pro drag/hit-test).
function renderSlide(ctx, tpl, i, env, pos, extras, selKey) {
  const mode = Array.isArray(tpl.mode) ? tpl.mode[i] : (tpl.mode || "dark");
  const e = { ...env, mode };
  bg(ctx, tpl.w, tpl.h, mode);
  ctx.textBaseline = "alphabetic";
  const boxes = [];
  const done = {};
  const els = tpl.els.filter((el) => el.slide === "all" || (el.slide || 1) === i + 1);
  for (const el of els) {
    const d = pos[el.id] || { dx: 0, dy: 0 };
    const yBase = typeof el.y === "number" ? el.y : ((done[el.y.after]?.bottom ?? 0) + el.y.gap);
    const x = el.x + d.dx, y = yBase + d.dy;
    const bbox = EL[el.type](ctx, el, x, y, e);
    done[el.id] = { ...bbox, bottom: bbox.y + bbox.h };
    if (el.lock !== true) boxes.push({ key: el.id, ...bbox, el });
  }
  for (const ex of extras.filter((x) => (x.slide || 1) === i + 1)) {
    const key = "extra:" + ex.id;
    const d = pos[key] || { dx: 0, dy: 0 };
    const bbox = drawExtra(ctx, ex, ex.x + d.dx, ex.y + d.dy, e);
    boxes.push({ key, ...bbox, el: ex, extra: true });
  }
  if (tpl.group === "car") {
    pageDots(ctx, tpl.w, tpl.h - 86, i, tpl.slides);
    if (i < tpl.slides - 1) arrowHint(ctx, tpl.w, tpl.h, 100);
  }
  if (selKey) {
    const b = boxes.find((bb) => bb.key === selKey);
    if (b) {
      ctx.save();
      ctx.setLineDash([12, 9]);
      ctx.strokeStyle = B.teal;
      ctx.lineWidth = 4;
      ctx.strokeRect(b.x - 12, b.y - 12, b.w + 24, b.h + 24);
      ctx.restore();
    }
  }
  return boxes;
}

// ── Templates ────────────────────────────────────────────────────────────────
// fields: campos de texto do painel (def = copy de exemplo na voz da marca).
// els: os elementos com posição default. Ids únicos por template.

const carChrome = [
  { id: "logo", type: "logo", slide: "all", x: 100, y: 88, h: 64 },
  { id: "handle", type: "handle", field: "handle", slide: "all", x: 100, y: 1242 },
];

const TEMPLATES = [
  // ── Stories 1080×1920 ─────────────────────────────────────────────────────
  {
    id: "story-chamada", group: "story", name: "Chamada", w: 1080, h: 1920, slides: 1,
    fields: [
      { k: "eyebrow", label: "Kicker", def: "LeverAds" },
      { k: "title", label: "Título", type: "textarea", def: "Pare de subir anúncio *um por um*." },
      { k: "body", label: "Texto", type: "textarea", def: "Clone seus anúncios entre todas as suas contas de Mercado Livre e Shopee em minutos, não em semanas." },
      { k: "cta", label: "CTA", def: "Fala com a gente" },
      { k: "handle", label: "Rodapé", def: "@lever.ads" },
    ],
    els: [
      { id: "logo", type: "logo", x: 110, y: 150, h: 88 },
      { id: "eyebrow", type: "eyebrow", field: "eyebrow", x: 110, y: 586, size: 32 },
      { id: "title", type: "rich", field: "title", x: 110, y: { after: "eyebrow", gap: 26 }, maxW: 860, size: 104, lineH: 118 },
      { id: "body", type: "rich", field: "body", x: 110, y: { after: "title", gap: 48 }, maxW: 860, size: 44, weight: 500, color: "soft", lineH: 62 },
      { id: "cta", type: "pill", field: "cta", x: 110, y: 1590, size: 44 },
      { id: "handle", type: "handle", field: "handle", x: 540, y: 1800, align: "center" },
    ],
  },
  {
    id: "story-lista", group: "story", name: "Lista", w: 1080, h: 1920, slides: 1,
    fields: [
      { k: "eyebrow", label: "Kicker", def: "Como funciona" },
      { k: "title", label: "Título", type: "textarea", def: "Sua operação inteira em *3 passos*" },
      { k: "item1", label: "Item 1", def: "Clonagem em massa entre contas" },
      { k: "item2", label: "Item 2", def: "Conta-mãe alimenta as filhas sozinha" },
      { k: "item3", label: "Item 3", def: "Atributos e SKU sempre certos" },
      { k: "item4", label: "Item 4 (opcional)", def: "" },
      { k: "cta", label: "CTA", def: "Quero testar" },
      { k: "handle", label: "Rodapé", def: "@lever.ads" },
    ],
    els: [
      { id: "logo", type: "logo", x: 110, y: 150, h: 88 },
      { id: "eyebrow", type: "eyebrow", field: "eyebrow", x: 110, y: 446, size: 32 },
      { id: "title", type: "rich", field: "title", x: 110, y: { after: "eyebrow", gap: 26 }, maxW: 860, size: 88, lineH: 102 },
      { id: "item1", type: "check", field: "item1", x: 110, y: { after: "title", gap: 80 }, maxW: 860 },
      { id: "item2", type: "check", field: "item2", x: 110, y: { after: "item1", gap: 40 }, maxW: 860 },
      { id: "item3", type: "check", field: "item3", x: 110, y: { after: "item2", gap: 40 }, maxW: 860 },
      { id: "item4", type: "check", field: "item4", x: 110, y: { after: "item3", gap: 40 }, maxW: 860 },
      { id: "cta", type: "pill", field: "cta", x: 110, y: 1590, size: 44 },
      { id: "handle", type: "handle", field: "handle", x: 540, y: 1800, align: "center" },
    ],
  },
  {
    id: "story-numero", group: "story", name: "Número (claro)", w: 1080, h: 1920, slides: 1, mode: "light",
    fields: [
      { k: "eyebrow", label: "Kicker", def: "Case real" },
      { k: "stat", label: "Número", def: "+105%" },
      { k: "label", label: "O que é o número", def: "em vendas brutas no 1º mês" },
      { k: "body", label: "Texto", type: "textarea", def: "Conta nova clonada da conta-mãe. Prints reais do painel do Mercado Livre." },
      { k: "cta", label: "CTA", def: "Quero esse resultado" },
      { k: "handle", label: "Rodapé", def: "@lever.ads" },
    ],
    els: [
      { id: "logo", type: "logo", x: 110, y: 150, h: 88 },
      { id: "eyebrow", type: "eyebrow", field: "eyebrow", x: 110, y: 566, size: 32 },
      { id: "stat", type: "rich", field: "stat", x: 110, y: { after: "eyebrow", gap: 30 }, maxW: 860, size: 250, lineH: 260, hl: "accent" },
      { id: "bar", type: "bar", x: 110, y: { after: "stat", gap: 40 }, w: 220, h: 16 },
      { id: "label", type: "rich", field: "label", x: 110, y: { after: "bar", gap: 46 }, maxW: 860, size: 56, weight: 600, lineH: 68 },
      { id: "body", type: "rich", field: "body", x: 110, y: { after: "label", gap: 44 }, maxW: 860, size: 42, weight: 500, color: "soft", lineH: 58 },
      { id: "cta", type: "pill", field: "cta", x: 110, y: 1590, size: 44 },
      { id: "handle", type: "handle", field: "handle", x: 540, y: 1800, align: "center" },
    ],
  },
  {
    id: "story-foto", group: "story", name: "Foto", w: 1080, h: 1920, slides: 1,
    fields: [
      { k: "title", label: "Título", type: "textarea", def: "Bastidor de hoje: *a máquina rodando*." },
      { k: "cta", label: "CTA", def: "Fala com a gente" },
      { k: "handle", label: "Rodapé", def: "@lever.ads" },
    ],
    els: [
      { id: "logo", type: "logo", x: 110, y: 150, h: 88 },
      { id: "foto", type: "photo", x: 110, y: 310, w: 860, h: 900, r: 36 },
      { id: "title", type: "rich", field: "title", x: 110, y: { after: "foto", gap: 56 }, maxW: 860, size: 76, lineH: 88 },
      { id: "cta", type: "pill", field: "cta", x: 110, y: { after: "title", gap: 56 }, size: 44 },
      { id: "handle", type: "handle", field: "handle", x: 540, y: 1800, align: "center" },
    ],
  },
  {
    id: "story-pergunta", group: "story", name: "Pergunta", w: 1080, h: 1920, slides: 1,
    fields: [
      { k: "eyebrow", label: "Kicker", def: "Pergunta rápida" },
      { k: "title", label: "Pergunta", type: "textarea", def: "Quantas contas você *consegue operar hoje* sem surtar?" },
      { k: "handle", label: "Rodapé", def: "@lever.ads" },
    ],
    els: [
      { id: "logo", type: "logo", x: 110, y: 150, h: 88 },
      { id: "eyebrow", type: "eyebrow", field: "eyebrow", x: 110, y: 540, size: 32 },
      { id: "title", type: "rich", field: "title", x: 110, y: { after: "eyebrow", gap: 30 }, maxW: 860, size: 92, lineH: 106 },
      { id: "zone", type: "zone", x: 140, y: { after: "title", gap: 90 }, w: 800, h: 260, hint: "caixinha de resposta do IG aqui" },
      { id: "handle", type: "handle", field: "handle", x: 540, y: 1800, align: "center" },
    ],
  },
  {
    id: "story-agenda", group: "story", name: "Agenda (claro)", w: 1080, h: 1920, slides: 1, mode: "light",
    fields: [
      { k: "eyebrow", label: "Kicker", def: "Agenda" },
      { k: "title", label: "Título", type: "textarea", def: "Hotseat ao vivo com o time *LeverAds*" },
      { k: "chips", label: "Data · hora · onde (separa com |)", def: "sáb · 26/07|10h00|ao vivo" },
      { k: "body", label: "Texto", type: "textarea", def: "Troca de experiência entre vendedores e novos negócios na mesa. Traz teu caso." },
      { k: "cta", label: "CTA", def: "Garante teu lugar" },
      { k: "handle", label: "Rodapé", def: "@lever.ads" },
    ],
    els: [
      { id: "logo", type: "logo", x: 110, y: 150, h: 88 },
      { id: "eyebrow", type: "eyebrow", field: "eyebrow", x: 110, y: 500, size: 32 },
      { id: "title", type: "rich", field: "title", x: 110, y: { after: "eyebrow", gap: 28 }, maxW: 860, size: 92, lineH: 106 },
      { id: "chips", type: "chips", field: "chips", x: 110, y: { after: "title", gap: 60 } },
      { id: "body", type: "rich", field: "body", x: 110, y: { after: "chips", gap: 64 }, maxW: 860, size: 42, weight: 500, color: "soft", lineH: 58 },
      { id: "cta", type: "pill", field: "cta", x: 110, y: 1590, size: 44 },
      { id: "handle", type: "handle", field: "handle", x: 540, y: 1800, align: "center" },
    ],
  },

  // ── Posts de feed 1080×1350 ───────────────────────────────────────────────
  {
    id: "post-chamada", group: "post", name: "Chamada", w: 1080, h: 1350, slides: 1,
    fields: [
      { k: "eyebrow", label: "Kicker", def: "LeverAds" },
      { k: "title", label: "Título", type: "textarea", def: "Quem tem 5 contas não pode operar como quem tem *uma*." },
      { k: "body", label: "Texto", type: "textarea", def: "Clonagem ilimitada de anúncios entre contas de Mercado Livre e Shopee, com atributos e SKU no lugar." },
      { k: "cta", label: "CTA", def: "Link na bio" },
      { k: "handle", label: "Rodapé", def: "@lever.ads" },
    ],
    els: [
      { id: "logo", type: "logo", x: 100, y: 110, h: 72 },
      { id: "eyebrow", type: "eyebrow", field: "eyebrow", x: 100, y: 368, size: 30 },
      { id: "title", type: "rich", field: "title", x: 100, y: { after: "eyebrow", gap: 24 }, maxW: 880, size: 88, lineH: 100 },
      { id: "body", type: "rich", field: "body", x: 100, y: { after: "title", gap: 44 }, maxW: 880, size: 40, weight: 500, color: "soft", lineH: 56 },
      { id: "cta", type: "pill", field: "cta", x: 100, y: 1130, size: 40 },
      { id: "handle", type: "handle", field: "handle", x: 980, y: 1156, align: "right" },
    ],
  },
  {
    id: "post-numero", group: "post", name: "Número", w: 1080, h: 1350, slides: 1,
    fields: [
      { k: "eyebrow", label: "Kicker", def: "Na prática" },
      { k: "stat", label: "Número", def: "2h" },
      { k: "label", label: "O que é o número", def: "pra clonar 10 anúncios que levariam dias" },
      { k: "body", label: "Texto", type: "textarea", def: "É o teste que fazemos com você, na sua conta, sem cartão e sem compromisso." },
      { k: "handle", label: "Rodapé", def: "@lever.ads" },
    ],
    els: [
      { id: "logo", type: "logo", x: 100, y: 110, h: 72 },
      { id: "eyebrow", type: "eyebrow", field: "eyebrow", x: 100, y: 388, size: 30 },
      { id: "stat", type: "rich", field: "stat", x: 100, y: { after: "eyebrow", gap: 32 }, maxW: 880, size: 240, lineH: 250, color: "accent", hl: "fg" },
      { id: "label", type: "rich", field: "label", x: 100, y: { after: "stat", gap: 34 }, maxW: 880, size: 54, weight: 600, lineH: 66 },
      { id: "body", type: "rich", field: "body", x: 100, y: { after: "label", gap: 40 }, maxW: 880, size: 40, weight: 500, color: "soft", lineH: 56 },
      { id: "handle", type: "handle", field: "handle", x: 540, y: 1240, align: "center" },
    ],
  },
  {
    id: "post-frase", group: "post", name: "Frase (claro)", w: 1080, h: 1350, slides: 1, mode: "light",
    fields: [
      { k: "title", label: "Frase", type: "textarea", def: "Anúncio parado em conta parada é *venda que já era sua* indo pro concorrente." },
      { k: "author", label: "Assinatura", def: "Leo · LeverAds" },
      { k: "handle", label: "Rodapé", def: "@lever.ads" },
    ],
    els: [
      { id: "logo", type: "logo", x: 100, y: 110, h: 72 },
      { id: "quote", type: "rich", text: "“", x: 88, y: 260, maxW: 400, size: 300, color: "accent" },
      { id: "title", type: "rich", field: "title", x: 100, y: 560, maxW: 880, size: 74, weight: 600, lineH: 92 },
      { id: "bar", type: "bar", x: 100, y: { after: "title", gap: 56 }, w: 120, h: 12 },
      { id: "author", type: "rich", field: "author", x: 100, y: { after: "bar", gap: 30 }, maxW: 880, size: 34, weight: 500, color: "soft", font: "mono" },
      { id: "handle", type: "handle", field: "handle", x: 980, y: 1240, align: "right" },
    ],
  },
  {
    id: "post-foto", group: "post", name: "Foto", w: 1080, h: 1350, slides: 1,
    fields: [
      { k: "title", label: "Título", type: "textarea", def: "Anúncio bom é o que *tá no ar* em todas as contas." },
      { k: "body", label: "Texto", type: "textarea", def: "Print real da operação rodando na LeverAds." },
      { k: "handle", label: "Rodapé", def: "@lever.ads" },
    ],
    els: [
      { id: "logo", type: "logo", x: 100, y: 110, h: 72 },
      { id: "foto", type: "photo", x: 100, y: 250, w: 880, h: 500, r: 28 },
      { id: "title", type: "rich", field: "title", x: 100, y: { after: "foto", gap: 52 }, maxW: 880, size: 68, lineH: 80 },
      { id: "body", type: "rich", field: "body", x: 100, y: { after: "title", gap: 36 }, maxW: 880, size: 38, weight: 500, color: "soft", lineH: 52 },
      { id: "handle", type: "handle", field: "handle", x: 980, y: 1240, align: "right" },
    ],
  },
  {
    id: "post-antesdepois", group: "post", name: "Antes e depois", w: 1080, h: 1350, slides: 1,
    fields: [
      { k: "eyebrow", label: "Kicker", def: "Antes e depois" },
      { k: "title", label: "Título", type: "textarea", def: "A mesma operação, *dois mundos*" },
      { k: "before", label: "Antes (uma linha por item)", type: "textarea", def: "Catálogo subido à mão\nAtributo fora do padrão\nUma conta por vez" },
      { k: "after", label: "Depois (uma linha por item)", type: "textarea", def: "Clonagem em massa\nAtributos no lugar\nTodas as contas juntas" },
      { k: "handle", label: "Rodapé", def: "@lever.ads" },
    ],
    els: [
      { id: "logo", type: "logo", x: 100, y: 110, h: 72 },
      { id: "eyebrow", type: "eyebrow", field: "eyebrow", x: 100, y: 340, size: 30 },
      { id: "title", type: "rich", field: "title", x: 100, y: { after: "eyebrow", gap: 24 }, maxW: 880, size: 70, lineH: 82 },
      { id: "before", type: "panel", field: "before", kicker: "Antes", x: 100, y: { after: "title", gap: 64 }, w: 425, size: 38 },
      { id: "after", type: "panel", field: "after", kicker: "Depois", accent: true, x: 555, y: { after: "title", gap: 64 }, w: 425, size: 38 },
      { id: "handle", type: "handle", field: "handle", x: 540, y: 1240, align: "center" },
    ],
  },
  {
    id: "post-dica", group: "post", name: "Dica (claro)", w: 1080, h: 1350, slides: 1, mode: "light",
    fields: [
      { k: "eyebrow", label: "Kicker", def: "Dica rápida" },
      { k: "num", label: "Número da dica", def: "#01" },
      { k: "title", label: "Título", type: "textarea", def: "Sua conta-mãe precisa ser *impecável*" },
      { k: "body", label: "Texto", type: "textarea", def: "É dela que tudo se multiplica: foto, título, atributo. Arruma a mãe antes de clonar as filhas." },
      { k: "handle", label: "Rodapé", def: "@lever.ads" },
    ],
    els: [
      { id: "logo", type: "logo", x: 100, y: 110, h: 72 },
      { id: "eyebrow", type: "eyebrow", field: "eyebrow", x: 100, y: 340, size: 30 },
      { id: "num", type: "rich", field: "num", x: 100, y: { after: "eyebrow", gap: 32 }, maxW: 880, size: 150, color: "accent", lineH: 160 },
      { id: "title", type: "rich", field: "title", x: 100, y: { after: "num", gap: 32 }, maxW: 880, size: 70, lineH: 82 },
      { id: "body", type: "rich", field: "body", x: 100, y: { after: "title", gap: 36 }, maxW: 880, size: 40, weight: 500, color: "soft", lineH: 56 },
      { id: "handle", type: "handle", field: "handle", x: 980, y: 1240, align: "right" },
    ],
  },

  // ── Carrosséis 4× 1080×1350 ───────────────────────────────────────────────
  {
    id: "car-dor", group: "car", name: "Dor e solução", w: 1080, h: 1350, slides: 4,
    fields: [
      { k: "handle", label: "Rodapé (todos)", def: "@lever.ads" },
      { k: "s1_eyebrow", label: "Kicker", def: "Pra quem vende em várias contas", slide: 1 },
      { k: "s1_title", label: "Título da capa", type: "textarea", def: "O gargalo da sua operação *não é anúncio*. É retrabalho.", slide: 1 },
      { k: "s2_kicker", label: "Kicker", def: "O problema", slide: 2 },
      { k: "s2_title", label: "Título", type: "textarea", def: "Cada conta nova recomeça do zero", slide: 2 },
      { k: "s2_body", label: "Texto", type: "textarea", def: "Subir catálogo, revisar atributo, conferir SKU. Multiplica isso por 3, 5, 8 contas e a semana acabou.", slide: 2 },
      { k: "s3_kicker", label: "Kicker", def: "A solução", slide: 3 },
      { k: "s3_title", label: "Título", type: "textarea", def: "Uma conta-mãe, todas as filhas *sincronizadas*", slide: 3 },
      { k: "s3_body", label: "Texto", type: "textarea", def: "A LeverAds clona e mantém seus anúncios em todas as contas de Mercado Livre e Shopee, sozinha.", slide: 3 },
      { k: "s4_title", label: "Título do fechamento", type: "textarea", def: "Teste com *10 anúncios seus*, sem cartão.", slide: 4 },
      { k: "s4_cta", label: "CTA", def: "Chama no direct", slide: 4 },
    ],
    els: [
      ...carChrome,
      { id: "s1_eyebrow", type: "eyebrow", field: "s1_eyebrow", slide: 1, x: 100, y: 488, size: 30 },
      { id: "s1_title", type: "rich", field: "s1_title", slide: 1, x: 100, y: { after: "s1_eyebrow", gap: 26 }, maxW: 880, size: 92, lineH: 106 },
      { id: "s2_kicker", type: "eyebrow", field: "s2_kicker", slide: 2, x: 100, y: 388, size: 30 },
      { id: "s2_title", type: "rich", field: "s2_title", slide: 2, x: 100, y: { after: "s2_kicker", gap: 26 }, maxW: 880, size: 78, lineH: 90 },
      { id: "s2_body", type: "rich", field: "s2_body", slide: 2, x: 100, y: { after: "s2_title", gap: 42 }, maxW: 880, size: 42, weight: 500, color: "soft", lineH: 60 },
      { id: "s3_kicker", type: "eyebrow", field: "s3_kicker", slide: 3, x: 100, y: 388, size: 30 },
      { id: "s3_title", type: "rich", field: "s3_title", slide: 3, x: 100, y: { after: "s3_kicker", gap: 26 }, maxW: 880, size: 78, lineH: 90 },
      { id: "s3_body", type: "rich", field: "s3_body", slide: 3, x: 100, y: { after: "s3_title", gap: 42 }, maxW: 880, size: 42, weight: 500, color: "soft", lineH: 60 },
      { id: "s4_title", type: "rich", field: "s4_title", slide: 4, x: 100, y: 480, maxW: 880, size: 88, lineH: 102 },
      { id: "s4_cta", type: "pill", field: "s4_cta", slide: 4, x: 100, y: { after: "s4_title", gap: 72 }, size: 42 },
    ],
  },
  {
    id: "car-passos", group: "car", name: "Passo a passo", w: 1080, h: 1350, slides: 4,
    fields: [
      { k: "handle", label: "Rodapé (todos)", def: "@lever.ads" },
      { k: "s1_eyebrow", label: "Kicker", def: "Guia rápido", slide: 1 },
      { k: "s1_title", label: "Título da capa", type: "textarea", def: "Como escalar pra *várias contas* sem contratar ninguém", slide: 1 },
      { k: "s2_title", label: "Passo 1 · título", def: "Conecte suas contas", slide: 2 },
      { k: "s2_body", label: "Passo 1 · texto", type: "textarea", def: "Mercado Livre e Shopee, todas no mesmo painel. Uma vira a conta-mãe.", slide: 2 },
      { k: "s3_title", label: "Passo 2 · título", def: "Clone os anúncios", slide: 3 },
      { k: "s3_body", label: "Passo 2 · texto", type: "textarea", def: "Escolha os anúncios e o destino. Atributos, fotos e SKU vão junto, do jeito certo.", slide: 3 },
      { k: "s4_title", label: "Passo 3 · título", def: "Deixe no automático", slide: 4 },
      { k: "s4_body", label: "Passo 3 · texto", type: "textarea", def: "Anúncio novo na mãe replica nas filhas sozinho. Sua operação cresce sem crescer o time.", slide: 4 },
      { k: "s4_cta", label: "CTA final", def: "Testa grátis · link na bio", slide: 4 },
    ],
    els: [
      ...carChrome,
      { id: "s1_eyebrow", type: "eyebrow", field: "s1_eyebrow", slide: 1, x: 100, y: 488, size: 30 },
      { id: "s1_title", type: "rich", field: "s1_title", slide: 1, x: 100, y: { after: "s1_eyebrow", gap: 26 }, maxW: 880, size: 92, lineH: 106 },
      { id: "s2_num", type: "rich", text: "01", slide: 2, x: 100, y: 300, maxW: 880, size: 190, color: "accent", lineH: 200 },
      { id: "s2_title", type: "rich", field: "s2_title", slide: 2, x: 100, y: { after: "s2_num", gap: 44 }, maxW: 880, size: 76, lineH: 88 },
      { id: "s2_body", type: "rich", field: "s2_body", slide: 2, x: 100, y: { after: "s2_title", gap: 40 }, maxW: 880, size: 42, weight: 500, color: "soft", lineH: 60 },
      { id: "s3_num", type: "rich", text: "02", slide: 3, x: 100, y: 300, maxW: 880, size: 190, color: "accent", lineH: 200 },
      { id: "s3_title", type: "rich", field: "s3_title", slide: 3, x: 100, y: { after: "s3_num", gap: 44 }, maxW: 880, size: 76, lineH: 88 },
      { id: "s3_body", type: "rich", field: "s3_body", slide: 3, x: 100, y: { after: "s3_title", gap: 40 }, maxW: 880, size: 42, weight: 500, color: "soft", lineH: 60 },
      { id: "s4_num", type: "rich", text: "03", slide: 4, x: 100, y: 300, maxW: 880, size: 190, color: "accent", lineH: 200 },
      { id: "s4_title", type: "rich", field: "s4_title", slide: 4, x: 100, y: { after: "s4_num", gap: 44 }, maxW: 880, size: 76, lineH: 88 },
      { id: "s4_body", type: "rich", field: "s4_body", slide: 4, x: 100, y: { after: "s4_title", gap: 40 }, maxW: 880, size: 42, weight: 500, color: "soft", lineH: 60 },
      { id: "s4_cta", type: "rich", field: "s4_cta", slide: 4, x: 100, y: 1130, maxW: 880, size: 34, weight: 600, color: "accent", font: "mono" },
    ],
  },
  {
    id: "car-case", group: "car", name: "Case", w: 1080, h: 1350, slides: 4, mode: ["dark", "light", "dark", "dark"],
    fields: [
      { k: "handle", label: "Rodapé (todos)", def: "@lever.ads" },
      { k: "s1_eyebrow", label: "Kicker", def: "Case real", slide: 1 },
      { k: "s1_title", label: "Título da capa", type: "textarea", def: "A conta nova que fez *+105%* já no primeiro mês", slide: 1 },
      { k: "s2_stat1", label: "Número 1", def: "+105%", slide: 2 },
      { k: "s2_label1", label: "Legenda 1", def: "vendas brutas em 1 mês", slide: 2 },
      { k: "s2_stat2", label: "Número 2", def: "+98,8%", slide: 2 },
      { k: "s2_label2", label: "Legenda 2", def: "pedidos", slide: 2 },
      { k: "s2_stat3", label: "Número 3", def: "+115%", slide: 2 },
      { k: "s2_label3", label: "Legenda 3", def: "visitas", slide: 2 },
      { k: "s3_kicker", label: "Kicker", def: "Como", slide: 3 },
      { k: "s3_title", label: "Título", type: "textarea", def: "Clonamos a conta-mãe inteira pra conta nova", slide: 3 },
      { k: "s3_body", label: "Texto", type: "textarea", def: "Mesmos anúncios, mais exposição. Números reais, direto do painel do Mercado Livre.", slide: 3 },
      { k: "s4_title", label: "Fechamento", type: "textarea", def: "Sua próxima conta pode ser *essa*.", slide: 4 },
      { k: "s4_cta", label: "CTA", def: "Chama no direct", slide: 4 },
    ],
    els: [
      ...carChrome,
      { id: "s1_eyebrow", type: "eyebrow", field: "s1_eyebrow", slide: 1, x: 100, y: 488, size: 30 },
      { id: "s1_title", type: "rich", field: "s1_title", slide: 1, x: 100, y: { after: "s1_eyebrow", gap: 26 }, maxW: 880, size: 92, lineH: 106 },
      { id: "s2_stat1", type: "rich", field: "s2_stat1", slide: 2, x: 100, y: 300, maxW: 880, size: 130, color: "accent", hl: "fg", lineH: 140 },
      { id: "s2_label1", type: "rich", field: "s2_label1", slide: 2, x: 100, y: { after: "s2_stat1", gap: 8 }, maxW: 880, size: 42, weight: 600, color: "soft", lineH: 52 },
      { id: "s2_stat2", type: "rich", field: "s2_stat2", slide: 2, x: 100, y: { after: "s2_label1", gap: 56 }, maxW: 880, size: 130, color: "accent", hl: "fg", lineH: 140 },
      { id: "s2_label2", type: "rich", field: "s2_label2", slide: 2, x: 100, y: { after: "s2_stat2", gap: 8 }, maxW: 880, size: 42, weight: 600, color: "soft", lineH: 52 },
      { id: "s2_stat3", type: "rich", field: "s2_stat3", slide: 2, x: 100, y: { after: "s2_label2", gap: 56 }, maxW: 880, size: 130, color: "accent", hl: "fg", lineH: 140 },
      { id: "s2_label3", type: "rich", field: "s2_label3", slide: 2, x: 100, y: { after: "s2_stat3", gap: 8 }, maxW: 880, size: 42, weight: 600, color: "soft", lineH: 52 },
      { id: "s3_kicker", type: "eyebrow", field: "s3_kicker", slide: 3, x: 100, y: 388, size: 30 },
      { id: "s3_title", type: "rich", field: "s3_title", slide: 3, x: 100, y: { after: "s3_kicker", gap: 26 }, maxW: 880, size: 78, lineH: 90 },
      { id: "s3_body", type: "rich", field: "s3_body", slide: 3, x: 100, y: { after: "s3_title", gap: 42 }, maxW: 880, size: 42, weight: 500, color: "soft", lineH: 60 },
      { id: "s4_title", type: "rich", field: "s4_title", slide: 4, x: 100, y: 480, maxW: 880, size: 88, lineH: 102 },
      { id: "s4_cta", type: "pill", field: "s4_cta", slide: 4, x: 100, y: { after: "s4_title", gap: 72 }, size: 42 },
    ],
  },
  {
    id: "car-mitos", group: "car", name: "Mitos e verdades", w: 1080, h: 1350, slides: 4,
    fields: [
      { k: "handle", label: "Rodapé (todos)", def: "@lever.ads" },
      { k: "s1_eyebrow", label: "Kicker", def: "Mitos e verdades", slide: 1 },
      { k: "s1_title", label: "Título da capa", type: "textarea", def: "O que te contaram sobre *multi-contas* no Meli", slide: 1 },
      { k: "s2_mito", label: "Mito 1", type: "textarea", def: "Ter várias contas é arriscado de qualquer jeito", slide: 2 },
      { k: "s2_verdade", label: "Verdade 1", type: "textarea", def: "Risco é operar tudo à mão. Com processo e atributo certo, conta nova é exposição nova.", slide: 2 },
      { k: "s3_mito", label: "Mito 2", type: "textarea", def: "Não dá pra manter tudo atualizado", slide: 3 },
      { k: "s3_verdade", label: "Verdade 2", type: "textarea", def: "A conta-mãe replica nas filhas sozinha: anúncio novo entra em todas.", slide: 3 },
      { k: "s4_title", label: "Fechamento", type: "textarea", def: "Testa com *10 anúncios seus*, sem cartão.", slide: 4 },
      { k: "s4_cta", label: "CTA", def: "Chama no direct", slide: 4 },
    ],
    els: [
      ...carChrome,
      { id: "s1_eyebrow", type: "eyebrow", field: "s1_eyebrow", slide: 1, x: 100, y: 488, size: 30 },
      { id: "s1_title", type: "rich", field: "s1_title", slide: 1, x: 100, y: { after: "s1_eyebrow", gap: 26 }, maxW: 880, size: 92, lineH: 106 },
      { id: "s2_mito", type: "panel", field: "s2_mito", kicker: "Mito", strike: true, slide: 2, x: 100, y: 360, w: 880, size: 44 },
      { id: "s2_verdade", type: "panel", field: "s2_verdade", kicker: "Verdade", accent: true, slide: 2, x: 100, y: { after: "s2_mito", gap: 44 }, w: 880, size: 44 },
      { id: "s3_mito", type: "panel", field: "s3_mito", kicker: "Mito", strike: true, slide: 3, x: 100, y: 360, w: 880, size: 44 },
      { id: "s3_verdade", type: "panel", field: "s3_verdade", kicker: "Verdade", accent: true, slide: 3, x: 100, y: { after: "s3_mito", gap: 44 }, w: 880, size: 44 },
      { id: "s4_title", type: "rich", field: "s4_title", slide: 4, x: 100, y: 480, maxW: 880, size: 88, lineH: 102 },
      { id: "s4_cta", type: "pill", field: "s4_cta", slide: 4, x: 100, y: { after: "s4_title", gap: 72 }, size: 42 },
    ],
  },
  {
    id: "car-bastidores", group: "car", name: "Bastidores (fotos)", w: 1080, h: 1350, slides: 4,
    fields: [
      { k: "handle", label: "Rodapé (todos)", def: "@lever.ads" },
      { k: "s1_title", label: "Título da capa", type: "textarea", def: "Por dentro da *nossa operação*", slide: 1 },
      { k: "s2_body", label: "Legenda da foto 2", type: "textarea", def: "A conta-mãe alimenta as filhas: subiu uma vez, subiu em todas.", slide: 2 },
      { k: "s3_body", label: "Legenda da foto 3", type: "textarea", def: "O time revisa atributo e SKU enquanto a clonagem roda sozinha.", slide: 3 },
      { k: "s4_title", label: "Fechamento", type: "textarea", def: "Quer ver rodando *na tua conta*?", slide: 4 },
      { k: "s4_cta", label: "CTA", def: "Chama no direct", slide: 4 },
    ],
    els: [
      ...carChrome,
      { id: "foto1", type: "photo", slide: 1, x: 100, y: 250, w: 880, h: 600, r: 28 },
      { id: "s1_title", type: "rich", field: "s1_title", slide: 1, x: 100, y: { after: "foto1", gap: 48 }, maxW: 880, size: 76, lineH: 88 },
      { id: "foto2", type: "photo", slide: 2, x: 100, y: 250, w: 880, h: 560, r: 28 },
      { id: "s2_body", type: "rich", field: "s2_body", slide: 2, x: 100, y: { after: "foto2", gap: 46 }, maxW: 880, size: 42, weight: 500, color: "soft", lineH: 60 },
      { id: "foto3", type: "photo", slide: 3, x: 100, y: 250, w: 880, h: 560, r: 28 },
      { id: "s3_body", type: "rich", field: "s3_body", slide: 3, x: 100, y: { after: "foto3", gap: 46 }, maxW: 880, size: 42, weight: 500, color: "soft", lineH: 60 },
      { id: "s4_title", type: "rich", field: "s4_title", slide: 4, x: 100, y: 480, maxW: 880, size: 88, lineH: 102 },
      { id: "s4_cta", type: "pill", field: "s4_cta", slide: 4, x: 100, y: { after: "s4_title", gap: 72 }, size: 42 },
    ],
  },
  {
    id: "car-faq", group: "car", name: "Perguntas frequentes", w: 1080, h: 1350, slides: 4,
    fields: [
      { k: "handle", label: "Rodapé (todos)", def: "@lever.ads" },
      { k: "s1_eyebrow", label: "Kicker", def: "Perguntas frequentes", slide: 1 },
      { k: "s1_title", label: "Título da capa", type: "textarea", def: "O que todo vendedor pergunta *antes de testar*", slide: 1 },
      { k: "s2_q", label: "Pergunta 1", type: "textarea", def: "Preciso saber de tecnologia?", slide: 2 },
      { k: "s2_a", label: "Resposta 1", type: "textarea", def: "Não. Você aponta os anúncios e o destino, a LeverAds faz o resto, com suporte humano no WhatsApp.", slide: 2 },
      { k: "s3_q", label: "Pergunta 2", type: "textarea", def: "Funciona pra Shopee também?", slide: 3 },
      { k: "s3_a", label: "Resposta 2", type: "textarea", def: "Sim. Mercado Livre e Shopee no mesmo painel, com clonagem entre plataformas.", slide: 3 },
      { k: "s4_title", label: "Fechamento", type: "textarea", def: "Ficou dúvida? *Chama a gente.*", slide: 4 },
      { k: "s4_cta", label: "CTA", def: "Manda no direct", slide: 4 },
    ],
    els: [
      ...carChrome,
      { id: "s1_eyebrow", type: "eyebrow", field: "s1_eyebrow", slide: 1, x: 100, y: 488, size: 30 },
      { id: "s1_title", type: "rich", field: "s1_title", slide: 1, x: 100, y: { after: "s1_eyebrow", gap: 26 }, maxW: 880, size: 92, lineH: 106 },
      { id: "s2_q", type: "panel", field: "s2_q", kicker: "Pergunta", slide: 2, x: 100, y: 360, w: 880, size: 46, weight: 600 },
      { id: "s2_a", type: "panel", field: "s2_a", kicker: "Resposta", accent: true, slide: 2, x: 100, y: { after: "s2_q", gap: 44 }, w: 880, size: 42 },
      { id: "s3_q", type: "panel", field: "s3_q", kicker: "Pergunta", slide: 3, x: 100, y: 360, w: 880, size: 46, weight: 600 },
      { id: "s3_a", type: "panel", field: "s3_a", kicker: "Resposta", accent: true, slide: 3, x: 100, y: { after: "s3_q", gap: 44 }, w: 880, size: 42 },
      { id: "s4_title", type: "rich", field: "s4_title", slide: 4, x: 100, y: 480, maxW: 880, size: 88, lineH: 102 },
      { id: "s4_cta", type: "pill", field: "s4_cta", slide: 4, x: 100, y: { after: "s4_title", gap: 72 }, size: 42 },
    ],
  },
];

const GROUPS = [
  ["story", "Stories · 1080×1920"],
  ["post", "Post fixo · 1080×1350"],
  ["car", "Carrossel · 4 slides"],
];

const defaultsOf = (tpl) => Object.fromEntries(tpl.fields.map((f) => [f.k, f.def]));
const photoSlotsOf = (tpl) => tpl.els.filter((e) => e.type === "photo");

// ── Tela ─────────────────────────────────────────────────────────────────────
function CreativeScreen() {
  const [tplId, setTplId] = useS(TEMPLATES[0].id);
  const tpl = TEMPLATES.find((t) => t.id === tplId) || TEMPLATES[0];
  const [vals, setVals] = useS(() => defaultsOf(TEMPLATES[0]));
  const [pos, setPos] = useS({});        // offsets de arrasto por elemento
  const [imgs, setImgs] = useS({});      // fotos carregadas por slot
  const [extras, setExtras] = useS([]);  // elementos avulsos
  const [sel, setSel] = useS(null);      // elemento selecionado (outline)
  const [addSlide, setAddSlide] = useS(1);
  const [ready, setReady] = useS(false);
  const refs = useR([]);
  const boxesRef = useR({});
  const dragRef = useR(null);
  const fileRef = useR(null);
  const photoTargetRef = useR(null);
  const extraSeq = useR(0);

  useE(() => { let ok = true; loadAssets().then(() => ok && setReady(true)); return () => { ok = false; }; }, []);
  useE(() => {
    setVals(defaultsOf(tpl)); setPos({}); setImgs({}); setExtras([]); setSel(null); setAddSlide(1);
  }, [tplId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Redesenha os canvases (resolução nativa; o CSS só encolhe a exibição).
  useE(() => {
    if (!ready) return;
    for (let i = 0; i < tpl.slides; i++) {
      const c = refs.current[i];
      if (!c) continue;
      c.width = tpl.w; c.height = tpl.h;
      const ctx = c.getContext("2d");
      boxesRef.current[i] = renderSlide(ctx, tpl, i, { vals, imgs }, pos, extras, sel);
    }
  }, [ready, tpl, vals, pos, imgs, extras, sel]);

  // ── Drag & clique no preview ──
  function canvasPoint(e, i) {
    const c = refs.current[i];
    const r = c.getBoundingClientRect();
    return { x: (e.clientX - r.left) * (tpl.w / r.width), y: (e.clientY - r.top) * (tpl.h / r.height) };
  }
  function onDown(e, i) {
    const p = canvasPoint(e, i);
    const boxes = boxesRef.current[i] || [];
    let hit = null;
    for (let k = boxes.length - 1; k >= 0; k--) {
      const b = boxes[k];
      if (p.x >= b.x - 14 && p.x <= b.x + b.w + 14 && p.y >= b.y - 14 && p.y <= b.y + b.h + 14) { hit = b; break; }
    }
    setSel(hit ? hit.key : null);
    if (!hit) return;
    const cur = pos[hit.key] || { dx: 0, dy: 0 };
    dragRef.current = { key: hit.key, i, x0: p.x, y0: p.y, dx: cur.dx, dy: cur.dy, moved: false, box: hit };
    refs.current[i].setPointerCapture(e.pointerId);
  }
  function onMove(e, i) {
    const d = dragRef.current;
    if (!d || d.i !== i) return;
    const p = canvasPoint(e, i);
    if (Math.abs(p.x - d.x0) + Math.abs(p.y - d.y0) > 8) d.moved = true;
    if (!d.moved) return;
    setPos((prev) => ({ ...prev, [d.key]: { dx: d.dx + (p.x - d.x0), dy: d.dy + (p.y - d.y0) } }));
  }
  function onUp() {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d) return;
    // Clique seco num slot de foto abre o seletor de arquivo.
    if (!d.moved && d.box.el.type === "photo") openPhoto(d.box.extra ? "extra:" + d.box.el.id : d.box.el.id);
  }
  function openPhoto(slotId) {
    photoTargetRef.current = slotId;
    fileRef.current?.click();
  }
  function onFile(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    const target = photoTargetRef.current;
    if (!file || !target) return;
    const url = URL.createObjectURL(file);
    loadImg(url).then((img) => setImgs((p) => ({ ...p, [target]: img })));
  }

  // ── Elementos avulsos ──
  function addExtra(type) {
    const id = ++extraSeq.current;
    const base = { id, type, slide: tpl.slides > 1 ? addSlide : 1, x: Math.round(tpl.w / 2 - 220), y: Math.round(tpl.h / 2) };
    if (type === "text") Object.assign(base, { text: "Seu texto aqui", size: 54 });
    if (type === "pill") Object.assign(base, { text: "Chama no direct", size: 40 });
    if (type === "photo") Object.assign(base, { w: 520, h: 520 });
    setExtras((p) => [...p, base]);
    setSel("extra:" + id);
  }
  function patchExtra(id, patch) {
    setExtras((p) => p.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  }
  function removeExtra(id) {
    setExtras((p) => p.filter((x) => x.id !== id));
    setImgs((p) => { const n = { ...p }; delete n["extra:" + id]; return n; });
    setSel(null);
  }

  // ── Download ──
  function download(i) {
    const c = refs.current[i];
    if (!c) return;
    const redraw = sel !== null;
    if (redraw) {
      // o outline de seleção não pode sair no PNG
      boxesRef.current[i] = renderSlide(c.getContext("2d"), tpl, i, { vals, imgs }, pos, extras, null);
    }
    const name = `leverads-${tpl.id}${tpl.slides > 1 ? `-${i + 1}de${tpl.slides}` : ""}.png`;
    c.toBlob((blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = name; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 3000);
      if (redraw) boxesRef.current[i] = renderSlide(c.getContext("2d"), tpl, i, { vals, imgs }, pos, extras, sel);
    }, "image/png");
  }
  async function downloadAll() {
    for (let i = 0; i < tpl.slides; i++) {
      download(i);
      // navegadores engasgam com downloads simultâneos; respiro entre eles
      await new Promise((r) => setTimeout(r, 400));
    }
  }

  const previewW = tpl.group === "story" ? 300 : 340;
  const kicker = { fontSize: 10, color: "var(--fg-4)", letterSpacing: "0.08em", textTransform: "uppercase" };
  const fieldStyle = { width: "100%", padding: "6px 9px", background: "var(--bg-1)", border: "1px solid var(--line-2)", borderRadius: "var(--r-2)", color: "var(--fg-1)", fontSize: 12.5, fontFamily: "inherit" };
  const smallBtn = { height: 24, padding: "0 9px", borderRadius: "var(--r-2)", border: "1px solid var(--line-2)", background: "var(--bg-2)", color: "var(--fg-2)", fontSize: 11 };

  // Campos agrupados por slide (carrossel) pra edição não virar uma lista cega.
  const fieldGroups = [];
  for (const f of tpl.fields) {
    const key = f.slide ? `Slide ${f.slide}` : (tpl.slides > 1 ? "Geral" : "Conteúdo");
    let g = fieldGroups.find((x) => x.key === key);
    if (!g) { g = { key, fields: [] }; fieldGroups.push(g); }
    g.fields.push(f);
  }
  const photoSlots = photoSlotsOf(tpl);
  const moved = Object.keys(pos).length > 0;

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
      <PageHead
        title="Estáticos"
        sub="criativos da marca pro Instagram · arraste os elementos no preview · baixe em PNG">
        {moved && (
          <button onClick={() => setPos({})} style={smallBtn} title="Voltar todos os elementos pra posição original do template">
            ↺ resetar posições
          </button>
        )}
        <button onClick={downloadAll}
          title={tpl.slides > 1 ? "Baixar os 4 slides em PNG (na ordem do carrossel)" : "Baixar o PNG na resolução de post"}
          style={{ height: 26, padding: "0 12px", borderRadius: "var(--r-2)", background: "var(--accent)", color: "var(--accent-fg)", fontSize: 12, fontWeight: 600 }}>
          ↓ baixar {tpl.slides > 1 ? `${tpl.slides} PNGs` : "PNG"}
        </button>
      </PageHead>

      <input ref={fileRef} type="file" accept="image/*" onChange={onFile} style={{ display: "none" }} />

      <div style={{ flex: 1, minHeight: 0, display: "flex", gap: 0 }}>
        {/* Galeria de templates */}
        <div style={{ width: 216, flexShrink: 0, borderRight: "1px solid var(--line-1)", overflowY: "auto", padding: "12px 10px" }}>
          {GROUPS.map(([gid, glabel]) => (
            <div key={gid} style={{ marginBottom: 14 }}>
              <div className="mono" style={{ ...kicker, padding: "0 6px", marginBottom: 6 }}>{glabel}</div>
              {TEMPLATES.filter((t) => t.group === gid).map((t) => {
                const on = t.id === tplId;
                return (
                  <button key={t.id} onClick={() => setTplId(t.id)}
                    style={{
                      display: "block", width: "100%", textAlign: "left", padding: "7px 9px", marginBottom: 2,
                      borderRadius: "var(--r-1)", fontSize: 12.5, fontWeight: on ? 600 : 500,
                      background: on ? "var(--accent-soft)" : "transparent",
                      color: on ? "var(--fg-1)" : "var(--fg-2)",
                    }}>
                    {t.name}
                    {photoSlotsOf(t).length > 0 && <span title="template com foto" style={{ marginLeft: 6 }}>📷</span>}
                  </button>
                );
              })}
            </div>
          ))}
          <div className="mono dim" style={{ fontSize: 10, lineHeight: 1.6, padding: "0 6px" }}>
            *palavra* = destaque em teal<br />
            arraste no preview pra mover<br />
            clique no slot pra pôr a foto
          </div>
        </div>

        {/* Preview */}
        <div style={{ flex: 1, minWidth: 0, overflow: "auto", padding: 18, background: "var(--bg-inset)" }}>
          {!ready && <div className="mono dim" style={{ fontSize: 12 }}>carregando fontes da marca…</div>}
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "flex-start" }}>
            {Array.from({ length: tpl.slides }, (_, i) => (
              <div key={tpl.id + i} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <canvas ref={(el) => { refs.current[i] = el; }}
                  onPointerDown={(e) => onDown(e, i)}
                  onPointerMove={(e) => onMove(e, i)}
                  onPointerUp={() => onUp()}
                  style={{ width: previewW, height: Math.round(previewW * tpl.h / tpl.w), borderRadius: 10, boxShadow: "var(--shadow-2)", background: "#0b1620", cursor: "grab", touchAction: "none" }} />
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span className="mono dim" style={{ fontSize: 10.5 }}>
                    {tpl.slides > 1 ? `slide ${i + 1}/${tpl.slides}` : `${tpl.w}×${tpl.h}`}
                  </span>
                  <button onClick={() => download(i)} className="mono"
                    style={{ fontSize: 10.5, color: "var(--accent)", padding: "2px 6px" }}>↓ png</button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Painel de edição */}
        <div style={{ width: 320, flexShrink: 0, borderLeft: "1px solid var(--line-1)", overflowY: "auto", padding: "12px 14px" }}>
          <div className="mono" style={{ ...kicker, marginBottom: 10 }}>Texto do criativo</div>
          {fieldGroups.map((g) => (
            <div key={g.key} style={{ marginBottom: 14 }}>
              {fieldGroups.length > 1 && (
                <div className="mono" style={{ ...kicker, color: "var(--accent)", marginBottom: 6 }}>{g.key}</div>
              )}
              {g.fields.map((f) => (
                <label key={f.k} style={{ display: "block", marginBottom: 8 }}>
                  <span className="mono" style={{ ...kicker, display: "block", marginBottom: 3 }}>{f.label}</span>
                  {f.type === "textarea" ? (
                    <textarea rows={3} value={vals[f.k] ?? ""} onChange={(e) => setVals((p) => ({ ...p, [f.k]: e.target.value }))}
                      style={{ ...fieldStyle, resize: "vertical", lineHeight: 1.4 }} />
                  ) : (
                    <input type="text" value={vals[f.k] ?? ""} onChange={(e) => setVals((p) => ({ ...p, [f.k]: e.target.value }))}
                      style={fieldStyle} />
                  )}
                </label>
              ))}
            </div>
          ))}

          {photoSlots.length > 0 && (
            <div style={{ marginBottom: 14, paddingTop: 10, borderTop: "1px solid var(--line-1)" }}>
              <div className="mono" style={{ ...kicker, marginBottom: 8 }}>Fotos do template</div>
              {photoSlots.map((s) => (
                <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  <span className="mono dim" style={{ fontSize: 11, flex: 1 }}>
                    {s.id}{s.slide && s.slide !== "all" ? ` · slide ${s.slide}` : ""}
                  </span>
                  <button onClick={() => openPhoto(s.id)} style={smallBtn}>{imgs[s.id] ? "trocar" : "escolher…"}</button>
                  {imgs[s.id] && (
                    <button onClick={() => setImgs((p) => { const n = { ...p }; delete n[s.id]; return n; })}
                      style={{ ...smallBtn, color: "var(--neg)" }}>tirar</button>
                  )}
                </div>
              ))}
            </div>
          )}

          <div style={{ marginBottom: 14, paddingTop: 10, borderTop: "1px solid var(--line-1)" }}>
            <div className="mono" style={{ ...kicker, marginBottom: 8 }}>Adicionar elemento</div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              <button onClick={() => addExtra("text")} style={smallBtn}>＋ texto</button>
              <button onClick={() => addExtra("pill")} style={smallBtn}>＋ botão</button>
              <button onClick={() => addExtra("photo")} style={smallBtn}>＋ foto</button>
              {tpl.slides > 1 && (
                <select value={addSlide} onChange={(e) => setAddSlide(Number(e.target.value))}
                  title="Em qual slide o elemento novo entra"
                  style={{ height: 24, padding: "0 6px", borderRadius: "var(--r-2)", border: "1px solid var(--line-2)", background: "var(--bg-1)", color: "var(--fg-2)", fontSize: 11 }}>
                  {Array.from({ length: tpl.slides }, (_, i) => <option key={i} value={i + 1}>slide {i + 1}</option>)}
                </select>
              )}
            </div>
            {extras.map((ex) => (
              <div key={ex.id} style={{
                marginTop: 8, padding: "7px 9px", borderRadius: "var(--r-2)",
                border: "1px solid " + (sel === "extra:" + ex.id ? "var(--accent-line)" : "var(--line-1)"),
                background: "var(--bg-inset)",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: ex.type === "photo" ? 0 : 6 }}>
                  <span className="mono" style={{ ...kicker }}>
                    {ex.type === "pill" ? "botão" : ex.type === "photo" ? "foto" : "texto"}{tpl.slides > 1 ? ` · slide ${ex.slide}` : ""}
                  </span>
                  {ex.type === "photo" && (
                    <button onClick={() => openPhoto("extra:" + ex.id)} style={{ ...smallBtn, marginLeft: "auto" }}>
                      {imgs["extra:" + ex.id] ? "trocar" : "escolher…"}
                    </button>
                  )}
                  <button onClick={() => removeExtra(ex.id)}
                    style={{ ...smallBtn, marginLeft: ex.type === "photo" ? 0 : "auto", color: "var(--neg)" }}>✕</button>
                </div>
                {ex.type !== "photo" && (
                  <div style={{ display: "flex", gap: 6 }}>
                    <input type="text" value={ex.text} onChange={(e) => patchExtra(ex.id, { text: e.target.value })}
                      style={{ ...fieldStyle, flex: 1 }} />
                    <input type="number" min="20" max="300" value={ex.size} title="tamanho da fonte"
                      onChange={(e) => patchExtra(ex.id, { size: Number(e.target.value) || 54 })}
                      style={{ ...fieldStyle, width: 64 }} />
                  </div>
                )}
              </div>
            ))}
          </div>

          <button onClick={() => { setVals(defaultsOf(tpl)); setPos({}); setExtras([]); setSel(null); }}
            className="mono dim" style={{ fontSize: 11 }}>
            ↺ voltar pro exemplo do template
          </button>
        </div>
      </div>
    </div>
  );
}

export { CreativeScreen, TEMPLATES, renderSlide };
