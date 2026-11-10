import type {AccountDeletionStatus} from './accountDeletionStatus';
import './account-deletion.css';
import type {PanelNavigation} from '../local-app/catalogNavigation';
import {SeriesDirectoryPanel} from './SeriesDirectoryPanel';
import {AccountDirectoryPanel} from './AccountDirectoryPanel';
import {useDialogFocus} from '../ui/useDialogFocus';
import {Archive,Pencil,Trash2,Settings,RefreshCw,Search,Plus,X} from 'lucide-react';
import {InputBase} from '../ui/dan-ui/components/base/input/input';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import {PaginationControls} from '../ui/PaginationControls';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import type { Database, Json } from "../lib/database.types";
import { blueprintAssetRoot, defaultBlueprintPolicy } from "../platform/blueprintPolicy";
import { BlueprintConfigurationForm, EpisodeConfigurationRepairForm, SeriesConfigurationForm } from "../platform/ConfigurationForms";
import {ConfirmationModal,ConfirmationModalPresence} from "../ui/ConfirmationModal";
import type { ExternalConnectionInput, ExternalConnectionVersion } from "../connections/ConnectionWorkspace";
import type { LocalSystemStatusReport } from "../observability/SystemStatusPanel";
import type { WorkerBlocker } from "../reviews/reviewSelectors";

type Account = Database["public"]["Tables"]["accounts"]["Row"];
type Blueprint = Database["public"]["Tables"]["account_blueprint_versions"]["Row"];
type Series = Database["public"]["Tables"]["series"]["Row"];
type SeriesVersion = Database["public"]["Tables"]["series_versions"]["Row"];
type PromptVersion = Database["public"]["Tables"]["prompt_versions"]["Row"];
type ExternalConnection = Database["public"]["Tables"]["external_connections"]["Row"];

interface BlueprintRepairContext {
  blocker: WorkerBlocker;
  blueprintVersionId: string;
  episodeId: string;
}

interface AccountWorkspaceProps {
  navigation?:PanelNavigation<'rules'>;
  account: Account | null;
  accountEpisodeCount?: number;
  readDeletionStatus?:(accountId:string)=>Promise<AccountDeletionStatus>;
  onViewAccountEpisodes?:(accountId:string)=>boolean|void;
  onViewDeletionCleanup?:(cleanupKey:string)=>void;
  blueprints: Blueprint[];
  externalConnections?: ExternalConnection[];
  connectionVersions?: ExternalConnectionVersion[];
  blueprintRepairContext?: BlueprintRepairContext | null;
  isPending: string;
  onApplyEpisodeRepair?: (input: { context: BlueprintRepairContext; policy: Json }) => Promise<boolean>;
  onCreatePromptVersion?: (input: { capability: PromptVersion["capability"]; name: string; summary: string; instructions: string }) => Promise<PromptVersion | null>;
  onCreateConnection?: (input: ExternalConnectionInput) => Promise<ExternalConnection | null>;
  onCreateEpisode?: () => void;
  onCreateSeries?: (input: { name: string; rules: Json }) => Promise<void>;
  onRenameSeries?: (id: string, name: string) => Promise<boolean | void>;
  onCreateSeriesVersion?: (input: { seriesId: string; rules: Json }) => Promise<void>;
  onDeleteAccount?: (id: string, confirmation: string) => Promise<boolean | void>;
  onDismissBlueprintRepair?: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  onRefresh?: () => Promise<void>;
  onRenameAccount?: (id: string, name: string) => Promise<boolean | void>;
  onSetAccountArchived?: (id: string, archived: boolean) => Promise<boolean | void>;
  onRotateConnection?: (input: { connectionId: string; provider: ExternalConnectionInput["provider"]; adapter: ExternalConnectionInput["adapter"]; secret: string }) => Promise<ExternalConnection | null>;
  onUpdateBlueprint?: (policy: Json) => Promise<Blueprint | null>;
  onTestConnection?: (connectionId: string) => Promise<unknown>;
  onUpdateConnection?: (input: { connectionId: string; name: string; description: string }) => Promise<void>;
  promptVersions?: PromptVersion[];
  series?: Series[];
  seriesVersions?: SeriesVersion[];
  systemStatus?: LocalSystemStatusReport | null;
}

