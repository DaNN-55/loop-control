import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import type { Database, Json } from "../lib/database.types";
import type { LocalSystemStatusReport } from "../observability/SystemStatusPanel";
import type { WorkerPreflightResult } from "../worker/contracts";
import { AccountWorkspace } from "../App";

vi.mock("../lib/supabase", () => ({ supabase: {} }));

type Account = Database["public"]["Tables"]["accounts"]["Row"];
type Blueprint = Database["public"]["Tables"]["account_blueprint_versions"]["Row"];

const account: Account = {
  created_at: "2026-08-14T00:00:00.000Z",
  current_blueprint_version_id: "blueprint-3",
  id: "account-1",
  name: "道工作室",
  slug: "dao-studio",
  timezone: "Asia/Shanghai",
};

const blueprintV3: Blueprint = {
  account_id: account.id,
  archived_at: null,
  created_at: "2026-08-14T00:00:00.000Z",
  id: "blueprint-3",
  is_active: true,
  is_snapshot: false,
  policy: { approval_gates: ["script", "qc"], asset_root: "/Volumes/dao/v3", positioning: "越南民间信仰" },
  version: 3,
};

const blueprintV2: Blueprint = {
  ...blueprintV3,
  id: "blueprint-2",
  is_active: false,
  is_snapshot: false,
  policy: { approval_gates: ["script"], asset_root: "/Volumes/dao/v2", positioning: "旧定位" },
  version: 2,
};

const archivedBlueprintV1: Blueprint = {
  ...blueprintV2,
  archived_at: "2026-08-15T00:00:00.000Z",
  id: "blueprint-1",
  is_snapshot: false,
  version: 1,
};

const systemStatus: LocalSystemStatusReport = {
  dependencies: [{ detail: "codex 已注册", name: "Codex CLI", state: "healthy" }],
  mediaLibrary: { detail: "已挂载：/Volumes/Media", state: "healthy" },
  n8n: { detail: "最近健康检查正常", lastDispatchAt: null, lastEventAt: null, lastHealthCheckAt: "2026-08-21T09:00:00.000Z", lastRunAt: null, state: "healthy" },
  observedAt: "2026-08-21T09:01:00.000Z",
};

const blueprintPreflight: WorkerPreflightResult = {
  version: "worker-preflight/v1",
  checks: [
    { action: "none", capability: "b_roll_generation", check: "capability_registration", phase: "preflight", reason: "Pexels 已注册", scope: "worker", status: "passed" },
    { action: "contact_environment_admin", capability: "b_roll_generation", check: "credential_presence", phase: "preflight", reason: "缺少 PEXELS_API_KEY", scope: "worker", status: "unavailable" },
  ],
};

function renderWorkspace(overrides: Partial<ComponentProps<typeof AccountWorkspace>> = {}) {
  return render(<AccountWorkspace account={account} accountEpisodeCount={0} accounts={[account]} blueprints={[blueprintV3, blueprintV2]} isPending="" onActivate={vi.fn()} onCreateBlueprint={vi.fn()} onSelectAccount={vi.fn()} {...overrides} />);
}

