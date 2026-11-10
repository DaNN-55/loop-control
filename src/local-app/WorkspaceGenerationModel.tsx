import {useId,useState} from 'react';
import {Dialog,DialogTrigger,Header,Menu,MenuItem,MenuSection,Popover} from 'react-aria-components';
import {Check,ChevronDown,X} from 'lucide-react';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import {NativeSelect} from '../ui/dan-ui/components/base/select/select-native';
import {providerDisplayNames,type ProductionService} from '../connections/serviceCatalog';
import type {ProductionSelection} from '../productionSelection';
import './workspace-generation-form.css';

export function WorkspaceGenerationModel({kind,services,selection,disabled,onChange,compact=false}:{kind:'图片'|'视频';services:ProductionService[];selection?:ProductionSelection|null;disabled?:boolean;onChange:(value:string)=>void;compact?:boolean}){
 const selectId=useId();
 const [open,setOpen]=useState(false),[query,setQuery]=useState('');
 const availableServices=services.filter(service=>service.executable&&(service.mode==='search'&&service.provider==='pexels'&&service.adapter==='pexels_video'||service.models.length>0));
 const selectedModel=selection?.model;
 const selectedService=availableServices.find(service=>
  service.connectionVersionId===selection?.connectionVersionId&&service.provider===selection?.provider&&
  service.adapter===selection?.adapter&&(service.mode==='search'?!selectedModel:!!selectedModel&&service.models.includes(selectedModel))
 );
 const modelOptions=availableServices.flatMap(service=>service.mode==='search'
  ?[{service,id:`${service.id}:search`,label:'Pexels 素材检索'}]
  :service.models.map(model=>({service,id:`${service.id}:${model}`,label:model})));
 const grouped=new Map<string,typeof modelOptions>();
 for(const option of modelOptions.filter(({service,label})=>!compact||`${label} ${service.connectionName??''} ${providerDisplayNames[service.provider]??service.provider}`.toLowerCase().includes(query.toLowerCase().trim()))){
  const options=grouped.get(option.service.provider)??[];options.push(option);grouped.set(option.service.provider,options);
 }
 const modelGroups=[...grouped].map(([provider,options])=>({provider,label:providerDisplayNames[provider]??provider,options,connections:[...new Map(options.map(option=>[option.service.id,option.service])).values()]}));
 const connectionLabel=(service:ProductionService)=>`${service.connectionName??service.label} · v${service.connectionVersion??'—'}`;
 const value=selectedService?`${selectedService.id}:${selectedService.mode==='search'?'search':selectedModel}`:'';
 const selectedLabel=modelOptions.find(option=>option.id===value)?.label;
 const unavailable=kind==='图片'&&!availableServices.length
  ?(services.find(service=>service.connectionVersionId===selection?.connectionVersionId)||services.find(service=>service.connectionVersionId&&service.status==='verified'))?.unavailableReason
  :null;
 if(compact)return <DialogTrigger isOpen={open} onOpenChange={value=>{setOpen(value);if(value)setQuery('');}}>
  <Button size="xs" color="tertiary" className="workspace-composer-chip" aria-label={`${kind}连接与模型`} title={selectedService?`${selectedService.connectionName??selectedService.label} · ${selectedLabel}`:undefined} isDisabled={disabled} iconTrailing={ChevronDown}>{selectedService?selectedLabel:`选择${kind}模型`}</Button>
  <Popover className="dan-ui product-ui workspace-composer-popover workspace-composer-model-popover" placement="top start" offset={8} containerPadding={12} shouldFlip>
   <Dialog aria-label={`选择${kind}模型`} className="workspace-composer-settings">
    <header><h3>选择{kind}模型</h3><Button size="xs" color="tertiary" aria-label="关闭模型选择" iconLeading={X} onPress={()=>setOpen(false)}/></header>
    <input type="search" className="workspace-composer-model-search" aria-label={`筛选${kind}模型`} placeholder="搜索模型、服务商或连接" value={query} onChange={event=>setQuery(event.target.value)}/>
    <Menu aria-label={`${kind}可用模型`} className="workspace-composer-model-list" selectionMode="single" selectedKeys={value?[value]:[]} onAction={key=>{setOpen(false);onChange(String(key));}} renderEmptyState={()=><p role="status">{unavailable??(availableServices.length?'没有匹配模型。':`暂无可用${kind}模型。`)}</p>}>
     {modelGroups.map(group=><MenuSection key={group.provider} id={group.provider} aria-label={group.label} className="workspace-composer-model-group">
      <Header className="workspace-composer-model-group-heading"><span>{group.label}</span>{group.connections.length===1&&<small title={connectionLabel(group.connections[0])}>{connectionLabel(group.connections[0])}</small>}</Header>
      {group.options.map(({service,id,label})=><MenuItem key={id} id={id} textValue={`${label}${group.connections.length>1?` ${connectionLabel(service)}`:''}`} className="workspace-composer-model-option"><strong>{label}</strong>{group.connections.length>1&&<small title={connectionLabel(service)}>{connectionLabel(service)}</small>}{id===value&&<Check size={14} aria-hidden="true"/>}</MenuItem>)}
     </MenuSection>)}
    </Menu>
    {selection&&<Button size="xs" color="tertiary" onPress={()=>{setOpen(false);onChange('');}}>清除模型选择</Button>}
   </Dialog>
  </Popover>
 </DialogTrigger>;
 return <div className="workspace-generation-model">
  <div className="workspace-generation-field-row">
   <label htmlFor={selectId}>模型</label>
   <NativeSelect id={selectId} size="sm" aria-label={`${kind}连接与模型`} value={value} disabled={disabled||(kind==='图片'&&!availableServices.length)} onChange={event=>onChange(event.target.value)}>
    <option value="">选择{kind}模型</option>
    {modelGroups.map(group=><optgroup key={group.provider} label={group.label}>{group.options.map(({service,id,label})=><option key={id} value={id}>{label}{group.connections.length>1?` · ${connectionLabel(service)}`:''}</option>)}</optgroup>)}
   </NativeSelect>
  </div>
  {selectedService&&selectedModel&&<>
   {selectedModel.length>36&&<span className="workspace-selected-model">{selectedModel}</span>}
   <small>连接：{selectedService.connectionName??selectedService.label} · {selectedService.provider} · v{selectedService.connectionVersion??'—'}</small>
  </>}
  {unavailable?<small role="status">{unavailable}</small>:!availableServices.length?<small>暂无可用{kind}模型。</small>:selection&&!selectedService&&<small>原选择不可用，请重新选择模型。</small>}
 </div>;
}
