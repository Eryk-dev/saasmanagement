const params=new URLSearchParams(location.search);
export const customersReview=params.get('review')==='customers';
let invoices=[],subs=[],plans=[],received={}, subscriptionReads=0;
export function setupCustomersReview(seed) {
  localStorage.setItem('cockpit_customers_tab','base');
  seed.CUSTOMERS.forEach((c,i)=>{c.leadId=`customer-lead-${i}`;seed.LEADS.push({id:c.leadId,saas:c.saas,name:c.contact,amount:c.arr,planClosed:'anual',paymentMethod:'boleto',stage:'Ganho',wonAt:c.startedAt,accounts:'2',listings:'2-10k'});c.owner=i===4?'':'leo';c.paymentMethod='boleto';c.email=`cliente${i}@example.invalid`;});
  plans=[{id:'annual-review',saas:'leverads',name:'Pro anual',price:2400,cycle:'annual'}];
  subs=seed.CUSTOMERS.map((c,i)=>({id:`sub-${c.id}`,saas:c.saas,customer:c.id,plan:'annual-review',price:c.arr,cycle:'annual',status:i===7?'canceled':i===0?'past_due':'active',periodEnd:`2026-09-${20+i}`}));
  invoices=seed.CUSTOMERS.slice(0,6).map((c,i)=>({id:`inv-${c.id}`,saas:c.saas,customer:c.id,subscription:`sub-${c.id}`,amount:[2400,3000,2850,1800,3400,1650][i],status:i<3?'overdue':'open',dueDate:`2026-09-${10+i*3}`,kind:'installment',installmentN:2,installmentOf:12,title:'Parcela do contrato'}));
  received=Object.fromEntries(seed.CUSTOMERS.map((c,i)=>[c.id,c.arr*[.5,.75,1,.25][i%4]]));
  if(params.get('state')==='empty'){seed.CUSTOMERS=[];subs=[];invoices=[];received={};}
  if(params.has('many')){const base=seed.CUSTOMERS[0];for(let i=8;i<72;i++)seed.CUSTOMERS.push({...base,id:`many-${i}`,name:`Cliente ${i}`});}
  seed.CASES=[];
  seed.INVOICES=invoices;seed.SUBSCRIPTIONS=subs;seed.PLANS=plans;
  window.__reviewMutations=[];
}
export const customersReviewMock={
  list:async col=>{if(col==='subscriptions'&&++subscriptionReads===2&&params.has('billingFail'))throw new Error('Falha na leitura das cobranças');return col==='invoices'?invoices:col==='subscriptions'?subs:col==='plans'?plans:window.SEED[col.toUpperCase()]||[];},
  billingReceived:async()=>{if(params.has('holdReceived'))await new Promise(resolve=>{window.__reviewReleaseReceived=resolve;});return received;},
  mpPayments:async()=>({payments:[]}),
  payInvoice:async id=>{const inv=invoices.find(i=>i.id===id);if(inv){inv.status='paid';inv.paidAt=new Date().toISOString();received[inv.customer]=(received[inv.customer]||0)+inv.amount;}window.__reviewMutations.push({method:'payInvoice',id});return inv;},
  update:async(col,id,patch)=>{const row=window.SEED[col.toUpperCase()]?.find(r=>r.id===id);if(row)Object.assign(row,patch);window.__reviewMutations.push({method:'update',col,id,patch});return row;},
  create:async(col,data)=>{const row={...data,id:`review-${window.__reviewMutations.length}`};(window.SEED[col.toUpperCase()]||=[]).push(row);window.__reviewMutations.push({method:'create',col,data});return row;},
  caseFromCustomer:async id=>{const c=window.SEED.CUSTOMERS.find(c=>c.id===id);const result={id:`case-${id}`,saas:c.saas,customerId:id,name:c.name,metrics:[],blockers:['autorização']};window.SEED.CASES.push(result);window.__reviewMutations.push({method:'caseFromCustomer',id});return result;},
  referralQueue:async()=>({rows:[],totals:{pedir:0,descanso:0,provaFraca:0,semProva:0,influencedSum:0},coverage:{customers:8,withOrg:0}}),
  customerChurn:async(id,data)=>{const customer=window.SEED.CUSTOMERS.find(c=>c.id===id);Object.assign(customer,{endedAt:data.endedAt,churnReason:data.reason,churnNote:data.note});window.__reviewMutations.push({method:'customerChurn',id,data});return {customer};},
  customerUnchurn:async id=>{const customer=window.SEED.CUSTOMERS.find(c=>c.id===id);customer.endedAt=null;window.__reviewMutations.push({method:'customerUnchurn',id});return {customer};},
  unpayInvoice:async id=>{const inv=invoices.find(i=>i.id===id);inv.status='open';window.__reviewMutations.push({method:'unpayInvoice',id});return inv;},
  invoiceMpLink:async id=>{window.__reviewMutations.push({method:'invoiceMpLink',id});return {url:`https://example.invalid/invoice/${id}`};},

};
