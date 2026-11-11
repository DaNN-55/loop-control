import {providerDisplayNames,type ProductionService} from '../connections/serviceCatalog';
import {WorkspaceModelPicker} from './WorkspaceModelPicker';

export function WorkspaceAudioSourceOptions({services,value,disabled,onChange}:{services:ProductionService[];value:string;disabled?:boolean;onChange:(value:string)=>void}){
 return <WorkspaceModelPicker label="音频来源" title="选择音频来源" searchLabel="筛选音频来源" searchPlaceholder="搜索来源或连接" closeLabel="关闭音频来源" noResults="没有匹配来源。" value={value} disabled={disabled} onChange={onChange} clear clearLabel="清除来源选择" empty="暂无可用音频连接" showConnections
  options={services.map(service=>({
   id:service.id,label:providerDisplayNames[service.provider]??service.label,provider:service.provider,
   connection:`${service.connectionName??service.label} · v${service.connectionVersion??'—'}${service.unavailableReason?` · ${service.unavailableReason}`:''}`,
   searchText:`${service.provider} ${service.connectionName??''} ${service.label}`,disabled:disabled||!service.executable,
  }))}/>;
}
