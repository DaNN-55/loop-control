import {WorkspaceNativeControls,type WorkspaceNativeItem} from './WorkspaceNativeControls';
import {WorkspaceShotRail} from './WorkspaceShotRail';
import type {WorkspaceShot,WorkspaceShotOperation} from '../workspaceShots';
import {useEffect,useRef,useState,type ReactNode} from 'react';
import {readWorkspaceCaption} from '../workspaceCaptions';
import type {ShotCaptionContract} from '../shotCaptions';
import type {OpenChatCutProject} from '../worker/openchatcutProject';
import {ArrowLeft,Check,LoaderCircle,Save,Maximize2,Minimize2} from 'lucide-react';
import type {OpenChatCutStudioWorkspace} from '../reviews/reviewRevision';
import './embedded-studio.css';
export interface EmbeddedStudioSession {studioUrl:string;workspace:OpenChatCutStudioWorkspace;sourcePath:string;launchId?:string}
export interface EmbeddedStudioBridge {selectedShotId?:string;connected:boolean;inspect:()=>Promise<{revision:number;documentFingerprint:string;document:OpenChatCutProject}>;applyCaptions:(itemId:string,contract:ShotCaptionContract,timingOnly?:boolean)=>Promise<ShotCaptionContract>;save:()=>Promise<void>;applyEdit:(operation:WorkspaceShotOperation)=>Promise<OpenChatCutProject>;applyNativeEdit:(action:'apply-workspace-edit'|'apply-candidate'|'apply-audio-mix'|'add-registered-source',payload:Record<string,unknown>)=>Promise<OpenChatCutProject>}
interface EditorState {writable?:boolean;structureEnabled?:boolean;shots?:WorkspaceShot[];revision:number;selectedIds:string[];items:WorkspaceNativeItem[]}
export function EmbeddedStudioHost({episodeId,title,session,shots,onSave,onClose,captionEditor,panels=[],initialShotId,history}:{episodeId:string;title:string;session:EmbeddedStudioSession;shots:Array<{id:string;text:string;soundIntent?:string}>;onSave:(workspace:OpenChatCutStudioWorkspace)=>Promise<OpenChatCutStudioWorkspace>;onClose:()=>void;captionEditor?:(bridge:EmbeddedStudioBridge)=>ReactNode;panels?:Array<{id:string;label:string;render:(bridge:EmbeddedStudioBridge)=>ReactNode}>;initialShotId?:string;history?:ReactNode}){
  const frame=useRef<HTMLIFrameElement>(null),[channel]=useState(()=>crypto.randomUUID());
  const [workspace,setWorkspace]=useState(session.workspace),[editor,setEditor]=useState<EditorState|null>(null),[pending,setPending]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState(false),[activePanel,setActivePanel]=useState<string|null>(null),[railCollapsed,setRailCollapsed]=useState(false),[focused,setFocused]=useState(false);
  const visitedPanels=useRef(new Set<string>([])),lastPanel=useRef(panels[0]?.id??(captionEditor?'captions':'shot-settings'));
  if(activePanel){visitedPanels.current.add(activePanel);lastPanel.current=activePanel;}
  const writable=editor?.writable===true;
  const writableRef=useRef(false);
  const workspaceRef=useRef(session.workspace),pendingRef=useRef(false),everWritable=useRef(false);
  function remember(next:OpenChatCutStudioWorkspace){workspaceRef.current=next;setWorkspace(next);setSaved(true);}
  function begin(){if(!writable)throw Error('编辑器写连接尚未就绪，请稍后重试。');if(pendingRef.current)throw Error('请等待当前保存完成。');pendingRef.current=true;setPending(true);setError('');}
  function finish(){pendingRef.current=false;setPending(false);}
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
        if(data.writable!==undefined&&typeof data.writable!=='boolean'||!Number.isSafeInteger(data.revision)||data.revision<0||!Array.isArray(data.items)||data.items.length>10000||!data.items.every((i:EditorState['items'][number])=>i&&typeof i.id==='string'&&Number.isFinite(i.startFrame)&&Number.isFinite(i.durationInFrames))||!Array.isArray(data.selectedIds)||!data.selectedIds.every((id:unknown)=>typeof id==='string'))return;
        writableRef.current=data.writable===true;if(data.writable===true)everWritable.current=true;
        setEditor({writable:data.writable===true,structureEnabled:data.structureEnabled===true,shots:Array.isArray(data.shots)?data.shots:undefined,revision:data.revision,items:data.items,selectedIds:data.selectedIds});setSaved(false);
      }else if(data.type==='loop-control:import-requested'){if(writableRef.current)setActivePanel(data.kind==='audio'?'audio':'visuals');}
      else if(data.type==='loop-control:leave'){leave.current();}
      else if(data.type==='loop-control:closed'){writableRef.current=false;setEditor(null);}
      else if(data.type==='loop-control:result'){
        const request=requests.current.get(data.requestId);if(!request)return;requests.current.delete(data.requestId);clearTimeout(request.timer);
        if(data.ok===true)request.resolve(data.result);else request.reject(new Error(typeof data.error==='string'?data.error:'编辑器操作未完成。'));
      }
    }
    window.addEventListener('message',receive);
    return()=>{window.removeEventListener('message',receive);for(const request of requests.current.values()){clearTimeout(request.timer);request.reject(new Error('编辑器连接已关闭，修改尚未确认保存。'));}requests.current.clear();};
  },[origin,channel,workspace.projectId]);
  function request<T=void>(action:'host-panel'|'flush'|'select'|'inspect'|'apply-captions'|'apply-workspace-edit'|'apply-candidate'|'apply-audio-mix'|'add-registered-source',payload:Record<string,unknown>={}){
    return new Promise<T>((resolve,reject)=>{
      if(!editor||!frame.current?.contentWindow||!origin){reject(new Error('编辑器尚未连接。'));return;}
      const requestId=crypto.randomUUID();
      const timer=setTimeout(()=>{requests.current.delete(requestId);reject(new Error('编辑器未确认操作，请检查编辑器状态后重试。'));},15000);
      requests.current.set(requestId,{resolve:value=>resolve(value as T),reject,timer});
      frame.current.contentWindow.postMessage({type:'loop-control:command',channel,projectId:workspace.projectId,requestId,action,...payload},origin);
    });
  }
  async function save(close=false){
    if(pendingRef.current)return;begin();
    try{await request('flush');const next=await onSave(workspaceRef.current);remember(next);if(close)onClose();}
    catch(cause){setError(cause instanceof Error?cause.message:'保存未完成，当前修改仍保留。');}
    finally{finish();}
  }
  async function applyNativeEdit(action:'apply-workspace-edit'|'apply-candidate'|'apply-audio-mix'|'add-registered-source',payload:Record<string,unknown>){begin();try{const current=await request<{revision:number;documentFingerprint:string}>('inspect');const applied=await request<{document:OpenChatCutProject}>(action,{...payload,expectedRevision:current.revision,expectedDocumentFingerprint:current.documentFingerprint});const next=await onSave(workspaceRef.current);remember(next);return applied.document;}catch(cause){setError(cause instanceof Error?cause.message:'修改未保存，当前编辑仍保留。');throw cause;}finally{finish();}}
  const selectedItem=editor?.items.find(i=>editor.selectedIds.includes(i.id)),selectedShot=editor?.shots?.find(s=>s.itemIds.includes(selectedItem?.id??''));
  const selectedSoundIntent=shots.find(shot=>shot.id===selectedShot?.id)?.soundIntent;
  const bridge:EmbeddedStudioBridge={selectedShotId:selectedShot?.id,connected:writable&&!pending,applyNativeEdit,applyEdit:operation=>applyNativeEdit('apply-workspace-edit',{operation}),inspect:()=>request('inspect'),save:async()=>{begin();try{await request('flush');const next=await onSave(workspaceRef.current);remember(next);}catch(cause){setError(cause instanceof Error?cause.message:'保存未完成，当前修改仍保留。');throw cause;}finally{finish();}},applyCaptions:async(itemId,contract,timingOnly=false)=>{begin();try{const current=await request<{revision:number;documentFingerprint:string}>('inspect');const applied=await request<{document:OpenChatCutProject}>('apply-captions',{itemId,contract,timingOnly,expectedRevision:current.revision,expectedDocumentFingerprint:current.documentFingerprint});const caption=readWorkspaceCaption(applied.document,itemId);if(!caption)throw Error('编辑器未返回当前字幕。');const next=await onSave(workspaceRef.current);remember(next);return caption.contract;}catch(cause){setError(cause instanceof Error?cause.message:'字幕保存失败。');throw cause;}finally{finish();}}};
  async function togglePanel(id:string){const next=activePanel===id?null:id;try{if(editor?.structureEnabled)await request('host-panel',{open:!!next});setActivePanel(next);}catch(cause){setError(cause instanceof Error?cause.message:'原生面板尚未就绪，请重试。');}}
  useEffect(()=>{if(editor?.structureEnabled)void request('host-panel',{open:!!activePanel}).catch(()=>{});},[activePanel,editor?.structureEnabled]);
  const initialSelection=useRef(false);
  useEffect(()=>{if(initialSelection.current||!writable||!initialShotId)return;const target=editor?.shots?.find(s=>s.id===initialShotId)?.itemIds[0];if(target){initialSelection.current=true;void request('select',{itemId:target}).catch(cause=>setError(cause.message));}},[writable,initialShotId,editor?.shots]);
  leave.current=()=>{void save(true);};
  return <section className={`embedded-studio${focused?' is-focused':''}`} aria-label="整期剪辑工作台" data-episode={episodeId}>
    <header><div><p>剪辑工作台 / OpenChatCut</p><h2>{title}</h2></div><div><span role="status">{!writable?everWritable.current?'编辑连接已变化，当前修改仍保留。请在最新窗口继续。':'正在连接编辑器…':saved?<><Check size={14}/>工作版本已保存</>:'编辑器已连接'}</span><button aria-pressed={focused} onClick={()=>setFocused(v=>!v)}>{focused?<Minimize2 size={14}/>:<Maximize2 size={14}/>}专注剪辑</button>{(editor?.structureEnabled||captionEditor||panels.length>0)&&<button aria-expanded={!!activePanel} onClick={()=>void togglePanel(activePanel??lastPanel.current)}>{activePanel?'收起补充工具':'生成、版本与对齐'}</button>}<button className="embedded-studio-back" disabled={!writable||pending} onClick={()=>void save(true)}><ArrowLeft size={15}/>返回生产单</button><button className="embedded-studio-save" disabled={!writable||pending} onClick={()=>void save()}>{pending?<LoaderCircle size={15}/>:<Save size={15}/>}保存工作版本</button></div></header>
    {selectedSoundIntent&&<p className="embedded-studio-sound-intent" aria-label="当前镜头音效意图">音效意图：{selectedSoundIntent}</p>}
    {error&&<p role="alert" className="form-error">{error}</p>}
    {!src?<p role="alert">Studio 地址或工程身份不匹配，未加载编辑器。</p>:<div className={`embedded-studio-body${activePanel?' panel-open':''}${railCollapsed?' rail-collapsed':''}`}><WorkspaceShotRail shots={editor?.shots??shots.map(shot=>{const items=editor?.items.filter(i=>i.id.startsWith(`shot-${shot.id}-`))??[];return{id:shot.id,text:shot.text,timelineId:'',itemIds:items.map(i=>i.id),startFrame:items[0]?.startFrame??0,durationInFrames:0,effective:true};})} selectedIds={editor?.selectedIds??[]} draftKey={workspace.projectId} editable={editor?.structureEnabled===true} disabled={!writable||pending} onCollapse={setRailCollapsed} select={itemId=>{void request('select',{itemId}).catch(cause=>setError(cause.message));}} edit={bridge.applyEdit}/><div className="embedded-studio-canvas"><iframe key="native-studio" ref={frame} inert={!writable} tabIndex={writable?0:-1} aria-busy={!writable} title="OpenChatCut 剪辑工程" src={src} sandbox="allow-scripts allow-same-origin allow-downloads" allow="fullscreen"/>{!writable&&<div className="embedded-studio-connecting" aria-hidden="true">正在连接编辑器…</div>}</div><aside className="embedded-studio-caption-panel" hidden={!activePanel}><div className="workspace-detail-tabs embedded-inspector-tabs" role="tablist" aria-label="补充工具">{[...(editor?.structureEnabled?[{id:'shot-settings',label:'镜头设置'}]:[]),...(captionEditor?[{id:'captions',label:'字幕对齐'}]:[]),...panels].map(panel=><button key={panel.id} type="button" role="tab" aria-selected={activePanel===panel.id} onClick={()=>{if(activePanel!==panel.id)void togglePanel(panel.id);}}>{panel.label}</button>)}</div><div className="embedded-inspector-content"><div hidden={activePanel!=='shot-settings'}>{editor?.structureEnabled&&(selectedItem&&selectedShot?<WorkspaceNativeControls key={selectedItem.id} shot={selectedShot} item={selectedItem} items={editor.items.filter(i=>selectedShot.itemIds.includes(i.id))} disabled={!writable||pending} edit={bridge.applyEdit}/>:<p className="workspace-shot-settings-empty">在时间线中选中画面片段。</p>)}</div><div hidden={activePanel!=='captions'}>{captionEditor?.(bridge)}</div>{panels.filter(panel=>visitedPanels.current.has(panel.id)).map(panel=><div key={panel.id} hidden={activePanel!==panel.id}>{panel.render(bridge)}</div>)}</div>{history}</aside></div>}
  </section>;
}
