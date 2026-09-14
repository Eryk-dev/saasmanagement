// Cenários de Clientes para o preview. Sem banco, pagamentos ou mensagens reais.
const iso = (days) => new Date(Date.now() + days * 86400000).toISOString();
export const customerCollections = {
  plans: [{ id: 'plan-pro', saas: 'leverads', name: 'Pro mensal', price: 2400, cycle: 'monthly' }],
  subscriptions: [
    { id: 'sub-1', saas: 'leverads', customer: 'c1', plan: 'plan-pro', price: 2400, cycle: 'monthly', status: 'past_due', periodStart: iso(-35), periodEnd: iso(-5) },
    { id: 'sub-3', saas: 'leverads', customer: 'c3', plan: 'plan-pro', price: 2850, cycle: 'monthly', status: 'active', periodStart: iso(-25), periodEnd: iso(5) },
  ],
  invoices: [
    { id: 'inv-1', saas: 'leverads', customer: 'c1', subscription: 'sub-1', title: 'Mensalidade de setembro', amount: 2400, status: 'overdue', dueDate: iso(-5), kind: 'renewal' },
    { id: 'inv-2', saas: 'leverads', customer: 'c3', subscription: 'sub-3', title: 'Mensalidade de setembro', amount: 2850, status: 'open', dueDate: iso(5), kind: 'renewal' },
    { id: 'inv-3', saas: 'leverads', customer: 'c1', subscription: 'sub-1', title: 'Mensalidade de agosto', amount: 2400, status: 'paid', dueDate: iso(-35), paidAt: iso(-35), kind: 'renewal' },
  ],
};
export const customersMock = {
  billingReceived: () => ({ c1: 9600, c2: 150000, c3: 8550 }),
  mpPayments: () => ({ payments: [] }),
  mpPreapprovals: () => ({ preapprovals: [] }),
  referralQueue: () => ({ rows: [], totals: { pedir: 0, descanso: 0, provaFraca: 0, semProva: 0, influencedSum: 0 }, coverage: { customers: 7, withOrg: 0 } }),
  payInvoice: (id) => { const row=customerCollections.invoices.find(i=>i.id===id); if(!row)throw new Error('Fatura não encontrada'); row.status='paid';row.paidAt=iso(0);return {...row}; },
  unpayInvoice: (id) => { const row=customerCollections.invoices.find(i=>i.id===id); if(!row)throw new Error('Fatura não encontrada'); row.status='open';row.paidAt='';return {...row}; },
};
