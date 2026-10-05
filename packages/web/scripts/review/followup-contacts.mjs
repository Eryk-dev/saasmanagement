import assert from 'node:assert/strict';
import { reviewHarness } from './harness.mjs';
// Follow-up em 4 contatos, por DIA (05/10/2026): o painel mostra o contato da
// vez com a mensagem configurada; registrar grava UM toque com
// meta.followupContact (sem PATCH: o servidor marca o próximo dia); não há
// "retomar" com hora; e entrar no follow-up pede só o DIA do Contato 1.
const h = await reviewHarness('today', 'Minhas atividades');
async function openLead(width, name) {
  const page = await h.open(width, '&followup');
  await page.getByRole('textbox', {name:'Buscar na fila'}).fill(name);
  await page.locator('.today-open-script').first().click();
  return page;
}
try {
  for (const width of [1440, 390]) {
    const page = await openLead(width, 'Carla');
    const block = page.locator('.today-followup-contact');
    await block.getByRole('heading', {name:'FOLLOW-UP Contato 2 de 4'}).waitFor();
    // A linha da fila continua dizendo que é follow-up.
    assert.equal(await page.locator('.today-queue-lead', {hasText:'Carla Nunes'}).locator('.today-queue-action').first().textContent(), 'follow-up · contato 2 de 4');
    assert.ok((await block.textContent()).includes('Objeção respondida com prova'));
    const actions = page.locator('.today-destinations');
    assert.equal(await actions.getByRole('button', {name:/Dia \d/}).count(), 0);
    assert.equal(await actions.getByRole('button', {name:'Follow-up', exact:true}).count(), 0, 'sem chip de retomar no follow-up');
    assert.deepEqual(await page.evaluate(() => window.__reviewMutations), []);
    // Mudar o dia e desistir não grava nada.
    await block.getByRole('button', {name:'mudar o dia'}).click();
    await block.getByRole('group', {name:'Dia do contato 2'}).waitFor();
    await block.getByRole('button', {name:'cancelar', exact:true}).click();
    assert.deepEqual(await page.evaluate(() => window.__reviewMutations), []);
    await block.getByRole('radio', {name:'Ligação'}).click();
    await block.getByLabel('Nota (opcional)').fill('não atendeu, deixei recado');
    await block.scrollIntoViewIfNeeded();
    await h.capture(page, `followup-contact-${width}`);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await block.getByRole('button', {name:'Registrar contato 2'}).click();
    await page.waitForFunction(() => window.__reviewMutations.some(m => m.method === 'logActivity'));
    const mutations = await page.evaluate(() => window.__reviewMutations);
    const logs = mutations.filter(m => m.method === 'logActivity');
    assert.equal(logs.length, 1);
    assert.equal(logs[0].data.lead, 'l5');
    assert.equal(logs[0].data.type, 'call');
    assert.equal(logs[0].data.meta.followupContact, 2);
    assert.equal(logs[0].data.text, 'não atendeu, deixei recado');
    assert.equal(mutations.filter(m => m.method === 'update').length, 0, 'registrar não faz PATCH');
    await page.close();
  }
  // Call → Follow-up: só o DIA do Contato 1, sem grade de horário.
  for (const width of [1440, 390]) {
    const page = await openLead(width, 'Bruno');
    const actions = page.locator('.today-destinations');
    await actions.getByRole('button', {name:/^Follow-up/}).first().click();
    const picker = page.getByRole('group', {name:'Dia do contato 1'});
    await picker.waitFor();
    assert.equal(await page.getByRole('button', {name:'09:00', exact:true}).count(), 0, 'follow-up não oferece horário');
    await page.getByRole('radio', {name:'não chegou na proposta'}).click();
    await picker.getByRole('button').nth(2).click();
    await h.capture(page, `followup-day-${width}`);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.getByRole('button', {name:'agendar follow-up →'}).click();
    await page.waitForFunction(() => window.__reviewMutations.some(m => m.method === 'update'));
    const upd = (await page.evaluate(() => window.__reviewMutations)).find(m => m.method === 'update');
    assert.equal(upd.id, 'l2');
    assert.equal(upd.patch.stage, 'Follow-up');
    assert.match(upd.patch.followupAt, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(upd.patch.nextActionAt, undefined, 'o GPS sai do dia no servidor');
    assert.equal(upd.patch.callAt, undefined);
    await page.close();
  }
  // Atraso: o card inteiro fica vermelho (inclusive o follow-up com o dia do
  // contato vencido) e a faixa de alerta conta os atrasados.
  for (const width of [1440, 390]) {
    const page = await h.open(width, '&followup&fupLate');
    const alert = page.locator('.today-late-alert');
    await alert.waitFor();
    assert.match(await alert.textContent(), /atividades? atrasadas?/);
    assert.match(await alert.textContent(), /1 follow-up com o contato vencido/);
    const carla = page.locator('.today-queue-row', {hasText:'Carla Nunes'});
    assert.ok(await carla.evaluate((e) => e.classList.contains('is-late')));
    const bg = await carla.evaluate((e) => getComputedStyle(e).backgroundColor);
    const neg = await page.evaluate(() => { const d = document.createElement('div'); d.style.color = 'var(--neg)'; document.body.append(d); const c = getComputedStyle(d).color; d.remove(); return c; });
    assert.equal(bg, neg, 'card atrasado pintado inteiro de vermelho');
    await page.close();
  }
  {
    const page = await h.open(1440, '&followup');
    assert.equal(await page.locator('.today-queue-row.is-late', {hasText:'Carla Nunes'}).count(), 0, 'follow-up do dia não é atraso');
    await page.close();
  }
  // Nos detalhes, o follow-up atrasado ganha a faixa vermelha no topo do bloco.
  for (const width of [1440, 390]) {
    const page = await openLead(width, 'Carla');
    assert.equal(await page.locator('.today-followup-late').count(), 0, 'contato do dia sem faixa de atraso');
    await page.close();
    const late = await h.open(width, '&followup&fupLate');
    await late.getByRole('textbox', {name:'Buscar na fila'}).fill('Carla');
    await late.locator('.today-open-script').first().click();
    const strip = late.locator('.today-followup-late');
    await strip.waitFor();
    assert.match(await strip.textContent(), /Follow-up atrasado 1 dia/);
    assert.match(await strip.textContent(), /o contato 2 era para qui, 17\/09/);
    const bg = await strip.evaluate((e) => getComputedStyle(e).backgroundColor);
    assert.notEqual(bg, 'rgba(0, 0, 0, 0)', 'faixa pintada também no modal do celular');
    await late.locator('.today-followup-contact').screenshot({ path: `${h.output}/followup-late-block-${width}.png` });
    await late.close();
  }
  for (const width of [1440, 390]) {
    const page = await h.open(width, '&followup&fupLate');
    await page.locator('.today-late-alert').waitFor();
    await h.capture(page, `late-${width}`);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.close();
  }
  assert.deepEqual(h.errors, []);
  console.log('Follow-up: contato da vez com mensagem, sem retomar, mudar dia sem gravar, registro com canal/nota, dia do Contato 1 sem horário e atraso em vermelho com alerta; desktop e mobile aprovados.');
} finally { await h.close(); }
