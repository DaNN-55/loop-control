import { Archive,ArchiveRestore,ArrowDownWideNarrow,Bell,FolderOpen,KeyRound,Layers,MoreHorizontal,Plug,Search,ShieldCheck,SlidersHorizontal } from 'lucide-react';
import { Button } from '../ui/dan-ui/components/base/buttons/button';
import { Dropdown } from '../ui/dan-ui/components/base/dropdown/dropdown';
import { InputBase } from '../ui/dan-ui/components/base/input/input';
import { NativeSelect } from '../ui/dan-ui/components/base/select/select-native';
import { Tooltip,TooltipTrigger } from '../ui/dan-ui/components/base/tooltip/tooltip';
import { PopulatedFilterSelect } from '../ui/PopulatedFilterSelect';
import { AppliedFilters } from './AppliedFilters';
import { EpisodeDeletionScope,type DeletionFileScope } from './EpisodeDeletionScope';
import { EpisodeMetricsCells,MetricColumnHeader } from './EpisodeMetricsCells';
// Shared original workspace views. Data and authentication are supplied by each backend.
import { BarChart3,LogOut,MessageSquare,Moon,PanelLeft,Pencil,Play,RefreshCw,Sun,Table2,Trash2,User,Users,Video,X,type LucideIcon } from 'lucide-react';
import { useEffect,useId,useRef,useState,type FormEvent,type ReactNode } from 'react';
import { defaultEpisodePageSize,episodePageSizes,type CatalogSort,type EpisodeCatalog,type EpisodePageSize,type ServerPage } from '../episodes/episodeCatalogTypes';
import type { Database } from '../lib/database.types';
import { blueprintAssetRoot } from '../platform/blueprintPolicy';
import type { EpisodeStage } from '../platform/types';
import { ConfirmationModal,ConfirmationModalPresence } from '../ui/ConfirmationModal';
import { PaginationControls } from '../ui/PaginationControls';
import { useDialogFocus } from '../ui/useDialogFocus';
import './episode-list.css';
import { EpisodeStatus,episodeActionState,episodeWorkflowLabel } from './episodePresentation';
type Row<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Row'];
type Account=Row<'accounts'>;type Episode=Row<'episodes'>;type Blueprint=Row<'account_blueprint_versions'>;type Artifact=Row<'artifacts'>;type Series=Row<'series'>;type SeriesVersion=Row<'series_versions'>;
export type NavigationItem='accounts'|'episodes'|'operations'|'reviews';
type EpisodeVisibility='active'|'archived'|'all';type EpisodeAction='rename'|'archive'|null;type EpisodeWithArchive=Episode&{archived_at?:string|null};
export interface EpisodeDeletionPlan extends DeletionFileScope {path:string;paths?:string[];revision:string;confirmation:string}
interface ReviewAction{approveStage:EpisodeStage;requestChangesStage:EpisodeStage}
export const navigation: Array<{ id: NavigationItem; label: string }> = [
  { id: "operations", label: "系列运营" },
  { id: "episodes", label: "生产单" },
  { id: "accounts", label: "账号" },
];

export function OwnerMenu({ onOpenSettings, onOpenCleanup, onOpenSecrets, onOpenPreferences, onOpenNotifications, onOpenConnections, displayName, avatar, email, onSignOut, onBeforeOpen, isActive=false }: { displayName?: string; avatar?: string | null; email?: string; onOpenPreferences?: () => void; onOpenNotifications?: () => void; onOpenConnections?: () => void; isActive?: boolean; onBeforeOpen?: (trigger: HTMLButtonElement | null) => void; onOpenSettings: () => void;   onOpenCleanup?: () => void; onOpenSecrets?: () => void; onSignOut: () => void }) {
  const trigger = useRef<HTMLButtonElement>(null);
  const select = (action: () => void) => {onBeforeOpen?.(trigger.current); trigger.current?.focus(); action();};
  return <div className="owner-menu"><Dropdown.Root><Button size="sm" color="tertiary" aria-label="所有者设置" ref={trigger} className="owner-menu-trigger" data-active={isActive||undefined} type="button">{avatar?<img className="owner-menu-avatar" src={avatar} alt=""/>:<Icon name="User" />}</Button><Dropdown.Popover className="dan-ui product-ui"><Dropdown.Menu aria-label="所有者设置"><Dropdown.Section>{displayName||email?<Dropdown.SectionHeader><div className="owner-profile-summary"><strong>{displayName||email}</strong>{displayName&&email?<span>{email}</span>:null}</div></Dropdown.SectionHeader>:null}{onOpenPreferences&&<Dropdown.Item icon={SlidersHorizontal} id="preferences" onAction={()=>select(onOpenPreferences)}>个人偏好</Dropdown.Item>}{onOpenNotifications&&<Dropdown.Item icon={Bell} id="notifications" onAction={()=>select(onOpenNotifications)}>通知</Dropdown.Item>}</Dropdown.Section>{(onOpenPreferences || onOpenNotifications) && <Dropdown.Separator/>}<Dropdown.Section><Dropdown.Item icon={ShieldCheck} id="security" onAction={()=>select(onOpenSettings)}>登录与安全</Dropdown.Item>{onOpenCleanup&&<Dropdown.Item icon={Trash2} id="cleanup" onAction={()=>select(onOpenCleanup)}>文件清理</Dropdown.Item>}{onOpenConnections&&<Dropdown.Item icon={Plug} id="connections" onAction={()=>select(onOpenConnections)}>连接配置</Dropdown.Item>}{onOpenSecrets&&<Dropdown.Item icon={KeyRound} id="secrets" onAction={()=>select(onOpenSecrets)}>密钥管理</Dropdown.Item>}</Dropdown.Section><Dropdown.Separator/><Dropdown.Section><Dropdown.Item icon={LogOut} id="logout" onAction={()=>select(onSignOut)}>退出登录</Dropdown.Item></Dropdown.Section></Dropdown.Menu></Dropdown.Popover></Dropdown.Root></div>;
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

export function formatDate(source: string) {
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(source));
}

