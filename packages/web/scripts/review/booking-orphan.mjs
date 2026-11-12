import assert from 'node:assert/strict';
import { reviewHarness } from './harness.mjs';
// Marcação pelo link de convite sem card (07/10/2026): o aviso do sino abre a
// escolha do card (cards em Integração de quem recebeu, "aguardando marcar"
// primeiro) e "ligar" chama a API com o evento, a dona da agenda e o card.
// Dados: ?closing&orphan (preview/today-mock.js).
const h = await reviewHarness('today', 'Minhas atividades');
try {
  for (const width of [1440, 390]) {
    const page = await h.open(width, '&closing&orphan');
    await page.getByRole('button', {name:/^Notificações/}).click();
    // 12/11/2026: a marcação fixa vem no topo, antes do aviso mais novo.
    const rows0 = await page.locator('.notification-item').allTextContents();
    assert.match(rows0[0], /não achei o card.*fixo até ligar/, 'marcação sem card no topo');
    // × discreto: limpa o aviso de tarefa, a marcação fica.
    await page.locator('.notification-row').nth(1).hover();
    await page.getByRole('button', {name:/^Limpar notificação: A tarefa "Revisar proposta"/}).click();
    await page.waitForFunction(() => document.querySelectorAll('.notification-item').length === 1);
    assert.deepEqual(await page.evaluate(() => window.__reviewMutations.find((x) => x.method === 'notificationsClear')), { method: 'notificationsClear', ids: ['no_task'] });
    await h.capture(page, `booking-orphan-sino-${width}`);
    await page.getByRole('button', {name:/^Rita M\. marcou .*não achei o card/}).click();
    const dialog = page.getByRole('dialog', {name:'ligar marcação a um card'});
    await dialog.waitFor();
    const rows = await dialog.getByRole('listitem').allTextContents();
    assert.match(rows[0], /^Rita Moura.*aguardando marcar/, 'quem está aguardando marcar vem primeiro');
    assert.ok(rows.some((r) => /^Paulo Dias/.test(r)));
    await dialog.getByRole('searchbox', {name:'Buscar card'}).fill('dias pneus');
    assert.equal(await dialog.getByRole('listitem').count(), 1, 'busca filtra');
    await dialog.getByRole('searchbox', {name:'Buscar card'}).fill('');
    await h.capture(page, `booking-orphan-${width}`);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await dialog.getByRole('button', {name:'Ligar a Rita Moura'}).click();
    await dialog.waitFor({state:'hidden'});
    const m = await page.evaluate(() => window.__reviewMutations.find((x) => x.method === 'linkBooking'));
    assert.deepEqual(m, { method: 'linkBooking', eventId: 'ev_orf', body: { user: 'eryk', leadId: 'orf-rita' } });
    await page.close();
  }
  assert.deepEqual(h.errors, []);
  console.log('Marcação sem card: fixa no topo do sino, × limpa outro aviso, o aviso abre a escolha do card, aguardando primeiro, busca e ligar com o evento; desktop e mobile aprovados.');
} finally { await h.close(); }
