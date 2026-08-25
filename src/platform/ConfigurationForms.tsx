import { useEffect, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import type { Database, Json } from "../lib/database.types";
import { supabase } from "../lib/supabase";
import { HelpTip } from "../ui/HelpTip";
import type { LocalSystemStatusReport, SystemState } from "../observability/SystemStatusPanel";
import type { WorkerPreflightResult } from "../worker/contracts";
import { adapterRegistration, isOwnerManagedConnection, mediaCapabilityForKey, registeredAdaptersForCapability } from "../worker/adapterRegistry";
import { externalConnectionStatuses, type ExternalConnectionStatus } from "./connectionStatus";
import {
  blueprintFormToPolicy,
  blueprintPolicyToForm,
  configurableMediaAdapterKeys,
  defaultMediaAdapterForm,
  mediaAdapterKeys,
  seriesFormToRules,
  seriesRulesToForm,
  mediaAdapterStatus,
  validateMediaAdapter,
  validateSeriesRules,
  type BlueprintFormValues,
  type ConfigurableMediaAdapterKey,
  type MediaAdapterForm,
  type MediaAdapterKey,
  type SeriesFormValues,
} from "./configurationFormValues";

type PromptVersion = Database["public"]["Tables"]["prompt_versions"]["Row"];
type PromptCapability = PromptVersion["capability"];
type ExternalConnection = Database["public"]["Tables"]["external_connections"]["Row"];

const approvalGateOptions = [
  ["script", "脚本审核"],
  ["visual", "视觉审核"],
  ["storyboard", "分镜审核"],
  ["qc", "QC 审核"],
  ["publish", "发布确认"],
] as const;
const toolOptions = [
  ["read", "读取本地素材"],
  ["write", "写入本地产物"],
] as const;
const executorLabels = {
  script_writing: "脚本生成",
  visual_planning: "视觉规划",
  storyboard_planning: "分镜规划",
} as const;
const visibleExecutorKeys = ["storyboard_planning"] as const;
const promptCapabilityOptions: Array<[PromptCapability, string]> = [
  ["storyboard_planning", "分镜规划"],
];
const googleTtsVoices: Record<string, readonly string[]> = {
  "en-US": ["en-US-Standard-A", "en-US-Standard-B", "en-US-Standard-C", "en-US-Standard-D"],
  "zh-CN": ["cmn-CN-Standard-A", "cmn-CN-Standard-B", "cmn-CN-Standard-C", "cmn-CN-Standard-D", "cmn-CN-standard-cm"],
  "vi-VN": ["vi-VN-Standard-A", "vi-VN-Standard-B", "vi-VN-Standard-C", "vi-VN-Standard-D"],
};
function FieldHint({ children }: { children: ReactNode }) {
  return <p className="field-hint">{children}</p>;
}

function FieldLabel({ children, help }: { children: ReactNode; help?: string }) {
  return <span className="field-label">{children}{help ? <HelpTip label={typeof children === "string" ? children : "字段"}>{help}</HelpTip> : null}</span>;
}

function PromptVersionManager({ fixedCapability, isPending, onCreate, promptVersions, onSelect }: { fixedCapability?: PromptCapability; isPending: boolean; onCreate?: (input: { capability: PromptCapability; name: string; summary: string; instructions: string }) => Promise<PromptVersion | null>; promptVersions: PromptVersion[]; onSelect: (version: PromptVersion) => void }) {
  const [capability, setCapability] = useState<PromptCapability>(fixedCapability ?? "storyboard_planning");
  const [name, setName] = useState("");
  const [summary, setSummary] = useState("");
  const [instructions, setInstructions] = useState("");
  const [error, setError] = useState("");
  if (!onCreate) return null;
  const create = onCreate;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim() || !summary.trim() || !instructions.trim()) {
      setError("请填写版本名称、摘要和 Harness 内容。");
      return;
    }
    setError("");
    const created = await create({ capability, name: name.trim(), summary: summary.trim(), instructions: instructions.trim() });
    if (!created) return;
    onSelect(created);
    setName("");
    setSummary("");
    setInstructions("");
  }

  const visibleCapabilities = fixedCapability ? promptCapabilityOptions.filter(([key]) => key === fixedCapability) : promptCapabilityOptions;
  return <details className="prompt-version-manager">
    <summary><FieldLabel help="Prompt 版本是执行规则的可追溯版本。这里登记新版本，蓝图只选择已登记版本；生产单创建后会冻结当时的选择。">Prompt 版本管理</FieldLabel></summary>
    <div className="prompt-version-manager-body">
      <div className="prompt-version-catalog" aria-label="Prompt 版本目录">
        {visibleCapabilities.map(([key, label]) => <section key={key}>
          <h4>{label}</h4>
          {promptVersions.filter((version) => version.capability === key).length ? promptVersions.filter((version) => version.capability === key).map((version) => <article className="prompt-version-item" key={version.id}>
            <div><strong>{version.name}</strong><span>{version.slug}</span></div>
            <p>{version.summary}</p>
          </article>) : <p className="muted-copy">还没有登记版本。</p>}
        </section>)}
      </div>
      <form className="prompt-version-create" onSubmit={(event) => void submit(event)}>
        <h4>登记新版本</h4>
        <p className="muted-copy">保存后自动生成下一版编号，例如 script-writing-v2。</p>
        {fixedCapability ? <p className="muted-copy">适用阶段：{executorLabels[fixedCapability]}</p> : <label><FieldLabel help="选择这版 Prompt 服务的生成阶段。">适用阶段</FieldLabel><select onChange={(event) => setCapability(event.target.value as PromptCapability)} value={capability}>{promptCapabilityOptions.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>}
        <label><FieldLabel help="给运营人员看的名称，不是 Worker 识别用的 slug。">版本名称</FieldLabel><input onChange={(event) => setName(event.target.value)} placeholder="例如：脚本生成·强化冲突 v2" value={name} /></label>
        <label><FieldLabel help="用一句话说明这一版主要改变了什么。">版本摘要</FieldLabel><input onChange={(event) => setSummary(event.target.value)} placeholder="例如：强化开头钩子和人物动机" value={summary} /></label>
        <label><FieldLabel help="这是会冻结并实际发送给 Codex 的 Prompt Harness 内容。">Harness 内容</FieldLabel><textarea onChange={(event) => setInstructions(event.target.value)} placeholder="例如：开头 3 秒必须提出冲突；结尾保留审核所需的事实依据。" rows={3} value={instructions} /></label>
        <button className="button button-secondary" disabled={isPending} type="submit">{isPending ? "登记中…" : "登记新版本"}</button>
        {error ? <p className="form-error">{error}</p> : null}
      </form>
    </div>
  </details>;
}

function ConfigurationSwitch({ ariaLabel, checked, disabled = false, label, onChange }: { ariaLabel?: string; checked: boolean; disabled?: boolean; label: string; onChange: (checked: boolean) => void }) {
  return <label className="configuration-switch"><input aria-label={ariaLabel} checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} type="checkbox" /><span aria-hidden="true" className="configuration-switch-track" /><span>{label}</span></label>;
}

