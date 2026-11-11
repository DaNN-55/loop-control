import {uiText} from '../i18n/ui';
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
type ModelDialogProps={embedded?:boolean;connection:{id:string;name:string};onClose:()=>void;draft?:ConnectionModelDraft;onDraftChange?:(draft:ConnectionModelDraft|null)=>void;onStateChange?:(state:{busy:boolean;dirty:boolean})=>void}&ConnectionModelActions;
export function ConnectionModelsDialog(props:ModelDialogProps){return <ConnectionModelsSession key={props.connection.id} {...props}/>;}
function ConnectionModelsSession({embedded=false,connection,onClose,onReadModels,onSyncModels,onSaveModels,draft,onDraftChange,onStateChange}:ModelDialogProps){
 const [settings,setSettings]=useState<ConnectionModelSettings|null>(null),[baseline,setBaseline]=useState<ConnectionModelDraft|null>(null),[enabled,setEnabled]=useState<string[]>([]);
 const [operation,setOperation]=useState<'loading'|'syncing'|'saving'|''>('loading'),[error,setError]=useState('');
 const [query,setQuery]=useState(''),[filter,setFilter]=useState('all'),[capability,setCapability]=useState('all');
 const generation=useRef(0),lock=useRef(false),dialogRef=useRef<HTMLDivElement>(null),busy=operation!=='';
 const discoveredCount=settings?.discovery.detail.match(/^已读取 (\d+) 个供应商模型。目录未列出的已支持模型仍保留；能否生成取决于服务权限和额度。$/)?.[1];
 const stateChange=useRef(onStateChange);stateChange.current=onStateChange;
 const writing=operation==='syncing'||operation==='saving';

 useEffect(()=>()=>{stateChange.current?.({busy:false,dirty:false});},[]);
 useEffect(()=>{generation.current++;return()=>{generation.current++;lock.current=false;};},[]);
 useEffect(()=>{if(!busy&&error&&document.activeElement===document.body)dialogRef.current?.focus();},[busy,error]);
 const [leavePrompt,setLeavePrompt]=useState(false),[draftNotice,setDraftNotice]=useState('');
 function requestClose(){if(busy)return;if(changed)setLeavePrompt(true);else onClose();}
 function leave(keep:boolean){if(keep&&baseline)onDraftChange?.({versionId:baseline.versionId,revision:baseline.revision,enabledModels:enabled});else onDraftChange?.(null);onClose();}

 async function load(){
  if(lock.current)return;if(!onReadModels){setOperation('');setError(uiText('模型设置暂不可用。'));return;}
  const request=generation.current;lock.current=true;setOperation('loading');setError('');
  try{
   const data=await onReadModels(connection.id);
   if(request!==generation.current)return;
   if(data.connectionId!==connection.id)throw Error(uiText("连接已变化，请重新打开模型设置。"));
   setSettings(data);setBaseline(data);
   if(draft&&draft.versionId===data.versionId&&draft.revision===data.revision)setEnabled(draft.enabledModels);
   else{setEnabled(data.enabledModels);if(draft){onDraftChange?.(null);setDraftNotice(uiText("保留的修改所依据的版本已变化，已读取当前设置。"));}}
  }catch(e){if(request===generation.current)setError(e instanceof Error?e.message:uiText("模型设置读取失败，请重试。"));}
  finally{if(request===generation.current){lock.current=false;setOperation('');}}
 }
 useEffect(()=>{void load();},[connection.id]);
 async function sync(){
  if(lock.current||!baseline||!onSyncModels)return;
  const request=generation.current;lock.current=true;setOperation('syncing');setError('');
  try{
   const result=await onSyncModels({connectionId:connection.id,versionId:baseline.versionId});
   if(request!==generation.current)return;
   if(result.connectionId!==connection.id||result.versionId!==baseline.versionId)throw Error(uiText("连接版本已变化，请重新打开模型设置；本次勾选已保留。"));
   setSettings(result);
   // Discovery may advance revision without changing enabled models. Rebase only an unchanged edit baseline.
   if(!changed){setBaseline(result);setEnabled(result.enabledModels);}
   else if(sameModels(result.enabledModels,baseline.enabledModels))setBaseline(result);
   else setError(uiText("启用模型已在其他窗口修改，本次勾选已保留。请重新打开设置核对后再保存。"));
  }catch(e){if(request===generation.current)setError(e instanceof Error?e.message:uiText("模型目录读取失败，请重试。"));}
  finally{if(request===generation.current){lock.current=false;setOperation('');}}
 }
 async function save(){
  if(lock.current||!baseline||conflict||!onSaveModels)return;
  const request=generation.current;lock.current=true;setOperation('saving');setError('');
  try{
   const result=await onSaveModels({connectionId:connection.id,versionId:baseline.versionId,revision:baseline.revision,enabledModels:enabled});
   if(request!==generation.current)return;
   if(!result||result.connectionId!==connection.id||result.versionId!==baseline.versionId)throw Error(uiText("模型设置保存未确认完成，请重新读取后核对。"));
   onDraftChange?.(null);if(embedded){setSettings(result);setBaseline(result);setEnabled(result.enabledModels);setDraftNotice(uiText("已保存"));}else onClose();
  }catch(e){if(request===generation.current)setError(e instanceof Error?e.message:uiText("模型设置保存失败，请重试。"));}
  finally{if(request===generation.current){lock.current=false;setOperation('');}}
 }
 const visible=settings?.models.filter(m=>(filter==='all'||filter==='adapted'&&m.adapted||filter==='enabled'&&enabled.includes(m.id)||filter==='unadapted'&&!m.adapted)&&(capability==='all'||m.capability===capability)&&m.id.toLowerCase().includes(query.trim().toLowerCase()))??[];
 const changed=baseline&&!sameModels(baseline.enabledModels,enabled);
 useEffect(()=>{stateChange.current?.({busy:writing,dirty:Boolean(embedded&&changed)});},[writing,Boolean(embedded&&changed)]);
 useEffect(()=>{if(embedded&&baseline&&changed)onDraftChange?.({versionId:baseline.versionId,revision:baseline.revision,enabledModels:enabled});},[embedded,baseline,enabled,Boolean(changed)]);
 const conflict=!!settings&&!!baseline&&(!sameModels(settings.enabledModels,baseline.enabledModels)||settings.versionId!==baseline.versionId);
 useEffect(()=>{if(settings&&!changed)onDraftChange?.(null);},[Boolean(settings),changed]);
 useWorkspaceLeaveEntry({kind:'models',dirty:()=>Boolean(changed),keep:()=>{leave(true);return true;},discard:()=>leave(false),beforeUnload:()=>{if(changed&&baseline)onDraftChange?.({versionId:baseline.versionId,revision:baseline.revision,enabledModels:enabled});}});
 const content=<>{!embedded&&<>  <header className="reference-connections-dialog-header"><h2>{uiText("模型设置")}</h2><Button color="tertiary" size="sm" iconLeading={X} aria-label={uiText("关闭模型设置")} isDisabled={busy} onPress={requestClose}/></header></>}
  <div className="connection-models-body">
   <div className="connection-models-heading"><strong hidden={embedded}>{connection.name}</strong>{embedded&&settings&&<p className="reference-connections-note">{discoveredCount?uiText("已读取 {value0} 个供应商模型。目录未列出的已支持模型仍保留；能否生成取决于服务权限和额度。",{value0:discoveredCount}):uiText(settings.discovery.detail)}</p>}{settings?.discovery.supported&&<Button color="secondary" size="sm" iconLeading={RefreshCw} isLoading={operation==='syncing'} showTextWhileLoading isDisabled={busy||!onSyncModels} onPress={()=>void sync()}>{operation==='syncing'?uiText("读取中…"):uiText("读取模型")}</Button>}</div>
   {operation==='loading'&&<p role="status">{uiText("正在读取模型设置…")}</p>}
   {draftNotice&&<p className="reference-connections-note" role="status">{draftNotice}</p>}
   {settings&&<>
    {!embedded&&<p className="reference-connections-note" role="status">{changed?uiText("未保存修改"):uiText("尚未修改")}</p>}
    {!embedded&&<p className="reference-connections-note" role="status">{discoveredCount?uiText("已读取 {value0} 个供应商模型。目录未列出的已支持模型仍保留；能否生成取决于服务权限和额度。",{value0:discoveredCount}):uiText(settings.discovery.detail)}</p>}
    <div className="connection-models-filters"><Input aria-label={uiText("搜索模型")} size="sm" type="search" placeholder={uiText("搜索模型名称")} value={query} onChange={setQuery}/><PopulatedFilterSelect aria-label={uiText("模型范围")} size="sm" value={filter} onValueChange={setFilter} allValue="all" counts={{adapted:settings.models.filter(m=>m.adapted).length,enabled:settings.models.filter(m=>enabled.includes(m.id)).length,unadapted:settings.models.filter(m=>!m.adapted).length}} options={[{value:'all',label:uiText("全部模型")},{value:'adapted',label:uiText("本平台支持")},{value:'enabled',label:uiText("已启用")},{value:'unadapted',label:uiText("尚未适配")}]}/><PopulatedFilterSelect aria-label={uiText("模型能力")} size="sm" value={capability} onValueChange={setCapability} allValue="all" counts={Object.fromEntries(settings.models.map(m=>[m.capability,1]))} options={[{value:'all',label:uiText("全部能力")},...[...new Set(settings.models.map(m=>m.capability))].map(value=>({value,label:uiText(value)}))]}/></div>
    <div className="connection-models-list" role="group" aria-label={uiText("可选模型")}>{visible.length?visible.map(m=><div className="connection-models-row" key={m.id}><Checkbox aria-label={m.id} label={m.id} isSelected={m.adapted&&enabled.includes(m.id)} isDisabled={busy||!m.adapted} onChange={checked=>setEnabled(current=>checked?[...current,m.id]:current.filter(id=>id!==m.id))}/><span className="connection-models-meta">{uiText(m.capability)} · {m.adapted?uiText("本平台支持"):uiText("尚未适配")}{m.listed?uiText(" · 目录已返回"):''}{m.reason&&<span className="connection-models-reason">{uiText(m.reason)}</span>}</span></div>):<p className="reference-connections-note">{uiText("没有匹配的模型。")}</p>}</div>
    <p className="reference-connections-note">{uiText("已启用 ")}{settings.models.filter(m=>m.adapted&&enabled.includes(m.id)).length} {uiText("个模型，用于之后的制作选择；已有任务保持原模型。")}</p>
    {!enabled.length&&<p className="reference-connections-note">{uiText("保存后，此连接将没有可选的生成模型。")}</p>}
   </>}
   {error&&<p className="form-error" role="alert">{error}</p>}{!settings&&!busy&&<Button color="secondary" size="sm" onPress={()=>void load()}>{uiText("重新读取设置")}</Button>}
  </div>
  <footer className="reference-connections-dialog-footer">{embedded&&<span className="compact-connection-footer-state">{uiText(changed?"未保存修改":"已保存")}</span>}<Button color="secondary" size="sm" isDisabled={busy} onPress={embedded?()=>{if(baseline)setEnabled(baseline.enabledModels);onDraftChange?.(null);setError('');}:requestClose}>{uiText("取消")}</Button><Button color="primary" size="sm" isLoading={operation==='saving'} showTextWhileLoading isDisabled={busy||conflict||!changed||!onSaveModels} onPress={()=>void save()}>{uiText(embedded?"保存":"保存设置")}</Button></footer></>;
 return <>{embedded?<section className="connection-embedded-pane" aria-label={uiText("模型设置")}>{content}</section>:<><ModalOverlay className="product-ui reference-connections-overlay" isOpen isDismissable={!busy&&!leavePrompt} isKeyboardDismissDisabled={busy||leavePrompt} onOpenChange={open=>{if(!open)requestClose();}}><Modal className="reference-connections-modal"><Dialog ref={dialogRef} aria-label={uiText("{value0} 模型设置",{value0:connection.name})} className="dan-ui connection-workspace reference-connections reference-connections-dialog">
{content}</Dialog></Modal></ModalOverlay></>}{leavePrompt&&<ConnectionDraftLeaveDialog onContinue={()=>setLeavePrompt(false)} onDiscard={()=>leave(false)} onKeep={onDraftChange?()=>leave(true):undefined}/>}</>;
}