export function episodeIsArchived(episode: Episode): boolean {
  return Boolean((episode as EpisodeWithArchive).archived_at);
}

export function reviewActionFor(stage: EpisodeStage): ReviewAction | null {
  return reviewActions[stage] ?? null;
}

function EpisodeActionsMenu({ artifactCount, blueprint, episode, isArchivePending, isTitlePending, onOpenDelete, onOpenDirectory, onMoveCollection, onSetArchived, onUpdateTitle }: { artifactCount?:number; blueprint: Blueprint | undefined; episode: Episode; isArchivePending: boolean; isTitlePending: boolean; onOpenDelete?: ()=>void; onOpenDirectory?: (episodeId:string)=>Promise<void>; onMoveCollection?: (episodeId:string)=>void; onSetArchived: (episodeId: string, archived: boolean) => Promise<void>; onUpdateTitle: (episodeId: string, title: string) => Promise<void> }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [action, setAction] = useState<EpisodeAction>(null);
  const archived = episodeIsArchived(episode);
  function openAction(nextAction: EpisodeAction) { setMenuOpen(false); setAction(nextAction); }
  return <div className="episode-actions" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}><Dropdown.Root isOpen={menuOpen} onOpenChange={setMenuOpen}><Button size="sm" color="tertiary" aria-label={`生产单操作：${episode.title || "未命名生产单"}`} className="episode-actions-trigger" type="button"><MoreHorizontal aria-hidden="true" size={20}/></Button><Dropdown.Popover className="dan-ui product-ui episode-actions-popover" placement="bottom end" offset={8}><div className="episode-menu-summary"><strong title={episode.title||'未命名生产单'}>{episode.title||'未命名生产单'}</strong><dl><div><dt>编号</dt><dd><code title={episode.id}>{episode.id}</code></dd></div><div><dt>蓝图</dt><dd>v{blueprint?.version ?? "—"}</dd></div>{artifactCount!==undefined&&<div><dt>产物</dt><dd>{artifactCount} 项</dd></div>}</dl></div><Dropdown.Menu aria-label="生产单操作"><Dropdown.Section aria-label="管理操作">{onOpenDirectory&&<Dropdown.Item icon={FolderOpen} id="open-directory" onAction={()=>{setMenuOpen(false);void onOpenDirectory(episode.id);}}>打开本地文件夹</Dropdown.Item>}{onMoveCollection&&<Dropdown.Item icon={Layers} id="move-collection" onAction={()=>{setMenuOpen(false);onMoveCollection?.(episode.id);}} isDisabled={!onMoveCollection}>调整系列</Dropdown.Item>}<Dropdown.Item icon={Pencil} id="rename" onAction={() => openAction("rename")}>重命名</Dropdown.Item><Dropdown.Item icon={archived?ArchiveRestore:Archive} id="archive" onAction={() => openAction("archive")}>{archived ? "恢复" : "归档"}</Dropdown.Item></Dropdown.Section>{onOpenDelete&&<><Dropdown.Separator/><Dropdown.Section aria-label="删除操作"><Dropdown.Item icon={Trash2} id="delete" className="menu-item-danger" onAction={()=>{setMenuOpen(false);onOpenDelete();}}>{archived?"永久删除":"删除生产单"}</Dropdown.Item></Dropdown.Section></>}</Dropdown.Menu></Dropdown.Popover></Dropdown.Root>{action === "rename" ? <EpisodeRenameModal episode={episode} isPending={isTitlePending} onClose={() => setAction(null)} onSave={onUpdateTitle} /> : null}{action === "archive" ? <EpisodeArchiveModal archived={archived} isPending={isArchivePending} onClose={() => setAction(null)} onSave={onSetArchived} episodeId={episode.id} title={episode.title||"未命名生产单"} /> : null}</div>;
}

