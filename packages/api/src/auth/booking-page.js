// Link curto do convite de agenda (07/10/2026): /a/:userId. O link do Google
// (calendar.app.google/…) chega no WhatsApp com o preview fixo em inglês
// ("Google Calendar - Easier Time Management…"), qualquer que seja o idioma
// pedido. Esta página responde ao robô do preview com título e descrição em
// português e manda quem clica direto pra agenda (users.bookingUrl).
// Só expõe o que a pessoa já publica: o nome e o link de convite dela.

// O link de convite do Google Agenda que a pessoa cadastra (página pública de
// horários disponíveis, ex.: https://calendar.app.google/…). Só https; "" limpa;
// null = inválido. Vale no salvar (PATCH /api/auth/me) e de novo aqui.
export function sanitizeBookingUrl(x) {
  const raw = String(x ?? "").trim();
  if (!raw) return "";
  if (raw.length > 500) return null;
  try { return new URL(raw).protocol === "https:" ? raw : null; } catch { return null; }
}

// Nome da conversa no título do preview (?t=); fora da lista vira "reunião".
const WHAT = { integracao: "integração", call: "call", reuniao: "reunião" };

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export function bookingPreview({ user, brand = "", what = "", base = "" }) {
  const url = sanitizeBookingUrl(user?.bookingUrl);
  if (!url) return null;
  const name = String(user.name || user.id || "").trim().split(/\s+/)[0] || "nosso time";
  const conversa = WHAT[what] || WHAT.reuniao;
  return {
    url,
    title: `Agende sua ${conversa} com ${name}${brand ? ` · ${brand}` : ""}`,
    description: "Escolha o melhor horário na agenda: os horários livres aparecem na hora e você já confirma direto.",
    image: user.photo && base ? `${base}${user.photo}` : "", // /public/users/:id?v=…
  };
}

export function bookingPageHtml(p) {
  const meta = [
    `<meta property="og:type" content="website">`,
    `<meta property="og:locale" content="pt_BR">`,
    `<meta property="og:title" content="${esc(p.title)}">`,
    `<meta property="og:description" content="${esc(p.description)}">`,
    p.image && `<meta property="og:image" content="${esc(p.image)}">`,
    `<meta name="description" content="${esc(p.description)}">`,
    `<meta name="robots" content="noindex">`,
  ].filter(Boolean).join("\n");
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(p.title)}</title>
${meta}
<meta http-equiv="refresh" content="0;url=${esc(p.url)}">
</head><body style="font-family:system-ui,sans-serif;padding:48px 20px;max-width:480px;margin:auto;color:#0c1d2b">
<p>Abrindo a agenda…</p>
<p><a href="${esc(p.url)}">Se não abrir sozinha, toque aqui.</a></p>
<script>location.replace(${JSON.stringify(p.url).replace(/</g, "\\u003c")});</script>
</body></html>`;
}

export function bookingMissingHtml() {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Agenda indisponível</title></head>
<body style="font-family:system-ui,sans-serif;padding:48px 20px;max-width:480px;margin:auto;color:#0c1d2b"><h2>Agenda indisponível</h2><p>Este link de agendamento não está mais ativo. Fale com quem te enviou para receber um novo.</p></body></html>`;
}
