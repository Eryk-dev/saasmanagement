// Handoff do robô SDR que ninguém assumiu: aviso na caixa de entrada de quem
// cuida do lead (closer, senão dono). Raio-x 30/09: handoff é atendido em
// mediana 90 min, 4 de 54 nunca; o alerta quente fica no Inbox e quem não
// abre o Inbox não vê. Decisão do Leo: o robô NÃO retoma sozinho (handoff
// sempre espera gente), então o que resta é insistir com a pessoa certa.
//
// Mesmo espírito do wa-waiting-reminder: best-effort, dedup por chave, só em
// horário comercial. Chave handoff:<lead>:<handoffAt>:<n> — o n cresce a cada
// `repeatMs` sem atendimento, então o aviso volta (2h em 2h) até alguém falar.
import { upsertNotification, usersOf } from "../tasks/tasks-core.js";
import { isBusinessHours } from "../platform/business-hours.js";
import { listMessages, waMatchKey } from "../whatsapp/wa-store.js";

const MIN = 60_000;
const HOUR = 60 * MIN;
const KIND_LABEL = {
  ia: "a IA pediu gente",
  preco: "insistiu no preço",
  teto: "conversa longa (teto do dia)",
  afiliado: "afiliado (não é cliente)",
  redirect: "resposta com link/número descartada",
  repeticao: "robô sem resposta nova",
  "nega-call": "lead nega a conversa marcada",
};

export function startSdrHandoffReminder(repo, {
  log,
  minMs = 30 * MIN,      // silêncio nosso depois do handoff que vira aviso
  repeatMs = 2 * HOUR,   // repete enquanto ninguém assumir
  maxAgeMs = 48 * HOUR,  // handoff mais velho que isso é passado
  intervalMs = 5 * MIN,
  now = () => new Date(),
} = {}) {
  let running = false;

  async function tick(at = now()) {
    const nowMs = at.getTime();
    const [leads, users, products, threads] = await Promise.all([
      repo.list("leads").catch(() => []),
      usersOf(repo),
      repo.list("products").catch(() => []),
      repo.list("wa_threads").catch(() => []),
    ]);
    const known = new Set(users.map((u) => u.id));
    const prodById = new Map(products.map((p) => [p.id, p]));
    const threadByLead = new Map(), threadByKey = new Map();
    for (const t of threads) {
      if (t.leadId) threadByLead.set(t.leadId, t);
      const k = waMatchKey(t.phone || t.id);
      if (k) threadByKey.set(k, t);
    }
    let created = 0;

    for (const lead of leads) {
      const hAt = lead.sdrLog?.handoffAt;
      const hMs = Date.parse(hAt || "");
      if (!Number.isFinite(hMs)) continue;
      const age = nowMs - hMs;
      if (age < minMs || age > maxAgeMs) continue;
      if (lead.sdrOff) continue;
      const product = prodById.get(lead.saas);
      if (product && !isBusinessHours(product, at)) continue;
      const user = [lead.closer, lead.owner].find((u) => u && known.has(u));
      if (!user) continue;
      const t = threadByLead.get(lead.id) || threadByKey.get(waMatchKey(lead.waPhone || lead.phone));
      if (!t) continue;
      // Gente falou depois do handoff = atendido. O índice da thread só sabe
      // quem falou por ÚLTIMO (o robô pode ter mandado um lembrete depois da
      // pessoa), então lê a conversa dos poucos candidatos que sobram.
      const msgs = await listMessages(repo, t.id).catch(() => []);
      if (msgs.some((m) => m.direction === "out" && known.has(m.author) && Date.parse(m.at || 0) > hMs)) continue;
      const n = Math.floor((age - minMs) / repeatMs);
      const key = `handoff:${lead.id}:${hAt}:${n}`;
      const dup = await repo.listWhere("notifications", { key }, { fields: [] });
      if (dup.length) continue;
      const min = Math.round(age / MIN);
      const quanto = min < 120 ? `${min} min` : `${Math.round(min / 60)}h`;
      const why = lead.sdrLog?.handoffWhy || KIND_LABEL[lead.sdrLog?.handoffKind] || "precisa de gente";
      const leadWrote = msgs.some((m) => m.direction === "in" && Date.parse(m.at || 0) > hMs);
      const quem = lead.name || t.name || t.phone || "o lead";
      await upsertNotification(repo, {
        user, task: "", taskTitle: "", saas: lead.saas || t.saas || "", by: "api", key,
        type: "sdr_handoff",
        text: `Robô entregou ${quem} há ${quanto} e ninguém assumiu: ${why}${leadWrote ? " · o lead escreveu de novo e está sem resposta" : ""}`,
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
    catch (err) { log?.warn?.(`sdr handoff reminder: ${err.message}`); return null; }
    finally { running = false; }
  };
  const timer = setInterval(run, intervalMs);
  timer.unref?.();
  const first = setTimeout(run, 50_000);
  first.unref?.();
  return { tick, run, stop: () => { clearInterval(timer); clearTimeout(first); } };
}
