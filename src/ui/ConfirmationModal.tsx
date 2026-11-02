import {Button} from './dan-ui/components/base/buttons/button';
import type { ReactNode } from "react";
import { useDialogFocus } from "./useDialogFocus";

export function ConfirmationModal({ children, confirmDisabled = false, confirmLabel, isPending = false, onCancel, onConfirm, pendingLabel = "处理中…", title, tone = "default" }: { children: ReactNode; confirmDisabled?: boolean; confirmLabel: string; isPending?: boolean; onCancel: () => void; onConfirm: () => void | Promise<void>; pendingLabel?: string; title: string; tone?: "default" | "danger" }) {
  const dialogRef = useDialogFocus<HTMLDivElement>(true, () => {if (!isPending) onCancel();});
  return <div className="modal-backdrop"><div aria-label={title} aria-modal="true" className={`modal-card confirmation-modal${tone === "danger" ? " modal-card-danger" : ""}`} ref={dialogRef} role="dialog"><header><div><h2>{title}</h2></div></header><div className="confirmation-modal-content">{children}</div><div className="modal-actions"><Button size="sm" color="secondary" data-dialog-initial-focus className="button button-secondary" isDisabled={isPending} onClick={onCancel} type="button">取消</Button><Button size="sm" color={tone === "danger" ? "primary-destructive" : "primary"} className={`button ${tone === "danger" ? "button-danger" : "button-primary"}`} isDisabled={confirmDisabled || isPending} onClick={() => void onConfirm()} type="button">{isPending ? pendingLabel : confirmLabel}</Button></div></div></div>;
}
