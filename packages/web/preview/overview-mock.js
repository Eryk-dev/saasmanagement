// Fixtures matching the approved composition, used only with ?review=overview.
const params = new URLSearchParams(location.search);
export const overviewReview = params.get('review') === 'overview';
const empty = params.get('state') === 'empty';
const goal = (target, level = 3) => ({ target, period: 'month', scope: 'remuneracao', level });
const person = (user, name, revenue, won, revenueGoal, wonGoal, level = 3) => ({ user, name, revenue, won, goals: { revenue: goal(revenueGoal, level), won: goal(wonGoal, level) } });
const sale = { target: 180000, sold: 112400, contracted: 112400, expectedProgress: 13 / 22, progress: 112400 / 180000 };
if (params.has('milestone')) {
  Object.assign(sale, {target:225000, sold:Number(params.get('milestone')) || 241678, expectedProgress:15/22});
  sale.contracted = sale.sold; sale.progress = sale.sold / sale.target;
}
const score = {
  closer: [
    { ...person('rafael', 'Rafael Moura', 72400, 4, 90000, 6), callsShown: 31, conversaoCall: 16.1, ticket: 18100 },
    { ...person('bruno', 'Bruno Alencar', 19200, 2, 60000, 4, 2), callsShown: 18, conversaoCall: 11.1 },
  ],
  sdr: [{ ...person('manuela', 'Manuela Costa', 20800, 2, 90000, 6, 2), contactRate: 84.1, bookingRate: 31.2, showRate: 76, callsBooked: 24, breached: 4 }],
  cs: [{ user: 'vitor', name: 'Vitor Nunes', activeAccounts: 38, retentionRate: 96.4, nps: 72, referrals: 3, goals: {} }],
  team: { leadsNew: 214, contacted: 176, reachedCohort: 176, callsBooked: 61, shown: 47, won: 8, contactRate: 82.2, bookingRate: 34.7, showRate: 77, closeRatePeriod: 17, classes: { semente: { leads: 46, won: 3 }, rede: { leads: 132, won: 4 }, alvo: { leads: 36, won: 1 } } },
};
const sales = [['Studio Kern',24000,'rafael',17],['Nutri Vitta',4800,'rafael',16],['Oficina Prado',9600,'bruno',15],['Clínica Arbo',24000,'rafael',11],['Mercado Ponto',6400,'manuela',9],['Instituto Rima',19600,'rafael',5],['Grupo Vante',9600,'bruno',4],['Padaria Dovale',14400,'manuela',2]];
export function setupOverviewReview(seed) {
  seed.USERS.push(...[['rafael','Rafael Moura','closer'],['bruno','Bruno Alencar','closer'],['manuela','Manuela Costa','sdr'],['vitor','Vitor Nunes','integrator']].map(([id,name,role]) => ({ id, name, roles:[role], saas:'leverads' })));
  seed.LEADS = empty ? [] : sales.filter((_, i) => i !== 1).map(([company,amount,closer,day], i) => ({ id:`review-won-${i}`, saas:'leverads', name:company, company, amount, closer, owner:closer, stage:'Ganho', wonAt:`2026-09-${String(day).padStart(2,'0')}T12:00:00-03:00`, proposalProduct:'ads', proposalOffer:'escala_anual' }));
  if (!empty) seed.LEADS.push(...Array.from({length:14}, (_,i) => ({id:`review-open-${i}`, saas:'leverads', name:`Lead ${i+1}`, company:`Empresa ${i+1}`, stage:'Qualificação', amount:i === 0 ? 5500 : 7000, owner:'manuela'})));
  seed.CUSTOMERS = empty ? [] : Array.from({length:41}, (_,i) => ({ id:`review-customer-${i}`, saas:'leverads', name:i === 0 ? 'Nutri Vitta' : `Cliente ${i+1}`, arr: i < 2 ? 159000 : 1461600 / 39, keyAccount:i < 2, startedAt:'2026-01-01T12:00:00-03:00' }));
  localStorage.setItem('cockpit_period', 'month');
}
export const overviewMock = {
  paceWindow: (_id, range) => ({ saas:_id, ...range, businessDays:22, businessDaysElapsed:13, current:true, ended:false, sale: empty ? {...sale,sold:0,contracted:0,progress:0} : sale, contracts:{sold:empty ? 0 : 8,target:12} }),
  pipelinePace: () => ({sale:{...sale, actualDailyPace:sale.sold / (params.has('milestone') ? 15 : 13), requiredDailyPace:67600 / 9, remainingBusinessDays:params.has('milestone') ? 8 : 9, projected:sale.sold / (params.has('milestone') ? 15 : 13) * 22}}),
  scoreboard: () => empty ? {sdr:[],closer:[],cs:[],team:{}} : score,
  metrics: () => ({window:{cac:2545},ltv:{value:86400,ltvCac:4.1}}),
  marketingMetrics: () => ({totals:{spend:10180,cpl:77.12,roas:6.1}}),
  waInsights: () => ({awaiting:empty ? 0 : 6,openWindow:2}),
  list: col => col === 'invoices' ? (empty ? [] : [{id:'review-upsell',saas:'leverads',customer:'review-customer-0',kind:'upsell',title:'Pacote de OEM avulso',amount:4800,soldBy:'rafael',soldAt:'2026-09-16T12:00:00-03:00'}]) : window.SEED[col.toUpperCase()] || [],
};
