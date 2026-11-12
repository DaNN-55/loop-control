import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { WorkerBlockerCard } from "./WorkerBlockerCard";

describe("WorkerBlockerCard", () => {
  it("将管理连接预检动作导航到全局连接管理", async () => {
    const user = userEvent.setup();
    const onOpenConnection = vi.fn();
    render(<WorkerBlockerCard blocker={{ action: "manage_connection", capability: "b_roll_generation", check: "credential_validity", code: "credential_validity", detail: "Pexels 拒绝认证。", scope: "connection", status: "unavailable" }} onOpenConnection={onOpenConnection} />);

    await user.click(screen.getByRole("button", { name: "打开外部连接管理" }));

    expect(onOpenConnection).toHaveBeenCalledTimes(1);
  });

  it("未传入回调时发出全局连接管理导航事件", async () => {
    const user = userEvent.setup();
    const onOpenConnections = vi.fn();
    window.addEventListener("open-external-connections", onOpenConnections);
    render(<WorkerBlockerCard blocker={{ action: "manage_connection", capability: "b_roll_generation", check: "credential_validity", code: "credential_validity", detail: "Pexels 拒绝认证。", scope: "connection", status: "unavailable" }} />);

    await user.click(screen.getByRole("button", { name: "打开外部连接管理" }));

    expect(onOpenConnections).toHaveBeenCalledTimes(1);
    window.removeEventListener("open-external-connections", onOpenConnections);
  });
});

it('keeps the original legacy error readable without a task repair action',async()=>{
 const user=userEvent.setup(),onOpenBlueprint=vi.fn(),blocker={action:'edit_blueprint' as const,capability:'narration_generation',code:'narration_executor_invalid',detail:'原任务保留的诊断原因',taskId:'legacy-task'};
 render(<WorkerBlockerCard blocker={blocker} onOpenBlueprint={onOpenBlueprint}/>);
 expect(screen.queryByRole('button',{name:'修复旧任务配置'})).toBeNull();expect(onOpenBlueprint).not.toHaveBeenCalled();expect(screen.getByText('生产单 → 分镜台')).toBeTruthy();
 await user.click(screen.getByText('技术详情').closest('summary')!);expect(screen.getByText(blocker.detail).closest('details')?.open).toBe(true);
});
it('does not show an unusable blueprint button for a retired generic planning configuration',()=>{
 render(<WorkerBlockerCard blocker={{action:'edit_blueprint',capability:'storyboard_planning',code:'blueprint_configuration',detail:'旧规划配置'}} onOpenBlueprint={vi.fn()}/>);
 expect(screen.queryByRole('button',{name:/蓝图|修复旧任务配置/})).toBeNull();expect(screen.getByText('生产单 → 分镜台')).toBeTruthy();
});
