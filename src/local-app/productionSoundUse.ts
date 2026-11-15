import {nativeSoundWindowAudibility as audibleWindow} from './workspaceSoundAudibility.js';
import {createHash} from 'node:crypto';
import type {PoolClient} from 'pg';
import type {OpenChatCutProject} from '../worker/openchatcutProject.js';
import {workspaceExecutionProject,isWorkspaceVideoTrack} from '../workspaceExecution.js';
import {resolveWorkspaceMainVoice} from '../workspaceAudio.js';
import {productionMetricsEnabled} from './productionQuality.js';
import {verifyEpisodeFile,resolveEpisodeFileReference} from './episodeFiles.js';
import {episodeStorageLocationAtRoot} from './episodeStorageLocation.js';
import {inspectAudioStream} from '../worker/mediaTools.js';

const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
type Role='bgm'|'sfx'|'source'|'ambience'|'narration'|'other';
interface Use {instance:string;usage:string;role:Role;path:string;assetId:string;sha:string|null;uncertain:boolean;window:{from:number;to:number;fps:number;item:Record<string,unknown>}}
interface Workspace {id:string;episode_id:string;revision:string|number;bindings:ReadonlyArray<{shotId:string}>}

/** Only reachable, audible native instances inside the active sequence window count.
 * Instance identity includes the sequence path: two placements are two uses, not two sources.
 */
function soundInstances(input:OpenChatCutProject,row:Workspace){
 const project=workspaceExecutionProject(input),uses=new Map<string,Use>();let nodes=0;
 const voices=new Set(row.bindings.map(b=>resolveWorkspaceMainVoice(project,b.shotId).item));
 const visit=(id:string,from:number,to:number,path:string[],parents:unknown[],stack:Set<string>,parentUncertain=false)=>{
  if(stack.has(id)||stack.size>32||++nodes>4096)throw Error('Sound observation sequence graph is invalid');
  const timeline=project.timelines.find(t=>t.id===id);if(!timeline)throw Error('Sound observation timeline is missing');
  const nextStack=new Set(stack).add(id);
  for(const item of timeline.items){
   const start=Number(item.startFrame),end=start+Number(item.durationInFrames),lo=Math.max(start,from),hi=Math.min(end,to);
   const track=timeline.tracks[String(item.track)] as {kind?:string;muted?:boolean;hidden?:boolean;audioRouting?:unknown}|undefined;
   if(!(hi>lo)||track?.muted||track?.hidden)continue;
   // Nested sequences are mounted only on video tracks by the native renderer.
   if(item.kind==='sequence'&&!isWorkspaceVideoTrack(timeline,String(item.track)))continue;
   // The native nested renderer propagates track mute, not the sequence item's gain/fade.
   const audible=item.kind==='sequence'?'audible':audibleWindow(item,lo,hi);if(audible==='silent')continue;
   const uncertain=parentUncertain||audible==='unknown'||!!item.transcript||!!item.edits;
   const instancePath=[...path,timeline.id,String(item.id)],window=item.kind==='sequence'?[lo,hi,Number(item.srcInFrame??0),Number(item.playbackRate??1),timeline.fps,item.transcript??null,item.edits??null]:[lo,hi,Number(item.srcInFrame??0),Number(item.playbackRate??1),Number(item.volume??1),timeline.fps,track?.audioRouting??null,(item.keyframes as {volume?:unknown}|undefined)?.volume??null,item.fadeInFrames??0,item.fadeOutFrames??0,item.transcript??null,item.deletedWordIdx??null,item.edits??null];
   if(item.kind==='sequence'){
    const rate=Number(item.playbackRate??1),source=Number(item.srcInFrame??0);if(!(rate>0))continue;
    const child=project.timelines.find(t=>t.id===item.timelineId);if(!child)throw Error('Sound observation timeline is missing');
    const duration=Math.max(1,child.fps,...child.items.map(i=>Number(i.startFrame)+Number(i.durationInFrames)));
    visit(String(item.timelineId),Math.min(duration-1,source+(lo-start)*rate),Math.min(duration,source+(hi-start)*rate),instancePath,[...parents,window],nextStack,uncertain||rate!==1);continue;
   }
   if(item.kind!=='audio'&&item.kind!=='video')continue;
   const asset=project.assets.find(a=>a.id===item.sourceAssetId),src=typeof item.src==='string'?item.src:asset?.src;if(!src)continue;
   const meta=item.loopControlAudio as {workspaceId?:string;kind?:string;sourceItemId?:string;shotId?:string}|undefined;
   const origin=item.loopControlVideoSound as {videoItemId?:string;videoSourceAssetId?:string}|undefined;
   const linkedSource=!!origin&&timeline.items.some(visual=>visual.kind==='video'&&visual.id===origin.videoItemId&&visual.sourceAssetId===origin.videoSourceAssetId);
   const mainVoice=voices.has(item)||meta?.workspaceId===row.id&&row.bindings.some(b=>b.shotId===meta.shotId)&&(item.id===`workspace-narration-shot-${meta.shotId}`||item.id===`workspace-source-shot-${meta.shotId}`);
   const role:Role=meta?.workspaceId===row.id&&(meta.kind==='bgm'||meta.kind==='sfx')?meta.kind:item.kind==='video'||linkedSource?'source':meta?.sourceItemId?mainVoice?'source':'ambience':mainVoice?'narration':'other';
   const instance=hash(instancePath),assetId=String(item.sourceAssetId??'');
   const sha=typeof item.sourceContentHash==='string'?item.sourceContentHash:null;
   uses.set(instance,{instance,usage:hash([parents,window,item.kind,role,assetId,src,sha]),role,path:src,assetId,sha,uncertain,window:{from:lo,to:hi,fps:timeline.fps,item}});
  }
 };
 visit(project.activeTimelineId,0,Infinity,[],[],new Set());return uses;
}

