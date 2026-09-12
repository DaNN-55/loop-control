import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Database } from "./lib/database.types";
import { AccountWorkspace, App, BootstrapScreen, EpisodeDetail, EpisodeForm, EpisodeWorkspace, NavigationButtons, SeriesSettings, TimezoneSelect, abbreviatePath, dispatchCreatedWorkerTask, episodeNeedsTaskPolling, episodeTaskRunStatusChanged, episodeTaskStatusChanged, episodeWorkerStatus, initialNavigationForWorkspace, loadWorkspaceSummary, mergeEpisodeTaskStatus, messageFromError, navigation, navigationBadgeCounts, shotPreparationSaveErrorMessage, splitPreviewArtifacts, workerPreflightFailureMessage } from "./App";
import { supabase } from "./lib/supabase";
import { defaultBlueprintPolicy, parseBlueprintPolicy, withBlueprintAssetRoot } from "./platform/blueprintPolicy";

vi.mock("./lib/supabase", () => ({
  supabase: {
    rpc: vi.fn().mockResolvedValue({ error: null }),
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
      onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
    },
  },
}));

describe("approval console", () => {
  it("默认预览只保留当前产物，其余版本进入历史", () => {
    const base = { artifact_type: "shot_preview_proxy", episode_id: "episode-1", file_size: 10, producer_task_id: "task-1", relative_path: "episodes/episode-1/shot-previews/shot-1/current/proxy.mp4", sha256: "a".repeat(64) };
    const current = { ...base, created_at: "2026-09-12T01:00:00.000Z", id: "artifact-current" } as Database["public"]["Tables"]["artifacts"]["Row"];
    const history = { ...base, created_at: "2026-09-11T01:00:00.000Z", id: "artifact-history", relative_path: "episodes/episode-1/shot-previews/shot-1/history/proxy.mp4" } as Database["public"]["Tables"]["artifacts"]["Row"];

    expect(splitPreviewArtifacts([history, current], new Set([current.id]))).toEqual({ current: [current], history: [history] });
  });

  it("创建审核渲染任务后立即按 Task ID 派发", async () => {
    const dispatch = vi.fn().mockResolvedValue({ accepted: true, reason: "" });

    await expect(dispatchCreatedWorkerTask("episode-1", { id: "task-review-render" }, dispatch)).resolves.toEqual({ accepted: true, reason: "" });
    expect(dispatch).toHaveBeenCalledWith("episode-1", "task-review-render");
    await expect(dispatchCreatedWorkerTask("episode-1", null, dispatch)).resolves.toEqual({ accepted: false, reason: "任务记录缺少 ID" });
  });

  it("将字幕合约校验错误解释为数据库版本未更新", () => {
    expect(shotPreparationSaveErrorMessage({ message: "Shot caption contract is invalid" })).toBe("字幕配置未通过数据库校验。当前数据库尚未支持新版安全区设置，请先完成数据库迁移后重试。");
  });

  it("开始制作后即使任务尚未创建也继续轮询", () => {
    expect(episodeNeedsTaskPolling({ detailOpen: true, dispatchRequested: true, hasActiveTask: false, pageVisible: true })).toBe(true);
    expect(episodeNeedsTaskPolling({ detailOpen: true, dispatchRequested: false, hasActiveTask: false, pageVisible: true })).toBe(false);
    expect(episodeNeedsTaskPolling({ detailOpen: true, dispatchRequested: true, hasActiveTask: false, pageVisible: false })).toBe(false);
  });

  it("登录后只加载首个运营页面所需数据，不在后台读取完整工作区", async () => {
    const user = userEvent.setup();
    const account = { id: "account-1", name: "道工作室", slug: "dao-studio" } as Database["public"]["Tables"]["accounts"]["Row"];
    const episode = { account_id: account.id, blueprint_version_id: "blueprint-1", id: "episode-1", stage: "waiting_input", title: "首个生产单" } as Database["public"]["Tables"]["episodes"]["Row"];
    const from = vi.fn((table: string) => {
      const order = vi.fn().mockResolvedValue({ data: table === "accounts" ? [account] : table === "episodes" ? [episode] : [], error: null });
      return { select: vi.fn().mockReturnValue(table === "prompt_versions" ? { order: vi.fn().mockReturnValue({ order }) } : { order }) };
    });
    Object.assign(supabase, { from });
    vi.mocked(supabase.auth.getSession).mockResolvedValueOnce({ data: { session: { user: { id: "owner-1" } } }, error: null } as never);

    render(<App />);

    await waitFor(() => expect(from.mock.calls.map(([table]) => table)).toEqual([
      "accounts", "account_blueprint_versions", "episodes", "series", "series_versions",
      "review_packages", "pre_render_review_members", "pre_render_review_member_decisions", "tasks",
    ]));

    await user.click(screen.getAllByRole("button", { name: "账号" })[0]);

    await waitFor(() => expect(from.mock.calls.map(([table]) => table)).toEqual([
      "accounts", "account_blueprint_versions", "episodes", "series", "series_versions",
      "review_packages", "pre_render_review_members", "pre_render_review_member_decisions", "tasks",
      "prompt_versions", "external_connections",
    ]));
  });

  it("首次进入只读取页面骨架所需的五张表", async () => {
    const order = vi.fn().mockResolvedValue({ data: [], error: null });
    const from = vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ order }) });
    Object.assign(supabase, { from });

    const workspace = await loadWorkspaceSummary();

    expect(from.mock.calls.map(([table]) => table)).toEqual(["accounts", "account_blueprint_versions", "episodes", "series", "series_versions"]);
    expect(workspace.artifacts).toEqual([]);
  });

  it("轮询只替换当前生产单的任务和运行记录", () => {
    const task = { id: "task-a", episode_id: "episode-a" } as Database["public"]["Tables"]["tasks"]["Row"];
    const otherTask = { id: "task-b", episode_id: "episode-b" } as Database["public"]["Tables"]["tasks"]["Row"];
    const oldRun = { task_id: "task-a" } as Database["public"]["Tables"]["task_runs"]["Row"];
    const otherRun = { task_id: "task-b" } as Database["public"]["Tables"]["task_runs"]["Row"];
    const nextTask = { id: "task-c", episode_id: "episode-a" } as Database["public"]["Tables"]["tasks"]["Row"];
    const nextRun = { task_id: "task-c" } as Database["public"]["Tables"]["task_runs"]["Row"];

    expect(mergeEpisodeTaskStatus({ tasks: [task, otherTask], taskRuns: [oldRun, otherRun] }, "episode-a", [nextTask], [nextRun])).toEqual({ tasks: [otherTask, nextTask], taskRuns: [otherRun, nextRun] });
  });

  it("只在任务实际状态变化时拉取详情，不受租约心跳影响", () => {
    const task = { attempt: 1, completed_at: null, episode_id: "episode-a", id: "task-a", status: "running" } as Database["public"]["Tables"]["tasks"]["Row"];

    expect(episodeTaskStatusChanged([task], [{ ...task }], "episode-a")).toBe(false);
    expect(episodeTaskStatusChanged([task], [{ ...task, completed_at: "2026-09-08T00:00:00.000Z", status: "completed" }], "episode-a")).toBe(true);
    expect(episodeTaskStatusChanged([task], [{ ...task, id: "task-b" }], "episode-a")).toBe(true);
  });

  it("任务运行记录独立变化时仍会更新轻量状态", () => {
    const run = { attempt: 1, completed_at: null, id: "run-a", started_at: "2026-09-08T00:00:00.000Z", status: "running", task_id: "task-a" } as Database["public"]["Tables"]["task_runs"]["Row"];

    expect(episodeTaskRunStatusChanged([run], [{ ...run }], new Set(["task-a"]))).toBe(false);
    expect(episodeTaskRunStatusChanged([run], [{ ...run, completed_at: "2026-09-08T00:01:00.000Z", status: "completed" }], new Set(["task-a"]))).toBe(true);
    expect(episodeTaskRunStatusChanged([run], [{ ...run, id: "run-b" }], new Set(["task-a"]))).toBe(true);
  });

  it("创建生产单前展示阻塞原因并保持生产单未创建", async () => {
    const user = userEvent.setup();
    const account = { current_blueprint_version_id: "00000000-0000-0000-0000-000000000001", id: "00000000-0000-0000-0000-000000000002", name: "道工作室" } as Database["public"]["Tables"]["accounts"]["Row"];
    const preflight = { version: "worker-preflight/v1" as const, checks: [{ capability: "script_writing", check: "blueprint_configuration", phase: "preflight" as const, status: "blocked" as const, reason: "脚本能力缺少模型。", action: "edit_blueprint" as const, scope: "blueprint" as const }] };
    const onSubmit = vi.fn().mockResolvedValue(preflight);

    render(<EpisodeForm accounts={[account]} isPending={false} onClose={vi.fn()} onOpenBlueprint={vi.fn()} onSubmit={onSubmit} series={[]} seriesVersions={[]} />);

    await user.click(screen.getByRole("button", { name: "创建生产单" }));

    expect(await screen.findByText("创建前可生产性检查：未通过（1）")).toBeTruthy();
    const preflightDetails = screen.getByText("创建前可生产性检查：未通过（1）").closest("details");
    expect(preflightDetails).toBeTruthy();
    expect((preflightDetails as HTMLDetailsElement).open).toBe(false);
    expect(screen.getByText("本次检查未通过，因此尚未创建生产单。处理下面的原因后，点击“创建生产单”重新检查。")).toBeTruthy();
    expect(screen.getByText("蓝图能力配置需要修复")).toBeTruthy();
    expect(onSubmit).toHaveBeenCalledWith({ accountId: account.id, isTest: false, seriesVersionId: null, title: "" });
  });

  it("创建时分步显示当前进度", () => {
    const account = { current_blueprint_version_id: "00000000-0000-0000-0000-000000000001", id: "00000000-0000-0000-0000-000000000002", name: "道工作室" } as Database["public"]["Tables"]["accounts"]["Row"];

    render(<EpisodeForm accounts={[account]} creationStartedAt={Date.now()} creationStep="preflight" isPending onClose={vi.fn()} onSubmit={vi.fn()} series={[]} seriesVersions={[]} />);

    expect(screen.getByRole("status").textContent).toContain("正在创建生产单");
    expect(screen.getByText("检查生产条件")).toBeTruthy();
    expect(screen.getByText(/验证当前蓝图、Worker、模型和已启用连接。 本阶段已等待 0 秒。/)).toBeTruthy();
    expect(screen.getByText("创建生产单")).toBeTruthy();
    expect(screen.getByRole("button", { name: "正在处理…" }).hasAttribute("disabled")).toBe(true);
  });

  it("创建前明确展示本次会冻结的媒体能力", () => {
    const account = { current_blueprint_version_id: "blueprint-1", id: "account-1", name: "道工作室" } as Database["public"]["Tables"]["accounts"]["Row"];
    const blueprint = { account_id: account.id, created_at: "2026-08-26T00:00:00.000Z", id: "blueprint-1", is_active: true, policy: { a_roll: { execution_path: "local", executor: { provider: "openchatcut", adapter: "openchatcut_card_video", model: "openchatcut@0.2.14", prompt_version: "card-video-v1" }, allowed_tools: ["read", "write"], max_attempts: 1 }, b_roll: { execution_path: "external", executor: { provider: "pexels", adapter: "pexels_video", model: "pexels-video-v1", prompt_version: "b-roll-v1" }, credential_ref: "11111111-1111-4111-8111-111111111111", allowed_tools: ["read", "write"], max_attempts: 1, max_concurrency: 1, provider_max_concurrency: 1 } }, version: 1 } as Database["public"]["Tables"]["account_blueprint_versions"]["Row"];

    render(<EpisodeForm accounts={[account]} blueprints={[blueprint]} connectionVersions={[{ adapter: "pexels_video", connection_id: "11111111-1111-4111-8111-111111111111", created_at: "2026-08-26T00:00:00.000Z", endpoint: "https://api.pexels.com", id: "11111111-1111-4111-8111-111111111111", is_current: true, provider: "pexels", revoked_at: null, status: "verified", version: 1 }]} isPending={false} onClose={vi.fn()} onSubmit={vi.fn()} series={[]} seriesVersions={[]} />);

    expect(screen.getByText("本单将冻结的生产能力")).toBeTruthy();
    expect(screen.getByText("A-roll · 本地")).toBeTruthy();
    expect(screen.getByText("B-roll · 外部")).toBeTruthy();
    expect(screen.getByText(/只会冻结以下已启用且完整配置的能力/)).toBeTruthy();
  });

  it("创建前不展示已失效的外部媒体连接", () => {
    const account = { current_blueprint_version_id: "blueprint-1", id: "account-1", name: "道工作室" } as Database["public"]["Tables"]["accounts"]["Row"];
    const blueprint = { account_id: account.id, created_at: "2026-08-26T00:00:00.000Z", id: "blueprint-1", is_active: true, policy: { b_roll: { execution_path: "external", executor: { provider: "pexels", adapter: "pexels_video", model: "pexels-video-v1", prompt_version: "b-roll-v1" }, credential_ref: "11111111-1111-4111-8111-111111111111", allowed_tools: ["read", "write"], max_attempts: 1, max_concurrency: 1, provider_max_concurrency: 1 } }, version: 1 } as Database["public"]["Tables"]["account_blueprint_versions"]["Row"];

    render(<EpisodeForm accounts={[account]} blueprints={[blueprint]} connectionVersions={[{ adapter: "pexels_video", connection_id: "11111111-1111-4111-8111-111111111111", created_at: "2026-08-26T00:00:00.000Z", endpoint: "https://api.pexels.com", id: "11111111-1111-4111-8111-111111111111", is_current: true, provider: "pexels", revoked_at: "2026-08-26T00:00:00.000Z", status: "revoked", version: 1 }]} isPending={false} onClose={vi.fn()} onSubmit={vi.fn()} series={[]} seriesVersions={[]} />);

    expect(screen.queryByText("B-roll · 外部")).toBeNull();
    expect(screen.getByText("当前蓝图没有已完整配置的可选媒体能力。")).toBeTruthy();
  });

  it("shows Chinese password and magic-link sign-in choices when no session exists", async () => {
    render(<App />);

    expect(await screen.findByRole("heading", { name: "登录控制台" })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "邮箱" })).toBeTruthy();
    expect(screen.getByLabelText("密码")).toBeTruthy();
    expect(screen.getByRole("button", { name: "使用密码登录" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "发送登录链接" })).toBeTruthy();
  });

  it("用明确的时区选项替代自由填写", () => {
    render(<TimezoneSelect value="Asia/Shanghai" onChange={vi.fn()} />);

    const timezone = screen.getByRole("combobox", { name: "时区" }) as HTMLSelectElement;
    expect(timezone.value).toBe("Asia/Shanghai");
    expect(screen.getByRole("option", { name: /越南.*胡志明市/ })).toBeTruthy();
    expect(screen.getByRole("option", { name: /美国.*洛杉矶/ })).toBeTruthy();
  });

  it("accepts the default blueprint policy and rejects a non-object policy", () => {
    expect(parseBlueprintPolicy(JSON.stringify(defaultBlueprintPolicy))).toEqual(defaultBlueprintPolicy);
    expect(() => parseBlueprintPolicy("[]")).toThrow("蓝图规则必须是 JSON 对象。");
  });

  it("updates only the asset root in a blueprint policy", () => {
    expect(withBlueprintAssetRoot(defaultBlueprintPolicy, "/Volumes/Content Disk/loop-control/dao")).toEqual({
      ...defaultBlueprintPolicy,
      asset_root: "/Volumes/Content Disk/loop-control/dao",
    });
  });

  it("initializes the first account without exposing blueprint fields", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<BootstrapScreen errorMessage="" isPending={false} onSubmit={onSubmit} />);

    expect(screen.queryByLabelText("蓝图规则（JSON）")).toBeNull();
    expect(screen.queryByLabelText("资产目录")).toBeNull();
    await user.type(screen.getByLabelText("账号名称"), "道工作室");
    await user.type(screen.getByLabelText("账号标识"), "dao-studio");
    await user.click(screen.getByRole("button", { name: "创建首个账号" }));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      name: "道工作室",
      slug: "dao-studio",
      policy: defaultBlueprintPolicy,
    }));
  });

  it("creates the first series version from account settings", async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    render(<SeriesSettings isPending={false} onCreate={onCreate} series={[]} seriesVersions={[]} />);

    fireEvent.change(screen.getByRole("textbox", { name: "系列名称" }), { target: { value: "越南道士" } });
    fireEvent.change(screen.getByRole("textbox", { name: "系列定位" }), { target: { value: "雨夜民俗" } });
    fireEvent.click(screen.getByRole("button", { name: "创建系列" }));
    fireEvent.click(screen.getByRole("button", { name: "确认创建系列" }));

    await waitFor(() => expect(onCreate).toHaveBeenCalledWith({ name: "越南道士", rules: { positioning: "雨夜民俗" } }));
  });

  it("系列设置展示当前版本和历史版本", () => {
    const series = { account_id: "account-1", created_at: "2026-08-15T00:00:00.000Z", id: "series-1", name: "越南道士" } as Database["public"]["Tables"]["series"]["Row"];
    const seriesVersions = [
      { account_id: "account-1", created_at: "2026-08-17T00:00:00.000Z", id: "series-version-2", rules: {}, series_id: series.id, version: 2 },
      { account_id: "account-1", created_at: "2026-08-15T00:00:00.000Z", id: "series-version-1", rules: {}, series_id: series.id, version: 1 },
    ] as Database["public"]["Tables"]["series_versions"]["Row"][];

    render(<SeriesSettings isPending={false} onCreate={vi.fn()} series={[series]} seriesVersions={seriesVersions} />);

    expect(screen.getByRole("heading", { name: "越南道士 · 当前 v2" })).toBeTruthy();
    expect(screen.getByText("当前 v2")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "版本历史" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "保存为 v3" })).toBeTruthy();
  });

  it("通过结构化表单编辑蓝图并保留高级规则", async () => {
    const user = userEvent.setup();
    const account = { created_at: "2026-08-15T00:00:00.000Z", current_blueprint_version_id: "blueprint-1", id: "account-1", name: "道工作室", slug: "dao-studio", timezone: "Asia/Shanghai" } as Database["public"]["Tables"]["accounts"]["Row"];
    const storyboardHarness = { account_id: account.id, capability: "storyboard_planning", content_hash: "a".repeat(64), created_at: "2026-08-15T00:00:00.000Z", created_by: "owner-1", id: "harness-storyboard-1", instructions: "生成可审核分镜。", is_active: true, name: "分镜规划 v1", slug: "storyboard-planning-v1", summary: "测试 Harness。", version: 1 } as Database["public"]["Tables"]["prompt_versions"]["Row"];
    const blueprint = { account_id: account.id, created_at: "2026-08-15T00:00:00.000Z", id: "blueprint-1", is_active: true, policy: { positioning: "旧定位", asset_root: "/Volumes/Media/dao", approval_gates: ["script"], allowed_tools: ["read", "write"], budgets: { script_writing_cents: 0, visual_planning_cents: 0, storyboard_planning_cents: 0 }, executors: { script_writing: { provider: "codex", model: "model-a", prompt_version: "script-v1" }, visual_planning: { adapter: "codex", harness_id: storyboardHarness.id, provider: "codex", model: "model-c", prompt_version: storyboardHarness.slug }, storyboard_planning: { adapter: "codex", harness_id: storyboardHarness.id, provider: "codex", model: "model-c", prompt_version: storyboardHarness.slug } }, soundtrack: { execution_path: "external", credential_ref: "44444444-4444-4444-8444-444444444444", executor: { provider: "freesound", adapter: "freesound_preview", model: "freesound-preview-v1", prompt_version: "soundtrack-v1" }, allowed_tools: ["read", "write"], budget_cents: 99, max_attempts: 1 } }, version: 1 } as Database["public"]["Tables"]["account_blueprint_versions"]["Row"];
    const onUpdateBlueprint = vi.fn().mockResolvedValue(blueprint);
    render(<AccountWorkspace account={account} accounts={[account]} blueprints={[blueprint]} connectionVersions={[{ adapter: "freesound_preview", connection_id: "44444444-4444-4444-8444-444444444444", created_at: "2026-08-15T00:00:00.000Z", endpoint: "https://api.freesound.org", id: "44444444-4444-4444-8444-444444444444", is_current: true, provider: "freesound", revoked_at: null, status: "verified", version: 1 }]} externalConnections={[{ adapter: "freesound_preview", created_at: "2026-08-15T00:00:00.000Z", created_by: "owner-1", current_version_id: "44444444-4444-4444-8444-444444444444", id: "44444444-4444-4444-8444-444444444444", last_verification_detail: null, last_verified_at: "2026-08-15T00:00:00.000Z", name: "主 Freesound", provider: "freesound", status: "verified" }]} isPending="" onUpdateBlueprint={onUpdateBlueprint} onCreateSeries={vi.fn()} onSelectAccount={vi.fn()} promptVersions={[storyboardHarness]} series={[]} seriesVersions={[]} />);

    await user.click(screen.getByRole("tab", { name: "蓝图" }));
    await user.clear(screen.getByLabelText("账号定位"));
    await user.type(screen.getByLabelText("账号定位"), "新定位");
    await user.click(screen.getByRole("button", { name: /保存蓝图|保存并检查/ }));
    await user.click(screen.getByRole("button", { name: "确认保存并检查" }));

    await waitFor(() => expect(onUpdateBlueprint).toHaveBeenCalledWith(expect.objectContaining({ positioning: "新定位", soundtrack: expect.objectContaining({ executor: expect.objectContaining({ adapter: "freesound_preview" }) }) })));
  });

  it("从阻塞项直接修复当前生产单而不新增蓝图版本", async () => {
    const user = userEvent.setup();
    const account = { created_at: "2026-08-15T00:00:00.000Z", current_blueprint_version_id: "blueprint-current", id: "account-1", name: "道工作室", slug: "dao-studio", timezone: "Asia/Shanghai" } as Database["public"]["Tables"]["accounts"]["Row"];
    const blueprint = { account_id: account.id, created_at: "2026-08-15T00:00:00.000Z", id: "blueprint-episode", is_active: true, policy: { positioning: "旧定位", asset_root: "/Volumes/Media/dao", approval_gates: ["script"], allowed_tools: ["read", "write"], budgets: { script_writing_cents: 0, visual_planning_cents: 0, storyboard_planning_cents: 0 }, executors: { script_writing: { provider: "codex", model: "model-a", prompt_version: "script-v1" }, visual_planning: { provider: "codex", model: "model-b", prompt_version: "visual-v1" }, storyboard_planning: { provider: "codex", model: "model-c", prompt_version: "storyboard-v1" } } }, version: 1 } as Database["public"]["Tables"]["account_blueprint_versions"]["Row"];
    const currentBlueprint = { ...blueprint, id: "blueprint-current", policy: { ...(blueprint.policy as Record<string, unknown>), a_roll: { execution_path: "manual", executor: { provider: "codex", adapter: "codex", model: "video-generation-v1", prompt_version: "a-roll-v1" }, allowed_tools: ["read", "write"], budget_cents: 100, max_attempts: 2 } } } as Database["public"]["Tables"]["account_blueprint_versions"]["Row"];
    const onApplyEpisodeRepair = vi.fn().mockResolvedValue(true);

    render(<AccountWorkspace account={account} accounts={[account]} blueprints={[blueprint, currentBlueprint]} blueprintRepairContext={{ blocker: { code: "a_roll_executor_invalid", detail: "A-roll 执行器 adapter 未配置。" }, blueprintVersionId: blueprint.id, episodeId: "episode-1" }} isPending="" onApplyEpisodeRepair={onApplyEpisodeRepair} onCreateSeries={vi.fn()} onSelectAccount={vi.fn()} series={[]} seriesVersions={[]} />);

    expect(await screen.findByRole("heading", { name: "修复当前生产单的 A-roll" })).toBeTruthy();
    expect(screen.queryByText("脚本生成", { selector: "h4" })).toBeNull();
    expect((screen.getByLabelText("A-roll 执行路径") as HTMLSelectElement).value).toBe("manual");
    expect(screen.getByText("Episode 会按镜头与音频 cue 生成待补齐素材清单，不创建 Worker 或外部任务。")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "保存并继续当前生产单" }));

    await waitFor(() => expect(onApplyEpisodeRepair).toHaveBeenCalledWith(expect.objectContaining({
      context: { blocker: { code: "a_roll_executor_invalid", detail: "A-roll 执行器 adapter 未配置。" }, blueprintVersionId: "blueprint-episode", episodeId: "episode-1" },
      policy: expect.objectContaining({
        a_roll: expect.objectContaining({
          execution_path: "manual",
        }),
      }),
    })));
  });

  it("按生产工作流顺序显示导航，并为审核显示待办数量", () => {
    expect(navigation.map((item) => item.label)).toEqual(["系列运营", "生产单", "审核", "账号"]);
    const episode = { account_id: "account-1", blueprint_version_id: "blueprint-1", created_at: "2026-08-15T00:00:00.000Z", id: "episode-1", stage: "script_review", title: "待审核", updated_at: "2026-08-15T00:00:00.000Z" } as Database["public"]["Tables"]["episodes"]["Row"];
    expect(navigationBadgeCounts([episode])).toEqual({ reviews: 1 });
  });

  it("收起导航文字后仍保留每个入口的可访问名称", () => {
    render(<NavigationButtons activeNavigation="accounts" onSelect={vi.fn()} />);
    expect(screen.getByRole("button", { name: "账号" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "审核" })).toBeTruthy();
  });

  it("按工作区状态选择首次进入页面", () => {
    expect(initialNavigationForWorkspace({ accounts: [], episodes: [] })).toBe("accounts");
    expect(initialNavigationForWorkspace({ accounts: [{} as Database["public"]["Tables"]["accounts"]["Row"]], episodes: [] })).toBe("accounts");
    expect(initialNavigationForWorkspace({ accounts: [{} as Database["public"]["Tables"]["accounts"]["Row"]], episodes: [{} as Database["public"]["Tables"]["episodes"]["Row"]] })).toBe("operations");
  });

  it("把 Worker 执行、完成和审核等待状态区分展示", () => {
    expect(episodeWorkerStatus({ main_script_revision_id: "revision-1", stage: "waiting_input" }, [])).toMatchObject({ label: "待开始制作", tone: "waiting" });
    expect(episodeWorkerStatus({ stage: "visual_draft" }, [{ status: "running", task_type: "prepare_visual_brief" }])).toMatchObject({ label: "执行中", tone: "running" });
    expect(episodeWorkerStatus({ stage: "visual_review" }, [{ status: "completed", task_type: "prepare_visual_brief" }])).toMatchObject({ label: "等待审核", tone: "review" });
    expect(episodeWorkerStatus({ stage: "qc_review" }, [{ created_at: "2026-08-24T01:00:00.000Z", status: "failed", task_type: "generate_review_render" }, { created_at: "2026-08-24T02:00:00.000Z", status: "completed", task_type: "generate_review_render" }])).toMatchObject({ label: "等待审核", tone: "review" });
    expect(episodeWorkerStatus({ stage: "qc_passed" }, [{ created_at: "2026-08-24T01:00:00.000Z", status: "failed", task_type: "generate_review_render" }, { created_at: "2026-08-24T02:00:00.000Z", status: "completed", task_type: "generate_review_render" }])).toMatchObject({ label: "已完成", tone: "completed" });
    expect(episodeWorkerStatus({ stage: "render_ready" }, [{ created_at: "2026-08-24T02:00:00.000Z", status: "failed", task_type: "generate_final_render" }])).toMatchObject({ label: "等待 Worker", tone: "waiting" });
    expect(episodeWorkerStatus({ stage: "render_ready" }, [{ created_at: "2026-08-24T02:00:00.000Z", status: "failed", task_type: "generate_review_render" }])).toMatchObject({ label: "失败", tone: "blocked" });
    expect(episodeWorkerStatus({ stage: "storyboard_approved" }, [{ status: "completed", task_type: "draft_storyboard" }])).toMatchObject({ label: "已完成", tone: "completed" });
  });

  it("同一镜头的新任务完成后不再把旧任务显示为当前阻塞", () => {
    const shotPreparation = { draft_id: "draft-shot-001", shot_id: "shot-001" };
    expect(episodeWorkerStatus({ stage: "qc_review" }, [
      { created_at: "2026-09-11T09:27:39.000Z", id: "blocked-preview", input_snapshot: { shot_preparation: shotPreparation }, status: "blocked", task_type: "generate_shot_sync_preview" },
      { created_at: "2026-09-11T10:31:37.000Z", id: "completed-preview", input_snapshot: { shot_preparation: shotPreparation }, status: "completed", task_type: "generate_shot_sync_preview" },
    ])).toMatchObject({ label: "等待审核", tone: "review" });
  });

  it("显示修复前真实 preflight 返回的具体检查原因", () => {
    expect(workerPreflightFailureMessage({ version: "worker-preflight/v1", checks: [{ capability: "b_roll_generation", check: "network_connectivity", phase: "preflight", status: "retryable", reason: "Pexels 网络探测超时。", action: "retry", scope: "worker" }] })).toBe("修复前真实运行态检查未通过：network_connectivity：Pexels 网络探测超时。");
  });

  it("展示 Supabase 返回的结构化错误消息", () => {
    expect(messageFromError({ message: "column connection.account_id does not exist" }, "无法创建逐镜头口播任务。")).toBe("column connection.account_id does not exist");
  });

  it("省略生成依据路径中的长段并保留开头和结尾", () => {
    expect(abbreviatePath("episodes/92b3067d-ced9-4e85-bc44-1968fa83695a/materials/599e8fe43ff0b10144eab597567da6da78d5ec6218b74de5fbb7cf3df04e628a-script.md")).toBe("episodes/92b3067d…83695a/materials/599e8fe4…-script.md");
  });

  it("Studio 的结构修改只返回分镜审核，不冻结当前 Studio 工程", async () => {
    const user = userEvent.setup();
    const episode = { account_id: "account-1", blueprint_version_id: "blueprint-1", created_at: "2026-08-24T00:00:00.000Z", id: "episode-1", stage: "qc_review", title: "审核渲染", updated_at: "2026-08-24T00:00:00.000Z" } as Database["public"]["Tables"]["episodes"]["Row"];
    const reviewPackage = { artifact_id: "artifact-1", context_snapshot: { pre_render_review_package_id: "pre-render-1", project_relative_path: "episodes/episode-1/studio/index.html", review_kind: "openchatcut_review_render" }, episode_id: episode.id, id: "review-1", invalidated_at: null, revision_number: 1, stage: "qc_review", task_id: "task-1" } as unknown as Database["public"]["Tables"]["review_packages"]["Row"];
    const artifact = { artifact_type: "review_render", episode_id: episode.id, id: "artifact-1", producer_task_id: "task-1", relative_path: "episodes/episode-1/review.mp4" } as Database["public"]["Tables"]["artifacts"]["Row"];
    const task = { episode_id: episode.id, id: "task-1", input_snapshot: null, status: "completed", task_type: "generate_review_render" } as Database["public"]["Tables"]["tasks"]["Row"];
    const onOpen = vi.fn().mockResolvedValue({ fileSize: 1, relativePath: "episodes/episode-1/studio-edits/index.html", sha256: "draft" });
    const onRequestRevision = vi.fn().mockResolvedValue({ kind: "storyboard" });
    vi.mocked(supabase.rpc).mockClear();

    render(<EpisodeDetail artifacts={[artifact]} audioTrackAnnotations={[]} audioTracks={[]} blueprint={null} episode={episode} isMaterialPending={false} isStoryboardAnnotationPending={false} isTransitionPending={false} onCreateAudioTrackAnnotation={vi.fn()} onCreateStoryboardAnnotation={vi.fn()} onImportMaterial={vi.fn()} onOpenStudio={onOpen} onRequestRevision={onRequestRevision} onTransition={vi.fn().mockResolvedValue(true)} reviewAnnotations={[]} reviewPackages={[reviewPackage]} tasks={[task]} transitions={[]} />);

    await user.click(screen.getByRole("button", { name: "在 OpenChatCut 中打开" }));
    await user.click(await screen.findByRole("button", { name: "提交 OpenChatCut 修改" }));
    await user.click(screen.getByRole("radio", { name: /分镜结构修订/ }));
    await user.type(screen.getByLabelText("OpenChatCut 修改说明"), "删除 shot-02，并将后续镜头前移。");
    await user.click(screen.getByRole("button", { name: "确认并返回分镜审核" }));

    await waitFor(() => expect(onRequestRevision).toHaveBeenCalledWith({ kind: "storyboard", reason: "删除 shot-02，并将后续镜头前移。", reviewPackageId: reviewPackage.id }));
    expect(onRequestRevision).toHaveBeenCalledOnce();
  });

  it("收起态导航仍保留审核角标节点", () => {
    render(<NavigationButtons activeNavigation="reviews" badges={{ reviews: 2 }} onSelect={vi.fn()} />);

    expect(screen.getByLabelText("2 个待处理")).toBeTruthy();
  });

  it("只显示当前筛选的生产单，并用分页控制长列表", async () => {
    const user = userEvent.setup();
    const account = { created_at: "2026-08-15T00:00:00.000Z", current_blueprint_version_id: "blueprint-1", id: "account-1", name: "道工作室", slug: "dao-studio", timezone: "Asia/Shanghai" } as Database["public"]["Tables"]["accounts"]["Row"];
    const blueprint = { account_id: account.id, created_at: "2026-08-15T00:00:00.000Z", id: "blueprint-1", is_active: true, policy: {}, version: 1 } as Database["public"]["Tables"]["account_blueprint_versions"]["Row"];
    const episodes = Array.from({ length: 21 }, (_, index) => ({ account_id: account.id, blueprint_version_id: blueprint.id, created_at: "2026-08-15T00:00:00.000Z", id: `episode-${index}`, stage: "waiting_input" as const, title: `生产单 ${index + 1}`, updated_at: "2026-08-15T00:00:00.000Z" }));
    const archivedEpisode = { ...episodes[0], archived_at: "2026-08-16T00:00:00.000Z", id: "episode-archived", title: "已归档生产单" };

    render(<EpisodeWorkspace accounts={[account]} accountsById={new Map([[account.id, account]])} artifacts={[]} blueprintsById={new Map([[blueprint.id, blueprint]])} episodeVisibility="active" episodes={[...episodes, archivedEpisode]} filter="全部账号" onEpisodeVisibilityChange={vi.fn()} onFilter={vi.fn()} onSeriesFilter={vi.fn()} onSelectEpisode={vi.fn()} series={[]} seriesById={new Map()} seriesFilter="全部系列" seriesVersionsById={new Map()} selectedEpisode={null} />);

    expect(screen.getByText("第 1 / 2 页 · 共 21 条")).toBeTruthy();
    expect(screen.queryByText("已归档生产单")).toBeNull();
    await user.click(screen.getByRole("button", { name: "下一页" }));
    expect(screen.getByText("生产单 21")).toBeTruthy();
  });

  it("从生产单操作菜单打开重命名、归档和测试删除入口", async () => {
    const user = userEvent.setup();
    const account = { created_at: "2026-08-15T00:00:00.000Z", current_blueprint_version_id: "blueprint-1", id: "account-1", name: "道工作室", slug: "dao-studio", timezone: "Asia/Shanghai" } as Database["public"]["Tables"]["accounts"]["Row"];
    const blueprint = { account_id: account.id, created_at: "2026-08-15T00:00:00.000Z", id: "blueprint-1", is_active: true, policy: { asset_root: "/Volumes/Media/dao" }, version: 1 } as Database["public"]["Tables"]["account_blueprint_versions"]["Row"];
    const episode = { account_id: account.id, blueprint_version_id: blueprint.id, created_at: "2026-08-15T00:00:00.000Z", id: "episode-test", is_test: true, stage: "waiting_input" as const, title: "测试生产单", updated_at: "2026-08-15T00:00:00.000Z" };
    const onUpdateTitle = vi.fn().mockResolvedValue(undefined);
    const onSetArchived = vi.fn().mockResolvedValue(undefined);
    const onDelete = vi.fn().mockResolvedValue(undefined);

    render(<EpisodeWorkspace accounts={[account]} accountsById={new Map([[account.id, account]])} artifacts={[]} blueprintsById={new Map([[blueprint.id, blueprint]])} episodeVisibility="active" episodes={[episode]} filter="全部账号" onDelete={onDelete} onEpisodeVisibilityChange={vi.fn()} onFilter={vi.fn()} onSetArchived={onSetArchived} onSeriesFilter={vi.fn()} onSelectEpisode={vi.fn()} onUpdateTitle={onUpdateTitle} series={[]} seriesById={new Map()} seriesFilter="全部系列" seriesVersionsById={new Map()} selectedEpisode={null} />);

    await user.click(screen.getByRole("button", { name: "生产单操作：测试生产单" }));
    expect(screen.getByRole("menuitem", { name: "重命名" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "归档" })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: "永久删除" })).toBeNull();

    await user.click(screen.getByRole("menuitem", { name: "重命名" }));
    await user.clear(screen.getByLabelText("新生产单标题"));
    await user.type(screen.getByLabelText("新生产单标题"), "新测试标题");
    await user.click(screen.getByRole("button", { name: "保存新标题" }));
    expect(onUpdateTitle).toHaveBeenCalledWith(episode.id, "新测试标题");

    await user.click(screen.getByRole("button", { name: "生产单操作：测试生产单" }));
    await user.click(screen.getByRole("menuitem", { name: "归档" }));
    expect(screen.getByRole("heading", { name: "归档生产单" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "确认归档" }));
    expect(onSetArchived).toHaveBeenCalledWith(episode.id, true);
  });
});
