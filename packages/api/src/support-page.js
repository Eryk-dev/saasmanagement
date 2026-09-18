// Portal público do Suporte: HTML standalone servido pela API (mesmo molde do
// nps-page.js). Duas páginas:
//   /s/:token      o chamado — status, conversa PÚBLICA e resposta com anexo;
//   /s/new/:saas   abrir um chamado novo (só com o portal ligado no produto).
//
// Regra que não pode quebrar: a página só recebe o que `publicTicket` deixa
// passar. Nota interna, anexo interno, responsável e SLA nunca chegam aqui.
//
// O script do cliente evita template literals de propósito: o arquivo inteiro é
// um template literal (mesma regra do nps-page.js / integration-form-page.js).
// Texto de usuário entra no DOM por textContent, nunca por innerHTML.

import { STATUS_KIND } from "./tickets-core.js";

const escJson = (obj) => JSON.stringify(obj).replace(/</g, "\\u003c");
const esc = (s) => String(s == null ? "" : s)
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;").replaceAll("'", "&#39;");

// Como o CLIENTE lê o status (a fila interna usa outros nomes).
export const PUBLIC_STATUS = {
  new: "Recebido",
  open: "Em atendimento",
  pending_customer: "Aguardando sua resposta",
  on_hold: "Em análise",
  resolved: "Resolvido",
  closed: "Encerrado",
};

const firstName = (s) => String(s || "").trim().split(/\s+/)[0] || "";

// O recorte público do ticket. É a ÚNICA porta de dado do portal (HTML e JSON).
export function publicTicket(ticket, { users = [], product = null } = {}) {
  const publicAtt = new Map((ticket.attachments || []).filter((a) => a.public).map((a) => [a.id, { id: a.id, name: a.name || "arquivo", size: a.size || 0 }]));
  const agentName = (id) => firstName(users.find((u) => u.id === id)?.name) || (product?.name ? `Equipe ${product.name}` : "Equipe");
  const messages = [];
  if (ticket.description) messages.push({ id: "request", from: "customer", name: ticket.requester?.name || "", text: ticket.description, at: ticket.createdAt, attachments: [] });
  for (const m of ticket.messages || []) {
    if (m.kind !== "reply") continue;
    const customer = m.author?.type === "customer";
    messages.push({
      id: m.id, from: customer ? "customer" : "agent",
      name: customer ? (m.author?.name || ticket.requester?.name || "") : agentName(m.author?.id),
      text: m.text || "", at: m.at,
      attachments: (m.attachments || []).map((id) => publicAtt.get(id)).filter(Boolean),
    });
  }
  return {
    number: ticket.number, subject: ticket.subject, saas: ticket.saas,
    status: ticket.status, statusLabel: PUBLIC_STATUS[ticket.status] || "Em atendimento",
    done: STATUS_KIND[ticket.status] === "done", closed: ticket.status === "closed",
    createdAt: ticket.createdAt, updatedAt: ticket.updatedAt,
    requesterName: ticket.requester?.name || "",
    product: product ? { name: product.name || "", accent: Number(product.accent) || 183 } : null,
    messages,
    attachments: [...publicAtt.values()],
  };
}

