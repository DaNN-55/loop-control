import {ImagePreview} from '../ui/media/ImagePreview';
import {useEffect,useId,useRef,useState} from 'react';
import {Image as ImageIcon,Copy,Download,FileArchive,FileJson,RefreshCw,PackageCheck} from 'lucide-react';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import {Tooltip} from '../ui/dan-ui/components/base/tooltip/tooltip';
import type {ProductionWorkspace} from '../productionWorkspace';
import {localRequest} from './client';
import {normalizeDeliveryTags,deliveryTagsError} from '../publishing/deliveryMetadata';
import {coverImageExtension} from '../publishing/coverImage';
import {useWorkspaceDraft} from './WorkspaceDraft';
import './workspace-compact-panels.css';
function CopyButton({label,onCopy}:{label:string;onCopy:()=>void}){return <Tooltip title={label} className="dan-ui dan-ui-tooltip"><Button size="sm" color="tertiary" iconLeading={Copy} aria-label={label} onPress={onCopy}/></Tooltip>;}
export function WorkspaceDeliveryPanel({workspace:w,pending,command,onChange}:{workspace:ProductionWorkspace;pending:boolean;command:(name:string,data:unknown)=>Promise<unknown>;onChange:(w:ProductionWorkspace)=>void}){
 const source=w.exports?.[0],draft=useWorkspaceDraft({episodeId:w.episodeId,kind:'delivery',version:JSON.stringify([w.id,source?.id,source?.contentSha256,source?.artifact?.sha256]),initial:{title:'',description:'',tags:'',coverName:''}});
 const {title,description,tags,coverName}=draft.value,setTitle=(title:string)=>draft.setValue(value=>({...value,title})),setDescription=(description:string)=>draft.setValue(value=>({...value,description})),setTags=(tags:string)=>draft.setValue(value=>({...value,tags}));
 const [coverSelection,setCoverSelection]=useState<{scope:string;file:File}|null>(null),[error,setError]=useState(''),[preparing,setPreparing]=useState(false);
 const cover=coverSelection?.scope===draft.scope&&coverSelection.file.name===coverName?coverSelection.file:null,setCover=(file:File|null)=>setCoverSelection(file?{scope:draft.scope,file}:null);
 const coverInput=useRef<HTMLInputElement>(null),[coverPreview,setCoverPreview]=useState(''),[coverError,setCoverError]=useState(''),[checkingCover,setCheckingCover]=useState(false),[tagsError,setTagsError]=useState(''),coverFieldId=useId(),tagsFieldId=useId(),preparingRef=useRef(false),coverCheck=useRef(0),currentScope=useRef(draft.scope);currentScope.current=draft.scope;const currentCover=useRef(cover);currentCover.current=cover;
 useEffect(()=>{coverCheck.current++;setCheckingCover(false);setCoverError('');},[draft.scope]);
 async function selectCover(file:File|null){
  const check=++coverCheck.current,scope=draft.scope;setCover(null);setCoverError('');setCheckingCover(false);draft.setValue(value=>({...value,coverName:file?.name??''}));if(!file)return;
  if(!file.size){setCoverError('封面为空，请重新选择。');return;}if(file.size>20*1024*1024){setCoverError('封面不能超过 20 MB，请选择较小的图片。');return;}
  setCheckingCover(true);try{const bytes=await new Promise<ArrayBuffer>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result as ArrayBuffer);reader.onerror=()=>reject(Error());reader.readAsArrayBuffer(file.slice(0,12));});if(check!==coverCheck.current||scope!==currentScope.current)return;
   const extension=coverImageExtension(new Uint8Array(bytes)),suffix=file.name.split('.').at(-1)?.toLowerCase(),mime=file.type.toLowerCase();
   if(!extension||!({jpg:['jpg','jpeg'],png:['png'],webp:['webp']}[extension].includes(suffix??''))||mime&&mime!=='application/octet-stream'&&mime!==({jpg:'image/jpeg',png:'image/png',webp:'image/webp'}[extension])){setCoverError('请选择真实 JPG、PNG 或 WebP 图片，文件扩展名与类型须一致。');return;}setCover(file);
  }catch{if(check===coverCheck.current&&scope===currentScope.current)setCoverError('封面读取失败，请重新选择。');}finally{if(check===coverCheck.current&&scope===currentScope.current)setCheckingCover(false);}
 }
 const [published,setPublished]=useState<{key:string;title:string;description:string;tags:string[]}|null>(null),[metadataError,setMetadataError]=useState(''),[metadataReload,setMetadataReload]=useState(0),[copied,setCopied]=useState('');
 const notify=useRef(onChange);notify.current=onChange;
 const latest=w.deliveries?.[0],running=latest&&['ready','running'].includes(latest.status),completed=latest?.status==='completed',confirmed=!!source?.confirmed&&source.current&&!w.stale,coverVisible=confirmed&&!latest?.verified&&!running&&!completed;
 useEffect(()=>{if(!cover||!coverVisible){setCoverPreview('');return;}const url=URL.createObjectURL(cover);setCoverPreview(url);return()=>URL.revokeObjectURL(url);},[cover,coverVisible]);
 useEffect(()=>{if(!running)return;let active=true,busy=false;const timer=setInterval(()=>{if(busy)return;busy=true;void localRequest(`episodes/${w.episodeId}/workspace`).then(r=>{if(active)notify.current(r.workspace);}).catch(()=>{if(active)setError('交付状态暂不可用，请刷新重试。');}).finally(()=>{busy=false;});},2500);return()=>{active=false;clearInterval(timer);};},[w.episodeId,running]);
 const metadata=latest?.verified?latest.artifacts.find(a=>a.artifactType==='metadata'):undefined;
 const metadataKey=`${w.episodeId}:${latest?.id}:${metadata?.sha256}`;
 const artifactUrl=(a:NonNullable<typeof latest>['artifacts'][number],download=false)=>`/_local-artifact?${new URLSearchParams({episode:w.episodeId,path:a.relativePath,sha256:a.sha256,...(download?{download:'1'}:{})})}`;
 useEffect(()=>{setMetadataError('');setCopied('');if(!metadata)return;const controller=new AbortController();let active=true;
  void fetch(artifactUrl(metadata),{signal:controller.signal}).then(async response=>{if(!response.ok||Number(response.headers.get('content-length'))>2*1024*1024)throw Error();const text=await response.text();if(text.length>2*1024*1024)throw Error();const value=JSON.parse(text);if(typeof value.title!=='string'||value.title.length>200||typeof value.description!=='string'||value.description.length>5000||!Array.isArray(value.tags)||value.tags.length>20||value.tags.some((t:unknown)=>typeof t!=='string'||t.length>50))throw Error();if(active)setPublished({key:metadataKey,title:value.title,description:value.description,tags:normalizeDeliveryTags(value.tags).filter(Boolean)});}).catch(()=>{if(active)setMetadataError('发布文案读取失败，请重试。');});
  return()=>{active=false;controller.abort();};
 },[metadataKey,metadataReload]);
 async function copy(text:string,label:string){try{await navigator.clipboard.writeText(text);setCopied(`已复制${label}`);}catch{setCopied('复制失败，请选择文案后手动复制。');}}
 const saved=published?.key===metadataKey?published:null;
 async function run(name:string,extra:Record<string,unknown>){setError('');try{onChange(await command(name,{episodeId:w.episodeId,workspaceId:w.id,expectedRevision:w.revision,...extra}) as ProductionWorkspace);return true;}catch(cause){const message=cause instanceof Error?cause.message:'交付未完成，请重试。';if(name==='prepareWorkspaceDelivery'&&message.includes('封面'))setCoverError(message);else setError(message);return false;}}
 async function prepare(){if(!cover||preparingRef.current)return;const normalizedTags=normalizeDeliveryTags(tags.split(/[,，]/).map(t=>t.trim()).filter(Boolean)),invalidTags=deliveryTagsError(normalizedTags);setTagsError(invalidTags);if(invalidTags)return;const submitted={...draft.value};preparingRef.current=true;setPreparing(true);try{const bytes=new Uint8Array(await cover.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));const e=w.exports![0];const succeeded=await run('prepareWorkspaceDelivery',{exportId:e.id,expectedExportSha256:e.artifact?.sha256,expectedContentSha256:e.contentSha256,title,description,tags:normalizedTags,coverBase64:btoa(binary)});if(succeeded&&currentCover.current===cover&&draft.acknowledge(submitted,{title:'',description:'',tags:'',coverName:''}))setCover(null);}catch{setCoverError('封面读取失败，请重新选择。');}finally{preparingRef.current=false;setPreparing(false);}}
 return <section className="workspace-delivery workspace-delivery-compact" aria-label="交付包">
 <div className="workspace-review-heading"><h4>交付包</h4><span>{latest?.verified?'验证完成':running?'正在准备':completed?'需核验':latest&&['failed','blocked'].includes(latest.status)?'交付失败':!source?'尚未开始':confirmed?'可准备':'待确认'}</span></div>
 {latest?.verified?<>
 <div className="workspace-delivery-published">
  {latest.artifacts.filter(a=>a.artifactType==='cover').map(a=><div className="workspace-delivery-published-cover" key={a.relativePath}><ImagePreview src={artifactUrl(a)} alt="交付封面"/><a className="workspace-delivery-cover-download" href={artifactUrl(a,true)} download aria-label="下载封面" title="下载封面"><Download size={16} aria-hidden="true"/></a></div>)}
  <div className="workspace-delivery-copy">
   {saved?<>
    <div className="workspace-delivery-title-row"><h5>{saved.title}</h5><CopyButton label="复制标题" onCopy={()=>void copy(saved.title,'标题')}/></div>
    {saved.description&&<div className="workspace-delivery-description"><div className="workspace-delivery-field-heading"><span>简介</span><CopyButton label="复制简介" onCopy={()=>void copy(saved.description,'简介')}/></div><p>{saved.description}</p></div>}
    {saved.tags.length>0&&<div className="workspace-delivery-tag-row"><p className="workspace-delivery-tags">{saved.tags.map(t=>`#${t}`).join(' ')}</p><CopyButton label="复制标签" onCopy={()=>void copy(saved.tags.map(t=>`#${t}`).join(' '),'标签')}/></div>}
   </>:metadata?<p role={metadataError?'alert':'status'}>{metadataError||'正在读取发布文案…'}{metadataError&&<Tooltip title="重试读取发布文案" className="dan-ui dan-ui-tooltip"><Button size="sm" color="tertiary" iconLeading={RefreshCw} aria-label="重试文案" title="重试读取发布文案" onPress={()=>setMetadataReload(v=>v+1)}/></Tooltip>}</p>:<p>此交付包没有发布文案记录。</p>}
   {copied&&<p role="status">{copied}</p>}
  </div>
 </div>
 <div className="workspace-delivery-downloads">{latest.artifacts.filter(a=>a.artifactType==='final_render').map(a=><a className="workspace-download-primary" key={a.relativePath} href={artifactUrl(a,true)} download><Download size={16} aria-hidden="true"/>下载最终视频</a>)}<a className="workspace-download-secondary" href={`/api/local/episodes/${encodeURIComponent(w.episodeId)}/delivery-download?delivery=${encodeURIComponent(latest.id)}`} download aria-label="下载全部交付文件（ZIP）" title="下载交付文件 ZIP，不含源素材"><FileArchive size={16} aria-hidden="true"/>交付包</a>{latest.artifacts.filter(a=>a.artifactType==='editable_project').map(a=><a className="workspace-download-secondary" key={a.relativePath} href={artifactUrl(a,true)} download aria-label="下载可编辑工程" title="下载可编辑工程，打开时需保留本机原素材"><FileJson size={16} aria-hidden="true"/>工程</a>)}</div>
 <p className="workspace-delivery-project-note">工程需保留原素材；交付包不含源素材。</p>
 </>:running?<p role="status">{latest.status==='running'?'正在校验交付文件…':'交付已排队…'}</p>:completed?<p role="alert">{latest.error||'交付文件需重新核验，请读取原交付状态。'}</p>:!confirmed?<><p className="workspace-delivery-locked">{!source?'导出并确认成片后，再设置封面与发布文案。':!source.current||w.stale?'工程已变化，请重新导出并确认成片。':'确认这份成片后，再设置封面与发布文案。'}</p>{latest?.error&&<p role="alert">{latest.error}</p>}</>:<>
 {draft.restored&&<p role="status">已恢复本机交付草稿，尚未提交。</p>}{draft.storageError&&<p role="alert" className="form-error">本机草稿暂无法保存，请保持此页面打开。</p>}
 <div className="workspace-delivery-fields">
  <div className="workspace-delivery-cover"><span>封面</span><Button className="workspace-delivery-cover-picker" noTextPadding size="sm" color="secondary" aria-label={cover?'替换封面':'选择封面'} aria-describedby={`${coverFieldId}-hint${coverError?` ${coverFieldId}-error`:''}`} aria-invalid={!!coverError} isDisabled={pending||!confirmed} onPress={()=>coverInput.current?.click()}>{coverPreview?<ImagePreview src={coverPreview} alt="交付封面预览"/>:<span className="workspace-delivery-cover-placeholder"><ImageIcon size={28} aria-hidden="true"/><span>选择封面图片</span></span>}</Button><span className="workspace-delivery-cover-name" title={cover?.name}>{cover?.name??(coverName?`请重新选择封面：${coverName}`:'尚未选择封面')}</span><span id={`${coverFieldId}-hint`}>JPG、PNG、WebP · 单张不超过 20 MB</span>{checkingCover&&<span role="status">正在检查封面…</span>}{coverError&&<span id={`${coverFieldId}-error`} role="alert" className="form-error">{coverError}</span>}<input ref={coverInput} hidden aria-label="封面" aria-describedby={`${coverFieldId}-hint${coverError?` ${coverFieldId}-error`:''}`} aria-invalid={!!coverError} type="file" accept="image/png,image/jpeg,image/webp" disabled={pending||!confirmed} onChange={e=>{const file=e.target.files?.[0]??null;e.target.value='';void selectCover(file);setError('');}}/></div>
  <div className="workspace-delivery-text-fields"><label>标题<input value={title} maxLength={200} disabled={pending||!confirmed} onChange={e=>setTitle(e.target.value)}/></label><label>简介<textarea value={description} rows={4} maxLength={5000} disabled={pending||!confirmed} onChange={e=>setDescription(e.target.value)}/></label><label>标签<input aria-label="标签" value={tags} placeholder="用逗号分隔" aria-invalid={!!tagsError} aria-describedby={`${tagsFieldId}-hint${tagsError?` ${tagsFieldId}-error`:''}`} disabled={pending||!confirmed} onChange={e=>{setTags(e.target.value);setTagsError('');}}/><span id={`${tagsFieldId}-hint`}>最多 20 个，每个最多 50 个字符</span>{tagsError&&<span id={`${tagsFieldId}-error`} role="alert" className="form-error">{tagsError}</span>}</label></div>
 </div>
 <Button size="sm" color="primary" iconLeading={PackageCheck} isDisabled={pending||preparing||checkingCover||!confirmed||!title.trim()||!cover||w.stale} onPress={()=>void prepare()}>生成并验证交付包</Button>
 {latest&&['failed','blocked'].includes(latest.status)&&<><p role="alert">{latest.error}</p><Tooltip title="重试原交付" className="dan-ui dan-ui-tooltip"><Button size="sm" color="tertiary" iconLeading={RefreshCw} aria-label="重试原交付" title="重试原交付" isDisabled={pending||!confirmed} onPress={()=>void run('retryWorkspaceDelivery',{deliveryId:latest.id})}/></Tooltip></>}
 </>}
 {error&&<p role="alert">{error}</p>}
 </section>;
}
