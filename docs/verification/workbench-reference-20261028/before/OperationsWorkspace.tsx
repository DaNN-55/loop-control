import {Layers,ArrowUpRight,Check} from 'lucide-react';
import {EpisodeStatus,episodeActionState,episodeNextAction,episodePhaseGroups} from '../workspace/episodePresentation';
import '../workspace/episode-list.css';
import './workbench.css';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import {NativeSelect} from '../ui/dan-ui/components/base/select/select-native';
import type { EpisodeCatalog } from "../episodes/episodeCatalog";
import { useEffect, useMemo, useState, type ReactNode } from "react";
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

export function OperationsWorkspace({ isLoading=false,accounts=[],blueprints=[],onOpenReviewQueue,actions, remote, episodes, onOpenBlueprint, onSelectEpisode, preRenderReviewMemberDecisions, preRenderReviewMembers, reviewPackages, selectedEpisode, series, seriesVersions, tasks }: {isLoading?:boolean;accounts?:Database["public"]["Tables"]["accounts"]["Row"][];blueprints?:Database["public"]["Tables"]["account_blueprint_versions"]["Row"][];onOpenReviewQueue?:()=>void; actions?: ReactNode; remote?: RemoteOperations; episodes: Episode[]; onOpenBlueprint?: (accountId: string, repairContext?: { blocker: WorkerBlocker; blueprintVersionId: string; episodeId: string }) => void; onSelectEpisode: (episodeId: string) => void; preRenderReviewMemberDecisions: PreRenderReviewMemberDecision[]; preRenderReviewMembers: PreRenderReviewMember[]; reviewPackages: ReviewPackage[]; selectedEpisode: Episode | null; series: Series[]; seriesVersions: SeriesVersion[]; tasks: Task[] }) {
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

  const [focusedId,setFocusedId]=useState('');
  const currentPageEpisodes=visibleEpisodePage.map(item=>item.episode);
  const focusedEpisode=currentPageEpisodes.find(e=>e.id===(selectedEpisode?.id??focusedId))??currentPageEpisodes.find(e=>remote?.catalog.pending.items.some(item=>item.id===e.id))??currentPageEpisodes[0];
  const focusSummary=focusedEpisode?remote?.catalog.operationRows.find(row=>row.episodeId===focusedEpisode.id):undefined;
  const focusLocal=visibleEpisodePage.find(item=>item.episode.id===focusedEpisode?.id);
  const focusState=focusedEpisode?episodeActionState(focusedEpisode,focusSummary??(focusLocal?{episodeId:focusedEpisode.id,reviewRevision:focusLocal.reviewPackage?.revision_number??null,reviewPending:focusLocal.reviewPending,blockerCount:focusLocal.blockers.length}:undefined)):'draft';
  const next=focusedEpisode?episodeNextAction(focusedEpisode,focusState):null;
  const phaseIndex=focusedEpisode?episodePhaseGroups.findIndex(group=>group.stages.includes(focusedEpisode.stage)):-1;
  const focusedSeriesVersion=seriesVersions.find(v=>v.id===focusedEpisode?.series_version_id);
  const focusedSeries=series.find(item=>item.id===focusedSeriesVersion?.series_id);
  const focusedAccount=accounts.find(item=>item.id===focusedEpisode?.account_id);

  if(isLoading)return <p role="status" className="workspace-loading">正在读取工作台…</p>;
  return <section className="operations-workspace" aria-label="系列运营概览">
    <header className="operations-intro"><div className="operations-toolbar"><label className="operations-series-filter"><span>系列</span><NativeSelect icon={Layers} size="sm" aria-label="运营系列筛选" selectClassName="operations-series-select" onChange={event=>(remote?.onSeriesChange??setSelectedSeriesId)(event.target.value)} value={effectiveSeriesId}><option value="all">全部系列</option>{(remote?[...series.map(item=>({id:item.id,name:item.name})),{id:'unassigned',name:'未归属系列'},{id:'unavailable',name:'关联系列不可用'}]:operations).map(operation=><option key={operation.id} value={operation.id}>{operation.name}</option>)}</NativeSelect></label>{actions}</div></header>
    {remote&&<div className="lc-work-notice"><div><strong>{remote.catalog.pending.total?`${remote.catalog.pending.total} 个审核包等待决定`:'当前审核已处理完毕'}</strong><span>{remote.catalog.worker.running} 项执行中 · {remote.catalog.worker.blocked} 项任务阻塞 · {remote.catalog.worker.failed} 项失败</span></div>{remote.catalog.pending.total>0&&onOpenReviewQueue&&<Button size="sm" color="tertiary" iconTrailing={ArrowUpRight} onPress={onOpenReviewQueue}>查看待审核</Button>}</div>}
    <div className="operations-stage-grid" aria-label="阶段分布">{stageGroups.map(group=>{const count=remote?group.stages.reduce((total,stage)=>total+(remote.catalog.stages[stage]??0),0):visibleEpisodes.filter(item=>group.stages.includes(item.episode.stage)).length;const total=remote?Object.values(remote.catalog.stages).reduce((sum,value)=>sum+value,0):visibleEpisodes.length;return <article key={group.id} className={count?'has-episodes':undefined}><span>{group.label}</span><strong>{count}</strong><small>个生产单</small><div className="operations-stage-track" aria-hidden="true"><i style={{width:`${total?Math.min(100,count/total*100):0}%`}}/></div></article>;})}</div>
    <section className="operations-episode-list lc-work-table" aria-label="系列生产单"><header><h3>制作中的内容</h3><span>{remote?.catalog.total??visibleEpisodes.length} 个生产单</span></header>{visibleEpisodes.length?<><div>{visibleEpisodePage.map(({episode,blockers:episodeBlockers,reviewPackage,reviewPending})=>{const summary=remote?.catalog.operationRows.find(row=>row.episodeId===episode.id);const revision=summary?.reviewRevision??reviewPackage?.revision_number;const pending=summary?.reviewPending??reviewPending;const blockerCount=summary?.blockerCount??episodeBlockers.length;const itemSeries=series.find(s=>s.id===seriesVersions.find(v=>v.id===episode.series_version_id)?.series_id);return <Button size="sm" color="tertiary" aria-pressed={focusedEpisode?.id===episode.id} className={`operations-episode-row ${focusedEpisode?.id===episode.id?'is-selected':''}`} key={episode.id} onClick={()=>setFocusedId(episode.id)} type="button"><span><strong>{episode.title||'未命名生产单'}</strong><small>{[accounts.find(a=>a.id===episode.account_id)?.name,itemSeries?.name??'未关联系列'].filter(Boolean).join(' · ')}</small></span><span>{operationalStageLabel(episode.stage)}</span><span><EpisodeStatus state={episodeActionState(episode,summary??{episodeId:episode.id,reviewRevision:revision??null,reviewPending:pending,blockerCount})}/><small>{revision?`审核包 v${revision}${pending?'':' 已审完'}`:''}</small></span></Button>;})}</div><PaginationControls page={safeEpisodePage} pageSize={episodePageSize} total={remote?.catalog.total??visibleEpisodes.length} onPageChange={remote?.onPageChange??setEpisodePage}/></>:<p>还没有生产单，可以先新建一单。</p>}</section>
    {focusedEpisode&&next&&<aside className="work-continuation" aria-label="当前作品"><header><h2>继续处理</h2><EpisodeStatus state={focusState}/></header><div className="work-continuation-body"><h3>{focusedEpisode.title||'未命名生产单'}</h3><p className="work-context">{[focusedAccount?.name,focusedSeries?.name].filter(Boolean).join(' · ')||'未关联系列'}</p><ol className="work-phase-track" aria-label="当前生产阶段">{episodePhaseGroups.map((group,index)=><li key={group.label} className={index<phaseIndex?'is-complete':index===phaseIndex?'is-current':''} aria-current={index===phaseIndex?'step':undefined}><span aria-hidden="true">{index<phaseIndex?<Check size={10}/>:null}</span>{group.label}</li>)}</ol><section className="work-next-step" aria-label="下一步"><p>{next.detail}</p><Button size="sm" color="primary" iconTrailing={ArrowUpRight} onPress={()=>onSelectEpisode(focusedEpisode.id)}>{next.label}</Button></section><dl className="work-context-details"><div><dt>当前阶段</dt><dd>{operationalStageLabel(focusedEpisode.stage)}</dd></div>{focusedAccount&&<div><dt>蓝图快照</dt><dd>v{blueprints.find(b=>b.id===focusedEpisode.blueprint_version_id)?.version??'—'}</dd></div>}<div><dt>系列版本</dt><dd>{focusedSeriesVersion?`v${focusedSeriesVersion.version}`:'未关联'}</dd></div><div><dt>最近更新</dt><dd>{new Intl.DateTimeFormat('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(focusedEpisode.updated_at))}</dd></div></dl></div></aside>}
    {(!remote||blockers.length>0)&&<div className="operations-detail-grid lc-work-queue">{!remote&&<section className="operations-list"><header><h3>待审核</h3><span>{pendingReviews.length} 个待审核包</span></header>{pendingReviews.length?<ul>{pendingReviews.map(({episode,revision})=><li key={episode.id}><Button size="sm" color="tertiary" className="justify-stretch text-left" onClick={()=>onSelectEpisode(episode.id)} type="button"><strong>{episode.title||'未命名生产单'}</strong><span>{operationalStageLabel(episode.stage)} · 审核包 v{revision}</span></Button></li>)}</ul>:<p>当前筛选范围没有待审核包。</p>}</section>}<section className="operations-list operations-blocker-list"><header><h3>阻塞项</h3><span>{remote?.catalog.blocked.total??blockers.length} 个阻塞项</span></header>{blockers.length?<ul>{blockers.map((blocker,index)=><li key={`${blocker.taskId}-${blocker.code}-${index}`}><Button size="sm" color="tertiary" className="operations-blocker-trigger justify-stretch text-left" onClick={()=>onSelectEpisode(blocker.episode.id)} type="button"><strong>{blocker.episode.title||'未命名生产单'}</strong><span>{blocker.code}</span></Button><WorkerBlockerCard blocker={blocker} compact onOpenBlueprint={onOpenBlueprint?()=>onOpenBlueprint(blocker.episode.account_id,{blocker,blueprintVersionId:blocker.episode.blueprint_version_id,episodeId:blocker.episode.id}):undefined}/></li>)}</ul>:<p>当前筛选范围没有阻塞项。</p>}{remote?<PaginationControls page={remote.catalog.blocked.page} pageSize={20} total={remote.catalog.blocked.total} onPageChange={remote.onBlockedPageChange}/>:null}</section></div>}
  </section>;
}
