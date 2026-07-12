import React from "react";
import { PageHead } from "../components/viz.jsx";

// Estáticos — gerador de criativos da marca pro Instagram, direto no cockpit.
// 9 templates fixos (3 stories 1080×1920 · 3 posts de feed 1080×1350 · 3
// carrosséis de 4 slides 1080×1350), todos com a identidade LeverAds das
// superfícies públicas (proposta/form): navy #051C2C em gradiente, teal
// #23D8D3, Space Grotesk + JetBrains Mono. O texto é editável no painel ao
// lado, `*palavra*` vira destaque em teal, e o download sai em PNG na
// resolução nativa (canvas 2D puro, sem lib externa — a fonte vem do Google
// Fonts e o logo é o SVG inline da sidebar virando data-URI, nada de asset
// remoto que suje o canvas).

const { useState: useS, useEffect: useE, useRef: useR } = React;

// ── Marca ────────────────────────────────────────────────────────────────────
const B = {
  navy: "#051C2C",
  grad: ["#073143", "#051C2C", "#03141D"], // mesmo gradiente da proposta
  ice: "#F3FBFF",
  iceSoft: "rgba(243,251,255,0.72)",
  iceDim: "rgba(243,251,255,0.45)",
  teal: "#23D8D3",        // teal do logo — brilha no navy
  tealDeep: "#0C8F83",    // teal legível sobre fundo claro
  light: "#F3FBFF",
  navySoft: "rgba(5,28,44,0.72)",
  navyDim: "rgba(5,28,44,0.45)",
};
const FD = "'Space Grotesk'";
const FM = "'JetBrains Mono'";
const FONTS_HREF = "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap";

