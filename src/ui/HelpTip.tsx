import type { ReactNode } from "react";
import { Info } from "lucide-react";

export function HelpTip({ label, children }: { label: string; children: ReactNode }) {
  return <span aria-label={`${label}说明`} className="help-tip" tabIndex={0}>
    <Info aria-hidden="true" className="help-tip-icon" strokeWidth={1.8} />
    <span className="help-tip-popover" role="tooltip">{children}</span>
  </span>;
}
