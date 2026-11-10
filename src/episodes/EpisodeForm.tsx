import {HelpTip} from '../ui/HelpTip';
import {useDialogFocus} from '../ui/useDialogFocus';
import {Disclosure} from '../ui/dan-ui/components/base/disclosure/disclosure';
import {InputBase} from '../ui/dan-ui/components/base/input/input';
import {NativeSelect} from '../ui/dan-ui/components/base/select/select-native';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import {useEffect,useId,useState,type FormEvent} from 'react';
import {X} from 'lucide-react';
import type {Database} from '../lib/database.types';
import {WorkerBlockerCard} from '../reviews/WorkerBlockerCard';
import {workerBlockersFromPreflight} from '../reviews/reviewSelectors';
import type {WorkerPreflightResult} from '../worker/contracts';
type Account=Database['public']['Tables']['accounts']['Row'];
type Series=Database['public']['Tables']['series']['Row'];
type SeriesVersion=Database['public']['Tables']['series_versions']['Row'];
export type EpisodeCreationStep='idle'|'preflight'|'create'|'directory'|'refresh';
const episodeCreationSteps: Array<{ id: Exclude<EpisodeCreationStep, "idle">; label: string; note: string }> = [
  { id: "create", label: "创建生产单", note: "冻结当前蓝图和系列版本。" },
  { id: "directory", label: "准备本地材料目录", note: "建立本期独占目录。" },
  { id: "refresh", label: "打开生产单", note: "同步最新状态和待导入材料。" },
];

