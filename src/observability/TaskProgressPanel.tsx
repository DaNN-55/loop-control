import { useMemo } from "react";
import type { Database, Json } from "../lib/database.types";

type Task = Database["public"]["Tables"]["tasks"]["Row"];
type TaskRun = Pick<Database["public"]["Tables"]["task_runs"]["Row"], "attempt" | "completed_at" | "id" | "started_at" | "status" | "task_id">;

const taskTypeLabels: Record<string, string> = {
  draft_brief: "脚本概要",
  draft_script: "脚本",
  prepare_visual_brief: "视觉素材准备",
  draft_storyboard: "分镜",
  generate_a_roll: "A-roll",
  generate_b_roll: "B-roll",
  generate_narration: "叙述音频",
  extract_embedded_audio: "嵌入音频",
  generate_soundtrack: "配乐 / 音效",
  generate_review_render: "审核渲染",
  generate_final_render: "最终渲染",
  prepare_publish_package: "发布包",
  verify_publish_package: "发布包校验",
  register_publish_input: "发布输入登记",
};

const taskStatusLabels: Record<Task["status"], string> = {
  ready: "排队",
  running: "执行中",
  completed: "已完成",
  blocked: "已阻塞",
  failed: "失败",
  superseded: "已由新配置替代",
};

const workerProgressSteps = [
  ["preflight", "运行检查"],
  ["input_validation", "验证输入"],
  ["provider_execution", "执行任务"],
  ["output_validation", "校验产物"],
] as const;

type WorkerProgressStep = typeof workerProgressSteps[number][0];

function taskProgress(task: Task): { detail: string; observedAt: string; step: WorkerProgressStep } | null {
  const result = task.last_result;
  if (!result || Array.isArray(result) || typeof result !== "object" || result.version !== "worker-progress/v1") return null;
  const progress = result.progress;
  if (!progress || Array.isArray(progress) || typeof progress !== "object") return null;
  if (!workerProgressSteps.some(([step]) => step === progress.step) || typeof progress.detail !== "string" || typeof progress.observedAt !== "string") return null;
  return { detail: progress.detail, observedAt: progress.observedAt, step: progress.step as WorkerProgressStep };
}

function formatDate(source: string): string {
  const date = new Date(source);
  return Number.isNaN(date.getTime()) ? "时间未记录" : new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(date);
}
function resultBlocker(task: Task): string | null {
  const result = task.last_result;
  if (!result || Array.isArray(result) || typeof result !== "object") return null;
  const blockers = result.blockers;
  if (!Array.isArray(blockers)) return null;
  const first = blockers.find((blocker): blocker is Record<string, Json | undefined> => Boolean(blocker && typeof blocker === "object" && !Array.isArray(blocker)));
  if (!first) return null;
  const code = typeof first.code === "string" ? first.code : "阻塞原因";
  const detail = typeof first.detail === "string" ? first.detail : "Worker 返回了阻塞结果。";
  return `${code}：${detail}`;
}

function latestRunFor(task: Task, taskRuns: TaskRun[]): TaskRun | null {
  return taskRuns
    .filter((run) => run.task_id === task.id)
    .sort((left, right) => right.started_at.localeCompare(left.started_at))[0] ?? null;
}

function effectiveConcurrency(task: Task): number | null {
  const snapshot = task.input_snapshot;
  if (!snapshot || Array.isArray(snapshot) || typeof snapshot !== "object") return null;
  const constraints = snapshot.runtime_constraints;
  if (!constraints || Array.isArray(constraints) || typeof constraints !== "object") return null;
  return typeof constraints.effective_concurrency === "number" ? constraints.effective_concurrency : null;
}

export function taskTypeLabel(taskType: string): string {
  return taskTypeLabels[taskType] ?? taskType;
}

export function taskStatusLabel(status: Task["status"]): string {
  return taskStatusLabels[status];
}

