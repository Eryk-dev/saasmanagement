import assert from 'node:assert/strict';
import { reviewHarness } from './harness.mjs';

// Pré-bloqueio da marcação pelo link sem card (12/11/2026): o horário que o
// cliente marcou aparece na Agenda de quem recebeu, não se arrasta, e clicar
// abre a escolha do card (a mesma do sino) com "liberar horário", que pede
// confirmação e tira o bloqueio. Dados: &bookingHold (preview/agenda-review-mock.js).
const h = await reviewHarness('agenda', 'Agenda', async () => {});
try {
  for (const width of [1440, 390]) {
    const p = await h.open(width, '&bookingHold');
    const hold = p.locator('.agenda-block', { hasText: 'Lukas marcou pelo link' }).first();
    await hold.waitFor();
    assert.equal(await hold.getAttribute('draggable'), null, 'a marcação do cliente não se arrasta');
    assert.match(await hold.getAttribute('title'), /clique pra ligar a um card/);
    await hold.click();
    const dialog = p.getByRole('dialog', { name: 'ligar marcação a um card' });
    await dialog.waitFor();
    assert.equal(await p.getByRole('dialog', { name: 'compromisso', exact: true }).count(), 0, 'não abre o editor de compromisso');
    await h.capture(p, `booking-hold-${width}`);
    assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await dialog.getByRole('button', { name: 'liberar horário' }).click();
    await dialog.getByRole('button', { name: 'confirmar: liberar o horário' }).click();
    await dialog.waitFor({ state: 'hidden' });
    const removed = await p.evaluate(() => window.__reviewMutations.filter((m) => m.method === 'remove'));
    assert.deepEqual(removed, [{ method: 'remove', col: 'agenda_blocks', id: 'ab_booking_ev1' }]);
    assert.equal(await p.locator('.agenda-block', { hasText: 'Lukas marcou pelo link' }).count(), 0, 'o horário foi liberado');
    await p.close();
  }
  // Reunião que mora na Implantação do cliente (caso Emerson Tratores) aparece na grade, sem arrastar.
  for (const width of [1440, 390]) {
    const p = await h.open(width, '&recordMeeting');
    const item = p.locator('.agenda-day-col [role=button]', { hasText: 'Emerson tratores' }).first();
    await item.waitFor();
    assert.match(await item.textContent(), /16:00/);
    assert.equal(await item.getAttribute('draggable'), null, 'remarca pela ficha, não arrasta');
    await h.capture(p, `record-meeting-${width}`);
    await p.close();
  }
  assert.deepEqual(h.errors, []);
  console.log('Pré-bloqueio da marcação: aparece na Agenda, não arrasta, abre a escolha do card e libera com confirmação; reunião da Implantação aparece na grade; desktop e mobile aprovados.');
} finally { await h.close(); }
