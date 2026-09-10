import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { BarChart3, BookOpen, ClipboardList, Copy, Download, Ellipsis, FileText, Film, FolderOpen, GripVertical, History, ImageIcon, LogOut, MessageSquare, Moon, PanelLeft, Pencil, Play, RefreshCw, ShieldAlert, ShieldCheck, Sun, Table2, Trash2, Upload, User, Users, Video, Volume2, X, type LucideIcon } from "lucide-react";
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
import { artifactPreviewKind, clearLocalArtifactCache, localArtifactThumbnailUrl, localArtifactUrl, useLocalArtifactBlob, useLocalArtifactText } from "./reviews/localArtifactPreview";
import { defaultReviewRenderComposition, defaultReviewRenderDurationSettings, recoverFinalReviewRender, requestReviewRevision, requestShotStructureRevision, reviewRenderCompositionFromJson, reviewRenderDurationSettingsFromRules, submitStudioReviewRevision, type OpenChatCutStudioWorkspace, type ReviewRevisionOutcome, type ReviewRevisionRequest, type ReviewRenderComposition, type ReviewRenderDurationSettings, type ShotStructureRevisionRequest, type StudioReviewRevisionRequest } from "./reviews/reviewRevision";
import { WorkerBlockerCard } from "./reviews/WorkerBlockerCard";
import { parseWorkerPreflight, type StoryboardAudioCue, type StoryboardShotManifest, type WorkerPreflightResult } from "./worker/contracts";
import type { StoryboardStructureOperation } from "./worker/storyboardRevision";
import { boundManualClipSelection, boundManualMaterialRevisionId, manualMaterialChecklistForStoryboard } from "./worker/manualMaterialChecklist";
import { accountIdentityColor, accountIdentityInitials } from "./platform/accountIdentity";
import { PaginationControls } from "./ui/PaginationControls";
import { useDialogFocus } from "./ui/useDialogFocus";
import { TaskTimelineDetail, taskTypeLabel } from "./observability/TaskProgressPanel";
import { SystemStatusPanel, type GoldenProductionTestReport, type LocalSystemStatusReport } from "./observability/SystemStatusPanel";
import { MarkdownPreview } from "./ui/MarkdownPreview";
import { canonicalMaterialName, materialPurposeLabel, materialPurposeOptions, materialTypeForFile, type MaterialPurpose, type MaterialType } from "./reviews/materialImport";
import { materialImportDraftStorageAvailable, readMaterialImportDrafts, writeMaterialImportDrafts } from "./reviews/materialImportDraftStore";

import { AccountWorkspace } from "./accounts/AccountWorkspace";
import type { ExternalConnectionInput, ExternalConnectionVersion } from "./connections/ConnectionWorkspace";
import { blueprintPolicyToForm, mediaAdapterConfiguration, mediaAdapterStatus, type MediaAdapterKey } from "./platform/configurationFormValues";
import { Range } from "react-range";
import { adapterRegistration } from "./worker/adapterRegistry";
import { createShotDurationDecision, durationToleranceSeconds, type ShotDurationDecision } from "./worker/durationDecision";

export { AccountWorkspace, SeriesSettings } from "./accounts/AccountWorkspace";


type NavigationItem = "accounts" | "episodes" | "operations" | "reviews" | "publish" | "learning";
type Theme = "light" | "dark";
type Account = Database["public"]["Tables"]["accounts"]["Row"];
type Blueprint = Database["public"]["Tables"]["account_blueprint_versions"]["Row"];
type Episode = Database["public"]["Tables"]["episodes"]["Row"];
type Series = Database["public"]["Tables"]["series"]["Row"];
type SeriesVersion = Database["public"]["Tables"]["series_versions"]["Row"];
type PromptVersion = Database["public"]["Tables"]["prompt_versions"]["Row"];
type MaterialRevision = Database["public"]["Tables"]["production_material_revisions"]["Row"];
type ShotPreparationDraft = Database["public"]["Tables"]["shot_preparation_drafts"]["Row"];
type StoryboardAudioSelection = Database["public"]["Tables"]["storyboard_audio_selections"]["Row"];
type PreRenderMemberDecision = Database["public"]["Tables"]["pre_render_review_member_decisions"]["Row"];
type ReviewPackage = Database["public"]["Tables"]["review_packages"]["Row"];
type ReviewAnnotation = Database["public"]["Tables"]["review_annotations"]["Row"];
type QcReviewIssue = Database["public"]["Tables"]["qc_review_issues"]["Row"];
type QcReviewIssues = QcReviewIssue;
type Artifact = Database["public"]["Tables"]["artifacts"]["Row"];
type AudioTrack = Database["public"]["Tables"]["audio_tracks"]["Row"];
type AudioTrackAnnotation = Database["public"]["Tables"]["audio_track_annotations"]["Row"];
type PreRenderReviewMember = Database["public"]["Tables"]["pre_render_review_members"]["Row"];
type PreRenderReviewMemberDecision = Database["public"]["Tables"]["pre_render_review_member_decisions"]["Row"];
type Task = Database["public"]["Tables"]["tasks"]["Row"];
type TaskRun = Pick<Database["public"]["Tables"]["task_runs"]["Row"], "attempt" | "completed_at" | "id" | "started_at" | "status" | "task_id">;
type TaskStatusProbe = Pick<Task, "attempt" | "completed_at" | "episode_id" | "id" | "last_result" | "status">;
type TaskRunStatus = TaskRun;
type Transition = Database["public"]["Tables"]["state_transitions"]["Row"];
type Experiment = Database["public"]["Tables"]["experiments"]["Row"];
type LearningReport = Database["public"]["Tables"]["learning_reports"]["Row"];
type MetricSnapshot = Database["public"]["Tables"]["metric_snapshots"]["Row"];
type BlueprintChangeSuggestion = Database["public"]["Tables"]["blueprint_change_suggestions"]["Row"];
type PublicationRecord = Database["public"]["Tables"]["publication_records"]["Row"];
type ExternalConnection = Database["public"]["Tables"]["external_connections"]["Row"];

interface BlueprintRepairContext {
  blocker: WorkerBlocker;
  blueprintVersionId: string;
  episodeId: string;
}

type EpisodeVisibility = "active" | "archived" | "all";
type EpisodeAction = "rename" | "archive" | "delete" | null;
type EpisodeCreationStep = "idle" | "preflight" | "create" | "directory" | "refresh";
type EpisodeWithArchive = Episode & { archived_at?: string | null };

interface ReviewAction {
  approveStage: EpisodeStage;
  requestChangesStage: EpisodeStage;
}

type ReviewDecisionDraft = { reason: string };

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

export function messageFromError(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : error && typeof error === "object" && "message" in error && typeof error.message === "string" ? error.message : fallback;
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
  deferRefresh?: boolean;
  episodeId: string;
  sourceKind: "file";
  sourcePath: string;
  logicalName?: string;
  content?: Uint8Array;
  materialType: string;
  materialPurpose: MaterialPurpose;
  mimeType: string;
  isMainScript: boolean;
}

type MaterialImportHandler = (input: MaterialImportRequest) => Promise<string | null | void>;

interface StoryboardAnnotationRequest {
  reviewPackageId: string;
  shotId: string;
  reason: string;
}

interface ShotClipSegmentRequest {
  end_seconds: number;
  start_seconds: number;
}

interface ShotPreparationDraftRequest {
  audioMode: ShotPreparationDraft["audio_mode"];
  clipSegments: ShotClipSegmentRequest[];
  episodeId: string;
  includeVideo: boolean;
  reviewPackageId: string;
  shotId: string;
  materialRevisionId: string;
  subtitleText: string;
  subtitlesEnabled: boolean;
  ttsSpeakingRate: number | null;
  ttsText: string | null;
  ttsOverride?: { speakingRate: number | null; voice: string | null };
  ttsVoice: string | null;
}

interface StoryboardAudioSelectionRequest {
  audioKind: StoryboardAudioSelection["audio_kind"];
  cueId: string | null;
  episodeId: string;
  materialRevisionId?: string | null;
  reviewPackageId: string;
  targetId: string;
  targetKind: StoryboardAudioSelection["target_kind"];
}

interface EpisodeTtsSettings {
  languageCode: string;
  speakingRate: string;
  voice: string;
}

interface ShotTtsGenerationRequest {
  episodeId: string;
  retry?: boolean;
  reviewPackageId: string;
  shotId: string;
}

