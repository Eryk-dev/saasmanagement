import assert from 'node:assert/strict';
import { reviewHarness } from './harness.mjs';
import { proposalSlidesPageHtml } from '../../../api/src/proposal-slides-page.js';

const h = await reviewHarness('today', 'Minhas atividades', null, {nativeTimers:true});
const proposal = { id:'card-preview', data:{lead:{name:'Bruno Teixeira',company:'Auto Peças Já'},answers:{}}, state:{} };
const catalog={products:{ads_essencial:{name:'Lever Ads · Essencial',contas:2,anu:{per:599},sem:{per:699}}}};
const html = proposalSlidesPageHtml(proposal, {editable:true,configOnly:true,catalog});
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
    await frame.getByLabel('Pedidos/mês',{exact:true}).waitFor();
    assert.equal(await frame.getByLabel('Nome',{exact:true}).isVisible(),false);
    assert.equal(await frame.getByLabel('Empresa',{exact:true}).isVisible(),false);
    assert.equal(await frame.getByLabel('Contas',{exact:true}).isVisible(),false);
    await frame.getByLabel('Pedidos/mês',{exact:true}).fill('420');
    await frame.getByText('salvo',{exact:true}).waitFor();
    assert.equal(saves.at(-1).deckC.pedidos,420);
    assert.equal(saves.at(-1).k,'review');
    await frame.getByLabel('Ticket médio (R$)',{exact:true}).fill('85');
    await frame.getByText('salvo',{exact:true}).waitFor();
    assert.equal(saves.at(-1).deckC.ticket,85);
    await frame.getByRole('button',{name:'Semestral · 6×',exact:true}).click();
    await frame.getByText('salvo',{exact:true}).waitFor();
    assert.equal(saves.at(-1).deckC.periodo,'semestral');
    assert.equal(await frame.locator('.cfg-value [data-f="mensalFmt"]').innerText(),'699');
    assert.equal(saves.at(-1).deckC.nome,'Bruno Teixeira');
    await page.waitForFunction(()=>{const f=document.querySelector('iframe[title="Configurar apresentação"]');return f&&f.clientHeight>=f.contentDocument.querySelector('[data-cfg-screen]').scrollHeight;});
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
    await page.getByRole('button',{name:'Fechar roteiro',exact:true}).click();
    const future=page.getByRole('region',{name:'Atividades futuras'});
    await h.capture(page,`future-${width}`);
    await future.getByRole('button',{name:/\+\d+ atividades/}).click();
    await future.getByRole('button',{name:/Futuro 7/}).click();
    await page.locator('.today-script-identity').getByRole('button',{name:'Futuro 7',exact:true}).waitFor();
    await page.getByRole('button',{name:'Fechar roteiro',exact:true}).click();
    await future.getByRole('button',{name:/Mais adiante/}).click();
    await page.locator('.today-script-identity').getByRole('button',{name:'Mais adiante',exact:true}).waitFor();
    await page.close();
  }
  assert.deepEqual(h.errors,[]);
  console.log('Card: configuração compartilhada, respostas, histórico, duas colunas e mobile aprovados.');
} finally { await h.close(); }
