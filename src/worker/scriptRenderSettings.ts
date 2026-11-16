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
 if([settings,...(input.segments??[]).map(s=>validateProductionDefaults(s.settings))].some(s=>s.scale!==undefined||s.animation!==undefined||s.transition!==undefined&&!['cut','fade','studio'].includes(s.transition)))throw Error('缩放、动画及原生转场请在当前制作工作区中应用，旧审核渲染不支持这些设置。');
 const composition=reviewRenderCompositionFromJson({...reviewRenderCompositionToJson(render.adjustments),...productionCompositionSettings(settings)});
 if(!composition)throw Error('脚本合成设置无法应用。');
 if(render.confirmedShots?.length)composition.captionsEnabled=render.confirmedShots.some(s=>s.subtitlesEnabled);
 const segments=new Map((input.segments??[]).map(s=>[s.id,validateProductionDefaults(s.settings)]));
 const members=render.members.map(member=>{
  if(member.audioKind!=='sfx')return member;
  const id=member.memberKey.replace(/^sfx:/,''),s={...settings,...segments.get(id)};
  const shot=render.members.find(m=>m.memberKey==='shot:'+id);
  if(!shot||s.sfxStart===undefined&&s.sfxDuration===undefined)return member;
  const offset=s.sfxStart??member.startSeconds-shot.startSeconds,duration=s.sfxDuration??member.durationSeconds;
  if(offset+duration>shot.durationSeconds+0.05)throw Error(id+'：音效区间超出实际镜头时长。');
  if(duration>member.durationSeconds+.05)throw Error(id+'：音效源短于指定时长，不会自动伸缩。');
  return{...member,startSeconds:shot.startSeconds+offset,durationSeconds:duration};
 });
 return{...render,members,adjustments:{...composition,reason:render.adjustments.reason}};
}
export function scriptRenderHint(settings:ProductionSettings,segments:Array<{id:string;settings:ProductionSettings}>){return{settings,segments:segments.map(s=>({id:s.id,settings:s.settings}))};}
