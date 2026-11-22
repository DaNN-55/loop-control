import {useId,useRef,useState} from 'react';
import {Check,ChevronRight,Image as ImageIcon,Upload} from 'lucide-react';
import type {ProductionWorkspace} from '../productionWorkspace';
import type {useWorkspacePublication} from './useWorkspacePublication';
import {VideoPreview} from '../ui/media/VideoPreview';
import {ImagePreview,ImageFocusDialog} from '../ui/media/ImagePreview';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import {uiText} from '../i18n/ui';
export function PublicationCoverPicker({workspace:w,publication:p,readOnly}:{workspace:ProductionWorkspace;publication:ReturnType<typeof useWorkspacePublication>;readOnly:boolean}){
 const [preview,setPreview]=useState(false),[dimensions,setDimensions]=useState({src:'',width:0,height:0});
 const id=useId(),player=useRef<HTMLVideoElement>(null),uploadInput=useRef<HTMLInputElement>(null),flight=useRef(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [source,setSource]=useState<'upload'|'existing'|'frame'>(w.coverInputs?.length?'existing':'upload');
 const cover=p.state?.cover,video=w.exports?.[0],canFrame=!!(video?.artifact&&video.status==='ready'&&video.current),url=cover?'/_local-artifact?'+new URLSearchParams({episode:w.episodeId,path:cover.file.relativePath,sha256:cover.file.sha256}):'';
 const activeSource=source==='frame'&&!canFrame?'upload':source;
 const tabs=[{value:'upload',label:'本地上传'},{value:'existing',label:'已有图片'},{value:'frame',label:'成片选帧'}] as const;
 async function useCover(data:Record<string,unknown>){if(flight.current||readOnly)return;flight.current=true;setBusy(true);setError('');try{await p.mutate('cover',data);}catch(cause){setError(cause instanceof Error?cause.message:'封面未保存，原封面仍保留。');}finally{flight.current=false;setBusy(false);}}
 async function upload(file:File|undefined){if(!file||readOnly||flight.current)return;if(!file.size||file.size>20*1024*1024||!/^image\/(jpeg|png|webp)$/.test(file.type)){setError('请选择有效且不超过20 MB的 JPG、PNG 或 WebP 图片。');return;}const bytes=new Uint8Array(await file.arrayBuffer());let text='';for(let start=0;start<bytes.length;start+=32768)text+=String.fromCharCode(...bytes.subarray(start,start+32768));await useCover({kind:'upload',name:file.name,base64:btoa(text)});}
 return <div className="workspace-cover-editor">
  <div className="workspace-publication-cover-row">
   {cover&&<div className="workspace-publication-cover"><ImagePreview src={url} alt={uiText('交付封面')} onLoad={event=>setDimensions({src:url,width:event.currentTarget.naturalWidth,height:event.currentTarget.naturalHeight})}/></div>}
   <div className="workspace-cover-information"><h5>{uiText('封面')}</h5><p>{cover?(dimensions.src===url?`${dimensions.width} × ${dimensions.height}`:cover.name):uiText('尚未添加，可选填')} {cover&&Number.isFinite(cover.file.fileSize)?` · ${(cover.file.fileSize/1024).toFixed(1)} KB`:''}</p>
   {cover&&<div className="workspace-cover-actions"><Button size="xs" color="tertiary" onPress={()=>setPreview(true)}>{uiText('预览')}</Button><a className="workspace-cover-download" href={url+'&download=1'} download>{uiText('下载封面')}</a></div>}
   </div></div>
  {!readOnly&&<details className="workspace-cover-disclosure" onToggle={event=>{if(!event.currentTarget.open)player.current?.pause();}}><summary><ChevronRight size={13} aria-hidden="true"/>{uiText(cover?'更换封面':'添加封面（可选）')}</summary>
   <div className="workspace-cover-source-content">
    <div className="workspace-visual-preview-tabs workspace-cover-source-tabs" role="tablist" aria-label={uiText('封面来源')}>
     {tabs.map(tab=><button key={tab.value} type="button" id={`${id}-${tab.value}-tab`} role="tab" aria-selected={activeSource===tab.value} aria-controls={`${id}-${tab.value}-panel`} tabIndex={activeSource===tab.value?0:-1} disabled={busy||tab.value==='frame'&&!canFrame} title={tab.value==='frame'&&!canFrame?uiText('生成可用成片后可选帧'):undefined} onClick={()=>setSource(tab.value)} onKeyDown={event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const available=tabs.filter(item=>item.value!=='frame'||canFrame),position=available.findIndex(item=>item.value===tab.value),next=event.key==='Home'?available[0]:event.key==='End'?available.at(-1)!:available[(position+(event.key==='ArrowRight'?1:available.length-1))%available.length];setSource(next.value);document.getElementById(`${id}-${next.value}-tab`)?.focus();}}>{uiText(tab.label)}</button>)}
    </div>
    <div role="tabpanel" id={`${id}-upload-panel`} aria-labelledby={`${id}-upload-tab`} hidden={activeSource!=='upload'}>
     <button type="button" className="workspace-cover-upload-slot" disabled={busy||!p.state} onClick={()=>uploadInput.current?.click()} onDragOver={event=>event.preventDefault()} onDrop={event=>{event.preventDefault();if(!busy)void upload(event.dataTransfer.files[0]).catch(cause=>setError(cause.message));}}><Upload size={22} aria-hidden="true"/><strong>{uiText('点击上传封面，或将图片拖到这里')}</strong><small>{uiText('JPG、PNG、WebP · 最大 20 MB')}</small></button>
     <input ref={uploadInput} id={`${id}-upload`} className="workspace-cover-file-input" type="file" aria-label={uiText('上传封面文件')} accept="image/jpeg,image/png,image/webp" disabled={busy||!p.state} onChange={event=>{const file=event.target.files?.[0];event.target.value='';void upload(file).catch(cause=>setError(cause.message));}}/>
    </div>
    <div role="tabpanel" id={`${id}-existing-panel`} aria-labelledby={`${id}-existing-tab`} hidden={activeSource!=='existing'}>
     {w.coverInputs?.length?<><div className="workspace-cover-options">{w.coverInputs.map((input,index)=>{const selected=!!input.file&&cover?.file.sha256===input.file.sha256;return <button key={index} type="button" className="workspace-cover-option" aria-label={uiText('应用封面：{name}',{name:input.name})} aria-pressed={selected} title={input.unavailableReason??input.name} disabled={busy||!p.state||!!input.unavailableReason} onClick={()=>void useCover({kind:'existing',source:input.source})}><span className="workspace-cover-option-image">{input.file&&!input.unavailableReason?<img loading="lazy" alt="" src={'/_local-artifact?'+new URLSearchParams({episode:w.episodeId,path:input.file.relativePath,sha256:input.file.sha256})}/>:<ImageIcon size={20} aria-hidden="true"/>}{selected&&<Check size={14} aria-hidden="true"/>}</span><span>{input.name}</span>{input.unavailableReason&&<small>{input.unavailableReason}</small>}</button>;})}</div><p className="workspace-cover-source-note">{uiText('点击图片即可使用')}</p></>:<p className="workspace-cover-source-note">{uiText('暂无可用图片，可上传封面或从成片选帧。')}</p>}
    </div>
    <div role="tabpanel" id={`${id}-frame-panel`} aria-labelledby={`${id}-frame-tab`} hidden={activeSource!=='frame'}>
     {activeSource==='frame'&&canFrame&&video?.artifact&&<><div className="workspace-cover-frame-preview"><VideoPreview mediaRef={player} src={'/_local-artifact?'+new URLSearchParams({episode:w.episodeId,path:video.artifact.relativePath,sha256:video.artifact.sha256})} title={uiText('封面选帧')} sourceLabel={uiText('成片')}/></div><div className="workspace-cover-source-footer"><Button size="sm" color="primary" iconLeading={Check} isDisabled={busy} onPress={()=>{if(player.current)void useCover({kind:'frame',exportId:video.id,videoSha256:video.artifact!.sha256,timeSeconds:player.current.currentTime});}}>{uiText('使用当前画面')}</Button></div></>}
    </div>
   </div>
  </details>}
  {cover&&preview&&<ImageFocusDialog src={url} title={uiText('交付封面')} onClose={()=>setPreview(false)}/>}
  {busy&&<p role="status">{uiText('正在保存封面…')}</p>}{error&&<p role="alert">{uiText(error)}</p>}
 </div>;
}
