import {Mic,Upload,Video,VolumeX} from 'lucide-react';
import {uiText} from '../i18n/ui';
import {NativeSelect} from '../ui/dan-ui/components/base/select/select-native';
import type {WorkspaceMainVoiceMode} from './WorkspaceNarrationPanel';

const icons={none:VolumeX,source:Video,tts:Mic,manual:Upload};
export function WorkspaceMainVoicePicker({value,disabled,onChange}:{value:WorkspaceMainVoiceMode;disabled?:boolean;onChange:(value:WorkspaceMainVoiceMode)=>void}){
 return <NativeSelect className="workspace-main-voice-picker" size="sm" aria-label={uiText('主声音来源')} icon={icons[value]} optionIcons={icons} value={value} disabled={disabled} onChange={event=>onChange(event.target.value as WorkspaceMainVoiceMode)}>
  <option value="none">{uiText('无主声音')}</option><option value="source">{uiText('使用视频原声')}</option><option value="tts">{uiText('生成口播')}</option><option value="manual">{uiText('上传口播')}</option>
 </NativeSelect>;
}
