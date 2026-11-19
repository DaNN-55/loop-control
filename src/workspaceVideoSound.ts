import type {OpenChatCutProject,OpenChatCutTimeline} from './worker/openchatcutProject.js';

export type VideoSound = {mode:'silent'|'embedded'}|{mode:'separate';boundSourceAsset?:OpenChatCutProject['assets'][number];asset:OpenChatCutProject['assets'][number];sha256:string};
const groupId=(item:Record<string,unknown>)=>'workspace-video-sound-'+String(item.id);

export function linkedVideoSound(timeline:OpenChatCutTimeline,item:Record<string,unknown>){
 const group=timeline.linkGroups?.find(group=>group.id===groupId(item));
 return group&&timeline.items.find(other=>other.kind==='audio'&&group.itemIds.includes(String(other.id)));
}

export function hasSeparatedVideoSound(timeline:OpenChatCutTimeline,item:Record<string,unknown>){
 return !!linkedVideoSound(timeline,item)||timeline.items.some(other=>{
  const origin=other.loopControlVideoSound as {videoItemId?:unknown;videoSourceAssetId?:unknown}|undefined;
  return other.kind==='audio'&&origin?.videoItemId===item.id&&origin?.videoSourceAssetId===item.sourceAssetId;
 });
}

export function removeLinkedVideoSound(timeline:OpenChatCutTimeline,item:Record<string,unknown>){
 const group=timeline.linkGroups?.find(group=>group.id===groupId(item));
 if(!group)return;
 const audioIds=new Set(group.itemIds.filter(id=>id!==item.id));
 timeline.items=timeline.items.filter(other=>!audioIds.has(String(other.id)));
 timeline.linkGroups=timeline.linkGroups!.filter(other=>other!==group);
}

