import {Button} from './dan-ui/components/base/buttons/button';
import type { ReactNode } from "react";
import { useDialogFocus } from "./useDialogFocus";
import {SurfacePresence,useSurfacePresence} from './SurfacePresence';

export function ConfirmationModalPresence({children}:{children:ReactNode}){return <SurfacePresence kind="confirmation">{children}</SurfacePresence>;}

export function ConfirmationModal({ children, cancelLabel = "取消", confirmDisabled = false, confirmLabel, isPending = false, onCancel, onConfirm, pendingLabel = "处理中…", title, tone = "default" }: { children: ReactNode; cancelLabel?: string; confirmDisabled?: boolean; confirmLabel: string; isPending?: boolean; onCancel: () => void; onConfirm: () => void | Promise<void>; pendingLabel?: string; title: string; tone?: "default" | "danger" }) {
  const presence=useSurfacePresence(),present=presence?.present??true;
  const dialogRef = useDialogFocus<HTMLDivElement>(present, () => {if (!isPending) onCancel();});
  return <div ref={presence?.ref} className="modal-backdrop" inert={!present} aria-hidden={!present||undefined} style={!present?{pointerEvents:'none'}:undefined}><div aria-label={title} aria-modal="true" className={`modal-card confirmation-modal${tone === "danger" ? " modal-card-danger" : ""}`} ref={dialogRef} role="dialog"><header><div><h2>{title}</h2></div></header><div className="confirmation-modal-content">{children}</div><div className="modal-actions"><Button size="sm" color="secondary" data-dialog-initial-focus className="button button-secondary" isDisabled={isPending} onClick={onCancel} type="button">{cancelLabel}</Button><Button size="sm" color={tone === "danger" ? "primary-destructive" : "primary"} className={`button ${tone === "danger" ? "button-danger" : "button-primary"}`} isDisabled={confirmDisabled || isPending} onClick={() => void onConfirm()} type="button">{isPending ? pendingLabel : confirmLabel}</Button></div></div></div>;
}
