import {useId,useState} from 'react';
import {studioShotNarrationEnabled,studioShotCaptionText,type ScriptStudioMode,type ScriptStudioResult} from '../scriptStudio';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import {uiText} from '../i18n/ui';

export function ScriptStudioProposal({result,mode,busy,disabled,onAdopt,onOriginal,onSend}:{result:ScriptStudioResult;mode:ScriptStudioMode;busy:boolean;disabled:boolean;onAdopt:()=>void;onOriginal:()=>void;onSend:(mode:ScriptStudioMode,instruction:string,previousRequestId?:string)=>void}){
 const [editing,setEditing]=useState(false),[instruction,setInstruction]=useState(''),id=useId(),plan=result.plan;
 if(!plan)return null;
 let elapsed=0;
 return <section className="script-studio-proposal" aria-label={uiText('推荐拍法')} aria-busy={busy}>
  <header><h4>{uiText(mode==='adapt'?'改编拍法':'推荐拍法')}</h4><span>{uiText(plan.canProceed?'待审批':'需要补充')}</span></header>
  <p className="script-studio-summary">{plan.durationSeconds}{uiText(' 秒 · ')}{plan.shots.length}{uiText(' 个镜头 · ')}{uiText(plan.narrationEnabled?'有口播':'无口播')}{' · '}{uiText(plan.captionsEnabled?'有字幕':'无字幕')}{uiText(' · 需准备 ')}{plan.shots.length}{uiText(' 份画面')}</p>
  <p className="script-studio-source-use">{plan.sourceUse}</p><p>{plan.summary}</p>
  {plan.changes.length>0&&<div className="script-studio-changes"><strong>{uiText('内容变化')}</strong><ul>{plan.changes.map((change,index)=><li key={index}>{change}</li>)}</ul></div>}
  {plan.warnings.length>0&&<ul className="script-studio-warnings" aria-label={uiText('拍法提醒')}>{plan.warnings.map((warning,index)=><li key={index}>{warning}</li>)}</ul>}
  <ol className="script-studio-shots">{plan.shots.map((shot,index)=>{const start=elapsed;elapsed=Math.round((elapsed+shot.durationSeconds)*100)/100;return <li key={index}><span>{String(index+1).padStart(2,'0')}{' · '}{start}–{elapsed}{uiText(' 秒')}</span><div><h5>{shot.title}</h5><p>{shot.visual||shot.videoPrompt||shot.narration}</p><p className="script-studio-shot-detail">{shot.camera}{shot.settings.filter(s=>['转场','动画'].includes(s.field)).map(s=>' · '+s.field+'：'+s.value).join('')}</p>{studioShotNarrationEnabled(plan,shot)&&shot.narration&&<p className="script-studio-shot-detail">{uiText('口播：')}{shot.narration}</p>}{!!studioShotCaptionText(plan,shot)&&<p className="script-studio-shot-detail">{uiText('字幕：')}{studioShotCaptionText(plan,shot)}</p>}</div></li>;})}</ol>
  <div className="script-studio-actions"><Button type="button" size="sm" color="primary" isDisabled={disabled||busy||!plan.canProceed} onPress={onAdopt}>{uiText('采用并继续')}</Button><Button type="button" size="sm" color="secondary" isDisabled={disabled||busy} aria-expanded={editing} aria-controls={id} onPress={()=>setEditing(value=>!value)}>{uiText('提出修改')}</Button><Button type="button" size="sm" color="tertiary" isDisabled={disabled||busy} onPress={onOriginal}>{uiText('按原方案继续')}</Button></div>
  {editing&&<form id={id} className="script-studio-modification" onSubmit={event=>{event.preventDefault();if(instruction.trim()&&!busy&&!disabled)onSend(mode,instruction.trim(),result.requestId);}}><label htmlFor={id+'-input'}>{uiText('想怎样调整？')}</label><textarea id={id+'-input'} name="instruction" value={instruction} maxLength={2000} disabled={disabled||busy} onChange={event=>setInstruction(event.target.value)} placeholder={uiText('例如：保留单镜头，或加旁白。')}/><div className="script-studio-actions"><Button type="button" size="sm" color="tertiary" isDisabled={disabled||busy} onPress={()=>setInstruction('保留单镜头')}>{uiText('保留单镜头')}</Button><Button type="button" size="sm" color="tertiary" isDisabled={disabled||busy} onPress={()=>setInstruction('加旁白，逐字使用原文，不改写内容。')}>{uiText('加旁白')}</Button><Button type="submit" size="sm" color="secondary" isDisabled={disabled||busy||!instruction.trim()}>{uiText('更新方案')}</Button></div></form>}
  <details className="script-studio-adapt"><summary>{uiText('大胆改编')}</summary><p>{uiText('允许提出新的情节。原文保留，总时长不变，改编结果仍需审批。')}</p><Button type="button" size="sm" color="secondary" isDisabled={disabled||busy} onPress={()=>onSend('adapt','',undefined)}>{uiText('生成改编方案')}</Button></details>
 </section>;
}
