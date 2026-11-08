import type {OpenChatCutProject,OpenChatCutTimeline} from './worker/openchatcutProject.js';

export type VideoSound = {mode:'silent'|'embedded'}|{mode:'separate';asset:OpenChatCutProject['assets'][number];sha256:string};
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
 project:OpenChatCutProject,timeline:OpenChatCutTimeline,item:Record<string,unknown>,shotId:string,sound:VideoSound,hasMainVoice:boolean,
){
 removeLinkedVideoSound(timeline,item);
 const volume=hasMainVoice||((item.loopControlAudio as {voiceMode?:string}|undefined)?.voiceMode==='none')?0:Number(item.volume)>0?Number(item.volume):1;
 item.volume=sound.mode==='embedded'?volume:0;
 if(sound.mode!=='separate')return;
 const {asset,sha256}=sound;
 const existing=project.assets.find(other=>other.id===asset.id);
 if(existing&&existing.src!==asset.src)throw Error('独立原声的素材身份已变化。');
 if(!existing)project.assets.push(asset);

 const start=Number(item.startFrame),duration=Number(item.durationInFrames);
 let lane=1,track='workspace-video-sound';
 const overlaps=(id:string)=>timeline.items.some(other=>other.track===id&&Number(other.startFrame)<start+duration&&Number(other.startFrame)+Number(other.durationInFrames)>start);
 while(overlaps(track)){lane++;track='workspace-video-sound-'+lane;}
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
