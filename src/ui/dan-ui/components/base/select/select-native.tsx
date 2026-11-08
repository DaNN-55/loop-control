"use client";

import { type FC, type KeyboardEvent, type SelectHTMLAttributes, useEffect, useId, useRef, useState } from "react";
import { Header, ListBox, ListBoxItem, ListBoxSection, Popover } from "react-aria-components";
import { ArrowUpRight, Check, Settings, SlidersHorizontal } from "lucide-react";
import "./select-menu.css";
import { ChevronDown } from "@untitledui/icons";
import { HintText } from "../input/hint-text";
import { Label } from "../input/label";
import { cx } from "../../../utils/cx";

interface NativeSelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "size"> {
    /** Context icon inside the control and options. Pass null to omit it. */
    icon?: FC<{ className?: string; "aria-hidden"?: boolean | "true" | "false" }> | null;
    /** Text rendered in a label above the select and linked to it by a generated id. */
    label?: string;
    /** Helper text rendered below the select and referenced by its `aria-describedby`. */
    hint?: string;
    /** Additional classes merged onto the native select element. Use `className` to style the wrapper around it instead. */
    selectClassName?: string;
    /** Controls the select's padding, text size, and the size of the chevron. Ignored when the select sits inside an `InputGroup`, which imposes its own sizing. */
    size?: "sm" | "md" | "lg";
    /** Optional action shown below the listbox. */
    popupAction?: { label: string; onPress: () => void; kind?: "navigation" };
    /** The options to render. Each entry becomes an `option` element showing `label` and submitting `value`. */
    options?: { label: string; value: string; disabled?: boolean }[];
}

const styles = {
    sm: {
        root: "py-2 pl-3 text-sm",
        icon: "size-4 right-2.5 stroke-[2.25px]",
    },
    md: {
        root: "py-2 pl-3 text-md",
        icon: "size-4 stroke-[2.25px] right-3",
    },
    lg: {
        root: "py-2.5 px-3.5 text-md",
        icon: "size-5 right-3",
    },
};

type MenuOption = { id: string; value: string; label: string; disabled: boolean; selected: boolean };
type MenuGroup = { id: string; label?: string; options: MenuOption[] };
type MenuSnapshot = { groups: MenuGroup[]; label: string };

