import {it,expect} from 'vitest';
import {applyWorkspaceAudioAdoption,isWorkspaceAudioAdoptionEdit} from './workspaceAudioAdoption';
import type {OpenChatCutProject} from './worker/openchatcutProject';
const before={activeTimelineId:'t',loopControl:{version:'four-step-workspace/v1'},assets:[],timelines:[{id:'t',fps:30,items:[{id:'visual',kind:'text',track:'v',startFrame:0,durationInFrames:60}],tracks:{v:{kind:'video'}},trackOrder:['v']}]} as unknown as OpenChatCutProject;
const edit:import('./workspaceAudioAdoption').WorkspaceAudioAdoptionEdit={version:'workspace-audio-adoption/v1' as const,workspaceId:'w',preparationId:'p',timelineId:'t',expectedItems:[],items:[{id:'music',kind:'audio',track:'music',src:'/media/uploads/abcd.mp3',sourceAssetId:'asset',startFrame:0,durationInFrames:60,volume:.3,loopControlAudio:{workspaceId:'w',kind:'bgm',preparationId:'p'}}],tracks:{music:{kind:'audio',name:'配乐'}},asset:{id:'asset',kind:'audio',src:'/media/uploads/abcd.mp3',durationInFrames:90,name:'配乐'}};
it('adds the prepared sound to the live document without changing unrelated edits',()=>{
 const live=structuredClone(before);live.timelines[0].items[0].name='live title';
 expect(isWorkspaceAudioAdoptionEdit(edit)).toBe(true);
 const result=applyWorkspaceAudioAdoption(live,edit);
 expect(result.timelines[0].items).toHaveLength(2);expect(result.timelines[0].items[0].name).toBe('live title');expect(before.timelines[0].items).toHaveLength(1);
 expect(()=>applyWorkspaceAudioAdoption(result,edit)).toThrow();
});
it('rejects a stale audio instance rather than overwriting its changed mix',()=>{
 const live=applyWorkspaceAudioAdoption(before,edit);
 const replacement={...edit,expectedItems:[{...edit.items[0]}]};live.timelines[0].items[1].volume=.1;
 expect(()=>applyWorkspaceAudioAdoption(live,replacement)).toThrow(/变化/);
});
it('enables a previously disabled sound category only on explicit adoption',()=>{
 const disabled=structuredClone(before);disabled.loopControl={...disabled.loopControl!,audioEnabled:{bgm:false,sfx:true}};
 const after=applyWorkspaceAudioAdoption(disabled,edit);
 expect(disabled.loopControl?.audioEnabled?.bgm).toBe(false);expect(after.loopControl?.audioEnabled?.bgm).toBe(true);
});
