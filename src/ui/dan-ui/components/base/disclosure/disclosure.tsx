"use client";

import type { DetailsHTMLAttributes, ReactNode } from "react";
import { ChevronRight } from "@untitledui/icons";
import { cx } from "../../../utils/cx";

type DisclosureProps = Omit<DetailsHTMLAttributes<HTMLDetailsElement>, "title"> & {
  label: ReactNode;
  meta?: ReactNode;
};

/** Local composition: native keyboard/toggle semantics with a shared chevron. */
export function Disclosure({ label, meta, children, className, ...props }: DisclosureProps) {
  return (
    <details {...props} className={cx("dan-disclosure", className)}>
      <summary>
        <ChevronRight aria-hidden="true" />
        <span>{label}</span>
        {meta != null && <span className="dan-meta">{meta}</span>}
      </summary>
      <div className="dan-disclosure-content">{children}</div>
    </details>
  );
}
