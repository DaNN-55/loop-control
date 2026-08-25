import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { WorkerBlockerCard } from "./WorkerBlockerCard";

describe("WorkerBlockerCard", () => {
  it("将管理连接预检动作导航到全局连接管理", async () => {
    const user = userEvent.setup();
    const onOpenConnection = vi.fn();
    render(<WorkerBlockerCard blocker={{ action: "manage_connection", capability: "b_roll_generation", check: "credential_validity", code: "credential_validity", detail: "Pexels 拒绝认证。", scope: "connection", status: "unavailable" }} onOpenConnection={onOpenConnection} />);

    await user.click(screen.getByRole("button", { name: "打开外部连接管理" }));

    expect(onOpenConnection).toHaveBeenCalledTimes(1);
  });

  it("未传入回调时发出全局连接管理导航事件", async () => {
    const user = userEvent.setup();
    const onOpenConnections = vi.fn();
    window.addEventListener("open-external-connections", onOpenConnections);
    render(<WorkerBlockerCard blocker={{ action: "manage_connection", capability: "b_roll_generation", check: "credential_validity", code: "credential_validity", detail: "Pexels 拒绝认证。", scope: "connection", status: "unavailable" }} />);

    await user.click(screen.getByRole("button", { name: "打开外部连接管理" }));

    expect(onOpenConnections).toHaveBeenCalledTimes(1);
    window.removeEventListener("open-external-connections", onOpenConnections);
  });
});
