import {uiText} from '../i18n/ui';
import {useWorkspaceMaterialSelection,workspaceMaterialDragType} from './WorkspaceMaterialDrop';
import {useEffect,useId,useRef,useState,type PointerEvent} from 'react';
import {AudioLines,ChevronDown,ChevronUp,Film,FileText,Image as ImageIcon,Maximize2,Upload,X} from 'lucide-react';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import {Dialog,Modal,ModalOverlay} from 'react-aria-components';
import {WorkspaceUploadToast,type UploadNotice} from './WorkspaceUploadFeedback';
import './workspace-material-shelf.css';

const images = '.png,.jpg,.jpeg,.webp,.bmp';
const videos = '.mp4,.mov,.webm';
const audio = '.mp3';
const supportedMedia=[images,videos,audio].join(',');

type ShelfMaterial = {id:string;material_type:string;source_path:string;storage_path:string;material_purpose?:string|null};
const media = {image:{get label(){return uiText("图片");},icon:ImageIcon},video:{get label(){return uiText("视频");},icon:Film},audio:{get label(){return uiText("音频");},icon:AudioLines},script:{get label(){return uiText("脚本");},icon:FileText}};
const audioLabels:Record<string,string> = {get narration(){return uiText("口播");},get background_music(){return uiText("配乐");},get sound_effect(){return uiText("音效");}};
const minHeight = 160;
const defaultHeight = 360;
const maxHeight = 440;
const clampHeight = (height:number) => Math.min(maxHeight, Math.max(minHeight,height));
const fileName = (material:ShelfMaterial) => material.source_path.split('/').pop() || material.source_path;

interface Props {
 episodeId:string;
 shotCount:number;
 scriptRevisionId?:string|null;
 materials:readonly ShelfMaterial[];
 readOnly:boolean;
 busy:boolean;
 status:string;
 failures:readonly string[];
 onImport:(files:File[])=>Promise<unknown>;
 onRetry?:()=>void;
 onAbandon?:()=>void;
 notice?:UploadNotice;
 onDismissNotice?:(id:number)=>void;
}

