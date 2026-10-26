import {useEffect,useState,type FormEvent} from 'react';
import {X} from 'lucide-react';
import type {Database} from '../lib/database.types';
import {blueprintPolicyToForm,mediaAdapterConfiguration,mediaAdapterStatus,type MediaAdapterKey} from '../platform/configurationFormValues';
import {WorkerBlockerCard} from '../reviews/WorkerBlockerCard';
import type {WorkerBlocker} from '../reviews/reviewSelectors';
import type {WorkerPreflightResult} from '../worker/contracts';
import type {ExternalConnectionVersion} from '../connections/ConnectionWorkspace';
type Account=Database['public']['Tables']['accounts']['Row'];
type Blueprint=Database['public']['Tables']['account_blueprint_versions']['Row'];
type Series=Database['public']['Tables']['series']['Row'];
type SeriesVersion=Database['public']['Tables']['series_versions']['Row'];
export type EpisodeCreationStep='idle'|'preflight'|'create'|'directory'|'refresh';
function workerBlockersFromPreflight(preflight:WorkerPreflightResult|null):WorkerBlocker[]{return preflight?.checks.filter(c=>c.status!=='passed').map(c=>({code:c.check,detail:c.reason,capability:c.capability,check:c.check,phase:c.phase,status:c.status,action:c.action,scope:c.scope}))??[];}
const episodeCreationSteps: Array<{ id: Exclude<EpisodeCreationStep, "idle">; label: string; note: string }> = [
  { id: "preflight", label: "检查生产条件", note: "验证当前蓝图、Worker、模型和已启用连接。" },
  { id: "create", label: "创建生产单", note: "冻结当前蓝图和系列版本。" },
  { id: "directory", label: "准备本地材料目录", note: "创建 input 与 materials 目录。" },
  { id: "refresh", label: "打开生产单", note: "同步最新状态和待导入材料。" },
];

function mediaCapabilityLabel(key: MediaAdapterKey) {
  return key === "static_visual" ? "图片生成" : mediaAdapterConfiguration(key).label;
}

