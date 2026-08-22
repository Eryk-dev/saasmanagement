// Bateria de REPLAY do SDR conversacional — o portão da Fase 2. Antes de ligar
// a conversa com IA em produção, roda o cérebro (anthropic.sdrDecide) contra
// conversas REAIS já acontecidas: em cada turno do lead, o que o robô teria
// feito? O relatório compara com o que o time respondeu de verdade e conta as
// ações (responder/agendar/humano/silêncio) + quantas respostas cairiam na
// trava de preço.
//
// Roda em BACKGROUND (as chamadas de IA levam minutos no total): POST inicia,
// GET lê o estado — o resultado fica em app_config "sdr_replay", com progresso
// parcial gravado a cada conversa pra dar pra acompanhar.
import { kindOf, firstStage } from "./stages.js";
import { leadGrade } from "./routes.marketing.js";
import { slotsForLead, slotLabel, wallNow, OFFER_HOURS } from "./agenda-slots.js";
import { leadDigest, SDR_AUTHOR } from "./sdr-flow.js";

const DOC_ID = "sdr_replay";
const PRICE_RX = /r\$\s*\d|\b\d{2,}\s*(reais|por m[eê]s|\/m[eê]s|mensais)\b|\ba partir de\s*\d/i;
const WEEKDAYS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

async function saveDoc(repo, doc) {
  const cur = await repo.get("app_config", DOC_ID).catch(() => null);
  const next = { ...doc, id: DOC_ID };
  return cur ? repo.update("app_config", DOC_ID, next) : repo.create("app_config", next);
}

