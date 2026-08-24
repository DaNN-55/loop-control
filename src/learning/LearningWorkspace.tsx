import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { Database, Json } from "../lib/database.types";

type Account = Database["public"]["Tables"]["accounts"]["Row"];
type BlueprintVersion = Database["public"]["Tables"]["account_blueprint_versions"]["Row"];
type BlueprintChangeSuggestion = Database["public"]["Tables"]["blueprint_change_suggestions"]["Row"];
type Episode = Database["public"]["Tables"]["episodes"]["Row"];
type Experiment = Database["public"]["Tables"]["experiments"]["Row"];
type LearningReport = Database["public"]["Tables"]["learning_reports"]["Row"];
type MetricSnapshot = Database["public"]["Tables"]["metric_snapshots"]["Row"];
type LearningRecommendation = LearningReport["recommendation"];
type LearningStep = "experiment" | "metrics" | "report" | "suggestion" | "approval" | "completed";

export interface SaveExperimentInput {
  episodeId: string;
  hypothesis: string;
  primaryVariable: string;
  primaryMetric: string;
  guardrailMetrics: string[];
}

export interface SaveMetricSnapshotInput {
  episodeId: string;
  capturedAt: string;
  metrics: Record<string, number>;
}

export interface SaveLearningReportInput {
  episodeId: string;
  recommendation: LearningRecommendation;
  summary: string;
}

export interface SaveBlueprintChangeSuggestionInput {
  learningReportId: string;
  proposedPolicy: Json;
  rationale: string;
}

export interface ApproveBlueprintChangeSuggestionInput {
  suggestionId: string;
  decisionReason: string;
}

