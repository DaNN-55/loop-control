import {readConfiguredService,requestConnectionSetup} from './connectionSetup';
import type {ProductionSelection} from '../productionSelection';
import {uiText} from '../i18n/ui';
import {providerDisplayNames,type ProductionService} from '../connections/serviceCatalog';
import {WorkspaceModelPicker} from './WorkspaceModelPicker';

export function WorkspaceAudioSourceOptions({services,value,disabled,onChange,onSetupSelection,allowClear=true}:{services:ProductionService[];value:string;disabled?:boolean;allowClear?:boolean;onChange:(value:string)=>void;onSetupSelection?:(selection:ProductionSelection)=>void}){
 return <WorkspaceModelPicker label={uiText("音频来源")} title={uiText("选择音频来源")} closeLabel={uiText("关闭音频来源")} value={value} disabled={disabled} onChange={onChange} onConfigure={onSetupSelection?()=>requestConnectionSetup({capability:'music_sound',onUse:async choice=>{const configured=await readConfiguredService('music_sound',choice);onSetupSelection(configured.selection);}}):undefined} clear={allowClear} clearLabel="清除来源选择" empty="暂无可用音频连接" showConnections
  options={services.map(service=>({
   id:service.id,label:providerDisplayNames[service.provider]??service.label,provider:service.provider,
   connection:`${service.connectionName??service.label} · v${service.connectionVersion??'—'}${service.unavailableReason?` · ${service.unavailableReason}`:''}`,
   disabled:disabled||!service.executable,
  }))}/>;
}
