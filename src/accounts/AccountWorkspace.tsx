import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { Database, Json } from "../lib/database.types";
import { blueprintAssetRoot, defaultBlueprintPolicy } from "../platform/blueprintPolicy";
import { BlueprintConfigurationForm, EpisodeConfigurationRepairForm, SeriesConfigurationForm } from "../platform/ConfigurationForms";
import type { LocalSystemStatusReport } from "../observability/SystemStatusPanel";
import type { WorkerBlocker } from "../reviews/reviewSelectors";
import type { WorkerPreflightResult } from "../worker/contracts";

type Account = Database["public"]["Tables"]["accounts"]["Row"];
type Blueprint = Database["public"]["Tables"]["account_blueprint_versions"]["Row"];
type Series = Database["public"]["Tables"]["series"]["Row"];
type SeriesVersion = Database["public"]["Tables"]["series_versions"]["Row"];
type PromptVersion = Database["public"]["Tables"]["prompt_versions"]["Row"];

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
  blueprintPreflight?: WorkerPreflightResult | null;
  blueprintPreflightError?: string;
  blueprintRepairContext?: BlueprintRepairContext | null;
  isBlueprintPreflightLoading?: boolean;
  isPending: string;
  onActivate: (id: string) => Promise<void>;
  onApplyEpisodeRepair?: (input: { context: BlueprintRepairContext; policy: Json }) => Promise<boolean>;
  onArchiveBlueprint?: (id: string, archived: boolean) => Promise<void>;
  onCreateBlueprint?: (policy: Json) => Promise<Blueprint | null>;
  onCreatePromptVersion?: (input: { capability: PromptVersion["capability"]; name: string; summary: string; instructions: string }) => Promise<PromptVersion | null>;
  onCreateSeries?: (input: { name: string; rules: Json }) => Promise<void>;
  onCreateSeriesVersion?: (input: { seriesId: string; rules: Json }) => Promise<void>;
  onDeactivateBlueprint?: (id: string) => Promise<void>;
  onDeleteAccount?: (id: string, confirmation: string) => Promise<boolean | void>;
  onDismissBlueprintRepair?: () => void;
  onRefreshBlueprintPreflight?: () => Promise<void>;
  onRenameAccount?: (id: string, name: string) => Promise<boolean | void>;
  onSelectAccount: (id: string) => void;
  onUpdateBlueprint?: (policy: Json) => Promise<Blueprint | null>;
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
  model_permission: "模型权限未通过",
  network_connectivity: "供应商网络不可达",
  tool_permission: "工具权限不足",
};

function ReadinessRail({ isLoading, onRefresh, policy, preflight, preflightError, systemStatus }: { isLoading: boolean; onRefresh?: () => Promise<void>; policy: Json; preflight: WorkerPreflightResult | null; preflightError: string; systemStatus: LocalSystemStatusReport | null }) {
  const failed = preflight?.checks.filter((check) => check.status !== "passed") ?? [];
  const enabledCount = policy && typeof policy === "object" && !Array.isArray(policy) ? [policy.b_roll, policy.narration].filter(Boolean).length : 0;
  return <aside aria-label="生产就绪检查" className="account-status-rail">
    <section className={failed.length || preflightError ? "is-blocked" : "is-ready"}>
      <span className="account-status-eyebrow">生产就绪检查</span>
      <h2>{isLoading ? "正在检查…" : preflightError ? "检查暂不可用" : failed.length ? `${failed.length} 项需要处理` : preflight ? "已具备生产条件" : "等待运行检查"}</h2>
      <p>依据当前蓝图与 Worker 环境判断之后新建的生产单。</p>
      {failed.length ? <ul>{failed.slice(0, 3).map((check) => <li key={`${check.capability}-${check.check}`}><strong>{checkLabels[check.check] ?? "运行检查未通过"}</strong><span>{check.reason.length > 120 ? (check.action === "retry" ? "运行检查失败，请稍后重新检查。" : "运行环境检查未通过，请联系环境管理员。") : check.reason}</span></li>)}</ul> : null}
      {preflightError ? <p className="form-error">{preflightError}</p> : null}
      {onRefresh ? <button className="button button-secondary button-small" disabled={isLoading} onClick={() => void onRefresh()} type="button">{isLoading ? "检查中…" : "重新检查"}</button> : null}
    </section>
    <section><h3>配置范围</h3><dl><div><dt>生效对象</dt><dd>新生产单</dd></div><div><dt>已有生产单</dt><dd>保持冻结配置</dd></div><div><dt>当前开启</dt><dd>{enabledCount} 项能力</dd></div><div><dt>本机依赖</dt><dd>{systemStatus ? (systemStatus.dependencies.some((item) => item.state === "attention" || item.state === "offline") ? "存在阻塞" : "已检查") : "待检查"}</dd></div></dl></section>
  </aside>;
}

