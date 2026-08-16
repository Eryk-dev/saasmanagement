// Contratos — o DOCUMENTO em si: o CSS jurídico da impressão, os campos
// {{token}} do modelo e a montagem do HTML final. Mora aqui (e não na tela)
// porque duas telas geram o mesmo papel: a biblioteca de modelos (tela
// Contratos) e o bloco "Contratos gerados" da ficha do cliente, que reimprime o
// snapshot registrado no histórico — o mesmo contrato tem que sair idêntico nas
// duas portas.

// CSS de impressão dos contratos (portado de contrato-leverads.html). Vale pra
// todos os modelos: o corpo só traz h1/h2/p/ul/table.quadro/blocos de assinatura.
export const CONTRACT_CSS = `
  @page { size: A4; margin: 2.2cm 2cm; }
  * { box-sizing: border-box; }
  body { font-family: Georgia, "Times New Roman", serif; font-size: 10.5pt; line-height: 1.55; color: #111; max-width: 17cm; margin: 0 auto; padding: 24px 16px; background: #fff; }
  h1 { font-size: 13pt; text-align: center; text-transform: uppercase; letter-spacing: .04em; margin: 0 0 4px; }
  .subtitle { text-align: center; font-size: 9.5pt; color: #444; margin: 0 0 22px; }
  h2 { font-size: 10.5pt; text-transform: uppercase; letter-spacing: .03em; margin: 20px 0 6px; }
  p { margin: 6px 0; text-align: justify; }
  ul { margin: 6px 0 6px 22px; padding: 0; }
  li { margin: 3px 0; text-align: justify; }
  table.quadro { width: 100%; border-collapse: collapse; margin: 10px 0 4px; }
  table.quadro th, table.quadro td { border: 1px solid #333; padding: 6px 8px; vertical-align: top; font-size: 10pt; text-align: left; }
  table.quadro th { background: #efefef; font-size: 8.5pt; text-transform: uppercase; letter-spacing: .05em; width: 4.2cm; }
  .nota { font-size: 9pt; color: #444; }
  .assin { margin-top: 40px; }
  .assin-bloco { margin-top: 38px; }
  .assin-linha { border-top: 1px solid #111; width: 11cm; padding-top: 4px; font-size: 9.5pt; }
  .duas-col { width: 100%; border-collapse: collapse; margin-top: 30px; }
  .duas-col td { width: 50%; padding: 26px 12px 0 0; vertical-align: bottom; }
  .duas-col .assin-linha { width: 100%; }
  .local-data { margin-top: 34px; }
`;

const escHtml = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));

// Campos de preenchimento do modelo: a lista `fields` do documento (com rótulo/
// placeholder bons) ou, na falta dela, os tokens {{chave}} achados no corpo —
// assim modelo criado na mão pelo time também ganha formulário.
export function fieldsOf(c) {
  if (Array.isArray(c?.fields) && c.fields.length) return c.fields;
  const seen = new Set();
  const out = [];
  for (const m of String(c?.body || "").matchAll(/\{\{([a-z0-9_]+)\}\}/gi)) {
    if (seen.has(m[1])) continue;
    seen.add(m[1]);
    out.push({ key: m[1], label: m[1].replace(/_/g, " ") });
  }
  return out;
}

// Token preenchido entra escapado (quebra de linha vira <br>); vazio vira a
// linha em branco de sempre, pro contrato continuar imprimível pra preencher à mão.
const BLANK = "______________________";
export function applyFields(body, fields, values) {
  let out = String(body || "");
  for (const f of fields) {
    const v = String(values?.[f.key] ?? "").trim();
    out = out.split(`{{${f.key}}}`).join(v ? escHtml(v).replace(/\n/g, "<br>") : BLANK);
  }
  return out;
}

export function fullHtml(c, values) {
  const title = String(c?.name || "Contrato").replace(/</g, "&lt;");
  const body = applyFields(c?.body, fieldsOf(c), values || {});
  return `<!doctype html>\n<html lang="pt-BR">\n<head>\n<meta charset="utf-8">\n<title>${title}</title>\n<style>${CONTRACT_CSS}</style>\n</head>\n<body>\n${body}\n</body>\n</html>`;
}

// Gerar o contrato: janela nova com o HTML completo JÁ PREENCHIDO + diálogo de
// impressão (salvar como PDF). Campo vazio sai em branco. Devolve false quando o
// navegador barrou o popup — quem chama avisa na tela em vez de falhar calado.
export function printContract(c, values) {
  const w = window.open("", "_blank");
  if (!w) return false;
  w.document.write(fullHtml(c, values));
  w.document.close();
  w.focus();
  setTimeout(() => { try { w.print(); } catch { /* usuário imprime manualmente */ } }, 350);
  return true;
}

export function downloadContract(c, values) {
  const blob = new Blob([fullHtml(c, values)], { type: "text/html;charset=utf-8" });
  const a = document.createElement("a");
  const cliente = String(values?.razao_social || "").trim();
  a.href = URL.createObjectURL(blob);
  a.download = `${(c?.name || "contrato")}${cliente ? " - " + cliente : ""}`.toLowerCase().replace(/[^a-z0-9]+/gi, "-") + ".html";
  a.click();
  URL.revokeObjectURL(a.href);
  return true;
}

// Cliente do contrato: o vínculo escolhido no preenchimento manda; sem vínculo,
// o que foi digitado na razão social. Vazio = não dá pra registrar no histórico
// (registro sem dono não serve de controle).
export function contractClientName(customer, values) {
  return String(customer?.name || values?.razao_social || "").trim();
}

// Data do registro em UM formato só ("16 ago 26"), pra tela Contratos e ficha do
// cliente mostrarem o mesmo carimbo.
export function issueDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "2-digit" }).replace(".", "");
}

// Ordem do histórico: mais recente primeiro.
export const byIssuedDesc = (a, b) => String(b?.createdAt || "").localeCompare(String(a?.createdAt || ""));
