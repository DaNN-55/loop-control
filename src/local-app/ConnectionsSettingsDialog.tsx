import type {RefObject} from 'react';
import {X} from 'lucide-react';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import {useDialogFocus} from '../ui/useDialogFocus';
import {LocalConnectionsPanel} from './LocalConnectionsPanel';

export function ConnectionsSettingsDialog({onClose, returnFocusRef}: {onClose: () => void; returnFocusRef: RefObject<HTMLElement | null>}) {
  const ref = useDialogFocus<HTMLElement>(true, onClose, returnFocusRef);
  return <div className="modal-backdrop" role="presentation">
    <section ref={ref} role="dialog" aria-modal="true" aria-labelledby="connections-settings-title" className="modal-card connections-settings-dialog">
      <header>
        <h2 id="connections-settings-title">连接配置</h2>
        <Button size="sm" color="tertiary" aria-label="关闭连接配置" iconLeading={X} data-dialog-initial-focus onPress={onClose}/>
      </header>
      <LocalConnectionsPanel inlineBilling settingsLayout/>
    </section>
  </div>;
}
