import {NativeSelect} from '../ui/dan-ui/components/base/select/select-native';
import type {ProductionService} from '../connections/serviceCatalog';
import type {ProductionSelection} from '../productionSelection';
import './workspace-generation-form.css';

export function WorkspaceGenerationModel({kind,services,selection,disabled,onChange}:{kind:'图片'|'视频';services:ProductionService[];selection?:ProductionSelection|null;disabled?:boolean;onChange:(value:string)=>void}){
 const service=services.find(s=>s.connectionVersionId===selection?.connectionVersionId&&s.provider===selection?.provider&&s.adapter===selection?.adapter),available=!!service?.models.includes(selection?.model??'');
 return <div className="workspace-generation-model"><label>模型<NativeSelect size="sm" aria-label={`${kind}连接与模型`} title={selection?.model??undefined} value={available?`${service!.id}:${selection!.model}`:''} disabled={disabled} onChange={event=>onChange(event.target.value)}><option value="">选择{kind}模型</option>{selection&&!available&&<option value="" disabled>{selection.model}（原选择不可用）</option>}{services.map(s=><optgroup key={s.id} label={`${s.connectionName??s.label} · ${s.provider} · v${s.connectionVersion??'—'}`}>{s.models.map(model=><option key={model} value={`${s.id}:${model}`} disabled={!s.executable}>{model}{!s.executable?`（${s.unavailableReason??'当前不可用'}）`:''}</option>)}</optgroup>)}</NativeSelect></label>{selection?.model&&selection.model.length>36&&<span className="workspace-selected-model">{selection.model}</span>}{service&&<small>连接：{service.connectionName??service.label} · {service.provider} · v{service.connectionVersion??'—'}</small>}</div>;
}
