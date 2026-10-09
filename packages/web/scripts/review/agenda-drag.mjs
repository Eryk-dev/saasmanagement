import assert from 'node:assert/strict';
import { reviewHarness } from './harness.mjs';

// Arrastar na Agenda (Dia): call muda de hora e de closer pela coluna,
// destino inválido fica vermelho com o motivo e não grava, o balão de
// confirmação (nunca o diálogo nativo) cancela sem gravar, call passada não
// arrasta, bloqueio pontual muda de hora direto e o recorrente pergunta.
// Cursor de arrastar só no que remarca. Relógio da prévia: sexta 18/09/2026 15:00.
const h = await reviewHarness('agenda', 'Agenda', async () => {});
const H0 = 7, HOUR = 44;
const card = (p, name) => p.locator(`.agenda-day-col [role=button][title*="${name}"]`).first();
const mutations = (p) => p.evaluate(() => window.__reviewMutations);
const ask = (p) => p.getByRole('dialog', { name: 'Confirmar remarcação', exact: true });
async function point(p, person, hour) {
  const col = await p.locator('.agenda-day-col').first().boundingBox();
  const lane = await p.locator(`.agenda-calendar div.mono[title="${person}"]`).first().boundingBox();
  return { x: lane.x + lane.width / 2, y: col.y + (hour - H0) * HOUR + 6 };
}
// Pega o card 6px abaixo do topo e solta com o topo na hora pedida.
// `expect` espera o destino redesenhar com aquele texto antes de soltar.
async function drag(p, source, person, hour, expect, shot) {
  await p.locator('.agenda-day-col').first().evaluate((el) => el.scrollIntoView({ block: 'start' }));
  const box = await source.boundingBox();
  await p.mouse.move(box.x + 12, box.y + 6);
  await p.mouse.down();
  // O primeiro movimento só inicia o arrasto; o último repete o ponto pra
  // garantir um dragover no destino.
  await p.mouse.move(box.x + 20, box.y + 10);
  const to = await point(p, person, hour);
  await p.mouse.move(to.x, to.y, { steps: 8 });
  await p.mouse.move(to.x + 1, to.y);
  if (expect) await p.locator('.agenda-drop-hint', { hasText: expect }).waitFor();
  if (shot) await h.capture(p, shot);
  const hint = (await p.locator('.agenda-drop-hint').textContent()) || '';
  await p.mouse.up();
  return hint;
}