const emptySeriesRules: Json = {};

export function AccountWorkspace({ navigation, account, accountEpisodeCount = 0, readDeletionStatus, onViewAccountEpisodes, onViewDeletionCleanup, blueprints, blueprintRepairContext = null, connectionVersions = [], externalConnections = [], isPending, onApplyEpisodeRepair, onCreateConnection, onCreatePromptVersion, onCreateEpisode, onCreateSeries = async () => {}, onCreateSeriesVersion = async () => {}, onRenameSeries = async () => {}, onDeleteAccount = async () => {}, onDismissBlueprintRepair, onDirtyChange, onRefresh, onRenameAccount = async () => {}, onRotateConnection, onSetAccountArchived = async () => {}, onTestConnection, onUpdateBlueprint, onUpdateConnection, promptVersions = [], series = [], seriesVersions = [], systemStatus = null }: AccountWorkspaceProps) {
  const [configurationDirty, setConfigurationDirtyState] = useState(false);
  const dirty = configurationDirty;
  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [accountSettingsOpen, setAccountSettingsOpen] = useState(false);
  const accountSettingsRef = useRef<HTMLButtonElement>(null);
  const setConfigurationDirty = useCallback((dirty: boolean) => {
    setConfigurationDirtyState(dirty);
  }, []);
  const currentBlueprint = blueprints.find((blueprint) => blueprint.id === account?.current_blueprint_version_id) ?? blueprints.filter((blueprint) => blueprint.account_id === account?.id && !blueprint.is_snapshot).sort((left, right) => right.version - left.version)[0] ?? null;

  useEffect(() => { setConfigurationDirty(false); setRenameOpen(false); setDeleteOpen(false); setArchiveOpen(false); setAccountSettingsOpen(false); }, [account?.id, blueprintRepairContext?.episodeId, setConfigurationDirty]);
  useEffect(() => {
    if (!dirty) return;
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty]);
  if (!account) return <div className="account-blueprint-workspace"><h1>账号</h1><div className="empty-state">没有可读取的账号。</div></div>;

  const policy = currentBlueprint?.policy ?? defaultBlueprintPolicy;
  const localAdapterReadiness: Record<string, boolean> = systemStatus?.dependencies.some((dependency) => dependency.name === "OpenChatCut" && dependency.state === "healthy") ? { "openchatcut:openchatcut_card_video": true } : {};
  function leaveConfiguration(action: () => void) {
    if(isPending==='blueprint'||isPending==='series'||isPending.startsWith('series-version-'))return;
    if (dirty && !window.confirm("当前配置有未保存修改，确定放弃吗？")) return;
    setAccountSettingsOpen(false);
    setConfigurationDirty(false);
    action();
  }
  return <section className="impeccable-config-workspace account-blueprint-workspace" aria-label="账号工作区">
    <header className="account-page-heading">
      <div><h1>{account.name}</h1>{account.archived_at && <span className="account-archived-badge">已归档</span>}</div>
      <Button size="sm" color="secondary" iconLeading={Settings} ref={accountSettingsRef} type="button"
        aria-haspopup="dialog" onClick={() => setAccountSettingsOpen(true)}>账号设置</Button>
    </header>
    {account.archived_at ? <p className="account-archived-note" role="status">此账号已归档，不会出现在新建生产单的账号列表中；恢复后可继续生产。</p> : null}
    {!currentBlueprint ? <div className="empty-state">该账号没有可读取的蓝图配置。</div> : blueprintRepairContext ? <EpisodeConfigurationRepairForm blocker={blueprintRepairContext.blocker} initialPolicy={policy} isPending={isPending === `apply-episode-repair-${blueprintRepairContext.episodeId}`} onCancel={() => onDismissBlueprintRepair?.()} onSave={async (nextPolicy) => { if (onApplyEpisodeRepair) await onApplyEpisodeRepair({ context: blueprintRepairContext, policy: nextPolicy }); }} promptVersions={promptVersions} /> : <SeriesSettings onCreateEpisode={onCreateEpisode} navigation={navigation} key={account.id} accountId={account.id} onRename={onRenameSeries} commonEditor={<>
      <header className="account-editor-heading">
        <div><h2>通用规则</h2><p className="account-rule-scope">作为此账号下各系列的默认规则。</p></div>
        <span className="account-save-state" role="status">已应用 · v{currentBlueprint.version}</span>
      </header>
      <div className="account-configuration-form"><BlueprintConfigurationForm accountLayout saveState={<span className={`account-save-state${dirty ? " is-dirty" : ""}`} role="status">{dirty ? "有未应用更改" : "修改中"}</span>} accountId={account.id} connectionVersions={connectionVersions} externalConnections={externalConnections} initialAssetRoot={blueprintAssetRoot(policy)} initialPolicy={policy} isPending={isPending === "blueprint" || isPending === "prompt-version"} localAdapterReadiness={localAdapterReadiness} onCancel={() => {}} onCreateConnection={onCreateConnection} onCreatePromptVersion={onCreatePromptVersion} onDirtyChange={setConfigurationDirty} onRotateConnection={onRotateConnection} onSave={async (nextPolicy) => { if(onUpdateBlueprint){const result=await onUpdateBlueprint(nextPolicy);if(result===null)throw new Error("规则未保存，请处理错误后重试。");} }} onTestConnection={onTestConnection} onUpdateConnection={onUpdateConnection} promptVersions={promptVersions} /></div>

    </>} accountPolicy={policy} isPending={isPending} onCreate={onCreateSeries} onDirtyChange={setConfigurationDirty} onLeave={leaveConfiguration} onCreateVersion={onCreateSeriesVersion} series={series} seriesVersions={seriesVersions}/>}
    {accountSettingsOpen && <AccountSettingsDialog account={account} episodeCount={accountEpisodeCount} returnFocusRef={accountSettingsRef}
      onClose={() => setAccountSettingsOpen(false)}
      onRefresh={onRefresh ? () => leaveConfiguration(() => void onRefresh()) : undefined}
      onRename={() => {accountSettingsRef.current?.focus();setAccountSettingsOpen(false);setRenameOpen(true);}}
      onArchive={() => {accountSettingsRef.current?.focus();setAccountSettingsOpen(false);setArchiveOpen(true);}}
      onDelete={() => {accountSettingsRef.current?.focus();setAccountSettingsOpen(false);setDeleteOpen(true);}} />}
    {renameOpen ? <AccountRenameModal account={account} isPending={isPending === `rename-account-${account.id}`} onClose={() => setRenameOpen(false)} onSave={(name) => onRenameAccount(account.id, name)} /> : null}
    <ConfirmationModalPresence>{archiveOpen ? <ConfirmationModal confirmLabel={account.archived_at ? "确认恢复账号" : "确认归档账号"} isPending={isPending === `archive-account-${account.id}`} onCancel={() => setArchiveOpen(false)} onConfirm={async () => { if (await onSetAccountArchived(account.id, !account.archived_at) !== false) setArchiveOpen(false); }} pendingLabel={account.archived_at ? "恢复中…" : "归档中…"} title={account.archived_at ? "恢复账号" : "归档账号"}><p>{account.archived_at ? `恢复“${account.name}”后，它会重新出现在新建生产单的账号列表中。` : `归档“${account.name}”后，它不会出现在新建生产单的账号列表中；已有生产单、系列和历史配置都会保留。`}</p></ConfirmationModal> : null}</ConfirmationModalPresence>
    <ConfirmationModalPresence>{deleteOpen ? <AccountDeleteModal account={account} episodeCount={accountEpisodeCount} readStatus={readDeletionStatus} onViewEpisodes={onViewAccountEpisodes} onViewCleanup={onViewDeletionCleanup} onArchive={!account.archived_at?()=>{setDeleteOpen(false);setArchiveOpen(true);}:undefined} isPending={isPending === `delete-account-${account.id}`} onClose={() => setDeleteOpen(false)} onDelete={(confirmation) => onDeleteAccount(account.id, confirmation)} /> : null}</ConfirmationModalPresence>
  </section>;
}

