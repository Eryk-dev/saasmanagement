import assert from 'node:assert/strict';
import { reviewHarness } from './harness.mjs';
// Seção "Etapa" da ficha do lead aberta pelas Atividades (06/10/2026): o
// próximo passo é o mesmo do bloco das Atividades (sem Ganho quando o funil tem
// Integração; o "contato" do Qualificando é a Nutrição, não o No show) e o resto
// do funil fica num seletor por fase. Dados: ?etapas (preview/etapas-mock.js).
const h = await reviewHarness('today', 'Minhas atividades');
const EXPECTED = {
  'Rafael Duarte': ['Integração', 'Nutrição', 'Desqualificado'],          // Follow-up
  'Bruno Teixeira': ['No show', 'Follow-up', 'Integração', 'Desqualificado'], // Call agendada
  'Carla Nunes': ['Call agendada', 'Nutrição', 'Desqualificado'],         // Qualificando
  'Pedro Rocha': ['Follow-up', 'Integração', 'Desqualificado'],           // Proposta enviada
  'Sandra Melo': ['Acompanhamento'],                                      // Integração
  'Diego Martins': ['Call agendada', 'Desqualificado'],                   // Nutrição
};
async function openSheet(page, name) {
  await page.getByRole('textbox', {name:'Buscar na fila'}).fill(name);
  await page.locator('.today-open-script').first().click();
  await page.getByRole('button', {name, exact:true}).first().click();
  const section = page.locator('.lead-stage');
  await section.waitFor();
  return section;
}
const chips = (section) => section.locator('.lead-stage-chip').evaluateAll((els) => els.map((e) => e.textContent.replace(/\s*→\s*$/, '').trim()));
try {
  for (const [name, expected] of Object.entries(EXPECTED)) {
    const page = await h.open(1440, '&etapas');
    const section = await openSheet(page, name);
    assert.deepEqual(await chips(section), expected, name);
    // Nada de "avançar etapa"/"voltar"/<select> nem "marcar ganho" na ficha.
    const panel = page.locator('.lead-panel');
    for (const old of ['avançar etapa →', '← voltar', 'marcar ganho', 'marcar perdido']) assert.equal(await panel.getByRole('button', {name:old, exact:true}).count(), 0, `${name}: ${old}`);
    assert.equal(await panel.getByRole('combobox', {name:'Mover de etapa'}).count(), 0);
    // Outra etapa: agrupada por fase, sem a atual, sem Ganho (o funil tem Integração).
    await section.getByRole('button', {name:/^Mover para outra etapa/}).click();
    const options = await page.getByRole('option').allTextContents();
    assert.ok(!options.some((o) => /^Ganho/.test(o)), `${name}: Ganho fora do seletor`);
    assert.ok(options.length > 0);
    await page.keyboard.press('Escape');
    await page.close();
  }
  // Mover: o chip passa pelo gate (Integração pede o fechamento) e o seletor
  // move direto quando a etapa não pede nada (os gates são os do moveGate).
  for (const width of [1440, 390]) {
    const page = await h.open(width, '&etapas');
    const section = await openSheet(page, 'Rafael Duarte');
    await section.scrollIntoViewIfNeeded();
    await section.screenshot({ path: `${h.output}/lead-stage-followup-${width}.png` });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await section.getByRole('button', {name:'Integração →'}).click();
    // Fechamento sem <select> nativo: valor com vírgula, pagamento e integrador
    // pelo popover, plano pelo segmentado.
    const gate = page.getByRole('dialog', {name:'mover lead', exact:true});
    await gate.waitFor();
    assert.equal(await gate.locator('select').count(), 0, 'gate sem select nativo');
    assert.deepEqual(await page.evaluate(() => window.__etapasMoves), [], 'gate aberto, nada movido ainda');
    await gate.getByRole('textbox', {name:'Valor do negócio'}).fill('3.582,50');
    await gate.getByRole('radio', {name:'Semestral', exact:true}).click();
    await gate.getByRole('button', {name:/^Modo de pagamento/}).click();
    await page.getByRole('option').first().click();
    assert.match(await gate.getByRole('button', {name:/^Responsável pela integração/}).textContent(), /Eryk/);
    // Com o integrador escolhido, o link de convite da agenda dele aparece pra mandar ao cliente.
    const booking = gate.getByRole('group', {name:'Link de convite de Eryk'});
    assert.equal(await booking.getByRole('link', {name:'abrir agenda ↗'}).getAttribute('href'), 'https://calendar.app.google/YfS45BGrP3Nb9aA88');
    await booking.getByRole('button', {name:'copiar mensagem'}).waitFor();
    await h.capture(page, `lead-stage-gate-${width}`);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await gate.getByRole('button', {name:'confirmar movimento'}).click();
    await page.waitForFunction(() => window.__etapasMoves.length === 1);
    const patch = (await page.evaluate(() => window.__etapasPatches)).at(-1).patch;
    assert.equal(patch.stage, 'Integração');
    assert.equal(patch.amount, 3582.5);
    assert.equal(patch.integrator, 'eryk');
    assert.equal(patch.planClosed, 'semestral');
    assert.ok(patch.paymentMethod, 'pagamento escolhido no popover');
    await page.close();
  }
  // Perda: motivo pelo popover, confirmar só com motivo.
  {
    const page = await h.open(1440, '&etapas');
    const section = await openSheet(page, 'Carla Nunes');
    await section.getByRole('button', {name:'Desqualificado →'}).click();
    const gate = page.getByRole('dialog', {name:'mover lead', exact:true});
    await gate.waitFor();
    assert.equal(await gate.locator('select').count(), 0);
    assert.equal(await gate.getByRole('button', {name:'confirmar movimento'}).isEnabled(), false);
    await gate.getByRole('button', {name:/^Motivo da desqualificação/}).click();
    await page.getByRole('option', {name:'Fora do ICP'}).click();
    await gate.getByRole('button', {name:'confirmar movimento'}).click();
    await page.waitForFunction(() => window.__etapasMoves.length === 1);
    const patch = (await page.evaluate(() => window.__etapasPatches)).at(-1).patch;
    assert.deepEqual({stage:patch.stage, lostReason:patch.lostReason}, {stage:'Desqualificado', lostReason:'fora_icp'});
    await page.close();
  }
  {
    const page = await h.open(1440, '&etapas');
    // Nutrição → Qualificando (reativou): etapa sem gate, move na hora.
    const section = await openSheet(page, 'Diego Martins');
    await section.getByRole('button', {name:/^Mover para outra etapa/}).click();
    await page.getByRole('option', {name:'Qualificando'}).click();
    await page.waitForFunction(() => window.__etapasMoves.length === 1);
    assert.deepEqual(await page.evaluate(() => window.__etapasMoves), [{id:'e10', from:'Nutrição', to:'Qualificando'}]);
    await page.locator('.lead-stage-current', {hasText:'Qualificando'}).waitFor();
    assert.deepEqual(await chips(section), ['Call agendada', 'Nutrição', 'Desqualificado']);
    await h.capture(page, 'lead-stage-moved');
    await page.close();
  }
  // Próximo passo das Atividades: no Qualificando a Nutrição é a Nutrição.
  {
    const page = await h.open(1440, '&etapas');
    await page.getByRole('textbox', {name:'Buscar na fila'}).fill('Carla');
    await page.locator('.today-open-script').first().click();
    const dests = page.locator('.today-destinations');
    await dests.waitFor();
    assert.equal(await dests.getByRole('button', {name:/^Nutrição/}).count(), 1);
    assert.equal(await dests.getByRole('button', {name:/^No show/}).count(), 0);
    await page.close();
  }
  assert.deepEqual(h.errors, []);
} finally { await h.close(); }

