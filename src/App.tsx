import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { Activity, BarChart3, BookOpen, ClipboardList, Copy, FolderOpen, History, LogOut, MessageSquare, Moon, PanelLeft, Pencil, Play, RefreshCw, Sun, Table2, Trash2, Upload, User, Users, X, type LucideIcon } from "lucide-react";
import type { Session } from "@supabase/supabase-js";
import type { Database, Json } from "./lib/database.types";
import { supabase } from "./lib/supabase";
import { blueprintAssetRoot, defaultBlueprintPolicy } from "./platform/blueprintPolicy";
import type { EpisodeStage } from "./platform/types";
import { createPublicationConfirmation } from "./publishing/publicationConfirmation";
import { PublishModal } from "./publishing/PublishModal";
import type { PublicationRecordInput } from "./publishing/publicationRecord";
import { LearningWorkspace } from "./learning/LearningWorkspace";
import type { ApproveBlueprintChangeSuggestionInput, SaveBlueprintChangeSuggestionInput, SaveExperimentInput, SaveLearningReportInput, SaveMetricSnapshotInput } from "./learning/LearningWorkspace";
import { clearOperationDraft, readOperationDraft, writeOperationDraft } from "./operationDraft";
import { OperationsWorkspace } from "./operations/OperationsWorkspace";
import { blockersFromResult, currentReviewPackage, type WorkerBlocker, workerBlockers } from "./reviews/reviewSelectors";
import { workerBlockerGuidance } from "./reviews/blockerGuidance";
import { artifactPreviewKind, localArtifactUrl, useLocalArtifactBlob } from "./reviews/localArtifactPreview";
import { WorkerBlockerCard } from "./reviews/WorkerBlockerCard";
import type { StoryboardAudioCue, StoryboardShotManifest } from "./worker/contracts";
import { accountIdentityColor, accountIdentityInitials } from "./platform/accountIdentity";
import { HelpTip } from "./ui/HelpTip";
import { PaginationControls } from "./ui/PaginationControls";
import { BlueprintConfigurationForm, EpisodeConfigurationRepairForm, SeriesConfigurationForm } from "./platform/ConfigurationForms";
import { taskTypeLabel } from "./observability/TaskProgressPanel";
import { SystemStatusPanel, type LocalSystemStatusReport } from "./observability/SystemStatusPanel";
import { MarkdownPreview } from "./ui/MarkdownPreview";
import { defaultMaterialPurpose, materialPurposeOptions, materialTypeForFile, type MaterialPurpose, type MaterialType } from "./reviews/materialImport";

type NavigationItem = "accounts" | "episodes" | "operations" | "reviews" | "publish" | "learning";
type Theme = "light" | "dark";
type Account = Database["public"]["Tables"]["accounts"]["Row"];
type Blueprint = Database["public"]["Tables"]["account_blueprint_versions"]["Row"];
type Episode = Database["public"]["Tables"]["episodes"]["Row"];
type Series = Database["public"]["Tables"]["series"]["Row"];
type SeriesVersion = Database["public"]["Tables"]["series_versions"]["Row"];
type PromptVersion = Database["public"]["Tables"]["prompt_versions"]["Row"];
type MaterialRevision = Database["public"]["Tables"]["production_material_revisions"]["Row"];
type ReviewPackage = Database["public"]["Tables"]["review_packages"]["Row"];
type ReviewAnnotation = Database["public"]["Tables"]["review_annotations"]["Row"];
type Artifact = Database["public"]["Tables"]["artifacts"]["Row"];
type AudioTrack = Database["public"]["Tables"]["audio_tracks"]["Row"];
type AudioTrackAnnotation = Database["public"]["Tables"]["audio_track_annotations"]["Row"];
type PreRenderReviewMember = Database["public"]["Tables"]["pre_render_review_members"]["Row"];
type PreRenderReviewMemberDecision = Database["public"]["Tables"]["pre_render_review_member_decisions"]["Row"];
type Task = Database["public"]["Tables"]["tasks"]["Row"];
type TaskRun = Database["public"]["Tables"]["task_runs"]["Row"];
type Transition = Database["public"]["Tables"]["state_transitions"]["Row"];
type Experiment = Database["public"]["Tables"]["experiments"]["Row"];
type LearningReport = Database["public"]["Tables"]["learning_reports"]["Row"];
type MetricSnapshot = Database["public"]["Tables"]["metric_snapshots"]["Row"];
type BlueprintChangeSuggestion = Database["public"]["Tables"]["blueprint_change_suggestions"]["Row"];
type PublicationRecord = Database["public"]["Tables"]["publication_records"]["Row"];

interface BlueprintRepairContext {
  blocker: WorkerBlocker;
  blueprintVersionId: string;
  episodeId: string;
}

type EpisodeVisibility = "active" | "archived" | "all";
type EpisodeAction = "rename" | "archive" | "delete" | null;
type EpisodeWithArchive = Episode & { archived_at?: string | null };

interface ReviewAction {
  approveStage: EpisodeStage;
  requestChangesStage: EpisodeStage;
}

interface ReviewRenderRevisionRequest {
  reviewPackageId: string;
  captionStyle: "cinematic" | "minimal";
  pacing: "gentle" | "standard" | "compact";
  crop: "cover" | "contain";
  transition: "fade" | "cut";
  layout: "lower_third" | "center";
  reason: string;
}

type ReviewRenderAdjustmentDraft = Omit<ReviewRenderRevisionRequest, "reviewPackageId" | "reason">;
type ReviewDecisionDraft = Partial<ReviewRenderAdjustmentDraft> & { reason: string };

const defaultReviewRenderAdjustments: ReviewRenderAdjustmentDraft = {
  captionStyle: "cinematic",
  pacing: "standard",
  crop: "cover",
  transition: "fade",
  layout: "lower_third",
};

export const timezoneOptions = [
  ["Asia/Shanghai", "中国大陆 · 上海"],
  ["Asia/Ho_Chi_Minh", "越南 · 胡志明市"],
  ["Asia/Tokyo", "日本 · 东京"],
  ["Asia/Seoul", "韩国 · 首尔"],
  ["Asia/Singapore", "新加坡"],
  ["Asia/Kolkata", "印度 · 加尔各答"],
  ["Asia/Dubai", "阿联酋 · 迪拜"],
  ["Europe/London", "英国 · 伦敦"],
  ["Europe/Berlin", "德国 · 柏林"],
  ["Europe/Paris", "法国 · 巴黎"],
  ["America/New_York", "美国东部 · 纽约"],
  ["America/Chicago", "美国中部 · 芝加哥"],
  ["America/Denver", "美国山地 · 丹佛"],
  ["America/Los_Angeles", "美国西部 · 洛杉矶"],
  ["America/Toronto", "加拿大 · 多伦多"],
  ["Australia/Sydney", "澳大利亚 · 悉尼"],
  ["Pacific/Auckland", "新西兰 · 奥克兰"],
  ["UTC", "协调世界时 · UTC"],
] as const;

