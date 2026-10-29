import {XClose} from '@untitledui/icons';
import {Disclosure} from '../ui/dan-ui/components/base/disclosure/disclosure';
import {Checkbox} from '../ui/dan-ui/components/base/checkbox/checkbox';
import {TextAreaBase} from '../ui/dan-ui/components/base/textarea/textarea';
import {InputBase} from '../ui/dan-ui/components/base/input/input';
import {NativeSelect} from '../ui/dan-ui/components/base/select/select-native';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import {videoProviders,isVideoProvider} from "../worker/videoProviderCatalog";
import { useEffect, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import type { Database, Json } from "../lib/database.types";
import { backend } from "../lib/backend";
import {localCommand} from '../local-app/client';
import { HelpTip } from "../ui/HelpTip";
import { ConfirmationModal } from "../ui/ConfirmationModal";
import { useDialogFocus } from "../ui/useDialogFocus";
import type { LocalSystemStatusReport, SystemState } from "../observability/SystemStatusPanel";
import { registeredAdapters, type LocalAdapterReadiness } from "../worker/registeredAdapters";
import { ExternalConnectionPicker, type ExternalConnectionInput, type ExternalConnectionVersion } from "../connections/ConnectionWorkspace";
import { repairTargetForBlocker } from "../reviews/repairTarget";
import type { WorkerBlocker } from "../reviews/reviewSelectors";
import {
  blueprintFormToPolicy,
  blueprintPolicyToForm,
  configurableMediaAdapterKeys,
  defaultMediaAdapterForm,
  mediaAdapterKeys,
  mediaAdapterConfiguration,
  seriesFormToRules,
  seriesRulesToForm,
  mediaAdapterStatus,
  validateMediaAdapter,
  validateMediaAdapters,
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
] as const;
const approvalGateHelp: Record<(typeof approvalGateOptions)[number][0], string> = {
  script: "AI 生成或修改脚本后暂停，等待 Owner 审核。自行上传的脚本仍需确认为主脚本，但不会因此触发 AI 脚本审核。",
  visual: "产生新的视觉方案或视觉素材后暂停。素材来自上传还是外部 API，不改变是否需要审核。",
  storyboard: "生成或修改分镜 JSON 后暂停，等待 Owner 审核镜头结构与制作要求。",
  qc: "审核视频生成并通过自动校验后暂停。关闭后仅在没有阻塞问题时自动继续。",
};
const executorLabels = {
  script_writing: "脚本生成",
  visual_planning: "视觉规划",
  storyboard_planning: "分镜规划",
} as const;
const visibleExecutorKeys = ["storyboard_planning"] as const;
const promptCapabilityOptions: Array<[PromptCapability, string]> = [
  ["storyboard_planning", "分镜规划"],
];
function FieldHint({ children }: { children: ReactNode }) {
  return <p className="field-hint">{children}</p>;
}

function FieldLabel({ children, help }: { children: ReactNode; help?: ReactNode }) {
  return <span className="field-label">{children}{help ? <HelpTip label={typeof children === "string" ? children : "字段"}>{help}</HelpTip> : null}</span>;
}

function PromptVersionManager({ fixedCapability, isPending, onClose, onCreate, onSelect, promptVersions, selectedVersionId }: { fixedCapability?: PromptCapability; isPending: boolean; onClose: () => void; onCreate?: (input: { capability: PromptCapability; name: string; summary: string; instructions: string }) => Promise<PromptVersion | null>; onSelect: (version: PromptVersion) => void; promptVersions: PromptVersion[]; selectedVersionId?: string }) {
  const [capability, setCapability] = useState<PromptCapability>(fixedCapability ?? "storyboard_planning");
  const [name, setName] = useState("");
  const [summary, setSummary] = useState("");
  const [instructions, setInstructions] = useState("");
  const [error, setError] = useState("");
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!onCreate) return;
    if (!name.trim() || !summary.trim() || !instructions.trim()) {
      setError("请填写版本名称、摘要和 Harness 内容。");
      return;
    }
    setError("");
    const created = await onCreate({ capability, name: name.trim(), summary: summary.trim(), instructions: instructions.trim() });
    if (!created) return;
    onSelect(created);
    setName("");
    setSummary("");
    setInstructions("");
    setIsCreateOpen(false);
  }

  const visibleCapabilities = fixedCapability ? promptCapabilityOptions.filter(([key]) => key === fixedCapability) : promptCapabilityOptions;
  const versions = promptVersions.filter((version) => visibleCapabilities.some(([key]) => key === version.capability));
  const currentVersion = versions.find((version) => version.id === selectedVersionId) ?? versions[0];
  const previousVersions = versions.filter((version) => version.id !== currentVersion?.id);
  const dialogRef = useDialogFocus(true, onClose);
  return <div aria-label={`管理${fixedCapability ? executorLabels[fixedCapability] : "Prompt"}版本`} aria-modal="true" className="stage-configuration-dialog prompt-version-dialog" ref={dialogRef} role="dialog"><section><header><div><h3>管理{fixedCapability ? executorLabels[fixedCapability] : "Prompt"}版本</h3><p>已有生产单保留冻结版本；此处管理后续可选版本。</p></div><Button size="sm" color="tertiary" aria-label={`关闭${fixedCapability ? executorLabels[fixedCapability] : "Prompt"}版本管理`} className="icon-button" onClick={onClose} type="button"><XClose aria-hidden="true" width={20} height={20}/></Button></header><div className="prompt-version-manager">
    {currentVersion ? <section className="prompt-version-current"><div><span>当前选择</span><strong>{currentVersion.name}</strong><code>{currentVersion.slug}</code></div><span>v{currentVersion.version}</span></section> : <p className="summary-empty">还没有登记版本。</p>}
    {previousVersions.length ? <Disclosure label={<>历史版本（{previousVersions.length}）</>} className="prompt-version-history"><div>{previousVersions.map((version) => <article className="prompt-version-item" key={version.id}><div><strong>{version.name}</strong><span>{version.slug}</span></div><p>{version.summary}</p></article>)}</div></Disclosure> : null}
    {onCreate ? <section className="prompt-version-create"><Button size="xs" color="secondary" aria-expanded={isCreateOpen} className="button button-secondary button-small" onClick={() => setIsCreateOpen((open) => !open)} type="button">{isCreateOpen ? "收起新版本表单" : "登记新版本"}</Button>{isCreateOpen ? <form onSubmit={(event) => void submit(event)}><p className="muted-copy">保存时自动生成下一版编号。</p>{fixedCapability ? <p className="muted-copy">适用阶段：{executorLabels[fixedCapability]}</p> : <label><FieldLabel help="选择这版 Prompt 服务的生成阶段。">适用阶段</FieldLabel><NativeSelect size="sm" aria-label="适用阶段" onChange={(event) => setCapability(event.target.value as PromptCapability)} value={capability}>{promptCapabilityOptions.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</NativeSelect></label>}<label><FieldLabel help="给运营人员看的名称，不是 Worker 识别用的 slug。">版本名称</FieldLabel><InputBase size="sm" aria-label="版本名称" onChange={(event) => setName(event.target.value)} placeholder="例如：脚本生成·强化冲突 v2" value={name} /></label><label><FieldLabel help="用一句话说明这一版主要改变了什么。">版本摘要</FieldLabel><InputBase size="sm" aria-label="版本摘要" onChange={(event) => setSummary(event.target.value)} placeholder="例如：强化开头钩子和人物动机" value={summary} /></label><label><FieldLabel help="这是会冻结并实际发送给 Codex 的 Prompt Harness 内容。">Harness 内容</FieldLabel><TextAreaBase size="sm" aria-label="Harness 内容" onChange={(event) => setInstructions(event.target.value)} placeholder="例如：开头 3 秒必须提出冲突；结尾保留审核所需的事实依据。" rows={3} value={instructions} /></label><Button size="sm" color="primary" className="button button-primary" isDisabled={isPending} type="submit">{isPending ? "登记中…" : "保存新版本"}</Button>{error ? <p className="form-error">{error}</p> : null}</form> : null}</section> : null}
  </div><footer><Button size="sm" color="secondary" className="button button-secondary" onClick={onClose} type="button">返回分镜配置</Button></footer></section></div>;
}

