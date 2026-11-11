import {uiText} from '../i18n/ui';
import type {WorkspaceNativeItem} from './WorkspaceNativeControls';
import {WorkspaceShotRail} from './WorkspaceShotRail';
import type {WorkspaceShot,WorkspaceShotOperation} from '../workspaceShots';
import {useEffect,useRef,useState,type ReactNode} from 'react';
import {readWorkspaceCaption} from '../workspaceCaptions';
import type {ShotCaptionContract} from '../shotCaptions';
import type {OpenChatCutProject} from '../worker/openchatcutProject';
import {ArrowLeft,Check,LoaderCircle,Save,Maximize2,Minimize2} from 'lucide-react';
import {Button as AriaButton} from 'react-aria-components';
import {Tooltip} from '../ui/dan-ui/components/base/tooltip/tooltip';
import type {OpenChatCutStudioWorkspace} from '../reviews/reviewRevision';
import './embedded-studio.css';
export interface EmbeddedStudioSession {studioUrl:string;workspace:OpenChatCutStudioWorkspace;sourcePath:string;launchId?:string}
export interface EmbeddedStudioBridge {selectedShotId?:string;connected:boolean;inspect:()=>Promise<{revision:number;documentFingerprint:string;document:OpenChatCutProject}>;applyCaptions:(itemId:string,contract:ShotCaptionContract,timingOnly?:boolean)=>Promise<ShotCaptionContract>;save:()=>Promise<void>;applyEdit:(operation:WorkspaceShotOperation)=>Promise<OpenChatCutProject>;applyNativeEdit:(action:'apply-workspace-edit'|'apply-candidate'|'apply-audio-mix'|'add-registered-source',payload:Record<string,unknown>)=>Promise<OpenChatCutProject>}
interface EditorState {writable?:boolean;structureEnabled?:boolean;shots?:WorkspaceShot[];revision:number;selectedIds:string[];items:WorkspaceNativeItem[]}
export function EmbeddedStudioHost({episodeId,title,session,shots,onSave,onClose,captionEditor,initialShotId,initialItemId,history}:{episodeId:string;title:string;session:EmbeddedStudioSession;shots:Array<{id:string;text:string;soundIntent?:string}>;onSave:(workspace:OpenChatCutStudioWorkspace)=>Promise<OpenChatCutStudioWorkspace>;onClose:(destination:'preparation'|'delivery',selection?:{shotId:string;itemId:string})=>void|Promise<void>;captionEditor?:(bridge:EmbeddedStudioBridge)=>ReactNode;initialShotId?:string;initialItemId?:string;history?:ReactNode}){
  const frame=useRef<HTMLIFrameElement>(null),[channel]=useState(()=>crypto.randomUUID());
  const [workspace,setWorkspace]=useState(session.workspace),[editor,setEditor]=useState<EditorState|null>(null),[pending,setPending]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState(false),[requestedPanel,setActivePanel]=useState<'captions'|null>(null),[railCollapsed,setRailCollapsed]=useState(false),[focused,setFocused]=useState(false);
  const activePanel=captionEditor?requestedPanel:null;
  useEffect(()=>{if(requestedPanel!==activePanel)setActivePanel(activePanel);},[requestedPanel,activePanel]);
  const writable=editor?.writable===true;
  const writableRef=useRef(false);
  const lastShotSelection=useRef<{shotId:string;itemId:string}|undefined>(undefined);
  const captionAvailable=useRef(false);
  captionAvailable.current=!!captionEditor;
  const workspaceRef=useRef(session.workspace),pendingRef=useRef(false),everWritable=useRef(false);
  const captionReceipt=useRef<{key:string;documentFingerprint:string;contract:ShotCaptionContract}|null>(null);
  const visit=useRef(0);
  useEffect(()=>{visit.current++;return()=>{visit.current++;captionReceipt.current=null;};},[]);
  function checkVisit(generation:number){if(generation!==visit.current)throw Object.assign(Error('编辑器访问已结束。'),{name:'AbortError'});}
  function remember(next:OpenChatCutStudioWorkspace){workspaceRef.current=next;setWorkspace(next);setSaved(true);}
  function begin(){if(!writableRef.current)throw Error('编辑器写连接尚未就绪，请稍后重试。');if(pendingRef.current)throw Error('请等待当前保存完成。');pendingRef.current=true;setPending(true);setError('');return visit.current;}
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
        const item=data.items.find((entry:WorkspaceNativeItem)=>data.selectedIds.includes(entry.id));
        const shot=item&&(Array.isArray(data.shots)?data.shots as WorkspaceShot[]:[]).find(entry=>entry.itemIds.includes(item.id));
        if(shot)lastShotSelection.current={shotId:shot.id,itemId:item.id};
        writableRef.current=data.writable===true;if(data.writable===true)everWritable.current=true;
        setEditor({writable:data.writable===true,structureEnabled:data.structureEnabled===true,shots:Array.isArray(data.shots)?data.shots:undefined,revision:data.revision,items:data.items,selectedIds:data.selectedIds});setSaved(false);
      }else if(data.type==='loop-control:import-requested'){if(writableRef.current)setError('请返回分镜台，从「本期素材」导入文件。');}
      else if(data.type==='loop-control:caption-alignment-requested'){
        if(!writableRef.current)return;
        if(captionAvailable.current)setActivePanel('captions');
        else setError('本期没有启用字幕。');
      }
      else if(data.type==='loop-control:caption-library-closed'){
        setActivePanel(panel=>panel==='captions'?null:panel);
      }
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
  async function saveAndLeave(destination:'preparation'|'delivery'){
    if(pendingRef.current||!writableRef.current)return;
    const generation=begin();
    try{
      await request('flush');checkVisit(generation);
      const next=await onSave(workspaceRef.current);checkVisit(generation);
      remember(next);await onClose(destination,lastShotSelection.current);
    }catch(cause){if(generation===visit.current)setError(cause instanceof Error?cause.message:'保存未完成，当前修改仍保留。');}
    finally{if(generation===visit.current)finish();}
  }
  async function applyNativeEdit(action:'apply-workspace-edit'|'apply-candidate'|'apply-audio-mix'|'add-registered-source',payload:Record<string,unknown>){
    const generation=begin();
    try{
      const current=await request<{revision:number;documentFingerprint:string}>('inspect');checkVisit(generation);
      const applied=await request<{document:OpenChatCutProject}>(action,{...payload,expectedRevision:current.revision,expectedDocumentFingerprint:current.documentFingerprint});checkVisit(generation);
      const next=await onSave(workspaceRef.current);checkVisit(generation);remember(next);return applied.document;
    }catch(cause){if(generation===visit.current)setError(cause instanceof Error?cause.message:'修改未保存，当前编辑仍保留。');throw cause;}
    finally{if(generation===visit.current)finish();}
  }
  const selectedItem=editor?.items.find(i=>editor.selectedIds.includes(i.id)),selectedShot=editor?.shots?.find(s=>s.itemIds.includes(selectedItem?.id??''));
  const selectedSoundIntent=shots.find(shot=>shot.id===selectedShot?.id)?.soundIntent;
  const bridge:EmbeddedStudioBridge={selectedShotId:selectedShot?.id,connected:writable&&!pending,applyNativeEdit,applyEdit:operation=>applyNativeEdit('apply-workspace-edit',{operation}),inspect:()=>request('inspect'),save:async()=>{
    const generation=begin();
    try{await request('flush');checkVisit(generation);const next=await onSave(workspaceRef.current);checkVisit(generation);remember(next);}
    catch(cause){if(generation===visit.current)setError(cause instanceof Error?cause.message:'保存未完成，当前修改仍保留。');throw cause;}
    finally{if(generation===visit.current)finish();}
  },applyCaptions:async(itemId,contract,timingOnly=false)=>{
    const generation=begin();
    try{
      const current=await request<{revision:number;documentFingerprint:string}>('inspect');checkVisit(generation);
      const key=JSON.stringify({itemId,contract,timingOnly});
      let receipt=captionReceipt.current;
      if(receipt?.key===key){
        if(current.documentFingerprint!==receipt.documentFingerprint){captionReceipt.current=null;throw Error('工程已有新修改，请核对字幕后重新操作。');}
      }else{
        const applied=await request<{document:OpenChatCutProject;documentFingerprint:string}>('apply-captions',{itemId,contract,timingOnly,expectedRevision:current.revision,expectedDocumentFingerprint:current.documentFingerprint});checkVisit(generation);
        const caption=readWorkspaceCaption(applied.document,itemId);
        if(!caption)throw Error('编辑器未返回当前字幕。');
        receipt={key,documentFingerprint:applied.documentFingerprint,contract:caption.contract};
        captionReceipt.current=receipt;
      }
      const next=await onSave(workspaceRef.current);checkVisit(generation);remember(next);captionReceipt.current=null;return receipt.contract;
    }catch(cause){if(generation===visit.current)setError((captionReceipt.current?'字幕已写入编辑器，工程保存尚未确认。':'')+(cause instanceof Error?cause.message:'字幕保存失败。'));throw cause;}
    finally{if(generation===visit.current)finish();}
  }};
  async function togglePanel(id:'captions'){const next=activePanel===id?null:id;try{if(editor?.structureEnabled)await request('host-panel',{open:!!next});setActivePanel(next);}catch(cause){setError(cause instanceof Error?cause.message:'原生面板尚未就绪，请重试。');}}
  useEffect(()=>{if(editor?.structureEnabled)void request('host-panel',{open:!!activePanel}).catch(()=>{});},[activePanel,editor?.structureEnabled]);
  const initialSelection=useRef(false);
  useEffect(()=>{if(initialSelection.current||!writable||!initialShotId)return;const items=editor?.shots?.find(s=>s.id===initialShotId)?.itemIds;const target=initialItemId&&items?.includes(initialItemId)?initialItemId:items?.[0];if(target){initialSelection.current=true;void request('select',{itemId:target}).catch(cause=>setError(cause.message));}},[writable,initialShotId,initialItemId,editor?.shots]);
  leave.current=()=>{void saveAndLeave('preparation');};
  return <section className={`embedded-studio${focused?' is-focused':''}`} aria-label={uiText("整期剪辑工作台")} data-episode={episodeId}>
    <header className="embedded-studio-header">
      <Tooltip title={uiText("保存并返回分镜台")} className="dan-ui dan-ui-tooltip">
        <AriaButton className="embedded-studio-back" aria-label={uiText("保存并返回分镜台")} isDisabled={!writable||pending} onPress={()=>void saveAndLeave('preparation')}><ArrowLeft size={16} aria-hidden="true"/></AriaButton>
      </Tooltip>
      <section className="embedded-studio-identity" aria-label={uiText("当前剪辑工程")}>
        <h2 title={title}>{title}</h2>
        <span role="status">{!writable?everWritable.current?uiText("编辑连接已变化，当前修改仍保留。请在最新窗口继续。"):uiText("正在连接编辑器…"):saved?<><Check size={14} aria-hidden="true"/>{uiText("工作版本已保存")}</>:null}</span>
      </section>
      <nav className="embedded-studio-actions" aria-label={uiText("剪辑操作")}>
        <Tooltip title={focused?uiText("退出专注剪辑"):uiText("专注剪辑")} className="dan-ui dan-ui-tooltip"><AriaButton className="embedded-studio-focus" aria-label={focused?uiText("退出专注剪辑"):uiText("专注剪辑")} aria-pressed={focused} onPress={()=>setFocused(v=>!v)}>{focused?<Minimize2 size={16} aria-hidden="true"/>:<Maximize2 size={16} aria-hidden="true"/>}</AriaButton></Tooltip>
        <button className="embedded-studio-save" disabled={!writable||pending} onClick={()=>void saveAndLeave('delivery')}>{pending?<LoaderCircle size={15} aria-hidden="true"/>:<Save size={15} aria-hidden="true"/>}{pending?uiText("保存中…"):uiText("保存")}</button>
      </nav>
    </header>
    {selectedSoundIntent&&<p className="embedded-studio-sound-intent" aria-label={uiText("当前镜头音效意图")}>{uiText("音效意图：")}{selectedSoundIntent}</p>}
    {error&&<p role="alert" className="form-error">{uiText(error||'')}</p>}
    {!src?<p role="alert">{uiText("Studio 地址或工程身份不匹配，未加载编辑器。")}</p>:<div className={`embedded-studio-body${activePanel?' panel-open':''}${railCollapsed?' rail-collapsed':''}`}><WorkspaceShotRail shots={editor?.shots??shots.map(shot=>{const items=editor?.items.filter(i=>i.id.startsWith(`shot-${shot.id}-`))??[];return{id:shot.id,text:shot.text,timelineId:'',itemIds:items.map(i=>i.id),startFrame:items[0]?.startFrame??0,durationInFrames:0,effective:true};})} selectedIds={editor?.selectedIds??[]} draftKey={workspace.projectId} editable={editor?.structureEnabled===true} disabled={!writable||pending} onCollapse={setRailCollapsed} select={itemId=>{void request('select',{itemId}).catch(cause=>setError(cause.message));}} edit={bridge.applyEdit}/><div className="embedded-studio-canvas"><iframe key="native-studio" ref={frame} inert={!writable} tabIndex={writable?0:-1} aria-busy={!writable} title={uiText("OpenChatCut 剪辑工程")} src={src} sandbox="allow-scripts allow-same-origin allow-downloads" allow="fullscreen"/>{!writable&&<div className="embedded-studio-connecting" aria-hidden="true">{uiText("正在连接编辑器…")}</div>}</div><aside className="embedded-studio-caption-panel" hidden={!activePanel}>
      <header className="workspace-detail-tabs embedded-inspector-tabs"><strong>{uiText("字幕")}</strong><button type="button" onClick={()=>void togglePanel('captions')}>{uiText("关闭字幕对齐")}</button></header>
      <div className="embedded-inspector-content">
       {activePanel==='captions'&&captionEditor?.(bridge)}
</div>{history}</aside></div>}
  </section>;
}
