import {useId} from 'react';
import type {ProductionService} from '../connections/serviceCatalog';
import type {ProductionSelection} from '../productionSelection';
import type {StoryboardImageSettings} from '../storyboardBatch';
import {imageSizePresets,imageQualityLabels,imageSizes} from '../imageGeneration';
import {uiText} from '../i18n/ui';
import {NativeSelect} from '../ui/dan-ui/components/base/select/select-native';
import {WorkspaceGenerationModel} from './WorkspaceGenerationModel';
import {productionModelSelection} from './productionModelSelection';

export function StoryboardImageBatchSettings({value,services,disabled,onChange,onRefresh,refreshing}:{value:StoryboardImageSettings;services:ProductionService[];disabled:boolean;onChange:(value:StoryboardImageSettings)=>void;onRefresh:()=>void;refreshing:boolean}){
 const id=useId();
 const modelService=(selection:ProductionSelection|null|undefined)=>services.find(service=>service.connectionVersionId===selection?.connectionVersionId&&service.models.includes(selection?.model??''));
 const service=modelService(value.selection);
 const label=uiText('本次图片连接与模型');
 const select=(selection:ProductionSelection|null)=>{
  const constraints=modelService(selection)?.constraints;
  const {size,quality,count}=value.settings??{};
  onChange({...value,selection,settings:constraints?{
   size:size&&constraints.sizes?.includes(size)?size:undefined,
   quality:quality&&constraints.qualities?.includes(quality)?quality:undefined,
   count:count&&constraints.counts?.includes(count)?count:undefined,
  }:value.settings});
 };
 const sizes=imageSizes.filter(size=>!service||service.constraints.sizes?.includes(size));
 return <fieldset className="storyboard-batch-image-settings" disabled={disabled}>
  <legend className="sr-only">{uiText('本次共用图片设置')}</legend>
  <WorkspaceGenerationModel label={label} kind="图片" services={services} selection={value.selection} disabled={disabled}
   onChange={id=>select(productionModelSelection(services,id,'image'))} onSetupSelection={select} onRefresh={onRefresh} refreshing={refreshing} compact/>
  <div className="storyboard-batch-image-field is-size"><label htmlFor={id+'-size'}>{uiText('图片规格')}</label><NativeSelect id={id+'-size'} icon={null} size="sm" name="batchImageSize" value={value.settings?.size??''} onChange={event=>{
   const size=sizes.find(item=>item===event.target.value);
   onChange({...value,settings:{...value.settings,size}});
  }}>
   <option value="">{uiText('跟随工程尺寸')}</option>
   {sizes.map(size=><option key={size} value={size}>{uiText(imageSizePresets.find(p=>p.standard===size||p.high===size)?.label??size)} · {size.replace('x',' × ')}</option>)}
  </NativeSelect></div>
  <div className="storyboard-batch-image-field is-quality"><label htmlFor={id+'-quality'}>{uiText('质量')}</label><NativeSelect id={id+'-quality'} icon={null} size="sm" name="batchImageQuality" value={value.settings?.quality??'auto'} onChange={event=>{
   const quality=Object.keys(imageQualityLabels).find(item=>item===event.target.value) as keyof typeof imageQualityLabels|undefined;
   onChange({...value,settings:{...value.settings,quality}});
  }}>
   {Object.entries(imageQualityLabels).filter(([quality])=>!service||service.constraints.qualities?.includes(quality)).map(([quality,text])=><option key={quality} value={quality}>{uiText(text)}</option>)}
  </NativeSelect></div>
  <div className="storyboard-batch-image-field is-count"><label htmlFor={id+'-count'}>{uiText('每镜张数')}</label><NativeSelect id={id+'-count'} icon={null} size="sm" name="batchImageCount" value={value.settings?.count??1} onChange={event=>{
   const count=([1,2,4] as const).find(item=>String(item)===event.target.value);
   onChange({...value,settings:{...value.settings,count}});
  }}>
   {[1,2,4].filter(count=>!service||service.constraints.counts?.includes(count)).map(count=><option key={count} value={count}>{count}</option>)}
  </NativeSelect></div>
 </fieldset>;
}