export function EpisodeForm({ accounts, blueprints = [], connectionVersions = [], creationStartedAt = null, creationStep = "idle", isPending, onClose, onOpenBlueprint, onSubmit, preflight = null, series, seriesVersions }: { accounts: Account[]; blueprints?: Blueprint[]; connectionVersions?: ExternalConnectionVersion[]; creationStartedAt?: number | null; creationStep?: EpisodeCreationStep; isPending: boolean; onClose: () => void; onOpenBlueprint?: (accountId: string) => void; onSubmit: (input: { title: string; accountId: string; isTest: boolean; seriesVersionId: string | null }) => Promise<WorkerPreflightResult | null>; preflight?: WorkerPreflightResult | null; series: Series[]; seriesVersions: SeriesVersion[] }) {
  const [title, setTitle] = useState("");
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [seriesVersionId, setSeriesVersionId] = useState("");
  const [episodePreflight, setEpisodePreflight] = useState<WorkerPreflightResult | null>(preflight);
  const [now, setNow] = useState(Date.now());
  const seriesById = new Map(series.map((candidate) => [candidate.id, candidate]));
  const availableVersions = seriesVersions.filter((version) => version.account_id === accountId);
  const selectedAccount = accounts.find((account) => account.id === accountId);
  const selectedBlueprint = blueprints.find((blueprint) => blueprint.id === selectedAccount?.current_blueprint_version_id);
  const availableExternalConnectionVersionIds = connectionVersions.filter((version) => version.is_current && version.status === "verified" && !version.revoked_at).map((version) => version.id);
  const frozenMediaCapabilities = selectedBlueprint ? (() => {
    const form = blueprintPolicyToForm(selectedBlueprint.policy);
    return (form.enabledMediaAdapters ?? []).filter((key) => mediaAdapterStatus(key, form.mediaAdapters[key], { availableExternalConnectionVersionIds }) === "已配置").map((key) => ({ key, path: form.mediaAdapters[key].executionPath }));
  })() : [];
  const visibleFrozenMediaCapabilities = frozenMediaCapabilities.slice(0, 3);
  const hiddenFrozenMediaCapabilities = frozenMediaCapabilities.slice(3);
  const canCreateEpisode = Boolean(selectedAccount?.current_blueprint_version_id);
  const blockers = workerBlockersFromPreflight(episodePreflight);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canCreateEpisode) return;
    setEpisodePreflight(null);
    const result = await onSubmit({ accountId, isTest: false, seriesVersionId: seriesVersionId || null, title });
    if (result) setEpisodePreflight(result);
  }
  const activeStepIndex = episodeCreationSteps.findIndex((step) => step.id === creationStep);
  const activeStep = episodeCreationSteps[activeStepIndex] ?? episodeCreationSteps[0];
  useEffect(() => {
    if (!isPending || creationStartedAt === null) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [creationStartedAt, isPending]);
  const elapsedSeconds = creationStartedAt === null ? 0 : Math.max(0, Math.floor((now - creationStartedAt) / 1000));
  return <div className="modal-backdrop" role="presentation"><form aria-label="新建生产单" className="modal-card episode-form-modal" onSubmit={(event) => void submit(event)}><header><div><h2>新建生产单</h2><p>会固定所选账号当前激活蓝图和可选系列版本。</p></div><button aria-label="关闭新建生产单" className="icon-button" onClick={onClose} type="button"><X size={18} aria-hidden="true" /></button></header><label>账号<select onChange={(event) => { setAccountId(event.target.value); setSeriesVersionId(""); setEpisodePreflight(null); }} value={accountId}>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label><label>系列版本（可选）<select aria-label="系列版本" onChange={(event) => { setSeriesVersionId(event.target.value); setEpisodePreflight(null); }} value={seriesVersionId}><option value="">不关联系列</option>{availableVersions.map((version) => <option key={version.id} value={version.id}>{seriesById.get(version.series_id)?.name ?? "未知系列"} · v{version.version}</option>)}</select></label><label>工作标题（可留空）<input autoFocus onChange={(event) => setTitle(event.target.value)} placeholder="可在首次适用审核前补充" value={title} /></label>{canCreateEpisode ? <><section className="technical-policy-preview"><header><strong>本单将冻结的生产能力</strong><span>{frozenMediaCapabilities.length} 项</span></header>{frozenMediaCapabilities.length ? <div className="summary-chip-list">{visibleFrozenMediaCapabilities.map(({ key, path }) => <span className="summary-chip" key={key}>{mediaCapabilityLabel(key)} · {path === "local" ? "本地" : path === "manual" ? "人工素材" : "外部"}</span>)}{hiddenFrozenMediaCapabilities.length ? <span className="summary-chip summary-chip-overflow" title={hiddenFrozenMediaCapabilities.map(({ key, path }) => `${mediaCapabilityLabel(key)} · ${path === "local" ? "本地" : path === "manual" ? "人工素材" : "外部"}`).join("\n")}>+{hiddenFrozenMediaCapabilities.length} 项</span> : null}</div> : <span className="summary-empty">当前蓝图没有已完整配置的可选媒体能力。</span>}<p className="field-hint">只会冻结以下已启用且完整配置的能力；分镜没有声明需求时不会创建对应任务。</p></section><p className="form-hint">标题只是管理元数据，后续修改不会使已导入内容失效。</p></> : <p className="form-error">当前账号没有启用蓝图，请先激活一个蓝图版本。</p>}{isPending ? <section aria-live="polite" className="episode-creation-progress" role="status"><strong>正在创建生产单</strong><ol>{episodeCreationSteps.map((step, index) => <li className={index < activeStepIndex ? "is-complete" : index === activeStepIndex ? "is-active" : ""} key={step.id}><i aria-hidden="true">{index < activeStepIndex ? "✓" : index + 1}</i><span><b>{step.label}</b></span></li>)}</ol><p className="episode-creation-current">{activeStep.note} 本阶段已等待 {elapsedSeconds} 秒。</p></section> : null}{episodePreflight ? <details aria-live="polite" className={`production-preflight ${blockers.length ? "is-blocked" : "is-passed"}`} role="alert"><summary><strong>创建前可生产性检查：未通过（{blockers.length}）</strong><span>展开阻塞详情</span></summary><div className="production-preflight-body"><p>本次检查未通过，因此尚未创建生产单。处理下面的原因后，点击“创建生产单”重新检查。</p>{blockers.map((blocker) => <WorkerBlockerCard blocker={blocker} key={`${blocker.code}-${blocker.capability}`} onOpenBlueprint={onOpenBlueprint ? () => onOpenBlueprint(accountId) : undefined} />)}</div></details> : null}<div className="modal-actions"><button className="button button-secondary" disabled={isPending} onClick={onClose} type="button">取消</button><button className="button button-primary" disabled={isPending || !accountId || !canCreateEpisode} type="submit">{isPending ? "正在处理…" : "创建生产单"}</button></div></form></div>;
}

