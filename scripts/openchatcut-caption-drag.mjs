/** Keep a native subtitle gesture alive if its small hitbox loses pointer capture. */
export function installCaptionDragFallback(hit,pointerId,onMove,onUp,onCancel){
 const view=hit.ownerDocument.defaultView;
 let stopped=false;
 const move=event=>{if(event.pointerId===pointerId&&event.target!==hit)onMove(event);};
 const stop=()=>{if(stopped)return;stopped=true;view.removeEventListener('pointermove',move,true);view.removeEventListener('pointerup',up,true);view.removeEventListener('pointercancel',cancel,true);view.removeEventListener('blur',cancel);};
 const up=event=>{if(event.pointerId!==pointerId)return;stop();if(event.target!==hit)onUp(event);};
 const cancel=event=>{if(event.type!=='blur'&&event.pointerId!==pointerId)return;stop();onCancel();};
 view.addEventListener('pointermove',move,true);view.addEventListener('pointerup',up,true);view.addEventListener('pointercancel',cancel,true);view.addEventListener('blur',cancel);
 return stop;
}
/** Applied only inside the embedded runtime; the installed SDK checkout stays intact. */
export function patchCaptionDrag(code){
 const ref='  const dragRef = useRef<DragRef | null>(null);';
 const end='  };\n  const onHitPointerMove = (e: React.PointerEvent) => {';
 if(!code.includes(ref)||!code.includes(end))throw Error('当前 Studio 缺少字幕拖动接点。');
 return "import {installCaptionDragFallback} from 'virtual:loop-control-caption-drag';\n"+code.replace(ref,ref+'\n  const dragCleanupRef = useRef<() => void>(()=>{});\n  useEffect(()=>()=>dragCleanupRef.current(),[]);').replace(end,`    dragCleanupRef.current();
    dragCleanupRef.current=installCaptionDragFallback(e.currentTarget,e.pointerId,
      (event:PointerEvent)=>onHitPointerMove(event as unknown as React.PointerEvent),
      (event:PointerEvent)=>onHitPointerUp(event as unknown as React.PointerEvent),
      ()=>{dragRef.current=null;setDrag(null);});
${end}`);
}
