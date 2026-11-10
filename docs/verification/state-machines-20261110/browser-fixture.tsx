import {StrictMode,useEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {useWorkspaceCallConfirmation} from '../../../src/local-app/useWorkspaceCallConfirmation';
import '../../../src/styles.css';
import '../../../src/ui/impeccable/foundation.css';
import '../../../src/ui/impeccable/configuration.css';
import '../../../src/ui/impeccable/production.css';
import '../../../src/local-app/production-compact.css';

// Isolated UI boundary exercise: the real hook/modal, controlled local commands, no API.
function Fixture(){
 const [scope,setScope]=useState('A'),[slowPrepare,setSlowPrepare]=useState(false),[slowConfirm,setSlowConfirm]=useState(false);
 const [events,setEvents]=useState<string[]>([]),waiting=useRef<Array<{resolve:(value:unknown)=>void;reject:(reason:unknown)=>void;value:unknown}>>([]);
 const record=(text:string)=>setEvents(previous=>[...previous,text]);
 const proposal=(target:string)=>({confirmationId:`confirmation-${target}`,expiresAt:'2099-01-01T00:00:00Z',summary:{kind:'图片生成',target,provider:'controlled',model:'fixture-image',connection:'隔离验证连接',parameters:['1 张','864 × 1536'],inputs:[],prompt:'确认生命周期验证',reservationCents:125}});
 const call=useWorkspaceCallConfirmation(async(name,data)=>{
  const target=(data as {episodeId:string}).episodeId;
  record(`${name}:${target}`);
  const value=name==='prepareWorkspaceCall'?proposal(target):{id:target};
  if(name==='prepareWorkspaceCall'?slowPrepare:slowConfirm)return new Promise((resolve,reject)=>waiting.current.push({resolve,reject,value}));
  return value;
 },scope);
 useEffect(()=>{
  const change=(event:Event)=>setScope((event as CustomEvent<string>).detail);
  const release=(event:Event)=>{const pending=waiting.current.shift();if((event as CustomEvent<string>).detail==='reject')pending?.reject(Error('旧调用验证失败'));else pending?.resolve(pending.value);};
  window.addEventListener('fixture-scope',change);window.addEventListener('fixture-release',release);
  return()=>{window.removeEventListener('fixture-scope',change);window.removeEventListener('fixture-release',release);};
 },[]);
 async function request(){const identity=scope;try{await call.request('requestWorkspaceImageCandidates',{episodeId:identity,workspaceId:identity,expectedRevision:1,prompt:'确认生命周期验证',settings:{count:1}});record(`completed:${identity}`);}catch(error){record(`${(error as Error).name}:${identity}`);}}
 return <div className="app-shell dan-ui product-ui"><main style={{padding:24}}><h1>调用确认隔离验证</h1><p>当前归属：<output id="scope">{scope}</output></p><label><input type="checkbox" checked={slowPrepare} onChange={event=>setSlowPrepare(event.target.checked)}/>延迟准备</label><label><input type="checkbox" checked={slowConfirm} onChange={event=>setSlowConfirm(event.target.checked)}/>延迟提交</label><p><button onClick={()=>void request()}>生成图片</button></p><ol aria-label="验证事件">{events.map((event,index)=><li key={index}>{event}</li>)}</ol></main>{call.dialog}</div>;
}
createRoot(document.getElementById('root')!).render(<StrictMode><Fixture/></StrictMode>);
