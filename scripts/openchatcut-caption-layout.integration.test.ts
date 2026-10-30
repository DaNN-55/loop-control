// @vitest-environment node
import {build} from 'esbuild';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {beforeAll,expect,it} from 'vitest';
import {captionSlotTarget,captionSlotResetDisabled,patchCaptionLayout} from './openchatcut-caption-layout.mjs';

const root=process.env.OPENCHATCUT_ROOT;
if(!root)throw Error('Caption layout integration requires OPENCHATCUT_ROOT.');
let sdk;
beforeAll(async()=>{
 const bundled=await build({stdin:{contents:`export * from ${JSON.stringify(join(root,'src/captions/captionPreviewTarget.ts'))};export {buildLaneGroups} from ${JSON.stringify(join(root,'src/captions/lanes.ts'))};`,resolveDir:root,loader:'ts'},bundle:true,platform:'node',format:'esm',write:false,plugins:[{name:'actual-caption-adapter',setup(b){b.onLoad({filter:/captionPreviewTarget\.ts$/},async({path})=>({contents:patchCaptionLayout(await readFile(path,'utf8')),loader:'ts'}));b.onResolve({filter:/^virtual:loop-control-caption-layout$/},()=>({path:new URL('./openchatcut-caption-layout.mjs',import.meta.url).pathname}));}}]});
 sdk=await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].text).toString('base64'));
});
function captions(){return {enabled:true,template:'story',pacing:'phrase',sourceMode:'item',sourceEntries:[{id:'first',itemId:'manual:first',slotId:'first-slot',anchor:'middle-center',offsetXRatio:-.12,offsetYRatio:.53,words:[{id:'cue-first',text:'字幕拖动回归',start:0,end:2000}]},{id:'second',itemId:'manual:second',slotId:'second-slot',words:[{id:'cue-second',text:'第二镜',start:2000,end:4000}]}],layoutPolicy:{mode:'manual-slots',slots:[{id:'first-slot',anchor:'middle-center',offsetXRatio:0,offsetYRatio:0,widthRatio:.86,heightRatio:1},{id:'second-slot',anchor:'bottom-center',offsetXRatio:0,offsetYRatio:.1,widthRatio:.84,heightRatio:.8}]}};}
it('writes the actual rendered manual slot, preserving unrelated slots, safe area and source data',()=>{
 const before=captions(),original=structuredClone(before),target=sdk.findCaptionPreviewTarget(before,[],30,0);
 expect(target).toMatchObject({kind:'manual',laneId:'first',layout:{offsetXRatio:0,offsetYRatio:0}});
 const patch=sdk.captionPreviewLayoutPatch(before,target,{...target.layout,offsetXRatio:.25,offsetYRatio:-.125});
 const next={...before,...patch};
 expect(sdk.buildLaneGroups(next,[],30,0)[0]).toMatchObject({offsetXRatio:.25,offsetYRatio:-.125});
 expect(sdk.findCaptionPreviewTarget(next,[],30,0).layout).toMatchObject({offsetXRatio:.25,offsetYRatio:-.125});
 expect(next.layoutPolicy.slots[1]).toEqual(before.layoutPolicy.slots[1]);
 expect(next.layoutPolicy.slots[0]).toMatchObject({widthRatio:.86,heightRatio:1});
 expect(next.sourceEntries).toEqual(before.sourceEntries);
 expect(before).toEqual(original);
});
it('nudges and resets the same slot used by the renderer',()=>{
 const before=captions(),target=sdk.findCaptionPreviewTarget(before,[],30,0);
 const nudged={...before,...sdk.captionPreviewNudgePatch(before,target,'right')};
 expect(sdk.buildLaneGroups(nudged,[],30,0)[0].offsetXRatio).toBe(.01);
 const movedTarget=sdk.findCaptionPreviewTarget(nudged,[],30,0);
 const reset={...nudged,...sdk.captionPreviewLayoutResetPatch(nudged,movedTarget)};
 expect(sdk.buildLaneGroups(reset,[],30,0)[0]).toMatchObject({anchor:'middle-center',offsetXRatio:0,offsetYRatio:0});
});
it('retains the native entry and single-stream paths when no manual slot exists',()=>{
 const before=captions();delete before.layoutPolicy;
 const target=sdk.findCaptionPreviewTarget(before,[],30,0),next={...before,...sdk.captionPreviewLayoutPatch(before,target,{offsetXRatio:.2})};
 expect(next.sourceEntries[0].offsetXRatio).toBe(.2);
 expect(next.sourceEntries[1]).toEqual(before.sourceEntries[1]);
 const single={enabled:true,template:'story',pacing:'phrase',words:[{text:'单轨',start:0,end:2000}]};
 const singleTarget=sdk.findCaptionPreviewTarget(single,[],30,0);
 expect(sdk.captionPreviewLayoutPatch(single,singleTarget,{offsetXRatio:.3})).toEqual({layout:{offsetXRatio:.3}});
});
it('enables the inspector reset for a moved slot-only generated entry',()=>{
 const before=captions();for(const key of ['anchor','offsetXRatio','offsetYRatio'])delete before.sourceEntries[0][key];
 const target=sdk.findCaptionPreviewTarget(before,[],30,0);
 expect(captionSlotResetDisabled(before,target)).toBe(true);
 const moved={...before,...sdk.captionPreviewLayoutPatch(before,target,{offsetXRatio:.2,offsetYRatio:-.1})};
 expect(captionSlotResetDisabled(moved,sdk.findCaptionPreviewTarget(moved,[],30,0))).toBe(false);
 expect(captionSlotTarget(moved,{...target,layout:undefined}).layout).toMatchObject({anchor:'middle-center',offsetXRatio:.2,offsetYRatio:-.1});
 const reset={...moved,...sdk.captionPreviewLayoutResetPatch(moved,sdk.findCaptionPreviewTarget(moved,[],30,0))};
 expect(captionSlotResetDisabled(reset,sdk.findCaptionPreviewTarget(reset,[],30,0))).toBe(true);
});
