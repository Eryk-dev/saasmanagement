// Página pública do form (/f/:id) + script de embed. HTML standalone servido pela
// API — zero dependência do SPA admin. A definição sanitizada vai inline em
// window.__FORM__ (sem round-trip extra numa página de conversão).
//
// Linguagem visual portada do funil /diagnostico do Levercopy (handoff Lever
// Talents): logo + pill de etapa no topo, progresso segmentado, eyebrow com ponto
// pulsante, headline display, cards de opção com bullet/glow, stagger, CTA
// full-width, telas de insight (loading com copy + stat) e tela final com ícone
// de sucesso. Tudo parametrizado pelos tokens do tema do form — tons
// intermediários (inks/lines/glow) derivados via color-mix.
//
// Navegação por TELAS (steps): perguntas com `stack` dividem a tela; tipo
// "insight" é tela própria com auto-avanço. `*palavra*` nos títulos vira
// itálico na cor da marca. A fonte do tema é carregada do Google Fonts.
//
// O script do cliente evita template literals de propósito: o arquivo inteiro é um
// template literal, então o código interno usa concatenação pra não escapar crase.

const escJson = (obj) => JSON.stringify(obj).replace(/</g, "\\u003c");
const escAttr = (s) => String(s).replace(/"/g, "&quot;").replace(/</g, "&lt;");

// Meta Pixel da página de conversão. O pixel é POR PRODUTO (product.metaPixelId,
// editado em Ajustes → Integrações); fallback no env META_PIXEL_ID (que por sua
// vez tem o default legado do lever-ads). Sem CAPI server-side aqui, então é
// só client-side: PageView no load + evento Lead no submit (sem eventID/dedup).
const META_PIXEL_ID = process.env.META_PIXEL_ID || "971201888623790";
// Tráfego INTERNO (Leo/equipe) não pode sujar funil, A/B nem o Pixel. Como o
// cockpit e o form dividem a mesma origem, navegador logado (cockpit_key no
// localStorage) se auto-exclui; ?equipe=1 marca navegadores que não logam
// (videomaker etc.) e ?equipe=0 desmarca. Roda ANTES do pixel.
const internalHead = `<script>
(function () {
  try {
    var q = new URLSearchParams(location.search);
    var v = q.get('equipe');
    if (v === '1' || v === '0') localStorage.setItem('fe_equipe', v);
    window.__INTERNAL__ = localStorage.getItem('fe_equipe') === '1' || !!localStorage.getItem('cockpit_key');
  } catch (e) { window.__INTERNAL__ = false; }
})();
</script>`;

const metaPixelHead = (pixelId) => {
  const id = String(pixelId || "").replace(/\D/g, "") || META_PIXEL_ID;
  return id
    ? `<!-- Meta Pixel (não dispara pra equipe — __INTERNAL__) -->
<script>
if (!window.__INTERNAL__) {
!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,
document,'script','https://connect.facebook.net/en_US/fbevents.js');
fbq('init', '${id}');
fbq('track', 'PageView');
}
</script>
<noscript><img height="1" width="1" style="display:none"
src="https://www.facebook.com/tr?id=${id}&ev=PageView&noscript=1"></noscript>
<!-- End Meta Pixel -->`
    : "";
};

// Marca padrão de todo formulário: o ícone Lever (círculo + seta), versão branca
// pro fundo escuro. Usado quando o tema do form não define um logoUrl próprio.
// Tamanho fixo no código (não depende de theme.logoHeight) pra ser durável: o
// builder não tem editor de logo, então nenhum save reverte a marca.
const BRAND_ICON = "https://copy.levermoney.com.br/lever/logo-icon-inverse.svg";
const BRAND_ICON_H = 160;

// Link do Google Fonts pra família primária do tema + JetBrains Mono (pills,
// labels). Família desconhecida só falha o link — fallback system-ui assume.
const fontHref = (font) => {
  const fam = String(font || "").split(",")[0].trim().replace(/^['"]|['"]$/g, "") || "Space Grotesk";
  const enc = encodeURIComponent(fam).replace(/%20/g, "+");
  return `https://fonts.googleapis.com/css2?family=${enc}:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap`;
};

export function formPageHtml(form, { embed = false, preview = false, pixelId = "", pain = "" } = {}) {
  const t = form.theme || {};
  const bg = t.bg || "#0f1115";
  const surface = t.surface || "color-mix(in oklab, #ffffff 5%, transparent)";
  const fg = t.fg || "#f2f3f5";
  const accent = t.accent || "#6c5ce7";
  const accentFg = t.accentFg || "#ffffff";
  const font = t.font || "'Space Grotesk', system-ui, -apple-system, sans-serif";
  const radius = t.radius != null ? Number(t.radius) : 14;
  const logoH = Math.min(240, Math.max(12, Number(t.logoHeight) || 40));
  // Logo do form: se o tema define logoUrl próprio, usa-o no tamanho do tema.
  // Caso contrário, o ícone Lever padrão num tamanho fixo (durável, vale pra
  // todo form e imune a saves do builder).
  const logo = t.logoUrl
    ? `<img class="logo" src="${escAttr(t.logoUrl)}" alt="">`
    : `<img class="logo" src="${BRAND_ICON}" alt="" style="height:${BRAND_ICON_H}px">`;

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${String(form.name || "Formulário").replace(/</g, "&lt;")}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="${fontHref(font)}" rel="stylesheet">
${internalHead}
${metaPixelHead(pixelId)}
<style>
  :root {
    --bg: ${bg}; --surface: ${surface}; --fg: ${fg};
    --accent: ${accent}; --accent-fg: ${accentFg}; --radius: ${radius}px;
    --font-display: ${font};
    --font-mono: 'JetBrains Mono', ui-monospace, monospace;
    --ink-2: color-mix(in oklab, var(--fg) 82%, transparent);
    --ink-3: color-mix(in oklab, var(--fg) 55%, transparent);
    --ink-4: color-mix(in oklab, var(--fg) 38%, transparent);
    --ink-5: color-mix(in oklab, var(--fg) 18%, transparent);
    --line: color-mix(in oklab, var(--fg) 10%, transparent);
    --raised: color-mix(in oklab, var(--fg) 5%, transparent);
    --accent-soft: color-mix(in oklab, var(--accent) 12%, transparent);
    --accent-line: color-mix(in oklab, var(--accent) 28%, transparent);
    --glow: 0 0 0 4px color-mix(in oklab, var(--accent) 18%, transparent);
    --ease-out: cubic-bezier(0.2, 0.8, 0.2, 1);
    --error: #ff6b6b;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  /* O embed também usa o fundo do tema: as cores da marca assumem o próprio bg
     (fundo transparente quebraria o contraste em sites claros). */
  html, body { background: var(--bg); }
  body {
    font-family: var(--font-display); color: var(--fg);
    ${embed ? "" : "min-height: 100dvh; display: flex; flex-direction: column;"}
    -webkit-font-smoothing: antialiased; overflow-x: hidden; position: relative;
  }
  button { font: inherit; color: inherit; background: none; border: 0; cursor: pointer; }
  ::selection { background: var(--accent); color: var(--accent-fg); }
  .atmos {
    position: ${embed ? "absolute" : "fixed"}; inset: 0; pointer-events: none; z-index: 0;
    background:
      radial-gradient(ellipse 70% 50% at 50% 0%, color-mix(in oklab, var(--accent) 7%, transparent) 0%, transparent 60%),
      radial-gradient(ellipse 60% 40% at 50% 100%, color-mix(in oklab, var(--accent) 4%, transparent) 0%, transparent 60%);
  }
  .shell {
    flex: 1; display: flex; flex-direction: column; width: 100%; max-width: 580px;
    margin: 0 auto; padding: ${embed ? "28px 24px 40px" : "48px 24px 72px"};
    position: relative; z-index: 1;
  }
  /* 3 colunas: voltar (esq) | logo (centro) | progresso (dir). Mantém a logo
     centralizada mesmo com os controles laterais. */
  .top { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; margin-bottom: 28px; min-height: 32px; }
  .top-left { justify-self: start; display: flex; align-items: center; }
  .top-right { justify-self: end; display: flex; align-items: center; }
  .brand { justify-self: center; display: flex; align-items: center; }
  .logo { height: ${logoH}px; width: auto; display: block; object-fit: contain; }
  .brand-name { font-weight: 600; font-size: 15px; letter-spacing: -0.01em; }
  .pill { font-family: var(--font-mono); font-size: 11px; color: var(--ink-4); letter-spacing: .08em; }
  .backbtn { display: inline-flex; align-items: center; gap: 6px; font-family: var(--font-mono); font-size: 11px; letter-spacing: .06em; color: var(--ink-4); padding: 6px 4px; transition: color .12s; }
  .backbtn:hover { color: var(--accent); }
  .progress { display: flex; gap: 6px; margin-bottom: 32px; }
  .progress i { flex: 1; height: 3px; background: var(--ink-5); border-radius: 999px; overflow: hidden; position: relative; }
  .progress i.done { background: var(--accent); }
  .progress i.active::after { content: ''; position: absolute; inset: 0; background: var(--accent); transform-origin: left; animation: barfill 1.4s var(--ease-out) forwards; }
  @keyframes barfill { from { transform: scaleX(0); } to { transform: scaleX(.6); } }
  .eyebrow { display: inline-flex; align-items: center; gap: 8px; font-family: var(--font-mono); font-size: 11px; color: var(--accent); letter-spacing: .1em; text-transform: uppercase; margin-bottom: 16px; }
  .eyebrow::before { content: ''; width: 6px; height: 6px; border-radius: 999px; background: var(--accent); box-shadow: 0 0 0 4px var(--accent-soft); }
  h1.q { font-weight: 500; font-size: clamp(26px, 5vw, 38px); line-height: 1.08; letter-spacing: -0.025em; text-wrap: balance; }
  h1.q .req { color: var(--accent); }
  h1.q em, .sub em, .load-title em { font-style: italic; color: var(--accent); font-weight: 400; }
  .sub { font-size: 16px; line-height: 1.6; color: var(--ink-3); margin-top: 12px; text-wrap: pretty; }
  .answer { margin-top: 32px; }
  .opts { display: flex; flex-direction: column; gap: 8px; }
  .opt {
    display: flex; align-items: center; justify-content: space-between; gap: 12px;
    padding: 16px 20px; background: var(--raised); border: 1px solid var(--line);
    border-radius: var(--radius); text-align: left; color: var(--ink-2); font-size: 16px;
    transition: all .12s var(--ease-out); -webkit-tap-highlight-color: transparent;
    width: 100%; position: relative; overflow: hidden;
  }
  .opt:hover { border-color: color-mix(in oklab, var(--fg) 20%, transparent); background: color-mix(in oklab, var(--fg) 7%, transparent); transform: translateY(-1px); }
  .opt:active { transform: translateY(0) scale(.99); }
  .opt.sel { border-color: var(--accent); color: var(--fg); box-shadow: var(--glow);
    background: linear-gradient(180deg, var(--accent-soft) 0%, transparent 100%); }
  .opt-left { display: flex; align-items: center; gap: 12px; flex: 1; min-width: 0; }
  .bullet { width: 18px; height: 18px; border-radius: 999px; border: 1.5px solid var(--ink-5); flex-shrink: 0; display: flex; align-items: center; justify-content: center; transition: all .12s; }
  .bullet.sq { border-radius: 5px; }
  .opt.sel .bullet { border-color: var(--accent); background: var(--accent); }
  .opt.sel .bullet::after { content: ''; width: 6px; height: 6px; border-radius: 999px; background: var(--bg); }
  .opt-key { font-family: var(--font-mono); font-size: 11px; color: var(--ink-4); letter-spacing: .06em; }
  input.text, textarea.text {
    width: 100%; padding: 16px 20px; background: var(--raised); border: 1px solid var(--line);
    border-radius: var(--radius); color: var(--fg); font: inherit; font-size: 17px;
    outline: none; transition: all .12s;
  }
  input.text:focus, textarea.text:focus { border-color: var(--accent); box-shadow: var(--glow); background: color-mix(in oklab, var(--fg) 7%, transparent); }
  input.text::placeholder, textarea.text::placeholder { color: var(--ink-5); }
  textarea.text { resize: none; min-height: 110px; line-height: 1.5; }
  .fgroup { display: flex; flex-direction: column; gap: 8px; margin-top: 18px; }
  .fgroup > label { font-family: var(--font-mono); font-size: 11px; color: var(--ink-3); letter-spacing: .08em; text-transform: uppercase; }
  .fgroup > label .req { color: var(--accent); }
  .fhelp { font-size: 12.5px; color: var(--ink-4); line-height: 1.5; }
  .cta-row { margin-top: 32px; display: flex; flex-direction: column; gap: 10px; }
  .cta {
    display: flex; align-items: center; justify-content: center; gap: 10px; width: 100%;
    padding: 16px 20px; background: var(--accent); color: var(--accent-fg);
    border-radius: var(--radius); font-weight: 600; font-size: 16px; letter-spacing: -.005em;
    transition: all .12s var(--ease-out); -webkit-tap-highlight-color: transparent;
  }
  .cta:hover:not(:disabled) { filter: brightness(1.08); transform: translateY(-1px); box-shadow: var(--glow); }
  .cta:active:not(:disabled) { transform: translateY(0) scale(.99); }
  .cta:disabled { opacity: .35; cursor: not-allowed; }
  .hint { font-size: 13px; color: var(--ink-4); text-align: center; }
  .hint b { font-weight: 600; color: var(--ink-2); }
  .err { margin-top: 12px; font-size: 14px; color: var(--error); min-height: 18px; display: flex; align-items: center; gap: 6px; }
  .fade { animation: fadein .55s var(--ease-out) both; }
  @keyframes fadein { from { opacity: .0001; } to { opacity: 1; } }
  @keyframes slideup { from { opacity: .0001; transform: translateY(16px); } to { opacity: 1; transform: none; } }
  .stagger > * { animation: slideup .5s var(--ease-out) both; }
  .stagger > *:nth-child(1) { animation-delay: .05s; }
  .stagger > *:nth-child(2) { animation-delay: .12s; }
  .stagger > *:nth-child(3) { animation-delay: .19s; }
  .stagger > *:nth-child(4) { animation-delay: .26s; }
  .stagger > *:nth-child(5) { animation-delay: .33s; }
  .stagger > *:nth-child(6) { animation-delay: .40s; }
  .stagger > *:nth-child(7) { animation-delay: .47s; }
  .stagger > *:nth-child(8) { animation-delay: .54s; }
  .load-wrap { display: flex; flex-direction: column; align-items: center; justify-content: center; flex: 1; text-align: center; padding: 64px 8px; gap: 28px; }
  .spinner { width: 56px; height: 56px; border-radius: 999px; border: 2px solid var(--line); border-top-color: var(--accent); animation: spin .9s cubic-bezier(0.4, 0, 0.2, 1) infinite; position: relative; }
  .spinner::after { content: ''; position: absolute; inset: 6px; border-radius: 999px; border: 1px solid var(--accent-line); opacity: .4; animation: pulse 2s ease-in-out infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes pulse { 0%, 100% { transform: scale(1); opacity: .4; } 50% { transform: scale(1.4); opacity: 0; } }
  .load-title { font-weight: 500; font-size: clamp(22px, 4.5vw, 32px); line-height: 1.18; max-width: 460px; text-wrap: balance; letter-spacing: -0.015em; }
  .load-sub { font-size: 14px; color: var(--ink-3); max-width: 400px; line-height: 1.6; }
  .stat { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 24px 32px; background: var(--raised); border: 1px solid var(--line); border-radius: calc(var(--radius) + 8px); max-width: 400px; }
  .stat-num { font-style: italic; font-weight: 500; font-size: 56px; line-height: 1; color: var(--accent); letter-spacing: -.03em; }
  .stat-lbl { font-size: 14px; color: var(--ink-3); text-align: center; line-height: 1.55; }
  .load-progress { width: 220px; height: 2px; background: var(--ink-5); border-radius: 999px; overflow: hidden; position: relative; }
  .load-progress::after { content: ''; position: absolute; inset: 0; background: var(--accent); transform-origin: left; animation: loadbar var(--load-duration, 2.4s) linear forwards; }
  @keyframes loadbar { from { transform: scaleX(0); } to { transform: scaleX(1); } }
  .done-wrap { display: flex; flex-direction: column; align-items: center; text-align: center; padding-top: 24px; }
  .success-icon {
    width: 80px; height: 80px; border-radius: 999px; background: var(--accent-soft);
    border: 1px solid var(--accent-line); display: flex; align-items: center; justify-content: center;
    margin-bottom: 24px; color: var(--accent); position: relative;
  }
  .success-icon::before, .success-icon::after { content: ''; position: absolute; inset: -1px; border-radius: 999px; border: 1px solid var(--accent); }
  .success-icon::before { animation: ring 2.4s ease-out infinite; }
  .success-icon::after { animation: ring 2.4s ease-out 1.2s infinite; }
  @keyframes ring { 0% { transform: scale(1); opacity: .6; } 100% { transform: scale(1.6); opacity: 0; } }
  /* Tela de NÃO-qualificado: ícone neutro, sem o verde/glow comemorativo nem o anel. */
  .success-icon.neg { background: var(--surface); border-color: var(--line); color: var(--ink-3); }
  .success-icon.neg::before, .success-icon.neg::after { display: none; }
  /* CTA WhatsApp na tela final — "fale com o time". */
  .wa-cta { display: inline-flex; align-items: center; justify-content: center; gap: 8px; margin-top: 20px; padding: 13px 22px; border-radius: 999px; background: #25D366; color: #06120c; font-weight: 600; font-size: 15px; text-decoration: none; box-shadow: 0 6px 22px -8px rgba(37,211,102,.6); transition: transform .15s ease, box-shadow .15s ease; }
  .wa-cta:hover { transform: translateY(-1px); box-shadow: 0 10px 28px -8px rgba(37,211,102,.7); }
  .wa-cta svg { width: 20px; height: 20px; }
  .hp { position: absolute; left: -9999px; opacity: 0; height: 0; width: 0; pointer-events: none; }
</style>
</head>
<body>
<div class="atmos"></div>
<div class="shell"><div id="root"></div></div>
<input class="hp" id="hp" name="website" tabindex="-1" autocomplete="off">
<script>window.__FORM__ = ${escJson(form)}; window.__EMBED__ = ${embed ? "true" : "false"}; window.__PREVIEW__ = ${preview ? "true" : "false"}; window.__LOGO__ = ${escJson(logo)}; window.__PAIN__ = ${escJson(pain || "")};</script>
<script>
(function () {
  var F = window.__FORM__;
  var QS = F.questions || [];

  // Telas: nova tela quando não tem stack, é insight, ou vem depois de insight.
  // Espelha buildSteps do servidor.
  var STEPS = [];
  QS.forEach(function (q, i) {
    var isInsight = (q.type || 'text') === 'insight';
    var prev = STEPS[STEPS.length - 1];
    var prevIsInsight = prev && (QS[prev[0]].type || 'text') === 'insight';
    if (!prev || isInsight || prevIsInsight || !q.stack) STEPS.push([i]);
    else prev.push(i);
  });
  var stepOfKey = {};
  STEPS.forEach(function (idxs, si) { idxs.forEach(function (qi) { stepOfKey[QS[qi].key] = si; }); });
  var isInsightStep = function (si) { return (QS[STEPS[si][0]].type || 'text') === 'insight'; };
  var realTotal = STEPS.filter(function (_, si) { return !isInsightStep(si); }).length;

  // Telemetria de funil (drop-off por etapa): eventos anônimos por sessão de
  // visita, deduplicados no client (voltar não recontam) e enviados via
  // sendBeacon (sobrevive à aba fechando). Best-effort: nunca afeta o form.
  var SID = (window.crypto && crypto.randomUUID)
    ? crypto.randomUUID()
    : 's-' + Date.now() + '-' + Math.random().toString(36).slice(2);

  // UTM/click-ids/referrer da URL de entrada: vai junto do submit pra atribuição
  // por origem no cockpit (CAC/CPL por campanha). Só chaves conhecidas.
  var UTM = (function () {
    try {
      var p = new URLSearchParams(location.search);
      var o = {};
      ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'].forEach(function (k) {
        var v = p.get(k);
        if (v) o[k.slice(4)] = v.slice(0, 200);
      });
      ['fbclid', 'gclid', 'ttclid'].forEach(function (k) {
        var v = p.get(k);
        if (v) o[k] = v.slice(0, 200);
      });
      // Referrer: o site da LeverAds repassa o do FIRST-TOUCH via ?referrer=
      // (cross-domain — document.referrer aqui seria sempre o próprio site).
      // Sem o parâmetro, cai no referrer externo do navegador (orgânico, bio).
      var ref = p.get('referrer')
        || (document.referrer && document.referrer.indexOf(location.origin) !== 0 ? document.referrer : '');
      if (ref) o.referrer = ref.slice(0, 300);
      return Object.keys(o).length ? o : null;
    } catch (e) { return null; }
  })();
  // Teste A/B da tela de boas-vindas: welcome.variants = [{ id, title,
  // subtitle, button }]. Sorteio uniforme PERSISTENTE por navegador
  // (localStorage): quem volta vê a mesma versão, e a variante vai carimbada
  // nos eventos do funil e no submit (lead.formVariant). Campo ausente na
  // variante herda o da welcome base. Preview do builder mostra a base.
  var VARIANT = '';
  (function () {
    var vs = F.welcome && F.welcome.variants;
    if (!vs || !vs.length || window.__PREVIEW__) return;
    var lsKey = 'fv_' + F.id;
    var saved = null;
    try { saved = localStorage.getItem(lsKey); } catch (e) {}
    var pick = null;
    for (var i = 0; i < vs.length; i++) if (String(vs[i].id) === saved) pick = vs[i];
    if (!pick) {
      pick = vs[Math.floor(Math.random() * vs.length)];
      try { localStorage.setItem(lsKey, String(pick.id)); } catch (e) {}
    }
    VARIANT = String(pick.id);
    F.welcome = Object.assign({}, F.welcome, pick);
  })();

  var trackSent = {};
  function track(event, key) {
    if (window.__PREVIEW__ || window.__INTERNAL__) return; // preview/equipe não poluem o funil
    var mark = event + ':' + (key || '');
    if (trackSent[mark]) return;
    trackSent[mark] = true;
    try {
      // UTM junto: o funil de drop-off segmenta por campanha, não só por variante/dor.
      var body = JSON.stringify({ session: SID, event: event, key: key || '', variant: VARIANT, pain: window.__PAIN__ || '', utm: UTM || undefined });
      var url = '/public/forms/' + encodeURIComponent(F.id) + '/events';
      if (navigator.sendBeacon) navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }));
      else fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: body, keepalive: true });
    } catch (e) {}
  }

  if (window.__INTERNAL__ && !window.__PREVIEW__) {
    try {
      var tag = document.createElement('div');
      tag.textContent = 'modo equipe · sem rastreio';
      tag.style.cssText = 'position:fixed;bottom:10px;right:12px;z-index:99;font:600 10px/1 monospace;letter-spacing:.06em;padding:5px 9px;border-radius:999px;background:rgba(0,0,0,.55);color:#9ff;opacity:.75;pointer-events:none';
      document.addEventListener('DOMContentLoaded', function () { document.body.appendChild(tag); });
      if (document.body) document.body.appendChild(tag);
    } catch (e) {}
  }

  var answers = {};
  var mode = F.welcome ? 'welcome' : (STEPS.length ? 'step' : 'done');
  var trail = mode === 'step' ? [0] : [];
  var cur = mode === 'step' ? 0 : -1;
  var root = document.getElementById('root');
  var insightTimer = null;
  var rejected = false; // caiu numa saída de NÃO-qualificado (branch _reject)

  function isBlank(v) { return v == null || (Array.isArray(v) ? v.length === 0 : String(v).trim() === ''); }
  function realVisited() {
    var n = 0;
    for (var i = 0; i < trail.length; i++) if (!isInsightStep(trail[i])) n++;
    return n;
  }

  // Destino da tela: primeiro 'to' definido entre as perguntas (opção do select
  // respondido, senão o 'to' da pergunta). '' = sem destino explícito.
  function toOf(si) {
    var idxs = STEPS[si];
    for (var k = 0; k < idxs.length; k++) {
      var q = QS[idxs[k]];
      if (q.type === 'select') {
        var a = answers[q.key];
        for (var j = 0; j < (q.options || []).length; j++) {
          if (q.options[j].value === a && q.options[j].to) return q.options[j].to;
        }
      }
      if (q.to) return q.to;
    }
    return '';
  }

  // Próxima tela a partir de si. -1 = fim do form (terminal _end/_reject ou
  // acabaram as telas). Sem destino, vai pra próxima tela.
  function nextStep(si) {
    var to = toOf(si);
    if (to === '_end' || to === '_reject') return -1;
    if (to && stepOfKey[to] != null) return stepOfKey[to];
    return si + 1 < STEPS.length ? si + 1 : -1;
  }

  function validateQ(q, v) {
    if (q.required && isBlank(v)) return 'Essa pergunta é obrigatória';
    if (isBlank(v)) return '';
    if (q.type === 'email' && !/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(String(v).trim())) return 'Digite um e-mail válido';
    if (q.type === 'phone' && String(v).replace(/[^0-9]/g, '').length < 8) return 'Digite um telefone válido';
    if (q.type === 'number' && !isFinite(Number(v))) return 'Digite um número';
    return '';
  }

  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  // *palavra* vira <em> (itálico na cor da marca) — depois do escape, seguro.
  function fmt(s) { return esc(s).replace(/\\*([^*]+)\\*/g, '<em>$1</em>'); }
  function pad(n) { return String(n).padStart(2, '0'); }
  // Telefone livre -> dígitos do wa.me. Número local BR (<=11 díg, com DDD) ganha o DDI 55.
  function waDigits(p) { if (!p) return ''; var d = String(p).replace(/\\D/g, ''); if (!d) return ''; if (d.length <= 11) d = '55' + d; return d; }

  function topBar(showBack, showPill) {
    var top = el('div', 'top');
    // Esquerda: botão voltar (quando há pra onde voltar).
    var left = el('div', 'top-left');
    if (showBack && trail.length > 1) {
      var back = el('button', 'backbtn', '← voltar');
      back.onclick = goBack;
      left.appendChild(back);
    }
    // Centro: a logo (ícone da marca) — sempre centralizada.
    var brand = el('div', 'brand', window.__LOGO__ || '<span class="brand-name">' + esc(F.name) + '</span>');
    // Direita: progresso (NN / NN).
    var right = el('div', 'top-right');
    if (showPill) right.appendChild(el('span', 'pill', pad(realVisited()) + ' / ' + pad(realTotal)));
    top.appendChild(left);
    top.appendChild(brand);
    top.appendChild(right);
    return top;
  }

  function progressBars() {
    var wrap = el('div', 'progress');
    wrap.setAttribute('aria-hidden', 'true');
    var r = realVisited();
    for (var i = 0; i < realTotal; i++) {
      wrap.appendChild(el('i', i < r - 1 ? 'done' : i === r - 1 ? 'active' : ''));
    }
    return wrap;
  }

  function render() {
    if (insightTimer) { clearTimeout(insightTimer); insightTimer = null; }
    if (mode === 'step') track('step', QS[STEPS[cur][0]].key);
    root.innerHTML = '';
    if (mode === 'welcome') renderWelcome();
    else if (mode === 'step') (isInsightStep(cur) ? renderInsight : renderStep)();
    else renderDone();
    if (window.__EMBED__) postHeight();
  }

  function renderWelcome() {
    var w = F.welcome;
    var s = el('div', 'fade');
    s.appendChild(topBar(false, false));
    s.appendChild(el('div', 'eyebrow', esc(F.name)));
    s.appendChild(el('h1', 'q', fmt(w.title || F.name)));
    if (w.subtitle) s.appendChild(el('div', 'sub', fmt(w.subtitle)));
    var row = el('div', 'cta-row stagger');
    var b = el('button', 'cta', esc(w.button || 'Começar') + ' →');
    b.onclick = start;
    row.appendChild(b);
    // Custo percebido baixinho: relógio + "~30 segundos" vende melhor que a
    // promessa de minutos (e o "pressione Enter" só fazia sentido em desktop).
    var clock = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" style="vertical-align:-1px;margin-right:5px"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';
    row.appendChild(el('p', 'hint', clock + 'leva <b>~30 segundos</b> · ' + realTotal + (realTotal === 1 ? ' etapa rápida' : ' etapas rápidas')));
    s.appendChild(row);
    root.appendChild(s);
  }

  function start() { track('start'); mode = 'step'; cur = 0; trail = [0]; render(); }

  // Tela de insight: copy persuasiva + stat + barra com duração, auto-avança.
  function renderInsight() {
    var q = QS[STEPS[cur][0]];
    var dur = Number(q.durationMs) > 0 ? Number(q.durationMs) : 2400;
    var s = el('div', 'fade');
    s.appendChild(topBar(false, false));
    var wrap = el('div', 'load-wrap');
    wrap.appendChild(el('div', 'spinner'));
    wrap.appendChild(el('h2', 'load-title', fmt(q.label)));
    if (q.stat) {
      var st = el('div', 'stat');
      st.appendChild(el('span', 'stat-num', esc(q.stat)));
      if (q.statLabel) st.appendChild(el('span', 'stat-lbl', esc(q.statLabel)));
      wrap.appendChild(st);
    }
    if (q.help) wrap.appendChild(el('p', 'load-sub', fmt(q.help)));
    var bar = el('div', 'load-progress');
    bar.style.setProperty('--load-duration', dur + 'ms');
    wrap.appendChild(bar);
    s.appendChild(wrap);
    root.appendChild(s);
    insightTimer = setTimeout(function () { jumpFrom(cur); }, dur);
  }

  // Campo de uma pergunta (telas com 1 ou várias). 'single' = tela de pergunta
  // única: select avança sozinho ao escolher.
  function makeField(q, single, errBox) {
    if (q.type === 'select' || q.type === 'multiselect') {
      var multi = q.type === 'multiselect';
      var sel = answers[q.key] != null ? answers[q.key] : (multi ? [] : '');
      var opts = el('div', 'opts' + (single ? ' stagger' : ''));
      (q.options || []).forEach(function (o, i) {
        var letter = String.fromCharCode(65 + i);
        var b = el('button', 'opt',
          '<span class="opt-left"><span class="bullet' + (multi ? ' sq' : '') + '"></span><span>' + esc(o.label || o.value) + '</span></span>' +
          (single ? '<span class="opt-key">' + letter + '</span>' : ''));
        b.type = 'button';
        var isSel = multi ? sel.indexOf(o.value) >= 0 : sel === o.value;
        if (isSel) b.classList.add('sel');
        b.onclick = function () {
          errBox.textContent = '';
          if (multi) {
            var arr = (answers[q.key] || []).slice();
            var at = arr.indexOf(o.value);
            if (at >= 0) arr.splice(at, 1); else arr.push(o.value);
            answers[q.key] = arr;
            b.classList.toggle('sel');
          } else {
            answers[q.key] = o.value;
            var all = opts.querySelectorAll('.opt');
            for (var k = 0; k < all.length; k++) all[k].classList.remove('sel');
            b.classList.add('sel');
            if (single) setTimeout(advance, 260);
          }
        };
        opts.appendChild(b);
      });
      return opts;
    }
    var input;
    if (q.type === 'textarea') {
      input = el('textarea', 'text');
      input.rows = single ? 4 : 3;
    } else {
      input = el('input', 'text');
      input.type = q.type === 'number' ? 'number' : q.type === 'email' ? 'email' : q.type === 'phone' ? 'tel' : 'text';
      if (q.type === 'phone') input.inputMode = 'tel';
    }
    input.dataset.qkey = q.key;
    input.placeholder = q.placeholder || 'Digite sua resposta…';
    input.value = answers[q.key] != null ? answers[q.key] : '';
    input.oninput = function () { answers[q.key] = input.value; errBox.textContent = ''; };
    return input;
  }

  function renderStep() {
    var idxs = STEPS[cur];
    var qs = idxs.map(function (i) { return QS[i]; });
    var first = qs[0];
    var single = qs.length === 1;
    var s = el('div', 'fade');
    s.appendChild(topBar(true, true));
    s.appendChild(progressBars());
    s.appendChild(el('div', 'eyebrow', 'Etapa ' + pad(realVisited()) + ' de ' + pad(realTotal)));
    s.appendChild(el('h1', 'q', fmt(first.label) + (single && first.required ? ' <span class="req">*</span>' : '')));
    if (first.help) s.appendChild(el('div', 'sub', fmt(first.help)));

    var errBox = el('div', 'err');
    errBox.id = 'err';
    var box = el('div', 'answer');

    if (single) {
      box.appendChild(makeField(first, true, errBox));
    } else {
      // Tela com várias perguntas: 1ª pergunta logo abaixo do título; as demais
      // como grupos com label mono (padrão da tela de contato do funil Lever).
      box.appendChild(makeField(first, false, errBox));
      qs.slice(1).forEach(function (q) {
        var g = el('div', 'fgroup');
        g.appendChild(el('label', null, esc(q.label) + (q.required ? ' <span class="req">*</span>' : '')));
        g.appendChild(makeField(q, false, errBox));
        if (q.help) g.appendChild(el('div', 'fhelp', fmt(q.help)));
        box.appendChild(g);
      });
    }

    var onlySelect = single && (first.type === 'select');
    if (!onlySelect) {
      var row = el('div', 'cta-row');
      var ok = el('button', 'cta', (nextStep(cur) === -1 ? (F.submitLabel || 'Enviar') : single && first.type === 'multiselect' ? 'Continuar' : 'OK') + ' →');
      ok.onclick = advance;
      row.appendChild(ok);
      var hint = single
        ? (first.type === 'multiselect' ? 'escolha quantas quiser e confirme'
          : first.type === 'textarea' ? '<b>Shift ⇧ + Enter ↵</b> quebra linha' : 'pressione <b>Enter ↵</b>')
        : 'pressione <b>Enter ↵</b> pra continuar';
      row.appendChild(el('p', 'hint', hint));
      box.appendChild(row);
    }

    s.appendChild(box);
    s.appendChild(errBox);
    root.appendChild(s);
    var inp = root.querySelector('input.text, textarea.text');
    if (inp) setTimeout(function () { inp.focus(); }, 80);
  }

  function advance() {
    var qs = STEPS[cur].map(function (i) { return QS[i]; });
    var errBox = document.getElementById('err');
    for (var i = 0; i < qs.length; i++) {
      var err = validateQ(qs[i], answers[qs[i].key]);
      if (err) {
        if (errBox) errBox.textContent = '⚠ ' + (qs.length > 1 ? qs[i].label + ': ' : '') + err;
        return;
      }
    }
    jumpFrom(cur);
  }

  function jumpFrom(si) {
    var ni = nextStep(si);
    if (ni === -1) { rejected = (toOf(si) === '_reject'); return submit(); }
    cur = ni;
    trail.push(ni);
    render();
  }

  function goBack() {
    if (trail.length <= 1) return;
    trail.pop();
    // Voltar pula telas de insight (replay de loading não ajuda ninguém).
    while (trail.length > 1 && isInsightStep(trail[trail.length - 1])) trail.pop();
    cur = trail[trail.length - 1];
    render();
  }

  function readCookie(name) {
    var prefix = name + '=';
    var parts = document.cookie.split(';');
    for (var i = 0; i < parts.length; i++) {
      var t = parts[i].trim();
      if (t.indexOf(prefix) === 0) return decodeURIComponent(t.slice(prefix.length));
    }
    return null;
  }

  function submit() {
    var btns = root.querySelectorAll('.cta');
    for (var i = 0; i < btns.length; i++) { btns[i].disabled = true; btns[i].textContent = 'Enviando…'; }
    // event_id compartilhado entre o Pixel (client) e o CAPI (server) pra a Meta
    // deduplicar a conversão (event_name + event_id, janela de 48h).
    var eventId = (window.crypto && crypto.randomUUID)
      ? crypto.randomUUID()
      : 'lead-' + Date.now() + '-' + Math.random().toString(36).slice(2);
    // Pixel "Lead" dispara JÁ AQUI (antes do POST) com o eventID — assim o ping
    // acontece mesmo se a aba fechar antes da rede responder. No-op sem pixel.
    // NÃO dispara pra desqualificado (espelha o skip do CAPI no servidor).
    if (!rejected) {
      try { if (window.fbq) window.fbq('track', 'Lead', { content_name: F.name || '' }, { eventID: eventId }); } catch (e) {}
    }
    var payload = {
      answers: answers,
      _hp: document.getElementById('hp').value || '',
      // Atribuição p/ o CAPI server-side casar com o Pixel e com o clique do anúncio.
      eventId: eventId,
      fbp: readCookie('_fbp'),
      fbc: readCookie('_fbc'),
      sourceUrl: location.href,
      utm: UTM,
      variant: VARIANT || undefined,
      pain: window.__PAIN__ || undefined,
      internal: window.__INTERNAL__ || undefined,
    };
    fetch('/public/forms/' + encodeURIComponent(F.id) + '/submissions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    }).then(function (r) {
      if (!r.ok) return r.json().then(function (b) { throw new Error((b && b.error) || ('Erro ' + r.status)); });
      track('submit');
      mode = 'done'; cur = -1; render();
      // Redirect só na tela positiva — desqualificado não vai pro destino de sucesso.
      var url = !rejected && F.thanks && F.thanks.redirectUrl;
      if (url) setTimeout(function () { window.top.location.href = url; }, 1600);
    }).catch(function (e) {
      for (var i = 0; i < btns.length; i++) { btns[i].disabled = false; btns[i].textContent = (F.submitLabel || 'Enviar') + ' →'; }
      var errBox = document.getElementById('err');
      if (errBox) errBox.textContent = '⚠ ' + (e.message || 'Falha ao enviar. Tente de novo.');
    });
  }

  function renderDone() {
    // Desqualificado: usa a tela reject (copy de descarte, ícone neutro, sem
    // redirect). Caso contrário, a tela thanks positiva de sempre.
    var t = (rejected ? F.reject : F.thanks) || {};
    var s = el('div', 'fade');
    s.appendChild(topBar(false, false));
    var wrap = el('div', 'done-wrap');
    // Check verde no sucesso; traço neutro no descarte.
    var icon = rejected
      ? '<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/></svg>'
      : '<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5L20 7"/></svg>';
    wrap.appendChild(el('div', rejected ? 'success-icon neg' : 'success-icon', icon));
    var defTitle = rejected ? 'Obrigado pelo seu interesse!' : 'Recebido! Obrigado.';
    wrap.appendChild(el('h1', 'q', fmt(t.title || defTitle)));
    if (t.subtitle) wrap.appendChild(el('div', 'sub', fmt(t.subtitle)));
    // CTA WhatsApp opcional: "fale com o time agora". Mostra quando o form tem número.
    var waNum = waDigits(t.whatsapp);
    if (waNum) {
      var waMsg = t.whatsappMsg || 'Caso tenha ficado com alguma dúvida, você pode falar com nosso time agora.';
      wrap.appendChild(el('div', 'sub', fmt(waMsg)));
      var wa = el('a', 'wa-cta',
        '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.9 9.9 0 0 0 4.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2zm0 18.05h-.01a8.2 8.2 0 0 1-4.18-1.15l-.3-.18-3.11.82.83-3.04-.2-.31a8.18 8.18 0 0 1-1.26-4.36c0-4.54 3.7-8.23 8.24-8.23 2.2 0 4.27.86 5.82 2.42a8.19 8.19 0 0 1 2.41 5.82c0 4.54-3.69 8.23-8.21 8.23zm4.52-6.16c-.25-.12-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.12-.16.25-.64.81-.79.98-.14.16-.29.18-.54.06-.25-.12-1.05-.39-1.99-1.23-.74-.66-1.23-1.47-1.38-1.72-.14-.25-.01-.38.11-.5.11-.11.25-.29.37-.43.13-.14.17-.25.25-.41.08-.16.04-.31-.02-.43-.06-.12-.56-1.34-.76-1.84-.2-.48-.4-.42-.56-.43-.14-.01-.31-.01-.47-.01-.16 0-.43.06-.65.31-.22.25-.86.84-.86 2.05 0 1.21.88 2.38 1 2.54.12.16 1.73 2.64 4.2 3.7.59.25 1.04.4 1.4.52.59.19 1.12.16 1.54.1.47-.07 1.47-.6 1.67-1.18.21-.58.21-1.07.15-1.18-.06-.11-.22-.17-.47-.29z"/></svg>'
        + ' Falar no WhatsApp');
      wa.href = 'https://wa.me/' + waNum;
      wa.target = '_blank';
      wa.rel = 'noopener noreferrer';
      wrap.appendChild(wa);
    }
    if (!rejected && t.redirectUrl) wrap.appendChild(el('div', 'sub', 'Redirecionando…'));
    s.appendChild(wrap);
    root.appendChild(s);
  }

  document.addEventListener('keydown', function (e) {
    if (mode === 'welcome' && e.key === 'Enter') { e.preventDefault(); start(); return; }
    if (mode !== 'step' || isInsightStep(cur)) return;
    var qs = STEPS[cur];
    var first = QS[qs[0]];
    var single = qs.length === 1;
    if (e.key === 'Enter') {
      if (e.target && e.target.tagName === 'TEXTAREA' && e.shiftKey) return;
      e.preventDefault();
      advance();
    } else if (single && (first.type === 'select' || first.type === 'multiselect') && /^[a-zA-Z]$/.test(e.key)) {
      var i = e.key.toUpperCase().charCodeAt(0) - 65;
      var opts = root.querySelectorAll('.opt');
      if (opts[i]) opts[i].click();
    }
  });

  function postHeight() {
    var h = document.documentElement.scrollHeight;
    window.parent.postMessage({ type: 'cockpit-form-height', id: F.id, height: h }, '*');
  }
  if (window.__EMBED__) {
    new ResizeObserver(postHeight).observe(document.body);
    window.addEventListener('load', postHeight);
  }

  track('view');
  render();
})();
</script>
</body>
</html>`;
}

// Script de embed: <script src="https://host/embed.js"></script> +
// <div data-cockpit-form="fo_x"></div>. Iframe com altura automática via postMessage.
export const EMBED_JS = `(function () {
  var script = document.currentScript;
  var base = new URL(script.src).origin;
  function mount(node) {
    var id = node.getAttribute('data-cockpit-form');
    if (!id || node.__mounted) return;
    node.__mounted = true;
    var iframe = document.createElement('iframe');
    iframe.src = base + '/f/' + encodeURIComponent(id) + '?embed=1';
    iframe.style.width = '100%';
    iframe.style.border = '0';
    iframe.style.minHeight = '420px';
    iframe.setAttribute('title', 'Formulário');
    iframe.setAttribute('loading', 'lazy');
    node.appendChild(iframe);
    window.addEventListener('message', function (e) {
      var d = e.data || {};
      if (d.type === 'cockpit-form-height' && d.id === id) iframe.style.height = d.height + 'px';
    });
  }
  function scan() {
    var nodes = document.querySelectorAll('[data-cockpit-form]');
    for (var i = 0; i < nodes.length; i++) mount(nodes[i]);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scan);
  else scan();
})();`;
