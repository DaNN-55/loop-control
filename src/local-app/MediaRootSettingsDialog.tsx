import {useEffect,useRef,useState} from 'react';
import {Copy,FolderOpen,FolderSearch,X} from 'lucide-react';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import {InputBase} from '../ui/dan-ui/components/base/input/input';
import {useDialogFocus} from '../ui/useDialogFocus';
import {localRequest} from './client';
import './media-root-settings.css';
interface RootPlan{id:string;status:'planned'|'copying'|'failed'|'committed'|'completed'|'rolled_back';manifestSha256:string;progress?:{copiedFiles:number;copiedBytes:number;activeFile?:string;activeFileBytes?:number};error?:string;manifest:{sourceBinding:{path:string};targetBinding:{path:string};accounts:{id:string;name:string}[];episodes:{id:string;title:string}[];files:{episodeId:string;targetRelativePath:string;fileSize:number}[];references:unknown[];fileCount:number;directoryCount:number;totalBytes:number;target:{existingFileCount:number;existingBytes:number};space:{freeBytes:number;reserveBytes:number;requiredBytes:number};incompleteCopies:{path:string;bytes:number;verified:boolean}[];retained:{path?:string;kind:string;reason:string}[];canExecute:boolean;conflicts:string[];blockers:{reason:string}[]}}
interface RootState{executing?:boolean;path:string;canInitialize:boolean;status:'ready'|'unavailable';reason?:string;migration:RootPlan|null}
const bytes=(value:number)=>new Intl.NumberFormat('zh-CN',{style:'unit',unit:'byte',unitDisplay:'short'}).format(value);
const resourceNames:Record<string,string>={program:'共享程序',runtime:'运行环境',state:'运行状态',history:'独立历史库',backup:'备份','model-cache':'模型缓存',secrets:'秘密',unknown:'未知或手动内容'};
export function MediaRootSettingsDialog({csrf,onClose}:{csrf:string;onClose:()=>void}){
 const [root,setRoot]=useState<RootState|null>(null),[path,setPath]=useState(''),[pending,setPending]=useState('read'),[error,setError]=useState(''),[message,setMessage]=useState(''),[readError,setReadError]=useState('');
 const planRequest=useRef<{path:string;key:string}|null>(null),ref=useDialogFocus<HTMLDivElement>(true,()=>{if(!pending||pending==='executeMigration')onClose();}),busy=!!pending;
 const observing=pending==='executeMigration'||['copying','committed'].includes(root?.migration?.status??'');
 useEffect(()=>{const controller=new AbortController();void localRequest('media-root',{signal:controller.signal}).then((value:RootState)=>{setRoot(value);setPath(value.migration?.manifest.targetBinding.path??value.path);}).catch(e=>{if(!controller.signal.aborted)setError(e instanceof Error?e.message:String(e));}).finally(()=>{if(!controller.signal.aborted)setPending('');});return()=>controller.abort();},[]);
 useEffect(()=>{if(!observing)return;const controller=new AbortController();let timer:ReturnType<typeof setTimeout>;const refresh=async()=>{try{const value:RootState=await localRequest('media-root',{signal:controller.signal});if(!controller.signal.aborted){setRoot(value);setReadError('');}}catch(e){if(!controller.signal.aborted)setReadError(e instanceof Error?e.message:String(e));}finally{if(!controller.signal.aborted)timer=setTimeout(()=>void refresh(),500);}};void refresh();return()=>{controller.abort();clearTimeout(timer);};},[observing]);
 async function command(command:'choose'|'open'|'initialize'|'planMigration'|'executeMigration'|'rollbackMigration'){

  if(busy)return;setPending(command);setError('');setMessage('');
  if(command==='planMigration'&&planRequest.current?.path!==path)planRequest.current={path,key:crypto.randomUUID()};
  try{
   const value=await localRequest('media-root',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify({command,idempotencyKey:command==='planMigration'?planRequest.current!.key:crypto.randomUUID(),...(['initialize','planMigration'].includes(command)?{path}:{}),...(['executeMigration','rollbackMigration'].includes(command)?{migrationId:root?.migration?.id}:{})})});
   if(command==='choose'){if(!value.cancelled)setPath(value.path);}
   else if(command==='initialize'){setRoot(value);setPath(value.path);setMessage('媒体根已初始化，服务已重新加载。');}
   else if(command==='planMigration'){planRequest.current=null;setRoot(current=>current?{...current,migration:value}:current);setMessage('计划已保存，当前位置未改变。');}
   else if(command==='executeMigration'||command==='rollbackMigration'){const state:RootState=await localRequest('media-root');setRoot(state);setReadError('');if(value.status==='completed'){setPath(state.path);setMessage('媒体根迁移完成，服务已使用新位置。');}else if(value.status==='rolled_back')setMessage('已回滚未完成迁移，副本和原文件已保留。');}
   else setMessage('已打开媒体根文件夹。');
  }catch(e){setError(e instanceof Error?e.message:String(e));if(command==='executeMigration'||command==='rollbackMigration')try{setRoot(await localRequest('media-root'));}catch{setReadError('未能读取最新进度，请重新打开本机存储。');}}finally{setPending('');}
 }
 async function copy(){if(!root)return;setError('');try{await navigator.clipboard.writeText(root.path);setMessage('路径已复制。');}catch{setError('未能复制路径，请选中路径后手动复制。');}}
 const plan=root?.migration,m=plan?.manifest,progress=plan?.progress;
 const active=['copying','failed','committed'].includes(plan?.status??''),feedback=error||plan?.error||readError;
 const planTitles={planned:'计划已保存',copying:'正在迁移',failed:'迁移未完成',committed:'切换待恢复',completed:'迁移完成',rolled_back:'已回滚'};
 const locationForm=root&&<form onSubmit={event=>{event.preventDefault();void command(root.canInitialize?'initialize':'planMigration');}}><label>{root.canInitialize?'初始化位置':'新位置'}<InputBase size="sm" aria-label={root.canInitialize?'初始化位置':'新位置'} value={path} disabled={busy||active} onChange={event=>setPath(event.target.value)}/></label><div className="media-root-actions"><Button size="sm" color="secondary" iconLeading={FolderSearch} type="button" isDisabled={busy||active} onClick={()=>void command('choose')}>选择文件夹</Button><Button size="sm" color="primary" type="submit" isDisabled={busy||active||!path.trim()||path===root.path}>{root.canInitialize?(pending==='initialize'?'初始化中…':'初始化媒体根'):(pending==='planMigration'?'正在盘点…':'盘点迁移')}</Button></div></form>;
 return <div className="modal-backdrop owner-preferences-backdrop"><div className="owner-preferences-dialog media-root-dialog" role="dialog" aria-modal="true" aria-label="本机存储" ref={ref}>
  <header><h2>本机存储</h2><Button size="sm" color="tertiary" iconLeading={X} aria-label="关闭本机存储" isDisabled={busy&&pending!=='executeMigration'} onClick={onClose}/></header>
  <section className="media-root-content">
   <h3>媒体根目录</h3>
   {root?<><div className="media-root-current"><span className="media-root-path" title={root.path}>{root.path}</span><div><Button size="sm" color="tertiary" iconLeading={Copy} aria-label="复制媒体根路径" isDisabled={busy} onClick={()=>void copy()}/><Button size="sm" color="secondary" iconLeading={FolderOpen} isDisabled={busy||root.status!=='ready'} onClick={()=>void command('open')}>打开文件夹</Button></div></div>
   {root.status==='unavailable'&&plan?.status!=='committed'&&<p role="alert" className="form-error">{root.reason}</p>}
   {!active&&(plan?.status==='completed'?<details className="media-root-next"><summary>更换媒体根</summary>{locationForm}</details>:locationForm)}
   </>:<p role="status">{busy?'正在读取媒体根…':'媒体根未读取，请关闭后重试。'}</p>}
   {feedback&&<p role="alert" className="form-error">{feedback}</p>}
   <p role="status" className="media-root-feedback">{message}</p>
   {m&&<section className="media-root-plan" aria-label="已保存的迁移计划">
    <h3>{planTitles[plan!.status]}</h3><div className="media-root-plan-path"><span>目标</span><span className="media-root-path" title={m.targetBinding.path}>{m.targetBinding.path}</span></div>
    <p>{m.accounts.length} 个账号 · {m.episodes.length} 个生产单 · {m.fileCount} 个文件 · {bytes(m.totalBytes)}</p>
    {progress&&plan?.status!=='planned'&&<div className="media-root-copy-progress"><progress aria-label="迁移复制进度" max={m.totalBytes||1} value={Math.min(progress.copiedBytes,m.totalBytes)}/><p>{progress.copiedFiles} / {m.fileCount} 个文件 · {bytes(progress.copiedBytes)} / {bytes(m.totalBytes)}</p>{progress.activeFile&&<span className="media-root-path" title={progress.activeFile}>{progress.activeFile}</span>}</div>}
    {plan?.status!=='completed'&&plan?.status!=='rolled_back'&&<div className="media-root-actions">
     {plan?.status!=='committed'&&<Button size="sm" color="secondary" isDisabled={busy||root?.executing} onClick={()=>void command('rollbackMigration')}>{plan?.status==='planned'?'取消计划':'回滚未完成迁移'}</Button>}
     <Button size="sm" color="primary" isDisabled={busy||root?.executing||plan?.status==='planned'&&!m.canExecute} onClick={()=>void command('executeMigration')}>{root?.executing?'迁移进行中…':pending==='executeMigration'?'正在处理…':plan?.status==='committed'?'继续恢复':plan?.status==='planned'?'开始迁移':'继续迁移'}</Button>
    </div>}
    {plan?.status==='planned'?<dl className="media-root-space"><div><dt>目标已有</dt><dd>{m.target.existingFileCount} 个文件 / {bytes(m.target.existingBytes)}</dd></div><div><dt>可用空间</dt><dd>{bytes(m.space.freeBytes)}</dd></div><div><dt>所需空间</dt><dd>{bytes(m.space.requiredBytes)}（含预留 {bytes(m.space.reserveBytes)}）</dd></div><div><dt>未完成副本</dt><dd>{m.incompleteCopies.length} 项 / {bytes(m.incompleteCopies.reduce((n,f)=>n+f.bytes,0))}</dd></div></dl>:<details><summary>盘点时空间</summary><dl className="media-root-space"><div><dt>目标已有</dt><dd>{m.target.existingFileCount} 个文件 / {bytes(m.target.existingBytes)}</dd></div><div><dt>可用空间</dt><dd>{bytes(m.space.freeBytes)}</dd></div><div><dt>所需空间</dt><dd>{bytes(m.space.requiredBytes)}（含预留 {bytes(m.space.reserveBytes)}）</dd></div><div><dt>未完成副本</dt><dd>{m.incompleteCopies.length} 项 / {bytes(m.incompleteCopies.reduce((n,f)=>n+f.bytes,0))}</dd></div></dl></details>}
    {!!(m.conflicts.length+m.blockers.length)&&<ul className="media-root-conflicts" aria-label="迁移阻塞">{[...new Set([...m.conflicts,...m.blockers.map(b=>b.reason)])].map(reason=><li key={reason}>{reason}</li>)}</ul>}
    <details><summary>迁移范围</summary><p>{m.directoryCount} 个目录 · {m.references.length} 条文件引用</p><ul>{m.accounts.map(account=><li key={account.id}>{account.name}</li>)}{m.episodes.map(episode=><li key={episode.id}>{episode.title}</li>)}</ul><details><summary>文件清单（{m.fileCount}）</summary><ul>{m.files.slice(0,100).map((file,index)=><li key={file.episodeId+':'+index} className="media-root-path" title={file.targetRelativePath}>{file.targetRelativePath}</li>)}</ul>{m.fileCount>100&&<p>显示前 100 项，完整清单已保存在计划中。</p>}</details></details>
    <details><summary>保留原位置（{m.retained.length}）</summary><ul>{m.retained.map((resource,index)=><li key={index}><span>{resourceNames[resource.kind]??resource.kind}</span>{resource.path&&<span className="media-root-path" title={resource.path}>{resource.path}</span>}<small>{resource.reason}</small></li>)}</ul></details>
    <p className="owner-preferences-note">{plan?.status==='completed'?'原位置文件已保留。':plan?.status==='committed'?'复制已校验，切换尚未完成。请继续恢复或重启本机服务。':plan?.status==='copying'?'可关闭页面，复制进度和恢复记录会保留。':plan?.status==='rolled_back'?'继续使用原位置，已复制的文件保留。':plan?.status==='failed'?'原位置仍保留。可继续迁移或回滚未完成操作。':'原文件不会自动删除。'}</p>
   </section>}
  </section>
 </div></div>;
}
