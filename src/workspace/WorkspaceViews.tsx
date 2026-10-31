import {Tooltip,TooltipTrigger} from '../ui/dan-ui/components/base/tooltip/tooltip';
import {Dropdown} from '../ui/dan-ui/components/base/dropdown/dropdown';
import {MoreHorizontal,FolderOpen,Archive,ArchiveRestore,KeyRound,ShieldCheck,Settings,Layers,Search,ArrowDownWideNarrow,SlidersHorizontal,Bell} from 'lucide-react';
import {NativeSelect} from '../ui/dan-ui/components/base/select/select-native';
import {InputBase} from '../ui/dan-ui/components/base/input/input';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
// Shared original workspace views. Data and authentication are supplied by each backend.
import {useState,useEffect,useRef,useId,type FormEvent,type ReactNode} from 'react';
import {BarChart3,LogOut,MessageSquare,Moon,PanelLeft,Pencil,Play,RefreshCw,Sun,Table2,Trash2,User,Users,Video,X,type LucideIcon} from 'lucide-react';
import type {Database} from '../lib/database.types';
import type {EpisodeStage} from '../platform/types';
import type {ServerPage,EpisodeCatalog} from '../episodes/episodeCatalogTypes';
import {EpisodeStatus,episodeActionState,episodeWorkflowLabel} from './episodePresentation';
import './episode-list.css';
import {blueprintAssetRoot} from '../platform/blueprintPolicy';
import {useDialogFocus} from '../ui/useDialogFocus';
import {PaginationControls} from '../ui/PaginationControls';
type Row<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Row'];
type Account=Row<'accounts'>;type Episode=Row<'episodes'>;type Blueprint=Row<'account_blueprint_versions'>;type Artifact=Row<'artifacts'>;type Series=Row<'series'>;type SeriesVersion=Row<'series_versions'>;
export type NavigationItem='accounts'|'episodes'|'operations'|'reviews';
type EpisodeVisibility='active'|'archived'|'all';type EpisodeAction='rename'|'archive'|'delete'|null;type EpisodeWithArchive=Episode&{archived_at?:string|null};
export interface EpisodeDeletionPlan {path:string;paths?:string[];revision:string;confirmation:string}
interface ReviewAction{approveStage:EpisodeStage;requestChangesStage:EpisodeStage}
export const navigation: Array<{ id: NavigationItem; label: string }> = [
  { id: "operations", label: "系列运营" },
  { id: "episodes", label: "生产单" },
  { id: "accounts", label: "账号" },
];

export function NavigationButtons({ activeNavigation, badges = {}, onSelect }: { activeNavigation: NavigationItem; badges?: Partial<Record<NavigationItem, number>>; onSelect: (item: NavigationItem) => void }) {
  return <>{navigation.map((item) => <Button size="sm" color="tertiary" aria-current={activeNavigation === item.id ? "page" : undefined} aria-label={item.label} className={`navigation-item ${activeNavigation === item.id ? "is-active" : ""}`} key={item.id} onClick={() => onSelect(item.id)} type="button"><Icon name={item.id} /><span className="navigation-label">{item.label}</span>{badges[item.id] ? <span aria-label={`${badges[item.id]} 个待处理`} className="navigation-badge">{badges[item.id]}</span> : null}</Button>)}</>;
}

