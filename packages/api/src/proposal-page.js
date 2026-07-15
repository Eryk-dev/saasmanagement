// Página pública da proposta (/p/:id) — HTML standalone servido pela API.
// Port do design da proposta comercial do Levercopy (proposta.html, handoff
// Lever Talents), parametrizado pelos MESMOS 8 tokens de tema do form builder.
//
// Slides estruturados (window.__PROPOSAL__.slides) renderizados no cliente:
//   hero · cards · receipt · steps · compare · bignum · pricing · closer · custom
// Trava magnética por slide (desktop >=900px, respeita prefers-reduced-motion),
// reveal animations, CSS de print (PDF via imprimir), interpolação
// {{lead.x}}/{{answers.x}}/{{calc.x}}/{{state.x}} + *palavra* em itálico.
// Valores de calc/state viram <span data-fill> e o painel do closer (?k=token)
// recalcula ao vivo — mesmo mecanismo da referência.
//
// REGRA DO ARQUIVO: o HTML inteiro é UM template literal — nada de crase dentro
// do script/comentários internos; o script do cliente usa concatenação.

const escJson = (obj) => JSON.stringify(obj).replace(/</g, "\\u003c");
const escAttr = (s) => String(s).replace(/"/g, "&quot;").replace(/</g, "&lt;");

const fontHref = (font) => {
  const fam = String(font || "").split(",")[0].trim().replace(/^['"]|['"]$/g, "") || "Space Grotesk";
  const enc = encodeURIComponent(fam).replace(/%20/g, "+");
  return `https://fonts.googleapis.com/css2?family=${enc}:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap`;
};

export function proposalPageHtml(p, { previewBanner = false } = {}) {
  const t = p.theme || {};
  const bg = t.bg || "#0f1115";
  const fg = t.fg || "#f2f3f5";
  const accent = t.accent || "#6c5ce7";
  const accentFg = t.accentFg || "#ffffff";
  const font = t.font || "'Space Grotesk', system-ui, sans-serif";
  const radius = t.radius != null ? Number(t.radius) : 14;
  // Teto alto (igual ao form) pra a logo poder crescer; a nav cresce junto (navH).
  const logoH = Math.min(240, Math.max(12, Number(t.logoHeight) || 24));
  const navH = Math.max(60, logoH + 28);
  const brandName = t.brandName ? escAttr(t.brandName) : "";
  const brandSize = Math.max(15, Math.round(logoH * 0.34));
  const logoImg = t.logoUrl ? `<img class="nav-logo" src="${escAttr(t.logoUrl)}" alt="">` : "";
  // Lockup da marca: ícone + nome ao lado (ex.: LeverAds). Só ícone se não houver
  // nome; sem nenhum dos dois, cai no nome do documento.
  const navBrand = (logoImg || brandName)
    ? `<span class="nav-lockup">${logoImg}${brandName ? `<span class="nav-brand">${brandName}</span>` : ""}</span>`
    : `<span class="nav-brand">${String(p.name || "Proposta").replace(/</g, "&lt;")}</span>`;

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${String(p.name || "Proposta").replace(/</g, "&lt;")}</title>
<meta name="robots" content="noindex,nofollow">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="${fontHref(font)}" rel="stylesheet">
<style>
  :root {
    --bg: ${bg}; --fg: ${fg}; --accent: ${accent}; --accent-fg: ${accentFg};
    --radius: ${radius}px; --r-full: 999px;
    --font-display: ${font};
    --font-mono: 'JetBrains Mono', ui-monospace, monospace;
    --ink-2: color-mix(in oklab, var(--fg) 78%, transparent);
    --ink-3: color-mix(in oklab, var(--fg) 60%, transparent);
    --ink-4: color-mix(in oklab, var(--fg) 42%, transparent);
    --line: color-mix(in oklab, var(--fg) 9%, transparent);
    --raised: color-mix(in oklab, var(--fg) 4%, transparent);
    --accent-soft: color-mix(in oklab, var(--accent) 12%, transparent);
    --accent-line: color-mix(in oklab, var(--accent) 28%, transparent);
    --glow: 0 0 0 4px color-mix(in oklab, var(--accent) 18%, transparent);
    --error: #ff6b6b;
    --ease-out: cubic-bezier(0.2, 0.8, 0.2, 1);
  }
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  html { scroll-behavior: smooth; }
  body { font-family: var(--font-display); background: var(--bg); color: var(--fg);
    -webkit-font-smoothing: antialiased; min-height: 100vh; line-height: 1.5; overflow-x: hidden; }
  img { max-width: 100%; display: block; }
  a { color: inherit; text-decoration: none; }
  button { font: inherit; color: inherit; background: none; border: 0; cursor: pointer; }
  ::selection { background: var(--accent); color: var(--accent-fg); }

  .wrap { width: 100%; max-width: 1200px; margin: 0 auto; padding: 0 24px; }
  section, header.hero { padding: 80px 0; position: relative; }
  @media (min-width: 768px) { section, header.hero { padding: 128px 0; } .wrap { padding: 0 40px; } }
  .atmos { position: absolute; inset: 0; pointer-events: none; z-index: 0;
    background: radial-gradient(ellipse 80% 60% at 90% 0%, color-mix(in oklab, var(--accent) 10%, transparent) 0%, transparent 60%),
      radial-gradient(ellipse 60% 50% at 0% 100%, color-mix(in oklab, var(--accent) 5%, transparent) 0%, transparent 60%); }
  section > .wrap, header.hero > .wrap { position: relative; z-index: 1; }

  /* Bloco escuro (ritmo claro/escuro da home). Redefinir --bg/--fg faz TODOS os
     tokens derivados (--ink-*, --line, --raised) virarem light-on-dark sozinhos.
     Mesmo tratamento do login/home: gradiente navy + glow teal + textura de grade. */
  .sec-dark { --bg: #051C2C; --fg: #F3FBFF;
    --ink-2: color-mix(in oklab, #F3FBFF 78%, transparent);
    --ink-3: color-mix(in oklab, #F3FBFF 60%, transparent);
    --ink-4: color-mix(in oklab, #F3FBFF 42%, transparent);
    --line: color-mix(in oklab, #F3FBFF 12%, transparent);
    --raised: color-mix(in oklab, #F3FBFF 6%, transparent);
    color: var(--fg);
    background:
      radial-gradient(120% 80% at 88% -5%, color-mix(in oklab, var(--accent) 20%, transparent) 0%, transparent 52%),
      radial-gradient(110% 90% at -10% 110%, color-mix(in oklab, var(--accent) 10%, transparent) 0%, transparent 55%),
      linear-gradient(155deg, #073143 0%, #051C2C 52%, #03141D 100%); }
  .sec-dark::before { content: ''; position: absolute; inset: 0; pointer-events: none; z-index: 0;
    background-image: linear-gradient(rgba(255,255,255,.025) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.025) 1px, transparent 1px);
    background-size: 44px 44px;
    -webkit-mask-image: radial-gradient(80% 70% at 50% 30%, #000 0%, transparent 82%);
    mask-image: radial-gradient(80% 70% at 50% 30%, #000 0%, transparent 82%); }

  .eyebrow { display: inline-flex; align-items: center; gap: 12px; font-family: var(--font-mono); font-size: 13px;
    color: var(--accent); letter-spacing: .12em; text-transform: uppercase; margin-bottom: 24px; font-weight: 500; }
  .eyebrow::before { content: ''; width: 8px; height: 8px; border-radius: var(--r-full); background: var(--accent); box-shadow: 0 0 0 5px var(--accent-soft); flex-shrink: 0; }
  h1, h2, h3 { font-family: var(--font-display); font-weight: 500; letter-spacing: -.025em; text-wrap: balance; line-height: 1.05; }
  .h-hero { font-size: clamp(40px, 9vw, 96px); line-height: .98; letter-spacing: -.03em; }
  .h-section { font-size: clamp(32px, 6vw, 64px); line-height: 1.02; }
  em { font-style: normal; font-weight: 600;
    background: linear-gradient(135deg, var(--accent) 0%, color-mix(in oklab, var(--accent) 66%, #06302e) 100%);
    -webkit-background-clip: text; background-clip: text; color: transparent; -webkit-text-fill-color: transparent; }
  .lead { font-size: clamp(18px, 2.3vw, 24px); line-height: 1.45; color: var(--ink-2); max-width: 680px; font-weight: 300; }
  .body { font-size: 17px; line-height: 1.6; color: var(--ink-2); }
  @media (min-width: 768px) { .body { font-size: 19px; } }
  .mono { font-family: var(--font-mono); letter-spacing: .04em; }

  .nav { position: sticky; top: 0; z-index: 50; background: color-mix(in oklab, var(--bg) 80%, transparent);
    backdrop-filter: saturate(140%) blur(12px); -webkit-backdrop-filter: saturate(140%) blur(12px); border-bottom: 1px solid var(--line); }
  .nav-inner { display: flex; align-items: center; justify-content: space-between; padding: 16px 24px; max-width: 1200px; margin: 0 auto; gap: 16px; }
  .nav-lockup { display: flex; align-items: center; gap: 14px; min-width: 0; }
  .nav-logo { height: ${logoH}px; width: auto; flex-shrink: 0; object-fit: contain; }
  .nav-brand { font-weight: 600; font-size: ${brandSize}px; letter-spacing: -.01em; }
  .nav-meta { font-family: var(--font-mono); font-size: 12px; color: var(--ink-3); letter-spacing: .08em; text-transform: uppercase; }
  .nav-meta b { color: var(--fg); font-weight: 500; }

  .hero-tag { display: inline-flex; align-items: center; gap: 10px; padding: 8px 16px; border-radius: var(--r-full);
    background: var(--accent-soft); color: var(--accent); border: 1px solid var(--accent-line);
    font-family: var(--font-mono); font-size: 12px; letter-spacing: .1em; text-transform: uppercase; margin-bottom: 32px; }
  .hero-tag::before { content: ''; width: 6px; height: 6px; border-radius: var(--r-full); background: var(--accent); animation: pulse 2s ease-in-out infinite; }
  @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: .5; } }
  .hero-meta { display: grid; grid-template-columns: 1fr; gap: 20px; margin-top: 48px; padding: 24px;
    background: var(--raised); border: 1px solid var(--line); border-radius: var(--radius); }
  @media (min-width: 640px) { .hero-meta { grid-template-columns: repeat(2, 1fr); padding: 32px; } }
  @media (min-width: 900px) { .hero-meta { grid-template-columns: repeat(4, 1fr); gap: 32px; } }
  .hero-meta dt { font-family: var(--font-mono); font-size: 11px; color: var(--ink-3); letter-spacing: .1em; text-transform: uppercase; margin-bottom: 8px; }
  .hero-meta dd { font-size: 18px; color: var(--fg); font-weight: 500; line-height: 1.3; }
  @media (min-width: 768px) { .hero-meta dd { font-size: 20px; } }

  .band { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; padding-bottom: 32px; margin-bottom: 48px; border-bottom: 1px solid var(--line); }
  .band-num { font-family: var(--font-mono); font-size: 12px; color: var(--ink-4); letter-spacing: .12em; text-transform: uppercase; white-space: nowrap; }

  .card { background: var(--raised); border: 1px solid var(--line); border-radius: var(--radius); padding: 24px; }
  @media (min-width: 768px) { .card { padding: 32px; } }
  .card.accent { background: linear-gradient(180deg, var(--accent-soft) 0%, transparent 100%); border-color: var(--accent-line); }
  .grid { display: grid; gap: 16px; grid-template-columns: 1fr; }
  @media (min-width: 640px) { .grid.g-2 { grid-template-columns: repeat(2, 1fr); } }
  @media (min-width: 900px) { .grid.g-3 { grid-template-columns: repeat(3, 1fr); gap: 20px; } .grid.g-4 { grid-template-columns: repeat(4, 1fr); gap: 16px; } }

  .diag-label { font-family: var(--font-mono); font-size: 11px; color: var(--ink-3); letter-spacing: .1em; text-transform: uppercase; }
  .diag-value { font-family: var(--font-display); font-size: 40px; color: var(--fg); margin-top: 8px; line-height: 1; letter-spacing: -.02em; font-weight: 500; overflow-wrap: anywhere; }
  @media (min-width: 768px) { .diag-value { font-size: 52px; margin-top: 12px; } }
  /* Valor longo (ex.: "Necessidade interna"): fonte menor pra quebrar só no
     espaço (palavra inteira por linha) em vez de partir no meio. */
  .diag-value.sm { font-size: 28px; overflow-wrap: normal; }
  @media (min-width: 768px) { .diag-value.sm { font-size: 32px; } }
  .diag-tag { margin-top: 8px; color: var(--ink-3); font-size: 14px; }
  .diag-highlight { grid-column: 1 / -1; display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
  .diag-highlight h3 { font-size: 24px; margin-top: 6px; line-height: 1.1; }
  @media (min-width: 640px) { .diag-highlight h3 { font-size: 32px; } }
  .pill { display: inline-flex; align-items: center; gap: 8px; padding: 6px 14px; border-radius: var(--r-full);
    font-family: var(--font-mono); font-size: 12px; letter-spacing: .06em; text-transform: uppercase;
    background: var(--raised); color: var(--ink-2); border: 1px solid var(--line); }
  .pill.accent { background: var(--accent-soft); color: var(--accent); border-color: var(--accent-line); }
  .pill-row { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 32px; }
  .pill-row .pill::before { content: '✓'; color: var(--accent); font-weight: 700; }

  .receipt-wrap { display: grid; grid-template-columns: 1fr; gap: 48px; align-items: start; }
  @media (min-width: 900px) { .receipt-wrap { grid-template-columns: 1fr 1fr; gap: 64px; align-items: center; } }
  .receipt { background: var(--fg); color: var(--bg); border-radius: var(--radius); padding: 28px 24px; font-family: var(--font-mono);
    box-shadow: 0 12px 32px rgba(0,0,0,.25); }
  @media (min-width: 768px) { .receipt { padding: 36px; } }
  .receipt-header { text-align: center; padding-bottom: 16px; border-bottom: 2px dashed var(--bg); margin-bottom: 16px; }
  .receipt-header div:first-child { font-size: 12px; letter-spacing: .2em; font-weight: 600; }
  .receipt-header div:last-child { font-size: 10px; opacity: .6; margin-top: 4px; letter-spacing: .06em; }
  .receipt-row { display: flex; justify-content: space-between; gap: 12px; align-items: baseline; padding: 12px 0;
    border-bottom: 1px dotted color-mix(in oklab, var(--bg) 25%, transparent); font-size: 14px; }
  @media (min-width: 768px) { .receipt-row { font-size: 16px; } }
  .receipt-row b { white-space: nowrap; }
  .receipt-total { display: flex; justify-content: space-between; align-items: baseline; padding: 20px 0 4px; border-top: 2px solid var(--bg); margin-top: 12px; font-size: 20px; font-weight: 700; }
  @media (min-width: 768px) { .receipt-total { font-size: 24px; } }
  .receipt-total b { color: #c1392e; }
  .receipt-foot { text-align: center; margin-top: 16px; font-size: 10px; opacity: .6; letter-spacing: .06em; }
  .receipt-note { margin-top: 28px; font-size: 14px; color: var(--ink-4); letter-spacing: .08em; font-family: var(--font-mono); }

  .step-tag { font-family: var(--font-mono); font-size: 12px; color: var(--accent); letter-spacing: .08em; text-transform: uppercase; }
  .step-card h3 { font-size: 24px; margin-top: 12px; line-height: 1.1; }
  @media (min-width: 768px) { .step-card h3 { font-size: 30px; } }
  .step-card p { margin-top: 12px; color: var(--ink-3); font-size: 16px; line-height: 1.5; }

  .compare { display: grid; grid-template-columns: 1fr; gap: 16px; }
  @media (min-width: 768px) { .compare { grid-template-columns: 1fr 1fr; gap: 24px; } }
  .compare-col { padding: 28px; border-radius: var(--radius); }
  @media (min-width: 768px) { .compare-col { padding: 36px; } }
  .compare-col.before { background: var(--raised); border: 1px solid var(--line); }
  .compare-col.after { background: linear-gradient(180deg, var(--accent-soft) 0%, transparent 100%); border: 1px solid var(--accent-line); }
  .compare-kicker { font-family: var(--font-mono); font-size: 12px; color: var(--ink-3); letter-spacing: .08em; text-transform: uppercase; margin-bottom: 10px; }
  .compare-lbl { font-family: var(--font-mono); font-size: 12px; letter-spacing: .1em; text-transform: uppercase; margin-bottom: 12px; font-weight: 500; }
  .before .compare-lbl { color: var(--error); }
  .after .compare-lbl { color: var(--accent); }
  .compare-num { font-family: var(--font-display); font-weight: 500; font-size: 64px; line-height: .9; letter-spacing: -.03em; margin-bottom: 8px; }
  @media (min-width: 768px) { .compare-num { font-size: 88px; } }
  .compare-num .unit { font-size: 24px; color: var(--ink-3); font-weight: 400; }
  .after .compare-num { color: var(--accent); }
  .compare-sub { font-size: 16px; color: var(--ink-3); line-height: 1.5; margin-bottom: 24px; }
  .point-list { display: flex; flex-direction: column; gap: 14px; }
  .point { display: flex; align-items: flex-start; gap: 14px; font-size: 16px; line-height: 1.4; }
  @media (min-width: 768px) { .point { font-size: 18px; } }
  .point::before { content: ''; width: 28px; height: 28px; flex-shrink: 0; border-radius: var(--r-full); margin-top: 1px;
    background-repeat: no-repeat; background-position: center; background-size: 14px; }
  .point.check { color: var(--ink-2); }
  .point.check::before { background-color: var(--accent-soft); border: 1.5px solid var(--accent);
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2300d0c0' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M5 12l5 5L20 7'/%3E%3C/svg%3E"); }
  .point.cross { color: var(--ink-3); }
  .point.cross::before { background-color: color-mix(in oklab, var(--error) 10%, transparent); border: 1.5px solid color-mix(in oklab, var(--error) 40%, transparent);
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23FF6B6B' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M6 6l12 12M18 6L6 18'/%3E%3C/svg%3E"); }

  .roi-wrap { display: grid; grid-template-columns: 1fr; gap: 48px; align-items: center; }
  @media (min-width: 900px) { .roi-wrap { grid-template-columns: 1fr 1fr; gap: 64px; } }
  .roi-big { text-align: center; padding: 48px 24px; background: var(--raised); border: 1px solid var(--accent-line); border-radius: calc(var(--radius) + 10px); position: relative; overflow: hidden; }
  .roi-big::before { content: ''; position: absolute; inset: -2px; background: radial-gradient(ellipse at center, var(--accent-soft), transparent 60%); pointer-events: none; }
  .roi-big > * { position: relative; }
  .roi-label { font-family: var(--font-mono); font-size: 12px; color: var(--ink-3); letter-spacing: .12em; text-transform: uppercase; }
  .roi-num { font-family: var(--font-display); font-weight: 500; font-size: clamp(56px, 11vw, 104px); line-height: .9; letter-spacing: -.04em; color: var(--accent); margin: 18px 0 6px; }
  .roi-caption { font-size: 16px; color: var(--ink-2); line-height: 1.5; max-width: 380px; margin: 0 auto; }
  .ret-steps { display: flex; flex-direction: column; gap: 14px; counter-reset: ret; }
  .ret-step { display: flex; gap: 14px; align-items: flex-start; font-size: 16px; line-height: 1.45; color: var(--ink-2); }
  @media (min-width: 768px) { .ret-step { font-size: 17px; } }
  .ret-step::before { counter-increment: ret; content: counter(ret); flex-shrink: 0; width: 28px; height: 28px; border-radius: var(--r-full);
    background: var(--accent-soft); border: 1px solid var(--accent-line); color: var(--accent);
    font-family: var(--font-mono); font-size: 13px; font-weight: 600; display: flex; align-items: center; justify-content: center; margin-top: 1px; }
  /* Conteúdo de flex rows embrulhado num único filho — texto com <em>/<span>
     viraria flex-items separados que não quebram linha (estourava no mobile). */
  .ret-step .ret-body, .point .point-body { flex: 1; min-width: 0; display: block; }
  .ret-step b { color: var(--fg); font-weight: 600; }
  .ret-uplift { margin-top: 24px; padding: 16px 18px; border-radius: var(--radius); background: var(--accent-soft); border: 1px solid var(--accent-line); font-size: 14px; line-height: 1.5; color: var(--ink-2); }
  .ret-uplift b { color: var(--accent); }

  /* Calculadora interativa (slide antes do preço): inputs do lead à esquerda,
     resultados recalculados ao vivo à direita. Reaproveita tokens de card. */
  .calc-grid { display: flex; flex-direction: column; gap: 24px; }
  .calc-inputs { display: grid; grid-template-columns: 1fr; gap: 16px; }
  @media (min-width: 640px) { .calc-inputs { grid-template-columns: repeat(3, 1fr); gap: 18px; } }
  .calc-field label { display: block; font-family: var(--font-mono); font-size: 11px; letter-spacing: .1em; text-transform: uppercase; color: var(--ink-3); margin-bottom: 8px; }
  .calc-inputbox { display: flex; align-items: baseline; gap: 8px; background: var(--raised); border: 1px solid var(--line); border-radius: var(--radius); padding: 12px 16px; transition: border-color .12s var(--ease-out), box-shadow .12s var(--ease-out); }
  .calc-inputbox:focus-within { border-color: var(--accent); box-shadow: var(--glow); }
  .calc-inputbox .affix { font-family: var(--font-mono); font-size: 15px; color: var(--ink-3); flex-shrink: 0; }
  .calc-inputbox input { flex: 1; min-width: 0; width: 100%; background: none; border: 0; color: var(--fg); font-family: var(--font-display); font-weight: 500; font-size: 26px; letter-spacing: -.02em; -moz-appearance: textfield; }
  .calc-inputbox input::-webkit-outer-spin-button, .calc-inputbox input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
  .calc-inputbox input:focus { outline: none; }
  .calc-note { margin-top: 6px; font-size: 12px; color: var(--ink-4); line-height: 1.4; }
  .calc-res { display: grid; grid-template-columns: 1fr; gap: 16px; }
  @media (min-width: 560px) { .calc-res { grid-template-columns: 1fr 1fr; } }
  @media (min-width: 1040px) { .calc-res { grid-template-columns: repeat(4, 1fr); } }
  .calc-cell { background: var(--raised); border: 1px solid var(--line); border-radius: var(--radius); padding: 22px 24px; }
  .calc-cell.hl { background: linear-gradient(180deg, var(--accent-soft) 0%, transparent 100%); border-color: var(--accent-line); }
  .calc-cell-label { font-family: var(--font-mono); font-size: 11px; letter-spacing: .1em; text-transform: uppercase; color: var(--ink-3); line-height: 1.35; }
  .calc-cell-num { font-family: var(--font-display); font-weight: 500; font-size: clamp(28px, 3.2vw, 40px); line-height: 1; letter-spacing: -.03em; margin-top: 10px; overflow-wrap: anywhere; }
  .calc-cell-sub { margin-top: 8px; font-size: 13px; color: var(--ink-3); line-height: 1.4; }
  .calc-cell.hl .calc-cell-num { color: var(--accent); }

  .light { background: var(--fg); color: var(--bg); }
  .light .lead, .light .body { color: color-mix(in oklab, var(--bg) 72%, transparent); }
  .light .band { border-bottom-color: color-mix(in oklab, var(--bg) 15%, transparent); }
  .light .band-num { color: color-mix(in oklab, var(--bg) 50%, transparent); }
  .price-wrap { display: grid; grid-template-columns: 1fr; gap: 24px; align-items: start; }
  @media (min-width: 900px) { .price-wrap { grid-template-columns: 1fr 1fr; gap: 48px; align-items: center; } }
  .plan-opts { display: grid; grid-template-columns: 1fr; gap: 14px; margin-bottom: 28px; }
  @media (min-width: 900px) { .plan-opts { grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 18px; } }
  .plan-opt { position: relative; text-align: left; background: var(--bg); color: var(--fg); border: 2px solid transparent;
    border-radius: calc(var(--radius) + 6px); padding: 24px 22px; display: flex; flex-direction: column; gap: 4px;
    transition: transform .12s var(--ease-out), box-shadow .12s var(--ease-out), border-color .12s var(--ease-out); }
  .plan-opt:hover { transform: translateY(-2px); }
  .plan-opt.featured { border-color: var(--accent); }
  .plan-opt.selected { border-color: var(--accent); box-shadow: var(--glow); }
  .plan-opt-badge { position: absolute; top: -11px; right: 14px; background: var(--accent); color: var(--accent-fg);
    font-family: var(--font-mono); font-size: 10px; letter-spacing: .08em; text-transform: uppercase; font-weight: 700;
    padding: 4px 10px; border-radius: var(--r-full); }
  .plan-opt-name { font-family: var(--font-mono); font-size: 12px; letter-spacing: .1em; text-transform: uppercase; color: var(--accent); }
  .plan-opt-price { font-family: var(--font-display); font-size: 32px; font-weight: 500; letter-spacing: -.02em; line-height: 1; margin-top: 6px; }
  .plan-opt-price small { font-size: 14px; color: var(--ink-3); font-weight: 400; letter-spacing: 0; margin-left: 4px; }
  .plan-opt-total { font-size: 13px; color: var(--ink-2); margin-top: 10px; line-height: 1.4; }
  .plan-opt-split { font-family: var(--font-mono); font-size: 11.5px; color: var(--ink-3); letter-spacing: .02em; }
  .price-card, .benefits-card { --bg: #051C2C; --fg: #F3FBFF;
    --ink-2: color-mix(in oklab, #F3FBFF 78%, transparent);
    --ink-3: color-mix(in oklab, #F3FBFF 60%, transparent);
    --ink-4: color-mix(in oklab, #F3FBFF 42%, transparent);
    --line: color-mix(in oklab, #F3FBFF 12%, transparent);
    --raised: color-mix(in oklab, #F3FBFF 6%, transparent); }
  .price-card { background: var(--bg); color: var(--fg); border-radius: calc(var(--radius) + 10px); padding: 40px 32px; position: relative; overflow: hidden; }
  @media (min-width: 768px) { .price-card { padding: 56px 48px; } }
  .price-card .pill { position: absolute; top: 24px; right: 24px; }
  /* Cabeçalho do card: tag do plano à esquerda ALINHADA com o badge à direita
     (o badge deixa de ser absoluto quando está dentro do head). */
  .price-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
  .price-card .price-head .pill { position: static; flex-shrink: 0; }
  /* amount+per como unidade: o "/ mês" nunca desce sozinho de linha. */
  .price-main { display: inline-flex; align-items: baseline; gap: 6px; white-space: nowrap; }
  /* Com segunda oferta, o valor grande encolhe um pouco pra "12x R$ 299,95 / mês"
     caber numa linha só no card empilhado. */
  .has-offer2 .price-number .amount { font-size: clamp(44px, 6.8vw, 80px); }
  .price-tag { font-family: var(--font-mono); font-size: 12px; color: var(--accent); letter-spacing: .1em; text-transform: uppercase; }
  .price-number { display: flex; align-items: baseline; gap: 6px; margin-top: 24px; flex-wrap: wrap; }
  .price-number .currency { font-size: 24px; color: var(--ink-3); }
  @media (min-width: 768px) { .price-number .currency { font-size: 32px; } }
  .price-number .amount { font-family: var(--font-display); font-weight: 500; letter-spacing: -.04em; font-size: clamp(52px, 9vw, 96px); line-height: 1; }
  .price-number .per { font-size: 18px; color: var(--ink-3); margin-left: 6px; }
  .price-sub { margin-top: 14px; font-size: 14px; color: var(--ink-3); line-height: 1.5; }
  .price-cycles { margin-top: 10px; font-family: var(--font-mono); font-size: 12px; color: var(--accent); letter-spacing: .04em; }
  /* Preço-âncora (de R$ X riscado) acima do valor e total riscado na linha de ciclos */
  .price-from { font-family: var(--font-mono); font-size: 16px; color: var(--ink-4); text-decoration: line-through; margin-top: 24px; }
  @media (min-width: 768px) { .price-from { font-size: 18px; } }
  .price-from + .price-number { margin-top: 4px; }
  .cycles-from { text-decoration: line-through; color: var(--ink-4); }
  .price-divider { height: 1px; background: var(--line); margin: 28px 0; }
  .price-list { list-style: none; display: flex; flex-direction: column; gap: 12px; font-size: 16px; color: var(--ink-2); }
  .price-list li { display: flex; gap: 12px; align-items: flex-start; }
  .price-list li::before { content: '✓'; color: var(--accent); font-weight: 700; flex-shrink: 0; }
  /* Coluna de benefícios/entregáveis (lado direito do pricing). */
  .benefits-card { --bg: #051C2C; --fg: #F3FBFF; background: var(--bg); color: var(--fg); border-radius: calc(var(--radius) + 10px); padding: 32px 28px; height: 100%; }
  @media (min-width: 768px) { .benefits-card { padding: 40px 36px; } }
  .benefits-title { font-family: var(--font-mono); font-size: 12px; letter-spacing: .1em; text-transform: uppercase; color: var(--accent); margin-bottom: 22px; }
  .benefits-card .price-list { gap: 14px; color: var(--ink-2); }
  .guarantee { background: var(--accent-soft); border: 2px solid var(--accent); border-radius: calc(var(--radius) + 10px); padding: 32px 28px; }
  @media (min-width: 768px) { .guarantee { padding: 40px 36px; } }
  .light .guarantee { color: var(--bg); }
  .guarantee-head { display: flex; align-items: center; gap: 12px; font-family: var(--font-mono); font-size: 12px; letter-spacing: .1em; text-transform: uppercase; font-weight: 600; color: inherit; }
  .guarantee h3 { font-size: 36px; line-height: 1; margin-top: 20px; }
  @media (min-width: 768px) { .guarantee h3 { font-size: 44px; } }
  .guarantee p { font-size: 17px; opacity: .8; line-height: 1.5; margin-top: 18px; }
  .payback { margin-top: 20px; padding: 24px; background: var(--fg); color: var(--bg); border: 1px solid var(--line); border-radius: var(--radius); }
  .light .payback { border-color: color-mix(in oklab, var(--bg) 15%, transparent); }
  .payback .mono { font-size: 11px; opacity: .6; letter-spacing: .1em; text-transform: uppercase; }
  .payback .pb-num { font-family: var(--font-display); font-size: 32px; line-height: 1.05; letter-spacing: -.02em; margin-top: 8px; font-weight: 500; }
  .payback .pb-cap { font-size: 14px; opacity: .75; line-height: 1.5; margin-top: 8px; }
  .close-line { margin-top: 40px; text-align: center; font-size: clamp(20px, 3vw, 30px); font-family: var(--font-display); font-weight: 500; line-height: 1.2; letter-spacing: -.02em; }
  .accept-row { margin-top: 32px; display: flex; flex-direction: column; align-items: center; gap: 10px; }
  .accept-btn { padding: 16px 40px; border-radius: var(--radius); background: #1F8A5B; color: #fff; font-weight: 700; font-size: 17px;
    box-shadow: 0 4px 14px color-mix(in oklab, #1F8A5B 32%, transparent), inset 0 1px 0 rgba(255,255,255,.2); text-shadow: 0 1px 2px rgba(0,0,0,.22);
    transition: transform .15s var(--ease-out), box-shadow .2s var(--ease-out); animation: cta-pulse 2.4s ease-in-out infinite; }
  .accept-btn:hover:not(:disabled) { transform: translateY(-2px); }
  .accept-btn:disabled { opacity: .6; cursor: default; animation: none; box-shadow: none; }
  @keyframes cta-pulse {
    0%, 100% { box-shadow: 0 4px 14px color-mix(in oklab, #1F8A5B 30%, transparent), 0 0 0 0 color-mix(in oklab, #1F8A5B 0%, transparent), inset 0 1px 0 rgba(255,255,255,.2); }
    50% { box-shadow: 0 8px 30px color-mix(in oklab, #1F8A5B 55%, transparent), 0 0 0 6px color-mix(in oklab, #1F8A5B 16%, transparent), inset 0 1px 0 rgba(255,255,255,.25); }
  }
  @media (prefers-reduced-motion: reduce) { .accept-btn { animation: none; } }
  .accept-done { display: inline-flex; align-items: center; gap: 10px; padding: 14px 28px; border-radius: var(--r-full); background: var(--accent-soft); border: 1px solid var(--accent); color: inherit; font-weight: 600; }

  /* Reveal do preço (slide pricing com s.revealPrice): a seção abre "pendente",
     só com os benefícios visíveis; no lugar do preço fica um bloco VAZIO (sem
     botão nem indicador de espera) e o valor, a frase final e o CTA entram
     animados no "comando de passar o slide": teclas de avanço com o slide na
     tela, ou clique/tap em qualquer ponto da seção. Sem o flag no slide, nada
     muda. No print, tudo aparece revelado. */
  .price-reveal { position: relative; }
  .price-pending .price-reveal .price-card, .price-revealed .price-reveal .price-card {
    transition: opacity .6s var(--ease-out), transform .6s var(--ease-out); }
  .price-pending .price-reveal .price-card { opacity: 0; transform: translateY(18px) scale(.97); }
  .price-veil { position: absolute; inset: 0; width: 100%; border-radius: calc(var(--radius) + 10px);
    background: linear-gradient(155deg, #073143 0%, #051C2C 60%, #03141D 100%);
    border: 1px solid color-mix(in oklab, var(--accent) 18%, transparent);
    transition: opacity .45s var(--ease-out), transform .45s var(--ease-out); }
  .price-revealed .price-veil { opacity: 0; transform: scale(.96); pointer-events: none; }
  .price-pending .close-line, .price-pending .accept-row, .price-pending .plan-opts { opacity: 0; transform: translateY(12px); }
  .price-revealed .close-line, .price-revealed .accept-row, .price-revealed .plan-opts {
    transition: opacity .5s var(--ease-out), transform .5s var(--ease-out); }
  .price-revealed .close-line { transition-delay: .2s; }
  .price-revealed .accept-row { transition-delay: .35s; }
  /* Benefícios encadeados (s.benefitGroups): grupos com título mono, itens que
     entram um a um a cada comando de avanço e banner-síntese por grupo. Altura
     pré-alocada (invisível ≠ ausente) — o fitSlides não re-escala a cada passo. */
  .bg-title { font-family: var(--font-mono); font-size: 11px; letter-spacing: .12em; text-transform: uppercase; color: var(--ink-3); margin: 20px 0 12px; }
  .benefits-card .benefits-title + .bg-title, .benefits-card .bg-title:first-child { margin-top: 0; }
  .benefit-synth { margin: 14px 0 6px; padding: 14px 16px; border-radius: var(--radius); background: var(--accent-soft); border: 1px solid var(--accent-line); font-size: 14.5px; line-height: 1.5; color: var(--ink-2); }
  .price-pending .stage-item, .price-revealed .stage-item { transition: opacity .45s var(--ease-out), transform .45s var(--ease-out); }
  .price-pending .stage-item:not(.on) { opacity: 0; transform: translateY(10px); }
  .price-revealed .stage-item { opacity: 1; transform: none; }
  /* Segunda oferta (s.offer2): SECRETA — entra abaixo da principal só com
     Shift+Espaço (negociação) e acinzenta a principal (comparativo). A pilha
     ancora no rodapé da célula: o card principal aparece embaixo e, quando a
     oferta 2 entra, ele sobe e ela assume o rodapé (a borda inferior não muda). */
  .has-offer2 { align-self: stretch; display: flex; flex-direction: column; justify-content: flex-end; }
  .price-card.offer2, .price-card.offer3 { display: none; margin-top: 16px; }
  .offer2-on .price-card.offer2, .offer3-on .price-card.offer3 { display: block; animation: offer2-in .5s var(--ease-out); }
  @keyframes offer2-in { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: none; } }
  .price-card.offer1, .price-card.offer2 { transition: filter .5s var(--ease-out), opacity .5s var(--ease-out); }
  .offer2-on .price-card.offer1,
  .offer3-on .price-card.offer1, .offer3-on .price-card.offer2 { filter: grayscale(1); opacity: .55; }
  @media (prefers-reduced-motion: reduce) {
    .price-pending .price-reveal .price-card, .price-revealed .price-reveal .price-card, .price-veil,
    .price-pending .stage-item, .price-revealed .stage-item,
    .price-card.offer1, .offer2-on .price-card.offer2,
    .price-revealed .close-line, .price-revealed .accept-row, .price-revealed .plan-opts { transition: none; animation: none; } }
  @media print {
    .price-veil { display: none; }
    /* Oferta 2 secreta NÃO sai no print (só se o closer já tiver ativado). */
    .price-pending .price-reveal .price-card, .price-pending .close-line, .price-pending .accept-row, .price-pending .plan-opts,
    .price-pending .stage-item, .price-pending .pb-stage { opacity: 1; transform: none; } }

  /* ── Layout empilhado do pricing (slides com benefitGroups) ─────────────────
     (1) benefícios num ÚNICO bloco com os 3 grupos em colunas; (2) preço numa
     faixa larga que o conteúdo preenche por inteiro; a escada secreta troca o
     conteúdo DENTRO da mesma faixa (nunca cria card novo). */
  .price-stack { display: block; }
  .price-stack .benefits-single { margin-bottom: 24px; }
  .price-stack .benefits-single .benefits-title { margin-bottom: 22px; }
  .benefit-grid { display: grid; grid-template-columns: 1fr; gap: 26px; }
  @media (min-width: 900px) { .benefit-grid { grid-template-columns: repeat(3, 1fr); gap: 0; } }
  .benefit-group { padding: 4px 0; }
  @media (min-width: 900px) {
    .benefit-group { padding: 0 30px; }
    .benefit-group:first-child { padding-left: 0; }
    .benefit-group:last-child { padding-right: 0; }
    .benefit-group + .benefit-group { border-left: 1px solid var(--line); } }
  .benefit-group .bg-title { margin-top: 0; color: var(--accent); font-size: 12px; }
  .benefit-group .price-list { gap: 13px; color: var(--ink-2); font-size: 16px; }
  .benefit-group .benefit-synth { margin: 16px 0 0; }

  /* Faixa de preço = UM bloco largo, escuro, de largura total. */
  .price-band { position: relative; overflow: hidden; background: #051C2C; color: #F3FBFF;
    border-radius: calc(var(--radius) + 10px); padding: 36px 44px;
    --ink-2: color-mix(in oklab, #F3FBFF 78%, transparent); --ink-3: color-mix(in oklab, #F3FBFF 60%, transparent);
    --line: color-mix(in oklab, #F3FBFF 12%, transparent); }
  @media (min-width: 768px) { .price-band { padding: 40px 52px; } }
  /* Palco onde os painéis de oferta se sobrepõem (só o ativo visível): o bloco
     mantém o MESMO tamanho quando a escada troca de preço. */
  .pb-stage { position: relative; min-height: 168px; transition: opacity .5s var(--ease-out); }
  .price-pending .pb-stage { opacity: 0; }
  .pb-offer { position: absolute; inset: 0; display: flex; align-items: center; justify-content: space-between; gap: 8px;
    opacity: 0; transform: translateX(34px); transition: opacity .55s var(--ease-out), transform .55s var(--ease-out); }
  .pb-offer[data-o="1"] { opacity: 1; transform: none; }
  /* Troca de degrau: o anterior desliza pra ESQUERDA e some, o novo entra pela direita. */
  .offer2-on .pb-offer[data-o="1"], .offer3-on .pb-offer[data-o="1"] { opacity: 0; transform: translateX(-34px); }
  .offer2-on .pb-offer[data-o="2"] { opacity: 1; transform: none; }
  .offer3-on .pb-offer[data-o="2"] { opacity: 0; transform: translateX(-34px); }
  .offer3-on .pb-offer[data-o="3"] { opacity: 1; transform: none; }
  /* 3 zonas que preenchem a faixa de ponta a ponta: plano · preço (centro) · total. */
  .pb-left { display: flex; flex-direction: column; align-items: flex-start; gap: 14px; flex: 0 0 auto; }
  .pb-left .price-tag { font-size: 15px; }
  .pb-left .pill { position: static; }
  .pb-center { flex: 1 1 auto; display: flex; flex-direction: column; align-items: center; gap: 12px;
    padding: 0 40px; margin: 0 8px; border-left: 1px solid var(--line); border-right: 1px solid var(--line); }
  .pb-right { flex: 0 0 auto; text-align: right; }
  .pb-right .price-cycles { margin: 0; font-size: 13.5px; }
  .pb-price.price-number { margin: 0; justify-content: center; align-items: baseline; flex-wrap: nowrap; }
  .pb-price .amount { font-size: clamp(64px, 8.4vw, 116px); }
  .pb-price .currency { font-size: clamp(22px, 3vw, 34px); }
  /* Preços anteriores: riscados, apagados, acima do novo (âncora de comparação). */
  .pb-compare { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px 20px; }
  .pb-old { display: inline-flex; align-items: baseline; gap: 8px; opacity: .55; }
  .pb-old-tag { font-family: var(--font-mono); font-size: 10.5px; letter-spacing: .08em; text-transform: uppercase; color: var(--ink-3); }
  .pb-old-price { color: var(--ink-3); }
  .pb-old-price .amount { font-family: var(--font-display); font-size: 26px; font-weight: 500; }
  .pb-old-price .currency, .pb-old-price .per, .pb-old-price .price-main { font-size: 13px; }
  /* Oferta secreta anterior só entra na comparação se tiver sido ativada: pulou
     direto pra 3ª (só offer3-on)? a 2ª não aparece. */
  .pb-old.off-need-2 { display: none; }
  .offer2-on .pb-old.off-need-2 { display: inline-flex; }
  @media (prefers-reduced-motion: reduce) { .pb-stage, .pb-offer { transition: none; } }
  @media (max-width: 899px) {
    .pb-offer { position: static; flex-direction: column; align-items: stretch; gap: 18px; transform: none; opacity: 1; }
    .pb-offer[data-o="2"], .pb-offer[data-o="3"] { display: none; }
    .offer2-on .pb-offer[data-o="1"], .offer3-on .pb-offer[data-o="1"] { display: none; }
    .offer2-on .pb-offer[data-o="2"] { display: flex; }
    .offer3-on .pb-offer[data-o="2"] { display: none; }
    .offer3-on .pb-offer[data-o="3"] { display: flex; }
    .pb-center { border: 0; padding: 0; margin: 0; align-items: flex-start; }
    .pb-price.price-number { justify-content: flex-start; }
    .pb-compare { justify-content: flex-start; }
    .pb-right { text-align: left; } }

  .closer-block { margin: 48px auto 0; max-width: 520px; padding: 24px; background: var(--raised); border: 1px solid var(--line); border-radius: var(--radius); display: flex; align-items: center; gap: 16px; text-align: left; }
  .light .closer-block { background: var(--bg); color: var(--fg); border-color: transparent; }
  .closer-avatar { width: 56px; height: 56px; border-radius: var(--r-full); background: linear-gradient(135deg, var(--accent), color-mix(in oklab, var(--accent) 40%, var(--bg))); flex-shrink: 0; display: flex; align-items: center; justify-content: center; font-size: 24px; font-weight: 600; color: var(--accent-fg); overflow: hidden; }
  .closer-avatar img { width: 100%; height: 100%; object-fit: cover; }
  .closer-info { flex: 1; min-width: 0; }
  .closer-label { font-family: var(--font-mono); font-size: 11px; color: var(--ink-3); letter-spacing: .08em; text-transform: uppercase; }
  .closer-name { font-size: 18px; font-weight: 600; margin-top: 2px; }
  .closer-cta { margin-left: auto; flex-shrink: 0; padding: 10px 16px; border-radius: var(--r-full); background: var(--accent); color: var(--accent-fg); font-weight: 600; font-size: 14px; white-space: nowrap; }
  .closer-cta:hover { filter: brightness(1.06); }

  /* Slide pricing COM grade de ciclos: versão densa no desktop — altura natural
     menor = menos downscale do fitSlides() = tudo maior na tela. Mobile (<900px)
     não escala, então mantém os tamanhos confortáveis padrão. */
  @media (min-width: 900px) {
    main > section.compact-pricing { display: flex; flex-direction: column; justify-content: center; }
    .compact-pricing .band { padding-bottom: 16px; margin-bottom: 22px; }
    .compact-pricing .h-section { font-size: clamp(26px, 3.2vw, 40px); }
    .compact-pricing .plan-opts { margin-bottom: 20px; gap: 14px; }
    .compact-pricing .plan-opt { padding: 18px 20px; }
    .compact-pricing .price-wrap { gap: 28px; }
    .compact-pricing .price-card { padding: 28px 30px; }
    .compact-pricing .price-card .pill { top: 16px; right: 16px; }
    .compact-pricing .price-number { margin-top: 14px; }
    .compact-pricing .price-number .amount { font-size: clamp(48px, 6vw, 76px); }
    .compact-pricing .price-number .currency { font-size: 20px; }
    .compact-pricing .price-number .per { font-size: 15px; }
    .compact-pricing .price-sub { margin-top: 8px; font-size: 13px; }
    .compact-pricing .price-divider { margin: 16px 0; }
    .compact-pricing .price-list { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 18px; font-size: 14px; }
    .compact-pricing .guarantee { padding: 22px 24px; }
    .compact-pricing .guarantee h3 { font-size: 24px; margin-top: 10px; }
    .compact-pricing .guarantee p { font-size: 14px; margin-top: 10px; }
    .compact-pricing .payback { margin-top: 12px; padding: 16px 18px; }
    .compact-pricing .payback .pb-num { font-size: 22px; }
    .compact-pricing .payback .pb-cap { font-size: 13px; margin-top: 4px; }
    .compact-pricing .close-line { margin-top: 20px; font-size: clamp(16px, 1.6vw, 21px); }
    .compact-pricing .accept-row { margin-top: 14px; }
    .compact-pricing .accept-btn { padding: 12px 32px; font-size: 15px; }
    .compact-pricing .closer-block { margin-top: 20px; padding: 14px 16px; }
    .compact-pricing .closer-avatar { width: 44px; height: 44px; font-size: 19px; }
    .compact-pricing .closer-name { font-size: 16px; }
  }

  .slide-media { margin-top: 40px; }
  .slide-media img, .slide-media video { width: 100%; max-height: 56vh; object-fit: contain;
    border-radius: var(--radius); border: 1px solid var(--line); background: var(--raised); display: block; }
  .slide-media figcaption { margin-top: 10px; font-family: var(--font-mono); font-size: 12px; color: var(--ink-3); letter-spacing: .06em; text-align: center; }

  .foot { padding: 48px 0 120px; border-top: 1px solid var(--line); text-align: center; }
  .foot-meta { font-family: var(--font-mono); font-size: 12px; color: var(--ink-4); letter-spacing: .06em; line-height: 1.8; }

  /* Trava magnética por slide (desktop; respeita prefers-reduced-motion).
     Cada slide tem altura FIXA = viewport − nav (16:9 fecha exato na tela);
     conteúdo maior que isso é ESCALADO pra caber (fitSlides() no script), então
     mandatory volta a ser seguro — nunca existe fundo de slide inalcançável.
     Footer ancora com snap-align end (não vira "slide vazio"). */
  @media (min-width: 900px) and (prefers-reduced-motion: no-preference) {
    html { --navh: ${navH}px; scroll-snap-type: y mandatory; scroll-padding-top: var(--navh); }
    .nav { height: var(--navh); }
    .nav .nav-inner { height: 100%; padding: 0 24px; }
    main > section, main > header.hero { scroll-snap-align: start; scroll-snap-stop: always;
      height: calc(100vh - var(--navh)); padding: 24px 0; overflow: hidden;
      display: flex; flex-direction: column; justify-content: center; }
    main > section > .wrap, main > header.hero > .wrap { transform-origin: 50% 50%; }
    .foot { scroll-snap-align: end; }
  }

  /* Edição inline (modo closer via ?k=token) + banner de preview reaproveitam estas duas regras */
  .edit-banner { position: fixed; top: 0; left: 0; right: 0; z-index: 81; background: var(--accent-soft); border-bottom: 1px solid var(--accent-line); color: var(--accent); font-family: var(--font-mono); font-size: 12px; letter-spacing: .06em; text-transform: uppercase; text-align: center; padding: 7px; }
  body.editing { padding-top: 30px; }
  /* Valor editável: parece texto normal; afford discreta só no hover (modo closer) */
  .pe { cursor: pointer; border-bottom: 1px dashed var(--accent-line); border-radius: 3px; transition: background .12s var(--ease-out); }
  .pe:hover { background: var(--accent-soft); }
  .pe::after { content: '✎'; font-size: .62em; opacity: .55; margin-left: 3px; vertical-align: super; }
  .edit-pop { position: absolute; z-index: 90; background: color-mix(in oklab, var(--bg) 92%, var(--fg)); border: 1px solid var(--accent-line); border-radius: var(--radius); box-shadow: 0 14px 36px rgba(0,0,0,.45); padding: 10px; }
  .edit-pop select, .edit-pop input { padding: 9px 11px; background: var(--bg); border: 1px solid var(--line); border-radius: calc(var(--radius) - 6px); color: var(--fg); font-family: var(--font-display); font-size: 15px; min-width: 140px; }
  .edit-pop select:focus, .edit-pop input:focus { outline: none; border-color: var(--accent); box-shadow: var(--glow); }
  .save-tag { position: fixed; right: 16px; bottom: 16px; z-index: 95; padding: 8px 14px; border-radius: var(--r-full); background: color-mix(in oklab, var(--bg) 88%, var(--fg)); border: 1px solid var(--accent-line); color: var(--accent); font-family: var(--font-mono); font-size: 12px; opacity: 0; transform: translateY(8px); transition: opacity .2s, transform .2s; pointer-events: none; }
  .save-tag.show { opacity: 1; transform: translateY(0); }
  .save-tag.err { color: var(--error); border-color: var(--error); }

  /* Tela de preparação do closer (antes da capa, só no modo ?k). */
  .closer-setup { min-height: 100vh; display: flex; flex-direction: column; justify-content: center; }
  .setup-title { font-size: clamp(30px, 4.4vw, 52px); font-weight: 600; letter-spacing: -.02em; line-height: 1.05; margin-top: 22px; }
  .setup-sub { color: var(--ink-3); font-size: 17px; line-height: 1.5; margin-top: 14px; max-width: 640px; }
  .setup-grid { display: grid; grid-template-columns: 1fr; gap: 18px; margin-top: 40px; }
  @media (min-width: 640px) { .setup-grid { grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 20px; align-items: start; } }
  .setup-field { display: flex; flex-direction: column; gap: 8px; }
  .setup-combo { display: flex; flex-direction: column; gap: 8px; }
  .setup-field > span { font-family: var(--font-mono); font-size: 11px; letter-spacing: .1em; text-transform: uppercase; color: var(--ink-3); }
  .setup-input { width: 100%; padding: 13px 15px; background: var(--raised); border: 1px solid var(--line); border-radius: var(--radius); color: var(--fg); font-family: var(--font-display); font-size: 16px; }
  .setup-input:focus { outline: none; border-color: var(--accent); box-shadow: var(--glow); }
  .setup-go { margin-top: 40px; align-self: flex-start; padding: 15px 32px; border-radius: var(--radius); background: var(--accent); color: var(--accent-fg); font-weight: 600; font-size: 16px; transition: transform .15s var(--ease-out), filter .15s var(--ease-out); }
  .setup-go:hover { transform: translateY(-2px); filter: brightness(1.05); }
  @media print { .closer-setup { display: none !important; } }

  @media print {
    .nav, .edit-pop, .save-tag, .edit-banner, .accept-row, .slide-media video { display: none !important; }
    .pe { border-bottom: 0 !important; }
    .pe::after { content: none !important; }
    body { background: #fff; color: #000; padding-top: 0; }
    main > section, main > header.hero { padding: 40px 0; break-inside: avoid; min-height: 0 !important; height: auto !important; overflow: visible !important; display: block !important; }
    main > section > .wrap, main > header.hero > .wrap { transform: none !important; }
    .atmos { display: none; }
    .card, .compare-col, .receipt { break-inside: avoid; }
    .body, .lead { color: #333 !important; }
    h1, h2, h3 { color: #000 !important; }
  }

  body.js-ready [data-reveal]:not(.in) { opacity: 0; transform: translateY(20px); }
  body.js-ready [data-reveal] { transition: opacity .7s var(--ease-out), transform .7s var(--ease-out); }
  [data-reveal].in { opacity: 1; transform: translateY(0); }
  @media (prefers-reduced-motion: reduce) { body.js-ready [data-reveal]:not(.in) { opacity: 1; transform: none; } [data-reveal] { transition: none !important; } }

  /* Calculadora SECRETA do closer (Shift+C): overlay flutuante com histórico de
     resultados (tape). Some no print e não faz parte do deck — só quem sabe o
     atalho abre. */
  .calc-secret { position: fixed; right: 20px; bottom: 20px; width: 290px; max-width: calc(100vw - 32px); z-index: 9999;
    background: var(--raised); border: 1px solid var(--line); border-radius: calc(var(--radius) + 6px);
    box-shadow: 0 24px 70px rgba(0,0,0,.4); font-family: var(--font-display); display: none; overflow: hidden; }
  .calc-secret.on { display: block; }
  .calc-secret-head { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-bottom: 1px solid var(--line);
    font-family: var(--font-mono); font-size: 10.5px; letter-spacing: .08em; text-transform: uppercase; color: var(--ink-3); }
  .calc-secret-head .t { flex: 1; }
  .calc-secret-head button { cursor: pointer; background: none; border: 0; color: var(--ink-3); font-family: var(--font-mono); font-size: 10.5px; padding: 2px 4px; }
  .calc-secret-head button:hover { color: var(--fg); }
  .calc-secret-tape { max-height: 132px; overflow-y: auto; padding: 8px 12px; border-bottom: 1px solid var(--line);
    display: flex; flex-direction: column; gap: 3px; font-family: var(--font-mono); font-size: 12px; }
  .calc-secret-tape:empty { display: none; }
  .calc-secret-tape .row { display: flex; justify-content: space-between; gap: 10px; }
  .calc-secret-tape .row .e { color: var(--ink-4); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .calc-secret-tape .row .r { color: var(--fg); font-weight: 600; flex-shrink: 0; }
  .calc-secret-display { padding: 12px 14px; text-align: right; }
  .calc-secret-expr { font-family: var(--font-mono); font-size: 12px; color: var(--ink-4); min-height: 15px; overflow-wrap: anywhere; }
  .calc-secret-out { font-family: var(--font-display); font-weight: 600; font-size: 30px; line-height: 1.1; letter-spacing: -.02em; overflow-wrap: anywhere; }
  .calc-secret-keys { display: grid; grid-template-columns: repeat(4, 1fr); gap: 1px; background: var(--line); }
  .calc-secret-keys button { border: 0; padding: 13px 0; font-family: var(--font-display); font-size: 17px; background: var(--raised); color: var(--fg); cursor: pointer; }
  .calc-secret-keys button:hover { background: var(--bg); }
  .calc-secret-keys button.op { color: var(--accent); }
  .calc-secret-keys button.eq { background: var(--accent); color: var(--accent-fg); }
  @media print { .calc-secret { display: none !important; } }
</style>
</head>
<body${previewBanner ? ' class="editing"' : ""}>
${previewBanner ? '<div class="edit-banner">👁 Preview do template — dados de exemplo, nada é salvo</div>' : ""}
<nav class="nav">
  <div class="nav-inner">
    ${navBrand}
    <span class="nav-meta">Proposta · <b id="nav-date"></b></span>
  </div>
</nav>
<main id="root"></main>
<script>window.__PROPOSAL__ = ${escJson(p)};</script>
<script>
(function () {
  'use strict';
  var P = window.__PROPOSAL__ || {};
  var SLIDES = P.slides || [];
  var DATA = P.data || { lead: {}, answers: {} };
  DATA.lead = DATA.lead || {}; DATA.answers = DATA.answers || {};
  var CALC = P.calc || {};
  var state = P.state || {};
  var CYCLE_NAME = { monthly: 'Mensal', quarterly: 'Trimestral', semiannual: 'Semestral', annual: 'Anual' };
  var CYCLE_MONTHS = { monthly: 1, quarterly: 3, semiannual: 6, annual: 12 };
  var CYCLE_ORDER = ['monthly', 'quarterly', 'semiannual', 'annual'];
  var root = document.getElementById('root');

  // Hook que a grade de planos chama pra auto-salvar no modo closer (setado por
  // mountInlineEdit; null fora do modo edição).
  var afterEdit = null;
  // Spans data-fill que viram clicáveis no modo closer → campo editável.
  var EDIT_FIELD = {
    'state.accounts': 'accounts', 'calc.assentos': 'accounts',
    'state.volume': 'volume', 'calc.volume': 'volume',
    'calc.preco': 'price', 'state.validUntil': 'valid',
    'calc.plano': 'cycle', 'calc.ciclo': 'cycle',
    'lead.company': 'company', 'lead.name': 'name', 'lead.firstName': 'name',
    'answers.niche': 'niche'
  };

  function brl(n) { return 'R$ ' + Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function intBR(n) { return Math.round(Number(n) || 0).toLocaleString('pt-BR'); }
  // Centavos só quando existem (350 → "350"; 274,9 → "274,90").
  function moneyBR(n) {
    n = Number(n) || 0;
    if (n % 1 === 0) return intBR(n);
    return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  // Preço/mês do ciclo k com os assentos atuais (base + extras além das incluídas).
  function planPerMonth(k) {
    var pk = (CALC.plans || {})[k];
    if (!pk) return null;
    return Number(pk.base || 0) + Math.max(0, (state.seats || 2) - Number(pk.included || 0)) * Number(pk.extra || 0);
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function getPath(obj, path) {
    var cur = obj;
    var parts = path.split('.');
    for (var i = 0; i < parts.length; i++) { if (cur == null) return ''; cur = cur[parts[i]]; }
    return cur == null ? '' : cur;
  }

  // Calculadora — port parametrizado da projectMoney() da proposta de referência.
  function compute() {
    var c = CALC;
    var dest = Math.max(0, (state.seats || 2) - 1);
    var vol = Number((c.volumeMid || {})[state.volume]) || 28;
    var minPerAd = (Number(c.minCopy) || 10) + (Number(c.minCompatEdit) || 2);
    var hoursMonth = vol * dest * minPerAd * 4.3 / 60;
    hoursMonth = Math.max(hoursMonth, 6);
    var hourly = (Number(c.salaryMonthly) || 3000) / (Number(c.workHours) || 176);
    var labor = hoursMonth * hourly;
    var rework = labor * (Number(c.reworkPct) || 0.10);
    var hiddenMonth = labor + rework;
    var hiddenYear = hiddenMonth * 12;
    var margin = Number(c.netMargin) || 0.10;
    var salesEquiv = hiddenYear / margin;
    function r(n, s) { return Math.round(n / s) * s; }

    var price = 0;
    var perMonth = planPerMonth(state.cycle);
    if (state.customPriceCents > 0) price = state.customPriceCents / 100;
    else if (perMonth != null) price = perMonth;
    var months = CYCLE_MONTHS[state.cycle] || 1;
    var cycles = [];
    CYCLE_ORDER.forEach(function (k) {
      var pm = planPerMonth(k);
      if (pm != null) cycles.push(CYCLE_NAME[k] + ' R$ ' + moneyBR(pm) + '/mês');
    });

    return {
      assentos: state.seats, contasDestino: dest, volume: state.volume,
      minPorAnuncio: minPerAd, minCopia: Number(c.minCopy) || 10, minCompat: Number(c.minCompatEdit) || 2,
      horaCusto: hourly.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      horasMes: Math.round(hoursMonth),
      salario: intBR(c.salaryMonthly || 3000), horasTrab: Number(c.workHours) || 176,
      margem: Math.round(margin * 100), uplift: Number(c.revenueUpliftPct) || 50,
      fatCopia: brl(r(labor * ((Number(c.minCopy) || 10) / minPerAd), 10)),
      fatCompat: brl(r(labor * ((Number(c.minCompatEdit) || 2) / minPerAd), 10)),
      fatRetrabalho: brl(r(rework, 10)),
      fatTotal: brl(r(hiddenMonth, 50)),
      custoMes: intBR(r(hiddenMonth, 50)), custoAno: intBR(r(hiddenYear, 100)),
      vendasEquiv: intBR(r(salesEquiv, 1000)),
      // Custo anual de 1 funcionário. employerMonths = nº de salários/ano que o
      // empregador paga (default 13,33 = salário + 13º + 1/3 de férias; suba p/
      // incluir encargos). custoFuncAnoK = forma curta "X mil" pro número grande.
      custoFuncAno: intBR(r((Number(c.salaryMonthly) || 3000) * (Number(c.employerMonths) || 13.33), 100)),
      custoFuncAnoK: Math.round((Number(c.salaryMonthly) || 3000) * (Number(c.employerMonths) || 13.33) / 1000) + ' mil',
      preco: moneyBR(price), plano: (CYCLE_NAME[state.cycle] || '').toUpperCase(), ciclo: (CYCLE_NAME[state.cycle] || '').toLowerCase(),
      precoCiclos: cycles.join('  ·  '),
      mesesCiclo: months, totalCiclo: moneyBR(price * months),
      parcelado: months > 1 ? months + 'x de R$ ' + moneyBR(price) + ' sem juros' : 'cobrança mensal',
      roi: Math.max(1, Math.round(hiddenMonth / (price || 1))),
    };
  }

  // Resolve um caminho de interpolação. calc./state. viram spans dinâmicos; uma
  // resposta que mapeia o campo editável de contas/volume também vira span de
  // estado (faixa) — assim "X contas" aparece e é clicável onde quer que esteja.
  function interpPath(path) {
    if (path.indexOf('calc.') === 0 || path.indexOf('state.') === 0) return '<span data-fill="' + path + '"></span>';
    if (CALC.seatsKey && path === 'answers.' + CALC.seatsKey) return '<span data-fill="state.accounts"></span>';
    if (CALC.volumeKey && path === 'answers.' + CALC.volumeKey) return '<span data-fill="state.volume"></span>';
    // No modo closer (editable) lead.* e answers.* também viram spans dinâmicos
    // (clicáveis pra editar in-place e re-preenchidos por fillDynamic); fora dele
    // resolvem estático como antes (a view do lead fica idêntica).
    // answers.* podem ter rótulo humano em calc.answerLabels[key] (ex.: niche
    // "autopecas" → "Autopeças"); cai no valor cru quando não há mapa.
    if (path.indexOf('answers.') === 0) {
      if (P.editable) return '<span data-fill="' + path + '"></span>';
      var akey = path.slice(8);
      var raw = getPath(DATA, path);
      var map = (CALC.answerLabels || {})[akey];
      return esc(String(map && map[raw] != null ? map[raw] : raw));
    }
    if (path.indexOf('lead.') === 0 && P.editable) return '<span data-fill="' + path + '"></span>';
    return esc(String(getPath(DATA, path)));
  }
  // Interpolação: {{calc.x}}/{{state.x}} viram spans dinâmicos (recalculados pelo
  // painel do closer); {{lead.x}}/{{answers.x}} resolvem na construção.
  function fmt(s) {
    var out = esc(s);
    out = out.replace(/\\{\\{\\s*([a-zA-Z0-9_.]+)\\s*\\}\\}/g, function (_, path) { return interpPath(path); });
    out = out.replace(/\\*([^*]+)\\*/g, '<em>$1</em>');
    return out;
  }
  // answers com rótulo humano (answerLabels) pra preencher os spans do modo closer.
  function answersDisplay() {
    var a = DATA.answers || {}, out = {}, k;
    for (k in a) {
      var map = (CALC.answerLabels || {})[k];
      out[k] = (map && map[a[k]] != null) ? map[a[k]] : a[k];
    }
    return out;
  }
  function fillDynamic() {
    renderPlanOptions();
    var calc = compute();
    var D = { calc: calc, state: state, lead: DATA.lead || {}, answers: answersDisplay() };
    document.querySelectorAll('[data-fill]').forEach(function (el) {
      el.textContent = String(getPath(D, el.getAttribute('data-fill')));
    });
    fitSlides(); // números mudam altura do conteúdo — re-encaixa nos slides
  }

  // Grade de ciclos do slide pricing: um card por plano em calc.plans, com o
  // total cobrado no ciclo e o parcelamento sem juros. Clicar troca state.cycle
  // (só visual — congelar continua sendo papel do painel do closer).
  function renderPlanOptions() {
    document.querySelectorAll('[data-plan-options]').forEach(function (box) {
      var featured = box.getAttribute('data-plan-options') || CALC.defaultCycle || '';
      var badge = box.getAttribute('data-badge') || 'recomendado';
      var html = '';
      CYCLE_ORDER.forEach(function (k) {
        var pm = planPerMonth(k);
        if (pm == null) return;
        var months = CYCLE_MONTHS[k] || 1;
        var cls = 'plan-opt' + (k === featured ? ' featured' : '') + (k === state.cycle ? ' selected' : '');
        html += '<button type="button" class="' + cls + '" data-cycle="' + k + '">' +
          (k === featured ? '<span class="plan-opt-badge">' + esc(badge) + '</span>' : '') +
          '<span class="plan-opt-name">' + esc(CYCLE_NAME[k] || k) + '</span>' +
          '<span class="plan-opt-price">R$ ' + moneyBR(pm) + '<small>/mês</small></span>' +
          (months > 1
            ? '<span class="plan-opt-total">R$ ' + moneyBR(pm * months) + ' cobrados a cada ' + (months === 12 ? '12 meses' : months + ' meses') + '</span>' +
              '<span class="plan-opt-split">ou ' + months + 'x de R$ ' + moneyBR(pm) + ' sem juros</span>'
            : '<span class="plan-opt-total">cobrança mensal</span>') +
          '</button>';
      });
      box.innerHTML = html;
      box.querySelectorAll('[data-cycle]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          if (state.cycle === btn.getAttribute('data-cycle')) return;
          state.cycle = btn.getAttribute('data-cycle');
          fillDynamic();
          if (afterEdit) afterEdit();
        });
      });
    });
  }

  // Trava cada slide na altura da tela (desktop): se o conteúdo natural passa da
  // área útil do slide (viewport − nav − padding), escala pra caber. Nada de
  // slide mais alto que o monitor; o snap mandatory volta a ser seguro.
  function fitSlides() {
    var on = window.innerWidth >= 900 &&
      !(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    document.querySelectorAll('main > section > .wrap, main > header.hero > .wrap').forEach(function (w) {
      w.style.transform = '';
      if (!on) return;
      var sec = w.parentElement;
      var cs = window.getComputedStyle(sec);
      var avail = sec.clientHeight - (parseFloat(cs.paddingTop) || 0) - (parseFloat(cs.paddingBottom) || 0);
      var h = w.scrollHeight;
      if (h > avail && avail > 0) w.style.transform = 'scale(' + (avail / h).toFixed(4) + ')';
    });
  }

  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }

  // Mídia opcional do slide (s.media = { url, caption }): vídeo por extensão,
  // resto vira <img> (GIF incluso). load/loadedmetadata re-encaixam o slide.
  var VIDEO_RE = /\\.(mp4|webm|mov|m4v|ogv)([?#]|$)/i;
  function mediaNode(m) {
    if (!m || !m.url) return null;
    var fig = el('figure', 'slide-media');
    fig.setAttribute('data-reveal', '');
    var inner;
    if (VIDEO_RE.test(String(m.url))) {
      inner = document.createElement('video');
      inner.src = m.url;
      inner.controls = true;
      inner.playsInline = true;
      inner.preload = 'metadata';
      inner.addEventListener('loadedmetadata', fitSlides);
    } else {
      inner = document.createElement('img');
      inner.src = m.url;
      inner.alt = m.caption || '';
      inner.addEventListener('load', fitSlides);
    }
    fig.appendChild(inner);
    if (m.caption) fig.appendChild(el('figcaption', null, fmt(m.caption)));
    return fig;
  }

  // ── Slides ────────────────────────────────────────────────────────────────
  function band(s, num, total) {
    var b = el('div', 'band');
    var left = el('div', null);
    if (s.eyebrow) left.appendChild(el('div', 'eyebrow', fmt(s.eyebrow)));
    if (s.title) left.appendChild(el('h2', 'h-section', fmt(s.title)));
    b.appendChild(left);
    b.appendChild(el('div', 'band-num', String(num).padStart(2, '0') + '/' + String(total).padStart(2, '0')));
    return b;
  }
  function listHtml(arr, cls) {
    return (arr || []).map(function (x) { return '<div class="' + cls + '" data-reveal>' + fmt(x) + '</div>'; }).join('');
  }

  var BUILDERS = {
    hero: function (s) {
      var h = el('header', 'hero');
      h.appendChild(el('div', 'atmos'));
      var w = el('div', 'wrap');
      if (s.tag) w.appendChild(el('span', 'hero-tag', fmt(s.tag)));
      w.appendChild(el('h1', 'h-hero', fmt(s.title)));
      if (s.subtitle) { var ld = el('p', 'lead', fmt(s.subtitle)); ld.style.marginTop = '32px'; ld.setAttribute('data-reveal', ''); w.appendChild(ld); }
      if ((s.meta || []).length) {
        var dl = el('dl', 'hero-meta');
        dl.setAttribute('data-reveal', '');
        s.meta.forEach(function (m) {
          dl.innerHTML += '<div><dt>' + fmt(m.label) + '</dt><dd>' + fmt(m.value) + '</dd></div>';
        });
        w.appendChild(dl);
      }
      h.appendChild(w);
      return h;
    },
    cards: function (s, num, total) {
      var sec = el('section');
      sec.appendChild(el('div', 'atmos'));
      var w = el('div', 'wrap');
      w.appendChild(band(s, num, total));
      if (s.lead) { var ld = el('p', 'lead', fmt(s.lead)); ld.setAttribute('data-reveal', ''); w.appendChild(ld); }
      var g = el('div', 'grid g-4');
      g.style.marginTop = '48px';
      (s.cards || []).forEach(function (c) {
        g.innerHTML += '<div class="card" data-reveal><div class="diag-label">' + fmt(c.label) + '</div><div class="diag-value' + (c.small ? ' sm' : '') + '">' + fmt(c.value) + '</div>' + (c.tag ? '<div class="diag-tag">' + fmt(c.tag) + '</div>' : '') + '</div>';
      });
      if (s.highlight && s.highlight.title) {
        g.innerHTML += '<div class="card accent diag-highlight" data-reveal><div><div class="diag-label" style="color:var(--accent)">' + fmt(s.highlight.label || '') + '</div><h3>' + fmt(s.highlight.title) + '</h3></div>' + (s.highlight.pill ? '<span class="pill accent">' + fmt(s.highlight.pill) + '</span>' : '') + '</div>';
      }
      w.appendChild(g);
      sec.appendChild(w);
      return sec;
    },
    receipt: function (s, num, total) {
      var sec = el('section');
      sec.appendChild(el('div', 'atmos'));
      var w = el('div', 'wrap');
      w.appendChild(band(s, num, total));
      var rw = el('div', 'receipt-wrap');
      var leftHtml = '<div data-reveal>' + (s.body ? '<p class="body" style="max-width:520px">' + fmt(s.body) + '</p>' : '') + (s.note ? '<p class="receipt-note">' + fmt(s.note) + '</p>' : '') + '</div>';
      var rows = (s.rows || []).map(function (r) { return '<div class="receipt-row"><span>' + fmt(r.label) + '</span><b>' + fmt(r.value) + '</b></div>'; }).join('');
      var rightHtml = '<div class="receipt" data-reveal><div class="receipt-header"><div>' + fmt(s.header || '') + '</div><div>' + fmt(s.subheader || '') + '</div></div>' + rows +
        '<div class="receipt-total"><span>' + fmt(s.totalLabel || 'TOTAL') + '</span><b>' + fmt(s.totalValue || '') + '</b></div>' +
        (s.foot ? '<div class="receipt-foot">' + fmt(s.foot) + '</div>' : '') + '</div>';
      rw.innerHTML = leftHtml + rightHtml;
      w.appendChild(rw);
      sec.appendChild(w);
      return sec;
    },
    steps: function (s, num, total) {
      var sec = el('section');
      sec.appendChild(el('div', 'atmos'));
      var w = el('div', 'wrap');
      w.appendChild(band(s, num, total));
      var g = el('div', 'grid g-3');
      (s.steps || []).forEach(function (st, i) {
        var last = i === (s.steps.length - 1);
        g.innerHTML += '<div class="card step-card' + (last ? ' accent' : '') + '" data-reveal><div class="step-tag">' + fmt(st.tag || '') + '</div><h3>' + fmt(st.title || '') + '</h3><p>' + fmt(st.text || '') + '</p></div>';
      });
      w.appendChild(g);
      if ((s.pills || []).length) {
        var pr = el('div', 'pill-row');
        pr.setAttribute('data-reveal', '');
        s.pills.forEach(function (pl) { pr.innerHTML += '<span class="pill">' + fmt(pl) + '</span>'; });
        w.appendChild(pr);
      }
      sec.appendChild(w);
      return sec;
    },
    compare: function (s, num, total) {
      var sec = el('section');
      sec.appendChild(el('div', 'atmos'));
      var w = el('div', 'wrap');
      w.appendChild(band(s, num, total));
      // tone controla a COR da coluna (good = accent/check, bad = erro/cross),
      // independente da posição. Default segue a posição (before = bad, after =
      // good) — compatível com templates antigos. Permite duas colunas positivas
      // lado a lado (ex.: economia | receita).
      function col(c, pos) {
        var tone = c.tone || (pos === 'before' ? 'bad' : 'good');
        var vis = tone === 'good' ? 'after' : 'before';
        var ptCls = tone === 'good' ? 'check' : 'cross';
        var pts = (c.points || []).map(function (pt) { return '<div class="point ' + ptCls + '"><span class="point-body">' + fmt(pt) + '</span></div>'; }).join('');
        return '<div class="compare-col ' + vis + '">' + (c.kicker ? '<div class="compare-kicker">' + fmt(c.kicker) + '</div>' : '') + '<div class="compare-lbl">▍ ' + fmt(c.label || '') + '</div><div class="compare-num">' + fmt(c.num || '') + '<span class="unit"> ' + fmt(c.unit || '') + '</span></div><div class="compare-sub">' + fmt(c.sub || '') + '</div><div class="point-list">' + pts + '</div></div>';
      }
      var cmp = el('div', 'compare');
      cmp.setAttribute('data-reveal', '');
      cmp.innerHTML = col(s.before || {}, 'before') + col(s.after || {}, 'after');
      w.appendChild(cmp);
      sec.appendChild(w);
      return sec;
    },
    bignum: function (s, num, total) {
      var sec = el('section');
      sec.appendChild(el('div', 'atmos'));
      var w = el('div', 'wrap');
      w.appendChild(band(s, num, total));
      var rw = el('div', 'roi-wrap');
      var items = (s.items || []).map(function (it) { return '<div class="ret-step"><span class="ret-body">' + fmt(it) + '</span></div>'; }).join('');
      rw.innerHTML = '<div data-reveal><div class="ret-steps">' + items + '</div>' + (s.note ? '<div class="ret-uplift">' + fmt(s.note) + '</div>' : '') + '</div>' +
        '<div class="roi-big" data-reveal><div class="roi-label">' + fmt(s.bigLabel || '') + '</div><div class="roi-num">' + fmt(s.bigValue || '') + '</div>' + (s.bigLabel2 ? '<div class="roi-label" style="margin-bottom:18px">' + fmt(s.bigLabel2) + '</div>' : '') + '<div class="roi-caption">' + fmt(s.bigCaption || '') + '</div></div>';
      w.appendChild(rw);
      sec.appendChild(w);
      return sec;
    },
    // Calculadora interativa: o lead digita anúncios/mês, faturamento e custo de
    // funcionário; a página recalcula tempo/dinheiro economizados e a projeção de
    // faturamento (+X% em N meses) ao vivo. Parâmetros vêm do slide, com fallback
    // no calc do template (minCopy=10min, salaryMonthly=3000, workHours=176,
    // revenueUpliftPct=50). Anúncios/mês pré-preenchem da resposta de volume
    // (anúncios/semana × 4,3), se houver. Tudo client-side; nada é salvo.
    calculator: function (s, num, total) {
      var sec = el('section');
      sec.appendChild(el('div', 'atmos'));
      var w = el('div', 'wrap');
      w.appendChild(band(s, num, total));
      if (s.lead) { var ld = el('p', 'lead', fmt(s.lead)); ld.setAttribute('data-reveal', ''); w.appendChild(ld); }

      function nOr(v, d) { v = Number(v); return isFinite(v) ? v : d; }
      var minPerAd = nOr(s.minutesPerAd, nOr(CALC.minCopy, 10));
      var workHours = nOr(s.workHours, nOr(CALC.workHours, 176));
      var uplift = nOr(s.revenueUpliftPct, nOr(CALC.revenueUpliftPct, 50)) / 100;
      var upMonths = Math.round(nOr(s.upliftMonths, 6));

      var vAns = (DATA.answers || {})[CALC.volumeKey || 'volume'];
      var adsWeek = nOr((CALC.volumeMid || {})[vAns], 0);
      var ads0 = adsWeek > 0 ? Math.round(adsWeek * 4.3) : Math.round(nOr(s.adsDefault, 100));
      var rev0 = Math.round(nOr(s.revenueDefault, 50000));
      var sal0 = Math.round(nOr(s.salaryMonthly, nOr(CALC.salaryMonthly, 3000)));

      function field(id, label, prefix, suffix, val, note) {
        return '<div class="calc-field"><label for="' + id + '">' + fmt(label) + '</label>' +
          '<div class="calc-inputbox">' + (prefix ? '<span class="affix">' + esc(prefix) + '</span>' : '') +
          '<input id="' + id + '" type="number" min="0" step="1" inputmode="numeric" value="' + esc(String(val)) + '">' +
          (suffix ? '<span class="affix">' + esc(suffix) + '</span>' : '') + '</div>' +
          (note ? '<div class="calc-note">' + fmt(note) + '</div>' : '') + '</div>';
      }
      function cell(id, label) {
        return '<div class="calc-cell hl"><div class="calc-cell-label">' + fmt(label) + '</div>' +
          '<div class="calc-cell-num" id="' + id + '">…</div><div class="calc-cell-sub" id="' + id + '-sub"></div></div>';
      }

      var host = el('div', 'calc-grid');
      host.setAttribute('data-reveal', '');
      host.innerHTML =
        '<div class="calc-inputs">' +
          field('ca-ads', s.adsLabel || 'Anúncios novos por mês', '', 'un.', ads0, s.adsNote || 'Só os anúncios que a operação cria do zero. Pode ser a média do mês.') +
          field('ca-rev', s.revenueLabel || 'Faturamento de hoje / mês', 'R$', '', rev0, s.revenueNote || 'Quanto a operação fatura num mês normal.') +
          field('ca-sal', s.salaryLabel || 'Custo de 1 funcionário / mês', 'R$', '', sal0, s.salaryNote || 'Salário + encargos. A gente ajusta pro número da sua operação.') +
        '</div>' +
        '<div class="calc-res">' +
          cell('ca-time', s.timeLabel || 'Tempo que volta pro time / mês') +
          cell('ca-save', s.saveLabel || 'Economia com mão de obra / ano') +
          cell('ca-proj', (s.projLabel || 'Faturamento projetado em {n} meses').replace('{n}', upMonths)) +
          cell('ca-gain', s.gainLabel || 'A mais no caixa / mês') +
        '</div>';
      w.appendChild(host);
      sec.appendChild(w);

      // Refs pela subárvore (a seção ainda não está no documento durante o build).
      var q = function (id) { return host.querySelector('#' + id); };
      var inAds = q('ca-ads'), inRev = q('ca-rev'), inSal = q('ca-sal');
      var money = function (n) { return 'R$ ' + intBR(Math.round(n)); };
      function recompute() {
        var ads = Math.max(0, nOr(inAds.value, 0));
        var rev = Math.max(0, nOr(inRev.value, 0));
        var sal = Math.max(0, nOr(inSal.value, 0));
        var hMonth = ads * minPerAd / 60;
        var hYear = hMonth * 12;
        var hourly = workHours > 0 ? sal / workHours : 0;
        var saveMonth = hMonth * hourly;
        var proj = rev * (1 + uplift);
        var gain = rev * uplift;
        q('ca-time').textContent = intBR(Math.round(hMonth)) + ' h';
        q('ca-time-sub').textContent = '≈ ' + intBR(Math.round(hYear / 8)) + ' dias úteis por ano';
        q('ca-save').textContent = money(saveMonth * 12);
        q('ca-save-sub').textContent = money(saveMonth) + ' por mês';
        q('ca-proj').textContent = money(proj);
        q('ca-proj-sub').textContent = '+' + Math.round(uplift * 100) + '% sobre hoje';
        q('ca-gain').textContent = '+' + money(gain);
        q('ca-gain-sub').textContent = 'a partir do ' + upMonths + 'º mês';
        fitSlides();
      }
      [inAds, inRev, inSal].forEach(function (i) { i.addEventListener('input', recompute); });
      recompute();
      return sec;
    },
    pricing: function (s, num, total) {
      var hasOpts = s.optionsFeatured != null && s.optionsFeatured !== '';
      // Reveal do preço: elementos que o véu controla NÃO levam data-reveal
      // (os dois mecanismos disputariam opacity/transform).
      var reveal = !!s.revealPrice;
      var sec = el('section', ((hasOpts ? 'compact-pricing ' : '') + (reveal ? 'price-pending' : '')).trim() || null);
      var w = el('div', 'wrap');
      w.appendChild(band(s, num, total));
      if (hasOpts) {
        var po = el('div', 'plan-opts');
        if (!reveal) po.setAttribute('data-reveal', '');
        po.setAttribute('data-plan-options', String(s.optionsFeatured));
        if (s.optionsBadge) po.setAttribute('data-badge', String(s.optionsBadge));
        w.appendChild(po); // conteúdo entra via renderPlanOptions() (dinâmico)
      }
      var pw = el('div', 'price-wrap');
      // Feature pode ser string (sempre visível) ou { text, showIf:{key,values} }
      // (visível só quando a resposta do lead bate — ex.: compat veicular p/ autopeças).
      var fAns = (DATA && DATA.answers) || {};
      function visibleFeats(list) {
        return (list || []).filter(function (f) {
          if (!f || typeof f !== 'object' || !f.showIf || !f.showIf.key) return true;
          var want = (Array.isArray(f.showIf.values) ? f.showIf.values : [f.showIf.values])
            .map(function (v) { return String(v == null ? '' : v).trim().toLowerCase(); });
          var a = fAns[f.showIf.key];
          var got = (Array.isArray(a) ? a : [a]).map(function (v) { return String(v == null ? '' : v).trim().toLowerCase(); });
          return got.some(function (g) { return want.indexOf(g) >= 0; });
        });
      }
      function featLi(f, cls) {
        return '<li' + (cls ? ' class="' + cls + '"' : '') + '>' + fmt(typeof f === 'object' ? (f.text || '') : f) + '</li>';
      }
      // Benefícios em grupos encadeados (s.benefitGroups, só com revealPrice):
      // cada comando de avanço revela UM item (título do grupo entra junto com
      // o primeiro); "synth" do grupo é o banner-síntese (ex.: economia total).
      // Esgotados os passos, o próximo comando revela o preço. Sem grupos, a
      // lista plana de s.features renderiza como sempre.
      var groups = reveal && Array.isArray(s.benefitGroups) && s.benefitGroups.length ? s.benefitGroups : null;
      var benefitsInner;
      if (groups) {
        benefitsInner = groups.map(function (g) {
          var items = visibleFeats(g.items);
          if (!items.length) return '';
          return (g.title ? '<div class="bg-title stage-item">' + fmt(g.title) + '</div>' : '') +
            '<ul class="price-list">' + items.map(function (f) { return featLi(f, 'stage-item'); }).join('') + '</ul>' +
            (g.synth ? '<div class="benefit-synth stage-item">' + fmt(g.synth) + '</div>' : '');
        }).join('');
      } else {
        benefitsInner = '<ul class="price-list">' + visibleFeats(s.features).map(function (f) { return featLi(f, ''); }).join('') + '</ul>';
      }
      // Esquerda: só o bloco de preço. Direita: benefícios/entregáveis (features).
      // Garantia e payback são opcionais (só entram se preenchidos no template).
      var hasGuarantee = (s.guaranteeTitle || s.guaranteeText || s.guaranteeHead);
      // Card de preço parametrizado: usado pela oferta principal e, quando
      // s.offer2 existe, pela segunda oferta (ex.: pacote semestral), que entra
      // abaixo da primeira num avanço extra e acinzenta a principal (comparativo).
      function priceCardHtml(o, cls, dr) {
        return '<div class="price-card' + (cls ? ' ' + cls : '') + '"' + (dr ? ' data-reveal' : '') + '>' +
          '<div class="price-head"><div class="price-tag">' + fmt(o.planTag || '') + '</div>' +
            (o.planPill ? '<span class="pill accent">' + fmt(o.planPill) + '</span>' : '') + '</div>' +
          (o.priceFrom ? '<div class="price-from">de R$ ' + fmt(o.priceFrom) + '</div>' : '') +
          '<div class="price-number">' + (o.pricePrefix ? '<span class="currency">' + fmt(o.pricePrefix) + '</span>' : '') + (o.currency === false ? '' : '<span class="currency">R$</span>') + '<span class="price-main"><span class="amount">' + fmt(o.price || '{{calc.preco}}') + '</span><span class="per">' + fmt(o.per || '/ mês') + '</span></span></div>' +
          (o.sub ? '<div class="price-sub">' + fmt(o.sub) + '</div>' : '') +
          '<div class="price-cycles">' + (o.cyclesLabel ? fmt(o.cyclesLabel) + ' ' : '') + (o.cyclesFrom ? '<span class="cycles-from">' + fmt(o.cyclesFrom) + '</span> ' : '') + fmt(o.cycles != null ? o.cycles : '{{calc.precoCiclos}}') + '</div>' +
        '</div>';
      }
      var hasOffer2 = !!(s.offer2 && (s.offer2.price || s.offer2.planTag));
      var hasOffer3 = !!(s.offer3 && (s.offer3.price || s.offer3.planTag));
      // Ofertas 2 e 3 são secretas (Shift+Espaço em sequência, no modo reveal):
      // sem revealPrice ficam no DOM mas nunca aparecem, de propósito.
      // O wrapper .price-reveal mantém os cards na MESMA célula do grid
      // (empilhados, ancorados no rodapé); sem ele cairiam na coluna dos benefícios.
      var wrapCards = reveal || hasOffer2 || hasOffer3;
      var offersHtml =
        priceCardHtml(s, hasOffer2 || hasOffer3 ? 'offer1' : '', !reveal) +
        (hasOffer2 ? priceCardHtml(s.offer2, 'offer2', false) : '') +
        (hasOffer3 ? priceCardHtml(s.offer3, 'offer3', false) : '');
      var veilHtml = reveal ? '<div class="price-veil" aria-hidden="true"></div>' : '';
      var guaranteeHtml = hasGuarantee ? '<div class="guarantee" style="margin-top:16px"><div class="guarantee-head">' +
        '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L4 6v6c0 5.5 3.5 9.5 8 10 4.5-.5 8-4.5 8-10V6l-8-4z" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
        '<span>' + fmt(s.guaranteeHead || '') + '</span></div><h3>' + fmt(s.guaranteeTitle || '') + '</h3><p>' + fmt(s.guaranteeText || '') + '</p></div>' : '';
      var paybackHtml = s.paybackNum ? '<div class="payback"><div class="mono">' + fmt(s.paybackLabel || '') + '</div><div class="pb-num">' + fmt(s.paybackNum) + '</div><div class="pb-cap">' + fmt(s.paybackCaption || '') + '</div></div>' : '';
      if (groups) {
        // Layout empilhado (só quando há benefitGroups, ex.: slide de Investimento):
        // (1) benefícios num ÚNICO bloco, com os 3 grupos em colunas separadas por
        // divisória; (2) preço numa faixa horizontal LARGA que o conteúdo preenche
        // por inteiro. A escada secreta (ofertas 2/3) NÃO cria card novo: troca o
        // conteúdo DENTRO da mesma faixa — arrasta o preço anterior pro lado,
        // riscado (âncora de comparação), e sobe o novo preço + o novo plano.
        pw.className = 'price-wrap price-stack';
        var colsHtml = groups.map(function (g) {
          var items = visibleFeats(g.items);
          if (!items.length) return '';
          return '<div class="benefit-group">' +
            (g.title ? '<div class="bg-title stage-item">' + fmt(g.title) + '</div>' : '') +
            '<ul class="price-list">' + items.map(function (f) { return featLi(f, 'stage-item'); }).join('') + '</ul>' +
            (g.synth ? '<div class="benefit-synth stage-item">' + fmt(g.synth) + '</div>' : '') +
          '</div>';
        }).join('');
        // Um painel por oferta ocupando a faixa inteira; só o ativo aparece. O(s)
        // preço(s) anterior(es) entram riscados ao lado do novo (comparação).
        var offersArr = [s];
        if (hasOffer2) offersArr.push(s.offer2);
        if (hasOffer3) offersArr.push(s.offer3);
        function priceLine(o) {
          return (o.pricePrefix ? '<span class="currency">' + fmt(o.pricePrefix) + '</span>' : '') +
            (o.currency === false ? '' : '<span class="currency">R$</span>') +
            '<span class="price-main"><span class="amount">' + fmt(o.price || '{{calc.preco}}') + '</span><span class="per">' + fmt(o.per || '/ mês') + '</span></span>';
        }
        function cyclesLine(o) {
          return (o.cyclesLabel ? fmt(o.cyclesLabel) + ' ' : '') + fmt(o.cycles != null ? o.cycles : '{{calc.precoCiclos}}');
        }
        var panelsHtml = offersArr.map(function (o, i) {
          // Âncoras de comparação: as ofertas anteriores. A oferta 1 (base) sempre
          // aparece; as secretas (2/3) só entram na comparação se tiverem sido
          // ativadas — se o closer pula direto pra 3ª, a 2ª não aparece (off-need).
          var prev = offersArr.slice(0, i).map(function (p, j) {
            var needCls = j >= 1 ? ' off-need-' + (j + 1) : '';
            return '<div class="pb-old' + needCls + '"><span class="pb-old-tag">' + fmt(p.planTag || '') + '</span><span class="pb-old-price">' + priceLine(p) + '</span></div>';
          }).join('');
          return '<div class="pb-offer" data-o="' + (i + 1) + '">' +
            '<div class="pb-left">' +
              '<div class="price-tag">' + fmt(o.planTag || '') + '</div>' +
              (o.planPill ? '<span class="pill accent">' + fmt(o.planPill) + '</span>' : '') +
            '</div>' +
            '<div class="pb-center">' +
              (prev ? '<div class="pb-compare">' + prev + '</div>' : '') +
              '<div class="price-number pb-price">' + priceLine(o) + '</div>' +
            '</div>' +
            '<div class="pb-right">' +
              '<div class="price-cycles">' + cyclesLine(o) + '</div>' +
            '</div>' +
          '</div>';
        }).join('');
        pw.innerHTML =
          '<div class="benefits-card benefits-single" data-reveal>' +
            (s.featuresTitle ? '<div class="benefits-title">' + fmt(s.featuresTitle) + '</div>' : '') +
            '<div class="benefit-grid">' + colsHtml + '</div>' +
          '</div>' +
          '<div class="price-reveal price-band' + (hasOffer2 || hasOffer3 ? ' has-ladder' : '') + '">' +
            '<div class="pb-stage">' + panelsHtml + '</div>' + veilHtml +
          '</div>' +
          (guaranteeHtml || paybackHtml ? '<div data-reveal style="margin-top:16px">' + guaranteeHtml + paybackHtml + '</div>' : '');
      } else {
        pw.innerHTML =
          (wrapCards ? '<div class="price-reveal' + (hasOffer2 || hasOffer3 ? ' has-offer2' : '') + '">' : '') +
          offersHtml + veilHtml +
          (wrapCards ? '</div>' : '') +
          '<div data-reveal>' +
            '<div class="benefits-card">' + (s.featuresTitle ? '<div class="benefits-title">' + fmt(s.featuresTitle) + '</div>' : '') +
              benefitsInner + '</div>' +
            guaranteeHtml + paybackHtml + '</div>';
      }
      w.appendChild(pw);
      if (reveal) {
        // Fila de passos: título+1º item juntos, depois um elemento por comando.
        var steps = [];
        if (groups) {
          var pendTitle = null;
          pw.querySelectorAll('.stage-item').forEach(function (n) {
            if (n.classList.contains('bg-title')) { pendTitle = n; return; }
            steps.push(pendTitle ? [pendTitle, n] : [n]);
            pendTitle = null;
          });
        }
        var advance = function () {
          if (!sec.classList.contains('price-pending')) return;
          if (steps.length) { steps.shift().forEach(function (n) { n.classList.add('on'); }); return; }
          sec.classList.remove('price-pending');
          sec.classList.add('price-revealed');
        };
        var inView = function () {
          var r = sec.getBoundingClientRect();
          var mid = (window.innerHeight || document.documentElement.clientHeight) / 2;
          return r.top <= mid && r.bottom >= mid;
        };
        // "Comando de passar o slide": tecla de avanço com o slide dominando a
        // viewport (senão a tecla estaria rolando outra parte da página), ou
        // clique/tap em qualquer ponto da seção. Sem botão visível de propósito.
        sec.addEventListener('click', advance);
        document.addEventListener('keydown', function (e) {
          // Ofertas 2 e 3 são SECRETAS (ferramentas de negociação do closer):
          // Shift+1 revela a 2ª oferta, Shift+2 revela a 3ª — dá pra pular direto
          // pra 3ª sem passar pela 2ª. Nunca por clique/avanço normal nem no print.
          // Usa e.code (Shift+1 = "!" em e.key, mas a tecla física é Digit1).
          if (!sec.classList.contains('price-pending') && e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
            var code = e.code;
            if ((code === 'Digit1' || code === 'Numpad1') && hasOffer2) {
              if (!inView()) return;
              e.preventDefault();
              sec.classList.remove('offer3-on');
              sec.classList.add('offer2-on');
              fitSlides();
              return;
            }
            if ((code === 'Digit2' || code === 'Numpad2') && hasOffer3) {
              if (!inView()) return;
              e.preventDefault();
              sec.classList.add('offer3-on');
              fitSlides();
              return;
            }
          }
          if (!sec.classList.contains('price-pending')) return;
          var k = e.key;
          if (k !== 'ArrowRight' && k !== 'ArrowDown' && k !== 'PageDown' && k !== ' ' && k !== 'Enter') return;
          if (!inView()) return;
          e.preventDefault();
          advance();
        });
      }
      if (s.closeLine) { var cl = el('div', 'close-line', fmt(s.closeLine)); if (!reveal) cl.setAttribute('data-reveal', ''); w.appendChild(cl); }
      if (s.acceptLabel) {
        var ar = el('div', 'accept-row');
        if (!reveal) ar.setAttribute('data-reveal', '');
        if (P.accepted) {
          ar.appendChild(el('span', 'accept-done', '✓ Proposta aceita'));
        } else {
          var btn = el('button', 'accept-btn', fmt(s.acceptLabel));
          btn.onclick = function () {
            btn.disabled = true; btn.textContent = 'Confirmando…';
            fetch('/public/proposals/' + encodeURIComponent(P.id) + '/accept', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
              .then(function (r) { if (!r.ok) throw new Error('falha'); ar.innerHTML = '<span class="accept-done">✓ Proposta aceita — vamos te chamar!</span>'; })
              .catch(function () { btn.disabled = false; btn.textContent = 'Tentar de novo'; });
          };
          ar.appendChild(btn);
        }
        w.appendChild(ar);
      }
      sec.appendChild(w);
      return sec;
    },
    // O bloco do closer ANEXA à seção anterior (padrão da referência: ele fecha
    // a seção de investimento) — só vira seção própria se for o primeiro slide.
    closer: function (s) {
      var cb = el('div', 'closer-block');
      cb.setAttribute('data-reveal', '');
      var initial = (s.name || 'C').trim().charAt(0).toUpperCase();
      cb.innerHTML = '<div class="closer-avatar">' + (s.photo ? '<img src="' + esc(s.photo) + '" alt="">' : esc(initial)) + '</div>' +
        '<div class="closer-info"><div class="closer-label">' + fmt(s.label || 'Seu contato') + '</div><div class="closer-name">' + fmt(s.name || '') + '</div></div>' +
        (s.ctaUrl ? '<a class="closer-cta" href="' + esc(s.ctaUrl) + '" target="_blank" rel="noopener">' + fmt(s.ctaLabel || 'Falar no WhatsApp') + '</a>' : '');
      var prev = root.lastElementChild;
      var wrap = prev && prev.querySelector ? prev.querySelector('.wrap') : null;
      if (wrap) { wrap.appendChild(cb); return null; }
      var sec = el('section', 'light');
      var w = el('div', 'wrap');
      w.appendChild(cb);
      sec.appendChild(w);
      return sec;
    },
    custom: function (s, num, total) {
      var sec = el('section');
      sec.appendChild(el('div', 'atmos'));
      var w = el('div', 'wrap');
      if (s.eyebrow || s.title) w.appendChild(band(s, num, total));
      var holder = el('div', null);
      // HTML autoral do dono (mesmo nível de confiança do template) — vai cru,
      // mas as interpolações {{...}} e *itálico* funcionam dentro dele.
      var raw = String(s.html || '');
      raw = raw.replace(/\\{\\{\\s*([a-zA-Z0-9_.]+)\\s*\\}\\}/g, function (_, path) { return interpPath(path); });
      holder.innerHTML = raw;
      w.appendChild(holder);
      sec.appendChild(w);
      return sec;
    },
  };

  function render() {
    root.innerHTML = '';
    var numbered = SLIDES.filter(function (s) { return s.type !== 'hero' && s.type !== 'closer'; }).length;
    var n = 0;
    SLIDES.forEach(function (s) {
      var build = BUILDERS[s.type];
      if (!build) return;
      if (s.type !== 'hero' && s.type !== 'closer') n += 1;
      var node = build(s, n, numbered);
      // Ritmo claro/escuro como a home: slide com bg:'dark' vira bloco escuro.
      if (node && node.classList && (s.bg === 'dark' || s.tone === 'dark')) node.classList.add('sec-dark');
      if (node) root.appendChild(node); // closer pode ter anexado à seção anterior
      var media = mediaNode(s.media);
      if (media) {
        var host = node || root.lastElementChild; // closer: mídia vai pra seção que o recebeu
        var wrap = host && host.querySelector ? host.querySelector('.wrap') : null;
        if (wrap) wrap.appendChild(media);
      }
    });
    var foot = el('footer', 'foot');
    foot.innerHTML = '<div class="wrap"><div class="foot-meta">' + fmt(P.footer || (P.name || '')) + '<br>Proposta válida apenas no dia da apresentação · <b>' + new Date().toLocaleDateString('pt-BR') + '</b></div></div>';
    root.appendChild(foot);
    fillDynamic(); // já chama fitSlides()
    bindReveal();
  }

  // Re-encaixe quando a medida muda: resize, fontes carregadas (altura real só
  // existe depois delas) e impressão (transform some no print e volta depois).
  window.addEventListener('resize', fitSlides);
  window.addEventListener('load', fitSlides);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitSlides);
  window.addEventListener('beforeprint', function () {
    document.querySelectorAll('main > section > .wrap, main > header.hero > .wrap').forEach(function (w) { w.style.transform = ''; });
  });
  window.addEventListener('afterprint', fitSlides);

  function bindReveal() {
    var items = document.querySelectorAll('[data-reveal]');
    var vh = window.innerHeight || document.documentElement.clientHeight;
    items.forEach(function (it) { if (it.getBoundingClientRect().top < vh * 0.95) it.classList.add('in'); });
    document.body.classList.add('js-ready');
    if (!('IntersectionObserver' in window)) { items.forEach(function (it) { it.classList.add('in'); }); return; }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
    }, { rootMargin: '0px 0px -10% 0px', threshold: 0.05 });
    items.forEach(function (it) { if (!it.classList.contains('in')) io.observe(it); });
    setTimeout(function () { document.querySelectorAll('[data-reveal]:not(.in)').forEach(function (it) { it.classList.add('in'); }); }, 1500);
  }

  // ── Edição inline (modo closer via ?k) ────────────────────────────────────
  // Sem painel: o closer clica direto no número (contas/volume/ciclo/preço/
  // validade), escolhe no popover e a página recalcula + auto-salva (PATCH).
  function mountInlineEdit() {
    var token = new URLSearchParams(location.search).get('k') || '';
    var tag = el('div', 'save-tag', '');
    document.body.appendChild(tag);
    var saveTimer = null;
    function flash(text, cls) { tag.textContent = text; tag.className = 'save-tag show' + (cls ? ' ' + cls : ''); }
    function doSave() {
      flash('salvando…', '');
      fetch('/public/proposals/' + encodeURIComponent(P.id), {
        method: 'PATCH', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ k: token, accounts: state.accounts, volume: state.volume, cycle: state.cycle, customPriceCents: state.customPriceCents, validUntil: state.validUntil, frozen: true, company: DATA.lead.company, name: DATA.lead.name, niche: DATA.answers.niche })
      }).then(function (r) { if (!r.ok) throw new Error('falha'); return r.json(); })
        .then(function () { flash('salvo ✓', 'ok'); setTimeout(function () { tag.className = 'save-tag'; }, 1600); })
        .catch(function () { flash('✕ erro ao salvar', 'err'); });
    }
    function scheduleSave() {
      state.frozen = true;
      if (saveTimer) clearTimeout(saveTimer);
      flash('salvando…', '');
      saveTimer = setTimeout(doSave, 600);
    }
    afterEdit = scheduleSave; // grade de planos também salva

    // Monta o controle do campo, ligado ao state; chama done() a cada alteração.
    function control(field, done) {
      var ctl, k, o, dp, vp;
      if (field === 'accounts') {
        ctl = document.createElement('select');
        // Ordena as faixas pelo valor numérico (o jsonb do Postgres reordena as chaves).
        var sm = CALC.seatsMap || {};
        Object.keys(sm).sort(function (a, b) { return (Number(sm[a]) || 0) - (Number(sm[b]) || 0); }).forEach(function (kk) {
          o = document.createElement('option'); o.value = kk; o.textContent = kk + ' contas'; if (kk === state.accounts) o.selected = true; ctl.appendChild(o);
        });
        ctl.addEventListener('change', function () { state.accounts = ctl.value; state.seats = Number((CALC.seatsMap || {})[ctl.value]) || state.seats; done(); });
      } else if (field === 'volume') {
        ctl = document.createElement('select');
        var vm = CALC.volumeMid || {};
        Object.keys(vm).sort(function (a, b) { return (Number(vm[a]) || 0) - (Number(vm[b]) || 0); }).forEach(function (kk) {
          o = document.createElement('option'); o.value = kk; o.textContent = kk; if (kk === state.volume) o.selected = true; ctl.appendChild(o);
        });
        ctl.addEventListener('change', function () { state.volume = ctl.value; done(); });
      } else if (field === 'cycle') {
        ctl = document.createElement('select');
        CYCLE_ORDER.forEach(function (c) { if (!(CALC.plans || {})[c]) return; o = document.createElement('option'); o.value = c; o.textContent = CYCLE_NAME[c]; if (c === state.cycle) o.selected = true; ctl.appendChild(o); });
        ctl.addEventListener('change', function () { state.cycle = ctl.value; done(); });
      } else if (field === 'price') {
        ctl = document.createElement('input'); ctl.type = 'number'; ctl.min = '0'; ctl.step = '1'; ctl.placeholder = 'auto';
        ctl.value = state.customPriceCents ? Math.round(state.customPriceCents / 100) : '';
        ctl.addEventListener('input', function () { var v = parseInt(ctl.value, 10); state.customPriceCents = v > 0 ? v * 100 : 0; done(); });
      } else if (field === 'valid') {
        ctl = document.createElement('input'); ctl.type = 'date';
        if (state.validUntil && /^\\d{2}\\/\\d{2}\\/\\d{4}$/.test(state.validUntil)) { dp = state.validUntil.split('/'); ctl.value = dp[2] + '-' + dp[1] + '-' + dp[0]; }
        ctl.addEventListener('change', function () { if (ctl.value) { vp = ctl.value.split('-'); state.validUntil = vp[2] + '/' + vp[1] + '/' + vp[0]; done(); } });
      } else if (field === 'company') {
        ctl = document.createElement('input'); ctl.type = 'text'; ctl.placeholder = 'Empresa';
        ctl.value = DATA.lead.company || '';
        ctl.addEventListener('input', function () { DATA.lead.company = ctl.value; done(); });
      } else if (field === 'name') {
        ctl = document.createElement('input'); ctl.type = 'text'; ctl.placeholder = 'Nome do cliente';
        ctl.value = DATA.lead.name || '';
        ctl.addEventListener('input', function () { DATA.lead.name = ctl.value; DATA.lead.firstName = ctl.value.trim().split(/\\s+/)[0] || ''; done(); });
      } else if (field === 'staff') {
        // Select simples (igual Contas), com as faixas de answerLabels.staff.
        ctl = document.createElement('select');
        var stm = (CALC.answerLabels || {}).staff || {}, curs = DATA.answers.staff || '', seens = {};
        o = document.createElement('option'); o.value = ''; o.textContent = '—'; ctl.appendChild(o);
        for (k in stm) { o = document.createElement('option'); o.value = k; o.textContent = stm[k]; if (k === curs) o.selected = true; seens[k] = 1; ctl.appendChild(o); }
        if (curs && !seens[curs]) { o = document.createElement('option'); o.value = curs; o.textContent = curs; o.selected = true; ctl.appendChild(o); }
        ctl.addEventListener('change', function () { DATA.answers.staff = ctl.value; done(); });
      } else if (field === 'niche') {
        // Select com os nichos padrão + opção "Digite…": ao escolher, aparece um
        // input pra um nicho fora da lista (os padrão continuam no dropdown).
        var nmap = (CALC.answerLabels || {}).niche || {}, ncur = DATA.answers.niche || '', nknown = nmap[ncur] != null;
        var wrap = document.createElement('div'); wrap.className = 'setup-combo';
        var sel = document.createElement('select'); sel.className = 'setup-input';
        var inp = document.createElement('input'); inp.type = 'text'; inp.className = 'setup-input'; inp.placeholder = 'Digite o nicho'; inp.style.display = 'none';
        for (k in nmap) { o = document.createElement('option'); o.value = k; o.textContent = nmap[k]; sel.appendChild(o); }
        o = document.createElement('option'); o.value = '__c'; o.textContent = 'Digite…'; sel.appendChild(o);
        if (nknown) { sel.value = ncur; }
        else if (ncur) { sel.value = '__c'; inp.style.display = ''; inp.value = ncur; }
        sel.addEventListener('change', function () {
          if (sel.value === '__c') { inp.style.display = ''; inp.value = ''; inp.focus(); DATA.answers.niche = ''; done(); }
          else { inp.style.display = 'none'; DATA.answers.niche = sel.value; done(); }
        });
        inp.addEventListener('input', function () { DATA.answers.niche = inp.value; done(); });
        wrap.appendChild(sel); wrap.appendChild(inp);
        ctl = wrap;
      }
      if (ctl && (ctl.tagName === 'SELECT' || ctl.tagName === 'INPUT')) ctl.classList.add('setup-input');
      return ctl;
    }

    // Edição inline nos slides (canetas ✎ + popover) REMOVIDA de propósito: o link
    // ?k é a apresentação do cliente, então os campos dos slides ficam LIMPOS (sem
    // caneta, sem clique). A edição acontece só na tela de setup abaixo, que replica
    // na apresentação ao vivo. Os data-fill de lead.*/answers.* seguem se
    // atualizando por fillDynamic quando o closer edita no setup.

    // Painel de setup do closer: uma "tela zero" ANTES da capa (só no modo ?k) com
    // os campos da capa em formulário. Reusa control() (mesmo binding do popover),
    // então editar aqui replica na apresentação na hora (fillDynamic) e salva (+lead).
    // Definido AQUI dentro pra enxergar control()/scheduleSave().
    function buildSetup() {
      var sec = el('section', 'closer-setup');
      var w = el('div', 'wrap');
      w.appendChild(el('span', 'hero-tag', 'Antes de começar'));
      w.appendChild(el('h2', 'setup-title', 'Confira os dados antes de apresentar'));
      w.appendChild(el('p', 'setup-sub', 'Ajuste o que precisar. As mudanças entram na apresentação na hora.'));
      var grid = el('div', 'setup-grid');
      // Campos condicionais ao produto: nicho/contas/anúncios só entram se o calc
      // tiver a config (outros SaaS sem esses mapas não mostram select vazio).
      var fields = [['name', 'Cliente'], ['company', 'Empresa']];
      if (CALC.answerLabels && CALC.answerLabels.niche && Object.keys(CALC.answerLabels.niche).length) fields.push(['niche', 'Nicho']);
      if (CALC.seatsMap && Object.keys(CALC.seatsMap).length) fields.push(['accounts', 'Contas']);
      if (CALC.volumeMid && Object.keys(CALC.volumeMid).length) fields.push(['volume', 'Anúncios']);
      if (CALC.answerLabels && CALC.answerLabels.staff && Object.keys(CALC.answerLabels.staff).length) fields.push(['staff', 'Equipe']);
      fields.forEach(function (f) {
        var ctl = control(f[0], function () { fillDynamic(); scheduleSave(); });
        if (!ctl) return;
        var lab = el('label', 'setup-field');
        lab.appendChild(el('span', null, f[1]));
        lab.appendChild(ctl);
        grid.appendChild(lab);
      });
      w.appendChild(grid);
      var go = el('button', 'setup-go', 'Começar apresentação →');
      go.onclick = function () {
        var first = root.querySelector('header.hero, section:not(.closer-setup)');
        if (first) first.scrollIntoView({ behavior: 'smooth', block: 'start' });
      };
      w.appendChild(go);
      sec.appendChild(w);
      root.insertBefore(sec, root.firstChild);
    }
    buildSetup();
  }

  // Navegação por teclado: → / PageDown avança um slide, ← / PageUp volta.
  // Ignora quando o foco está num campo (painel do closer).
  function slideNodes() {
    return Array.prototype.filter.call(root.children, function (n) {
      return n.tagName === 'SECTION' || n.tagName === 'HEADER';
    });
  }
  function currentSlide(nodes) {
    var ref = 70; // scroll-padding-top + folga
    var best = 0;
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].getBoundingClientRect().top <= ref + 1) best = i;
    }
    return best;
  }
  function goSlide(dir) {
    var nodes = slideNodes();
    if (!nodes.length) return;
    var next = Math.min(nodes.length - 1, Math.max(0, currentSlide(nodes) + dir));
    nodes[next].scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  document.addEventListener('keydown', function (e) {
    var t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
    if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); goSlide(1); }
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); goSlide(-1); }
  });

  document.getElementById('nav-date').textContent = new Date().toLocaleDateString('pt-BR');
  render();
  if (P.editable) mountInlineEdit();
})();
// Calculadora SECRETA do closer (Shift+C): calculadora livre com histórico de
// resultados (tape), guardado no navegador. Independente do resto do deck.
(function secretCalc() {
  var box = document.createElement('div');
  box.className = 'calc-secret';
  box.innerHTML =
    '<div class="calc-secret-head"><span class="t">calculadora</span><button data-a="wipe" title="limpar histórico">limpar</button><button data-a="hide" title="fechar (Esc)">✕</button></div>' +
    '<div class="calc-secret-tape"></div>' +
    '<div class="calc-secret-display"><div class="calc-secret-expr"></div><div class="calc-secret-out">0</div></div>' +
    '<div class="calc-secret-keys">' +
      '<button data-a="clear" class="op">C</button><button data-a="back" class="op">⌫</button><button data-k="(" class="op">(</button><button data-k=")" class="op">)</button>' +
      '<button data-k="7">7</button><button data-k="8">8</button><button data-k="9">9</button><button data-k="/" class="op">÷</button>' +
      '<button data-k="4">4</button><button data-k="5">5</button><button data-k="6">6</button><button data-k="*" class="op">×</button>' +
      '<button data-k="1">1</button><button data-k="2">2</button><button data-k="3">3</button><button data-k="-" class="op">−</button>' +
      '<button data-k="0">0</button><button data-k=".">.</button><button data-a="eq" class="eq">=</button><button data-k="+" class="op">+</button>' +
    '</div>';
  document.body.appendChild(box);
  var tapeEl = box.querySelector('.calc-secret-tape');
  var exprEl = box.querySelector('.calc-secret-expr');
  var outEl = box.querySelector('.calc-secret-out');
  var expr = '', tape = [];
  try { tape = JSON.parse(localStorage.getItem('cockpit_calc_tape') || '[]') || []; } catch (e) { tape = []; }
  var nf = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 6 });
  var fmtNum = function (n) { return (typeof n === 'number' && isFinite(n)) ? nf.format(n) : String(n); };
  var pretty = function (s) { return String(s).replace(/\*/g, ' × ').replace(/\//g, ' ÷ ').replace(/-/g, ' − ').replace(/\+/g, ' + '); };
  function evalExpr(s) {
    var clean = String(s).replace(/,/g, '.').replace(/[^0-9.+\-*/() ]/g, '');
    if (!clean.trim()) return null;
    try { var v = Function('"use strict"; return (' + clean + ')')(); return (typeof v === 'number' && isFinite(v)) ? v : null; } catch (e) { return null; }
  }
  function renderTape() {
    tapeEl.innerHTML = tape.slice(-40).map(function (r) {
      return '<div class="row"><span class="e">' + pretty(r.e) + '</span><span class="r">' + r.r + '</span></div>';
    }).join('');
    tapeEl.scrollTop = tapeEl.scrollHeight; // mais recente embaixo, à vista
  }
  function render() {
    exprEl.textContent = pretty(expr);
    var live = evalExpr(expr);
    outEl.textContent = (live != null ? fmtNum(live) : (expr ? '…' : '0'));
  }
  var push = function (k) { expr += k; render(); };
  var back = function () { expr = expr.slice(0, -1); render(); };
  var clearAll = function () { expr = ''; render(); };
  function equals() {
    var v = evalExpr(expr); if (v == null) return;
    tape.push({ e: expr, r: fmtNum(v) }); if (tape.length > 60) tape = tape.slice(-60);
    try { localStorage.setItem('cockpit_calc_tape', JSON.stringify(tape)); } catch (e) { /* quota/incógnito */ }
    expr = String(v); renderTape(); render();
  }
  function wipe() { tape = []; try { localStorage.removeItem('cockpit_calc_tape'); } catch (e) { /* ignore */ } renderTape(); }
  box.querySelectorAll('button[data-k]').forEach(function (b) { b.addEventListener('click', function () { push(b.getAttribute('data-k')); }); });
  box.querySelector('[data-a="clear"]').addEventListener('click', clearAll);
  box.querySelector('[data-a="back"]').addEventListener('click', back);
  box.querySelector('[data-a="eq"]').addEventListener('click', equals);
  box.querySelector('[data-a="wipe"]').addEventListener('click', wipe);
  box.querySelector('[data-a="hide"]').addEventListener('click', function () { box.classList.remove('on'); });
  function toggle() { box.classList.toggle('on'); if (box.classList.contains('on')) render(); }
  // Capture: pega a tecla ANTES do handler de navegação de slide, pra digitar
  // conta não passar o slide. Shift+C (tecla física) abre/fecha de qualquer lugar.
  document.addEventListener('keydown', function (e) {
    if (e.shiftKey && e.code === 'KeyC' && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); toggle(); return; }
    if (!box.classList.contains('on')) return;
    var k = e.key;
    if (k === 'Escape') { e.preventDefault(); box.classList.remove('on'); return; }
    if (/^[0-9]$/.test(k)) { e.preventDefault(); e.stopPropagation(); push(k); return; }
    if (k === '.' || k === ',') { e.preventDefault(); e.stopPropagation(); push('.'); return; }
    if (k === '+' || k === '-' || k === '*' || k === '/' || k === '(' || k === ')') { e.preventDefault(); e.stopPropagation(); push(k); return; }
    if (k === 'Enter' || k === '=') { e.preventDefault(); e.stopPropagation(); equals(); return; }
    if (k === 'Backspace') { e.preventDefault(); e.stopPropagation(); back(); return; }
  }, true);
  renderTape(); render();
})();
</script>
</body>
</html>`;
}
