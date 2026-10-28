import assert from 'node:assert/strict';
import { reviewHarness } from './harness.mjs';
// Compromissos da Agenda na fila de Minhas atividades + 2ª reunião na call
// agendada (Leo, 28/10/2026). Fixa em 18/09/2026 15:00 (sexta).
const h = await reviewHarness('today', 'Minhas atividades');
try {
  for (const width of [1440, 390]) {
    const page = await h.open(width, '&compromissos');
    await page.locator('.today-queue-row').first().waitFor();
    const text = await page.locator('.today-screen').innerText();
    assert.ok(text.includes('Reunião com o contador'), 'compromisso de hoje na fila');
    assert.ok(!text.includes('Só do Tiago'), 'compromisso de outra pessoa não entra na fila do Leo');
    assert.ok(!text.includes('almoço'), 'bloqueio não é tarefa');
    // O semanal das 9h já acabou: fica em "feitas hoje".
    await page.locator('.today-completed summary').click();
    assert.ok(await page.locator('.today-completed').getByText('Daily do comercial').count() > 0, 'compromisso encerrado vira feito');
    // O de amanhã (participante) aparece em Atividades futuras.
    assert.ok(await page.getByText('Alinhamento de propostas').count() > 0, 'compromisso de amanhã em Atividades futuras');
    await h.capture(page, `compromissos-${width}`);
    if (width === 1440) {
      await page.getByRole('button', { name: 'abrir agenda', exact: true }).first().click();
      assert.equal(await page.evaluate(() => location.hash), '#agenda');
      await page.goBack();
      await page.locator('.today-queue-row').first().waitFor();
      // 2ª reunião: Bruno (call das 10h já aconteceu).
      await page.getByRole('textbox', { name: 'Buscar na fila' }).fill('Bruno');
      await page.locator('.today-open-script').first().click();
      const actions = page.locator('.today-destinations');
      const chip = actions.getByRole('button', { name: /Marcar 2ª reunião/ });
      await chip.waitFor();
      await chip.click();
      await page.getByText(/fica no histórico e a nova ganha sala própria/).waitFor();
      await page.getByText(/Horários livres na agenda de/).waitFor();
      await h.capture(page, 'segunda-reuniao');
    }
    await page.close();
  }
  assert.deepEqual(h.errors, []);
  console.log('Atividades: compromissos da Agenda na fila e 2ª reunião aprovados.');
} finally { await h.close(); }
