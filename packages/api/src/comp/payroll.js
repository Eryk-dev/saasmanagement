// FOLHA automática (Leo, 12/10/2026): o salário de cada pessoa sai da
// Remuneração, não de um lançamento à mão. Pra cada colaborador na folha:
//   fixo      pelo nível e regime do plano (ou o fixo por pessoa, pra quem está
//             fora dos níveis: mídia social, casos especiais)
// + variável  as duas pernas (contratos e receita) pelo atingimento CARIMBADO
//             no fechamento do mês (comp_months) — degrau, não rampa
// + time      o bônus de time do carimbo (pago só se a casa bateu meta e churn)
// = a conta a pagar da pessoa (A pagar → Folha), competência do mês e
//   vencimento no dia 1 do mês seguinte, com o detalhamento nas notas.
//
// É GERADO POR BOTÃO e revisado antes de pagar (Leo): gerar de novo atualiza a
// conta em aberto, nunca a paga, e respeita valor editado à mão (amountManual).
//
// Cadastro no usuário (users): payrollRole sdr|closer|cs|social|manual|none,
// compLevel 1..3, payrollRegime clt|pj, payrollFixed (R$, sobrepõe o plano),
// payrollSaas (produto da folha; vazio = user.saas ou o primeiro produto).
// `manual` = sócio/retirada não definida: entra na Folha só quando alguém lança.

import { DEFAULT_PLAN, planFor, levelOf, legBonus, teamBonusFor } from "../shared/comp-plan-defaults.js";
import { compLevelOf } from "./comp-plan.js";
import { stampCompMonth, monthPersonId } from "./comp-months.js";

export const PAYROLL_ROLES = new Set(["sdr", "closer", "cs", "social"]);
export const PAYROLL_CATEGORY = { sdr: "pessoal_com", closer: "pessoal_com", cs: "suporte", social: "pessoal_com", manual: "pessoal_adm" };
export const payrollPayableId = (saas, month, uid) => `pay_folha_${saas}_${month}_${uid}`;
const r2 = (n) => Math.round(n * 100) / 100;
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const nextMonthFirstDay = (month) => {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m, 1));
  return d.toISOString().slice(0, 10);
};

// Ficha de folha (payroll_profiles, id = uid) sobrepõe o usuário: regime, fixo
// da pessoa, VR, VT e os acordos recorrentes que fogem do plano. Papel e nível
// continuam no usuário (Equipe e Metas → Meta por pessoa).
const cleanExtras = (list) => (Array.isArray(list) ? list : []).filter((e) => e && String(e.label || "").trim() && Number.isFinite(Number(e.amount)))
  .map((e) => ({ label: String(e.label).trim(), amount: r2(Number(e.amount)), kind: e.kind === "desconto" ? "desconto" : e.kind === "beneficio" ? "beneficio" : "acordo" }));
export const payrollSetupOf = (u, profile = null) => ({
  role: PAYROLL_ROLES.has(u?.payrollRole) ? u.payrollRole : (u?.payrollRole === "manual" ? "manual" : "none"),
  level: compLevelOf(u),
  regime: (profile?.regime || u?.payrollRegime) === "pj" ? "pj" : "clt",
  fixed: profile?.fixed != null && profile.fixed !== "" ? num(profile.fixed) : (u?.payrollFixed != null && u.payrollFixed !== "" ? num(u.payrollFixed) : null),
  vr: r2(num(profile?.vr)), vt: r2(num(profile?.vt)),
  extras: cleanExtras(profile?.extras),
  saas: profile?.saas || u?.payrollSaas || u?.saas || "",
});

// Quem entra na folha deste produto.
export function payrollUsers(users, saas, { defaultSaas } = {}) {
  return (users || []).filter((u) => {
    const s = payrollSetupOf(u);
    if (s.role === "none" || s.role === "manual") return false;
    const home = s.saas || defaultSaas || saas;
    return home === saas;
  });
}

