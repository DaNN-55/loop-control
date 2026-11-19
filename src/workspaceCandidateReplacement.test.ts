import {expect,it} from 'vitest';
import {applyWorkspaceCandidate,workspaceCandidateTarget,workspaceCandidateShotReplacement,type WorkspaceCandidateEdit} from './workspaceCandidates';
import {resolveWorkspaceMainVoice} from './workspaceAudio';
import type {OpenChatCutProject} from './worker/openchatcutProject';
const hash='a'.repeat(64);
function fixture(){
 return {version:3,loopControl:{version:'four-step-workspace/v1',inputFingerprint:'w'},assets:[{id:'old',kind:'video',src:'old.mp4',durationInFrames:180},{id:'old-source',kind:'audio',src:'old.mp3',durationInFrames:180,loopControlAudioSource:{videoAssetId:'old',sha256:hash,sourceInFrame:0,sourceFrameRate:30}}],mediaFolders:[],activeTimelineId:'t',timelines:[{id:'t',name:'main',order:0,fps:30,width:1080,height:1920,fit:'contain',items:[
  {id:'a',kind:'video',track:'v',src:'old.mp4',sourceAssetId:'old',sourceContentHash:hash,startFrame:30,durationInFrames:60,srcInFrame:15,volume:0,loopControlShot:{workspaceId:'w',shotId:'s',clipId:'ca',text:'镜头'},loopControlAudio:{workspaceId:'w',shotId:'s',voiceMode:'source'},transform:{x:17,y:0,scale:1}},
  {id:'b',kind:'video',track:'v2',src:'old.mp4',sourceAssetId:'old',startFrame:90,durationInFrames:30,loopControlShot:{workspaceId:'w',shotId:'s',clipId:'cb',text:'镜头'},loopControlComposition:{layout:'split',slotId:'right'}},
  {id:'other',kind:'video',track:'v',src:'other.mp4',sourceAssetId:'other',startFrame:120,durationInFrames:90,loopControlShot:{workspaceId:'w',shotId:'other',clipId:'co',text:'另一个'}},
  {id:'workspace-source-shot-s',kind:'audio',track:'voice',src:'old.mp3',sourceAssetId:'old-source',startFrame:30,durationInFrames:60,srcInFrame:15,volume:.37,fadeInFrames:4,loopControlAudio:{workspaceId:'w',shotId:'s',sourceItemId:'a',sourceAssetId:'old-source'}},
  {id:'unlinked',kind:'audio',track:'fx',src:'old.mp3',sourceAssetId:'old-source',startFrame:33,durationInFrames:20,volume:.2,loopControlVideoSound:{videoItemId:'b',videoSourceAssetId:'old'}},
  {id:'sfx',kind:'audio',track:'fx',src:'effect.mp3',startFrame:35,durationInFrames:30,volume:1,loopControlAudio:{kind:'sfx',shotId:'s'}},
 ],trackOrder:['v','v2','voice','fx','captions'],tracks:{v:{kind:'video',name:'v'},v2:{kind:'video',name:'v2'},voice:{kind:'audio',name:'voice',role:'anchor'},fx:{kind:'audio',name:'fx'},captions:{kind:'caption',name:'captions',captions:{enabled:true,sourceEntries:[{id:'workspace-caption-shot-s',words:[{text:'保留字幕',start:1000,end:2500}]}]}}},transitions:[],selectedId:null,captionsHidden:false}]} as unknown as OpenChatCutProject;
}
function edit(p:OpenChatCutProject):WorkspaceCandidateEdit{return {targetItemId:'a',expectedTarget:workspaceCandidateTarget(p.timelines[0].items[0]),durationPolicy:'keep-target',visual:{shotId:'s',usage:'video',motionPolicy:'preserve-target',acceptTimelineImpact:false,expectedAppearance:'',placeholder:false},source:{id:'new',kind:'video',src:'new.mp4',sha256:'b'.repeat(64),inputFingerprint:'candidate',durationSeconds:4,width:1920,height:1080},videoSound:{mode:'separate',boundSourceAsset:{id:'audio-track-00000000-0000-0000-0000-000000000002',kind:'audio',name:'新主原声',src:'new.mp3',durationInFrames:120},sha256:'c'.repeat(64),asset:{id:'material-00000000-0000-0000-0000-000000000001',kind:'audio',name:'新原声',src:'new.mp3',durationInFrames:120}}};}
it('defaults to the selected fragment and reconnects its bound source voice without changing independent nodes',()=>{
 const p=fixture(),e=edit(p),before=structuredClone(p),next=applyWorkspaceCandidate(p,e),voice=resolveWorkspaceMainVoice(next,'s');
 expect(next.timelines[0].items.find(i=>i.id==='b')).toEqual(before.timelines[0].items.find(i=>i.id==='b'));
 expect(voice.sourceCurrent).toBe(true);expect(voice.item).toMatchObject({src:'new.mp3',startFrame:30,durationInFrames:60,srcInFrame:0,volume:.37,fadeInFrames:4});
 for(const id of ['unlinked','sfx','other'])expect(next.timelines[0].items.find(i=>i.id===id)).toEqual(before.timelines[0].items.find(i=>i.id===id));
 expect(next.timelines[0].tracks.captions).toEqual(before.timelines[0].tracks.captions);expect(p).toEqual(before);
});
it('replaces every shot visual with one full-frame item while retaining speech, captions and outside positions',()=>{
 const p=fixture(),e=edit(p);e.visual={...e.visual!,replacementScope:'shot',replacement:workspaceCandidateShotReplacement(p,'s')};
 const speech=p.timelines[0].items.find(i=>i.id==='workspace-source-shot-s')!;speech.id='workspace-narration-shot-s';delete speech.loopControlAudio;
 const expected=structuredClone(p);const next=applyWorkspaceCandidate(p,e),target=next.timelines[0].items.find(i=>i.id==='a')!;
 expect(target).toMatchObject({startFrame:30,durationInFrames:90,src:'new.mp4'});expect(target.loopControlComposition).toBeUndefined();expect(target.transform).toMatchObject({x:0,y:0,scale:1});expect(next.timelines[0].items.some(i=>i.id==='b')).toBe(false);
 for(const id of ['workspace-narration-shot-s','unlinked','sfx','other'])expect(next.timelines[0].items.find(i=>i.id===id)).toEqual(expected.timelines[0].items.find(i=>i.id===id));
 expect(next.timelines[0].tracks.captions).toEqual(expected.timelines[0].tracks.captions);
});
it('rejects a stale shot member even when the selected fragment is unchanged',()=>{
 const p=fixture(),e=edit(p);e.visual={...e.visual!,replacementScope:'shot',replacement:workspaceCandidateShotReplacement(p,'s')};p.timelines[0].items[1].durationInFrames=31;
 expect(()=>applyWorkspaceCandidate(p,e)).toThrow(/整条分镜.*变化/);
});
it.each(['tts','none'])('keeps %s routing and mutes the new linked video sound',mode=>{
 const p=fixture(),voice=p.timelines[0].items.find(i=>i.id==='workspace-source-shot-s')!;if(mode==='tts')voice.id='workspace-narration-shot-s';else p.timelines[0].items=p.timelines[0].items.filter(i=>i!==voice);
 p.timelines[0].items[0].loopControlAudio={workspaceId:'w',shotId:'s',voiceMode:mode};const next=applyWorkspaceCandidate(p,edit(p));
 expect(next.timelines[0].items.find(i=>String(i.id).startsWith('workspace-video-sound-'))?.volume).toBe(0);
 expect(resolveWorkspaceMainVoice(next,'s').item?.id).toBe(mode==='tts'?'workspace-narration-shot-s':undefined);
});
it('a silent replacement never plays the old bound source and records an explicit silent-source status',()=>{
 const p=fixture(),e=edit(p);e.videoSound={mode:'silent'};const next=applyWorkspaceCandidate(p,e);
 expect(next.timelines[0].items.some(i=>i.id==='workspace-source-shot-s')).toBe(false);expect(next.timelines[0].items.find(i=>i.id==='a')?.loopControlAudio).toMatchObject({voiceMode:'source',sourceAudioStatus:'silent'});expect(next.timelines[0].items.find(i=>i.id==='unlinked')).toEqual(p.timelines[0].items.find(i=>i.id==='unlinked'));
});

