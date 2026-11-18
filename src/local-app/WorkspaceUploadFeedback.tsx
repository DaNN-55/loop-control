import {uiText} from '../i18n/ui';
import {useEffect,useRef} from 'react';
import {FeedbackNotice} from '../ui/FeedbackNotice';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
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
 const initial=useRef<{id:number;duration:number}|null>(null);
 if(notice&&initial.current?.id!==notice.id)initial.current={id:notice.id,duration:Math.max(0,notice.expiresAt-Date.now())};
 const dismiss=useRef(onDismiss);dismiss.current=onDismiss;
 useEffect(()=>{if(notice&&initial.current?.duration===0)dismiss.current(notice.id);},[notice?.id]);
 return notice?<FeedbackNotice message={initial.current?.duration?notice.message:''} identity={notice.id} label="上传提示" closeLabel="关闭上传提示" tone={notice.failed?'warning':'success'} duration={initial.current?.duration??0} onDismiss={()=>onDismiss(notice.id)}>{onView&&<Button size="xs" color="tertiary" onPress={onView}>{uiText('查看')}</Button>}</FeedbackNotice>:null;
}
