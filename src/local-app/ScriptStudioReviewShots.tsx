import {studioShotCaptionText,studioShotNarrationEnabled,type ScriptStudioPlan} from '../scriptStudio';
import {uiText} from '../i18n/ui';

const visualSource={image:'图片',video:'视频',material:'素材',unassigned:'未指定'} as const;

export function ScriptStudioReviewShots({plan}:{plan:ScriptStudioPlan}){
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
