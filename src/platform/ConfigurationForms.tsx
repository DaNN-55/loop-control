import {resolveCreativeRules,hasCreativeRuleValue} from '../creativeAccountRules';
import {XClose} from '@untitledui/icons';
import {CreativeRuleFields} from './CreativeRuleFields';
import {Disclosure} from '../ui/dan-ui/components/base/disclosure/disclosure';
import {TextAreaBase} from '../ui/dan-ui/components/base/textarea/textarea';
import {InputBase} from '../ui/dan-ui/components/base/input/input';
import {NativeSelect} from '../ui/dan-ui/components/base/select/select-native';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import {videoProviders,isVideoProvider} from "../worker/videoProviderCatalog";
import { useEffect, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import type { Database, Json } from "../lib/database.types";
import { HelpTip } from "../ui/HelpTip";
import {ConfirmationModal,ConfirmationModalPresence} from "../ui/ConfirmationModal";
import { useDialogFocus } from "../ui/useDialogFocus";
import type { LocalSystemStatusReport } from "../observability/SystemStatusPanel";
import { registeredAdapters, type LocalAdapterReadiness } from "../worker/registeredAdapters";
import { ExternalConnectionPicker, type ExternalConnectionInput, type ExternalConnectionVersion } from "../connections/ConnectionWorkspace";
import { repairTargetForBlocker } from "../reviews/repairTarget";
import type { WorkerBlocker } from "../reviews/reviewSelectors";
import {
  blueprintFormToPolicy,
  legacyBlueprintFormToPolicy,
  blueprintPolicyToForm,
  configurableMediaAdapterKeys,
  mediaAdapterConfiguration,
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

const executorLabels = {
  script_writing: "脚本生成",
  visual_planning: "视觉规划",
  storyboard_planning: "分镜规划",
} as const;
const promptCapabilityOptions: Array<[PromptCapability, string]> = [
  ["storyboard_planning", "分镜规划"],
];
function FieldLabel({ children, help }: { children: ReactNode; help?: ReactNode }) {
  return <span className="field-label">{children}{help ? <HelpTip label={typeof children === "string" ? children : "字段"}>{help}</HelpTip> : null}</span>;
}

export function PromptVersionManager({ fixedCapability, isPending, onClose, onCreate, onSelect, promptVersions, selectedVersionId }: { fixedCapability?: PromptCapability; isPending: boolean; onClose: () => void; onCreate?: (input: { capability: PromptCapability; name: string; summary: string; instructions: string }) => Promise<PromptVersion | null>; onSelect: (version: PromptVersion) => void; promptVersions: PromptVersion[]; selectedVersionId?: string }) {
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

export function StageConfigurationDialog({ executor, executorKey, inline = false, hideFixedIdentity = false, onClose, onManagePromptVersions, onSelectPromptVersion, onUpdateExecutor, promptVersions, readOnly }: { executor: BlueprintFormValues["executors"]["script_writing"]; executorKey: keyof BlueprintFormValues["executors"]; inline?: boolean; hideFixedIdentity?: boolean; onClose: () => void; onManagePromptVersions?: () => void; onSelectPromptVersion: (version: PromptVersion) => void; onUpdateExecutor: (field: keyof BlueprintFormValues["executors"]["script_writing"], value: string) => void; promptVersions: PromptVersion[]; readOnly: boolean }) {
  const label = executorLabels[executorKey];
  const usesPromptHarness = executorKey === "storyboard_planning";
  const manageInMenu = inline && hideFixedIdentity && usesPromptHarness && !readOnly && Boolean(onManagePromptVersions);
  const versions = promptVersions.filter((version) => version.capability === executorKey && version.is_active);
  const selectedValue = usesPromptHarness ? executor.harnessId : executor.promptVersion;
  const hasSelectedVersion = versions.some((version) => usesPromptHarness ? version.id === executor.harnessId : version.slug === executor.promptVersion);
  const dialogRef = useDialogFocus(!inline, onClose);
  return <div aria-label={inline ? undefined : `${label}配置`} aria-modal={inline ? undefined : "true"} className={`stage-configuration-dialog${inline ? " is-inline" : ""}`} ref={dialogRef} role={inline ? undefined : "dialog"}><section>{inline ? null : <header><div><h3>{label}</h3></div><Button size="sm" color="tertiary" aria-label={`关闭${label}配置`} className="icon-button" onClick={onClose} type="button"><XClose aria-hidden="true" width={20} height={20}/></Button></header>}<div className="stage-configuration-fields">{inline && usesPromptHarness && hideFixedIdentity ? null : <><label><FieldLabel help={usesPromptHarness ? `${label}固定使用已注册的 Codex Adapter。` : "执行服务，例如 codex。"}>Provider</FieldLabel><InputBase size="sm" aria-label={`${label} Provider`} isDisabled={readOnly || usesPromptHarness} onChange={(event) => onUpdateExecutor("provider", event.target.value)} value={executor.provider} /></label>{usesPromptHarness ? <label><FieldLabel help="Adapter、Harness 与模型会一同冻结到 Worker 任务中。">Adapter</FieldLabel><InputBase size="sm" aria-label={`${label} Adapter`} readOnly value="codex" /></label> : null}</>}<label><FieldLabel help="执行时使用的模型名称。">模型</FieldLabel><InputBase size="sm" aria-label={`${label} 模型`} isDisabled={readOnly} onChange={(event) => onUpdateExecutor("model", event.target.value)} value={executor.model} /></label><label><FieldLabel help={usesPromptHarness ? "所选 Harness 会作为分镜生成 Prompt 的执行上下文，并在提交规划任务时冻结；以后切换版本不会改动已提交任务。" : "从已登记版本中选择执行规则。"}>{usesPromptHarness ? "Prompt Harness" : "Prompt 版本"}</FieldLabel>{usesPromptHarness || versions.length ? <NativeSelect size="sm" aria-label={`${label} ${usesPromptHarness ? "Prompt Harness" : "Prompt 版本"}`} disabled={readOnly} popupAction={manageInMenu && onManagePromptVersions ? { label: "管理版本", onPress: onManagePromptVersions } : undefined} onChange={(event) => { const version = versions.find((candidate) => (usesPromptHarness ? candidate.id : candidate.slug) === event.target.value); if (version) onSelectPromptVersion(version); }} value={hasSelectedVersion ? selectedValue : "__unregistered__"}>{!hasSelectedVersion ? <option value="__unregistered__">{executor.promptVersion || "当前值"}（未登记）</option> : null}{versions.map((version) => <option key={version.id} value={usesPromptHarness ? version.id : version.slug}>{version.name} · {version.slug}</option>)}</NativeSelect> : <InputBase size="sm" aria-label={`${label} Prompt 版本`} isDisabled={readOnly} onChange={(event) => onUpdateExecutor("promptVersion", event.target.value)} value={executor.promptVersion} />}</label></div>{usesPromptHarness && !manageInMenu && !readOnly && onManagePromptVersions ? <Button size="sm" color="tertiary" aria-label="管理 Prompt 版本" className="stage-configuration-manager-action" onClick={onManagePromptVersions} type="button">管理版本</Button> : null}{inline ? null : <footer><Button size="sm" color="primary" className="button button-primary" onClick={onClose} type="button">完成</Button></footer>}</section></div>;
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

function externalConnectionProviderLabel(provider:string):string {
 if(isVideoProvider(provider))return videoProviders[provider].label;
 return ({openai:'OpenAI Images',volcengine_tts:'火山语音',pexels:'Pexels',freesound:'Freesound'} as Record<string,string>)[provider]??provider;
}

export function BlueprintConfigurationForm({ accountLayout = false, footerStatus, saveState, initialPolicy, isPending, onCancel, onDirtyChange, onSave, readOnly = false }: { accountId?: string; accountLayout?: boolean; footerStatus?: ReactNode; saveState?: ReactNode; connectionVersions?: ExternalConnectionVersion[]; externalConnections?: ExternalConnection[]; initialAssetRoot: string; initialPolicy: Json; isEpisodeRepair?: boolean; isPending: boolean; localAdapterReadiness?: LocalAdapterReadiness; onCancel: () => void; onCreateConnection?: (input: ExternalConnectionInput) => Promise<ExternalConnection | null>; onCreatePromptVersion?: (input: { capability: PromptCapability; name: string; summary: string; instructions: string }) => Promise<PromptVersion | null>; onDirtyChange?: (dirty: boolean) => void; onRotateConnection?: (input: { connectionId: string; provider: ExternalConnectionInput["provider"]; adapter: ExternalConnectionInput["adapter"]; secret: string }) => Promise<ExternalConnection | null>; onSave: (policy: Json, activate: boolean) => Promise<void>; onTestConnection?: (connectionId: string) => Promise<unknown>; onUpdateConnection?: (input: { connectionId: string; name: string; description: string }) => Promise<void>; promptVersions?: PromptVersion[]; readOnly?: boolean; systemStatus?: LocalSystemStatusReport | null; technicalOnly?: boolean }) {
 const [form,setForm]=useState(()=>blueprintPolicyToForm(initialPolicy));
 const [savedForm,setSavedForm]=useState(()=>blueprintPolicyToForm(initialPolicy));
 const [editing,setEditing]=useState(!accountLayout),[saving,setSaving]=useState(false);
 const [error,setError]=useState(''),[confirming,setConfirming]=useState(false);
 const initialPolicySource = JSON.stringify(initialPolicy);
 useEffect(()=>{const next=blueprintPolicyToForm(initialPolicy);setForm(next);setSavedForm(next);setEditing(!accountLayout);setConfirming(false);onDirtyChange?.(false);},[initialPolicySource,onDirtyChange,accountLayout]);
 const locked=accountLayout&&!editing,busy=isPending||saving,fieldsReadOnly=readOnly||locked;
 const dirty=JSON.stringify(form)!==JSON.stringify(savedForm);
 function reset(){if(busy||accountLayout&&dirty&&!window.confirm("放弃通用规则的未保存修改？"))return;setForm(savedForm);setError('');setEditing(!accountLayout);onDirtyChange?.(false);onCancel();}
 async function save(){if(busy||readOnly||locked)return;setSaving(true);try{setError('');await onSave(blueprintFormToPolicy(form),true);setSavedForm(form);setConfirming(false);setEditing(!accountLayout);onDirtyChange?.(false);}catch(cause){setError(cause instanceof Error?cause.message:'蓝图规则无法保存。');}finally{setSaving(false);}}
 return <section className={`configuration-form blueprint-configuration-form${accountLayout?' account-blueprint-form':''}${locked?' is-locked':''}`}>
  <fieldset id="account-positioning" aria-label={accountLayout ? "账号定位设置" : undefined}>{!accountLayout && <legend>账号定位</legend>}<label><FieldLabel>账号定位</FieldLabel><TextAreaBase size="sm" aria-label="账号定位" rows={2} disabled={busy} readOnly={fieldsReadOnly} value={form.positioning} onChange={event=>{setForm(current=>({...current,positioning:event.target.value}));onDirtyChange?.(true);}} /></label></fieldset>
  <fieldset><legend>创作规则</legend><CreativeRuleFields source={form.advancedJson} readOnly={fieldsReadOnly} isDisabled={busy} showDefaults onChange={advancedJson=>{setForm(current=>({...current,advancedJson}));onDirtyChange?.(true);}}/></fieldset>
  {error&&!confirming?<p role="alert" className="form-error">{error}</p>:null}
  {!readOnly?<div className={accountLayout?'account-blueprint-footer':undefined}>{footerStatus}<div className="configuration-actions">{locked?<><Button size="sm" color="secondary" isDisabled={busy} onPress={()=>setEditing(true)}>修改</Button></>:<>{saveState}<Button size="sm" color="secondary" isDisabled={busy} onPress={reset}>{accountLayout?(dirty?"放弃修改":"取消编辑"):"撤销修改"}</Button><Button size="sm" color="primary" isDisabled={busy} onPress={()=>{try{blueprintFormToPolicy(form);setError('');setConfirming(true);}catch(cause){setError(cause instanceof Error?cause.message:'创作规则无效。');}}}>{busy?'保存中…':accountLayout?'保存通用规则':'保存蓝图'}</Button></>}</div></div>:null}
  <ConfirmationModalPresence>{confirming?<ConfirmationModal title={accountLayout ? "确认保存通用规则" : "确认保存蓝图"} confirmLabel={accountLayout ? "确认保存通用规则" : "确认保存蓝图"} isPending={busy} onCancel={()=>setConfirming(false)} onConfirm={save}><p>创作规则应用于之后新建的生产单；已有生产单保留原规则。</p>{error?<p role="alert" className="form-error">{error}</p>:null}</ConfirmationModal>:null}</ConfirmationModalPresence>
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
        await onSave(legacyBlueprintFormToPolicy({ ...form, enabledMediaAdapters, mediaAdapters: { ...form.mediaAdapters, [adapterKey]: repairForm } }));
        return;
      }
      if (executorKey) {
        const executor = form.executors[executorKey];
        if (!executor.provider.trim() || !executor.model.trim() || !executor.promptVersion.trim()) throw new Error("执行器的 Provider、模型和 Prompt 版本不能为空。");
        if (executorKey === "storyboard_planning" && !planningHarnesses.some((version) => version.id === executor.harnessId)) throw new Error("分镜规划必须选择已登记且启用的 Prompt Harness。");
      } else throw new Error("当前阻塞项无法映射到可修复的配置。");
      await onSave(legacyBlueprintFormToPolicy(form));
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

export function SeriesConfigurationForm({ headingContent, onCreateEpisode, onRename, accountPolicy, currentVersion = 0, initialName, initialRules, isEditing, isPending, onCancel, onDirtyChange, onSave }: { headingContent?: ReactNode; onCreateEpisode?: () => void; onRename?: (name: string) => Promise<boolean | void>; accountPolicy?: Json; currentVersion?: number; initialName: string; initialRules: Json; isEditing: boolean; isPending: boolean; onCancel: () => void; onDirtyChange?: (dirty: boolean) => void; onSave: (name: string, rules: Json) => Promise<void> }) {
  const [name, setName] = useState(initialName);
  const [form, setForm] = useState<SeriesFormValues>(() => seriesRulesToForm(initialRules));
  const [savedName, setSavedName] = useState(initialName);
  const [savedForm, setSavedForm] = useState<SeriesFormValues>(() => seriesRulesToForm(initialRules));
  const [editing, setEditing] = useState(!isEditing);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const locked = isEditing && !editing;
  const busy = isPending || saving;
  const [error, setError] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saveConfirmationOpen, setSaveConfirmationOpen] = useState(false);
  const initialRulesKey=JSON.stringify(initialRules);
  useEffect(() => { setName(initialName); setSavedName(initialName); setForm(seriesRulesToForm(initialRules)); setSavedForm(seriesRulesToForm(initialRules)); setEditing(!isEditing); setSaveConfirmationOpen(false); setDirty(false); onDirtyChange?.(false); }, [initialRulesKey, onDirtyChange]);

  function requestSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || locked) return;
    try {
      setError("");
      if (!name.trim()) throw new Error("请填写系列名称。");
      const rules = seriesFormToRules(form);
      validateSeriesRules(rules);
      if (isEditing) setSaveConfirmationOpen(true);
      else void confirmSubmit();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "系列规则无法保存。");
    }
  }

  async function confirmSubmit() {
    if (busy || locked || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    let nameSaved = false;
    try {
      setError("");
      const rules = seriesFormToRules(form);
      if (isEditing && onRename && name.trim() !== savedName) {
        if (await onRename(name.trim()) === false) throw new Error("系列名称未保存，请重试。");
        setSavedName(name.trim());
        nameSaved = true;
      }
      await onSave(name.trim(), rules);
      setSavedForm(form);
      setSavedName(name.trim());
      setName(name.trim());
      setEditing(!isEditing);
      setDirty(false);
      onDirtyChange?.(false);
      setSaveConfirmationOpen(false);
      if (!isEditing) { setName(""); setForm(seriesRulesToForm({})); }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "系列规则无法保存。";
      setError(nameSaved ? `名称已保存，规则未应用：${message}` : message);
    } finally { savingRef.current = false; setSaving(false); }
  }

  function reset() {
    if (busy) return;
    setName(savedName);
    setForm(savedForm);
    setEditing(!isEditing);
    setError("");
    setDirty(false);
    onDirtyChange?.(false);
    onCancel();
  }

  const accountDefaults = seriesRulesToForm(accountPolicy ?? {});
  const inheritedPlaceholder = (key: keyof SeriesFormValues) => accountPolicy === undefined ? undefined : accountDefaults[key] || "沿用账号通用规则";
  const accountRules = accountPolicy && typeof accountPolicy === 'object' && !Array.isArray(accountPolicy) ? accountPolicy : {};
  const resolvedRules = resolveCreativeRules(accountRules, seriesFormToRules(form));
  const seriesValues = seriesRulesToForm(resolvedRules.series as Json);
  const accountRestrictions = hasCreativeRuleValue(resolvedRules.account.restrictions) ? accountDefaults.restrictions : '';
  const seriesRestrictions = hasCreativeRuleValue(resolvedRules.series?.restrictions) ? seriesValues.restrictions : '';
  const restrictionValues = [
    accountRestrictions && `账号通用规则\n${accountRestrictions}`,
    seriesRestrictions && `系列规则\n${seriesRestrictions}`,
  ].filter(Boolean).join('\n\n');
  const ruleSource = (key: 'positioning' | 'visualStyle') => {
    if (seriesValues[key]) return '来自系列规则';
    const field = key === 'positioning' ? 'positioning' : 'visual_style';
    return hasCreativeRuleValue(resolvedRules.account[field]) ? '沿用账号通用规则' : '未设置';
  };
  const savedValue = (key: keyof SeriesFormValues) => {
    if (key === 'positioning' || key === 'visualStyle') {
      const source = ruleSource(key);
      return source === '未设置' ? source : seriesValues[key] || accountDefaults[key];
    }
    return form[key] || accountDefaults[key] || "未设置";
  };
  const creativeRuleFields = (
    <fieldset><legend>创作规则</legend><p className="series-inheritance-note">定位和视觉风格优先使用系列值，留空时沿用账号通用规则。两处填写的限制同时生效。</p>
      <label><FieldLabel>系列定位<small className="series-rule-source">{ruleSource('positioning')}</small></FieldLabel><TextAreaBase readOnly={locked} disabled={busy} size="sm" aria-label="系列定位" onChange={(event) => setForm((current) => ({ ...current, positioning: event.target.value }))} placeholder={locked?undefined:inheritedPlaceholder("positioning") ?? "受众、主题与内容方向"} rows={2} value={locked ? savedValue("positioning") : form.positioning} /></label>
      <label><FieldLabel>内容格式{locked&&<small className="series-rule-source">{form.format?'来自系列规则':accountDefaults.format?'来自账号通用规则':'未设置'}</small>}</FieldLabel><InputBase readOnly={locked} isDisabled={busy} size="sm" aria-label="内容格式" onChange={(event) => setForm((current) => ({ ...current, format: event.target.value }))} placeholder={locked?undefined:inheritedPlaceholder("format") ?? "例如：9:16 竖屏，中文旁白"} value={locked ? savedValue("format") : form.format} /></label>
    <div className="series-baseline-grid">{([
      ['characters', '角色设定', '固定角色、身份与关系'],
      ['locations', '地点设定', '地点、环境与时代背景'],
      ['visualStyle', '视觉风格', '画面质感、色彩与镜头语言'],
      ['narrativeStructure', '叙事结构', '开场、展开与结尾'],
    ] as const).map(([key, label, placeholder]) => <label key={key}><FieldLabel>{label}{key==='visualStyle'?<small className="series-rule-source">{ruleSource(key)}</small>:locked&&<small className="series-rule-source">{form[key]?'来自系列规则':accountDefaults[key]?'来自账号通用规则':'未设置'}</small>}</FieldLabel><TextAreaBase readOnly={locked} disabled={busy} size="sm" aria-label={label} onChange={(event) => setForm((current) => ({...current, [key]: event.target.value}))} placeholder={locked?undefined:inheritedPlaceholder(key) ?? placeholder} rows={2} value={locked ? savedValue(key) : form[key]} /></label>)}</div>
    <label><FieldLabel>限制与禁用内容</FieldLabel><TextAreaBase readOnly={locked} disabled={busy} size="sm" aria-label="限制与禁用内容" onChange={(event) => setForm((current) => ({ ...current, restrictions: event.target.value }))} placeholder="不能出现的事实、表达、人物、素材或画面" rows={locked&&accountRestrictions&&seriesRestrictions?5:2} value={locked ? restrictionValues || "未设置" : form.restrictions} />{!locked&&accountRestrictions&&<small className="field-hint series-account-restriction">同时生效的账号限制 · {accountRestrictions}</small>}</label>
    </fieldset>
  );
  return <><header className="account-editor-heading"><h2>{isEditing ? savedName : "新建系列"}</h2>{isEditing ? <div className="series-header-actions"><span className="account-save-state" role="status">已应用 · v{currentVersion}</span>{locked && onCreateEpisode && <Button size="sm" color="primary" type="button" isDisabled={busy} onClick={onCreateEpisode}>新建生产单</Button>}</div> : null}</header><form className={`configuration-form series-configuration-form${locked ? " is-locked" : ""}`} onChangeCapture={() => {if (!locked && !busy) {setDirty(true); onDirtyChange?.(true);}}} onSubmit={requestSubmit}>
    <fieldset><legend>系列资料</legend><label><FieldLabel>{isEditing ? "系列显示名称" : "系列名称"}</FieldLabel><InputBase size="sm" aria-label={isEditing ? "系列显示名称" : "系列名称"} readOnly={locked || (isEditing && !onRename)} isDisabled={busy} onChange={(event) => setName(event.target.value)} placeholder="例如：城市观察短片" isRequired value={name} /></label>{headingContent}</fieldset>
    {isEditing ? creativeRuleFields : <Disclosure className="series-creation-rules" label="创作规则（选填）">{creativeRuleFields}</Disclosure>}
    {error && !saveConfirmationOpen ? <p className="form-error" role="alert">{error}</p> : null}
    <footer className="series-form-footer">{!locked ? <span className={`account-save-state${dirty ? " is-dirty" : ""}`} role="status">{busy ? "保存中…" : dirty ? "有未应用更改" : isEditing ? "修改中" : "未创建"}</span> : null}<div className="configuration-actions">{locked ? <Button size="sm" color="secondary" className="button button-secondary" onClick={() => setEditing(true)} type="button">修改</Button> : <><Button size="sm" color="secondary" className="button button-secondary" isDisabled={busy} onClick={()=>{if(!dirty||window.confirm(isEditing?"放弃当前系列的未保存修改？":"放弃新建系列的草稿？"))reset();}} type="button">{isEditing ? dirty?"放弃修改":"取消编辑" : "取消"}</Button><Button size="sm" color="primary" className="button button-primary" isDisabled={busy} type="submit">{busy ? "保存中…" : isEditing ? "保存系列设置" : "创建系列"}</Button></>}</div></footer>
    <ConfirmationModalPresence>{saveConfirmationOpen ? <ConfirmationModal confirmLabel={isEditing ? `确认保存为 v${currentVersion + 1}` : "确认创建系列"} isPending={busy} onCancel={() => setSaveConfirmationOpen(false)} onConfirm={confirmSubmit} pendingLabel="保存中…" title={isEditing ? "确认保存系列版本" : "确认创建系列"}>{error ? <p className="form-error" role="alert">{error}</p> : null}<section aria-label="本次保存影响" className="configuration-impact"><p>{isEditing ? `创建系列 v${currentVersion + 1}，供之后新建生产单选择；已有生产单继续使用冻结版本。` : "创建系列 v1，之后可在新建生产单时选择；不会改动已有生产单。"}</p></section></ConfirmationModal> : null}</ConfirmationModalPresence>
  </form></>;
}