const style = (hue) => `
  :root {
    --bg:#f7f8fa; --card:#ffffff; --ink:#0c1d2b; --ink2:#41535f; --ink3:#6b7b86;
    --line:#e4e8eb; --line2:#cbd4da; --accent:oklch(0.52 0.1 ${hue}); --accent-soft:oklch(0.52 0.1 ${hue} / 0.09);
    --btn:#0c1d2b; --btn-fg:#ffffff; --pos:#177a4c; --warn:#a16207; --neg:#b42318; --r:12px;
  }
  * { box-sizing:border-box; -webkit-tap-highlight-color:transparent; }
  body { margin:0; background:var(--bg); color:var(--ink); font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif; }
  .wrap { max-width:680px; margin:0 auto; padding:32px 20px 56px; }
  .brand { display:flex; align-items:center; gap:9px; margin-bottom:24px; }
  .brand i { width:26px; height:26px; border-radius:8px; background:var(--accent); display:inline-block; }
  .brand span { font-size:14px; font-weight:650; color:var(--ink2); }
  .card { background:var(--card); border:1px solid var(--line); border-radius:var(--r); padding:24px; }
  .card + .card { margin-top:14px; }
  h1 { margin:0 0 6px; font-size:21px; line-height:1.3; font-weight:700; letter-spacing:-.01em; }
  .sub { margin:0 0 4px; font-size:14px; color:var(--ink3); }
  .status { display:inline-flex; align-items:center; gap:7px; font-size:13px; font-weight:600; color:var(--ink2); }
  .status::before { content:""; width:8px; height:8px; border-radius:50%; background:var(--dot, var(--accent)); }
  .msg { border:1px solid var(--line); border-radius:10px; padding:11px 13px; margin-top:10px; white-space:pre-wrap; word-break:break-word; font-size:14.5px; }
  .msg.agent { background:var(--accent-soft); border-color:transparent; margin-left:28px; }
  .msg.customer { margin-right:28px; }
  .who { display:block; font-size:12px; color:var(--ink3); margin-bottom:3px; white-space:normal; }
  .files { margin-top:6px; font-size:13px; white-space:normal; }
  .files a { color:var(--accent); margin-right:10px; }
  label { display:block; font-size:13.5px; font-weight:600; margin:14px 0 6px; }
  input[type=text], input[type=email], input[type=tel], select, textarea {
    width:100%; padding:10px 12px; border:1px solid var(--line2); border-radius:10px;
    font-family:inherit; font-size:14.5px; line-height:1.5; color:var(--ink); background:#fff;
  }
  textarea { min-height:110px; resize:vertical; }
  :is(input, select, textarea):focus { outline:none; border-color:var(--accent); }
  .row { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
  .send { display:block; margin-top:16px; height:44px; padding:0 22px; border:0; border-radius:10px; background:var(--btn); color:var(--btn-fg); font-family:inherit; font-size:14.5px; font-weight:600; cursor:pointer; }
  .send[disabled] { opacity:.5; cursor:default; }
  .hint { font-size:13px; color:var(--ink3); margin:8px 0 0; }
  .err { color:var(--neg); font-size:13.5px; margin-top:10px; }
  .hp { position:absolute; left:-9999px; width:1px; height:1px; overflow:hidden; }
  .ok { text-align:center; padding:12px 0 4px; }
  .ok .mark { width:46px; height:46px; margin:0 auto 14px; border-radius:999px; background:#b423180f; color:var(--neg); display:flex; align-items:center; justify-content:center; font-size:22px; }
  .foot { margin-top:20px; text-align:center; font-size:12px; color:var(--ink3); }
  [hidden] { display:none !important; }
  @media (max-width:520px) {
    .wrap { padding:22px 14px 40px; }
    .card { padding:18px 15px; }
    .row { grid-template-columns:1fr; gap:0; }
    .msg.agent { margin-left:10px; } .msg.customer { margin-right:10px; }
  }
`;

const shell = ({ title, brand = "Suporte", hue = 183, body, script = "" }) => `<!doctype html>
<html lang="pt-BR"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${esc(title)}</title>
<style>${style(Number(hue) || 183)}</style>
</head><body>
<div class="wrap">
  <div class="brand"><i aria-hidden="true"></i><span>${esc(brand)} · Suporte</span></div>
  ${body}
</div>
${script}
</body></html>`;

export const supportNotFoundHtml = (message = "Esse link de chamado não existe ou foi removido.") => shell({
  title: "Link não encontrado",
  body: `<div class="card"><div class="ok"><div class="mark">!</div><h1>Link não encontrado</h1><p class="sub">${esc(message)}</p></div></div>`,
});