function StageConfigurationDialog({ executor, executorKey, inline = false, isPending, onClose, onCreatePromptVersion, onSelectPromptVersion, onUpdateExecutor, promptVersions, readOnly }: { executor: BlueprintFormValues["executors"]["script_writing"]; executorKey: keyof BlueprintFormValues["executors"]; inline?: boolean; isPending: boolean; onClose: () => void; onCreatePromptVersion?: (input: { capability: PromptCapability; name: string; summary: string; instructions: string }) => Promise<PromptVersion | null>; onSelectPromptVersion: (version: PromptVersion) => void; onUpdateExecutor: (field: keyof BlueprintFormValues["executors"]["script_writing"], value: string) => void; promptVersions: PromptVersion[]; readOnly: boolean }) {
  const label = executorLabels[executorKey];
  const usesPromptHarness = executorKey === "storyboard_planning";
  const versions = promptVersions.filter((version) => version.capability === executorKey && version.is_active);
  const selectedValue = usesPromptHarness ? executor.harnessId : executor.promptVersion;
  const hasSelectedVersion = versions.some((version) => usesPromptHarness ? version.id === executor.harnessId : version.slug === executor.promptVersion);
  return <div aria-modal={inline ? undefined : "true"} className={`stage-configuration-dialog${inline ? " is-inline" : ""}`} role={inline ? undefined : "dialog"}><section>{inline ? null : <header><div><span>阶段配置</span><h3>{label}</h3></div><button aria-label={`关闭${label}配置`} className="icon-button" onClick={onClose} type="button">×</button></header>}<div className="stage-configuration-fields"><label><FieldLabel help={usesPromptHarness ? `${label}固定使用已注册的 Codex Adapter。` : "执行服务，例如 codex。"}>Provider</FieldLabel><input aria-label={`${label} Provider`} disabled={readOnly || usesPromptHarness} onChange={(event) => onUpdateExecutor("provider", event.target.value)} value={executor.provider} /></label>{usesPromptHarness ? <label><FieldLabel help="Adapter、Harness 与模型会一同冻结到 Worker 任务中。">Adapter</FieldLabel><input aria-label={`${label} Adapter`} readOnly value="codex" /></label> : null}<label><FieldLabel help="执行时使用的模型名称。">模型</FieldLabel><input aria-label={`${label} 模型`} disabled={readOnly} onChange={(event) => onUpdateExecutor("model", event.target.value)} value={executor.model} /></label><label><FieldLabel help={usesPromptHarness ? "从已登记 Harness 中选择执行规则。" : "从已登记版本中选择执行规则。"}>{usesPromptHarness ? "Prompt Harness" : "Prompt 版本"}</FieldLabel>{versions.length ? <select aria-label={`${label} ${usesPromptHarness ? "Prompt Harness" : "Prompt 版本"}`} disabled={readOnly} onChange={(event) => { const version = versions.find((candidate) => (usesPromptHarness ? candidate.id : candidate.slug) === event.target.value); if (version) onSelectPromptVersion(version); }} value={hasSelectedVersion ? selectedValue : "__unregistered__"}>{!hasSelectedVersion ? <option value="__unregistered__">{executor.promptVersion || "当前值"}（未登记）</option> : null}{versions.map((version) => <option key={version.id} value={usesPromptHarness ? version.id : version.slug}>{version.name} · {version.slug}</option>)}</select> : <input aria-label={`${label} Prompt 版本`} disabled={readOnly} onChange={(event) => onUpdateExecutor("promptVersion", event.target.value)} value={executor.promptVersion} />}</label></div>{readOnly ? null : <PromptVersionManager fixedCapability={executorKey} isPending={isPending} key={executorKey} onCreate={onCreatePromptVersion} onSelect={onSelectPromptVersion} promptVersions={promptVersions} />}{inline ? null : <footer><button className="button button-primary" onClick={onClose} type="button">完成</button></footer>}</section></div>;
}

