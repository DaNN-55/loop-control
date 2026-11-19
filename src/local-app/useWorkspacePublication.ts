import {useEffect,useMemo,useState} from 'react';
import {localCommand,localRequest} from './client';
import {useWorkspaceOwnerId} from './WorkspaceDraft';
import {emptyPublicationContent,parsePublicationContent,type PublicationContent,type WorkspacePublication} from '../workspacePublication';

const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
interface EditingSession {
 active:boolean;state:WorkspacePublication|null;content:PublicationContent;error:string;storageError:boolean;
 blocked:boolean;sequence:number;saving:Promise<WorkspacePublication>|null;controller:AbortController;
}

/** Publication edits have their own revision; video changes never discard this draft. */
export function useWorkspacePublication(episodeId:string,workspaceId:string){
 const ownerId=useWorkspaceOwnerId(),[,render]=useState(0);
 const path=`episodes/${episodeId}/publication`,storageKey=ownerId?'loop-control.publication-draft:'+JSON.stringify([ownerId,episodeId,workspaceId]):'';
 const session=useMemo<EditingSession>(()=>({active:false,state:null,content:{...emptyPublicationContent,tags:[]},error:'',storageError:false,blocked:false,sequence:0,saving:null,controller:new AbortController()}),[ownerId,episodeId,workspaceId]);
 const changed=()=>{if(session.active)render(value=>value+1);};
 function persist(){
  if(!storageKey||!session.state)return;
  try{
   if(session.state&&same(session.content,session.state.content))localStorage.removeItem(storageKey);
   else localStorage.setItem(storageKey,JSON.stringify({revision:session.state?.revision??0,content:session.content}));
   session.storageError=false;
  }catch{session.storageError=true;}
 }
 async function load(discardLocal=false){
  const controller=session.controller;
  try{
   const value=await localRequest(path,{signal:controller.signal}) as WorkspacePublication;
   if(!session.active||controller.signal.aborted)return;
   if(value.workspaceId!==workspaceId||!Number.isSafeInteger(value.revision))throw Error('发布资料身份已变化，请重新打开生产单。');
   value.content=parsePublicationContent(value.content);session.state=value;session.content=value.content;session.error='';session.blocked=false;
   if(storageKey)try{
    const raw=localStorage.getItem(storageKey),draft=raw?JSON.parse(raw):null;
    if(draft&&discardLocal){localStorage.setItem(storageKey+':recovery',raw!);localStorage.removeItem(storageKey);}
    else if(draft&&!same(draft.content,value.content)){
     session.content=parsePublicationContent(draft.content);
     if(draft.revision!==value.revision){session.error='其他页面已有更新，当前输入仍保留。请先复制需要保留的修改，再读取最新资料。';session.blocked=true;}
    }
   }catch{session.storageError=true;}
   changed();
  }catch(cause){if(session.active&&!(cause instanceof Error&&cause.name==='AbortError')){session.error=cause instanceof Error?cause.message:'发布资料读取失败，请重试。';session.blocked=true;changed();}}
 }
 useEffect(()=>{
  session.active=true;session.controller=new AbortController();void load();
  return()=>{persist();session.active=false;session.controller.abort();};
 },[session]);
 function edit(content:PublicationContent){session.content=content;session.sequence++;session.blocked=false;session.error='';persist();changed();}
 function accept(value:WorkspacePublication,replace=true){
  if(!session.active||value.workspaceId!==workspaceId||session.state&&value.revision<session.state.revision)return;
  session.state=value;if(replace)session.content=value.content;session.error='';session.blocked=false;persist();changed();
 }
 async function flush():Promise<WorkspacePublication>{
  if(session.saving){await session.saving;return flush();}
  if(!session.active||!session.state)throw Error('发布资料尚未读取，请稍后重试。');
  if(session.blocked)throw Error(session.error||'发布资料尚未保存。');
  if(same(session.content,session.state.content))return session.state;
  const content=structuredClone(session.content),expectedRevision=session.state.revision,sequence=session.sequence;
  session.saving=localCommand<WorkspacePublication>('save',{expectedRevision,content},undefined,path);
  changed();
  try{const saved=await session.saving;if(session.active)accept(saved,session.sequence===sequence);return saved;}
  catch(cause){if(session.active){session.error=cause instanceof Error?cause.message:'发布资料保存失败，请重试。';session.blocked=true;persist();changed();}throw cause;}
  finally{session.saving=null;changed();}
 }
 const contentKey=JSON.stringify(session.content),revision=session.state?.revision;
 useEffect(()=>{
  if(!session.state||session.blocked||same(session.content,session.state.content))return;
  const timer=setTimeout(()=>{void flush().catch(()=>{});},450);
  return()=>clearTimeout(timer);
 },[session,contentKey,revision,session.blocked,!!session.saving]);
 async function mutate(command:string,data:Record<string,unknown>={}){
  const saved=await flush(),sequence=session.sequence;
  const value=await localCommand<WorkspacePublication>(command,{...data,expectedRevision:saved.revision},undefined,path);
  accept(value,session.sequence===sequence);return value;
 }
 return{state:session.state,content:session.content,error:session.error,storageError:session.storageError,saving:!!session.saving,dirty:!!session.state&&!same(session.content,session.state.content),edit,flush,accept,mutate,reload:()=>load(true),retry:()=>{session.blocked=false;session.error='';return flush();}};
}
