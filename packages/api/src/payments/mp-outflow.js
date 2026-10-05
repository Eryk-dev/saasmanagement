// SAÍDAS da conta Mercado Pago (settlement report): saques e transferências
// viram movimentos do financeiro. A rota (botão) e o poller usam syncMpOutflows.

export const round2 = (n) => Math.round(n * 100) / 100;

// ── Settlement report CSV → movimentos de saída ──────────────────────────────
// Header em qualquer ordem, delimitador ; ou , — só WITHDRAWAL/PAYOUT viram
// movimento (o dinheiro que SAIU: saque pra conta bancária ou pix enviado).
export function parseSettlementCsv(text) {
  const lines = String(text || "").split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const delim = (lines[0].match(/;/g) || []).length >= (lines[0].match(/,/g) || []).length ? ";" : ",";
  const split = (line) => line.split(delim).map((c) => c.replace(/^"|"$/g, "").trim());
  const header = split(lines[0]).map((h) => h.toUpperCase());
  const col = (...names) => { for (const n of names) { const i = header.indexOf(n); if (i >= 0) return i; } return -1; };
  const iType = col("TRANSACTION_TYPE", "RECORD_TYPE", "DESCRIPTION");
  const iDate = col("TRANSACTION_DATE", "SETTLEMENT_DATE", "MONEY_RELEASE_DATE", "DATE");
  const iId = col("SOURCE_ID", "EXTERNAL_ID", "REFERENCE_ID", "TRANSACTION_ID");
  const iNet = col("SETTLEMENT_NET_AMOUNT", "NET_DEBIT_AMOUNT", "TRANSACTION_AMOUNT", "GROSS_AMOUNT", "REAL_AMOUNT");
  const iFee = col("FEE_AMOUNT");
  if (iType < 0 || iNet < 0) return [];
  // "1.234,56" (pt-BR) e "1234.56" viram número; sinal não importa (saída).
  const num = (v) => {
    const s = String(v || "").trim();
    const br = s.includes(",");
    return Math.abs(Number(br ? s.replace(/\./g, "").replace(",", ".") : s)) || 0;
  };
  const out = [];
  for (const line of lines.slice(1)) {
    const cells = split(line);
    const type = String(cells[iType] || "").toUpperCase();
    if (type !== "WITHDRAWAL" && type !== "PAYOUT") continue;
    const amount = num(cells[iNet]);
    if (!(amount > 0)) continue;
    const date = String(iDate >= 0 ? cells[iDate] : "").slice(0, 10);
    const sourceId = String(iId >= 0 ? cells[iId] : "").trim() || `${type}_${date}_${amount}`;
    out.push({ sourceId, type, date, amount: round2(amount), fee: iFee >= 0 ? round2(num(cells[iFee])) : 0 });
  }
  return out;
}