export function TimezoneSelect({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return <label>时区<select aria-label="时区" onChange={(event) => onChange(event.target.value)} value={value}>{timezoneOptions.map(([timezone, label]) => <option key={timezone} value={timezone}>{label}（{timezone}）</option>)}</select></label>;
}

interface ArollTaskEvidence {
  adapter: string;
  allowedTools: string[];
  inputHashes: string[];
  model: string;
  promptVersion: string;
  provider: string;
  shotId: string;
}

interface MaterialImportRequest {
  episodeId: string;
  sourceKind: "directory" | "file" | "paste";
  sourcePath: string;
  content?: Uint8Array;
  materialType: string;
  materialPurpose: MaterialPurpose;
  mimeType: string;
  isMainScript: boolean;
}

interface StoryboardAnnotationRequest {
  reviewPackageId: string;
  shotId: string;
  reason: string;
}

interface AudioTrackAnnotationRequest {
  audioTrackId: string;
  atSeconds: number;
  reason: string;
}

interface PreRenderMemberReviewRequest {
  reviewPackageId: string;
  memberKey: string;
  decision: "approved" | "changes_requested";
  reason: string;
}

interface Workspace {
  accounts: Account[];
  blueprints: Blueprint[];
  episodes: Episode[];
  series: Series[];
  seriesVersions: SeriesVersion[];
  promptVersions: PromptVersion[];
  materialRevisions: MaterialRevision[];
  reviewPackages: ReviewPackage[];
  reviewAnnotations: ReviewAnnotation[];
  artifacts: Artifact[];
  audioTracks: AudioTrack[];
  audioTrackAnnotations: AudioTrackAnnotation[];
  preRenderReviewMembers: PreRenderReviewMember[];
  preRenderReviewMemberDecisions: PreRenderReviewMemberDecision[];
  tasks: Task[];
  taskRuns: TaskRun[];
  transitions: Transition[];
  experiments: Experiment[];
  learningReports: LearningReport[];
  metricSnapshots: MetricSnapshot[];
  blueprintChangeSuggestions: BlueprintChangeSuggestion[];
  publicationRecords: PublicationRecord[];
}

export const navigation: Array<{ id: NavigationItem; label: string }> = [
  { id: "operations", label: "系列运营" },
  { id: "episodes", label: "生产单" },
  { id: "reviews", label: "审核" },
  { id: "publish", label: "发布队列" },
  { id: "learning", label: "复盘" },
  { id: "accounts", label: "账号" },
];

export function initialNavigationForWorkspace(workspace: Pick<Workspace, "accounts" | "episodes">): NavigationItem {
  return workspace.accounts.length && workspace.episodes.length ? "operations" : "accounts";
}

const themeStorageKey = "loop-control.theme.v1";
const sidebarStorageKey = "loop-control.sidebar.v1";

function storedTheme(): Theme {
  try {
    return localStorage.getItem(themeStorageKey) === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

function storedSidebarCollapsed(): boolean {
  try {
    return localStorage.getItem(sidebarStorageKey) === "collapsed";
  } catch {
    return false;
  }
}

export function navigationBadgeCounts(episodes: Episode[], artifacts: Artifact[], tasks: Task[]): Partial<Record<NavigationItem, number>> {
  const activeEpisodes = episodes.filter((episode) => !episodeIsArchived(episode));
  const reviewCount = activeEpisodes.filter((episode) => reviewActionFor(episode.stage) || episode.stage === "production_ready").length;
  const publishCount = activeEpisodes.filter((episode) => episode.stage === "publish_ready" || episode.stage === "publishing_review" || (episode.stage === "qc_passed" && artifacts.some((artifact) => artifact.episode_id === episode.id && artifact.artifact_type === "publish_package") && tasks.some((task) => task.episode_id === episode.id && task.task_type === "verify_publish_package" && task.status === "completed"))).length;
  return { reviews: reviewCount, publish: publishCount };
}

export function NavigationButtons({ activeNavigation, badges = {}, onSelect }: { activeNavigation: NavigationItem; badges?: Partial<Record<NavigationItem, number>>; onSelect: (item: NavigationItem) => void }) {
  return <>{navigation.map((item) => <button className={`navigation-item ${activeNavigation === item.id ? "is-active" : ""}`} key={item.id} onClick={() => onSelect(item.id)} type="button"><Icon name={item.id} /><span className="navigation-label">{item.label}</span>{badges[item.id] ? <span aria-label={`${badges[item.id]} 个待处理`} className="navigation-badge">{badges[item.id]}</span> : null}</button>)}</>;
}

function OwnerMenu({ onOpenSettings, onSignOut }: { onOpenSettings: () => void; onSignOut: () => void }) {
  const [isOpen, setIsOpen] = useState(false);
  return <div className="owner-menu"><button aria-expanded={isOpen} aria-haspopup="menu" aria-label="所有者设置" className="owner-menu-trigger" onClick={() => setIsOpen((current) => !current)} type="button"><Icon name="User" /></button>{isOpen ? <div className="owner-menu-popover" role="menu"><button onClick={() => { setIsOpen(false); onOpenSettings(); }} role="menuitem" type="button">所有者设置</button><button onClick={() => { setIsOpen(false); onSignOut(); }} role="menuitem" type="button">退出登录</button></div> : null}</div>;
}

const stageLabels: Record<EpisodeStage, string> = {
  waiting_input: "等待输入",
  brief_draft: "等待输入",
  script_draft: "脚本生成与审核",
  script_review: "脚本生成与审核",
  script_approved: "分镜前准备与审核",
  visual_draft: "分镜前准备与审核",
  visual_review: "分镜前准备与审核",
  visual_approved: "分镜前准备与审核",
  storyboard_draft: "分镜生成与审核",
  storyboard_review: "分镜生成与审核",
  storyboard_approved: "分镜生成与审核",
  production_ready: "媒体生产与预渲染审核",
  render_ready: "媒体生产与预渲染审核",
  qc_review: "合成与 QC 审核",
  qc_passed: "合成与 QC 审核",
  publish_ready: "发布准备",
  publishing_review: "发布准备",
  published: "已发布",
  metrics_collecting: "收集指标",
  learning_recorded: "已记录复盘",
};

const reviewActions: Partial<Record<EpisodeStage, ReviewAction>> = {
  script_review: { approveStage: "script_approved", requestChangesStage: "script_draft" },
  visual_review: { approveStage: "visual_approved", requestChangesStage: "visual_draft" },
  storyboard_review: { approveStage: "storyboard_approved", requestChangesStage: "storyboard_draft" },
  qc_review: { approveStage: "qc_passed", requestChangesStage: "render_ready" },
};

function stageTone(stage: EpisodeStage): "review" | "approved" | "muted" {
  if (stage.endsWith("approved") || stage === "qc_passed" || stage === "publish_ready" || stage === "published") {
    return "approved";
  }
  if (stage.includes("review")) return "review";
  return "muted";
}

const taskStatusLabels: Record<Task["status"], string> = { ready: "等待领取", running: "执行中", completed: "已完成", blocked: "已阻塞", failed: "失败", superseded: "已由新配置替代" };
const transitionReasonLabels: Record<string, string> = {
  "Owner confirmed an imported main script revision.": "Owner 已确认导入的主脚本修订。",
  "Owner confirmed all production materials are ready; start production.": "Owner 已确认材料准备完成，开始制作。",
  "Orchestrator froze the first visual planning task from the confirmed main script.": "编排器已根据确认的主脚本冻结首个视觉规划任务。",
  "Worker submitted a frozen visual planning review package.": "Worker 已提交冻结的视觉规划审核包。",
  "HyperFrames deterministic review render completed.": "HyperFrames 已完成确定性的审核渲染。",
};

const nextStepLabels: Partial<Record<EpisodeStage, string>> = {
  waiting_input: "导入主脚本",
  script_draft: "等待 Worker 生成脚本",
  script_review: "审核生成脚本",
  script_approved: "等待生成视觉方案",
  visual_draft: "等待 Worker 生成视觉方案",
  visual_review: "审核视觉方案",
  visual_approved: "等待生成分镜",
  storyboard_draft: "等待 Worker 生成分镜",
  storyboard_review: "审核分镜并处理镜头批注",
  storyboard_approved: "等待媒体任务生成",
  production_ready: "逐项审核预渲染成员",
  render_ready: "等待生成审核渲染",
  qc_review: "审核合成渲染与 QC 报告",
  qc_passed: "生成并验证发布包",
  publish_ready: "进入发布确认",
  publishing_review: "完成外部平台发布并确认",
  published: "开始收集指标",
  metrics_collecting: "定义实验并录入每周指标",
  learning_recorded: "查看复盘并评估蓝图建议",
};

function userFacingTransitionReason(reason: string): string {
  const trimmed = reason.trim();
  if (transitionReasonLabels[trimmed]) return transitionReasonLabels[trimmed];
  if (/owner/i.test(trimmed)) return "Owner 已提交该阶段决定。";
  if (/worker|orchestrator|hyperframes/i.test(trimmed)) return "后台执行结果已记录，生产单状态已更新。";
  return "已记录该阶段状态变化。";
}

function nextStepForEpisode(stage: EpisodeStage): string {
  return nextStepLabels[stage] ?? "查看生产单详情";
}

function groupWorkerBlockers(blockers: WorkerBlocker[]): Array<{ blocker: WorkerBlocker; count: number }> {
  const groups = new Map<string, { blocker: WorkerBlocker; count: number }>();
  for (const blocker of blockers) {
    const key = `${blocker.code}\u0000${blocker.detail}`;
    const group = groups.get(key);
    if (group) group.count += 1;
    else groups.set(key, { blocker, count: 1 });
  }
  return [...groups.values()];
}

type EpisodeWorkerStatusTone = "running" | "review" | "completed" | "waiting" | "blocked" | "idle";
interface EpisodeWorkerStatus {
  detail: string;
  label: string;
  tone: EpisodeWorkerStatusTone;
}

const reviewStages = new Set<EpisodeStage>(["script_review", "visual_review", "storyboard_review", "qc_review", "publishing_review"]);

export function episodeWorkerStatus(episode: Pick<Episode, "stage"> & Partial<Pick<Episode, "main_script_revision_id">>, episodeTasks: Pick<Task, "status" | "task_type">[]): EpisodeWorkerStatus {
  const blockedTask = episodeTasks.find((task) => task.status === "blocked");
  if (blockedTask) return { detail: `${taskTypeLabel(blockedTask.task_type)} 需要处理阻塞项。`, label: "已阻塞", tone: "blocked" };
  const failedTask = episodeTasks.find((task) => task.status === "failed");
  if (failedTask) return { detail: `${taskTypeLabel(failedTask.task_type)} 最近执行失败。`, label: "失败", tone: "blocked" };
  const runningTask = episodeTasks.find((task) => task.status === "running");
  if (runningTask) return { detail: `${taskTypeLabel(runningTask.task_type)} 正在执行。`, label: "执行中", tone: "running" };
  const readyTask = episodeTasks.find((task) => task.status === "ready");
  if (readyTask) return { detail: `${taskTypeLabel(readyTask.task_type)} 已排队，等待 Worker 领取。`, label: "等待 Worker", tone: "waiting" };
  if (reviewStages.has(episode.stage)) return { detail: "审核包已就绪，等待 Owner 决定。", label: "等待审核", tone: "review" };
  if (episodeTasks.some((task) => task.status === "completed")) return { detail: "最近一次 Worker 任务已完成。", label: "已完成", tone: "completed" };
  if (episode.stage === "waiting_input" && episode.main_script_revision_id) return { detail: "材料已导入，等待 Owner 确认开始制作。", label: "待开始制作", tone: "waiting" };
  if (episode.stage === "waiting_input" || episode.stage === "brief_draft") return { detail: nextStepForEpisode(episode.stage), label: "等待输入", tone: "idle" };
  return { detail: nextStepForEpisode(episode.stage), label: "等待 Worker", tone: "waiting" };
}

function formatDate(source: string) {
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(source));
}

function blueprintStatusLabel(blueprint: Blueprint, latestBlueprintId: string, activeBlueprintId: string | null): string {
  if (blueprint.archived_at) return "已归档";
  if (blueprint.id === activeBlueprintId) return "当前生效";
  if (blueprint.id === latestBlueprintId) return "待激活";
  return "历史版本";
}

function taskStatusSignature(task: Task): string {
  return `${task.status}:${task.attempt}:${task.completed_at ?? ""}:${task.claimed_at ?? ""}`;
}

function taskChangeNotice(previous: Workspace, next: Workspace, episodeId: string): string | null {
  if (!episodeId) return null;
  const previousTasks = new Map(previous.tasks.filter((task) => task.episode_id === episodeId).map((task) => [task.id, task]));
  const nextTasks = next.tasks.filter((task) => task.episode_id === episodeId);
  const changedTasks = nextTasks.filter((task) => taskStatusSignature(task) !== taskStatusSignature(previousTasks.get(task.id) ?? task));
  const newBlocked = changedTasks.some((task) => task.status === "blocked");
  if (newBlocked) return "Worker 任务已阻塞，请打开任务详情查看原因。";
  if (changedTasks.length === 0) return null;
  const changed = changedTasks.slice(0, 2).map((task) => `${task.task_type}：${taskStatusLabels[task.status]}`).join("、");
  return `Worker 任务状态已更新：${changed}${changedTasks.length > 2 ? "等" : ""}。`;
}

function episodeDeletionMessage(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "Episode、本地产物和数据库记录已删除。";
  const result = value as { local?: { existed?: unknown; path?: unknown; removed?: unknown }; database?: { counts?: unknown } };
  const localStatus = result.local?.existed === true && result.local?.removed === true ? "本地目录已清理" : "本地目录原本不存在";
  const localPath = typeof result.local?.path === "string" ? result.local.path : "";
  const counts = result.database?.counts;
  if (!counts || typeof counts !== "object" || Array.isArray(counts)) return `Episode 已删除；${localStatus}。`;
  const labels: Record<string, string> = { tasks: "任务", artifacts: "产物", review_packages: "审核包", production_material_revisions: "材料修订", audit_events: "审计事件", approvals: "审批", audio_tracks: "音轨", review_annotations: "审核批注" };
  const summary = Object.entries(counts as Record<string, unknown>).flatMap(([key, count]) => typeof count === "number" && labels[key] ? [`${labels[key]} ${count}`] : []).join("、");
  return `Episode 已删除；${localStatus}${localPath ? `（${localPath}）` : ""}${summary ? `；数据库清理：${summary}` : ""}。`;
}

interface EpisodeDeletionCleanupPending {
  accountId: string;
  blueprintVersionId: string;
  cleanupPending: true;
  episodeId: string;
  local?: { existed?: unknown; path?: unknown; removed?: unknown };
}

function isEpisodeDeletionCleanupPending(value: unknown): value is EpisodeDeletionCleanupPending {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return candidate.cleanupPending === true && typeof candidate.accountId === "string" && typeof candidate.blueprintVersionId === "string" && typeof candidate.episodeId === "string";
}

function episodeIsArchived(episode: Episode): boolean {
  return Boolean((episode as EpisodeWithArchive).archived_at);
}

function policyPositioning(policy: Json) {
  if (policy && typeof policy === "object" && !Array.isArray(policy) && "positioning" in policy) {
    return typeof policy.positioning === "string" && policy.positioning ? policy.positioning : "尚未填写定位";
  }
  return "尚未填写定位";
}

function policyAssetRoot(policy: Json) {
  return blueprintAssetRoot(policy) || "尚未配置";
}

function reviewActionFor(stage: EpisodeStage): ReviewAction | null {
  return reviewActions[stage] ?? null;
}

function reviewRenderAdjustmentsFromContext(value: Json): ReviewRenderAdjustmentDraft {
  if (!value || typeof value !== "object" || Array.isArray(value) || !("composition_adjustments" in value)) return defaultReviewRenderAdjustments;
  const adjustments = value.composition_adjustments;
  if (!adjustments || typeof adjustments !== "object" || Array.isArray(adjustments)) return defaultReviewRenderAdjustments;
  const { caption_style, pacing, crop, transition, layout } = adjustments;
  if ((caption_style !== "cinematic" && caption_style !== "minimal") || (pacing !== "gentle" && pacing !== "standard" && pacing !== "compact") || (crop !== "cover" && crop !== "contain") || (transition !== "fade" && transition !== "cut") || (layout !== "lower_third" && layout !== "center")) return defaultReviewRenderAdjustments;
  return { captionStyle: caption_style, pacing, crop, transition, layout };
}

function aRollTaskEvidence(task: Task): ArollTaskEvidence | null {
  const snapshot = task.input_snapshot;
  if (task.task_type !== "generate_a_roll" || !snapshot || Array.isArray(snapshot) || typeof snapshot !== "object") return null;
  const { allowed_tools: allowedTools, capability, executor, input_artifacts: inputArtifacts, shot } = snapshot;
  if (capability !== "a_roll_generation" || !executor || Array.isArray(executor) || typeof executor !== "object" || !shot || Array.isArray(shot) || typeof shot !== "object" || !Array.isArray(allowedTools) || !Array.isArray(inputArtifacts)) return null;
  if (typeof executor.provider !== "string" || typeof executor.model !== "string" || typeof executor.prompt_version !== "string" || typeof executor.adapter !== "string" || typeof shot.id !== "string" || allowedTools.some((tool) => typeof tool !== "string")) return null;
  const inputHashes = inputArtifacts.flatMap((artifact) => artifact && !Array.isArray(artifact) && typeof artifact === "object" && typeof artifact.sha256 === "string" ? [artifact.sha256] : []);
  if (inputHashes.length !== inputArtifacts.length) return null;
  return { adapter: executor.adapter, allowedTools: allowedTools as string[], inputHashes, model: executor.model, promptVersion: executor.prompt_version, provider: executor.provider, shotId: shot.id };
}

function LoadingIndicator({ compact = false, label }: { compact?: boolean; label: string }) {
  return <div className={`loading-indicator ${compact ? "loading-indicator-compact" : ""}`} role="status"><span aria-hidden="true" className="loading-spinner" /><span>{label}</span></div>;
}

function bytesToBase64(content: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < content.length; offset += 0x8000) {
    binary += String.fromCharCode(...content.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

async function loadWorkspace(): Promise<Workspace> {
  const [accountsResult, blueprintsResult, episodesResult, seriesResult, seriesVersionsResult, promptVersionsResult, materialRevisionsResult, reviewPackagesResult, reviewAnnotationsResult, artifactsResult, audioTracksResult, audioTrackAnnotationsResult, preRenderReviewMembersResult, preRenderReviewMemberDecisionsResult, tasksResult, taskRunsResult, transitionsResult, experimentsResult, learningReportsResult, metricSnapshotsResult, blueprintChangeSuggestionsResult, publicationRecordsResult] = await Promise.all([
    supabase.from("accounts").select("*").order("created_at"),
    supabase.from("account_blueprint_versions").select("*").order("version", { ascending: false }),
    supabase.from("episodes").select("*").order("updated_at", { ascending: false }),
    supabase.from("series").select("*").order("name"),
    supabase.from("series_versions").select("*").order("version", { ascending: false }),
    supabase.from("prompt_versions").select("*").order("capability").order("version", { ascending: false }),
    supabase.from("production_material_revisions").select("*").order("created_at", { ascending: false }),
    supabase.from("review_packages").select("*").order("created_at", { ascending: false }),
    supabase.from("review_annotations").select("*").order("created_at"),
    supabase.from("artifacts").select("*").order("created_at", { ascending: false }),
    supabase.from("audio_tracks").select("*").order("created_at", { ascending: false }),
    supabase.from("audio_track_annotations").select("*").order("created_at"),
    supabase.from("pre_render_review_members").select("*").order("created_at"),
    supabase.from("pre_render_review_member_decisions").select("*").order("created_at"),
    supabase.from("tasks").select("*").order("created_at", { ascending: false }),
    supabase.from("task_runs").select("*").order("started_at", { ascending: false }),
    supabase.from("state_transitions").select("*").order("created_at", { ascending: false }),
    supabase.from("experiments").select("*").order("created_at", { ascending: false }),
    supabase.from("learning_reports").select("*").order("created_at", { ascending: false }),
    supabase.from("metric_snapshots").select("*").order("captured_at", { ascending: false }),
    supabase.from("blueprint_change_suggestions").select("*").order("created_at", { ascending: false }),
    supabase.from("publication_records").select("*").order("created_at", { ascending: false }),
  ]);
  const error = [accountsResult, blueprintsResult, episodesResult, seriesResult, seriesVersionsResult, promptVersionsResult, materialRevisionsResult, reviewPackagesResult, reviewAnnotationsResult, artifactsResult, audioTracksResult, audioTrackAnnotationsResult, preRenderReviewMembersResult, preRenderReviewMemberDecisionsResult, tasksResult, taskRunsResult, transitionsResult, experimentsResult, learningReportsResult, metricSnapshotsResult, blueprintChangeSuggestionsResult, publicationRecordsResult]
    .map((result) => result.error)
    .find(Boolean);

  if (error) throw error;

  return {
    accounts: accountsResult.data ?? [],
    blueprints: blueprintsResult.data ?? [],
    episodes: episodesResult.data ?? [],
    series: seriesResult.data ?? [],
    seriesVersions: seriesVersionsResult.data ?? [],
    promptVersions: promptVersionsResult.data ?? [],
    materialRevisions: materialRevisionsResult.data ?? [],
    reviewPackages: reviewPackagesResult.data ?? [],
    reviewAnnotations: reviewAnnotationsResult.data ?? [],
    artifacts: artifactsResult.data ?? [],
    audioTracks: audioTracksResult.data ?? [],
    audioTrackAnnotations: audioTrackAnnotationsResult.data ?? [],
    preRenderReviewMembers: preRenderReviewMembersResult.data ?? [],
    preRenderReviewMemberDecisions: preRenderReviewMemberDecisionsResult.data ?? [],
    tasks: tasksResult.data ?? [],
    taskRuns: taskRunsResult.data ?? [],
    transitions: transitionsResult.data ?? [],
    experiments: experimentsResult.data ?? [],
    learningReports: learningReportsResult.data ?? [],
    metricSnapshots: metricSnapshotsResult.data ?? [],
    blueprintChangeSuggestions: blueprintChangeSuggestionsResult.data ?? [],
    publicationRecords: publicationRecordsResult.data ?? [],
  };
}

async function loadSystemStatusReport(): Promise<LocalSystemStatusReport | null> {
  const { data, error: sessionError } = await supabase.auth.getSession();
  if (sessionError || !data.session) return null;
  const response = await fetch("/_system-status", { headers: { Authorization: `Bearer ${data.session.access_token}` } });
  if (!response.ok) return null;
  const report: unknown = await response.json();
  if (!report || Array.isArray(report) || typeof report !== "object") return null;
  return report as LocalSystemStatusReport;
}

export function App() {
  const [activeNavigation, setActiveNavigation] = useState<NavigationItem>("episodes");
  const [theme, setTheme] = useState<Theme>(storedTheme);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(storedSidebarCollapsed);
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [selectedEpisodeId, setSelectedEpisodeId] = useState("");
  const [accountFilter, setAccountFilter] = useState("全部账号");
  const [seriesFilter, setSeriesFilter] = useState("全部系列");
  const [episodeVisibility, setEpisodeVisibility] = useState<EpisodeVisibility>("active");
  const [showAccountForm, setShowAccountForm] = useState(false);
  const [showEpisodeForm, setShowEpisodeForm] = useState(false);
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [isEpisodeDetailOpen, setIsEpisodeDetailOpen] = useState(false);
  const [isPublishModalOpen, setIsPublishModalOpen] = useState(false);
  const [blueprintRepairContext, setBlueprintRepairContext] = useState<BlueprintRepairContext | null>(null);
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [pendingAction, setPendingAction] = useState("");
  const [systemStatus, setSystemStatus] = useState<LocalSystemStatusReport | null>(null);
  const [isSystemStatusLoading, setIsSystemStatusLoading] = useState(false);
  const workspaceRef = useRef<Workspace | null>(null);
  const selectedEpisodeIdRef = useRef(selectedEpisodeId);
  const hasInitializedNavigationRef = useRef(false);

  useEffect(() => {
    selectedEpisodeIdRef.current = selectedEpisodeId;
  }, [selectedEpisodeId]);

  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => setMessage(""), 4500);
    return () => window.clearTimeout(timer);
  }, [message]);

  useEffect(() => {
    if (!errorMessage) return;
    const timer = window.setTimeout(() => setErrorMessage(""), 8000);
    return () => window.clearTimeout(timer);
  }, [errorMessage]);

  const refreshWorkspace = useCallback(async (source: "auto" | "manual" | "action" = "action") => {
    setIsLoading(true);
    setErrorMessage("");
    try {
      const nextWorkspace = await loadWorkspace();
      const previousWorkspace = workspaceRef.current;
      if (source === "auto" && previousWorkspace) {
        const notice = taskChangeNotice(previousWorkspace, nextWorkspace, selectedEpisodeIdRef.current);
        if (notice) setMessage(notice);
      }
      workspaceRef.current = nextWorkspace;
      setWorkspace(nextWorkspace);
      if (!hasInitializedNavigationRef.current) {
        setActiveNavigation(initialNavigationForWorkspace(nextWorkspace));
        hasInitializedNavigationRef.current = true;
      }
      setSelectedAccountId((current) => current && nextWorkspace.accounts.some((account) => account.id === current) ? current : nextWorkspace.accounts[0]?.id ?? "");
      setSelectedEpisodeId((current) => current && nextWorkspace.episodes.some((episode) => episode.id === current) ? current : nextWorkspace.episodes[0]?.id ?? "");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "无法读取控制数据。");
    } finally {
      setIsLoading(false);
    }
  }, []);

  const refreshEpisodeStatus = useCallback(async () => {
    setPendingAction("workspace-refresh");
    try {
      await refreshWorkspace("manual");
      setMessage("已刷新当前控制台状态。");
    } finally {
      setPendingAction("");
    }
  }, [refreshWorkspace]);

  const refreshSystemStatus = useCallback(async () => {
    setIsSystemStatusLoading(true);
    try {
      setSystemStatus(await loadSystemStatusReport());
    } finally {
      setIsSystemStatusLoading(false);
    }
  }, []);

  useEffect(() => {
    let isMounted = true;
    const initialize = async () => {
      const { data, error } = await supabase.auth.getSession();
      if (!isMounted) return;
      if (error) setErrorMessage(error.message);
      setSession(data.session);
      if (data.session) await refreshWorkspace();
      else setIsLoading(false);
    };
    void initialize();
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      if (nextSession) void refreshWorkspace();
      else {
        setWorkspace(null);
        hasInitializedNavigationRef.current = false;
        setIsLoading(false);
      }
    });
    return () => {
      isMounted = false;
      listener.subscription.unsubscribe();
    };
  }, [refreshWorkspace]);

  useEffect(() => {
    if (session) void refreshSystemStatus();
    else setSystemStatus(null);
  }, [refreshSystemStatus, session]);

  useEffect(() => {
    if (!isEpisodeDetailOpen || !selectedEpisodeId) return;
    const interval = window.setInterval(() => {
      void refreshWorkspace("auto");
      void refreshSystemStatus();
    }, 15000);
    return () => window.clearInterval(interval);
  }, [isEpisodeDetailOpen, refreshSystemStatus, refreshWorkspace, selectedEpisodeId]);

  const accountsById = useMemo(() => new Map(workspace?.accounts.map((account) => [account.id, account])), [workspace]);
  const blueprintsById = useMemo(() => new Map(workspace?.blueprints.map((blueprint) => [blueprint.id, blueprint])), [workspace]);
  const seriesById = useMemo(() => new Map(workspace?.series.map((series) => [series.id, series])), [workspace]);
  const seriesVersionsById = useMemo(() => new Map(workspace?.seriesVersions.map((version) => [version.id, version])), [workspace]);
  const selectedAccount = workspace?.accounts.find((account) => account.id === selectedAccountId) ?? null;
  const selectedEpisode = workspace?.episodes.find((episode) => episode.id === selectedEpisodeId) ?? null;
  const accountVisibleEpisodes = useMemo(
    () => (workspace?.episodes ?? []).filter((episode) => accountFilter === "全部账号" || episode.account_id === accountFilter),
    [accountFilter, workspace],
  );
  const visibleEpisodes = useMemo(
    () => accountVisibleEpisodes.filter((episode) => {
      if (episodeVisibility === "active" && episodeIsArchived(episode)) return false;
      if (episodeVisibility === "archived" && !episodeIsArchived(episode)) return false;
      if (seriesFilter === "全部系列") return true;
      return episode.series_version_id ? seriesVersionsById.get(episode.series_version_id)?.series_id === seriesFilter : false;
    }),
    [accountVisibleEpisodes, episodeVisibility, seriesFilter, seriesVersionsById],
  );
  const navigationBadges = useMemo(() => navigationBadgeCounts(workspace?.episodes ?? [], workspace?.artifacts ?? [], workspace?.tasks ?? []), [workspace]);

  function changeTheme() {
    setTheme((current) => {
      const nextTheme = current === "light" ? "dark" : "light";
      try { localStorage.setItem(themeStorageKey, nextTheme); } catch { /* 保留当前页面内的选择。 */ }
      return nextTheme;
    });
  }

  function changeSidebarCollapsed() {
    setSidebarCollapsed((current) => {
      const nextValue = !current;
      try { localStorage.setItem(sidebarStorageKey, nextValue ? "collapsed" : "expanded"); } catch { /* 保留当前页面内的选择。 */ }
      return nextValue;
    });
  }

  function changeNavigation(nextNavigation: NavigationItem) {
    setActiveNavigation(nextNavigation);
    if (nextNavigation !== "publish") setIsPublishModalOpen(false);
    if (nextNavigation === "accounts" || nextNavigation === "learning" || nextNavigation === "publish") {
      setIsEpisodeDetailOpen(false);
    }
  }

  function openEpisodeDetail(episodeId: string) {
    setSelectedEpisodeId(episodeId);
    setIsEpisodeDetailOpen(true);
  }

  function openAccountBlueprint(accountId: string, repairContext: BlueprintRepairContext | null = null) {
    setSelectedAccountId(accountId);
    setBlueprintRepairContext(repairContext);
    changeNavigation("accounts");
    setMessage(repairContext ? "已打开当前生产单的配置修复；保存后会直接继续生产，不会创建蓝图版本。" : "已打开对应账号的蓝图配置。");
  }

  function openPublishModal(episodeId: string) {
    setSelectedEpisodeId(episodeId);
    setIsEpisodeDetailOpen(false);
    setIsPublishModalOpen(true);
  }

  async function bootstrapPlatform(input: { name: string; slug: string; timezone: string; policy: Json }) {
    setPendingAction("bootstrap");
    setErrorMessage("");
    try {
      const { error } = await supabase.rpc("bootstrap_platform", {
        p_account_name: input.name,
        p_account_slug: input.slug,
        p_timezone: input.timezone,
        p_policy: input.policy,
      });
      if (error) throw error;
      setActiveNavigation("accounts");
      setMessage("首个账号和蓝图 v1 已初始化。");
      await refreshWorkspace();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "初始化失败。");
    } finally {
      setPendingAction("");
    }
  }

  async function updateBlueprint(policy: Json): Promise<Blueprint | null> {
    if (!selectedAccount) return null;
    setPendingAction("blueprint");
    setErrorMessage("");
    try {
      const { data, error } = await supabase.rpc("update_current_blueprint", { p_account_id: selectedAccount.id, p_policy: policy });
      if (error) throw error;
      setMessage("当前蓝图规则已更新；之后新建的生产单会使用最新规则。");
      await refreshWorkspace();
      return data;
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "创建蓝图版本失败。");
      return null;
    } finally {
      setPendingAction("");
    }
  }

  async function applyEpisodeConfigurationRepair(input: { context: BlueprintRepairContext; policy: Json }): Promise<boolean> {
    setPendingAction(`apply-episode-repair-${input.context.episodeId}`);
    setErrorMessage("");
    try {
      const { data, error } = await supabase.rpc("apply_episode_configuration_repair_v2", {
        p_blocker_code: input.context.blocker.code,
        p_blocker_detail: input.context.blocker.detail,
        p_episode_id: input.context.episodeId,
        p_policy: input.policy,
      });
      if (error) throw error;
      const result = data && typeof data === "object" && !Array.isArray(data) ? data as Record<string, unknown> : {};
      const recreatedCount = typeof result.recreated_task_count === "number" ? result.recreated_task_count : 0;
      await refreshWorkspace();
      setBlueprintRepairContext(null);
      setSelectedEpisodeId(input.context.episodeId);
      setIsEpisodeDetailOpen(true);
      setActiveNavigation("episodes");
      setMessage(`配置已直接应用到当前生产单，账号蓝图未变；已重新排队 ${recreatedCount} 个受阻任务。`);
      return true;
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "无法将蓝图配置应用到当前生产单。");
      return false;
    } finally {
      setPendingAction("");
    }
  }

  async function createSeries(input: { name: string; rules: Json }) {
    if (!selectedAccount) return;
    setPendingAction("series");
    setErrorMessage("");
    try {
      const { error } = await supabase.rpc("create_series", {
        p_account_id: selectedAccount.id,
        p_name: input.name,
        p_rules: input.rules,
      });
      if (error) throw error;
      setMessage("系列和 v1 规则已创建，可在新建生产单时关联。");
      await refreshWorkspace();
    } catch (error) {
      const message = error instanceof Error ? error.message : "创建系列失败。";
      setErrorMessage(message);
      throw new Error(message);
    } finally {
      setPendingAction("");
    }
  }

  async function createSeriesVersion(input: { seriesId: string; rules: Json }) {
    setPendingAction(`series-version-${input.seriesId}`);
    setErrorMessage("");
    try {
      const { error } = await supabase.rpc("create_series_version", { p_rules: input.rules, p_series_id: input.seriesId });
      if (error) throw error;
      setMessage("系列新版本已创建；新建生产单时可以固定这个系列基线。");
      await refreshWorkspace();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "创建系列版本失败。");
      throw error;
    } finally {
      setPendingAction("");
    }
  }

  async function createPromptVersion(input: { capability: PromptVersion["capability"]; name: string; summary: string; instructions: string }): Promise<PromptVersion | null> {
    if (!selectedAccount) return null;
    setPendingAction("prompt-version");
    setErrorMessage("");
    try {
      const { data, error } = await supabase.rpc("create_prompt_version", {
        p_account_id: selectedAccount.id,
        p_capability: input.capability,
        p_instructions: input.instructions,
        p_name: input.name,
        p_summary: input.summary,
      });
      if (error) throw error;
      setMessage("Prompt 新版本已登记；请保存蓝图后让新建生产单使用它。");
      await refreshWorkspace();
      return data;
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "登记 Prompt 版本失败。");
      return null;
    } finally {
      setPendingAction("");
    }
  }

  async function createAccount(input: { name: string; slug: string; timezone: string; policy: Json }) {
    setPendingAction("account");
    setErrorMessage("");
    try {
      const { data, error } = await supabase.rpc("create_account", {
        p_account_name: input.name,
        p_account_slug: input.slug,
        p_timezone: input.timezone,
        p_policy: input.policy,
      });
      if (error) throw error;
      setShowAccountForm(false);
      if (data) setSelectedAccountId(data.id);
      setActiveNavigation("accounts");
      setMessage("新账号和蓝图 v1 已创建；数据将与其他账号隔离。");
      await refreshWorkspace();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "创建账号失败。");
    } finally {
      setPendingAction("");
    }
  }

  async function renameAccount(accountId: string, name: string): Promise<boolean> {
    setPendingAction(`rename-account-${accountId}`);
    setErrorMessage("");
    try {
      const { error } = await supabase.rpc("rename_account", { p_account_id: accountId, p_account_name: name });
      if (error) throw error;
      setMessage("账号显示名称已更新；账号标识未改变。");
      await refreshWorkspace();
      return true;
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "重命名账号失败。");
      return false;
    } finally {
      setPendingAction("");
    }
  }

  async function deleteAccount(accountId: string, confirmation: string): Promise<boolean> {
    setPendingAction(`delete-account-${accountId}`);
    setErrorMessage("");
    try {
      const { error } = await supabase.rpc("delete_account", { p_account_id: accountId, p_confirmation: confirmation });
      if (error) throw error;
      setMessage("账号已删除。没有生产单的账号及其蓝图、系列配置已清理。");
      await refreshWorkspace();
      return true;
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "删除账号失败。只有没有生产单的账号可以删除。");
      return false;
    } finally {
      setPendingAction("");
    }
  }

  async function activateBlueprint(blueprintId: string) {
    if (!selectedAccount) return;
    setPendingAction(`activate-${blueprintId}`);
    setErrorMessage("");
    try {
      const { error } = await supabase.rpc("activate_blueprint_version", {
        p_account_id: selectedAccount.id,
        p_blueprint_version_id: blueprintId,
      });
      if (error) throw error;
      setMessage("蓝图已激活；它只影响之后新建的生产单。");
      await refreshWorkspace();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "激活蓝图失败。");
    } finally {
      setPendingAction("");
    }
  }

  async function deactivateBlueprint(blueprintId: string) {
    if (!selectedAccount) return;
    setPendingAction(`deactivate-${blueprintId}`);
    setErrorMessage("");
    try {
      const { error } = await supabase.rpc("deactivate_blueprint_version", {
        p_account_id: selectedAccount.id,
        p_blueprint_version_id: blueprintId,
      });
      if (error) throw error;
      setMessage("蓝图已停用；重新激活蓝图后才能创建新的生产单。");
      await refreshWorkspace();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "停用蓝图失败。");
    } finally {
      setPendingAction("");
    }
  }

  async function setBlueprintArchived(blueprintId: string, archived: boolean) {
    if (!selectedAccount) return;
    setPendingAction(`${archived ? "archive" : "unarchive"}-${blueprintId}`);
    setErrorMessage("");
    try {
      const { error } = await supabase.rpc("set_blueprint_archived", {
        p_account_id: selectedAccount.id,
        p_archived: archived,
        p_blueprint_version_id: blueprintId,
      });
      if (error) throw error;
      setMessage(archived ? "蓝图已归档，仍保留历史记录。" : "蓝图已取消归档，可重新激活。 ");
      await refreshWorkspace();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : archived ? "归档蓝图失败。" : "取消归档蓝图失败。");
    } finally {
      setPendingAction("");
    }
  }

  async function createEpisode(input: { title: string; accountId: string; isTest: boolean; seriesVersionId: string | null }) {
    const account = workspace?.accounts.find((candidate) => candidate.id === input.accountId);
    if (!account?.current_blueprint_version_id) return;
    setPendingAction("episode");
    setErrorMessage("");
    try {
      const { data, error } = await supabase.rpc("create_episode", {
        p_account_id: account.id,
        p_blueprint_version_id: account.current_blueprint_version_id,
        p_is_test: input.isTest,
        p_series_version_id: input.seriesVersionId,
        p_title: input.title,
      });
      if (error) throw error;
      setShowEpisodeForm(false);
      let localDirectoryReady = false;
      let localDirectoryError = "";
      if (data) {
        setSelectedEpisodeId(data.id);
        try {
          await requestLocalEpisodeDirectory(data.id, "create");
          localDirectoryReady = true;
        } catch (directoryError) {
          localDirectoryError = directoryError instanceof Error ? `生产单已创建，但本地输入目录准备失败：${directoryError.message}` : "生产单已创建，但本地输入目录准备失败。可稍后从详情页重试。";
        }
      }
      setMessage(localDirectoryReady ? "生产单已创建，本地输入目录已准备就绪，等待导入主脚本。" : "生产单已创建，等待导入主脚本；本地输入目录可稍后从详情页重试。");
      await refreshWorkspace();
      if (localDirectoryError) setErrorMessage(localDirectoryError);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "创建生产单失败。");
    } finally {
      setPendingAction("");
    }
  }

  async function updateEpisodeTitle(episodeId: string, title: string) {
    setPendingAction(`title-${episodeId}`);
    setErrorMessage("");
    try {
      const { error } = await supabase.rpc("update_episode_title", { p_episode_id: episodeId, p_title: title });
      if (error) throw error;
      setMessage("生产单标题已更新；已导入内容保持有效。");
      await refreshWorkspace();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "无法更新生产单标题。");
    } finally {
      setPendingAction("");
    }
  }

  async function setEpisodeArchived(episodeId: string, archived: boolean) {
    setPendingAction(`archive-${episodeId}`);
    setErrorMessage("");
    try {
      const { error } = await supabase.rpc("set_episode_archived", { p_archived: archived, p_episode_id: episodeId });
      if (error) throw error;
      setMessage(archived ? "生产单已归档；默认列表将隐藏它。" : "生产单已恢复到进行中列表。");
      await refreshWorkspace();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "无法更新生产单归档状态。");
    } finally {
      setPendingAction("");
    }
  }