interface ShotReviewVideoRequest {
  acceptDurationRisk: boolean;
  allowedFrames: number;
  episodeId: string;
  frameRate: number;
  reviewPackageId: string;
  riskReason: string | null;
  storyboardRelativePath: string;
  workspaceRelativePath: string;
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

interface QcReviewIssueRequest {
  reviewPackageId: string;
  memberKey: string | null;
  atSeconds: number;
  severity: "blocking" | "warning";
  reason: string;
}

type ManualMediaKind = "a_roll" | "b_roll" | "narration" | "bgm" | "sfx";
interface ManualMediaBindingRequest {
  clipEndSeconds?: number;
  clipStartSeconds?: number;
  episodeId: string;
  kind: ManualMediaKind;
  materialRevisionId: string;
  replace?: boolean;
  storyboardReviewPackageId: string;
  targetId: string;
}

interface Workspace {
  accounts: Account[];
  blueprints: Blueprint[];
  episodes: Episode[];
  series: Series[];
  seriesVersions: SeriesVersion[];
  promptVersions: PromptVersion[];
  materialRevisions: MaterialRevision[];
  shotPreparationDrafts: ShotPreparationDraft[];
  storyboardAudioSelections: StoryboardAudioSelection[];
  reviewPackages: ReviewPackage[];
  reviewAnnotations: ReviewAnnotation[];
  qcReviewIssues: QcReviewIssue[];
  artifacts: Artifact[];
  audioTracks: AudioTrack[];
  audioTrackAnnotations: AudioTrackAnnotation[];
  preRenderReviewMembers: PreRenderReviewMember[];
  preRenderReviewMemberDecisions: PreRenderReviewMemberDecision[];
  tasks: Task[];
  taskRuns: TaskRunStatus[];
  transitions: Transition[];
  experiments: Experiment[];
  learningReports: LearningReport[];
  metricSnapshots: MetricSnapshot[];
  blueprintChangeSuggestions: BlueprintChangeSuggestion[];
  publicationRecords: PublicationRecord[];
  externalConnections: ExternalConnection[];
  externalConnectionVersions: ExternalConnectionVersion[];
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
  return <>{navigation.map((item) => <button aria-current={activeNavigation === item.id ? "page" : undefined} aria-label={item.label} className={`navigation-item ${activeNavigation === item.id ? "is-active" : ""}`} key={item.id} onClick={() => onSelect(item.id)} type="button"><Icon name={item.id} /><span className="navigation-label">{item.label}</span>{badges[item.id] ? <span aria-label={`${badges[item.id]} 个待处理`} className="navigation-badge">{badges[item.id]}</span> : null}</button>)}</>;
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
  script_approved: "视觉素材准备与审核",
  visual_draft: "视觉素材准备与审核",
  visual_review: "视觉素材准备与审核",
  visual_approved: "视觉素材准备与审核",
  storyboard_draft: "分镜生成与审核",
  storyboard_review: "分镜生成与审核",
  storyboard_approved: "逐镜头准备工作台",
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
  "Orchestrator froze the first visual planning task from the confirmed main script.": "编排器已根据确认的主脚本冻结视觉素材准备任务。",
  "Orchestrator froze visual asset preparation from the approved script.": "编排器已根据确认的主脚本冻结视觉素材准备任务。",
  "Worker submitted a frozen visual planning review package.": "Worker 已提交冻结的视觉素材清单，等待审核。",
  "OpenChatCut deterministic review render completed.": "OpenChatCut 已完成确定性的审核渲染。",
};

const nextStepLabels: Partial<Record<EpisodeStage, string>> = {
  waiting_input: "导入主脚本",
  script_draft: "等待 Worker 生成脚本",
  script_review: "审核生成脚本",
  script_approved: "等待整理视觉素材清单",
  visual_draft: "等待 Worker 整理视觉素材清单",
  visual_review: "审核视觉素材清单",
  visual_approved: "等待生成分镜",
  storyboard_draft: "等待 Worker 生成分镜",
  storyboard_review: "审核分镜并处理镜头批注",
  storyboard_approved: "逐镜头准备画面、口播和字幕",
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
  if (/worker|orchestrator|openchatcut/i.test(trimmed)) return "后台执行结果已记录，生产单状态已更新。";
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

export function episodeWorkerStatus(episode: Pick<Episode, "stage"> & Partial<Pick<Episode, "main_script_revision_id">>, episodeTasks: Array<Pick<Task, "status" | "task_type"> & Partial<Pick<Task, "created_at">>>): EpisodeWorkerStatus {
  const stageTasks = episodeTasks.filter((task) => task.task_type !== "generate_final_render" || episode.stage === "qc_passed");
  const blockedTask = stageTasks.find((task) => task.status === "blocked");
  if (blockedTask) return { detail: `${taskTypeLabel(blockedTask.task_type)} 需要处理阻塞项。`, label: "已阻塞", tone: "blocked" };
  const runningTask = stageTasks.find((task) => task.status === "running");
  if (runningTask) return { detail: `${taskTypeLabel(runningTask.task_type)} 正在执行。`, label: "执行中", tone: "running" };
  const readyTask = stageTasks.find((task) => task.status === "ready");
  if (readyTask) return { detail: `${taskTypeLabel(readyTask.task_type)} 已排队，等待 Worker 领取。`, label: "等待 Worker", tone: "waiting" };
  if (reviewStages.has(episode.stage)) return { detail: "审核包已就绪，等待 Owner 决定。", label: "等待审核", tone: "review" };
  const latestTask = stageTasks.reduce<typeof stageTasks[number] | null>((latest, task) => !latest || (task.created_at ?? "") > (latest.created_at ?? "") ? task : latest, null);
  const failedTask = latestTask?.status === "failed" ? latestTask : null;
  if (failedTask) return { detail: `${taskTypeLabel(failedTask.task_type)} 最近执行失败。`, label: "失败", tone: "blocked" };
  if (latestTask?.status === "completed") return { detail: "最近一次 Worker 任务已完成。", label: "已完成", tone: "completed" };
  if (episode.stage === "waiting_input" && episode.main_script_revision_id) return { detail: "材料已导入，等待 Owner 确认开始制作。", label: "待开始制作", tone: "waiting" };
  if (episode.stage === "waiting_input" || episode.stage === "brief_draft") return { detail: nextStepForEpisode(episode.stage), label: "等待输入", tone: "idle" };
  return { detail: nextStepForEpisode(episode.stage), label: "等待 Worker", tone: "waiting" };
}

function formatDate(source: string) {
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(source));
}

function taskStatusSignature(task: Pick<Task, "attempt" | "completed_at" | "last_result" | "status">): string {
  return `${task.status}:${task.attempt}:${task.completed_at ?? ""}:${JSON.stringify(task.last_result)}`;
}

export function episodeNeedsTaskPolling(input: { detailOpen: boolean; dispatchRequested: boolean; hasActiveTask: boolean; pageVisible: boolean }): boolean {
  return input.detailOpen && input.pageVisible && (input.dispatchRequested || input.hasActiveTask);
}

function taskRunStatusSignature(run: TaskRunStatus): string {
  return `${run.status}:${run.attempt}:${run.completed_at ?? ""}:${run.started_at}`;
}

export function episodeTaskStatusChanged(previousTasks: Task[], nextTasks: TaskStatusProbe[], episodeId: string): boolean {
  const currentTasks = previousTasks.filter((task) => task.episode_id === episodeId);
  if (currentTasks.length !== nextTasks.length) return true;
  const currentById = new Map(currentTasks.map((task) => [task.id, task]));
  return nextTasks.some((task) => {
    const current = currentById.get(task.id);
    return !current || taskStatusSignature(task) !== taskStatusSignature(current);
  });
}

export function episodeTaskRunStatusChanged(previousRuns: TaskRunStatus[], nextRuns: TaskRunStatus[], taskIds: Set<string>): boolean {
  const currentRuns = previousRuns.filter((run) => taskIds.has(run.task_id));
  if (currentRuns.length !== nextRuns.length) return true;
  const currentById = new Map(currentRuns.map((run) => [run.id, run]));
  return nextRuns.some((run) => {
    const current = currentById.get(run.id);
    return !current || taskRunStatusSignature(run) !== taskRunStatusSignature(current);
  });
}

export function mergeEpisodeTaskStatus(previous: Pick<Workspace, "tasks" | "taskRuns">, episodeId: string, tasks: Task[], taskRuns: TaskRunStatus[]): Pick<Workspace, "tasks" | "taskRuns"> {
  const previousTaskIds = new Set(previous.tasks.filter((task) => task.episode_id === episodeId).map((task) => task.id));
  return {
    tasks: [...previous.tasks.filter((task) => task.episode_id !== episodeId), ...tasks],
    taskRuns: [...previous.taskRuns.filter((run) => !previousTaskIds.has(run.task_id)), ...taskRuns],
  };
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

function connectionVersionsForBlocker(blocker: WorkerBlocker, tasks: Task[], versions: ExternalConnectionVersion[]): ExternalConnectionVersion[] {
  const task = blocker.taskId ? tasks.find((candidate) => candidate.id === blocker.taskId) : undefined;
  const snapshot = task?.input_snapshot;
  if (!snapshot || Array.isArray(snapshot) || typeof snapshot !== "object") return [];
  const snapshotRecord = snapshot as Record<string, unknown>;
  const visualAssets = snapshotRecord.visual_assets;
  const imageGeneration = visualAssets && typeof visualAssets === "object" && !Array.isArray(visualAssets) ? (visualAssets as Record<string, unknown>).image_generation : null;
  const nestedRef = imageGeneration && typeof imageGeneration === "object" && !Array.isArray(imageGeneration) ? (imageGeneration as Record<string, unknown>).credential_ref : undefined;
  const sourceRef = typeof snapshotRecord.credential_ref === "string" ? snapshotRecord.credential_ref : typeof nestedRef === "string" ? nestedRef : null;
  if (!sourceRef) return [];
  const sourceVersion = versions.find((version) => version.id === sourceRef);
  return sourceVersion ? versions.filter((version) => version.connection_id === sourceVersion.connection_id) : [];
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

function blueprintApprovalGateEnabled(blueprint: Blueprint | undefined, gate: string): boolean {
  if (!blueprint?.policy || Array.isArray(blueprint.policy) || typeof blueprint.policy !== "object") return true;
  const gates = blueprint.policy.approval_gates;
  return Array.isArray(gates) ? gates.includes(gate) : true;
}

function reviewActionFor(stage: EpisodeStage): ReviewAction | null {
  return reviewActions[stage] ?? null;
}

function studioWorkspaceFromPayload(value: unknown): OpenChatCutStudioWorkspace {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Studio 工作区响应无效。");
  const workspace = value as Record<string, unknown>;
  if (typeof workspace.relativePath !== "string" || typeof workspace.sha256 !== "string" || typeof workspace.fileSize !== "number") throw new Error("Studio 工作区响应无效。");
  return { relativePath: workspace.relativePath, sha256: workspace.sha256, fileSize: workspace.fileSize, ...(typeof workspace.projectId === "string" ? { projectId: workspace.projectId } : {}) };
}

function reviewRenderCompositionFromTask(task: Task | undefined): ReviewRenderComposition {
  const snapshot = task?.input_snapshot;
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot) || !("review_render" in snapshot)) return defaultReviewRenderComposition;
  const reviewRender = snapshot.review_render;
  if (!reviewRender || typeof reviewRender !== "object" || Array.isArray(reviewRender) || !("adjustments" in reviewRender)) return defaultReviewRenderComposition;
  return reviewRenderCompositionFromJson(reviewRender.adjustments) ?? defaultReviewRenderComposition;
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

export async function loadWorkspaceSummary(): Promise<Workspace> {
  const [accountsResult, blueprintsResult, episodesResult, seriesResult, seriesVersionsResult] = await Promise.all([
    supabase.from("accounts").select("*").order("created_at"),
    supabase.from("account_blueprint_versions").select("*").order("version", { ascending: false }),
    supabase.from("episodes").select("*").order("updated_at", { ascending: false }),
    supabase.from("series").select("*").order("name"),
    supabase.from("series_versions").select("*").order("version", { ascending: false }),
  ]);
  const error = [accountsResult, blueprintsResult, episodesResult, seriesResult, seriesVersionsResult].map((result) => result.error).find(Boolean);
  if (error) throw error;
  return { accounts: accountsResult.data ?? [], blueprints: blueprintsResult.data ?? [], episodes: episodesResult.data ?? [], series: seriesResult.data ?? [], seriesVersions: seriesVersionsResult.data ?? [], promptVersions: [], materialRevisions: [], shotPreparationDrafts: [], storyboardAudioSelections: [], reviewPackages: [], reviewAnnotations: [], qcReviewIssues: [], artifacts: [], audioTracks: [], audioTrackAnnotations: [], preRenderReviewMembers: [], preRenderReviewMemberDecisions: [], tasks: [], taskRuns: [], transitions: [], experiments: [], learningReports: [], metricSnapshots: [], blueprintChangeSuggestions: [], publicationRecords: [], externalConnections: [], externalConnectionVersions: [] };
}

function throwResultError(results: Array<{ error: unknown }>) {
  const error = results.map((result) => result.error).find(Boolean);
  if (error) throw error;
}

function isMissingStoryboardAudioSelections(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; message?: unknown };
  return candidate.code === "42P01" || candidate.code === "PGRST205" || (typeof candidate.message === "string" && candidate.message.includes("storyboard_audio_selections"));
}

async function loadWorkspaceSection(navigation: NavigationItem): Promise<Partial<Workspace>> {
  if (navigation === "reviews") return {};
  if (navigation === "episodes") {
    const artifactsResult = await supabase.from("artifacts").select("*").order("created_at", { ascending: false });
    throwResultError([artifactsResult]);
    return { artifacts: artifactsResult.data ?? [] };
  }
  if (navigation === "operations") {
    const [reviewPackagesResult, preRenderReviewMembersResult, preRenderReviewMemberDecisionsResult, tasksResult] = await Promise.all([
      supabase.from("review_packages").select("*").order("created_at", { ascending: false }),
      supabase.from("pre_render_review_members").select("*").order("created_at"),
      supabase.from("pre_render_review_member_decisions").select("*").order("created_at"),
      supabase.from("tasks").select("*").order("created_at", { ascending: false }),
    ]);
    throwResultError([reviewPackagesResult, preRenderReviewMembersResult, preRenderReviewMemberDecisionsResult, tasksResult]);
    return { preRenderReviewMemberDecisions: preRenderReviewMemberDecisionsResult.data ?? [], preRenderReviewMembers: preRenderReviewMembersResult.data ?? [], reviewPackages: reviewPackagesResult.data ?? [], tasks: tasksResult.data ?? [] };
  }
  if (navigation === "publish") {
    const [artifactsResult, publicationRecordsResult, tasksResult] = await Promise.all([
      supabase.from("artifacts").select("*").order("created_at", { ascending: false }),
      supabase.from("publication_records").select("*").order("created_at", { ascending: false }),
      supabase.from("tasks").select("*").order("created_at", { ascending: false }),
    ]);
    throwResultError([artifactsResult, publicationRecordsResult, tasksResult]);
    return { artifacts: artifactsResult.data ?? [], publicationRecords: publicationRecordsResult.data ?? [], tasks: tasksResult.data ?? [] };
  }
  if (navigation === "learning") {
    const [experimentsResult, learningReportsResult, metricSnapshotsResult, blueprintChangeSuggestionsResult] = await Promise.all([
      supabase.from("experiments").select("*").order("created_at", { ascending: false }),
      supabase.from("learning_reports").select("*").order("created_at", { ascending: false }),
      supabase.from("metric_snapshots").select("*").order("captured_at", { ascending: false }),
      supabase.from("blueprint_change_suggestions").select("*").order("created_at", { ascending: false }),
    ]);
    throwResultError([experimentsResult, learningReportsResult, metricSnapshotsResult, blueprintChangeSuggestionsResult]);
    return { blueprintChangeSuggestions: blueprintChangeSuggestionsResult.data ?? [], experiments: experimentsResult.data ?? [], learningReports: learningReportsResult.data ?? [], metricSnapshots: metricSnapshotsResult.data ?? [] };
  }
  const [promptVersionsResult, externalConnectionsResult, externalConnectionVersionsResult] = await Promise.all([
    supabase.from("prompt_versions").select("*").order("capability").order("version", { ascending: false }),
    supabase.from("external_connections").select("*").order("created_at", { ascending: false }),
    supabase.rpc("list_external_connection_versions", { p_connection_id: null }),
  ]);
  throwResultError([promptVersionsResult, externalConnectionsResult, externalConnectionVersionsResult]);
  return { externalConnectionVersions: externalConnectionVersionsResult.data ?? [], externalConnections: externalConnectionsResult.data ?? [], promptVersions: promptVersionsResult.data ?? [] };
}

async function loadEpisodeDetail(episodeId: string): Promise<Partial<Workspace>> {
  const [materialRevisionsResult, shotPreparationDraftsResult, storyboardAudioSelectionsResult, reviewPackagesResult, artifactsResult, audioTracksResult, tasksResult, transitionsResult] = await Promise.all([
    supabase.from("production_material_revisions").select("*").eq("episode_id", episodeId).order("created_at", { ascending: false }),
    supabase.from("shot_preparation_drafts").select("*").eq("episode_id", episodeId).order("updated_at", { ascending: false }),
    supabase.from("storyboard_audio_selections").select("*").eq("episode_id", episodeId).order("updated_at", { ascending: false }),
    supabase.from("review_packages").select("*").eq("episode_id", episodeId).order("created_at", { ascending: false }),
    supabase.from("artifacts").select("*").eq("episode_id", episodeId).order("created_at", { ascending: false }),
    supabase.from("audio_tracks").select("*").eq("episode_id", episodeId).order("created_at", { ascending: false }),
    supabase.from("tasks").select("*").eq("episode_id", episodeId).order("created_at", { ascending: false }),
    supabase.from("state_transitions").select("*").eq("episode_id", episodeId).order("created_at", { ascending: false }),
  ]);
  if (storyboardAudioSelectionsResult.error && !isMissingStoryboardAudioSelections(storyboardAudioSelectionsResult.error)) throw storyboardAudioSelectionsResult.error;
  throwResultError([materialRevisionsResult, shotPreparationDraftsResult, reviewPackagesResult, artifactsResult, audioTracksResult, tasksResult, transitionsResult]);
  const reviewPackageIds = (reviewPackagesResult.data ?? []).map((reviewPackage) => reviewPackage.id);
  const audioTrackIds = (audioTracksResult.data ?? []).map((track) => track.id);
  const taskIds = (tasksResult.data ?? []).map((task) => task.id);
  const [reviewAnnotationsResult, qcReviewIssuesResult, preRenderReviewMembersResult, preRenderReviewMemberDecisionsResult, audioTrackAnnotationsResult, taskRunsResult] = await Promise.all([
    reviewPackageIds.length ? supabase.from("review_annotations").select("*").in("review_package_id", reviewPackageIds).order("created_at") : Promise.resolve({ data: [], error: null }),
    reviewPackageIds.length ? supabase.from("qc_review_issues").select("*").in("review_package_id", reviewPackageIds).order("created_at") : Promise.resolve({ data: [], error: null }),
    reviewPackageIds.length ? supabase.from("pre_render_review_members").select("*").in("review_package_id", reviewPackageIds).order("created_at") : Promise.resolve({ data: [], error: null }),
    reviewPackageIds.length ? supabase.from("pre_render_review_member_decisions").select("*").in("review_package_id", reviewPackageIds).order("created_at") : Promise.resolve({ data: [], error: null }),
    audioTrackIds.length ? supabase.from("audio_track_annotations").select("*").in("audio_track_id", audioTrackIds).order("created_at") : Promise.resolve({ data: [], error: null }),
    taskIds.length ? supabase.from("task_runs").select("id,task_id,status,attempt,started_at,completed_at").in("task_id", taskIds).order("started_at", { ascending: false }) : Promise.resolve({ data: [], error: null }),
  ]);
  throwResultError([reviewAnnotationsResult, qcReviewIssuesResult, preRenderReviewMembersResult, preRenderReviewMemberDecisionsResult, audioTrackAnnotationsResult, taskRunsResult]);
  return {
    artifacts: artifactsResult.data ?? [], audioTrackAnnotations: audioTrackAnnotationsResult.data ?? [], audioTracks: audioTracksResult.data ?? [], materialRevisions: materialRevisionsResult.data ?? [], preRenderReviewMemberDecisions: preRenderReviewMemberDecisionsResult.data ?? [], preRenderReviewMembers: preRenderReviewMembersResult.data ?? [], qcReviewIssues: qcReviewIssuesResult.data ?? [], reviewAnnotations: reviewAnnotationsResult.data ?? [], reviewPackages: reviewPackagesResult.data ?? [], shotPreparationDrafts: shotPreparationDraftsResult.data ?? [], storyboardAudioSelections: storyboardAudioSelectionsResult.data ?? [], taskRuns: taskRunsResult.data ?? [], tasks: tasksResult.data ?? [], transitions: transitionsResult.data ?? [],
  };
}

function replaceEpisodeRows<T extends { episode_id: string }>(rows: T[], episodeId: string, replacement: T[]) {
  return [...rows.filter((row) => row.episode_id !== episodeId), ...replacement];
}

function mergeEpisodeDetail(workspace: Workspace, episodeId: string, detail: Partial<Workspace>): Workspace {
  const reviewPackageIds = new Set(workspace.reviewPackages.filter((reviewPackage) => reviewPackage.episode_id === episodeId).map((reviewPackage) => reviewPackage.id));
  const audioTrackIds = new Set(workspace.audioTracks.filter((track) => track.episode_id === episodeId).map((track) => track.id));
  const taskIds = new Set(workspace.tasks.filter((task) => task.episode_id === episodeId).map((task) => task.id));
  return {
    ...workspace,
    artifacts: replaceEpisodeRows(workspace.artifacts, episodeId, detail.artifacts ?? []),
    audioTrackAnnotations: [...workspace.audioTrackAnnotations.filter((annotation) => !audioTrackIds.has(annotation.audio_track_id)), ...(detail.audioTrackAnnotations ?? [])],
    audioTracks: replaceEpisodeRows(workspace.audioTracks, episodeId, detail.audioTracks ?? []),
    materialRevisions: replaceEpisodeRows(workspace.materialRevisions, episodeId, detail.materialRevisions ?? []),
    preRenderReviewMemberDecisions: [...workspace.preRenderReviewMemberDecisions.filter((decision) => !reviewPackageIds.has(decision.review_package_id)), ...(detail.preRenderReviewMemberDecisions ?? [])],
    preRenderReviewMembers: [...workspace.preRenderReviewMembers.filter((member) => !reviewPackageIds.has(member.review_package_id)), ...(detail.preRenderReviewMembers ?? [])],
    qcReviewIssues: [...workspace.qcReviewIssues.filter((issue) => !reviewPackageIds.has(issue.review_package_id)), ...(detail.qcReviewIssues ?? [])],
    reviewAnnotations: [...workspace.reviewAnnotations.filter((annotation) => !reviewPackageIds.has(annotation.review_package_id)), ...(detail.reviewAnnotations ?? [])],
    reviewPackages: replaceEpisodeRows(workspace.reviewPackages, episodeId, detail.reviewPackages ?? []),
    shotPreparationDrafts: replaceEpisodeRows(workspace.shotPreparationDrafts, episodeId, detail.shotPreparationDrafts ?? []),
    storyboardAudioSelections: replaceEpisodeRows(workspace.storyboardAudioSelections, episodeId, detail.storyboardAudioSelections ?? []),
    taskRuns: [...workspace.taskRuns.filter((run) => !taskIds.has(run.task_id)), ...(detail.taskRuns ?? [])],
    tasks: replaceEpisodeRows(workspace.tasks, episodeId, detail.tasks ?? []),
    transitions: replaceEpisodeRows(workspace.transitions, episodeId, detail.transitions ?? []),
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

async function runGoldenProductionTest(): Promise<GoldenProductionTestReport> {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  if (!data.session) throw new Error("需要 Owner 登录会话。");
  const response = await fetch("/_golden-production-test", { headers: { Authorization: `Bearer ${data.session.access_token}` }, method: "POST" });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload && typeof payload === "object" && !Array.isArray(payload) && typeof (payload as Record<string, unknown>).error === "string" ? (payload as Record<string, unknown>).error as string : "黄金生产链测试失败。");
  return payload as GoldenProductionTestReport;
}

async function startProductionThroughWorkerPreflight(episodeId: string): Promise<{ episode: unknown; preflight: WorkerPreflightResult }> {
  const { data, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw sessionError;
  if (!data.session) throw new Error("需要 Owner 登录会话。");
  const response = await fetch(`/_worker-preflight?${new URLSearchParams({ episode: episodeId }).toString()}`, { method: "POST", headers: { Authorization: `Bearer ${data.session.access_token}` } });
  const payload: unknown = await response.json().catch(() => null);
  const record = payload && typeof payload === "object" && !Array.isArray(payload) ? payload as Record<string, unknown> : {};
  const preflight = parseWorkerPreflight(record.preflight);
  if (!response.ok) {
    if (preflight.checks.some((check) => check.status !== "passed")) throw Object.assign(new Error("生产前运行态检查未通过，请先处理检查项。"), { preflight });
    throw Object.assign(new Error(typeof record.error === "string" ? record.error : "无法开始生产单制作。"), { preflight });
  }
  return { episode: record.episode, preflight };
}

async function requestImmediateTaskDispatch(episodeId: string, taskId: string): Promise<{ accepted: boolean; reason: string }> {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) return { accepted: false, reason: "Owner 登录会话不可用" };
  const response = await fetch(`/_episode-dispatch?${new URLSearchParams({ episode: episodeId, task: taskId }).toString()}`, {
    headers: { Authorization: `Bearer ${data.session.access_token}` },
    method: "POST",
  }).catch(() => null);
  if (!response) return { accepted: false, reason: "即时派发服务不可用" };
  if (!response.ok) return { accepted: false, reason: (await response.text()).trim() || "Worker 未能启动" };
  return { accepted: true, reason: "" };
}

async function runEpisodePreflight(input: { accountId: string; blueprintVersionId: string; episodeId?: string; policy?: Json; seriesVersionId: string | null }): Promise<WorkerPreflightResult> {
  const { data, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw sessionError;
  if (!data.session) throw new Error("需要 Owner 登录会话。");
  const response = await fetch("/_episode-preflight", {
    body: JSON.stringify(input),
    headers: { Authorization: `Bearer ${data.session.access_token}`, "Content-Type": "application/json" },
    method: "POST",
  });
  const payload: unknown = await response.json().catch(() => null);
  const record = payload && typeof payload === "object" && !Array.isArray(payload) ? payload as Record<string, unknown> : {};
  const preflight = record.preflight === undefined ? null : parseWorkerPreflight(record.preflight);
  if (!response.ok) {
    if (preflight?.checks.some((check) => check.status !== "passed")) return preflight;
    throw new Error(typeof record.error === "string" ? record.error : "无法完成生产前检查。");
  }
  if (!preflight) throw new Error("生产前检查未返回有效结果。");
  return preflight;
}

function workerBlockersFromPreflight(preflight: WorkerPreflightResult | null): WorkerBlocker[] {
  return preflight?.checks.filter((check) => check.status !== "passed").map((check) => ({ code: check.check, detail: check.reason, capability: check.capability, check: check.check, phase: check.phase, status: check.status, action: check.action, scope: check.scope })) ?? [];
}

function openChatCutProjectPathForEpisode(reviewPackages: ReviewPackage[], episode: Episode | null): string | null {
  if (!episode) return null;
  const reviewPackage = reviewPackages.filter((candidate) => candidate.episode_id === episode.id && candidate.stage === "qc_review" && !candidate.invalidated_at && isEditorReviewRender(candidate.context_snapshot)).reduce<ReviewPackage | null>((latest, candidate) => !latest || candidate.revision_number > latest.revision_number ? candidate : latest, null);
  const context = reviewPackage?.context_snapshot && typeof reviewPackage.context_snapshot === "object" && !Array.isArray(reviewPackage.context_snapshot) ? reviewPackage.context_snapshot as Record<string, unknown> : null;
  return context && typeof context.project_relative_path === "string" ? context.project_relative_path : null;
}

export function workerPreflightFailureMessage(preflight: WorkerPreflightResult): string {
  const blockers = workerBlockersFromPreflight(preflight);
  return blockers.length ? `修复前真实运行态检查未通过：${blockers.map((blocker) => `${blocker.code}：${blocker.detail}`).join("；")}` : "修复前真实运行态检查未通过。";
}

export function App() {
  const [activeNavigation, setActiveNavigation] = useState<NavigationItem>("episodes");
  const [accountConfigurationDirty, setAccountConfigurationDirty] = useState(false);
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
  const [isSectionLoading, setIsSectionLoading] = useState(false);
  const [isEpisodeDetailLoading, setIsEpisodeDetailLoading] = useState(false);
  const [loadedSections, setLoadedSections] = useState<NavigationItem[]>([]);
  const [pendingAction, setPendingAction] = useState("");
  const [episodeCreationStep, setEpisodeCreationStep] = useState<EpisodeCreationStep>("idle");
  const [episodeCreationStartedAt, setEpisodeCreationStartedAt] = useState<number | null>(null);
  const [systemStatus, setSystemStatus] = useState<LocalSystemStatusReport | null>(null);
  const [isSystemStatusLoading, setIsSystemStatusLoading] = useState(false);
  const [isPageVisible, setIsPageVisible] = useState(() => document.visibilityState !== "hidden");
  const [productionTrackingEpisodeIds, setProductionTrackingEpisodeIds] = useState<Set<string>>(() => new Set());
  const [productionPreflight, setProductionPreflight] = useState<WorkerPreflightResult | null>(null);
  const [blueprintPreflight, setBlueprintPreflight] = useState<WorkerPreflightResult | null>(null);
  const [blueprintPreflightError, setBlueprintPreflightError] = useState("");
  const [isBlueprintPreflightLoading, setIsBlueprintPreflightLoading] = useState(false);
  const blueprintPreflightRequestRef = useRef(0);
  const blueprintPreflightTargetRef = useRef("");
  const episodeTaskRefreshRequestRef = useRef(0);
  const sectionLoadRequestRef = useRef(0);
  const episodeDetailLoadRequestRef = useRef(0);
  const workspaceRef = useRef<Workspace | null>(null);
  const selectedEpisodeIdRef = useRef(selectedEpisodeId);
  const activeNavigationRef = useRef(activeNavigation);
  const isEpisodeDetailOpenRef = useRef(isEpisodeDetailOpen);
  const hasInitializedNavigationRef = useRef(false);

  useEffect(() => {
    const openConnections = () => {
      setActiveNavigation("accounts");
      setIsEpisodeDetailOpen(false);
    };
    const openPublish = (event: Event) => openPublishModal((event as CustomEvent<string>).detail);
    window.addEventListener("open-external-connections", openConnections);
    window.addEventListener("open-publish", openPublish);
    return () => { window.removeEventListener("open-external-connections", openConnections); window.removeEventListener("open-publish", openPublish); };
  }, []);

  useEffect(() => {
    selectedEpisodeIdRef.current = selectedEpisodeId;
    setProductionPreflight(null);
  }, [selectedEpisodeId]);

  useEffect(() => {
    activeNavigationRef.current = activeNavigation;
  }, [activeNavigation]);

  useEffect(() => {
    isEpisodeDetailOpenRef.current = isEpisodeDetailOpen;
  }, [isEpisodeDetailOpen]);

  useEffect(() => {
    const updateVisibility = () => setIsPageVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", updateVisibility);
    return () => document.removeEventListener("visibilitychange", updateVisibility);
  }, []);

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

  const refreshWorkspaceSection = useCallback(async (navigation: NavigationItem) => {
    const requestId = ++sectionLoadRequestRef.current;
    setIsSectionLoading(true);
    try {
      const patch = await loadWorkspaceSection(navigation);
      if (requestId !== sectionLoadRequestRef.current || !workspaceRef.current) return;
      const nextWorkspace = { ...workspaceRef.current, ...patch };
      workspaceRef.current = nextWorkspace;
      setWorkspace(nextWorkspace);
      setLoadedSections((current) => current.includes(navigation) ? current : [...current, navigation]);
    } catch (error) {
      if (requestId === sectionLoadRequestRef.current) setErrorMessage(error instanceof Error ? error.message : "无法读取当前页面数据。");
    } finally {
      if (requestId === sectionLoadRequestRef.current) setIsSectionLoading(false);
    }
  }, []);

  const refreshEpisodeDetail = useCallback(async (episodeId: string, silent = false) => {
    const requestId = ++episodeDetailLoadRequestRef.current;
    if (!silent) setIsEpisodeDetailLoading(true);
    try {
      const detail = await loadEpisodeDetail(episodeId);
      if (requestId !== episodeDetailLoadRequestRef.current || selectedEpisodeIdRef.current !== episodeId || !workspaceRef.current) return;
      const nextWorkspace = mergeEpisodeDetail(workspaceRef.current, episodeId, detail);
      workspaceRef.current = nextWorkspace;
      setWorkspace(nextWorkspace);
    } catch (error) {
      if (requestId === episodeDetailLoadRequestRef.current) setErrorMessage(error instanceof Error ? error.message : "无法读取当前生产单详情。");
    } finally {
      if (!silent && requestId === episodeDetailLoadRequestRef.current) setIsEpisodeDetailLoading(false);
    }
  }, []);

  const refreshWorkspace = useCallback(async (source: "initial" | "manual" | "action" = "action") => {
    setIsLoading(true);
    setErrorMessage("");
    try {
      const summary = await loadWorkspaceSummary();
      const previousWorkspace = workspaceRef.current;
      const nextWorkspace = previousWorkspace ? { ...previousWorkspace, accounts: summary.accounts, blueprints: summary.blueprints, episodes: summary.episodes, series: summary.series, seriesVersions: summary.seriesVersions } : summary;
      workspaceRef.current = nextWorkspace;
      setWorkspace(nextWorkspace);
      if (!hasInitializedNavigationRef.current) {
        setActiveNavigation(initialNavigationForWorkspace(nextWorkspace));
        hasInitializedNavigationRef.current = true;
      }
      setSelectedAccountId((current) => current && nextWorkspace.accounts.some((account) => account.id === current) ? current : nextWorkspace.accounts[0]?.id ?? "");
      setSelectedEpisodeId((current) => current && nextWorkspace.episodes.some((episode) => episode.id === current) ? current : nextWorkspace.episodes[0]?.id ?? "");
      if (source !== "initial") {
        await refreshWorkspaceSection(activeNavigationRef.current);
        if (isEpisodeDetailOpenRef.current && selectedEpisodeIdRef.current) await refreshEpisodeDetail(selectedEpisodeIdRef.current);
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "无法读取控制数据。");
    } finally {
      setIsLoading(false);
    }
  }, [refreshEpisodeDetail, refreshWorkspaceSection]);

  const refreshEpisodeStatus = useCallback(async () => {
    setPendingAction("workspace-refresh");
    try {
      await refreshWorkspace("manual");
      setMessage("已刷新当前控制台状态。");
    } finally {
      setPendingAction("");
    }
  }, [refreshWorkspace]);

  const refreshEpisodeTaskStatus = useCallback(async (episodeId: string) => {
    const previousWorkspace = workspaceRef.current;
    if (!previousWorkspace) return;
    const requestId = ++episodeTaskRefreshRequestRef.current;
    const { data: taskStatus, error: taskStatusError } = await supabase.from("tasks").select("id,episode_id,status,attempt,completed_at,last_result").eq("episode_id", episodeId).order("created_at", { ascending: false });
    if (taskStatusError) throw taskStatusError;
    const taskIds = new Set((taskStatus ?? []).map((task) => task.id));
    const { data: taskRuns, error: taskRunsError } = taskIds.size
      ? await supabase.from("task_runs").select("id,task_id,status,attempt,started_at,completed_at").in("task_id", [...taskIds]).order("started_at", { ascending: false })
      : { data: [], error: null };
    if (taskRunsError) throw taskRunsError;
    if (requestId !== episodeTaskRefreshRequestRef.current || workspaceRef.current !== previousWorkspace) return;
    const tasksChanged = episodeTaskStatusChanged(previousWorkspace.tasks, taskStatus ?? [], episodeId);
    const taskRunsChanged = episodeTaskRunStatusChanged(previousWorkspace.taskRuns, taskRuns ?? [], taskIds);
    if (!tasksChanged && !taskRunsChanged) return;
    const { data: tasks, error: tasksError } = tasksChanged
      ? await supabase.from("tasks").select("*").eq("episode_id", episodeId).order("created_at", { ascending: false })
      : { data: previousWorkspace.tasks.filter((task) => task.episode_id === episodeId), error: null };
    if (tasksError) throw tasksError;
    if (requestId !== episodeTaskRefreshRequestRef.current || workspaceRef.current !== previousWorkspace) return;
    const nextWorkspace = { ...previousWorkspace, ...mergeEpisodeTaskStatus(previousWorkspace, episodeId, tasks ?? [], taskRuns ?? []) };
    const notice = taskChangeNotice(previousWorkspace, nextWorkspace, episodeId);
    workspaceRef.current = nextWorkspace;
    setWorkspace(nextWorkspace);
    if (notice) setMessage(notice);
  }, []);

  const refreshSystemStatus = useCallback(async () => {
    setIsSystemStatusLoading(true);
    try {
      setSystemStatus(await loadSystemStatusReport());
    } finally {
      setIsSystemStatusLoading(false);
    }
  }, []);

  const refreshSystemStatusAndWorkspace = useCallback(async () => {
    await Promise.all([refreshSystemStatus(), refreshWorkspace("manual")]);
  }, [refreshSystemStatus, refreshWorkspace]);

  const refreshBlueprintPreflight = useCallback(async (accountId: string) => {
    const account = workspaceRef.current?.accounts.find((candidate) => candidate.id === accountId);
    if (!account?.current_blueprint_version_id) {
      setBlueprintPreflight(null);
      setBlueprintPreflightError("当前账号没有可检查的有效蓝图。");
      return;
    }
    const target = `${account.id}:${account.current_blueprint_version_id}`;
    const requestId = ++blueprintPreflightRequestRef.current;
    setIsBlueprintPreflightLoading(true);
    setBlueprintPreflightError("");
    try {
      const preflight = await runEpisodePreflight({ accountId: account.id, blueprintVersionId: account.current_blueprint_version_id, seriesVersionId: null });
      if (requestId !== blueprintPreflightRequestRef.current || target !== blueprintPreflightTargetRef.current) return;
      setBlueprintPreflight(preflight);
    } catch (error) {
      if (requestId !== blueprintPreflightRequestRef.current || target !== blueprintPreflightTargetRef.current) return;
      setBlueprintPreflight(null);
      setBlueprintPreflightError(error instanceof Error ? error.message : "无法完成连接检查。");
    } finally {
      if (requestId === blueprintPreflightRequestRef.current && target === blueprintPreflightTargetRef.current) setIsBlueprintPreflightLoading(false);
    }
  }, []);

  useEffect(() => {
    let isMounted = true;
    const initialize = async () => {
      const { data, error } = await supabase.auth.getSession();
      if (!isMounted) return;
      if (error) setErrorMessage(error.message);
      setSession(data.session);
      if (data.session) await refreshWorkspace("initial");
      else setIsLoading(false);
    };
    void initialize();
    const { data: listener } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (event === "INITIAL_SESSION") return;
      clearLocalArtifactCache();
      setSession(nextSession);
      if (nextSession) void refreshWorkspace("initial");
      else {
        workspaceRef.current = null;
        sectionLoadRequestRef.current += 1;
        episodeDetailLoadRequestRef.current += 1;
        setWorkspace(null);
        setLoadedSections([]);
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
    if (!session || !workspaceRef.current || !hasInitializedNavigationRef.current) return;
    void refreshWorkspaceSection(activeNavigation);
  }, [activeNavigation, refreshWorkspaceSection, session]);

  useEffect(() => {
    if (!isEpisodeDetailOpen || !selectedEpisodeId) return;
    void refreshEpisodeDetail(selectedEpisodeId);
  }, [isEpisodeDetailOpen, refreshEpisodeDetail, selectedEpisodeId]);

  useEffect(() => {
    if (!session) { setSystemStatus(null); return; }
    if (!isPageVisible) return;
    void refreshSystemStatus();
    const interval = window.setInterval(() => void refreshSystemStatus(), 15000);
    return () => window.clearInterval(interval);
  }, [isPageVisible, refreshSystemStatus, session]);

  const selectedEpisodeHasActiveTask = Boolean(selectedEpisodeId && workspace?.tasks.some((task) => task.episode_id === selectedEpisodeId && (task.status === "ready" || task.status === "running")));
  const selectedEpisodeDispatchRequested = Boolean(selectedEpisodeId && productionTrackingEpisodeIds.has(selectedEpisodeId));
  const selectedEpisodeNeedsTaskPolling = episodeNeedsTaskPolling({ detailOpen: isEpisodeDetailOpen, dispatchRequested: selectedEpisodeDispatchRequested, hasActiveTask: selectedEpisodeHasActiveTask, pageVisible: isPageVisible });

  useEffect(() => {
    if (!selectedEpisodeNeedsTaskPolling || !selectedEpisodeId) return;
    const interval = window.setInterval(() => {
      void (async () => {
        await refreshEpisodeTaskStatus(selectedEpisodeId);
        await refreshEpisodeDetail(selectedEpisodeId, true);
      })().catch((error) => setErrorMessage(error instanceof Error ? error.message : "无法刷新任务状态。"));
    }, 10000);
    return () => window.clearInterval(interval);
  }, [refreshEpisodeDetail, refreshEpisodeTaskStatus, selectedEpisodeId, selectedEpisodeNeedsTaskPolling]);

  const accountsById = useMemo(() => new Map(workspace?.accounts.map((account) => [account.id, account])), [workspace]);
  const blueprintsById = useMemo(() => new Map(workspace?.blueprints.map((blueprint) => [blueprint.id, blueprint])), [workspace]);
  const seriesById = useMemo(() => new Map(workspace?.series.map((series) => [series.id, series])), [workspace]);
  const seriesVersionsById = useMemo(() => new Map(workspace?.seriesVersions.map((version) => [version.id, version])), [workspace]);
  const selectedAccount = workspace?.accounts.find((account) => account.id === selectedAccountId) ?? null;
  const selectedEpisode = workspace?.episodes.find((episode) => episode.id === selectedEpisodeId) ?? null;
  const selectedEpisodeOpenChatCutProjectPath = openChatCutProjectPathForEpisode(workspace?.reviewPackages ?? [], selectedEpisode);
  blueprintPreflightTargetRef.current = selectedAccount?.current_blueprint_version_id ? `${selectedAccount.id}:${selectedAccount.current_blueprint_version_id}` : "";

  useEffect(() => {
    if (!selectedEpisodeId || !selectedEpisodeDispatchRequested || selectedEpisodeHasActiveTask || !selectedEpisode || (!reviewStages.has(selectedEpisode.stage) && selectedEpisode.stage !== "visual_approved" && selectedEpisode.stage !== "storyboard_approved" && selectedEpisode.stage !== "qc_passed" && selectedEpisode.stage !== "publish_ready")) return;
    setProductionTrackingEpisodeIds((current) => { const next = new Set(current); next.delete(selectedEpisodeId); return next; });
  }, [selectedEpisode, selectedEpisodeDispatchRequested, selectedEpisodeHasActiveTask, selectedEpisodeId]);

  useEffect(() => {
    if (!blueprintRepairContext || !workspace) return;
    const blockerStillExists = workerBlockers(workspace.tasks, blueprintRepairContext.episodeId).some((blocker) => blocker.code === blueprintRepairContext.blocker.code && blocker.detail === blueprintRepairContext.blocker.detail);
    if (blockerStillExists) return;
    setBlueprintRepairContext(null);
    setSelectedEpisodeId(blueprintRepairContext.episodeId);
    setIsEpisodeDetailOpen(true);
    setActiveNavigation("episodes");
    setMessage("当前生产单的阻塞已解除，已返回生产单详情。");
  }, [blueprintRepairContext, workspace]);

  useEffect(() => {
    if (!session || activeNavigation !== "accounts" || !selectedAccount?.current_blueprint_version_id) {
      blueprintPreflightRequestRef.current += 1;
      setBlueprintPreflight(null);
      setBlueprintPreflightError("");
      setIsBlueprintPreflightLoading(false);
      return;
    }
    void refreshBlueprintPreflight(selectedAccount.id);
  }, [activeNavigation, refreshBlueprintPreflight, selectedAccount?.current_blueprint_version_id, selectedAccount?.id, session]);
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
    if (activeNavigation === "accounts" && nextNavigation !== "accounts" && accountConfigurationDirty) {
      if (!window.confirm("当前配置有未保存修改，确定放弃吗？")) return;
      setAccountConfigurationDirty(false);
    }
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

  function returnToEpisodeDetail(episodeId: string) {
    setBlueprintRepairContext(null);
    setActiveNavigation("episodes");
    openEpisodeDetail(episodeId);
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

  async function applyEpisodeConfigurationRepair(input: { context: BlueprintRepairContext; policy: Json }): Promise<boolean> {
    setPendingAction(`apply-episode-repair-${input.context.episodeId}`);
    setErrorMessage("");
    try {
      const episode = workspace?.episodes.find((candidate) => candidate.id === input.context.episodeId);
      const account = episode ? workspace?.accounts.find((candidate) => candidate.id === episode.account_id) : null;
      if (!episode || !account?.current_blueprint_version_id) throw new Error("当前生产单或账号蓝图已变化，请刷新后重试。");
      const preflight = await runEpisodePreflight({ accountId: account.id, blueprintVersionId: account.current_blueprint_version_id, episodeId: episode.id, policy: input.policy, seriesVersionId: episode.series_version_id ?? null });
      if (preflight.checks.some((check) => check.status !== "passed")) {
        setErrorMessage(workerPreflightFailureMessage(preflight));
        return false;
      }
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
      returnToEpisodeDetail(input.context.episodeId);
      setMessage(`配置已直接应用到当前生产单，账号蓝图未变；已重新排队 ${recreatedCount} 个受阻任务。`);
      return true;
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "无法将蓝图配置应用到当前生产单。");
      return false;
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
      void refreshBlueprintPreflight(selectedAccount.id);
      return data;
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "创建蓝图版本失败。");
      return null;
    } finally {
      setPendingAction("");
    }
  }

  async function createSeries(input: { name: string; rules: Json }) {
    if (!selectedAccount) return;
    setPendingAction("series");
    setErrorMessage("");
    try {
      const { error } = await supabase.rpc("create_series", { p_account_id: selectedAccount.id, p_name: input.name, p_rules: input.rules });
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
      if (data && workspaceRef.current) {
        const nextWorkspace = {
          ...workspaceRef.current,
          promptVersions: [data, ...workspaceRef.current.promptVersions.filter((version) => version.id !== data.id)],
        };
        workspaceRef.current = nextWorkspace;
        setWorkspace(nextWorkspace);
      }
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

  async function createExternalConnection(input: ExternalConnectionInput): Promise<ExternalConnection | null> {
    setPendingAction("external-connection");
    setErrorMessage("");
    try {
      const { data, error } = await supabase.rpc("create_external_connection", { p_adapter: input.adapter, p_name: input.name, p_provider: input.provider, p_secret: input.secret });
      if (error) throw error;
      await refreshWorkspace();
      return data;
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "创建外部连接失败。");
      return null;
    } finally {
      setPendingAction("");
    }
  }

  async function testExternalConnection(connectionId: string): Promise<void> {
    setPendingAction(`test-external-connection-${connectionId}`);
    setErrorMessage("");
    try {
      const { data, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !data.session) throw sessionError ?? new Error("需要 Owner 登录会话。");
      const response = await fetch("/_external-connection-test", { body: JSON.stringify({ connectionId }), headers: { Authorization: `Bearer ${data.session.access_token}`, "Content-Type": "application/json" }, method: "POST" });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload && typeof payload === "object" && !Array.isArray(payload) && typeof (payload as Record<string, unknown>).error === "string" ? (payload as Record<string, unknown>).error as string : "无法完成外部连接测试。");
      await refreshWorkspace();
      const provider = payload && typeof payload === "object" && !Array.isArray(payload) && typeof (payload as { connection?: { provider?: unknown } }).connection?.provider === "string" ? (payload as { connection: { provider: string } }).connection.provider : "外部连接";
      setMessage(`${provider} 连接测试已完成；蓝图只可选择已验证连接版本。`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "外部连接测试失败。");
      throw error;
    } finally {
      setPendingAction("");
    }
  }

  async function rotateExternalConnection(input: { connectionId: string; provider: ExternalConnectionInput["provider"]; adapter: ExternalConnectionInput["adapter"]; secret: string }): Promise<ExternalConnection | null> {
    setPendingAction(`rotate-external-connection-${input.connectionId}`); setErrorMessage("");
    try {
      const { data, error } = await supabase.rpc("rotate_external_connection", { p_adapter: input.adapter, p_connection_id: input.connectionId, p_provider: input.provider, p_secret: input.secret });
      if (error) throw error;
      await refreshWorkspace(); return data;
    } catch (error) { setErrorMessage(error instanceof Error ? error.message : "无法创建外部连接新版本。"); return null; }
    finally { setPendingAction(""); }
  }

  async function updateExternalConnection(input: { connectionId: string; name: string; description: string }): Promise<void> {
    setPendingAction(`update-external-connection-${input.connectionId}`); setErrorMessage("");
    try {
      const { error } = await supabase.rpc("update_external_connection", { p_connection_id: input.connectionId, p_description: input.description, p_name: input.name });
      if (error) throw error;
      await refreshWorkspace(); setMessage("外部连接名称已更新；认证版本未改变。");
    } catch (error) { const message = error instanceof Error ? error.message : "无法更新外部连接。"; setErrorMessage(message); throw new Error(message); }
    finally { setPendingAction(""); }
  }

  async function repairEpisodeConnection(input: { blocker: WorkerBlocker; episodeId: string; versionId: string }): Promise<void> {
    setPendingAction(`repair-external-connection-${input.episodeId}`); setErrorMessage("");
    try {
      const { data, error } = await supabase.rpc("apply_external_connection_repair", { p_blocker_code: input.blocker.code, p_blocker_detail: input.blocker.detail, p_connection_version_id: input.versionId, p_episode_id: input.episodeId });
      if (error) throw error;
      const result = data && typeof data === "object" && !Array.isArray(data) ? data as Record<string, unknown> : {};
      const count = typeof result.recreated_task_count === "number" ? result.recreated_task_count : 0;
      await refreshWorkspace(); setMessage(`连接版本已应用到当前生产单；已重新排队 ${count} 个受影响任务。已完成任务、审核和审计历史保留。`);
    } catch (error) { setErrorMessage(error instanceof Error ? error.message : "无法将新连接版本应用到当前生产单。"); }
    finally { setPendingAction(""); }
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

  async function setAccountArchived(accountId: string, archived: boolean): Promise<boolean> {
    setPendingAction(`archive-account-${accountId}`);
    setErrorMessage("");
    try {
      const { error } = await supabase.rpc("set_account_archived", { p_account_id: accountId, p_archived: archived });
      if (error) throw error;
      setMessage(archived ? "账号已归档；历史生产单和配置仍然保留。" : "账号已恢复，可以继续新建生产单。");
      await refreshWorkspace();
      return true;
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "无法更新账号归档状态。");
      return false;
    } finally {
      setPendingAction("");
    }
  }

  function setEpisodeCreationProgress(step: EpisodeCreationStep) {
    setEpisodeCreationStep(step);
    setEpisodeCreationStartedAt(step === "idle" ? null : Date.now());
  }

  async function createEpisode(input: { title: string; accountId: string; isTest: boolean; seriesVersionId: string | null }): Promise<WorkerPreflightResult | null> {
    const account = workspace?.accounts.find((candidate) => candidate.id === input.accountId);
    if (!account?.current_blueprint_version_id || account.archived_at) return null;
    setPendingAction("episode");
    setErrorMessage("");
    try {
      setEpisodeCreationProgress("preflight");
      const preflight = await runEpisodePreflight({ accountId: account.id, blueprintVersionId: account.current_blueprint_version_id, seriesVersionId: input.seriesVersionId });
      if (preflight.checks.some((check) => check.status !== "passed")) return preflight;
      setEpisodeCreationProgress("create");
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
          setEpisodeCreationProgress("directory");
          await requestLocalEpisodeDirectory(data.id, "create");
          localDirectoryReady = true;
        } catch (directoryError) {
          localDirectoryError = directoryError instanceof Error ? `生产单已创建，但本地输入目录准备失败：${directoryError.message}` : "生产单已创建，但本地输入目录准备失败。可稍后从详情页重试。";
        }
      }
      setMessage(localDirectoryReady ? "生产单已创建，本地输入目录已准备就绪，等待导入主脚本。" : "生产单已创建，等待导入主脚本；本地输入目录可稍后从详情页重试。");
      setEpisodeCreationProgress("refresh");
      await refreshWorkspace();
      if (localDirectoryError) setErrorMessage(localDirectoryError);
      return null;
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "创建生产单失败。");
      return null;
    } finally {
      setEpisodeCreationProgress("idle");
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
          logicalName: input.logicalName,
        }),
      });
      if (!response.ok) throw new Error((await response.text()).trim() || "无法导入生产材料。");
      const material: unknown = await response.json();
      const materialId = material && typeof material === "object" && !Array.isArray(material) && "id" in material && typeof material.id === "string" ? material.id : null;
      if (!materialId) throw new Error("生产材料已写入，但服务端没有返回素材修订 ID。");
      setMessage(input.isMainScript ? "主脚本已确认为不可变修订；你可以继续导入材料，准备完成后再开始制作。" : "生产材料已导入为不可变修订。");
      if (!input.deferRefresh) await refreshWorkspace();
      return materialId;
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "无法导入生产材料。");
      throw error;
    } finally {
      setPendingAction("");
    }
  }

  async function saveShotPreparationDraft(input: ShotPreparationDraftRequest) {
    setPendingAction(`shot-preparation-${input.episodeId}-${input.shotId}`);
    setErrorMessage("");
    try {
      if (input.includeVideo) {
        const { error } = await supabase.rpc("save_shot_workbench_draft", {
          p_audio_mode: input.audioMode,
          p_material_revision_id: input.materialRevisionId,
          p_clip_segments: input.clipSegments as unknown as Json,
          p_episode_id: input.episodeId,
          p_review_package_id: input.reviewPackageId,
          p_shot_id: input.shotId,
          p_subtitle_text: input.subtitleText,
          p_subtitles_enabled: input.subtitlesEnabled,
          p_tts_speaking_rate: input.ttsSpeakingRate,
          p_tts_text: input.ttsText,
          p_tts_voice: input.ttsVoice,
        });
        if (error) throw error;
      } else {
        const { error } = await supabase.rpc("save_shot_preparation_draft", {
          p_audio_mode: input.audioMode,
          p_episode_id: input.episodeId,
          p_review_package_id: input.reviewPackageId,
          p_shot_id: input.shotId,
          p_subtitle_text: input.subtitleText,
          p_subtitles_enabled: input.subtitlesEnabled,
          p_tts_speaking_rate: input.ttsSpeakingRate,
          p_tts_text: input.ttsText,
          p_tts_voice: input.ttsVoice,
        });
        if (error) throw error;
      }
      if (input.ttsOverride) {
        const { error } = await supabase.rpc("save_shot_tts_override", {
          p_episode_id: input.episodeId,
          p_review_package_id: input.reviewPackageId,
          p_shot_id: input.shotId,
          p_tts_speaking_rate: input.ttsOverride.speakingRate,
          p_tts_voice: input.ttsOverride.voice,
        });
        if (error) throw error;
      }
      setMessage(`${input.shotId} 的逐镜头准备草稿已保存；未创建媒体任务。`);
      await refreshWorkspace();
    } catch (error) {
      const message = messageFromError(error, "无法保存逐镜头准备草稿。");
      setErrorMessage(message);
      throw new Error(message);
    } finally {
      setPendingAction("");
    }
  }

  async function saveEpisodeTtsSettings(input: { episodeId: string; languageCode: string; speakingRate: number; voice: string }) {
    setPendingAction(`episode-tts-settings-${input.episodeId}`);
    setErrorMessage("");
    try {
      const { error } = await supabase.rpc("save_episode_tts_settings", {
        p_episode_id: input.episodeId,
        p_tts_language_code: input.languageCode,
        p_tts_speaking_rate: input.speakingRate,
        p_tts_voice: input.voice,
      });
      if (error) throw error;
      setMessage("本期 TTS 设置已保存；旧音轨仍保留为历史。");
      await refreshWorkspace();
    } catch (error) {
      const message = messageFromError(error, "无法保存本期 TTS 设置。");
      setErrorMessage(message);
      throw new Error(message);
    } finally {
      setPendingAction("");
    }
  }

  async function saveStoryboardAudioSelection(input: StoryboardAudioSelectionRequest) {
    setPendingAction(`storyboard-audio-${input.episodeId}-${input.targetKind}-${input.targetId}`);
    setErrorMessage("");
    try {
      const { error } = await supabase.rpc("save_storyboard_audio_selection", {
        p_audio_kind: input.audioKind,
        p_cue_id: input.cueId,
        p_episode_id: input.episodeId,
        p_material_revision_id: input.materialRevisionId ?? null,
        p_review_package_id: input.reviewPackageId,
        p_target_id: input.targetId,
        p_target_kind: input.targetKind,
      });
      if (error) throw error;
      setMessage(input.audioKind === "bgm" ? "整期 BGM 设置已保存。" : `${input.targetId} 的镜头音效已保存。`);
      await refreshWorkspace();
    } catch (error) {
      const message = messageFromError(error, input.audioKind === "bgm" ? "无法保存整期 BGM 设置。" : "无法保存镜头音效。");
      setErrorMessage(message);
      throw new Error(message);
    } finally {
      setPendingAction("");
    }
  }

  async function generateShotTts(input: ShotTtsGenerationRequest) {
    setPendingAction(`shot-tts-${input.episodeId}-${input.shotId}`);
    setErrorMessage("");
    try {
      const { data: task, error } = await supabase.rpc("generate_shot_tts", {
        p_episode_id: input.episodeId,
        p_review_package_id: input.reviewPackageId,
        p_retry: input.retry ?? false,
        p_shot_id: input.shotId,
      });
      if (error) throw error;
      const dispatch = task?.id ? await requestImmediateTaskDispatch(input.episodeId, task.id) : { accepted: false, reason: "任务记录缺少 ID" };
      setMessage(dispatch.accepted ? `${input.shotId} 的口播任务已${input.retry ? "重新" : "创建"}，正在启动 Worker。` : `${input.shotId} 的口播任务已保留，可在 Worker 恢复后重试。`);
      if (!dispatch.accepted) setErrorMessage(`Worker 未启动：${dispatch.reason}`);
      await refreshWorkspace();
    } catch (error) {
      const message = messageFromError(error, "无法创建逐镜头口播任务。");
      setErrorMessage(message);
      throw new Error(message);
    } finally {
      setPendingAction("");
    }
  }

  async function registerManualMedia(input: ManualMediaBindingRequest) {
    setPendingAction(`manual-${input.kind}-${input.episodeId}`);
    setErrorMessage("");
    try {
      const { error } = input.kind === "a_roll" || input.kind === "b_roll"
        ? await supabase.rpc("save_manual_shot_clip", { p_clip_end_seconds: input.clipEndSeconds ?? 0, p_clip_start_seconds: input.clipStartSeconds ?? 0, p_episode_id: input.episodeId, p_kind: input.kind, p_material_revision_id: input.materialRevisionId, p_shot_id: input.targetId, p_storyboard_review_package_id: input.storyboardReviewPackageId })
        : input.kind === "narration" && input.targetId === input.episodeId
          ? await supabase.rpc("register_manual_episode_narration", { p_episode_id: input.episodeId, p_material_revision_id: input.materialRevisionId, p_storyboard_review_package_id: input.storyboardReviewPackageId })
          : await supabase.rpc("register_manual_audio", { p_episode_id: input.episodeId, p_material_revision_id: input.materialRevisionId, p_storyboard_review_package_id: input.storyboardReviewPackageId, p_target_id: input.targetId });
      if (error) throw new Error(error.message);
      setMessage(`人工${input.kind === "a_roll" ? " A-roll" : input.kind === "b_roll" ? " B-roll" : input.kind === "narration" ? "旁白" : input.kind === "bgm" ? "配乐" : "音效"}${input.replace ? "镜头素材已更新" : "已确认用于当前目标"}；不会调用自动生成能力。`);
      await refreshWorkspace();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "无法绑定人工生产材料。");
      throw error;
    } finally {
      setPendingAction("");
    }
  }

  async function startEpisodeProduction(episodeId: string) {
    setPendingAction(`start-production-${episodeId}`);
    setErrorMessage("");
    setProductionPreflight(null);
    setProductionTrackingEpisodeIds((current) => new Set(current).add(episodeId));
    try {
      const result = await startProductionThroughWorkerPreflight(episodeId);
      setProductionPreflight(result.preflight);
      setMessage("材料准备已确认；当前生产单已即时派发，正在等待任务记录。");
      await refreshWorkspace();
    } catch (error) {
      setProductionTrackingEpisodeIds((current) => { const next = new Set(current); next.delete(episodeId); return next; });
      const preflight = error && typeof error === "object" && "preflight" in error ? error.preflight : null;
      if (preflight) setProductionPreflight(preflight as WorkerPreflightResult);
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
      setErrorMessage(messageFromError(error, "无法写入发布状态。"));
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
      setErrorMessage(error instanceof Error ? error.message : error && typeof error === "object" && "message" in error && typeof error.message === "string" ? error.message : "无法记录发布事实。");
      return false;
    } finally {
      setPendingAction("");
    }
  }

  async function preparePublishPackage(input: { cover: File; description: string; tags: string[]; title: string }): Promise<boolean> {
    if (!selectedEpisode) return false;
    setPendingAction(`publish-prepare-${selectedEpisode.id}`);
    setErrorMessage("");
    try {
      const accessToken = session?.access_token;
      if (!accessToken) throw new Error("需要 Owner 登录会话。");
      const coverBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error("无法读取封面文件。"));
        reader.onload = () => resolve(String(reader.result).split(",", 2)[1] ?? "");
        reader.readAsDataURL(input.cover);
      });
      const response = await fetch("/_publish-preparation", { method: "POST", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ coverBase64, description: input.description, episodeId: selectedEpisode.id, tags: input.tags, title: input.title }) });
      if (!response.ok) throw new Error((await response.text()).trim() || "无法生成发布包。");
      setMessage("发布元数据与封面已登记，发布包已生成并通过校验。");
      await refreshWorkspace();
      return true;
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "无法生成发布包。");
      return false;
    } finally {
      setPendingAction("");
    }
  }

  async function submitReviewRevision(input: ReviewRevisionRequest): Promise<ReviewRevisionOutcome> {
    setPendingAction(`review-render-revision-${input.reviewPackageId}`);
    setErrorMessage("");
    try {
      const outcome = await requestReviewRevision(input);
      setMessage(outcome.message);
      await refreshWorkspace();
      return outcome;
    } catch (error) {
      const detail = error instanceof Error ? error.message : error && typeof error === "object" && "message" in error && typeof error.message === "string" ? error.message : "无法提交审核修订。";
      setErrorMessage(detail);
      throw new Error(detail);
    } finally {
      setPendingAction("");
    }
  }

  async function submitShotStructureRevision(input: ShotStructureRevisionRequest): Promise<void> {
    setPendingAction(`shot-structure-revision-${input.episodeId}`);
    setErrorMessage("");
    try {
      const task = await requestShotStructureRevision(input);
      const dispatch = await requestImmediateTaskDispatch(input.episodeId, task.id);
      setMessage(dispatch.accepted ? "分镜结构修订任务已创建，正在启动 Worker；完成后会在当前工作台切换到新版本。" : "分镜结构修订任务已保留，可在 Worker 恢复后重试。");
      if (!dispatch.accepted) setErrorMessage(`Worker 未启动：${dispatch.reason}`);
      await refreshWorkspace();
    } catch (error) {
      const detail = error instanceof Error ? error.message : "无法提交分镜结构修订。";
      setErrorMessage(detail);
      throw new Error(detail);
    } finally {
      setPendingAction("");
    }
  }

  async function submitStudioRevision(input: Omit<StudioReviewRevisionRequest, "accessToken">): Promise<ReviewRevisionOutcome> {
    const token = session?.access_token;
    if (!token) throw new Error("需要 Owner 登录会话。");
    setPendingAction(`review-render-revision-${input.reviewPackageId}`);
    setErrorMessage("");
    try {
      const outcome = await submitStudioReviewRevision({ ...input, accessToken: token });
      setMessage(outcome.message);
      await refreshWorkspace();
      return outcome;
    } catch (error) {
      const detail = error instanceof Error ? error.message : "无法提交审核修订。";
      setErrorMessage(detail);
      throw new Error(detail);
    } finally {
      setPendingAction("");
    }
  }

  async function retryFinalRender(episodeId: string, reason: string): Promise<boolean> {
    setPendingAction(`final-render-retry-${episodeId}`);
    setErrorMessage("");
    try {
      setMessage(await recoverFinalReviewRender(episodeId, reason));
      await refreshWorkspace();
      return true;
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "无法重新排队最终渲染。");
      return false;
    } finally {
      setPendingAction("");
    }
  }

  async function openOpenChatCutStudio(episodeId: string, projectRelativePath: string, durationSettings?: ReviewRenderDurationSettings): Promise<OpenChatCutStudioWorkspace> {
    const token = session?.access_token;
    if (!token) throw new Error("需要 Owner 登录会话。");
    const studioWindow = window.open("about:blank", "_blank");
    const response = await fetch(`/_open-openchatcut-studio?episode=${encodeURIComponent(episodeId)}`, { body: JSON.stringify({ allowedFrames: durationSettings?.allowedFrames, frameRate: durationSettings?.frameRate, projectRelativePath }), headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, method: "POST" });
    const responseText = await response.text();
    let payload: unknown = null;
    try { payload = JSON.parse(responseText); } catch { /* plain-text error response */ }
    if (!response.ok || !payload || typeof payload !== "object" || Array.isArray(payload) || !("workspace" in payload) || !("studioUrl" in payload) || typeof payload.studioUrl !== "string") {
      studioWindow?.close();
      throw new Error(typeof payload === "object" && payload && "message" in payload && typeof payload.message === "string" ? payload.message : responseText || "无法打开 OpenChatCut。");
    }
    const workspace = studioWorkspaceFromPayload(payload.workspace);
    try {
      if (studioWindow) studioWindow.location.replace(payload.studioUrl);
      else window.open(payload.studioUrl, "_blank", "noopener,noreferrer");
    } catch {
      // Keep the workspace available for submission when the browser blocks popup navigation.
    }
    return workspace;
  }

  async function openSelectedOpenChatCutStudio(): Promise<void> {
    if (!selectedEpisode || !selectedEpisodeOpenChatCutProjectPath) {
      setErrorMessage("当前选中的生产单没有可编辑的审核渲染。");
      return;
    }
    setPendingAction(`openchatcut-studio-${selectedEpisode.id}`);
    setErrorMessage("");
    try {
      await openOpenChatCutStudio(selectedEpisode.id, selectedEpisodeOpenChatCutProjectPath, reviewRenderDurationSettingsFromRules(selectedEpisode.series_version_id ? seriesVersionsById.get(selectedEpisode.series_version_id)?.rules : undefined));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "无法打开 OpenChatCut。");
    } finally {
      setPendingAction("");
    }
  }

  async function generateShotReviewVideo(input: ShotReviewVideoRequest): Promise<void> {
    const token = session?.access_token;
    if (!token) throw new Error("需要 Owner 登录会话。");
    setPendingAction(`shot-review-video-${input.episodeId}`);
    setErrorMessage("");
    try {
      const freezeResponse = await fetch(`/_freeze-openchatcut-studio?episode=${encodeURIComponent(input.episodeId)}`, { body: JSON.stringify({ sourceProjectRelativePath: input.storyboardRelativePath, workspaceRelativePath: input.workspaceRelativePath }), headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, method: "POST" });
      const freezePayload: unknown = await freezeResponse.json().catch(() => null);
      if (!freezeResponse.ok || !freezePayload || typeof freezePayload !== "object" || Array.isArray(freezePayload) || !("frozenProject" in freezePayload)) throw new Error(typeof freezePayload === "object" && freezePayload && "message" in freezePayload && typeof freezePayload.message === "string" ? freezePayload.message : "无法冻结审核视频工程。");
      const frozenProject = studioWorkspaceFromPayload(freezePayload.frozenProject);
      const { error } = await supabase.rpc("generate_shot_review_video", { p_accept_duration_risk: input.acceptDurationRisk, p_episode_id: input.episodeId, p_review_package_id: input.reviewPackageId, p_risk_reason: input.riskReason, p_studio_project: { file_size: frozenProject.fileSize, relative_path: frozenProject.relativePath, sha256: frozenProject.sha256 } });
      if (error) throw error;
      setMessage("审核视频任务已创建，Worker 将按当前保存的镜头设置生成预览。");
      await refreshWorkspace();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : error && typeof error === "object" && "message" in error && typeof error.message === "string" ? error.message : "无法生成审核视频。");
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

  async function createQcReviewIssue(input: QcReviewIssueRequest): Promise<void> {
    setPendingAction(`qc-issue-${input.reviewPackageId}`);
    setErrorMessage("");
    try {
      const { error } = await supabase.rpc("create_qc_review_issue", {
        p_at_seconds: input.atSeconds,
        p_member_key: input.memberKey,
        p_reason: input.reason,
        p_review_package_id: input.reviewPackageId,
        p_severity: input.severity,
      });
      if (error) throw error;
      setMessage("QC 问题已记录到当前冻结审核版本。");
      await refreshWorkspace();
    } catch (error) {
      const message = error instanceof Error ? error.message : "无法记录 QC 问题。";
      setErrorMessage(message);
      throw new Error(message);
    } finally {
      setPendingAction("");
    }
  }

  async function resolveQcReviewIssue(issueId: string, status: "accepted" | "ignored"): Promise<void> {
    setPendingAction(`qc-issue-${issueId}`);
    setErrorMessage("");
    try {
      const { error } = await supabase.rpc("resolve_qc_review_issue", { p_issue_id: issueId, p_status: status });
      if (error) throw error;
      await refreshWorkspace();
    } catch (error) {
      const message = error instanceof Error ? error.message : "无法更新 QC 问题。";
      setErrorMessage(message);
      throw new Error(message);
    } finally {
      setPendingAction("");
    }
  }

  async function requestQcMemberRevision(issueId: string): Promise<void> {
    setPendingAction(`qc-revision-${issueId}`);
    setErrorMessage("");
    try {
      const { error } = await supabase.rpc("request_qc_member_revision", { p_issue_id: issueId });
      if (error) throw error;
      setMessage("已创建定向返工任务；其余冻结成员会保留。");
      await refreshWorkspace();
    } catch (error) {
      const message = error instanceof Error ? error.message : "无法创建 QC 定向返工。";
      setErrorMessage(message);
      throw new Error(message);
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
    <div className="app-shell" data-sidebar={sidebarCollapsed ? "collapsed" : "expanded"} data-theme={theme}>
      <a className="skip-link" href="#main-content">跳到主要内容</a>
      <aside className="sidebar" aria-label="主导航">
        <div className="wordmark"><img alt="Loop Control" src="/brand/loop-mark.png" /><span>Loop Control</span></div>
        <nav className="navigation"><NavigationButtons activeNavigation={activeNavigation} badges={navigationBadges} onSelect={changeNavigation} /></nav>
        <button aria-label={selectedEpisodeOpenChatCutProjectPath ? `打开${selectedEpisode?.title ?? "当前生产单"}的 OpenChatCut` : "OpenChatCut 仅从有审核渲染的生产单打开"} className="sidebar-studio-shortcut" disabled={!selectedEpisodeOpenChatCutProjectPath || pendingAction === `openchatcut-studio-${selectedEpisode?.id ?? ""}`} onClick={() => void openSelectedOpenChatCutStudio()} title={selectedEpisodeOpenChatCutProjectPath ? `打开${selectedEpisode?.title ?? "当前生产单"}的 OpenChatCut` : "请选择有审核渲染的生产单"} type="button"><Icon name="Video" /><span>{pendingAction === `openchatcut-studio-${selectedEpisode?.id ?? ""}` ? "正在打开…" : "OpenChatCut"}</span></button>
        <div className="sidebar-footer"><div className="sidebar-utilities"><SystemStatusPanel episodes={workspace.episodes} isRefreshing={isSystemStatusLoading} onRefresh={refreshSystemStatusAndWorkspace} onRunGoldenTest={runGoldenProductionTest} report={systemStatus} tasks={workspace.tasks} /><button aria-label={theme === "light" ? "切换至深色模式" : "切换至浅色模式"} className="sidebar-utility" onClick={changeTheme} title={theme === "light" ? "深色模式" : "浅色模式"} type="button"><Icon name={theme === "light" ? "Moon" : "Sun"} /></button><button aria-label={sidebarCollapsed ? "展开侧栏" : "收起侧栏"} className="sidebar-collapse-button sidebar-utility" onClick={changeSidebarCollapsed} title={sidebarCollapsed ? "展开侧栏" : "收起侧栏"} type="button"><Icon name="PanelLeft" /></button><OwnerMenu onOpenSettings={() => setShowPasswordForm(true)} onSignOut={() => void supabase.auth.signOut()} /></div></div>
      </aside>

      <section className="content-pane" id="main-content" aria-label="平台工作台" tabIndex={-1}>
        <header className="page-header">
          <h1>{navigation.find((item) => item.id === activeNavigation)?.label}</h1>
          {activeNavigation === "accounts" ? <button className="button button-primary" onClick={() => setShowAccountForm(true)} type="button">新建账号</button> : null}
          {activeNavigation === "episodes" ? <button className="button button-primary" onClick={() => setShowEpisodeForm(true)} type="button">新建生产单</button> : null}
          <div className="mobile-header-actions"><SystemStatusPanel episodes={workspace.episodes} isRefreshing={isSystemStatusLoading} onRefresh={refreshSystemStatusAndWorkspace} onRunGoldenTest={runGoldenProductionTest} report={systemStatus} tasks={workspace.tasks} /><OwnerMenu onOpenSettings={() => setShowPasswordForm(true)} onSignOut={() => void supabase.auth.signOut()} /></div>
        </header>

        {message || errorMessage ? <div className="floating-notices" aria-live="polite">{message ? <div className="notice-message" role="status">{message}<button aria-label="关闭通知" onClick={() => setMessage("")} type="button">×</button></div> : null}{errorMessage ? <div className="error-message" role="alert">{errorMessage}<button aria-label="关闭错误通知" onClick={() => setErrorMessage("")} type="button">×</button></div> : null}</div> : null}

        {isSectionLoading && !loadedSections.includes(activeNavigation) ? <LoadingIndicator label="正在加载当前页面…" /> : <>
        {isSectionLoading ? <LoadingIndicator compact label="正在刷新当前页面…" /> : null}
        {activeNavigation === "accounts" ? (
          <AccountWorkspace
            account={selectedAccount}
            accounts={workspace.accounts}
            blueprints={workspace.blueprints.filter((blueprint) => blueprint.account_id === selectedAccount?.id && !blueprint.is_snapshot)}
            blueprintRepairContext={blueprintRepairContext}
            onApplyEpisodeRepair={applyEpisodeConfigurationRepair}
            onDismissBlueprintRepair={() => blueprintRepairContext ? returnToEpisodeDetail(blueprintRepairContext.episodeId) : setActiveNavigation("episodes")}
            onDirtyChange={setAccountConfigurationDirty}
            isPending={pendingAction}
            onUpdateBlueprint={updateBlueprint}
            onCreatePromptVersion={createPromptVersion}
            onCreateSeries={createSeries}
            onCreateSeriesVersion={createSeriesVersion}
            onDeleteAccount={deleteAccount}
            onRenameAccount={renameAccount}
            onSetAccountArchived={setAccountArchived}
            onSelectAccount={(accountId) => { setBlueprintRepairContext(null); setSelectedAccountId(accountId); }}
            accountEpisodeCount={workspace.episodes.filter((episode) => episode.account_id === selectedAccount?.id).length}
            promptVersions={workspace.promptVersions.filter((version) => version.account_id === selectedAccount?.id)}
            series={workspace.series.filter((candidate) => candidate.account_id === selectedAccount?.id)}
            seriesVersions={workspace.seriesVersions.filter((version) => version.account_id === selectedAccount?.id)}
            systemStatus={systemStatus}
            blueprintPreflight={blueprintPreflight}
            blueprintPreflightError={blueprintPreflightError}
            isBlueprintPreflightLoading={isBlueprintPreflightLoading}
            onRefreshBlueprintPreflight={() => selectedAccount ? refreshBlueprintPreflight(selectedAccount.id) : Promise.resolve()}
            externalConnections={workspace.externalConnections}
            connectionVersions={workspace.externalConnectionVersions}
            onCreateConnection={createExternalConnection}
            onRotateConnection={rotateExternalConnection}
            onTestConnection={testExternalConnection}
            onUpdateConnection={updateExternalConnection}
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
            blueprintsById={blueprintsById}
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
        </>}
      </section>

      {isEpisodeDetailOpen && selectedEpisode ? <EpisodeDetailDrawer compact={selectedEpisode.stage === "waiting_input"} isOpen={isEpisodeDetailOpen} onClose={() => setIsEpisodeDetailOpen(false)}>
          {isEpisodeDetailLoading ? <LoadingIndicator label="正在加载生产单详情…" /> : null}
          <EpisodeDetail
            artifacts={workspace.artifacts}
            audioTracks={workspace.audioTracks}
            audioTrackAnnotations={workspace.audioTrackAnnotations}
            materialRevisions={workspace.materialRevisions}
            shotPreparationDrafts={workspace.shotPreparationDrafts}
            storyboardAudioSelections={workspace.storyboardAudioSelections}
            preRenderReviewMembers={workspace.preRenderReviewMembers}
            preRenderReviewMemberDecisions={workspace.preRenderReviewMemberDecisions}
            qcReviewIssues={workspace.qcReviewIssues}
            blueprint={blueprintsById.get(selectedEpisode.blueprint_version_id) ?? null}
            durationSettings={reviewRenderDurationSettingsFromRules(selectedEpisode.series_version_id ? seriesVersionsById.get(selectedEpisode.series_version_id)?.rules : undefined)}
            episode={selectedEpisode}
            isDirectoryOpenPending={pendingAction === `directory-open-${selectedEpisode.id}`}
            isMaterialPending={pendingAction === `material-${selectedEpisode.id}`}
            isShotTtsSettingsPending={pendingAction === `episode-tts-settings-${selectedEpisode.id}`}
            isShotReviewVideoPending={pendingAction === `shot-review-video-${selectedEpisode.id}`}
            isStartProductionPending={pendingAction === `start-production-${selectedEpisode.id}`}
            isProductionTracking={productionTrackingEpisodeIds.has(selectedEpisode.id)}
            productionPreflight={productionPreflight}
            connectionVersions={workspace.externalConnectionVersions}
            isRefreshPending={pendingAction === "workspace-refresh"}
            isTransitionPending={pendingAction.startsWith(`transition-${selectedEpisode.id}-`) || pendingAction.startsWith("review-render-revision-") || pendingAction.startsWith(`final-render-retry-${selectedEpisode.id}`)}
            onOpenBlueprint={(blocker) => openAccountBlueprint(selectedEpisode.account_id, blocker.taskId ? { blocker, blueprintVersionId: selectedEpisode.blueprint_version_id, episodeId: selectedEpisode.id } : null)}
            onRepairConnection={(blocker, versionId) => repairEpisodeConnection({ blocker, episodeId: selectedEpisode.id, versionId })}
            onOpenLocalDirectory={openLocalEpisodeDirectory}
            onNotify={setMessage}
            onImportMaterial={importProductionMaterial}
            onRegisterManualMedia={registerManualMedia}
            onSaveShotPreparationDraft={saveShotPreparationDraft}
            onSaveStoryboardAudioSelection={saveStoryboardAudioSelection}
            onSaveEpisodeTtsSettings={saveEpisodeTtsSettings}
            onGenerateShotTts={generateShotTts}
            onGenerateShotReviewVideo={generateShotReviewVideo}
            onRequestShotStructureRevision={submitShotStructureRevision}
            onStartProduction={startEpisodeProduction}
            onRequestRevision={submitReviewRevision}
            onRetryFinalRender={retryFinalRender}
            onOpenStudio={openOpenChatCutStudio}
            onSubmitStudioRevision={submitStudioRevision}
            onRefresh={refreshEpisodeStatus}
            onTransition={transitionEpisode}
            ownerId={session.user.id}
            reviewPackages={workspace.reviewPackages}
            reviewAnnotations={workspace.reviewAnnotations}
            isStoryboardAnnotationPending={pendingAction.startsWith("storyboard-annotation-")}
            onCreateStoryboardAnnotation={createStoryboardAnnotation}
            onCreateAudioTrackAnnotation={createAudioTrackAnnotation}
            onCreateQcReviewIssue={createQcReviewIssue}
            onResolveQcReviewIssue={resolveQcReviewIssue}
            onRequestQcMemberRevision={requestQcMemberRevision}
            onReviewPreRenderMember={reviewPreRenderMember}
            tasks={workspace.tasks}
            taskRuns={workspace.taskRuns}
            transitions={workspace.transitions}
          />
      </EpisodeDetailDrawer> : null}

      {isPublishModalOpen && selectedEpisode ? <PublishModal
        artifacts={workspace.artifacts}
        episode={selectedEpisode}
        isPending={pendingAction === `publication-${selectedEpisode.id}`}
        isPreparationPending={pendingAction === `publish-prepare-${selectedEpisode.id}`}
        onClose={() => setIsPublishModalOpen(false)}
        onOpenArtifact={openLocalArtifact}
        onPrepare={preparePublishPackage}
        onRecord={recordManualPublication}
        publicationRecords={workspace.publicationRecords.filter((record) => record.episode_id === selectedEpisode.id)}
        publishVerification={workspace.tasks.some((task) => task.episode_id === selectedEpisode.id && task.task_type === "verify_publish_package" && task.status === "completed")}
      /> : null}

      <nav aria-label="移动端主导航" className="mobile-navigation"><NavigationButtons activeNavigation={activeNavigation} badges={navigationBadges} onSelect={changeNavigation} /></nav>

      {showEpisodeForm ? <EpisodeForm accounts={workspace.accounts.filter((account) => !account.archived_at)} blueprints={workspace.blueprints} connectionVersions={workspace.externalConnectionVersions} creationStartedAt={episodeCreationStartedAt} creationStep={episodeCreationStep} isPending={pendingAction === "episode"} onClose={() => setShowEpisodeForm(false)} onOpenBlueprint={(accountId) => { setShowEpisodeForm(false); openAccountBlueprint(accountId); }} onSubmit={createEpisode} series={workspace.series} seriesVersions={workspace.seriesVersions} /> : null}
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
    </div>
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

  return <main className="access-shell"><section className="access-card"><div className="wordmark">Loop Control</div><h1>登录控制台</h1><p>使用你的所有者邮箱登录。平台数据、审批和蓝图均受账号权限控制。</p><form onSubmit={submit}><label>邮箱<input aria-label="邮箱" autoComplete="email" onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" required type="email" value={email} /></label><label>密码<input aria-label="密码" autoComplete="current-password" onChange={(event) => setPassword(event.target.value)} placeholder="首次恢复后可设置" type="password" value={password} /></label><button className="button button-primary" disabled={pending || !password} onClick={() => void signInWithPassword()} type="button">{pending ? "登录中…" : "使用密码登录"}</button><button className="button button-secondary" disabled={pending} type="submit">{pending ? "发送中…" : "发送登录链接"}</button></form>{notice ? <p className="form-notice">{notice}</p> : null}{errorMessage ? <p className="form-error">{errorMessage}</p> : null}</section></main>;
}

export function BootstrapScreen({ errorMessage, isPending, onSubmit }: { errorMessage: string; isPending: boolean; onSubmit: (input: { name: string; slug: string; timezone: string; policy: Json }) => Promise<void> }) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [timezone, setTimezone] = useState("Asia/Shanghai");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await onSubmit({ name, slug, timezone, policy: defaultBlueprintPolicy });
  }

  return <main className="access-shell"><section className="access-card bootstrap-card"><div className="wordmark">Loop Control</div><h1>初始化首个账号</h1><p>创建后可在蓝图配置中补充生产规则。</p><form onSubmit={submit}><label>账号名称<input onChange={(event) => setName(event.target.value)} placeholder="例如：内容工作室" required value={name} /></label><label>账号标识<input onChange={(event) => setSlug(event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))} pattern="[a-z0-9]+(?:-[a-z0-9]+)*" placeholder="content-studio" required value={slug} /></label><TimezoneSelect onChange={setTimezone} value={timezone} /><p className="form-hint">选择账号日常运营和任务时间所使用的时区。</p><button className="button button-primary" disabled={isPending} type="submit">{isPending ? "初始化中…" : "创建首个账号"}</button></form>{errorMessage ? <p className="form-error">{errorMessage}</p> : null}</section></main>;
}

function LoadingScreen() { return <main className="access-shell"><div className="loading-mark">正在连接受控平台…</div></main>; }
function ErrorScreen({ errorMessage, onRetry }: { errorMessage: string; onRetry: () => Promise<void> }) { return <main className="access-shell"><section className="access-card"><h1>无法读取控制数据</h1><p className="form-error">{errorMessage}</p><button className="button button-primary" onClick={() => void onRetry()} type="button">重试</button></section></main>; }

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

export function PublishWorkspace({ accountsById, artifacts, blueprintsById = new Map(), episodes, isPending, onOpenPublish, onTransition, publicationRecords, selectedEpisode, tasks }: { accountsById: Map<string, Account>; artifacts: Artifact[]; blueprintsById?: Map<string, Blueprint>; episodes: Episode[]; isPending: string; onOpenPublish: (id: string) => void; onTransition: (episodeId: string, toStage: EpisodeStage, reason: string) => Promise<boolean>; publicationRecords: PublicationRecord[]; selectedEpisode: Episode | null; tasks: Task[] }) {
  const queue = episodes.filter((episode) => episode.stage === "qc_passed" || episode.stage === "publish_ready" || episode.stage === "publishing_review" || episode.stage === "published");
  async function advanceEpisode(episode: Episode, toStage: EpisodeStage, reason: string) { if (await onTransition(episode.id, toStage, reason)) onOpenPublish(episode.id); }
  return <><p className="muted-copy">打开生产单即可填写发布标题、简介、标签并上传 JPG、PNG 或 WebP 封面；系统会在本机生成并校验发布包。控制台不会连接或点击任何发布平台。</p><div className="publish-queue">{queue.map((episode) => {
    const latestPublication = publicationRecords.filter((record) => record.episode_id === episode.id).sort((left, right) => right.created_at.localeCompare(left.created_at))[0];
    const hasPublishPackage = artifacts.some((artifact) => artifact.episode_id === episode.id && artifact.artifact_type === "publish_package");
    const hasPublishVerification = tasks.some((task) => task.episode_id === episode.id && task.task_type === "verify_publish_package" && task.status === "completed");
    const publishGateEnabled = blueprintApprovalGateEnabled(blueprintsById.get(episode.blueprint_version_id), "publish");
    return <article className={`publish-card ${selectedEpisode?.id === episode.id ? "is-selected" : ""}`} key={episode.id}><button className="publish-card-summary" onClick={() => onOpenPublish(episode.id)} type="button"><strong>{episode.title}</strong><span>{accountsById.get(episode.account_id)?.name ?? "未知账号"} · {stageLabels[episode.stage]}</span><small>{latestPublication ? `已发布 · ${latestPublication.platform} · ${latestPublication.published_at ? formatDate(latestPublication.published_at) : "时间未记录"}` : hasPublishPackage ? "发布包已固定" : "缺少发布包索引"}</small></button>{latestPublication?.external_url ? <a className="publish-card-link" href={latestPublication.external_url} rel="noreferrer" target="_blank">外部记录 ↗</a> : null}{episode.stage === "qc_passed" ? <button className="button button-secondary" disabled={!hasPublishPackage || !hasPublishVerification || isPending === `transition-${episode.id}-publish_ready`} onClick={() => void advanceEpisode(episode, "publish_ready", "已复核固定发布包，进入待发布。")} type="button">进入待发布</button> : episode.stage === "publish_ready" && publishGateEnabled ? <button className="button button-secondary" disabled={isPending === `transition-${episode.id}-publishing_review`} onClick={() => void advanceEpisode(episode, "publishing_review", "发布包已固定，等待 Owner 的人工发布确认。")} type="button">进入发布确认</button> : episode.stage === "publish_ready" ? <button className="button button-secondary" disabled={isPending === `publication-${episode.id}`} onClick={() => onOpenPublish(episode.id)} type="button">登记外部发布</button> : episode.stage === "publishing_review" ? <button className="button button-secondary" disabled={isPending === `publication-${episode.id}`} onClick={() => onOpenPublish(episode.id)} type="button">打开发布弹窗</button> : <p className="publish-card-hint">发布记录已固定</p>}</article>;
  })}</div>{queue.length === 0 ? <div className="empty-state compact"><h2>没有待确认发布</h2><p>完成 QC 后，生产单会在这里提供发布材料登记与发布包生成入口。</p></div> : null}</>;
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

type UtilityPanelKind = "artifacts" | "timeline";

const approvalGateDefinitions = [
  { key: "script", label: "脚本审核", reviewStage: "script_review" },
  { key: "visual", label: "视觉审核", reviewStage: "visual_review" },
  { key: "storyboard", label: "分镜审核", reviewStage: "storyboard_review" },
  { key: "qc", label: "QC 审核", reviewStage: "qc_review" },
  { key: "publish", label: "发布确认", reviewStage: "publishing_review" },
] as const;

function CurrentApprovalGate({ blueprint, episode }: { blueprint: Blueprint | null; episode: Episode }) {
  const gate = approvalGateDefinitions.find((candidate) => candidate.reviewStage === episode.stage && blueprintApprovalGateEnabled(blueprint ?? undefined, candidate.key));
  if (!gate) return null;
  return <div aria-live="polite" className="episode-current-approval"><span>当前审核</span><strong>{gate.label}</strong><p>需要你审核</p></div>;
}

const taskAuditStages: Record<string, EpisodeStage[]> = {
  draft_brief: ["brief_draft", "script_draft"],
  draft_script: ["script_review", "script_draft"],
  prepare_visual_brief: ["visual_review", "visual_draft", "visual_approved"],
  draft_storyboard: ["storyboard_review", "storyboard_draft", "storyboard_approved"],
  generate_a_roll: ["production_ready", "storyboard_approved"],
  generate_b_roll: ["production_ready", "storyboard_approved"],
  generate_narration: ["production_ready", "storyboard_approved"],
  extract_embedded_audio: ["production_ready", "storyboard_approved"],
  generate_soundtrack: ["production_ready", "storyboard_approved"],
  generate_review_render: ["qc_review", "render_ready", "production_ready"],
  generate_final_render: ["qc_passed", "render_ready"],
  prepare_publish_package: ["publish_ready", "qc_passed"],
  verify_publish_package: ["publish_ready", "qc_passed"],
  register_publish_input: ["publishing_review", "published", "publish_ready"],
};

function taskAuditTimestamp(task: Task): number {
  return new Date(task.completed_at ?? task.claimed_at ?? task.created_at).getTime();
}

function tasksByAuditTransition(timeline: Transition[], tasks: Task[]): Map<string, Task[]> {
  const result = new Map<string, Task[]>();
  if (!timeline.length) return result;
  for (const task of tasks) {
    const preferredStages = taskAuditStages[task.task_type] ?? [];
    const preferredTransitions = timeline.filter((transition) => preferredStages.includes(transition.to_stage));
    const candidates = preferredTransitions.length ? preferredTransitions : timeline;
    const taskTime = taskAuditTimestamp(task);
    const transition = candidates.reduce((closest, candidate) => Math.abs(new Date(candidate.created_at).getTime() - taskTime) < Math.abs(new Date(closest.created_at).getTime() - taskTime) ? candidate : closest);
    result.set(transition.id, [...(result.get(transition.id) ?? []), task]);
  }
  return result;
}

function EpisodeUtilityPopover({ artifacts, dispatchRequested, history, kind, onClose, taskRuns, tasks }: { artifacts: Artifact[]; dispatchRequested: boolean; history: Transition[]; kind: UtilityPanelKind; onClose: () => void; taskRuns: TaskRun[]; tasks: Task[] }) {
  const timeline = history.slice().sort((left, right) => right.created_at.localeCompare(left.created_at));
  const transitionTasks = tasksByAuditTransition(timeline, tasks);
  const heading = kind === "artifacts" ? "产物索引" : "审计时间线";

  return <div aria-label={heading} className={`episode-utility-popover episode-utility-popover-${kind}`} role="dialog"><header><strong>{heading}</strong><button aria-label={`关闭${heading}`} className="icon-button" onClick={onClose} type="button"><X className="icon" /></button></header>{kind === "artifacts" ? <div className="episode-utility-artifacts">{artifacts.length ? artifacts.map((artifact) => <Artifact complete key={artifact.id} label={artifact.artifact_type} name={artifact.relative_path} />) : <div className="episode-utility-summary"><strong>尚无产物</strong><p>Worker 尚未生成可查看的产物。</p></div>}</div> : <section aria-labelledby="episode-state-history-heading" className="episode-state-history"><h3 id="episode-state-history-heading">状态变化与任务执行</h3>{dispatchRequested && !tasks.length ? <p aria-live="polite" className="timeline-dispatch-status">已提交即时派发，正在等待编排器创建任务记录。</p> : null}{timeline.length ? <ol className="timeline">{timeline.map((transition) => { const attachedTasks = transitionTasks.get(transition.id) ?? []; return <li key={transition.id}><i className={`timeline-dot ${stageTone(transition.to_stage)}`} /><div className="timeline-entry"><strong>{stageLabels[transition.to_stage]}</strong><span>{userFacingTransitionReason(transition.reason)}</span>{attachedTasks.length ? <div aria-label={`${stageLabels[transition.to_stage]}任务记录`} className="timeline-task-details">{attachedTasks.map((task) => <TaskTimelineDetail key={task.id} task={task} taskRuns={taskRuns} />)}</div> : null}</div><time>{formatDate(transition.created_at)}</time></li>; })}</ol> : <div className="episode-utility-summary"><strong>暂无状态变化</strong><p>生产单创建、任务执行和状态变化会显示在这里。</p></div>}</section>}</div>;
}

export function EpisodeDetail({ artifacts, audioTrackAnnotations, audioTracks, blueprint, connectionVersions = [], durationSettings = defaultReviewRenderDurationSettings, episode, isDirectoryOpenPending = false, isMaterialPending, isProductionTracking = false, isRefreshPending = false, isShotReviewVideoPending = false, isShotTtsSettingsPending = false, isStartProductionPending = false, isStoryboardAnnotationPending, isTransitionPending, materialRevisions = [], onCreateAudioTrackAnnotation, onCreateQcReviewIssue = async () => {}, onOpenBlueprint, onOpenStudio = async () => { throw new Error("当前无法打开 OpenChatCut。"); }, onOpenLocalDirectory = async () => {}, onNotify = () => {}, onCreateStoryboardAnnotation, onImportMaterial, onRegisterManualMedia = async () => {}, onGenerateShotTts = async () => {}, onGenerateShotReviewVideo = async () => {}, onRequestShotStructureRevision = async () => {}, onRefresh = async () => {}, onRequestQcMemberRevision = async () => {}, onRequestRevision, onRepairConnection, onRetryFinalRender = async () => false, onSaveShotPreparationDraft = async () => {}, onSaveEpisodeTtsSettings = async () => {}, onSaveStoryboardAudioSelection = async () => {}, onSubmitStudioRevision = async () => { throw new Error("当前无法提交 Studio 修订。"); }, onResolveQcReviewIssue = async () => {}, onReviewPreRenderMember = async () => {}, onStartProduction = async () => {}, onTransition, ownerId = "local-owner", preRenderReviewMemberDecisions = [], preRenderReviewMembers = [], productionPreflight = null, qcReviewIssues = [], reviewAnnotations, reviewPackages, shotPreparationDrafts = [], storyboardAudioSelections = [], taskRuns = [], tasks, transitions }: { artifacts: Artifact[]; audioTrackAnnotations: AudioTrackAnnotation[]; audioTracks: AudioTrack[]; blueprint: Blueprint | null; connectionVersions?: ExternalConnectionVersion[]; durationSettings?: ReviewRenderDurationSettings; episode: Episode; isDirectoryOpenPending?: boolean; isMaterialPending: boolean; isProductionTracking?: boolean; isRefreshPending?: boolean; isShotReviewVideoPending?: boolean; isShotTtsSettingsPending?: boolean; isStartProductionPending?: boolean; isStoryboardAnnotationPending: boolean; isTransitionPending: boolean; materialRevisions?: MaterialRevision[]; onCreateAudioTrackAnnotation: (input: AudioTrackAnnotationRequest) => Promise<void>; onCreateQcReviewIssue?: (input: QcReviewIssueRequest) => Promise<void>; onOpenBlueprint?: (blocker: WorkerBlocker) => void; onOpenStudio?: (episodeId: string, projectRelativePath: string) => Promise<OpenChatCutStudioWorkspace>; onOpenLocalDirectory?: (episodeId: string) => Promise<void>; onNotify?: (message: string) => void; onCreateStoryboardAnnotation: (input: StoryboardAnnotationRequest) => Promise<void>; onImportMaterial: MaterialImportHandler; onRegisterManualMedia?: (input: ManualMediaBindingRequest) => Promise<void>; onGenerateShotTts?: (input: ShotTtsGenerationRequest) => Promise<void>; onGenerateShotReviewVideo?: (input: ShotReviewVideoRequest) => Promise<void>; onRequestShotStructureRevision?: (input: ShotStructureRevisionRequest) => Promise<void>; onRefresh?: () => Promise<void>; onRepairConnection?: (blocker: WorkerBlocker, versionId: string) => Promise<void>; onRequestRevision: (input: ReviewRevisionRequest) => Promise<ReviewRevisionOutcome>; onRequestQcMemberRevision?: (issueId: string) => Promise<void>; onRetryFinalRender?: (episodeId: string, reason: string) => Promise<boolean>; onSaveShotPreparationDraft?: (input: ShotPreparationDraftRequest) => Promise<void>; onSaveEpisodeTtsSettings?: (input: { episodeId: string; languageCode: string; speakingRate: number; voice: string }) => Promise<void>; onSaveStoryboardAudioSelection?: (input: StoryboardAudioSelectionRequest) => Promise<void>; onSubmitStudioRevision?: (input: Omit<StudioReviewRevisionRequest, "accessToken">) => Promise<ReviewRevisionOutcome>; onResolveQcReviewIssue?: (issueId: string, status: "accepted" | "ignored") => Promise<void>; onReviewPreRenderMember?: (input: PreRenderMemberReviewRequest) => Promise<void>; onStartProduction?: (episodeId: string) => Promise<void>; onTransition: (episodeId: string, toStage: EpisodeStage, reason: string) => Promise<boolean>; ownerId?: string; preRenderReviewMemberDecisions?: PreRenderMemberDecision[]; preRenderReviewMembers?: PreRenderReviewMember[]; productionPreflight?: WorkerPreflightResult | null; qcReviewIssues?: QcReviewIssues[]; reviewAnnotations: ReviewAnnotation[]; reviewPackages: ReviewPackage[]; shotPreparationDrafts?: ShotPreparationDraft[]; storyboardAudioSelections?: StoryboardAudioSelection[]; taskRuns?: TaskRun[]; tasks: Task[]; transitions: Transition[] }) {
  void onCreateQcReviewIssue;
  void onRequestQcMemberRevision;
  void onResolveQcReviewIssue;
  const [showShotWorkbench, setShowShotWorkbench] = useState(episode.stage === "storyboard_approved");
  useEffect(() => { setShowShotWorkbench(episode.stage === "storyboard_approved"); }, [episode.id]);
  const episodeArtifacts = artifacts.filter((artifact) => artifact.episode_id === episode.id);
  const history = transitions.filter((transition) => transition.episode_id === episode.id);
  const blockers = workerBlockers(tasks, episode.id);
  const blockerGroups = groupWorkerBlockers(blockers);
  const productionBlockers = workerBlockersFromPreflight(productionPreflight);
  const episodeTasks = tasks.filter((task) => task.episode_id === episode.id);
  const episodeTaskIds = new Set(episodeTasks.map((task) => task.id));
  const episodeTaskRuns = taskRuns.filter((run) => episodeTaskIds.has(run.task_id));
  const workerStatus = episodeWorkerStatus(episode, episodeTasks);
  const workerIsActive = episodeTasks.some((task) => task.status === "ready" || task.status === "running");
  const latestFinalRender = episodeTasks.filter((task) => task.task_type === "generate_final_render").reduce<Task | null>((latest, task) => !latest || task.created_at > latest.created_at ? task : latest, null);
  const failedFinalRender = episode.stage === "qc_passed" && latestFinalRender?.status === "failed";
  const reviewAction = reviewActionFor(episode.stage);
  const currentPackage = currentReviewPackage(reviewPackages, episode);
  const storyboardPackage = reviewPackages.filter((candidate) => candidate.episode_id === episode.id && candidate.stage === "storyboard_review" && !candidate.invalidated_at).reduce<ReviewPackage | null>((latest, candidate) => !latest || candidate.revision_number > latest.revision_number ? candidate : latest, null);
  const failedReviewRender = episode.stage === "render_ready" && episodeTasks.some((task) => task.task_type === "generate_review_render" && task.status === "failed");
  const recoveryPackage = failedReviewRender ? reviewPackages.filter((candidate) => candidate.episode_id === episode.id && candidate.stage === "qc_review" && !candidate.invalidated_at && isEditorReviewRender(candidate.context_snapshot)).reduce<ReviewPackage | null>((latest, candidate) => !latest || candidate.revision_number > latest.revision_number ? candidate : latest, null) : null;
  const reviewPackage = currentPackage ?? (episode.stage === "storyboard_approved" ? storyboardPackage : null) ?? recoveryPackage;
  const effectiveReviewAction = reviewAction ?? (recoveryPackage ? { approveStage: "qc_passed", requestChangesStage: "render_ready" } : null);
  const reviewArtifact = reviewPackage ? episodeArtifacts.find((candidate) => candidate.id === reviewPackage.artifact_id) : null;
  const latestVisualPackage = reviewPackages.filter((candidate) => candidate.episode_id === episode.id && candidate.stage === "visual_review" && !candidate.invalidated_at).reduce<ReviewPackage | null>((latest, candidate) => !latest || candidate.revision_number > latest.revision_number ? candidate : latest, null);
  const visualChecklistArtifact = latestVisualPackage ? episodeArtifacts.find((candidate) => candidate.id === latestVisualPackage.artifact_id) : null;
  const reviewArtifacts = reviewPackage ? episodeArtifacts.filter((candidate) => candidate.producer_task_id === reviewPackage.task_id) : [];
  const storyboardAnnotations = reviewPackage ? reviewAnnotations.filter((annotation) => annotation.review_package_id === reviewPackage.id) : [];
  const episodeShotPreparationDrafts = shotPreparationDrafts.filter((draft) => draft.episode_id === episode.id);
  const storyboardArtifact = storyboardPackage ? episodeArtifacts.find((candidate) => candidate.id === storyboardPackage.artifact_id) : null;
  const canReturnToShotWorkbench = (episode.stage === "production_ready" || episode.stage === "render_ready" || episode.stage === "qc_review") && Boolean(storyboardPackage && storyboardArtifact);
  const preRenderMembers = reviewPackage?.stage === "production_ready" ? preRenderReviewMembers.filter((member) => member.review_package_id === reviewPackage.id) : [];
  const preRenderMemberDecisions = reviewPackage?.stage === "production_ready" ? preRenderReviewMemberDecisions.filter((decision) => decision.review_package_id === reviewPackage.id) : [];
  const qcIssues = reviewPackage?.stage === "qc_review" ? qcReviewIssues.filter((issue) => issue.review_package_id === reviewPackage.id) : [];
  const hasOpenQcBlockers = qcIssues.some((issue) => issue.status === "open" && issue.severity === "blocking");
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
  const episodeMaterials = materialRevisions.filter((material) => material.episode_id === episode.id);
  const episodeAudioTracks = audioTracks.filter((track) => track.episode_id === episode.id);
  const standaloneAudioTracks = episodeAudioTracks.filter((track) => track.track_kind === "bgm" || track.track_kind === "sfx");
  const publishStage = episode.stage === "qc_passed" || episode.stage === "publish_ready" || episode.stage === "publishing_review" || episode.stage === "published";
  const hasPublishPackage = episodeArtifacts.some((artifact) => artifact.artifact_type === "publish_package");
  const hasPublishVerification = episodeTasks.some((task) => task.task_type === "verify_publish_package" && task.status === "completed");
  const missingPublishInputs = [episodeArtifacts.some((artifact) => artifact.artifact_type === "cover") ? "" : "封面", episodeArtifacts.some((artifact) => artifact.artifact_type === "metadata") ? "" : "发布元数据"].filter(Boolean);
  const publishNextStep = !hasPublishPackage ? `缺少发布包${missingPublishInputs.length ? `（先补 ${missingPublishInputs.join("、")}）` : ""}` : !hasPublishVerification ? "校验发布包" : episode.stage === "published" ? "查看发布登记" : "打开发布确认并登记实际发布";
  const nextStep = blockers.length ? "先处理 Worker 阻塞项" : inputReadyToStart ? "确认材料并开始制作" : publishStage ? publishNextStep : nextStepForEpisode(episode.stage);
  const hasCurrentApprovalGate = approvalGateDefinitions.some((candidate) => candidate.reviewStage === episode.stage && blueprintApprovalGateEnabled(blueprint ?? undefined, candidate.key));
  const materialsSection = <details className="review-section detail-card-collapsible historical-stage-card" open={waitingForMainScript || inputReadyToStart}>
    <summary><h3>准备生产材料</h3></summary>
    <div className="detail-card-body">
      {waitingForMainScript ? <>
        <p className="material-import-subtitle">主脚本由外部制作后上传；确认后会作为本生产单不可变输入。</p>
        <MaterialImportForm allowMainScript bindingStatuses={materialBindingStatuses(episodeTasks)} episodeId={episode.id} existingMaterials={episodeMaterials} isPending={isMaterialPending} onBatchComplete={onRefresh} onImport={onImportMaterial} onNotify={onNotify} />
      </> : <>
        <p className="material-import-subtitle">主脚本已确认。你可以继续添加补充材料；所有材料准备好后，点击下方按钮，Worker 才会开始制作。</p>
        <MaterialImportForm allowMainScript={false} bindingStatuses={materialBindingStatuses(episodeTasks)} episodeId={episode.id} existingMaterials={episodeMaterials} isPending={isMaterialPending} onBatchComplete={onRefresh} onImport={onImportMaterial} onNotify={onNotify} />
      </>}
      {inputReadyToStart ? <>
        <div className="production-start-gate"><div><strong>材料已准备到可开始状态</strong><p>确认后将先检查本机 Worker 的真实运行态；检查通过后才推进生产单。</p></div><button className="button button-primary" disabled={isStartProductionPending} onClick={() => void onStartProduction(episode.id)} type="button">{isStartProductionPending ? "检查并开始中…" : "材料准备完成，开始制作"}</button></div>
        {productionPreflight ? <div aria-live="polite" className={`production-preflight ${productionBlockers.length ? "is-blocked" : "is-passed"}`}><strong>生产前运行态检查：{productionBlockers.length ? `未通过（${productionBlockers.length}）` : "已通过"}</strong><p>已检查当前冻结蓝图对应的 Worker 注册、工具白名单、凭据存在性、有效性、模型权限、网络连通性和媒体库；实际媒体搜索、下载和产物验证仍在任务执行阶段确认。</p>{productionBlockers.map((blocker) => <WorkerBlockerCard blocker={blocker} connectionVersions={connectionVersionsForBlocker(blocker, episodeTasks, connectionVersions)} key={`${blocker.code}-${blocker.capability}`} onOpenBlueprint={onOpenBlueprint} onRepairConnection={onRepairConnection} />)}</div> : null}
      </> : null}
    </div>
  </details>;

  return <>
    <header className="review-heading"><div className="review-heading-copy"><h2>{episode.title || "未命名生产单"}</h2><span>{episode.id.slice(0, 8)}</span></div></header>
    <div aria-label="生产单操作" className="episode-detail-toolbar"><div className="episode-toolbar-actions"><button aria-label="刷新生产单状态" className="icon-button episode-toolbar-button" disabled={isRefreshPending} onClick={() => void onRefresh()} title="刷新状态" type="button"><RefreshCw className="icon" /></button><button aria-label="打开本地输入目录" className="icon-button episode-toolbar-button" disabled={isDirectoryOpenPending} onClick={() => void onOpenLocalDirectory(episode.id)} title={`打开本地输入目录：${localInputPath}`} type="button"><FolderOpen className="icon" /></button><button aria-label="复制本地输入目录路径" className="icon-button episode-toolbar-button" onClick={() => void copyLocalInputPath()} title={`复制本地输入目录路径：${localInputPath}`} type="button"><Copy className="icon" /></button><button aria-expanded={openUtilityPanel === "artifacts"} aria-haspopup="dialog" aria-label="查看产物索引" className="icon-button episode-toolbar-button" onClick={() => setOpenUtilityPanel((current) => current === "artifacts" ? null : "artifacts")} title="查看产物索引" type="button"><ClipboardList className="icon" /></button><button aria-expanded={openUtilityPanel === "timeline"} aria-haspopup="dialog" aria-label="查看执行与审计时间线" className="icon-button episode-toolbar-button" onClick={() => setOpenUtilityPanel((current) => current === "timeline" ? null : "timeline")} title="查看执行与审计时间线" type="button"><History className="icon" /></button></div>{directoryMessage ? <span className="episode-toolbar-status" role="status">{directoryMessage}</span> : null}{openUtilityPanel ? <EpisodeUtilityPopover artifacts={episodeArtifacts} dispatchRequested={isProductionTracking} history={history} kind={openUtilityPanel} onClose={() => setOpenUtilityPanel(null)} taskRuns={episodeTaskRuns} tasks={episodeTasks} /> : null}</div>
    <p className="review-meta">蓝图 v{blueprint?.version ?? "—"} · 创建于 {formatDate(episode.created_at)}</p>
    <section className={`episode-next-step-card${hasCurrentApprovalGate ? " has-approval" : ""}`}><div><span>当前阶段</span><strong className={`stage stage-${stageTone(episode.stage)}`}>{stageLabels[episode.stage]}</strong></div><div><span>下一步</span><p>{nextStep}</p></div><CurrentApprovalGate blueprint={blueprint} episode={episode} /><div aria-live="polite" className={`episode-worker-status episode-worker-status-${workerStatus.tone}`}><span>当前任务</span><strong>{workerStatus.label}</strong><p>{workerStatus.detail}</p>{workerIsActive || isProductionTracking ? <small className="worker-refresh-feedback"><i aria-hidden="true" />页面每 10 秒自动刷新任务状态</small> : null}</div></section>
    {publishStage ? <section className={`publish-readiness-card ${hasPublishPackage && hasPublishVerification ? "is-ready" : "is-missing"}`}><div><strong>{hasPublishPackage && hasPublishVerification ? "发布材料已就绪" : "发布流程尚未完成"}</strong><p>系统状态正常只表示当前 Worker 与基础设施没有阻塞；发布包、校验和人工发布登记是独立门槛。</p><span>封面 {missingPublishInputs.includes("封面") ? "缺少" : "已索引"} · 元数据 {missingPublishInputs.includes("发布元数据") ? "缺少" : "已索引"} · 发布包 {hasPublishPackage ? "已固定" : "缺少"} · 校验 {hasPublishVerification ? "通过" : "未通过"}</span></div><button className="button button-secondary" onClick={() => window.dispatchEvent(new CustomEvent("open-publish", { detail: episode.id }))} type="button">{episode.stage === "published" ? "查看发布登记" : "查看发布准备 / 登记"}</button></section> : null}
    {blockers.length ? <details className="review-section worker-blockers detail-card-collapsible" open><summary><h3>优先处理 Worker 阻塞项（{blockers.length}）</h3></summary><div className="detail-card-body">{blockerGroups.map(({ blocker, count }) => <WorkerBlockerCard affectedTaskCount={count} blocker={blocker} connectionVersions={connectionVersionsForBlocker(blocker, episodeTasks, connectionVersions)} onOpenBlueprint={onOpenBlueprint} onRepairConnection={onRepairConnection} key={`${blocker.code}-${blocker.detail}`} />)}</div></details> : null}
    {episode.stage === "waiting_input" ? materialsSection : null}
    {canReturnToShotWorkbench ? <section className="review-section shot-workbench-return"><div><h3>镜头工作台</h3><p className="muted-copy">当前审核证据保持不变；返回后可修改基础素材并生成新的冻结审核快照。</p></div><button aria-expanded={showShotWorkbench} className="button button-secondary" onClick={() => setShowShotWorkbench((current) => !current)} type="button">{showShotWorkbench ? "收起镜头工作台" : "返回镜头工作台修改"}</button></section> : null}
    {showShotWorkbench && storyboardPackage && storyboardArtifact ? <ShotWorkbench artifact={storyboardArtifact} audioSelections={storyboardAudioSelections.filter((selection) => selection.review_package_id === storyboardPackage.id)} audioTracks={episodeAudioTracks} blueprint={blueprint?.policy} durationSettings={durationSettings} drafts={episodeShotPreparationDrafts} episode={episode} isMaterialPending={isMaterialPending} isReviewVideoPending={isShotReviewVideoPending} isTtsSettingsPending={isShotTtsSettingsPending} materialRevisions={episodeMaterials} onGenerateTts={onGenerateShotTts} onGenerateReviewVideo={onGenerateShotReviewVideo} onImportMaterial={onImportMaterial} onOpenStudio={onOpenStudio} onSave={onSaveShotPreparationDraft} onSaveEpisodeTtsSettings={onSaveEpisodeTtsSettings} onSaveStoryboardAudioSelection={onSaveStoryboardAudioSelection} onRequestShotStructureRevision={onRequestShotStructureRevision} reviewPackage={storyboardPackage} tasks={episodeTasks} /> : null}
    {latestVisualPackage && visualChecklistArtifact && reviewPackage?.stage !== "visual_review" ? <details className="review-section detail-card-collapsible visual-checklist-card" open={episode.stage === "visual_approved"}><summary><h3>视觉清单</h3></summary><div className="detail-card-body"><p className="muted-copy">这是 Worker 根据已确认脚本、系列规则和冻结素材整理的制作依据；它不是生成图片或视频的预览。</p><VisualReviewPackage artifact={visualChecklistArtifact} artifacts={episodeArtifacts.filter((candidate) => candidate.producer_task_id === latestVisualPackage.task_id)} reviewPackage={latestVisualPackage} /></div></details> : null}
    {episode.stage !== "waiting_input" ? materialsSection : null}
    {episode.stage !== "waiting_input" && reviewPackage?.stage !== "visual_review" && reviewPackage?.stage !== "storyboard_review" && episodeArtifacts.some((candidate) => artifactPreviewKind(candidate.relative_path)) ? <details className="review-section detail-card-collapsible"><summary><h3>生成媒体预览</h3></summary><div className="detail-card-body"><p className="muted-copy">这里只展示 Worker 已登记的图片、视频或音频产物；上传材料请在“准备生产材料”中预览。</p><ArtifactPreview artifacts={episodeArtifacts} /></div></details> : null}
    {reviewPackage?.stage === "production_ready" ? <PreRenderReviewPackage artifacts={episodeArtifacts} decisions={preRenderMemberDecisions} isTransitionPending={isTransitionPending} members={preRenderMembers} onReviewMember={onReviewPreRenderMember} onTransition={onTransition} reviewPackage={reviewPackage} /> : reviewPackage && reviewArtifact && episode.stage !== "storyboard_approved" ? reviewPackage.stage === "qc_review" && isEditorReviewRender(reviewPackage.context_snapshot) ? <OpenChatCutReviewRenderPackage artifact={reviewArtifact} artifacts={reviewArtifacts} onOpenStudio={onOpenStudio} onRequestRevision={onRequestRevision} onSubmitStudioRevision={onSubmitStudioRevision} reviewPackage={reviewPackage} tasks={episodeTasks} /> : reviewPackage.stage === "visual_review" ? <VisualReviewPackage artifact={reviewArtifact} artifacts={reviewArtifacts} reviewPackage={reviewPackage} /> : reviewPackage.stage === "storyboard_review" ? <StoryboardReviewPackage annotations={storyboardAnnotations} artifact={reviewArtifact} episode={episode} isAnnotationPending={isStoryboardAnnotationPending} materialRevisions={materialRevisions.filter((material) => material.episode_id === episode.id)} onCreateAnnotation={onCreateStoryboardAnnotation} onRegisterManualMedia={onRegisterManualMedia} onValidationChange={onStoryboardValidationChange} policy={blueprint?.policy} reviewPackage={reviewPackage} tasks={episodeTasks} /> : <TextReviewPackage artifact={reviewArtifact} reviewPackage={reviewPackage} /> : null}
    <ArollTaskEvidencePanel tasks={episodeTasks} />
    {!showShotWorkbench ? <AudioTrackPanel annotations={audioTrackAnnotations.filter((annotation) => standaloneAudioTracks.some((track) => track.id === annotation.audio_track_id))} onCreateAnnotation={onCreateAudioTrackAnnotation} tasks={episodeTasks} tracks={standaloneAudioTracks} /> : null}
    {failedFinalRender ? <FinalRenderRetryAction episodeId={episode.id} isPending={isTransitionPending} onRetry={onRetryFinalRender} /> : null}
    {effectiveReviewAction && isStoryboardReviewValid ? <ReviewActions episode={episode} hasOpenQcBlockers={hasOpenQcBlockers} isPending={isTransitionPending} onRequestRevision={onRequestRevision} onTransition={onTransition} ownerId={ownerId} reviewAction={effectiveReviewAction} reviewPackageId={reviewPackage?.id ?? null} /> : null}
  </>;
}

function isEditorReviewRender(value: unknown): boolean {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && "review_kind" in value && (value.review_kind === "openchatcut_review_render"));
}


function isQcOnlyPreRender(value: Json): boolean {
  return Boolean(value && !Array.isArray(value) && typeof value === "object" && value.approval_mode === "qc_only");
}

function OpenChatCutReviewRenderPackage({ artifact, artifacts, onOpenStudio, onRequestRevision, onSubmitStudioRevision, reviewPackage, tasks }: { artifact: Artifact; artifacts: Artifact[]; onOpenStudio: (episodeId: string, projectRelativePath: string) => Promise<OpenChatCutStudioWorkspace>; onRequestRevision: (input: ReviewRevisionRequest) => Promise<ReviewRevisionOutcome>; onSubmitStudioRevision: (input: Omit<StudioReviewRevisionRequest, "accessToken">) => Promise<ReviewRevisionOutcome>; reviewPackage: ReviewPackage; tasks: Task[] }) {
  const context = reviewPackage.context_snapshot && typeof reviewPackage.context_snapshot === "object" && !Array.isArray(reviewPackage.context_snapshot) ? reviewPackage.context_snapshot as Record<string, unknown> : null;
  const projectRevision = context && typeof context.project_revision === "string" ? context.project_revision : "—";
  const upstreamPackage = context && typeof context.pre_render_review_package_id === "string" ? context.pre_render_review_package_id : "—";
  const projectPath = context && typeof context.project_relative_path === "string" ? context.project_relative_path : "—";
  const checks = context && context.technical_evidence && typeof context.technical_evidence === "object" && !Array.isArray(context.technical_evidence) && Array.isArray((context.technical_evidence as Record<string, unknown>).checks) ? (context.technical_evidence as { checks: Array<{ name?: unknown; detail?: unknown }> }).checks : [];
  const qcReport = artifacts.find((candidate) => candidate.artifact_type === "review_qc_report");
  return <section className="review-section review-render-package"><h3>OpenChatCut 审核渲染 · 工程 v{projectRevision}</h3><QcEditingDesk artifact={artifact} onOpenStudio={onOpenStudio} onRequestRevision={onRequestRevision} onSubmitStudioRevision={onSubmitStudioRevision} projectPath={projectPath} reviewPackage={reviewPackage} tasks={tasks} /><dl><div><dt>上游审核包</dt><dd>{upstreamPackage}</dd></div><div><dt>冻结工程</dt><dd>{projectPath}</dd></div><div><dt>渲染产物</dt><dd>{artifact.relative_path}</dd></div><div><dt>QC 报告</dt><dd>{qcReport?.relative_path ?? "缺少 QC 报告"}</dd></div></dl><h4>技术 QC</h4>{checks.length ? <ul className="technical-evidence">{checks.map((check, index) => <li key={`${String(check.name)}-${index}`}><strong>{typeof check.name === "string" ? check.name : "check"}</strong><span>{typeof check.detail === "string" ? check.detail : "证据格式无效。"}</span></li>)}</ul> : <p className="form-error">QC 报告格式无效。</p>}</section>;
}


function QcEditingDesk({ artifact, onOpenStudio, onRequestRevision, onSubmitStudioRevision, projectPath, reviewPackage, tasks }: { artifact: Artifact; onOpenStudio: (episodeId: string, projectRelativePath: string) => Promise<OpenChatCutStudioWorkspace>; onRequestRevision: (input: ReviewRevisionRequest) => Promise<ReviewRevisionOutcome>; onSubmitStudioRevision: (input: Omit<StudioReviewRevisionRequest, "accessToken">) => Promise<ReviewRevisionOutcome>; projectPath: string; reviewPackage: ReviewPackage; tasks: Task[] }) {
  const [workspace, setWorkspace] = useState<OpenChatCutStudioWorkspace | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [isPending, setIsPending] = useState(false);
  const [submissionKind, setSubmissionKind] = useState<"composition" | "storyboard" | null>(null);
  const composition = reviewRenderCompositionFromTask(tasks.find((task) => task.id === reviewPackage.task_id));
  async function openStudio() {
    if (projectPath === "—") { setError("当前审核包缺少 OpenChatCut 工程路径。"); return; }
    setIsPending(true); setError("");
    try { setWorkspace(await onOpenStudio(artifact.episode_id, projectPath)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "无法打开 OpenChatCut。"); }
    finally { setIsPending(false); }
  }
  async function submitStudioRevision() {
    if (!workspace || !reason.trim() || !submissionKind) { setError("请说明本次 Studio 修改。"); return; }
    setIsPending(true); setError("");
    try {
      if (submissionKind === "composition") {
        await onSubmitStudioRevision({ composition, episodeId: artifact.episode_id, reason: reason.trim(), reviewPackageId: reviewPackage.id, sourceProjectRelativePath: projectPath, workspaceRelativePath: workspace.relativePath });
      } else {
        await onRequestRevision({ kind: "storyboard", reason: reason.trim(), reviewPackageId: reviewPackage.id });
        setSubmissionKind(null);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法提交 Studio 修订。");
    } finally {
      setIsPending(false);
    }
  }
  return <section className="openchatcut-studio-launch"><h3>在 OpenChatCut 编辑</h3><p className="muted-copy">可在同一原片内延长、缩短或移动片段标记；更换原片请返回分镜工作台。每次提交都会冻结一个新工程版本。</p><button className="button button-primary" disabled={isPending} onClick={() => void openStudio()} type="button">在 OpenChatCut 中打开</button>{workspace ? <div className="studio-submit"><p>已创建可编辑副本：<code>{workspace.relativePath}</code></p><button className="button button-secondary" disabled={isPending} onClick={() => setSubmissionKind("composition")} type="button">提交 OpenChatCut 修改</button></div> : null}{submissionKind ? <div aria-label="提交 OpenChatCut 修改" aria-modal="true" className="studio-revision-dialog" role="dialog"><h4>提交 OpenChatCut 修改</h4><p className="muted-copy">请选择本次修改影响的范围。该选择只在提交时确认一次。</p><div className="studio-revision-options"><label><input checked={submissionKind === "composition"} name="studio-revision-kind" onChange={() => setSubmissionKind("composition")} type="radio" value="composition" /><span className="studio-revision-option-copy"><strong>仅合成修订</strong><small>保留分镜结构，可调整同一原片内的片段范围并重新审核渲染。</small></span></label><label><input checked={submissionKind === "storyboard"} name="studio-revision-kind" onChange={() => setSubmissionKind("storyboard")} type="radio" value="storyboard" /><span className="studio-revision-option-copy"><strong>分镜结构修订</strong><small>用于新增、删除、重排、拆分或合并镜头；会返回分镜审核，不直接采用当前 OpenChatCut 工程。</small></span></label></div><label>本次修改说明<textarea aria-label="OpenChatCut 修改说明" onChange={(event) => setReason(event.target.value)} placeholder={submissionKind === "storyboard" ? "例如：删除 shot-02，将后续镜头前移并重算时长" : "例如：将当前片段出点延长到 5 秒"} rows={3} value={reason} /></label><div className="review-actions"><button className="button button-secondary" disabled={isPending} onClick={() => setSubmissionKind(null)} type="button">取消</button><button className="button button-primary" disabled={isPending} onClick={() => void submitStudioRevision()} type="button">{submissionKind === "storyboard" ? "确认并返回分镜审核" : "确认并重新审核"}</button></div></div> : null}{error ? <p className="form-error">{error}</p> : null}</section>;
}

function PreRenderReviewPackage({ artifacts, decisions, isTransitionPending, members, onReviewMember, onTransition, reviewPackage }: { artifacts: Artifact[]; decisions: PreRenderReviewMemberDecision[]; isTransitionPending: boolean; members: PreRenderReviewMember[]; onReviewMember: (input: PreRenderMemberReviewRequest) => Promise<void>; onTransition: (episodeId: string, toStage: EpisodeStage, reason: string) => Promise<boolean>; reviewPackage: ReviewPackage }) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const isQcOnly = isQcOnlyPreRender(reviewPackage.context_snapshot);
  const allApproved = members.length > 0 && members.every((member) => decisions.find((decision) => decision.member_key === member.member_key)?.decision === "approved");
  async function approvePackage() {
    const trimmedReason = reason.trim();
    if (!trimmedReason) { setError("请填写进入合成前的审核理由。"); return; }
    setError("");
    await onTransition(reviewPackage.episode_id, "render_ready", trimmedReason);
  }
  return <section className="review-section pre-render-review-package"><h3>预渲染审核包 · 修订 v{reviewPackage.revision_number}</h3><p className="muted-copy">{isQcOnly ? "媒体与音轨已冻结，正在自动生成审核渲染。" : `已冻结 ${members.length} 个媒体与音轨成员及其生成证据。逐项批准后，才能进入合成。`}</p>{members.map((member) => {
    const decision = decisions.find((candidate) => candidate.member_key === member.member_key) ?? null;
    const evidence = preRenderMemberEvidence(member.evidence_snapshot);
    const artifact = artifacts.find((candidate) => candidate.id === member.artifact_id || (evidence && candidate.relative_path === evidence.relativePath && candidate.sha256 === evidence.sha256));
    return <article className="pre-render-member" key={member.id}><header><strong><span>{preRenderMemberLabel(member.member_kind)}</span><small>{preRenderMemberKey(member.member_key)}</small></strong><span className={decision?.decision === "approved" ? "stage stage-approved" : decision?.decision === "changes_requested" ? "stage stage-review" : "stage stage-muted"}>{isQcOnly ? "已冻结" : decision?.decision === "approved" ? decision.inherited_from_review_package_id ? "沿用已批准" : "已批准" : decision?.decision === "changes_requested" ? "已退回" : "待审核"}</span></header>{artifact ? <ArtifactPreview artifacts={[artifact]} /> : null}{evidence ? <dl><div><dt>执行器</dt><dd>{evidence.provider} · {evidence.model} · {evidence.promptVersion}</dd></div><div><dt>产物</dt><dd>{evidence.relativePath}</dd></div><div><dt>SHA-256</dt><dd>{evidence.sha256.slice(0, 12)}…</dd></div>{evidence.durationSeconds === null ? null : <div><dt>时间范围</dt><dd>{evidence.startSeconds ?? 0}s – {((evidence.startSeconds ?? 0) + evidence.durationSeconds).toFixed(3)}s</dd></div>}</dl> : <p className="form-error">冻结成员证据格式无效。</p>}{isQcOnly ? null : decision ? <p className="muted-copy">{decision.reason}</p> : <PreRenderMemberDecisionForm member={member} onReview={onReviewMember} reviewPackageId={reviewPackage.id} />}</article>;
  })}{isQcOnly ? null : <section className="pre-render-final-decision"><h4>进入合成</h4><label>审核理由<textarea aria-label="预渲染审核理由" onChange={(event) => setReason(event.target.value)} placeholder="说明全部冻结成员已可用于合成" rows={3} value={reason} /></label>{error ? <p className="form-error">{error}</p> : null}<button className="button button-primary" disabled={!allApproved || isTransitionPending} onClick={() => void approvePackage()} type="button">批准预渲染包并进入合成</button>{!allApproved ? <p className="muted-copy">请先逐项批准全部成员。</p> : null}</section>}</section>;
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
  const shot = snapshot.shot;
  const durationSeconds = typeof output.duration_seconds === "number" && output.duration_seconds > 0 ? output.duration_seconds : shot && !Array.isArray(shot) && typeof shot === "object" && typeof shot.durationSeconds === "number" && shot.durationSeconds > 0 ? shot.durationSeconds : null;
  const startSeconds = typeof output.start_seconds === "number" && output.start_seconds >= 0 ? output.start_seconds : null;
  return { durationSeconds, model: task.model, promptVersion: task.prompt_version, provider: task.provider, relativePath: output.relative_path, sha256: output.sha256, startSeconds };
}

function AudioTrackPanel({ annotations, onCreateAnnotation, tasks, tracks }: { annotations: AudioTrackAnnotation[]; onCreateAnnotation: (input: AudioTrackAnnotationRequest) => Promise<void>; tasks: Task[]; tracks: AudioTrack[] }) {
  const [trackId, setTrackId] = useState("");
  const [atSeconds, setAtSeconds] = useState("0");
  const [reason, setReason] = useState("");
  const [formError, setFormError] = useState("");
  useEffect(() => { if (!trackId && tracks[0]) { setTrackId(tracks[0].id); setAtSeconds(String(tracks[0].start_seconds)); } }, [trackId, tracks]);
  if (!tracks.length) return null;
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
  return <details className="review-section detail-card-collapsible"><summary><h3>整片音轨</h3></summary><div className="detail-card-body">{tracks.map((track) => <AudioTrackCard annotations={annotations.filter((annotation) => annotation.audio_track_id === track.id)} key={track.id} sourceTask={tasks.find((task) => task.id === track.source_task_id)} track={track} />)}<form className="review-actions audio-annotation-form" onSubmit={(event) => void submit(event)}><label>音轨<select aria-label="音轨" onChange={(event) => { const nextTrack = tracks.find((track) => track.id === event.target.value); setTrackId(event.target.value); if (nextTrack) setAtSeconds(String(nextTrack.start_seconds)); }} value={trackId}>{tracks.map((track) => <option key={track.id} value={track.id}>{track.track_kind} · {track.cue_id ?? track.id.slice(0, 8)}</option>)}</select></label><label>时间点（秒）<input aria-label="音轨时间点" max={selectedTrackEnd} min={selectedTrack?.start_seconds ?? 0} onChange={(event) => setAtSeconds(event.target.value)} step="0.001" type="number" value={atSeconds} /></label><label>批注<input aria-label="音轨批注" onChange={(event) => setReason(event.target.value)} value={reason} /></label><button className="button button-primary" type="submit">添加音轨批注</button></form>{formError ? <p className="form-error">{formError}</p> : null}</div></details>;
}

function AudioTrackCard({ annotations, sourceTask, status, track }: { annotations: AudioTrackAnnotation[]; sourceTask?: Task; status?: string; track: AudioTrack }) {
  const source = localArtifactUrl(track.episode_id, track.relative_path, track.sha256);
  const { error, url } = useLocalArtifactBlob(source);
  const mediaSource = freesoundMediaSource(sourceTask);
  return <article className="audio-track-card"><strong>{status ? `${status} · ` : ""}{track.track_kind} · {track.cue_id ?? "未命名"}</strong>{url ? <audio aria-label={`${track.track_kind} 音轨`} controls preload="metadata" src={url} /> : error ? <p className="muted-copy">{error}</p> : <LoadingIndicator compact label="正在加载可试听音轨…" />}<dl className="audio-track-primary-meta"><div><dt>时间范围</dt><dd>{track.start_seconds}s – {(track.start_seconds + track.duration_seconds).toFixed(3)}s</dd></div><div><dt>来源审核包</dt><dd>{track.source_review_package_id?.slice(0, 8) ?? "派生自固定视频修订"}</dd></div>{mediaSource ? <><div><dt>素材来源</dt><dd><a href={mediaSource.sourceUrl} rel="noreferrer" target="_blank">{mediaSource.title}</a> · {mediaSource.creator}</dd></div><div><dt>许可</dt><dd><a href={mediaSource.license} rel="noreferrer" target="_blank">{mediaSource.license}</a></dd></div></> : null}</dl>{annotations.map((annotation) => <p className="muted-copy" key={annotation.id}>{annotation.at_seconds}s · {annotation.reason}</p>)}</article>;
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
  error: string;
  file: File;
  id: string;
  isMainScript: boolean;
  materialPurpose: MaterialPurpose | null;
  materialType: MaterialType;
  status: "queued" | "importing" | "imported" | "error";
}

const supportedMaterialAccept = ".md,.markdown,.txt,.jpg,.jpeg,.png,.webp,.gif,.avif,.mp3,.wav,.m4a,.aac,.flac,.ogg,.mp4,.mov,.webm,.m4v,.avi";
const materialTypeLabels: Record<MaterialType, string> = { script: "脚本", reference: "参考材料", image: "图片", audio: "音频", video: "视频" };
const abbreviatedMaterialName = (name: string) => name.length > 38 ? `${name.slice(0, 12)}...${name.slice(-19)}` : name;
const readFileText = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onerror = () => reject(reader.error ?? new Error("无法读取脚本文件。"));
  reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
  reader.readAsText(file);
});
const mainScriptTemplate = `# 本期标题

## 正文

### 段落 01

- 口播：
- 画面提示：（可选）
- 建议时长：（可选，仅作输入提示）

### 段落 02

- 口播：
- 画面提示：（可选）
- 建议时长：（可选，仅作输入提示）

## 本期补充约束（可选）

- 必须出现：
- 禁止出现：
`;
export const abbreviatePath = (path: string) => path.split("/").map((part) => part.length > 24 ? `${part.slice(0, 8)}…${part.slice(part.includes(".") ? -10 : -6)}` : part).join("/");