function EpisodeRenameModal({ episode, isPending, onClose, onSave }: { episode: Episode; isPending: boolean; onClose: () => void; onSave: (episodeId: string, title: string) => Promise<void> }) {
  const dialogRef = useDialogFocus<HTMLFormElement>(true, () => { if (!isPending) onClose(); });

  const [title, setTitle] = useState(episode.title);
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); await onSave(episode.id, title); onClose(); }
  return <div className="modal-backdrop"  role="dialog" aria-modal="true" aria-label="重命名生产单"><form ref={dialogRef} aria-label="重命名生产单" className="modal-card" onSubmit={(event) => void submit(event)}><header><div><h2>重命名生产单</h2><p>只修改管理标题，不会改变已固定材料或任务。</p></div><Button size="sm" color="tertiary" aria-label="关闭重命名生产单" className="icon-button" onClick={onClose} type="button"><Icon name="Close" /></Button></header><label>新标题<InputBase size="sm" aria-label="新生产单标题" autoFocus onChange={(event) => setTitle(event.target.value)} value={title} /></label><div className="modal-actions"><Button size="sm" color="secondary" className="button button-secondary" onClick={onClose} type="button">取消</Button><Button size="sm" color="primary" className="button button-primary" isDisabled={isPending || title === episode.title} type="submit">{isPending ? "保存中…" : "保存新标题"}</Button></div></form></div>;
}

function EpisodeArchiveModal({ archived, episodeId, title, isPending, onClose, onSave }: { archived: boolean; episodeId: string; title:string; isPending: boolean; onClose: () => void; onSave: (episodeId: string, archived: boolean) => Promise<void> }) {
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
  return <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={archived ? "恢复生产单" : "归档生产单"}><form ref={dialogRef} aria-label={archived ? "恢复生产单" : "归档生产单"} className="modal-card episode-archive-modal" onSubmit={(event) => void submit(event)}><header><div><h2>{archived ? "恢复生产单" : "归档生产单"}</h2><p>{archived ? `「${title}」将重新出现在未归档列表。` : `「${title}」将移出未归档列表。保留数据和本地文件，可随时恢复。`}</p></div><Button size="sm" color="tertiary" aria-label="关闭归档操作" isDisabled={pending} className="icon-button" onClick={onClose} type="button"><Icon name="Close" /></Button></header>{error&&<p className="form-error" role="alert">{error}</p>}<div className="modal-actions"><Button size="sm" color="secondary" className="button button-secondary" isDisabled={pending} onClick={onClose} type="button">取消</Button><Button size="sm" color="primary" className="button button-primary" isDisabled={pending} type="submit">{pending ? "处理中…" : archived ? "确认恢复" : "确认归档"}</Button></div></form></div>;
}