export function LearningWorkspace({ accountsById, blueprintVersionsById, episodes, experiments, learningReports = [], metricSnapshots, blueprintChangeSuggestions = [], isPreparingDemo = false, onPrepareLearningDemo, onSaveExperiment, onSaveMetricSnapshot, onSaveLearningReport, onSaveBlueprintChangeSuggestion, onApproveBlueprintChangeSuggestion }: {
  accountsById: Map<string, Account>;
  blueprintVersionsById: Map<string, BlueprintVersion>;
  episodes: Episode[];
  experiments: Experiment[];
  learningReports: LearningReport[];
  metricSnapshots: MetricSnapshot[];
  blueprintChangeSuggestions: BlueprintChangeSuggestion[];
  isPreparingDemo?: boolean;
  onPrepareLearningDemo?: () => Promise<void>;
  onSaveExperiment: (input: SaveExperimentInput) => Promise<void>;
  onSaveMetricSnapshot: (input: SaveMetricSnapshotInput) => Promise<void>;
  onSaveLearningReport: (input: SaveLearningReportInput) => Promise<void>;
  onSaveBlueprintChangeSuggestion: (input: SaveBlueprintChangeSuggestionInput) => Promise<void>;
  onApproveBlueprintChangeSuggestion: (input: ApproveBlueprintChangeSuggestionInput) => Promise<void>;
}) {
  const experimentsByEpisodeId = new Map(experiments.map((experiment) => [experiment.episode_id, experiment]));
  const reportsByEpisodeId = new Map(learningReports.map((report) => [report.episode_id, report]));
  const suggestionsByReportId = new Map<string, BlueprintChangeSuggestion[]>();
  const snapshotsByEpisodeId = new Map<string, MetricSnapshot[]>();
  for (const snapshot of metricSnapshots) {
    const existing = snapshotsByEpisodeId.get(snapshot.episode_id) ?? [];
    existing.push(snapshot);
    snapshotsByEpisodeId.set(snapshot.episode_id, existing);
  }
  for (const suggestion of blueprintChangeSuggestions) {
    const existing = suggestionsByReportId.get(suggestion.learning_report_id) ?? [];
    existing.push(suggestion);
    suggestionsByReportId.set(suggestion.learning_report_id, existing);
  }
  const learningEpisodes = episodes.filter((episode) => episode.stage === "metrics_collecting" || (episode.stage === "learning_recorded" && experimentsByEpisodeId.has(episode.id)));
  const demoAction = onPrepareLearningDemo ? <div className="learning-demo-actions"><button className="button button-secondary" disabled={isPreparingDemo} onClick={() => void onPrepareLearningDemo()} type="button">{isPreparingDemo ? "准备中…" : "准备复盘演示数据"}</button></div> : null;
  const episodeViewModels = learningEpisodes.map((episode) => {
    const experiment = experimentsByEpisodeId.get(episode.id);
    const report = reportsByEpisodeId.get(episode.id);
    const snapshots = snapshotsByEpisodeId.get(episode.id) ?? [];
    const suggestions = report ? suggestionsByReportId.get(report.id) ?? [] : [];
    const sourceBlueprint = blueprintVersionsById.get(episode.blueprint_version_id) ?? null;
    const step = getLearningStep({ episodeStage: episode.stage, experiment, report, snapshots, suggestions });
    return { episode, experiment, report, snapshots, suggestions, sourceBlueprint, step };
  });
  const activeEpisodes = episodeViewModels.filter(({ step }) => step !== "completed");
  const completedEpisodes = episodeViewModels.filter(({ step }) => step === "completed");
  const [activeEpisodeId, setActiveEpisodeId] = useState<string | null>(activeEpisodes[0]?.episode.id ?? null);
  const [detailEpisodeId, setDetailEpisodeId] = useState<string | null>(null);
  useEffect(() => {
    if (activeEpisodeId && activeEpisodes.some(({ episode }) => episode.id === activeEpisodeId)) return;
    setActiveEpisodeId(activeEpisodes[0]?.episode.id ?? null);
  }, [activeEpisodeId, activeEpisodes]);

  if (learningEpisodes.length === 0) {
    return <div className="empty-state compact"><h2>没有待录入指标的生产单</h2><p>生产单发布后进入“收集指标”，即可在这里定义实验并每周录入数据。</p>{onPrepareLearningDemo ? <><p>可以准备一组隔离的复盘演示账号和生产单，不会触发 Worker，也不会混入真实账号。</p>{demoAction}</> : null}</div>;
  }

  const detailEpisode = completedEpisodes.find(({ episode }) => episode.id === detailEpisodeId) ?? null;

  return <section className="learning-workspace" aria-label="复盘工作台"><header className="learning-workspace-heading"><div><p className="learning-eyebrow">学习闭环</p><h2>复盘工作台</h2><p className="muted-copy">围绕一个实验，记录每周数据，形成结论，再决定是否调整后续生产规则。</p></div>{demoAction}</header><div className="learning-stats" aria-label="复盘状态汇总"><LearningStat count={activeEpisodes.filter(({ step }) => step === "metrics").length} label="待录入指标" /><LearningStat count={activeEpisodes.filter(({ step }) => step === "report").length} label="待写复盘报告" /><LearningStat count={activeEpisodes.filter(({ step }) => step === "suggestion" || step === "approval").length} label="待处理建议" /></div>{activeEpisodes.length ? <section className="learning-section" aria-labelledby="learning-pending-title"><header className="learning-section-heading"><div><h2 id="learning-pending-title">待处理</h2><p>每次只完成当前生产单的一个下一步。</p></div><span>{activeEpisodes.length} 个生产单</span></header><div className="learning-list">{activeEpisodes.map((viewModel) => <LearningEpisodeCard accountsById={accountsById} isExpanded={activeEpisodeId === viewModel.episode.id} key={viewModel.episode.id} onApproveBlueprintChangeSuggestion={onApproveBlueprintChangeSuggestion} onExpand={() => setActiveEpisodeId(viewModel.episode.id)} onSaveBlueprintChangeSuggestion={onSaveBlueprintChangeSuggestion} onSaveExperiment={onSaveExperiment} onSaveLearningReport={onSaveLearningReport} onSaveMetricSnapshot={onSaveMetricSnapshot} viewModel={viewModel} />)}</div></section> : null}{completedEpisodes.length ? <section className="learning-section" aria-labelledby="learning-completed-title"><header className="learning-section-heading"><div><h2 id="learning-completed-title">已完成</h2><p>完成的复盘保留在这里，点击查看完整记录。</p></div><span>{completedEpisodes.length} 个生产单</span></header><div className="learning-completed-list">{completedEpisodes.map(({ episode, report, suggestions }) => <button className="learning-completed-card" key={episode.id} onClick={() => setDetailEpisodeId(episode.id)} type="button"><span className="learning-completed-card-main"><strong>{episode.title}</strong><small>{accountsById.get(episode.account_id)?.name ?? "未知账号"} · 已完成复盘</small></span><span className="learning-completed-card-result">{report ? recommendationLabels[report.recommendation] : "已完成"}{suggestions.length ? ` · ${suggestions[0].status === "approved" ? "蓝图已更新" : suggestions[0].status === "rejected" ? "建议已拒绝" : "建议已提交"}` : ""}</span><span aria-hidden="true" className="learning-completed-card-arrow">›</span></button>)}</div></section> : null}{detailEpisode ? <LearningDetailDrawer accountsById={accountsById} onApproveBlueprintChangeSuggestion={onApproveBlueprintChangeSuggestion} onClose={() => setDetailEpisodeId(null)} onSaveBlueprintChangeSuggestion={onSaveBlueprintChangeSuggestion} viewModel={detailEpisode} /> : null}</section>;
}

