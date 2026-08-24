import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Database } from "../lib/database.types";
import { SystemStatusPanel, type LocalSystemStatusReport } from "./SystemStatusPanel";

type Task = Database["public"]["Tables"]["tasks"]["Row"];

const report: LocalSystemStatusReport = {
  dependencies: [{ detail: "codex 1.0", name: "Codex CLI", state: "healthy" }],
  mediaLibrary: { detail: "已挂载：/Volumes/Media", state: "healthy" },
  n8n: { detail: "已读取本地 n8n 事件日志；n8n 负责编排、通知和健康检查，不代替 Worker。", lastDispatchAt: null, lastEventAt: "2026-08-18T00:02:00.000Z", lastHealthCheckAt: null, lastRunAt: null, state: "healthy" },
  observedAt: "2026-08-18T00:03:00.000Z",
};

const blockedTask = { attempt: 1, completed_at: null, claimed_at: null, created_at: "2026-08-18T00:00:00.000Z", id: "task-1", status: "blocked", task_type: "generate_b_roll" } as Task;
const completedTask = { ...blockedTask, completed_at: "2026-08-18T00:01:00.000Z", status: "completed" } as Task;

describe("系统状态面板", () => {
  it("悬停提供摘要，点击显示 n8n 与 Worker 分工及最近状态", async () => {
    const user = userEvent.setup();
    render(<SystemStatusPanel report={report} tasks={[blockedTask]} />);

    expect(screen.getByRole("button", { name: /系统状态/ }).textContent).toBe("");
    await user.hover(screen.getByRole("button", { name: /系统状态/ }));
    const hoverCard = screen.getByText("Supabase").closest(".system-status-hover-card");
    expect(hoverCard?.querySelectorAll(".system-status-hover-row")).toHaveLength(5);
    expect(hoverCard?.textContent).toContain("Supabase正常");
    await user.click(screen.getByRole("button", { name: /系统状态/ }));
    expect(screen.getByRole("dialog", { name: "系统状态详情" })).toBeTruthy();
    expect(screen.getByText(/n8n 负责编排、通知和健康检查；Worker 负责实际执行/)).toBeTruthy();
    expect(screen.getByText("最近健康检查")).toBeTruthy();
    expect(screen.getByText("1 个阻塞任务需要处理。")).toBeTruthy();
  });

  it("没有本地报告时显示待确认，而不把未知状态说成正常", () => {
    render(<SystemStatusPanel report={null} tasks={[]} />);

    expect(screen.getByRole("button", { name: "系统状态：待确认" })).toBeTruthy();
    expect(screen.getByTitle(/n8n 编排：待确认/)).toBeTruthy();
  });

  it("以 Worker 已完成任务作为实际生产状态，n8n 辅助状态不降级系统状态", () => {
    render(<SystemStatusPanel report={{ ...report, n8n: { ...report.n8n, detail: "n8n 健康检查待确认", lastEventAt: null, state: "attention" } }} tasks={[completedTask]} />);

    expect(screen.getByRole("button", { name: "系统状态：正常" })).toBeTruthy();
    expect(screen.getByTitle(/Worker：正常/)).toBeTruthy();
  });

  it("支持手动刷新系统状态", async () => {
    const user = userEvent.setup();
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    render(<SystemStatusPanel onRefresh={onRefresh} report={report} tasks={[]} />);
    await user.click(screen.getByRole("button", { name: /系统状态/ }));
    await user.click(screen.getByRole("button", { name: "刷新系统状态" }));
    expect(onRefresh).toHaveBeenCalledOnce();
  });
});
