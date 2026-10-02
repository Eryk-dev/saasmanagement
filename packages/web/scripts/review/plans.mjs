// Revisão no navegador da tela Planos (Comercial → Planos) e do plano na ficha
// do cliente. Vite com mocks: sem API nem banco.
//   cd packages/web && node scripts/review/plans.mjs
import assert from 'node:assert/strict';
import { reviewHarness } from './harness.mjs';

const h = await reviewHarness('customers', 'Clientes', async () => {});
const mutations = (p) => p.evaluate(() => window.__reviewMutations);
// Nome EXATO do plano ("Ads Escala" não pode casar com "Ads Escala + OEM").
const exact = (name) => new RegExp('^' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$');
const planRow = (p, name) => p.locator('.plans-row').filter({ has: p.locator('strong', { hasText: exact(name) }) });
async function openPlans(p) {
  await p.evaluate(() => { window.location.hash = 'plans'; });
  await p.getByRole('heading', { name: 'Planos', exact: true }).waitFor();
  await p.locator('.plans-row').first().waitFor();
}
try {
  // ── Acesso pelo menu: Comercial → Planos ────────────────────────────────
  const p = await h.open(1440);
  await p.locator('.customers-table-row').first().waitFor();
  await p.getByLabel('Navegação principal').getByRole('button', { name: 'Planos', exact: true }).click();
  await p.getByRole('heading', { name: 'Planos', exact: true }).waitFor();
  await p.locator('.plans-row').first().waitFor();
  await h.capture(p, 'plans-1440');

  // ── Resumo: quanto os planos rendem e o que está fora do catálogo ───────
  const summary = await p.locator('.plans-summary').innerText();
  assert.match(summary, /de MRR em \d+ clientes ativos/);
  assert.match(summary, /contratados por ano/);
  assert.match(summary, /Fora do catálogo/i);

  // ── Agrupamento por produto: LeverAds, LeverPrice e Mentoria ────────────
  assert.deepEqual(await p.locator('.plans-product h2').allInnerTexts(), ['LeverAds', 'LeverPrice', 'Mentoria']);
  assert.match(await p.locator('.plans-product').first().innerText(), /planos · \d+ assinantes? · R\$/);
  // Os seis planos da planilha: Ads e Ads + OEM em Essencial, Escala e Enterprise.
  for (const name of ['Ads Essencial', 'Ads Escala', 'Ads Enterprise', 'Ads Essencial + OEM', 'Ads Escala + OEM', 'Ads Enterprise + OEM']) {
    assert.equal(await planRow(p, name).count(), 1, name);
  }
  assert.match(await planRow(p, 'Ads Essencial + OEM').innerText(), /3 contas · 500 cópias\/dia · 200 OEMs\/mês/);
  assert.equal(await p.locator('.plans-group').count(), 0, 'sem subgrupo de linha: o agrupamento é o produto');
  // Filtro por produto.
  const prodFilter = p.getByRole('group', { name: 'Produto' });
  await prodFilter.getByRole('button', { name: /^LeverPrice/ }).click();
  assert.deepEqual(await p.locator('.plans-product h2').allInnerTexts(), ['LeverPrice']);
  assert.equal(await p.locator('.plans-row').count(), 1);
  await prodFilter.getByRole('button', { name: /^Todos os produtos/ }).click();
  assert.match(await p.locator('.plans-products').innerText(), /LeverAds[\s\S]*LeverPrice[\s\S]*Mentoria/);
  // Lever Price fica no produto dele, depois dos planos do LeverAds; a Mentoria por último.
  const order = await p.locator('.plans-product h2, .plans-row strong').allInnerTexts();
  assert.ok(order.indexOf('LeverPrice') < order.indexOf('Lever Price · Escala') && order.indexOf('Lever Price · Escala') < order.indexOf('Mentoria'));
  assert.ok(order.indexOf('Mentoria') < order.indexOf('Mentoria · Curso'));

  // ── Tabela: preço, limites, recursos e números por plano ────────────────
  const row = (name) => planRow(p, name);
  const escala = row('Ads Escala + OEM');
  const text = await escala.innerText();
  assert.match(text, /oem_escala/);
  assert.match(text, /R\$\s?999\/mês/);
  assert.match(text, /anual R\$\s?11\.988 · semestral R\$\s?7\.182/);
  assert.match(text, /7 contas · 8\.000 cópias\/dia · OEMs\/mês ilimitados/);
  assert.match(text, /7 recursos/);
  assert.match(text, /\/ano/, 'MRR vem com o contratado por ano');
  assert.match(await row('Ads Escala').innerText(), /6 recursos/, 'Ads sem OEM não tem o Criador');
  assert.match(await row('Ads Enterprise + OEM').innerText(), /sob consulta/);
  assert.match(await row('Pacote de OEM avulso').innerText(), /a partir de/);
  assert.equal(await row('LeverAds FULL').count(), 0, 'arquivado não aparece em Ativos');
  await p.getByRole('group', { name: 'Situação' }).getByRole('button', { name: /^Arquivados/ }).click();
  assert.equal(await row('LeverAds FULL').count(), 1);
  await p.getByRole('group', { name: 'Situação' }).getByRole('button', { name: /^Avulsos/ }).click();
  assert.equal(await row('Pro anual').count(), 1, 'cadastro antigo segue acessível');
  await p.getByRole('group', { name: 'Situação' }).getByRole('button', { name: /^Ativos/ }).click();
  assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));

  // ── Ficha do plano: números, recursos, assinantes e histórico de preço ──
  await escala.click({ position: { x: 20, y: 12 } });
  const drawer = p.getByRole('dialog', { name: 'Plano · Ads Escala + OEM' });
  await drawer.waitFor();
  await h.capture(p, 'plan-drawer-1440');
  const view = await drawer.innerText();
  for (const re of [/Quanto rende/i, /Assinantes ativos/, /Contratado por ano/, /Já recebido/, /Média por cliente/, /Preço de tabela/i, /Anual/, /Cópias por dia/, /Criador OEM/, /Entregáveis na apresentação/i, /Anúncios OEM sem limite mensal/, /Histórico de preço e limites/i, /versão 2/, /versão 1/]) {
    assert.match(view, re);
  }
  assert.ok(await drawer.locator('.plans-sub').count() >= 2, 'lista os assinantes do plano');

  // ── Editar a partir da ficha ────────────────────────────────────────────
  await drawer.getByRole('button', { name: 'Editar plano', exact: true }).click();
  const modal = p.getByRole('dialog', { name: 'editar plano' });
  await modal.waitFor();
  await h.capture(p, 'plan-edit-1440');
  const anual = modal.getByRole('spinbutton', { name: /^Anual/ });
  assert.equal(await anual.inputValue(), '999');
  await anual.fill('1099');
  assert.match(await modal.innerText(), /13\.188/, 'total do período sai do valor mensal');
  assert.equal(await modal.locator('select').count(), 0, 'nenhum dropdown nativo do navegador');
  assert.equal(await modal.getByText(/Grupo/).count(), 0, 'sem campo de grupo: o produto organiza');
  assert.equal(await modal.getByRole('radiogroup', { name: 'Produto' }).count(), 0, 'na edição o produto não muda');
  assert.match(await modal.getByLabel('Produto').innerText(), /^LeverAds/);
  await modal.getByRole('radiogroup', { name: 'Contas', exact: true }).getByRole('radio', { name: 'Ilimitado' }).click();
  assert.equal(await modal.getByRole('radiogroup', { name: 'Anúncios precificados' }).count(), 0, 'limite do Lever Price não aparece em plano do LeverAds');
  const compat = modal.getByRole('checkbox', { name: 'Compatibilidades' });
  assert.equal(await compat.getAttribute('aria-checked'), 'true');
  await compat.click();
  await modal.getByRole('textbox', { name: 'Entregáveis: motor' }).fill('Anúncios OEM sem limite mensal\nEqualização das contas\n');
  await p.keyboard.press('Escape');
  assert.equal(await modal.isVisible(), true, 'formulário alterado não fecha no Esc');
  await modal.getByRole('button', { name: 'Salvar plano', exact: true }).click();
  await modal.waitFor({ state: 'hidden' });
  const saved = (await mutations(p)).find((m) => m.col === 'plans' && m.method === 'update');
  assert.deepEqual(saved.patch.prices.annual, { per: 1099, total: 13188, installments: 12 });
  assert.equal(saved.patch.prices.semiannual.total, 7182, 'ciclo não mexido segue igual');
  assert.deepEqual(saved.patch.limits, { accounts: null, copiesPerDay: 8000, oemPerMonth: null });
  assert.equal(saved.patch.features.compat, false);
  assert.equal(saved.patch.features.oemCreator, true);
  assert.deepEqual(saved.patch.deliverables, { motor: ['Anúncios OEM sem limite mensal', 'Equalização das contas'], plataforma: ['7 contas incluídas'] });
  assert.equal('code' in saved.patch, false, 'código não é enviado na edição');
  assert.equal('product' in saved.patch || 'access' in saved.patch, false, 'produto não é enviado na edição');
  await p.keyboard.press('Escape');
  await drawer.waitFor({ state: 'hidden' });

  // ── Arquivar e criar ────────────────────────────────────────────────────
  await row('Ads Escala').getByRole('button', { name: '⋯', exact: true }).click();
  await p.getByRole('button', { name: 'Arquivar plano', exact: true }).click();
  await p.waitForFunction(() => window.__reviewMutations.some((m) => m.col === 'plans' && m.patch?.status === 'archived'));
  assert.equal(await p.getByRole('dialog').count(), 0, 'ação da linha não abre a ficha');
  await p.getByRole('button', { name: 'Criar plano', exact: true }).click();
  const create = p.getByRole('dialog', { name: 'criar plano' });
  await create.getByRole('textbox', { name: 'Nome' }).fill('Lever Ads · Plus');
  await create.getByRole('textbox', { name: 'Código' }).fill('ads_plus');
  await h.capture(p, 'plan-create-1440');
  assert.equal(await create.locator('select').count(), 0);
  assert.equal(await create.getByRole('checkbox', { name: 'Edição em massa' }).count(), 1);
  await create.getByRole('radiogroup', { name: 'Produto' }).getByRole('radio', { name: 'LeverPrice' }).click();
  assert.equal(await create.getByRole('checkbox', { name: 'Edição em massa' }).count(), 0, 'módulos do LeverAds só em plano do LeverAds');
  assert.equal(await create.getByRole('radiogroup', { name: 'Anúncios precificados' }).count(), 1);
  await create.getByRole('spinbutton', { name: /^Anual/ }).fill('1500');
  await create.getByRole('button', { name: 'Criar plano', exact: true }).click();
  await create.waitFor({ state: 'hidden' });
  const created = (await mutations(p)).find((m) => m.col === 'plans' && m.method === 'create');
  assert.equal(created.data.code, 'ads_plus');
  assert.equal(created.data.saas, 'leverads');
  assert.equal(created.data.product, 'leverprice');
  assert.deepEqual(created.data.access, { product: 'leverprice' });
  assert.equal(created.data.group, 'LeverPrice', 'agrupamento interno segue o produto');
  assert.equal(created.data.prices.annual.total, 18000);
  assert.equal('semiannual' in created.data.prices, false, 'ciclo em branco não é vendido');

  // ── Fora do catálogo: lista de quem precisa de plano ───────────────────
  const off = p.locator('.plans-summary-links button').first();
  if (await off.count()) {
    await off.click();
    const bucket = p.getByRole('dialog').last();
    await bucket.getByText('Fora do catálogo', { exact: true }).waitFor();
    assert.ok(await bucket.locator('.plans-sub').count() >= 1);
    await p.keyboard.press('Escape');
  }

  // ── Cobranças não tem mais o catálogo; o menu leva pra tela nova ───────
  await p.evaluate(() => { window.location.hash = 'customers'; });
  await p.getByRole('button', { name: 'Cobranças', exact: true }).click();
  await p.locator('.customers-billing-row').first().waitFor();
  assert.equal(await p.locator('.customers-billing-filters').getByRole('button', { name: /^Planos/ }).count(), 0);
  await p.locator('.customers-billing-filters').getByRole('button', { name: '⋯', exact: true }).click();
  await p.getByRole('button', { name: 'Gerenciar planos', exact: true }).click();
  await p.getByRole('heading', { name: 'Planos', exact: true }).waitFor();

  // ── Ficha do cliente: plano, acesso/limites e histórico ─────────────────
  await p.evaluate(() => { window.location.hash = 'customers'; });
  await p.getByLabel('Visualização').getByRole('button', { name: 'Clientes', exact: true }).click();
  const withPlan = await p.evaluate(() => window.SEED.CUSTOMERS.find((c) => c.planCode).name);
  await p.locator('.customers-table-row').filter({ hasText: withPlan }).first().click();
  const peek = p.getByRole('dialog', { name: /^Cliente ·/ });
  await peek.getByRole('button', { name: '⋯', exact: true }).click();
  await p.getByRole('button', { name: 'Gerenciar cobranças', exact: true }).click();
  const action = p.getByRole('dialog', { name: 'Ação do cliente', exact: true });
  await action.getByText('Histórico de plano', { exact: true }).waitFor();
  await action.getByText('Upgrade', { exact: true }).waitFor();
  await h.capture(p, 'customer-plan-1440');
  const panel = await action.innerText();
  assert.match(panel, /Ads Escala \+ OEM · Anual/);
  assert.match(panel, /R\$\s?11\.988.*tabela v1/);
  assert.match(panel, /7 contas · 8\.000 cópias\/dia · OEMs\/mês ilimitados/);
  assert.match(panel, /Edição em massa · Regras automáticas · Estoque Espelho/);
  assert.match(panel, /acesso cortado · fatura vencida/);
  assert.match(panel, /contas: 3 no produto, plano dá 7/);
  assert.match(panel, /Estoque Espelho: desligado no produto, plano dá ligado/);
  assert.match(panel, /Ads Essencial \+ OEM → Ads Escala \+ OEM/);
  await action.getByRole('button', { name: 'Fechar ação', exact: true }).click();

  // ── Editar cliente não tem mais os campos do contrato ───────────────────
  await peek.getByRole('button', { name: 'Editar cliente', exact: true }).click();
  await action.waitFor();
  for (const label of [/^Plano/, /^Ciclo do plano/, /^Status do pagamento/]) assert.equal(await action.getByRole('combobox', { name: label }).count(), 0);
  for (const label of ['Valor anual (ARR)', 'Cliente desde', 'Churn (saída)']) assert.equal(await action.getByText(label, { exact: true }).count(), 0, label);
  assert.equal(await action.getByRole('textbox', { name: /^Conta/ }).count(), 1, 'dados de cadastro seguem aqui');
  await action.getByRole('button', { name: 'Fechar ação', exact: true }).click();
  await action.waitFor({ state: 'hidden' });
  await peek.getByRole('button', { name: '⋯', exact: true }).click();
  assert.equal(await p.getByRole('button', { name: 'Editar plano', exact: true }).count(), 0, 'tudo do contrato fica em Gerenciar cobranças');

  // ── Gerenciar cobranças: contrato num lugar só ──────────────────────────
  await p.getByRole('button', { name: 'Gerenciar cobranças', exact: true }).click();
  await action.waitFor();
  // Produtos contratados: uma assinatura por produto, cada uma com o seu plano.
  const products = action.locator('.contract-sub');
  await products.first().waitFor();
  assert.equal(await products.count(), 1);
  assert.match(await products.first().innerText(), /Ads Escala \+ OEM/);
  assert.match(await products.first().innerText(), /LeverAds · Anual/);
  await h.capture(p, 'customer-contract-1440');
  await products.first().getByRole('button', { name: 'Mudar plano', exact: true }).click();
  const change = p.getByRole('dialog', { name: 'mudar plano' });
  await change.waitFor();
  // O 1º Esc tira o foco do campo; o 2º fecha só o modal de cima.
  await p.keyboard.press('Escape');
  await p.keyboard.press('Escape');
  await change.waitFor({ state: 'hidden' });
  assert.equal(await action.isVisible(), true, 'Gerenciar cobranças continua aberto');

  // Adicionar um SEGUNDO produto: só oferece plano de produto que o cliente ainda não tem.
  await action.getByRole('button', { name: 'Adicionar produto', exact: true }).click();
  const add = action.getByRole('form', { name: 'Adicionar produto' });
  assert.equal(await add.locator('select').count(), 0, 'nenhum dropdown nativo do navegador');
  await add.getByRole('button', { name: /^Plano do novo produto/ }).click();
  assert.equal(await p.getByRole('option', { name: /Ads Essencial/ }).count(), 0, 'LeverAds ele já tem: é troca de plano, não produto novo');
  await p.getByRole('option', { name: /Lever Price · Escala/ }).click();
  assert.equal(await add.getByRole('spinbutton', { name: /^Valor do ciclo/ }).inputValue(), '17964', 'preço de tabela do anual');
  await add.getByRole('radiogroup', { name: 'Ciclo do novo produto' }).getByRole('radio', { name: 'Semestral' }).click();
  assert.equal(await add.getByRole('spinbutton', { name: /^Valor do ciclo/ }).inputValue(), '11382');
  assert.match(await add.innerText(), /10\.000 anúncios/, 'mostra o que o plano dá');
  await h.capture(p, 'customer-add-product-1440');
  await add.getByRole('button', { name: 'Adicionar produto', exact: true }).click();
  await p.waitForFunction(() => window.__reviewMutations.some((m) => m.method === 'addCustomerSubscription'));
  const added = (await mutations(p)).find((m) => m.method === 'addCustomerSubscription');
  assert.deepEqual(added.body, { plan: 'price_escala', cycle: 'semestral', price: 11382 });
  await p.waitForFunction(() => document.querySelectorAll('.contract-sub').length === 2);
  assert.match(await products.nth(1).innerText(), /Lever Price · Escala/);
  assert.match(await products.nth(1).innerText(), /LeverPrice · Semestral/);
  assert.equal(await action.getByRole('button', { name: 'Adicionar produto', exact: true }).count(), 0, 'não sobrou produto de assinatura pra adicionar');
  assert.match(await action.innerText(), /Planos contratados/i, 'o painel mostra um retrato por produto');

  // Contrato: status do pagamento, valor e datas (o plano é o de cada assinatura).
  const contract = action.getByRole('form', { name: 'Contrato do cliente' });
  assert.equal(await contract.locator('select').count(), 0);
  assert.equal(await contract.getByRole('button', { name: /^Plano:/ }).count(), 0, 'com assinatura, o plano não é do cadastro');
  const save = contract.getByRole('button', { name: 'Salvar contrato', exact: true });
  assert.equal(await save.isDisabled(), true, 'sem mudança, nada a salvar');
  await contract.getByRole('radiogroup', { name: 'Status do pagamento' }).getByRole('radio', { name: 'Parcial' }).click();
  await contract.getByRole('spinbutton', { name: /^Valor anual/ }).fill('30000');
  await contract.getByLabel(/^Cliente desde/).fill('2026-05-01');
  await save.click();
  await contract.getByRole('status').waitFor();
  const edit = (await mutations(p)).filter((m) => m.col === 'customers' && m.patch?.paymentStatus).at(-1);
  assert.deepEqual(edit.patch, { paymentStatus: 'partial', arr: 30000, startedAt: '2026-05-01' });
  assert.equal(await save.isDisabled(), true, 'depois de salvar, volta a não ter o que salvar');
  await action.getByRole('button', { name: 'Fechar ação', exact: true }).click();
  assert.equal(await peek.isVisible(), true, 'a ficha continua aberta');
  await p.close();

  // ── Mobile e tema escuro ────────────────────────────────────────────────
  const m = await h.open(390);
  await openPlans(m);
  await h.capture(m, 'plans-390');
  assert.ok(await m.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'sem rolagem horizontal da página a 390px');
  await planRow(m, 'Ads Escala + OEM').click({ position: { x: 20, y: 12 } });
  const md = m.getByRole('dialog', { name: 'Plano · Ads Escala + OEM' });
  await md.waitFor();
  await h.capture(m, 'plan-drawer-390');
  assert.ok(await md.evaluate((e) => e.getBoundingClientRect().right <= window.innerWidth + 1), 'ficha cabe na tela do celular');
  await m.close();
  const d = await h.open(1440, '&theme=dark');
  await openPlans(d);
  await h.capture(d, 'plans-dark-1440');
  await d.close();

  assert.deepEqual(h.errors, [], 'sem erro de página');
  console.log('Planos: menu, resumo, tabela, ficha do plano, editar, arquivar, criar, fora do catálogo, ficha do cliente, mobile e tema escuro conferidos.');
} finally { await h.close(); }
