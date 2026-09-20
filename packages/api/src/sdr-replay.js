// Bateria de REPLAY do SDR conversacional — o portão da Fase 2. Antes de ligar
// a conversa com IA em produção, roda o cérebro (anthropic.sdrDecide) contra
// conversas REAIS já acontecidas: em cada turno do lead, o que o robô teria
// feito? O relatório compara com o que o time respondeu de verdade e conta as
// ações (responder/agendar/humano/silêncio) + quantas respostas cairiam na
// trava de preço.
//
// COMPARAÇÃO DE MODELOS (17/09): a mesma bateria roda com OUTRO modelo
// (`model`, via anthropic.clone) e grava num doc próprio (`tag`), sem
// sobrescrever a rodada anterior. Além das ações, o relatório mede o que o
// raio-x apontou como vazamento de copy: frase-reflexo ("algum dos horários
// que te passei"), "vou verificar/confirmar com o especialista", resposta sem
// pergunta, tamanho médio da mensagem, tokens e latência por decisão.
//
// Roda em BACKGROUND (as chamadas de IA levam minutos no total): POST inicia,
// GET lê o estado — o resultado fica em app_config "sdr_replay" (ou
// "sdr_replay_<tag>"), com progresso parcial gravado a cada conversa.
import { kindOf, firstStage } from "./stages.js";
import { leadGrade } from "./routes.marketing.js";
import { slotLabel, wallNow, spreadPair, wholeHourSlots } from "./agenda-slots.js";
import { sdrSlotsForLead } from "./sdr-agenda.js";
import { leadDigest, leadPainFocus, SDR_AUTHOR } from "./sdr-flow.js";
import { PRICE_RX } from "./sdr-brain.js";

export const DOC_ID = "sdr_replay";
const WEEKDAYS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
// O que o raio-x de 17/09 mediu como copy que perde o lead.
const REFLEX_RX = /algum\s+d(os|esses|aqueles)\s+hor[áa]rios|hor[áa]rios?\s+que\s+(eu\s+)?(te\s+)?(passei|mandei|enviei)/i;
const VERIFY_RX = /vou (verificar|confirmar|checar|ver) (com|isso|aqui|junto)|deixa eu (confirmar|verificar) com (o|a) (time|especialista|equipe)/i;
const BRIDGE_RX = /google meet|ao vivo/i;

export const docIdOf = (tag) => (tag ? `${DOC_ID}_${String(tag).toLowerCase().replace(/[^a-z0-9_-]+/g, "-").slice(0, 40)}` : DOC_ID);

async function saveDoc(repo, id, doc) {
  const cur = await repo.get("app_config", id).catch(() => null);
  const next = { ...doc, id };
  return cur ? repo.update("app_config", id, next) : repo.create("app_config", next);
}

