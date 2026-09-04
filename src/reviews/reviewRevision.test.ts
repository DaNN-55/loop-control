import { describe, expect, it, vi } from "vitest";
import { recoverFinalReviewRender, requestReviewRevision, submitStudioReviewRevision } from "./reviewRevision";
import { supabase } from "../lib/supabase";

vi.mock("../lib/supabase", () => ({ supabase: { rpc: vi.fn() } }));

describe("审核修订", () => {
  it("按动作分流，并返回明确结果", async () => {
    vi.mocked(supabase.rpc).mockResolvedValue({ error: null } as never);

    await expect(requestReviewRevision({ kind: "composition", reviewPackageId: "review-1", reason: "调整字幕", studioProject: { relativePath: "episodes/episode-1/studio-frozen/123/index.html", sha256: "a".repeat(64), fileSize: 1 } })).resolves.toMatchObject({ kind: "composition" });
    expect(supabase.rpc).toHaveBeenCalledWith("request_review_render_revision", expect.objectContaining({ p_reason: "调整字幕", p_review_package_id: "review-1", p_composition: expect.objectContaining({ studio_project: { relative_path: "episodes/episode-1/studio-frozen/123/index.html", sha256: "a".repeat(64), file_size: 1 } }) }));

    await expect(requestReviewRevision({ kind: "storyboard", reviewPackageId: "review-2", reason: "删除镜头" })).resolves.toMatchObject({ kind: "storyboard" });
    expect(supabase.rpc).toHaveBeenLastCalledWith("request_studio_storyboard_revision", { p_reason: "删除镜头", p_review_package_id: "review-2" });
  });

  it("保留数据库返回的失败原因", async () => {
    vi.mocked(supabase.rpc).mockResolvedValue({ error: new Error("Review render package is no longer current") } as never);

    await expect(requestReviewRevision({ kind: "storyboard", reviewPackageId: "review-1", reason: "删除镜头" })).rejects.toThrow("Review render package is no longer current");
  });

  it("冻结 Studio 工程后才提交合成修订", async () => {
    vi.mocked(supabase.rpc).mockResolvedValue({ error: null } as never);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      json: async () => ({ frozenProject: { fileSize: 1, relativePath: "episodes/episode-1/studio-frozen/123e4567-e89b-12d3-a456-426614174000/index.html", sha256: "a".repeat(64) } }),
      ok: true,
    }));

    await submitStudioReviewRevision({ accessToken: "owner-token", episodeId: "episode-1", reviewPackageId: "review-1", reason: "调整字幕", sourceProjectRelativePath: "episodes/episode-1/review-render/v1/index.html", workspaceRelativePath: "episodes/episode-1/studio/123/index.html" });

    expect(fetch).toHaveBeenCalledWith("/_freeze-hyperframes-studio?episode=episode-1", expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer owner-token" }), method: "POST" }));
    expect(JSON.parse(vi.mocked(fetch).mock.calls[0]?.[1]?.body as string)).toEqual({ sourceProjectRelativePath: "episodes/episode-1/review-render/v1/index.html", workspaceRelativePath: "episodes/episode-1/studio/123/index.html" });
    expect(supabase.rpc).toHaveBeenCalledWith("request_review_render_revision", expect.objectContaining({ p_composition: expect.objectContaining({ studio_project: expect.objectContaining({ relative_path: expect.stringContaining("/studio-frozen/") }) }) }));
    vi.unstubAllGlobals();
  });

  it("恢复失败的最终渲染时复用已批准工程", async () => {
    vi.mocked(supabase.rpc).mockResolvedValue({ error: null } as never);

    await expect(recoverFinalReviewRender("episode-1", "修复编码参数后重试")).resolves.toContain("已重新排队");
    expect(supabase.rpc).toHaveBeenCalledWith("retry_failed_final_render", { p_episode_id: "episode-1", p_reason: "修复编码参数后重试" });
  });
});
