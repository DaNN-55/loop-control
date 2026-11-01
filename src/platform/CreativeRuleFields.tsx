import type { Json } from '../lib/database.types';
import { TextAreaBase } from '../ui/dan-ui/components/base/textarea/textarea';
import { InputBase } from '../ui/dan-ui/components/base/input/input';

const ruleLabels: Record<string, string> = {
  positioning: '账号定位',
  target_audience: '目标受众', audience: '受众', tone: '语气风格', visual_style: '视觉风格',
  restrictions: '限制与禁用内容', content_boundaries: '内容边界', hard_constraints: '硬性规则',
  defaults: '默认偏好', forbidden_topics: '禁用主题', forbidden_content: '禁用内容',
  language: '语言', format: '内容格式', characters: '角色设定', locations: '地点设定',
  narrative_structure: '叙事结构', subtitle_style: '字幕样式', extension: '扩展规则',
};

function RuleValue({ label, value, onChange, readOnly }: { label: string; value: Json; onChange: (value: Json) => void; readOnly: boolean }) {
  if (Array.isArray(value)) {
    if (value.every(item => typeof item === 'string' && !item.includes('\n'))) return <label><span className="field-label">{label}</span><TextAreaBase size="sm" aria-label={label} rows={2} value={value.join('\n')} disabled={readOnly} onChange={event => onChange(event.target.value ? event.target.value.split('\n') : [])}/></label>;
    return <fieldset className="creative-rule-group"><legend>{label}</legend>{value.map((item, index) => <RuleValue key={index} label={`${label} ${index + 1}`} value={item} readOnly={readOnly} onChange={next => onChange(value.map((current, i) => i === index ? next : current))}/>)}</fieldset>;
  }
  if (value && typeof value === 'object') return <fieldset className="creative-rule-group"><legend>{label}</legend>{Object.entries(value).map(([key, item]) => <RuleValue key={key} label={ruleLabels[key] ?? key} value={item ?? null} readOnly={readOnly} onChange={next => onChange({ ...value, [key]: next })}/>)}</fieldset>;
  if (typeof value === 'boolean') return <label className="creative-rule-checkbox"><input type="checkbox" aria-label={label} checked={value} disabled={readOnly} onChange={event => onChange(event.target.checked)}/><span>{label}</span></label>;
  if (typeof value === 'number') return <label><span className="field-label">{label}</span><InputBase size="sm" type="number" aria-label={label} value={String(value)} isDisabled={readOnly} onChange={event => { if (event.target.value.trim() && Number.isFinite(Number(event.target.value))) onChange(Number(event.target.value)); }}/></label>;
  return <label><span className="field-label">{label}</span><TextAreaBase size="sm" aria-label={label} rows={2} value={value ?? ''} disabled={readOnly} onChange={event => onChange(event.target.value)}/></label>;
}

/** Edit creative values without flattening nested or previously saved rules. */
export function CreativeRuleFields({ source, onChange, readOnly = false, showDefaults = false }: { source: string; onChange: (source: string) => void; readOnly?: boolean; showDefaults?: boolean }) {
  const rules = JSON.parse(source) as Record<string, Json>;
  const keys = [...new Set([...(showDefaults ? ['tone', 'visual_style', 'restrictions'] : []), ...Object.keys(rules)])];
  return <div className="creative-rule-fields">{keys.map(key => <RuleValue key={key} label={ruleLabels[key] ?? key.replaceAll('_', ' ')} value={rules[key] ?? ''} readOnly={readOnly} onChange={value => {
    const next = { ...rules };
    if (value === '' && !(key in rules)) delete next[key]; else next[key] = value;
    onChange(JSON.stringify(next));
  }}/>)}</div>;
}
