// Guias (03/11/2026): base de conhecimento com prints. Prévia com API fictícia
// (preview/api-mock.js, GUIAS_PREVIEW), sem banco.
import assert from 'node:assert/strict';
import {reviewHarness} from './harness.mjs';

const h = await reviewHarness('guides', 'Guias', async () => {});
try {
  for (const [width, q] of [[1440, ''], [390, ''], [1440, '&theme=dark']]) {
    const p = await h.open(width, q);
    await p.locator('.guides-row').first().waitFor();
    await h.capture(p, `lista-${width}${q ? '-escuro' : ''}`);
    // Trilhas: comuns primeiro, depois cada sistema, numerados na ordem de leitura.
    assert.deepEqual(await p.locator('.guides-track-head h2').allTextContents(), ['Para todos os sistemas', 'LeverAds', 'LeverPrice']);
    const ads = p.getByRole('region', {name: 'LeverAds'});
    assert.match(await ads.locator('.guides-row').first().textContent(), /^1Primeiro acesso: do cadastro à primeira cópialeia primeiro/);
    assert.match(await ads.locator('.guides-row').last().textContent(), /Implantação/, 'guia sem posição vai pro fim da trilha');
    assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${width}: a página não pode rolar de lado`);
    // Leitor: passos, texto, prints e navegação.
    await p.locator('.guides-row').filter({hasText: 'Implantação'}).click();
    const viewer = p.getByRole('dialog', {name: 'Guia · Implantação · call de integração'});
    await viewer.getByRole('heading', {name: 'Antes da call: conferir o que o cliente respondeu'}).waitFor();
    await viewer.getByRole('button', {name: 'próximo ›'}).click();
    await viewer.getByText('As contas conectadas aparecem com o selo verde').waitFor();
    await viewer.locator('.guide-figure-img img').first().waitFor();
    await h.capture(p, `leitor-${width}${q ? '-escuro' : ''}`);
    await p.keyboard.press('Escape');
    await viewer.waitFor({state: 'hidden'});
    await p.close();
  }

  const p = await h.open(1440);
  await p.locator('.guides-row').first().waitFor();
  // Só LeverPrice: os comuns e ele; no fim do último comum, o próximo guia é o 1º do LeverPrice.
  await p.getByRole('button', {name: 'LeverPrice', exact: true}).click();
  await p.getByRole('button', {name: /^Integração/}).click();
  assert.deepEqual(await p.locator('.guides-track-head h2').allTextContents(), ['Para todos os sistemas', 'LeverPrice']);
  await p.locator('.guides-row').filter({hasText: 'Link de cadastro'}).click();
  const link = p.getByRole('dialog', {name: 'Guia · Link de cadastro e criação da conta'});
  await link.getByRole('button', {name: 'próximo ›'}).click();
  await link.getByRole('button', {name: /próximo guia: Primeiro acesso: da conta criada/}).click();
  await p.getByRole('dialog', {name: /Guia · LeverPrice · Primeiro acesso/}).getByRole('heading', {name: /Passo 1 de LeverPrice · Primeiro acesso/}).waitFor();
  await h.capture(p, 'trilha-leverprice-1440');
  await p.keyboard.press('Escape');
  await p.getByRole('button', {name: 'Todos os sistemas', exact: true}).click();
  // Filtro por público e rascunhos (quem edita vê).
  await p.getByRole('button', {name: /^Suporte/}).click();
  assert.equal(await p.locator('.guides-row').count(), 1);
  await p.getByRole('button', {name: /^Rascunhos/}).click();
  assert.match(await p.locator('.guides-row').first().textContent(), /rascunho/);
  await p.getByRole('button', {name: /^Todos[0-9]/}).click();
  await p.getByLabel('Buscar nos guias').fill('conta-mãe');
  assert.equal(await p.locator('.guides-row').count(), 1, 'a busca olha dentro dos passos');
  await p.getByLabel('Buscar nos guias').fill('');
  // Editor: novo guia com um passo, salvar rascunho.
  await p.getByRole('button', {name: 'Novo guia', exact: true}).click();
  const ed = p.getByRole('dialog', {name: 'Novo guia'});
  await ed.getByPlaceholder('ex.: Implantação · call de integração').fill('Treinar o time do cliente');
  await ed.getByLabel('Título do passo 1').fill('Mostrar onde publicar');
  await ed.getByLabel('Texto do passo 1').fill('Abra a tela de anúncios e mostre o botão **Publicar**.');
  await h.capture(p, 'editor-1440');
  await ed.getByRole('button', {name: 'Salvar rascunho'}).click();
  const novo = p.getByRole('dialog', {name: 'Guia · Treinar o time do cliente'});
  await novo.getByRole('heading', {name: 'Mostrar onde publicar'}).waitFor();
  await p.keyboard.press('Escape');
  // Modelos de checklist: item apontando para o passo do guia.
  await p.getByRole('button', {name: 'Modelos de checklist', exact: true}).click();
  await p.locator('.guides-template-item').first().waitFor();
  assert.match(await p.locator('.guides-template-item').nth(1).textContent(), /Conectar as contas e definir a conta-mãe/);
  await h.capture(p, 'modelos-1440');
  await p.close();

  // Quem só lê: sem Novo guia, sem rascunhos, sem modelos.
  const leitor = await h.open(1440, '&leitor');
  await leitor.locator('.guides-row').first().waitFor();
  assert.equal(await leitor.getByRole('button', {name: 'Novo guia', exact: true}).count(), 0);
  assert.equal(await leitor.getByRole('button', {name: 'Modelos de checklist', exact: true}).count(), 0);
  await leitor.close();

  // Card da Integração: o item do checklist abre o guia no passo certo.
  const c = await h.open(1440);
  await c.evaluate(() => window.dispatchEvent(new CustomEvent('cockpit:open-record', {detail: {kind: 'onboarding', id: 'ob_prev_1'}})));
  const card = c.getByRole('dialog', {name: 'Integração'});
  await card.getByText('o cliente entra com o login dele').waitFor();
  await card.getByRole('button', {name: 'como fazer →'}).click();
  const guia = c.getByRole('dialog', {name: 'Guia · Implantação · call de integração'});
  await guia.getByRole('heading', {name: 'Conectar as contas e definir a conta-mãe'}).waitFor();
  await h.capture(c, 'checklist-guia-1440');
  await c.keyboard.press('Escape');
  await guia.waitFor({state: 'hidden'});
  assert.equal(await card.count(), 1, 'Esc fecha só o guia, o card da integração fica');
  await c.close();

  // Modo integração: o checklist vira roteiro, com o guia do item e o cliente ao lado.
  for (const width of [1440, 390]) {
    const r = await h.open(width);
    await r.evaluate(() => window.dispatchEvent(new CustomEvent('cockpit:open-record', {detail: {kind: 'onboarding', id: 'ob_prev_1'}})));
    await r.getByRole('dialog', {name: 'Integração'}).getByRole('button', {name: /Modo integração/}).click();
    const run = r.getByRole('dialog', {name: 'Modo integração · Galante Comércio'});
    await run.getByText('Antes de começar').waitFor();
    await run.getByRole('heading', {name: 'Conectar as contas do Mercado Livre'}).waitFor();
    assert.equal(await run.getByText('Marque a conta-mãe aqui').count(), 1, 'o passo do guia ligado ao item aparece');
    assert.ok(await run.getByText('Bling').count() >= 1, 'respostas do formulário no painel do cliente');
    assert.ok(await run.getByText('Linha de pneus fora').count() >= 1, 'pontos de atenção do resumo da venda');
    await h.capture(r, `modo-integracao-${width}`);
    if (width === 1440) {
      await run.getByRole('button', {name: 'Feito e seguir ›'}).click();
      await run.getByRole('heading', {name: 'Primeira cópia de anúncios'}).waitFor();
      assert.match(await run.locator('.run-steps button').nth(1).getAttribute('data-done') ?? 'x', /^$/, 'o item fica marcado');
      await run.getByText('Este item ainda não tem guia').waitFor();
      await r.keyboard.press('Escape');
      await run.waitFor({state: 'hidden'});
      await r.getByRole('dialog', {name: 'Integração'}).getByText('2 de 4').waitFor();
    } else {
      assert.ok(await r.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), '390: sem rolagem lateral');
    }
    await r.close();
  }

  assert.deepEqual(h.errors, [], `erros de página: ${h.errors.join(' | ')}`);
  console.log('✓ modo integração: roteiro pelo checklist, guia do item, painel do cliente, marcar feito e voltar ao card');
  console.log('✓ guias: lista, leitor com prints, filtros, editor, modelos, leitor sem edição e o "como fazer" no checklist (390/1440/escuro)');
} finally {
  await h.close();
}