export function makeSdrReplay({ repo, anthropic, log = console, now = () => new Date() } = {}) {
  let running = false;

  async function status(tag = "") {
    const id = docIdOf(tag);
    return (await repo.get("app_config", id).catch(() => null)) || { id, status: "idle" };
  }

  // Todas as rodadas gravadas (a padrão e as por tag), mais recente primeiro:
  // é o que a comparação entre modelos lê.
  async function runs() {
    const all = await repo.list("app_config");
    return all
      .filter((d) => d.id === DOC_ID || String(d.id || "").startsWith(`${DOC_ID}_`))
      .map((d) => ({ id: d.id, tag: d.tag || "", model: d.model || d.report?.model || "", status: d.status, startedAt: d.startedAt, finishedAt: d.finishedAt, progress: d.progress, report: d.report ? { ...d.report, samples: undefined } : null }))
      .sort((a, b) => String(b.startedAt || "").localeCompare(String(a.startedAt || "")));
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

  async function run({ saas = "leverads", threads: maxThreads = 25, turns: turnsPerThread = 3, model = "", tag = "" } = {}) {
    const ai = model && typeof anthropic?.clone === "function" ? anthropic.clone({ model }) : anthropic;
    const docId = docIdOf(tag);
    const startedAt = now().toISOString();
    const wnow = wallNow(now());
    const p2 = (n) => String(n).padStart(2, "0");
    const nowLabel = `${WEEKDAYS[wnow.getUTCDay()]}, ${p2(wnow.getUTCDate())}/${p2(wnow.getUTCMonth() + 1)}, ${wnow.getUTCHours()}h${p2(wnow.getUTCMinutes())} (hora de Brasília)`;
    const product = await repo.get("products", saas);
    const picked = await pickThreads(saas, Math.min(60, Math.max(1, maxThreads)));

    const report = {
      saas, startedAt, model: model || ai?.model || "", tag,
      threads: picked.length, turns: 0, errors: 0,
      actions: { responder: 0, agendar: 0, remarcar: 0, desmarcar: 0, humano: 0, silencio: 0 },
      priceGuardHits: 0,          // respostas da IA com valor (a trava de preço trocaria: preço só na call)
      invalidSlotPicks: 0,        // agendar com horário fora da lista (o motor re-oferta)
      realBookedThreads: 0,       // nas conversas da amostra, quantas viraram call na vida real
      wouldBookThreads: 0,        // em quantas o robô teria marcado em algum turno
      // Copy que o raio-x de 17/09 mediu como vazamento:
      reflexPhrase: 0,            // "algum dos horários que te passei"
      verifyLater: 0,             // "vou verificar/confirmar com o especialista"
      noQuestion: 0,              // resposta sem pergunta nem próximo passo
      bridgeBeforeSlots: 0,       // ponte (o que é a demonstração) junto da oferta
      offersWithSlots: 0,         // respostas que ofereceram horário
      avgChars: 0,                // tamanho médio da resposta (soma / turnos)
      usage: { in: 0, out: 0, cacheRead: 0, cacheWrite: 0 }, // tokens somados
      msTotal: 0,                 // latência somada (÷ turns = média)
      samples: [],
    };
    let chars = 0;
    await saveDoc(repo, docId, { status: "running", startedAt, saas, tag, model: report.model, progress: { done: 0, total: picked.length }, report });

    for (let ti = 0; ti < picked.length; ti++) {
      const { lead, msgs } = picked[ti];
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
        const prevMsg = i >= 1 ? msgs[i - 1] : null;
        const demoOffered = msgs.slice(0, i).some((x) => x.direction === "out" && /demonstra|mostrar (a |o )?(leverads|plataforma|ferramenta)|funcionando ao vivo|t[íi]tulo de 200|part number|compatibilidade inteira|clonagem de an[úu]ncios|estoque, atendimento e edi[çc][ãa]o|gerenciar m[úu]ltiplas contas/i.test(x.text || ""));
        const gapMin = prevMsg ? Math.round((Date.parse(m.at || 0) - Date.parse(prevMsg.at || 0)) / 60_000) : null;
        const conversation = msgs.slice(0, i + 1).slice(-24).map((x) => ({
          who: x.direction === "in" ? "LEAD" : "VOCÊ",
          text: String(x.text || "").slice(0, 500) || "[mensagem]",
        }));
        const slotsOffered = msgs.slice(0, i).some((x) => x.direction === "out" && /(hoje|amanh[ãa]|segunda|ter[çc]a|quarta|quinta|sexta|s[áa]bado|domingo) às \d{1,2}h/i.test(x.text || ""));
        try {
          const { slots, requested: requestedDate, startDate: offerDate } = await sdrSlotsForLead(repo, { lead, saas, now: wnow, limit: 0, messages: msgs.slice(0, i + 1) });
          const slotList = slots.map((s) => ({ ...s, label: slotLabel(s.at, wnow) }));
          const d = await ai.sdrDecide({
            sdrName: "Manuela",
            lead: { name: lead.name, company: lead.company, email: lead.email, niche: lead.niche },
            digest: leadDigest(product, lead),
            grade: leadGrade(lead) || "",
            stage: lead.stage || firstStage(product),
            callAt: "", // replay: avalia a condução até a call, sem a call futura real
            nowLabel,
            slots: slotList,
            requestedDate,
            offerDate,
            conversation,
            pain: leadPainFocus(product, lead),
            canGreet: gapMin == null || gapMin >= 360,
            gapMin,
            demoOffered,
            suggestedPair: spreadPair(wholeHourSlots(slotList)),
            slotsOffered,
            firstReply: !msgs.slice(0, i).some((x) => x.direction === "out"),
          });
          report.actions[d.acao] = (report.actions[d.acao] || 0) + 1;
          if ((d.acao === "agendar" || d.acao === "remarcar")) {
            if (slotList.some((s) => s.at === d.horario)) bookedHere = true;
            else report.invalidSlotPicks++;
          }
          const text = String(d.mensagem || "");
          if (text && PRICE_RX.test(text)) report.priceGuardHits++;
          if (REFLEX_RX.test(text)) report.reflexPhrase++;
          if (VERIFY_RX.test(text)) report.verifyLater++;
          if (d.acao === "responder" && text && !text.includes("?")) report.noQuestion++;
          const offered = /(hoje|amanh[ãa]|segunda|ter[çc]a|quarta|quinta|sexta) às \d{1,2}h/i.test(text);
          if (offered) { report.offersWithSlots++; if (!slotsOffered && BRIDGE_RX.test(text)) report.bridgeBeforeSlots++; }
          chars += text.length;
          if (d.usage) for (const k of ["in", "out", "cacheRead", "cacheWrite"]) report.usage[k] += Number(d.usage[k]) || 0;
          report.msTotal += Number(d.ms) || 0;
          if (!report.model && d.model) report.model = d.model;
          if (report.samples.length < 40) {
            report.samples.push({
              lead: lead.name || lead.id,
              stage: lead.stage || "",
              kind: kindOf(product, lead.stage || firstStage(product)) || "",
              leadMsg: String(m.text || "").slice(0, 220),
              real: String(realNext.text || "").slice(0, 220),
              realAuthor: realNext.author === SDR_AUTHOR ? "sdr-bot" : realNext.author || "",
              bot: { acao: d.acao, mensagem: text.slice(0, 260), horario: d.horario || "", motivoHumano: d.motivoHumano || "" },
            });
          }
        } catch (err) {
          report.errors++;
          log.warn?.({ lead: lead.id, err: err.message }, "sdr-replay: decisão falhou");
        }
      }
      if (bookedHere) report.wouldBookThreads++;
      report.avgChars = report.turns ? Math.round(chars / report.turns) : 0;
      await saveDoc(repo, docId, { status: "running", startedAt, saas, tag, model: report.model, progress: { done: ti + 1, total: picked.length }, report });
    }

    const finishedAt = now().toISOString();
    await saveDoc(repo, docId, { status: "done", startedAt, finishedAt, saas, tag, model: report.model, progress: { done: picked.length, total: picked.length }, report });
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
        await saveDoc(repo, docIdOf(opts.tag), { status: "error", error: String(err.message || err).slice(0, 300), finishedAt: now().toISOString() }).catch(() => {});
      })
      .finally(() => { running = false; });
    return { started: true };
  }

  return { start, status, runs, run };
}
