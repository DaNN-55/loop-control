import {useState} from 'react';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import {NativeSelect} from '../ui/dan-ui/components/base/select/select-native';
import type {WorkspaceAudioEdit} from '../workspaceAudio';
import type {ProductionWorkspace} from '../productionWorkspace';
import type {OpenChatCutProject} from '../worker/openchatcutProject';
type Sound=NonNullable<ProductionWorkspace['audio']>['mix']['sounds'][number];
export function WorkspaceAudioInstanceSettings({sound,workspaceId,project,shotId,shotItemIds,disabled,apply,onApplied}:{sound:Sound;workspaceId:string;project?:OpenChatCutProject|null;shotId?:string;shotItemIds:string[];disabled:boolean;apply:(edit:WorkspaceAudioEdit)=>Promise<boolean>;onApplied:()=>void}){
 const timeline=project?.timelines.find(t=>t.items.some(i=>i.id===sound.itemId)),item=timeline?.items.find(i=>i.id===sound.itemId),meta=item?.loopControlAudio as {anchor?:string;shotId?:string}|undefined;
 const asset=project?.assets.find(a=>a.id===item?.sourceAssetId&&a.kind==='audio'),visuals=timeline?.items.filter(i=>shotItemIds.includes(String(i.id)))??[],shotStart=visuals.length?Math.min(...visuals.map(i=>Number(i.startFrame)))/(timeline?.fps??30):0;
 const [anchor,setAnchor]=useState<'absolute'|'shot'>(sound.kind==='sfx'&&meta?.anchor==='shot'?'shot':'absolute');
 const [offset,setOffset]=useState(Math.max(0,sound.startSeconds-(anchor==='shot'?shotStart:0))),[duration,setDuration]=useState(sound.durationSeconds),[gain,setGain]=useState(sound.gainDb),[duck,setDuck]=useState(sound.duckDepthDb);
 const canPlace=!!item&&!!asset&&!!timeline,rate=Number(item?.playbackRate??1),sourceAvailable=asset&&timeline?(asset.durationInFrames-Number(item?.srcInFrame??0))/timeline.fps/rate:undefined;
 async function save(){const ok=await apply({kind:'sound',workspaceId,itemId:sound.itemId,gainDb:gain,duckDepthDb:duck,...(canPlace?{placement:{anchor,...(shotId?{shotId}:{}),offsetSeconds:offset,durationSeconds:duration}}:{})});if(ok)onApplied();}
 return <div className="workspace-audio-instance-settings" data-kind={sound.kind}>
  {sound.kind==='sfx'&&<label>定位方式<NativeSelect aria-label="定位方式" size="sm" disabled={disabled||!canPlace} value={anchor} onChange={event=>{const next=event.target.value as 'absolute'|'shot';setOffset(Math.max(0,anchor===next?offset:next==='shot'?offset-shotStart:offset+shotStart));setAnchor(next);}}><option value="shot" disabled={!shotId||!visuals.length}>跟随镜头</option><option value="absolute">固定时间线</option></NativeSelect></label>}
  <label>{anchor==='shot'?'距镜头开头（秒）':'时间线位置（秒）'}<input aria-label="开始位置（秒）" type="number" min="0" step="0.1" disabled={disabled||!canPlace} value={offset} onChange={e=>setOffset(Number(e.target.value))}/></label>
  <label>使用时长（秒）<input aria-label="使用时长（秒）" type="number" min="0.1" max={sourceAvailable} step="0.1" disabled={disabled||!canPlace} value={duration} onChange={e=>setDuration(Number(e.target.value))}/></label>
  <label>音量（dB）<input aria-label="音量 dB" type="number" min="-60" max="12" disabled={disabled} value={gain} onChange={e=>setGain(Number(e.target.value))}/></label>
  <label>遇人声降低（dB）<input aria-label="遇人声降低（dB）" type="number" min="0" max="30" disabled={disabled} value={duck} onChange={e=>setDuck(Number(e.target.value))}/></label>
  <div className="workspace-audio-instance-submit"><Button size="sm" color="primary" isDisabled={disabled} onPress={()=>void save()}>应用设置</Button></div>
 </div>;
}
