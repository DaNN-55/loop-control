import {uiText,getUiLocale} from '../i18n/ui';
import {useEffect, useRef, useState, type ReactNode} from 'react';
import {createPortal} from 'react-dom';
import {ChevronDown, X} from 'lucide-react';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import {useDialogFocus} from '../ui/useDialogFocus';
import {stateLabel, type StatusItem, type SystemState} from '../observability/SystemStatusSurface';
import {taskStatusLabel, taskTypeLabel} from '../observability/TaskProgressPanel';
import type {RuntimeStatus,RuntimeVersionState} from '../observability/runtimeStatus';
import {healthCheckLabels,type HealthCheck} from '../observability/healthChecks';
import './SystemStatusDrawer.css';

interface Props {
  open: boolean; onOpen: () => void; onClose: () => void;
  runtime: RuntimeStatus | null; maintenance: StatusItem[]; maintenanceAvailable: boolean;
  pending: boolean; error: string; observedAt: string | null;
  onRefresh: () => void; onPage: (page:number) => void;
  onOpenEpisode?: (id:string) => boolean | void; triggerLabel?: string;
}
const versionLabels:Record<RuntimeVersionState,string>={current:'已应用当前版本',source_changed:'开发改动待准备',restart_required:'新版已准备，待重启',preparing:'新版准备中',not_prepared:'未找到已准备版本',prepared_invalid:'准备版本不可用',running_invalid:'运行版本校验失败',mismatch:'后台与 Worker 版本不一致',unknown:'版本待确认'};
const bytes=(value:number|null|undefined)=>value==null?uiText("未读取"):`${new Intl.NumberFormat(getUiLocale(),{maximumFractionDigits:1}).format(value/1024**3)} GB`;
const date=(value:string|null|undefined)=>value?new Intl.DateTimeFormat(getUiLocale(),{dateStyle:'short',timeStyle:'medium',timeZone:'Asia/Shanghai'}).format(new Date(value)):uiText("未读取");
function combined(states:SystemState[]):SystemState {
  return states.includes('offline')||states.includes('attention')?'attention':states.includes('unknown')?'unknown':'healthy';
}
function HealthChecks({checks}:{checks:HealthCheck[]}) {
  return <ul className="status-drawer-checks" aria-label={uiText("健康检查分项")}>{checks.map(check=><li key={check.id}><div><span>{uiText(healthCheckLabels[check.id])}</span><span className={check.passed?'is-healthy':'is-failed'}>{check.passed?uiText("通过"):uiText("失败")}</span></div>{!check.passed&&<p>{check.detail}</p>}</li>)}</ul>;
}
const usedPercent=(available:number|null|undefined,total:number|null|undefined)=>available==null||total==null||!Number.isFinite(available)||!Number.isFinite(total)||total<=0||available<0||available>total?null:(1-available/total)*100;
function ResourceReading({label,basis,percent,value,valueLabel,unknownLabel=uiText("未读取"),warning=false}:{label:string;basis:string;percent:number|null;value:string;valueLabel?:string;unknownLabel?:string;warning?:boolean}) {
  const display=percent===null?'—':`${Math.round(percent)}%`;
  return <div><dt><span className={`status-drawer-resource-ring${percent===null?' is-unknown':warning?' is-warning':''}`} role="img" aria-label={percent===null?uiText("{value0} {value1}比例{value2}",{value0:label,value1:basis,value2:unknownLabel}):`${label} ${basis} ${display}`}><svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="20"/>{percent!==null&&<circle className="status-drawer-resource-ring-value" cx="24" cy="24" r="20" pathLength="100" strokeDasharray={`${percent} 100`} transform="rotate(-90 24 24)"/>}</svg><span aria-hidden="true">{display}</span></span><span>{label}<small>{basis}</small></span></dt><dd>{valueLabel&&<small>{valueLabel}</small>}<span>{value}</span></dd></div>;
}
function Section({title,summary,attention=false,children,initialOpen=false}:{title:string;summary:string;attention?:boolean;children:ReactNode;initialOpen?:boolean}) {
  const [open,setOpen]=useState(initialOpen);
  useEffect(()=>{if(attention)setOpen(true);},[attention]);
  return <details className="status-drawer-section" open={open} onToggle={event=>setOpen(event.currentTarget.open)}><summary><h3>{title}</h3><span className={attention?'status-drawer-warning':''}>{summary}</span><ChevronDown size={16}/></summary><div className="status-drawer-content">{children}</div></details>;
}
export function SystemStatusDrawer({open,onOpen,onClose,runtime,maintenance,maintenanceAvailable,pending,error,observedAt,onRefresh,onPage,onOpenEpisode,triggerLabel}:Props) {
  const [expanded,setExpanded]=useState(false),[hovering,setHovering]=useState(false);
  const [present,setPresent]=useState(false);
  const ref=useDialogFocus<HTMLElement>(open,onClose),layer=useRef<HTMLDivElement>(null),animations=useRef<Animation[]>([]);
  useEffect(()=>{
    const panel=ref.current,overlay=layer.current;
    if(!panel||!overlay)return;
    const preference=window.matchMedia?.('(prefers-reduced-motion: reduce)');
    // Read the in-flight position before cancellation so quick reversals remain continuous.
    const opacity=present?getComputedStyle(overlay).opacity:'0',transform=present?getComputedStyle(panel).transform:'translateX(24px)';
    animations.current.forEach(animation=>animation.cancel());
    if(preference?.matches||typeof panel.animate!=='function'){setPresent(open);return;}
    if(open)setPresent(true);
    const duration=open?220:160;
    const running=[overlay.animate([{opacity},{opacity:open?'1':'0'}],{duration,easing:'ease-out',fill:'both'}),panel.animate([{transform},{transform:open?'translateX(0)':'translateX(24px)'}],{duration,easing:'cubic-bezier(.32,.72,0,1)',fill:'both'})];
    animations.current=running;
    let active=true;
    const reduce=()=>{if(preference?.matches)running.forEach(animation=>animation.finish());};
    preference?.addEventListener('change',reduce);
    void Promise.allSettled(running.map(animation=>animation.finished)).then(()=>{if(active&&!open)setPresent(false);});
    return()=>{active=false;preference?.removeEventListener('change',reduce);};
    // Presence is the result of this transition, not another transition trigger.
  },[open]);
  useEffect(()=>()=>{animations.current.forEach(animation=>animation.cancel());},[]);
  useEffect(()=>{
    if(!open)return;
    const previous=document.body.style.overflow;document.body.style.overflow='hidden';
    return()=>{document.body.style.overflow=previous;};
  },[open]);
  const version=runtime?.version,versionFailure=version?.state==='running_invalid'||version?.state==='mismatch';
  const worker=runtime?.worker,queue=runtime?.queue,resources=runtime?.resources;
  const maintenanceState=maintenanceAvailable?combined(maintenance.filter(item=>item.stateText!==uiText("已关闭")&&item.stateText!==uiText("未启用")).map(item=>item.state)):'unknown';
  const resourceState:SystemState=resources?combined([resources.disk?'healthy':'unknown',resources.systemDisk?'healthy':'unknown',resources.media.state]):'unknown';
  const overall:SystemState=error?'offline':combined([versionFailure?'attention':version?.state==='current'?'healthy':'unknown',worker?.state??'unknown',queue?queue.blocked+queue.failed?'attention':'healthy':'unknown',resourceState,maintenanceState]);
  const statusText=pending&&!observedAt?uiText("读取中…"):uiText(stateLabel(overall));
  const workerSummary=!worker?uiText("未读取"):worker.state==='healthy'?uiText("在线 · {value0}",{value0:worker.active?uiText('忙碌'):uiText('空闲')}):worker.state==='offline'?uiText("离线"):worker.state==='attention'?uiText("需处理"):uiText("未配置");
  const queueSummary=!queue?uiText("未读取"):queue.total?[queue.running?uiText("{value0} 执行中",{value0:queue.running}):'',queue.queued?uiText("{value0} 排队",{value0:queue.queued}):'',queue.blocked+queue.failed?uiText("{value0} 需处理",{value0:queue.blocked+queue.failed}):''].filter(Boolean).join(' · '):uiText("暂无活动任务");
  const systemDiskSummary=!resources?uiText("系统盘未读取"):resources.systemDisk?uiText("系统盘可用 {value0}",{value0:bytes(resources.systemDisk.availableBytes)}):resources.systemDisk===null?uiText("系统盘读取失败"):uiText("系统盘待确认");
  const mediaDiskSummary=!resources?uiText("素材盘未读取"):resources.media.state==='offline'?uiText("素材盘不可用"):resources.media.state==='unknown'?uiText("素材盘待确认"):uiText("素材盘{value0}可用 {value1}",{value0:resources.media.state==='attention'?uiText('空间不足，'):'',value1:bytes(resources.media.availableBytes)});
  const resourceSummary=!resources?uiText("未读取"):resources.systemDisk&&resources.media.sameVolume&&resources.media.state==='healthy'?uiText("系统盘与素材盘共用空间 · 可用 {value0}",{value0:bytes(resources.systemDisk.availableBytes)}):`${systemDiskSummary} · ${mediaDiskSummary}`;
  const cpuPercent=resources?.cpuPercent;
  const mediaReadable=resources&&(resources.media.state==='healthy'||resources.media.state==='attention');
  const mediaVolume=resources?.media.sameVolume&&resources.systemDisk?resources.systemDisk:resources?.media;
  const hoverSummary=uiText("Worker {value0}；{value1}；最近读取 {value2}",{value0:workerSummary,value1:queueSummary,value2:date(observedAt)});
  return <div className="system-status">
    <Button size="sm" color="tertiary" aria-label={uiText("系统状态：{value0}",{value0:statusText})} aria-expanded={open} aria-haspopup="dialog" data-status-summary={hoverSummary} className={`system-status-trigger system-status-${overall}`} onClick={open?onClose:onOpen} onMouseEnter={()=>setHovering(true)} onMouseLeave={()=>setHovering(false)} onFocus={()=>setHovering(true)} onBlur={()=>setHovering(false)}><i aria-hidden="true"/>{triggerLabel&&<span className="sidebar-tool-label">{triggerLabel}</span>}</Button>
    {hovering&&!open&&<div className="system-status-hover-card" aria-hidden="true"><div className="system-status-hover-row"><i className={`system-status-hover-dot system-status-hover-dot-${worker?.state??'unknown'}`}/><strong>Worker</strong><span>{workerSummary}</span></div><div className="system-status-hover-row"><i className={`system-status-hover-dot system-status-hover-dot-${!queue?'unknown':queue.blocked+queue.failed?'attention':'healthy'}`}/><strong>{uiText("任务队列")}</strong><span>{queueSummary}</span></div></div>}
    {(open||present)&&createPortal(<div ref={layer} className="status-drawer-layer dan-ui product-ui" inert={!open}><div className="status-drawer-scrim" onClick={onClose}/><section role="dialog" aria-modal="true" aria-label={uiText("系统状态详情")} className="status-drawer-drawer" ref={ref}>
      <header className="status-drawer-heading"><h2>{uiText("系统状态")}</h2><span className={`status-drawer-status${overall==='healthy'?'':overall==='unknown'?' is-muted':' is-warning'}`} role="status"><i/>{statusText}</span><Button size="sm" color="tertiary" aria-label={uiText("关闭系统状态详情")} iconLeading={X} onClick={onClose}/></header>
      <div className="status-drawer-body" aria-busy={pending}>
        {error&&<p role="alert" className="status-drawer-problem">{error}</p>}
        <Section title={uiText("运行版本")} summary={version?uiText(versionLabels[version.state]):uiText("版本待确认")} attention={versionFailure}>
          <dl className="status-drawer-facts">
            <div><dt>{uiText("后台版本")}</dt><dd title={version?.backendReleaseId??undefined}>{version?.backendReleaseId?.slice(0,12)??uiText("待确认")}</dd></div>
            <div><dt>{uiText("Worker 版本")}</dt><dd title={version?.workerReleaseId??undefined}>{version?.workerReleaseId?.slice(0,12)??uiText("待确认")}</dd></div>
            <div><dt>{uiText("启动时间")}</dt><dd>{date(version?.startedAt)}</dd></div>
            {version?.preparedReleaseId&&version.preparedReleaseId!==version.backendReleaseId&&<div><dt>{uiText("已准备版本")}</dt><dd title={version.preparedReleaseId}>{version.preparedReleaseId.slice(0,12)}</dd></div>}
            <div><dt>{uiText("页面模式")}</dt><dd>{import.meta.env.DEV?uiText("开发热更新"):uiText("构建页面")}</dd></div>
          </dl>
          {version?.state==='source_changed'&&<p className="status-drawer-empty">{uiText("新改动尚未准备；当前后台和 Worker 继续使用已启动版本。")}</p>}
          {version?.state==='restart_required'&&<p className="status-drawer-empty">{uiText("当前服务仍使用已启动版本，重启后才会应用新版。")}</p>}
          {version?.state==='running_invalid'&&<p className="status-drawer-problem">{uiText("当前运行文件校验失败，请检查并重新准备运行版本。")}</p>}
          {version?.state==='prepared_invalid'&&<p className="status-drawer-empty">{uiText("新版本未通过校验，请重新准备；当前服务未切换版本。")}</p>}
          {(!version||version.state==='unknown')&&<p className="status-drawer-empty">{uiText("尚未确认完整运行版本，不能据此判断更新已生效。")}</p>}
        </Section>
        <Section title={uiText("本机 Worker")} summary={workerSummary} attention={worker?.state==='offline'||worker?.state==='attention'}>
          <dl className="status-drawer-facts"><div><dt>{uiText("最近心跳")}</dt><dd>{date(worker?.heartbeatAt)}</dd></div><div><dt>{uiText("执行位")}</dt><dd>{worker?.active!=null&&worker.capacity!=null?uiText("{value0} / {value1} 使用中",{value0:worker.active,value1:worker.capacity}):uiText("未读取")}</dd></div><div><dt>{uiText("最近扫描")}</dt><dd>{date(worker?.lastScanAt)}</dd></div></dl>
          {worker?.problem&&<p className="status-drawer-problem">{worker.problem}</p>}
        </Section>
        <Section title={uiText("任务队列")} summary={queueSummary} initialOpen attention={!!queue&&(queue.blocked+queue.failed)>0}>
          {!queue?<p className="status-drawer-empty">{uiText("任务队列尚未读取或暂不可用，请刷新重试。")}</p>:!queue.total?<p className="status-drawer-empty">{uiText("当前没有等待或执行中的任务。")}</p>:<>
            <ul className="status-drawer-tasks">{queue.items.slice(0,expanded?queue.items.length:2).map(task=><li key={task.id}><div className="status-drawer-task-heading"><strong>{uiText(taskTypeLabel(task.taskType))}</strong><span className={task.status==='running'?'status-drawer-running':task.status==='failed'||task.status==='blocked'?'status-drawer-warning':''}>{uiText(taskStatusLabel(task.status))}</span></div><div className="status-drawer-task-meta"><span>{task.episodeTitle}</span>{onOpenEpisode?<button aria-label={uiText("查看生产单：{value0}",{value0:task.episodeTitle})} onClick={()=>{if(onOpenEpisode(task.episodeId)!==false)onClose();}}>{uiText("查看")}</button>:<a href={`?episode=${encodeURIComponent(task.episodeId)}`}>{uiText("查看")}</a>}</div>{expanded&&<p className="status-drawer-empty">{task.status==='running'?uiText("开始于 {value0}",{value0:date(task.claimedAt)}):task.status==='ready'&&task.availableAt&&Date.parse(task.availableAt)>Date.parse(runtime!.observedAt)?uiText("等待重试 · {value0}",{value0:date(task.availableAt)}):task.status==='ready'?uiText("等待 Worker 领取"):task.status==='failed'?uiText("任务执行失败，请查看生产单。"):uiText("任务存在阻塞，请查看生产单。")}</p>}</li>)}</ul>
            {queue.items.length>2&&<button className="status-drawer-expand" onClick={()=>setExpanded(!expanded)}>{expanded?uiText("收起"):queue.total>queue.pageSize?uiText("展开本页 {value0} 项",{value0:queue.items.length}):uiText("展开全部 {value0} 项",{value0:queue.total})}</button>}
            {expanded&&queue.total>queue.pageSize&&<div className="status-drawer-pagination"><Button size="xs" color="secondary" isDisabled={pending||queue.page===1} onClick={()=>onPage(queue.page-1)}>{uiText("上一页")}</Button><span>{queue.page} / {Math.ceil(queue.total/queue.pageSize)}</span><Button size="xs" color="secondary" isDisabled={pending||queue.page*queue.pageSize>=queue.total} onClick={()=>onPage(queue.page+1)}>{uiText("下一页")}</Button></div>}
          </>}
        </Section>
        <Section title={uiText("资源状态")} summary={resourceSummary} attention={resourceState==='offline'||resourceState==='attention'}>
          <dl className="status-drawer-facts status-drawer-resource-readings">
            <ResourceReading label="CPU" basis={uiText("使用")} percent={cpuPercent!=null&&cpuPercent>=0&&cpuPercent<=100?cpuPercent:null} value={cpuPercent==null?uiText("未读取"):`${cpuPercent}%`}/>
            <ResourceReading label={uiText("内存")} basis={uiText("非空闲")} percent={usedPercent(resources?.memory.freeBytes,resources?.memory.totalBytes)} valueLabel={uiText("空闲 / 总计")} value={resources?`${bytes(resources.memory.freeBytes)} / ${bytes(resources.memory.totalBytes)}`:uiText("未读取")}/>
            <ResourceReading label={uiText("系统盘")} basis={uiText("已用")} percent={usedPercent(resources?.systemDisk?.availableBytes,resources?.systemDisk?.totalBytes)} valueLabel={uiText("可用 / 总计")} unknownLabel={!resources?uiText("未读取"):resources.systemDisk===null?uiText("读取失败"):uiText("待确认")} value={!resources?uiText("未读取"):!resources.systemDisk?resources.systemDisk===null?uiText("读取失败"):uiText("待确认"):`${bytes(resources.systemDisk.availableBytes)} / ${bytes(resources.systemDisk.totalBytes)}`}/>
            <ResourceReading label={uiText("素材盘")} basis={uiText("已用")} percent={mediaReadable?usedPercent(mediaVolume?.availableBytes,mediaVolume?.totalBytes):null} valueLabel={uiText("可用 / 总计")} unknownLabel={!resources?uiText("未读取"):resources.media.state==='offline'?uiText("不可用"):uiText("待确认")} warning={resources?.media.state==='attention'} value={!resources?uiText("未读取"):resources.media.state==='unknown'?uiText("待确认"):resources.media.state==='offline'?uiText("不可用"):resources.systemDisk&&resources.media.sameVolume?uiText("与系统盘同卷，共用上述空间"):`${bytes(resources.media.availableBytes)} / ${bytes(resources.media.totalBytes)}`}/>
          </dl>
          <dl className="status-drawer-facts"><div><dt>{uiText("系统盘来源（用户数据卷）")}</dt><dd>{resources?.systemDisk?.sourcePath??uiText("来源待确认")}</dd></div><div><dt>{uiText("素材目录")}</dt><dd>{resources?.media.sourcePath??uiText("来源待确认")}</dd></div>{resources?.media.mountPath&&<div><dt>{uiText("素材盘挂载点")}</dt><dd>{resources.media.mountPath}</dd></div>}</dl>
          {resources?.media.state==='offline'&&<p className="status-drawer-problem">{uiText("检查素材盘挂载及媒体目录读写权限。")}</p>}
          {resources?.media.state==='attention'&&<p className="status-drawer-problem">{uiText("素材盘可用空间低于运行要求（")}{bytes(resources.media.minimumFreeBytes)}）。</p>}
        </Section>
        <Section title={uiText("日常维护")} summary={uiText(stateLabel(maintenanceState))}>
          {!maintenanceAvailable?<p className="status-drawer-empty">{uiText("维护状态暂不可用，请刷新重试。")}</p>:maintenance.map(item=><details className="status-drawer-maintenance" key={item.id}><summary><span>{item.label}</span><span className={item.state==='attention'||item.state==='offline'?'status-drawer-warning':''}>{item.stateText??uiText(stateLabel(item.state))}</span><ChevronDown size={14}/></summary>{item.checks?<HealthChecks checks={item.checks}/>:item.detail&&<p>{item.detail}</p>}{item.id==='health'&&!item.checks&&item.detailRows?.some(row=>row.label===uiText("最近结果"))&&<p>{uiText("此记录未保存分项结果。")}</p>}{!!item.detailRows?.length&&<dl className="status-drawer-facts">{item.detailRows.map((row,index)=><div key={index}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}</dl>}{item.lastFailureChecks&&<details className="status-drawer-check-history"><summary>{uiText("最近失败分项")}</summary><HealthChecks checks={item.lastFailureChecks}/></details>}</details>)}
        </Section>
      </div>
      <footer className="status-drawer-footer"><span>{uiText("最近读取 ")}{date(observedAt)}</span><Button size="sm" color="secondary" isDisabled={pending} onClick={onRefresh}>{pending?uiText("读取中…"):uiText("刷新系统状态")}</Button></footer>
    </section></div>,document.body)}
  </div>;
}