function MediaAdapterCard({ adapterKey, externalConnections = [], form, onChange, readOnly = false, showAllowedTools = true }: { adapterKey: MediaAdapterKey; externalConnections?: ExternalConnection[]; form: MediaAdapterForm; onChange: (field: keyof MediaAdapterForm, value: string) => void; readOnly?: boolean; showAllowedTools?: boolean }) {
  const definition = mediaCapabilityForKey(adapterKey);
  const { defaultConfiguration, label, unregisteredAdapter } = definition;
  const hasConfigurationField = (field: typeof definition.configurationFields[number]) => definition.configurationFields.includes(field);
  const status = mediaAdapterStatus(adapterKey, form);
  const statusClass = status === "已配置" ? "is-configured" : status === "待补齐" ? "is-incomplete" : "is-empty";
  const textField = (field: keyof MediaAdapterForm, title: string, help: string, fieldPlaceholder: string) => <label><FieldLabel help={help}>{title}</FieldLabel><input aria-label={title} onChange={(event) => onChange(field, event.target.value)} placeholder={fieldPlaceholder} readOnly={readOnly} value={form[field]} /></label>;
  const numberField = (field: keyof MediaAdapterForm, title: string, help: string, min = 1) => <label><FieldLabel help={help}>{title}</FieldLabel><input aria-label={title} min={min} onChange={(event) => onChange(field, event.target.value)} readOnly={readOnly} step={min < 1 ? "0.1" : "1"} type="number" value={form[field]} /></label>;
  const registeredCapability = definition.requiresRegisteredAdapter ? definition.capability : undefined;
  const registeredAdapters = registeredCapability ? registeredAdaptersForCapability(registeredCapability) : [];
  const selectedRegisteredAdapter = registeredCapability ? adapterRegistration(form.provider, form.adapter) : undefined;
  const connectionOptions = selectedRegisteredAdapter && isOwnerManagedConnection(selectedRegisteredAdapter.provider, selectedRegisteredAdapter.id) ? externalConnections.filter((connection) => connection.provider === selectedRegisteredAdapter.provider && connection.adapter === selectedRegisteredAdapter.id && connection.status === "verified").map((connection) => ({ credentialRef: connection.current_version_id, label: `${connection.name} · 已验证` })) : selectedRegisteredAdapter?.connections ?? registeredAdapters.flatMap((registration) => registration.connections);
  const voiceNames = googleTtsVoices[form.voiceLanguageCode] ?? [];

  return <article className={`media-adapter-card ${statusClass}`}>
    <header><div><h4>{label}</h4><p>{definition.description}</p></div><span className="media-adapter-status">{status}</span></header><div className="media-adapter-controls">
    <div className="media-adapter-field-grid">
      {registeredCapability ? <>
        <label><FieldLabel help="Provider 由已注册 Adapter 声明，不能自由填写。">Provider</FieldLabel><input aria-label="Provider" readOnly value={selectedRegisteredAdapter?.provider ?? form.provider} /></label>
        <label><FieldLabel help="只能选择 Worker 已注册的 Adapter。">Adapter</FieldLabel><select aria-label={`${label} Adapter`} disabled={readOnly} onChange={(event) => { const registration = registeredAdapters.find((candidate) => candidate.id === event.target.value); if (!registration) return; onChange("provider", registration.provider); onChange("adapter", registration.id); const ownerConnection = externalConnections.find((connection) => connection.provider === registration.provider && connection.adapter === registration.id && connection.status === "verified"); onChange("credentialRef", ownerConnection?.current_version_id ?? registration.connections[0]?.credentialRef ?? ""); onChange("model", defaultConfiguration.model); onChange("promptVersion", defaultConfiguration.promptVersion); onChange("allowedTools", "read, write"); }} value={selectedRegisteredAdapter?.id ?? "__unregistered__"}>{selectedRegisteredAdapter ? null : <option value="__unregistered__">当前值（未登记）</option>}{registeredAdapters.map((registration) => <option key={registration.id} value={registration.id}>{registration.provider} · {registration.id}</option>)}</select></label>
        {connectionOptions.length ? <label><FieldLabel help="蓝图只保存连接的非秘密引用，不保存 API Key。">外部连接</FieldLabel><select aria-label={`${label} 外部连接`} disabled={readOnly || !selectedRegisteredAdapter} onChange={(event) => onChange("credentialRef", event.target.value)} value={connectionOptions.some((connection) => connection.credentialRef === form.credentialRef) ? form.credentialRef : ""}><option value="">请选择连接</option>{connectionOptions.map((connection) => <option key={connection.credentialRef} value={connection.credentialRef}>{connection.label}</option>)}</select></label> : null}
      </> : <>
        {textField("provider", "Provider", "执行服务名称。这个值必须与 Worker 已注册的供应商一致。", unregisteredAdapter?.provider ?? "provider")}
        {textField("adapter", "Adapter", "具体媒体适配器名称。它会随生产单冻结，Worker 不会自动替换。", unregisteredAdapter?.adapter ?? "adapter")}
        {textField("model", "模型", "媒体适配器使用的模型或版本名称。", defaultConfiguration.model)}
        {textField("promptVersion", "Prompt 版本", "媒体任务使用的提示词版本标签；先用稳定、可追溯的 slug，例如 a-roll-v1。", defaultConfiguration.promptVersion)}
      </>}
    </div>
    {showAllowedTools && !registeredCapability ? <label><FieldLabel help="任务允许使用的工具，使用英文逗号分隔。至少填写一个。">允许工具</FieldLabel><input aria-label="允许工具" onChange={(event) => onChange("allowedTools", event.target.value)} placeholder="例如：read, write" readOnly={readOnly} value={form.allowedTools} /></label> : null}
    {definition.configurationFields.length ? <div className="media-adapter-field-grid">{hasConfigurationField("max_attempts") ? numberField("maxAttempts", "最大尝试次数", "媒体任务失败后的最大执行尝试次数。") : null}{hasConfigurationField("max_concurrency") ? numberField("maxConcurrency", "最大并发数", "同一生产单同时运行的媒体任务数。") : null}{hasConfigurationField("provider_max_concurrency") ? numberField("providerMaxConcurrency", "供应商并发上限", "发给同一供应商的最大并发数。") : null}{hasConfigurationField("voice") ? <><label><FieldLabel help="选择当前 Google TTS 连接支持的语言。">语言</FieldLabel><select aria-label="语言代码" disabled={readOnly} onChange={(event) => { onChange("voiceLanguageCode", event.target.value); onChange("voiceName", ""); }} value={form.voiceLanguageCode in googleTtsVoices ? form.voiceLanguageCode : ""}><option value="">选择语言</option>{form.voiceLanguageCode && !(form.voiceLanguageCode in googleTtsVoices) ? <option value={form.voiceLanguageCode}>{form.voiceLanguageCode}</option> : null}{Object.keys(googleTtsVoices).map((languageCode) => <option key={languageCode} value={languageCode}>{languageCode}</option>)}</select></label><label><FieldLabel help="选择对应语言的 Google TTS 声音；保留已有但目录中不存在的冻结值。">声音</FieldLabel><select aria-label="声音名称" disabled={readOnly || !form.voiceLanguageCode} onChange={(event) => onChange("voiceName", event.target.value)} value={voiceNames.includes(form.voiceName) ? form.voiceName : ""}><option value="">选择声音</option>{form.voiceName && !voiceNames.includes(form.voiceName) ? <option value={form.voiceName}>{form.voiceName}</option> : null}{voiceNames.map((voiceName) => <option key={voiceName} value={voiceName}>{voiceName}</option>)}</select></label>{hasConfigurationField("voice_speaking_rate") ? numberField("voiceSpeakingRate", "语速", "旁白播放速度，通常填写 1。", 0.1) : null}</> : null}</div> : null}</div>
  </article>;
}

function readableRuleValue(value: Json): string {
  if (value === null) return "未配置";
  if (Array.isArray(value)) return value.map(readableRuleValue).join("、") || "未配置";
  if (typeof value === "object") return Object.entries(value as Record<string, Json>).map(([key, nestedValue]) => `${key.replaceAll("_", " ")}：${readableRuleValue(nestedValue)}`).join("；") || "未配置";
  return String(value);
}

function ReadOnlyAdvancedRules({ source }: { source: string }) {
  let parsed: unknown;
  try { parsed = JSON.parse(source); } catch { return null; }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const entries = Object.entries(parsed as Record<string, Json>);
  if (!entries.length) return null;
  return <fieldset><legend>其他规则</legend><dl className="configuration-summary blueprint-summary-grid">{entries.map(([key, value]) => <div key={key}><dt>{key.replaceAll("_", " ")}</dt><dd>{readableRuleValue(value)}</dd></div>)}</dl><FieldHint>未单独做成字段的规则也会在这里按键值显示，不使用原始 JSON。</FieldHint></fieldset>;
}

function systemStateLabel(state: SystemState): string {
  return state === "healthy" ? "正常" : state === "attention" ? "需处理" : state === "offline" ? "不可用" : "待确认";
}

function runtimeDependencyItems(report: LocalSystemStatusReport | null): Array<{ detail: string; name: string; state: SystemState }> {
  if (!report) return [];
  return [
    { detail: report.mediaLibrary.detail, name: "媒体库", state: report.mediaLibrary.state },
    { detail: report.n8n.detail, name: "n8n 编排", state: report.n8n.state },
    ...report.dependencies,
  ];
}

function externalConnectionProviderLabel(provider: string): string {
  return provider === "openai" ? "OpenAI Images" : provider === "google_tts" ? "Google TTS" : provider === "pexels" ? "Pexels" : provider === "freesound" ? "Freesound" : provider || "未选择供应商";
}

function externalConnectionStatusLabel(status: ExternalConnectionStatus["status"], check: string | null): string {
  if (status === "passed") return "可用";
  const checkLabels: Record<string, string> = { blueprint_configuration: "配置不完整", capability_registration: "能力未注册", command_availability: "命令不可用", credential_presence: "凭据缺失", credential_validity: "凭据校验失败", model_permission: "模型权限不足", network_connectivity: "网络失败", tool_permission: "工具权限不足" };
  return check ? checkLabels[check] ?? (status === "retryable" ? "检查失败" : "不可用") : status === "blocked" ? "配置不完整" : status === "retryable" ? "检查失败" : status === "unavailable" ? "不可用" : "待检查";
}

