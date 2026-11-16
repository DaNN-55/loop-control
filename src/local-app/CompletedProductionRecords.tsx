import {useId,useState} from 'react';
import type {ProductionWorkspace} from '../productionWorkspace';
import type {OpenChatCutProject} from '../worker/openchatcutProject';
import {uiText} from '../i18n/ui';
import {VideoPreview} from '../ui/media/VideoPreview';
import {AudioPreview} from '../ui/media/AudioPreview';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import {completedShotRecords,type CompletedProductionRecord} from './completedWorkspaceRecords';
import {completedArtifactUrl} from './completedWorkspaceView';

const statusNames:Record<string,string>={adopted:'曾采用',rejected:'已放弃',available:'未采用',stale:'旧版本',failed:'失败',blocked:'待核对',ready:'等待执行',running:'执行中',completed:'已完成'};
function RecordCard({record:r,workspace:w,originalScript}:{record:CompletedProductionRecord;workspace:ProductionWorkspace;originalScript?:string}){
 const [preview,setPreview]=useState(!r.current),[prompt,setPrompt]=useState<'input'|'submitted'|'script'>('input');
 const url=r.file?completedArtifactUrl(w,r.file):null;
 return <article className={`completed-record-card${r.current?' is-current':''}`}>
  <header><strong>{uiText(r.label)}</strong><span>{uiText(r.current?'当前采用':statusNames[r.status]??r.status)}</span>{url&&<Button size="sm" color="tertiary" onPress={()=>setPreview(!preview)}>{uiText(preview?'收起原素材':'展开原素材')}</Button>}</header>
  {r.file&&<p className="completed-record-file">{r.file.relativePath.split('/').pop()}</p>}
  {preview&&url&&<div className="completed-record-preview">{r.kind==='image'?<img src={url} alt={uiText('候选图片')}/>:r.kind==='video'?<VideoPreview src={url} title={uiText('候选视频')}/>:<AudioPreview src={url} aria-label={uiText('候选声音试听')} preload="none"/>}</div>}
  {r.generation&&<dl className="completed-source-facts">
   <div><dt>{uiText('连接／模型')}</dt><dd>{[r.generation.connectionName,r.generation.selection?.model].filter(Boolean).join(' · ')||'—'}</dd></div>
   <div><dt>{uiText('请求规格')}</dt><dd>{r.generation.videoResolution||'—'}</dd></div>
   <div><dt>{uiText('请求时长')}</dt><dd>{Number.isFinite(r.generation.durationSeconds)?`${r.generation.durationSeconds} s`:'—'}</dd></div>
   <div><dt>{uiText('首帧构图')}</dt><dd>{r.generation.firstFrameFit?uiText(r.generation.firstFrameFit==='contain'?'完整保留':'铺满裁切'):'—'}</dd></div>
  </dl>}
  {r.error&&<p className="completed-warning">{r.error}</p>}
  <div className="completed-prompt-views" role="group" aria-label={uiText('提示词视图')}>{([['input','制作输入'],['submitted','实际提交'],['script','原脚本']] as const).map(([key,label])=><button key={key} type="button" aria-pressed={prompt===key} onClick={()=>setPrompt(key)}>{uiText(label)}</button>)}</div>
  {prompt==='script'&&<small className="completed-record-note">{uiText(r.script?.trim()?'本次请求保留的原脚本片段':'本期已确认原脚本')}</small>}
  <p className="completed-prompt-text" tabIndex={0}>{(prompt==='input'?r.input:prompt==='submitted'?r.submitted:r.script?.trim()?r.script:originalScript)||uiText(prompt==='submitted'?'未记录实际提交正文，不能从制作输入推断。':'未保留此项原文。')}</p>
  <details className="completed-record-parameters"><summary>{uiText('完整制作参数')}{r.taskId&&<span>{uiText('含原任务')}</span>}</summary>
   {r.taskId&&<p className="completed-record-file">{uiText('原任务')}：{r.taskId}</p>}
   {r.parameters?<pre tabIndex={0} role="region" aria-label={uiText('完整制作参数')}><code>{JSON.stringify(r.parameters,null,2)}</code></pre>:<p>{uiText('未保留完整制作参数，不能用当前默认值还原。')}</p>}
  </details>
 </article>;
}
export function CompletedProductionRecords({workspace:w,project,shotId,section,originalScript}:{workspace:ProductionWorkspace;project:OpenChatCutProject|null;shotId:string;section:'visual'|'voice'|'sound';originalScript?:string}){
 const records=completedShotRecords(w,project,shotId),[kind,setKind]=useState('all'),[status,setStatus]=useState('all'),[expanded,setExpanded]=useState<string|null>(null),detailId=useId();
 const active=records.filter(r=>r.current&&(section==='visual'?(r.kind==='image'||r.kind==='video'):section==='voice'?r.label.startsWith('口播'):!r.label.startsWith('口播')&&r.kind==='audio'));
 const unused=records.filter(r=>!r.current),filtered=unused.filter(r=>(kind==='all'||r.kind===kind)&&(status==='all'||r.status===status));
 const selected=filtered.find(r=>r.key===expanded);
 return <section className="completed-production-records" aria-label={uiText('制作来源与历史')}>
  {active.map(record=><RecordCard key={record.key} record={record} workspace={w} originalScript={originalScript}/>)}
  {!active.length&&<p className="completed-record-note">{uiText('此项未找到匹配的已采用制作快照；已保存配置仍以工程为准。')}</p>}
  <section className="completed-unused-records" aria-label={uiText('未采用')}>
   <header><h4>{uiText('未采用')}</h4><span>{unused.length}</span></header>
   <search className="completed-record-filters" aria-label={uiText('筛选未采用记录')}>
    <select aria-label={uiText('记录类型')} value={kind} onChange={e=>{setKind(e.target.value);setExpanded(null);}}><option value="all">{uiText('全部类型')}</option>{([['image','图片'],['video','视频'],['audio','声音'],['request','请求']] as const).map(([value,label])=><option key={value} value={value}>{uiText(label)}</option>)}</select>
    <select aria-label={uiText('记录状态')} value={status} onChange={e=>{setStatus(e.target.value);setExpanded(null);}}><option value="all">{uiText('全部状态')}</option>{[...new Set(unused.map(r=>r.status))].map(value=><option key={value} value={value}>{uiText(statusNames[value]??value)}</option>)}</select>
   </search>
   <div className="completed-candidate-strip">{filtered.map((r,index)=><button type="button" key={r.key} aria-expanded={selected?.key===r.key} aria-controls={detailId} onClick={()=>setExpanded(selected?.key===r.key?null:r.key)} aria-label={uiText('{action}未采用{kind} {index}',{action:selected?.key===r.key?'收起':'展开',kind:uiText(r.label),index:index+1})}>
    {r.file&&(r.kind==='image'?<img src={completedArtifactUrl(w,r.file)} alt="" width={104} height={64} loading="lazy"/>:r.kind==='video'?<video src={`${completedArtifactUrl(w,r.file)}#t=0.001`} width={104} height={64} muted playsInline preload="metadata"/>:null)}<span>{uiText(r.label)}<small>{uiText(statusNames[r.status]??r.status)}</small></span>
   </button>)}</div>
   {!filtered.length&&<p className="completed-record-note">{uiText(unused.length?'没有符合筛选的记录。':'暂无未采用候选或失败请求记录。')}</p>}
   <div id={detailId}>{selected&&<RecordCard key={selected.key} record={selected} workspace={w} originalScript={originalScript}/>}</div>
  </section>
 </section>;
}
