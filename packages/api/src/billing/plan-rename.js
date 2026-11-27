// Trocar o nome de um plano em tudo que mostra o nome de HOJE (Leo,
// 27/11/2026: "Ads Essencial + OEM" vira "LeverOEM Essencial", "Ads Escala +
// OEM" vira "LeverOEM Escala").
//
// Renomear pela tela de Planos muda só o plano e a projeção dele nas
// apresentações. O nome também mora em duas cópias, que a tela não toca:
//   - o retrato da venda (`planSnapshot`) de cada assinatura, de onde sai o
//     nome que vai para a ferramenta (entitlements.js) e o rótulo que o
//     cadastro do cliente recebe a cada sincronização (syncCustomerPlanFromSub);
//   - o cadastro do cliente: `planSnapshot` e o rótulo "Nome · Ciclo" da coluna
//     Plano. Foi assim que 14 clientes ficaram com "Lever OEM · Essencial ·
//     Anual" depois da troca de nomes de 02/10.
// Aqui as três andam juntas. Fica como está o que é registro do que valeu no
// dia: assinatura encerrada, histórico de troca de plano (plan_changes),
// faturas, propostas e links já enviados. Preço e limites do retrato não
// mudam, e o nome sozinho não sobe a versão de preço do plano (nextPlan).
//
// Rótulo do cliente que não começa por um nome do plano (escrito à mão) fica
// como está e sai no relatório, em `labelsKept`.
import { nextPlan, planIdOf, syncPlanCatalogProjection } from "./plan-catalog.js";

const limpo = (s) => String(s ?? "").trim();

/**
 * `aliases`: outros nomes que o plano já teve e que ainda aparecem em rótulo e
 * retrato (o nome atual do plano entra sozinho). Sem `apply`, só calcula: o
 * relatório diz o que mudaria e nada é gravado.
 */
export async function renamePlan(repo, { saas, code, name, aliases = [], apply = false, by = "script" } = {}) {
  const id = planIdOf(saas, code);
  const plan = await repo.get("plans", id);
  if (!plan) throw new Error(`plano ${id} não existe`);
  const novo = limpo(name);
  if (!novo) throw new Error("nome novo vazio");
  // Do mais longo para o mais curto: um nome que começa pelo outro não corta o rótulo no meio.
  const antigos = [...new Set([plan.name, ...aliases].map(limpo))]
    .filter((n) => n && n !== novo)
    .sort((a, b) => b.length - a.length);
  const rotuloNovo = (label) => {
    const l = limpo(label);
    for (const a of antigos) if (l === a || l.startsWith(a + " · ")) return novo + l.slice(a.length);
    return null;
  };
  const doPlano = (doc) => doc?.planCode === code && (!doc.saas || doc.saas === saas);

  const report = { plan: id, from: plan.name, to: novo, planRenamed: limpo(plan.name) !== novo, subscriptions: [], customers: [], labelsKept: [] };
  const writes = [];

  if (report.planRenamed) writes.push(() => repo.update("plans", id, nextPlan(plan, { name: novo }, { by })));

  for (const s of await repo.list("subscriptions")) {
    if (s.status === "canceled" || !(s.plan === id || doPlano(s))) continue;
    if (!s.planSnapshot || limpo(s.planSnapshot.name) === novo) continue;
    report.subscriptions.push({ id: s.id, customer: s.customer, from: s.planSnapshot.name });
    writes.push(() => repo.update("subscriptions", s.id, { planSnapshot: { ...s.planSnapshot, name: novo } }));
  }

  for (const c of await repo.list("customers")) {
    if (c.saas !== saas || c.planCode !== code) continue;
    const patch = {};
    if (c.planSnapshot && limpo(c.planSnapshot.name) !== novo) patch.planSnapshot = { ...c.planSnapshot, name: novo };
    const label = rotuloNovo(c.plan);
    if (label) patch.plan = label;
    else if (limpo(c.plan) && !limpo(c.plan).startsWith(novo)) report.labelsKept.push({ id: c.id, name: c.name, plan: c.plan });
    if (!Object.keys(patch).length) continue;
    report.customers.push({ id: c.id, name: c.name, from: c.plan || "", to: patch.plan ?? c.plan ?? "" });
    writes.push(() => repo.update("customers", c.id, patch));
  }

  if (apply) {
    for (const w of writes) await w();
    // O catálogo das apresentações é a projeção dos planos.
    if (report.planRenamed) await syncPlanCatalogProjection(repo, saas);
  }
  return report;
}
