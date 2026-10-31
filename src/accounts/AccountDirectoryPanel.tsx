import {useEffect,useState,type FormEvent} from 'react';
import {InputBase} from '../ui/dan-ui/components/base/input/input';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import {HelpTip} from '../ui/HelpTip';
import {localCommand} from '../local-app/client';
interface DirectoryState{assetRoot:string|null;legacyRoots:string[];status:'ready'|'unset'|'conflict'|'unavailable';reason?:string}
export function AccountDirectoryPanel({accountId,disabled=false}:{accountId:string;disabled?:boolean}){
 const [state,setState]=useState<DirectoryState|null>(null),[path,setPath]=useState(''),[pending,setPending]=useState(false),[error,setError]=useState('');
 useEffect(()=>{let current=true;setState(null);setPath('');setError('');void localCommand<DirectoryState>('readAssetDirectory',{accountId},undefined,'account-commands').then(value=>{if(current){setState(value);setPath(value.assetRoot??(value.legacyRoots?.length===1?value.legacyRoots[0]:''));}}).catch(cause=>{if(current)setError(cause instanceof Error?cause.message:'目录暂不可用。');});return()=>{current=false;};},[accountId]);
 async function action(command:string){if(pending)return;setPending(true);setError('');try{
  if(command==='setAssetDirectory'){const value=await localCommand<DirectoryState>(command,{accountId,path:path.trim()},undefined,'account-commands');setState(value);setPath(value.assetRoot??'');}
  else if(command==='chooseAssetDirectory'){const value=await localCommand<{assetRoot?:string;cancelled?:boolean}>(command,{accountId},undefined,'account-commands');if(value.assetRoot)setPath(value.assetRoot);}
  else await localCommand(command,{accountId,path:path.trim()},undefined,'account-commands');
 }catch(cause){setError(cause instanceof Error?cause.message:'目录操作失败。');}finally{setPending(false);}}
 function submit(e:FormEvent){e.preventDefault();void action('setAssetDirectory');}
 return <form className="configuration-form account-directory-form" aria-label="账号专属目录" onSubmit={submit}>
  <fieldset disabled={disabled||pending}><legend>账号专属目录<HelpTip label="账号目录用途">正文、素材、工程和交付保存在这个实际目录，按生产单隔离；已有文件更换位置须通过目录迁移。</HelpTip></legend>
   <label><span className="field-label">实际目录</span><div className="asset-root-control"><InputBase size="sm" aria-label="账号实际目录" value={path} onChange={e=>setPath(e.target.value)} placeholder="填写本机媒体授权根内的专属文件夹" isDisabled={disabled||pending}/><Button size="xs" color="secondary" type="button" isDisabled={disabled||pending} onClick={()=>void action('chooseAssetDirectory')}>选择文件夹</Button><Button size="xs" color="secondary" type="button" isDisabled={disabled||pending||!path.trim()} onClick={()=>void action('openAssetDirectory')}>打开</Button><Button size="xs" color="primary" type="submit" isDisabled={disabled||pending||!path.trim()}>{pending?'处理中…':state?.assetRoot===path.trim()?'保存目录':'设置目录'}</Button></div></label>
   {state?.status==='ready'?<p role="status">{state.assetRoot===path.trim()?'已设置':<>目录修改未保存；当前：<code>{state.assetRoot}</code></>}</p>:state?.reason?<p role="status">{state.reason}</p>:!error?<p role="status">正在读取目录…</p>:null}
   {state?.legacyRoots?.length&&state.status!=='ready'?<details><summary>历史位置</summary><ul>{state.legacyRoots.map(root=><li key={root}><code>{root}</code></li>)}</ul></details>:null}
  </fieldset>{error?<p role="alert" className="form-error">{error}</p>:null}
 </form>;
}