export function TaskTimelineDetail({ task, taskRuns }: { task: Task; taskRuns: TaskRun[] }) {
  const run = latestRunFor(task, taskRuns);
  const blocker = resultBlocker(task);
  const concurrency = effectiveConcurrency(task);
  const progress = taskProgress(task);
  const progressIndex = progress ? workerProgressSteps.findIndex(([step]) => step === progress.step) : -1;

  return <article className={`timeline-task-detail timeline-task-detail-${task.status}`}>
    <header><strong>{taskTypeLabel(task.task_type)} · {taskStatusLabels[task.status]}</strong><code>{task.id.slice(0, 8)}</code></header>
    <dl><div><dt>排队</dt><dd>{formatDate(task.created_at)}</dd></div>{task.claimed_at ? <div><dt>领取</dt><dd>{formatDate(task.claimed_at)}</dd></div> : null}{run ? <div><dt>运行</dt><dd>{formatDate(run.started_at)}</dd></div> : null}{task.completed_at ? <div><dt>完成</dt><dd>{formatDate(task.completed_at)}</dd></div> : null}<div><dt>尝试</dt><dd>{task.attempt} / {task.max_attempts}</dd></div>{concurrency !== null ? <div><dt>并发</dt><dd>{concurrency}</dd></div> : null}</dl>
    {progress && task.status === "running" ? <div aria-live="polite" className="worker-internal-progress"><strong>{progress.detail}</strong><ol aria-label="Worker 内部执行步骤">{workerProgressSteps.map(([step, label], index) => <li aria-current={index === progressIndex ? "step" : undefined} className={index < progressIndex ? "is-complete" : index === progressIndex ? "is-current" : "is-upcoming"} key={step}><span>{label}</span></li>)}</ol><small>最近更新：{formatDate(progress.observedAt)}</small></div> : null}
    {blocker ? <p className="worker-task-blocker">{blocker}</p> : null}
  </article>;
}

export function TaskProgressPanel({ dispatchRequested = false, embedded = false, taskRuns, tasks }: { dispatchRequested?: boolean; embedded?: boolean; taskRuns: TaskRun[]; tasks: Task[] }) {
  const groups = useMemo(() => {
    const grouped = new Map<string, Task[]>();
    for (const task of tasks) grouped.set(task.task_type, [...(grouped.get(task.task_type) ?? []), task]);
    return [...grouped.entries()].sort(([left], [right]) => left.localeCompare(right));
  }, [tasks]);

  return <section aria-label="Worker 任务进度" className={`${embedded ? "worker-task-progress-embedded" : "review-section"} worker-task-progress`}>
    <header className="worker-task-progress-heading"><div><h3>{embedded ? "任务执行记录" : "Worker 任务"}</h3><p className="muted-copy">只显示数据库中已记录的任务状态和完成数，不折算未经证实的百分比。</p></div><span>{tasks.length} 个任务</span></header>
    {groups.length ? <div className="worker-task-groups">{groups.map(([taskType, groupTasks]) => {
      const completed = groupTasks.filter((task) => task.status === "completed").length;
      return <section className="worker-task-group" key={taskType ?? "unknown-task-type"}><header><strong>{taskTypeLabel(taskType ?? "未知任务")}</strong><span>完成 {completed} / {groupTasks.length}</span></header><ul>{groupTasks.map((task) => {
        const run = latestRunFor(task, taskRuns);
        const blocker = resultBlocker(task);
        const concurrency = effectiveConcurrency(task);
        const progress = taskProgress(task);
        const progressIndex = progress ? workerProgressSteps.findIndex(([step]) => step === progress.step) : -1;
        return <li key={task.id}><div className="worker-task-row"><strong>{taskStatusLabels[task.status]}</strong><span>尝试 {task.attempt} / {task.max_attempts}</span><code>{task.id.slice(0, 8)}</code></div>{progress && task.status === "running" ? <div aria-live="polite" className="worker-internal-progress"><strong>{progress.detail}</strong><ol aria-label="Worker 内部执行步骤">{workerProgressSteps.map(([step, label], index) => <li aria-current={index === progressIndex ? "step" : undefined} className={index < progressIndex ? "is-complete" : index === progressIndex ? "is-current" : "is-upcoming"} key={step}><span>{label}</span></li>)}</ol><small>最近更新：{formatDate(progress.observedAt)}</small></div> : null}<dl><div><dt>排队</dt><dd>{formatDate(task.created_at)}</dd></div>{task.claimed_at ? <div><dt>领取</dt><dd>{formatDate(task.claimed_at)}</dd></div> : null}{run ? <div><dt>最近运行</dt><dd>{formatDate(run.started_at)}</dd></div> : null}{task.completed_at ? <div><dt>完成</dt><dd>{formatDate(task.completed_at)}</dd></div> : null}{concurrency !== null ? <div><dt>有效并发</dt><dd>{concurrency}（平台计算）</dd></div> : null}</dl>{blocker ? <p className="worker-task-blocker">{blocker}</p> : null}</li>;
      })}</ul></section>;
    })}</div> : <p aria-live="polite" className="muted-copy">{dispatchRequested ? "已提交即时派发，正在等待编排器创建任务记录。" : "当前生产单还没有 Worker 任务记录。"}</p>}
  </section>;
}
