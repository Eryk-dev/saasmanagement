// Migração única (2026-06-22). Conserta a chave de contas que driftou no form
// builder (slug do rótulo -> accounts), reconfigura o template pt_leverads pro
// modelo de FAIXA + preço por topo, e faz backfill dos leads/propostas já
// capturados. Idempotente. Roda da RAIZ do repo: lê .env e escreve no DB
// compartilhado (= prod). Uso: node packages/api/scripts/2026-06-22-fix-accounts-key.mjs
import fs from "node:fs";
import pg from "pg";

const OLD = "quantas_contas_de_marketplace_voce_opera";
const NEW = "accounts";
const FORM = "fo_diagnostico_leverads";
const TPL = "pt_leverads";
const TOPS = { "1": 1, "2": 2, "3-5": 5, "6-10": 10, "10+": 10 };

const env = Object.fromEntries(
  fs.readFileSync(".env", "utf8").split("\n").filter((l) => l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const url = new URL(env.COCKPIT_DB_URL);
url.searchParams.delete("sslmode");
url.searchParams.delete("ssl");
const client = new pg.Client({ connectionString: url.toString(), ssl: { rejectUnauthorized: false } });

const get = async (t, id) => (await client.query('select json from cockpit."' + t + '" where id=$1', [id])).rows[0]?.json || null;
const put = async (t, id, json) => client.query('update cockpit."' + t + '" set json=$1::jsonb, updated_at=now() where id=$2', [JSON.stringify(json), id]);

async function main() {
  await client.connect();
  const log = [];

  // 1) form: renomeia a chave da pergunta de contas
  const form = await get("forms", FORM);
  if (form) {
    let changed = false;
    for (const q of (form.questions || [])) { if (q.key === OLD) { q.key = NEW; changed = true; } }
    if (changed) { await put("forms", FORM, form); }
    log.push("form: " + (changed ? OLD + " -> " + NEW : "já ok"));
  } else { log.push("form: não encontrado"); }

  // 2) template: seatsMap = topos + slide de preço usa {{state.accounts}}
  const tpl = await get("proposal_templates", TPL);
  if (tpl) {
    tpl.calc = tpl.calc || {};
    tpl.calc.seatsMap = { ...TOPS };
    for (const s of (tpl.slides || [])) {
      if (typeof s.sub === "string") s.sub = s.sub.replace(/\{\{\s*state\.seats\s*\}\}/g, "{{state.accounts}}");
    }
    await put("proposal_templates", TPL, tpl);
    log.push("template: seatsMap=topos + sub usa state.accounts");
  } else { log.push("template: não encontrado"); }

  // 3) leads: accounts <- valor antigo; remove a chave antiga
  const leads = (await client.query("select json from cockpit.leads where json->>'form'=$1", [FORM])).rows.map((r) => r.json);
  let nLead = 0;
  for (const lead of leads) {
    if (lead[OLD] == null) continue;
    if (lead[NEW] == null) lead[NEW] = lead[OLD];
    delete lead[OLD];
    await put("leads", lead.id, lead);
    nLead++;
  }
  log.push("leads backfill: " + nLead);

  // 4) propostas do template: conserta answers e (se não-frozen) recalcula state
  const props = (await client.query("select json from cockpit.proposals where json->>'template'=$1", [TPL])).rows.map((r) => r.json);
  let nProp = 0;
  for (const p of props) {
    const ans = (p.data && p.data.answers) || {};
    const val = ans[NEW] != null ? ans[NEW] : ans[OLD];
    let changed = false;
    if (ans[OLD] != null) { if (ans[NEW] == null) ans[NEW] = ans[OLD]; delete ans[OLD]; changed = true; }
    if (!(p.state && p.state.frozen) && val != null) {
      p.state = p.state || {};
      p.state.accounts = String(val);
      if (TOPS[String(val)] != null) p.state.seats = TOPS[String(val)];
      changed = true;
    }
    if (changed) { await put("proposals", p.id, p); nProp++; }
  }
  log.push("propostas backfill: " + nProp);

  console.log(log.join("\n"));
  await client.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
