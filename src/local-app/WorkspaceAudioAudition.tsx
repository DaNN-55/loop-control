import {uiText} from '../i18n/ui';
import type {ComponentProps} from 'react';
import {AudioPreview} from '../ui/media/AudioPreview';
import './workspace-audio-audition.css';

/** Candidate players use the same controls as every other host preview. */
export function WorkspaceAudioAudition({label,showControls:_showControls=true,layout='compact',durationSeconds,...props}:ComponentProps<typeof AudioPreview>&{label:string;showControls?:boolean;layout?:'compact'|'bar';durationSeconds?:number}){
 return <div className="workspace-audio-audition workspace-audio-unified" data-layout={layout} data-media-visibility><AudioPreview {...props} durationSeconds={durationSeconds} playLabel={uiText("试听 {value0}",{value0:label})} pauseLabel={uiText("暂停 {value0}",{value0:label})} progressLabel={uiText("{value0} 播放进度",{value0:label})}/></div>;
}
