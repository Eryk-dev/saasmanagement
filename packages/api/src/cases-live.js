// Cases com os números de HOJE, na hora de servir a apresentação.
//
// O snapshot da proposta congela QUEM aparece no slide 06 (o link já enviado
// não pode trocar de personagem no meio do caminho), mas os números dos cases
// do painel envelhecem junto com ele: os quatro cards foram apurados em
// 14/09/2026 e duas semanas depois já mostravam MENOS do que os clientes
// tinham feito (Motvia de R$ 287 mil para R$ 442 mil). Aqui os valores são
// refeitos a cada abertura do deck, pelo mesmo caminho do faturado do
// portfólio (leverads-results.js): cache em memória, fail-open e nunca um
// buraco na tela — sem banco do produto, fica exatamente o que foi congelado.
//
// De onde sai a org de cada case: `evidence.orgId` (os cases semeados pela
// migração) ou o `leveradsOrgId` do cliente vinculado (`customerId`), que é o
// caminho do case nascido na ficha. Case sem org (número de print, ou dito
// pelo cliente, como o "+105%" da Unique) passa intacto.

import { canPublish, caseKey, caseWithLiveNumbers, publicCase } from "./cases.js";
import { orgSnapshot } from "./leverads-results.js";

const TTL_MS = 30 * 60_000;   // meia hora: a apuração do produto não muda mais rápido que isso
const TIMEOUT_MS = 2_500;     // o deck abre na call: número velho é melhor que tela pendurada

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const orgOf = (doc, customers) => {
  const direto = String(doc?.evidence?.orgId || "").trim();
  if (UUID_RE.test(direto)) return direto;
  const cli = doc?.customerId ? customers.get(String(doc.customerId)) : null;
  const daFicha = String(cli?.leveradsOrgId || "").trim();
  return UUID_RE.test(daFicha) ? daFicha : "";
};

let cache = { map: new Map(), at: 0 };
let inFlight = null;

// Map(nome normalizado do case → card público com os números refeitos).
// Só cases publicáveis entram: recalcular um rascunho não serviria a ninguém e
// o gate de publicação continua sendo o de sempre (cases.js).
async function build(repo, { snapshot }) {
  const todos = await repo.list("cases");
  const publicados = (todos || []).filter((c) => c?.public === true && c?.authorizedAt && canPublish(c));
  if (!publicados.length) return new Map();
  const customers = new Map();
  for (const doc of publicados) {
    if (!doc.customerId || customers.has(String(doc.customerId))) continue;
    const cli = await repo.get("customers", String(doc.customerId)).catch(() => null);
    customers.set(String(doc.customerId), cli);
  }
  const porCase = publicados.map((doc) => ({ doc, org: orgOf(doc, customers) }));
  const orgs = [...new Set(porCase.map((x) => x.org).filter(Boolean))];
  if (!orgs.length) return new Map();
  const snaps = await snapshot(orgs);
  const map = new Map();
  for (const { doc, org } of porCase) {
    const snap = org ? snaps.get(org) : null;
    if (!snap) continue;
    map.set(caseKey(doc.name), publicCase(caseWithLiveNumbers(doc, snap)));
  }
  return map;
}

// Stale-while-revalidate, com uma diferença do agregado do portfólio: o cache
// FRIO espera (até TIMEOUT_MS), porque a primeira apresentação do dia não pode
// ser justamente a que sai com o número velho.
export async function liveCases(repo, { now = Date.now, ttlMs = TTL_MS, timeoutMs = TIMEOUT_MS, snapshot = orgSnapshot } = {}) {
  if (cache.map.size && now() - cache.at <= ttlMs) return cache.map;
  const run = async () => {
    try {
      const map = await build(repo, { snapshot });
      // Consulta sem resultado não apaga o que já temos: é falta de base, não
      // notícia de que os cases sumiram.
      if (map.size) cache = { map, at: now() };
      return map;
    } catch (e) {
      console.warn("[cases-live] falhou:", e.message);
      return cache.map;
    } finally { inFlight = null; }
  };
  inFlight ||= run();
  if (cache.map.size) return cache.map;                      // quente mas vencido: devolve e recalcula por fora
  let timer;
  const espera = new Promise((r) => { timer = setTimeout(() => r(cache.map), timeoutMs); });
  try { return await Promise.race([inFlight, espera]); } finally { clearTimeout(timer); }
}

// Só pros testes: zera o estado de módulo entre casos.
export function _resetLiveCases() { cache = { map: new Map(), at: 0 }; inFlight = null; }
