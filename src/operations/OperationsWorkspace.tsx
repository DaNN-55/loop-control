import type { EpisodeCatalog } from "../episodes/episodeCatalog";
import { useEffect, useMemo, useState } from "react";
import type { Database } from "../lib/database.types";
import type { EpisodeStage } from "../platform/types";
import { currentReviewPackage, isReviewPackagePending, type WorkerBlocker, workerBlockers } from "../reviews/reviewSelectors";
import { WorkerBlockerCard } from "../reviews/WorkerBlockerCard";
import { PaginationControls } from "../ui/PaginationControls";

type Episode = Database["public"]["Tables"]["episodes"]["Row"];
type PreRenderReviewMember = Database["public"]["Tables"]["pre_render_review_members"]["Row"];
type PreRenderReviewMemberDecision = Database["public"]["Tables"]["pre_render_review_member_decisions"]["Row"];
type ReviewPackage = Database["public"]["Tables"]["review_packages"]["Row"];
type Series = Database["public"]["Tables"]["series"]["Row"];
type SeriesVersion = Database["public"]["Tables"]["series_versions"]["Row"];
type Task = Database["public"]["Tables"]["tasks"]["Row"];

const stageGroups: Array<{ id: string; label: string; stages: EpisodeStage[] }> = [
  { id: "input", label: "输入与脚本", stages: ["waiting_input", "brief_draft", "script_draft", "script_review", "script_approved"] },
  { id: "visual", label: "视觉准备", stages: ["visual_draft", "visual_review", "visual_approved"] },
  { id: "storyboard", label: "分镜与媒体", stages: ["storyboard_draft", "storyboard_review", "storyboard_approved", "production_ready"] },
  { id: "render", label: "合成与 QC", stages: ["render_ready", "qc_review", "qc_passed"] },
  { id: "completed", label: "生产完成", stages: ["production_completed"] },
];

function operationalStageLabel(stage: EpisodeStage): string {
  return stageGroups.find((group) => group.stages.includes(stage))?.label ?? "未知阶段";
}

interface OperationalEpisode {
  episode: Episode;
  blockers: Array<{ code: string; detail: string; taskId: string }>;
  reviewPackage: ReviewPackage | null;
  reviewPending: boolean;
}

interface SeriesOperation {
  id: string;
  name: string;
  episodes: OperationalEpisode[];
}

interface RemoteOperations {
  catalog: EpisodeCatalog; seriesId: string; onSeriesChange: (id: string) => void;
  onPageChange: (page: number) => void; onPendingPageChange: (page: number) => void; onBlockedPageChange: (page: number) => void;
}

