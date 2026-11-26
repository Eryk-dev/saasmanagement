// Apresentação nova para os leads antigos (Leo, 26/11/2026).
//
// Em 18/09 a apresentação em slides virou a oficial e a migração
// regenerateOpenLeadsToSlides trocou só os leads ABERTOS. Ficou de fora quem
// estava fechado, perdido ou no pós-venda: 437 leads da LeverAds seguiam
// apontando pro deck arquivado (pt_leverads). Quando um deles volta pra fila
// (reativação, negócio novo), "Apresentar" abria o deck antigo e a
// configuração da apresentação não aparecia (nem aqui, nem no CRM Lever).
//
// Este script troca TODOS pelo mesmo caminho do botão "re-gerar" do card
// (runNativeProposal com force), com três cuidados que o botão não tem, porque
// aqui não há ninguém renegociando nada:
//   1. Valor do card: lead fechado (planClosed, wonAt, cliente criado, etapa de
//      pós-venda) ou perdido NÃO muda de valor. É valor de venda ou histórico
//      de perda, e o re-gerar gravaria por cima o preço sugerido de hoje. Lead
//      aberto acompanha a apresentação, como no botão.
//   2. Validade: a apresentação nova herda a validade (já vencida) da antiga.
//      Com +7 dias, o alerta "a proposta vence amanhã" (crm-alerts.js) avisaria
//      o closer de centenas de leads fechados ou perdidos daqui a 6 dias.
//   3. O lead é gravado num UPDATE só, condicionado à apresentação que ele
//      tinha na leitura: se alguém re-gerou no meio, o script não passa por cima.
//
// O link antigo continua de pé (as propostas antigas e as cópias mandadas ao
// cliente não são tocadas). A proposta nova leva `regeneratedFrom` com o id da
// antiga, e os leads ficam copiados em cockpit._bak_apresentacao_20261126_leads
// antes da primeira gravação: desfazer é devolver os três campos da cópia e
// apagar as propostas que têm `regeneratedFrom`.
//
// Fica como está: deck fixado à mão (proposalPinned), proposta aceita (preço na
// mão do cliente) e quem já está na apresentação em slides, na de criação de
// anúncios ou na Mentoria. Idempotente: depois da troca o lead deixa de apontar
// pro deck arquivado.
//
// Rodado em produção em 26/11/2026: 437 leads trocados, todos pra
// pt_leverads_slides, nenhuma falha. 436 ficaram com o valor que tinham; o
// único aberto (le_mtj5zvzf0n, reenviou o form em 25/11 e tinha call no dia)
// acompanhou a apresentação, de 5.964 pra 9.564.
//
// Roda de DENTRO do container da API (precisa do COCKPIT_DB_URL e do código):
//   node packages/api/scripts/2026-11-26-apresentacao-nova-leads-antigos.mjs           # ensaio, não grava
//   node packages/api/scripts/2026-11-26-apresentacao-nova-leads-antigos.mjs --apply   # grava
import path from "node:path";
import { pathToFileURL } from "node:url";

const APPLY = process.argv.includes("--apply") || process.env.APPLY === "1";
// Import pela pasta de trabalho (raiz do repo): o script também roda por stdin
// (`node --input-type=module -`), onde não existe caminho do próprio arquivo.
const SRC = pathToFileURL(path.resolve(process.cwd(), "packages/api/src") + path.sep).href;
const { repo, rawQuery } = await import(SRC + "platform/db.js");
const { runNativeProposal } = await import(SRC + "proposals/proposal.js");
const { kindOf, isWonLead, TERMINAL_KINDS } = await import(SRC + "crm/stages.js");

const ARCHIVED_DECKS = new Set(["pt_leverads", "pt_leverads_starter"]);
const BACKUP = "cockpit._bak_apresentacao_20261126_leads";
const BASE = String(process.env.COCKPIT_PUBLIC_URL || "").replace(/\/+$/, "");
if (!BASE) throw new Error("COCKPIT_PUBLIC_URL é obrigatório: é o endereço que entra no link da apresentação.");