export function makeSdrReplay({ repo, anthropic, log = console, now = () => new Date() } = {}) {
  let running = false;

  async function status() {
    return (await repo.get("app_config", DOC_ID).catch(() => null)) || { id: DOC_ID, status: "idle" };
  }

  // Seleciona as conversas: com lead vinculado, com ida E volta, mais recentes
  // primeiro. Um turno = uma mensagem do lead que TEVE resposta real do time
  // (é o que dá o par "robô teria feito X · o time fez Y").
  async function pickThreads(saas, maxThreads) {
    const [threads, messages, leads] = await Promise.all([
      repo.list("wa_threads"), repo.list("wa_messages"), repo.list("leads"),
    ]);
    const leadById = new Map(leads.map((l) => [l.id, l]));
    const byThread = new Map();
    for (const m of messages) {
      if (!byThread.has(m.thread)) byThread.set(m.thread, []);
      byThread.get(m.thread).push(m);
    }
    return threads
      .filter((t) => t.leadId && leadById.has(t.leadId) && (!saas || (t.saas || leadById.get(t.leadId)?.saas) === saas))
      .map((t) => {
        const msgs = (byThread.get(t.id) || []).slice().sort((a, b) => String(a.at || "").localeCompare(String(b.at || "")));
        return { thread: t, lead: leadById.get(t.leadId), msgs };
      })
      .filter((x) => x.msgs.some((m) => m.direction === "in") && x.msgs.some((m) => m.direction === "out"))
      .sort((a, b) => String(b.thread.lastAt || "").localeCompare(String(a.thread.lastAt || "")))
      .slice(0, maxThreads);
  }

  async function run({ saas = "leverads", threads: maxThreads = 25, turns: turnsPerThread = 3 } = {}) {
    const startedAt = now().toISOString();
    const wnow = wallNow(now());
    const p2 = (n) => String(n).padStart(2, "0");
    const nowLabel = `${WEEKDAYS[wnow.getUTCDay()]}, ${p2(wnow.getUTCDate())}/${p2(wnow.getUTCMonth() + 1)}, ${wnow.getUTCHours()}h${p2(wnow.getUTCMinutes())} (hora de Brasília)`;
    const product = await repo.get("products", saas);
    const picked = await pickThreads(saas, Math.min(60, Math.max(1, maxThreads)));

    const report = {
      saas, startedAt,
      threads: picked.length, turns: 0, errors: 0,
      actions: { responder: 0, agendar: 0, remarcar: 0, humano: 0, silencio: 0 },
      priceGuardHits: 0,          // respostas da IA que a trava de preço trocaria
      invalidSlotPicks: 0,        // agendar com horário fora da lista (o motor re-oferta)
      realBookedThreads: 0,       // nas conversas da amostra, quantas viraram call na vida real
      wouldBookThreads: 0,        // em quantas o robô teria marcado em algum turno
      samples: [],
    };
    await saveDoc(repo, { status: "running", startedAt, saas, progress: { done: 0, total: picked.length }, report });

    for (let ti = 0; ti < picked.length; ti++) {
      const { lead, msgs } = picked[ti];
      // Horários reais da agenda de HOJE: o replay avalia decisão e tom; a
      // validade do horário em si é papel do motor (sempre valida na hora).
      let slotList = [];
      try {
        const { slots } = await slotsForLead(repo, { lead, saas, now: wnow, limit: 16, ...OFFER_HOURS });
        slotList = slots.map((s) => ({ ...s, label: slotLabel(s.at, wnow) }));
      } catch { /* sem agenda: a IA é instruída a perguntar período */ }

      if (lead.callAt) report.realBookedThreads++;
      let bookedHere = false;
      let turns = 0;
      for (let i = 0; i < msgs.length && turns < turnsPerThread; i++) {
        const m = msgs[i];
        if (m.direction !== "in") continue;
        const realNext = msgs.slice(i + 1).find((x) => x.direction === "out");
        if (!realNext) continue; // sem resposta real: não há com o que comparar
        turns++;
        report.turns++;
        const conversation = msgs.slice(0, i + 1).slice(-24).map((x) => ({
          who: x.direction === "in" ? "LEAD" : "VOCÊ",
          text: String(x.text || "").slice(0, 500) || "[mensagem]",
        }));
        try {
          const d = await anthropic.sdrDecide({
            sdrName: "Manuela",
            lead: { name: lead.name, company: lead.company, email: lead.email },
            digest: leadDigest(product, lead),
            grade: leadGrade(lead) || "",
            stage: lead.stage || firstStage(product),
            callAt: "", // replay: avalia a condução até a call, sem a call futura real
            nowLabel,
            slots: slotList,
            conversation,
          });
          report.actions[d.acao] = (report.actions[d.acao] || 0) + 1;
          if ((d.acao === "agendar" || d.acao === "remarcar")) {
            if (slotList.some((s) => s.at === d.horario)) bookedHere = true;
            else report.invalidSlotPicks++;
          }
          if (d.mensagem && PRICE_RX.test(d.mensagem)) report.priceGuardHits++;
          if (report.samples.length < 40) {
            report.samples.push({
              lead: lead.name || lead.id,
              stage: lead.stage || "",
              kind: kindOf(product, lead.stage || firstStage(product)) || "",
              leadMsg: String(m.text || "").slice(0, 220),
              real: String(realNext.text || "").slice(0, 220),
              realAuthor: realNext.author === SDR_AUTHOR ? "sdr-bot" : realNext.author || "",
              bot: { acao: d.acao, mensagem: String(d.mensagem || "").slice(0, 260), horario: d.horario || "", motivoHumano: d.motivoHumano || "" },
            });
          }
        } catch (err) {
          report.errors++;
          log.warn?.({ lead: lead.id, err: err.message }, "sdr-replay: decisão falhou");
        }
      }
      if (bookedHere) report.wouldBookThreads++;
      await saveDoc(repo, { status: "running", startedAt, saas, progress: { done: ti + 1, total: picked.length }, report });
    }

    const finishedAt = now().toISOString();
    await saveDoc(repo, { status: "done", startedAt, finishedAt, saas, progress: { done: picked.length, total: picked.length }, report });
    return report;
  }

  // Dispara em background (single-flight). Devolve {started} ou {busy}.
  function start(opts = {}) {
    if (running) return { started: false, busy: true };
    if (!anthropic?.configured?.()) return { started: false, error: "IA não configurada no servidor" };
    running = true;
    run(opts)
      .catch(async (err) => {
        log.warn?.({ err: err.message }, "sdr-replay falhou");
        await saveDoc(repo, { status: "error", error: String(err.message || err).slice(0, 300), finishedAt: now().toISOString() }).catch(() => {});
      })
      .finally(() => { running = false; });
    return { started: true };
  }

  return { start, status, run };
}