async function deleteEpisode(episodeId: string, confirmation: string) {
    setPendingAction(`delete-${episodeId}`);
    setErrorMessage("");
    try {
      const { data, error } = await supabase.auth.getSession();
      if (error) throw error;
      if (!data.session) throw new Error("需要 Owner 登录会话。");
      const response = await fetch(`/_delete-episode?${new URLSearchParams({ episode: episodeId }).toString()}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${data.session.access_token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ confirmation }),
      });
      const responseText = await response.text();
      let deletionResult: unknown = null;
      try { deletionResult = responseText ? JSON.parse(responseText) : null; } catch { deletionResult = responseText; }
      if (!response.ok && isEpisodeDeletionCleanupPending(deletionResult)) {
        const cleanupResponse = await fetch("/_finalize-episode-deletion", {
          method: "POST",
          headers: { Authorization: `Bearer ${data.session.access_token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ accountId: deletionResult.accountId, blueprintVersionId: deletionResult.blueprintVersionId, episodeId }),
        });
        if (cleanupResponse.ok) {
          const cleanupResult: unknown = await cleanupResponse.json();
          if (deletionResult.local) deletionResult.local.removed = true;
          if (cleanupResult && typeof cleanupResult === "object" && !Array.isArray(cleanupResult) && "removed" in cleanupResult && cleanupResult.removed === false) throw new Error("数据库记录已删除，但本地删除暂存目录仍未清理。");
        } else {
          throw new Error(`数据库记录已删除，但本地删除暂存目录仍未清理：${(await cleanupResponse.text()).trim() || "请稍后重试本机清理"}`);
        }
      } else if (!response.ok) {
        throw new Error(typeof deletionResult === "string" && deletionResult.trim() ? deletionResult : "无法删除 Episode。");
      }
      setIsEpisodeDetailOpen(false);
      setSelectedEpisodeId("");
      setMessage(episodeDeletionMessage(deletionResult));
      await refreshWorkspace();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "无法删除 Episode。");
    } finally {
      setPendingAction("");
    }
  }

  async function importProductionMaterial(input: MaterialImportRequest) {
    setPendingAction(`material-${input.episodeId}`);
    setErrorMessage("");
    try {
      const { data, error } = await supabase.auth.getSession();
      if (error) throw error;
      if (!data.session) throw new Error("需要 Owner 登录会话。");
      const response = await fetch(`/_production-material?${new URLSearchParams({ episode: input.episodeId }).toString()}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${data.session.access_token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          contentBase64: input.content ? bytesToBase64(input.content) : undefined,
          isMainScript: input.isMainScript,
          materialType: input.materialType,
          materialPurpose: input.materialPurpose,
          mimeType: input.mimeType,
          sourceKind: input.sourceKind,
          sourcePath: input.sourcePath,
        }),
      });
      if (!response.ok) throw new Error((await response.text()).trim() || "无法导入生产材料。");
      setMessage(input.isMainScript ? "主脚本已确认为不可变修订；你可以继续导入材料，准备完成后再开始制作。" : "生产材料已导入为不可变修订。");
      await refreshWorkspace();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "无法导入生产材料。");
      throw error;
    } finally {
      setPendingAction("");
    }
  }

  async function startEpisodeProduction(episodeId: string) {
    setPendingAction(`start-production-${episodeId}`);
    setErrorMessage("");
    try {
      const { error } = await supabase.rpc("start_episode_production", { p_episode_id: episodeId });
      if (error) throw error;
      setMessage("材料准备已确认；Worker 将从下一轮开始制作。");
      await refreshWorkspace();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "无法开始生产单制作。");
    } finally {
      setPendingAction("");
    }
  }

  async function transitionEpisode(episodeId: string, toStage: EpisodeStage, reason: string): Promise<boolean> {
    setPendingAction(`transition-${episodeId}-${toStage}`);
    setErrorMessage("");
    try {
      const { error } = await supabase.rpc("transition_episode", {
        p_episode_id: episodeId,
        p_to_stage: toStage as Database["public"]["Enums"]["episode_stage"],
        p_reason: reason,
      });
      if (error) throw error;
      setMessage(toStage === "published" ? "已记录 Owner 的人工发布确认。" : toStage === "publish_ready" ? "发布包已进入人工发布确认。" : "已记录 Owner 的审核决定。" );
      await refreshWorkspace();
      return true;
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "无法写入发布状态。");
      return false;
    } finally {
      setPendingAction("");
    }
  }

  async function recordManualPublication(input: PublicationRecordInput): Promise<boolean> {
    setPendingAction(`publication-${input.episodeId}`);
    setErrorMessage("");
    try {
      const { error } = await supabase.rpc("record_manual_publication", {
        p_episode_id: input.episodeId,
        p_external_content_id: input.externalContentId || null,
        p_external_url: input.externalUrl || null,
        p_notes: input.notes,
        p_platform: input.platform,
        p_published_at: input.publishedAt,
        p_publishing_account: input.publishingAccount,
      });
      if (error) throw error;
      setMessage(`已记录 ${input.platform} 的人工发布，并保留发布历史。`);
      await refreshWorkspace();
      return true;
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "无法记录发布事实。");
      return false;
    } finally {
      setPendingAction("");
    }
  }

  async function requestReviewRenderRevision(input: ReviewRenderRevisionRequest): Promise<boolean> {
    setPendingAction(`review-render-revision-${input.reviewPackageId}`);
    setErrorMessage("");
    try {
      const { error } = await supabase.rpc("request_review_render_revision", {
        p_caption_style: input.captionStyle,
        p_crop: input.crop,
        p_layout: input.layout,
        p_pacing: input.pacing,
        p_reason: input.reason,
        p_review_package_id: input.reviewPackageId,
        p_transition: input.transition,
      });
      if (error) throw error;
      setMessage("合成调整已冻结；会复用已批准媒体和音轨生成新的审核渲染。");
      await refreshWorkspace();
      return true;
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : error && typeof error === "object" && "message" in error && typeof error.message === "string" ? error.message : "无法提交合成调整。");
      return false;
    } finally {
      setPendingAction("");
    }
  }

  async function createStoryboardAnnotation(input: StoryboardAnnotationRequest): Promise<void> {
    setPendingAction(`storyboard-annotation-${input.reviewPackageId}-${input.shotId}`);
    setErrorMessage("");
    try {
      const { error } = await supabase.rpc("create_storyboard_annotation", {
        p_reason: input.reason,
        p_review_package_id: input.reviewPackageId,
        p_shot_id: input.shotId,
      });
      if (error) throw error;
      setMessage("镜头批注已添加到当前冻结分镜修订。");
      await refreshWorkspace();
    } catch (error) {
      const message = error instanceof Error ? error.message : "无法添加镜头批注。";
      setErrorMessage(message);
      throw new Error(message);
    } finally {
      setPendingAction("");
    }
  }

  async function createAudioTrackAnnotation(input: AudioTrackAnnotationRequest): Promise<void> {
    setPendingAction(`audio-annotation-${input.audioTrackId}`);
    setErrorMessage("");
    try {
      const { error } = await supabase.rpc("create_audio_track_annotation", { p_audio_track_id: input.audioTrackId, p_at_seconds: input.atSeconds, p_reason: input.reason });
      if (error) throw error;
      await refreshWorkspace();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "无法保存音轨批注。");
    } finally {
      setPendingAction("");
    }
  }

  async function reviewPreRenderMember(input: PreRenderMemberReviewRequest): Promise<void> {
    setPendingAction(`pre-render-member-${input.reviewPackageId}-${input.memberKey}`);
    setErrorMessage("");
    try {
      const { error } = await supabase.rpc("review_pre_render_member", {
        p_decision: input.decision,
        p_member_key: input.memberKey,
        p_reason: input.reason,
        p_review_package_id: input.reviewPackageId,
      });
      if (error) throw error;
      setMessage(input.decision === "approved" ? "该预渲染成员已批准。" : "已创建该成员的新修订任务；其他已批准成员会沿用。" );
      await refreshWorkspace();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "无法提交预渲染成员审核决定。");
    } finally {
      setPendingAction("");
    }
  }

  async function requestLocalEpisodeDirectory(episodeId: string, action: "create" | "open") {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    if (!data.session) throw new Error("需要 Owner 登录会话。");
    const endpoint = action === "open" ? "/_open-local-episode-directory" : "/_local-episode-directory";
    const fallbackMessage = action === "open" ? "无法打开本地 Episode 目录。" : "无法创建本地 Episode 目录。";
    const response = await fetch(`${endpoint}?${new URLSearchParams({ episode: episodeId }).toString()}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${data.session.access_token}` },
    });
    if (!response.ok) throw new Error((await response.text()).trim() || fallbackMessage);
  }

  async function openLocalEpisodeDirectory(episodeId: string) {
    setPendingAction(`directory-open-${episodeId}`);
    setErrorMessage("");
    try {
      await requestLocalEpisodeDirectory(episodeId, "open");
      setMessage("已打开本地 Episode 输入目录。");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "无法打开本地 Episode 目录。");
    } finally {
      setPendingAction("");
    }
  }

  async function openLocalArtifact(artifact: Artifact): Promise<void> {
    setPendingAction(`artifact-open-${artifact.id}`);
    setErrorMessage("");
    try {
      const { data, error } = await supabase.auth.getSession();
      if (error) throw error;
      if (!data.session) throw new Error("需要 Owner 登录会话。");
      const response = await fetch(`/_open-local-artifact?${new URLSearchParams({ episode: artifact.episode_id, path: artifact.relative_path, sha256: artifact.sha256 }).toString()}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${data.session.access_token}` },
      });
      if (!response.ok) throw new Error((await response.text()).trim() || "无法打开本地产物。");
      setMessage(`已打开本地文件：${artifact.relative_path.split(/[\\/]/).pop() ?? artifact.relative_path}`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "无法打开本地产物。");
    } finally {
      setPendingAction("");
    }
  }

  async function saveExperiment(input: SaveExperimentInput) {
    setPendingAction(`experiment-${input.episodeId}`);
    setErrorMessage("");
    try {
      const { error } = await supabase.rpc("define_experiment", {
        p_episode_id: input.episodeId,
        p_guardrail_metrics: input.guardrailMetrics,
        p_hypothesis: input.hypothesis,
        p_primary_metric: input.primaryMetric,
        p_primary_variable: input.primaryVariable,
      });
      if (error) throw error;
      setMessage("实验定义已记录，可以按周录入指标。");
      await refreshWorkspace();
    } catch (error) {
      const message = error instanceof Error ? error.message : "无法保存实验定义。";
      setErrorMessage(message);
      throw new Error(message);
    } finally {
      setPendingAction("");
    }
  }

  async function prepareLearningDemo() {
    setPendingAction("learning-demo");
    setErrorMessage("");
    try {
      const { error } = await supabase.rpc("ensure_learning_demo_data");
      if (error) throw error;
      setAccountFilter("全部账号");
      setMessage("复盘演示数据已准备，可以在复盘页查看两条演示生产单。");
      await refreshWorkspace();
    } catch (error) {
      const message = error instanceof Error ? error.message : "无法准备复盘演示数据。";
      setErrorMessage(message);
    } finally {
      setPendingAction("");
    }
  }

  async function saveMetricSnapshot(input: SaveMetricSnapshotInput) {
    setPendingAction(`metrics-${input.episodeId}`);
    setErrorMessage("");
    try {
      const { error } = await supabase.rpc("record_weekly_metric_snapshot", {
        p_captured_at: input.capturedAt,
        p_episode_id: input.episodeId,
        p_metrics: input.metrics,
      });
      if (error) throw error;
      setMessage("本周指标已记录。再次保存同一周会更新该周数据。");
      await refreshWorkspace();
    } catch (error) {
      const message = error instanceof Error ? error.message : "无法保存本周指标。";
      setErrorMessage(message);
      throw new Error(message);
    } finally {
      setPendingAction("");
    }
  }

  async function saveLearningReport(input: SaveLearningReportInput) {
    setPendingAction(`learning-report-${input.episodeId}`);
    setErrorMessage("");
    try {
      const { error } = await supabase.rpc("record_learning_report", {
        p_episode_id: input.episodeId,
        p_recommendation: input.recommendation,
        p_summary: input.summary,
      });
      if (error) throw error;
      setMessage("复盘报告已记录，生产单的周指标已锁定。");
      await refreshWorkspace();
    } catch (error) {
      const message = error instanceof Error ? error.message : "无法记录复盘报告。";
      setErrorMessage(message);
      throw new Error(message);
    } finally {
      setPendingAction("");
    }
  }

  async function saveBlueprintChangeSuggestion(input: SaveBlueprintChangeSuggestionInput) {
    setPendingAction(`blueprint-suggestion-${input.learningReportId}`);
    setErrorMessage("");
    try {
      const { error } = await supabase.rpc("create_blueprint_change_suggestion", {
        p_learning_report_id: input.learningReportId,
        p_proposed_policy: input.proposedPolicy,
        p_rationale: input.rationale,
      });
      if (error) throw error;
      setMessage("蓝图变更建议已保存，等待 Owner 批准。");
      await refreshWorkspace();
    } catch (error) {
      const message = error instanceof Error ? error.message : "无法提交蓝图变更建议。";
      setErrorMessage(message);
      throw new Error(message);
    } finally {
      setPendingAction("");
    }
  }

  async function approveBlueprintChangeSuggestion(input: ApproveBlueprintChangeSuggestionInput) {
    setPendingAction(`blueprint-suggestion-approval-${input.suggestionId}`);
    setErrorMessage("");
    try {
      const { error } = await supabase.rpc("review_blueprint_change_suggestion", {
        p_decision: "approved",
        p_decision_reason: input.decisionReason,
        p_suggestion_id: input.suggestionId,
      });
      if (error) throw error;
      setMessage("蓝图变更建议已批准并激活新版本；它只影响之后新建的生产单。");
      await refreshWorkspace();
    } catch (error) {
      const message = error instanceof Error ? error.message : "无法批准蓝图变更建议。";
      setErrorMessage(message);
      throw new Error(message);
    } finally {
      setPendingAction("");
    }
  }

  if (isLoading && session === undefined) return <LoadingScreen />;
  if (!session) return <AuthScreen errorMessage={errorMessage} onSignedIn={() => setMessage("登录成功，正在读取控制数据。") } />;
  if (isLoading && !workspace) return <LoadingScreen />;
  if (!workspace) return <ErrorScreen errorMessage={errorMessage} onRetry={refreshWorkspace} />;
  if (workspace.accounts.length === 0) return <BootstrapScreen errorMessage={errorMessage} isPending={pendingAction === "bootstrap"} onSubmit={bootstrapPlatform} />;

  return (
    <main className="app-shell" data-sidebar={sidebarCollapsed ? "collapsed" : "expanded"} data-theme={theme}>
      <aside className="sidebar" aria-label="主导航">
        <div className="wordmark"><img alt="Loop 控制台" src="/brand/loop-mark.png" /><span>Loop 控制台</span></div>
        <nav className="navigation"><NavigationButtons activeNavigation={activeNavigation} badges={navigationBadges} onSelect={changeNavigation} /></nav>
        <div className="sidebar-footer"><div className="sidebar-utilities"><SystemStatusPanel isRefreshing={isSystemStatusLoading} onRefresh={refreshSystemStatus} report={systemStatus} tasks={workspace.tasks} /><button aria-label={theme === "light" ? "切换至深色模式" : "切换至浅色模式"} className="sidebar-utility" onClick={changeTheme} title={theme === "light" ? "深色模式" : "浅色模式"} type="button"><Icon name={theme === "light" ? "Moon" : "Sun"} /></button><button aria-label={sidebarCollapsed ? "展开侧栏" : "收起侧栏"} className="sidebar-collapse-button sidebar-utility" onClick={changeSidebarCollapsed} title={sidebarCollapsed ? "展开侧栏" : "收起侧栏"} type="button"><Icon name="PanelLeft" /></button><OwnerMenu onOpenSettings={() => setShowPasswordForm(true)} onSignOut={() => void supabase.auth.signOut()} /></div></div>
      </aside>

      <section className="content-pane" aria-label="平台工作台">
        <header className="page-header">
          <h1>{navigation.find((item) => item.id === activeNavigation)?.label}</h1>
          {activeNavigation === "accounts" ? <button className="button button-primary" onClick={() => setShowAccountForm(true)} type="button">新建账号</button> : null}
          {activeNavigation === "episodes" ? <button className="button button-primary" onClick={() => setShowEpisodeForm(true)} type="button">新建生产单</button> : null}
          <div className="mobile-header-actions"><SystemStatusPanel isRefreshing={isSystemStatusLoading} onRefresh={refreshSystemStatus} report={systemStatus} tasks={workspace.tasks} /><OwnerMenu onOpenSettings={() => setShowPasswordForm(true)} onSignOut={() => void supabase.auth.signOut()} /></div>
        </header>

        {message || errorMessage ? <div className="floating-notices" aria-live="polite">{message ? <div className="notice-message" role="status">{message}<button aria-label="关闭通知" onClick={() => setMessage("")} type="button">×</button></div> : null}{errorMessage ? <div className="error-message" role="alert">{errorMessage}<button aria-label="关闭错误通知" onClick={() => setErrorMessage("")} type="button">×</button></div> : null}</div> : null}

        {activeNavigation === "accounts" ? (
          <AccountWorkspace
            account={selectedAccount}
            accounts={workspace.accounts}
            blueprints={workspace.blueprints.filter((blueprint) => blueprint.account_id === selectedAccount?.id && !blueprint.is_snapshot)}
            blueprintRepairContext={blueprintRepairContext}
            onArchiveBlueprint={setBlueprintArchived}
            onApplyEpisodeRepair={applyEpisodeConfigurationRepair}
            onDismissBlueprintRepair={() => { setBlueprintRepairContext(null); setActiveNavigation("episodes"); }}
            isPending={pendingAction}
            onActivate={activateBlueprint}
            onUpdateBlueprint={updateBlueprint}
            onCreatePromptVersion={createPromptVersion}
            onCreateSeries={createSeries}
            onCreateSeriesVersion={createSeriesVersion}
            onDeactivateBlueprint={deactivateBlueprint}
            onDeleteAccount={deleteAccount}
            onRenameAccount={renameAccount}
            onSelectAccount={(accountId) => { setBlueprintRepairContext(null); setSelectedAccountId(accountId); }}
            accountEpisodeCount={workspace.episodes.filter((episode) => episode.account_id === selectedAccount?.id).length}
            promptVersions={workspace.promptVersions.filter((version) => version.account_id === selectedAccount?.id)}
            series={workspace.series.filter((candidate) => candidate.account_id === selectedAccount?.id)}
            seriesVersions={workspace.seriesVersions.filter((version) => version.account_id === selectedAccount?.id)}
          />
        ) : activeNavigation === "reviews" ? (
          <ReviewWorkspace
            accountsById={accountsById}
            episodes={workspace.episodes.filter((episode) => !episodeIsArchived(episode))}
            onSelectEpisode={openEpisodeDetail}
            selectedEpisode={selectedEpisode}
          />
        ) : activeNavigation === "operations" ? (
          <OperationsWorkspace
            episodes={workspace.episodes.filter((episode) => !episodeIsArchived(episode))}
            onOpenBlueprint={openAccountBlueprint}
            onSelectEpisode={openEpisodeDetail}
            preRenderReviewMemberDecisions={workspace.preRenderReviewMemberDecisions}
            preRenderReviewMembers={workspace.preRenderReviewMembers}
            reviewPackages={workspace.reviewPackages}
            selectedEpisode={selectedEpisode}
            series={workspace.series}
            seriesVersions={workspace.seriesVersions}
            tasks={workspace.tasks}
          />
        ) : activeNavigation === "publish" ? (
          <PublishWorkspace
            accountsById={accountsById}
            artifacts={workspace.artifacts}
            onOpenPublish={openPublishModal}
            publicationRecords={workspace.publicationRecords}
            tasks={workspace.tasks}
            episodes={accountVisibleEpisodes.filter((episode) => !episodeIsArchived(episode))}
            isPending={pendingAction}
            onTransition={transitionEpisode}
            selectedEpisode={selectedEpisode}
          />
        ) : activeNavigation === "learning" ? (
          <LearningWorkspace
            accountsById={accountsById}
            blueprintVersionsById={blueprintsById}
            episodes={accountVisibleEpisodes.filter((episode) => !episodeIsArchived(episode))}
            experiments={workspace.experiments}
            learningReports={workspace.learningReports}
            metricSnapshots={workspace.metricSnapshots}
            blueprintChangeSuggestions={workspace.blueprintChangeSuggestions}
            isPreparingDemo={pendingAction === "learning-demo"}
            onPrepareLearningDemo={prepareLearningDemo}
            onSaveExperiment={saveExperiment}
            onSaveLearningReport={saveLearningReport}
            onSaveMetricSnapshot={saveMetricSnapshot}
            onSaveBlueprintChangeSuggestion={saveBlueprintChangeSuggestion}
            onApproveBlueprintChangeSuggestion={approveBlueprintChangeSuggestion}
          />
        ) : (
          <EpisodeWorkspace
            accounts={workspace.accounts}
            accountsById={accountsById}
            artifacts={workspace.artifacts}
            blueprintsById={blueprintsById}
            currentNavigation={activeNavigation}
            episodes={visibleEpisodes}
            filter={accountFilter}
            isArchivePending={(episodeId) => pendingAction === `archive-${episodeId}`}
            isDeletePending={(episodeId) => pendingAction === `delete-${episodeId}`}
            isTitlePending={(episodeId) => pendingAction === `title-${episodeId}`}
            onDelete={deleteEpisode}
            onFilter={setAccountFilter}
            episodeVisibility={episodeVisibility}
            onEpisodeVisibilityChange={setEpisodeVisibility}
            onSetArchived={setEpisodeArchived}
            onSeriesFilter={setSeriesFilter}
            onSelectEpisode={openEpisodeDetail}
            onUpdateTitle={updateEpisodeTitle}
            series={workspace.series}
            seriesById={seriesById}
            seriesFilter={seriesFilter}
            seriesVersionsById={seriesVersionsById}
            selectedEpisode={selectedEpisode}
          />
        )}
      </section>

      {isEpisodeDetailOpen && selectedEpisode ? <EpisodeDetailDrawer isOpen={isEpisodeDetailOpen} onClose={() => setIsEpisodeDetailOpen(false)}>
          <EpisodeDetail
            artifacts={workspace.artifacts}
            audioTracks={workspace.audioTracks}
            audioTrackAnnotations={workspace.audioTrackAnnotations}
            preRenderReviewMembers={workspace.preRenderReviewMembers}
            preRenderReviewMemberDecisions={workspace.preRenderReviewMemberDecisions}
            blueprint={blueprintsById.get(selectedEpisode.blueprint_version_id) ?? null}
            episode={selectedEpisode}
            isDirectoryOpenPending={pendingAction === `directory-open-${selectedEpisode.id}`}
            isMaterialPending={pendingAction === `material-${selectedEpisode.id}`}
            isStartProductionPending={pendingAction === `start-production-${selectedEpisode.id}`}
            isRefreshPending={pendingAction === "workspace-refresh"}
            isTransitionPending={pendingAction.startsWith(`transition-${selectedEpisode.id}-`) || pendingAction.startsWith("review-render-revision-")}
            onOpenBlueprint={(blocker) => openAccountBlueprint(selectedEpisode.account_id, blocker ? { blocker, blueprintVersionId: selectedEpisode.blueprint_version_id, episodeId: selectedEpisode.id } : null)}
            onOpenLocalDirectory={openLocalEpisodeDirectory}
            onImportMaterial={importProductionMaterial}
            onStartProduction={startEpisodeProduction}
            onRequestReviewRenderRevision={requestReviewRenderRevision}
            onRefresh={refreshEpisodeStatus}
            onTransition={transitionEpisode}
            ownerId={session.user.id}
            reviewPackages={workspace.reviewPackages}
            reviewAnnotations={workspace.reviewAnnotations}
            isStoryboardAnnotationPending={pendingAction.startsWith("storyboard-annotation-")}
            onCreateStoryboardAnnotation={createStoryboardAnnotation}
            onCreateAudioTrackAnnotation={createAudioTrackAnnotation}
            onReviewPreRenderMember={reviewPreRenderMember}
            tasks={workspace.tasks}
            transitions={workspace.transitions}
          />
      </EpisodeDetailDrawer> : null}

      {isPublishModalOpen && selectedEpisode ? <PublishModal
        artifacts={workspace.artifacts}
        episode={selectedEpisode}
        isPending={pendingAction === `publication-${selectedEpisode.id}`}
        onClose={() => setIsPublishModalOpen(false)}
        onOpenArtifact={openLocalArtifact}
        onRecord={recordManualPublication}
        publicationRecords={workspace.publicationRecords.filter((record) => record.episode_id === selectedEpisode.id)}
        publishVerification={workspace.tasks.some((task) => task.episode_id === selectedEpisode.id && task.task_type === "verify_publish_package" && task.status === "completed")}
      /> : null}

      <nav aria-label="移动端主导航" className="mobile-navigation"><NavigationButtons activeNavigation={activeNavigation} badges={navigationBadges} onSelect={changeNavigation} /></nav>

      {showEpisodeForm ? <EpisodeForm accounts={workspace.accounts} isPending={pendingAction === "episode"} onClose={() => setShowEpisodeForm(false)} onSubmit={createEpisode} series={workspace.series} seriesVersions={workspace.seriesVersions} /> : null}
      {showAccountForm ? <AccountForm isPending={pendingAction === "account"} onClose={() => setShowAccountForm(false)} onSubmit={createAccount} /> : null}
      {showPasswordForm ? <PasswordForm onClose={() => setShowPasswordForm(false)} onSubmit={async (password) => {
        setPendingAction("password");
        setErrorMessage("");
        try {
          const { error } = await supabase.auth.updateUser({ password });
          if (error) throw error;
          setShowPasswordForm(false);
          setMessage("登录密码已设置；下次可直接使用邮箱和密码登录。");
        } catch (error) {
          setErrorMessage(error instanceof Error ? error.message : "设置密码失败。");
        } finally {
          setPendingAction("");
        }
      }} isPending={pendingAction === "password"} /> : null}
    </main>
  );
}

function AuthScreen({ errorMessage, onSignedIn }: { errorMessage: string; onSignedIn: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setNotice("");
    const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.origin } });
    setPending(false);
    if (error) setNotice(error.message);
    else {
      setNotice("登录链接已发送，请在本机浏览器中打开邮件并回到此页面。");
      onSignedIn();
    }
  }

  async function signInWithPassword() {
    if (!password) {
      setNotice("请输入登录密码，或使用一次性登录链接。 ");
      return;
    }
    setPending(true);
    setNotice("");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setPending(false);
    if (error) setNotice(error.message);
  }

  return <main className="access-shell"><section className="access-card"><div className="wordmark">Loop 控制台</div><h1>登录控制台</h1><p>使用你的所有者邮箱登录。平台数据、审批和蓝图均受账号权限控制。</p><form onSubmit={submit}><label>邮箱<input aria-label="邮箱" autoComplete="email" onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" required type="email" value={email} /></label><label>密码<input aria-label="密码" autoComplete="current-password" onChange={(event) => setPassword(event.target.value)} placeholder="首次恢复后可设置" type="password" value={password} /></label><button className="button button-primary" disabled={pending || !password} onClick={() => void signInWithPassword()} type="button">{pending ? "登录中…" : "使用密码登录"}</button><button className="button button-secondary" disabled={pending} type="submit">{pending ? "发送中…" : "发送登录链接"}</button></form>{notice ? <p className="form-notice">{notice}</p> : null}{errorMessage ? <p className="form-error">{errorMessage}</p> : null}</section></main>;
}

export function BootstrapScreen({ errorMessage, isPending, onSubmit }: { errorMessage: string; isPending: boolean; onSubmit: (input: { name: string; slug: string; timezone: string; policy: Json }) => Promise<void> }) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [timezone, setTimezone] = useState("Asia/Shanghai");
  const [positioning, setPositioning] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await onSubmit({ name, slug, timezone, policy: { ...defaultBlueprintPolicy, positioning: positioning.trim() } });
  }

  return <main className="access-shell"><section className="access-card bootstrap-card"><div className="wordmark">Loop 控制台</div><h1>初始化首个账号</h1><p>先填写账号业务信息；执行器、审核关卡、工具和资产目录使用默认配置，开始生产前可在蓝图中调整。</p><form onSubmit={submit}><label>账号名称<input onChange={(event) => setName(event.target.value)} placeholder="例如：道工作室" required value={name} /></label><label>账号标识<input onChange={(event) => setSlug(event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))} pattern="[a-z0-9]+(?:-[a-z0-9]+)*" placeholder="dao-studio" required value={slug} /></label><label>账号定位<textarea aria-label="账号定位" onChange={(event) => setPositioning(event.target.value)} placeholder="可稍后在蓝图中补充" rows={3} value={positioning} /></label><TimezoneSelect onChange={setTimezone} value={timezone} /><p className="form-hint">选择账号日常运营和任务时间所使用的时区。</p><button className="button button-primary" disabled={isPending} type="submit">{isPending ? "初始化中…" : "创建首个账号"}</button></form>{errorMessage ? <p className="form-error">{errorMessage}</p> : null}</section></main>;
}

function LoadingScreen() { return <main className="access-shell"><div className="loading-mark">正在连接受控平台…</div></main>; }
function ErrorScreen({ errorMessage, onRetry }: { errorMessage: string; onRetry: () => Promise<void> }) { return <main className="access-shell"><section className="access-card"><h1>无法读取控制数据</h1><p className="form-error">{errorMessage}</p><button className="button button-primary" onClick={() => void onRetry()} type="button">重试</button></section></main>; }

export function AccountWorkspace({ account, accountEpisodeCount = 0, accounts, blueprints, blueprintRepairContext = null, isPending, onActivate, onApplyEpisodeRepair, onArchiveBlueprint = async () => {}, onCreateBlueprint, onCreatePromptVersion, onCreateSeries = async () => {}, onCreateSeriesVersion = async () => {}, onDeactivateBlueprint = async () => {}, onDeleteAccount = async () => {}, onDismissBlueprintRepair, onRenameAccount = async () => {}, onSelectAccount, onUpdateBlueprint, promptVersions = [], series = [], seriesVersions = [] }: { account: Account | null; accountEpisodeCount?: number; accounts: Account[]; blueprints: Blueprint[]; blueprintRepairContext?: BlueprintRepairContext | null; isPending: string; onActivate: (id: string) => Promise<void>; onApplyEpisodeRepair?: (input: { context: BlueprintRepairContext; policy: Json }) => Promise<boolean>; onArchiveBlueprint?: (id: string, archived: boolean) => Promise<void>; onCreateBlueprint?: (policy: Json) => Promise<Blueprint | null>; onCreatePromptVersion?: (input: { capability: PromptVersion["capability"]; name: string; summary: string; instructions: string }) => Promise<PromptVersion | null>; onCreateSeries?: (input: { name: string; rules: Json }) => Promise<void>; onCreateSeriesVersion?: (input: { seriesId: string; rules: Json }) => Promise<void>; onDeactivateBlueprint?: (id: string) => Promise<void>; onDeleteAccount?: (id: string, confirmation: string) => Promise<boolean | void>; onDismissBlueprintRepair?: () => void; onRenameAccount?: (id: string, name: string) => Promise<boolean | void>; onSelectAccount: (id: string) => void; onUpdateBlueprint?: (policy: Json) => Promise<Blueprint | null>; promptVersions?: PromptVersion[]; series?: Series[]; seriesVersions?: SeriesVersion[] }) {
  const [activeSection, setActiveSection] = useState<"blueprints" | "series">("blueprints");
  const [isEditing, setIsEditing] = useState(false);
  const [isAccountRenameOpen, setIsAccountRenameOpen] = useState(false);
  const [isAccountDeleteOpen, setIsAccountDeleteOpen] = useState(false);
  const [selectedBlueprintId, setSelectedBlueprintId] = useState("");
  const activePolicy = account ? blueprints.find((blueprint) => blueprint.id === account.current_blueprint_version_id)?.policy ?? defaultBlueprintPolicy : defaultBlueprintPolicy;
  const sortedBlueprints = blueprints.filter((blueprint) => !blueprint.is_snapshot).sort((left, right) => right.version - left.version);
  const visibleBlueprints = sortedBlueprints.filter((blueprint) => !blueprint.archived_at);
  const archivedBlueprints = sortedBlueprints.filter((blueprint) => blueprint.archived_at);
  const latestBlueprint = visibleBlueprints[0] ?? archivedBlueprints[0] ?? null;
  const archivedHistoryBlueprints = latestBlueprint?.archived_at ? archivedBlueprints.filter((blueprint) => blueprint.id !== latestBlueprint.id) : archivedBlueprints;
  const selectedBlueprint = sortedBlueprints.find((blueprint) => blueprint.id === selectedBlueprintId) ?? sortedBlueprints.find((blueprint) => blueprint.id === account?.current_blueprint_version_id) ?? latestBlueprint;
  const historyBlueprints = latestBlueprint ? visibleBlueprints.filter((blueprint) => blueprint.id !== latestBlueprint.id) : [];

  useEffect(() => {
    setSelectedBlueprintId(blueprintRepairContext?.blueprintVersionId ?? account?.current_blueprint_version_id ?? "");
    setActiveSection("blueprints");
    setIsEditing(false);
    setIsAccountRenameOpen(false);
    setIsAccountDeleteOpen(false);
  }, [account?.id, blueprintRepairContext?.blueprintVersionId, blueprintRepairContext?.episodeId]);

  function selectBlueprint(blueprintId: string) { setSelectedBlueprintId(blueprintId); setIsEditing(false); }

  if (!account) return <div className="empty-state">没有可读取的账号。</div>;
  if (!selectedBlueprint) return <div className="empty-state">该账号没有可读取的蓝图版本。</div>;
  const selectedStatus = blueprintStatusLabel(selectedBlueprint, latestBlueprint?.id ?? "", account.current_blueprint_version_id);
  const isSelectedCurrent = selectedBlueprint.id === account.current_blueprint_version_id;
  return <>
    <div className="account-selector">
      <div className="account-selector-control">
        <div className="account-selector-row"><label>当前账号<select onChange={(event) => onSelectAccount(event.target.value)} value={account.id}>{accounts.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}</select></label></div>
      </div>
      <p>{policyPositioning(activePolicy)}<br />资产目录：{policyAssetRoot(activePolicy)}</p>
      <div className="account-actions"><button aria-label="重命名账号" className="account-rename-button" onClick={() => setIsAccountRenameOpen(true)} title="重命名账号" type="button"><Icon name="Edit" /></button><button aria-label="删除账号" className="account-delete-button" onClick={() => setIsAccountDeleteOpen(true)} title="删除账号" type="button"><Icon name="Delete" /></button></div>
    </div>
    <nav aria-label="账号设置导航" className="account-tabs" role="tablist">
      <button aria-controls="account-blueprints-panel" aria-selected={activeSection === "blueprints"} className={`account-tab ${activeSection === "blueprints" ? "is-active" : ""}`} onClick={() => setActiveSection("blueprints")} role="tab" type="button">蓝图</button>
      <button aria-controls="account-series-panel" aria-selected={activeSection === "series"} className={`account-tab ${activeSection === "series" ? "is-active" : ""}`} onClick={() => setActiveSection("series")} role="tab" type="button">系列</button>
    </nav>
    {activeSection === "blueprints" ? <div aria-labelledby="account-blueprints-heading" className="account-layout" id="account-blueprints-panel" role="tabpanel">
      <section className="blueprint-list">
        <h2 id="account-blueprints-heading">蓝图版本</h2>
        {latestBlueprint || historyBlueprints.length || archivedHistoryBlueprints.length ? <div aria-label="蓝图版本列表" className="blueprint-version-list">
          {latestBlueprint ? <button aria-pressed={selectedBlueprint.id === latestBlueprint.id} className={`blueprint-card ${latestBlueprint.is_active ? "is-active" : ""} ${selectedBlueprint.id === latestBlueprint.id ? "is-selected" : ""}`} onClick={() => selectBlueprint(latestBlueprint.id)} type="button">
            <div><strong>v{latestBlueprint.version}</strong><span>{blueprintStatusLabel(latestBlueprint, latestBlueprint.id, account.current_blueprint_version_id)}</span></div>
            <p>创建于 {formatDate(latestBlueprint.created_at)}</p>
          </button> : null}
          {historyBlueprints.map((blueprint) => <button aria-pressed={selectedBlueprint.id === blueprint.id} className={`blueprint-card ${blueprint.is_active ? "is-active" : ""} ${selectedBlueprint.id === blueprint.id ? "is-selected" : ""}`} key={blueprint.id} onClick={() => selectBlueprint(blueprint.id)} type="button"><div><strong>v{blueprint.version}</strong><span>{blueprintStatusLabel(blueprint, latestBlueprint?.id ?? "", account.current_blueprint_version_id)}</span></div><p>创建于 {formatDate(blueprint.created_at)}</p></button>)}
          {archivedHistoryBlueprints.length ? <details className="blueprint-history"><summary>已归档</summary><div className="blueprint-history-list">{archivedHistoryBlueprints.map((blueprint) => <button aria-pressed={selectedBlueprint.id === blueprint.id} className={`blueprint-card is-archived ${selectedBlueprint.id === blueprint.id ? "is-selected" : ""}`} key={blueprint.id} onClick={() => selectBlueprint(blueprint.id)} type="button"><div><strong>v{blueprint.version}</strong><span>已归档</span></div><p>创建于 {formatDate(blueprint.created_at)}</p></button>)}</div></details> : null}
        </div> : null}
      </section>
      <section className="blueprint-editor">
        <header className="blueprint-editor-heading"><div><h2>{blueprintRepairContext ? "修复当前生产单" : `蓝图 v${selectedBlueprint.version}`}</h2><p>{blueprintRepairContext ? "只会更新当前生产单受阻任务的冻结配置，不会生成蓝图新版本。" : selectedStatus === "当前生效" ? "当前生效版本；仅影响之后新建的生产单。" : selectedStatus === "已归档" ? "已归档版本；保留历史记录，不能直接用于新建生产单。" : "待激活版本；查看确认后可直接启用。"}</p></div><div className="blueprint-editor-heading-actions">{!blueprintRepairContext && !isEditing && !selectedBlueprint.archived_at ? <button className="button button-secondary button-small" onClick={() => setIsEditing(true)} type="button">以此版本编辑</button> : null}{!blueprintRepairContext && isSelectedCurrent ? <button aria-label="停用当前版本" className="button button-danger-soft button-small" disabled={isPending === `deactivate-${selectedBlueprint.id}`} onClick={() => void onDeactivateBlueprint(selectedBlueprint.id)} title="停用后该版本不再用于新建生产单" type="button">{isPending === `deactivate-${selectedBlueprint.id}` ? "停用中…" : "停用当前版本"}</button> : null}</div></header>
        {blueprintRepairContext ? <EpisodeConfigurationRepairForm blocker={blueprintRepairContext.blocker} initialPolicy={selectedBlueprint.policy} isPending={isPending === `apply-episode-repair-${blueprintRepairContext.episodeId}`} onCancel={() => onDismissBlueprintRepair?.()} onSave={async (policy) => { if (onApplyEpisodeRepair) await onApplyEpisodeRepair({ context: blueprintRepairContext, policy }); }} /> : isEditing ? <BlueprintConfigurationForm initialAssetRoot={blueprintAssetRoot(selectedBlueprint.policy)} initialPolicy={selectedBlueprint.policy} isPending={isPending === "blueprint" || isPending === "prompt-version"} onCancel={() => setIsEditing(false)} onCreatePromptVersion={onCreatePromptVersion} onSave={async (policy) => { const savedBlueprint = onUpdateBlueprint ? await onUpdateBlueprint(policy) : onCreateBlueprint ? await onCreateBlueprint(policy) : null; if (!savedBlueprint) return; setSelectedBlueprintId(savedBlueprint.id); setIsEditing(false); }} promptVersions={promptVersions} /> : <BlueprintConfigurationForm initialAssetRoot={blueprintAssetRoot(selectedBlueprint.policy)} initialPolicy={selectedBlueprint.policy} isPending={false} onCancel={() => {}} onSave={async () => {}} promptVersions={promptVersions} readOnly />}
        {!blueprintRepairContext ? <div className="blueprint-editor-actions">
          {selectedBlueprint.archived_at ? <button className="button button-secondary" disabled={isPending === `unarchive-${selectedBlueprint.id}`} onClick={() => void onArchiveBlueprint(selectedBlueprint.id, false)} type="button">{isPending === `unarchive-${selectedBlueprint.id}` ? "处理中…" : "取消归档"}</button> : !isSelectedCurrent ? <button className="button button-primary" disabled={isPending === `activate-${selectedBlueprint.id}`} onClick={() => void onActivate(selectedBlueprint.id)} type="button">{isPending === `activate-${selectedBlueprint.id}` ? "激活中…" : "激活此版本"}</button> : null}
          {!selectedBlueprint.is_active && !selectedBlueprint.archived_at ? <button className="button button-secondary" disabled={isPending === `archive-${selectedBlueprint.id}`} onClick={() => void onArchiveBlueprint(selectedBlueprint.id, true)} type="button">{isPending === `archive-${selectedBlueprint.id}` ? "归档中…" : "归档此版本"}</button> : null}
        </div> : null}
      </section>
    </div> : null}
    {activeSection === "series" ? <div aria-labelledby="account-series-heading" id="account-series-panel" role="tabpanel"><SeriesSettings isPending={isPending} onCreate={onCreateSeries} onCreateVersion={onCreateSeriesVersion} series={series} seriesVersions={seriesVersions} /></div> : null}
    {isAccountRenameOpen ? <AccountRenameModal account={account} isPending={isPending === `rename-account-${account.id}`} onClose={() => setIsAccountRenameOpen(false)} onSave={(name) => onRenameAccount(account.id, name)} /> : null}
    {isAccountDeleteOpen ? <AccountDeleteModal account={account} accountEpisodeCount={accountEpisodeCount} isPending={isPending === `delete-account-${account.id}`} onClose={() => setIsAccountDeleteOpen(false)} onDelete={(confirmation) => onDeleteAccount(account.id, confirmation)} /> : null}
  </>;
}

export function SeriesSettings({ isPending, onCreate, onCreateVersion = async () => {}, series, seriesVersions }: { isPending: boolean | string; onCreate: (input: { name: string; rules: Json }) => Promise<void>; onCreateVersion?: (input: { seriesId: string; rules: Json }) => Promise<void>; series: Series[]; seriesVersions: SeriesVersion[] }) {
  const [editingSeriesId, setEditingSeriesId] = useState<string | null>(null);
  const editingSeries = editingSeriesId ? series.find((candidate) => candidate.id === editingSeriesId) ?? null : null;
  const latestVersion = editingSeries ? seriesVersions.filter((version) => version.series_id === editingSeries.id).sort((a, b) => b.version - a.version)[0] ?? null : null;

  const seriesPending = isPending === true || isPending === "series";
  const versionPending = Boolean(editingSeriesId && isPending === `series-version-${editingSeriesId}`);
  return <section className={`series-settings ${series.length ? "" : "is-empty"}`}><div><h2 id="account-series-heading">系列</h2>{series.length ? <div className="series-list">{series.map((candidate) => { const versions = [...seriesVersions.filter((version) => version.series_id === candidate.id)].sort((a, b) => b.version - a.version); const latest = versions[0] ?? null; const history = versions.slice(1); return <article className="blueprint-card" key={candidate.id}><div><strong>{candidate.name}</strong><span>{latest ? `最新 v${latest.version}` : "暂无版本"}</span></div><p>{latest ? `更新于 ${formatDate(latest.created_at)}` : "创建后可固定系列基线"}</p>{history.length ? <div aria-label={`${candidate.name} 历史版本`} className="series-version-history"><header><strong>历史版本</strong><span>{history.length}</span></header><ul aria-label={`${candidate.name} 历史版本列表`} tabIndex={0}>{history.map((version) => <li key={version.id}><strong>v{version.version}</strong><span>{formatDate(version.created_at)}</span></li>)}</ul></div> : null}<button className="button button-secondary" onClick={() => setEditingSeriesId(candidate.id)} type="button">编辑最新规则</button></article>; })}</div> : <p>还没有系列。创建后即可在生产单中关联和筛选。</p>}</div><SeriesConfigurationForm initialName={editingSeries?.name ?? ""} initialRules={latestVersion?.rules ?? {}} isEditing={Boolean(editingSeries)} isPending={seriesPending || versionPending} onCancel={() => setEditingSeriesId(null)} onSave={async (name, rules) => { if (editingSeries) { await onCreateVersion({ seriesId: editingSeries.id, rules }); setEditingSeriesId(null); } else { await onCreate({ name, rules }); } }} /></section>;
}

function EpisodeActionsMenu({ blueprint, episode, isArchivePending, isDeletePending, isTitlePending, onDelete, onSetArchived, onUpdateTitle }: { blueprint: Blueprint | undefined; episode: Episode; isArchivePending: boolean; isDeletePending: boolean; isTitlePending: boolean; onDelete: (episodeId: string, confirmation: string) => Promise<void>; onSetArchived: (episodeId: string, archived: boolean) => Promise<void>; onUpdateTitle: (episodeId: string, title: string) => Promise<void> }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [action, setAction] = useState<EpisodeAction>(null);
  const archived = episodeIsArchived(episode);
  const isTest = Boolean(episode.is_test);
  function openAction(nextAction: EpisodeAction) { setMenuOpen(false); setAction(nextAction); }
  return <div className="episode-actions" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}><button aria-expanded={menuOpen} aria-haspopup="menu" aria-label={`生产单操作：${episode.title || "未命名生产单"}`} className="episode-actions-trigger" onClick={() => setMenuOpen((current) => !current)} type="button">⋯</button>{menuOpen ? <div className="episode-actions-menu" role="menu"><button onClick={() => openAction("rename")} role="menuitem" type="button">重命名</button><button onClick={() => openAction("archive")} role="menuitem" type="button">{archived ? "恢复" : "归档"}</button>{archived && isTest ? <button className="menu-item-danger" onClick={() => openAction("delete")} role="menuitem" type="button">永久删除</button> : null}</div> : null}{action === "rename" ? <EpisodeRenameModal episode={episode} isPending={isTitlePending} onClose={() => setAction(null)} onSave={onUpdateTitle} /> : null}{action === "archive" ? <EpisodeArchiveModal archived={archived} isPending={isArchivePending} onClose={() => setAction(null)} onSave={onSetArchived} episodeId={episode.id} /> : null}{action === "delete" ? <EpisodeDeleteModal assetRoot={blueprint ? blueprintAssetRoot(blueprint.policy) : ""} episode={episode} isPending={isDeletePending} onClose={() => setAction(null)} onDelete={onDelete} /> : null}</div>;
}

function EpisodeRenameModal({ episode, isPending, onClose, onSave }: { episode: Episode; isPending: boolean; onClose: () => void; onSave: (episodeId: string, title: string) => Promise<void> }) {
  const [title, setTitle] = useState(episode.title);
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); await onSave(episode.id, title); onClose(); }
  return <div className="modal-backdrop" role="presentation"><form aria-label="重命名生产单" className="modal-card" onSubmit={(event) => void submit(event)}><header><div><h2>重命名生产单</h2><p>只修改管理标题，不会改变已固定材料或任务。</p></div><button aria-label="关闭重命名生产单" className="icon-button" onClick={onClose} type="button"><Icon name="Close" /></button></header><label>新标题<input aria-label="新生产单标题" autoFocus onChange={(event) => setTitle(event.target.value)} value={title} /></label><div className="modal-actions"><button className="button button-secondary" onClick={onClose} type="button">取消</button><button className="button button-primary" disabled={isPending || title === episode.title} type="submit">{isPending ? "保存中…" : "保存新标题"}</button></div></form></div>;
}

function EpisodeArchiveModal({ archived, episodeId, isPending, onClose, onSave }: { archived: boolean; episodeId: string; isPending: boolean; onClose: () => void; onSave: (episodeId: string, archived: boolean) => Promise<void> }) {
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); await onSave(episodeId, !archived); onClose(); }
  return <div className="modal-backdrop" role="presentation"><form aria-label={archived ? "恢复生产单" : "归档生产单"} className="modal-card" onSubmit={(event) => void submit(event)}><header><div><h2>{archived ? "恢复生产单" : "归档生产单"}</h2><p>{archived ? "恢复后会重新出现在进行中列表。" : "归档不会删除生产数据或本地产物。"}</p></div><button aria-label="关闭归档操作" className="icon-button" onClick={onClose} type="button"><Icon name="Close" /></button></header><div className="modal-actions"><button className="button button-secondary" onClick={onClose} type="button">取消</button><button className="button button-primary" disabled={isPending} type="submit">{isPending ? "处理中…" : archived ? "确认恢复" : "确认归档"}</button></div></form></div>;
}

function EpisodeDeleteModal({ assetRoot, episode, isPending, onClose, onDelete }: { assetRoot: string; episode: Episode; isPending: boolean; onClose: () => void; onDelete: (episodeId: string, confirmation: string) => Promise<void> }) {
  const [confirmation, setConfirmation] = useState("");
  const confirmationTarget = episode.title.trim() || "DELETE";
  const localEpisodePath = assetRoot ? `${assetRoot}/episodes/${episode.id}` : `episodes/${episode.id}（账号资产目录未配置）`;
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); if (confirmation !== confirmationTarget) return; await onDelete(episode.id, confirmation); onClose(); }
  return <div className="modal-backdrop" role="presentation"><form aria-label="永久删除生产单" className="modal-card modal-card-danger" onSubmit={(event) => void submit(event)}><header><div><h2>永久删除生产单</h2><p>此操作不可恢复，并会同时清理本地产物和数据库关联记录。</p></div><button aria-label="关闭永久删除生产单" className="icon-button" onClick={onClose} type="button"><Icon name="Close" /></button></header><p>本地 Episode 目录：</p><code>{localEpisodePath}</code><label>输入确认文本：<input aria-label="永久删除确认文本" autoFocus onChange={(event) => setConfirmation(event.target.value)} placeholder={confirmationTarget} value={confirmation} /></label><div className="modal-actions"><button className="button button-secondary" onClick={onClose} type="button">取消</button><button className="button button-danger" disabled={isPending || confirmation !== confirmationTarget} type="submit">{isPending ? "删除中…" : "确认永久删除"}</button></div></form></div>;
}

export function EpisodeWorkspace({ accounts, accountsById, artifacts, blueprintsById, currentNavigation, episodeVisibility, episodes, filter, onDelete = async () => {}, onEpisodeVisibilityChange, onFilter, onSetArchived = async () => {}, onSeriesFilter, onSelectEpisode, onUpdateTitle = async () => {}, series, seriesById, seriesFilter, seriesVersionsById, selectedEpisode, isArchivePending = () => false, isDeletePending = () => false, isTitlePending = () => false }: { accounts: Account[]; accountsById: Map<string, Account>; artifacts: Artifact[]; blueprintsById: Map<string, Blueprint>; currentNavigation: NavigationItem; episodeVisibility: EpisodeVisibility; episodes: Episode[]; filter: string; isArchivePending?: (episodeId: string) => boolean; isDeletePending?: (episodeId: string) => boolean; isTitlePending?: (episodeId: string) => boolean; onDelete?: (episodeId: string, confirmation: string) => Promise<void>; onEpisodeVisibilityChange: (value: EpisodeVisibility) => void; onFilter: (value: string) => void; onSetArchived?: (episodeId: string, archived: boolean) => Promise<void>; onSeriesFilter: (value: string) => void; onSelectEpisode: (id: string) => void; onUpdateTitle?: (episodeId: string, title: string) => Promise<void>; series: Series[]; seriesById: Map<string, Series>; seriesFilter: string; seriesVersionsById: Map<string, SeriesVersion>; selectedEpisode: Episode | null }) {
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const filteredEpisodes = episodes.filter((episode) => episodeVisibility === "all" || (episodeVisibility === "archived" ? episodeIsArchived(episode) : !episodeIsArchived(episode)));
  const pageCount = Math.max(1, Math.ceil(filteredEpisodes.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const pageItems = filteredEpisodes.slice((safePage - 1) * pageSize, safePage * pageSize);
  useEffect(() => setPage(1), [episodeVisibility, filter, seriesFilter]);
  useEffect(() => setPage((current) => Math.min(current, pageCount)), [pageCount]);
  if (currentNavigation !== "episodes") return <div className="empty-state"><h2>复盘记录</h2><p>该模块将在后续学习闭环任务中接入。当前所有状态与审计均来自真实数据库。</p></div>;
  return <><div className="filters"><label><span>账号</span><select onChange={(event) => onFilter(event.target.value)} value={filter}><option value="全部账号">全部账号</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label><label><span>系列</span><select onChange={(event) => onSeriesFilter(event.target.value)} value={seriesFilter}><option value="全部系列">全部系列</option>{series.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}</select></label><label><span>生产单状态</span><select aria-label="生产单状态" onChange={(event) => onEpisodeVisibilityChange(event.target.value as EpisodeVisibility)} value={episodeVisibility}><option value="active">进行中</option><option value="archived">已归档</option><option value="all">全部</option></select></label><span className="summary-count">{filteredEpisodes.length} 个生产单</span></div><div className="episode-table" role="table" aria-label="生产单"><div className="table-row table-header" role="row"><span>生产单</span><span>账号</span><span>系列</span><span>蓝图</span><span>当前阶段</span><span>产物数</span><span>更新时间</span><span>操作</span></div>{pageItems.map((episode) => { const seriesVersion = episode.series_version_id ? seriesVersionsById.get(episode.series_version_id) : null; const account = accountsById.get(episode.account_id); const accountSlug = account?.slug ?? ""; return <div className={`table-row episode-row ${selectedEpisode?.id === episode.id ? "is-selected" : ""}`} key={episode.id} onClick={() => onSelectEpisode(episode.id)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelectEpisode(episode.id); } }} role="row" tabIndex={0}><span className="episode-name"><strong>{episode.title || "未命名生产单"}</strong><small>{episode.id.slice(0, 8)}</small></span><span className="account-name"><i aria-hidden="true" className={`account-avatar account-avatar-${accountIdentityColor(accountSlug)}`} title={account?.name ?? "未知账号"}>{accountIdentityInitials(accountSlug)}</i>{account?.name ?? "未知账号"}</span><span>{seriesVersion ? `${seriesById.get(seriesVersion.series_id)?.name ?? "未知系列"} v${seriesVersion.version}` : "—"}</span><span>v{blueprintsById.get(episode.blueprint_version_id)?.version ?? "—"}</span><span className={`stage stage-${stageTone(episode.stage)}`}>{stageLabels[episode.stage]}</span><span>{artifacts.filter((artifact) => artifact.episode_id === episode.id).length}</span><span>{formatDate(episode.updated_at)}</span><EpisodeActionsMenu blueprint={blueprintsById.get(episode.blueprint_version_id)} episode={episode} isArchivePending={isArchivePending(episode.id)} isDeletePending={isDeletePending(episode.id)} isTitlePending={isTitlePending(episode.id)} onDelete={onDelete} onSetArchived={onSetArchived} onUpdateTitle={onUpdateTitle} /></div>; })}</div>{filteredEpisodes.length === 0 ? <div className="empty-state compact"><h2>{episodeVisibility === "archived" ? "还没有已归档的生产单" : "还没有符合条件的生产单"}</h2><p>调整筛选条件，或点击右上角“新建生产单”。</p></div> : null}<PaginationControls page={safePage} pageSize={pageSize} total={filteredEpisodes.length} onPageChange={setPage} /><div className="status-legend"><span><i className="legend-approved" />已通过</span><span><i className="legend-review" />待审核</span><span><i className="legend-muted" />草稿 / 制作</span></div></>;
}

export function ReviewWorkspace({ accountsById, episodes, onSelectEpisode, selectedEpisode }: { accountsById: Map<string, Account>; episodes: Episode[]; onSelectEpisode: (id: string) => void; selectedEpisode: Episode | null }) {
  const reviewEpisodes = episodes.filter((episode) => !episode.archived_at && (reviewActionFor(episode.stage) || episode.stage === "production_ready"));
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const pageCount = Math.max(1, Math.ceil(reviewEpisodes.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const pageItems = reviewEpisodes.slice((safePage - 1) * pageSize, safePage * pageSize);
  useEffect(() => setPage((current) => Math.min(current, pageCount)), [pageCount]);
  return <><p className="muted-copy">审核决定会通过受控状态迁移写入审批与审计记录；Worker 的阻塞项会显示在右侧 Episode 详情中。</p><section className="review-queue" aria-label="待审核 Episode"><h2>待审核 Episode</h2>{reviewEpisodes.length ? <><div className="review-queue-list">{pageItems.map((episode) => <button className={`review-queue-item ${selectedEpisode?.id === episode.id ? "is-selected" : ""}`} key={episode.id} onClick={() => onSelectEpisode(episode.id)} type="button"><strong>{episode.title}</strong><span>{accountsById.get(episode.account_id)?.name ?? "未知账号"} · {stageLabels[episode.stage]}</span></button>)}</div><PaginationControls page={safePage} pageSize={pageSize} total={reviewEpisodes.length} onPageChange={setPage} /></> : <div className="empty-state compact"><h2>没有待审核 Episode</h2><p>Worker 将产物推进到审核阶段后，会在这里显示。</p></div>}</section></>;
}

export function PublishWorkspace({ accountsById, artifacts, episodes, isPending, onOpenPublish, onTransition, publicationRecords, selectedEpisode, tasks }: { accountsById: Map<string, Account>; artifacts: Artifact[]; episodes: Episode[]; isPending: string; onOpenPublish: (id: string) => void; onTransition: (episodeId: string, toStage: EpisodeStage, reason: string) => Promise<boolean>; publicationRecords: PublicationRecord[]; selectedEpisode: Episode | null; tasks: Task[] }) {
  const queue = episodes.filter((episode) => episode.stage === "qc_passed" || episode.stage === "publish_ready" || episode.stage === "publishing_review" || episode.stage === "published");
  async function advanceEpisode(episode: Episode, toStage: EpisodeStage, reason: string) { if (await onTransition(episode.id, toStage, reason)) onOpenPublish(episode.id); }
  return <><p className="muted-copy">发布包由本机 `publish:prepare` 生成并固定索引；人工发布前请运行 `publish:verify` 复核文件。控制台不会连接或点击任何发布平台。</p><div className="publish-queue">{queue.map((episode) => { const latestPublication = publicationRecords.filter((record) => record.episode_id === episode.id).sort((left, right) => right.created_at.localeCompare(left.created_at))[0]; return <article className={`publish-card ${selectedEpisode?.id === episode.id ? "is-selected" : ""}`} key={episode.id}><button className="publish-card-summary" onClick={() => onOpenPublish(episode.id)} type="button"><strong>{episode.title}</strong><span>{accountsById.get(episode.account_id)?.name ?? "未知账号"} · {stageLabels[episode.stage]}</span><small>{latestPublication ? `已发布 · ${latestPublication.platform} · ${latestPublication.published_at ? formatDate(latestPublication.published_at) : "时间未记录"}` : artifacts.some((artifact) => artifact.episode_id === episode.id && artifact.artifact_type === "publish_package") ? "发布包已固定" : "缺少发布包索引"}</small></button>{latestPublication?.external_url ? <a className="publish-card-link" href={latestPublication.external_url} rel="noreferrer" target="_blank">打开外部链接</a> : null}{episode.stage === "qc_passed" ? <button className="button button-secondary" disabled={!artifacts.some((artifact) => artifact.episode_id === episode.id && artifact.artifact_type === "publish_package") || !tasks.some((task) => task.episode_id === episode.id && task.task_type === "verify_publish_package" && task.status === "completed") || isPending === `transition-${episode.id}-publish_ready`} onClick={() => void advanceEpisode(episode, "publish_ready", "已复核固定发布包，进入待发布。")} type="button">进入待发布</button> : episode.stage === "publish_ready" ? <button className="button button-secondary" disabled={isPending === `transition-${episode.id}-publishing_review`} onClick={() => void advanceEpisode(episode, "publishing_review", "发布包已固定，等待 Owner 的人工发布确认。")} type="button">进入发布确认</button> : episode.stage === "publishing_review" ? <button className="button button-secondary" disabled={isPending === `publication-${episode.id}`} onClick={() => onOpenPublish(episode.id)} type="button">打开发布弹窗</button> : <p className="publish-card-hint">已记录发布事实，可打开弹窗查看不可变历史。</p>}</article>; })}</div>{queue.length === 0 ? <div className="empty-state compact"><h2>没有待确认发布</h2><p>完成 QC 后，先在外置媒体库运行发布包生成；发布包被索引后才能进入待发布。</p></div> : null}</>;
}

export function PublicationConfirmationForm({ episode, isPending, onConfirm, ownerId }: { episode: Episode; isPending: boolean; onConfirm: (episodeId: string, toStage: EpisodeStage, reason: string) => Promise<boolean>; ownerId: string }) {
  const [draft, setDraft] = useState(() => readOperationDraft<{ acknowledged: boolean; reason: string }>(ownerId, episode.id, "publication-confirmation"));
  const [acknowledged, setAcknowledged] = useState(draft?.acknowledged ?? false);
  const [reason, setReason] = useState(draft?.reason ?? "");
  const [isRestoredDraft, setIsRestoredDraft] = useState(Boolean(draft));
  const [formError, setFormError] = useState("");

  useEffect(() => { const next = readOperationDraft<{ acknowledged: boolean; reason: string }>(ownerId, episode.id, "publication-confirmation"); setDraft(next); setAcknowledged(next?.acknowledged ?? false); setReason(next?.reason ?? ""); setIsRestoredDraft(Boolean(next)); setFormError(""); }, [episode.id, ownerId]);
  function updateDraft(next: { acknowledged: boolean; reason: string }) { setDraft(next); setAcknowledged(next.acknowledged); setReason(next.reason); setIsRestoredDraft(false); if (next.acknowledged || next.reason.trim()) writeOperationDraft(ownerId, episode.id, "publication-confirmation", next); else { clearOperationDraft(ownerId, episode.id, "publication-confirmation"); setDraft(null); } }
  function clearDraft() { clearOperationDraft(ownerId, episode.id, "publication-confirmation"); setDraft(null); setAcknowledged(false); setReason(""); setIsRestoredDraft(false); }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      setFormError("");
      const confirmation = createPublicationConfirmation({ acknowledged, reason });
      if (await onConfirm(episode.id, "published", confirmation.reason)) clearDraft();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "发布确认无效。");
    }
  }

  return <form className="publication-confirmation" onSubmit={submit}><label><input checked={acknowledged} onChange={(event) => updateDraft({ acknowledged: event.target.checked, reason })} type="checkbox" />我已在目标平台手工发布，并核对发布包内容。</label><label>确认理由<input aria-label="发布确认理由" onChange={(event) => updateDraft({ acknowledged, reason: event.target.value })} placeholder="例如：已在 TikTok Studio 发布并复核" required value={reason} /></label>{draft ? <OperationDraftNotice isRestored={isRestoredDraft} onClear={clearDraft} /> : null}<button className="button button-primary" disabled={isPending} type="submit">{isPending ? "确认中…" : "确认已发布"}</button>{formError ? <p className="form-error">{formError}</p> : null}</form>;
}

type UtilityPanelKind = "worker" | "artifacts" | "timeline";

function EpisodeUtilityPopover({ artifacts, history, kind, onClose, tasks, workerStatus }: { artifacts: Artifact[]; history: Transition[]; kind: UtilityPanelKind; onClose: () => void; tasks: Task[]; workerStatus: EpisodeWorkerStatus }) {
  const completedTasks = tasks.filter((task) => task.status === "completed").length;
  const timeline = history.slice().sort((left, right) => right.created_at.localeCompare(left.created_at));
  const heading = kind === "worker" ? "Worker 状态" : kind === "artifacts" ? "产物索引" : "审计时间线";

  return <div aria-label={heading} className="episode-utility-popover" role="dialog"><header><strong>{heading}</strong><button aria-label={`关闭${heading}`} className="icon-button" onClick={onClose} type="button"><X className="icon" /></button></header>{kind === "worker" ? <div className={`episode-utility-status episode-utility-status-${workerStatus.tone}`}><strong>{workerStatus.label}</strong><p>{workerStatus.detail}</p><span>{tasks.length ? `${completedTasks} / ${tasks.length} 个任务已完成` : "尚无任务记录"}</span></div> : kind === "artifacts" ? <div className="episode-utility-artifacts">{artifacts.length ? artifacts.map((artifact) => <Artifact complete key={artifact.id} label={artifact.artifact_type} name={artifact.relative_path} />) : <div className="episode-utility-summary"><strong>尚无产物</strong><p>Worker 尚未生成可查看的产物。</p></div>}</div> : timeline.length ? <ol className="timeline">{timeline.map((transition) => <li key={transition.id}><i className={`timeline-dot ${stageTone(transition.to_stage)}`} /><div><strong>{stageLabels[transition.to_stage]}</strong><span>{userFacingTransitionReason(transition.reason)}</span></div><time>{formatDate(transition.created_at)}</time></li>)}</ol> : <div className="episode-utility-summary"><strong>暂无状态变化</strong><p>生产单创建与状态变化会显示在这里。</p></div>}</div>;
}

export function EpisodeDetail({ artifacts, audioTrackAnnotations, audioTracks, blueprint, episode, isDirectoryOpenPending = false, isMaterialPending, isRefreshPending = false, isStartProductionPending = false, isStoryboardAnnotationPending, isTransitionPending, onCreateAudioTrackAnnotation, onOpenBlueprint, onOpenLocalDirectory = async () => {}, onCreateStoryboardAnnotation, onImportMaterial, onRefresh = async () => {}, onRequestReviewRenderRevision, onReviewPreRenderMember = async () => {}, onStartProduction = async () => {}, onTransition, ownerId = "local-owner", preRenderReviewMemberDecisions = [], preRenderReviewMembers = [], reviewAnnotations, reviewPackages, tasks, transitions }: { artifacts: Artifact[]; audioTrackAnnotations: AudioTrackAnnotation[]; audioTracks: AudioTrack[]; blueprint: Blueprint | null; episode: Episode; isDirectoryOpenPending?: boolean; isMaterialPending: boolean; isRefreshPending?: boolean; isStartProductionPending?: boolean; isStoryboardAnnotationPending: boolean; isTransitionPending: boolean; onCreateAudioTrackAnnotation: (input: AudioTrackAnnotationRequest) => Promise<void>; onOpenBlueprint?: (blocker: WorkerBlocker) => void; onOpenLocalDirectory?: (episodeId: string) => Promise<void>; onCreateStoryboardAnnotation: (input: StoryboardAnnotationRequest) => Promise<void>; onImportMaterial: (input: MaterialImportRequest) => Promise<void>; onRefresh?: () => Promise<void>; onRequestReviewRenderRevision: (input: ReviewRenderRevisionRequest) => Promise<boolean>; onReviewPreRenderMember?: (input: PreRenderMemberReviewRequest) => Promise<void>; onStartProduction?: (episodeId: string) => Promise<void>; onTransition: (episodeId: string, toStage: EpisodeStage, reason: string) => Promise<boolean>; ownerId?: string; preRenderReviewMemberDecisions?: PreRenderReviewMemberDecision[]; preRenderReviewMembers?: PreRenderReviewMember[]; reviewAnnotations: ReviewAnnotation[]; reviewPackages: ReviewPackage[]; tasks: Task[]; transitions: Transition[] }) {
  const episodeArtifacts = artifacts.filter((artifact) => artifact.episode_id === episode.id);
  const history = transitions.filter((transition) => transition.episode_id === episode.id);
  const blockers = workerBlockers(tasks, episode.id);
  const blockerGroups = groupWorkerBlockers(blockers);
  const episodeTasks = tasks.filter((task) => task.episode_id === episode.id);
  const workerStatus = episodeWorkerStatus(episode, episodeTasks);
  const reviewAction = reviewActionFor(episode.stage);
  const reviewPackage = currentReviewPackage(reviewPackages, episode);
  const reviewArtifact = reviewPackage ? episodeArtifacts.find((candidate) => candidate.id === reviewPackage.artifact_id) : null;
  const reviewArtifacts = reviewPackage ? episodeArtifacts.filter((candidate) => candidate.producer_task_id === reviewPackage.task_id) : [];
  const storyboardAnnotations = reviewPackage ? reviewAnnotations.filter((annotation) => annotation.review_package_id === reviewPackage.id) : [];
  const preRenderMembers = reviewPackage?.stage === "production_ready" ? preRenderReviewMembers.filter((member) => member.review_package_id === reviewPackage.id) : [];
  const preRenderMemberDecisions = reviewPackage?.stage === "production_ready" ? preRenderReviewMemberDecisions.filter((decision) => decision.review_package_id === reviewPackage.id) : [];
  const [storyboardValidation, setStoryboardValidation] = useState({ packageId: "", valid: false });
  const isStoryboardReviewValid = episode.stage !== "storyboard_review" || (reviewPackage?.stage === "storyboard_review" && storyboardValidation.packageId === reviewPackage.id && storyboardValidation.valid);
  const onStoryboardValidationChange = useCallback((valid: boolean) => {
    if (!reviewPackage) return;
    setStoryboardValidation((current) => current.packageId === reviewPackage.id && current.valid === valid ? current : { packageId: reviewPackage.id, valid });
  }, [reviewPackage]);
  const assetRoot = blueprint ? blueprintAssetRoot(blueprint.policy).replace(/[\\/]+$/, "") : "";
  const localInputPath = assetRoot ? `${assetRoot}/episodes/${episode.id}/input` : `episodes/${episode.id}/input`;
  const [directoryMessage, setDirectoryMessage] = useState("");
  const [openUtilityPanel, setOpenUtilityPanel] = useState<UtilityPanelKind | null>(null);

  async function copyLocalInputPath() {
    try {
      await navigator.clipboard.writeText(localInputPath);
      setDirectoryMessage("输入目录路径已复制。");
    } catch {
      setDirectoryMessage("浏览器无法复制，请直接使用上方显示的路径。");
    }
  }

  const waitingForMainScript = episode.stage === "waiting_input" && !episode.main_script_revision_id;
  const inputReadyToStart = episode.stage === "waiting_input" && Boolean(episode.main_script_revision_id);
  const nextStep = inputReadyToStart ? "确认材料并开始制作" : nextStepForEpisode(episode.stage);

  return <>
    <header className="review-heading"><div className="review-heading-copy"><h2>{episode.title || "未命名生产单"}</h2><span>{episode.id.slice(0, 8)}</span></div></header>
    <div aria-label="生产单操作" className="episode-detail-toolbar"><div className="episode-toolbar-actions"><button aria-label="刷新生产单状态" className="icon-button episode-toolbar-button" disabled={isRefreshPending} onClick={() => void onRefresh()} title="刷新状态" type="button"><RefreshCw className="icon" /></button><button aria-label="打开本地输入目录" className="icon-button episode-toolbar-button" disabled={isDirectoryOpenPending} onClick={() => void onOpenLocalDirectory(episode.id)} title={`打开本地输入目录：${localInputPath}`} type="button"><FolderOpen className="icon" /></button><button aria-label="复制本地输入目录路径" className="icon-button episode-toolbar-button" onClick={() => void copyLocalInputPath()} title={`复制本地输入目录路径：${localInputPath}`} type="button"><Copy className="icon" /></button><button aria-expanded={openUtilityPanel === "worker"} aria-haspopup="dialog" aria-label={`Worker 状态：${workerStatus.label}`} className="icon-button episode-toolbar-button" onClick={() => setOpenUtilityPanel((current) => current === "worker" ? null : "worker")} title={`Worker 状态：${workerStatus.label} · ${workerStatus.detail}`} type="button"><Activity className="icon" /></button><button aria-expanded={openUtilityPanel === "artifacts"} aria-haspopup="dialog" aria-label="查看产物索引" className="icon-button episode-toolbar-button" onClick={() => setOpenUtilityPanel((current) => current === "artifacts" ? null : "artifacts")} title="查看产物索引" type="button"><ClipboardList className="icon" /></button><button aria-expanded={openUtilityPanel === "timeline"} aria-haspopup="dialog" aria-label="查看审计时间线" className="icon-button episode-toolbar-button" onClick={() => setOpenUtilityPanel((current) => current === "timeline" ? null : "timeline")} title="查看审计时间线" type="button"><History className="icon" /></button></div>{directoryMessage ? <span className="episode-toolbar-status" role="status">{directoryMessage}</span> : null}{openUtilityPanel ? <EpisodeUtilityPopover artifacts={episodeArtifacts} history={history} kind={openUtilityPanel} onClose={() => setOpenUtilityPanel(null)} tasks={episodeTasks} workerStatus={workerStatus} /> : null}</div>
    <p className="review-meta">蓝图 v{blueprint?.version ?? "—"} · 创建于 {formatDate(episode.created_at)}</p>
    <section className="episode-next-step-card"><div><span>当前阶段</span><strong className={`stage stage-${stageTone(episode.stage)}`}>{stageLabels[episode.stage]}</strong></div><div><span>下一步</span><p>{nextStep}</p></div><div className={`episode-worker-status episode-worker-status-${workerStatus.tone}`}><span>Worker 状态</span><strong>{workerStatus.label}</strong><p>{workerStatus.detail}</p></div></section>
    <details className="review-section detail-card-collapsible" open={waitingForMainScript || inputReadyToStart}><summary><h3>准备生产材料</h3></summary><div className="detail-card-body">{waitingForMainScript ? <p className="material-import-subtitle">一次选择本单需要的主脚本、图片、音频、视频和参考材料；每个文件会单独记录用途。确认材料后，再点击“材料准备完成，开始制作”。</p> : inputReadyToStart ? <p className="material-import-subtitle">主脚本已确认。你可以继续添加补充材料；所有材料准备好后，点击下方按钮，Worker 才会开始制作。</p> : null}<MaterialImportForm allowMainScript={!episode.main_script_revision_id} defaultMainScript={waitingForMainScript} episodeId={episode.id} isPending={isMaterialPending} onImport={onImportMaterial} />{inputReadyToStart ? <div className="production-start-gate"><div><strong>材料已准备到可开始状态</strong><p>确认后将推进生产单并创建后续 Worker 任务。</p></div><button className="button button-primary" disabled={isStartProductionPending} onClick={() => void onStartProduction(episode.id)} type="button">{isStartProductionPending ? "开始中…" : "材料准备完成，开始制作"}</button></div> : null}</div></details>
    {reviewPackage?.stage !== "visual_review" && reviewPackage?.stage !== "storyboard_review" ? <details className="review-section detail-card-collapsible"><summary><h3>产物预览</h3></summary><div className="detail-card-body"><ArtifactPreview artifacts={episodeArtifacts} /></div></details> : null}
    {reviewPackage?.stage === "production_ready" ? <PreRenderReviewPackage artifacts={episodeArtifacts} decisions={preRenderMemberDecisions} isTransitionPending={isTransitionPending} members={preRenderMembers} onReviewMember={onReviewPreRenderMember} onTransition={onTransition} reviewPackage={reviewPackage} /> : reviewPackage && reviewArtifact ? reviewPackage.stage === "qc_review" && isHyperframesReviewRender(reviewPackage.context_snapshot) ? <HyperframesReviewRenderPackage artifact={reviewArtifact} artifacts={reviewArtifacts} reviewPackage={reviewPackage} /> : reviewPackage.stage === "visual_review" ? <VisualReviewPackage artifact={reviewArtifact} artifacts={reviewArtifacts} reviewPackage={reviewPackage} /> : reviewPackage.stage === "storyboard_review" ? <StoryboardReviewPackage annotations={storyboardAnnotations} artifact={reviewArtifact} isAnnotationPending={isStoryboardAnnotationPending} onCreateAnnotation={onCreateStoryboardAnnotation} onValidationChange={onStoryboardValidationChange} reviewPackage={reviewPackage} /> : <TextReviewPackage artifact={reviewArtifact} reviewPackage={reviewPackage} /> : null}
    <ArollTaskEvidencePanel tasks={episodeTasks} />
    <AudioTrackPanel annotations={audioTrackAnnotations.filter((annotation) => audioTracks.some((track) => track.episode_id === episode.id && track.id === annotation.audio_track_id))} onCreateAnnotation={onCreateAudioTrackAnnotation} tasks={episodeTasks} tracks={audioTracks.filter((track) => track.episode_id === episode.id)} />
    {blockers.length ? <details className="review-section worker-blockers detail-card-collapsible"><summary><h3>Worker 阻塞项（{blockers.length}）</h3></summary><div className="detail-card-body">{blockerGroups.map(({ blocker, count }) => <WorkerBlockerCard affectedTaskCount={count} blocker={blocker} onOpenBlueprint={onOpenBlueprint} key={`${blocker.code}-${blocker.detail}`} />)}</div></details> : null}
    {reviewAction && isStoryboardReviewValid ? <ReviewActions episode={episode} initialReviewRenderAdjustments={reviewRenderAdjustmentsFromContext(reviewPackage?.context_snapshot ?? {})} isPending={isTransitionPending} onRequestReviewRenderRevision={onRequestReviewRenderRevision} onTransition={onTransition} ownerId={ownerId} reviewAction={reviewAction} reviewPackageId={reviewPackage?.id ?? null} /> : null}
  </>;
}

function isHyperframesReviewRender(value: unknown): boolean {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && "review_kind" in value && value.review_kind === "hyperframes_review_render");
}

function HyperframesReviewRenderPackage({ artifact, artifacts, reviewPackage }: { artifact: Artifact; artifacts: Artifact[]; reviewPackage: ReviewPackage }) {
  const context = reviewPackage.context_snapshot && typeof reviewPackage.context_snapshot === "object" && !Array.isArray(reviewPackage.context_snapshot) ? reviewPackage.context_snapshot as Record<string, unknown> : null;
  const projectRevision = context && typeof context.project_revision === "string" ? context.project_revision : "—";
  const upstreamPackage = context && typeof context.pre_render_review_package_id === "string" ? context.pre_render_review_package_id : "—";
  const projectPath = context && typeof context.project_relative_path === "string" ? context.project_relative_path : "—";
  const checks = context && context.technical_evidence && typeof context.technical_evidence === "object" && !Array.isArray(context.technical_evidence) && Array.isArray((context.technical_evidence as Record<string, unknown>).checks) ? (context.technical_evidence as { checks: Array<{ name?: unknown; detail?: unknown }> }).checks : [];
  const qcReport = artifacts.find((candidate) => candidate.artifact_type === "review_qc_report");
  return <section className="review-section review-render-package"><h3>HyperFrames 审核渲染 · 工程 v{projectRevision}</h3><ArtifactPreview artifacts={artifacts.filter((candidate) => candidate.artifact_type === "render")} /><dl><div><dt>上游审核包</dt><dd>{upstreamPackage}</dd></div><div><dt>冻结工程</dt><dd>{projectPath}</dd></div><div><dt>渲染产物</dt><dd>{artifact.relative_path}</dd></div><div><dt>QC 报告</dt><dd>{qcReport?.relative_path ?? "缺少 QC 报告"}</dd></div></dl><h4>QC 报告</h4>{checks.length ? <ul className="technical-evidence">{checks.map((check, index) => <li key={`${String(check.name)}-${index}`}><strong>{typeof check.name === "string" ? check.name : "check"}</strong><span>{typeof check.detail === "string" ? check.detail : "证据格式无效。"}</span></li>)}</ul> : <p className="form-error">QC 报告格式无效。</p>}</section>;
}

function PreRenderReviewPackage({ artifacts, decisions, isTransitionPending, members, onReviewMember, onTransition, reviewPackage }: { artifacts: Artifact[]; decisions: PreRenderReviewMemberDecision[]; isTransitionPending: boolean; members: PreRenderReviewMember[]; onReviewMember: (input: PreRenderMemberReviewRequest) => Promise<void>; onTransition: (episodeId: string, toStage: EpisodeStage, reason: string) => Promise<boolean>; reviewPackage: ReviewPackage }) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const allApproved = members.length > 0 && members.every((member) => decisions.find((decision) => decision.member_key === member.member_key)?.decision === "approved");
  async function approvePackage() {
    const trimmedReason = reason.trim();
    if (!trimmedReason) { setError("请填写进入合成前的审核理由。"); return; }
    setError("");
    await onTransition(reviewPackage.episode_id, "render_ready", trimmedReason);
  }
  return <section className="review-section pre-render-review-package"><h3>预渲染审核包 · 修订 v{reviewPackage.revision_number}</h3><p className="muted-copy">已冻结 {members.length} 个媒体与音轨成员及其生成证据。逐项批准后，才能进入合成。</p>{members.map((member) => {
    const decision = decisions.find((candidate) => candidate.member_key === member.member_key) ?? null;
    const evidence = preRenderMemberEvidence(member.evidence_snapshot);
    const artifact = artifacts.find((candidate) => candidate.id === member.artifact_id || (evidence && candidate.relative_path === evidence.relativePath && candidate.sha256 === evidence.sha256));
    return <article className="pre-render-member" key={member.id}><header><strong><span>{preRenderMemberLabel(member.member_kind)}</span><small>{preRenderMemberKey(member.member_key)}</small></strong><span className={decision?.decision === "approved" ? "stage stage-approved" : decision?.decision === "changes_requested" ? "stage stage-review" : "stage stage-muted"}>{decision?.decision === "approved" ? decision.inherited_from_review_package_id ? "沿用已批准" : "已批准" : decision?.decision === "changes_requested" ? "已退回" : "待审核"}</span></header>{artifact ? <ArtifactPreview artifacts={[artifact]} /> : null}{evidence ? <dl><div><dt>执行器</dt><dd>{evidence.provider} · {evidence.model} · {evidence.promptVersion}</dd></div><div><dt>产物</dt><dd>{evidence.relativePath}</dd></div><div><dt>SHA-256</dt><dd>{evidence.sha256.slice(0, 12)}…</dd></div>{evidence.durationSeconds === null ? null : <div><dt>时间范围</dt><dd>{evidence.startSeconds ?? 0}s – {((evidence.startSeconds ?? 0) + evidence.durationSeconds).toFixed(3)}s</dd></div>}</dl> : <p className="form-error">冻结成员证据格式无效。</p>}{decision ? <p className="muted-copy">{decision.reason}</p> : <PreRenderMemberDecisionForm member={member} onReview={onReviewMember} reviewPackageId={reviewPackage.id} />}</article>;
  })}<section className="pre-render-final-decision"><h4>进入合成</h4><label>审核理由<textarea aria-label="预渲染审核理由" onChange={(event) => setReason(event.target.value)} placeholder="说明全部冻结成员已可用于合成" rows={3} value={reason} /></label>{error ? <p className="form-error">{error}</p> : null}<button className="button button-primary" disabled={!allApproved || isTransitionPending} onClick={() => void approvePackage()} type="button">批准预渲染包并进入合成</button>{!allApproved ? <p className="muted-copy">请先逐项批准全部成员。</p> : null}</section></section>;
}

function PreRenderMemberDecisionForm({ member, onReview, reviewPackageId }: { member: PreRenderReviewMember; onReview: (input: PreRenderMemberReviewRequest) => Promise<void>; reviewPackageId: string }) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  async function submit(decision: "approved" | "changes_requested") {
    const trimmedReason = reason.trim();
    if (!trimmedReason) { setError("请填写审核理由。"); return; }
    setError("");
    await onReview({ reviewPackageId, memberKey: member.member_key, decision, reason: trimmedReason });
  }
  return <div className="review-actions"><label>成员审核理由<input aria-label={`${member.member_key} 审核理由`} onChange={(event) => setReason(event.target.value)} value={reason} /></label>{error ? <p className="form-error">{error}</p> : null}<button className="button button-primary" onClick={() => void submit("approved")} type="button">批准此项</button><button className="button button-secondary" onClick={() => void submit("changes_requested")} type="button">退回此项</button></div>;
}

function preRenderMemberLabel(kind: string): string {
  return kind === "shot_media" ? "镜头媒体" : kind === "narration" ? "叙述音频" : "BGM / SFX";
}

function preRenderMemberKey(memberKey: string): string {
  const separator = memberKey.indexOf(":");
  return separator === -1 ? memberKey : memberKey.slice(separator + 1);
}

function preRenderMemberEvidence(snapshot: Json): { durationSeconds: number | null; model: string; promptVersion: string; provider: string; relativePath: string; sha256: string; startSeconds: number | null } | null {
  if (!snapshot || Array.isArray(snapshot) || typeof snapshot !== "object") return null;
  const task = snapshot.task;
  const output = snapshot.artifact ?? snapshot.audio_track;
  if (!task || Array.isArray(task) || typeof task !== "object" || !output || Array.isArray(output) || typeof output !== "object" || typeof task.provider !== "string" || typeof task.model !== "string" || typeof task.prompt_version !== "string" || typeof output.relative_path !== "string" || typeof output.sha256 !== "string") return null;
  const durationSeconds = typeof output.duration_seconds === "number" && output.duration_seconds > 0 ? output.duration_seconds : null;
  const startSeconds = typeof output.start_seconds === "number" && output.start_seconds >= 0 ? output.start_seconds : null;
  return { durationSeconds, model: task.model, promptVersion: task.prompt_version, provider: task.provider, relativePath: output.relative_path, sha256: output.sha256, startSeconds };
}

function AudioTrackPanel({ annotations, onCreateAnnotation, tasks, tracks }: { annotations: AudioTrackAnnotation[]; onCreateAnnotation: (input: AudioTrackAnnotationRequest) => Promise<void>; tasks: Task[]; tracks: AudioTrack[] }) {
  const [trackId, setTrackId] = useState("");
  const [atSeconds, setAtSeconds] = useState("0");
  const [reason, setReason] = useState("");
  const [formError, setFormError] = useState("");
  useEffect(() => { if (!trackId && tracks[0]) { setTrackId(tracks[0].id); setAtSeconds(String(tracks[0].start_seconds)); } }, [trackId, tracks]);
  if (!tracks.length) return <details className="review-section detail-card-collapsible"><summary><h3>音轨</h3></summary><div className="detail-card-body"><p className="muted-copy">暂无旁白、派生音频或可选声轨。BGM / SFX 当前保持为空。</p></div></details>;
  const selectedTrack = tracks.find((candidate) => candidate.id === trackId);
  const selectedTrackEnd = selectedTrack ? selectedTrack.start_seconds + selectedTrack.duration_seconds : 0;
  async function submit(event: FormEvent) {
    event.preventDefault();
    const track = selectedTrack;
    const seconds = Number(atSeconds);
    if (!track || !Number.isFinite(seconds) || seconds < track.start_seconds || seconds > track.start_seconds + track.duration_seconds || !reason.trim()) { setFormError("请选择音轨，并输入该音轨时间范围内的时间点和批注。 "); return; }
    setFormError("");
    await onCreateAnnotation({ audioTrackId: track.id, atSeconds: seconds, reason: reason.trim() });
    setReason("");
  }
  return <details className="review-section detail-card-collapsible"><summary><h3>音轨</h3></summary><div className="detail-card-body">{tracks.map((track) => <AudioTrackCard annotations={annotations.filter((annotation) => annotation.audio_track_id === track.id)} key={track.id} sourceTask={tasks.find((task) => task.id === track.source_task_id)} track={track} />)}<form className="review-actions audio-annotation-form" onSubmit={(event) => void submit(event)}><label>音轨<select aria-label="音轨" onChange={(event) => { const nextTrack = tracks.find((track) => track.id === event.target.value); setTrackId(event.target.value); if (nextTrack) setAtSeconds(String(nextTrack.start_seconds)); }} value={trackId}>{tracks.map((track) => <option key={track.id} value={track.id}>{track.track_kind} · {track.cue_id ?? track.id.slice(0, 8)}</option>)}</select></label><label>时间点（秒）<input aria-label="音轨时间点" max={selectedTrackEnd} min={selectedTrack?.start_seconds ?? 0} onChange={(event) => setAtSeconds(event.target.value)} step="0.001" type="number" value={atSeconds} /></label><label>批注<input aria-label="音轨批注" onChange={(event) => setReason(event.target.value)} value={reason} /></label><button className="button button-primary" type="submit">添加音轨批注</button></form>{formError ? <p className="form-error">{formError}</p> : null}</div></details>;
}

function AudioTrackCard({ annotations, sourceTask, track }: { annotations: AudioTrackAnnotation[]; sourceTask?: Task; track: AudioTrack }) {
  const source = localArtifactUrl(track.episode_id, track.relative_path, track.sha256);
  const { error, url } = useLocalArtifactBlob(source);
  const mediaSource = freesoundMediaSource(sourceTask);
  return <article className="audio-track-card"><strong>{track.track_kind} · {track.cue_id ?? "未命名"}</strong>{url ? <audio aria-label={`${track.track_kind} 音轨`} controls preload="metadata" src={url} /> : error ? <p className="muted-copy">{error}</p> : <LoadingIndicator compact label="正在加载可试听音轨…" />}<dl><div><dt>时间范围</dt><dd>{track.start_seconds}s – {(track.start_seconds + track.duration_seconds).toFixed(3)}s</dd></div><div><dt>来源审核包</dt><dd>{track.source_review_package_id?.slice(0, 8) ?? "派生自固定视频修订"}</dd></div>{mediaSource ? <><div><dt>素材来源</dt><dd><a href={mediaSource.sourceUrl} rel="noreferrer" target="_blank">{mediaSource.title}</a> · {mediaSource.creator}</dd></div><div><dt>许可</dt><dd><a href={mediaSource.license} rel="noreferrer" target="_blank">{mediaSource.license}</a></dd></div></> : null}</dl>{annotations.map((annotation) => <p className="muted-copy" key={annotation.id}>{annotation.at_seconds}s · {annotation.reason}</p>)}</article>;
}

function freesoundMediaSource(task: Task | undefined): { title: string; creator: string; license: string; sourceUrl: string } | null {
  if (task?.provider !== "freesound" || !task.last_result || typeof task.last_result !== "object" || Array.isArray(task.last_result)) return null;
  const result = task.last_result as Record<string, unknown>;
  const source = result.mediaSource;
  if (!source || typeof source !== "object" || Array.isArray(source)) return null;
  const { creator, license, sourceUrl, title } = source as Record<string, unknown>;
  return typeof title === "string" && title && typeof creator === "string" && creator && typeof license === "string" && license && typeof sourceUrl === "string" && sourceUrl ? { title, creator, license, sourceUrl } : null;
}

function ArollTaskEvidencePanel({ tasks }: { tasks: Task[] }) {
  const aRollTasks = tasks.filter((task) => task.task_type === "generate_a_roll");
  if (!aRollTasks.length) return null;
  return <details className="review-section detail-card-collapsible"><summary><h3>A-roll 生成运行</h3></summary><div className="detail-card-body">{aRollTasks.map((task) => {
    const evidence = aRollTaskEvidence(task);
    const blocker = blockersFromResult(task.last_result)[0];
    const guidance = blocker ? workerBlockerGuidance(blocker) : null;
    return <article className={`worker-blocker ${task.status === "blocked" ? "a-roll-blocked-task" : ""}`} key={task.id}><strong>{evidence?.shotId ?? "A-roll 任务"} · {taskStatusLabels[task.status]}</strong>{task.status === "blocked" ? <div className="a-roll-blocker-copy"><strong>{guidance?.title ?? "A-roll 任务已阻塞"}</strong><p>{guidance?.summary ?? "A-roll 任务缺少可执行条件，请先处理下方阻塞项。"}</p><span>{guidance?.retryLabel ?? "处理阻塞项后重新创建任务"}。</span></div> : evidence ? <dl><div><dt>执行器</dt><dd>{evidence.provider} · {evidence.model} · {evidence.promptVersion}</dd></div><div><dt>适配器</dt><dd>{evidence.adapter}</dd></div><div><dt>允许工具</dt><dd>{evidence.allowedTools.join("、")}</dd></div><div><dt>冻结输入哈希</dt><dd>{evidence.inputHashes.map((hash) => `${hash.slice(0, 12)}…`).join("、")}</dd></div></dl> : <p className="muted-copy">执行证据尚未生成。</p>}<dl><div><dt>运行尝试</dt><dd>{task.attempt} / {task.max_attempts}</dd></div><div><dt>实际成本</dt><dd>{task.actual_cost_cents ?? 0} 分</dd></div></dl>{task.last_result ? <p className="muted-copy">最新结果：{taskStatusLabels[task.status]}</p> : null}</article>;
  })}</div></details>;
}

interface MaterialImportDraft {
  file: File;
  id: string;
  isMainScript: boolean;
  materialPurpose: MaterialPurpose;
  materialType: MaterialType;
}

const supportedMaterialAccept = ".md,.markdown,.txt,.jpg,.jpeg,.png,.webp,.gif,.avif,.mp3,.wav,.m4a,.aac,.flac,.ogg,.mp4,.mov,.webm,.m4v,.avi";
const materialTypeLabels: Record<MaterialType, string> = { script: "脚本", reference: "参考材料", image: "图片", audio: "音频", video: "视频" };

function MaterialImportForm({ allowMainScript = true, defaultMainScript = true, episodeId, isPending, onImport }: { allowMainScript?: boolean; defaultMainScript?: boolean; episodeId: string; isPending: boolean; onImport: (input: MaterialImportRequest) => Promise<void> }) {
  const [sourceKind, setSourceKind] = useState<MaterialImportRequest["sourceKind"]>("file");
  const [sourcePath, setSourcePath] = useState("");
  const [pastedContent, setPastedContent] = useState("");
  const [selectedFiles, setSelectedFiles] = useState<MaterialImportDraft[]>([]);
  const initialMaterialType: MaterialType = allowMainScript ? "script" : "reference";
  const [materialType, setMaterialType] = useState<MaterialType>(initialMaterialType);
  const [materialPurpose, setMaterialPurpose] = useState<MaterialPurpose>(defaultMaterialPurpose(initialMaterialType, allowMainScript));
  const [isMainScript, setIsMainScript] = useState(allowMainScript && defaultMainScript);
  const [confirmed, setConfirmed] = useState(false);
  const [formError, setFormError] = useState("");
  const [fileInputKey, setFileInputKey] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const nextType: MaterialType = allowMainScript ? "script" : "reference";
    setMaterialType(nextType);
    setMaterialPurpose(defaultMaterialPurpose(nextType, allowMainScript));
    setIsMainScript(allowMainScript && defaultMainScript);
    setConfirmed(false);
  }, [allowMainScript, defaultMainScript]);

  function changeSourceKind(nextSourceKind: MaterialImportRequest["sourceKind"]) {
    setSourceKind(nextSourceKind);
    setSourcePath("");
    setPastedContent("");
    setSelectedFiles([]);
    setFormError("");
    setFileInputKey((current) => current + 1);
  }

  function changeMaterialType(nextMaterialType: MaterialType) {
    setMaterialType(nextMaterialType);
    setMaterialPurpose(defaultMaterialPurpose(nextMaterialType, allowMainScript));
    setSourcePath("");
    setPastedContent("");
    setFormError("");
    setIsMainScript(nextMaterialType === "script" && allowMainScript && isMainScript);
    setFileInputKey((current) => current + 1);
  }

  function changeDraftType(id: string, nextMaterialType: MaterialType) {
    setSelectedFiles((current) => current.map((draft) => {
      if (draft.id !== id) return draft;
      const options = materialPurposeOptions(nextMaterialType, allowMainScript);
      const nextPurpose = options.some((option) => option.value === draft.materialPurpose) ? draft.materialPurpose : (options[0]?.value ?? "general_reference");
      return { ...draft, isMainScript: nextMaterialType === "script" ? draft.isMainScript : false, materialPurpose: nextPurpose, materialType: nextMaterialType };
    }));
  }

  function changeDraftPurpose(id: string, nextPurpose: MaterialPurpose) {
    setSelectedFiles((current) => current.map((draft) => draft.id === id ? { ...draft, materialPurpose: nextPurpose } : draft));
  }

  function markDraftAsMainScript(id: string) {
    setSelectedFiles((current) => current.map((draft) => ({ ...draft, isMainScript: draft.id === id && draft.materialType === "script", materialPurpose: draft.id === id && draft.materialType === "script" ? "main_script" : draft.materialPurpose })));
    setConfirmed(false);
  }

  function selectFiles(files: File[]) {
    const detectedTypes = files.map(materialTypeForFile);
    if (!allowMainScript && detectedTypes.some((type) => type === "script")) {
      setSelectedFiles([]);
      setFormError("主脚本已确认，不能再次导入脚本；如需补充说明，请将文本作为参考材料导入。");
      return;
    }
    const firstScriptIndex = detectedTypes.findIndex((type) => type === "script");
    setSelectedFiles(files.map((file, index) => {
      const type = detectedTypes[index];
      const isMain = allowMainScript && defaultMainScript && type === "script" && index === firstScriptIndex;
      return { file, id: `${file.name}-${file.lastModified}-${index}`, isMainScript: isMain, materialPurpose: isMain ? "main_script" : defaultMaterialPurpose(type, allowMainScript), materialType: type };
    }));
    setConfirmed(false);
    setFormError("");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      setFormError("");
      const mainScriptSelected = sourceKind === "file" ? selectedFiles.some((draft) => draft.isMainScript) : allowMainScript && isMainScript;
      if (allowMainScript && sourceKind === "file" && selectedFiles.filter((draft) => draft.isMainScript).length !== 1) throw new Error("请在本批材料中指定且只指定一个主脚本。");
      if (mainScriptSelected && !confirmed) throw new Error("请明确确认这份材料是主脚本。");

      if (sourceKind === "file") {
        if (!selectedFiles.length) throw new Error("请选择要导入的材料文件，可一次选择多个文件。");
        for (const draft of selectedFiles) {
          await onImport({ content: new Uint8Array(await new Response(draft.file).arrayBuffer()), episodeId, isMainScript: draft.isMainScript, materialPurpose: draft.materialPurpose, materialType: draft.materialType, mimeType: draft.file.type || "application/octet-stream", sourceKind, sourcePath: draft.file.name });
          setSelectedFiles((current) => current.filter((item) => item.id !== draft.id));
        }
      } else {
        let content: Uint8Array | undefined;
        let resolvedPath = sourcePath.trim();
        let mimeType = "application/octet-stream";
        if (sourceKind === "paste") {
          if (!pastedContent) throw new Error("请粘贴要导入的内容。");
          resolvedPath = resolvedPath || "pasted-material.txt";
          content = new TextEncoder().encode(pastedContent);
          mimeType = "text/plain;charset=utf-8";
        } else if (!resolvedPath) {
          throw new Error("请填写项目输入目录内的相对文件路径。");
        }
        await onImport({ content, episodeId, isMainScript: Boolean(mainScriptSelected), materialPurpose, materialType, mimeType, sourceKind, sourcePath: resolvedPath });
      }
      setConfirmed(false);
      setPastedContent("");
      setSelectedFiles([]);
      setSourcePath("");
      setFileInputKey((current) => current + 1);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "无法导入生产材料。");
    }
  }

  const typeOptions = (Object.keys(materialTypeLabels) as MaterialType[]).filter((type) => allowMainScript || type !== "script");
  const mainScriptSelected = sourceKind === "file" ? selectedFiles.some((draft) => draft.isMainScript) : allowMainScript && isMainScript;
  return <form className="material-import" onSubmit={(event) => void submit(event)}><label><span>来源</span><select aria-label="材料来源" onChange={(event) => changeSourceKind(event.target.value as MaterialImportRequest["sourceKind"])} value={sourceKind}><option value="file">文件选择</option><option value="directory">项目输入目录</option><option value="paste">粘贴内容</option></select></label>{sourceKind === "file" ? <label><span>选择材料 <HelpTip label="选择材料" >可以一次选择多个文件。脚本建议使用 .md 或 .txt；图片支持 .jpg、.jpeg、.png、.webp、.gif、.avif；音频支持 .mp3、.wav、.m4a、.aac、.flac、.ogg；视频支持 .mp4、.mov、.webm、.m4v、.avi。</HelpTip></span><div className="material-file-picker"><input accept={supportedMaterialAccept} aria-label="选择生产材料文件" className="material-file-input" key={`${sourceKind}-${fileInputKey}`} multiple onChange={(event) => selectFiles(Array.from(event.target.files ?? []))} ref={fileInputRef} type="file" /><button className="material-file-trigger" onClick={() => fileInputRef.current?.click()} type="button"><Upload className="icon" />选择材料</button><span className="material-file-name">{selectedFiles.length ? `已选择 ${selectedFiles.length} 个文件` : "未选择任何文件"}</span></div></label> : <label><span>材料类型 <HelpTip label="材料类型" >主脚本只能有一个；图片、音频和视频会分别保存，后续 Worker 会根据用途和任务依赖使用，不会自动合并成一个文件。</HelpTip></span><select aria-label="材料类型" onChange={(event) => changeMaterialType(event.target.value as MaterialType)} value={materialType}>{typeOptions.map((type) => <option key={type} value={type}>{materialTypeLabels[type]}</option>)}</select></label>}{sourceKind === "file" ? selectedFiles.length ? <div className="material-batch-list" aria-label="已选择的生产材料">{selectedFiles.map((draft) => { const draftTypeOptions = typeOptions.includes(draft.materialType) ? typeOptions : [draft.materialType, ...typeOptions]; const draftPurposeOptions = materialPurposeOptions(draft.materialType, allowMainScript || draft.isMainScript); return <article className="material-batch-item" key={draft.id}><div className="material-batch-file"><strong>{draft.file.name}</strong><span>{Math.max(1, Math.round(draft.file.size / 1024))} KB</span></div><div className="material-batch-controls"><label><span>类型</span><select aria-label={`材料类型 ${draft.file.name}`} onChange={(event) => changeDraftType(draft.id, event.target.value as MaterialType)} value={draft.materialType}>{draftTypeOptions.map((type) => <option key={type} value={type}>{materialTypeLabels[type]}</option>)}</select></label><label><span>用途</span><select aria-label={`材料用途 ${draft.file.name}`} onChange={(event) => changeDraftPurpose(draft.id, event.target.value as MaterialPurpose)} value={draft.materialPurpose}>{draftPurposeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>{allowMainScript && draft.materialType === "script" ? <label className="checkbox-label material-main-script"><input checked={draft.isMainScript} onChange={() => markDraftAsMainScript(draft.id)} type="checkbox" />设为主脚本</label> : null}</div></article>; })}</div> : <p className="muted-copy">支持一次选择多个文件；每个文件会独立保存并按用途参与后续制作。</p> : sourceKind === "paste" ? <><label><span>用途</span><select aria-label="材料用途" onChange={(event) => setMaterialPurpose(event.target.value as MaterialPurpose)} value={materialPurpose}>{materialPurposeOptions(materialType, allowMainScript).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label><label><span>来源名称 <HelpTip label="来源名称" >粘贴内容会按这个名称保存，建议使用 .md 或 .txt 后缀。</HelpTip></span><input aria-label="粘贴内容来源名称" onChange={(event) => setSourcePath(event.target.value)} placeholder="pasted-material.txt" value={sourcePath} /></label><label>粘贴内容<textarea aria-label="粘贴的生产材料" onChange={(event) => setPastedContent(event.target.value)} rows={7} value={pastedContent} /></label></> : <><label><span>用途</span><select aria-label="材料用途" onChange={(event) => setMaterialPurpose(event.target.value as MaterialPurpose)} value={materialPurpose}>{materialPurposeOptions(materialType, allowMainScript).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label><label><span>输入目录内路径 <HelpTip label="输入目录内路径" >填写相对于 input 目录的路径，例如 script.md 或 references/location.jpg。主脚本建议使用 .md 或 .txt。</HelpTip></span><input aria-label="输入目录文件路径" onChange={(event) => setSourcePath(event.target.value)} placeholder={materialType === "script" ? "script.md" : "references/location.jpg"} value={sourcePath} /></label></>}{sourceKind !== "file" ? allowMainScript ? <label className="checkbox-label"><input checked={isMainScript} disabled={materialType !== "script"} onChange={(event) => setIsMainScript(event.target.checked)} type="checkbox" />将此修订设为主脚本</label> : <p className="muted-copy">主脚本已确认；当前仅添加补充材料。</p> : null}{mainScriptSelected ? <label className="checkbox-label confirmation"><input checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} type="checkbox" />我已检查内容，明确确认这是本生产单的主脚本。</label> : null}<button className="button button-primary" disabled={isPending} type="submit">{isPending ? "导入中…" : sourceKind === "file" ? allowMainScript ? "导入全部材料" : "添加补充材料" : allowMainScript && isMainScript ? "确认并导入主脚本" : "导入材料"}</button>{formError ? <p className="form-error">{formError}</p> : null}</form>;
}

interface FrozenReviewContext {
  allowedTools: string[];
  artifactRelativePath: string;
  artifactSha256: string;
  budgetLimitCents: number;
  capability: string;
  contentType: string;
  model: string;
  provider: string;
  requiredArtifactTypes: string[];
  input: FrozenReviewInput;
  seriesBaseline?: { versionId: string; version: number; rules: Json };
}

type FrozenReviewInput =
  | { kind: "provided_script"; scriptSha256: string }
  | { kind: "commission"; creativeDirection: string; coreContent: string };

function parseFrozenReviewContext(snapshot: Json): FrozenReviewContext | null {
  if (!snapshot || Array.isArray(snapshot) || typeof snapshot !== "object") return null;
  const executor = snapshot.executor;
  const artifact = snapshot.artifact;
  const budget = snapshot.budget;
  const output = snapshot.output;
  const scriptRevision = snapshot.script_revision;
  const commission = snapshot.commission;
  const seriesBaseline = snapshot.series_baseline;
  if (!executor || Array.isArray(executor) || typeof executor !== "object" || !artifact || Array.isArray(artifact) || typeof artifact !== "object" || !budget || Array.isArray(budget) || typeof budget !== "object" || !output || Array.isArray(output) || typeof output !== "object") return null;
  const budgetLimitCents = budget.limit_cents;
  if (typeof snapshot.capability !== "string" || typeof artifact.relative_path !== "string" || typeof artifact.sha256 !== "string" || typeof executor.provider !== "string" || typeof executor.model !== "string" || typeof budgetLimitCents !== "number" || !Number.isInteger(budgetLimitCents) || budgetLimitCents < 0 || !Array.isArray(snapshot.allowed_tools) || snapshot.allowed_tools.some((tool) => typeof tool !== "string") || typeof output.content_type !== "string" || !Array.isArray(output.required_artifact_types) || output.required_artifact_types.some((artifactType) => typeof artifactType !== "string")) return null;
  const input: FrozenReviewInput | null = scriptRevision && !Array.isArray(scriptRevision) && typeof scriptRevision === "object" && typeof scriptRevision.sha256 === "string"
    ? { kind: "provided_script" as const, scriptSha256: scriptRevision.sha256 }
    : commission && !Array.isArray(commission) && typeof commission === "object" && typeof commission.creative_direction === "string" && typeof commission.core_content === "string"
      ? { kind: "commission" as const, creativeDirection: commission.creative_direction, coreContent: commission.core_content }
      : null;
  if (!input) return null;
  const parsedSeriesBaseline = seriesBaseline && !Array.isArray(seriesBaseline) && typeof seriesBaseline === "object" && typeof seriesBaseline.version_id === "string" && typeof seriesBaseline.version === "number" && Number.isInteger(seriesBaseline.version) && seriesBaseline.version > 0 && seriesBaseline.rules && !Array.isArray(seriesBaseline.rules) && typeof seriesBaseline.rules === "object"
    ? { versionId: seriesBaseline.version_id, version: seriesBaseline.version, rules: seriesBaseline.rules as Json }
    : undefined;
  return {
    allowedTools: snapshot.allowed_tools as string[],
    artifactRelativePath: artifact.relative_path,
    artifactSha256: artifact.sha256,
    budgetLimitCents,
    capability: snapshot.capability,
    contentType: output.content_type,
    model: executor.model,
    provider: executor.provider,
    requiredArtifactTypes: output.required_artifact_types as string[],
    input,
    ...(parsedSeriesBaseline ? { seriesBaseline: parsedSeriesBaseline } : {}),
  };
}

function TextReviewPackage({ artifact, reviewPackage }: { artifact: Artifact; reviewPackage: ReviewPackage }) {
  const context = parseFrozenReviewContext(reviewPackage.context_snapshot);
  const artifactMatchesContext = context?.artifactRelativePath === artifact.relative_path && context.artifactSha256 === artifact.sha256;
  const source = artifactMatchesContext ? localArtifactUrl(artifact.episode_id, context.artifactRelativePath, context.artifactSha256) : null;
  const contentHeading = artifact.artifact_type === "script" ? "具体脚本" : artifact.artifact_type === "visual_brief" ? "具体视觉简报" : "具体文本";

  return <section className="review-section text-review-package"><h3>可审核文本 · 修订 v{reviewPackage.revision_number}</h3><details className="detail-card-collapsible frozen-review-context" open><summary><h4>冻结审核上下文</h4></summary>{context ? <dl>{context.input.kind === "provided_script" ? <div><dt>主脚本 SHA-256</dt><dd>{context.input.scriptSha256.slice(0, 12)}…</dd></div> : <><div><dt>创作方向</dt><dd>{context.input.creativeDirection}</dd></div><div><dt>核心内容</dt><dd>{context.input.coreContent}</dd></div></>}{context.seriesBaseline ? <><div><dt>系列基准</dt><dd>系列基准 · v{context.seriesBaseline.version}</dd></div><div><dt>冻结系列规则</dt><dd><code>{JSON.stringify(context.seriesBaseline.rules)}</code></dd></div></> : null}<div><dt>能力</dt><dd>{context.capability}</dd></div><div><dt>执行器</dt><dd>{context.provider} · <span>{context.model}</span></dd></div><div><dt>预算</dt><dd>{context.budgetLimitCents} 分</dd></div><div><dt>允许工具</dt><dd>{context.allowedTools.join("、") || "无"}</dd></div><div><dt>输出契约</dt><dd>{context.contentType} · {context.requiredArtifactTypes.join("、")}</dd></div></dl> : <p className="form-error">冻结审核上下文格式无效。</p>}</details><h4>{contentHeading}</h4><TextArtifactContent source={source} /></section>;
}

function useTextArtifactContent(source: string | null) {
  const [content, setContent] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let isCurrent = true;
    async function loadText() {
      if (!source) throw new Error("文本产物路径无效。");
      const { data, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !data.session) throw new Error("需要 Owner 登录会话。");
      const response = await fetch(source, { headers: { Authorization: `Bearer ${data.session.access_token}` } });
      if (!response.ok) throw new Error("无法读取文本产物。");
      const nextContent = await response.text();
      if (isCurrent) setContent(nextContent);
    }
    setContent("");
    setError("");
    void loadText().catch((cause: unknown) => {
      if (isCurrent) setError(cause instanceof Error ? cause.message : "无法读取文本产物。");
    });
    return () => { isCurrent = false; };
  }, [source]);

  return { content, error };
}

function TextArtifactContent({ source }: { source: string | null }) {
  const { content, error } = useTextArtifactContent(source);
  return error ? <p className="form-error">{error}</p> : content ? <MarkdownPreview content={content} /> : <LoadingIndicator compact label="正在读取文本产物…" />;
}

function VisualReviewPackage({ artifact, artifacts, reviewPackage }: { artifact: Artifact; artifacts: Artifact[]; reviewPackage: ReviewPackage }) {
  const referenceGroups = artifacts.filter((candidate) => candidate.artifact_type === "visual_reference_group");
  const staticVisuals = artifacts.filter((candidate) => candidate.artifact_type === "static_visual");
  return <><TextReviewPackage artifact={artifact} reviewPackage={reviewPackage} /><section className="review-section"><h3>角色 / 地点 / 关键道具参考组</h3>{referenceGroups.length ? referenceGroups.map((candidate) => <div key={candidate.id}><TextArtifactContent source={localArtifactUrl(candidate.episode_id, candidate.relative_path, candidate.sha256)} /></div>) : <p className="form-error">视觉审核包缺少参考组。</p>}</section><section className="review-section"><h3>所需静态视觉</h3><p className="muted-copy">这是视觉方案生成的静态参考图，不是分镜。分镜会在后续“分镜生成与审核”阶段单独展示。</p><ArtifactPreview artifacts={staticVisuals} /></section></>;
}

type StoryboardShot = StoryboardShotManifest;
type StoryboardReviewData = { audioCues: StoryboardAudioCue[]; shots: StoryboardShot[] };

function parseStoryboard(source: string): StoryboardReviewData | null {
  try {
    const parsed: unknown = JSON.parse(source);
    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object" || !("version" in parsed) || parsed.version !== "storyboard/v1" || !("shots" in parsed) || !Array.isArray(parsed.shots) || parsed.shots.length === 0) return null;
    const shots: StoryboardShot[] = [];
    for (const candidate of parsed.shots) {
      if (!candidate || Array.isArray(candidate) || typeof candidate !== "object") return null;
      const { durationSeconds, id, inputBasis, productionMethod, scriptSegment, shotType, targetSpec } = candidate;
      if (typeof id !== "string" || !id.trim() || typeof scriptSegment !== "string" || !scriptSegment.trim() || typeof durationSeconds !== "number" || !Number.isFinite(durationSeconds) || durationSeconds <= 0 || (shotType !== "a_roll" && shotType !== "b_roll") || typeof productionMethod !== "string" || !productionMethod.trim() || !Array.isArray(inputBasis) || inputBasis.length === 0 || inputBasis.some((input) => !input || Array.isArray(input) || typeof input !== "object" || typeof input.relativePath !== "string" || !input.relativePath.trim() || typeof input.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(input.sha256)) || typeof targetSpec !== "string" || !targetSpec.trim()) return null;
      shots.push({ id, scriptSegment, durationSeconds, shotType, productionMethod, inputBasis: inputBasis as StoryboardShot["inputBasis"], targetSpec });
    }
    const cuesValue = "audioCues" in parsed ? parsed.audioCues : [];
    if (!Array.isArray(cuesValue)) return null;
    const audioCues: StoryboardAudioCue[] = [];
    for (const candidate of cuesValue) {
      if (!candidate || Array.isArray(candidate) || typeof candidate !== "object") return null;
      const { description, durationSeconds, id, kind, searchQuery, startSeconds } = candidate;
      if (typeof id !== "string" || !id.trim() || (kind !== "bgm" && kind !== "sfx") || typeof description !== "string" || !description.trim() || typeof searchQuery !== "string" || !searchQuery.trim() || searchQuery.length > 100 || typeof startSeconds !== "number" || !Number.isFinite(startSeconds) || startSeconds < 0 || typeof durationSeconds !== "number" || !Number.isFinite(durationSeconds) || durationSeconds <= 0) return null;
      audioCues.push({ id, kind, description, searchQuery, startSeconds, durationSeconds });
    }
    return { audioCues, shots };
  } catch {
    return null;
  }
}

function StoryboardReviewPackage({ annotations, artifact, isAnnotationPending, onCreateAnnotation, onValidationChange, reviewPackage }: { annotations: ReviewAnnotation[]; artifact: Artifact; isAnnotationPending: boolean; onCreateAnnotation: (input: StoryboardAnnotationRequest) => Promise<void>; onValidationChange: (valid: boolean) => void; reviewPackage: ReviewPackage }) {
  const source = localArtifactUrl(artifact.episode_id, artifact.relative_path, artifact.sha256);
  const { content, error } = useTextArtifactContent(source);
  const storyboard = content ? parseStoryboard(content) : null;
  useEffect(() => { onValidationChange(!error && Boolean(storyboard)); }, [error, onValidationChange, storyboard]);
  if (error) return <section className="review-section"><h3>可审核分镜 · 修订 v{reviewPackage.revision_number}</h3><p className="form-error">{error}</p></section>;
  if (!content) return <section className="review-section"><h3>可审核分镜 · 修订 v{reviewPackage.revision_number}</h3><LoadingIndicator compact label="正在读取分镜产物…" /></section>;
  if (!storyboard) return <section className="review-section"><h3>可审核分镜 · 修订 v{reviewPackage.revision_number}</h3><p className="form-error">分镜产物格式无效，无法审核。</p></section>;
  return <section className="review-section storyboard-review-package"><h3>可审核分镜 · 修订 v{reviewPackage.revision_number}</h3>{storyboard.shots.map((shot) => {
    const shotAnnotations = annotations.filter((annotation) => annotation.shot_id === shot.id);
    return <article className="storyboard-shot" key={shot.id}><h4>{shot.id} · {shot.shotType === "a_roll" ? "A-roll" : "B-roll"}</h4><dl><div><dt>脚本片段</dt><dd>{shot.scriptSegment}</dd></div><div><dt>时长</dt><dd>{shot.durationSeconds} 秒</dd></div><div><dt>制作方法</dt><dd>{shot.productionMethod}</dd></div><div><dt>冻结输入</dt><dd>{shot.inputBasis.map((input) => `${input.relativePath} · ${input.sha256.slice(0, 12)}…`).join("、")}</dd></div><div><dt>目标规格</dt><dd>{shot.targetSpec}</dd></div></dl>{shotAnnotations.length ? <div className="storyboard-annotations"><strong>已留批注</strong>{shotAnnotations.map((annotation) => <p key={annotation.id}>{annotation.reason}</p>)}</div> : null}<StoryboardAnnotationForm isPending={isAnnotationPending} onCreateAnnotation={onCreateAnnotation} reviewPackageId={reviewPackage.id} shotId={shot.id} /></article>;
  })}{storyboard.audioCues.length ? <section className="storyboard-audio-cues"><h4>可选声轨</h4>{storyboard.audioCues.map((cue) => <p key={cue.id}><strong>{cue.kind.toUpperCase()} · {cue.id}</strong><span>{cue.startSeconds}s – {(cue.startSeconds + cue.durationSeconds).toFixed(3)}s · {cue.description}</span><small>Freesound 检索词：{cue.searchQuery}</small></p>)}</section> : null}</section>;
}

function StoryboardAnnotationForm({ isPending, onCreateAnnotation, reviewPackageId, shotId }: { isPending: boolean; onCreateAnnotation: (input: StoryboardAnnotationRequest) => Promise<void>; reviewPackageId: string; shotId: string }) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedReason = reason.trim();
    if (!trimmedReason) {
      setError("请填写镜头批注。");
      return;
    }
    setError("");
    try {
      await onCreateAnnotation({ reviewPackageId, shotId, reason: trimmedReason });
      setReason("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法添加镜头批注。");
    }
  }
  return <form className="storyboard-annotation-form" onSubmit={(event) => { void submit(event); }}><label>镜头批注<textarea aria-label={`${shotId} 镜头批注`} onChange={(event) => setReason(event.target.value)} rows={2} value={reason} /></label>{error ? <p className="form-error">{error}</p> : null}<button className="button button-secondary" disabled={isPending} type="submit">添加镜头批注</button></form>;
}

function ArtifactPreview({ artifacts }: { artifacts: Artifact[] }) {
  const previewableArtifacts = artifacts.filter((candidate) => artifactPreviewKind(candidate.relative_path));
  const [selectedArtifactId, setSelectedArtifactId] = useState(previewableArtifacts[0]?.id ?? "");
  const artifact = previewableArtifacts.find((candidate) => candidate.id === selectedArtifactId) ?? previewableArtifacts[0];
  const kind = artifact && artifactPreviewKind(artifact.relative_path);
  const source = artifact ? localArtifactUrl(artifact.episode_id, artifact.relative_path) : null;
  if (!artifact || !kind || !source) return <div className="no-media-preview"><Icon name="Play" /><strong>暂无可预览产物</strong><span>图片和视频产物可在本机审核台预览；其他产物仍保留相对路径、哈希和元数据。</span></div>;
  return <div className="artifact-preview">{previewableArtifacts.length > 1 ? <label>预览产物<select aria-label="预览产物" onChange={(event) => setSelectedArtifactId(event.target.value)} value={artifact.id}>{previewableArtifacts.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.artifact_type} · {candidate.relative_path}</option>)}</select></label> : null}<LocalArtifactMedia artifact={artifact} kind={kind} source={source} /></div>;
}

function ArtifactPreviewMedia({ kind, label, source }: { kind: "image" | "video" | "audio"; label: string; source: string }) {
  if (kind === "image") return <img alt={label} src={source} />;
  if (kind === "audio") return <audio aria-label={label} controls preload="metadata" src={source} />;
  return <video aria-label={label} controls preload="metadata" src={source} />;
}

function LocalArtifactMedia({ artifact, kind, source }: { artifact: Artifact; kind: "image" | "video" | "audio"; source: string }) {
  const { error, url: previewUrl } = useLocalArtifactBlob(source);
  const [isExpanded, setIsExpanded] = useState(false);
  const lightboxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setIsExpanded(false);
  }, [artifact.id]);

  useEffect(() => {
    if (!isExpanded) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusableElements = () => Array.from(lightboxRef.current?.querySelectorAll<HTMLElement>("button, video") ?? []);
    const firstFocusableElement = focusableElements()[0];
    firstFocusableElement?.focus();

    function manageLightboxFocus(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setIsExpanded(false);
        return;
      }
      if (event.key !== "Tab") return;
      const elements = focusableElements();
      if (!elements.length) return;
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (!lightboxRef.current?.contains(document.activeElement) || (event.shiftKey && document.activeElement === first)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    window.addEventListener("keydown", manageLightboxFocus);
    return () => {
      window.removeEventListener("keydown", manageLightboxFocus);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [isExpanded]);

  if (error) return <div className="no-media-preview"><Icon name="Play" /><strong>无法预览产物</strong><span>{error}</span></div>;
  if (!previewUrl) return <div className="no-media-preview"><LoadingIndicator label="正在加载产物预览" /><span>本机审核台正在验证 Owner 权限与产物索引。</span></div>;
  const previewLabel = `${artifact.artifact_type} 产物预览`;
  const expandedLabel = `${artifact.artifact_type} 产物放大预览`;
  return <><figure className="local-artifact-preview"><ArtifactPreviewMedia kind={kind} label={previewLabel} source={previewUrl} /><button aria-label={`放大查看 ${artifact.artifact_type} 产物`} className="artifact-expand-button" onClick={() => setIsExpanded(true)} type="button">放大查看</button><figcaption>{artifact.artifact_type} · {artifact.relative_path}</figcaption></figure>{isExpanded ? <div aria-label={expandedLabel} aria-modal="true" className="artifact-lightbox" onMouseDown={(event) => { if (event.target === event.currentTarget) setIsExpanded(false); }} ref={lightboxRef} role="dialog"><div className="artifact-lightbox-content"><button aria-label="关闭放大预览" className="artifact-lightbox-close" onClick={() => setIsExpanded(false)} type="button">关闭</button><ArtifactPreviewMedia kind={kind} label={expandedLabel} source={previewUrl} /></div></div> : null}</>;
}

function ReviewActions({ episode, initialReviewRenderAdjustments, isPending, onRequestReviewRenderRevision, onTransition, ownerId, reviewAction, reviewPackageId }: { episode: Episode; initialReviewRenderAdjustments: ReviewRenderAdjustmentDraft; isPending: boolean; onRequestReviewRenderRevision: (input: ReviewRenderRevisionRequest) => Promise<boolean>; onTransition: (episodeId: string, toStage: EpisodeStage, reason: string) => Promise<boolean>; ownerId: string; reviewAction: ReviewAction; reviewPackageId: string | null }) {
  const [draft, setDraft] = useState(() => readOperationDraft<ReviewDecisionDraft>(ownerId, episode.id, "review-decision"));
  const [reason, setReason] = useState(draft?.reason ?? "");
  const [error, setError] = useState("");
  const [captionStyle, setCaptionStyle] = useState<ReviewRenderAdjustmentDraft["captionStyle"]>(draft?.captionStyle ?? initialReviewRenderAdjustments.captionStyle);
  const [pacing, setPacing] = useState<ReviewRenderAdjustmentDraft["pacing"]>(draft?.pacing ?? initialReviewRenderAdjustments.pacing);
  const [crop, setCrop] = useState<ReviewRenderAdjustmentDraft["crop"]>(draft?.crop ?? initialReviewRenderAdjustments.crop);
  const [transitionStyle, setTransitionStyle] = useState<ReviewRenderAdjustmentDraft["transition"]>(draft?.transition ?? initialReviewRenderAdjustments.transition);
  const [layout, setLayout] = useState<ReviewRenderAdjustmentDraft["layout"]>(draft?.layout ?? initialReviewRenderAdjustments.layout);
  const isReviewRenderRevision = episode.stage === "qc_review" && reviewAction.requestChangesStage === "render_ready";

  useEffect(() => {
    const next = readOperationDraft<ReviewDecisionDraft>(ownerId, episode.id, "review-decision");
    setDraft(next);
    setReason(next?.reason ?? "");
    setCaptionStyle(next?.captionStyle ?? initialReviewRenderAdjustments.captionStyle);
    setPacing(next?.pacing ?? initialReviewRenderAdjustments.pacing);
    setCrop(next?.crop ?? initialReviewRenderAdjustments.crop);
    setTransitionStyle(next?.transition ?? initialReviewRenderAdjustments.transition);
    setLayout(next?.layout ?? initialReviewRenderAdjustments.layout);
    setError("");
  }, [episode.id, initialReviewRenderAdjustments, ownerId, reviewPackageId]);

  function saveDraft(next: ReviewDecisionDraft) { if (next.reason.trim() || isReviewRenderRevision) { writeOperationDraft(ownerId, episode.id, "review-decision", next); setDraft(next); } else { clearOperationDraft(ownerId, episode.id, "review-decision"); setDraft(null); } }
  function currentDraft(next: Partial<ReviewDecisionDraft> = {}): ReviewDecisionDraft { return { reason, captionStyle, pacing, crop, transition: transitionStyle, layout, ...next }; }
  function changeReason(nextReason: string) { setReason(nextReason); saveDraft(currentDraft({ reason: nextReason })); }
  function changeAdjustments(next: Partial<ReviewRenderAdjustmentDraft>) { if (next.captionStyle) setCaptionStyle(next.captionStyle); if (next.pacing) setPacing(next.pacing); if (next.crop) setCrop(next.crop); if (next.transition) setTransitionStyle(next.transition); if (next.layout) setLayout(next.layout); saveDraft(currentDraft(next)); }
  function clearDraft() { clearOperationDraft(ownerId, episode.id, "review-decision"); setDraft(null); setReason(""); setCaptionStyle(initialReviewRenderAdjustments.captionStyle); setPacing(initialReviewRenderAdjustments.pacing); setCrop(initialReviewRenderAdjustments.crop); setTransitionStyle(initialReviewRenderAdjustments.transition); setLayout(initialReviewRenderAdjustments.layout); }

  async function transition(toStage: EpisodeStage) {
    const trimmedReason = reason.trim();
    if (!trimmedReason) {
      setError("请填写审批理由。");
      return;
    }
    if (isReviewRenderRevision && toStage === "render_ready") {
      if (!reviewPackageId) { setError("当前审核渲染包不存在，无法提交调整。"); return; }
      setError("");
      if (await onRequestReviewRenderRevision({ reviewPackageId, captionStyle, pacing, crop, transition: transitionStyle, layout, reason: trimmedReason })) clearDraft();
      return;
    }
    setError("");
    if (await onTransition(episode.id, toStage, trimmedReason)) clearDraft();
  }

  return <section className="review-section review-decision"><h3>Owner 审批</h3>{isReviewRenderRevision ? <fieldset className="composition-adjustments"><legend>仅调整合成层</legend><p className="muted-copy">会生成新的 HyperFrames 工程与审核渲染；已批准的镜头媒体和音轨不会重新生成或重新审批。</p><label>字幕风格<select aria-label="字幕风格" onChange={(event) => changeAdjustments({ captionStyle: event.target.value as ReviewRenderAdjustmentDraft["captionStyle"] })} value={captionStyle}><option value="cinematic">电影感</option><option value="minimal">极简</option></select></label><label>镜头动效节奏<select aria-label="合成节奏" onChange={(event) => changeAdjustments({ pacing: event.target.value as ReviewRenderAdjustmentDraft["pacing"] })} value={pacing}><option value="gentle">舒缓</option><option value="standard">标准</option><option value="compact">紧凑</option></select></label><label>裁切<select aria-label="画面裁切" onChange={(event) => changeAdjustments({ crop: event.target.value as ReviewRenderAdjustmentDraft["crop"] })} value={crop}><option value="cover">铺满</option><option value="contain">完整显示</option></select></label><label>转场<select aria-label="镜头转场" onChange={(event) => changeAdjustments({ transition: event.target.value as ReviewRenderAdjustmentDraft["transition"] })} value={transitionStyle}><option value="fade">柔和淡入淡出</option><option value="cut">直接切换</option></select></label><label>字幕布局<select aria-label="字幕布局" onChange={(event) => changeAdjustments({ layout: event.target.value as ReviewRenderAdjustmentDraft["layout"] })} value={layout}><option value="lower_third">下方字幕</option><option value="center">居中字幕</option></select></label></fieldset> : null}<label>{isReviewRenderRevision ? "调整原因" : "审批理由"}<textarea aria-label={isReviewRenderRevision ? "调整原因" : "审批理由"} onChange={(event) => changeReason(event.target.value)} placeholder={isReviewRenderRevision ? "说明本次合成调整的原因" : "说明批准或要求修改的原因"} rows={3} value={reason} /></label>{draft ? <OperationDraftNotice onClear={clearDraft} /> : null}{error ? <p className="form-error">{error}</p> : null}<div className="review-actions"><button className="button button-primary" disabled={isPending} onClick={() => void transition(reviewAction.approveStage)} type="button">批准</button><button className="button button-secondary" disabled={isPending} onClick={() => void transition(reviewAction.requestChangesStage)} type="button">{isReviewRenderRevision ? "按此配置重渲染" : "要求修改"}</button></div></section>;
}

function OperationDraftNotice({ isRestored = false, onClear }: { isRestored?: boolean; onClear: () => void }) { return <div className="operation-draft-notice" role="status"><span>{isRestored ? "已恢复本地草稿" : "本地草稿已保存"}</span><button className="text-button" onClick={onClear} type="button">清除草稿</button></div>; }

export function EpisodeDetailDrawer({ children, isOpen, onClose }: { children: ReactNode; isOpen: boolean; onClose: () => void }) {
  useEffect(() => { if (!isOpen) return; function closeOnEscape(event: KeyboardEvent) { if (event.key === "Escape") onClose(); } window.addEventListener("keydown", closeOnEscape); return () => window.removeEventListener("keydown", closeOnEscape); }, [isOpen, onClose]);
  if (!isOpen) return null;
  return <><div aria-hidden="true" className="episode-detail-scrim" data-testid="episode-detail-scrim" onClick={onClose} /><aside aria-label="当前生产单详情" className="episode-detail-drawer" role="complementary"><button aria-label="关闭生产单详情" className="drawer-close icon-button" onClick={onClose} type="button"><Icon name="Close" /></button>{children}</aside></>;
}

function Artifact({ complete = false, label, name }: { complete?: boolean; label: string; name: string }) { return <div className="artifact-row"><i className={complete ? "artifact-complete" : "artifact-pending"}>{complete ? "✓" : ""}</i><span>{label}</span><small>{name}</small></div>; }

function EpisodeForm({ accounts, isPending, onClose, onSubmit, series, seriesVersions }: { accounts: Account[]; isPending: boolean; onClose: () => void; onSubmit: (input: { title: string; accountId: string; isTest: boolean; seriesVersionId: string | null }) => Promise<void>; series: Series[]; seriesVersions: SeriesVersion[] }) {
  const [title, setTitle] = useState("");
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [isTest, setIsTest] = useState(false);
  const [seriesVersionId, setSeriesVersionId] = useState("");
  const seriesById = new Map(series.map((candidate) => [candidate.id, candidate]));
  const availableVersions = seriesVersions.filter((version) => version.account_id === accountId);
  const selectedAccount = accounts.find((account) => account.id === accountId);
  const canCreateEpisode = Boolean(selectedAccount?.current_blueprint_version_id);
  return <div className="modal-backdrop" role="presentation"><form aria-label="新建生产单" className="modal-card" onSubmit={(event) => { event.preventDefault(); if (!canCreateEpisode) return; void onSubmit({ accountId, isTest, seriesVersionId: seriesVersionId || null, title }); }}><header><div><h2>新建生产单</h2><p>会固定所选账号当前激活蓝图和可选系列版本。</p></div><button aria-label="关闭新建生产单" className="icon-button" onClick={onClose} type="button"><Icon name="Close" /></button></header><label>账号<select onChange={(event) => { setAccountId(event.target.value); setSeriesVersionId(""); }} value={accountId}>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label><label>系列版本（可选）<select aria-label="系列版本" onChange={(event) => setSeriesVersionId(event.target.value)} value={seriesVersionId}><option value="">不关联系列</option>{availableVersions.map((version) => <option key={version.id} value={version.id}>{seriesById.get(version.series_id)?.name ?? "未知系列"} · v{version.version}</option>)}</select></label><label>工作标题（可留空）<input autoFocus onChange={(event) => setTitle(event.target.value)} placeholder="可在首次适用审核前补充" value={title} /></label><label className="checkbox-label"><input checked={isTest} onChange={(event) => setIsTest(event.target.checked)} type="checkbox" />这是测试生产单（归档后允许 Owner 永久删除）</label>{canCreateEpisode ? <p className="form-hint">标题只是管理元数据，后续修改不会使已导入内容失效。</p> : <p className="form-error">当前账号没有启用蓝图，请先激活一个蓝图版本。</p>}<div className="modal-actions"><button className="button button-secondary" onClick={onClose} type="button">取消</button><button className="button button-primary" disabled={isPending || !accountId || !canCreateEpisode} type="submit">{isPending ? "创建中…" : "创建生产单"}</button></div></form></div>;
}

function AccountForm({ isPending, onClose, onSubmit }: { isPending: boolean; onClose: () => void; onSubmit: (input: { name: string; slug: string; timezone: string; policy: Json }) => Promise<void> }) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [timezone, setTimezone] = useState("Asia/Shanghai");
  const [positioning, setPositioning] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await onSubmit({ name, slug, timezone, policy: { ...defaultBlueprintPolicy, positioning: positioning.trim() } });
  }

  return <div className="modal-backdrop" role="presentation"><form aria-label="新建账号" className="modal-card" onSubmit={submit}><header><div><h2>新建账号</h2><p>将创建独立的蓝图 v1；执行器、审批和资产目录使用默认配置，开始生产前可在蓝图中调整。</p></div><button aria-label="关闭新建账号" className="icon-button" onClick={onClose} type="button"><Icon name="Close" /></button></header><label>账号名称<input autoFocus onChange={(event) => setName(event.target.value)} placeholder="例如：道工作室 2" required value={name} /></label><label>账号标识<input onChange={(event) => setSlug(event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))} pattern="[a-z0-9]+(?:-[a-z0-9]+)*" placeholder="dao-studio-2" required value={slug} /></label><label>账号定位<textarea aria-label="账号定位" onChange={(event) => setPositioning(event.target.value)} placeholder="可稍后在蓝图中补充" rows={3} value={positioning} /></label><TimezoneSelect onChange={setTimezone} value={timezone} /><p className="form-hint">选择账号日常运营和任务时间所使用的时区。</p><div className="modal-actions"><button className="button button-secondary" onClick={onClose} type="button">取消</button><button className="button button-primary" disabled={isPending} type="submit">{isPending ? "创建中…" : "创建账号"}</button></div></form></div>;
}

function AccountRenameModal({ account, isPending, onClose, onSave }: { account: Account; isPending: boolean; onClose: () => void; onSave: (name: string) => Promise<boolean | void> }) {
  const [name, setName] = useState(account.name);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const saved = await onSave(name.trim());
    if (saved !== false) onClose();
  }
  return <div className="modal-backdrop" role="presentation"><form aria-label="重命名账号" className="modal-card" onSubmit={(event) => void submit(event)}><header><div><h2>重命名账号</h2><p>只修改页面显示名称，账号标识和已有生产数据不变。</p></div><button aria-label="关闭重命名账号" className="icon-button" onClick={onClose} type="button"><Icon name="Close" /></button></header><label>显示名称<input aria-label="账号显示名称" autoFocus onChange={(event) => setName(event.target.value)} required value={name} /></label><div className="modal-actions"><button className="button button-secondary" onClick={onClose} type="button">取消</button><button className="button button-primary" disabled={isPending || name.trim() === account.name} type="submit">{isPending ? "保存中…" : "保存名称"}</button></div></form></div>;
}

function AccountDeleteModal({ account, accountEpisodeCount, isPending, onClose, onDelete }: { account: Account; accountEpisodeCount: number; isPending: boolean; onClose: () => void; onDelete: (confirmation: string) => Promise<boolean | void> }) {
  const [confirmation, setConfirmation] = useState("");
  const confirmationTarget = account.name.trim() || "DELETE";
  const canDelete = accountEpisodeCount === 0;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canDelete || confirmation !== confirmationTarget) return;
    const deleted = await onDelete(confirmation);
    if (deleted !== false) onClose();
  }
  return <div className="modal-backdrop" role="presentation"><form aria-label="删除账号" className="modal-card modal-card-danger" onSubmit={(event) => void submit(event)}><header><div><h2>删除账号</h2><p>此操作不可恢复，会删除该账号的蓝图、系列和账号配置。</p></div><button aria-label="关闭删除账号" className="icon-button" onClick={onClose} type="button"><Icon name="Close" /></button></header>{canDelete ? <p>请输入账号名称 <strong>{confirmationTarget}</strong> 以确认删除。</p> : <p className="form-error">该账号有 {accountEpisodeCount} 个生产单，当前不能删除。</p>}<label>输入确认文本：<input aria-label="删除账号确认文本" autoFocus onChange={(event) => setConfirmation(event.target.value)} placeholder={confirmationTarget} value={confirmation} /></label><div className="modal-actions"><button className="button button-secondary" onClick={onClose} type="button">取消</button><button className="button button-danger" disabled={isPending || !canDelete || confirmation !== confirmationTarget} type="submit">{isPending ? "删除中…" : "确认删除账号"}</button></div></form></div>;
}

function PasswordForm({ isPending, onClose, onSubmit }: { isPending: boolean; onClose: () => void; onSubmit: (password: string) => Promise<void> }) {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [formError, setFormError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (password.length < 12) {
      setFormError("请设置至少 12 位的登录密码。");
      return;
    }
    if (password !== confirmation) {
      setFormError("两次输入的密码不一致。");
      return;
    }
    setFormError("");
    await onSubmit(password);
  }

  return <div className="modal-backdrop" role="presentation"><form aria-label="设置登录密码" className="modal-card" onSubmit={submit}><header><div><h2>设置登录密码</h2><p>密码只用于登录，不会显示或保存在控制台记录中。</p></div><button aria-label="关闭设置登录密码" className="icon-button" onClick={onClose} type="button"><Icon name="Close" /></button></header><label>新密码<input aria-label="新密码" autoComplete="new-password" autoFocus onChange={(event) => setPassword(event.target.value)} required type="password" value={password} /></label><label>确认密码<input aria-label="确认密码" autoComplete="new-password" onChange={(event) => setConfirmation(event.target.value)} required type="password" value={confirmation} /></label><div className="modal-actions"><button className="button button-secondary" onClick={onClose} type="button">取消</button><button className="button button-primary" disabled={isPending} type="submit">{isPending ? "保存中…" : "保存密码"}</button></div>{formError ? <p className="form-error">{formError}</p> : null}</form></div>;
}

type IconName = NavigationItem | "Moon" | "Sun" | "Exit" | "Close" | "Play" | "PanelLeft" | "User" | "Edit" | "Delete";

const iconComponents: Record<IconName, LucideIcon> = { accounts: Users, episodes: Table2, operations: BarChart3, reviews: MessageSquare, publish: Upload, learning: BookOpen, Moon, Sun, Exit: LogOut, Close: X, Play, PanelLeft, User, Edit: Pencil, Delete: Trash2 };

function Icon({ name }: { name: IconName }) {
  const IconComponent = iconComponents[name];
  return <IconComponent aria-hidden="true" className="icon" strokeWidth={1.8} />;
}
