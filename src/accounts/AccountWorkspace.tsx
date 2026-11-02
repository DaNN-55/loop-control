import type {PanelNavigation} from '../local-app/catalogNavigation';
import {SeriesDirectoryPanel} from './SeriesDirectoryPanel';
import {AccountDirectoryPanel} from './AccountDirectoryPanel';
import {useDialogFocus} from '../ui/useDialogFocus';
import {Dropdown} from '../ui/dan-ui/components/base/dropdown/dropdown';
import {MoreHorizontal,Archive,Pencil,Trash2,Users,RefreshCw,Search,Plus} from 'lucide-react';
import {InputBase} from '../ui/dan-ui/components/base/input/input';
import {NativeSelect} from '../ui/dan-ui/components/base/select/select-native';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import {PaginationControls} from '../ui/PaginationControls';
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import type { Database, Json } from "../lib/database.types";
import { blueprintAssetRoot, defaultBlueprintPolicy } from "../platform/blueprintPolicy";
import { BlueprintConfigurationForm, EpisodeConfigurationRepairForm, SeriesConfigurationForm } from "../platform/ConfigurationForms";
import { ConfirmationModal } from "../ui/ConfirmationModal";
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
  actions?: ReactNode;
  navigation?:PanelNavigation<'rules'>;
  account: Account | null;
  accountEpisodeCount?: number;
  accounts: Account[];
  blueprints: Blueprint[];
  externalConnections?: ExternalConnection[];
  connectionVersions?: ExternalConnectionVersion[];
  blueprintRepairContext?: BlueprintRepairContext | null;
  isPending: string;
  onApplyEpisodeRepair?: (input: { context: BlueprintRepairContext; policy: Json }) => Promise<boolean>;
  onCreatePromptVersion?: (input: { capability: PromptVersion["capability"]; name: string; summary: string; instructions: string }) => Promise<PromptVersion | null>;
  onCreateConnection?: (input: ExternalConnectionInput) => Promise<ExternalConnection | null>;
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
  onSelectAccount: (id: string) => void;
  onUpdateBlueprint?: (policy: Json) => Promise<Blueprint | null>;
  onTestConnection?: (connectionId: string) => Promise<unknown>;
  onUpdateConnection?: (input: { connectionId: string; name: string; description: string }) => Promise<void>;
  promptVersions?: PromptVersion[];
  series?: Series[];
  seriesVersions?: SeriesVersion[];
  systemStatus?: LocalSystemStatusReport | null;
}

const emptySeriesRules: Json = {};

