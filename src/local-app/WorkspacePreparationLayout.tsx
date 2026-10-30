import {Children,useEffect,useRef,useState,type CSSProperties,type ReactNode} from 'react';

const storageKey='loop.production.preparation.listRatio.v1',defaultRatio=41;
const clamp=(value:number)=>Math.max(20,Math.min(75,value));
export function WorkspacePreparationLayout({children}:{children:ReactNode}){
 const [ratio,setRatio]=useState(()=>{try{const saved=localStorage.getItem(storageKey);return saved!==null&&Number.isFinite(Number(saved))?clamp(Number(saved)):defaultRatio;}catch{return defaultRatio;}}),[dragging,setDragging]=useState(false);
 const grid=useRef<HTMLDivElement>(null),pointer=useRef<number|null>(null);
 useEffect(()=>{try{localStorage.setItem(storageKey,String(ratio));}catch{/* A blocked preference store does not prevent resizing. */}},[ratio]);
 const panes=Children.toArray(children);
 function move(clientX:number){const bounds=grid.current!.getBoundingClientRect();if(bounds.width<=0)return;const pixels=Math.max(280,Math.min(bounds.width-369,clientX-bounds.left));setRatio(clamp(pixels/bounds.width*100));}
 return <div ref={grid} className={'workspace-preparation-grid is-resizable'+(dragging?' is-resizing':'')} style={{'--workspace-list-size':ratio+'%'} as CSSProperties}>
  {panes[0]}
  <div className="workspace-preparation-resizer" role="separator" tabIndex={0} aria-label="调整镜头列表宽度" aria-orientation="vertical" aria-valuemin={20} aria-valuemax={75} aria-valuenow={Math.round(ratio)} aria-valuetext={`镜头列表 ${Math.round(ratio)}%`} title="拖动调整宽度；双击恢复默认；方向键微调"
   onPointerDown={e=>{if(e.button!==0)return;e.preventDefault();pointer.current=e.pointerId;e.currentTarget.focus();e.currentTarget.setPointerCapture?.(e.pointerId);setDragging(true);}}
   onPointerMove={e=>{if(pointer.current===e.pointerId)move(e.clientX);}}
   onPointerUp={e=>{if(pointer.current===e.pointerId){pointer.current=null;setDragging(false);}}}
   onPointerCancel={()=>{pointer.current=null;setDragging(false);}}
   onLostPointerCapture={()=>{pointer.current=null;setDragging(false);}}
   onDoubleClick={()=>setRatio(defaultRatio)}
   onKeyDown={e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();setRatio(value=>e.key==='Home'?20:e.key==='End'?75:clamp(value+(e.key==='ArrowLeft'?-2:2)));}}><span aria-hidden="true"/></div>
  {panes.slice(1)}
 </div>;
}
