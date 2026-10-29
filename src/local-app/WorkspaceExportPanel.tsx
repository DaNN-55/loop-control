import {WorkspaceDeliveryPanel} from './WorkspaceDeliveryPanel';
import {useState} from 'react';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import type {ProductionWorkspace} from '../productionWorkspace';
export function WorkspaceExportPanel({workspace:w,pending,command,onChange}:{workspace:ProductionWorkspace;pending:boolean;command:(name:string,data:unknown)=>Promise<unknown>;onChange:(w:ProductionWorkspace)=>void}){
 const [reason,setReason]=useState('');const completed=w.deliveries?.some(d=>d.status==='completed');const latest=w.exports?.[0],issues=w.exportIssues??[],blocked=issues.some(x=>!x.resolved);
 async function run(name:string,extra:Record<string,unknown>={}){const result=await command(name,{episodeId:w.episodeId,workspaceId:w.id,expectedRevision:w.revision,...extra});onChange(result as ProductionWorkspace);}
 return <section className="production-workspace-section workspace-export"><header><h3>检查与交付</h3><Button size="sm" color="primary" isDisabled={pending||w.stale||completed} onPress={()=>void run('exportWorkspace').catch(()=>{})}>{pending?'正在导出与检查…':latest?'重新导出并检查':'导出最终视频并检查'}</Button></header>
 {w.readiness.placeholders.length>0&&<p>还有 {w.readiness.placeholders.length} 处占位</p>}
 {latest?<>
  {!latest.current&&<p role="status">工程已变化，请重新导出当前内容。</p>}
  {latest.artifact&&<video aria-label="最终导出视频" controls preload="metadata" src={`/_local-artifact?episode=${encodeURIComponent(w.episodeId)}&path=${encodeURIComponent(latest.artifact.relativePath)}&sha256=${latest.artifact.sha256}`} style={{maxWidth:'100%',maxHeight:'60vh',background:'#111'}}/>}
  <ul>{latest.checks.map((check,i)=><li key={`${check.name}-${i}`} role={!check.passed?'alert':undefined}>{check.passed?'通过':'未通过'} · {check.detail}</li>)}</ul>
  {latest.artifact&&<details><summary>文件信息</summary><p>工程版本 {latest.projectContentVersion} · {latest.artifact.fileSize.toLocaleString()} 字节</p><code style={{overflowWrap:'anywhere'}}>{latest.artifact.sha256}</code></details>}
  {latest.confirmed?<p role="status">已确认这份最终文件</p>:<Button size="sm" color="primary" isDisabled={pending||!latest.current||latest.status!=='ready'||latest.checks.some(c=>!c.passed)||blocked} onPress={()=>void run('confirmWorkspaceExport',{exportId:latest.id,expectedExportSha256:latest.artifact?.sha256,expectedContentSha256:w.contentSha256}).catch(()=>{})}>确认这份最终文件</Button>}
 </>:<p>先导出最终视频，检查后确认这份文件。</p>}
 <label>问题记录<textarea disabled={completed} value={reason} onChange={e=>setReason(e.target.value)} maxLength={4000}/></label><Button size="sm" color="secondary" isDisabled={pending||completed||!reason.trim()} onPress={()=>void run('recordWorkspaceExportIssue',{...(latest?{exportId:latest.id}:{}),reason}).then(()=>setReason('')).catch(()=>{})}>记录问题</Button>
 {issues.map(issue=><div key={issue.id}><span>{issue.reason}{issue.resolved?' · 已解决':''}</span>{!issue.resolved&&<Button size="sm" color="secondary" isDisabled={pending||completed} onPress={()=>void run('resolveWorkspaceExportIssue',{issueId:issue.id}).catch(()=>{})}>标为已解决</Button>}</div>)}
 {(w.exports?.length??0)>1&&<details><summary>导出历史</summary>{w.exports!.slice(1).map(e=><p key={e.id}>工程版本 {e.projectContentVersion} · {e.status==='ready'?'检查通过':'未通过'}{e.confirmedAt?' · 曾确认':''} · {e.artifact?.sha256.slice(0,12)??'无输出文件'}</p>)}</details>}
 <WorkspaceDeliveryPanel workspace={w} pending={pending} command={command} onChange={onChange}/>
 </section>;
}
