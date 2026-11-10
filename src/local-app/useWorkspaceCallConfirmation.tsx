import {useEffect,useMemo,useReducer,useRef} from 'react';
import {createPortal} from 'react-dom';
import {ConfirmationModal,ConfirmationModalPresence} from '../ui/ConfirmationModal';
import {gptImage2EstimateRates,requiresWorkspaceCall,type WorkspaceCallProposal} from '../workspaceCall';

const cancelled=()=>{const error=new Error('');error.name='AbortError';return error;};
type CallRequest={resolve:(value:unknown)=>void;reject:(error:unknown)=>void;data:Record<string,unknown>};
type CallDetails={request:CallRequest;proposal:WorkspaceCallProposal;reservation:string};
type CallState=
 |{phase:'idle'}|{phase:'closed'}
 |{phase:'preparing';request:CallRequest}
 |(CallDetails&{phase:'review'})
 |(CallDetails&{phase:'submitting'})
 |(CallDetails&{phase:'failed';error:string});
function reservationCents({proposal,reservation}:CallDetails){
 const summary=proposal.summary,limits=summary.estimate,amount=Number(reservation)*100;
 return reservation.trim()!==''&&Number.isFinite(amount)&&Math.abs(amount-Math.round(amount))<1e-6&&amount>=(limits?.minimumCents??(summary.kind==='在线音效'?0:1))&&amount<=(limits?.maximumCents??100000)?Math.round(amount):null;
}
/** See ADR-0033: one owner per visit; late replies cannot advance another visit's call. */
export function useWorkspaceCallConfirmation(command:(name:string,data:unknown)=>Promise<unknown>,identity:string,materials:readonly {id:string;material_type:string;storage_path:string}[]=[]){
 const owner=useMemo(()=>({state:{phase:'idle'} as CallState}),[identity]);
 const active=useRef(owner);active.current=owner;
 const [,render]=useReducer((version:number)=>version+1,0);
 const action=useRef(command);action.current=command;
 const rendered=owner.state;
 const owns=(state:CallState)=>active.current===owner&&owner.state===state;
 function transition(state:CallState){owner.state=state;render();}
 useEffect(()=>{
  if(owner.state.phase==='closed'){owner.state={phase:'idle'};render();}
  return()=>{const state=owner.state;owner.state={phase:'closed'};if('request' in state)state.request.reject(cancelled());};
 },[owner]);
 async function prepare(preparing:Extract<CallState,{phase:'preparing'}>,name:string){
  const {data}=preparing.request;
  try{
   const proposal=await action.current('prepareWorkspaceCall',{episodeId:data.episodeId,workspaceId:data.workspaceId,expectedRevision:data.expectedRevision,callCommand:name,callData:data}) as WorkspaceCallProposal;
   if(!owns(preparing))return;
   transition({phase:'review',request:preparing.request,proposal,reservation:proposal.summary.estimate?.manualReservation?'':(proposal.summary.reservationCents/100).toFixed(2)});
  }catch(cause){if(owns(preparing)){transition({phase:'idle'});preparing.request.reject(cause);}}
 }
 async function request(name:string,value:unknown){
  const data=value as Record<string,unknown>;
  if(!requiresWorkspaceCall(name,data))return action.current(name,value);
  if(active.current!==owner||owner.state.phase==='closed')throw cancelled();
  if(owner.state.phase!=='idle')throw Error('已有本次调用等待确认或提交，请先完成当前操作。');
  return new Promise<unknown>((resolve,reject)=>{const preparing={phase:'preparing' as const,request:{resolve,reject,data}};transition(preparing);void prepare(preparing,name);});
 }
 function cancel(){const state=owner.state;if(!owns(rendered)||state.phase!=='review'&&state.phase!=='failed')return;transition({phase:'idle'});state.request.reject(cancelled());}
 async function confirm(){
  const state=owner.state;if(!owns(rendered)||state.phase!=='review')return;
  const cents=reservationCents(state);if(cents===null||new Date(state.proposal.expiresAt).getTime()<=Date.now())return;
  const submitting={...state,phase:'submitting' as const};transition(submitting);
  const {data}=state.request;
  try{
   const value=await action.current('confirmWorkspaceCall',{episodeId:data.episodeId,workspaceId:data.workspaceId,expectedRevision:data.expectedRevision,confirmationId:state.proposal.confirmationId,reservationCents:cents});
   if(owns(submitting)){transition({phase:'idle'});state.request.resolve(value);}
  }catch(cause){if(owns(submitting))transition({...state,phase:'failed',error:cause instanceof Error?cause.message:'提交未完成，请核对任务状态后重试。'});}
 }
 function setReservation(reservation:string){const state=owner.state;if(owns(rendered)&&(state.phase==='review'||state.phase==='failed'))transition({...state,reservation});}
 const state=owner.state,call='proposal' in state?state:null;
 const proposal=call?.proposal,reservation=call?.reservation??'',submitting=state.phase==='submitting',error=state.phase==='failed'?state.error:'';
 const summary=proposal?.summary,limits=summary?.estimate;
 const validReservation=call?reservationCents(call)!==null:false;
 const requestData=call?.request.data;
 const referenceIds=Array.isArray(requestData?.referenceMaterialRevisionIds)
  ?requestData.referenceMaterialRevisionIds
  :Array.isArray(requestData?.visualInputs)
   ?requestData.visualInputs.map(input=>input.materialRevisionId)
   :[requestData?.firstFrameMaterialRevisionId??requestData?.materialRevisionId];
 const imageInputs=summary?.kind==='图片生成'?limits?.imageInputs:undefined;
 const imageCount=(requestData?.settings as {count?:number}|undefined)?.count;
 const rates=gptImage2EstimateRates;
 const dialog=<ConfirmationModalPresence>{proposal&&summary?createPortal(<div className="workspace-call-overlay"><ConfirmationModal title={`确认本次${summary.kind}`} confirmLabel="确认并提交本次调用" pendingLabel="正在提交…" isPending={submitting} confirmDisabled={!!error||!validReservation||new Date(proposal.expiresAt).getTime()<=Date.now()} onCancel={cancel} onConfirm={confirm}>
  {summary.retryOfTaskId&&<p role="alert">上一次请求的结果仍未知，可能已产生费用。确认后将按下方设置提交一次新的请求，供应商可能对两次请求分别计费。</p>}
  <dl className="workspace-call-facts"><div><dt>镜头</dt><dd>{summary.target}</dd></div><div><dt>连接</dt><dd>{summary.connection}</dd></div><div><dt>供应商</dt><dd>{summary.provider}</dd></div><div><dt>模型</dt><dd>{summary.model}</dd></div></dl>
  <p className="workspace-call-parameters">{summary.parameters.join(' · ')}</p>
  {summary.inputs.length>0&&<div className="workspace-call-inputs">
   <strong>本次参考素材</strong>
   <ul>{summary.inputs.map((name,index)=>{
    const material=materials.find(item=>item.id===referenceIds[index]&&item.material_type==='image');
    const episodeId=requestData?.episodeId;
    const src=material?.storage_path&&typeof episodeId==='string'
     ?'/_local-artifact?'+new URLSearchParams({episode:episodeId,path:material.storage_path})
     :undefined;
    return <li key={index} title={name}>{src?<img src={src} alt={name} onError={event=>{event.currentTarget.hidden=true;}}/>:<span>{name}</span>}{src&&<span className="workspace-call-thumbnail-fallback">{name}</span>}</li>;
   })}</ul>
  </div>}
  <div className="workspace-call-content"><strong>本次内容</strong><p>{summary.prompt}</p></div>
  <div className="workspace-call-reservation"><label htmlFor="workspace-call-reservation">本次费用预留（元）</label><input id="workspace-call-reservation" aria-label="本次费用预留（元）" type="number" inputMode="decimal" min={(limits?.minimumCents??0)/100} max={(limits?.maximumCents??100000)/100} step="0.01" value={reservation} disabled={submitting||summary.kind==='在线音效'} onChange={e=>setReservation(e.target.value)}/></div>
  {limits&&(limits.manualReservation?<p className="workspace-call-basis">{limits.basis} <a href={limits.sourceUrl} target="_blank" rel="noreferrer">官方价格说明</a></p>:imageInputs&&imageCount?
   <p className="workspace-call-basis">
    （文字 {imageInputs.textTokens} × ${rates.textInput} + 参考图 {imageInputs.referenceTokens} × ${rates.imageInput} + 输出 {imageCount} × {imageInputs.outputTokensPerImage} × ${rates.imageOutput}）
    ÷ 1,000,000 × {rates.usdCny} × {1+limits.bufferPercent/100} → <strong>¥{(limits.suggestedCents/100).toFixed(2)}</strong>（向上取整到分）
   </p>:
   <>
    <p className="workspace-call-estimate">自动建议 ¥{(limits.suggestedCents/100).toFixed(2)}{limits.maximumCents>0?'，已计入 20% 余量和最低预留限制。':''}</p>
    <details className="workspace-call-basis"><summary>估算依据</summary><p>{limits.basis}</p>{limits.sourceUrl&&<a href={limits.sourceUrl} target="_blank" rel="noreferrer">官方价格说明</a>}</details>
   </>)}
  {!validReservation&&<p role="status">请输入有效金额，范围为 ¥{((limits?.minimumCents??1)/100).toFixed(2)}～¥{((limits?.maximumCents??100000)/100).toFixed(2)}，最多两位小数。</p>}
  <p className="workspace-call-cost-note">费用预留不是精确报价，实际费用以供应商结算为准。此次确认仅适用于本次调用。</p>
  {error&&<p role="alert">{error} 请取消后重新核对本次调用；提交结果未知时请先查看已有任务。</p>}
 </ConfirmationModal></div>,document.querySelector('.app-shell')??document.body):null}</ConfirmationModalPresence>;
 return{request,dialog};
}
