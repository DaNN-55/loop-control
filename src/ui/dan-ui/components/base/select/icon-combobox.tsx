"use client";

import { useContext, useMemo, type ComponentType, type KeyboardEvent } from "react";
import { Check, ChevronDown, Volume2 } from "lucide-react";
import { Button, ComboBox, ComboBoxStateContext, Input, ListBox, ListBoxItem, Popover } from "react-aria-components";
import "./select-menu.css";
import "./icon-combobox.css";

export interface IconComboBoxProps {
    value: string;
    onChange: (value: string) => void;
    options: string[];
    "aria-label": string;
    "aria-describedby"?: string;
    name?: string;
    id?: string;
    placeholder?: string;
    isDisabled?: boolean;
    maxLength?: number;
    icon?: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
}

/** Editable suggestions: a custom voice ID remains valid when it is not in the list. */
export function IconComboBox({ value, onChange, options, icon = Volume2, isDisabled, name, ...inputProps }: IconComboBoxProps) {
    const items = useMemo(() => Array.from(new Set(options)).map(value => ({ id: value })), [options]);
    return <ComboBox
        aria-label={inputProps["aria-label"]}
        aria-describedby={inputProps["aria-describedby"]}
        className="dan-ui dan-icon-combobox"
        allowsCustomValue
        allowsEmptyCollection
        defaultItems={items}
        inputValue={value}
        onInputChange={onChange}
        selectedKey={options.includes(value) ? value : null}
        onSelectionChange={key => { if (key != null && key !== value) onChange(String(key)); }}
        name={name}
        isDisabled={isDisabled}
    >
        <ComboBoxControl icon={icon} inputProps={inputProps} />
    </ComboBox>;
}

function ComboBoxControl({ icon: Icon, inputProps }: {
    icon: NonNullable<IconComboBoxProps["icon"]>;
    inputProps: Pick<IconComboBoxProps, "aria-label" | "aria-describedby" | "id" | "placeholder" | "maxLength">;
}) {
    const state = useContext(ComboBoxStateContext);
    function closeMenu(event: KeyboardEvent) {
        if (event.key === "Escape" && state?.isOpen) {
            // Handle this before the legacy parent dialog's window Escape listener.
            event.preventDefault();
            event.stopPropagation();
            state.close();
        }
    }
    return <div className="dan-icon-combobox-control" onKeyDownCapture={closeMenu}>
        <Icon aria-hidden className="dan-icon-combobox-leading" />
        <Input {...inputProps} className="dan-icon-combobox-input" />
        <Button aria-label={`${inputProps["aria-label"]}选项`} className="dan-icon-combobox-toggle" type="button"><ChevronDown aria-hidden /></Button>
        <Popover className="dan-ui product-ui dan-select-popover dan-icon-combobox-popover" placement="bottom start" offset={6} containerPadding={12} shouldFlip>
            <ListBox<{ id: string }> className="dan-select-listbox" renderEmptyState={() => <p className="dan-icon-combobox-empty">没有匹配项，可继续填写。</p>}>
                {item => <ListBoxItem id={item.id} textValue={item.id} className="dan-select-option">
                    <Icon aria-hidden className="dan-select-option-icon" />
                    <span>{item.id}</span>
                    <Check aria-hidden className="dan-select-option-check" />
                </ListBoxItem>}
            </ListBox>
        </Popover>
    </div>;
}
