import {expect,it} from 'vitest';
import {applyScriptRenderSettings} from './scriptRenderSettings';
import {confirmedTtsRender} from './openchatcutProject.fixture';
import {buildOpenChatCutProject} from './openchatcutProject';

it('carries v2 caption styling, spatial limits, audio gains and SFX timing into the editable project',()=>{
 const render=confirmedTtsRender();
 const contract=render.confirmedShots[0].preparationContract;
 contract.captions.spatial.maxCharactersPerLine=14;
 contract.audioMix.mainVoice.gainDb=0;
 contract.audioMix.bgm={gainDb:-18,duckingLevel:'medium',duckDepthDb:-10,selectionId:'bgm-selection',cueId:null,materialRevisionId:null,role:'follower'};
 contract.audioMix.sfx={gainDb:-24,selectionId:'sfx-selection',cueId:null,materialRevisionId:null,role:'independent',automaticDucking:false};
 render.members.push({memberKey:'sfx:shot-1',memberKind:'soundtrack',audioKind:'sfx',relativePath:'episodes/e/sfx.mp3',sha256:'c'.repeat(64),startSeconds:0,durationSeconds:1});
 render.members.push({memberKey:'bgm:e',memberKind:'soundtrack',audioKind:'bgm',relativePath:'episodes/e/bgm.mp3',sha256:'d'.repeat(64),startSeconds:0,durationSeconds:2});
 const applied=applyScriptRenderSettings(render,{settings:{aspectRatio:'16:9',captionStyle:'minimal',bgmGainDb:-18,sfxGainDb:-24},segments:[{id:'shot-1',settings:{sfxStart:0.3,sfxDuration:0.8}}]});
 const timeline=buildOpenChatCutProject(applied).timelines[0];
 expect(timeline).toMatchObject({width:1920,height:1080});
 expect(timeline.tracks.C1.captions).toMatchObject({template:'plain',styleOverride:{fontFamily:'Noto Sans SC',color:'#ffffff',strokeColor:'#000000'},perSource:{'lane-shot-1':{maxLines:2,maxCharactersPerLine:14}}});
 const sfx=timeline.items.find(i=>i.track==='A3')!;
 expect(sfx).toMatchObject({startFrame:9,durationInFrames:24});expect(sfx.volume).toBeCloseTo(10**(-24/20));
 expect(timeline.items.find(i=>i.id==='bgm-shot-1')?.volume).toBeCloseTo(10**(-18/20));
 expect(render.members.find(m=>m.audioKind==='sfx')?.startSeconds).toBe(0);
});
it('offsets effects from the actual shot window and rejects an interval outside that window',()=>{
 const render=confirmedTtsRender();render.members[0].startSeconds=7;
 render.members.push({memberKey:'sfx:shot-1',memberKind:'soundtrack',audioKind:'sfx',relativePath:'sfx.mp3',sha256:'a'.repeat(64),startSeconds:0,durationSeconds:2});
 const hint={settings:{},segments:[{id:'shot-1',settings:{sfxStart:0.3,sfxDuration:1}}]};
 expect(applyScriptRenderSettings(render,hint).members.at(-1)).toMatchObject({startSeconds:7.3,durationSeconds:1});
 hint.segments[0].settings.sfxDuration=2;expect(()=>applyScriptRenderSettings(render,hint)).toThrow('超出实际镜头');
});
it('preserves an edited Studio project and honors per-shot subtitle changes',()=>{
 const render=confirmedTtsRender(false);
 expect(applyScriptRenderSettings(render,{settings:{captionsEnabled:true}}).adjustments.captionsEnabled).toBe(false);
 const edited={...render,studioProject:{relativePath:'edited.json',sha256:'a'.repeat(64),fileSize:10}};
 expect(applyScriptRenderSettings(edited,{settings:{captionStyle:'cinematic'}})).toBe(edited);
});
