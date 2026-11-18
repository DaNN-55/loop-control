import {useEffect,useRef,type KeyboardEvent} from 'react';
import {Plus} from 'lucide-react';
import type {ScriptStudioConversationSession} from '../scriptStudio';
import {uiText} from '../i18n/ui';
import './script-studio-conversations.css';
interface Props {items:readonly ScriptStudioConversationSession[];activeId:string|null;onSelect:(id:string|null)=>void;onCreate:()=>unknown;disabled?:boolean;creating?:boolean}
export function ScriptStudioConversations({items,activeId,onSelect,onCreate,disabled=false,creating=false}:Props){
 const row=useRef<HTMLDivElement>(null);
 function reveal(button:HTMLButtonElement){const node=row.current;if(!node)return;const left=button.offsetLeft,right=left+button.offsetWidth;if(left<node.scrollLeft)node.scrollLeft=left;else if(right>node.scrollLeft+node.clientWidth)node.scrollLeft=right-node.clientWidth;}
 useEffect(()=>{const selected=row.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"]');if(selected)reveal(selected);},[activeId,items.length]);
 useEffect(()=>{
  const node=row.current;if(!node)return;
  const wheel=(event:WheelEvent)=>{
   if(event.ctrlKey||Math.abs(event.deltaX)>=Math.abs(event.deltaY)||node.scrollWidth<=node.clientWidth)return;
   const delta=event.deltaY*(event.deltaMode===1?16:event.deltaMode===2?node.clientWidth:1),next=Math.max(0,Math.min(node.scrollWidth-node.clientWidth,node.scrollLeft+delta));
   if(next!==node.scrollLeft){event.preventDefault();node.scrollLeft=next;}
  };
  node.addEventListener('wheel',wheel,{passive:false});return()=>node.removeEventListener('wheel',wheel);
 },[]);
 function keydown(event:KeyboardEvent<HTMLDivElement>){
  if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
  const buttons=Array.from(row.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')??[]),index=buttons.indexOf(document.activeElement as HTMLButtonElement);if(index<0)return;
  const next=event.key==='Home'?0:event.key==='End'?buttons.length-1:Math.max(0,Math.min(buttons.length-1,index+(event.key==='ArrowRight'?1:-1)));
  event.preventDefault();buttons[next]?.focus();if(buttons[next])reveal(buttons[next]);
 }
 return <div ref={row} className="script-studio-conversations" role="group" aria-label={uiText('拍法对话')} onKeyDown={keydown}>
  {items.map(item=><button key={item.id??'legacy'} type="button" className="script-studio-conversation-button" aria-label={uiText('对话 {value0}',{value0:String(item.number)})} aria-pressed={item.id===activeId} disabled={disabled||creating} onClick={()=>onSelect(item.id)}>{item.number}</button>)}
  <button type="button" className="script-studio-conversation-button script-studio-conversation-new" aria-label={uiText(creating?'正在新开对话…':'新开对话')} disabled={disabled||creating} onClick={()=>void onCreate()}><Plus size={14} aria-hidden="true"/></button>
 </div>;
}
