import {useState} from 'react';
import {ArrowLeft,ArrowRight,Upload,Plus,X} from 'lucide-react';
import {ImagePreview} from '../ui/media/ImagePreview';
import {NativeSelect} from '../ui/dan-ui/components/base/select/select-native';
import {videoVisualInputLabels,type VideoGenerationMode,type VideoVisualInputRole} from '../videoVisualInputs';
import {WorkspaceMaterialDrop,useWorkspaceMaterialSelection} from './WorkspaceMaterialDrop';

export interface VideoInputMaterial {
 id:string;
 material_type:string;
 source_path:string;
 storage_path?:string;
 mime_type?:string;
 file_size?:number|string;
}
export type VideoInputDraft=Partial<Record<VideoVisualInputRole,string[]>>;

export function resolveVideoInputs(mode:VideoGenerationMode,ids:readonly string[],materials:VideoInputMaterial[]){
 let imageCount=0;
 const videoLimit=mode.inputs.referenceVideos;
 const hasReferenceVideo=videoLimit&&materials.some(m=>ids.includes(m.id)&&m.storage_path&&m.material_type==='video'&&
  (!m.mime_type||!videoLimit.mimeTypes||videoLimit.mimeTypes.includes(m.mime_type))&&(!videoLimit.maxBytes||!(Number(m.file_size)>videoLimit.maxBytes)));
 const referenced=new Set<string>();
 const includedCounts:Partial<Record<VideoVisualInputRole,number>>={};
 return ids.map((id,index)=>{
  const material=materials.find(entry=>entry.id===id);
  const image=material?.material_type==='image';
  const imageIndex=image?imageCount++:-1;
  const role:VideoVisualInputRole|undefined=mode.id==='references'
   ?image?'referenceImages':material?.material_type==='video'?'referenceVideos':undefined
   :imageIndex===0?'firstFrame':imageIndex===1&&mode.inputs.lastFrame?'lastFrame':undefined;
  const limit=role&&mode.inputs[role];
  const count=role?includedCounts[role]??0:0;
  const reason=!material?.storage_path?'素材已不可用'
   :!limit?'当前模式不使用此素材'
   :material.mime_type&&limit.mimeTypes&&!limit.mimeTypes.includes(material.mime_type)?'格式不兼容'
   :limit.maxBytes&&Number(material.file_size)>limit.maxBytes?'文件大小超过上限'
   :mode.id==='references'&&referenced.has(id)?'与已选参考素材重复'
   :count>=limit.max||mode.maxReferences&&referenced.size>=mode.maxReferences||
    role==='referenceImages'&&hasReferenceVideo&&mode.maxImagesWithVideo&&count>=mode.maxImagesWithVideo?'超过当前模式的数量上限':undefined;
  const label=mode.characterOrder&&!reason?`character${referenced.size+1}`
   :role?videoVisualInputLabels[role]+(role.startsWith('reference')?' '+(count+1):''):undefined;
  if(role&&!reason){includedCounts[role]=count+1;referenced.add(id);}
  return {id,index,material,role,reason,label};
 });
}

const sortType='application/x-loop-video-input-index';

