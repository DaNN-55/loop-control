import {useEffect,useId,useRef,useState} from 'react';
import {Check,ChevronDown,Minus} from 'lucide-react';
import {uiText} from '../i18n/ui';
import {WorkspacePopover} from './WorkspacePopover';
import type {workspaceShotPreparation,WorkspacePreparationTarget} from './workspaceShotPreparation';
import './workspace-shot-preparation-status.css';

interface Props {preparation:ReturnType<typeof workspaceShotPreparation>;shotLabel:string;onNavigate?:(target:WorkspacePreparationTarget)=>void}
/** Interest previews never steal focus; clicking pins the same inspectable list. */
export function WorkspaceShotPreparationStatus({preparation,shotLabel,onNavigate}:Props){
 const [mode,setMode]=useState<'hover'|'focus'|'pinned'|null>(null),trigger=useRef<HTMLButtonElement>(null),popover=useRef<HTMLElement>(null),dismissed=useRef(false),timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
 const id=useId(),heading=id+'-heading',open=mode!==null;
 function cancelClose(){clearTimeout(timer.current);}
 function focusInside(){return trigger.current===document.activeElement||!!popover.current?.contains(document.activeElement);}
 function preview(){cancelClose();dismissed.current=false;setMode(previous=>previous??'hover');}
 function leave(){dismissed.current=false;cancelClose();timer.current=setTimeout(()=>setMode(previous=>previous==='pinned'||focusInside()?previous:null),160);}
 function close(restore=false){cancelClose();dismissed.current=true;setMode(null);if(restore)trigger.current?.focus();}
 useEffect(()=>()=>clearTimeout(timer.current),[]);
 useEffect(()=>{
  if(!open)return;
  // React Aria deliberately disables light-dismiss for non-modal previews.
  const outside=(event:PointerEvent)=>{if(event.target instanceof Node&&!trigger.current?.contains(event.target)&&!popover.current?.contains(event.target))close();};
  document.addEventListener('pointerdown',outside,true);return()=>document.removeEventListener('pointerdown',outside,true);
 },[open]);
 return <span className="workspace-shot-preparation" onMouseEnter={preview} onMouseLeave={leave} onClick={event=>event.stopPropagation()} onKeyDown={event=>event.stopPropagation()} onDragStart={event=>{event.preventDefault();event.stopPropagation();}}>
  <button ref={trigger} type="button" draggable={false} className={`workspace-shot-preparation-trigger is-${preparation.tone}`} aria-label={uiText('{value0}准备情况：{value1}',{value0:shotLabel,value1:uiText(preparation.label)})} aria-expanded={open} aria-controls={open?id:undefined}
   onFocus={()=>{cancelClose();if(!dismissed.current)setMode(previous=>previous??'focus');}} onBlur={leave}
   onClick={()=>{dismissed.current=false;if(mode==='pinned')close();else{cancelClose();setMode('pinned');}}}
   onKeyDown={event=>{
    if(event.key==='Escape'){event.preventDefault();close(true);}
    else if(open&&!event.altKey&&(event.key==='ArrowDown'||event.key==='Tab'&&!event.shiftKey)){
     const first=popover.current?.querySelector<HTMLButtonElement>('button[data-preparation-target]');if(first){event.preventDefault();cancelClose();first.focus();}
    }
   }}><span>{uiText(preparation.label)}</span><ChevronDown size={10} aria-hidden="true"/></button>
  <WorkspacePopover ref={popover} triggerRef={trigger} isOpen={open} onOpenChange={next=>{if(!next)close();}} isNonModal placement="bottom end" offset={4} containerPadding={12} shouldFlip className="dan-ui product-ui workspace-shot-preparation-popover"
  >
   <div id={id} role="group" aria-labelledby={heading} onMouseEnter={cancelClose} onMouseLeave={leave} onFocus={cancelClose} onBlur={leave} onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close(true);}}}><h4 id={heading}>{shotLabel}{uiText('准备情况')}</h4>
   <ul role="list">{preparation.items.map(item=>{
    const body=<><span>{uiText(item.label)}</span><span className="workspace-preparation-item-state">{uiText(item.statusLabel)}{item.status==='complete'?<Check size={13} aria-hidden="true"/>:item.status==='disabled'?<Minus size={13} aria-hidden="true"/>:<span className="workspace-preparation-pending-dot" aria-hidden="true"/>}</span></>;
    return <li key={item.id} data-state={item.status}>{onNavigate?<button type="button" data-preparation-target={item.id} title={uiText(item.detail)} onClick={()=>{close(true);onNavigate(item.id);}}>{body}</button>:<div title={uiText(item.detail)}>{body}</div>}</li>;
   })}</ul></div>
  </WorkspacePopover>
 </span>;
}