function LearningStat({ count, label }: { count: number; label: string }) {
  return <div className="learning-stat"><strong>{count}</strong><span>{label}</span></div>;
}

type LearningViewModel = {
  episode: Episode;
  experiment: Experiment | undefined;
  report: LearningReport | undefined;
  snapshots: MetricSnapshot[];
  suggestions: BlueprintChangeSuggestion[];
  sourceBlueprint: BlueprintVersion | null;
  step: LearningStep;
};

function LearningEpisodeCard({ accountsById, isExpanded, onApproveBlueprintChangeSuggestion, onExpand, onSaveBlueprintChangeSuggestion, onSaveExperiment, onSaveLearningReport, onSaveMetricSnapshot, viewModel }: { accountsById: Map<string, Account>; isExpanded: boolean; onApproveBlueprintChangeSuggestion: (input: ApproveBlueprintChangeSuggestionInput) => Promise<void>; onExpand: () => void; onSaveBlueprintChangeSuggestion: (input: SaveBlueprintChangeSuggestionInput) => Promise<void>; onSaveExperiment: (input: SaveExperimentInput) => Promise<void>; onSaveLearningReport: (input: SaveLearningReportInput) => Promise<void>; onSaveMetricSnapshot: (input: SaveMetricSnapshotInput) => Promise<void>; viewModel: LearningViewModel }) {
  const { episode, experiment, report, snapshots, suggestions, sourceBlueprint, step } = viewModel;
  return <article className={`learning-card ${isExpanded ? "is-expanded" : ""}`}><button className="learning-card-summary" onClick={onExpand} type="button"><span><strong>{episode.title}</strong><small>{accountsById.get(episode.account_id)?.name ?? "未知账号"} · {episode.stage === "metrics_collecting" ? "收集指标" : "已记录复盘"}</small></span><span className={`learning-step-badge learning-step-${step}`}>{learningStepLabel[step]}</span><span className="learning-card-next-step">{learningStepAction[step]}</span><span aria-hidden="true" className="learning-card-arrow">{isExpanded ? "−" : "+"}</span></button>{isExpanded ? <div className="learning-card-body"><LearningStepProgress currentStep={step} /><LearningCurrentStep episode={episode} experiment={experiment} onApproveBlueprintChangeSuggestion={onApproveBlueprintChangeSuggestion} onSaveBlueprintChangeSuggestion={onSaveBlueprintChangeSuggestion} onSaveExperiment={onSaveExperiment} onSaveLearningReport={onSaveLearningReport} onSaveMetricSnapshot={onSaveMetricSnapshot} report={report} snapshots={snapshots} sourceBlueprint={sourceBlueprint} suggestions={suggestions} /></div> : null}</article>;
}

