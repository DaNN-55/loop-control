import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Database } from "./lib/database.types";
import { AccountWorkspace, App, EpisodeWorkspace, NavigationButtons, SeriesSettings, TimezoneSelect, episodeWorkerStatus, navigation, navigationBadgeCounts } from "./App";
import { defaultBlueprintPolicy, parseBlueprintPolicy, withBlueprintAssetRoot } from "./platform/blueprintPolicy";

vi.mock("./lib/supabase", () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
      onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
    },
  },
}));

describe("approval console", () => {
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
    expect(withBlueprintAssetRoot(defaultBlueprintPolicy, "/Volumes/Content Disk/tk-workflow/dao")).toEqual({
      ...defaultBlueprintPolicy,
      asset_root: "/Volumes/Content Disk/tk-workflow/dao",
    });
  });

  it("creates the first series version from account settings", async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    render(<SeriesSettings isPending={false} onCreate={onCreate} series={[]} seriesVersions={[]} />);

    fireEvent.change(screen.getByRole("textbox", { name: "系列名称" }), { target: { value: "越南道士" } });
    fireEvent.change(screen.getByRole("textbox", { name: "系列定位" }), { target: { value: "雨夜民俗" } });
    fireEvent.change(screen.getByRole("textbox", { name: "系列规则" }), { target: { value: '{"tone":"calm"}' } });
    fireEvent.click(screen.getByRole("button", { name: "创建系列 v1" }));

    await waitFor(() => expect(onCreate).toHaveBeenCalledWith({ name: "越南道士", rules: { tone: "calm", positioning: "雨夜民俗" } }));
  });

  it("直接展开系列历史版本，并限制列表高度", () => {
    const series = { account_id: "account-1", created_at: "2026-08-15T00:00:00.000Z", id: "series-1", name: "越南道士" } as Database["public"]["Tables"]["series"]["Row"];
    const seriesVersions = [
      { account_id: "account-1", created_at: "2026-08-17T00:00:00.000Z", id: "series-version-2", rules: {}, series_id: series.id, version: 2 },
      { account_id: "account-1", created_at: "2026-08-15T00:00:00.000Z", id: "series-version-1", rules: {}, series_id: series.id, version: 1 },
    ] as Database["public"]["Tables"]["series_versions"]["Row"][];

    render(<SeriesSettings isPending={false} onCreate={vi.fn()} series={[series]} seriesVersions={seriesVersions} />);

    expect(screen.getByText("最新 v2")).toBeTruthy();
    expect(screen.getByText("历史版本", { selector: "strong" })).toBeTruthy();
    expect(screen.getByText("v1")).toBeTruthy();
    expect(screen.getByLabelText("越南道士 历史版本")).toBeTruthy();
  });

  it("通过结构化表单编辑蓝图并保留高级规则", async () => {
    const user = userEvent.setup();
    const account = { created_at: "2026-08-15T00:00:00.000Z", current_blueprint_version_id: "blueprint-1", id: "account-1", name: "道工作室", slug: "dao-studio", timezone: "Asia/Shanghai" } as Database["public"]["Tables"]["accounts"]["Row"];
    const blueprint = { account_id: account.id, created_at: "2026-08-15T00:00:00.000Z", id: "blueprint-1", is_active: true, policy: { positioning: "旧定位", asset_root: "/Volumes/Media/dao", approval_gates: ["script"], allowed_tools: ["read", "write"], budgets: { script_writing_cents: 0, visual_planning_cents: 0, storyboard_planning_cents: 0 }, executors: { script_writing: { provider: "codex", model: "model-a", prompt_version: "script-v1" }, visual_planning: { provider: "codex", model: "model-b", prompt_version: "visual-v1" }, storyboard_planning: { provider: "codex", model: "model-c", prompt_version: "storyboard-v1" } }, soundtrack: { budget_cents: 99 } }, version: 1 } as Database["public"]["Tables"]["account_blueprint_versions"]["Row"];
    const onCreateBlueprint = vi.fn().mockResolvedValue({ ...blueprint, id: "blueprint-2", version: 2, is_active: false });
    render(<AccountWorkspace account={account} accounts={[account]} blueprints={[blueprint]} isPending="" onActivate={vi.fn()} onCreateBlueprint={onCreateBlueprint} onCreateSeries={vi.fn()} onSelectAccount={vi.fn()} series={[]} seriesVersions={[]} />);

    await user.click(screen.getByRole("tab", { name: "蓝图" }));
    await user.click(screen.getByRole("button", { name: "以此版本编辑" }));
    await user.clear(screen.getByLabelText("账号定位"));
    await user.type(screen.getByLabelText("账号定位"), "新定位");
    await user.click(screen.getByRole("button", { name: "保存为新版本" }));

    await waitFor(() => expect(onCreateBlueprint).toHaveBeenCalledWith(expect.objectContaining({ positioning: "新定位", soundtrack: { budget_cents: 99 } })));
  });

  it("从阻塞项编辑蓝图后可以应用到原生产单", async () => {
    const user = userEvent.setup();
    const account = { created_at: "2026-08-15T00:00:00.000Z", current_blueprint_version_id: "blueprint-1", id: "account-1", name: "道工作室", slug: "dao-studio", timezone: "Asia/Shanghai" } as Database["public"]["Tables"]["accounts"]["Row"];
    const blueprint = { account_id: account.id, created_at: "2026-08-15T00:00:00.000Z", id: "blueprint-1", is_active: true, policy: { positioning: "旧定位", asset_root: "/Volumes/Media/dao", approval_gates: ["script"], allowed_tools: ["read", "write"], budgets: { script_writing_cents: 0, visual_planning_cents: 0, storyboard_planning_cents: 0 }, executors: { script_writing: { provider: "codex", model: "model-a", prompt_version: "script-v1" }, visual_planning: { provider: "codex", model: "model-b", prompt_version: "visual-v1" }, storyboard_planning: { provider: "codex", model: "model-c", prompt_version: "storyboard-v1" } } }, version: 1 } as Database["public"]["Tables"]["account_blueprint_versions"]["Row"];
    const nextBlueprint = { ...blueprint, id: "blueprint-2", version: 2, is_active: false };
    const onCreateBlueprint = vi.fn().mockResolvedValue(nextBlueprint);
    const onApplyBlueprintToEpisode = vi.fn().mockResolvedValue(true);

    render(<AccountWorkspace account={account} accounts={[account]} blueprints={[blueprint]} blueprintRepairContext={{ blocker: { code: "executor_invalid", detail: "执行器 adapter 未配置。" }, episodeId: "episode-1" }} isPending="" onActivate={vi.fn()} onApplyBlueprintToEpisode={onApplyBlueprintToEpisode} onCreateBlueprint={onCreateBlueprint} onCreateSeries={vi.fn()} onSelectAccount={vi.fn()} series={[]} seriesVersions={[]} />);

    await user.click(screen.getByRole("button", { name: "以此版本编辑" }));
    await user.click(screen.getByRole("button", { name: "保存为新版本" }));
    expect(await screen.findByRole("heading", { name: "蓝图 v2 已创建" })).toBeTruthy();
    expect(screen.getByText("主脚本、已导入材料、审核包、批注、已完成任务和审计记录。", { exact: false })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "应用并继续当前生产单" }));
    await waitFor(() => expect(onApplyBlueprintToEpisode).toHaveBeenCalledWith({ blueprintVersionId: "blueprint-2", context: { blocker: { code: "executor_invalid", detail: "执行器 adapter 未配置。" }, episodeId: "episode-1" } }));
  });

  it("按日常工作流顺序显示导航，并为审核和发布显示待办数量", () => {
    expect(navigation.map((item) => item.label)).toEqual(["系列运营", "生产单", "审核", "发布队列", "复盘", "账号"]);
    const episode = { account_id: "account-1", blueprint_version_id: "blueprint-1", created_at: "2026-08-15T00:00:00.000Z", id: "episode-1", stage: "script_review", title: "待审核", updated_at: "2026-08-15T00:00:00.000Z" } as Database["public"]["Tables"]["episodes"]["Row"];
    expect(navigationBadgeCounts([episode], [], [])).toEqual({ reviews: 1, publish: 0 });
  });

  it("把 Worker 执行、完成和审核等待状态区分展示", () => {
    expect(episodeWorkerStatus({ main_script_revision_id: "revision-1", stage: "waiting_input" }, [])).toMatchObject({ label: "待开始制作", tone: "waiting" });
    expect(episodeWorkerStatus({ stage: "visual_draft" }, [{ status: "running", task_type: "prepare_visual_brief" }])).toMatchObject({ label: "执行中", tone: "running" });
    expect(episodeWorkerStatus({ stage: "visual_review" }, [{ status: "completed", task_type: "prepare_visual_brief" }])).toMatchObject({ label: "等待审核", tone: "review" });
    expect(episodeWorkerStatus({ stage: "storyboard_approved" }, [{ status: "completed", task_type: "draft_storyboard" }])).toMatchObject({ label: "已完成", tone: "completed" });
  });

  it("收起态导航仍保留审核和发布角标节点", () => {
    render(<NavigationButtons activeNavigation="reviews" badges={{ reviews: 2, publish: 1 }} onSelect={vi.fn()} />);

    expect(screen.getByLabelText("2 个待处理")).toBeTruthy();
    expect(screen.getByLabelText("1 个待处理")).toBeTruthy();
  });

  it("只显示当前筛选的生产单，并用分页控制长列表", async () => {
    const user = userEvent.setup();
    const account = { created_at: "2026-08-15T00:00:00.000Z", current_blueprint_version_id: "blueprint-1", id: "account-1", name: "道工作室", slug: "dao-studio", timezone: "Asia/Shanghai" } as Database["public"]["Tables"]["accounts"]["Row"];
    const blueprint = { account_id: account.id, created_at: "2026-08-15T00:00:00.000Z", id: "blueprint-1", is_active: true, policy: {}, version: 1 } as Database["public"]["Tables"]["account_blueprint_versions"]["Row"];
    const episodes = Array.from({ length: 21 }, (_, index) => ({ account_id: account.id, blueprint_version_id: blueprint.id, created_at: "2026-08-15T00:00:00.000Z", id: `episode-${index}`, stage: "waiting_input" as const, title: `生产单 ${index + 1}`, updated_at: "2026-08-15T00:00:00.000Z" }));
    const archivedEpisode = { ...episodes[0], archived_at: "2026-08-16T00:00:00.000Z", id: "episode-archived", title: "已归档生产单" };

    render(<EpisodeWorkspace accounts={[account]} accountsById={new Map([[account.id, account]])} artifacts={[]} blueprintsById={new Map([[blueprint.id, blueprint]])} currentNavigation="episodes" episodeVisibility="active" episodes={[...episodes, archivedEpisode]} filter="全部账号" onEpisodeVisibilityChange={vi.fn()} onFilter={vi.fn()} onSeriesFilter={vi.fn()} onSelectEpisode={vi.fn()} series={[]} seriesById={new Map()} seriesFilter="全部系列" seriesVersionsById={new Map()} selectedEpisode={null} />);

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

    render(<EpisodeWorkspace accounts={[account]} accountsById={new Map([[account.id, account]])} artifacts={[]} blueprintsById={new Map([[blueprint.id, blueprint]])} currentNavigation="episodes" episodeVisibility="active" episodes={[episode]} filter="全部账号" onDelete={onDelete} onEpisodeVisibilityChange={vi.fn()} onFilter={vi.fn()} onSetArchived={onSetArchived} onSeriesFilter={vi.fn()} onSelectEpisode={vi.fn()} onUpdateTitle={onUpdateTitle} series={[]} seriesById={new Map()} seriesFilter="全部系列" seriesVersionsById={new Map()} selectedEpisode={null} />);

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
