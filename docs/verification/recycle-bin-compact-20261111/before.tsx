// Before-only synthetic measurement fixture: original settings markup and scoped CSS captured before this refinement.
import {useRef} from 'react';
import {createRoot} from 'react-dom/client';
import {OwnerSettingsDialog} from '../../../src/local-app/OwnerSettingsDialog';
import {Button} from '../../../src/ui/dan-ui/components/base/buttons/button';
import '../../../src/styles.css';
import '../../../src/ui/impeccable/foundation.css';
import '../../../src/ui/impeccable/configuration.css';
import '../../../src/ui/impeccable/maintenance.css';
import '../../../src/ui/impeccable/production.css';
import '../../../src/ui/impeccable/scroll-layout.css';
import '../../../src/ui/impeccable/surface-polish.css';
import '../../../src/ui/impeccable/detail-refinement.css';
import '../../../src/ui/impeccable/interaction-refinement.css';
const css='.recycle-bin-body{padding:0 28px 20px;overflow:auto;min-height:0;flex:1}.recycle-bin-settings{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px 28px;padding:18px 0 14px;border-bottom:1px solid var(--lc-line)}.recycle-bin-settings form{display:flex;align-items:center;gap:10px}.recycle-bin-settings label{display:flex;align-items:center;gap:10px;font-size:12px}.recycle-bin-settings label>span{display:flex;align-items:center;gap:6px}.recycle-bin-settings input{width:76px;height:34px;border:1px solid var(--lc-line);border-radius:7px;padding:5px 8px;background:var(--lc-surface);color:var(--lc-text);font:inherit;font-variant-numeric:tabular-nums}.recycle-bin-capacity{display:grid;grid-template-columns:1fr auto;gap:7px 12px;align-items:center;font-size:12px}.recycle-bin-capacity strong{font-size:13px;font-variant-numeric:tabular-nums}.recycle-bin-capacity strong span{font-weight:400;color:var(--lc-muted)}.recycle-bin-capacity meter{grid-column:1/-1;width:100%;height:6px;appearance:none;border:0;border-radius:4px;overflow:hidden;background:var(--lc-surface-2)}.recycle-bin-settings>p,.recycle-bin-settings>details{grid-column:1/-1;margin:0;color:var(--lc-muted);font-size:12px;line-height:1.6}.recycle-bin-settings details p{margin:6px 0 0;max-width:75ch}';
function Before(){const ref=useRef(null);return <div className="dan-ui product-ui"><style>{css}</style><OwnerSettingsDialog page="cleanup" onNavigate={()=>{}} onClose={()=>{}} returnFocusRef={ref} canManageSecrets busy={false} email="synthetic@example.invalid"><section className="modal-card owner-settings-pane"><header><h2>回收站</h2></header><div className="recycle-bin-body"><section className="recycle-bin-settings"><div className="recycle-bin-capacity"><span>回收站容量</span><strong>2.3 GB <span>/ 5 GB</span></strong><meter aria-label="回收站已用容量" value={2.3} min={0} max={5}/></div><form><label>容量上限<span><input type="number" value="5" readOnly/> GB</span></label><Button size="sm" color="secondary" type="submit" isDisabled>保存上限</Button></form><p>超限时从最早的可清理生产单开始，释放到上限以内；刚移入的生产单保留。</p><details><summary>哪些内容不会自动清理？</summary><p>共享、未登记、离线或已变化的文件会保留。单张生产单超过上限时保留，请调高上限或手动永久删除。</p></details></section></div></section></OwnerSettingsDialog></div>};
createRoot(document.getElementById('root')!).render(<Before/>);