export function AccountWorkspace({ navigation,actions, account, accountEpisodeCount = 0, accounts, blueprints, blueprintRepairContext = null, connectionVersions = [], externalConnections = [], isPending, onApplyEpisodeRepair, onCreateConnection, onCreatePromptVersion, onCreateSeries = async () => {}, onCreateSeriesVersion = async () => {}, onRenameSeries = async () => {}, onDeleteAccount = async () => {}, onDismissBlueprintRepair, onDirtyChange, onRefresh, onRenameAccount = async () => {}, onRotateConnection, onSelectAccount, onSetAccountArchived = async () => {}, onTestConnection, onUpdateBlueprint, onUpdateConnection, promptVersions = [], series = [], seriesVersions = [], systemStatus = null }: AccountWorkspaceProps) {
  const [configurationDirty, setConfigurationDirtyState] = useState(false);
  const dirty = configurationDirty;
  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [accountActionsOpen, setAccountActionsOpen] = useState(false);
  const accountActionsRef = useRef<HTMLButtonElement>(null);
  const setConfigurationDirty = useCallback((dirty: boolean) => {
    setConfigurationDirtyState(dirty);

  }, []);
  const currentBlueprint = blueprints.find((blueprint) => blueprint.id === account?.current_blueprint_version_id) ?? blueprints.filter((blueprint) => !blueprint.is_snapshot).sort((left, right) => right.version - left.version)[0] ?? null;

  useEffect(() => { setConfigurationDirty(false); setRenameOpen(false); setDeleteOpen(false); setArchiveOpen(false); setAccountActionsOpen(false); }, [account?.id, blueprintRepairContext?.episodeId, setConfigurationDirty]);
  useEffect(() => {
    if (!dirty) return;
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty]);
  if (!account) return <><div className="workspace-actions">{actions}</div><div className="empty-state">没有可读取的账号。</div></>;
  if (!currentBlueprint) return <><div className="workspace-actions">{actions}</div><div className="empty-state">该账号没有可读取的蓝图配置。</div></>;

  const policy = currentBlueprint.policy ?? defaultBlueprintPolicy;
  const localAdapterReadiness: Record<string, boolean> = systemStatus?.dependencies.some((dependency) => dependency.name === "OpenChatCut" && dependency.state === "healthy") ? { "openchatcut:openchatcut_card_video": true } : {};
  function leaveConfiguration(action: () => void) {
    if(isPending==='blueprint')return;
    if (dirty && !window.confirm("当前配置有未保存修改，确定放弃吗？")) return;
    setAccountActionsOpen(false);
    setConfigurationDirty(false);
    action();
  }
  const accountNavigation = <header className="account-configuration-heading">
      <div className="account-heading-actions account-switcher-group"><NativeSelect icon={Users} className="account-current-select" size="sm" aria-label="当前账号" onChange={(event) => leaveConfiguration(() => onSelectAccount(event.target.value))} value={account.id}><optgroup label="使用中">{accounts.filter((candidate) => !candidate.archived_at).map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}</optgroup>{accounts.some((candidate) => candidate.archived_at) ? <optgroup label="已归档">{accounts.filter((candidate) => candidate.archived_at).map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}</optgroup> : null}</NativeSelect>{account.archived_at ? <span className="account-archived-badge">已归档</span> : null}<div className="account-actions"><Dropdown.Root isOpen={accountActionsOpen} onOpenChange={setAccountActionsOpen}><Button size="sm" color="tertiary" aria-label="账号操作" ref={accountActionsRef} className="account-actions-trigger" type="button"><MoreHorizontal aria-hidden="true" size={20}/></Button><Dropdown.Popover className="dan-ui product-ui account-menu-overlay"><Dropdown.Menu aria-label="账号操作"><Dropdown.Section><Dropdown.SectionHeader><dl><div><dt>标识</dt><dd>{account.slug}</dd></div><div><dt>时区</dt><dd>{account.timezone}</dd></div><div><dt>生产单</dt><dd>{accountEpisodeCount} 个</dd></div></dl></Dropdown.SectionHeader>{onRefresh ? <Dropdown.Item icon={RefreshCw} id="refresh" onAction={() => leaveConfiguration(() => void onRefresh())}>刷新账号</Dropdown.Item> : null}<Dropdown.Item icon={Pencil} id="rename" onAction={() => { accountActionsRef.current?.focus(); setAccountActionsOpen(false); setRenameOpen(true); }}>重命名</Dropdown.Item><Dropdown.Item icon={Archive} id="archive" onAction={() => { accountActionsRef.current?.focus(); setAccountActionsOpen(false); setArchiveOpen(true); }}>{account.archived_at ? "恢复账号" : "归档账号"}</Dropdown.Item></Dropdown.Section><Dropdown.Separator/><Dropdown.Section aria-label="危险操作"><Dropdown.Item icon={Trash2} id="delete" className="is-danger" onAction={() => { accountActionsRef.current?.focus(); setAccountActionsOpen(false); setDeleteOpen(true); }}>删除账号</Dropdown.Item></Dropdown.Section></Dropdown.Menu></Dropdown.Popover></Dropdown.Root></div></div>
    </header>;
  return <section className="impeccable-config-workspace account-blueprint-workspace" aria-label="账号工作区">
    {actions ? <div className="account-workspace-actions">{actions}</div> : null}
    {account.archived_at ? <p className="account-archived-note" role="status">此账号已归档，不会出现在新建生产单的账号列表中；恢复后可继续生产。</p> : null}
    {blueprintRepairContext ? <EpisodeConfigurationRepairForm blocker={blueprintRepairContext.blocker} initialPolicy={policy} isPending={isPending === `apply-episode-repair-${blueprintRepairContext.episodeId}`} onCancel={() => onDismissBlueprintRepair?.()} onSave={async (nextPolicy) => { if (onApplyEpisodeRepair) await onApplyEpisodeRepair({ context: blueprintRepairContext, policy: nextPolicy }); }} promptVersions={promptVersions} /> : <SeriesSettings navigation={navigation} key={account.id} navigationHeader={accountNavigation} accountId={account.id} onRename={onRenameSeries} commonEditor={<>
      <header className="account-editor-heading"><h2>通用规则</h2><span className="account-save-state" role="status">已应用 · v{currentBlueprint.version}</span></header>
      <div className="account-configuration-form"><BlueprintConfigurationForm accountLayout accountDetails={<span className="account-metadata-facts"><span className="account-metadata-fact">标识 <span>{account.slug}</span></span><span className="account-metadata-fact">时区 <span>{account.timezone}</span></span></span>} accountDirectory={<section className="account-metadata" aria-label="账号目录"><AccountDirectoryPanel accountId={account.id}/></section>} saveState={<span className={`account-save-state${dirty ? " is-dirty" : ""}`} role="status">{dirty ? "有未应用更改" : "修改中"}</span>} accountId={account.id} connectionVersions={connectionVersions} externalConnections={externalConnections} initialAssetRoot={blueprintAssetRoot(policy)} initialPolicy={policy} isPending={isPending === "blueprint" || isPending === "prompt-version"} localAdapterReadiness={localAdapterReadiness} onCancel={() => {}} onCreateConnection={onCreateConnection} onCreatePromptVersion={onCreatePromptVersion} onDirtyChange={setConfigurationDirty} onRotateConnection={onRotateConnection} onSave={async (nextPolicy) => { if(onUpdateBlueprint){const result=await onUpdateBlueprint(nextPolicy);if(result===null)throw new Error("规则未保存，请处理错误后重试。");} }} onTestConnection={onTestConnection} onUpdateConnection={onUpdateConnection} promptVersions={promptVersions} /></div>

    </>} accountPolicy={policy} isPending={isPending} onCreate={onCreateSeries} onDirtyChange={setConfigurationDirty} onLeave={leaveConfiguration} onCreateVersion={onCreateSeriesVersion} series={series} seriesVersions={seriesVersions}/>}
    {renameOpen ? <AccountRenameModal account={account} isPending={isPending === `rename-account-${account.id}`} onClose={() => setRenameOpen(false)} onSave={(name) => onRenameAccount(account.id, name)} /> : null}
    {archiveOpen ? <ConfirmationModal confirmLabel={account.archived_at ? "确认恢复账号" : "确认归档账号"} isPending={isPending === `archive-account-${account.id}`} onCancel={() => setArchiveOpen(false)} onConfirm={async () => { if (await onSetAccountArchived(account.id, !account.archived_at) !== false) setArchiveOpen(false); }} pendingLabel={account.archived_at ? "恢复中…" : "归档中…"} title={account.archived_at ? "恢复账号" : "归档账号"}><p>{account.archived_at ? `恢复“${account.name}”后，它会重新出现在新建生产单的账号列表中。` : `归档“${account.name}”后，它不会出现在新建生产单的账号列表中；已有生产单、系列和历史配置都会保留。`}</p></ConfirmationModal> : null}
    {deleteOpen ? <AccountDeleteModal account={account} episodeCount={accountEpisodeCount} isPending={isPending === `delete-account-${account.id}`} onClose={() => setDeleteOpen(false)} onDelete={(confirmation) => onDeleteAccount(account.id, confirmation)} /> : null}
  </section>;
}