export function OwnerMenu({ onOpenSettings, onOpenMaintenance, onOpenSecrets, onOpenPreferences, onOpenNotifications, displayName, avatar, email, onSignOut, onBeforeOpen, isActive=false }: { displayName?: string; avatar?: string | null; email?: string; onOpenPreferences?: () => void; onOpenNotifications?: () => void; isActive?: boolean; onBeforeOpen?: (trigger: HTMLButtonElement | null) => void; onOpenSettings: () => void; onOpenMaintenance?: () => void; onOpenSecrets?: () => void; onSignOut: () => void }) {
  const trigger = useRef<HTMLButtonElement>(null);
  const select = (action: () => void) => {onBeforeOpen?.(trigger.current); trigger.current?.focus(); action();};
  return <div className="owner-menu"><Dropdown.Root><Button size="sm" color="tertiary" aria-label="所有者设置" ref={trigger} className="owner-menu-trigger" data-active={isActive||undefined} type="button">{avatar?<img className="owner-menu-avatar" src={avatar} alt=""/>:<Icon name="User" />}</Button><Dropdown.Popover className="dan-ui product-ui"><Dropdown.Menu aria-label="所有者设置"><Dropdown.Section>{displayName||email?<Dropdown.SectionHeader><div className="owner-profile-summary"><strong>{displayName||email}</strong>{displayName&&email?<span>{email}</span>:null}</div></Dropdown.SectionHeader>:null}{onOpenPreferences&&<Dropdown.Item icon={SlidersHorizontal} id="preferences" onAction={()=>select(onOpenPreferences)}>个人偏好</Dropdown.Item>}{onOpenNotifications&&<Dropdown.Item icon={Bell} id="notifications" onAction={()=>select(onOpenNotifications)}>通知</Dropdown.Item>}<Dropdown.Item icon={ShieldCheck} id="security" onAction={()=>select(onOpenSettings)}>登录与安全</Dropdown.Item>{onOpenMaintenance&&<Dropdown.Item icon={Settings} id="maintenance" onAction={()=>select(onOpenMaintenance)}>系统维护</Dropdown.Item>}{onOpenSecrets&&<Dropdown.Item icon={KeyRound} id="secrets" onAction={()=>select(onOpenSecrets)}>密钥管理</Dropdown.Item>}</Dropdown.Section><Dropdown.Separator/><Dropdown.Section><Dropdown.Item icon={LogOut} id="logout" onAction={()=>select(onSignOut)}>退出登录</Dropdown.Item></Dropdown.Section></Dropdown.Menu></Dropdown.Popover></Dropdown.Root></div>;
}

export const stageLabels: Record<EpisodeStage, string> = {
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
  production_ready: "合成与 QC",
  render_ready: "合成与 QC",
  qc_review: "合成与 QC 审核",
  qc_passed: "合成与 QC 审核",
  production_completed: "生产完成",
};

const reviewActions: Partial<Record<EpisodeStage, ReviewAction>> = {
  script_review: { approveStage: "script_approved", requestChangesStage: "script_draft" },
  visual_review: { approveStage: "visual_approved", requestChangesStage: "visual_draft" },
  storyboard_review: { approveStage: "storyboard_approved", requestChangesStage: "storyboard_draft" },
  qc_review: { approveStage: "qc_passed", requestChangesStage: "render_ready" },
};

export function stageTone(stage: EpisodeStage): "review" | "approved" | "muted" {
  if (stage.endsWith("approved") || stage === "qc_passed" || stage === "production_completed") {
    return "approved";
  }
  if (stage.includes("review")) return "review";
  return "muted";
}

export function formatDate(source: string) {
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(source));
}

export function episodeIsArchived(episode: Episode): boolean {
  return Boolean((episode as EpisodeWithArchive).archived_at);
}

export function reviewActionFor(stage: EpisodeStage): ReviewAction | null {
  return reviewActions[stage] ?? null;
}

