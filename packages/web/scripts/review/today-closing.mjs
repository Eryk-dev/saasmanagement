import assert from 'node:assert/strict';
import { reviewHarness } from './harness.mjs';
// Próximo passo das Atividades indo pra Integração (05/10/2026): o produto
// vendido sai do catálogo de PLANOS da plataforma (CONFIG.plans, o mesmo da
// tela Planos), agrupado pelo produto, sem arquivado nem catálogo anterior; o
// "Plano fechado" mostra só os ciclos que o plano escolhido vende; e nenhum
// campo da seção usa o <select> nativo.
const h = await reviewHarness('today', 'Minhas atividades');
const radios = async (page, name) => (await page.getByRole('radiogroup', {name}).getByRole('radio').allTextContents());
const checked = (page, name) => page.getByRole('radiogroup', {name}).locator('[aria-checked="true"]').textContent();
async function pick(page, trigger, option) {
  await page.getByRole('button', {name: trigger}).click();
  await page.getByRole('option', {name: option}).click();
}
try {
  for (const width of [1440, 390]) {
    const page = await h.open(width, '&closing');
    await page.getByRole('textbox', {name:'Buscar na fila'}).fill('Bruno');
    await page.locator('.today-open-script').first().click();
    const actions = page.locator('.today-destinations');
    assert.equal(await actions.getByRole('button', {name:/^Ganho/}).count(), 0, 'sem Ganho no Próximo passo: a Integração fecha a venda');
    await actions.getByRole('button', {name:/^Integração/}).click();

    await page.getByRole('button', {name:/^Produto vendido:/}).click();
    const list = page.getByRole('listbox', {name:'Produto vendido'});
    await list.waitFor();
    const names = (await list.getByRole('option').allTextContents()).map((t) => t.replace(/✓$/, ''));
    assert.deepEqual(names, [
      'Ads Escala + OEM', 'Ads Essencial', 'Ads Só Anual', 'Ads Enterprisesob consulta', 'Pacote de OEM avulsocompra única',
      'Lever Price · Escala', 'Mentoria · Cursocompra única', 'Personalizado… (fora do catálogo)',
    ], 'planos vivos do catálogo, na ordem, agrupados por produto; o que só a apresentação vende no fim');
    assert.deepEqual(await list.locator('.kicker').allTextContents(), ['LeverAds', 'LeverPrice', 'Mentoria']);
    await list.getByRole('option', {name:/^Ads Só Anual/}).click();
    assert.deepEqual(await radios(page, 'Plano fechado'), ['Anual'], 'só o ciclo que o plano vende');

    await pick(page, /^Produto vendido:/, /^Pacote de OEM avulso/);
    assert.deepEqual(await radios(page, 'Plano fechado'), ['Serviço único']);
    assert.equal(await checked(page, 'Plano fechado'), 'Serviço único');

    await pick(page, /^Produto vendido:/, /^Ads Enterprise/);
    assert.deepEqual(await radios(page, 'Plano fechado'), ['Anual', 'Semestral']);
    assert.equal(await checked(page, 'Plano fechado'), 'Anual', 'saindo da compra única, cai no 1º ciclo do plano');
    assert.ok(await page.getByText('plano sob consulta: sem preço de tabela, informe o valor fechado').isVisible());

    await pick(page, /^Produto vendido:/, /^Personalizado/);
    await page.getByPlaceholder('escreva o produto vendido…').fill('Pacote especial');
    assert.deepEqual(await radios(page, 'Plano fechado'), ['Anual', 'Semestral', 'Serviço único']);

    await pick(page, /^Produto vendido:/, /^Ads Essencial/);
    await page.getByRole('radiogroup', {name:'Plano fechado'}).getByRole('radio', {name:'Semestral'}).click();
    await page.getByRole('button', {name:'R$ 3.582', exact:true}).click();
    await pick(page, /^Modo de pagamento:/, /^PIX à vista/);
    await pick(page, /^Responsável pela integração:/, /^Eryk/);
    // Agendamento: as três formas num segmentado, só a escolhida aparece.
    assert.deepEqual(await radios(page, 'Como agendar'), ['Marcar agora', 'Enviar link', 'Marcar depois']);
    const entrega = page.locator('section[aria-label="A entrega"]');
    assert.ok(await entrega.getByText('escolha um horário livre na grade').isVisible(), 'começa na grade');
    await page.getByRole('radiogroup', {name:'Como agendar'}).getByRole('radio', {name:'Enviar link'}).click();
    assert.ok(await entrega.getByText(/ainda não cadastrou o link de convite/).isVisible(), 'sem link cadastrado, diz onde cadastrar');
    assert.equal(await entrega.getByText('escolha um horário livre na grade').count(), 0, 'a grade sai quando o modo é o link');
    await page.getByRole('radiogroup', {name:'Como agendar'}).getByRole('radio', {name:'Marcar agora'}).click();
    // Marcar agora (07/10/2026): a semana numa grade só, um dia por coluna, de
    // hora em hora. Relógio da revisão: sex 18/09 às 15h.
    const week = entrega.locator('.week-slots');
    assert.equal(await week.locator('.week-slots-col').count(), 5, 'cinco dias úteis lado a lado');
    assert.deepEqual((await week.locator('.week-slots-day').allTextContents()).map((t) => t.trim()),
      ['sex 18/09', 'seg 21/09', 'ter 22/09', 'qua 23/09', 'qui 24/09']);
    const firstCol = week.locator('.week-slots-col').first();
    assert.equal(await firstCol.locator('.week-slot').count(), 14, '07:00…20:00, só hora cheia');
    assert.equal(await week.locator('.week-slot', {hasText:':30'}).count(), 0, 'sem meia hora');
    assert.ok(await firstCol.getByRole('button', {name:'14:00'}).isDisabled(), 'hora que já passou fica travada');
    assert.ok(await week.getByRole('button', {name:'semana anterior'}).isDisabled(), 'não volta pra antes de hoje');
    await week.getByRole('button', {name:'próxima semana'}).click();
    assert.equal((await week.locator('.week-slots-day').first().textContent()).trim(), 'sex 25/09');
    await week.getByRole('button', {name:'semana anterior'}).click();
    await week.locator('.week-slots-col').nth(1).getByRole('button', {name:'10:00'}).click();
    assert.match(await entrega.locator('.today-sched-picked').textContent(), /^✓ seg\.?, 21\/09.*10:00/);
    assert.equal(await actions.locator('select').count(), 0, 'nenhum <select> nativo no Próximo passo');
    await actions.scrollIntoViewIfNeeded();
    await h.capture(page, `closing-integracao-${width}`);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));

    await actions.getByRole('button', {name:'mover pra Integração →'}).click();
    await page.waitForFunction(() => window.__reviewMutations.some((m) => m.method === 'update'));
    const upd = (await page.evaluate(() => window.__reviewMutations)).find((m) => m.method === 'update');
    assert.equal(upd.id, 'l2');
    assert.deepEqual(
      {stage: upd.patch.stage, integrator: upd.patch.integrator, dealProduct: upd.patch.dealProduct, planClosed: upd.patch.planClosed, amount: upd.patch.amount, paymentMethod: upd.patch.paymentMethod},
      {stage:'Integração', integrator:'eryk', dealProduct:'ads_essencial', planClosed:'semestral', amount:3582, paymentMethod:'pix'});
    assert.equal(upd.patch.integrationAt, '2026-09-21T10:00');
    await page.close();
  }
  // Mais de um produto na mesma venda: um bloco por produto, sem repetir plano
  // recorrente do mesmo sistema, total somado, Obs. pra integração e o valor
  // como texto (sem as setinhas de 0,01 do input numérico).
  for (const width of [1440, 390]) {
    const page = await h.open(width, '&closing');
    await page.getByRole('textbox', {name:'Buscar na fila'}).fill('Bruno');
    await page.locator('.today-open-script').first().click();
    const actions = page.locator('.today-destinations');
    await actions.getByRole('button', {name:/^Integração/}).click();
    assert.equal(await page.getByLabel('Valor do negócio (R$) *').getAttribute('type'), 'text');
    await pick(page, /^Produto vendido:/, /^Ads Essencial/);
    await page.getByRole('radiogroup', {name:'Plano fechado'}).getByRole('radio', {name:'Semestral'}).click();
    await page.getByRole('button', {name:'R$ 3.582', exact:true}).click();
    await actions.getByRole('button', {name:'+ adicionar outro produto'}).click();
    await page.getByRole('button', {name:/^Produto vendido 2:/}).click();
    const names = (await page.getByRole('listbox', {name:'Produto vendido 2'}).getByRole('option').allTextContents()).map((t) => t.replace(/✓$/, ''));
    assert.deepEqual(names, ['Pacote de OEM avulsocompra única', 'Lever Price · Escala', 'Mentoria · Cursocompra única', 'Personalizado… (fora do catálogo)'],
      'o LeverAds já tem plano na venda: sobram compra única e os outros produtos');
    await page.getByRole('option', {name:/^Lever Price · Escala/}).click();
    assert.equal(await checked(page, 'Plano fechado 2'), 'Anual');
    await page.locator(`[id$="-1"][id^="deal-amount-"]`).fill('17.964');
    assert.equal(await actions.locator('.today-dest-static strong').first().textContent(), 'R$ 21.546');
    await pick(page, /^Modo de pagamento:/, /^PIX à vista/);
    await pick(page, /^Responsável pela integração:/, /^Eryk/);
    await page.getByLabel('Obs. pra integração').fill('Cliente prefere a integração à tarde.');
    assert.equal(await actions.locator('select').count(), 0);
    await actions.scrollIntoViewIfNeeded();
    await h.capture(page, `closing-multi-${width}`);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await actions.getByRole('button', {name:'mover pra Integração →'}).click();
    await page.waitForFunction(() => window.__reviewMutations.some((m) => m.method === 'update'));
    const upd = (await page.evaluate(() => window.__reviewMutations)).find((m) => m.method === 'update');
    assert.equal(upd.patch.amount, 21546, 'valor do negócio = soma dos produtos');
    assert.equal(upd.patch.dealProduct, 'ads_essencial');
    assert.equal(upd.patch.planClosed, 'semestral');
    assert.deepEqual(upd.patch.dealItems, [
      {product:'ads_essencial', planClosed:'semestral', amount:3582},
      {product:'price_escala', planClosed:'anual', amount:17964},
    ]);
    assert.equal(upd.patch.integrationNote, 'Cliente prefere a integração à tarde.');
    await page.close();
  }
  // Call → Follow-up: o produto ofertado sai do mesmo catálogo e a proposta na
  // mesa é um seletor segmentado com os ciclos do plano.
  for (const width of [1440, 390]) {
    const page = await h.open(width, '&closing');
    await page.getByRole('textbox', {name:'Buscar na fila'}).fill('Bruno');
    await page.locator('.today-open-script').first().click();
    const actions = page.locator('.today-destinations');
    await actions.getByRole('button', {name:/^Follow-up/}).click();
    await pick(page, /^Qual produto ficou ofertado\?:/, /^Ads Só Anual/);
    assert.deepEqual(await radios(page, 'Qual proposta ficou na mesa?'), ['Anual', 'não chegou na proposta']);
    await page.getByRole('radiogroup', {name:'Qual proposta ficou na mesa?'}).getByRole('radio', {name:'Anual'}).click();
    assert.equal(await actions.locator('select').count(), 0);
    await h.capture(page, `closing-followup-${width}`);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.getByRole('group', {name:'Dia do contato 1'}).getByRole('button').nth(2).click();
    await actions.getByRole('button', {name:'agendar follow-up →'}).click();
    await page.waitForFunction(() => window.__reviewMutations.some((m) => m.method === 'update'));
    const upd = (await page.evaluate(() => window.__reviewMutations)).find((m) => m.method === 'update');
    assert.equal(upd.patch.proposalProduct, 'ads_trimestral');
    assert.equal(upd.patch.proposalOffer, 'anual');
    await page.close();
  }
  assert.deepEqual(h.errors, []);
  console.log('Próximo passo: planos do catálogo da plataforma na Integração e no follow-up, ciclos do plano escolhido e nenhum select nativo; desktop e mobile aprovados.');
} finally { await h.close(); }
