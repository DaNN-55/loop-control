import {useLayoutEffect,useRef} from 'react';

/** Keep the working area fixed; only compensate the outer scrollbar gutter. */
export function useWorkspaceCanvas(){
 const root=useRef<HTMLElement>(null),canvas=useRef<HTMLFieldSetElement>(null);
 useLayoutEffect(()=>{
  const scroller=root.current?.closest<HTMLElement>('.lc-production-workspace');if(!scroller)return;
  const update=()=>{const bounds=scroller.getBoundingClientRect();scroller.style.setProperty('--workspace-scrollbar-space',`${Math.max(0,bounds.width-scroller.clientWidth)}px`);};
  window.addEventListener('resize',update);
  const observer=typeof ResizeObserver==='undefined'?null:new ResizeObserver(update);observer?.observe(scroller);update();
  return()=>{window.removeEventListener('resize',update);observer?.disconnect();scroller.style.removeProperty('--workspace-scrollbar-space');};
 },[]);
 return{root,canvas};
}
