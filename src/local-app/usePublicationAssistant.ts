import {readConfiguredService,type ConnectionSetupSelection} from './connectionSetup';
import {useEffect,useMemo,useState} from 'react';
import type {ProductionServiceCatalog} from '../connections/serviceCatalog';
import type {PublicationRequestResult} from '../workspacePublication';
import {localRequest,localCommand} from './client';
import {useWorkspaceOwnerId} from './WorkspaceDraft';
import type {useWorkspacePublication} from './useWorkspacePublication';

type PublicationEditing=ReturnType<typeof useWorkspacePublication>;
export function usePublicationAssistant(episodeId:string,p:PublicationEditing,readOnly:boolean){
 const owner=useWorkspaceOwnerId(),key=owner?'loop-control.script-studio-model:'+owner:'',path=`episodes/${episodeId}/publication-ai`;
 const visit=useMemo(()=>({active:false,busy:false}),[owner,episodeId]);
 const [modelsLoading,setModelsLoading]=useState(false),[catalog,setCatalog]=useState<ProductionServiceCatalog|null>(null),[selection,setSelection]=useState(''),[choosing,setChoosing]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[latest,setLatest]=useState<PublicationRequestResult|null>(null);
 const options=(catalog?.groups?.find(group=>group.capability==='language_model')?.services??[]).filter(s=>s.executable&&s.connectionVersionId).flatMap(s=>s.models.map(model=>({id:s.id+':'+model,label:(s.connectionName??s.label)+' · '+model,connection:s.connectionName??s.label,selection:{capability:'language_model' as const,provider:s.provider,adapter:s.adapter,model,connectionVersionId:s.connectionVersionId!}})));
 const choice=options.find(option=>option.id===selection),unresolved=latest?.status==='dispatching'||latest?.status==='unknown';
 async function refresh(){
  setModelsLoading(true);
  try{const data=await localRequest('connections');if(visit.active){setCatalog(data.serviceCatalog??null);setError('');}}catch(cause){if(visit.active)setError(cause instanceof Error?cause.message:'模型连接读取失败。');}finally{if(visit.active)setModelsLoading(false);}
 }
 useEffect(()=>{
  visit.active=true;setBusy(false);setError('');setLatest(null);setCatalog(null);setSelection(key?localStorage.getItem(key)??'':'');
  if(!readOnly){void refresh();void recover();}
  return()=>{visit.active=false;};
 },[visit,readOnly]);
 async function recover(){try{const value=await localRequest(path) as PublicationRequestResult|null;if(visit.active)setLatest(value);}catch(cause){if(visit.active)setError(cause instanceof Error?cause.message:'文案请求核对失败。');}}
 function choose(value:string){setSelection(value);setChoosing(false);try{if(key)localStorage.setItem(key,value);}catch{/* Preference failure never selects a different provider. */}}
 async function useConfiguredConnection(selection:ConnectionSetupSelection){
  if(readOnly||visit.busy)return;
  const configured=await readConfiguredService('language_model',selection);
  if(!visit.active)return;
  await refresh();
  if(visit.active)choose(configured.service.id+':'+selection.modelId);
 }
 async function generate(){
  if(readOnly||visit.busy||unresolved)return;
  if(!choice){setChoosing(true);setError(options.length?'请明确选择本次模型。':'请先添加并验证大语言模型连接；仍可手写和下载视频。');return;}
  visit.busy=true;setBusy(true);setError('');
  try{
   const saved=await p.flush(),value=await localCommand<PublicationRequestResult>('generate',{expectedRevision:saved.revision,selection:choice.selection},undefined,path);
   if(!visit.active)return;
   setLatest(value);if(value.publication)p.acceptGenerated(value.publication,saved.content);
   if(value.status==='failed'||value.status==='unknown'||value.status==='stale')setError(value.message);
  }catch(cause){if(visit.active){setError(cause instanceof Error?cause.message:'文案结果未确认，先核对原请求。');await recover();}}
  finally{visit.busy=false;if(visit.active)setBusy(false);}
 }
 async function undo(){if(readOnly||visit.busy)return;visit.busy=true;setBusy(true);setError('');try{await p.mutate('undo',{},path);if(visit.active)setLatest(null);}catch(cause){if(visit.active)setError(cause instanceof Error?cause.message:'撤回未完成。');}finally{visit.busy=false;if(visit.active)setBusy(false);}}
 async function closeUnknown(){if(!latest||visit.busy)return;visit.busy=true;setBusy(true);try{const saved=await p.flush(),value=await localCommand<PublicationRequestResult>('closeUnknown',{expectedRevision:saved.revision,requestId:latest.requestId},undefined,path);if(visit.active){setLatest(value);setError('');}}catch(cause){if(visit.active)setError(cause instanceof Error?cause.message:'请求尚未结束。');}finally{visit.busy=false;if(visit.active)setBusy(false);}}
 return{options,choice,modelsLoading,choose,useConfiguredConnection,choosing,setChoosing,busy,error,latest,unresolved,generate,undo,recover,refresh,closeUnknown};
}