function EpisodeActionsMenu({ artifactCount, blueprint, episode, isArchivePending, isDeletePending, isTitlePending, onDelete, onPlanDelete, onOpenDirectory, onSetArchived, onUpdateTitle }: { artifactCount?:number; blueprint: Blueprint | undefined; episode: Episode; isArchivePending: boolean; isDeletePending: boolean; isTitlePending: boolean; onDelete: (episodeId: string, confirmation: string, plan?: EpisodeDeletionPlan) => Promise<void>; onPlanDelete?: (episodeId:string)=>Promise<EpisodeDeletionPlan>; onOpenDirectory?: (episodeId:string)=>Promise<void>; onSetArchived: (episodeId: string, archived: boolean) => Promise<void>; onUpdateTitle: (episodeId: string, title: string) => Promise<void> }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [action, setAction] = useState<EpisodeAction>(null);
  const archived = episodeIsArchived(episode);
  function openAction(nextAction: EpisodeAction) { setMenuOpen(false); setAction(nextAction); }
  return <div className="episode-actions" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}><Dropdown.Root isOpen={menuOpen} onOpenChange={setMenuOpen}><Button size="sm" color="tertiary" aria-label={`生产单操作：${episode.title || "未命名生产单"}`} className="episode-actions-trigger" type="button"><MoreHorizontal aria-hidden="true" size={20}/></Button><Dropdown.Popover className="dan-ui product-ui episode-actions-popover" placement="bottom end" offset={8}><div className="episode-menu-summary"><strong title={episode.title||'未命名生产单'}>{episode.title||'未命名生产单'}</strong><dl><div><dt>编号</dt><dd><code title={episode.id}>{episode.id}</code></dd></div><div><dt>蓝图</dt><dd>v{blueprint?.version ?? "—"}</dd></div>{artifactCount!==undefined&&<div><dt>产物</dt><dd>{artifactCount} 项</dd></div>}</dl></div><Dropdown.Menu aria-label="生产单操作"><Dropdown.Section aria-label="管理操作">{onOpenDirectory&&<Dropdown.Item icon={FolderOpen} id="open-directory" onAction={()=>{setMenuOpen(false);void onOpenDirectory(episode.id);}}>打开本地文件夹</Dropdown.Item>}<Dropdown.Item icon={Pencil} id="rename" onAction={() => openAction("rename")}>重命名</Dropdown.Item><Dropdown.Item icon={archived?ArchiveRestore:Archive} id="archive" onAction={() => openAction("archive")}>{archived ? "恢复" : "归档"}</Dropdown.Item></Dropdown.Section>{archived&&<><Dropdown.Separator/><Dropdown.Section aria-label="删除操作"><Dropdown.Item icon={Trash2} id="delete" className="menu-item-danger" onAction={() => openAction("delete")}>永久删除</Dropdown.Item></Dropdown.Section></>}</Dropdown.Menu></Dropdown.Popover></Dropdown.Root>{action === "rename" ? <EpisodeRenameModal episode={episode} isPending={isTitlePending} onClose={() => setAction(null)} onSave={onUpdateTitle} /> : null}{action === "archive" ? <EpisodeArchiveModal archived={archived} isPending={isArchivePending} onClose={() => setAction(null)} onSave={onSetArchived} episodeId={episode.id} /> : null}{action === "delete" ? <EpisodeDeleteModal assetRoot={blueprint ? blueprintAssetRoot(blueprint.policy) : ""} episode={episode} isPending={isDeletePending} onClose={() => setAction(null)} onDelete={onDelete} onPlanDelete={onPlanDelete} /> : null}</div>;
}

function EpisodeRenameModal({ episode, isPending, onClose, onSave }: { episode: Episode; isPending: boolean; onClose: () => void; onSave: (episodeId: string, title: string) => Promise<void> }) {
  const dialogRef = useDialogFocus<HTMLFormElement>(true, () => { if (!isPending) onClose(); });

  const [title, setTitle] = useState(episode.title);
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); await onSave(episode.id, title); onClose(); }
  return <div className="modal-backdrop"  role="dialog" aria-modal="true" aria-label="重命名生产单"><form ref={dialogRef} aria-label="重命名生产单" className="modal-card" onSubmit={(event) => void submit(event)}><header><div><h2>重命名生产单</h2><p>只修改管理标题，不会改变已固定材料或任务。</p></div><Button size="sm" color="tertiary" aria-label="关闭重命名生产单" className="icon-button" onClick={onClose} type="button"><Icon name="Close" /></Button></header><label>新标题<InputBase size="sm" aria-label="新生产单标题" autoFocus onChange={(event) => setTitle(event.target.value)} value={title} /></label><div className="modal-actions"><Button size="sm" color="secondary" className="button button-secondary" onClick={onClose} type="button">取消</Button><Button size="sm" color="primary" className="button button-primary" isDisabled={isPending || title === episode.title} type="submit">{isPending ? "保存中…" : "保存新标题"}</Button></div></form></div>;
}

