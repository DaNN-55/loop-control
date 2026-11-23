import {useEffect,useId,useRef} from 'react';
import type {StoryboardBatchReview} from '../storyboardBatch';
import {uiText} from '../i18n/ui';
import {Button} from '../ui/dan-ui/components/base/buttons/button';

export function StoryboardBatchReviewDialog({review,labels,selected,busy,error,unknown,onToggle,onClose,onConfirm}:{review:StoryboardBatchReview;labels:ReadonlyMap<string,string>;selected:ReadonlySet<string>;busy:boolean;error:string;unknown:boolean;onToggle:(id:string)=>void;onClose:()=>void;onConfirm:()=>void}){
 const ref=useRef<HTMLDialogElement>(null),cancel=useRef<HTMLButtonElement>(null),titleId=useId();
 useEffect(()=>{
  const dialog=ref.current;
  if(!dialog)return;
  dialog.showModal();
  cancel.current?.focus();
  return ()=>{if(dialog.open)dialog.close();};
 },[]);
 const count=review.items.filter(item=>item.state==='ready'&&selected.has(item.shotId)).length;
 const cents=review.items.reduce((sum,item)=>sum+(item.state==='ready'&&selected.has(item.shotId)?item.summary?.reservationCents??0:0),0);
 return <dialog ref={ref} aria-labelledby={titleId} className="storyboard-batch-dialog" onClose={event=>{if(!event.currentTarget.open)onClose();}} onCancel={event=>{if(busy)event.preventDefault();}}>
  <header><h3 id={titleId}>{uiText(review.kind==='speech'?'核对批量口播':'核对批量视频')}</h3></header>
  <div className="storyboard-batch-dialog-items">
   {review.changed&&<p role="status">{uiText('待提交内容已变化，本组未入队。请重新核对。')}</p>}
   {review.items.map(item=>{
    const label=labels.get(item.shotId)??item.shotId;
    return <section key={item.shotId} className="storyboard-batch-review-item" aria-label={label}>
     <label><input type="checkbox" checked={item.state==='ready'&&selected.has(item.shotId)} disabled={busy||unknown||item.state==='skipped'} onChange={()=>onToggle(item.shotId)}/><strong>{label}</strong></label>
     {item.text&&<><span className="storyboard-batch-text-source">{uiText(item.source==='draft'?'来自草稿':'来自已确认分镜')}</span><p>{item.text}</p></>}
     {item.summary?<p className="storyboard-batch-parameters">{[item.summary.connection,item.summary.model,...item.summary.parameters,`¥${(item.summary.reservationCents/100).toFixed(2)}`].join(' · ')}</p>:item.characters!==undefined&&<p className="storyboard-batch-parameters">{uiText('{count} 字',{count:item.characters})}</p>}
     {!!item.summary?.inputs.length&&<p className="storyboard-batch-parameters">{item.summary.inputs.join(' · ')}</p>}
     {item.reason&&<p>{uiText(item.reason)}</p>}
     {item.change&&item.change!==item.reason&&<p role="status">{uiText(item.change)}</p>}
    </section>;
   })}
  </div>
  <footer>
   <p role="status">{uiText('提交 {count} 个镜头 · 跳过 {skipped} 个 · 费用预留 ¥{amount}',{count,skipped:review.items.length-count,amount:(cents/100).toFixed(2)})}</p>
   {error&&<p role="alert">{error}</p>}
   <div className="storyboard-batch-actions">
    <form method="dialog"><Button ref={cancel} size="sm" color="secondary" type="submit" autoFocus isDisabled={busy}>{uiText('取消')}</Button></form>
    <Button size="sm" color="primary" isDisabled={busy||!count} onPress={onConfirm}>{uiText(busy?'正在核对…':unknown?'核对原回执':'确认并提交')}</Button>
   </div>
  </footer>
 </dialog>;
}
