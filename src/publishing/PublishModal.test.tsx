import { render, screen } from "@testing-library/react";
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
  { artifact_type: "publish_package", episode_id: episode.id, file_size: 220, id: "artifact-package", relative_path: "episodes/episode-1/publish-package/manifest.json", sha256: "c".repeat(64) },
  { artifact_type: "final_qc_report", episode_id: episode.id, file_size: 90, id: "artifact-qc", relative_path: "episodes/episode-1/qc/report.json", sha256: "d".repeat(64) },
] as Database["public"]["Tables"]["artifacts"]["Row"][];

describe("专用发布弹窗", () => {
  it("展示发布包、视频、封面、校验结果和本地路径", () => {
    render(<PublishModal artifacts={artifacts} episode={episode} isPending={false} onClose={vi.fn()} onRecord={vi.fn()} publicationRecords={[]} publishVerification={true} />);

    expect(screen.getByRole("dialog", { name: "发布确认" })).toBeTruthy();
    expect(screen.getByText("final.mp4")).toBeTruthy();
    expect(screen.getByText("cover.png")).toBeTruthy();
    expect(screen.getByText("发布包已固定")).toBeTruthy();
    expect(screen.getByText("校验已通过")).toBeTruthy();
    expect(screen.getByText("episodes/episode-1")).toBeTruthy();
  });

  it("记录手工发布字段并交给受控写入入口", async () => {
    const user = userEvent.setup();
    const onRecord = vi.fn().mockResolvedValue(true);
    render(<PublishModal artifacts={artifacts} episode={episode} isPending={false} onClose={vi.fn()} onRecord={onRecord} publicationRecords={[]} publishVerification={true} />);

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
});
