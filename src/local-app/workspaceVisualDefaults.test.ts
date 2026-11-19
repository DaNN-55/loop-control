import {expect,it} from 'vitest';
import {restoreVisualDraft,recordVisualDefaultEdits,visualDefaultsFor,updatedVisualDefaults} from './workspaceVisualDefaults';

const model={capability:'image',provider:'openai',adapter:'openai_images',model:'first'};
const base=()=>({imageSelection:model as typeof model|null,videoSelection:null,settings:{size:'864x1536',quality:'auto',count:1},imageBrief:{framing:'auto',crop:'allow',captionSpace:'none',references:[]},videoSettings:{resolution:'720P',audio:false,promptExtend:false,shotType:'single',watermark:false,negativePrompt:'',seed:undefined as number|undefined},firstFrameFit:'contain',videoModeId:'first-frame',duration:'5',imagePrompt:'甲的提示词',videoPrompt:'甲的动作',references:['甲参考图'],videoInputIds:['甲首帧'],tab:'image'});
it('automatically remembers only changed parameters without promoting an older shot override again',()=>{
 const previous={...base(),settings:{...base().settings,quality:'high'}},next={...previous,settings:{...previous.settings,count:4}};
 expect(updatedVisualDefaults(previous,next,{settings:{quality:'auto',count:2}},'image')).toMatchObject({settings:{quality:'auto',count:4}});
 expect(updatedVisualDefaults(previous,{...previous,imagePrompt:'新文字',references:['新图'],duration:'12'},{},'image')).toBeNull();
 expect(updatedVisualDefaults(previous,next,{},'video')).toBeNull();
});
it('new defaults update inherited leaf fields while retaining only the explicitly edited leaf and local text',()=>{
 const b=base(),visited=restoreVisualDraft(b,null,{},{}),edited=recordVisualDefaultEdits(visited,{...visited,settings:{...visited.settings,quality:'high'},imagePrompt:'单镜头修改'});
 const next=restoreVisualDraft(b,JSON.parse(JSON.stringify(edited)),{settings:{size:'1024x1536',quality:'low',count:4},imageBrief:{framing:'close'}},{});
 expect(next.settings).toEqual({size:'1024x1536',quality:'high',count:4});expect(next.imageBrief.framing).toBe('close');expect(next.imagePrompt).toBe('单镜头修改');
 expect(next.defaultOverrides.fields).toEqual(['settings.quality']);
});
it('preserves a deliberately cleared model and seed across serialization and new defaults',()=>{
 const visited=restoreVisualDraft(base(),null,{}, {videoSettings:{seed:7}});
 const edited=recordVisualDefaultEdits(visited,{...visited,imageSelection:null,videoSettings:{...visited.videoSettings,seed:undefined}});
 const next=restoreVisualDraft(base(),JSON.parse(JSON.stringify(edited)),{imageSelection:{...model,model:'second'}},{videoSettings:{seed:8}});
 expect(next.imageSelection).toBeNull();expect(next.videoSettings.seed).toBeUndefined();expect(next.defaultOverrides.fields).toContain('videoSettings.seed');
});
it('ignores prompt, source and timing fields in defaults and does not share scene-specific negative prompts',()=>{
 const saved=visualDefaultsFor({...base(),videoSettings:{...base().videoSettings,negativePrompt:'本镜排除项'}},'video');
 expect(saved).not.toHaveProperty('duration');expect(saved).not.toHaveProperty('videoPrompt');expect(saved).not.toHaveProperty('videoInputIds');expect(saved).not.toHaveProperty('videoSettings.negativePrompt');
 const next=restoreVisualDraft(base(),null,{imagePrompt:'别的镜头',references:['别图'],imageBrief:{references:[{materialRevisionId:'别图'}]}},{duration:'20',videoPrompt:'别的动作',videoInputIds:['别首帧'],videoSettings:{negativePrompt:'别的排除项'},firstFrameFit:'cover'});
 expect(next.imagePrompt).toBe('甲的提示词');expect(next.references).toEqual(['甲参考图']);expect(next.imageBrief.references).toEqual([]);expect(next.duration).toBe('5');expect(next.videoSettings.negativePrompt).toBe('');expect(next.firstFrameFit).toBe('cover');
});
it('migrates a legacy full draft by preserving observable custom values and refreshing untouched defaults',()=>{
 const old={...base(),settings:{...base().settings,quality:'high'},references:['本镜图'],imagePrompt:''};
 const next=restoreVisualDraft(base(),old,{settings:{count:2,quality:'low'}},{});
 expect(next.settings).toMatchObject({count:2,quality:'high'});expect(next.references).toEqual(['本镜图']);expect(next.imagePrompt).toBe('');
});
it('treats equivalent model object key order as inherited rather than custom',()=>{
 const old={...base(),imageSelection:{model:'first',adapter:'openai_images',provider:'openai',capability:'image'}};
 expect(restoreVisualDraft(base(),old,{imageSelection:{...model,model:'second'}},{}).imageSelection?.model).toBe('second');
});
it('keeps independent visual-instance overrides while the episode default changes',()=>{
 const a=recordVisualDefaultEdits(restoreVisualDraft(base(),null,{},{}),{...restoreVisualDraft(base(),null,{},{}),settings:{...base().settings,count:4}});
 const b=restoreVisualDraft(base(),null,{},{});
 expect(restoreVisualDraft(base(),a,{settings:{count:2}},{}).settings.count).toBe(4);
 expect(restoreVisualDraft(base(),b,{settings:{count:2}},{}).settings.count).toBe(2);
});
