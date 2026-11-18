import {useEffect,useRef,useState} from 'react';
import type {ProductionServiceCatalog} from '../connections/serviceCatalog';
import {scriptStudioMaxCharacters,type ScriptStudioMode,type ScriptStudioResult} from '../scriptStudio';
import {localCommand,localRequest} from './client';
import {useWorkspaceOwnerId} from './WorkspaceDraft';

export function useScriptStudioAssistant({episodeId,scriptRevisionId,source,targetDuration,disabled}:{episodeId:string;scriptRevisionId:string|null;source:string;targetDuration:number|null;disabled:boolean}){
 const owner=useWorkspaceOwnerId(),choiceKey=owner?'loop-control.script-studio-model:'+owner:'';
 const [catalog,setCatalog]=useState<ProductionServiceCatalog|null>(null),[selected,setSelected]=useState(()=>{try{return choiceKey?localStorage.getItem(choiceKey)??'':'';}catch{return '';}}),[needsChoice,setNeedsChoice]=useState(false);
 const [result,setResult]=useState<ScriptStudioResult|null>(null),[busy,setBusy]=useState(false),[opened,setOpened]=useState(false),[error,setError]=useState('');
 const scope=JSON.stringify([episodeId,scriptRevisionId,source,targetDuration]),visit=useRef({active:true,scope,disabled,sequence:0,locked:false});visit.current.scope=scope;visit.current.disabled=disabled;
 const attempt=useRef<{scope:string;mode:ScriptStudioMode;instruction:string;previousRequestId?:string}|null>(null);
 const options=(catalog?.groups.find(g=>g.capability==='language_model')?.services??[]).filter(s=>s.executable&&s.connectionVersionId).flatMap(s=>s.models.map(model=>({id:s.id+':'+model,label:(s.connectionName??s.label)+' · '+model,selection:{capability:'language_model' as const,provider:s.provider,adapter:s.adapter,connectionVersionId:s.connectionVersionId!,model}})));
 const choice=options.find(o=>o.id===selected)??options[0];
 const current=(sequence:number,captured:string)=>visit.current.active&&visit.current.scope===captured&&visit.current.sequence===sequence;
 useEffect(()=>{visit.current.active=true;return()=>{visit.current.active=false;visit.current.sequence++;};},[]);
 useEffect(()=>{visit.current.sequence++;visit.current.locked=false;attempt.current=null;setResult(null);setBusy(false);setError('');setOpened(false);setNeedsChoice(false);},[scope]);
 async function load(){const value=await localRequest('connections');return value.serviceCatalog as ProductionServiceCatalog;}
 async function refresh(){if(disabled||busy)return;const sequence=++visit.current.sequence,captured=scope;setBusy(true);setError('');try{const next=await load();if(current(sequence,captured))setCatalog(next);}catch(cause){if(current(sequence,captured))setError(cause instanceof Error?cause.message:'连接读取失败。');}finally{if(current(sequence,captured))setBusy(false);}}
 async function send(mode:ScriptStudioMode='optimize',instruction='',previousRequestId?:string){
  if(disabled||visit.current.locked)return;
  setOpened(true);setError('');
  if(Array.from(source).length>scriptStudioMaxCharacters){setError('AI 拍法最多支持 20000 字符，请缩短原文后再试；原文仍可保留。');return;}
  const captured=scope,sequence=++visit.current.sequence;visit.current.locked=true;setBusy(true);
  try{
   const next=catalog??await load();if(!current(sequence,captured)||visit.current.disabled)return;setCatalog(next);
   const available=(next.groups.find(g=>g.capability==='language_model')?.services??[]).filter(s=>s.executable&&s.connectionVersionId).flatMap(s=>s.models.map(model=>({id:s.id+':'+model,selection:{capability:'language_model' as const,provider:s.provider,adapter:s.adapter,connectionVersionId:s.connectionVersionId!,model}})));
   const known=available.find(o=>o.id===selected);
   if(!known&&available.length>1){setSelected(available[0].id);setNeedsChoice(true);return;}
   const picked=known??available[0];if(!picked){setError('请先添加并验证大语言模型连接。');return;}
   setNeedsChoice(false);
   const unresolved=result?.status==='pending'||result?.status==='unknown';
   const input=unresolved&&attempt.current?.scope===captured?attempt.current:{scope:captured,mode,instruction,...(previousRequestId?{previousRequestId}:{})};attempt.current=input;
   if(choiceKey)try{localStorage.setItem(choiceKey,picked.id);}catch{/* A missing local preference never changes the current explicit choice. */}
   const value=await localCommand<ScriptStudioResult>('optimize',{episodeId,expectedScriptRevisionId:scriptRevisionId,text:source,targetDuration,mode:input.mode,instruction:input.instruction,...(input.previousRequestId?{previousRequestId:input.previousRequestId}:{}),selection:picked.selection},undefined,'script-studio');
   if(current(sequence,captured)&&!visit.current.disabled)setResult(value);
  }catch(cause){if(current(sequence,captured))setError(cause instanceof Error?cause.message:'拍法生成未完成，原文已保留。');}
  finally{if(current(sequence,captured)){visit.current.locked=false;setBusy(false);}}
 }
 function choose(value:string){visit.current.sequence++;visit.current.locked=false;attempt.current=null;setSelected(value);setResult(null);setBusy(false);setError('');}
 return {result,busy,opened,error,options,choice,choose,refresh,send,needsChoice,mode:attempt.current?.mode??'optimize'};
}
