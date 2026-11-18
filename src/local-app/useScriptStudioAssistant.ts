import {useEffect,useRef,useState} from 'react';
import type {ProductionServiceCatalog} from '../connections/serviceCatalog';
import type {ScriptStudioShotText} from '../scriptStudioEdit';
import {scriptStudioMaxCharacters,type ScriptStudioMode,type ScriptStudioChatMode,type ScriptStudioConversation,type ScriptStudioTurn,type ScriptStudioResult} from '../scriptStudio';
import {scriptStudioDefaultReasoning,scriptStudioReasoningOptions,type ScriptStudioReasoningEffort} from '../scriptStudioReasoning';
import {localCommand,localRequest} from './client';
import {useWorkspaceOwnerId} from './WorkspaceDraft';

export function useScriptStudioAssistant({episodeId,scriptRevisionId,source,targetDuration,disabled}:{episodeId:string;scriptRevisionId:string|null;source:string;targetDuration:number|null;disabled:boolean}){
 const owner=useWorkspaceOwnerId(),choiceKey=owner?'loop-control.script-studio-model:'+owner:'';
 const [catalog,setCatalog]=useState<ProductionServiceCatalog|null>(null),[selected,setSelected]=useState(()=>{try{return choiceKey?localStorage.getItem(choiceKey)??'':'';}catch{return '';}}),[needsChoice,setNeedsChoice]=useState(false),[modelsLoading,setModelsLoading]=useState(false),[modelError,setModelError]=useState('');
 const [result,setResult]=useState<ScriptStudioResult|null>(null),[busy,setBusy]=useState(false),[opened,setOpened]=useState(false),[error,setError]=useState(''),[activity,setActivity]=useState<'model'|'discuss'|'edit'|null>(null);
 const scope=JSON.stringify([episodeId,scriptRevisionId,source,targetDuration]),visit=useRef({active:true,scope,disabled,sequence:0,locked:false});visit.current.scope=scope;visit.current.disabled=disabled;
 const attempt=useRef<{scope:string;mode:ScriptStudioChatMode;instruction:string;previousRequestId?:string;reasoningEffort?:ScriptStudioReasoningEffort}|null>(null);
 const [turns,setTurns]=useState<ScriptStudioTurn[]>([]),[latestRequestId,setLatestRequestId]=useState<string>(),[latest,setLatest]=useState<ScriptStudioResult|null>(null),[conversationLoading,setConversationLoading]=useState(false),[conversationError,setConversationError]=useState(''),[restoredMode,setRestoredMode]=useState<ScriptStudioMode>('optimize'),[recoveryRequired,setRecoveryRequired]=useState(false);
 const unresolved=recoveryRequired||latest?.status==='pending'||latest?.status==='unknown';
 const options=(catalog?.groups.find(g=>g.capability==='language_model')?.services??[]).filter(s=>s.executable&&s.connectionVersionId).flatMap(s=>s.models.map(model=>({id:s.id+':'+model,label:(s.connectionName??s.label)+' · '+model,connection:s.connectionName??s.label,selection:{capability:'language_model' as const,provider:s.provider,adapter:s.adapter,connectionVersionId:s.connectionVersionId!,model}})));
 const choice=options.find(o=>o.id===selected)??(options.length===1?options[0]:undefined);
 const reasoningOptions=choice?scriptStudioReasoningOptions(choice.selection.provider,choice.selection.model):[];
 const effortKey=choiceKey&&choice?'loop-control.script-studio-reasoning:'+JSON.stringify([owner,choice.selection.provider,choice.selection.model]):'';
 const [effortPreference,setEffortPreference]=useState<{key:string;value:ScriptStudioReasoningEffort}>({key:'',value:'none'});
 let rememberedEffort:unknown='none';try{if(effortKey)rememberedEffort=localStorage.getItem(effortKey)??'none';}catch{/* Preferences are optional. */}
 const preferredEffort=effortPreference.key===effortKey?effortPreference.value:rememberedEffort;
 const reasoningEffort:ScriptStudioReasoningEffort=reasoningOptions.includes(preferredEffort as ScriptStudioReasoningEffort)?preferredEffort as ScriptStudioReasoningEffort:choice?scriptStudioDefaultReasoning(choice.selection.provider,choice.selection.model):'none';
 function chooseReasoning(value:ScriptStudioReasoningEffort){if(disabled||busy||unresolved||!reasoningOptions.includes(value))return;setEffortPreference({key:effortKey,value});if(effortKey)try{localStorage.setItem(effortKey,value);}catch{/* The active setting still applies. */}}
 const catalogInitialized=useRef(false),catalogSequence=useRef(0),catalogRead=useRef<Promise<ProductionServiceCatalog>|null>(null);
 const current=(sequence:number,captured:string)=>visit.current.active&&visit.current.scope===captured&&visit.current.sequence===sequence;
 useEffect(()=>{visit.current.active=true;return()=>{visit.current.active=false;visit.current.sequence++;};},[]);
 useEffect(()=>{visit.current.sequence++;visit.current.locked=false;attempt.current=null;setResult(null);setBusy(false);setActivity(null);setError('');setOpened(false);setNeedsChoice(false);setTurns([]);setLatestRequestId(undefined);setLatest(null);setRestoredMode('optimize');setRecoveryRequired(false);setConversationError('');},[scope]);
 async function restoreConversation(){
  if(!owner||visit.current.disabled||!source.trim()||Array.from(source).length>scriptStudioMaxCharacters)return;
  const captured=scope,sequence=++visit.current.sequence;setConversationLoading(true);setConversationError('');
  try{const value=await localRequest('script-studio',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({command:'conversation',data:{episodeId,expectedScriptRevisionId:scriptRevisionId,text:source,targetDuration}})}) as ScriptStudioConversation;
   if(!current(sequence,captured)||visit.current.disabled)return;
   if(!Array.isArray(value.turns))throw Error('对话记录读取失败，请重新核对。');
   setTurns(value.turns);setResult(value.result);setLatest(value.latest??null);setLatestRequestId(value.latest?.status==='failed'?value.turns.filter(t=>t.status==='completed').at(-1)?.requestId:value.latestRequestId);setRestoredMode(value.mode);setRecoveryRequired(false);if(value.result)setOpened(true);
  }catch(cause){if(current(sequence,captured))setConversationError(cause instanceof Error?cause.message:'对话记录读取失败。');}
  finally{if(current(sequence,captured))setConversationLoading(false);}
 }
 useEffect(()=>{if(!owner||disabled||!source.trim()||Array.from(source).length>scriptStudioMaxCharacters){setConversationLoading(false);return;}setConversationLoading(true);const timer=setTimeout(()=>void restoreConversation(),250);return()=>{clearTimeout(timer);visit.current.sequence++;};},[scope,owner,disabled]);
 function receive(value:ScriptStudioResult,mode:ScriptStudioChatMode|'edit',instruction:string,identity?:{provider:string;model:string}){
  setLatest(value);if(value.plan){setResult(value);setRestoredMode(value.plan.changes.length?'revision':'optimize');}if(value.status==='completed')setLatestRequestId(value.requestId);
  setTurns(previous=>previous.some(t=>t.requestId===value.requestId)?previous.map(t=>t.requestId===value.requestId?{...t,...identity,status:value.status,answer:mode==='edit'?value.message??'镜头修改已保存，仍需采用。':value.plan?.summary??value.message??''}:t):[...previous,{requestId:value.requestId,mode,...identity,instruction:instruction||'优化拍法',answer:mode==='edit'?value.message??'镜头修改已保存，仍需采用。':value.plan?.summary??value.message??'本次请求尚未返回。',status:value.status}]);
 }
 async function load(){if(!catalogRead.current)catalogRead.current=localRequest('connections').then(value=>value.serviceCatalog as ProductionServiceCatalog).finally(()=>{catalogRead.current=null;});return catalogRead.current;}
 async function refresh(){if(disabled||busy)return;const sequence=++catalogSequence.current;setModelsLoading(true);setModelError('');try{const next=await load();if(visit.current.active&&sequence===catalogSequence.current)setCatalog(next);}catch(cause){if(visit.current.active&&sequence===catalogSequence.current)setModelError(cause instanceof Error?cause.message:'连接读取失败。');}finally{if(visit.current.active&&sequence===catalogSequence.current)setModelsLoading(false);}}
 useEffect(()=>{if(!disabled&&!catalogInitialized.current){catalogInitialized.current=true;void refresh();}},[disabled]);
 async function send(mode:ScriptStudioChatMode='optimize',instruction='',previousRequestId?:string){
  if(disabled||visit.current.locked||conversationLoading||conversationError)return;
  if(unresolved&&owner){await restoreConversation();return;}
  setOpened(true);setError('');
  if(Array.from(source).length>scriptStudioMaxCharacters){setError('AI 拍法最多支持 20000 字符，请缩短原文后再试；原文仍可保留。');return;}
  const captured=scope,sequence=++visit.current.sequence;visit.current.locked=true;setBusy(true);setActivity(mode==='discuss'?'discuss':'model');
  try{
   const next=catalog??await load();if(!current(sequence,captured)||visit.current.disabled)return;setCatalog(next);
   const available=(next.groups.find(g=>g.capability==='language_model')?.services??[]).filter(s=>s.executable&&s.connectionVersionId).flatMap(s=>s.models.map(model=>({id:s.id+':'+model,selection:{capability:'language_model' as const,provider:s.provider,adapter:s.adapter,connectionVersionId:s.connectionVersionId!,model}})));
   const known=available.find(o=>o.id===selected);
   if(!known&&available.length>1){setNeedsChoice(true);return;}
   const picked=known??available[0];if(!picked){setError('请先添加并验证大语言模型连接。');return;}
   setNeedsChoice(false);
   const unresolved=latest?.status==='pending'||latest?.status==='unknown';
   const input=unresolved&&attempt.current?.scope===captured?attempt.current:{scope:captured,mode,instruction,...(reasoningEffort!=='none'?{reasoningEffort}:{}),...(previousRequestId?{previousRequestId}:{})};attempt.current=input;
   if(choiceKey)try{localStorage.setItem(choiceKey,picked.id);}catch{/* A missing local preference never changes the current explicit choice. */}
   const value=await localCommand<ScriptStudioResult>('optimize',{episodeId,expectedScriptRevisionId:scriptRevisionId,text:source,targetDuration,mode:input.mode,instruction:input.instruction,...(input.reasoningEffort?{reasoningEffort:input.reasoningEffort}:{}),...(input.previousRequestId?{previousRequestId:input.previousRequestId}:{}),selection:picked.selection},undefined,'script-studio');
   if(current(sequence,captured)&&!visit.current.disabled){receive(value,input.mode,input.instruction,{provider:picked.selection.provider,model:picked.selection.model});return value;}
  }catch(cause){if(current(sequence,captured)){setError(cause instanceof Error?cause.message:'拍法生成未完成，原文已保留。');const status=(cause as {status?:number}).status;if(!status||status>=500)setRecoveryRequired(true);}}
  finally{if(current(sequence,captured)){visit.current.locked=false;setBusy(false);setActivity(null);}}
 }
 function choose(value:string){if(busy||unresolved)return;setNeedsChoice(false);setSelected(value);setError('');}
 async function changeShot(index:number,fields?:Partial<ScriptStudioShotText>){
  if(disabled||visit.current.locked||conversationLoading||unresolved||!result?.plan||result.status!=='completed')return false;
  const captured=scope,sequence=++visit.current.sequence,previousRequestId=latestRequestId??result.requestId;visit.current.locked=true;setBusy(true);setActivity('edit');setError('');
  try{const value=await localCommand<ScriptStudioResult>(fields?'editShot':'deleteShot',{episodeId,expectedScriptRevisionId:scriptRevisionId,text:source,targetDuration,previousRequestId,index,...(fields?{fields}:{})},undefined,'script-studio');if(!current(sequence,captured)||visit.current.disabled)return false;receive(value,'edit',(fields?'手动修改第 ':'手动删除第 ')+(index+1)+' 个镜头');attempt.current=null;return true;}
  catch(cause){if(current(sequence,captured))setError(cause instanceof Error?cause.message:'镜头操作未完成，请核对后重试。');return false;}
  finally{if(current(sequence,captured)){visit.current.locked=false;setBusy(false);setActivity(null);}}
 }
 const saveShot=(index:number,fields:Partial<ScriptStudioShotText>)=>changeShot(index,fields),deleteShot=(index:number)=>changeShot(index);
 return {scope,result,busy,opened,error,turns,latestRequestId,unresolved,conversationLoading,conversationError,restoreConversation,options,choice,choose,reasoningOptions,reasoningEffort,chooseReasoning,refresh,send,saveShot,deleteShot,needsChoice,modelsLoading,modelError,activity,mode:restoredMode};
}
