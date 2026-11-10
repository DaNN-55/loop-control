import {ArrowLeft,X} from 'lucide-react';
import {useEffect,type ReactNode} from 'react';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
export function EpisodeDetailDrawer({ children, tools,compact = false, inert, isOpen, onClose }: { children: ReactNode;tools?:ReactNode; compact?: boolean; inert?: boolean; isOpen: boolean; onClose: () => void }) {
  useEffect(() => { if (!isOpen) return; function closeOnEscape(event: KeyboardEvent) { if (event.key === "Escape" && !document.querySelector('[role="dialog"][aria-modal="true"]')) onClose(); } window.addEventListener("keydown", closeOnEscape); return () => window.removeEventListener("keydown", closeOnEscape); }, [isOpen, onClose]);
  if (!isOpen) return null;
  return <><div aria-hidden="true" className="episode-detail-scrim" data-testid="episode-detail-scrim" onClick={onClose} /><aside inert={inert} aria-label="当前生产单详情" className={`episode-detail-drawer lc-production-workspace${compact ? " is-input-stage" : ""}`} role="complementary"><div className="lc-production-return"><Button size="sm" color="tertiary" iconLeading={ArrowLeft} onClick={onClose} type="button">返回工作区</Button><span>生产单</span><div className="production-return-tools">{tools}<Button size="sm" color="tertiary" aria-label="关闭生产单详情" className="drawer-close icon-button" onClick={onClose} type="button"><X aria-hidden="true" className="icon" strokeWidth={1.8}/></Button></div></div>{children}</aside></>;
}
