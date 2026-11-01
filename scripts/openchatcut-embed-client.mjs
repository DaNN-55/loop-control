import {saveProject,flushProjectSaves} from '/src/persist/projectStore.ts';
import {browserProjectOwnership} from '/src/persist/projectStoreTransport.ts';
import {applyWorkspaceCandidate,isWorkspaceCandidateEdit,addWorkspaceRegisteredSource} from 'virtual:loop-control-candidates';
import {applyWorkspaceAudioMix} from 'virtual:loop-control-audio';
import {applyWorkspaceShotOperation,isWorkspaceShotOperation,readWorkspaceShots} from 'virtual:loop-control-structure';
import {applyWorkspaceCaptionEdit,isWorkspaceCaptionContract,migrateWorkspaceCaptionLanes} from 'virtual:loop-control-captions';
// Loaded by the Loop Control Vite adapter inside the real editor, never a second store.
import {useEffect,useRef} from 'react';
const query=new URLSearchParams(location.search);
const channel=query.get('lcChannel'),expectedProject=query.get('lcProject');
const parentValue=query.get('lcParent');
let parentOrigin=null;
try{const url=new URL(parentValue);if(url.protocol==='http:'&&['127.0.0.1','localhost'].includes(url.hostname)&&!url.username&&!url.password)parentOrigin=url.origin;}catch{/* not an embedded launch */}
/** Embedded native import is redirected before any placeholder or pool master exists. */
export function redirectLoopControlImport(kind){
 if(!(parentOrigin&&parent!==window&&channel&&expectedProject&&location.hash===`#/editor/${expectedProject}`))return;
 if(!browserProjectOwnership(expectedProject))throw Error('编辑器写连接尚未就绪，请稍后重试。');
 parent.postMessage({type:'loop-control:import-requested',channel,projectId:expectedProject,kind:kind==='audio'||String(kind).startsWith('audio/')?'audio':'visual'},parentOrigin);
 throw Error(kind==='audio'||String(kind).startsWith('audio/')?'请从宿主声音素材入口登记文件。':'请从宿主画面版本上传并登记素材。');
}
export function useLoopControlHost(projectId,base,agent,panels){
  const live=useRef({base,agent});live.current={base,agent};
  const revision=useRef(0),reportedWritable=useRef(null);
  const active=parentOrigin&&parent!==window&&channel&&/^[a-f0-9-]{36}$/.test(channel)&&projectId===expectedProject;
  function emit(type,extra={}){if(active)parent.postMessage({type,channel,projectId,...extra},parentOrigin);}
  async function flushLiveDocument(){
    if(!await live.current.agent.flushBeforeLeaveRef.current())return false;
    // React's autosave effect may still hold the previous render. Enqueue the
    // actual live document through the SDK coordinator before acknowledging it.
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
      const result=(ok,error,value)=>emit('loop-control:result',{requestId:msg.requestId,ok,...(error?{error}:{}),...(value?{result:value}:{})});
      const digest=async doc=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(doc))))).map(b=>b.toString(16).padStart(2,'0')).join('');
      try{
        if(['select','flush','apply-captions','apply-workspace-edit','apply-candidate','apply-audio-mix','add-registered-source'].includes(msg.action)&&!browserProjectOwnership(projectId)){result(false,'编辑器写连接尚未就绪或已变化，请保留当前编辑并重试。');return;}
        if(msg.action==='host-panel'){
          if(typeof msg.open!=='boolean'){result(false,'面板状态无效。');return;}document.documentElement.dataset.lcHostTools=msg.open?'open':'closed';await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));result(true);
        }else if(msg.action==='inspect'){
          const document=structuredClone(live.current.base.doc);result(true,undefined,{revision:revision.current,documentFingerprint:await digest(document),document});
        }else if(msg.action==='apply-captions'||msg.action==='apply-workspace-edit'||msg.action==='apply-candidate'||msg.action==='apply-audio-mix'||msg.action==='add-registered-source'){
          const doc=live.current.base.doc,observedRevision=revision.current;
          if(msg.expectedRevision!==observedRevision||msg.expectedDocumentFingerprint!==await digest(doc)||doc!==live.current.base.doc||observedRevision!==revision.current){result(false,'工程已有新修改，请重新读取当前工程后重试。');return;}
          if(msg.action==='apply-captions'&&(typeof msg.itemId!=='string'||!isWorkspaceCaptionContract(msg.contract)||msg.contract.text.length>100000||msg.contract.cues.length>1000||msg.timingOnly!==undefined&&typeof msg.timingOnly!=='boolean')){result(false,'字幕增量输入无效。');return;}
          if(msg.action==='apply-workspace-edit'&&!isWorkspaceShotOperation(msg.operation)){result(false,'镜头编辑输入无效。');return;}
          if(msg.action==='apply-candidate'&&(!isWorkspaceCandidateEdit(msg.edit)||!/^\/media\/uploads\/[a-f0-9]+\.[a-z0-9]+$/.test(msg.edit.source.src))){result(false,'候选增量输入无效。');return;}
          const next=msg.action==='add-registered-source'?addWorkspaceRegisteredSource(doc,msg.asset):msg.action==='apply-audio-mix'?applyWorkspaceAudioMix(doc,msg.edit):msg.action==='apply-candidate'?applyWorkspaceCandidate(doc,msg.edit):msg.action==='apply-captions'?applyWorkspaceCaptionEdit(doc,msg.itemId,msg.contract,{timingOnly:msg.timingOnly===true}):applyWorkspaceShotOperation(migrateWorkspaceCaptionLanes(doc),msg.operation);
          live.current.base.commands.applyDoc(next);
          await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
          const ok=await flushLiveDocument();
          result(ok,ok?undefined:'原生保存冲突，请保留当前编辑并重试。',ok?{revision:revision.current,documentFingerprint:await digest(live.current.base.doc),document:structuredClone(live.current.base.doc)}:undefined);
        }else if(msg.action==='flush'){
          const doc=live.current.base.doc,next=migrateWorkspaceCaptionLanes(doc);if(JSON.stringify(next)!==JSON.stringify(doc)){live.current.base.commands.applyDoc(next);await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));}
          const ok=await flushLiveDocument();
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
    return()=>{hostStyle.remove();delete document.documentElement.dataset.lcHostTools;window.removeEventListener('message',message);emit('loop-control:closed');};
  },[projectId,active]);
  function reportState(){
    if(!active)return;const base=live.current.base;reportedWritable.current=!!browserProjectOwnership(projectId);
    emit('loop-control:state',{writable:reportedWritable.current,revision:++revision.current,selectedIds:Array.from(base.selection.selectedIds??[]),structureEnabled:base.doc.loopControl?.version==='four-step-workspace/v1',shots:base.doc.loopControl?.version==='four-step-workspace/v1'?readWorkspaceShots(base.doc).filter(s=>s.timelineId===base.doc.activeTimelineId):undefined,items:base.state.items.filter(i=>i.kind==='video'||i.kind==='image'||i.kind==='text'&&i.id.startsWith('shot-')).map(i=>({id:i.id,startFrame:i.startFrame,durationInFrames:i.durationInFrames,kind:i.kind,srcInFrame:i.srcInFrame??0,durationLocked:i.loopControlVideo?.durationLocked===true,sourceDurationInFrames:base.doc.assets.find(a=>a.id===i.sourceAssetId)?.durationInFrames,fit:i.fit??base.state.fit,focusX:i.transform?.x??0,focusY:i.transform?.y??0,layout:i.loopControlComposition?.layout??'full',transition:Number(i.fadeInFrames)>0||Number(i.fadeOutFrames)>0?'fade':'cut'})),width:base.state.width,height:base.state.height});
  }
  useEffect(()=>{reportState();},[base.doc,projectId,active]);
  useEffect(()=>{if(!active)return;const timer=setInterval(()=>{if(reportedWritable.current!==!!browserProjectOwnership(projectId))reportState();},100);return()=>clearInterval(timer);},[projectId,active]);
  return active?async()=>emit('loop-control:leave'):null;
}
