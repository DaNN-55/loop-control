import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Database } from "../lib/database.types";
import { SystemStatusPanel, type LocalSystemStatusReport } from "./SystemStatusPanel";

type Task = Database["public"]["Tables"]["tasks"]["Row"];
type Episode = Database["public"]["Tables"]["episodes"]["Row"];

const report: LocalSystemStatusReport = {
  dependencies: [{ detail: "codex 1.0", name: "Codex CLI", state: "healthy" }],
  mediaLibrary: { detail: "已挂载：/Volumes/Media", state: "healthy" },
  n8n: { detail: "已读取本地 n8n 事件日志；n8n 负责编排、通知和健康检查，不代替 Worker。", lastDispatchAt: null, lastEventAt: "2026-08-18T00:02:00.000Z", lastHealthCheckAt: null, lastRunAt: null, state: "healthy" },
  observedAt: "2026-08-18T00:03:00.000Z",
};

const currentEpisode = { archived_at: null, id: "episode-current" } as Episode;
const blockedTask = { attempt: 1, completed_at: null, claimed_at: null, created_at: "2026-08-18T00:00:00.000Z", episode_id: currentEpisode.id, id: "task-1", status: "blocked", task_type: "generate_b_roll" } as Task;
const completedTask = { ...blockedTask, completed_at: "2026-08-18T00:01:00.000Z", status: "completed" } as Task;

describe("系统状态面板", () => {
  it("悬停提供摘要，点击显示 n8n 与 Worker 分工及最近状态", async () => {
    const user = userEvent.setup();
    render(<SystemStatusPanel episodes={[currentEpisode]} report={report} tasks={[blockedTask]} />);

    const trigger = screen.getByRole("button", { name: /系统状态/ });
    expect(trigger.textContent).toBe("");
    await user.hover(trigger);
    const hoverCard = screen.getByText("Supabase").closest(".system-status-hover-card");
    expect(hoverCard?.querySelectorAll(".system-status-hover-row")).toHaveLength(5);
    expect(hoverCard?.textContent).toContain("Supabase正常");
    await user.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "系统状态详情" });
    expect(dialog.getAttribute("aria-modal")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "关闭系统状态详情" }));
    expect(screen.getByText(/n8n 负责编排、通知和健康检查；Worker 负责实际执行/)).toBeTruthy();
    expect(screen.getByText("最近健康检查")).toBeTruthy();
    expect(screen.getByText("1 个阻塞任务需要处理。")).toBeTruthy();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "系统状态详情" })).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("没有本地报告时显示待确认，而不把未知状态说成正常", () => {
    render(<SystemStatusPanel episodes={[currentEpisode]} report={null} tasks={[]} />);

    expect(screen.getByRole("button", { name: "系统状态：待确认" })).toBeTruthy();
    expect(screen.getByTitle(/n8n 编排：待确认/)).toBeTruthy();
  });

  it("n8n 不可用时即使 Worker 最近已完成也必须降级系统状态", () => {
    render(<SystemStatusPanel episodes={[currentEpisode]} report={{ ...report, n8n: { ...report.n8n, detail: "n8n 健康端点无响应", lastEventAt: null, state: "offline" } }} tasks={[completedTask]} />);

    expect(screen.getByRole("button", { name: "系统状态：需处理" })).toBeTruthy();
    expect(screen.getByTitle(/Worker：正常/)).toBeTruthy();
    expect(screen.getByTitle(/n8n 编排：不可用/)).toBeTruthy();
  });

  it("支持手动刷新系统状态", async () => {
    const user = userEvent.setup();
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    render(<SystemStatusPanel episodes={[currentEpisode]} onRefresh={onRefresh} report={report} tasks={[]} />);
    await user.click(screen.getByRole("button", { name: /系统状态/ }));
    await user.click(screen.getByRole("button", { name: "刷新系统状态" }));
    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it("可从刷新按钮左侧运行黄金生产链测试并显示检查结果", async () => {
    const user = userEvent.setup();
    const onRunGoldenTest = vi.fn().mockResolvedValue({
      checks: [{ detail: "Supabase 可读并已完成快照。", name: "编排健康检查", passed: true }],
      observedAt: "2026-08-18T00:04:00.000Z",
      passed: true,
    });
    render(<SystemStatusPanel episodes={[currentEpisode]} onRunGoldenTest={onRunGoldenTest} report={report} tasks={[]} />);

    await user.click(screen.getByRole("button", { name: /系统状态/ }));
    const testButton = screen.getByRole("button", { name: "一键测试" });
    expect(testButton.compareDocumentPosition(screen.getByRole("button", { name: "刷新系统状态" })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await user.click(testButton);

    expect(onRunGoldenTest).toHaveBeenCalledOnce();
    expect(await screen.findByText("黄金生产链测试通过")).toBeTruthy();
    expect(screen.getByText(/Supabase 可读并已完成快照/)).toBeTruthy();
  });

  it("不让已归档生产单的阻塞任务影响 Worker 状态", () => {
    const archivedEpisode = { archived_at: "2026-08-18T00:02:00.000Z", id: "episode-archived" } as Episode;
    const archivedBlockedTask = { ...blockedTask, episode_id: archivedEpisode.id };

    render(<SystemStatusPanel episodes={[currentEpisode, archivedEpisode]} report={report} tasks={[completedTask, archivedBlockedTask]} />);

    expect(screen.getByRole("button", { name: "系统状态：正常" })).toBeTruthy();
    expect(screen.getByTitle(/Worker：正常/)).toBeTruthy();
  });
});
