import {FeedbackNotice} from '../ui/FeedbackNotice';
import {uiText} from '../i18n/ui';
import {templateReferenceProblem} from '../workspaceTemplateInputs';
import {ImagePreview} from '../ui/media/ImagePreview';
import {useEffect,useId,useRef,useState} from 'react';
import {Image as ImageIcon,Copy,Download,FileArchive,FileJson,RefreshCw,PackageCheck} from 'lucide-react';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import {Tooltip} from '../ui/dan-ui/components/base/tooltip/tooltip';
import type {ProductionWorkspace} from '../productionWorkspace';
import {workspaceExportDeliveryState} from '../workspaceExportDelivery';
import {useWorkspaceReading,useWorkspacePolling} from './useWorkspaceReading';
import {normalizeDeliveryTags,deliveryTagsError} from '../publishing/deliveryMetadata';
import {coverImageExtension} from '../publishing/coverImage';
import {useWorkspaceDraft} from './WorkspaceDraft';
import {NativeSelect} from '../ui/dan-ui/components/base/select/select-native';
import type {WorkspaceCoverInput,WorkspaceCoverSource} from '../workspaceCover';
import './workspace-compact-panels.css';
function CopyButton({label,onCopy}:{label:string;onCopy:()=>void}){return <Tooltip title={label} className="dan-ui dan-ui-tooltip"><Button size="sm" color="tertiary" iconLeading={Copy} aria-label={label} onPress={onCopy}/></Tooltip>;}
function coverKey(source:WorkspaceCoverSource){return `${source.kind}:${source.id}:${source.sha256}`;}
export function WorkspaceDeliveryPanel({workspace:w,pending,command,onChange,completedView=false}:{workspace:ProductionWorkspace;pending:boolean;command:(name:string,data:unknown)=>Promise<unknown>;onChange:(w:ProductionWorkspace)=>void;completedView?:boolean}){
 const source=w.exports?.[0],draft=useWorkspaceDraft({episodeId:w.episodeId,kind:'delivery',version:JSON.stringify([w.id,source?.id,source?.contentSha256,source?.artifact?.sha256]),initial:{title:'',description:'',tags:'',coverName:''}});
 const {title,description,tags,coverName}=draft.value,setTitle=(title:string)=>draft.setValue(value=>({...value,title})),setDescription=(description:string)=>draft.setValue(value=>({...value,description})),setTags=(tags:string)=>draft.setValue(value=>({...value,tags}));
 const [coverSelection,setCoverSelection]=useState<{scope:string;file:File;source?:WorkspaceCoverSource}|null>(null),[error,setError]=useState(''),[preparing,setPreparing]=useState(false);
 const cover=coverSelection?.scope===draft.scope&&coverSelection.file.name===coverName?coverSelection.file:null,coverSource=cover?coverSelection?.source:undefined,setCover=(file:File|null,source?:WorkspaceCoverSource)=>setCoverSelection(file?{scope:draft.scope,file,...(source?{source}:{})}:null);
 const templateCover=w.templateInputs?.cover,coverInputs=w.coverInputs??[],templateCoverInput=coverInputs.find(input=>input.source.kind==='material'&&input.source.id===templateCover?.material?.id&&input.source.sha256===templateCover.material.sha256);
 const coverChoiceStorageKey='loop-cover-source-choice:'+draft.scope;
 let storedCoverChoice:string|null=null;try{storedCoverChoice=sessionStorage.getItem(coverChoiceStorageKey);}catch{/* Preserve the live selection without storage. */}
 const [registeredCoverChoice,setRegisteredCoverChoice]=useState<{scope:string;value:string|null}>(()=>({scope:draft.scope,value:storedCoverChoice}));
 const registeredCoverKey=(registeredCoverChoice.scope===draft.scope?registeredCoverChoice.value:storedCoverChoice)??(templateCoverInput?coverKey(templateCoverInput.source):'');
 function setRegisteredCoverKey(value:string){setRegisteredCoverChoice({scope:draft.scope,value});try{sessionStorage.setItem(coverChoiceStorageKey,value);}catch{/* Keep the current form usable. */}}
 const registeredCover=coverInputs.find(input=>coverKey(input.source)===registeredCoverKey);
 const coverInput=useRef<HTMLInputElement>(null),[coverPreview,setCoverPreview]=useState(''),[coverError,setCoverError]=useState(''),[checkingCover,setCheckingCover]=useState(false),[tagsError,setTagsError]=useState(''),coverFieldId=useId(),tagsFieldId=useId(),preparingRef=useRef(false),coverCheck=useRef(0),currentScope=useRef(draft.scope);currentScope.current=draft.scope;const currentCover=useRef(cover);currentCover.current=cover;
 useEffect(()=>{coverCheck.current++;setCheckingCover(false);setCoverError('');},[draft.scope]);
 async function selectCover(file:File|null,source?:WorkspaceCoverSource){
  setRegisteredCoverKey(source?coverKey(source):'');
  const check=++coverCheck.current,scope=draft.scope;setCover(null);setCoverError('');setCheckingCover(false);draft.setValue(value=>({...value,coverName:file?.name??''}));if(!file)return;
  if(!file.size){setCoverError('封面为空，请重新选择。');return;}if(file.size>20*1024*1024){setCoverError('封面不能超过 20 MB，请选择较小的图片。');return;}
  setCheckingCover(true);try{const bytes=await new Promise<ArrayBuffer>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result as ArrayBuffer);reader.onerror=()=>reject(Error());reader.readAsArrayBuffer(file.slice(0,12));});if(check!==coverCheck.current||scope!==currentScope.current)return;
   const extension=coverImageExtension(new Uint8Array(bytes)),suffix=file.name.split('.').at(-1)?.toLowerCase(),mime=file.type.toLowerCase();
   if(!extension||!({jpg:['jpg','jpeg'],png:['png'],webp:['webp']}[extension].includes(suffix??''))||mime&&mime!=='application/octet-stream'&&mime!==({jpg:'image/jpeg',png:'image/png',webp:'image/webp'}[extension])){setCoverError('请选择真实 JPG、PNG 或 WebP 图片，文件扩展名与类型须一致。');return;}setCover(file,source);
  }catch{if(check===coverCheck.current&&scope===currentScope.current)setCoverError('封面读取失败，请重新选择。');}finally{if(check===coverCheck.current&&scope===currentScope.current)setCheckingCover(false);}
 }
 async function useRegisteredCover(input:WorkspaceCoverInput){
  if(!input.file||input.unavailableReason)return;
  const check=++coverCheck.current,scope=draft.scope;setCover(null);setCoverError('');setCheckingCover(true);draft.setValue(value=>({...value,coverName:input.name}));
  try{
   const response=await fetch('/_local-artifact?'+new URLSearchParams({episode:w.episodeId,path:input.file.relativePath,sha256:input.file.sha256}));
   if(!response.ok||Number(response.headers.get('content-length'))>20*1024*1024)throw Error();
   const bytes=await response.arrayBuffer();if(check!==coverCheck.current||scope!==currentScope.current)return;
   const extension=coverImageExtension(new Uint8Array(bytes));if(bytes.byteLength!==input.file.fileSize||!extension)throw Error();
   const name=/\.(jpg|jpeg|png|webp)$/i.test(input.name)?input.name:input.name+'.'+extension;
   await selectCover(new File([bytes],name,{type:extension==='jpg'?'image/jpeg':'image/'+extension}),input.source);
  }catch{if(check===coverCheck.current&&scope===currentScope.current)setCoverError('原封面读取失败，请恢复原文件或另选封面。');}
  finally{if(check===coverCheck.current&&scope===currentScope.current)setCheckingCover(false);}
 }
 const [published,setPublished]=useState<{key:string;title:string;description:string;tags:string[]}|null>(null),[metadataError,setMetadataError]=useState(''),[metadataReload,setMetadataReload]=useState(0),[copied,setCopied]=useState(''),[copySequence,setCopySequence]=useState(0);
 const {delivery}=workspaceExportDeliveryState(w,{pending,preparing,checkingCover,title,hasCover:!!cover});
 const {latest,running,coverVisible,stage}=delivery,retryDelivery=delivery.retryAction.target;
 const reading=useWorkspaceReading(w,onChange,JSON.stringify([latest?.id,!!running]),'交付状态暂不可用，请刷新重试。');
 const pollingError=useWorkspacePolling(reading,{enabled:!!running,interval:2500});
 useEffect(()=>{if(!cover||!coverVisible){setCoverPreview('');return;}const url=URL.createObjectURL(cover);setCoverPreview(url);return()=>URL.revokeObjectURL(url);},[cover,coverVisible]);
 const metadata=latest?.verified?latest.artifacts.find(a=>a.artifactType==='metadata'):undefined;
 const metadataKey=`${w.episodeId}:${latest?.id}:${metadata?.sha256}`;
 const artifactUrl=(a:NonNullable<typeof latest>['artifacts'][number],download=false)=>`/_local-artifact?${new URLSearchParams({episode:w.episodeId,path:a.relativePath,sha256:a.sha256,...(download?{download:'1'}:{})})}`;
 useEffect(()=>{setMetadataError('');setCopied('');if(!metadata)return;const controller=new AbortController();let active=true;
  void fetch(artifactUrl(metadata),{signal:controller.signal}).then(async response=>{if(!response.ok||Number(response.headers.get('content-length'))>2*1024*1024)throw Error();const text=await response.text();if(text.length>2*1024*1024)throw Error();const value=JSON.parse(text);if(typeof value.title!=='string'||value.title.length>200||typeof value.description!=='string'||value.description.length>5000||!Array.isArray(value.tags)||value.tags.length>20||value.tags.some((t:unknown)=>typeof t!=='string'||t.length>50))throw Error();if(active)setPublished({key:metadataKey,title:value.title,description:value.description,tags:normalizeDeliveryTags(value.tags).filter(Boolean)});}).catch(()=>{if(active)setMetadataError('发布文案读取失败，请重试。');});
  return()=>{active=false;controller.abort();};
 },[metadataKey,metadataReload]);
 async function copy(text:string,label:string){setCopySequence(value=>value+1);try{await navigator.clipboard.writeText(text);setCopied(`已复制${label}`);}catch{setCopied('复制失败，请选择文案后手动复制。');}}
 const saved=published?.key===metadataKey?published:null;
 async function run(name:string,extra:Record<string,unknown>){setError('');try{reading.publish(await command(name,{episodeId:w.episodeId,workspaceId:w.id,expectedRevision:w.revision,...extra}) as ProductionWorkspace);return true;}catch(cause){const message=cause instanceof Error?cause.message:'交付未完成，请重试。';if(name==='prepareWorkspaceDelivery'&&message.includes('封面'))setCoverError(message);else setError(message);return false;}}
 async function prepare(){if(!cover||preparingRef.current)return;const normalizedTags=normalizeDeliveryTags(tags.split(/[,，]/).map(t=>t.trim()).filter(Boolean)),invalidTags=deliveryTagsError(normalizedTags);setTagsError(invalidTags);if(invalidTags)return;const submitted={...draft.value};preparingRef.current=true;setPreparing(true);try{let coverData:Record<string,unknown>;if(coverSource)coverData={coverSource};else{const bytes=new Uint8Array(await cover.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));coverData={coverBase64:btoa(binary)};}const e=w.exports![0];const succeeded=await run('prepareWorkspaceDelivery',{exportId:e.id,expectedExportSha256:e.artifact?.sha256,expectedContentSha256:e.contentSha256,title,description,tags:normalizedTags,...coverData});if(succeeded&&currentCover.current===cover&&draft.acknowledge(submitted,{title:'',description:'',tags:'',coverName:''}))setCover(null);}catch{setCoverError('封面读取失败，请重新选择。');}finally{preparingRef.current=false;setPreparing(false);}}
 return <section className={`workspace-delivery workspace-delivery-compact${completedView?' completed-delivery':''}`} aria-label={uiText("交付包")}>
 {templateReferenceProblem(templateCover)&&<p role="status">{templateReferenceProblem(templateCover)}</p>}
 <div className="workspace-review-heading"><h4>{uiText("交付包")}</h4><span>{delivery.status}{stage.kind==='preparation'&&draft.dirty&&<> · {uiText("有未提交修改")}</>}</span></div>
 {stage.kind==='verified'?<>
 <div className="workspace-delivery-published">
  {stage.record.artifacts.filter(a=>a.artifactType==='cover').map(a=><div className="workspace-delivery-published-cover" key={a.relativePath}><ImagePreview src={artifactUrl(a)} alt={uiText("交付封面")}/><a className="workspace-delivery-cover-download" href={artifactUrl(a,true)} download aria-label={uiText("下载封面")} title={uiText("下载封面")}><Download size={16} aria-hidden="true"/></a></div>)}
  <div className="workspace-delivery-copy">
   {saved?completedView?<>
    {([['标题',saved.title],['简介',saved.description],['标签',saved.tags.map(t=>`#${t}`).join(' ')]] as const).map(([label,text])=><section className="completed-delivery-text-section" key={label} aria-label={uiText(label)}><div className="workspace-delivery-field-heading"><h5>{uiText(label)}</h5><CopyButton label={uiText('复制{label}',{label:uiText(label)})} onCopy={()=>void copy(text,label)}/></div><p>{text||uiText('未填写')}</p></section>)}
   </>:<>
    <div className="workspace-delivery-title-row"><h5>{saved.title}</h5><CopyButton label={uiText("复制标题")} onCopy={()=>void copy(saved.title,'标题')}/></div>
    {saved.description&&<div className="workspace-delivery-description"><div className="workspace-delivery-field-heading"><span>{uiText("简介")}</span><CopyButton label={uiText("复制简介")} onCopy={()=>void copy(saved.description,'简介')}/></div><p>{saved.description}</p></div>}
    {saved.tags.length>0&&<div className="workspace-delivery-tag-row"><p className="workspace-delivery-tags">{saved.tags.map(t=>`#${t}`).join(' ')}</p><CopyButton label={uiText("复制标签")} onCopy={()=>void copy(saved.tags.map(t=>`#${t}`).join(' '),'标签')}/></div>}
   </>:metadata?<p role={metadataError?'alert':'status'}>{metadataError||uiText("正在读取发布文案…")}{metadataError&&<Tooltip title={uiText("重试读取发布文案")} className="dan-ui dan-ui-tooltip"><Button size="sm" color="tertiary" iconLeading={RefreshCw} aria-label={uiText("重试文案")} title={uiText("重试读取发布文案")} onPress={()=>setMetadataReload(v=>v+1)}/></Tooltip>}</p>:<p>{uiText("此交付包没有发布文案记录。")}</p>}
   {copied.startsWith('复制失败')?<p role="alert">{uiText(copied)}</p>:<FeedbackNotice message={copied} identity={copySequence} onDismiss={()=>setCopied('')}/>}
  </div>
 </div>
 <div className="workspace-delivery-downloads">{stage.record.artifacts.filter(a=>a.artifactType==='final_render').map(a=><a className="workspace-download-primary" key={a.relativePath} href={artifactUrl(a,true)} download><Download size={16} aria-hidden="true"/>{uiText("下载最终视频")}</a>)}<a className="workspace-download-secondary" href={`/api/local/episodes/${encodeURIComponent(w.episodeId)}/delivery-download?delivery=${encodeURIComponent(stage.record.id)}`} download aria-label={uiText("下载全部交付文件（ZIP）")} title={uiText("下载交付文件 ZIP，不含源素材")}><FileArchive size={16} aria-hidden="true"/>{uiText("交付包")}</a>{stage.record.artifacts.filter(a=>a.artifactType==='editable_project').map(a=><a className="workspace-download-secondary" key={a.relativePath} href={artifactUrl(a,true)} download aria-label={uiText("下载可编辑工程")} title={uiText("下载可编辑工程，打开时需保留本机原素材")}><FileJson size={16} aria-hidden="true"/>{uiText("工程")}</a>)}</div>
 <p className="workspace-delivery-project-note">{uiText("工程需保留原素材；交付包不含源素材。")}</p>
 </>:stage.kind==='running'?<p role="status">{uiText(stage.message)}</p>:stage.kind==='completed'?<p role="alert">{uiText(stage.message)}</p>:stage.kind==='locked'?<><p className="workspace-delivery-locked">{uiText(stage.message)}</p>{latest?.error&&<p role="alert">{uiText(latest.error)}</p>}</>:<>
 {draft.restored&&<FeedbackNotice message="已恢复本机交付草稿，尚未提交。" onceKey={'delivery-draft:'+draft.scope} tone="info"/>}{draft.storageError&&<p role="alert" className="form-error">{uiText("本机草稿暂无法保存，请保持此页面打开。")}</p>}
 <div className="workspace-delivery-fields">
  <div className="workspace-delivery-cover"><span>{uiText("封面")}</span>{coverInputs.length>0&&<div className="workspace-delivery-cover-sources"><label htmlFor={`${coverFieldId}-source`}>{uiText("已有封面")}<NativeSelect id={`${coverFieldId}-source`} name="workspaceCoverSource" size="sm" value={registeredCoverKey} disabled={delivery.fieldsDisabledReason!==null||checkingCover} onChange={event=>setRegisteredCoverKey(event.target.value)}><option value="">{uiText("选择已有封面")}</option>{coverInputs.map((input,index)=><option key={coverKey(input.source)} value={coverKey(input.source)}>{input.name}{coverInputs.filter(other=>other.name===input.name).length>1?` · ${index+1}`:''}</option>)}</NativeSelect></label><Button size="sm" color="secondary" isDisabled={delivery.fieldsDisabledReason!==null||checkingCover||!registeredCover?.file||!!registeredCover.unavailableReason} onPress={()=>{if(registeredCover)void useRegisteredCover(registeredCover);}}>{uiText("使用已选封面")}</Button>{registeredCover?.unavailableReason&&<span role="status">{uiText(registeredCover.unavailableReason)}</span>}</div>}<div className="workspace-delivery-cover-control">{coverPreview&&<ImagePreview src={coverPreview} alt={uiText("交付封面预览")}/>}<Button className={coverPreview?"workspace-delivery-cover-replace":"workspace-delivery-cover-picker"} noTextPadding size="sm" color="secondary" aria-label={cover?uiText("替换封面"):uiText("选择封面")} aria-describedby={`${coverFieldId}-hint${coverError?` ${coverFieldId}-error`:''}`} aria-invalid={!!coverError} isDisabled={delivery.fieldsDisabledReason!==null} onPress={()=>coverInput.current?.click()}>{coverPreview?uiText("替换封面"):<span className="workspace-delivery-cover-placeholder"><ImageIcon size={28} aria-hidden="true"/><span>{uiText("选择封面图片")}</span></span>}</Button></div><span className="workspace-delivery-cover-name" title={cover?.name}>{cover?.name??(coverName?uiText("请重新选择封面：{value0}",{value0:String(coverName)}):uiText("尚未选择封面"))}</span><span id={`${coverFieldId}-hint`}>{uiText("JPG、PNG、WebP · 单张不超过 20 MB")}</span>{checkingCover&&<span role="status">{uiText("正在检查封面…")}</span>}{coverError&&<span id={`${coverFieldId}-error`} role="alert" className="form-error">{uiText(coverError||'')}</span>}<input ref={coverInput} hidden aria-label={uiText("封面")} aria-describedby={`${coverFieldId}-hint${coverError?` ${coverFieldId}-error`:''}`} aria-invalid={!!coverError} type="file" accept="image/png,image/jpeg,image/webp" disabled={delivery.fieldsDisabledReason!==null} onChange={e=>{const file=e.target.files?.[0]??null;e.target.value='';void selectCover(file);setError('');}}/></div>
  <div className="workspace-delivery-text-fields"><label>{uiText("标题")}<input value={title} maxLength={200} disabled={delivery.fieldsDisabledReason!==null} onChange={e=>setTitle(e.target.value)}/></label><label>{uiText("简介")}<textarea value={description} rows={4} maxLength={5000} disabled={delivery.fieldsDisabledReason!==null} onChange={e=>setDescription(e.target.value)}/></label><label>{uiText("标签")}<input aria-label={uiText("标签")} value={tags} placeholder={uiText("用逗号分隔")} aria-invalid={!!tagsError} aria-describedby={`${tagsFieldId}-hint${tagsError?` ${tagsFieldId}-error`:''}`} disabled={delivery.fieldsDisabledReason!==null} onChange={e=>{setTags(e.target.value);setTagsError('');}}/><span id={`${tagsFieldId}-hint`}>{uiText("最多 20 个，每个最多 50 个字符")}</span>{tagsError&&<span id={`${tagsFieldId}-error`} role="alert" className="form-error">{uiText(tagsError||'')}</span>}</label></div>
 </div>
 <Button size="sm" color="primary" iconLeading={PackageCheck} isDisabled={delivery.prepareAction.disabledReason!==null} onPress={()=>void prepare()}>{uiText(delivery.prepareAction.label)}</Button>
 {retryDelivery&&<><p role="alert">{uiText(retryDelivery.error??'')}</p><Tooltip title={uiText("重试原交付")} className="dan-ui dan-ui-tooltip"><Button size="sm" color="tertiary" iconLeading={RefreshCw} aria-label={uiText("重试原交付")} title={uiText("重试原交付")} isDisabled={delivery.retryAction.disabledReason!==null} onPress={()=>void run('retryWorkspaceDelivery',{deliveryId:retryDelivery.id})}/></Tooltip></>}
 </>}
 {(error||pollingError)&&<p role="alert">{uiText(error||pollingError?.message||'')}</p>}
 </section>;
}
