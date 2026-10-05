import test from "node:test";
import assert from "node:assert/strict";
import { makeMemRepo } from "./helpers/mem-repo.js";
import { slotsForLead, wallFromNaive, sdrCloserPools } from "../src/crm/agenda-slots.js";
import { sdrAgendaWindow, sdrSlotsForLead } from "../src/sdr/sdr-agenda.js";

const NOW = wallFromNaive("2026-09-21T08:00"); // segunda-feira
const TEAM = [
  { id: "leo", name: "Leonardo Parra", roles: ["closer"], compLevel: 1 },
  { id: "jonan", name: "Jonan", roles: ["closer"], compLevel: 1 },
  { id: "jonathan", name: "Jonathan", roles: ["closer"], compLevel: 1 },
  { id: "vit", name: "Vitor Silva", roles: ["integrator"], compLevel: 3 },
  { id: "other", name: "Outro", roles: ["closer"], compLevel: 3 },
  { id: "wrong-product", name: "Leonardo", roles: ["closer"], saas: "uniquekids" },
];
const inbound = (text) => ({ direction: "in", text, at: "2026-09-21T11:00:00Z" });
async function world() {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", funnel: [{ stage: "Call", kind: "call" }] });
  for (const u of TEAM) await repo.create("users", u);
  return repo;
}
const options = { saas: "leverads", now: NOW, limit: 0 };

test("equipe SDR é nominal e respeita produto, independente de compLevel", () => {
  const pools = sdrCloserPools(TEAM, "leverads");
  assert.deepEqual(pools.upper.map((u) => u.id), ["leo", "jonan", "jonathan"]);
  assert.deepEqual(pools.junior.map((u) => u.id), ["vit"]);
});

// Oferta espontânea (Leo, 30/09): HOJE com 2h de folga + o próximo dia útil.
// NOW é segunda 08:00, então hoje entra a partir das 10h e nada de D+2.
test("S/A/B somente Leonardo/Jonan/Jonathan; C/D/E e sem nota priorizam Vitor; oferta = hoje + amanhã", async () => {
  const repo = await world();
  for (const grade of ["S", "A", "B", "C", "D", "E", null]) {
    const { slots, requested } = await sdrSlotsForLead(repo, { ...options, grade });
    assert.ok(slots.length);
    assert.equal(requested, false);
    assert.equal(slots[0].at, "2026-09-21T10:00", "hoje entra com 2h de folga");
    assert.ok(slots.some((s) => s.at.startsWith("2026-09-22T")), "amanhã entra");
    assert.ok(slots.every((s) => s.at.startsWith("2026-09-21T") || s.at.startsWith("2026-09-22T")), "sem D+2");
    assert.ok(slots.every((s) => ["S", "A", "B"].includes(grade) ? ["leo", "jonan", "jonathan"].includes(s.closer) : s.closer === "vit"));
  }
  // Fim do expediente: hoje já não tem vaga, sobra só amanhã.
  const late = await sdrSlotsForLead(repo, { ...options, now: wallFromNaive("2026-09-21T19:00"), grade: "B" });
  assert.ok(late.slots.length && late.slots.every((s) => s.at.startsWith("2026-09-22T")));
});

test("S/A/B balanceia entre os três; não desce ao Vitor com pool ausente", async () => {
  const repo = await world();
  await repo.create("leads", { id: "busy", saas: "leverads", stage: "Call", closer: "leo", callAt: "2026-09-22T15:00" });
  assert.equal((await sdrSlotsForLead(repo, { ...options, grade: "B" })).slots[0].closer, "jonan");
  for (const id of ["leo", "jonan", "jonathan"]) await repo.remove("users", id);
  assert.deepEqual((await sdrSlotsForLead(repo, { ...options, grade: "A" })).slots, []);
});

test("C/D/E só sobe quando não sobra hora no dia do Vitor, inclusive para E", async () => {
  const repo = await world();
  await repo.create("agenda_blocks", { id: "v", user: "vit", recur: "once", date: "2026-09-22", fromHour: 9, toHour: 18 });
  const partial = await sdrSlotsForLead(repo, { ...options, grade: "E" });
  assert.ok(partial.slots.every((s) => s.closer === "vit" && (s.at.startsWith("2026-09-21T") || s.at >= "2026-09-22T18:00")));
  await repo.update("agenda_blocks", "v", { allDay: true });
  const result = await sdrSlotsForLead(repo, { ...options, grade: "E" });
  assert.ok(result.slots.length);
  assert.ok(result.slots.filter((s) => s.at.startsWith("2026-09-21T")).every((s) => s.closer === "vit"), "hoje segue do Vitor");
  const amanha = result.slots.filter((s) => s.at.startsWith("2026-09-22T"));
  assert.ok(amanha.length && amanha.every((s) => s.closer !== "vit"), "amanhã lotado do Vitor sobe pros demais");
});

