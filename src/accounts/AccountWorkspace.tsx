import {AccountDirectoryPanel} from './AccountDirectoryPanel';
import {useDialogFocus} from '../ui/useDialogFocus';
import {Dropdown} from '../ui/dan-ui/components/base/dropdown/dropdown';
import {Tabs} from '../ui/dan-ui/components/application/tabs/tabs';
import {MoreHorizontal,Archive,Pencil,Trash2,Users,RefreshCw} from 'lucide-react';
import {InputBase} from '../ui/dan-ui/components/base/input/input';
import {NativeSelect} from '../ui/dan-ui/components/base/select/select-native';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import {HelpTip} from '../ui/HelpTip';
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
import type { WorkerPreflightCheck, WorkerPreflightResult } from "../worker/contracts";
import { registeredAdapters } from "../worker/registeredAdapters";

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
  account: Account | null;
  accountEpisodeCount?: number;
  accounts: Account[];
  blueprints: Blueprint[];
  externalConnections?: ExternalConnection[];
  connectionVersions?: ExternalConnectionVersion[];
  blueprintPreflight?: WorkerPreflightResult | null;
  blueprintPreflightError?: string;
  blueprintRepairContext?: BlueprintRepairContext | null;
  isBlueprintPreflightLoading?: boolean;
  isPending: string;
  onApplyEpisodeRepair?: (input: { context: BlueprintRepairContext; policy: Json }) => Promise<boolean>;
  onCreatePromptVersion?: (input: { capability: PromptVersion["capability"]; name: string; summary: string; instructions: string }) => Promise<PromptVersion | null>;
  onCreateConnection?: (input: ExternalConnectionInput) => Promise<ExternalConnection | null>;
  onCreateSeries?: (input: { name: string; rules: Json }) => Promise<void>;
  onCreateSeriesVersion?: (input: { seriesId: string; rules: Json }) => Promise<void>;
  onDeleteAccount?: (id: string, confirmation: string) => Promise<boolean | void>;
  onDismissBlueprintRepair?: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  onRefreshBlueprintPreflight?: () => Promise<void>;
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

const checkLabels: Record<string, string> = {
  blueprint_configuration: "蓝图配置不完整",
  capability_registration: "Worker 能力未接入",
  command_availability: "运行命令不可用",
  credential_presence: "缺少外部连接凭据",
  credential_validity: "外部连接凭据无效",
  local_adapter_readiness: "本地 Adapter 未就绪",
  model_permission: "模型权限未通过",
  network_connectivity: "供应商网络不可达",
  tool_permission: "工具权限不足",
};
const readinessCapabilityLabels: Record<string, string> = {
  final_rendering: "最终渲染",
  review_rendering: "审核渲染",
};

function groupedReadinessFailures(checks: WorkerPreflightCheck[]) {
  const groups = new Map<string, { capabilities: string[]; check: WorkerPreflightCheck }>();
  for (const check of checks) {
    const sharedCommandFailure = check.check === "command_availability";
    const key = [sharedCommandFailure ? "shared" : check.capability, check.check, check.status, check.reason, check.action, check.scope].join("\u0000");
    const group = groups.get(key);
    if (group) {
      if (!group.capabilities.includes(check.capability)) group.capabilities.push(check.capability);
    } else {
      groups.set(key, { capabilities: [check.capability], check });
    }
  }
  return [...groups.values()];
}

function readinessFailureLabel(check: WorkerPreflightCheck, capabilities: string[]): string {
  if (check.check === "command_availability" && capabilities.includes("review_rendering") && capabilities.includes("final_rendering")) return "OpenChatCut 未就绪";
  return checkLabels[check.check] ?? "运行检查未通过";
}
const emptySeriesRules: Json = {};
function BlueprintReadiness({ isDirty, isLoading, onRefresh, preflight, preflightError }: { isDirty: boolean; isLoading: boolean; onRefresh?: () => Promise<void>; preflight: WorkerPreflightResult | null; preflightError: string }) {
  const failureGroups = groupedReadinessFailures(preflight?.checks.filter((check) => check.status !== "passed") ?? []);
  const displayedError = preflightError.length > 120 ? "检查失败，请重试。" : preflightError;
  return <aside aria-label="账号默认配置检查" className="account-blueprint-readiness">
    <div className="account-readiness-summary"><strong className={isDirty ? "is-dirty" : failureGroups.length || preflightError ? "is-blocked" : preflight ? "is-ready" : ""} role="status">{isLoading ? "正在检查…" : isDirty ? "修改未保存" : preflightError ? "检查暂不可用" : failureGroups.length ? `${failureGroups.length} 项需要处理` : preflight ? "账号检查通过" : "等待运行检查"}</strong><HelpTip label="生产条件检查范围">只检查已保存的账号蓝图；选择系列后会再次检查。</HelpTip>{onRefresh ? <Button size="xs" color="secondary" isDisabled={isLoading || isDirty} onClick={() => void onRefresh()} type="button">{isLoading ? "检查中…" : "重新检查"}</Button> : null}</div>
    {!isDirty && failureGroups.length ? <ul>{failureGroups.slice(0, 3).map(({ capabilities, check }) => <li key={`${capabilities.join("-")}-${check.check}`}><strong>{readinessFailureLabel(check, capabilities)}</strong>{capabilities.length > 1 ? <span>影响阶段：{capabilities.map((capability) => readinessCapabilityLabels[capability] ?? capability).join("、")}</span> : null}<span>{check.reason.length > 120 ? (check.action === "retry" ? "运行检查失败，请重新检查。" : "运行环境检查未通过，请联系环境管理员。") : check.reason}</span></li>)}</ul> : null}
    {!isDirty && displayedError ? <p className="form-error">{displayedError}</p> : null}
  </aside>;
}