export function AccountWorkspace({ account, accountEpisodeCount = 0, accounts, blueprints, blueprintPreflight = null, blueprintPreflightError = "", blueprintRepairContext = null, isBlueprintPreflightLoading = false, isPending, onApplyEpisodeRepair, onCreateBlueprint, onCreatePromptVersion, onCreateSeries = async () => {}, onCreateSeriesVersion = async () => {}, onDeleteAccount = async () => {}, onDismissBlueprintRepair, onRefreshBlueprintPreflight, onRenameAccount = async () => {}, onSelectAccount, onUpdateBlueprint, promptVersions = [], series = [], seriesVersions = [], systemStatus = null }: AccountWorkspaceProps) {
  const [activeSection, setActiveSection] = useState<"blueprints" | "series">("blueprints");
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const currentBlueprint = blueprints.find((blueprint) => blueprint.id === account?.current_blueprint_version_id) ?? blueprints.filter((blueprint) => !blueprint.is_snapshot).sort((left, right) => right.version - left.version)[0] ?? null;

  useEffect(() => { setActiveSection("blueprints"); setRenameOpen(false); setDeleteOpen(false); }, [account?.id, blueprintRepairContext?.episodeId]);
  if (!account) return <div className="empty-state">没有可读取的账号。</div>;
  if (!currentBlueprint) return <div className="empty-state">该账号没有可读取的蓝图配置。</div>;

  const policy = currentBlueprint.policy ?? defaultBlueprintPolicy;
  return <>
    <header className="account-configuration-heading">
      <div><span>账号配置控制台</span><h2>蓝图配置</h2><p>{account.name} · 直接维护当前配置，不再管理用户可见版本。</p></div>
      <div className="account-heading-actions"><label>当前账号<select aria-label="当前账号" onChange={(event) => onSelectAccount(event.target.value)} value={account.id}>{accounts.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}</select></label><button aria-label="重命名账号" className="icon-button" onClick={() => setRenameOpen(true)} type="button">✎</button><button aria-label="删除账号" className="icon-button" onClick={() => setDeleteOpen(true)} type="button">⌫</button></div>
    </header>
    <nav aria-label="账号设置导航" className="account-tabs" role="tablist"><button aria-selected={activeSection === "blueprints"} className={`account-tab ${activeSection === "blueprints" ? "is-active" : ""}`} onClick={() => setActiveSection("blueprints")} role="tab" type="button">蓝图</button><button aria-selected={activeSection === "series"} className={`account-tab ${activeSection === "series" ? "is-active" : ""}`} onClick={() => setActiveSection("series")} role="tab" type="button">系列</button></nav>
    {activeSection === "blueprints" ? blueprintRepairContext ? <EpisodeConfigurationRepairForm blocker={blueprintRepairContext.blocker} initialPolicy={policy} isPending={isPending === `apply-episode-repair-${blueprintRepairContext.episodeId}`} onCancel={() => onDismissBlueprintRepair?.()} onSave={async (nextPolicy) => { if (onApplyEpisodeRepair) await onApplyEpisodeRepair({ context: blueprintRepairContext, policy: nextPolicy }); }} /> : <div className="account-configuration-layout" role="tabpanel">
      <nav aria-label="蓝图配置分区" className="account-section-nav"><strong>蓝图配置</strong><a href="#account-rules">账号基础规则</a><a href="#account-core">核心执行器</a><a href="#account-capabilities">生产能力</a><a href="#account-budget">预算与权限</a><small>直接保存当前配置<br />已有生产单不受影响</small></nav>
      <main className="account-configuration-form" id="account-rules"><BlueprintConfigurationForm initialAssetRoot={blueprintAssetRoot(policy)} initialPolicy={policy} isPending={isPending === "blueprint" || isPending === "prompt-version"} onCancel={() => {}} onCreatePromptVersion={onCreatePromptVersion} onSave={async (nextPolicy) => { if (onUpdateBlueprint) await onUpdateBlueprint(nextPolicy); else if (onCreateBlueprint) await onCreateBlueprint(nextPolicy); }} promptVersions={promptVersions} /></main>
      <ReadinessRail isLoading={isBlueprintPreflightLoading} onRefresh={onRefreshBlueprintPreflight} policy={policy} preflight={blueprintPreflight} preflightError={blueprintPreflightError} systemStatus={systemStatus} />
    </div> : <div role="tabpanel"><SeriesSettings isPending={isPending} onCreate={onCreateSeries} onCreateVersion={onCreateSeriesVersion} series={series} seriesVersions={seriesVersions} /></div>}
    {renameOpen ? <AccountRenameModal account={account} isPending={isPending === `rename-account-${account.id}`} onClose={() => setRenameOpen(false)} onSave={(name) => onRenameAccount(account.id, name)} /> : null}
    {deleteOpen ? <AccountDeleteModal account={account} episodeCount={accountEpisodeCount} isPending={isPending === `delete-account-${account.id}`} onClose={() => setDeleteOpen(false)} onDelete={(confirmation) => onDeleteAccount(account.id, confirmation)} /> : null}
  </>;
}