it('whole-shot adoption can replace split or sped-up targets without retaining the old visual edits',()=>{
 const p=fixture();Object.assign(p.timelines[0].items[0],{playbackRate:2,edits:[{start:1}],opacity:.4,keyframes:{scale:[{value:2}]}});const e=edit(p);e.visual={...e.visual!,replacementScope:'shot',replacement:workspaceCandidateShotReplacement(p,'s')};
 const next=applyWorkspaceCandidate(p,e),target=next.timelines[0].items.find(i=>i.id==='a')!;expect(target.edits).toBeUndefined();expect(target.opacity).toBeUndefined();expect(target.keyframes).toBeUndefined();
});
it('whole-shot stale comparison uses source identity across registered/runtime URL normalization',()=>{
 const p=fixture(),e=edit(p);e.visual={...e.visual!,replacementScope:'shot',replacement:workspaceCandidateShotReplacement(p,'s')};
 for(const item of p.timelines[0].items){if(item.sourceContentHash)item.sourceRevision='source-sha256-'+item.sourceContentHash;}p.timelines[0].items[1].src='/media/uploads/123.mp4';
 expect(()=>applyWorkspaceCandidate(p,e)).not.toThrow();
});
it('replacing a source-voice video with an image clears only its bound source sound',()=>{
 const p=fixture(),e=edit(p);e.source.kind='image';delete e.videoSound;e.visual!.usage='still';const next=applyWorkspaceCandidate(p,e);
 expect(next.timelines[0].items.some(i=>i.id==='workspace-source-shot-s')).toBe(false);expect(next.timelines[0].items.find(i=>i.id==='unlinked')).toEqual(p.timelines[0].items.find(i=>i.id==='unlinked'));
});
it('a later voiced video restores an explicitly selected source route after a silent video',()=>{
 const p=fixture(),silent=edit(p);silent.videoSound={mode:'silent'};const quiet=applyWorkspaceCandidate(p,silent),voiced=edit(quiet);voiced.source.id='later';if(voiced.videoSound?.mode==='separate')voiced.videoSound.boundSourceAsset!.id='audio-track-00000000-0000-0000-0000-000000000003';const next=applyWorkspaceCandidate(quiet,voiced);
 expect(resolveWorkspaceMainVoice(next,'s').item?.src).toBe('new.mp3');expect(resolveWorkspaceMainVoice(next,'s').sourceCurrent).toBe(true);
});
it.each(['a','b'])('rejects whole-shot replacement when member %s is on a locked native track',id=>{
 const p=fixture(),e=edit(p);e.visual={...e.visual!,replacementScope:'shot',replacement:workspaceCandidateShotReplacement(p,'s')};const member=p.timelines[0].items.find(i=>i.id===id)!;Object.assign(p.timelines[0].tracks[String(member.track)],{locked:true});const before=structuredClone(p);
 expect(()=>applyWorkspaceCandidate(p,e)).toThrow(/锁定/);expect(p).toEqual(before);
});
it('rejects selected-fragment replacement on a locked native track',()=>{
 const p=fixture(),e=edit(p);Object.assign(p.timelines[0].tracks.v,{locked:true});expect(()=>applyWorkspaceCandidate(p,e)).toThrow(/锁定/);
});

