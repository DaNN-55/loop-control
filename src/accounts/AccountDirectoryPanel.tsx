import {useEffect,useId,useState} from 'react';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import {localCommand} from '../local-app/client';

interface DirectoryState { assetRoot: string | null; status: 'ready' | 'unset' | 'conflict' | 'unavailable' }

export function AccountDirectoryPanel({accountId}:{accountId:string}) {
 const statusId=useId();
 const [state,setState]=useState<DirectoryState|null>(null);
 const [copied,setCopied]=useState(false),[pending,setPending]=useState(false),[error,setError]=useState('');
 useEffect(()=>{
  let current=true;
  setState(null);setCopied(false);setError('');
  void localCommand<DirectoryState>('readAssetDirectory',{accountId},undefined,'account-commands')
   .then(value=>{if(current)setState(value);})
   .catch(cause=>{if(current)setError(cause instanceof Error?cause.message:'账号目录读取失败。');});
  return()=>{current=false;};
 },[accountId]);
 async function open() {
  if(pending)return;
  setPending(true);setError('');
  try { await localCommand('openAssetDirectory',{accountId},undefined,'account-commands'); }
  catch(cause){setError(cause instanceof Error?cause.message:'未能打开账号目录。');}
  finally{setPending(false);}
 }
 const status=state?.status==='ready'||error?'':!state?'正在读取账号目录…':state.status==='unset'?'尚未建立账号目录。':state.status==='conflict'?'发现多个账号目录，暂时无法打开。':'账号目录不可用，请检查素材盘是否已连接。';
 return <div className="account-directory-metadata">
  <div className="account-directory-row">
   <span className="field-label">账号目录</span>
   <span className="account-directory-path" title={state?.assetRoot??undefined} id={!state?.assetRoot&&status?statusId:undefined} role={!state?.assetRoot&&status?'status':undefined}>{state?.assetRoot??(error?'读取失败':status)}</span>
   <Button size="xs" color="secondary" type="button" aria-describedby={status?statusId:undefined} isDisabled={pending||state?.status!=='ready'} onClick={()=>void open()}>打开</Button>
   <Button size="xs" color="tertiary" type="button" aria-label="复制账号目录路径" aria-describedby={!state?.assetRoot&&status?statusId:undefined} isDisabled={!state?.assetRoot} onClick={()=>{void navigator.clipboard.writeText(state!.assetRoot!).then(()=>setCopied(true)).catch(()=>setError('未能复制账号目录。'));}}>{copied?'已复制':'复制'}</Button>
  </div>
  {status&&state?.assetRoot&&<p id={statusId} role="status" className="field-hint">{status}</p>}
  {error?<p role="alert" className="form-error">{error}</p>:null}
 </div>;
}
