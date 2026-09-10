// O CONTRATO DE SAÍDA de toda tool do Cockpit. Uma tool nunca devolve o JSON
// cru da API: devolve um envelope com período, unidades, totais já somados e
// tabelas de linhas com colunas estáveis.
//
// Por quê: quem consome isto escreve relatório. Um dump de JSON obriga a
// recontar (e a errar) totais, a adivinhar se `spend` é R$ ou centavos e a
// deduzir de que dias o número fala. Aqui isso vem escrito.
//
// O texto sai em Markdown porque é o que o cliente MCP realmente lê, e uma
// tabela repete os nomes das colunas UMA vez em vez de uma vez por linha — em
// 300 linhas isso é a diferença entre caber e não caber. O JSON completo vai
// junto em `structuredContent` para quem consome via programa.

const MAX_ROWS_RENDERED = 200;

const isNum = (v) => typeof v === "number" && Number.isFinite(v);

function cell(v) {
  if (v == null || v === "") return "—";
  if (isNum(v)) return Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100);
  if (typeof v === "boolean") return v ? "sim" : "não";
  if (typeof v === "object") {
    const s = JSON.stringify(v);
    return s.length > 160 ? `${s.slice(0, 157)}…` : s;
  }
  const s = String(v).replace(/\|/g, "\\|").replace(/\n+/g, " ");
  return s.length > 300 ? `${s.slice(0, 297)}…` : s;
}

function columnsOf(rows, given) {
  if (Array.isArray(given) && given.length) return given;
  const seen = [];
  for (const r of rows.slice(0, 50)) {
    if (!r || typeof r !== "object") continue;
    for (const k of Object.keys(r)) if (!seen.includes(k)) seen.push(k);
  }
  return seen;
}

function renderTable(rows, columns, units = {}) {
  if (!Array.isArray(rows) || !rows.length) return "_(vazio)_";
  const cols = columnsOf(rows, columns);
  if (!cols.length) return "_(vazio)_";
  const head = cols.map((c) => (units[c] ? `${c} (${units[c]})` : c));
  const shown = rows.slice(0, MAX_ROWS_RENDERED);
  const lines = [
    `| ${head.join(" | ")} |`,
    `| ${cols.map(() => "---").join(" | ")} |`,
    ...shown.map((r) => `| ${cols.map((c) => cell(r?.[c])).join(" | ")} |`),
  ];
  if (rows.length > shown.length) lines.push(`_… ${rows.length - shown.length} linhas não exibidas no texto (estão no structuredContent)._`);
  return lines.join("\n");
}

function renderTotals(totals, units = {}) {
  // Array em `totals` caía fora dos dois filtros e sumia do texto sem avisar —
  // entra junto dos escalares, serializado.
  const entries = Object.entries(totals).filter(([, v]) => v === null || typeof v !== "object" || Array.isArray(v));
  const nested = Object.entries(totals).filter(([, v]) => v && typeof v === "object" && !Array.isArray(v));
  const out = [];
  if (entries.length) {
    out.push(entries.map(([k, v]) => `- **${k}**${units[k] ? ` (${units[k]})` : ""}: ${cell(v)}`).join("\n"));
  }
  for (const [k, v] of nested) {
    // Bloco de variação (delta) tem forma conhecida: renderiza em uma linha.
    if ("current" in v && "previous" in v) {
      const sinal = v.pct == null ? "" : ` (${v.pct > 0 ? "+" : ""}${v.pct}%)`;
      out.push(`- **${k}**${units[k] ? ` (${units[k]})` : ""}: ${cell(v.current)} vs ${cell(v.previous)} anterior${sinal}`);
    } else {
      out.push(`- **${k}**: ${cell(v)}`);
    }
  }
  return out.join("\n");
}

