import {useState} from 'react';
import type {ProductionWorkspace} from '../productionWorkspace';
import type {OpenChatCutProject} from '../worker/openchatcutProject';
import {readWorkspaceShots} from '../workspaceShots';
import {readWorkspaceAudioMix,isWorkspaceItemAudible} from '../workspaceAudio';
import {shotCaptionAnchorLabels,shotCaptionSafeAreaLabels,shotCaptionSafeAreaInsets} from '../shotCaptions';
import {WorkbenchVideoPlayer} from '../operations/WorkbenchVideoPlayer';
import {WorkspaceShotPreview} from './WorkspaceShotPreview';

const propertyNames:Record<string,string>={x:'水平位置',y:'垂直位置',scale:'缩放',scaleX:'水平缩放',scaleY:'垂直缩放',rotation:'旋转',opacity:'透明度'};
const seconds=(value:number)=>`${value.toFixed(2)} s`;
function Facts({values}:{values:Array<[string,string|number]>}){return <dl className="workspace-saved-facts">{values.map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>;}
function ShotMovie({url,start,end,title,fps}:{url:string;start:number;end:number;title:string;fps:number}){
 const [failed,setFailed]=useState(false);
 return failed?<p role="alert">成片预览未能加载，请在检查与交付中重试。</p>:<WorkbenchVideoPlayer source={url} title={title} segment={{start,end,frameDuration:1/fps}} onError={()=>setFailed(true)}/>;
}
function OriginalPreview({workspace,clips,project}:{workspace:ProductionWorkspace;clips:ProductionWorkspace['clips'];project:OpenChatCutProject|null}){
 const [selected,setSelected]=useState(clips[0]?.itemId);
 return <WorkspaceShotPreview workspace={workspace} clips={clips} project={project} selectedItemId={selected} onSelect={setSelected}/>;
}
/** The immutable confirmed render shows the combined result; the native document owns settings. */
export function WorkspaceCompletedShots({workspace:w,project,materials=[]}:{workspace:ProductionWorkspace;project:OpenChatCutProject|null;materials?:Array<{storage_path:string;source_path:string}>}){
 const groups=project?readWorkspaceShots(project):w.clips.filter((c,i,a)=>a.findIndex(v=>v.shotId===c.shotId)===i).map(c=>({id:c.shotId,text:c.text,timelineId:'',itemIds:w.clips.filter(v=>v.shotId===c.shotId).map(v=>v.itemId),startFrame:0,durationInFrames:0}));
 const mix=project?readWorkspaceAudioMix(project,Object.fromEntries(groups.map(s=>[s.id,s.itemIds]))):w.audio?.mix;
 const exported=w.exports?.find(e=>e.current&&e.confirmed&&e.artifact),movie=exported?.artifact;
 const url=movie?`/_local-artifact?${new URLSearchParams({episode:w.episodeId,path:movie.relativePath,sha256:movie.sha256})}`:null;
 return <div className="workspace-completed-shots">{groups.map(shot=>{
  const timeline=project?.timelines.find(t=>t.id===shot.timelineId),fps=timeline?.fps??30,start=shot.startFrame/fps,end=(shot.startFrame+shot.durationInFrames)/fps;
  const items=timeline?.items.filter(i=>shot.itemIds.includes(String(i.id)))??[],clips=w.clips.filter(c=>c.shotId===shot.id),caption=w.captions?.find(c=>c.shotId===shot.id),voice=mix?.voices.find(v=>v.shotId===shot.id),narration=w.narration?.find(n=>n.shotId===shot.id);
  const usedVoice=w.usedNarration?.find(n=>n.shotId===shot.id),narrationMatches=!!usedVoice&&(narration?.adoptedAudioTrackId===usedVoice.audioTrackId||narration?.audioTrackId===usedVoice.audioTrackId);
  const sounds=mix?.sounds.filter(s=>s.startSeconds<end&&s.startSeconds+s.durationSeconds>start)??[];
  const combined=!!url&&!!timeline&&timeline.id===project?.activeTimelineId&&end>start;
  return <article className="workspace-completed-shot" key={shot.timelineId+shot.id} aria-label={`${shot.id} 镜头配置`}>
   <header><h4>{shot.id}</h4><p>{shot.text}</p>{timeline&&<span>{seconds(start)}–{seconds(end)} · {seconds(end-start)}</span>}</header>
   <div className="workspace-completed-shot-layout"><div className="workspace-completed-shot-preview">
    <h5>{combined?'成片镜头预览':'原素材预览'}</h5>{combined?<ShotMovie key={url+start+end} url={url!} start={start} end={end} fps={fps} title={`${shot.id} 成片`}/>:<OriginalPreview workspace={w} clips={clips} project={project}/>}
    {!combined&&<p className="workspace-saved-empty">{project?'当前没有可对应的已确认成片，原素材不包含最终混音和字幕。':'正在读取已保存工程，镜头时长与预览就绪后显示。'}</p>}
   </div><div className="workspace-completed-shot-properties">
    <section aria-label={`${shot.id} 画面属性`}><h5>画面</h5>{timeline&&<Facts values={[
     ['画布',`${timeline.width} × ${timeline.height} · ${fps} fps`],['片段数量',items.length],
    ]}/>}{items.map((item,index)=>{const transform=item.transform as Record<string,unknown>|undefined,clip=clips.find(c=>c.itemId===item.id),fit=String(item.fit??timeline?.fit??'cover');return <div className="workspace-completed-visual" key={String(item.id)}><strong>片段 {index+1} · {item.kind==='image'?'图片':item.kind==='video'?'视频':'占位画面'}</strong><Facts values={[
     ['素材',(materials.find(m=>m.storage_path===item.src)?.source_path??project?.assets.find(a=>a.id===item.sourceAssetId)?.name??String(item.src??'尚未匹配')).split('/').pop()!],['时间线',`${seconds(Number(item.startFrame)/fps)}–${seconds((Number(item.startFrame)+Number(item.durationInFrames))/fps)}`],
     ['素材区间',item.kind==='image'?'静态图片':`${seconds(Number(item.srcInFrame??0)/fps)}–${seconds((Number(item.srcInFrame??0)+Number(item.durationInFrames)*Number(item.playbackRate??1))/fps)}`],['播放速度',`${Number(item.playbackRate??1)} ×`],['淡入／淡出',`${seconds(Number(item.fadeInFrames??0)/fps)} / ${seconds(Number(item.fadeOutFrames??0)/fps)}`],['片段原声',item.kind!=='video'?'无音轨':isWorkspaceItemAudible(item,timeline!)?`${(20*Math.log10(Number(item.volume??1))).toFixed(1)} dB`:'静音'],['填充方式',fit==='contain'?'完整显示':'填满画布'],
     ...(clip?.image?[['图片用法',clip.image.usage==='pan-zoom'?'轻微推拉':clip.image.usage==='ai-video'?'图生视频':'静帧'],['焦点',`${clip.image.focusX} / ${clip.image.focusY}`]] as Array<[string,string]>:[]),
     ...(transform?Object.entries(transform).filter(([,v])=>typeof v==='number'||typeof v==='string').map(([k,v])=>[propertyNames[k]??k,String(v)] as [string,string]):[]),
    ]}/>{!!item.keyframes&&Object.entries(item.keyframes as Record<string,Array<{frame:number;value:number;easing?:string}>>).filter(([,keys])=>Array.isArray(keys)&&keys.length).map(([property,keys])=><table key={property} aria-label={`${shot.id} 片段 ${index+1} ${propertyNames[property]??property}关键帧`}><thead><tr><th>{propertyNames[property]??property}关键帧（帧）</th><th>值／插值</th></tr></thead><tbody>{keys.map((key,i)=><tr key={i}><td>{key.frame}</td><td>{key.value} · {key.easing??'默认'}</td></tr>)}</tbody></table>)}{timeline?.transitions.filter(t=>t.fromId===item.id||t.toId===item.id||t.fromItemId===item.id||t.toItemId===item.id).map((t,i)=><p key={i}>转场：{String(t.type??t.kind??'已设置')} · {seconds(Number(t.durationInFrames??0)/fps)}</p>)}</div>;})}{!items.length&&<p>暂无可读取的画面配置。</p>}</section>
    <section aria-label={`${shot.id} 声音属性`}><h5>声音</h5><Facts values={[
     ['主声音',!voice||voice.mode==='none'?'无主声':voice.mode==='tts'?'口播':'原片声音'],['主声音量',voice&&voice.mode!=='none'?`${voice.gainDb} dB`:'—'],['环境声',voice?.ambienceGainDb!=null?`${voice.ambienceGainDb} dB`:'关闭'],
     ...(voice?.durationSeconds!=null?[['主声区间',`${seconds(voice.startSeconds??0)}–${seconds((voice.startSeconds??0)+voice.durationSeconds)}`],['源音频起点',seconds(voice.sourceStartSeconds??0)],['覆盖范围',voice.coverage==='partial'?'部分镜头':voice.coverage==='full'?'完整镜头':'无']] as Array<[string,string]>:[]),
     ...(voice?.sourceLabel?[['原声来源',voice.sourceLabel]] as Array<[string,string]>:[]),
    ]}/>{voice?.mode==='tts'&&usedVoice?.text&&<p>{usedVoice.fullSourceUsed?'口播正文':'源口播正文（局部使用）'}：{usedVoice.text}</p>}{voice?.mode==='tts'&&narrationMatches&&narration&&<><Facts values={[
     ['配音模式',narration.mode==='tts'?'在线配音':'上传口播'],['音色',narration.voice??'未记录'],['语速',narration.speakingRate??'默认'],['语言',narration.languageCode??'默认'],...(narration.selection?.model?[['模型',narration.selection.model]] as Array<[string,string]>:[]),
    ]}/></>}
    {sounds.map(sound=>{const item=timeline?.items.find(i=>i.id===sound.itemId),preparation=w.audio?.preparations.find(p=>p.adoptedItemId===sound.itemId);return <div key={sound.itemId}><strong>{sound.kind==='bgm'?'配乐':'音效'} · {preparation?.description??String(item?.name??item?.src??sound.itemId).split('/').pop()}</strong><Facts values={[
     ['时间线区间',`${seconds(sound.startSeconds)}–${seconds(sound.startSeconds+sound.durationSeconds)}`],['本镜播放区间',`${seconds(Math.max(start,sound.startSeconds)-start)}–${seconds(Math.min(end,sound.startSeconds+sound.durationSeconds)-start)}`],['音量',`${sound.gainDb} dB`],['主声闪避',`${sound.duckDepthDb} dB`],['状态',item&&timeline&&!isWorkspaceItemAudible(item,timeline)?'已静音':'参与混音'],['素材起点',seconds(Number(item?.srcInFrame??0)/fps)],['播放速度',`${Number(item?.playbackRate??1)} ×`],['淡入／淡出',`${seconds(Number(item?.fadeInFrames??0)/fps)} / ${seconds(Number(item?.fadeOutFrames??0)/fps)}`],
    ]}/></div>;})}{!sounds.length&&<p className="workspace-saved-empty">本镜无配乐或音效</p>}</section>
    <section aria-label={`${shot.id} 字幕属性`}><h5>字幕</h5>{caption?<><p className="workspace-saved-caption" aria-label={`${shot.id} 字幕正文`}>{caption.contract.text||'未设置字幕正文'}</p><Facts values={[
     ['模式',!caption.contract.enabled?'关闭':caption.contract.contentMode==='follow_tts'?'跟随口播':'独立字幕'],['位置',shotCaptionAnchorLabels[caption.contract.spatial.anchor]],['安全区',shotCaptionSafeAreaLabels[caption.contract.spatial.safeArea]],['排版',`${caption.contract.spatial.maxLines} 行 · 每行 ${caption.contract.spatial.maxCharactersPerLine} 字`],['正文核对',caption.textConfirmed?'已核对':'未核对'],['时序',({current:'有效',missing:'缺少',stale:'已过期',waiting:'等待',failed:'失败'})[caption.timing]],
     ...Object.entries(shotCaptionSafeAreaInsets(caption.contract.spatial)).map(([k,v])=>[`${({top:'上',right:'右',bottom:'下',left:'左'} as Record<string,string>)[k]}边距`,`${Math.round(v*100)}%`] as [string,string]),
    ]}/>{caption.contract.cues.length>0&&<table aria-label={`${shot.id} 字幕时序`}><thead><tr><th>开始／结束（镜头内）</th><th>字幕</th></tr></thead><tbody>{caption.contract.cues.map(c=><tr key={c.id}><td>{seconds(c.startMs/1000)}–{seconds(c.endMs/1000)}</td><td>{c.text}</td></tr>)}</tbody></table>}{caption.detail&&<p role="alert">{caption.detail}</p>}</>:<p>未设置字幕</p>}</section>
   </div></div>
  </article>;
 })}</div>;
}
