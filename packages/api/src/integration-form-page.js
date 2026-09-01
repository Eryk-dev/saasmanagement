// Página pública do Formulário de Integração (/fi/:id). HTML standalone servido
// pela API, no design system Lever Premium (paper claro, ink navy, teal com
// parcimônia) — o mesmo visual do form de captação, mas com estrutura de
// FORMULÁRIO LONGO (tudo numa página, seções numeradas, revisão antes de
// enviar), não de funil de conversão: quem preenche já é cliente e precisa
// enxergar o conjunto pra responder direito.
//
// A definição vai inline em `window.__IF__` e a página se monta a partir dela —
// uma via só de renderização (o servidor não desenha campo nenhum), então
// pergunta nova em integration-form.js aparece aqui sem tocar neste arquivo.
//
// O script do cliente evita template literals de propósito: o arquivo inteiro é
// um template literal, então o código interno usa concatenação pra não escapar
// crase (mesma regra do form-page.js).

const escJson = (obj) => JSON.stringify(obj).replace(/</g, "\\u003c");
const esc = (s) => String(s == null ? "" : s)
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;").replaceAll("'", "&#39;");

const BRAND_ICON = "https://copy.levermoney.com.br/lever/logo-icon-color.svg";

const STYLE = `
  :root {
    --bg:#f7f8fa; --card:#ffffff; --inset:#fbfcfd; --well:#eef1f3;
    --ink:#0c1d2b; --ink2:#41535f; --ink3:#6b7b86; --ink4:#98a5af;
    --line:#e4e8eb; --line2:#cbd4da; --teal:#0f766e; --teal-soft:#0f766e1a;
    --btn:#0c1d2b; --btn-fg:#ffffff; --neg:#b42318; --neg-soft:#b423180f;
    --pos:#177a4c; --r:12px;
  }
  * { box-sizing: border-box; margin: 0; }
  html { -webkit-text-size-adjust: 100%; }
  body { background: var(--bg); color: var(--ink); font-family: 'Instrument Sans', system-ui, -apple-system, sans-serif; line-height: 1.55; font-size: 15px; }
  .wrap { max-width: 760px; margin: 0 auto; padding: 26px 18px 80px; }

  header.hero { background: var(--card); border: 1px solid var(--line); border-radius: 16px; padding: 26px 24px; margin-bottom: 18px; }
  .brand { display: flex; align-items: center; gap: 10px; margin-bottom: 18px; }
  .brand img { height: 30px; width: auto; display: block; }
  .brand span { font-size: 11px; letter-spacing: .09em; text-transform: uppercase; color: var(--ink4); }
  h1 { font-size: 27px; line-height: 1.2; letter-spacing: -.02em; font-weight: 700; }
  .hero p { color: var(--ink2); font-size: 14.5px; margin-top: 10px; }
  .hero .who { margin-top: 14px; display: inline-flex; align-items: center; gap: 8px; background: var(--teal-soft); color: var(--teal); border-radius: 999px; padding: 6px 13px; font-size: 13px; font-weight: 600; }

  section.card { background: var(--card); border: 1px solid var(--line); border-radius: var(--r); padding: 22px 22px 24px; margin-bottom: 14px; }
  .sec-n { font-size: 11px; letter-spacing: .09em; text-transform: uppercase; color: var(--teal); font-weight: 600; }
  h2 { font-size: 18px; font-weight: 700; letter-spacing: -.01em; margin-top: 4px; }
  .sec-intro { color: var(--ink3); font-size: 13.5px; margin-top: 6px; }

  .q { margin-top: 20px; }
  .q > label.lbl { display: block; font-size: 14px; font-weight: 600; color: var(--ink); margin-bottom: 3px; }
  .q .help { font-size: 12.5px; color: var(--ink3); margin-bottom: 8px; }
  .q .req { color: var(--teal); margin-left: 3px; }

  input[type=text], input[type=email], input[type=tel], select, textarea {
    width: 100%; font: inherit; font-size: 14.5px; color: var(--ink); background: var(--card);
    border: 1px solid var(--line2); border-radius: 8px; padding: 9px 11px; outline: none;
  }
  textarea { min-height: 92px; resize: vertical; line-height: 1.5; }
  select { appearance: none; background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%236b7b86' stroke-width='2.4' stroke-linecap='round'><path d='M6 9l6 6 6-6'/></svg>"); background-repeat: no-repeat; background-position: right 10px center; padding-right: 32px; }
  input:focus, select:focus, textarea:focus { border-color: var(--teal); box-shadow: 0 0 0 3px var(--teal-soft); }
  .bad input, .bad select, .bad textarea { border-color: var(--neg); background: var(--neg-soft); }
  .err { display: none; color: var(--neg); font-size: 12.5px; margin-top: 5px; font-weight: 600; }
  .bad .err { display: block; }

  .ack { display: flex; gap: 11px; align-items: flex-start; background: var(--inset); border: 1px solid var(--line); border-radius: 10px; padding: 12px 14px; cursor: pointer; }
  .ack input { margin-top: 3px; width: 17px; height: 17px; accent-color: var(--teal); flex: 0 0 auto; }
  .ack span { font-size: 13.5px; color: var(--ink2); }
  .bad .ack { border-color: var(--neg); background: var(--neg-soft); }
  .ack + .help { margin: 6px 0 0; }

  .rows { display: flex; flex-direction: column; gap: 12px; }
  .row { border: 1px solid var(--line); border-radius: 10px; padding: 14px; background: var(--inset); }
  .row-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
  .row-head b { font-size: 12px; letter-spacing: .07em; text-transform: uppercase; color: var(--ink4); font-weight: 600; }
  .row-del { background: none; border: 0; color: var(--ink3); font-size: 12.5px; cursor: pointer; padding: 2px 4px; text-decoration: underline; }
  .row .f { margin-top: 10px; }
  .row .f label { display: block; font-size: 12.5px; font-weight: 600; color: var(--ink2); margin-bottom: 4px; }
  .add { margin-top: 12px; background: var(--card); border: 1px solid var(--line2); border-radius: 8px; padding: 8px 14px; font: inherit; font-size: 13.5px; font-weight: 600; color: var(--ink); cursor: pointer; }
  .add:hover { border-color: var(--teal); color: var(--teal); }

  .term { background: var(--well); border-radius: 10px; padding: 16px 18px; margin-top: 14px; }
  .term p { font-size: 13.5px; color: var(--ink2); }
  .term p + p { margin-top: 10px; }

  .actions { margin-top: 20px; }
  .cta { width: 100%; background: var(--btn); color: var(--btn-fg); border: 0; border-radius: 10px; padding: 15px 18px; font: inherit; font-size: 15.5px; font-weight: 700; cursor: pointer; }
  .cta:disabled { opacity: .55; cursor: default; }
  .foot { text-align: center; color: var(--ink4); font-size: 12.5px; margin-top: 14px; }
  .formerr { display: none; margin-top: 12px; color: var(--neg); font-size: 13.5px; font-weight: 600; text-align: center; }

  .done { background: var(--card); border: 1px solid var(--line); border-radius: 16px; padding: 40px 26px; text-align: center; }
  .done .mark { width: 52px; height: 52px; border-radius: 999px; background: var(--teal-soft); color: var(--teal); display: grid; place-items: center; margin: 0 auto 16px; font-size: 24px; }
  .done h1 { font-size: 23px; }
  .done p { color: var(--ink2); font-size: 14.5px; margin-top: 10px; }

  @media (max-width: 560px) {
    .wrap { padding: 16px 12px 60px; }
    header.hero, section.card { padding: 18px 16px; border-radius: 12px; }
    h1 { font-size: 23px; }
  }
`;

