import {useEffect,useRef,useState} from 'react';
import {FolderOpen,FolderSearch,LoaderCircle,X} from 'lucide-react';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import {InputBase} from '../ui/dan-ui/components/base/input/input';
import {useDialogFocus} from '../ui/useDialogFocus';
import {localRequest} from './client';
import './media-root-settings.css';
interface RootPlan{id:string;status:'planned'|'copying'|'failed'|'committed'|'completed'|'rolled_back';manifestSha256:string;progress?:{copiedFiles:number;copiedBytes:number;activeFile?:string;activeFileBytes?:number};error?:string;manifest:{sourceBinding:{path:string};targetBinding:{path:string};accounts:{id:string;name:string}[];episodes:{id:string;title:string}[];files:{episodeId:string;targetRelativePath:string;fileSize:number}[];references:unknown[];fileCount:number;directoryCount:number;totalBytes:number;target:{existingFileCount:number;existingBytes:number};space:{freeBytes:number;reserveBytes:number;requiredBytes:number};incompleteCopies:{path:string;bytes:number;verified:boolean}[];retained:{path?:string;kind:string;reason:string}[];canExecute:boolean;conflicts:string[];blockers:{reason:string}[]}}
interface RootState{executing?:boolean;path:string;canInitialize:boolean;status:'ready'|'unavailable';reason?:string;migration:RootPlan|null}
const bytes=(value:number)=>new Intl.NumberFormat('zh-CN',{style:'unit',unit:'byte',unitDisplay:'short'}).format(value);
export function MediaRootSettingsDialog({csrf,onClose,embedded=false}:{csrf:string;onClose:()=>void;embedded?:boolean}){
 const [root,setRoot]=useState<RootState|null>(null),[path,setPath]=useState(''),[pending,setPending]=useState('read'),[error,setError]=useState(''),[message,setMessage]=useState(''),[readError,setReadError]=useState(''),[editing,setEditing]=useState(false);
 const planRequest=useRef<{path:string;key:string}|null>(null),ref=useDialogFocus<HTMLDivElement>(!embedded,()=>{if(!pending||pending==='executeMigration')onClose();}),busy=!!pending;
 const observing=pending==='executeMigration'||['copying','committed'].includes(root?.migration?.status??'');
 useEffect(()=>{const controller=new AbortController();void localRequest('media-root',{signal:controller.signal}).then((value:RootState)=>{setRoot(value);setPath(value.migration&&!['completed','rolled_back'].includes(value.migration.status)?value.migration.manifest.targetBinding.path:value.path);}).catch(e=>{if(!controller.signal.aborted)setError(e instanceof Error?e.message:String(e));}).finally(()=>{if(!controller.signal.aborted)setPending('');});return()=>controller.abort();},[]);
 useEffect(()=>{if(!observing)return;const controller=new AbortController();let timer:ReturnType<typeof setTimeout>;const refresh=async()=>{try{const value:RootState=await localRequest('media-root',{signal:controller.signal});if(!controller.signal.aborted){setRoot(value);setReadError('');}}catch(e){if(!controller.signal.aborted)setReadError(e instanceof Error?e.message:String(e));}finally{if(!controller.signal.aborted)timer=setTimeout(()=>void refresh(),500);}};void refresh();return()=>{controller.abort();clearTimeout(timer);};},[observing]);
 async function command(command:'choose'|'open'|'initialize'|'planMigration'|'executeMigration'|'rollbackMigration'){

  if(busy)return;setPending(command);setError('');setMessage('');
  if(command==='planMigration'&&planRequest.current?.path!==path)planRequest.current={path,key:crypto.randomUUID()};
  try{
   const value=await localRequest('media-root',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify({command,idempotencyKey:command==='planMigration'?planRequest.current!.key:crypto.randomUUID(),...(['initialize','planMigration'].includes(command)?{path}:{}),...(['executeMigration','rollbackMigration'].includes(command)?{migrationId:root?.migration?.id}:{})})});
   if(command==='choose'){if(!value.cancelled)setPath(value.path);}
   else if(command==='initialize'){setRoot(value);setPath(value.path);setMessage('媒体根已初始化，服务已重新加载。');}
   else if(command==='planMigration'){planRequest.current=null;setRoot(current=>current?{...current,migration:value}:current);setMessage('计划已保存，当前位置未改变。');}
   else if(command==='executeMigration'||command==='rollbackMigration'){const state:RootState=await localRequest('media-root');setRoot(state);setReadError('');if(value.status==='completed'){setPath(state.path);setEditing(false);setMessage('媒体根迁移完成，服务已使用新位置。');}else if(value.status==='rolled_back')setMessage('已回滚未完成迁移，副本和原文件已保留。');}
   else setMessage('已打开媒体根文件夹。');
  }catch(e){setError(e instanceof Error?e.message:String(e));if(command==='executeMigration'||command==='rollbackMigration')try{setRoot(await localRequest('media-root'));}catch{setReadError('未能读取最新进度，请重新打开个人偏好。');}}finally{setPending('');}
 }
 const plan=root?.migration,m=plan?.manifest,progress=plan?.progress;
 const active=['copying','failed','committed'].includes(plan?.status??''),feedback=error||plan?.error||readError;
 useEffect(()=>{if(!message)return;const timer=setTimeout(()=>setMessage(''),5000);return()=>clearTimeout(timer);},[message]);
 const content=<section className="media-root-content" aria-label="存储位置">
  <h3>存储位置</h3>
  {root?<>
   <div className="media-root-current"><span className="media-root-path" title={root.path}>{root.path}</span><div>
    <Button size="sm" color="tertiary" iconLeading={FolderOpen} aria-label="打开存储文件夹" title="打开文件夹" type="button" isDisabled={busy||root.status!=='ready'} onClick={()=>void command('open')}/>
    <Button size="sm" color="tertiary" iconLeading={FolderSearch} aria-label="更换存储位置" title="更换存储位置" type="button" isDisabled={busy||active} onClick={()=>setEditing(true)}/>
   </div></div>
   {root.status==='unavailable'&&plan?.status!=='committed'&&<p role="alert" className="form-error">{root.reason}</p>}
   {!active&&(editing||root.canInitialize||path!==root.path)&&<div className="media-root-location-form"><label>{root.canInitialize?'初始化位置':'新位置'}<InputBase size="sm" aria-label={root.canInitialize?'初始化位置':'新位置'} value={path} disabled={busy} onChange={event=>setPath(event.target.value)} onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();if(path.trim())void command(root.canInitialize?'initialize':'planMigration');}}}/></label><div className="media-root-actions"><Button size="sm" color="tertiary" type="button" iconLeading={FolderSearch} aria-label="选择文件夹" title="选择文件夹" isDisabled={busy} onClick={()=>void command('choose')}/><Button size="sm" color="primary" type="button" isDisabled={busy||!path.trim()||!root.canInitialize&&path===root.path} onClick={()=>void command(root.canInitialize?'initialize':'planMigration')}>{pending==='planMigration'?'检查中…':root.canInitialize?'初始化':'迁移'}</Button></div></div>}
  </>:<p role="status">{busy?'正在读取存储位置…':'存储位置未读取，请关闭后重试。'}</p>}
  {feedback&&<p role="alert" className="form-error">{feedback}</p>}
  {message&&<p role="status" className="media-root-feedback">{message}</p>}
  {m&&plan&&!['completed','rolled_back'].includes(plan.status)&&<div className="media-root-plan" aria-label="迁移进度">
   <div className="media-root-plan-path"><span>{observing?<LoaderCircle className="media-root-spinner" size={16} aria-hidden="true"/>:null}{observing?'正在迁移':plan.status==='failed'?'迁移未完成':plan.status==='committed'?'切换待恢复':'迁移到'}</span><span className="media-root-path" title={m.targetBinding.path}>{m.targetBinding.path}</span></div>
   {observing?<div className="media-root-copy-progress" role="status" aria-live="polite"><progress aria-label="迁移进度" max={m.totalBytes||1} value={m.totalBytes?Math.min(progress?.copiedBytes??0,m.totalBytes):undefined}/><p>{progress?.copiedFiles??0} / {m.fileCount} 个文件 · {bytes(progress?.copiedBytes??0)} / {bytes(m.totalBytes)}</p></div>:<p>{m.fileCount} 个文件 · {bytes(m.totalBytes)}</p>}
   {!!(m.conflicts.length+m.blockers.length)&&<ul className="media-root-conflicts" aria-label="迁移阻塞">{[...new Set([...m.conflicts,...m.blockers.map(b=>b.reason)])].map(reason=><li key={reason}>{reason}</li>)}</ul>}
   {!observing&&<div className="media-root-actions">{plan.status!=='committed'&&<Button size="sm" color="secondary" type="button" isDisabled={busy||root?.executing} onClick={()=>void command('rollbackMigration')}>{plan.status==='planned'?'取消':'回滚未完成迁移'}</Button>}<Button size="sm" color="primary" type="button" isDisabled={busy||root?.executing||plan.status==='planned'&&!m.canExecute} onClick={()=>void command('executeMigration')}>{plan.status==='committed'?'继续恢复':plan.status==='planned'?'开始迁移':'继续迁移'}</Button></div>}
  </div>}
 </section>;
 if(embedded)return content;
 return <div className="modal-backdrop owner-preferences-backdrop"><div className="owner-preferences-dialog media-root-dialog" role="dialog" aria-modal="true" aria-label="存储位置" ref={ref}><header><h2>存储位置</h2><Button size="sm" color="tertiary" iconLeading={X} aria-label="关闭存储位置" isDisabled={busy&&pending!=='executeMigration'} onClick={onClose}/></header>{content}</div></div>;
}
