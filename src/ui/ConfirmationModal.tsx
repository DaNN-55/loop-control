import type { ReactNode } from "react";
import { useDialogFocus } from "./useDialogFocus";

export function ConfirmationModal({ children, confirmDisabled = false, confirmLabel, isPending = false, onCancel, onConfirm, pendingLabel = "处理中…", title, tone = "default" }: { children: ReactNode; confirmDisabled?: boolean; confirmLabel: string; isPending?: boolean; onCancel: () => void; onConfirm: () => void | Promise<void>; pendingLabel?: string; title: string; tone?: "default" | "danger" }) {
  const dialogRef = useDialogFocus<HTMLDivElement>(true, onCancel);
  return <div className="modal-backdrop"><div aria-label={title} aria-modal="true" className={`modal-card confirmation-modal${tone === "danger" ? " modal-card-danger" : ""}`} ref={dialogRef} role="dialog"><header><div><h2>{title}</h2></div></header><div className="confirmation-modal-content">{children}</div><div className="modal-actions"><button className="button button-secondary" disabled={isPending} onClick={onCancel} type="button">取消</button><button className={`button ${tone === "danger" ? "button-danger" : "button-primary"}`} disabled={confirmDisabled || isPending} onClick={() => void onConfirm()} type="button">{isPending ? pendingLabel : confirmLabel}</button></div></div></div>;
}
