import {useId, useRef, useState, type KeyboardEvent} from 'react';
import {useDialogFocus} from '../ui/useDialogFocus';
import {LocalConnectionsPanel} from './LocalConnectionsPanel';
import {LocalDeletionRecovery} from './LocalDeliveryPanel';
import {LocalHistory} from './LocalHistory';

const tabs = [{id:'connections', label:'连接管理'}, {id:'history', label:'历史资料'}] as const;
type Tab = typeof tabs[number]['id'];

export function LocalMaintenancePanel({onClose, revision}: {onClose: () => void; revision: unknown}) {
  const [active, setActive] = useState<Tab>('connections');
  const [historyVisited, setHistoryVisited] = useState(false);
  const id = useId();
  const tabButtons = useRef<Array<HTMLButtonElement | null>>([]);
  const dialogRef = useDialogFocus(true, onClose);
  function select(tab: Tab) {setActive(tab); if (tab === 'history') setHistoryVisited(true);}
  function navigate(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const next = event.key === 'ArrowRight' ? (index+1)%tabs.length : event.key === 'ArrowLeft' ? (index+tabs.length-1)%tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length-1 : null;
    if (next === null) return;
    event.preventDefault(); select(tabs[next].id); tabButtons.current[next]?.focus();
  }
  return <div className="modal-backdrop" role="presentation">
    <section aria-labelledby={id+'-title'} aria-modal="true" className="modal-card maintenance-modal" ref={dialogRef} role="dialog">
      <header><h2 id={id+'-title'}>系统维护</h2><button aria-label="关闭系统维护" className="icon-button" onClick={onClose} type="button">×</button></header>
      <div aria-label="系统维护分区" className="account-tabs maintenance-tabs" role="tablist">
        {tabs.map((tab,index) => <button aria-controls={id+'-'+tab.id+'-panel'} aria-selected={active===tab.id} className={`account-tab${active===tab.id?' is-active':''}`} id={id+'-'+tab.id+'-tab'} key={tab.id} onClick={()=>select(tab.id)} onKeyDown={event=>navigate(event,index)} ref={element=>{tabButtons.current[index]=element;}} role="tab" tabIndex={active===tab.id?0:-1} type="button">{tab.label}</button>)}
      </div>
      <div aria-labelledby={id+'-connections-tab'} className="maintenance-panel-content" hidden={active!=='connections'} id={id+'-connections-panel'} role="tabpanel" tabIndex={0}>
        <LocalConnectionsPanel/>
        <LocalDeletionRecovery revision={revision}/>
      </div>
      <div aria-labelledby={id+'-history-tab'} className="maintenance-panel-content" hidden={active!=='history'} id={id+'-history-panel'} role="tabpanel" tabIndex={0}>
        {historyVisited&&<LocalHistory/>}
      </div>
    </section>
  </div>;
}