function ConfigurationSwitch({ ariaLabel, checked, disabled = false, help, label, onChange }: { ariaLabel?: string; checked: boolean; disabled?: boolean; help?: string; label: string; onChange: (checked: boolean) => void }) {
  return <div className="configuration-switch"><Checkbox aria-label={ariaLabel ?? label} isSelected={checked} isDisabled={disabled} onChange={onChange} label={ariaLabel ? undefined : label}/>{help ? <HelpTip label={label}>{help}</HelpTip> : null}</div>;
}

function StageConfigurationDialog({ executor, executorKey, inline = false, onClose, onManagePromptVersions, onSelectPromptVersion, onUpdateExecutor, promptVersions, readOnly }: { executor: BlueprintFormValues["executors"]["script_writing"]; executorKey: keyof BlueprintFormValues["executors"]; inline?: boolean; onClose: () => void; onManagePromptVersions?: () => void; onSelectPromptVersion: (version: PromptVersion) => void; onUpdateExecutor: (field: keyof BlueprintFormValues["executors"]["script_writing"], value: string) => void; promptVersions: PromptVersion[]; readOnly: boolean }) {
  const label = executorLabels[executorKey];
  const usesPromptHarness = executorKey === "storyboard_planning";
  const versions = promptVersions.filter((version) => version.capability === executorKey && version.is_active);
  const selectedValue = usesPromptHarness ? executor.harnessId : executor.promptVersion;
  const hasSelectedVersion = versions.some((version) => usesPromptHarness ? version.id === executor.harnessId : version.slug === executor.promptVersion);
  const dialogRef = useDialogFocus(!inline, onClose);
  return <div aria-label={inline ? undefined : `${label}配置`} aria-modal={inline ? undefined : "true"} className={`stage-configuration-dialog${inline ? " is-inline" : ""}`} ref={dialogRef} role={inline ? undefined : "dialog"}><section>{inline ? null : <header><div><h3>{label}</h3></div><Button size="sm" color="tertiary" aria-label={`关闭${label}配置`} className="icon-button" onClick={onClose} type="button"><XClose aria-hidden="true" width={20} height={20}/></Button></header>}<div className="stage-configuration-fields"><label><FieldLabel help={usesPromptHarness ? `${label}固定使用已注册的 Codex Adapter。` : "执行服务，例如 codex。"}>Provider</FieldLabel><InputBase size="sm" aria-label={`${label} Provider`} isDisabled={readOnly || usesPromptHarness} onChange={(event) => onUpdateExecutor("provider", event.target.value)} value={executor.provider} /></label>{usesPromptHarness ? <label><FieldLabel help="Adapter、Harness 与模型会一同冻结到 Worker 任务中。">Adapter</FieldLabel><InputBase size="sm" aria-label={`${label} Adapter`} readOnly value="codex" /></label> : null}<label><FieldLabel help="执行时使用的模型名称。">模型</FieldLabel><InputBase size="sm" aria-label={`${label} 模型`} isDisabled={readOnly} onChange={(event) => onUpdateExecutor("model", event.target.value)} value={executor.model} /></label><label><FieldLabel help={usesPromptHarness ? "所选 Harness 会作为分镜生成 Prompt 的执行上下文，并在新生产单中冻结；以后切换版本不会改动已有生产单。" : "从已登记版本中选择执行规则。"}>{usesPromptHarness ? "Prompt Harness" : "Prompt 版本"}</FieldLabel>{versions.length ? <NativeSelect size="sm" aria-label={`${label} ${usesPromptHarness ? "Prompt Harness" : "Prompt 版本"}`} disabled={readOnly} onChange={(event) => { const version = versions.find((candidate) => (usesPromptHarness ? candidate.id : candidate.slug) === event.target.value); if (version) onSelectPromptVersion(version); }} value={hasSelectedVersion ? selectedValue : "__unregistered__"}>{!hasSelectedVersion ? <option value="__unregistered__">{executor.promptVersion || "当前值"}（未登记）</option> : null}{versions.map((version) => <option key={version.id} value={usesPromptHarness ? version.id : version.slug}>{version.name} · {version.slug}</option>)}</NativeSelect> : <InputBase size="sm" aria-label={`${label} Prompt 版本`} isDisabled={readOnly} onChange={(event) => onUpdateExecutor("promptVersion", event.target.value)} value={executor.promptVersion} />}</label></div>{usesPromptHarness && !readOnly && onManagePromptVersions ? <Button size="sm" color="tertiary" aria-label="管理 Prompt 版本" className="stage-configuration-manager-action" onClick={onManagePromptVersions} type="button">管理版本</Button> : null}{inline ? null : <footer><Button size="sm" color="primary" className="button button-primary" onClick={onClose} type="button">完成</Button></footer>}</section></div>;
}

