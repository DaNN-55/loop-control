import {useWorkspaceLeaveEntry} from '../local-app/WorkspaceDraft';
import {ConnectionDraftLeaveDialog} from './ConnectionDraftLeaveDialog';
import {useEffect,useRef,useState} from 'react';
import {Dialog,Modal,ModalOverlay} from 'react-aria-components';
import {RefreshCw,X} from 'lucide-react';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import {Input} from '../ui/dan-ui/components/base/input/input';
import {PopulatedFilterSelect} from '../ui/PopulatedFilterSelect';
import {Checkbox} from '../ui/dan-ui/components/base/checkbox/checkbox';
import type {ConnectionModelRequest,ConnectionModelSettings} from './connectionModels';
export interface ConnectionModelActions {
 onReadModels?:(connectionId:string)=>Promise<ConnectionModelSettings>;
 onSyncModels?:(input:ConnectionModelRequest)=>Promise<ConnectionModelSettings>;
 onSaveModels?:(input:ConnectionModelRequest)=>Promise<ConnectionModelSettings>;
}
export type ConnectionModelDraft={versionId:string;revision:string;enabledModels:string[]};
const sameModels=(a:string[],b:string[])=>JSON.stringify([...a].sort())===JSON.stringify([...b].sort());
type ModelDialogProps={connection:{id:string;name:string};onClose:()=>void;draft?:ConnectionModelDraft;onDraftChange?:(draft:ConnectionModelDraft|null)=>void;onStateChange?:(state:{busy:boolean;dirty:boolean})=>void}&ConnectionModelActions;
export function ConnectionModelsDialog(props:ModelDialogProps){return <ConnectionModelsSession key={props.connection.id} {...props}/>;}
function ConnectionModelsSession({connection,onClose,onReadModels,onSyncModels,onSaveModels,draft,onDraftChange,onStateChange}:ModelDialogProps){
 const [settings,setSettings]=useState<ConnectionModelSettings|null>(null),[baseline,setBaseline]=useState<ConnectionModelDraft|null>(null),[enabled,setEnabled]=useState<string[]>([]);
 const [operation,setOperation]=useState<'loading'|'syncing'|'saving'|''>('loading'),[error,setError]=useState('');
 const [query,setQuery]=useState(''),[filter,setFilter]=useState('all'),[capability,setCapability]=useState('all');
 const generation=useRef(0),lock=useRef(false),dialogRef=useRef<HTMLDivElement>(null),busy=operation!=='';
 const stateChange=useRef(onStateChange);stateChange.current=onStateChange;
 const writing=operation==='syncing'||operation==='saving';
 useEffect(()=>{stateChange.current?.({busy:writing,dirty:false});},[writing]);
 useEffect(()=>()=>{stateChange.current?.({busy:false,dirty:false});},[]);
 useEffect(()=>{generation.current++;return()=>{generation.current++;lock.current=false;};},[]);
 useEffect(()=>{if(!busy&&error&&document.activeElement===document.body)dialogRef.current?.focus();},[busy,error]);
 const [leavePrompt,setLeavePrompt]=useState(false),[draftNotice,setDraftNotice]=useState('');
 function requestClose(){if(busy)return;if(changed)setLeavePrompt(true);else onClose();}
 function leave(keep:boolean){if(keep&&baseline)onDraftChange?.({versionId:baseline.versionId,revision:baseline.revision,enabledModels:enabled});else onDraftChange?.(null);onClose();}

 async function load(){
  if(lock.current||!onReadModels)return;
  const request=generation.current;lock.current=true;setOperation('loading');setError('');
  try{
   const data=await onReadModels(connection.id);
   if(request!==generation.current)return;
   if(data.connectionId!==connection.id)throw Error('连接已变化，请重新打开模型设置。');
   setSettings(data);setBaseline(data);
   if(draft&&draft.versionId===data.versionId&&draft.revision===data.revision)setEnabled(draft.enabledModels);
   else{setEnabled(data.enabledModels);if(draft){onDraftChange?.(null);setDraftNotice('保留的修改所依据的版本已变化，已读取当前设置。');}}
  }catch(e){if(request===generation.current)setError(e instanceof Error?e.message:'模型设置读取失败，请重试。');}
  finally{if(request===generation.current){lock.current=false;setOperation('');}}
 }
 useEffect(()=>{void load();},[connection.id]);
 async function sync(){
  if(lock.current||!baseline||!onSyncModels)return;
  const request=generation.current;lock.current=true;setOperation('syncing');setError('');
  try{
   const result=await onSyncModels({connectionId:connection.id,versionId:baseline.versionId});
   if(request!==generation.current)return;
   if(result.connectionId!==connection.id||result.versionId!==baseline.versionId)throw Error('连接版本已变化，请重新打开模型设置；本次勾选已保留。');
   setSettings(result);
   // Discovery may advance revision without changing enabled models. Rebase only an unchanged edit baseline.
   if(!changed){setBaseline(result);setEnabled(result.enabledModels);}
   else if(sameModels(result.enabledModels,baseline.enabledModels))setBaseline(result);
   else setError('启用模型已在其他窗口修改，本次勾选已保留。请重新打开设置核对后再保存。');
  }catch(e){if(request===generation.current)setError(e instanceof Error?e.message:'模型目录读取失败，请重试。');}
  finally{if(request===generation.current){lock.current=false;setOperation('');}}
 }
 async function save(){
  if(lock.current||!baseline||conflict||!onSaveModels)return;
  const request=generation.current;lock.current=true;setOperation('saving');setError('');
  try{
   const result=await onSaveModels({connectionId:connection.id,versionId:baseline.versionId,revision:baseline.revision,enabledModels:enabled});
   if(request!==generation.current)return;
   if(!result||result.connectionId!==connection.id||result.versionId!==baseline.versionId)throw Error('模型设置保存未确认完成，请重新读取后核对。');
   onDraftChange?.(null);onClose();
  }catch(e){if(request===generation.current)setError(e instanceof Error?e.message:'模型设置保存失败，请重试。');}
  finally{if(request===generation.current){lock.current=false;setOperation('');}}
 }
 const visible=settings?.models.filter(m=>(filter==='all'||filter==='adapted'&&m.adapted||filter==='enabled'&&enabled.includes(m.id)||filter==='unadapted'&&!m.adapted)&&(capability==='all'||m.capability===capability)&&m.id.toLowerCase().includes(query.trim().toLowerCase()))??[];
 const changed=baseline&&!sameModels(baseline.enabledModels,enabled);
 const conflict=!!settings&&!!baseline&&(!sameModels(settings.enabledModels,baseline.enabledModels)||settings.versionId!==baseline.versionId);
 useEffect(()=>{if(settings&&!changed)onDraftChange?.(null);},[Boolean(settings),changed]);
 useWorkspaceLeaveEntry({kind:'models',dirty:()=>Boolean(changed),keep:()=>{leave(true);return true;},discard:()=>leave(false),beforeUnload:()=>{if(changed&&baseline)onDraftChange?.({versionId:baseline.versionId,revision:baseline.revision,enabledModels:enabled});}});
 return <><ModalOverlay className="product-ui reference-connections-overlay" isOpen isDismissable={!busy&&!leavePrompt} isKeyboardDismissDisabled={busy||leavePrompt} onOpenChange={open=>{if(!open)requestClose();}}><Modal className="reference-connections-modal"><Dialog ref={dialogRef} aria-label={`${connection.name} 模型设置`} className="dan-ui connection-workspace reference-connections reference-connections-dialog">
  <header className="reference-connections-dialog-header"><h2>模型设置</h2><Button color="tertiary" size="sm" iconLeading={X} aria-label="关闭模型设置" isDisabled={busy} onPress={requestClose}/></header>
  <div className="connection-models-body">
   <div className="connection-models-heading"><strong>{connection.name}</strong>{settings?.discovery.supported&&<Button color="secondary" size="sm" iconLeading={RefreshCw} isLoading={operation==='syncing'} showTextWhileLoading isDisabled={busy||!onSyncModels} onPress={()=>void sync()}>{operation==='syncing'?'读取中…':'读取模型'}</Button>}</div>
   {operation==='loading'&&<p role="status">正在读取模型设置…</p>}
   {draftNotice&&<p className="reference-connections-note" role="status">{draftNotice}</p>}
   {settings&&<>
    <p className="reference-connections-note" role="status">{changed?'未保存修改':'尚未修改'}</p>
    <p className="reference-connections-note" role="status">{settings.discovery.detail}</p>
    <div className="connection-models-filters"><Input aria-label="搜索模型" size="sm" type="search" placeholder="搜索模型名称" value={query} onChange={setQuery}/><PopulatedFilterSelect aria-label="模型范围" size="sm" value={filter} onValueChange={setFilter} allValue="all" counts={{adapted:settings.models.filter(m=>m.adapted).length,enabled:settings.models.filter(m=>enabled.includes(m.id)).length,unadapted:settings.models.filter(m=>!m.adapted).length}} options={[{value:'all',label:'全部模型'},{value:'adapted',label:'本平台支持'},{value:'enabled',label:'已启用'},{value:'unadapted',label:'尚未适配'}]}/><PopulatedFilterSelect aria-label="模型能力" size="sm" value={capability} onValueChange={setCapability} allValue="all" counts={Object.fromEntries(settings.models.map(m=>[m.capability,1]))} options={[{value:'all',label:'全部能力'},...[...new Set(settings.models.map(m=>m.capability))].map(value=>({value,label:value}))]}/></div>
    <div className="connection-models-list" aria-label="可选模型">{visible.length?visible.map(m=><div className="connection-models-row" key={m.id}><Checkbox aria-label={m.id} label={m.id} isSelected={m.adapted&&enabled.includes(m.id)} isDisabled={busy||!m.adapted} onChange={checked=>setEnabled(current=>checked?[...current,m.id]:current.filter(id=>id!==m.id))}/><span className="connection-models-meta">{m.capability} · {m.adapted?'本平台支持':'尚未适配'}{m.listed?' · 目录已返回':''}{m.reason&&<span className="connection-models-reason">{m.reason}</span>}</span></div>):<p className="reference-connections-note">没有匹配的模型。</p>}</div>
    <p className="reference-connections-note">已启用 {settings.models.filter(m=>m.adapted&&enabled.includes(m.id)).length} 个模型，用于之后的制作选择；已有任务保持原模型。</p>
    {!enabled.length&&<p className="reference-connections-note">保存后，此连接将没有可选的生成模型。</p>}
   </>}
   {error&&<p className="form-error" role="alert">{error}</p>}{!settings&&!busy&&<Button color="secondary" size="sm" onPress={()=>void load()}>重新读取设置</Button>}
  </div>
  <footer className="reference-connections-dialog-footer"><Button color="secondary" size="sm" isDisabled={busy} onPress={requestClose}>取消</Button><Button color="primary" size="sm" isLoading={operation==='saving'} showTextWhileLoading isDisabled={busy||conflict||!changed||!onSaveModels} onPress={()=>void save()}>保存设置</Button></footer>
 </Dialog></Modal></ModalOverlay>{leavePrompt&&<ConnectionDraftLeaveDialog onContinue={()=>setLeavePrompt(false)} onDiscard={()=>leave(false)} onKeep={onDraftChange?()=>leave(true):undefined}/>}</>;
}
