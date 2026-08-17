import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { Json } from "../lib/database.types";
import {
  blueprintFormToPolicy,
  blueprintPolicyToForm,
  seriesFormToRules,
  seriesRulesToForm,
  validateSeriesRules,
  type BlueprintFormValues,
  type SeriesFormValues,
} from "./configurationFormValues";

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

function FieldHint({ children }: { children: string }) {
  return <p className="field-hint">{children}</p>;
}

export function BlueprintConfigurationForm({ initialAssetRoot, initialPolicy, isPending, onCancel, onSave }: { initialAssetRoot: string; initialPolicy: Json; isPending: boolean; onCancel: () => void; onSave: (policy: Json, activate: boolean) => Promise<void> }) {
  const [form, setForm] = useState<BlueprintFormValues>(() => blueprintPolicyToForm({ ...(initialPolicy && typeof initialPolicy === "object" && !Array.isArray(initialPolicy) ? initialPolicy : {}), asset_root: initialAssetRoot } as Json));
  const [error, setError] = useState("");
  useEffect(() => setForm(blueprintPolicyToForm({ ...(initialPolicy && typeof initialPolicy === "object" && !Array.isArray(initialPolicy) ? initialPolicy : {}), asset_root: initialAssetRoot } as Json)), [initialAssetRoot, initialPolicy]);

  function update(next: Partial<BlueprintFormValues>) {
    setForm((current) => ({ ...current, ...next }));
  }

  function updateExecutor(key: keyof BlueprintFormValues["executors"], field: keyof BlueprintFormValues["executors"]["script_writing"], value: string) {
    setForm((current) => ({ ...current, executors: { ...current.executors, [key]: { ...current.executors[key], [field]: value } } }));
  }

  async function submit(activate: boolean) {
    try {
      setError("");
      if (!form.allowedTools.length) throw new Error("至少保留一个允许工具。");
      if (!form.approvalGates.length) throw new Error("至少保留一个审批关卡。");
      for (const [key, executor] of Object.entries(form.executors)) {
        if (!executor.provider.trim() || !executor.model.trim() || !executor.promptVersion.trim()) throw new Error(`${executorLabels[key as keyof typeof executorLabels]}执行器的 Provider、模型和 Prompt 版本不能为空。`);
      }
      await onSave(blueprintFormToPolicy(form), activate);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "蓝图规则无法保存。");
    }
  }

  return <section className="configuration-form blueprint-configuration-form"><p className="blueprint-editor-note">表单字段会生成新的蓝图版本，不会修改历史版本或已经创建的 Episode。</p><fieldset><legend>账号定位</legend><label>账号定位<textarea aria-label="账号定位" onChange={(event) => update({ positioning: event.target.value })} rows={3} value={form.positioning} /></label><FieldHint>描述账号面向谁、持续讲什么以及希望保持的表达方向。</FieldHint></fieldset><fieldset><legend>本地资产与审批</legend><label>资产目录<input aria-label="资产目录" onChange={(event) => update({ assetRoot: event.target.value })} placeholder="例如：/Volumes/素材盘/tk-workflow/dao" value={form.assetRoot} /></label><FieldHint>Worker 会在这台电脑上验证目录；目录不会上传到 Supabase。</FieldHint><div className="configuration-check-grid"><div><span className="configuration-label">审批关卡</span>{approvalGateOptions.map(([value, label]) => <label className="configuration-check" key={value}><input checked={form.approvalGates.includes(value)} onChange={(event) => update({ approvalGates: event.target.checked ? [...form.approvalGates, value] : form.approvalGates.filter((item) => item !== value) })} type="checkbox" />{label}</label>)}</div><div><span className="configuration-label">允许工具</span>{toolOptions.map(([value, label]) => <label className="configuration-check" key={value}><input checked={form.allowedTools.includes(value)} onChange={(event) => update({ allowedTools: event.target.checked ? [...form.allowedTools, value] : form.allowedTools.filter((item) => item !== value) })} type="checkbox" />{label}</label>)}</div></div><FieldHint>工具权限属于账号硬约束；没有 write 时，Worker 不能创建输出产物。</FieldHint></fieldset><fieldset><legend>阶段预算（分）</legend><div className="configuration-input-grid"><label>脚本生成<input min="0" onChange={(event) => update({ budgets: { ...form.budgets, scriptWritingCents: event.target.value } })} type="number" value={form.budgets.scriptWritingCents} /></label><label>视觉规划<input min="0" onChange={(event) => update({ budgets: { ...form.budgets, visualPlanningCents: event.target.value } })} type="number" value={form.budgets.visualPlanningCents} /></label><label>分镜规划<input min="0" onChange={(event) => update({ budgets: { ...form.budgets, storyboardPlanningCents: event.target.value } })} type="number" value={form.budgets.storyboardPlanningCents} /></label></div><FieldHint>0 表示当前阶段不额外计入预算；实际供应商任务可能有自己的预算字段。</FieldHint></fieldset><fieldset><legend>执行器</legend><div className="executor-grid">{Object.entries(executorLabels).map(([key, label]) => { const executor = form.executors[key as keyof BlueprintFormValues["executors"]]; return <article className="executor-card" key={key}><h4>{label}</h4><label>Provider<input onChange={(event) => updateExecutor(key as keyof BlueprintFormValues["executors"], "provider", event.target.value)} value={executor.provider} /></label><label>模型<input onChange={(event) => updateExecutor(key as keyof BlueprintFormValues["executors"], "model", event.target.value)} value={executor.model} /></label><label>Prompt 版本<input onChange={(event) => updateExecutor(key as keyof BlueprintFormValues["executors"], "promptVersion", event.target.value)} value={executor.promptVersion} /></label></article>; })}</div><FieldHint>执行器决定使用哪个模型和 Prompt 版本；修改后会作用于新建 Episode。</FieldHint></fieldset><details className="advanced-configuration"><summary>高级规则（JSON）</summary><label>高级规则 JSON<textarea aria-label="高级蓝图规则" onChange={(event) => update({ advancedJson: event.target.value })} rows={10} value={form.advancedJson} /></label><FieldHint>这里保留表单暂未覆盖的供应商、声轨和媒体规则。无特殊需要时不要修改。</FieldHint></details>{error ? <p className="form-error">{error}</p> : null}<div className="configuration-actions"><button className="button button-secondary" disabled={isPending} onClick={onCancel} type="button">取消编辑</button><button className="button button-secondary" disabled={isPending} onClick={() => void submit(false)} type="button">{isPending ? "保存中…" : "保存为新版本"}</button><button className="button button-primary" disabled={isPending} onClick={() => void submit(true)} type="button">{isPending ? "保存中…" : "保存并激活"}</button></div></section>;
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

  return <form className="configuration-form series-configuration-form" onSubmit={(event) => void submit(event)}><header><div><h2>{isEditing ? `编辑 ${initialName} 的新版本` : "新建系列"}</h2><p>{isEditing ? "保存后会创建新的系列版本，已有 Episode 不会改变。" : "创建系列后，可以在新建生产单时固定系列基线。"}</p></div></header><label>系列名称<input aria-label="系列名称" onChange={(event) => setName(event.target.value)} required value={name} /></label><fieldset><legend>系列基线</legend><label>系列定位<textarea aria-label="系列定位" onChange={(event) => setForm((current) => ({ ...current, positioning: event.target.value }))} rows={2} value={form.positioning} /></label><label>内容格式<input aria-label="内容格式" onChange={(event) => setForm((current) => ({ ...current, format: event.target.value }))} value={form.format} /></label><div className="series-baseline-grid"><label>角色设定<textarea aria-label="角色设定" onChange={(event) => setForm((current) => ({ ...current, characters: event.target.value }))} rows={3} value={form.characters} /></label><label>地点设定<textarea aria-label="地点设定" onChange={(event) => setForm((current) => ({ ...current, locations: event.target.value }))} rows={3} value={form.locations} /></label><label>视觉风格<textarea aria-label="视觉风格" onChange={(event) => setForm((current) => ({ ...current, visualStyle: event.target.value }))} rows={3} value={form.visualStyle} /></label><label>叙事结构<textarea aria-label="叙事结构" onChange={(event) => setForm((current) => ({ ...current, narrativeStructure: event.target.value }))} rows={3} value={form.narrativeStructure} /></label></div><label>限制与禁用内容<textarea aria-label="限制与禁用内容" onChange={(event) => setForm((current) => ({ ...current, restrictions: event.target.value }))} rows={3} value={form.restrictions} /></label></fieldset><details className="advanced-configuration"><summary>高级系列规则（JSON）</summary><label>高级系列规则<textarea aria-label="系列规则" onChange={(event) => setForm((current) => ({ ...current, advancedJson: event.target.value }))} rows={10} value={form.advancedJson} /></label><FieldHint>这里保留 B-roll、旁白、声轨和其他特殊规则；无特殊需要时不要修改。</FieldHint></details>{error ? <p className="form-error">{error}</p> : null}<div className="configuration-actions">{isEditing ? <button className="button button-secondary" onClick={onCancel} type="button">取消编辑</button> : null}<button className="button button-primary" disabled={isPending} type="submit">{isPending ? "保存中…" : isEditing ? "创建系列新版本" : "创建系列 v1"}</button></div></form>;
}