function MediaAdapterCard({ adapterKey, connectionVersions = [], externalConnections = [], form, localAdapterReadiness = {}, onChange, onCreateConnection, onRotateConnection, onTestConnection, onUpdateConnection, readOnly = false }: { adapterKey: MediaAdapterKey; connectionVersions?: ExternalConnectionVersion[]; externalConnections?: ExternalConnection[]; form: MediaAdapterForm; localAdapterReadiness?: LocalAdapterReadiness; onChange: (field: keyof MediaAdapterForm, value: string) => void; onCreateConnection?: (input: ExternalConnectionInput) => Promise<ExternalConnection | null>; onRotateConnection?: (input: { connectionId: string; provider: ExternalConnectionInput["provider"]; adapter: ExternalConnectionInput["adapter"]; secret: string }) => Promise<ExternalConnection | null>; onTestConnection?: (connectionId: string) => Promise<unknown>; onUpdateConnection?: (input: { connectionId: string; name: string; description: string }) => Promise<void>; readOnly?: boolean }) {
  const definition = mediaAdapterConfiguration(adapterKey);
  const label = mediaConfigurationLabel(adapterKey);
  const hasConfigurationField = (field: typeof definition.configurationFields[number]) => definition.configurationFields.includes(field);
  const status = mediaAdapterStatus(adapterKey, form);
  const statusClass = status === "已配置" ? "is-configured" : status === "待补齐" ? "is-incomplete" : "is-empty";
  const numberField = (field: keyof MediaAdapterForm, title: string, help: string, min = 1) => <label><FieldLabel help={help}>{title}</FieldLabel><InputBase size="sm" aria-label={title} min={min} onChange={(event) => onChange(field, event.target.value)} readOnly={readOnly} step={min < 1 ? "0.1" : "1"} type="number" value={form[field]} /></label>;
  const selectedPath = form.executionPath ?? "";
  const externalAdapters = registeredAdapters.choicesFor({ capability: definition.capability, executionPath: "external" });
  const localAdapters = registeredAdapters.choicesFor({ capability: definition.capability, executionPath: "local" }).filter((registration) => localAdapterReadiness[registration.identityKey] === true);
  const availablePaths = [...(externalAdapters.length ? ["external" as const] : []), ...(localAdapters.length ? ["local" as const] : []), "manual" as const];
  const selectedResolution = registeredAdapters.resolve({ capability: definition.capability, executionPath: selectedPath, provider: form.provider, adapter: form.adapter });
  const selectedRegisteredAdapter = selectedResolution.kind === "registered" ? selectedResolution.choice : undefined;
  const selectedCatalog = selectedPath === "local" ? localAdapters.find((candidate) => candidate.provider === form.provider && candidate.adapter === form.adapter) : selectedRegisteredAdapter;
  const ownerManagedConnection = selectedRegisteredAdapter?.connection.kind === "owner_managed";
  const connectionOptions: Array<{ credentialRef: string; label: string }> = [];
  const modelCatalog = selectedCatalog?.modelCatalog ?? [];
  const presetCatalog = selectedCatalog?.presetCatalog ?? [];
  const presetLabel = adapterKey === "a_roll" && form.provider === "openchatcut" ? "卡片预设" : "执行预设";

  return <article className={`media-adapter-card ${statusClass}`}>
    <header><div><h4>{label}</h4><p>{definition.description}</p></div><span className="media-adapter-status">{status}</span></header><div className="media-adapter-controls">
    <section className="media-adapter-group"><h5>执行方式</h5><div className="media-adapter-field-grid">
      <label><FieldLabel help="首次启用不会自动选择路径；人工素材不会创建 Worker 或外部任务。">执行路径</FieldLabel><NativeSelect size="sm" aria-label={`${label} 执行路径`} disabled={readOnly} onChange={(event) => onChange("executionPath", event.target.value)} value={selectedPath}><option value="">请选择执行路径</option>{availablePaths.includes("external") ? <option value="external">外部</option> : null}<option disabled={!availablePaths.includes("local")} value="local">本地{availablePaths.includes("local") ? "" : "（未部署）"}</option><option value="manual">人工素材</option></NativeSelect></label>
      {selectedPath === "manual" ? <p className="field-hint">Episode 会按镜头与音频 cue 生成待补齐素材清单，不创建 Worker 或外部任务。</p> : null}
      {selectedPath === "local" && localAdapters.length === 0 ? <p className="field-hint">当前 Worker 没有已部署的本地 {label} Adapter；请联系环境管理员。</p> : null}
      {selectedPath === "local" && localAdapters.length ? <label><FieldLabel help="只能选择 Worker 已部署的本地 Adapter。">Adapter</FieldLabel><NativeSelect size="sm" aria-label={`${label} 本地 Adapter`} disabled={readOnly} onChange={(event) => { const registration = localAdapters.find((candidate) => candidate.adapter === event.target.value); if (!registration) return; onChange("provider", registration.provider); onChange("adapter", registration.adapter); onChange("credentialRef", ""); onChange("model", ""); onChange("promptVersion", ""); onChange("allowedTools", "read, write"); onChange("voiceLanguageCode", ""); onChange("voiceName", ""); }} value={selectedCatalog?.adapter ?? ""}><option value="">请选择 Adapter</option>{localAdapters.map((registration) => <option key={registration.identityKey} value={registration.adapter}>{registration.provider} · {registration.adapter}</option>)}</NativeSelect></label> : null}
      {selectedPath === "external" ? <>
        <label><FieldLabel help="Provider 由已注册 Adapter 声明，不能自由填写。">Provider</FieldLabel><InputBase size="sm" aria-label="Provider" readOnly value={externalConnectionProviderLabel(selectedRegisteredAdapter?.provider ?? form.provider)} /></label>
        <label><FieldLabel help="只能选择 Worker 已注册的外部 Adapter。">Adapter</FieldLabel><NativeSelect size="sm" aria-label={`${label} Adapter`} disabled={readOnly} onChange={(event) => { const registration = externalAdapters.find((candidate) => candidate.adapter === event.target.value); if (!registration) return; onChange("provider", registration.provider); onChange("adapter", registration.adapter); onChange("credentialRef", ""); onChange("model", ""); onChange("promptVersion", ""); onChange("allowedTools", "read, write"); onChange("voiceLanguageCode", ""); onChange("voiceName", ""); }} value={selectedRegisteredAdapter?.adapter ?? "__unregistered__"}><option value="__unregistered__">请选择 Adapter</option>{externalAdapters.map((registration) => <option key={registration.identityKey} value={registration.adapter}>{registration.provider} · {registration.adapter}</option>)}</NativeSelect></label>
      </> : null}
    </div></section>

    {selectedPath === "external" || selectedPath === "local" ? <section className="media-adapter-group"><h5>输出设置</h5><div className="media-adapter-field-grid">
        <label><FieldLabel help="只能从当前 Adapter 声明的模型目录选择。">模型</FieldLabel><NativeSelect size="sm" aria-label={`${label} 模型`} disabled={readOnly || !selectedCatalog} onChange={(event) => onChange("model", event.target.value)} value={modelCatalog.includes(form.model) ? form.model : ""}><option value="">请选择模型</option>{form.model && !modelCatalog.includes(form.model) ? <option value={form.model}>{form.model}（已冻结但不在当前目录）</option> : null}{modelCatalog.map((model) => <option key={model} value={model}>{model}</option>)}</NativeSelect></label>
        <label><FieldLabel help="固定该 Adapter 的执行规则版本。">{presetLabel}</FieldLabel><NativeSelect size="sm" aria-label={`${label} ${presetLabel}`} disabled={readOnly || !selectedCatalog} onChange={(event) => onChange("promptVersion", event.target.value)} value={presetCatalog.includes(form.promptVersion) ? form.promptVersion : ""}><option value="">请选择预设</option>{form.promptVersion && !presetCatalog.includes(form.promptVersion) ? <option value={form.promptVersion}>{form.promptVersion}（已冻结但不在当前目录）</option> : null}{presetCatalog.map((preset) => <option key={preset} value={preset}>{preset}</option>)}</NativeSelect></label>
      {definition.configurationFields.length ? <>{hasConfigurationField("max_attempts") ? numberField("maxAttempts", "最大尝试次数", "媒体任务失败后的最大执行尝试次数。") : null}</> : null}
    </div></section> : null}
    {selectedPath === "external" && (connectionOptions.length || ownerManagedConnection) ? <section className="media-adapter-group media-adapter-connection-group"><h5>外部连接</h5>{connectionOptions.length&&!ownerManagedConnection ? <label><FieldLabel help="蓝图只保存已验证连接版本 ID，不保存 API Key。">外部连接</FieldLabel><NativeSelect size="sm" aria-label={`${label} 外部连接`} disabled={readOnly || !selectedRegisteredAdapter} onChange={(event) => onChange("credentialRef", event.target.value)} value={connectionOptions.some((connection) => connection.credentialRef === form.credentialRef) ? form.credentialRef : ""}><option value="">请选择已验证连接</option>{connectionOptions.map((connection) => <option key={connection.credentialRef} value={connection.credentialRef}>{connection.label}</option>)}</NativeSelect></label> : null}{ownerManagedConnection ? <ExternalConnectionPicker adapter={selectedRegisteredAdapter!.adapter as ExternalConnectionInput["adapter"]} connections={externalConnections} isPending={readOnly} label={label} officialEndpoint={selectedRegisteredAdapter?.connection.kind === "owner_managed" ? selectedRegisteredAdapter.connection.endpoint : undefined} onCreateConnection={onCreateConnection} onRotateConnection={onRotateConnection} onSelectVersion={(versionId) => onChange("credentialRef", versionId)} onTestConnection={onTestConnection} onUpdateConnection={onUpdateConnection} provider={selectedRegisteredAdapter!.provider as ExternalConnectionInput["provider"]} selectedVersionId={form.credentialRef} versions={connectionVersions} /> : null}</section> : null}
    {selectedPath === "" ? <p className="field-hint">请先选择执行路径。未选择前不会自动绑定连接、模型或预设。</p> : null}
    </div>
  </article>;
}

