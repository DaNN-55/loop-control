import {uiText} from '../i18n/ui';
import {ChevronDown} from 'lucide-react';
import {wanSettingLabels,type WanGenerationSettings} from '../videoGenerationSettings';
import './workspace-production-records.css';
import type {ReactNode} from 'react';
import type {ProductionWorkspace} from '../productionWorkspace';
import {framingLabels,captionSpaceLabels,referencePurposeLabels,imageQualityLabels} from '../imageGeneration';
import {NativeSelect} from '../ui/dan-ui/components/base/select/select-native';

type Material={id:string;source_path:string;material_type:string;storage_path?:string};
/** Read-only records never initialize a production draft or resolve today's defaults. */
export function WorkspaceVisualRecord({workspace,targetItemId,options,onTargetChange,currentVisualPath,currentVisualSha256,materials,preview}:{workspace:ProductionWorkspace;targetItemId:string;options:ProductionWorkspace['clips'];onTargetChange?:(id:string)=>void;currentVisualPath?:string;currentVisualSha256?:string;materials:Material[];preview?:ReactNode}){
 const records=(workspace.visualCandidates??[]).filter(c=>c.targetItemId===targetItemId);
 const tasks=(workspace.visualTasks??[]).filter(t=>t.targetItemId===targetItemId&&!t.retryTaskId&&!records.some(c=>c.taskId===t.taskId));
 const selected=workspace.selectedImages?.find(s=>s.targetItemId===targetItemId);
 const current=records.find(c=>c.relativePath===currentVisualPath&&(!currentVisualSha256||c.sha256===currentVisualSha256));
 const ordered=[...records].sort((a,b)=>Number(b===current)-Number(a===current)||Number(b.id===selected?.candidateId)-Number(a.id===selected?.candidateId));
 const materialName=(id:string)=>materials.find(m=>m.id===id)?.source_path.split('/').pop()??id;
 return <section className="workspace-visual-preparation workspace-production-records" aria-label={uiText("画面制作记录")}>
  <h3>{uiText("画面制作记录")}</h3>
  {options.length>1&&<label>{uiText("画面片段")}<NativeSelect size="sm" aria-label={uiText("查看画面片段")} value={targetItemId} onChange={e=>onTargetChange?.(e.target.value)}>{options.map((c,i)=><option key={c.itemId} value={c.itemId}>{uiText("片段 ")}{i+1}</option>)}</NativeSelect></label>}
  {preview}
  {!current&&<p>{currentVisualPath?uiText("当前画面来自已保存工程，未找到对应制作请求。"):uiText("未记录可匹配的当前画面。")}</p>}
  {ordered.length===0&&tasks.length===0&&<p>{uiText("此工程未保留画面生成快照，无法还原当时的制作参数。")}</p>}
  {ordered.map(candidate=>{const generation=candidate.generation,brief=generation?.imageBrief;return <article key={candidate.id} aria-label={uiText("{value0}制作记录",{value0:String(candidate.kind==='image'?'图片':'视频')})}>
   <details className="workspace-record-disclosure" open={candidate===current}>
   <summary>{candidate===current?uiText("当前采用"):candidate.id===selected?.candidateId?uiText("已选备用图片"):candidate.status==='rejected'?uiText("已放弃候选"):candidate.status==='adopted'?uiText("曾采用候选"):uiText("未采用候选")} · {candidate.kind==='image'?uiText("图片"):uiText("视频")}<ChevronDown className="workspace-record-chevron" size={16} aria-hidden="true"/></summary>
   <dl className="workspace-saved-facts"><div><dt>{uiText("素材")}</dt><dd>{materials.find(m=>m.storage_path===candidate.relativePath)?.source_path.split('/').pop()??candidate.relativePath.split('/').pop()}</dd></div>
   {candidate.taskId&&<div><dt>{uiText("原任务")}</dt><dd>{candidate.taskId}</dd></div>}
   {generation?.selection&&<><div><dt>{uiText("连接")}</dt><dd>{generation.connectionName??generation.selection.connectionVersionId}</dd></div><div><dt>{uiText("模型")}</dt><dd>{generation.selection.model}</dd></div><div><dt>{uiText("服务")}</dt><dd>{generation.selection.provider} / {generation.selection.adapter}</dd></div></>}
   {generation?.videoResolution&&<div><dt>{uiText("请求分辨率")}</dt><dd>{generation.videoResolution}</dd></div>}{generation?.imageSettings&&<><div><dt>{uiText("请求尺寸")}</dt><dd>{generation.imageSettings.size.replace('x',' × ')}</dd></div><div><dt>{uiText("质量")}</dt><dd>{uiText(imageQualityLabels[generation.imageSettings.quality])}</dd></div><div><dt>{uiText("请求数量")}</dt><dd>{generation.imageSettings.count}{uiText(" 张")}</dd></div></>}
   {candidate.kind==='video'&&generation&&<><div><dt>{uiText("请求时长")}</dt><dd>{generation.durationSeconds==null?uiText("未记录"):`${generation.durationSeconds} s`}</dd></div>{generation.firstFrameMaterialRevisionId&&<div><dt>{uiText("首帧")}</dt><dd>{materialName(generation.firstFrameMaterialRevisionId)}</dd></div>}{generation.firstFrameFit&&<div><dt>{uiText("首帧构图")}</dt><dd>{generation.firstFrameFit==='contain'?uiText("完整保留"):uiText("居中裁切")}</dd></div>}</>}
   </dl>
   {generation?<><h5>{uiText("制作提示词")}</h5><p className="workspace-saved-caption">{generation.prompt||uiText("未记录提示词正文")}</p>{generation.actualPrompt&&generation.actualPrompt!==generation.prompt&&<details><summary>{uiText("实际提交提示词")}</summary><p className="workspace-saved-caption">{generation.actualPrompt}</p></details>}{brief&&<p>{uiText(framingLabels[brief.framing])} · {uiText(captionSpaceLabels[brief.captionSpace])} · {brief.crop==='protect'?uiText("主体完整，边缘留余量"):uiText("裁切由提示词决定")}</p>}{generation.referenceMaterialRevisionIds?.map(id=>{const r=brief?.references.find(r=>r.materialRevisionId===id);return <p key={id}>{uiText("参考图：")}{materialName(id)}{r?` · ${referencePurposeLabels[r.purpose]}`:''}{r?.preserve?uiText(" · 保留：{value0}",{value0:String(r.preserve)}):''}{r?.change?uiText(" · 允许改变：{value0}",{value0:String(r.change)}):''}</p>;})}{candidate.kind==='video'&&generation.videoSettings&&<VideoSettingsFacts settings={generation.videoSettings}/>}</>:<p>{candidate.source?uiText("Pexels 素材 · {value0}",{value0:String(candidate.source.query)}):candidate.taskId?uiText("此旧任务未保留完整生成快照，无法还原当时参数。"):uiText("导入素材，没有生成请求。")}</p>}
   </details>
  </article>;})}
  {tasks.map(task=><article key={task.id} aria-label={uiText("未产出画面的制作请求")}><h4>{task.kind==='image'?uiText("图片"):uiText("视频")}{uiText("请求 · ")}{({completed:'已完成，未找到产物记录',ready:'等待执行',running:'执行中',failed:'失败',blocked:'待核对'} as Record<string,string>)[task.status]??task.status}</h4><dl className="workspace-saved-facts"><div><dt>{uiText("原任务")}</dt><dd>{task.taskId}</dd></div>{task.generation?.selection&&<><div><dt>{uiText("连接")}</dt><dd>{task.generation.connectionName??task.generation.selection.connectionVersionId}</dd></div><div><dt>{uiText("模型")}</dt><dd>{task.generation.selection.model}</dd></div></>}{task.generation?.imageSettings&&<div><dt>{uiText("请求尺寸／数量／质量")}</dt><dd>{task.generation.imageSettings.size.replace('x',' × ')} · {task.generation.imageSettings.count}{uiText(" 张 · ")}{uiText(imageQualityLabels[task.generation.imageSettings.quality])}</dd></div>}{task.kind==='video'&&task.generation&&<><div><dt>{uiText("请求时长")}</dt><dd>{task.generation.durationSeconds} s</dd></div><div><dt>{uiText("首帧")}</dt><dd>{task.generation.firstFrameMaterialRevisionId?materialName(task.generation.firstFrameMaterialRevisionId):uiText("未记录")}</dd></div></>}</dl>{task.generation?<><h5>{uiText("制作提示词")}</h5><p className="workspace-saved-caption">{task.generation.prompt}</p>{task.generation.referenceMaterialRevisionIds?.map(id=><p key={id}>{uiText("参考图：")}{materialName(id)}</p>)}{task.kind==='video'&&task.generation.videoSettings&&<VideoSettingsFacts settings={task.generation.videoSettings}/>}{task.generation.actualPrompt&&task.generation.actualPrompt!==task.generation.prompt&&<details><summary>{uiText("实际提交提示词")}</summary><p className="workspace-saved-caption">{task.generation.actualPrompt}</p></details>}</>:<p>{uiText("此旧任务未保留完整生成快照，无法还原当时参数。")}</p>}{task.error&&<p>{uiText(task.error)}</p>}</article>)}
 </section>;
}

function VideoSettingsFacts({settings}:{settings:WanGenerationSettings}){return <dl className="workspace-saved-facts">{Object.entries(settings).filter(([,value])=>value!==undefined&&value!=='').map(([key,value])=><div key={key}><dt>{wanSettingLabels[key as keyof WanGenerationSettings]??key}</dt><dd>{typeof value==='boolean'?value?uiText("开启"):uiText("关闭"):key==='shotType'?value==='single'?uiText("单镜头"):uiText("多镜头"):String(value)}</dd></div>)}</dl>;}