function LearningStepProgress({ currentStep }: { currentStep: LearningStep }) {
  const steps: Array<[Exclude<LearningStep, "completed" | "approval">, string]> = [["experiment", "定义实验"], ["metrics", "录入指标"], ["report", "复盘报告"], ["suggestion", "修改建议"]];
  const currentIndex = currentStep === "approval" ? 3 : steps.findIndex(([step]) => step === currentStep);
  return <ol className="learning-step-progress">{steps.map(([step, label], index) => <li className={index < currentIndex ? "is-complete" : index === currentIndex ? "is-current" : ""} key={step}><span>{index < currentIndex ? "✓" : index + 1}</span>{label}</li>)}</ol>;
}

function LearningCurrentStep({ episode, experiment, onApproveBlueprintChangeSuggestion, onSaveBlueprintChangeSuggestion, onSaveExperiment, onSaveLearningReport, onSaveMetricSnapshot, report, snapshots, sourceBlueprint, suggestions }: { episode: Episode; experiment: Experiment | undefined; onApproveBlueprintChangeSuggestion: (input: ApproveBlueprintChangeSuggestionInput) => Promise<void>; onSaveBlueprintChangeSuggestion: (input: SaveBlueprintChangeSuggestionInput) => Promise<void>; onSaveExperiment: (input: SaveExperimentInput) => Promise<void>; onSaveLearningReport: (input: SaveLearningReportInput) => Promise<void>; onSaveMetricSnapshot: (input: SaveMetricSnapshotInput) => Promise<void>; report: LearningReport | undefined; snapshots: MetricSnapshot[]; sourceBlueprint: BlueprintVersion | null; suggestions: BlueprintChangeSuggestion[] }) {
  const step = getLearningStep({ episodeStage: episode.stage, experiment, report, snapshots, suggestions });
  if (!experiment) return <section className="learning-current-step"><header><div><p className="learning-step-kicker">当前步骤</p><h3>定义实验</h3><p>先写清楚要验证的假设，以及什么数据能证明它。</p></div></header><ExperimentDefinitionForm episodeId={episode.id} onSave={onSaveExperiment} /></section>;
  return <section className="learning-current-step"><header><div><p className="learning-step-kicker">当前步骤</p><h3>{learningStepTitle[step]}</h3><p>{learningStepDescription[step]}</p></div></header><details className="learning-collapsible"><summary>查看实验定义</summary><ExperimentSummary experiment={experiment} /></details>{step === "metrics" ? <MetricSnapshotForm experiment={experiment} episodeId={episode.id} onSave={onSaveMetricSnapshot} /> : null}{step === "report" ? <><details className="learning-collapsible"><summary>查看已录入指标（{snapshots.length} 周）</summary><MetricSnapshotList snapshots={snapshots} /></details><LearningReportForm episodeId={episode.id} onSave={onSaveLearningReport} /></> : null}{step === "suggestion" && report ? <><LearningReportSummary report={report} /><BlueprintChangeSuggestionForm defaultPolicy={sourceBlueprint?.policy ?? null} learningReportId={report.id} onSave={onSaveBlueprintChangeSuggestion} sourceVersion={sourceBlueprint?.version ?? null} /></> : null}{step === "approval" && report ? <><LearningReportSummary report={report} /><BlueprintChangeSuggestionList suggestions={suggestions} onApprove={onApproveBlueprintChangeSuggestion} /></> : null}{step === "completed" ? <LearningReportSummary report={report!} /> : null}{step === "metrics" && snapshots.length ? <details className="learning-collapsible"><summary>查看已录入指标（{snapshots.length} 周）</summary><MetricSnapshotList snapshots={snapshots} /></details> : null}</section>;
}