export function OperationsWorkspace({ remote, episodes, onOpenBlueprint, onSelectEpisode, preRenderReviewMemberDecisions, preRenderReviewMembers, reviewPackages, selectedEpisode, series, seriesVersions, tasks }: { remote?: RemoteOperations; episodes: Episode[]; onOpenBlueprint?: (accountId: string, repairContext?: { blocker: WorkerBlocker; blueprintVersionId: string; episodeId: string }) => void; onSelectEpisode: (episodeId: string) => void; preRenderReviewMemberDecisions: PreRenderReviewMemberDecision[]; preRenderReviewMembers: PreRenderReviewMember[]; reviewPackages: ReviewPackage[]; selectedEpisode: Episode | null; series: Series[]; seriesVersions: SeriesVersion[]; tasks: Task[] }) {
  const [selectedSeriesId, setSelectedSeriesId] = useState("all");
  const operations = useMemo<SeriesOperation[]>(() => {
    const seriesById = new Map(series.map((item) => [item.id, item]));
    const seriesVersionsById = new Map(seriesVersions.map((item) => [item.id, item]));
    const items = new Map<string, SeriesOperation>(series.map((item) => [item.id, { id: item.id, name: item.name, episodes: [] }]));
    const unassigned: SeriesOperation = { id: "unassigned", name: "未归属系列", episodes: [] };
    const unavailable: SeriesOperation = { id: "unavailable", name: "关联系列不可用", episodes: [] };

    for (const episode of episodes.filter((item) => !item.archived_at)) {
      const version = episode.series_version_id ? seriesVersionsById.get(episode.series_version_id) : null;
      const operation = version && seriesById.has(version.series_id) ? items.get(version.series_id) : episode.series_version_id ? unavailable : unassigned;
      if (!operation) continue;
      const reviewPackage = currentReviewPackage(reviewPackages, episode);
      operation.episodes.push({
        episode,
        blockers: workerBlockers(tasks, episode.id).map((blocker) => ({ ...blocker, taskId: blocker.taskId ?? "unknown-task" })),
        reviewPackage,
        reviewPending: reviewPackage ? isReviewPackagePending(reviewPackage, preRenderReviewMembers, preRenderReviewMemberDecisions) : false,
      });
    }
    return [...items.values(), ...(unassigned.episodes.length ? [unassigned] : []), ...(unavailable.episodes.length ? [unavailable] : [])];
  }, [episodes, preRenderReviewMemberDecisions, preRenderReviewMembers, reviewPackages, series, seriesVersions, tasks]);
  const effectiveSeriesId = remote?.seriesId ?? selectedSeriesId;
  const selectedOperation = effectiveSeriesId === "all" ? null : operations.find((operation) => operation.id === effectiveSeriesId) ?? null;
  const visibleOperations = selectedOperation ? [selectedOperation] : operations;
  const visibleEpisodes = visibleOperations.flatMap((operation) => operation.episodes);
  const pendingReviews = remote ? remote.catalog.pending.items.map((episode) => ({ episode, revision: episode.revision_number })) : visibleEpisodes.filter((item) => item.reviewPending).map(({ episode, reviewPackage }) => ({ episode, revision: reviewPackage?.revision_number }));
  const blockers = remote ? remote.catalog.blocked.items.map(({ episode, blocker }) => ({ ...blocker, taskId: blocker.taskId ?? "unknown-task", episode })) : visibleEpisodes.flatMap((item) => item.blockers.map((blocker) => ({ ...blocker, episode: item.episode })));
  const [episodePage, setEpisodePage] = useState(1);
  const episodePageSize = 20;
  const episodePageCount = Math.max(1, Math.ceil(visibleEpisodes.length / episodePageSize));
  const safeEpisodePage = remote?.catalog.page ?? Math.min(episodePage, episodePageCount);
  const visibleEpisodePage = remote ? visibleEpisodes : visibleEpisodes.slice((safeEpisodePage - 1) * episodePageSize, safeEpisodePage * episodePageSize);
  useEffect(() => setEpisodePage(1), [selectedSeriesId]);
  useEffect(() => setEpisodePage((current) => Math.min(current, episodePageCount)), [episodePageCount]);

  return <section className="operations-workspace" aria-label="系列运营概览">
    <header className="operations-intro"><div><h2>系列运营概览</h2><p>按生产单的当前阶段、待审包和 Worker 阻塞项汇总。这里不折算统一完成百分比。</p></div><label className="operations-series-filter"><span>系列</span><select aria-label="运营系列筛选" className="operations-series-select" onChange={(event) => (remote?.onSeriesChange ?? setSelectedSeriesId)(event.target.value)} value={effectiveSeriesId}><option value="all">全部系列</option>{(remote ? [...series.map((item) => ({ id: item.id, name: item.name })), { id: "unassigned", name: "未归属系列" }, { id: "unavailable", name: "关联系列不可用" }] : operations).map((operation) => <option key={operation.id} value={operation.id}>{operation.name}</option>)}</select></label></header>

    <div className="operations-stage-grid" aria-label="阶段分布">{stageGroups.map((group) => <article key={group.id}><span>{group.label}</span><strong>{remote ? group.stages.reduce((total, stage) => total + (remote.catalog.stages[stage] ?? 0), 0) : visibleEpisodes.filter((item) => group.stages.includes(item.episode.stage)).length}</strong><small>个生产单</small></article>)}</div>

    <div className="operations-detail-grid">
      <section className="operations-list"><header><h3>待审核</h3><span>{remote?.catalog.pending.total ?? pendingReviews.length} 个待审核包</span></header>{pendingReviews.length ? <ul>{pendingReviews.map(({ episode, revision }) => <li key={episode.id}><button onClick={() => onSelectEpisode(episode.id)} type="button"><strong>{episode.title || "未命名生产单"}</strong><span>{operationalStageLabel(episode.stage)} · 审核包 v{revision}</span></button></li>)}</ul> : <p>当前筛选范围没有待审核包。</p>}{remote ? <PaginationControls page={remote.catalog.pending.page} pageSize={20} total={remote.catalog.pending.total} onPageChange={remote.onPendingPageChange} /> : null}</section>
      <section className="operations-list operations-blocker-list"><header><h3>阻塞项</h3><span>{remote?.catalog.blocked.total ?? blockers.length} 个阻塞项</span></header>{blockers.length ? <ul>{blockers.map((blocker, index) => <li key={`${blocker.taskId}-${blocker.code}-${index}`}><button className="operations-blocker-trigger" onClick={() => onSelectEpisode(blocker.episode.id)} type="button"><strong>{blocker.episode.title || "未命名生产单"}</strong><span>{blocker.code}</span></button><WorkerBlockerCard blocker={blocker} compact onOpenBlueprint={onOpenBlueprint ? () => onOpenBlueprint(blocker.episode.account_id, { blocker, blueprintVersionId: blocker.episode.blueprint_version_id, episodeId: blocker.episode.id }) : undefined} /></li>)}</ul> : <p>当前筛选范围没有 Worker 阻塞项。</p>}{remote ? <PaginationControls page={remote.catalog.blocked.page} pageSize={20} total={remote.catalog.blocked.total} onPageChange={remote.onBlockedPageChange} /> : null}</section>
    </div>

    <section className="operations-episode-list" aria-label="系列生产单"><header><h3>生产单明细</h3><span>{remote?.catalog.total ?? visibleEpisodes.length} 个生产单</span></header>{visibleEpisodes.length ? <><div>{visibleEpisodePage.map(({ episode, blockers: episodeBlockers, reviewPackage, reviewPending }) => { const summary = remote?.catalog.operationRows.find((row) => row.episodeId === episode.id); const revision = summary?.reviewRevision ?? reviewPackage?.revision_number; const pending = summary?.reviewPending ?? reviewPending; const blockerCount = summary?.blockerCount ?? episodeBlockers.length; return <button className={`operations-episode-row ${selectedEpisode?.id === episode.id ? "is-selected" : ""}`} key={episode.id} onClick={() => onSelectEpisode(episode.id)} type="button"><span><strong>{episode.title || "未命名生产单"}</strong><small>{episode.id.slice(0, 8)}</small></span><span>{operationalStageLabel(episode.stage)}</span><span>{pending ? `待审 v${revision}` : revision ? `审核包 v${revision} 已审完` : "无待审包"}</span><span>{blockerCount ? `${blockerCount} 个阻塞项` : "无阻塞"}</span></button>; })}</div><PaginationControls page={safeEpisodePage} pageSize={episodePageSize} total={remote?.catalog.total ?? visibleEpisodes.length} onPageChange={remote?.onPageChange ?? setEpisodePage} /></> : <p>当前没有可汇总的生产单。</p>}</section>
  </section>;
}
