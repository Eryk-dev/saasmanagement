// Silêncio nosso no WhatsApp: o cliente falou e ninguém voltou. A tela do Inbox
// já mostra essa fila desde 13/09 ("N conversas esperando resposta"), mas quem
// não abre o Inbox não fica sabendo — e é a conversa mais barata do funil
// esfriando. Este runner avisa na caixa de entrada de QUEM cuida do lead.
//
// Mesmo espírito do task-reminder: best-effort, no-op silencioso, nunca derruba
// o servidor. Dedup por chave (wa:<thread>:<instante da última mensagem dele>):
// o mesmo silêncio só avisa uma vez, e uma resposta nova reabre o caso.
// Só em horário comercial do produto: ninguém precisa ser avisado às 3h.

import { upsertNotification, usersOf } from "./tasks-core.js";
import { isBusinessHours } from "./business-hours.js";

const HORAS_PADRAO = 3; // silêncio que vira aviso

export function startWaWaitingReminder(repo, {
  log,
  hours = Number(process.env.WA_WAITING_HOURS || HORAS_PADRAO),
  intervalMs = 15 * 60 * 1000,
  now = () => new Date(),
} = {}) {
  let running = false;

  async function tick(at = now()) {
    const limite = at.getTime() - Math.max(1, hours) * 3600 * 1000;
    const [threads, users, products] = await Promise.all([
      repo.list("wa_threads").catch(() => []),
      usersOf(repo),
      repo.list("products").catch(() => []),
    ]);
    const known = new Set(users.map((u) => u.id));
    const prodById = new Map(products.map((p) => [p.id, p]));
    let created = 0;

    for (const t of threads) {
      if (t.status === "closed") continue;
      // O CLIENTE falou por último: é o nosso silêncio, não o dele.
      if (t.lastDir !== "in" || !t.lastAt || !t.leadId) continue;
      const quando = new Date(t.lastAt).getTime();
      if (!Number.isFinite(quando) || quando > limite) continue;
      const produto = prodById.get(t.saas);
      if (produto && !isBusinessHours(produto, at)) continue;

      const lead = await repo.get("leads", t.leadId).catch(() => null);
      if (!lead) continue;
      // Quem cuida: closer, senão dono. Sem dono, ninguém é avisado (aviso pra
      // todo mundo é aviso pra ninguém).
      const user = [lead.closer, lead.owner].find((u) => u && known.has(u));
      if (!user) continue;

      const key = `wa:${t.id}:${t.lastAt}`;
      const dup = await repo.listWhere("notifications", { key }, { fields: [] });
      if (dup.length) continue;

      const horas = Math.max(1, Math.round((at.getTime() - quando) / 3600000));
      const quem = lead.name || t.name || t.phone || "o cliente";
      await upsertNotification(repo, {
        user, task: "", taskTitle: "", saas: t.saas || lead.saas || "", by: "api", key,
        type: "wa_waiting",
        text: `${quem} respondeu no WhatsApp e ninguém voltou há ${horas} ${horas === 1 ? "hora" : "horas"}`,
        link: { screen: "whatsapp", thread: t.id, lead: lead.id },
      }, { now: at.toISOString() });
      created++;
    }
    return { created };
  }

  const run = async () => {
    if (running) return null;
    running = true;
    try { return await tick(); }
    catch (err) { log?.warn?.(`wa waiting reminder: ${err.message}`); return null; }
    finally { running = false; }
  };
  const timer = setInterval(run, intervalMs);
  timer.unref?.();
  const first = setTimeout(run, 40_000); // depois das migrações e do task-reminder
  first.unref?.();
  return { tick, run, stop: () => { clearInterval(timer); clearTimeout(first); } };
}
