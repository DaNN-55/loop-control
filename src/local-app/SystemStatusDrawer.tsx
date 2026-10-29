import {useEffect, useState, type ReactNode} from 'react';
import {createPortal} from 'react-dom';
import {ChevronDown, X} from 'lucide-react';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import {useDialogFocus} from '../ui/useDialogFocus';
import {stateLabel, type StatusItem, type SystemState} from '../observability/SystemStatusSurface';
import {taskStatusLabel, taskTypeLabel} from '../observability/TaskProgressPanel';
import type {RuntimeStatus} from '../observability/runtimeStatus';
import {healthCheckLabels,type HealthCheck} from '../observability/healthChecks';
import './SystemStatusDrawer.css';

interface Props {
  open: boolean; onOpen: () => void; onClose: () => void;
  runtime: RuntimeStatus | null; maintenance: StatusItem[]; maintenanceAvailable: boolean;
  pending: boolean; error: string; observedAt: string | null;
  onRefresh: () => void; onPage: (page:number) => void;
  onOpenEpisode?: (id:string) => boolean | void; triggerLabel?: string;
}
const bytes=(value:number|null|undefined)=>value==null?'未读取':`${new Intl.NumberFormat('zh-CN',{maximumFractionDigits:1}).format(value/1024**3)} GB`;
const date=(value:string|null|undefined)=>value?new Intl.DateTimeFormat('zh-CN',{dateStyle:'short',timeStyle:'medium',timeZone:'Asia/Shanghai'}).format(new Date(value)):'未读取';
function combined(states:SystemState[]):SystemState {
  return states.includes('offline')||states.includes('attention')?'attention':states.includes('unknown')?'unknown':'healthy';
}
function HealthChecks({checks}:{checks:HealthCheck[]}) {
  return <ul className="status-drawer-checks" aria-label="健康检查分项">{checks.map(check=><li key={check.id}><div><span>{healthCheckLabels[check.id]}</span><span className={check.passed?'is-healthy':'is-failed'}>{check.passed?'通过':'失败'}</span></div>{!check.passed&&<p>{check.detail}</p>}</li>)}</ul>;
}
function Section({title,summary,attention=false,children,initialOpen=false}:{title:string;summary:string;attention?:boolean;children:ReactNode;initialOpen?:boolean}) {
  const [open,setOpen]=useState(initialOpen);
  useEffect(()=>{if(attention)setOpen(true);},[attention]);
  return <details className="status-drawer-section" open={open} onToggle={event=>setOpen(event.currentTarget.open)}><summary><h3>{title}</h3><span className={attention?'status-drawer-warning':''}>{summary}</span><ChevronDown size={16}/></summary><div className="status-drawer-content">{children}</div></details>;
}
export function SystemStatusDrawer({open,onOpen,onClose,runtime,maintenance,maintenanceAvailable,pending,error,observedAt,onRefresh,onPage,onOpenEpisode,triggerLabel}:Props) {
  const [expanded,setExpanded]=useState(false),[hovering,setHovering]=useState(false);
  const ref=useDialogFocus<HTMLElement>(open,onClose);
  useEffect(()=>{
    if(!open)return;
    const previous=document.body.style.overflow;document.body.style.overflow='hidden';
    return()=>{document.body.style.overflow=previous;};
  },[open]);
  const worker=runtime?.worker,queue=runtime?.queue,resources=runtime?.resources;
  const maintenanceState=maintenanceAvailable?combined(maintenance.filter(item=>item.stateText!=='已关闭'&&item.stateText!=='未启用').map(item=>item.state)):'unknown';
  const resourceState:SystemState=resources?combined([resources.disk?'healthy':'unknown',resources.media.state]):'unknown';
  const overall:SystemState=error?'offline':combined([worker?.state??'unknown',queue?queue.blocked+queue.failed?'attention':'healthy':'unknown',resourceState,maintenanceState]);
  const statusText=pending&&!observedAt?'读取中…':stateLabel(overall);
  const workerSummary=!worker?'未读取':worker.state==='healthy'?`在线 · ${worker.active?'忙碌':'空闲'}`:worker.state==='offline'?'离线':worker.state==='attention'?'需处理':'未配置';
  const queueSummary=!queue?'未读取':queue.total?[queue.running?`${queue.running} 执行中`:'',queue.queued?`${queue.queued} 排队`:'',queue.blocked+queue.failed?`${queue.blocked+queue.failed} 需处理`:''].filter(Boolean).join(' · '):'暂无活动任务';
  const resourceSummary=!resources?'未读取':resources.media.state==='offline'?'素材盘不可用':resources.media.state==='attention'?'素材盘空间不足':`内存空闲 ${bytes(resources.memory.freeBytes)} · 磁盘可用 ${bytes(resources.disk?.availableBytes)}`;
  const hoverSummary=`Worker ${workerSummary}；${queueSummary}；最近读取 ${date(observedAt)}`;
  return <div className="system-status">
    <Button size="sm" color="tertiary" aria-label={`系统状态：${statusText}`} aria-expanded={open} aria-haspopup="dialog" data-status-summary={hoverSummary} className={`system-status-trigger system-status-${overall}`} onClick={open?onClose:onOpen} onMouseEnter={()=>setHovering(true)} onMouseLeave={()=>setHovering(false)} onFocus={()=>setHovering(true)} onBlur={()=>setHovering(false)}><i aria-hidden="true"/>{triggerLabel&&<span className="sidebar-tool-label">{triggerLabel}</span>}</Button>
    {hovering&&!open&&<div className="system-status-hover-card" aria-hidden="true"><div className="system-status-hover-row"><i className={`system-status-hover-dot system-status-hover-dot-${worker?.state??'unknown'}`}/><strong>Worker</strong><span>{workerSummary}</span></div><div className="system-status-hover-row"><i className={`system-status-hover-dot system-status-hover-dot-${!queue?'unknown':queue.blocked+queue.failed?'attention':'healthy'}`}/><strong>任务队列</strong><span>{queueSummary}</span></div></div>}
    {open&&createPortal(<div className="status-drawer-layer dan-ui product-ui"><div className="status-drawer-scrim" onClick={onClose}/><aside role="dialog" aria-modal="true" aria-label="系统状态详情" className="status-drawer-drawer" ref={ref}>
      <header className="status-drawer-heading"><h2>系统状态</h2><span className={`status-drawer-status${overall==='healthy'?'':overall==='unknown'?' is-muted':' is-warning'}`} role="status"><i/>{statusText}</span><Button size="sm" color="tertiary" aria-label="关闭系统状态详情" iconLeading={X} onClick={onClose}/></header>
      <div className="status-drawer-body" aria-busy={pending}>
        {error&&<p role="alert" className="status-drawer-problem">{error}</p>}
        <Section title="本机 Worker" summary={workerSummary} attention={worker?.state==='offline'||worker?.state==='attention'}>
          <dl className="status-drawer-facts"><div><dt>最近心跳</dt><dd>{date(worker?.heartbeatAt)}</dd></div><div><dt>执行位</dt><dd>{worker?.active!=null&&worker.capacity!=null?`${worker.active} / ${worker.capacity} 使用中`:'未读取'}</dd></div><div><dt>最近扫描</dt><dd>{date(worker?.lastScanAt)}</dd></div></dl>
          {worker?.problem&&<p className="status-drawer-problem">{worker.problem}</p>}
        </Section>
        <Section title="任务队列" summary={queueSummary} initialOpen attention={!!queue&&(queue.blocked+queue.failed)>0}>
          {!queue?<p className="status-drawer-empty">任务队列尚未读取或暂不可用，请刷新重试。</p>:!queue.total?<p className="status-drawer-empty">当前没有等待或执行中的任务。</p>:<>
            <ul className="status-drawer-tasks">{queue.items.slice(0,expanded?queue.items.length:2).map(task=><li key={task.id}><div className="status-drawer-task-heading"><strong>{taskTypeLabel(task.taskType)}</strong><span className={task.status==='running'?'status-drawer-running':task.status==='failed'||task.status==='blocked'?'status-drawer-warning':''}>{taskStatusLabel(task.status)}</span></div><div className="status-drawer-task-meta"><span>{task.episodeTitle}</span>{onOpenEpisode?<button aria-label={`查看生产单：${task.episodeTitle}`} onClick={()=>{if(onOpenEpisode(task.episodeId)!==false)onClose();}}>查看</button>:<a href={`?episode=${encodeURIComponent(task.episodeId)}`}>查看</a>}</div>{expanded&&<p className="status-drawer-empty">{task.status==='running'?`开始于 ${date(task.claimedAt)}`:task.status==='ready'&&task.availableAt&&Date.parse(task.availableAt)>Date.parse(runtime!.observedAt)?`等待重试 · ${date(task.availableAt)}`:task.status==='ready'?'等待 Worker 领取':task.status==='failed'?'任务执行失败，请查看生产单。':'任务存在阻塞，请查看生产单。'}</p>}</li>)}</ul>
            {queue.items.length>2&&<button className="status-drawer-expand" onClick={()=>setExpanded(!expanded)}>{expanded?'收起':queue.total>queue.pageSize?`展开本页 ${queue.items.length} 项`:`展开全部 ${queue.total} 项`}</button>}
            {expanded&&queue.total>queue.pageSize&&<div className="status-drawer-pagination"><Button size="xs" color="secondary" isDisabled={pending||queue.page===1} onClick={()=>onPage(queue.page-1)}>上一页</Button><span>{queue.page} / {Math.ceil(queue.total/queue.pageSize)}</span><Button size="xs" color="secondary" isDisabled={pending||queue.page*queue.pageSize>=queue.total} onClick={()=>onPage(queue.page+1)}>下一页</Button></div>}
          </>}
        </Section>
        <Section title="资源状态" summary={resourceSummary} attention={resourceState==='offline'||resourceState==='attention'}>
          <dl className="status-drawer-facts"><div><dt>CPU 使用</dt><dd>{resources?.cpuPercent==null?'未读取':`${resources.cpuPercent}%`}</dd></div><div><dt>空闲内存 / 总计</dt><dd>{resources?`${bytes(resources.memory.freeBytes)} / ${bytes(resources.memory.totalBytes)}`:'未读取'}</dd></div><div><dt>本机磁盘可用</dt><dd>{bytes(resources?.disk?.availableBytes)}</dd></div><div><dt>素材盘</dt><dd>{!resources?'未读取':resources.media.state==='unknown'?'未配置挂载检查':resources.media.state==='offline'?'不可用':`${bytes(resources.media.availableBytes)} 可用`}</dd></div></dl>
          {resources?.media.state==='offline'&&<p className="status-drawer-problem">检查素材盘挂载及媒体目录读写权限。</p>}
          {resources?.media.state==='attention'&&<p className="status-drawer-problem">素材盘可用空间低于运行要求（{bytes(resources.media.minimumFreeBytes)}）。</p>}
        </Section>
        <Section title="日常维护" summary={stateLabel(maintenanceState)}>
          {!maintenanceAvailable?<p className="status-drawer-empty">维护状态暂不可用，请刷新重试。</p>:maintenance.map(item=><details className="status-drawer-maintenance" key={item.id}><summary><span>{item.label}</span><span className={item.state==='attention'||item.state==='offline'?'status-drawer-warning':''}>{item.stateText??stateLabel(item.state)}</span><ChevronDown size={14}/></summary>{item.checks?<HealthChecks checks={item.checks}/>:item.detail&&<p>{item.detail}</p>}{item.id==='health'&&!item.checks&&item.detailRows?.some(row=>row.label==='最近结果')&&<p>此记录未保存分项结果。</p>}{!!item.detailRows?.length&&<dl className="status-drawer-facts">{item.detailRows.map((row,index)=><div key={index}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}</dl>}{item.lastFailureChecks&&<details className="status-drawer-check-history"><summary>最近失败分项</summary><HealthChecks checks={item.lastFailureChecks}/></details>}</details>)}
        </Section>
      </div>
      <footer className="status-drawer-footer"><span>最近读取 {date(observedAt)}</span><Button size="sm" color="secondary" isDisabled={pending} onClick={onRefresh}>{pending?'读取中…':'刷新系统状态'}</Button></footer>
    </aside></div>,document.body)}
  </div>;
}
