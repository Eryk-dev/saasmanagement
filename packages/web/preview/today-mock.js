const params = new URLSearchParams(location.search);
export const todayReview = params.get('review') === 'today';
let activities = [];
export function setupTodayReview(seed) {
  if (params.has('followup')) {
    const product = seed.SAAS[0];
    product.funnel.push({stage:'Follow-up',kind:'followup'}, {stage:'Dia 2',kind:'contato'}, {stage:'Dia 3',kind:'contato'}, {stage:'Nutrição',kind:'contato'});
    product.nextSteps = {followup:['ganho','nutricao','contato']};
    // Follow-up em 4 contatos: Carla já fez o Contato 1 e o 2 vence hoje (dia, sem hora).
    Object.assign(seed.LEADS.find(l => l.id === 'l5'), {stage:'Follow-up',closer:'leo',stageAttempts:5,followupStep:1,followupAt:'2026-09-18',nextActionAt:'2026-09-18T03:00:00.000Z'});
    // &fupLate: o dia do Contato 2 já passou (ontem) — card vermelho e alerta.
    if (params.has('fupLate')) Object.assign(seed.LEADS.find(l => l.id === 'l5'), {followupAt:'2026-09-17',nextActionAt:'2026-09-17T03:00:00.000Z'});
  }
  // &closing: Próximo passo da call com Integração/Ganho e o catálogo de PLANOS
  // da plataforma (CONFIG.plans) + a projeção que o servidor manda pro gate.
  if (params.has('closing')) {
    const product = seed.SAAS[0];
    product.funnel.splice(4, 0, {stage:'Follow-up',kind:'followup'}, {stage:'Integração',kind:'integracao'});
    product.nextSteps = {...(product.nextSteps||{}), call:['followup','integracao','ganho','desqualificado']};
    seed.USERS.push({id:'eryk',name:'Eryk',roles:['integrator'],saas:''});
    const cycles=(anu,sem)=>({annual:{per:anu,total:anu*12},semiannual:{per:sem,total:sem*6}});
    const plan=(code,name,order,extra={})=>({id:`plan_leverads_${code}`,code,name,order,kind:'subscription',pricing:'table',status:'active',product:'leverads',prices:{},options:[],limits:{},features:{},...extra});
    const plans=[
      plan('oem_escala','Ads Escala + OEM',20,{prices:cycles(999,1197)}),
      plan('ads_essencial','Ads Essencial',30,{prices:cycles(497,597)}),
      plan('ads_trimestral','Ads Só Anual',35,{prices:{annual:{per:450,total:5400}}}),
      plan('ads_enterprise','Ads Enterprise',50,{pricing:'custom'}),
      plan('price_escala','Lever Price · Escala',60,{product:'leverprice',prices:cycles(1497,1897)}),
      plan('oem_pack','Pacote de OEM avulso',90,{kind:'one_off',options:[{qty:1000,price:2000},{qty:2000,price:3500}]}),
      plan('full','LeverAds FULL',100,{kind:'legacy',pricing:'custom',status:'archived'}),
      plan('ads_velho','Ads Antigo',110,{status:'archived',prices:cycles(300,350)}),
    ];
    const deal=(p)=>({id:p.code,label:p.name,group:'Lever',prices:[['annual','anual','Anual'],['semiannual','semestral','Semestral']].filter(([c])=>p.prices[c]).map(([c,id,l])=>({plan:id,label:l,value:p.prices[c].total}))});
    seed.CONFIG={...seed.CONFIG,plans:{leverads:plans},proposals:{...(seed.CONFIG.proposals||{}),catalog:{leverads:[
      ...plans.filter(p=>p.kind==='subscription'&&p.pricing==='table'&&p.status!=='archived').map(deal),
      {id:'oem_pack',label:'Pacote de OEM avulso',group:'Adicionais',oneOff:true,prices:[{plan:'unico',label:'1.000 anúncios OEM',value:2000},{plan:'unico',label:'2.000 anúncios OEM',value:3500}]},
      {id:'men_curso',label:'Mentoria · Curso',group:'Mentoria',oneOff:true,prices:[{plan:'unico',label:'à vista ou 12x no cartão',value:1000}]},
    ]}}};
  }
  if (params.has('card')) {
    const futureDate=(days)=>{const d=new Date();d.setDate(d.getDate()+days);d.setHours(16,0,0,0);return d.toISOString();};
    const base=seed.LEADS.find(l=>l.name==='Carla Nunes');
    seed.LEADS.push(...Array.from({length:7},(_,i)=>({...base,id:`future-${i}`,name:`Futuro ${i+1}`,nextActionAt:futureDate(1)})));
    seed.LEADS.push({...base,id:'future-later',name:'Mais adiante',nextActionAt:futureDate(4)});
    Object.assign(seed.LEADS.find(l=>l.name==='Bruno Teixeira'), {niche:'auto',need:'Preciso organizar a gestão de estoque entre todas as contas e acompanhar os produtos com maior giro.\nTambém quero criar anúncios mais rápido.',proposta_id:'card-preview',proposalUrl:'/p/card-preview',proposal_edit_url:'/p/card-preview?k=review'});
    seed.SAAS[0].leadQuestions=[{key:'niche',label:'Qual é o principal nicho de produtos que você vende nos marketplaces?',options:[{value:'auto',label:'Autopeças e acessórios para veículos de diferentes marcas e modelos'}]},{key:'need',label:'O que fez você procurar uma solução agora?',options:[]},{key:'accounts',label:'Quantas contas?',options:[{value:'2',label:'2 contas'},{value:'3-5',label:'3 a 5 contas'}]}];
  }
  // &closing&orphan: marcação pelo link sem card — o aviso no sino abre a
  // escolha do card (Rita está aguardando marcar; Paulo sem horário).
  if (params.has('orphan')) {
    const sent = new Date(Date.now() - 2 * 3600_000).toISOString();
    seed.LEADS.push(
      {id:'orf-rita',saas:'leverads',name:'Rita Moura',company:'Moura Café',stage:'Integração',integrator:'eryk',integrationLinkSentAt:sent,integrationLinkUser:'eryk',createdAt:'2026-09-01T10:00:00Z'},
      {id:'orf-paulo',saas:'leverads',name:'Paulo Dias',company:'Dias Pneus',stage:'Integração',integrator:'eryk',createdAt:'2026-09-01T10:00:00Z'},
    );
  }
  if (params.get('state') === 'empty') seed.LEADS = [];
  if (params.has('many')) seed.LEADS = [...seed.LEADS, ...Array.from({length:15},(_,i)=>({...seed.LEADS.find(l=>l.id==='l3'), id:`extra-${i}`, name:`Lead ${i + 1}`, company:`Empresa ${i + 1}`}))];
  if (params.has('callSummary')) {
    const summary = { compromissos:['Enviar proposta até sexta.'], objecoes:[{objecao:'Preço acima do orçamento',resolvida:false}],
      retomada:{combinado:'Retornar sexta para decidir com o sócio.',objecoes:'Preço acima do orçamento, ainda em aberto.',beneficios:'Reduzir o trabalho manual nas três contas.'} };
    if (params.has('legacySummary')) delete summary.retomada;
    activities = [
      {id:'sale-old',lead:'l5',type:'system',at:'2026-09-15T15:00:00Z',meta:{event:'call_summary',kind:'call',summary:{compromissos:['Combinado antigo']}}},
      {id:'sale',lead:'l5',type:'system',at:'2026-09-16T15:00:00Z',meta:{event:'call_summary',kind:'call',summary}},
      {id:'integration',lead:'l5',type:'system',at:'2026-09-17T15:00:00Z',meta:{event:'call_summary',kind:'integracao',summary:{resumo:'Integração posterior',sentimento:'satisfeito'}}},
    ];
  }
  window.__reviewMutations = [];
}
// Tela zero do deck de slides (card de Atividades): catálogo com os nomes da
// tela Planos, um pacote além de Essencial/Escala e o Lever Price. `deckIframe`
// simula proposta sem slides (o card cai no iframe da página).
const deckCatalog = {
  lines: { ads: { name: 'Lever Ads' }, oem: { name: 'Lever OEM' }, price: { name: 'Lever Price' } },
  addons: { contaExtra: { per: 100 } },
  oemPacks: [{ qty: 1000, price: 4000 }, { qty: 2000, price: 7000 }],
  products: {
    ads_essencial: { name: 'Ads Essencial', line: 'ads', tier: 'essencial', contas: 3, inclui: {}, anu: { per: 497 }, sem: { per: 597 } },
    ads_escala: { name: 'Ads Escala', line: 'ads', tier: 'escala', contas: 6, inclui: {}, anu: { per: 997 }, sem: { per: 1097 } },
    ads_enterprise: { name: 'Ads Enterprise', line: 'ads', tier: 'enterprise', contas: 20, inclui: {}, anu: { per: 2997 }, sem: { per: 3297 } },
    oem_essencial: { name: 'Ads Essencial + OEM', line: 'oem', tier: 'essencial', contas: 3, inclui: {}, anu: { per: 597 }, sem: { per: 697 } },
    price_escala: { name: 'Lever Price · Escala', line: 'price', tier: 'escala', contas: 0, inclui: {}, anu: { per: 297 }, sem: { per: 347 } },
  },
};
let deckCfg = { nome: 'Bruno', empresa: 'Auto Peças Já', contas: 3, pedidos: 0, ticket: 0, vistaPct: 0, plataforma: true, linha: 'ads', tier: 'essencial', price: false, priceTier: 'escala', oem: false, oemPack: '1000', periodo: 'anual' };
export const todayMock = {
  get: async (col,id) => window.SEED[col.toUpperCase()]?.find(row=>row.id===id),
  notifications: async () => {
    if (!new URLSearchParams(location.search).has('orphan')) return { unread: 0, items: [] };
    const read = (window.__orphanRead ||= false);
    return { unread: read ? 0 : 1, items: [{ id: 'no_orf', user: 'leo', type: 'integration_booking', text: 'Rita M. marcou qui 09/10 10:00 pelo seu link de convite e não achei o card: toque para ligar a um card', by: 'api', at: new Date().toISOString(), read, link: { screen: 'today', booking: 'ev_orf', bookingUser: 'eryk' } }] };
  },
  notificationsRead: async () => { window.__orphanRead = true; return { ok: true }; },
  linkBooking: async (eventId, body) => { window.__reviewMutations.push({ method: 'linkBooking', eventId, body }); return { ok: true }; },
  // &gbusy: agenda do Google do Eryk conectada, com 10:00–11:30 ocupados no dia pedido.
  googleBusy: async (user, from) => (new URLSearchParams(location.search).has('gbusy') && user === 'eryk'
    ? { connected: true, busy: [{ start: `${from}T10:00:00-03:00`, end: `${from}T11:30:00-03:00` }] }
    : { connected: false, busy: [] }),
  proposalConfig: async (id) => {
    const lead = window.SEED.LEADS.find(l=>l.id===id);
    if (!lead?.proposta_id) return { proposal: null, layout: '' };
    if (params.has('deckIframe')) return { proposal: null, layout: 'oem' };
    return { proposal: lead.proposta_id, layout: 'slides', cfg: { ...deckCfg }, catalog: deckCatalog };
  },
  saveProposalConfig: async (id, cfg) => {
    window.__reviewMutations.push({method:'saveProposalConfig',id,cfg});
    deckCfg = { ...cfg };
    return { proposal: 'card-preview', layout: 'slides', cfg: { ...deckCfg }, catalog: deckCatalog };
  },
  generateProposal: async (id,options) => {
    window.__reviewMutations.push({method:'generateProposal',id,options});
    if (params.has('proposalFail')) return {ok:false};
    const lead=window.SEED.LEADS.find(l=>l.id===id);
    Object.assign(lead,{proposta_id:'card-preview',proposalUrl:'/p/card-preview',proposal_edit_url:'/p/card-preview?k=review'});
    return {ok:true,lead};
  },
  shareProposal: async (id,offer) => {
    window.__reviewMutations.push({method:'shareProposal',id,offer});
    return {url:'https://client.example/proposal'};
  },
  list: async col => col === 'leads' ? window.SEED.LEADS : [],
  listActivities: async id => activities.filter(activity => activity.lead === id),
  update: async (col, id, patch) => {
    window.__reviewMutations.push({method:'update',col,id,patch});
    const row = window.SEED[col.toUpperCase()]?.find(row=>row.id===id);
    if (row) Object.assign(row,patch);
    return row;
  },
  logActivity: async data => {
    const row = {...data,id:`review-${activities.length}`,at:new Date().toISOString()};
    activities.push(row); window.__reviewMutations.push({method:'logActivity',data}); return row;
  },
};
