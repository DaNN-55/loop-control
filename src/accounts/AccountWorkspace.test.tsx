import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import type { Database } from "../lib/database.types";
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

function renderWorkspace(overrides: Partial<ComponentProps<typeof AccountWorkspace>> = {}) {
  return render(<AccountWorkspace account={account} accountEpisodeCount={0} accounts={[account]} blueprints={[blueprintV3, blueprintV2]} isPending="" onActivate={vi.fn()} onCreateBlueprint={vi.fn()} onSelectAccount={vi.fn()} {...overrides} />);
}

describe("账号页分区与蓝图版本", () => {
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

  it("默认关闭媒体能力，只显示已启用的能力卡片并隐藏 network", async () => {
    const user = userEvent.setup();
    renderWorkspace({ onUpdateBlueprint: vi.fn().mockResolvedValue(blueprintV3) });

    await user.click(screen.getByRole("button", { name: /v3.*当前生效/ }));
    await user.click(screen.getByRole("button", { name: "以此版本编辑" }));

    expect((screen.getByRole("checkbox", { name: "启用B-roll" }) as HTMLInputElement).checked).toBe(false);
    expect((screen.getByRole("checkbox", { name: "启用旁白" }) as HTMLInputElement).checked).toBe(false);
    expect(screen.queryByRole("heading", { name: "A-roll" })).toBeNull();
    expect(screen.queryByText(/network/)).toBeNull();
    expect((screen.getByRole("checkbox", { name: "脚本审核" }) as HTMLInputElement).disabled).toBe(false);

    await user.click(screen.getByRole("checkbox", { name: "启用B-roll" }));

    expect(screen.getByRole("heading", { name: "B-roll" })).toBeTruthy();
    expect((screen.getByDisplayValue("pexels") as HTMLInputElement).value).toBe("pexels");
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
