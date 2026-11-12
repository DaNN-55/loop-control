import {segmentSettings,type ProductionScript,type ProductionSettings} from '../reviews/productionScript.js';
import type {ArtifactManifest,StoryboardManifest} from './contracts.js';

// storyboard/v1 is a legacy Worker protocol. Its required classification is not a workspace setting.
export function storyboardFromScript(script:ProductionScript,inputs:ArtifactManifest[],defaults:ProductionSettings={},allowMissingVisuals=false):StoryboardManifest {
 const basis=inputs.map(({relativePath,sha256})=>({relativePath,sha256}));
 if(!inputs.some(i=>i.artifactType==='main_script')||!allowMissingVisuals&&!inputs.some(i=>i.artifactType!=='main_script'))throw Error('v2 分镜需要冻结脚本和已确认视觉材料。');
 let start=0;
 const audioCues:StoryboardManifest['audioCues']=[];
 const shots=script.segments.map(s=>{
  const settings={...defaults,...segmentSettings(script,s)},duration=settings.duration??5;
  if(settings.sfx&&settings.sfx!=='none')audioCues.push({id:'sfx-'+s.id,kind:'sfx',description:settings.sfx,searchQuery:'uploaded audio',startSeconds:start+(settings.sfxStart??0),durationSeconds:settings.sfxDuration??1});
  start+=duration;
  return{id:s.id,scriptSegment:s.narration,durationSeconds:duration,shotType:s.shotType??'b_roll',productionMethod:s.videoPrompt,inputBasis:basis,targetSpec:settings.aspectRatio??'9:16',...(settings.layout?{layout:settings.layout}:{})};
 });
 return{version:'storyboard/v1',shots,audioCues};
}
