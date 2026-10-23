// Régua de nota/ICP configurável (docs/PLANO-ICP-CONFIGURAVEL.md, fase 1).
// O motor genérico, sem régua no produto, tem que dar EXATAMENTE a nota de
// antes — a implementação antiga fica copiada aqui como referência.

import test from "node:test";
import assert from "node:assert/strict";
import {
  leadGradeInfo, gradeRulesOf, defaultRules, icpGradesOf, isIcpGrade,
  MID_ORDERS, MID_TICKET, LEGACY_ACCOUNTS, LEGACY_LISTINGS, LEGACY_VOLUME, LEGACY_GRID,
} from "../src/shared/lead-grade.js";
import { leadGrade, isIcpLead } from "../src/metrics/metrics-core.js";
import { leadTier } from "../../web/src/lib/ui.js";
import { setGradeRules } from "../../web/src/lib/grade-rules.js";

// ── Referência: leadGradeInfo de antes da régua configurável ────────────────
const BANDS = [[1000000, "S"], [500000, "A"], [200000, "B"], [100000, "C"], [50000, "D"], [0, "E"]];
function oldInfo(lead) {
  const o = Object.hasOwn(MID_ORDERS, lead?.orders) ? MID_ORDERS[lead.orders] : null;
  const t = Object.hasOwn(MID_TICKET, lead?.ticket) ? MID_TICKET[lead.ticket] : null;
  const rev = lead?.saas && lead.saas !== "leverads" ? null : (o != null && t != null ? o * t : null);
  if (rev != null) return { grade: BANDS.find(([min]) => rev >= min)[1], legacy: false, revenue: rev };
  const acc = LEGACY_ACCOUNTS[lead?.accounts];
  const ads = lead?.listings != null && lead.listings !== "" ? LEGACY_LISTINGS[lead.listings] : LEGACY_VOLUME[lead?.volume];
  const old = !Number.isInteger(acc) && !Number.isInteger(ads) ? null : LEGACY_GRID[acc ?? 0][ads ?? 0];
  return { grade: old, legacy: !!old && (!lead?.saas || lead.saas === "leverads"), revenue: null };
}

const pick = (map) => [undefined, "", "lixo", ...Object.keys(map)];
test("sem régua no produto, o motor dá a mesma nota de antes em toda combinação", () => {
  let n = 0;
  for (const saas of [undefined, "leverads", "uniquekids", "elo"]) {
    for (const orders of pick(MID_ORDERS)) for (const ticket of pick(MID_TICKET)) {
      for (const accounts of pick(LEGACY_ACCOUNTS)) for (const listings of [undefined, "", "lixo", "0-100", "500-1000", "10000+"]) {
        for (const volume of [undefined, "50-200"]) {
          const lead = { saas, orders, ticket, accounts, listings, volume };
          const before = oldInfo(lead);
          const now = leadGradeInfo(lead);
          assert.deepEqual({ grade: now.grade, legacy: now.legacy, revenue: now.revenue }, before, JSON.stringify(lead));
          assert.equal(leadGrade(lead), before.grade);
          assert.equal(isIcpLead(lead), ["S", "A", "B"].includes(before.grade));
          n++;
        }
      }
    }
  }
  assert.ok(n > 10000);
});

test("rótulo do badge continua o mesmo para cada método", () => {
  setGradeRules([]);
  assert.match(leadTier({ saas: "leverads", orders: "2000+", ticket: "600+" }).label, /pedidos × ticket médio/);
  assert.match(leadTier({ saas: "leverads", accounts: "3-5", listings: "100-500" }).label, /Legado \(contas × anúncios\)/);
  assert.match(leadTier({ saas: "uniquekids", accounts: "3-5" }).label, /· contas × anúncios$/);
  assert.equal(leadTier({}).grade, null);
});

test("filter(isIcpLead) não confunde o índice com a régua", () => {
  const leads = [{ saas: "leverads", orders: "2000+", ticket: "600+" }, { saas: "leverads", orders: "0-200", ticket: "0-70" }];
  assert.deepEqual(leads.filter(isIcpLead), [leads[0]]);
  assert.deepEqual(leads.map(leadGrade), ["S", "E"]);
});