export function AccountWorkspace({ actions, account, accountEpisodeCount = 0, accounts, blueprints, blueprintPreflight = null, blueprintPreflightError = "", blueprintRepairContext = null, connectionVersions = [], externalConnections = [], isBlueprintPreflightLoading = false, isPending, onApplyEpisodeRepair, onCreateConnection, onCreatePromptVersion, onCreateSeries = async () => {}, onCreateSeriesVersion = async () => {}, onDeleteAccount = async () => {}, onDismissBlueprintRepair, onDirtyChange, onRefresh, onRefreshBlueprintPreflight, onRenameAccount = async () => {}, onRotateConnection, onSelectAccount, onSetAccountArchived = async () => {}, onTestConnection, onUpdateBlueprint, onUpdateConnection, promptVersions = [], series = [], seriesVersions = [], systemStatus = null }: AccountWorkspaceProps) {
  const [activeSection, setActiveSection] = useState<"blueprints" | "series">("blueprints");
  const [configurationDirty, setConfigurationDirtyState] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [accountActionsOpen, setAccountActionsOpen] = useState(false);
  const accountActionsRef = useRef<HTMLButtonElement>(null);
  const setConfigurationDirty = useCallback((dirty: boolean) => {
    setConfigurationDirtyState(dirty);
    onDirtyChange?.(dirty);
  }, [onDirtyChange]);
  const currentBlueprint = blueprints.find((blueprint) => blueprint.id === account?.current_blueprint_version_id) ?? blueprints.filter((blueprint) => !blueprint.is_snapshot).sort((left, right) => right.version - left.version)[0] ?? null;

  useEffect(() => { setActiveSection("blueprints"); setConfigurationDirty(false); setRenameOpen(false); setDeleteOpen(false); setArchiveOpen(false); setAccountActionsOpen(false); }, [account?.id, blueprintRepairContext?.episodeId, setConfigurationDirty]);
  useEffect(() => {
    if (!configurationDirty) return;
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [configurationDirty]);
  if (!account) return <><div className="workspace-actions">{actions}</div><div className="empty-state">没有可读取的账号。</div></>;
  if (!currentBlueprint) return <><div className="workspace-actions">{actions}</div><div className="empty-state">该账号没有可读取的蓝图配置。</div></>;

  const policy = currentBlueprint.policy ?? defaultBlueprintPolicy;
  const localAdapterReadiness = Object.fromEntries([
    ...(systemStatus?.dependencies.some((dependency) => dependency.name === "OpenChatCut" && dependency.state === "healthy") ? [["openchatcut:openchatcut_card_video", true] as const] : []),
    ...(blueprintPreflight?.checks ?? []).flatMap((check) => {
    if (check.check !== "local_adapter_readiness" || !check.adapter) return [];
    const provider = check.provider ?? registeredAdapters.choicesFor({ capability: check.capability, executionPath: "local" }).find((choice) => choice.adapter === check.adapter)?.provider;
    return provider ? [[`${provider}:${check.adapter}`, check.status === "passed"] as const] : [];
    }),
  ]);
  function leaveConfiguration(action: () => void) {
    if (configurationDirty && !window.confirm("当前配置有未保存修改，确定放弃吗？")) return;
    setAccountActionsOpen(false);
    setConfigurationDirty(false);
    action();
  }
  return <section className="impeccable-config-workspace account-blueprint-workspace" aria-label="账号蓝图工作区">
    <header className="account-configuration-heading">
      <div className="account-heading-actions"><NativeSelect icon={Users} className="account-current-select" size="sm" aria-label="当前账号" onChange={(event) => leaveConfiguration(() => onSelectAccount(event.target.value))} value={account.id}><optgroup label="使用中">{accounts.filter((candidate) => !candidate.archived_at).map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}</optgroup>{accounts.some((candidate) => candidate.archived_at) ? <optgroup label="已归档">{accounts.filter((candidate) => candidate.archived_at).map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}</optgroup> : null}</NativeSelect>{account.archived_at ? <span className="account-archived-badge">已归档</span> : null}<div className="account-actions"><Dropdown.Root isOpen={accountActionsOpen} onOpenChange={setAccountActionsOpen}><Button size="sm" color="tertiary" aria-label="账号操作" ref={accountActionsRef} className="account-actions-trigger" type="button"><MoreHorizontal aria-hidden="true" size={20}/></Button><Dropdown.Popover className="dan-ui product-ui account-menu-overlay"><Dropdown.Menu aria-label="账号操作"><Dropdown.Section><Dropdown.SectionHeader><dl><div><dt>标识</dt><dd>{account.slug}</dd></div><div><dt>时区</dt><dd>{account.timezone}</dd></div><div><dt>生产单</dt><dd>{accountEpisodeCount} 个</dd></div></dl></Dropdown.SectionHeader>{onRefresh ? <Dropdown.Item icon={RefreshCw} id="refresh" onAction={() => leaveConfiguration(() => void onRefresh())}>刷新账号</Dropdown.Item> : null}<Dropdown.Item icon={Pencil} id="rename" onAction={() => { accountActionsRef.current?.focus(); setAccountActionsOpen(false); setRenameOpen(true); }}>重命名</Dropdown.Item><Dropdown.Item icon={Archive} id="archive" onAction={() => { accountActionsRef.current?.focus(); setAccountActionsOpen(false); setArchiveOpen(true); }}>{account.archived_at ? "恢复账号" : "归档账号"}</Dropdown.Item></Dropdown.Section><Dropdown.Separator/><Dropdown.Section aria-label="危险操作"><Dropdown.Item icon={Trash2} id="delete" className="is-danger" onAction={() => { accountActionsRef.current?.focus(); setAccountActionsOpen(false); setDeleteOpen(true); }}>删除账号</Dropdown.Item></Dropdown.Section></Dropdown.Menu></Dropdown.Popover></Dropdown.Root></div></div>
      <div className="account-workspace-actions">{actions}</div>
    </header>
    {account.archived_at ? <p className="account-archived-note" role="status">此账号已归档，不会出现在新建生产单的账号列表中；恢复后可继续生产。</p> : null}
    {!blueprintRepairContext&&<AccountDirectoryPanel key={account.id} accountId={account.id} disabled={Boolean(account.archived_at)}/>}
    <Tabs selectedKey={activeSection} onSelectionChange={key => leaveConfiguration(() => setActiveSection(key as typeof activeSection))}><div className="account-tabs-heading"><Tabs.List aria-label="账号设置导航" type="underline" className="account-tabs"><Tabs.Item id="blueprints">蓝图</Tabs.Item><Tabs.Item id="series">系列</Tabs.Item></Tabs.List>{!blueprintRepairContext ? <div className="account-blueprint-scope">仅影响新生产单<HelpTip label={activeSection === "blueprints" ? "蓝图配置生效范围" : "系列规则生效范围"}>{activeSection === "blueprints" ? "保存后仅用于新生产单；已有生产单保持冻结配置，系列规则不变。" : "保存为新版本，已有生产单保持原版本；空字段不增加约束，主脚本仍需上传。"}</HelpTip></div> : null}</div><Tabs.Panel key={activeSection} id={activeSection}>
    {activeSection === "blueprints" ? blueprintRepairContext ? <EpisodeConfigurationRepairForm blocker={blueprintRepairContext.blocker} initialPolicy={policy} isPending={isPending === `apply-episode-repair-${blueprintRepairContext.episodeId}`} onCancel={() => onDismissBlueprintRepair?.()} onSave={async (nextPolicy) => { if (onApplyEpisodeRepair) await onApplyEpisodeRepair({ context: blueprintRepairContext, policy: nextPolicy }); }} promptVersions={promptVersions} /> : <div className="account-configuration-form"><BlueprintConfigurationForm accountLayout saveState={<span className={`account-save-state${configurationDirty ? " is-dirty" : ""}`} role="status">{configurationDirty ? "有未保存更改" : "已保存"}</span>} footerStatus={<BlueprintReadiness isDirty={configurationDirty} isLoading={isBlueprintPreflightLoading} onRefresh={onRefreshBlueprintPreflight} preflight={blueprintPreflight} preflightError={blueprintPreflightError} />} accountId={account.id} connectionVersions={connectionVersions} externalConnections={externalConnections} initialAssetRoot={blueprintAssetRoot(policy)} initialPolicy={policy} isPending={isPending === "blueprint" || isPending === "prompt-version"} localAdapterReadiness={localAdapterReadiness} onCancel={() => {}} onCreateConnection={onCreateConnection} onCreatePromptVersion={onCreatePromptVersion} onDirtyChange={setConfigurationDirty} onRotateConnection={onRotateConnection} onSave={async (nextPolicy) => { if (onUpdateBlueprint && await onUpdateBlueprint(nextPolicy) === null) throw new Error("蓝图未保存，请处理错误后重试。"); }} onTestConnection={onTestConnection} onUpdateConnection={onUpdateConnection} promptVersions={promptVersions} /></div>
 : <div><SeriesSettings isPending={isPending} onCreate={onCreateSeries} onDirtyChange={setConfigurationDirty} onLeave={leaveConfiguration} onCreateVersion={onCreateSeriesVersion} series={series} seriesVersions={seriesVersions} /></div>}
    </Tabs.Panel></Tabs>
    {renameOpen ? <AccountRenameModal account={account} isPending={isPending === `rename-account-${account.id}`} onClose={() => setRenameOpen(false)} onSave={(name) => onRenameAccount(account.id, name)} /> : null}
    {archiveOpen ? <ConfirmationModal confirmLabel={account.archived_at ? "确认恢复账号" : "确认归档账号"} isPending={isPending === `archive-account-${account.id}`} onCancel={() => setArchiveOpen(false)} onConfirm={async () => { if (await onSetAccountArchived(account.id, !account.archived_at) !== false) setArchiveOpen(false); }} pendingLabel={account.archived_at ? "恢复中…" : "归档中…"} title={account.archived_at ? "恢复账号" : "归档账号"}><p>{account.archived_at ? `恢复“${account.name}”后，它会重新出现在新建生产单的账号列表中。` : `归档“${account.name}”后，它不会出现在新建生产单的账号列表中；已有生产单、系列和历史配置都会保留。`}</p></ConfirmationModal> : null}
    {deleteOpen ? <AccountDeleteModal account={account} episodeCount={accountEpisodeCount} isPending={isPending === `delete-account-${account.id}`} onClose={() => setDeleteOpen(false)} onDelete={(confirmation) => onDeleteAccount(account.id, confirmation)} /> : null}
  </section>;
}

export function SeriesSettings({ isPending, onCreate, onCreateVersion = async () => {}, onDirtyChange, onLeave, series, seriesVersions }: { isPending: boolean | string; onCreate: (input: { name: string; rules: Json }) => Promise<void>; onCreateVersion?: (input: { seriesId: string; rules: Json }) => Promise<void>; onDirtyChange?: (dirty: boolean) => void; onLeave?: (action: () => void) => void; series: Series[]; seriesVersions: SeriesVersion[] }) {
  const [selectedId, setSelectedId] = useState(series[0]?.id ?? "");
  const [creating, setCreating] = useState(series.length === 0);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const filteredSeries = useMemo(() => {
    const search = query.trim().toLocaleLowerCase();
    return series.filter(candidate => candidate.name.toLocaleLowerCase().includes(search));
  }, [series, query]);
  const pageSize = 20;
  const safePage = Math.min(page, Math.max(1, Math.ceil(filteredSeries.length / pageSize)));
  const visibleSeries = filteredSeries.slice((safePage - 1) * pageSize, safePage * pageSize);
  const latestVersions = useMemo(() => {
    const versions = new Map<string, number>();
    for (const version of seriesVersions) versions.set(version.series_id, Math.max(versions.get(version.series_id) ?? 0, version.version));
    return versions;
  }, [seriesVersions]);
  const firstSeriesId = series[0]?.id ?? "";
  useEffect(() => { setSelectedId(firstSeriesId); setCreating(series.length === 0); }, [firstSeriesId, series.length]);
  const selected = series.find((candidate) => candidate.id === selectedId) ?? series[0] ?? null;
  const selectedVersions = selected ? seriesVersions.filter((version) => version.series_id === selected.id).sort((left, right) => right.version - left.version) : [];
  const latest = selectedVersions[0] ?? null;
  const leave = (action: () => void) => onLeave ? onLeave(action) : action();
  return <section className="series-current-layout" aria-label="系列规则与版本"><aside><header><h2 id="account-series-heading">系列列表</h2><Button size="xs" color="secondary" className="button button-secondary button-small" onClick={() => leave(() => setCreating(true))} type="button">新建系列</Button></header>{series.length > 0 ? <InputBase size="sm" type="search" aria-label="查找系列" placeholder="查找系列" maxLength={200} value={query} onChange={event => { setQuery(event.target.value); setPage(1); }} /> : null}{visibleSeries.map((candidate) => { const candidateVersion = latestVersions.get(candidate.id) ?? 0; return <Button size="sm" color="tertiary" className={!creating && candidate.id === selected?.id ? "is-active" : ""} key={candidate.id} onClick={() => leave(() => { setSelectedId(candidate.id); setCreating(false); })} type="button"><strong>{candidate.name}</strong><span>当前 v{candidateVersion}</span></Button>; })}{query && filteredSeries.length === 0 ? <p role="status" className="muted-copy">没有匹配的系列。</p> : null}<PaginationControls label="系列分页" page={safePage} pageSize={pageSize} total={filteredSeries.length} onPageChange={setPage} />{!creating && selectedVersions.length ? <section className="series-version-history"><h3>版本历史</h3><ol>{selectedVersions.map((version, index) => <li key={version.id}><div><strong>v{version.version}</strong>{index === 0 ? <span>当前</span> : null}</div><time dateTime={version.created_at}>{new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", year: "numeric" }).format(new Date(version.created_at))}</time></li>)}</ol></section> : null}</aside><div>{creating || !selected ? <SeriesConfigurationForm initialName="" initialRules={emptySeriesRules} isEditing={false} isPending={isPending === true || isPending === "series"} onCancel={() => setCreating(false)} onDirtyChange={onDirtyChange} onSave={async (name, rules) => { await onCreate({ name, rules }); }} /> : <SeriesConfigurationForm currentVersion={latest?.version ?? 0} key={`${selected.id}-${latest?.id ?? "empty"}`} initialName={selected.name} initialRules={latest?.rules ?? emptySeriesRules} isEditing isPending={isPending === `series-version-${selected.id}`} onCancel={() => {}} onDirtyChange={onDirtyChange} onSave={async (_name, rules) => { await onCreateVersion({ seriesId: selected.id, rules }); }} />}</div></section>;
}

function AccountRenameModal({ account, isPending, onClose, onSave }: { account: Account; isPending: boolean; onClose: () => void; onSave: (name: string) => Promise<boolean | void> }) {
  const dialogRef = useDialogFocus<HTMLFormElement>(true, () => { if (!isPending) onClose(); });

  const [name, setName] = useState(account.name);
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); if (await onSave(name.trim()) !== false) onClose(); }
  return <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="重命名账号"><form ref={dialogRef} aria-label="重命名账号" className="modal-card" onSubmit={(event) => void submit(event)}><header><div><h2>重命名账号</h2><p>只修改控制台显示名称，不改变账号标识和已有生产单。</p></div></header><label>账号显示名称<InputBase size="sm" aria-label="账号显示名称" onChange={(event) => setName(event.target.value)} value={name} /></label><div className="modal-actions"><Button size="sm" color="secondary" className="button button-secondary" onClick={onClose} type="button">取消</Button><Button size="sm" color="primary" className="button button-primary" isDisabled={isPending || !name.trim()} type="submit">{isPending ? "保存中…" : "保存名称"}</Button></div></form></div>;
}

function AccountDeleteModal({ account, episodeCount, isPending, onClose, onDelete }: { account: Account; episodeCount: number; isPending: boolean; onClose: () => void; onDelete: (confirmation: string) => Promise<boolean | void> }) {
  const [confirmation, setConfirmation] = useState("");
  return <ConfirmationModal confirmDisabled={episodeCount > 0 || confirmation !== account.name} confirmLabel="确认删除账号" isPending={isPending} onCancel={onClose} onConfirm={async () => { if (await onDelete(confirmation) !== false) onClose(); }} pendingLabel="删除中…" title="删除账号" tone="danger"><p>{episodeCount ? `该账号有 ${episodeCount} 个生产单，当前不能删除。请先归档并永久删除这些生产单，或归档账号保留历史。` : `此操作不可撤销。输入“${account.name}”确认删除。`}</p><label>确认文本<InputBase size="sm" aria-label="删除账号确认文本" isDisabled={episodeCount > 0} onChange={(event) => setConfirmation(event.target.value)} value={confirmation} /></label></ConfirmationModal>;
}
