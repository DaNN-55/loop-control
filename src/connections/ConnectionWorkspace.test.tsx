import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ConnectionWorkspace } from "./ConnectionWorkspace";

describe("外部连接工作区", () => {
  it("从空连接池创建并显式测试 Pexels 连接，表单提交后清空秘密", async () => {
    const user = userEvent.setup();
    const onCreateConnection = vi.fn().mockResolvedValue({ id: "connection-1", name: "主 Pexels", provider: "pexels", adapter: "pexels_video", status: "unverified", created_at: "", created_by: "owner", last_verification_detail: null, last_verified_at: null });
    const onTestConnection = vi.fn().mockResolvedValue(undefined);
    render(<ConnectionWorkspace connections={[]} onCreateConnection={onCreateConnection} onTestConnection={onTestConnection} />);

    expect(screen.getByText("连接池为空。先添加并测试一条 Pexels 连接。")).toBeTruthy();
    await user.type(screen.getByLabelText("连接名称"), "主 Pexels");
    await user.type(screen.getByLabelText("Pexels API Key"), "secret-key");
    await user.click(screen.getByRole("button", { name: "保存并测试" }));

    expect(onCreateConnection).toHaveBeenCalledWith({ adapter: "pexels_video", name: "主 Pexels", provider: "pexels", secret: "secret-key" });
    expect(onTestConnection).toHaveBeenCalledWith("connection-1");
    expect((screen.getByLabelText("Pexels API Key") as HTMLInputElement).value).toBe("");
  });
});
