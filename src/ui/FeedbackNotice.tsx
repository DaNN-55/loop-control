import {createContext,useCallback,useContext,useEffect,useId,useLayoutEffect,useMemo,useRef,useState,type ReactNode} from 'react';
import {createPortal} from 'react-dom';
import {AlertCircle,Check,Info,X} from 'lucide-react';
import {uiText} from '../i18n/ui';
import {Button} from './dan-ui/components/base/buttons/button';
import './feedback-notice.css';

interface FeedbackProps {message:string;identity?:string|number;onceKey?:string;label?:string;tone?:'success'|'info'|'warning'|'error';duration?:number|null;onDismiss?:()=>void;children?:ReactNode;closeLabel?:string}
interface Entry extends Required<Pick<FeedbackProps,'message'|'label'|'tone'|'duration'>> {id:string;identity?:string|number;onceKey?:string;actions:()=>ReactNode;dismiss:()=>void;closeLabel:string}
const FeedbackContext=createContext<{add:(entry:Entry)=>void;remove:(id:string)=>void}|null>(null);
const modalSelector='dialog[open],[role="dialog"][aria-modal="true"],[role="alertdialog"][aria-modal="true"]';
function hasModal(){return [...document.querySelectorAll<HTMLElement>(modalSelector)].some(node=>!node.closest('[hidden],[inert],[aria-hidden="true"]'));}

/** One visual lane; callers retain business state and all recovery actions. */
export function FeedbackProvider({children}:{children:ReactNode}){
 const [entries,setEntries]=useState<Entry[]>([]),[blocked,setBlocked]=useState(hasModal),layer=useRef<HTMLDivElement>(null),seen=useRef(new Set<string>());
 const add=useCallback((entry:Entry)=>{if(entry.onceKey&&seen.current.has(entry.onceKey))return;setEntries(previous=>[...previous.filter(item=>item.id!==entry.id),entry]);},[]);
 const remove=useCallback((id:string)=>setEntries(previous=>previous.some(item=>item.id===id)?previous.filter(item=>item.id!==id):previous),[]);
 const context=useMemo(()=>({add,remove}),[add,remove]);
 useEffect(()=>{let previous=hasModal();setBlocked(previous);const check=()=>{const next=hasModal();if(next!==previous){previous=next;setBlocked(next);}},observer=new MutationObserver(check);observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['open','hidden','inert','aria-hidden','aria-modal']});return()=>observer.disconnect();},[]);
 const groups:Entry[][]=[];
 for(const entry of [...entries].sort((a,b)=>Number(b.duration===null)-Number(a.duration===null))){const group=groups.find(group=>group[0].message===entry.message&&group[0].tone===entry.tone&&group[0].label===entry.label);if(group)group.push(entry);else groups.push([entry]);}
 const visible=!blocked&&groups.length>0;
 // A completed modal action may register its error in the same commit that closes the modal.
 useLayoutEffect(()=>{const next=hasModal();if(next!==blocked)setBlocked(next);});
 useLayoutEffect(()=>{const node=layer.current;if(!node||typeof node.showPopover!=='function')return;if(visible&&!node.matches(':popover-open'))node.showPopover();else if(!visible&&node.matches(':popover-open'))node.hidePopover();},[visible]);
 const nativeAnnounce=typeof (document as Document&{ariaNotify?:unknown}).ariaNotify==='function';
 return <FeedbackContext.Provider value={context}>{children}{createPortal(<div aria-live={nativeAnnounce?'off':'polite'} aria-atomic="false"><div ref={layer} popover="manual" role="region" aria-label={uiText('通知')} className="dan-ui product-ui app-feedback-region" hidden={!visible}>
  {!blocked&&groups.slice(0,3).map(group=>{const first=group[0];return <FeedbackCard key={first.id+':'+String(first.identity)+':'+first.message} entry={first} onDismiss={()=>{for(const item of group){if(item.onceKey)seen.current.add(item.onceKey);remove(item.id);item.dismiss();}}}/>;})}
 </div></div>,document.body)}</FeedbackContext.Provider>;
}

