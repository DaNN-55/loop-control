import {useEffect,useRef,useState} from 'react';
import {scriptStudioMaxCharacters,validateStudioDuration,type ScriptStudioConversationSession} from '../scriptStudio';
import {localCommand,localRequest} from './client';
import {useWorkspaceOwnerId} from './WorkspaceDraft';
interface Props {episodeId:string;scriptRevisionId:string|null;source:string;targetDuration:number|null;disabled:boolean}
interface State {key:string;items:ScriptStudioConversationSession[];activeId:string|null;loading:boolean;creating:boolean;loaded:boolean;error:string}
export function useScriptStudioSessions({episodeId,scriptRevisionId,source,targetDuration,disabled}:Props){
 const owner=useWorkspaceOwnerId();let valid=true;try{validateStudioDuration(targetDuration);}catch{valid=false;}
 const enabled=!!owner&&!disabled&&valid&&!!source.trim()&&Array.from(source).length<=scriptStudioMaxCharacters;
 const data={episodeId,expectedScriptRevisionId:scriptRevisionId,text:source,targetDuration},key=JSON.stringify([owner,episodeId,scriptRevisionId,source,targetDuration]);
 const preference='loop-control.script-studio-conversation:'+key;
 const empty=():State=>({key,items:[],activeId:null,loading:enabled,creating:false,loaded:false,error:''});
 const [stored,setStored]=useState<State>(empty),state=stored.key===key?stored:empty();
 const effectKey=useRef<string|null>(null),visit=useRef({key,enabled,sequence:0,creating:false,active:true,state});visit.current.key=key;visit.current.enabled=enabled;visit.current.state=state;
 const current=(sequence:number)=>visit.current.active&&visit.current.key===key&&visit.current.sequence===sequence;
 function remember(id:string|null){try{localStorage.setItem(preference,id??'legacy');}catch{/* Selection still works if local storage is unavailable. */}}
 function saved():string|null|undefined{try{const id=localStorage.getItem(preference);return id==='legacy'?null:id??undefined;}catch{return undefined;}}
 async function refresh(){
  if(!enabled||visit.current.creating)return;const sequence=++visit.current.sequence;setStored({...visit.current.state,key,loading:true,error:''});
  try{
   const value=await localRequest('script-studio',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({command:'conversations',data})}) as {conversations:ScriptStudioConversationSession[]};
   if(!current(sequence)||!visit.current.enabled)return;if(!Array.isArray(value.conversations))throw Error('对话列表读取失败，请重试。');
   const wanted=visit.current.state.loaded?visit.current.state.activeId:saved(),items=value.conversations;
   const activeId=items.find(item=>item.id===wanted)?.id??(wanted===null&&items.some(item=>item.id===null)?null:items.at(-1)?.id??null);
   setStored({key,items,activeId,loading:false,creating:false,loaded:true,error:''});remember(activeId);
  }catch(cause){if(current(sequence))setStored({...visit.current.state,key,loading:false,error:cause instanceof Error?cause.message:'对话列表读取失败。'});}
 }
 function select(id:string|null){if(!enabled||state.loading||state.creating||visit.current.creating||!state.items.some(item=>item.id===id))return;remember(id);setStored({...state,activeId:id,error:''});}
 async function create(){
  if(!enabled||!state.loaded||state.loading||visit.current.creating)return;visit.current.creating=true;const sequence=++visit.current.sequence;
  setStored({...state,creating:true,error:''});
  try{
   const item=await localCommand<ScriptStudioConversationSession>('newConversation',data,undefined,'script-studio');
   if(!current(sequence))return;if(!item||typeof item.id!=='string'||!Number.isInteger(item.number))throw Error('新对话读取失败，请刷新核对。');
   const items=[...visit.current.state.items.filter(value=>value.id!==item.id),item].sort((a,b)=>a.number-b.number);remember(item.id);
   setStored({key,items,activeId:item.id,loading:false,creating:false,loaded:true,error:''});return item;
  }catch(cause){if(current(sequence))setStored({...visit.current.state,creating:false,error:cause instanceof Error?cause.message:'新对话未完成，请核对后重试。'});}
  finally{if(current(sequence))visit.current.creating=false;}
 }
 useEffect(()=>{visit.current.active=true;return()=>{visit.current.active=false;visit.current.sequence++;};},[]);
 useEffect(()=>{
  const changed=effectKey.current!==key;effectKey.current=key;
  if(changed){visit.current.sequence++;visit.current.creating=false;setStored(empty());}
  if(!enabled){if(!changed)setStored(previous=>previous.key===key?{...previous,loading:false}:previous);return;}
  if(!changed&&visit.current.state.loaded)return;
  const timer=setTimeout(()=>void refresh(),250);return()=>clearTimeout(timer);
 },[key,enabled]);
 return{items:state.items,activeId:state.activeId,loading:enabled&&(state.loading||!state.loaded&&!state.error),creating:state.creating,error:state.error,refresh,create,select};
}