function mediaConfigurationLabel(key: MediaAdapterKey): string {
  return key === "static_visual" ? "图片生成" : mediaAdapterConfiguration(key).label;
}

function mediaAdapterPathLabel(form: MediaAdapterForm): string {
  if (!form.executionPath) return "未选择";
  if (form.executionPath === "manual") return "人工素材";
  if (form.executionPath === "local") return `本地 · ${form.adapter || "未选择 Adapter"}`;
  return `外部 · ${form.provider ? externalConnectionProviderLabel(form.provider) : "未选择 Provider"}`;
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
  if (isVideoProvider(provider)) return videoProviders[provider].label;
  return provider === "bailian" ? "百炼万相" : provider === "openai" ? "OpenAI Images" : provider === "cloudflare" ? "Cloudflare Workers AI" : provider === "google_tts" ? "Google TTS" : provider === "volcengine_tts" ? "火山语音" : provider === "pexels" ? "Pexels" : provider === "freesound" ? "Freesound" : provider || "未选择供应商";
}

function RuntimeDependencyStatus({ report }: { report: LocalSystemStatusReport | null }) {
  const items = runtimeDependencyItems(report);
  return <fieldset className="technical-runtime-status"><legend>依赖状态</legend>{items.length ? <ul>{items.map((item) => <li key={item.name}><strong>{item.name} · {systemStateLabel(item.state)}</strong><span>{item.detail}</span></li>)}</ul> : <p className="summary-empty">尚未读取本地依赖报告；保存的只是配置声明。</p>}<FieldHint>这里复用本地系统状态报告；Worker 注册、凭据、模型权限和实际供应商接受仍在生产前检查。</FieldHint></fieldset>;
}

function mediaAdapterPreview(key: MediaAdapterKey, form: MediaAdapterForm): string {
  const details = [
    form.provider && `${form.provider}/${form.adapter}/${form.model}/${form.promptVersion}`,
    form.maxAttempts && `尝试 ${form.maxAttempts}`,
    form.voiceLanguageCode && `语言 ${form.voiceLanguageCode}`,
    form.voiceName && `声音 ${form.voiceName}`,
    form.voiceSpeakingRate && `语速 ${form.voiceSpeakingRate}`,
  ].filter(Boolean);
  return `${mediaConfigurationLabel(key)} · ${details.join(" · ") || "未配置"}`;
}

function BlueprintPolicyPreview({ form }: { form: BlueprintFormValues }) {
  const enabledMediaAdapters = form.enabledMediaAdapters ?? [];
  return <fieldset className="technical-policy-preview"><legend>最终写入与冻结预览</legend><dl className="configuration-summary blueprint-summary-grid">
    <div><dt>资产目录</dt><dd>{form.assetRoot || "未配置"}</dd></div>
    <div><dt>生产能力</dt><dd>{enabledMediaAdapters.length ? enabledMediaAdapters.map((key) => `${mediaConfigurationLabel(key)} · ${mediaAdapterStatus(key, form.mediaAdapters[key])}`).join("；") : "暂未启用可选媒体能力"}</dd></div>
    <div className="blueprint-summary-wide"><dt>分镜规划</dt><dd><div className="summary-chip-list">{visibleExecutorKeys.map((key) => <span className="summary-chip" key={key}>{executorLabels[key]} · {form.executors[key].provider} / {form.executors[key].model} / {form.executors[key].promptVersion}</span>)}</div></dd></div>
    <div className="blueprint-summary-wide"><dt>媒体适配器</dt><dd>{enabledMediaAdapters.length ? enabledMediaAdapters.map((key) => mediaAdapterPreview(key, form.mediaAdapters[key])).join("；") : "暂未启用可选媒体能力"}</dd></div>
    <div className="blueprint-summary-wide"><dt>冻结边界</dt><dd>仅新生产单生效；已有生产单保留冻结配置。</dd></div>
  </dl><FieldHint>这里只显示会写入蓝图并在新 Episode 创建时冻结的静态声明，不包含 API Key、Token 或 Worker 运行态。</FieldHint></fieldset>;
}

