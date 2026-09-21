import assert from 'node:assert/strict';
import { reviewHarness } from './harness.mjs';
const h = await reviewHarness('today', 'Minhas atividades');
try {
  for (const width of [1440, 390]) {
    const page = await h.open(width, '&followup');
    await page.getByRole('textbox', {name:'Buscar na fila'}).fill('Carla');
    await page.locator('.today-open-script').first().click();
    const actions = page.locator('.today-destinations');
    assert.equal(await actions.getByRole('button', {name:/Dia \d/}).count(), 0);
    assert.equal(await actions.getByRole('button', {name:/Follow-up feito/}).count(), 0);
    await actions.getByRole('button', {name:'Follow-up',exact:true}).click();
    assert.deepEqual(await page.evaluate(() => window.__reviewMutations), []);
    const date = actions.getByLabel('Data de retorno');
    await date.fill('2026-09-25T14:30');
    await actions.getByRole('button', {name:'cancelar',exact:true}).click();
    assert.deepEqual(await page.evaluate(() => window.__reviewMutations), []);
    await actions.getByRole('button', {name:'Follow-up',exact:true}).click();
    await date.fill('');
    assert.equal(await actions.getByRole('button', {name:'agendar retorno →',exact:true}).isDisabled(), true);
    await date.fill('2026-09-25T14:30');
    await h.capture(page, `followup-return-${width}`);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await actions.getByRole('button', {name:'agendar retorno →',exact:true}).click();
    await page.waitForFunction(() => window.__reviewMutations.some(m => m.method === 'update' && m.patch.nextActionAt));
    const mutations = await page.evaluate(() => window.__reviewMutations);
    assert.equal(mutations.filter(m => m.method === 'logActivity').length, 1);
    assert.ok(mutations.some(m => m.method === 'update' && m.id === 'l5' && m.patch.nextActionAt === '2026-09-25T17:30:00.000Z'));
    assert.equal(await page.evaluate(() => window.SEED.LEADS.find(l => l.id === 'l5').stage), 'Follow-up');
    await page.close();
  }
  assert.deepEqual(h.errors, []);
  console.log('Follow-up: sem dias, seletor sem gravação imediata, cancelar, data obrigatória e retorno salvo no fuso correto; desktop e mobile aprovados.');
} finally { await h.close(); }
