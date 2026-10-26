// Shared original workspace views. Data and authentication are supplied by each backend.
import {useState,useEffect,type FormEvent,type ReactNode} from 'react';
import {BarChart3,LogOut,MessageSquare,Moon,PanelLeft,Pencil,Play,Sun,Table2,Trash2,User,Users,Video,X,type LucideIcon} from 'lucide-react';
import type {Database} from '../lib/database.types';
import type {EpisodeStage} from '../platform/types';
import type {ServerPage} from '../episodes/episodeCatalogTypes';
import {blueprintAssetRoot} from '../platform/blueprintPolicy';
import {accountIdentityColor,accountIdentityInitials} from '../platform/accountIdentity';
import {PaginationControls} from '../ui/PaginationControls';
type Row<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Row'];
type Account=Row<'accounts'>;type Episode=Row<'episodes'>;type Blueprint=Row<'account_blueprint_versions'>;type Artifact=Row<'artifacts'>;type Series=Row<'series'>;type SeriesVersion=Row<'series_versions'>;
export type NavigationItem='accounts'|'episodes'|'operations'|'reviews';
type EpisodeVisibility='active'|'archived'|'all';type EpisodeAction='rename'|'archive'|'delete'|null;type EpisodeWithArchive=Episode&{archived_at?:string|null};
interface ReviewAction{approveStage:EpisodeStage;requestChangesStage:EpisodeStage}
export const navigation: Array<{ id: NavigationItem; label: string }> = [
  { id: "operations", label: "系列运营" },
  { id: "episodes", label: "生产单" },
  { id: "reviews", label: "审核" },
  { id: "accounts", label: "账号" },
];

export function NavigationButtons({ activeNavigation, badges = {}, onSelect }: { activeNavigation: NavigationItem; badges?: Partial<Record<NavigationItem, number>>; onSelect: (item: NavigationItem) => void }) {
  return <>{navigation.map((item) => <button aria-current={activeNavigation === item.id ? "page" : undefined} aria-label={item.label} className={`navigation-item ${activeNavigation === item.id ? "is-active" : ""}`} key={item.id} onClick={() => onSelect(item.id)} type="button"><Icon name={item.id} /><span className="navigation-label">{item.label}</span>{badges[item.id] ? <span aria-label={`${badges[item.id]} 个待处理`} className="navigation-badge">{badges[item.id]}</span> : null}</button>)}</>;
}

