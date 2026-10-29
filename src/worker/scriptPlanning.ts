import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {parseProductionScript,segmentSettings,validateProductionDefaults,type ProductionScript,type ProductionSettings} from '../reviews/productionScript.js';
import type {ArtifactManifest,StoryboardManifest,WorkerTaskPackage} from './contracts.js';
import {writeSafeAssetFile} from './controlledMediaExecutor.js';

export function storyboardFromScript(script:ProductionScript,inputs:ArtifactManifest[],defaults:ProductionSettings={},allowMissingVisuals=false):StoryboardManifest {
 const basis=inputs.map(({relativePath,sha256})=>({relativePath,sha256}));
 if(!inputs.some(i=>i.artifactType==='main_script')||!allowMissingVisuals&&!inputs.some(i=>i.artifactType!=='main_script'))throw Error('v2 分镜需要冻结脚本和已确认视觉材料。');
 let start=0;
 const audioCues:StoryboardManifest['audioCues']=[];
 const shots=script.segments.map(s=>{
  const settings={...defaults,...segmentSettings(script,s)},duration=settings.duration??5;
  if(settings.sfx&&settings.sfx!=='none')audioCues.push({id:'sfx-'+s.id,kind:'sfx',description:settings.sfx,searchQuery:'uploaded audio',startSeconds:start+(settings.sfxStart??0),durationSeconds:settings.sfxDuration??1});
  start+=duration;
  return{id:s.id,scriptSegment:s.narration,durationSeconds:duration,shotType:s.shotType,productionMethod:s.videoPrompt,inputBasis:basis,targetSpec:settings.aspectRatio??'9:16'};
 });
 return{version:'storyboard/v1',shots,audioCues};
}
// Typed scripts use deterministic planning, with all existing review stages intact.
// This path only writes textual planning artifacts; it never generates media.
export async function executeScriptPlanning(task:WorkerTaskPackage):Promise<string|null>{
 if(!['visual_planning','storyboard_planning'].includes(task.capability)||task.storyboardRevision)return null;
 const source=task.assets.inputs.find(i=>i.artifactType==='main_script');if(!source)return null;
 const script=parseProductionScript(await readFile(join(task.assets.allowedRoot,source.relativePath),'utf8'));if(!script)return null;
 const defaults=validateProductionDefaults((task.seriesBaseline?.rules as {production_defaults?:unknown})?.production_defaults??{});
 const storyboard=task.capability==='storyboard_planning'?storyboardFromScript(script,task.assets.inputs,defaults):undefined;
 const text=storyboard?JSON.stringify(storyboard,null,2)+'\n':`# ${script.title} 视觉材料清单\n\n本期使用外部上传素材，不生成图片。\n\n`+task.assets.inputs.filter(i=>i.artifactType!=='main_script').map(i=>`- ${i.relativePath}（${i.sha256}）`).join('\n')+'\n';
 const bytes=Buffer.from(text);await writeSafeAssetFile(task.assets.allowedRoot,task.output.relativePath,bytes);
 return JSON.stringify({version:'worker-result/v1',taskId:task.task.id,status:'completed',
  artifacts:task.output.requiredArtifactTypes.map(artifactType=>({artifactType,relativePath:task.output.relativePath,sha256:createHash('sha256').update(bytes).digest('hex'),fileSize:bytes.length})),
  validation:{passed:true,checks:[{name:'typed_script',passed:true,detail:'v2 固定字段已按原文编排，等待 Owner 审核。'}]},
  actualCostCents:0,blockers:[],retry:{shouldRetry:false,reason:'Deterministic script planning completed.'},nextStep:'Owner reviews the current planning artifact.',
  ...(storyboard?{storyboard}:{visualAssetRequests:[]})});
}
