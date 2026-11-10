import {it,expect} from 'vitest';
import {applyWorkspaceAudioMix,readWorkspaceAudioMix} from './workspaceAudio';
import type {OpenChatCutProject} from './worker/openchatcutProject';
const project=()=>({version:3,assets:[{id:'audio-track-voice',name:'speech',kind:'audio',src:'voice.mp3',durationInFrames:120},{id:'audio-track-source',name:'source',kind:'audio',src:'source.mp3',durationInFrames:180}],mediaFolders:[],activeTimelineId:'main',timelines:[{id:'main',name:'main',order:0,fps:30,width:360,height:640,fit:'contain',items:[{id:'visual-1',kind:'video',track:'V1',src:'video.mp4',startFrame:0,durationInFrames:60,srcInFrame:30,volume:1},{id:'visual-2',kind:'video',track:'V2',src:'video.mp4',startFrame:0,durationInFrames:60,srcInFrame:30,volume:1},{id:'workspace-narration-shot-s1',kind:'audio',track:'voice',src:'voice.mp3',sourceAssetId:'audio-track-voice',startFrame:0,durationInFrames:60,volume:1}],trackOrder:['V1','V2','voice','captions'],tracks:{V1:{kind:'video',name:'v'},V2:{kind:'video',name:'v2'},voice:{kind:'audio',name:'voice'},captions:{kind:'caption',name:'captions',captions:{enabled:true,words:[{text:'保留字幕'}]}}},transitions:[],selectedId:null,captionsHidden:false}]} as unknown as OpenChatCutProject);
it('routes one shot voice across repeated visual slots and preserves independent captions',()=>{
 const p=project(),before=structuredClone(p.timelines[0].tracks.captions);
 const tts=applyWorkspaceAudioMix(p,{kind:'voice',workspaceId:'w',shotId:'s1',visualItemIds:['visual-1','visual-2'],mode:'tts',gainDb:0,ambienceGainDb:null});
 expect(tts.timelines[0].items.filter(i=>i.kind==='video').map(i=>i.volume)).toEqual([0,0]);
 expect(tts.timelines[0].items.filter(i=>i.kind==='audio')).toHaveLength(1);
 expect(tts.timelines[0].tracks.captions).toEqual(before);
 const source=applyWorkspaceAudioMix(tts,{kind:'voice',workspaceId:'w',shotId:'s1',visualItemIds:['visual-1','visual-2'],sourceItemId:'visual-1',sourceAssetId:'audio-track-source',mode:'source',gainDb:-6,ambienceGainDb:null});
 const audible=source.timelines[0].items.filter(i=>i.kind==='audio');expect(audible).toHaveLength(1);expect(audible[0]).toMatchObject({id:'workspace-source-shot-s1',startFrame:0,durationInFrames:60,srcInFrame:30,volume:0.5011872336272722});
 expect(readWorkspaceAudioMix(source,{s1:['visual-1','visual-2']}).voices[0]).toMatchObject({shotId:'s1',mode:'source',gainDb:-6});
 expect(applyWorkspaceAudioMix(source,{kind:'voice',workspaceId:'w',shotId:'s1',visualItemIds:['visual-1','visual-2'],mode:'none',gainDb:0,ambienceGainDb:null}).timelines[0].items.filter(i=>i.kind==='audio')).toHaveLength(0);
});
it('mixes music and effects independently and refuses unprepared voice sources',()=>{
 const p=project();p.timelines[0].items.push({id:'music',kind:'audio',track:'music-track',src:'music.mp3',startFrame:0,durationInFrames:120,volume:.25,loopControlAudio:{kind:'bgm',workspaceId:'w'}},{id:'effect',kind:'audio',track:'effect-track',src:'effect.mp3',startFrame:30,durationInFrames:12,volume:.5,loopControlAudio:{kind:'sfx',workspaceId:'w'}});p.timelines[0].tracks['music-track']={kind:'audio',name:'music'};p.timelines[0].tracks['effect-track']={kind:'audio',name:'effect'};
 const before=structuredClone(p.timelines[0].items.find(i=>i.id==='effect'));
 const next=applyWorkspaceAudioMix(p,{kind:'sound',workspaceId:'w',itemId:'music',gainDb:-18,duckDepthDb:14});expect(next.timelines[0].tracks['music-track']).toMatchObject({role:'follower',audioRouting:{duckDepthDb:-14}});expect(next.timelines[0].items.find(i=>i.id==='effect')).toEqual(before);expect(next.timelines[0].tracks.captions).toEqual(p.timelines[0].tracks.captions);
 expect(()=>applyWorkspaceAudioMix(p,{kind:'voice',workspaceId:'w',shotId:'s1',visualItemIds:['visual-1','visual-2'],mode:'source',gainDb:0,ambienceGainDb:null})).toThrow('准备');
});