describe("账号页分区与蓝图版本", () => {
  it("显示当前有效配置及 Episode 生效边界", () => {
    renderWorkspace();

    expect(screen.getByRole("heading", { name: "当前有效配置" })).toBeTruthy();
    expect(screen.getByText("仅影响之后新建的 Episode")).toBeTruthy();
    expect(screen.getByText("保留创建时的冻结配置")).toBeTruthy();
    expect(screen.getByText("暂未启用可选媒体能力")).toBeTruthy();
  });

  it("明确提示不可用媒体旧规则不参与新 Episode 编排", () => {
    renderWorkspace({ blueprints: [{ ...blueprintV3, policy: { approval_gates: ["script", "qc"], asset_root: "/Volumes/dao/v3", positioning: "越南民间信仰", a_roll: { executor: { provider: "codex" } }, soundtrack: { budget_cents: 99 } } }] });

    expect(screen.getByText("A-roll、配乐 / 音效旧规则已保留，但当前不参与新 Episode 编排。")).toBeTruthy();
  });

  it("在摘要和技术面板显示真实依赖报告", async () => {
    const user = userEvent.setup();
    renderWorkspace({ onUpdateBlueprint: vi.fn().mockResolvedValue(blueprintV3), systemStatus });

    expect(screen.getByText("媒体库 · 正常")).toBeTruthy();
    expect(screen.getByText("Codex CLI · 正常")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "编辑技术配置" }));

    const panel = screen.getByRole("complementary", { name: "技术配置侧边面板" });
    expect(within(panel).getByText("Codex CLI · 正常")).toBeTruthy();
    expect(within(panel).getByText("已挂载：/Volumes/Media")).toBeTruthy();
  });

  it("只展示已启用能力的外部连接状态并提供重新检查", async () => {
    const user = userEvent.setup();
    const onRefreshBlueprintPreflight = vi.fn().mockResolvedValue(undefined);
    const enabledBlueprint = { ...blueprintV3, policy: { ...(blueprintV3.policy as Record<string, Json>), b_roll: { executor: { provider: "pexels", adapter: "pexels_video" } } } };
    renderWorkspace({ blueprints: [enabledBlueprint, blueprintV2], blueprintPreflight, onRefreshBlueprintPreflight });

    const summary = screen.getByRole("region", { name: "外部连接状态" });
    expect(within(summary).getByText(/Pexels/)).toBeTruthy();
    expect(within(summary).getByText("Pexels · 凭据缺失")).toBeTruthy();
    expect(within(summary).getByText("缺少 PEXELS_API_KEY · 请联系环境管理员")).toBeTruthy();
    expect(within(summary).queryByText("Google TTS")).toBeNull();

    await user.click(within(summary).getByRole("button", { name: "重新检查连接" }));
    expect(onRefreshBlueprintPreflight).toHaveBeenCalledOnce();
  });

  it("从技术配置侧边面板编辑并保存当前蓝图", async () => {
    const user = userEvent.setup();
    const onUpdateBlueprint = vi.fn().mockResolvedValue(blueprintV3);
    renderWorkspace({ onUpdateBlueprint });

    await user.click(screen.getByRole("button", { name: "编辑技术配置" }));
    const panel = screen.getByRole("complementary", { name: "技术配置侧边面板" });
    expect(within(panel).getByText("最终写入与冻结预览")).toBeTruthy();
    expect(within(panel).queryByLabelText("账号定位")).toBeNull();

    await user.clear(within(panel).getByLabelText("资产目录"));
    await user.type(within(panel).getByLabelText("资产目录"), "/Volumes/dao/technical");
    await user.click(within(panel).getByRole("button", { name: "保存技术配置" }));

    expect(onUpdateBlueprint).toHaveBeenCalledWith(expect.objectContaining({ asset_root: "/Volumes/dao/technical" }));
    expect(screen.queryByRole("complementary", { name: "技术配置侧边面板" })).toBeNull();
  });

  it("支持通过遮罩关闭技术配置侧边面板", async () => {
    const user = userEvent.setup();
    renderWorkspace({ onUpdateBlueprint: vi.fn().mockResolvedValue(blueprintV3) });

    await user.click(screen.getByRole("button", { name: "编辑技术配置" }));
    await user.click(screen.getByTestId("blueprint-technical-scrim"));

    expect(screen.queryByRole("complementary", { name: "技术配置侧边面板" })).toBeNull();
  });

  it("保存蓝图时直接更新当前规则，不创建新的可见版本", async () => {
    const user = userEvent.setup();
    const onUpdateBlueprint = vi.fn().mockResolvedValue({ ...blueprintV3, policy: { approval_gates: ["script", "qc"], asset_root: "/Volumes/dao/v3", positioning: "新定位" } });
    renderWorkspace({ onUpdateBlueprint });

    await user.click(screen.getByRole("button", { name: /v3.*当前生效/ }));
    await user.click(screen.getByRole("button", { name: "以此版本编辑" }));
    await user.clear(screen.getByLabelText("账号定位"));
    await user.type(screen.getByLabelText("账号定位"), "新定位");
    await user.click(screen.getByRole("button", { name: "保存蓝图" }));

    expect(onUpdateBlueprint).toHaveBeenCalledWith(expect.objectContaining({ positioning: "新定位" }));
    expect(screen.queryByRole("button", { name: "保存蓝图" })).toBeNull();
  });

  it("只开放可用生产能力，并在启用后展开技术配置", async () => {
    const user = userEvent.setup();
    renderWorkspace({ onUpdateBlueprint: vi.fn().mockResolvedValue(blueprintV3) });

    await user.click(screen.getByRole("button", { name: /v3.*当前生效/ }));
    await user.click(screen.getByRole("button", { name: "以此版本编辑" }));

    expect((screen.getByRole("checkbox", { name: "启用B-roll" }) as HTMLInputElement).checked).toBe(false);
    expect((screen.getByRole("checkbox", { name: "启用旁白" }) as HTMLInputElement).checked).toBe(false);
    expect(screen.queryByRole("checkbox", { name: "启用A-roll" })).toBeNull();
    expect(screen.queryByRole("checkbox", { name: "启用配乐 / 音效" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "A-roll" })).toBeNull();
    expect(screen.queryByText(/network/)).toBeNull();
    expect((screen.getByRole("checkbox", { name: "脚本审核" }) as HTMLInputElement).disabled).toBe(false);

    await user.click(screen.getByRole("checkbox", { name: "启用B-roll" }));

    expect(screen.getByRole("heading", { name: "B-roll" })).toBeTruthy();
    expect((screen.getByDisplayValue("pexels") as HTMLInputElement).value).toBe("pexels");
    expect(screen.getByText("已启用能力的技术配置（1）", { selector: "summary" }).parentElement?.hasAttribute("open")).toBe(true);

    expect(screen.queryByRole("heading", { name: "A-roll" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "配乐 / 音效" })).toBeNull();
  });

  it("不把 Episode 规则快照显示成蓝图版本", () => {
    renderWorkspace({ blueprints: [blueprintV3, { ...blueprintV3, id: "episode-snapshot", is_snapshot: true }] });

    expect(screen.getAllByRole("button", { name: /v3.*当前生效/ })).toHaveLength(1);
  });

  it("直接进入蓝图版本，并只保留蓝图和系列两个分区", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    expect(screen.queryByRole("tab", { name: "账号概览" })).toBeNull();
    expect(screen.getByRole("tab", { name: "蓝图" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("heading", { name: "蓝图 v3" })).toBeTruthy();

    await user.click(screen.getByRole("tab", { name: "系列" }));
    expect(screen.getByRole("heading", { name: "系列" })).toBeTruthy();
  });

  it("选择版本后在右侧查看，并可直接激活待激活版本", async () => {
    const user = userEvent.setup();
    const onActivate = vi.fn().mockResolvedValue(undefined);

    renderWorkspace({ onActivate });
    await user.click(screen.getByRole("tab", { name: "蓝图" }));

    expect(screen.getByRole("heading", { name: "蓝图 v3" })).toBeTruthy();
    const latestCard = screen.getByRole("button", { name: /v3.*当前生效/ });
    expect(latestCard.textContent).not.toContain("越南民间信仰");
    expect(latestCard.textContent).not.toContain("/Volumes/dao/v3");
    expect(screen.queryByRole("menu")).toBeNull();
    await user.click(screen.getByRole("button", { name: /v2.*历史版本/ }));
    expect(screen.getByRole("heading", { name: "蓝图 v2" })).toBeTruthy();
    expect((screen.getByLabelText("账号定位") as HTMLTextAreaElement).value).toBe("旧定位");
    await user.click(screen.getByRole("button", { name: "激活此版本" }));
    expect(onActivate).toHaveBeenCalledWith(blueprintV2.id);
  });

  it("按结构化表单显示所选蓝图规则，不展示原始 JSON", () => {
    renderWorkspace();

    expect(screen.queryByText("查看原始规则")).toBeNull();
    expect(screen.getByText("本地资产与审批")).toBeTruthy();
    expect((screen.getByLabelText("账号定位") as HTMLTextAreaElement).value).toBe("越南民间信仰");
    expect((screen.getByLabelText("资产目录") as HTMLInputElement).value).toBe("/Volumes/dao/v3");
  });

  it("按键值字段显示未结构化的扩展规则", () => {
    renderWorkspace({ blueprints: [{ ...blueprintV3, policy: { ...(blueprintV3.policy as Record<string, unknown>), hard_constraints: { prohibited_topics: ["政治", "医疗"], publishing: "人工确认" } } }] });

    expect(screen.getByText("其他规则")).toBeTruthy();
    expect(screen.getByText("prohibited topics：政治、医疗；publishing：人工确认")).toBeTruthy();
    expect(screen.queryByText(/\"hard_constraints\"/)).toBeNull();
  });

  it("默认折叠已归档版本，展开后可选择历史蓝图", async () => {
    const user = userEvent.setup();
    renderWorkspace({ blueprints: [blueprintV3, blueprintV2, archivedBlueprintV1] });

    const archivedSummary = screen.getByText("已归档", { selector: "summary" });
    expect(archivedSummary.parentElement?.hasAttribute("open")).toBe(false);

    await user.click(archivedSummary);

    expect(archivedSummary.parentElement?.hasAttribute("open")).toBe(true);
    expect(screen.getByRole("button", { name: /v1.*已归档/ })).toBeTruthy();
  });

  it("基于所选版本保存后直接更新当前蓝图", async () => {
    const user = userEvent.setup();
    const onUpdateBlueprint = vi.fn().mockResolvedValue(blueprintV3);

    renderWorkspace({ onUpdateBlueprint });
    await user.click(screen.getByRole("tab", { name: "蓝图" }));

    await user.click(screen.getByRole("button", { name: /v2.*历史版本/ }));
    await user.click(screen.getByRole("button", { name: "以此版本编辑" }));
    await user.clear(screen.getByLabelText("资产目录"));
    await user.type(screen.getByLabelText("资产目录"), "/Volumes/dao/v4");
    await user.click(screen.getByRole("button", { name: "保存蓝图" }));

    expect(onUpdateBlueprint).toHaveBeenCalledWith(expect.objectContaining({ asset_root: "/Volumes/dao/v4" }));
  });

  it("保留旧版当前生效状态", async () => {
    const user = userEvent.setup();
    const accountWithPendingLatest = { ...account, current_blueprint_version_id: blueprintV2.id };
    render(<AccountWorkspace account={accountWithPendingLatest} accounts={[accountWithPendingLatest]} blueprints={[{ ...blueprintV3, is_active: false }, { ...blueprintV2, is_active: true }]} isPending="" onActivate={vi.fn()} onCreateBlueprint={vi.fn()} onSelectAccount={vi.fn()} />);
    await user.click(screen.getByRole("tab", { name: "蓝图" }));

    expect(screen.getByRole("button", { name: /v3.*待激活/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /v2.*当前生效/ })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "蓝图 v2" })).toBeTruthy();
    expect(screen.getAllByText("当前生效").length).toBe(1);
  });

  it("只通过账号显示名称入口重命名账号", async () => {
    const user = userEvent.setup();
    const onRenameAccount = vi.fn().mockResolvedValue(undefined);
    renderWorkspace({ onRenameAccount });

    await user.click(screen.getByRole("button", { name: "重命名账号" }));
    await user.clear(screen.getByRole("textbox", { name: "账号显示名称" }));
    await user.type(screen.getByRole("textbox", { name: "账号显示名称" }), "新显示名称");
    await user.click(screen.getByRole("button", { name: "保存名称" }));

    expect(onRenameAccount).toHaveBeenCalledWith(account.id, "新显示名称");
    expect(screen.queryByRole("form", { name: "重命名账号" })).toBeNull();
  });

  it("重命名失败时保留弹窗内容", async () => {
    const user = userEvent.setup();
    const onRenameAccount = vi.fn().mockResolvedValue(false);
    renderWorkspace({ onRenameAccount });

    await user.click(screen.getByRole("button", { name: "重命名账号" }));
    await user.clear(screen.getByRole("textbox", { name: "账号显示名称" }));
    await user.type(screen.getByRole("textbox", { name: "账号显示名称" }), "保存失败名称");
    await user.click(screen.getByRole("button", { name: "保存名称" }));

    expect(screen.getByRole("form", { name: "重命名账号" })).toBeTruthy();
    expect((screen.getByRole("textbox", { name: "账号显示名称" }) as HTMLInputElement).value).toBe("保存失败名称");
  });

  it("删除无生产单账号前要求输入账号名称", async () => {
    const user = userEvent.setup();
    const onDeleteAccount = vi.fn().mockResolvedValue(true);
    renderWorkspace({ onDeleteAccount });

    await user.click(screen.getByRole("button", { name: "删除账号" }));
    expect(screen.getByRole("form", { name: "删除账号" })).toBeTruthy();
    const submit = screen.getByRole("button", { name: "确认删除账号" }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    await user.type(screen.getByRole("textbox", { name: "删除账号确认文本" }), account.name);
    expect(submit.disabled).toBe(false);
    await user.click(submit);

    expect(onDeleteAccount).toHaveBeenCalledWith(account.id, account.name);
    expect(screen.queryByRole("form", { name: "删除账号" })).toBeNull();
  });

  it("有生产单的账号不能删除", async () => {
    const user = userEvent.setup();
    const onDeleteAccount = vi.fn();
    renderWorkspace({ accountEpisodeCount: 1, onDeleteAccount });

    await user.click(screen.getByRole("button", { name: "删除账号" }));

    expect(screen.getByText("该账号有 1 个生产单，当前不能删除。")).toBeTruthy();
    expect((screen.getByRole("button", { name: "确认删除账号" }) as HTMLButtonElement).disabled).toBe(true);
    expect(onDeleteAccount).not.toHaveBeenCalled();
  });

  it("提供蓝图停用和归档入口", async () => {
    const user = userEvent.setup();
    const onDeactivateBlueprint = vi.fn().mockResolvedValue(undefined);
    const onArchiveBlueprint = vi.fn().mockResolvedValue(undefined);
    renderWorkspace({ onArchiveBlueprint, onDeactivateBlueprint });
    await user.click(screen.getByRole("tab", { name: "蓝图" }));

    await user.click(screen.getByRole("button", { name: "停用当前版本" }));
    expect(screen.queryByText("谨慎操作")).toBeNull();
    expect(onDeactivateBlueprint).toHaveBeenCalledWith(blueprintV3.id);

    await user.click(screen.getByRole("button", { name: /v2.*历史版本/ }));
    await user.click(screen.getByRole("button", { name: "归档此版本" }));
    expect(onArchiveBlueprint).toHaveBeenCalledWith(blueprintV2.id, true);
  });
});
