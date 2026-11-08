import {useEffect,useRef} from 'react';
import {createPortal} from 'react-dom';
import {AlertCircle,Check,Upload,X} from 'lucide-react';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import './workspace-upload-feedback.css';

export interface UploadNotice {id:number;message:string;failed:boolean;expiresAt:number}
interface UploadRow {id:number;name:string;status:'pending'|'running'|'succeeded'|'failed';error?:string}
export function WorkspaceUploadFeedback({rows,running,disabled,notice,onDismiss,onRetry}:{rows:UploadRow[];running:boolean;disabled:boolean;notice?:UploadNotice;onDismiss:(id:number)=>void;onRetry:()=>void}){
 const history=useRef<HTMLDetailsElement>(null);
 const unfinished=rows.filter(row=>row.status!=='succeeded');
 useEffect(()=>{if(!notice)return;const timer=setTimeout(()=>onDismiss(notice.id),Math.max(0,notice.expiresAt-Date.now()));return()=>clearTimeout(timer);},[notice,onDismiss]);
 function close(){if(history.current){history.current.open=false;history.current.querySelector('summary')?.focus();}}
 return <>
  {rows.length>0&&<details ref={history} className="workspace-upload-history" onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();close();}}}>
   <summary aria-label="上传记录" title="上传记录"><Upload size={14} aria-hidden="true"/><span>{running?'上传中':unfinished.length?`待处理 ${unfinished.length}`:'上传记录'}</span></summary>
   <section className="workspace-upload-results" aria-label="上传结果" tabIndex={-1}>
    <header><h3>上传记录</h3><Button size="xs" color="tertiary" aria-label="关闭上传记录" iconLeading={X} onPress={close}/></header>
    <div className="workspace-upload-heading"><span role="status">成功 {rows.filter(row=>row.status==='succeeded').length} / {rows.length}</span>{unfinished.length>0&&<Button size="sm" color="secondary" isDisabled={disabled||running} onPress={onRetry}>重试未完成项</Button>}</div>
    <ul>{rows.map(row=><li key={row.id} aria-busy={row.status==='running'}><div><strong>{row.name}</strong><span>{row.status==='succeeded'?'成功':row.status==='failed'?'失败':row.status==='running'?'处理中…':'未处理'}</span>{row.error&&<p>{row.error}</p>}</div></li>)}</ul>
   </section>
  </details>}
  {notice&&notice.expiresAt>Date.now()&&createPortal(<div className="dan-ui product-ui workspace-upload-toast" role="status" aria-label="上传提示">
   {notice.failed?<AlertCircle size={18} className="workspace-upload-toast-error" aria-hidden="true"/>:<Check size={18} className="workspace-upload-toast-success" aria-hidden="true"/>}
   <p>{notice.message}</p>
   {unfinished.length>0&&<Button size="xs" color="tertiary" onPress={()=>{if(history.current){history.current.open=true;history.current.querySelector<HTMLElement>('section')?.focus();}}}>查看</Button>}
   <Button size="xs" color="tertiary" aria-label="关闭上传提示" iconLeading={X} onPress={()=>onDismiss(notice.id)}/>
  </div>,document.body)}
 </>;
}
