import {useEffect,useState,type FormEvent} from 'react';
import {InputBase} from '../ui/dan-ui/components/base/input/input';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import {HelpTip} from '../ui/HelpTip';
import {localCommand} from '../local-app/client';
interface DirectoryState{assetRoot:string|null;legacyRoots:string[];status:'ready'|'unset'|'conflict'|'unavailable';reason?:string}
interface Migration{id:string;status:'planned'|'copying'|'failed'|'completed'|'rolled_back';targetRoot:string;sources:{path:string}[];episodes:{id:string;title:string}[];files:{sourceRoot:string;relativePath:string;sha256:string;fileSize:number}[];references:unknown[];totalBytes:number;conflicts:string[];error?:string}
const migrationStatus={planned:'待迁移',copying:'复制中，可在中断后恢复',failed:'未切换，可恢复或回滚',completed:'已完成，原位置保留',rolled_back:'已回滚，原位置继续使用'};
export function AccountDirectoryPanel({accountId,disabled=false}:{accountId:string;disabled?:boolean}){
 const [copied,setCopied]=useState(false);
 const [state,setState]=useState<DirectoryState|null>(null),[path,setPath]=useState(''),[pending,setPending]=useState(false),[error,setError]=useState(''),[migrations,setMigrations]=useState<Migration[]>([]),[migration,setMigration]=useState<Migration|null>(null);
 useEffect(()=>{let current=true;setState(null);setPath('');setError('');setMigrations([]);setMigration(null);
 void Promise.all([localCommand<DirectoryState>('readAssetDirectory',{accountId},undefined,'account-commands'),localCommand<Migration[]>('readAssetDirectoryMigrations',{accountId},undefined,'account-commands')]).then(([value,history])=>{if(current){setState(value);setPath(value.assetRoot??(value.legacyRoots?.length===1?value.legacyRoots[0]:''));if(Array.isArray(history)){setMigrations(history);setMigration(history[0]??null);}}}).catch(cause=>{if(current)setError(cause instanceof Error?cause.message:'目录暂不可用。');});return()=>{current=false;};},[accountId]);
 async function refresh(){const [value,history]=await Promise.all([localCommand<DirectoryState>('readAssetDirectory',{accountId},undefined,'account-commands'),localCommand<Migration[]>('readAssetDirectoryMigrations',{accountId},undefined,'account-commands')]);setState(value);if(Array.isArray(history)){setMigrations(history);setMigration(history[0]??null);}return value;}
 async function action(command:string){if(pending)return;setPending(true);setError('');try{
  if(command==='setAssetDirectory'){const value=await localCommand<DirectoryState>(command,{accountId,path:path.trim()},undefined,'account-commands');setState(value);setPath(value.assetRoot??'');}
  else if(command==='chooseAssetDirectory'){const value=await localCommand<{assetRoot?:string;cancelled?:boolean}>(command,{accountId},undefined,'account-commands');if(value.assetRoot)setPath(value.assetRoot);}
  else if(command==='planAssetDirectoryMigration'){const value=await localCommand<Migration>(command,{accountId,path:path.trim()},undefined,'account-commands');setMigration(value);setMigrations(history=>[value,...history]);}
  else if(command==='executeAssetDirectoryMigration'||command==='rollbackAssetDirectoryMigration'){if(!migration)return;await localCommand(command,{accountId,migrationId:migration.id},undefined,'account-commands');const value=await refresh();setPath(value.assetRoot??path);}
  else await localCommand(command,{accountId},undefined,'account-commands');
 }catch(cause){setError(cause instanceof Error?cause.message:'目录操作失败。');if(command==='executeAssetDirectoryMigration')await refresh().catch(()=>{});}finally{setPending(false);}}
 function submit(e:FormEvent){e.preventDefault();void action('setAssetDirectory');}
 return <div className="account-directory-metadata">
  <div className="account-directory-row"><span className="field-label">账号目录</span><span className="account-directory-path" title={state?.assetRoot??''}>{state?.assetRoot??(state?'尚未登记':'正在读取…')}</span><Button size="xs" color="secondary" type="button" isDisabled={pending||state?.status!=='ready'} onClick={()=>void action('openAssetDirectory')}>打开</Button><Button size="xs" color="tertiary" type="button" aria-label="复制账号目录路径" isDisabled={!state?.assetRoot} onClick={()=>{void navigator.clipboard.writeText(state!.assetRoot!).then(()=>setCopied(true)).catch(()=>setError('未能复制路径，请展开后手动复制。'));}}>{copied?'已复制':'复制'}</Button></div>
  {state?.assetRoot?<details className="account-directory-full-path"><summary>完整路径</summary><code>{state.assetRoot}</code></details>:null}
  {state?.reason?<p role="status" className="muted-copy">{state.reason}</p>:null}
  {error?<p role="alert" className="form-error">{error}</p>:null}
  <details className="account-directory-repair"><summary>{state?.status==='ready'?'目录恢复与迁移':'登记历史目录或恢复'}</summary>
  <form className="configuration-form account-directory-form" aria-label="账号专属目录" onSubmit={submit}>
  <fieldset disabled={disabled||pending}><legend>账号专属目录<HelpTip label="账号目录用途">正文、素材、工程和交付保存在这个实际目录，按生产单隔离；已有文件更换位置须先盘点迁移。</HelpTip></legend>
   <label><span className="field-label">实际目录</span><div className="asset-root-control"><InputBase size="sm" aria-label="账号实际目录" value={path} onChange={e=>setPath(e.target.value)} placeholder="填写本机媒体授权根内的专属文件夹" isDisabled={disabled||pending}/><Button size="xs" color="secondary" type="button" isDisabled={disabled||pending} onClick={()=>void action('chooseAssetDirectory')}>选择文件夹</Button><Button size="xs" color="primary" type="submit" isDisabled={disabled||pending||!path.trim()}>{pending?'处理中…':state?.assetRoot===path.trim()?'保存目录':'设置目录'}</Button><Button size="xs" color="secondary" type="button" isDisabled={disabled||pending||!path.trim()||state?.assetRoot===path.trim()} onClick={()=>void action('planAssetDirectoryMigration')}>盘点迁移</Button></div></label>
   {state?.status==='ready'?<p role="status">{state.assetRoot===path.trim()?'已设置':<>目录修改未保存；当前：<code>{state.assetRoot}</code></>}</p>:state?.reason?<p role="status">{state.reason}</p>:!error?<p role="status">正在读取目录…</p>:null}
   {state?.legacyRoots?.length&&state.status!=='ready'?<details><summary>历史位置</summary><ul>{state.legacyRoots.map(root=><li key={root}><code>{root}</code></li>)}</ul></details>:null}
   {migration?<section className="account-directory-migration" aria-label="目录迁移范围" aria-busy={pending}>
    <p role="status">{migrationStatus[migration.status]}</p>
    <dl><dt>源目录</dt><dd>{migration.sources.map(source=><div key={source.path}><code>{source.path}</code></div>)}</dd><dt>目标目录</dt><dd><code>{migration.targetRoot}</code></dd><dt>范围</dt><dd>{migration.episodes.length} 个生产单 · {migration.files.length} 个文件 · {(migration.totalBytes/1024/1024).toFixed(1)} MB · {migration.references.length} 个引用</dd></dl>
    <details><summary>生产单与文件清单</summary><ul>{migration.episodes.map(episode=><li key={episode.id}>{episode.title} <code>{episode.id}</code></li>)}</ul><ul>{migration.files.map((file,i)=><li key={i}><code>{file.relativePath}</code> · {file.fileSize} 字节<details><summary>指纹与来源</summary><code>{file.sha256}</code><br/><code>{file.sourceRoot}</code></details></li>)}</ul></details>
    {migration.conflicts.length?<ul role="alert">{migration.conflicts.map(reason=><li key={reason}>{reason}</li>)}</ul>:null}
    {migration.error?<p role="alert" className="form-error">{migration.error}</p>:null}
    {!['completed','rolled_back'].includes(migration.status)?<div className="configuration-form-actions"><Button size="xs" color="primary" type="button" isDisabled={disabled||pending||migration.conflicts.length>0} onClick={()=>void action('executeAssetDirectoryMigration')}>{migration.status==='planned'?'复制、校验并切换':'恢复迁移'}</Button><Button size="xs" color="secondary" type="button" isDisabled={disabled||pending} onClick={()=>void action('rollbackAssetDirectoryMigration')}>回滚迁移</Button><span>原文件保留；回滚后的目标副本也会保留。</span></div>:null}
   </section>:null}
   {migrations.length>1?<details><summary>迁移记录</summary><ul>{migrations.map(item=><li key={item.id}><Button size="xs" color="link-gray" type="button" onClick={()=>setMigration(item)}>{migrationStatus[item.status]}：{item.targetRoot}</Button></li>)}</ul></details>:null}
  </fieldset>{error?<p role="alert" className="form-error">{error}</p>:null}
 </form></details></div>;
}
