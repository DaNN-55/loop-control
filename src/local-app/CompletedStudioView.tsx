import {useEffect,useRef,useState} from 'react';
import {uiText} from '../i18n/ui';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import {CompletedDialog} from './CompletedDialog';
import {useWorkspaceLeaveEntry,useWorkspaceOwnerId} from './WorkspaceDraft';
import {useWorkspaceNavigation} from './catalogNavigation';
import type {ProductionCopyResult} from './completedProductionCopies';
import {localRequest} from './client';
import {completedCopyDocumentKey,type CompletedStudioCopy} from './completedStudioCopy';
import type {OpenChatCutProject} from '../worker/openchatcutProject';
import './completed-studio-view.css';

export function CompletedStudioView({episodeId,title,initialShotId,onClose,onSaved,returnLabel='返回分镜台'}:{episodeId:string;title:string;initialShotId?:string;onClose:(saved?:boolean)=>void;onSaved?:(copy:ProductionCopyResult)=>void;returnLabel?:string}){
 const mounted=useRef(true),kept=useRef(false),savedCopy=useRef<ProductionCopyResult|null>(null),owner=useWorkspaceOwnerId(),navigation=useWorkspaceNavigation(episodeId);
 const pendingKey=owner?'loop-control.production-copy-save:'+JSON.stringify([owner,episodeId]):'';
 const [recoveryId,setRecoveryId]=useState(''),[notice,setNotice]=useState('');
 function remember(id:string){try{if(pendingKey){if(id)localStorage.setItem(pendingKey,id);else localStorage.removeItem(pendingKey);}}catch{/* The server keeps the durable save intent even if local preference storage is unavailable. */}setRecoveryId(id);}
 function saved(copy:ProductionCopyResult){if(onSaved)onSaved(copy);else if(navigation?.openCopy)navigation.openCopy(copy.episodeId);else{const url=new URL(location.href);url.searchParams.set('view','episodes');url.searchParams.set('episode',copy.episodeId);url.searchParams.set('step','editing');location.assign(url.href);}}
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 const frame=useRef<HTMLIFrameElement>(null),[channel]=useState(()=>crypto.randomUUID());
 const [session,setSession]=useState<CompletedStudioCopy|null>(null),[attempt,setAttempt]=useState(0),[ready,setReady]=useState(false),[pending,setPending]=useState(false),[decision,setDecision]=useState(false),[error,setError]=useState('');
 const live=useRef<CompletedStudioCopy|null>(null),baseline=useRef<string|null>(null),writable=useRef(false),busy=useRef(false),closed=useRef(false),destination=useRef<(saved?:boolean)=>void>(onClose);
 const calls=useRef(new Map<string,{resolve:(value:unknown)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}>());
 const endpoint=`episodes/${episodeId}/studio-copy`;
 const api=(action:string,copyId:string)=>localRequest(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,copyId})});
 useEffect(()=>{
  let active=true,previous='';try{previous=pendingKey?localStorage.getItem(pendingKey)??'':'';}catch{/* Optional local recovery pointer. */}const copyId=previous||crypto.randomUUID();setRecoveryId(previous);setNotice('');savedCopy.current=null;setError('');setSession(null);live.current=null;baseline.current=null;closed.current=false;kept.current=false;writable.current=false;setReady(false);
  void api('open',copyId).then((copy:CompletedStudioCopy)=>{if(!active){void api('discard',copyId).catch(()=>{});return;}if(copy.copyId!==copyId)throw Error('查看副本身份不匹配。');live.current=copy;setSession(copy);}).catch(cause=>{if(active)setError(cause instanceof Error?cause.message:'查看副本打开失败。');});
  const timer=setInterval(()=>{if(active&&live.current&&!closed.current)void api('heartbeat',live.current.copyId).catch(cause=>setError(cause.message));},60000);
  return()=>{active=false;clearInterval(timer);if(live.current?.copyId===copyId&&!closed.current)void api('discard',copyId).catch(()=>{});};
 },[episodeId,attempt]);
 let src:string|undefined,origin:string|undefined;
 if(session){try{const url=new URL(session.studioUrl);if(url.protocol==='http:'&&url.hostname==='127.0.0.1'&&!url.username&&!url.password&&/^loop-control-[a-f0-9-]{36}$/.test(session.workspace.projectId)&&url.hash===`#/editor/${session.workspace.projectId}`){url.searchParams.set('lcParent',location.origin);url.searchParams.set('lcChannel',channel);url.searchParams.set('lcProject',session.workspace.projectId);src=url.href;origin=url.origin;}}catch{/* A malformed server URL never becomes a frame. */}}
 function command<T>(action:'inspect'|'flush'|'select',payload:Record<string,unknown>={}):Promise<T>{
  return new Promise((resolve,reject)=>{
   const copy=live.current;if(!copy||!origin||!frame.current?.contentWindow||!writable.current){reject(Error('编辑器尚未连接，请稍后重试。'));return;}
   const requestId=crypto.randomUUID(),timer=setTimeout(()=>{calls.current.delete(requestId);reject(Error('编辑器未确认操作，请保留当前窗口重试。'));},15000);
   calls.current.set(requestId,{resolve:value=>resolve(value as T),reject,timer});
   frame.current.contentWindow.postMessage({type:'loop-control:command',channel,projectId:copy.workspace.projectId,requestId,action,...payload},origin);
  });
 }
 const leaveRef=useRef<(action?:()=>void)=>void>(()=>{});
 useEffect(()=>{
  let active=true,initializing=false;
  async function initialize(shots?:Array<{id:string;itemIds:string[]}>){
   if(initializing||baseline.current!==null)return;initializing=true;
   try{const initial=await command<{document:OpenChatCutProject}>('inspect');if(!active)return;baseline.current=completedCopyDocumentKey(initial.document);const item=shots?.find(s=>s.id===initialShotId)?.itemIds[0];if(item)await command('select',{itemId:item});if(active)setReady(true);}
   catch(cause){if(active)setError(cause instanceof Error?cause.message:'副本读取失败。');}finally{initializing=false;}
  }
  function receive(event:MessageEvent){
   const data=event.data;if(event.source!==frame.current?.contentWindow||!origin||event.origin!==origin||!data||data.channel!==channel||data.projectId!==session?.workspace.projectId)return;
   if(data.type==='loop-control:state'){writable.current=data.writable===true;if(writable.current){setError(current=>current==='编辑器连接已关闭，可保存已自动保存的修改。'?'':current);if(baseline.current!==null)setReady(true);else void initialize(Array.isArray(data.shots)?data.shots:undefined);}else setReady(false);}
   if(data.type==='loop-control:result'){const call=calls.current.get(data.requestId);if(call){calls.current.delete(data.requestId);clearTimeout(call.timer);if(data.ok)call.resolve(data.result);else call.reject(Error(typeof data.error==='string'?data.error:'编辑器操作未完成。'));}}
   if(data.type==='loop-control:leave')leaveRef.current();
   if(data.type==='loop-control:closed'){
    writable.current=false;setReady(false);
    // The embed can tear down its initial bridge before it has opened a writable document.
    if(baseline.current!==null)setError('编辑器连接已关闭，可保存已自动保存的修改。');
   }
  }
  window.addEventListener('message',receive);return()=>{active=false;window.removeEventListener('message',receive);for(const call of calls.current.values()){clearTimeout(call.timer);call.reject(Error('查看副本已离开。'));}calls.current.clear();};
 },[origin,channel,session?.workspace.projectId]);
 async function finish(save:boolean){
  const copy=live.current,id=copy?.copyId??recoveryId;if(!id){destination.current();return;}
  busy.current=true;setPending(true);setError('');setNotice('');
  try{
   if(save&&!kept.current){
    if(writable.current)await command('flush');remember(id);
    const result=await api('keep',id) as ProductionCopyResult|{unchanged:true};
    if(result.unchanged){remember('');setNotice('没有视频内容修改，无需建立副本。');setDecision(false);return;}
    if(!result.episodeId||!result.workspaceId)throw Error('未收到新生产单身份，请保留当前窗口核对保存结果。');
    savedCopy.current=result;kept.current=true;
   }
   try{await api('discard',id);}catch(cause){if((cause as {status?:number}).status!==404)throw cause;}
   if(!mounted.current||copy&&live.current!==copy)return;
   closed.current=true;remember('');setDecision(false);
   if(save&&savedCopy.current)saved(savedCopy.current);else destination.current(false);
  }catch(cause){setError(cause instanceof Error?cause.message:'副本保存未完成，请保持窗口打开后重试。');}
  finally{busy.current=false;if(mounted.current)setPending(false);}
 }
 async function leave(action:(saved?:boolean)=>void=onClose){
  if(busy.current)return;destination.current=action;
  if(!live.current){action();return;}
  if(baseline.current===null){await finish(false);return;}if(!writable.current){setDecision(true);return;}
  busy.current=true;setPending(true);setError('');
  try{const current=await command<{document:OpenChatCutProject}>('inspect');if(completedCopyDocumentKey(current.document)===baseline.current){await finish(false);}else setDecision(true);}
  catch(cause){setError(cause instanceof Error?cause.message:'副本状态未确认。');setDecision(true);}
  finally{busy.current=false;if(mounted.current)setPending(false);}
 }
 leaveRef.current=action=>{void leave(action);};
 useWorkspaceLeaveEntry({dirty:()=>!!live.current&&!closed.current,keep:()=>false,discard:()=>{},beforeUnload:()=>{},requestLeave:action=>{void leave(action);}});
 return <section className="completed-studio-view" aria-label={uiText('OpenChatCut 查看副本')}>
  <header><Button size="sm" color="secondary" onPress={()=>void leave()} isDisabled={pending}>{uiText(returnLabel)}</Button><div><h3>{title}</h3><p>{uiText('查看副本，修改不会影响已完成生产单。')}</p></div><Button size="sm" color="secondary" isDisabled={(baseline.current===null&&!ready)||pending} onPress={()=>{destination.current=onClose;void finish(true);}}>{uiText(pending?'处理中…':'保存为新生产单')}</Button></header>
  {notice&&<p role="status">{uiText(notice)}</p>}
  {recoveryId&&<p role="status">{uiText('上次保存尚未确认。')}<Button size="sm" color="secondary" isDisabled={pending} onPress={()=>void finish(true)}>{uiText('继续保存副本')}</Button></p>}
  {error&&<p role="alert" className="form-error">{uiText(error)}{!session&&<Button size="sm" color="secondary" onPress={()=>setAttempt(n=>n+1)}>{uiText('重新打开')}</Button>}</p>}
  {!session&&!error&&<p role="status">{uiText('正在准备查看副本…')}</p>}
  {session&&!src&&<p role="alert">{uiText('查看副本地址或身份不匹配，未加载编辑器。')}</p>}
  {src&&<div className="completed-studio-frame"><iframe ref={frame} title={uiText('OpenChatCut 查看副本')} src={src} sandbox="allow-scripts allow-same-origin allow-downloads" allow="fullscreen" inert={!ready||pending||kept.current} tabIndex={ready?0:-1}/>{!ready&&<p role="status">{uiText('正在连接 OpenChatCut…')}</p>}</div>}
  <CompletedDialog open={decision} title={uiText('保留这次修改？')} onClose={()=>{if(!pending)setDecision(false);}}><p>{uiText('修改仅存在于查看副本中。')}</p>{error&&<p role="alert" className="form-error">{uiText(error)}</p>}<div className="completed-studio-decision"><Button size="sm" color="secondary" isDisabled={pending} onPress={()=>setDecision(false)}>{uiText('继续查看')}</Button><Button size="sm" color="secondary" isDisabled={pending} onPress={()=>void finish(false)}>{uiText('放弃修改并返回')}</Button><Button size="sm" color="primary" isDisabled={(baseline.current===null&&!ready)||pending} onPress={()=>void finish(true)}>{uiText('保存为新生产单')}</Button></div></CompletedDialog>
 </section>;
}
