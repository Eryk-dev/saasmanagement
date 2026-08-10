import test from "node:test";
import assert from "node:assert/strict";
import { weekendDuty, isWeekendDuty, weekendDutyPhone, isAutoSilenced } from "../src/weekend-duty.js";

// Horários escritos no relógio de Brasília (UTC-3), que é o fuso do negócio.
const brt = (iso) => new Date(`${iso}-03:00`);

const LEVERADS = {
  weekendDuty: { enabled: true, phone: "5541995063622" },
};

test("sem config, nada de plantão: o produto segue como sempre foi", () => {
  assert.equal(weekendDuty({}), null);
  assert.equal(isWeekendDuty({}, brt("2026-08-08T10:00")), false);      // sábado
  assert.equal(weekendDutyPhone({}, brt("2026-08-08T10:00")), "");
  assert.equal(isAutoSilenced({}, brt("2026-08-08T10:00")), false);
});

test("config sem número não vira janela (não há pra onde mandar o lead)", () => {
  assert.equal(weekendDuty({ weekendDuty: { enabled: true } }), null);
  assert.equal(isWeekendDuty({ weekendDuty: { enabled: true } }, brt("2026-08-08T10:00")), false);
});

test("a janela abre na sexta 18h e fecha na segunda 8h", () => {
  const dentro = [
    "2026-08-07T18:00", // sexta, no minuto da virada
    "2026-08-07T23:59", // sexta à noite
    "2026-08-08T10:00", // sábado
    "2026-08-09T22:00", // domingo à noite
    "2026-08-10T07:59", // segunda, um minuto antes de abrir
  ];
  const fora = [
    "2026-08-07T17:59", // sexta, um minuto antes
    "2026-08-10T08:00", // segunda, no minuto da virada
    "2026-08-10T14:00", // segunda à tarde
    "2026-08-05T10:00", // quarta
  ];
  for (const iso of dentro) assert.equal(isWeekendDuty(LEVERADS, brt(iso)), true, `esperava plantão em ${iso}`);
  for (const iso of fora) assert.equal(isWeekendDuty(LEVERADS, brt(iso)), false, `não esperava plantão em ${iso}`);
});

test("na janela o número é o do plantonista; fora dela, vazio", () => {
  assert.equal(weekendDutyPhone(LEVERADS, brt("2026-08-08T10:00")), "5541995063622");
  assert.equal(weekendDutyPhone(LEVERADS, brt("2026-08-05T10:00")), "");
});

test("o número é normalizado pra dígitos (aceita como o Leo digitaria)", () => {
  const p = { weekendDuty: { enabled: true, phone: "+55 (41) 99506-3622" } };
  assert.equal(weekendDutyPhone(p, brt("2026-08-08T10:00")), "5541995063622");
});

test("o silêncio da saudação automática acompanha a janela, e é desligável", () => {
  assert.equal(isAutoSilenced(LEVERADS, brt("2026-08-08T10:00")), true);
  assert.equal(isAutoSilenced(LEVERADS, brt("2026-08-05T10:00")), false);
  const falante = { weekendDuty: { ...LEVERADS.weekendDuty, silenceAuto: false } };
  assert.equal(isWeekendDuty(falante, brt("2026-08-08T10:00")), true);
  assert.equal(isAutoSilenced(falante, brt("2026-08-08T10:00")), false);
});

test("janela custom que NÃO atravessa o domingo (ex.: só o sábado)", () => {
  const p = { weekendDuty: { enabled: true, phone: "5541999999999", fromDow: 6, fromHour: 0, toDow: 6, toHour: 12 } };
  assert.equal(isWeekendDuty(p, brt("2026-08-08T06:00")), true);  // sábado de manhã
  assert.equal(isWeekendDuty(p, brt("2026-08-08T13:00")), false); // sábado à tarde
  assert.equal(isWeekendDuty(p, brt("2026-08-09T06:00")), false); // domingo
});

test("meia hora é respeitada (fromHour fracionário)", () => {
  const p = { weekendDuty: { enabled: true, phone: "5541999999999", fromHour: 17.5 } };
  assert.equal(isWeekendDuty(p, brt("2026-08-07T17:29")), false);
  assert.equal(isWeekendDuty(p, brt("2026-08-07T17:30")), true);
});

test("janela vazia (início igual ao fim) não liga o plantão a semana toda", () => {
  const p = { weekendDuty: { enabled: true, phone: "5541999999999", fromDow: 5, fromHour: 18, toDow: 5, toHour: 18 } };
  assert.equal(isWeekendDuty(p, brt("2026-08-08T10:00")), false);
  assert.equal(isWeekendDuty(p, brt("2026-08-05T10:00")), false);
});