export function EpisodeForm({ accounts, initialAccountId, initialSeriesVersionId, creationStartedAt = null, creationStep = "idle", isPending, onClose, onOpenBlueprint, onSubmit, preflight = null, series, seriesVersions }: { accounts: Account[]; initialAccountId?: string; initialSeriesVersionId?: string; creationStartedAt?: number | null; creationStep?: EpisodeCreationStep; isPending: boolean; onClose: () => void; onOpenBlueprint?: (accountId: string) => void; onSubmit: (input: { title: string; accountId: string; isTest: boolean; seriesVersionId: string | null }) => Promise<WorkerPreflightResult | null>; preflight?: WorkerPreflightResult | null; series: Series[]; seriesVersions: SeriesVersion[] }) {
  const [submitting, setSubmitting] = useState(false);
  const busy = isPending || submitting;
  const dialogRef = useDialogFocus<HTMLFormElement>(true, () => { if (!busy) onClose(); });

  const titleHintId = useId();
  const errorId = useId();
  const [error, setError] = useState("");
  const [title, setTitle] = useState("");
  const [accountId, setAccountId] = useState(() => accounts.find(account => account.id === initialAccountId)?.id ?? accounts[0]?.id ?? "");
  const [episodePreflight, setEpisodePreflight] = useState<WorkerPreflightResult | null>(preflight);
  const [now, setNow] = useState(Date.now());
  const seriesById = new Map(series.map((candidate) => [candidate.id, candidate]));
  const availableVersions = series.filter(candidate => candidate.account_id === accountId).flatMap(candidate => {
    const current = seriesVersions.filter(version => version.account_id === accountId && version.series_id === candidate.id).sort((left, right) => right.version - left.version)[0];
    return current ? [current] : [];
  });
  const [seriesVersionId, setSeriesVersionId] = useState(() => availableVersions.find(version => version.id === initialSeriesVersionId)?.id ?? "");
  const selectedAccount = accounts.find((account) => account.id === accountId);
  const canCreateEpisode = Boolean(selectedAccount?.current_blueprint_version_id);
  const blockers = workerBlockersFromPreflight(episodePreflight);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !canCreateEpisode) return;
    setSubmitting(true);
    setEpisodePreflight(null);
    setError("");
    try {
      const result = await onSubmit({ accountId, isTest: false, seriesVersionId: seriesVersionId || null, title });
      if (result) setEpisodePreflight(result);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setSubmitting(false);
    }
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
  return <div className="modal-backdrop"  role="dialog" aria-modal="true" aria-label="新建生产单"><form ref={dialogRef} aria-label="新建生产单" aria-describedby={error ? errorId : undefined} aria-busy={busy} className="modal-card episode-form-modal" onSubmit={(event) => void submit(event)}><header><div><h2>新建生产单</h2><p>使用当前蓝图与系列快照。</p></div><Button size="sm" color="tertiary" aria-label="关闭新建生产单" isDisabled={busy} className="icon-button" onClick={onClose} type="button"><X size={18} aria-hidden="true" /></Button></header><label>账号<NativeSelect size="sm" data-dialog-initial-focus={!canCreateEpisode&&accounts.length>0?true:undefined} disabled={busy||!accounts.length} onChange={(event) => { setAccountId(event.target.value); setSeriesVersionId(""); setEpisodePreflight(null); }} value={accountId}>{!accounts.length&&<option value="">暂无可用账号</option>}{accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</NativeSelect></label><label><span className="field-label">系列版本<HelpTip label="系列版本">可不关联系列。所选系列版本会随生产单冻结，后续版本变更不会影响本单。</HelpTip></span><NativeSelect size="sm" disabled={busy} aria-label="系列版本" onChange={(event) => { setSeriesVersionId(event.target.value); setEpisodePreflight(null); }} value={seriesVersionId}><option value="">不关联系列</option>{availableVersions.map((version) => <option key={version.id} value={version.id}>{seriesById.get(version.series_id)?.name ?? "未知系列"} · 当前 v{version.version}</option>)}</NativeSelect></label><div className="episode-title-input"><InputBase size="sm" aria-label="工作标题（可留空）" aria-describedby={titleHintId} maxLength={200} isDisabled={busy} data-dialog-initial-focus={canCreateEpisode?true:undefined} onChange={(event) => setTitle(event.target.value)} placeholder="输入工作标题（可留空）" value={title} /></div><p id={titleHintId} className="field-hint episode-title-limit">{title.length} / 200 字符</p>{error && <p id={errorId} className="form-error" role="alert">{error}</p>}{!canCreateEpisode && <p className="form-error" role="alert">{accounts.length?"当前账号没有启用蓝图，请先激活一个蓝图版本。":"请先创建账号，再新建生产单。"}</p>}{isPending ? <section aria-live="polite" className="episode-creation-progress" role="status"><strong>正在创建生产单</strong><ol>{episodeCreationSteps.map((step, index) => <li className={index < activeStepIndex ? "is-complete" : index === activeStepIndex ? "is-active" : ""} key={step.id}><i aria-hidden="true">{index < activeStepIndex ? "✓" : index + 1}</i><span><b>{step.label}</b></span></li>)}</ol><p className="episode-creation-current">{activeStep.note} 本阶段已等待 {elapsedSeconds} 秒。</p></section> : null}{episodePreflight ? <Disclosure label={<><strong>创建条件未满足（{blockers.length}）</strong><span>展开阻塞详情</span></>} aria-live="polite" className={`production-preflight ${blockers.length ? "is-blocked" : "is-passed"}`} role="alert"><div className="production-preflight-body"><p>生产单尚未创建。处理以下原因后重试。</p>{blockers.map((blocker) => <WorkerBlockerCard blocker={blocker} key={`${blocker.code}-${blocker.capability}`} onOpenBlueprint={onOpenBlueprint ? () => onOpenBlueprint(accountId) : undefined} />)}</div></Disclosure> : null}<div className="modal-actions"><Button size="sm" color="secondary" className="button button-secondary" isDisabled={busy} onClick={onClose} type="button">取消</Button><Button size="sm" color="primary" className="button button-primary" isDisabled={busy || !accountId || !canCreateEpisode} type="submit">{busy ? "正在处理…" : "创建生产单"}</Button></div></form></div>;
}