function LearningDetailDrawer({ accountsById, onApproveBlueprintChangeSuggestion, onClose, onSaveBlueprintChangeSuggestion, viewModel }: { accountsById: Map<string, Account>; onApproveBlueprintChangeSuggestion: (input: ApproveBlueprintChangeSuggestionInput) => Promise<void>; onClose: () => void; onSaveBlueprintChangeSuggestion: (input: SaveBlueprintChangeSuggestionInput) => Promise<void>; viewModel: LearningViewModel }) {
  const { episode, experiment, report, snapshots, suggestions, sourceBlueprint } = viewModel;
  return <><div aria-hidden="true" className="learning-detail-scrim" onClick={onClose} /><aside aria-label={`${episode.title}复盘详情`} className="learning-detail-drawer"><header><div><p className="learning-eyebrow">完整记录</p><h2>{episode.title}</h2><p>{accountsById.get(episode.account_id)?.name ?? "未知账号"} · 已完成复盘</p></div><button aria-label="关闭复盘详情" className="icon-button" onClick={onClose} type="button">×</button></header>{experiment ? <section className="learning-detail-section"><h3>实验定义</h3><ExperimentSummary experiment={experiment} /></section> : null}<section className="learning-detail-section"><h3>周指标（{snapshots.length} 周）</h3><MetricSnapshotList snapshots={snapshots} /></section>{report ? <section className="learning-detail-section"><LearningReportSummary report={report} /></section> : null}{suggestions.length ? <section className="learning-detail-section"><BlueprintChangeSuggestionList onApprove={onApproveBlueprintChangeSuggestion} suggestions={suggestions} /></section> : report && report.recommendation === "change" ? <section className="learning-detail-section"><BlueprintChangeSuggestionForm defaultPolicy={sourceBlueprint?.policy ?? null} learningReportId={report.id} onSave={onSaveBlueprintChangeSuggestion} sourceVersion={sourceBlueprint?.version ?? null} /></section> : null}</aside></>;
}

function getLearningStep({ episodeStage, experiment, report, snapshots, suggestions }: { episodeStage?: Episode["stage"]; experiment: Experiment | undefined; report: LearningReport | undefined; snapshots: MetricSnapshot[]; suggestions: BlueprintChangeSuggestion[] }): LearningStep {
  if (!experiment) return "experiment";
  if (episodeStage === "learning_recorded" && report) {
    if (report.recommendation === "change" && !suggestions.length) return "suggestion";
    if (suggestions.some((suggestion) => suggestion.status === "pending")) return "approval";
    return "completed";
  }
  if (!snapshots.length) return "metrics";
  if (!report) return "report";
  if (report.recommendation === "change" && !suggestions.length) return "suggestion";
  if (suggestions.some((suggestion) => suggestion.status === "pending")) return "approval";
  return "completed";
}

const learningStepLabel: Record<LearningStep, string> = { experiment: "待定义", metrics: "待录入", report: "待复盘", suggestion: "待提议", approval: "待审批", completed: "已完成" };
const learningStepAction: Record<LearningStep, string> = { experiment: "先定义实验", metrics: "录入本周数据", report: "形成复盘结论", suggestion: "提出蓝图修改", approval: "Owner 审批建议", completed: "查看完整记录" };
const learningStepTitle: Record<LearningStep, string> = { experiment: "定义实验", metrics: "录入本周指标", report: "记录复盘报告", suggestion: "提交修改建议", approval: "审批蓝图修改", completed: "复盘已完成" };
const learningStepDescription: Record<LearningStep, string> = { experiment: "", metrics: "每周录入主指标和护栏指标，数据来自外部平台。", report: "对比已录入数据，写下本次实验的结论。", suggestion: "只在结论需要改变规则时提出蓝图修改。", approval: "确认修改理由和影响范围，再决定是否激活新版本。", completed: "这条生产单已经完成复盘，可以查看完整记录。" };

