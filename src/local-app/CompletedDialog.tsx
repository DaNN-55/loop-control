import {useEffect,useId,useRef,type ReactNode} from 'react';
import {X} from 'lucide-react';
import {uiText} from '../i18n/ui';

/** Native modal semantics, top layer and focus return; no editor or persistence. */
export function CompletedDialog({open,title,onClose,children,drawer=false}:{open:boolean;title:string;onClose:()=>void;children:ReactNode;drawer?:boolean}){
 const dialog=useRef<HTMLDialogElement>(null),programmatic=useRef(false),heading=useId();
 useEffect(()=>{
  const element=dialog.current;if(!element)return;
  if(open&&!element.open){programmatic.current=false;element.showModal();}
  if(!open&&element.open){programmatic.current=true;element.close();}
 },[open]);
 return <dialog ref={dialog} role="dialog" aria-modal={open||undefined} aria-labelledby={heading} className={`completed-dialog${drawer?' completed-shot-drawer':''}`} onClose={event=>{if(event.target!==event.currentTarget)return;if(programmatic.current){programmatic.current=false;return;}onClose();}}>
  <header><h3 id={heading}>{title}</h3><button type="button" autoFocus aria-label={uiText(drawer?'关闭镜头详情':'关闭详情')} onClick={()=>dialog.current?.close()}><X size={18} aria-hidden="true"/></button></header>
  <div className="completed-dialog-body">{open?children:null}</div>
 </dialog>;
}
