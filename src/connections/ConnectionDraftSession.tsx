import {createContext,useContext,useEffect,useRef,type ReactNode} from 'react';
import type {ExternalConnectionInput} from './ConnectionWorkspace';
import type {ConnectionModelDraft} from './ConnectionModelsDialog';
import type {MiniMaxRegion} from '../worker/videoProviderCatalog';
export type ConnectionEditDraft={baseline:string;name:string;description:string;adapter:ExternalConnectionInput['adapter'];workspaceId:string;region:MiniMaxRegion};
function createDrafts(){return {connections:new Map<string,ConnectionEditDraft>(),models:new Map<string,ConnectionModelDraft>()};}
const Context=createContext<ReturnType<typeof createDrafts>|null>(null);
/** Ephemeral, non-secret editing choices survive workspace navigation, never a reload or identity change. */
export function ConnectionDraftSession({children,onIdentityChange}:{children:ReactNode;onIdentityChange?:()=>void}){
 const drafts=useRef(createDrafts()),onIdentity=useRef(onIdentityChange);onIdentity.current=onIdentityChange;
 useEffect(()=>{const clear=()=>{drafts.current.connections.clear();drafts.current.models.clear();};const reset=()=>{clear();onIdentity.current?.();};window.addEventListener('loop-local-session-expired',reset);const channel=typeof window.BroadcastChannel==='function'?new BroadcastChannel('loop-local-identity'):null;if(channel)channel.onmessage=event=>{if(event.data?.kind==='changed')reset();};return()=>{window.removeEventListener('loop-local-session-expired',reset);channel?.close();clear();};},[]);
 return <Context.Provider value={drafts.current}>{children}</Context.Provider>;
}
export function useConnectionDrafts(){const shared=useContext(Context),local=useRef(createDrafts());return shared??local.current;}
