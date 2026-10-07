import assert from 'node:assert/strict';
import { reviewHarness } from './harness.mjs';
// Follow-up é por DIA (05/10/2026): na Agenda ele mora na faixa "dia" do topo
// da coluna, com o contato da vez, e nunca na grade de horas nem nos vãos.
const h = await reviewHarness('agenda', 'Agenda');
try {
  for (const width of [1440, 390]) {
    const page = await h.open(width, '&followup&fupOutro');
    const strip = page.locator('.agenda-allday');
    await strip.waitFor();
    const chips = strip.getByRole('button');
    assert.ok(await chips.filter({hasText:'Paula Serra'}).count() >= 1, 'follow-up de hoje na faixa do dia');
    assert.ok((await chips.filter({hasText:'Paula Serra'}).first().textContent()).includes('C2/4'));
    assert.ok(await chips.filter({hasText:'Ana Prado'}).count() >= 1);
    // Separado por operador: cada follow-up fica na faixa de quem faz (Paula e
    // Ana são do mesmo closer, Rita de outro), não solto na largura do dia.
    if (width === 1440) {
      const laneOf = (name) => chips.filter({hasText:name}).first().evaluate((el) => [...el.parentElement.parentElement.children].indexOf(el.parentElement));
      const [paula, ana, rita] = [await laneOf('Paula Serra'), await laneOf('Ana Prado'), await laneOf('Rita Moura')];
      assert.equal(paula, ana, 'follow-ups do mesmo closer na mesma faixa');
      assert.notEqual(paula, rita, 'follow-ups de closers diferentes em faixas diferentes');
    }
    // Nenhuma pílula com hora para follow-up na grade.
    assert.equal(await page.locator('[title^="follow-up"]').filter({hasNot: page.locator('.agenda-allday')}).evaluateAll((els) => els.filter((e) => !e.closest('.agenda-allday')).length), 0);
    await h.capture(page, `followup-dia-${width}`);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.close();
  }
  assert.deepEqual(h.errors, []);
  console.log('Agenda: follow-ups na faixa do dia, sem horário e fora da grade; desktop e mobile aprovados.');
} finally { await h.close(); }
