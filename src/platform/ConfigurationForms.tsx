import {uiText} from '../i18n/ui';
import {creativeAccountRules,resolveCreativeRules,hasCreativeRuleValue} from '../creativeAccountRules';
import {CreativeRuleFields} from './CreativeRuleFields';
import {Disclosure} from '../ui/dan-ui/components/base/disclosure/disclosure';
import {TextAreaBase} from '../ui/dan-ui/components/base/textarea/textarea';
import {InputBase} from '../ui/dan-ui/components/base/input/input';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import { useEffect, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import type { Database, Json } from "../lib/database.types";
import { HelpTip } from "../ui/HelpTip";
import type { LocalSystemStatusReport } from "../observability/SystemStatusPanel";
import type { LocalAdapterReadiness } from "../worker/registeredAdapters";
import type { ExternalConnectionInput, ExternalConnectionVersion } from "../connections/ConnectionWorkspace";
import {
  blueprintFormToPolicy,
  blueprintPolicyToForm,
  seriesFormToRules,
  seriesRulesToForm,
  validateSeriesRules,
  type SeriesFormValues,
} from "./configurationFormValues";

type PromptVersion = Database["public"]["Tables"]["prompt_versions"]["Row"];
type PromptCapability = PromptVersion["capability"];
type ExternalConnection = Database["public"]["Tables"]["external_connections"]["Row"];

function FieldLabel({ children, help }: { children: ReactNode; help?: ReactNode }) {
  return <span className="field-label">{children}{help ? <HelpTip label={typeof children === "string" ? children : uiText("字段")}>{help}</HelpTip> : null}</span>;
}

export function BlueprintConfigurationForm({ accountLayout = false, startEditing = false, footerStatus, saveState, initialPolicy, isPending, onCancel, onDirtyChange, onSave, readOnly = false }: { accountId?: string; accountLayout?: boolean; startEditing?: boolean; footerStatus?: ReactNode; saveState?: ReactNode; connectionVersions?: ExternalConnectionVersion[]; externalConnections?: ExternalConnection[]; initialAssetRoot: string; initialPolicy: Json; isEpisodeRepair?: boolean; isPending: boolean; localAdapterReadiness?: LocalAdapterReadiness; onCancel: () => void; onCreateConnection?: (input: ExternalConnectionInput) => Promise<ExternalConnection | null>; onCreatePromptVersion?: (input: { capability: PromptCapability; name: string; summary: string; instructions: string }) => Promise<PromptVersion | null>; onDirtyChange?: (dirty: boolean) => void; onRotateConnection?: (input: { connectionId: string; provider: ExternalConnectionInput["provider"]; adapter: ExternalConnectionInput["adapter"]; secret: string }) => Promise<ExternalConnection | null>; onSave: (policy: Json, activate: boolean) => Promise<void>; onTestConnection?: (connectionId: string) => Promise<unknown>; onUpdateConnection?: (input: { connectionId: string; name: string; description: string }) => Promise<void>; promptVersions?: PromptVersion[]; readOnly?: boolean; systemStatus?: LocalSystemStatusReport | null; technicalOnly?: boolean }) {
 const [form,setForm]=useState(()=>blueprintPolicyToForm(initialPolicy));
 const [savedForm,setSavedForm]=useState(()=>blueprintPolicyToForm(initialPolicy));
 const [editing,setEditing]=useState(!accountLayout||startEditing),[saving,setSaving]=useState(false);
 const [error,setError]=useState('');
 const savingRef = useRef(false);
 const initialPolicySource = JSON.stringify(initialPolicy);
 useEffect(()=>{const next=blueprintPolicyToForm(initialPolicy);setForm(next);setSavedForm(next);setEditing(!accountLayout||startEditing);onDirtyChange?.(false);},[initialPolicySource,onDirtyChange,accountLayout,startEditing]);
 const locked=accountLayout&&!editing,busy=isPending||saving,fieldsReadOnly=readOnly||locked;
 const dirty=JSON.stringify(form)!==JSON.stringify(savedForm);
 function reset(){if(busy||accountLayout&&dirty&&!window.confirm(uiText("放弃通用规则的未保存修改？")))return;setForm(savedForm);setError('');setEditing(!accountLayout);onDirtyChange?.(false);onCancel();}
 async function save(){if(busy||readOnly||locked||savingRef.current)return;savingRef.current=true;setSaving(true);try{setError('');await onSave(blueprintFormToPolicy(form),true);setSavedForm(form);setEditing(!accountLayout);onDirtyChange?.(false);}catch(cause){setError(cause instanceof Error?cause.message:uiText("蓝图规则无法保存。"));}finally{savingRef.current=false;setSaving(false);}}
 return <section className={`configuration-form blueprint-configuration-form${accountLayout?' account-blueprint-form':''}${locked?' is-locked':''}`}>
  <fieldset id="account-positioning" aria-label={accountLayout ? uiText("内容定位设置") : undefined}>{!accountLayout && <legend>{uiText("内容定位")}</legend>}<label><FieldLabel>{uiText("内容定位")}</FieldLabel><TextAreaBase size="sm" aria-label={uiText("内容定位")} placeholder={uiText("做什么内容，给谁看（选填）")} rows={2} disabled={busy} readOnly={fieldsReadOnly} value={form.positioning} onChange={event=>{setForm(current=>({...current,positioning:event.target.value}));onDirtyChange?.(true);}} /></label></fieldset>
  <fieldset><legend>{uiText("创作规则")}</legend><CreativeRuleFields source={form.advancedJson} readOnly={fieldsReadOnly} isDisabled={busy} showDefaults onChange={advancedJson=>{setForm(current=>({...current,advancedJson}));onDirtyChange?.(true);}}/></fieldset>
  {error?<p role="alert" className="form-error">{uiText(error)}</p>:null}
  {!readOnly?<div className={accountLayout?'account-blueprint-footer':undefined}>{footerStatus}<div className="configuration-actions">{locked?<><Button size="sm" color="secondary" isDisabled={busy} onPress={()=>setEditing(true)}>{uiText("修改")}</Button></>:<>{saveState}<Button size="sm" color="secondary" isDisabled={busy} onPress={reset}>{accountLayout?(dirty?uiText("放弃修改"):uiText("取消编辑")):uiText("撤销修改")}</Button><Button size="sm" color="primary" isDisabled={busy} onPress={()=>void save()}>{busy?uiText("保存中…"):accountLayout?uiText("保存通用规则"):uiText("保存蓝图")}</Button></>}</div></div>:null}
  <p className="field-hint">{uiText("仅影响之后新建的生产单；已有生产单保留原规则。四类规则都可留空。")}</p>
 </section>;
}

export function SeriesConfigurationForm({ headingContent, onCreateEpisode, onRename, accountPolicy, currentVersion: _currentVersion = 0, initialName, initialRules, isEditing, isPending, onCancel, onDirtyChange, onSave }: { headingContent?: ReactNode; onCreateEpisode?: () => void; onRename?: (name: string) => Promise<boolean | void>; accountPolicy?: Json; currentVersion?: number; initialName: string; initialRules: Json; isEditing: boolean; isPending: boolean; onCancel: () => void; onDirtyChange?: (dirty: boolean) => void; onSave: (name: string, rules: Json) => Promise<void> }) {
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
  const [effectiveOpen, setEffectiveOpen] = useState(false);
  const [extrasOpen, setExtrasOpen] = useState(false);
  const initialRulesKey=JSON.stringify(initialRules);
  useEffect(() => { setName(initialName); setSavedName(initialName); setForm(seriesRulesToForm(initialRules)); setSavedForm(seriesRulesToForm(initialRules)); setEditing(!isEditing); setDirty(false); onDirtyChange?.(false); }, [initialRulesKey, onDirtyChange]);

  function requestSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || locked) return;
    try {
      setError("");
      if (!name.trim()) throw new Error(uiText("请填写系列名称。"));
      const rules = seriesFormToRules(form);
      validateSeriesRules(rules);
      void confirmSubmit();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : uiText("系列规则无法保存。"));
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
        if (await onRename(name.trim()) === false) throw new Error(uiText("系列名称未保存，请重试。"));
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
      if (!isEditing) { setName(""); setForm(seriesRulesToForm({})); }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : uiText("系列规则无法保存。");
      setError(nameSaved ? uiText("名称已保存，规则未应用：{value1}",{value1:message}) : message);
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
  const inheritedPlaceholder = (key: keyof SeriesFormValues) => accountPolicy === undefined ? undefined : accountDefaults[key] || uiText("沿用账号通用规则");
  const accountRules = accountPolicy && typeof accountPolicy === 'object' && !Array.isArray(accountPolicy) ? accountPolicy : {};
  const resolvedRules = resolveCreativeRules(creativeAccountRules(accountRules), seriesFormToRules(form));
  const remainingAccountRules = Object.fromEntries(Object.entries(resolvedRules.account).filter(([key])=>!["positioning","visual_style","restrictions"].includes(key)));
  const remainingSeriesRules = Object.fromEntries(Object.entries(resolvedRules.series ?? {}).filter(([key])=>!["positioning","visual_style","restrictions"].includes(key)));
  const seriesValues = seriesRulesToForm(resolvedRules.series as Json);
  const accountRestrictions = hasCreativeRuleValue(resolvedRules.account.restrictions) ? accountDefaults.restrictions : '';
  const seriesRestrictions = hasCreativeRuleValue(resolvedRules.series?.restrictions) ? seriesValues.restrictions : '';
  const restrictionValues = [
    accountRestrictions && uiText("账号通用规则\n{value1}",{value1:accountRestrictions}),
    seriesRestrictions && uiText("系列规则\n{value1}",{value1:seriesRestrictions}),
  ].filter(Boolean).join('\n\n');
  const ruleSource = (key: 'positioning' | 'visualStyle') => {
    if (seriesValues[key]) return uiText("来自系列规则");
    const field = key === 'positioning' ? 'positioning' : 'visual_style';
    return hasCreativeRuleValue(resolvedRules.account[field]) ? uiText("沿用账号通用规则") : uiText("未设置");
  };
  const creativeRuleFields = (
    <fieldset><legend>{uiText("创作规则")}</legend><p className="series-inheritance-note">{uiText("定位和视觉风格优先使用系列值，留空时沿用账号通用规则。两处填写的限制同时生效。")}</p>
      <label><FieldLabel>{uiText("系列定位")}{locked && !form.positioning && <small className="series-rule-source">{uiText("沿用账号规则")}</small>}</FieldLabel><TextAreaBase readOnly={locked} disabled={busy} size="sm" aria-label={uiText("系列定位")} onChange={(event) => setForm((current) => ({ ...current, positioning: event.target.value }))} placeholder={locked?undefined:inheritedPlaceholder("positioning") ?? uiText("受众、主题与内容方向")} rows={2} value={form.positioning} /></label>
      <label><FieldLabel>{uiText("内容格式")}{locked&&<small className="series-rule-source">{form.format?uiText("来自系列规则"):accountDefaults.format?uiText("来自账号通用规则"):uiText("未设置")}</small>}</FieldLabel><InputBase readOnly={locked} isDisabled={busy} size="sm" aria-label={uiText("内容格式")} onChange={(event) => setForm((current) => ({ ...current, format: event.target.value }))} placeholder={locked?undefined:inheritedPlaceholder("format") ?? uiText("例如：9:16 竖屏，中文旁白")} value={form.format} /></label>
    <div className="series-baseline-grid">{([
      ['characters', uiText("角色设定"), uiText("固定角色、身份与关系")],
      ['locations', uiText("地点设定"), uiText("地点、环境与时代背景")],
      ['visualStyle', uiText("视觉风格"), uiText("画面质感、色彩与镜头语言")],
      ['narrativeStructure', uiText("叙事结构"), uiText("开场、展开与结尾")],
    ] as const).map(([key, label, placeholder]) => <label key={key}><FieldLabel>{label}{key==='visualStyle'?<small className="series-rule-source">{ruleSource(key)}</small>:locked&&<small className="series-rule-source">{form[key]?uiText("来自系列规则"):accountDefaults[key]?uiText("来自账号通用规则"):uiText("未设置")}</small>}</FieldLabel><TextAreaBase readOnly={locked} disabled={busy} size="sm" aria-label={label} onChange={(event) => setForm((current) => ({...current, [key]: event.target.value}))} placeholder={locked?undefined:inheritedPlaceholder(key) ?? placeholder} rows={2} value={form[key]} /></label>)}</div>
    <label><FieldLabel>{uiText("限制与禁用内容")}</FieldLabel><TextAreaBase readOnly={locked} disabled={busy} size="sm" aria-label={uiText("限制与禁用内容")} onChange={(event) => setForm((current) => ({ ...current, restrictions: event.target.value }))} placeholder={uiText("不能出现的事实、表达、人物、素材或画面")} rows={2} value={form.restrictions} />{accountRestrictions&&<small className="field-hint series-account-restriction">{uiText("同时生效的账号限制 ·")}{accountRestrictions}</small>}</label>
      {Object.keys(JSON.parse(form.advancedJson ?? '{}')).length > 0 && <Disclosure label={uiText("其他已存规则")} onToggle={event=>setExtrasOpen(event.currentTarget.open)}>{extrasOpen && <CreativeRuleFields source={form.advancedJson ?? '{}'} readOnly={locked} isDisabled={busy} onChange={advancedJson=>setForm(current=>({...current,advancedJson}))}/>}</Disclosure>}
    </fieldset>
  );
  return <><header className="account-editor-heading"><h2>{isEditing ? savedName : uiText("新建系列")}</h2>{isEditing ? <div className="series-header-actions"><span className="account-save-state" role="status">{uiText("已保存")}</span>{locked && onCreateEpisode && <Button size="sm" color="primary" type="button" isDisabled={busy} onClick={onCreateEpisode}>{uiText("新建生产单")}</Button>}</div> : null}</header><form className={`configuration-form series-configuration-form${locked ? " is-locked" : ""}`} onChangeCapture={() => {if (!locked && !busy) {setDirty(true); onDirtyChange?.(true);}}} onSubmit={requestSubmit}>
    <fieldset><legend>{uiText("系列资料")}</legend><label><FieldLabel>{isEditing ? uiText("系列显示名称") : uiText("系列名称")}</FieldLabel><InputBase size="sm" aria-label={isEditing ? uiText("系列显示名称") : uiText("系列名称")} readOnly={locked || (isEditing && !onRename)} isDisabled={busy} onChange={(event) => setName(event.target.value)} placeholder={uiText("例如：城市观察短片")} isRequired value={name} /></label>{headingContent}</fieldset>
    {isEditing ? creativeRuleFields : <Disclosure open className="series-creation-rules" label={uiText("创作规则（选填）")}>{creativeRuleFields}</Disclosure>}
    {error ? <p className="form-error" role="alert">{uiText(error)}</p> : null}
    <footer className="series-form-footer">{!locked ? <span className={`account-save-state${dirty ? " is-dirty" : ""}`} role="status">{busy ? uiText("保存中…") : dirty ? uiText("有未保存修改") : isEditing ? uiText("修改中") : uiText("未创建")}</span> : null}<div className="configuration-actions">{locked ? <Button size="sm" color="secondary" className="button button-secondary" onClick={() => setEditing(true)} type="button">{uiText("修改")}</Button> : <><Button size="sm" color="secondary" className="button button-secondary" isDisabled={busy} onClick={()=>{if(!dirty||window.confirm(isEditing?uiText("放弃当前系列的未保存修改？"):uiText("放弃新建系列的草稿？")))reset();}} type="button">{isEditing ? dirty?uiText("放弃修改"):uiText("取消编辑") : uiText("取消")}</Button><Button size="sm" color="primary" className="button button-primary" isDisabled={busy} type="submit">{busy ? uiText("保存中…") : isEditing ? uiText("保存系列设置") : uiText("创建系列")}</Button></>}</div></footer>
    {isEditing && <>
      <p className="field-hint">{uiText("仅影响之后新建的生产单；已有生产单保留原规则。")}</p>
      <Disclosure label={uiText("查看完整生效规则")} onToggle={event => setEffectiveOpen(event.currentTarget.open)}>{effectiveOpen && <section className="creative-rule-fields">
        <label><FieldLabel>{uiText("生效的内容定位")}</FieldLabel><TextAreaBase size="sm" aria-label={uiText("生效的内容定位")} readOnly rows={2} value={seriesValues.positioning || accountDefaults.positioning}/></label>
        <label><FieldLabel>{uiText("生效的画面风格")}</FieldLabel><TextAreaBase size="sm" aria-label={uiText("生效的画面风格")} readOnly rows={2} value={seriesValues.visualStyle || accountDefaults.visualStyle}/></label>
        <label><FieldLabel>{uiText("生效的内容禁区")}</FieldLabel><TextAreaBase size="sm" aria-label={uiText("生效的内容禁区")} readOnly rows={2} value={restrictionValues}/></label>
        {Object.keys(remainingAccountRules).length > 0 && <fieldset><legend>{uiText("账号规则")}</legend><CreativeRuleFields source={JSON.stringify(remainingAccountRules)} readOnly labelPrefix="账号 · " onChange={()=>{}}/></fieldset>}
        {Object.keys(remainingSeriesRules).length > 0 && <fieldset><legend>{uiText("系列规则")}</legend><CreativeRuleFields source={JSON.stringify(remainingSeriesRules)} readOnly labelPrefix="系列 · " onChange={()=>{}}/></fieldset>}
      </section>}</Disclosure>
    </>}
  </form></>;
}