function externalConnectionActionLabel(action: ExternalConnectionStatus["action"]): string {
  return action === "retry" ? "可重试" : action === "edit_blueprint" ? "请编辑蓝图" : action === "manage_connection" ? "请管理连接" : action === "contact_environment_admin" ? "请联系环境管理员" : "";
}

function ExternalConnectionSummary({ isLoading = false, onRefresh, preflight, preflightError, policy }: { isLoading?: boolean; onRefresh?: () => Promise<void>; preflight: WorkerPreflightResult | null; preflightError?: string; policy: Json }) {
  const items = externalConnectionStatuses(policy, preflight);
  return <section aria-label="生产能力状态" className="external-connection-summary technical-runtime-status">
    <header><div><h3>生产能力状态</h3><p>显示当前蓝图已启用的五项生产能力；需要外部连接的能力仍只保存非秘密引用。</p></div>{onRefresh ? <button className="button button-secondary button-small" disabled={isLoading} onClick={() => void onRefresh()} type="button">{isLoading ? "检查中…" : preflight ? "重新检查" : "检查"}</button> : null}</header>
    {preflightError ? <p className="form-error">生产能力检查失败：{preflightError}</p> : null}
    {items.length ? <ul>{items.map((item) => <li key={item.key}><div><strong>{externalConnectionProviderLabel(item.provider)} · {externalConnectionStatusLabel(item.status, item.check)}</strong><span>{item.adapter || "未声明适配器"}</span></div><p>{item.reason}{externalConnectionActionLabel(item.action) ? ` · ${externalConnectionActionLabel(item.action)}` : ""}</p></li>)}</ul> : <p className="summary-empty">当前蓝图没有启用生产能力。</p>}
    <FieldHint>“可用”表示本次 Worker 检查已通过；“不可用”或“检查失败”分别按检查结果处理，不会在前端保存 API Key。</FieldHint>
  </section>;
}

function RuntimeDependencyStatus({ report }: { report: LocalSystemStatusReport | null }) {
  const items = runtimeDependencyItems(report);
  return <fieldset className="technical-runtime-status"><legend>依赖状态</legend>{items.length ? <ul>{items.map((item) => <li key={item.name}><strong>{item.name} · {systemStateLabel(item.state)}</strong><span>{item.detail}</span></li>)}</ul> : <p className="summary-empty">尚未读取本地依赖报告；保存的只是配置声明。</p>}<FieldHint>这里复用本地系统状态报告；Worker 注册、凭据、模型权限和实际供应商接受仍在生产前检查。</FieldHint></fieldset>;
}

function mediaAdapterPreview(key: MediaAdapterKey, form: MediaAdapterForm): string {
  const details = [
    form.provider && `${form.provider}/${form.adapter}/${form.model}/${form.promptVersion}`,
    form.allowedTools && `工具 ${form.allowedTools}`,
    form.maxAttempts && `尝试 ${form.maxAttempts}`,
    form.maxConcurrency && `并发 ${form.maxConcurrency}`,
    form.providerMaxConcurrency && `供应商并发 ${form.providerMaxConcurrency}`,
    form.voiceLanguageCode && `语言 ${form.voiceLanguageCode}`,
    form.voiceName && `声音 ${form.voiceName}`,
    form.voiceSpeakingRate && `语速 ${form.voiceSpeakingRate}`,
  ].filter(Boolean);
  return `${mediaCapabilityForKey(key).label} · ${details.join(" · ") || "未配置"}`;
}

export function BlueprintEffectiveSummary({ blueprintPreflight = null, blueprintPreflightError = "", isBlueprintPreflightLoading = false, onEditTechnical, onRefreshBlueprintPreflight, policy, systemStatus = null, version }: { blueprintPreflight?: WorkerPreflightResult | null; blueprintPreflightError?: string; isBlueprintPreflightLoading?: boolean; onEditTechnical?: () => void; onRefreshBlueprintPreflight?: () => Promise<void>; policy: Json; systemStatus?: LocalSystemStatusReport | null; version?: number }) {
  const form = blueprintPolicyToForm(policy);
  const enabledMediaAdapters = form.enabledMediaAdapters ?? [];
  const mediaConfigurationReady = enabledMediaAdapters.every((key) => mediaAdapterStatus(key, form.mediaAdapters[key]) === "已配置");
  const dependencyItems = runtimeDependencyItems(systemStatus);
  const dependencyStatus = !systemStatus ? "依赖状态待确认" : dependencyItems.some((item) => item.state === "attention" || item.state === "offline") ? "依赖需处理" : dependencyItems.some((item) => item.state === "unknown") ? "依赖状态待确认" : "依赖状态正常";
  const productionStatus = form.assetRoot.trim() && mediaConfigurationReady ? `${dependencyStatus}；仍需 Worker 生产前检查` : "配置待补齐，生产前检查会阻塞";
  return <section aria-labelledby="effective-config-heading" className="effective-config-summary">
    <header><div><span className="effective-config-eyebrow">生产配置摘要</span><h2 id="effective-config-heading">当前有效配置</h2><p>蓝图 v{version ?? "—"} · 配置声明已保存；Worker 注册、凭据、网络和模型权限仍需生产前检查。</p></div>{onEditTechnical ? <button className="button button-secondary button-small" onClick={onEditTechnical} type="button">编辑技术配置</button> : null}</header>
    <dl className="configuration-summary blueprint-summary-grid">
      <div><dt>生效范围</dt><dd>仅影响之后新建的 Episode</dd></div>
      <div><dt>已有 Episode</dt><dd>保留创建时的冻结配置</dd></div>
      <div><dt>资产目录</dt><dd>{form.assetRoot || "未配置，生产前检查会阻塞"}</dd></div>
      <div><dt>生产能力</dt><dd>{enabledMediaAdapters.length ? <div className="summary-chip-list">{enabledMediaAdapters.map((key) => <span className="summary-chip" key={key}>{mediaCapabilityForKey(key).label} · {mediaAdapterStatus(key, form.mediaAdapters[key])}</span>)}</div> : <span className="summary-empty">暂未启用可选媒体能力</span>}</dd></div>
      <div className="blueprint-summary-wide"><dt>分镜规划</dt><dd><div className="summary-chip-list">{visibleExecutorKeys.map((key) => <span className="summary-chip" key={key}>{executorLabels[key]} · {form.executors[key].provider} / {form.executors[key].model} / {form.executors[key].promptVersion}</span>)}</div></dd></div>
      <div className="blueprint-summary-wide"><dt>依赖状态</dt><dd>{dependencyItems.length ? <div className="summary-chip-list">{dependencyItems.map((item) => <span className="summary-chip" key={item.name}>{item.name} · {systemStateLabel(item.state)}</span>)}</div> : "尚未读取本地依赖报告"}</dd></div>
      <div className="blueprint-summary-wide"><dt>生产前状态</dt><dd>{productionStatus}。Worker 会在生产前确认注册、凭据、工具、网络和模型权限。</dd></div>
    </dl>
    <ExternalConnectionSummary isLoading={isBlueprintPreflightLoading} onRefresh={onRefreshBlueprintPreflight} preflight={blueprintPreflight} preflightError={blueprintPreflightError} policy={policy} />
  </section>;
}

