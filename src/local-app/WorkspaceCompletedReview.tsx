import {FeedbackNotice} from '../ui/FeedbackNotice';
import {useMemo,useState} from 'react';
import type {ProductionWorkspace} from '../productionWorkspace';
import type {OpenChatCutProject} from '../worker/openchatcutProject';
import type {ProductionSegment} from '../reviews/productionScript';
import {uiText} from '../i18n/ui';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import {VideoPreview} from '../ui/media/VideoPreview';
import {CompletedDialog} from './CompletedDialog';
import {WorkspaceCompletedShots} from './WorkspaceCompletedShots';
import {WorkspaceMaterialShelf} from './WorkspaceMaterialShelf';
import {CompletedProductionRecords} from './CompletedProductionRecords';
import {CompletedQualityEvidence} from './CompletedQualityEvidence';
import {completedReviewEvidence} from './completedReviewEvidence';
import {workspaceShotSource} from './WorkspaceShotPreview';
import {CompletedImagePreview} from './CompletedImagePreview';
import {CompletedShotThumbnail} from './CompletedShotThumbnail';
import {readWorkspaceAudioMix} from '../workspaceAudio';
import {completedWorkspaceExport,completedWorkspaceShots,completedArtifactUrl} from './completedWorkspaceView';
import {CompletedStudioView} from './CompletedStudioView';
import './workspace-completed-review.css';

