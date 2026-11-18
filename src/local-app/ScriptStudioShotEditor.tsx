import {useId,useState} from 'react';
import {studioShotNarrationEnabled,studioShotCaptionsEnabled,type ScriptStudioPlan} from '../scriptStudio';
import type {ScriptStudioShotText} from '../scriptStudioEdit';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import {uiText} from '../i18n/ui';
export function ScriptStudioShotEditor({plan,index,busy,error,onSave,onCancel}:{plan:ScriptStudioPlan;index:number;busy:boolean;error:string;onSave:(index:number,fields:Partial<ScriptStudioShotText>)=>Promise<boolean>;onCancel:()=>void}){
 const shot=plan.shots[index],id=useId(),[fields,setFields]=useState<ScriptStudioShotText>(()=>({title:shot.title,visual:shot.visual,videoPrompt:shot.videoPrompt,camera:shot.camera,narration:shot.narration,subtitle:shot.subtitle}));
 const patch=Object.fromEntries(Object.entries(fields).filter(([key,value])=>shot[key as keyof ScriptStudioShotText]!==value)) as Partial<ScriptStudioShotText>;
 function field(key:Exclude<keyof ScriptStudioShotText,'subtitle'>,label:string,max:number){return <label htmlFor={id+key}>{uiText(label)}<textarea id={id+key} name={key} rows={key==='title'?1:2} autoFocus={key==='title'} value={fields[key]} maxLength={max} disabled={busy} onChange={event=>setFields(previous=>({...previous,[key]:event.target.value}))}/></label>;}
 return <form className="script-studio-shot-editor" aria-label={uiText('编辑镜头文字')} onSubmit={event=>{event.preventDefault();if(!busy&&Object.keys(patch).length)void onSave(index,patch).then(saved=>{if(saved)onCancel();});}}>
  {field('title','镜头标题',200)}{field('visual','画面',20000)}{field('camera','运镜',1000)}{field('videoPrompt','视频提示词',1500)}{studioShotNarrationEnabled(plan,shot)&&field('narration','口播',20000)}
  {studioShotCaptionsEnabled(plan,shot)&&<><label className="script-studio-caption-follow"><input type="checkbox" checked={fields.subtitle===null} disabled={busy} onChange={event=>setFields(previous=>({...previous,subtitle:event.target.checked?null:previous.narration}))}/>{uiText('字幕跟随口播')}</label>{fields.subtitle!==null&&<label htmlFor={id+'subtitle'}>{uiText('字幕')}<textarea id={id+'subtitle'} name="subtitle" rows={2} value={fields.subtitle} maxLength={20000} disabled={busy} onChange={event=>setFields(previous=>({...previous,subtitle:event.target.value}))}/></label>}</>}
  {error&&<p role="alert" className="form-error">{uiText(error)}</p>}<div className="script-studio-actions"><Button type="button" size="sm" color="secondary" isDisabled={busy} onPress={onCancel}>{uiText('取消编辑')}</Button><Button type="submit" size="sm" color="primary" isDisabled={busy||!Object.keys(patch).length}>{uiText(busy?'正在保存修改…':'保存镜头修改')}</Button></div>
 </form>;
}
