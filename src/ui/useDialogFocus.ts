import { useEffect, useRef, type RefObject } from "react";

const focusableSelector = "button:not([disabled]), summary, [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";

export function useDialogFocus<T extends HTMLElement = HTMLDivElement>(isOpen: boolean, onClose: () => void, returnFocusRef?: RefObject<HTMLElement | null>) {
  const dialogRef = useRef<T>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!isOpen) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusableElements = () => Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(focusableSelector) ?? []).filter((element) => {
      if (element.closest('[hidden], [inert], [data-inert="true"]')) return false;
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
    const initial = focusableElements()[0];
    if (initial) initial.focus();
    else focusContainer();

    function manageDialogFocus(event: KeyboardEvent) {
      if (event.defaultPrevented) return;
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
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    window.addEventListener("keydown", manageDialogFocus);
    return () => {
      window.removeEventListener("keydown", manageDialogFocus);
      const returnTarget = returnFocusRef?.current ?? previousFocus;
      if (returnTarget?.isConnected) returnTarget.focus();
    };
  }, [isOpen, returnFocusRef]);

  return dialogRef;
}
