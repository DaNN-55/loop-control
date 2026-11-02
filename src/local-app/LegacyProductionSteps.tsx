import {AudioPreview} from '../ui/media/AudioPreview';
import {useEffect,useState,type ReactNode} from 'react';
import type {EpisodeProductionSnapshot} from '../episodes/EpisodeProductionContainer';
import type {OpenChatCutProject} from '../worker/openchatcutProject';
import {localArtifactUrl,artifactPreviewKind,useLocalArtifactBlob,useLocalArtifactText} from '../reviews/localArtifactPreview';
import {NativeSelect} from '../ui/dan-ui/components/base/select/select-native';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import {localRequest} from './client';
import './legacy-production.css';
import './legacy-production-compact.css';

type Artifact=EpisodeProductionSnapshot['artifacts'][number];
type Review=EpisodeProductionSnapshot['reviewPackages'][number];
const object=(value:unknown):Record<string,unknown>=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
const text=(value:unknown)=>typeof value==='string'?value:'';
const newest=(a:{created_at:string},b:{created_at:string})=>b.created_at.localeCompare(a.created_at);
const reviews=(snapshot:EpisodeProductionSnapshot,stage:string)=>snapshot.reviewPackages.filter(p=>p.stage===stage).sort((a,b)=>Number(!!a.invalidated_at)-Number(!!b.invalidated_at)||b.revision_number-a.revision_number||newest(a,b));
const uniqueArtifacts=(artifacts:Artifact[])=>artifacts.filter((a,index,all)=>all.findIndex(x=>x.relative_path===a.relative_path&&x.sha256===a.sha256)===index);
export function hasLegacyProductionContent(snapshot:EpisodeProductionSnapshot){
 return snapshot.reviewPackages.some(p=>['visual_review','storyboard_review','production_ready','qc_review'].includes(p.stage)&&!object(p.context_snapshot).workspace_preparation)||snapshot.artifacts.some(a=>['render','final_render','publish_package'].includes(a.artifact_type));
}
function FileLink({episodeId,path,sha256,children}:{episodeId:string;path:string;sha256?:string;children:ReactNode}){
 const url=localArtifactUrl(episodeId,path,sha256);return url?<a href={url} download>{children}</a>:null;
}
function Media({episodeId,path,sha256,label}:{episodeId:string;path:string;sha256?:string;label:string}){
 const kind=artifactPreviewKind(path),{url,error}=useLocalArtifactBlob(kind?localArtifactUrl(episodeId,path,sha256):null);
 if(!kind)return null;
 return <figure className="legacy-media">{error?<p role="alert">{error}</p>:!url?<p role="status">正在读取{label}…</p>:kind==='image'?<img src={url} alt={label}/>:kind==='audio'?<AudioPreview src={url} preload="metadata" aria-label={label}/>:<video src={url} controls preload="metadata" aria-label={label}/>}<figcaption>{label}</figcaption></figure>;
}
function TextFile({episodeId,path,sha256}:{episodeId:string;path:string;sha256?:string}){
 const {content,error}=useLocalArtifactText(localArtifactUrl(episodeId,path,sha256));
 return error?<p role="alert">{error}</p>:content?<pre className="legacy-text">{content}</pre>:<p role="status">正在读取文件…</p>;
}
function ReviewVersion({values,value,onChange,label}:{values:Review[];value:Review|undefined;onChange:(id:string)=>void;label:string}){
 return values.length?<NativeSelect size="sm" aria-label={label} value={value?.id??''} onChange={e=>onChange(e.target.value)}>{values.map(p=><option key={p.id} value={p.id}>v{p.revision_number}{p.invalidated_at?' · 已失效':p.id===values.find(v=>!v.invalidated_at)?.id?' · 当前记录':' · 历史版本'}</option>)}</NativeSelect>:null;
}
interface LegacyShot {id:string;scriptSegment:string;shotType?:string;productionMethod?:string;targetSpec?:string;durationSeconds?:number;inputBasis?:Array<{relativePath:string}>}
export function LegacyPreparation({snapshot,history,onResume,readOnly=false,pending=false}:{snapshot:EpisodeProductionSnapshot;history?:ReactNode;onResume?:(source:LegacyWorkspaceSource)=>Promise<void>;readOnly?:boolean;pending?:boolean}){
 const boards=reviews(snapshot,'storyboard_review'),[boardId,setBoardId]=useState(''),[shotId,setShotId]=useState('');
 const board=boards.find(p=>p.id===boardId)??boards[0],context=object(board?.context_snapshot),rawBoard=object(object(context.worker_result).storyboard??context.storyboard);
 const [saved,setSaved]=useState<{project:OpenChatCutProject|null;sha256?:string}|null>(null);
 useEffect(()=>{let active=true;void localRequest(`episodes/${snapshot.episode.id}/legacy-project`).then(value=>{if(active)setSaved(value);}).catch(()=>{});return()=>{active=false;};},[snapshot.episode.id]);
 const qc=reviews(snapshot,'qc_review').find(p=>!p.invalidated_at),render=snapshot.artifacts.find(a=>a.id===qc?.artifact_id),source=snapshot.artifacts.filter(a=>['review_render_project','final_render_project'].includes(a.artifact_type)&&/\.(json|html)$/.test(a.relative_path)).sort(newest).find(a=>a.producer_task_id===render?.producer_task_id);
 const shots=(Array.isArray(rawBoard.shots)?rawBoard.shots:[]).filter(s=>typeof object(s).id==='string'&&typeof object(s).scriptSegment==='string') as LegacyShot[];
 const shot=shots.find(s=>s.id===shotId)??shots[0],draft=snapshot.shotPreparationDrafts?.find(d=>d.review_package_id===board?.id&&d.shot_id===shot?.id);
 const frozenReview=reviews(snapshot,'production_ready').find(p=>object(p.context_snapshot).storyboard_review_package_id===board?.id),frozen=object(frozenReview?.context_snapshot);
 const members=(Array.isArray(frozen.members)?frozen.members:[]).map(object),frozenVisual=object(members.find(m=>m.member_key===`shot:${shot?.id}`)?.artifact),frozenAudio=object(members.find(m=>m.member_key===`narration:${shot?.id}`)?.audio_track);
 const selected=snapshot.materialRevisions.find(m=>m.id===draft?.selected_material_revision_id),video=snapshot.artifacts.find(a=>a.id===(draft?.current_video_artifact_id??frozenVisual.id)),audio=snapshot.audioTracks.find(a=>a.id===(draft?.current_audio_track_id??frozenAudio.id));
 return <div className="legacy-production legacy-production-compact legacy-preparation-compact">
  <header className="legacy-compact-topbar"><h3>已有分镜与匹配</h3><span>{shots.length} 个分镜</span><ReviewVersion values={boards} value={board} onChange={id=>{setBoardId(id);setShotId('');}} label="已有分镜版本"/>{!readOnly&&onResume&&(source||saved?.project)&&<Button size="sm" color="primary" isDisabled={pending||!saved||board?.id!==boards.find(p=>!p.invalidated_at)?.id} onPress={()=>void onResume(saved?.project?{savedProjectSha256:saved.sha256}:{artifactId:source!.id,expectedSourceSha256:source!.sha256}).catch(()=>{})}>{pending?'正在接入…':'启用逐镜头编辑'}</Button>}</header>
  <div className="legacy-preparation-layout">
   <section className="legacy-shot-table-pane" aria-label="已有分镜与匹配">
    {shots.length?<details className="legacy-all-shots" open><summary>全部分镜</summary><div className="legacy-table-scroll"><table aria-label="已有分镜列表"><thead><tr><th>镜头</th><th>脚本与素材</th><th>时长</th><th>画面</th><th>声音</th></tr></thead><tbody>{shots.map(s=>{const rowDraft=snapshot.shotPreparationDrafts?.find(d=>d.review_package_id===board?.id&&d.shot_id===s.id),rowVisual=object(members.find(m=>m.member_key===`shot:${s.id}`)?.artifact),rowAudio=object(members.find(m=>m.member_key===`narration:${s.id}`)?.audio_track),rowMaterial=snapshot.materialRevisions.find(m=>m.id===rowDraft?.selected_material_revision_id),rowVideo=snapshot.artifacts.find(a=>a.id===(rowDraft?.current_video_artifact_id??rowVisual.id)),rowNarration=snapshot.audioTracks.find(a=>a.id===(rowDraft?.current_audio_track_id??rowAudio.id));return <tr key={s.id} className={s.id===shot?.id?'is-selected':''}><th><button type="button" aria-label={`选择镜头 ${s.id}`} aria-pressed={s.id===shot?.id} onClick={()=>setShotId(s.id)}>{s.id}</button></th><td><button type="button" className="legacy-shot-text" onClick={()=>setShotId(s.id)}><span>{s.scriptSegment}</span><small>{rowMaterial||rowVideo?`素材 · ${rowMaterial?.source_path.split('/').pop()??rowVideo?.relative_path.split('/').pop()}`:'未保存画面匹配'}</small></button></td><td>{s.durationSeconds??'—'} 秒</td><td><span className={rowMaterial||rowVideo?'is-ready':''}>{rowMaterial||rowVideo?'已匹配':'未记录'}</span></td><td>{rowDraft?.audio_mode==='none'?'静音':rowDraft?.audio_mode==='source'?'素材原声':rowNarration?'已记录':'未记录'}</td></tr>;})}</tbody></table></div></details>:<p className="legacy-empty-content">尚无分镜记录。</p>}
    <footer className="legacy-shot-table-footer"><span>{shots.length} 个分镜</span>{board?.artifact_id&&snapshot.artifacts.filter(a=>a.id===board.artifact_id).map(a=><FileLink key={a.id} episodeId={a.episode_id} path={a.relative_path} sha256={a.sha256}>下载分镜文件</FileLink>)}</footer>
   </section>
   <aside className="legacy-preparation-detail">
    {shot&&<section className="legacy-compact-detail-section"><header><h4>{shot.id} · 已有匹配</h4><span>{shot.durationSeconds??'—'} 秒</span></header><dl className="legacy-facts"><div><dt>画面要求</dt><dd>{shot.productionMethod&&!/^[a-z][a-z0-9_-]*$/i.test(shot.productionMethod)?shot.productionMethod:shot.targetSpec||'未记录画面要求'}</dd></div><div><dt>已选画面</dt><dd>{selected?.source_path.split('/').pop()??video?.relative_path.split('/').pop()??'未保存画面匹配'}</dd></div><div><dt>声音</dt><dd>{draft?.audio_mode==='tts'?'TTS 口播':draft?.audio_mode==='source'?'素材原声':draft?.audio_mode==='none'?'静音':audio?'已冻结旁白':'未记录声音设置'}{audio?` · ${Number(audio.duration_seconds).toFixed(2)} 秒`:''}</dd></div><div><dt>字幕</dt><dd>{draft?draft.subtitles_enabled?draft.subtitle_text||'未填写字幕':'字幕已关闭':'未记录独立字幕设置，字幕以原工程为准'}</dd></div></dl>{(selected||video)&&<Media episodeId={snapshot.episode.id} path={selected?.storage_path??video!.relative_path} sha256={selected?.sha256??video?.sha256} label={`${shot.id} 已选画面`}/>} {audio&&<Media episodeId={snapshot.episode.id} path={audio.relative_path} sha256={audio.sha256} label={`${shot.id} 已有口播`}/>}</section>}
    {history}
   </aside>
  </div>
 </div>;
}

