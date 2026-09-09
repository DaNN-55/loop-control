import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { Database, Json } from "../lib/database.types";
import { blueprintAssetRoot, defaultBlueprintPolicy } from "../platform/blueprintPolicy";
import { BlueprintConfigurationForm, EpisodeConfigurationRepairForm, SeriesConfigurationForm } from "../platform/ConfigurationForms";
import type { ExternalConnectionInput, ExternalConnectionVersion } from "../connections/ConnectionWorkspace";
import { mediaAdapterKeys } from "../platform/configurationFormValues";
import type { LocalSystemStatusReport } from "../observability/SystemStatusPanel";
import type { WorkerBlocker } from "../reviews/reviewSelectors";
import type { WorkerPreflightResult } from "../worker/contracts";
import { localAdapterProviderForCapability, localAdapterReadinessKey } from "../worker/adapterRegistry";

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
  onRenameAccount?: (id: string, name: string) => Promise<boolean | void>;
  onRotateConnection?: (input: { connectionId: string; provider: ExternalConnectionInput["provider"]; adapter: ExternalConnectionInput["adapter"]; secret: string }) => Promise<ExternalConnection | null>;
  onSelectAccount: (id: string) => void;
  onUpdateBlueprint?: (policy: Json) => Promise<Blueprint | null>;
  onTestConnection?: (connectionId: string) => Promise<void>;
  onUpdateConnection?: (input: { connectionId: string; name: string; description: string }) => Promise<void>;
  promptVersions?: PromptVersion[];
  series?: Series[];
  seriesVersions?: SeriesVersion[];
  systemStatus?: LocalSystemStatusReport | null;
}

const checkLabels: Record<string, string> = {
  blueprint_configuration: "蓝图配置不完整",
  capability_registration: "Worker 能力未接入",
  credential_presence: "缺少外部连接凭据",
  credential_validity: "外部连接凭据无效",
  local_adapter_readiness: "本地 Adapter 未就绪",
  model_permission: "模型权限未通过",
  network_connectivity: "供应商网络不可达",
  tool_permission: "工具权限不足",
};
const emptySeriesRules: Json = {};
const blueprintSections = [
  { id: "account-rules", label: "账号基础规则" },
  { id: "account-capabilities", label: "生产能力" },
  { id: "account-budget", label: "分镜规划" },
] as const;

function ReadinessRail({ isLoading, onRefresh, policy, preflight, preflightError, systemStatus }: { isLoading: boolean; onRefresh?: () => Promise<void>; policy: Json; preflight: WorkerPreflightResult | null; preflightError: string; systemStatus: LocalSystemStatusReport | null }) {
  const failed = preflight?.checks.filter((check) => check.status !== "passed") ?? [];
  const enabledCount = policy && typeof policy === "object" && !Array.isArray(policy) ? mediaAdapterKeys.filter((key) => policy[key]).length : 0;
  const displayedError = preflightError.length > 120 ? "生产就绪检查暂时失败，请稍后重新检查。" : preflightError;
  return <aside aria-label="生产就绪检查" className="account-status-rail">
    <section className={failed.length || preflightError ? "is-blocked" : "is-ready"}>
      <span className="account-status-eyebrow">生产就绪检查</span>
      <h2>{isLoading ? "正在检查…" : preflightError ? "检查暂不可用" : failed.length ? `${failed.length} 项需要处理` : preflight ? "已具备生产条件" : "等待运行检查"}</h2>
      <p>保存蓝图后会自动重新检查，结果决定之后新建的生产单能否开始生产。</p>
      {failed.length ? <ul>{failed.slice(0, 3).map((check) => <li key={`${check.capability}-${check.check}`}><strong>{checkLabels[check.check] ?? "运行检查未通过"}</strong><span>{check.reason.length > 120 ? (check.action === "retry" ? "运行检查失败，请稍后重新检查。" : "运行环境检查未通过，请联系环境管理员。") : check.reason}</span></li>)}</ul> : null}
      {displayedError ? <p className="form-error">{displayedError}</p> : null}
      {onRefresh ? <button className="button button-secondary button-small" disabled={isLoading} onClick={() => void onRefresh()} type="button">{isLoading ? "检查中…" : "重新检查"}</button> : null}
    </section>
    <section><h3>配置范围</h3><dl><div><dt>生效对象</dt><dd>新生产单</dd></div><div><dt>已有生产单</dt><dd>保持冻结配置</dd></div><div><dt>当前开启</dt><dd>{enabledCount} 项能力</dd></div><div><dt>本机依赖</dt><dd>{systemStatus ? (systemStatus.dependencies.some((item) => item.state === "attention" || item.state === "offline") ? "存在阻塞" : "已检查") : "待检查"}</dd></div></dl></section>
  </aside>;
}