function EpisodeArchiveModal({ archived, episodeId, isPending, onClose, onSave }: { archived: boolean; episodeId: string; isPending: boolean; onClose: () => void; onSave: (episodeId: string, archived: boolean) => Promise<void> }) {
  const [error,setError]=useState(''),[saving,setSaving]=useState(false),submitting=useRef(false);
  const pending=isPending||saving;
  const dialogRef = useDialogFocus<HTMLFormElement>(true, () => { if (!pending) onClose(); });
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();if(submitting.current||isPending)return;
    submitting.current=true;setSaving(true);setError('');
    try{await onSave(episodeId,!archived);onClose();}
    catch(reason){setError(reason instanceof Error?reason.message:'操作未完成，请重试。');}
    finally{submitting.current=false;setSaving(false);}
  }
  return <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={archived ? "恢复生产单" : "归档生产单"}><form ref={dialogRef} aria-label={archived ? "恢复生产单" : "归档生产单"} className="modal-card episode-archive-modal" onSubmit={(event) => void submit(event)}><header><div><h2>{archived ? "恢复生产单" : "归档生产单"}</h2><p>{archived ? "恢复后会重新出现在未归档列表。" : "归档不会删除生产数据或本地产物。"}</p></div><Button size="sm" color="tertiary" aria-label="关闭归档操作" isDisabled={pending} className="icon-button" onClick={onClose} type="button"><Icon name="Close" /></Button></header>{error&&<p className="form-error" role="alert">{error}</p>}<div className="modal-actions"><Button size="sm" color="secondary" className="button button-secondary" isDisabled={pending} onClick={onClose} type="button">取消</Button><Button size="sm" color="primary" className="button button-primary" isDisabled={pending} type="submit">{pending ? "处理中…" : archived ? "确认恢复" : "确认归档"}</Button></div></form></div>;
}

function EpisodeDeleteModal({ assetRoot, episode, isPending, onClose, onDelete, onPlanDelete }: { assetRoot: string; episode: Episode; isPending: boolean; onClose: () => void; onDelete: (episodeId: string, confirmation: string, plan?: EpisodeDeletionPlan) => Promise<void>; onPlanDelete?: (episodeId:string)=>Promise<EpisodeDeletionPlan> }) {
  const dialogRef = useDialogFocus<HTMLFormElement>(true, () => { if (!isPending && !submitting) onClose(); });

  const [confirmation, setConfirmation] = useState("");
  const [plan, setPlan] = useState<EpisodeDeletionPlan|null>(null);
  const [loading, setLoading] = useState(Boolean(onPlanDelete));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!onPlanDelete) return;
    let active = true;
    setLoading(true); setError(""); setPlan(null); setConfirmation("");
    void onPlanDelete(episode.id).then(value => { if (active) setPlan(value); }).catch(reason => { if (active) setError(reason instanceof Error ? reason.message : "无法读取删除范围，请重试。"); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [episode.id, onPlanDelete, attempt]);
  const pending = isPending || submitting;
  const confirmationTarget = plan?.confirmation ?? (episode.title.trim() || "DELETE");
  const localEpisodePath = plan?.path ?? (onPlanDelete ? "" : assetRoot ? `${assetRoot.replace(/\/+$/, "")}/episodes/${episode.id}` : `episodes/${episode.id}（账号资产目录未配置）`);
  const deletionPaths = plan?.paths ?? (localEpisodePath ? [localEpisodePath] : []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || loading || onPlanDelete && !plan || confirmation !== confirmationTarget) return;
    setSubmitting(true); setError("");
    try { await onDelete(episode.id, confirmation, plan ?? undefined); onClose(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "删除失败，请重试。"); if (onPlanDelete) setPlan(null); }
    finally { setSubmitting(false); }
  }
  return <div className="modal-backdrop"  role="dialog" aria-modal="true" aria-label="永久删除生产单"><form ref={dialogRef} aria-label="永久删除生产单" className="modal-card modal-card-danger episode-deletion-modal" onSubmit={(event) => void submit(event)}><header><div><h2>永久删除生产单</h2><p>此操作不可恢复，将删除该生产单的数据库记录和下方目录。</p></div><Button size="sm" color="tertiary" aria-label="关闭永久删除生产单" className="icon-button" isDisabled={pending} onClick={onClose} type="button"><Icon name="Close" /></Button></header>{loading ? <p role="status">正在检查删除范围…</p> : localEpisodePath ? <><p>清理目录（含旧副本）</p><ul className="episode-deletion-paths" aria-label="将删除的生产单目录">{deletionPaths.map(path => <li key={path}><code>{path}</code></li>)}</ul><p>仅清理列出的目录；原始素材、账号目录中的其他内容及其他生产单保留。</p></> : null}{error && <p className="form-error" role="alert">{error}</p>}{onPlanDelete && !loading && !plan && <Button size="sm" color="secondary" className="button button-secondary" onClick={() => setAttempt(value => value + 1)} type="button">重新检查删除范围</Button>}<label>输入“{confirmationTarget}”确认删除<InputBase size="sm" aria-label="永久删除确认文本" autoFocus isDisabled={loading || pending || Boolean(onPlanDelete && !plan)} onChange={(event) => setConfirmation(event.target.value)} placeholder={confirmationTarget} value={confirmation} /></label><div className="modal-actions"><Button size="sm" color="secondary" className="button button-secondary" isDisabled={pending} onClick={onClose} type="button">取消</Button><Button size="sm" color="primary-destructive" className="button button-danger" isDisabled={pending || loading || Boolean(onPlanDelete && !plan) || confirmation !== confirmationTarget} type="submit">{pending ? "删除中…" : "确认永久删除"}</Button></div></form></div>;
}