// Página do chamado. `view` é o recorte de publicTicket.
export function supportTicketHtml({ token, view, portalEnabled = false }) {
  const brand = view.product?.name || "Suporte";
  const tone = view.closed ? "#6b7b86" : view.status === "pending_customer" ? "#a16207" : view.done ? "#177a4c" : "";
  const quando = (iso) => (iso ? new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "");
  const messages = view.messages.map((m) => `<div class="msg ${m.from === "agent" ? "agent" : "customer"}"><span class="who">${esc(m.from === "agent" ? m.name : (m.name || "Você"))} · ${esc(quando(m.at))}</span>${esc(m.text)}${
    m.attachments.length ? `<div class="files">${m.attachments.map((a) => `<a href="/public/support/${esc(token)}/attachments/${esc(a.id)}" target="_blank" rel="noopener">↓ ${esc(a.name)}</a>`).join("")}</div>` : ""
  }</div>`).join("") || `<p class="hint">Ainda não há mensagens.</p>`;
  const reply = view.closed
    ? `<div class="card"><p class="sub" style="margin:0">Este chamado foi encerrado.${portalEnabled ? ` Se precisar de algo novo, <a href="/s/new/${esc(view.saas)}" style="color:var(--accent)">abra outro chamado</a>.` : ""}</p></div>`
    : `<div class="card"><form id="f" novalidate>
        <label for="text" style="margin-top:0">Responder</label>
        <textarea id="text" maxlength="10000" placeholder="Escreva aqui o que precisar"></textarea>
        <label for="file" style="font-weight:500;font-size:13px">Anexar arquivos (até 5MB cada)</label>
        <input id="file" type="file" multiple>
        <div class="hp" aria-hidden="true"><input id="hp" type="text" tabindex="-1" autocomplete="off"></div>
        ${view.done ? `<p class="hint">Este chamado está resolvido. Se ainda precisar de ajuda, responda abaixo que ele volta para a equipe.</p>` : ""}
        <div class="err" id="err" role="alert" hidden></div>
        <button class="send" id="send" type="submit">Enviar resposta</button>
      </form></div>`;
  return shell({
    title: `Chamado #${view.number}`, brand, hue: view.product?.accent,
    body: `<div class="card">
      <p class="sub">Chamado #${esc(view.number)} · aberto em ${esc(quando(view.createdAt))}</p>
      <h1>${esc(view.subject)}</h1>
      <span class="status" style="${tone ? `--dot:${tone}` : ""}">${esc(view.statusLabel)}</span>
    </div>
    <div class="card"><div style="font-size:13px;font-weight:650;color:var(--ink2)">Conversa</div>${messages}</div>
    ${reply}
    <div class="foot">Guarde este link: é por ele que você acompanha o chamado.</div>`,
    script: view.closed ? "" : `<script>window.__TICKET__ = ${escJson({ token })};</script>
<script>
(function () {
  var T = window.__TICKET__ || {};
  var form = document.getElementById("f");
  var send = document.getElementById("send");
  var err = document.getElementById("err");
  function fail(msg) { err.textContent = msg; err.hidden = false; send.disabled = false; send.textContent = "Enviar resposta"; }
  function req(method, url, body, isForm, done) {
    var x = new XMLHttpRequest();
    x.open(method, url, true);
    if (!isForm) x.setRequestHeader("Content-Type", "application/json");
    x.onreadystatechange = function () {
      if (x.readyState !== 4) return;
      var data = null; try { data = JSON.parse(x.responseText); } catch (e) {}
      done(x.status, data || {});
    };
    x.send(isForm ? body : JSON.stringify(body));
  }
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var text = document.getElementById("text").value;
    var files = document.getElementById("file").files || [];
    if (!text.trim() && !files.length) { fail("Escreva a mensagem ou anexe um arquivo."); return; }
    err.hidden = true; send.disabled = true; send.textContent = "Enviando…";
    var ids = [], i = 0;
    function next() {
      if (i >= files.length) {
        req("POST", "/public/support/" + T.token + "/messages", { text: text, attachments: ids, _hp: document.getElementById("hp").value }, false, function (status, data) {
          if (status >= 200 && status < 300) { location.reload(); return; }
          fail(data.error || "Não foi possível enviar. Tente de novo em instantes.");
        });
        return;
      }
      var file = files[i++];
      if (file.size > 5 * 1024 * 1024) { fail(file.name + ": arquivo acima de 5MB."); return; }
      var fd = new FormData(); fd.append("file", file, file.name);
      req("POST", "/public/support/" + T.token + "/attachments", fd, true, function (status, data) {
        if (status >= 200 && status < 300 && data.attachment) { ids.push(data.attachment.id); next(); return; }
        fail(data.error || ("Não foi possível anexar " + file.name + "."));
      });
    }
    next();
  });
})();
</script>`,
  });
}

