import {useEffect,useRef,useState} from 'react';
import {ArrowLeft,Check,LoaderCircle,Save} from 'lucide-react';
import type {OpenChatCutStudioWorkspace} from '../reviews/reviewRevision';
import './embedded-studio.css';
export interface EmbeddedStudioSession {studioUrl:string;workspace:OpenChatCutStudioWorkspace;sourcePath:string;launchId?:string}
interface EditorState {revision:number;selectedIds:string[];items:Array<{id:string;startFrame:number;durationInFrames:number}>}
export function EmbeddedStudioHost({episodeId,title,session,shots,onSave,onClose}:{episodeId:string;title:string;session:EmbeddedStudioSession;shots:Array<{id:string;text:string}>;onSave:(workspace:OpenChatCutStudioWorkspace)=>Promise<OpenChatCutStudioWorkspace>;onClose:()=>void}){
  const frame=useRef<HTMLIFrameElement>(null),[channel]=useState(()=>crypto.randomUUID());
  const [workspace,setWorkspace]=useState(session.workspace),[editor,setEditor]=useState<EditorState|null>(null),[pending,setPending]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState(false);
  const leave=useRef<()=>void>(()=>{});
  const requests=useRef(new Map<string,{resolve:()=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}>());
  let url:URL|null=null;
  try{const value=new URL(session.studioUrl);if(workspace.projectId===`loop-control-${episodeId}`&&value.protocol==='http:'&&value.hostname==='127.0.0.1'&&!value.username&&!value.password&&value.hash===`#/editor/${workspace.projectId}`){value.searchParams.set('lcParent',location.origin);value.searchParams.set('lcChannel',channel);value.searchParams.set('lcProject',workspace.projectId);url=value;}}catch{/* invalid server URL cannot become a frame */}
  const src=url?.href,origin=url?.origin;
  useEffect(()=>{
    function receive(event:MessageEvent){
      const data=event.data;
      if(event.source!==frame.current?.contentWindow||event.origin!==origin||!data||data.channel!==channel||data.projectId!==workspace.projectId)return;
      if(data.type==='loop-control:state'){
        if(!Number.isSafeInteger(data.revision)||data.revision<0||!Array.isArray(data.items)||data.items.length>10000||!data.items.every((i:EditorState['items'][number])=>i&&typeof i.id==='string'&&Number.isFinite(i.startFrame)&&Number.isFinite(i.durationInFrames))||!Array.isArray(data.selectedIds)||!data.selectedIds.every((id:unknown)=>typeof id==='string'))return;
        setEditor({revision:data.revision,items:data.items,selectedIds:data.selectedIds});setSaved(false);
      }else if(data.type==='loop-control:leave'){leave.current();}
      else if(data.type==='loop-control:closed'){setEditor(null);}
      else if(data.type==='loop-control:result'){
        const request=requests.current.get(data.requestId);if(!request)return;requests.current.delete(data.requestId);clearTimeout(request.timer);
        if(data.ok===true)request.resolve();else request.reject(new Error(typeof data.error==='string'?data.error:'编辑器操作未完成。'));
      }
    }
    window.addEventListener('message',receive);
    return()=>{window.removeEventListener('message',receive);for(const request of requests.current.values()){clearTimeout(request.timer);request.reject(new Error('编辑器连接已关闭，修改尚未确认保存。'));}requests.current.clear();};
  },[origin,channel,workspace.projectId]);
  function request(action:'flush'|'select',itemId?:string){
    return new Promise<void>((resolve,reject)=>{
      if(!editor||!frame.current?.contentWindow||!origin){reject(new Error('编辑器尚未连接。'));return;}
      const requestId=crypto.randomUUID();
      const timer=setTimeout(()=>{requests.current.delete(requestId);reject(new Error('编辑器未确认操作，请检查编辑器状态后重试。'));},15000);
      requests.current.set(requestId,{resolve,reject,timer});
      frame.current.contentWindow.postMessage({type:'loop-control:command',channel,projectId:workspace.projectId,requestId,action,...(itemId?{itemId}:{})},origin);
    });
  }
  async function save(close=false){
    if(pending)return;setPending(true);setError('');
    try{await request('flush');const next=await onSave(workspace);setWorkspace(next);setSaved(true);if(close)onClose();}
    catch(cause){setError(cause instanceof Error?cause.message:'保存未完成，当前修改仍保留。');}
    finally{setPending(false);}
  }
  leave.current=()=>{void save(true);};
  return <section className="embedded-studio" aria-label="整期剪辑工作台" data-episode={episodeId}>
    <header><div><p>逐镜头制作 / OpenChatCut</p><h2>{title}</h2></div><div><span role="status">{saved?<><Check size={14}/>工作版本已保存</>:editor?'编辑器已连接':'正在连接编辑器…'}</span><button className="embedded-studio-back" disabled={!editor||pending} onClick={()=>void save(true)}><ArrowLeft size={15}/>返回生产单</button><button className="embedded-studio-save" disabled={!editor||pending} onClick={()=>void save()}>{pending?<LoaderCircle size={15}/>:<Save size={15}/>}保存工作版本</button></div></header>
    {error&&<p role="alert" className="form-error">{error}</p>}
    {!src?<p role="alert">Studio 地址或工程身份不匹配，未加载编辑器。</p>:<div className="embedded-studio-body"><aside aria-label="镜头导航"><h3>镜头 <small>{shots.length}</small></h3>{shots.map(shot=>{const item=editor?.items.find(i=>i.id.startsWith(`shot-${shot.id}-`));return <button key={shot.id} aria-label={`定位镜头 ${shot.id}`} aria-pressed={!!item&&!!editor?.selectedIds.includes(item.id)} disabled={!item||pending} onClick={()=>{void request('select',item!.id).catch(cause=>setError(cause.message));}}><small>{shot.id}</small><span>{shot.text}</span></button>;})}</aside><iframe ref={frame} title="OpenChatCut 剪辑工程" src={src} sandbox="allow-scripts allow-same-origin allow-downloads" allow="fullscreen"/></div>}
  </section>;
}
