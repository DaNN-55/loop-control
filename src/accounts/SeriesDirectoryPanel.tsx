import {uiText} from '../i18n/ui';
import {useEffect,useState} from 'react';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import {localCommand} from '../local-app/client';
import type {StorageContainer} from '../local-app/seriesDirectories';
/** Read and open are identity-only; initialization is always an explicit Owner action. */
export function SeriesDirectoryPanel({accountId,seriesId,disabled=false}:{accountId:string;seriesId?:string;disabled?:boolean}){
 const [state,setState]=useState<StorageContainer|null>(null),[pending,setPending]=useState(false),[error,setError]=useState(''),[copied,setCopied]=useState(false);
 const data=seriesId?{seriesId}:{accountId},label=seriesId?uiText("系列目录"):uiText("未分系列目录");
 useEffect(()=>{let current=true;setState(null);setError('');setCopied(false);void localCommand<StorageContainer>(seriesId?'readSeriesDirectory':'readUnassignedDirectory',seriesId?{seriesId}:{accountId},undefined,'account-commands').then(value=>{if(current)setState(value);}).catch(cause=>{if(current)setError(cause instanceof Error?cause.message:uiText("目录暂不可用。"));});return()=>{current=false;};},[accountId,seriesId]);
 async function action(create=false){if(pending)return;setPending(true);setError('');try{await localCommand(create?'createUnassignedDirectory':seriesId?'openSeriesDirectory':'openUnassignedDirectory',data,undefined,'account-commands');setState(await localCommand<StorageContainer>(seriesId?'readSeriesDirectory':'readUnassignedDirectory',data,undefined,'account-commands'));}catch(cause){setError(cause instanceof Error?cause.message:uiText("目录操作失败。"));}finally{setPending(false);}}
 return <div className="account-directory-metadata" aria-label={label}>
  <div className="account-directory-row"><span className="field-label">{label}</span><span className="account-directory-path" title={state?.directoryPath??''}>{state?.directoryPath??(state?.status==='legacy-unmanaged'?uiText("尚未纳管"):state?uiText("尚未创建"):uiText("正在读取…"))}</span><Button size="xs" color="secondary" type="button" aria-label={uiText("打开{value1}",{value1:label})} isDisabled={pending||state?.status!=='ready'} onClick={()=>void action()}>{uiText("打开")}</Button><Button size="xs" color="tertiary" type="button" aria-label={uiText("复制{value1}路径",{value1:label})} isDisabled={!state?.directoryPath} onClick={()=>{void navigator.clipboard.writeText(state!.directoryPath!).then(()=>setCopied(true)).catch(()=>setError(uiText("未能复制路径，请重试。")));}}>{copied?uiText("已复制"):uiText("复制")}</Button></div>
  {state?.reason?<p role="status" className="muted-copy">{state.reason}</p>:null}
  {!seriesId&&state?.status==='unset'?<Button size="xs" color="secondary" type="button" isDisabled={disabled||pending} onClick={()=>void action(true)}>{pending?uiText("创建中…"):uiText("创建未分系列目录")}</Button>:null}
  {error?<p role="alert" className="form-error">{uiText(error)}</p>:null}
 </div>;
}