// Uma passada das SAÍDAS: baixa os relatórios prontos, importa o que é novo e,
// sem relatório fresco (24h), pede um ao MP. Usada pela rota (botão) e pelo
// poller (startMpOutflowSync) — antes só o botão existia e o fluxo assíncrono
// do MP exigia o Leo clicar duas vezes com minutos de espera no meio.
export async function syncMpOutflows(repo, mp, { log } = {}) {
  const listRaw = await mp.settlementReportList();
  const files = (Array.isArray(listRaw) ? listRaw : listRaw?.files || listRaw?.results || [])
    .map((x) => ({ name: x.file_name || x.fileName || x.name || "", createdAt: x.date_created || x.created_at || x.createdAt || "" }))
    .filter((x) => x.name);
  files.sort((a, b) => String(b.createdAt || b.name).localeCompare(String(a.createdAt || a.name)));
  const byId = new Set((await repo.list("mp_movements")).map((m) => m.id));
  let imported = 0, filesRead = 0, downloadErrors = 0, rowsSeen = 0;
  let sample = ""; // cabeçalho + primeiras linhas do 1º arquivo — o diagnóstico do formato real
  for (const f of files.slice(0, 3)) {
    const text = await mp.settlementReportDownload(f.name).catch((err) => {
      downloadErrors++;
      log?.warn?.({ file: f.name, err: String(err?.message || err).slice(0, 200) }, "MP settlement: download falhou");
      return null;
    });
    if (!text) continue;
    filesRead++;
    // Zero linha importada com arquivo baixado = formato diferente do esperado.
    // A amostra vai no carimbo pra ler o CSV real sem acesso ao container.
    if (!sample) sample = `${f.name}\n` + String(text).split(/\r?\n/).slice(0, 4).join("\n").slice(0, 900);
    for (const row of parseSettlementCsv(text)) {
      rowsSeen++;
      const id = `mov_${row.sourceId}`;
      if (byId.has(id)) continue;
      byId.add(id);
      await repo.create("mp_movements", {
        id, saas: "", type: row.type, date: row.date, amount: row.amount, fee: row.fee,
        fileName: f.name, payableId: "", finIgnored: false, createdAt: new Date().toISOString(),
      });
      imported++;
    }
  }
  const DAY = 86_400_000;
  const fresh = files.some((f) => f.createdAt && Date.now() - new Date(f.createdAt).getTime() < DAY);
  let requested = false;
  let requestError = "";
  if (!fresh) {
    const end = new Date();
    const begin = new Date(end.getTime() - 59 * DAY); // teto da API: 60 dias por relatório
    // O pedido do relatório NÃO pode falhar em silêncio: foi assim que a
    // tela ficou meses dizendo "sincronize de novo" com zero relatório
    // gerado do lado do MP. Conta sem a CONFIG do settlement report recusa
    // o create — tenta criar uma config mínima e pedir de novo; persistindo
    // o erro, ele vai na resposta pra aparecer na tela.
    try {
      await mp.settlementReportCreate(begin.toISOString(), end.toISOString());
      requested = true;
    } catch (err1) {
      try {
        // O MP valida `columns` e `frequency` como OBRIGATÓRIOS na config
        // (erro real de 30/08: "Columns: required · Frequency: required").
        // As colunas são as que o parseSettlementCsv lê + contexto útil;
        // frequency é exigida mesmo sem agendamento ligado.
        await mp.settlementReportConfigCreate({
          file_name_prefix: "cockpit-settlement",
          display_timezone: "GMT-03",
          columns: [
            { key: "TRANSACTION_TYPE" }, { key: "TRANSACTION_DATE" }, { key: "SOURCE_ID" },
            { key: "SETTLEMENT_NET_AMOUNT" }, { key: "FEE_AMOUNT" },
            { key: "TRANSACTION_AMOUNT" }, { key: "EXTERNAL_REFERENCE" }, { key: "PAYMENT_METHOD" },
          ],
          frequency: { hour: 3, type: "daily", value: 0 },
        });
        await mp.settlementReportCreate(begin.toISOString(), end.toISOString());
        requested = true;
      } catch (err2) {
        requestError = String(err1?.message || err1).slice(0, 300);
        const second = String(err2?.message || err2).slice(0, 200);
        if (second && second !== requestError) requestError += ` · após criar config: ${second}`;
        log?.warn?.({ err: requestError }, "MP settlement: pedido de relatório falhou");
      }
    }
  }
  const result = {
    ok: true, filesRead, filesTotal: files.length, imported, requested,
    ...(rowsSeen ? { rowsSeen } : {}), ...(downloadErrors ? { downloadErrors } : {}),
    ...(requestError ? { requestError } : {}),
    ...(sample && !imported ? { sample } : {}), // só quando nada entrou: é o caso a diagnosticar
  };
  // Carimbo do diagnóstico (app_config "mp_out_sync"): o poller roda sem
  // ninguém olhando, então o resultado de cada passada — inclusive a recusa
  // do MP — fica legível no banco em vez de sumir no log do container.
  try {
    const stamp = { id: "mp_out_sync", lastAt: new Date().toISOString(), ...result };
    delete stamp.ok;
    const cur = await repo.get("app_config", "mp_out_sync");
    if (cur) await repo.update("app_config", "mp_out_sync", stamp, { silent: true });
    else await repo.create("app_config", stamp);
  } catch { /* diagnóstico nunca derruba o sync */ }
  return result;
}

// Poller das saídas (mesmo modelo do startMpSync): pede o relatório quando não
// há fresco e importa o que estiver pronto — o "aguarde alguns minutos e
// sincronize de novo" acontece sozinho. Cadência folgada: saque/transferência
// é evento de poucos por semana, e o relatório do MP é diário por natureza.
export function startMpOutflowSync(repo, { mp, intervalMs = 30 * 60_000, log = console } = {}) {
  if (!mp?.configured?.()) { log.info?.("mp saídas: sem MERCADOPAGO_ACCESS_TOKEN — desligado"); return () => {}; }
  let running = false;
  async function tick() {
    if (running) return; running = true;
    try {
      const r = await syncMpOutflows(repo, mp, { log });
      if (r.imported) log.info?.(`mp saídas: ${r.imported} movimento(s) importado(s)`);
      if (r.requestError) log.warn?.({ err: r.requestError }, "mp saídas: pedido de relatório recusado");
    } catch (err) { log.warn?.({ err: err.message }, "mp saídas: sync falhou (re-tenta no próximo ciclo)"); }
    finally { running = false; }
  }
  tick();
  const timer = setInterval(tick, intervalMs);
  if (timer.unref) timer.unref();
  return () => clearInterval(timer);
}
