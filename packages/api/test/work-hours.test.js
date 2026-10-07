import test from "node:test";
import assert from "node:assert/strict";
import { sanitizeWorkHours, offWorkHours, workHoursSummary } from "../src/shared/work-hours.js";

// Horário de atendimento (Ajustes → Equipe → ⋯): users.workHours.
// 07/10/2026 é quarta-feira; 10/10 é sábado.

test("sanitizeWorkHours: descarta faixa inválida, arredonda pra meia hora e junta as que se encostam", () => {
  assert.deepEqual(sanitizeWorkHours(null), []);
  assert.deepEqual(sanitizeWorkHours([
    { weekday: 3, from: 14, to: 18 },
    { weekday: 3, from: 9, to: 12 },
    { weekday: 3, from: 11.9, to: 14 },  // 11.9 → 12: encosta nas duas e vira uma faixa só
    { weekday: 1, from: 9.25, to: 9.5 }, // 9.25 → 9.5: início = fim, sai
    { weekday: 7, from: 9, to: 12 },     // dia inexistente
    { weekday: 2, from: 18, to: 9 },     // termina antes de começar
    { weekday: 2, from: 8, to: 25 },     // passa de 24h
  ]), [{ weekday: 3, from: 9, to: 18 }]);
});

test("offWorkHours: sem horário nada fica fora; com horário a meia hora precisa caber inteira numa faixa", () => {
  assert.equal(offWorkHours([], "2026-10-07-07-00"), false);
  const wh = [{ weekday: 3, from: 9, to: 12 }, { weekday: 3, from: 14, to: 18.5 }];
  assert.equal(offWorkHours(wh, "2026-10-07-08-30"), true);
  assert.equal(offWorkHours(wh, "2026-10-07-09-00"), false);
  assert.equal(offWorkHours(wh, "2026-10-07-11-30"), false);
  assert.equal(offWorkHours(wh, "2026-10-07-12-00"), true, "almoço");
  assert.equal(offWorkHours(wh, "2026-10-07-18-00"), false);
  assert.equal(offWorkHours(wh, "2026-10-07-18-30"), true);
  assert.equal(offWorkHours(wh, "2026-10-08-10-00"), true, "quinta não atende");
});

test("workHoursSummary agrupa dias com as mesmas faixas", () => {
  const weekdays = [1, 2, 3, 4, 5].flatMap((weekday) => [{ weekday, from: 9, to: 12 }, { weekday, from: 13.5, to: 18 }]);
  assert.equal(workHoursSummary(weekdays), "seg–sex 09:00–12:00, 13:30–18:00");
  assert.equal(workHoursSummary([...weekdays, { weekday: 6, from: 9, to: 12 }]),
    "seg–sex 09:00–12:00, 13:30–18:00 · sáb 09:00–12:00");
  assert.equal(workHoursSummary([{ weekday: 1, from: 9, to: 12 }, { weekday: 3, from: 9, to: 12 }]), "seg, qua 09:00–12:00");
  assert.equal(workHoursSummary([]), "");
});
