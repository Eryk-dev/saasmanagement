// Vínculo cliente ↔ conta do LeverAds (2026-09-12): preenche o
// `customer.leveradsOrgId` que falta, casando o cadastro do cockpit com as orgs
// do produto.
//
// POR QUE ISSO IMPORTA: a fila de colheita de indicação (aba Indicações da tela
// Clientes) ordena os clientes pelo que os anúncios da Lever venderam na conta
// deles nos últimos 30 dias, e esse número só existe com a org vinculada. Sem
// o vínculo, a prova alcançava 23 dos 90 clientes e o pedido de indicação
// voltava a ser genérico ("como vai a operação?") em vez de ter número.
//
// A RÉGUA DE CONCILIAÇÃO DA CASA: só grava com PROVA CONCRETA. Aqui a prova é
// e-mail idêntico (o do cadastro contra `orgs.email` ou `orgs.mp_payer_email`) e
// UMA única org casada. Nome parecido NUNCA grava: sai no relatório de
// candidatos pro CS confirmar na ficha, porque "Cristiano" bate com meio mundo.
//
// Roda da RAIZ do repo. Dry-run por padrão (não escreve nada):
//   node packages/api/scripts/2026-09-12-vincular-org-leverads.mjs
//   node packages/api/scripts/2026-09-12-vincular-org-leverads.mjs --apply
//
// Idempotente: pula quem já tem org vinculada, então rodar de novo só alcança
// os clientes novos. Reversível: a saída lista cada par gravado.
import fs from "node:fs";
import pg from "pg";

const APPLY = process.argv.includes("--apply");
const SAAS = "leverads";

const env = Object.fromEntries(
  fs.readFileSync(".env", "utf8").split("\n").filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const poolFor = (raw) => {
  const url = new URL(raw);
  url.searchParams.delete("sslmode");
  return new pg.Pool({ connectionString: url.toString(), ssl: { rejectUnauthorized: false } });
};
const cockpit = poolFor(env.COCKPIT_DB_URL);
// Bancos SEPARADOS desde 30/08: sem a credencial do produto não há com o que
// casar. Sem a env, cai no mesmo pool (comportamento de quando dividiam banco).
const produto = env.LEVERCOPY_DB_URL ? poolFor(env.LEVERCOPY_DB_URL) : cockpit;

const norm = (s) => String(s || "").trim().toLowerCase();
// Nome comparável: sem acento, sem pontuação e sem os sufixos de razão social
// (LTDA, ME, EIRELI) que só existem de um lado.
const nomeChave = (s) => String(s || "")
  .normalize("NFD").replace(/[̀-ͯ]/g, "")
  .toLowerCase().replace(/[^a-z0-9 ]/g, " ")
  .replace(/\b(ltda|me|mei|eireli|sa|s a|comercio|com|de|da|do|e)\b/g, " ")
  .replace(/\s+/g, " ").trim();

const { rows: clientes } = await cockpit.query(`
  select id,
         coalesce(json->>'name','')  as name,
         coalesce(json->>'email','') as email,
         coalesce(json->>'leveradsOrgId','') as org
    from cockpit.customers
   where coalesce(json->>'saas','') = $1
     and coalesce(json->>'endedAt','') = ''`, [SAAS]);

const pendentes = clientes.filter((c) => !/^[0-9a-f]{8}-/i.test(c.org));
console.log(`${clientes.length} clientes ativos · ${clientes.length - pendentes.length} já vinculados · ${pendentes.length} sem org\n`);
if (!pendentes.length) { await cockpit.end(); if (produto !== cockpit) await produto.end(); process.exit(0); }

const { rows: orgs } = await produto.query(
  "select id::text as id, name, email, mp_payer_email from public.orgs where active = true");

// Índices: e-mail é prova; nome é pista.
const porEmail = new Map();
const porNome = new Map();
for (const o of orgs) {
  for (const e of [norm(o.email), norm(o.mp_payer_email)].filter(Boolean)) {
    if (!porEmail.has(e)) porEmail.set(e, []);
    porEmail.get(e).push(o);
  }
  const k = nomeChave(o.name);
  if (k) {
    if (!porNome.has(k)) porNome.set(k, []);
    porNome.get(k).push(o);
  }
}

const gravar = [];
const ambiguos = [];
const candidatos = [];
const semNada = [];
for (const c of pendentes) {
  const achadosEmail = porEmail.get(norm(c.email)) || [];
  const unicos = [...new Map(achadosEmail.map((o) => [o.id, o])).values()];
  if (unicos.length === 1) { gravar.push({ cliente: c, org: unicos[0], prova: "e-mail idêntico" }); continue; }
  if (unicos.length > 1) { ambiguos.push({ cliente: c, orgs: unicos, motivo: "o mesmo e-mail em mais de uma org" }); continue; }
  const porNomeAchado = [...new Map((porNome.get(nomeChave(c.name)) || []).map((o) => [o.id, o])).values()];
  if (porNomeAchado.length) { candidatos.push({ cliente: c, orgs: porNomeAchado }); continue; }
  semNada.push(c);
}

console.log(`PROVA (grava): ${gravar.length}`);
for (const g of gravar) console.log(`  ✔ ${g.cliente.name} → ${g.org.name} [${g.org.id}] · ${g.prova}`);
if (ambiguos.length) {
  console.log(`\nAMBÍGUO (não grava, ${ambiguos.length}):`);
  for (const a of ambiguos) console.log(`  ? ${a.cliente.name}: ${a.motivo} → ${a.orgs.map((o) => o.name).join(" | ")}`);
}
if (candidatos.length) {
  console.log(`\nCANDIDATO POR NOME (não grava, ${candidatos.length}) · confirmar na ficha do cliente:`);
  for (const k of candidatos) console.log(`  ~ ${k.cliente.name} → ${k.orgs.map((o) => `${o.name} [${o.id}]`).join(" | ")}`);
}
if (semNada.length) console.log(`\nSEM PISTA (${semNada.length}): ${semNada.map((c) => c.name.trim()).join(", ")}`);

if (!APPLY) {
  console.log(`\nDry-run. Rode com --apply pra gravar os ${gravar.length} vínculos com prova.`);
} else {
  let n = 0;
  for (const g of gravar) {
    // jsonb_set só onde ainda está vazio: escrita idempotente e sem corrida com
    // alguém editando a ficha no mesmo minuto.
    const { rowCount } = await cockpit.query(`
      update cockpit.customers
         set json = jsonb_set(json, '{leveradsOrgId}', to_jsonb($2::text), true),
             updated_at = now()
       where id = $1
         and coalesce(json->>'leveradsOrgId','') !~* '^[0-9a-f]{8}-'`, [g.cliente.id, g.org.id]);
    n += rowCount;
  }
  console.log(`\n${n} vínculo(s) gravado(s). A fila de indicação já enxerga o faturamento deles.`);
}
await cockpit.end();
if (produto !== cockpit) await produto.end();
