import test from "node:test";
import assert from "node:assert/strict";
import { dutyConfig, isDutyTime, dutyPhone, isAutoSilenced } from "../src/off-hours-duty.js";

// Horários escritos no relógio de Brasília (UTC-3), que é o fuso do negócio.
// Em ago/2026: 03=seg … 07=sex, 08=sáb, 09=dom, 10=seg.
const brt = (iso) => new Date(`${iso}-03:00`);

const LEVERADS = { duty: { enabled: true, phone: "5541995063622" } };

test("sem config, nada de plantão: o produto segue como sempre foi", () => {
  assert.equal(dutyConfig({}), null);
  assert.equal(isDutyTime({}, brt("2026-08-08T10:00")), false);
  assert.equal(dutyPhone({}, brt("2026-08-08T10:00")), "");
  assert.equal(isAutoSilenced({}, brt("2026-08-08T10:00")), false);
});

test("config sem número não vira janela (não há pra onde mandar o lead)", () => {
  assert.equal(dutyConfig({ duty: { enabled: true } }), null);
  assert.equal(isDutyTime({ duty: { enabled: true } }, brt("2026-08-08T10:00")), false);
});

test("o plantão é o negativo do expediente: vale à noite de dia útil", () => {
  const fora = [
    "2026-08-05T18:00", // quarta, no minuto em que o time sai
    "2026-08-05T22:00", // quarta à noite
    "2026-08-06T03:00", // madrugada de quinta
    "2026-08-06T07:59", // quinta, um minuto antes de o time voltar
  ];
  const dentro = [
    "2026-08-05T08:00", // quarta, no minuto em que o time entra
    "2026-08-05T12:00", // quarta ao meio-dia
    "2026-08-05T17:59", // quarta, um minuto antes de sair
  ];
  for (const iso of fora) assert.equal(isDutyTime(LEVERADS, brt(iso)), true, `esperava plantão em ${iso}`);
  for (const iso of dentro) assert.equal(isDutyTime(LEVERADS, brt(iso)), false, `não esperava plantão em ${iso}`);
});

test("e cobre o fim de semana inteiro, de sexta 18h a segunda 8h", () => {
  const fora = [
    "2026-08-07T18:00", // sexta, saindo
    "2026-08-08T10:00", // sábado
    "2026-08-09T22:00", // domingo à noite
    "2026-08-10T07:59", // segunda, um minuto antes de abrir
  ];
  for (const iso of fora) assert.equal(isDutyTime(LEVERADS, brt(iso)), true, `esperava plantão em ${iso}`);
  assert.equal(isDutyTime(LEVERADS, brt("2026-08-07T17:59")), false, "sexta ainda no expediente");
  assert.equal(isDutyTime(LEVERADS, brt("2026-08-10T08:00")), false, "segunda, time de volta");
});

test("o plantão acompanha o expediente do produto (waCallFlow), sem segunda cópia do horário", () => {
  // Time que trabalha das 9h às 17h: o plantão começa às 17h, não às 18h.
  const p = { ...LEVERADS, waCallFlow: { hourStart: 9, hourEnd: 17 } };
  assert.equal(isDutyTime(p, brt("2026-08-05T08:30")), true,  "8h30 ainda é plantão pra quem entra às 9");
  assert.equal(isDutyTime(p, brt("2026-08-05T09:30")), false, "9h30 é expediente");
  assert.equal(isDutyTime(p, brt("2026-08-05T17:30")), true,  "17h30 já é plantão pra quem sai às 17");
});

test("plantão com jornada PRÓPRIA vence a do expediente", () => {
  const p = { duty: { enabled: true, phone: "5541999999999", hourStart: 10, hourEnd: 16 }, waCallFlow: { hourStart: 8, hourEnd: 18 } };
  assert.equal(isDutyTime(p, brt("2026-08-05T09:00")), true,  "antes das 10 o plantonista atende");
  assert.equal(isDutyTime(p, brt("2026-08-05T12:00")), false);
  assert.equal(isDutyTime(p, brt("2026-08-05T17:00")), true,  "depois das 16 também");
});

test("na janela o número é o do plantonista; no expediente, vazio", () => {
  assert.equal(dutyPhone(LEVERADS, brt("2026-08-05T22:00")), "5541995063622");
  assert.equal(dutyPhone(LEVERADS, brt("2026-08-08T10:00")), "5541995063622");
  assert.equal(dutyPhone(LEVERADS, brt("2026-08-05T10:00")), "");
});

test("o número é normalizado pra dígitos (aceita como o Leo digitaria)", () => {
  const p = { duty: { enabled: true, phone: "+55 (41) 99506-3622" } };
  assert.equal(dutyPhone(p, brt("2026-08-08T10:00")), "5541995063622");
});

test("o silêncio da saudação automática acompanha a janela, e é desligável", () => {
  assert.equal(isAutoSilenced(LEVERADS, brt("2026-08-05T22:00")), true);
  assert.equal(isAutoSilenced(LEVERADS, brt("2026-08-05T10:00")), false);
  const falante = { duty: { ...LEVERADS.duty, silenceAuto: false } };
  assert.equal(isDutyTime(falante, brt("2026-08-05T22:00")), true);
  assert.equal(isAutoSilenced(falante, brt("2026-08-05T22:00")), false);
});
