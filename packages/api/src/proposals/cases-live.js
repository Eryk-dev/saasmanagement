// Cases com os números de HOJE, na hora de servir a apresentação.
//
// Decisão do Leo (28/09/2026, segunda rodada): o slide 06 mostra os cases que a
// casa usa HOJE, não os que estavam publicados no dia em que a proposta foi
// gerada. Ele trocou Dyno Nutri e 123tudo por USACAR e Vikn, e as ~900
// propostas já geradas continuariam apresentando os dois antigos, porque o
// snapshot congelava a lista inteira. Agora a lista é re-escolhida na abertura
// pela régua de sempre (nicho do lead primeiro, depois a ordem do time), e o
// snapshot vale como reserva pra quando não houver case publicado nenhum.
//
// Os números envelheciam junto com a lista: os quatro cards foram apurados em
// 14/09/2026 e duas semanas depois mostravam MENOS do que os clientes tinham
// feito (Motvia de R$ 287 mil para R$ 442 mil). Aqui os valores são
// refeitos a cada abertura do deck, pelo mesmo caminho do faturado do
// portfólio (leverads-results.js): cache em memória, fail-open e nunca um
// buraco na tela — sem banco do produto, fica exatamente o que foi congelado.
//
// De onde sai a org de cada case: `evidence.orgId` (os cases semeados pela
// migração) ou o `leveradsOrgId` do cliente vinculado (`customerId`), que é o
// caminho do case nascido na ficha. Case sem org (número de print, ou dito
// pelo cliente, como o "+105%" da Unique) passa intacto.

import { canPublish, caseWithLiveNumbers, pickCases, publicCase } from "./cases.js";
import { orgSnapshot } from "../customers/leverads-results.js";

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

let cache = { docs: [], at: 0 };
let inFlight = null;

// Os cases publicáveis de HOJE, com os números refeitos. Só entra quem está
// publicado e autorizado: o gate continua sendo o de sempre (cases.js).
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
  // Sem nenhuma org pra consultar, os cases seguem valendo pela seleção: é o
  // número que fica como está, não a lista.
  const snaps = orgs.length ? await snapshot(orgs) : new Map();
  return porCase.map(({ doc, org }) => caseWithLiveNumbers(doc, (org && snaps.get(org)) || null));
}

// Stale-while-revalidate, com uma diferença do agregado do portfólio: o cache
// FRIO espera (até TIMEOUT_MS), porque a primeira apresentação do dia não pode
// ser justamente a que sai com a lista velha.
export async function liveCases(repo, { now = Date.now, ttlMs = TTL_MS, timeoutMs = TIMEOUT_MS, snapshot = orgSnapshot } = {}) {
  if (cache.docs.length && now() - cache.at <= ttlMs) return cache.docs;
  const run = async () => {
    try {
      const docs = await build(repo, { snapshot });
      // Consulta sem resultado não apaga o que já temos: é falta de base, não
      // notícia de que os cases sumiram.
      if (docs.length) cache = { docs, at: now() };
      return docs;
    } catch (e) {
      console.warn("[cases-live] falhou:", e.message);
      return cache.docs;
    } finally { inFlight = null; }
  };
  inFlight ||= run();
  if (cache.docs.length) return cache.docs;                  // quente mas vencido: devolve e recalcula por fora
  let timer;
  const espera = new Promise((r) => { timer = setTimeout(() => r(cache.docs), timeoutMs); });
  try { return await Promise.race([inFlight, espera]); } finally { clearTimeout(timer); }
}

// Os cards do slide 06 na hora de apresentar: quem está publicado HOJE, pela
// mesma régua de sempre (nicho do lead primeiro, depois a ordem do time), com
// os números refeitos no painel. Sem nenhum case publicado, devolve null e a
// página segue com o que foi congelado no snapshot da proposta.
export async function liveDeckCases(repo, { niche = "", limit = 4, ...opts } = {}) {
  const docs = await liveCases(repo, opts);
  if (!docs.length) return null;
  return pickCases(docs, { niche, limit }).map(publicCase);
}

// Só pros testes: zera o estado de módulo entre casos.
export function _resetLiveCases() { cache = { docs: [], at: 0 }; inFlight = null; }