export function render(p) {
  const L = [];
  L.push(`# ${p.title || p.kind}`);
  const meta = [];
  if (p.kind) meta.push(`\`${p.kind}\``);
  if (p.scope && Object.keys(p.scope).length) {
    meta.push(Object.entries(p.scope).map(([k, v]) => `${k}=${cell(v)}`).join(" · "));
  }
  if (p.period) meta.push(`período ${p.period.since} → ${p.period.until} (${p.period.days}d, ${p.period.basis || p.period.tz})`);
  if (meta.length) L.push(meta.join(" · "));

  if (p.totals && Object.keys(p.totals).length) {
    L.push("\n## Totais");
    L.push(renderTotals(p.totals, p.units || {}));
  }
  if (Array.isArray(p.rows)) {
    L.push(`\n## ${p.rowsLabel || "Linhas"} (${p.rows.length})`);
    L.push(renderTable(p.rows, p.columns, p.units || {}));
  }
  for (const [name, t] of Object.entries(p.tables || {})) {
    if (!t) continue;
    const rows = Array.isArray(t) ? t : t.rows;
    if (!Array.isArray(rows)) continue;
    L.push(`\n## ${t.label || name} (${rows.length})`);
    if (t.totals && Object.keys(t.totals).length) L.push(renderTotals(t.totals, t.units || p.units || {}));
    L.push(renderTable(rows, t.columns, t.units || p.units || {}));
    // O recorte da SUB-tabela também precisa aparecer no texto: sem isto uma
    // tabela cortada dentro do relatório se lia como a lista inteira.
    if (t.page?.truncated) L.push(`_Recorte: ${t.page.returned} de ${t.page.total}._`);
  }
  if (p.detail && typeof p.detail === "object" && !Array.isArray(p.detail)) {
    L.push("\n## Detalhe");
    L.push("```json");
    L.push(JSON.stringify(p.detail, null, 1));
    L.push("```");
  }
  if (p.page && p.page.truncated) {
    L.push(`\n> Recorte: ${p.page.returned} de ${p.page.total} (limit=${p.page.limit}, offset=${p.page.offset}). Peça a próxima página com offset=${p.page.offset + p.page.limit}.`);
  }
  if (p.notes?.length) {
    L.push("\n## Notas");
    L.push(p.notes.map((n) => `- ${n}`).join("\n"));
  }
  if (p.source) {
    const s = Object.entries(p.source).filter(([, v]) => v).map(([k, v]) => `${k}: ${cell(v)}`).join(" · ");
    if (s) L.push(`\n_fonte — ${s}_`);
  }
  return L.join("\n");
}

// Resposta de sucesso. `payload` é o envelope; devolve texto (Markdown) para o
// modelo e o objeto inteiro em structuredContent para quem consome por programa.
export function result(payload) {
  const p = { ok: true, ...payload };
  return { content: [{ type: "text", text: render(p) }], structuredContent: p };
}

// Texto puro (tools de manual/documentação).
export function text(s) {
  return { content: [{ type: "text", text: String(s) }] };
}

// Erro: diz o que falhou, onde, e o que fazer. `isError` para o cliente marcar.
export function failure(err, ctx = {}) {
  const e = err || {};
  const linhas = [`**Erro:** ${e.message || String(err)}`];
  const rota = `${e.method || ""} ${e.path || ""}`.trim();
  if (e.status && rota) linhas.push(`HTTP ${e.status} em \`${rota}\``);
  else if (e.status) linhas.push(`HTTP ${e.status}.`);
  if (e.detail) linhas.push(`Detalhe: ${e.detail}`);
  if (ctx.hint) linhas.push(`Como resolver: ${ctx.hint}`);
  return {
    content: [{ type: "text", text: linhas.join("\n") }],
    structuredContent: {
      ok: false,
      error: {
        message: e.message || String(err),
        status: e.status || null,
        endpoint: e.path ? `${e.method} ${e.path}` : null,
        detail: e.detail || null,
        hint: ctx.hint || null,
      },
    },
    isError: true,
  };
}
