// Sync dos insights de anúncio da Meta. O auto-sync do servidor (uma execução
// pro time inteiro) e a rota manual da tela Publicidade passam por
// syncProductInsights. Em memória do processo: o horário do último sync por
// produto e os uploads de vídeo em andamento, que seguram o auto-sync.

import { meta as defaultMeta } from "./meta.js";
import { metaAdAccounts } from "./meta-accounts.js";
import { dayKey } from "../metrics/metrics-core.js";

export const DAY_MS = 86400000;

// Dia no FUSO DO NEGÓCIO — régua única do metrics-core (America/Sao_Paulo).
// Sem isso, lead criado às 22h de Brasília caía no dia UTC seguinte e sumia do
// filtro "hoje"; os insights da Meta já vêm datados no fuso da conta (BRT).
export const dayStr = dayKey;

// ── Trabalhos de vídeo (upload → Meta) ──────────────────────────────────────
// Subir criativo é LENTO: um vídeo de 150 MB leva minutos pra chegar, a Meta
// ainda processa (thumbnail só existe depois) e o clone do conjunto vem por
// cima. Segurar a requisição aberta esse tempo todo esbarrava no timeout do
// proxy e devolvia 502 na cara do usuário mesmo quando a Meta tinha aceitado.
// Agora a rota grava o vídeo em DISCO, responde 202 com um jobId e o trabalho
// segue no servidor; o front acompanha por polling em /api/marketing/job/:id.
export const videoJobs = new Map();

// Upsert por id determinístico (1 linha por saas+anúncio+dia; fallback por
// campanha quando a linha não tem ad — compat com dados/mocks antigos).
// Linha idêntica NÃO regrava: cada escrita no repo acorda o SSE de todos os
// clientes, e o auto-sync roda o dia inteiro — só o que mudou vira evento.
// Linha que já teve entrega não volta a zero: gasto de um dia não "desgasta".
// Em 21/10/2026 a Meta devolveu a conta principal com spend e impressões 0
// (leads presentes) e um sync longo zerou o histórico de 15/09 a 19/10.
// Devolve false quando a linha gravada foi mantida.
const delivered = (r) => (Number(r?.spend) || 0) > 0 || (Number(r?.impressions) || 0) > 0;
async function upsertInsight(repo, row) {
  const id = `ai_${row.saas}_${row.adId || row.campaignId}_${row.date}`;
  const existing = await repo.get("ad_insights", id);
  if (existing) {
    if (delivered(existing) && !delivered(row)) return false;
    const changed = Object.keys(row).some((k) => JSON.stringify(existing[k]) !== JSON.stringify(row[k]));
    if (changed) await repo.update("ad_insights", id, row);
    return true;
  }
  await repo.create("ad_insights", { id, ...row });
  return true;
}

// Sync de UM produto (rota manual e auto-sync do servidor passam por aqui):
// puxa insights nível anúncio, limpa legado nível-campanha da janela e faz o
// upsert idempotente. Carimba o horário pro "ao vivo" da tela.
export const lastSyncAt = new Map(); // saas -> ISO do último sync (memória do processo)

export async function syncProductInsights(repo, meta, product, { since, until }) {
  const accounts = metaAdAccounts(product);
  const results = await Promise.allSettled(accounts.map((id) => meta.adInsights(id, { since, until })));
  const complete = results.every((r) => r.status === "fulfilled");
  const replacedCampaigns = new Set(results.filter((r) => r.status === "fulfilled").flatMap((r) => r.value.map((row) => row.campaignId)));
  // Em falha parcial, só substitui agregados das campanhas que responderam;
  // uma conta sem permissão não pode apagar seu histórico disponível.
  const legacy = (await repo.list("ad_insights")).filter(
    (r) => r.saas === product.id && !r.adId && !String(r.campaignId || "").startsWith("manual_") && r.date >= since && r.date <= until
      && (complete || replacedCampaigns.has(r.campaignId)),
  );
  for (const r of legacy) await repo.remove("ad_insights", r.id);
  const report = { ok: complete, rows: 0, kept: 0, accounts: {} };
  for (const [i, result] of results.entries()) {
    const accountId = accounts[i];
    if (result.status === "rejected") {
      report.accounts[accountId] = { ok: false, error: String(result.reason?.message || result.reason).slice(0, 200) };
      continue;
    }
    let kept = 0;
    for (const r of result.value) if (!(await upsertInsight(repo, { ...r, saas: product.id, accountId }))) kept++;
    report.accounts[accountId] = { ok: true, rows: result.value.length, kept };
    report.rows += result.value.length;
    report.kept += kept;
  }
  if (complete) lastSyncAt.set(product.id, new Date().toISOString());
  else report.error = Object.entries(report.accounts).filter(([, r]) => !r.ok).map(([id, r]) => `${id}: ${r.error}`).join("; ");
  return report;
}

// Sync automático NO SERVIDOR — chamado só pelo index.js (testes montam o app
// sem ele). Uma execução por vez pro time inteiro: substitui o polling por aba
// do SPA, que multiplicava chamadas à Meta por usuário logado. Janela curta
// (ontem+hoje); histórico maior continua vindo do botão/rota manual.
export function startMarketingAutoSync(repo, { meta = defaultMeta, intervalMs = 180_000, log = console, immediate = true } = {}) {
  let running = false;
  async function tick() {
    if (running || !meta.configured()) return;
    running = true;
    try {
      const products = (await repo.list("products")).filter((p) => metaAdAccounts(p).length);
      const range = { since: dayStr(Date.now() - DAY_MS), until: dayStr(Date.now()) };
      for (const p of products) {
        // Enquanto uma leva de vídeos sobe, o sync fica fora do caminho: as duas
        // coisas dividem a MESMA cota da conta na Meta, e o sync pode esperar.
        if ([...videoJobs.values()].some((j) => j.saas === p.id && j.status === "running")) continue;
        try {
          const result = await syncProductInsights(repo, meta, p, range);
          if (!result.ok) log.warn?.(`Meta auto-sync parcial (${p.id}): ${result.error}`);
          if (result.kept) log.warn?.(`Meta auto-sync (${p.id}): ${result.kept} linha(s) vieram zeradas e o gasto gravado foi mantido`);
        } catch (err) {
          log.warn?.(`Meta auto-sync falhou (${p.id}): ${String(err.message || err).slice(0, 200)}`);
        }
      }
    } finally {
      running = false;
    }
  }
  const id = setInterval(tick, intervalMs);
  id.unref?.(); // não segura o processo vivo no shutdown
  if (immediate) tick(); // primeira leva já na subida (testes desligam pra controlar o tick)
  return { tick, stop: () => clearInterval(id) };
}
