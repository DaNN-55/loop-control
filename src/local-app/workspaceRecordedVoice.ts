import type {PoolClient} from 'pg';
import {randomUUID} from 'node:crypto';
import type {OpenChatCutProject} from '../worker/openchatcutProject.js';
import {validateWorkspaceVoiceInput} from '../workspaceVoiceInput.js';
import {workspaceVisualDraftInstances} from '../workspaceVisualDraft.js';
import {resolveWorkspaceMainVoice} from '../workspaceAudio.js';
import {workspaceRenderPreferences} from '../workspaceRenderPreferences.js';
import {readWorkspaceShotWindow} from '../workspaceShots.js';
import {ConfigurationError,canonicalFingerprint} from './configurationCommands.js';
import {registeredWorkspaceAudio} from './registeredWorkspaceAudio.js';
import {resolveWorkspaceSource} from './workspaceSources.js';
import {persistWorkspaceRevision,type ProductionWorkspaceRecord} from './productionWorkspaceCommands.js';

/** Adopt the selected registered file as primary sound; no old extraction or approval is replayed. */
export async function adoptWorkspaceRecordedVoice(c:PoolClient,root:string,row:ProductionWorkspaceRecord,project:OpenChatCutProject,data:Record<string,unknown>){
 if(typeof data.shotId!=='string'||typeof data.audioTrackId!=='string'||typeof data.expectedSha256!=='string')throw new ConfigurationError(400,'原声音轨选择无效。');
 const clips=row.bindings.filter(b=>b.shotId===data.shotId),input=clips[0]?.voiceInput;
 if(!input)throw new ConfigurationError(409,'当前镜头没有原登记原声输入。');
 try{validateWorkspaceVoiceInput(input);}catch(error){throw new ConfigurationError(409,error instanceof Error?error.message:'原声输入无效。');}
 if(!input.audioTrack||input.audioTrack.id!==data.audioTrackId||input.audioTrack.sha256!==data.expectedSha256)throw new ConfigurationError(409,'原声选择已变化，请重新读取当前输入。');
 let recorded:Awaited<ReturnType<typeof registeredWorkspaceAudio>>;
 try{recorded=await registeredWorkspaceAudio(c,root,row.episode_id,input.audioTrack.id,'source');}catch(error){if(['ENOENT','ENOTDIR','EACCES','EPERM','EIO'].includes((error as NodeJS.ErrnoException)?.code??''))throw new ConfigurationError(409,'原声音轨文件不可读取，请恢复原文件或按当前原片准备。');throw error;}
 if(recorded.track.sha256!==input.audioTrack.sha256)throw new ConfigurationError(409,'原登记原声音轨指纹已变化。');
 const assetId='audio-track-'+recorded.track.id,voiceId='workspace-source-shot-'+data.shotId,window=readWorkspaceShotWindow(project,clips[0].itemId);
 if(!window)throw new ConfigurationError(409,'原声所属镜头已变化。');
 const existing=window.timeline.items.find(i=>i.id===voiceId);
 if(existing&&existing.kind!=='audio')throw new ConfigurationError(409,'当前主声标识被其他内容占用，请先核对原生编辑。');
 const currentAsset=project.assets.find(a=>a.id===assetId);
 if(currentAsset&&(currentAsset.kind!=='audio'||currentAsset.src!==recorded.track.relative_path||(currentAsset as {sourceContentHash?:string}).sourceContentHash&&((currentAsset as {sourceContentHash?:string}).sourceContentHash!==recorded.track.sha256)))throw new ConfigurationError(409,'当前工程中的原声音轨身份冲突。');
 const priorReceipt=(await c.query("SELECT request_snapshot FROM local_identity.workspace_audio_preparations WHERE workspace_id=$1 AND episode_id=$2 AND kind='source' AND shot_id=$3 AND adopted_item_id=$4 AND request_snapshot @> $5::jsonb ORDER BY created_at DESC LIMIT 1",[row.id,row.episode_id,data.shotId,voiceId,{...recorded.snapshot,purpose:'recorded-primary-voice/v1'}])).rows[0]?.request_snapshot;
 const trustedReceipt=priorReceipt&&typeof priorReceipt.sourceFrameRate==='number'&&Number.isFinite(priorReceipt.sourceFrameRate)&&priorReceipt.sourceFrameRate>0;
 const repeated=!!currentAsset&&existing?.sourceAssetId===assetId&&existing.src===recorded.track.relative_path&&existing.sourceContentHash===recorded.track.sha256;
 // An explicit repeat must not reset the Owner's trims, routing, gain or mute.
 if(repeated&&trustedReceipt)return;
 const expected=workspaceVisualDraftInstances(input.visualDraft,window.timeline.fps);
 if(!input.visual||expected.length!==clips.length)throw new ConfigurationError(409,'当前画面与原声输入不同，请按当前原片准备原声。');
 for(const [index,clip]of clips.entries()){
  const item=window.timeline.items.find(i=>i.id===clip.itemId),range=expected[index];
  if(!item||item.kind!=='video'||typeof item.src!=='string'||Number(item.startFrame)-window.startFrame!==range.startFrame||Number(item.durationInFrames)!==range.durationInFrames||Number(item.srcInFrame??0)!==Math.round(range.sourceRange.sourceInSeconds*window.timeline.fps)||Number(item.playbackRate??1)!==1)throw new ConfigurationError(409,'当前画面区间已变化，请按当前原片准备原声。');
  const source=await resolveWorkspaceSource(c,root,row.episode_id,item.src);
  if(source.registration!=='material'||source.id!==input.visual.materialRevisionId||source.sha256!==input.visual.sha256)throw new ConfigurationError(409,'当前画面来源与原声输入不同，请按当前原片准备原声。');
 }
 const next=structuredClone(project),timeline=next.timelines.find(t=>t.id===window.timeline.id)!,primary=existing??resolveWorkspaceMainVoice(project,data.shotId).item;
 const fps=timeline.fps,frames=Math.floor(recorded.duration*fps),start=Number(primary?.startFrame??window.startFrame),duration=Number(primary?.durationInFrames??window.durationInFrames),sourceIn=Number(primary?.srcInFrame??0),rate=Number(primary?.playbackRate??1);
 if(!Number.isSafeInteger(start)||start<0||!Number.isSafeInteger(duration)||duration<1||!Number.isFinite(sourceIn)||sourceIn<0||!Number.isFinite(rate)||rate<=0||sourceIn+duration*rate>frames+1)throw new ConfigurationError(409,'原登记音轨不能容纳当前主声窗口，请保留当前编辑另选来源。');
 const asset=next.assets.find(a=>a.id===assetId);
 const audio={...(asset??{}),id:assetId,name:asset?.name??'原登记原声',kind:'audio' as const,src:recorded.track.relative_path,durationInFrames:frames,sourceContentHash:recorded.track.sha256,loopControlAudioSource:{version:'workspace-recorded-voice/v1',sha256:recorded.track.sha256,sourceInFrame:0,sourceFrameRate:fps,videoAssetId:window.item.sourceAssetId}};
 if(asset)Object.assign(asset,audio);else next.assets.push(audio);
 const visualIds=new Set(clips.map(b=>b.itemId));
 const linked=new Set(timeline.linkGroups?.filter(g=>g.id.startsWith('workspace-video-sound-')&&g.itemIds.some(id=>visualIds.has(id))).flatMap(g=>g.itemIds));
 for(const item of timeline.items){if(visualIds.has(String(item.id))){item.volume=0;item.loopControlAudio={workspaceId:row.id,shotId:data.shotId,voiceMode:'source'};}else if(linked.has(String(item.id))&&item.kind==='audio')item.volume=0;}
 const oldIds=new Set([voiceId,'workspace-narration-shot-'+data.shotId,'workspace-ambience-shot-'+data.shotId,...clips.map(b=>'workspace-narration-'+b.id)]);
 timeline.items=timeline.items.filter(i=>!oldIds.has(String(i.id)));
 const track=typeof primary?.track==='string'?primary.track:'workspace-main-voice';
 const voice:OpenChatCutProject['timelines'][number]['items'][number]={...primary,id:voiceId,kind:'audio',name:primary?.name??'原登记原声',track,src:recorded.track.relative_path,sourceAssetId:assetId,sourceContentHash:recorded.track.sha256,startFrame:start,durationInFrames:duration,srcInFrame:sourceIn,playbackRate:rate,volume:primary?.volume??10**((workspaceRenderPreferences(project,data.shotId)?.voiceGainDb??0)/20),loopControlAudio:{workspaceId:row.id,shotId:data.shotId,voiceMode:'source',sourceItemId:clips[0].itemId,sourceAssetId:assetId}};
 delete voice.loopControlCandidate;delete voice.loopControlVideoSound;delete voice.sourceFilename;delete voice.loopControlNarrationEnabled;voice.sourceRevision='source-sha256-'+recorded.track.sha256;timeline.items.push(voice);
 if(timeline.linkGroups)timeline.linkGroups=timeline.linkGroups.map(group=>{const ids=[...new Set(group.itemIds.map(id=>id===primary?.id?voiceId:id).filter(id=>!oldIds.has(id)||id===voiceId))];return{...group,itemIds:ids,anchorItemId:ids.includes(String(group.anchorItemId))?group.anchorItemId:ids[0]};}).filter(group=>group.itemIds.length>1);
 const selected=timeline as unknown as {selectedId:string|null;selectedIds?:string[]};if(oldIds.has(String(selected.selectedId)))selected.selectedId=voiceId;
 if(selected.selectedIds)selected.selectedIds=[...new Set(selected.selectedIds.map(id=>oldIds.has(id)?voiceId:id))];
 if(!timeline.tracks[track])timeline.tracks[track]={kind:'audio',name:'主声音',role:'anchor'};if(!timeline.trackOrder.includes(track))timeline.trackOrder.push(track);
 // A protected current receipt identifies this independent file's zero origin;
 // it does not claim that the old producing task extracted the current video.
 const receipt={...recorded.snapshot,purpose:'recorded-primary-voice/v1',sourceFrameRate:fps};
 const fingerprint=canonicalFingerprint({workspaceId:row.id,shotId:data.shotId,receipt});
 if(!trustedReceipt)await c.query("INSERT INTO local_identity.workspace_audio_preparations(id,workspace_id,episode_id,kind,shot_id,source_item_id,source_sha256,description,anchor,offset_seconds,duration_seconds,adopted_item_id,input_fingerprint,request_snapshot) VALUES($1,$2,$3,'source',$4,$5,$6,'原登记原声','shot',0,$7,$8,$9,$10)",[randomUUID(),row.id,row.episode_id,data.shotId,clips[0].itemId,input.visual.sha256,recorded.duration,voiceId,fingerprint,receipt]);
 await c.query('SELECT local_identity.use_production_source_track($1,$2,$3)',[row.id,data.shotId,recorded.track.id]);
 if(repeated)return;
 await persistWorkspaceRevision(c,root,row,next,row.bindings,'采用原登记原声',{nativeEdit:true});
}