function EpisodeDeleteModal({ assetRoot, episode, isPending, onClose, onArchive, onDelete, onPlanDelete }: { assetRoot: string; episode: Episode; isPending: boolean; onClose: () => void; onArchive: (id:string)=>Promise<void>; onDelete: (episodeId: string, confirmation: string, plan?: EpisodeDeletionPlan) => Promise<void>; onPlanDelete?: (episodeId:string)=>Promise<EpisodeDeletionPlan> }) {
  const [archived,setArchived]=useState(episodeIsArchived(episode));
  const dialogRef = useDialogFocus<HTMLFormElement>(archived, () => { if (!isPending && !submitting) onClose(); });

  const [confirmation, setConfirmation] = useState("");
  const [plan, setPlan] = useState<EpisodeDeletionPlan|null>(null);
  const [loading, setLoading] = useState(Boolean(onPlanDelete));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!onPlanDelete || !archived) return;
    let active = true;
    setLoading(true); setError(""); setPlan(null); setConfirmation("");
    void onPlanDelete(episode.id).then(value => { if (active) setPlan(value); }).catch(reason => { if (active) setError(reason instanceof Error ? reason.message : "无法读取删除范围，请重试。"); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [episode.id, onPlanDelete, attempt, archived]);
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
  async function archiveForDeletion(){
    if(pending)return;
    setSubmitting(true);setError("");
    try{await onArchive(episode.id);setArchived(true);}
    catch(reason){setError(reason instanceof Error?reason.message:"归档失败，请重试。");}
    finally{setSubmitting(false);}
  }
  if(!archived)return <ConfirmationModal title="删除生产单" confirmLabel="归档并继续" isPending={pending} onCancel={onClose} onConfirm={archiveForDeletion}>
    <p>先归档「{episode.title||"未命名生产单"}」，再核对文件范围并确认永久删除。</p>
    {error&&<p role="alert">{error}</p>}
  </ConfirmationModal>;
  return <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="永久删除生产单">
    <form ref={dialogRef} aria-label="永久删除生产单" className="modal-card modal-card-danger episode-deletion-modal" onSubmit={event => void submit(event)}>
      <header>
        <div><h2>永久删除生产单</h2><p>将永久删除「{episode.title||"未命名生产单"}」的记录和下方列出的独占文件。删除后无法恢复。</p></div>
        <Button size="sm" color="tertiary" aria-label="关闭永久删除生产单" className="icon-button" isDisabled={pending} onClick={onClose} type="button"><Icon name="Close" /></Button>
      </header>
      <section className="episode-deletion-body" aria-label="删除范围" tabIndex={localEpisodePath ? 0 : undefined}>
        {loading ? <p role="status">正在检查删除范围…</p> : localEpisodePath ? <>
          <EpisodeDeletionScope files={plan?.files} preserved={plan?.preserved}/>
          <section aria-label="已核查位置">
            <h3>已核查位置</h3>
            <ul className="episode-deletion-paths" aria-label="已核查的生产单目录">
              {deletionPaths.map(path => <li key={path}><code>{path}</code></li>)}
            </ul>
          </section>
          <p>只清理已确认文件及身份相符的空目录。共享、手放和未知资料保留。</p>
        </> : null}
        {error && <p className="form-error" role="alert">{error}</p>}
        {onPlanDelete && !loading && !plan && <Button size="sm" color="secondary" onClick={() => setAttempt(value => value + 1)} type="button">重新检查删除范围</Button>}
      </section>
      <footer className="episode-deletion-footer">
        <label>输入“{confirmationTarget}”确认删除
          <InputBase size="sm" aria-label="永久删除确认文本" autoFocus isDisabled={loading || pending || Boolean(onPlanDelete && !plan)} onChange={event => setConfirmation(event.target.value)} placeholder={confirmationTarget} value={confirmation} />
        </label>
        <div className="modal-actions">
          <Button size="sm" color="secondary" className="button button-secondary" isDisabled={pending} onClick={onClose} type="button">取消</Button>
          <Button size="sm" color="primary-destructive" className="button button-danger" isDisabled={pending || loading || Boolean(onPlanDelete && !plan) || confirmation !== confirmationTarget} type="submit">{pending ? "删除中…" : "确认永久删除"}</Button>
        </div>
      </footer>
    </form>
  </div>;
}

const episodeStatusFilters=[['all','全部'],['review','待审核'],['running','制作中'],['blocked','需处理'],['done','已完成']] as const;