function AccountSettingsDialog({account, episodeCount, returnFocusRef, onClose, onRefresh, onRename, onArchive, onDelete}: {
  account: Account;
  episodeCount: number;
  returnFocusRef: React.RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  onRefresh?: () => void;
  onRename: () => void;
  onArchive: () => void;
  onDelete: () => void;
}) {
  const dialogRef = useDialogFocus<HTMLElement>(true, onClose, returnFocusRef);
  return <div className="modal-backdrop">
    <section className="modal-card account-settings-dialog" role="dialog" aria-modal="true" aria-label="账号设置" ref={dialogRef}>
      <header><h2>账号设置</h2><Button size="sm" color="tertiary" aria-label="关闭账号设置" type="button" iconLeading={X} onClick={onClose} /></header>
      <dl className="account-settings-facts">
        <div><dt>账号名称</dt><dd>{account.name}</dd></div>
        <div><dt>标识</dt><dd>{account.slug}</dd></div>
        <div><dt>时区</dt><dd>{account.timezone}</dd></div>
        <div><dt>生产单</dt><dd>{episodeCount} 个</dd></div>
      </dl>
      <AccountDirectoryPanel accountId={account.id} />
      <footer className="account-settings-actions">
        {onRefresh && <Button size="sm" color="secondary" iconLeading={RefreshCw} onClick={onRefresh}>刷新账号</Button>}
        <Button size="sm" color="secondary" iconLeading={Pencil} onClick={onRename}>重命名</Button>
        <Button size="sm" color="secondary" iconLeading={Archive} onClick={onArchive}>{account.archived_at ? "恢复账号" : "归档账号"}</Button>
        <Button size="sm" color="secondary-destructive" iconLeading={Trash2} onClick={onDelete}>删除账号</Button>
      </footer>
    </section>
  </div>;
}

