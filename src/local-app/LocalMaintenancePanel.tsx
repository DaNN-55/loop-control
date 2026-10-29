import {useEffect, useState} from 'react';
import {X} from 'lucide-react';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import {Tabs} from '../ui/dan-ui/components/application/tabs/tabs';
import {useDialogFocus} from '../ui/useDialogFocus';
import {LocalConnectionsPanel} from './LocalConnectionsPanel';
import {LocalDeletionRecovery} from './LocalDeliveryPanel';
import {LocalHistory} from './LocalHistory';
const tabs = [{id:'connections', label:'连接管理'}, {id:'history', label:'历史资料'}] as const;
type Tab = typeof tabs[number]['id'];
export function LocalMaintenancePanel({onClose, revision, embedded=false, initialTab='connections', activeTab, onTabChange}: {onClose: () => void; revision: unknown; embedded?: boolean; initialTab?: Tab; activeTab?: Tab; onTabChange?: (tab: Tab) => void}) {
  const [selectedTab, setSelectedTab] = useState<Tab>(initialTab);
  const active = activeTab ?? selectedTab;
  const [historyVisited, setHistoryVisited] = useState(initialTab === 'history' || activeTab === 'history');
  useEffect(()=>{if(active==='history')setHistoryVisited(true);},[active]);
  const dialogRef = useDialogFocus(!embedded, onClose);
  if(embedded)return <section aria-label={active==='connections'?'连接配置内容':'历史资料内容'} className="maintenance-embedded">
    <div className="maintenance-panel-content" hidden={active!=='connections'} inert={active!=='connections'} data-inert={active!=='connections'||undefined}><LocalConnectionsPanel/><LocalDeletionRecovery revision={revision}/></div>
    <div className="maintenance-panel-content" hidden={active!=='history'} inert={active!=='history'} data-inert={active!=='history'||undefined}>{historyVisited&&<LocalHistory/>}</div>
  </section>;
  const contents = <>
      {!embedded&&<header><h2>系统维护</h2><Button size="sm" color="tertiary" aria-label="关闭系统维护" onClick={onClose} iconLeading={X}/></header>}
      <Tabs selectedKey={active} keyboardActivation="automatic" onSelectionChange={key=>{setSelectedTab(key as Tab);onTabChange?.(key as Tab);if(key==='history')setHistoryVisited(true);}}>
        <Tabs.List aria-label="系统维护分区" type="underline" className="account-tabs maintenance-tabs">{tabs.map(tab=><Tabs.Item id={tab.id} key={tab.id}>{tab.label}</Tabs.Item>)}</Tabs.List>
        <Tabs.Panel className="maintenance-panel-content" id="connections" shouldForceMount><LocalConnectionsPanel/><LocalDeletionRecovery revision={revision}/></Tabs.Panel>
        <Tabs.Panel className="maintenance-panel-content" id="history" shouldForceMount>{historyVisited&&<LocalHistory/>}</Tabs.Panel>
      </Tabs>
    </>;
  return <div className="modal-backdrop" role="presentation">
    <section aria-label="系统维护" aria-modal="true" className="modal-card maintenance-modal" ref={dialogRef} role="dialog">
      {contents}
    </section>
  </div>;
}
