import './workspace-production-records.css';
import type {ProductionWorkspace} from '../productionWorkspace';
import type {OpenChatCutProject} from '../worker/openchatcutProject';
import {readWorkspaceAudioMix} from '../workspaceAudio';
import {workspaceDisplayNumber} from './workspaceDisplayNumber';
import {AudioPreview} from '../ui/media/AudioPreview';

export function WorkspaceNarrationRecord({workspace:w,selectedShotId}:{workspace:ProductionWorkspace;selectedShotId?:string}){
 const ids=[...new Set(w.clips.map(c=>c.shotId))].filter(id=>!selectedShotId||id===selectedShotId);
 return <section className="workspace-narration workspace-production-records" aria-label="口播制作记录"><h3>口播制作记录</h3>{ids.map(shotId=>{
 const used=w.usedNarration?.find(n=>n.shotId===shotId),n=w.narration?.find(n=>n.shotId===shotId),candidate=used?w.candidates?.find(c=>c.kind==='audio'&&c.sha256===used.sha256&&(c.audioTrackId===used.audioTrackId||c.taskId===used.taskId)):undefined;
 const execution=used?.taskId&&n?.execution?.taskId===used.taskId?n.execution:undefined,speech=candidate?.speech??execution;
 return <article key={shotId} aria-label={`${shotId} 口播制作记录`}><h4>{shotId}</h4>{used?<><h5>当前采用口播</h5><p>{used.text??'此音轨未保留口播正文。'}</p><dl className="workspace-saved-facts"><div><dt>使用区间</dt><dd>{workspaceDisplayNumber(used.sourceInFrame/used.fps,2)}–{workspaceDisplayNumber((used.sourceInFrame+used.durationInFrames)/used.fps,2)} s</dd></div>{speech?<><div><dt>模型</dt><dd>{speech.selection.model}</dd></div><div><dt>声音</dt><dd>{speech.voice}</dd></div><div><dt>语言／语速</dt><dd>{speech.languageCode} / {workspaceDisplayNumber(speech.speakingRate)}</dd></div></>:<div><dt>生成参数</dt><dd>未记录，无法还原当时设置</dd></div>}</dl>{candidate&&<AudioPreview preload="none" aria-label={`${shotId} 已采用口播试听`} src={`/_local-artifact?${new URLSearchParams({episode:w.episodeId,path:candidate.relativePath,sha256:candidate.sha256})}`}/>}</>:<p>当前工程未采用口播。</p>}
 {n?.execution&&n.execution.taskId!==used?.taskId&&<details open={!used||undefined}><summary>最近生成请求（当前未采用）</summary><p>{n.execution.text}</p><dl className="workspace-saved-facts"><div><dt>模型</dt><dd>{n.execution.selection.model}</dd></div><div><dt>声音</dt><dd>{n.execution.voice}</dd></div><div><dt>语言／语速</dt><dd>{n.execution.languageCode} / {workspaceDisplayNumber(n.execution.speakingRate)}</dd></div><div><dt>原任务</dt><dd>{n.execution.taskId}</dd></div></dl></details>}
 {!used&&!n?.execution&&<p>未保留口播生成快照，无法还原当时设置。</p>}
 </article>;})}</section>;
}
export function WorkspaceAudioRecord({workspace:w,project,selectedShotId}:{workspace:ProductionWorkspace;project?:OpenChatCutProject|null;selectedShotId?:string}){
 const shots=Object.fromEntries([...new Set(w.clips.map(c=>c.shotId))].map(id=>[id,w.clips.filter(c=>c.shotId===id).map(c=>c.itemId)])),mix=project?readWorkspaceAudioMix(project,shots):w.audio?.mix;
 const records=(w.audio?.preparations??[]).filter(p=>!selectedShotId||p.kind==='bgm'||p.anchor==='absolute'||p.shotId===selectedShotId);
 return <section className="workspace-audio workspace-audio-readonly workspace-production-records" aria-label="配乐与声音制作记录"><h3>配乐与声音制作记录</h3>
 {records.map(p=>{const used=!!p.adoptedItemId&&(!!mix?.sounds.some(s=>s.itemId===p.adoptedItemId)||!!mix?.voices.some(v=>v.mode!=='none'&&v.sourceAssetId===`audio-track-${p.audioTrackId}`));return <article key={p.id}><h4>{p.description} · {used?'当前采用':'当前未采用'}</h4>{p.connection&&<dl className="workspace-saved-facts"><div><dt>原连接</dt><dd>{p.connection.name} v{p.connection.version}</dd></div>{p.query&&<div><dt>检索词</dt><dd>{p.query}</dd></div>}{p.selection?.model&&<div><dt>模型</dt><dd>{p.selection.model}</dd></div>}</dl>}{p.relativePath&&<AudioPreview aria-label={`${p.description}记录试听`} preload="none" src={`/_local-artifact?${new URLSearchParams({episode:w.episodeId,path:p.relativePath,...(p.sha256?{sha256:p.sha256}:{})})}`}/>}<p>{p.kind==='source'?'原片声音':p.source?.provider==='manual'?'导入音频':p.connection?'检索素材':'未记录来源'}{p.error?` · ${p.error}`:''}</p></article>;})}
 {!records.length&&<p>此工程未保留配乐与声音制作请求。</p>}
 {mix?.sounds.length?<table aria-label="已保存配乐与音效"><thead><tr><th>类型</th><th>时间线／时长</th><th>音量／遇人声降低</th></tr></thead><tbody>{mix.sounds.map(s=><tr key={s.itemId}><td>{s.kind==='bgm'?'配乐':'音效'}</td><td>{workspaceDisplayNumber(s.startSeconds,2)} s / {workspaceDisplayNumber(s.durationSeconds,2)} s</td><td>{workspaceDisplayNumber(s.gainDb,1)} dB / {workspaceDisplayNumber(s.duckDepthDb,1)} dB</td></tr>)}</tbody></table>:<p>当前工程没有配乐或音效。</p>}
 </section>;
}
