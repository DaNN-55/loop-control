import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PaginationControls } from "./PaginationControls";

describe("分页控件", () => {
  it("显示页码和总数，并允许切换页码", async () => {
    const user = userEvent.setup();
    const onPageChange = vi.fn();
    render(<PaginationControls page={2} pageSize={20} total={45} onPageChange={onPageChange} />);

    expect(screen.getByText("第 2 / 3 页 · 共 45 条")).toBeTruthy();
    expect((screen.getByRole("button", { name: "上一页" }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole("button", { name: "下一页" }) as HTMLButtonElement).disabled).toBe(false);
    await user.click(screen.getByRole("button", { name: "下一页" }));
    expect(onPageChange).toHaveBeenCalledWith(3);
  });

  it("只有一页时不渲染控件", () => {
    const { container } = render(<PaginationControls page={1} pageSize={20} total={2} onPageChange={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });
});
