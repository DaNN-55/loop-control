import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Database } from "./lib/database.types";
import { App, EpisodeWorkspace, NavigationButtons, SeriesSettings, navigation, navigationBadgeCounts } from "./App";
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
    fireEvent.change(screen.getByRole("textbox", { name: "系列规则" }), { target: { value: '{"tone":"calm"}' } });
    fireEvent.click(screen.getByRole("button", { name: "创建系列 v1" }));

    await waitFor(() => expect(onCreate).toHaveBeenCalledWith({ name: "越南道士", rules: { tone: "calm" } }));
  });

  it("按日常工作流顺序显示导航，并为审核和发布显示待办数量", () => {
    expect(navigation.map((item) => item.label)).toEqual(["系列运营", "生产单", "审核", "发布队列", "复盘", "账号"]);
    const episode = { account_id: "account-1", blueprint_version_id: "blueprint-1", created_at: "2026-08-15T00:00:00.000Z", id: "episode-1", stage: "script_review", title: "待审核", updated_at: "2026-08-15T00:00:00.000Z" } as Database["public"]["Tables"]["episodes"]["Row"];
    expect(navigationBadgeCounts([episode], [], [])).toEqual({ reviews: 1, publish: 0 });
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
});
