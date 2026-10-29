import type {OpenChatCutProject} from './worker/openchatcutProject.js';
export type WorkspaceVoiceMode='source'|'tts'|'none';
export interface WorkspaceVoiceEdit {kind:'voice';workspaceId:string;shotId:string;visualItemIds:string[];mode:WorkspaceVoiceMode;gainDb:number;ambienceGainDb:number|null;sourceItemId?:string;sourceAssetId?:string;narrationAssetId?:string}
export interface WorkspaceSoundEdit {kind:'sound';workspaceId:string;itemId:string;gainDb:number;duckDepthDb:number;remove?:boolean}
export type WorkspaceAudioEdit=WorkspaceVoiceEdit|WorkspaceSoundEdit;
export interface WorkspaceAudioMix {voices:Array<{shotId:string;mode:WorkspaceVoiceMode;gainDb:number;ambienceGainDb:number|null;sourceItemId:string|null;sourceAssetId:string|null;coverage?:'full'|'partial'|'none';startSeconds?:number|null;durationSeconds?:number|null;shotDurationSeconds?:number;sourceStartSeconds?:number|null;sourceLabel?:string|null;alignmentReady?:boolean}>;sounds:Array<{itemId:string;kind:'bgm'|'sfx';gainDb:number;duckDepthDb:number;startSeconds:number;durationSeconds:number}>}
export const workspaceAudioFields:Record<string,string[]>={
 prepareWorkspaceAudio:['episodeId','workspaceId','expectedRevision','preparationId','kind','query','description','durationSeconds','shotId','sourceItemId','anchor','offsetSeconds','materialRevisionId','retry'],
 adoptWorkspaceAudio:['episodeId','workspaceId','expectedRevision','preparationId'],
 mixWorkspaceAudio:['episodeId','workspaceId','expectedRevision','edit'],
 refreshWorkspaceAudio:['episodeId','workspaceId','expectedRevision'],
};
const gain=(db:number)=>10**(db/20);
const db=(value:unknown)=>Math.round(20*Math.log10(Math.max(.000001,Number(value??1)))*100)/100;
function validDb(value:unknown,min=-60,max=12):value is number{return typeof value==='number'&&Number.isFinite(value)&&value>=min&&value<=max;}
function metadata(item:Record<string,unknown>){return item.loopControlAudio as {workspaceId?:string;shotId?:string;kind?:string;sourceItemId?:string;sourceAssetId?:string;anchor?:string;offsetSeconds?:number}|undefined;}
/** Only edits current native nodes. No preparation rows or hidden timeline are consulted. */
export function applyWorkspaceAudioMix(project:OpenChatCutProject,edit:WorkspaceAudioEdit):OpenChatCutProject {
 if(!edit||typeof edit!=='object'||typeof edit.workspaceId!=='string'||!validDb(edit.gainDb))throw Error('混音输入无效。');
 const next=structuredClone(project);
 if(edit.kind==='sound'){
  if(typeof edit.itemId!=='string'||!validDb(edit.duckDepthDb,0,30))throw Error('配乐闪避输入无效。');
  const timeline=next.timelines.find(t=>t.items.some(i=>i.id===edit.itemId)),item=timeline?.items.find(i=>i.id===edit.itemId);
  if(!timeline||!item||item.kind!=='audio'||!['bgm','sfx'].includes(metadata(item)?.kind??''))throw Error('当前配乐或音效实例不存在。');
  if(edit.remove){timeline.items=timeline.items.filter(i=>i.id!==edit.itemId);return next;}
  item.volume=gain(edit.gainDb);const track=timeline.tracks[String(item.track)];
  if(!track)throw Error('声音轨道不存在。');track.role=edit.duckDepthDb>0?'follower':undefined;track.audioRouting={duckDepthDb:-edit.duckDepthDb};return next;
 }
 if(edit.kind!=='voice'||typeof edit.shotId!=='string'||!Array.isArray(edit.visualItemIds)||!edit.visualItemIds.length||edit.visualItemIds.some(x=>typeof x!=='string')||!['source','tts','none'].includes(edit.mode)||edit.ambienceGainDb!==null&&!validDb(edit.ambienceGainDb,-60,-12))throw Error('主声音配置无效；环境声须不高于 -12 dB。');
 const ids=new Set(edit.visualItemIds);for(const t of next.timelines)for(const item of t.items)if((item.loopControlShot as {shotId?:string}|undefined)?.shotId===edit.shotId&&['video','image','text'].includes(String(item.kind)))ids.add(String(item.id));const timelines=next.timelines.filter(t=>t.items.some(i=>ids.has(String(i.id))));
 if(timelines.length!==1)throw Error('镜头画面跨时间线或已删除。');
 const timeline=timelines[0],visuals=timeline.items.filter(i=>ids.has(String(i.id)));
 if(visuals.length!==ids.size||visuals.some(i=>!['video','image','text'].includes(String(i.kind))))throw Error('画面实例已变化，请刷新。');
 const narrationId=`workspace-narration-shot-${edit.shotId}`,sourceId=`workspace-source-shot-${edit.shotId}`,ambienceId=`workspace-ambience-shot-${edit.shotId}`;
 let narration=timeline.items.find(i=>i.id===narrationId);const narrationAsset=next.assets.find(a=>a.id===edit.narrationAssetId&&a.kind==='audio');if(!narration&&edit.mode==='tts'&&narrationAsset){const start=Math.min(...visuals.map(i=>Number(i.startFrame))),end=Math.max(...visuals.map(i=>Number(i.startFrame)+Number(i.durationInFrames)));if(narrationAsset.durationInFrames!==end-start)throw Error('画面范围与完整口播时长不同，请先明确调整。');narration={id:narrationId,kind:'audio',name:edit.shotId+' 口播',src:narrationAsset.src,sourceAssetId:narrationAsset.id,srcInFrame:0,startFrame:start,durationInFrames:end-start};}const oldSource=timeline.items.find(i=>i.id===sourceId),oldAmbience=timeline.items.find(i=>i.id===ambienceId);
 // Muting every visual avoids duplicate source audio from multiple composition slots.
 for(const visual of visuals){visual.volume=0;visual.loopControlAudio={workspaceId:edit.workspaceId,shotId:edit.shotId,voiceMode:edit.mode};}
 const retained=timeline.items.filter(i=>![narrationId,sourceId,ambienceId].includes(String(i.id)));
 if(edit.mode==='tts'){
  if(!narration||narration.kind!=='audio'||!narration.src)throw Error('请先采用本镜的实际口播音轨。');
  narration.volume=gain(edit.gainDb);narration.track='workspace-main-voice';narration.loopControlAudio={workspaceId:edit.workspaceId,shotId:edit.shotId};retained.push(narration);
 }
 if(edit.mode==='source'||edit.mode==='tts'&&edit.ambienceGainDb!==null){
  const prior=edit.mode==='source'?oldSource:oldAmbience,sourceItemId=edit.sourceItemId??metadata(prior??{})?.sourceItemId,source=visuals.find(i=>i.id===sourceItemId),assetId=edit.sourceAssetId??metadata(prior??{})?.sourceAssetId;
  const asset=next.assets.find(a=>a.id===assetId&&a.kind==='audio');
  if(!source||source.kind!=='video'||!asset)throw Error('请先准备并选择本镜的原片音轨。');
  const provenance=(asset as unknown as {loopControlAudioSource?:{videoAssetId?:string;sourceInFrame?:number;sourceFrameRate?:number}}).loopControlAudioSource;if(provenance&&provenance.videoAssetId!==source.sourceAssetId)throw Error('画面来源已变化，请重新提取当前原片声音。');
  const start=Number(source.startFrame),duration=Number(source.durationInFrames),baseSeconds=Number(provenance?.sourceInFrame??0)/Number(provenance?.sourceFrameRate??timeline.fps),srcIn=Number(source.srcInFrame??0)-Math.round(baseSeconds*timeline.fps),rate=Number(source.playbackRate??1);
  if(!(rate>0)||srcIn<0||srcIn+duration*rate>asset.durationInFrames+1)throw Error('原声音轨短于当前画面使用窗口。');
  const id=edit.mode==='source'?sourceId:ambienceId,track=edit.mode==='source'?'workspace-main-voice':'workspace-ambience';
  retained.push({id,kind:'audio',name:edit.shotId+(edit.mode==='source'?' 原声':' 环境声'),track,src:asset.src,sourceAssetId:asset.id,startFrame:start,durationInFrames:duration,srcInFrame:srcIn,playbackRate:rate,volume:gain(edit.mode==='source'?edit.gainDb:edit.ambienceGainDb!),loopControlAudio:{workspaceId:edit.workspaceId,shotId:edit.shotId,sourceItemId:source.id,sourceAssetId:asset.id}});
 }
 timeline.items=retained;
 for(const [id,name,role] of [['workspace-main-voice','主声音','anchor'],['workspace-ambience','环境声',undefined]] as const){if(timeline.items.some(i=>i.track===id)){if(!timeline.trackOrder.includes(id))timeline.trackOrder.push(id);timeline.tracks[id]={kind:'audio',name,role};}}
 return next;
}
export function readWorkspaceAudioMix(project:OpenChatCutProject,shots:Record<string,string[]>):WorkspaceAudioMix {
 const items=project.timelines.flatMap(t=>t.items),voices=Object.keys(shots).map(shotId=>{
  const tts=items.find(i=>i.id===`workspace-narration-shot-${shotId}`),source=items.find(i=>i.id===`workspace-source-shot-${shotId}`),ambience=items.find(i=>i.id===`workspace-ambience-shot-${shotId}`),active=tts??source;
  const route=resolveWorkspaceMainVoice(project,shotId);return{...route.window,shotId,mode:(tts?'tts':source?'source':'none') as WorkspaceVoiceMode,gainDb:active?db(active.volume):0,ambienceGainDb:ambience?db(ambience.volume):null,sourceItemId:metadata(source??ambience??{})?.sourceItemId??null,sourceAssetId:metadata(source??ambience??{})?.sourceAssetId??null};
 });
 const sounds=project.timelines.flatMap(t=>t.items.filter(i=>['bgm','sfx'].includes(metadata(i)?.kind??'')).map(i=>({itemId:String(i.id),kind:metadata(i)!.kind as 'bgm'|'sfx',gainDb:db(i.volume),duckDepthDb:Math.abs(Number(t.tracks[String(i.track)]?.audioRouting?.duckDepthDb??0)),startSeconds:Number(i.startFrame)/t.fps,durationSeconds:Number(i.durationInFrames)/t.fps})));
 return{voices,sounds};
}

