import { useEffect, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import type { Database, Json } from "../lib/database.types";
import { HelpTip } from "../ui/HelpTip";
import {
  blueprintFormToPolicy,
  blueprintPolicyToForm,
  seriesFormToRules,
  seriesRulesToForm,
  mediaAdapterKeys,
  mediaAdapterStatus,
  validateMediaAdapter,
  validateMediaAdapters,
  validateSeriesRules,
  type BlueprintFormValues,
  type MediaAdapterForm,
  type MediaAdapterKey,
  type SeriesFormValues,
} from "./configurationFormValues";

type PromptVersion = Database["public"]["Tables"]["prompt_versions"]["Row"];
type PromptCapability = PromptVersion["capability"];

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
  ["network", "访问网络供应商"],
] as const;
const executorLabels = {
  script_writing: "脚本生成",
  visual_planning: "视觉规划",
  storyboard_planning: "分镜规划",
} as const;
const promptCapabilityOptions: Array<[PromptCapability, string]> = [
  ["script_writing", "脚本生成"],
  ["visual_planning", "视觉规划"],
  ["storyboard_planning", "分镜规划"],
];
const mediaAdapterLabels: Record<MediaAdapterKey, string> = { a_roll: "A-roll", b_roll: "B-roll", narration: "旁白", soundtrack: "配乐 / 音效" };
const mediaAdapterDescriptions: Record<MediaAdapterKey, string> = {
  a_roll: "生成需要实际出镜或演示的视频镜头。当前 Worker 只接受 codex A-roll 适配器。",
  b_roll: "按分镜检索或生成补充画面。当前 Worker 仍会检查是否注册了兼容的 B-roll 适配器。",
  narration: "根据分镜中的旁白文本生成叙述音频，需要声音和语速参数。",
  soundtrack: "根据分镜中的 BGM / SFX cue 生成配乐或音效；当前 Worker 仍可能因未注册能力而阻塞。",
};
const mediaAdapterPlaceholders: Record<MediaAdapterKey, { provider: string; adapter: string; model: string; promptVersion: string }> = {
  a_roll: { provider: "codex", adapter: "codex", model: "视频生成模型", promptVersion: "a-roll-v1" },
  b_roll: { provider: "pexels", adapter: "pexels_video", model: "pexels-video-v1", promptVersion: "b-roll-v1" },
  narration: { provider: "google_tts", adapter: "google_tts", model: "standard", promptVersion: "narration-v1" },
  soundtrack: { provider: "freesound", adapter: "freesound_preview", model: "preview-v1", promptVersion: "soundtrack-v1" },
};

function FieldHint({ children }: { children: ReactNode }) {
  return <p className="field-hint">{children}</p>;
}

function FieldLabel({ children, help }: { children: ReactNode; help?: string }) {
  return <span className="field-label">{children}{help ? <HelpTip label={typeof children === "string" ? children : "字段"}>{help}</HelpTip> : null}</span>;
}

