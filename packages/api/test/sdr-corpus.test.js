// CORPUS DE CENAS do robô SDR: cada cena é uma conversa real (ou o esqueleto
// dela) com o que o robô tem que fazer, referenciando as regras do rulebook
// pela tag #R-nnn. Roda com a IA falsa (determinístico), no mesmo mundo dos
// testes do cérebro (test/helpers/sdr-world.js).
//
// Formato de uma cena (test/sdr-corpus/*.scene.js, export default [...]):
//   { id, title, rules: ["R-0xx"], world: {...opções do world()},
//     ai: [decisões enfileiradas da IA falsa], inbounds: ["msg do lead", ...],
//     expect: { result, sent: [regex], notSent: [regex], lead: {campo: valor},
//               state, intent, audit: { rules: [...], exempt: [...], notRules: [...] },
//               shadowSame: true|false }, todo: "motivo" }

import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { world, makeFakes, brainOf, NOW, ISO } from "./helpers/sdr-world.js";

const DIR = new URL("./sdr-corpus/", import.meta.url);
const files = readdirSync(DIR).filter((f) => f.endsWith(".scene.js")).sort();
const THREAD = "5541999990000";

async function run(sc) {
  const repo = await world(sc.world || {});
  const fakes = makeFakes({ decisions: sc.ai || [], approved: sc.approved || [] });
  const brain = brainOf(repo, fakes);
  let result = null, seq = 500;
  for (const text of sc.inbounds || []) {
    const id = `in${++seq}`;
    await repo.create("wa_messages", { id, thread: THREAD, leadId: "L1", saas: "leverads", direction: "in", text, at: ISO(NOW) });
    result = await brain.handleInbound({ message: { from: THREAD, text, id } });
  }
  const lead = await repo.get("leads", "L1");
  const thread = await repo.get("wa_threads", THREAD);
  const leads = await repo.list("leads");
  return { result, lead, thread, leads, sent: fakes.sent.map((s) => s.text), calls: fakes.calls };
}

for (const f of files) {
  const scenes = (await import(new URL(f, DIR))).default;
  for (const sc of scenes) {
    const title = `${sc.id} · ${sc.title} ${sc.rules.map((r) => `#${r}`).join(" ")}`;
    if (sc.todo) { test.todo(`${title} (${sc.todo})`); continue; }
    test(title, async () => {
      const r = await run(sc);
      const e = sc.expect || {};
      if (e.result !== undefined) assert.equal(r.result, e.result, "resultado da última decisão");
      for (const rx of e.sent || []) assert.ok(r.sent.some((t) => rx.test(t)), `devia ter enviado ${rx}; enviou: ${JSON.stringify(r.sent)}`);
      for (const rx of e.notSent || []) assert.ok(!r.sent.some((t) => rx.test(t)), `não devia ter enviado ${rx}; enviou: ${JSON.stringify(r.sent)}`);
      for (const [k, v] of Object.entries(e.lead || {})) assert.equal(r.lead[k], v, `lead.${k}`);
      // `otherLead`: um lead além do L1 com estes campos (o indicado, R-043).
      if (e.otherLead) assert.ok(r.leads.some((l) => l.id !== "L1" && Object.entries(e.otherLead).every(([k, v]) => (v instanceof RegExp ? v.test(String(l[k] || "")) : l[k] === v))), `devia existir outro lead com ${JSON.stringify(e.otherLead)}; leads: ${JSON.stringify(r.leads.map((l) => ({ id: l.id, name: l.name, phone: l.phone, source: l.source })))}`);
      if (e.leadCount != null) assert.equal(r.leads.length, e.leadCount, "quantidade de leads");
      for (const [k, v] of Object.entries(e.sdrLog || {})) { const got = r.lead.sdrLog?.[k]; if (v instanceof RegExp) assert.match(String(got || ""), v, `sdrLog.${k}`); else assert.equal(got, v, `sdrLog.${k}`); }
      // `aiPainMode`: o foco (pain.mode) que a IA recebeu na ÚLTIMA decisão (R-045).
      if (e.aiPainMode) assert.equal(r.calls.at(-1)?.pain?.mode, e.aiPainMode, "foco enviado à IA");
      if (e.state) assert.equal(r.thread.brain?.state, e.state, "estado carimbado");
      if (e.intent) assert.equal(r.thread.brain?.intent, e.intent, "intenção carimbada");
      const vio = r.thread.brain?.audit?.violations || [];
      for (const rule of e.audit?.rules || []) assert.ok(vio.some((v) => v.rule === rule && !v.exempt), `auditoria devia registrar ${rule}; registrou ${JSON.stringify(vio)}`);
      for (const rule of e.audit?.exempt || []) assert.ok(vio.some((v) => v.rule === rule && v.exempt), `auditoria devia registrar ${rule} como isenta; registrou ${JSON.stringify(vio)}`);
      for (const rule of e.audit?.notRules || []) assert.ok(!vio.some((v) => v.rule === rule && !v.exempt), `auditoria não devia registrar ${rule}; registrou ${JSON.stringify(vio)}`);
      if (r.thread.brain?.shadow) assert.equal(r.thread.brain.shadow.same, e.shadowSame !== false, `sombra do validador: ${JSON.stringify(r.thread.brain.shadow)}`);
    });
  }
}

test("corpus: o mundo compartilhado é cópia fiel do mundo de sdr-brain.test.js", () => {
  const helper = readFileSync(fileURLToPath(new URL("./helpers/sdr-world.js", import.meta.url)), "utf8");
  const brainTest = readFileSync(fileURLToPath(new URL("./sdr-brain.test.js", import.meta.url)), "utf8");
  // O corpo de world() tem que ser o mesmo nos dois (fora as exportações).
  const bodyOf = (s) => s.slice(s.indexOf("async function world("), s.indexOf("function makeFakes(")).replace(/^export /gm, "");
  assert.equal(bodyOf(helper), bodyOf(brainTest), "world() divergiu entre o helper e o sdr-brain.test.js");
});