export function WorkspaceMaterialShelf({episodeId,shotCount,scriptRevisionId,materials,readOnly,busy,status,failures,onImport,onRetry,onAbandon,notice,onDismissNotice=()=>{}}:Props){
 const shelf=useWorkspaceMaterialSelection();
 const [open,setOpen]=useState(false);
 const [height,setHeight]=useState(defaultHeight);
 const [resizing,setResizing]=useState(false);
 const [dragOver,setDragOver]=useState(false);
 const [previewId,setPreviewId]=useState(''),[filter,setFilter]=useState('all'),[showPreview,setShowPreview]=useState(false);
 const input=useRef<HTMLInputElement>(null);
 const resize=useRef<{pointer:number;y:number;height:number}|null>(null);
 const drawer=useRef<HTMLElement>(null);
 const feedback=useRef<HTMLDivElement>(null);
 const toggle=useRef<HTMLButtonElement>(null);
 const id=useId();
 const files=materials.filter(m=>m.material_type in media&&(m.material_type!=='script'||scriptRevisionId===undefined||m.id===scriptRevisionId));
 const preview=files.find(m=>m.id===previewId),selected=files.find(m=>m.id===(shelf&&!readOnly?shelf.selectedId:previewId));
 const filtered=files.filter(m=>filter==='all'||m.material_type===filter);
 const uploadDisabled=readOnly||busy;

 function beginResize(event:PointerEvent<HTMLDivElement>){
  if(event.button!==0||!drawer.current)return;
  event.preventDefault();
  event.currentTarget.focus();
  event.currentTarget.setPointerCapture(event.pointerId);
  resize.current={pointer:event.pointerId,y:event.clientY,height:drawer.current.getBoundingClientRect().height};
  setResizing(true);
 }

 return <div className={'workspace-material-shelf'+(dragOver?' is-drop-target':'')} onDragOver={event=>{
  if(!event.dataTransfer.types.includes('Files'))return;
  event.preventDefault();
  event.dataTransfer.dropEffect=uploadDisabled?'none':'copy';
  if(!uploadDisabled)setDragOver(true);
 }} onDragLeave={event=>{
  if(!(event.relatedTarget instanceof Node)||!event.currentTarget.contains(event.relatedTarget))setDragOver(false);
 }} onDrop={event=>{
  if(!event.dataTransfer.files.length)return;
  event.preventDefault();
  setDragOver(false);
  if(uploadDisabled)return;
  setOpen(true);
  void onImport(Array.from(event.dataTransfer.files));
 }} onKeyDown={event=>{
  if(event.key==='Escape'&&open&&!event.defaultPrevented){
   event.stopPropagation();
   setOpen(false);
   toggle.current?.focus();
  }
 }}>
  <div className="workspace-table-footer">
   <span>{shotCount}{uiText(" 个镜头")}</span>
   <Button ref={toggle} type="button" size="sm" color="tertiary" iconTrailing={open?ChevronDown:ChevronUp}
    aria-label={open?uiText("收起本期素材"):undefined} aria-expanded={open} aria-controls={id} onPress={()=>setOpen(value=>!value)}>{uiText("本期素材 · {value0}",{value0:String(files.length)})}</Button>
  </div>
  {open&&<section ref={drawer} id={id} className="workspace-material-inventory"
   aria-label={uiText("本期素材")} style={{blockSize:height}}>
   <div className="workspace-material-grip" data-resizing={resizing||undefined} role="separator" aria-label={uiText("调整素材面板高度")} aria-orientation="horizontal"
    aria-valuemin={minHeight} aria-valuemax={maxHeight} aria-valuenow={height} tabIndex={0} onPointerDown={beginResize}
    onPointerMove={event=>{
     const start=resize.current;
     if(start?.pointer===event.pointerId)setHeight(clampHeight(start.height+start.y-event.clientY));
    }} onLostPointerCapture={()=>{resize.current=null;setResizing(false);}} onDoubleClick={()=>setHeight(defaultHeight)}
    onKeyDown={event=>{
     if(!['ArrowUp','ArrowDown','Home','End'].includes(event.key))return;
     event.preventDefault();
     setHeight(value=>event.key==='Home'?minHeight:event.key==='End'?maxHeight:clampHeight(value+(event.key==='ArrowUp'?16:-16)));
    }}><span aria-hidden="true"/></div>
   <header className="workspace-material-heading">
    <div className="workspace-material-filters" role="group" aria-label={uiText("素材类型")}>{[['all','全部'],['image','图片'],['video','视频'],['audio','音频'],['script','脚本']].map(([value,label])=><button type="button" key={value} aria-pressed={filter===value} onClick={()=>setFilter(value)}>{label}</button>)}</div>
    <div className="workspace-material-heading-actions">
    {!readOnly&&<Button size="xs" color="tertiary" className="workspace-material-import" noTextPadding iconLeading={Upload}
     isDisabled={uploadDisabled} onPress={()=>input.current?.click()}>{uiText("导入本期素材")}</Button>}</div>
   </header>
   {!readOnly&&<input ref={input} hidden type="file" multiple accept={supportedMedia} aria-label={uiText("上传制作素材")} onChange={event=>{
    const selected=Array.from(event.currentTarget.files??[]);
    event.currentTarget.value='';
    if(selected.length)void onImport(selected);
   }}/>}
   {(status||failures.length>0)&&<div ref={feedback} tabIndex={-1} aria-label={uiText("素材导入结果")} className="workspace-material-feedback">
    <div className="workspace-material-feedback-header">{status&&<div role="status">{status}</div>}
     {failures.length>0&&<div className="workspace-upload-actions">{onAbandon&&<Button size="sm" color="tertiary" isDisabled={uploadDisabled} onPress={onAbandon}>{uiText("放弃未完成项")}</Button>}{onRetry&&<Button size="sm" color="secondary" isDisabled={uploadDisabled} onPress={onRetry}>{uiText("重试未完成项")}</Button>}</div>}</div>
    {failures.length>0&&<ul role="alert">{failures.map((failure,index)=><li key={index}>{failure}</li>)}</ul>}
   </div>}
   <div className="workspace-material-content">
    {filtered.length?<ul className="workspace-material-list" aria-label={uiText("素材清单")}>
     {filtered.map(material=>{
      const kind=media[material.material_type as keyof typeof media],Icon=kind.icon,name=fileName(material),label=material.material_purpose&&audioLabels[material.material_purpose]||kind.label;
      const src='/_local-artifact?'+new URLSearchParams({episode:episodeId,path:material.storage_path});
      return <li key={material.id}><button className="workspace-material-select" type="button" aria-label={uiText("预览 {value0}",{value0:String(name)})} aria-pressed={shelf&&!readOnly?shelf.selectedId===material.id:previewId===material.id}
       draggable={!!shelf&&!readOnly&&material.material_type!=='script'} data-picked={shelf?.selectedId===material.id||undefined} title={`${name} · ${label}`}
       onDragStart={event=>{if(!shelf||readOnly||material.material_type==='script'){event.preventDefault();return;}event.dataTransfer.setData(workspaceMaterialDragType,material.id);event.dataTransfer.effectAllowed='copy';shelf.select('');shelf.drag(material.id);}} onDragEnd={()=>shelf?.drag('')}
       onClick={()=>{setPreviewId(material.id);if(!readOnly)shelf?.select(shelf.selectedId===material.id?'':material.id);}}
       onDoubleClick={()=>{setPreviewId(material.id);setShowPreview(true);}}>
       <span className="workspace-material-thumb">{material.material_type==='image'?<img src={src} alt="" loading="lazy"/>:material.material_type==='video'?<><video src={`${src}#t=0.001`} muted playsInline preload="metadata"/><Film size={15} className="workspace-material-video-mark" aria-hidden="true"/></>:<Icon size={material.material_type==='audio'?34:28} aria-hidden="true"/>}</span>
       <span className="workspace-material-name">{name}</span>
      </button><button type="button" className="workspace-material-open-preview" aria-label={uiText("预览素材 {value0}",{value0:String(name)})} title={uiText("预览素材")} onClick={()=>{setPreviewId(material.id);setShowPreview(true);}}><Maximize2 size={16} aria-hidden="true"/></button></li>;
     })}
    </ul>:<p className="workspace-material-empty">{files.length?uiText("此类型暂无素材"):readOnly?uiText("暂无素材"):uiText("可拖入图片、视频或 MP3，每个文件不超过 100 MB。")}</p>}
   </div>
   <div className="workspace-material-selection-note"><span>{selected?uiText("已选 {value0}",{value0:String(fileName(selected))}):uiText("拖入右侧输入框，或先选素材再添加")}</span></div>
   {showPreview&&preview&&<ModalOverlay className="modal-backdrop dan-ui product-ui" isOpen isDismissable onOpenChange={setShowPreview}><Modal className="modal-card workspace-material-modal"><Dialog aria-label={fileName(preview)}><header><h3>{fileName(preview)}</h3><Button size="xs" color="tertiary" className="workspace-material-preview-close" aria-label={uiText("关闭素材预览")} iconLeading={X} onPress={()=>setShowPreview(false)}/></header><div className="workspace-material-preview"><MaterialPreview key={preview.id} episodeId={episodeId} material={preview}/></div></Dialog></Modal></ModalOverlay>}
   {dragOver&&<div className="workspace-material-upload-overlay">{uiText("松开导入素材")}</div>}
  </section>}
  <WorkspaceUploadToast notice={notice} onDismiss={onDismissNotice} onView={failures.length?()=>{setOpen(true);requestAnimationFrame(()=>feedback.current?.focus());}:undefined}/>
 </div>;
}