function PromptVersionManager({ isPending, onCreate, promptVersions, onSelect }: { isPending: boolean; onCreate?: (input: { capability: PromptCapability; name: string; summary: string; instructions: string }) => Promise<PromptVersion | null>; promptVersions: PromptVersion[]; onSelect: (capability: PromptCapability, slug: string) => void }) {
  const [capability, setCapability] = useState<PromptCapability>("script_writing");
  const [name, setName] = useState("");
  const [summary, setSummary] = useState("");
  const [instructions, setInstructions] = useState("");
  const [error, setError] = useState("");
  if (!onCreate) return null;
  const create = onCreate;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim() || !summary.trim()) {
      setError("请填写版本名称和摘要。");
      return;
    }
    setError("");
    const created = await create({ capability, name: name.trim(), summary: summary.trim(), instructions: instructions.trim() });
    if (!created) return;
    onSelect(created.capability, created.slug);
    setName("");
    setSummary("");
    setInstructions("");
  }

  return <details className="prompt-version-manager">
    <summary><FieldLabel help="Prompt 版本是执行规则的可追溯版本。这里登记新版本，蓝图只选择已登记版本；生产单创建后会冻结当时的选择。">Prompt 版本管理</FieldLabel></summary>
    <div className="prompt-version-manager-body">
      <div className="prompt-version-catalog" aria-label="Prompt 版本目录">
        {promptCapabilityOptions.map(([key, label]) => <section key={key}>
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
        <label><FieldLabel help="选择这版 Prompt 服务的生成阶段。">适用阶段</FieldLabel><select onChange={(event) => setCapability(event.target.value as PromptCapability)} value={capability}>{promptCapabilityOptions.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label><FieldLabel help="给运营人员看的名称，不是 Worker 识别用的 slug。">版本名称</FieldLabel><input onChange={(event) => setName(event.target.value)} placeholder="例如：脚本生成·强化冲突 v2" value={name} /></label>
        <label><FieldLabel help="用一句话说明这一版主要改变了什么。">版本摘要</FieldLabel><input onChange={(event) => setSummary(event.target.value)} placeholder="例如：强化开头钩子和人物动机" value={summary} /></label>
        <label><FieldLabel help="记录这版 Prompt 的执行重点，供后续真正接入 Prompt 模板时使用。">执行说明</FieldLabel><textarea onChange={(event) => setInstructions(event.target.value)} placeholder="例如：开头 3 秒必须提出冲突；结尾保留审核所需的事实依据。" rows={3} value={instructions} /></label>
        <button className="button button-secondary" disabled={isPending} type="submit">{isPending ? "登记中…" : "登记新版本"}</button>
        {error ? <p className="form-error">{error}</p> : null}
      </form>
    </div>
  </details>;
}

function MediaAdapterCard({ adapterKey, form, onChange, readOnly = false }: { adapterKey: MediaAdapterKey; form: MediaAdapterForm; onChange: (field: keyof MediaAdapterForm, value: string) => void; readOnly?: boolean }) {
  const label = mediaAdapterLabels[adapterKey];
  const placeholder = mediaAdapterPlaceholders[adapterKey];
  const status = mediaAdapterStatus(adapterKey, form);
  const statusClass = status === "已配置" ? "is-configured" : status === "待补齐" ? "is-incomplete" : "is-empty";
  const textField = (field: keyof MediaAdapterForm, title: string, help: string, fieldPlaceholder: string) => <label><FieldLabel help={help}>{title}</FieldLabel><input aria-label={title} onChange={(event) => onChange(field, event.target.value)} placeholder={fieldPlaceholder} readOnly={readOnly} value={form[field]} /></label>;
  const numberField = (field: keyof MediaAdapterForm, title: string, help: string, min = 1) => <label><FieldLabel help={help}>{title}</FieldLabel><input aria-label={title} min={min} onChange={(event) => onChange(field, event.target.value)} readOnly={readOnly} step={min < 1 ? "0.1" : "1"} type="number" value={form[field]} /></label>;

  return <article className={`media-adapter-card ${statusClass}`}>
    <header><div><h4>{label}</h4><p>{mediaAdapterDescriptions[adapterKey]}</p></div><span className="media-adapter-status">{status}</span></header>
    <div className="media-adapter-field-grid">
      {textField("provider", "Provider", "执行服务名称。这个值必须与 Worker 已注册的供应商一致。", placeholder.provider)}
      {textField("adapter", "Adapter", "具体媒体适配器名称。它会随生产单冻结，Worker 不会自动替换。", placeholder.adapter)}
      {textField("model", "模型", "媒体适配器使用的模型或版本名称。", placeholder.model)}
      {textField("promptVersion", "Prompt 版本", "媒体任务使用的提示词版本标签；先用稳定、可追溯的 slug，例如 a-roll-v1。", placeholder.promptVersion)}
    </div>
    <label><FieldLabel help="任务允许使用的工具，使用英文逗号分隔，例如 read, write 或 network, write。至少填写一个。">允许工具</FieldLabel><input aria-label="允许工具" onChange={(event) => onChange("allowedTools", event.target.value)} placeholder="例如：read, write" readOnly={readOnly} value={form.allowedTools} /></label>
    {adapterKey === "a_roll" ? <div className="media-adapter-field-grid">{numberField("budgetCents", "预算（分）", "单个 A-roll 任务的最大预算，必须大于 0。")}{numberField("maxAttempts", "最大尝试次数", "单个任务失败后的最大执行尝试次数。")}</div> : null}
    {adapterKey === "b_roll" ? <div className="media-adapter-field-grid">{numberField("perShotBudgetCents", "单镜头预算（分）", "每个 B-roll 镜头允许使用的预算。")}{numberField("totalBudgetCents", "总预算（分）", "本次分镜中所有 B-roll 镜头共享的总预算。")}{numberField("maxAttempts", "最大尝试次数", "单个任务失败后的最大执行尝试次数。")}{numberField("maxConcurrency", "最大并发数", "同一生产单同时运行的 B-roll 任务数。")}{numberField("providerMaxConcurrency", "供应商并发上限", "发给同一供应商的最大并发数。")}</div> : null}
    {adapterKey === "narration" ? <div className="media-adapter-field-grid">{numberField("budgetCents", "预算（分）", "旁白任务的最大预算，必须大于 0。")}{numberField("maxAttempts", "最大尝试次数", "旁白任务失败后的最大执行尝试次数。")}{textField("voiceLanguageCode", "语言代码", "声音使用的语言代码，例如 zh-CN 或 vi-VN。", "例如：zh-CN")}{textField("voiceName", "声音名称", "供应商注册的声音名称。", "例如：cmn-CN-Standard-A")}{numberField("voiceSpeakingRate", "语速", "旁白播放速度，通常填写 1。", 0.1)}</div> : null}
    {adapterKey === "soundtrack" ? <FieldHint>当前 Worker 还没有可生成并验证试听音频的已注册适配器；这里先把配置声明集中管理，能力接入后可直接复用。</FieldHint> : null}
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

export function BlueprintConfigurationForm({ initialAssetRoot, initialPolicy, isEpisodeRepair = false, isPending, onCancel, onCreatePromptVersion, onSave, promptVersions = [], readOnly = false }: { initialAssetRoot: string; initialPolicy: Json; isEpisodeRepair?: boolean; isPending: boolean; onCancel: () => void; onCreatePromptVersion?: (input: { capability: PromptCapability; name: string; summary: string; instructions: string }) => Promise<PromptVersion | null>; onSave: (policy: Json, activate: boolean) => Promise<void>; promptVersions?: PromptVersion[]; readOnly?: boolean }) {
  const [form, setForm] = useState<BlueprintFormValues>(() => blueprintPolicyToForm({ ...(initialPolicy && typeof initialPolicy === "object" && !Array.isArray(initialPolicy) ? initialPolicy : {}), asset_root: initialAssetRoot } as Json));
  const [error, setError] = useState("");
  useEffect(() => setForm(blueprintPolicyToForm({ ...(initialPolicy && typeof initialPolicy === "object" && !Array.isArray(initialPolicy) ? initialPolicy : {}), asset_root: initialAssetRoot } as Json)), [initialAssetRoot, initialPolicy]);

  function update(next: Partial<BlueprintFormValues>) {
    setForm((current) => ({ ...current, ...next }));
  }

  function updateExecutor(key: keyof BlueprintFormValues["executors"], field: keyof BlueprintFormValues["executors"]["script_writing"], value: string) {
    setForm((current) => ({ ...current, executors: { ...current.executors, [key]: { ...current.executors[key], [field]: value } } }));
  }

  function updateMediaAdapter(key: MediaAdapterKey, field: keyof MediaAdapterForm, value: string) {
    setForm((current) => ({ ...current, mediaAdapters: { ...current.mediaAdapters, [key]: { ...current.mediaAdapters[key], [field]: value } } }));
  }

  function selectPromptVersion(key: keyof BlueprintFormValues["executors"], slug: string) {
    updateExecutor(key, "promptVersion", slug);
  }

  async function submit(activate: boolean) {
    try {
      setError("");
      if (!form.allowedTools.length) throw new Error("至少保留一个允许工具。");
      if (!form.approvalGates.length) throw new Error("至少保留一个审批关卡。");
      for (const [key, executor] of Object.entries(form.executors)) {
        if (!executor.provider.trim() || !executor.model.trim() || !executor.promptVersion.trim()) throw new Error(`${executorLabels[key as keyof typeof executorLabels]}执行器的 Provider、模型和 Prompt 版本不能为空。`);
      }
      validateMediaAdapters(form.mediaAdapters);
      await onSave(blueprintFormToPolicy(form), activate);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "蓝图规则无法保存。");
    }
  }

  return <section className="configuration-form blueprint-configuration-form">
    <p className="blueprint-editor-note">{readOnly ? "以下按表单结构显示此蓝图版本当前保存的规则。" : isEpisodeRepair ? "表单字段会生成新的蓝图版本；应用后只重建当前生产单的受阻任务，已完成工作和审核记录会保留。" : "表单字段会生成新的蓝图版本，不会修改历史版本或已经创建的 Episode。"}</p>
    <fieldset><legend><FieldLabel help="账号级的长期方向。它会作为脚本、视觉和分镜生成的共同背景。">账号定位</FieldLabel></legend><label><textarea aria-label="账号定位" onChange={(event) => update({ positioning: event.target.value })} placeholder="例如：面向越南华人和对民俗故事感兴趣的观众，持续讲述真实地点中的民间传说。" readOnly={readOnly} rows={3} value={form.positioning} /></label><FieldHint>描述账号面向谁、持续讲什么以及希望保持的表达方向。</FieldHint></fieldset>
    <fieldset><legend><FieldLabel help="Worker 在本机读取输入、写入产物的根目录；路径不会上传到 Supabase。">本地资产与审批</FieldLabel></legend><label><FieldLabel help="建议填写一个稳定的账号目录，例如 /Volumes/素材盘/tk-workflow/dao。">资产目录</FieldLabel><input aria-label="资产目录" onChange={(event) => update({ assetRoot: event.target.value })} placeholder="例如：/Volumes/素材盘/tk-workflow/dao" readOnly={readOnly} value={form.assetRoot} /></label><FieldHint>Worker 会在这台电脑上验证目录；目录不会上传到 Supabase。</FieldHint><div className="configuration-check-grid"><div><span className="configuration-label"><FieldLabel help="勾选后，对应阶段会保留 Owner 的人工确认节点。建议先全部保留。">审批关卡</FieldLabel></span>{approvalGateOptions.map(([value, label]) => <label className="configuration-check" key={value}><input checked={form.approvalGates.includes(value)} disabled={readOnly} onChange={(event) => update({ approvalGates: event.target.checked ? [...form.approvalGates, value] : form.approvalGates.filter((item) => item !== value) })} type="checkbox" />{label}</label>)}</div><div><span className="configuration-label"><FieldLabel help="这是账号级硬约束，不是模型能力。没有 write 时，Worker 不能创建输出产物。">允许工具</FieldLabel></span>{toolOptions.map(([value, label]) => <label className="configuration-check" key={value}><input checked={form.allowedTools.includes(value)} disabled={readOnly} onChange={(event) => update({ allowedTools: event.target.checked ? [...form.allowedTools, value] : form.allowedTools.filter((item) => item !== value) })} type="checkbox" />{label}</label>)}</div></div><FieldHint>访问网络供应商默认关闭；只有使用 Pexels、Freesound 或其他外部服务时才开启。</FieldHint></fieldset>
    <fieldset><legend><FieldLabel help="每个阶段任务的成本上限，单位为最小计费单位“分”。不是内容数量，也不是时间。">阶段预算（分）</FieldLabel></legend><div className="configuration-input-grid"><label><FieldLabel help="脚本生成任务允许的最大成本。">脚本生成</FieldLabel><input min="0" onChange={(event) => update({ budgets: { ...form.budgets, scriptWritingCents: event.target.value } })} readOnly={readOnly} type="number" value={form.budgets.scriptWritingCents} /></label><label><FieldLabel help="视觉规划任务允许的最大成本。">视觉规划</FieldLabel><input min="0" onChange={(event) => update({ budgets: { ...form.budgets, visualPlanningCents: event.target.value } })} readOnly={readOnly} type="number" value={form.budgets.visualPlanningCents} /></label><label><FieldLabel help="分镜规划任务允许的最大成本。">分镜规划</FieldLabel><input min="0" onChange={(event) => update({ budgets: { ...form.budgets, storyboardPlanningCents: event.target.value } })} readOnly={readOnly} type="number" value={form.budgets.storyboardPlanningCents} /></label></div><FieldHint>0 表示没有配置该阶段的可用预算；需要实际计费的任务建议填写大于 0 的上限。</FieldHint></fieldset>
    <fieldset><legend><FieldLabel help={isEpisodeRepair ? "应用到当前生产单后，新的 Provider、模型和 Prompt 版本只会作用于受阻任务；其他已完成工作保持不变。" : "Provider、模型和 Prompt 版本会在创建生产单时冻结，之后修改蓝图只影响新的生产单。"}>执行器</FieldLabel></legend><div className="executor-grid">{Object.entries(executorLabels).map(([key, label]) => { const executor = form.executors[key as keyof BlueprintFormValues["executors"]]; const versions = promptVersions.filter((version) => version.capability === key && version.is_active); const hasSelectedVersion = versions.some((version) => version.slug === executor.promptVersion); const selectedVersion = versions.find((version) => version.slug === executor.promptVersion); return <article className="executor-card" key={key}><h4>{label}</h4><label><FieldLabel help="执行服务，例如 codex。">Provider</FieldLabel><input onChange={(event) => updateExecutor(key as keyof BlueprintFormValues["executors"], "provider", event.target.value)} readOnly={readOnly} value={executor.provider} /></label><label><FieldLabel help="执行时使用的模型名称。">模型</FieldLabel><input onChange={(event) => updateExecutor(key as keyof BlueprintFormValues["executors"], "model", event.target.value)} readOnly={readOnly} value={executor.model} /></label><label><FieldLabel help="从已登记目录选择一个版本；创建生产单后，该版本标签会写入任务记录。">Prompt 版本</FieldLabel>{versions.length ? <select aria-label={`${label} Prompt 版本`} disabled={readOnly} onChange={(event) => selectPromptVersion(key as keyof BlueprintFormValues["executors"], event.target.value)} value={hasSelectedVersion ? executor.promptVersion : "__unregistered__"}>{!hasSelectedVersion ? <option value="__unregistered__">{executor.promptVersion || "当前值"}（未登记）</option> : null}{versions.map((version) => <option key={version.id} value={version.slug}>{version.name} · {version.slug}</option>)}</select> : <input aria-label={`${label} Prompt 版本`} onChange={(event) => updateExecutor(key as keyof BlueprintFormValues["executors"], "promptVersion", event.target.value)} readOnly={readOnly} value={executor.promptVersion} />}</label>{selectedVersion ? <p className="executor-version-summary">{selectedVersion.summary}</p> : null}</article>; })}</div><FieldHint>{isEpisodeRepair ? "应用后只会重新排队当前生产单中受阻的配置任务；已完成任务不会重跑。" : "选择会影响新建 Episode；已存在的生产单不会追溯修改。"}</FieldHint>{readOnly ? null : <PromptVersionManager isPending={isPending} onCreate={onCreatePromptVersion} onSelect={(capability, slug) => selectPromptVersion(capability, slug)} promptVersions={promptVersions} />}</fieldset>
    <fieldset className="media-adapter-configuration"><legend><FieldLabel help={isEpisodeRepair ? "应用到当前生产单后，只会重新排队受阻的媒体任务；如果该系列有同名媒体规则，系列规则会优先，需要到系列标签页修正。" : "这里配置 A-roll、B-roll、旁白和配乐 / 音效任务使用的专用媒体适配器。生产单创建后会冻结当时的配置，修改蓝图只影响新的生产单。"}>媒体适配器</FieldLabel></legend><p className="media-adapter-intro">把需要专用媒体能力的配置集中在这里。未配置或字段不完整时，使用到该能力的 Worker 任务会明确显示阻塞原因。{isEpisodeRepair ? " 如果当前系列规则包含同名媒体配置，应用蓝图前请先修正系列规则。" : ""}</p><div className="media-adapter-grid">{mediaAdapterKeys.map((key) => <MediaAdapterCard adapterKey={key} form={form.mediaAdapters[key]} key={key} onChange={(field, value) => updateMediaAdapter(key, field, value)} readOnly={readOnly} />)}</div><FieldHint>{isEpisodeRepair ? "应用到当前生产单后，只会重新排队受阻任务；清空整张卡片并保存，可以移除该能力的配置声明。" : "保存为新版本后，已经创建的生产单不会追溯修改；清空整张卡片并保存，可以移除该能力的配置声明。"}</FieldHint></fieldset>
    {readOnly ? <ReadOnlyAdvancedRules source={form.advancedJson} /> : <details className="advanced-configuration"><summary><FieldLabel help="这里保留尚未做成表单的其他扩展规则。媒体适配器请优先在上方的独立区域配置。无特殊需要时不要修改。">高级规则（JSON）</FieldLabel></summary><label>高级规则 JSON<textarea aria-label="高级蓝图规则" onChange={(event) => update({ advancedJson: event.target.value })} rows={10} value={form.advancedJson} /></label><FieldHint>高级规则会跟随这个蓝图版本保存，并作用于之后新建的生产单。</FieldHint></details>}
    {error ? <p className="form-error">{error}</p> : null}
    {readOnly ? null : <div className="configuration-actions"><button className="button button-secondary" disabled={isPending} onClick={onCancel} type="button">取消编辑</button><button className="button button-secondary" disabled={isPending} onClick={() => void submit(false)} type="button">{isPending ? "保存中…" : "保存为新版本"}</button><button className="button button-primary" disabled={isPending} onClick={() => void submit(true)} type="button">{isPending ? "保存中…" : "保存并激活"}</button></div>}
  </section>;
}

function mediaAdapterKeyForBlocker(blocker: { code: string; detail: string }): MediaAdapterKey | null {
  const source = `${blocker.code} ${blocker.detail}`.toLowerCase();
  if (/a[_-]?roll/.test(source)) return "a_roll";
  if (/b[_-]?roll/.test(source)) return "b_roll";
  if (/narration|旁白/.test(source)) return "narration";
  if (/soundtrack|sound.?effect|配乐|音效/.test(source)) return "soundtrack";
  return null;
}

function executorKeyForTask(taskType?: string): keyof BlueprintFormValues["executors"] | null {
  if (taskType === "draft_script") return "script_writing";
  if (taskType === "prepare_visual_brief") return "visual_planning";
  if (taskType === "draft_storyboard") return "storyboard_planning";
  return null;
}

export function EpisodeConfigurationRepairForm({ blocker, initialPolicy, isPending, onCancel, onSave }: { blocker: { code: string; detail: string; taskType?: string }; initialPolicy: Json; isPending: boolean; onCancel: () => void; onSave: (policy: Json) => Promise<void> }) {
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

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      setError("");
      if (adapterKey) validateMediaAdapter(adapterKey, form.mediaAdapters[adapterKey]);
      else if (executorKey) {
        const executor = form.executors[executorKey];
        if (!executor.provider.trim() || !executor.model.trim() || !executor.promptVersion.trim()) throw new Error("执行器的 Provider、模型和 Prompt 版本不能为空。");
      } else throw new Error("当前阻塞项无法映射到可修复的配置。");
      await onSave(blueprintFormToPolicy(form));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法保存当前生产单修复。");
    }
  }

  if (!adapterKey && !executorKey) return <section className="configuration-form"><p className="form-error">当前阻塞项不能通过配置修复，请按阻塞卡片提示处理。</p><button className="button button-secondary" onClick={onCancel} type="button">返回生产单</button></section>;
  return <form className="configuration-form blueprint-configuration-form" onSubmit={(event) => void submit(event)}>
    <header><h2>修复当前生产单的 {adapterKey ? mediaAdapterLabels[adapterKey] : executorLabels[executorKey!]}</h2><p className="blueprint-editor-note">只修改这类受阻任务的冻结配置。不会创建或修改账号蓝图，也不会影响之后的新生产单。</p></header>
    {adapterKey ? <fieldset><legend>需要补齐的媒体配置</legend><MediaAdapterCard adapterKey={adapterKey} form={form.mediaAdapters[adapterKey]} onChange={updateMediaAdapter} /></fieldset> : <fieldset><legend>需要补齐的执行器配置</legend><label><FieldLabel help="执行服务名称。">Provider</FieldLabel><input aria-label="Provider" onChange={(event) => updateExecutor("provider", event.target.value)} value={form.executors[executorKey!].provider} /></label><label><FieldLabel help="当前任务使用的模型名称。">模型</FieldLabel><input aria-label="模型" onChange={(event) => updateExecutor("model", event.target.value)} value={form.executors[executorKey!].model} /></label><label><FieldLabel help="当前任务使用的可追溯 Prompt 版本。">Prompt 版本</FieldLabel><input aria-label="Prompt 版本" onChange={(event) => updateExecutor("promptVersion", event.target.value)} value={form.executors[executorKey!].promptVersion} /></label></fieldset>}
    {error ? <p className="form-error">{error}</p> : null}
    <div className="configuration-actions"><button className="button button-secondary" disabled={isPending} onClick={onCancel} type="button">取消</button><button className="button button-primary" disabled={isPending} type="submit">{isPending ? "应用中…" : "保存并继续当前生产单"}</button></div>
  </form>;
}

