// Lembrete diário de treinamento no Discord: de manhã, quem tem flashcard
// vencendo ganha uma linha no canal do time. Mesmo espírito dos outros jobs do
// index (marketing/call-summaries): no-op sem webhook, best-effort, nunca
// derruba o servidor. O "já enviei hoje" fica persistido (doc `reminder` na
// collection training_states) pra restart/redeploy não duplicar a mensagem.

import { discord as defaultDiscord } from "./discord.js";
import { teamSnapshot, flashcardsBase } from "./routes.flashcards.js";
import { dayKey } from "./fsrs.js";

// Id reservado — estados de usuário usam `${saas}__${user}`, nunca colidem.
const REMINDER_DOC = "reminder";

export function startTrainingReminder(repo, {
  discord = defaultDiscord,
  log,
  hour = Number(process.env.TRAINING_REMINDER_HOUR || 9), // hora de São Paulo
  intervalMs = 10 * 60 * 1000,
} = {}) {
  if (!discord.configured()) {
    log?.info?.("training reminder: sem DISCORD_WEBHOOK_URL — desligado");
    return null;
  }

  async function tick(now = new Date()) {
    const spHour = new Date(now.getTime() - 3 * 3600 * 1000).getUTCHours(); // SP = UTC-3 fixo
    if (spHour < hour) return false;
    const today = dayKey(now);
    const meta = await repo.get("training_states", REMINDER_DOC);
    if (meta?.lastSentDay === today) return false;

    const lines = [];
    for (const product of await repo.list("products")) {
      const base = await flashcardsBase(repo, product.id);
      if (!base.length) continue;
      for (const u of await teamSnapshot(repo, product.id, base, now)) {
        if (u.dueToday > 0) {
          lines.push(`• **${u.name}** — ${u.dueToday} card(s) pra revisar (${product.name})${u.overdue ? ` · ${u.overdue} atrasado(s)` : ""}`);
        }
      }
    }
    if (lines.length) await discord.trainingReminder({ lines });
    // marca o dia mesmo sem linhas: a varredura é uma por dia, não por tick.
    if (meta) await repo.update("training_states", REMINDER_DOC, { lastSentDay: today });
    else await repo.create("training_states", { id: REMINDER_DOC, lastSentDay: today });
    return lines.length > 0;
  }

  const timer = setInterval(() => tick().catch((e) => log?.warn?.(`training reminder: ${e.message}`)), intervalMs);
  timer.unref?.();
  tick().catch((e) => log?.warn?.(`training reminder: ${e.message}`));
  return { tick, stop: () => clearInterval(timer) };
}
