import {uiText} from '../i18n/ui';
import {useCallback,useState,type RefObject} from 'react';
import type {ConnectionSettingsHeader} from './CompactConnectionWorkspace';
import {ArrowLeft,X} from 'lucide-react';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import {useDialogFocus} from '../ui/useDialogFocus';
import {LocalConnectionsPanel} from './LocalConnectionsPanel';

export function ConnectionsSettingsDialog({onClose, returnFocusRef,embedded=false,onStateChange,onOpenSecrets,initialConnectionId}: {onClose: () => void; returnFocusRef: RefObject<HTMLElement | null>;embedded?:boolean;onStateChange?:(state:{busy:boolean;dirty:boolean})=>void;onOpenSecrets?:(connectionId:string,connectionName?:string)=>void;initialConnectionId?:string}) {
  const [heading,setHeading]=useState<ConnectionSettingsHeader>({title:uiText('连接配置')}),[busy,setBusy]=useState(false);
  const stateChange=useCallback((state:{busy:boolean;dirty:boolean})=>{setBusy(state.busy);onStateChange?.(state);},[onStateChange]);
  const ref = useDialogFocus<HTMLElement>(!embedded, onClose, returnFocusRef);
  const content=<section ref={ref} role={embedded?undefined:'dialog'} aria-modal={embedded?undefined:true} aria-labelledby="connections-settings-title" className={`modal-card connections-settings-dialog${embedded?' owner-settings-pane':''}`}>
      <header>
        <div className="compact-connection-header-title">{heading.back&&<Button size="sm" color="tertiary" iconLeading={ArrowLeft} aria-label={heading.backLabel??uiText("返回连接列表")} isDisabled={busy} onPress={heading.back}/>}<h2 id="connections-settings-title" title={heading.title}>{heading.title}</h2></div>
        <Button size="sm" color="tertiary" aria-label={uiText("关闭连接配置")} iconLeading={X} isDisabled={busy} data-dialog-initial-focus onPress={onClose}/>
      </header>
      <LocalConnectionsPanel inlineBilling settingsLayout inlineEditor={embedded} onHeaderChange={setHeading} onStateChange={stateChange} onOpenSecrets={onOpenSecrets} initialConnectionId={initialConnectionId}/>
    </section>;
  return embedded?content:<div className="modal-backdrop" role="presentation">{content}</div>;
}