function BlueprintPolicyPreview({ form }: { form: BlueprintFormValues }) {
  const enabledMediaAdapters = form.enabledMediaAdapters ?? [];
  return <fieldset className="technical-policy-preview"><legend>最终写入与冻结预览</legend><dl className="configuration-summary blueprint-summary-grid">
    <div><dt>资产目录</dt><dd>{form.assetRoot || "未配置"}</dd></div>
    <div><dt>允许工具</dt><dd>{form.allowedTools.join("、") || "未配置"}</dd></div>
    <div><dt>生产能力</dt><dd>{enabledMediaAdapters.length ? enabledMediaAdapters.map((key) => `${mediaCapabilityForKey(key).label} · ${mediaAdapterStatus(key, form.mediaAdapters[key])}`).join("；") : "暂未启用可选媒体能力"}</dd></div>
    <div className="blueprint-summary-wide"><dt>分镜规划</dt><dd><div className="summary-chip-list">{visibleExecutorKeys.map((key) => <span className="summary-chip" key={key}>{executorLabels[key]} · {form.executors[key].provider} / {form.executors[key].model} / {form.executors[key].promptVersion}</span>)}</div></dd></div>
    <div className="blueprint-summary-wide"><dt>媒体适配器</dt><dd>{enabledMediaAdapters.length ? enabledMediaAdapters.map((key) => mediaAdapterPreview(key, form.mediaAdapters[key])).join("；") : "暂未启用可选媒体能力"}</dd></div>
    <div className="blueprint-summary-wide"><dt>冻结边界</dt><dd>保存后只影响之后新建的 Episode；已有 Episode 保留创建时的规则快照。</dd></div>
  </dl><FieldHint>这里只显示会写入蓝图并在新 Episode 创建时冻结的静态声明，不包含 API Key、Token 或 Worker 运行态。</FieldHint></fieldset>;
}