export interface LegacyWorkspaceSource {artifactId?:string;expectedSourceSha256?:string;savedProjectSha256?:string}
export function LegacyEditing({snapshot,onResume,readOnly=false,pending=false,history}:{snapshot:EpisodeProductionSnapshot;history?:ReactNode;onResume?:(source:LegacyWorkspaceSource)=>Promise<void>;readOnly?:boolean;pending?:boolean}){
 const qc=reviews(snapshot,'qc_review')[0],render=snapshot.artifacts.find(a=>a.id===qc?.artifact_id);
 const allProjects=snapshot.artifacts.filter(a=>['review_render_project','final_render_project','shot_editable_project'].includes(a.artifact_type)).sort(newest);
 const current=allProjects.find(a=>render&&a.producer_task_id===render.producer_task_id)??allProjects[0];
 const projects=uniqueArtifacts(current?[current,...allProjects]:allProjects);
 const [selected,setSelected]=useState(''),[saved,setSaved]=useState<{project:OpenChatCutProject|null;sha256?:string}|null>(null),[error,setError]=useState(''),[project,setProject]=useState<OpenChatCutProject|null>(null);
 useEffect(()=>{let active=true;void localRequest(`episodes/${snapshot.episode.id}/legacy-project`).then(value=>{if(active)setSaved(value);}).catch(cause=>{if(active){setError(cause instanceof Error?cause.message:'已有工程读取失败。');setSaved({project:null});}});return()=>{active=false;};},[snapshot.episode.id]);
 const selectedId=selected||(saved?.project?'saved':current?.id??''),artifact=projects.find(a=>a.id===selectedId);
 useEffect(()=>{let active=true;setProject(null);if(selectedId==='saved'){setProject(saved?.project??null);return;}
  if(!artifact||!artifact.relative_path.endsWith('.json'))return;
  const source=localArtifactUrl(artifact.episode_id,artifact.relative_path,artifact.sha256);if(!source)return;
  void fetch(source).then(async r=>{if(!r.ok)throw Error('已有冻结工程文件读取失败。');const p=await r.json();if(p.version!==3||!Array.isArray(p.timelines))throw Error('此工程不是 OpenChatCut 时间线格式，原文件仍可下载。');if(active)setProject(p);}).catch(cause=>{if(active)setError(cause instanceof Error?cause.message:'工程读取失败。');});return()=>{active=false;};
 },[artifact?.id,selectedId,saved]);
 return <div className="legacy-production legacy-production-compact legacy-editing-compact">
  <header className="legacy-compact-topbar"><h3>已有剪辑工程</h3>{(projects.length>0||saved?.project)&&<NativeSelect size="sm" aria-label="已有工程版本" value={selectedId} onChange={e=>{setSelected(e.target.value);setError('');}}>{saved?.project&&<option value="saved">最近保存的 OpenChatCut 工作版本</option>}{projects.map(a=><option key={a.id} value={a.id}>{a.id===current?.id?'当前审核对应 · ':''}{a.relative_path.split('/').slice(-3).join('/')}</option>)}</NativeSelect>}</header>
  {error&&<p role="alert" className="legacy-compact-alert">{error}</p>}{!saved&&<p role="status" className="legacy-compact-alert">正在读取已保存工程…</p>}
  <div className="legacy-editing-layout">
   <section className="legacy-editor-preview"><header><h4>对应审核预览</h4>{render&&<FileLink episodeId={render.episode_id} path={render.relative_path} sha256={render.sha256}>下载审核预览</FileLink>}</header>{render?<Media episodeId={render.episode_id} path={render.relative_path} sha256={render.sha256} label="已有剪辑审核预览"/>:<div className="legacy-no-preview"><p>尚无对应审核预览。</p></div>}
    {!readOnly&&onResume&&(selectedId==='saved'||artifact&&['review_render_project','final_render_project'].includes(artifact.artifact_type)&&/\.(json|html)$/.test(artifact.relative_path))&&<div className="legacy-edit-entry"><Button size="sm" color="primary" isDisabled={pending||!saved||artifact?.relative_path.endsWith('.json')&&!project||selectedId!=='saved'&&!!saved.project} onPress={()=>{const source=selectedId==='saved'?{savedProjectSha256:saved!.sha256}:{artifactId:artifact!.id,expectedSourceSha256:artifact!.sha256};void onResume(source).catch(()=>{});}}>{pending?'正在打开…':'继续编辑原工程'}</Button><span>编辑另存工作版本，保留原工程和审核产物。</span></div>}
   </section>
   <aside className="legacy-project-detail">
    <section className="legacy-compact-detail-section"><h4>工程文件</h4>{selectedId==='saved'&&saved?.sha256&&<a href={`/api/local/episodes/${snapshot.episode.id}/legacy-project?download=${saved.sha256}`} download>下载已保存工程</a>}{artifact&&<><FileLink episodeId={artifact.episode_id} path={artifact.relative_path} sha256={artifact.sha256}>下载工程 {artifact.relative_path.split('/').pop()}</FileLink><p className="legacy-file-path">{artifact.relative_path}</p>{!artifact.relative_path.endsWith('.json')&&<details><summary>查看原工程源码</summary><TextFile episodeId={artifact.episode_id} path={artifact.relative_path} sha256={artifact.sha256}/></details>}</>}{!projects.length&&!saved?.project&&saved&&<p>尚无已保存的剪辑工程。</p>}</section>
    {project&&project.timelines.map(t=><section className="legacy-compact-detail-section legacy-timeline" key={t.id}><h4>{t.name||'已有时间线'}</h4><p className="legacy-project-spec">{t.width} × {t.height} · {t.fps} fps · {t.items.length} 个片段</p><details open><summary>已有工程时间线</summary><div className="legacy-table-scroll"><table aria-label="已有工程时间线"><thead><tr><th>轨道</th><th>片段</th><th>起点</th><th>时长</th><th>声音</th></tr></thead><tbody>{t.items.map((item,index)=><tr key={String(item.id??index)}><td>{text(t.tracks?.[text(item.track)]?.name)||text(item.track)}</td><td>{text(item.name)||text(object(item.props).text)||text(item.kind)}</td><td>{(Number(item.startFrame??0)/t.fps).toFixed(2)} 秒</td><td>{(Number(item.durationInFrames??0)/t.fps).toFixed(2)} 秒</td><td>{item.volume===0?'静音':item.volume!==undefined?String(item.volume):'—'}</td></tr>)}</tbody></table></div></details>{Object.entries(t.tracks??{}).filter(([,track])=>track.captions).map(([id,track])=><details key={id}><summary>{track.name||id} · 已有字幕</summary>{track.captions?.sourceEntries.map(entry=><p key={entry.id}>{entry.label}：{entry.words.map(word=>word.text).join('')}</p>)}</details>)}</section>)}
    {history}
   </aside>
  </div>
 </div>;
}

