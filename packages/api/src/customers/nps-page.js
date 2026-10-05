// Página pública do NPS (/public/nps/:token). HTML standalone servido pela API,
// no design system Lever Premium (paper claro, ink navy, teal com parcimônia),
// no mesmo molde do formulário de integração, mas curtíssimo: uma pergunta,
// onze botões e uma caixa de texto opcional.
//
// A regra da tela é o tempo: o cliente prometeu 10 segundos na mensagem, então
// a nota é UM clique (o envio é imediato) e o motivo aparece DEPOIS, como
// oferta, nunca como pedágio.
//
// O script do cliente evita template literals de propósito: o arquivo inteiro é
// um template literal, então o código interno usa concatenação (mesma regra do
// integration-form-page.js).

const escJson = (obj) => JSON.stringify(obj).replace(/</g, "\\u003c");
const esc = (s) => String(s == null ? "" : s)
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;").replaceAll("'", "&#39;");

const BRAND_ICON = "https://copy.levermoney.com.br/lever/logo-icon-color.svg";

const STYLE = `
  :root {
    --bg:#f7f8fa; --card:#ffffff; --ink:#0c1d2b; --ink2:#41535f; --ink3:#6b7b86;
    --line:#e4e8eb; --line2:#cbd4da; --teal:#0f766e; --teal-soft:#0f766e14;
    --btn:#0c1d2b; --btn-fg:#ffffff; --pos:#177a4c; --r:12px;
  }
  * { box-sizing:border-box; -webkit-tap-highlight-color:transparent; }
  body { margin:0; background:var(--bg); color:var(--ink); font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif; }
  .wrap { max-width:640px; margin:0 auto; padding:32px 20px 56px; }
  .brand { display:flex; align-items:center; gap:9px; margin-bottom:28px; }
  .brand img { width:26px; height:26px; }
  .brand span { font-size:13px; font-weight:600; letter-spacing:.02em; color:var(--ink2); }
  .card { background:var(--card); border:1px solid var(--line); border-radius:var(--r); padding:28px 24px; }
  h1 { margin:0 0 6px; font-size:21px; line-height:1.3; font-weight:700; letter-spacing:-.01em; }
  .sub { margin:0 0 24px; font-size:14px; color:var(--ink3); }
  .scale { display:grid; grid-template-columns:repeat(11,1fr); gap:6px; margin-bottom:10px; }
  .scale button {
    aspect-ratio:1; min-height:40px; padding:0; border:1px solid var(--line2); border-radius:9px;
    background:#fff; color:var(--ink); font:600 14px/1 inherit; cursor:pointer; transition:.12s;
  }
  .scale button:hover { border-color:var(--teal); background:var(--teal-soft); }
  .scale button[aria-pressed="true"] { border-color:var(--teal); background:var(--teal); color:#fff; }
  .ends { display:flex; justify-content:space-between; font-size:11.5px; color:var(--ink3); margin-bottom:4px; }
  .why { margin-top:22px; }
  .why label { display:block; font-size:13.5px; font-weight:600; margin-bottom:7px; }
  textarea {
    width:100%; min-height:88px; padding:11px 12px; border:1px solid var(--line2); border-radius:10px;
    font:14px/1.5 inherit; color:var(--ink); background:#fff; resize:vertical;
  }
  textarea:focus { outline:none; border-color:var(--teal); }
  .send {
    margin-top:12px; height:44px; padding:0 22px; border:0; border-radius:10px;
    background:var(--btn); color:var(--btn-fg); font:600 14.5px/1 inherit; cursor:pointer;
  }
  .send[disabled] { opacity:.5; cursor:default; }
  .ok { text-align:center; padding:12px 0 4px; }
  .ok .mark { width:46px; height:46px; margin:0 auto 14px; border-radius:999px; background:#177a4c14; color:var(--pos); display:flex; align-items:center; justify-content:center; font-size:22px; }
  .ok h2 { margin:0 0 6px; font-size:19px; font-weight:700; }
  .ok p { margin:0; font-size:14px; color:var(--ink3); }
  .foot { margin-top:20px; text-align:center; font-size:12px; color:var(--ink3); }
  [hidden] { display:none !important; }
  @media (max-width:520px) {
    .wrap { padding:24px 14px 40px; }
    .card { padding:22px 16px; }
    .scale { grid-template-columns:repeat(6,1fr); }
  }
`;

