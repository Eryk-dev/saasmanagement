import test from "node:test";
import assert from "node:assert/strict";
import { firstResponseAttribution } from "../src/metrics-core.js";

// SLA de 1ª resposta por QUALQUER canal: o sdr-bot conta (a espera do lead
// acabou), mas a régua marca se quem chegou primeiro foi máquina ou gente —
// a régua de contato HUMANO (contactAttribution) segue separada.
test("primeira resposta: robô conta, e o mais cedo vence (bot antes do humano)", () => {
  const leads = [{ id: "L1" }, { id: "L2" }, { id: "L3" }];
  const waMessages = [
    { thread: "t1", leadId: "L1", saas: "leverads", direction: "out", author: "sdr-bot", at: "2026-08-19T13:02:00Z" },
    { thread: "t1", leadId: "L1", saas: "leverads", direction: "out", author: "sdr", at: "2026-08-19T14:00:00Z" },
    { thread: "t9", leadId: "L9", saas: "leverads", direction: "out", author: "sdr-bot", at: "2026-08-19T13:02:00Z" }, // lead fora da lista: ignora
    { thread: "t2", leadId: "L2", saas: "outra", direction: "out", author: "sdr", at: "2026-08-19T13:00:00Z" },       // outro produto: ignora
  ];
  const acts = { L2: [{ type: "whatsapp", author: "sdr", at: "2026-08-19T13:30:00Z" }], L3: [{ type: "note", author: "sdr", at: "2026-08-19T13:00:00Z" }] };
  const first = firstResponseAttribution({
    leads,
    waMessages,
    actsOf: (id) => acts[id] || [],
    saas: "leverads",
    inWin: () => true,
    humanIds: new Set(["sdr", "leonardo"]),
  });
  assert.deepEqual(first.get("L1"), { at: "2026-08-19T13:02:00Z", human: false }, "o robô chegou primeiro");
  assert.deepEqual(first.get("L2"), { at: "2026-08-19T13:30:00Z", human: true }, "toque de cadência humano conta");
  assert.equal(first.get("L3"), undefined, "nota não é resposta");
});
