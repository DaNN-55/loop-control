import {studioShotCaptionText,studioShotNarrationEnabled,type ScriptStudioPlan} from '../scriptStudio';
import {uiText} from '../i18n/ui';

const visualSource={image:'图片',video:'视频',material:'素材',unassigned:'未指定'} as const;

export function ScriptStudioReviewShots({plan,compact=false}:{plan:ScriptStudioPlan;compact?:boolean}){
 if(compact)return <ol className="episode-batch-shot-list">{plan.shots.map((shot,index)=>{
  const narration=studioShotNarrationEnabled(plan,shot)?shot.narration:'';
  const caption=studioShotCaptionText(plan,shot);
  const duration=uiText('{value0} 秒',{value0:shot.durationSeconds});
  const settings=shot.settings.filter(setting=>!['口播启用','旁白启用','字幕'].includes(setting.field));
  return <li key={index}>
   <header><strong>{shot.title}</strong><span>{duration}</span></header>
   {shot.visual&&<p>{shot.visual}</p>}
   {(narration||caption)&&<dl className="episode-batch-shot-copy">
    {narration&&<div><dt>{uiText('口播')}</dt><dd>{narration}</dd></div>}
    {caption&&<div><dt>{uiText('字幕')}</dt><dd>{caption}</dd></div>}
   </dl>}
   <details className="episode-batch-disclosure">
    <summary>{uiText('镜头参数')}</summary>
    <dl>
     <div><dt>{uiText('画面来源')}</dt><dd>{uiText(visualSource[shot.visualSource])}</dd></div>
     {shot.videoPrompt&&<div><dt>{uiText('视频提示词')}</dt><dd>{shot.videoPrompt}</dd></div>}
     {!narration&&<div><dt>{uiText('口播')}</dt><dd>{uiText('关闭')}</dd></div>}
     {!caption&&<div><dt>{uiText('字幕')}</dt><dd>{uiText('关闭')}</dd></div>}
     {shot.camera&&<div><dt>{uiText('运镜')}</dt><dd>{shot.camera}</dd></div>}
     {settings.map(({field,value})=><div key={field}><dt>{uiText(field)}</dt><dd>{uiText(field==='字幕正文模式'&&value==='independent'?'独立字幕':value)}</dd></div>)}
    </dl>
   </details>
  </li>;
 })}</ol>;
 return <ol className="script-studio-review-shots">{plan.shots.map((shot,index)=><li key={index}>
  <strong>{shot.title}</strong>
  <dl>
   <div><dt>{uiText('时长')}</dt><dd>{uiText('{value0} 秒',{value0:shot.durationSeconds})}</dd></div>
   <div><dt>{uiText('画面')}</dt><dd>{shot.visual||'—'}</dd></div>
   <div><dt>{uiText('画面来源')}</dt><dd>{uiText(visualSource[shot.visualSource])}</dd></div>
   {shot.videoPrompt&&<div><dt>{uiText('视频提示词')}</dt><dd>{shot.videoPrompt}</dd></div>}
   <div><dt>{uiText('口播')}</dt><dd>{studioShotNarrationEnabled(plan,shot)?shot.narration:uiText('关闭')}</dd></div>
   <div><dt>{uiText('字幕')}</dt><dd>{studioShotCaptionText(plan,shot)||uiText('关闭')}</dd></div>
   {shot.camera&&<div><dt>{uiText('运镜')}</dt><dd>{shot.camera}</dd></div>}
   {shot.settings.filter(setting=>!['口播启用','旁白启用','字幕'].includes(setting.field)).map(setting=><div key={setting.field}><dt>{uiText(setting.field)}</dt><dd>{uiText(setting.field==='字幕正文模式'&&setting.value==='independent'?'独立字幕':setting.value)}</dd></div>)}
  </dl>
 </li>)}</ol>;
}
