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
type MaterialRevision = Database["public"]["Tables"]["production_material_revisions"]["Row"];
type ShotPreparationDraft = Database["public"]["Tables"]["shot_preparation_drafts"]["Row"];
type PreRenderReviewMember = Database["public"]["Tables"]["pre_render_review_members"]["Row"];
type Task = Database["public"]["Tables"]["tasks"]["Row"];
const originalClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");

async function openVisualStep(user: ReturnType<typeof userEvent.setup>, shotId: string) {
  await user.click(within(screen.getByRole("navigation", { name: `${shotId} 准备步骤` })).getByRole("button", { name: "2 画面与标记" }));
}

const account: Account = {
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
  });

  it("Worker 排队或运行时显示持续刷新反馈", () => {
    render(<EpisodeDetail {...materialInputProps} artifacts={[]} blueprint={blueprint} episode={{ ...reviewEpisode, stage: "visual_draft" }} isTransitionPending={false} onTransition={vi.fn()} tasks={[{ ...blockedTask, claimed_at: null, completed_at: null, last_result: null, status: "ready" }]} transitions={[]} />);

    expect(screen.getByText("页面每 10 秒自动刷新任务状态")).toBeTruthy();
  });

  it("QC 通过但缺少发布材料时明确提示，不把 Worker 正常误写成已可发布", async () => {
    const user = userEvent.setup();
    const openPublish = vi.fn();
    window.addEventListener("open-publish", openPublish);
    render(<EpisodeDetail {...materialInputProps} artifacts={[]} blueprint={blueprint} episode={{ ...reviewEpisode, stage: "qc_passed" }} isTransitionPending={false} onTransition={vi.fn()} tasks={[]} transitions={[]} />);

    expect(screen.getByText("发布流程尚未完成")).toBeTruthy();
    expect(screen.getByText(/封面 缺少 · 元数据 缺少 · 发布包 缺少/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "查看发布准备 / 登记" }));
    expect(openPublish).toHaveBeenCalledOnce();
    window.removeEventListener("open-publish", openPublish);
  });

  it("通过顶部图标按需打开 Worker、产物索引和审计时间线", async () => {
    const user = userEvent.setup();
    render(<EpisodeDetail {...materialInputProps} artifacts={[previewArtifact]} blueprint={blueprint} episode={reviewEpisode} isTransitionPending={false} onTransition={vi.fn()} tasks={[blockedTask]} transitions={[{ actor_id: null, created_at: "2026-08-15T01:00:00.000Z", episode_id: reviewEpisode.id, from_stage: "script_draft" as const, id: "transition-utility", reason: "Worker submitted a frozen visual planning review package.", to_stage: "script_review" as const }]} />);

    await user.click(screen.getByRole("button", { name: /Worker 状态：已阻塞/ }));
    expect(screen.getByRole("dialog", { name: "Worker 状态" })).toBeTruthy();
    expect(screen.getByRole("dialog", { name: "Worker 状态" }).textContent).toContain("已阻塞");
    await user.click(screen.getByRole("button", { name: "查看产物索引" }));
    expect(screen.getByRole("dialog", { name: "产物索引" })).toBeTruthy();
    expect(screen.getByText(previewArtifact.relative_path)).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: "Worker 状态" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "查看审计时间线" }));
    expect(screen.getByRole("dialog", { name: "审计时间线" })).toBeTruthy();
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

    await user.click(screen.getByRole("button", { name: "查看审计时间线" }));
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

    const scriptFile = new File(["# 主脚本"], "script.md", { type: "text/markdown" });
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
    expect(Array.from(screen.getByRole("list", { name: "材料导入状态" }).querySelectorAll(".material-import-group-heading strong")).map((heading) => heading.textContent)).toEqual(["主脚本", "A-roll", "B-roll", "视觉参考"]);
    await user.click(screen.getByRole("button", { name: "下移 shot-1.mp4" }));
    await user.click(screen.getByRole("button", { name: "下移 cutaway-1.mp4" }));
    const confirmation = screen.getByRole("button", { name: "主脚本待确认：script.md" });
    expect(confirmation.closest("li")?.textContent).toContain("script.md");
    expect(confirmation.closest(".material-import-actions")?.children[1]).toBe(confirmation);
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
    act(() => resolvers.shift()?.());
    await waitFor(() => expect(onImportMaterial).toHaveBeenCalledTimes(4));
    act(() => resolvers.splice(0).forEach((resolve) => resolve()));
    await waitFor(() => expect(screen.queryByRole("list", { name: "材料导入状态" })).toBeNull());
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

  it("分镜批准后显示逐镜头准备草稿，并只保存音频模式与字幕", async () => {
    const user = userEvent.setup();
    const approvedEpisode: Episode = { ...reviewEpisode, id: "episode-shot-workbench", stage: "storyboard_approved", tts_language_code: "zh-CN", tts_speaking_rate: 1.35, tts_voice: "episode-voice" };
    const storyboardArtifact: Artifact = { ...previewArtifact, artifact_type: "storyboard", episode_id: approvedEpisode.id, id: "artifact-shot-workbench", relative_path: "episodes/episode-shot-workbench/storyboard.json" };
    const reviewPackage = { artifact_id: storyboardArtifact.id, context_snapshot: {}, created_at: "2026-09-03T00:00:00.000Z", episode_id: approvedEpisode.id, id: "review-package-shot-workbench", invalidated_at: null, invalidated_reason: null, revision_number: 1, stage: "storyboard_review" as const, task_id: "task-shot-workbench", task_run_id: "run-shot-workbench" };
    const drafts: ShotPreparationDraft[] = [{ clip_segments: [], audio_mode: "tts", audio_status: "pending", confirmation_status: "pending", created_at: "2026-09-03T00:00:00.000Z", episode_id: approvedEpisode.id, id: "draft-shot-1", review_package_id: reviewPackage.id, shot_id: "shot-1", subtitle_text: "第一镜字幕", subtitles_enabled: true, tts_speaking_rate: 1.35, tts_voice: "voice-a", updated_at: "2026-09-03T00:00:00.000Z", video_status: "pending" }, { ...({} as ShotPreparationDraft), audio_mode: "tts", audio_status: "pending", confirmation_status: "pending", created_at: "2026-09-03T00:00:00.000Z", episode_id: approvedEpisode.id, id: "draft-shot-2", review_package_id: reviewPackage.id, shot_id: "shot-2", subtitle_text: "第二镜字幕", subtitles_enabled: true, tts_speaking_rate: 1.35, tts_voice: "voice-a", updated_at: "2026-09-03T00:00:00.000Z", video_status: "pending" }];
    const onSave = vi.fn().mockResolvedValue(undefined);
    const materials: MaterialRevision[] = [
      { created_at: "2026-09-03T00:00:00.000Z", created_by: "owner-1", episode_id: approvedEpisode.id, file_size: 2048, id: "material-shot-workbench-a", is_main_script: false, material_purpose: "a_roll", material_type: "video", mime_type: "video/mp4", revision_number: 1, sha256: "b".repeat(64), source_kind: "file", source_path: "presenter.mp4", storage_path: "episodes/episode-shot-workbench/materials/presenter.mp4" },
      { created_at: "2026-09-03T00:00:00.000Z", created_by: "owner-1", episode_id: approvedEpisode.id, file_size: 2048, id: "material-shot-workbench-b", is_main_script: false, material_purpose: "b_roll", material_type: "video", mime_type: "video/mp4", revision_number: 1, sha256: "c".repeat(64), source_kind: "file", source_path: "cutaway.mp4", storage_path: "episodes/episode-shot-workbench/materials/cutaway.mp4" },
    ];
    const fetcher = vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ version: "storyboard/v1", audioCues: [], shots: [{ durationSeconds: 3, id: "shot-1", inputBasis: [{ relativePath: "script.md", sha256: "a".repeat(64) }], productionMethod: "人工", scriptSegment: "第一镜口播", shotType: "a_roll", targetSpec: "9:16" }, { durationSeconds: 2, id: "shot-2", inputBasis: [{ relativePath: "script.md", sha256: "a".repeat(64) }], productionMethod: "素材", scriptSegment: "第二镜口播", shotType: "b_roll", targetSpec: "9:16" }] }), { status: 200, headers: { "Content-Type": "application/json" } })));
    vi.stubGlobal("fetch", fetcher);
    const onSaveEpisodeTtsSettings = vi.fn().mockResolvedValue(undefined);

    const view = render(<EpisodeDetail {...materialInputProps} artifacts={[storyboardArtifact]} blueprint={{ ...blueprint, policy: { narration: { executor: { adapter: "volcengine_tts", model: "seed-tts-2.0", provider: "volcengine_tts" }, voice: { language_code: "zh-CN", name: "voice-a", speaking_rate: 1.35 } } } }} episode={approvedEpisode} isTransitionPending={false} materialRevisions={materials} onSaveEpisodeTtsSettings={onSaveEpisodeTtsSettings} onSaveShotPreparationDraft={onSave} onTransition={vi.fn()} reviewPackages={[reviewPackage]} shotPreparationDrafts={drafts} tasks={[]} transitions={[]} />);

    await screen.findByRole("heading", { name: "分镜工作台" });
    expect(screen.getByRole("button", { name: "在 OpenChatCut 中编辑" })).toBeTruthy();
    expect(screen.getByText("先打开可编辑工作版本并完成剪辑；只有点击“生成审核视频”才会冻结当前版本并提交 Worker。")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "生成审核视频" })).toBeNull();
    expect(screen.queryByRole("region", { name: "批量 TTS" })).toBeNull();
    expect(screen.queryByRole("button", { name: "生成准备片段" })).toBeNull();
    expect(screen.queryByText("Studio 前")).toBeNull();
    expect(screen.getByRole("switch", { name: /显示字幕/ })).toBeTruthy();
    expect(screen.queryByText(/历史音轨保留/)).toBeNull();
    expect((screen.getByLabelText("本期 TTS 声音") as HTMLSelectElement).value).toBe("episode-voice");
    expect((screen.getByLabelText("本期 TTS 语速") as HTMLInputElement).value).toBe("1.35");
    expect(screen.getByText("只影响当前 Episode；修改后旧音轨保留为历史，需要重新生成当前口播。")).toBeTruthy();
    expect(screen.queryByLabelText("shot-1 TTS 声音")).toBeNull();
    expect(screen.queryByRole("button", { name: "shot-1 试听当前音色" })).toBeNull();
    expect(screen.queryByRole("button", { name: "shot-1 恢复默认声音" })).toBeNull();
    const restoreScriptButton = screen.getByRole("button", { name: "shot-1 恢复分镜文案" });
    expect(restoreScriptButton.textContent).toBe("");
    expect(restoreScriptButton.getAttribute("title")).toBe("恢复分镜文案");
    expect(screen.queryByText("恢复默认声音")).toBeNull();
    expect(screen.queryByText(/默认声音：voice-a/)).toBeNull();
    expect(screen.queryByText(/基准文案：/)).toBeNull();
    expect(screen.queryByText("上传视频的声音")).toBeNull();
    await openVisualStep(user, "shot-1");
    expect(screen.getByRole("region", { name: "shot-1 画面准备" })).toBeTruthy();
    await user.selectOptions(screen.getByLabelText("shot-1 当前原片"), "material-shot-workbench-a");
    await user.click(screen.getByRole("button", { name: "保存镜头设置" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /^shot-1 A-roll/ }).getAttribute("aria-expanded")).toBe("false");
      expect(screen.getByRole("button", { name: /^shot-2 B-roll/ }).getAttribute("aria-expanded")).toBe("true");
    });
    expect(within(screen.getByRole("button", { name: /^shot-1 A-roll/ })).getByText("已保存")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "保存本期设置" }));
    expect(onSaveEpisodeTtsSettings).toHaveBeenCalledWith({ episodeId: approvedEpisode.id, languageCode: "zh-CN", speakingRate: 1.35, voice: "episode-voice" });
    const subtitleField = screen.getByLabelText("shot-2 字幕正文");
    await user.clear(subtitleField);
    await user.type(subtitleField, "修改后的字幕");
    expect(within(screen.getByRole("button", { name: /^shot-2 B-roll/ })).getByText("有未保存修改")).toBeTruthy();
    await openVisualStep(user, "shot-2");
    await user.selectOptions(screen.getByLabelText("shot-2 当前原片"), "material-shot-workbench-b");
    await user.click(screen.getByRole("button", { name: "保存镜头设置" }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ audioMode: "tts", clipSegments: [{ end_seconds: 2, start_seconds: 0 }], episodeId: approvedEpisode.id, materialRevisionId: "material-shot-workbench-b", reviewPackageId: reviewPackage.id, shotId: "shot-2", subtitleText: "修改后的字幕", subtitlesEnabled: true, ttsText: "第二镜字幕" }));
    expect(window.location.hash).toBe(`#storyboard-shot-${reviewPackage.id}-shot-2`);

    view.unmount();
    render(<EpisodeDetail {...materialInputProps} artifacts={[storyboardArtifact]} blueprint={{ ...blueprint, policy: { narration: { executor: { adapter: "volcengine_tts", model: "seed-tts-2.0", provider: "volcengine_tts" }, voice: { language_code: "zh-CN", name: "voice-a", speaking_rate: 1.35 } } } }} episode={approvedEpisode} isTransitionPending={false} materialRevisions={materials} onSaveEpisodeTtsSettings={onSaveEpisodeTtsSettings} onSaveShotPreparationDraft={onSave} onTransition={vi.fn()} reviewPackages={[reviewPackage]} shotPreparationDrafts={drafts} tasks={[]} transitions={[]} />);
    await screen.findByRole("heading", { name: "分镜工作台" });
    expect(screen.getByRole("button", { name: /^shot-1 A-roll/ }).getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByRole("button", { name: /^shot-2 B-roll/ }).getAttribute("aria-expanded")).toBe("true");
  });

  it("审核阶段可返回可编辑镜头工作台，且保留当前 QC 证据", async () => {
    const user = userEvent.setup();
    const qcEpisode: Episode = { ...reviewEpisode, id: "episode-return-workbench", stage: "qc_review", tts_language_code: "zh-CN", tts_speaking_rate: 1.2, tts_voice: "voice-a" };
    const storyboardArtifact: Artifact = { ...previewArtifact, artifact_type: "storyboard", episode_id: qcEpisode.id, id: "artifact-return-storyboard", relative_path: "episodes/episode-return-workbench/storyboard.json" };
    const qcArtifact: Artifact = { ...videoArtifact, episode_id: qcEpisode.id, id: "artifact-return-qc", relative_path: "episodes/episode-return-workbench/review-render/v2/video.mp4" };
    const storyboardPackage = { artifact_id: storyboardArtifact.id, context_snapshot: {}, created_at: "2026-09-09T00:00:00.000Z", episode_id: qcEpisode.id, id: "review-return-storyboard", invalidated_at: null, invalidated_reason: null, revision_number: 1, stage: "storyboard_review" as const, task_id: "task-return-storyboard", task_run_id: "run-return-storyboard" };
    const qcPackage = { ...storyboardPackage, artifact_id: qcArtifact.id, context_snapshot: { pre_render_review_package_id: "review-return-snapshot", project_relative_path: "episodes/episode-return-workbench/openchatcut-frozen/revision-2/project.json", project_revision: "revision-2", review_kind: "openchatcut_review_render", technical_evidence: { checks: [{ detail: "视频可解码", name: "decode" }] } }, id: "review-return-qc", revision_number: 2, stage: "qc_review" as const, task_id: "task-return-qc", task_run_id: "run-return-qc" };
    const draft = { audio_mode: "none", audio_status: "ready", clip_segments: [{ end_seconds: 3, start_seconds: 0 }], confirmation_status: "confirmed", created_at: "2026-09-09T00:00:00.000Z", episode_id: qcEpisode.id, frozen_at: "2026-09-09T00:01:00.000Z", id: "draft-return-shot", input_fingerprint: "fingerprint", review_package_id: storyboardPackage.id, selected_material_revision_id: "material-return", shot_id: "shot-1", subtitle_text: "可继续修改的字幕", subtitles_enabled: true, updated_at: "2026-09-09T00:01:00.000Z", video_duration_seconds: 3, video_status: "ready" } as unknown as ShotPreparationDraft;
    const material = { created_at: "2026-09-09T00:00:00.000Z", created_by: "owner-1", episode_id: qcEpisode.id, file_size: 2048, id: "material-return", is_main_script: false, material_purpose: "a_roll", material_type: "video", mime_type: "video/mp4", revision_number: 1, sha256: "b".repeat(64), source_kind: "file", source_path: "presenter.mp4", storage_path: "episodes/episode-return-workbench/materials/presenter.mp4" } as MaterialRevision;
    const onOpenStudio = vi.fn().mockResolvedValue({ fileSize: 1024, relativePath: "episodes/episode-return-workbench/openchatcut/session-1/project.json", sha256: "c".repeat(64) });
    const onGenerateShotReviewVideo = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("fetch", vi.fn().mockImplementation((input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("_local-artifact-ticket")) return Promise.resolve(Response.json({ url: "/_local-artifact?ticket=return-qc" }));
      return Promise.resolve(new Response(JSON.stringify({ version: "storyboard/v1", audioCues: [], shots: [{ durationSeconds: 3, id: "shot-1", inputBasis: [{ relativePath: "script.md", sha256: "a".repeat(64) }], productionMethod: "人工", scriptSegment: "第一镜口播", shotType: "a_roll", targetSpec: "9:16" }] }), { status: 200, headers: { "Content-Type": "application/json" } }));
    }));

    const view = render(<EpisodeDetail {...materialInputProps} artifacts={[storyboardArtifact, qcArtifact]} blueprint={blueprint} episode={qcEpisode} isTransitionPending={false} materialRevisions={[material]} onGenerateShotReviewVideo={onGenerateShotReviewVideo} onOpenStudio={onOpenStudio} onTransition={vi.fn()} reviewPackages={[storyboardPackage, qcPackage]} shotPreparationDrafts={[draft]} tasks={[]} transitions={[]} />);

    expect(screen.getByRole("heading", { name: /OpenChatCut 审核渲染/ })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "分镜工作台" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "返回镜头工作台修改" }));
    await screen.findByRole("region", { name: "分镜工作台" });
    expect((screen.getByLabelText("shot-1 字幕正文") as HTMLTextAreaElement).disabled).toBe(false);
    expect(screen.getByRole("heading", { name: /OpenChatCut 审核渲染/ })).toBeTruthy();
    expect((screen.getByRole("treeitem", { name: /调整镜头/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole("button", { name: "生成审核视频" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "在 OpenChatCut 中编辑" }));
    await waitFor(() => expect(onOpenStudio).toHaveBeenCalledWith(qcEpisode.id, storyboardArtifact.relative_path, { allowedFrames: 2, frameRate: 30 }));
    expect(onGenerateShotReviewVideo).not.toHaveBeenCalled();
    expect(screen.getByText("当前可编辑工作版本：episodes/episode-return-workbench/openchatcut/session-1/project.json")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "生成审核视频" }));
    expect(onGenerateShotReviewVideo).toHaveBeenCalledWith(expect.objectContaining({ episodeId: qcEpisode.id, storyboardRelativePath: storyboardArtifact.relative_path, workspaceRelativePath: "episodes/episode-return-workbench/openchatcut/session-1/project.json" }));

    const unreadyDraft = { ...draft, selected_material_revision_id: null, updated_at: "2026-09-09T00:02:00.000Z" };
    view.rerender(<EpisodeDetail {...materialInputProps} artifacts={[storyboardArtifact, qcArtifact]} blueprint={blueprint} episode={qcEpisode} isTransitionPending={false} materialRevisions={[material]} onGenerateShotReviewVideo={onGenerateShotReviewVideo} onOpenStudio={onOpenStudio} onTransition={vi.fn()} reviewPackages={[storyboardPackage, qcPackage]} shotPreparationDrafts={[unreadyDraft]} tasks={[]} transitions={[]} />);
    await waitFor(() => expect(screen.queryByRole("button", { name: "生成审核视频" })).toBeNull());

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
      const tree = screen.getByRole("tree", { name: `${shotId} 镜头设置` });
      await user.click(within(tree).getByRole("treeitem", { name: /调整镜头/ }));
      await user.click(within(tree).getByRole("button", { name: label }));
      return screen.getByRole("dialog", { name: `${shotId} ${label}` });
    };
    const firstDialog = await openOperation("shot-1", "合并镜头");
    const firstMergeTarget = screen.getByLabelText("合并对象") as HTMLSelectElement;
    expect([...firstMergeTarget.options].map((option) => option.value)).toEqual(["", "shot-2"]);
    await user.click(within(firstDialog).getByRole("button", { name: "关闭镜头设置" }));

    for (const label of ["新增镜头", "删除镜头", "拆分镜头", "调整顺序", "修改镜头类型", "修改目标时长"]) {
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
    expect((within(screen.getByRole("tree", { name: "shot-2 镜头设置" })).getByRole("treeitem", { name: /调整镜头/ }) as HTMLButtonElement).disabled).toBe(true);
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
    const tree = screen.getByRole("tree", { name: "shot-2 镜头设置" });
    await user.click(within(tree).getByRole("treeitem", { name: /调整镜头/ }));
    await user.click(within(tree).getByRole("button", { name: "删除镜头" }));
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

  it("逐镜头 TTS 可先于原片标记生成，完整保存仍要求视频", async () => {
    const user = userEvent.setup();
    const approvedEpisode: Episode = { ...reviewEpisode, id: "episode-shot-tts", stage: "storyboard_approved" };
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
    await user.click(screen.getByRole("button", { name: "保存口播设置" }));
    await user.click(screen.getByRole("button", { name: "生成口播" }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ includeVideo: false, materialRevisionId: "" }));
    expect(onGenerateTts).toHaveBeenCalledWith({ episodeId: approvedEpisode.id, reviewPackageId: reviewPackage.id, retry: false, shotId: "shot-1" });
    await openVisualStep(user, "shot-1");
    expect(screen.getByLabelText("shot-1 当前原片")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "保存镜头设置" }));
    expect(screen.getByRole("alert").textContent).toContain("请选择原片并完成至少一个有效片段标记");
    expect(onSave).toHaveBeenCalledTimes(2);
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
    await user.click(screen.getByRole("treeitem", { name: /声音设置/ }));
    await user.type(screen.getByLabelText("shot-1 单独设置声音"), "voice-b");
    await user.clear(screen.getByLabelText("shot-1 单独设置语速"));
    await user.type(screen.getByLabelText("shot-1 单独设置语速"), "1.5");
    await user.click(screen.getByRole("button", { name: "保存此镜头设置" }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ ttsOverride: { speakingRate: 1.5, voice: "voice-b" } }));
    await user.click(screen.getByLabelText("shot-1 更多操作"));
    await user.click(screen.getByRole("treeitem", { name: /声音设置/ }));
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

  it("保留原声会把原片音轨与片段标记一起交给 Studio", async () => {
    const approvedEpisode: Episode = { ...reviewEpisode, id: "episode-shot-source", stage: "storyboard_approved" };
    const storyboardArtifact: Artifact = { ...previewArtifact, artifact_type: "storyboard", episode_id: approvedEpisode.id, id: "artifact-shot-source", relative_path: "episodes/episode-shot-source/storyboard.json" };
    const preparedVideo: Artifact = { ...previewArtifact, artifact_type: "shot_video", episode_id: approvedEpisode.id, id: "artifact-prepared-source", file_size: 4096, relative_path: "episodes/episode-shot-source/video/shot-1-v2.mp4" };
    const reviewPackage = { artifact_id: storyboardArtifact.id, context_snapshot: {}, created_at: "2026-09-03T00:00:00.000Z", episode_id: approvedEpisode.id, id: "review-package-shot-source", invalidated_at: null, invalidated_reason: null, revision_number: 1, stage: "storyboard_review" as const, task_id: "task-shot-source", task_run_id: "run-shot-source" };
    const sourceTask: Task = { ...blockedTask, completed_at: "2026-09-03T00:02:00.000Z", created_at: "2026-09-03T00:01:00.000Z", episode_id: approvedEpisode.id, id: "task-source-audio", input_snapshot: { shot_preparation: { review_package_id: reviewPackage.id, shot_id: "shot-1" }, source_video_artifact: { id: preparedVideo.id } }, last_result: null, model: "ffmpeg", prompt_version: "shot-source-audio-v1", provider: "ffmpeg", status: "completed", task_type: "extract_embedded_audio" };
    const sourceRetryTask: Task = { ...sourceTask, created_at: "2026-09-03T00:04:00.000Z", id: "task-source-audio-failed", last_result: { blockers: [{ code: "ffmpeg_failed", detail: "源片段没有可提取音轨。" }] }, status: "failed" };
    const clipTask: Task = { ...sourceTask, id: "task-prepared-video", input_snapshot: {}, task_type: "generate_b_roll" };
    const sourceTrack = { created_at: "2026-09-03T00:03:00.000Z", cue_id: "shot-1", duration_seconds: 2.984, episode_id: approvedEpisode.id, file_size: 1024, id: "track-source-v2", relative_path: "episodes/episode-shot-source/audio/shot-source.mp3", sha256: "c".repeat(64), source_artifact_id: "artifact-source-audio", source_material_revision_id: null, source_review_package_id: reviewPackage.id, source_task_id: sourceTask.id, start_seconds: 0, track_kind: "source" };
    const draft: ShotPreparationDraft = { clip_segments: [], audio_mode: "source", audio_status: "failed", confirmation_status: "pending", created_at: "2026-09-03T00:00:00.000Z", current_video_artifact_id: preparedVideo.id, current_video_task_id: clipTask.id, episode_id: approvedEpisode.id, id: "draft-shot-source", review_package_id: reviewPackage.id, selected_material_revision_id: null, shot_id: "shot-1", source_audio_duration_seconds: 2.984, source_audio_error: "源片段没有可提取音轨。", subtitle_text: "原声字幕", subtitles_enabled: true, tts_speaking_rate: null, tts_voice: null, updated_at: "2026-09-03T00:04:00.000Z", video_status: "ready" };
    vi.stubGlobal("fetch", vi.fn((_input: RequestInfo | URL, init?: RequestInit) => Promise.resolve(init?.method === "POST" ? localArtifactTicketResponse() : new Response(JSON.stringify({ version: "storyboard/v1", audioCues: [], shots: [{ durationSeconds: 3, id: "shot-1", inputBasis: [{ relativePath: "script.md", sha256: "a".repeat(64) }], productionMethod: "人工", scriptSegment: "第一镜口播", shotType: "a_roll", targetSpec: "9:16" }] }), { status: 200, headers: { "Content-Type": "application/json" } }))));

    render(<EpisodeDetail {...materialInputProps} artifacts={[storyboardArtifact, preparedVideo]} blueprint={blueprint} episode={approvedEpisode} isTransitionPending={false} onTransition={vi.fn()} audioTracks={[sourceTrack]} reviewPackages={[reviewPackage]} shotPreparationDrafts={[draft]} tasks={[clipTask, sourceTask, sourceRetryTask]} transitions={[]} />);

    await screen.findByRole("heading", { name: "分镜工作台" });
    expect(screen.getByDisplayValue("原声字幕")).toBeTruthy();
    expect(screen.getByText(/使用片段对应的原片声音，不创建 TTS 任务/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /提取当前原声/ })).toBeNull();
    expect(await screen.findByLabelText("source 音轨")).toBeTruthy();
    expect(screen.getByText("0s – 2.984s")).toBeTruthy();
    expect(screen.getByText(reviewPackage.id.slice(0, 8))).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "音轨" })).toBeNull();
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
    expect(screen.getByText(/已明确静音/)).toBeTruthy();
    expect(screen.getByText(/该镜头不生成口播音轨/)).toBeTruthy();
    await user.clear(screen.getByLabelText("shot-1 字幕正文"));
    await openVisualStep(user, "shot-1");
    await user.selectOptions(screen.getByLabelText("shot-1 当前原片"), source.id);
    await user.click(screen.getByRole("button", { name: "保存镜头设置" }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ audioMode: "none", episodeId: approvedEpisode.id, reviewPackageId: reviewPackage.id, shotId: "shot-1", subtitleText: "", subtitlesEnabled: false }));
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
    expect(screen.getByText("A-roll · 当前片段 2.000s / 计划 3s")).toBeTruthy();
    expect(screen.getByLabelText("镜头时长判定").textContent).toContain("口播 5.800s");
    const preview = await screen.findByLabelText("presenter.mp4 预览") as HTMLVideoElement;
    const pause = vi.spyOn(preview, "pause").mockImplementation(() => undefined);
    preview.currentTime = 2;
    fireEvent.timeUpdate(preview);
    expect(document.querySelector<HTMLElement>(".clip-filmstrip-playhead")?.style.left).toBe("66.66666666666666%");
    preview.currentTime = 3;
    fireEvent.timeUpdate(preview);
    expect(pause).toHaveBeenCalled();
    preview.currentTime = 2;
    fireEvent.play(preview);
    expect(preview.currentTime).toBe(1);
    Object.defineProperty(preview, "duration", { configurable: true, value: 10 });
    fireEvent.loadedMetadata(preview);
    await user.click(screen.getByRole("button", { name: "按口播时长调整" }));
    expect(screen.getByLabelText("镜头时长判定").textContent).toContain("音画时长一致");
    await user.click(screen.getByRole("button", { name: "添加片段" }));
    expect(onGenerateTts).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "按口播时长调整" })).toBeNull();
    expect(screen.getByLabelText("镜头时长判定").textContent).toContain("多片段仅提示总量：请减少 3.000s");
    await user.click(screen.getByRole("button", { name: "保存镜头设置" }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ clipSegments: [{ end_seconds: 6.8, start_seconds: 1 }, { end_seconds: 3, start_seconds: 0 }], episodeId: approvedEpisode.id, materialRevisionId: source.id, reviewPackageId: reviewPackage.id, shotId: "shot-1" }));
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
    const onOpenStudio = vi.fn().mockResolvedValue({ fileSize: 24, relativePath: "episodes/episode-qc/studio/00000000-0000-0000-0000-000000000001/index.html", sha256: "a".repeat(64) });
    const props = { ...materialInputProps, artifacts: [renderArtifact], blueprint, episode: qcEpisode, isTransitionPending: false, onOpenStudio, onSubmitStudioRevision, onTransition: vi.fn(), reviewPackages: [qcPackage], tasks: [renderTask], transitions: [] };
    render(<EpisodeDetail {...props} />);

    expect(screen.getByRole("heading", { name: "在 OpenChatCut 编辑" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "在 OpenChatCut 中打开" }));
    expect(onOpenStudio).toHaveBeenCalledWith(qcEpisode.id, "episodes/episode-qc/review-render/v2/index.html");
    await user.click(screen.getByRole("button", { name: "提交 OpenChatCut 修改" }));
    await user.type(screen.getByLabelText("OpenChatCut 修改说明"), "字幕需要更醒目。");
    await user.click(screen.getByRole("button", { name: "确认并重新审核" }));
    expect(onSubmitStudioRevision).toHaveBeenCalledWith(expect.objectContaining({ episodeId: qcEpisode.id, reason: "字幕需要更醒目。", reviewPackageId: qcPackage.id, sourceProjectRelativePath: "episodes/episode-qc/review-render/v2/index.html", workspaceRelativePath: expect.stringContaining("/studio/") }));
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
    expect(screen.getByText("本阶段确认镜头顺序、内容与时长；实际片段和裁剪范围将在镜头准备阶段确定。")).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "分镜时间轴" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "选择 shot-02，4.5 秒，B-roll" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("4.5 秒")).toBeTruthy();
    expect(screen.getByText("素材库特写 + 环境音")).toBeTruthy();
    expect(screen.getByText("9:16，1080×1920，24fps")).toBeTruthy();
    expect(screen.getByText("先确认铜铃的音效节奏。")).toBeTruthy();
    expect(screen.getByText("第 1 / 2 镜")).toBeTruthy();

    await user.type(screen.getByLabelText("shot-02 镜头批注"), "铜铃特写需要延长。");
    await user.click(screen.getByRole("button", { name: "选择 shot-03，3 秒，A-roll" }));
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
    await user.click(screen.getByRole("radio", { name: "无口播" }));
    await openVisualStep(user, "shot-a-roll-1");
    await user.selectOptions(screen.getByLabelText("shot-a-roll-1 当前原片"), manualAroll.id);
    await user.click(screen.getByRole("button", { name: "保存镜头设置" }));
    await waitFor(() => expect(screen.getByRole("button", { name: /^shot-b-roll-1 B-roll/ }).getAttribute("aria-expanded")).toBe("true"));
    await user.click(screen.getByRole("radio", { name: "无口播" }));
    await openVisualStep(user, "shot-b-roll-1");
    await user.selectOptions(screen.getByLabelText("shot-b-roll-1 当前原片"), manualBroll.id);
    await user.click(screen.getByRole("button", { name: "保存镜头设置" }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ clipSegments: [{ end_seconds: 5, start_seconds: 0 }], episodeId: storyboardEpisode.id, materialRevisionId: manualAroll.id, reviewPackageId: "review-package-manual-a-roll", shotId: "shot-a-roll-1" }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ clipSegments: [{ end_seconds: 5, start_seconds: 0 }], episodeId: storyboardEpisode.id, materialRevisionId: manualBroll.id, reviewPackageId: "review-package-manual-a-roll", shotId: "shot-b-roll-1" }));
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
    await user.click(screen.getByRole("button", { name: "保存镜头设置" }));
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
