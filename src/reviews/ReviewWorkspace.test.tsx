import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "../lib/database.types";
import { EpisodeDetail, EpisodeDetailDrawer, ReviewWorkspace } from "../App";
import { clearLocalArtifactCache } from "./localArtifactPreview";

vi.mock("../lib/supabase", () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: "owner-token" } }, error: null }),
    },
  },
}));

type Account = Database["public"]["Tables"]["accounts"]["Row"];
type Artifact = Database["public"]["Tables"]["artifacts"]["Row"];
type Blueprint = Database["public"]["Tables"]["account_blueprint_versions"]["Row"];
type Episode = Database["public"]["Tables"]["episodes"]["Row"];
type AudioTrack = Database["public"]["Tables"]["audio_tracks"]["Row"];
type MaterialRevision = Database["public"]["Tables"]["production_material_revisions"]["Row"];
type ShotPreparationDraft = Database["public"]["Tables"]["shot_preparation_drafts"]["Row"];
type StoryboardAudioSelection = Database["public"]["Tables"]["storyboard_audio_selections"]["Row"];
type PreRenderReviewMember = Database["public"]["Tables"]["pre_render_review_members"]["Row"];
type Task = Database["public"]["Tables"]["tasks"]["Row"];
const originalClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");

async function openVisualStep(user: ReturnType<typeof userEvent.setup>, shotId: string) {
  await user.click(within(screen.getByRole("tablist", { name: `${shotId} 镜头工作区` })).getByRole("tab", { name: "2 画面与构图" }));
}

const account: Account = {
  archived_at: null,
  created_at: "2026-08-14T00:00:00.000Z",
  current_blueprint_version_id: "blueprint-1",
  id: "account-1",
  name: "道工作室",
  slug: "dao-studio",
  timezone: "Asia/Shanghai",
};

const blueprint: Blueprint = {
  account_id: account.id,
  archived_at: null,
  created_at: "2026-08-14T00:00:00.000Z",
  id: "blueprint-1",
  is_active: true,
  is_snapshot: false,
  policy: { asset_root: "/Volumes/素材盘/loop-control/dao" },
  version: 1,
};

const reviewEpisode: Episode = {
  account_id: account.id,
  blueprint_version_id: blueprint.id,
  created_at: "2026-08-14T00:00:00.000Z",
  id: "episode-review",
  stage: "script_review",
  title: "越南民间信仰中的符号",
  updated_at: "2026-08-14T00:00:00.000Z",
};

const draftEpisode: Episode = { ...reviewEpisode, id: "episode-draft", stage: "script_draft", title: "不应出现在审核队列" };

const previewArtifact: Artifact = {
  artifact_type: "cover",
  created_at: "2026-08-14T00:00:00.000Z",
  episode_id: reviewEpisode.id,
  file_size: 100,
  id: "artifact-cover",
  producer_task_id: null,
  relative_path: "episodes/episode-review/cover.png",
  sha256: "a".repeat(64),
};

const videoArtifact: Artifact = {
  ...previewArtifact,
  artifact_type: "render",
  id: "artifact-render",
  relative_path: "episodes/episode-review/render.mp4",
};

const blockedTask: Task = {
  actual_cost_cents: 0,
  attempt: 1,
  budget_limit_cents: 100,
  claimed_at: "2026-08-14T00:00:00.000Z",
  completed_at: "2026-08-14T00:00:00.000Z",
  created_at: "2026-08-14T00:00:00.000Z",
  episode_id: reviewEpisode.id,
  id: "task-1",
  input_snapshot: {},
  last_result: {
    blockers: [{ code: "MISSING_ASSET", detail: "缺少已批准的脚本产物。" }],
  },
  max_attempts: 1,
  model: "gpt-5.6-terra",
  prompt_version: "brief-v1",
  provider: "codex",
  status: "blocked",
  task_type: "draft_brief",
};

const materialInputProps = {
  audioTrackAnnotations: [],
  audioTracks: [],
  isMaterialPending: false,
  isStoryboardAnnotationPending: false,
  isTitlePending: false,
  reviewAnnotations: [],
  reviewPackages: [],
  onCreateStoryboardAnnotation: vi.fn().mockResolvedValue(undefined),
  onCreateAudioTrackAnnotation: vi.fn().mockResolvedValue(undefined),
  onImportMaterial: vi.fn().mockResolvedValue(undefined),
  onRequestRevision: vi.fn().mockResolvedValue({ kind: "composition" }),
  onUpdateTitle: vi.fn().mockResolvedValue(undefined),
};

const localArtifactTicketResponse = () => Response.json({ url: "/_local-artifact?ticket=preview" });