function ExperimentDefinitionForm({ episodeId, onSave }: { episodeId: string; onSave: (input: SaveExperimentInput) => Promise<void> }) {
  const [hypothesis, setHypothesis] = useState("");
  const [primaryVariable, setPrimaryVariable] = useState("");
  const [primaryMetric, setPrimaryMetric] = useState("");
  const [guardrailOne, setGuardrailOne] = useState("");
  const [guardrailTwo, setGuardrailTwo] = useState("");
  const [error, setError] = useState("");
  const [isPending, setIsPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsPending(true);
    setError("");
    try {
      await onSave({ episodeId, hypothesis: hypothesis.trim(), primaryVariable: primaryVariable.trim(), primaryMetric: primaryMetric.trim(), guardrailMetrics: [guardrailOne, guardrailTwo].map((value) => value.trim()).filter(Boolean) });
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : "无法保存实验定义。");
    } finally {
      setIsPending(false);
    }
  }

  return <form className="learning-form" onSubmit={submit}><h3>定义实验</h3><label>实验假设<textarea aria-label="实验假设" onChange={(event) => setHypothesis(event.target.value)} placeholder="例如：开头直接给出动作建议会提高播放量。" required rows={3} value={hypothesis} /></label><label>主要变量<input aria-label="主要变量" onChange={(event) => setPrimaryVariable(event.target.value)} placeholder="例如：开头是否直接给出动作建议" required value={primaryVariable} /></label><label>主指标<input aria-label="主指标" onChange={(event) => setPrimaryMetric(event.target.value)} placeholder="例如：播放量" required value={primaryMetric} /></label><div className="metric-grid"><label>护栏指标 1<input aria-label="护栏指标 1" onChange={(event) => setGuardrailOne(event.target.value)} placeholder="例如：完播率" value={guardrailOne} /></label><label>护栏指标 2<input aria-label="护栏指标 2" onChange={(event) => setGuardrailTwo(event.target.value)} placeholder="例如：互动率" value={guardrailTwo} /></label></div><p className="field-hint">护栏指标最多两个；保存后不能改为另一个实验。</p><button className="button button-primary" disabled={isPending} type="submit">{isPending ? "保存中…" : "保存实验定义"}</button>{error ? <p className="form-error">{error}</p> : null}</form>;
}

function ExperimentSummary({ experiment }: { experiment: Experiment }) {
  return <section className="experiment-summary"><h3>实验定义</h3><p>{experiment.hypothesis}</p><dl><div><dt>主要变量</dt><dd>{experiment.primary_variable}</dd></div><div><dt>主指标</dt><dd>{experiment.primary_metric}</dd></div><div><dt>护栏指标</dt><dd>{experiment.guardrail_metrics.length ? experiment.guardrail_metrics.join("、") : "未设置"}</dd></div></dl></section>;
}

function MetricSnapshotForm({ episodeId, experiment, onSave }: { episodeId: string; experiment: Experiment; onSave: (input: SaveMetricSnapshotInput) => Promise<void> }) {
  const metricNames = [experiment.primary_metric, ...experiment.guardrail_metrics];
  const [week, setWeek] = useState("");
  const [metricValues, setMetricValues] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [isPending, setIsPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsPending(true);
    setError("");
    try {
      const capturedAt = isoWeekStart(week);
      const metrics = Object.fromEntries(metricNames.map((name) => [name, Number(metricValues[name])])) as Record<string, number>;
      await onSave({ episodeId, capturedAt, metrics });
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : "无法保存本周指标。");
    } finally {
      setIsPending(false);
    }
  }

  return <form className="learning-form metric-snapshot-form" onSubmit={submit}><h3>录入本周指标</h3><label>指标周<input aria-label="指标周" onChange={(event) => setWeek(event.target.value)} required type="week" value={week} /></label><div className="metric-grid">{metricNames.map((metricName) => <label key={metricName}>{metricName}<input aria-label={metricName} min="0" onChange={(event) => setMetricValues((values) => ({ ...values, [metricName]: event.target.value }))} required step="any" type="number" value={metricValues[metricName] ?? ""} /></label>)}</div><button className="button button-primary" disabled={isPending} type="submit">{isPending ? "保存中…" : "保存本周指标"}</button>{error ? <p className="form-error">{error}</p> : null}</form>;
}