export function BlueprintConfigurationForm({ accountId, accountLayout = false, footerStatus, saveState, connectionVersions = [], externalConnections = [], initialAssetRoot, initialPolicy, isEpisodeRepair = false, isPending, localAdapterReadiness = {}, onCancel, onCreateConnection, onCreatePromptVersion, onDirtyChange, onRotateConnection, onSave, onTestConnection, onUpdateConnection, promptVersions = [], readOnly = false, systemStatus = null, technicalOnly = false }: { accountId?: string; accountLayout?: boolean; footerStatus?: ReactNode; saveState?: ReactNode; connectionVersions?: ExternalConnectionVersion[]; externalConnections?: ExternalConnection[]; initialAssetRoot: string; initialPolicy: Json; isEpisodeRepair?: boolean; isPending: boolean; localAdapterReadiness?: LocalAdapterReadiness; onCancel: () => void; onCreateConnection?: (input: ExternalConnectionInput) => Promise<ExternalConnection | null>; onCreatePromptVersion?: (input: { capability: PromptCapability; name: string; summary: string; instructions: string }) => Promise<PromptVersion | null>; onDirtyChange?: (dirty: boolean) => void; onRotateConnection?: (input: { connectionId: string; provider: ExternalConnectionInput["provider"]; adapter: ExternalConnectionInput["adapter"]; secret: string }) => Promise<ExternalConnection | null>; onSave: (policy: Json, activate: boolean) => Promise<void>; onTestConnection?: (connectionId: string) => Promise<unknown>; onUpdateConnection?: (input: { connectionId: string; name: string; description: string }) => Promise<void>; promptVersions?: PromptVersion[]; readOnly?: boolean; systemStatus?: LocalSystemStatusReport | null; technicalOnly?: boolean }) {
  const initialForm = () => blueprintPolicyToForm({ ...(initialPolicy && typeof initialPolicy === "object" && !Array.isArray(initialPolicy) ? initialPolicy : {}), asset_root: initialAssetRoot } as Json);
  const initialPolicyKey = JSON.stringify(initialPolicy);
  const [form, setForm] = useState<BlueprintFormValues>(initialForm);
  const [error, setError] = useState("");
  const [assetDirectoryAction, setAssetDirectoryAction] = useState<"choose" | "open" | null>(null);
  const assetDirectoryGeneration = useRef(0);
  useEffect(() => { assetDirectoryGeneration.current++; setAssetDirectoryAction(null); return () => { assetDirectoryGeneration.current++; }; }, [accountId, initialAssetRoot, initialPolicyKey]);
  const [storyboardConfigurationOpen, setStoryboardConfigurationOpen] = useState(false);
  const [promptVersionManagerOpen, setPromptVersionManagerOpen] = useState(false);
  const [mediaAdapterConfigurationKey, setMediaAdapterConfigurationKey] = useState<MediaAdapterKey | null>(null);
  const [saveConfirmationOpen, setSaveConfirmationOpen] = useState(false);
  const mediaAdapterDialogRef = useDialogFocus(mediaAdapterConfigurationKey !== null, () => setMediaAdapterConfigurationKey(null));
  useEffect(() => { setForm(initialForm()); setStoryboardConfigurationOpen(false); setPromptVersionManagerOpen(false); setMediaAdapterConfigurationKey(null); setSaveConfirmationOpen(false); onDirtyChange?.(false); }, [initialAssetRoot, initialPolicyKey, onDirtyChange]);

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
    if (backend === "local") return localCommand<{assetRoot?:unknown;cancelled?:boolean}>(action === "choose" ? 'chooseAssetDirectory' : 'openAssetDirectory', {accountId,...(action === 'open' ? {path:form.assetRoot.trim()} : {})}, undefined, 'account-commands');
    const { viewTransport } = await import("../lib/viewTransport");
    const { data, error: sessionError } = await viewTransport.auth.getSession();
    if (sessionError) throw sessionError;
    if (!data.session) throw new Error("需要 Owner 登录会话。");
    const query = new URLSearchParams({ account: accountId, ...(action === "open" ? { path: form.assetRoot.trim() } : {}) });
    const response = await fetch(`${action === "choose" ? "/_choose-local-asset-directory" : "/_open-local-asset-directory"}?${query}`, { method: "POST", headers: { Authorization: `Bearer ${data.session.access_token}` } });
    if (!response.ok) throw new Error((await response.text()).trim() || (action === "choose" ? "无法选择本地文件夹。" : "无法打开本地文件夹。"));
    return action === "choose" ? await response.json() as { assetRoot?: unknown; cancelled?: boolean } : null;
  }

  async function chooseAssetDirectory() {
    const generation = ++assetDirectoryGeneration.current;
    setAssetDirectoryAction("choose");
    setError("");
    try {
      const result = await requestLocalAssetDirectory("choose");
      if (generation !== assetDirectoryGeneration.current) return;
      if (result?.cancelled) return;
      if (typeof result?.assetRoot !== "string" || !result.assetRoot.trim()) throw new Error("未获取到有效的本地文件夹路径。");
      update({ assetRoot: result.assetRoot });
    } catch (cause) { if (generation === assetDirectoryGeneration.current) setError(cause instanceof Error ? cause.message : "无法选择本地文件夹。"); } finally { if (generation === assetDirectoryGeneration.current) setAssetDirectoryAction(null); }
  }

  async function openAssetDirectory() {
    if (!form.assetRoot.trim()) { setError("请先填写或选择资产目录。"); return; }
    const generation = ++assetDirectoryGeneration.current;
    setAssetDirectoryAction("open");
    setError("");
    try { await requestLocalAssetDirectory("open"); } catch (cause) { if (generation === assetDirectoryGeneration.current) setError(cause instanceof Error ? cause.message : "无法打开本地文件夹。"); } finally { if (generation === assetDirectoryGeneration.current) setAssetDirectoryAction(null); }
  }

  function requestSubmit() {
    try {
      setError("");
      for (const key of visibleExecutorKeys) {
        const executor = form.executors[key];
        if (!executor.provider.trim() || !executor.model.trim() || !executor.promptVersion.trim()) throw new Error(`${executorLabels[key]}执行器的 Provider、模型和 Prompt 版本不能为空。`);
        if (!executor.harnessId?.trim() || !promptVersions.some((version) => version.id === executor.harnessId && version.capability === key && version.is_active)) throw new Error("分镜规划必须选择已登记且启用的 Prompt Harness。");
      }
      const availableExternalConnectionVersionIds = connectionVersions.length ? connectionVersions.filter((version) => version.is_current && version.status === "verified" && !version.revoked_at).map((version) => version.id) : undefined;
      validateMediaAdapters(form.mediaAdapters, { availableExternalConnectionVersionIds, enabledKeys: form.enabledMediaAdapters });
      setSaveConfirmationOpen(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "蓝图规则无法保存。");
    }
  }

  async function confirmSubmit() {
    try {
      setError("");
      await onSave(blueprintFormToPolicy(form), true);
      onDirtyChange?.(false);
      setSaveConfirmationOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "蓝图规则无法保存。");
    }
  }

  function reset() {
    setForm(initialForm());
    setStoryboardConfigurationOpen(false);
    setMediaAdapterConfigurationKey(null);
    setError("");
    onDirtyChange?.(false);
    onCancel();
  }

  const enabledMediaAdapters = form.enabledMediaAdapters ?? [];
  const readinessMessage = form.assetRoot.trim() ? "资产目录已填写；保存后仍需 Worker 验证目录可读写。" : "草稿：未填写资产目录，不能达到生产就绪。";
  const localDirectoryActions = Boolean(accountId && (backend === 'local' || import.meta.env.DEV) && !readOnly);
  return <section className={`configuration-form blueprint-configuration-form${accountLayout ? " account-blueprint-form" : ""}`}>
    {accountLayout ? null : <div className="blueprint-editor-note"><span>{readOnly ? "已保存规则" : isEpisodeRepair ? "当前生产单修复" : "应用于新生产单"}</span><HelpTip label="蓝图配置生效范围">{readOnly ? "以下按表单结构显示此蓝图版本当前保存的规则。" : isEpisodeRepair ? "只修改当前生产单需要的冻结配置；已完成工作和审核记录会保留。" : technicalOnly ? "这里编辑当前蓝图的技术与运行前置声明；保存后只影响之后新建的 Episode，已有 Episode 继续使用冻结配置。" : "保存会直接更新当前蓝图规则，不创建新的用户可见版本；已经创建的 Episode 仍使用自己的规则快照。"}</HelpTip></div>}
    {technicalOnly ? <RuntimeDependencyStatus report={systemStatus} /> : null}
    {technicalOnly ? null : <fieldset id={accountLayout ? "account-rules" : undefined}><legend><FieldLabel help="账号级长期创作基线，会进入视觉准备与分镜生成的 Prompt 上下文。当前主脚本由 Owner 提供，因此不会依据此字段自动生成脚本。只填写跨系列长期稳定的受众、主题和表达方向。">账号定位</FieldLabel></legend><label><TextAreaBase size="sm" aria-label="账号定位" onChange={(event) => update({ positioning: event.target.value })} placeholder="例如：面向固定受众，持续制作某类短视频内容。" readOnly={readOnly} rows={accountLayout ? 2 : 3} value={form.positioning} /></label></fieldset>}
    <fieldset id={accountLayout ? "account-assets" : undefined}><legend>{technicalOnly ? "运行前置与权限声明" : accountLayout ? "资产目录" : "本地资产与审批"}</legend><label className={accountLayout ? "account-asset-field" : undefined}>{accountLayout ? null : <FieldLabel help="账号素材的本地目录。">资产目录</FieldLabel>}<div className="asset-root-control"><InputBase size="sm" aria-label="资产目录" onChange={(event) => update({ assetRoot: event.target.value })} placeholder="例如：/Volumes/素材盘/账号目录" readOnly={readOnly} value={form.assetRoot} />{localDirectoryActions ? <><Button size="xs" color="secondary" className="button button-secondary button-small" isDisabled={assetDirectoryAction !== null} onClick={() => void chooseAssetDirectory()} type="button">{assetDirectoryAction === "choose" ? "选择中…" : "选择文件夹"}</Button><Button size="xs" color="secondary" className="button button-secondary button-small" isDisabled={assetDirectoryAction !== null || !form.assetRoot.trim()} onClick={() => void openAssetDirectory()} type="button">{assetDirectoryAction === "open" ? "打开中…" : "打开文件夹"}</Button></> : null}</div></label>{!accountLayout || !form.assetRoot.trim() ? <p className="blueprint-readiness" role="status">{accountLayout ? "未填写资产目录，生产前需要配置。" : readinessMessage}</p> : null}{technicalOnly ? <FieldHint>Worker 所需的文件读写能力由平台按生产能力声明；资产目录只影响运行时访问范围。</FieldHint> : !accountLayout ? <div className="configuration-switch-groups"><div><span className="configuration-label"><FieldLabel help="开启后，新产物完成时会停下来等待 Owner；关闭后，校验通过便自动推进。素材来源和能力开关不会改变这里的设置。">审批关卡</FieldLabel></span><div className="configuration-switch-list approval-gate-switches">{approvalGateOptions.map(([value, label]) => <ConfigurationSwitch checked={form.approvalGates.includes(value)} disabled={readOnly} help={approvalGateHelp[value]} key={value} label={label} onChange={(checked) => update({ approvalGates: checked ? [...form.approvalGates, value] : form.approvalGates.filter((item) => item !== value) })} />)}</div></div></div> : null}</fieldset>
    <fieldset id="account-capabilities"><legend><FieldLabel help="启用后配置执行路径、连接与模型；配置不完整时，生产前检查会阻止创建生产单。保存只影响之后新建的生产单。">生产能力</FieldLabel></legend><div aria-label="生产能力配置矩阵" className="capability-matrix" role="table"><div className="capability-matrix-row capability-matrix-heading" role="row"><span role="columnheader">能力</span><span role="columnheader">启用</span><span role="columnheader">{accountLayout ? "执行方式" : "执行路径"}</span>{accountLayout ? null : <span role="columnheader">状态</span>}<span role="columnheader">操作</span></div>{accountLayout ? <div className="capability-matrix-row" role="row" id="account-budget"><strong role="cell">分镜规划</strong><div role="cell"><ConfigurationSwitch ariaLabel="分镜规划已启用" checked disabled label="分镜规划" onChange={() => {}} /></div><div className="capability-matrix-path" role="cell"><span>{form.executors.storyboard_planning.provider} · {form.executors.storyboard_planning.model}</span><small>{form.executors.storyboard_planning.promptVersion || "未配置 Prompt"}</small></div><div role="cell">{readOnly ? null : <Button size="xs" color="secondary" aria-label="修改分镜规划配置" onClick={() => setStoryboardConfigurationOpen(true)} type="button">配置</Button>}</div></div> : null}{mediaAdapterKeys.map((key) => { const enabled = enabledMediaAdapters.includes(key); const adapterForm = form.mediaAdapters[key]; const status = enabled ? mediaAdapterStatus(key, adapterForm) : "未启用"; const isConfigured = status === "已配置"; const label = mediaConfigurationLabel(key); return <div className="capability-matrix-row" key={key} role="row"><strong role="cell">{label}</strong><div role="cell"><ConfigurationSwitch ariaLabel={`启用${label}`} checked={enabled} disabled={readOnly} label={label} onChange={(checked) => toggleMediaAdapter(key, checked)} /></div><span className="capability-matrix-path" role="cell">{enabled ? mediaAdapterPathLabel(adapterForm) : accountLayout ? "未启用" : "—"}{accountLayout && enabled ? <small className={isConfigured ? "" : "is-incomplete"}>{isConfigured ? (adapterForm.executionPath === "manual" ? null : adapterForm.model) : status}</small> : null}</span>{accountLayout ? null : <span className={`capability-matrix-status${isConfigured ? " is-configured" : status === "未启用" ? "" : " is-incomplete"}`} role="cell">{status}</span>}<div role="cell">{readOnly || !enabled ? null : <Button size="xs" color="secondary" aria-label={`配置${label}`} className="button button-secondary button-small" onClick={() => setMediaAdapterConfigurationKey(key)} type="button">配置</Button>}</div></div>; })}</div></fieldset>
    {mediaAdapterConfigurationKey ? <div aria-label={`配置${mediaConfigurationLabel(mediaAdapterConfigurationKey)}`} aria-modal="true" className="stage-configuration-dialog media-adapter-dialog" ref={mediaAdapterDialogRef} role="dialog"><section><header><div><h3>配置{mediaConfigurationLabel(mediaAdapterConfigurationKey)}</h3></div><Button size="sm" color="tertiary" aria-label={`关闭${mediaConfigurationLabel(mediaAdapterConfigurationKey)}配置`} className="icon-button" onClick={() => setMediaAdapterConfigurationKey(null)} type="button"><XClose aria-hidden="true" width={20} height={20}/></Button></header><MediaAdapterCard adapterKey={mediaAdapterConfigurationKey} connectionVersions={connectionVersions} externalConnections={externalConnections} form={form.mediaAdapters[mediaAdapterConfigurationKey]} localAdapterReadiness={localAdapterReadiness} onChange={(field, value) => updateMediaAdapter(mediaAdapterConfigurationKey, field, value)} onCreateConnection={onCreateConnection} onRotateConnection={onRotateConnection} onTestConnection={onTestConnection} onUpdateConnection={onUpdateConnection} readOnly={readOnly} /><footer><Button size="sm" color="primary" className="button button-primary" onClick={() => setMediaAdapterConfigurationKey(null)} type="button">完成</Button></footer></section></div> : null}
    {accountLayout ? null : <fieldset id="account-budget"><legend>分镜规划</legend><section className="stage-configuration-summary">{visibleExecutorKeys.map((executorKey) => { const executor = form.executors[executorKey]; return <article key={executorKey}><div className="stage-configuration-summary-title"><strong>{executorLabels[executorKey]}</strong><span>创建时冻结</span></div><dl><div><dt>运行模型</dt><dd>{executor.provider} · {executor.model}</dd></div><div><dt>提示词 Harness</dt><dd>{executor.promptVersion || "未配置 Prompt"}</dd></div></dl>{readOnly ? null : <Button size="xs" color="secondary" aria-label="修改分镜规划配置" className="button button-secondary button-small" onClick={() => setStoryboardConfigurationOpen(true)} type="button">配置</Button>}</article>; })}</section></fieldset>}
    {accountLayout && !technicalOnly ? <fieldset id="account-approvals"><legend><FieldLabel help={<div><p>开启后，对应阶段暂停并等待人工审核。</p>{approvalGateOptions.map(([value, label]) => <p key={value}>{label}：{approvalGateHelp[value]}</p>)}</div>}>审核设置</FieldLabel></legend><div className="configuration-switch-list approval-gate-switches">{approvalGateOptions.map(([value, label]) => <ConfigurationSwitch checked={form.approvalGates.includes(value)} disabled={readOnly} key={value} label={label} onChange={(checked) => update({ approvalGates: checked ? [...form.approvalGates, value] : form.approvalGates.filter((item) => item !== value) })} />)}</div></fieldset> : null}
    {storyboardConfigurationOpen ? <StageConfigurationDialog executor={form.executors.storyboard_planning} executorKey="storyboard_planning" onClose={() => setStoryboardConfigurationOpen(false)} onManagePromptVersions={() => { setStoryboardConfigurationOpen(false); setPromptVersionManagerOpen(true); }} onSelectPromptVersion={(version) => selectPromptVersion("storyboard_planning", version)} onUpdateExecutor={(field, value) => updateExecutor("storyboard_planning", field, value)} promptVersions={promptVersions} readOnly={readOnly} /> : null}
    {promptVersionManagerOpen ? <PromptVersionManager fixedCapability="storyboard_planning" isPending={isPending} onClose={() => { setPromptVersionManagerOpen(false); setStoryboardConfigurationOpen(true); }} onCreate={onCreatePromptVersion} onSelect={(version) => selectPromptVersion("storyboard_planning", version)} promptVersions={promptVersions} selectedVersionId={form.executors.storyboard_planning.harnessId} /> : null}
    {readOnly ? <ReadOnlyAdvancedRules source={form.advancedJson} /> : null}
    {error && !saveConfirmationOpen ? <p className="form-error" role="alert">{error}</p> : null}
    {technicalOnly ? <BlueprintPolicyPreview form={form} /> : null}
    {readOnly ? null : <div className={accountLayout ? "account-blueprint-footer" : undefined}>{footerStatus}<div className="configuration-actions">{saveState}<Button size="sm" color="secondary" className="button button-secondary" isDisabled={isPending} onClick={reset} type="button">{technicalOnly ? "取消技术配置" : accountLayout ? "撤销修改" : "取消编辑"}</Button><Button size="sm" color="primary" className="button button-primary" isDisabled={isPending} onClick={requestSubmit} type="button">{isPending ? "保存中…" : technicalOnly ? "保存技术配置" : "保存并检查"}</Button></div></div>}
    {saveConfirmationOpen ? <ConfirmationModal confirmLabel={technicalOnly ? "确认保存技术配置" : "确认保存并检查"} isPending={isPending} onCancel={() => setSaveConfirmationOpen(false)} onConfirm={confirmSubmit} pendingLabel="保存中…" title={technicalOnly ? "确认保存技术配置" : "确认保存蓝图"}>{error ? <p className="form-error" role="alert">{error}</p> : null}<section aria-label="本次保存影响" className="configuration-impact"><p>{technicalOnly ? "之后新建的生产单会使用更新后的技术配置；已有生产单继续使用冻结配置。保存后只校验已开启的能力。" : `之后新建的生产单会使用当前账号定位、已开启的 ${enabledMediaAdapters.length} 项媒体能力和分镜配置；已有生产单与系列规则保持不变。保存后只校验已开启的能力。`}</p></section></ConfirmationModal> : null}
  </section>;
}