// Uma linha da folha: fixo + pernas + time, com o detalhamento.
export function payrollRowOf(user, { compDocs, stamp, month, profile = null, adjustments = [] }) {
  const s = payrollSetupOf(user, profile);
  const plan = planFor(compDocs, s.role) || {};
  const lv = levelOf(plan, s.level);
  const fixedPlan = s.role === "closer" && s.regime === "pj" ? num(lv.fixedPj) : num(lv.fixed);
  const fixed = s.fixed != null ? s.fixed : fixedPlan;
  const legs = { contracts: 0, revenue: 0 };
  const notes = [];
  if (s.role === "sdr" || s.role === "closer") {
    if (stamp) {
      legs.contracts = legBonus(stamp.contractsAtt, num(lv.b80), num(lv.b100), num(lv.b120), lv.b140 == null ? undefined : num(lv.b140));
      legs.revenue = legBonus(stamp.revenueAtt, num(lv.b80), num(lv.b100), num(lv.b120), lv.b140 == null ? undefined : num(lv.b140));
      notes.push(`contratos ${stamp.won ?? 0}/${stamp.wonTarget ?? "—"} (${pct(stamp.contractsAtt)}) → R$ ${legs.contracts}`);
      notes.push(`receita ${brl(stamp.revenue)}/${stamp.revenueTarget != null ? brl(stamp.revenueTarget) : "—"} (${pct(stamp.revenueAtt)}) → R$ ${legs.revenue}`);
    } else {
      notes.push("variável: mês ainda não fechado na Remuneração (entra no fechamento)");
    }
  } else if (s.role === "cs") {
    notes.push("CS: indicação, NPS e churn ainda são lançados à mão (próximo passo)");
  }
  const teamBonus = stamp ? num(stamp.teamBonusValue) : 0;
  if (stamp) notes.push(stamp.teamBonusPaid ? `bônus de time R$ ${teamBonus}` : "bônus de time: a casa não bateu as duas condições");
  const variable = r2(legs.contracts + legs.revenue);
  // Benefícios e acordos: VR/VT da ficha, acordos recorrentes (benefício soma,
  // desconto subtrai) e os ajustes pontuais do mês.
  const benefits = r2(s.vr + s.vt);
  if (s.vr) notes.push(`VR R$ ${s.vr}`);
  if (s.vt) notes.push(`VT R$ ${s.vt}`);
  const signed = (e) => (e.kind === "desconto" ? -Math.abs(e.amount) : e.amount);
  const extras = s.extras.map((e) => ({ ...e, signed: signed(e) }));
  const monthAdj = (adjustments || []).filter((a) => a && a.uid === user.id && a.month === month && Number.isFinite(Number(a.amount)))
    .map((a) => ({ id: a.id, label: String(a.label || "ajuste").trim(), amount: r2(Number(a.amount)), kind: a.kind || "acordo" }));
  for (const e of extras) notes.push(`${e.label} ${e.signed < 0 ? "−" : "+"}R$ ${Math.abs(e.signed)}`);
  for (const a of monthAdj) notes.push(`${a.label} (mês) ${a.amount < 0 ? "−" : "+"}R$ ${Math.abs(a.amount)}`);
  const extrasTotal = r2(extras.reduce((a, e) => a + e.signed, 0));
  const adjustmentsTotal = r2(monthAdj.reduce((a, e) => a + e.amount, 0));
  const total = r2(fixed + variable + teamBonus + benefits + extrasTotal + adjustmentsTotal);
  const regimeLabel = s.role === "closer" ? (s.regime === "pj" ? " PJ" : " CLT") : "";
  return {
    uid: user.id, name: user.name || user.id, role: s.role, level: s.level, regime: s.regime,
    fixed: r2(fixed), fixedFrom: s.fixed != null ? "pessoa" : `plano nível ${s.level}${regimeLabel}`,
    variable, legs, teamBonus, vr: s.vr, vt: s.vt, benefits, extras, extrasTotal, adjustments: monthAdj, adjustmentsTotal,
    total, stamped: !!stamp, month,
    notes: [`fixo R$ ${r2(fixed)} (${s.fixed != null ? "fixo da pessoa" : `plano nível ${s.level}${regimeLabel}`})`, ...notes].join(" · "),
  };
}
const pct = (att) => (att == null || !Number.isFinite(Number(att)) ? "—" : `${Math.round(Number(att) * 100)}%`);
const brl = (v) => `R$ ${Math.round(num(v))}`;

// Carimbo do mês da pessoa (comp_months kind person). Mês passado sem carimbo
// é fechado aqui (é o mesmo fechamento da Remuneração); mês corrente não.
async function stampsFor(repo, product, month, { now = new Date(), users } = {}) {
  const cur = now.toISOString().slice(0, 7);
  let all = (await repo.listWhere("comp_months", { saas: product.id, month }).catch(() => [])).filter((d) => d.kind === "person");
  if (!all.length && month < cur) {
    await stampCompMonth(repo, product, month, { now, by: "payroll", users }).catch(() => null);
    all = (await repo.listWhere("comp_months", { saas: product.id, month }).catch(() => [])).filter((d) => d.kind === "person");
  }
  return all;
}

