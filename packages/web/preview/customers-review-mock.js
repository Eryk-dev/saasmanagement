const params=new URLSearchParams(location.search);
export const customersReview=params.get('review')==='customers';
let invoices=[],subs=[],plans=[],received={}, subscriptionReads=0;
export function setupCustomersReview(seed) {
  localStorage.setItem('cockpit_customers_tab','base');
  seed.CUSTOMERS.forEach((c,i)=>{c.leadId=`customer-lead-${i}`;seed.LEADS.push({id:c.leadId,saas:c.saas,name:c.contact,amount:c.arr,planClosed:'anual',paymentMethod:'boleto',stage:'Ganho',wonAt:c.startedAt,accounts:'2',listings:'2-10k'});c.owner=i===4?'':'leo';c.paymentMethod='boleto';c.email=`cliente${i}@example.invalid`;});
  // Catálogo de planos (v2) + um plano do cadastro antigo, como em produção.
  const plan=(code,name,group,order,extra={})=>({id:`plan_leverads_${code}`,v:2,saas:'leverads',code,name,group,order,kind:'subscription',pricing:'table',status:'active',product:'leverads',access:{product:'leverads'},prices:{},options:[],limits:{},priceVersion:1,...extra});
  const modules=oem=>({bulkEdit:true,copyRules:true,stockMirror:true,sac:true,aiQuestions:true,compat:true,oemCreator:oem});
  const cycles=(anu,sem)=>({annual:{per:anu,total:anu*12,installments:12},semiannual:{per:sem,total:sem*6,installments:6}});
  plans=[
    plan('ads_essencial','Ads Essencial','Lever Ads',30,{prices:cycles(497,597),limits:{accounts:3,copiesPerDay:500},features:modules(false)}),
    plan('ads_enterprise','Ads Enterprise','Lever Ads',50,{pricing:'custom'}),
    plan('oem_essencial','Ads Essencial + OEM','Lever OEM',10,{prices:cycles(497,597),limits:{accounts:3,copiesPerDay:500,oemPerMonth:200},features:modules(true)}),
    plan('oem_escala','Ads Escala + OEM','Lever OEM',20,{prices:cycles(999,1197),limits:{accounts:7,copiesPerDay:8000,oemPerMonth:null},features:modules(true),priceVersion:2,deliverables:{motor:['Anúncios OEM sem limite mensal'],plataforma:['7 contas incluídas']},priceLog:[{v:1,at:'2026-09-10T12:00:00.000Z',by:'migration',prices:cycles(899,1097),limits:{accounts:7}},{v:2,at:'2026-09-15T12:00:00.000Z',by:'leo',prices:cycles(999,1197),limits:{accounts:7,copiesPerDay:8000,oemPerMonth:null}}]}),
    plan('ads_escala','Ads Escala','Lever Ads',40,{prices:cycles(999,1197),limits:{accounts:7,copiesPerDay:8000},features:modules(false)}),
    plan('price_escala','Lever Price · Escala','Lever Price',60,{product:'leverprice',line:'price',prices:cycles(1497,1897),limits:{listings:10000},access:{product:'leverprice'}}),
    plan('oem_enterprise','Ads Enterprise + OEM','Lever OEM',80,{pricing:'custom'}),
    plan('oem_pack','Pacote de OEM avulso','Adicionais',90,{kind:'one_off',access:{product:''},options:[{qty:1000,price:2000},{qty:2000,price:3500}],labels:{optionUnit:'anúncios OEM'}}),
    plan('men_curso','Mentoria · Curso','Mentoria',95,{kind:'one_off',product:'mentoria',line:'mentoria',access:{product:''},prices:{once:{total:1000}},labels:{priceLabel:'à vista ou 12x no cartão'}}),
    plan('full','LeverAds FULL','Catálogo anterior',100,{kind:'legacy',pricing:'custom',status:'archived'}),
    {id:'annual-review',saas:'leverads',name:'Pro anual',price:2400,cycle:'annual'},
  ];
  seed.CONFIG={...(seed.CONFIG||{}),plans:{leverads:plans.filter(p=>p.code).map(p=>({id:p.id,code:p.code,name:p.name,kind:p.kind,pricing:p.pricing,group:p.group,status:p.status,prices:p.prices,options:p.options,limits:p.limits,features:p.features||{},product:p.product,accessProduct:p.access.product,priceVersion:p.priceVersion}))}};
  const first=seed.CUSTOMERS[0];
  if(first)Object.assign(first,{plan:'Ads Escala + OEM · Anual',planCode:'oem_escala',planCycle:'anual',planCustom:'',leveradsOrgId:'org-review',planSnapshot:{code:'oem_escala',name:'Ads Escala + OEM',closedPlan:'anual',cycle:'annual',priceVersion:1,listPrice:11988,limits:{accounts:7,copiesPerDay:8000,oemPerMonth:null},features:modules(true),accessProduct:'leverads'}});
  subs=seed.CUSTOMERS.map((c,i)=>({id:`sub-${c.id}`,saas:c.saas,customer:c.id,plan:'annual-review',price:c.arr,cycle:'annual',status:i===7?'canceled':i===0?'past_due':'active',periodEnd:`2026-09-${20+i}`}));
  // A assinatura do primeiro cliente carrega o plano do catálogo (o plano vive na assinatura).
  if(first){const s0=subs.find(s=>s.customer===first.id);if(s0)Object.assign(s0,{plan:'plan_leverads_oem_escala',planCode:'oem_escala',planSnapshot:{...first.planSnapshot,product:'leverads'}});first.products=['leverads'];}
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
  planStats:async()=>{
    const blank=()=>({active:0,churned:0,arr:0,mrr:0,received:0,customers:[]});
    const out={plans:Object.fromEntries(plans.filter(p=>p.code).map(p=>[p.code,blank()])),custom:blank(),none:blank()};
    window.SEED.CUSTOMERS.forEach((c,i)=>{
      const code=c.planCode||['oem_escala','oem_essencial','ads_escala','price_escala','','ads_escala','oem_escala','oem_essencial'][i%8];
      const b=out.plans[code]||(i%2?out.custom:out.none),ended=!!c.endedAt,arr=Number(c.arr)||0,cash=received[c.id]||0;
      if(ended)b.churned++;else{b.active++;b.arr+=arr;}
      b.received+=cash;b.customers.push({id:c.id,name:c.name,cycle:'anual',arr,received:cash,startedAt:c.startedAt||'',endedAt:ended?c.endedAt:'',listPrice:null,priceVersion:null});
    });
    const total=blank();delete total.customers;
    for(const b of [...Object.values(out.plans),out.custom,out.none]){b.mrr=Math.round(b.arr/12);total.active+=b.active;total.churned+=b.churned;total.arr+=b.arr;total.received+=b.received;}
    total.mrr=Math.round(total.arr/12);
    return {...out,total};
  },
  addCustomerSubscription:async(id,body)=>{const plan=plans.find(p=>p.code===body.plan),customer=window.SEED.CUSTOMERS.find(c=>c.id===id);
    const cycle={anual:'annual',semestral:'semiannual'}[body.cycle];
    const sub={id:`sub-add-${subs.length}`,saas:customer.saas,customer:id,status:'active',cycle,price:body.price,plan:plan.id,planCode:plan.code,periodStart:'2026-09-18',periodEnd:'2027-03-18',
      planSnapshot:{code:plan.code,name:plan.name,cycle,priceVersion:1,listPrice:plan.prices?.[cycle]?.total??null,limits:plan.limits,features:plan.features||{},product:plan.product||'leverads',accessProduct:plan.access.product}};
    subs=[...subs,sub];customer.products=[...new Set([...(customer.products||[]),sub.planSnapshot.product])];
    window.__reviewMutations.push({method:'addCustomerSubscription',id,body});return {ok:true,subscription:sub,customer};},
  planHistory:async id=>id===window.SEED.CUSTOMERS[0]?.id?[
    {id:'pc2',type:'upgrade',at:'2026-09-10T15:00:00.000Z',effectiveAt:'2026-09-10T15:00:00.000Z',from:{planCode:'oem_essencial',planName:'Ads Essencial + OEM',cycle:'annual',price:5964},to:{planCode:'oem_escala',planName:'Ads Escala + OEM',cycle:'annual',price:11988},author:'leo'},
    {id:'pc1',type:'start',at:'2026-07-01T15:00:00.000Z',effectiveAt:'2026-07-01T15:00:00.000Z',from:null,to:{planCode:'oem_essencial',planName:'Ads Essencial + OEM · Anual',cycle:'anual',arr:5964},author:'leo'},
  ]:[],
  customerEntitlements:async id=>id===window.SEED.CUSTOMERS[0]?.id?{customer:id,orgs:{leverads:'org-review',leverprice:'',leverid:''},
    entitlements:[{product:'leverads',access:{active:false,kind:'paid',reason:'fatura vencida (past_due)'},planCode:'oem_escala',planName:'Ads Escala + OEM',limits:{accounts:7,oemPerMonth:null},features:{},ref:'sub',source:'plan'}],
    lastReport:{at:'2026-09-18T14:50:00.000Z',mode:'dry-run',access:[],errors:[],limits:{planned:[{customer:id,product:'leverads',plan:'oem_escala',changes:{paid_seats:{from:3,to:7},creator_quota_limit:{from:200,to:null},stock_mirror_enabled:{from:false,to:true}}}],skipped:[],unsupported:[]}}}
    :{customer:id,orgs:{leverads:'',leverprice:'',leverid:''},entitlements:null,lastReport:null},
  remove:async(col,id)=>{if(col==='plans')plans=plans.filter(p=>p.id!==id);window.__reviewMutations.push({method:'remove',col,id});return {ok:true,id};},
  billingReceived:async()=>{if(params.has('holdReceived'))await new Promise(resolve=>{window.__reviewReleaseReceived=resolve;});return received;},
  mpPayments:async()=>({payments:[]}),
  payInvoice:async id=>{const inv=invoices.find(i=>i.id===id);if(inv){inv.status='paid';inv.paidAt=new Date().toISOString();received[inv.customer]=(received[inv.customer]||0)+inv.amount;}window.__reviewMutations.push({method:'payInvoice',id});return inv;},
  update:async(col,id,patch)=>{const row=col==='plans'?plans.find(r=>r.id===id):window.SEED[col.toUpperCase()]?.find(r=>r.id===id);if(row)Object.assign(row,patch);window.__reviewMutations.push({method:'update',col,id,patch});return row;},
  create:async(col,data)=>{const row={...data,id:`review-${window.__reviewMutations.length}`};if(col==='plans'){Object.assign(row,{id:`plan_${data.saas}_${data.code}`,v:2,status:'active',priceVersion:1});plans=[...plans,row];}else (window.SEED[col.toUpperCase()]||=[]).push(row);window.__reviewMutations.push({method:'create',col,data});return row;},
  caseFromCustomer:async id=>{const c=window.SEED.CUSTOMERS.find(c=>c.id===id);const result={id:`case-${id}`,saas:c.saas,customerId:id,name:c.name,metrics:[],blockers:['autorização']};window.SEED.CASES.push(result);window.__reviewMutations.push({method:'caseFromCustomer',id});return result;},
  referralQueue:async()=>({rows:[],totals:{pedir:0,descanso:0,provaFraca:0,semProva:0,influencedSum:0},coverage:{customers:8,withOrg:0}}),
  customerChurn:async(id,data)=>{const customer=window.SEED.CUSTOMERS.find(c=>c.id===id);Object.assign(customer,{endedAt:data.endedAt,churnReason:data.reason,churnNote:data.note});window.__reviewMutations.push({method:'customerChurn',id,data});return {customer};},
  customerUnchurn:async id=>{const customer=window.SEED.CUSTOMERS.find(c=>c.id===id);customer.endedAt=null;window.__reviewMutations.push({method:'customerUnchurn',id});return {customer};},
  unpayInvoice:async id=>{const inv=invoices.find(i=>i.id===id);inv.status='open';window.__reviewMutations.push({method:'unpayInvoice',id});return inv;},
  invoiceMpLink:async id=>{window.__reviewMutations.push({method:'invoiceMpLink',id});return {url:`https://example.invalid/invoice/${id}`};},

};
