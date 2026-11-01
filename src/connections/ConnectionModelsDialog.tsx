import {useEffect,useRef,useState} from 'react';
import {Dialog,Modal,ModalOverlay} from 'react-aria-components';
import {RefreshCw,X} from 'lucide-react';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import {Input} from '../ui/dan-ui/components/base/input/input';
import {NativeSelect} from '../ui/dan-ui/components/base/select/select-native';
import {Checkbox} from '../ui/dan-ui/components/base/checkbox/checkbox';
import type {ConnectionModelRequest,ConnectionModelSettings} from './connectionModels';
export interface ConnectionModelActions {
 onReadModels?:(connectionId:string)=>Promise<ConnectionModelSettings>;
 onSyncModels?:(input:ConnectionModelRequest)=>Promise<ConnectionModelSettings>;
 onSaveModels?:(input:ConnectionModelRequest)=>Promise<ConnectionModelSettings>;
}
export function ConnectionModelsDialog({connection,onClose,onReadModels,onSyncModels,onSaveModels}:{connection:{id:string;name:string};onClose:()=>void}&ConnectionModelActions){
 const [settings,setSettings]=useState<ConnectionModelSettings|null>(null),[enabled,setEnabled]=useState<string[]>([]);
 const [operation,setOperation]=useState<'loading'|'syncing'|'saving'|''>('loading'),[error,setError]=useState('');
 const [query,setQuery]=useState(''),[filter,setFilter]=useState('all'),[capability,setCapability]=useState('all');
 const lock=useRef(false),busy=operation!=='';
 async function load(){if(lock.current||!onReadModels)return;lock.current=true;setOperation('loading');setError('');try{const data=await onReadModels(connection.id);setSettings(data);setEnabled(data.enabledModels);}catch(e){setError(e instanceof Error?e.message:'模型设置读取失败，请重试。');}finally{lock.current=false;setOperation('');}}
 useEffect(()=>{void load();},[connection.id]);
 async function sync(){if(lock.current||!settings||!onSyncModels)return;lock.current=true;setOperation('syncing');setError('');try{const result=await onSyncModels({connectionId:connection.id,versionId:settings.versionId});setSettings(result);}catch(e){setError(e instanceof Error?e.message:'模型目录读取失败，请重试。');}finally{lock.current=false;setOperation('');}}
 async function save(){if(lock.current||!settings||!onSaveModels)return;lock.current=true;setOperation('saving');setError('');try{await onSaveModels({connectionId:connection.id,versionId:settings.versionId,revision:settings.revision,enabledModels:enabled});onClose();}catch(e){setError(e instanceof Error?e.message:'模型设置保存失败，请重试。');}finally{lock.current=false;setOperation('');}}
 const visible=settings?.models.filter(m=>(filter==='all'||filter==='adapted'&&m.adapted||filter==='enabled'&&enabled.includes(m.id)||filter==='unadapted'&&!m.adapted)&&(capability==='all'||m.capability===capability)&&m.id.toLowerCase().includes(query.trim().toLowerCase()))??[];
 const changed=settings&&JSON.stringify([...settings.enabledModels].sort())!==JSON.stringify([...enabled].sort());
 return <ModalOverlay className="product-ui reference-connections-overlay" isOpen isDismissable={!busy} isKeyboardDismissDisabled={busy} onOpenChange={open=>{if(!open&&!busy)onClose();}}><Modal className="reference-connections-modal"><Dialog aria-label={`${connection.name} 模型设置`} className="dan-ui connection-workspace reference-connections reference-connections-dialog">
  <header className="reference-connections-dialog-header"><h2>模型设置</h2><Button color="tertiary" size="sm" iconLeading={X} aria-label="关闭模型设置" isDisabled={busy} onPress={onClose}/></header>
  <div className="connection-models-body">
   <div className="connection-models-heading"><strong>{connection.name}</strong>{settings?.discovery.supported&&<Button color="secondary" size="sm" iconLeading={RefreshCw} isLoading={operation==='syncing'} showTextWhileLoading isDisabled={busy||!onSyncModels} onPress={()=>void sync()}>{operation==='syncing'?'读取中…':'读取模型'}</Button>}</div>
   {operation==='loading'&&<p role="status">正在读取模型设置…</p>}
   {settings&&<>
    <p className="reference-connections-note" role="status">{settings.discovery.detail}</p>
    <div className="connection-models-filters"><Input aria-label="搜索模型" size="sm" type="search" placeholder="搜索模型名称" value={query} onChange={setQuery}/><NativeSelect aria-label="模型范围" size="sm" value={filter} onChange={e=>setFilter(e.target.value)} options={[{value:'all',label:'全部模型'},{value:'adapted',label:'本平台支持'},{value:'enabled',label:'已启用'},{value:'unadapted',label:'尚未适配'}]}/><NativeSelect aria-label="模型能力" size="sm" value={capability} onChange={e=>setCapability(e.target.value)} options={[{value:'all',label:'全部能力'},...[...new Set(settings.models.map(m=>m.capability))].map(value=>({value,label:value}))]}/></div>
    <div className="connection-models-list" aria-label="可选模型">{visible.length?visible.map(m=><div className="connection-models-row" key={m.id}><Checkbox aria-label={m.id} label={m.id} isSelected={m.adapted&&enabled.includes(m.id)} isDisabled={busy||!m.adapted} onChange={checked=>setEnabled(current=>checked?[...current,m.id]:current.filter(id=>id!==m.id))}/><span className="connection-models-meta">{m.capability} · {m.adapted?'本平台支持':'尚未适配'}{m.listed?' · 目录已返回':''}{m.reason&&<span className="connection-models-reason">{m.reason}</span>}</span></div>):<p className="reference-connections-note">没有匹配的模型。</p>}</div>
    <p className="reference-connections-note">已启用 {settings.models.filter(m=>m.adapted&&enabled.includes(m.id)).length} 个模型，用于之后的制作选择；已有任务保持原模型。</p>
    {!enabled.length&&<p className="reference-connections-note">保存后，此连接将没有可选的生成模型。</p>}
   </>}
   {error&&<p className="form-error" role="alert">{error}</p>}{!settings&&!busy&&<Button color="secondary" size="sm" onPress={()=>void load()}>重新读取设置</Button>}
  </div>
  <footer className="reference-connections-dialog-footer"><Button color="secondary" size="sm" isDisabled={busy} onPress={onClose}>取消</Button><Button color="primary" size="sm" isLoading={operation==='saving'} showTextWhileLoading isDisabled={busy||!changed||!onSaveModels} onPress={()=>void save()}>保存设置</Button></footer>
 </Dialog></Modal></ModalOverlay>;
}
