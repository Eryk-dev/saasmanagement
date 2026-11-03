// Carteira (03/11/2026): o status de cada cliente num lugar só. Prévia com API
// fictícia (preview/api-mock.js, customerStatusPreview), sem banco.
import assert from 'node:assert/strict';
import {reviewHarness} from './harness.mjs';

const h = await reviewHarness('carteira', 'Carteira', async () => {});
try {
  for (const [width, q] of [[1440, ''], [1920, ''], [1024, ''], [390, ''], [1440, '&theme=dark']]) {
    const p = await h.open(width, q);
    await p.locator('.carteira-row').first().waitFor();
    await h.capture(p, `lista-${width}${q ? '-escuro' : ''}`);
    assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${width}: a página não pode rolar de lado`);
    await p.close();
  }

  const p = await h.open(1440);
  const rows = p.locator('.carteira-row');
  await rows.first().waitFor();
  // Ativos por padrão (o churn fica no "mais"), em ordem de atenção: em risco primeiro.
  assert.equal(await rows.count(), 7);
  assert.match(await rows.first().textContent(), /Braga Ferramentas/);
  assert.match(await rows.first().textContent(), /inadimplente/);
  // O aviso do topo leva aos inadimplentes.
  await p.getByRole('button', {name: 'ver inadimplentes'}).click();
  assert.equal(await rows.count(), 1);
  // Estágio pelo filtro e dono pelo seletor.
  await p.getByRole('button', {name: /^Atenção/}).click();
  assert.equal(await rows.count(), 2);
  await p.getByRole('button', {name: /^Ativos/}).click();
  await p.getByRole('button', {name: /^Dono da conta/}).click();
  await p.getByRole('option', {name: 'Sem dono'}).click();
  assert.equal(await rows.count(), 1);
  assert.match(await rows.first().textContent(), /Melo Cosméticos/);
  await p.getByRole('button', {name: /^Dono da conta/}).click();
  await p.getByRole('option', {name: 'Todos os donos'}).click();
  // Busca e produto sem conta visível na linha.
  await p.getByLabel('Buscar cliente').fill('galante');
  assert.equal(await rows.count(), 1);
  assert.match(await rows.first().textContent(), /LeverPrice · sem conta/);
  await p.getByLabel('Buscar cliente').fill('');
  // Régua de marcos: "N de M", o próximo marco quando ele ainda não é o
  // acompanhamento do próximo passo, e o filtro de marco atrasado.
  assert.match(await rows.filter({hasText: 'Zpack'}).textContent(), /2 de 6 marcos · Revisão de resultado atrasado/);
  assert.match(await rows.filter({hasText: 'Casa Bela'}).textContent(), /Check-in de mês 1/);
  assert.doesNotMatch(await rows.filter({hasText: 'Casa Bela'}).locator('.carteira-regua').textContent(), /Check-in/, 'o marco que já é o próximo passo não se repete');
  assert.match(await rows.filter({hasText: 'Lojão'}).textContent(), /régua completa/);
  await p.getByRole('button', {name: 'mais ▾'}).click();
  await p.getByRole('button', {name: /^Marco atrasado/}).click();
  assert.equal(await rows.count(), 2);
  await h.capture(p, 'marco-atrasado-1440');
  await p.getByRole('button', {name: /^Ativos/}).click();
  // Quadro: colunas da carteira com o MRR.
  await p.getByRole('button', {name: 'Quadro', exact: true}).click();
  await p.locator('.carteira-col').first().waitFor();
  assert.equal(await p.locator('.carteira-col').count(), 5);
  await h.capture(p, 'quadro-1440');
  // A linha abre o card do cliente AQUI, sem sair da Carteira; Esc fecha.
  await p.getByRole('button', {name: 'Lista', exact: true}).click();
  await rows.filter({hasText: 'Zpack'}).click();
  const card = p.getByRole('dialog', {name: 'Cliente · Zpack Embalagens'});
  await card.waitFor();
  assert.match(await p.evaluate(() => location.hash), /carteira/);
  await card.getByText('Pro trimestral').first().waitFor();
  await h.capture(p, 'card-1440');
  await p.keyboard.press('Escape');
  await card.waitFor({state: 'hidden'});
  // No quadro também.
  await p.getByRole('button', {name: 'Quadro', exact: true}).click();
  await p.locator('.carteira-card').filter({hasText: 'Lojão do Bebê'}).click();
  await p.getByRole('dialog', {name: 'Cliente · Lojão do Bebê'}).waitFor();
  await p.close();

  // Atividades: o acompanhamento vencido do dono aparece na fila de hoje,
  // atrasado, e abre o acompanhamento.
  const t = await h.open(1440);
  await t.evaluate(() => { location.hash = '#today'; });
  await t.getByRole('heading', {name: 'Minhas atividades'}).waitFor();
  const linha = t.locator('.today-queue-row').filter({hasText: 'Braga Ferramentas'}).filter({hasText: 'Conversa de risco'}).first();
  await linha.waitFor();
  assert.match(await linha.textContent(), /atrasado 2 d/);
  await h.capture(t, 'atividades-1440');
  await t.close();
  assert.deepEqual(h.errors, [], `erros de página: ${h.errors.join(' | ')}`);
  console.log('✓ carteira: lista, filtros, quadro, card do cliente sem sair da tela, 390/1024/1440/1920 e escuro');
} finally {
  await h.close();
}
