import test from "node:test";
import assert from "node:assert/strict";
import { bookingCandidates } from "../src/lib/booking-candidates.js";

const SAAS = [{ id: "leverads", funnel: [
  { stage: "Call", kind: "call" },
  { stage: "Ganho", kind: "ganho" },
  { stage: "Integração", kind: "integracao" },
  { stage: "Pós-venda", kind: "posvenda" },
] }];
const LEADS = [
  { id: "a", saas: "leverads", name: "Ana", stage: "Integração", integrator: "yudi" },
  { id: "b", saas: "leverads", name: "Bruno", stage: "Integração", integrator: "eryk" },
  { id: "c", saas: "leverads", name: "Cristiano Horcel", stage: "Ganho", email: "cris@x.com" },
  { id: "d", saas: "leverads", name: "Cristina", stage: "Call", integrator: "eryk" },
  { id: "e", saas: "leverads", name: "Edu", stage: "Pós-venda" },
];
const ids = (rows) => rows.map((r) => r.l.id);

test("bookingCandidates: sem busca, só a entrega de quem recebeu a marcação", () => {
  assert.deepEqual(ids(bookingCandidates(LEADS, SAAS, "yudi")), ["a", "e"]);
});

test("bookingCandidates: com busca, qualquer card; fora da entrega vai pra Integração", () => {
  const rows = bookingCandidates(LEADS, SAAS, "yudi", "cris");
  assert.deepEqual(ids(rows), ["c", "d"]);
  assert.equal(rows[0].move, true, "Ganho → Integração");
  assert.equal(rows[1].move, true, "Call → Integração");
  assert.equal(rows[1].otherIntegrator, "eryk");
  assert.deepEqual(ids(bookingCandidates(LEADS, SAAS, "yudi", "cris@x")), ["c"], "busca por e-mail");
});

test("bookingCandidates: busca põe a entrega de quem recebeu antes; card de outro integrador não se move", () => {
  const rows = bookingCandidates(LEADS, SAAS, "yudi", "n");
  assert.deepEqual(ids(rows), ["a", "b", "c", "d"]);
  const bruno = rows.find((r) => r.l.id === "b");
  assert.equal(bruno.move, false);
  assert.equal(bruno.otherIntegrator, "eryk");
});
