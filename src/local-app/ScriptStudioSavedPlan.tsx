import {studioShotNarrationEnabled,studioShotCaptionText,type ScriptStudioPlan} from '../scriptStudio';
import {uiText} from '../i18n/ui';
/** A saved plan is evidence, never a fresh model approval. */
export function ScriptStudioSavedPlan({plan}:{plan:ScriptStudioPlan}){
 return <details className="script-studio-saved-plan"><summary>{uiText('查看已确认拍法')}</summary><p>{plan.durationSeconds}{uiText(' 秒 · ')}{plan.shots.length}{uiText(' 个镜头 · ')}{uiText(plan.narrationEnabled?'有口播':'无口播')}{' · '}{uiText(plan.captionsEnabled?'有字幕':'无字幕')}</p><p>{plan.summary}</p><ol>{plan.shots.map((shot,index)=><li key={index}><strong>{shot.title}</strong>{' · '}{shot.durationSeconds}{uiText(' 秒')}<p>{shot.visual||shot.videoPrompt||shot.narration}</p>{shot.camera&&<p>{shot.camera}</p>}{studioShotNarrationEnabled(plan,shot)&&shot.narration&&<p>{uiText('口播：')}{shot.narration}</p>}{!!studioShotCaptionText(plan,shot)&&<p>{uiText('字幕：')}{studioShotCaptionText(plan,shot)}</p>}</li>)}</ol>{plan.changes.length>0&&<><strong>{uiText('已审批的内容变化')}</strong><ul>{plan.changes.map((change,index)=><li key={index}>{change}</li>)}</ul></>}</details>;
}
