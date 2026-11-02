import {useEffect,useRef} from 'react';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import type {WorkspaceCandidatePreparation} from '../workspaceCandidates';
import './workspace-candidate-impact.css';
export function WorkspaceCandidateImpact({plan,disabled,onConfirm,onCancel}:{plan:WorkspaceCandidatePreparation;disabled:boolean;onConfirm:()=>void;onCancel:()=>void}){
 const region=useRef<HTMLElement>(null),impact=plan.impact;
 useEffect(()=>{const trigger=document.activeElement as HTMLElement|null;region.current?.focus();return()=>{if(trigger?.isConnected)trigger.focus();};},[]);
 return <section ref={region} tabIndex={-1} className="workspace-candidate-impact" aria-label="采用前核对">
  <h4>采用前核对</h4>
  <p className="workspace-candidate-impact-duration">当前 {impact.currentSeconds.toFixed(2)} 秒 → 采用后 {impact.appliedSeconds.toFixed(2)} 秒（{impact.deltaSeconds>0?'+':''}{impact.deltaSeconds.toFixed(2)} 秒）</p>
  <p>素材区间 {impact.sourceSeconds.toFixed(2)} 秒</p>
  <p>{impact.deltaSeconds===0?'片段时长不变，其他片段保持原位。':impact.deltaSeconds>0?'片段延长，其他片段保持原位；新增区间可能与以下片段重叠。':`片段缩短，其他片段保持原位；缩短区间不再${plan.edit.source.kind==='audio'?'播放此口播':'显示此画面'}。`}</p>
  {impact.affectedFragments.length>0?<ul aria-label="受影响片段">{impact.affectedFragments.map(fragment=><li key={fragment.itemId}><strong>{fragment.label}</strong><span>{fragment.kind==='audio'?'音频':fragment.kind==='text'?'文字':fragment.kind==='image'?'图片':'视频'} · {fragment.startSeconds.toFixed(2)}–{fragment.endSeconds.toFixed(2)} 秒 · 变化区间 {fragment.changedStartSeconds.toFixed(2)}–{fragment.changedEndSeconds.toFixed(2)} 秒</span></li>)}</ul>:<p>没有其他片段与变化区间相交。</p>}
  <div><Button size="sm" color="primary" isDisabled={disabled} onPress={onConfirm}>确认采用</Button><Button size="sm" color="secondary" isDisabled={disabled} onPress={onCancel}>取消</Button></div>
 </section>;
}
