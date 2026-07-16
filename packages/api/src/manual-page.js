// Página pública do Manual da Família (/m/:id) — o entregável final da mentoria
// R.O.T.I.N.A, com a marca UniqueKids (manual de marca: navy #023047, azul
// #00589A, amarelo #FFD71E, laranja #EF5D2B, verde #00B800, Montserrat).
// Server-rendered puro (sem client script): recebe o publicManual() e devolve
// HTML pronto, print-friendly (a família salva em PDF pelo próprio navegador).

const esc = (s) => String(s == null ? "" : s)
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;").replaceAll("'", "&#39;");

// *destaque* → <strong> (depois do escape, seguro).
const emph = (s) => s.replace(/\*([^*\n]+)\*/g, "<strong>$1</strong>");

// Texto livre da Ana → HTML: linhas em branco separam parágrafos; linhas
// começando com "• " ou "- " viram itens de lista.
function renderContent(text) {
  const blocks = String(text || "").replace(/\r\n/g, "\n").split(/\n{2,}/);
  return blocks.map((raw) => {
    const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
    if (!lines.length) return "";
    const isList = lines.every((l) => /^([•·]|-)\s+/.test(l));
    if (isList) {
      const items = lines.map((l) => `<li>${emph(esc(l.replace(/^([•·]|-)\s+/, "")))}</li>`).join("");
      return `<ul>${items}</ul>`;
    }
    return `<p>${lines.map((l) => emph(esc(l))).join("<br/>")}</p>`;
  }).join("");
}

const NAVY = "#023047", BLUE = "#00589A", YELLOW = "#FFD71E", ORANGE = "#EF5D2B", GREEN = "#00B800";

// Símbolo da marca: quadrado amarelo + círculo laranja + triângulo verde.
const MARK = `<svg width="34" height="34" viewBox="0 0 34 34" aria-hidden="true"><rect x="1" y="9" width="15" height="15" rx="3" fill="${YELLOW}"/><circle cx="24" cy="11" r="8" fill="${ORANGE}"/><path d="M17 33 L25 19 L33 33 Z" fill="${GREEN}"/></svg>`;

const ACCENTS = [BLUE, ORANGE, GREEN, "#8B3D6F", YELLOW, NAVY]; // uma cor por seção, cíclico

export function manualPageHtml(m) {
  const first = (m.clientName || "").trim().split(/\s+/)[0] || "família";
  const dt = m.deliveredAt ? new Date(m.deliveredAt) : null;
  const when = dt && Number.isFinite(dt.getTime())
    ? dt.toLocaleDateString("pt-BR", { day: "numeric", month: "long", year: "numeric" })
    : "";
  const sections = (m.sections || []).map((s, i) => {
    const accent = ACCENTS[i % ACCENTS.length];
    return `
    <section class="sec">
      <div class="sec-head">
        <span class="sec-n" style="background:${accent}1a;color:${accent};border-color:${accent}55">${i + 1}</span>
        <h2 style="border-color:${accent}">${emph(esc(s.title))}</h2>
      </div>
      <div class="sec-body">${renderContent(s.content)}</div>
    </section>`;
  }).join("\n");

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<meta name="robots" content="noindex"/>
<title>Manual da Família ${esc(first)} · UniqueKids</title>
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;600;700;800&display=swap" rel="stylesheet"/>
<style>
  :root { --navy:${NAVY}; --blue:${BLUE}; --ink:#1c2b36; --ink2:#51616d; --line:#e3ebf1; --bg:#f7fafc; }
  * { box-sizing: border-box; margin: 0; }
  body { background: var(--bg); color: var(--ink); font-family: 'Montserrat', system-ui, sans-serif; line-height: 1.65; }
  .page { max-width: 820px; margin: 0 auto; padding: 28px 22px 60px; }
  header.hero { background: var(--navy); color: #fff; border-radius: 18px; padding: 34px 32px; margin-bottom: 26px; }
  .brand { display: flex; align-items: center; gap: 10px; margin-bottom: 22px; }
  .brand b { font-size: 15px; font-weight: 800; letter-spacing: .02em; }
  .hero h1 { font-size: clamp(26px, 5vw, 38px); font-weight: 800; line-height: 1.15; letter-spacing: -.01em; }
  .hero h1 em { font-style: normal; color: ${YELLOW}; }
  .hero p { margin-top: 12px; font-size: 15px; color: #cfe0ec; max-width: 560px; }
  .hero .meta { margin-top: 18px; font-size: 12.5px; color: #9fc0d6; }
  .sec { background: #fff; border: 1px solid var(--line); border-radius: 16px; padding: 26px 28px; margin-bottom: 18px; break-inside: avoid; }
  .sec-head { display: flex; align-items: center; gap: 12px; margin-bottom: 14px; }
  .sec-n { width: 30px; height: 30px; border-radius: 9px; border: 1px solid; display: inline-flex; align-items: center; justify-content: center; font-weight: 800; font-size: 14px; flex-shrink: 0; }
  .sec h2 { font-size: 19px; font-weight: 800; color: var(--navy); border-left: 4px solid; padding-left: 12px; line-height: 1.25; }
  .sec-body p { margin: 0 0 12px; font-size: 14.5px; color: var(--ink); }
  .sec-body p:last-child { margin-bottom: 0; }
  .sec-body ul { margin: 0 0 12px; padding-left: 20px; }
  .sec-body li { margin-bottom: 6px; font-size: 14.5px; }
  .sec-body strong { color: var(--blue); font-weight: 700; }
  footer { text-align: center; margin-top: 34px; color: var(--ink2); font-size: 12.5px; }
  footer b { color: var(--navy); }
  @media print {
    body { background: #fff; }
    .page { padding: 0; max-width: none; }
    header.hero { border-radius: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .sec { border: none; border-bottom: 1px solid var(--line); border-radius: 0; }
  }
</style>
</head>
<body>
<div class="page">
  <header class="hero">
    <div class="brand">${MARK}<b>UniqueKids · Método R.O.T.I.N.A</b></div>
    <h1>Manual da <em>família ${esc(first)}</em>.</h1>
    <p>Tudo o que construímos juntas ao longo da jornada${m.childName ? ` pra rotina de ${esc(m.childName)}` : ""}: o plano, as respostas e as falas que funcionam na SUA casa. O método agora fica com vocês.</p>
    ${when ? `<div class="meta">Entregue em ${esc(when)} · com carinho, Ana Dubena</div>` : ""}
  </header>
  ${sections || '<section class="sec"><div class="sec-body"><p>Este manual ainda está sendo construído ao longo das consultas.</p></div></section>'}
  <footer>Feito à mão pra sua família por <b>Ana Dubena</b> · UniqueKids · Método R.O.T.I.N.A</footer>
</div>
</body>
</html>`;
}
