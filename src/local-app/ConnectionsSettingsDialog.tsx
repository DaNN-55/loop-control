import type {RefObject} from 'react';
import {X} from 'lucide-react';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import {useDialogFocus} from '../ui/useDialogFocus';
import {LocalConnectionsPanel} from './LocalConnectionsPanel';

export function ConnectionsSettingsDialog({onClose, returnFocusRef,embedded=false,onStateChange,onOpenSecrets,initialConnectionId}: {onClose: () => void; returnFocusRef: RefObject<HTMLElement | null>;embedded?:boolean;onStateChange?:(state:{busy:boolean;dirty:boolean})=>void;onOpenSecrets?:(connectionId:string,connectionName?:string)=>void;initialConnectionId?:string}) {
  const ref = useDialogFocus<HTMLElement>(!embedded, onClose, returnFocusRef);
  const content=<section ref={ref} role={embedded?undefined:'dialog'} aria-modal={embedded?undefined:true} aria-labelledby="connections-settings-title" className={`modal-card connections-settings-dialog${embedded?' owner-settings-pane':''}`}>
      <header>
        <h2 id="connections-settings-title">连接配置</h2>
        <Button size="sm" color="tertiary" aria-label="关闭连接配置" iconLeading={X} data-dialog-initial-focus onPress={onClose}/>
      </header>
      <LocalConnectionsPanel inlineBilling settingsLayout inlineEditor={embedded} onStateChange={onStateChange} onOpenSecrets={onOpenSecrets} initialConnectionId={initialConnectionId}/>
    </section>;
  return embedded?content:<div className="modal-backdrop" role="presentation">{content}</div>;
}
