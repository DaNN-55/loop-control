import { useEffect, useRef, type RefObject } from "react";

const focusableSelector = "button, summary, [href], input, select, textarea, [tabindex]";

const activeDialogs: HTMLElement[] = [];

export function useDialogFocus<T extends HTMLElement = HTMLDivElement>(isOpen: boolean, onClose: () => void, returnFocusRef?: RefObject<HTMLElement | null>) {
  const dialogRef = useRef<T>(null);
  // Capture before React commits autoFocus fields; an effect sees the field instead of its opener.
  const opening = useRef<{ open: boolean; trigger: HTMLElement | null }>({ open: false, trigger: null });
  if (isOpen && !opening.current.open) {
    opening.current.trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }
  opening.current.open = isOpen;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!isOpen) return;
    const previousFocus = opening.current.trigger;
    const dialog = dialogRef.current;
    if (!dialog) return;
    // Child effects may mount before their parent. Keep descendants above their parents.
    const descendant = activeDialogs.findIndex((active) => dialog.contains(active));
    if (descendant < 0) activeDialogs.push(dialog);
    else activeDialogs.splice(descendant, 0, dialog);
    const focusableElements = () => Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(focusableSelector) ?? []).filter((element) => {
      if (element.matches(':disabled, [type="hidden"], [aria-disabled="true"], [tabindex="-1"]') ||
          element.closest('[hidden], [inert], [data-inert="true"], [aria-hidden="true"]')) return false;
      for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
        if (ancestor.tagName !== "DETAILS" || ancestor.hasAttribute("open")) continue;
        const summary = Array.from(ancestor.children).find((child) => child.tagName === "SUMMARY");
        if (!summary?.contains(element)) return false;
      }
      return true;
    });
    const focusContainer = () => {
      if (!dialogRef.current) return;
      if (!dialogRef.current.hasAttribute("tabindex")) dialogRef.current.tabIndex = -1;
      dialogRef.current.focus();
    };
    const elements = focusableElements();
    const initial = elements.find((element) => element.hasAttribute("data-dialog-initial-focus"))
      ?? elements.find((element) => element.matches('input:not([type="hidden"]), textarea, select, [role="combobox"]'))
      ?? elements[0];
    if (initial) initial.focus();
    else focusContainer();

    function manageDialogFocus(event: KeyboardEvent) {
      if (event.defaultPrevented || activeDialogs.at(-1) !== dialog) return;
      const activeDialog = document.activeElement instanceof Element ? document.activeElement.closest('[role="dialog"]') : null;
      if (activeDialog && dialogRef.current && activeDialog !== dialogRef.current && !activeDialog.contains(dialogRef.current)) return;
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const elements = focusableElements();
      if (!elements.length) {
        event.preventDefault();
        focusContainer();
        return;
      }
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (!dialogRef.current?.contains(document.activeElement) || (event.shiftKey && document.activeElement === first)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    window.addEventListener("keydown", manageDialogFocus);
    return () => {
      window.removeEventListener("keydown", manageDialogFocus);
      const index = activeDialogs.indexOf(dialog);
      if (index >= 0) activeDialogs.splice(index, 1);
      const returnTarget = [returnFocusRef?.current, previousFocus].find((target) => target?.isConnected && !target.matches(':disabled, [aria-disabled="true"]') && !target.closest('[hidden], [inert], [aria-hidden="true"]') && target !== document.body);
      const remainingDialog = activeDialogs.at(-1);
      const active = document.activeElement;
      if (!remainingDialog && active instanceof HTMLElement && active !== document.body && !dialog.contains(active) &&
          !active.closest('[hidden], [inert], [aria-hidden="true"]')) return;
      if (returnTarget && (!remainingDialog || remainingDialog.contains(returnTarget))) {
        returnTarget.focus();
        return;
      }
      const fallback = remainingDialog ?? document.querySelector<HTMLElement>('[data-dialog-focus-fallback], main, [role="main"], #main-content:not([inert])');
      if (fallback) {
        if (!fallback.hasAttribute("tabindex")) fallback.tabIndex = -1;
        fallback.focus();
      }
    };
  }, [isOpen, returnFocusRef]);

  return dialogRef;
}
