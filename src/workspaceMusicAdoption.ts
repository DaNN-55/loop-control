import type {OpenChatCutProject} from './worker/openchatcutProject.js';
import {readWorkspaceShots} from './workspaceShots.js';
import {workspaceRenderPreferences} from './workspaceRenderPreferences.js';
import {bgmDuckingDepthDb} from './shotAudioMix.js';

interface MusicSource {assetId:string;path:string;sha256:string;durationSeconds:number;description:string}
/** Install into the caller's private copy. Existing native mix and source windows win. */
export function installWorkspaceMusic(project:OpenChatCutProject,workspaceId:string,preparationId:string,source:MusicSource){
 const timeline=project.timelines.find(t=>t.id===project.activeTimelineId)!;
 const previous=timeline.items.filter(i=>{const meta=i.loopControlAudio as {workspaceId?:string;kind?:string}|undefined;return i.kind==='audio'&&meta?.workspaceId===workspaceId&&meta.kind==='bgm';});
 const shots=readWorkspaceShots(project).filter(s=>s.timelineId===timeline.id).sort((a,b)=>a.startFrame-b.startFrame);
 const preferences=shots.map(s=>{const p=workspaceRenderPreferences(project,s.id);return{gainDb:p?.bgmGainDb??-12,duckDepthDb:bgmDuckingDepthDb[p?.bgmDucking??'medium']};});
 const different=new Set(preferences.map(p=>`${p.gainDb}:${p.duckDepthDb}`)).size>1;
 const targets:OpenChatCutProject['timelines'][number]['items']=previous.length?previous:different?shots.map((shot,index)=>({id:index?`workspace-bgm-${shot.id}`:'workspace-bgm',track:index?`workspace-bgm-${shot.id}`:'workspace-bgm',kind:'audio',name:`${source.description} · ${index+1}`,startFrame:shot.startFrame,durationInFrames:shot.durationInFrames,srcInFrame:shot.startFrame,volume:10**(preferences[index].gainDb/20),loopControlAudio:{workspaceId,kind:'bgm',shotId:shot.id,anchor:'absolute',offsetSeconds:shot.startFrame/timeline.fps}})):[{id:'workspace-bgm',track:'workspace-bgm',kind:'audio',name:source.description,startFrame:0,durationInFrames:Math.max(...timeline.items.filter(i=>['video','image','text','sequence'].includes(String(i.kind))).map(i=>Number(i.startFrame)+Number(i.durationInFrames)),1),srcInFrame:0,volume:10**((preferences[0]?.gainDb??-12)/20),loopControlAudio:{workspaceId,kind:'bgm',anchor:'absolute'}}];
 if(!previous.length&&different&&shots.some((s,i)=>i>0&&s.startFrame<shots[i-1].startFrame+shots[i-1].durationInFrames))throw Error('镜头窗口重叠，请在当前剪辑中明确配乐使用范围。');
 const items=targets.map(item=>{
  const start=Number(item.srcInFrame??0),frames=Number(item.durationInFrames),rate=Number(item.playbackRate??1);
  if(!Number.isFinite(start)||start<0||!Number.isSafeInteger(frames)||frames<1||!Number.isFinite(rate)||rate<=0||source.durationSeconds+.05<(start+frames*rate)/timeline.fps)throw Error('音频短于当前整期或配乐窗口，请重新准备；不会自动循环。');
  const next:Record<string,unknown>={...item,src:source.path,sourceAssetId:source.assetId,sourceContentHash:source.sha256,loopControlAudio:{...((item.loopControlAudio as object)??{}),preparationId}};
  if(item.sourceAssetId!==source.assetId){delete next.sourceRevision;delete next.sourceFilename;}
  return next;
 });
 for(const [index,item]of items.entries()){
  const track=String(item.track);
  if(!timeline.tracks[track])timeline.tracks[track]={kind:'audio',name:different?'镜头配乐':'整期配乐',role:'follower',audioRouting:{duckDepthDb:preferences[index]?.duckDepthDb??preferences[0]?.duckDepthDb??-10}};
  if(!timeline.trackOrder.includes(track))timeline.trackOrder.push(track);
 }
 const old=new Set(previous.map(i=>i.id));timeline.items=timeline.items.filter(i=>!old.has(i.id));timeline.items.push(...items);
 return String(items[0].id);
}
