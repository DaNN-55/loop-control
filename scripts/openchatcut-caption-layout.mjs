function targetSlot(captions,target){
 if(target.kind!=='manual'||captions.layoutPolicy?.mode!=='manual-slots')return;
 const entry=captions.sourceEntries?.find(entry=>entry.id===target.laneId);
 return entry?.slotId?captions.layoutPolicy.slots.find(slot=>slot.id===entry.slotId):undefined;
}
/** Manual-slot placement takes precedence over dormant source-entry offsets. */
export function captionSlotLayoutPatch(captions,target,layout){
 const selected=targetSlot(captions,target);if(!selected)return;
 return {layoutPolicy:{...captions.layoutPolicy,slots:captions.layoutPolicy.slots.map(slot=>slot.id===selected.id?{...slot,...(layout.anchor!==undefined?{anchor:layout.anchor}:{}),...(layout.offsetXRatio!==undefined?{offsetXRatio:layout.offsetXRatio}:{}),...(layout.offsetYRatio!==undefined?{offsetYRatio:layout.offsetYRatio}:{})}:slot)}};
}
export function captionSlotResetDisabled(captions,target){
 const slot=targetSlot(captions,target);return slot?!(slot.offsetXRatio||slot.offsetYRatio):undefined;
}
export function captionSlotTarget(captions,target){
 const slot=targetSlot(captions,target);
 return slot?{...target,layout:{...target.layout,anchor:slot.anchor,offsetXRatio:slot.offsetXRatio,offsetYRatio:slot.offsetYRatio}}:target;
}
export function patchCaptionInspector(code){
 const selection='  const { captions, target } = selection;';
 const reset="  const transformResetDisabled = target.kind === 'single'";
 const after='  const x = layout?.offsetXRatio ?? 0;';
 if(!code.includes(selection)||!code.includes(reset)||!code.includes(after))throw Error('当前 Studio 缺少字幕槽位重置接点。');
 return "import {captionSlotTarget,captionSlotResetDisabled} from 'virtual:loop-control-caption-layout';\n"+code.replace(selection,'  const { captions, target: selectionTarget } = selection;\n  const target = captionSlotTarget(captions, selectionTarget);').replace(reset,"  const nativeTransformResetDisabled = target.kind === 'single'").replace(after,'  const transformResetDisabled = captionSlotResetDisabled(captions, target) ?? nativeTransformResetDisabled;\n'+after);
}
/** Keep the SDK renderer and its preview/inspector edits on the same placement. */
export function patchCaptionLayout(code){
 const move='  const nextLayout = { ...target.layout, ...layout };';
 const reset="  if (target.kind === 'single') return { layout: undefined };";
 if(!code.includes(move)||!code.includes(reset))throw Error('当前 Studio 缺少字幕槽位编辑接点。');
 return "import {captionSlotLayoutPatch} from 'virtual:loop-control-caption-layout';\n"+code.replace(move,move+'\n  const slotPatch = captionSlotLayoutPatch(captions, target, nextLayout);\n  if (slotPatch) return slotPatch;').replace(reset,reset+'\n  const slotPatch = captionSlotLayoutPatch(captions, target, {offsetXRatio:0,offsetYRatio:0});\n  if (slotPatch) return slotPatch;');
}