// Abrir chamado novo pelo link público do produto.
export function supportNewTicketHtml({ product, settings }) {
  const categories = settings?.categories || [];
  return shell({
    title: `Abrir chamado · ${product.name || "Suporte"}`, brand: product.name, hue: product.accent,
    body: `<div class="card"><form id="f" novalidate>
      <h1>Como podemos ajudar?</h1>
      <p class="sub">${esc(settings?.portal?.intro || "Conte o que aconteceu. Você recebe um link para acompanhar a resposta.")}</p>
      <div class="row">
        <div><label for="name">Seu nome</label><input id="name" type="text" maxlength="200" autocomplete="name" required></div>
        <div><label for="email">E-mail</label><input id="email" type="email" maxlength="200" autocomplete="email" required></div>
      </div>
      <div class="row">
        <div><label for="phone">Telefone (opcional)</label><input id="phone" type="tel" maxlength="40" autocomplete="tel"></div>
        ${categories.length ? `<div><label for="category">Assunto</label><select id="category"><option value="">Selecione</option>${categories.map((c) => `<option>${esc(c)}</option>`).join("")}</select></div>` : "<div></div>"}
      </div>
      <label for="subject">Resumo</label><input id="subject" type="text" maxlength="200" placeholder="Ex.: não consigo acessar o painel" required>
      <label for="description">Detalhes</label><textarea id="description" maxlength="10000" placeholder="O que aconteceu, desde quando, e o que você já tentou" required></textarea>
      <div class="hp" aria-hidden="true"><input id="hp" type="text" tabindex="-1" autocomplete="off"></div>
      <div class="err" id="err" role="alert" hidden></div>
      <button class="send" id="send" type="submit">Abrir chamado</button>
    </form></div>
    <div class="foot">${esc(product.name || "")} · atendimento</div>`,
    script: `<script>window.__PORTAL__ = ${escJson({ saas: product.id })};</script>
<script>
(function () {
  var P = window.__PORTAL__ || {};
  var form = document.getElementById("f");
  var send = document.getElementById("send");
  var err = document.getElementById("err");
  function val(id) { var el = document.getElementById(id); return el ? el.value : ""; }
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var body = { name: val("name"), email: val("email"), phone: val("phone"), category: val("category"), subject: val("subject"), description: val("description"), _hp: val("hp") };
    if (!body.name.trim() || !body.email.trim() || !body.subject.trim() || !body.description.trim()) { err.textContent = "Preencha nome, e-mail, resumo e detalhes."; err.hidden = false; return; }
    err.hidden = true; send.disabled = true; send.textContent = "Enviando…";
    var x = new XMLHttpRequest();
    x.open("POST", "/public/support/new/" + P.saas, true);
    x.setRequestHeader("Content-Type", "application/json");
    x.onreadystatechange = function () {
      if (x.readyState !== 4) return;
      var data = {}; try { data = JSON.parse(x.responseText); } catch (e2) {}
      if (x.status >= 200 && x.status < 300 && data.url) { location.href = data.url; return; }
      err.textContent = data.error || "Não foi possível abrir o chamado. Tente de novo em instantes.";
      err.hidden = false; send.disabled = false; send.textContent = "Abrir chamado";
    };
    x.send(JSON.stringify(body));
  });
})();
</script>`,
  });
}