export function FeedbackNotice(props:FeedbackProps){const context=useContext(FeedbackContext);return context?<FeedbackRegistration {...props}/>:<FeedbackProvider><FeedbackRegistration {...props}/></FeedbackProvider>;}
function FeedbackRegistration({message,identity,onceKey,label='操作提示',tone='success',duration=4000,onDismiss,children,closeLabel='关闭操作提示'}:FeedbackProps){
 const context=useContext(FeedbackContext)!,id=useId(),anchor=useRef<HTMLSpanElement>(null),latest=useRef({children,onDismiss}),[placement,setPlacement]=useState({local:false,active:false});
 latest.current={children,onDismiss};
 useLayoutEffect(()=>{const parent=anchor.current?.parentElement;if(!parent)return;const check=()=>{const next={local:!!parent.closest(modalSelector),active:!parent.closest('[hidden]')};setPlacement(previous=>previous.local===next.local&&previous.active===next.active?previous:next);},observer=new MutationObserver(check);for(let node:HTMLElement|null=parent;node;node=node.parentElement)observer.observe(node,{attributes:true,attributeFilter:['hidden','aria-modal','open']});check();return()=>observer.disconnect();},[]);
 useEffect(()=>{if(!message||placement.local||!placement.active)return;context.add({id,message,identity,onceKey,label,tone,duration,closeLabel,actions:()=>latest.current.children,dismiss:()=>latest.current.onDismiss?.()});return()=>context.remove(id);},[context,id,message,identity,onceKey,label,tone,duration,closeLabel,placement]);
 // Feedback originating inside a modal stays with its controls, never in an inaccessible outside toast.
 return <><span ref={anchor} hidden/>{placement.local&&placement.active&&message&&<LocalFeedback key={String(identity)+message} message={message} duration={duration} onDismiss={onDismiss}/>}</>;
}
function LocalFeedback({message,duration,onDismiss}:{message:string;duration:number|null;onDismiss?:()=>void}){const [shown,setShown]=useState(true),callback=useRef(onDismiss);callback.current=onDismiss;useEffect(()=>{if(duration===null)return;const timer=setTimeout(()=>{setShown(false);callback.current?.();},duration);return()=>clearTimeout(timer);},[duration]);return shown?<span role="status" className="app-action-feedback">{uiText(message)}</span>:null;}

function FeedbackCard({entry,onDismiss}:{entry:Entry;onDismiss:()=>void}){
 const node=useRef<HTMLDivElement>(null),priorFocus=useRef(document.activeElement),remaining=useRef(entry.duration),[hovered,setHovered]=useState(false),[focused,setFocused]=useState(false),[hidden,setHidden]=useState(document.hidden),dismiss=useRef(onDismiss);dismiss.current=onDismiss;
 useEffect(()=>{const changed=()=>setHidden(document.hidden);document.addEventListener('visibilitychange',changed);return()=>document.removeEventListener('visibilitychange',changed);},[]);
 useEffect(()=>{if(remaining.current===null||hovered||focused||hidden)return;const start=Date.now(),timer=setTimeout(()=>dismiss.current(),Math.max(0,remaining.current));return()=>{clearTimeout(timer);if(remaining.current!==null)remaining.current=Math.max(0,remaining.current-(Date.now()-start));};},[hovered,focused,hidden]);
 const announcingDocument=document as Document&{ariaNotify?:(message:string,options:{priority:'high'|'normal'})=>void},nativeAnnounce=typeof announcingDocument.ariaNotify==='function';
 useEffect(()=>{if(nativeAnnounce)announcingDocument.ariaNotify?.(uiText(entry.message)+(entry.actions()?uiText('，有可用操作。'):''),{priority:entry.tone==='error'?'high':'normal'});},[entry.message,entry.tone,nativeAnnounce]);
 function close(){const ownsFocus=node.current?.contains(document.activeElement);dismiss.current();if(ownsFocus){const next=node.current?.parentElement?.querySelector<HTMLElement>('.app-feedback-card:not(:focus-within) button');const prior=priorFocus.current;queueMicrotask(()=>{if(next?.isConnected)next.focus();else if(prior instanceof HTMLElement&&prior.isConnected)prior.focus();});}}
 const Icon=entry.tone==='success'?Check:entry.tone==='info'?Info:AlertCircle;
 return <div ref={node} role={entry.tone==='error'?'alert':'status'} aria-label={uiText(entry.label)} aria-live={nativeAnnounce?'off':entry.tone==='error'?'assertive':'polite'} aria-atomic="true" className="app-feedback-card" data-tone={entry.tone} onMouseEnter={()=>setHovered(true)} onMouseLeave={()=>setHovered(false)} onFocusCapture={()=>setFocused(true)} onBlurCapture={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node|null))setFocused(false);}}>
  <Icon size={17} aria-hidden="true"/><p>{uiText(entry.message)}</p><div className="app-feedback-actions">{entry.actions()}<Button size="xs" color="tertiary" aria-label={uiText(entry.closeLabel)} iconLeading={X} onPress={close}/></div>
 </div>;
}