// Página do formulário já respondido (ou do link recebido depois do envio): o
// cliente não reescreve sozinho o que já assinou — mudança de regra passa pela
// equipe, que é justamente o combinado do termo.
function doneHtml(f, { justSent = false } = {}) {
  const when = f.respondedAt ? new Date(f.respondedAt).toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" }) : "";
  return `<div class="done">
    <div class="mark">✓</div>
    <h1>${justSent ? "Recebemos tudo, obrigado!" : "Este formulário já foi enviado"}</h1>
    <p>${justSent
      ? "Suas respostas foram para o time de integração. A gente usa exatamente elas pra configurar as suas contas, e o resto a gente resolve junto na call."
      : `As respostas chegaram${when ? ` em ${when}` : ""}. Se alguma informação mudou, fale com o time da LeverAds que a gente atualiza aqui.`}</p>
  </div>`;
}

export function integrationFormPageHtml(f, { done = false } = {}) {
  const title = "Formulário de Integração · LeverAds";
  const body = done || f.status === "respondido"
    ? doneHtml(f)
    : `
  <header class="hero">
    <div class="brand"><img src="${BRAND_ICON}" alt=""><span>LeverAds</span></div>
    <h1>Formulário de Integração</h1>
    <p>Antes da call de integração a gente precisa conhecer a sua operação: quais contas entram, de onde os anúncios saem, para onde vão, o que não pode ser clonado e como fica o estoque. É o que a gente configura na sua conta, então vale responder com calma.</p>
    <p>São poucos minutos e todas as perguntas são obrigatórias.</p>
    ${f.clientName ? `<div class="who">${esc(f.clientName)}</div>` : ""}
  </header>
  <form id="form" novalidate></form>
  <div class="foot">LeverAds · Lever Ads Software House LTDA</div>`;

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${title}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>${STYLE}</style>
</head>
<body>
<div class="wrap">${body}</div>
<script>window.__IF__ = ${escJson(f)};
window.__IF_DONE__ = ${escJson(doneHtml(f, { justSent: true }))};</script>
<script>${CLIENT_JS}</script>
</body>
</html>`;
}

// ── Script da página ─────────────────────────────────────────────────────────
// Monta o formulário a partir de window.__IF__ (mesma definição do servidor),
// aplica as condicionais, valida tudo antes de mandar e mostra a tela final.
const CLIENT_JS = `
(function () {
  var F = window.__IF__ || {};
  var form = document.getElementById('form');
  if (!form || F.status === 'respondido') return;
  var answers = {};           // estado único: o DOM escreve aqui, a condicional lê daqui
  var listRows = {};          // chave da pergunta -> array de linhas (objetos)
  var listRefs = {};          // chave da pergunta -> [{row, key, node}] da render atual

  function el(tag, cls, txt) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (txt != null) n.textContent = txt;
    return n;
  }
  function visible(q) {
    if (!q.showIf) return true;
    var v = answers[q.showIf.key];
    return (q.showIf.in || []).indexOf(v) >= 0;
  }
  function field(type, opts, value, onChange) {
    var n;
    if (type === 'select') {
      n = el('select');
      var ph = el('option', null, 'selecione…');
      ph.value = '';
      n.appendChild(ph);
      (opts || []).forEach(function (o) {
        var op = el('option', null, o);
        op.value = o;
        n.appendChild(op);
      });
    } else if (type === 'textarea') {
      n = el('textarea');
    } else {
      n = el('input');
      n.type = type === 'email' ? 'email' : type === 'phone' ? 'tel' : 'text';
      if (type === 'phone') n.inputMode = 'tel';
    }
    if (value) n.value = value;
    n.addEventListener('input', function () { onChange(n.value); });
    n.addEventListener('change', function () { onChange(n.value); });
    return n;
  }

  // Uma pergunta = um bloco .q. Guardamos a referência no próprio nó pra
  // revalidar e reavaliar a condicional sem remontar a página.
  var blocks = [];
  function questionBlock(q) {
    var wrap = el('div', 'q');
    var ctl = null;
    wrap.dataset.key = q.key;
    if (q.type !== 'ack') {
      var lab = el('label', 'lbl');
      lab.textContent = q.label;
      var req = el('span', 'req', '*');
      lab.appendChild(req);
      wrap.appendChild(lab);
      if (q.help) wrap.appendChild(el('div', 'help', q.help));
    }

    if (q.type === 'list') {
      listRows[q.key] = [{}];
      var rows = el('div', 'rows');
      wrap.appendChild(rows);
      var add = el('button', 'add', '+ ' + (q.addLabel || 'adicionar'));
      add.type = 'button';
      add.addEventListener('click', function () { listRows[q.key].push({}); renderRows(); });
      wrap.appendChild(add);
      var errBox = el('div', 'err');
      wrap.appendChild(errBox);

      function renderRows() {
        rows.innerHTML = '';
        listRefs[q.key] = [];
        listRows[q.key].forEach(function (row, i) {
          var box = el('div', 'row');
          var head = el('div', 'row-head');
          head.appendChild(el('b', null, (q.rowLabel || 'Item') + ' ' + (i + 1)));
          if (listRows[q.key].length > (q.min || 1)) {
            var del = el('button', 'row-del', 'remover');
            del.type = 'button';
            del.addEventListener('click', function () { listRows[q.key].splice(i, 1); renderRows(); });
            head.appendChild(del);
          }
          box.appendChild(head);
          (q.fields || []).forEach(function (f) {
            var fw = el('div', 'f');
            var fl = el('label', null, f.label);
            fw.appendChild(fl);
            var inp = field(f.type, f.options, row[f.key], function (v) { row[f.key] = v; answers[q.key] = listRows[q.key]; });
            listRefs[q.key].push({ row: row, key: f.key, node: inp });
            fw.appendChild(inp);
            box.appendChild(fw);
          });
          rows.appendChild(box);
        });
        answers[q.key] = listRows[q.key];
      }
      renderRows();
      answers[q.key] = listRows[q.key];
    } else if (q.type === 'ack') {
      var lbl = el('label', 'ack');
      var cb = el('input');
      cb.type = 'checkbox';
      ctl = cb;
      cb.addEventListener('change', function () { answers[q.key] = cb.checked; sync(); });
      lbl.appendChild(cb);
      lbl.appendChild(el('span', null, q.label));
      wrap.appendChild(lbl);
      if (q.help) wrap.appendChild(el('div', 'help', q.help));
      wrap.appendChild(el('div', 'err'));
    } else {
      ctl = field(q.type, q.options, '', function (v) { answers[q.key] = v; sync(); });
      wrap.appendChild(ctl);
      wrap.appendChild(el('div', 'err'));
    }
    blocks.push({ q: q, node: wrap, ctl: ctl });
    return wrap;
  }

  (F.sections || []).forEach(function (s, i) {
    var sec = el('section', 'card');
    sec.appendChild(el('div', 'sec-n', 'Parte ' + (i + 1) + ' de ' + F.sections.length));
    sec.appendChild(el('h2', null, s.title));
    if (s.intro) sec.appendChild(el('div', 'sec-intro', s.intro));
    if (s.term) {
      var t = el('div', 'term');
      (F.term || []).forEach(function (p) { t.appendChild(el('p', null, p)); });
      sec.appendChild(t);
    }
    (s.questions || []).forEach(function (q) { sec.appendChild(questionBlock(q)); });
    form.appendChild(sec);
  });

  var actions = el('div', 'actions');
  var cta = el('button', 'cta', 'Enviar formulário');
  cta.type = 'submit';
  actions.appendChild(cta);
  var formErr = el('div', 'formerr');
  actions.appendChild(formErr);
  form.appendChild(actions);
  // Pré-visualização do time: mostra o formulário inteiro, mas não envia nada
  // (o link do cliente é o único que grava resposta).
  if (F.preview) { cta.disabled = true; cta.textContent = 'Pré-visualização · o envio só funciona no link do cliente'; }

  // Condicional: esconder também LIMPA a resposta, senão um "sim" desfeito
  // deixaria a regra antiga viajando junto no envio.
  function sync() {
    blocks.forEach(function (b) {
      var on = visible(b.q);
      b.node.style.display = on ? '' : 'none';
      if (!on && answers[b.q.key] !== undefined && b.q.type !== 'list') delete answers[b.q.key];
    });
  }
  sync();

  function setBad(node, msg) {
    node.classList.add('bad');
    var e = node.querySelector('.err');
    if (e) e.textContent = msg;
  }
  function blank(v) { return v == null || (typeof v === 'string' && !v.trim()); }

  // Autofill do celular e restauração de sessão preenchem o campo SEM disparar
  // 'input'/'change' — o estado ficava vazio e a validação reprovava formulário
  // visivelmente preenchido. No envio, o DOM é a fonte da verdade.
  function pull() {
    blocks.forEach(function (b) {
      var q = b.q;
      if (q.type === 'list') {
        (listRefs[q.key] || []).forEach(function (r) { r.row[r.key] = r.node.value; });
        answers[q.key] = listRows[q.key];
      } else if (q.type === 'ack') {
        answers[q.key] = !!(b.ctl && b.ctl.checked);
      } else if (b.ctl) {
        answers[q.key] = b.ctl.value;
      }
    });
  }

  function validate() {
    var first = null;
    blocks.forEach(function (b) {
      b.node.classList.remove('bad');
      if (!visible(b.q)) return;
      var q = b.q, v = answers[q.key], msg = '';
      if (q.type === 'list') {
        var rows = listRows[q.key] || [];
        var falta = rows.length < (q.min || 1);
        rows.forEach(function (r) {
          (q.fields || []).forEach(function (f) { if (blank(r[f.key])) falta = true; });
        });
        if (falta) msg = 'Preencha todos os campos de cada ' + (q.rowLabel || 'item').toLowerCase() + '.';
      } else if (q.type === 'ack') {
        if (v !== true) msg = 'Marque para continuar.';
      } else if (blank(v)) {
        msg = 'Preencha este campo.';
      } else if (q.type === 'email' && !/^[^\\s@]+@[^\\s@]+\\.[^\\s@]{2,}$/.test(v)) {
        msg = 'E-mail inválido.';
      } else if (q.type === 'phone' && String(v).replace(/\\D/g, '').length < 10) {
        msg = 'Telefone inválido (com DDD).';
      }
      if (msg) { setBad(b.node, msg); if (!first) first = b.node; }
    });
    return first;
  }

  form.addEventListener('submit', function (ev) {
    ev.preventDefault();
    formErr.style.display = 'none';
    pull();
    sync();
    var bad = validate();
    if (bad) {
      formErr.textContent = 'Faltou preencher alguma coisa. Os campos em vermelho estão logo acima.';
      formErr.style.display = 'block';
      bad.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    cta.disabled = true;
    cta.textContent = 'enviando…';
    fetch('/public/integration-forms/' + F.id, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ answers: answers })
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok, body: j }; });
    }).then(function (res) {
      if (!res.ok) throw new Error((res.body && res.body.error) || 'Não deu pra enviar agora.');
      document.querySelector('.wrap').innerHTML = window.__IF_DONE__ || '';
      window.scrollTo(0, 0);
    }).catch(function (e) {
      cta.disabled = false;
      cta.textContent = 'Enviar formulário';
      formErr.textContent = e.message + ' Tente de novo em instantes.';
      formErr.style.display = 'block';
    });
  });
})();
`;