export async function computePayroll(repo, product, month, { now = new Date() } = {}) {
  const [users, compDocs, products, profiles, adjustments] = await Promise.all([
    repo.list("users"), repo.list("comp_plans").catch(() => []), repo.list("products"),
    repo.list("payroll_profiles").catch(() => []), repo.list("payroll_adjustments").catch(() => []),
  ]);
  const defaultSaas = products[0]?.id || product.id;
  const profileOf = (u) => profiles.find((p) => p.id === u.id || p.uid === u.id) || null;
  const people = (users || []).filter((u) => {
    const s = payrollSetupOf(u, profileOf(u));
    if (s.role === "none" || s.role === "manual") return false;
    return (s.saas || defaultSaas) === product.id;
  });
  const stamps = people.length ? await stampsFor(repo, product, month, { now, users }) : [];
  const stampOf = (u, role) => stamps.find((d) => d.id === monthPersonId(product.id, month, u.id, role))
    || stamps.find((d) => d.uid === u.id && d.role === role) || stamps.find((d) => d.uid === u.id) || null;
  const rows = people.map((u) => payrollRowOf(u, { compDocs, stamp: stampOf(u, payrollSetupOf(u).role), month, profile: profileOf(u), adjustments: adjustments.filter((a) => !a.saas || a.saas === product.id) }));
  const existing = (await repo.list("payables")).filter((p) => p.saas === product.id && p.month === month && p.counterpartyType === "colaborador");
  const byUid = new Map(existing.map((p) => [p.userId, p]));
  return {
    saas: product.id, month, dueDate: nextMonthFirstDay(month),
    rows: rows.map((r) => ({ ...r, payable: byUid.get(r.uid) ? { id: byUid.get(r.uid).id, amount: byUid.get(r.uid).amount, status: byUid.get(r.uid).status, amountManual: !!byUid.get(r.uid).amountManual } : null })),
    total: r2(rows.reduce((a, r) => a + r.total, 0)),
    stamped: rows.every((r) => r.stamped),
  };
}

// Gera/atualiza a conta a pagar de cada pessoa. Paga não muda; valor editado à
// mão (amountManual) também não; o resto acompanha o cálculo.
export async function generatePayroll(repo, product, month, { by = "api", now = new Date() } = {}) {
  const calc = await computePayroll(repo, product, month, { now });
  const out = { created: 0, updated: 0, kept: 0, rows: [] };
  for (const r of calc.rows) {
    const id = payrollPayableId(product.id, month, r.uid);
    const cur = (r.payable && (await repo.get("payables", r.payable.id))) || (await repo.get("payables", id));
    const payroll = { fixed: r.fixed, fixedFrom: r.fixedFrom, variable: r.variable, legs: r.legs, teamBonus: r.teamBonus, vr: r.vr, vt: r.vt, benefits: r.benefits, extras: r.extras, extrasTotal: r.extrasTotal, adjustments: r.adjustments, adjustmentsTotal: r.adjustmentsTotal, total: r.total, stamped: r.stamped, generatedAt: now.toISOString(), by };
    if (cur) {
      if (cur.status === "paga") { out.kept++; out.rows.push({ uid: r.uid, action: "paga" }); continue; }
      const patch = { notes: r.notes, payroll, ...(cur.amountManual ? {} : { amount: r.total }) };
      await repo.update("payables", cur.id, patch);
      out.updated++; out.rows.push({ uid: r.uid, action: cur.amountManual ? "valor manual mantido" : "atualizada", amount: cur.amountManual ? cur.amount : r.total });
      continue;
    }
    await repo.create("payables", {
      id, saas: product.id, description: "Salário", category: PAYROLL_CATEGORY[r.role] || "pessoal_adm",
      counterpartyType: "colaborador", userId: r.uid, supplierName: "",
      amount: r.total, month, dueDate: calc.dueDate, status: "aberta", paidAt: "", paidVia: "",
      recurring: false, endMonth: "", templateId: "", notes: r.notes, payroll, source: "payroll",
      createdAt: now.toISOString(),
    });
    out.created++; out.rows.push({ uid: r.uid, action: "criada", amount: r.total });
  }
  return { ...out, month, total: calc.total, stamped: calc.stamped };
}

export { DEFAULT_PLAN };
