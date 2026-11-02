import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {ConfirmationModal} from '../ui/ConfirmationModal';
import {requiresWorkspaceCall,type WorkspaceCallProposal} from '../workspaceCall';

const cancelled=()=>{const error=new Error('');error.name='AbortError';return error;};
export function useWorkspaceCallConfirmation(command:(name:string,data:unknown)=>Promise<unknown>,identity:string){
 const [proposal,setProposal]=useState<WorkspaceCallProposal|null>(null),[reservation,setReservation]=useState(''),[submitting,setSubmitting]=useState(false),[error,setError]=useState('');
 const action=useRef(command);action.current=command;
 const scope=useRef(identity);scope.current=identity;
 const busy=useRef(false),pending=useRef<{resolve:(value:unknown)=>void;reject:(error:unknown)=>void;data:Record<string,unknown>}|null>(null);
 useEffect(()=>{setProposal(null);setSubmitting(false);setError('');return()=>{pending.current?.reject(cancelled());pending.current=null;busy.current=false;};},[identity]);
 async function request(name:string,value:unknown){
  const data=value as Record<string,unknown>;
  if(!requiresWorkspaceCall(name,data))return action.current(name,value);
  if(busy.current)throw Error('已有本次调用等待确认或提交，请先完成当前操作。');
  busy.current=true;const initial=scope.current;
  try{
   const next=await action.current('prepareWorkspaceCall',{episodeId:data.episodeId,workspaceId:data.workspaceId,expectedRevision:data.expectedRevision,callCommand:name,callData:data}) as WorkspaceCallProposal;
   if(initial!==scope.current)throw cancelled();
   setError('');setReservation((next.summary.reservationCents/100).toFixed(2));setProposal(next);
   return await new Promise<unknown>((resolve,reject)=>{pending.current={resolve,reject,data};});
  }finally{busy.current=false;}
 }
 function cancel(){if(submitting)return;const current=pending.current;pending.current=null;setProposal(null);current?.reject(cancelled());}
 async function confirm(){const current=pending.current;if(!current||!proposal||submitting||!validReservation)return;setSubmitting(true);setError('');
  try{const value=await action.current('confirmWorkspaceCall',{episodeId:current.data.episodeId,workspaceId:current.data.workspaceId,expectedRevision:current.data.expectedRevision,confirmationId:proposal.confirmationId,reservationCents:Math.round(Number(reservation)*100)});pending.current=null;setProposal(null);current.resolve(value);}
  catch(cause){setError(cause instanceof Error?cause.message:'提交未完成，请核对任务状态后重试。');}
  finally{setSubmitting(false);}
 }
 const summary=proposal?.summary,limits=summary?.estimate,amount=Number(reservation)*100;
 const validReservation=reservation.trim()!==''&&Number.isFinite(amount)&&Math.abs(amount-Math.round(amount))<1e-6&&amount>=(limits?.minimumCents??(summary?.kind==='在线音效'?0:1))&&amount<=(limits?.maximumCents??100000);
 const dialog=proposal&&summary?createPortal(<div className="workspace-call-overlay"><ConfirmationModal title={`确认本次${summary.kind}`} confirmLabel="确认并提交本次调用" pendingLabel="正在提交…" isPending={submitting} confirmDisabled={!!error||!validReservation||new Date(proposal.expiresAt).getTime()<=Date.now()} onCancel={cancel} onConfirm={confirm}>
  <dl className="workspace-call-facts"><div><dt>镜头</dt><dd>{summary.target}</dd></div><div><dt>连接</dt><dd>{summary.connection}</dd></div><div><dt>供应商</dt><dd>{summary.provider}</dd></div><div><dt>模型</dt><dd>{summary.model}</dd></div></dl>
  <p className="workspace-call-parameters">{summary.parameters.join(' · ')}</p>
  {summary.inputs.length>0&&<div className="workspace-call-inputs"><strong>本次参考素材</strong><ul>{summary.inputs.map((name,i)=><li key={i}>{name}</li>)}</ul></div>}
  <div className="workspace-call-content"><strong>本次内容</strong><p>{summary.prompt}</p></div>
  <div className="workspace-call-reservation"><label htmlFor="workspace-call-reservation">本次费用预留（元）</label><input id="workspace-call-reservation" aria-label="本次费用预留（元）" type="number" inputMode="decimal" min={(limits?.minimumCents??0)/100} max={(limits?.maximumCents??100000)/100} step="0.01" value={reservation} disabled={submitting||summary.kind==='在线音效'} onChange={e=>setReservation(e.target.value)}/></div>
  {limits&&<><p className="workspace-call-estimate">自动建议 ¥{(limits.suggestedCents/100).toFixed(2)}{limits.maximumCents>0?'，已计入 20% 余量和最低预留限制。':''}</p><details className="workspace-call-basis"><summary>估算依据</summary><p>{limits.basis}</p>{limits.sourceUrl&&<a href={limits.sourceUrl} target="_blank" rel="noreferrer">官方价格说明</a>}</details></>}
  {!validReservation&&<p role="status">请输入有效金额，范围为 ¥{((limits?.minimumCents??1)/100).toFixed(2)}～¥{((limits?.maximumCents??100000)/100).toFixed(2)}，最多两位小数。</p>}
  <p className="workspace-call-cost-note">费用预留不是精确报价，实际费用以供应商结算为准。此次确认仅适用于本次调用。</p>
  {error&&<p role="alert">{error} 请取消后重新核对本次调用；提交结果未知时请先查看已有任务。</p>}
 </ConfirmationModal></div>,document.querySelector('.app-shell')??document.body):null;
 return{request,dialog};
}
