import {Header,Menu,MenuItem,MenuSection} from 'react-aria-components';
import {Check} from 'lucide-react';
import {providerDisplayNames,type ProductionService} from '../connections/serviceCatalog';

export function WorkspaceAudioSourceOptions({services,value,disabled,onChange}:{services:ProductionService[];value:string;disabled?:boolean;onChange:(value:string)=>void}){
 const groups=[...new Set(services.map(s=>s.provider))].map(provider=>({provider,services:services.filter(s=>s.provider===provider)}));
 if(!services.length)return <p className="workspace-audio-empty-sources" role="status">暂无可用音频连接</p>;
 return <Menu aria-label="音频可用来源" className="workspace-composer-model-list" selectionMode="single" selectedKeys={[value||'clear']} disabledKeys={disabled?['clear',...services.map(s=>s.id)]:services.filter(s=>!s.executable).map(s=>s.id)} onAction={key=>onChange(key==='clear'?'':String(key))}>
  <MenuItem shouldCloseOnSelect={false} id="clear" textValue="清除来源选择" className="workspace-composer-model-option"><strong>清除来源选择</strong>{!value&&<Check size={14}/>}</MenuItem>
  {groups.map(group=><MenuSection id={group.provider} key={group.provider} className="workspace-composer-model-group">
   <Header className="workspace-composer-model-group-heading"><span>{providerDisplayNames[group.provider]??group.provider}</span>{group.services.length===1&&<small>{group.services[0].connectionName??group.services[0].label} · v{group.services[0].connectionVersion??'—'}</small>}</Header>
   {group.services.map(service=><MenuItem shouldCloseOnSelect={false} id={service.id} key={service.id} aria-label={`${providerDisplayNames[service.provider]??service.provider} 素材检索 ${service.connectionName??service.label}`} textValue={`${providerDisplayNames[service.provider]??service.provider} 素材检索 ${service.connectionName??service.label}`} className="workspace-composer-model-option"><strong title={service.unavailableReason??undefined}>素材检索</strong>{group.services.length>1&&<small>{service.connectionName??service.label} · v{service.connectionVersion??'—'}</small>}{value===service.id&&<Check size={14}/>}</MenuItem>)}
  </MenuSection>)}

 </Menu>;
}
