'use strict';
// The admin's task list: things to check or do later, with a status, a priority, an area, an optional
// date and comments. Stored at adminTasks/{id}. Every change of status leaves a line in the comments,
// so each task keeps its own history.
const STATUSES=['pendiente','en-curso','esperando','hecha','descartada'];
const PRIORITIES=['alta','media','baja'];
const AREAS=['juego','apps','servidor','admin','marketing','tiendas','otros'];
const MAX_TITLE=140,MAX_NOTES=3000,MAX_COMMENT=1500,MAX_COMMENTS=200;
const DAY=/^\d{4}-\d{2}-\d{2}$/;
const ID=/^[A-Za-z0-9_-]{6,40}$/;
const text=(v,max)=>typeof v==='string'?v.replace(/\r\n/g,'\n').trim().slice(0,max):'';
const validDay=d=>DAY.test(d)&&new Date(d+'T12:00:00Z').toISOString().slice(0,10)===d;
const validId=id=>typeof id==='string'&&ID.test(id)&&!['__proto__','constructor','prototype'].includes(id);

// The editable fields, checked. Missing fields keep `current` (or the defaults for a new task).
function cleanFields(input,current=null){
 const f=input||{},out={};
 const title=f.title!==undefined?text(f.title,MAX_TITLE):current?.title;
 if(!title)throw new Error('Escribí un título para la tarea.');
 out.title=title;
 out.notes=f.notes!==undefined?text(f.notes,MAX_NOTES):current?.notes||'';
 const pick=(key,list,fallback)=>{const v=f[key]!==undefined?f[key]:current?.[key];if(v===undefined||v===null)return fallback;if(!list.includes(v))throw new Error('Valor inválido: '+key+'.');return v;};
 out.status=pick('status',STATUSES,'pendiente');
 out.priority=pick('priority',PRIORITIES,'media');
 out.area=pick('area',AREAS,'otros');
 const due=f.due!==undefined?f.due:current?.due??null;
 if(due!==null&&due!==''&&!(typeof due==='string'&&validDay(due)))throw new Error('Fecha inválida.');
 out.due=due||null;
 return out;
}
const STATUS_NAMES={pendiente:'Pendiente','en-curso':'En curso',esperando:'Esperando','hecha':'Hecha',descartada:'Descartada'};
const commentId=(now,n)=>now.toString(36)+'-'+n.toString(36);

// Applies one change to a task (current: the stored task or null). Returns the new task, or null to delete it.
// op: {kind:'create'|'update'|'comment'|'delete-comment'|'delete', fields, text, commentId}; who: {uid,name}.
function applyTask(current,op,{now,who}){
 const kind=op?.kind;
 if(kind==='create'){
  if(current)throw new Error('La tarea ya existe.');
  const fields=cleanFields(op.fields);
  return {...fields,createdAt:now,createdBy:who.name,updatedAt:now,...(fields.status==='hecha'?{doneAt:now}:{}),comments:{}};
 }
 if(!current)throw new Error('La tarea ya no existe.');
 if(kind==='delete')return null;
 const task={...current,comments:{...(current.comments||{})}};
 const count=Object.keys(task.comments).length;
 if(kind==='update'){
  const fields=cleanFields(op.fields,current);
  if(fields.status!==current.status){
   if(count>=MAX_COMMENTS)throw new Error('La tarea tiene demasiados comentarios.');
   task.comments[commentId(now,count)]={at:now,by:who.name,kind:'status',text:'Cambió el estado a '+STATUS_NAMES[fields.status]+'.'};
   if(fields.status==='hecha')task.doneAt=now;else delete task.doneAt;
  }
  Object.assign(task,fields,{updatedAt:now});
  return task;
 }
 if(kind==='comment'){
  const body=text(op.text,MAX_COMMENT);
  if(!body)throw new Error('Escribí el comentario.');
  if(count>=MAX_COMMENTS)throw new Error('La tarea tiene demasiados comentarios.');
  task.comments[commentId(now,count)]={at:now,by:who.name,text:body};task.updatedAt=now;
  return task;
 }
 if(kind==='delete-comment'){
  const c=task.comments[op.commentId];
  if(!c||c.kind==='status')throw new Error('Ese comentario no se puede borrar.');
  delete task.comments[op.commentId];task.updatedAt=now;
  return task;
 }
 throw new Error('Cambio inválido.');
}

// The list for the panel: {id,...task, comments:[...] oldest first}.
function taskList(stored){
 return Object.entries(stored||{}).filter(([id,t])=>validId(id)&&t&&typeof t.title==='string').map(([id,t])=>({id,...t,
  comments:Object.entries(t.comments||{}).map(([cid,c])=>({id:cid,...c})).sort((a,b)=>a.at-b.at)}));
}

module.exports={STATUSES,PRIORITIES,AREAS,applyTask,cleanFields,taskList,validId};