// "dd/mm/aaaa" → fim do dia em Brasília (a mesma leitura do crm-alerts.js).
function validUntilMs(raw) {
  const m = String(raw || "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? Date.parse(`${m[3]}-${m[2]}-${m[1]}T23:59:59-03:00`) : NaN;
}
const DAY = 86_400_000;
// Validade da apresentação nova: a da antiga quando já venceu; sem validade
// legível (ou ainda de pé), ontem. Nunca uma data futura.
function carriedValidUntil(old) {
  const until = validUntilMs(old?.state?.validUntil);
  if (Number.isFinite(until) && until < Date.now()) return old.state.validUntil;
  return new Date(Date.now() - DAY).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

const deck = await repo.get("proposal_templates", "pt_leverads_slides");
if (!deck || deck.status !== "published") throw new Error("A apresentação em slides (pt_leverads_slides) não está publicada: nada a fazer.");

const products = new Map((await repo.list("products")).map((p) => [p.id, p]));
// Só o cabeçalho de cada proposta: a coleção inteira é dezenas de MB.
const proposals = new Map((await repo.listWhere("proposals", { saas: "leverads" }, { fields: ["template", "accepted", "state"] })).map((p) => [p.id, p]));
const leads = (await repo.list("leads")).filter((l) => l.saas === "leverads" && l.proposta_id && ARCHIVED_DECKS.has(proposals.get(l.proposta_id)?.template));

const out = { alvo: leads.length, trocados: 0, fixados: 0, aceitas: 0, falhas: 0, valorMantido: 0, valorAcompanha: 0, porModelo: {}, porEtapa: {} };
const valores = []; // leads abertos, que acompanham o valor da apresentação
const falhas = [];

const todo = [];
for (const lead of leads) {
  const old = proposals.get(lead.proposta_id);
  if (lead.proposalPinned) { out.fixados++; continue; }
  if (old.accepted) { out.aceitas++; continue; }
  todo.push(lead);
}

if (APPLY && todo.length) {
  // Cópia dos leads como estão, uma vez só (rodar de novo não troca a cópia boa pela já migrada).
  await rawQuery(`CREATE TABLE IF NOT EXISTS ${BACKUP} (id text PRIMARY KEY, json jsonb NOT NULL, updated_at timestamptz)`);
  await rawQuery(`INSERT INTO ${BACKUP} (id, json, updated_at) SELECT id, json, updated_at FROM cockpit."leads" WHERE id = ANY($1::text[]) ON CONFLICT (id) DO NOTHING`, [todo.map((l) => l.id)]);
  const [{ n }] = await rawQuery(`SELECT count(*)::int AS n FROM ${BACKUP}`);
  console.log(`cópia dos leads em ${BACKUP}: ${n} linhas`);
}

for (const lead of todo) {
  const old = proposals.get(lead.proposta_id);
  const product = products.get(lead.saas);
  const keepAmount = !!(lead.planClosed || lead.wonAt || isWonLead(product, lead) || TERMINAL_KINDS.has(kindOf(product, lead.stage)));
  const made = { proposal: null, patch: null };
  // O repo que o runNativeProposal enxerga: lê do banco, e as DUAS escritas
  // dele (a proposta nova e os campos do lead) passam pelos cuidados daqui.
  const shim = {
    list: (name) => repo.list(name),
    listWhere: (...args) => repo.listWhere(...args),
    get: (name, id) => repo.get(name, id),
    async create(name, doc) {
      if (name !== "proposals") throw new Error(`escrita inesperada: create ${name}`);
      const next = { ...doc, state: { ...(doc.state || {}), validUntil: carriedValidUntil(old) }, regeneratedFrom: old.id };
      made.proposal = APPLY ? await repo.create("proposals", next) : { ...next, id: "ensaio" };
      return made.proposal;
    },
    async update(name, id, patch) {
      if (name !== "leads" || id !== lead.id) throw new Error(`escrita inesperada: update ${name} ${id}`);
      const { amount, ...ponteiros } = patch;
      made.amount = amount;
      made.patch = keepAmount || !(amount > 0) ? ponteiros : patch;
      if (!APPLY) return { ...lead, ...made.patch };
      const rows = await rawQuery(
        `UPDATE cockpit."leads" SET json = json || $1::jsonb, updated_at = now() WHERE id = $2 AND json->>'proposta_id' = $3 RETURNING json`,
        [JSON.stringify(made.patch), lead.id, old.id],
      );
      if (!rows.length) throw new Error("o lead trocou de apresentação durante a migração");
      return rows[0].json;
    },
  };
  try {
    const r = await runNativeProposal(shim, lead, { force: true, baseUrl: BASE });
    if (!r.ok) throw new Error(r.skipped || r.error || "não gerou");
    out.trocados++;
    out.porModelo[made.proposal.template] = (out.porModelo[made.proposal.template] || 0) + 1;
    out.porEtapa[lead.stage || "(sem etapa)"] = (out.porEtapa[lead.stage || "(sem etapa)"] || 0) + 1;
    if ("amount" in made.patch) {
      out.valorAcompanha++;
      valores.push({ lead: lead.id, etapa: lead.stage, de: lead.amount ?? null, para: made.patch.amount });
    } else out.valorMantido++;
  } catch (err) {
    out.falhas++;
    falhas.push({ lead: lead.id, erro: String(err?.message || err) });
    // Proposta criada e lead não gravado: a proposta nova não pertence a ninguém, sai.
    if (APPLY && made.proposal?.id) { try { await repo.remove("proposals", made.proposal.id); } catch { /* fica com regeneratedFrom, achável */ } }
  }
}

console.log(APPLY ? "GRAVADO" : "ENSAIO (nada foi gravado; rode com --apply)");
console.log(JSON.stringify(out, null, 2));
if (valores.length) console.log("valor do card acompanha a apresentação (lead aberto):\n" + valores.map((v) => `  ${v.lead} · ${v.etapa} · ${v.de} → ${v.para}`).join("\n"));
if (falhas.length) console.log("falhas:\n" + falhas.map((f) => `  ${f.lead}: ${f.erro}`).join("\n"));
process.exit(out.falhas ? 1 : 0);
