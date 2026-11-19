import { fireEvent,render,screen,waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe,expect,it,vi } from "vitest";
import { TimezoneSelect } from './accounts/AccountForm';
import { AccountWorkspace,SeriesSettings } from './accounts/AccountWorkspace';
import { EpisodeForm } from './episodes/EpisodeForm';
import type { Database } from "./lib/database.types";
import { defaultBlueprintPolicy,parseBlueprintPolicy,withBlueprintAssetRoot } from "./platform/blueprintPolicy";
import { EpisodeWorkspace } from './workspace/WorkspaceViews';

vi.mock("./lib/viewTransport", () => ({
  viewTransport: {
    rpc: vi.fn().mockImplementation(()=>Object.assign(Promise.resolve({data:[],error:null}),{range:vi.fn().mockResolvedValue({data:[],error:null,count:0})})),
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
      onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
    },
  },
}));

describe("approval console", () => {

  it("创建生产单前展示阻塞原因并保持生产单未创建", async () => {
    const user = userEvent.setup();
    const account = { current_blueprint_version_id: "00000000-0000-0000-0000-000000000001", id: "00000000-0000-0000-0000-000000000002", name: "道工作室" } as Database["public"]["Tables"]["accounts"]["Row"];
    const preflight = { version: "worker-preflight/v1" as const, checks: [{ capability: "script_writing", check: "blueprint_configuration", phase: "preflight" as const, status: "blocked" as const, reason: "脚本能力缺少模型。", action: "edit_blueprint" as const, scope: "blueprint" as const }] };
    const onSubmit = vi.fn().mockResolvedValue(preflight);

    render(<EpisodeForm accounts={[account]} isPending={false} onClose={vi.fn()} onOpenBlueprint={vi.fn()} onSubmit={onSubmit} series={[]} seriesVersions={[]} />);

    await user.click(screen.getByRole("button", { name: "创建生产单" }));

    expect(await screen.findByText("创建条件未满足（1）")).toBeTruthy();
    const preflightDetails = screen.getByText("创建条件未满足（1）").closest("details");
    expect(preflightDetails).toBeTruthy();
    expect((preflightDetails as HTMLDetailsElement).open).toBe(false);
    expect(screen.getByText("生产单尚未创建。处理以下原因后重试。")).toBeTruthy();
    expect(screen.getByText("任务制作配置需要核对")).toBeTruthy();
    expect(onSubmit).toHaveBeenCalledWith({ accountId: account.id, isTest: false, seriesVersionId: null, title: "" });
  });

  it("创建时分步显示当前进度", () => {
    const account = { current_blueprint_version_id: "00000000-0000-0000-0000-000000000001", id: "00000000-0000-0000-0000-000000000002", name: "道工作室" } as Database["public"]["Tables"]["accounts"]["Row"];

    render(<EpisodeForm accounts={[account]} creationStartedAt={Date.now()} creationStep="preflight" isPending onClose={vi.fn()} onSubmit={vi.fn()} series={[]} seriesVersions={[]} />);

    expect(screen.getByRole("status").textContent).toContain("正在创建生产单");
    expect(screen.getByText("创建生产单")).toBeTruthy();
    expect(screen.getByText(/冻结当前蓝图和系列版本。 本阶段已等待 0 秒。/)).toBeTruthy();
    expect(screen.getByText("创建生产单")).toBeTruthy();
    expect(screen.getByRole("button", { name: "正在处理…" }).hasAttribute("disabled")).toBe(true);
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

  it("creates the first series version from account settings", async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    render(<SeriesSettings isPending={false} onCreate={onCreate} series={[]} seriesVersions={[]} />);

    const user=userEvent.setup();await user.click(screen.getByText("创作规则（选填）"));
    fireEvent.change(screen.getByRole("textbox", { name: "系列名称" }), { target: { value: "越南道士" } });
    fireEvent.change(screen.getByRole("textbox", { name: "系列定位" }), { target: { value: "雨夜民俗" } });
    fireEvent.click(screen.getByRole("button", { name: "创建系列" }));
    expect(screen.queryByRole("dialog", { name: "确认创建系列" })).toBeNull();

    await waitFor(() => expect(onCreate).toHaveBeenCalledWith({ name: "越南道士", rules: { positioning: "雨夜民俗" } }));
  });

  it("系列设置隐藏版本入口，直接保存仍提交系列规则", async () => {
    const series = { account_id: "account-1", created_at: "2026-08-15T00:00:00.000Z", id: "series-1", name: "越南道士" } as Database["public"]["Tables"]["series"]["Row"];
    const seriesVersions = [
      { account_id: "account-1", created_at: "2026-08-17T00:00:00.000Z", id: "series-version-2", rules: {}, series_id: series.id, version: 2 },
      { account_id: "account-1", created_at: "2026-08-15T00:00:00.000Z", id: "series-version-1", rules: {}, series_id: series.id, version: 1 },
    ] as Database["public"]["Tables"]["series_versions"]["Row"][];

    const save=vi.fn().mockResolvedValue(undefined);
    render(<SeriesSettings isPending={false} onCreate={vi.fn()} onCreateVersion={save} series={[series]} seriesVersions={seriesVersions} />);

    expect(screen.getByRole("heading", { name: "越南道士" })).toBeTruthy();
    expect(screen.queryByText("当前 v2")).toBeNull();
    expect(screen.queryByRole("heading", { name: "版本历史" })).toBeNull();
    expect((screen.getByLabelText("系列定位") as HTMLTextAreaElement).readOnly).toBe(true);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "修改" }));
    await user.click(screen.getByRole("button", { name: "保存系列设置" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(save).toHaveBeenCalledExactlyOnceWith({seriesId:series.id,rules:{}});
    expect(screen.getByRole("status").textContent).toBe("已保存");
  });

  it("通过结构化表单编辑蓝图并保留高级创作规则", async () => {
    const user = userEvent.setup();
    const account = { created_at: "2026-08-15T00:00:00.000Z", current_blueprint_version_id: "blueprint-1", id: "account-1", name: "道工作室", slug: "dao-studio", timezone: "Asia/Shanghai" } as Database["public"]["Tables"]["accounts"]["Row"];
    const storyboardHarness = { account_id: account.id, capability: "storyboard_planning", content_hash: "a".repeat(64), created_at: "2026-08-15T00:00:00.000Z", created_by: "owner-1", id: "harness-storyboard-1", instructions: "生成可审核分镜。", is_active: true, name: "分镜规划 v1", slug: "storyboard-planning-v1", summary: "测试 Harness。", version: 1 } as Database["public"]["Tables"]["prompt_versions"]["Row"];
    const blueprint = { account_id: account.id, created_at: "2026-08-15T00:00:00.000Z", id: "blueprint-1", is_active: true, archived_at:null, is_snapshot:false, policy: { positioning: "旧定位", visual_style: "保留手绘线条", asset_root: "/Volumes/Media/dao", approval_gates: ["script"], allowed_tools: ["read", "write"], budgets: { script_writing_cents: 0, visual_planning_cents: 0, storyboard_planning_cents: 0 }, executors: { script_writing: { provider: "codex", model: "model-a", prompt_version: "script-v1" }, visual_planning: { adapter: "codex", harness_id: storyboardHarness.id, provider: "codex", model: "model-c", prompt_version: storyboardHarness.slug }, storyboard_planning: { adapter: "codex", harness_id: storyboardHarness.id, provider: "codex", model: "model-c", prompt_version: storyboardHarness.slug } }, soundtrack: { execution_path: "external", credential_ref: "44444444-4444-4444-8444-444444444444", executor: { provider: "freesound", adapter: "freesound_preview", model: "freesound-preview-v1", prompt_version: "soundtrack-v1" }, allowed_tools: ["read", "write"], budget_cents: 99, max_attempts: 1 } }, version: 1 } as Database["public"]["Tables"]["account_blueprint_versions"]["Row"];
    const onUpdateBlueprint = vi.fn().mockResolvedValue(blueprint);
    render(<AccountWorkspace account={account} blueprints={[blueprint]} connectionVersions={[{ adapter: "freesound_preview", connection_id: "44444444-4444-4444-8444-444444444444", created_at: "2026-08-15T00:00:00.000Z", endpoint: "https://api.freesound.org", id: "44444444-4444-4444-8444-444444444444", is_current: true, provider: "freesound", revoked_at: null, status: "verified", version: 1 }]} externalConnections={[{ adapter: "freesound_preview", created_at: "2026-08-15T00:00:00.000Z", created_by: "owner-1", current_version_id: "44444444-4444-4444-8444-444444444444", id: "44444444-4444-4444-8444-444444444444", last_verification_detail: null, last_verified_at: "2026-08-15T00:00:00.000Z", name: "主 Freesound", provider: "freesound", status: "verified", description:"", endpoint:"https://api.freesound.org" }]} isPending="" onUpdateBlueprint={onUpdateBlueprint} onCreateSeries={vi.fn()} promptVersions={[storyboardHarness]} series={[]} seriesVersions={[]} />);

    await user.click(screen.getByRole("button", { name: "修改" }));
    await user.clear(screen.getByLabelText("内容定位"));
    await user.type(screen.getByLabelText("内容定位"), "新定位");
    await user.click(screen.getByRole("button", { name: /保存通用规则|保存通用规则/ }));
    expect(screen.queryByRole("dialog")).toBeNull();

    await waitFor(() => expect(onUpdateBlueprint).toHaveBeenCalledWith({ positioning: "新定位", visual_style: "保留手绘线条" }));
    expect(blueprint.policy).toMatchObject({ soundtrack: { executor: { adapter: "freesound_preview" } } });
  });

  it("只显示当前筛选的生产单，并用分页控制长列表", async () => {
    const user = userEvent.setup();
    const account = { created_at: "2026-08-15T00:00:00.000Z", current_blueprint_version_id: "blueprint-1", id: "account-1", name: "道工作室", slug: "dao-studio", timezone: "Asia/Shanghai" } as Database["public"]["Tables"]["accounts"]["Row"];
    const blueprint = { account_id: account.id, created_at: "2026-08-15T00:00:00.000Z", id: "blueprint-1", is_active: true, archived_at:null, is_snapshot:false, policy: {}, version: 1 } as Database["public"]["Tables"]["account_blueprint_versions"]["Row"];
    const episodes = Array.from({ length: 21 }, (_, index) => ({ series_version_id:null, main_script_revision_id: null, archived_at: null, is_test: false, script_source: "provided", worker_preflight_at: null, audio_source_mode: "tts", tts_language_code: null, tts_voice: null, tts_speaking_rate: null, account_id: account.id, blueprint_version_id: blueprint.id, created_at: "2026-08-15T00:00:00.000Z", id: `episode-${index}`, stage: "waiting_input" as const, title: `生产单 ${index + 1}`, updated_at: "2026-08-15T00:00:00.000Z" }));
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
    const blueprint = { account_id: account.id, created_at: "2026-08-15T00:00:00.000Z", id: "blueprint-1", is_active: true, archived_at:null, is_snapshot:false, policy: { asset_root: "/Volumes/Media/dao" }, version: 1 } as Database["public"]["Tables"]["account_blueprint_versions"]["Row"];
    const episode = { series_version_id:null, main_script_revision_id: null, archived_at: null, script_source: "provided", worker_preflight_at: null, audio_source_mode: "tts", tts_language_code: null, tts_voice: null, tts_speaking_rate: null, account_id: account.id, blueprint_version_id: blueprint.id, created_at: "2026-08-15T00:00:00.000Z", id: "episode-test", is_test: true, stage: "waiting_input" as const, title: "测试生产单", updated_at: "2026-08-15T00:00:00.000Z" };
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
