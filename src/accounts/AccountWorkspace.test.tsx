import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import type { Database } from "../lib/database.types";
import type { WorkerPreflightResult } from "../worker/contracts";
import { AccountWorkspace } from "../App";

vi.mock("../lib/supabase", () => ({ supabase: {} }));

type Account = Database["public"]["Tables"]["accounts"]["Row"];
type Blueprint = Database["public"]["Tables"]["account_blueprint_versions"]["Row"];
type Series = Database["public"]["Tables"]["series"]["Row"];
type SeriesVersion = Database["public"]["Tables"]["series_versions"]["Row"];

const account: Account = { created_at: "2026-08-14T00:00:00.000Z", current_blueprint_version_id: "blueprint-3", id: "account-1", name: "道工作室", slug: "dao-studio", timezone: "Asia/Shanghai" };
const blueprint: Blueprint = { account_id: account.id, archived_at: null, created_at: "2026-08-14T00:00:00.000Z", id: "blueprint-3", is_active: true, is_snapshot: false, policy: { approval_gates: ["script", "qc"], asset_root: "/Volumes/dao", positioning: "越南民间信仰" }, version: 3 };
const series: Series = { account_id: account.id, created_at: "2026-08-14T00:00:00.000Z", id: "series-1", name: "越南民间传说" };
const seriesVersions: SeriesVersion[] = [
  { account_id: account.id, created_at: "2026-08-15T00:00:00.000Z", created_by: "owner-1", id: "series-version-2", rules: { positioning: "当前系列定位" }, series_id: series.id, version: 2 },
  { account_id: account.id, created_at: "2026-08-14T00:00:00.000Z", created_by: "owner-1", id: "series-version-1", rules: { positioning: "旧定位" }, series_id: series.id, version: 1 },
];

function renderWorkspace(overrides: Partial<ComponentProps<typeof AccountWorkspace>> = {}) {
  return render(<AccountWorkspace account={account} accounts={[account]} blueprints={[blueprint]} isPending="" onActivate={vi.fn()} onSelectAccount={vi.fn()} {...overrides} />);
}