// ── Régua configurada no produto ────────────────────────────────────────────
const custom = {
  version: 2,
  methods: [
    { id: "pedidos", type: "produto", label: "pedidos/mês", axes: [{ key: "pedidos", values: { poucos: 10, muitos: 500 } }],
      bands: [{ grade: "A", min: 400 }, { grade: "C", min: 50 }, { grade: "E", min: 0 }] },
    { id: "pontos", type: "soma", label: "pontos", axes: [{ key: "a", values: { sim: 30 } }, { key: "b", values: { sim: 40 } }],
      bands: [{ grade: "B", min: 60 }, { grade: "D", min: 1 }] },
  ],
  icpGrades: ["A"],
};
const kids = { id: "uniquekids", icp: { rules: custom } };

test("régua do produto: produto de um eixo, soma, ICP próprio e sem nota fora das faixas", () => {
  const r = gradeRulesOf(kids);
  assert.equal(leadGradeInfo({ pedidos: "muitos" }, r).grade, "A");
  assert.equal(leadGradeInfo({ pedidos: "poucos" }, r).grade, "E");
  assert.equal(leadGradeInfo({ pedidos: "poucos" }, r).method, "pedidos");
  assert.deepEqual(leadGradeInfo({ a: "sim", b: "sim" }, r), { grade: "B", legacy: false, revenue: 70, value: 70, method: "pontos", methodLabel: "pontos" });
  assert.equal(leadGradeInfo({ a: "sim" }, r).grade, "D");
  assert.equal(leadGradeInfo({ a: "nao" }, r).grade, null);   // não respondeu nenhum eixo conhecido
  assert.equal(leadGradeInfo({ accounts: "10+" }, r).grade, null); // a matriz padrão sai quando o produto tem régua
  assert.equal(isIcpLead({ pedidos: "muitos" }, r), true);
  assert.equal(isIcpLead({ a: "sim", b: "sim" }, r), false); // B não é ICP nesta régua
  assert.deepEqual([...icpGradesOf(r)], ["A"]);
  assert.equal(isIcpGrade("B", defaultRules("leverads")), true);
});

test("régua inválida ou vazia no produto cai no padrão", () => {
  assert.equal(gradeRulesOf({ id: "leverads", icp: { rules: { methods: [] } } }), defaultRules("leverads"));
  assert.equal(gradeRulesOf({ id: "elo", icp: {} }), defaultRules("elo"));
  assert.equal(leadGradeInfo({ accounts: "1" }, { methods: [{ type: "desconhecido" }] }).grade, null);
});

test("a SPA usa a régua registrada do produto do lead", () => {
  setGradeRules([kids, { id: "leverads" }]);
  assert.equal(leadTier({ saas: "uniquekids", pedidos: "muitos" }).grade, "A");
  assert.match(leadTier({ saas: "uniquekids", pedidos: "muitos" }).label, /pedidos\/mês/);
  assert.equal(leadTier({ saas: "leverads", orders: "2000+", ticket: "600+" }).grade, "S");
  setGradeRules([]);
  assert.equal(leadTier({ saas: "uniquekids", pedidos: "muitos" }).grade, null);
});

test("agenda: o pool do sênior segue as notas de ICP da régua do produto", async () => {
  const { makeMemRepo } = await import("./helpers/mem-repo.js");
  const { slotsForLead, wallFromNaive } = await import("../src/crm/agenda-slots.js");
  const { LEVERADS_RULES } = await import("../src/shared/lead-grade.js");
  const now = wallFromNaive("2026-08-19T08:00"); // quarta, júnior livre hoje
  const users = [{ id: "jr", name: "J", roles: ["closer"], compLevel: 1 }, { id: "pl", name: "P", roles: ["closer"], compLevel: 2 }];
  const lead = { id: "l1", saas: "leverads", accounts: "10+" }; // nota A na matriz
  const run = async (icpGrades) => {
    const repo = makeMemRepo();
    await repo.create("products", { id: "leverads", name: "LeverAds", funnel: [], ...(icpGrades ? { icp: { rules: { ...LEVERADS_RULES, icpGrades } } } : {}) });
    for (const u of users) await repo.create("users", u);
    return slotsForLead(repo, { lead, saas: "leverads", now, limit: 3 });
  };
  assert.equal((await run(null)).pool, "upper");    // padrão S/A/B
  assert.equal((await run(["S"])).pool, "junior");  // régua que só aceita S tira o A do sênior
});
