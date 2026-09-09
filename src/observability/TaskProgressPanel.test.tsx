import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Database } from "../lib/database.types";
import { TaskProgressPanel } from "./TaskProgressPanel";

type Task = Database["public"]["Tables"]["tasks"]["Row"];
type TaskRun = Database["public"]["Tables"]["task_runs"]["Row"];

const baseTask: Task = {
  actual_cost_cents: null,
  attempt: 1,
  budget_limit_cents: 0,
  claimed_at: "2026-08-18T00:01:00.000Z",
  completed_at: null,
  created_at: "2026-08-18T00:00:00.000Z",
  episode_id: "episode-1",
  id: "task-running-1",
  input_snapshot: { runtime_constraints: { effective_concurrency: 3 } },
  last_result: null,
  max_attempts: 2,
  model: "model-a",
  prompt_version: "v1",
  provider: "codex",
  status: "running",
  task_type: "generate_b_roll",
};

const taskRun: TaskRun = {
  actual_cost_cents: 0,
  attempt: 1,
  completed_at: null,
  id: "run-1",
  result: null,
  started_at: "2026-08-18T00:02:00.000Z",
  status: "running",
  task_id: baseTask.id,
  task_package: {},
};

describe("Worker 任务进度", () => {
  it("显示真实状态、尝试次数、时间和按任务类型的 n/m 完成进度", () => {
    const completedTask: Task = { ...baseTask, id: "task-completed-1", status: "completed", completed_at: "2026-08-18T00:03:00.000Z", task_type: "generate_b_roll" };
    const blockedTask: Task = { ...baseTask, id: "task-blocked-1", status: "blocked", attempt: 2, max_attempts: 2, last_result: { blockers: [{ code: "NO_MEDIA", detail: "没有可用媒体" }] } };

    render(<TaskProgressPanel taskRuns={[taskRun]} tasks={[baseTask, completedTask, blockedTask]} />);

    expect(screen.getByRole("heading", { name: "Worker 任务" })).toBeTruthy();
    expect(screen.getByText("完成 1 / 3")).toBeTruthy();
    expect(screen.getByText("执行中")).toBeTruthy();
    expect(screen.getByText("已完成")).toBeTruthy();
    expect(screen.getByText("已阻塞")).toBeTruthy();
    expect(screen.getByText("尝试 2 / 2")).toBeTruthy();
    expect(screen.getByText("NO_MEDIA：没有可用媒体")).toBeTruthy();
    expect(screen.getByText("最近运行")).toBeTruthy();
    expect(screen.getAllByText("有效并发")).toHaveLength(3);
    expect(screen.getAllByText("3（平台计算）")).toHaveLength(3);
  });

  it("没有任务时明确显示无记录，而不是显示虚假进度", () => {
    render(<TaskProgressPanel taskRuns={[]} tasks={[]} />);

    expect(screen.getByText("当前生产单还没有 Worker 任务记录。")).toBeTruthy();
    expect(screen.queryByText(/完成 \d+ \/ \d+/)).toBeNull();
  });
});