test("hoje e amanhã cheios ficam sem oferta; não abre D+2. Agenda manual ainda oferece outros dias", async () => {
  const repo = await world();
  for (const date of ["2026-09-21", "2026-09-22"]) await repo.create("agenda_blocks", { id: "full-" + date, users: TEAM.map((u) => u.id), recur: "once", date, allDay: true });
  assert.deepEqual((await sdrSlotsForLead(repo, { ...options, grade: "D" })).slots, []);
  assert.ok((await slotsForLead(repo, { ...options, grade: "B" })).slots.some((s) => s.at.startsWith("2026-09-23T")));
});

test("fim de semana usa segunda e nunca terça automaticamente", async () => {
  const repo = await world();
  for (const day of ["2026-09-25", "2026-09-26", "2026-09-27"]) {
    const r = await sdrSlotsForLead(repo, { ...options, now: wallFromNaive(day + "T22:00"), grade: "B" });
    assert.ok(r.slots.length);
    assert.ok(r.slots.every((s) => s.at.startsWith("2026-09-28T")));
  }
});

test("somente pedido do lead libera outra data, inclusive áudio e continuação com hora", async () => {
  const repo = await world();
  for (const [text, date] of [["Pode ser quarta?", "2026-09-23"], ["Posso na quinta às 14h", "2026-09-24"], ["Só consigo depois de amanhã", "2026-09-23"], ["Podemos dia 30/09?", "2026-09-30"], ["Quero marcar 15/10/2026", "2026-10-15"], ["Tem hoje às 14h?", "2026-09-21"], ["sexta", "2026-09-25"], ["Podemos dia 16 de novembro?", "2026-11-16"], ["Podemos 15 de outubro?", "2026-10-15"]]) {
    const messages = [inbound(text), inbound("14h")];
    const r = await sdrSlotsForLead(repo, { ...options, grade: "C", messages });
    assert.equal(r.requested, true, text);
    assert.ok(r.slots.length, text);
    assert.ok(r.slots.every((s) => s.at.startsWith(date + "T")), text);
  }
  const audio = { ...inbound(""), transcript: "Pode marcar sexta às 14h?" };
  assert.equal(sdrAgendaWindow([audio], NOW).startDate, "2026-09-25");
  for (const text of ["Tenho interesse", "Amanhã não consigo", "Não posso amanhã", "Te respondo sexta", "Comecei a vender segunda", "Não tem mais cedo?", "Comprei quinta e ainda não chegou"]) {
    assert.equal(sdrAgendaWindow([inbound(text)], NOW).requested, false, text);
  }
  assert.equal(sdrAgendaWindow([{ direction: "out", text: "Consigo sexta às 10h" }], NOW).requested, false);
});

// ── Frases REAIS dos handoffs de 17 a 30/09 (raio-x 30/09): 8 de 14 não
// viravam pedido e cada uma virou "deixa eu reservar e te confirmo" + gente.
test("negação seguida de alternativa é pedido; dia recusado antes da negação não é", () => {
  const cases = [
    ["Esse horário nao consigo pode ser quarta", "2026-09-23"],
    ["Amanhã eu não consigo. Teria que ser quarta", "2026-09-23"],
    ["Não consigo este horário. Tem quinta?", "2026-09-24"],
    ["Mais sim na terça feira", "2026-09-22"],
    ["Poderíamos passar amanhã?", "2026-09-22"],
    ["Sexta-feira às 17h", "2026-09-25"],
    ["Conseguimos quinta ou sexta?", "2026-09-24"],
    ["Amanhã não dá, só quarta", "2026-09-23"],
  ];
  for (const [text, date] of cases) {
    const w = sdrAgendaWindow([inbound(text)], NOW);
    assert.equal(w.requested, true, text);
    assert.equal(w.startDate, date, text);
  }
});

