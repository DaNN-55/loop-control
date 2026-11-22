import {expect,it} from 'vitest';
import {applyWorkspaceShotOperation,isWorkspaceShotOperation} from './workspaceShots';
import type {OpenChatCutProject} from './worker/openchatcutProject';
const fixture=()=>({activeTimelineId:'t',assets:[{id:'a',kind:'video',durationInFrames:300}],timelines:[{id:'t',fps:30,items:[{id:'v',kind:'video',sourceAssetId:'a',startFrame:0,srcInFrame:0,durationInFrames:60,playbackRate:2,loopControlShot:{workspaceId:'w',shotId:'s',clipId:'c',text:''}}],tracks:{V:{kind:'video'}},trackOrder:['V']}]} as unknown as OpenChatCutProject);
it('atomically changes both source edges and preserves the existing playback rate',()=>{
 const p=fixture(),next=applyWorkspaceShotOperation(p,{kind:'trim',itemId:'v',sourceInFrame:30,sourceOutFrame:150,keepDuration:false});
 expect(next.timelines[0].items[0]).toMatchObject({srcInFrame:30,durationInFrames:60,playbackRate:2,startFrame:0});expect(p.timelines[0].items[0].srcInFrame).toBe(0);
 expect(()=>applyWorkspaceShotOperation(p,{kind:'trim',itemId:'v',sourceInFrame:30,sourceOutFrame:90,keepDuration:true})).toThrow('区间');
});
it('rejects an out-of-source range or shortening past the retained main voice',()=>{
 const p=fixture();expect(()=>applyWorkspaceShotOperation(p,{kind:'trim',itemId:'v',sourceInFrame:30,sourceOutFrame:330,keepDuration:false})).toThrow('区间');
 p.timelines[0].items.push({id:'workspace-narration-shot-s',kind:'audio',startFrame:0,durationInFrames:60});
 expect(()=>applyWorkspaceShotOperation(p,{kind:'trim',itemId:'v',sourceInFrame:30,sourceOutFrame:90,keepDuration:false})).toThrow('主声');
});
it('accepts only explicit bounded integral trim inputs',()=>{
 expect(isWorkspaceShotOperation({kind:'trim',itemId:'v',sourceInFrame:0,sourceOutFrame:30,keepDuration:true})).toBe(true);
 for(const patch of [{sourceInFrame:-1},{sourceOutFrame:0},{sourceOutFrame:1.5},{keepDuration:'yes'},{src:'/other'}])expect(isWorkspaceShotOperation({kind:'trim',itemId:'v',sourceInFrame:0,sourceOutFrame:30,keepDuration:true,...patch})).toBe(false);
});
it('keeps duration locks and saved caption bounds authoritative',()=>{
 const locked=fixture();locked.timelines[0].items[0].loopControlVideo={durationLocked:true};
 expect(()=>applyWorkspaceShotOperation(locked,{kind:'trim',itemId:'v',sourceInFrame:0,sourceOutFrame:60,keepDuration:false})).toThrow('锁定');
 const captioned=fixture();captioned.timelines[0].tracks.V.captions={sourceEntries:[{id:'workspace-caption-shot-s',words:[{start:0,end:2000,text:'完整字幕'}]}]} as never;
 expect(()=>applyWorkspaceShotOperation(captioned,{kind:'trim',itemId:'v',sourceInFrame:0,sourceOutFrame:60,keepDuration:false})).toThrow('字幕');
});