describe("账号配置工作区", () => {
  it("用当前配置工作区取代蓝图版本管理", () => {
    renderWorkspace({ blueprints: [blueprint, { ...blueprint, id: "old", is_active: false, version: 2 }], onUpdateBlueprint: vi.fn().mockResolvedValue(blueprint) });

    expect(screen.getByRole("heading", { name: "蓝图配置" })).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "蓝图配置分区" })).toBeTruthy();
    expect(screen.getByRole("complementary", { name: "生产就绪检查" })).toBeTruthy();
    expect(screen.queryByText("蓝图版本")).toBeNull();
    expect(screen.queryByRole("button", { name: /激活|归档|停用/ })).toBeNull();
  });

  it("直接编辑并保存当前蓝图", async () => {
    const user = userEvent.setup();
    const onUpdateBlueprint = vi.fn().mockResolvedValue(blueprint);
    renderWorkspace({ onUpdateBlueprint });

    await user.clear(screen.getByLabelText("账号定位"));
    await user.type(screen.getByLabelText("账号定位"), "新定位");
    await user.click(screen.getByRole("button", { name: "保存蓝图" }));

    expect(onUpdateBlueprint).toHaveBeenCalledWith(expect.objectContaining({ positioning: "新定位" }));
  });

  it("取消编辑会恢复当前保存值", async () => {
    const user = userEvent.setup();
    const onDirtyChange = vi.fn();
    renderWorkspace({ onDirtyChange });
    await user.clear(screen.getByLabelText("账号定位"));
    await user.type(screen.getByLabelText("账号定位"), "未保存定位");
    await user.click(screen.getByRole("button", { name: "取消编辑" }));
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

  it("左侧分区导航都有真实目标", () => {
    renderWorkspace();
    expect(document.querySelector("#account-rules")).toBeTruthy();
    expect(document.querySelector("#account-core")).toBeTruthy();
    expect(document.querySelector("#account-capabilities")).toBeTruthy();
    expect(document.querySelector("#account-budget")).toBeTruthy();
    expect(document.querySelector("#account-budget")?.hasAttribute("open")).toBe(true);
  });

  it("始终展示四项能力并禁用尚未接入的能力", () => {
    renderWorkspace();

    for (const name of ["启用A-roll", "启用B-roll", "启用旁白", "启用配乐 / 音效"]) expect(screen.getByRole("checkbox", { name })).toBeTruthy();
    expect((screen.getByRole("checkbox", { name: "启用A-roll" }) as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole("checkbox", { name: "启用配乐 / 音效" }) as HTMLInputElement).disabled).toBe(true);
    expect(screen.getAllByText("Worker 尚未接入")).toHaveLength(2);
  });

  it("打开可用能力后显示配置卡片", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await user.click(screen.getByRole("checkbox", { name: "启用B-roll" }));

    expect(screen.getByRole("heading", { name: "B-roll" })).toBeTruthy();
    expect(screen.getByText("已启用能力的技术配置（1）", { selector: "summary" }).parentElement?.hasAttribute("open")).toBe(true);
  });

  it("展示真实 Worker 就绪检查并允许重新检查", async () => {
    const user = userEvent.setup();
    const onRefreshBlueprintPreflight = vi.fn().mockResolvedValue(undefined);
    const preflight: WorkerPreflightResult = { version: "worker-preflight/v1", checks: [{ action: "contact_environment_admin", capability: "b_roll_generation", check: "credential_presence", phase: "preflight", reason: "缺少 PEXELS_API_KEY", scope: "worker", status: "unavailable" }] };
    renderWorkspace({ blueprintPreflight: preflight, onRefreshBlueprintPreflight });

    const rail = screen.getByRole("complementary", { name: "生产就绪检查" });
    expect(within(rail).getByText("1 项需要处理")).toBeTruthy();
    expect(within(rail).getByText("缺少外部连接凭据")).toBeTruthy();
    expect(within(rail).getByText("缺少 PEXELS_API_KEY")).toBeTruthy();
    await user.click(within(rail).getByRole("button", { name: "重新检查" }));
    expect(onRefreshBlueprintPreflight).toHaveBeenCalledOnce();
  });

  it("不在第一屏展示冗长的运行命令错误", () => {
    const reason = `模型权限探测失败：${"Command failed ".repeat(20)}`;
    const preflight: WorkerPreflightResult = { version: "worker-preflight/v1", checks: [{ action: "contact_environment_admin", capability: "script_writing", check: "model_permission", phase: "preflight", reason, scope: "worker", status: "unavailable" }] };
    renderWorkspace({ blueprintPreflight: preflight });

    expect(screen.getByText("运行环境检查未通过，请联系环境管理员。")).toBeTruthy();
    expect(screen.queryByText(reason)).toBeNull();
  });

  it("不在第一屏展示冗长的接口错误", () => {
    const error = `检查接口失败：${"server trace ".repeat(20)}`;
    renderWorkspace({ blueprintPreflightError: error });
    expect(screen.getByText("生产就绪检查暂时失败，请稍后重新检查。")).toBeTruthy();
    expect(screen.queryByText(error)).toBeNull();
  });

  it("系列页只展示当前配置并通过内部快照保存", async () => {
    const user = userEvent.setup();
    const onCreateSeriesVersion = vi.fn().mockResolvedValue(undefined);
    renderWorkspace({ onCreateSeriesVersion, series: [series], seriesVersions });

    await user.click(screen.getByRole("tab", { name: "系列" }));
    expect(screen.getByRole("heading", { name: series.name })).toBeTruthy();
    expect((screen.getByLabelText("系列定位") as HTMLTextAreaElement).value).toBe("当前系列定位");
    expect(screen.queryByText("历史版本")).toBeNull();
    await user.click(screen.getByRole("button", { name: "保存系列配置" }));
    expect(onCreateSeriesVersion).toHaveBeenCalledWith({ seriesId: series.id, rules: expect.objectContaining({ positioning: "当前系列定位" }) });
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
      return <AccountWorkspace account={account} accounts={[account]} blueprints={[blueprint]} isPending="" onActivate={vi.fn()} onDirtyChange={setDirty} onSelectAccount={vi.fn()} series={[series]} seriesVersions={[...seriesVersions]} />;
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
    await user.click(screen.getByRole("button", { name: "重命名账号" }));
    await user.clear(screen.getByRole("textbox", { name: "账号显示名称" }));
    await user.type(screen.getByRole("textbox", { name: "账号显示名称" }), "新名称");
    await user.click(screen.getByRole("button", { name: "保存名称" }));
    expect(onRenameAccount).toHaveBeenCalledWith(account.id, "新名称");
  });

  it("有生产单时阻止删除账号", async () => {
    const user = userEvent.setup();
    renderWorkspace({ accountEpisodeCount: 1 });
    await user.click(screen.getByRole("button", { name: "删除账号" }));
    expect(screen.getByText("该账号有 1 个生产单，当前不能删除。")).toBeTruthy();
    expect((screen.getByRole("button", { name: "确认删除账号" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("从生产单进入时只显示定向修复表单", () => {
    renderWorkspace({ blueprintRepairContext: { blocker: { code: "b_roll_executor_unavailable", detail: "B-roll 缺少适配器", taskType: "prepare_visual_brief" }, blueprintVersionId: blueprint.id, episodeId: "episode-1" } });
    expect(screen.getByRole("heading", { name: "修复当前生产单的 B-roll" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "保存并继续当前生产单" })).toBeTruthy();
    expect(screen.queryByRole("complementary", { name: "生产就绪检查" })).toBeNull();
  });
});