export function SeriesSettings({ onCreateEpisode, navigation,commonRequested=false,accountId, onRename, isPending, onCreate, onCreateVersion = async () => {}, onDirtyChange, onLeave, series, seriesVersions, commonEditor, accountPolicy }: { onCreateEpisode?: () => void; navigation?:PanelNavigation<'rules'>;commonRequested?:boolean;accountId?: string; onRename?: (id:string,name:string)=>Promise<boolean|void>; commonEditor?: ReactNode; accountPolicy?: Json; isPending: boolean | string; onCreate: (input: { name: string; rules: Json }) => Promise<void>; onCreateVersion?: (input: { seriesId: string; rules: Json }) => Promise<void>; onDirtyChange?: (dirty: boolean) => void; onLeave?: (action: () => void) => void; series: Series[]; seriesVersions: SeriesVersion[] }) {
  const tabsId = useId();
  const [ruleDirty,setRuleDirty]=useState(false);
  useEffect(()=>onDirtyChange?.(ruleDirty),[ruleDirty,onDirtyChange]);
  const [selectedId, applySelectedId] = useState(navigation?.value.series??(commonEditor ? "__common" : series[0]?.id ?? ""));
  const setSelectedId=(next:React.SetStateAction<string>)=>{applySelectedId(current=>typeof next==='function'?next(current):next);if(typeof next==='string')navigation?.change({series:next});};
  const [creating, setCreating] = useState(!commonEditor && series.length === 0);
  useEffect(()=>{if(commonRequested){setSelectedId("__common");setCreating(false);}},[commonRequested]);
  const [query, applyQuery] = useState(navigation?.value.q??"");
  const [page, applyPage] = useState(navigation?.value.page??1);
  const setQuery=(q:string)=>{applyQuery(q);navigation?.change({q,page:1});};
  const setPage=(page:number)=>{applyPage(page);navigation?.change({page});};
  useEffect(()=>{if(navigation){applySelectedId(navigation.value.series==='__common'||navigation.value.series==='__series'||series.some(item=>item.id===navigation.value.series)?navigation.value.series:'__common');applyQuery(navigation.value.q);applyPage(navigation.value.page);}},[navigation?.value.series,navigation?.value.q,navigation?.value.page]);
  useEffect(()=>{if(navigation) setCreating(false);},[navigation?.value.series]);
  const showSeriesSearch = series.length > 8;
  useEffect(() => {if (!showSeriesSearch) {applyQuery("");applyPage(1);}}, [showSeriesSearch]);
  const filteredSeries = useMemo(() => {
    const search = series.length > 8 ? query.trim().toLocaleLowerCase() : "";
    return series.filter(candidate => candidate.name.toLocaleLowerCase().includes(search));
  }, [series, query]);
  const pageSize = 20;
  const safePage = Math.min(page, Math.max(1, Math.ceil(filteredSeries.length / pageSize)));
  const visibleSeries = filteredSeries.slice((safePage - 1) * pageSize, safePage * pageSize);
  const previousSeriesIds = useRef(new Set(series.map(item=>item.id)));
  useEffect(() => {
    const added = series.find(item=>!previousSeriesIds.current.has(item.id));
    previousSeriesIds.current = new Set(series.map(item=>item.id));
    if (commonEditor && (creating || selectedId === "__series") && added) {setSelectedId(added.id);setCreating(false);}
  }, [series, Boolean(commonEditor), creating, selectedId]);
  const firstSeriesId = series[0]?.id ?? "";
  useEffect(() => {
    setSelectedId(current => {
      if ((commonEditor && (current === "__common" || current === "__series")) || series.some(candidate => candidate.id === current)) return current;
      return firstSeriesId || (commonEditor ? "__series" : "");
    });
    if (!commonEditor && series.length === 0) setCreating(true);
  }, [firstSeriesId, series, Boolean(commonEditor)]);
  const selected = series.find((candidate) => candidate.id === selectedId) ?? series[0] ?? null;
  const selectedVersions = selected ? seriesVersions.filter((version) => version.series_id === selected.id).sort((left, right) => right.version - left.version) : [];
  const latest = selectedVersions[0] ?? null;
  const navigationSeries = !creating && selectedId !== "__common" && selected && !visibleSeries.some(candidate => candidate.id === selected.id) ? [selected, ...visibleSeries] : visibleSeries;
  const leave = (action: () => void) => {const next=()=>{setRuleDirty(false);action();};if(onLeave)onLeave(next);else next();};
  const commonActive = selectedId === "__common" && !creating;
  const lastSeriesId = useRef("");
  useEffect(() => {
    if (selectedId !== "__common" && selected) lastSeriesId.current = selected.id;
  }, [selectedId, selected]);
  const invalidSeries = navigation?.value.series && !["__common", "__series"].includes(navigation.value.series)
    && !series.some(item => item.id === navigation.value.series);

  function activateTab(tab: "common" | "series") {
    if ((tab === "common") === commonActive) return;
    leave(() => {
      const nextSeries = series.find(item => item.id === lastSeriesId.current) ?? series[0];
      setSelectedId(tab === "common" ? "__common" : nextSeries?.id ?? "__series");
      setCreating(false);
    });
  }
  const seriesContent = <section className={`series-current-layout${commonEditor ? " account-workspace-layout" : ""}`} aria-label="系列规则与版本">
    <aside><nav aria-label="系列导航">
      <header><strong>系列</strong><Button size="sm" color="tertiary" aria-label="新建系列" title="新建系列" iconLeading={Plus}
        onClick={() => leave(() => setCreating(true))} type="button" /></header>
      {showSeriesSearch && <InputBase size="sm" icon={Search} wrapperClassName="account-series-search" type="search" aria-label="查找系列"
        placeholder="查找系列" maxLength={200} value={query} onChange={event => { setQuery(event.target.value); setPage(1); }} />}
      {navigationSeries.map(candidate => {
        const active = !creating && candidate.id === selected?.id;
        return <Button size="sm" color="tertiary" className={`account-series-entry${active ? " is-active" : ""}`} key={candidate.id}
          onClick={() => { if (!active) leave(() => {setSelectedId(candidate.id);setCreating(false);}); }}
          aria-current={active ? "page" : undefined} type="button"><strong>{candidate.name}</strong></Button>;
      })}
      {query && !filteredSeries.length && <p role="status" className="muted-copy">没有匹配的系列。</p>}
      <PaginationControls label="系列分页" page={safePage} pageSize={pageSize} total={filteredSeries.length} onPageChange={setPage} />
    </nav></aside>
    <div>
      {creating || !selected ? <SeriesConfigurationForm accountPolicy={accountPolicy} initialName="" initialRules={emptySeriesRules} isEditing={false}
        isPending={isPending === true || isPending === "series"} onCancel={() => {setCreating(false);if (!selected && commonEditor) setSelectedId("__common");}}
        onDirtyChange={setRuleDirty} onSave={async (name, rules) => { await onCreate({ name, rules }); }} />
      : <SeriesConfigurationForm onCreateEpisode={latest ? onCreateEpisode : undefined} headingContent={accountId ? <SeriesDirectoryPanel accountId={accountId} seriesId={selected.id} /> : null}
        onRename={onRename ? name => onRename(selected.id,name) : undefined} accountPolicy={accountPolicy}
        currentVersion={latest?.version ?? 0} key={`${selected.id}-${latest?.id ?? "empty"}`} initialName={selected.name}
        initialRules={latest?.rules ?? emptySeriesRules} isEditing isPending={isPending === `series-version-${selected.id}`}
        onCancel={() => {}} onDirtyChange={setRuleDirty} onSave={async (_name, rules) => { await onCreateVersion({ seriesId: selected.id, rules }); }} />}
    </div>
  </section>;
  if (!commonEditor) return seriesContent;
  return <>
    <div className="account-rule-tabs" role="tablist" aria-label="账号规则"
      onKeyDown={event => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]'));
        event.preventDefault();
        tabs[event.key === "Home" ? 0 : event.key === "End" ? 1 : event.target === tabs[0] ? 1 : 0]?.focus();
      }}>
      {(["common", "series"] as const).map(tab => {
        const active = (tab === "common") === commonActive;
        return <button key={tab} role="tab" type="button" id={`${tabsId}-${tab}`} aria-controls={`${tabsId}-${tab}-panel`}
          aria-selected={active} tabIndex={active ? 0 : -1} onClick={() => activateTab(tab)}>
          {tab === "common" ? "通用规则" : "系列规则"}
        </button>;
      })}
    </div>
    {invalidSeries && commonActive && <p role="status">该系列已不可用，已返回通用规则。</p>}
    <div className="account-common-panel" role="tabpanel" id={`${tabsId}-common-panel`} aria-labelledby={`${tabsId}-common`} hidden={!commonActive}>
      {commonActive && commonEditor}
    </div>
    <div className="account-series-panel" role="tabpanel" id={`${tabsId}-series-panel`} aria-labelledby={`${tabsId}-series`} hidden={commonActive}>
      {!commonActive && seriesContent}
    </div>
  </>;

}

