import {uiText} from '../i18n/ui';
import type {WorkspaceShot} from '../workspaceShots';
import {useEffect,useRef,useState} from 'react';
import {ArrowLeft,Check,LoaderCircle,Save,Maximize2,Minimize2} from 'lucide-react';
import {Button as AriaButton} from 'react-aria-components';
import {Tooltip} from '../ui/dan-ui/components/base/tooltip/tooltip';
import type {OpenChatCutStudioWorkspace} from '../reviews/reviewRevision';
import './embedded-studio.css';
export interface EmbeddedStudioSession {studioUrl:string;workspace:OpenChatCutStudioWorkspace;sourcePath:string;launchId?:string}
interface WorkspaceNativeItem {id:string;kind?:string;startFrame:number;durationInFrames:number}
interface EditorState {writable?:boolean;shots?:WorkspaceShot[];revision:number;selectedIds:string[];items:WorkspaceNativeItem[]}
export function EmbeddedStudioHost({episodeId,title,session,onSave,onClose,initialShotId,initialItemId}:{episodeId:string;title:string;session:EmbeddedStudioSession;onSave:(workspace:OpenChatCutStudioWorkspace)=>Promise<OpenChatCutStudioWorkspace>;onClose:(destination:'preparation'|'delivery',selection?:{shotId:string;itemId:string})=>void|Promise<void>;initialShotId?:string;initialItemId?:string}){
  const frame=useRef<HTMLIFrameElement>(null),[channel]=useState(()=>crypto.randomUUID());
  const [workspace,setWorkspace]=useState(session.workspace),[editor,setEditor]=useState<EditorState|null>(null),[pending,setPending]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState(false),[focused,setFocused]=useState(false);
  const writable=editor?.writable===true;
  const writableRef=useRef(false);
  const lastShotSelection=useRef<{shotId:string;itemId:string}|undefined>(undefined);
  const workspaceRef=useRef(session.workspace),pendingRef=useRef(false),everWritable=useRef(false);
  const visit=useRef(0);
  useEffect(()=>{visit.current++;return()=>{visit.current++;};},[]);
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
        setEditor({writable:data.writable===true,shots:Array.isArray(data.shots)?data.shots:undefined,revision:data.revision,items:data.items,selectedIds:data.selectedIds});setSaved(false);
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
  function request<T=void>(action:'flush'|'select',payload:Record<string,unknown>={}){
    return new Promise<T>((resolve,reject)=>{
      if(!editor||!frame.current?.contentWindow||!origin){reject(new Error('编辑器尚未连接。'));return;}
      const requestId=crypto.randomUUID();
      const timer=setTimeout(()=>{requests.current.delete(requestId);reject(new Error('编辑器未确认操作，请检查编辑器状态后重试。'));},15000);
      requests.current.set(requestId,{resolve:value=>resolve(value as T),reject,timer});
      frame.current.contentWindow.postMessage({type:'loop-control:command',channel,projectId:workspace.projectId,requestId,action,...payload},origin);
    });
  }
  async function saveBoundary(generation:number){
    await request('flush');checkVisit(generation);const next=await onSave(workspaceRef.current);checkVisit(generation);remember(next);
  }
  async function saveCurrent(){
    const generation=begin();
    try{await saveBoundary(generation);}
    catch(cause){if(generation===visit.current)setError(cause instanceof Error?cause.message:'保存未完成，当前修改仍保留。');throw cause;}
    finally{if(generation===visit.current)finish();}
  }
  async function saveAndLeave(destination:'preparation'|'delivery'){
    if(pendingRef.current||!writableRef.current)return;
    const generation=begin();
    try{await saveBoundary(generation);checkVisit(generation);await onClose(destination,lastShotSelection.current);}
    catch(cause){if(generation===visit.current)setError(cause instanceof Error?cause.message:'保存未完成，当前修改仍保留。');}
    finally{if(generation===visit.current)finish();}
  }
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
        <button type="button" disabled={!writable||pending} onClick={()=>void saveAndLeave('delivery')}>{uiText('生成成片')}</button>
        <button className="embedded-studio-save" disabled={!writable||pending} onClick={()=>{void saveCurrent().catch(()=>{});}}>{pending?<LoaderCircle size={15} aria-hidden="true"/>:<Save size={15} aria-hidden="true"/>}{pending?uiText("保存中…"):uiText("保存")}</button>
      </nav>
    </header>
    {error&&<p role="alert" className="form-error">{uiText(error||'')}</p>}
    {!src?<p role="alert">{uiText("Studio 地址或工程身份不匹配，未加载编辑器。")}</p>:<div className="embedded-studio-body"><div className="embedded-studio-canvas"><iframe key="native-studio" ref={frame} inert={!writable||pending} tabIndex={writable&&!pending?0:-1} aria-busy={!writable||pending} title={uiText("OpenChatCut 剪辑工程")} src={src} sandbox="allow-scripts allow-same-origin allow-downloads" allow="fullscreen"/>{!writable&&<div className="embedded-studio-connecting" aria-hidden="true">{uiText("正在连接编辑器…")}</div>}</div></div>}
  </section>;
}
