import type {WorkerTaskPackageInput} from './contracts.js';
import {validateProductionDefaults,type ProductionSettings} from '../reviews/productionScript.js';
import {productionCompositionSettings} from '../reviews/productionPlan.js';
import {reviewRenderCompositionFromJson,reviewRenderCompositionToJson} from '../reviews/reviewComposition.js';
type Render=NonNullable<WorkerTaskPackageInput['reviewRender']>;
export function applyScriptRenderSettings(render:Render,hint:unknown):Render {
 if(!hint||render.studioProject)return render;
 if(typeof hint!=='object'||Array.isArray(hint))throw Error('脚本渲染设置无效。');
 const input=hint as {settings?:unknown;segments?:Array<{id:string;settings:unknown}>};
 const settings=validateProductionDefaults(input.settings??{});
 const composition=reviewRenderCompositionFromJson({...reviewRenderCompositionToJson(render.adjustments),...productionCompositionSettings(settings)});
 if(!composition)throw Error('脚本合成设置无法应用。');
 if(render.confirmedShots?.length)composition.captionsEnabled=render.confirmedShots.some(s=>s.subtitlesEnabled);
 const segments=new Map((input.segments??[]).map(s=>[s.id,validateProductionDefaults(s.settings)]));
 const members=render.members.map(member=>{
  if(member.audioKind!=='sfx')return member;
  const id=member.memberKey.replace(/^sfx:/,''),s=segments.get(id);
  const shot=render.members.find(m=>m.memberKey==='shot:'+id);
  if(!s||!shot)return member;
  const offset=s.sfxStart??0,duration=s.sfxDuration??member.durationSeconds;
  if(offset+duration>shot.durationSeconds+0.05)throw Error(id+'：音效区间超出实际镜头时长。');
  return{...member,startSeconds:shot.startSeconds+offset,durationSeconds:Math.min(duration,member.durationSeconds)};
 });
 return{...render,members,adjustments:{...composition,reason:render.adjustments.reason}};
}
export function scriptRenderHint(settings:ProductionSettings,segments:Array<{id:string;settings:ProductionSettings}>){return{settings,segments:segments.map(s=>({id:s.id,settings:s.settings}))};}