function materialBindingStatuses(tasks: Task[]): ReadonlyMap<string, string> {
  const statuses = new Map<string, string>();
  for (const task of tasks) {
    if (task.status !== "completed") continue;
    const input = task.input_snapshot;
    if (!input || Array.isArray(input) || typeof input !== "object") continue;
    const manualSource = input.manual_source;
    if (!manualSource || Array.isArray(manualSource) || typeof manualSource !== "object" || typeof manualSource.material_revision_id !== "string") continue;
    const shot = input.shot;
    const shotId = shot && !Array.isArray(shot) && typeof shot === "object" && typeof shot.id === "string" ? shot.id : "";
    statuses.set(manualSource.material_revision_id, shotId ? `已绑定镜头 · ${shotId}` : "已绑定生产目标");
  }
  return statuses;
}

function MaterialImportForm({ allowMainScript = true, bindingStatuses = new Map(), episodeId, existingMaterials = [], isPending, onBatchComplete, onImport, onNotify }: { allowMainScript?: boolean; bindingStatuses?: ReadonlyMap<string, string>; episodeId: string; existingMaterials?: MaterialRevision[]; isPending: boolean; onBatchComplete: () => Promise<void>; onImport: MaterialImportHandler; onNotify: (message: string) => void }) {
  const [selectedFiles, setSelectedFiles] = useState<MaterialImportDraft[]>([]);
  const [confirmed, setConfirmed] = useState(false);
  const [formError, setFormError] = useState("");
  const [fileInputKey, setFileInputKey] = useState(0);
  const [isImporting, setIsImporting] = useState(false);
  const [draggedMaterial, setDraggedMaterial] = useState<{ id: string; purpose: MaterialPurpose } | null>(null);
  const [draftsLoaded, setDraftsLoaded] = useState(!materialImportDraftStorageAvailable());
  const [preview, setPreview] = useState<{ draft?: MaterialImportDraft; material?: MaterialRevision } | null>(null);
  const [showScriptTemplate, setShowScriptTemplate] = useState(false);

  useEffect(() => {
    if (!materialImportDraftStorageAvailable()) return;
    let active = true;
    setDraftsLoaded(false);
    void readMaterialImportDrafts(episodeId).then((drafts) => {
      if (!active) return;
      setSelectedFiles(drafts.map((draft) => ({ ...draft, error: "", status: "queued" })));
      setDraftsLoaded(true);
    }).catch(() => {
      if (active) setDraftsLoaded(true);
    });
    return () => { active = false; };
  }, [episodeId]);

  useEffect(() => {
    if (!draftsLoaded || isImporting) return;
    void writeMaterialImportDrafts(episodeId, selectedFiles.filter((draft) => draft.status !== "imported").map(({ file, id, isMainScript, materialPurpose, materialType }) => ({ file, id, isMainScript, materialPurpose, materialType }))).catch(() => setFormError("材料草稿无法保存到本浏览器；请完成导入后再刷新页面。"));
  }, [draftsLoaded, episodeId, isImporting, selectedFiles]);

  function selectFiles(files: File[]) {
    const unsupported = files.find((file) => materialTypeForFile(file) === "reference");
    if (unsupported) {
      setFormError("仅支持脚本、图片、音频和视频文件。");
      return;
    }
    setSelectedFiles((current) => [...current, ...files.map((file): MaterialImportDraft => ({ error: "", file, id: `${file.name}-${file.lastModified}-${crypto.randomUUID()}`, isMainScript: false, materialPurpose: null, materialType: materialTypeForFile(file), status: "queued" }))]);
    setConfirmed(false);
    setFormError("");
  }

  function removeSlotFile(id: string) {
    setSelectedFiles((current) => current.filter((draft) => draft.id !== id));
    setConfirmed(false);
    setFileInputKey((current) => current + 1);
  }

  function setPurpose(id: string, materialPurpose: MaterialPurpose | null) {
    setSelectedFiles((current) => current.map((draft) => draft.id === id ? { ...draft, error: "", isMainScript: materialPurpose === "main_script", materialPurpose, status: draft.status === "error" ? "queued" : draft.status } : draft));
    setConfirmed(false);
  }

  function reorderPurposeFiles(purpose: MaterialPurpose, sourceId: string, targetId: string) {
    if (sourceId === targetId) return;
    setSelectedFiles((current) => {
      const rollFiles = current.filter((draft) => draft.materialPurpose === purpose);
      const sourceIndex = rollFiles.findIndex((draft) => draft.id === sourceId);
      const targetIndex = rollFiles.findIndex((draft) => draft.id === targetId);
      if (sourceIndex < 0 || targetIndex < 0) return current;
      const reordered = [...rollFiles];
      const [source] = reordered.splice(sourceIndex, 1);
      reordered.splice(targetIndex, 0, source);
      let index = 0;
      return current.map((draft) => draft.materialPurpose === purpose ? reordered[index++] : draft);
    });
  }

  function movePurposeFile(purpose: MaterialPurpose, id: string, direction: -1 | 1) {
    const purposeFiles = selectedFiles.filter((draft) => draft.materialPurpose === purpose);
    const sourceIndex = purposeFiles.findIndex((draft) => draft.id === id);
    const target = purposeFiles[sourceIndex + direction];
    if (target) reorderPurposeFiles(purpose, id, target.id);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      setFormError("");
      const pendingFiles = selectedFiles;
      if (!pendingFiles.length) throw new Error("没有待导入的材料文件。");
      if (pendingFiles.some((draft) => !draft.materialPurpose)) throw new Error("请先标注每个文件的用途。");
      if (allowMainScript && selectedFiles.filter((draft) => draft.isMainScript).length !== 1) throw new Error("请在本批材料中指定且只指定一个主脚本。");
      if (pendingFiles.some((draft) => draft.isMainScript) && !confirmed) throw new Error("请明确确认这份材料是主脚本。");
      const mainScript = pendingFiles.find((draft) => draft.isMainScript);
      if (mainScript) {
        const script = await readFileText(mainScript.file);
        if (!/^#\s+\S+/m.test(script) || !/^##\s+正文\s*$/m.test(script) || !script.split(/^##\s+正文\s*$/m)[1]?.trim()) throw new Error("主脚本需包含“# 本期标题”和非空的“## 正文”；可先查看脚本模板。");
      }
      setIsImporting(true);
      let failedCount = 0;
      const imports = pendingFiles.map((draft, index) => {
        const materialPurpose = draft.materialPurpose as MaterialPurpose;
        const ordinal = existingMaterials.filter((material) => material.material_purpose === materialPurpose).length + pendingFiles.slice(0, index).filter((candidate) => candidate.materialPurpose === materialPurpose).length + 1;
        return { draft, materialPurpose, ordinal };
      });
      let nextIndex = 0;
      async function importNext() {
        while (nextIndex < imports.length) {
          const { draft, materialPurpose, ordinal } = imports[nextIndex++];
          try {
            setSelectedFiles((current) => current.map((item) => item.id === draft.id ? { ...item, error: "", status: "importing" } : item));
            await onImport({ content: new Uint8Array(await new Response(draft.file).arrayBuffer()), deferRefresh: true, episodeId, isMainScript: draft.isMainScript, logicalName: canonicalMaterialName(materialPurpose, draft.file.name, draft.materialType, ordinal), materialPurpose, materialType: draft.materialType, mimeType: draft.file.type || "application/octet-stream", sourceKind: "file", sourcePath: draft.file.name });
            setSelectedFiles((current) => current.map((item) => item.id === draft.id ? { ...item, error: "", status: "imported" } : item));
          } catch (cause) {
            failedCount += 1;
            setSelectedFiles((current) => current.map((item) => item.id === draft.id ? { ...item, error: cause instanceof Error ? cause.message : "无法导入生产材料。", status: "error" } : item));
          }
        }
      }
      await Promise.all(Array.from({ length: Math.min(3, imports.length) }, () => importNext()));
      await onBatchComplete();
      setSelectedFiles((current) => current.filter((item) => item.status !== "imported"));
      if (failedCount) setFormError(`${failedCount} 个文件导入失败，可修正后重新导入。`);
      else setFileInputKey((current) => current + 1);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "无法导入生产材料。");
    } finally {
      setIsImporting(false);
    }
  }

  const persistedMaterials = existingMaterials;
  const groupOrder: Array<{ key: string; label: string; purposes: Array<MaterialPurpose | null> }> = [
    { key: "scripts", label: "脚本", purposes: ["main_script", "supplemental_script"] }, { key: "a_roll", label: "A-roll", purposes: ["a_roll"] }, { key: "b_roll", label: "B-roll", purposes: ["b_roll"] },
    { key: "narration", label: "旁白 / 人声", purposes: ["narration"] }, { key: "background_music", label: "背景音乐", purposes: ["background_music"] }, { key: "sound_effect", label: "音效", purposes: ["sound_effect"] },
    { key: "visual_reference", label: "视觉参考", purposes: ["visual_reference"] }, { key: "cover", label: "封面素材", purposes: ["cover"] }, { key: "general_reference", label: "一般参考", purposes: ["general_reference"] }, { key: "unassigned", label: "待标注", purposes: [null] },
  ];
  const hasOrderedMaterials = selectedFiles.filter((draft) => draft.materialPurpose === "a_roll" || draft.materialPurpose === "b_roll").length > 1;
  function renderDraft(draft: MaterialImportDraft) {
    const purpose = draft.materialPurpose;
    const purposeFiles = purpose ? selectedFiles.filter((item) => item.materialPurpose === purpose) : [];
    const purposeIndex = purposeFiles.findIndex((item) => item.id === draft.id);
    const sortable = Boolean(purpose && purpose !== "main_script");
    const numbered = purpose === "a_roll" || purpose === "b_roll";
    const confirmation = draft.isMainScript ? <button aria-label={confirmed ? `已确认 ${draft.file.name} 为主脚本，点击取消确认` : `主脚本待确认：${draft.file.name}`} aria-pressed={confirmed} className={`material-main-script-confirmation${confirmed ? " is-confirmed" : ""}`} data-tooltip={confirmed ? "已确认这是本生产单的主脚本；点击可取消确认。" : "确认这是本生产单的主脚本后，才能导入材料。"} disabled={isImporting} onClick={() => setConfirmed((current) => !current)} type="button">{confirmed ? <ShieldCheck aria-hidden="true" className="icon" /> : <ShieldAlert aria-hidden="true" className="icon" />}</button> : null;
    const isImportInProgress = draft.status === "importing" || draft.status === "imported";
    const statusText = draft.status === "error" ? `导入失败：${draft.error}` : isImportInProgress ? "导入中…" : purpose ? "" : "待标注";
    const status = draft.isMainScript && draft.status === "queued" ? null : <span aria-live="polite" className={`material-import-status ${draft.status === "error" ? "is-error" : draft.status === "imported" ? "is-imported" : ""}`}>{statusText}</span>;
    return <li className={`is-${draft.status}${isImportInProgress ? " is-import-progress" : ""}${numbered ? " is-roll" : ""}`} key={draft.id} onDragOver={(event) => { if (purpose && draggedMaterial?.purpose === purpose) event.preventDefault(); }} onDrop={() => { if (purpose && sortable && draggedMaterial?.purpose === purpose) reorderPurposeFiles(purpose, draggedMaterial.id, draft.id); setDraggedMaterial(null); }}>{sortable ? <button aria-label={`拖动排序 ${draft.file.name}`} className="material-drag-handle" disabled={isImporting} draggable={!isImporting} onDragEnd={() => setDraggedMaterial(null)} onDragStart={() => { if (purpose) setDraggedMaterial({ id: draft.id, purpose }); }} onKeyDown={(event) => { if (!purpose || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return; event.preventDefault(); movePurposeFile(purpose, draft.id, event.key === "ArrowUp" ? -1 : 1); }} title={`拖动调整 ${materialPurposeLabel(purpose as MaterialPurpose)} 顺序；键盘可用上下方向键`} type="button"><GripVertical aria-hidden="true" className="icon" /></button> : <span aria-hidden="true" className="material-drag-placeholder" />}<button aria-label={`预览 ${draft.file.name}`} className="material-import-file material-preview-trigger" onClick={() => setPreview({ draft })} type="button"><strong title={draft.file.name}>{abbreviatedMaterialName(draft.file.name)}</strong><span>{numbered ? `${materialPurposeLabel(purpose)} ${String(purposeIndex + 1).padStart(2, "0")} · ${materialTypeLabels[draft.materialType]}` : materialTypeLabels[draft.materialType]}</span></button><select aria-label={`${draft.file.name} 用途`} className="material-import-purpose" disabled={isImporting} onChange={(event) => setPurpose(draft.id, event.target.value as MaterialPurpose || null)} value={purpose ?? ""}><option value="">待标注</option>{materialPurposeOptions(draft.materialType, allowMainScript).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>{status}<div className="material-import-actions">{confirmation}<button aria-label={`移除 ${draft.file.name}`} className="material-remove-button" disabled={isImporting} onClick={() => removeSlotFile(draft.id)} title="移除材料" type="button"><Trash2 aria-hidden="true" className="icon" /></button></div></li>;
  }
  return <><form className="material-import" onSubmit={(event) => void submit(event)}><div className="material-import-intro"><p className="material-import-subtitle">一次选择多个文件；系统只识别文件类型，具体用途由你逐项确认。</p>{allowMainScript ? <button className="text-button" onClick={() => setShowScriptTemplate(true)} type="button">查看主脚本模板</button> : null}</div><section aria-label="统一材料导入" className="material-import-panel"><div className="material-import-upload-row"><label className="material-unified-upload"><input accept={supportedMaterialAccept} aria-label="选择生产材料" className="material-slot-input" disabled={isImporting || isPending} key={fileInputKey} multiple onChange={(event) => selectFiles(Array.from(event.target.files ?? []))} type="file" /><Upload aria-hidden="true" className="icon" /><span><strong>选择生产材料</strong><small>支持脚本、图片、音频和视频；可一次选择多个文件。</small></span></label>{selectedFiles.length ? <button className="button button-primary material-import-submit" disabled={isPending || isImporting} type="submit">{isPending || isImporting ? "导入中…" : "导入所选材料"}</button> : null}</div>{hasOrderedMaterials ? <p className="material-import-order-hint">A-roll 和 B-roll 编号按当前分组顺序生成；导入前拖动左侧手柄排序，导入后顺序冻结。</p> : null}{selectedFiles.length || persistedMaterials.length ? <ul aria-label="材料导入状态" className="material-import-list">{groupOrder.map(({ key, label, purposes }) => { const drafts = selectedFiles.filter((draft) => purposes.includes(draft.materialPurpose)); const materials = persistedMaterials.filter((material) => purposes.includes(material.material_purpose as MaterialPurpose)); if (!drafts.length && !materials.length) return null; return <li className="material-import-group" key={key}><div className="material-import-group-heading"><strong>{label}</strong><span>{drafts.length + materials.length} 项</span></div><ul>{drafts.map(renderDraft)}{materials.map((material) => <li className="is-imported is-frozen-material" key={material.id}><MaterialTypeIcon type={material.material_type as MaterialType} /><button aria-label={`预览 ${material.source_path}`} className="material-import-file material-preview-trigger" onClick={() => setPreview({ material })} type="button"><strong title={material.source_path}>{abbreviatedMaterialName(material.source_path)}</strong><span>{materialPurposeLabel(material.material_purpose as MaterialPurpose)}</span></button><span className="material-import-status is-imported">{bindingStatuses.get(material.id) ?? (material.is_main_script ? "已确认" : "已导入")}</span></li>)}</ul></li>; })}</ul> : <p className="muted-copy">{draftsLoaded ? "尚未选择文件。" : "正在恢复本地材料草稿…"}</p>}</section>{formError ? <p className="form-error">{formError}</p> : null}</form>{showScriptTemplate ? <ScriptTemplateDialog onClose={() => setShowScriptTemplate(false)} onCopied={() => onNotify("主脚本模板已复制。")} /> : null}{preview ? <MaterialPreviewDialog episodeId={episodeId} onClose={() => setPreview(null)} preview={preview} /> : null}</>;
}

function MaterialTypeIcon({ type }: { type: MaterialType }) {
  const TypeIcon = type === "script" ? FileText : type === "video" ? Film : type === "audio" ? Volume2 : ImageIcon;
  return <span aria-hidden="true" className={`material-type-icon is-${type}`}><TypeIcon className="icon" /></span>;
}

function ScriptTemplateDialog({ onClose, onCopied }: { onClose: () => void; onCopied: () => void }) {
  const dialogRef = useDialogFocus(true, onClose);
  async function copyTemplate() {
    await navigator.clipboard.writeText(mainScriptTemplate);
    onCopied();
  }
  function downloadTemplate() {
    const url = URL.createObjectURL(new Blob([mainScriptTemplate], { type: "text/markdown;charset=utf-8" }));
    const link = document.createElement("a");
    link.download = "主脚本模板.md";
    link.href = url;
    link.click();
    URL.revokeObjectURL(url);
  }
  return <div className="modal-backdrop material-preview-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section aria-label="主脚本模板" aria-modal="true" className="modal-card material-preview-dialog" ref={dialogRef} role="dialog"><header><div><h2>主脚本模板</h2><p>标题和“正文”是必填结构；段落编号、画面与时长是输入提示，最终镜头由分镜阶段生成。系列长期规则来自生产单冻结的系列版本，无需重复粘贴。</p></div><button aria-label="关闭主脚本模板" className="icon-button" onClick={onClose} type="button"><X aria-hidden="true" className="icon" /></button></header><pre className="script-template-content">{mainScriptTemplate}</pre><div className="modal-actions"><button className="button button-secondary" onClick={() => void copyTemplate()} type="button"><Copy aria-hidden="true" className="icon" />复制模板</button><button className="button button-primary" onClick={downloadTemplate} type="button"><Download aria-hidden="true" className="icon" />下载 .md</button></div></section></div>;
}

function MaterialPreviewDialog({ episodeId, onClose, preview }: { episodeId: string; onClose: () => void; preview: { draft?: MaterialImportDraft; material?: MaterialRevision } }) {
  const dialogRef = useDialogFocus(true, onClose);
  const draft = preview.draft;
  const material = preview.material;
  const name = draft?.file.name ?? material?.source_path ?? "材料";
  const type = draft?.materialType ?? material?.material_type ?? "reference";
  const persistedSource = material ? localArtifactUrl(episodeId, material.storage_path, material.sha256) : null;
  const { content: persistedText, error: persistedTextError } = useLocalArtifactText(type === "script" ? persistedSource : null);
  const { error: persistedMediaError, url: persistedMediaUrl } = useLocalArtifactBlob(type !== "script" ? persistedSource : null);
  const [draftSource, setDraftSource] = useState<string | null>(null);
  const [draftText, setDraftText] = useState("");

  useEffect(() => {
    if (!draft) return;
    if (draft.materialType === "script") {
      void readFileText(draft.file).then(setDraftText);
      return;
    }
    const url = URL.createObjectURL(draft.file);
    setDraftSource(url);
    return () => URL.revokeObjectURL(url);
  }, [draft]);

  const mediaKind = type === "image" || type === "audio" || type === "video" ? type : null;
  const mediaSource = draft ? draftSource : persistedMediaUrl;
  const error = draft ? "" : type === "script" ? persistedTextError : persistedMediaError;
  const text = draft ? draftText : persistedText;
  return <div className="modal-backdrop material-preview-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section aria-label={`${name} 材料预览`} aria-modal="true" className="modal-card material-preview-dialog" ref={dialogRef} role="dialog"><header><div><h2>{name}</h2><p>{material ? "已冻结材料" : "待导入材料"} · {materialTypeLabels[type as MaterialType]}</p></div><button aria-label="关闭材料预览" className="icon-button" onClick={onClose} type="button"><X aria-hidden="true" className="icon" /></button></header><div className="material-preview-content">{error ? <p className="form-error">{error}</p> : type === "script" ? text ? <MarkdownPreview content={text} /> : <LoadingIndicator compact label="正在读取脚本…" /> : mediaKind && mediaSource ? <ArtifactPreviewMedia kind={mediaKind} label={`${name} 材料预览`} source={mediaSource} /> : <LoadingIndicator compact label="正在加载材料预览…" />}</div></section></div>;
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

function TextReviewPackage({ artifact, collapsedContent = false, contentSummary, embedded = false, reviewPackage }: { artifact: Artifact; collapsedContent?: boolean; contentSummary?: ReactNode; embedded?: boolean; reviewPackage: ReviewPackage }) {
  const context = parseFrozenReviewContext(reviewPackage.context_snapshot);
  const artifactMatchesContext = context?.artifactRelativePath === artifact.relative_path && context.artifactSha256 === artifact.sha256;
  const source = artifactMatchesContext ? localArtifactUrl(artifact.episode_id, context.artifactRelativePath, context.artifactSha256) : null;
  const contentHeading = artifact.artifact_type === "script" ? "具体脚本" : artifact.artifact_type === "visual_brief" ? "具体视觉简报" : "具体文本";
  const [isContextOpen, setIsContextOpen] = useState(false);
  const [isContentOpen, setIsContentOpen] = useState(false);
  const contextId = `review-context-${reviewPackage.id}`;
  const contentId = `review-content-${reviewPackage.id}`;

  const content = <div className="review-checklist"><div className="review-checklist-row"><span aria-hidden="true" className="review-checklist-icon">✓</span><div><h4>审核与冻结依据</h4><p className="muted-copy">脚本哈希、系列基准、执行器与预算</p></div><button aria-controls={contextId} aria-expanded={isContextOpen} className="review-checklist-toggle" onClick={() => setIsContextOpen((open) => !open)} type="button">{isContextOpen ? "收起" : "查看"}</button></div><div className="review-checklist-detail" hidden={!isContextOpen} id={contextId}>{context ? <dl>{context.input.kind === "provided_script" ? <div><dt>主脚本 SHA-256</dt><dd>{context.input.scriptSha256.slice(0, 12)}…</dd></div> : <><div><dt>创作方向</dt><dd>{context.input.creativeDirection}</dd></div><div><dt>核心内容</dt><dd>{context.input.coreContent}</dd></div></>}{context.seriesBaseline ? <><div><dt>系列基准</dt><dd>系列基准 · v{context.seriesBaseline.version}</dd></div><div><dt>冻结系列规则</dt><dd><code>{JSON.stringify(context.seriesBaseline.rules)}</code></dd></div></> : null}<div><dt>能力</dt><dd>{context.capability}</dd></div><div><dt>执行器</dt><dd>{context.provider} · <span>{context.model}</span></dd></div><div><dt>预算</dt><dd>{context.budgetLimitCents} 分</dd></div><div><dt>允许工具</dt><dd>{context.allowedTools.join("、") || "无"}</dd></div><div><dt>输出契约</dt><dd>{context.contentType} · {context.requiredArtifactTypes.join("、")}</dd></div></dl> : <p className="form-error">冻结审核上下文格式无效。</p>}</div>{contentSummary && !collapsedContent ? <p className="muted-copy">{contentSummary}</p> : null}{collapsedContent ? <><div className="review-checklist-row"><span aria-hidden="true" className="review-checklist-icon">≡</span><div><h4>完整资产清单</h4><p className="muted-copy">{contentSummary ?? "查看本次审核包的完整文本产物。"}</p></div><button aria-controls={contentId} aria-expanded={isContentOpen} className="review-checklist-toggle" onClick={() => setIsContentOpen((open) => !open)} type="button">{isContentOpen ? "收起" : "查看"}</button></div><div className="review-checklist-detail" hidden={!isContentOpen} id={contentId}><TextArtifactContent source={source} /></div></> : <><h4>{contentHeading}</h4><TextArtifactContent source={source} /></>}</div>;
  return embedded ? <div className="text-review-package text-review-package-embedded">{content}</div> : <section className="review-section text-review-package"><h3>可审核文本 · 修订 v{reviewPackage.revision_number}</h3>{content}</section>;
}

function TextArtifactContent({ source }: { source: string | null }) {
  const { content, error } = useLocalArtifactText(source);
  return error ? <p className="form-error">{error}</p> : content ? <MarkdownPreview content={content} /> : <LoadingIndicator compact label="正在读取文本产物…" />;
}

type FrozenVisualInput = { relativePath: string; sha256: string; fileSize: number };

function frozenVisualInputs(reviewPackage: ReviewPackage): FrozenVisualInput[] {
  const context = reviewPackage.context_snapshot;
  if (!context || typeof context !== "object" || Array.isArray(context)) return [];
  const visualAssets = (context as Record<string, unknown>).visual_assets;
  if (!visualAssets || typeof visualAssets !== "object" || Array.isArray(visualAssets)) return [];
  const externalInputs = (visualAssets as Record<string, unknown>).external_inputs;
  if (!Array.isArray(externalInputs)) return [];
  return externalInputs.flatMap((input) => {
    if (!input || typeof input !== "object" || Array.isArray(input)) return [];
    const { fileSize, relativePath, sha256 } = input as Record<string, unknown>;
    return typeof relativePath === "string" && relativePath && typeof sha256 === "string" && /^[0-9a-f]{64}$/.test(sha256) && typeof fileSize === "number" && Number.isFinite(fileSize) && fileSize >= 0
      ? [{ relativePath, sha256, fileSize }]
      : [];
  });
}

function FrozenVisualInputMedia({ episodeId, input }: { episodeId: string; input: FrozenVisualInput }) {
  const source = localArtifactUrl(episodeId, input.relativePath, input.sha256);
  const { error, url } = useLocalArtifactBlob(source);
  const [isExpanded, setIsExpanded] = useState(false);
  const lightboxRef = useDialogFocus(isExpanded, () => setIsExpanded(false));
  const kind = artifactPreviewKind(input.relativePath);
  const label = frozenVisualInputLabel(input.relativePath);
  useEffect(() => { setIsExpanded(false); }, [input.relativePath]);
  if (error) return <p className="form-error">{error}</p>;
  if (!url || (kind !== "image" && kind !== "video")) return null;
  const expandedLabel = `${label} 放大预览`;
  return <><ArtifactPreviewMedia kind={kind} label="冻结的外部视觉输入" source={url} /><button aria-label={`放大查看 ${label}`} className="artifact-expand-button" onClick={() => setIsExpanded(true)} type="button">放大查看</button>{isExpanded ? <div aria-label={expandedLabel} aria-modal="true" className="artifact-lightbox" onMouseDown={(event) => { if (event.target === event.currentTarget) setIsExpanded(false); }} ref={lightboxRef} role="dialog"><div className="artifact-lightbox-content"><button aria-label="关闭放大预览" className="artifact-lightbox-close" onClick={() => setIsExpanded(false)} type="button">关闭</button><ArtifactPreviewMedia kind={kind} label={expandedLabel} source={url} /></div></div> : null}</>;
}

function frozenVisualInputLabel(relativePath: string): string {
  return (relativePath.split("/").at(-1) ?? relativePath).replace(/^[0-9a-f]{64}-/, "");
}

function FrozenVisualInputPicker({ episodeId, inputs }: { episodeId: string; inputs: FrozenVisualInput[] }) {
  const [selectedPath, setSelectedPath] = useState(inputs[0]?.relativePath ?? "");
  const selectedInput = inputs.find((input) => input.relativePath === selectedPath) ?? inputs[0];
  if (!selectedInput) return null;
  return <div className="frozen-visual-picker"><label>选择视觉输入<select aria-label="选择视觉输入" onChange={(event) => setSelectedPath(event.target.value)} value={selectedInput.relativePath}>{inputs.map((input) => <option key={`${input.relativePath}-${input.sha256}`} value={input.relativePath}>{frozenVisualInputLabel(input.relativePath)} · {(input.fileSize / 1024 / 1024).toFixed(1)} MB</option>)}</select></label><article className="frozen-visual-card"><header><strong title={selectedInput.relativePath}>{frozenVisualInputLabel(selectedInput.relativePath)}</strong><small>{(selectedInput.fileSize / 1024 / 1024).toFixed(1)} MB</small></header><div className="frozen-visual-media">{artifactPreviewKind(selectedInput.relativePath) === "image" || artifactPreviewKind(selectedInput.relativePath) === "video" ? <FrozenVisualInputMedia episodeId={episodeId} input={selectedInput} key={selectedInput.relativePath} /> : null}</div></article></div>;
}

function VisualReviewPackage({ artifact, artifacts, reviewPackage }: { artifact: Artifact; artifacts: Artifact[]; reviewPackage: ReviewPackage }) {
  if (artifact.artifact_type === "visual_asset_manifest") {
    const externalInputs = frozenVisualInputs(reviewPackage);
    const generatedVisuals = artifacts.filter((candidate) => candidate.artifact_type === "static_visual");
    return <><TextReviewPackage artifact={artifact} collapsedContent contentSummary={`已冻结外部输入 ${externalInputs.length} 项；已生成视觉资产 ${generatedVisuals.length} 项。`} embedded reviewPackage={reviewPackage} /><section className="review-section"><h3>已冻结的外部视觉输入</h3>{externalInputs.length ? <FrozenVisualInputPicker episodeId={artifact.episode_id} inputs={externalInputs} /> : <p className="muted-copy">本次没有导入视觉素材。</p>}</section>{generatedVisuals.length ? <section className="review-section"><h3>已生成的视觉资产</h3><ArtifactPreview artifacts={generatedVisuals} /></section> : null}</>;
  }
  const referenceGroups = artifacts.filter((candidate) => candidate.artifact_type === "visual_reference_group");
  const staticVisuals = artifacts.filter((candidate) => candidate.artifact_type === "static_visual");
  return <><TextReviewPackage artifact={artifact} reviewPackage={reviewPackage} /><section className="review-section"><h3>角色 / 地点 / 关键道具参考组</h3>{referenceGroups.length ? referenceGroups.map((candidate) => <div key={candidate.id}><TextArtifactContent source={localArtifactUrl(candidate.episode_id, candidate.relative_path, candidate.sha256)} /></div>) : <p className="form-error">视觉审核包缺少参考组。</p>}</section><section className="review-section"><h3>所需静态视觉</h3><p className="muted-copy">这是视觉方案生成的静态参考图，不是分镜。分镜会在后续“分镜生成与审核”阶段单独展示。</p><ArtifactPreview artifacts={staticVisuals} /></section></>;
}

type StoryboardShot = StoryboardShotManifest;
type StoryboardStructureOperationKind = StoryboardStructureOperation["kind"];
const storyboardStructureOperationLabels: Record<StoryboardStructureOperationKind, string> = {
  add_after: "新增镜头",
  delete: "删除镜头",
  split: "拆分镜头",
  merge: "合并镜头",
  reorder: "调整顺序",
  change_type: "修改镜头类型",
  change_duration: "修改目标时长",
};
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

function episodeTtsSettings(episode: Episode): EpisodeTtsSettings {
  return {
    languageCode: episode.tts_language_code ?? "zh-CN",
    speakingRate: episode.tts_speaking_rate == null ? "" : String(episode.tts_speaking_rate),
    voice: episode.tts_voice ?? "",
  };
}

function availableTtsVoices(blueprint: Json | undefined, languageCode: string, selectedVoice = ""): string[] {
  const narration = blueprint && !Array.isArray(blueprint) && typeof blueprint === "object" && blueprint.narration && !Array.isArray(blueprint.narration) && typeof blueprint.narration === "object" ? blueprint.narration : null;
  const executor = narration?.executor && !Array.isArray(narration.executor) && typeof narration.executor === "object" ? narration.executor : null;
  const registration = adapterRegistration(typeof executor?.provider === "string" ? executor.provider : "", typeof executor?.adapter === "string" ? executor.adapter : "");
  return [...new Set([selectedVoice, ...(registration?.voiceCatalog?.[languageCode] ?? [])])].filter(Boolean);
}

function EpisodeTtsSettingsPanel({ blueprint, episode, isPending, onSave }: { blueprint?: Json; episode: Episode; isPending: boolean; onSave: (input: { episodeId: string; languageCode: string; speakingRate: number; voice: string }) => Promise<void> }) {
  const initial = episodeTtsSettings(episode);
  const [languageCode, setLanguageCode] = useState(initial.languageCode);
  const [voice, setVoice] = useState(initial.voice);
  const [speakingRate, setSpeakingRate] = useState(initial.speakingRate);
  const [savedSignature, setSavedSignature] = useState(`${initial.languageCode}\u0000${initial.voice}\u0000${initial.speakingRate}`);
  const [error, setError] = useState("");
  const [isPreviewPending, setIsPreviewPending] = useState(false);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const previewAudioUrlRef = useRef<string | null>(null);
  useEffect(() => { setLanguageCode(initial.languageCode); setVoice(initial.voice); setSpeakingRate(initial.speakingRate); setSavedSignature(`${initial.languageCode}\u0000${initial.voice}\u0000${initial.speakingRate}`); }, [initial.languageCode, initial.speakingRate, initial.voice]);
  useEffect(() => () => { previewAudioRef.current?.pause(); if (previewAudioUrlRef.current) URL.revokeObjectURL(previewAudioUrlRef.current); }, []);
  const narration = blueprint && !Array.isArray(blueprint) && typeof blueprint === "object" && blueprint.narration && !Array.isArray(blueprint.narration) && typeof blueprint.narration === "object" ? blueprint.narration : null;
  const executor = narration?.executor && !Array.isArray(narration.executor) && typeof narration.executor === "object" ? narration.executor : null;
  const registration = adapterRegistration(typeof executor?.provider === "string" ? executor.provider : "", typeof executor?.adapter === "string" ? executor.adapter : "");
  const languages = [...new Set([languageCode, ...Object.keys(registration?.voiceCatalog ?? {})])].filter(Boolean);
  const voices = availableTtsVoices(blueprint, languageCode, voice);
  const currentSignature = `${languageCode}\u0000${voice}\u0000${speakingRate}`;
  const isDirty = currentSignature !== savedSignature;
  const hasSavedSettings = Boolean(episode.tts_language_code && episode.tts_voice && episode.tts_speaking_rate && episode.tts_speaking_rate > 0);
  async function save() {
    const rate = Number(speakingRate);
    if (!languageCode.trim() || !voice.trim() || !Number.isFinite(rate) || rate <= 0) { setError("请填写语言、声音和有效语速。"); return; }
    setError("");
    try { await onSave({ episodeId: episode.id, languageCode: languageCode.trim(), speakingRate: rate, voice: voice.trim() }); setSavedSignature(`${languageCode.trim()}\u0000${voice.trim()}\u0000${rate}`); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "无法保存本期 TTS 设置。"); }
  }
  async function preview() {
    const rate = Number(speakingRate);
    if (!languageCode.trim() || !voice.trim() || !Number.isFinite(rate) || rate <= 0) { setError("请填写语言、声音和有效语速。"); return; }
    setError(""); setIsPreviewPending(true);
    try {
      const { data, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw sessionError;
      if (!data.session) throw new Error("需要 Owner 登录会话。");
      const response = await fetch(`/_tts-voice-preview?episode=${encodeURIComponent(episode.id)}`, { body: JSON.stringify({ languageCode: languageCode.trim(), speakingRate: rate, voice: voice.trim() }), headers: { Authorization: `Bearer ${data.session.access_token}`, "Content-Type": "application/json" }, method: "POST" });
      if (!response.ok) throw new Error((await response.text()).trim() || "无法试听当前音色。");
      previewAudioRef.current?.pause();
      if (previewAudioUrlRef.current) URL.revokeObjectURL(previewAudioUrlRef.current);
      const previewUrl = URL.createObjectURL(await response.blob());
      const audio = new Audio(previewUrl);
      previewAudioRef.current = audio; previewAudioUrlRef.current = previewUrl;
      audio.addEventListener("ended", () => { URL.revokeObjectURL(previewUrl); if (previewAudioUrlRef.current === previewUrl) previewAudioUrlRef.current = null; }, { once: true });
      await audio.play();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "无法试听当前音色。"); }
    finally { setIsPreviewPending(false); }
  }
  return <section aria-label="本期 TTS 设置" className={`episode-tts-settings${isDirty ? " is-dirty" : hasSavedSettings ? " is-saved" : " is-missing"}`}><header><div><div className="episode-tts-title-row"><h4>本期 TTS 设置</h4><span aria-live="polite" className={`settings-state is-${isDirty ? "dirty" : hasSavedSettings ? "saved" : "missing"}`}>{isDirty ? "未保存" : hasSavedSettings ? "已保存" : "尚未配置"}</span></div><p className="muted-copy">逐镜头口播共用这套语言、声音和语速。</p></div><div className="episode-tts-settings-actions"><button className="button button-primary" disabled={isPending || isPreviewPending || !isDirty} onClick={() => void save()} type="button">{isPending ? "保存中…" : "保存本期设置"}</button></div></header>{isDirty && hasSavedSettings ? <p className="tts-impact-note" role="status">保存后，当前 TTS 音轨会转为历史版本；已写入的口播文字不会丢失，需要按镜头重新生成音频。</p> : !hasSavedSettings ? <p className="tts-impact-note is-required" role="status">请先保存本期 TTS 设置，再生成任一镜头的口播。</p> : null}<div className="episode-tts-settings-fields"><label>语言<select aria-label="本期 TTS 语言" onChange={(event) => setLanguageCode(event.target.value)} value={languageCode}>{languages.map((language) => <option key={language} value={language}>{language}</option>)}</select></label><label>声音{voices.length ? <select aria-label="本期 TTS 声音" onChange={(event) => setVoice(event.target.value)} value={voice}><option value="">请选择声音</option>{voices.map((option) => <option key={option} value={option}>{option}</option>)}</select> : <input aria-label="本期 TTS 声音" onChange={(event) => setVoice(event.target.value)} value={voice} />}</label><label>语速<input aria-label="本期 TTS 语速" min="0.1" onChange={(event) => setSpeakingRate(event.target.value)} step="0.01" type="number" value={speakingRate} /></label><button aria-label={isPreviewPending ? "正在试听本期 TTS" : "试听本期 TTS"} className="button button-secondary episode-tts-preview-button" disabled={isPending || isPreviewPending} onClick={() => void preview()} title={isPreviewPending ? "试听中…" : "试听本期 TTS"} type="button"><Volume2 aria-hidden="true" size={18} /></button></div>{error ? <p className="form-error" role="alert">{error}</p> : null}</section>;
}

function StoryboardAudioSelect({ audioKind, cues, episode, label, onSave, reviewPackage, selection, targetId, targetKind }: { audioKind: "bgm" | "sfx"; cues: StoryboardAudioCue[]; episode: Episode; label: string; onSave: (input: StoryboardAudioSelectionRequest) => Promise<void>; reviewPackage: ReviewPackage; selection?: StoryboardAudioSelection; targetId: string; targetKind: "episode" | "shot" }) {
  const [value, setValue] = useState(selection?.cue_id ?? "");
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => setValue(selection?.cue_id ?? ""), [selection?.cue_id, selection?.updated_at]);
  async function change(nextValue: string) {
    const previous = value;
    setValue(nextValue); setError(""); setIsPending(true);
    try { await onSave({ audioKind, cueId: nextValue || null, episodeId: episode.id, reviewPackageId: reviewPackage.id, targetId, targetKind }); }
    catch (cause) { setValue(previous); setError(cause instanceof Error ? cause.message : "无法保存声音设置。"); }
    finally { setIsPending(false); }
  }
  return <div className="storyboard-audio-select"><label><span>{label}</span><select aria-label={`${targetId} ${label}`} disabled={isPending || cues.length === 0} onChange={(event) => void change(event.target.value)} value={value}><option value="">不配置</option>{cues.map((cue) => <option key={cue.id} value={cue.id}>{cue.description}</option>)}</select></label>{error ? <p className="form-error" role="alert">{error}</p> : null}</div>;
}

