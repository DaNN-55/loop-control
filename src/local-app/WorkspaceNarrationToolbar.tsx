import type {ReactNode} from 'react';
import {Gauge,Mic,Save} from 'lucide-react';
import {WorkspaceModelPicker} from './WorkspaceModelPicker';
import {InputBase} from '../ui/dan-ui/components/base/input/input';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import type {ProductionService} from '../connections/serviceCatalog';
import type {SpeechSettings as WorkspaceNarrationSettings} from './workspaceSettingsDraft';
export type {SpeechSettings as WorkspaceNarrationSettings} from './workspaceSettingsDraft';
import {productionModelSelection} from './productionModelSelection';
import {WorkspaceVoicePicker} from './WorkspaceVoicePicker';
import {WorkspaceSpeechSample} from './WorkspaceSpeechSample';
export function WorkspaceNarrationToolbar({mode,value,services,disabled,changed,onMode,onChange,onSave,children}:{mode:'tts'|'manual';value:WorkspaceNarrationSettings;services:ProductionService[];disabled:boolean;changed:boolean;onMode:(mode:'tts'|'manual')=>void;onChange:(value:WorkspaceNarrationSettings)=>void;onSave:()=>void;children:ReactNode}){
 const service=services.find(s=>s.connectionVersionId===value.selection?.connectionVersionId&&s.provider===value.selection?.provider&&s.adapter===value.selection?.adapter);
 const choice=service&&service.models.includes(value.selection?.model??'')?`${service.id}:${value.selection?.model}`:'';
 const voices=[...new Set(Object.values(service?.voiceCatalog??{}).flat())];
 const available=!!service?.executable&&voices.includes(value.voice)&&value.speakingRate>=(service.constraints.speakingRate?.min??.5)&&value.speakingRate<=(service.constraints.speakingRate?.max??2);
 return <div className="workspace-narration-composer-toolbar">
  <div className="workspace-narration-source"><Mic size={14} aria-hidden="true"/><WorkspaceModelPicker label="口播来源" title="选择语音模型" searchLabel="筛选语音模型" disabled={disabled} value={mode==='manual'?'manual':choice} options={[...services.flatMap(s=>s.models.map(model=>({id:`${s.id}:${model}`,label:model,provider:s.provider,connection:`${s.connectionName??s.label} · v${s.connectionVersion??'—'}`,disabled:!s.executable}))),{id:'manual',label:'人工口播',manual:true}]} onChange={id=>{
   if(id==='manual'){onMode('manual');return;}
   onMode('tts');const selection=productionModelSelection(services,id,'speech');
   const next=services.find(s=>s.connectionVersionId===selection?.connectionVersionId&&s.provider===selection?.provider&&s.adapter===selection?.adapter),catalog=next?.voiceCatalog??{};
   const voice=Object.values(catalog).flat().includes(value.voice)?value.voice:(catalog[value.languageCode]??Object.values(catalog)[0]??[])[0]??value.voice;
   const languageCode=catalog[value.languageCode]?.includes(voice)?value.languageCode:Object.entries(catalog).find(([,v])=>v.includes(voice))?.[0]??value.languageCode;
   onChange({...value,selection,voice,languageCode,speakingRate:Math.max(next?.constraints.speakingRate?.min??.5,Math.min(next?.constraints.speakingRate?.max??2,value.speakingRate))});
  }}/></div>
  {mode==='tts'&&<>
   <WorkspaceVoicePicker label="声音" disabled={disabled} provider={service?.provider??value.selection?.provider} value={value.voice} voices={voices} onChange={voice=>{const catalog=service?.voiceCatalog??{};onChange({...value,voice,languageCode:catalog[value.languageCode]?.includes(voice)?value.languageCode:Object.entries(catalog).find(([,v])=>v.includes(voice))?.[0]??value.languageCode});}}/>
   <div className="workspace-narration-rate" title="语速（倍速）"><InputBase aria-label="语速" icon={Gauge} size="sm" type="number" min={service?.constraints.speakingRate?.min??.5} max={service?.constraints.speakingRate?.max??2} step="0.05" isDisabled={disabled} value={String(value.speakingRate)} onChange={event=>onChange({...value,speakingRate:Number(event.target.value)})} wrapperClassName="workspace-narration-rate-control"/></div>
   <WorkspaceSpeechSample buttonColor="tertiary" label="" selection={value.selection} voice={value.voice} rate={value.speakingRate} disabled={disabled||!available||service?.provider!=='volcengine_tts'}/>
   {changed&&<Button size="sm" color="tertiary" iconLeading={Save} aria-label="保存口播设置" title="保存模型、音色和语速，供本期后续生成使用" isDisabled={disabled||!available} onPress={onSave}/>}
  </>}
  {mode==='tts'&&service?.executable&&!available&&<span className="workspace-narration-toolbar-error" role="alert">音色或语速与所选模型不兼容。</span>}
  {children}
 </div>;
}