export function SeriesSettings({ isPending, onCreate, onCreateVersion = async () => {}, series, seriesVersions }: { isPending: boolean | string; onCreate: (input: { name: string; rules: Json }) => Promise<void>; onCreateVersion?: (input: { seriesId: string; rules: Json }) => Promise<void>; series: Series[]; seriesVersions: SeriesVersion[] }) {
  const [selectedId, setSelectedId] = useState(series[0]?.id ?? "");
  const [creating, setCreating] = useState(series.length === 0);
  useEffect(() => { setSelectedId(series[0]?.id ?? ""); setCreating(series.length === 0); }, [series]);
  const selected = series.find((candidate) => candidate.id === selectedId) ?? series[0] ?? null;
  const latest = selected ? seriesVersions.filter((version) => version.series_id === selected.id).sort((left, right) => right.version - left.version)[0] ?? null : null;
  return <section className="series-current-layout"><aside><header><h2 id="account-series-heading">系列</h2><button className="button button-secondary button-small" onClick={() => setCreating(true)} type="button">新建系列</button></header>{series.map((candidate) => <button className={!creating && candidate.id === selected?.id ? "is-active" : ""} key={candidate.id} onClick={() => { setSelectedId(candidate.id); setCreating(false); }} type="button"><strong>{candidate.name}</strong><span>当前配置</span></button>)}</aside><div>{creating || !selected ? <SeriesConfigurationForm initialName="" initialRules={{}} isEditing={false} isPending={isPending === true || isPending === "series"} onCancel={() => setCreating(false)} onSave={async (name, rules) => { await onCreate({ name, rules }); }} /> : <SeriesConfigurationForm key={selected.id} initialName={selected.name} initialRules={latest?.rules ?? {}} isEditing isPending={isPending === `series-version-${selected.id}`} onCancel={() => {}} onSave={async (_name, rules) => { await onCreateVersion({ seriesId: selected.id, rules }); }} />}</div></section>;
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