const shell = (title, body, extra = "") => `<!doctype html>
<html lang="pt-BR"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${esc(title)}</title>
<link rel="icon" href="${BRAND_ICON}">
<style>${STYLE}</style>
</head><body>
<div class="wrap">
  <div class="brand"><img src="${BRAND_ICON}" alt=""><span>Lever</span></div>
  ${body}
</div>
${extra}
</body></html>`;

export const npsDoneHtml = (empresa = "") => shell("Obrigado", `<div class="card"><div class="ok">
  <div class="mark">✓</div>
  <h2>Obrigado!</h2>
  <p>Sua resposta já está com quem cuida da ${empresa ? esc(empresa) : "sua conta"}.</p>
</div></div>`);

export const npsNotFoundHtml = shell("Link não encontrado", `<div class="card"><div class="ok">
  <div class="mark" style="background:#b423180f;color:#b42318">!</div>
  <h2>Link não encontrado</h2>
  <p>Esse link de avaliação não existe ou foi substituído por um mais novo.</p>
</div></div>`);

export function npsPageHtml({ token, company = "", contact = "" } = {}) {
  const ola = contact ? `Oi, ${esc(contact)}.` : "Oi!";
  return shell("De 0 a 10?", `<div class="card">
  <form id="f" novalidate>
    <h1>${ola} De 0 a 10, quanto você indicaria a Lever pra outro lojista?</h1>
    <p class="sub">Uma pergunta só, e a resposta vai direto pra quem cuida da ${company ? esc(company) : "sua conta"}.</p>
    <div class="ends"><span>0 · não indicaria</span><span>10 · indicaria</span></div>
    <div class="scale" id="scale"></div>
    <div class="why" id="why" hidden>
      <label for="reason">O que faria sua nota ser maior? (opcional)</label>
      <textarea id="reason" maxlength="2000" placeholder="pode escrever à vontade"></textarea>
      <button class="send" type="submit" id="send">enviar</button>
    </div>
  </form>
</div>
<div class="foot">Lever · leva 10 segundos</div>`, `<script>window.__NPS__ = ${escJson({ token, company })};
window.__NPS_DONE__ = ${escJson(npsDoneHtml(company))};</script>
<script>
(function () {
  var T = window.__NPS__ || {};
  var scale = document.getElementById("scale");
  var why = document.getElementById("why");
  var send = document.getElementById("send");
  var form = document.getElementById("f");
  var nota = null, enviando = false, gravada = false;

  for (var i = 0; i <= 10; i++) {
    var b = document.createElement("button");
    b.type = "button";
    b.textContent = String(i);
    b.setAttribute("aria-pressed", "false");
    b.dataset.n = String(i);
    scale.appendChild(b);
  }

  function post(corpo, entao) {
    var x = new XMLHttpRequest();
    x.open("POST", "/public/nps/" + T.token, true);
    x.setRequestHeader("Content-Type", "application/json");
    x.onreadystatechange = function () { if (x.readyState === 4 && entao) entao(x.status); };
    x.send(JSON.stringify(corpo));
  }

  scale.addEventListener("click", function (e) {
    var b = e.target.closest("button");
    if (!b || enviando) return;
    nota = Number(b.dataset.n);
    var todos = scale.querySelectorAll("button");
    for (var k = 0; k < todos.length; k++) todos[k].setAttribute("aria-pressed", todos[k] === b ? "true" : "false");
    why.hidden = false;
    // A nota vale por si: grava no clique, o motivo é um extra que pode nem vir.
    enviando = true;
    post({ score: nota }, function () { enviando = false; gravada = true; });
  });

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    if (nota == null || enviando) return;
    var texto = document.getElementById("reason").value;
    enviando = true;
    send.disabled = true;
    send.textContent = "enviando…";
    var termina = function () { document.open(); document.write(window.__NPS_DONE__ || ""); document.close(); };
    if (!texto.trim()) { termina(); return; }
    post(gravada ? { reason: texto } : { score: nota, reason: texto }, termina);
  });
})();
</script>`);
}
