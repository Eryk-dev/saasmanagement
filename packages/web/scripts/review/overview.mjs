import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const output = path.resolve('.review-artifacts/overview');
await fs.mkdir(output, { recursive: true });
const server = await createServer({ configFile: path.resolve('vite.preview.config.js'), server: { port: 0, strictPort: false } });
await server.listen();
const base = server.resolvedUrls.local[0];
const browser = await chromium.launch();
const errors = [];
const evidence = [];
async function open(width, query = '', prototype = false) {
  const page = await browser.newPage({ viewport: { width, height: width === 390 ? 844 : 1000 }, reducedMotion: 'reduce', timezoneId: 'America/Sao_Paulo' });
  page.setDefaultTimeout(10000);
  page.on('pageerror', error => errors.push(error.message));
  await page.clock.install({ time: new Date('2026-09-18T15:00:00-03:00') });
  // No real integrations may be reached by an isolated preview.
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    return url.origin === new URL(base).origin || /^(fonts\.googleapis\.com|fonts\.gstatic\.com)$/.test(url.hostname) || (prototype && url.hostname === 'unpkg.com') ? route.continue() : route.abort();
  });
  if (prototype) {
    await page.goto(`${base}responsive.html?width=${width}&prototype=1`);
    await page.goto(await page.locator('iframe').getAttribute('src'));
  } else await page.goto(`${base}?shell&review=overview${query}#overview`);
  await page.getByRole('heading', { name: 'Visão geral', exact: true }).waitFor();
  await page.evaluate(() => document.fonts.ready);
  if (!prototype && !query.includes('slow') && !query.includes('failOnce')) await page.locator('.vg-sales-all').waitFor();
  return page;
}
async function geometry(page, prototype) {
  return page.evaluate(prototype => {
    const rect = e => { const r = e.getBoundingClientRect(); return { x:r.x, y:r.y, width:r.width, height:r.height }; };
    const heading = document.querySelector('h1');
    let parts;
    if (prototype) {
      const grid = heading.closest('header').parentElement;
      const [hero, sales, main, portfolio] = [...grid.children].slice(1);
      const [thermometer, story] = hero.children;
      const bar = thermometer.children[2];
      parts = { heading, hero, sales, thermometer, bar, story, team:main.children[0], person:main.querySelector('article'), portfolio };
    } else {
      const selectors = { hero:'.vg-meta-card', sales:'.vg-sales', thermometer:'.vg-meta-thermometer', bar:'.vg-meta-thermometer-bar', story:'.vg-meta-story', team:'.vg-team-section', person:'.vg-team-card', portfolio:'.vg-portfolio' };
      parts = {heading, ...Object.fromEntries(Object.entries(selectors).map(([k,s])=>[k,document.querySelector(s)]))};
    }
    return Object.fromEntries(Object.entries(parts).map(([key,element])=>[key,rect(element)]));
  }, prototype);
}
try {
  for (const width of [1440, 1920]) {
    const reference = await open(width, '', true);
    const page = await open(width);
    await page.locator('.vg-funnel-row').first().waitFor();
    const expected = await geometry(reference, true), actual = await geometry(page, false);
    const comparisons = [];
    for (const key of Object.keys(expected)) {
      // The number of attention items comes from real data; it changes the
      // height of row two, while its origin and fixed column width must match.
      for (const dimension of ['x','y','width',...(['portfolio','team'].includes(key) ? [] : ['height'])]) {
        const difference = Math.abs(actual[key][dimension] - expected[key][dimension]);
        comparisons.push({element:key,dimension,expected:expected[key][dimension],actual:actual[key][dimension],difference});
      }
    }
    evidence.push({width,comparisons});
    await reference.screenshot({path:path.join(output,`reference-${width}.png`)});
    await page.screenshot({path:path.join(output,`app-${width}.png`)});
    const violations = comparisons.filter(row=>row.difference > 1);
    assert.deepEqual(violations, [], `Fixed geometry differs at ${width}px`);
    const text = await page.locator('.overview-screen').innerText();
    for (const removed of ['Detalhes da meta','o pace pedia','Contratado no período','Fora do resultado','Receita mensal','Base ativa','ranking por %','as 8 mais recentes']) assert.ok(!text.includes(removed), `Removed text: ${removed}`);
    assert.equal(await page.locator('.vg-page-head select').count(), 0);
    // Native disclosure supports keyboard and keeps its content in place.
    const summary = page.locator('.vg-team-details summary').first();
    await summary.focus(); await page.keyboard.press('Enter');
    assert.equal(await summary.evaluate(el=>el.parentElement.open),true);
    await page.keyboard.press('Enter');
    // Open a real lead drawer from a sale, close with Escape, keep period.
    const period = await page.evaluate(()=>localStorage.getItem('cockpit_period'));
    await page.locator('.vg-sale').first().click();
    await page.getByRole('dialog').waitFor();
    assert.ok(await page.getByRole('dialog').evaluate(el=>el.contains(document.activeElement)));
    await page.keyboard.press('Shift+Tab');
    assert.ok(await page.getByRole('dialog').evaluate(el=>el.contains(document.activeElement)));
    await page.keyboard.press('Escape');
    await page.getByRole('dialog').waitFor({state:'hidden'});
    assert.ok(await page.locator('.vg-sale').first().evaluate(el=>el === document.activeElement));
    assert.equal(await page.evaluate(()=>localStorage.getItem('cockpit_period')),period);
    await page.locator('.vg-team-person').first().click();
    await page.waitForURL(/#today/);
    assert.equal(await page.evaluate(()=>localStorage.getItem('cockpit_today_person')), 'rafael');
    await page.close(); await reference.close();
  }
  const mobile = await open(390);
  await mobile.locator('.vg-funnel-row').first().waitFor();
  assert.ok(await mobile.evaluate(()=>document.documentElement.scrollWidth <= innerWidth));
  for (const selector of ['.vg-funnel-row','.vg-sale','.vg-team-person','.vg-team-details summary','.vg-attention-action']) {
    const sizes = await mobile.locator(selector).evaluateAll(elements=>elements.map(el=>el.getBoundingClientRect().height));
    assert.ok(sizes.every(height=>height>=44), `Touch target smaller than 44px: ${selector}`);
  }
  await mobile.screenshot({path:path.join(output,'app-390.png')});
  await mobile.locator('.vg-sale').first().click();
  const dialog = mobile.getByRole('dialog'); await dialog.waitFor();
  const bounds = await dialog.boundingBox(); assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 391);
  await mobile.keyboard.press('Escape'); await dialog.waitFor({state:'hidden'}); await mobile.close();
  const empty = await open(1440,'&state=empty');
  await empty.getByText('Nenhuma venda registrada ainda.').waitFor();
  await empty.getByText('Sem atividade nesse período.').waitFor();
  await empty.screenshot({path:path.join(output,'empty.png')}); await empty.close();
  const failed = await open(1440,'&failOnce=scoreboard');
  await failed.getByRole('alert').first().waitFor();
  await failed.screenshot({path:path.join(output,'error.png')});
  await failed.getByRole('button',{name:'Tentar novamente'}).first().click();
  await failed.locator('.vg-funnel-row').first().waitFor();
  assert.equal(await failed.getByRole('alert').count(),0); await failed.close();
  const slow = await open(1440,'&slow=scoreboard');
  await slow.locator('.vg-funnel-row').first().waitFor();
  await slow.locator('.chrome-period-button').click();
  await slow.getByRole('button', {name:'Últimos 7 dias', exact:true}).click();
  await slow.getByRole('button', {name:'aplicar', exact:true}).click();
  await slow.getByText('Carregando funil…').waitFor();
  assert.ok(await slow.locator('.vg-sales').isVisible());
  await slow.screenshot({path:path.join(output,'loading.png')});
  await slow.locator('.vg-funnel-row').first().waitFor(); await slow.close();
  const dark = await open(1440, '&theme=dark');
  assert.equal(await dark.locator('body').getAttribute('data-theme'), 'dark');
  await dark.screenshot({path:path.join(output,'dark.png')}); await dark.close();
  assert.deepEqual(errors,[]);
  console.log('Visão geral: geometria 1440/1920, mobile 390, teclado, detalhes, navegação, vazio, carga e recuperação de erro aprovados.');
} finally {
  await fs.writeFile(path.join(output,'geometry.json'), JSON.stringify(evidence,null,2));
  await browser.close(); await server.close();
}