export function EpisodeWorkspace({ catalogControls, metrics, operationRows, actions, reviewOnly = false, isPageLoading = false, serverPage, artifactCounts, accounts, accountsById, artifacts, blueprintsById, episodeVisibility, episodes, filter, onDelete = async () => {}, onPlanDelete, onOpenDirectory, onMoveCollection, collections, seriesEpisodeCounts, filterAccountCounts, visibilityCounts, onEpisodeVisibilityChange, onFilter, onSetArchived = async () => {}, onSeriesFilter, onSelectEpisode, onUpdateTitle = async () => {}, series, seriesById, seriesFilter, seriesVersionsById, selectedEpisode, isArchivePending = () => false, isDeletePending = () => false, isTitlePending = () => false }: { metrics?:EpisodeCatalog["metrics"];catalogControls?: {query:string;status:"all"|"review"|"running"|"blocked"|"done";sort:CatalogSort;counts?:Record<string,number>;onSearch:(query:string)=>void;onReset?:()=>void;onClearAccount?:()=>void;onStatus:(status:"all"|"review"|"running"|"blocked"|"done")=>void;onSort:(sort:CatalogSort)=>void};operationRows?:EpisodeCatalog["operationRows"];collections?:EpisodeCatalog["collections"];seriesEpisodeCounts?:EpisodeCatalog["seriesEpisodeCounts"];filterAccountCounts?:Record<string,number>;visibilityCounts?:Record<string,number>;actions?: ReactNode; reviewOnly?: boolean; isPageLoading?: boolean; serverPage?: ServerPage; artifactCounts?: Record<string, number>; accounts: Account[]; accountsById: Map<string, Account>; artifacts: Artifact[]; blueprintsById: Map<string, Blueprint>; episodeVisibility: EpisodeVisibility; episodes: Episode[]; filter: string; isArchivePending?: (episodeId: string) => boolean; isDeletePending?: (episodeId: string) => boolean; isTitlePending?: (episodeId: string) => boolean; onDelete?: (episodeId: string, confirmation: string, plan?: EpisodeDeletionPlan) => Promise<void>; onPlanDelete?: (episodeId:string)=>Promise<EpisodeDeletionPlan>; onOpenDirectory?: (episodeId:string)=>Promise<void>; onMoveCollection?: (episodeId:string)=>void; onEpisodeVisibilityChange: (value: EpisodeVisibility) => void; onFilter: (value: string) => void; onSetArchived?: (episodeId: string, archived: boolean) => Promise<void>; onSeriesFilter: (value: string) => void; onSelectEpisode: (id: string) => void; onUpdateTitle?: (episodeId: string, title: string) => Promise<void>; series: Series[]; seriesById: Map<string, Series>; seriesFilter: string; seriesVersionsById: Map<string, SeriesVersion>; selectedEpisode: Episode | null }) {
  const [deletionEpisode,setDeletionEpisode]=useState<Episode|null>(null);
  const [page, setPage] = useState(1);
  const [search,setSearch]=useState(catalogControls?.query??'');
  const listId=useId();
  const searchInput=useRef<HTMLInputElement>(null);
  useEffect(()=>setSearch(catalogControls?.query??''),[catalogControls?.query]);
  const [localPageSize,setLocalPageSize]=useState<EpisodePageSize>(defaultEpisodePageSize);
  const pageSize=serverPage?.pageSize??localPageSize;
  function changePageSize(value:string){
    const size=episodePageSizes.find(option=>String(option)===value);
    if(size===undefined)return;
    if(serverPage?.onPageSizeChange)serverPage.onPageSizeChange(size);
    else {setLocalPageSize(size);setPage(1);}
  }
  const filteredEpisodes = episodes.filter((episode) => episodeVisibility === "all" || (episodeVisibility === "archived" ? episodeIsArchived(episode) : !episodeIsArchived(episode)));
  const seriesCounts=seriesEpisodeCounts??filteredEpisodes.filter(episode=>filter==='全部账号'||episode.account_id===filter).reduce<Record<string,number>>((counts,episode)=>{
    const collection=collections?.[episode.id],version=episode.series_version_id?seriesVersionsById.get(episode.series_version_id):null;
    const key=collection?collection.seriesId??'unassigned':version&&seriesById.has(version.series_id)?version.series_id:episode.series_version_id?'unavailable':'unassigned';
    counts[key]=(counts[key]??0)+1;return counts;
  },{});
  const seriesOptions=[{id:'unassigned',name:'未分系列'},{id:'unavailable',name:'旧系列不可用'},...series];
  const accountFilterCounts=filterAccountCounts??(serverPage?undefined:Object.fromEntries(accounts.map(account=>[account.id,filteredEpisodes.filter(episode=>episode.account_id===account.id).length])));
  const archiveCounts=visibilityCounts??(serverPage?undefined:{active:episodes.filter(e=>(filter==='全部账号'||e.account_id===filter)&&!episodeIsArchived(e)).length,archived:episodes.filter(e=>(filter==='全部账号'||e.account_id===filter)&&episodeIsArchived(e)).length});
  const hasNonSearchFilters = Boolean((catalogControls && catalogControls.status !== "all") || (catalogControls && catalogControls.sort !== "updated") || filter !== "全部账号" || seriesFilter !== "全部系列" || episodeVisibility !== "active");
  const hasFilters = Boolean(search || catalogControls?.query || hasNonSearchFilters);
  function clearSearch() {
    setSearch('');catalogControls?.onSearch('');
  }
  const activeFilters = catalogControls&&!reviewOnly ? [
    catalogControls.query&&{label:'搜索',value:catalogControls.query,clear:clearSearch},
    catalogControls.status!=='all'&&{label:'状态',value:episodeStatusFilters.find(([key])=>key===catalogControls.status)?.[1],clear:()=>catalogControls.onStatus('all')},
    filter!=='全部账号'&&{label:'账号',value:accountsById.get(filter)?.name??'账号不可用',clear:catalogControls.onClearAccount??(()=>onFilter('全部账号'))},
    seriesFilter!=='全部系列'&&{label:'系列',value:seriesOptions.find(option=>option.id===seriesFilter)?.name??'系列不可用',clear:()=>onSeriesFilter('全部系列')},
    episodeVisibility!=='active'&&{label:'归档',value:episodeVisibility==='archived'?'已归档':'全部范围',clear:()=>onEpisodeVisibilityChange('active')},
  ].filter(filter=>typeof filter==='object') : [];
  function resetFilters() {
    setSearch("");setPage(1);
    if (catalogControls?.onReset) { catalogControls.onReset(); return; }
    catalogControls?.onSearch("");catalogControls?.onStatus("all");catalogControls?.onSort("updated");
    onFilter("全部账号");onSeriesFilter("全部系列");onEpisodeVisibilityChange("active");
  }
  const pageCount = Math.max(1, Math.ceil(filteredEpisodes.length / pageSize));
  const safePage = serverPage?.page ?? Math.min(page, pageCount);
  const total = serverPage?.total ?? filteredEpisodes.length;
  const pageItems = isPageLoading ? [] : serverPage ? filteredEpisodes : filteredEpisodes.slice((safePage - 1) * pageSize, safePage * pageSize);
  useEffect(() => setPage(1), [episodeVisibility, filter, seriesFilter]);
  useEffect(() => setPage((current) => Math.min(current, pageCount)), [pageCount]);
  return <div className="episode-list-workspace">
    <div className="episode-list-header">{catalogControls&&<div className="episode-status-tabs" role="tablist" aria-label="制作状态筛选">{episodeStatusFilters.map(([key,label],index,tabs)=><button type="button" role="tab" id={`${listId}-${key}`} aria-controls={`${listId}-panel`} tabIndex={catalogControls.status===key?0:-1} onKeyDown={event=>{const offset=event.key==='ArrowRight'?1:event.key==='ArrowLeft'?-1:0;const target=event.key==='Home'?0:event.key==='End'?tabs.length-1:offset?(index+offset+tabs.length)%tabs.length:-1;if(target<0)return;event.preventDefault();catalogControls.onStatus(tabs[target][0]);event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role=tab]')[target]?.focus();}} aria-label={label} aria-selected={catalogControls.status===key} className={catalogControls.status===key?'is-active':''} key={key} onClick={()=>catalogControls.onStatus(key)}>{label}{catalogControls.counts?.[key]!==undefined&&<span aria-hidden="true">{catalogControls.counts[key]}</span>}</button>)}</div>}{catalogControls&&actions}</div>
    <div role={catalogControls?"tabpanel":undefined} id={`${listId}-panel`} aria-labelledby={catalogControls?`${listId}-${catalogControls.status}`:undefined}><div className="filters episode-list-toolbar">
      {catalogControls&&<form className="episode-search" role="search" aria-label="搜索生产单" onSubmit={event=>{event.preventDefault();const query=search.trim();setSearch(query);catalogControls.onSearch(query);}}><Search aria-hidden="true" size={16}/><input ref={searchInput} aria-label="搜索标题或编号" placeholder="搜索标题或编号" maxLength={200} value={search} onChange={event=>setSearch(event.target.value)}/>{search&&<button aria-label="清除搜索" type="button" onClick={clearSearch}><X aria-hidden="true" size={14}/></button>}<button className="episode-search-submit" type="submit">搜索</button></form>}
      <label><span>账号</span><PopulatedFilterSelect icon={Users} size="sm" disabled={isPageLoading} value={filter} onValueChange={onFilter} allValue="全部账号" counts={accountFilterCounts} options={[{value:"全部账号",label:"全部账号"},...accounts.map(account=>({value:account.id,label:account.name}))]}/></label>
      <label><span>系列</span><PopulatedFilterSelect icon={Layers} size="sm" disabled={isPageLoading} value={seriesFilter} onValueChange={onSeriesFilter} allValue="全部系列" counts={seriesCounts} options={[{value:"全部系列",label:"全部系列"},...seriesOptions.map(candidate=>({value:candidate.id,label:candidate.name}))]}/></label>
      {!reviewOnly&&<label><span>归档范围</span><PopulatedFilterSelect icon={Archive} size="sm" aria-label="归档范围" disabled={isPageLoading} value={episodeVisibility} onValueChange={value=>onEpisodeVisibilityChange(value as EpisodeVisibility)} allValue="all" counts={archiveCounts} options={[{value:"active",label:"未归档"},{value:"archived",label:"已归档"},{value:"all",label:"全部范围"}]}/></label>}
      {catalogControls&&<NativeSelect icon={ArrowDownWideNarrow} size="sm" aria-label="生产单排序" value={catalogControls.sort} onChange={event=>catalogControls.onSort(event.target.value as CatalogSort)} options={[{value:'updated',label:'最近更新'},{value:'oldest',label:'最早更新'},{value:'title',label:'标题顺序'},{value:'cost_desc',label:'花费从高到低'},{value:'cost_asc',label:'花费从低到高'}]}/>}
      {hasNonSearchFilters && activeFilters.length===0 && <Button size="sm" color="tertiary" onPress={resetFilters}>清空筛选</Button>}
      {!catalogControls&&actions}
    </div>
    <AppliedFilters filters={activeFilters} onReset={resetFilters} restoreFocus={()=>searchInput.current?.focus()}/>
    <div className="episode-table" role="table" aria-label="生产单"><div className="table-row table-header" role="row">{['生产单','当前阶段','状态','最近更新'].map(label=><span key={label} role="columnheader">{label}</span>)}<span role="columnheader"><MetricColumnHeader label="花费（元）" description="实际为已记录费用；估算为尚无实际金额的调用，可按当前价格补算。预留单独追踪，不计入花费。按实际与估算之和排序；未知费用不按零计算。"/></span><span role="columnheader"><MetricColumnHeader label="后台任务用时" description="累计该生产单的后台任务运行时间。排队、人工操作和审核等待不计入，并行任务重叠时段只计一次。"/></span><span role="columnheader"><MetricColumnHeader label="生成次数" description="按已开始的生成尝试计数，含未采用候选和失败重试；不含排队、上传和本地编辑。"/></span><span role="columnheader">操作</span></div>
    {pageItems.map(episode=>{const seriesVersion=episode.series_version_id?seriesVersionsById.get(episode.series_version_id):null;const account=accountsById.get(episode.account_id);const count=artifactCounts?.[episode.id]??artifacts.filter(a=>a.episode_id===episode.id).length;const summary=operationRows?.find(row=>row.episodeId===episode.id);const state=episodeActionState(episode,summary);const collection=collections?.[episode.id];const context=[account?.name??'未知账号',collection?(collection.seriesId?seriesById.get(collection.seriesId)?.name??'系列不可用':'未分系列'):seriesVersion?`${seriesById.get(seriesVersion.series_id)?.name??'未知系列'} v${seriesVersion.version}`:'未关联系列'].join(' · ');
      return <div className={`table-row episode-row ${selectedEpisode?.id===episode.id?'is-selected':''}`} key={episode.id} onClick={()=>onSelectEpisode(episode.id)} onKeyDown={event=>{if(event.target===event.currentTarget&&(event.key==='Enter'||event.key===' ')){event.preventDefault();onSelectEpisode(episode.id);}}} role="row" tabIndex={0}>
        <div className="episode-name" role="cell"><Tooltip title={episode.title||'未命名生产单'} className="dan-ui dan-ui-tooltip"><TooltipTrigger className="lc-table-name lc-table-title" data-episode-open={episode.id} onPress={()=>onSelectEpisode(episode.id)}><span className="lc-table-text">{episode.title||'未命名生产单'}</span></TooltipTrigger></Tooltip><small title={context}>{context}</small></div>
        <span role="cell" className="episode-stage-name">{episodeWorkflowLabel(summary)??stageLabels[episode.stage]}</span>
        <span role="cell"><EpisodeStatus state={state}/></span>
        <span role="cell"><time dateTime={episode.updated_at} title={formatDate(episode.updated_at)} aria-label={formatDate(episode.updated_at)}>{new Intl.DateTimeFormat('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(episode.updated_at))}</time></span>
        <EpisodeMetricsCells metrics={metrics?.[episode.id]}/>
        <span role="cell" className="episode-action-cell"><EpisodeActionsMenu artifactCount={count} blueprint={blueprintsById.get(episode.blueprint_version_id)} episode={episode} isArchivePending={isArchivePending(episode.id)} isTitlePending={isTitlePending(episode.id)} onOpenDelete={onPlanDelete||episodeIsArchived(episode)?()=>setDeletionEpisode(episode):undefined} onOpenDirectory={onOpenDirectory} onMoveCollection={onMoveCollection} onSetArchived={onSetArchived} onUpdateTitle={onUpdateTitle}/></span>
      </div>;
    })}</div>
    {filteredEpisodes.length===0&&!isPageLoading?<div className="empty-state compact"><h2>{hasFilters?'没有符合条件的生产单':reviewOnly?'当前没有待审核生产单':'还没有生产单'}</h2><p>{catalogControls?.query?'试试其他关键词，或清除搜索。':'调整筛选条件，或新建生产单。'}</p></div>:null}
    <footer className="episode-list-footer">
      {isPageLoading ? <p role="status">正在读取生产单…</p> :
        <PaginationControls page={safePage} pageSize={pageSize} total={total} onPageChange={serverPage?.onPageChange??setPage}
          pageSizeControl={!reviewOnly&&(!serverPage||serverPage.onPageSizeChange) ? <label className="episode-page-size">
            <span>每页</span>
            <NativeSelect icon={null} size="sm" aria-label="每页生产单条数" value={String(pageSize)} onChange={event=>changePageSize(event.target.value)}>
              {episodePageSizes.map(size=><option key={size} value={size}>{size} 条</option>)}
            </NativeSelect>
          </label> : undefined}/>}
    </footer>
    </div>
    <ConfirmationModalPresence>{deletionEpisode&&<EpisodeDeleteModal assetRoot={blueprintAssetRoot(blueprintsById.get(deletionEpisode.blueprint_version_id)?.policy??{})} episode={deletionEpisode} isPending={isDeletePending(deletionEpisode.id)||isArchivePending(deletionEpisode.id)} onClose={()=>setDeletionEpisode(null)} onArchive={id=>onSetArchived(id,true)} onDelete={onDelete} onPlanDelete={onPlanDelete}/>}</ConfirmationModalPresence>
  </div>;
}



export function PasswordForm({ isPending, onClose, onSubmit, identity }: { isPending: boolean; onClose: () => void; onSubmit: (password: string) => Promise<void>; identity?:ReactNode }) {
  const id=useId(),passwordRef=useRef<HTMLInputElement>(null),confirmationRef=useRef<HTMLInputElement>(null),submitting=useRef(false);
  const [saving,setSaving]=useState(false),pending=isPending||saving;
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [formError, setFormError] = useState("");
  const [invalidField,setInvalidField]=useState<'password'|'confirmation'|null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending||submitting.current) return;
    if (password.length < 12 || password.length > 1024) {
      setFormError("请设置至少 12 位、最多 1024 位的密码。");setInvalidField('password');passwordRef.current?.focus();
      return;
    }
    if (password !== confirmation) {
      setFormError("两次输入的密码不一致。");setInvalidField('confirmation');confirmationRef.current?.focus();
      return;
    }
    setFormError("");setInvalidField(null);
    submitting.current=true;setSaving(true);
    try{await onSubmit(password);}catch(error){setFormError(error instanceof Error?error.message:'密码保存失败，请重试。');}
    finally{submitting.current=false;setSaving(false);}
  }

  const dialogRef = useDialogFocus(true, () => {if (!pending) onClose();});
  return <div className="modal-backdrop" role="presentation"><div aria-label="登录与安全" aria-modal="true" className="modal-card episode-form-modal" ref={dialogRef} role="dialog"><form aria-label="登录与安全" className="owner-password-form" aria-describedby={formError&&!invalidField?id+'-error':undefined} onSubmit={submit}><header><div><h2>登录与安全</h2><p>密码用于本机身份验证，包括登录、查看和复制密钥。</p></div><Button size="sm" color="tertiary" isDisabled={pending} aria-label="关闭登录与安全" className="icon-button" onClick={onClose} type="button"><Icon name="Close" /></Button></header>{identity}<label>新密码<InputBase size="sm" ref={passwordRef} isDisabled={pending} aria-label="新密码" passwordVisibilityLabel="新密码" autoComplete="new-password" aria-describedby={[id+'-rule',invalidField==='password'?id+'-error':null].filter(Boolean).join(' ')} aria-invalid={invalidField==='password'||undefined} isInvalid={invalidField==='password'} onChange={(event) => {setPassword(event.target.value);if(invalidField==='password'){setInvalidField(null);setFormError('');}}} isRequired maxLength={1024} type="password" value={password} /><span id={id+'-rule'} className="form-hint">至少 12 位，最多 1024 位。</span></label><label>确认密码<InputBase size="sm" ref={confirmationRef} isDisabled={pending} aria-label="确认密码" passwordVisibilityLabel="确认密码" autoComplete="new-password" aria-describedby={invalidField==='confirmation'?id+'-error':undefined} aria-invalid={invalidField==='confirmation'||undefined} isInvalid={invalidField==='confirmation'} onChange={(event) => {setConfirmation(event.target.value);if(invalidField==='confirmation'){setInvalidField(null);setFormError('');}}} isRequired maxLength={1024} type="password" value={confirmation} /></label>{formError ? <p id={id+'-error'} role="alert" className="form-error">{formError}</p> : null}<div className="modal-actions"><Button size="sm" color="secondary" className="button button-secondary" isDisabled={pending} onClick={onClose} type="button">取消</Button><Button size="sm" color="primary" className="button button-primary" isDisabled={pending} type="submit">{pending ? "保存中…" : "保存密码"}</Button></div></form></div></div>;
}

type IconName = NavigationItem | "Moon" | "Sun" | "Exit" | "Close" | "Play" | "PanelLeft" | "User" | "Edit" | "Delete" | "Video" | "Refresh";

const iconComponents: Record<IconName, LucideIcon> = { accounts: Users, episodes: Table2, operations: BarChart3, reviews: MessageSquare, Moon, Sun, Exit: LogOut, Close: X, Play, PanelLeft, User, Edit: Pencil, Delete: Trash2, Video, Refresh: RefreshCw };

export function Icon({ name }: { name: IconName }) {
  const IconComponent = iconComponents[name];
  return <IconComponent aria-hidden="true" className="icon" strokeWidth={1.8} />;
}
