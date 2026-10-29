"use client";

import type { ReactNode, Ref } from "react";
import { HelpCircle } from "@untitledui/icons";
import type { LabelProps as AriaLabelProps } from "react-aria-components";
import { Label as AriaLabel } from "react-aria-components";
import { Tooltip, TooltipTrigger } from "../tooltip/tooltip";
import { cx } from "../../../utils/cx";

interface LabelProps extends AriaLabelProps {
  /** The label text, rendered before the required asterisk and the tooltip trigger. */
  children: ReactNode;
  /** Whether the required asterisk is tinted with the error color. When left undefined, it follows the invalid state of the surrounding field instead. */
  isInvalid?: boolean;
  /** Whether the required asterisk is shown. When left undefined, it appears only if the surrounding field is marked required. */
  isRequired?: boolean;
  /** Title text for a help tooltip. Setting it renders a help icon after the label that stays interactive even when the field is disabled. */
  tooltip?: string;
  /** Supporting text shown under the tooltip title. Only rendered when `tooltip` is set. */
  tooltipDescription?: string;
  /** Ref to the underlying label element. */
  ref?: Ref<HTMLLabelElement>;
}

export const Label = ({
  isInvalid,
  isRequired,
  tooltip,
  tooltipDescription,
  className,
  ...props
}: LabelProps) => {
  const label = (
    <AriaLabel
      data-label="true"
      {...props}
      className={cx(
        "flex cursor-default items-center gap-0.5 text-sm font-medium text-secondary",
        className,
      )}
    >
      {props.children}
      <span
        aria-hidden="true"
        className={cx(
          "hidden text-brand-tertiary",
          isRequired && "block",
          typeof isRequired === "undefined" && "group-required:block",
          isInvalid && "text-error-primary",
          typeof isInvalid === "undefined" &&
            "group-invalid:text-error-primary",
        )}
      >
        *
      </span>
    </AriaLabel>
  );
  if (!tooltip) return label;
  return (
    <div data-label="true" className="flex items-center gap-1">
      {label}
      <Tooltip title={tooltip} description={tooltipDescription} placement="top">
        <TooltipTrigger
          isDisabled={false}
          aria-label={
            typeof props.children === "string"
              ? `${props.children}帮助`
              : "字段帮助"
          }
          className="cursor-pointer text-fg-quaternary transition duration-200 hover:text-fg-quaternary_hover focus:text-fg-quaternary_hover"
        >
          <HelpCircle aria-hidden="true" className="size-4" />
        </TooltipTrigger>
      </Tooltip>
    </div>
  );
};

Label.displayName = "Label";
