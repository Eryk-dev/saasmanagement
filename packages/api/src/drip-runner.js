// Motor das sequências de nutrição (drip). Um poller de fundo (mesmo padrão do
// call-summaries) que a cada ciclo:
//   1) AUTO-INSCREVE leads que entraram nas etapas-gatilho de cada sequência ativa;
//   2) AVANÇA os enrollments vencidos: checa condição de saída (fechou/marcou
//      call/descadastrou), executa o passo do momento (e-mail = envia pela conta
//      Google; WhatsApp = NÃO auto-envia, marca "waiting" pra fila assistida da
//      tela) e reagenda o próximo passo pelo delay.
// Idempotente: um lead nunca é reinscrito na mesma sequência (enrolledKey), e o
// e-mail só avança quando enviado (sem Gmail, tenta no próximo ciclo).
import { logActivity } from "./lead-flow.js";
import { isWon, kindOf } from "./stages.js";
import { leadTokens, interpolate, baseUrl, unsubToken, emailBodyWithUnsub } from "./disparos-util.js";

const DAY = 86_400_000;

const schedule = (now, delayDays) => new Date(now + Math.max(0, Number(delayDays) || 0) * DAY).toISOString();

// Condição de saída da sequência (default: todas ligadas). Vazio = segue.
export function exitReasonFor(seq, lead, product) {
  const ex = seq.exitOn || {};
  if (ex.optOut !== false && lead.emailOptOut) return "descadastrou";
  if (ex.won !== false && product && isWon(product, lead.stage)) return "fechou";
  if (ex.booked !== false && (lead.callAt || (product && kindOf(product, lead.stage) === "call"))) return "marcou call";
  return "";
}

// Avança um enrollment pro próximo passo (ou marca done). Reusado pelo tick (após
// enviar e-mail) e pela rota wa-sent (após o operador mandar o WhatsApp).
export async function advanceEnrollment(repo, seq, en, now = Date.now()) {
  const nowIso = new Date(now).toISOString();
  const nextIdx = (Number(en.stepIndex) || 0) + 1;
  const nextStep = (seq.steps || [])[nextIdx];
  const patch = nextStep
    ? { stepIndex: nextIdx, nextRunAt: schedule(now, nextStep.delayDays), status: "active", pendingChannel: "", lastAt: nowIso }
    : { stepIndex: nextIdx, status: "done", pendingChannel: "", lastAt: nowIso };
  return repo.update("sequence_enrollments", en.id, patch);
}

export function makeDripRunner({ repo, mailer, log = console } = {}) {
  async function tick() {
    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    const seqs = (await repo.list("sequences")).filter((s) => s.status === "active");
    let enrolled = 0, sent = 0, waiting = 0, exited = 0, done = 0;

    // Chave de já-inscrito (qualquer status): um lead nunca reentra na sequência.
    const enrolledKey = new Set((await repo.list("sequence_enrollments")).map((e) => `${e.sequence}:${e.lead}`));

    // 1) AUTO-INSCRIÇÃO por etapa-gatilho.
    if (seqs.length) {
      const leads = await repo.list("leads");
      for (const seq of seqs) {
        const stages = new Set(seq.trigger?.stages || []);
        if (!stages.size || !Array.isArray(seq.steps) || !seq.steps.length) continue;
        for (const lead of leads) {
          if (lead.saas !== seq.saas || !stages.has(lead.stage)) continue;
          const key = `${seq.id}:${lead.id}`;
          if (enrolledKey.has(key)) continue;
          enrolledKey.add(key);
          await repo.create("sequence_enrollments", {
            saas: seq.saas, sequence: seq.id, lead: lead.id, status: "active",
            stepIndex: 0, nextRunAt: schedule(now, seq.steps[0]?.delayDays), pendingChannel: "",
            exitReason: "", enrolledAt: nowIso, lastAt: "",
          });
          enrolled++;
        }
      }
    }

    // 2) AVANÇO dos vencidos.
    const seqById = new Map(seqs.map((s) => [s.id, s]));
    const due = (await repo.list("sequence_enrollments"))
      .filter((e) => e.status === "active" && e.nextRunAt && new Date(e.nextRunAt).getTime() <= now);
    const prodCache = new Map();
    const getProduct = async (id) => { if (!prodCache.has(id)) prodCache.set(id, await repo.get("products", id)); return prodCache.get(id); };

    for (const en of due) {
      const seq = seqById.get(en.sequence);
      if (!seq) continue; // sequência pausada/removida: enrollment fica parado
      try {
        const lead = await repo.get("leads", en.lead);
        if (!lead) { await repo.update("sequence_enrollments", en.id, { status: "exited", exitReason: "lead removido", lastAt: nowIso }); exited++; continue; }
        const product = await getProduct(seq.saas);
        const reason = exitReasonFor(seq, lead, product);
        if (reason) { await repo.update("sequence_enrollments", en.id, { status: "exited", exitReason: reason, lastAt: nowIso }); exited++; continue; }
        const step = (seq.steps || [])[en.stepIndex];
        if (!step) { await repo.update("sequence_enrollments", en.id, { status: "done", lastAt: nowIso }); done++; continue; }

        // WhatsApp é assistido: para no passo e espera o operador (fila da tela).
        if (step.channel === "whatsapp") {
          await repo.update("sequence_enrollments", en.id, { status: "waiting", pendingChannel: "whatsapp", lastAt: nowIso });
          waiting++;
          continue;
        }

        // E-mail: envia pela conta Google. Sem e-mail / descadastrado = pula o
        // passo (avança). Sem Gmail pronto = NÃO avança (re-tenta no próximo ciclo).
        if (lead.email && !lead.emailOptOut) {
          if (!mailer || !(await mailer.ready())) continue;
          const toks = leadTokens(lead);
          const unsubUrl = `${baseUrl()}/u/${unsubToken(lead.id)}`;
          await mailer.send({
            to: lead.email,
            subject: interpolate(step.subject || "", toks),
            text: emailBodyWithUnsub(step.body || "", toks, unsubUrl),
            headers: { "List-Unsubscribe": `<${unsubUrl}>` },
          });
          await logActivity(repo, {
            saas: lead.saas || seq.saas, lead: lead.id, type: "email",
            text: `sequência: ${seq.name || ""}`,
            meta: { sequence: seq.id, step: en.stepIndex, stageAtSend: lead.stage || "" },
            at: nowIso,
          });
          sent++;
        }
        await advanceEnrollment(repo, seq, en, now);
      } catch (err) {
        log.warn?.({ seq: en.sequence, lead: en.lead, err: err.message }, "passo da sequência falhou (re-tenta no próximo ciclo)");
      }
    }
    return { enrolled, sent, waiting, exited, done };
  }

  return { tick };
}

// Poller de produção: a cada 5 min, single-flight, mesmo padrão do
// startCallSummaries. Silencioso quando não há sequência ativa.
export function startDripSequences(repo, { mailer, intervalMs = 300_000, log = console } = {}) {
  const worker = makeDripRunner({ repo, mailer, log });
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try { await worker.tick(); }
    catch (err) { log.warn?.({ err: err.message }, "poller de sequências falhou"); }
    finally { running = false; }
  };
  const timer = setInterval(run, intervalMs);
  timer.unref?.();
  setTimeout(run, 20_000).unref?.(); // primeiro passe pouco depois do boot
  return { stop: () => clearInterval(timer), run };
}
