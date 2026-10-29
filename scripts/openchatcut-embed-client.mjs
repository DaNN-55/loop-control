import {applyWorkspaceCandidate,isWorkspaceCandidateEdit} from 'virtual:loop-control-candidates';
import {applyWorkspaceShotOperation,isWorkspaceShotOperation,readWorkspaceShots} from 'virtual:loop-control-structure';
import {applyWorkspaceCaptionEdit,isWorkspaceCaptionContract,migrateWorkspaceCaptionLanes} from 'virtual:loop-control-captions';
// Loaded by the Loop Control Vite adapter inside the real editor, never a second store.
import {useEffect,useRef} from 'react';
const query=new URLSearchParams(location.search);
const channel=query.get('lcChannel'),expectedProject=query.get('lcProject');
const parentValue=query.get('lcParent');
let parentOrigin=null;
try{const url=new URL(parentValue);if(url.protocol==='http:'&&['127.0.0.1','localhost'].includes(url.hostname)&&!url.username&&!url.password)parentOrigin=url.origin;}catch{/* not an embedded launch */}
export function useLoopControlHost(projectId,base,agent,panels){
  const live=useRef({base,agent});live.current={base,agent};
  const revision=useRef(0);
  const active=parentOrigin&&parent!==window&&channel&&/^[a-f0-9-]{36}$/.test(channel)&&projectId===expectedProject;
  function emit(type,extra={}){if(active)parent.postMessage({type,channel,projectId,...extra},parentOrigin);}
  useEffect(()=>{
    if(!active)return;
    panels.setChatCollapsed(true);
    const hostStyle=document.createElement('style');hostStyle.textContent=':root[data-lc-host-tools="open"] .cc-inspector{position:static;inset:auto;width:min(260px,45%);flex:0 0 min(260px,45%);box-shadow:none}';document.head.append(hostStyle);
    let narrow=innerWidth<1100;if(narrow)panels.setInspectorCollapsed(true);
    const resize=()=>{const next=innerWidth<1100;if(next&&!narrow)panels.setInspectorCollapsed(true);narrow=next;};
    window.addEventListener('resize',resize);
    async function message(event){
      const msg=event.data;
      if(event.source!==parent||event.origin!==parentOrigin||!msg||msg.type!=='loop-control:command'||msg.channel!==channel||msg.projectId!==projectId||typeof msg.requestId!=='string'||!/^[a-f0-9-]{36}$/.test(msg.requestId))return;
      const result=(ok,error,value)=>emit('loop-control:result',{requestId:msg.requestId,ok,...(error?{error}:{}),...(value?{result:value}:{})});
      const digest=async doc=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(doc))))).map(b=>b.toString(16).padStart(2,'0')).join('');
      try{
        if(msg.action==='host-panel'){
          if(typeof msg.open!=='boolean'){result(false,'面板状态无效。');return;}document.documentElement.dataset.lcHostTools=msg.open?'open':'closed';if(msg.open)panels.setInspectorCollapsed(true);await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));result(true);
        }else if(msg.action==='inspect'){
          const document=structuredClone(live.current.base.doc);result(true,undefined,{revision:revision.current,documentFingerprint:await digest(document),document});
        }else if(msg.action==='apply-captions'||msg.action==='apply-workspace-edit'||msg.action==='apply-candidate'){
          const doc=live.current.base.doc,observedRevision=revision.current;
          if(msg.expectedRevision!==observedRevision||msg.expectedDocumentFingerprint!==await digest(doc)||doc!==live.current.base.doc||observedRevision!==revision.current){result(false,'工程已有新修改，请重新读取当前工程后重试。');return;}
          if(msg.action==='apply-captions'&&(typeof msg.itemId!=='string'||!isWorkspaceCaptionContract(msg.contract)||msg.contract.text.length>100000||msg.contract.cues.length>1000)){result(false,'字幕增量输入无效。');return;}
          if(msg.action==='apply-workspace-edit'&&!isWorkspaceShotOperation(msg.operation)){result(false,'镜头编辑输入无效。');return;}
          if(msg.action==='apply-candidate'&&(!isWorkspaceCandidateEdit(msg.edit)||!/^\/media\/uploads\/[a-f0-9]+\.[a-z0-9]+$/.test(msg.edit.source.src))){result(false,'候选增量输入无效。');return;}
          const next=msg.action==='apply-candidate'?applyWorkspaceCandidate(doc,msg.edit):msg.action==='apply-captions'?applyWorkspaceCaptionEdit(doc,msg.itemId,msg.contract):applyWorkspaceShotOperation(migrateWorkspaceCaptionLanes(doc),msg.operation);
          live.current.base.commands.applyDoc(next);
          await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
          const ok=await live.current.agent.flushBeforeLeaveRef.current();
          result(ok,ok?undefined:'原生保存冲突，请保留当前编辑并重试。',ok?{revision:revision.current,documentFingerprint:await digest(live.current.base.doc),document:structuredClone(live.current.base.doc)}:undefined);
        }else if(msg.action==='flush'){
          const doc=live.current.base.doc,next=migrateWorkspaceCaptionLanes(doc);if(JSON.stringify(next)!==JSON.stringify(doc)){live.current.base.commands.applyDoc(next);await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));}
          const ok=await live.current.agent.flushBeforeLeaveRef.current();
          result(ok,ok?undefined:'编辑器仍有未保存修改，请在编辑器中重试保存。');
        }else if(msg.action==='select'){
          const item=live.current.base.state.items.find(i=>i.id===msg.itemId&&(i.kind==='video'||i.kind==='image'||i.kind==='text'&&i.id.startsWith('shot-')));
          if(!item){result(false,'当前工程中找不到该镜头。');return;}
          live.current.base.commands.selectItem(item.id);
          live.current.agent.playerRef.current?.seekTo(item.startFrame);
          result(true);
        }
      }catch(cause){result(false,cause instanceof Error?cause.message:'编辑器操作未完成，当前修改仍保留。');}
    }
    window.addEventListener('message',message);
    return()=>{hostStyle.remove();delete document.documentElement.dataset.lcHostTools;window.removeEventListener('resize',resize);window.removeEventListener('message',message);emit('loop-control:closed');};
  },[projectId,active]);
  useEffect(()=>{
    if(!active)return;
    emit('loop-control:state',{revision:++revision.current,selectedIds:Array.from(base.selection.selectedIds??[]),structureEnabled:base.doc.loopControl?.version==='four-step-workspace/v1',shots:base.doc.loopControl?.version==='four-step-workspace/v1'?readWorkspaceShots(base.doc).filter(s=>s.timelineId===base.doc.activeTimelineId):undefined,items:base.state.items.filter(i=>i.kind==='video'||i.kind==='image'||i.kind==='text'&&i.id.startsWith('shot-')).map(i=>({id:i.id,startFrame:i.startFrame,durationInFrames:i.durationInFrames,kind:i.kind,srcInFrame:i.srcInFrame??0,durationLocked:i.loopControlVideo?.durationLocked===true,sourceDurationInFrames:base.doc.assets.find(a=>a.id===i.sourceAssetId)?.durationInFrames,fit:i.fit??base.state.fit,focusX:i.transform?.x??0,focusY:i.transform?.y??0,layout:i.loopControlComposition?.layout??'full',transition:Number(i.fadeInFrames)>0||Number(i.fadeOutFrames)>0?'fade':'cut'})),width:base.state.width,height:base.state.height});
  },[base.doc,projectId,active]);
  return active?async()=>emit('loop-control:leave'):null;
}
