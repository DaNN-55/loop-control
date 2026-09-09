import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Database } from "../lib/database.types";
import { SystemStatusPanel, type LocalSystemStatusReport } from "./SystemStatusPanel";

type Task = Database["public"]["Tables"]["tasks"]["Row"];
type Episode = Database["public"]["Tables"]["episodes"]["Row"];

const report: LocalSystemStatusReport = {
  dependencies: [
    { detail: "迁移记录与本地文件一致。", name: "Supabase 迁移", state: "healthy" },
    { detail: "模型 gpt-5.6-codex 已通过 Worker 权限探测。", name: "Codex 模型 · gpt-5.6-codex", state: "healthy" },
    { detail: "codex-cli 0.153.4", name: "Codex CLI", state: "healthy" },
  ],
  mediaLibrary: { detail: "已挂载：/Volumes/Media", state: "healthy" },
  n8n: { detail: "已读取本地 n8n 事件日志；n8n 负责编排、通知和健康检查，不代替 Worker。", lastDispatchAt: null, lastEventAt: "2026-08-18T00:02:00.000Z", lastHealthCheckAt: null, lastNotification: null, lastRunAt: null, lastScheduleCheckAt: "2026-08-18T00:02:00.000Z", lastWorkerDispatchAt: null, state: "healthy" },
  observedAt: "2026-08-18T00:03:00.000Z",
  supabase: { detail: "控制数据已成功读取。", state: "healthy" },
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
    expect(screen.getByText("最近调度检查")).toBeTruthy();
    expect(screen.getByText("最近 Worker 派发")).toBeTruthy();
    expect(screen.getByText("最近通知执行")).toBeTruthy();
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

  it("空调度检查不显示为 Worker 派发", async () => {
    const user = userEvent.setup();
    render(<SystemStatusPanel episodes={[currentEpisode]} report={{ ...report, n8n: { ...report.n8n, lastScheduleCheckAt: "2026-09-09T07:15:04.238Z", lastWorkerDispatchAt: null } }} tasks={[]} />);

    expect(screen.getByRole("button", { name: "系统状态：待确认" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "系统状态：待确认" }));
    expect(screen.getByText("最近调度检查").parentElement?.textContent).toContain("2026");
    expect(screen.getByText("最近 Worker 派发").parentElement?.textContent).toContain("暂无记录");
  });

  it("通知失败在 n8n 卡片和系统总览中均显示为需处理", async () => {
    const user = userEvent.setup();
    render(<SystemStatusPanel episodes={[currentEpisode]} report={{ ...report, n8n: { ...report.n8n, lastNotification: { at: "2026-09-09T07:00:06.063Z", state: "failure", workflowName: "Loop Control — 状态变更提醒" }, state: "healthy" } }} tasks={[]} />);

    expect(screen.getByRole("button", { name: "系统状态：需处理" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "系统状态：需处理" }));
    expect(screen.getByText("n8n 编排").closest("article")?.textContent).toContain("需处理");
    expect(screen.getByText("最近通知执行").parentElement?.textContent).toContain("通知失败");
    expect(screen.getByText("最近通知执行").parentElement?.textContent).toContain("Loop Control — 状态变更提醒");
  });

  it("迁移或控制数据缺少证据时保持待确认", async () => {
    const user = userEvent.setup();
    render(<SystemStatusPanel episodes={[currentEpisode]} report={{ ...report, dependencies: report.dependencies.filter((dependency) => dependency.name !== "Supabase 迁移"), supabase: undefined }} tasks={[]} />);

    expect(screen.getByRole("button", { name: "系统状态：待确认" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "系统状态：待确认" }));
    const supabaseCard = screen.getByText("Supabase").closest("article");
    expect(supabaseCard?.textContent).toContain("状态报告未提供 Supabase 控制数据读取证据。");
    expect(supabaseCard?.textContent).toContain("尚未读取 Supabase 迁移状态。");
  });

  it("把远程迁移连接错误转换成可操作的中文提示", async () => {
    const user = userEvent.setup();
    render(<SystemStatusPanel episodes={[currentEpisode]} report={{ ...report, dependencies: [
      ...report.dependencies.filter((dependency) => dependency.name !== "Supabase 迁移"),
      { detail: "无法确认 Supabase 迁移：Initialising login role... failed to connect to postgres: Connection terminated unexpectedly", name: "Supabase 迁移", state: "unknown" },
    ] }} tasks={[]} />);

    await user.click(screen.getByRole("button", { name: "系统状态：待确认" }));
    const supabaseCard = screen.getByText("Supabase").closest("article");
    expect(supabaseCard?.textContent).toContain("远程数据库连接失败，暂时无法确认本地迁移是否已同步。请稍后刷新重试。");
    expect(supabaseCard?.textContent).not.toContain("Initialising login role");
  });

  it("区分 Codex 模型权限正常、拒绝和后台探测", async () => {
    const user = userEvent.setup();
    render(<SystemStatusPanel episodes={[currentEpisode]} report={{ ...report, dependencies: [
      { detail: "codex-cli 0.153.4", name: "Codex CLI", state: "healthy" },
      { detail: "模型 gpt-5.6-codex 已通过 Worker 权限探测。", name: "Codex 模型 · gpt-5.6-codex", state: "healthy" },
      { detail: "模型 gpt-5.6-terra 无权访问：403 model access denied", name: "Codex 模型 · gpt-5.6-terra", state: "attention" },
      { detail: "模型 gpt-5.6-luna 权限正在后台探测。", name: "Codex 模型 · gpt-5.6-luna", state: "unknown" },
    ] }} tasks={[]} />);

    expect(screen.getByRole("button", { name: "系统状态：需处理" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "系统状态：需处理" }));
    const codexCard = screen.getByText(/依赖 · Codex CLI/).closest("article");
    expect(codexCard?.textContent).toContain("依赖 · Codex CLI · 0.153.4");
    expect(codexCard?.querySelector("p")).toBeNull();
    expect(codexCard?.textContent).toContain("gpt-5.6-codex正常");
    expect(codexCard?.textContent).toContain("gpt-5.6-terra需处理");
    expect(codexCard?.textContent).toContain("gpt-5.6-luna待确认");
    expect(screen.queryByText(/Codex 模型权限/)).toBeNull();
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

  it.each(["generate_review_render", "generate_final_render"])("后续成功的 %s 不让历史失败继续显示为需处理", async (taskType) => {
    const user = userEvent.setup();
    const operationInput = taskType === "generate_review_render"
      ? { review_render: { pre_render_review_package_id: "pre-render-1", project_revision: 1 } }
      : { final_render: { project_revision: 1, source_review_package_id: "qc-review-1" } };
    const replacementInput = taskType === "generate_review_render"
      ? { review_render: { pre_render_review_package_id: "pre-render-2", project_revision: 2 } }
      : { final_render: { project_revision: 2, source_review_package_id: "qc-review-2" } };
    const historicalFailure = { ...blockedTask, completed_at: "2026-08-18T00:01:00.000Z", id: `${taskType}-failed`, input_snapshot: operationInput, status: "failed", task_type: taskType } as Task;
    const replacementCompletion = { ...completedTask, completed_at: "2026-08-18T00:02:00.000Z", created_at: "2026-08-18T00:02:00.000Z", id: `${taskType}-completed`, input_snapshot: replacementInput, task_type: taskType } as Task;

    render(<SystemStatusPanel episodes={[currentEpisode]} report={report} tasks={[historicalFailure, replacementCompletion]} />);

    expect(screen.getByRole("button", { name: "系统状态：正常" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "系统状态：正常" }));
    expect(screen.getByText("0 执行中 · 0 阻塞 · 0 失败 · 最近任务已完成。")).toBeTruthy();
  });

  it("最新的失败任务仍显示为需处理", async () => {
    const user = userEvent.setup();
    const earlierCompletion = { ...completedTask, completed_at: "2026-08-18T00:01:00.000Z", id: "review-render-completed", task_type: "generate_review_render" } as Task;
    const latestFailure = { ...blockedTask, completed_at: "2026-08-18T00:02:00.000Z", id: "review-render-failed", status: "failed", task_type: "generate_review_render" } as Task;

    render(<SystemStatusPanel episodes={[currentEpisode]} report={report} tasks={[earlierCompletion, latestFailure]} />);

    expect(screen.getByRole("button", { name: "系统状态：需处理" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "系统状态：需处理" }));
    expect(screen.getByText("0 执行中 · 0 阻塞 · 1 失败。", { exact: true })).toBeTruthy();
  });

  it.each([
    ["镜头", { shot: { id: "shot-a" }, storyboard_review_package_id: "storyboard-1" }, { shot: { id: "shot-b" }, storyboard_review_package_id: "storyboard-1" }],
    ["音频 cue", { audio_track: { cue_id: "cue-a", source_review_package_id: "storyboard-1" } }, { audio_track: { cue_id: "cue-b", source_review_package_id: "storyboard-1" } }],
  ])("同一类型的独立%s任务不会被后续完成任务遮蔽", async (_label, failedInput, completedInput) => {
    const user = userEvent.setup();
    const failedTask = { ...blockedTask, completed_at: "2026-08-18T00:01:00.000Z", id: "failed-independent-operation", input_snapshot: failedInput, status: "failed" } as Task;
    const completedIndependentTask = { ...completedTask, completed_at: "2026-08-18T00:02:00.000Z", id: "completed-independent-operation", input_snapshot: completedInput } as Task;

    render(<SystemStatusPanel episodes={[currentEpisode]} report={report} tasks={[failedTask, completedIndependentTask]} />);

    expect(screen.getByRole("button", { name: "系统状态：需处理" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "系统状态：需处理" }));
    expect(screen.getByText("0 执行中 · 0 阻塞 · 1 失败 · 最近任务已完成。", { exact: true })).toBeTruthy();
  });

  it("无法确认同一操作时不让后续完成任务遮蔽失败", () => {
    const failedTask = { ...blockedTask, completed_at: "2026-08-18T00:01:00.000Z", id: "failed-unknown-operation", status: "failed" } as Task;
    const laterCompletedTask = { ...completedTask, completed_at: "2026-08-18T00:02:00.000Z", id: "completed-unknown-operation" } as Task;

    render(<SystemStatusPanel episodes={[currentEpisode]} report={report} tasks={[failedTask, laterCompletedTask]} />);

    expect(screen.getByRole("button", { name: "系统状态：需处理" })).toBeTruthy();
  });
});