// Ícone oficial (mesmos paths do logo da sidebar). `main` = cor do círculo:
// ice no fundo escuro, navy no claro; o raio teal é fixo.
const iconSvg = (main) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="291" height="299" viewBox="0 0 1453.13 1493.95">` +
  `<path fill="${main}" d="M519.22,843.75l-45.1,15.11c53.94,77.43,143.68,128.2,245.06,128.2,4.38,0,8.76-.08,13.07-.3l-14.13-45.02c-80.76-.3-152.75-38.68-198.9-97.98ZM719.19,390.03c-164.61,0-298.55,133.94-298.55,298.55,0,29.46,4.31,58.02,12.31,84.91l39.13-29.31c-4-17.9-6.12-36.49-6.12-55.6,0-139.6,113.62-253.22,253.22-253.22s253.15,113.62,253.15,253.22c0,99.49-57.71,185.84-141.42,227.16v49.63c109.39-44.27,186.74-151.69,186.74-276.79,0-164.61-133.86-298.55-298.47-298.55Z"/>` +
  `<polygon fill="#23D8D3" points="800.7 535.53 800.7 1103.92 763 983.8 749.25 939.91 691.16 754.61 501.54 817.84 457.65 832.42 362.47 864.14 443.6 803.33 481.22 775.08 800.7 535.53"/></svg>`;

const ASSETS = { iconIce: null, iconNavy: null };

function loadImg(svg) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = "data:image/svg+xml;utf8," + encodeURIComponent(svg);
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
    [ASSETS.iconIce, ASSETS.iconNavy] = await Promise.all([
      loadImg(iconSvg(B.ice)), loadImg(iconSvg(B.navy)),
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

// ── Primitivas de desenho ────────────────────────────────────────────────────
function bg(ctx, W, H, mode) {
  if (mode === "dark") {
    const g = ctx.createLinearGradient(0, 0, W * 0.55, H);
    g.addColorStop(0, B.grad[0]); g.addColorStop(0.52, B.grad[1]); g.addColorStop(1, B.grad[2]);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    const glow = ctx.createRadialGradient(W * 0.88, H * 0.08, 0, W * 0.88, H * 0.08, W * 0.75);
    glow.addColorStop(0, "rgba(35,216,211,0.14)"); glow.addColorStop(1, "rgba(35,216,211,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);
  } else {
    ctx.fillStyle = B.light;
    ctx.fillRect(0, 0, W, H);
    const glow = ctx.createRadialGradient(W * 0.9, H * 0.05, 0, W * 0.9, H * 0.05, W * 0.7);
    glow.addColorStop(0, "rgba(35,216,211,0.16)"); glow.addColorStop(1, "rgba(35,216,211,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);
  }
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

// Logo: ícone + wordmark "LeverAds". Retorna o x final (pra alinhar coisas ao lado).
function logoRow(ctx, x, y, h, mode, wordmark = true) {
  const icon = mode === "dark" ? ASSETS.iconIce : ASSETS.iconNavy;
  const w = h * 0.973;
  if (icon) ctx.drawImage(icon, x - h * 0.16, y, w, h); // o desenho tem respiro no viewBox
  let xx = x + w * 0.78;
  if (wordmark) {
    ctx.font = `700 ${Math.round(h * 0.42)}px ${FD}`;
    ctx.fillStyle = mode === "dark" ? B.ice : B.navy;
    ctx.textBaseline = "middle";
    ctx.fillText("LeverAds", xx, y + h * 0.52);
    xx += ctx.measureText("LeverAds").width;
    ctx.textBaseline = "alphabetic";
  }
  return xx;
}

// Kicker mono uppercase com o ponto teal na frente (o .eyebrow da proposta).
function eyebrow(ctx, text, x, y, mode, size = 30) {
  if (!text) return y;
  const accent = mode === "dark" ? B.teal : B.tealDeep;
  ctx.fillStyle = accent;
  ctx.beginPath(); ctx.arc(x + size * 0.22, y - size * 0.32, size * 0.16, 0, Math.PI * 2); ctx.fill();
  ctx.font = `600 ${size}px ${FM}`;
  ctx.letterSpacing = `${Math.round(size * 0.18)}px`;
  ctx.fillText(String(text).toUpperCase(), x + size * 0.75, y);
  ctx.letterSpacing = "0px";
  return y;
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

// Texto com wrap, destaque teal e quebra manual por \n. Retorna o y do fim do bloco.
function rich(ctx, text, x, y, maxW, o) {
  const size = o.size, lh = o.lineH || Math.round(size * 1.16);
  ctx.font = `${o.weight || 700} ${size}px ${o.font || FD}`;
  const space = ctx.measureText(" ").width;
  const lines = [];
  for (const para of String(text || "").split("\n")) {
    let line = [], w = 0;
    for (const t of richTokens(para)) {
      const tw = ctx.measureText(t.w).width;
      if (line.length && w + space + tw > maxW) { lines.push({ line, w }); line = [t]; w = tw; }
      else { w += (line.length ? space : 0) + tw; line.push(t); }
    }
    lines.push({ line, w });
  }
  let base = y + size;
  for (const L of lines) {
    let xx = o.align === "center" ? x + (maxW - L.w) / 2 : x;
    for (const t of L.line) {
      ctx.fillStyle = t.hl ? o.hl : o.color;
      ctx.fillText(t.w, xx, base);
      xx += ctx.measureText(t.w).width + space;
    }
    base += lh;
  }
  return base - lh; // baseline da última linha
}

// Pílula de CTA (teal, texto navy). Retorna a largura desenhada.
function pill(ctx, text, x, y, size = 40) {
  if (!text) return 0;
  ctx.font = `600 ${size}px ${FD}`;
  const tw = ctx.measureText(text).width;
  const h = Math.round(size * 2.1), w = tw + size * 2.2;
  ctx.fillStyle = B.teal;
  rr(ctx, x, y, w, h, h / 2);
  ctx.fill();
  ctx.fillStyle = B.navy;
  ctx.fillText(text, x + size * 1.1, y + h / 2 + size * 0.36);
  return w;
}

function handleLine(ctx, text, x, y, mode, align = "left", size = 30) {
  if (!text) return;
  ctx.font = `500 ${size}px ${FM}`;
  ctx.fillStyle = mode === "dark" ? B.iceDim : B.navyDim;
  const prev = ctx.textAlign;
  ctx.textAlign = align;
  ctx.fillText(text, x, y);
  ctx.textAlign = prev;
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

function arrowHint(ctx, W, H, M, text = "arrasta →") {
  ctx.font = `600 32px ${FM}`;
  ctx.fillStyle = B.teal;
  ctx.textAlign = "right";
  ctx.fillText(text, W - M, H - 78);
  ctx.textAlign = "left";
}

// Chrome comum dos slides de carrossel: logo pequeno, handle, dots e a seta.
function carChrome(ctx, W, H, M, v, i, n, { arrow = true } = {}) {
  logoRow(ctx, M, 88, 64, "dark");
  handleLine(ctx, v.handle, M, H - 78, "dark");
  pageDots(ctx, W, H - 86, i, n);
  if (arrow && i < n - 1) arrowHint(ctx, W, H, M);
}

// ── Templates ────────────────────────────────────────────────────────────────
// Cada template: dimensões, campos editáveis (def = copy de exemplo já na voz
// da marca) e draw(ctx, v, slide). `*palavra*` = destaque teal.

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
    draw(ctx, v) {
      const W = 1080, H = 1920, M = 110;
      bg(ctx, W, H, "dark");
      logoRow(ctx, M, 150, 88, "dark");
      eyebrow(ctx, v.eyebrow, M, 620, "dark", 32);
      const yT = rich(ctx, v.title, M, 668, W - 2 * M, { size: 104, weight: 700, color: B.ice, hl: B.teal, lineH: 118 });
      rich(ctx, v.body, M, yT + 56, W - 2 * M, { size: 44, weight: 500, color: B.iceSoft, lineH: 62 });
      pill(ctx, v.cta, M, 1590, 44);
      handleLine(ctx, v.handle, W / 2, 1830, "dark", "center");
    },
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
    draw(ctx, v) {
      const W = 1080, H = 1920, M = 110;
      bg(ctx, W, H, "dark");
      logoRow(ctx, M, 150, 88, "dark");
      eyebrow(ctx, v.eyebrow, M, 480, "dark", 32);
      const yT = rich(ctx, v.title, M, 528, W - 2 * M, { size: 88, weight: 700, color: B.ice, hl: B.teal, lineH: 102 });
      let y = yT + 90;
      for (const it of [v.item1, v.item2, v.item3, v.item4]) {
        if (!it || !it.trim()) continue;
        ctx.fillStyle = B.teal;
        rr(ctx, M, y, 58, 58, 14); ctx.fill();
        ctx.fillStyle = B.navy;
        ctx.font = `700 38px ${FD}`;
        ctx.fillText("✓", M + 15, y + 42);
        rich(ctx, it, M + 88, y - 4, W - 2 * M - 88, { size: 44, weight: 600, color: B.ice, hl: B.teal, lineH: 56 });
        y += 132;
      }
      pill(ctx, v.cta, M, 1590, 44);
      handleLine(ctx, v.handle, W / 2, 1830, "dark", "center");
    },
  },
  {
    id: "story-numero", group: "story", name: "Número (claro)", w: 1080, h: 1920, slides: 1,
    fields: [
      { k: "eyebrow", label: "Kicker", def: "Case real" },
      { k: "stat", label: "Número", def: "+105%" },
      { k: "label", label: "O que é o número", def: "em vendas brutas no 1º mês" },
      { k: "body", label: "Texto", type: "textarea", def: "Conta nova clonada da conta-mãe. Prints reais do painel do Mercado Livre." },
      { k: "cta", label: "CTA", def: "Quero esse resultado" },
      { k: "handle", label: "Rodapé", def: "@lever.ads" },
    ],
    draw(ctx, v) {
      const W = 1080, H = 1920, M = 110;
      bg(ctx, W, H, "light");
      logoRow(ctx, M, 150, 88, "light");
      eyebrow(ctx, v.eyebrow, M, 600, "light", 32);
      const yS = rich(ctx, v.stat, M, 660, W - 2 * M, { size: 250, weight: 700, color: B.navy, hl: B.tealDeep, lineH: 260 });
      ctx.fillStyle = B.teal;
      rr(ctx, M, yS + 44, 220, 16, 8); ctx.fill();
      const yL = rich(ctx, v.label, M, yS + 110, W - 2 * M, { size: 56, weight: 600, color: B.navy, hl: B.tealDeep, lineH: 68 });
      rich(ctx, v.body, M, yL + 52, W - 2 * M, { size: 42, weight: 500, color: B.navySoft, lineH: 58 });
      pill(ctx, v.cta, M, 1590, 44);
      handleLine(ctx, v.handle, W / 2, 1830, "light", "center");
    },
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
    draw(ctx, v) {
      const W = 1080, H = 1350, M = 100;
      bg(ctx, W, H, "dark");
      logoRow(ctx, M, 110, 72, "dark");
      eyebrow(ctx, v.eyebrow, M, 400, "dark", 30);
      const yT = rich(ctx, v.title, M, 446, W - 2 * M, { size: 88, weight: 700, color: B.ice, hl: B.teal, lineH: 100 });
      rich(ctx, v.body, M, yT + 48, W - 2 * M, { size: 40, weight: 500, color: B.iceSoft, lineH: 56 });
      pill(ctx, v.cta, M, 1130, 40);
      handleLine(ctx, v.handle, W - M, 1188, "dark", "right");
    },
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
    draw(ctx, v) {
      const W = 1080, H = 1350, M = 100;
      bg(ctx, W, H, "dark");
      logoRow(ctx, M, 110, 72, "dark");
      eyebrow(ctx, v.eyebrow, M, 420, "dark", 30);
      const yS = rich(ctx, v.stat, M, 470, W - 2 * M, { size: 240, weight: 700, color: B.teal, hl: B.ice, lineH: 250 });
      const yL = rich(ctx, v.label, M, yS + 70, W - 2 * M, { size: 54, weight: 600, color: B.ice, hl: B.teal, lineH: 66 });
      rich(ctx, v.body, M, yL + 44, W - 2 * M, { size: 40, weight: 500, color: B.iceSoft, lineH: 56 });
      handleLine(ctx, v.handle, W / 2, 1270, "dark", "center");
    },
  },
  {
    id: "post-frase", group: "post", name: "Frase (claro)", w: 1080, h: 1350, slides: 1,
    fields: [
      { k: "title", label: "Frase", type: "textarea", def: "Anúncio parado em conta parada é *venda que já era sua* indo pro concorrente." },
      { k: "author", label: "Assinatura", def: "Leo · LeverAds" },
      { k: "handle", label: "Rodapé", def: "@lever.ads" },
    ],
    draw(ctx, v) {
      const W = 1080, H = 1350, M = 100;
      bg(ctx, W, H, "light");
      logoRow(ctx, M, 110, 72, "light");
      ctx.font = `700 300px ${FD}`;
      ctx.fillStyle = B.teal;
      ctx.fillText("“", M - 12, 560);
      const yT = rich(ctx, v.title, M, 560, W - 2 * M, { size: 74, weight: 600, color: B.navy, hl: B.tealDeep, lineH: 92 });
      ctx.fillStyle = B.teal;
      rr(ctx, M, yT + 60, 120, 12, 6); ctx.fill();
      ctx.font = `500 34px ${FM}`;
      ctx.fillStyle = B.navySoft;
      ctx.fillText(v.author || "", M, yT + 128);
      handleLine(ctx, v.handle, W - M, 1270, "light", "right");
    },
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
    draw(ctx, v, i) {
      const W = 1080, H = 1350, M = 100;
      bg(ctx, W, H, "dark");
      if (i === 0) {
        eyebrow(ctx, v.s1_eyebrow, M, 520, "dark", 30);
        rich(ctx, v.s1_title, M, 568, W - 2 * M, { size: 92, weight: 700, color: B.ice, hl: B.teal, lineH: 106 });
      } else if (i === 3) {
        const yT = rich(ctx, v.s4_title, M, 480, W - 2 * M, { size: 88, weight: 700, color: B.ice, hl: B.teal, lineH: 102 });
        pill(ctx, v.s4_cta, M, yT + 80, 42);
      } else {
        const k = i === 1 ? v.s2_kicker : v.s3_kicker;
        const t = i === 1 ? v.s2_title : v.s3_title;
        const b = i === 1 ? v.s2_body : v.s3_body;
        eyebrow(ctx, k, M, 420, "dark", 30);
        const yT = rich(ctx, t, M, 468, W - 2 * M, { size: 78, weight: 700, color: B.ice, hl: B.teal, lineH: 90 });
        rich(ctx, b, M, yT + 46, W - 2 * M, { size: 42, weight: 500, color: B.iceSoft, lineH: 60 });
      }
      carChrome(ctx, W, H, M, v, i, 4);
    },
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
    draw(ctx, v, i) {
      const W = 1080, H = 1350, M = 100;
      bg(ctx, W, H, "dark");
      if (i === 0) {
        eyebrow(ctx, v.s1_eyebrow, M, 520, "dark", 30);
        rich(ctx, v.s1_title, M, 568, W - 2 * M, { size: 92, weight: 700, color: B.ice, hl: B.teal, lineH: 106 });
      } else {
        const t = [null, v.s2_title, v.s3_title, v.s4_title][i];
        const b = [null, v.s2_body, v.s3_body, v.s4_body][i];
        ctx.font = `700 190px ${FD}`;
        ctx.fillStyle = B.teal;
        ctx.fillText(`0${i}`, M, 480);
        const yT = rich(ctx, t, M, 540, W - 2 * M, { size: 76, weight: 700, color: B.ice, hl: B.teal, lineH: 88 });
        rich(ctx, b, M, yT + 44, W - 2 * M, { size: 42, weight: 500, color: B.iceSoft, lineH: 60 });
        if (i === 3 && v.s4_cta) {
          ctx.font = `600 34px ${FM}`;
          ctx.fillStyle = B.teal;
          ctx.fillText(v.s4_cta, M, H - 150);
        }
      }
      carChrome(ctx, W, H, M, v, i, 4);
    },
  },
  {
    id: "car-case", group: "car", name: "Case", w: 1080, h: 1350, slides: 4,
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
    draw(ctx, v, i) {
      const W = 1080, H = 1350, M = 100;
      if (i === 1) {
        bg(ctx, W, H, "light");
        logoRow(ctx, M, 88, 64, "light");
        let y = 340;
        for (const [st, lb] of [[v.s2_stat1, v.s2_label1], [v.s2_stat2, v.s2_label2], [v.s2_stat3, v.s2_label3]]) {
          if (!st) continue;
          const yS = rich(ctx, st, M, y, W - 2 * M, { size: 130, weight: 700, color: B.tealDeep, hl: B.navy, lineH: 140 });
          rich(ctx, lb, M, yS + 18, W - 2 * M, { size: 42, weight: 600, color: B.navySoft, lineH: 52 });
          y = yS + 130;
        }
        handleLine(ctx, v.handle, M, H - 78, "light");
        pageDots(ctx, W, H - 86, i, 4);
        arrowHint(ctx, W, H, M);
        return;
      }
      bg(ctx, W, H, "dark");
      if (i === 0) {
        eyebrow(ctx, v.s1_eyebrow, M, 520, "dark", 30);
        rich(ctx, v.s1_title, M, 568, W - 2 * M, { size: 92, weight: 700, color: B.ice, hl: B.teal, lineH: 106 });
      } else if (i === 2) {
        eyebrow(ctx, v.s3_kicker, M, 420, "dark", 30);
        const yT = rich(ctx, v.s3_title, M, 468, W - 2 * M, { size: 78, weight: 700, color: B.ice, hl: B.teal, lineH: 90 });
        rich(ctx, v.s3_body, M, yT + 46, W - 2 * M, { size: 42, weight: 500, color: B.iceSoft, lineH: 60 });
      } else {
        const yT = rich(ctx, v.s4_title, M, 480, W - 2 * M, { size: 88, weight: 700, color: B.ice, hl: B.teal, lineH: 102 });
        pill(ctx, v.s4_cta, M, yT + 80, 42);
      }
      carChrome(ctx, W, H, M, v, i, 4);
    },
  },
];

const GROUPS = [
  ["story", "Stories · 1080×1920"],
  ["post", "Post fixo · 1080×1350"],
  ["car", "Carrossel · 4 slides"],
];

const defaultsOf = (tpl) => Object.fromEntries(tpl.fields.map((f) => [f.k, f.def]));

// ── Tela ─────────────────────────────────────────────────────────────────────
function CreativeScreen() {
  const [tplId, setTplId] = useS(TEMPLATES[0].id);
  const tpl = TEMPLATES.find((t) => t.id === tplId) || TEMPLATES[0];
  const [vals, setVals] = useS(() => defaultsOf(TEMPLATES[0]));
  const [ready, setReady] = useS(false);
  const refs = useR([]);

  useE(() => { let ok = true; loadAssets().then(() => ok && setReady(true)); return () => { ok = false; }; }, []);
  useE(() => { setVals(defaultsOf(tpl)); }, [tplId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Redesenha os canvases (resolução nativa; o CSS só encolhe a exibição).
  useE(() => {
    if (!ready) return;
    for (let i = 0; i < tpl.slides; i++) {
      const c = refs.current[i];
      if (!c) continue;
      c.width = tpl.w; c.height = tpl.h;
      const ctx = c.getContext("2d");
      ctx.textBaseline = "alphabetic";
      tpl.draw(ctx, vals, i);
    }
  }, [ready, tpl, vals]);

  function download(i) {
    const c = refs.current[i];
    if (!c) return;
    const name = `leverads-${tpl.id}${tpl.slides > 1 ? `-${i + 1}de${tpl.slides}` : ""}.png`;
    c.toBlob((blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = name; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 3000);
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

  // Campos agrupados por slide (carrossel) pra edição não virar uma lista cega.
  const fieldGroups = [];
  for (const f of tpl.fields) {
    const key = f.slide ? `Slide ${f.slide}` : (tpl.slides > 1 ? "Geral" : "Conteúdo");
    let g = fieldGroups.find((x) => x.key === key);
    if (!g) { g = { key, fields: [] }; fieldGroups.push(g); }
    g.fields.push(f);
  }

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
      <PageHead
        title="Estáticos"
        sub="criativos da marca pro Instagram · edite o texto e baixe em PNG">
        <button onClick={downloadAll}
          title={tpl.slides > 1 ? "Baixar os 4 slides em PNG (na ordem do carrossel)" : "Baixar o PNG na resolução de post"}
          style={{ height: 26, padding: "0 12px", borderRadius: "var(--r-2)", background: "var(--accent)", color: "var(--accent-fg)", fontSize: 12, fontWeight: 600 }}>
          ↓ baixar {tpl.slides > 1 ? `${tpl.slides} PNGs` : "PNG"}
        </button>
      </PageHead>

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
                    {t.slides > 1 && <span className="mono dim" style={{ fontSize: 10, marginLeft: 6 }}>×{t.slides}</span>}
                  </button>
                );
              })}
            </div>
          ))}
          <div className="mono dim" style={{ fontSize: 10, lineHeight: 1.5, padding: "0 6px" }}>
            *palavra* entre asteriscos vira destaque em teal
          </div>
        </div>

        {/* Preview */}
        <div style={{ flex: 1, minWidth: 0, overflow: "auto", padding: 18, background: "var(--bg-inset)" }}>
          {!ready && <div className="mono dim" style={{ fontSize: 12 }}>carregando fontes da marca…</div>}
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "flex-start" }}>
            {Array.from({ length: tpl.slides }, (_, i) => (
              <div key={tpl.id + i} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <canvas ref={(el) => { refs.current[i] = el; }}
                  style={{ width: previewW, height: Math.round(previewW * tpl.h / tpl.w), borderRadius: 10, boxShadow: "var(--shadow-2)", background: "#0b1620" }} />
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

        {/* Campos */}
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
          <button onClick={() => setVals(defaultsOf(tpl))} className="mono dim" style={{ fontSize: 11 }}>
            ↺ voltar pro texto de exemplo
          </button>
        </div>
      </div>
    </div>
  );
}

export { CreativeScreen, TEMPLATES };
