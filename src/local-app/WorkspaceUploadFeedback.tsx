import {uiText} from '../i18n/ui';
import {useEffect,useRef} from 'react';
import {createPortal} from 'react-dom';
import {AlertCircle,Check,X} from 'lucide-react';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import {SurfacePresence,useSurfacePresence} from '../ui/SurfacePresence';
import './workspace-upload-feedback.css';

export interface UploadNotice {id:number;message:string;failed:boolean;expiresAt:number}
interface UploadRow {id:number;name:string;status:'pending'|'running'|'succeeded'|'failed';error?:string}
export function WorkspaceUploadFeedback({rows,running,disabled,notice,onDismiss,onRetry,onAbandon}:{rows:UploadRow[];running:boolean;disabled:boolean;notice?:UploadNotice;onDismiss:(id:number)=>void;onRetry:()=>void;onAbandon?:()=>void}){
 const results=useRef<HTMLElement>(null);
 const unfinished=rows.filter(row=>row.status!=='succeeded');
 return <>
  {unfinished.length>0&&<section ref={results} className="workspace-upload-results" aria-label={uiText("上传结果")} tabIndex={-1}>
   <header><span role="status">{running?uiText("正在上传"):uiText("{value0} 项上传未完成",{value0:String(unfinished.length)})}</span><div className="workspace-upload-actions">{onAbandon&&<Button size="sm" color="tertiary" isDisabled={disabled||running} onPress={onAbandon}>{uiText("放弃未完成项")}</Button>}<Button size="sm" color="secondary" isDisabled={disabled||running} onPress={onRetry}>{uiText("重试未完成项")}</Button></div></header>
   <ul>{unfinished.map(row=><li key={row.id} aria-busy={row.status==='running'}><div><strong>{row.name}</strong><span>{row.status==='failed'?uiText("失败"):row.status==='running'?uiText("处理中…"):uiText("未处理")}</span>{row.error&&<p>{uiText(row.error)}</p>}</div></li>)}</ul>
  </section>}
  <WorkspaceUploadToast notice={notice} onDismiss={onDismiss} onView={unfinished.length?()=>{results.current?.focus();results.current?.scrollIntoView?.({block:'nearest'});}:undefined}/>
 </>;
}

export function WorkspaceUploadToast({notice,onDismiss,onView}:{notice?:UploadNotice;onDismiss:(id:number)=>void;onView?:()=>void}){
 useEffect(()=>{if(!notice)return;const timer=setTimeout(()=>onDismiss(notice.id),Math.max(0,notice.expiresAt-Date.now()));return()=>clearTimeout(timer);},[notice,onDismiss]);
 return createPortal(<SurfacePresence kind="toast">{notice&&notice.expiresAt>Date.now()?<UploadToast notice={notice} onDismiss={onDismiss} onView={onView}/>:null}</SurfacePresence>,document.body);
}

function UploadToast({notice,onDismiss,onView}:{notice:UploadNotice;onDismiss:(id:number)=>void;onView?:()=>void}){
 const presence=useSurfacePresence(),present=presence?.present??true;
 return <div ref={presence?.ref} className="dan-ui product-ui workspace-upload-toast" role="status" aria-label={uiText("上传提示")} inert={!present} aria-hidden={!present||undefined} style={!present?{pointerEvents:'none'}:undefined}>
   {notice.failed?<AlertCircle size={18} className="workspace-upload-toast-error" aria-hidden="true"/>:<Check size={18} className="workspace-upload-toast-success" aria-hidden="true"/>}
   <p>{uiText(notice.message)}</p>
   {onView&&<Button size="xs" color="tertiary" onPress={onView}>{uiText("查看")}</Button>}
   <Button size="xs" color="tertiary" aria-label={uiText("关闭上传提示")} iconLeading={X} onPress={()=>onDismiss(notice.id)}/>
  </div>;
}
