// Contas a pagar recorrentes: o template (recurring:true, sem templateId) é a
// própria ocorrência do mês inicial; os meses seguintes viram INSTÂNCIAS com
// templateId, cada uma com baixa própria. A materialização NÃO acontece mais
// dentro do GET /api/fin (leitura com efeito colateral, e duas leituras
// simultâneas duplicavam a conta do mês): roda no tick do billing (mês atual e
// o próximo, todos os produtos) e no POST /api/fin/:saas/materialize.
//
// Id DETERMINÍSTICO por template+mês: a 2ª tentativa (poller + botão, duas
// abas) colide no id em vez de criar a instância de novo.

import { monthKey } from "../metrics/metrics-core.js";

// "2026-08" + dia preferido → data de vencimento válida (fev sem dia 31).
export const dueDayIn = (month, day) => {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(y, m, 0).getDate();
  const d = Math.min(Math.max(1, Number(day) || 5), last);
  return `${month}-${String(d).padStart(2, "0")}`;
};

export const instanceId = (templateId, month) => `pay_${templateId}_${month}`;

const templateCovers = (t, month) => String(t.month) < month && (!t.endMonth || String(t.endMonth) >= month);

// Templates do produto que ainda não têm instância no mês.
export function missingInstances(payables, saas, month) {
  const mine = payables.filter((p) => p.saas === saas);
  return mine
    .filter((p) => p.recurring && !p.templateId && templateCovers(p, month))
    .filter((t) => !mine.some((p) => p.templateId === t.id && p.month === month));
}

// Materializa as instâncias do mês (uma por template, idempotente).
export async function ensurePayables(repo, saas, month) {
  const all = await repo.list("payables");
  let created = 0;
  for (const t of missingInstances(all, saas, month)) {
    const id = instanceId(t.id, month);
    if (await repo.get("payables", id)) continue; // outra passada chegou antes
    try {
      await repo.create("payables", {
        id, saas,
        description: t.description, category: t.category,
        counterpartyType: t.counterpartyType, userId: t.userId || "", supplierName: t.supplierName || "",
        amount: Number(t.amount) || 0,
        month, dueDate: dueDayIn(month, String(t.dueDate || "").slice(8, 10)),
        status: "aberta", paidAt: "", paidVia: "",
        recurring: false, endMonth: "", templateId: t.id, notes: t.notes || "",
        createdAt: new Date().toISOString(),
      });
      created++;
    } catch (err) {
      // Id já existe (corrida com outra passada): não é erro.
      if (!/exist|duplicate|unique/i.test(String(err?.message || ""))) throw err;
    }
  }
  return created;
}

const nextMonth = (month) => {
  const d = new Date(`${month}-15T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() + 1);
  return d.toISOString().slice(0, 7);
};

// Mês atual + próximo, pra todos os produtos (tick do billing).
export async function materializeUpcomingPayables(repo, { now = new Date() } = {}) {
  const month = monthKey(now);
  const months = [month, nextMonth(month)];
  let created = 0;
  for (const p of await repo.list("products")) {
    for (const m of months) created += await ensurePayables(repo, p.id, m);
  }
  return created;
}
