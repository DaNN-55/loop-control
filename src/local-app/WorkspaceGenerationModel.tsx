import {providerDisplayNames,type ProductionService} from '../connections/serviceCatalog';
import type {ProductionSelection} from '../productionSelection';
import {WorkspaceModelPicker} from './WorkspaceModelPicker';
import './workspace-generation-form.css';

export function WorkspaceGenerationModel({kind,services,selection,disabled,onChange,compact=false}:{kind:'图片'|'视频';services:ProductionService[];selection?:ProductionSelection|null;disabled?:boolean;onChange:(value:string)=>void;compact?:boolean}){
 const availableServices=services.filter(service=>service.executable&&(service.mode==='search'&&service.provider==='pexels'&&service.adapter==='pexels_video'||service.models.length>0));
 const selectedModel=selection?.model;
 const selectedService=availableServices.find(service=>
  service.connectionVersionId===selection?.connectionVersionId&&service.provider===selection?.provider&&
  service.adapter===selection?.adapter&&(service.mode==='search'?!selectedModel:!!selectedModel&&service.models.includes(selectedModel))
 );
 const modelOptions=availableServices.flatMap(service=>service.mode==='search'
  ?[{service,id:`${service.id}:search`,label:'Pexels 素材检索'}]
  :service.models.map(model=>({service,id:`${service.id}:${model}`,label:model})));
 const connectionLabel=(service:ProductionService)=>`${service.connectionName??service.label} · v${service.connectionVersion??'—'}`;
 const value=selectedService?`${selectedService.id}:${selectedService.mode==='search'?'search':selectedModel}`:'';
 const unavailable=kind==='图片'&&!availableServices.length
  ?(services.find(service=>service.connectionVersionId===selection?.connectionVersionId)||services.find(service=>service.connectionVersionId&&service.status==='verified'))?.unavailableReason
  :null;
 const picker=<WorkspaceModelPicker label={`${kind}连接与模型`} title={`选择${kind}模型`} searchLabel={`筛选${kind}模型`} compact={compact} options={modelOptions.map(({service,id,label})=>({id,label,provider:service.provider,connection:connectionLabel(service),searchText:providerDisplayNames[service.provider]??service.provider}))} value={value} disabled={disabled||(!compact&&kind==='图片'&&!availableServices.length)} onChange={onChange} empty={unavailable??`暂无可用${kind}模型。`} clear={!!selection}/>;
 if(compact)return picker;
 return <div className="workspace-generation-model">
  <div className="workspace-generation-field-row"><span>模型</span>{picker}</div>
  {selectedService&&selectedModel&&<>
   {selectedModel.length>36&&<span className="workspace-selected-model">{selectedModel}</span>}
   <small>连接：{selectedService.connectionName??selectedService.label} · {selectedService.provider} · v{selectedService.connectionVersion??'—'}</small>
  </>}
  {unavailable?<small role="status">{unavailable}</small>:!availableServices.length?<small>暂无可用{kind}模型。</small>:selection&&!selectedService&&<small>原选择不可用，请重新选择模型。</small>}
 </div>;
}
