import {uiText} from '../i18n/ui';
import {useEffect,useId,useRef,useState} from 'react';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import {localCommand} from '../local-app/client';

interface DirectoryState { assetRoot: string | null; status: 'ready' | 'unset' | 'conflict' | 'unavailable' }

export function AccountDirectoryPanel({accountId}:{accountId:string}) {
 return <AccountDirectorySession key={accountId} accountId={accountId}/>;
}
function AccountDirectorySession({accountId}:{accountId:string}) {
 const statusId=useId(),visit=useRef({active:false,busy:false});
 const [state,setState]=useState<DirectoryState|null>(null);
 const [copied,setCopied]=useState(false),[pending,setPending]=useState<'read'|'open'|'copy'|''>('read'),[error,setError]=useState('');
 async function reload(){
  if(!visit.current.active||visit.current.busy)return;
  visit.current.busy=true;setPending('read');setCopied(false);setError('');
  try{const value=await localCommand<DirectoryState>('readAssetDirectory',{accountId},undefined,'account-commands');if(visit.current.active)setState(value);}
  catch(cause){if(visit.current.active)setError(cause instanceof Error?cause.message:uiText("账号目录读取失败。"));}
  finally{visit.current.busy=false;if(visit.current.active)setPending('');}
 }
 useEffect(()=>{visit.current.active=true;void reload();return()=>{visit.current.active=false;};},[]);
 async function open() {
  if(!visit.current.active||visit.current.busy||state?.status!=='ready')return;
  visit.current.busy=true;setPending('open');setError('');
  try { await localCommand('openAssetDirectory',{accountId},undefined,'account-commands'); }
  catch(cause){if(visit.current.active)setError(cause instanceof Error?cause.message:uiText("未能打开账号目录。"));}
  finally{visit.current.busy=false;if(visit.current.active)setPending('');}
 }
 async function copy(){
  if(!visit.current.active||visit.current.busy||!state?.assetRoot)return;
  visit.current.busy=true;setPending('copy');setCopied(false);setError('');
  try{await navigator.clipboard.writeText(state.assetRoot);if(visit.current.active)setCopied(true);}
  catch{if(visit.current.active)setError(uiText("未能复制账号目录。"));}
  finally{visit.current.busy=false;if(visit.current.active)setPending('');}
 }
 const status=state?.status==='ready'||error?'':pending==='read'?uiText("正在读取账号目录…"):!state?uiText("账号目录未读取。"):state.status==='unset'?uiText("尚未建立账号目录。"):state.status==='conflict'?uiText("发现多个账号目录，暂时无法打开。"):uiText("账号目录不可用，请检查素材盘是否已连接。");
 return <div className="account-directory-metadata" aria-busy={pending==='read'}>
  <div className="account-directory-row">
   <span className="field-label">{uiText("账号目录")}</span>
   <span className="account-directory-path" title={state?.assetRoot??undefined} id={!state?.assetRoot&&status?statusId:undefined} role={!state?.assetRoot&&status?'status':undefined}>{state?.assetRoot??(error?uiText("读取失败"):status)}</span>
   <Button size="xs" color="secondary" type="button" aria-describedby={status?statusId:undefined} isDisabled={!!pending||state?.status!=='ready'} onClick={()=>void open()}>{uiText("打开")}</Button>
   <Button size="xs" color="tertiary" type="button" aria-label={uiText("复制账号目录路径")} aria-describedby={!state?.assetRoot&&status?statusId:undefined} isDisabled={!!pending||!state?.assetRoot} onClick={()=>void copy()}>{pending==='copy'?uiText("复制中…"):copied?uiText("已复制"):uiText("复制")}</Button>
   {(error||state?.status!=='ready')&&<Button size="xs" color="tertiary" type="button" aria-label={uiText("重新读取账号目录")} isDisabled={!!pending} onClick={()=>void reload()}>{pending==='read'?uiText("读取中…"):uiText("重新读取")}</Button>}
  </div>
  {status&&state?.assetRoot&&<p id={statusId} role="status" className="field-hint">{status}</p>}
  {error?<p role="alert" className="form-error">{uiText(error)}</p>:null}
 </div>;
}
