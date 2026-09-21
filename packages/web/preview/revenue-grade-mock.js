import { REVENUE_ICP } from '../../api/src/lead-grade.js';

// ?shell=1&review=pipeline&revenueGrades=1#pipeline — dados fictícios, sem API.
export function setupRevenueGrades(seed) {
  seed.SAAS.find(p => p.id === 'leverads').icp = { ...REVENUE_ICP, contact: 'Dono da operação' };
  const base = seed.LEADS[0];
  seed.LEADS = [
    { name: 'Receita S', orders: '2000+', ticket: '300-600' },
    { name: 'Receita A', orders: '2000+', ticket: '150-300' },
    { name: 'Receita B', orders: '2000+', ticket: '70-150' },
    { name: 'Receita C', orders: '1000-2000', ticket: '70-150' },
    { name: 'Receita D', orders: '200-500', ticket: '150-300' },
    { name: 'Receita E', orders: '0-200', ticket: '70-150' },
    { name: 'Legado A', accounts: '3-5', listings: '2000-10000' },
    { name: 'Legado parcial', accounts: '1', listings: '10000+', orders: '2000+' },
    { name: 'Sem qualificação', accounts: '', listings: '' },
  ].map((lead, i) => ({ ...base, accounts: '', listings: '', volume: '', orders: '', ticket: '', ...lead, id: `revenue-preview-${i}`, saas: 'leverads', stage: 'Novo lead' }));
}