function MetricSnapshotList({ snapshots }: { snapshots: MetricSnapshot[] }) {
  if (snapshots.length === 0) return <p className="field-hint">尚未录入周指标。</p>;
  return <section className="metric-snapshot-list"><h3>已录入指标</h3><ul>{snapshots.map((snapshot) => <li key={snapshot.id}><strong>{formatWeek(snapshot.captured_at)}</strong><span>{formatMetrics(snapshot.metrics)}</span></li>)}</ul></section>;
}

function LearningReportForm({ episodeId, onSave }: { episodeId: string; onSave: (input: SaveLearningReportInput) => Promise<void> }) {
  const [recommendation, setRecommendation] = useState<LearningRecommendation>("insufficient_data");
  const [summary, setSummary] = useState("");
  const [error, setError] = useState("");
  const [isPending, setIsPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsPending(true);
    setError("");
    try {
      await onSave({ episodeId, recommendation, summary: summary.trim() });
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : "无法记录复盘报告。");
    } finally {
      setIsPending(false);
    }
  }

  return <form className="learning-form" onSubmit={submit}><h3>记录复盘报告</h3><label>复盘建议<select aria-label="复盘建议" onChange={(event) => setRecommendation(event.target.value as LearningRecommendation)} value={recommendation}>{Object.entries(recommendationLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>复盘结论<textarea aria-label="复盘结论" onChange={(event) => setSummary(event.target.value)} placeholder="说明指标表现、主要变量和后续建议。" required rows={4} value={summary} /></label><p className="field-hint">提交后会记录复盘并将生产单标记为“已记录复盘”；该生产单的周指标随后锁定。</p><button className="button button-primary" disabled={isPending} type="submit">{isPending ? "记录中…" : "记录复盘报告"}</button>{error ? <p className="form-error">{error}</p> : null}</form>;
}

function LearningReportSummary({ report }: { report: LearningReport }) {
  return <section className="learning-report-summary"><h3>复盘报告</h3><p><strong>{recommendationLabels[report.recommendation]}</strong>{report.summary}</p></section>;
}

function BlueprintChangeSuggestionForm({ defaultPolicy, learningReportId, onSave, sourceVersion }: { defaultPolicy: Json | null; learningReportId: string; onSave: (input: SaveBlueprintChangeSuggestionInput) => Promise<void>; sourceVersion: number | null }) {
  const [rationale, setRationale] = useState("");
  const [policy, setPolicy] = useState(() => JSON.stringify(defaultPolicy ?? {}, null, 2));
  const [error, setError] = useState("");
  const [isPending, setIsPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsPending(true);
    setError("");
    try {
      const proposedPolicy = parsePolicy(policy);
      await onSave({ learningReportId, proposedPolicy, rationale: rationale.trim() });
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : "无法提交蓝图变更建议。");
    } finally {
      setIsPending(false);
    }
  }

  return <form className="learning-form" onSubmit={submit}><h3>蓝图变更建议</h3><p className="field-hint">建议以该生产单固定的蓝图 {sourceVersion ? `v${sourceVersion}` : "版本"} 为基础。提交建议不会修改当前蓝图。</p><label>变更理由<textarea aria-label="变更理由" onChange={(event) => setRationale(event.target.value)} placeholder="说明这次复盘为什么需要修改蓝图。" required rows={3} value={rationale} /></label><label>建议蓝图规则<textarea aria-label="建议蓝图规则" onChange={(event) => setPolicy(event.target.value)} required rows={10} value={policy} /></label><button className="button button-primary" disabled={isPending} type="submit">{isPending ? "提交中…" : "提交蓝图变更建议"}</button>{error ? <p className="form-error">{error}</p> : null}</form>;
}

