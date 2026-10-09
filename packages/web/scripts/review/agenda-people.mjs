import assert from 'node:assert/strict';
import { reviewHarness } from './harness.mjs';

// Filtro "Agenda de" com várias pessoas: um seletor múltiplo (nunca pílulas
// por pessoa nem <select> nativo), a grade mostra só as faixas, eventos e
// bloqueios de quem está marcado, "todos" (primeira linha da lista) limpa, a
// escolha fica salva por pessoa e produto, a escolha antiga de uma pessoa vira
// a lista e a equipe grande cabe na barra sem quebrar linha. O tipo de evento também abre a lista do cockpit.
const h = await reviewHarness('agenda', 'Agenda', async () => {});
const bar = (p) => p.locator('.agenda-toolbar');
const trigger = (p) => bar(p).getByRole('button', { name: /^Agenda de:/ });
const picker = (p) => p.getByRole('dialog', { name: 'Agenda de', exact: true });
const option = (p, name) => picker(p).getByRole('option', { name: new RegExp(name) });
const lanes = (p) => p.locator('.agenda-calendar div.mono[title]').evaluateAll((els) => els.map((e) => e.title));
const visible = (p, text) => p.locator('.agenda-day-col [role=button]', { hasText: text }).count();
// A escolha fica por pessoa e produto: uma chave só, com o id de quem usa.
const saved = (p) => p.evaluate(() => {
  const keys = Object.keys(localStorage).filter((k) => k.startsWith('cockpit_agenda_people:'));
  if (keys.length !== 1 || !/^cockpit_agenda_people:[^:]+:leverads$/.test(keys[0])) return { keys };
  return JSON.parse(localStorage.getItem(keys[0]));
});
const close = async (p) => { await p.keyboard.press('Escape'); await picker(p).waitFor({ state: 'hidden' }); };

try {
  const p = await h.open(1440);
  assert.equal(await bar(p).locator('select').count(), 0, 'a barra não usa <select> nativo');
  assert.equal(await trigger(p).getAttribute('aria-label'), 'Agenda de: todos');
  assert.deepEqual(await lanes(p), ['Rafael Moura', 'Bruno Alencar', 'Vitor Nunes']);

  // Só o Bruno: a faixa dele, a call dele, nada do Rafael nem do Vitor.
  await trigger(p).click();
  await option(p, 'Bruno Alencar').click();
  assert.equal(await option(p, 'Bruno Alencar').getAttribute('aria-selected'), 'true');
  assert.deepEqual(await lanes(p), ['Bruno Alencar']);
  assert.equal(await visible(p, 'Caio Menezes'), 1);
  assert.equal(await visible(p, 'Helena Vitta'), 0);
  assert.equal(await p.locator('.agenda-block', { hasText: 'almoço' }).count(), 0);
  assert.deepEqual(await saved(p), ['ba']);

  // Mais o Vitor (a lista fica aberta pra marcar vários): duas faixas.
  await option(p, 'Vitor Nunes').click();
  await h.capture(p, 'people-picker');
  await close(p);
  assert.equal(await trigger(p).getAttribute('aria-label'), 'Agenda de: Bruno, Vitor');
  assert.deepEqual(await lanes(p), ['Bruno Alencar', 'Vitor Nunes']);
  assert.equal(await p.locator('.agenda-block', { hasText: 'almoço' }).count(), 1);
  assert.equal(await visible(p, 'Tatiana Ponto'), 1);
  assert.equal(await visible(p, 'Helena Vitta'), 0);
  await h.capture(p, 'people-two');

  // Semana respeita o mesmo filtro.
  await bar(p).getByRole('button', { name: 'Semana', exact: true }).click();
  assert.equal(await visible(p, 'Helena Vitta'), 0);
  assert.equal(await visible(p, 'Caio Menezes'), 1);
  await bar(p).getByRole('button', { name: 'Dia', exact: true }).click();

  // Desmarcar na lista tira a pessoa; "todos" volta pra equipe inteira.
  await trigger(p).click();
  assert.equal(await option(p, '^todos').getAttribute('aria-selected'), 'false');
  await option(p, 'Vitor Nunes').click();
  assert.deepEqual(await saved(p), ['ba']);
  await option(p, '^todos').click();
  assert.equal(await option(p, '^todos').getAttribute('aria-selected'), 'true');
  assert.equal(await option(p, 'Bruno Alencar').getAttribute('aria-selected'), 'false');
  await close(p);
  assert.equal(await trigger(p).getAttribute('aria-label'), 'Agenda de: todos');
  assert.deepEqual(await saved(p), []);

  // Tipo de evento pela lista do cockpit.
  await bar(p).getByRole('button', { name: /^Tipo de evento: todos os tipos/ }).click();
  await p.getByRole('option', { name: /^integrações/ }).click();
  assert.equal(await visible(p, 'Caio Menezes'), 0);
  assert.equal(await visible(p, 'Tatiana Ponto'), 1);
  await bar(p).getByRole('button', { name: /^Tipo de evento: integrações/ }).waitFor();
  await p.close();

  // A escolha antiga de uma pessoa (cockpit_agenda_person) vira a lista.
  const legacy = await h.open(1440, '&legacyPerson');
  assert.equal(await trigger(legacy).getAttribute('aria-label'), 'Agenda de: Bruno');
  assert.deepEqual(await lanes(legacy), ['Bruno Alencar']);
  await legacy.close();

  // Equipe grande: o mesmo seletor, a barra não cresce; três ou mais viram
  // "N pessoas".
  const big = await h.open(1440, '&bigTeam');
  const before = (await bar(big).boundingBox()).height;
  await trigger(big).click();
  for (const n of ['Rafael Moura', 'Lucas Souza', 'Vitor Nunes']) await option(big, n).click();
  await close(big);
  assert.equal(await trigger(big).getAttribute('aria-label'), 'Agenda de: 3 pessoas');
  assert.deepEqual(await lanes(big), ['Rafael Moura', 'Lucas Souza', 'Vitor Nunes']);
  await h.capture(big, 'people-big');
  assert.equal((await bar(big).boundingBox()).height, before, 'a barra não cresce com a equipe');
  await big.close();

  // Celular e tema escuro: sem rolagem lateral com o filtro ligado.
  for (const [width, q] of [[390, ''], [1440, '&theme=dark']]) {
    const page = await h.open(width, q);
    await trigger(page).click();
    await option(page, 'Bruno Alencar').click();
    await close(page);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await h.capture(page, `people-${width}${q ? '-dark' : ''}`);
    await page.close();
  }

  assert.deepEqual(h.errors, []);
  console.log('Agenda: seletor múltiplo de pessoas (grade, semana, todos, por pessoa e produto, legado, equipe grande, celular, escuro) e tipo de evento sem select nativo OK.');
} finally { await h.close(); }
