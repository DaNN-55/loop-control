import {useEffect,useRef,useState} from 'react';
import {Copy,FolderOpen,FolderSearch,X} from 'lucide-react';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import {InputBase} from '../ui/dan-ui/components/base/input/input';
import {useDialogFocus} from '../ui/useDialogFocus';
import {localRequest} from './client';
import './media-root-settings.css';
interface RootPlan{id:string;manifestSha256:string;manifest:{sourceBinding:{path:string};targetBinding:{path:string};accounts:{id:string;name:string}[];episodes:{id:string;title:string}[];files:{episodeId:string;targetRelativePath:string;fileSize:number}[];references:unknown[];fileCount:number;directoryCount:number;totalBytes:number;target:{existingFileCount:number;existingBytes:number};space:{freeBytes:number;reserveBytes:number;requiredBytes:number};incompleteCopies:{path:string;bytes:number;verified:boolean}[];retained:{path?:string;kind:string;reason:string}[];conflicts:string[];blockers:{reason:string}[]}}
interface RootState{path:string;canInitialize:boolean;status:'ready'|'unavailable';reason?:string;migration:RootPlan|null}
const bytes=(value:number)=>new Intl.NumberFormat('zh-CN',{style:'unit',unit:'byte',unitDisplay:'short'}).format(value);
const resourceNames:Record<string,string>={program:'共享程序',runtime:'运行环境',state:'运行状态',history:'独立历史库',backup:'备份','model-cache':'模型缓存',secrets:'秘密',unknown:'未知或手动内容'};
export function MediaRootSettingsDialog({csrf,onClose}:{csrf:string;onClose:()=>void}){
 const [root,setRoot]=useState<RootState|null>(null),[path,setPath]=useState(''),[pending,setPending]=useState('read'),[error,setError]=useState(''),[message,setMessage]=useState('');
 const planRequest=useRef<{path:string;key:string}|null>(null),ref=useDialogFocus<HTMLDivElement>(true,()=>{if(!pending)onClose();}),busy=!!pending;
 useEffect(()=>{const controller=new AbortController();void localRequest('media-root',{signal:controller.signal}).then((value:RootState)=>{setRoot(value);setPath(value.migration?.manifest.targetBinding.path??value.path);}).catch(e=>{if(!controller.signal.aborted)setError(e instanceof Error?e.message:String(e));}).finally(()=>{if(!controller.signal.aborted)setPending('');});return()=>controller.abort();},[]);
 async function command(command:'choose'|'open'|'initialize'|'planMigration'){
  if(busy)return;setPending(command);setError('');setMessage('');
  if(command==='planMigration'&&planRequest.current?.path!==path)planRequest.current={path,key:crypto.randomUUID()};
  try{
   const value=await localRequest('media-root',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify({command,idempotencyKey:command==='planMigration'?planRequest.current!.key:crypto.randomUUID(),...(['initialize','planMigration'].includes(command)?{path}:{})})});
   if(command==='choose'){if(!value.cancelled)setPath(value.path);}
   else if(command==='initialize'){setRoot(value);setPath(value.path);setMessage('媒体根已初始化，服务已重新加载。');}
   else if(command==='planMigration'){planRequest.current=null;setRoot(current=>current?{...current,migration:value}:current);setMessage('计划已保存，当前位置未改变。');}
   else setMessage('已打开媒体根文件夹。');
  }catch(e){setError(e instanceof Error?e.message:String(e));}finally{setPending('');}
 }
 async function copy(){if(!root)return;setError('');try{await navigator.clipboard.writeText(root.path);setMessage('路径已复制。');}catch{setError('未能复制路径，请选中路径后手动复制。');}}
 const plan=root?.migration,m=plan?.manifest;
 return <div className="modal-backdrop owner-preferences-backdrop"><div className="owner-preferences-dialog media-root-dialog" role="dialog" aria-modal="true" aria-label="本机存储" ref={ref}>
  <header><h2>本机存储</h2><Button size="sm" color="tertiary" iconLeading={X} aria-label="关闭本机存储" isDisabled={busy} onClick={onClose}/></header>
  <section className="media-root-content">
   <h3>媒体根目录</h3>
   {root?<><div className="media-root-current"><span className="media-root-path" title={root.path}>{root.path}</span><div><Button size="sm" color="tertiary" iconLeading={Copy} aria-label="复制媒体根路径" isDisabled={busy} onClick={()=>void copy()}/><Button size="sm" color="secondary" iconLeading={FolderOpen} isDisabled={busy||root.status!=='ready'} onClick={()=>void command('open')}>打开文件夹</Button></div></div>
   {root.status==='unavailable'&&<p role="alert" className="form-error">{root.reason}</p>}
   <form onSubmit={event=>{event.preventDefault();void command(root.canInitialize?'initialize':'planMigration');}}><label>{root.canInitialize?'初始化位置':'新位置'}<InputBase size="sm" aria-label={root.canInitialize?'初始化位置':'新位置'} value={path} disabled={busy} onChange={event=>setPath(event.target.value)}/></label><div className="media-root-actions"><Button size="sm" color="secondary" iconLeading={FolderSearch} type="button" isDisabled={busy} onClick={()=>void command('choose')}>选择文件夹</Button><Button size="sm" color="primary" type="submit" isDisabled={busy||!path.trim()||path===root.path}>{root.canInitialize?(pending==='initialize'?'初始化中…':'初始化媒体根'):(pending==='planMigration'?'正在盘点…':'盘点迁移')}</Button></div></form>
   </>:<p role="status">{busy?'正在读取媒体根…':'媒体根未读取，请关闭后重试。'}</p>}
   {error&&<p role="alert" className="form-error">{error}</p>}
   <p role="status" className="media-root-feedback">{message}</p>
   {m&&<section className="media-root-plan" aria-label="已保存的迁移计划">
    <h3>计划已保存</h3><div className="media-root-plan-path"><span>目标</span><span className="media-root-path" title={m.targetBinding.path}>{m.targetBinding.path}</span></div>
    <p>{m.accounts.length} 个账号 · {m.episodes.length} 个生产单 · {m.fileCount} 个文件 · {bytes(m.totalBytes)}</p>
    <dl className="media-root-space"><div><dt>目标已有</dt><dd>{m.target.existingFileCount} 个文件 / {bytes(m.target.existingBytes)}</dd></div><div><dt>可用空间</dt><dd>{bytes(m.space.freeBytes)}</dd></div><div><dt>所需空间</dt><dd>{bytes(m.space.requiredBytes)}（含预留 {bytes(m.space.reserveBytes)}）</dd></div><div><dt>未完成副本</dt><dd>{m.incompleteCopies.length} 项 / {bytes(m.incompleteCopies.reduce((n,f)=>n+f.bytes,0))}</dd></div></dl>
    {!!(m.conflicts.length+m.blockers.length)&&<ul className="media-root-conflicts" aria-label="迁移阻塞">{[...new Set([...m.conflicts,...m.blockers.map(b=>b.reason)])].map(reason=><li key={reason}>{reason}</li>)}</ul>}
    <details><summary>迁移范围</summary><p>{m.directoryCount} 个目录 · {m.references.length} 条文件引用</p><ul>{m.accounts.map(account=><li key={account.id}>{account.name}</li>)}{m.episodes.map(episode=><li key={episode.id}>{episode.title}</li>)}</ul><details><summary>文件清单（{m.fileCount}）</summary><ul>{m.files.slice(0,100).map((file,index)=><li key={file.episodeId+':'+index} className="media-root-path" title={file.targetRelativePath}>{file.targetRelativePath}</li>)}</ul>{m.fileCount>100&&<p>显示前 100 项，完整清单已保存在计划中。</p>}</details></details>
    <details><summary>保留原位置（{m.retained.length}）</summary><ul>{m.retained.map((resource,index)=><li key={index}><span>{resourceNames[resource.kind]??resource.kind}</span>{resource.path&&<span className="media-root-path" title={resource.path}>{resource.path}</span>}<small>{resource.reason}</small></li>)}</ul></details>
    <p className="owner-preferences-note">当前仅保存盘点，原文件和读写位置保持不变。</p>
   </section>}
  </section>
 </div></div>;
}
