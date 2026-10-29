import {XClose} from '@untitledui/icons';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import {useState, type ReactNode} from 'react';
import {useDialogFocus} from '../ui/useDialogFocus';
import type {HealthCheck} from './healthChecks';
export type SystemState = 'healthy' | 'attention' | 'unknown' | 'offline';
export interface StatusItem {
  id: string;
  label: string;
  state: SystemState;
  stateText?: string;
  detail: string;
  detailRows?: Array<{label: string; value: string; state?: SystemState}>;
  checks?:HealthCheck[];
  lastFailureChecks?:HealthCheck[];
}
export function stateLabel(state: SystemState): string {
  return state === 'healthy' ? '正常' : state === 'attention' ? '需处理' : state === 'offline' ? '不可用' : '待确认';
}

// Both runtime adapters use this surface so layout, focus and status colors stay aligned.
export function SystemStatusSurface({items, overallState, summary, description, onOpen, renderDetails, children, footer, embedded=false, triggerLabel}: {
  items: StatusItem[]; overallState: SystemState; summary: string; description: string;
  onOpen?: () => void; renderDetails?: (item: StatusItem) => ReactNode;
  children?: ReactNode; footer: ReactNode; embedded?: boolean; triggerLabel?: string;
}) {
  const [open, setOpen] = useState(false), [hovering, setHovering] = useState(false);
  const close = () => setOpen(false);
  const dialogRef = useDialogFocus<HTMLElement>(open && !embedded, close);
  if(embedded)return <section className="system-status-workspace" aria-label="系统状态详情">
    <header className="system-page-heading"><div><h2>运行概览</h2><p>{description}</p></div><span className={`system-overall system-status-item-${overallState}`}>{stateLabel(overallState)}</span></header>
    <div className="system-evidence-table" role="table" aria-label="运行状态">
      <div className="system-evidence-head" role="row"><span role="columnheader">检查项目</span><span role="columnheader">状态</span><span role="columnheader">最近证据与计划</span></div>
      {items.map(item=><div className={`system-evidence-row system-status-item-${item.state}`} data-status-id={item.id} key={item.id} role="row"><strong role="cell">{item.label}</strong><span role="cell" className="system-evidence-state">{item.stateText??stateLabel(item.state)}</span><div role="cell"><p>{item.detail}</p>{!!item.detailRows?.length&&<dl className="system-evidence-details">{item.detailRows.map(row=><div key={`${item.id}-${row.label}-${row.value}`}><dt>{row.label}</dt><dd>{row.value}</dd>{row.state&&<span>{stateLabel(row.state)}</span>}</div>)}</dl>}{renderDetails?.(item)}</div></div>)}
    </div>{children}<footer className="system-page-footer">{footer}</footer>
  </section>;
  return <div className="system-status">
    <Button size="sm" color="tertiary" aria-expanded={open} aria-haspopup="dialog" aria-label={`系统状态：${stateLabel(overallState)}`} data-status-summary={summary} className={`system-status-trigger system-status-${overallState}`} onClick={() => {if (!open) onOpen?.(); setOpen(!open);}} onMouseEnter={() => setHovering(true)} onMouseLeave={() => setHovering(false)} onFocus={() => setHovering(true)} onBlur={() => setHovering(false)}  type="button"><i aria-hidden="true"/>{triggerLabel&&<span className="sidebar-tool-label">{triggerLabel}</span>}</Button>
    {hovering && !open && <div aria-hidden="true" className="system-status-hover-card">{items.map(item => <div className="system-status-hover-row" key={item.id}><i className={`system-status-hover-dot system-status-hover-dot-${item.state}`}/><strong>{item.label}</strong><span>{item.stateText ?? stateLabel(item.state)}</span></div>)}</div>}
    {open && <section aria-label="系统状态详情" className="system-status-panel" ref={dialogRef} role="dialog">
      <header><div><h2>系统状态</h2><p>{description}</p></div><Button size="sm" color="tertiary" aria-label="关闭系统状态详情" className="icon-button" onClick={close} type="button"><XClose aria-hidden="true" width={20} height={20}/></Button></header>
      <div className="system-status-list">{items.map(item => <article className={`system-status-item system-status-item-${item.state}`} data-status-id={item.id} key={item.id}>
        <div><strong>{item.label}</strong><span>{item.stateText ?? stateLabel(item.state)}</span></div>
        {item.detail && <p>{item.detail}</p>}
        {!!item.detailRows?.length && <dl className="system-status-detail-rows">{item.detailRows.map(row => <div key={`${item.id}-${row.label}-${row.value}`}><dt>{row.label}</dt><dd>{row.value}</dd>{row.state && <span>{stateLabel(row.state)}</span>}</div>)}</dl>}
        {renderDetails?.(item)}
      </article>)}</div>
      {children}<footer>{footer}</footer>
    </section>}
  </div>;
}
