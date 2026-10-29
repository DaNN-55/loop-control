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
    async function message(event){
      const msg=event.data;
      if(event.source!==parent||event.origin!==parentOrigin||!msg||msg.type!=='loop-control:command'||msg.channel!==channel||msg.projectId!==projectId||typeof msg.requestId!=='string'||!/^[a-f0-9-]{36}$/.test(msg.requestId))return;
      const result=(ok,error)=>emit('loop-control:result',{requestId:msg.requestId,ok,...(error?{error}:{})});
      try{
        if(msg.action==='flush'){
          const ok=await live.current.agent.flushBeforeLeaveRef.current();
          result(ok,ok?undefined:'编辑器仍有未保存修改，请在编辑器中重试保存。');
        }else if(msg.action==='select'){
          const item=live.current.base.state.items.find(i=>i.id===msg.itemId&&(i.kind==='video'||i.kind==='image'));
          if(!item){result(false,'当前工程中找不到该镜头。');return;}
          live.current.base.commands.selectItem(item.id);
          live.current.agent.playerRef.current?.seekTo(item.startFrame);
          result(true);
        }
      }catch{result(false,'编辑器操作未完成，当前修改仍保留。');}
    }
    window.addEventListener('message',message);
    return()=>{window.removeEventListener('message',message);emit('loop-control:closed');};
  },[projectId,active]);
  useEffect(()=>{
    if(!active)return;
    emit('loop-control:state',{revision:++revision.current,selectedIds:Array.from(base.selection.selectedIds??[]),items:base.state.items.filter(i=>i.kind==='video'||i.kind==='image').map(i=>({id:i.id,startFrame:i.startFrame,durationInFrames:i.durationInFrames})),width:base.state.width,height:base.state.height});
  },[base.doc,projectId,active]);
  return active?async()=>emit('loop-control:leave'):null;
}
