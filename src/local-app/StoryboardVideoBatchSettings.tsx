import type {ProductionService} from '../connections/serviceCatalog';
import type {ProductionSelection} from '../productionSelection';
import type {StoryboardVideoSettings} from '../storyboardBatch';
import {uiText} from '../i18n/ui';
import {defaultWanModelSettings,wanVideoModel} from '../wanVideoModels';
import {minimaxVideoModels} from '../worker/videoProviderCatalog';
import {NativeSelect} from '../ui/dan-ui/components/base/select/select-native';
import {WorkspaceGenerationModel} from './WorkspaceGenerationModel';
import {productionModelSelection} from './productionModelSelection';

export function StoryboardVideoBatchSettings({value,services,disabled,onChange,onRefresh,refreshing}:{value:StoryboardVideoSettings;services:ProductionService[];disabled:boolean;onChange:(value:StoryboardVideoSettings)=>void;onRefresh:()=>void;refreshing:boolean}){
 const {selection}=value,wan=selection?.provider==='bailian'?wanVideoModel(selection.model??''):undefined;
 const wanSettings=wan?value.videoSettings??defaultWanModelSettings(selection?.model??''):undefined;
 const resolutions=selection?.provider==='minimax'?minimaxVideoModels[selection.model??'']?.resolutions:undefined;
 function select(next:ProductionSelection|null){
  onChange({...value,selection:next,videoSettings:undefined,videoResolution:undefined});
 }
 return <fieldset className="storyboard-batch-video-settings" disabled={disabled}>
  <legend className="sr-only">{uiText('本次共用视频设置')}</legend>
  <div className="storyboard-batch-model-field">
   <span>{uiText('模型')}</span>
   <WorkspaceGenerationModel label={uiText('本次视频连接与模型')} kind="视频" services={services} selection={selection} disabled={disabled} onChange={id=>select(productionModelSelection(services,id,'video'))} onSetupSelection={select} onRefresh={onRefresh} refreshing={refreshing} compact/>
  </div>
  <label>{uiText('生成时长（秒，选填）')}<input name="durationSeconds" type="number" min="1" max="3600" step="1" value={value.durationSeconds??''} onChange={event=>onChange({...value,durationSeconds:event.target.value===''?undefined:event.target.valueAsNumber})}/></label>
  <label>{uiText('每镜费用预留（分，选填）')}<input name="reservationCents" type="number" min="1" max="100000" step="1" value={value.reservationCents??''} onChange={event=>onChange({...value,reservationCents:event.target.value===''?undefined:event.target.valueAsNumber})}/></label>
  {wan&&wanSettings&&<>
   <label>{uiText('视频分辨率')}<NativeSelect size="sm" name="wanResolution" value={wanSettings.resolution} disabled={disabled} onChange={event=>onChange({...value,videoSettings:{...wanSettings,resolution:event.target.value as typeof wanSettings.resolution}})}>{wan.resolutions.map(resolution=><option key={resolution}>{resolution}</option>)}</NativeSelect></label>
   {wan.audio==='optional'&&<label className="storyboard-batch-video-sound"><input name="videoSound" type="checkbox" checked={wanSettings.audio} onChange={event=>onChange({...value,videoSettings:{...wanSettings,audio:event.target.checked}})}/>{uiText('生成视频声音')}</label>}
  </>}
  {resolutions&&<label>{uiText('视频分辨率')}<NativeSelect name="videoResolution" size="sm" value={value.videoResolution??'768P'} disabled={disabled} onChange={event=>onChange({...value,videoResolution:event.target.value})}>{resolutions.map(resolution=><option key={resolution}>{resolution}</option>)}</NativeSelect></label>}
 </fieldset>;
}
