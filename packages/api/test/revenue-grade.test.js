import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { makeMemRepo } from './helpers/mem-repo.js';
import { gradeForRevenue, estimatedRevenue, REVENUE_GRADE_VERSION } from '../src/lead-grade.js';
import { leadGrade, isIcpLead } from '../src/metrics-core.js';
import { leadTier } from '../../web/src/lib/ui.js';
import { classificar } from '../src/classificacao.js';
import { ensureRevenueClassification } from '../src/migrations.js';
import { dedupMergePatch } from '../src/lead-dedup.js';
import { registerRoutes } from '../src/routes.js';

test('faixas de receita incluem o limite inferior, sem lacunas', () => {
  for (const [value, grade] of [[0,'E'],[49999.99,'E'],[50000,'D'],[99999.99,'D'],[100000,'C'],[199999.99,'C'],[200000,'B'],[499999.99,'B'],[500000,'A'],[999999.99,'A'],[1000000,'S']]) assert.equal(gradeForRevenue(value), grade);
  for (const value of [null, undefined, NaN, Infinity, -1, '200000']) assert.equal(gradeForRevenue(value), null);
});

test('25 combinações: API, snapshot e UI seguem receita, independentemente de contas, anúncios ou produto', () => {
  const orders = ['0-200','200-500','500-1000','1000-2000','2000+'];
  const tickets = ['0-70','70-150','150-300','300-600','600+'];
  const expected = ['EEEED','EEDCB','EDCBA','DCBAS','CBASS'];
  for (let i = 0; i < orders.length; i++) for (let j = 0; j < tickets.length; j++) {
    for (const formProduct of ['oem','ads','price']) {
      const lead = { saas: 'leverads', orders: orders[i], ticket: tickets[j], accounts: '1', listings: '0-500', formProduct };
      const grade = expected[i][j];
      assert.equal(leadGrade(lead), grade);
      assert.equal(classificar(lead).porte, grade);
      assert.equal(leadTier(lead).grade, grade);
      assert.equal(leadTier(lead).legacy, false);
      assert.equal(isIcpLead(lead), ['S','A','B'].includes(grade));
    }
  }
  assert.equal(estimatedRevenue({orders:'2000+',ticket:'300-600'}), 1350000);
});

test('ausentes, parciais e faixas inválidas mantêm a nota legada; sem perfil não inventa E', () => {
  for (const fields of [{}, {orders:'2000+'}, {ticket:'300-600'}, {orders:'inválido',ticket:'300-600'}, {orders:'constructor',ticket:'toString'}]) {
    const lead = {saas:'leverads',accounts:'1',listings:'10000+',...fields};
    assert.equal(leadGrade(lead), 'C');
    assert.equal(leadTier(lead).legacy, true);
    assert.match(leadTier(lead).label, /Legado/);
  }
  assert.equal(leadGrade({}), null);
  assert.equal(leadTier({}).grade, null);
  assert.equal(leadGrade({saas:'uniquekids',accounts:'1',listings:'0-500',orders:'2000+',ticket:'600+'}), 'E');
  assert.equal(leadTier({saas:'uniquekids',accounts:'1'}).legacy, false);
});

test('migração preserva legado/outros produtos e estado comercial; é idempotente', async () => {
  const repo=makeMemRepo();
  await repo.create('products',{id:'leverads',icp:{contact:'Dono da operação',pill:'antigo'}});
  const legacy={id:'old',saas:'leverads',accounts:'3-5',listings:'2000-10000',classificacao:{porte:'A',gmv:null}};
  const other={...legacy,id:'other',saas:'uniquekids',orders:'2000+',ticket:'600+'};
  const modern={id:'new',saas:'leverads',orders:'2000+',ticket:'300-600',accounts:'1',stage:'Ganho',owner:'leo',callAt:'2026-09-22T13:00',amount:5964,classificacao:{porte:'D',custom:'preservado'}};
  for (const lead of [legacy, other, modern]) await repo.create('leads',lead);
  assert.equal(await ensureRevenueClassification(repo),1);
  assert.deepEqual(await repo.get('leads','old'),legacy);
  assert.deepEqual(await repo.get('leads','other'),other);
  const changed=await repo.get('leads','new');
  assert.equal(changed.classificacao.porte,'S');
  assert.equal(changed.classificacao.version,REVENUE_GRADE_VERSION);
  assert.equal(changed.classificacao.custom,'preservado');
  const {classificacao: _,...rest}=changed;
  const {classificacao: __,...before}=modern;
  assert.deepEqual(rest,before);
  const product=await repo.get('products','leverads');
  assert.match(product.icp.pill,/200 mil/);
  assert.equal(product.icp.contact,'Dono da operação');
  const rev=repo.writeRev();
  assert.equal(await ensureRevenueClassification(repo),0);
  assert.equal(repo.writeRev(),rev);
});

test('reenviar formulário completa legado e recalcula sem reabrir lead', () => {
  const lead={saas:'leverads',accounts:'1',stage:'Ganho',classificacao:{porte:'E'}};
  const patch=dedupMergePatch(lead,{orders:'2000+',ticket:'300-600',stage:'Novo lead'});
  assert.equal(patch.classificacao.porte,'S');
  assert.equal(patch.stage,undefined);
});

test('REST recalcula na criação e edição; remover ticket volta ao legado', async t => {
  const repo=makeMemRepo(), app=Fastify();
  registerRoutes(app,repo);t.after(()=>app.close());
  await repo.create('products',{id:'leverads',name:'LeverAds',funnel:[]});
  const created=await app.inject({method:'POST',url:'/api/leads',payload:{name:'Teste receita',saas:'leverads',accounts:'1',orders:'2000+',ticket:'300-600',internal:true}});
  assert.equal(created.statusCode,201);
  const lead=created.json();assert.equal(lead.classificacao.porte,'S');
  const updated=await app.inject({method:'PATCH',url:`/api/leads/${lead.id}`,payload:{orders:'0-200',ticket:'0-70'}});
  assert.equal(updated.statusCode,200);assert.equal(updated.json().classificacao.porte,'E');
  const partial=await app.inject({method:'PATCH',url:`/api/leads/${lead.id}`,payload:{ticket:''}});
  assert.equal(partial.statusCode,200);assert.equal(partial.json().classificacao.version,undefined);
  assert.equal(leadTier(partial.json()).legacy,true);
});
