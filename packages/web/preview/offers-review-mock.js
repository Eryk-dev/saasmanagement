const params=new URLSearchParams(location.search);
export const offersReview=params.get('review')==='offers';
let groups=[];
export function setupOffersReview(seed) {
 seed.CONFIG.mp.configured=!params.has('disconnected');
 const source=[
 ['Galante Holding','(11) 98421-3307','customer', [['waiting',8250,'Lever Price · Enterprise · parcela 09/12',5],['waiting',2230,'Pacote de OEM avulso',2],['paid',16500,'Lever Price · Enterprise · parcela 08/12',34,'mp']]],
 ['Studio Kern','(11) 99110-4482','customer',[['waiting',2000,'Lever Ads · Escala · parcela 01/12',12],['paid',24000,'Lever Ads · Escala · anual à vista',2,'mp']]],
 ['Fernanda Luz','(11) 98750-2213','lead',[['waiting',24000,'Lever Ads · Escala · anual',3],['superseded',21600,'Lever Ads · Escala · anual (com desconto)',6]]],
 ['Menezes Auto','(11) 99632-8140','customer',[['rejected',6400,'Lever OEM · Essencial · cartão recusado',4]]],
 ['Clínica Arbo','(11) 98233-9017','customer',[['paid',24000,'Lever Ads · Escala · anual à vista',8,'mp']]],
 ['Nutri Vitta','(11) 99024-7781','customer',[['paid',4800,'Pacote de OEM avulso',3,'manual']]],
 ['Oficina Prado','(11) 98466-1120','customer',[['paid',9600,'Lever Ads · Essencial · semestral',4,'invoice']]],
 ['Mercado Ponto','(11) 99873-5502','customer',[['paid',6400,'Lever OEM · Essencial · semestral',10,'mp']]],
 ['Grupo Vante','(11) 98115-6644','customer',[['paid',9600,'Lever Ads · Essencial · semestral',15,'mp']]],
 ['Paulo Ferraz','(11) 99341-0072','lead',[['waiting',14400,'Lever Price · Escala · anual',1]]],
 ['Instituto Rima','(11) 98620-3391','customer',[['paid',19600,'Lever Price · Essencial · anual',22,'mp']]],
 ['Padaria Dovale','(11) 99537-8823','customer',[['paid',14400,'Lever Price · Escala · anual',18,'manual']]],
 ];
 groups=source.map(([name,phone,kind,links],i)=>({key:`g${i}`,name,phone,kind,lead:kind==='lead'?`lead-${i}`:'',customer:kind==='customer'?`customer-${i}`:'',links:links.map(([status,amount,title,days,paidBy],j)=>({id:`l${i}-${j}`,saas:'leverads',status,amount,title,paidBy,createdAt:new Date(Date.now()-days*86400000).toISOString(),origin:['card','tela','fatura'][(i+j)%3],url:`https://mpago.la/${2100+i*7+j}`,targetName:name,targetPhone:phone,payerEmail:`cliente${i}@example.test`,createdBy:i%2?'lucas':'tiago',invoice:paidBy==='invoice'||(i===1&&j===0)?`invoice-${i}-${j}`:'',manualPaid:paidBy==='manual'?{method:'pix',note:'Observação privada removida da apresentação',by:'leo'}:null,payment:paidBy==='mp'?{method:'pix'}:null}))}));
 seed.CUSTOMERS=groups.filter(g=>g.kind==='customer').map(g=>({id:g.customer,saas:'leverads',name:g.name,phone:g.phone,plan:'Anual'}));
 seed.LEADS=groups.filter(g=>g.kind==='lead').map(g=>({id:g.lead,saas:'leverads',name:g.name,phone:g.phone,stage:'Proposta',amount:24000,email:'lead@example.test'}));
 if(params.get('state')==='empty')groups=[];
 if(params.has('closer'))seed.ME={id:'lucas',name:'Lucas',roles:['closer']};
 window.__reviewMutations=[];window.__reviewReads=[];
}
const bucket=l=>l.status==='paid'?'paid':l.status==='superseded'?'superseded':['rejected','cancelled','refunded','charged_back'].includes(l.status)?'failed':'waiting';
function summary(source) {
 const totals={generated:0,paid:0,waiting:0,failed:0},counts={links:0,paid:0,groups:{todos:source.length,aguardando:0,pagos:0,recusados:0}};
 const rows=source.map(g=>{const t={generated:0,paid:0,waiting:0,failed:0},c={links:0};for(const l of g.links){const b=bucket(l);if(b==='superseded')continue;t[b]+=l.amount;t.generated+=l.amount;c.links++;if(b==='paid')counts.paid++;}for(const k in t)totals[k]+=t[k];counts.links+=c.links;for(const [k,b]of[['aguardando','waiting'],['pagos','paid'],['recusados','failed']])if(t[b]>0)counts.groups[k]++;return{...g,totals:t,counts:c,lastAt:g.links.map(l=>l.createdAt).sort().at(-1)};});
 return{groups:rows,totals,counts,sellers:[{id:'lucas',name:'Lucas'},{id:'tiago',name:'Tiago'}],backlog:{count:8,waiting:9000}};
}
function change(method,id,body,invoice=false){const l=groups.flatMap(g=>g.links).find(l=>(invoice?l.invoice:l.id)===id);l.status=method.startsWith('unpay')?'waiting':'paid';l.paidBy=l.status==='paid'?(invoice?'invoice':'manual'):null;l.manualPaid=body;window.__reviewMutations.push({method,id,body});return l;}
function create(method,id,body){const g=groups.find(g=>g.lead===id||g.customer===id);const l={id:`new-${g.links.length}`,status:'waiting',amount:body.amount,title:body.title,url:'https://mpago.la/review-new',createdAt:new Date().toISOString(),origin:body.origin,targetName:g.name,targetPhone:g.phone,createdBy:'lucas'};g.links.unshift(l);window.__reviewMutations.push({method,id,body});return{url:l.url};}
export const offersReviewMock={
 paymentLinks:async args=>{window.__reviewReads.push(args);if(params.has('holdHistory'))await new Promise(resolve=>{window.__releaseHistory=resolve;});return summary(args.saas==='leverads'?groups.map(g=>({...g,links:g.links.filter(l=>!args.by||l.createdBy===args.by)})).filter(g=>g.links.length):[]);},
 payPaymentLink:async(id,body)=>{if(params.has('holdPay'))await new Promise(resolve=>{window.__releasePay=resolve;});return change('payPaymentLink',id,body);},
 unpayPaymentLink:async id=>change('unpayPaymentLink',id),payInvoice:async id=>change('payInvoice',id,null,true),unpayInvoice:async id=>change('unpayInvoice',id,null,true),
 mpLeadLink:async(id,body)=>create('mpLeadLink',id,body),createCharge:async(id,body)=>create('createCharge',id,body),
};
