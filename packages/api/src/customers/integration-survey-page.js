// Página pública da pesquisa da integração (/public/pesquisa/:token). Mesmo
// esqueleto e design da página do NPS (nps-page.js), com três perguntas numa
// tela só: a nota de 1 a 5 (gravada no clique), se já consegue usar sozinho e
// um comentário opcional. Tempo prometido na mensagem: uns 30 segundos.
//
// O script do cliente evita template literals de propósito: o arquivo inteiro é
// um template literal, então o código interno usa concatenação (mesma regra do
// nps-page.js).

import { esc, escJson, shell } from "./nps-page.js";
import { SATISFACTION_FACES, faceSvg } from "../shared/satisfaction-faces.js";

// Escala de carinhas (12/11/2026): cada nota com a sua cor (--c), do triste
// vermelho ao sorriso verde. Escolhida, ganha a cor no fundo e as outras
// esmaecem, pra ficar claro o que foi marcado.
const EXTRA_STYLE = `<style>
  .scale5 { display:grid; grid-template-columns:repeat(5,1fr); gap:8px; margin:4px 0 6px; }
  .scale5 button {
    display:flex; flex-direction:column; align-items:center; gap:6px; padding:12px 4px 10px;
    border:1.5px solid var(--line); border-radius:14px; background:#fff; color:var(--ink2);
    font-family:inherit; font-size:12.5px; font-weight:600; line-height:1.2; cursor:pointer; transition:transform .12s, background .12s, border-color .12s, opacity .12s;
  }
  .scale5 button svg { width:42px; height:42px; transition:transform .12s; }
  .scale5 button:hover { border-color:var(--c); background:color-mix(in srgb, var(--c) 8%, #fff); }
  .scale5 button:hover svg { transform:scale(1.08); }
  .scale5 button[aria-pressed="true"] { border-color:var(--c); background:color-mix(in srgb, var(--c) 14%, #fff); color:var(--c); transform:translateY(-2px); }
  .scale5 button[aria-pressed="true"] svg { transform:scale(1.15); }
  .scale5.picked button[aria-pressed="false"] { opacity:.45; }
  .ready button {
    min-height:46px; padding:0 8px; border:1.5px solid var(--line2); border-radius:12px;
    background:#fff; color:var(--ink); font-family:inherit; font-size:13.5px; font-weight:600; cursor:pointer; transition:.12s;
  }
  .ready button:hover { border-color:var(--c); }
  .ready button[aria-pressed="true"] { border-color:var(--c); background:color-mix(in srgb, var(--c) 14%, #fff); color:var(--c); }
  .ready { display:grid; grid-template-columns:repeat(3,1fr); gap:8px; }
  /* "font: … inherit" do estilo do NPS é inválido e cai pro monoespaçado. */
  textarea, .send { font-family:inherit; font-size:14px; }
  .send { font-weight:600; }
  .ok .face svg { width:64px; height:64px; margin:0 auto 12px; display:block; }
  @media (max-width:520px) { .scale5 { gap:5px; } .scale5 button { padding:10px 2px 8px; font-size:11.5px; } .scale5 button svg { width:36px; height:36px; } }
  .q { margin-top:24px; }
  .q > label, .q > p { display:block; margin:0 0 8px; font-size:14px; font-weight:600; }
  @media (max-width:520px) { .ready { grid-template-columns:1fr; } }
</style>`;

export const surveyDoneHtml = (empresa = "") => shell("Obrigado", `<div class="card"><div class="ok">
  <div class="face">${faceSvg(5, { size: 64 })}</div>
  <h2>Obrigado!</h2>
  <p>Sua resposta já está com quem cuida da ${empresa ? esc(empresa) : "sua conta"}.</p>
</div></div>`);

export const surveyNotFoundHtml = shell("Link não encontrado", `<div class="card"><div class="ok">
  <div class="mark" style="background:#b423180f;color:#b42318">!</div>
  <h2>Link não encontrado</h2>
  <p>Esse link de pesquisa não existe ou foi substituído por um mais novo.</p>
</div></div>`);

