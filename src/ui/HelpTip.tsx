import {uiText} from '../i18n/ui';
import {useState, type ReactNode} from "react";
import { Info } from "lucide-react";
import {Tooltip} from './dan-ui/components/base/tooltip/tooltip';
import {Focusable} from 'react-aria-components';

export function HelpTip({ label, children }: { label: string; children: ReactNode }) {
  const [open,setOpen] = useState(false);
  return <Tooltip title={children} placement="top" isOpen={open} onOpenChange={setOpen} className="dan-ui dan-ui-tooltip"><Focusable><span aria-label={uiText("{value0}说明",{value0:String(label)})} className="help-tip" role="button" tabIndex={0} onClick={()=>setOpen(true)} onKeyDown={event=>{if(event.key==='Enter'||event.key===' ')event.preventDefault();}} onKeyUp={event=>{if(event.key==='Enter'||event.key===' ')setOpen(true);}}>
    <Info aria-hidden="true" className="help-tip-icon" strokeWidth={1.8} />
  </span></Focusable></Tooltip>;
}