export function OwnerMenu({ onOpenSettings, onSignOut }: { onOpenSettings: () => void; onSignOut: () => void }) {
  const [isOpen, setIsOpen] = useState(false);
  return <div className="owner-menu"><button aria-expanded={isOpen} aria-haspopup="menu" aria-label="所有者设置" className="owner-menu-trigger" onClick={() => setIsOpen((current) => !current)} type="button"><Icon name="User" /></button>{isOpen ? <div className="owner-menu-popover" role="menu"><button onClick={() => { setIsOpen(false); onOpenSettings(); }} role="menuitem" type="button">所有者设置</button><button onClick={() => { setIsOpen(false); onSignOut(); }} role="menuitem" type="button">退出登录</button></div> : null}</div>;
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
  production_ready: "媒体生产与预渲染审核",
  render_ready: "媒体生产与预渲染审核",
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

export function EpisodeWorkspace({ isPageLoading = false, serverPage, artifactCounts, accounts, accountsById, artifacts, blueprintsById, episodeVisibility, episodes, filter, onDelete = async () => {}, onEpisodeVisibilityChange, onFilter, onSetArchived = async () => {}, onSeriesFilter, onSelectEpisode, onUpdateTitle = async () => {}, series, seriesById, seriesFilter, seriesVersionsById, selectedEpisode, isArchivePending = () => false, isDeletePending = () => false, isTitlePending = () => false }: { isPageLoading?: boolean; serverPage?: ServerPage; artifactCounts?: Record<string, number>; accounts: Account[]; accountsById: Map<string, Account>; artifacts: Artifact[]; blueprintsById: Map<string, Blueprint>; episodeVisibility: EpisodeVisibility; episodes: Episode[]; filter: string; isArchivePending?: (episodeId: string) => boolean; isDeletePending?: (episodeId: string) => boolean; isTitlePending?: (episodeId: string) => boolean; onDelete?: (episodeId: string, confirmation: string) => Promise<void>; onEpisodeVisibilityChange: (value: EpisodeVisibility) => void; onFilter: (value: string) => void; onSetArchived?: (episodeId: string, archived: boolean) => Promise<void>; onSeriesFilter: (value: string) => void; onSelectEpisode: (id: string) => void; onUpdateTitle?: (episodeId: string, title: string) => Promise<void>; series: Series[]; seriesById: Map<string, Series>; seriesFilter: string; seriesVersionsById: Map<string, SeriesVersion>; selectedEpisode: Episode | null }) {
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const filteredEpisodes = episodes.filter((episode) => episodeVisibility === "all" || (episodeVisibility === "archived" ? episodeIsArchived(episode) : !episodeIsArchived(episode)));
  const pageCount = Math.max(1, Math.ceil(filteredEpisodes.length / pageSize));
  const safePage = serverPage?.page ?? Math.min(page, pageCount);
  const total = serverPage?.total ?? filteredEpisodes.length;
  const pageItems = isPageLoading ? [] : serverPage ? filteredEpisodes : filteredEpisodes.slice((safePage - 1) * pageSize, safePage * pageSize);
  useEffect(() => setPage(1), [episodeVisibility, filter, seriesFilter]);
  useEffect(() => setPage((current) => Math.min(current, pageCount)), [pageCount]);
  return <><div className="filters"><label><span>账号</span><select onChange={(event) => onFilter(event.target.value)} value={filter}><option value="全部账号">全部账号</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label><label><span>系列</span><select onChange={(event) => onSeriesFilter(event.target.value)} value={seriesFilter}><option value="全部系列">全部系列</option>{series.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}</select></label><label><span>生产单状态</span><select aria-label="生产单状态" onChange={(event) => onEpisodeVisibilityChange(event.target.value as EpisodeVisibility)} value={episodeVisibility}><option value="active">进行中</option><option value="archived">已归档</option><option value="all">全部</option></select></label><span className="summary-count">{total} 个生产单</span></div><div className="episode-table" role="table" aria-label="生产单"><div className="table-row table-header" role="row"><span>生产单</span><span>账号</span><span>系列</span><span>蓝图</span><span>当前阶段</span><span>产物数</span><span>更新时间</span><span>操作</span></div>{pageItems.map((episode) => { const seriesVersion = episode.series_version_id ? seriesVersionsById.get(episode.series_version_id) : null; const account = accountsById.get(episode.account_id); const accountSlug = account?.slug ?? ""; return <div className={`table-row episode-row ${selectedEpisode?.id === episode.id ? "is-selected" : ""}`} key={episode.id} onClick={() => onSelectEpisode(episode.id)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelectEpisode(episode.id); } }} role="row" tabIndex={0}><span className="episode-name"><strong>{episode.title || "未命名生产单"}</strong><small>{episode.id.slice(0, 8)}</small></span><span className="account-name"><i aria-hidden="true" className={`account-avatar account-avatar-${accountIdentityColor(accountSlug)}`} title={account?.name ?? "未知账号"}>{accountIdentityInitials(accountSlug)}</i>{account?.name ?? "未知账号"}</span><span>{seriesVersion ? `${seriesById.get(seriesVersion.series_id)?.name ?? "未知系列"} v${seriesVersion.version}` : "—"}</span><span>v{blueprintsById.get(episode.blueprint_version_id)?.version ?? "—"}</span><span className={`stage stage-${stageTone(episode.stage)}`}>{stageLabels[episode.stage]}</span><span>{artifactCounts?.[episode.id] ?? artifacts.filter((artifact) => artifact.episode_id === episode.id).length}</span><span>{formatDate(episode.updated_at)}</span><EpisodeActionsMenu blueprint={blueprintsById.get(episode.blueprint_version_id)} episode={episode} isArchivePending={isArchivePending(episode.id)} isDeletePending={isDeletePending(episode.id)} isTitlePending={isTitlePending(episode.id)} onDelete={onDelete} onSetArchived={onSetArchived} onUpdateTitle={onUpdateTitle} /></div>; })}</div>{filteredEpisodes.length === 0 ? <div className="empty-state compact"><h2>{episodeVisibility === "archived" ? "还没有已归档的生产单" : "还没有符合条件的生产单"}</h2><p>调整筛选条件，或点击右上角“新建生产单”。</p></div> : null}{isPageLoading ? null : <PaginationControls page={safePage} pageSize={pageSize} total={total} onPageChange={serverPage?.onPageChange ?? setPage} />}<div className="status-legend"><span><i className="legend-approved" />已通过</span><span><i className="legend-review" />待审核</span><span><i className="legend-muted" />草稿 / 制作</span></div></>;
}