/** The original media stays intact. The native editor owns the link and can unlink it. */
export function applyWorkspaceVideoSound(
 project:OpenChatCutProject,timeline:OpenChatCutTimeline,item:Record<string,unknown>,shotId:string,sound:VideoSound,hasMainVoice:boolean,previousSources:Record<string,unknown>={},
){
 const audioMetadata=item.loopControlAudio as {workspaceId?:string;voiceMode?:string;sourceAudioStatus?:string;sourceAudioGain?:number}|undefined;
 const boundVoices=timeline.items.filter(other=>{
  if(![`workspace-source-shot-${shotId}`,`workspace-ambience-shot-${shotId}`].includes(String(other.id)))return false;
  const binding=other.loopControlAudio as {sourceItemId?:string}|undefined,asset=project.assets.find(asset=>asset.id===other.sourceAssetId),origin=(asset as unknown as {loopControlAudioSource?:{videoAssetId?:string}}|undefined)?.loopControlAudioSource;
  return !!binding?.sourceItemId&&Object.hasOwn(previousSources,binding.sourceItemId)&&(!origin?.videoAssetId||origin.videoAssetId===previousSources[binding.sourceItemId]);
 });
 if(!boundVoices.length&&sound.mode==='separate'&&audioMetadata?.voiceMode==='source'&&audioMetadata.sourceAudioStatus==='silent'&&!hasMainVoice){
  const track='workspace-main-voice';if(!timeline.tracks[track]){timeline.tracks[track]={kind:'audio',name:'主声音',role:'anchor'};timeline.trackOrder.push(track);}
  if((timeline.tracks[track] as {locked?:boolean}|undefined)?.locked)throw Error('主声音轨已锁定，请先解锁再替换。');
  const voice={id:`workspace-source-shot-${shotId}`,kind:'audio',track,name:sound.asset.name,volume:audioMetadata.sourceAudioGain??1,loopControlAudio:{workspaceId:audioMetadata.workspaceId,shotId,sourceItemId:item.id}};timeline.items.push(voice);boundVoices.push(voice);
 }
 if(boundVoices.length&&sound.mode==='separate'&&!sound.boundSourceAsset)throw Error('新视频主原声尚未登记，请重新比较候选。');
 if(boundVoices.length&&sound.mode==='embedded')throw Error('新视频原声无法提取，请重试提取或明确切换口播／无主声后再采用。');
 removeLinkedVideoSound(timeline,item);
 const volume=hasMainVoice||boundVoices.some(voice=>voice.id===`workspace-source-shot-${shotId}`)||((item.loopControlAudio as {voiceMode?:string}|undefined)?.voiceMode==='none')?0:Number(item.volume)>0?Number(item.volume):1;
 item.volume=sound.mode==='embedded'?volume:0;
 if(sound.mode==='silent'){
  timeline.items=timeline.items.filter(other=>!boundVoices.includes(other));
  item.loopControlAudio={...(item.loopControlAudio as object??{}),sourceAudioStatus:'silent',...(boundVoices.find(voice=>voice.id===`workspace-source-shot-${shotId}`)?{sourceAudioGain:Number(boundVoices.find(voice=>voice.id===`workspace-source-shot-${shotId}`)!.volume??1)}:{})};
  return;
 }
 item.loopControlAudio={...(item.loopControlAudio as object??{}),sourceAudioStatus:sound.mode};
 if(sound.mode!=='separate')return;
 const {asset,sha256}=sound;
 const existing=project.assets.find(other=>other.id===asset.id);
 if(existing&&existing.src!==asset.src)throw Error('独立原声的素材身份已变化。');
 if(!existing)project.assets.push(asset);
 for(const voice of boundVoices){
  const registered=sound.boundSourceAsset!,sourceAsset=project.assets.find(asset=>asset.id===registered.id)??{...registered,loopControlAudioSource:{videoAssetId:item.sourceAssetId,sha256:item.sourceContentHash,sourceInFrame:Number(item.srcInFrame??0),sourceFrameRate:timeline.fps}};
  if(sourceAsset.src!==registered.src)throw Error('新视频主原声身份已变化，请重新比较。');
  Object.assign(sourceAsset,{loopControlAudioSource:{videoAssetId:item.sourceAssetId,sha256:item.sourceContentHash,sourceInFrame:Number(item.srcInFrame??0),sourceFrameRate:timeline.fps}});
  if(!project.assets.some(asset=>asset.id===registered.id))project.assets.push(sourceAsset);
  Object.assign(voice,{src:sourceAsset.src,sourceAssetId:sourceAsset.id,srcInFrame:0,startFrame:Number(item.startFrame),durationInFrames:Number(item.durationInFrames),playbackRate:1,sourceContentHash:sha256,sourceRevision:`source-sha256-${sha256}`,loopControlAudio:{...(voice.loopControlAudio as object??{}),sourceItemId:item.id,sourceAssetId:sourceAsset.id}});
 }

 const start=Number(item.startFrame),duration=Number(item.durationInFrames);
 let lane=1,track='workspace-video-sound';
 const overlaps=(id:string)=>timeline.items.some(other=>other.track===id&&Number(other.startFrame)<start+duration&&Number(other.startFrame)+Number(other.durationInFrames)>start);
 while(overlaps(track)||(timeline.tracks[track] as {locked?:boolean}|undefined)?.locked){lane++;track='workspace-video-sound-'+lane;}
 if(!timeline.tracks[track]){
  timeline.tracks[track]={kind:'audio',name:lane===1?'视频原声':'视频原声 '+lane};
  timeline.trackOrder.push(track);
 }
 const pair=groupId(item);
 let audioId=pair+'-audio',suffix=1;
 while(timeline.items.some(other=>other.id===audioId)){suffix++;audioId=pair+'-audio-'+suffix;}
 timeline.items.push({
  id:audioId,kind:'audio',track,name:asset.name,src:asset.src,sourceAssetId:asset.id,
  sourceContentHash:sha256,startFrame:start,durationInFrames:duration,srcInFrame:0,
  playbackRate:Number(item.playbackRate??1),volume,loopControlVideoSound:{shotId,videoItemId:item.id,videoSourceAssetId:item.sourceAssetId},
 });
 timeline.linkGroups=[...(timeline.linkGroups??[]),{id:pair,itemIds:[String(item.id),audioId],anchorItemId:String(item.id),mode:'linked'}];
}
