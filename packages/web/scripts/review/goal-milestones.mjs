import assert from 'node:assert/strict';
import { reviewHarness } from './harness.mjs';
const h=await reviewHarness('overview','Visão geral');
try {
  for(const width of [1440,390]) {
    const page=await h.open(width,'&milestone=241678');
    await page.getByText('Próximo alvo · 120%',{exact:true}).waitFor();
    const card=page.locator('.vg-meta-card');
    const text=(await card.innerText()).replace(/\s/g,'');
    assert.ok(text.includes('R$270.000') && text.includes('R$225.000'));
    assert.ok(text.toLowerCase().includes('faltapara120%r$28.322'),text);
    assert.ok(text.includes('R$57.587acimadopace'));
    assert.ok(text.toLowerCase().includes('pordiaútilr$3.540'));
    assert.equal(await card.getByRole('progressbar').getAttribute('aria-valuemax'),'120');
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await h.capture(page,`milestone-${width}`);
    await page.close();
  }
  const next=await h.open(1440,'&milestone=270000');
  await next.getByText('Próximo alvo · 140%',{exact:true}).waitFor();
  assert.ok((await next.locator('.vg-meta-target').innerText()).replace(/\s/g,'').includes('R$315.000'));
  await next.close();
  assert.deepEqual(h.errors,[]);
  console.log('Alvos de 120% e 140%, pace, falta, ritmo diário e desktop/mobile aprovados.');
} finally {await h.close();}
