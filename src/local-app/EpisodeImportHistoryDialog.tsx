import {useEffect,useId,useRef,useState} from 'react';
import {X} from 'lucide-react';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import {getUiLocale,uiText} from '../i18n/ui';
import {localRequest} from './client';
import type {EpisodeImportHistory} from './episodeBatchImportTypes';
import './episode-batch-import.css';

export function EpisodeImportHistoryDialog({onClose,onViewBatch}:{onClose:()=>void;onViewBatch:(batchId:string)=>void}){
 const heading=useId(),dialog=useRef<HTMLDialogElement>(null);
 const [page,setPage]=useState(1),[request,setRequest]=useState(0);
 const [history,setHistory]=useState<EpisodeImportHistory|null>(null),[failed,setFailed]=useState(false);
 useEffect(()=>{const element=dialog.current;element?.showModal();return()=>element?.close();},[]);
 useEffect(()=>{
  const controller=new AbortController();
  void localRequest('episode-imports?page='+page,{signal:controller.signal})
   .then((result:EpisodeImportHistory)=>setHistory(result))
   .catch(()=>{if(!controller.signal.aborted)setFailed(true);});
  return()=>controller.abort();
 },[page,request]);
 function closeDialog(){
  dialog.current?.close();onClose();
 }
 function goTo(next:number){
  setHistory(null);setFailed(false);
  if(next===page)setRequest(value=>value+1);else setPage(next);
 }
 const loading=!history&&!failed;
 const dates=new Intl.DateTimeFormat(getUiLocale(),{dateStyle:'medium',timeStyle:'short'});
 return <dialog ref={dialog} className="modal-card episode-batch-import episode-batch-import-history-dialog" aria-labelledby={heading} onCancel={event=>{event.preventDefault();closeDialog();}}>
  <div className="episode-batch-form">
   <header>
    <h2 id={heading}>{uiText('导入记录')}</h2>
    <Button size="sm" color="tertiary" type="button" iconLeading={X} aria-label={uiText('关闭导入记录')} onPress={closeDialog}/>
   </header>
   <div className="episode-batch-content">
    {loading&&<p role="status">{uiText('正在读取导入记录…')}</p>}
    {failed&&<div role="alert"><p>{uiText('导入记录读取失败。')}</p><Button size="sm" color="secondary" onPress={()=>goTo(page)}>{uiText('重试')}</Button></div>}
    {history?.batches.length===0&&<p role="status">{uiText('未找到导入记录。')}</p>}
    {!!history?.batches.length&&<ul className="episode-batch-results episode-import-history">
     {history.batches.map(batch=><li key={batch.batchId}>
      <strong>{batch.firstTitle}</strong>
      <span><time dateTime={batch.createdAt}>{dates.format(new Date(batch.createdAt))}</time> · {batch.accountName}</span>
      <span>{uiText('已创建 {created} / {total}',{created:batch.createdCount,total:batch.itemCount})}</span>
      <Button size="sm" color="secondary" onPress={()=>{dialog.current?.close();onViewBatch(batch.batchId);}}>{uiText('查看本批')}</Button>
     </li>)}
    </ul>}
   </div>
   {(page>1||history?.hasMore)&&<div className="modal-actions">
    <Button size="sm" color="secondary" isDisabled={page===1||loading} onPress={()=>goTo(page-1)}>{uiText('上一页')}</Button>
    <Button size="sm" color="secondary" isDisabled={!history?.hasMore} onPress={()=>goTo(page+1)}>{uiText('下一页')}</Button>
   </div>}
  </div>
 </dialog>;
}