function EpisodeBgmSettingsPanel({ episode, isMaterialPending, materials, onImport, onSave, reviewPackage, selection }: { episode: Episode; isMaterialPending: boolean; materials: MaterialRevision[]; onImport: MaterialImportHandler; onSave: (input: StoryboardAudioSelectionRequest) => Promise<void>; reviewPackage: ReviewPackage; selection?: StoryboardAudioSelection }) {
  const bgmMaterials = materials.filter((material) => material.material_type === "audio" && material.material_purpose === "background_music");
  const [enabled, setEnabled] = useState(Boolean(selection?.material_revision_id));
  const [materialId, setMaterialId] = useState(selection?.material_revision_id ?? "");
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { setEnabled(Boolean(selection?.material_revision_id)); setMaterialId(selection?.material_revision_id ?? ""); }, [selection?.material_revision_id, selection?.updated_at]);
  async function saveMaterial(nextMaterialId: string) {
    const previous = materialId;
    setMaterialId(nextMaterialId); setError(""); setIsPending(true);
    try { await onSave({ audioKind: "bgm", cueId: null, episodeId: episode.id, materialRevisionId: nextMaterialId || null, reviewPackageId: reviewPackage.id, targetId: episode.id, targetKind: "episode" }); }
    catch (cause) { setMaterialId(previous); setError(cause instanceof Error ? cause.message : "无法保存整期 BGM。"); }
    finally { setIsPending(false); }
  }
  async function toggle(nextEnabled: boolean) {
    if (nextEnabled) { setEnabled(true); setError(""); return; }
    if (!materialId && !selection?.material_revision_id) { setEnabled(false); setError(""); return; }
    setIsPending(true); setError("");
    try { await onSave({ audioKind: "bgm", cueId: null, episodeId: episode.id, materialRevisionId: null, reviewPackageId: reviewPackage.id, targetId: episode.id, targetKind: "episode" }); setEnabled(false); setMaterialId(""); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "无法关闭整期 BGM。"); }
    finally { setIsPending(false); }
  }
  async function importFile(file: File | undefined) {
    if (!file || materialTypeForFile(file) !== "audio") { setError("请选择 MP3、WAV、M4A 或其他音频文件。"); return; }
    setIsPending(true); setError("");
    try {
      const importedId = await onImport({ content: new Uint8Array(await new Response(file).arrayBuffer()), episodeId: episode.id, isMainScript: false, logicalName: canonicalMaterialName("background_music", file.name, "audio", bgmMaterials.length + 1), materialPurpose: "background_music", materialType: "audio", mimeType: file.type || "application/octet-stream", sourceKind: "file", sourcePath: file.name });
      if (typeof importedId !== "string") throw new Error("音频已上传，但没有返回素材版本。");
      await saveMaterial(importedId);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "无法上传 BGM。"); }
    finally { setIsPending(false); }
  }
  return <section aria-label="整期 BGM" className={`episode-bgm-settings${enabled ? " is-enabled" : " is-disabled"}`}><header><div><h4>整期 BGM</h4><p className="muted-copy">为整期审核视频配置背景音乐。</p></div><label className="episode-bgm-switch"><span>使用 BGM</span><input checked={enabled} disabled={isPending} onChange={(event) => void toggle(event.target.checked)} role="switch" type="checkbox" /></label></header>{enabled ? <div className="episode-bgm-controls"><label><span>第一阶段已上传音频</span><select aria-label="整期 BGM 音频" disabled={isPending} onChange={(event) => void saveMaterial(event.target.value)} value={materialId}><option value="">请选择音频</option>{bgmMaterials.map((material) => <option key={material.id} value={material.id}>{material.source_path}</option>)}</select></label><label className="episode-bgm-upload"><span><strong>{isPending || isMaterialPending ? "处理中…" : "上传音频"}</strong><small>MP3 · WAV · M4A</small></span><input accept="audio/*,.mp3,.wav,.m4a,.aac,.flac" aria-label="上传整期 BGM" disabled={isPending || isMaterialPending} onChange={(event) => { const input = event.currentTarget; void importFile(input.files?.[0]).finally(() => { input.value = ""; }); }} type="file" /></label></div> : <p className="episode-bgm-disabled-copy">本期不配置 BGM。</p>}{error ? <p className="form-error" role="alert">{error}</p> : null}</section>;
}

