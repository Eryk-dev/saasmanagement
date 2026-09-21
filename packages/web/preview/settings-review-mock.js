const q=new URLSearchParams(location.search),clone=v=>structuredClone(v);export const settingsReview=q.get('review')==='settings';let users=[],google={configured:true,connected:true,account:'revisao@example.test',meetReady:true};
export function setupSettingsReview(seed){window.__settingsWrites=[];users=clone(seed.USERS).map((u,i)=>({...u,compLevel:i%3+1}));seed.CONFIG={...seed.CONFIG,meta:{configured:true},whatsapp:{configured:true},google:{configured:true,connected:false},mp:{configured:true,webhook:true}};const p=seed.SAAS[0];p.metaAdAccount='act_123456789';p.metaPixelId='123456789';p.waPhoneId='987654321';p.lossReasons=[{id:'budget',label:'Sem orçamento'},{id:'timing',label:'Outro momento'}];p.customFields={leads:[{key:'segmento',label:'Segmento',type:'select',options:['Varejo','Serviços']}]};p.funnel=p.funnel.map((f,i)=>({...f,cadence:{maxAttempts:3,retryDays:2,firstTouchHours:4}}));if(q.has('lite')){seed.ME={...seed.ME,roles:['sdr'],screens:['overview']};seed.USERS=seed.USERS.map(u=>u.id===seed.ME.id?{...u,roles:seed.ME.roles,screens:seed.ME.screens}:u);}}
export const settingsReviewMock={
 saveFunnel:async(id,funnel,renames)=>{if(q.has('longSave'))await new Promise(r=>setTimeout(r,6000));window.__settingsWrites.push({method:'saveFunnel',id,funnel:clone(funnel),renames:clone(renames)});window.SEED.SAAS.find(s=>s.id===id).funnel=clone(funnel);return {migrated:2};},
 update:async(c,id,body)=>{window.__settingsWrites.push({method:'update',c,id,body:clone(body)});const p=window.SEED.SAAS.find(s=>s.id===id);Object.assign(p,clone(body));return clone(p);},
 listUsers:async()=>clone(users),
 updateUser:async(id,body)=>{window.__settingsWrites.push({method:'updateUser',id,body:clone(body)});const u=users.find(u=>u.id===id);Object.assign(u,clone(body));return clone(u);},
 createUser:async(body)=>{window.__settingsWrites.push({method:'createUser',body:clone(body)});const u={id:'new-user',roles:[],...clone(body)};users.push(u);return clone(u);},
 removeUser:async(id,force)=>{window.__settingsWrites.push({method:'removeUser',id,force});users=users.filter(u=>u.id!==id);return {ok:true};},
 googleUserStatus:async()=>clone(google),googleUserDisconnect:async()=>{window.__settingsWrites.push({method:'googleUserDisconnect'});google.connected=false;return {ok:true};},
 mpSyncNow:async()=>({seen:2,matched:1,settled:1}),
 improvePitch:async()=>({sugestao:{resumo:'Sugestão de revisão',objetivo:'Próximo passo claro',passos:[{t:'Abertura revisada',fala:'Olá, tudo bem?',dica:'Ouvir o cliente'}]},diagnostico:'Exemplo fictício',base:3}),
 trainingQueue:async()=>({cards:[],decks:[],exams:[]}),
};