function MaterialPreview({episodeId,material}:{episodeId:string;material:ShelfMaterial}){
 const [failed,setFailed]=useState(false);
 const [duration,setDuration]=useState<number>(),[script,setScript]=useState('');
 const name=fileName(material);
 const src='/_local-artifact?'+new URLSearchParams({episode:episodeId,path:material.storage_path});
 useEffect(()=>{if(material.material_type!=='script')return;const controller=new AbortController();void fetch(src,{signal:controller.signal}).then(async response=>{if(!response.ok)throw Error();setScript(await response.text());}).catch(()=>{if(!controller.signal.aborted)setFailed(true);});return()=>controller.abort();},[src,material.material_type]);
 const onError=()=>setFailed(true);
 const onLoadedMetadata=(event:React.SyntheticEvent<HTMLMediaElement>)=>{
  if(Number.isFinite(event.currentTarget.duration))setDuration(event.currentTarget.duration);
 };
 return <>
  {failed||!material.storage_path?<p>{uiText("无法预览此素材")}</p>:material.material_type==='script'?<pre>{script||uiText("正在读取脚本…")}</pre>:material.material_type==='image'
   ?<img src={src} alt={name} onError={onError}/>
   :material.material_type==='video'
    ?<video src={src} controls playsInline preload="metadata" aria-label={name} onError={onError} onLoadedMetadata={onLoadedMetadata}/>
    :<audio src={src} controls preload="metadata" aria-label={uiText("试听 {value0}",{value0:String(name)})} onError={onError} onLoadedMetadata={onLoadedMetadata}/>}
  <p title={name}>{name}{duration!==undefined&&uiText(" · {value0} 秒",{value0:String(duration.toFixed(1))})}</p>
 </>;
}