function shotTtsTask(task: Task, reviewPackageId: string, shotId: string): boolean {
  const snapshot = task.input_snapshot;
  if (!snapshot || Array.isArray(snapshot) || typeof snapshot !== "object") return false;
  const preparation = snapshot.shot_preparation;
  return task.task_type === "generate_narration" && preparation !== null && typeof preparation === "object" && !Array.isArray(preparation) && preparation.review_package_id === reviewPackageId && preparation.shot_id === shotId;
}

function taskTtsText(task: Task | undefined): string | null {
  const snapshot = task?.input_snapshot;
  if (!snapshot || Array.isArray(snapshot) || typeof snapshot !== "object") return null;
  const media = snapshot.media;
  if (!media || Array.isArray(media) || typeof media !== "object") return null;
  const narration = media.narration;
  if (!narration || Array.isArray(narration) || typeof narration !== "object") return null;
  return typeof narration.text === "string" ? narration.text : null;
}

type ClipSegmentDraft = { endSeconds: number; startSeconds: number };

function ShotMarkerPreview({ activeSegment, disabled, episodeId, material, maxDuration, onChange, onDuration, shotId }: { activeSegment: ClipSegmentDraft; disabled: boolean; episodeId: string; material: MaterialRevision; maxDuration: number; onChange: (segment: ClipSegmentDraft) => void; onDuration: (duration: number) => void; shotId: string }) {
  const source = localArtifactUrl(episodeId, material.storage_path, material.sha256);
  const { error, url } = useLocalArtifactBlob(source);
  const previewRef = useRef<HTMLVideoElement>(null);
  const [playheadSeconds, setPlayheadSeconds] = useState(activeSegment.startSeconds);
  const seekPreview = (seconds: number) => { if (previewRef.current) previewRef.current.currentTime = seconds; setPlayheadSeconds(seconds); };
  useEffect(() => { seekPreview(activeSegment.startSeconds); }, [activeSegment.startSeconds, material.id]);
  return <figure className="shot-marker-preview">
    {url ? <video aria-label={`${material.source_path} 预览`} controls onLoadedMetadata={(event) => { const duration = event.currentTarget.duration; if (Number.isFinite(duration) && duration > 0) onDuration(duration); seekPreview(activeSegment.startSeconds); }} onPlay={(event) => { event.currentTarget.currentTime = activeSegment.startSeconds; setPlayheadSeconds(activeSegment.startSeconds); }} onTimeUpdate={(event) => { const current = event.currentTarget.currentTime; if (current >= activeSegment.endSeconds) { event.currentTarget.pause(); event.currentTarget.currentTime = activeSegment.endSeconds; setPlayheadSeconds(activeSegment.endSeconds); } else setPlayheadSeconds(Math.max(activeSegment.startSeconds, current)); }} preload="metadata" ref={previewRef} src={url} /> : error ? <p className="form-error">{error}</p> : <LoadingIndicator compact label="正在加载素材预览…" />}
    <div aria-label={`${shotId} 视频缩略图轨道`} className="clip-filmstrip">
      {url ? Array.from({ length: 8 }, (_, index) => <video aria-hidden="true" key={index} muted onLoadedMetadata={(event) => { event.currentTarget.currentTime = Math.max(0, ((index + 0.5) / 8) * event.currentTarget.duration); }} playsInline preload="metadata" src={url} />) : Array.from({ length: 8 }, (_, index) => <span aria-hidden="true" key={index} />)}
      <Range disabled={disabled} max={maxDuration} min={0} onChange={([startSeconds, endSeconds]) => { onChange({ endSeconds, startSeconds }); seekPreview(startSeconds); }} renderThumb={({ props, index }) => { const { key, ...thumbProps } = props; return <div key={key} {...thumbProps} aria-label={`${shotId} ${index === 0 ? "入点" : "出点"}`} className="clip-range-thumb" />; }} renderTrack={({ props, children }) => <div {...props} className="clip-filmstrip-track"><div className="clip-filmstrip-selection" style={{ left: `${(activeSegment.startSeconds / maxDuration) * 100}%`, width: `${((activeSegment.endSeconds - activeSegment.startSeconds) / maxDuration) * 100}%` }} /><i aria-hidden="true" className="clip-filmstrip-playhead" style={{ left: `${(playheadSeconds / maxDuration) * 100}%` }} />{children}</div>} step={0.001} values={[activeSegment.startSeconds, activeSegment.endSeconds]} />
    </div>
    <figcaption>{material.source_path} · {(material.file_size / 1024 / 1024).toFixed(1)} MB</figcaption>
  </figure>;
}

