import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Database } from "../lib/database.types";
import { ProductionCompletionModal } from "./ProductionCompletionModal";

const episode = { account_id: "account-1", blueprint_version_id: "blueprint-1", created_at: "2026-09-12T00:00:00.000Z", id: "episode-1", stage: "production_completed", title: "已完成生产单", updated_at: "2026-09-12T00:00:00.000Z" } satisfies Database["public"]["Tables"]["episodes"]["Row"];
const artifacts = [
  { artifact_type: "final_render", episode_id: episode.id, file_size: 1200, id: "artifact-video", relative_path: "episodes/episode-1/final-render/final.mp4", sha256: "a".repeat(64) },
  { artifact_type: "cover", episode_id: episode.id, file_size: 80, id: "artifact-cover", relative_path: "episodes/episode-1/publish/cover.png", sha256: "b".repeat(64) },
  { artifact_type: "metadata", episode_id: episode.id, file_size: 100, id: "artifact-metadata", relative_path: "episodes/episode-1/publish/metadata.json", sha256: "c".repeat(64) },
  { artifact_type: "publish_package", episode_id: episode.id, file_size: 220, id: "artifact-package", relative_path: "episodes/episode-1/publish-package/manifest.json", sha256: "d".repeat(64) },
] as Database["public"]["Tables"]["artifacts"]["Row"][];

describe("生产完成弹窗", () => {
  it("展示最终材料和生产完成状态，不提供外部发布登记", () => {
    render(<ProductionCompletionModal artifacts={artifacts} episode={episode} isPreparationPending={false} onClose={vi.fn()} onOpenArtifact={vi.fn()} onPrepare={vi.fn()} publishVerification />);
    expect(screen.getByRole("dialog", { name: "完成生产" })).toBeTruthy();
    expect(screen.getByText("生产已完成")).toBeTruthy();
    expect(screen.getByText(/外部发布不在本工作台记录/)).toBeTruthy();
    expect(screen.queryByLabelText("目标平台")).toBeNull();
  });
});