type Material={id:string;source_path:string;storage_path:string;material_type:string};
const tabs=[['visual','画面'],['voice','字幕与口播'],['sound','声音']] as const;
/** Completed works receive no command callback: this surface can only read. */
export function WorkspaceCompletedReview({workspace:w,project,materials,view,onOpenProject,onReturn,projectError,onRetryProject,originalScript,originalSegments=[],readyCount}:{workspace:ProductionWorkspace;project:OpenChatCutProject|null;materials:Material[];view:'shots'|'project'|'hidden';onOpenProject:()=>void;onReturn:()=>void;projectError:string;onRetryProject:()=>void;originalScript?:string;originalSegments?:ProductionSegment[];readyCount:number}){
 const shots=useMemo(()=>completedWorkspaceShots(w,project),[w,project]);
 const mix=useMemo(()=>project?readWorkspaceAudioMix(project,Object.fromEntries(shots.map(s=>[s.id,s.itemIds]))):w.audio?.mix,[project,shots,w.audio?.mix]);
 const [copyNotice,setCopyNotice]=useState('');
 const [selected,setSelected]=useState<string|null>(null),[tab,setTab]=useState<'visual'|'voice'|'sound'>('visual'),[itemId,setItemId]=useState('');
 const shot=shots.find(s=>s.id===selected),clips=w.clips.filter(c=>c.shotId===selected);
 const activeClip=clips.find(c=>c.itemId===itemId)??clips[0];
 const original=activeClip?workspaceShotSource(activeClip,project):null;
 const segment=originalSegments.find(s=>s.id===shot?.id);
 const scriptExcerpt=segment?[`${uiText('口播')}：${segment.narration}`,`${uiText('画面提示')}：${segment.visual}`,`${uiText('视频提示词')}：${segment.videoPrompt}`].join('\n\n'):originalScript;
 const final=completedWorkspaceExport(w),linked=!!project&&!!final&&final.project.sha256===w.project.sha256;
 const timeline=project?.timelines.find(t=>t.id===shot?.timelineId),fps=timeline?.fps??30;
 const observations=completedReviewEvidence(w);
 const activeTimeline=project?.timelines.find(t=>t.id===project.activeTimelineId);
 return <>
  <section hidden={view!=='shots'} className="production-workspace-section completed-overview" aria-label={uiText('已完成作品分镜台')}>
   <header><div><h3>{uiText('分镜台')}</h3><span>{readyCount} / {shots.length} {uiText('画面就绪')}</span></div><div className="completed-overview-actions"><span>{uiText('只读')}</span><Button size="sm" color="tertiary" aria-label={uiText('在 OpenChatCut 中查看')} onPress={onOpenProject}>{uiText('在 OpenChatCut 中查看')} ↗</Button></div></header>
   <FeedbackNotice message={copyNotice} onDismiss={()=>setCopyNotice('')}/>
   {activeTimeline&&<div className="completed-overview-meta"><span>{shots.length}{uiText(' 个镜头')}</span><span>{activeTimeline.width} × {activeTimeline.height} · {activeTimeline.fps} fps</span></div>}
   {!project&&<p role={projectError?'alert':'status'}>{projectError||uiText('尚未读取到已保存工程，最终配置暂不可核对。')}<Button size="sm" color="secondary" onPress={onRetryProject}>{uiText('重新读取工程')}</Button></p>}
   <div className="completed-table-scroll" role="region" aria-label={uiText('全片镜头表格')} tabIndex={0}><table aria-label={uiText('全片镜头总览')}>
    <colgroup><col className="completed-col-number"/><col className="completed-col-visual"/><col/><col className="completed-col-time"/><col className="completed-col-sound"/><col className="completed-col-action"/></colgroup>
    <thead><tr>{['镜头','画面','口播','时间线','声音','查看'].map(label=><th scope="col" key={label}>{label==='查看'?<span className="sr-only">{uiText(label)}</span>:uiText(label)}</th>)}</tr></thead>
    <tbody>{shots.map((s,index)=>{
     const saved=project?.timelines.find(t=>t.id===s.timelineId),items=saved?.items.filter(i=>s.itemIds.includes(String(i.id)))??[],caption=w.captions?.find(c=>c.shotId===s.id),voice=w.usedNarration?.find(n=>n.shotId===s.id);
     const visuals=items.filter(i=>i.kind==='image'||i.kind==='video'),first=visuals[0],mainVoice=mix?.voices.find(v=>v.shotId===s.id);
     const sounds=saved?mix?.sounds.filter(sound=>sound.startSeconds<(s.startFrame+s.durationInFrames)/saved.fps&&sound.startSeconds+sound.durationSeconds>s.startFrame/saved.fps):[];
     const soundNames=[...(mainVoice?.mode==='tts'||voice?['口播']:mainVoice?.mode==='source'?['原声']:[]),...(sounds?.some(sound=>sound.kind==='bgm')?['配乐']:[]),...(sounds?.some(sound=>sound.kind==='sfx')?['音效']:[])];
     return <tr key={s.timelineId+':'+s.id} data-selected={(selected===s.id||!selected&&index===0)||undefined}>
      <th scope="row" title={s.id}>{String(index+1).padStart(2,'0')}{observations.some(n=>n.shotId===s.id&&n.state!=='已替换')&&<small className="completed-warning">{uiText('复核')}</small>}</th><td><div className="completed-visual-cell">{first&&<CompletedShotThumbnail workspace={w} project={project} itemId={String(first.id)}/>}<span className={first?'sr-only':undefined}>{first?uiText(first.kind==='image'?'图片':'视频'):uiText(project?'无有效画面':'工程未读取')}</span>{visuals.length>1&&<small>{visuals.length}</small>}</div></td>
      <td><p>{s.text}</p>{voice?.text&&voice.text!==s.text&&<small>{uiText('采用口播：')}{voice.text}</small>}{caption&&caption.timing!=='current'&&<small className="completed-warning">{uiText('字幕时序待核对')}</small>}</td>
      <td>{saved?`${(s.startFrame/saved.fps).toFixed(2)}–${((s.startFrame+s.durationInFrames)/saved.fps).toFixed(2)} s`:'—'}</td>
      <td><span className="completed-voice-state">{soundNames.includes('口播')?uiText('口播 ✓'):soundNames.includes('原声')?uiText('原声'):uiText(project?'无口播':'待核对')}</span><small>{soundNames.includes('音效')?uiText('音效'):soundNames.includes('配乐')?uiText('整期配乐'):uiText('无配乐或音效')}</small></td><td><button type="button" onClick={()=>{setSelected(s.id);setItemId(s.itemIds[0]??'');}} aria-label={uiText('查看镜头 {id}',{id:s.id})}>{uiText('查看')} ↗</button></td>
     </tr>;
    })}</tbody>
   </table>{!shots.length&&<p>{uiText('此作品没有可读取的镜头记录。')}</p>}</div>
   <footer className="completed-overview-footer"><CompletedQualityEvidence workspace={w} compact/><WorkspaceMaterialShelf episodeId={w.episodeId} scriptRevisionId={w.scriptRevisionId} shotCount={shots.length} materials={materials} readOnly busy={false} status="" failures={[]} onImport={async()=>{throw Error('已完成作品只读。');}}/></footer>
  </section>
  <CompletedDialog open={view==='shots'&&!!shot} title={shot?`${shot.id} · ${shot.text}`:''} drawer onClose={()=>setSelected(null)}>
   {shot&&<div className="completed-drawer-layout"><section className="completed-shot-scene">
    <div className="completed-drawer-actions"><span>{uiText(linked?'成片预览':'原素材预览')}</span><Button size="sm" color="secondary" onPress={onOpenProject}>{uiText('在 OpenChatCut 中查看')}</Button></div>
    <div className="completed-shot-preview">{linked&&final?.artifact&&timeline&&shot.durationInFrames>0?<VideoPreview key={shot.id} title={uiText('{id} 成片',{id:shot.id})} src={completedArtifactUrl(w,final.artifact)} sourceLabel={uiText('成片')} segment={{start:shot.startFrame/fps,end:(shot.startFrame+shot.durationInFrames)/fps,frameDuration:1/fps}}/>:<>{clips.length>1&&<label>{uiText('查看画面片段')}<select value={activeClip?.itemId} onChange={e=>setItemId(e.target.value)}>{clips.map((clip,index)=><option value={clip.itemId} key={clip.itemId}>{uiText('片段')} {index+1}</option>)}</select></label>}{original?original.kind==='image'?<CompletedImagePreview src={completedArtifactUrl(w,original)} alt={uiText('当前图片')}/>:<VideoPreview src={completedArtifactUrl(w,original)} title={uiText('原素材预览')}/>:<p>{uiText('未保留可读取的画面来源。')}</p>}<p>{uiText('原素材预览；与交付成片的对应关系未核实。')}</p></>}</div>
    {timeline&&<div className="completed-scene-meta"><span>{(shot.startFrame/fps).toFixed(2)}–{((shot.startFrame+shot.durationInFrames)/fps).toFixed(2)} s</span><span>{(shot.durationInFrames/fps).toFixed(2)} s · {timeline.width} × {timeline.height}</span></div>}
    </section><section className="completed-shot-inspector"><div className="completed-detail-tabs" role="tablist" aria-label={uiText('镜头详情')}>{tabs.map(([id,label],index)=><button key={id} id={`completed-tab-${id}`} type="button" role="tab" aria-selected={tab===id} tabIndex={tab===id?0:-1} onClick={()=>setTab(id)} onKeyDown={e=>{const next=e.key==='ArrowRight'?tabs[(index+1)%3]:e.key==='ArrowLeft'?tabs[(index+2)%3]:e.key==='Home'?tabs[0]:e.key==='End'?tabs[2]:null;if(next){e.preventDefault();setTab(next[0]);e.currentTarget.parentElement?.querySelector<HTMLButtonElement>(`#completed-tab-${next[0]}`)?.focus();}}}>{uiText(label)}</button>)}</div>
    <div className="completed-detail-record" role="tabpanel" aria-labelledby={`completed-tab-${tab}`} tabIndex={0}>
     {tab==='voice'&&<p className="completed-caption-text">{w.captions?.find(c=>c.shotId===shot.id)?.contract.text||uiText('未保留字幕正文。')}</p>}
     <CompletedProductionRecords key={shot.id} workspace={w} project={project} shotId={shot.id} section={tab} originalScript={scriptExcerpt}/>
     <details className="completed-saved-settings"><summary>{uiText('已保存{section}配置',{section:uiText(tabs.find(([id])=>id===tab)![1])})}</summary><WorkspaceCompletedShots workspace={w} project={project} materials={materials} shotId={shot.id} section={tab}/></details>
    </div>
   </section></div>}
  </CompletedDialog>
  {view==='project'&&<CompletedStudioView episodeId={w.episodeId} title={uiText('已完成生产单')} initialShotId={selected??undefined} onClose={saved=>{if(saved)setCopyNotice('副本已保存到 OpenChatCut 独立剪辑库。');onReturn();}}/>}
 </>;
}
