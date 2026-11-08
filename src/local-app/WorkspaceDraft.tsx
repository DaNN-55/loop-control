import {ConnectionDraftSession} from '../connections/ConnectionDraftSession';
import {ConnectionDraftLeaveDialog} from '../connections/ConnectionDraftLeaveDialog';
import {createContext,useCallback,useContext,useEffect,useMemo,useRef,useState,type ReactNode,type SetStateAction} from 'react';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import {useDialogFocus} from '../ui/useDialogFocus';
import './workspace-draft.css';

type DraftEntry={dirty:()=>boolean;keep:()=>boolean;discard:()=>void;beforeUnload?:()=>void;kind?:'connection'|'models';hasSecret?:()=>boolean};
type DraftGuard={register:(id:symbol,entry:DraftEntry)=>()=>void;request:(action:()=>void)=>boolean};
const immediate:DraftGuard={register:()=>()=>{},request:action=>{action();return true;}};
const GuardContext=createContext<DraftGuard>(immediate),OwnerContext=createContext('');
export function WorkspaceDraftOwner({ownerId,children}:{ownerId:string;children:ReactNode}){return <OwnerContext.Provider value={ownerId}>{children}</OwnerContext.Provider>;}
/** Put all navigation mutations inside the callback; false means a leave decision is pending. */
export function useWorkspaceDraftLeave(){return useContext(GuardContext).request;}
/** Register leave callbacks and non-secret context; edited field values stay with their owning form. */
export function useWorkspaceLeaveEntry(entry:DraftEntry){
 const guard=useContext(GuardContext),id=useRef(Symbol('workspace leave')),latest=useRef(entry);latest.current=entry;
 useEffect(()=>guard.register(id.current,{kind:entry.kind,dirty:()=>latest.current.dirty(),keep:()=>latest.current.keep(),discard:()=>latest.current.discard(),beforeUnload:()=>latest.current.beforeUnload?.(),hasSecret:()=>latest.current.hasSecret?.()??false}),[guard,entry.kind]);
}

function DraftLeaveDialog({onContinue,onKeep,onDiscard,error}:{onContinue:()=>void;onKeep:()=>void;onDiscard:()=>void;error:string}){
 const ref=useDialogFocus<HTMLDivElement>(true,onContinue);
 return <div className="modal-backdrop dan-ui product-ui impeccable-app workspace-draft-leave"><div ref={ref} role="dialog" aria-modal="true" aria-label="保留未提交内容" className="modal-card confirmation-modal"><header><h2>保留未提交内容</h2></header><div className="confirmation-modal-content"><p>脚本或交付内容尚未提交。</p><p>保留草稿后，可在本机继续编辑。</p><p>保留草稿不会确认脚本或生成交付包。</p><p>封面图片在关闭或刷新后需要重新选择。</p>{error&&<p role="alert" className="form-error">{error}</p>}</div><div className="modal-actions"><Button size="sm" color="secondary" data-dialog-initial-focus onPress={onContinue}>继续编辑</Button><Button size="sm" color="primary" onPress={onKeep}>保留草稿并离开</Button><Button size="sm" color="primary-destructive" onPress={onDiscard}>放弃修改并离开</Button></div></div></div>;
}
export function WorkspaceDraftProvider({children,ownerId=''}:{children:ReactNode;ownerId?:string}){
 const entries=useRef(new Map<symbol,DraftEntry>()),destination=useRef<(()=>void)|null>(null);
 const [prompt,setPrompt]=useState(false),[error,setError]=useState('');
 const [context,setContext]=useState<{kind:'connection'|'models';hasSecret:boolean}|null>(null);
 const guard=useMemo<DraftGuard>(()=>({register:(id,entry)=>{entries.current.set(id,entry);return()=>{entries.current.delete(id);};},request:action=>{if(![...entries.current.values()].some(entry=>entry.dirty())){action();return true;}destination.current=action;const specific=[...entries.current.values()].find(entry=>entry.dirty()&&entry.kind);setContext(specific?.kind?{kind:specific.kind,hasSecret:[...entries.current.values()].some(entry=>entry.dirty()&&entry.hasSecret?.())}:null);setError('');setPrompt(true);return false;}}),[]);
 useEffect(()=>{const beforeUnload=(event:BeforeUnloadEvent)=>{const dirty=[...entries.current.values()].filter(entry=>entry.dirty());if(!dirty.length)return;dirty.forEach(entry=>{if(entry.beforeUnload)entry.beforeUnload();else entry.keep();});event.preventDefault();event.returnValue='';};window.addEventListener('beforeunload',beforeUnload);return()=>window.removeEventListener('beforeunload',beforeUnload);},[]);
 function leave(keep:boolean){const dirty=[...entries.current.values()].filter(entry=>entry.dirty());if(keep&&dirty.some(entry=>!entry.keep())){setError('本机草稿保存失败，请继续编辑或明确放弃修改。');return;}if(!keep)dirty.forEach(entry=>entry.discard());const action=destination.current;destination.current=null;setPrompt(false);action?.();}
 return <ConnectionDraftSession onIdentityChange={()=>{destination.current=null;setPrompt(false);setContext(null);}}><GuardContext.Provider value={guard}><OwnerContext.Provider value={ownerId}>{children}{prompt&&(context?<ConnectionDraftLeaveDialog navigation hasSecret={context.hasSecret} onContinue={()=>{destination.current=null;setPrompt(false);}} onKeep={()=>leave(true)} onDiscard={()=>leave(false)}/>:<DraftLeaveDialog error={error} onContinue={()=>{destination.current=null;setPrompt(false);}} onKeep={()=>leave(true)} onDiscard={()=>leave(false)}/>)}</OwnerContext.Provider></GuardContext.Provider></ConnectionDraftSession>;
}