function draftClipSegments(draft: ShotPreparationDraft | undefined, fallbackDuration: number): ClipSegmentDraft[] {
  const raw = (draft as (ShotPreparationDraft & { clip_segments?: Json }) | undefined)?.clip_segments;
  if (Array.isArray(raw)) {
    const segments = raw.filter((item): item is { end_seconds: number; start_seconds: number } => item !== null && typeof item === "object" && !Array.isArray(item) && typeof item.start_seconds === "number" && typeof item.end_seconds === "number");
    if (segments.length) return segments.map((segment) => ({ endSeconds: segment.end_seconds, startSeconds: segment.start_seconds }));
  }
  if (draft?.clip_start_seconds != null && draft.clip_end_seconds != null) return [{ endSeconds: draft.clip_end_seconds, startSeconds: draft.clip_start_seconds }];
  return [{ endSeconds: fallbackDuration, startSeconds: 0 }];
}

function structureRevisionBasePackageId(task: Task): string | null {
  if (task.task_type !== "draft_storyboard_revision" || !task.input_snapshot || Array.isArray(task.input_snapshot) || typeof task.input_snapshot !== "object") return null;
  const revision = task.input_snapshot.storyboard_revision;
  return revision && !Array.isArray(revision) && typeof revision === "object" && typeof revision.base_review_package_id === "string" ? revision.base_review_package_id : null;
}

function structureRevisionOperation(task: Task): Record<string, Json | undefined> | null {
  if (task.task_type !== "draft_storyboard_revision" || !task.input_snapshot || Array.isArray(task.input_snapshot) || typeof task.input_snapshot !== "object") return null;
  const revision = task.input_snapshot.storyboard_revision;
  if (!revision || Array.isArray(revision) || typeof revision !== "object") return null;
  const operation = revision.operation;
  return operation && !Array.isArray(operation) && typeof operation === "object" ? operation : null;
}

function latestStructureRevisionTask(tasks: Task[], baseReviewPackageId: string): Task | null {
  return tasks.reduce<Task | null>((latest, task) => {
    if (structureRevisionBasePackageId(task) !== baseReviewPackageId) return latest;
    return !latest || latest.created_at < task.created_at || (latest.created_at === task.created_at && latest.id < task.id) ? task : latest;
  }, null);
}

function structureRevisionPendingFromTask(task: Task, shots: StoryboardShot[]): { baseReviewPackageId: string; label: string; targetShotId: string } | null {
  const baseReviewPackageId = structureRevisionBasePackageId(task);
  const operation = structureRevisionOperation(task);
  const kind = operation?.kind;
  if (!baseReviewPackageId || !operation || typeof kind !== "string" || !(kind in storyboardStructureOperationLabels)) return null;
  const stringAt = (value: Json | undefined) => typeof value === "string" ? value : "";
  const operationShotId = stringAt(operation.shotId) || stringAt(operation.afterShotId) || stringAt(operation.newShotId);
  const nestedShot = operation.shot;
  const addedShotId = nestedShot && !Array.isArray(nestedShot) && typeof nestedShot === "object" ? stringAt(nestedShot.id) : "";
  const splitParts = Array.isArray(operation.parts) ? operation.parts : [];
  const splitShotId = splitParts[0] && !Array.isArray(splitParts[0]) && typeof splitParts[0] === "object" ? stringAt(splitParts[0].id) : "";
  const reorderedShotIds = Array.isArray(operation.shotIds) ? operation.shotIds : [];
  const targetShotId = kind === "delete"
    ? (() => { const index = shots.findIndex((shot) => shot.id === stringAt(operation.shotId)); return shots[index + 1]?.id ?? shots[index - 1]?.id ?? ""; })()
    : addedShotId || splitShotId || operationShotId || stringAt(reorderedShotIds[0]);
  return { baseReviewPackageId, label: storyboardStructureOperationLabels[kind as StoryboardStructureOperationKind], targetShotId };
}

function ShotWorkbench({ artifact, audioSelections, audioTracks, blueprint, durationSettings, drafts, episode, isMaterialPending, isReviewVideoPending, isTtsSettingsPending, materialRevisions, onGenerateTts, onGenerateReviewVideo, onImportMaterial, onOpenStudio, onSave, onSaveEpisodeTtsSettings, onSaveStoryboardAudioSelection, reviewPackage, tasks, onRequestShotStructureRevision }: { artifact: Artifact; audioSelections: StoryboardAudioSelection[]; audioTracks: AudioTrack[]; blueprint?: Json; durationSettings: ReviewRenderDurationSettings; drafts: ShotPreparationDraft[]; episode: Episode; isMaterialPending: boolean; isReviewVideoPending: boolean; isTtsSettingsPending: boolean; materialRevisions: MaterialRevision[]; onGenerateTts: (input: ShotTtsGenerationRequest) => Promise<void>; onGenerateReviewVideo: (input: ShotReviewVideoRequest) => Promise<void>; onImportMaterial: MaterialImportHandler; onOpenStudio: (episodeId: string, projectRelativePath: string) => Promise<OpenChatCutStudioWorkspace>; onSave: (input: ShotPreparationDraftRequest) => Promise<void>; onSaveEpisodeTtsSettings: (input: { episodeId: string; languageCode: string; speakingRate: number; voice: string }) => Promise<void>; onSaveStoryboardAudioSelection: (input: StoryboardAudioSelectionRequest) => Promise<void>; reviewPackage: ReviewPackage; tasks: Task[]; onRequestShotStructureRevision: (input: ShotStructureRevisionRequest) => Promise<void> }) {
  const [advancedShotId, setAdvancedShotId] = useState("");
  const [structureRevisionPending, setStructureRevisionPending] = useState<{ baseReviewPackageId: string; label: string; targetShotId: string } | null>(null);
  const [structureRevisionError, setStructureRevisionError] = useState("");
  const [acceptDurationRisk, setAcceptDurationRisk] = useState(false);
  const [studioWorkspace, setStudioWorkspace] = useState<OpenChatCutStudioWorkspace | null>(null);
  const [studioError, setStudioError] = useState("");
  const [isStudioPending, setIsStudioPending] = useState(false);
  const source = localArtifactUrl(artifact.episode_id, artifact.relative_path, artifact.sha256);
  const { content, error } = useLocalArtifactText(source);
  const storyboard = content ? parseStoryboard(content) : null;
  const storyboardShotIds = storyboard?.shots.map((shot) => shot.id).join("\u0000") ?? "";
  const draftRevisionKey = drafts.map((draft) => `${draft.id}:${draft.updated_at}`).sort().join("\u0000");
  useEffect(() => {
    if (!structureRevisionPending || structureRevisionPending.baseReviewPackageId === reviewPackage.id || !storyboard?.shots.length) return;
    const targetShotId = storyboard.shots.some((shot) => shot.id === structureRevisionPending.targetShotId) ? structureRevisionPending.targetShotId : storyboard.shots[0].id;
    setAdvancedShotId(targetShotId);
    window.history.replaceState(null, "", `#storyboard-shot-${reviewPackage.id}-${encodeURIComponent(targetShotId)}`);
    setStructureRevisionPending(null);
  }, [reviewPackage.id, storyboardShotIds, structureRevisionPending]);
  useEffect(() => {
    if (!storyboard?.shots.length || structureRevisionPending) return;
    const task = latestStructureRevisionTask(tasks, reviewPackage.id);
    if (!task || (task.status !== "ready" && task.status !== "running")) return;
    const pending = structureRevisionPendingFromTask(task, storyboard.shots);
    if (pending) setStructureRevisionPending(pending);
  }, [reviewPackage.id, storyboardShotIds, structureRevisionPending, tasks]);
  useEffect(() => {
    if (!storyboard?.shots.length || !window.location.hash.startsWith("#storyboard-shot-")) return;
    const shot = storyboard.shots.find((candidate) => window.location.hash.endsWith(`-${encodeURIComponent(candidate.id)}`));
    if (!shot || window.location.hash === `#storyboard-shot-${reviewPackage.id}-${encodeURIComponent(shot.id)}`) return;
    setAdvancedShotId(shot.id);
    window.history.replaceState(null, "", `#storyboard-shot-${reviewPackage.id}-${encodeURIComponent(shot.id)}`);
  }, [reviewPackage.id, storyboardShotIds]);
  useEffect(() => {
    if (!structureRevisionPending) return;
    const latestTask = latestStructureRevisionTask(tasks, structureRevisionPending.baseReviewPackageId);
    if (latestTask?.status === "failed" || latestTask?.status === "blocked") {
      setStructureRevisionPending(null);
      setStructureRevisionError("结构修改未能应用；旧版分镜和已保存配置保持不变。");
    }
  }, [structureRevisionPending, tasks]);
  useEffect(() => { setStudioWorkspace(null); setStudioError(""); }, [artifact.id, draftRevisionKey, reviewPackage.id]);
  if (error) return <section className="review-section shot-workbench"><h3>分镜工作台</h3><p className="form-error">{error}</p></section>;
  if (!content || !storyboard) return <section className="review-section shot-workbench"><h3>分镜工作台</h3>{content ? <p className="form-error">分镜产物格式无效，无法建立镜头准备草稿。</p> : <LoadingIndicator compact label="正在读取分镜工作台…" />}</section>;
  const workbenchShots = storyboard.shots;
  const sfxCuesByShot = new Map<string, StoryboardAudioCue[]>();
  let shotStartSeconds = 0;
  for (const shot of workbenchShots) {
    const shotEndSeconds = shotStartSeconds + shot.durationSeconds;
    sfxCuesByShot.set(shot.id, storyboard.audioCues.filter((cue) => cue.kind === "sfx" && cue.startSeconds >= shotStartSeconds && cue.startSeconds < shotEndSeconds));
    shotStartSeconds = shotEndSeconds;
  }
  const packageDrafts = drafts.filter((draft) => draft.review_package_id === reviewPackage.id);
  const defaults = episodeTtsSettings(episode);
  const shotIssue = (shot: StoryboardShot): "audio" | "subtitle" | "visual" | null => {
    const draft = packageDrafts.find((candidate) => candidate.shot_id === shot.id);
    if (!draft?.selected_material_revision_id || !Array.isArray(draft.clip_segments) || draft.clip_segments.length === 0) return "visual";
    if (draft.subtitles_enabled && !draft.subtitle_text.trim()) return "subtitle";
    if (draft.audio_mode === "tts" && (draft.audio_status !== "ready" || !draft.current_audio_track_id)) return "audio";
    return null;
  };
  const firstPendingIndex = storyboard.shots.findIndex((shot) => shotIssue(shot));
  const currentPendingIndex = firstPendingIndex >= 0 ? firstPendingIndex : 0;
  const runningCount = packageDrafts.filter((draft) => draft.video_status === "running" || draft.audio_status === "running").length;
  const missingCount = storyboard.shots.filter((shot) => shotIssue(shot) === "visual").length;
  const currentPendingShot = firstPendingIndex >= 0 ? storyboard.shots[firstPendingIndex]?.id ?? "—" : "全部已准备";
  const hashShotId = storyboard.shots.find((shot) => window.location.hash === `#storyboard-shot-${reviewPackage.id}-${encodeURIComponent(shot.id)}`)?.id;
  const selectedShotId = advancedShotId || hashShotId;
  const selectShot = (shotId: string) => { setAdvancedShotId(shotId); window.history.replaceState(null, "", `#storyboard-shot-${reviewPackage.id}-${encodeURIComponent(shotId)}`); };
  const savedCount = storyboard.shots.filter((shot) => { const draft = packageDrafts.find((candidate) => candidate.shot_id === shot.id); return Boolean(draft?.selected_material_revision_id && Array.isArray(draft.clip_segments) && draft.clip_segments.length && (!draft.subtitles_enabled || draft.subtitle_text.trim())); }).length;
  const ttsShotCount = packageDrafts.filter((draft) => draft.audio_mode === "tts").length;
  const readyTtsCount = packageDrafts.filter((draft) => draft.audio_mode === "tts" && draft.audio_status === "ready" && Boolean(draft.current_audio_track_id)).length;
  const runningTtsCount = packageDrafts.filter((draft) => draft.audio_mode === "tts" && draft.audio_status === "running").length;
  const durationRiskCount = storyboard.shots.filter((shot) => { const draft = packageDrafts.find((candidate) => candidate.shot_id === shot.id); if (!draft) return false; const segments = draftClipSegments(draft, shot.durationSeconds); const clipDuration = segments.reduce((total, segment) => total + segment.endSeconds - segment.startSeconds, 0); const actualAudioDuration = draft.audio_mode === "tts" ? draft.tts_actual_duration_seconds ?? null : draft.audio_mode === "source" ? draft.video_duration_seconds ?? null : null; return createShotDurationDecision({ actualAudioDurationSeconds: actualAudioDuration, allowedFrames: durationSettings.allowedFrames, audioMode: draft.audio_mode, clipDurationSeconds: clipDuration, frameRate: durationSettings.frameRate, plannedDurationSeconds: shot.durationSeconds }).status === "needs_attention"; }).length;
  const reviewVideoReady = savedCount === storyboard.shots.length && readyTtsCount === ttsShotCount && runningTtsCount === 0 && !structureRevisionPending && (!durationRiskCount || acceptDurationRisk);
  const voiceOptions = availableTtsVoices(blueprint, defaults.languageCode, defaults.voice);
  const subtitleIssueCount = storyboard.shots.filter((shot) => shotIssue(shot) === "subtitle").length;
  const audioIssueCount = storyboard.shots.filter((shot) => shotIssue(shot) === "audio").length;
  const readinessCheckCount = Math.max(1, storyboard.shots.length * 4);
  const completedReadinessCheckCount = Math.max(0, readinessCheckCount - missingCount - audioIssueCount - subtitleIssueCount - (storyboard.shots.length - savedCount));
  const readinessPercent = Math.round(completedReadinessCheckCount / readinessCheckCount * 100);
  async function submitStructureRevision(input: ShotStructureRevisionRequest) {
    const currentShotId = selectedShotId || workbenchShots[currentPendingIndex]?.id || "";
    const deletedShotId = input.operation.kind === "delete" ? input.operation.shotId : "";
    const deletedShotIndex = deletedShotId ? workbenchShots.findIndex((shot) => shot.id === deletedShotId) : -1;
    const targetShotId = input.operation.kind === "delete"
      ? workbenchShots[deletedShotIndex + 1]?.id ?? workbenchShots[deletedShotIndex - 1]?.id ?? ""
      : currentShotId;
    setStructureRevisionError("");
    setStructureRevisionPending({ baseReviewPackageId: reviewPackage.id, label: storyboardStructureOperationLabels[input.operation.kind], targetShotId });
    try {
      await onRequestShotStructureRevision(input);
    } catch (cause) {
      setStructureRevisionPending(null);
      setStructureRevisionError(cause instanceof Error ? cause.message : "无法提交分镜结构修订。");
      throw cause;
    }
  }
  async function openStudioWorkspace() {
    setStudioError("");
    setIsStudioPending(true);
    try {
      const openWithDurationSettings = onOpenStudio as (episodeId: string, projectRelativePath: string, settings?: ReviewRenderDurationSettings) => Promise<OpenChatCutStudioWorkspace>;
      setStudioWorkspace(await openWithDurationSettings(episode.id, artifact.relative_path, durationSettings));
    } catch (cause) {
      setStudioError(cause instanceof Error ? cause.message : "无法打开 OpenChatCut。");
    } finally {
      setIsStudioPending(false);
    }
  }
  return <section aria-label="分镜工作台" className="review-section shot-workbench">
    <header className="shot-workbench-header">
      <h3>分镜工作台</h3>
      <div className="shot-workbench-overview">
        <span>{storyboard.shots.length} 个镜头 · 当前待处理 {currentPendingShot}</span>
        <p className="muted-copy">在这里设置口播、绑定原片并保存片段标记；实际裁剪与镜头处理在后续审核视频阶段完成。</p>
        {structureRevisionPending ? <p className="muted-copy" role="status">正在后台应用“{structureRevisionPending.label}”；完成后会在此处切换到新版分镜。</p> : null}
        {structureRevisionError ? <p className="form-error" role="alert">{structureRevisionError}</p> : null}
      </div>
    </header>
    <nav aria-label="分镜准备概览" className="shot-readiness-overview">
      <header><strong>镜头准备度 {readinessPercent}%</strong><span>{savedCount}/{storyboard.shots.length} 设置已保存</span></header>
      <div aria-label={`镜头准备度 ${readinessPercent}%`} aria-valuemax={100} aria-valuemin={0} aria-valuenow={readinessPercent} className="shot-readiness-progress" role="progressbar"><i style={{ width: `${readinessPercent}%` }} /></div>
      <div className="shot-readiness-flags">
        {missingCount ? <button className="is-missing" onClick={() => { const shot = storyboard.shots.find((candidate) => shotIssue(candidate) === "visual"); if (shot) selectShot(shot.id); }} type="button">{missingCount} 个画面待处理</button> : null}
        {audioIssueCount || runningCount ? <button className="is-working" onClick={() => { const shot = storyboard.shots.find((candidate) => shotIssue(candidate) === "audio"); if (shot) selectShot(shot.id); }} type="button">{runningCount || audioIssueCount} 个{runningCount ? "口播生成中" : "口播待生成"}</button> : null}
        {subtitleIssueCount ? <button className="is-missing" onClick={() => { const shot = storyboard.shots.find((candidate) => shotIssue(candidate) === "subtitle"); if (shot) selectShot(shot.id); }} type="button">{subtitleIssueCount} 个字幕待处理</button> : null}
        {!missingCount && !audioIssueCount && !runningCount && !subtitleIssueCount ? <span className="is-ready">所有检查已完成</span> : <span>其余项目已完成</span>}
      </div>
    </nav>
    <EpisodeBgmSettingsPanel episode={episode} isMaterialPending={isMaterialPending} materials={materialRevisions} onImport={onImportMaterial} onSave={onSaveStoryboardAudioSelection} reviewPackage={reviewPackage} selection={audioSelections.find((selection) => selection.target_kind === "episode" && selection.audio_kind === "bgm" && selection.target_id === episode.id)} />
    <EpisodeTtsSettingsPanel blueprint={blueprint} episode={episode} isPending={isTtsSettingsPending} onSave={onSaveEpisodeTtsSettings} />
    <div className="shot-workbench-list">
      {storyboard.shots.map((shot, index) => <ShotPreparationCard audioTracks={audioTracks} defaults={defaults} durationSettings={durationSettings} draft={packageDrafts.find((candidate) => candidate.shot_id === shot.id)} episode={episode} isInitiallyOpen={selectedShotId ? shot.id === selectedShotId : index === currentPendingIndex} isMaterialPending={isMaterialPending} isStructureRevisionPending={Boolean(structureRevisionPending)} key={shot.id} materialRevisions={materialRevisions} onAdvance={storyboard.shots[index + 1] ? () => selectShot(storyboard.shots[index + 1].id) : undefined} onGenerateTts={onGenerateTts} onImportMaterial={onImportMaterial} onSave={onSave} onSaveStoryboardAudioSelection={onSaveStoryboardAudioSelection} onSelect={() => selectShot(shot.id)} reviewPackage={reviewPackage} sfxCues={sfxCuesByShot.get(shot.id) ?? []} sfxSelection={audioSelections.find((selection) => selection.target_kind === "shot" && selection.audio_kind === "sfx" && selection.target_id === shot.id)} shot={shot} tasks={tasks} onRequestShotStructureRevision={submitStructureRevision} shots={storyboard.shots} voiceOptions={voiceOptions} />)}
    </div>
    <section aria-label="OpenChatCut 审核视频" className="shot-workbench-completion">
      <div><h4>在 OpenChatCut 编辑并生成审核视频</h4><p className="muted-copy">先打开可编辑工作版本并完成剪辑；只有点击“生成审核视频”才会冻结当前版本并提交 Worker。</p></div>
      <span>镜头已保存 {savedCount}/{storyboard.shots.length} · 口播已就绪 {readyTtsCount}/{ttsShotCount}</span>
      {durationRiskCount ? <label><input checked={acceptDurationRisk} onChange={(event) => setAcceptDurationRisk(event.target.checked)} type="checkbox" />已核对并接受 {durationRiskCount} 个镜头的音画时长差异</label> : null}
      <div className="shot-workbench-completion-actions"><button className="button button-secondary" disabled={isStudioPending || isReviewVideoPending || !reviewVideoReady} onClick={() => void openStudioWorkspace()} type="button">{isStudioPending ? "正在打开…" : studioWorkspace ? "重新打开 OpenChatCut 编辑" : "在 OpenChatCut 中编辑"}</button>{studioWorkspace ? <button className="button button-primary" disabled={isReviewVideoPending || !reviewVideoReady} onClick={() => void onGenerateReviewVideo({ acceptDurationRisk, allowedFrames: durationSettings.allowedFrames, episodeId: episode.id, frameRate: durationSettings.frameRate, reviewPackageId: reviewPackage.id, riskReason: acceptDurationRisk ? "已在分镜工作台核对并接受当前音画时长差异。" : null, storyboardRelativePath: artifact.relative_path, workspaceRelativePath: studioWorkspace.relativePath })} type="button">{isReviewVideoPending ? "正在生成…" : "生成审核视频"}</button> : null}</div>
      {studioWorkspace ? <small className="shot-workbench-studio-path">当前可编辑工作版本：{studioWorkspace.relativePath}</small> : null}
      {studioError ? <p className="form-error" role="alert">{studioError}</p> : null}
    </section>
  </section>;
}

function ShotDurationSummary({ decision, isMultiSegment, adjustDisabledReason, onAdjustToTts }: { decision: ShotDurationDecision; isMultiSegment: boolean; adjustDisabledReason?: string; onAdjustToTts?: () => void }) {
  const delta = (value: number | null) => value === null ? "—" : `${value >= 0 ? "+" : ""}${value.toFixed(3)}s`;
  const duration = (value: number | null) => value === null ? "—" : `${value.toFixed(3)}s`;
  if (decision.status === "synchronized") return <section aria-label="镜头时长判定" className="shot-duration-summary is-synchronized" role="status"><p>音画时长一致 ✓</p></section>;
  if (decision.status === "not_applicable") return <section aria-label="镜头时长判定" className="shot-duration-summary is-not_applicable" role="status"><p>无口播，无需同步检查</p></section>;
  if (decision.status !== "needs_attention") return <section aria-label="镜头时长判定" className="shot-duration-summary is-pending" role="status"><p>生成口播后将自动检查音画时长</p></section>;
  return <section aria-label="镜头时长判定" className="shot-duration-summary is-needs_attention" role="status"><div><p>口播 {duration(decision.actualAudioDurationSeconds)} · 当前片段 {duration(decision.clipDurationSeconds)} · 相差 {delta(decision.audioVideoDeltaSeconds)}</p><small>分镜计划 {duration(decision.plannedDurationSeconds)} · 容差 {decision.frameToleranceSeconds.toFixed(3)}s（{decision.allowedFrames} 帧 @ {decision.frameRate}fps）</small></div><div>{isMultiSegment ? <small>多片段请{(decision.audioVideoDeltaSeconds ?? 0) > 0 ? "增加" : "减少"} {Math.abs(decision.audioVideoDeltaSeconds ?? 0).toFixed(3)}s</small> : null}{adjustDisabledReason ? <small>{adjustDisabledReason}</small> : null}</div>{onAdjustToTts ? <button className="button button-secondary button-small" disabled={Boolean(adjustDisabledReason)} onClick={onAdjustToTts} type="button">按口播时长调整</button> : null}</section>;
}