test("período do dia vira faixa de horas: com dia, no dia; sem dia, 5 dias úteis dentro da faixa", async () => {
  const repo = await world();
  const tarde = sdrAgendaWindow([inbound("Consigo no período da tarde")], NOW);
  assert.equal(tarde.requested, true);
  assert.equal(tarde.periodOnly, true);
  assert.equal(tarde.startDate, "2026-09-21");
  assert.equal(tarde.days, 5);
  assert.deepEqual([tarde.fromHour, tarde.toHour], [12, 19]);
  const apos = sdrAgendaWindow([inbound("As 9h não consigo após as15h")], NOW);
  assert.deepEqual([apos.requested, apos.fromHour, apos.toHour], [true, 15, undefined]);
  const antes = sdrAgendaWindow([inbound("só antes das 11h")], NOW);
  assert.deepEqual([antes.fromHour, antes.toHour], [undefined, 11]);
  const amanhaTarde = sdrAgendaWindow([inbound("Vamos deixar pra amanhã à tarde")], NOW);
  assert.deepEqual([amanhaTarde.startDate, amanhaTarde.days, amanhaTarde.fromHour], ["2026-09-22", 1, 12]);
  assert.equal(sdrAgendaWindow([inbound("Pode ser à tarde?")], NOW).fromHour, 12);
  assert.equal(sdrAgendaWindow([inbound("de manhã não consigo")], NOW).requested, false, "período recusado não é pedido");
  // A lista respeita a faixa: só tarde, e só dias úteis.
  const r = await sdrSlotsForLead(repo, { ...options, grade: "C", messages: [inbound("Consigo no período da tarde")] });
  assert.ok(r.slots.length);
  assert.ok(r.slots.every((s) => Number(s.at.slice(11, 13)) >= 12 && Number(s.at.slice(11, 13)) < 19), JSON.stringify(r.slots.slice(0, 3)));
  assert.ok(r.slots.some((s) => s.at.startsWith("2026-09-23T")), "sem dia, a faixa avança pelos dias úteis");
});

test("hora solta com call marcada é o dia da call; pedido que ficou no passado é esquecido", () => {
  const w = sdrAgendaWindow([inbound("Pois 13hs estou almoçando, pode ser 14h?")], NOW, { callAt: "2026-09-21T13:00" });
  assert.deepEqual([w.requested, w.startDate, w.days, w.callDay], [true, "2026-09-21", 1, true]);
  assert.equal(sdrAgendaWindow([inbound("pode ser 14h?")], NOW).requested, false, "sem call marcada, hora solta fica na janela normal");
  const stale = sdrAgendaWindow([{ direction: "in", text: "Pode ser amanhã?", at: "2026-09-14T11:00:00Z" }], NOW);
  assert.equal(stale.requested, false);
  assert.equal(stale.startDate, "2026-09-21");
});

test("pedido sem vaga devolve as alternativas da janela normal com requestedEmpty", async () => {
  const repo = await world();
  await repo.create("agenda_blocks", { id: "full", users: TEAM.map((u) => u.id), recur: "once", date: "2026-09-23", allDay: true });
  const r = await sdrSlotsForLead(repo, { ...options, grade: "C", messages: [inbound("Pode ser quarta?")] });
  assert.equal(r.requested, true);
  assert.equal(r.startDate, "2026-09-23");
  assert.equal(r.requestedEmpty, true);
  assert.ok(r.slots.length && r.slots.every((s) => s.at.startsWith("2026-09-21T") || s.at.startsWith("2026-09-22T")));
});

test("pedido de semana seguinte aplica prioridade do Vitor em cada dia", async () => {
  const repo = await world();
  await repo.create("agenda_blocks", { id: "v", user: "vit", recur: "once", date: "2026-09-28", allDay: true });
  const r = await sdrSlotsForLead(repo, { ...options, grade: "D", messages: [inbound("Só consigo semana que vem")] });
  assert.ok(r.slots.some((s) => s.at.startsWith("2026-09-28T") && s.closer !== "vit"));
  assert.ok(r.slots.filter((s) => !s.at.startsWith("2026-09-28T")).every((s) => s.closer === "vit"));
});

test("pedido de sábado não autoriza segunda; data inválida não abre agenda", async () => {
  const repo = await world();
  assert.deepEqual((await sdrSlotsForLead(repo, { ...options, messages: [inbound("Pode ser sábado?")] })).slots, []);
  assert.equal(sdrAgendaWindow([inbound("Podemos dia 31/09?")], NOW).requested, false);
});

test("reservas não abrem dias posteriores nem escondem vagas após o limite antigo de 16", async () => {
  const repo = await world();
  const available = await sdrSlotsForLead(repo, { ...options, grade: "A" });
  const holds = available.slots.slice(0, -1).map((s) => ({ at: s.at, leadId: "other" }));
  const last = await sdrSlotsForLead(repo, { ...options, grade: "A", holds, lead: { id: "new" } });
  assert.equal(last.slots.length, 1);
  assert.equal(last.slots[0].at, "2026-09-22T19:00");
  holds.push({ at: last.slots[0].at, leadId: "other" });
  assert.deepEqual((await sdrSlotsForLead(repo, { ...options, grade: "A", holds })).slots, []);
});
