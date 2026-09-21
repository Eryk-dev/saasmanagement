import assert from 'node:assert/strict';
import { reviewHarness } from './harness.mjs';
import { proposalSlidesPageHtml } from '../../../api/src/proposal-slides-page.js';

const h = await reviewHarness('today', 'Minhas atividades', null, {nativeTimers:true});
const proposal = { id:'card-preview', data:{lead:{name:'Bruno Teixeira',company:'Auto Peças Já'},answers:{}}, state:{} };
const html = proposalSlidesPageHtml(proposal, {editable:true,configOnly:true});
try {
  for (const width of [1440,1920,390]) {
    const page = await h.open(width,'&card');
    const saves = [];
    await page.route('**/p/card-preview?**', route => route.fulfill({contentType:'text/html',body:html}));
    await page.route('**/public/proposals/card-preview', route => {
      saves.push(route.request().postDataJSON());
      return route.fulfill({json:{ok:true}});
    });
    await page.getByRole('textbox',{name:'Buscar na fila'}).fill('Bruno');
    await page.locator('.today-open-script').first().click();
    const frame=page.frameLocator('iframe[title="Configurar apresentação"]');
    await frame.getByLabel('Nome',{exact:true}).waitFor();
    await frame.getByLabel('Pedidos/mês',{exact:true}).fill('420');
    await frame.getByText('salvo',{exact:true}).waitFor();
    assert.equal(saves.at(-1).deckC.pedidos,420);
    assert.equal(saves.at(-1).k,'review');
    assert.ok(await frame.locator('body').evaluate(e=>e.scrollWidth<=innerWidth));
    await page.getByRole('combobox',{name:'Quantas contas?'}).selectOption('3-5');
    assert.ok(await page.evaluate(()=>window.__reviewMutations.some(m=>m.patch?.accounts==='3-5')));
    await page.locator('.today-script-body').evaluate(e=>e.scrollTop=0);
    await h.capture(page,`card-top-${width}`);
    const rects=await page.locator('.today-script-columns > section').evaluateAll(es=>es.map(e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y}}));
    if(width>=1440) assert.ok(Math.abs(rects[0].y-rects[1].y)<2 && rects[1].x>rects[0].x);
    await page.locator('.today-script-history textarea').fill('Cliente pediu retorno amanhã.');
    await page.locator('.today-script-history').getByRole('button',{name:'registrar',exact:true}).click();
    await page.locator('.today-lead-history-row').getByText('Cliente pediu retorno amanhã.',{exact:true}).waitFor();
    await h.capture(page,`card-history-${width}`);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.close();
  }
  assert.deepEqual(h.errors,[]);
  console.log('Card: configuração compartilhada, respostas, histórico, duas colunas e mobile aprovados.');
} finally { await h.close(); }
