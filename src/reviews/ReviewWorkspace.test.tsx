import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "../lib/database.types";
import { EpisodeDetail, EpisodeDetailDrawer, ReviewWorkspace } from "../App";

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
type PreRenderReviewMember = Database["public"]["Tables"]["pre_render_review_members"]["Row"];
type Task = Database["public"]["Tables"]["tasks"]["Row"];
const originalClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");

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
  policy: { asset_root: "/Volumes/素材盘/tk-workflow/dao" },
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

describe("审核台", () => {
  beforeEach(() => {
    const storage = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      clear: () => storage.clear(),
      getItem: (key: string) => storage.get(key) ?? null,
      removeItem: (key: string) => storage.delete(key),
      setItem: (key: string, value: string) => storage.set(key, value),
    });
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => Promise.resolve(new Response(new Blob(["preview"], { type: "image/png" }), { status: 200 }))));
    vi.stubGlobal("URL", { createObjectURL: vi.fn().mockReturnValue("blob:local-preview"), revokeObjectURL: vi.fn() });
  });

  afterEach(() => {
    cleanup();
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

  it("在详情顶部显示当前阶段和下一步，并默认收起技术索引", () => {
    render(<EpisodeDetail {...materialInputProps} artifacts={[]} blueprint={blueprint} episode={reviewEpisode} isTransitionPending={false} onTransition={vi.fn()} tasks={[]} transitions={[]} />);

    expect(screen.getByText("审核生成脚本")).toBeTruthy();
    expect(screen.queryByText("工作标题（可留空）")).toBeNull();
    expect(screen.queryByRole("heading", { name: "生产单管理" })).toBeNull();
    expect(screen.getByRole("button", { name: "查看产物索引" }).getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("heading", { name: "产物索引" })).toBeNull();
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
    expect(screen.getByText("Worker 已提交冻结的视觉规划审核包。", { exact: false })).toBeTruthy();
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

    expect((await screen.findByAltText("cover 产物预览")).getAttribute("src")).toBe("blob:local-preview");
    expect(fetch).toHaveBeenCalledWith("/_local-artifact?episode=episode-review&path=episodes%2Fepisode-review%2Fcover.png", { headers: { Authorization: "Bearer owner-token" } });
    expect(screen.getByText("MISSING_ASSET")).toBeTruthy();
    expect(screen.getByText("缺少已批准的脚本产物。")).toBeTruthy();

    await user.selectOptions(screen.getByLabelText("预览产物"), videoArtifact.id);
    expect((await screen.findByLabelText("render 产物预览")).getAttribute("src")).toBe("blob:local-preview");
    expect(fetch).toHaveBeenLastCalledWith("/_local-artifact?episode=episode-review&path=episodes%2Fepisode-review%2Frender.mp4", { headers: { Authorization: "Bearer owner-token" } });

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

  it("展示可试听的旁白音轨并将时间批注交给受控 RPC", async () => {
    const user = userEvent.setup();
    const onCreateAudioTrackAnnotation = vi.fn().mockResolvedValue(undefined);
    render(<EpisodeDetail {...materialInputProps} artifacts={[]} audioTracks={[{
      id: "audio-1", episode_id: reviewEpisode.id, source_task_id: "task-audio", source_artifact_id: "artifact-audio", source_material_revision_id: null, source_review_package_id: "package-1", track_kind: "narration", cue_id: "shot-02", relative_path: "episodes/episode-review/audio/narration.mp3", sha256: "a".repeat(64), file_size: 10, start_seconds: 2, duration_seconds: 8, created_at: "2026-08-15T00:00:00.000Z",
    }]} audioTrackAnnotations={[]} blueprint={blueprint} episode={reviewEpisode} isTransitionPending={false} onCreateAudioTrackAnnotation={onCreateAudioTrackAnnotation} onTransition={vi.fn()} tasks={[]} transitions={[]} />);

    expect(await screen.findByLabelText("narration 音轨")).toBeTruthy();
    expect(fetch).toHaveBeenCalledWith(`/_local-artifact?episode=episode-review&path=episodes%2Fepisode-review%2Faudio%2Fnarration.mp3&sha256=${"a".repeat(64)}`, { headers: { Authorization: "Bearer owner-token" } });
    expect(screen.getByLabelText("narration 音轨").closest(".audio-track-card")).toBeTruthy();
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
    expect(screen.getByRole("img", { name: "cover 产物放大预览" }).getAttribute("src")).toBe("blob:local-preview");
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
    const localInputPath = "/Volumes/素材盘/tk-workflow/dao/episodes/episode-review/input";
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

  it("材料区只提供分类文件上传", () => {
    const waitingEpisode: Episode = { ...reviewEpisode, id: "episode-file-only", stage: "waiting_input" };
    render(<EpisodeDetail {...materialInputProps} artifacts={[]} blueprint={blueprint} episode={waitingEpisode} isTransitionPending={false} onTransition={vi.fn()} tasks={[]} transitions={[]} />);

    expect(screen.getByRole("region", { name: "素材分类上传" })).toBeTruthy();
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
    expect(screen.getByRole("button", { name: "导入所选材料" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "素材分类上传" })).toBeTruthy();
    expect((screen.getByLabelText("上传A-shot") as HTMLInputElement).multiple).toBe(true);
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
    expect(screen.getByRole("button", { name: "导入所选材料" })).toBeTruthy();
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

  it("通过常驻分类上传槽导入脚本、主角视觉和多个 A-shot", async () => {
    const user = userEvent.setup();
    const onImportMaterial = vi.fn().mockResolvedValue(undefined);
    const waitingEpisode: Episode = { ...reviewEpisode, id: "episode-materials", stage: "waiting_input", title: "首次准备材料" };

    render(<EpisodeDetail {...materialInputProps} artifacts={[]} blueprint={blueprint} episode={waitingEpisode} isStartProductionPending={false} onImportMaterial={onImportMaterial} onStartProduction={vi.fn()} isTransitionPending={false} onTransition={vi.fn()} tasks={[]} transitions={[]} />);

    const scriptFile = new File(["# 主脚本"], "script.md", { type: "text/markdown" });
    const imageFile = new File(["image"], "character.png", { type: "image/png" });
    const firstShot = new File(["video"], "shot-1.mp4", { type: "video/mp4" });
    const secondShot = new File(["video"], "shot-2.mp4", { type: "video/mp4" });
    await user.upload(screen.getByLabelText("上传脚本"), scriptFile);
    await user.upload(screen.getByLabelText("上传主角视觉"), imageFile);
    await user.upload(screen.getByLabelText("上传A-shot"), [firstShot, secondShot]);

    expect(screen.getByText("已选择 4 个文件；导入时会按卡片类别固定命名。")).toBeTruthy();
    expect(screen.getByText("shot-1.mp4")).toBeTruthy();
    expect(screen.getByText("shot-2.mp4")).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "我已检查内容，明确确认这是本生产单的主脚本。" })).toBeTruthy();
    await user.click(screen.getByRole("checkbox", { name: "我已检查内容，明确确认这是本生产单的主脚本。" }));
    await user.click(screen.getByRole("button", { name: "导入所选材料" }));

    await waitFor(() => expect(onImportMaterial).toHaveBeenCalledTimes(4));
    expect(onImportMaterial).toHaveBeenNthCalledWith(1, expect.objectContaining({ isMainScript: true, materialPurpose: "main_script", materialType: "script", sourcePath: "script.md" }));
    expect(onImportMaterial).toHaveBeenNthCalledWith(2, expect.objectContaining({ isMainScript: false, materialPurpose: "visual_reference", materialType: "image", sourcePath: "character.png" }));
    expect(onImportMaterial).toHaveBeenNthCalledWith(3, expect.objectContaining({ materialPurpose: "a_roll", materialType: "video", logicalName: "a-shot-001.mp4", sourcePath: "shot-1.mp4" }));
    expect(onImportMaterial).toHaveBeenNthCalledWith(4, expect.objectContaining({ materialPurpose: "a_roll", materialType: "video", logicalName: "a-shot-002.mp4", sourcePath: "shot-2.mp4" }));
  });

  it("由 Owner 明确决定上传视频保留原声或使用 TTS", async () => {
    const user = userEvent.setup();
    const onUpdateAudioSourceMode = vi.fn().mockResolvedValue(undefined);
    const readyEpisode: Episode = { ...reviewEpisode, id: "episode-audio-source", stage: "waiting_input", main_script_revision_id: "revision-script-1" };
    const uploadedVideo: MaterialRevision = {
      created_at: "2026-08-23T00:00:00.000Z", created_by: "owner-1", episode_id: readyEpisode.id, file_size: 2048, id: "material-source-video", is_main_script: false,
      material_purpose: "a_roll", material_type: "video", mime_type: "video/mp4", revision_number: 1, sha256: "d".repeat(64), source_kind: "file", source_path: "presenter.mp4", storage_path: "episodes/episode-audio-source/materials/a-shot-001.mp4",
    };

    render(<EpisodeDetail {...materialInputProps} artifacts={[]} blueprint={blueprint} episode={readyEpisode} isStartProductionPending={false} materialRevisions={[uploadedVideo]} onStartProduction={vi.fn()} onTransition={vi.fn()} onUpdateAudioSourceMode={onUpdateAudioSourceMode} isTransitionPending={false} tasks={[]} transitions={[]} />);

    expect((screen.getByRole("radio", { name: /使用 TTS 替代原声/ }) as HTMLInputElement).checked).toBe(true);
    await user.click(screen.getByRole("radio", { name: /保留上传视频原声/ }));
    expect(onUpdateAudioSourceMode).toHaveBeenCalledWith(readyEpisode.id, "source");
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
    vi.stubGlobal("fetch", vi.fn().mockImplementation((source: string) => Promise.resolve(new Response(source.includes("visual-references") ? "# 角色\n\n林砚：雨夜深色雨衣。" : "# 视觉方案\n\n第一镜：雨夜古宅。", { status: 200, headers: { "Content-Type": "text/markdown" } }))));

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
    const frozenContext = screen.getByText("冻结审核上下文").closest("details");
    expect(frozenContext?.open).toBe(true);
    await user.click(screen.getByText("冻结审核上下文"));
    expect(frozenContext?.open).toBe(false);

    await user.type(screen.getByLabelText("审批理由"), "视觉方向清晰，符合主脚本。");
    await user.click(screen.getByRole("button", { name: "批准" }));
    expect(onTransition).toHaveBeenLastCalledWith(visualEpisode.id, "visual_approved", "视觉方向清晰，符合主脚本。");
    await user.click(screen.getByRole("button", { name: "要求修改" }));
    expect(onTransition).toHaveBeenLastCalledWith(visualEpisode.id, "visual_draft", "视觉方向清晰，符合主脚本。");
  });

  it("将冻结的外部视觉输入连同视觉资产清单交给 Owner 审核", async () => {
    const visualEpisode: Episode = { ...reviewEpisode, stage: "visual_review" };
    const manifest: Artifact = {
      ...previewArtifact,
      artifact_type: "visual_asset_manifest",
      id: "artifact-visual-assets",
      producer_task_id: "task-visual-assets",
      relative_path: "episodes/episode-review/visual-assets-v1.md",
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("# 视觉资产清单\n\n- 已提供：林砚角色参考。", { status: 200, headers: { "Content-Type": "text/markdown" } })));

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
          external_inputs: [{ artifactType: "external_visual_input", relativePath: "episodes/episode-review/materials/character.png", sha256: "b".repeat(64), fileSize: 128 }],
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
    expect(screen.getByText("已冻结的外部视觉输入")).toBeTruthy();
    expect(screen.getByText("episodes/episode-review/materials/character.png")).toBeTruthy();
    expect(screen.queryByText("视觉审核包缺少参考组。")).toBeNull();
  });

  it("在 Studio 提交一次合成修订并重新审核", async () => {
    const user = userEvent.setup();
    const onSubmitStudioRevision = vi.fn().mockResolvedValue({ kind: "composition" });
    const qcEpisode: Episode = { ...reviewEpisode, id: "episode-qc", stage: "qc_review", title: "合成调整" };
    const renderArtifact: Artifact = { ...previewArtifact, episode_id: qcEpisode.id, artifact_type: "render", id: "artifact-qc-render", producer_task_id: "task-qc-render", relative_path: "episodes/episode-qc/review-render/v2/review-render.mp4" };
    const qcPackage = {
      artifact_id: renderArtifact.id,
      context_snapshot: { review_kind: "hyperframes_review_render", pre_render_review_package_id: "pre-render-package", project_revision: "2", project_relative_path: "episodes/episode-qc/review-render/v2/index.html", composition_adjustments: { caption_style: "minimal", pacing: "gentle", crop: "contain", transition: "cut", layout: "center" }, technical_evidence: { checks: [] } },
      created_at: "2026-08-15T00:00:00.000Z", episode_id: qcEpisode.id, id: "review-package-qc-2", invalidated_at: null, invalidated_reason: null, revision_number: 2, stage: "qc_review" as const, task_id: "task-qc-render", task_run_id: "task-run-qc-render",
    };
    const renderTask = { ...blockedTask, id: qcPackage.task_id, episode_id: qcEpisode.id, input_snapshot: { review_render: { adjustments: { aspect_ratio: "9:16", width: 1080, height: 1920, captions_enabled: true, caption_style: "minimal", crop: "contain", pacing: "gentle", transition: "cut", layout: "center", narration_gain_db: 0, bgm_gain_db: -12, sfx_gain_db: -6 } } } } as unknown as Task;
    const onOpenHyperframesStudio = vi.fn().mockResolvedValue({ fileSize: 24, relativePath: "episodes/episode-qc/studio/00000000-0000-0000-0000-000000000001/index.html", sha256: "a".repeat(64) });
    const props = { ...materialInputProps, artifacts: [renderArtifact], blueprint, episode: qcEpisode, isTransitionPending: false, onOpenHyperframesStudio, onSubmitStudioRevision, onTransition: vi.fn(), reviewPackages: [qcPackage], tasks: [renderTask], transitions: [] };
    render(<EpisodeDetail {...props} />);

    expect(screen.getByRole("heading", { name: "在 HyperFrames Studio 编辑" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "在 HyperFrames Studio 中打开" }));
    expect(onOpenHyperframesStudio).toHaveBeenCalledWith(qcEpisode.id, "episodes/episode-qc/review-render/v2/index.html");
    await user.click(screen.getByRole("button", { name: "提交 Studio 修改" }));
    await user.type(screen.getByLabelText("Studio 修改说明"), "字幕需要更醒目。");
    await user.click(screen.getByRole("button", { name: "确认并重新审核" }));
    expect(onSubmitStudioRevision).toHaveBeenCalledWith(expect.objectContaining({ episodeId: qcEpisode.id, reason: "字幕需要更醒目。", reviewPackageId: qcPackage.id, workspaceRelativePath: expect.stringContaining("/studio/") }));
  });

  it("在审核渲染中只提供官方 Studio 入口", async () => {
    const onCreateQcReviewIssue = vi.fn().mockResolvedValue(undefined);
    const qcEpisode: Episode = { ...reviewEpisode, id: "episode-qc-desk", stage: "qc_review", title: "QC 台" };
    const renderArtifact: Artifact = { ...previewArtifact, episode_id: qcEpisode.id, artifact_type: "render", id: "artifact-qc-desk", producer_task_id: "task-qc-desk", relative_path: "episodes/episode-qc-desk/review-render/v1/review-render.mp4" };
    const qcPackage = {
      artifact_id: renderArtifact.id,
      context_snapshot: { review_kind: "hyperframes_review_render", pre_render_review_package_id: "pre-render-qc-desk", project_revision: "1", project_relative_path: "episodes/episode-qc-desk/review-render/v1/index.html", technical_evidence: { checks: [{ name: "duration_coverage", detail: "时长匹配。" }] } },
      created_at: "2026-08-23T00:00:00.000Z", episode_id: qcEpisode.id, id: "review-package-qc-desk", invalidated_at: null, invalidated_reason: null, revision_number: 1, stage: "qc_review" as const, task_id: "task-qc-desk", task_run_id: "task-run-qc-desk",
    };
    const storyboardTask = { id: qcPackage.task_id, episode_id: qcEpisode.id, input_snapshot: { review_render: { storyboard: { version: "storyboard/v1", shots: [{ durationSeconds: 3, id: "shot-first", inputBasis: [{ relativePath: "episodes/episode-qc-desk/materials/script.md", sha256: "a".repeat(64) }], productionMethod: "人工", scriptSegment: "第一镜", shotType: "a_roll", targetSpec: "9:16" }, { durationSeconds: 2, id: "shot-second", inputBasis: [{ relativePath: "episodes/episode-qc-desk/materials/script.md", sha256: "a".repeat(64) }], productionMethod: "生成", scriptSegment: "第二镜", shotType: "b_roll", targetSpec: "9:16" }], audioCues: [] } } } } as unknown as Task;
    const members = [
      { member_key: "shot:shot-second", member_kind: "shot_media", review_package_id: "pre-render-qc-desk", source_task_id: "task-b-roll" },
      { member_key: "shot:shot-first", member_kind: "shot_media", review_package_id: "pre-render-qc-desk", source_task_id: "task-a-roll" },
    ] as PreRenderReviewMember[];

    render(<EpisodeDetail {...materialInputProps} artifacts={[renderArtifact]} blueprint={blueprint} episode={qcEpisode} isTransitionPending={false} onCreateQcReviewIssue={onCreateQcReviewIssue} onTransition={vi.fn()} preRenderReviewMembers={members} reviewPackages={[qcPackage]} tasks={[storyboardTask]} transitions={[]} />);

    expect(screen.getByRole("heading", { name: "在 HyperFrames Studio 编辑" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "在 HyperFrames Studio 中打开" })).toBeTruthy();
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
    expect(screen.getByText("4.5 秒")).toBeTruthy();
    expect(screen.getByText("素材库特写 + 环境音")).toBeTruthy();
    expect(screen.getByText("9:16，1080×1920，24fps")).toBeTruthy();
    expect(screen.getByText("先确认铜铃的音效节奏。")).toBeTruthy();

    await user.type(screen.getByLabelText("shot-02 镜头批注"), "铜铃特写需要延长。");
    await user.click(screen.getByRole("button", { name: "添加镜头批注" }));
    expect(onCreateStoryboardAnnotation).toHaveBeenCalledWith({ reviewPackageId: "review-package-storyboard-1", reason: "铜铃特写需要延长。", shotId: "shot-02" });

    await user.type(screen.getByLabelText("审批理由"), "镜头拆分、规格与输入均可执行。");
    await user.click(screen.getByRole("button", { name: "批准" }));
    expect(onTransition).toHaveBeenLastCalledWith(storyboardEpisode.id, "storyboard_approved", "镜头拆分、规格与输入均可执行。");
    await user.click(screen.getByRole("button", { name: "要求修改" }));
    expect(onTransition).toHaveBeenLastCalledWith(storyboardEpisode.id, "storyboard_draft", "镜头拆分、规格与输入均可执行。");
  });

  it("在自动能力关闭后仍可将人工媒体冻结到已批准分镜", async () => {
    const user = userEvent.setup();
    const onRegisterManualMedia = vi.fn().mockResolvedValue(undefined);
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
    const manualNarration: MaterialRevision = { ...manualAroll, id: "material-narration-1", material_purpose: "narration", material_type: "audio", mime_type: "audio/mpeg", source_path: "narration.mp3", storage_path: "episodes/episode-review/materials/manual-narration.mp3" };
    const manualBgm: MaterialRevision = { ...manualNarration, id: "material-bgm-1", material_purpose: "background_music", source_path: "music.mp3", storage_path: "episodes/episode-review/materials/manual-music.mp3" };
    const manualBlueprint: Blueprint = { ...blueprint, policy: { a_roll: { execution_path: "manual" }, b_roll: { execution_path: "manual" }, narration: { execution_path: "manual" }, soundtrack: { execution_path: "manual" } } };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ version: "storyboard/v1", audioCues: [{ description: "氛围音乐", durationSeconds: 5, id: "cue-bgm-1", kind: "bgm", searchQuery: "ambient", startSeconds: 0 }], shots: [{ durationSeconds: 5, id: "shot-a-roll-1", inputBasis: [{ relativePath: "episodes/episode-review/materials/script.md", sha256: "c".repeat(64) }], productionMethod: "人工出镜", scriptSegment: "主持人出镜说明。", shotType: "a_roll", targetSpec: "9:16" }, { durationSeconds: 5, id: "shot-b-roll-1", inputBasis: [{ relativePath: "episodes/episode-review/materials/script.md", sha256: "c".repeat(64) }], productionMethod: "人工素材", scriptSegment: "环境补充画面。", shotType: "b_roll", targetSpec: "9:16" }] }), { status: 200, headers: { "Content-Type": "application/json" } })));

    render(<EpisodeDetail {...materialInputProps} artifacts={[storyboardArtifact]} blueprint={manualBlueprint} episode={storyboardEpisode} isTransitionPending={false} materialRevisions={[manualAroll, manualBroll, manualNarration, manualBgm]} onRegisterManualMedia={onRegisterManualMedia} onTransition={vi.fn()} reviewPackages={[{
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

    await screen.findByText("主持人出镜说明。");
    await user.selectOptions(screen.getByLabelText("shot-a-roll-1 人工 A-roll 视频"), manualAroll.id);
    await user.click(screen.getByRole("button", { name: "冻结人工 A-roll 视频" }));
    await user.selectOptions(screen.getByLabelText("shot-b-roll-1 人工 B-roll 视频"), manualBroll.id);
    await user.click(screen.getByRole("button", { name: "冻结人工 B-roll 视频" }));
    await user.selectOptions(screen.getByLabelText("episode-review 人工旁白音频（Episode）"), manualNarration.id);
    await user.click(screen.getByRole("button", { name: "冻结人工旁白音频（Episode）" }));
    await user.selectOptions(screen.getByLabelText("cue-bgm-1 人工配乐"), manualBgm.id);
    await user.click(screen.getByRole("button", { name: "冻结人工配乐" }));
    expect(onRegisterManualMedia).toHaveBeenCalledWith({ episodeId: storyboardEpisode.id, kind: "a_roll", materialRevisionId: manualAroll.id, storyboardReviewPackageId: "review-package-manual-a-roll", targetId: "shot-a-roll-1" });
    expect(onRegisterManualMedia).toHaveBeenCalledWith({ episodeId: storyboardEpisode.id, kind: "b_roll", materialRevisionId: manualBroll.id, storyboardReviewPackageId: "review-package-manual-a-roll", targetId: "shot-b-roll-1" });
    expect(onRegisterManualMedia).toHaveBeenCalledWith({ episodeId: storyboardEpisode.id, kind: "narration", materialRevisionId: manualNarration.id, storyboardReviewPackageId: "review-package-manual-a-roll", targetId: storyboardEpisode.id });
    expect(onRegisterManualMedia).toHaveBeenCalledWith({ episodeId: storyboardEpisode.id, kind: "bgm", materialRevisionId: manualBgm.id, storyboardReviewPackageId: "review-package-manual-a-roll", targetId: "cue-bgm-1" });
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
