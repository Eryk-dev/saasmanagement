import assert from 'node:assert/strict';
import { reviewHarness } from './harness.mjs';
const h=await reviewHarness('today','Minhas atividades',null,{nativeTimers:true});
try {
  for(const width of [1440,390]) {
    const p=await h.open(width,'&card');
    await p.route('**/p/card-preview?**',r=>r.fulfill({contentType:'text/html',body:'<p>Configuração fictícia</p>'}));
    await p.evaluate(()=>{
      window.__opened=[]; window.__alerts=[]; window.__confirmed=[];
      window.open=()=>({location:{replace:url=>window.__opened.push(url)},close:()=>window.__opened.push('closed')});
      window.confirm=message=>{window.__confirmed.push(message);return true;};
      window.alert=message=>window.__alerts.push(message);
    });
    await p.getByRole('textbox',{name:'Buscar na fila'}).fill('Bruno');
    await p.locator('.today-open-script').first().click();
    const shortcuts=p.locator('.today-script-shortcuts');
    assert.equal(await shortcuts.getByRole('button',{name:'Gerar apresentação',exact:true}).count(),0);
    assert.equal(await shortcuts.getByRole('button',{name:'⋯',exact:true}).count(),0);
    await shortcuts.getByRole('button',{name:'Proposta no WhatsApp',exact:true}).click();
    await p.waitForFunction(()=>window.__reviewMutations.some(m=>m.method==='shareProposal'));
    const sent=await p.evaluate(()=>window.__opened.find(url=>url.includes('text=')));
    assert.ok(decodeURIComponent(sent).includes('https://client.example/proposal'));
    assert.ok(!decodeURIComponent(sent).includes('k=review'));
    await shortcuts.getByRole('button',{name:'Link de pagamento',exact:true}).click();
    const payment=p.getByRole('dialog',{name:'Link de pagamento',exact:true});await payment.waitFor();
    await payment.getByRole('button',{name:'Fechar',exact:true}).click();
    if(width===1440){const bs=await shortcuts.locator('.lead-send-actions-compact > button').evaluateAll(es=>es.map(e=>e.getBoundingClientRect().y));assert.equal(bs[0],bs[1]);}
    assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    assert.deepEqual(await p.evaluate(()=>window.__alerts),[]);
    await h.capture(p,`shortcuts-${width}`);await p.close();
  }
  const fail=await h.open(1440,'&card&proposalFail');
  await fail.route('**/p/card-preview?**',r=>r.fulfill({body:'Preview'}));
  await fail.evaluate(()=>{window.__alerts=[];window.__closed=false;window.confirm=()=>true;window.alert=m=>window.__alerts.push(m);window.open=()=>({close:()=>window.__closed=true});});
  await fail.getByRole('textbox',{name:'Buscar na fila'}).fill('Carla');await fail.locator('.today-open-script').first().click();
  await fail.getByRole('button',{name:'Proposta no WhatsApp',exact:true}).click();
  await fail.waitForFunction(()=>window.__alerts.length===1&&window.__closed);
  assert.equal(await fail.getByRole('button',{name:'Proposta no WhatsApp',exact:true}).isEnabled(),true);
  await fail.close();assert.deepEqual(h.errors,[]);
  console.log('Atalhos: remoção dos botões, proposta do cliente, pagamento, erro e mobile aprovados.');
} finally {await h.close();}
