// Carteira → Resultados (05/11/2026): os resultados de cada cliente por
// produto, no formato do slide de cases do deck. Prévia com API fictícia
// (preview/api-mock.js, customerResultsPreview), sem banco.
import assert from 'node:assert/strict';
import {reviewHarness} from './harness.mjs';

const h = await reviewHarness('carteira', 'Carteira', async () => {});
try {
  const abrir = async (width, q = '') => {
    const p = await h.open(width, q);
    await p.locator('.carteira-row').first().waitFor();
    await p.getByRole('button', {name: 'Resultados', exact: true}).click();
    await p.locator('.cres-stage').waitFor();
    return p;
  };
  const escolher = async (p, nome) => {
    await p.getByRole('button', {name: /^Cliente:/}).click();
    await p.getByRole('option', {name: new RegExp(nome)}).click();
    await p.locator('.cres-stage').waitFor();
  };

  for (const [width, q] of [[1440, ''], [1024, ''], [390, ''], [1440, '&theme=dark']]) {
    const p = await abrir(width, q);
    await escolher(p, 'Zpack');
    await h.capture(p, `resultados-leverads-${width}${q ? '-escuro' : ''}`);
    assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${width}: a página não pode rolar de lado`);
    await p.close();
  }

  // "ver resultados" na linha da lista leva direto ao cliente.
  {
    const q = await h.open(1440);
    const linha = q.locator('.carteira-row').filter({hasText: 'RN Distribuidora'});
    await linha.getByRole('button', {name: 'Ver resultados: RN Distribuidora'}).click();
    await q.locator('.cres-stage').waitFor();
    assert.match(await q.getByRole('button', {name: /^Cliente:/}).textContent(), /RN Distribuidora/);
    assert.equal(await q.getByRole('dialog').count(), 0, 'o botão não abre o card do cliente');
    await q.close();
  }

  const p = await abrir(1440);
  // Cliente com os dois produtos: cada um com a própria história.
  await escolher(p, 'RN Distribuidora');
  const palco = p.locator('.cres-stage');
  assert.match(await palco.textContent(), /Resultados · LeverAds/);
  assert.match(await palco.textContent(), /vendido pelos anúncios da Lever/);
  assert.match(await palco.textContent(), /de custo fixo evitado/);
  assert.doesNotMatch(await palco.textContent(), /rebate/i, 'métrica do LeverPrice não aparece no LeverAds');
  await p.getByRole('button', {name: 'LeverPrice', exact: true}).click();
  assert.match(await palco.textContent(), /Resultados · LeverPrice/);
  assert.match(await palco.textContent(), /rebate recuperado/);
  assert.match(await palco.textContent(), /vendido com preço do LeverPrice/);
  assert.doesNotMatch(await palco.textContent(), /anúncios da Lever/, 'métrica do LeverAds não aparece no LeverPrice');
  // Rebate tem gráfico próprio (um eixo por gráfico).
  assert.ok(await p.locator('.cres-extra').filter({hasText: 'Rebate recuperado'}).count() === 1);
  await h.capture(p, 'resultados-leverprice-1440');
  // Hover mostra o mês com os valores exatos.
  const barra = p.locator('.cres-chart').first().locator('rect').last();
  await barra.hover();
  assert.match(await p.locator('.cres-tip').first().textContent(), /setembro de 2026/);
  await h.capture(p, 'resultados-hover-1440');
  // Tabela no lugar do gráfico.
  await p.getByRole('button', {name: 'ver tabela'}).click();
  assert.equal(await p.locator('.cres-table tbody tr').count(), 12);
  await p.getByRole('button', {name: 'ver gráfico'}).click();
  // Apresentar: o palco em tela cheia, com tudo maior; "sair" (ou Esc) volta.
  await p.getByRole('button', {name: 'Apresentar'}).click();
  await p.locator('.cres-stage[data-full]').waitFor();
  await h.capture(p, 'resultados-apresentar-1440');
  await p.getByRole('button', {name: 'sair (Esc)'}).click();
  await p.locator('.cres-stage[data-full]').waitFor({state: 'detached'});
  // Produto sem conta vinculada explica o que fazer, sem número inventado.
  await escolher(p, 'Galante');
  await p.getByRole('button', {name: 'LeverPrice', exact: true}).click();
  assert.match(await p.locator('.cres-empty').textContent(), /Sem conta do LeverPrice vinculada/);
  await h.capture(p, 'resultados-sem-vinculo-1440');
  // A escolha volta ao reabrir a tela.
  await p.reload();
  await p.getByRole('heading', {name: 'Carteira', exact: true}).waitFor();
  assert.match(await p.getByRole('button', {name: /^Cliente:/}).textContent(), /Galante/);
  await p.close();

  assert.deepEqual(h.errors, []);
  console.log(`✓ carteira-resultados (prints em ${h.output})`);
} finally {
  await h.close();
}