export function ReviewWorkspace({ serverPage, accountsById, episodes, onSelectEpisode, selectedEpisode }: { serverPage?: ServerPage; accountsById: Map<string, Account>; episodes: Episode[]; onSelectEpisode: (id: string) => void; selectedEpisode: Episode | null }) {
  const reviewEpisodes = episodes.filter((episode) => !episode.archived_at && (reviewActionFor(episode.stage) || episode.stage === "production_ready"));
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const pageCount = Math.max(1, Math.ceil(reviewEpisodes.length / pageSize));
  const safePage = serverPage?.page ?? Math.min(page, pageCount);
  const pageItems = serverPage ? reviewEpisodes : reviewEpisodes.slice((safePage - 1) * pageSize, safePage * pageSize);
  useEffect(() => setPage((current) => Math.min(current, pageCount)), [pageCount]);
  return <><p className="muted-copy">审核决定会通过受控状态迁移写入审批与审计记录；Worker 的阻塞项会显示在右侧 Episode 详情中。</p><section className="review-queue" aria-label="待审核 Episode"><h2>待审核 Episode</h2>{reviewEpisodes.length ? <><div className="review-queue-list">{pageItems.map((episode) => <button className={`review-queue-item ${selectedEpisode?.id === episode.id ? "is-selected" : ""}`} key={episode.id} onClick={() => onSelectEpisode(episode.id)} type="button"><strong>{episode.title}</strong><span>{accountsById.get(episode.account_id)?.name ?? "未知账号"} · {stageLabels[episode.stage]}</span></button>)}</div><PaginationControls page={safePage} pageSize={pageSize} total={serverPage?.total ?? reviewEpisodes.length} onPageChange={serverPage?.onPageChange ?? setPage} /></> : <div className="empty-state compact"><h2>没有待审核 Episode</h2><p>Worker 将产物推进到审核阶段后，会在这里显示。</p></div>}</section></>;
}



export function PasswordForm({ isPending, onClose, onSubmit, children }: { isPending: boolean; onClose: () => void; onSubmit: (password: string) => Promise<void>; children?:ReactNode }) {
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

  return <div className="modal-backdrop" role="presentation"><div className={`modal-card episode-form-modal${children?' owner-settings-card':''}`}><form aria-label="设置登录密码" className="owner-password-form" onSubmit={submit}><header><div><h2>设置登录密码</h2><p>密码只用于登录，不会显示或保存在控制台记录中。</p></div><button aria-label="关闭设置登录密码" className="icon-button" onClick={onClose} type="button"><Icon name="Close" /></button></header><label>新密码<input aria-label="新密码" autoComplete="new-password" autoFocus onChange={(event) => setPassword(event.target.value)} required type="password" value={password} /></label><label>确认密码<input aria-label="确认密码" autoComplete="new-password" onChange={(event) => setConfirmation(event.target.value)} required type="password" value={confirmation} /></label><div className="modal-actions"><button className="button button-secondary" onClick={onClose} type="button">取消</button><button className="button button-primary" disabled={isPending} type="submit">{isPending ? "保存中…" : "保存密码"}</button></div>{formError ? <p className="form-error">{formError}</p> : null}</form>{children}</div></div>;
}

type IconName = NavigationItem | "Moon" | "Sun" | "Exit" | "Close" | "Play" | "PanelLeft" | "User" | "Edit" | "Delete" | "Video";

const iconComponents: Record<IconName, LucideIcon> = { accounts: Users, episodes: Table2, operations: BarChart3, reviews: MessageSquare, Moon, Sun, Exit: LogOut, Close: X, Play, PanelLeft, User, Edit: Pencil, Delete: Trash2, Video };

export function Icon({ name }: { name: IconName }) {
  const IconComponent = iconComponents[name];
  return <IconComponent aria-hidden="true" className="icon" strokeWidth={1.8} />;
}