export function SeriesConfigurationForm({ initialName, initialRules, isEditing, isPending, onCancel, onSave }: { initialName: string; initialRules: Json; isEditing: boolean; isPending: boolean; onCancel: () => void; onSave: (name: string, rules: Json) => Promise<void> }) {
  const [name, setName] = useState(initialName);
  const [form, setForm] = useState<SeriesFormValues>(() => seriesRulesToForm(initialRules));
  const [error, setError] = useState("");
  useEffect(() => { setName(initialName); setForm(seriesRulesToForm(initialRules)); }, [initialName, initialRules]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      setError("");
      if (!name.trim()) throw new Error("请填写系列名称。");
      if (isEditing && name.trim() !== initialName) throw new Error("系列版本编辑不能修改系列名称；请保留原名称后再保存规则。 ");
      const rules = seriesFormToRules(form);
      validateSeriesRules(rules);
      await onSave(name.trim(), rules);
      if (!isEditing) { setName(""); setForm(seriesRulesToForm({})); }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "系列规则无法保存。");
    }
  }

  return <form className="configuration-form series-configuration-form" onSubmit={(event) => void submit(event)}>
    <header><div><h2>{isEditing ? `编辑 ${initialName} 的新版本` : "新建系列"}</h2><p>{isEditing ? "保存后会创建新的系列版本，已有 Episode 不会改变。" : "创建系列后，可以在新建生产单时固定系列基线。"}</p></div></header>
    <label><FieldLabel help="系列名称用于生产单筛选和运营识别。">系列名称</FieldLabel><input aria-label="系列名称" onChange={(event) => setName(event.target.value)} placeholder="例如：越南民间传说" required value={name} /></label>
    <fieldset><legend><FieldLabel help="系列规则会作为固定基线传给脚本、视觉和分镜任务；新建生产单会冻结当前系列版本。">系列基线</FieldLabel></legend>
      <label><FieldLabel help="这个系列具体讲什么，与账号定位相比更聚焦。">系列定位</FieldLabel><textarea aria-label="系列定位" onChange={(event) => setForm((current) => ({ ...current, positioning: event.target.value }))} placeholder="例如：围绕越南真实地点，讲述带有悬疑和民俗色彩的短故事。" rows={2} value={form.positioning} /></label>
      <label><FieldLabel help="固定视频时长、画幅、语言、旁白等制作格式。">内容格式</FieldLabel><input aria-label="内容格式" onChange={(event) => setForm((current) => ({ ...current, format: event.target.value }))} placeholder="例如：60～90秒竖屏短视频，9:16，中文旁白" value={form.format} /></label>
      <div className="series-baseline-grid">
        <label><FieldLabel help="主要角色、身份、性格、关系和不能随意改变的设定。">角色设定</FieldLabel><textarea aria-label="角色设定" onChange={(event) => setForm((current) => ({ ...current, characters: event.target.value }))} placeholder="例如：林砚，28岁，谨慎的民俗调查者；铜铃是贯穿系列的关键道具。" rows={3} value={form.characters} /></label>
        <label><FieldLabel help="固定出现的国家、城市、建筑、自然环境或时代背景。">地点设定</FieldLabel><textarea aria-label="地点设定" onChange={(event) => setForm((current) => ({ ...current, locations: event.target.value }))} placeholder="例如：胡志明市旧城区、湄公河沿岸、雨季夜晚。" rows={3} value={form.locations} /></label>
        <label><FieldLabel help="画面质感、色彩、镜头语言和视觉禁忌。">视觉风格</FieldLabel><textarea aria-label="视觉风格" onChange={(event) => setForm((current) => ({ ...current, visualStyle: event.target.value }))} placeholder="例如：写实纪实、低饱和、潮湿夜景、手持镜头感。" rows={3} value={form.visualStyle} /></label>
        <label><FieldLabel help="每集故事的推荐展开顺序，会影响脚本和分镜结构。">叙事结构</FieldLabel><textarea aria-label="叙事结构" onChange={(event) => setForm((current) => ({ ...current, narrativeStructure: event.target.value }))} placeholder="例如：3秒钩子 → 地点背景 → 异常事件 → 人物选择 → 留白结尾。" rows={3} value={form.narrativeStructure} /></label>
      </div>
      <label><FieldLabel help="明确不能出现的事实、表达、人物、素材或画面。">限制与禁用内容</FieldLabel><textarea aria-label="限制与禁用内容" onChange={(event) => setForm((current) => ({ ...current, restrictions: event.target.value }))} placeholder="例如：不虚构真实新闻；不使用儿童受害情节；不出现现代品牌标识。" rows={3} value={form.restrictions} /></label>
      <FieldHint>这些内容会影响后续脚本、视觉规划和分镜生成；只填写这个系列稳定、可复用的规则。</FieldHint>
    </fieldset>
    <details className="advanced-configuration"><summary><FieldLabel help="保留 B-roll、旁白、声轨和其他暂未做成表单的规则。">高级系列规则（JSON）</FieldLabel></summary><label>高级系列规则<textarea aria-label="系列规则" onChange={(event) => setForm((current) => ({ ...current, advancedJson: event.target.value }))} rows={10} value={form.advancedJson} /></label><FieldHint>系列不能覆盖账号的资产目录、工具权限、审批关卡和发布权限。</FieldHint></details>
    {error ? <p className="form-error">{error}</p> : null}
    <div className="configuration-actions">{isEditing ? <button className="button button-secondary" onClick={onCancel} type="button">取消编辑</button> : null}<button className="button button-primary" disabled={isPending} type="submit">{isPending ? "保存中…" : isEditing ? "创建系列新版本" : "创建系列 v1"}</button></div>
  </form>;
}
