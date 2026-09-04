import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Database } from "../lib/database.types";
import { PublishModal } from "./PublishModal";

const episode = {
  account_id: "account-1",
  blueprint_version_id: "blueprint-1",
  created_at: "2026-08-18T00:00:00.000Z",
  id: "episode-1",
  stage: "publishing_review",
  title: "待发布生产单",
  updated_at: "2026-08-18T00:00:00.000Z",
} satisfies Database["public"]["Tables"]["episodes"]["Row"];

const artifacts = [
  { artifact_type: "final_render", episode_id: episode.id, file_size: 1200, id: "artifact-video", relative_path: "episodes/episode-1/final-render/final.mp4", sha256: "a".repeat(64) },
  { artifact_type: "cover", episode_id: episode.id, file_size: 80, id: "artifact-cover", relative_path: "episodes/episode-1/publish/cover.png", sha256: "b".repeat(64) },
  { artifact_type: "metadata", episode_id: episode.id, file_size: 100, id: "artifact-metadata", relative_path: "episodes/episode-1/publish/metadata.json", sha256: "e".repeat(64) },
  { artifact_type: "publish_package", episode_id: episode.id, file_size: 220, id: "artifact-package", relative_path: "episodes/episode-1/publish-package/manifest.json", sha256: "c".repeat(64) },
  { artifact_type: "final_qc_report", episode_id: episode.id, file_size: 90, id: "artifact-qc", relative_path: "episodes/episode-1/qc/report.json", sha256: "d".repeat(64) },
] as Database["public"]["Tables"]["artifacts"]["Row"][];

describe("专用发布弹窗", () => {
  it("展示发布包、视频、封面、校验结果和本地路径", async () => {
    render(<PublishModal artifacts={artifacts} episode={episode} isPending={false} isPreparationPending={false} onClose={vi.fn()} onOpenArtifact={vi.fn()} onPrepare={vi.fn()} onRecord={vi.fn()} publicationRecords={[]} publishVerification={true} />);

    expect(screen.getByRole("dialog", { name: "发布确认" })).toBeTruthy();
    expect(screen.getByText("final.mp4")).toBeTruthy();
    expect(screen.getByText("cover.png")).toBeTruthy();
    expect(screen.getByText("发布包已固定")).toBeTruthy();
    expect(screen.getByText("校验已通过")).toBeTruthy();
    expect(screen.getByText("发布元数据")).toBeTruthy();
    expect(screen.getAllByText("在本地打开").length).toBe(5);
    expect(screen.getByLabelText("视频预览")).toBeTruthy();
    expect(screen.getByLabelText("封面预览")).toBeTruthy();
    expect(screen.getByText("确认材料无误后，展开填写发布信息").closest("details")?.hasAttribute("open")).toBe(false);
    await waitFor(() => expect(screen.queryByText("正在加载预览…")).toBeNull());
  });

  it("记录手工发布字段并交给受控写入入口", async () => {
    const user = userEvent.setup();
    const onRecord = vi.fn().mockResolvedValue(true);
    render(<PublishModal artifacts={artifacts} episode={episode} isPending={false} isPreparationPending={false} onClose={vi.fn()} onOpenArtifact={vi.fn()} onPrepare={vi.fn()} onRecord={onRecord} publicationRecords={[]} publishVerification={true} />);

    await user.click(screen.getByText("确认材料无误后，展开填写发布信息"));
    await user.click(screen.getByRole("checkbox", { name: /手工发布/ }));
    await user.type(screen.getByLabelText("目标平台"), "TikTok");
    await user.type(screen.getByLabelText("发布账号或频道"), "dao.main");
    await user.type(screen.getByLabelText("外部 URL"), "https://www.tiktok.com/@dao/video/123");
    await user.type(screen.getByLabelText("外部内容 ID"), "123");
    await user.click(screen.getByRole("button", { name: "记录发布并完成确认" }));

    expect(onRecord).toHaveBeenCalledWith(expect.objectContaining({
      episodeId: episode.id,
      externalContentId: "123",
      externalUrl: "https://www.tiktok.com/@dao/video/123",
      platform: "TikTok",
      publishingAccount: "dao.main",
      source: "manual",
      status: "published",
    }));
  });

  it("通过上传槽选择 JPG、PNG 或 WebP 封面", async () => {
    const user = userEvent.setup();
    const onPrepare = vi.fn().mockResolvedValue(true);
    render(<PublishModal artifacts={artifacts.filter((artifact) => artifact.artifact_type === "final_render")} episode={episode} isPending={false} isPreparationPending={false} onClose={vi.fn()} onOpenArtifact={vi.fn()} onPrepare={onPrepare} onRecord={vi.fn()} publicationRecords={[]} publishVerification={false} />);

    expect(screen.getByLabelText("最终视频预览")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "发布材料" })).toBeNull();

    await user.clear(screen.getByLabelText("发布标题"));
    await user.type(screen.getByLabelText("发布标题"), "测试标题");
    await user.type(screen.getByLabelText("发布简介"), "测试简介");
    await user.type(screen.getByLabelText("发布标签"), "电脑, 豆包");
    expect(screen.getByText("封面（JPG、PNG、WebP）")).toBeTruthy();
    const cover = new File([new Uint8Array([82, 73, 70, 70, 0, 0, 0, 0, 87, 69, 66, 80])], "cover.webp", { type: "image/webp" });
    await user.upload(screen.getByLabelText("选择封面"), cover);
    expect(screen.getByText(/cover\.webp/)).toBeTruthy();
    expect(await screen.findByRole("img", { name: "所选封面预览" })).toBeTruthy();
    fireEvent.submit(screen.getByLabelText("发布标题").closest("form")!);

    await waitFor(() => expect(onPrepare).toHaveBeenCalledWith({ cover, description: "测试简介", tags: ["电脑", "豆包"], title: "测试标题" }));
  });
});
