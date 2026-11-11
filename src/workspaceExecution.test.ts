// @vitest-environment node
import {it,expect} from 'vitest';
import {usedWorkspaceContent} from './local-app/workspaceExportCommands';
import {setWorkspaceNarrationEnabled} from './workspaceNarrationToggle';
import {setWorkspaceSoundEnabled} from './workspaceAudio';
import type {OpenChatCutProject} from './worker/openchatcutProject';

const make=()=>({version:3,loopControl:{version:'four-step-workspace/v1'},activeTimelineId:'main',assets:[],timelines:[{id:'main',fps:30,tracks:{V1:{kind:'video'},A1:{kind:'audio'}},items:[{id:'visual',kind:'image',track:'V1',src:'picture.png',startFrame:0,durationInFrames:60,loopControlShot:{shotId:'shot-01'}},{id:'workspace-narration-shot-shot-01',kind:'audio',track:'A1',src:'voice.mp3',startFrame:0,durationInFrames:60,volume:.6},{id:'music',kind:'audio',track:'A1',src:'music.mp3',startFrame:0,durationInFrames:60,loopControlAudio:{kind:'bgm'}}]}]} as unknown as OpenChatCutProject);
it('48/21/28/37: disabled audio is not a current file dependency and its preserved gain returns on enable',()=>{
 const original=make(),disabled=setWorkspaceSoundEnabled(setWorkspaceNarrationEnabled(original,'shot-01',['visual'],[],false),'bgm',false);
 expect([...usedWorkspaceContent(disabled).paths]).toEqual(['picture.png']);
 expect(disabled.timelines[0].items).toHaveLength(3);
 const restored=setWorkspaceSoundEnabled(setWorkspaceNarrationEnabled(disabled,'shot-01',['visual'],[],true),'bgm',true);
 expect([...usedWorkspaceContent(restored).paths]).toEqual(['picture.png','voice.mp3','music.mp3']);
 expect(restored.timelines[0].items[1].volume).toBe(.6);
 expect(original.timelines[0].items[1].volume).toBe(.6);
});
it('ordinary silent audio remains a dependency; only explicit content switches remove it',()=>{
 const project=make();project.timelines[0].items[1].volume=0;
 expect(usedWorkspaceContent(project).paths.has('voice.mp3')).toBe(true);
});