/** Native IDs are hints only; a same-episode registered row and bytes hash prove the source. */
async function soundSource(c:PoolClient,root:string,row:Workspace,use:Use){
 if(use.uncertain)return null;
 const explicit=use.assetId.match(/^(material-|audio-track-)([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
 const result=await c.query(`WITH sources AS(
  SELECT 'material'::text kind,id,sha256,file_size FROM public.production_material_revisions WHERE episode_id=$1 AND storage_path=$2 AND material_type IN('audio','video')
  UNION ALL SELECT 'audio_track',id,sha256,file_size FROM public.audio_tracks WHERE episode_id=$1 AND relative_path=$2
  UNION ALL SELECT 'task_artifact',id,sha256,file_size FROM public.artifacts WHERE episode_id=$1 AND relative_path=$2 AND artifact_type IN('narration_audio','soundtrack_audio','source_audio','shot_source_audio','legacy_recovered_media','shot_video','a_roll_video','b_roll_asset','render','shot_clip','generated_video'))
  SELECT * FROM sources WHERE ($3::uuid IS NULL OR id=$3 AND kind=$4) AND ($5::text IS NULL OR sha256=$5)`,[row.episode_id,use.path,explicit?.[2]??null,explicit?.[1]==='material-'?'material':'audio_track',use.sha]);
 if(result.rows.length!==1)return null;
 const source=result.rows[0] as {id:string;kind:string;sha256:string;file_size:number|string};
 try{
  await verifyEpisodeFile(c,root,row.episode_id,use.path,source.sha256,Number(source.file_size));
  const audio=await inspectAudioStream(await resolveEpisodeFileReference(c,await episodeStorageLocationAtRoot(c,root,row.episode_id),use.path));
  return{...source,...audio};
 }catch{return null;}
}

/** Current business transaction owns both the native revision and its observations. */
export async function recordProjectSoundChanges(c:PoolClient,root:string,row:Workspace,before:OpenChatCutProject,after:OpenChatCutProject,beforeBindings:Workspace['bindings']){
 if(!await productionMetricsEnabled(c))return;
 if(!(await c.query("SELECT to_regprocedure('local_identity.record_workspace_sound_use(uuid,bigint,text,text,text,uuid,text,text,text)') IS NOT NULL present")).rows[0]?.present)return;
 const previous=soundInstances(before,{...row,bindings:beforeBindings}),next=soundInstances(after,row);
 const sources=new Map<string,ReturnType<typeof soundSource>>();
 const resolve=async(use:Use)=>{
  const key=hash([use.assetId,use.path,use.sha,use.uncertain]);let pending=sources.get(key);if(!pending){pending=soundSource(c,root,row,use);sources.set(key,pending);}const source=await pending;
  if(!source)return null;if(!source.hasAudio)return{...source,silent:true};if(source.startSeconds===null||source.endSeconds===null)return null;
  const {from,to,fps,item}=use.window,start=Number(item.startFrame),sourceIn=Number(item.srcInFrame??0),rate=Number(item.playbackRate??1);
  const lo=Math.max(from,start+(source.startSeconds*fps-sourceIn)/rate),hi=Math.min(to,start+(source.endSeconds*fps-sourceIn)/rate);
  if(!(hi>lo))return{...source,silent:true};const audible=audibleWindow(item,lo,hi);return audible==='unknown'?null:{...source,silent:audible==='silent'};
 };
 for(const key of new Set([...previous.keys(),...next.keys()])){
  const old=previous.get(key),current=next.get(key);if(old?.usage===current?.usage)continue;
  const previousSource=old?await resolve(old):null,currentSource=current?await resolve(current):null;
  if(old&&!previousSource||current&&!currentSource){
   const unresolved=current&&!currentSource?current:old!;
   await c.query('SELECT local_identity.record_workspace_sound_use($1,$2,$3,$4,$5,$6,$7,$8,$9)',[row.id,row.revision,unresolved.role,old&&current?'changed':current?'used':'withdrawn','unresolved',null,null,unresolved.instance,unresolved.usage]);
   // A retained instance with unknown audibility does not prove either a withdrawal
   // or a fresh adoption when it becomes interpretable again.
   if(old&&current)continue;
  }
  const same=previousSource&&currentSource&&previousSource.id===currentSource.id&&previousSource.kind===currentSource.kind&&previousSource.sha256===currentSource.sha256&&old!.role===current!.role;
  const changes:Array<{use:Use;source:NonNullable<typeof previousSource>;action:'used'|'withdrawn'|'changed'}>=[];
  if(same&&!previousSource.silent&&!currentSource.silent)changes.push({use:current!,source:currentSource!,action:'changed'});
  else{if(old&&previousSource&&!previousSource.silent)changes.push({use:old,source:previousSource,action:'withdrawn'});if(current&&currentSource&&!currentSource.silent)changes.push({use:current,source:currentSource,action:'used'});}
  for(const {use,source,action} of changes)await c.query('SELECT local_identity.record_workspace_sound_use($1,$2,$3,$4,$5,$6,$7,$8,$9)',[row.id,row.revision,use.role,action,source.kind,source.id,source.sha256,use.instance,use.usage]);
 }
}

export function summarizeSoundUse(events:ReadonlyArray<{type:string;payload:Record<string,unknown>}>){
 const summary={version:'sound-use/v1' as const,used:0,withdrawn:0,changed:0,roles:{} as Record<string,{used:number;withdrawn:number;changed:number}>,unknownEvents:0};
 for(const event of events){
  if(event.type==='sound_unresolved'){summary.unknownEvents++;continue;}
  if(!['sound_used','sound_withdrawn','sound_changed'].includes(event.type))continue;
  const role=event.payload.role;if(event.payload.version!=='sound-use/v1'||typeof role!=='string'||!['bgm','sfx','source','ambience','narration','other'].includes(role)){summary.unknownEvents++;continue;}
  const action=event.type.slice(6) as 'used'|'withdrawn'|'changed';summary[action]++;(summary.roles[role]??={used:0,withdrawn:0,changed:0})[action]++;
 }
 return summary;
}
