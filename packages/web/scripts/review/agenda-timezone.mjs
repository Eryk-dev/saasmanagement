import assert from 'node:assert/strict';
import { reviewHarness } from './harness.mjs';

// A Agenda segue o relógio de BRASÍLIA qualquer que seja o fuso do navegador:
// o mesmo instante (sexta 18/09/2026 15:00 de Brasília) aberto em São Paulo,
// Tóquio (já é sábado 03:00) e Los Angeles (sexta 11:00) mostra o mesmo dia,
// as mesmas horas nas pílulas e na posição da grade, a linha do agora às 15h,
// recusa o horário que já passou em Brasília, abre o "Criar compromisso" no
// dia certo e grava o arrasto em hora de Brasília.
const h = await reviewHarness('agenda', 'Agenda', async () => {});
const H0 = 7, HOUR = 44;
const ZONES = ['America/Sao_Paulo', 'Asia/Tokyo', 'America/Los_Angeles'];
const card = (p, name) => p.locator(`.agenda-day-col [role=button][title*="${name}"]`).first();
const ask = (p) => p.getByRole('dialog', { name: 'Confirmar remarcação', exact: true });
async function point(p, person, hour) {
  const col = await p.locator('.agenda-day-col').first().boundingBox();
  const lane = await p.locator(`.agenda-calendar div.mono[title="${person}"]`).first().boundingBox();
  return { x: lane.x + lane.width / 2, y: col.y + (hour - H0) * HOUR + 6 };
}
async function drag(p, source, person, hour, expect) {
  await p.locator('.agenda-day-col').first().evaluate((el) => el.scrollIntoView({ block: 'start' }));
  const box = await source.boundingBox();
  await p.mouse.move(box.x + 12, box.y + 6);
  await p.mouse.down();
  await p.mouse.move(box.x + 20, box.y + 10);
  const to = await point(p, person, hour);
  await p.mouse.move(to.x, to.y, { steps: 8 });
  await p.mouse.move(to.x + 1, to.y);
  await p.locator('.agenda-drop-hint', { hasText: expect }).waitFor();
  await p.mouse.up();
}
// Distância do topo do elemento ao topo da coluna, em horas da grade.
const hourOf = async (p, loc) => {
  const col = await p.locator('.agenda-day-col').first().boundingBox();
  const b = await loc.boundingBox();
  return H0 + (b.y - col.y) / HOUR;
};

try {
  for (const timezoneId of ZONES) {
    const p = await h.open(1440, '', false, { timezoneId });
    const tag = timezoneId.split('/')[1];
    assert.ok(await p.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone) === timezoneId, `${tag}: navegador no fuso pedido`);

    // Dia e "hoje" de Brasília.
    await p.locator('.agenda-toolbar').getByText('sexta-feira, 18 de set de 2026', { exact: true }).waitFor();
    await p.locator('.agenda-calendar').getByText('hoje · sex', { exact: true }).waitFor();

    // Hora no rótulo e na posição: Caio 16:10, almoço 12h–13h, agora 15h.
    assert.match(await card(p, 'Caio Menezes').getAttribute('title'), /^16:10 · call/, `${tag}: rótulo da call`);
    assert.match(await card(p, 'Caio Menezes').textContent(), /16:10/);
    assert.ok(Math.abs(await hourOf(p, card(p, 'Caio Menezes')) - (16 + 10 / 60)) < 0.08, `${tag}: posição da call`);
    assert.ok(Math.abs(await hourOf(p, p.locator('.agenda-block', { hasText: 'almoço' }).first()) - 12) < 0.08, `${tag}: posição do bloqueio`);
    const now = p.locator('.agenda-day-col > div[style*="2px solid var(--accent)"]').first();
    assert.ok(Math.abs(await hourOf(p, now) - 15) < 0.08, `${tag}: linha do agora`);

    // O que passou é o que passou em Brasília (10h sim, 18h não).
    const caio = card(p, 'Caio Menezes');
    await drag(p, caio, 'Bruno Alencar', 10, /já passou/);
    await drag(p, caio, 'Rafael Moura', 18, /^18:00 · Rafael/);
    await ask(p).getByText('sex, 18/09, 18:00 · com Rafael Moura').waitFor();
    await ask(p).getByRole('button', { name: 'Remarcar', exact: true }).click();
    await p.getByText('Call remarcada.').waitFor();
    const [m] = await p.evaluate(() => window.__reviewMutations);
    assert.deepEqual(m.data, { callAt: '2026-09-18T18:00', callConfirmed: false, closer: 'rm' }, `${tag}: grava hora de Brasília`);
    assert.ok(Math.abs(await hourOf(p, card(p, 'Caio Menezes')) - 18) < 0.08, `${tag}: redesenha às 18h`);
    assert.match(await card(p, 'Caio Menezes').getAttribute('title'), /^18:00 · call/);

    // "Criar compromisso" abre no dia de Brasília.
    await p.getByRole('button', { name: 'Criar compromisso', exact: true }).click();
    const dialog = p.getByRole('dialog', { name: 'compromisso', exact: true });
    assert.equal(await dialog.getByLabel('Data', { exact: true }).inputValue(), '2026-09-18', `${tag}: data do novo compromisso`);
    await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();

    // Semana de segunda 14 a domingo 20, com o hoje na sexta.
    await p.locator('.agenda-toolbar').getByRole('button', { name: 'Semana', exact: true }).click();
    await p.locator('.agenda-toolbar').getByText(/^14 de set · 20 de set de 2026$/).waitFor();
    await p.locator('.agenda-calendar').getByText('hoje · sex', { exact: true }).waitFor();
    await h.capture(p, `timezone-${tag}`);
    await p.close();
  }
  assert.deepEqual(h.errors, []);
  console.log(`Agenda: relógio de Brasília em ${ZONES.join(', ')} (dia, hoje, horas, posição, agora, passado, arrasto, criar e semana) OK.`);
} finally { await h.close(); }
