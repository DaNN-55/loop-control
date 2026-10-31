import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import type { Database } from "../lib/database.types";
import { AccountWorkspace } from "./AccountWorkspace";

vi.mock("../lib/viewTransport", () => ({ viewTransport: {} }));

type Account = Database["public"]["Tables"]["accounts"]["Row"];
type Blueprint = Database["public"]["Tables"]["account_blueprint_versions"]["Row"];
type Series = Database["public"]["Tables"]["series"]["Row"];
type SeriesVersion = Database["public"]["Tables"]["series_versions"]["Row"];
type PromptVersion = Database["public"]["Tables"]["prompt_versions"]["Row"];

const account: Account = { archived_at: null, created_at: "2026-08-14T00:00:00.000Z", current_blueprint_version_id: "blueprint-3", id: "account-1", name: "道工作室", slug: "dao-studio", timezone: "Asia/Shanghai" };
const storyboardHarness: PromptVersion = { account_id: account.id, capability: "storyboard_planning", content_hash: "a".repeat(64), created_at: "2026-08-22T00:00:00.000Z", created_by: "owner-1", id: "harness-storyboard-1", instructions: "先写可执行镜头。", is_active: true, name: "分镜规划 v1", slug: "storyboard-planning-v1", summary: "为审核准备可执行分镜。", version: 1 };
const blueprint: Blueprint = { account_id: account.id, archived_at: null, created_at: "2026-08-14T00:00:00.000Z", id: "blueprint-3", is_active: true, is_snapshot: false, policy: { approval_gates: ["script", "qc"], asset_root: "/Volumes/dao", executors: { storyboard_planning: { adapter: "codex", harness_id: storyboardHarness.id, model: "gpt-5.6-luna", prompt_version: storyboardHarness.slug }, visual_planning: { adapter: "codex", harness_id: storyboardHarness.id, model: "gpt-5.6-luna", prompt_version: storyboardHarness.slug } }, positioning: "越南民间信仰" }, version: 3 };
const series: Series = { account_id: account.id, created_at: "2026-08-14T00:00:00.000Z", id: "series-1", name: "越南民间传说" };
const seriesVersions: SeriesVersion[] = [
  { account_id: account.id, created_at: "2026-08-15T00:00:00.000Z", created_by: "owner-1", id: "series-version-2", rules: { positioning: "当前系列定位" }, series_id: series.id, version: 2 },
  { account_id: account.id, created_at: "2026-08-14T00:00:00.000Z", created_by: "owner-1", id: "series-version-1", rules: { positioning: "旧定位" }, series_id: series.id, version: 1 },
];

function renderWorkspace(overrides: Partial<ComponentProps<typeof AccountWorkspace>> = {}) {
  return render(<AccountWorkspace account={account} accounts={[account]} blueprints={[blueprint]} isPending="" onSelectAccount={vi.fn()} promptVersions={[storyboardHarness]} {...overrides} />);
}

