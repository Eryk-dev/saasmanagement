// Lembrete diário das tarefas: de manhã (8h de São Paulo), quem tem tarefa
// vencendo hoje ou atrasada ganha uma notificação na caixa de entrada (e, se
// houver Discord, o canal recebe o resumo por pessoa). Mesmo espírito do
// training-reminder: no-op silencioso, best-effort, nunca derruba o servidor;
// o "já mandei hoje" fica persistido (app_config/task_reminder) e cada aviso
// tem chave própria (due:<tarefa>:<pessoa>:<dia>), então restart não duplica.
// Diferente do lembrete de treino, roda MESMO sem Discord: a caixa de entrada
// é o canal principal.

import { discord as defaultDiscord } from "./discord.js";
import { brtToday, usersOf, upsertNotification } from "./tasks-core.js";

const STATE_DOC = "task_reminder";
const KEEP_READ_DAYS = 30;
const PURGE_CAP = 200;

const daysLate = (due, today) => Math.round((Date.UTC(...today.split("-").map(Number).map((n, i) => (i === 1 ? n - 1 : n))) - Date.UTC(...due.split("-").map(Number).map((n, i) => (i === 1 ? n - 1 : n)))) / 86400000);

export function startTaskReminder(repo, {
  discord = defaultDiscord,
  log,
  hour = Number(process.env.TASK_REMINDER_HOUR || 8), // hora de São Paulo
  intervalMs = 10 * 60 * 1000,
  now = () => new Date(),
} = {}) {
  let running = false;

  async function tick(at = now()) {
    const spHour = new Date(at.getTime() - 3 * 3600 * 1000).getUTCHours(); // SP = UTC-3 fixo
    if (spHour < hour) return null;
    const today = brtToday(at);
    const state = await repo.get("app_config", STATE_DOC);
    if (state?.lastSentDay === today) return null;

    const [tasks, users] = await Promise.all([repo.list("tasks"), usersOf(repo)]);
    const known = new Set(users.map((u) => u.id));
    const perUser = new Map(); // id -> { today: n, overdue: n }
    let created = 0;
    for (const t of tasks) {
      if (t.completed || !t.dueDate || t.dueDate > today) continue;
      const recipients = (Array.isArray(t.assignees) && t.assignees.length ? t.assignees : (t.createdBy && t.createdBy !== "api" ? [t.createdBy] : [])).filter((u) => known.has(u));
      const late = daysLate(t.dueDate, today);
      for (const user of recipients) {
        const key = `due:${t.id}:${user}:${today}`;
        const dup = await repo.listWhere("notifications", { key }, { fields: [] });
        if (dup.length) continue;
        await upsertNotification(repo, {
          user, task: t.id, taskTitle: t.title || "", saas: t.saas || "", by: "api", key,
          type: late > 0 ? "overdue" : "due_today",
          text: late > 0 ? `"${t.title}" está atrasada há ${late} ${late === 1 ? "dia" : "dias"}` : `"${t.title}" vence hoje`,
        }, { now: at.toISOString() });
        created++;
        const c = perUser.get(user) || { today: 0, overdue: 0 };
        if (late > 0) c.overdue++; else c.today++;
        perUser.set(user, c);
      }
    }
    if (perUser.size && discord?.configured?.()) {
      const lines = [...perUser.entries()].map(([id, c]) => {
        const name = users.find((u) => u.id === id)?.name || id;
        const parts = [];
        if (c.today) parts.push(`${c.today} pra hoje`);
        if (c.overdue) parts.push(`${c.overdue} atrasada(s)`);
        return `• **${name}**: ${parts.join(" · ")}`;
      });
      try { await discord.taskReminder({ lines }); } catch { /* fail-open */ }
    }
    // Faxina: notificação lida há mais de 30 dias não precisa mais existir.
    let purged = 0;
    try {
      const cutoff = new Date(at.getTime() - KEEP_READ_DAYS * 86400000).toISOString();
      const old = await repo.listWhere("notifications", { read: true, readAt: { lt: cutoff } }, { fields: [] });
      for (const n of old.slice(0, PURGE_CAP)) { await repo.remove("notifications", n.id); purged++; }
    } catch (err) { log?.warn?.(`task reminder: faxina falhou: ${err.message}`); }
    // marca o dia mesmo sem nada vencendo: a varredura é uma por dia.
    if (state) await repo.update("app_config", STATE_DOC, { lastSentDay: today }, { silent: true });
    else await repo.create("app_config", { id: STATE_DOC, lastSentDay: today });
    return { day: today, created, people: perUser.size, purged };
  }

  const run = async () => {
    if (running) return null;
    running = true;
    try { return await tick(); }
    catch (err) { log?.warn?.(`task reminder: ${err.message}`); return null; }
    finally { running = false; }
  };
  const timer = setInterval(run, intervalMs);
  timer.unref?.();
  const first = setTimeout(run, 20_000); // depois das migrações de boot
  first.unref?.();
  return { tick, run, stop: () => { clearInterval(timer); clearTimeout(first); } };
}
