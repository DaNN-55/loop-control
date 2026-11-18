import {expect,it} from 'vitest';
import {setWorkspaceNarrationEnabled,readWorkspaceMainVoiceChoice} from './workspaceNarrationToggle';
import type {OpenChatCutProject} from './worker/openchatcutProject';
const project=()=>({timelines:[{items:[{id:'visual',kind:'video',volume:.7},{id:'workspace-narration-shot-S01',kind:'audio',volume:.35,src:'voice.mp3'},{id:'workspace-source-shot-S01',kind:'audio',volume:.6,src:'source.mp3'},{id:'caption',kind:'text',text:'字幕不变'}]}]}) as unknown as OpenChatCutProject;
it('persists the requested voice route and mutes conflicting voices without deleting their media or captions',()=>{
 const original=project();
 const source=setWorkspaceNarrationEnabled(original,'S01',['visual'],['clip'],false,{mode:'source',preserveNarration:false});
 expect(readWorkspaceMainVoiceChoice(source,['visual'])).toBe('source');
 expect(source.timelines[0].items).toHaveLength(4);expect(source.timelines[0].items.find(i=>i.id==='caption')).toEqual(original.timelines[0].items[3]);
 expect(source.timelines[0].items.find(i=>i.id==='workspace-narration-shot-S01')?.volume).toBe(0);
 expect(source.timelines[0].items.find(i=>i.id==='workspace-source-shot-S01')?.volume).toBe(0);
 const restored=setWorkspaceNarrationEnabled(source,'S01',['visual'],['clip'],true,{mode:'tts',preserveNarration:true});
 expect(restored.timelines[0].items.find(i=>i.id==='workspace-narration-shot-S01')?.volume).toBe(.35);
 expect(restored.timelines[0].items.find(i=>i.id==='workspace-source-shot-S01')?.volume).toBe(0);
 expect(original.timelines[0].items[0].volume).toBe(.7);
});
it('does not unmute the previous generated voice when the requested route is uploaded narration',()=>{
 const next=setWorkspaceNarrationEnabled(project(),'S01',['visual'],['clip'],true,{mode:'manual',preserveNarration:false});
 expect(readWorkspaceMainVoiceChoice(next,['visual'])).toBe('manual');
 expect(next.timelines[0].items.find(i=>i.id==='workspace-narration-shot-S01')?.volume).toBe(0);
});
