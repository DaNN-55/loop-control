import {useEffect,useState} from 'react';
import {uiText} from '../i18n/ui';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import {EpisodeBatchDialog,type EpisodeBatchAction,type EpisodeBatchActionContext} from '../workspace/EpisodeBatch';
import {localRequest} from './client';
import {batchPublicationDownloadPath,batchPublicationSelectionLimit,type BatchPublicationPreview} from './batchPublicationDownloadTypes';

function archiveSize(bytes:number){
 const unit=bytes>=1024**3?'GiB':bytes>=1024**2?'MiB':bytes>=1024?'KiB':'B';
 const divisor={B:1,KiB:1024,MiB:1024**2,GiB:1024**3}[unit];
 return `${new Intl.NumberFormat(undefined,{maximumFractionDigits:1}).format(bytes/divisor)} ${unit}`;
}

function BatchPublicationDownloadDialog({selection,onClose}:EpisodeBatchActionContext){
 const [preview,setPreview]=useState<BatchPublicationPreview|null>(null);
 const [error,setError]=useState(''),[loading,setLoading]=useState(true),[attempt,setAttempt]=useState(0);
 const selectionTooLarge=selection.length>batchPublicationSelectionLimit;
 const titles=new Map(selection.map(item=>[item.id,item.title]));
 useEffect(()=>{
  if(selectionTooLarge)return;
  const controller=new AbortController();
  const query=new URLSearchParams();
  for(const item of selection)query.append('episode',item.id);
  setLoading(true);
  setError('');
  setPreview(null);
  void localRequest(batchPublicationDownloadPath+'?'+query,{signal:controller.signal})
   .then(setPreview)
   .catch(cause=>{if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:'发布 ZIP 预览失败。');})
   .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
  return()=>controller.abort();
 },[selection,selectionTooLarge,attempt]);
 const ready=preview?.items.filter(item=>item.status==='ready').length??0;
 return <EpisodeBatchDialog title={uiText('批量下载发布 ZIP')} onClose={onClose} footer={<>
  {!selectionTooLarge&&<Button size="sm" color="secondary" isDisabled={loading} onPress={()=>setAttempt(value=>value+1)}>{uiText('重新预览')}</Button>}
  {preview?.downloadUrl&&<Button size="sm" href={preview.downloadUrl} download="publication-batch.zip">{uiText('下载 ZIP')}</Button>}
 </>}>
  {selectionTooLarge?<p>{uiText(`每次最多预览 ${batchPublicationSelectionLimit} 张生产单，请减少选择数量。`)}</p>:loading?<p>{uiText('正在核验所选成片与发布资料…')}</p>:null}
  {error&&<p role="alert">{uiText(error)}</p>}
  <div aria-live="polite">
   {preview&&<p>{uiText(`可下载 ${ready} 张，跳过 ${preview.items.length-ready} 张`)}{ready>0&&` · ${archiveSize(preview.bytes)}`}</p>}
   {preview?.blockedReason&&<p>{uiText(preview.blockedReason)}</p>}
  </div>
  {preview&&<ul role="list" className="episode-batch-items">
   {preview.items.map(item=><li key={item.episodeId}>
    <strong>{item.title??titles.get(item.episodeId)}</strong>
    <span>{item.status==='ready'?uiText('MP4 可下载'):`${uiText('跳过')} · ${uiText(item.reason??'')}`}</span>
    {item.folder&&item.folder!==item.title&&<span>{uiText('文件夹')} · {item.folder}</span>}
    {item.status==='ready'&&<span>{[item.cover&&uiText('含封面'),item.text&&uiText('含发布文案'),...(item.warnings??[]).map(warning=>uiText(warning))].filter(Boolean).join(' · ')}</span>}
   </li>)}
  </ul>}
 </EpisodeBatchDialog>;
}

export const publicationDownloadBatchAction:EpisodeBatchAction={
 id:'publication-download',label:'批量下载发布 ZIP',render:context=><BatchPublicationDownloadDialog {...context}/>,
};
