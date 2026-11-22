import {Children,useEffect,useRef,useState,type CSSProperties,type ReactNode} from 'react';
import {uiText} from '../i18n/ui';
import './workspace-preparation-visual.css';

const storageKey='loop.production.preparation.listWidth.v1';
const defaultWidth=572,minWidth=572,rightMinWidth=360,dividerWidth=9;

/** The pane preference is independent of the table's fixed column widths. */
export function WorkspacePreparationLayout({children}:{children:ReactNode}){
 const grid=useRef<HTMLDivElement>(null),pointer=useRef<number|null>(null);
 const [width,setWidth]=useState(()=>{
  try{
   const saved=localStorage.getItem(storageKey);
   if(saved?.trim()&&Number.isFinite(Number(saved)))return Math.max(minWidth,Number(saved));
  }catch{/* Resizing also works without preference storage. */}
  return defaultWidth;
 });
 const [containerWidth,setContainerWidth]=useState(0),[dragging,setDragging]=useState(false);
 const maximum=Math.max(minWidth,(containerWidth||2000)-rightMinWidth-dividerWidth);
 const actualWidth=Math.min(width,maximum);
 useEffect(()=>{
  const element=grid.current!;
  const measure=()=>setContainerWidth(element.getBoundingClientRect().width);
  measure();
  const observer=typeof ResizeObserver==='undefined'?null:new ResizeObserver(measure);
  observer?.observe(element);window.addEventListener('resize',measure);
  return()=>{observer?.disconnect();window.removeEventListener('resize',measure);};
 },[]);
 useEffect(()=>{try{localStorage.setItem(storageKey,String(width));}catch{/* Optional local preference. */}},[width]);
 const panes=Children.toArray(children);
 function resize(value:number){setWidth(Math.max(minWidth,Math.min(maximum,value)));}
 function stopDragging(){pointer.current=null;setDragging(false);}
 return <div ref={grid} className={'workspace-preparation-grid is-fixed is-resizable'+(dragging?' is-resizing':'')} style={{'--workspace-list-size':actualWidth+'px'} as CSSProperties}>
  {panes[0]}
  <div className="workspace-preparation-resizer" role="separator" tabIndex={0}
   aria-label={uiText('调整镜头列表宽度')} aria-orientation="vertical" aria-valuemin={minWidth} aria-valuemax={maximum} aria-valuenow={Math.round(actualWidth)}
   title={uiText('拖动调整宽度；双击恢复默认；方向键微调')}
   onPointerDown={event=>{
    if(event.button!==0)return;
    event.preventDefault();pointer.current=event.pointerId;
    event.currentTarget.focus();event.currentTarget.setPointerCapture?.(event.pointerId);setDragging(true);
   }}
   onPointerMove={event=>{
    if(pointer.current!==event.pointerId)return;
    const bounds=grid.current!.getBoundingClientRect();
    if(bounds.width>0)resize(event.clientX-bounds.left);
   }}
   onPointerUp={stopDragging} onPointerCancel={stopDragging} onLostPointerCapture={stopDragging}
   onDoubleClick={()=>resize(defaultWidth)}
   onKeyDown={event=>{
    if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
    event.preventDefault();resize(event.key==='Home'?minWidth:event.key==='End'?maximum:actualWidth+(event.key==='ArrowLeft'?-16:16));
   }}><span aria-hidden="true"/></div>
  {panes.slice(1)}
 </div>;
}