try {
  const p = await h.open(1440);
  // O arrasto nunca usa o diálogo nativo do navegador.
  p.on('dialog', (d) => { h.errors.push(`diálogo nativo: ${d.message()}`); d.dismiss(); });

  // Call passada é história: não arrasta.
  assert.equal(await card(p, 'Helena Vitta').getAttribute('draggable'), null);
  assert.equal(await card(p, 'Caio Menezes').getAttribute('draggable'), 'true');
  // Mãozinha de arrastar só no que remarca; o resto segue com o ponteiro.
  assert.equal(await card(p, 'Caio Menezes').evaluate((el) => getComputedStyle(el).cursor), 'grab');
  assert.equal(await card(p, 'Helena Vitta').evaluate((el) => getComputedStyle(el).cursor), 'pointer');
  assert.equal(await p.locator('.agenda-block', { hasText: 'almoço' }).first().evaluate((el) => getComputedStyle(el).cursor), 'grab');

  // Horário que já passou: destino vermelho, nada grava.
  let hint = await drag(p, card(p, 'Caio Menezes'), 'Bruno Alencar', 10, /já passou/);
  assert.match(hint, /já passou/);
  assert.equal((await mutations(p)).length, 0);

  // Integrador não recebe call.
  hint = await drag(p, card(p, 'Caio Menezes'), 'Vitor Nunes', 18, /não é closer/, 'drag-invalid');
  assert.match(hint, /não é closer/);
  assert.equal((await mutations(p)).length, 0);

  // Balão ancorado no destino; Cancelar não grava e Esc também fecha.
  hint = await drag(p, card(p, 'Caio Menezes'), 'Rafael Moura', 18, /^18:00 · Rafael/, 'drag-valid');
  assert.match(hint, /^18:00 · Rafael/);
  await ask(p).waitFor();
  const dest = await p.locator('.agenda-drop-hint[data-pending]').boundingBox();
  const balloon = await ask(p).boundingBox();
  assert.ok(Math.abs(balloon.y - (dest.y + dest.height)) <= 12 || Math.abs(balloon.y + balloon.height - dest.y) <= 12, 'balão encostado no destino');
  await h.capture(p, 'drag-ask');
  await ask(p).getByRole('button', { name: 'Cancelar', exact: true }).click();
  await ask(p).waitFor({ state: 'hidden' });
  assert.equal(await p.locator('.agenda-drop-hint').count(), 0);
  await drag(p, card(p, 'Caio Menezes'), 'Rafael Moura', 18, /^18:00 · Rafael/);
  await ask(p).waitFor(); await p.keyboard.press('Escape'); await ask(p).waitFor({ state: 'hidden' });
  assert.equal((await mutations(p)).length, 0);

  // Aceita: muda horário e closer, e a confirmação volta a ficar pendente.
  await drag(p, card(p, 'Caio Menezes'), 'Rafael Moura', 18, /^18:00 · Rafael/);
  await ask(p).getByText('Remarcar a call de Caio Menezes?').waitFor();
  assert.match(await ask(p).textContent(), /18:00 · com Rafael Moura/);
  await ask(p).getByRole('button', { name: 'Remarcar', exact: true }).click();
  await p.getByText('Call remarcada.').waitFor();
  let [m] = await mutations(p);
  assert.equal(m.col, 'leads');
  assert.deepEqual(m.data, { callAt: '2026-09-18T18:00', callConfirmed: false, closer: 'rm' });
  const moved = await card(p, 'Caio Menezes').boundingBox();
  const target = await point(p, 'Rafael Moura', 18);
  assert.ok(Math.abs(moved.y - (target.y - 6)) <= 4 && moved.x < target.x && moved.x + moved.width > target.x, 'card redesenhado na coluna e hora novas');

  // Ocupado: a call da Marina em cima da que o Caio acabou de ganhar.
  hint = await drag(p, p.locator('.agenda-day-col [draggable=true][title*="Marina Kern"]'), 'Rafael Moura', 18.5, /agenda ocupada/);
  assert.match(hint, /Rafael: agenda ocupada/);
  assert.equal((await mutations(p)).length, 1);

  // Integração muda de hora na mesma coluna, sem trocar o integrador.
  await drag(p, card(p, 'Tatiana Ponto'), 'Vitor Nunes', 19.5, /^19:30/);
  await ask(p).getByRole('button', { name: 'Remarcar', exact: true }).click();
  await p.getByText('Integração remarcada.').waitFor();
  assert.deepEqual((await mutations(p))[1].data, { integrationAt: '2026-09-18T19:30', integrationConfirmed: false });

  // Bloqueio muda de hora sem confirmação (não avisa ninguém de fora).
  await drag(p, p.locator('.agenda-block', { hasText: 'almoço' }).first(), 'Vitor Nunes', 18, /^18:00/);
  await p.getByText('Compromisso movido.').waitFor();
  m = (await mutations(p))[2];
  assert.equal(m.col, 'agenda_blocks');
  assert.equal(m.id, 'lunch');
  assert.equal(m.data.fromHour, 18);
  assert.equal(m.data.toHour, 19);
  assert.deepEqual(m.data.users, ['vn']);

  // Bloqueio em cima da integração do Vitor: mesma conferência do modal.
  hint = await drag(p, p.locator('.agenda-block', { hasText: 'almoço' }).first(), 'Vitor Nunes', 19.5, /já tem integração/);
  assert.equal((await mutations(p)).length, 3);

  // Recorrente: o balão avisa que muda todas as semanas.
  await drag(p, p.locator('.agenda-block', { hasText: 'MELI' }).first(), 'Rafael Moura', 20, /^20:00/);
  await ask(p).getByText('em todas as semanas?').waitFor();
  assert.match(await ask(p).textContent(), /toda sexta · 20:00 às 21:00/);
  await ask(p).getByRole('button', { name: 'Mover', exact: true }).click();
  await p.getByText('Compromisso movido.').waitFor();
  m = (await mutations(p))[3];
  assert.equal(m.id, 'meli');
  assert.equal(m.data.weekday, 5);
  assert.equal(m.data.fromHour, 20);

  await h.capture(p, 'drag-after');
  await p.close();
  assert.deepEqual(h.errors, []);
  console.log('Agenda: arrastar remarca call (hora e closer), recusa passado/papel/ocupado, confirma no balão (sem diálogo nativo), move bloqueio e recorrente, cursor de arrastar OK.');
} finally { await h.close(); }