export function surveyPageHtml({ token, company = "", contact = "" } = {}) {
  const ola = contact ? `Oi, ${esc(contact)}.` : "Oi!";
  return shell("Como foi sua integração?", `${EXTRA_STYLE}<div class="card">
  <form id="f" novalidate>
    <h1>${ola} Como foi a sua integração com a Lever?</h1>
    <p class="sub">Três perguntas rápidas. A resposta vai direto pra quem cuida da ${company ? esc(company) : "sua conta"}.</p>
    <div class="scale5" id="scale" role="group" aria-label="Nota da integração de 1 a 5">
      ${SATISFACTION_FACES.map((f) => `<button type="button" data-n="${f.score}" aria-pressed="false" aria-label="${f.score} de 5: ${f.label}" style="--c:${f.color}">${faceSvg(f.score)}<span>${f.label}</span></button>`).join("")}
    </div>
    <div id="rest" hidden>
      <div class="q">
        <p id="readyLabel">Você já consegue usar sozinho?</p>
        <div class="ready" id="ready" role="group" aria-labelledby="readyLabel">
          <button type="button" data-v="sim" aria-pressed="false" style="--c:#1f9d55">Sim</button>
          <button type="button" data-v="parcial" aria-pressed="false" style="--c:#b8860b">Em parte</button>
          <button type="button" data-v="nao" aria-pressed="false" style="--c:#d64545">Ainda não</button>
        </div>
      </div>
      <div class="q">
        <label for="comment">O que poderia ter sido melhor? (opcional)</label>
        <textarea id="comment" maxlength="2000" placeholder="pode escrever à vontade"></textarea>
      </div>
      <button class="send" type="submit" id="send">enviar</button>
    </div>
  </form>
</div>
<div class="foot">Lever · leva uns 30 segundos</div>`, `<script>window.__SURVEY__ = ${escJson({ token })};
window.__SURVEY_DONE__ = ${escJson(surveyDoneHtml(company))};</script>
<script>
(function () {
  var T = window.__SURVEY__ || {};
  var scale = document.getElementById("scale");
  var ready = document.getElementById("ready");
  var rest = document.getElementById("rest");
  var send = document.getElementById("send");
  var form = document.getElementById("f");
  var nota = null, pronto = "", enviando = false, gravada = false;


  function post(corpo, entao) {
    var x = new XMLHttpRequest();
    x.open("POST", "/public/pesquisa/" + T.token, true);
    x.setRequestHeader("Content-Type", "application/json");
    x.onreadystatechange = function () { if (x.readyState === 4 && entao) entao(x.status); };
    x.send(JSON.stringify(corpo));
  }
  function marca(grupo, alvo) {
    var todos = grupo.querySelectorAll("button");
    for (var k = 0; k < todos.length; k++) todos[k].setAttribute("aria-pressed", todos[k] === alvo ? "true" : "false");
  }

  scale.addEventListener("click", function (e) {
    var b = e.target.closest("button");
    if (!b || enviando) return;
    nota = Number(b.dataset.n);
    marca(scale, b);
    scale.className = "scale5 picked";
    rest.hidden = false;
    // A nota vale por si: grava no clique, o resto é extra que pode nem vir.
    // Trocar a nota logo depois também grava (o servidor aceita por 15 min).
    enviando = true;
    post({ score: nota }, function (st) { enviando = false; gravada = st >= 200 && st < 300; });
  });

  ready.addEventListener("click", function (e) {
    var b = e.target.closest("button");
    if (!b) return;
    pronto = b.dataset.v;
    marca(ready, b);
  });

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    if (nota == null || enviando) return;
    var texto = document.getElementById("comment").value;
    enviando = true;
    send.disabled = true;
    send.textContent = "enviando…";
    var termina = function () { document.open(); document.write(window.__SURVEY_DONE__ || ""); document.close(); };
    var corpo = gravada ? {} : { score: nota };
    if (pronto) corpo.ready = pronto;
    if (texto.trim()) corpo.comment = texto;
    if (!Object.keys(corpo).length) { termina(); return; }
    post(corpo, termina);
  });
})();
</script>`);
}
