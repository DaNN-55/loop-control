// Throwaway dev-only switcher, shared by local UI prototypes.
import { useEffect } from 'react';
import { ArrowLeft, ArrowRight, RotateCcw } from 'lucide-react';
export function PrototypeSwitcher({variants,current,onChange,onReset,children}:{variants:Array<{key:string;name:string}>;current:string;onChange:(key:string)=>void;onReset:()=>void;children?:React.ReactNode}) {
  function cycle(delta:number){onChange(variants[(variants.findIndex(v=>v.key===current)+delta+variants.length)%variants.length].key);}
  useEffect(()=>{function key(event:KeyboardEvent){if(event.altKey||event.ctrlKey||event.metaKey||(event.target instanceof Element&&event.target.closest('input,textarea,select,[contenteditable],[role="slider"]')))return;if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();cycle(event.key==='ArrowLeft'?-1:1);}}window.addEventListener('keydown',key,true);return()=>window.removeEventListener('keydown',key,true);});
  if(!import.meta.env.DEV)return null;
  return <aside className="fsw-switcher" aria-label="原型方案切换"><span className="fsw-demo-tag">DEMO</span><button aria-label="上一个方案" onClick={()=>cycle(-1)}><ArrowLeft size={16}/></button><div className="fsw-variant-options">{variants.map(v=><button key={v.key} aria-pressed={v.key===current} onClick={()=>onChange(v.key)}>{v.key}<span>{v.name}</span></button>)}</div><button aria-label="下一个方案" onClick={()=>cycle(1)}><ArrowRight size={16}/></button><i/><button aria-label="重置演示" onClick={onReset}><RotateCcw size={15}/></button>{children}</aside>;
}