export function EpisodeWorkspace({ catalogControls, operationRows, actions, reviewOnly = false, isPageLoading = false, serverPage, artifactCounts, accounts, accountsById, artifacts, blueprintsById, episodeVisibility, episodes, filter, onDelete = async () => {}, onPlanDelete, onOpenDirectory, onEpisodeVisibilityChange, onFilter, onSetArchived = async () => {}, onSeriesFilter, onSelectEpisode, onUpdateTitle = async () => {}, series, seriesById, seriesFilter, seriesVersionsById, selectedEpisode, isArchivePending = () => false, isDeletePending = () => false, isTitlePending = () => false }: { catalogControls?: {query:string;status:"all"|"review"|"running"|"blocked"|"done";sort:"updated"|"oldest"|"title";counts?:Record<string,number>;onSearch:(query:string)=>void;onStatus:(status:"all"|"review"|"running"|"blocked"|"done")=>void;onSort:(sort:"updated"|"oldest"|"title")=>void};operationRows?:EpisodeCatalog["operationRows"];actions?: ReactNode; reviewOnly?: boolean; isPageLoading?: boolean; serverPage?: ServerPage; artifactCounts?: Record<string, number>; accounts: Account[]; accountsById: Map<string, Account>; artifacts: Artifact[]; blueprintsById: Map<string, Blueprint>; episodeVisibility: EpisodeVisibility; episodes: Episode[]; filter: string; isArchivePending?: (episodeId: string) => boolean; isDeletePending?: (episodeId: string) => boolean; isTitlePending?: (episodeId: string) => boolean; onDelete?: (episodeId: string, confirmation: string, plan?: EpisodeDeletionPlan) => Promise<void>; onPlanDelete?: (episodeId:string)=>Promise<EpisodeDeletionPlan>; onOpenDirectory?: (episodeId:string)=>Promise<void>; onEpisodeVisibilityChange: (value: EpisodeVisibility) => void; onFilter: (value: string) => void; onSetArchived?: (episodeId: string, archived: boolean) => Promise<void>; onSeriesFilter: (value: string) => void; onSelectEpisode: (id: string) => void; onUpdateTitle?: (episodeId: string, title: string) => Promise<void>; series: Series[]; seriesById: Map<string, Series>; seriesFilter: string; seriesVersionsById: Map<string, SeriesVersion>; selectedEpisode: Episode | null }) {
  const [page, setPage] = useState(1);
  const [search,setSearch]=useState(catalogControls?.query??'');
  const listId=useId();
  useEffect(()=>setSearch(catalogControls?.query??''),[catalogControls?.query]);
  const pageSize = 20;
  const filteredEpisodes = episodes.filter((episode) => episodeVisibility === "all" || (episodeVisibility === "archived" ? episodeIsArchived(episode) : !episodeIsArchived(episode)));
  const pageCount = Math.max(1, Math.ceil(filteredEpisodes.length / pageSize));
  const safePage = serverPage?.page ?? Math.min(page, pageCount);
  const total = serverPage?.total ?? filteredEpisodes.length;
  const pageItems = isPageLoading ? [] : serverPage ? filteredEpisodes : filteredEpisodes.slice((safePage - 1) * pageSize, safePage * pageSize);
  useEffect(() => setPage(1), [episodeVisibility, filter, seriesFilter]);
  useEffect(() => setPage((current) => Math.min(current, pageCount)), [pageCount]);
  return <div className="episode-list-workspace">
    <div className="episode-list-header">{catalogControls&&<div className="episode-status-tabs" role="tablist" aria-label="生产单筛选">{([['all','全部'],['review','待审核'],['running','制作中'],['blocked','需处理'],['done','已完成']] as const).map(([key,label],index,tabs)=><button type="button" role="tab" id={`${listId}-${key}`} aria-controls={`${listId}-panel`} tabIndex={catalogControls.status===key?0:-1} onKeyDown={event=>{const offset=event.key==='ArrowRight'?1:event.key==='ArrowLeft'?-1:0;const target=event.key==='Home'?0:event.key==='End'?tabs.length-1:offset?(index+offset+tabs.length)%tabs.length:-1;if(target<0)return;event.preventDefault();catalogControls.onStatus(tabs[target][0]);event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role=tab]')[target]?.focus();}} aria-label={label} aria-selected={catalogControls.status===key} className={catalogControls.status===key?'is-active':''} key={key} onClick={()=>catalogControls.onStatus(key)}>{label}{catalogControls.counts?.[key]!==undefined&&<span aria-hidden="true">{catalogControls.counts[key]}</span>}</button>)}</div>}{catalogControls&&actions}</div>
    <div role={catalogControls?"tabpanel":undefined} id={`${listId}-panel`} aria-labelledby={catalogControls?`${listId}-${catalogControls.status}`:undefined}><div className="filters episode-list-toolbar">
      {catalogControls&&<form className="episode-search" role="search" aria-label="搜索生产单" onSubmit={event=>{event.preventDefault();catalogControls.onSearch(search.trim());}}><Search aria-hidden="true" size={16}/><input aria-label="搜索标题或编号" placeholder="搜索标题或编号" maxLength={200} value={search} onChange={event=>setSearch(event.target.value)}/>{search&&<button aria-label="清除搜索" type="button" onClick={()=>{setSearch('');catalogControls.onSearch('');}}><X aria-hidden="true" size={14}/></button>}<button className="episode-search-submit" type="submit">搜索</button></form>}
      <label><span>账号</span><NativeSelect icon={Users} size="sm" onChange={(event) => onFilter(event.target.value)} value={filter}><option value="全部账号">全部账号</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</NativeSelect></label>
      <label><span>系列</span><NativeSelect icon={Layers} size="sm" onChange={(event) => onSeriesFilter(event.target.value)} value={seriesFilter}><option value="全部系列">全部系列</option>{series.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}</NativeSelect></label>
      {!reviewOnly&&<label><span>生产单状态</span><NativeSelect icon={Archive} size="sm" aria-label="生产单状态" onChange={(event) => onEpisodeVisibilityChange(event.target.value as EpisodeVisibility)} value={episodeVisibility}><option value="active">未归档</option><option value="archived">已归档</option><option value="all">全部范围</option></NativeSelect></label>}
      {catalogControls&&<NativeSelect icon={ArrowDownWideNarrow} size="sm" aria-label="生产单排序" value={catalogControls.sort} onChange={event=>catalogControls.onSort(event.target.value as 'updated'|'oldest'|'title')} options={[{value:'updated',label:'最近更新'},{value:'oldest',label:'最早更新'},{value:'title',label:'标题顺序'}]}/>}
      {!catalogControls&&actions}
    </div>
    <div className="episode-table" role="table" aria-label="生产单"><div className="table-row table-header" role="row">{['生产单','当前阶段','状态','最近更新','操作'].map(label=><span key={label} role="columnheader">{label}</span>)}</div>
    {pageItems.map(episode=>{const seriesVersion=episode.series_version_id?seriesVersionsById.get(episode.series_version_id):null;const account=accountsById.get(episode.account_id);const count=artifactCounts?.[episode.id]??artifacts.filter(a=>a.episode_id===episode.id).length;const summary=operationRows?.find(row=>row.episodeId===episode.id);const state=episodeActionState(episode,summary);const context=[account?.name??'未知账号',seriesVersion?`${seriesById.get(seriesVersion.series_id)?.name??'未知系列'} v${seriesVersion.version}`:'未关联系列'].join(' · ');
      return <div className={`table-row episode-row ${selectedEpisode?.id===episode.id?'is-selected':''}`} key={episode.id} onClick={()=>onSelectEpisode(episode.id)} onKeyDown={event=>{if(event.target===event.currentTarget&&(event.key==='Enter'||event.key===' ')){event.preventDefault();onSelectEpisode(episode.id);}}} role="row" tabIndex={0}>
        <div className="episode-name" role="cell"><Tooltip title={episode.title||'未命名生产单'} className="dan-ui dan-ui-tooltip"><TooltipTrigger className="lc-table-name lc-table-title" onPress={()=>onSelectEpisode(episode.id)}><span className="lc-table-text">{episode.title||'未命名生产单'}</span></TooltipTrigger></Tooltip><small title={context}>{context}</small></div>
        <span role="cell" className="episode-stage-name">{episodeWorkflowLabel(summary)??stageLabels[episode.stage]}</span>
        <span role="cell"><EpisodeStatus state={state}/></span>
        <span role="cell"><time dateTime={episode.updated_at} title={formatDate(episode.updated_at)} aria-label={formatDate(episode.updated_at)}>{new Intl.DateTimeFormat('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(episode.updated_at))}</time></span>
        <span role="cell" className="episode-action-cell"><EpisodeActionsMenu artifactCount={count} blueprint={blueprintsById.get(episode.blueprint_version_id)} episode={episode} isArchivePending={isArchivePending(episode.id)} isDeletePending={isDeletePending(episode.id)} isTitlePending={isTitlePending(episode.id)} onDelete={onDelete} onPlanDelete={onPlanDelete} onOpenDirectory={onOpenDirectory} onSetArchived={onSetArchived} onUpdateTitle={onUpdateTitle}/></span>
      </div>;
    })}</div>
    {filteredEpisodes.length===0&&!isPageLoading?<div className="empty-state compact"><h2>{reviewOnly||catalogControls?.status==='review'?'当前没有待审核生产单':episodeVisibility==='archived'?'还没有已归档的生产单':'没有符合条件的生产单'}</h2><p>{catalogControls?.query?'试试其他关键词，或清除搜索。':'调整筛选条件，或新建生产单。'}</p>{catalogControls?.query&&<Button size="sm" color="secondary" onPress={()=>{setSearch('');catalogControls.onSearch('');}}>清除搜索</Button>}</div>:null}
    <footer className="episode-list-footer"><span className="summary-count">{total} 张生产单</span>{isPageLoading?<p role="status">正在读取生产单…</p>:<PaginationControls page={safePage} pageSize={pageSize} total={total} onPageChange={serverPage?.onPageChange??setPage}/>}</footer>
    </div>
  </div>;
}

export function ReviewWorkspace({ serverPage, accountsById, episodes, onSelectEpisode, selectedEpisode }: { serverPage?: ServerPage; accountsById: Map<string, Account>; episodes: Episode[]; onSelectEpisode: (id: string) => void; selectedEpisode: Episode | null }) {
  const reviewEpisodes = episodes.filter((episode) => !episode.archived_at && (reviewActionFor(episode.stage) || episode.stage === "production_ready"));
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const pageCount = Math.max(1, Math.ceil(reviewEpisodes.length / pageSize));
  const safePage = serverPage?.page ?? Math.min(page, pageCount);
  const pageItems = serverPage ? reviewEpisodes : reviewEpisodes.slice((safePage - 1) * pageSize, safePage * pageSize);
  useEffect(() => setPage((current) => Math.min(current, pageCount)), [pageCount]);
  return <><p className="muted-copy">审核决定会通过受控状态迁移写入审批与审计记录；Worker 的阻塞项会显示在右侧 Episode 详情中。</p><section className="review-queue" aria-label="待审核 Episode"><h2>待审核 Episode</h2>{reviewEpisodes.length ? <><div className="review-queue-list">{pageItems.map((episode) => <Button size="sm" color="tertiary" className={`review-queue-item ${selectedEpisode?.id === episode.id ? "is-selected" : ""}`} key={episode.id} onClick={() => onSelectEpisode(episode.id)} type="button"><strong>{episode.title}</strong><span>{accountsById.get(episode.account_id)?.name ?? "未知账号"} · {stageLabels[episode.stage]}</span></Button>)}</div><PaginationControls page={safePage} pageSize={pageSize} total={serverPage?.total ?? reviewEpisodes.length} onPageChange={serverPage?.onPageChange ?? setPage} /></> : <div className="empty-state compact"><h2>没有待审核 Episode</h2><p>Worker 将产物推进到审核阶段后，会在这里显示。</p></div>}</section></>;
}



export function PasswordForm({ isPending, onClose, onSubmit, identity }: { isPending: boolean; onClose: () => void; onSubmit: (password: string) => Promise<void>; identity?:ReactNode }) {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [formError, setFormError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isPending) return;
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

  const dialogRef = useDialogFocus(true, () => {if (!isPending) onClose();});
  return <div className="modal-backdrop" role="presentation"><div aria-label="登录与安全" aria-modal="true" className="modal-card episode-form-modal" ref={dialogRef} role="dialog"><form aria-label="登录与安全" className="owner-password-form" onSubmit={submit}><header><div><h2>登录与安全</h2><p>密码只用于登录，不会显示或保存在控制台记录中。</p></div><Button size="sm" color="tertiary" isDisabled={isPending} aria-label="关闭登录与安全" className="icon-button" onClick={onClose} type="button"><Icon name="Close" /></Button></header>{identity}<label>新密码<InputBase size="sm" isDisabled={isPending} aria-label="新密码" autoComplete="new-password" onChange={(event) => setPassword(event.target.value)} isRequired type="password" value={password} /></label><label>确认密码<InputBase size="sm" isDisabled={isPending} aria-label="确认密码" autoComplete="new-password" onChange={(event) => setConfirmation(event.target.value)} isRequired type="password" value={confirmation} /></label><div className="modal-actions"><Button size="sm" color="secondary" className="button button-secondary" isDisabled={isPending} onClick={onClose} type="button">取消</Button><Button size="sm" color="primary" className="button button-primary" isDisabled={isPending} type="submit">{isPending ? "保存中…" : "保存密码"}</Button></div>{formError ? <p className="form-error">{formError}</p> : null}</form></div></div>;
}

type IconName = NavigationItem | "Moon" | "Sun" | "Exit" | "Close" | "Play" | "PanelLeft" | "User" | "Edit" | "Delete" | "Video" | "Refresh";

const iconComponents: Record<IconName, LucideIcon> = { accounts: Users, episodes: Table2, operations: BarChart3, reviews: MessageSquare, Moon, Sun, Exit: LogOut, Close: X, Play, PanelLeft, User, Edit: Pencil, Delete: Trash2, Video, Refresh: RefreshCw };

export function Icon({ name }: { name: IconName }) {
  const IconComponent = iconComponents[name];
  return <IconComponent aria-hidden="true" className="icon" strokeWidth={1.8} />;
}
