import type {OpenChatCutProject,OpenChatCutTimeline} from '../worker/openchatcutProject.js';
import {openChatCutCaptionGeometry} from '../worker/openchatcutProject.js';
import type {WorkerTaskPackage} from '../worker/contracts.js';
import type {WorkspaceClip} from '../productionWorkspace.js';
import {readWorkspaceCaption} from '../workspaceCaptions.js';
import {readWorkspaceShots,workspaceShotIdentity} from '../workspaceShots.js';
import {readWorkspaceAudioMix,resolveWorkspaceMainVoice} from '../workspaceAudio.js';

type Render=NonNullable<WorkerTaskPackage['reviewRender']>;
type Item=OpenChatCutTimeline['items'][number];

/** Add current editor identities to a contract-built copy; never rebuild timing or media. */
export function adaptLegacyWorkspaceMetadata(project:OpenChatCutProject,bindings:WorkspaceClip[],render:Render):void{
 const next=structuredClone(project),workspaceId=next.loopControl?.inputFingerprint;
 if(!workspaceId)throw Error('旧工程缺少工作区身份。');
 const shots=readWorkspaceShots(next),items=next.timelines.flatMap(t=>t.items),audio=new Set<Item>();
 if(new Set(items.map(i=>String(i.id))).size!==items.length)throw Error('旧工程片段标识重复，无法无损接入。');
 if(shots.length!==render.confirmedShots.length||bindings.some(b=>!items.some(i=>i.id===b.itemId&&workspaceShotIdentity(i)?.shotId===b.shotId)))throw Error('旧工程镜头绑定与冻结确认不一致。');
 for(const frozen of render.confirmedShots){
  const shot=shots.find(s=>s.id===frozen.shotId),confirmed=frozen.preparationContract;
  if(!shot||!confirmed||confirmed.version!=='shot-preparation/v1')throw Error(`镜头 ${frozen.shotId} 缺少可映射的冻结契约。`);
  const timeline=next.timelines.find(t=>t.id===shot.timelineId)!,visuals=shot.itemIds.map(id=>timeline.items.find(i=>i.id===id)!);
  const bound=bindings.filter(b=>b.shotId===shot.id);
  if(bound.length!==visuals.length||visuals.some(i=>!bound.some(b=>b.itemId===i.id)))throw Error(`镜头 ${shot.id} 的画面绑定不完整。`);
  for(const visual of visuals)visual.loopControlAudio={workspaceId,shotId:shot.id,voiceMode:frozen.audioMode};

  const source=render.members.find(m=>m.memberKind==='shot_media'&&m.memberKey===`shot:${shot.id}`);
  const sourceCount=confirmed.composition.layout==='full'?(source?.clipSegments?.length??1):1;
  const sourceIds=Array.from({length:sourceCount},(_,i)=>sourceCount===1?`main-source-${shot.id}`:`main-source-${shot.id}-${i+1}`);
  const sourceMembers=render.members.filter(m=>m.memberKind==='narration'&&m.memberKey===`narration:${shot.id}`);
  const voices=timeline.items.filter(i=>i.kind==='audio'&&(i.id===`main-tts-narration-${shot.id}`||sourceIds.includes(String(i.id))));
  if(frozen.audioMode==='none'){
   if(voices.length)throw Error(`镜头 ${shot.id} 的冻结静音与旧音轨不一致。`);
  }else{
   if(voices.length!==1)throw Error(`镜头 ${shot.id} 的主声音包含多个原声区间或缺失，当前路由无法无损接入。`);
   const voice=voices[0];
   if(!source||voice.src!==(frozen.audioMode==='tts'?sourceMembers[0]?.relativePath:source.relativePath))throw Error(`镜头 ${shot.id} 的主声音来源与冻结契约不一致。`);
   const oldId=String(voice.id),newId=`workspace-${frozen.audioMode==='tts'?'narration':'source'}-shot-${shot.id}`;
   if(items.some(i=>i!==voice&&i.id===newId))throw Error(`镜头 ${shot.id} 的主声音标识冲突。`);
   voice.id=newId;replaceItemReferences(next,oldId,newId);
   voice.loopControlAudio={workspaceId,shotId:shot.id,voiceMode:frozen.audioMode,origin:'legacy-frozen',text:confirmed.ttsText??frozen.subtitleText};
   if(frozen.audioMode==='tts'){
    if(sourceMembers.length!==1||!frozen.audioTrackId||sourceMembers[0].audioTrackId!==frozen.audioTrackId)throw Error(`镜头 ${shot.id} 缺少唯一冻结口播音轨。`);
    const member=sourceMembers[0],asset=next.assets.find(a=>a.src===member.relativePath&&a.kind==='audio');
    if(!asset)throw Error(`镜头 ${shot.id} 的口播素材未登记。`);
    const assetId=`audio-track-${frozen.audioTrackId}`;
    if(next.assets.some(a=>a!==asset&&a.id===assetId))throw Error(`镜头 ${shot.id} 的口播素材身份冲突。`);
    if(asset.id.startsWith('audio-track-')&&asset.id!==assetId)throw Error('同一口播素材对应多个音轨身份，无法无损映射。');
    const oldAsset=asset.id;asset.id=assetId;replaceAssetReferences(next,oldAsset,assetId);voice.sourceAssetId=assetId;voice.sourceContentHash=member.sha256;
   }else{
    const visual=visuals.find(i=>i.src===voice.src&&Number(i.srcInFrame??0)===Number(voice.srcInFrame??0));
    const original=next.assets.find(a=>a.id===visual?.sourceAssetId);
    if(!visual||!original)throw Error(`镜头 ${shot.id} 的原声无法映射到实际画面区间。`);
    const assetId=`legacy-source-audio-${shot.id}`;
    if(next.assets.some(a=>a.id===assetId))throw Error(`镜头 ${shot.id} 的原声素材身份冲突。`);
    const alias={...original,id:assetId,kind:'audio' as const,loopControlAudioSource:{videoAssetId:original.id,sourceInFrame:0,sourceFrameRate:timeline.fps}};
    next.assets.push(alias);voice.sourceAssetId=assetId;voice.sourceContentHash=source.sha256;
    voice.loopControlAudio={workspaceId,shotId:shot.id,voiceMode:'source',sourceItemId:visual.id,sourceAssetId:assetId};
   }
   audio.add(voice);
  }

  const contract=confirmed.captions,enabled=render.adjustments.captionsEnabled&&frozen.subtitlesEnabled&&contract.enabled;
  const oldLane=`lane-${shot.id}`,newLane=`workspace-caption-shot-${shot.id}`;
  const lanes=Object.values(timeline.tracks).flatMap(track=>(track.captions?.sourceEntries??[]).filter(l=>l.id===oldLane).map(lane=>({track,lane})));
  if(lanes.length>1||enabled&&lanes.length!==1)throw Error(`镜头 ${shot.id} 的冻结字幕无法唯一映射。`);
  let entry=lanes[0];
  if(!entry){
   const track=Object.values(timeline.tracks).find(t=>t.kind==='caption'&&t.captions);
   if(!track?.captions)throw Error(`镜头 ${shot.id} 缺少旧字幕轨。`);
   const geometry=openChatCutCaptionGeometry(contract.spatial),slotId=`caption-slot-${shot.id}`;
   const lane={id:oldLane,itemId:`manual:${oldLane}`,label:`${shot.id} 字幕`,slotId,widthRatio:geometry.width,heightRatio:geometry.height,maxCharactersPerLine:contract.spatial.maxCharactersPerLine,words:contract.cues.map(cue=>({id:cue.id,text:cue.text,start:shot.startFrame*1000/timeline.fps+cue.startMs,end:shot.startFrame*1000/timeline.fps+cue.endMs})),visible:false};
   track.captions.sourceEntries.push(lane);track.captions.layoutPolicy.slots.push({id:slotId,anchor:contract.spatial.anchor,offsetXRatio:geometry.offsetX,offsetYRatio:geometry.offsetY,widthRatio:geometry.width,heightRatio:geometry.height});entry={track,lane};
  }
  const {lane,track}=entry,captions=track.captions!;
  if(Object.values(timeline.tracks).some(t=>t.captions?.sourceEntries.some(l=>l!==lane&&l.id===newLane)))throw Error(`镜头 ${shot.id} 的字幕标识冲突。`);
  lane.id=newLane;lane.itemId=`manual:${newLane}`;lane.visible=enabled;
  lane.loopControl={version:'workspace-caption/v1',contentMode:contract.contentMode,text:contract.text,spatial:structuredClone(contract.spatial)};
  Object.assign(lane.loopControl,{sourceInputFingerprint:frozen.inputFingerprint,sourceShotConfirmation:frozen.confirmationStatus});
  if(captions.perSource[oldLane]){captions.perSource[newLane]=captions.perSource[oldLane];delete captions.perSource[oldLane];}
  // This only annotates the original cues; no confirmation evidence or word timing is fabricated.
 }
 for(const timeline of next.timelines)for(const item of timeline.items.filter(i=>i.kind==='audio'&&!audio.has(i))){
  const bgmShot=render.confirmedShots.find(s=>item.id===`bgm-${s.shotId}`);
  const member=render.members.find(m=>m.memberKind==='soundtrack'&&item.id===`soundtrack-${m.memberKey.replace(/[^a-zA-Z0-9_-]/g,'-')}`);
  if(bgmShot){
   const frozenBgm=render.members.find(m=>m.memberKind==='soundtrack'&&m.audioKind==='bgm'&&m.relativePath===item.src);if(!frozenBgm)throw Error('旧配乐来源没有对应冻结成员。');
   item.sourceContentHash=frozenBgm.sha256;item.loopControlAudio={workspaceId,shotId:bgmShot.shotId,kind:'bgm',anchor:'shot',offsetSeconds:0};
  }else if(member?.audioKind==='sfx'){item.sourceContentHash=member.sha256;item.loopControlAudio={workspaceId,kind:'sfx',anchor:'absolute'};}
  else throw Error(`旧音轨 ${String(item.name??item.id)} 无法无损映射到工作区混音。`);
 }
 const expectedLanes=new Set(render.confirmedShots.map(s=>`workspace-caption-shot-${s.shotId}`));
 if(next.timelines.some(t=>Object.values(t.tracks).some(track=>track.captions?.sourceEntries.some(l=>!expectedLanes.has(l.id)))))throw Error('旧工程包含无法映射到冻结镜头的额外字幕。');
 const mix=readWorkspaceAudioMix(next,Object.fromEntries(shots.map(s=>[s.id,s.itemIds])));
 for(const frozen of render.confirmedShots){
  const clip=bindings.find(b=>b.shotId===frozen.shotId)!;
  if(!readWorkspaceCaption(next,clip.itemId))throw Error(`镜头 ${frozen.shotId} 的字幕设置仍不可读。`);
  if(mix.voices.find(v=>v.shotId===frozen.shotId)?.mode!==frozen.audioMode||frozen.audioMode!=='none'&&!resolveWorkspaceMainVoice(next,frozen.shotId).explicitRoute)throw Error(`镜头 ${frozen.shotId} 的主声音仍不可读。`);
 }
 Object.assign(project,next);
}

function replaceAssetReferences(project:OpenChatCutProject,oldId:string,newId:string){
 for(const timeline of project.timelines)for(const item of timeline.items)if(item.sourceAssetId===oldId)item.sourceAssetId=newId;
}
function replaceItemReferences(project:OpenChatCutProject,oldId:string,newId:string){
 for(const timeline of project.timelines){
  const selected=timeline as unknown as {selectedId:string|null;selectedIds?:string[]};if(selected.selectedId===oldId)selected.selectedId=newId;if(selected.selectedIds)selected.selectedIds=selected.selectedIds.map(id=>id===oldId?newId:id);
  for(const transition of timeline.transitions)for(const key of Object.keys(transition))if(transition[key]===oldId)transition[key]=newId;
  for(const track of Object.values(timeline.tracks))for(const lane of track.captions?.sourceEntries??[])if(lane.itemId===oldId)lane.itemId=newId;
 }
}