export function BlueprintConfigurationForm({ accountId, externalConnections = [], initialAssetRoot, initialPolicy, isEpisodeRepair = false, isPending, onCancel, onCreatePromptVersion, onDirtyChange, onSave, promptVersions = [], readOnly = false, systemStatus = null, technicalOnly = false }: { accountId?: string; externalConnections?: ExternalConnection[]; initialAssetRoot: string; initialPolicy: Json; isEpisodeRepair?: boolean; isPending: boolean; onCancel: () => void; onCreatePromptVersion?: (input: { capability: PromptCapability; name: string; summary: string; instructions: string }) => Promise<PromptVersion | null>; onDirtyChange?: (dirty: boolean) => void; onSave: (policy: Json, activate: boolean) => Promise<void>; promptVersions?: PromptVersion[]; readOnly?: boolean; systemStatus?: LocalSystemStatusReport | null; technicalOnly?: boolean }) {
  const initialForm = () => blueprintPolicyToForm({ ...(initialPolicy && typeof initialPolicy === "object" && !Array.isArray(initialPolicy) ? initialPolicy : {}), asset_root: initialAssetRoot } as Json);
  const initialPolicyKey = JSON.stringify(initialPolicy);
  const [form, setForm] = useState<BlueprintFormValues>(initialForm);
  const [error, setError] = useState("");
  const [technicalConfigOpen, setTechnicalConfigOpen] = useState(readOnly || technicalOnly);
  const [assetDirectoryAction, setAssetDirectoryAction] = useState<"choose" | "open" | null>(null);
  const [storyboardConfigurationOpen, setStoryboardConfigurationOpen] = useState(false);
  useEffect(() => { setForm(initialForm()); setStoryboardConfigurationOpen(false); onDirtyChange?.(false); }, [initialAssetRoot, initialPolicyKey, onDirtyChange]);
  useEffect(() => setTechnicalConfigOpen(readOnly || technicalOnly), [readOnly, technicalOnly]);

  function update(next: Partial<BlueprintFormValues>) {
    onDirtyChange?.(true);
    setForm((current) => ({ ...current, ...next }));
  }

  function updateExecutor(key: keyof BlueprintFormValues["executors"], field: keyof BlueprintFormValues["executors"]["script_writing"], value: string) {
    onDirtyChange?.(true);
    setForm((current) => ({ ...current, executors: { ...current.executors, [key]: { ...current.executors[key], [field]: value } } }));
  }

  function updateMediaAdapter(key: MediaAdapterKey, field: keyof MediaAdapterForm, value: string) {
    onDirtyChange?.(true);
    setForm((current) => ({ ...current, mediaAdapters: { ...current.mediaAdapters, [key]: { ...current.mediaAdapters[key], [field]: value } } }));
  }

  function selectPromptVersion(key: keyof BlueprintFormValues["executors"], version: PromptVersion) {
    updateExecutor(key, "promptVersion", version.slug);
    if (key === "storyboard_planning") updateExecutor(key, "harnessId", version.id);
  }

  function toggleMediaAdapter(key: ConfigurableMediaAdapterKey, enabled: boolean) {
    onDirtyChange?.(true);
    if (enabled) setTechnicalConfigOpen(true);
    setForm((current) => {
      const enabledMediaAdapters = current.enabledMediaAdapters ?? [];
      const nextEnabled = enabled ? [...enabledMediaAdapters, key] : enabledMediaAdapters.filter((item) => item !== key);
      const currentAdapter = current.mediaAdapters[key];
      const hasValues = Object.entries(currentAdapter).some(([field, value]) => value.trim() !== "" && !(field === "allowedTools" && value === "read, write"));
      return { ...current, enabledMediaAdapters: nextEnabled, mediaAdapters: { ...current.mediaAdapters, [key]: enabled && !hasValues ? defaultMediaAdapterForm(key) : currentAdapter } };
    });
  }

  async function requestLocalAssetDirectory(action: "choose" | "open") {
    if (!accountId) throw new Error("当前账号不可用，无法操作本地目录。");
    const { data, error: sessionError } = await supabase.auth.getSession();
    if (sessionError) throw sessionError;
    if (!data.session) throw new Error("需要 Owner 登录会话。");
    const query = new URLSearchParams({ account: accountId, ...(action === "open" ? { path: form.assetRoot.trim() } : {}) });
    const response = await fetch(`${action === "choose" ? "/_choose-local-asset-directory" : "/_open-local-asset-directory"}?${query}`, { method: "POST", headers: { Authorization: `Bearer ${data.session.access_token}` } });
    if (!response.ok) throw new Error((await response.text()).trim() || (action === "choose" ? "无法选择本地文件夹。" : "无法打开本地文件夹。"));
    return action === "choose" ? await response.json() as { assetRoot?: unknown } : null;
  }

  async function chooseAssetDirectory() {
    setAssetDirectoryAction("choose");
    setError("");
    try {
      const result = await requestLocalAssetDirectory("choose");
      if (typeof result?.assetRoot !== "string" || !result.assetRoot.trim()) throw new Error("未获取到有效的本地文件夹路径。");
      update({ assetRoot: result.assetRoot });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "无法选择本地文件夹。"); } finally { setAssetDirectoryAction(null); }
  }

  async function openAssetDirectory() {
    if (!form.assetRoot.trim()) { setError("请先填写或选择资产目录。"); return; }
    setAssetDirectoryAction("open");
    setError("");
    try { await requestLocalAssetDirectory("open"); } catch (cause) { setError(cause instanceof Error ? cause.message : "无法打开本地文件夹。"); } finally { setAssetDirectoryAction(null); }
  }

  async function submit() {
    try {
      setError("");
      if (!form.allowedTools.length) throw new Error("至少保留一个允许工具。");
      if (!form.approvalGates.length) throw new Error("至少保留一个审批关卡。");
      for (const key of visibleExecutorKeys) {
        const executor = form.executors[key];
        if (!executor.provider.trim() || !executor.model.trim() || !executor.promptVersion.trim()) throw new Error(`${executorLabels[key]}执行器的 Provider、模型和 Prompt 版本不能为空。`);
        if (!executor.harnessId?.trim() || !promptVersions.some((version) => version.id === executor.harnessId && version.capability === key && version.is_active)) throw new Error("分镜规划必须选择已登记且启用的 Prompt Harness。");
      }
      await onSave(blueprintFormToPolicy(form), true);
      onDirtyChange?.(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "蓝图规则无法保存。");
    }
  }

  function reset() {
    setForm(initialForm());
    setStoryboardConfigurationOpen(false);
    setError("");
    onDirtyChange?.(false);
    onCancel();
  }

  const enabledMediaAdapters = form.enabledMediaAdapters ?? [];
  const readinessMessage = form.assetRoot.trim() ? "资产目录已填写；保存后仍需 Worker 验证目录可读写。" : "草稿：未填写资产目录，不能达到生产就绪。";
  const localDirectoryActions = Boolean(accountId && import.meta.env.DEV && !readOnly);
  return <section className="configuration-form blueprint-configuration-form">
    <p className="blueprint-editor-note">{readOnly ? "以下按表单结构显示此蓝图版本当前保存的规则。" : isEpisodeRepair ? "只修改当前生产单需要的冻结配置；已完成工作和审核记录会保留。" : technicalOnly ? "这里编辑当前蓝图的技术与运行前置声明；保存后只影响之后新建的 Episode，已有 Episode 继续使用冻结配置。" : "保存会直接更新当前蓝图规则，不创建新的用户可见版本；已经创建的 Episode 仍使用自己的规则快照。"}</p>
    {technicalOnly ? <RuntimeDependencyStatus report={systemStatus} /> : null}
    {technicalOnly ? null : <fieldset><legend><FieldLabel help="账号级的长期方向。它会作为脚本、视觉和分镜生成的共同背景。">账号定位</FieldLabel></legend><label><textarea aria-label="账号定位" onChange={(event) => update({ positioning: event.target.value })} placeholder="例如：面向固定受众，持续制作某类短视频内容。" readOnly={readOnly} rows={3} value={form.positioning} /></label><FieldHint>描述账号面向谁、持续讲什么以及希望保持的表达方向。</FieldHint></fieldset>}
    <fieldset><legend>{technicalOnly ? "运行前置与权限声明" : "本地资产与审批"}</legend><label><FieldLabel help="建议填写一个稳定的账号目录，例如 /Volumes/素材盘/账号目录。">资产目录</FieldLabel><div className="asset-root-control"><input aria-label="资产目录" onChange={(event) => update({ assetRoot: event.target.value })} placeholder="例如：/Volumes/素材盘/账号目录" readOnly={readOnly} value={form.assetRoot} />{localDirectoryActions ? <><button className="button button-secondary button-small" disabled={assetDirectoryAction !== null} onClick={() => void chooseAssetDirectory()} type="button">{assetDirectoryAction === "choose" ? "选择中…" : "选择文件夹"}</button><button className="button button-secondary button-small" disabled={assetDirectoryAction !== null || !form.assetRoot.trim()} onClick={() => void openAssetDirectory()} type="button">{assetDirectoryAction === "open" ? "打开中…" : "打开文件夹"}</button></> : null}</div></label><p className="blueprint-readiness" role="status">{readinessMessage}</p>{technicalOnly ? <><div><span className="configuration-label"><FieldLabel help="这是账号级硬约束。没有 write 时，Worker 不能创建输出产物。">允许工具</FieldLabel></span><div className="configuration-switch-list">{toolOptions.map(([value, label]) => <ConfigurationSwitch checked={form.allowedTools.includes(value)} disabled={readOnly} key={value} label={label} onChange={(checked) => update({ allowedTools: checked ? [...form.allowedTools, value] : form.allowedTools.filter((item) => item !== value) })} />)}</div></div><FieldHint>资产目录、工具白名单和媒体能力只影响之后新建的 Episode；账号定位和审批关卡保留在蓝图主表单中。</FieldHint></> : <div className="configuration-switch-groups"><div><span className="configuration-label"><FieldLabel help="勾选后，对应阶段会保留 Owner 的人工确认节点。至少保留一个关卡。">审批关卡</FieldLabel></span><div className="configuration-switch-list approval-gate-switches">{approvalGateOptions.map(([value, label]) => <ConfigurationSwitch checked={form.approvalGates.includes(value)} disabled={readOnly || (form.approvalGates.length === 1 && form.approvalGates.includes(value))} key={value} label={label} onChange={(checked) => update({ approvalGates: checked ? [...form.approvalGates, value] : form.approvalGates.filter((item) => item !== value) })} />)}</div></div><div><span className="configuration-label"><FieldLabel help="这是账号级硬约束。没有 write 时，Worker 不能创建输出产物。">允许工具</FieldLabel></span><div className="configuration-switch-list tool-switches">{toolOptions.map(([value, label]) => <ConfigurationSwitch checked={form.allowedTools.includes(value)} disabled={readOnly} key={value} label={label} onChange={(checked) => update({ allowedTools: checked ? [...form.allowedTools, value] : form.allowedTools.filter((item) => item !== value) })} />)}</div></div></div>}</fieldset>
    <fieldset id="account-capabilities"><legend>生产能力</legend><FieldHint>启用后在下方补充技术配置；配置未完成时，生产前检查会阻止创建生产单。</FieldHint><div className="capability-grid">{mediaAdapterKeys.map((key) => <ConfigurationSwitch ariaLabel={`启用${mediaCapabilityForKey(key).label}`} checked={enabledMediaAdapters.includes(key)} disabled={readOnly} key={key} label={mediaCapabilityForKey(key).compactLabel} onChange={(checked) => toggleMediaAdapter(key, checked)} />)}</div>{enabledMediaAdapters.length ? <details className="advanced-configuration media-adapter-configuration" onToggle={(event) => setTechnicalConfigOpen(event.currentTarget.open)} open={technicalConfigOpen}><summary>已启用能力的技术配置（{enabledMediaAdapters.length}）</summary><div className="media-adapter-grid">{enabledMediaAdapters.map((key) => <MediaAdapterCard adapterKey={key} externalConnections={externalConnections} form={form.mediaAdapters[key]} key={key} onChange={(field, value) => updateMediaAdapter(key, field, value)} readOnly={readOnly} showAllowedTools={false} />)}</div><FieldHint>Provider、Adapter、模型、Prompt 和调度参数只作用于之后新建的生产单。</FieldHint></details> : null}</fieldset>
    <fieldset id="account-budget"><legend>分镜规划</legend><section className="stage-configuration-summary">{visibleExecutorKeys.map((executorKey) => { const executor = form.executors[executorKey]; return <article key={executorKey}><strong>{executorLabels[executorKey]}</strong><span>{executor.provider} · {executor.model}</span><span>{executor.promptVersion || "未配置 Prompt"}</span>{readOnly ? null : <button aria-label="修改分镜规划配置" className="button button-secondary button-small" onClick={() => setStoryboardConfigurationOpen(true)} type="button">修改</button>}</article>; })}</section></fieldset>
    {storyboardConfigurationOpen ? <StageConfigurationDialog executor={form.executors.storyboard_planning} executorKey="storyboard_planning" isPending={isPending} onClose={() => setStoryboardConfigurationOpen(false)} onCreatePromptVersion={onCreatePromptVersion} onSelectPromptVersion={(version) => selectPromptVersion("storyboard_planning", version)} onUpdateExecutor={(field, value) => updateExecutor("storyboard_planning", field, value)} promptVersions={promptVersions} readOnly={readOnly} /> : null}
    {readOnly ? <ReadOnlyAdvancedRules source={form.advancedJson} /> : null}
    {error ? <p className="form-error">{error}</p> : null}
    {technicalOnly ? <BlueprintPolicyPreview form={form} /> : null}
    {readOnly ? null : <div className="configuration-actions"><button className="button button-secondary" disabled={isPending} onClick={reset} type="button">{technicalOnly ? "取消技术配置" : "取消编辑"}</button><button className="button button-primary" disabled={isPending} onClick={() => void submit()} type="button">{isPending ? "保存中…" : technicalOnly ? "保存技术配置" : "保存并检查"}</button></div>}
  </section>;
}

