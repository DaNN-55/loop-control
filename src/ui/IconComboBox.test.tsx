import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { IconComboBox } from "./dan-ui/components/base/select/icon-combobox";
import { useDialogFocus } from "./useDialogFocus";

const options = ["voice_alpha", "voice_bravo", "声音_清晰"];
afterEach(cleanup);
function Field({ disabled = false, initial = "" }: { disabled?: boolean; initial?: string }) {
    const [value, setValue] = useState(initial);
    return <form aria-label="声音表单"><IconComboBox aria-label="单独设置声音" name="voice" value={value} onChange={setValue} options={options} isDisabled={disabled} /></form>;
}

it("keeps an arbitrary voice ID and submits the input text", async () => {
    const user = userEvent.setup();
    render(<Field />);
    await user.type(screen.getByRole("combobox", { name: "单独设置声音" }), "custom_voice_id");
    await user.tab();
    expect((screen.getByRole("combobox") as HTMLInputElement).value).toBe("custom_voice_id");
    expect(new FormData(screen.getByRole("form") as HTMLFormElement).get("voice")).toBe("custom_voice_id");
});

it("filters suggestions and chooses one with the pointer", async () => {
    const user = userEvent.setup();
    render(<Field />);
    await user.type(screen.getByRole("combobox"), "brav");
    expect(await screen.findByRole("option", { name: "voice_bravo" })).toBeTruthy();
    expect(screen.queryByRole("option", { name: "voice_alpha" })).toBeNull();
    await user.click(screen.getByRole("option", { name: "voice_bravo" }));
    expect((screen.getByRole("combobox") as HTMLInputElement).value).toBe("voice_bravo");
    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
});

it("chooses a suggestion with ArrowDown and Enter", async () => {
    const user = userEvent.setup();
    render(<Field />);
    const input = screen.getByRole("combobox");
    await user.click(input);
    await user.keyboard("{ArrowDown}{Enter}");
    expect((input as HTMLInputElement).value).toBe("voice_alpha");
});

it("disables input and suggestion control together", async () => {
    const user = userEvent.setup();
    render(<Field disabled initial="voice_alpha" />);
    expect((screen.getByRole("combobox") as HTMLInputElement).disabled).toBe(true);
    const trigger = screen.getByRole("button", { name: "单独设置声音选项" });
    expect((trigger as HTMLButtonElement).disabled).toBe(true);
    await user.click(trigger);
    expect(screen.queryByRole("listbox")).toBeNull();
});

it("opens the full suggestion list from the icon button without replacing a custom ID", async () => {
    const user = userEvent.setup();
    render(<Field initial="custom_voice_id" />);
    await user.click(screen.getByRole("button", { name: "单独设置声音选项" }));
    expect(await screen.findByRole("option", { name: "voice_alpha" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "声音_清晰" })).toBeTruthy();
    await user.keyboard("{Escape}");
    expect((screen.getByRole("combobox") as HTMLInputElement).value).toBe("custom_voice_id");
    expect(screen.queryByRole("listbox")).toBeNull();
});

it("Escape closes only the suggestions in a legacy dialog and keeps the typed value", async () => {
    const closed = vi.fn();
    function LegacyDialog() {
        const ref = useDialogFocus<HTMLElement>(true, closed);
        return <section role="dialog" aria-label="声音设置" ref={ref}><Field /></section>;
    }
    const user = userEvent.setup();
    render(<LegacyDialog />);
    await user.type(screen.getByRole("combobox"), "voice_");
    expect(await screen.findByRole("listbox")).toBeTruthy();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(closed).not.toHaveBeenCalled();
    expect((screen.getByRole("combobox") as HTMLInputElement).value).toBe("voice_");
    expect(document.activeElement).toBe(screen.getByRole("combobox"));
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Escape" });
    expect(closed).toHaveBeenCalledOnce();
});