it('keeps the replacement main source on its registered audio-track identity for caption alignment',()=>{
 const p=fixture(),e=edit(p);if(e.videoSound?.mode!=='separate')throw Error();Object.assign(e.videoSound,{boundSourceAsset:{...e.videoSound.asset,id:'audio-track-00000000-0000-0000-0000-000000000002'}});
 const next=applyWorkspaceCandidate(p,e);expect(resolveWorkspaceMainVoice(next,'s').item?.sourceAssetId).toBe('audio-track-00000000-0000-0000-0000-000000000002');
});
it('rejects replacing bound primary source on a locked voice track',()=>{
 const p=fixture(),e=edit(p);Object.assign(p.timelines[0].tracks.voice,{locked:true});expect(()=>applyWorkspaceCandidate(p,e)).toThrow(/锁定/);
});
it('rejects whole-shot removal of a linked sound on a locked non-target audio track',()=>{
 const p=fixture(),e=edit(p);p.timelines[0].items.push({id:'linked-b',kind:'audio',track:'fx',src:'old.mp3',startFrame:90,durationInFrames:30});p.timelines[0].linkGroups=[{id:'workspace-video-sound-b',itemIds:['b','linked-b'],anchorItemId:'b',mode:'linked'}];Object.assign(p.timelines[0].tracks.fx,{locked:true});e.visual={...e.visual!,replacementScope:'shot',replacement:workspaceCandidateShotReplacement(p,'s')};expect(()=>applyWorkspaceCandidate(p,e)).toThrow(/锁定/);
});
it('reusing a registered replacement source refreshes its video binding instead of marking the new picture stale',()=>{
 const p=fixture(),once=applyWorkspaceCandidate(p,edit(p)),again=edit(once);again.source.id='new-use';const twice=applyWorkspaceCandidate(once,again);expect(resolveWorkspaceMainVoice(twice,'s').sourceCurrent).toBe(true);
});
it('compares a prepared whole-shot scope after PostgreSQL JSONB key reordering',()=>{
 const p=fixture(),e=edit(p);e.visual={...e.visual!,replacementScope:'shot',replacement:Object.fromEntries(Object.entries(workspaceCandidateShotReplacement(p,'s')).reverse()) as unknown as ReturnType<typeof workspaceCandidateShotReplacement>};expect(()=>applyWorkspaceCandidate(p,e)).not.toThrow();
});