type Fields=Record<string,string>;
const prefix='loop-control.workspace-draft.v1:';
function readDraft<T extends Fields>(key:string,baseline:string,initial:T):T|null{try{const raw=localStorage.getItem(key);if(!raw)return null;const parsed=JSON.parse(raw);if(parsed?.baseline!==baseline||!parsed.value||typeof parsed.value!=='object')return null;const result={...initial};for(const name of Object.keys(initial)){if(typeof parsed.value[name]!=='string')return null;result[name as keyof T]=parsed.value[name] as T[keyof T];}return result;}catch{return null;}}
/** Only explicit non-secret text fields reach this local browser store. Files are never serialized. */
export function useWorkspaceDraft<T extends Fields>({episodeId,kind,version,initial,enabled=true}:{episodeId:string;kind:'script'|'delivery';version:string;initial:T;enabled?:boolean}){
 const ownerId=useContext(OwnerContext),guard=useContext(GuardContext),baseline=JSON.stringify(initial);
 const storageKey=ownerId?prefix+JSON.stringify([ownerId,episodeId,kind,version]):'';
 const identity=JSON.stringify([storageKey,baseline,enabled]);
 function load(){const restored=enabled&&storageKey?readDraft(storageKey,baseline,initial):null;return {identity,value:restored??initial,accepted:initial,restored:!!restored};}
 const [stored,setStored]=useState(load),state=stored.identity===identity?stored:load();
 if(stored.identity!==identity)setStored(state);
 const current=useRef({state,storageKey,baseline});current.current={state,storageKey,baseline};
 const [storageError,setStorageError]=useState(false),registration=useRef(Symbol('workspace draft')),lastWritten=useRef<{key:string;identity:string;raw:string}|null>(null);
 const dirty=enabled&&JSON.stringify(state.value)!==JSON.stringify(state.accepted);
 function persist(){const now=current.current;if(!now.storageKey)return false;try{const raw=JSON.stringify({baseline:now.baseline,value:now.state.value});if(lastWritten.current?.key===now.storageKey&&lastWritten.current.identity===now.state.identity&&lastWritten.current.raw===raw)return true;localStorage.setItem(now.storageKey,raw);lastWritten.current={key:now.storageKey,identity:now.state.identity,raw};return true;}catch{return false;}}
 function reset(){try{const written=lastWritten.current;if(storageKey&&written?.key===storageKey&&written.identity===identity&&localStorage.getItem(storageKey)===written.raw)localStorage.removeItem(storageKey);}catch{/* State remains editable if browser storage is unavailable. */}setStored({...state,value:state.accepted,restored:false});setStorageError(false);}
 const handlers=useRef({dirty:()=>dirty,keep:persist,discard:reset});handlers.current={dirty:()=>dirty,keep:persist,discard:reset};
 useEffect(()=>guard.register(registration.current,{dirty:()=>handlers.current.dirty(),keep:()=>handlers.current.keep(),discard:()=>handlers.current.discard()}),[guard]);
 useEffect(()=>{setStorageError(dirty&&storageKey?!persist():false);if(!dirty&&lastWritten.current?.key===storageKey&&lastWritten.current.identity===identity){try{if(localStorage.getItem(storageKey)===lastWritten.current.raw)localStorage.removeItem(storageKey);}catch{/* A browser storage failure leaves the current form intact. */}lastWritten.current=null;}},[identity,JSON.stringify(state.value),dirty]);
 const setValue=useCallback((next:SetStateAction<T>)=>{setStored(previous=>previous.identity===identity?{...previous,value:typeof next==='function'?next(previous.value):next}:previous);},[identity]);
 function acknowledge(snapshot:T,accepted:T=snapshot){const now=current.current;if(now.state.identity!==identity||JSON.stringify(now.state.value)!==JSON.stringify(snapshot))return false;try{if(storageKey){const raw=localStorage.getItem(storageKey);if(raw&&JSON.stringify(JSON.parse(raw).value)===JSON.stringify(snapshot))localStorage.removeItem(storageKey);}}catch{/* A failed clear must not erase newer input. */}setStored(previous=>previous.identity===identity&&JSON.stringify(previous.value)===JSON.stringify(snapshot)?{...previous,value:accepted,accepted,restored:false}:previous);return true;}
 return {scope:identity,value:state.value,setValue,reset,acknowledge,dirty,restored:state.restored,storageError};
}