function ShotPreparationCard({ audioTracks, defaults, draft, durationSettings, episode, isInitiallyOpen, isMaterialPending, isStructureRevisionPending, materialRevisions, onAdvance, onGenerateTts, onImportMaterial, onSave, onSaveStoryboardAudioSelection, onSelect, reviewPackage, sfxCues, sfxSelection, shot, tasks, onRequestShotStructureRevision, shots, voiceOptions }: { audioTracks: AudioTrack[]; defaults: EpisodeTtsSettings; draft?: ShotPreparationDraft; durationSettings: ReviewRenderDurationSettings; episode: Episode; isInitiallyOpen: boolean; isMaterialPending: boolean; isStructureRevisionPending: boolean; materialRevisions: MaterialRevision[]; onAdvance?: () => void; onGenerateTts: (input: ShotTtsGenerationRequest) => Promise<void>; onImportMaterial: MaterialImportHandler; onSave: (input: ShotPreparationDraftRequest) => Promise<void>; onSaveStoryboardAudioSelection: (input: StoryboardAudioSelectionRequest) => Promise<void>; onSelect: () => void; reviewPackage: ReviewPackage; sfxCues: StoryboardAudioCue[]; sfxSelection?: StoryboardAudioSelection; shot: StoryboardShot; tasks: Task[]; onRequestShotStructureRevision: (input: ShotStructureRevisionRequest) => Promise<void>; shots: StoryboardShot[]; voiceOptions: string[] }) {
  const [isOpen, setIsOpen] = useState(isInitiallyOpen);
  const draftHasSavedSettings = Boolean(draft?.selected_material_revision_id && Array.isArray(draft.clip_segments) && draft.clip_segments.length);
  const [hasSavedSettings, setHasSavedSettings] = useState(draftHasSavedSettings);
  const [isDirty, setIsDirty] = useState(false);
  const cardRef = useRef<HTMLElement>(null);
  const shotAnchor = `#storyboard-shot-${reviewPackage.id}-${encodeURIComponent(shot.id)}`;
  const wasInitiallyOpenRef = useRef(isInitiallyOpen && window.location.hash !== shotAnchor);
  const [audioMode, setAudioMode] = useState<ShotPreparationDraft["audio_mode"]>(draft?.audio_mode ?? "tts");
  const [subtitleText, setSubtitleText] = useState(draft?.subtitle_text ?? shot.scriptSegment);
  const [ttsText, setTtsText] = useState(draft?.tts_text ?? draft?.subtitle_text ?? shot.scriptSegment);
  const initialOverrideVoice = draft?.tts_override_voice ?? (draft?.tts_voice && draft.tts_voice !== defaults.voice ? draft.tts_voice : "");
  const initialOverrideRate = draft?.tts_override_speaking_rate ?? (draft?.tts_speaking_rate != null && String(draft.tts_speaking_rate) !== defaults.speakingRate ? draft.tts_speaking_rate : null);
  const [overrideVoice, setOverrideVoice] = useState(initialOverrideVoice);
  const [overrideRate, setOverrideRate] = useState(initialOverrideRate == null ? "" : String(initialOverrideRate));
  const [settingsDialog, setSettingsDialog] = useState<StoryboardStructureOperationKind | "audio" | null>(null);
  const settingsDialogRef = useDialogFocus(Boolean(settingsDialog), () => setSettingsDialog(null));
  const [isVoicePreviewPending, setIsVoicePreviewPending] = useState(false);
  const voicePreviewAudioRef = useRef<HTMLAudioElement | null>(null);
  const voicePreviewUrlRef = useRef<string | null>(null);
  const [subtitlesEnabled, setSubtitlesEnabled] = useState(draft?.subtitles_enabled ?? true);
  const [materialRevisionId, setMaterialRevisionId] = useState(draft?.selected_material_revision_id ?? "");
  const [activeStep, setActiveStep] = useState<"text" | "visual">("text");
  const [clipSegments, setClipSegments] = useState<ClipSegmentDraft[]>(() => draftClipSegments(draft, shot.durationSeconds));
  const [activeSegmentIndex, setActiveSegmentIndex] = useState(0);
  const [sourceDuration, setSourceDuration] = useState<number | null>(null);
  const [isPending, setIsPending] = useState(false);
  const [isGenerationRequested, setIsGenerationRequested] = useState(false);
  const generationBaselineTaskIdRef = useRef<string | null>(null);
  const [error, setError] = useState("");
  const isDirtyRef = useRef(false);
  const structureChangesDisabled = isStructureRevisionPending || episode.stage !== "storyboard_approved";
  useEffect(() => () => { voicePreviewAudioRef.current?.pause(); if (voicePreviewUrlRef.current) URL.revokeObjectURL(voicePreviewUrlRef.current); }, []);
  const frozen = Boolean(draft?.frozen_at) && !["storyboard_approved", "production_ready", "render_ready", "qc_review"].includes(episode.stage);
  const eligibleMaterials = materialRevisions.filter((material) => material.material_type === "video" && material.material_purpose === (shot.shotType === "a_roll" ? "a_roll" : "b_roll"));
  const automaticallyMatchedMaterials = eligibleMaterials.filter((material) => shot.inputBasis.some((input) => input.sha256 === material.sha256 && input.relativePath === material.storage_path));
  const automaticallyMatchedMaterial = automaticallyMatchedMaterials.length === 1 ? automaticallyMatchedMaterials[0] : undefined;
  const resolvedMaterialRevisionId = materialRevisionId || automaticallyMatchedMaterial?.id || "";
  const selectedMaterial = eligibleMaterials.find((material) => material.id === resolvedMaterialRevisionId);
  useEffect(() => { if (isInitiallyOpen) { setIsOpen(true); if (!wasInitiallyOpenRef.current) cardRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" }); } wasInitiallyOpenRef.current = isInitiallyOpen; }, [isInitiallyOpen]);
  useEffect(() => { setHasSavedSettings(draftHasSavedSettings); }, [draftHasSavedSettings, reviewPackage.id]);
  useEffect(() => {
    if (!draft || isDirtyRef.current) return;
    setAudioMode(draft.audio_mode); setSubtitleText(draft.subtitle_text); setTtsText(draft.tts_text ?? draft.subtitle_text); setSubtitlesEnabled(draft.subtitles_enabled); setMaterialRevisionId(draft.selected_material_revision_id ?? ""); setClipSegments(draftClipSegments(draft, shot.durationSeconds)); setOverrideVoice(draft.tts_override_voice ?? (draft.tts_voice && draft.tts_voice !== defaults.voice ? draft.tts_voice : "")); setOverrideRate(draft.tts_override_speaking_rate == null ? (draft.tts_speaking_rate != null && String(draft.tts_speaking_rate) !== defaults.speakingRate ? String(draft.tts_speaking_rate) : "") : String(draft.tts_override_speaking_rate));
  }, [defaults.speakingRate, defaults.voice, draft?.id, draft?.updated_at, shot.durationSeconds]);
  const maxDuration = sourceDuration ?? Math.max(shot.durationSeconds, ...clipSegments.map((segment) => segment.endSeconds), 1);
  const activeSegment = clipSegments[activeSegmentIndex] ?? clipSegments[0];
  const totalClipDuration = clipSegments.reduce((total, segment) => total + Math.max(0, segment.endSeconds - segment.startSeconds), 0);
  const segmentsValid = Boolean(resolvedMaterialRevisionId) && clipSegments.length > 0 && clipSegments.every((segment) => Number.isFinite(segment.startSeconds) && Number.isFinite(segment.endSeconds) && segment.startSeconds >= 0 && segment.endSeconds > segment.startSeconds && segment.endSeconds <= maxDuration);
  const markDirty = () => { isDirtyRef.current = true; setIsDirty(true); };
  const updateSegment = (index: number, next: Partial<ClipSegmentDraft>) => { markDirty(); setClipSegments((current) => current.map((segment, segmentIndex) => segmentIndex === index ? { ...segment, ...next } : segment)); };
  const selectMaterial = (id: string) => { markDirty(); setMaterialRevisionId(id); setSourceDuration(null); setClipSegments([{ endSeconds: shot.durationSeconds, startSeconds: 0 }]); setActiveSegmentIndex(0); };
  async function save(includeVideo = true, ttsOverride?: { speakingRate: number | null; voice: string | null }, advanceAfterSave = true): Promise<boolean> {
    if (includeVideo && !segmentsValid) { setError("请选择原片并完成至少一个有效片段标记。"); return false; }
    if (subtitlesEnabled && !subtitleText.trim()) { setError("请填写字幕正文；如不需要字幕，请关闭字幕显示。"); return false; }
    setError(""); setIsPending(true);
    try {
      const spokenText = ttsText.trim();
      if (audioMode === "tts" && !spokenText) { setError("请填写口播内容。"); return false; }
      await onSave({ audioMode, clipSegments: clipSegments.map((segment) => ({ end_seconds: segment.endSeconds, start_seconds: segment.startSeconds })), episodeId: episode.id, includeVideo, materialRevisionId: resolvedMaterialRevisionId, reviewPackageId: reviewPackage.id, shotId: shot.id, subtitleText: subtitleText.trim(), subtitlesEnabled, ttsOverride, ttsSpeakingRate: null, ttsText: audioMode === "tts" ? spokenText : null, ttsVoice: null });
      if (audioMode === "tts" && sfxSelection?.cue_id) await onSaveStoryboardAudioSelection({ audioKind: "sfx", cueId: null, episodeId: episode.id, reviewPackageId: reviewPackage.id, targetId: shot.id, targetKind: "shot" });
      isDirtyRef.current = false; setIsDirty(false);
      if (includeVideo) { setHasSavedSettings(true); if (advanceAfterSave) { setIsOpen(false); onAdvance?.(); } }
      return true;
    } catch (cause) { setError(cause instanceof Error ? cause.message : "无法保存镜头准备草稿。"); return false; }
    finally { setIsPending(false); }
  }

  const ttsTasks = tasks.filter((task) => shotTtsTask(task, reviewPackage.id, shot.id)).sort((left, right) => right.created_at.localeCompare(left.created_at));
  const latestTtsTask = ttsTasks[0]; const currentTask = draft?.current_tts_task_id ? tasks.find((task) => task.id === draft.current_tts_task_id) : latestTtsTask; const isCurrentText = !currentTask || taskTtsText(currentTask) === (draft?.tts_text ?? ttsText); const isGenerating = latestTtsTask?.status === "ready" || latestTtsTask?.status === "running"; const ttsError = draft?.tts_error ?? (latestTtsTask?.status === "failed" ? "口播任务失败，请重试。" : "");
  useEffect(() => {
    if (!isGenerationRequested || !latestTtsTask || latestTtsTask.id === generationBaselineTaskIdRef.current) return;
    if (latestTtsTask.status === "completed" || latestTtsTask.status === "failed" || latestTtsTask.status === "blocked" || latestTtsTask.status === "superseded") setIsGenerationRequested(false);
  }, [isGenerationRequested, latestTtsTask?.id, latestTtsTask?.status]);
  const shotTracks = audioTracks.filter((track) => track.episode_id === episode.id && track.source_review_package_id === reviewPackage.id && track.cue_id === shot.id).sort((left, right) => right.created_at.localeCompare(left.created_at));
  const currentTrack = audioTracks.find((track) => track.id === draft?.current_audio_track_id) ?? (audioMode === "source" ? shotTracks.find((track) => track.track_kind === "source") : undefined); const historicalTrack = shotTracks.find((track) => track.track_kind === "narration" && track.id !== currentTrack?.id && tasks.some((task) => task.id === track.source_task_id && task.task_type === "generate_narration" && task.status === "completed")); const clipStatus = draftHasSavedSettings && !isDirty ? "已保存" : automaticallyMatchedMaterial && !draft?.selected_material_revision_id ? "已匹配，待保存" : resolvedMaterialRevisionId && segmentsValid ? "待保存" : "缺少原片"; const audioLabel = audioMode === "tts" ? "TTS 口播" : audioMode === "source" ? "保留原声" : "静音"; const audioStatus = isGenerating ? "生成中" : isGenerationRequested ? "等待 Worker" : draft?.audio_status === "ready" ? "已就绪" : draft?.audio_status === "failed" ? "失败" : audioMode === "none" ? "已保存" : "待生成";
  const ttsSettingsReady = Boolean(episode.tts_language_code && episode.tts_voice && episode.tts_speaking_rate && episode.tts_speaking_rate > 0);
  const generationBusy = isPending || isGenerating || isGenerationRequested;
  const historicalStatus = draft?.frozen_at ? draft.confirmation_status === "confirmed" ? "历史冻结 · 已确认" : "历史冻结" : draft?.confirmation_status === "confirmed" ? "历史已确认" : draft?.confirmation_status === "skipped" ? "历史已跳过" : "";
  const actualAudioDuration = audioMode === "none" ? null : audioMode === "source" ? (segmentsValid ? totalClipDuration : null) : currentTrack && isCurrentText ? currentTrack.duration_seconds : draft?.tts_actual_duration_seconds ?? null;
  const durationDecision = createShotDurationDecision({ audioMode, actualAudioDurationSeconds: actualAudioDuration, clipDurationSeconds: segmentsValid ? totalClipDuration : null, frameRate: durationSettings.frameRate, allowedFrames: durationSettings.allowedFrames, plannedDurationSeconds: shot.durationSeconds });
  const isSingleTtsSegment = audioMode === "tts" && clipSegments.length === 1 && durationDecision.actualAudioDurationSeconds !== null;
  const adjustedTtsEnd = isSingleTtsSegment ? clipSegments[0].startSeconds + (durationDecision.actualAudioDurationSeconds ?? 0) : null;
  const adjustDisabledReason = !isSingleTtsSegment ? undefined : sourceDuration === null ? "读取原片时长后可按 TTS 时长调整。" : adjustedTtsEnd! > sourceDuration ? "原片不足以容纳当前 TTS 时长。" : undefined;
  const adjustToTts = () => {
    if (!isSingleTtsSegment || adjustDisabledReason || adjustedTtsEnd === null) return;
    markDirty(); setClipSegments([{ startSeconds: clipSegments[0].startSeconds, endSeconds: adjustedTtsEnd }]); setActiveSegmentIndex(0);
  };
  const visibleTrack = currentTrack && isCurrentText ? currentTrack : !currentTrack ? historicalTrack : undefined; const ttsGeneration = visibleTrack || ttsError ? <>{visibleTrack ? <AudioTrackCard annotations={[]} sourceTask={tasks.find((task) => task.id === visibleTrack.source_task_id)} status={visibleTrack === currentTrack ? "当前音轨" : "历史音轨 · 不作为当前"} track={visibleTrack} /> : null}{currentTrack && !isCurrentText ? <p className="muted-copy">当前音频对应旧口播文案；保存新文案并重新生成后才会切换。</p> : null}{ttsError ? <p className="form-error" role="alert">{ttsError} <button className="button-link" onClick={() => void generate(true)} type="button">安全重试</button></p> : null}</> : null;
  async function generate(retry = false) {
    setError("");
    if (!ttsSettingsReady) { setError("请先保存本期 TTS 设置，再生成口播。"); return; }
    generationBaselineTaskIdRef.current = latestTtsTask?.id ?? null;
    setIsGenerationRequested(true);
    try {
      if (!await save(false)) { setIsGenerationRequested(false); return; }
      await onGenerateTts({ episodeId: episode.id, reviewPackageId: reviewPackage.id, retry, shotId: shot.id });
    } catch (cause) { setIsGenerationRequested(false); setError(cause instanceof Error ? cause.message : "无法创建逐镜头口播任务。"); }
  }
  async function previewVoice() {
    const rate = Number(overrideRate || defaults.speakingRate);
    const voice = (overrideVoice || defaults.voice).trim();
    if (!voice || !Number.isFinite(rate) || rate <= 0) { setError("请选择声音并填写有效语速。"); return; }
    setError(""); setIsVoicePreviewPending(true);
    try {
      const { data, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw sessionError;
      if (!data.session) throw new Error("需要 Owner 登录会话。");
      const response = await fetch(`/_tts-voice-preview?episode=${encodeURIComponent(episode.id)}`, { body: JSON.stringify({ languageCode: defaults.languageCode, speakingRate: rate, voice }), headers: { Authorization: `Bearer ${data.session.access_token}`, "Content-Type": "application/json" }, method: "POST" });
      if (!response.ok) throw new Error((await response.text()).trim() || "无法试听当前音色。");
      voicePreviewAudioRef.current?.pause();
      if (voicePreviewUrlRef.current) URL.revokeObjectURL(voicePreviewUrlRef.current);
      const previewUrl = URL.createObjectURL(await response.blob());
      const audio = new Audio(previewUrl);
      voicePreviewAudioRef.current = audio; voicePreviewUrlRef.current = previewUrl;
      audio.addEventListener("ended", () => { URL.revokeObjectURL(previewUrl); if (voicePreviewUrlRef.current === previewUrl) voicePreviewUrlRef.current = null; }, { once: true });
      await audio.play();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "无法试听当前音色。"); }
    finally { setIsVoicePreviewPending(false); }
  }
  async function submitStructureRevision(input: ShotStructureRevisionRequest) {
    if (isDirtyRef.current && !await save(true, undefined, false)) throw new Error("请先完成当前镜头的保存，再调整结构。");
    await onRequestShotStructureRevision(input);
    setSettingsDialog(null);
  }
  const structureOperations = Object.entries(storyboardStructureOperationLabels) as Array<[StoryboardStructureOperationKind, string]>;
  return <article className={`shot-preparation-card${isOpen ? " is-open" : ""}${hasSavedSettings ? " is-saved" : ""}${isDirty ? " is-dirty" : ""}`} id={shotAnchor.slice(1)} ref={cardRef}>
    <button aria-expanded={isOpen} className="shot-preparation-summary" onClick={() => { if (!isOpen) onSelect(); setIsOpen((open) => !open); }} type="button"><span><strong>{shot.id}</strong><small>{shot.shotType === "a_roll" ? "A-roll" : "B-roll"} · 当前片段 {totalClipDuration.toFixed(3)}s / 计划 {shot.durationSeconds}s</small></span><span aria-label={`${shot.id} 准备状态`} className="shot-preparation-statuses"><small className={`shot-status is-${clipStatus === "已保存" ? "ready" : clipStatus === "缺少原片" ? "missing" : "pending"}`}>画面 · {clipStatus}</small><small className={`shot-status is-${audioStatus === "已就绪" || audioStatus === "已保存" ? "ready" : audioStatus === "失败" ? "error" : audioStatus === "生成中" || audioStatus === "等待 Worker" ? "working" : "pending"}`}>{audioLabel} · {audioStatus}</small><small className={`shot-status shot-save-state is-${isDirty ? "dirty" : hasSavedSettings ? "saved" : "missing"}`}>{isDirty ? "设置 · 未保存" : hasSavedSettings ? "设置 · 已保存" : "设置 · 待保存"}</small>{historicalStatus ? <small className="shot-status is-history">{historicalStatus}</small> : null}</span></button>
    {isOpen ? <div className="shot-preparation-body">
      <nav aria-label={`${shot.id} 准备步骤`} className="shot-preparation-steps"><button aria-current={activeStep === "text" ? "step" : undefined} className={activeStep === "text" ? "is-active" : undefined} onClick={() => setActiveStep("text")} type="button"><span>1</span>文本与声音</button><button aria-current={activeStep === "visual" ? "step" : undefined} className={activeStep === "visual" ? "is-active" : undefined} onClick={() => setActiveStep("visual")} type="button"><span>2</span>画面与标记</button></nav>
      {activeStep === "text" ? <div className="shot-preparation-fields">
        <section aria-label={`${shot.id} 声音`} className="shot-content-section shot-narration-section"><header><div><h4>声音</h4><p className="muted-copy">{audioMode === "tts" ? "为当前镜头生成口播。" : "主声音与镜头音效分别设置。"}</p></div></header><div className={`shot-sound-selects${audioMode === "tts" ? " is-single" : ""}`}><label><span>主声音</span><select aria-label={`${shot.id} 主声音`} disabled={frozen} onChange={(event) => { markDirty(); setError(""); setAudioMode(event.target.value as ShotPreparationDraft["audio_mode"]); }} value={audioMode}><option value="tts">TTS 口播</option><option value="source">保留原声</option><option value="none">静音</option></select></label>{audioMode !== "tts" ? <StoryboardAudioSelect audioKind="sfx" cues={sfxCues} episode={episode} label="镜头音效" onSave={onSaveStoryboardAudioSelection} reviewPackage={reviewPackage} selection={sfxSelection} targetId={shot.id} targetKind="shot" /> : null}</div>{audioMode === "tts" ? <><div className="shot-tts-copy-field"><div className="shot-tts-copy-header"><span>口播内容</span></div><div className="shot-tts-copy-input"><textarea aria-label={`${shot.id} 口播内容`} disabled={frozen} onChange={(event) => { markDirty(); setTtsText(event.target.value); }} rows={3} value={ttsText} /></div></div>{!ttsSettingsReady ? <p className="form-error tts-prerequisite" role="status">请先保存上方“本期 TTS 设置”，再生成口播。</p> : null}{ttsGeneration}<footer className="shot-narration-footer"><div><button aria-label={`${shot.id} 恢复分镜文案`} className="button button-secondary" disabled={frozen || generationBusy || ttsText === shot.scriptSegment} onClick={() => { markDirty(); setTtsText(shot.scriptSegment); }} type="button">恢复分镜文案</button><button className="button button-secondary" disabled={frozen || generationBusy} onClick={() => void save(false)} type="button">{isPending ? "保存中…" : "保存口播设置"}</button><button className="button button-primary" disabled={frozen || generationBusy || !ttsSettingsReady} onClick={() => void generate(Boolean(latestTtsTask?.status === "failed"))} type="button">{isGenerating ? "口播生成中…" : isGenerationRequested ? "等待 Worker 领取…" : currentTrack ? "重新生成口播" : "生成口播"}</button></div></footer></> : <><p className="muted-copy shot-primary-audio-note">{audioMode === "source" ? "使用当前视频片段中已有的声音。" : "移除镜头自身的声音。"}</p>{ttsGeneration}<footer className="shot-narration-footer"><div /><button className="button button-secondary" disabled={frozen || isPending} onClick={() => void save(false)} type="button">{isPending ? "保存中…" : "保存声音模式"}</button></footer></>}</section>
        <section aria-label={`${shot.id} 字幕`} className="shot-content-section shot-subtitle-section"><header><h4>字幕</h4><label className="shot-subtitle-switch"><span><strong>显示字幕</strong></span><input checked={subtitlesEnabled} disabled={frozen} onChange={(event) => { markDirty(); setError(""); setSubtitlesEnabled(event.target.checked); }} role="switch" type="checkbox" /></label></header>{subtitlesEnabled ? <label>字幕正文<textarea aria-label={`${shot.id} 字幕正文`} disabled={frozen} onChange={(event) => { markDirty(); setSubtitleText(event.target.value); }} rows={3} value={subtitleText} /></label> : <p className="muted-copy">字幕已关闭，审核视频中不会显示字幕正文。</p>}</section>
      </div> : null}
      {activeStep === "visual" ? <>
        <ShotDurationSummary decision={durationDecision} isMultiSegment={clipSegments.length > 1} adjustDisabledReason={adjustDisabledReason} onAdjustToTts={isSingleTtsSegment ? adjustToTts : undefined} />
        <section aria-label={`${shot.id} 画面准备`} className="shot-clip-editor">
        <h4>原片与片段标记</h4>
        <div className="shot-source-toolbar">
          <label>当前原片<select aria-label={`${shot.id} 当前原片`} disabled={frozen} onChange={(event) => selectMaterial(event.target.value)} value={resolvedMaterialRevisionId}>{!resolvedMaterialRevisionId ? <option value="">请选择原片</option> : null}{eligibleMaterials.map((material) => <option key={material.id} value={material.id}>{material.source_path}{material.id === automaticallyMatchedMaterial?.id ? "（自动匹配）" : ""}</option>)}</select></label>
          <ShotSourceMaterialForm episodeId={episode.id} existingMaterials={eligibleMaterials} isPending={isMaterialPending} onImport={onImportMaterial} onImported={selectMaterial} shot={shot} />
        </div>
        <section aria-label={`${shot.id} 片段标记`} className="manual-clip-selection">
          <header className="clip-editor-header"><strong>片段标记</strong></header>
          <div aria-label={`${shot.id} 片段列表`} className="clip-segment-tabs">{clipSegments.map((segment, index) => <div className={`clip-segment-tab${activeSegmentIndex === index ? " is-active" : ""}`} key={index}><button disabled={frozen} onClick={() => setActiveSegmentIndex(index)} type="button"><strong>片段 {index + 1}</strong><span>{segment.startSeconds.toFixed(3)}–{segment.endSeconds.toFixed(3)}s</span></button><button aria-label={`删除片段 ${index + 1}`} disabled={frozen || clipSegments.length === 1} onClick={() => { markDirty(); setClipSegments((current) => current.filter((_, segmentIndex) => segmentIndex !== index)); setActiveSegmentIndex((current) => Math.max(0, Math.min(current, clipSegments.length - 2))); }} type="button">×</button></div>)}<button aria-label="添加片段" className="clip-segment-add" disabled={frozen || !resolvedMaterialRevisionId} onClick={() => { markDirty(); setClipSegments((current) => [...current, { endSeconds: Math.min(maxDuration, shot.durationSeconds), startSeconds: 0 }]); setActiveSegmentIndex(clipSegments.length); }} type="button">＋ 添加片段</button></div>
          {activeSegment && selectedMaterial ? <ShotMarkerPreview activeSegment={activeSegment} disabled={frozen} episodeId={episode.id} key={`${selectedMaterial.id}:${activeSegmentIndex}`} material={selectedMaterial} maxDuration={maxDuration} onChange={(segment) => updateSegment(activeSegmentIndex, segment)} onDuration={(duration) => { setSourceDuration(duration); setClipSegments((current) => current.map((segment) => ({ startSeconds: Math.min(segment.startSeconds, Math.max(0, duration - 0.001)), endSeconds: Math.min(segment.endSeconds, duration) }))); }} shotId={shot.id} /> : null}
          {!segmentsValid ? <p className="clip-duration-status is-invalid">请先选择原片并填写有效的入点和出点。</p> : null}
        </section>
      </section>
      </> : null}
      <div className="shot-preparation-actions">{activeStep === "visual" ? <button className="button button-secondary" onClick={() => setActiveStep("text")} type="button">上一步</button> : <button className="button button-secondary" onClick={() => setActiveStep("visual")} type="button">下一步：画面与标记</button>}{activeStep === "visual" ? <button className="button button-primary" disabled={frozen || isPending} onClick={() => void save()} type="button">{isPending ? "保存中…" : "保存镜头设置"}</button> : null}{error ? <p className="form-error" role="alert">{error}</p> : null}</div>
    </div> : null}
    <details className="shot-actions-menu"><summary aria-label={shot.id + " 更多操作"} title="更多操作"><Ellipsis aria-hidden="true" className="icon" /></summary><div aria-label={`${shot.id} 镜头设置`} className="shot-actions-panel"><section><span aria-label="镜头调整说明：提交后将创建修订任务；新版完成前保留当前分镜。" className="shot-action-heading" tabIndex={0} title="提交后将创建修订任务；新版完成前保留当前分镜。"><strong>镜头调整</strong><span aria-hidden="true">ⓘ</span></span><div className="shot-action-list">{structureOperations.map(([kind, label]) => <button disabled={structureChangesDisabled} key={kind} onClick={(event) => { event.currentTarget.closest("details")?.removeAttribute("open"); setSettingsDialog(kind); }} type="button">{label}</button>)}</div>{isStructureRevisionPending ? <small role="status">结构修改应用中</small> : null}</section>{audioMode === "tts" ? <section className="shot-action-audio"><button onClick={(event) => { event.currentTarget.closest("details")?.removeAttribute("open"); setSettingsDialog("audio"); }} type="button"><strong>声音设置</strong></button></section> : null}</div></details>
    {settingsDialog ? <div className="shot-settings-backdrop" onMouseDown={() => setSettingsDialog(null)}><section aria-label={settingsDialog === "audio" ? `${shot.id} 声音设置` : `${shot.id} ${storyboardStructureOperationLabels[settingsDialog]}`} aria-modal="true" className="shot-settings-dialog" onMouseDown={(event) => event.stopPropagation()} ref={settingsDialogRef} role="dialog" tabIndex={-1}><header><div><h4>{settingsDialog === "audio" ? "声音设置" : storyboardStructureOperationLabels[settingsDialog]}</h4><p className="muted-copy">{shot.id}</p></div><button aria-label="关闭镜头设置" className="icon-button" onClick={() => setSettingsDialog(null)} type="button"><X className="icon" /></button></header>{settingsDialog !== "audio" ? <ShotStructureRevisionForm disabled={structureChangesDisabled} episodeId={episode.id} kind={settingsDialog} onSubmit={submitStructureRevision} reviewPackageId={reviewPackage.id} shot={shot} shots={shots} /> : <div className="shot-tts-override-fields"><label>声音<input aria-label={`${shot.id} 单独设置声音`} disabled={frozen} list={`${shot.id}-voice-options`} onChange={(event) => { markDirty(); setOverrideVoice(event.target.value); }} placeholder={`本期：${defaults.voice}；输入以筛选`} value={overrideVoice} /><datalist id={`${shot.id}-voice-options`}>{voiceOptions.map((voice) => <option key={voice} value={voice} />)}</datalist></label><label>语速<input aria-label={`${shot.id} 单独设置语速`} disabled={frozen} min="0.1" onChange={(event) => { markDirty(); setOverrideRate(event.target.value); }} placeholder={`本期：${defaults.speakingRate}`} step="0.01" type="number" value={overrideRate} /></label><div><button aria-label={`${shot.id} 试听声音设置`} className="button button-secondary" disabled={frozen || isPending || isVoicePreviewPending} onClick={() => void previewVoice()} type="button"><Volume2 aria-hidden="true" size={16} />{isVoicePreviewPending ? "试听中…" : "试听配置"}</button><button className="button button-primary" disabled={frozen || isPending || isVoicePreviewPending} onClick={() => { const rate = Number(overrideRate || defaults.speakingRate); const voice = (overrideVoice || defaults.voice).trim(); if (!voice || !Number.isFinite(rate) || rate <= 0) { setError("请选择声音并填写有效语速。"); return; } void save(false, { speakingRate: rate, voice }).then((saved) => { if (saved) setSettingsDialog(null); }); }} type="button">保存此镜头设置</button><button className="button button-secondary" disabled={frozen || isPending || (!overrideVoice && !overrideRate)} onClick={() => { setOverrideVoice(""); setOverrideRate(""); void save(false, { speakingRate: null, voice: null }).then((saved) => { if (saved) setSettingsDialog(null); }); }} type="button">恢复本期设置</button></div></div>}</section></div> : null}
  </article>;
}

function ShotStructureRevisionForm({ disabled = false, episodeId, kind, onSubmit, reviewPackageId, shot, shots }: { disabled?: boolean; episodeId: string; kind: StoryboardStructureOperationKind; onSubmit: (input: ShotStructureRevisionRequest) => Promise<void>; reviewPackageId: string; shot: StoryboardShot; shots: StoryboardShot[] }) {
  const [reason, setReason] = useState("");
  const [scriptSegment, setScriptSegment] = useState("");
  const [duration, setDuration] = useState(String(shot.durationSeconds));
  const [shotType, setShotType] = useState<StoryboardShot["shotType"]>(shot.shotType);
  const shotIndex = shots.findIndex((candidate) => candidate.id === shot.id);
  const adjacentShots = [shots[shotIndex - 1], shots[shotIndex + 1]].filter((candidate): candidate is StoryboardShot => Boolean(candidate));
  const [mergeShotId, setMergeShotId] = useState(adjacentShots[0]?.id ?? "");
  const [reorderIds, setReorderIds] = useState(shots.map((candidate) => candidate.id).join(","));
  const [splitScript, setSplitScript] = useState(shot.scriptSegment);
  const [splitDuration, setSplitDuration] = useState(String((shot.durationSeconds / 2).toFixed(3)));
  const [error, setError] = useState("");
  const [isPending, setIsPending] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!reason.trim()) { setError("请填写结构修订原因。"); return; }
    const seconds = Number(duration);
    let operation: StoryboardStructureOperation;
    if (kind === "add_after") {
      if (!scriptSegment.trim() || !Number.isFinite(seconds) || seconds <= 0) { setError("新增镜头需要文案和有效目标时长。"); return; }
      operation = { kind, afterShotId: shot.id, shot: { ...shot, id: `new-shot-${Date.now()}`, scriptSegment: scriptSegment.trim(), durationSeconds: seconds, shotType } };
    } else if (kind === "delete") operation = { kind, shotId: shot.id };
    else if (kind === "split") {
      const first = Number(splitDuration);
      const second = shot.durationSeconds - first;
      if (!splitScript.trim() || !Number.isFinite(first) || first <= 0 || second <= 0) { setError("拆分镜头需要两段有效时长，并且总时长必须保持不变。"); return; }
      operation = { kind, shotId: shot.id, parts: [{ id: `split-${Date.now()}-1`, scriptSegment: splitScript.trim(), durationSeconds: first }, { id: `split-${Date.now()}-2`, scriptSegment: splitScript.trim(), durationSeconds: second }] };
    } else if (kind === "merge") {
      if (!mergeShotId) { setError("请选择相邻镜头合并。"); return; }
      const mergeIndex = shots.findIndex((candidate) => candidate.id === mergeShotId);
      operation = { kind, shotIds: shotIndex < mergeIndex ? [shot.id, mergeShotId] : [mergeShotId, shot.id], newShotId: `merge-${Date.now()}` };
    } else if (kind === "reorder") operation = { kind, shotIds: reorderIds.split(",").map((id) => id.trim()).filter(Boolean) };
    else if (kind === "change_type") operation = { kind, shotId: shot.id, shotType };
    else if (!Number.isFinite(seconds) || seconds <= 0) { setError("请输入有效目标时长。"); return; }
    else operation = { kind, shotId: shot.id, durationSeconds: seconds };
    setError(""); setIsPending(true);
    try { await onSubmit({ episodeId, operation, reason: reason.trim(), reviewPackageId }); setReason(""); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "无法提交分镜结构修订。"); }
    finally { setIsPending(false); }
  }
  return <div className="shot-structure-revision-body"><form onSubmit={(event) => void submit(event)}><fieldset disabled={disabled || isPending}>{kind === "add_after" ? <><label>新镜头文案<textarea onChange={(event) => setScriptSegment(event.target.value)} required rows={2} value={scriptSegment} /></label><label>目标时长（秒）<input min="0.1" onChange={(event) => setDuration(event.target.value)} step="0.001" type="number" value={duration} /></label><label>镜头类型<select onChange={(event) => setShotType(event.target.value as StoryboardShot["shotType"])} value={shotType}><option value="a_roll">A-roll</option><option value="b_roll">B-roll</option></select></label></> : null}{kind === "split" ? <><label>拆分后文案<textarea onChange={(event) => setSplitScript(event.target.value)} required rows={2} value={splitScript} /></label><label>第一段时长（秒）<input min="0.1" onChange={(event) => setSplitDuration(event.target.value)} step="0.001" type="number" value={splitDuration} /></label><p className="muted-copy">第二段自动保持原镜头总时长。</p></> : null}{kind === "merge" ? <label>合并对象<select onChange={(event) => setMergeShotId(event.target.value)} value={mergeShotId}><option value="">选择相邻镜头</option>{adjacentShots.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.id}</option>)}</select></label> : null}{kind === "reorder" ? <label>镜头顺序（逗号分隔）<input onChange={(event) => setReorderIds(event.target.value)} value={reorderIds} /></label> : null}{kind === "change_type" ? <label>新的镜头类型<select onChange={(event) => setShotType(event.target.value as StoryboardShot["shotType"])} value={shotType}><option value="a_roll">A-roll</option><option value="b_roll">B-roll</option></select></label> : null}{kind === "change_duration" ? <label>新的目标时长（秒）<input min="0.1" onChange={(event) => setDuration(event.target.value)} step="0.001" type="number" value={duration} /></label> : null}<label>修订原因<textarea onChange={(event) => setReason(event.target.value)} required rows={2} value={reason} /></label><button className="button button-primary" type="submit">{isPending ? "提交中…" : disabled ? "后台应用中…" : "提交分镜结构修订"}</button></fieldset>{error ? <p className="form-error" role="alert">{error}</p> : null}</form></div>;
}

function ShotSourceMaterialForm({ episodeId, existingMaterials, isPending, onImport, onImported, shot }: { episodeId: string; existingMaterials: MaterialRevision[]; isPending: boolean; onImport: MaterialImportHandler; onImported: (materialId: string) => void; shot: StoryboardShot }) {
  const [isImporting, setIsImporting] = useState(false);
  const [error, setError] = useState("");
  const purpose = shot.shotType === "a_roll" ? "a_roll" : "b_roll";
  async function importFile(file: File | undefined) {
    if (!file || materialTypeForFile(file) !== "video") { setError("请选择 MP4、MOV 或 WebM 视频原片。"); return; }
    setIsImporting(true);
    setError("");
    try {
      const materialId = await onImport({ content: new Uint8Array(await new Response(file).arrayBuffer()), episodeId, isMainScript: false, logicalName: canonicalMaterialName(purpose, file.name, "video", existingMaterials.length + 1), materialPurpose: purpose, materialType: "video", mimeType: file.type || "application/octet-stream", sourceKind: "file", sourcePath: file.name });
      if (typeof materialId === "string") onImported(materialId);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "无法补充原片。"); }
    finally { setIsImporting(false); }
  }
  return <div className="shot-source-material-form"><label className="shot-source-material-slot"><span><strong>{purpose === "a_roll" ? "A-roll" : "B-roll"} 原片</strong><small>{isImporting || isPending ? "导入中…" : "点击选择视频文件"}</small></span><span className="shot-source-material-slot-meta">MP4 · MOV · WebM</span><input accept=".mp4,.mov,.webm,video/*" aria-label={`${shot.id} 补充原片`} disabled={isImporting || isPending} onChange={(event) => { const input = event.currentTarget; void importFile(input.files?.[0]).finally(() => { input.value = ""; }); }} type="file" /></label>{error ? <p className="form-error">{error}</p> : null}</div>;
}