/** A stable explicit none marker prevents legacy draft fallback from reviving muted speech. */
export function resolveWorkspaceMainVoice(project:OpenChatCutProject,shotId:string){
 const timeline=project.timelines.find(t=>t.items.some(i=>metadata(i)?.shotId===shotId||String(i.id).startsWith(`shot-${shotId}-`)));
 if(!timeline)return{item:undefined,explicitRoute:false,coverage:'none' as const,alignmentReady:false,window:{coverage:'none' as const}};
 const audible=(i:Record<string,unknown>)=>Number(i.volume??1)>0&&(timeline.tracks[String(i.track)] as {muted?:boolean}|undefined)?.muted!==true;
 const item=timeline.items.find(i=>i.id===`workspace-source-shot-${shotId}`&&audible(i))??timeline.items.find(i=>i.id===`workspace-narration-shot-${shotId}`&&audible(i));
 const visuals=timeline.items.filter(i=>['video','image','text'].includes(String(i.kind))&&((i.loopControlShot as {shotId?:string}|undefined)?.shotId===shotId||String(i.id).startsWith(`shot-${shotId}-`)||metadata(i)?.shotId===shotId));
 const shotStart=Math.min(...visuals.map(i=>Number(i.startFrame))),shotEnd=Math.max(...visuals.map(i=>Number(i.startFrame)+Number(i.durationInFrames))),coverage=!item?'none':Number(item.startFrame)<=shotStart&&Number(item.startFrame)+Number(item.durationInFrames)>=shotEnd?'full':'partial';
 const asset=project.assets.find(a=>a.id===item?.sourceAssetId),source=visuals.find(i=>i.id===metadata(item??{})?.sourceItemId),provenance=(asset as unknown as {loopControlAudioSource?:{sourceInFrame?:number;sourceFrameRate?:number}}|undefined)?.loopControlAudioSource,sourceStart=item?Number(provenance?.sourceInFrame??0)/Number(provenance?.sourceFrameRate??timeline.fps)+Number(item.srcInFrame??0)/timeline.fps:null;
 const alignmentReady=!!item&&coverage==='full'&&Number(item.playbackRate??1)===1&&Number(item.srcInFrame??0)===0&&!!asset&&Math.abs(asset.durationInFrames-Number(item.durationInFrames))<=2;
 return{item,explicitRoute:!!item||timeline.items.some(i=>metadata(i)?.shotId===shotId&&typeof (i.loopControlAudio as {voiceMode?:unknown}).voiceMode==='string'),coverage:coverage as 'full'|'partial'|'none',alignmentReady,window:{coverage:coverage as 'full'|'partial'|'none',startSeconds:item?Number(item.startFrame)/timeline.fps:null,durationSeconds:item?Number(item.durationInFrames)/timeline.fps:null,shotDurationSeconds:Number.isFinite(shotEnd-shotStart)?(shotEnd-shotStart)/timeline.fps:0,sourceStartSeconds:sourceStart,sourceLabel:source?String(source.name??shotId):null,alignmentReady}};
}
