import {uiText} from '../i18n/ui';
import {workspaceDisplayNumber} from './workspaceDisplayNumber';
import {useState} from 'react';
import type {ProductionWorkspace} from '../productionWorkspace';
import type {OpenChatCutProject} from '../worker/openchatcutProject';
import {readWorkspaceShots} from '../workspaceShots';
import {readWorkspaceAudioMix,isWorkspaceItemAudible} from '../workspaceAudio';
import {shotCaptionAnchorLabels,shotCaptionSafeAreaLabels,shotCaptionSafeAreaInsets} from '../shotCaptions';
import {VideoPreview} from '../ui/media/VideoPreview';
import {WorkspaceShotPreview} from './WorkspaceShotPreview';

const propertyNames:Record<string,string>={get x(){return uiText("水平位置");},get y(){return uiText("垂直位置");},get scale(){return uiText("缩放");},get scaleX(){return uiText("水平缩放");},get scaleY(){return uiText("垂直缩放");},get rotation(){return uiText("旋转");},get opacity(){return uiText("透明度");}};
const seconds=(value:number)=>`${value.toFixed(2)} s`;
function Facts({values}:{values:Array<[string,string|number]>}){return <dl className="workspace-saved-facts">{values.map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>;}
function ShotMovie({url,start,end,title,fps}:{url:string;start:number;end:number;title:string;fps:number}){
 return <VideoPreview src={url} title={title} aria-label={title} sourceLabel={uiText("成片")} segment={{start,end,frameDuration:1/fps}}/>;
}
function OriginalPreview({workspace,clips,project}:{workspace:ProductionWorkspace;clips:ProductionWorkspace['clips'];project:OpenChatCutProject|null}){
 const [selected,setSelected]=useState(clips[0]?.itemId);
 return <WorkspaceShotPreview workspace={workspace} clips={clips} project={project} readOnly selectedItemId={selected} onSelect={setSelected}/>;
}
/** The immutable confirmed render shows the combined result; the native document owns settings. */
export function WorkspaceCompletedShots({workspace:w,project,materials=[]}:{workspace:ProductionWorkspace;project:OpenChatCutProject|null;materials?:Array<{storage_path:string;source_path:string}>}){
 const [previewShot,setPreviewShot]=useState<string|null>(null);
 const groups=project?readWorkspaceShots(project):w.clips.filter((c,i,a)=>a.findIndex(v=>v.shotId===c.shotId)===i).map(c=>({id:c.shotId,text:c.text,timelineId:'',itemIds:w.clips.filter(v=>v.shotId===c.shotId).map(v=>v.itemId),startFrame:0,durationInFrames:0}));
 const mix=project?readWorkspaceAudioMix(project,Object.fromEntries(groups.map(s=>[s.id,s.itemIds]))):w.audio?.mix;
 const exported=w.exports?.find(e=>e.current&&e.confirmed&&e.artifact),movie=exported?.artifact;
 const url=movie?`/_local-artifact?${new URLSearchParams({episode:w.episodeId,path:movie.relativePath,sha256:movie.sha256})}`:null;
 return <div className="workspace-completed-shots">{groups.map(shot=>{
  const timeline=project?.timelines.find(t=>t.id===shot.timelineId),fps=timeline?.fps??30,start=shot.startFrame/fps,end=(shot.startFrame+shot.durationInFrames)/fps;
  const items=timeline?.items.filter(i=>shot.itemIds.includes(String(i.id)))??[],clips=w.clips.filter(c=>c.shotId===shot.id),caption=w.captions?.find(c=>c.shotId===shot.id),voice=mix?.voices.find(v=>v.shotId===shot.id),narration=w.narration?.find(n=>n.shotId===shot.id);
  const usedVoice=w.usedNarration?.find(n=>n.shotId===shot.id),speech=usedVoice?(w.candidates?.find(c=>c.kind==='audio'&&c.sha256===usedVoice.sha256&&(c.audioTrackId===usedVoice.audioTrackId||c.taskId===usedVoice.taskId))?.speech??(usedVoice.taskId&&narration?.execution?.taskId===usedVoice.taskId?narration.execution:undefined)):undefined;
  const sounds=mix?.sounds.filter(s=>s.startSeconds<end&&s.startSeconds+s.durationSeconds>start)??[];
  const combined=!!url&&!!timeline&&timeline.id===project?.activeTimelineId&&end>start;
  return <article className="workspace-completed-shot" key={shot.timelineId+shot.id} aria-label={uiText("{value0} 镜头配置",{value0:String(shot.id)})}>
   <header><h4>{shot.id}</h4><p>{shot.text}</p>{timeline&&<span>{seconds(start)}–{seconds(end)} · {seconds(end-start)}</span>}</header>
   <div className="workspace-completed-shot-layout"><div className="workspace-completed-shot-preview">
    <h5>{combined?uiText("成片镜头预览"):uiText("原素材预览")}</h5><button className="workspace-shot-preview-toggle" type="button" aria-label={uiText("{value0} {value1} 预览",{value0:String(previewShot===shot.id?'收起':'展开'),value1:String(shot.id)})} aria-expanded={previewShot===shot.id} onClick={()=>setPreviewShot(previewShot===shot.id?null:shot.id)}>{previewShot===shot.id?uiText("收起预览"):uiText("展开预览")}</button>{previewShot===shot.id&&(combined?<ShotMovie key={url+start+end} url={url!} start={start} end={end} fps={fps} title={uiText("{value0} 成片",{value0:String(shot.id)})}/>:<OriginalPreview workspace={w} clips={clips} project={project}/>)}
    {!combined&&<p className="workspace-saved-empty">{project?uiText("当前没有可对应的已确认成片，原素材不包含最终混音和字幕。"):uiText("尚未读取到已保存工程，镜头时长与最终配置暂不可核对。")}</p>}
   </div><div className="workspace-completed-shot-properties">
    <section aria-label={uiText("{value0} 画面属性",{value0:String(shot.id)})}><h5>{uiText("画面")}</h5>{timeline&&<Facts values={[
     ['画布',`${timeline.width} × ${timeline.height} · ${fps} fps`],['片段数量',items.length],
    ]}/>}{items.map((item,index)=>{const transform=item.transform as Record<string,unknown>|undefined,clip=clips.find(c=>c.itemId===item.id),fit=String(item.fit??timeline?.fit??'cover');return <div className="workspace-completed-visual" key={String(item.id)}><strong>{uiText("片段 ")}{index+1} · {item.kind==='image'?uiText("图片"):item.kind==='video'?uiText("视频"):uiText("占位画面")}</strong><Facts values={[
     ['素材',(materials.find(m=>m.storage_path===item.src)?.source_path??project?.assets.find(a=>a.id===item.sourceAssetId)?.name??String(item.src??'尚未匹配')).split('/').pop()!],['时间线',`${seconds(Number(item.startFrame)/fps)}–${seconds((Number(item.startFrame)+Number(item.durationInFrames))/fps)}`],
     ['素材区间',item.kind==='image'?'静态图片':`${seconds(Number(item.srcInFrame??0)/fps)}–${seconds((Number(item.srcInFrame??0)+Number(item.durationInFrames)*Number(item.playbackRate??1))/fps)}`],...(item.kind==='video'?[['播放速度',`${workspaceDisplayNumber(Number(item.playbackRate??1))} ×`]] as Array<[string,string]>:[]),['淡入／淡出',`${seconds(Number(item.fadeInFrames??0)/fps)} / ${seconds(Number(item.fadeOutFrames??0)/fps)}`],...(item.kind==='video'?[['片段原声',isWorkspaceItemAudible(item,timeline!)?`${(20*Math.log10(Number(item.volume??1))).toFixed(1)} dB`:'静音']] as Array<[string,string]>:[]),['填充方式',fit==='contain'?'完整显示':'填满画布'],
     ...(item.kind==='image'&&clip?.image?[['图片用法',clip.image.usage==='pan-zoom'?'轻微推拉':clip.image.usage==='ai-video'?'图生视频':'静帧'],['焦点',`${workspaceDisplayNumber(clip.image.focusX)} / ${workspaceDisplayNumber(clip.image.focusY)}`]] as Array<[string,string]>:[]),
     ...(transform?Object.entries(transform).filter(([,v])=>typeof v==='number'||typeof v==='string').map(([k,v])=>[propertyNames[k]??k,typeof v==='number'?workspaceDisplayNumber(v):String(v)] as [string,string]):[]),
    ]}/>{!!item.keyframes&&Object.entries(item.keyframes as Record<string,Array<{frame:number;value:number;easing?:string}>>).filter(([,keys])=>Array.isArray(keys)&&keys.length).map(([property,keys])=><table key={property} aria-label={uiText("{value0} 片段 {value1} {value2}关键帧",{value0:String(shot.id),value1:String(index+1),value2:String(propertyNames[property]??property)})}><thead><tr><th>{propertyNames[property]??property}{uiText("关键帧（帧）")}</th><th>{uiText("值／插值")}</th></tr></thead><tbody>{keys.map((key,i)=><tr key={i}><td>{key.frame}</td><td>{workspaceDisplayNumber(key.value)} · {key.easing??uiText("默认")}</td></tr>)}</tbody></table>)}{timeline?.transitions.filter(t=>t.fromId===item.id||t.toId===item.id||t.fromItemId===item.id||t.toItemId===item.id).map((t,i)=><p key={i}>{uiText("转场：")}{String(t.type??t.kind??'已设置')} · {seconds(Number(t.durationInFrames??0)/fps)}</p>)}</div>;})}{!items.length&&<p>{uiText("暂无可读取的画面配置。")}</p>}</section>
    <section aria-label={uiText("{value0} 声音属性",{value0:String(shot.id)})}><h5>{uiText("声音")}</h5><Facts values={[
     ['主声音',!voice||voice.mode==='none'?'无主声':voice.mode==='tts'?'口播':'原片声音'],['主声音量',voice&&voice.mode!=='none'?`${workspaceDisplayNumber(voice.gainDb,1)} dB`:'—'],['环境声',voice?.ambienceGainDb!=null?`${workspaceDisplayNumber(voice.ambienceGainDb,1)} dB`:'关闭'],
     ...(voice?.durationSeconds!=null?[['主声区间',`${seconds(voice.startSeconds??0)}–${seconds((voice.startSeconds??0)+voice.durationSeconds)}`],['源音频起点',seconds(voice.sourceStartSeconds??0)],['覆盖范围',voice.coverage==='partial'?'部分镜头':voice.coverage==='full'?'完整镜头':'无']] as Array<[string,string]>:[]),
     ...(voice?.sourceLabel?[['原声来源',voice.sourceLabel]] as Array<[string,string]>:[]),
    ]}/>{voice?.mode==='tts'&&usedVoice?.text&&<p>{usedVoice.fullSourceUsed?uiText("口播正文"):uiText("源口播正文（局部使用）")}：{usedVoice.text}</p>}{voice?.mode==='tts'&&speech&&<><Facts values={[
     ['配音模式','在线配音'],['音色',speech.voice],['语速',workspaceDisplayNumber(speech.speakingRate)],['语言',speech.languageCode],...(speech.selection?.model?[['模型',speech.selection.model]] as Array<[string,string]>:[]),
    ]}/></>}
    {sounds.map(sound=>{const item=timeline?.items.find(i=>i.id===sound.itemId),preparation=w.audio?.preparations.find(p=>p.adoptedItemId===sound.itemId);return <div key={sound.itemId}><strong>{sound.kind==='bgm'?uiText("配乐"):uiText("音效")} · {preparation?.description??String(item?.name??item?.src??sound.itemId).split('/').pop()}</strong><Facts values={[
     ['时间线区间',`${seconds(sound.startSeconds)}–${seconds(sound.startSeconds+sound.durationSeconds)}`],['本镜播放区间',`${seconds(Math.max(start,sound.startSeconds)-start)}–${seconds(Math.min(end,sound.startSeconds+sound.durationSeconds)-start)}`],['音量',`${workspaceDisplayNumber(sound.gainDb,1)} dB`],['主声闪避',`${workspaceDisplayNumber(sound.duckDepthDb,1)} dB`],['状态',item&&timeline&&!isWorkspaceItemAudible(item,timeline)?'已静音':'参与混音'],['素材起点',seconds(Number(item?.srcInFrame??0)/fps)],['播放速度',`${workspaceDisplayNumber(Number(item?.playbackRate??1))} ×`],['淡入／淡出',`${seconds(Number(item?.fadeInFrames??0)/fps)} / ${seconds(Number(item?.fadeOutFrames??0)/fps)}`],
    ]}/></div>;})}{!sounds.length&&<p className="workspace-saved-empty">{uiText("本镜无配乐或音效")}</p>}</section>
    <section aria-label={uiText("{value0} 字幕属性",{value0:String(shot.id)})}><h5>{uiText("字幕")}</h5>{caption?<><p className="workspace-saved-caption" aria-label={uiText("{value0} 字幕正文",{value0:String(shot.id)})}>{caption.contract.text||uiText("未设置字幕正文")}</p><Facts values={[
     ['模式',!caption.contract.enabled?'关闭':caption.contract.contentMode==='follow_tts'?'跟随口播':'独立字幕'],['位置',shotCaptionAnchorLabels[caption.contract.spatial.anchor]],['安全区',shotCaptionSafeAreaLabels[caption.contract.spatial.safeArea]],['排版',`${caption.contract.spatial.maxLines} 行 · 每行 ${caption.contract.spatial.maxCharactersPerLine} 字`],['正文核对',caption.textConfirmed?'已核对':'未核对'],['时序',({current:'有效',missing:'缺少',stale:'已过期',waiting:'等待',failed:'失败'})[caption.timing]],
     ...Object.entries(shotCaptionSafeAreaInsets(caption.contract.spatial)).map(([k,v])=>[`${({top:'上',right:'右',bottom:'下',left:'左'} as Record<string,string>)[k]}边距`,`${Math.round(v*100)}%`] as [string,string]),
    ]}/>{caption.contract.cues.length>0&&<table aria-label={uiText("{value0} 字幕时序",{value0:String(shot.id)})}><thead><tr><th>{uiText("开始／结束（镜头内）")}</th><th>{uiText("字幕")}</th></tr></thead><tbody>{caption.contract.cues.map(c=><tr key={c.id}><td>{seconds(c.startMs/1000)}–{seconds(c.endMs/1000)}</td><td>{c.text}</td></tr>)}</tbody></table>}{caption.detail&&<p role="alert">{uiText(caption.detail)}</p>}</>:<p>{uiText("未设置字幕")}</p>}</section>
   </div></div>
  </article>;
 })}</div>;
}