export function WorkspaceVideoInputs({modes,mode,entries,disabled,onMode,onAdd,onRemove,onMove,videoSources,onVideoSource,url,firstFrameFit,ratio,onFit,onUpload,onFiles,compact=false}:{
 modes:readonly VideoGenerationMode[];mode:VideoGenerationMode;entries:ReturnType<typeof resolveVideoInputs>;disabled?:boolean;
 onMode:(id:string)=>void;onAdd:(id:string)=>void;onRemove:(index:number)=>void;onMove:(from:number,to:number)=>void;
 videoSources:Readonly<Record<string,string>>;onVideoSource:(id:string,source:string)=>void;
 url:(path:string)=>string;firstFrameFit:'contain'|'cover';ratio:number;onFit:(fit:'contain'|'cover')=>void;onUpload:()=>void;onFiles:(files:File[])=>void;
 compact?:boolean;
}){
 const shelf=useWorkspaceMaterialSelection();
 const [sorting,setSorting]=useState(false),[fileDrag,setFileDrag]=useState(false);
 const dropLabel=mode.id==='first-frame'?'拖入图片作为首帧'
  :mode.characterOrder||mode.maxImagesWithVideo?'拖入参考图或参考视频':'拖入画面素材';
 return <section className="workspace-video-inputs" aria-label="画面输入">
  {compact&&<button type="button" className="workspace-composer-add" aria-label="添加画面参考素材" disabled={disabled} onClick={()=>{const material=shelf?.materials.find(m=>m.id===shelf.selectedId&&['image','video'].includes(m.material_type));if(material){onAdd(material.id);shelf?.select('');}else onUpload();}}><Plus size={19}/></button>}
  {!compact&&<header className="workspace-video-input-heading">
   <h3>画面输入</h3>
   {modes.length>1?<NativeSelect aria-label="生成模式" size="sm" value={mode.id} disabled={disabled} onChange={event=>onMode(event.target.value)}>
    {modes.map(option=><option key={option.id} value={option.id}>{option.label}</option>)}
   </NativeSelect>:<span>{mode.label}</span>}
  </header>}
  {mode.characterOrder&&<small>图片和视频均需公开 HTTPS 地址，素材顺序对应 character1、character2…</small>}
  <div className="workspace-first-frame-row workspace-video-input-area" role="group" aria-label="画面素材" tabIndex={-1}
   onDragOver={event=>{if(!disabled&&event.dataTransfer.types?.includes('Files')){event.preventDefault();event.dataTransfer.dropEffect='copy';setFileDrag(true);}}}
   onDragLeave={event=>{if(!(event.relatedTarget instanceof Node)||!event.currentTarget.contains(event.relatedTarget))setFileDrag(false);}}
   onDrop={event=>{setFileDrag(false);if(!event.defaultPrevented&&!disabled&&event.dataTransfer.files?.length){event.preventDefault();onFiles([...event.dataTransfer.files]);}}}>
   <div className="workspace-video-input-thumbnails">
    {entries.map(({index,material,role,reason,label})=>{
     const name=material?.source_path.split('/').pop()??'素材已不可用';
     return <div key={index} className="workspace-video-input-card" data-excluded={!!reason||undefined}
      draggable={!disabled&&entries.length>1}
      onDragStart={event=>{event.dataTransfer.setData(sortType,String(index));event.dataTransfer.effectAllowed='move';setSorting(true);}}
      onDragEnd={()=>setSorting(false)}
      onDragOver={event=>{if(!disabled&&event.dataTransfer.types.includes(sortType)){event.preventDefault();event.dataTransfer.dropEffect='move';}}}
      onDrop={event=>{const value=event.dataTransfer.getData(sortType);if(!disabled&&value!==''){event.preventDefault();onMove(Number(value),index);setSorting(false);}}}>
      <div className="workspace-first-frame-thumbnail">
       {material?.storage_path&&(material.material_type==='image'
        ?<ImagePreview src={url(material.storage_path)} alt={role==='firstFrame'?'已选视频首帧':role==='lastFrame'?'已选视频尾帧':'画面输入 · '+name}
         style={role==='firstFrame'?{objectFit:firstFrameFit,aspectRatio:ratio,width:Math.min(180,112*ratio)}:undefined}/>
        :<video src={url(material.storage_path)} muted preload="metadata" aria-label={name}/>)}
       <button type="button" className="workspace-thumbnail-remove" aria-label={role==='firstFrame'?'清除首帧':`移除 ${name}`} disabled={disabled}
        onClick={event=>{event.currentTarget.closest<HTMLElement>('[role="group"]')?.focus();onRemove(index);}}><X size={12} aria-hidden="true"/></button>
      </div>
      <div className="workspace-video-input-caption" title={reason?`${name} · ${reason}`:name}>
       <span>{reason?'本次不会提交':label}</span>
       {entries.length>1&&<div>
        <button type="button" disabled={disabled||index===0} aria-label={`前移 ${name}`} onClick={()=>onMove(index,index-1)}><ArrowLeft size={12}/></button>
        <button type="button" disabled={disabled||index===entries.length-1} aria-label={`后移 ${name}`} onClick={()=>onMove(index,index+1)}><ArrowRight size={12}/></button>
       </div>}
      </div>
      {reason&&<small>{name} · {reason}</small>}
     </div>;
    })}
   </div>
   {!compact&&entries.length>0&&<button type="button" className="workspace-video-input-upload" aria-label="上传画面素材" title="上传画面素材" disabled={disabled} onClick={onUpload}>
    <Upload size={16} aria-hidden="true"/>
   </button>}
   {!compact&&!sorting&&<WorkspaceMaterialDrop label={dropLabel} kind="visual" surface="preview" persistent={!entries.length||fileDrag} disabled={disabled}
    onSelect={onAdd} onBrowse={onUpload} onFiles={onFiles}/>}
  </div>
  {entries.filter(entry=>!entry.reason&&(entry.role==='referenceVideos'||entry.role==='referenceImages'&&mode.referenceImageSource)).map(({id,material,role,label})=><label key={id}>
   {mode.characterOrder?`${label} 地址`:role==='referenceVideos'?'参考视频地址':'参考图地址'} · {material?.source_path.split('/').pop()}
   <input type="text" maxLength={2048} disabled={disabled} placeholder={mode.allowAssetVideoSource?'HTTPS 地址或 asset:// 素材 ID':mode.allowInlineMp4&&material?.mime_type==='video/mp4'?'可留空，使用已选 MP4':'可公开访问的 HTTPS 地址'}
    value={videoSources[id]??''} onChange={event=>onVideoSource(id,event.target.value)}/>
  </label>)}
  {mode.inputs.firstFrame&&!compact&&<label>首帧构图<NativeSelect size="sm" aria-label="首帧构图" disabled={disabled} value={firstFrameFit}
   onChange={event=>onFit(event.target.value as 'contain'|'cover')}>
   <option value="contain">完整保留，必要时留边</option><option value="cover">居中裁切，填满画面</option>
  </NativeSelect></label>}
 </section>;
}
