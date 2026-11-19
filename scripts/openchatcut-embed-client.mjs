import {saveProject,flushProjectSaves} from '/src/persist/projectStore.ts';
import {browserProjectOwnership} from '/src/persist/projectStoreTransport.ts';
import {readWorkspaceShots} from 'virtual:loop-control-structure';
import {useEffect,useRef} from 'react';
const query=new URLSearchParams(location.search);
const channel=query.get('lcChannel'),expectedProject=query.get('lcProject');
let parentOrigin=null;
try{const url=new URL(query.get('lcParent'));if(url.protocol==='http:'&&['127.0.0.1','localhost'].includes(url.hostname)&&!url.username&&!url.password)parentOrigin=url.origin;}catch{/* not an embedded launch */}
/** The host owns navigation and saving. All document edits and imports are native. */
export function useLoopControlHost(projectId,base,agent,panels){
 const live=useRef({base,agent});live.current={base,agent};
 const revision=useRef(0),reportedWritable=useRef(null);
 const active=parentOrigin&&parent!==window&&channel&&/^[a-f0-9-]{36}$/.test(channel)&&projectId===expectedProject;
 function emit(type,extra={}){if(active)parent.postMessage({type,channel,projectId,...extra},parentOrigin);}
 async function flushLiveDocument(){
  if(!await live.current.agent.flushBeforeLeaveRef.current())return false;
  const document=live.current.base.doc,saved=await saveProject(projectId,document);
  return saved.status==='saved'&&(await flushProjectSaves(projectId)).ok&&document===live.current.base.doc;
 }
 useEffect(()=>{
  if(!active)return;
  panels.setChatCollapsed(true);
  const hostStyle=document.createElement('style');hostStyle.textContent=':root .cc-inspector{position:static;inset:auto;width:min(260px,45%);flex:0 0 min(260px,45%);box-shadow:none}';document.head.append(hostStyle);
  async function message(event){
   const msg=event.data;
   if(event.source!==parent||event.origin!==parentOrigin||!msg||msg.type!=='loop-control:command'||msg.channel!==channel||msg.projectId!==projectId||typeof msg.requestId!=='string'||!/^[a-f0-9-]{36}$/.test(msg.requestId))return;
   const result=(ok,error,extra={})=>emit('loop-control:result',{requestId:msg.requestId,ok,...(error?{error}:{}),...extra});
   try{
    if(!['select','flush','inspect'].includes(msg.action)){result(false,'当前操作由原生剪辑器处理。');return;}
    if(!browserProjectOwnership(projectId)){result(false,'编辑器写连接尚未就绪或已变化，请保留当前编辑并重试。');return;}
    if(msg.action==='inspect'){
     result(true,undefined,{result:{document:structuredClone(live.current.base.doc)}});
    }else if(msg.action==='flush'){
     const ok=await flushLiveDocument();result(ok,ok?undefined:'编辑器仍有未保存修改，请在编辑器中重试保存。');
    }else{
     const item=live.current.base.state.items.find(i=>i.id===msg.itemId);
     if(!item){result(false,'当前工程中找不到该片段。');return;}
     live.current.base.commands.selectItem(item.id);live.current.agent.playerRef.current?.seekTo(item.startFrame);result(true);
    }
   }catch(cause){result(false,cause instanceof Error?cause.message:'编辑器操作未完成，当前修改仍保留。');}
  }
  window.addEventListener('message',message);
  return()=>{hostStyle.remove();window.removeEventListener('message',message);emit('loop-control:closed');};
 },[projectId,active]);
 function reportState(){
  if(!active)return;const base=live.current.base;reportedWritable.current=!!browserProjectOwnership(projectId);
  emit('loop-control:state',{writable:reportedWritable.current,revision:++revision.current,selectedIds:Array.from(base.selection.selectedIds??[]),shots:base.doc.loopControl?.version==='four-step-workspace/v1'?readWorkspaceShots(base.doc).filter(s=>s.timelineId===base.doc.activeTimelineId):undefined,items:base.state.items.map(i=>({id:i.id,startFrame:i.startFrame,durationInFrames:i.durationInFrames,kind:i.kind})),width:base.state.width,height:base.state.height});
 }
 const selectedItemKey=Array.from(base.selection.selectedIds??[]).join('\u0000');
 useEffect(()=>{reportState();},[base.doc,selectedItemKey,projectId,active]);
 useEffect(()=>{if(!active)return;const timer=setInterval(()=>{if(reportedWritable.current!==!!browserProjectOwnership(projectId))reportState();},100);return()=>clearInterval(timer);},[projectId,active]);
 return active?async()=>emit('loop-control:leave'):null;
}
