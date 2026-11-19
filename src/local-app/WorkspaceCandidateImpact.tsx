import {uiText} from '../i18n/ui';
import type {WorkspaceCandidatePreparation} from '../workspaceCandidates';
import './workspace-candidate-impact.css';
export function needsCandidateImpactDialog(impact:WorkspaceCandidatePreparation['impact']|undefined){
 return !!impact&&(impact.replacementScope==='shot'||impact.videoSound==='silent'||impact.deltaSeconds!==0||impact.captionRecheck||impact.affectedFragments.length>0);
}
export function WorkspaceCandidateImpactDetails({plan}:{plan:WorkspaceCandidatePreparation}){
 const {impact}=plan;
 return <>
  {impact.replacementScope==='shot'&&<p role="status">{uiText("将整条分镜的 {value0} 个画面片段替换为一个新素材。保留口播、字幕和独立音效；其他分镜保持原位。",{value0:String(impact.replacedItemIds?.length??1)})}</p>}
  {impact.videoSound==='silent'&&<p role="status">{uiText("新视频没有原声；绑定的旧视频原声不会继续播放。")}</p>}
  <p className="workspace-candidate-impact-duration">{uiText("当前 ")}{impact.currentSeconds.toFixed(2)}{uiText(" 秒 → 采用后 ")}{impact.appliedSeconds.toFixed(2)}{uiText(" 秒（")}{impact.deltaSeconds>0?'+':''}{impact.deltaSeconds.toFixed(2)}{uiText(" 秒）")}</p>
  <p>{uiText("素材区间 ")}{impact.sourceSeconds.toFixed(2)}{uiText(" 秒")}</p>
  <p>{impact.deltaSeconds===0?uiText("片段时长不变，其他片段保持原位。"):impact.deltaSeconds>0?uiText("片段延长，其他片段保持原位；新增区间可能与以下片段重叠。"):uiText("片段缩短，其他片段保持原位；缩短区间不再{value0}。",{value0:String(plan.edit.source.kind==='audio'?'播放此口播':'显示此画面')})}</p>
  {impact.captionRecheck&&<p role="status">{uiText("采用后需要重新核对本镜头字幕时序。")}</p>}
  {impact.affectedFragments.length>0?<ul aria-label={uiText("受影响片段")}>{impact.affectedFragments.map(fragment=><li key={fragment.itemId}><strong>{fragment.label}</strong><span>{fragment.kind==='audio'?uiText("音频"):fragment.kind==='text'?uiText("文字"):fragment.kind==='image'?uiText("图片"):uiText("视频")} · {fragment.startSeconds.toFixed(2)}–{fragment.endSeconds.toFixed(2)}{uiText(" 秒 · 变化区间 ")}{fragment.changedStartSeconds.toFixed(2)}–{fragment.changedEndSeconds.toFixed(2)}{uiText(" 秒")}</span></li>)}</ul>:<p>{uiText("没有其他片段与变化区间相交。")}</p>}
 </>;
}
