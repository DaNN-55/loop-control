import {vi} from 'vitest';
if(!window.PointerEvent)window.PointerEvent=MouseEvent as typeof PointerEvent;
if(!Element.prototype.hasPointerCapture)Element.prototype.hasPointerCapture=()=>false;
if(!Element.prototype.setPointerCapture)Element.prototype.setPointerCapture=()=>{};
if(!Element.prototype.releasePointerCapture)Element.prototype.releasePointerCapture=()=>{};
if(!Element.prototype.scrollIntoView)Element.prototype.scrollIntoView=()=>{};
if(!globalThis.ResizeObserver)vi.stubGlobal('ResizeObserver',class {observe(){}unobserve(){}disconnect(){}});
