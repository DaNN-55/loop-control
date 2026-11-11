import {PopulatedFilterSelect} from '../ui/PopulatedFilterSelect';
import {Layers,Milestone,ArrowUpRight,ArrowDownWideNarrow,Users,Search,X,Check,TriangleAlert,CircleAlert,Clock3} from 'lucide-react';
import {useId, useRef} from 'react';
import {AppliedFilters} from '../workspace/AppliedFilters';
import {useWorkbenchPreview,WorkbenchArtwork} from './workbenchPreview';
import {operationsEpisodePageSize,type CatalogSort,type CatalogStatus,type ProductionStep} from '../episodes/episodeCatalogTypes';
import {EpisodeStatus,episodeActionState,episodeBlockerLabel,episodeNextAction,episodePhaseGroups,workspacePhaseGroups,episodeWorkflowLabel} from '../workspace/episodePresentation';
import '../workspace/episode-list.css';
import './workbench.css';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import {NativeSelect} from '../ui/dan-ui/components/base/select/select-native';
import type { EpisodeCatalog } from "../episodes/episodeCatalog";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { Database } from "../lib/database.types";
import type { EpisodeStage } from "../platform/types";
import { currentReviewPackage, isReviewPackagePending, type WorkerBlocker, workerBlockers } from "../reviews/reviewSelectors";
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
  blockers: Array<WorkerBlocker & {taskId:string}>;
  reviewPackage: ReviewPackage | null;
  reviewPending: boolean;
}

interface SeriesOperation {
  id: string;
  name: string;
  episodes: OperationalEpisode[];
}

const statusFilters = [['all','全部制作'],['review','待审核'],['running','制作中'],['blocked','需处理'],['done','已完成']] as const;

interface WorkbenchControls {
 stage?:ProductionStep|'all';onStage?:(stage:ProductionStep|'all')=>void;
 query:string;status:CatalogStatus;sort:CatalogSort;accountId:string;
 onSearch:(query:string)=>void;onReset?:()=>void;onStatus:(status:CatalogStatus)=>void;onSort:(sort:CatalogSort)=>void;onAccount:(id:string)=>void;
}
interface RemoteOperations {
  catalog: EpisodeCatalog; seriesId: string; onSeriesChange: (id: string) => void;
  onPageChange: (page: number) => void; onPendingPageChange: (page: number) => void; onBlockedPageChange: (page: number) => void;
}