function BlueprintChangeSuggestionList({ onApprove, suggestions }: { onApprove: (input: ApproveBlueprintChangeSuggestionInput) => Promise<void>; suggestions: BlueprintChangeSuggestion[] }) {
  return <section className="blueprint-change-suggestions"><h3>蓝图变更建议</h3>{suggestions.map((suggestion) => <BlueprintChangeSuggestionCard key={suggestion.id} onApprove={onApprove} suggestion={suggestion} />)}</section>;
}

function BlueprintChangeSuggestionCard({ onApprove, suggestion }: { onApprove: (input: ApproveBlueprintChangeSuggestionInput) => Promise<void>; suggestion: BlueprintChangeSuggestion }) {
  const [decisionReason, setDecisionReason] = useState("");
  const [error, setError] = useState("");
  const [isPending, setIsPending] = useState(false);

  async function approve(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsPending(true);
    setError("");
    try {
      await onApprove({ suggestionId: suggestion.id, decisionReason: decisionReason.trim() });
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : "无法批准蓝图变更建议。");
    } finally {
      setIsPending(false);
    }
  }

  return <article className="blueprint-change-suggestion"><p>{suggestion.rationale}</p><details className="blueprint-policy-details"><summary>查看完整蓝图规则</summary><pre>{JSON.stringify(suggestion.proposed_policy, null, 2)}</pre></details>{suggestion.status === "pending" ? <form className="learning-form" onSubmit={approve}><label>批准理由<textarea aria-label="批准理由" onChange={(event) => setDecisionReason(event.target.value)} placeholder="说明批准该变更的依据。" required rows={3} value={decisionReason} /></label><p className="field-hint">批准后系统会创建并激活新蓝图版本；它只会影响之后新建的生产单。</p><button className="button button-primary" disabled={isPending} type="submit">{isPending ? "批准中…" : "批准并激活新蓝图版本"}</button>{error ? <p className="form-error">{error}</p> : null}</form> : <p className="field-hint">{suggestion.status === "approved" ? `已批准并生成蓝图 ${suggestion.proposed_blueprint_version_id ?? "版本"}。` : `已拒绝：${suggestion.decision_reason}`}</p>}</article>;
}

const recommendationLabels: Record<LearningRecommendation, string> = {
  keep: "保留",
  change: "修改",
  kill: "停止",
  insufficient_data: "数据不足",
};

function isoWeekStart(week: string): string {
  const match = /^(\d{4})-W(\d{2})$/.exec(week);
  if (!match) throw new Error("请选择有效的指标周。");
  const year = Number(match[1]);
  const weekNumber = Number(match[2]);
  if (weekNumber < 1 || weekNumber > 53) throw new Error("请选择有效的指标周。");
  const januaryFourth = new Date(Date.UTC(year, 0, 4));
  const firstMonday = new Date(januaryFourth);
  firstMonday.setUTCDate(januaryFourth.getUTCDate() - ((januaryFourth.getUTCDay() + 6) % 7));
  firstMonday.setUTCDate(firstMonday.getUTCDate() + (weekNumber - 1) * 7);
  return firstMonday.toISOString();
}

function formatWeek(capturedAt: string): string {
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(capturedAt));
}

function formatMetrics(metrics: Database["public"]["Tables"]["metric_snapshots"]["Row"]["metrics"]): string {
  if (!metrics || Array.isArray(metrics) || typeof metrics !== "object") return "没有可显示的指标。";
  return Object.entries(metrics).map(([name, value]) => `${name}：${value}`).join(" · ");
}

function parsePolicy(source: string): Json {
  const parsed: unknown = JSON.parse(source);
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") throw new Error("建议蓝图规则必须是 JSON 对象。");
  return parsed as Json;
}
