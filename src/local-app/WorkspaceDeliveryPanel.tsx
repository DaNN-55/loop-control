import {useEffect,useState} from 'react';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import type {ProductionWorkspace} from '../productionWorkspace';
import {localRequest} from './client';
const labels:Record<string,string>={final_render:'最终视频',editable_project:'可编辑工程',cover:'封面',metadata:'元数据',final_qc_report:'检查证据',publish_package:'交付清单'};
export function WorkspaceDeliveryPanel({workspace:w,pending,command,onChange}:{workspace:ProductionWorkspace;pending:boolean;command:(name:string,data:unknown)=>Promise<unknown>;onChange:(w:ProductionWorkspace)=>void}){
 const [title,setTitle]=useState(''),[description,setDescription]=useState(''),[tags,setTags]=useState(''),[cover,setCover]=useState<File|null>(null),[error,setError]=useState('');
 const latest=w.deliveries?.[0],running=latest&&['ready','running'].includes(latest.status),completed=latest?.status==='completed',confirmed=w.exports?.[0]?.confirmed;
 useEffect(()=>{if(!running)return;let active=true,busy=false;const timer=setInterval(()=>{if(busy)return;busy=true;void localRequest(`episodes/${w.episodeId}/workspace`).then(r=>{if(active)onChange(r.workspace);}).catch(()=>{if(active)setError('交付状态暂不可用，请刷新重试。');}).finally(()=>{busy=false;});},2500);return()=>{active=false;clearInterval(timer);};},[w.episodeId,running,onChange]);
 async function run(name:string,extra:Record<string,unknown>){setError('');try{onChange(await command(name,{episodeId:w.episodeId,workspaceId:w.id,expectedRevision:w.revision,...extra}) as ProductionWorkspace);}catch(cause){setError(cause instanceof Error?cause.message:'交付未完成，请重试。');}}
 async function prepare(){if(!cover)return;try{const bytes=new Uint8Array(await cover.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));const e=w.exports![0];await run('prepareWorkspaceDelivery',{exportId:e.id,expectedExportSha256:e.artifact?.sha256,expectedContentSha256:e.contentSha256,title,description,tags:tags.split(/[,，]/).map(t=>t.trim()).filter(Boolean),coverBase64:btoa(binary)});}catch{setError('封面读取失败，请重新选择。');}}
 return <section className="workspace-delivery" aria-label="交付包">
 <h4>交付包</h4>
 {latest?.verified?<><p role="status">生产完成 · 交付包已验证</p><div className="workspace-delivery-files">{latest.artifacts.map(a=><a key={a.artifactType} href={`/_local-artifact?episode=${encodeURIComponent(w.episodeId)}&path=${encodeURIComponent(a.relativePath)}&sha256=${a.sha256}`} target="_blank" rel="noreferrer">{labels[a.artifactType]??a.artifactType}</a>)}</div></>:running?<p role="status">{latest.status==='running'?'正在校验交付文件…':'交付已排队…'}</p>:completed?<p role="alert">{latest.error}</p>:<>
 {!confirmed&&<p>确认最终文件后准备交付。</p>}
 <div className="workspace-delivery-fields"><label>标题<input value={title} maxLength={200} disabled={pending||!confirmed} onChange={e=>setTitle(e.target.value)}/></label><label>标签<input value={tags} placeholder="用逗号分隔" disabled={pending||!confirmed} onChange={e=>setTags(e.target.value)}/></label><label>封面<input type="file" accept="image/png,image/jpeg,image/webp" disabled={pending||!confirmed} onChange={e=>setCover(e.target.files?.[0]??null)}/></label></div>
 <label>说明<textarea value={description} maxLength={5000} disabled={pending||!confirmed} onChange={e=>setDescription(e.target.value)}/></label>
 <Button size="sm" color="primary" isDisabled={pending||!confirmed||!title.trim()||!cover||w.stale} onPress={()=>void prepare()}>生成并验证交付包</Button>
 {latest&&['failed','blocked'].includes(latest.status)&&<><p role="alert">{latest.error}</p><Button size="sm" color="secondary" isDisabled={pending||!confirmed} onPress={()=>void run('retryWorkspaceDelivery',{deliveryId:latest.id})}>重试原交付</Button></>}
 </>}
 {error&&<p role="alert">{error}</p>}
 </section>;
}