export const NativeSelect = ({ icon: Icon = SlidersHorizontal, label, hint, options, popupAction, children, className, selectClassName, size = "md", id: providedId, ...props }: NativeSelectProps) => {
    const id = useId();
    const selectId = providedId ?? `select-native-${id}`;
    const labelId = `${selectId}-label`;
    const hintId = `select-native-hint-${id}`;
    const listId = `${selectId}-options`;
    const popupActionRef = useRef<HTMLButtonElement>(null);
    const selectRef = useRef<HTMLSelectElement>(null);
    const focusAfterClose = useRef<HTMLElement | null>(null);
    const [menu, setMenu] = useState<MenuSnapshot | null>(null);
    const [open, setOpen] = useState(false);

    function openMenu() {
        const select = selectRef.current;
        if (!select || select.matches(":disabled")) return;
        const groups: MenuGroup[] = [];
        let previousParent: Element | null = null;
        Array.from(select.options).forEach(option => {
            const parent = option.parentElement;
            const group = parent?.tagName === "OPTGROUP" ? parent as HTMLOptGroupElement : null;
            if (parent !== previousParent || !groups.length) {
                groups.push({ id: `group-${option.index}`, label: group?.label, options: [] });
                previousParent = parent;
            }
            groups[groups.length - 1].options.push({ id: String(option.index), value: option.value, label: option.label, disabled: option.disabled || Boolean(group?.disabled), selected: option.selected });
        });
        const caption = select.labels?.[0]?.cloneNode(true) as HTMLElement | undefined;
        caption?.querySelectorAll("select,.dan-select-field,.help-tip,input,button,textarea,[role=button],small,.field-hint").forEach(element => element.remove());
        setMenu({ groups, label: props["aria-label"] || label || caption?.textContent?.trim() || "选项" });
        setOpen(true);
    }

    function closeMenu(restoreFocus = true) {
        setOpen(false);
        focusAfterClose.current = restoreFocus ? selectRef.current : null;
    }

    // Keep the actual select as the form and change-event boundary. Its native popup is
    // replaced, rather than exposing a second hidden select or synthesizing an event object.
    function choose(keys: Set<string | number> | "all") {
        const select = selectRef.current;
        if (!select || select.matches(":disabled")) return;
        const selectedKeys = keys === "all" ? new Set(menu?.groups.flatMap(group => group.options).filter(option => !option.disabled).map(option => option.id)) : keys;
        for (const key of selectedKeys) {
            const expected = menu?.groups.flatMap(group => group.options).find(option => option.id === String(key));
            const current = select.options[Number(key)];
            if (!expected || !current || current.value !== expected.value || current.disabled || (current.parentElement instanceof HTMLOptGroupElement && current.parentElement.disabled)) {
                openMenu();
                return;
            }
        }
        if (props.multiple) {
            const currentKeys = new Set(Array.from(select.selectedOptions).map(option => String(option.index)));
            if (currentKeys.size === selectedKeys.size && [...selectedKeys].every(key => currentKeys.has(String(key)))) {
                closeMenu();
                return;
            }
            for (const option of select.options) option.selected = selectedKeys.has(String(option.index));
        } else {
            const key = selectedKeys.values().next().value;
            if (key === undefined) return;
            if (select.options[Number(key)].value === select.value) {
                closeMenu();
                return;
            }
            select.selectedIndex = Number(key);
        }
        select.dispatchEvent(new Event("change", { bubbles: true }));
        if (!props.multiple) closeMenu();
        else openMenu();
    }

    function leaveMenu(event: KeyboardEvent<HTMLDivElement>) {
        if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            closeMenu();
            return;
        }
        if (event.key === "Enter" || event.key === " ") {
            const item = (event.target as Element).closest('[role="option"]');
            const key = item?.getAttribute("data-key");
            if (key && item?.getAttribute("aria-disabled") !== "true") {
                event.preventDefault();
                event.stopPropagation();
                if (props.multiple) {
                    const keys = new Set(menu?.groups.flatMap(group => group.options).filter(option => option.selected).map(option => option.id));
                    if (keys.has(key)) keys.delete(key); else keys.add(key);
                    choose(keys);
                } else choose(new Set([key]));
            }
            return;
        }
        if (event.key !== "Tab") return;
        const select = selectRef.current;
        if (!select) return;
        event.preventDefault();
        event.stopPropagation();
        const action = popupActionRef.current;
        if (action && !event.shiftKey && event.target !== action) {
            action.focus();
            return;
        }
        if (action && event.shiftKey && event.target === action) {
            const option = event.currentTarget.querySelector<HTMLElement>('[role="option"][aria-selected="true"]:not([aria-disabled="true"])')
                ?? event.currentTarget.querySelector<HTMLElement>('[role="option"]:not([aria-disabled="true"])');
            if (option) {
                option.focus();
                return;
            }
        }
        const scope = select.closest('[role="dialog"]') ?? document;
        const candidates = Array.from(scope.querySelectorAll<HTMLElement>('button:not([disabled]),summary,a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')).filter(element => {
            if (element.closest('[hidden],[inert],[data-inert="true"],[data-select-popup]')) return false;
            for (let parent: HTMLElement | null = element; parent; parent = parent.parentElement) {
                if (getComputedStyle(parent).display === "none") return false;
                if (parent.tagName === "DETAILS" && !parent.hasAttribute("open") && !parent.querySelector(":scope > summary")?.contains(element)) return false;
            }
            return true;
        });
        const index = candidates.indexOf(select);
        const next = candidates[index + (event.shiftKey ? -1 : 1)] ?? (scope === document ? select : event.shiftKey ? candidates.at(-1) : candidates[0]);
        closeMenu(false);
        focusAfterClose.current = next ?? null;
    }

    useEffect(() => {
        if (!open) return;
        if (selectRef.current?.matches(":disabled")) closeMenu(false);
        else openMenu();
    }, [open, children, options, props.value, props.disabled]);

    useEffect(() => {
        if (open || !focusAfterClose.current) return;
        const target = focusAfterClose.current;
        focusAfterClose.current = null;
        const frame = requestAnimationFrame(() => { if (target.isConnected) target.focus(); });
        return () => cancelAnimationFrame(frame);
    }, [open]);

    useEffect(() => {
        const form = selectRef.current?.form;
        if (!form) return;
        const closeOnReset = () => setOpen(false);
        form.addEventListener("reset", closeOnReset);
        return () => form.removeEventListener("reset", closeOnReset);
    }, [props.form]);

    const menuOptions = menu?.groups.flatMap(group => group.options) ?? [];
    const renderOption = (option: MenuOption) => <ListBoxItem id={option.id} key={option.id} textValue={option.label || "空选项"} onAction={() => { if (!props.multiple) closeMenu(); }} className="dan-select-option">{Icon && <Icon aria-hidden="true" className="dan-select-option-icon"/>}<span>{option.label}</span><Check aria-hidden="true" className="dan-select-option-check"/></ListBoxItem>;

    return (
        <div className={cx("w-full in-data-input-wrapper:w-max dan-select-field", className)} data-select-size={size}>
            {label && (
                <Label htmlFor={selectId} id={labelId} className="mb-1.5">
                    {label}
                </Label>
            )}

            <div className="relative grid w-full items-center dan-select-control">
                {Icon && <Icon aria-hidden="true" className="dan-select-leading"/>}
                <select
                    {...props}
                    ref={selectRef}
                    id={selectId}
                    aria-expanded={open}
                    aria-controls={open ? listId : undefined}
                    aria-haspopup="listbox"
                    onMouseDown={event => {
                        props.onMouseDown?.(event);
                        if (event.defaultPrevented || event.button !== 0) return;
                        event.preventDefault();
                        event.currentTarget.focus();
                        if (open) closeMenu(); else openMenu();
                    }}
                    onKeyDown={event => {
                        props.onKeyDown?.(event);
                        if (event.defaultPrevented) return;
                        if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
                            event.preventDefault();
                            openMenu();
                        } else if (event.key === "Escape" && open) {
                            event.preventDefault();
                            event.stopPropagation();
                            closeMenu();
                        }
                    }}
                    onChange={event => { props.onChange?.(event); if (!props.multiple) setOpen(false); }}
                    aria-describedby={[props["aria-describedby"], hint ? hintId : undefined].filter(Boolean).join(" ") || undefined}
                    aria-labelledby={label ? labelId : props["aria-labelledby"]}
                    className={cx(
                        "dan-select-trigger appearance-none rounded-lg bg-primary font-medium text-primary shadow-xs ring-1 ring-primary outline-hidden transition duration-100 ease-linear ring-inset placeholder:text-fg-quaternary focus-visible:ring-2 focus-visible:ring-brand disabled:cursor-not-allowed disabled:opacity-50",

                        styles[size].root,

                        // Styles when the select is within an `InputGroup`
                        "in-data-input-wrapper:flex in-data-input-wrapper:h-full in-data-input-wrapper:gap-1 in-data-input-wrapper:bg-inherit in-data-input-wrapper:px-3 in-data-input-wrapper:py-2 in-data-input-wrapper:font-normal in-data-input-wrapper:text-tertiary in-data-input-wrapper:shadow-none in-data-input-wrapper:ring-transparent in-data-input-wrapper:in-data-[size=sm]:text-sm",
                        // Styles for the select when `TextField` is disabled
                        "in-data-input-wrapper:group-disabled:pointer-events-none in-data-input-wrapper:group-disabled:cursor-not-allowed in-data-input-wrapper:group-disabled:bg-transparent",
                        // Common styles for sizes and border radius within `InputGroup`
                        "in-data-input-wrapper:in-data-leading:rounded-r-none in-data-input-wrapper:in-data-trailing:rounded-l-none in-data-input-wrapper:in-data-[input-size=lg]:py-2.5 in-data-input-wrapper:in-data-[input-size=md]:py-2 in-data-input-wrapper:in-data-[input-size=md]:pl-3 in-data-input-wrapper:in-data-[input-size=sm]:text-sm",
                        // For "leading" dropdown within `InputGroup`
                        "in-data-input-wrapper:in-data-leading:pr-4.5 in-data-input-wrapper:in-data-leading:in-data-[input-size=lg]:pl-3.5 in-data-input-wrapper:in-data-leading:in-data-[input-size=md]:pr-4.5 in-data-input-wrapper:in-data-leading:in-data-[input-size=md]:pl-3 in-data-input-wrapper:in-data-leading:in-data-[input-size=sm]:pr-3.5",
                        // For "trailing" dropdown within `InputGroup`
                        "in-data-input-wrapper:in-data-trailing:in-data-[input-size=lg]:pr-8 in-data-input-wrapper:in-data-trailing:in-data-[input-size=md]:pr-7.5 in-data-input-wrapper:in-data-trailing:in-data-[input-size=sm]:pr-6.5",
                        selectClassName,
                    )}
                >
                    {options ? options.map((opt) => (
                        <option key={opt.value} value={opt.value} disabled={opt.disabled}>
                            {opt.label}
                        </option>
                    )) : children}
                </select>

                <ChevronDown
                    aria-hidden="true"
                    className={cx(
                        "pointer-events-none absolute text-fg-quaternary dan-select-caret",

                        styles[size].icon,
                        // Styles for the icon when the select is within an `InputGroup`
                        "in-data-input-wrapper:right-0 in-data-input-wrapper:size-4 in-data-input-wrapper:stroke-[2.625px]",
                        // For "trailing" dropdown within `InputGroup`
                        "in-data-input-wrapper:in-data-trailing:in-data-[input-size=md]:right-3 in-data-input-wrapper:in-data-trailing:in-data-[input-size=sm]:right-3",
                    )}
                />
            </div>

            <Popover isOpen={open} onOpenChange={next => { if (next) setOpen(true); else closeMenu(); }} triggerRef={selectRef} placement="bottom start" offset={6} containerPadding={12} className="dan-ui product-ui dan-select-popover" aria-label={menu ? `${menu.label}选项` : "选项"} data-select-popup="true"><div onKeyDownCapture={leaveMenu} onClickCapture={event => {
                if (props.multiple) return;
                const item = (event.target as Element).closest('[role="option"]');
                const key = item?.getAttribute("data-key");
                const select = selectRef.current;
                if (key && select && select.options[Number(key)]?.value === select.value) {
                    event.preventDefault();
                    event.stopPropagation();
                    choose(new Set([key]));
                }
            }}>
                <ListBox id={listId} aria-label={menu?.label || "选项"} selectionMode={props.multiple ? "multiple" : "single"} selectedKeys={new Set(menuOptions.filter(option => option.selected).map(option => option.id))} disabledKeys={menuOptions.filter(option => option.disabled).map(option => option.id)} onSelectionChange={choose} autoFocus="first" className="dan-select-listbox">
                    {menu?.groups.map(group => group.label ? <ListBoxSection id={group.id} key={group.id}><Header className="dan-select-group-label">{group.label}</Header>{group.options.map(renderOption)}</ListBoxSection> : group.options.map(renderOption))}
                </ListBox>
                {popupAction && <div className="dan-select-action-footer">
                    <button ref={popupActionRef} className="dan-select-popup-action" type="button" aria-haspopup={popupAction.kind === "navigation" ? undefined : "dialog"} onClick={() => {
                        closeMenu(false);
                        popupAction.onPress();
                    }}>
                        {popupAction.kind === "navigation"
                            ? <ArrowUpRight aria-hidden="true" className="dan-select-option-icon"/>
                            : <Settings aria-hidden="true" className="dan-select-option-icon"/>}
                        {popupAction.label}
                    </button>
                </div>}
            </div>
            </Popover>

            {hint && (
                <HintText className="mt-2" id={hintId}>
                    {hint}
                </HintText>
            )}
        </div>
    );
};