export function LegacyDelivery({snapshot,history}:{snapshot:EpisodeProductionSnapshot;history?:ReactNode}){
 const versions=reviews(snapshot,'qc_review'),[reviewId,setReviewId]=useState(''),[finalId,setFinalId]=useState('');
 const review=versions.find(p=>p.id===reviewId)??versions[0],context=object(review?.context_snapshot),render=snapshot.artifacts.find(a=>a.id===review?.artifact_id);
 const finalVideos=uniqueArtifacts(snapshot.artifacts.filter(a=>a.artifact_type==='final_render').sort(newest)),finalVideo=finalVideos.find(a=>a.id===finalId)??finalVideos[0];
 const checks=(Array.isArray(object(context.technical_evidence).checks)?object(context.technical_evidence).checks:[]) as Array<{name:string;passed:boolean;detail:string}>;
 const reports=uniqueArtifacts(snapshot.artifacts.filter(a=>['review_qc_report','final_qc_report'].includes(a.artifact_type)&&(!render||a.producer_task_id===render.producer_task_id||a.producer_task_id===finalVideo?.producer_task_id)));
 const files=uniqueArtifacts(snapshot.artifacts.filter(a=>['publish_package','metadata','cover'].includes(a.artifact_type)).sort(newest));
 return <div className="legacy-production legacy-production-compact legacy-delivery-compact">
  <header className="legacy-compact-topbar"><h3>检查与交付</h3><span>已有成片与交付记录</span></header>
  <div className="legacy-delivery-layout">
   <div className="legacy-delivery-previews">
    {finalVideo&&<section className="legacy-compact-detail-section"><header><h3>已有最终成片</h3><NativeSelect size="sm" aria-label="已有最终成片版本" value={finalVideo.id} onChange={e=>setFinalId(e.target.value)}>{finalVideos.map(a=><option key={a.id} value={a.id}>{a.relative_path.split('/').slice(-2).join('/')}</option>)}</NativeSelect></header><Media episodeId={finalVideo.episode_id} path={finalVideo.relative_path} sha256={finalVideo.sha256} label="已有最终成片"/><FileLink episodeId={finalVideo.episode_id} path={finalVideo.relative_path} sha256={finalVideo.sha256}>下载最终成片</FileLink></section>}
    <section className="legacy-compact-detail-section"><header><h3>已有审核成片</h3><ReviewVersion values={versions} value={review} onChange={setReviewId} label="已有审核版本"/></header>{review?.invalidated_at&&<p role="status" className="legacy-version-warning">此审核版本已失效，仅供查看。</p>}{render?<><Media episodeId={render.episode_id} path={render.relative_path} sha256={render.sha256} label={`审核成片 v${review!.revision_number}`}/><FileLink episodeId={render.episode_id} path={render.relative_path} sha256={render.sha256}>下载审核成片</FileLink></>:<div className="legacy-no-preview"><p>尚无审核成片。</p></div>}</section>
   </div>
   <aside className="legacy-delivery-evidence">
    <section className="legacy-compact-detail-section"><header><h4>该版本技术检查</h4>{!!checks.length&&<span>{checks.filter(c=>c.passed).length} / {checks.length} 通过</span>}</header>{checks.length?<ul className="legacy-checks">{checks.map((check,index)=><li key={index}><span className={check.passed?'is-ready':'is-failed'}>{check.passed?'通过':'未通过'}</span>{check.detail||check.name}</li>)}</ul>:<p>此版本未记录技术检查。</p>}</section>
    {!!snapshot.qcReviewIssues?.filter(issue=>issue.review_package_id===review?.id).length&&<section className="legacy-compact-detail-section"><h4>问题记录</h4>{snapshot.qcReviewIssues.filter(issue=>issue.review_package_id===review?.id).map(issue=><p key={issue.id}>{({open:'待处理',resolved:'已解决',accepted:'已接受',ignored:'已忽略'} as Record<string,string>)[issue.status]??'待核对'} · {issue.reason}</p>)}</section>}
    {!!reports.length&&<section className="legacy-compact-detail-section"><h4>检查报告</h4>{reports.map(a=><details key={a.id}><summary>{a.artifact_type==='final_qc_report'?'最终 QC 报告':'审核 QC 报告'} · {a.relative_path.split('/').slice(-2).join('/')}</summary><TextFile episodeId={a.episode_id} path={a.relative_path} sha256={a.sha256}/><FileLink episodeId={a.episode_id} path={a.relative_path} sha256={a.sha256}>下载报告</FileLink></details>)}</section>}
    <section className="legacy-compact-detail-section"><h3>已有交付文件</h3>{files.length?<ul className="legacy-file-list">{files.map(a=><li key={a.id}><FileLink episodeId={a.episode_id} path={a.relative_path} sha256={a.sha256}>{a.artifact_type==='publish_package'?'交付包':a.artifact_type==='cover'?'封面':'发布信息'} · {a.relative_path.split('/').pop()}</FileLink></li>)}</ul>:<p>{render?'尚未登记交付包；已有审核成片可以查看和下载。':'尚未生成交付文件。'}</p>}</section>
    {history}
   </aside>
  </div>
 </div>;
}
