import{afterEach,expect,it,vi}from'vitest';
import{installCaptionDragFallback,patchCaptionDrag}from'./openchatcut-caption-drag.mjs';
afterEach(()=>document.body.replaceChildren());
function pointer(target,type,id=1){const e=new Event(type,{bubbles:true});Object.defineProperty(e,'pointerId',{value:id});target.dispatchEvent(e);}
it('continues moves and commits once when pointer capture is lost outside the subtitle hitbox',()=>{
 const hit=document.createElement('button'),outside=document.createElement('div');document.body.append(hit,outside);const move=vi.fn(),up=vi.fn(),cancel=vi.fn();installCaptionDragFallback(hit,1,move,up,cancel);
 pointer(outside,'pointermove',2);expect(move).not.toHaveBeenCalled();pointer(outside,'pointermove');expect(move).toHaveBeenCalledOnce();pointer(outside,'pointerup');pointer(outside,'pointerup');pointer(outside,'pointermove');expect(up).toHaveBeenCalledOnce();expect(move).toHaveBeenCalledOnce();expect(cancel).not.toHaveBeenCalled();
});
it('does not duplicate native captured events and cancels a gesture on window blur',()=>{
 const hit=document.createElement('button');document.body.append(hit);const move=vi.fn(),up=vi.fn(),cancel=vi.fn();installCaptionDragFallback(hit,1,move,up,cancel);pointer(hit,'pointermove');pointer(hit,'pointerup');expect(move).not.toHaveBeenCalled();expect(up).not.toHaveBeenCalled();
 const dispose=installCaptionDragFallback(hit,1,move,up,cancel);window.dispatchEvent(new Event('blur'));expect(cancel).toHaveBeenCalledOnce();dispose();pointer(document.body,'pointermove');expect(move).not.toHaveBeenCalled();
});
it('fails clearly on an unsupported SDK instead of silently disabling the compatibility fix',()=>{expect(()=>patchCaptionDrag('unknown editor')).toThrow('字幕拖动接点');});
