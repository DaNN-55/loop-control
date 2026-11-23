import {FeedbackNotice} from '../ui/FeedbackNotice';
import {getUiLocale,uiText} from '../i18n/ui';
import {useEffect,useRef,useState,type ReactNode} from 'react';
import {FolderOpen,FolderSearch,LoaderCircle,X} from 'lucide-react';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import {InputBase} from '../ui/dan-ui/components/base/input/input';
import {useDialogFocus} from '../ui/useDialogFocus';
import {localRequest} from './client';
import {SettingsRefreshButton} from './OwnerSettingsDialog';
import './media-root-settings.css';
interface RootPlan{id:string;status:'planned'|'copying'|'failed'|'committed'|'completed'|'rolled_back';manifestSha256:string;progress?:{copiedFiles:number;copiedBytes:number;activeFile?:string;activeFileBytes?:number};error?:string;manifest:{sourceBinding:{path:string};targetBinding:{path:string};accounts:{id:string;name:string}[];episodes:{id:string;title:string}[];files:{episodeId:string;targetRelativePath:string;fileSize:number}[];references:unknown[];fileCount:number;directoryCount:number;totalBytes:number;target:{existingFileCount:number;existingBytes:number};space:{freeBytes:number;reserveBytes:number;requiredBytes:number};incompleteCopies:{path:string;bytes:number;verified:boolean}[];retained:{path?:string;kind:string;reason:string}[];canExecute:boolean;conflicts:string[];blockers:{reason:string}[]}}
interface RootState{executing?:boolean;path:string;initialized?:boolean;canInitialize:boolean;status:'ready'|'unavailable';reason?:string;migration:RootPlan|null}
const bytes=(value:number)=>{const unit=value>=1024**3?3:value>=1024**2?2:value>=1024?1:0;return `${new Intl.NumberFormat(getUiLocale(),{maximumFractionDigits:1}).format(value/1024**unit)} ${['B','KB','MB','GB'][unit]}`;};
export function MediaRootSettingsDialog({csrf,onClose,embedded=false,onStateChange,children}:{children?:ReactNode;csrf:string;onClose:()=>void;embedded?:boolean;onStateChange?:(state:{busy:boolean;dirty:boolean})=>void}){
 const [root,setRoot]=useState<RootState|null>(null),[path,setPath]=useState(''),[pending,setPending]=useState(''),[reading,setReading]=useState(true),[error,setError]=useState(''),[message,setMessage]=useState(''),[readError,setReadError]=useState(''),[editing,setEditing]=useState(false),[confirmed,setConfirmed]=useState(false);
 const firstInitialization=!!root?.canInitialize&&root.initialized!==true;
 const readRequest=useRef<{controller:AbortController;kind:'manual'|'poll'|'command'}|null>(null);
 const mounted=useRef(false),operation=useRef(false);
 const planRequest=useRef<{path:string;key:string}|null>(null),ref=useDialogFocus<HTMLDivElement>(!embedded,()=>{if(!pending&&!reading||pending==='executeMigration')onClose();}),busy=!!pending||reading;
 const observing=pending==='executeMigration'||root?.executing===true;
 const stateChanged=useRef(onStateChange);stateChanged.current=onStateChange;
 const savedPath=root?.migration&&!['completed','rolled_back'].includes(root.migration.status)?root.migration.manifest.targetBinding.path:root?.path;
 const pathDirty=!!root&&path.trim()!==savedPath;
 useEffect(()=>{stateChanged.current?.({busy:!!pending&&pending!=='executeMigration',dirty:pathDirty});},[pending,pathDirty]);
 useEffect(()=>()=>stateChanged.current?.({busy:false,dirty:false}),[]);
 function cancelRead(){if(mounted.current&&readRequest.current?.kind==='manual')setReading(false);readRequest.current?.controller.abort();readRequest.current=null;}
 async function reload(kind:'manual'|'poll'|'command'='manual'){
  if(kind==='poll'&&(document.visibilityState==='hidden'||readRequest.current))return;
  cancelRead();const request={controller:new AbortController(),kind};readRequest.current=request;
  if(kind==='manual'){setReading(true);setReadError('');}
  try{
   const value:RootState=await localRequest('media-root',{signal:request.controller.signal});
   if(!mounted.current||readRequest.current!==request)return;
   setRoot(value);setReadError('');setPath(current=>current||(value.migration&&!['completed','rolled_back'].includes(value.migration.status)?value.migration.manifest.targetBinding.path:value.path));
   if(kind!=='manual'&&value.migration?.status==='completed'){setPath(value.path);setEditing(false);setMessage("媒体根迁移完成，服务已使用新位置。");}
   return value;
  }catch(e){if(mounted.current&&readRequest.current===request&&!request.controller.signal.aborted)setReadError(e instanceof Error?e.message:String(e));}
  finally{if(mounted.current&&readRequest.current===request){readRequest.current=null;if(kind==='manual')setReading(false);}}
 }
 useEffect(()=>{mounted.current=true;void reload();return()=>{mounted.current=false;cancelRead();};},[]);
 useEffect(()=>{
  if(!observing)return;
  let active=true,generation=0,timer:ReturnType<typeof setTimeout>|undefined;
  const refresh=async(visit=generation)=>{await reload('poll');if(active&&visit===generation&&document.visibilityState!=='hidden')timer=setTimeout(()=>void refresh(visit),500);};
  const visibility=()=>{generation++;clearTimeout(timer);if(document.visibilityState==='hidden'){if(readRequest.current?.kind==='poll')cancelRead();}else void refresh();};
  document.addEventListener('visibilitychange',visibility);void refresh();
  return()=>{active=false;clearTimeout(timer);document.removeEventListener('visibilitychange',visibility);if(readRequest.current?.kind==='poll')cancelRead();};
 },[observing]);
 async function command(command:'choose'|'open'|'initialize'|'planMigration'|'executeMigration'|'rollbackMigration'){

  if(operation.current||readRequest.current?.kind==='manual'||busy||command==='executeMigration'&&root?.migration?.status==='planned'&&(!confirmed||path.trim()!==root.migration.manifest.targetBinding.path||!root.migration.manifest.canExecute))return;operation.current=true;cancelRead();setPending(command);setError('');setMessage('');
  if(command==='planMigration'&&planRequest.current?.path!==path)planRequest.current={path,key:crypto.randomUUID()};
  try{
   const value=await localRequest('media-root',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify({command,idempotencyKey:command==='planMigration'?planRequest.current!.key:crypto.randomUUID(),...(['initialize','planMigration'].includes(command)?{path}:{}),...(['executeMigration','rollbackMigration'].includes(command)?{migrationId:root?.migration?.id}:{})})});
   if(!mounted.current)return;
   if(command==='choose'){if(!value.cancelled)setPath(value.path);}
   else if(command==='initialize'){setRoot(value);setPath(value.path);setMessage("媒体根已初始化，服务已重新加载。");}
   else if(command==='planMigration'){planRequest.current=null;setRoot(current=>current?{...current,migration:value}:current);setPath(value.manifest.targetBinding.path);setConfirmed(false);setMessage("迁移计划已检查，尚未开始迁移。");}
   else if(command==='executeMigration'||command==='rollbackMigration'){const state=await reload('command');if(!mounted.current||!state)return;if(state.migration?.status==='completed'){setPath(state.path);setEditing(false);setMessage("媒体根迁移完成，服务已使用新位置。");}else if(value.status==='rolled_back')setMessage("已回滚未完成迁移，副本和原文件已保留。");}
   else setMessage("已打开媒体根文件夹。");
  }catch(e){if(mounted.current){setError(e instanceof Error?e.message:String(e));if(command==='executeMigration'||command==='rollbackMigration')await reload('command');}}finally{operation.current=false;if(mounted.current)setPending('');}
 }
 const plan=root?.migration,m=plan?.manifest,progress=plan?.progress;
 const targetChanged=plan?.status==='planned'&&path.trim()!==m?.targetBinding.path;
 useEffect(()=>{setConfirmed(false);},[plan?.id,path]);
 const storageReadFeedback=readError||(root?.status==='unavailable'&&plan?.status!=='committed'?root.reason:'');
 const active=['copying','failed','committed'].includes(plan?.status??''),feedback=error||plan?.error;
 const content=<section className="media-root-content" aria-label={uiText("存储位置")}>
  <h3 className="media-root-section-heading"><span>{uiText(embedded?"制作文件":"存储位置")}</span>{embedded&&root&&<span role="status" className={root.status==='ready'?"is-ready":"is-unavailable"}>{uiText(root.status==='ready'?"可用":"不可用")}</span>}</h3>
  {root?<>
   {embedded&&<p className="media-root-description">{uiText("素材、生成结果和交付文件保存在这里。")}</p>}
   <article className="media-root-current">
    <div className="media-root-location">{embedded&&<FolderOpen size={22} aria-hidden="true"/>}<div>{embedded&&<strong>{root.path.split('/').filter(Boolean).at(-1)||root.path}</strong>}<span className="media-root-path" title={root.path}>{root.path}</span></div></div>
    <footer className="media-root-current-actions">
     <Button size="sm" color={embedded?"secondary":"tertiary"} iconLeading={FolderOpen} aria-label={uiText("打开存储文件夹")} title={uiText("打开文件夹")} type="button" isDisabled={busy||root.status!=='ready'} onClick={()=>void command('open')}>{uiText("打开文件夹")}</Button>
     <Button size="sm" color={embedded?"secondary":"tertiary"} iconLeading={FolderSearch} aria-label={uiText("更换存储位置")} title={uiText("更换存储位置")} type="button" isDisabled={busy||active} onClick={()=>setEditing(true)}>{uiText("更换位置")}</Button>
    </footer>
   </article>
   {!active&&(editing||firstInitialization||root.migration?.status==='planned'||path!==root.path)&&<div className="media-root-location-form"><label>{firstInitialization?uiText("初始化位置"):uiText("新位置")}<InputBase size="sm" aria-label={embedded?uiText("素材保存目录"):firstInitialization?uiText("初始化位置"):uiText("新位置")} value={path} disabled={busy} onChange={event=>setPath(event.target.value)} onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();if(path.trim())void command(firstInitialization?'initialize':'planMigration');}}}/></label><div className="media-root-actions">{editing&&!firstInitialization&&(!plan||['completed','rolled_back'].includes(plan.status))&&<Button size="sm" color="secondary" isDisabled={busy} onPress={()=>{setPath(root.path);setEditing(false);setError('');}}>{uiText('取消')}</Button>}<Button size="sm" color="secondary" type="button" iconLeading={FolderSearch} aria-label={embedded?uiText("选择素材文件夹"):uiText("选择文件夹")} title={uiText("选择文件夹")} isDisabled={busy} onClick={()=>void command('choose')}>{uiText("选择文件夹")}</Button><Button size="sm" color="primary" type="button" isDisabled={busy||!path.trim()||!firstInitialization&&path===root.path} onClick={()=>void command(firstInitialization?'initialize':'planMigration')}>{pending==='planMigration'?uiText("检查中…"):firstInitialization?uiText("初始化"):uiText("检查迁移计划")}</Button></div><p className="media-root-help">{uiText(firstInitialization?"制作文件会保存在所选位置。":"先检查迁移范围，再确认搬迁。")}</p></div>}
  </>:<p role="status">{busy?uiText("正在读取存储位置…"):uiText("存储位置未读取。")}</p>}
  {storageReadFeedback&&<div className="media-root-read-error"><p role="alert" className="form-error">{uiText(storageReadFeedback)}</p><Button size="sm" color="secondary" type="button" isDisabled={reading||!!pending&&pending!=='executeMigration'} onClick={()=>void reload()}>{uiText("重新读取存储位置")}</Button></div>}
  {feedback&&<p role="alert" className="form-error">{uiText(feedback)}</p>}
  <FeedbackNotice message={message} tone="info" onDismiss={()=>setMessage('')}/>
  {m&&plan&&!['completed','rolled_back'].includes(plan.status)&&<div className="media-root-plan" aria-label={uiText("迁移进度")}>
   <div className="media-root-plan-path"><span>{observing?<LoaderCircle className="media-root-spinner" size={16} aria-hidden="true"/>:null}{observing?uiText("正在迁移"):plan.status==='copying'?uiText("迁移已中断"):plan.status==='failed'?uiText("迁移未完成"):plan.status==='committed'?uiText("切换待恢复"):uiText("迁移到")}</span><span className="media-root-path" title={m.targetBinding.path}>{m.targetBinding.path}</span></div>
   {plan.status!=='planned'?<div className="media-root-copy-progress" role="status" aria-live="polite"><progress aria-label={uiText("文件复制进度")} max={m.totalBytes||1} value={m.totalBytes?Math.min(progress?.copiedBytes??0,m.totalBytes):undefined}/><p>{uiText('{copied} / {total} 个文件 · {bytes} / {totalBytes}',{copied:progress?.copiedFiles??0,total:m.fileCount,bytes:bytes(progress?.copiedBytes??0),totalBytes:bytes(m.totalBytes)})}</p><p className="media-root-help">{plan.status==='committed'?uiText("文件已验证，正在恢复新位置。"):(progress?.copiedBytes??0)>=m.totalBytes?uiText("复制完成，尚需验证文件并切换位置。"):observing?uiText("正在复制文件，随后验证并切换位置。"):uiText("迁移尚未完成，可继续同一计划或回滚。")}</p></div>:<p>{uiText('{accounts} 个账号 · {episodes} 个生产单 · {files} 个文件 · {bytes}',{accounts:m.accounts.length,episodes:m.episodes.length,files:m.fileCount,bytes:bytes(m.totalBytes)})}</p>}
   {plan.status==='planned'&&<>
    <dl className="media-root-space"><div><dt>{uiText("目标可用空间")}</dt><dd>{bytes(m.space.freeBytes)}</dd></div><div><dt>{uiText("迁移所需空间")}</dt><dd>{bytes(m.space.requiredBytes)}</dd></div><div><dt>{uiText("其中预留空间")}</dt><dd>{bytes(m.space.reserveBytes)}</dd></div></dl>
    <p className="media-root-help">{uiText("检查计划不会复制文件。")}</p>
    {targetChanged?<p role="alert" className="form-error">{uiText("目标位置已更改，请重新检查迁移计划。")}</p>:<label className="media-root-confirm"><input type="checkbox" checked={confirmed} disabled={busy||!m.canExecute} onChange={event=>setConfirmed(event.target.checked)}/>{uiText("确认迁移完成后使用新位置，原文件保留")}</label>}
   </>}
   {!!(m.conflicts.length+m.blockers.length)&&<ul className="media-root-conflicts" aria-label={uiText("迁移阻塞")}>{[...new Set([...m.conflicts,...m.blockers.map(b=>b.reason)])].map(reason=><li key={reason}>{uiText(reason)}</li>)}</ul>}
   {!observing&&<div className="media-root-actions">{plan.status!=='committed'&&<Button size="sm" color="secondary" type="button" isDisabled={busy||root?.executing} onClick={()=>void command('rollbackMigration')}>{plan.status==='planned'?uiText("取消"):uiText("回滚未完成迁移")}</Button>}<Button size="sm" color="primary" type="button" isDisabled={busy||root?.executing||plan.status==='planned'&&(!m.canExecute||targetChanged||!confirmed)} onClick={()=>void command('executeMigration')}>{plan.status==='committed'?uiText("继续恢复"):plan.status==='planned'?uiText("开始迁移"):uiText("继续迁移")}</Button></div>}
  </div>}
 </section>;
 if(embedded)return <><div className="owner-storage-body">{content}{children}</div><footer className="settings-refresh-footer"><span role="status">{reading?uiText('正在读取存储位置…'):root?uiText(root.status==='ready'?'可用':'不可用'):uiText('存储位置未读取。')}</span><SettingsRefreshButton refreshing={reading} disabled={busy||pathDirty} onRefresh={()=>void reload()}/></footer></>;
 return <div className="modal-backdrop owner-preferences-backdrop"><div className="owner-preferences-dialog media-root-dialog" role="dialog" aria-modal="true" aria-label={uiText("存储位置")} ref={ref}><header><h2>{uiText("存储位置")}</h2><Button size="sm" color="tertiary" iconLeading={X} aria-label={uiText("关闭存储位置")} isDisabled={busy&&pending!=='executeMigration'} onClick={onClose}/></header>{content}</div></div>;
}
