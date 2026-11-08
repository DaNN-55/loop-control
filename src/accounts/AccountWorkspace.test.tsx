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
  return render(<AccountWorkspace account={account} blueprints={[blueprint]} isPending="" promptVersions={[storyboardHarness]} {...overrides} />);
}

describe("账号配置工作区", () => {
  it("账号设置只列出通用规则与自建系列，不提供未分系列入口", async () => {
    const user=userEvent.setup();
    renderWorkspace({series:[series],seriesVersions});
    expect(screen.queryByRole("button",{name:"未分系列"})).toBeNull();
    expect(screen.getByRole("tab",{name:"通用规则"})).toBeTruthy();
    expect(screen.queryByRole("button",{name:series.name})).toBeNull();
    await user.click(screen.getByRole("tab", {name:"系列规则"}));
    expect(screen.queryByRole("heading",{name:"未分系列"})).toBeNull();
    expect(screen.getByLabelText("系列定位")).toHaveProperty("value","当前系列定位");
  });

  it("账号设置管理目录，系列导航只在系列标签显示", async () => {
    const user = userEvent.setup();
    renderWorkspace({ series: [series], seriesVersions });
    expect(screen.getByRole("heading", {name:account.name, level:1})).toBeTruthy();
    expect(screen.getByRole("tab", {name:"通用规则"}).getAttribute("aria-selected")).toBe("true");
    expect(screen.queryByRole("navigation", {name:"系列导航"})).toBeNull();
    expect(screen.queryByText("账号目录")).toBeNull();
    await user.click(screen.getByRole("button", {name:"账号设置"}));
    const settings = screen.getByRole("dialog", {name:"账号设置"});
    expect(within(settings).getByText("账号目录")).toBeTruthy();
    await user.click(within(settings).getByRole("button", {name:"关闭账号设置"}));
    await user.click(screen.getByRole("tab", {name:"系列规则"}));
    const navigation = screen.getByRole("navigation", {name:"系列导航"});
    expect(within(navigation).getByRole("button", {name:"新建系列"})).toBeTruthy();
    expect(within(navigation).queryByRole("searchbox", {name:"查找系列"})).toBeNull();
    expect(screen.getByLabelText("系列定位")).toHaveProperty("value", "当前系列定位");
  });

  it("账号名称从账号设置修改，规则草稿在重命名后保留", async () => {
    const user = userEvent.setup();
    const onUpdateBlueprint = vi.fn();
    function ReadbackWorkspace() {
      const [currentAccount, setAccount] = useState(account);
      return <AccountWorkspace account={currentAccount} blueprints={[{...blueprint,policy:JSON.parse(JSON.stringify(blueprint.policy))}]} isPending="" onUpdateBlueprint={onUpdateBlueprint} onRenameAccount={async (_id,name)=>{setAccount({...account,name});return true;}}/>;
    }
    render(<ReadbackWorkspace/>);
    await user.click(screen.getByRole("button", { name: "修改" }));
    await user.type(screen.getByLabelText("账号定位"), "规则草稿");
    await user.click(screen.getByRole("button", {name:"账号设置"}));
    await user.click(screen.getByRole("button", {name:"重命名"}));
    await user.clear(screen.getByLabelText("账号显示名称"));
    await user.type(screen.getByLabelText("账号显示名称"), "新名称");
    await user.click(screen.getByRole("button", {name:"保存名称"}));
    expect(screen.getByLabelText("账号定位")).toHaveProperty("value", "越南民间信仰规则草稿");
    expect(screen.getByRole("heading", {name:"新名称",level:1})).toBeTruthy();
    expect(onUpdateBlueprint).not.toHaveBeenCalled();
  });

  it("系列仅显示明确字段，保存时保留已有扩展与账号硬约束", async () => {
    const user = userEvent.setup();
    const onCreateSeriesVersion = vi.fn().mockResolvedValue(undefined);
    renderWorkspace({onCreateSeriesVersion, series:[series], seriesVersions:[{...seriesVersions[0],rules:{positioning:"当前系列定位", extension:{nested:["keep"]}}}]});
    await user.click(screen.getByRole("tab", {name:"系列规则"}));
    await user.click(screen.getByRole("button", {name:"修改"}));
    expect(screen.queryByText("账号硬约束始终生效")).toBeNull();
    expect(screen.getByLabelText("视觉风格")).toHaveProperty("placeholder", "沿用账号通用规则");
    expect(screen.queryByText("补充规则")).toBeNull();
    expect(screen.queryByLabelText("nested")).toBeNull();
    await user.clear(screen.getByLabelText("系列定位"));
    await user.type(screen.getByLabelText("系列定位"), "更新后的定位");
    expect(screen.queryByLabelText("系列扩展规则 JSON")).toBeNull();
    await user.click(screen.getByRole("button", {name:"保存系列设置"}));
    await user.click(screen.getByRole("button", {name:"确认保存为 v3"}));
    expect(onCreateSeriesVersion).toHaveBeenCalledWith({seriesId:series.id,rules:{positioning:"更新后的定位",extension:{nested:["keep"]}}});
  });

  it("显示系列定位、继承的视觉风格及两处限制，编辑时只编辑系列值", async () => {
    const user=userEvent.setup();
    renderWorkspace({
      blueprints:[{...blueprint,policy:{positioning:"账号定位默认值",visual_style:"暖色自然光",restrictions:"禁止未授权素材"}}],
      series:[series],
      seriesVersions:[{...seriesVersions[0],rules:{positioning:"系列定位",restrictions:"禁止夸大宣传"}}],
    });
    await user.click(screen.getByRole("tab", {name:"系列规则"}));
    expect(screen.getByLabelText("系列定位")).toHaveProperty("value","系列定位");
    expect(screen.getByText("来自系列规则")).toBeTruthy();
    expect(screen.getByLabelText("视觉风格")).toHaveProperty("value","暖色自然光");
    expect(screen.getByText("沿用账号通用规则")).toBeTruthy();
    expect(screen.getByLabelText("限制与禁用内容")).toHaveProperty("value","账号通用规则\n禁止未授权素材\n\n系列规则\n禁止夸大宣传");
    await user.click(screen.getByRole("button",{name:"修改"}));
    expect(screen.getByLabelText("限制与禁用内容")).toHaveProperty("value","禁止夸大宣传");
    expect(screen.getByText(/同时生效的账号限制/)).toBeTruthy();
  });

  it("用当前配置工作区取代蓝图版本管理", () => {
    renderWorkspace({ blueprints: [blueprint, { ...blueprint, id: "old", is_active: false, version: 2 }], onUpdateBlueprint: vi.fn().mockResolvedValue(blueprint) });

    expect(screen.getByRole("heading", {name:account.name,level:1})).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "蓝图配置" })).toBeNull();
    expect(screen.queryByRole("navigation", { name: "蓝图配置分区" })).toBeNull();
    expect(screen.queryByRole("complementary", { name: "账号默认配置检查" })).toBeNull();
    expect(screen.queryByText("蓝图版本")).toBeNull();
    expect(screen.queryByText("历史版本")).toBeNull();
    expect(screen.getByRole("heading", { name: /^通用规则$/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /激活|归档|停用/ })).toBeNull();
  });

  it("在账号设置集中展示信息并支持归档", async () => {
    const user = userEvent.setup();
    const onSetAccountArchived = vi.fn().mockResolvedValue(true);
    renderWorkspace({ accountEpisodeCount: 7, onSetAccountArchived });

    await user.click(screen.getByRole("button", { name: "账号设置" }));
    const menu = screen.getByRole("dialog", { name: "账号设置" });
    expect(within(menu).getByText("dao-studio")).toBeTruthy();
    expect(within(menu).getByText("Asia/Shanghai")).toBeTruthy();
    expect(within(menu).getByText("7 个")).toBeTruthy();
    await user.click(within(menu).getByRole("button", { name: "归档账号" }));
    const dialog = screen.getByRole("dialog", { name: "归档账号" });
    expect(within(dialog).getByText(/已有生产单、系列和历史配置都会保留/)).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "确认归档账号" }));
    expect(onSetAccountArchived).toHaveBeenCalledWith(account.id, true);
  });

  it("直接编辑并保存当前蓝图", async () => {
    const user = userEvent.setup();
    const onUpdateBlueprint = vi.fn().mockResolvedValue(blueprint);
    renderWorkspace({ onUpdateBlueprint });

    await user.click(screen.getByRole("button", { name: "修改" }));
    await user.clear(screen.getByLabelText("账号定位"));
    await user.type(screen.getByLabelText("账号定位"), "新定位");
    await user.click(screen.getByRole("button", { name: "保存通用规则" }));
    const dialog = screen.getByRole("dialog", { name: "确认保存通用规则" });
    expect(within(dialog).getByText(/创作规则应用于之后新建的生产单；已有生产单保留原规则/)).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "确认保存通用规则" }));

    expect(onUpdateBlueprint).toHaveBeenCalledWith(expect.objectContaining({ positioning: "新定位" }));
  });

  it("保存失败时在确认弹窗中展示错误并保留草稿", async () => {
    const user = userEvent.setup();
    renderWorkspace({onUpdateBlueprint: vi.fn().mockResolvedValue(null)});
    await user.click(screen.getByRole("button", { name: "修改" }));
    await user.clear(screen.getByLabelText("账号定位"));
    await user.type(screen.getByLabelText("账号定位"), "失败后保留的草稿");
    await user.click(screen.getByRole("button", {name: "保存通用规则"}));
    const dialog = screen.getByRole("dialog", {name: "确认保存通用规则"});
    await user.click(within(dialog).getByRole("button", {name: "确认保存通用规则"}));
    expect(await within(dialog).findByRole("alert")).toHaveProperty("textContent", "规则未保存，请处理错误后重试。");
    await user.click(within(dialog).getByRole("button", {name: "取消"}));
    expect(screen.getByLabelText("账号定位")).toHaveProperty("value", "失败后保留的草稿");
  });

  it("取消编辑会恢复当前保存值", async () => {
    const user = userEvent.setup();
    const onDirtyChange = vi.fn();
    renderWorkspace({ onDirtyChange });
    await user.click(screen.getByRole("button", { name: "修改" }));
    await user.clear(screen.getByLabelText("账号定位"));
    await user.type(screen.getByLabelText("账号定位"), "未保存定位");
    const confirm = vi.spyOn(window,"confirm").mockReturnValueOnce(true);
    await user.click(screen.getByRole("button", { name: "放弃修改" }));
    expect(confirm).toHaveBeenCalledWith("放弃通用规则的未保存修改？");
    confirm.mockRestore();
    expect((screen.getByLabelText("账号定位") as HTMLTextAreaElement).value).toBe("越南民间信仰");
    expect(onDirtyChange).toHaveBeenCalledWith(true);
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
  });

  it("有未保存修改时确认后才切换到系列", async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderWorkspace({series:[series],seriesVersions});
    await user.click(screen.getByRole("button", { name: "修改" }));
    await user.type(screen.getByLabelText("账号定位"), "未保存");
    await user.click(screen.getByRole("tab", {name:"系列规则"}));
    expect(screen.getByRole("tab", { name: "通用规则" }).getAttribute("aria-selected")).toBe("true");
    confirm.mockReturnValue(true);
    await user.click(screen.getByRole("tab", {name:"系列规则"}));
    await user.click(screen.getByRole("button", {name:"修改"}));
    expect(screen.getByRole("button", { name: series.name }).getAttribute("aria-current")).toBe("page");
    confirm.mockRestore();
  });

  it("账号目录独立维护，蓝图只显示内容规则", () => {
    renderWorkspace();
    const groups=screen.getAllByRole("group").filter(group=>group.tagName==='FIELDSET');
    expect(groups.map(group=>group.querySelector('legend > span')?.textContent ?? group.querySelector('legend')?.textContent ?? group.getAttribute('aria-label'))).toEqual(['账号定位设置','创作规则']);
    expect(screen.queryByText('dao-studio')).toBeNull();
    expect(screen.queryByRole('table',{name:'生产能力配置矩阵'})).toBeNull();
    expect(screen.queryByRole('button',{name:'修改分镜规划配置'})).toBeNull();
    for(const name of ['启用图片生成','启用A-roll','启用B-roll','启用旁白','启用配乐 / 音效'])expect(screen.queryByRole('checkbox',{name})).toBeNull();
  });

  it("系列名称与规则共用保存入口，重命名回读不会清空规则草稿", async () => {
    const user=userEvent.setup(),onCreateSeriesVersion=vi.fn().mockResolvedValue(undefined);
    function ReadbackSeries() {
      const [name,setName]=useState(series.name);
      return <AccountWorkspace account={account} blueprints={[blueprint]} isPending="" series={[{...series,name}]} seriesVersions={[...seriesVersions]} onRenameSeries={async(_id,next)=>{setName(next);return true;}} onCreateSeriesVersion={onCreateSeriesVersion}/>;
    }
    render(<ReadbackSeries/>);
    await user.click(screen.getByRole("tab", {name:"系列规则"}));
    expect(screen.getByLabelText("系列定位")).toHaveProperty("readOnly",true);
    await user.click(screen.getByRole("button",{name:"修改"}));
    await user.clear(screen.getByLabelText("系列显示名称"));await user.type(screen.getByLabelText("系列显示名称"),"新系列名称");
    await user.type(screen.getByLabelText("系列定位"),"保留草稿");
    await user.click(screen.getByRole("button",{name:"保存系列设置"}));await user.click(screen.getByRole("button",{name:"确认保存为 v3"}));
    expect(onCreateSeriesVersion).toHaveBeenCalledExactlyOnceWith({seriesId:series.id,rules:{positioning:"当前系列定位保留草稿"}});
    expect(screen.getByLabelText("系列显示名称")).toHaveProperty("value","新系列名称");
    expect(screen.getByLabelText("系列定位")).toHaveProperty("readOnly",true);
    expect(screen.queryByRole("button",{name:"保存系列名称"})).toBeNull();
  });

  it("系列超过八个时显示搜索，缩减为少量系列后清除隐藏筛选", async () => {
    const user=userEvent.setup();
    const many=Array.from({length:9},(_,index)=>({...series,id:`series-${index}`,name:`系列${index}`}));
    const props={account,blueprints:[blueprint],isPending:""};
    const view=render(<AccountWorkspace {...props} series={many}/>);
    await user.click(screen.getByRole("tab", {name:"系列规则"}));
    await user.click(screen.getByRole("button", {name:"系列1"}));
    const search=screen.getByRole("searchbox",{name:"查找系列"});
    await user.type(search,"系列8");
    expect(screen.getByRole("button",{name:"系列8"})).toBeTruthy();
    expect(screen.queryByRole("button",{name:"系列0"})).toBeNull();
    view.rerender(<AccountWorkspace {...props} series={[many[0]]}/>);
    await waitFor(()=>expect(screen.queryByRole("searchbox",{name:"查找系列"})).toBeNull());
    expect(screen.getByRole("button",{name:"系列0"})).toBeTruthy();
  });

  it("系列页隐藏版本历史，但仍通过新版本保存", async () => {
    const user = userEvent.setup();
    const onCreateSeriesVersion = vi.fn().mockResolvedValue(undefined);
    renderWorkspace({ onCreateSeriesVersion, series: [series], seriesVersions });

    await user.click(screen.getByRole("tab", {name:"系列规则"}));
    await user.click(screen.getByRole("button", {name:"修改"}));
    expect(screen.getByRole("heading", { name: series.name })).toBeTruthy();
    expect(screen.queryByText(/当前 v/)).toBeNull();
    expect((screen.getByLabelText("系列定位") as HTMLTextAreaElement).value).toBe("当前系列定位");
    expect(screen.queryByRole("heading", { name: "版本历史" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "保存系列设置" }));
    const dialog = screen.getByRole("dialog", { name: "确认保存系列版本" });
    expect(within(dialog).getByText(/创建系列 v3/)).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "确认保存为 v3" }));
    expect(onCreateSeriesVersion).toHaveBeenCalledWith({ seriesId: series.id, rules: expect.objectContaining({ positioning: "当前系列定位" }) });
  });

  it("系列分组调整后仍保存全部字段，并在标题显示已应用状态", async () => {
    const user = userEvent.setup();
    const onCreateSeriesVersion = vi.fn().mockResolvedValue(undefined);
    renderWorkspace({onCreateSeriesVersion, series:[series], seriesVersions});
    await user.click(screen.getByRole("tab", {name:"系列规则"}));
    await user.click(screen.getByRole("button", {name:"修改"}));
    const footer = screen.getByRole("button", {name:"保存系列设置"}).closest("footer") as HTMLElement;
    for (const [label, value] of [["系列定位", "聚焦城市生活"], ["内容格式", "竖屏"], ["角色设定", "主持人"], ["地点设定", "街区"], ["视觉风格", "写实"], ["叙事结构", "开场到结尾"], ["限制与禁用内容", "不使用商标"]]) {
      await user.clear(screen.getByLabelText(label));
      await user.type(screen.getByLabelText(label), value);
    }
    expect(within(footer).getByRole("status").textContent).toBe("有未应用更改");
    await user.click(screen.getByRole("button", {name:"保存系列设置"}));
    await user.click(screen.getByRole("button", {name:"确认保存为 v3"}));
    expect(onCreateSeriesVersion).toHaveBeenCalledWith({seriesId:series.id,rules:expect.objectContaining({positioning:"聚焦城市生活",format:"竖屏",characters:"主持人",locations:"街区",visual_style:"写实",narrative_structure:"开场到结尾",restrictions:"不使用商标"})});
    expect(within(screen.getByRole("heading",{name:series.name}).parentElement!).getByRole("status").textContent).toBe("已应用 · v2");
    expect(within(footer).queryByRole("status")).toBeNull();
  });

  it("系列保存失败时错误在弹窗内可见，取消后可撤销草稿", async () => {
    const user = userEvent.setup();
    renderWorkspace({onCreateSeriesVersion:vi.fn().mockRejectedValue(new Error("系列保存失败，请重试。")),series:[series],seriesVersions});
    await user.click(screen.getByRole("tab", {name:"系列规则"}));
    await user.click(screen.getByRole("button", {name:"修改"}));
    await user.type(screen.getByLabelText("系列定位"), "保留草稿");
    await user.click(screen.getByRole("button", {name:"保存系列设置"}));
    const dialog = screen.getByRole("dialog", {name:"确认保存系列版本"});
    await user.click(within(dialog).getByRole("button", {name:"确认保存为 v3"}));
    expect(await within(dialog).findByRole("alert")).toHaveProperty("textContent","系列保存失败，请重试。");
    await user.click(within(dialog).getByRole("button", {name:"取消"}));
    expect(screen.getByLabelText("系列定位")).toHaveProperty("value","当前系列定位保留草稿");
    const confirm = vi.spyOn(window,"confirm").mockReturnValueOnce(true);
    await user.click(screen.getByRole("button", {name:"放弃修改"}));
    expect(confirm).toHaveBeenCalledWith("放弃当前系列的未保存修改？");
    confirm.mockRestore();
    expect(screen.getByLabelText("系列定位")).toHaveProperty("value","当前系列定位");
  });

  it("系列有未保存修改时也会拦截离开", async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderWorkspace({ series: [series], seriesVersions });
    await user.click(screen.getByRole("tab", {name:"系列规则"}));
    await user.click(screen.getByRole("button", {name:"修改"}));
    await user.type(screen.getByLabelText("系列定位"), "未保存");
    await user.click(screen.getByRole("tab", { name: "通用规则" }));
    expect(screen.getByRole("button", { name: series.name }).getAttribute("aria-current")).toBe("page");
    confirm.mockReturnValue(true);
    await user.click(screen.getByRole("tab", { name: "通用规则" }));
    expect(screen.getByRole("tab", { name: "通用规则" }).getAttribute("aria-selected")).toBe("true");
    confirm.mockRestore();
  });

  it("保留新建系列入口", async () => {
    const user = userEvent.setup();
    function RerenderingWorkspace() {
      const [, setDirty] = useState(false);
      return <AccountWorkspace account={account} blueprints={[blueprint]} isPending="" onDirtyChange={setDirty} series={[series]} seriesVersions={[...seriesVersions]} />;
    }
    render(<RerenderingWorkspace />);
    await user.click(screen.getByRole("tab", {name:"系列规则"}));
    await user.click(screen.getByRole("button", {name:"修改"}));
    await user.click(screen.getByRole("button", { name: "新建系列" }));
    expect(screen.getByRole("heading", { name: "新建系列" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "创建系列" })).toBeTruthy();
    expect(screen.queryByText("高级规则")).toBeNull();
    expect(screen.queryByText("补充规则")).toBeNull();
    await user.type(screen.getByRole("textbox", { name: "系列名称" }), "新系列");
    expect((screen.getByRole("textbox", { name: "系列名称" }) as HTMLInputElement).value).toBe("新系列");
  });

  it("支持重命名账号", async () => {
    const user = userEvent.setup();
    const onRenameAccount = vi.fn().mockResolvedValue(true);
    renderWorkspace({ onRenameAccount });
    await user.click(screen.getByRole("button", { name: "账号设置" }));
    await user.click(screen.getByRole("button", { name: "重命名" }));
    await user.clear(screen.getByRole("textbox", { name: "账号显示名称" }));
    await user.type(screen.getByRole("textbox", { name: "账号显示名称" }), "新名称");
    await user.click(screen.getByRole("button", { name: "保存名称" }));
    expect(onRenameAccount).toHaveBeenCalledWith(account.id, "新名称");
  });

  it("有生产单时阻止删除账号", async () => {
    const user = userEvent.setup();
    renderWorkspace({ accountEpisodeCount: 1 });
    await user.click(screen.getByRole("button", { name: "账号设置" }));
    await user.click(screen.getByRole("button", { name: "删除账号" }));
    expect(screen.getByText(/该账号有 1 个生产单，当前不能删除/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "确认删除账号" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("无生产单时要求输入账号名后才删除", async () => {
    const user = userEvent.setup();
    const onDeleteAccount = vi.fn().mockResolvedValue(true);
    renderWorkspace({ accountEpisodeCount: 0, onDeleteAccount });
    await user.click(screen.getByRole("button", { name: "账号设置" }));
    await user.click(screen.getByRole("button", { name: "删除账号" }));
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