export function EpisodeConfigurationRepairForm({ blocker, initialPolicy, isPending, onCancel, onSave, promptVersions = [] }: { blocker: Pick<WorkerBlocker, "action" | "capability" | "code" | "detail" | "taskType">; initialPolicy: Json; isPending: boolean; onCancel: () => void; onSave: (policy: Json) => Promise<void>; promptVersions?: PromptVersion[] }) {
  const repairTarget = repairTargetForBlocker(blocker);
  const adapterKey = repairTarget?.kind === "media" ? repairTarget.key : null;
  const executorKey = repairTarget?.kind === "executor" ? repairTarget.key : null;
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

  if (!adapterKey && !executorKey) return <section className="configuration-form"><p className="form-error">当前阻塞项不能通过配置修复，请按阻塞卡片提示处理。</p><Button size="sm" color="secondary" className="button button-secondary" onClick={onCancel} type="button">返回生产单</Button></section>;
  return <form className="configuration-form blueprint-configuration-form" onSubmit={(event) => void submit(event)}>
    <header><h2>修复当前生产单的 {adapterKey ? mediaAdapterConfiguration(adapterKey).label : executorLabels[executorKey!]}</h2><p className="blueprint-editor-note">只修改这类受阻任务的冻结配置。不会创建或修改账号蓝图，也不会影响之后的新生产单。</p></header>
    {adapterKey ? <fieldset><legend>需要补齐的媒体配置</legend><MediaAdapterCard adapterKey={adapterKey} form={form.mediaAdapters[adapterKey]} onChange={updateMediaAdapter} /></fieldset> : <fieldset><legend>需要补齐的执行器配置</legend><label><FieldLabel help="执行服务名称。">Provider</FieldLabel><InputBase size="sm" aria-label="Provider" isDisabled={executorKey === "storyboard_planning"} onChange={(event) => updateExecutor("provider", event.target.value)} value={form.executors[executorKey!].provider} /></label>{executorKey === "storyboard_planning" ? <label><FieldLabel help="当前生产单会冻结所选 Harness 的内容。">Prompt Harness</FieldLabel><NativeSelect size="sm" aria-label="Prompt Harness" onChange={(event) => selectPlanningHarness(event.target.value)} value={planningHarnesses.some((version) => version.id === form.executors[executorKey].harnessId) ? form.executors[executorKey].harnessId : ""}><option value="">选择 Harness</option>{planningHarnesses.map((version) => <option key={version.id} value={version.id}>{version.name} · {version.slug}</option>)}</NativeSelect></label> : <label><FieldLabel help="当前任务使用的可追溯 Prompt 版本。">Prompt 版本</FieldLabel><InputBase size="sm" aria-label="Prompt 版本" onChange={(event) => updateExecutor("promptVersion", event.target.value)} value={form.executors[executorKey!].promptVersion} /></label>}<label><FieldLabel help="当前任务使用的模型名称。">模型</FieldLabel><InputBase size="sm" aria-label="模型" onChange={(event) => updateExecutor("model", event.target.value)} value={form.executors[executorKey!].model} /></label></fieldset>}
    {error ? <p className="form-error">{error}</p> : null}
    <div className="configuration-actions"><Button size="sm" color="secondary" className="button button-secondary" isDisabled={isPending} onClick={onCancel} type="button">取消</Button><Button size="sm" color="primary" className="button button-primary" isDisabled={isPending} type="submit">{isPending ? "应用中…" : "保存并继续当前生产单"}</Button></div>
  </form>;
}