export function OperationsWorkspace({ catalogControls,isLoading=false,accounts=[],blueprints=[],onOpenReviewQueue,onOpenTaskQueue,taskQueue,onOpenAllEpisodes,actions, remote, episodes, onSelectEpisode, preRenderReviewMemberDecisions, preRenderReviewMembers, reviewPackages, selectedEpisode, series, seriesVersions, tasks }: {catalogControls?:WorkbenchControls;isLoading?:boolean;accounts?:Database["public"]["Tables"]["accounts"]["Row"][];blueprints?:Database["public"]["Tables"]["account_blueprint_versions"]["Row"][];taskQueue?:{blocked:number;failed:number;running:number}|null;onOpenTaskQueue?:()=>void;onOpenReviewQueue?:()=>void;onOpenAllEpisodes?:()=>void; actions?: ReactNode; remote?: RemoteOperations; episodes: Episode[]; onOpenBlueprint?: (accountId: string, repairContext?: { blocker: WorkerBlocker; blueprintVersionId: string; episodeId: string }) => void; onSelectEpisode: (episodeId: string) => void; preRenderReviewMemberDecisions: PreRenderReviewMemberDecision[]; preRenderReviewMembers: PreRenderReviewMember[]; reviewPackages: ReviewPackage[]; selectedEpisode: Episode | null; series: Series[]; seriesVersions: SeriesVersion[]; tasks: Task[] }) {
  const [selectedSeriesId, setSelectedSeriesId] = useState("all");
  const [search,setSearch]=useState(catalogControls?.query??'');
  const tabId=useId();
  const searchInput=useRef<HTMLInputElement>(null);
  useEffect(()=>setSearch(catalogControls?.query??''),[catalogControls?.query]);
  const operations = useMemo<SeriesOperation[]>(() => {
    const seriesById = new Map(series.map((item) => [item.id, item]));
    const seriesVersionsById = new Map(seriesVersions.map((item) => [item.id, item]));
    const items = new Map<string, SeriesOperation>(series.map((item) => [item.id, { id: item.id, name: item.name, episodes: [] }]));
    const unassigned: SeriesOperation = { id: "unassigned", name: "未分系列", episodes: [] };
    const unavailable: SeriesOperation = { id: "unavailable", name: "关联系列不可用", episodes: [] };

    for (const episode of episodes.filter((item) => !item.archived_at)) {
      const version = episode.series_version_id ? seriesVersionsById.get(episode.series_version_id) : null;
      const collection=remote?.catalog.collections?.[episode.id];
      const operation = collection?(collection.seriesId?items.get(collection.seriesId)??unavailable:unassigned):version && seriesById.has(version.series_id) ? items.get(version.series_id) : episode.series_version_id ? unavailable : unassigned;
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
  }, [episodes, remote?.catalog.collections, preRenderReviewMemberDecisions, preRenderReviewMembers, reviewPackages, series, seriesVersions, tasks]);
  const effectiveSeriesId = remote?.seriesId ?? selectedSeriesId;
  const seriesOptions = [...series,{id:'unassigned',name:'未归属系列'},{id:'unavailable',name:'关联系列不可用'}];
  const seriesCounts=remote?.catalog.seriesEpisodeCounts??Object.fromEntries(operations.map(operation=>[operation.id,operation.episodes.length]));
  const accountCounts=remote?.catalog.filterAccountCounts??(remote?undefined:Object.fromEntries(accounts.map(account=>[account.id,episodes.filter(e=>!e.archived_at&&e.account_id===account.id).length])));
  const selectedOperation = effectiveSeriesId === "all" ? null : operations.find((operation) => operation.id === effectiveSeriesId) ?? null;
  const visibleOperations = selectedOperation ? [selectedOperation] : operations;
  const groupedEpisodes = visibleOperations.flatMap((operation) => operation.episodes);
  const byEpisodeId = new Map(groupedEpisodes.map(item => [item.episode.id,item]));
  const visibleEpisodes = remote ? episodes.flatMap(episode => {const item=byEpisodeId.get(episode.id);return item?[item]:[];}) : groupedEpisodes;
  const pendingReviews = remote ? remote.catalog.pending.items.map((episode) => ({ episode, revision: episode.revision_number })) : visibleEpisodes.filter((item) => item.reviewPending).map(({ episode, reviewPackage }) => ({ episode, revision: reviewPackage?.revision_number }));
  const [episodePage, setEpisodePage] = useState(1);
  const episodePageSize = remote?.catalog.pageSize ?? operationsEpisodePageSize;
  const episodePageCount = Math.max(1, Math.ceil(visibleEpisodes.length / episodePageSize));
  const safeEpisodePage = remote?.catalog.page ?? Math.min(episodePage, episodePageCount);
  const visibleEpisodePage = remote ? visibleEpisodes : visibleEpisodes.slice((safeEpisodePage - 1) * episodePageSize, safeEpisodePage * episodePageSize);
  useEffect(() => setEpisodePage(1), [selectedSeriesId]);
  useEffect(() => setEpisodePage((current) => Math.min(current, episodePageCount)), [episodePageCount]);

  const [focusedId,setFocusedId]=useState('');
  const currentPageEpisodes=visibleEpisodePage.map(item=>item.episode);
  const focusedEpisode=currentPageEpisodes.find(e=>e.id===(focusedId||selectedEpisode?.id))??currentPageEpisodes.find(e=>remote?.catalog.pending.items.some(item=>item.id===e.id))??currentPageEpisodes[0];
  const focusSummary=focusedEpisode?remote?.catalog.operationRows.find(row=>row.episodeId===focusedEpisode.id):undefined;
  const focusLocal=visibleEpisodePage.find(item=>item.episode.id===focusedEpisode?.id);
  const focusState=focusedEpisode?episodeActionState(focusedEpisode,focusSummary??(focusLocal?{episodeId:focusedEpisode.id,reviewRevision:focusLocal.reviewPackage?.revision_number??null,reviewPending:focusLocal.reviewPending,blockerCount:focusLocal.blockers.length}:undefined)):'draft';
  const focusBlocker=focusSummary?.blocker??(remote?remote.catalog.blocked.items.find(item=>item.episode.id===focusedEpisode?.id)?.blocker:focusLocal?.blockers[0]);
  const next=focusedEpisode?episodeNextAction(focusedEpisode,focusState,focusBlocker?{episodeId:focusedEpisode.id,reviewRevision:null,reviewPending:false,blockerCount:1,...focusSummary,blocker:focusBlocker}:focusSummary):null;
  const phaseGroups=focusSummary?.workflowStep?workspacePhaseGroups:episodePhaseGroups;
  const phaseIndex=focusedEpisode?focusSummary?.workflowStep?workspacePhaseGroups.findIndex(group=>group.id===focusSummary.workflowStep):episodePhaseGroups.findIndex(group=>group.stages.includes(focusedEpisode.stage)):-1;
  const focusedSeriesVersion=seriesVersions.find(v=>v.id===focusedEpisode?.series_version_id);
  const focusedSeries=series.find(item=>item.id===focusedSeriesVersion?.series_id);
  const focusedAccount=accounts.find(item=>item.id===focusedEpisode?.account_id);

  const preview=useWorkbenchPreview(focusedEpisode?.id??'',focusedEpisode?.updated_at??'',Boolean(remote)&&!isLoading);
  const previewStoryboard=preview.data?.reviewPackages?.filter(p=>p.stage==='storyboard_review'&&!p.invalidated_at).sort((a,b)=>b.revision_number-a.revision_number)[0];
  const shotCount=preview.data?.shotPreparationDrafts?.filter(d=>d.review_package_id===previewStoryboard?.id).length??0;
  const worker=taskQueue??remote?.catalog.worker;
  const taskIssues=(worker?.blocked??0)+(worker?.failed??0);
  const notice = !remote ? null : taskIssues > 0
    ? {tone:'danger',icon:TriangleAlert,title:'有后台任务需要处理',detail:''}
    : remote.catalog.pending.total > 0
      ? {tone:'warning',icon:CircleAlert,title:`${remote.catalog.pending.total} 项审核，等待你的决定`,detail:'查看审核证据，确认后继续制作。'}
      : (worker?.running??0) > 0 || (remote.catalog.statusCounts?.running ?? 0) > 0
        ? {tone:'info',icon:Clock3,title:'内容正在制作中',detail:'可以查看制作进度，或继续其他生产单。'}
        : {tone:'success',icon:Check,title:'当前没有待审核项',detail:''};
  const setSeriesFilter=remote?.onSeriesChange??setSelectedSeriesId;
  function clearSearch() {
    setSearch('');
    catalogControls?.onSearch('');
  }
  const stage=catalogControls?.stage??'all';
  const activeFilters = [
    catalogControls?.query&&{label:'搜索',value:catalogControls.query,clear:clearSearch},
    catalogControls&&catalogControls.status!=='all'&&{label:'状态',value:statusFilters.find(([key])=>key===catalogControls.status)?.[1],clear:()=>catalogControls.onStatus('all')},
    catalogControls?.accountId&&{label:'账号',value:accounts.find(account=>account.id===catalogControls.accountId)?.name??'账号不可用',clear:()=>catalogControls.onAccount('')},
    effectiveSeriesId!=='all'&&{label:'系列',value:seriesOptions.find(option=>option.id===effectiveSeriesId)?.name??'系列不可用',clear:()=>setSeriesFilter('all')},
    stage!=='all'&&{label:'阶段',value:workspacePhaseGroups.find(group=>group.id===stage)?.label,clear:()=>catalogControls?.onStage?.('all')},
  ].filter(filter=>typeof filter==='object');
  const hasNonSearchFilters = Boolean((catalogControls?.stage??'all')!=='all' || (catalogControls && catalogControls.status !== 'all') || (catalogControls && catalogControls.sort !== 'updated') || catalogControls?.accountId || effectiveSeriesId !== 'all');
  function resetFilters() {
    setSearch('');setEpisodePage(1);setSelectedSeriesId('all');
    if(catalogControls?.onReset){catalogControls.onReset();return;}
    catalogControls?.onSearch('');catalogControls?.onStage?.('all');catalogControls?.onStatus('all');catalogControls?.onSort('updated');catalogControls?.onAccount('');remote?.onSeriesChange('all');
  }
  const NoticeIcon = notice?.icon ?? Check;
  return <section className="operations-workspace" aria-label="系列运营概览" aria-busy={isLoading} data-has-current={Boolean(focusedEpisode)}>
    <header className="operations-intro"><div><h1>内容工作台</h1></div>{actions}</header>
    <div className="work-main-column">
    {remote&&notice&&(notice.tone==='success'?<p className="work-review-status" data-tone="success" role="status">{notice.title}</p>:<div className="lc-work-notice" data-tone={notice.tone} role="status"><NoticeIcon size={16} aria-hidden="true"/><div><strong>{notice.title}</strong><span>{notice.detail}{taskIssues>0&&worker?[worker.blocked&&`${worker.blocked} 项阻塞`,worker.failed&&`${worker.failed} 项失败`].filter(Boolean).join(' · '):''}{worker&&worker.running>0?` ${worker.running} 项执行中`:''}</span></div>{taskIssues>0&&onOpenTaskQueue?<Button size="sm" color="tertiary" iconLeading={ArrowUpRight} onPress={onOpenTaskQueue}>查看后台任务</Button>:remote.catalog.pending.total>0&&onOpenReviewQueue&&<Button size="sm" color="tertiary" iconLeading={ArrowUpRight} onPress={onOpenReviewQueue}>开始审核</Button>}</div>)}
    {catalogControls&&<>
      <div className="episode-status-tabs" role="tablist" aria-label="工作台状态筛选">{statusFilters.map(([key,label],index,tabs)=><button key={key} type="button" role="tab" id={`${tabId}-${key}`} aria-controls={`${tabId}-panel`} aria-selected={catalogControls.status===key} tabIndex={catalogControls.status===key?0:-1} className={catalogControls.status===key?'is-active':''} onClick={()=>catalogControls.onStatus(key)} onKeyDown={event=>{const next=event.key==='ArrowRight'?(index+1)%tabs.length:event.key==='ArrowLeft'?(index+tabs.length-1)%tabs.length:event.key==='Home'?0:event.key==='End'?tabs.length-1:-1;if(next<0)return;event.preventDefault();catalogControls.onStatus(tabs[next][0]);event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role=tab]')[next]?.focus();}}>{label}{remote?.catalog.statusCounts?.[key]!==undefined&&<span>{remote.catalog.statusCounts[key]}</span>}</button>)}</div>
    </>}
    <div className="work-results" role={catalogControls?'tabpanel':undefined} id={`${tabId}-panel`} aria-labelledby={catalogControls?`${tabId}-${catalogControls.status}`:undefined}>
    <div className="work-filter-area"><div className="work-filters">
      {catalogControls&&<form className="episode-search" role="search" aria-label="搜索工作台生产单" onSubmit={event=>{event.preventDefault();const query=search.trim();setSearch(query);catalogControls.onSearch(query);}}><Search size={15} aria-hidden="true"/><input ref={searchInput} aria-label="搜索标题或编号" placeholder="搜索标题或编号" maxLength={200} value={search} onChange={event=>setSearch(event.target.value)}/>{search&&<button type="button" aria-label="清除搜索" onClick={clearSearch}><X size={14} aria-hidden="true"/></button>}<button className="episode-search-submit" type="submit">搜索</button></form>}
      {catalogControls&&<PopulatedFilterSelect icon={Users} size="sm" aria-label="工作台账号筛选" disabled={isLoading} value={catalogControls.accountId} onValueChange={catalogControls.onAccount} allValue="" counts={accountCounts} options={[{value:"",label:"全部账号"},...accounts.map(account=>({value:account.id,label:account.name}))]}/>}
      <PopulatedFilterSelect icon={Layers} size="sm" aria-label="运营系列筛选" disabled={isLoading} value={effectiveSeriesId} onValueChange={setSeriesFilter} allValue="all" counts={seriesCounts} options={[{value:"all",label:"全部系列"},...seriesOptions.map(operation=>({value:operation.id,label:operation.name}))]}/>
      {catalogControls?.onStage&&<NativeSelect icon={Milestone} size="sm" aria-label="工作台阶段筛选" value={catalogControls.stage??'all'} onChange={event=>catalogControls.onStage?.(event.target.value as ProductionStep|'all')} options={[{value:'all',label:'全部阶段'},...workspacePhaseGroups.map(({id,label})=>({value:id,label}))]}/>}
      {catalogControls&&<NativeSelect icon={ArrowDownWideNarrow} size="sm" aria-label="工作台排序" value={catalogControls.sort} onChange={event=>catalogControls.onSort(event.target.value as CatalogSort)} options={[{value:'updated',label:'最近更新'},{value:'oldest',label:'最早更新'},{value:'title',label:'标题顺序'}]}/>}
      {hasNonSearchFilters && activeFilters.length===0 && <Button size="sm" color="tertiary" onPress={resetFilters}>清空筛选</Button>}
    </div>
    <AppliedFilters filters={activeFilters} onReset={resetFilters} restoreFocus={()=>searchInput.current?.focus()}/>
    </div>
    <section className="lc-work-table" aria-label="系列生产单">
    {isLoading?<p role="status" className="workspace-loading">正在读取工作台…</p>:visibleEpisodes.length?<><div className="work-table-scroll"><table><thead><tr><th scope="col">生产单</th><th scope="col">当前阶段</th><th scope="col">状态</th><th scope="col">最近更新</th><th scope="col"><span className="sr-only">操作</span></th></tr></thead><tbody>{visibleEpisodePage.map(({episode,blockers:episodeBlockers,reviewPackage,reviewPending})=>{
      const summary=remote?.catalog.operationRows.find(row=>row.episodeId===episode.id),revision=summary?.reviewRevision??reviewPackage?.revision_number,pending=summary?.reviewPending??reviewPending,blockerCount=summary?.blockerCount??episodeBlockers.length;
      const rowBlocker=summary?.blocker??(remote?remote.catalog.blocked.items.find(item=>item.episode.id===episode.id)?.blocker:episodeBlockers[0]);
      const state=episodeActionState(episode,summary??{episodeId:episode.id,reviewRevision:revision??null,reviewPending:pending,blockerCount});
      const itemSeries=series.find(item=>item.id===seriesVersions.find(v=>v.id===episode.series_version_id)?.series_id);
      return <tr key={episode.id} className={focusedEpisode?.id===episode.id?'is-selected':''} onClick={()=>setFocusedId(episode.id)}><td><button type="button" className="work-episode-select" aria-pressed={focusedEpisode?.id===episode.id} onClick={()=>setFocusedId(episode.id)}><span><strong>{episode.title||'未命名生产单'}</strong><small>{[accounts.find(a=>a.id===episode.account_id)?.name,itemSeries?.name??'未关联系列'].filter(Boolean).join(' · ')}</small></span></button></td><td>{episodeWorkflowLabel(summary)??operationalStageLabel(episode.stage)}</td><td><EpisodeStatus state={state}/>{rowBlocker&&state==='blocked'&&<small className="work-blocker-reason" title={rowBlocker.detail}>{episodeBlockerLabel(rowBlocker)}</small>}</td><td><time dateTime={episode.updated_at} title={new Date(episode.updated_at).toLocaleString('zh-CN')}>{new Intl.DateTimeFormat('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(episode.updated_at))}</time></td><td><Button size="sm" color="tertiary" iconLeading={ArrowUpRight} data-episode-open={episode.id} aria-label={`打开生产单 ${episode.title||episode.id}`} onPress={()=>onSelectEpisode(episode.id)}/></td></tr>;
    })}</tbody></table></div><PaginationControls page={safeEpisodePage} pageSize={episodePageSize} total={remote?.catalog.total??visibleEpisodes.length} onPageChange={remote?.onPageChange??setEpisodePage}/></>:<div className="work-empty"><h3>{catalogControls?.status==='review'?'当前没有待审核生产单':'没有符合条件的生产单'}</h3><p>{catalogControls?.query?'试试其他关键词，或清除搜索。':'调整筛选条件，或新建生产单。'}</p></div>}
    </section><footer className="work-list-footer"><span>{remote?.catalog.total??visibleEpisodes.length} 张生产单</span>{onOpenAllEpisodes&&<Button size="sm" color="tertiary" iconLeading={ArrowUpRight} onPress={onOpenAllEpisodes}>查看全部</Button>}</footer></div></div>
    {focusedEpisode&&next&&<aside className="work-continuation" aria-label="当前作品"><header><h2>{focusState==='done'?'查看成果':'继续处理'}</h2><span title={focusedEpisode.id}>{focusedEpisode.id.slice(0,8)}</span></header><WorkbenchArtwork episodeId={focusedEpisode.id} title={focusedEpisode.title||'未命名生产单'} artifacts={preview.data?.artifacts} exportedVideo={preview.data?.exportedVideo} error={preview.error}/><div className="work-continuation-body"><div className="work-title"><h3>{focusedEpisode.title||'未命名生产单'}</h3><p className="work-context">{[focusedAccount?.name,focusedSeries?.name].filter(Boolean).join(' · ')||'未关联系列'}{shotCount?` · ${shotCount} 个镜头`:''}</p></div><ol className="work-phase-track" aria-label="当前生产阶段">{phaseGroups.map((group,index)=><li key={group.label} className={index<phaseIndex||index===phaseIndex&&focusState==='done'?'is-complete':index===phaseIndex?'is-current':''} aria-current={index===phaseIndex&&focusState!=='done'?'step':undefined}><span aria-hidden="true">{index<phaseIndex||index===phaseIndex&&focusState==='done'?<Check size={10}/>:null}</span>{group.label}</li>)}</ol><section className="work-next-step" aria-label={focusState==='done'?'制作成果':'下一步'}><strong>{focusState==='done'?null:episodeWorkflowLabel(focusSummary)??operationalStageLabel(focusedEpisode.stage)}<span><EpisodeStatus state={focusState}/></span></strong><p>{next.detail}</p><Button size="sm" color="primary" iconLeading={ArrowUpRight} onPress={()=>focusState==='blocked'&&focusBlocker?.code==='provider_result_unknown'&&onOpenTaskQueue?onOpenTaskQueue():onSelectEpisode(focusedEpisode.id)}>{next.label}</Button></section><dl className="work-context-details"><div><dt>脚本</dt><dd>{['waiting_input','brief_draft','script_draft','script_review'].includes(focusedEpisode.stage)?'待确认':'已确认'}</dd></div>{focusedAccount&&<div><dt>蓝图快照</dt><dd>v{blueprints.find(b=>b.id===focusedEpisode.blueprint_version_id)?.version??'—'}</dd></div>}<div><dt>创建时系列基线</dt><dd>{focusedSeriesVersion?`v${focusedSeriesVersion.version}`:'未关联'}</dd></div><div><dt>最近更新</dt><dd>{new Intl.DateTimeFormat('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(focusedEpisode.updated_at))}</dd></div></dl><footer><Button size="sm" color="secondary" onPress={()=>onSelectEpisode(focusedEpisode.id)}>查看完整生产单</Button></footer></div></aside>}
    {!remote&&<div className="operations-detail-grid lc-work-queue"><section className="operations-list"><header><h3>待审核</h3><span>{pendingReviews.length} 个待审核包</span></header>{pendingReviews.length?<ul>{pendingReviews.map(({episode,revision})=><li key={episode.id}><Button size="sm" color="tertiary" className="justify-stretch text-left" onClick={()=>onSelectEpisode(episode.id)} type="button"><strong>{episode.title||'未命名生产单'}</strong><span>{operationalStageLabel(episode.stage)} · 审核包 v{revision}</span></Button></li>)}</ul>:<p>当前筛选范围没有待审核包。</p>}</section></div>}
  </section>;
}