describe("账号配置工作区", () => {
  it("切换分区后选中标签始终关联当前面板", async () => {
    const user = userEvent.setup();
    renderWorkspace({ series: [series], seriesVersions });
    for (const name of ["系列", "蓝图"]) {
      const tab = screen.getByRole("tab", { name });
      await user.click(tab);
      const panel = screen.getByRole("tabpanel", { name });
      expect(tab.getAttribute("aria-controls")).toBe(panel.id);
      expect(panel.getAttribute("aria-labelledby")).toBe(tab.id);
    }
  });

  it("用当前配置工作区取代蓝图版本管理", () => {
    renderWorkspace({ blueprints: [blueprint, { ...blueprint, id: "old", is_active: false, version: 2 }], onUpdateBlueprint: vi.fn().mockResolvedValue(blueprint) });

    expect(screen.getByLabelText("当前账号")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "蓝图配置" })).toBeNull();
    expect(screen.queryByRole("navigation", { name: "蓝图配置分区" })).toBeNull();
    expect(screen.queryByRole("complementary", { name: "账号默认配置检查" })).toBeNull();
    expect(screen.queryByText("蓝图版本")).toBeNull();
    expect(screen.queryByRole("button", { name: /激活|归档|停用/ })).toBeNull();
  });

  it("在账号操作菜单集中展示信息并支持归档", async () => {
    const user = userEvent.setup();
    const onSetAccountArchived = vi.fn().mockResolvedValue(true);
    renderWorkspace({ accountEpisodeCount: 7, onSetAccountArchived });

    await user.click(screen.getByRole("button", { name: "账号操作" }));
    const menu = screen.getByRole("menu", { name: "账号操作" });
    expect(within(menu).getByText("dao-studio")).toBeTruthy();
    expect(within(menu).getByText("Asia/Shanghai")).toBeTruthy();
    expect(within(menu).getByText("7 个")).toBeTruthy();
    await user.click(within(menu).getByRole("menuitem", { name: "归档账号" }));
    const dialog = screen.getByRole("dialog", { name: "归档账号" });
    expect(within(dialog).getByText(/已有生产单、系列和历史配置都会保留/)).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "确认归档账号" }));
    expect(onSetAccountArchived).toHaveBeenCalledWith(account.id, true);
  });

  it("直接编辑并保存当前蓝图", async () => {
    const user = userEvent.setup();
    const onUpdateBlueprint = vi.fn().mockResolvedValue(blueprint);
    renderWorkspace({ onUpdateBlueprint });

    await user.clear(screen.getByLabelText("账号定位"));
    await user.type(screen.getByLabelText("账号定位"), "新定位");
    await user.click(screen.getByRole("button", { name: "保存蓝图" }));
    const dialog = screen.getByRole("dialog", { name: "确认保存蓝图" });
    expect(within(dialog).getByText(/创作规则应用于之后新建的生产单/)).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "确认保存蓝图" }));

    expect(onUpdateBlueprint).toHaveBeenCalledWith(expect.objectContaining({ positioning: "新定位" }));
  });

  it("保存失败时在确认弹窗中展示错误并保留草稿", async () => {
    const user = userEvent.setup();
    renderWorkspace({onUpdateBlueprint: vi.fn().mockResolvedValue(null)});
    await user.clear(screen.getByLabelText("账号定位"));
    await user.type(screen.getByLabelText("账号定位"), "失败后保留的草稿");
    await user.click(screen.getByRole("button", {name: "保存蓝图"}));
    const dialog = screen.getByRole("dialog", {name: "确认保存蓝图"});
    await user.click(within(dialog).getByRole("button", {name: "确认保存蓝图"}));
    expect(await within(dialog).findByRole("alert")).toHaveProperty("textContent", "蓝图未保存，请处理错误后重试。");
    await user.click(within(dialog).getByRole("button", {name: "取消"}));
    expect(screen.getByLabelText("账号定位")).toHaveProperty("value", "失败后保留的草稿");
  });

  it("取消编辑会恢复当前保存值", async () => {
    const user = userEvent.setup();
    const onDirtyChange = vi.fn();
    renderWorkspace({ onDirtyChange });
    await user.clear(screen.getByLabelText("账号定位"));
    await user.type(screen.getByLabelText("账号定位"), "未保存定位");
    await user.click(screen.getByRole("button", { name: "撤销修改" }));
    expect((screen.getByLabelText("账号定位") as HTMLTextAreaElement).value).toBe("越南民间信仰");
    expect(onDirtyChange).toHaveBeenCalledWith(true);
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
  });

  it("有未保存修改时确认后才切换到系列", async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderWorkspace();
    await user.type(screen.getByLabelText("账号定位"), "未保存");
    await user.click(screen.getByRole("tab", { name: "系列" }));
    expect(screen.getByRole("tab", { name: "蓝图" }).getAttribute("aria-selected")).toBe("true");
    confirm.mockReturnValue(true);
    await user.click(screen.getByRole("tab", { name: "系列" }));
    expect(screen.getByRole("tab", { name: "系列" }).getAttribute("aria-selected")).toBe("true");
    confirm.mockRestore();
  });

  it("账号目录独立维护，蓝图只显示内容规则", () => {
    renderWorkspace();
    const groups=screen.getAllByRole("group").filter(group=>group.tagName==='FIELDSET');
    expect(groups.map(group=>group.querySelector('legend')?.textContent)).toEqual(['账号专属目录','账号定位','创作规则']);
    expect(screen.queryByRole('table',{name:'生产能力配置矩阵'})).toBeNull();
    expect(screen.queryByRole('button',{name:'修改分镜规划配置'})).toBeNull();
    for(const name of ['启用图片生成','启用A-roll','启用B-roll','启用旁白','启用配乐 / 音效'])expect(screen.queryByRole('checkbox',{name})).toBeNull();
  });

  it("系列页展示版本历史并通过新版本保存", async () => {
    const user = userEvent.setup();
    const onCreateSeriesVersion = vi.fn().mockResolvedValue(undefined);
    renderWorkspace({ onCreateSeriesVersion, series: [series], seriesVersions });

    await user.click(screen.getByRole("tab", { name: "系列" }));
    expect(screen.getByRole("heading", { name: `${series.name} · 当前 v2` })).toBeTruthy();
    expect((screen.getByLabelText("系列定位") as HTMLTextAreaElement).value).toBe("当前系列定位");
    expect(screen.getByRole("heading", { name: "版本历史" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "保存为 v3" }));
    const dialog = screen.getByRole("dialog", { name: "确认保存系列版本" });
    expect(within(dialog).getByText(/创建系列 v3/)).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "确认保存为 v3" }));
    expect(onCreateSeriesVersion).toHaveBeenCalledWith({ seriesId: series.id, rules: expect.objectContaining({ positioning: "当前系列定位" }) });
  });

  it("系列分组调整后仍保存全部字段，并在底部恢复保存状态", async () => {
    const user = userEvent.setup();
    const onCreateSeriesVersion = vi.fn().mockResolvedValue(undefined);
    renderWorkspace({onCreateSeriesVersion, series:[series], seriesVersions});
    await user.click(screen.getByRole("tab", {name:"系列"}));
    const footer = screen.getByRole("button", {name:"保存为 v3"}).closest("footer") as HTMLElement;
    for (const [label, value] of [["系列定位", "聚焦城市生活"], ["内容格式", "竖屏"], ["角色设定", "主持人"], ["地点设定", "街区"], ["视觉风格", "写实"], ["叙事结构", "开场到结尾"], ["限制与禁用内容", "不使用商标"]]) {
      await user.clear(screen.getByLabelText(label));
      await user.type(screen.getByLabelText(label), value);
    }
    expect(within(footer).getByRole("status").textContent).toBe("有未保存更改");
    await user.click(screen.getByRole("button", {name:"保存为 v3"}));
    await user.click(screen.getByRole("button", {name:"确认保存为 v3"}));
    expect(onCreateSeriesVersion).toHaveBeenCalledWith({seriesId:series.id,rules:expect.objectContaining({positioning:"聚焦城市生活",format:"竖屏",characters:"主持人",locations:"街区",visual_style:"写实",narrative_structure:"开场到结尾",restrictions:"不使用商标"})});
    expect(within(footer).getByRole("status").textContent).toBe("已保存");
  });

  it("系列保存失败时错误在弹窗内可见，取消后可撤销草稿", async () => {
    const user = userEvent.setup();
    renderWorkspace({onCreateSeriesVersion:vi.fn().mockRejectedValue(new Error("系列保存失败，请重试。")),series:[series],seriesVersions});
    await user.click(screen.getByRole("tab", {name:"系列"}));
    await user.type(screen.getByLabelText("系列定位"), "保留草稿");
    await user.click(screen.getByRole("button", {name:"保存为 v3"}));
    const dialog = screen.getByRole("dialog", {name:"确认保存系列版本"});
    await user.click(within(dialog).getByRole("button", {name:"确认保存为 v3"}));
    expect(await within(dialog).findByRole("alert")).toHaveProperty("textContent","系列保存失败，请重试。");
    await user.click(within(dialog).getByRole("button", {name:"取消"}));
    expect(screen.getByLabelText("系列定位")).toHaveProperty("value","当前系列定位保留草稿");
    await user.click(screen.getByRole("button", {name:"撤销修改"}));
    expect(screen.getByLabelText("系列定位")).toHaveProperty("value","当前系列定位");
  });

  it("系列有未保存修改时也会拦截离开", async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderWorkspace({ series: [series], seriesVersions });
    await user.click(screen.getByRole("tab", { name: "系列" }));
    await user.type(screen.getByLabelText("系列定位"), "未保存");
    await user.click(screen.getByRole("tab", { name: "蓝图" }));
    expect(screen.getByRole("tab", { name: "系列" }).getAttribute("aria-selected")).toBe("true");
    confirm.mockReturnValue(true);
    await user.click(screen.getByRole("tab", { name: "蓝图" }));
    expect(screen.getByRole("tab", { name: "蓝图" }).getAttribute("aria-selected")).toBe("true");
    confirm.mockRestore();
  });

  it("保留新建系列入口", async () => {
    const user = userEvent.setup();
    function RerenderingWorkspace() {
      const [, setDirty] = useState(false);
      return <AccountWorkspace account={account} accounts={[account]} blueprints={[blueprint]} isPending="" onDirtyChange={setDirty} onSelectAccount={vi.fn()} series={[series]} seriesVersions={[...seriesVersions]} />;
    }
    render(<RerenderingWorkspace />);
    await user.click(screen.getByRole("tab", { name: "系列" }));
    await user.click(screen.getByRole("button", { name: "新建系列" }));
    expect(screen.getByRole("heading", { name: "新建系列" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "创建系列" })).toBeTruthy();
    await user.type(screen.getByRole("textbox", { name: "系列名称" }), "新系列");
    expect((screen.getByRole("textbox", { name: "系列名称" }) as HTMLInputElement).value).toBe("新系列");
  });

  it("支持重命名账号", async () => {
    const user = userEvent.setup();
    const onRenameAccount = vi.fn().mockResolvedValue(true);
    renderWorkspace({ onRenameAccount });
    await user.click(screen.getByRole("button", { name: "账号操作" }));
    await user.click(screen.getByRole("menuitem", { name: "重命名" }));
    await user.clear(screen.getByRole("textbox", { name: "账号显示名称" }));
    await user.type(screen.getByRole("textbox", { name: "账号显示名称" }), "新名称");
    await user.click(screen.getByRole("button", { name: "保存名称" }));
    expect(onRenameAccount).toHaveBeenCalledWith(account.id, "新名称");
  });

  it("有生产单时阻止删除账号", async () => {
    const user = userEvent.setup();
    renderWorkspace({ accountEpisodeCount: 1 });
    await user.click(screen.getByRole("button", { name: "账号操作" }));
    await user.click(screen.getByRole("menuitem", { name: "删除账号" }));
    expect(screen.getByText(/该账号有 1 个生产单，当前不能删除/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "确认删除账号" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("无生产单时要求输入账号名后才删除", async () => {
    const user = userEvent.setup();
    const onDeleteAccount = vi.fn().mockResolvedValue(true);
    renderWorkspace({ accountEpisodeCount: 0, onDeleteAccount });
    await user.click(screen.getByRole("button", { name: "账号操作" }));
    await user.click(screen.getByRole("menuitem", { name: "删除账号" }));
    const dialog = screen.getByRole("dialog", { name: "删除账号" });
    const confirm = within(dialog).getByRole("button", { name: "确认删除账号" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    await user.type(within(dialog).getByLabelText("删除账号确认文本"), account.name);
    expect(confirm.disabled).toBe(false);
    await user.click(confirm);
    expect(onDeleteAccount).toHaveBeenCalledWith(account.id, account.name);
  });

  it("从生产单进入时只显示定向修复表单", () => {
    renderWorkspace({ blueprintRepairContext: { blocker: { code: "b_roll_executor_unavailable", detail: "B-roll 缺少适配器", taskType: "prepare_visual_brief" }, blueprintVersionId: blueprint.id, episodeId: "episode-1" } });
    expect(screen.getByRole("heading", { name: "修复当前生产单的 B-roll" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "保存并继续当前生产单" })).toBeTruthy();
    expect(screen.queryByRole("complementary", { name: "账号默认配置检查" })).toBeNull();
  });

  it("按 Worker 的可修复目标打开对应配置，不读取错误文案", () => {
    renderWorkspace({ blueprintRepairContext: { blocker: { action: "edit_blueprint", capability: "b_roll_generation", code: "blueprint_configuration", detail: "需要更新配置。" }, blueprintVersionId: blueprint.id, episodeId: "episode-1" } });

    expect(screen.getByRole("heading", { name: "修复当前生产单的 B-roll" })).toBeTruthy();
  });

  it("修复视觉或分镜阻塞时冻结同一个已登记 Harness", async () => {
    const user = userEvent.setup();
    const onApplyEpisodeRepair = vi.fn().mockResolvedValue(true);
    renderWorkspace({ blueprintRepairContext: { blocker: { code: "storyboard_executor_invalid", detail: "分镜规划缺少 Harness", taskType: "prepare_visual_brief" }, blueprintVersionId: blueprint.id, episodeId: "episode-1" }, onApplyEpisodeRepair });

    expect((screen.getByLabelText("Prompt Harness") as HTMLSelectElement).value).toBe(storyboardHarness.id);
    await user.click(screen.getByRole("button", { name: "保存并继续当前生产单" }));

    await waitFor(() => expect(onApplyEpisodeRepair).toHaveBeenCalledWith(expect.objectContaining({ policy: expect.objectContaining({ executors: expect.objectContaining({ storyboard_planning: expect.objectContaining({ harness_id: storyboardHarness.id }) }) }) })));
  });
});