export function SeriesConfigurationForm({ currentVersion = 0, initialName, initialRules, isEditing, isPending, onCancel, onDirtyChange, onSave }: { currentVersion?: number; initialName: string; initialRules: Json; isEditing: boolean; isPending: boolean; onCancel: () => void; onDirtyChange?: (dirty: boolean) => void; onSave: (name: string, rules: Json) => Promise<void> }) {
  const [name, setName] = useState(initialName);
  const [form, setForm] = useState<SeriesFormValues>(() => seriesRulesToForm(initialRules));
  const [error, setError] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saveConfirmationOpen, setSaveConfirmationOpen] = useState(false);
  useEffect(() => { setName(initialName); setForm(seriesRulesToForm(initialRules)); setSaveConfirmationOpen(false); setDirty(false); onDirtyChange?.(false); }, [initialName, initialRules, onDirtyChange]);

  function requestSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      setError("");
      if (!name.trim()) throw new Error("请填写系列名称。");
      const rules = seriesFormToRules(form);
      validateSeriesRules(rules);
      setSaveConfirmationOpen(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "系列规则无法保存。");
    }
  }

  async function confirmSubmit() {
    try {
      setError("");
      const rules = seriesFormToRules(form);
      await onSave(name.trim(), rules);
      setDirty(false);
      onDirtyChange?.(false);
      setSaveConfirmationOpen(false);
      if (!isEditing) { setName(""); setForm(seriesRulesToForm({})); }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "系列规则无法保存。");
    }
  }

  function reset() {
    setName(initialName);
    setForm(seriesRulesToForm(initialRules));
    setError("");
    setDirty(false);
    onDirtyChange?.(false);
    onCancel();
  }

  return <form className="configuration-form series-configuration-form" onChangeCapture={() => {setDirty(true); onDirtyChange?.(true);}} onSubmit={requestSubmit}>
    <header><h2>{isEditing ? <>{initialName}<span className="series-current-version"> · 当前 v{currentVersion}</span></> : "新建系列"}</h2></header>
    {!isEditing ? <div className="series-name-field"><label><FieldLabel help="创建后名称固定；后续通过新版本更新规则。">系列名称</FieldLabel><InputBase size="sm" aria-label="系列名称" onChange={(event) => setName(event.target.value)} placeholder="例如：城市观察短片" isRequired value={name} /></label></div> : null}
    <fieldset><legend><FieldLabel help="系列的固定受众、主题和制作格式。">内容方向</FieldLabel></legend>
      <label><FieldLabel>系列定位</FieldLabel><TextAreaBase size="sm" aria-label="系列定位" onChange={(event) => setForm((current) => ({ ...current, positioning: event.target.value }))} placeholder="受众、主题与内容方向" rows={2} value={form.positioning} /></label>
      <label><FieldLabel>内容格式</FieldLabel><InputBase size="sm" aria-label="内容格式" onChange={(event) => setForm((current) => ({ ...current, format: event.target.value }))} placeholder="例如：9:16 竖屏，中文旁白" value={form.format} /></label>
    </fieldset>
    <fieldset><legend>创作设定</legend><div className="series-baseline-grid">{([
      ['characters', '角色设定', '固定角色、身份与关系'],
      ['locations', '地点设定', '地点、环境与时代背景'],
      ['visualStyle', '视觉风格', '画面质感、色彩与镜头语言'],
      ['narrativeStructure', '叙事结构', '开场、展开与结尾'],
    ] as const).map(([key, label, placeholder]) => <label key={key}><FieldLabel>{label}</FieldLabel><TextAreaBase size="sm" aria-label={label} onChange={(event) => setForm((current) => ({...current, [key]: event.target.value}))} placeholder={placeholder} rows={3} value={form[key]} /></label>)}</div></fieldset>
    <fieldset><legend>限制与禁用内容</legend><label><TextAreaBase size="sm" aria-label="限制与禁用内容" onChange={(event) => setForm((current) => ({ ...current, restrictions: event.target.value }))} placeholder="不能出现的事实、表达、人物、素材或画面" rows={2} value={form.restrictions} /></label></fieldset>
    {error && !saveConfirmationOpen ? <p className="form-error" role="alert">{error}</p> : null}
    <footer className="series-form-footer"><span className={`account-save-state${dirty ? " is-dirty" : ""}`} role="status">{isPending ? "保存中…" : dirty ? "有未保存更改" : isEditing ? "已保存" : "未创建"}</span><div className="configuration-actions"><Button size="sm" color="secondary" className="button button-secondary" isDisabled={isPending} onClick={reset} type="button">{isEditing ? "撤销修改" : "取消"}</Button><Button size="sm" color="primary" className="button button-primary" isDisabled={isPending} type="submit">{isPending ? "保存中…" : isEditing ? `保存为 v${currentVersion + 1}` : "创建系列"}</Button></div></footer>
    {saveConfirmationOpen ? <ConfirmationModal confirmLabel={isEditing ? `确认保存为 v${currentVersion + 1}` : "确认创建系列"} isPending={isPending} onCancel={() => setSaveConfirmationOpen(false)} onConfirm={confirmSubmit} pendingLabel="保存中…" title={isEditing ? "确认保存系列版本" : "确认创建系列"}>{error ? <p className="form-error" role="alert">{error}</p> : null}<section aria-label="本次保存影响" className="configuration-impact"><p>{isEditing ? `创建系列 v${currentVersion + 1}，供之后新建生产单选择；已有生产单继续使用冻结版本。` : "创建系列 v1，之后可在新建生产单时选择；不会改动已有生产单。"}</p></section></ConfirmationModal> : null}
  </form>;
}