// Ficha do Pipeline: o rodapé usa o mesmo bloco (sem select, sem "Avançar →"
// pela ordem do funil, sem "Descartar lead").
const hp = await reviewHarness('pipeline', 'Pipeline');
try {
  for (const width of [1440, 390]) {
    const page = await hp.open(width, '&etapas');
    if (width === 390) await page.getByRole('button', {name:'Kanban', exact:true}).click();
    await page.getByRole('button', {name:'Abrir lead: Rafael Duarte', exact:true}).click();
    const drawer = page.getByRole('dialog', {name:'Lead · Rafael Duarte', exact:true});
    await drawer.waitFor();
    const moves = drawer.locator('.lead-stage-moves');
    assert.deepEqual(await chips(moves), ['Integração', 'Nutrição', 'Desqualificado']);
    assert.equal(await drawer.locator('.pipeline-lead-footer select').count(), 0);
    for (const old of ['Avançar →', 'Descartar lead']) assert.equal(await drawer.getByRole('button', {name:old, exact:true}).count(), 0, old);
    await moves.getByRole('button', {name:/^Mover para outra etapa/}).click();
    assert.ok(!(await page.getByRole('listbox', {name:'Mover para outra etapa'}).getByRole('option').allTextContents()).some((o) => /^Ganho/.test(o)));
    await page.keyboard.press('Escape');
    await page.getByRole('listbox', {name:'Mover para outra etapa'}).waitFor({state:'detached'});
    await drawer.locator('.pipeline-lead-footer').screenshot({ path: `${hp.output}/lead-stage-footer-${width}.png` });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.close();
  }
  assert.deepEqual(hp.errors, []);
  console.log('Etapa do lead: próximos passos por etapa sem Ganho, seletor por fase, gate sem select nativo (fechamento e perda), mover direto, Nutrição no Qualificando e rodapé do Pipeline; desktop e mobile aprovados.');
} finally { await hp.close(); }
