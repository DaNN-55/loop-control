// Host adapter for the pinned SDK: GL two-input staging must use the same
// clip-local transform and duration-normalized zoom as TimelineClipWrapper.
export function patchTransitionPlacement(source){
 const anchors=['  opacity: number,\n): void {','  ctx.globalAlpha = opacity;','          outgoingOpacity,\n        );','          incomingOpacity,\n        );','overscan = 1): void {','  ctx.drawImage(el, (ctx.canvas.width - width) / 2, (ctx.canvas.height - height) / 2, width, height);'];
 if(anchors.some(anchor=>!source.includes(anchor)))throw Error('当前 SDK 缺少原生转场构图接点，不能导出缩放/动画组合。');
 return `import { sampleKeyframes as loopSampleKeys } from '../editor/keyframes';\nimport { zoomAt as loopZoomAt } from '../editor/zoom';\n`+source
  .replace(anchors[0],'  opacity: number,\n  localFrame: number,\n): void {')
  .replace(anchors[1],`${anchors[1]}
  const w = ctx.canvas.width, h = ctx.canvas.height;
  const tr = item.transform;
  const key = (prop: 'x'|'y'|'scale'|'scaleX'|'scaleY'|'rotation'|'borderRadius') => {
    const keys = item.keyframes?.[prop];
    return keys?.length ? loopSampleKeys(keys, localFrame) : undefined;
  };
  const scale = key('scale') ?? tr?.scale ?? 1;
  const roundedRadius = Math.max(0, key('borderRadius') ?? tr?.borderRadius ?? 0);
  ctx.translate(w / 2 + (key('x') ?? tr?.x ?? 0) * w / 100, h / 2 + (key('y') ?? tr?.y ?? 0) * h / 100);
  ctx.rotate((key('rotation') ?? tr?.rotation ?? 0) * Math.PI / 180);
  ctx.scale(key('scaleX') ?? tr?.scaleX ?? scale, key('scaleY') ?? tr?.scaleY ?? scale);
  ctx.translate(-w / 2, -h / 2);
  const crop = tr?.crop;
  if (crop) { ctx.beginPath(); ctx.rect((crop.left ?? 0)*w, (crop.top ?? 0)*h, (1-(crop.left ?? 0)-(crop.right ?? 0))*w, (1-(crop.top ?? 0)-(crop.bottom ?? 0))*h); ctx.clip(); }
  if (item.zoom) {
    const zoom = loopZoomAt(item.zoom, localFrame, item.durationInFrames);
    ctx.translate(w * zoom.focalX, h * zoom.focalY);
    ctx.scale(zoom.magnification, zoom.magnification);
    ctx.translate(-w * zoom.focalX, -h * zoom.focalY);
  }`)
  .replace(anchors[2],'          outgoingOpacity,\n          absoluteFrame - outgoing.startFrame,\n        );')
  .replace(anchors[3],'          incomingOpacity,\n          absoluteFrame - incoming.startFrame,\n        );')
  .replace(anchors[4],'overscan = 1, radius = 0): void {')
  .replace(anchors[5],`  ctx.save();
  if (radius > 0) { ctx.beginPath(); ctx.roundRect((ctx.canvas.width-width)/2, (ctx.canvas.height-height)/2, width, height, Math.min(radius,width/2,height/2)); ctx.clip(); }
${anchors[5]}
  ctx.restore();`)
  .replace('drawPlaced(ctx, el, fit);','drawPlaced(ctx, el, fit, 1, roundedRadius);')
  .replace("drawPlaced(ctx, el, 'contain');","drawPlaced(ctx, el, 'contain', 1, roundedRadius);");
}
export function nativeTransitionPlacementPlugin(){return{name:'loop-native-transition-placement',enforce:'pre',transform(code,id){if(id.split('?')[0].endsWith('/src/gl/GlTransition.tsx'))return{code:patchTransitionPlacement(code),map:null};}};}
