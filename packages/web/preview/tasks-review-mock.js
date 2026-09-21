const params=new URLSearchParams(location.search),clone=v=>structuredClone(v);
export const tasksReview=params.get('review')==='tasks';
let tasks=[], board;
export function setupTasksReview(){
 window.__taskWrites=[];
 board={id:'b1',columns:[{key:'todo',name:'A fazer',color:'#0f766e'},{key:'doing',name:'Em andamento',color:'#b7832d'},{key:'review',name:'Em revisão',color:'#637da6'},{key:'done',name:'Concluído',color:'#0f766e'}],doneKey:'done',labels:[{name:'comercial',color:''},{name:'conteúdo',color:''}]};
 tasks=params.has('empty')?[]:[
 {id:'t1',title:'Refazer o roteiro de objeção de preço',column:'todo',priority:'P0',dueDate:'2026-09-16',labels:['comercial'],assignees:['leo'],description:'Rever a conversa e preparar os exemplos.'},
 {id:'t2',title:'Gravar vídeo da dor estoque parado',column:'todo',priority:'P1',dueDate:'2026-09-22',labels:['conteúdo'],assignees:['leo']},
 {id:'t3',title:'Ligar para o financeiro',column:'doing',priority:'P2',dueDate:'2026-09-18',assignees:['lucas']},
 {id:'t4',title:'Página de planos com a tabela nova',column:'doing',startDate:'2026-09-17',dueDate:'2026-09-23',assignees:['tiago']},
 {id:'t5',title:'Texto do e-mail de boas-vindas',column:'review',assignees:['leo']},
 {id:'t6',title:'Revisar checklist de integração',column:'done',completed:true,assignees:['lucas']},
 {id:'s1',title:'Separar os exemplos',parentId:'t1',column:'todo',assignees:['leo']},
 {id:'foreign',saas:'elo',title:'Exclusiva de Elo',column:'todo',dueDate:'2026-09-15'}
 ].map((t,i)=>({saas:'leverads',order:i,description:'',comments:[],attachments:[],createdAt:'2026-09-15T13:00:00Z',createdBy:'leo',...t}));
}
const patch=(id,p)=>{const t=tasks.find(t=>t.id===id);if(!t)throw Error('Tarefa não encontrada');Object.assign(t,p);return clone(t);};
const log=(method,data)=>window.__taskWrites.push({method,...clone(data)});
export const tasksReviewMock={
 list:async col=>clone(col==='tasks'?tasks:col==='task_boards'?[board]:[]),
 create:async(col,body)=>{log('create',{col,body});const t={...clone(body),id:`new${tasks.length}`,comments:[],attachments:[]};tasks.push(t);return clone(t);},
 update:async(col,id,body)=>{log('update',{col,id,body});if(col==='task_boards'){Object.assign(board,body);return clone(board);}return patch(id,body);},
 taskComplete:async(id,completed)=>{log('complete',{id,completed});return {task:patch(id,{completed,column:completed?'done':'todo'})};},
 taskMove:async(id,body)=>{log('move',{id,body});return {task:patch(id,{...body,completed:body.column==='done'})};},
 tasksBulk:async(ids,action,value)=>{log('bulk',{ids,action,value});for(const id of ids){if(action==='delete')tasks=tasks.filter(t=>t.id!==id);else patch(id,action==='priority'?{priority:value}:action==='move'?{column:value}:action==='complete'?{completed:true,column:'done'}:{});}return {failed:[]};},
 taskSubtask:async(parentId,body)=>{const t={...clone(body),parentId,id:`new${tasks.length}`,saas:'leverads',column:'todo'};tasks.push(t);log('subtask',{parentId,body});return clone(t);},
 taskActivity:async()=>[],
};