describe("审核台", () => {
  beforeEach(() => {
    clearLocalArtifactCache();
    const storage = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      clear: () => storage.clear(),
      getItem: (key: string) => storage.get(key) ?? null,
      removeItem: (key: string) => storage.delete(key),
      setItem: (key: string, value: string) => storage.set(key, value),
    });
    vi.stubGlobal("fetch", vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => Promise.resolve(
      init?.method === "POST" && String(input).startsWith("/_local-artifact")
        ? localArtifactTicketResponse()
        : new Response(new Blob(["preview"], { type: "image/png" }), { status: 200 }),
    )));
    vi.stubGlobal("URL", { createObjectURL: vi.fn().mockReturnValue("blob:local-preview"), revokeObjectURL: vi.fn() });
  });

  afterEach(() => {
    cleanup();
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
    vi.unstubAllGlobals();
    if (originalClipboard) Object.defineProperty(navigator, "clipboard", originalClipboard);
    else delete (navigator as { clipboard?: Clipboard }).clipboard;
  });

  it("点击抽屉外遮罩或按 Escape 可以关闭生产单详情", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<EpisodeDetailDrawer isOpen onClose={onClose}><p>详情内容</p></EpisodeDetailDrawer>);

    await user.click(screen.getByTestId("episode-detail-scrim"));
    expect(onClose).toHaveBeenCalledTimes(1);
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("放大预览打开时按 Escape 不关闭生产单详情", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<EpisodeDetailDrawer isOpen onClose={onClose}><div aria-modal="true" role="dialog">放大预览</div></EpisodeDetailDrawer>);

    await user.keyboard("{Escape}");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("在详情顶部显示当前阶段和下一步，并默认收起技术索引", () => {
    render(<EpisodeDetail {...materialInputProps} artifacts={[]} blueprint={blueprint} episode={reviewEpisode} isTransitionPending={false} onTransition={vi.fn()} tasks={[]} transitions={[]} />);

    expect(screen.getByText("审核生成脚本")).toBeTruthy();
    expect(screen.queryByText("工作标题（可留空）")).toBeNull();
    expect(screen.queryByRole("heading", { name: "生产单管理" })).toBeNull();
    expect(screen.getByRole("button", { name: "查看产物索引" }).getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("heading", { name: "产物索引" })).toBeNull();
    const currentApproval = screen.getByText("当前审核").parentElement;
    expect(currentApproval?.textContent).toContain("脚本审核需要你审核");
    expect(screen.queryByText("视觉审核")).toBeNull();
  });

  it("Worker 排队或运行时显示持续刷新反馈", () => {
    render(<EpisodeDetail {...materialInputProps} artifacts={[]} blueprint={blueprint} episode={{ ...reviewEpisode, stage: "visual_draft" }} isTransitionPending={false} onTransition={vi.fn()} tasks={[{ ...blockedTask, claimed_at: null, completed_at: null, last_result: null, status: "ready" }]} transitions={[]} />);

    expect(screen.getByText("页面每 10 秒自动刷新任务状态")).toBeTruthy();
  });

  it("QC 通过但缺少最终材料时明确提示，并可进入生产完成流程", async () => {
    const user = userEvent.setup();
    const openCompletion = vi.fn();
    window.addEventListener("open-production-completion", openCompletion);
    render(<EpisodeDetail {...materialInputProps} artifacts={[]} blueprint={blueprint} episode={{ ...reviewEpisode, stage: "qc_passed" }} isTransitionPending={false} onTransition={vi.fn()} tasks={[]} transitions={[]} />);

    expect(screen.getByText("最终生产材料尚未完成")).toBeTruthy();
    expect(screen.getByText(/封面 缺少 · 元数据 缺少 · 发布包 缺少/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "完成生产" }));
    expect(openCompletion).toHaveBeenCalledOnce();
    window.removeEventListener("open-production-completion", openCompletion);
  });

  it("通过顶部图标按需打开产物索引及包含任务进度的审计时间线", async () => {
    const user = userEvent.setup();
    render(<EpisodeDetail {...materialInputProps} artifacts={[previewArtifact]} blueprint={blueprint} episode={reviewEpisode} isTransitionPending={false} onTransition={vi.fn()} tasks={[blockedTask]} transitions={[{ actor_id: null, created_at: "2026-08-15T01:00:00.000Z", episode_id: reviewEpisode.id, from_stage: "script_draft" as const, id: "transition-utility", reason: "Worker submitted a frozen visual planning review package.", to_stage: "script_review" as const }]} />);

    await user.click(screen.getByRole("button", { name: "查看产物索引" }));
    expect(screen.getByRole("dialog", { name: "产物索引" })).toBeTruthy();
    expect(screen.getByText(previewArtifact.relative_path)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "查看执行与审计时间线" }));
    expect(screen.getByRole("dialog", { name: "审计时间线" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "状态变化与任务执行" })).toBeTruthy();
    const stageEntry = screen.getByText("Worker 已提交冻结的视觉素材清单，等待审核。", { exact: false }).closest("li");
    expect(stageEntry?.textContent).toContain("脚本概要 · 已阻塞");
    expect(screen.getByText("Worker 已提交冻结的视觉素材清单，等待审核。", { exact: false })).toBeTruthy();
    expect(screen.queryByText("后台执行结果已记录，生产单状态已更新。")).toBeNull();
  });

  it("审计时间线只显示中文原因，不展示技术原文", async () => {
    const user = userEvent.setup();
    const transitions = [
      { actor_id: null, created_at: "2026-08-15T01:00:00.000Z", episode_id: reviewEpisode.id, from_stage: "script_draft" as const, id: "transition-1", reason: "Worker submitted a frozen visual planning review package.", to_stage: "script_review" as const },
      { actor_id: null, created_at: "2026-08-15T01:01:00.000Z", episode_id: reviewEpisode.id, from_stage: "script_review" as const, id: "transition-2", reason: "Worker submitted a frozen storyboard review package.", to_stage: "script_review" as const },
    ];
    render(<EpisodeDetail {...materialInputProps} artifacts={[]} blueprint={blueprint} episode={reviewEpisode} isTransitionPending={false} onTransition={vi.fn()} tasks={[]} transitions={transitions} />);

    await user.click(screen.getByRole("button", { name: "查看执行与审计时间线" }));
    expect(screen.getByText("后台执行结果已记录，生产单状态已更新。", { exact: false })).toBeTruthy();
    expect(screen.queryByText(/Worker submitted/)).toBeNull();
  });

  it("只列出需要 Owner 审核的 Episode，并允许选择其中一项", async () => {
    const user = userEvent.setup();
    const onSelectEpisode = vi.fn();
    const productionEpisode: Episode = { ...reviewEpisode, id: "episode-production", stage: "production_ready", title: "预渲染审核" };
    const archivedReviewEpisode: Episode = { ...reviewEpisode, id: "episode-archived-review", title: "已归档待审", archived_at: "2026-08-16T00:00:00.000Z" };

    render(<ReviewWorkspace accountsById={new Map([[account.id, account]])} episodes={[reviewEpisode, productionEpisode, draftEpisode, archivedReviewEpisode]} onSelectEpisode={onSelectEpisode} selectedEpisode={null} />);

    expect(screen.getByRole("heading", { name: "待审核 Episode" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /越南民间信仰中的符号/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /预渲染审核/ })).toBeTruthy();
    expect(screen.queryByText("不应出现在审核队列")).toBeNull();
    expect(screen.queryByText("已归档待审")).toBeNull();

    await user.click(screen.getByRole("button", { name: /越南民间信仰中的符号/ }));
    expect(onSelectEpisode).toHaveBeenCalledWith(reviewEpisode.id);
  });

  it("对待审核 Episode 使用分页", async () => {
    const user = userEvent.setup();
    const manyEpisodes = Array.from({ length: 21 }, (_, index) => ({ ...reviewEpisode, id: `episode-review-page-${index}`, title: `待审分页 ${index + 1}` }));

    render(<ReviewWorkspace accountsById={new Map([[account.id, account]])} episodes={manyEpisodes} onSelectEpisode={vi.fn()} selectedEpisode={null} />);

    expect(screen.getByText("第 1 / 2 页 · 共 21 条")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "下一页" }));
    expect(screen.getByText("待审分页 21")).toBeTruthy();
  });

  it("显示可预览产物和 Worker 阻塞项，并以理由执行批准或要求修改", async () => {
    const user = userEvent.setup();
    const onTransition = vi.fn().mockResolvedValue(undefined);

    const { rerender } = render(<EpisodeDetail {...materialInputProps} artifacts={[previewArtifact, videoArtifact]} blueprint={blueprint} episode={reviewEpisode} isTransitionPending={false} onTransition={onTransition} tasks={[blockedTask]} transitions={[]} />);

    expect((await screen.findByAltText("cover 产物预览")).getAttribute("src")).toBe("/_local-artifact?ticket=preview");
    expect(fetch).toHaveBeenCalledWith("/_local-artifact?episode=episode-review&path=episodes%2Fepisode-review%2Fcover.png", { headers: { Authorization: "Bearer owner-token" }, method: "POST" });
    expect(screen.getByText("MISSING_ASSET")).toBeTruthy();
    expect(screen.getByText("缺少已批准的脚本产物。")).toBeTruthy();

    await user.selectOptions(screen.getByLabelText("预览产物"), videoArtifact.id);
    expect((await screen.findByLabelText("render 产物预览")).getAttribute("src")).toBe("/_local-artifact?ticket=preview");
    expect(fetch).toHaveBeenLastCalledWith("/_local-artifact?episode=episode-review&path=episodes%2Fepisode-review%2Frender.mp4", { headers: { Authorization: "Bearer owner-token" }, method: "POST" });

    await user.click(screen.getByRole("button", { name: "批准" }));
    expect(screen.getByText("请填写审批理由。")).toBeTruthy();

    await user.type(screen.getByLabelText("审批理由"), "脚本符合账号蓝图。");
    await user.click(screen.getByRole("button", { name: "批准" }));
    expect(onTransition).toHaveBeenCalledWith(reviewEpisode.id, "script_approved", "脚本符合账号蓝图。");

    await user.click(screen.getByRole("button", { name: "要求修改" }));
    expect(onTransition).toHaveBeenLastCalledWith(reviewEpisode.id, "script_draft", "脚本符合账号蓝图。");

    const nextEpisode: Episode = { ...reviewEpisode, id: "episode-next", title: "新的审核 Episode" };
    rerender(<EpisodeDetail {...materialInputProps} artifacts={[previewArtifact]} blueprint={blueprint} episode={nextEpisode} isTransitionPending={false} onTransition={onTransition} tasks={[]} transitions={[]} />);
    await user.click(screen.getByRole("button", { name: "批准" }));
    expect(screen.getByText("请填写审批理由。")).toBeTruthy();
    expect(onTransition).toHaveBeenCalledTimes(2);
  });

  it("即时派发失败时在当前任务区域持续显示原因", () => {
    const readyTask = { ...blockedTask, claimed_at: null, completed_at: null, id: "task-dispatch-failed", status: "ready" as const, task_type: "generate_review_render" };
    const episode = { ...reviewEpisode, stage: "render_ready" as const };

    render(<EpisodeDetail {...materialInputProps} artifacts={[]} blueprint={blueprint} dispatchFailure={{ detail: "Supabase 返回 HTTP 504", taskId: readyTask.id }} episode={episode} isTransitionPending={false} onTransition={vi.fn()} tasks={[readyTask]} transitions={[]} />);

    expect(screen.getByText("派发失败")).toBeTruthy();
    expect(screen.getByText(/审核渲染任务已创建，但 Worker 未启动：Supabase 返回 HTTP 504/)).toBeTruthy();
  });

  it("生成媒体预览默认展示当前镜头代理并折叠历史版本", async () => {
    const episode = { ...reviewEpisode, stage: "render_ready" as const };
    const currentProxy = { ...videoArtifact, artifact_type: "shot_preview_proxy", created_at: "2026-09-12T02:00:00.000Z", episode_id: episode.id, id: "proxy-current", relative_path: `episodes/${episode.id}/shot-previews/shot-1/current/proxy.mp4` };
    const historicalProxy = { ...currentProxy, created_at: "2026-09-11T02:00:00.000Z", id: "proxy-history", relative_path: `episodes/${episode.id}/shot-previews/shot-1/history/proxy.mp4` };
    const draft = { current_preview_artifact_id: currentProxy.id, episode_id: episode.id, id: "draft-preview-history", review_package_id: "storyboard-package", shot_id: "shot-1" } as unknown as ShotPreparationDraft;

    render(<EpisodeDetail {...materialInputProps} artifacts={[historicalProxy, currentProxy]} blueprint={blueprint} episode={episode} isTransitionPending={false} onTransition={vi.fn()} shotPreparationDrafts={[draft]} tasks={[]} transitions={[]} />);

    const previews = await screen.findAllByLabelText("shot_preview_proxy 产物预览");
    expect(previews.some((preview) => !preview.closest(".artifact-preview-history"))).toBe(true);
    const history = screen.getByText("历史预览产物（1）").closest("details");
    expect(history).toBeTruthy();
    expect(history?.hasAttribute("open")).toBe(false);
    expect(within(history as HTMLElement).getByLabelText("shot_preview_proxy 产物预览")).toBeTruthy();
  });

  it("只在整片音轨中展示可试听的 BGM，并将时间批注交给受控 RPC", async () => {
    const user = userEvent.setup();
    const onCreateAudioTrackAnnotation = vi.fn().mockResolvedValue(undefined);
    render(<EpisodeDetail {...materialInputProps} artifacts={[]} audioTracks={[{
      id: "audio-1", episode_id: reviewEpisode.id, source_task_id: "task-audio", source_artifact_id: "artifact-audio", source_material_revision_id: null, source_review_package_id: "package-1", track_kind: "bgm", cue_id: "opening", relative_path: "episodes/episode-review/audio/opening.mp3", sha256: "a".repeat(64), file_size: 10, start_seconds: 2, duration_seconds: 8, created_at: "2026-08-15T00:00:00.000Z",
    }]} audioTrackAnnotations={[]} blueprint={blueprint} episode={reviewEpisode} isTransitionPending={false} onCreateAudioTrackAnnotation={onCreateAudioTrackAnnotation} onTransition={vi.fn()} tasks={[]} transitions={[]} />);

    expect(await screen.findByLabelText("bgm 音轨")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "整片音轨" })).toBeTruthy();
    expect(fetch).toHaveBeenCalledWith(`/_local-artifact?episode=episode-review&path=episodes%2Fepisode-review%2Faudio%2Fopening.mp3&sha256=${"a".repeat(64)}`, { headers: { Authorization: "Bearer owner-token" }, method: "POST" });
    expect(screen.getByLabelText("bgm 音轨").closest(".audio-track-card")).toBeTruthy();
    expect(screen.getByRole("button", { name: "添加音轨批注" }).className).toContain("button-primary");
    expect(screen.getByLabelText("音轨时间点").getAttribute("min")).toBe("2");
    expect(screen.getByLabelText("音轨时间点").getAttribute("max")).toBe("10");
    await user.clear(screen.getByLabelText("音轨时间点"));
    await user.type(screen.getByLabelText("音轨时间点"), "2.5");
    await user.type(screen.getByLabelText("音轨批注"), "这里需要更慢一点");
    await user.click(screen.getByRole("button", { name: "添加音轨批注" }));
    expect(onCreateAudioTrackAnnotation).toHaveBeenCalledWith({ audioTrackId: "audio-1", atSeconds: 2.5, reason: "这里需要更慢一点" });
  });

  it("展示 A-roll 的冻结执行证据和运行状态", () => {
    const aRollTask: Task = {
      ...blockedTask,
      actual_cost_cents: 72,
      attempt: 1,
      input_snapshot: {
        capability: "a_roll_generation",
        executor: { adapter: "codex", model: "gpt-5.6-luna", prompt_version: "a-roll-v1", provider: "codex" },
        allowed_tools: ["read", "write"],
        input_artifacts: [{ artifactType: "main_script", relativePath: "episodes/episode-review/script.md", sha256: "c".repeat(64), fileSize: 100 }],
        shot: { id: "shot-01" },
      },
      max_attempts: 2,
      status: "running",
      task_type: "generate_a_roll",
    };

    render(<EpisodeDetail {...materialInputProps} artifacts={[]} blueprint={blueprint} episode={reviewEpisode} isTransitionPending={false} onTransition={vi.fn()} tasks={[aRollTask]} transitions={[]} />);

    expect(screen.getByRole("heading", { name: "A-roll 生成运行" })).toBeTruthy();
    expect(screen.getByText("shot-01 · 执行中")).toBeTruthy();
    expect(screen.getByText("codex · gpt-5.6-luna · a-roll-v1")).toBeTruthy();
    expect(screen.getByText("72 分")).toBeTruthy();
    expect(screen.getByText("最新结果：执行中")).toBeTruthy();
  });

  it("在冻结执行器缺失时仍展示 A-roll 阻塞状态", () => {
    const aRollTask: Task = {
      ...blockedTask,
      input_snapshot: { capability: "a_roll_generation", shot: { id: "shot-02" } },
      last_result: { blockers: [{ code: "a_roll_executor_missing", detail: "蓝图未声明执行器。" }] },
      task_type: "generate_a_roll",
    };

    render(<EpisodeDetail {...materialInputProps} artifacts={[]} blueprint={blueprint} episode={reviewEpisode} isTransitionPending={false} onTransition={vi.fn()} tasks={[aRollTask]} transitions={[]} />);

    expect(screen.getByText("A-roll 任务 · 已阻塞")).toBeTruthy();
    expect(screen.getAllByText("媒体适配器配置不完整").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/当前生产单 → 专用媒体配置/).length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByRole("button", { name: "打开蓝图配置" })).toBeNull();
    expect(screen.getByText("a_roll_executor_missing")).toBeTruthy();
  });

  it("合并重复阻塞任务并提供蓝图修改入口", async () => {
    const user = userEvent.setup();
    const onOpenBlueprint = vi.fn();
    const blockerResult = { blockers: [{ code: "executor_invalid", detail: "执行器 adapter 未配置。" }] };
    const executorTask1: Task = { ...blockedTask, id: "task-executor-1", last_result: blockerResult };
    const executorTask2: Task = { ...blockedTask, id: "task-executor-2", last_result: blockerResult };

    render(<EpisodeDetail {...materialInputProps} artifacts={[]} blueprint={blueprint} episode={reviewEpisode} isTransitionPending={false} onOpenBlueprint={onOpenBlueprint} onTransition={vi.fn()} tasks={[executorTask1, executorTask2]} transitions={[]} />);

    const blockerSection = screen.getByRole("heading", { name: "优先处理 Worker 阻塞项（2）" }).closest("details");
    const materialSection = screen.getByRole("heading", { name: "准备生产材料" }).closest("details");
    expect(blockerSection?.open).toBe(true);
    expect(blockerSection?.compareDocumentPosition(materialSection as Node)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(screen.getByText("先处理 Worker 阻塞项")).toBeTruthy();
    expect(screen.getByText("影响 2 个任务")).toBeTruthy();
    expect(screen.getAllByText("处理位置")).toHaveLength(1);
    expect(screen.queryByText("Episode")).toBeNull();
    expect(screen.queryByText("资产目录")).toBeNull();
    await user.click(screen.getByRole("button", { name: "修改配置并继续当前生产单" }));
    expect(onOpenBlueprint).toHaveBeenCalledWith(expect.objectContaining({ code: "executor_invalid", detail: "执行器 adapter 未配置。" }));
  });

  it("以纵向缩略图展示产物，并允许 Owner 放大后关闭预览", async () => {
    const user = userEvent.setup();

    render(<EpisodeDetail {...materialInputProps} artifacts={[previewArtifact]} blueprint={blueprint} episode={reviewEpisode} isTransitionPending={false} onTransition={vi.fn()} tasks={[]} transitions={[]} />);

    const preview = await screen.findByAltText("cover 产物预览");
    expect(preview.closest("figure")?.className).toContain("local-artifact-preview");

    await user.click(screen.getByRole("button", { name: "放大查看 cover 产物" }));
    expect(screen.getByRole("dialog", { name: "cover 产物放大预览" })).toBeTruthy();
    expect(screen.getByRole("img", { name: "cover 产物放大预览" }).getAttribute("src")).toBe("/_local-artifact?ticket=preview");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "关闭放大预览" }));

    await user.keyboard("{Tab}");
    expect(screen.getByRole("dialog", { name: "cover 产物放大预览" }).contains(document.activeElement)).toBe(true);

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "cover 产物放大预览" })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "放大查看 cover 产物" }));

    await user.click(screen.getByRole("button", { name: "放大查看 cover 产物" }));
    await user.click(screen.getByRole("dialog", { name: "cover 产物放大预览" }));
    expect(screen.queryByRole("dialog", { name: "cover 产物放大预览" })).toBeNull();
  });

  it("在详情头部以图标提供刷新、打开和复制本地目录", async () => {
    const user = userEvent.setup();
    const onOpenLocalDirectory = vi.fn().mockResolvedValue(undefined);
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    const writeText = vi.fn().mockResolvedValue(undefined);
    const localInputPath = "/Volumes/素材盘/loop-control/dao/episodes/episode-review/input";
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });

    render(<EpisodeDetail {...materialInputProps} artifacts={[]} blueprint={blueprint} episode={reviewEpisode} isDirectoryOpenPending={false} onOpenLocalDirectory={onOpenLocalDirectory} onRefresh={onRefresh} isTransitionPending={false} onTransition={vi.fn()} tasks={[]} transitions={[]} />);

    expect(screen.queryByRole("heading", { name: "准备本地输入目录" })).toBeNull();
    expect(screen.getByRole("button", { name: "刷新生产单状态" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "打开本地输入目录" }).getAttribute("title")).toBe(`打开本地输入目录：${localInputPath}`);
    expect(screen.getByRole("button", { name: "复制本地输入目录路径" }).getAttribute("title")).toBe(`复制本地输入目录路径：${localInputPath}`);

    await user.click(screen.getByRole("button", { name: "刷新生产单状态" }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "打开本地输入目录" }));
    expect(onOpenLocalDirectory).toHaveBeenCalledWith(reviewEpisode.id);
    await user.click(screen.getByRole("button", { name: "复制本地输入目录路径" }));
    expect(writeText).toHaveBeenCalledWith(localInputPath);
  });

  it("材料区提供统一文件导入", () => {
    const waitingEpisode: Episode = { ...reviewEpisode, id: "episode-file-only", stage: "waiting_input" };
    render(<EpisodeDetail {...materialInputProps} artifacts={[]} blueprint={blueprint} episode={waitingEpisode} isTransitionPending={false} onTransition={vi.fn()} tasks={[]} transitions={[]} />);

    expect(screen.getByRole("region", { name: "统一材料导入" })).toBeTruthy();
    expect(screen.queryByLabelText("上传A-shot")).toBeNull();
    expect(screen.queryByLabelText("材料来源")).toBeNull();
    expect(screen.queryByLabelText("粘贴的生产材料")).toBeNull();
    expect(screen.queryByLabelText("输入目录文件路径")).toBeNull();
  });

  it("等待输入时仅允许上传外部制作的主脚本", () => {
    const waitingEpisode: Episode = { ...reviewEpisode, id: "episode-waiting", stage: "waiting_input", title: "等待主脚本" };

    render(<EpisodeDetail {...materialInputProps} artifacts={[]} blueprint={blueprint} episode={waitingEpisode} isTransitionPending={false} onTransition={vi.fn()} tasks={[]} transitions={[]} />);

    expect(screen.getByRole("heading", { name: "准备生产材料" }).closest("details")?.className).toContain("detail-card-collapsible");
    expect(screen.getByText("主脚本由外部制作后上传；确认后会作为本生产单不可变输入。")).toBeTruthy();
    expect(screen.queryByRole("radio", { name: "委托生成脚本" })).toBeNull();
    expect(screen.queryByRole("button", { name: "导入所选材料" })).toBeNull();
    expect(screen.getByRole("region", { name: "统一材料导入" })).toBeTruthy();
    expect((screen.getByLabelText("选择生产材料") as HTMLInputElement).multiple).toBe(true);
  });

  it("主脚本导入后等待 Owner 明确开始制作", async () => {
    const user = userEvent.setup();
    const onStartProduction = vi.fn().mockResolvedValue(undefined);
    const readyEpisode: Episode = { ...reviewEpisode, id: "episode-input-ready", stage: "waiting_input", main_script_revision_id: "revision-script-1", title: "材料准备中" };

    render(<EpisodeDetail {...materialInputProps} artifacts={[]} blueprint={blueprint} episode={readyEpisode} isStartProductionPending={false} onStartProduction={onStartProduction} isTransitionPending={false} onTransition={vi.fn()} tasks={[]} transitions={[]} />);

    expect(screen.getByText("待开始制作")).toBeTruthy();
    expect(screen.getByText("材料已导入，等待 Owner 确认开始制作。")).toBeTruthy();
    expect(screen.queryByText("将此修订设为主脚本")).toBeNull();
    expect(screen.getByText("主脚本已确认。你可以继续添加补充材料；所有材料准备好后，点击下方按钮，Worker 才会开始制作。")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "导入所选材料" })).toBeNull();
    expect(screen.getByRole("button", { name: "材料准备完成，开始制作" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "材料准备完成，开始制作" }));
    expect(onStartProduction).toHaveBeenCalledWith(readyEpisode.id);
  });

  it("显示生产开始前的真实运行态阻塞", () => {
    const readyEpisode: Episode = { ...reviewEpisode, id: "episode-runtime-blocked", stage: "waiting_input", main_script_revision_id: "revision-script-1" };
    render(<EpisodeDetail {...materialInputProps} artifacts={[]} blueprint={blueprint} episode={readyEpisode} productionPreflight={{ version: "worker-preflight/v1", checks: [{ capability: "worker_runtime", check: "media_library", phase: "preflight", status: "unavailable", reason: "媒体库未挂载。", action: "contact_environment_admin", scope: "worker" }] }} isStartProductionPending={false} isTransitionPending={false} onTransition={vi.fn()} tasks={[]} transitions={[]} />);

    expect(screen.getByText("生产前运行态检查：未通过（1）")).toBeTruthy();
    expect(screen.getByText("资产目录不可用")).toBeTruthy();
    expect(screen.getByText("媒体库未挂载。")).toBeTruthy();
  });

  it("通过统一入口标注用途后按顺序导入脚本、图片、A-roll 和 B-roll", async () => {
    const user = userEvent.setup();
    const onImportMaterial = vi.fn().mockResolvedValue(undefined);
    const waitingEpisode: Episode = { ...reviewEpisode, id: "episode-materials", stage: "waiting_input", title: "首次准备材料" };

    render(<EpisodeDetail {...materialInputProps} artifacts={[]} blueprint={blueprint} episode={waitingEpisode} isStartProductionPending={false} onImportMaterial={onImportMaterial} onStartProduction={vi.fn()} isTransitionPending={false} onTransition={vi.fn()} tasks={[]} transitions={[]} />);

    const scriptFile = new File(["# 主脚本\n\n## 正文\n正文内容"], "script.md", { type: "text/markdown" });
    const imageFile = new File(["image"], "character.png", { type: "image/png" });
    const firstShot = new File(["video"], "shot-1.mp4", { type: "video/mp4" });
    const secondShot = new File(["video"], "shot-2.mp4", { type: "video/mp4" });
    const firstBroll = new File(["video"], "cutaway-1.mp4", { type: "video/mp4" });
    const secondBroll = new File(["video"], "cutaway-2.mp4", { type: "video/mp4" });
    await user.upload(screen.getByLabelText("选择生产材料"), [scriptFile, imageFile, firstShot, secondShot, firstBroll, secondBroll]);

    expect(screen.getAllByText("待标注", { selector: ".material-import-status" })).toHaveLength(6);
    expect(screen.getByText("shot-1.mp4")).toBeTruthy();
    expect(screen.getByText("shot-2.mp4")).toBeTruthy();
    await user.selectOptions(screen.getByLabelText("script.md 用途"), "main_script");
    await user.selectOptions(screen.getByLabelText("character.png 用途"), "visual_reference");
    await user.selectOptions(screen.getByLabelText("shot-1.mp4 用途"), "a_roll");
    await user.selectOptions(screen.getByLabelText("shot-2.mp4 用途"), "a_roll");
    await user.selectOptions(screen.getByLabelText("cutaway-1.mp4 用途"), "b_roll");
    await user.selectOptions(screen.getByLabelText("cutaway-2.mp4 用途"), "b_roll");
    expect(Array.from(screen.getByRole("list", { name: "材料导入状态" }).querySelectorAll(".material-import-group-heading strong")).map((heading) => heading.textContent)).toEqual(["脚本", "A-roll", "B-roll", "视觉参考"]);
    fireEvent.dragStart(screen.getByRole("button", { name: "拖动排序 shot-1.mp4" }));
    fireEvent.dragOver(screen.getByText("shot-2.mp4").closest("li") as HTMLElement);
    fireEvent.drop(screen.getByText("shot-2.mp4").closest("li") as HTMLElement);
    fireEvent.dragStart(screen.getByRole("button", { name: "拖动排序 cutaway-1.mp4" }));
    fireEvent.dragOver(screen.getByText("cutaway-2.mp4").closest("li") as HTMLElement);
    fireEvent.drop(screen.getByText("cutaway-2.mp4").closest("li") as HTMLElement);
    const confirmation = screen.getByRole("button", { name: "主脚本待确认：script.md" });
    expect(confirmation.closest("li")?.textContent).toContain("script.md");
    expect(confirmation.closest(".material-import-actions")?.children[0]).toBe(confirmation);
    expect(confirmation.getAttribute("data-tooltip")).toBe("确认这是本生产单的主脚本后，才能导入材料。");
    await user.click(confirmation);
    await user.click(screen.getByRole("button", { name: "导入所选材料" }));

    await waitFor(() => expect(onImportMaterial).toHaveBeenCalledTimes(6));
    expect(onImportMaterial).toHaveBeenNthCalledWith(1, expect.objectContaining({ isMainScript: true, materialPurpose: "main_script", materialType: "script", sourcePath: "script.md" }));
    expect(onImportMaterial).toHaveBeenNthCalledWith(2, expect.objectContaining({ isMainScript: false, materialPurpose: "visual_reference", materialType: "image", sourcePath: "character.png" }));
    expect(onImportMaterial).toHaveBeenNthCalledWith(3, expect.objectContaining({ materialPurpose: "a_roll", materialType: "video", logicalName: "a-shot-001.mp4", sourcePath: "shot-2.mp4" }));
    expect(onImportMaterial).toHaveBeenNthCalledWith(4, expect.objectContaining({ materialPurpose: "a_roll", materialType: "video", logicalName: "a-shot-002.mp4", sourcePath: "shot-1.mp4" }));
    expect(onImportMaterial).toHaveBeenNthCalledWith(5, expect.objectContaining({ materialPurpose: "b_roll", materialType: "video", logicalName: "b-shot-001.mp4", sourcePath: "cutaway-2.mp4" }));
    expect(onImportMaterial).toHaveBeenNthCalledWith(6, expect.objectContaining({ materialPurpose: "b_roll", materialType: "video", logicalName: "b-shot-002.mp4", sourcePath: "cutaway-1.mp4" }));
    expect(screen.queryByRole("list", { name: "材料导入状态" })).toBeNull();
  });

  it("将主脚本和补充脚本归入同一个脚本分组", async () => {
    const user = userEvent.setup();
    const waitingEpisode: Episode = { ...reviewEpisode, id: "episode-script-group", stage: "waiting_input" };

    render(<EpisodeDetail {...materialInputProps} artifacts={[]} blueprint={blueprint} episode={waitingEpisode} isTransitionPending={false} onTransition={vi.fn()} tasks={[]} transitions={[]} />);
    await user.upload(screen.getByLabelText("选择生产材料"), [
      new File(["# 主脚本\n\n## 正文\n正文"], "main.md", { type: "text/markdown" }),
      new File(["补充说明"], "notes.md", { type: "text/markdown" }),
    ]);
    await user.selectOptions(screen.getByLabelText("main.md 用途"), "main_script");
    await user.selectOptions(screen.getByLabelText("notes.md 用途"), "supplemental_script");

    const materialList = screen.getByRole("list", { name: "材料导入状态" });
    expect(Array.from(materialList.querySelectorAll(".material-import-group-heading strong")).map((heading) => heading.textContent)).toEqual(["脚本"]);
    expect(screen.getByText("main.md").closest(".material-import-group")).toBe(screen.getByText("notes.md").closest(".material-import-group"));
    expect(screen.getByText("main.md").closest("li")?.textContent).toContain("主脚本");
    expect(screen.getByText("notes.md").closest("li")?.textContent).toContain("补充脚本");
  });

  it("最多并发导入三个材料并在完成后立即补位", async () => {
    const user = userEvent.setup();
    const resolvers: Array<() => void> = [];
    const onImportMaterial = vi.fn(() => new Promise<void>((resolve) => resolvers.push(resolve)));
    const waitingEpisode: Episode = { ...reviewEpisode, id: "episode-concurrent-materials", stage: "waiting_input", main_script_revision_id: "revision-script-1" };

    render(<EpisodeDetail {...materialInputProps} artifacts={[]} blueprint={blueprint} episode={waitingEpisode} isStartProductionPending={false} onImportMaterial={onImportMaterial} onStartProduction={vi.fn()} isTransitionPending={false} onTransition={vi.fn()} tasks={[]} transitions={[]} />);

    const files = [1, 2, 3, 4].map((index) => new File(["video"], `clip-${index}.mp4`, { type: "video/mp4" }));
    await user.upload(screen.getByLabelText("选择生产材料"), files);
    for (const file of files) await user.selectOptions(screen.getByLabelText(`${file.name} 用途`), "b_roll");
    await user.click(screen.getByRole("button", { name: "导入所选材料" }));

    await waitFor(() => expect(onImportMaterial).toHaveBeenCalledTimes(3));
    expect(document.querySelectorAll(".material-import-list li.is-importing")).toHaveLength(3);
    expect(screen.getByText("clip-4.mp4").closest("li")?.className).toContain("is-queued");
    act(() => resolvers.shift()?.());
    await waitFor(() => expect(onImportMaterial).toHaveBeenCalledTimes(4));
    act(() => resolvers.splice(0).forEach((resolve) => resolve()));
    await waitFor(() => expect(screen.queryByRole("list", { name: "材料导入状态" })).toBeNull());
  });

  it("导入成功后保留材料卡，直到冻结材料刷新完成", async () => {
    const user = userEvent.setup();
    let finishRefresh!: () => void;
    const onRefresh = vi.fn(() => new Promise<void>((resolve) => { finishRefresh = resolve; }));
    const waitingEpisode: Episode = { ...reviewEpisode, id: "episode-import-transition", stage: "waiting_input", main_script_revision_id: "revision-script-1" };

    render(<EpisodeDetail {...materialInputProps} artifacts={[]} blueprint={blueprint} episode={waitingEpisode} isStartProductionPending={false} onImportMaterial={vi.fn().mockResolvedValue(undefined)} onRefresh={onRefresh} onStartProduction={vi.fn()} isTransitionPending={false} onTransition={vi.fn()} tasks={[]} transitions={[]} />);
    await user.upload(screen.getByLabelText("选择生产材料"), new File(["video"], "transition.mp4", { type: "video/mp4" }));
    await user.selectOptions(screen.getByLabelText("transition.mp4 用途"), "b_roll");
    await user.click(screen.getByRole("button", { name: "导入所选材料" }));

    const importingCard = screen.getByText("transition.mp4").closest("li");
    await waitFor(() => expect(importingCard?.className).toContain("is-import-progress"));
    expect(within(importingCard as HTMLElement).getByText("导入中…")).toBeTruthy();
    act(() => finishRefresh());
    await waitFor(() => expect(screen.queryByText("transition.mp4")).toBeNull());
  });

  it("可打开脚本模板，并点击材料名称预览", async () => {
    const user = userEvent.setup();
    const onNotify = vi.fn();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const waitingEpisode: Episode = { ...reviewEpisode, id: "episode-template-preview", stage: "waiting_input" };
    render(<EpisodeDetail {...materialInputProps} artifacts={[]} blueprint={blueprint} episode={waitingEpisode} isTransitionPending={false} onNotify={onNotify} onTransition={vi.fn()} tasks={[]} transitions={[]} />);

    await user.click(screen.getByRole("button", { name: "查看主脚本模板" }));
    expect(screen.getByRole("dialog", { name: "主脚本模板" }).textContent).toContain("## 正文");
    await user.click(screen.getByRole("button", { name: "复制模板" }));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("## 正文"));
    expect(onNotify).toHaveBeenCalledWith("主脚本模板已复制。");
    await user.click(screen.getByRole("button", { name: "关闭主脚本模板" }));

    await user.upload(screen.getByLabelText("选择生产材料"), new File(["# 标题\n\n## 正文\n内容"], "preview.md", { type: "text/markdown" }));
    await user.click(screen.getByRole("button", { name: "预览 preview.md" }));
    expect(await screen.findByRole("dialog", { name: "preview.md 材料预览" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "preview.md" })).toBeTruthy();
  });

  it("使用浏览器文件地址预览待导入视频", async () => {
    const user = userEvent.setup();
    const waitingEpisode: Episode = { ...reviewEpisode, id: "episode-draft-video-preview", stage: "waiting_input", main_script_revision_id: "revision-script-1" };
    render(<EpisodeDetail {...materialInputProps} artifacts={[]} blueprint={blueprint} episode={waitingEpisode} isTransitionPending={false} onTransition={vi.fn()} tasks={[]} transitions={[]} />);

    await user.upload(screen.getByLabelText("选择生产材料"), new File(["video"], "draft-preview.mp4", { type: "video/mp4" }));
    await user.click(screen.getByRole("button", { name: "预览 draft-preview.mp4" }));

    const dialog = await screen.findByRole("dialog", { name: "draft-preview.mp4 材料预览" });
    await waitFor(() => expect(dialog.querySelector("video")?.getAttribute("src")).toBe("blob:local-preview"));
    expect(screen.queryByText("本地产物路径无效。")).toBeNull();
  });

  it("在材料列表显示已确认、已导入和已绑定镜头状态", () => {
    const readyEpisode: Episode = { ...reviewEpisode, id: "episode-material-list", stage: "waiting_input", main_script_revision_id: "material-script" };
    const materials: MaterialRevision[] = [
      { created_at: "2026-08-26T00:00:00.000Z", created_by: "owner-1", episode_id: readyEpisode.id, file_size: 128, id: "material-script", is_main_script: true, material_purpose: "main_script", material_type: "script", mime_type: "text/markdown", revision_number: 1, sha256: "a".repeat(64), source_kind: "file", source_path: "script.md", storage_path: "episodes/episode-material-list/materials/script.md" },
      { created_at: "2026-08-26T00:00:00.000Z", created_by: "owner-1", episode_id: readyEpisode.id, file_size: 2048, id: "material-b-roll", is_main_script: false, material_purpose: "b_roll", material_type: "video", mime_type: "video/mp4", revision_number: 1, sha256: "b".repeat(64), source_kind: "file", source_path: "cutaway.mp4", storage_path: "episodes/episode-material-list/materials/b-shot-001.mp4" },
    ];
    const boundTask: Task = { ...blockedTask, episode_id: readyEpisode.id, id: "task-bound-material", input_snapshot: { manual_source: { material_revision_id: "material-b-roll" }, shot: { id: "shot-02" } }, status: "completed" };

    const failedReplacement: Task = { ...boundTask, id: "task-failed-material", input_snapshot: { manual_source: { material_revision_id: "material-b-roll" }, shot: { id: "shot-03" } }, status: "failed" };
    render(<EpisodeDetail {...materialInputProps} artifacts={[]} blueprint={blueprint} episode={readyEpisode} materialRevisions={materials} isStartProductionPending={false} isTransitionPending={false} onStartProduction={vi.fn()} onTransition={vi.fn()} tasks={[boundTask, failedReplacement]} transitions={[]} />);

    const materialList = screen.getByRole("list", { name: "材料导入状态" });
    expect(materialList.textContent).toContain("script.md");
    expect(materialList.textContent).toContain("已确认");
    expect(materialList.textContent).toContain("cutaway.mp4");
    expect(materialList.textContent).toContain("已绑定镜头 · shot-02");
    expect(materialList.querySelector(".material-type-icon.is-script .lucide-file-text")).toBeTruthy();
    expect(materialList.querySelector(".material-type-icon.is-video .lucide-film")).toBeTruthy();
    expect(screen.getByText("script.md").closest("li")?.className).toContain("is-frozen-material");
  });

  it("新 Episode 的上传阶段不要求整期声音选择", () => {
    const readyEpisode: Episode = { ...reviewEpisode, id: "episode-audio-source", stage: "waiting_input", main_script_revision_id: "revision-script-1" };
    const uploadedVideo: MaterialRevision = {
      created_at: "2026-08-23T00:00:00.000Z", created_by: "owner-1", episode_id: readyEpisode.id, file_size: 2048, id: "material-source-video", is_main_script: false,
      material_purpose: "a_roll", material_type: "video", mime_type: "video/mp4", revision_number: 1, sha256: "d".repeat(64), source_kind: "file", source_path: "presenter.mp4", storage_path: "episodes/episode-audio-source/materials/a-shot-001.mp4",
    };

    render(<EpisodeDetail {...materialInputProps} artifacts={[]} blueprint={blueprint} episode={readyEpisode} isStartProductionPending={false} materialRevisions={[uploadedVideo]} onStartProduction={vi.fn()} onTransition={vi.fn()} isTransitionPending={false} tasks={[]} transitions={[]} />);

    expect(screen.queryByText("上传视频的声音")).toBeNull();
    expect(screen.queryByRole("radio", { name: /使用 TTS 替代原声/ })).toBeNull();
    expect(screen.queryByRole("radio", { name: /保留上传视频原声/ })).toBeNull();
  });

  it("分镜批准后按整期 BGM、TTS、逐镜头声音的顺序显示并保存独立音效选择", async () => {
    const user = userEvent.setup();
    const approvedEpisode: Episode = { ...reviewEpisode, id: "episode-shot-workbench", stage: "storyboard_approved", tts_language_code: "zh-CN", tts_speaking_rate: 1.35, tts_voice: "episode-voice" };
    const storyboardArtifact: Artifact = { ...previewArtifact, artifact_type: "storyboard", episode_id: approvedEpisode.id, id: "artifact-shot-workbench", relative_path: "episodes/episode-shot-workbench/storyboard.json" };
    const reviewPackage = { artifact_id: storyboardArtifact.id, context_snapshot: {}, created_at: "2026-09-03T00:00:00.000Z", episode_id: approvedEpisode.id, id: "review-package-shot-workbench", invalidated_at: null, invalidated_reason: null, revision_number: 1, stage: "storyboard_review" as const, task_id: "task-shot-workbench", task_run_id: "run-shot-workbench" };
    const drafts: ShotPreparationDraft[] = [{ clip_segments: [], acoustic_alignment: { version: "acoustic-alignment/v1", status: "failed", method: "none", granularity: "none", inputVersion: "a".repeat(64), audioSha256: "b".repeat(64), textFingerprint: "c".repeat(64), provider: "volcengine_tts", model: "seed-tts-2.0", connectionVersionId: "connection-v1", wordCount: 0, cues: [], attempts: [], detail: "当前冻结的豆包 TTS 连接未注册自动字幕打轴能力。", generatedAt: "2026-09-03T00:00:00.000Z" }, audio_mode: "tts", audio_status: "running", confirmation_status: "pending", created_at: "2026-09-03T00:00:00.000Z", episode_id: approvedEpisode.id, id: "draft-shot-1", pending_tts_task_id: "task-pending-tts", review_package_id: reviewPackage.id, shot_id: "shot-1", subtitle_text: "第一镜字幕", subtitles_enabled: true, tts_speaking_rate: 1.35, tts_voice: "voice-a", updated_at: "2026-09-03T00:00:00.000Z", video_status: "pending", warning_decision: "accepted" }, { ...({} as ShotPreparationDraft), audio_mode: "tts", audio_status: "pending", confirmation_status: "pending", created_at: "2026-09-03T00:00:00.000Z", episode_id: approvedEpisode.id, id: "draft-shot-2", review_package_id: reviewPackage.id, shot_id: "shot-2", subtitle_text: "第二镜字幕", subtitles_enabled: true, tts_speaking_rate: 1.35, tts_voice: "voice-a", updated_at: "2026-09-03T00:00:00.000Z", video_status: "pending" }];
    let releaseMuteSave!: () => void;
    const muteSave = new Promise<void>((resolve) => { releaseMuteSave = resolve; });
    const onSave = vi.fn().mockImplementationOnce(() => muteSave).mockResolvedValue(undefined);
    const materials: MaterialRevision[] = [
      { created_at: "2026-09-03T00:00:00.000Z", created_by: "owner-1", episode_id: approvedEpisode.id, file_size: 2048, id: "material-shot-workbench-a", is_main_script: false, material_purpose: "a_roll", material_type: "video", mime_type: "video/mp4", revision_number: 1, sha256: "b".repeat(64), source_kind: "file", source_path: "presenter.mp4", storage_path: "episodes/episode-shot-workbench/materials/presenter.mp4" },
      { created_at: "2026-09-03T00:00:00.000Z", created_by: "owner-1", episode_id: approvedEpisode.id, file_size: 2048, id: "material-shot-workbench-b", is_main_script: false, material_purpose: "b_roll", material_type: "video", mime_type: "video/mp4", revision_number: 1, sha256: "c".repeat(64), source_kind: "file", source_path: "cutaway.mp4", storage_path: "episodes/episode-shot-workbench/materials/cutaway.mp4" },
      { created_at: "2026-09-03T00:00:00.000Z", created_by: "owner-1", episode_id: approvedEpisode.id, file_size: 4096, id: "material-shot-workbench-bgm", is_main_script: false, material_purpose: "background_music", material_type: "audio", mime_type: "audio/mpeg", revision_number: 1, sha256: "d".repeat(64), source_kind: "file", source_path: "opening.mp3", storage_path: "episodes/episode-shot-workbench/materials/opening.mp3" },
    ];
    const sfxTrack: AudioTrack = { created_at: "2026-09-03T00:00:00.000Z", cue_id: "sfx-1", duration_seconds: 1, episode_id: approvedEpisode.id, file_size: 1024, id: "track-sfx-1", relative_path: "episodes/episode-shot-workbench/audio/sfx-1.mp3", sha256: "e".repeat(64), source_artifact_id: "artifact-sfx-1", source_material_revision_id: null, source_review_package_id: reviewPackage.id, source_task_id: "task-sfx-1", start_seconds: 1, track_kind: "sfx" };
    const fetcher = vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => Promise.resolve(init?.method === "POST" && String(input).startsWith("/_local-artifact")
      ? localArtifactTicketResponse()
      : new Response(JSON.stringify({ version: "storyboard/v1", audioCues: [{ id: "bgm-1", kind: "bgm", description: "轻快科技感", searchQuery: "light tech", startSeconds: 0, durationSeconds: 5 }, { id: "sfx-1", kind: "sfx", description: "键盘敲击", searchQuery: "keyboard", startSeconds: 1, durationSeconds: 1 }], shots: [{ durationSeconds: 3, id: "shot-1", inputBasis: [{ relativePath: "script.md", sha256: "a".repeat(64) }], productionMethod: "人工", scriptSegment: "第一镜口播", shotType: "a_roll", targetSpec: "9:16" }, { durationSeconds: 2, id: "shot-2", inputBasis: [{ relativePath: "script.md", sha256: "a".repeat(64) }], productionMethod: "素材", scriptSegment: "第二镜口播", shotType: "b_roll", targetSpec: "9:16" }] }), { status: 200, headers: { "Content-Type": "application/json" } })));
    vi.stubGlobal("fetch", fetcher);
    const onSaveEpisodeTtsSettings = vi.fn().mockResolvedValue(undefined);
    const onSaveStoryboardAudioSelection = vi.fn().mockResolvedValue(undefined);

    const view = render(<EpisodeDetail {...materialInputProps} artifacts={[storyboardArtifact]} audioTracks={[sfxTrack]} blueprint={{ ...blueprint, policy: { narration: { executor: { adapter: "volcengine_tts", model: "seed-tts-2.0", provider: "volcengine_tts" }, voice: { language_code: "zh-CN", name: "voice-a", speaking_rate: 1.35 } } } }} episode={approvedEpisode} isTransitionPending={false} materialRevisions={materials} onSaveEpisodeTtsSettings={onSaveEpisodeTtsSettings} onSaveShotPreparationDraft={onSave} onSaveStoryboardAudioSelection={onSaveStoryboardAudioSelection} onTransition={vi.fn()} reviewPackages={[reviewPackage]} shotPreparationDrafts={drafts} tasks={[]} transitions={[]} />);

    await screen.findByRole("heading", { name: "分镜工作台" });
    const workbench = screen.getByRole("region", { name: "分镜工作台" });
    const confirmationOverview = screen.getByRole("navigation", { name: "镜头确认概览" });
    expect(within(confirmationOverview).getByText("已确认 0 / 2 个镜头")).toBeTruthy();
    expect(within(confirmationOverview).getByText("0/2 配置已保存（不代表完成）")).toBeTruthy();
    expect(within(confirmationOverview).getByText("! 2 个待补素材")).toBeTruthy();
    expect(within(confirmationOverview).getByText("! 2 个待对齐")).toBeTruthy();
    expect(within(confirmationOverview).getByText("… 1 个生成中")).toBeTruthy();
    expect(within(confirmationOverview).getByText("! 1 个存在偏离")).toBeTruthy();
    const shotOneSummary = screen.getByRole("button", { name: /^shot-1 A-roll/ });
    expect(within(shotOneSummary).getAllByText(/^(画面待处理|另 4 项)$/)).toHaveLength(2);
    expect(shotOneSummary.textContent).not.toContain("音频 ·");
    expect(screen.getByRole("button", { name: /音频 生成中；字幕 对齐失败/ })).toBe(shotOneSummary);
    const alignment = screen.getByRole("region", { name: "shot-1 声学对齐" });
    expect(within(alignment).queryByText("失败")).toBeNull();
    expect(within(alignment).getByText("未采用")).toBeTruthy();
    expect(within(alignment).getByText("无")).toBeTruthy();
    expect(within(alignment).getByText("aaaaaaaaaaaa")).toBeTruthy();
    expect(within(alignment).getByText("0")).toBeTruthy();
    expect((within(alignment).getByRole("button", { name: "安全重试对齐" }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(alignment).getByRole("button", { name: "使用本地 WhisperX" }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(alignment).getByRole("button", { name: "手动设置时序" }) as HTMLButtonElement).disabled).toBe(true);
    const materialsHeading = screen.getByRole("heading", { name: "准备生产材料" });
    expect(workbench.compareDocumentPosition(materialsHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const bgmSection = screen.getByRole("region", { name: "整期 BGM" });
    const ttsSection = screen.getByRole("region", { name: "本期 TTS 设置" });
    expect(bgmSection.compareDocumentPosition(ttsSection) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const ttsHeaderState = ttsSection.querySelector("header > .settings-state");
    const ttsActions = ttsSection.querySelector(".episode-tts-settings-actions");
    expect(ttsHeaderState?.textContent).toBe("已保存");
    expect(ttsActions).toBeTruthy();
    expect(within(ttsActions as HTMLElement).getByRole("button", { name: "试听本期 TTS" }).compareDocumentPosition(within(ttsActions as HTMLElement).getByRole("button", { name: "保存本期设置" })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(bgmSection).getByText("本期不配置 BGM。")).toBeTruthy();
    await user.click(within(bgmSection).getByRole("switch", { name: "使用 BGM" }));
    await user.selectOptions(screen.getByLabelText("整期 BGM 音频"), "material-shot-workbench-bgm");
    expect(screen.getByLabelText("shot-1 镜头音效")).toBeTruthy();
    expect(screen.queryByLabelText("shot-1 BGM 闪避")).toBeNull();
    expect(onSaveStoryboardAudioSelection).toHaveBeenCalledWith(expect.objectContaining({ audioKind: "bgm", cueId: null, materialRevisionId: "material-shot-workbench-bgm", targetKind: "episode" }));
    const bgmSelection: StoryboardAudioSelection = { audio_kind: "bgm", created_at: "2026-09-03T00:00:00.000Z", created_by: "owner-1", cue_id: null, episode_id: approvedEpisode.id, id: "bgm-selection", material_revision_id: "material-shot-workbench-bgm", review_package_id: reviewPackage.id, target_id: approvedEpisode.id, target_kind: "episode", updated_at: "2026-09-03T00:01:00.000Z" };
    view.rerender(<EpisodeDetail {...materialInputProps} artifacts={[storyboardArtifact]} audioTracks={[sfxTrack]} blueprint={{ ...blueprint, policy: { narration: { executor: { adapter: "volcengine_tts", model: "seed-tts-2.0", provider: "volcengine_tts" }, voice: { language_code: "zh-CN", name: "voice-a", speaking_rate: 1.35 } } } }} episode={approvedEpisode} isTransitionPending={false} materialRevisions={materials} onSaveEpisodeTtsSettings={onSaveEpisodeTtsSettings} onSaveShotPreparationDraft={onSave} onSaveStoryboardAudioSelection={onSaveStoryboardAudioSelection} onTransition={vi.fn()} reviewPackages={[reviewPackage]} shotPreparationDrafts={drafts} storyboardAudioSelections={[bgmSelection]} tasks={[]} transitions={[]} />);
    expect(screen.getByLabelText("shot-1 BGM 闪避")).toBeTruthy();
    await user.selectOptions(screen.getByLabelText("shot-1 BGM 闪避"), "strong");
    expect(screen.getByRole("button", { name: "在 OpenChatCut 中编辑" })).toBeTruthy();
    expect(screen.queryByText("先打开可编辑工作版本并完成剪辑；只有点击“生成审核视频”才会冻结当前版本并提交 Worker。")).toBeNull();
    expect(screen.getByText(/镜头已保存/).closest(".shot-workbench-completion-summary")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "生成审核视频" })).toBeNull();
    expect(screen.queryByRole("region", { name: "批量 TTS" })).toBeNull();
    expect(screen.queryByRole("button", { name: "生成准备片段" })).toBeNull();
    expect(screen.queryByText("Studio 前")).toBeNull();
    expect(screen.getByRole("switch", { name: /显示字幕/ })).toBeTruthy();
    expect(screen.queryByText(/历史音轨保留/)).toBeNull();
    expect((screen.getByLabelText("本期 TTS 声音") as HTMLSelectElement).value).toBe("episode-voice");
    expect((screen.getByLabelText("本期 TTS 语速") as HTMLInputElement).value).toBe("1.35");
    expect(screen.getByText("逐镜头口播共用这套语言、声音和语速。")).toBeTruthy();
    expect(screen.queryByLabelText("shot-1 TTS 声音")).toBeNull();
    expect(screen.queryByRole("button", { name: "shot-1 试听当前音色" })).toBeNull();
    expect(screen.queryByRole("button", { name: "shot-1 恢复默认声音" })).toBeNull();
    const restoreScriptButton = screen.getByRole("button", { name: "shot-1 恢复分镜文案" });
    expect(restoreScriptButton.textContent).toBe("恢复分镜文案");
    expect(restoreScriptButton.compareDocumentPosition(screen.getByRole("button", { name: "保存草稿" })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByText("恢复默认声音")).toBeNull();
    expect(screen.queryByText(/默认声音：voice-a/)).toBeNull();
    expect(screen.queryByText(/基准文案：/)).toBeNull();
    expect(screen.queryByText("上传视频的声音")).toBeNull();
    const playSfx = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    await user.selectOptions(screen.getByLabelText("shot-1 主声音"), "source");
    expect(screen.getByText("当前片段原声成为唯一主声音；多槽位复用也只播放一次。")).toBeTruthy();
    await user.selectOptions(screen.getByLabelText("shot-1 镜头音效"), "sfx-1");
    expect(onSaveStoryboardAudioSelection).toHaveBeenCalledWith(expect.objectContaining({ audioKind: "sfx", cueId: "sfx-1", targetId: "shot-1", targetKind: "shot" }));
    const previewSfx = screen.getByRole("button", { name: "shot-1 试听镜头音效" });
    await waitFor(() => expect((previewSfx as HTMLButtonElement).disabled).toBe(false));
    await user.click(previewSfx);
    expect(playSfx).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("switch", { name: "shot-1 静音" }));
    expect(screen.getByText("镜头不建立主声音轨；素材原声静音，BGM 不执行主声音闪避。")).toBeTruthy();
    expect(screen.getByText("保存中…", { selector: ".shot-mute-switch strong" })).toBeTruthy();
    expect(screen.queryByLabelText("shot-1 主声音")).toBeNull();
    expect(screen.queryByLabelText("shot-1 镜头音效")).toBeNull();
    expect(screen.queryByLabelText("shot-1 BGM 闪避")).toBeNull();
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ audioMode: "none", includeVideo: false, shotId: "shot-1" })));
    releaseMuteSave();
    await waitFor(() => expect((screen.getByRole("switch", { name: "shot-1 静音" }) as HTMLInputElement).disabled).toBe(false));
    await user.click(screen.getByRole("switch", { name: "shot-1 静音" }));
    await waitFor(() => expect((screen.getByLabelText("shot-1 主声音") as HTMLSelectElement).value).toBe("source"));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ audioMode: "source", includeVideo: false, shotId: "shot-1" })));
    await waitFor(() => expect((screen.getByRole("switch", { name: "shot-1 静音" }) as HTMLInputElement).disabled).toBe(false));
    await user.click(screen.getByRole("switch", { name: "shot-1 静音" }));
    await user.click(screen.getByRole("button", { name: "保存草稿" }));
    expect(screen.getByRole("region", { name: "shot-1 画面准备" })).toBeTruthy();
    await user.selectOptions(screen.getByLabelText("shot-1 当前原片"), "material-shot-workbench-a");
    await user.click(screen.getByRole("button", { name: "保存草稿" }));
    expect(screen.getByRole("button", { name: /^shot-1 A-roll/ }).getAttribute("aria-expanded")).toBe("true");
    expect(within(screen.getByRole("tablist", { name: "shot-1 镜头工作区" })).getByRole("tab", { name: "3 同步预览与确认" }).getAttribute("aria-selected")).toBe("true");
    await user.click(screen.getByRole("button", { name: /^shot-2 B-roll/ }));
    const waitingAlignment = screen.getByRole("region", { name: "shot-2 声学对齐" });
    expect(within(waitingAlignment).getByRole("status", { name: "等待音频后开始声学对齐" })).toBeTruthy();
    expect(within(waitingAlignment).queryByText("等待")).toBeNull();
    expect(screen.getByRole("button", { name: /shot-1 准备状态：画面 配置已保存，待生成/ })).toBeTruthy();
    await user.selectOptions(screen.getByLabelText("本期 TTS 声音"), "zh_female_vv_uranus_bigtts");
    await user.click(screen.getByRole("button", { name: "保存本期设置" }));
    expect(onSaveEpisodeTtsSettings).toHaveBeenCalledWith({ episodeId: approvedEpisode.id, languageCode: "zh-CN", speakingRate: 1.35, voice: "zh_female_vv_uranus_bigtts" });
    expect((screen.getByLabelText("shot-2 字幕正文模式") as HTMLSelectElement).value).toBe("follow_tts");
    expect((screen.getByLabelText("shot-2 字幕正文") as HTMLTextAreaElement).readOnly).toBe(true);
    await user.selectOptions(screen.getByLabelText("shot-2 字幕正文模式"), "independent");
    const subtitleField = screen.getByLabelText("shot-2 字幕正文");
    await user.clear(subtitleField);
    await user.type(subtitleField, "修改后的字幕");
    expect(screen.getByText("独立字幕与当前 TTS 正文不同，请在确认前核对两种表达。")).toBeTruthy();
    expect(within(confirmationOverview).getByText("已确认 0 / 2 个镜头")).toBeTruthy();
    expect(screen.getByRole("button", { name: /shot-2 准备状态：.*确认 输入已修改，待重新确认/ })).toBeTruthy();
    const shotTwoTabs = screen.getByRole("tablist", { name: "shot-2 镜头工作区" });
    const textTab = within(shotTwoTabs).getByRole("tab", { name: "1 文本与声音" });
    textTab.focus();
    await user.keyboard("{ArrowRight}");
    expect(textTab.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("alert").textContent).toContain("请先保存当前步骤草稿");
    await user.click(screen.getByRole("button", { name: "保存草稿" }));
    expect(within(shotTwoTabs).getByRole("tab", { name: "2 画面与构图" }).getAttribute("aria-selected")).toBe("true");
    await user.selectOptions(screen.getByLabelText("shot-2 当前原片"), "material-shot-workbench-b");
    const layoutSelect = screen.getByLabelText("shot-2 构图布局") as HTMLSelectElement;
    expect(Array.from(layoutSelect.options).map((option) => option.text)).toEqual(["全屏", "左右双屏", "上下双屏", "画中画", "四宫格"]);
    await user.selectOptions(layoutSelect, "2up-vertical");
    const shotTwoCard = shotTwoTabs.closest("article") as HTMLElement;
    const advancedSettings = shotTwoCard.querySelector(".shot-advanced-settings") as HTMLElement;
    expect(within(advancedSettings).queryByText("构图设置")).toBeNull();
    expect(within(advancedSettings).getByText("槽位与裁切")).toBeTruthy();
    expect(within(advancedSettings).getByText("基础衔接")).toBeTruthy();
    const captionSettings = shotTwoCard.querySelector(".shot-caption-space-disclosure") as HTMLDetailsElement;
    expect(captionSettings.open).toBe(false);
    expect(within(captionSettings).getByText(/标题安全区 · 9:16 · 字幕下方/)).toBeTruthy();
    await user.click(within(captionSettings).getByText("展开"));
    expect(captionSettings.open).toBe(true);
    expect(screen.getByLabelText("shot-2 上方片段")).toBeTruthy();
    expect(screen.getByLabelText("shot-2 下方片段")).toBeTruthy();
    expect((screen.getByLabelText("shot-2 上方片段") as HTMLSelectElement).value).toBe("0");
    expect((screen.getByLabelText("shot-2 下方片段") as HTMLSelectElement).value).toBe("0");
    await user.selectOptions(screen.getByLabelText("shot-2 下方填充方式"), "contain");
    await user.selectOptions(screen.getByLabelText("shot-2 下方主体焦点"), "1,1");
    expect(Array.from((screen.getByLabelText("shot-2 衔接方式") as HTMLSelectElement).options).map((option) => option.text)).toEqual(["硬切", "基础淡化", "交给 Studio"]);
    await user.selectOptions(screen.getByLabelText("shot-2 衔接方式"), "fade");
    await user.selectOptions(screen.getByLabelText("shot-2 字幕安全区"), "action-safe");
    await user.click(screen.getByRole("button", { name: "shot-2 字幕锚点 上方" }));
    await user.clear(screen.getByLabelText("shot-2 字幕最大行数"));
    await user.type(screen.getByLabelText("shot-2 字幕最大行数"), "1");
    await user.clear(screen.getByLabelText("shot-2 字幕每行最大字数"));
    await user.type(screen.getByLabelText("shot-2 字幕每行最大字数"), "12");
    expect(within(advancedSettings).queryByText(/已自定义|默认配置/)).toBeNull();
    expect(within(captionSettings).getByText(/动作安全区 · 9:16 · 字幕上方/)).toBeTruthy();
    expect(screen.getByRole("figure", { name: "shot-2 字幕安全框" })).toBeTruthy();
    const compositionPreview = screen.getByRole("figure", { name: "shot-2 构图示意" });
    expect(within(compositionPreview).getByText("非最终同步预览")).toBeTruthy();
    expect(within(compositionPreview).getByText("完整 · 焦点 100% / 100%")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "保存草稿" }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ audioMode: "tts", captionContract: { version: "shot-captions/v1", enabled: true, contentMode: "independent", text: "修改后的字幕", cues: [], spatial: { version: "shot-caption-space/v2", anchor: "top-center", safeArea: "action-safe", aspectRatio: "9:16", insets: { top: 0.05, right: 0.05, bottom: 0.12, left: 0.05 }, maxLines: 1, maxCharactersPerLine: 12 } }, clipSegments: [{ end_seconds: 1, start_seconds: 0 }], composition: { version: "shot-composition/v1", layout: "2up-vertical", slots: [{ id: "top", clipSegmentIndex: 0, fit: "cover", focalPoint: { x: 0.5, y: 0.5 } }, { id: "bottom", clipSegmentIndex: 0, fit: "contain", focalPoint: { x: 1, y: 1 } }] }, episodeId: approvedEpisode.id, materialRevisionId: "material-shot-workbench-b", reviewPackageId: reviewPackage.id, shotId: "shot-2", subtitleText: "修改后的字幕", subtitlesEnabled: true, transitionMode: "fade", ttsText: "第二镜字幕" }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ bgmDuckingLevel: "off" }));
    expect(within(shotTwoTabs).getByRole("tab", { name: "3 同步预览与确认" }).getAttribute("aria-selected")).toBe("true");
    expect(window.location.hash).toBe(`#storyboard-shot-${reviewPackage.id}-shot-2`);

    view.unmount();
    render(<EpisodeDetail {...materialInputProps} artifacts={[storyboardArtifact]} blueprint={{ ...blueprint, policy: { narration: { executor: { adapter: "volcengine_tts", model: "seed-tts-2.0", provider: "volcengine_tts" }, voice: { language_code: "zh-CN", name: "voice-a", speaking_rate: 1.35 } } } }} episode={approvedEpisode} isTransitionPending={false} materialRevisions={materials} onSaveEpisodeTtsSettings={onSaveEpisodeTtsSettings} onSaveShotPreparationDraft={onSave} onTransition={vi.fn()} reviewPackages={[reviewPackage]} shotPreparationDrafts={drafts} tasks={[]} transitions={[]} />);
    await screen.findByRole("heading", { name: "分镜工作台" });
    expect(screen.getByRole("button", { name: /^shot-1 A-roll/ }).getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByRole("button", { name: /^shot-2 B-roll/ }).getAttribute("aria-expanded")).toBe("true");
  });

  it("已生成字幕时序先只读查看，明确调整后才开放编辑", async () => {
    const user = userEvent.setup();
    const episode: Episode = { ...reviewEpisode, id: "episode-alignment-view", stage: "storyboard_approved", tts_language_code: "zh-CN", tts_speaking_rate: 1, tts_voice: "voice-a" };
    const storyboardArtifact: Artifact = { ...previewArtifact, artifact_type: "storyboard", episode_id: episode.id, id: "artifact-alignment-view", relative_path: "episodes/episode-alignment-view/storyboard.json" };
    const reviewPackage = { artifact_id: storyboardArtifact.id, context_snapshot: {}, created_at: "2026-09-11T00:00:00.000Z", episode_id: episode.id, id: "review-alignment-view", invalidated_at: null, invalidated_reason: null, revision_number: 1, stage: "storyboard_review" as const, task_id: "task-storyboard", task_run_id: "run-storyboard" };
    const cue = { id: "phrase-1", text: "第一批把电脑交给豆包的人，", startMs: 272, endMs: 2380, confidence: 0.91 };
    const track: AudioTrack = { created_at: "2026-09-11T00:00:00.000Z", cue_id: "shot-1", duration_seconds: 3.84, episode_id: episode.id, file_size: 1024, id: "track-alignment-view", relative_path: "episodes/episode-alignment-view/audio/shot-1.mp3", sha256: "b".repeat(64), source_artifact_id: "artifact-narration", source_material_revision_id: null, source_review_package_id: reviewPackage.id, source_task_id: "task-narration", start_seconds: 0, track_kind: "narration" };
    const draft = { acoustic_alignment: { version: "acoustic-alignment/v1", status: "completed", method: "local_whisperx", granularity: "phrase", inputVersion: "a".repeat(64), audioSha256: track.sha256, textFingerprint: "c".repeat(64), provider: "whisperx", model: "large-v3", connectionVersionId: null, wordCount: 1, cues: [cue], attempts: [], detail: "本地 WhisperX 对齐已完成。", generatedAt: "2026-09-11T00:00:00.000Z" }, audio_mode: "tts", audio_status: "ready", caption_contract: { version: "shot-captions/v1", enabled: true, contentMode: "independent", text: cue.text, cues: [cue], spatial: { version: "shot-caption-space/v1", anchor: "bottom-center", safeArea: "title-safe", maxLines: 2, maxCharactersPerLine: 18 } }, clip_segments: [], confirmation_status: "pending", created_at: "2026-09-11T00:00:00.000Z", current_audio_track_id: track.id, episode_id: episode.id, id: "draft-alignment-view", review_package_id: reviewPackage.id, shot_id: "shot-1", subtitle_text: cue.text, subtitles_enabled: true, tts_speaking_rate: 1, tts_text: cue.text, tts_voice: "voice-a", updated_at: "2026-09-11T00:00:00.000Z", video_status: "pending" } as unknown as ShotPreparationDraft;
    vi.stubGlobal("fetch", vi.fn((_input: RequestInfo | URL, init?: RequestInit) => Promise.resolve(init?.method === "POST"
      ? localArtifactTicketResponse()
      : new Response(JSON.stringify({ version: "storyboard/v1", audioCues: [], shots: [{ durationSeconds: 3.84, id: "shot-1", inputBasis: [{ relativePath: "script.md", sha256: "a".repeat(64) }], productionMethod: "人工", scriptSegment: cue.text, shotType: "a_roll", targetSpec: "9:16" }] }), { status: 200, headers: { "Content-Type": "application/json" } }))));

    render(<EpisodeDetail {...materialInputProps} artifacts={[storyboardArtifact]} audioTracks={[track]} blueprint={blueprint} episode={episode} isTransitionPending={false} onTransition={vi.fn()} reviewPackages={[reviewPackage]} shotPreparationDrafts={[draft]} tasks={[]} transitions={[]} />);

    const alignment = await screen.findByRole("region", { name: "shot-1 声学对齐" });
    const viewTiming = within(alignment).getByRole("button", { name: "查看时序" });
    expect(viewTiming.getAttribute("aria-expanded")).toBe("false");
    await user.click(viewTiming);
    expect(viewTiming.getAttribute("aria-expanded")).toBe("true");
    const timing = within(alignment).getByRole("region", { name: "shot-1 字幕时序" });
    const startInput = within(timing).getByLabelText("开始 ms") as HTMLInputElement;
    expect(startInput.readOnly).toBe(true);
    expect(startInput.value).toBe("272");
    expect(within(timing).queryByRole("button", { name: "保存时序调整" })).toBeNull();
    await user.click(within(timing).getByRole("button", { name: "调整时序" }));
    expect(startInput.readOnly).toBe(false);
    await user.clear(startInput);
    await user.type(startInput, "120");
    expect(within(timing).getByRole("button", { name: "保存时序调整" })).toBeTruthy();
    await user.click(within(timing).getByRole("button", { name: "取消调整" }));
    expect(startInput.readOnly).toBe(true);
    expect(startInput.value).toBe("272");
  });

  it("审核阶段可返回可编辑镜头工作台，且保留当前 QC 证据", async () => {
    const user = userEvent.setup();
    const qcEpisode: Episode = { ...reviewEpisode, id: "episode-return-workbench", stage: "qc_review", tts_language_code: "zh-CN", tts_speaking_rate: 1.2, tts_voice: "voice-a" };
    const storyboardArtifact: Artifact = { ...previewArtifact, artifact_type: "storyboard", episode_id: qcEpisode.id, id: "artifact-return-storyboard", relative_path: "episodes/episode-return-workbench/storyboard.json" };
    const qcArtifact: Artifact = { ...videoArtifact, episode_id: qcEpisode.id, id: "artifact-return-qc", relative_path: "episodes/episode-return-workbench/review-render/v2/video.mp4" };
    const storyboardPackage = { artifact_id: storyboardArtifact.id, context_snapshot: {}, created_at: "2026-09-09T00:00:00.000Z", episode_id: qcEpisode.id, id: "review-return-storyboard", invalidated_at: null, invalidated_reason: null, revision_number: 1, stage: "storyboard_review" as const, task_id: "task-return-storyboard", task_run_id: "run-return-storyboard" };
    const qcPackage = { ...storyboardPackage, artifact_id: qcArtifact.id, context_snapshot: { pre_render_review_package_id: "review-return-snapshot", project_relative_path: "episodes/episode-return-workbench/openchatcut-frozen/revision-2/project.json", project_revision: "revision-2", review_kind: "openchatcut_review_render", technical_evidence: { checks: [{ detail: "视频可解码", name: "decode" }] } }, id: "review-return-qc", revision_number: 2, stage: "qc_review" as const, task_id: "task-return-qc", task_run_id: "run-return-qc" };
    const syncFingerprint = "d".repeat(32);
    const syncProxy: Artifact = { ...videoArtifact, artifact_type: "shot_preview_proxy", episode_id: qcEpisode.id, id: "artifact-return-sync-proxy", relative_path: "episodes/episode-return-workbench/shot-previews/shot-1/proxy.mp4", producer_task_id: "task-return-sync" };
    const syncProject: Artifact = { ...previewArtifact, artifact_type: "shot_editable_project", episode_id: qcEpisode.id, id: "artifact-return-sync-project", relative_path: "episodes/episode-return-workbench/shot-previews/shot-1/project.json", producer_task_id: "task-return-sync" };
    const syncTask: Task = { ...blockedTask, episode_id: qcEpisode.id, id: "task-return-sync", status: "completed", task_type: "generate_shot_sync_preview" };
    const draft = { acoustic_alignment: { version: "acoustic-alignment/v1", status: "completed", method: "manual", granularity: "phrase", inputVersion: "a".repeat(64), audioSha256: "b".repeat(64), textFingerprint: "c".repeat(64), provider: "owner", model: "manual", connectionVersionId: null, wordCount: 1, cues: [{ id: "cue-1", text: "可继续修改的字幕", startMs: 0, endMs: 3000 }], attempts: [], detail: "人工时序", generatedAt: "2026-09-09T00:00:00.000Z" }, audio_mode: "none", audio_status: "ready", caption_contract: { version: "shot-captions/v1", enabled: true, contentMode: "independent", text: "可继续修改的字幕", cues: [{ id: "cue-1", text: "可继续修改的字幕", startMs: 0, endMs: 3000 }], spatial: { version: "shot-caption-space/v1", anchor: "bottom-center", safeArea: "title-safe", maxLines: 2, maxCharactersPerLine: 18 } }, clip_segments: [{ end_seconds: 3, start_seconds: 0 }], confirmation_status: "confirmed", created_at: "2026-09-09T00:00:00.000Z", current_preview_artifact_id: syncProxy.id, current_preview_input_fingerprint: syncFingerprint, current_preview_project_artifact_id: syncProject.id, current_preview_task_id: syncTask.id, episode_id: qcEpisode.id, frozen_at: "2026-09-09T00:01:00.000Z", id: "draft-return-shot", input_fingerprint: "fingerprint", preparation_input_fingerprint: syncFingerprint, preview_status: "ready", review_package_id: storyboardPackage.id, selected_material_revision_id: "material-return", shot_id: "shot-1", subtitle_text: "可继续修改的字幕", subtitles_enabled: true, transition_mode: "cut", updated_at: "2026-09-09T00:01:00.000Z", video_duration_seconds: 3, video_status: "ready" } as unknown as ShotPreparationDraft;
    draft.preparation_contract_status = "current";
    const material = { created_at: "2026-09-09T00:00:00.000Z", created_by: "owner-1", episode_id: qcEpisode.id, file_size: 2048, id: "material-return", is_main_script: false, material_purpose: "a_roll", material_type: "video", mime_type: "video/mp4", revision_number: 1, sha256: "b".repeat(64), source_kind: "file", source_path: "presenter.mp4", storage_path: "episodes/episode-return-workbench/materials/presenter.mp4" } as MaterialRevision;
    const replacementWarning = { fileSize: 1024, relativePath: "episodes/episode-return-workbench/openchatcut-work/current/project.json", sha256: "c".repeat(64), replacementWarning: { code: "openchatcut_workspace_replacement", modifiedScopes: ["字幕", "音量与音轨"], studioHasChanges: true } } as const;
    const onOpenStudio = vi.fn()
      .mockResolvedValueOnce(replacementWarning)
      .mockResolvedValueOnce(replacementWarning)
      .mockResolvedValue({ fileSize: 1024, relativePath: "episodes/episode-return-workbench/openchatcut-work/current/project.json", sha256: "d".repeat(64) });
    const onGenerateShotReviewVideo = vi.fn().mockResolvedValue(undefined);
    const onGenerateShotSyncPreview = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("fetch", vi.fn().mockImplementation((input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("_local-artifact-ticket")) return Promise.resolve(Response.json({ url: "/_local-artifact?ticket=return-qc" }));
      if (url.includes("shot-previews%2Fshot-1%2Fproxy.mp4")) return Promise.resolve(Response.json({ url: "/_local-artifact?ticket=return-sync-proxy" }));
      return Promise.resolve(new Response(JSON.stringify({ version: "storyboard/v1", audioCues: [], shots: [{ durationSeconds: 3, id: "shot-1", inputBasis: [{ relativePath: "script.md", sha256: "a".repeat(64) }], productionMethod: "人工", scriptSegment: "第一镜口播", shotType: "a_roll", targetSpec: "9:16" }] }), { status: 200, headers: { "Content-Type": "application/json" } }));
    }));

    const view = render(<EpisodeDetail {...materialInputProps} artifacts={[storyboardArtifact, qcArtifact, syncProxy, syncProject]} blueprint={blueprint} episode={qcEpisode} isTransitionPending={false} materialRevisions={[material]} onGenerateShotReviewVideo={onGenerateShotReviewVideo} onGenerateShotSyncPreview={onGenerateShotSyncPreview} onOpenStudio={onOpenStudio} onTransition={vi.fn()} reviewPackages={[storyboardPackage, qcPackage]} shotPreparationDrafts={[draft]} tasks={[syncTask]} transitions={[]} />);

    expect(screen.getByRole("heading", { name: /OpenChatCut 审核渲染/ })).toBeTruthy();
    const technicalEvidence = screen.getByText("工程与 QC 技术信息").closest("details");
    expect(technicalEvidence?.hasAttribute("open")).toBe(false);
    await user.click(screen.getByText("工程与 QC 技术信息"));
    expect(technicalEvidence?.hasAttribute("open")).toBe(true);
    expect(screen.queryByRole("region", { name: "分镜工作台" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "返回镜头工作台修改" }));
    await screen.findByRole("region", { name: "分镜工作台" });
    expect(screen.getByText("已确认 1 / 1 个镜头")).toBeTruthy();
    expect(screen.getByRole("button", { name: /shot-1 准备状态：.*同步预览 预览有效/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /确认 Owner 已确认/ })).toBeTruthy();
    await user.click(within(screen.getByRole("region", { name: "OpenChatCut 审核视频" })).getByRole("button", { name: "在 OpenChatCut 中编辑" }));
    expect(screen.getByRole("dialog", { name: "重新生成 OpenChatCut 工程" })).toBeTruthy();
    expect(screen.getByRole("dialog", { name: "重新生成 OpenChatCut 工程" }).textContent).toContain("尚未采纳的 Studio 修改：字幕、音量与音轨");
    expect(screen.getByText("Studio 修改不会自动写回生产单要求或镜头准备草稿。")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "生成审核视频" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "取消，保留工作版本" }));
    expect(screen.queryByRole("dialog", { name: "重新生成 OpenChatCut 工程" })).toBeNull();
    await user.click(within(screen.getByRole("region", { name: "OpenChatCut 审核视频" })).getByRole("button", { name: "在 OpenChatCut 中编辑" }));
    await user.click(screen.getByRole("button", { name: "覆盖并重新生成" }));
    await waitFor(() => expect(onOpenStudio).toHaveBeenLastCalledWith(qcEpisode.id, storyboardArtifact.relative_path, expect.any(Object), true));
    expect(screen.getByRole("button", { name: "生成审核视频" })).toBeTruthy();
    await user.click(within(screen.getByRole("tablist", { name: "shot-1 镜头工作区" })).getByRole("tab", { name: "3 同步预览与确认" }));
    expect(await screen.findByLabelText("shot_preview_proxy 产物预览")).toBeTruthy();
    const previewHeader = screen.getByRole("heading", { name: "同步预览与确认" }).closest("header");
    expect(within(previewHeader as HTMLElement).queryByText("预览有效")).toBeNull();
    expect(screen.queryByText("当前代理：与已保存输入一致，可用于确认。")).toBeNull();
    expect(within(previewHeader as HTMLElement).queryByRole("button", { name: "打开可编辑工程" })).toBeNull();
    const previewFacts = document.querySelector(".shot-preview-facts");
    expect(within(previewFacts as HTMLElement).getByRole("button", { name: "打开可编辑工程" })).toBeTruthy();
    expect(within(previewFacts as HTMLElement).getByTitle(syncProject.relative_path).classList.contains("shot-preview-project-path")).toBe(true);
    expect(within(screen.getByRole("button", { name: "重新生成同步预览" }).parentElement as HTMLElement).queryByRole("button", { name: "打开可编辑工程" })).toBeNull();
    const checklistDisclosure = screen.getByText("逐镜头要求对照").closest("details");
    expect(checklistDisclosure?.hasAttribute("open")).toBe(true);
    await user.click(screen.getByText("逐镜头要求对照"));
    expect(checklistDisclosure?.hasAttribute("open")).toBe(false);
    await user.click(screen.getByText("逐镜头要求对照"));
    expect(checklistDisclosure?.hasAttribute("open")).toBe(true);
    const comparison = screen.getByRole("table", { name: "逐镜头要求对照" });
    expect(within(comparison).getAllByRole("rowheader").map((cell) => cell.textContent)).toEqual(["时长", "构图", "素材原声", "字幕内容", "字幕时序", "安全区", "音频版本", "衔接", "偏离", "可编辑工程"]);
    expect(within(comparison).getByText("以当前画面为准").querySelector("input, textarea, select")).toBeNull();
    const durationActions = within(comparison).getByRole("button", { name: "调整片段" }).parentElement!;
    expect(durationActions.firstElementChild?.textContent).toBe("调整片段");
    expect(durationActions.lastElementChild?.textContent).toBe("通过");
    await user.click(within(comparison).getByRole("button", { name: "调整构图" }));
    expect(within(screen.getByRole("tablist", { name: "shot-1 镜头工作区" })).getByRole("tab", { name: "2 画面与构图" }).getAttribute("aria-selected")).toBe("true");
    await waitFor(() => expect(document.activeElement?.getAttribute("data-shot-focus")).toBe("composition"));
    await user.click(within(screen.getByRole("tablist", { name: "shot-1 镜头工作区" })).getByRole("tab", { name: "3 同步预览与确认" }));
    expect((screen.getByRole("button", { name: "Owner 已确认" }) as HTMLButtonElement).disabled).toBe(false);
    await user.click(screen.getByRole("button", { name: "重新生成同步预览" }));
    expect(onGenerateShotSyncPreview).toHaveBeenCalledWith({ episodeId: qcEpisode.id, reviewPackageId: storyboardPackage.id, shotId: "shot-1" });
    const subtitleRow = within(comparison).getByRole("row", { name: /字幕内容/ });
    expect(within(subtitleRow).queryByRole("textbox")).toBeNull();
    await user.click(within(subtitleRow).getByRole("button", { name: "调整字幕" }));
    await user.click(within(screen.getByRole("tablist", { name: "shot-1 镜头工作区" })).getByRole("tab", { name: "1 文本与声音" }));
    await user.type(screen.getByLabelText("shot-1 字幕正文"), "（修订）");
    expect(screen.getByText("已确认 0 / 1 个镜头")).toBeTruthy();
    expect(screen.getByText("! 1 个预览过期")).toBeTruthy();
    expect(screen.getByRole("button", { name: /shot-1 准备状态：.*同步预览 预览过期/ })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "保存草稿" }));
    await user.click(screen.getByRole("button", { name: "保存草稿" }));
    expect(within(screen.getByRole("tablist", { name: "shot-1 镜头工作区" })).getByRole("tab", { name: "3 同步预览与确认" }).getAttribute("aria-selected")).toBe("true");
    expect(within(screen.getByRole("table", { name: "逐镜头要求对照" })).queryByRole("textbox")).toBeNull();
    expect(screen.getByRole("heading", { name: /OpenChatCut 审核渲染/ })).toBeTruthy();
    await user.click(screen.getByLabelText("shot-1 更多操作"));
    expect((screen.getByRole("button", { name: "新增镜头" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "生成审核视频" }) as HTMLButtonElement).disabled).toBe(false);
    expect((within(screen.getByRole("region", { name: "OpenChatCut 审核视频" })).getByRole("button", { name: "重新打开 OpenChatCut 编辑" }) as HTMLButtonElement).disabled).toBe(false);
    expect(onOpenStudio).toHaveBeenCalledTimes(3);
    expect(onGenerateShotReviewVideo).not.toHaveBeenCalled();

    const failedDraft = { ...draft, preview_error: "Owner action is required before retrying this task.", preview_status: "failed" as const, updated_at: "2026-09-09T00:01:30.000Z" };
    view.rerender(<EpisodeDetail {...materialInputProps} artifacts={[storyboardArtifact, qcArtifact, syncProxy, syncProject]} blueprint={blueprint} episode={qcEpisode} isTransitionPending={false} materialRevisions={[material]} onGenerateShotReviewVideo={onGenerateShotReviewVideo} onGenerateShotSyncPreview={onGenerateShotSyncPreview} onOpenStudio={onOpenStudio} onTransition={vi.fn()} reviewPackages={[storyboardPackage, qcPackage]} shotPreparationDrafts={[failedDraft]} tasks={[syncTask]} transitions={[]} />);
    expect(await screen.findByText(/同步预览生成失败，需要人工处理后才能重试/)).toBeTruthy();
    expect(screen.queryByText(/Owner action is required/)).toBeNull();

    const unreadyDraft = { ...draft, selected_material_revision_id: null, updated_at: "2026-09-09T00:02:00.000Z" };
    view.rerender(<EpisodeDetail {...materialInputProps} artifacts={[storyboardArtifact, qcArtifact, syncProxy, syncProject]} blueprint={blueprint} episode={qcEpisode} isTransitionPending={false} materialRevisions={[material]} onGenerateShotReviewVideo={onGenerateShotReviewVideo} onOpenStudio={onOpenStudio} onTransition={vi.fn()} reviewPackages={[storyboardPackage, qcPackage]} shotPreparationDrafts={[unreadyDraft]} tasks={[syncTask]} transitions={[]} />);
    await waitFor(() => expect(screen.queryByRole("button", { name: "生成审核视频" })).toBeNull());

    const legacyDraft = { ...draft, preparation_contract_status: "needs_upgrade" as const, updated_at: "2026-09-09T00:03:00.000Z" };
    view.rerender(<EpisodeDetail {...materialInputProps} artifacts={[storyboardArtifact, qcArtifact, syncProxy, syncProject]} blueprint={blueprint} episode={qcEpisode} isTransitionPending={false} materialRevisions={[material]} onGenerateShotReviewVideo={onGenerateShotReviewVideo} onOpenStudio={onOpenStudio} onTransition={vi.fn()} reviewPackages={[storyboardPackage, qcPackage]} shotPreparationDrafts={[legacyDraft]} tasks={[syncTask]} transitions={[]} />);
    expect(await screen.findByText(/这是旧版镜头记录/)).toBeTruthy();
    expect(screen.getByText("已确认 0 / 1 个镜头")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Owner 已确认" })).toBeNull();

    view.unmount();
    const productionEpisode = { ...qcEpisode, stage: "production_ready" as const };
    render(<EpisodeDetail {...materialInputProps} artifacts={[storyboardArtifact]} blueprint={blueprint} episode={productionEpisode} isTransitionPending={false} materialRevisions={[material]} onOpenStudio={onOpenStudio} onTransition={vi.fn()} reviewPackages={[storyboardPackage]} shotPreparationDrafts={[draft]} tasks={[]} transitions={[]} />);
    await user.click(screen.getByRole("button", { name: "返回镜头工作台修改" }));
    await screen.findByRole("region", { name: "分镜工作台" });
    expect((screen.getByLabelText("shot-1 字幕正文") as HTMLTextAreaElement).disabled).toBe(false);
  });

  it("结构修订留在工作台后台应用，并在应用期间阻止重复提交", async () => {
    const user = userEvent.setup();
    const approvedEpisode: Episode = { ...reviewEpisode, id: "episode-shot-structure-ui", stage: "storyboard_approved" };
    const storyboardArtifact: Artifact = { ...previewArtifact, artifact_type: "storyboard", episode_id: approvedEpisode.id, id: "artifact-shot-structure-ui", relative_path: "episodes/episode-shot-structure-ui/storyboard.json" };
    const reviewPackage = { artifact_id: storyboardArtifact.id, context_snapshot: {}, created_at: "2026-09-03T00:00:00.000Z", episode_id: approvedEpisode.id, id: "review-package-shot-structure-ui", invalidated_at: null, invalidated_reason: null, revision_number: 1, stage: "storyboard_review" as const, task_id: "task-shot-structure-ui", task_run_id: "run-shot-structure-ui" };
    const onRequestShotStructureRevision = vi.fn().mockResolvedValue(undefined);
    const shots = ["shot-1", "shot-2", "shot-3"].map((id, index) => ({ durationSeconds: 3, id, inputBasis: [{ relativePath: "script.md", sha256: "a".repeat(64) }], productionMethod: "人工", scriptSegment: `第${index + 1}镜口播`, shotType: "a_roll" as const, targetSpec: "9:16" }));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ version: "storyboard/v1", audioCues: [], shots }), { status: 200, headers: { "Content-Type": "application/json" } })));

    const view = render(<EpisodeDetail {...materialInputProps} artifacts={[storyboardArtifact]} blueprint={blueprint} episode={approvedEpisode} isTransitionPending={false} onRequestShotStructureRevision={onRequestShotStructureRevision} onTransition={vi.fn()} reviewPackages={[reviewPackage]} tasks={[]} transitions={[]} />);

    await screen.findByRole("heading", { name: "分镜工作台" });
    const openOperation = async (shotId: string, label: string) => {
      await user.click(screen.getByLabelText(`${shotId} 更多操作`));
      const menu = screen.getByLabelText(`${shotId} 镜头设置`);
      await user.click(within(menu).getByRole("button", { name: label }));
      return screen.getByRole("dialog", { name: `${shotId} ${label}` });
    };
    const firstDialog = await openOperation("shot-1", "合并镜头");
    const firstMergeTarget = screen.getByLabelText("合并对象") as HTMLSelectElement;
    expect([...firstMergeTarget.options].map((option) => option.value)).toEqual(["", "shot-2"]);
    await user.click(within(firstDialog).getByRole("button", { name: "关闭镜头设置" }));

    for (const label of ["新增镜头", "删除镜头", "拆分镜头", "调整顺序", "修改镜头类型"]) {
      const dialog = await openOperation("shot-2", label);
      await user.click(within(dialog).getByRole("button", { name: "关闭镜头设置" }));
    }

    const middleDialog = await openOperation("shot-2", "合并镜头");
    const middleMergeTarget = screen.getByLabelText("合并对象") as HTMLSelectElement;
    expect([...middleMergeTarget.options].map((option) => option.value)).toEqual(["", "shot-1", "shot-3"]);
    await user.selectOptions(middleMergeTarget, "shot-1");
    await user.type(within(middleDialog).getByLabelText("修订原因"), "合并相邻镜头。");
    await user.click(within(middleDialog).getByRole("button", { name: "提交分镜结构修订" }));
    await waitFor(() => expect(onRequestShotStructureRevision).toHaveBeenCalledWith(expect.objectContaining({ operation: expect.objectContaining({ kind: "merge", shotIds: ["shot-1", "shot-2"] }) })));
    expect(screen.getByText("正在后台应用“合并镜头”；完成后会在此处切换到新版分镜。")).toBeTruthy();
    await user.click(screen.getByLabelText("shot-2 更多操作"));
    const openMenu = screen.getByLabelText("shot-2 镜头设置");
    expect(within(openMenu).getAllByLabelText("镜头调整说明：提交后将创建修订任务；新版完成前保留当前分镜。")).toHaveLength(1);
    expect(screen.queryByText("提交后将创建修订任务；新版完成前保留当前分镜。")).toBeNull();
    expect(screen.queryByText("使用本期 TTS 设置")).toBeNull();
    expect((within(openMenu).getByRole("button", { name: "新增镜头" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole("dialog", { name: "shot-2 合并镜头" })).toBeNull();
    const oldFailedTask: Task = { ...blockedTask, created_at: "2026-09-03T00:00:00.000Z", episode_id: approvedEpisode.id, id: "task-old-failed-structure", input_snapshot: { storyboard_revision: { base_review_package_id: reviewPackage.id } }, status: "failed", task_type: "draft_storyboard_revision" };
    const newerRunningTask: Task = { ...oldFailedTask, created_at: "2026-09-03T00:01:00.000Z", id: "task-new-running-structure", status: "running" };
    view.rerender(<EpisodeDetail {...materialInputProps} artifacts={[storyboardArtifact]} blueprint={blueprint} episode={approvedEpisode} isTransitionPending={false} onRequestShotStructureRevision={onRequestShotStructureRevision} onTransition={vi.fn()} reviewPackages={[reviewPackage]} tasks={[oldFailedTask, newerRunningTask]} transitions={[]} />);
    expect(screen.getByText("正在后台应用“合并镜头”；完成后会在此处切换到新版分镜。")).toBeTruthy();
    expect(screen.queryByText("结构修改未能应用；旧版分镜和已保存配置保持不变。")).toBeNull();
  });

  it("删除镜头后在工作台切换新版，并打开下一镜", async () => {
    const user = userEvent.setup();
    const approvedEpisode: Episode = { ...reviewEpisode, id: "episode-shot-structure-switch", stage: "storyboard_approved" };
    const storyboardArtifact = { ...previewArtifact, artifact_type: "storyboard" as const, episode_id: approvedEpisode.id, id: "artifact-shot-structure-switch", relative_path: "episodes/episode-shot-structure-switch/storyboard.json" };
    const revisedArtifact = { ...storyboardArtifact, id: "artifact-shot-structure-switch-v2", relative_path: "episodes/episode-shot-structure-switch/storyboard-v2.json", sha256: "b".repeat(64) };
    const reviewPackage = { artifact_id: storyboardArtifact.id, context_snapshot: {}, created_at: "2026-09-03T00:00:00.000Z", episode_id: approvedEpisode.id, id: "review-package-shot-structure-switch", invalidated_at: null, invalidated_reason: null, revision_number: 1, stage: "storyboard_review" as const, task_id: "task-shot-structure-switch", task_run_id: "run-shot-structure-switch" };
    const revisedPackage = { ...reviewPackage, artifact_id: revisedArtifact.id, id: "review-package-shot-structure-switch-v2", revision_number: 2, task_id: "task-shot-structure-switch-v2" };
    const shots = ["shot-1", "shot-2", "shot-3"].map((id) => ({ durationSeconds: 3, id, inputBasis: [{ relativePath: "script.md", sha256: "a".repeat(64) }], productionMethod: "人工", scriptSegment: `${id} 文案`, shotType: "a_roll" as const, targetSpec: "9:16" }));
    vi.stubGlobal("fetch", vi.fn().mockImplementation((source: string) => Promise.resolve(new Response(JSON.stringify({ version: "storyboard/v1", audioCues: [], shots: source.includes("storyboard-v2") ? shots.filter((shot) => shot.id !== "shot-2") : shots }), { status: 200, headers: { "Content-Type": "application/json" } }))));
    const onRequestShotStructureRevision = vi.fn().mockResolvedValue(undefined);
    const view = render(<EpisodeDetail {...materialInputProps} artifacts={[storyboardArtifact]} blueprint={blueprint} episode={approvedEpisode} isTransitionPending={false} onRequestShotStructureRevision={onRequestShotStructureRevision} onTransition={vi.fn()} reviewPackages={[reviewPackage]} tasks={[]} transitions={[]} />);

    await screen.findByRole("heading", { name: "分镜工作台" });
    await user.click(screen.getByLabelText("shot-2 更多操作"));
    const menu = screen.getByLabelText("shot-2 镜头设置");
    await user.click(within(menu).getByRole("button", { name: "删除镜头" }));
    const dialog = screen.getByRole("dialog", { name: "shot-2 删除镜头" });
    await user.type(within(dialog).getByLabelText("修订原因"), "删除多余镜头。");
    await user.click(within(dialog).getByRole("button", { name: "提交分镜结构修订" }));
    await waitFor(() => expect(onRequestShotStructureRevision).toHaveBeenCalledWith(expect.objectContaining({ operation: { kind: "delete", shotId: "shot-2" } })));
    expect(screen.getByText("正在后台应用“删除镜头”；完成后会在此处切换到新版分镜。")).toBeTruthy();

    view.rerender(<EpisodeDetail {...materialInputProps} artifacts={[revisedArtifact]} blueprint={blueprint} episode={approvedEpisode} isTransitionPending={false} onRequestShotStructureRevision={onRequestShotStructureRevision} onTransition={vi.fn()} reviewPackages={[revisedPackage]} tasks={[]} transitions={[]} />);
    await waitFor(() => expect(window.location.hash).toBe(`#storyboard-shot-${revisedPackage.id}-shot-3`));
    expect(screen.getByRole("button", { name: /^shot-3 A-roll/ }).getAttribute("aria-expanded")).toBe("true");
    window.history.replaceState(null, "", "#");
  });

  it("刷新后从运行中的结构任务恢复工作台，并在完成后打开删除镜头的下一镜", async () => {
    const approvedEpisode: Episode = { ...reviewEpisode, id: "episode-shot-structure-resume", stage: "storyboard_approved" };
    const storyboardArtifact = { ...previewArtifact, artifact_type: "storyboard" as const, episode_id: approvedEpisode.id, id: "artifact-shot-structure-resume", relative_path: "episodes/episode-shot-structure-resume/storyboard.json" };
    const revisedArtifact = { ...storyboardArtifact, id: "artifact-shot-structure-resume-v2", relative_path: "episodes/episode-shot-structure-resume/storyboard-v2.json", sha256: "b".repeat(64) };
    const reviewPackage = { artifact_id: storyboardArtifact.id, context_snapshot: {}, created_at: "2026-09-03T00:00:00.000Z", episode_id: approvedEpisode.id, id: "review-package-shot-structure-resume", invalidated_at: null, invalidated_reason: null, revision_number: 1, stage: "storyboard_review" as const, task_id: "task-shot-structure-resume", task_run_id: "run-shot-structure-resume" };
    const revisedPackage = { ...reviewPackage, artifact_id: revisedArtifact.id, id: "review-package-shot-structure-resume-v2", revision_number: 2, task_id: "task-shot-structure-resume-v2" };
    const shots = ["shot-1", "shot-2", "shot-3"].map((id) => ({ durationSeconds: 3, id, inputBasis: [{ relativePath: "script.md", sha256: "a".repeat(64) }], productionMethod: "人工", scriptSegment: `${id} 文案`, shotType: "a_roll" as const, targetSpec: "9:16" }));
    const revisionTask: Task = { ...blockedTask, created_at: "2026-09-03T00:01:00.000Z", episode_id: approvedEpisode.id, id: "task-running-structure", input_snapshot: { storyboard_revision: { base_review_package_id: reviewPackage.id, operation: { kind: "delete", shotId: "shot-2" } } }, status: "running", task_type: "draft_storyboard_revision" };
    vi.stubGlobal("fetch", vi.fn().mockImplementation((source: string) => Promise.resolve(new Response(JSON.stringify({ version: "storyboard/v1", audioCues: [], shots: source.includes("storyboard-v2") ? shots.filter((shot) => shot.id !== "shot-2") : shots }), { status: 200, headers: { "Content-Type": "application/json" } }))));
    window.history.replaceState(null, "", `#storyboard-shot-${reviewPackage.id}-shot-2`);
    const view = render(<EpisodeDetail {...materialInputProps} artifacts={[storyboardArtifact]} blueprint={blueprint} episode={approvedEpisode} isTransitionPending={false} onTransition={vi.fn()} reviewPackages={[reviewPackage]} tasks={[revisionTask]} transitions={[]} />);

    await screen.findByText("正在后台应用“删除镜头”；完成后会在此处切换到新版分镜。");
    view.rerender(<EpisodeDetail {...materialInputProps} artifacts={[revisedArtifact]} blueprint={blueprint} episode={approvedEpisode} isTransitionPending={false} onTransition={vi.fn()} reviewPackages={[revisedPackage]} tasks={[{ ...revisionTask, status: "completed" }]} transitions={[]} />);
    await waitFor(() => expect(window.location.hash).toBe(`#storyboard-shot-${revisedPackage.id}-shot-3`));
    expect(screen.getByRole("button", { name: /^shot-3 A-roll/ }).getAttribute("aria-expanded")).toBe("true");
  });

  it("新版分镜保留旧版本 hash 中仍存在的镜头", async () => {
    const approvedEpisode: Episode = { ...reviewEpisode, id: "episode-shot-hash-remap", stage: "storyboard_approved" };
    const storyboardArtifact = { ...previewArtifact, artifact_type: "storyboard" as const, episode_id: approvedEpisode.id, id: "artifact-shot-hash-remap-v2", relative_path: "episodes/episode-shot-hash-remap/storyboard-v2.json", sha256: "b".repeat(64) };
    const reviewPackage = { artifact_id: storyboardArtifact.id, context_snapshot: {}, created_at: "2026-09-03T00:00:00.000Z", episode_id: approvedEpisode.id, id: "review-package-shot-hash-remap-v2", invalidated_at: null, invalidated_reason: null, revision_number: 2, stage: "storyboard_review" as const, task_id: "task-shot-hash-remap-v2", task_run_id: "run-shot-hash-remap-v2" };
    const shots = ["shot-1", "shot-2"].map((id) => ({ durationSeconds: 3, id, inputBasis: [{ relativePath: "script.md", sha256: "a".repeat(64) }], productionMethod: "人工", scriptSegment: `${id} 文案`, shotType: "a_roll" as const, targetSpec: "9:16" }));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ version: "storyboard/v1", audioCues: [], shots }), { status: 200, headers: { "Content-Type": "application/json" } })));
    window.history.replaceState(null, "", "#storyboard-shot-old-package-shot-2");
    render(<EpisodeDetail {...materialInputProps} artifacts={[storyboardArtifact]} blueprint={blueprint} episode={approvedEpisode} isTransitionPending={false} onTransition={vi.fn()} reviewPackages={[reviewPackage]} tasks={[]} transitions={[]} />);

    await waitFor(() => expect(window.location.hash).toBe(`#storyboard-shot-${reviewPackage.id}-shot-2`));
    await waitFor(() => expect(screen.getByRole("button", { name: /^shot-2 A-roll/ }).getAttribute("aria-expanded")).toBe("true"));
  });

  it("本期 TTS 试听只在点击后读取当前表单，不保存或创建任务", async () => {
    const user = userEvent.setup();
    const approvedEpisode: Episode = { ...reviewEpisode, id: "episode-tts-preview", stage: "storyboard_approved", tts_language_code: "zh-CN", tts_speaking_rate: 1.35, tts_voice: "voice-a" };
    const storyboardArtifact: Artifact = { ...previewArtifact, artifact_type: "storyboard", episode_id: approvedEpisode.id, id: "artifact-tts-preview", relative_path: "episodes/episode-tts-preview/storyboard.json" };
    const reviewPackage = { artifact_id: storyboardArtifact.id, context_snapshot: {}, created_at: "2026-09-03T00:00:00.000Z", episode_id: approvedEpisode.id, id: "review-package-tts-preview", invalidated_at: null, invalidated_reason: null, revision_number: 1, stage: "storyboard_review" as const, task_id: "task-tts-preview", task_run_id: "run-tts-preview" };
    const fetcher = vi.fn().mockImplementation((input: string) => input.includes("_tts-voice-preview")
      ? Promise.resolve(new Response(new Blob(["audio"], { type: "audio/mpeg" }), { status: 200 }))
      : Promise.resolve(new Response(JSON.stringify({ version: "storyboard/v1", audioCues: [], shots: [{ durationSeconds: 3, id: "shot-1", inputBasis: [{ relativePath: "script.md", sha256: "a".repeat(64) }], productionMethod: "人工", scriptSegment: "分镜口播", shotType: "a_roll", targetSpec: "9:16" }] }), { status: 200, headers: { "Content-Type": "application/json" } })));
    vi.stubGlobal("fetch", fetcher);
    vi.stubGlobal("Audio", vi.fn().mockImplementation(() => ({ addEventListener: vi.fn(), pause: vi.fn(), play: vi.fn().mockResolvedValue(undefined) })));
    const onSave = vi.fn().mockResolvedValue(undefined);
    const onGenerateTts = vi.fn().mockResolvedValue(undefined);
    render(<EpisodeDetail {...materialInputProps} artifacts={[storyboardArtifact]} blueprint={{ ...blueprint, policy: { narration: { executor: { adapter: "volcengine_tts", model: "seed-tts-2.0", provider: "volcengine_tts" }, voice: { language_code: "zh-CN", name: "voice-a", speaking_rate: 1.35 } } } }} episode={approvedEpisode} isTransitionPending={false} onGenerateShotTts={onGenerateTts} onSaveEpisodeTtsSettings={onSave} onTransition={vi.fn()} reviewPackages={[reviewPackage]} tasks={[]} transitions={[]} />);

    await screen.findByRole("heading", { name: "分镜工作台" });
    const fetchCallsBeforeEdit = fetcher.mock.calls.length;
    await user.selectOptions(screen.getByLabelText("本期 TTS 语言"), "en-US");
    await user.selectOptions(screen.getByLabelText("本期 TTS 声音"), "zh_female_vv_uranus_bigtts");
    await user.clear(screen.getByLabelText("本期 TTS 语速"));
    await user.type(screen.getByLabelText("本期 TTS 语速"), "1.5");
    await user.click(screen.getByRole("button", { expanded: true }));
    expect(fetcher).toHaveBeenCalledTimes(fetchCallsBeforeEdit);
    await user.click(screen.getByRole("button", { name: "保存本期设置" }));
    expect(onSave).toHaveBeenCalledWith({ episodeId: approvedEpisode.id, languageCode: "en-US", speakingRate: 1.5, voice: "zh_female_vv_uranus_bigtts" });
    expect(fetcher).toHaveBeenCalledTimes(fetchCallsBeforeEdit);
    await user.click(screen.getByRole("button", { name: "试听本期 TTS" }));
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(fetchCallsBeforeEdit + 1));
    const previewCall = fetcher.mock.calls.at(-1);
    expect(String(previewCall?.[0])).toContain("/_tts-voice-preview?episode=episode-tts-preview");
    expect(previewCall?.[1]).toEqual(expect.objectContaining({ body: JSON.stringify({ languageCode: "en-US", speakingRate: 1.5, voice: "zh_female_vv_uranus_bigtts" }), method: "POST" }));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onGenerateTts).not.toHaveBeenCalled();
  });

  it("本期 TTS 未保存时明确阻止逐镜头生成，并标记表单修改状态", async () => {
    const user = userEvent.setup();
    const approvedEpisode: Episode = { ...reviewEpisode, id: "episode-tts-required", stage: "storyboard_approved", tts_language_code: null, tts_speaking_rate: null, tts_voice: null };
    const storyboardArtifact: Artifact = { ...previewArtifact, artifact_type: "storyboard", episode_id: approvedEpisode.id, id: "artifact-tts-required", relative_path: "episodes/episode-tts-required/storyboard.json" };
    const reviewPackage = { artifact_id: storyboardArtifact.id, context_snapshot: {}, created_at: "2026-09-03T00:00:00.000Z", episode_id: approvedEpisode.id, id: "review-package-tts-required", invalidated_at: null, invalidated_reason: null, revision_number: 1, stage: "storyboard_review" as const, task_id: "task-tts-required", task_run_id: "run-tts-required" };
    const onGenerateTts = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ version: "storyboard/v1", audioCues: [], shots: [{ durationSeconds: 3, id: "shot-1", inputBasis: [{ relativePath: "script.md", sha256: "a".repeat(64) }], productionMethod: "人工", scriptSegment: "分镜口播", shotType: "a_roll", targetSpec: "9:16" }] }), { status: 200, headers: { "Content-Type": "application/json" } })));

    render(<EpisodeDetail {...materialInputProps} artifacts={[storyboardArtifact]} blueprint={blueprint} episode={approvedEpisode} isTransitionPending={false} onGenerateShotTts={onGenerateTts} onTransition={vi.fn()} reviewPackages={[reviewPackage]} tasks={[]} transitions={[]} />);

    await screen.findByRole("heading", { name: "分镜工作台" });
    expect(screen.getByText("尚未配置")).toBeTruthy();
    expect(screen.getByText(/请先保存上方“本期 TTS 设置”/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "生成口播" }) as HTMLButtonElement).disabled).toBe(true);
    await user.type(screen.getByLabelText("本期 TTS 声音"), "voice-a");
    await user.type(screen.getByLabelText("本期 TTS 语速"), "1.2");
    expect(screen.getByText("未保存")).toBeTruthy();
    expect(onGenerateTts).not.toHaveBeenCalled();
  });

  it("逐镜头 TTS 可先于原片标记生成，完整保存仍要求视频", async () => {
    const user = userEvent.setup();
    const approvedEpisode: Episode = { ...reviewEpisode, id: "episode-shot-tts", stage: "storyboard_approved", tts_language_code: "zh-CN", tts_speaking_rate: 1.2, tts_voice: "voice-a" };
    const storyboardArtifact: Artifact = { ...previewArtifact, artifact_type: "storyboard", episode_id: approvedEpisode.id, id: "artifact-shot-tts", relative_path: "episodes/episode-shot-tts/storyboard.json" };
    const reviewPackage = { artifact_id: storyboardArtifact.id, context_snapshot: {}, created_at: "2026-09-03T00:00:00.000Z", episode_id: approvedEpisode.id, id: "review-package-shot-tts", invalidated_at: null, invalidated_reason: null, revision_number: 1, stage: "storyboard_review" as const, task_id: "task-shot-tts", task_run_id: "run-shot-tts" };
    const draft: ShotPreparationDraft = { clip_segments: [], audio_mode: "tts", audio_status: "pending", confirmation_status: "pending", created_at: "2026-09-03T00:00:00.000Z", episode_id: approvedEpisode.id, id: "draft-shot-tts", review_package_id: reviewPackage.id, shot_id: "shot-1", subtitle_text: "原始口播", subtitles_enabled: true, tts_speaking_rate: 1.2, tts_voice: "voice-a", updated_at: "2026-09-03T00:00:00.000Z", video_status: "pending" };
    const source: MaterialRevision = { created_at: "2026-09-03T00:00:00.000Z", created_by: "owner-1", episode_id: approvedEpisode.id, file_size: 2048, id: "material-shot-tts", is_main_script: false, material_purpose: "a_roll", material_type: "video", mime_type: "video/mp4", revision_number: 1, sha256: "b".repeat(64), source_kind: "file", source_path: "presenter.mp4", storage_path: "episodes/episode-shot-tts/materials/presenter.mp4" };
    const onSave = vi.fn().mockResolvedValue(undefined);
    const onGenerateTts = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ version: "storyboard/v1", audioCues: [], shots: [{ durationSeconds: 3, id: "shot-1", inputBasis: [{ relativePath: "script.md", sha256: "a".repeat(64) }], productionMethod: "人工", scriptSegment: "分镜口播", shotType: "a_roll", targetSpec: "9:16" }] }), { status: 200, headers: { "Content-Type": "application/json" } })));

    render(<EpisodeDetail {...materialInputProps} artifacts={[storyboardArtifact]} blueprint={{ ...blueprint, policy: { narration: { voice: { name: "voice-a", speaking_rate: 1.2 } } } }} episode={approvedEpisode} isTransitionPending={false} materialRevisions={[source]} onGenerateShotTts={onGenerateTts} onSaveShotPreparationDraft={onSave} onTransition={vi.fn()} reviewPackages={[reviewPackage]} shotPreparationDrafts={[draft]} tasks={[]} transitions={[]} />);

    await screen.findByRole("heading", { name: "分镜工作台" });
    await user.clear(screen.getByLabelText("shot-1 口播内容"));
    await user.type(screen.getByLabelText("shot-1 口播内容"), "新的逐字口播");
    expect(onGenerateTts).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "生成口播" }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ includeVideo: false, materialRevisionId: "" }));
    expect(onGenerateTts).toHaveBeenCalledWith({ episodeId: approvedEpisode.id, reviewPackageId: reviewPackage.id, retry: false, shotId: "shot-1" });
    await waitFor(() => expect(screen.queryByRole("button", { name: "等待 Worker 领取…" })).toBeNull());
    await openVisualStep(user, "shot-1");
    expect(screen.getByLabelText("shot-1 当前原片")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "保存草稿" }));
    expect(screen.getByRole("alert").textContent).toContain("请选择原片并完成至少一个有效片段标记");
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("重新生成口播时隐藏旧音轨，完成后可从右上角筛选历史口播", async () => {
    const user = userEvent.setup();
    const episode: Episode = { ...reviewEpisode, id: "episode-tts-history", stage: "storyboard_approved", tts_language_code: "zh-CN", tts_speaking_rate: 1.2, tts_voice: "voice-a" };
    const storyboardArtifact: Artifact = { ...previewArtifact, artifact_type: "storyboard", episode_id: episode.id, id: "artifact-tts-history", relative_path: "episodes/episode-tts-history/storyboard.json" };
    const reviewPackage = { artifact_id: storyboardArtifact.id, context_snapshot: {}, created_at: "2026-09-03T00:00:00.000Z", episode_id: episode.id, id: "review-package-tts-history", invalidated_at: null, invalidated_reason: null, revision_number: 1, stage: "storyboard_review" as const, task_id: "task-storyboard", task_run_id: "run-storyboard" };
    const taskInput = { media: { narration: { text: "当前口播" } }, shot_preparation: { review_package_id: reviewPackage.id, shot_id: "shot-1" } };
    const oldTask: Task = { ...blockedTask, completed_at: "2026-09-03T00:00:10.000Z", created_at: "2026-09-03T00:00:00.000Z", episode_id: episode.id, id: "task-tts-old", input_snapshot: taskInput, status: "completed", task_type: "generate_narration" };
    const newTask: Task = { ...oldTask, completed_at: null, created_at: "2026-09-03T00:01:00.000Z", id: "task-tts-new", status: "running" };
    const oldTrack: AudioTrack = { created_at: "2026-09-03T00:00:10.000Z", cue_id: "shot-1", duration_seconds: 3.4, episode_id: episode.id, file_size: 1024, id: "track-tts-old", relative_path: "episodes/episode-tts-history/audio/old.mp3", sha256: "a".repeat(64), source_artifact_id: "artifact-tts-old", source_material_revision_id: null, source_review_package_id: reviewPackage.id, source_task_id: oldTask.id, start_seconds: 0, track_kind: "narration" };
    const newTrack: AudioTrack = { ...oldTrack, created_at: "2026-09-03T00:01:10.000Z", duration_seconds: 3.6, id: "track-tts-new", relative_path: "episodes/episode-tts-history/audio/new.mp3", sha256: "b".repeat(64), source_artifact_id: "artifact-tts-new", source_task_id: newTask.id };
    const runningDraft = { clip_segments: [], audio_mode: "tts", audio_status: "running", confirmation_status: "pending", created_at: "2026-09-03T00:00:00.000Z", current_audio_track_id: oldTrack.id, current_tts_task_id: oldTask.id, episode_id: episode.id, id: "draft-tts-history", pending_tts_task_id: newTask.id, review_package_id: reviewPackage.id, shot_id: "shot-1", subtitle_text: "当前口播", subtitles_enabled: true, tts_speaking_rate: 1.2, tts_text: "当前口播", tts_voice: "voice-a", updated_at: "2026-09-03T00:01:00.000Z", video_status: "pending" } as unknown as ShotPreparationDraft;
    const fetcher = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => Promise.resolve(init?.method === "POST"
      ? localArtifactTicketResponse()
      : new Response(JSON.stringify({ version: "storyboard/v1", audioCues: [], shots: [{ durationSeconds: 3, id: "shot-1", inputBasis: [{ relativePath: "script.md", sha256: "a".repeat(64) }], productionMethod: "人工", scriptSegment: "当前口播", shotType: "a_roll", targetSpec: "9:16" }] }), { status: 200, headers: { "Content-Type": "application/json" } })));
    vi.stubGlobal("fetch", fetcher);

    const view = render(<EpisodeDetail {...materialInputProps} artifacts={[storyboardArtifact]} audioTracks={[oldTrack]} blueprint={blueprint} episode={episode} isTransitionPending={false} onTransition={vi.fn()} reviewPackages={[reviewPackage]} shotPreparationDrafts={[runningDraft]} tasks={[oldTask, newTask]} transitions={[]} />);
    await screen.findByRole("heading", { name: "分镜工作台" });
    expect(screen.getByText("正在生成新口播，完成后会自动切换。", { selector: "p" })).toBeTruthy();
    expect(screen.queryByText(/历史音轨 · 不作为当前/)).toBeNull();
    expect(screen.queryByLabelText("narration 音轨")).toBeNull();

    const completedTask = { ...newTask, completed_at: "2026-09-03T00:01:10.000Z", status: "completed" as const };
    const completedDraft = { ...runningDraft, audio_status: "ready", current_audio_track_id: newTrack.id, current_tts_task_id: newTask.id, pending_tts_task_id: null, updated_at: "2026-09-03T00:01:10.000Z" } as unknown as ShotPreparationDraft;
    view.rerender(<EpisodeDetail {...materialInputProps} artifacts={[storyboardArtifact]} audioTracks={[newTrack, oldTrack]} blueprint={blueprint} episode={episode} isTransitionPending={false} onTransition={vi.fn()} reviewPackages={[reviewPackage]} shotPreparationDrafts={[completedDraft]} tasks={[oldTask, completedTask]} transitions={[]} />);
    await waitFor(() => expect(screen.getAllByText(/当前音轨/).some((element) => element.textContent === "当前音轨 · narration · shot-1")).toBe(true));
    const historyDisclosure = screen.getByText("历史口播 1").closest("details");
    const currentTrackCard = screen.getAllByText(/当前音轨/).find((element) => element.textContent === "当前音轨 · narration · shot-1")?.closest(".audio-track-card");
    expect(currentTrackCard?.contains(historyDisclosure)).toBe(true);
    expect(historyDisclosure?.closest(".shot-tts-copy-header")).toBeNull();
    await user.click(screen.getByText("历史口播 1"));
    expect(screen.getByLabelText("shot-1 历史口播")).toBeTruthy();
    expect(screen.getByText(/历史试听 · 不改变当前音轨/)).toBeTruthy();
  });

  it("逐镜头口播无需确认即可保存，并可保存单镜头覆盖", async () => {
    const user = userEvent.setup();
    const approvedEpisode: Episode = { ...reviewEpisode, id: "episode-shot-confirmation", stage: "storyboard_approved", tts_language_code: "zh-CN", tts_speaking_rate: 1.2, tts_voice: "voice-a" };
    const storyboardArtifact: Artifact = { ...previewArtifact, artifact_type: "storyboard", episode_id: approvedEpisode.id, id: "artifact-shot-confirmation", relative_path: "episodes/episode-shot-confirmation/storyboard.json" };
    const reviewPackage = { artifact_id: storyboardArtifact.id, context_snapshot: {}, created_at: "2026-09-03T00:00:00.000Z", episode_id: approvedEpisode.id, id: "review-package-shot-confirmation", invalidated_at: null, invalidated_reason: null, revision_number: 1, stage: "storyboard_review" as const, task_id: "task-shot-confirmation", task_run_id: "run-shot-confirmation" };
    const draft: ShotPreparationDraft = { clip_segments: [], audio_mode: "tts", audio_status: "ready", confirmation_status: "confirmed", created_at: "2026-09-03T00:00:00.000Z", episode_id: approvedEpisode.id, id: "draft-shot-confirmation", review_package_id: reviewPackage.id, shot_id: "shot-1", subtitle_text: "已确认口播", subtitles_enabled: true, tts_speaking_rate: 1.2, tts_text: "已确认口播", tts_text_confirmation_fingerprint: "fingerprint", tts_voice: "voice-a", updated_at: "2026-09-03T00:00:00.000Z", video_status: "pending" };
    const onSave = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ version: "storyboard/v1", audioCues: [], shots: [{ durationSeconds: 3, id: "shot-1", inputBasis: [{ relativePath: "script.md", sha256: "a".repeat(64) }], productionMethod: "人工", scriptSegment: "第一镜口播", shotType: "a_roll", targetSpec: "9:16" }] }), { status: 200, headers: { "Content-Type": "application/json" } })));

    render(<EpisodeDetail {...materialInputProps} artifacts={[storyboardArtifact]} blueprint={blueprint} episode={approvedEpisode} isTransitionPending={false} onSaveShotPreparationDraft={onSave} onTransition={vi.fn()} reviewPackages={[reviewPackage]} shotPreparationDrafts={[draft]} tasks={[]} transitions={[]} />);

    await screen.findByRole("heading", { name: "分镜工作台" });
    expect(screen.queryByRole("checkbox", { name: /口播内容已确认/ })).toBeNull();
    await user.clear(screen.getByLabelText("shot-1 口播内容"));
    await user.type(screen.getByLabelText("shot-1 口播内容"), "修改后的口播");
    await user.click(screen.getByLabelText("shot-1 更多操作"));
    await user.click(screen.getByRole("button", { name: "声音设置" }));
    await user.type(screen.getByLabelText("shot-1 单独设置声音"), "voice-b");
    await user.clear(screen.getByLabelText("shot-1 单独设置语速"));
    await user.type(screen.getByLabelText("shot-1 单独设置语速"), "1.5");
    await user.click(screen.getByRole("button", { name: "保存此镜头设置" }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ ttsOverride: { speakingRate: 1.5, voice: "voice-b" } }));
    await user.click(screen.getByLabelText("shot-1 更多操作"));
    await user.click(screen.getByRole("button", { name: "声音设置" }));
    await user.click(screen.getByRole("button", { name: "恢复本期设置" }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ ttsOverride: { speakingRate: null, voice: null } }));
  });

  it("后台刷新时保留未保存的原片与片段标记", async () => {
    const user = userEvent.setup();
    const approvedEpisode: Episode = { ...reviewEpisode, id: "episode-shot-refresh", stage: "storyboard_approved" };
    const storyboardArtifact: Artifact = { ...previewArtifact, artifact_type: "storyboard", episode_id: approvedEpisode.id, id: "artifact-shot-refresh", relative_path: "episodes/episode-shot-refresh/storyboard.json" };
    const reviewPackage = { artifact_id: storyboardArtifact.id, context_snapshot: {}, created_at: "2026-09-03T00:00:00.000Z", episode_id: approvedEpisode.id, id: "review-package-shot-refresh", invalidated_at: null, invalidated_reason: null, revision_number: 1, stage: "storyboard_review" as const, task_id: "task-shot-refresh", task_run_id: "run-shot-refresh" };
    const draft: ShotPreparationDraft = { clip_segments: [], audio_mode: "tts", audio_status: "pending", confirmation_status: "pending", created_at: "2026-09-03T00:00:00.000Z", episode_id: approvedEpisode.id, id: "draft-shot-refresh", review_package_id: reviewPackage.id, selected_material_revision_id: null, shot_id: "shot-1", subtitle_text: "第一镜", subtitles_enabled: true, tts_speaking_rate: 1.2, tts_voice: "voice-a", updated_at: "2026-09-03T00:00:00.000Z", video_status: "pending" };
    const source: MaterialRevision = { created_at: "2026-09-03T00:00:00.000Z", created_by: "owner-1", episode_id: approvedEpisode.id, file_size: 2048, id: "material-shot-refresh", is_main_script: false, material_purpose: "a_roll", material_type: "video", mime_type: "video/mp4", revision_number: 1, sha256: "b".repeat(64), source_kind: "file", source_path: "presenter.mp4", storage_path: "episodes/episode-shot-refresh/materials/presenter.mp4" };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ version: "storyboard/v1", audioCues: [], shots: [{ durationSeconds: 3, id: "shot-1", inputBasis: [{ relativePath: "script.md", sha256: "a".repeat(64) }], productionMethod: "人工", scriptSegment: "第一镜口播", shotType: "a_roll", targetSpec: "9:16" }] }), { status: 200, headers: { "Content-Type": "application/json" } })));
    const props = { ...materialInputProps, artifacts: [storyboardArtifact], blueprint, episode: approvedEpisode, isTransitionPending: false, materialRevisions: [source], onTransition: vi.fn(), reviewPackages: [reviewPackage], tasks: [], transitions: [] };
    const view = render(<EpisodeDetail {...props} shotPreparationDrafts={[draft]} />);

    await screen.findByRole("heading", { name: "分镜工作台" });
    await openVisualStep(user, "shot-1");
    await user.selectOptions(screen.getByLabelText("shot-1 当前原片"), source.id);
    await user.click(screen.getByRole("button", { name: "添加片段" }));
    view.rerender(<EpisodeDetail {...props} shotPreparationDrafts={[{ ...draft, updated_at: "2026-09-03T00:00:15.000Z" }]} />);

    expect((screen.getByLabelText("shot-1 当前原片") as HTMLSelectElement).value).toBe(source.id);
    expect(screen.getByText("片段 2")).toBeTruthy();
  });

  it("保留原声直接使用视频内嵌音轨并允许生成同步预览", async () => {
    const user = userEvent.setup();
    const approvedEpisode: Episode = { ...reviewEpisode, id: "episode-shot-source", stage: "storyboard_approved" };
    const storyboardArtifact: Artifact = { ...previewArtifact, artifact_type: "storyboard", episode_id: approvedEpisode.id, id: "artifact-shot-source", relative_path: "episodes/episode-shot-source/storyboard.json" };
    const preparedVideo: Artifact = { ...previewArtifact, artifact_type: "shot_video", episode_id: approvedEpisode.id, id: "artifact-prepared-source", file_size: 4096, relative_path: "episodes/episode-shot-source/video/shot-1-v2.mp4" };
    const reviewPackage = { artifact_id: storyboardArtifact.id, context_snapshot: {}, created_at: "2026-09-03T00:00:00.000Z", episode_id: approvedEpisode.id, id: "review-package-shot-source", invalidated_at: null, invalidated_reason: null, revision_number: 1, stage: "storyboard_review" as const, task_id: "task-shot-source", task_run_id: "run-shot-source" };
    const sourceTask: Task = { ...blockedTask, completed_at: "2026-09-03T00:02:00.000Z", created_at: "2026-09-03T00:01:00.000Z", episode_id: approvedEpisode.id, id: "task-source-audio", input_snapshot: { shot_preparation: { review_package_id: reviewPackage.id, shot_id: "shot-1" }, source_video_artifact: { id: preparedVideo.id } }, last_result: null, model: "ffmpeg", prompt_version: "shot-source-audio-v1", provider: "ffmpeg", status: "completed", task_type: "extract_embedded_audio" };
    const sourceRetryTask: Task = { ...sourceTask, created_at: "2026-09-03T00:04:00.000Z", id: "task-source-audio-failed", last_result: { blockers: [{ code: "ffmpeg_failed", detail: "源片段没有可提取音轨。" }] }, status: "failed" };
    const staleTtsTask: Task = { ...blockedTask, completed_at: null, created_at: "2026-09-03T00:05:00.000Z", episode_id: approvedEpisode.id, id: "task-stale-tts", input_snapshot: { media: { narration: { text: "原声字幕" } }, shot_preparation: { review_package_id: reviewPackage.id, shot_id: "shot-1" } }, status: "running", task_type: "generate_narration" };
    const clipTask: Task = { ...sourceTask, id: "task-prepared-video", input_snapshot: {}, task_type: "generate_b_roll" };
    const source: MaterialRevision = { created_at: "2026-09-03T00:00:00.000Z", created_by: "owner-1", episode_id: approvedEpisode.id, file_size: 4096, id: "material-shot-source", is_main_script: false, material_purpose: "a_roll", material_type: "video", mime_type: "video/mp4", revision_number: 1, sha256: "c".repeat(64), source_kind: "file", source_path: "source.mp4", storage_path: "episodes/episode-shot-source/materials/source.mp4" };
    const draft: ShotPreparationDraft = { clip_segments: [{ end_seconds: 2.984, start_seconds: 0 }], audio_mode: "source", audio_status: "failed", caption_contract: { version: "shot-captions/v1", enabled: false, contentMode: "independent", text: "", cues: [], spatial: { version: "shot-caption-space/v1", anchor: "bottom-center", safeArea: "title-safe", maxLines: 2, maxCharactersPerLine: 16 } }, confirmation_status: "pending", created_at: "2026-09-03T00:00:00.000Z", current_video_artifact_id: preparedVideo.id, current_video_task_id: clipTask.id, episode_id: approvedEpisode.id, id: "draft-shot-source", preparation_contract_status: "current", preparation_input_fingerprint: "source-preview-fingerprint", review_package_id: reviewPackage.id, selected_material_revision_id: source.id, shot_id: "shot-1", source_audio_duration_seconds: null, source_audio_error: "旧提取任务失败，不应阻塞内嵌原声。", source_video_duration_seconds: 10, subtitle_text: "", subtitles_enabled: false, tts_speaking_rate: null, tts_voice: null, updated_at: "2026-09-03T00:04:00.000Z", video_duration_seconds: 2.984, video_status: "ready" } as unknown as ShotPreparationDraft;
    vi.stubGlobal("fetch", vi.fn((_input: RequestInfo | URL, init?: RequestInit) => Promise.resolve(init?.method === "POST" ? localArtifactTicketResponse() : new Response(JSON.stringify({ version: "storyboard/v1", audioCues: [], shots: [{ durationSeconds: 3, id: "shot-1", inputBasis: [{ relativePath: "script.md", sha256: "a".repeat(64) }], productionMethod: "人工", scriptSegment: "第一镜口播", shotType: "a_roll", targetSpec: "9:16" }] }), { status: 200, headers: { "Content-Type": "application/json" } }))));

    render(<EpisodeDetail {...materialInputProps} artifacts={[storyboardArtifact, preparedVideo]} blueprint={blueprint} episode={approvedEpisode} isTransitionPending={false} materialRevisions={[source]} onTransition={vi.fn()} audioTracks={[]} reviewPackages={[reviewPackage]} shotPreparationDrafts={[draft]} tasks={[clipTask, sourceTask, sourceRetryTask, staleTtsTask]} transitions={[]} />);

    await screen.findByRole("heading", { name: "分镜工作台" });
    expect(screen.getByText("当前片段原声成为唯一主声音；多槽位复用也只播放一次。")).toBeTruthy();
    expect(screen.queryByText("正在生成新口播，完成后会自动切换。")).toBeNull();
    expect(screen.queryByRole("button", { name: /提取当前原声/ })).toBeNull();
    expect(screen.queryByLabelText("source 音轨")).toBeNull();
    expect(screen.queryByRole("heading", { name: "音轨" })).toBeNull();
    await user.click(within(screen.getByRole("tablist", { name: "shot-1 镜头工作区" })).getByRole("tab", { name: "3 同步预览与确认" }));
    expect(screen.getAllByText("原声已就绪").length).toBeGreaterThan(0);
    expect(screen.getByText(/素材原声 · 随视频片段使用/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "生成同步预览" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("无口播显示为明确静音，并仍可保存字幕开关", async () => {
    const user = userEvent.setup();
    const approvedEpisode: Episode = { ...reviewEpisode, id: "episode-shot-none", stage: "storyboard_approved" };
    const storyboardArtifact: Artifact = { ...previewArtifact, artifact_type: "storyboard", episode_id: approvedEpisode.id, id: "artifact-shot-none", relative_path: "episodes/episode-shot-none/storyboard.json" };
    const reviewPackage = { artifact_id: storyboardArtifact.id, context_snapshot: {}, created_at: "2026-09-03T00:00:00.000Z", episode_id: approvedEpisode.id, id: "review-package-shot-none", invalidated_at: null, invalidated_reason: null, revision_number: 1, stage: "storyboard_review" as const, task_id: "task-shot-none", task_run_id: "run-shot-none" };
    const draft: ShotPreparationDraft = { clip_segments: [], audio_mode: "none", audio_status: "ready", confirmation_status: "pending", created_at: "2026-09-03T00:00:00.000Z", episode_id: approvedEpisode.id, id: "draft-shot-none", review_package_id: reviewPackage.id, shot_id: "shot-1", subtitle_text: "无口播字幕", subtitles_enabled: false, tts_speaking_rate: null, tts_voice: null, updated_at: "2026-09-03T00:00:00.000Z", video_status: "pending" };
    const source: MaterialRevision = { created_at: "2026-09-03T00:00:00.000Z", created_by: "owner-1", episode_id: approvedEpisode.id, file_size: 2048, id: "material-shot-none", is_main_script: false, material_purpose: "a_roll", material_type: "video", mime_type: "video/mp4", revision_number: 1, sha256: "b".repeat(64), source_kind: "file", source_path: "presenter.mp4", storage_path: "episodes/episode-shot-none/materials/presenter.mp4" };
    const onSave = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ version: "storyboard/v1", audioCues: [], shots: [{ durationSeconds: 3, id: "shot-1", inputBasis: [{ relativePath: "script.md", sha256: "a".repeat(64) }], productionMethod: "人工", scriptSegment: "第一镜口播", shotType: "a_roll", targetSpec: "9:16" }] }), { status: 200, headers: { "Content-Type": "application/json" } })));

    render(<EpisodeDetail {...materialInputProps} artifacts={[storyboardArtifact]} blueprint={blueprint} episode={approvedEpisode} isTransitionPending={false} materialRevisions={[source]} onSaveShotPreparationDraft={onSave} onTransition={vi.fn()} reviewPackages={[reviewPackage]} shotPreparationDrafts={[draft]} tasks={[]} transitions={[]} />);

    await screen.findByRole("heading", { name: "分镜工作台" });
    expect(screen.getByText("镜头不建立主声音轨；素材原声静音，BGM 不执行主声音闪避。")).toBeTruthy();
    expect(screen.queryByLabelText("shot-1 字幕正文")).toBeNull();
    expect((screen.getByRole("switch", { name: "shot-1 静音" }) as HTMLInputElement).checked).toBe(true);
    expect(screen.queryByRole("button", { name: "保存声音模式" })).toBeNull();
    expect(screen.queryByRole("region", { name: "shot-1 声学对齐" })).toBeNull();
    await openVisualStep(user, "shot-1");
    await user.selectOptions(screen.getByLabelText("shot-1 当前原片"), source.id);
    await user.click(screen.getByRole("button", { name: "保存草稿" }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ audioMode: "none", episodeId: approvedEpisode.id, reviewPackageId: reviewPackage.id, shotId: "shot-1", subtitleText: "无口播字幕", subtitlesEnabled: false }));
  });

  it("同一原片支持多段裁剪并随镜头草稿一起保存", async () => {
    const user = userEvent.setup();
    const approvedEpisode: Episode = { ...reviewEpisode, id: "episode-shot-clip", stage: "storyboard_approved" };
    const storyboardArtifact: Artifact = { ...previewArtifact, artifact_type: "storyboard", episode_id: approvedEpisode.id, id: "artifact-shot-clip", relative_path: "episodes/episode-shot-clip/storyboard.json" };
    const reviewPackage = { artifact_id: storyboardArtifact.id, context_snapshot: {}, created_at: "2026-09-03T00:00:00.000Z", episode_id: approvedEpisode.id, id: "review-package-shot-clip", invalidated_at: null, invalidated_reason: null, revision_number: 1, stage: "storyboard_review" as const, task_id: "task-shot-clip", task_run_id: "run-shot-clip" };
    const draft: ShotPreparationDraft = { clip_segments: [{ start_seconds: 1, end_seconds: 3 }], audio_mode: "tts", audio_status: "ready", confirmation_status: "pending", created_at: "2026-09-03T00:00:00.000Z", episode_id: approvedEpisode.id, id: "draft-shot-clip", review_package_id: reviewPackage.id, selected_material_revision_id: "material-shot-clip", shot_id: "shot-1", subtitle_text: "第一镜口播", subtitles_enabled: false, tts_actual_duration_seconds: 5.8, tts_speaking_rate: null, tts_text: "第一镜口播", tts_voice: null, updated_at: "2026-09-03T00:00:00.000Z", video_status: "pending" };
    const source: MaterialRevision = { created_at: "2026-09-03T00:00:00.000Z", created_by: "owner-1", episode_id: approvedEpisode.id, file_size: 2048, id: "material-shot-clip", is_main_script: false, material_purpose: "a_roll", material_type: "video", mime_type: "video/mp4", revision_number: 1, sha256: "b".repeat(64), source_kind: "file", source_path: "presenter.mp4", storage_path: "episodes/episode-shot-clip/materials/presenter.mp4" };
    const onSave = vi.fn().mockResolvedValue(undefined);
    const onGenerateTts = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => Promise.resolve(init?.method === "POST"
      ? localArtifactTicketResponse()
      : String(input).includes("storyboard")
        ? new Response(JSON.stringify({ version: "storyboard/v1", audioCues: [], shots: [{ durationSeconds: 3, id: "shot-1", inputBasis: [{ relativePath: "script.md", sha256: "a".repeat(64) }], productionMethod: "人工", scriptSegment: "第一镜口播", shotType: "a_roll", targetSpec: "9:16" }] }), { status: 200, headers: { "Content-Type": "application/json" } })
        : new Response(new Blob(["video"], { type: "video/mp4" }), { status: 200 }))));

    render(<EpisodeDetail {...materialInputProps} artifacts={[storyboardArtifact]} blueprint={blueprint} episode={approvedEpisode} isTransitionPending={false} materialRevisions={[source]} onGenerateShotTts={onGenerateTts} onSaveShotPreparationDraft={onSave} onTransition={vi.fn()} reviewPackages={[reviewPackage]} shotPreparationDrafts={[draft]} tasks={[]} transitions={[]} />);

    await screen.findByRole("heading", { name: "分镜工作台" });
    await openVisualStep(user, "shot-1");
    expect(await screen.findByLabelText("shot-1 视频缩略图轨道")).toBeTruthy();
    expect(screen.getByText("片段标记")).toBeTruthy();
    expect(screen.queryByLabelText("shot-1 片段1 入点（秒）")).toBeNull();
    expect(screen.getByText("A-roll · 当前画面 2.000s · 口播 5.800s")).toBeTruthy();
    expect(screen.queryByLabelText("镜头时长判定")).toBeNull();
    const preview = await screen.findByLabelText("presenter.mp4 预览") as HTMLVideoElement;
    const pause = vi.spyOn(preview, "pause").mockImplementation(() => undefined);
    preview.currentTime = 2;
    fireEvent.timeUpdate(preview);
    expect(document.querySelector<HTMLElement>(".clip-filmstrip-playhead")?.style.left).toBe("34.48275862068966%");
    preview.currentTime = 3;
    fireEvent.timeUpdate(preview);
    expect(pause).toHaveBeenCalled();
    preview.currentTime = 2;
    fireEvent.play(preview);
    expect(preview.currentTime).toBe(1);
    Object.defineProperty(preview, "duration", { configurable: true, value: 10 });
    fireEvent.loadedMetadata(preview);
    await user.click(screen.getByRole("button", { name: "对齐口播时长" }));
    expect(screen.getByText("当前 5.800s · 口播 5.800s")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "添加片段" }));
    expect(onGenerateTts).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /片段 1，5\.800s，无独立目标时长/ }).closest(".clip-segment-tab")?.classList.contains("is-unmeasured")).toBe(true);
    expect(screen.getByRole("button", { name: /片段 2，5\.800s，无独立目标时长/ }).closest(".clip-segment-tab")?.classList.contains("is-unmeasured")).toBe(true);
    const layoutSelect = screen.getByLabelText("shot-1 构图布局");
    await user.selectOptions(layoutSelect, "2up-horizontal");
    expect(screen.getByRole("button", { name: /片段 1，5\.800s，与口播时长一致/ }).closest(".clip-segment-tab")?.classList.contains("is-matched")).toBe(true);
    expect(screen.getByRole("button", { name: /片段 2，5\.800s，与口播时长一致/ }).closest(".clip-segment-tab")?.classList.contains("is-matched")).toBe(true);
    await user.selectOptions(layoutSelect, "full");
    const secondSegmentStart = screen.getByLabelText("shot-1 入点");
    const rangeTrack = document.querySelector<HTMLElement>(".clip-filmstrip-track")!;
    vi.spyOn(rangeTrack, "getBoundingClientRect").mockReturnValue({ bottom: 72, height: 72, left: 0, right: 100, top: 0, width: 100, x: 0, y: 0, toJSON: () => ({}) });
    fireEvent.mouseDown(secondSegmentStart, { button: 0, clientX: 0, clientY: 0 });
    fireEvent.click(screen.getByRole("button", { name: /^片段 1/ }));
    fireEvent.mouseMove(document, { clientX: 50, clientY: 0 });
    await act(async () => { await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); });
    expect(screen.getByLabelText("shot-1 入点").getAttribute("aria-valuenow")).toBe("1");
    fireEvent.mouseUp(document);
    await user.click(screen.getByRole("button", { name: "保存草稿" }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ clipSegments: [{ end_seconds: 6.8, start_seconds: 1 }, { end_seconds: 5.8, start_seconds: 0 }], episodeId: approvedEpisode.id, materialRevisionId: source.id, reviewPackageId: reviewPackage.id, shotId: "shot-1" }));
  });

  it("选择镜头原片文件后立即导入，不再要求二次确认", async () => {
    const user = userEvent.setup();
    const approvedEpisode: Episode = { ...reviewEpisode, id: "episode-shot-import", stage: "storyboard_approved" };
    const storyboardArtifact: Artifact = { ...previewArtifact, artifact_type: "storyboard", episode_id: approvedEpisode.id, id: "artifact-shot-import", relative_path: "episodes/episode-shot-import/storyboard.json" };
    const reviewPackage = { artifact_id: storyboardArtifact.id, context_snapshot: {}, created_at: "2026-09-03T00:00:00.000Z", episode_id: approvedEpisode.id, id: "review-package-shot-import", invalidated_at: null, invalidated_reason: null, revision_number: 1, stage: "storyboard_review" as const, task_id: "task-shot-import", task_run_id: "run-shot-import" };
    const onImport = vi.fn().mockResolvedValue("material-new");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ version: "storyboard/v1", audioCues: [], shots: [{ durationSeconds: 3, id: "shot-1", inputBasis: [{ relativePath: "script.md", sha256: "a".repeat(64) }], productionMethod: "人工", scriptSegment: "第一镜口播", shotType: "a_roll", targetSpec: "9:16" }] }), { status: 200, headers: { "Content-Type": "application/json" } })));

    render(<EpisodeDetail {...materialInputProps} artifacts={[storyboardArtifact]} blueprint={blueprint} episode={approvedEpisode} isTransitionPending={false} onImportMaterial={onImport} onTransition={vi.fn()} reviewPackages={[reviewPackage]} tasks={[]} transitions={[]} />);

    await screen.findByRole("heading", { name: "分镜工作台" });
    expect(screen.queryByRole("button", { name: "导入原片" })).toBeNull();
    await openVisualStep(user, "shot-1");
    await user.upload(screen.getByLabelText("shot-1 补充原片"), new File(["video"], "new-shot.mp4", { type: "video/mp4" }));
    await waitFor(() => expect(onImport).toHaveBeenCalledTimes(1));
    expect(onImport).toHaveBeenCalledWith(expect.objectContaining({ logicalName: "a-shot-001.mp4", sourcePath: "new-shot.mp4" }));
  });

  it("分镜准备阶段不提供 Studio 入口", async () => {
    const approvedEpisode: Episode = { ...reviewEpisode, id: "episode-shot-confirm", stage: "storyboard_approved" };
    const storyboardArtifact: Artifact = { ...previewArtifact, artifact_type: "storyboard", episode_id: approvedEpisode.id, id: "artifact-shot-confirm", relative_path: "episodes/episode-shot-confirm/storyboard.json" };
    const reviewPackage = { artifact_id: storyboardArtifact.id, context_snapshot: {}, created_at: "2026-09-03T00:00:00.000Z", episode_id: approvedEpisode.id, id: "review-package-shot-confirm", invalidated_at: null, invalidated_reason: null, revision_number: 1, stage: "storyboard_review" as const, task_id: "task-shot-confirm", task_run_id: "run-shot-confirm" };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ version: "storyboard/v1", audioCues: [], shots: [{ durationSeconds: 3, id: "shot-1", inputBasis: [{ relativePath: "script.md", sha256: "a".repeat(64) }], productionMethod: "人工", scriptSegment: "第一镜口播", shotType: "a_roll", targetSpec: "9:16" }] }), { status: 200, headers: { "Content-Type": "application/json" } })));

    render(<EpisodeDetail {...materialInputProps} artifacts={[storyboardArtifact]} blueprint={blueprint} episode={approvedEpisode} isTransitionPending={false} onTransition={vi.fn()} reviewPackages={[reviewPackage]} shotPreparationDrafts={[]} tasks={[]} transitions={[]} />);

    await screen.findByRole("heading", { name: "分镜工作台" });
    expect(screen.queryByRole("button", { name: "在 OpenChatCut 中打开" })).toBeNull();
  });

  it("展示委托脚本的冻结输入，并让 Owner 完成审核或要求重写", async () => {
    const user = userEvent.setup();
    const onTransition = vi.fn().mockResolvedValue(undefined);
    const scriptArtifact: Artifact = {
      ...previewArtifact,
      artifact_type: "script",
      id: "artifact-script",
      producer_task_id: "task-script-1",
      relative_path: "episodes/episode-review/generated-script-v1.md",
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("# 雨夜祭坛\n\n主角在仪式中作出选择。", { status: 200, headers: { "Content-Type": "text/markdown" } })));

    render(<EpisodeDetail {...materialInputProps} artifacts={[scriptArtifact]} blueprint={blueprint} episode={reviewEpisode} isTransitionPending={false} onTransition={onTransition} reviewPackages={[{
      artifact_id: scriptArtifact.id,
      context_snapshot: {
        allowed_tools: ["read", "write"],
        artifact: { relative_path: scriptArtifact.relative_path, sha256: scriptArtifact.sha256 },
        budget: { limit_cents: 90 },
        capability: "script_writing",
        commission: { creative_direction: "雨夜民俗悬疑", core_content: "仪式感与人物抉择" },
        executor: { model: "gpt-5.6-codex", provider: "codex" },
        output: { content_type: "text/markdown", required_artifact_types: ["script"] },
      },
      created_at: "2026-08-14T00:00:00.000Z",
      episode_id: reviewEpisode.id,
      id: "review-package-script-1",
      invalidated_at: null,
      invalidated_reason: null,
      revision_number: 1,
      stage: "script_review",
      task_id: "task-script-1",
      task_run_id: "task-run-script-1",
    }]} tasks={[]} transitions={[]} />);

    expect(await screen.findByText("主角在仪式中作出选择。", { exact: false })).toBeTruthy();
    expect(screen.getByText("雨夜民俗悬疑")).toBeTruthy();
    expect(screen.getByText("仪式感与人物抉择")).toBeTruthy();

    await user.type(screen.getByLabelText("审批理由"), "脚本可进入分镜前准备。");
    await user.click(screen.getByRole("button", { name: "批准" }));
    expect(onTransition).toHaveBeenLastCalledWith(reviewEpisode.id, "script_approved", "脚本可进入分镜前准备。");
    await user.click(screen.getByRole("button", { name: "要求修改" }));
    expect(onTransition).toHaveBeenLastCalledWith(reviewEpisode.id, "script_draft", "脚本可进入分镜前准备。");
  });

  it("读取分镜前文本产物及其冻结审核上下文", async () => {
    const user = userEvent.setup();
    const onTransition = vi.fn().mockResolvedValue(undefined);
    const visualEpisode: Episode = { ...reviewEpisode, stage: "visual_review" };
    const visualBrief: Artifact = {
      ...previewArtifact,
      artifact_type: "visual_brief",
      id: "artifact-visual-brief",
      producer_task_id: "task-visual-1",
      relative_path: "episodes/episode-review/visual-brief-v1.md",
    };
    const referenceGroup: Artifact = {
      ...visualBrief,
      artifact_type: "visual_reference_group",
      id: "artifact-visual-references",
      relative_path: "episodes/episode-review/visual-references/characters.md",
    };
    const staticVisual: Artifact = {
      ...visualBrief,
      artifact_type: "static_visual",
      id: "artifact-static-visual",
      relative_path: "episodes/episode-review/visuals/lin-yan.svg",
    };
    vi.stubGlobal("fetch", vi.fn().mockImplementation((source: string, init?: RequestInit) => Promise.resolve(init?.method === "POST" ? localArtifactTicketResponse() : new Response(source.includes("visual-references") ? "# 角色\n\n林砚：雨夜深色雨衣。" : "# 视觉方案\n\n第一镜：雨夜古宅。", { status: 200, headers: { "Content-Type": "text/markdown" } }))));

    render(<EpisodeDetail {...materialInputProps} artifacts={[visualBrief, referenceGroup, staticVisual]} blueprint={blueprint} episode={visualEpisode} isTransitionPending={false} onTransition={onTransition} reviewPackages={[{
      artifact_id: visualBrief.id,
      context_snapshot: {
        allowed_tools: ["read", "write"],
        artifact: { relative_path: visualBrief.relative_path, sha256: visualBrief.sha256 },
        budget: { limit_cents: 120 },
        capability: "visual_planning",
        executor: { model: "gpt-5.6-codex", provider: "codex" },
        output: { content_type: "text/markdown", required_artifact_types: ["visual_brief", "visual_reference_group", "static_visual"] },
        series_baseline: { version_id: "series-version-3", version: 3, rules: { visual_style: "写实雨夜" } },
        script_revision: { sha256: "b".repeat(64) },
      },
      created_at: "2026-08-14T00:00:00.000Z",
      episode_id: visualEpisode.id,
      id: "review-package-1",
      invalidated_at: null,
      invalidated_reason: null,
      revision_number: 1,
      stage: "visual_review",
      task_id: "task-visual-1",
      task_run_id: "task-run-1",
    }]} tasks={[]} transitions={[]} />);

    expect(await screen.findByText("第一镜：雨夜古宅。", { exact: false })).toBeTruthy();
    expect(fetch).toHaveBeenCalledWith(`/_local-artifact?episode=episode-review&path=episodes%2Fepisode-review%2Fvisual-brief-v1.md&sha256=${"a".repeat(64)}`, { headers: { Authorization: "Bearer owner-token" } });
    expect(screen.getByText("visual_planning")).toBeTruthy();
    expect(screen.getByText("gpt-5.6-codex")).toBeTruthy();
    expect(screen.getByText("120 分")).toBeTruthy();
    expect(screen.getByText("read、write")).toBeTruthy();
    expect(screen.getByText(`${"b".repeat(12)}…`)).toBeTruthy();
    expect(screen.getByText("系列基准 · v3")).toBeTruthy();
    expect(screen.getByText('{"visual_style":"写实雨夜"}')).toBeTruthy();
    expect(screen.getByText("角色 / 地点 / 关键道具参考组")).toBeTruthy();
    expect(await screen.findByText("林砚：雨夜深色雨衣。", { exact: false })).toBeTruthy();
    expect(screen.getByText("所需静态视觉")).toBeTruthy();
    const frozenContext = screen.getByText("审核与冻结依据").closest(".review-checklist-row");
    const contextToggle = within(frozenContext as HTMLElement).getByRole("button", { name: "查看" });
    expect(contextToggle.getAttribute("aria-expanded")).toBe("false");
    await user.click(contextToggle);
    expect(contextToggle.getAttribute("aria-expanded")).toBe("true");

    await user.type(screen.getByLabelText("审批理由"), "视觉方向清晰，符合主脚本。");
    await user.click(screen.getByRole("button", { name: "批准" }));
    expect(onTransition).toHaveBeenLastCalledWith(visualEpisode.id, "visual_approved", "视觉方向清晰，符合主脚本。");
    await user.click(screen.getByRole("button", { name: "要求修改" }));
    expect(onTransition).toHaveBeenLastCalledWith(visualEpisode.id, "visual_draft", "视觉方向清晰，符合主脚本。");
  });

  it("将冻结的外部视觉输入连同视觉资产清单交给 Owner 审核", async () => {
    const user = userEvent.setup();
    const visualEpisode: Episode = { ...reviewEpisode, stage: "visual_review" };
    const manifest: Artifact = {
      ...previewArtifact,
      artifact_type: "visual_asset_manifest",
      id: "artifact-visual-assets",
      producer_task_id: "task-visual-assets",
      relative_path: "episodes/episode-review/visual-assets-v1.md",
    };
    vi.stubGlobal("fetch", vi.fn().mockImplementation((_source: string, init?: RequestInit) => Promise.resolve(init?.method === "POST" ? localArtifactTicketResponse() : new Response("# 视觉资产清单\n\n- 已提供：林砚角色参考。", { status: 200, headers: { "Content-Type": "text/markdown" } }))));

    render(<EpisodeDetail {...materialInputProps} artifacts={[manifest]} blueprint={blueprint} episode={visualEpisode} isTransitionPending={false} onTransition={vi.fn()} reviewPackages={[{
      artifact_id: manifest.id,
      context_snapshot: {
        allowed_tools: ["read", "write"],
        artifact: { relative_path: manifest.relative_path, sha256: manifest.sha256 },
        budget: { limit_cents: 120 },
        capability: "visual_planning",
        executor: { model: "gpt-5.6-codex", provider: "codex" },
        output: { content_type: "text/markdown", required_artifact_types: ["visual_asset_manifest"] },
        script_revision: { sha256: "c".repeat(64) },
        visual_assets: {
          external_inputs: [
            { artifactType: "external_visual_input", relativePath: "episodes/episode-review/materials/character.png", sha256: "b".repeat(64), fileSize: 128 },
            { artifactType: "external_visual_input", relativePath: "episodes/episode-review/materials/a-shot-002.mp4", sha256: "d".repeat(64), fileSize: 2048 },
          ],
        },
      },
      created_at: "2026-08-22T00:00:00.000Z",
      episode_id: visualEpisode.id,
      id: "review-package-visual-assets",
      invalidated_at: null,
      invalidated_reason: null,
      revision_number: 1,
      stage: "visual_review",
      task_id: "task-visual-assets",
      task_run_id: "task-run-visual-assets",
    }]} tasks={[]} transitions={[]} />);

    expect(await screen.findByText("视觉资产清单", { exact: false })).toBeTruthy();
    const contentRow = screen.getByText("完整资产清单").closest(".review-checklist-row");
    const contentToggle = within(contentRow as HTMLElement).getByRole("button", { name: "查看" });
    expect(contentToggle.getAttribute("aria-expanded")).toBe("false");
    await user.click(contentToggle);
    expect(contentToggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("已冻结的外部视觉输入")).toBeTruthy();
    const selector = screen.getByLabelText("选择视觉输入") as HTMLSelectElement;
    expect(selector.options).toHaveLength(2);
    expect(screen.getByText("character.png").getAttribute("title")).toBe("episodes/episode-review/materials/character.png");
    expect(screen.queryByText("episodes/episode-review/materials/character.png")).toBeNull();
    await user.selectOptions(selector, "episodes/episode-review/materials/a-shot-002.mp4");
    expect(screen.getByTitle("episodes/episode-review/materials/a-shot-002.mp4")).toBeTruthy();
    expect(screen.queryByTitle("episodes/episode-review/materials/character.png")).toBeNull();
    await user.click(await screen.findByRole("button", { name: "放大查看 a-shot-002.mp4" }));
    const dialog = screen.getByRole("dialog", { name: "a-shot-002.mp4 放大预览" });
    expect(dialog.querySelector('video[aria-label="a-shot-002.mp4 放大预览"]')).toBeTruthy();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "a-shot-002.mp4 放大预览" })).toBeNull();
    expect(screen.queryByText("视觉审核包缺少参考组。")).toBeNull();
    expect(screen.queryByRole("heading", { name: "已生成的视觉资产" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "音轨" })).toBeNull();
  });

  it("仅在视觉审核包包含静态视觉时显示生成视觉资产", () => {
    const visualEpisode: Episode = { ...reviewEpisode, stage: "visual_review" };
    const manifest: Artifact = { ...previewArtifact, artifact_type: "visual_asset_manifest", id: "artifact-visual-assets-generated", relative_path: "episodes/episode-review/visual-assets-v1.md" };
    const staticVisual: Artifact = { ...manifest, artifact_type: "static_visual", id: "artifact-static-visual-generated", producer_task_id: "task-visual-assets", relative_path: "episodes/episode-review/visuals/cover.png" };
    const reviewPackage = { artifact_id: manifest.id, context_snapshot: {}, created_at: "2026-08-22T00:00:00.000Z", episode_id: visualEpisode.id, id: "review-package-visual-assets-generated", invalidated_at: null, invalidated_reason: null, revision_number: 1, stage: "visual_review" as const, task_id: "task-visual-assets", task_run_id: "task-run-visual-assets" };

    render(<EpisodeDetail {...materialInputProps} artifacts={[manifest, staticVisual]} blueprint={blueprint} episode={visualEpisode} isTransitionPending={false} onTransition={vi.fn()} reviewPackages={[reviewPackage]} tasks={[]} transitions={[]} />);

    expect(screen.getByRole("heading", { name: "已生成的视觉资产" })).toBeTruthy();
  });

  it("视觉关卡自动继续后仍保留视觉清单，并隐藏没有媒体的空预览", async () => {
    const visualEpisode: Episode = { ...reviewEpisode, stage: "visual_approved" };
    const manifest: Artifact = { ...previewArtifact, artifact_type: "visual_asset_manifest", id: "artifact-visual-checklist", producer_task_id: "task-visual-checklist", relative_path: "episodes/episode-review/visual-assets-v1.md" };
    const visualPackage = { artifact_id: manifest.id, context_snapshot: { visual_assets: { external_inputs: [] } }, created_at: "2026-08-22T00:00:00.000Z", episode_id: visualEpisode.id, id: "review-package-visual-checklist", invalidated_at: null, invalidated_reason: null, revision_number: 1, stage: "visual_review" as const, task_id: "task-visual-checklist", task_run_id: "run-visual-checklist" };
    vi.stubGlobal("fetch", vi.fn().mockImplementation((_source: string, init?: RequestInit) => Promise.resolve(init?.method === "POST" ? localArtifactTicketResponse() : new Response("# 视觉清单", { status: 200 }))));

    render(<EpisodeDetail {...materialInputProps} artifacts={[manifest]} blueprint={{ ...blueprint, policy: { approval_gates: ["script", "storyboard", "qc", "publish"] } }} episode={visualEpisode} isTransitionPending={false} onTransition={vi.fn()} reviewPackages={[visualPackage]} tasks={[]} transitions={[]} />);

    expect(screen.getByRole("heading", { name: "视觉清单" })).toBeTruthy();
    expect(screen.getByText(/不是生成图片或视频的预览/)).toBeTruthy();
    expect(screen.queryByText("当前审核")).toBeNull();
    expect(screen.queryByRole("heading", { name: "生成媒体预览" })).toBeNull();
  });

  it("在 Studio 提交一次合成修订并重新审核", async () => {
    const user = userEvent.setup();
    const onSubmitStudioRevision = vi.fn().mockResolvedValue({ kind: "composition" });
    const qcEpisode: Episode = { ...reviewEpisode, id: "episode-qc", stage: "qc_review", title: "合成调整" };
    const renderArtifact: Artifact = { ...previewArtifact, episode_id: qcEpisode.id, artifact_type: "render", id: "artifact-qc-render", producer_task_id: "task-qc-render", relative_path: "episodes/episode-qc/review-render/v2/review-render.mp4" };
    const qcPackage = {
      artifact_id: renderArtifact.id,
      context_snapshot: { review_kind: "openchatcut_review_render", pre_render_review_package_id: "pre-render-package", project_revision: "2", project_relative_path: "episodes/episode-qc/review-render/v2/index.html", composition_adjustments: { caption_style: "minimal", pacing: "gentle", crop: "contain", transition: "cut", layout: "center" }, technical_evidence: { checks: [] } },
      created_at: "2026-08-15T00:00:00.000Z", episode_id: qcEpisode.id, id: "review-package-qc-2", invalidated_at: null, invalidated_reason: null, revision_number: 2, stage: "qc_review" as const, task_id: "task-qc-render", task_run_id: "task-run-qc-render",
    };
    const renderTask = { ...blockedTask, id: qcPackage.task_id, episode_id: qcEpisode.id, input_snapshot: { review_render: { adjustments: { aspect_ratio: "9:16", width: 1080, height: 1920, captions_enabled: true, caption_style: "minimal", crop: "contain", pacing: "gentle", transition: "cut", layout: "center", narration_gain_db: 0, bgm_gain_db: -12, sfx_gain_db: -6 } } } } as unknown as Task;
    const qcReplacementWarning = { fileSize: 24, relativePath: "episodes/episode-qc/openchatcut-work/current/project.json", sha256: "a".repeat(64), replacementWarning: { code: "openchatcut_workspace_replacement", modifiedScopes: ["视频层与片段"], studioHasChanges: true } } as const;
    const onOpenStudio = vi.fn()
      .mockResolvedValueOnce(qcReplacementWarning)
      .mockResolvedValueOnce(qcReplacementWarning)
      .mockResolvedValue({ fileSize: 24, relativePath: "episodes/episode-qc/openchatcut-work/current/project.json", sha256: "b".repeat(64) });
    const props = { ...materialInputProps, artifacts: [renderArtifact], blueprint, episode: qcEpisode, isTransitionPending: false, onOpenStudio, onSubmitStudioRevision, onTransition: vi.fn(), reviewPackages: [qcPackage], tasks: [renderTask], transitions: [] };
    render(<EpisodeDetail {...props} />);

    expect(screen.getByRole("heading", { name: "在 OpenChatCut 编辑" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "在 OpenChatCut 中打开" }));
    expect(onOpenStudio).toHaveBeenCalledWith(qcEpisode.id, "episodes/episode-qc/review-render/v2/index.html");
    expect(screen.getByRole("dialog", { name: "重新生成 OpenChatCut 工程" }).textContent).toContain("尚未采纳的 Studio 修改：视频层与片段");
    await user.click(screen.getByRole("button", { name: "取消，保留工作版本" }));
    expect(screen.queryByRole("button", { name: "提交 OpenChatCut 修改" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "在 OpenChatCut 中打开" }));
    await user.click(screen.getByRole("button", { name: "覆盖并重新生成" }));
    await waitFor(() => expect(onOpenStudio).toHaveBeenLastCalledWith(qcEpisode.id, "episodes/episode-qc/review-render/v2/index.html", undefined, true));
    await user.click(screen.getByRole("button", { name: "提交 OpenChatCut 修改" }));
    await user.type(screen.getByLabelText("OpenChatCut 修改说明"), "字幕需要更醒目。");
    await user.click(screen.getByRole("button", { name: "确认并重新审核" }));
    expect(onSubmitStudioRevision).toHaveBeenCalledWith(expect.objectContaining({ episodeId: qcEpisode.id, reason: "字幕需要更醒目。", reviewPackageId: qcPackage.id, sourceProjectRelativePath: "episodes/episode-qc/review-render/v2/index.html", workspaceRelativePath: expect.stringContaining("/openchatcut-work/") }));
  });

  it("在审核渲染中只提供官方 Studio 入口", async () => {
    const onCreateQcReviewIssue = vi.fn().mockResolvedValue(undefined);
    const qcEpisode: Episode = { ...reviewEpisode, id: "episode-qc-desk", stage: "qc_review", title: "QC 台" };
    const renderArtifact: Artifact = { ...previewArtifact, episode_id: qcEpisode.id, artifact_type: "render", id: "artifact-qc-desk", producer_task_id: "task-qc-desk", relative_path: "episodes/episode-qc-desk/review-render/v1/review-render.mp4" };
    const qcPackage = {
      artifact_id: renderArtifact.id,
      context_snapshot: { review_kind: "openchatcut_review_render", pre_render_review_package_id: "pre-render-qc-desk", project_revision: "1", project_relative_path: "episodes/episode-qc-desk/review-render/v1/index.html", technical_evidence: { checks: [{ name: "duration_coverage", detail: "时长匹配。" }] } },
      created_at: "2026-08-23T00:00:00.000Z", episode_id: qcEpisode.id, id: "review-package-qc-desk", invalidated_at: null, invalidated_reason: null, revision_number: 1, stage: "qc_review" as const, task_id: "task-qc-desk", task_run_id: "task-run-qc-desk",
    };
    const storyboardTask = { id: qcPackage.task_id, episode_id: qcEpisode.id, input_snapshot: { review_render: { storyboard: { version: "storyboard/v1", shots: [{ durationSeconds: 3, id: "shot-first", inputBasis: [{ relativePath: "episodes/episode-qc-desk/materials/script.md", sha256: "a".repeat(64) }], productionMethod: "人工", scriptSegment: "第一镜", shotType: "a_roll", targetSpec: "9:16" }, { durationSeconds: 2, id: "shot-second", inputBasis: [{ relativePath: "episodes/episode-qc-desk/materials/script.md", sha256: "a".repeat(64) }], productionMethod: "生成", scriptSegment: "第二镜", shotType: "b_roll", targetSpec: "9:16" }], audioCues: [] } } } } as unknown as Task;
    const members = [
      { member_key: "shot:shot-second", member_kind: "shot_media", review_package_id: "pre-render-qc-desk", source_task_id: "task-b-roll" },
      { member_key: "shot:shot-first", member_kind: "shot_media", review_package_id: "pre-render-qc-desk", source_task_id: "task-a-roll" },
    ] as PreRenderReviewMember[];

    render(<EpisodeDetail {...materialInputProps} artifacts={[renderArtifact]} blueprint={blueprint} episode={qcEpisode} isTransitionPending={false} onCreateQcReviewIssue={onCreateQcReviewIssue} onTransition={vi.fn()} preRenderReviewMembers={members} reviewPackages={[qcPackage]} tasks={[storyboardTask]} transitions={[]} />);

    expect(screen.getByRole("heading", { name: "在 OpenChatCut 编辑" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "在 OpenChatCut 中打开" })).toBeTruthy();
    expect(screen.queryByText("QC 问题")).toBeNull();
  });

  it("按镜头审核冻结分镜、保存批注，并执行批准或返工", async () => {
    const user = userEvent.setup();
    const onCreateStoryboardAnnotation = vi.fn().mockResolvedValue(undefined);
    const onTransition = vi.fn().mockResolvedValue(undefined);
    const storyboardEpisode: Episode = { ...reviewEpisode, stage: "storyboard_review" };
    const storyboardArtifact: Artifact = {
      ...previewArtifact,
      artifact_type: "storyboard",
      id: "artifact-storyboard-2",
      producer_task_id: "task-storyboard-2",
      relative_path: "episodes/episode-review/storyboard-v2.json",
    };
    const previousStoryboardArtifact: Artifact = {
      ...storyboardArtifact,
      id: "artifact-storyboard-1",
      producer_task_id: "task-storyboard-1",
      relative_path: "episodes/episode-review/storyboard-v1.json",
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      version: "storyboard/v1",
      shots: [{
        id: "shot-02",
        scriptSegment: "铜铃声切入，林砚回头。",
        durationSeconds: 4.5,
        shotType: "b_roll",
        productionMethod: "素材库特写 + 环境音",
        inputBasis: [
          { relativePath: "episodes/episode-review/generated-script-v1.md", sha256: "b".repeat(64) },
          { relativePath: "episodes/episode-review/visual-brief-v1.md", sha256: "c".repeat(64) },
        ],
        targetSpec: "9:16，1080×1920，24fps",
      }, {
        id: "shot-03",
        scriptSegment: "雨幕里只留下脚步声。",
        durationSeconds: 3,
        shotType: "a_roll",
        productionMethod: "演员近景 + 现场收音",
        inputBasis: [
          { relativePath: "episodes/episode-review/generated-script-v1.md", sha256: "b".repeat(64) },
        ],
        targetSpec: "9:16，1080×1920，24fps",
      }],
    }), { status: 200, headers: { "Content-Type": "application/json" } })));

    render(<EpisodeDetail {...materialInputProps} artifacts={[previousStoryboardArtifact, storyboardArtifact]} blueprint={blueprint} episode={storyboardEpisode} isStoryboardAnnotationPending={false} isTransitionPending={false} onCreateStoryboardAnnotation={onCreateStoryboardAnnotation} onTransition={onTransition} reviewAnnotations={[{
      actor_id: "owner-1",
      created_at: "2026-08-15T00:00:00.000Z",
      id: "annotation-1",
      reason: "先确认铜铃的音效节奏。",
      review_package_id: "review-package-storyboard-1",
      shot_id: "shot-02",
    }]} reviewPackages={[{
      artifact_id: previousStoryboardArtifact.id,
      context_snapshot: {},
      created_at: "2026-08-14T00:00:00.000Z",
      episode_id: storyboardEpisode.id,
      id: "review-package-storyboard-previous",
      invalidated_at: null,
      invalidated_reason: null,
      revision_number: 1,
      stage: "storyboard_review",
      task_id: "task-storyboard-1",
      task_run_id: "task-run-storyboard-1",
    }, {
      artifact_id: storyboardArtifact.id,
      context_snapshot: {},
      created_at: "2026-08-15T00:00:00.000Z",
      episode_id: storyboardEpisode.id,
      id: "review-package-storyboard-1",
      invalidated_at: null,
      invalidated_reason: null,
      revision_number: 2,
      stage: "storyboard_review",
      task_id: "task-storyboard-2",
      task_run_id: "task-run-storyboard-2",
    }]} tasks={[]} transitions={[]} />);

    expect(await screen.findByText("铜铃声切入，林砚回头。")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "可审核分镜 · 修订 v2" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "shot-02 · B-roll" })).toBeTruthy();
    expect(screen.getByText("本阶段确认镜头顺序与内容；最终时长由生成后的 TTS 口播确定。")).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "分镜时间轴" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "选择 shot-02，B-roll" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByText("4.5 秒")).toBeNull();
    expect(screen.getByText("素材库特写 + 环境音")).toBeTruthy();
    expect(screen.getByText("9:16，1080×1920，24fps")).toBeTruthy();
    expect(screen.getByText("先确认铜铃的音效节奏。")).toBeTruthy();
    expect(screen.getByText("第 1 / 2 镜")).toBeTruthy();

    await user.type(screen.getByLabelText("shot-02 镜头批注"), "铜铃特写需要延长。");
    await user.click(screen.getByRole("button", { name: "选择 shot-03，A-roll" }));
    expect(screen.getByRole("heading", { name: "shot-03 · A-roll" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "shot-02 · B-roll" })).toBeNull();
    expect(screen.getByText("第 2 / 2 镜")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "上一镜" }));
    expect((screen.getByLabelText("shot-02 镜头批注") as HTMLTextAreaElement).value).toBe("铜铃特写需要延长。");
    await user.click(screen.getByRole("button", { name: "添加镜头批注" }));
    expect(onCreateStoryboardAnnotation).toHaveBeenCalledWith({ reviewPackageId: "review-package-storyboard-1", reason: "铜铃特写需要延长。", shotId: "shot-02" });

    await user.type(screen.getByLabelText("审批理由"), "镜头拆分、规格与输入均可执行。");
    await user.click(screen.getByRole("button", { name: "批准" }));
    expect(onTransition).toHaveBeenLastCalledWith(storyboardEpisode.id, "storyboard_approved", "镜头拆分、规格与输入均可执行。");
    await user.click(screen.getByRole("button", { name: "要求修改" }));
    expect(onTransition).toHaveBeenLastCalledWith(storyboardEpisode.id, "storyboard_draft", "镜头拆分、规格与输入均可执行。");
  });

  it("人工媒体可在镜头工作台选择原片并保存镜头设置", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    const storyboardEpisode: Episode = { ...reviewEpisode, stage: "storyboard_approved" };
    const storyboardArtifact: Artifact = { ...previewArtifact, artifact_type: "storyboard", id: "artifact-manual-a-roll", producer_task_id: "task-manual-a-roll", relative_path: "episodes/episode-review/storyboard-manual-a-roll.json" };
    const manualAroll: MaterialRevision = {
      created_at: "2026-08-23T00:00:00.000Z",
      created_by: "owner-1",
      episode_id: storyboardEpisode.id,
      file_size: 2048,
      id: "material-a-roll-1",
      is_main_script: false,
      material_purpose: "a_roll",
      material_type: "video",
      mime_type: "video/mp4",
      revision_number: 1,
      sha256: "d".repeat(64),
      source_kind: "file",
      source_path: "presenter.mp4",
      storage_path: "episodes/episode-review/materials/manual-presenter.mp4",
    };
    const manualBroll: MaterialRevision = { ...manualAroll, id: "material-b-roll-1", material_purpose: "b_roll", source_path: "cutaway.mp4", storage_path: "episodes/episode-review/materials/manual-cutaway.mp4" };
    const manualBlueprint: Blueprint = { ...blueprint, policy: { a_roll: { execution_path: "manual" }, b_roll: { execution_path: "manual" } } };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ version: "storyboard/v1", audioCues: [{ description: "氛围音乐", durationSeconds: 5, id: "cue-bgm-1", kind: "bgm", searchQuery: "ambient", startSeconds: 0 }], shots: [{ durationSeconds: 5, id: "shot-a-roll-1", inputBasis: [{ relativePath: "episodes/episode-review/materials/script.md", sha256: "c".repeat(64) }], productionMethod: "人工出镜", scriptSegment: "主持人出镜说明。", shotType: "a_roll", targetSpec: "9:16" }, { durationSeconds: 5, id: "shot-b-roll-1", inputBasis: [{ relativePath: "episodes/episode-review/materials/script.md", sha256: "c".repeat(64) }], productionMethod: "人工素材", scriptSegment: "环境补充画面。", shotType: "b_roll", targetSpec: "9:16" }] }), { status: 200, headers: { "Content-Type": "application/json" } })));

    render(<EpisodeDetail {...materialInputProps} artifacts={[storyboardArtifact]} blueprint={manualBlueprint} episode={storyboardEpisode} isTransitionPending={false} materialRevisions={[manualAroll, manualBroll]} onSaveShotPreparationDraft={onSave} onTransition={vi.fn()} reviewPackages={[{
      artifact_id: storyboardArtifact.id,
      context_snapshot: {},
      created_at: "2026-08-23T00:00:00.000Z",
      episode_id: storyboardEpisode.id,
      id: "review-package-manual-a-roll",
      invalidated_at: null,
      invalidated_reason: null,
      revision_number: 1,
      stage: "storyboard_review",
      task_id: "task-manual-a-roll",
      task_run_id: "task-run-manual-a-roll",
    }]} tasks={[]} transitions={[]} />);

    await screen.findByLabelText("shot-a-roll-1 字幕正文");
    await user.click(screen.getByRole("switch", { name: "shot-a-roll-1 静音" }));
    await openVisualStep(user, "shot-a-roll-1");
    await user.selectOptions(screen.getByLabelText("shot-a-roll-1 当前原片"), manualAroll.id);
    await user.click(screen.getByRole("button", { name: "保存草稿" }));
    expect(screen.getByRole("button", { name: /^shot-a-roll-1 A-roll/ }).getAttribute("aria-expanded")).toBe("true");
    expect(within(screen.getByRole("tablist", { name: "shot-a-roll-1 镜头工作区" })).getByRole("tab", { name: "3 同步预览与确认" }).getAttribute("aria-selected")).toBe("true");
    await user.click(screen.getByRole("button", { name: /^shot-b-roll-1 B-roll/ }));
    await user.click(screen.getByRole("switch", { name: "shot-b-roll-1 静音" }));
    await openVisualStep(user, "shot-b-roll-1");
    await user.selectOptions(screen.getByLabelText("shot-b-roll-1 当前原片"), manualBroll.id);
    await user.click(screen.getByRole("button", { name: "保存草稿" }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ clipSegments: [{ end_seconds: 1, start_seconds: 0 }], episodeId: storyboardEpisode.id, materialRevisionId: manualAroll.id, reviewPackageId: "review-package-manual-a-roll", shotId: "shot-a-roll-1" }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ clipSegments: [{ end_seconds: 1, start_seconds: 0 }], episodeId: storyboardEpisode.id, materialRevisionId: manualBroll.id, reviewPackageId: "review-package-manual-a-roll", shotId: "shot-b-roll-1" }));
  });

  it("已保存原片可预览并在冻结前替换", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    const storyboardEpisode: Episode = { ...reviewEpisode, stage: "storyboard_approved" };
    const storyboardArtifact: Artifact = { ...previewArtifact, artifact_type: "storyboard", id: "artifact-bound-a-roll", producer_task_id: "task-bound-a-roll", relative_path: "episodes/episode-review/storyboard-bound-a-roll.json" };
    const manualAroll: MaterialRevision = {
      created_at: "2026-08-23T00:00:00.000Z", created_by: "owner-1", episode_id: storyboardEpisode.id, file_size: 2048, id: "material-a-roll-bound", is_main_script: false,
      material_purpose: "a_roll", material_type: "video", mime_type: "video/mp4", revision_number: 1, sha256: "d".repeat(64), source_kind: "file", source_path: "presenter.mp4", storage_path: "episodes/episode-review/materials/manual-presenter.mp4",
    };
    const replacementAroll: MaterialRevision = { ...manualAroll, id: "material-a-roll-replacement", source_path: "presenter-2.mp4", storage_path: "episodes/episode-review/materials/manual-presenter-2.mp4", sha256: "e".repeat(64) };
    const reviewPackage = {
      artifact_id: storyboardArtifact.id, context_snapshot: {}, created_at: "2026-08-23T00:00:00.000Z", episode_id: storyboardEpisode.id, id: "review-package-bound-a-roll", invalidated_at: null, invalidated_reason: null, revision_number: 1, stage: "storyboard_review" as const, task_id: "task-bound-a-roll", task_run_id: "task-run-bound-a-roll",
    };
    const draft: ShotPreparationDraft = { audio_mode: "none", audio_status: "ready", clip_segments: [{ start_seconds: 0, end_seconds: 5 }], confirmation_status: "pending", created_at: "2026-08-23T00:00:00.000Z", episode_id: storyboardEpisode.id, id: "draft-bound-a-roll", review_package_id: reviewPackage.id, selected_material_revision_id: manualAroll.id, shot_id: "shot-a-roll-1", subtitle_text: "主持人出镜说明。", subtitles_enabled: true, tts_speaking_rate: null, tts_text: null, tts_voice: null, updated_at: "2026-08-23T00:00:00.000Z", video_status: "pending" };
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => Promise.resolve(init?.method === "POST"
      ? localArtifactTicketResponse()
      : String(input).includes("storyboard")
        ? new Response(JSON.stringify({ version: "storyboard/v1", audioCues: [{ description: "可选氛围音乐", durationSeconds: 5, id: "cue-disabled-bgm", kind: "bgm", searchQuery: "ambient", startSeconds: 0 }], shots: [{ durationSeconds: 5, id: "shot-a-roll-1", inputBasis: [{ relativePath: manualAroll.storage_path, sha256: manualAroll.sha256 }], productionMethod: "人工出镜", scriptSegment: "主持人出镜说明。", shotType: "a_roll", targetSpec: "9:16" }] }), { status: 200, headers: { "Content-Type": "application/json" } })
        : new Response(new Blob(["video"], { type: "video/mp4" }), { status: 200 }))));

    render(<EpisodeDetail {...materialInputProps} artifacts={[storyboardArtifact]} blueprint={{ ...blueprint, policy: { a_roll: { execution_path: "manual" } } }} episode={storyboardEpisode} isTransitionPending={false} materialRevisions={[manualAroll, replacementAroll]} onSaveShotPreparationDraft={onSave} onTransition={vi.fn()} reviewPackages={[reviewPackage]} shotPreparationDrafts={[draft]} tasks={[]} transitions={[]} />);

    await screen.findByText("主持人出镜说明。");
    await openVisualStep(user, "shot-a-roll-1");
    expect(await screen.findByLabelText("presenter.mp4 预览")).toBeTruthy();
    await user.selectOptions(screen.getByLabelText("shot-a-roll-1 当前原片"), replacementAroll.id);
    expect(await screen.findByLabelText("presenter-2.mp4 预览")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "保存草稿" }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ clipSegments: [{ end_seconds: 5, start_seconds: 0 }], episodeId: storyboardEpisode.id, materialRevisionId: replacementAroll.id, reviewPackageId: reviewPackage.id, shotId: "shot-a-roll-1" }));
  });

  it("分镜产物格式无效时不允许 Owner 批准或退回", async () => {
    const storyboardEpisode: Episode = { ...reviewEpisode, stage: "storyboard_review" };
    const storyboardArtifact: Artifact = { ...previewArtifact, artifact_type: "storyboard", id: "artifact-invalid-storyboard", producer_task_id: "task-invalid-storyboard", relative_path: "episodes/episode-review/storyboard-invalid.json" };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } })));

    render(<EpisodeDetail {...materialInputProps} artifacts={[storyboardArtifact]} blueprint={blueprint} episode={storyboardEpisode} isTransitionPending={false} onTransition={vi.fn()} reviewPackages={[{
      artifact_id: storyboardArtifact.id,
      context_snapshot: {},
      created_at: "2026-08-15T00:00:00.000Z",
      episode_id: storyboardEpisode.id,
      id: "review-package-invalid-storyboard",
      invalidated_at: null,
      invalidated_reason: null,
      revision_number: 1,
      stage: "storyboard_review",
      task_id: "task-invalid-storyboard",
      task_run_id: "task-run-invalid-storyboard",
    }]} tasks={[]} transitions={[]} />);

    expect(await screen.findByText("分镜产物格式无效，无法审核。")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "批准" })).toBeNull();
    expect(screen.queryByRole("button", { name: "要求修改" })).toBeNull();
  });

  it("将预渲染成员作为审计证据，并自动进入审核渲染", async () => {
    const onReviewPreRenderMember = vi.fn().mockResolvedValue(undefined);
    const onTransition = vi.fn().mockResolvedValue(true);
    const productionEpisode: Episode = { ...reviewEpisode, stage: "production_ready" };
    const preRenderPackage = {
      artifact_id: null,
      context_snapshot: { approval_mode: "qc_only" },
      created_at: "2026-08-15T00:00:00.000Z",
      episode_id: productionEpisode.id,
      id: "pre-render-package-1",
      invalidated_at: null,
      invalidated_reason: null,
      revision_number: 1,
      stage: "production_ready" as const,
      task_id: null,
      task_run_id: null,
    };
    const member = {
      artifact_id: videoArtifact.id,
      audio_track_id: null,
      created_at: "2026-08-15T00:00:00.000Z",
      evidence_snapshot: {
        artifact: { relative_path: videoArtifact.relative_path, sha256: videoArtifact.sha256 },
        task: { model: "pexels-v1", prompt_version: "b-roll-v1", provider: "pexels" },
      },
      id: "pre-render-member-1",
      member_key: "shot:shot-02",
      member_kind: "shot_media",
      review_package_id: preRenderPackage.id,
      source_material_revision_id: null,
      source_task_id: "task-b-roll-1",
    };

    render(<EpisodeDetail {...materialInputProps} artifacts={[videoArtifact]} blueprint={blueprint} episode={productionEpisode} isTransitionPending={false} onReviewPreRenderMember={onReviewPreRenderMember} onTransition={onTransition} preRenderReviewMemberDecisions={[]} preRenderReviewMembers={[member]} reviewPackages={[preRenderPackage]} tasks={[]} transitions={[]} />);

    expect(screen.getByText("预渲染审核包 · 修订 v1")).toBeTruthy();
    expect(screen.getByText("媒体与音轨已冻结，正在自动生成审核渲染。" )).toBeTruthy();
    expect(screen.queryByRole("button", { name: "批准此项" })).toBeNull();
    expect(screen.queryByRole("button", { name: "批准预渲染包并进入合成" })).toBeNull();
    expect(onReviewPreRenderMember).not.toHaveBeenCalled();
    expect(onTransition).not.toHaveBeenCalled();
  });
});