export function SeriesSettings({ navigation,commonRequested=false,accountId, onRename, isPending, onCreate, onCreateVersion = async () => {}, onDirtyChange, onLeave, series, seriesVersions, commonEditor, navigationHeader, accountPolicy }: { navigation?:PanelNavigation<'rules'>;commonRequested?:boolean;accountId?: string; onRename?: (id:string,name:string)=>Promise<boolean|void>; commonEditor?: ReactNode; navigationHeader?: ReactNode; accountPolicy?: Json; isPending: boolean | string; onCreate: (input: { name: string; rules: Json }) => Promise<void>; onCreateVersion?: (input: { seriesId: string; rules: Json }) => Promise<void>; onDirtyChange?: (dirty: boolean) => void; onLeave?: (action: () => void) => void; series: Series[]; seriesVersions: SeriesVersion[] }) {
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
  useEffect(()=>{if(navigation){applySelectedId(navigation.value.series==='__common'||series.some(item=>item.id===navigation.value.series)?navigation.value.series:'__common');applyQuery(navigation.value.q);applyPage(navigation.value.page);setCreating(false);}},[navigation?.value.series,navigation?.value.q,navigation?.value.page]);
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
    if (commonEditor && creating && added) {setSelectedId(added.id);setCreating(false);}
  }, [series, Boolean(commonEditor), creating]);
  const firstSeriesId = series[0]?.id ?? "";
  useEffect(() => {
    setSelectedId(current => {
      if ((commonEditor && current === "__common") || series.some(candidate => candidate.id === current)) return current;
      return commonEditor ? "__common" : firstSeriesId;
    });
    if (!commonEditor && series.length === 0) setCreating(true);
  }, [firstSeriesId, series, Boolean(commonEditor)]);
  const selected = series.find((candidate) => candidate.id === selectedId) ?? series[0] ?? null;
  const selectedVersions = selected ? seriesVersions.filter((version) => version.series_id === selected.id).sort((left, right) => right.version - left.version) : [];
  const latest = selectedVersions[0] ?? null;
  const navigationSeries = !creating && selectedId !== "__common" && selected && !visibleSeries.some(candidate => candidate.id === selected.id) ? [selected, ...visibleSeries] : visibleSeries;
  const leave = (action: () => void) => {const next=()=>{setRuleDirty(false);action();};if(onLeave)onLeave(next);else next();};
  return <section className={`series-current-layout${commonEditor ? " account-workspace-layout" : ""}`} aria-label="系列规则与版本"><aside><nav aria-label="账号内容导航">{navigation?.value.series&&navigation.value.series!=="__common"&&!series.some(item=>item.id===navigation.value.series)&&<p role="status">该系列已不可用，已返回通用规则。</p>}{navigationHeader}{commonEditor ? <Button size="sm" color="tertiary" className={`account-common-entry${selectedId === "__common" && !creating ? " is-active" : ""}`} aria-current={selectedId === "__common" && !creating ? "page" : undefined} onClick={() => leave(() => {setSelectedId("__common");setCreating(false);})}>通用规则</Button> : null}<div className="account-series-divider" role="separator" aria-label="系列"/>{showSeriesSearch ? <InputBase size="sm" icon={Search} wrapperClassName="account-series-search" type="search" aria-label="查找系列" placeholder="查找系列" maxLength={200} value={query} onChange={event => { setQuery(event.target.value); setPage(1); }} /> : null}{navigationSeries.map((candidate) => { return <Button size="sm" color="tertiary" className={`account-series-entry ${!creating && candidate.id === selectedId ? "is-active" : ""}`} key={candidate.id} aria-label={candidate.name} onClick={() => leave(() => { setSelectedId(candidate.id); setCreating(false); })} aria-current={!creating && candidate.id === selectedId ? "page" : undefined} type="button"><strong>{candidate.name}</strong></Button>; })}{query && filteredSeries.length === 0 ? <p role="status" className="muted-copy">没有匹配的系列。</p> : null}<PaginationControls label="系列分页" page={safePage} pageSize={pageSize} total={filteredSeries.length} onPageChange={setPage} /><Button size="sm" color="tertiary" className="account-add-series" aria-label="新建系列" title="新建系列" onClick={() => leave(() => setCreating(true))} type="button"><Plus size={16} aria-hidden="true"/></Button></nav></aside><div>{selectedId === "__common" && !creating ? commonEditor : creating || !selected ? <SeriesConfigurationForm accountPolicy={accountPolicy} initialName="" initialRules={emptySeriesRules} isEditing={false} isPending={isPending === true || isPending === "series"} onCancel={() => setCreating(false)} onDirtyChange={setRuleDirty} onSave={async (name, rules) => { await onCreate({ name, rules }); }} /> : <SeriesConfigurationForm headingContent={accountId?<SeriesDirectoryPanel accountId={accountId} seriesId={selected.id}/>:null} onRename={onRename?name=>onRename(selected.id,name):undefined} accountPolicy={accountPolicy} currentVersion={latest?.version ?? 0} key={`${selected.id}-${latest?.id ?? "empty"}`} initialName={selected.name} initialRules={latest?.rules ?? emptySeriesRules} isEditing isPending={isPending === `series-version-${selected.id}`} onCancel={() => {}} onDirtyChange={setRuleDirty} onSave={async (_name, rules) => { await onCreateVersion({ seriesId: selected.id, rules }); }} />}</div></section>;
}

