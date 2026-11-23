import {uiText} from '../i18n/ui';
import {useEffect, useState, type ReactNode} from "react";
import { Info } from "lucide-react";
import {Tooltip,type TooltipProps} from './dan-ui/components/base/tooltip/tooltip';
import {Focusable} from 'react-aria-components';

export function HelpTip({ label, children, placement = "top", portalContainer }: { label: string; children: ReactNode; placement?: TooltipProps["placement"]; portalContainer?: Element }) {
  const [open,setOpen] = useState(false);
  useEffect(() => {
    if (!open || !(portalContainer instanceof HTMLDialogElement)) return;
    const view = portalContainer.ownerDocument.defaultView;
    const keepDialogOpen = (event: KeyboardEvent) => {
      // React Aria dismisses the tooltip, but native dialogs also handle the key's default action.
      if (event.key === "Escape" && portalContainer.open) event.preventDefault();
    };
    view?.addEventListener("keydown", keepDialogOpen, true);
    return () => view?.removeEventListener("keydown", keepDialogOpen, true);
  }, [open, portalContainer]);
  return <Tooltip title={children} placement={placement} UNSTABLE_portalContainer={portalContainer} isOpen={open} onOpenChange={setOpen} className="dan-ui dan-ui-tooltip"><Focusable><span aria-label={uiText("{value0}说明",{value0:String(label)})} className="help-tip" role="button" tabIndex={0} onClick={()=>setOpen(true)} onKeyDown={event=>{if(event.key==='Enter'||event.key===' ')event.preventDefault();}} onKeyUp={event=>{if(event.key==='Enter'||event.key===' ')setOpen(true);}}>
    <Info aria-hidden="true" className="help-tip-icon" strokeWidth={1.8} />
  </span></Focusable></Tooltip>;
}
