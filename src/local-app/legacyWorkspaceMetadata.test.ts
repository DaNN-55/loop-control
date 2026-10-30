import {describe,it,expect} from 'vitest';
import {adaptLegacyWorkspaceMetadata} from './legacyWorkspaceMetadata';
import {buildOpenChatCutProject,type OpenChatCutProject} from '../worker/openchatcutProject';
import {confirmedTtsRender} from '../worker/openchatcutProject.fixture';
import type {WorkerTaskPackage} from '../worker/contracts';
import type {WorkspaceClip} from '../productionWorkspace';
import {readWorkspaceCaption,applyWorkspaceCaptionEdit} from '../workspaceCaptions';
import {readWorkspaceAudioMix,resolveWorkspaceMainVoice,applyWorkspaceAudioMix} from '../workspaceAudio';
import {readWorkspaceShotWindow,applyWorkspaceShotOperation} from '../workspaceShots';
import {defaultShotComposition} from '../shotComposition';
type Render=NonNullable<WorkerTaskPackage['reviewRender']>;
function setup(render:Render){
 const project=buildOpenChatCutProject(render,'history');project.loopControl={version:'four-step-workspace/v1',inputFingerprint:'workspace',transitionMode:'studio'};
 const bindings:WorkspaceClip[]=project.timelines.flatMap(t=>t.items.filter(i=>i.kind==='video').map((item,index)=>{
  const shot=render.confirmedShots.find(s=>String(item.id).startsWith(`shot-${s.shotId}-`))!;
  const binding={id:`clip-${index}`,itemId:String(item.id),shotId:shot.shotId,text:render.storyboard.shots.find(s=>s.id===shot.shotId)!.scriptSegment,source:null};
  item.loopControlShot={workspaceId:'workspace',clipId:binding.id,shotId:binding.shotId,text:binding.text};return binding;
 }));return{project,bindings};
}
function physicalItems(project:OpenChatCutProject){return project.timelines.map(t=>t.items.map(item=>Object.fromEntries(Object.entries(item).filter(([key])=>!['id','sourceAssetId','sourceContentHash','loopControlAudio','loopControlShot'].includes(key)))));}
function audioMode(render:Render,mode:'source'|'none'){
 const shot=render.confirmedShots[0];shot.audioMode=mode;shot.audioTrackId=null;shot.preparationContract.audioMode=mode;shot.preparationContract.audioMix.mainVoice={mode,trackId:null,gainDb:-3,role:mode==='none'?'none':'anchor'};
 shot.preparationContract.captions.contentMode='independent';return render;
}
describe('frozen legacy project metadata',()=>{
 it('retains native media/timing and exposes existing narration, cues and spatial constraints through current readers',()=>{
  const render=confirmedTtsRender(),{project,bindings}=setup(render),before=structuredClone(project),voice=project.timelines[0].items.find(i=>i.kind==='audio')!;
  (project.timelines[0] as unknown as {selectedId:string}).selectedId=String(voice.id);(project.timelines[0] as unknown as {selectedIds:string[]}).selectedIds=[String(voice.id)];project.timelines[0].transitions=[{fromItemId:voice.id,toItemId:bindings[0].itemId}];
  adaptLegacyWorkspaceMetadata(project,bindings,render);
  expect(physicalItems(project)).toEqual(physicalItems(before));
  const route=resolveWorkspaceMainVoice(project,'shot-1');expect(route).toMatchObject({explicitRoute:true,coverage:'full',alignmentReady:true});expect(route.item).toMatchObject({id:'workspace-narration-shot-shot-1',sourceAssetId:'audio-track-audio-track-1',src:render.members[1].relativePath});
  const read=readWorkspaceCaption(project,bindings[0].itemId)!;expect(read.laneId).toBe('workspace-caption-shot-shot-1');expect(read.words).toEqual(before.timelines[0].tracks.C1.captions!.sourceEntries[0].words);expect(read.contract.spatial).toEqual(render.confirmedShots[0].preparationContract.captions.spatial);
  expect(project.timelines[0].tracks.C1.captions!.layoutPolicy).toEqual(before.timelines[0].tracks.C1.captions!.layoutPolicy);
  expect(project.timelines[0].tracks.C1.captions!.perSource[read.laneId]).toEqual(before.timelines[0].tracks.C1.captions!.perSource['lane-shot-1']);
  expect(project.timelines[0].selectedId).toBe(route.item!.id);expect(project.timelines[0].transitions[0].fromItemId).toBe(route.item!.id);
  const edited=applyWorkspaceCaptionEdit(project,bindings[0].itemId,read.contract);expect(edited.timelines[0].tracks.C1.captions!.sourceEntries).toHaveLength(1);
  const mixed=applyWorkspaceAudioMix(project,{kind:'voice',workspaceId:'workspace',shotId:'shot-1',visualItemIds:[bindings[0].itemId],mode:'tts',gainDb:-6,ambienceGainDb:null});expect(mixed.timelines[0].items.filter(i=>i.kind==='audio')).toHaveLength(1);expect(readWorkspaceAudioMix(mixed,{'shot-1':[bindings[0].itemId]}).voices[0]).toMatchObject({mode:'tts',gainDb:-6});
 });
 it('keeps distinct shot audio and caption references intact when current native operations reorder shots',()=>{
  const render=confirmedTtsRender(),second=structuredClone(render.confirmedShots[0]);second.shotId='shot-2';second.audioTrackId='audio-track-2';second.preparationContract.audioMix.mainVoice.trackId='audio-track-2';
  render.confirmedShots.push(second);render.storyboard.shots.push({...structuredClone(render.storyboard.shots[0]),id:'shot-2'});
  render.members.push({...structuredClone(render.members[0]),memberKey:'shot:shot-2',relativePath:'episodes/e/shot-2.mp4',startSeconds:2,preparationContract:second.preparationContract},{...structuredClone(render.members[1]),memberKey:'narration:shot-2',relativePath:'episodes/e/voice-2.mp3',audioTrackId:'audio-track-2',startSeconds:2});
  const{project,bindings}=setup(render);adaptLegacyWorkspaceMetadata(project,bindings,render);const secondClip=bindings.find(b=>b.shotId==='shot-2')!;
  expect(resolveWorkspaceMainVoice(project,'shot-2').item?.sourceAssetId).toBe('audio-track-audio-track-2');expect(readWorkspaceCaption(project,secondClip.itemId)?.words[0].start).toBe(2000);
  const moved=applyWorkspaceShotOperation(project,{kind:'move',shotId:'shot-2',beforeShotId:'shot-1'});expect(resolveWorkspaceMainVoice(moved,'shot-2').item?.startFrame).toBe(0);expect(readWorkspaceCaption(moved,secondClip.itemId)?.words[0].start).toBe(0);expect(resolveWorkspaceMainVoice(moved,'shot-1').item?.startFrame).toBe(60);
 });
 it('uses one caption and one main route for all simultaneous composition items',()=>{
  const render=confirmedTtsRender(true,'2up-vertical'),{project,bindings}=setup(render),before=physicalItems(project);expect(bindings).toHaveLength(2);adaptLegacyWorkspaceMetadata(project,bindings,render);
  expect(physicalItems(project)).toEqual(before);expect(readWorkspaceShotWindow(project,bindings[1].itemId)?.items).toHaveLength(2);expect(readWorkspaceCaption(project,bindings[0].itemId)?.laneId).toBe(readWorkspaceCaption(project,bindings[1].itemId)?.laneId);expect(resolveWorkspaceMainVoice(project,'shot-1').coverage).toBe('full');
 });
 it('preserves multiple sequential visual source ranges with the complete single narration window',()=>{
  const render=confirmedTtsRender(),segments=[{startSeconds:0,endSeconds:1},{startSeconds:2,endSeconds:3}],composition=defaultShotComposition('full',2);
  render.members[0].clipSegments=segments;render.members[0].composition=composition;render.confirmedShots[0].clipSegments=segments;render.confirmedShots[0].composition=composition;render.confirmedShots[0].preparationContract.clipSegments=segments;render.confirmedShots[0].preparationContract.composition=composition;
  const{project,bindings}=setup(render),before=physicalItems(project);adaptLegacyWorkspaceMetadata(project,bindings,render);expect(bindings).toHaveLength(2);expect(physicalItems(project)).toEqual(before);expect(resolveWorkspaceMainVoice(project,'shot-1')).toMatchObject({coverage:'full',window:{durationSeconds:2,shotDurationSeconds:2}});
 });
 it('maps raw-source voice to an audio alias without altering or duplicating audible items',()=>{
  const render=audioMode(confirmedTtsRender(),'source'),{project,bindings}=setup(render),before=physicalItems(project);adaptLegacyWorkspaceMetadata(project,bindings,render);expect(physicalItems(project)).toEqual(before);
  const route=resolveWorkspaceMainVoice(project,'shot-1');expect(route.item?.id).toBe('workspace-source-shot-shot-1');expect(readWorkspaceAudioMix(project,{'shot-1':[bindings[0].itemId]}).voices[0]).toMatchObject({mode:'source',gainDb:-3,sourceItemId:bindings[0].itemId});
  const mixed=applyWorkspaceAudioMix(project,{kind:'voice',workspaceId:'workspace',shotId:'shot-1',visualItemIds:[bindings[0].itemId],mode:'source',gainDb:-4,ambienceGainDb:null});expect(mixed.timelines[0].items.filter(i=>i.kind==='audio')).toHaveLength(1);expect(readWorkspaceAudioMix(mixed,{'shot-1':[bindings[0].itemId]}).voices[0].gainDb).toBe(-4);
 });
 it('keeps frozen BGM ducking and every SFX gain and absolute window',()=>{
  const render=confirmedTtsRender(),mix=render.confirmedShots[0].preparationContract.audioMix;
  mix.bgm={selectionId:'music',cueId:'music',materialRevisionId:null,gainDb:-14,role:'follower',duckingLevel:'medium',duckDepthDb:-10};
  render.members.push({memberKey:'bgm:music',memberKind:'soundtrack',audioKind:'bgm',relativePath:'episodes/e/music.mp3',sha256:'c'.repeat(64),startSeconds:0,durationSeconds:2},...['tap','bell'].map((name,index)=>({memberKey:'sfx:'+name,memberKind:'soundtrack' as const,audioKind:'sfx' as const,relativePath:'episodes/e/'+name+'.mp3',sha256:'d'.repeat(64),startSeconds:index*.4,durationSeconds:.3})));
  const{project,bindings}=setup(render),before=physicalItems(project),routing=structuredClone(project.timelines[0].tracks);adaptLegacyWorkspaceMetadata(project,bindings,render);expect(physicalItems(project)).toEqual(before);
  const sounds=readWorkspaceAudioMix(project,{'shot-1':[bindings[0].itemId]}).sounds;expect(sounds).toHaveLength(3);expect(sounds.find(s=>s.kind==='bgm')).toMatchObject({gainDb:-14,duckDepthDb:10,startSeconds:0,durationSeconds:2});expect(sounds.filter(s=>s.kind==='sfx').map(s=>s.startSeconds)).toEqual([0,.4]);expect(project.timelines[0].tracks.A3).toEqual(routing.A3);
 });
 it('retains disabled captions and explicit silence instead of reviving draft defaults',()=>{
  const render=audioMode(confirmedTtsRender(),'none');render.adjustments.captionsEnabled=false;const{project,bindings}=setup(render);adaptLegacyWorkspaceMetadata(project,bindings,render);
  expect(resolveWorkspaceMainVoice(project,'shot-1')).toMatchObject({item:undefined,explicitRoute:true});expect(readWorkspaceCaption(project,bindings[0].itemId)?.contract).toMatchObject({enabled:false,contentMode:'independent',cues:[{startMs:0,endMs:2000}]});
 });
 it('refuses multiple raw-source windows atomically rather than hiding an audible segment',()=>{
  const render=audioMode(confirmedTtsRender(),'source'),segments=[{startSeconds:0,endSeconds:1},{startSeconds:2,endSeconds:3}];render.members[0].clipSegments=segments;render.confirmedShots[0].preparationContract.clipSegments=segments;
  const{project,bindings}=setup(render),before=structuredClone(project);expect(()=>adaptLegacyWorkspaceMetadata(project,bindings,render)).toThrow('多个原声区间');expect(project).toEqual(before);
 });
 it('refuses a missing frozen caption lane without mutating the working copy',()=>{
  const render=confirmedTtsRender(),{project,bindings}=setup(render);project.timelines[0].tracks.C1.captions!.sourceEntries=[];const before=structuredClone(project);expect(()=>adaptLegacyWorkspaceMetadata(project,bindings,render)).toThrow('冻结字幕');expect(project).toEqual(before);
 });
});