it('places one adopted effect without changing another effect or its native source window',()=>{
 const p=project();const tl=p.timelines[0];tl.items[0].loopControlShot={shotId:'s1'};tl.items[0].startFrame=60;
 for(const id of ['a','b']){tl.items.push({id,kind:'audio',track:id,sourceAssetId:'audio-track-source',src:'source.mp3',srcInFrame:30,startFrame:60,durationInFrames:30,volume:.5,playbackRate:1.5,loopControlAudio:{workspaceId:'w',kind:'sfx',shotId:'s1',anchor:'shot'}});tl.tracks[id]={kind:'audio',name:id};}
 const before=structuredClone(p),next=applyWorkspaceAudioMix(p,{kind:'sound',workspaceId:'w',itemId:'a',gainDb:-8,duckDepthDb:4,placement:{anchor:'shot',shotId:'s1',offsetSeconds:.2,durationSeconds:1.2}});
 expect(next.timelines[0].items.find(i=>i.id==='a')).toMatchObject({startFrame:66,durationInFrames:36,srcInFrame:30,playbackRate:1.5,loopControlAudio:{anchor:'shot',offsetSeconds:.2,shotId:'s1'}});
 expect(next.timelines[0].items.find(i=>i.id==='b')).toEqual(before.timelines[0].items.find(i=>i.id==='b'));expect(next.timelines[0].tracks.b).toEqual(before.timelines[0].tracks.b);expect(p).toEqual(before);
 expect(()=>applyWorkspaceAudioMix(p,{kind:'sound',workspaceId:'w',itemId:'a',gainDb:-8,duckDepthDb:0,placement:{anchor:'shot',shotId:'missing',offsetSeconds:0,durationSeconds:1}})).toThrow('镜头');
 expect(()=>applyWorkspaceAudioMix(p,{kind:'sound',workspaceId:'w',itemId:'a',gainDb:-8,duckDepthDb:0,placement:{anchor:'absolute',offsetSeconds:0,durationSeconds:4}})).toThrow('可用区间');
 expect(()=>applyWorkspaceAudioMix(p,{kind:'sound',workspaceId:'w',itemId:'a',gainDb:-8,duckDepthDb:0,placement:{anchor:'absolute',offsetSeconds:Number.MAX_VALUE,durationSeconds:1}})).toThrow('无效');
 expect(()=>applyWorkspaceAudioMix(p,{kind:'sound',workspaceId:'other',itemId:'a',gainDb:-8,duckDepthDb:0,placement:{anchor:'absolute',offsetSeconds:0,durationSeconds:1}})).toThrow('无效');
});
it('keeps whole-episode music on an absolute position without a shot placeholder',()=>{
 const p=project(),tl=p.timelines[0];tl.items.push({id:'bgm',kind:'audio',track:'bgm',sourceAssetId:'audio-track-source',src:'source.mp3',startFrame:0,durationInFrames:90,volume:1,loopControlAudio:{workspaceId:'w',kind:'bgm',anchor:'absolute'}});tl.tracks.bgm={kind:'audio',name:'整期配乐'};
 const next=applyWorkspaceAudioMix(p,{kind:'sound',workspaceId:'w',itemId:'bgm',gainDb:-12,duckDepthDb:10,placement:{anchor:'absolute',offsetSeconds:.5,durationSeconds:2}});
 expect(next.timelines[0].items.find(i=>i.id==='bgm')).toMatchObject({startFrame:15,durationInFrames:60});
 expect(()=>applyWorkspaceAudioMix(p,{kind:'sound',workspaceId:'w',itemId:'bgm',gainDb:-12,duckDepthDb:10,placement:{anchor:'shot',shotId:'s1',offsetSeconds:0,durationSeconds:1}})).toThrow('无效');
});
