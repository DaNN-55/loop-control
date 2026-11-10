import {createContext,useContext,useLayoutEffect,useMemo,useRef,useState,type ReactNode,type RefObject} from 'react';

interface Presence {present:boolean;ref:RefObject<HTMLDivElement|null>}
const SurfaceContext=createContext<Presence|null>(null);
export function useSurfacePresence(){return useContext(SurfaceContext);}

/** Retain only the exiting surface; actions and focus follow the caller's state immediately. */
export function SurfacePresence({children,kind}:{children:ReactNode;kind:'confirmation'|'toast'}){
 const present=!!children;
 const [retained,setRetained]=useState(children);
 if(present&&children!==retained)setRetained(children);
 const ref=useRef<HTMLDivElement>(null),animations=useRef<Animation[]>([]);
 const context=useMemo(()=>({present,ref}),[present]);
 useLayoutEffect(()=>{
  const surface=ref.current;if(!surface){if(!present)setRetained(null);return;}
  const card=kind==='confirmation'?surface.querySelector<HTMLElement>('.confirmation-modal'):null;
  const targets=card?[surface,card]:[surface];
  const preference=window.matchMedia?.('(prefers-reduced-motion: reduce)');
  const frames=targets.map(target=>{
   const continuing=animations.current.some(animation=>(animation.effect as KeyframeEffect|null)?.target===target);
   const style=getComputedStyle(target),from={opacity:continuing||!present?style.opacity:'0',...(target===card||kind==='toast'?{transform:continuing||!present?style.transform:kind==='toast'?'translateY(6px)':'scale(.98)'}:{})};
   const to={opacity:present?'1':'0',...(target===card||kind==='toast'?{transform:present?'none':kind==='toast'?'translateY(6px)':'scale(.98)'}:{})};
   return [from,to];
  });
  // Snapshot before cancel so a replacement during exit continues from its visible position.
  animations.current.forEach(animation=>animation.cancel());
  if(preference?.matches||typeof surface.animate!=='function'){if(!present)setRetained(null);return;}
  const duration=kind==='confirmation'?(present?180:120):(present?150:100);
  const running=targets.map((target,index)=>target.animate(frames[index],{duration,easing:present?'ease-out':'ease-in',fill:'both'}));
  animations.current=running;
  let active=true;
  const reduce=()=>{if(preference?.matches)running.forEach(animation=>animation.finish());};
  preference?.addEventListener('change',reduce);
  void Promise.allSettled(running.map(animation=>animation.finished)).then(()=>{if(active&&!present)setRetained(null);});
  return()=>{active=false;preference?.removeEventListener('change',reduce);};
 },[present,kind]);
 useLayoutEffect(()=>()=>animations.current.forEach(animation=>animation.cancel()),[]);
 return <SurfaceContext.Provider value={context}>{present?children:retained}</SurfaceContext.Provider>;
}
