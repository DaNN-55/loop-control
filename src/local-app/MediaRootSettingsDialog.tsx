import {useEffect,useState} from 'react';
import {Copy,FolderOpen,FolderSearch,X} from 'lucide-react';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import {InputBase} from '../ui/dan-ui/components/base/input/input';
import {useDialogFocus} from '../ui/useDialogFocus';
import {localRequest} from './client';
import './media-root-settings.css';
interface RootState{path:string;canInitialize:boolean;status:'ready'|'unavailable';reason?:string}
export function MediaRootSettingsDialog({csrf,onClose}:{csrf:string;onClose:()=>void}){
 const [root,setRoot]=useState<RootState|null>(null),[path,setPath]=useState(''),[pending,setPending]=useState('read'),[error,setError]=useState(''),[message,setMessage]=useState('');
 const ref=useDialogFocus<HTMLDivElement>(true,()=>{if(!pending)onClose();});
 const busy=!!pending;
 useEffect(()=>{const controller=new AbortController();void localRequest('media-root',{signal:controller.signal}).then((value:RootState)=>{setRoot(value);setPath(value.path);}).catch(e=>{if(!controller.signal.aborted)setError(e instanceof Error?e.message:String(e));}).finally(()=>{if(!controller.signal.aborted)setPending('');});return()=>controller.abort();},[]);
 async function command(command:'choose'|'open'|'initialize'){
  if(busy)return;setPending(command);setError('');setMessage('');
  try{
   const value=await localRequest('media-root',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify({command,idempotencyKey:crypto.randomUUID(),...(command==='initialize'?{path}:{})})});
   if(command==='choose'){if(!value.cancelled)setPath(value.path);}
   else if(command==='initialize'){setRoot(value);setPath(value.path);setMessage('媒体根已初始化，服务已重新加载。');}
   else setMessage('已打开媒体根文件夹。');
  }catch(e){setError(e instanceof Error?e.message:String(e));}finally{setPending('');}
 }
 async function copy(){if(!root)return;setError('');try{await navigator.clipboard.writeText(root.path);setMessage('路径已复制。');}catch{setError('未能复制路径，请选中路径后手动复制。');}}
 return <div className="modal-backdrop owner-preferences-backdrop"><div className="owner-preferences-dialog media-root-dialog" role="dialog" aria-modal="true" aria-label="本机存储" ref={ref}>
  <header><h2>本机存储</h2><Button size="sm" color="tertiary" iconLeading={X} aria-label="关闭本机存储" isDisabled={busy} onClick={onClose}/></header>
  <section className="media-root-content">
   <h3>媒体根目录</h3>
   {root?<><div className="media-root-current"><span className="media-root-path" title={root.path}>{root.path}</span><div><Button size="sm" color="tertiary" iconLeading={Copy} aria-label="复制媒体根路径" isDisabled={busy} onClick={()=>void copy()}/><Button size="sm" color="secondary" iconLeading={FolderOpen} isDisabled={busy||root.status!=='ready'} onClick={()=>void command('open')}>打开文件夹</Button></div></div>
   {root.status==='unavailable'&&<p role="alert" className="form-error">{root.reason}</p>}
   {root.canInitialize?<form onSubmit={event=>{event.preventDefault();void command('initialize');}}><label>初始化位置<InputBase size="sm" aria-label="初始化位置" value={path} disabled={busy} onChange={event=>setPath(event.target.value)}/></label><div className="media-root-actions"><Button size="sm" color="secondary" iconLeading={FolderSearch} type="button" isDisabled={busy} onClick={()=>void command('choose')}>选择文件夹</Button><Button size="sm" color="primary" type="submit" isDisabled={busy||!path.trim()||path===root.path}>{pending==='initialize'?'初始化中…':'初始化媒体根'}</Button></div></form>:<p className="owner-preferences-note">工作区已有资料，更换位置需要受控迁移；当前请保留现址。</p>}</>:<p role="status">{busy?'正在读取媒体根…':'媒体根未读取，请关闭后重试。'}</p>}
   {error&&<p role="alert" className="form-error">{error}</p>}
   <p role="status" className="media-root-feedback">{message}</p>
  </section>
 </div></div>;
}