function AccountRenameModal({ account, isPending, onClose, onSave }: { account: Account; isPending: boolean; onClose: () => void; onSave: (name: string) => Promise<boolean | void> }) {
  const dialogRef = useDialogFocus<HTMLFormElement>(true, () => { if (!isPending) onClose(); });

  const [name, setName] = useState(account.name);
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); if (await onSave(name.trim()) !== false) onClose(); }
  return <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="重命名账号"><form ref={dialogRef} aria-label="重命名账号" className="modal-card" onSubmit={(event) => void submit(event)}><header><div><h2>重命名账号</h2></div></header><label>账号显示名称<InputBase size="sm" aria-label="账号显示名称" onChange={(event) => setName(event.target.value)} value={name} /></label><div className="modal-actions"><Button size="sm" color="secondary" className="button button-secondary" onClick={onClose} type="button">取消</Button><Button size="sm" color="primary" className="button button-primary" isDisabled={isPending || !name.trim()} type="submit">{isPending ? "保存中…" : "保存名称"}</Button></div></form></div>;
}

function AccountDeleteModal({ account, episodeCount, isPending, onClose, onDelete }: { account: Account; episodeCount: number; isPending: boolean; onClose: () => void; onDelete: (confirmation: string) => Promise<boolean | void> }) {
  const [confirmation, setConfirmation] = useState("");
  return <ConfirmationModal confirmDisabled={episodeCount > 0 || confirmation !== account.name} confirmLabel="确认删除账号" isPending={isPending} onCancel={onClose} onConfirm={async () => { if (await onDelete(confirmation) !== false) onClose(); }} pendingLabel="删除中…" title="删除账号" tone="danger"><p>{episodeCount ? `该账号有 ${episodeCount} 个生产单，当前不能删除。请先归档并永久删除这些生产单，或归档账号保留历史。` : `此操作不可撤销。输入“${account.name}”确认删除。`}</p><label>确认文本<InputBase size="sm" aria-label="删除账号确认文本" isDisabled={episodeCount > 0} onChange={(event) => setConfirmation(event.target.value)} value={confirmation} /></label></ConfirmationModal>;
}
