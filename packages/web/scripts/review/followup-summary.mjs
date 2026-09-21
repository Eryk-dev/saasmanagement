import assert from 'node:assert/strict';
import { reviewHarness } from './harness.mjs';
const h = await reviewHarness('today','Minhas atividades');
async function open(query, width=1440) {
  const page=await h.open(width,query);
  await page.getByRole('textbox',{name:'Buscar na fila'}).fill('Carla');
  await page.locator('.today-open-script').first().click();
  return page;
}
try {
  for(const width of [1440,390]) {
    const page=await open('&followup&callSummary',width);
    const card=page.locator('.today-followup-summary');
    await card.getByText('Retornar sexta para decidir com o sócio.',{exact:true}).waitFor();
    const text=await card.innerText();
    assert.ok(text.includes('Preço acima do orçamento, ainda em aberto.'));
    assert.ok(text.includes('Reduzir o trabalho manual nas três contas.'));
    assert.ok(!text.includes('Integração posterior') && !text.includes('Combinado antigo'));
    assert.ok(await card.evaluate(e=>e.previousElementSibling.classList.contains('today-script-columns') && e.nextElementSibling.classList.contains('today-script-history')));
    await card.scrollIntoViewIfNeeded();
    await h.capture(page,`followup-summary-${width}`);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    assert.deepEqual(await page.evaluate(()=>window.__reviewMutations),[]);
    await page.close();
  }
  const legacy=await open('&followup&callSummary&legacySummary');
  await legacy.locator('.today-followup-summary').getByText('Enviar proposta até sexta.',{exact:true}).waitFor();
  assert.ok((await legacy.locator('.today-followup-summary').innerText()).includes('Não registrados neste resumo.'));
  await legacy.close();
  const empty=await open('&followup');
  await empty.getByText('Ainda não há resumo da gravação desta call.',{exact:true}).waitFor();
  await empty.close();
  const other=await open('&callSummary');
  assert.equal(await other.locator('.today-followup-summary').count(),0);
  await other.close();
  assert.deepEqual(h.errors,[]);
  console.log('Resumo: última venda, ordem dos blocos, dados legados, ausência de resumo e desktop/mobile aprovados.');
} finally { await h.close(); }
