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

    expect(screen.getByText("连接池为空。先添加一条经过显式验证的外部连接。")).toBeTruthy();
    await user.type(screen.getByLabelText("连接名称"), "主 Pexels");
    await user.type(screen.getByLabelText("Pexels API Key"), "secret-key");
    await user.click(screen.getByRole("button", { name: "保存并测试" }));

    expect(onCreateConnection).toHaveBeenCalledWith({ adapter: "pexels_video", name: "主 Pexels", provider: "pexels", secret: "secret-key" });
    expect(onTestConnection).toHaveBeenCalledWith("connection-1");
    expect((screen.getByLabelText("Pexels API Key") as HTMLInputElement).value).toBe("");
  });

  it("创建并显式测试 Google TTS 连接", async () => {
    const user = userEvent.setup();
    const onCreateConnection = vi.fn().mockResolvedValue({ id: "connection-2", name: "主 Google", provider: "google_tts", adapter: "google_tts", status: "unverified", created_at: "", created_by: "owner", current_version_id: "version-2", last_verification_detail: null, last_verified_at: null });
    const onTestConnection = vi.fn().mockResolvedValue(undefined);
    render(<ConnectionWorkspace connections={[]} onCreateConnection={onCreateConnection} onTestConnection={onTestConnection} />);

    await user.selectOptions(screen.getByLabelText("连接类型"), "google_tts");
    await user.type(screen.getByLabelText("连接名称"), "主 Google");
    await user.type(screen.getByLabelText("Google TTS API Key"), "google-secret");
    await user.click(screen.getByRole("button", { name: "保存并测试" }));

    expect(onCreateConnection).toHaveBeenCalledWith({ adapter: "google_tts", name: "主 Google", provider: "google_tts", secret: "google-secret" });
    expect(onTestConnection).toHaveBeenCalledWith("connection-2");
  });

  it("轮换版本后只测试新连接并保留版本操作边界", async () => {
    const user = userEvent.setup();
    const connection = { adapter: "openai_images", created_at: "", created_by: "owner", current_version_id: "version-2", description: "", endpoint: "https://api.openai.com/v1", id: "connection-1", last_verification_detail: null, last_verified_at: null, name: "主 OpenAI", provider: "openai", status: "verified" as const };
    const onRotateConnection = vi.fn().mockResolvedValue(connection);
    const onTestConnection = vi.fn().mockResolvedValue(undefined);
    const onRevokeVersion = vi.fn().mockResolvedValue(undefined);
    const onDeleteVersion = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("confirm", vi.fn().mockReturnValue(true));
    render(<ConnectionWorkspace connections={[connection]} onCreateConnection={vi.fn()} onDeleteVersion={onDeleteVersion} onRevokeVersion={onRevokeVersion} onRotateConnection={onRotateConnection} onTestConnection={onTestConnection} versions={[{ adapter: "openai_images", connection_id: "connection-1", created_at: "", endpoint: "https://api.openai.com/v1", id: "version-1", is_current: false, provider: "openai", revoked_at: null, status: "verified", version: 1 }, { adapter: "openai_images", connection_id: "connection-1", created_at: "", endpoint: "https://api.openai.com/v1", id: "version-2", is_current: true, provider: "openai", revoked_at: null, status: "unverified", version: 2 }, { adapter: "openai_images", connection_id: "connection-1", created_at: "", endpoint: "https://api.openai.com/v1", id: "version-3", is_current: false, provider: "openai", revoked_at: null, status: "unverified", version: 3 }]} />);

    await user.click(screen.getByText("轮换认证版本"));
    await user.type(screen.getByLabelText("主 OpenAI 新的认证材料"), "new-secret");
    await user.click(screen.getByRole("button", { name: "创建新版本并测试" }));
    expect(onRotateConnection).toHaveBeenCalledWith({ adapter: "openai_images", connectionId: "connection-1", provider: "openai", secret: "new-secret" });
    expect(onTestConnection).toHaveBeenCalledWith("connection-1");
    await user.click(screen.getAllByRole("button", { name: "撤销版本" })[0]);
    expect(onRevokeVersion).toHaveBeenCalledWith("version-1");
    await user.click(screen.getByRole("button", { name: "删除草稿" }));
    expect(onDeleteVersion).toHaveBeenCalledWith("version-3");
  });
});