function AccountRenameModal({ account, isPending, onClose, onSave }: { account: Account; isPending: boolean; onClose: () => void; onSave: (name: string) => Promise<boolean | void> }) {
  const dialogRef = useDialogFocus<HTMLFormElement>(true, () => { if (!isPending) onClose(); });

  const [name, setName] = useState(account.name);
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); if (await onSave(name.trim()) !== false) onClose(); }
  return <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="重命名账号"><form ref={dialogRef} aria-label="重命名账号" className="modal-card" onSubmit={(event) => void submit(event)}><header><div><h2>重命名账号</h2></div></header><label>账号显示名称<InputBase size="sm" aria-label="账号显示名称" onChange={(event) => setName(event.target.value)} value={name} /></label><div className="modal-actions"><Button size="sm" color="secondary" className="button button-secondary" onClick={onClose} type="button">取消</Button><Button size="sm" color="primary" className="button button-primary" isDisabled={isPending || !name.trim()} type="submit">{isPending ? "保存中…" : "保存名称"}</Button></div></form></div>;
}

function AccountDeleteModal({account,episodeCount,isPending,onClose,onDelete,readStatus,onViewEpisodes,onViewCleanup,onArchive}:{account:Account;episodeCount:number;isPending:boolean;onClose:()=>void;onDelete:(confirmation:string)=>Promise<boolean|void>;readStatus?:(id:string)=>Promise<AccountDeletionStatus>;onViewEpisodes?:(id:string)=>boolean|void;onViewCleanup?:(key:string)=>void;onArchive?:()=>void}) {
 const [confirmation,setConfirmation]=useState(''),[status,setStatus]=useState<AccountDeletionStatus|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState('');
 const generation=useRef(0);
 const refresh=useCallback(async()=>{
  const request=++generation.current;setLoading(true);setError('');
  try{const next=readStatus?await readStatus(account.id):{episodeCount,archivedEpisodeCount:0,creationCount:0,deletionCount:0,cleanupKey:null};if(request===generation.current)setStatus(next);}
  catch(reason){if(request===generation.current){setStatus(null);setError(reason instanceof Error?reason.message:'无法检查删除条件，请重试。');}}
  finally{if(request===generation.current)setLoading(false);}
 },[account.id,episodeCount,readStatus]);
 useEffect(()=>{void refresh();return()=>{generation.current++;};},[refresh]);
 const blocked=!!status&&(status.episodeCount>0||status.creationCount>0||status.deletionCount>0);
 return <ConfirmationModal confirmDisabled={loading||!!error||!status||blocked||confirmation!==account.name} confirmLabel="确认删除账号" isPending={isPending} onCancel={onClose} onConfirm={async()=>{if(loading||!status||blocked||error)return;if(await onDelete(confirmation)!==false)onClose();else await refresh();}} pendingLabel="删除中…" title="删除账号" tone="danger">
  {loading?<p role="status">正在检查…</p>:error?<><p role="alert">{error}</p><Button size="sm" color="secondary" onPress={()=>void refresh()}>重新检查</Button></>:status&&blocked?<>
   <p>暂不能删除此账号。</p><div className="account-delete-blockers">
    {status.episodeCount>0&&<div><span>{status.episodeCount} 个生产单{status.archivedEpisodeCount>0?`（含 ${status.archivedEpisodeCount} 个已归档）`:''}</span>{onViewEpisodes&&<Button size="sm" color="secondary" isDisabled={isPending} onPress={()=>{if(onViewEpisodes(account.id)!==false)onClose();}}>查看生产单</Button>}</div>}
    {status.deletionCount>0&&<div><span>{status.deletionCount} 项文件清理未完成</span>{status.cleanupKey&&onViewCleanup&&<Button size="sm" color="secondary" isDisabled={isPending} onPress={()=>{onClose();onViewCleanup(status.cleanupKey!);}}>查看清理任务</Button>}</div>}
    {status.creationCount>0&&<p>{status.creationCount} 项目录创建未完成，请先恢复原操作。</p>}
   </div><div className="account-delete-options"><Button size="sm" color="tertiary" isDisabled={isPending} onPress={()=>void refresh()}>重新检查</Button>{onArchive&&<Button size="sm" color="tertiary" isDisabled={isPending} onPress={onArchive}>归档账号</Button>}</div>
  </>:status?<><p>此操作不可撤销。输入“{account.name}”确认删除。</p><label>确认文本<InputBase size="sm" aria-label="删除账号确认文本" isDisabled={isPending} onChange={event=>setConfirmation(event.target.value)} value={confirmation}/></label></>:null}
 </ConfirmationModal>;
}
