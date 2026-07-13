// Sequências de nutrição (drip) — CRUD de `sequences` / `sequence_enrollments` /
// `drip_templates` é o REST genérico; aqui ficam as AÇÕES:
//   POST /api/sequences/:id/enroll  — inscreve leads na mão (além do gatilho).
//   POST /api/sequences/wa-sent     — o operador mandou o WhatsApp do passo
//     assistido: loga o toque e AVANÇA o enrollment (destrava o "waiting").
//   GET  /api/sequences/metrics/:saas — conversão no funil por sequência.
//   POST /api/sequences/run         — roda UM ciclo do motor na hora (testar/forçar).
// Tudo sob a tela "disparos" no ROUTE_SCREENS.
import { logActivity } from "./lead-flow.js";
import { ladderOf, isWon, kindOf } from "./stages.js";
import { makeDripRunner, advanceEnrollment } from "./drip-runner.js";

const DAY = 86_400_000;
const ATTR_WINDOW = 30 * DAY;

export function registerSequenceRoutes(app, repo, { mailer } = {}) {
  const runner = makeDripRunner({ repo, mailer, log: app.log || console });

  // Roda um ciclo do motor sob demanda (o poller roda sozinho a cada 5 min).
  app.post("/api/sequences/run", async () => await runner.tick());

  // Inscrição manual: entra no passo 0 já vencido (roda no próximo ciclo). Pula
  // quem já está inscrito nessa sequência.
  app.post("/api/sequences/:id/enroll", async (req, reply) => {
    const seq = await repo.get("sequences", req.params.id);
    if (!seq) return reply.code(404).send({ error: "sequência não encontrada" });
    const { leadIds } = req.body || {};
    if (!Array.isArray(leadIds) || !leadIds.length) return reply.code(400).send({ error: "informe leadIds (lista)" });
    const already = new Set((await repo.list("sequence_enrollments")).filter((e) => e.sequence === seq.id).map((e) => e.lead));
    const now = new Date().toISOString();
    let enrolled = 0;
    for (const leadId of leadIds) {
      if (already.has(leadId)) continue;
      const lead = await repo.get("leads", leadId);
      if (!lead) continue;
      already.add(leadId);
      await repo.create("sequence_enrollments", {
        saas: seq.saas, sequence: seq.id, lead: leadId, status: "active",
        stepIndex: 0, nextRunAt: now, pendingChannel: "", exitReason: "", enrolledAt: now, lastAt: "",
      });
      enrolled++;
    }
    return { enrolled };
  });

  // O operador mandou o WhatsApp do passo assistido → loga e avança.
  app.post("/api/sequences/wa-sent", async (req, reply) => {
    const { enrollmentId } = req.body || {};
    if (!enrollmentId) return reply.code(400).send({ error: "informe enrollmentId" });
    const en = await repo.get("sequence_enrollments", enrollmentId);
    if (!en) return reply.code(404).send({ error: "inscrição não encontrada" });
    const seq = await repo.get("sequences", en.sequence);
    if (!seq) return reply.code(404).send({ error: "sequência não encontrada" });
    const lead = await repo.get("leads", en.lead);
    if (lead) {
      await logActivity(repo, {
        saas: lead.saas || seq.saas || "", lead: lead.id, type: "whatsapp",
        text: `sequência: ${seq.name || ""}`,
        meta: { sequence: seq.id, step: en.stepIndex, stageAtSend: lead.stage || "" },
        author: req.authUser?.id || "", at: new Date().toISOString(),
      });
    }
    const updated = await advanceEnrollment(repo, seq, en);
    return updated;
  });

  // Conversão no funil por sequência: dos leads inscritos, quantos avançaram de
  // etapa / marcaram call / fecharam nos 30d após entrar. + contagem por status.
  app.get("/api/sequences/metrics/:saas", async (req, reply) => {
    const saas = req.params.saas;
    const product = await repo.get("products", saas);
    const seqs = (await repo.list("sequences")).filter((s) => s.saas === saas);
    const enrollments = (await repo.list("sequence_enrollments")).filter((e) => e.saas === saas);
    const acts = await repo.list("activities");
    const stageByLead = new Map();
    for (const a of acts) {
      if (a.type !== "stage" || !a.lead) continue;
      if (!stageByLead.has(a.lead)) stageByLead.set(a.lead, []);
      stageByLead.get(a.lead).push(a);
    }
    const lad = product ? ladderOf(product) : [];
    const idx = (st) => lad.indexOf(st);
    const byLeadMoves = (leadId, at0) => (stageByLead.get(leadId) || []).filter((a) => {
      const t = new Date(a.at).getTime();
      return Number.isFinite(t) && t > at0 && t <= at0 + ATTR_WINDOW;
    });

    const sequences = seqs.map((seq) => {
      const mine = enrollments.filter((e) => e.sequence === seq.id);
      const status = { active: 0, waiting: 0, done: 0, exited: 0 };
      let advanced = 0, booked = 0, won = 0;
      for (const en of mine) {
        status[en.status] = (status[en.status] || 0) + 1;
        const at0 = en.enrolledAt ? new Date(en.enrolledAt).getTime() : NaN;
        if (!Number.isFinite(at0)) continue;
        const moves = byLeadMoves(en.lead, at0);
        if (moves.some((a) => idx(a.meta?.to) >= 0 && idx(a.meta?.to) > idx(a.meta?.from))) advanced++;
        if (product && moves.some((a) => kindOf(product, a.meta?.to) === "call")) booked++;
        if (product && moves.some((a) => isWon(product, a.meta?.to))) won++;
      }
      return { id: seq.id, name: seq.name || "", status: seq.status || "draft", enrolled: mine.length, statusCounts: status, advanced, booked, won };
    });
    return { sequences };
  });
}
