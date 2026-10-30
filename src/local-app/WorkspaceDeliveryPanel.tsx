import {useEffect,useRef,useState} from 'react';
import {Image as ImageIcon} from 'lucide-react';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import type {ProductionWorkspace} from '../productionWorkspace';
import {localRequest} from './client';
import './workspace-compact-panels.css';
const labels:Record<string,string>={final_render:'最终视频',editable_project:'可编辑工程',cover:'封面',metadata:'元数据',final_qc_report:'检查证据',publish_package:'交付清单'};
export function WorkspaceDeliveryPanel({workspace:w,pending,command,onChange}:{workspace:ProductionWorkspace;pending:boolean;command:(name:string,data:unknown)=>Promise<unknown>;onChange:(w:ProductionWorkspace)=>void}){
 const [title,setTitle]=useState(''),[description,setDescription]=useState(''),[tags,setTags]=useState(''),[cover,setCover]=useState<File|null>(null),[error,setError]=useState('');
 const coverInput=useRef<HTMLInputElement>(null),[coverPreview,setCoverPreview]=useState('');
 const notify=useRef(onChange);notify.current=onChange;
 const latest=w.deliveries?.[0],running=latest&&['ready','running'].includes(latest.status),completed=latest?.status==='completed',confirmed=w.exports?.[0]?.confirmed,coverVisible=!latest?.verified&&!running&&!completed;
 useEffect(()=>{if(!cover||!coverVisible){setCoverPreview('');return;}const url=URL.createObjectURL(cover);setCoverPreview(url);return()=>URL.revokeObjectURL(url);},[cover,coverVisible]);
 useEffect(()=>{if(!running)return;let active=true,busy=false;const timer=setInterval(()=>{if(busy)return;busy=true;void localRequest(`episodes/${w.episodeId}/workspace`).then(r=>{if(active)notify.current(r.workspace);}).catch(()=>{if(active)setError('交付状态暂不可用，请刷新重试。');}).finally(()=>{busy=false;});},2500);return()=>{active=false;clearInterval(timer);};},[w.episodeId,running]);
 async function run(name:string,extra:Record<string,unknown>){setError('');try{onChange(await command(name,{episodeId:w.episodeId,workspaceId:w.id,expectedRevision:w.revision,...extra}) as ProductionWorkspace);}catch(cause){setError(cause instanceof Error?cause.message:'交付未完成，请重试。');}}
 async function prepare(){if(!cover)return;try{const bytes=new Uint8Array(await cover.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));const e=w.exports![0];await run('prepareWorkspaceDelivery',{exportId:e.id,expectedExportSha256:e.artifact?.sha256,expectedContentSha256:e.contentSha256,title,description,tags:tags.split(/[,，]/).map(t=>t.trim()).filter(Boolean),coverBase64:btoa(binary)});}catch{setError('封面读取失败，请重新选择。');}}
 return <section className="workspace-delivery workspace-delivery-compact" aria-label="交付包">
 <div className="workspace-review-heading"><h4>交付包</h4><span>{latest?.verified?'验证完成':confirmed?'可准备':'待文件确认'}</span></div>
 {latest?.verified?<><p role="status">生产完成 · 交付包已验证</p><div className="workspace-delivery-files">{latest.artifacts.map(a=><a key={a.artifactType} href={`/_local-artifact?episode=${encodeURIComponent(w.episodeId)}&path=${encodeURIComponent(a.relativePath)}&sha256=${a.sha256}`} target="_blank" rel="noreferrer">{labels[a.artifactType]??a.artifactType}</a>)}</div></>:running?<p role="status">{latest.status==='running'?'正在校验交付文件…':'交付已排队…'}</p>:completed?<p role="alert">{latest.error}</p>:<>
 {!confirmed&&<p>确认最终文件后准备交付。</p>}
 <div className="workspace-delivery-fields">
  <div className="workspace-delivery-cover"><span>封面</span><Button className="workspace-delivery-cover-picker" noTextPadding size="sm" color="secondary" aria-label={cover?'替换封面':'选择封面'} isDisabled={pending||!confirmed} onPress={()=>coverInput.current?.click()}>{coverPreview?<img src={coverPreview} alt="交付封面预览"/>:<span className="workspace-delivery-cover-placeholder"><ImageIcon size={28} aria-hidden="true"/><span>选择封面图片</span></span>}</Button><span className="workspace-delivery-cover-name" title={cover?.name}>{cover?.name??'尚未选择封面'}</span><input ref={coverInput} hidden aria-label="封面" type="file" accept="image/png,image/jpeg,image/webp" disabled={pending||!confirmed} onChange={e=>{setCover(e.target.files?.[0]??null);setError('');}}/></div>
  <div className="workspace-delivery-text-fields"><label>标题<input value={title} maxLength={200} disabled={pending||!confirmed} onChange={e=>setTitle(e.target.value)}/></label><label>简介<textarea value={description} rows={4} maxLength={5000} disabled={pending||!confirmed} onChange={e=>setDescription(e.target.value)}/></label><label>标签<input value={tags} placeholder="用逗号分隔" disabled={pending||!confirmed} onChange={e=>setTags(e.target.value)}/></label></div>
 </div>
 <Button size="sm" color="primary" isDisabled={pending||!confirmed||!title.trim()||!cover||w.stale} onPress={()=>void prepare()}>生成并验证交付包</Button>
 {latest&&['failed','blocked'].includes(latest.status)&&<><p role="alert">{latest.error}</p><Button size="sm" color="secondary" isDisabled={pending||!confirmed} onPress={()=>void run('retryWorkspaceDelivery',{deliveryId:latest.id})}>重试原交付</Button></>}
 </>}
 {error&&<p role="alert">{error}</p>}
 </section>;
}
