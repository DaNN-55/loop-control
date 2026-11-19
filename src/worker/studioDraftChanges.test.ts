// @vitest-environment node
import {expect,it} from 'vitest';
import {studioDraftChanges} from './studioDraftChanges';
import type {OpenChatCutProject} from './openchatcutProject';
it('ignores reordered object keys while retaining actual edits and two-sided conflicts',()=>{
 const baseline={version:3,loopControl:{version:'four-step-workspace/v1',inputFingerprint:'same',transitionMode:'studio'},timelines:[{id:'main',items:[{id:'one',transform:{x:0}},{id:'two',text:'原字幕'}]}]} as unknown as OpenChatCutProject;
 const reordered={...baseline,loopControl:{transitionMode:'studio',inputFingerprint:'same',version:'four-step-workspace/v1'}} as OpenChatCutProject;
 const host=structuredClone(baseline);host.timelines[0].items[1].text='修改字幕';
 expect(studioDraftChanges(baseline,reordered,host)).toEqual({nativeChanged:false,hostChanged:true});
 const native=structuredClone(reordered);(native.timelines[0].items[0].transform as {x:number}).x=0.1;
 expect(studioDraftChanges(baseline,native,host)).toEqual({nativeChanged:true,hostChanged:true});
 const reversed=structuredClone(reordered);reversed.timelines[0].items.reverse();
 expect(studioDraftChanges(baseline,reversed,baseline).nativeChanged).toBe(true);
});
