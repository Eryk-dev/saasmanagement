import test from "node:test";
import assert from "node:assert/strict";
import { collapseSameDay, expandSameDay, offeredSlotsIn, acceptedSlot, isOfferMsg } from "../src/sdr/sdr-signals.js";

// Leo, 08/10: dois horários do mesmo dia levam o dia uma vez só.
test("collapseSameDay: mesmo dia, dia uma vez; dias diferentes ficam como estão", () => {
  assert.equal(collapseSameDay("Consigo amanhã às 9h ou amanhã às 11h, qual fica melhor pra você?"), "Consigo amanhã às 9h ou às 11h, qual fica melhor pra você?");
  assert.equal(collapseSameDay("Consigo segunda às 9h ou segunda às 13h"), "Consigo segunda às 9h ou às 13h");
  assert.equal(collapseSameDay("sexta 04/09 às 10h ou sexta 04/09 às 14h30"), "sexta 04/09 às 10h ou às 14h30");
  assert.equal(collapseSameDay("Tenho terça às 17h ou quarta às 17h"), "Tenho terça às 17h ou quarta às 17h");
  assert.equal(collapseSameDay("Consigo hoje às 15h ou amanhã às 9h"), "Consigo hoje às 15h ou amanhã às 9h");
  assert.equal(expandSameDay("Consigo amanhã às 9h ou às 11h"), "Consigo amanhã às 9h ou amanhã às 11h");
  assert.equal(expandSameDay("Tenho terça às 17h ou quarta às 17h"), "Tenho terça às 17h ou quarta às 17h");
  assert.ok(isOfferMsg("Consigo amanhã às 9h ou às 11h, qual fica melhor pra você?"));
});

test("offeredSlotsIn lê a oferta com o dia uma vez; acceptedSlot entende número solto e recusa hora ambígua", () => {
  const offered = offeredSlotsIn([{ direction: "out", author: "sdr-bot", at: "2026-10-02T11:07:00Z", text: "Consigo amanhã às 9h ou às 11h, qual fica melhor pra você?" }]);
  assert.deepEqual(offered.map((s) => s.at), ["2026-10-03T09:00", "2026-10-03T11:00"]);
  assert.equal(acceptedSlot("11", offered)?.at, "2026-10-03T11:00");
  assert.equal(acceptedSlot("as 9", offered)?.at, "2026-10-03T09:00");
  assert.equal(acceptedSlot("18", offered), null);
  assert.equal(acceptedSlot("2026", offered), null);
  const same = offeredSlotsIn([{ direction: "out", author: "sdr-bot", at: "2026-10-02T11:07:00Z", text: "Tenho terça às 17h ou quarta às 17h, qual fica melhor pra você?" }]);
  assert.equal(acceptedSlot("17", same), null, "mesma hora em dois dias sem o dia = ambíguo");
  assert.equal(acceptedSlot("quarta 17h", same)?.at, "2026-10-07T17:00");
});