function StoryboardReviewPackage({ annotations, artifact, episode, isAnnotationPending, materialRevisions, onCreateAnnotation, onRegisterManualMedia, onValidationChange, policy, reviewPackage, tasks = [] }: { annotations: ReviewAnnotation[]; artifact: Artifact; episode: Episode; isAnnotationPending: boolean; materialRevisions: MaterialRevision[]; onCreateAnnotation: (input: StoryboardAnnotationRequest) => Promise<void>; onRegisterManualMedia: (input: ManualMediaBindingRequest) => Promise<void>; onValidationChange: (valid: boolean) => void; policy?: Json; reviewPackage: ReviewPackage; tasks?: Task[] }) {
  const source = localArtifactUrl(artifact.episode_id, artifact.relative_path, artifact.sha256);
  const { content, error } = useLocalArtifactText(source);
  const storyboard = content ? parseStoryboard(content) : null;
  const storyboardShotIds = storyboard?.shots.map((shot) => shot.id).join("\u0000") ?? "";
  const [selectedShotId, setSelectedShotId] = useState("");
  const [annotationDrafts, setAnnotationDrafts] = useState<Record<string, string>>({});
  useEffect(() => { onValidationChange(!error && Boolean(storyboard)); }, [error, onValidationChange, storyboard]);
  useEffect(() => {
    if (!storyboard?.shots.length) return;
    const targetFromHash = storyboard.shots.find((shot) => window.location.hash === `#storyboard-shot-${reviewPackage.id}-${encodeURIComponent(shot.id)}`)?.id;
    setSelectedShotId((current) => targetFromHash ?? (storyboard.shots.some((shot) => shot.id === current) ? current : storyboard.shots[0].id));
  }, [reviewPackage.id, storyboardShotIds]);
  useEffect(() => { setAnnotationDrafts({}); }, [reviewPackage.id]);
  if (error) return <section className="review-section"><h3>可审核分镜 · 修订 v{reviewPackage.revision_number}</h3><p className="form-error">{error}</p></section>;
  if (!content) return <section className="review-section"><h3>可审核分镜 · 修订 v{reviewPackage.revision_number}</h3><LoadingIndicator compact label="正在读取分镜产物…" /></section>;
  if (!storyboard) return <section className="review-section"><h3>可审核分镜 · 修订 v{reviewPackage.revision_number}</h3><p className="form-error">分镜产物格式无效，无法审核。</p></section>;
  const manualChecklist = manualMaterialChecklistForStoryboard(policy, episode.id, storyboard, materialRevisions, tasks, reviewPackage.id);
  const manualNarration = manualChecklist.find((item) => item.capability === "narration_generation");
  const policyRecord = policy && !Array.isArray(policy) && typeof policy === "object" ? policy as Record<string, Json | undefined> : {};
  const isClipPreparation = episode.stage === "storyboard_approved";
  const selectedShotIndex = Math.max(0, storyboard.shots.findIndex((shot) => shot.id === selectedShotId));
  const selectedShot = storyboard.shots[selectedShotIndex];
  const renderStoryboardShot = (shot: StoryboardShot) => {
    const shotAnnotations = annotations.filter((annotation) => annotation.shot_id === shot.id);
    const capability = shot.shotType === "a_roll" ? "a_roll_generation" : "b_roll_generation";
    const requirements = <dl>{isClipPreparation ? null : <div><dt>脚本片段</dt><dd>{shot.scriptSegment}</dd></div>}<div><dt>目标时长</dt><dd>{shot.durationSeconds} 秒</dd></div><div><dt>制作方法</dt><dd>{shot.productionMethod}</dd></div><div><dt>目标规格</dt><dd>{shot.targetSpec}</dd></div><div><dt>生成依据</dt><dd title={shot.inputBasis.map((input) => `${input.relativePath} · ${input.sha256}`).join("、")}>{shot.inputBasis.map((input) => `${abbreviatePath(input.relativePath)} · ${input.sha256.slice(0, 12)}…`).join("、")}</dd></div></dl>;
    return <article aria-label={`镜头详情：${shot.id}`} className="storyboard-shot" id={`storyboard-shot-${reviewPackage.id}-${encodeURIComponent(shot.id)}`} key={shot.id}><h4>{shot.id} · {shot.shotType === "a_roll" ? "A-roll" : "B-roll"}</h4>{isClipPreparation ? <><p className="shot-script-summary">{shot.scriptSegment}</p><details className="prepared-shot-requirements"><summary>查看已批准分镜要求</summary>{requirements}</details><ManualMediaBinding boundClipSelection={boundManualClipSelection(capability, shot.id, tasks, reviewPackage.id)} boundMaterialRevisionId={boundManualMaterialRevisionId(capability, shot.id, tasks, reviewPackage.id)} episodeId={episode.id} kind={shot.shotType} label={`人工 ${shot.shotType === "a_roll" ? "A-roll" : "B-roll"} 视频`} materials={materialRevisions} onRegister={onRegisterManualMedia} reviewPackageId={reviewPackage.id} targetDurationSeconds={shot.durationSeconds} targetId={shot.id} /></> : requirements}{shotAnnotations.length ? <div className="storyboard-annotations"><strong>{isClipPreparation ? "分镜审核批注" : "已留批注"}</strong>{shotAnnotations.map((annotation) => <p key={annotation.id}>{annotation.reason}</p>)}</div> : null}{isClipPreparation ? null : <StoryboardAnnotationForm draft={annotationDrafts[shot.id] ?? ""} isPending={isAnnotationPending} onCreateAnnotation={onCreateAnnotation} onDraftChange={(reason) => setAnnotationDrafts((drafts) => ({ ...drafts, [shot.id]: reason }))} reviewPackageId={reviewPackage.id} shotId={shot.id} />}</article>;
  };
  return <section className={`review-section storyboard-review-package${isClipPreparation ? " is-clip-preparation" : ""}`}><h3>{isClipPreparation ? "镜头准备" : "可审核分镜"} · 修订 v{reviewPackage.revision_number}</h3>{isClipPreparation && manualChecklist.length ? <section aria-label="镜头准备清单" className="manual-material-checklist"><header><div><small>Studio 前</small><h4>镜头准备</h4></div><span>{manualChecklist.length} 项材料</span></header><p className="muted-copy">每个镜头选择原片并确认裁剪区间；同一个原片可以复用于多个镜头。Studio 只接收这里确认后的片段。</p><ul>{manualChecklist.map((item) => <li className={`is-${item.status}`} key={`${item.capability}-${item.targetId}`}><i aria-hidden="true" /><strong title={item.label}>{item.label}</strong><span>{item.status === "bound" ? "已准备" : item.status === "pending" ? "待准备" : `待上传 · ${item.materialPurpose}`}</span></li>)}</ul></section> : null}{isClipPreparation ? <p className="muted-copy">分镜内容已经审核完成；这里不再重复批注，只处理原片、入点和出点。</p> : <><p className="muted-copy storyboard-review-guidance">本阶段确认镜头顺序、内容与时长；实际片段和裁剪范围将在镜头准备阶段确定。</p><nav aria-label="分镜时间轴" className="storyboard-timeline">{storyboard.shots.map((shot, index) => <button aria-controls={`storyboard-shot-${reviewPackage.id}-${encodeURIComponent(shot.id)}`} aria-label={`选择 ${shot.id}，${shot.durationSeconds} 秒，${shot.shotType === "a_roll" ? "A-roll" : "B-roll"}`} aria-pressed={shot.id === selectedShot.id} className={shot.id === selectedShot.id ? "is-selected" : undefined} key={shot.id} onClick={() => setSelectedShotId(shot.id)} type="button"><StoryboardTimelineThumbnail episodeId={episode.id} index={index} materials={materialRevisions} shot={shot} /><strong title={shot.id}>{shot.id}</strong><small>{shot.durationSeconds} 秒 · {shot.shotType === "a_roll" ? "A-roll" : "B-roll"}</small></button>)}</nav><div aria-label="镜头切换" className="storyboard-shot-navigation"><span role="status">第 {selectedShotIndex + 1} / {storyboard.shots.length} 镜</span><div><button className="button button-secondary button-small" disabled={selectedShotIndex === 0} onClick={() => setSelectedShotId(storyboard.shots[selectedShotIndex - 1].id)} type="button">上一镜</button><button className="button button-secondary button-small" disabled={selectedShotIndex === storyboard.shots.length - 1} onClick={() => setSelectedShotId(storyboard.shots[selectedShotIndex + 1].id)} type="button">下一镜</button></div></div></>}{isClipPreparation && manualNarration ? <ManualMediaBinding boundMaterialRevisionId={boundManualMaterialRevisionId("narration_generation", episode.id, tasks, reviewPackage.id)} episodeId={episode.id} kind="narration" label="人工旁白音频（Episode）" materials={materialRevisions} onRegister={onRegisterManualMedia} reviewPackageId={reviewPackage.id} targetId={episode.id} /> : null}{isClipPreparation ? storyboard.shots.map(renderStoryboardShot) : renderStoryboardShot(selectedShot)}{storyboard.audioCues.length ? <section className="storyboard-audio-cues"><h4>可选声轨</h4>{storyboard.audioCues.map((cue) => <article key={cue.id}><strong>{cue.kind.toUpperCase()} · {cue.id}</strong><span>{cue.startSeconds}s – {(cue.startSeconds + cue.durationSeconds).toFixed(3)}s · {cue.description}</span><small>Freesound 检索词：{cue.searchQuery}</small>{isClipPreparation && policyRecord.soundtrack ? <ManualMediaBinding boundMaterialRevisionId={boundManualMaterialRevisionId("soundtrack_generation", cue.id, tasks, reviewPackage.id)} episodeId={episode.id} kind={cue.kind} label={`人工${cue.kind === "bgm" ? "配乐" : "音效"}`} materials={materialRevisions} onRegister={onRegisterManualMedia} reviewPackageId={reviewPackage.id} targetId={cue.id} /> : null}</article>)}</section> : null}</section>;
}

function StoryboardTimelineThumbnail({ episodeId, index, materials, shot }: { episodeId: string; index: number; materials: MaterialRevision[]; shot: StoryboardShot }) {
  const material = shot.inputBasis.filter((input) => /\.(mp4|mov|webm)$/i.test(input.relativePath)).map((input) => materials.find((candidate) => candidate.material_type === "video" && candidate.sha256 === input.sha256 && candidate.storage_path === input.relativePath)).find(Boolean);
  return material ? <StoryboardVideoTimelineThumbnail episodeId={episodeId} index={index} material={material} shot={shot} /> : <StoryboardTimelineTypeThumbnail index={index} shot={shot} />;
}

function StoryboardTimelineTypeThumbnail({ index, shot }: { index: number; shot: StoryboardShot }) {
  return <span aria-hidden="true" className={`storyboard-timeline-thumb is-${shot.shotType}`}><b>{String(index + 1).padStart(2, "0")}</b><i>{shot.shotType === "a_roll" ? "A-roll" : "B-roll"}</i></span>;
}

function StoryboardVideoTimelineThumbnail({ episodeId, index, material, shot }: { episodeId: string; index: number; material: MaterialRevision; shot: StoryboardShot }) {
  const { url } = useLocalArtifactBlob(localArtifactThumbnailUrl(episodeId, material.storage_path, material.sha256));
  return url ? <span aria-hidden="true" className={`storyboard-timeline-thumb is-${shot.shotType}`}><img alt="" src={url} /></span> : <StoryboardTimelineTypeThumbnail index={index} shot={shot} />;
}

function ManualMaterialPreview({ episodeId, material, onDuration }: { episodeId: string; material: MaterialRevision; onDuration?: (duration: number) => void }) {
  const kind = artifactPreviewKind(material.storage_path);
  const source = localArtifactUrl(episodeId, material.storage_path, material.sha256);
  const { error, url } = useLocalArtifactBlob(source);
  if (!kind) return null;
  return <figure className="manual-material-preview">{url ? <ArtifactPreviewMedia kind={kind} label={`${material.source_path} 预览`} onDuration={onDuration} source={url} /> : error ? <p className="form-error">{error}</p> : <LoadingIndicator compact label="正在加载素材预览…" />}<figcaption>{material.source_path} · {(material.file_size / 1024 / 1024).toFixed(1)} MB</figcaption></figure>;
}

function ManualMediaBinding({ boundClipSelection = null, boundMaterialRevisionId = null, episodeId, kind, label, materials, onRegister, reviewPackageId, targetDurationSeconds, targetId }: { boundClipSelection?: { endSeconds: number; startSeconds: number } | null; boundMaterialRevisionId?: string | null; episodeId: string; kind: ManualMediaKind; label: string; materials: MaterialRevision[]; onRegister: (input: ManualMediaBindingRequest) => Promise<void>; reviewPackageId: string; targetDurationSeconds?: number; targetId: string }) {
  const purpose = kind === "bgm" ? "background_music" : kind === "sfx" ? "sound_effect" : kind;
  const type = kind === "a_roll" || kind === "b_roll" ? "video" : "audio";
  const eligibleMaterials = materials.filter((material) => material.material_type === type && material.material_purpose === purpose);
  const [materialRevisionId, setMaterialRevisionId] = useState(boundMaterialRevisionId ?? "");
  const [clipStart, setClipStart] = useState(String(boundClipSelection?.startSeconds ?? 0));
  const [clipEnd, setClipEnd] = useState(String(boundClipSelection?.endSeconds ?? targetDurationSeconds ?? 0));
  const [error, setError] = useState("");
  const [isEditing, setIsEditing] = useState(!boundMaterialRevisionId);
  const [isPending, setIsPending] = useState(false);
  const boundMaterial = materials.find((material) => material.id === boundMaterialRevisionId);
  const selectedMaterial = eligibleMaterials.find((material) => material.id === materialRevisionId);
  const isVideo = kind === "a_roll" || kind === "b_roll";
  const clipStartSeconds = Number(clipStart);
  const clipEndSeconds = Number(clipEnd);
  const clipDurationSeconds = clipEndSeconds - clipStartSeconds;
  const clipIsValid = !isVideo || (clipStart.trim() !== "" && clipEnd.trim() !== "" && Number.isFinite(clipStartSeconds) && Number.isFinite(clipEndSeconds) && clipStartSeconds >= 0 && clipEndSeconds > clipStartSeconds && targetDurationSeconds !== undefined && Math.abs(clipDurationSeconds - targetDurationSeconds) <= durationToleranceSeconds());
  useEffect(() => {
    setMaterialRevisionId(boundMaterialRevisionId ?? "");
    setClipStart(String(boundClipSelection?.startSeconds ?? 0));
    setClipEnd(String(boundClipSelection?.endSeconds ?? targetDurationSeconds ?? 0));
    setIsEditing(!boundMaterialRevisionId);
  }, [boundClipSelection?.endSeconds, boundClipSelection?.startSeconds, boundMaterialRevisionId, targetDurationSeconds]);
  if (boundMaterialRevisionId && !isEditing) return <div className="manual-media-bound"><p role="status"><strong>当前镜头素材</strong> · {boundMaterial?.source_path ?? "已绑定文件"}{isVideo && boundClipSelection ? ` · 已准备 ${boundClipSelection.startSeconds}–${boundClipSelection.endSeconds} 秒` : ""}</p>{boundMaterial ? <ManualMaterialPreview episodeId={episodeId} material={boundMaterial} /> : null}{isVideo ? <button className="button button-secondary button-small" onClick={() => setIsEditing(true)} type="button">修改 {targetId} 的镜头素材</button> : null}</div>;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!materialRevisionId) { setError(`请先上传并选择${label}。`); return; }
    if (!clipIsValid) { setError(`裁剪片段必须与目标时长 ${targetDurationSeconds} 秒一致。`); return; }
    setError("");
    setIsPending(true);
    try {
      await onRegister({ ...(isVideo ? { clipEndSeconds, clipStartSeconds } : {}), episodeId, kind, materialRevisionId, ...(boundMaterialRevisionId ? { replace: true } : {}), storyboardReviewPackageId: reviewPackageId, targetId });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法冻结人工生产材料。");
    } finally {
      setIsPending(false);
    }
  }
  const clipDifference = isVideo && targetDurationSeconds !== undefined ? clipDurationSeconds - targetDurationSeconds : 0;
  return <form className="storyboard-annotation-form manual-media-form" onSubmit={(event) => void submit(event)}><label>{label}<select aria-label={`${targetId} ${label}`} onChange={(event) => setMaterialRevisionId(event.target.value)} value={materialRevisionId}><option value="">选择已上传文件</option>{eligibleMaterials.map((material) => <option key={material.id} value={material.id}>{material.source_path} · {Math.max(1, Math.round(material.file_size / 1024))} KB</option>)}</select></label>{selectedMaterial ? <ManualMaterialPreview episodeId={episodeId} material={selectedMaterial} /> : null}{isVideo ? <fieldset className="manual-clip-selection"><legend>裁剪区间 · 目标 {targetDurationSeconds} 秒</legend><div><label>入点<input aria-label={`${targetId} 裁剪入点（秒）`} min="0" onChange={(event) => setClipStart(event.target.value)} required step="0.001" type="number" value={clipStart} /></label><label>出点<input aria-label={`${targetId} 裁剪出点（秒）`} min="0" onChange={(event) => setClipEnd(event.target.value)} required step="0.001" type="number" value={clipEnd} /></label></div><p className={clipIsValid ? "clip-duration-status is-valid" : "clip-duration-status is-invalid"}>{clipIsValid ? `片段时长与目标一致（${clipDurationSeconds.toFixed(3)} 秒）` : clipStart.trim() && clipEnd.trim() && Number.isFinite(clipDifference) ? `当前片段 ${clipDurationSeconds.toFixed(3)} 秒，${clipDifference > 0 ? `请缩短 ${clipDifference.toFixed(3)}` : `请延长 ${Math.abs(clipDifference).toFixed(3)}`} 秒。` : "请填写有效的入点和出点。"}</p></fieldset> : null}{eligibleMaterials.length ? <p className="muted-copy">{isVideo ? `确认后会保存 ${targetId} 的原片和裁剪区间；同一原片可用于其他镜头。` : `确认后会把这个不可变文件版本固定用于 ${targetId}。`}</p> : <p className="form-error">请在“准备生产材料”中上传对应文件并选择正确用途。</p>}{error ? <p className="form-error">{error}</p> : null}<div className="manual-media-actions">{boundMaterialRevisionId ? <button className="button button-secondary" disabled={isPending} onClick={() => setIsEditing(false)} type="button">取消修改</button> : null}<button className="button button-primary" disabled={isPending || !materialRevisionId || !clipIsValid} type="submit">{isPending ? "保存中…" : boundMaterialRevisionId ? "保存镜头素材修改" : isVideo ? `确认用于 ${targetId}` : `确认${label}`}</button></div></form>;
}

function StoryboardAnnotationForm({ draft, isPending, onCreateAnnotation, onDraftChange, reviewPackageId, shotId }: { draft: string; isPending: boolean; onCreateAnnotation: (input: StoryboardAnnotationRequest) => Promise<void>; onDraftChange: (reason: string) => void; reviewPackageId: string; shotId: string }) {
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedReason = draft.trim();
    if (!trimmedReason) {
      setError("请填写镜头批注。");
      return;
    }
    setError("");
    try {
      await onCreateAnnotation({ reviewPackageId, shotId, reason: trimmedReason });
      onDraftChange("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法添加镜头批注。");
    }
  }
  return <form className="storyboard-annotation-form" onSubmit={(event) => { void submit(event); }}><label>镜头批注<textarea aria-label={`${shotId} 镜头批注`} onChange={(event) => onDraftChange(event.target.value)} rows={2} value={draft} /></label>{error ? <p className="form-error">{error}</p> : null}<button className="button button-secondary" disabled={isPending} type="submit">添加镜头批注</button></form>;
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

function ArtifactPreviewMedia({ kind, label, onDuration, source }: { kind: "image" | "video" | "audio"; label: string; onDuration?: (duration: number) => void; source: string }) {
  if (kind === "image") return <img alt={label} src={source} />;
  if (kind === "audio") return <audio aria-label={label} controls preload="metadata" src={source} />;
  return <video aria-label={label} controls key={source} onLoadedMetadata={onDuration ? (event) => { const duration = event.currentTarget.duration; if (Number.isFinite(duration)) onDuration(duration); } : undefined} preload="auto" src={source} />;
}

function LocalArtifactMedia({ artifact, kind, source }: { artifact: Artifact; kind: "image" | "video" | "audio"; source: string }) {
  const { error, url: previewUrl } = useLocalArtifactBlob(source);
  const [isExpanded, setIsExpanded] = useState(false);
  const lightboxRef = useDialogFocus(isExpanded, () => setIsExpanded(false));

  useEffect(() => {
    setIsExpanded(false);
  }, [artifact.id]);

  if (error) return <div className="no-media-preview"><Icon name="Play" /><strong>无法预览产物</strong><span>{error}</span></div>;
  if (!previewUrl) return <div className="no-media-preview"><LoadingIndicator label="正在加载产物预览" /><span>本机审核台正在验证 Owner 权限与产物索引。</span></div>;
  const previewLabel = `${artifact.artifact_type} 产物预览`;
  const expandedLabel = `${artifact.artifact_type} 产物放大预览`;
  return <><figure className="local-artifact-preview"><ArtifactPreviewMedia kind={kind} label={previewLabel} source={previewUrl} /><button aria-label={`放大查看 ${artifact.artifact_type} 产物`} className="artifact-expand-button" onClick={() => setIsExpanded(true)} type="button">放大查看</button><figcaption>{artifact.artifact_type} · {artifact.relative_path}</figcaption></figure>{isExpanded ? <div aria-label={expandedLabel} aria-modal="true" className="artifact-lightbox" onMouseDown={(event) => { if (event.target === event.currentTarget) setIsExpanded(false); }} ref={lightboxRef} role="dialog"><div className="artifact-lightbox-content"><button aria-label="关闭放大预览" className="artifact-lightbox-close" onClick={() => setIsExpanded(false)} type="button">关闭</button><ArtifactPreviewMedia kind={kind} label={expandedLabel} source={previewUrl} /></div></div> : null}</>;
}

function FinalRenderRetryAction({ episodeId, isPending, onRetry }: { episodeId: string; isPending: boolean; onRetry: (episodeId: string, reason: string) => Promise<boolean> }) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  async function retry() {
    if (!reason.trim()) { setError("请说明重试原因。"); return; }
    setError("");
    if (!await onRetry(episodeId, reason.trim())) setError("无法重新排队最终渲染。");
  }
  return <section className="review-section review-decision"><h3>最终渲染恢复</h3><p className="muted-copy">只重试失败的最终渲染；复用已批准的审核工程和冻结素材。</p><label>重试原因<textarea aria-label="最终渲染重试原因" onChange={(event) => setReason(event.target.value)} placeholder="说明已定位的问题和本次重试原因" rows={3} value={reason} /></label>{error ? <p className="form-error">{error}</p> : null}<div className="review-actions"><button className="button button-secondary" disabled={isPending} onClick={() => void retry()} type="button">重新生成最终渲染</button></div></section>;
}

function ReviewActions({ episode, hasOpenQcBlockers = false, isPending, onRequestRevision, onTransition, ownerId, reviewAction, reviewPackageId }: { episode: Episode; hasOpenQcBlockers?: boolean; isPending: boolean; onRequestRevision: (input: ReviewRevisionRequest) => Promise<ReviewRevisionOutcome>; onTransition: (episodeId: string, toStage: EpisodeStage, reason: string) => Promise<boolean>; ownerId: string; reviewAction: ReviewAction; reviewPackageId: string | null }) {
  const [draft, setDraft] = useState(() => readOperationDraft<ReviewDecisionDraft>(ownerId, episode.id, "review-decision"));
  const [reason, setReason] = useState(draft?.reason ?? "");
  const [error, setError] = useState("");
  const isReviewRenderRevision = (episode.stage === "qc_review" || episode.stage === "render_ready") && reviewAction.requestChangesStage === "render_ready";
  const isReviewRenderRecovery = episode.stage === "render_ready" && isReviewRenderRevision;

  useEffect(() => {
    const next = readOperationDraft<ReviewDecisionDraft>(ownerId, episode.id, "review-decision");
    setDraft(next);
    setReason(next?.reason ?? "");
    setError("");
  }, [episode.id, ownerId, reviewPackageId]);

  function saveDraft(next: ReviewDecisionDraft) { if (next.reason.trim() || isReviewRenderRevision) { writeOperationDraft(ownerId, episode.id, "review-decision", next); setDraft(next); } else { clearOperationDraft(ownerId, episode.id, "review-decision"); setDraft(null); } }
  function currentDraft(next: Partial<ReviewDecisionDraft> = {}): ReviewDecisionDraft { return { reason, ...next }; }
  function changeReason(nextReason: string) { setReason(nextReason); saveDraft(currentDraft({ reason: nextReason })); }
  function clearDraft() { clearOperationDraft(ownerId, episode.id, "review-decision"); setDraft(null); setReason(""); }

  async function transition(toStage: EpisodeStage) {
    const trimmedReason = reason.trim();
    if (!trimmedReason) {
      setError("请填写审批理由。");
      return;
    }
    if (isReviewRenderRevision && toStage === "render_ready") {
      if (!reviewPackageId) { setError("当前审核渲染包不存在，无法提交调整。"); return; }
      setError("");
      try { await onRequestRevision({ kind: "composition", reviewPackageId, reason: trimmedReason }); clearDraft(); } catch (cause) { setError(cause instanceof Error ? cause.message : "无法提交审核修订。"); }
      return;
    }
    setError("");
    if (await onTransition(episode.id, toStage, trimmedReason)) clearDraft();
  }

  if (isReviewRenderRevision && !isReviewRenderRecovery) return <section className="review-section review-decision"><h3>Owner 审批</h3><p className="muted-copy">合成调整请在上方 OpenChatCut 完成；这里仅确认 QC 审核结果。</p><label>审批理由<textarea aria-label="审批理由" onChange={(event) => changeReason(event.target.value)} placeholder="说明批准的原因" rows={3} value={reason} /></label>{hasOpenQcBlockers ? <p className="form-error">请先处理 QC 台中的阻塞问题，再批准 QC。</p> : null}{draft ? <OperationDraftNotice onClear={clearDraft} /> : null}{error ? <p className="form-error">{error}</p> : null}<div className="review-actions"><button className="button button-primary" disabled={isPending || hasOpenQcBlockers} onClick={() => void transition(reviewAction.approveStage)} type="button">批准</button></div></section>;

  return <section className="review-section review-decision"><h3>{isReviewRenderRecovery ? "审核渲染恢复" : "Owner 审批"}</h3>{isReviewRenderRecovery ? <p className="muted-copy">上一版审核渲染仍可追溯；合成修改请在 OpenChatCut 提交。</p> : null}<label>{isReviewRenderRevision ? "恢复说明" : "审批理由"}<textarea aria-label={isReviewRenderRevision ? "恢复说明" : "审批理由"} onChange={(event) => changeReason(event.target.value)} placeholder={isReviewRenderRevision ? "说明重新生成审核渲染的原因" : "说明批准或要求修改的原因"} rows={3} value={reason} /></label>{hasOpenQcBlockers ? <p className="form-error">请先处理 QC 台中的阻塞问题，再批准 QC。</p> : null}{draft ? <OperationDraftNotice onClear={clearDraft} /> : null}{error ? <p className="form-error">{error}</p> : null}<div className="review-actions">{isReviewRenderRecovery ? null : <button className="button button-primary" disabled={isPending || hasOpenQcBlockers} onClick={() => void transition(reviewAction.approveStage)} type="button">批准</button>}<button className="button button-secondary" disabled={isPending} onClick={() => void transition(reviewAction.requestChangesStage)} type="button">{isReviewRenderRecovery ? "重新生成审核渲染" : "要求修改"}</button></div></section>;
}

function OperationDraftNotice({ isRestored = false, onClear }: { isRestored?: boolean; onClear: () => void }) { return <div className="operation-draft-notice" role="status"><span>{isRestored ? "已恢复本地草稿" : "本地草稿已保存"}</span><button className="text-button" onClick={onClear} type="button">清除草稿</button></div>; }

export function EpisodeDetailDrawer({ children, compact = false, isOpen, onClose }: { children: ReactNode; compact?: boolean; isOpen: boolean; onClose: () => void }) {
  useEffect(() => { if (!isOpen) return; function closeOnEscape(event: KeyboardEvent) { if (event.key === "Escape" && !document.querySelector('[role="dialog"][aria-modal="true"]')) onClose(); } window.addEventListener("keydown", closeOnEscape); return () => window.removeEventListener("keydown", closeOnEscape); }, [isOpen, onClose]);
  if (!isOpen) return null;
  return <><div aria-hidden="true" className="episode-detail-scrim" data-testid="episode-detail-scrim" onClick={onClose} /><aside aria-label="当前生产单详情" className={`episode-detail-drawer${compact ? " is-input-stage" : ""}`} role="complementary"><button aria-label="关闭生产单详情" className="drawer-close icon-button" onClick={onClose} type="button"><Icon name="Close" /></button>{children}</aside></>;
}

function Artifact({ complete = false, label, name }: { complete?: boolean; label: string; name: string }) { return <div className="artifact-row"><i className={complete ? "artifact-complete" : "artifact-pending"}>{complete ? "✓" : ""}</i><span>{label}</span><small>{name}</small></div>; }

const episodeCreationSteps: Array<{ id: Exclude<EpisodeCreationStep, "idle">; label: string; note: string }> = [
  { id: "preflight", label: "检查生产条件", note: "验证当前蓝图、Worker、模型和已启用连接。" },
  { id: "create", label: "创建生产单", note: "冻结当前蓝图和系列版本。" },
  { id: "directory", label: "准备本地材料目录", note: "创建 input 与 materials 目录。" },
  { id: "refresh", label: "打开生产单", note: "同步最新状态和待导入材料。" },
];

function mediaCapabilityLabel(key: MediaAdapterKey) {
  return key === "static_visual" ? "图片生成" : mediaAdapterConfiguration(key).label;
}

export function EpisodeForm({ accounts, blueprints = [], connectionVersions = [], creationStartedAt = null, creationStep = "idle", isPending, onClose, onOpenBlueprint, onSubmit, preflight = null, series, seriesVersions }: { accounts: Account[]; blueprints?: Blueprint[]; connectionVersions?: ExternalConnectionVersion[]; creationStartedAt?: number | null; creationStep?: EpisodeCreationStep; isPending: boolean; onClose: () => void; onOpenBlueprint?: (accountId: string) => void; onSubmit: (input: { title: string; accountId: string; isTest: boolean; seriesVersionId: string | null }) => Promise<WorkerPreflightResult | null>; preflight?: WorkerPreflightResult | null; series: Series[]; seriesVersions: SeriesVersion[] }) {
  const [title, setTitle] = useState("");
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [seriesVersionId, setSeriesVersionId] = useState("");
  const [episodePreflight, setEpisodePreflight] = useState<WorkerPreflightResult | null>(preflight);
  const [now, setNow] = useState(Date.now());
  const seriesById = new Map(series.map((candidate) => [candidate.id, candidate]));
  const availableVersions = seriesVersions.filter((version) => version.account_id === accountId);
  const selectedAccount = accounts.find((account) => account.id === accountId);
  const selectedBlueprint = blueprints.find((blueprint) => blueprint.id === selectedAccount?.current_blueprint_version_id);
  const availableExternalConnectionVersionIds = connectionVersions.filter((version) => version.is_current && version.status === "verified" && !version.revoked_at).map((version) => version.id);
  const frozenMediaCapabilities = selectedBlueprint ? (() => {
    const form = blueprintPolicyToForm(selectedBlueprint.policy);
    return (form.enabledMediaAdapters ?? []).filter((key) => mediaAdapterStatus(key, form.mediaAdapters[key], { availableExternalConnectionVersionIds }) === "已配置").map((key) => ({ key, path: form.mediaAdapters[key].executionPath }));
  })() : [];
  const visibleFrozenMediaCapabilities = frozenMediaCapabilities.slice(0, 3);
  const hiddenFrozenMediaCapabilities = frozenMediaCapabilities.slice(3);
  const canCreateEpisode = Boolean(selectedAccount?.current_blueprint_version_id);
  const blockers = workerBlockersFromPreflight(episodePreflight);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canCreateEpisode) return;
    setEpisodePreflight(null);
    const result = await onSubmit({ accountId, isTest: false, seriesVersionId: seriesVersionId || null, title });
    if (result) setEpisodePreflight(result);
  }
  const activeStepIndex = episodeCreationSteps.findIndex((step) => step.id === creationStep);
  const activeStep = episodeCreationSteps[activeStepIndex] ?? episodeCreationSteps[0];
  useEffect(() => {
    if (!isPending || creationStartedAt === null) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [creationStartedAt, isPending]);
  const elapsedSeconds = creationStartedAt === null ? 0 : Math.max(0, Math.floor((now - creationStartedAt) / 1000));
  return <div className="modal-backdrop" role="presentation"><form aria-label="新建生产单" className="modal-card episode-form-modal" onSubmit={(event) => void submit(event)}><header><div><h2>新建生产单</h2><p>会固定所选账号当前激活蓝图和可选系列版本。</p></div><button aria-label="关闭新建生产单" className="icon-button" onClick={onClose} type="button"><Icon name="Close" /></button></header><label>账号<select onChange={(event) => { setAccountId(event.target.value); setSeriesVersionId(""); setEpisodePreflight(null); }} value={accountId}>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label><label>系列版本（可选）<select aria-label="系列版本" onChange={(event) => { setSeriesVersionId(event.target.value); setEpisodePreflight(null); }} value={seriesVersionId}><option value="">不关联系列</option>{availableVersions.map((version) => <option key={version.id} value={version.id}>{seriesById.get(version.series_id)?.name ?? "未知系列"} · v{version.version}</option>)}</select></label><label>工作标题（可留空）<input autoFocus onChange={(event) => setTitle(event.target.value)} placeholder="可在首次适用审核前补充" value={title} /></label>{canCreateEpisode ? <><section className="technical-policy-preview"><header><strong>本单将冻结的生产能力</strong><span>{frozenMediaCapabilities.length} 项</span></header>{frozenMediaCapabilities.length ? <div className="summary-chip-list">{visibleFrozenMediaCapabilities.map(({ key, path }) => <span className="summary-chip" key={key}>{mediaCapabilityLabel(key)} · {path === "local" ? "本地" : path === "manual" ? "人工素材" : "外部"}</span>)}{hiddenFrozenMediaCapabilities.length ? <span className="summary-chip summary-chip-overflow" title={hiddenFrozenMediaCapabilities.map(({ key, path }) => `${mediaCapabilityLabel(key)} · ${path === "local" ? "本地" : path === "manual" ? "人工素材" : "外部"}`).join("\n")}>+{hiddenFrozenMediaCapabilities.length} 项</span> : null}</div> : <span className="summary-empty">当前蓝图没有已完整配置的可选媒体能力。</span>}<p className="field-hint">只会冻结以下已启用且完整配置的能力；分镜没有声明需求时不会创建对应任务。</p></section><p className="form-hint">标题只是管理元数据，后续修改不会使已导入内容失效。</p></> : <p className="form-error">当前账号没有启用蓝图，请先激活一个蓝图版本。</p>}{isPending ? <section aria-live="polite" className="episode-creation-progress" role="status"><strong>正在创建生产单</strong><ol>{episodeCreationSteps.map((step, index) => <li className={index < activeStepIndex ? "is-complete" : index === activeStepIndex ? "is-active" : ""} key={step.id}><i aria-hidden="true">{index < activeStepIndex ? "✓" : index + 1}</i><span><b>{step.label}</b></span></li>)}</ol><p className="episode-creation-current">{activeStep.note} 本阶段已等待 {elapsedSeconds} 秒。</p></section> : null}{episodePreflight ? <details aria-live="polite" className={`production-preflight ${blockers.length ? "is-blocked" : "is-passed"}`} role="alert"><summary><strong>创建前可生产性检查：未通过（{blockers.length}）</strong><span>展开阻塞详情</span></summary><div className="production-preflight-body"><p>本次检查未通过，因此尚未创建生产单。处理下面的原因后，点击“创建生产单”重新检查。</p>{blockers.map((blocker) => <WorkerBlockerCard blocker={blocker} key={`${blocker.code}-${blocker.capability}`} onOpenBlueprint={onOpenBlueprint ? () => onOpenBlueprint(accountId) : undefined} />)}</div></details> : null}<div className="modal-actions"><button className="button button-secondary" disabled={isPending} onClick={onClose} type="button">取消</button><button className="button button-primary" disabled={isPending || !accountId || !canCreateEpisode} type="submit">{isPending ? "正在处理…" : "创建生产单"}</button></div></form></div>;
}

function AccountForm({ isPending, onClose, onSubmit }: { isPending: boolean; onClose: () => void; onSubmit: (input: { name: string; slug: string; timezone: string; policy: Json }) => Promise<void> }) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [timezone, setTimezone] = useState("Asia/Shanghai");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await onSubmit({ name, slug, timezone, policy: defaultBlueprintPolicy });
  }

  return <div className="modal-backdrop" role="presentation"><form aria-label="新建账号" className="modal-card" onSubmit={submit}><header><div><h2>新建账号</h2></div><button aria-label="关闭新建账号" className="icon-button" onClick={onClose} type="button"><Icon name="Close" /></button></header><label>账号名称<input autoFocus onChange={(event) => setName(event.target.value)} placeholder="例如：内容工作室" required value={name} /></label><label>账号标识<input onChange={(event) => setSlug(event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))} pattern="[a-z0-9]+(?:-[a-z0-9]+)*" placeholder="content-studio" required value={slug} /></label><TimezoneSelect onChange={setTimezone} value={timezone} /><p className="form-hint">选择账号日常运营和任务时间所使用的时区。</p><div className="modal-actions"><button className="button button-secondary" onClick={onClose} type="button">取消</button><button className="button button-primary" disabled={isPending} type="submit">{isPending ? "创建中…" : "创建账号"}</button></div></form></div>;
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

type IconName = NavigationItem | "Moon" | "Sun" | "Exit" | "Close" | "Play" | "PanelLeft" | "User" | "Edit" | "Delete" | "Video";

const iconComponents: Record<IconName, LucideIcon> = { accounts: Users, episodes: Table2, operations: BarChart3, reviews: MessageSquare, publish: Upload, learning: BookOpen, Moon, Sun, Exit: LogOut, Close: X, Play, PanelLeft, User, Edit: Pencil, Delete: Trash2, Video };

function Icon({ name }: { name: IconName }) {
  const IconComponent = iconComponents[name];
  return <IconComponent aria-hidden="true" className="icon" strokeWidth={1.8} />;
}
