import test from "node:test";
import assert from "node:assert/strict";
import { addBusinessMinutes, businessMsBetween, nextSla, slaState, normalizeHours } from "../src/tickets-sla.js";
import { STATUS_KIND, normalizeSettings } from "../src/tickets-core.js";

const HOURS = { enabled: true, hourStart: 8, hourEnd: 18 };
const settings = (over = {}) => ({ ...normalizeSettings({ businessHours: HOURS, ...over }, "leverads"), statusKinds: STATUS_KIND });

test("minutos úteis atravessam o fim do expediente e o fim de semana (relógio de Brasília)", () => {
  // seg 14/09/2026 17:00 BRT + 120 min → ter 09:00 BRT
  assert.equal(addBusinessMinutes("2026-09-14T20:00:00.000Z", 120, HOURS), "2026-09-15T12:00:00.000Z");
  // sex 18/09 17:30 BRT + 60 min → seg 21/09 08:30 BRT
  assert.equal(addBusinessMinutes("2026-09-18T20:30:00.000Z", 60, HOURS), "2026-09-21T11:30:00.000Z");
  // aberto no sábado: conta a partir de seg 08:00
  assert.equal(addBusinessMinutes("2026-09-19T15:00:00.000Z", 30, HOURS), "2026-09-21T11:30:00.000Z");
  // sem expediente = corrido
  assert.equal(addBusinessMinutes("2026-09-19T15:00:00.000Z", 30, { enabled: false }), "2026-09-19T15:30:00.000Z");
  assert.equal(businessMsBetween("2026-09-18T20:30:00.000Z", "2026-09-21T11:30:00.000Z", HOURS), 60 * 60_000);
  assert.deepEqual(normalizeHours({ hourStart: 18, hourEnd: 9 }), { enabled: true, hourStart: 8, hourEnd: 18 });
});

test("prazos por prioridade, pausa em aguardando cliente e troca de prioridade", () => {
  const s = settings();
  const created = "2026-09-14T12:00:00.000Z"; // seg 09:00 BRT
  const t0 = { status: "new", priority: "urgent", createdAt: created };
  const sla0 = nextSla(null, t0, s, created);
  assert.equal(sla0.firstResponseDue, "2026-09-14T13:00:00.000Z", "urgente: 1ª resposta em 60 min");
  assert.equal(sla0.resolutionDue, "2026-09-14T20:00:00.000Z", "urgente: resolução em 480 min");

  // pausa às 10:00 BRT, retoma às 11:00 BRT → resolução empurrada 1h
  const t1 = { ...t0, sla: sla0, status: "pending_customer" };
  const sla1 = nextSla(t0, t1, s, "2026-09-14T13:00:00.000Z");
  assert.equal(sla1.pausedAt, "2026-09-14T13:00:00.000Z");
  assert.equal(slaState({ ...t1, sla: sla1 }, "2026-09-14T13:30:00.000Z").resolution, "paused");
  const t2 = { ...t1, sla: sla1, status: "open" };
  const sla2 = nextSla(t1, t2, s, "2026-09-14T14:00:00.000Z");
  assert.equal(sla2.pausedAt, "");
  assert.equal(sla2.pausedMs, 3_600_000);
  assert.equal(sla2.resolutionDue, "2026-09-14T21:00:00.000Z");

  // baixar a prioridade recalcula a partir da abertura
  const t3 = { ...t2, sla: sla2, priority: "low" };
  const sla3 = nextSla(t2, t3, s, "2026-09-14T14:00:00.000Z");
  assert.equal(sla3.resolutionDue, addBusinessMinutes(created, 7200 + 60, HOURS));
});

test("estado do SLA: ok, aviso a 80%, estouro, cumprido e estouro histórico", () => {
  const created = "2026-09-14T12:00:00.000Z";
  const base = { createdAt: created, sla: { firstResponseDue: "2026-09-14T13:00:00.000Z", resolutionDue: "2026-09-14T20:00:00.000Z", breached: {} } };
  assert.equal(slaState(base, "2026-09-14T12:10:00.000Z").overall, "ok");
  assert.equal(slaState(base, "2026-09-14T12:50:00.000Z").firstResponse, "warning");
  assert.equal(slaState(base, "2026-09-14T13:01:00.000Z").overall, "breached");
  const answered = { ...base, sla: { ...base.sla, firstResponseAt: "2026-09-14T12:30:00.000Z" } };
  assert.equal(slaState(answered, "2026-09-14T13:01:00.000Z").firstResponse, "met");
  assert.equal(slaState(answered, "2026-09-14T13:01:00.000Z").overall, "ok", "o relógio que corre manda");
  const late = { ...base, sla: { ...base.sla, firstResponseAt: "2026-09-14T14:00:00.000Z", resolvedAt: "2026-09-14T15:00:00.000Z" } };
  assert.equal(slaState(late).firstResponse, "breached");
  assert.equal(slaState(late).resolution, "met");

  // estourou e voltou a ficar dentro após subir o prazo: segue estourado
  const s = settings();
  const t = { status: "open", priority: "urgent", createdAt: created };
  const sla = nextSla(null, t, s, "2026-09-14T14:00:00.000Z");
  assert.equal(sla.breached.firstResponse, true);
  const relaxed = nextSla({ ...t, sla }, { ...t, sla, priority: "low" }, s, "2026-09-14T14:00:00.000Z");
  assert.equal(relaxed.breached.firstResponse, true);
});

test("configurações saneadas com padrões e expediente do produto", () => {
  const n = normalizeSettings({ policies: { urgent: { firstResponseMin: -5, resolutionMin: 120 } }, pauseOn: ["resolved", "on_hold"], warnAt: 3 }, "x", { waCallFlow: { hourStart: 9, hourEnd: 17 } });
  assert.equal(n.policies.urgent.firstResponseMin, 60);
  assert.equal(n.policies.urgent.resolutionMin, 120);
  assert.deepEqual(n.pauseOn, ["on_hold"]);
  assert.equal(n.warnAt, 0.8);
  assert.deepEqual(n.businessHours, { enabled: true, hourStart: 9, hourEnd: 17 });
  assert.equal(n.portal.enabled, false);
});
