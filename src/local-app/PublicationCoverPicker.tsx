import {useId,useRef,useState} from 'react';
import type {ProductionWorkspace} from '../productionWorkspace';
import type {useWorkspacePublication} from './useWorkspacePublication';
import {VideoPreview} from '../ui/media/VideoPreview';
import {ImagePreview,ImageFocusDialog} from '../ui/media/ImagePreview';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import {uiText} from '../i18n/ui';
export function PublicationCoverPicker({workspace:w,publication:p,readOnly}:{workspace:ProductionWorkspace;publication:ReturnType<typeof useWorkspacePublication>;readOnly:boolean}){
 const [preview,setPreview]=useState(false),[dimensions,setDimensions]=useState({src:'',width:0,height:0});
 const id=useId(),player=useRef<HTMLVideoElement>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[frame,setFrame]=useState(false);
 const cover=p.state?.cover,video=w.exports?.[0],url=cover?'/_local-artifact?'+new URLSearchParams({episode:w.episodeId,path:cover.file.relativePath,sha256:cover.file.sha256}):'';
 async function useCover(data:Record<string,unknown>){if(busy||readOnly)return;setBusy(true);setError('');try{await p.mutate('cover',data);setFrame(false);}catch(cause){setError(cause instanceof Error?cause.message:'封面未保存，原封面仍保留。');}finally{setBusy(false);}}
 async function upload(file:File|undefined){if(!file)return;if(!file.size||file.size>20*1024*1024||!/^image\/(jpeg|png|webp)$/.test(file.type)){setError('请选择有效且不超过20 MB的 JPG、PNG 或 WebP 图片。');return;}const bytes=new Uint8Array(await file.arrayBuffer());let text='';for(let start=0;start<bytes.length;start+=32768)text+=String.fromCharCode(...bytes.subarray(start,start+32768));await useCover({kind:'upload',name:file.name,base64:btoa(text)});}
 return <div className="workspace-cover-editor">
  <div className="workspace-publication-cover-row">
   {cover&&<div className="workspace-publication-cover"><ImagePreview src={url} alt={uiText('交付封面')} onLoad={event=>setDimensions({src:url,width:event.currentTarget.naturalWidth,height:event.currentTarget.naturalHeight})}/></div>}
   <div className="workspace-cover-information"><h5>{uiText('封面')}</h5><p>{cover?(dimensions.src===url?`${dimensions.width} × ${dimensions.height}`:cover.name):uiText('尚未添加，可选填')} {cover&&Number.isFinite(cover.file.fileSize)?` · ${(cover.file.fileSize/1024).toFixed(1)} KB`:''}</p>
   {cover&&<div className="workspace-cover-actions"><Button size="xs" color="tertiary" onPress={()=>setPreview(true)}>{uiText('预览')}</Button><a className="workspace-cover-download" href={url+'&download=1'} download>{uiText('下载封面')}</a></div>}
  {!readOnly&&<details><summary>{uiText(cover?'更换封面':'添加封面（可选）')}</summary>
   <label htmlFor={`${id}-upload`}>{uiText('本地上传')}<input id={`${id}-upload`} type="file" accept="image/jpeg,image/png,image/webp" disabled={busy||!p.state} onChange={e=>{const file=e.target.files?.[0];e.target.value='';void upload(file).catch(cause=>setError(cause.message));}}/></label>
   {!!w.coverInputs?.length&&<label htmlFor={`${id}-existing`}>{uiText('已有图片')}<select id={`${id}-existing`} value="" disabled={busy||!p.state} onChange={e=>{const source=w.coverInputs?.find(input=>JSON.stringify(input.source)===e.target.value)?.source;if(source)void useCover({kind:'existing',source});}}><option value="">{uiText('选择即使用')}</option>{w.coverInputs.map((input,index)=><option key={index} value={JSON.stringify(input.source)} disabled={!!input.unavailableReason}>{input.name}{input.unavailableReason?' · 不可用':''}</option>)}</select></label>}
   {video?.artifact&&video.status==='ready'&&video.current&&<Button size="sm" color="secondary" isDisabled={busy||!p.state} onPress={()=>setFrame(!frame)}>{uiText('从成片选帧')}</Button>}
   {frame&&video?.artifact&&<div><VideoPreview mediaRef={player} src={'/_local-artifact?'+new URLSearchParams({episode:w.episodeId,path:video.artifact.relativePath,sha256:video.artifact.sha256})} title={uiText('封面选帧')} sourceLabel={uiText('成片')}/><Button size="sm" color="primary" isDisabled={busy} onPress={()=>{if(player.current)void useCover({kind:'frame',exportId:video.id,videoSha256:video.artifact!.sha256,timeSeconds:player.current.currentTime});}}>{uiText('使用当前画面')}</Button><Button size="sm" color="tertiary" isDisabled={busy} onPress={()=>setFrame(false)}>{uiText('取消选帧')}</Button></div>}
  </details>}
   </div></div>
  {cover&&preview&&<ImageFocusDialog src={url} title={uiText('交付封面')} onClose={()=>setPreview(false)}/>}
  {busy&&<p role="status">{uiText('正在保存封面…')}</p>}{error&&<p role="alert">{uiText(error)}</p>}
 </div>;
}
