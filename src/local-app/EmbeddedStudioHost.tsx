import {WorkspaceShotRail} from './WorkspaceShotRail';
import type {WorkspaceShot,WorkspaceShotOperation} from '../workspaceShots';
import {useEffect,useRef,useState,type ReactNode} from 'react';
import {readWorkspaceCaption} from '../workspaceCaptions';
import type {ShotCaptionContract} from '../shotCaptions';
import type {OpenChatCutProject} from '../worker/openchatcutProject';
import {ArrowLeft,Check,LoaderCircle,Save} from 'lucide-react';
import type {OpenChatCutStudioWorkspace} from '../reviews/reviewRevision';
import './embedded-studio.css';
export interface EmbeddedStudioSession {studioUrl:string;workspace:OpenChatCutStudioWorkspace;sourcePath:string;launchId?:string}
export interface EmbeddedStudioBridge {connected:boolean;inspect:()=>Promise<{revision:number;documentFingerprint:string;document:OpenChatCutProject}>;applyCaptions:(itemId:string,contract:ShotCaptionContract)=>Promise<ShotCaptionContract>;save:()=>Promise<void>;applyEdit:(operation:WorkspaceShotOperation)=>Promise<OpenChatCutProject>;applyNativeEdit:(action:'apply-workspace-edit'|'apply-candidate',payload:Record<string,unknown>)=>Promise<OpenChatCutProject>}
interface EditorState {shots?:WorkspaceShot[];revision:number;selectedIds:string[];items:Array<{id:string;startFrame:number;durationInFrames:number}>}
export function EmbeddedStudioHost({episodeId,title,session,shots,onSave,onClose,captionEditor,panels=[]}:{episodeId:string;title:string;session:EmbeddedStudioSession;shots:Array<{id:string;text:string}>;onSave:(workspace:OpenChatCutStudioWorkspace)=>Promise<OpenChatCutStudioWorkspace>;onClose:()=>void;captionEditor?:(bridge:EmbeddedStudioBridge)=>ReactNode;panels?:Array<{id:string;label:string;render:(bridge:EmbeddedStudioBridge)=>ReactNode}>}){
  const frame=useRef<HTMLIFrameElement>(null),[channel]=useState(()=>crypto.randomUUID());
  const [workspace,setWorkspace]=useState(session.workspace),[editor,setEditor]=useState<EditorState|null>(null),[pending,setPending]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState(false),[activePanel,setActivePanel]=useState<string|null>(null),[railCollapsed,setRailCollapsed]=useState(false);
  const leave=useRef<()=>void>(()=>{});
  const requests=useRef(new Map<string,{resolve:(value:unknown)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}>());
  let url:URL|null=null;
  try{const value=new URL(session.studioUrl);if(workspace.projectId===`loop-control-${episodeId}`&&value.protocol==='http:'&&value.hostname==='127.0.0.1'&&!value.username&&!value.password&&value.hash===`#/editor/${workspace.projectId}`){value.searchParams.set('lcParent',location.origin);value.searchParams.set('lcChannel',channel);value.searchParams.set('lcProject',workspace.projectId);url=value;}}catch{/* invalid server URL cannot become a frame */}
  const src=url?.href,origin=url?.origin;
  useEffect(()=>{
    function receive(event:MessageEvent){
      const data=event.data;
      if(event.source!==frame.current?.contentWindow||event.origin!==origin||!data||data.channel!==channel||data.projectId!==workspace.projectId)return;
      if(data.type==='loop-control:state'){
        if(!Number.isSafeInteger(data.revision)||data.revision<0||!Array.isArray(data.items)||data.items.length>10000||!data.items.every((i:EditorState['items'][number])=>i&&typeof i.id==='string'&&Number.isFinite(i.startFrame)&&Number.isFinite(i.durationInFrames))||!Array.isArray(data.selectedIds)||!data.selectedIds.every((id:unknown)=>typeof id==='string'))return;
        setEditor({shots:Array.isArray(data.shots)?data.shots:undefined,revision:data.revision,items:data.items,selectedIds:data.selectedIds});setSaved(false);
      }else if(data.type==='loop-control:leave'){leave.current();}
      else if(data.type==='loop-control:closed'){setEditor(null);}
      else if(data.type==='loop-control:result'){
        const request=requests.current.get(data.requestId);if(!request)return;requests.current.delete(data.requestId);clearTimeout(request.timer);
        if(data.ok===true)request.resolve(data.result);else request.reject(new Error(typeof data.error==='string'?data.error:'编辑器操作未完成。'));
      }
    }
    window.addEventListener('message',receive);
    return()=>{window.removeEventListener('message',receive);for(const request of requests.current.values()){clearTimeout(request.timer);request.reject(new Error('编辑器连接已关闭，修改尚未确认保存。'));}requests.current.clear();};
  },[origin,channel,workspace.projectId]);
  function request<T=void>(action:'flush'|'select'|'inspect'|'apply-captions'|'apply-workspace-edit'|'apply-candidate',payload:Record<string,unknown>={}){
    return new Promise<T>((resolve,reject)=>{
      if(!editor||!frame.current?.contentWindow||!origin){reject(new Error('编辑器尚未连接。'));return;}
      const requestId=crypto.randomUUID();
      const timer=setTimeout(()=>{requests.current.delete(requestId);reject(new Error('编辑器未确认操作，请检查编辑器状态后重试。'));},15000);
      requests.current.set(requestId,{resolve:value=>resolve(value as T),reject,timer});
      frame.current.contentWindow.postMessage({type:'loop-control:command',channel,projectId:workspace.projectId,requestId,action,...payload},origin);
    });
  }
  async function save(close=false){
    if(pending)return;setPending(true);setError('');
    try{await request('flush');const next=await onSave(workspace);setWorkspace(next);setSaved(true);if(close)onClose();}
    catch(cause){setError(cause instanceof Error?cause.message:'保存未完成，当前修改仍保留。');}
    finally{setPending(false);}
  }
  async function applyNativeEdit(action:'apply-workspace-edit'|'apply-candidate',payload:Record<string,unknown>){if(pending)throw Error('请等待当前保存完成。');setPending(true);setError('');try{const current=await request<{revision:number;documentFingerprint:string}>('inspect');const applied=await request<{document:OpenChatCutProject}>(action,{...payload,expectedRevision:current.revision,expectedDocumentFingerprint:current.documentFingerprint});const next=await onSave(workspace);setWorkspace(next);setSaved(true);return applied.document;}catch(cause){setError(cause instanceof Error?cause.message:'修改未保存，当前编辑仍保留。');throw cause;}finally{setPending(false);}}
  const bridge:EmbeddedStudioBridge={connected:!!editor&&!pending,applyNativeEdit,applyEdit:operation=>applyNativeEdit('apply-workspace-edit',{operation}),inspect:()=>request('inspect'),save:async()=>{await request('flush');const next=await onSave(workspace);setWorkspace(next);setSaved(true);},applyCaptions:async(itemId,contract)=>{if(pending)throw Error('请等待当前保存完成。');setPending(true);setError('');try{const current=await request<{revision:number;documentFingerprint:string}>('inspect');const applied=await request<{document:OpenChatCutProject}>('apply-captions',{itemId,contract,expectedRevision:current.revision,expectedDocumentFingerprint:current.documentFingerprint});const caption=readWorkspaceCaption(applied.document,itemId);if(!caption)throw Error('编辑器未返回当前字幕。');const next=await onSave(workspace);setWorkspace(next);setSaved(true);return caption.contract;}catch(cause){setError(cause instanceof Error?cause.message:'字幕保存失败。');throw cause;}finally{setPending(false);}}};
  leave.current=()=>{void save(true);};
  return <section className="embedded-studio" aria-label="整期剪辑工作台" data-episode={episodeId}>
    <header><div><p>剪辑工作台 / OpenChatCut</p><h2>{title}</h2></div><div><span role="status">{saved?<><Check size={14}/>工作版本已保存</>:editor?'编辑器已连接':'正在连接编辑器…'}</span>{captionEditor&&<button aria-pressed={activePanel==='captions'} onClick={()=>setActivePanel(v=>v==='captions'?null:'captions')}>字幕</button>}{panels.map(panel=><button key={panel.id} aria-pressed={activePanel===panel.id} onClick={()=>setActivePanel(v=>v===panel.id?null:panel.id)}>{panel.label}</button>)}<button className="embedded-studio-back" disabled={!editor||pending} onClick={()=>void save(true)}><ArrowLeft size={15}/>返回生产单</button><button className="embedded-studio-save" disabled={!editor||pending} onClick={()=>void save()}>{pending?<LoaderCircle size={15}/>:<Save size={15}/>}保存工作版本</button></div></header>
    {error&&<p role="alert" className="form-error">{error}</p>}
    {!src?<p role="alert">Studio 地址或工程身份不匹配，未加载编辑器。</p>:<div className={`embedded-studio-body${activePanel?' panel-open':''}${railCollapsed?' rail-collapsed':''}`}><WorkspaceShotRail shots={editor?.shots??shots.map(shot=>{const items=editor?.items.filter(i=>i.id.startsWith(`shot-${shot.id}-`))??[];return{id:shot.id,text:shot.text,timelineId:'',itemIds:items.map(i=>i.id),startFrame:items[0]?.startFrame??0,durationInFrames:0,effective:true};})} selectedIds={editor?.selectedIds??[]} disabled={!editor||pending} onCollapse={setRailCollapsed} select={itemId=>{void request('select',{itemId}).catch(cause=>setError(cause.message));}} edit={bridge.applyEdit}/><iframe ref={frame} title="OpenChatCut 剪辑工程" src={src} sandbox="allow-scripts allow-same-origin allow-downloads" allow="fullscreen"/><aside className="embedded-studio-caption-panel" hidden={!activePanel}>{!activePanel||activePanel==='captions'?captionEditor?.(bridge):panels.find(panel=>panel.id===activePanel)?.render(bridge)}</aside></div>}
  </section>;
}
