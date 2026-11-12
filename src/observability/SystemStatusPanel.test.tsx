import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Database } from "../lib/database.types";
import { SystemStatusPanel, type LocalSystemStatusReport } from "./SystemStatusPanel";

type Task = Database["public"]["Tables"]["tasks"]["Row"];
type Episode = Database["public"]["Tables"]["episodes"]["Row"];

const report: LocalSystemStatusReport = {
  dependencies: [
    { detail: "模型 gpt-5.6-codex 已通过 Worker 权限探测。", name: "Codex 模型 · gpt-5.6-codex", state: "healthy" },
    { detail: "codex-cli 0.153.4", name: "Codex CLI", state: "healthy" },
  ],
  mediaLibrary: { detail: "已挂载：/Volumes/Media", state: "healthy" },
  observedAt: "2026-08-18T00:03:00.000Z",
};

const currentEpisode = { archived_at: null, id: "episode-current" } as Episode;
const blockedTask = { attempt: 1, completed_at: null, claimed_at: null, created_at: "2026-08-18T00:00:00.000Z", episode_id: currentEpisode.id, id: "task-1", status: "blocked", task_type: "generate_b_roll" } as Task;
const completedTask = { ...blockedTask, completed_at: "2026-08-18T00:01:00.000Z", status: "completed" } as Task;

describe("系统状态面板", () => {
  it("悬停提供摘要，详情保留本机执行信息与焦点恢复", async () => {
    const user = userEvent.setup();
    render(<SystemStatusPanel episodes={[currentEpisode]} report={report} tasks={[blockedTask]} />);

    const trigger = screen.getByRole("button", { name: /系统状态/ });
    expect(trigger.textContent).toBe("");
    await user.hover(trigger);
    const hoverCard = screen.getByText("生产执行链").closest(".system-status-hover-card");
    expect(hoverCard?.querySelectorAll(".system-status-hover-row")).toHaveLength(3);
    expect(hoverCard?.textContent).toContain("生产执行链正常");
    await user.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "系统状态详情" });
    expect(dialog.getAttribute("aria-modal")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "关闭系统状态详情" }));
    expect(screen.getByText(/生产执行链展示服务是否可用；任务执行展示当前是否正在工作/)).toBeTruthy();
    const pipeline = screen.getByText("生产执行链").closest("article");
    expect(pipeline?.textContent).toContain("本机调度负责派发");
    expect(pipeline?.textContent).toContain("Worker 环境");
    const pipelineRows = pipeline?.querySelectorAll(".system-status-detail-rows > div");
    expect(pipelineRows).toHaveLength(1);
    expect(pipelineRows?.[0]?.textContent).toContain("Worker 环境");
    expect(screen.getByText("1 个阻塞任务需要处理。")).toBeTruthy();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "系统状态详情" })).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("没有本地报告时显示待确认，而不把未知状态说成正常", () => {
    render(<SystemStatusPanel episodes={[currentEpisode]} report={null} tasks={[]} />);

    expect(screen.getByRole("button", { name: "系统状态：待确认" })).toBeTruthy();
    expect(screen.getByRole("button", {name:/系统状态/}).getAttribute("data-status-summary")).toMatch(/生产执行链：待确认/);
  });
  it("不再呈现或要求旧规划运行依赖", () => {
    render(<SystemStatusPanel report={{...report,dependencies:[...report.dependencies,{name:"Codex 模型 · historical",state:"attention",detail:"旧记录"}]}} episodes={[]} tasks={[]}/>);
    expect(screen.queryByText(/依赖 · Codex CLI/)).toBeNull();
    expect(screen.queryByText(/historical/)).toBeNull();
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
      checks: [{ detail: "本机数据库检查通过。", name: "编排健康检查", passed: true }],
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
    expect(screen.getByText(/本机数据库检查通过/)).toBeTruthy();
  });

  it("不让已归档生产单的阻塞任务影响 Worker 状态", () => {
    const archivedEpisode = { archived_at: "2026-08-18T00:02:00.000Z", id: "episode-archived" } as Episode;
    const archivedBlockedTask = { ...blockedTask, episode_id: archivedEpisode.id };

    render(<SystemStatusPanel episodes={[currentEpisode, archivedEpisode]} report={report} tasks={[completedTask, archivedBlockedTask]} />);

    expect(screen.getByRole("button", { name: "系统状态：正常" })).toBeTruthy();
    expect(screen.getByRole("button", {name:/系统状态/}).getAttribute("data-status-summary")).toMatch(/生产执行链：正常/);
    expect(screen.getByRole("button", {name:/系统状态/}).getAttribute("data-status-summary")).toMatch(/任务执行：正常/);
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

 it("分别展示健康、备份与通知结果，并保留最近失败", async () => {
   const user=userEvent.setup();
   render(<SystemStatusPanel episodes={[]} report={{...report, operations: {
     health: { latest:{at:"2026-10-23T00:00:00Z",passed:true,detail:"独立日检通过"},lastSuccess:null,lastFailure:null },
     backup: { latest:{at:"2026-10-23T00:00:00Z",passed:false,detail:"备份快照失败"},lastSuccess:null,lastFailure:null },
     notification: { latest:{at:"2026-10-23T00:00:00Z",passed:true,detail:"无新事件"},lastSuccess:null,lastFailure:{at:"2026-10-22T00:00:00Z",passed:false,detail:"投递结果未知"} }
   }}} tasks={[]} />);
   await user.click(screen.getByRole("button",{name:/系统状态：/}));
   expect(screen.getByText("独立日检通过")).toBeTruthy();
   expect(screen.getByText("备份快照失败")).toBeTruthy();
   expect(screen.getByText(/投递结果未知/)).toBeTruthy();
 });

it("未执行的独立健康与备份记录仍显示待确认", async()=>{
 const user=userEvent.setup();render(<SystemStatusPanel episodes={[]} report={{...report,operations:{}}} tasks={[]}/>);
 await user.click(screen.getByRole("button",{name:/系统状态：/}));
 for(const name of ["每日健康检查","完整备份","部分快照","事件提醒","调度检查"])expect(screen.getByText(name).closest("article")?.textContent).toContain("待确认");
});