function mediaAdapterKeyForBlocker(blocker: { code: string; detail: string }): MediaAdapterKey | null {
  const source = `${blocker.code} ${blocker.detail}`.toLowerCase();
  if (/static[_-]?visual|image.?generation|图片|静态视觉/.test(source)) return "static_visual";
  if (/a[_-]?roll/.test(source)) return "a_roll";
  if (/b[_-]?roll/.test(source)) return "b_roll";
  if (/narration|旁白/.test(source)) return "narration";
  if (/soundtrack|sound.?effect|配乐|音效/.test(source)) return "soundtrack";
  return null;
}

function executorKeyForTask(taskType?: string): keyof BlueprintFormValues["executors"] | null {
  if (taskType === "draft_script") return "script_writing";
  if (taskType === "prepare_visual_brief") return "storyboard_planning";
  if (taskType === "draft_storyboard") return "storyboard_planning";
  return null;
}

export function EpisodeConfigurationRepairForm({ blocker, initialPolicy, isPending, onCancel, onSave, promptVersions = [] }: { blocker: { code: string; detail: string; taskType?: string }; initialPolicy: Json; isPending: boolean; onCancel: () => void; onSave: (policy: Json) => Promise<void>; promptVersions?: PromptVersion[] }) {
  const adapterKey = mediaAdapterKeyForBlocker(blocker);
  const executorKey = executorKeyForTask(blocker.taskType);
  const [form, setForm] = useState<BlueprintFormValues>(() => blueprintPolicyToForm(initialPolicy));
  const [error, setError] = useState("");
  useEffect(() => setForm(blueprintPolicyToForm(initialPolicy)), [initialPolicy]);

  function updateMediaAdapter(field: keyof MediaAdapterForm, value: string) {
    if (!adapterKey) return;
    setForm((current) => ({ ...current, mediaAdapters: { ...current.mediaAdapters, [adapterKey]: { ...current.mediaAdapters[adapterKey], [field]: value } } }));
  }

  function updateExecutor(field: keyof BlueprintFormValues["executors"]["script_writing"], value: string) {
    if (!executorKey) return;
    setForm((current) => ({ ...current, executors: { ...current.executors, [executorKey]: { ...current.executors[executorKey], [field]: value } } }));
  }

  const planningHarnesses = promptVersions.filter((version) => version.capability === "storyboard_planning" && version.is_active);
  function selectPlanningHarness(harnessId: string) {
    const harness = planningHarnesses.find((version) => version.id === harnessId);
    if (!harness || !executorKey) return;
    setForm((current) => ({ ...current, executors: { ...current.executors, [executorKey]: { ...current.executors[executorKey], adapter: "codex", harnessId: harness.id, promptVersion: harness.slug, provider: "codex" } } }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      setError("");
      if (adapterKey) {
        const adapter = form.mediaAdapters[adapterKey];
        const repairForm = adapter.allowedTools.trim() ? adapter : { ...adapter, allowedTools: "read, write" };
        validateMediaAdapter(adapterKey, repairForm);
        const enabledMediaAdapters = configurableMediaAdapterKeys.includes(adapterKey as ConfigurableMediaAdapterKey)
          ? [...new Set([...(form.enabledMediaAdapters ?? []), adapterKey as ConfigurableMediaAdapterKey])]
          : form.enabledMediaAdapters;
        await onSave(blueprintFormToPolicy({ ...form, enabledMediaAdapters, mediaAdapters: { ...form.mediaAdapters, [adapterKey]: repairForm } }));
        return;
      }
      if (executorKey) {
        const executor = form.executors[executorKey];
        if (!executor.provider.trim() || !executor.model.trim() || !executor.promptVersion.trim()) throw new Error("执行器的 Provider、模型和 Prompt 版本不能为空。");
        if (executorKey === "storyboard_planning" && !planningHarnesses.some((version) => version.id === executor.harnessId)) throw new Error("分镜规划必须选择已登记且启用的 Prompt Harness。");
      } else throw new Error("当前阻塞项无法映射到可修复的配置。");
      await onSave(blueprintFormToPolicy(form));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法保存当前生产单修复。");
    }
  }

  if (!adapterKey && !executorKey) return <section className="configuration-form"><p className="form-error">当前阻塞项不能通过配置修复，请按阻塞卡片提示处理。</p><button className="button button-secondary" onClick={onCancel} type="button">返回生产单</button></section>;
  return <form className="configuration-form blueprint-configuration-form" onSubmit={(event) => void submit(event)}>
    <header><h2>修复当前生产单的 {adapterKey ? mediaCapabilityForKey(adapterKey).label : executorLabels[executorKey!]}</h2><p className="blueprint-editor-note">只修改这类受阻任务的冻结配置。不会创建或修改账号蓝图，也不会影响之后的新生产单。</p></header>
    {adapterKey ? <fieldset><legend>需要补齐的媒体配置</legend><MediaAdapterCard adapterKey={adapterKey} form={form.mediaAdapters[adapterKey]} onChange={updateMediaAdapter} showAllowedTools={false} /></fieldset> : <fieldset><legend>需要补齐的执行器配置</legend><label><FieldLabel help="执行服务名称。">Provider</FieldLabel><input aria-label="Provider" disabled={executorKey === "storyboard_planning"} onChange={(event) => updateExecutor("provider", event.target.value)} value={form.executors[executorKey!].provider} /></label>{executorKey === "storyboard_planning" ? <label><FieldLabel help="当前生产单会冻结所选 Harness 的内容。">Prompt Harness</FieldLabel><select aria-label="Prompt Harness" onChange={(event) => selectPlanningHarness(event.target.value)} value={planningHarnesses.some((version) => version.id === form.executors[executorKey].harnessId) ? form.executors[executorKey].harnessId : ""}><option value="">选择 Harness</option>{planningHarnesses.map((version) => <option key={version.id} value={version.id}>{version.name} · {version.slug}</option>)}</select></label> : <label><FieldLabel help="当前任务使用的可追溯 Prompt 版本。">Prompt 版本</FieldLabel><input aria-label="Prompt 版本" onChange={(event) => updateExecutor("promptVersion", event.target.value)} value={form.executors[executorKey!].promptVersion} /></label>}<label><FieldLabel help="当前任务使用的模型名称。">模型</FieldLabel><input aria-label="模型" onChange={(event) => updateExecutor("model", event.target.value)} value={form.executors[executorKey!].model} /></label></fieldset>}
    {error ? <p className="form-error">{error}</p> : null}
    <div className="configuration-actions"><button className="button button-secondary" disabled={isPending} onClick={onCancel} type="button">取消</button><button className="button button-primary" disabled={isPending} type="submit">{isPending ? "应用中…" : "保存并继续当前生产单"}</button></div>
  </form>;
}

export function SeriesConfigurationForm({ initialName, initialRules, isEditing, isPending, onCancel, onDirtyChange, onSave }: { initialName: string; initialRules: Json; isEditing: boolean; isPending: boolean; onCancel: () => void; onDirtyChange?: (dirty: boolean) => void; onSave: (name: string, rules: Json) => Promise<void> }) {
  const [name, setName] = useState(initialName);
  const [form, setForm] = useState<SeriesFormValues>(() => seriesRulesToForm(initialRules));
  const [error, setError] = useState("");
  useEffect(() => { setName(initialName); setForm(seriesRulesToForm(initialRules)); onDirtyChange?.(false); }, [initialName, initialRules, onDirtyChange]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      setError("");
      if (!name.trim()) throw new Error("请填写系列名称。");
      if (isEditing && name.trim() !== initialName) throw new Error("系列版本编辑不能修改系列名称；请保留原名称后再保存规则。 ");
      const rules = seriesFormToRules(form);
      validateSeriesRules(rules);
      await onSave(name.trim(), rules);
      onDirtyChange?.(false);
      if (!isEditing) { setName(""); setForm(seriesRulesToForm({})); }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "系列规则无法保存。");
    }
  }

  function reset() {
    setName(initialName);
    setForm(seriesRulesToForm(initialRules));
    setError("");
    onDirtyChange?.(false);
    onCancel();
  }

  return <form className="configuration-form series-configuration-form" onChangeCapture={() => onDirtyChange?.(true)} onSubmit={(event) => void submit(event)}>
    <header><div><h2>{isEditing ? initialName : "新建系列"}</h2><p>{isEditing ? "保存当前系列配置；已有生产单继续使用创建时的内部快照。" : "创建系列后，可以在新建生产单时固定系列基线。"}</p></div></header>
    <label><FieldLabel help="系列名称用于生产单筛选和运营识别。">系列名称</FieldLabel><input aria-label="系列名称" onChange={(event) => setName(event.target.value)} placeholder="例如：城市观察短片" required value={name} /></label>
    <fieldset><legend><FieldLabel help="系列规则会作为固定基线传给脚本、视觉和分镜任务；新建生产单会冻结当前系列版本。">系列基线</FieldLabel></legend>
      <label><FieldLabel help="这个系列具体讲什么，与账号定位相比更聚焦。">系列定位</FieldLabel><textarea aria-label="系列定位" onChange={(event) => setForm((current) => ({ ...current, positioning: event.target.value }))} placeholder="例如：围绕固定主题制作短视频内容。" rows={2} value={form.positioning} /></label>
      <label><FieldLabel help="固定画幅、语言、旁白等制作格式；每集时长由当次分镜决定。">内容格式</FieldLabel><input aria-label="内容格式" onChange={(event) => setForm((current) => ({ ...current, format: event.target.value }))} placeholder="例如：9:16 竖屏，目标语言旁白" value={form.format} /></label>
      <div className="series-baseline-grid">
        <label><FieldLabel help="主要角色、身份、性格、关系和不能随意改变的设定。">角色设定</FieldLabel><textarea aria-label="角色设定" onChange={(event) => setForm((current) => ({ ...current, characters: event.target.value }))} placeholder="例如：主持人的身份、性格和固定道具。" rows={3} value={form.characters} /></label>
        <label><FieldLabel help="固定出现的国家、城市、建筑、自然环境或时代背景。">地点设定</FieldLabel><textarea aria-label="地点设定" onChange={(event) => setForm((current) => ({ ...current, locations: event.target.value }))} placeholder="例如：城市街区、室内工作台和夜间环境。" rows={3} value={form.locations} /></label>
        <label><FieldLabel help="画面质感、色彩、镜头语言和视觉禁忌。">视觉风格</FieldLabel><textarea aria-label="视觉风格" onChange={(event) => setForm((current) => ({ ...current, visualStyle: event.target.value }))} placeholder="例如：写实纪实、低饱和、潮湿夜景、手持镜头感。" rows={3} value={form.visualStyle} /></label>
        <label><FieldLabel help="每集故事的推荐展开顺序，会影响脚本和分镜结构。">叙事结构</FieldLabel><textarea aria-label="叙事结构" onChange={(event) => setForm((current) => ({ ...current, narrativeStructure: event.target.value }))} placeholder="例如：3秒钩子 → 地点背景 → 异常事件 → 人物选择 → 留白结尾。" rows={3} value={form.narrativeStructure} /></label>
      </div>
      <label><FieldLabel help="明确不能出现的事实、表达、人物、素材或画面。">限制与禁用内容</FieldLabel><textarea aria-label="限制与禁用内容" onChange={(event) => setForm((current) => ({ ...current, restrictions: event.target.value }))} placeholder="例如：不虚构真实新闻；不使用儿童受害情节；不出现现代品牌标识。" rows={3} value={form.restrictions} /></label>
      <FieldHint>这些内容会影响后续脚本、视觉规划和分镜生成；只填写这个系列稳定、可复用的规则。</FieldHint>
    </fieldset>
    {error ? <p className="form-error">{error}</p> : null}
    <div className="configuration-actions"><button className="button button-secondary" onClick={reset} type="button">{isEditing ? "取消编辑" : "取消"}</button><button className="button button-primary" disabled={isPending} type="submit">{isPending ? "保存中…" : isEditing ? "保存系列配置" : "创建系列"}</button></div>
  </form>;
}