export function AccountWorkspace({ account, accountEpisodeCount = 0, accounts, blueprints, blueprintPreflight = null, blueprintPreflightError = "", blueprintRepairContext = null, connectionVersions = [], externalConnections = [], isBlueprintPreflightLoading = false, isPending, onApplyEpisodeRepair, onCreateConnection, onCreatePromptVersion, onCreateSeries = async () => {}, onCreateSeriesVersion = async () => {}, onDeleteAccount = async () => {}, onDismissBlueprintRepair, onDirtyChange, onRefreshBlueprintPreflight, onRenameAccount = async () => {}, onRotateConnection, onSelectAccount, onTestConnection, onUpdateBlueprint, onUpdateConnection, promptVersions = [], series = [], seriesVersions = [], systemStatus = null }: AccountWorkspaceProps) {
  const [activeSection, setActiveSection] = useState<"blueprints" | "series">("blueprints");
  const [configurationDirty, setConfigurationDirtyState] = useState(false);
  const [activeBlueprintSection, setActiveBlueprintSection] = useState<(typeof blueprintSections)[number]["id"]>("account-rules");
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const setConfigurationDirty = useCallback((dirty: boolean) => {
    setConfigurationDirtyState(dirty);
    onDirtyChange?.(dirty);
  }, [onDirtyChange]);
  const currentBlueprint = blueprints.find((blueprint) => blueprint.id === account?.current_blueprint_version_id) ?? blueprints.filter((blueprint) => !blueprint.is_snapshot).sort((left, right) => right.version - left.version)[0] ?? null;

  useEffect(() => { setActiveSection("blueprints"); setConfigurationDirty(false); setRenameOpen(false); setDeleteOpen(false); }, [account?.id, blueprintRepairContext?.episodeId, setConfigurationDirty]);
  useEffect(() => {
    if (!configurationDirty) return;
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [configurationDirty]);
  useEffect(() => {
    if (activeSection !== "blueprints" || blueprintRepairContext) return;
    const updateActiveSection = () => {
      const sections = blueprintSections.map(({ id }) => ({ id, top: document.getElementById(id)?.getBoundingClientRect().top ?? Infinity })).sort((left, right) => left.top - right.top);
      const next = sections.every(({ top }) => top === 0) ? sections[0] : sections.filter(({ top }) => top <= 160).at(-1) ?? sections[0];
      setActiveBlueprintSection(next.id);
    };
    updateActiveSection();
    window.addEventListener("scroll", updateActiveSection, { passive: true });
    return () => window.removeEventListener("scroll", updateActiveSection);
  }, [activeSection, blueprintRepairContext]);
  if (!account) return <div className="empty-state">没有可读取的账号。</div>;
  if (!currentBlueprint) return <div className="empty-state">该账号没有可读取的蓝图配置。</div>;

  const policy = currentBlueprint.policy ?? defaultBlueprintPolicy;
  const localAdapterReadiness = Object.fromEntries([
    ...(systemStatus?.dependencies.some((dependency) => dependency.name === "OpenChatCut" && dependency.state === "healthy") ? [["openchatcut:openchatcut_card_video", true] as const] : []),
    ...(blueprintPreflight?.checks ?? []).flatMap((check) => {
    if (check.check !== "local_adapter_readiness" || !check.adapter) return [];
    const provider = check.provider ?? localAdapterProviderForCapability(check.capability, check.adapter);
    return provider ? [[localAdapterReadinessKey(provider, check.adapter), check.status === "passed"] as const] : [];
    }),
  ]);
  function leaveConfiguration(action: () => void) {
    if (configurationDirty && !window.confirm("当前配置有未保存修改，确定放弃吗？")) return;
    setConfigurationDirty(false);
    action();
  }
  return <>
    <header className="account-configuration-heading">
      <div className="account-heading-actions"><label>当前账号<select aria-label="当前账号" onChange={(event) => leaveConfiguration(() => onSelectAccount(event.target.value))} value={account.id}>{accounts.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}</select></label><button aria-label="重命名账号" className="icon-button" onClick={() => setRenameOpen(true)} type="button">✎</button><button aria-label="删除账号" className="icon-button" onClick={() => setDeleteOpen(true)} type="button">⌫</button></div>
    </header>
    <nav aria-label="账号设置导航" className="account-tabs" role="tablist"><button aria-selected={activeSection === "blueprints"} className={`account-tab ${activeSection === "blueprints" ? "is-active" : ""}`} onClick={() => leaveConfiguration(() => setActiveSection("blueprints"))} role="tab" type="button">蓝图</button><button aria-selected={activeSection === "series"} className={`account-tab ${activeSection === "series" ? "is-active" : ""}`} onClick={() => leaveConfiguration(() => setActiveSection("series"))} role="tab" type="button">系列</button></nav>
    {activeSection === "blueprints" ? blueprintRepairContext ? <EpisodeConfigurationRepairForm blocker={blueprintRepairContext.blocker} initialPolicy={policy} isPending={isPending === `apply-episode-repair-${blueprintRepairContext.episodeId}`} onCancel={() => onDismissBlueprintRepair?.()} onSave={async (nextPolicy) => { if (onApplyEpisodeRepair) await onApplyEpisodeRepair({ context: blueprintRepairContext, policy: nextPolicy }); }} promptVersions={promptVersions} /> : <div className="account-configuration-layout" role="tabpanel">
      <nav aria-label="蓝图配置分区" className="account-section-nav">{blueprintSections.map(({ id, label }, index) => <a aria-current={activeBlueprintSection === id ? "location" : undefined} href={`#${id}`} key={id}><span aria-hidden="true">{index + 1}</span>{label}</a>)}</nav>
      <main className="account-configuration-form" id="account-rules"><BlueprintConfigurationForm accountId={account.id} connectionVersions={connectionVersions} externalConnections={externalConnections} initialAssetRoot={blueprintAssetRoot(policy)} initialPolicy={policy} isPending={isPending === "blueprint" || isPending === "prompt-version"} localAdapterReadiness={localAdapterReadiness} onCancel={() => {}} onCreateConnection={onCreateConnection} onCreatePromptVersion={onCreatePromptVersion} onDirtyChange={setConfigurationDirty} onRotateConnection={onRotateConnection} onSave={async (nextPolicy) => { if (onUpdateBlueprint) await onUpdateBlueprint(nextPolicy); }} onTestConnection={onTestConnection} onUpdateConnection={onUpdateConnection} promptVersions={promptVersions} /></main>
      <ReadinessRail isLoading={isBlueprintPreflightLoading} onRefresh={onRefreshBlueprintPreflight} policy={policy} preflight={blueprintPreflight} preflightError={blueprintPreflightError} systemStatus={systemStatus} />
    </div> : <div role="tabpanel"><SeriesSettings isPending={isPending} onCreate={onCreateSeries} onDirtyChange={setConfigurationDirty} onLeave={leaveConfiguration} onCreateVersion={onCreateSeriesVersion} series={series} seriesVersions={seriesVersions} /></div>}
    {renameOpen ? <AccountRenameModal account={account} isPending={isPending === `rename-account-${account.id}`} onClose={() => setRenameOpen(false)} onSave={(name) => onRenameAccount(account.id, name)} /> : null}
    {deleteOpen ? <AccountDeleteModal account={account} episodeCount={accountEpisodeCount} isPending={isPending === `delete-account-${account.id}`} onClose={() => setDeleteOpen(false)} onDelete={(confirmation) => onDeleteAccount(account.id, confirmation)} /> : null}
  </>;
}

export function SeriesSettings({ isPending, onCreate, onCreateVersion = async () => {}, onDirtyChange, onLeave, series, seriesVersions }: { isPending: boolean | string; onCreate: (input: { name: string; rules: Json }) => Promise<void>; onCreateVersion?: (input: { seriesId: string; rules: Json }) => Promise<void>; onDirtyChange?: (dirty: boolean) => void; onLeave?: (action: () => void) => void; series: Series[]; seriesVersions: SeriesVersion[] }) {
  const [selectedId, setSelectedId] = useState(series[0]?.id ?? "");
  const [creating, setCreating] = useState(series.length === 0);
  const firstSeriesId = series[0]?.id ?? "";
  useEffect(() => { setSelectedId(firstSeriesId); setCreating(series.length === 0); }, [firstSeriesId, series.length]);
  const selected = series.find((candidate) => candidate.id === selectedId) ?? series[0] ?? null;
  const latest = selected ? seriesVersions.filter((version) => version.series_id === selected.id).sort((left, right) => right.version - left.version)[0] ?? null : null;
  const leave = (action: () => void) => onLeave ? onLeave(action) : action();
  return <section className="series-current-layout"><aside><header><h2 id="account-series-heading">系列</h2><button className="button button-secondary button-small" onClick={() => leave(() => setCreating(true))} type="button">新建系列</button></header>{series.map((candidate) => <button className={!creating && candidate.id === selected?.id ? "is-active" : ""} key={candidate.id} onClick={() => leave(() => { setSelectedId(candidate.id); setCreating(false); })} type="button"><strong>{candidate.name}</strong><span>当前配置</span></button>)}</aside><div>{creating || !selected ? <SeriesConfigurationForm initialName="" initialRules={emptySeriesRules} isEditing={false} isPending={isPending === true || isPending === "series"} onCancel={() => setCreating(false)} onDirtyChange={onDirtyChange} onSave={async (name, rules) => { await onCreate({ name, rules }); }} /> : <SeriesConfigurationForm key={selected.id} initialName={selected.name} initialRules={latest?.rules ?? {}} isEditing isPending={isPending === `series-version-${selected.id}`} onCancel={() => {}} onDirtyChange={onDirtyChange} onSave={async (_name, rules) => { await onCreateVersion({ seriesId: selected.id, rules }); }} />}</div></section>;
}

function AccountRenameModal({ account, isPending, onClose, onSave }: { account: Account; isPending: boolean; onClose: () => void; onSave: (name: string) => Promise<boolean | void> }) {
  const [name, setName] = useState(account.name);
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); if (await onSave(name.trim()) !== false) onClose(); }
  return <div className="modal-backdrop"><form aria-label="重命名账号" className="modal-card" onSubmit={(event) => void submit(event)}><header><div><h2>重命名账号</h2><p>只修改控制台显示名称，不改变账号标识和已有生产单。</p></div></header><label>账号显示名称<input aria-label="账号显示名称" onChange={(event) => setName(event.target.value)} value={name} /></label><div className="modal-actions"><button className="button button-secondary" onClick={onClose} type="button">取消</button><button className="button button-primary" disabled={isPending || !name.trim()} type="submit">{isPending ? "保存中…" : "保存名称"}</button></div></form></div>;
}

function AccountDeleteModal({ account, episodeCount, isPending, onClose, onDelete }: { account: Account; episodeCount: number; isPending: boolean; onClose: () => void; onDelete: (confirmation: string) => Promise<boolean | void> }) {
  const [confirmation, setConfirmation] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); if (await onDelete(confirmation) !== false) onClose(); }
  return <div className="modal-backdrop"><form aria-label="删除账号" className="modal-card" onSubmit={(event) => void submit(event)}><header><div><h2>删除账号</h2><p>{episodeCount ? `该账号有 ${episodeCount} 个生产单，当前不能删除。` : `输入“${account.name}”确认删除。`}</p></div></header><label>确认文本<input aria-label="删除账号确认文本" disabled={episodeCount > 0} onChange={(event) => setConfirmation(event.target.value)} value={confirmation} /></label><div className="modal-actions"><button className="button button-secondary" onClick={onClose} type="button">取消</button><button className="button button-danger" disabled={isPending || episodeCount > 0 || confirmation !== account.name} type="submit">{isPending ? "删除中…" : "确认删除账号"}</button></div></form></div>;
}
