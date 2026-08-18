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
  policy: { approval_gates: ["script", "qc"], asset_root: "/Volumes/dao/v3", positioning: "越南民间信仰" },
  version: 3,
};

const blueprintV2: Blueprint = {
  ...blueprintV3,
  id: "blueprint-2",
  is_active: false,
  policy: { approval_gates: ["script"], asset_root: "/Volumes/dao/v2", positioning: "旧定位" },
  version: 2,
};

function renderWorkspace(overrides: Partial<ComponentProps<typeof AccountWorkspace>> = {}) {
  return render(<AccountWorkspace account={account} accounts={[account]} blueprints={[blueprintV3, blueprintV2]} isPending="" onActivate={vi.fn()} onCreateBlueprint={vi.fn()} onSelectAccount={vi.fn()} {...overrides} />);
}

describe("账号页分区与蓝图版本", () => {
  it("直接进入蓝图版本，并只保留蓝图和系列两个分区", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    expect(screen.queryByRole("tab", { name: "账号概览" })).toBeNull();
    expect(screen.getByRole("tab", { name: "蓝图版本" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("heading", { name: "蓝图 v3" })).toBeTruthy();

    await user.click(screen.getByRole("tab", { name: "系列" }));
    expect(screen.getByRole("heading", { name: "系列" })).toBeTruthy();
  });

  it("选择版本后在右侧查看，并可直接激活待激活版本", async () => {
    const user = userEvent.setup();
    const onActivate = vi.fn().mockResolvedValue(undefined);

    renderWorkspace({ onActivate });
    await user.click(screen.getByRole("tab", { name: "蓝图版本" }));

    expect(screen.getByRole("heading", { name: "蓝图 v3" })).toBeTruthy();
    const latestCard = screen.getByRole("button", { name: /v3.*当前生效/ });
    expect(latestCard.textContent).not.toContain("越南民间信仰");
    expect(latestCard.textContent).not.toContain("/Volumes/dao/v3");
    expect(screen.queryByRole("menu")).toBeNull();
    await user.click(screen.getByRole("button", { name: /v2.*历史版本/ }));
    expect(screen.getByRole("heading", { name: "蓝图 v2" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "激活此版本" }));
    expect(onActivate).toHaveBeenCalledWith(blueprintV2.id);
  });

  it("基于所选版本保存新版本后可立即激活", async () => {
    const user = userEvent.setup();
    const createdBlueprint: Blueprint = { ...blueprintV3, id: "blueprint-4", is_active: false, version: 4 };
    const onActivate = vi.fn().mockResolvedValue(undefined);
    const onCreateBlueprint = vi.fn().mockResolvedValue(createdBlueprint);

    renderWorkspace({ onActivate, onCreateBlueprint });
    await user.click(screen.getByRole("tab", { name: "蓝图版本" }));

    await user.click(screen.getByRole("button", { name: /v2.*历史版本/ }));
    await user.click(screen.getByRole("button", { name: "以此版本编辑" }));
    await user.clear(screen.getByLabelText("资产目录"));
    await user.type(screen.getByLabelText("资产目录"), "/Volumes/dao/v4");
    await user.click(screen.getByRole("button", { name: "保存并激活" }));

    expect(onCreateBlueprint).toHaveBeenCalledWith(expect.objectContaining({ asset_root: "/Volumes/dao/v4" }));
    expect(onActivate).toHaveBeenCalledWith(createdBlueprint.id);
  });

  it("保留旧版当前生效状态", async () => {
    const user = userEvent.setup();
    const accountWithPendingLatest = { ...account, current_blueprint_version_id: blueprintV2.id };
    render(<AccountWorkspace account={accountWithPendingLatest} accounts={[accountWithPendingLatest]} blueprints={[{ ...blueprintV3, is_active: false }, { ...blueprintV2, is_active: true }]} isPending="" onActivate={vi.fn()} onCreateBlueprint={vi.fn()} onSelectAccount={vi.fn()} />);
    await user.click(screen.getByRole("tab", { name: "蓝图版本" }));

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

  it("提供蓝图停用和归档入口", async () => {
    const user = userEvent.setup();
    const onDeactivateBlueprint = vi.fn().mockResolvedValue(undefined);
    const onArchiveBlueprint = vi.fn().mockResolvedValue(undefined);
    renderWorkspace({ onArchiveBlueprint, onDeactivateBlueprint });
    await user.click(screen.getByRole("tab", { name: "蓝图版本" }));

    await user.click(screen.getByRole("button", { name: "停用当前版本" }));
    expect(screen.getByText("谨慎操作")).toBeTruthy();
    expect(onDeactivateBlueprint).toHaveBeenCalledWith(blueprintV3.id);

    await user.click(screen.getByRole("button", { name: /v2.*历史版本/ }));
    await user.click(screen.getByRole("button", { name: "归档此版本" }));
    expect(onArchiveBlueprint).toHaveBeenCalledWith(blueprintV2.id, true);
  });
});
