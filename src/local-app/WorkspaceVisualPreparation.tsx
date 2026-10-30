import {useEffect,useRef,useState,type ReactNode} from 'react';
import {ChevronLeft,ChevronRight,Upload,Image as ImageIcon,Video,Maximize2,X} from 'lucide-react';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import {NativeSelect} from '../ui/dan-ui/components/base/select/select-native';
import type {ProductionWorkspace} from '../productionWorkspace';
import type {WorkspaceVisualCandidate} from '../workspaceVisualCandidates';
import type {ImageGenerationSettings} from '../imageGeneration';
import {defaultWanSettings,type WanGenerationSettings} from '../videoGenerationSettings';
import {WorkspaceGenerationBudget} from './WorkspaceGenerationBudget';
import './workspace-visual-preparation.css';

type Kind='image'|'video';
interface Material{id:string;material_type:string;source_path:string;storage_path?:string}
export interface VisualPreparationProps {
 workspace:ProductionWorkspace;command:(name:string,data:unknown)=>Promise<unknown>;onChange:(w:ProductionWorkspace)=>void;
 materials:Material[];selectedShotId?:string;selectedTargetItemId?:string;onTargetChange?:(id:string)=>void;
 currentVisualKind?:string;currentVisualPath?:string;currentMaterialRevisionId?:string;preview?:ReactNode;readOnly?:boolean;
 onImported?:(material:Material&{storage_path:string})=>void;
}
interface Draft {videoSettings:WanGenerationSettings;firstFrameFit:'contain'|'cover';tab:Kind;origin:Record<Kind,'material'|'generate'>;imagePrompt:string;videoPrompt:string;references:string[];firstFrame:string;settings:ImageGenerationSettings;amount:string;duration:string;usage:'still'|'pan-zoom';selected:Record<Kind,string>}
function initialDraft(props:VisualPreparationProps,targetItemId:string):Draft {
 const sizeTarget=props.workspace.visualTargets?.find(t=>t.targetItemId===targetItemId),ratio=(sizeTarget?.width??9)/(sizeTarget?.height??16),size:ImageGenerationSettings['size']=ratio>1.15?'1536x864':ratio<0.85?'864x1536':'1024x1024';
 const selected=props.workspace.selectedImages?.find(s=>s.targetItemId===targetItemId)?.materialRevisionId;
 return {videoSettings:{...defaultWanSettings},firstFrameFit:'contain',tab:props.currentVisualKind==='video'?'video':'image',origin:{image:'material',video:'material'},imagePrompt:'',videoPrompt:'',references:[],firstFrame:selected??(props.currentVisualKind==='image'?props.currentMaterialRevisionId??'':''),settings:{size,quality:'auto',count:1},amount:'',duration:String(Math.max(3,sizeTarget?.minimumSeconds??2)),usage:'still',selected:{image:'',video:''}};
}
export function WorkspaceVisualPreparation(props:VisualPreparationProps){
 const options=props.selectedShotId?props.workspace.clips.filter(c=>c.shotId===props.selectedShotId):props.workspace.clips;
 const target=options.find(c=>c.itemId===props.selectedTargetItemId)??options[0];
 return target?<VisualPreparationTarget key={props.workspace.id+':'+target.itemId} {...props} targetItemId={target.itemId} options={options}/>:null;
}
function VisualPreparationTarget(props:VisualPreparationProps&{targetItemId:string;options:ProductionWorkspace['clips']}){
 const {workspace,command,onChange,targetItemId,options}=props,storageKey=`loop-visual-draft:${workspace.id}:${targetItemId}`;
 const [draft,setDraft]=useState<Draft>(()=>{try{const saved=JSON.parse(sessionStorage.getItem(storageKey)??'null');if(saved?.settings&&['image','video'].includes(saved.tab))return {...initialDraft(props,targetItemId),...saved};}catch{/* A missing browser draft is an empty form. */}return initialDraft(props,targetItemId);});
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[uploads,setUploads]=useState<Material[]>([]),[rangeStart,setRangeStart]=useState('0'),[rangeEnd,setRangeEnd]=useState(''),[policy,setPolicy]=useState('keep-target'),[acceptImpact,setAcceptImpact]=useState(false),[zoom,setZoom]=useState(false);
 const working=useRef(false),fileInput=useRef<HTMLInputElement>(null),referenceInput=useRef<HTMLInputElement>(null),latest=useRef(workspace),onChanged=useRef(onChange),mounted=useRef(true),zoomClose=useRef<HTMLButtonElement>(null),zoomTrigger=useRef<HTMLButtonElement>(null);
 latest.current=workspace;onChanged.current=onChange;
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 useEffect(()=>{try{sessionStorage.setItem(storageKey,JSON.stringify(draft));}catch{/* Storage is optional. */}},[storageKey,draft]);
 useEffect(()=>{if(!zoom)return;zoomClose.current?.focus();return()=>zoomTrigger.current?.focus();},[zoom]);
 const candidates=(workspace.visualCandidates??[]).filter(c=>c.targetItemId===targetItemId&&c.status!=='rejected');
 const allMaterials=[...props.materials,...uploads,...(workspace.visualCandidates??[]).filter(c=>c.kind==='image'&&c.materialRevisionId).map(c=>({id:c.materialRevisionId!,material_type:'image',source_path:c.relativePath.split('/').pop()??'生成图片',storage_path:c.relativePath}))].filter((m,i,a)=>a.findIndex(x=>x.id===m.id)===i);
 const videoProvider=workspace.visualTargets?.find(t=>t.targetItemId===targetItemId)?.provider??workspace.visualConfiguration?.videoProvider,videoModel=workspace.visualTargets?.find(t=>t.targetItemId===targetItemId)?.model??workspace.visualConfiguration?.videoModel;
 const tab=draft.tab,kindName=tab==='image'?'图片':'视频',origin=draft.origin[tab],disabled=busy||props.readOnly||workspace.stale;
 const visible=candidates.filter(c=>c.kind===tab),currentEntry=props.currentVisualKind===tab&&!visible.some(c=>c.relativePath===props.currentVisualPath);
 const entries=[...(currentEntry?[{id:'current',candidate:null}]:[]),...visible.map(c=>({id:c.id,candidate:c}))];
 const active=entries.find(e=>e.id===draft.selected[tab])??entries[0],index=entries.findIndex(e=>e.id===active?.id),candidate=active?.candidate;
 const reference=allMaterials.find(m=>m.id===draft.firstFrame),selectedImage=workspace.selectedImages?.find(s=>s.targetItemId===targetItemId);
 const current=candidate?.relativePath===props.currentVisualPath||active?.id==='current',imageChosen=!!candidate&&selectedImage?.candidateId===candidate.id;
 const target=workspace.visualTargets?.find(t=>t.targetItemId===targetItemId),voiceDriven=!!target&&target.voiceMode!=='none';
 const actualDuration=voiceDriven?target.durationSeconds:Number(draft.duration),invalidDuration=!actualDuration||actualDuration<(voiceDriven?0.1:target?.minimumSeconds??2)||actualDuration>(target?.maximumSeconds??15);
 const tasks=(workspace.visualTasks??[]).filter(t=>!t.shotId||options.some(c=>c.shotId===t.shotId)),pending=tasks.filter(t=>['ready','running'].includes(t.status)),taskKey=pending.map(t=>t.taskId).join(':');
 const priorIds=useRef(new Set(candidates.map(c=>c.id)));
 useEffect(()=>{const added=candidates.filter(c=>!priorIds.current.has(c.id));priorIds.current=new Set(candidates.map(c=>c.id));if(added.length)setDraft(d=>({...d,selected:{...d.selected,[added[0].kind]:added[0].id}}));},[workspace.visualCandidates]);
 function change<K extends keyof Draft>(key:K,value:Draft[K]){setDraft(d=>({...d,[key]:value}));}
 function select(id:string){setDraft(d=>({...d,selected:{...d.selected,[d.tab]:id}}));setRangeStart('0');setRangeEnd('');setPolicy('keep-target');setAcceptImpact(false);setError('');}
 function url(path:string,sha256=''){return '/_local-artifact?'+new URLSearchParams({episode:workspace.episodeId,path,...(sha256?{sha256}:{})});}
 async function fresh(){const r=await fetch(`/api/local/episodes/${workspace.episodeId}/workspace`);if(!r.ok)throw Error('无法读取当前工程，请重试。');const w=(await r.json()).workspace as ProductionWorkspace;latest.current=w;onChanged.current(w);return w;}
 function base(w:ProductionWorkspace){return {episodeId:w.episodeId,workspaceId:w.id,expectedRevision:w.revision};}
 async function run(action:()=>Promise<void>){if(working.current)return;working.current=true;setBusy(true);setError('');setNotice('');try{await action();}catch(cause){if(mounted.current)setError(cause instanceof Error?cause.message:'操作未完成，请重试。');}finally{working.current=false;if(mounted.current)setBusy(false);}}
 useEffect(()=>{if(!taskKey)return;let active=true,reading=false;const timer=setInterval(()=>{if(reading||working.current)return;reading=true;void fetch(`/api/local/episodes/${workspace.episodeId}/workspace`).then(async r=>{if(!r.ok)throw Error();const w=(await r.json()).workspace;if(active){latest.current=w;onChanged.current(w);}}).catch(()=>{if(active)setError('任务状态暂时无法更新，可点击刷新重试。');}).finally(()=>{reading=false;});},2000);return()=>{active=false;clearInterval(timer);};},[taskKey,workspace.episodeId]);
 async function register(materialId:string,kind:Kind){const w=await fresh();const next=await command('registerWorkspaceVisualCandidate',{...base(w),targetItemId,materialRevisionId:materialId,usage:kind==='video'?'video':draft.usage,durationSeconds:3}) as ProductionWorkspace;latest.current=next;onChanged.current(next);const added=next.visualCandidates?.find(c=>c.targetItemId===targetItemId&&c.materialRevisionId===materialId);if(mounted.current&&added)setDraft(d=>({...d,tab:kind,selected:{...d.selected,[kind]:added.id}}));}
 async function upload(files:File[],asReference=false){await run(async()=>{
   if(asReference&&tab==='image'&&files.length+draft.references.length>16)throw Error('最多可添加 16 张参考图。');
   for(const file of files){
    if(!file.size||file.size>100*1024*1024)throw Error('素材不能为空或超过 100 MB。');
    const kind=file.type.startsWith('image/')?'image':'video';
    if(asReference&&!['image/png','image/jpeg','image/webp'].includes(file.type)||!asReference&&(kind!==tab||!['image/png','image/jpeg','image/webp','image/bmp','video/mp4'].includes(file.type)))throw Error(asReference?'请选择 PNG、JPEG 或 WebP 参考图。':`请选择有效的${kindName}文件。`);
    if(asReference&&file.size>20*1024*1024)throw Error('每张参考图不能超过 20 MB。');
    const contentBase64=await new Promise<string>((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result).split(',')[1]);r.onerror=()=>reject(Error('文件读取失败。'));r.readAsDataURL(file);});
    const m=await command('importMaterial',{episodeId:workspace.episodeId,sourceKind:'file',sourcePath:file.name,materialType:kind,mimeType:file.type,contentBase64,isMainScript:false,materialPurpose:kind==='image'?'visual_reference':'b_roll'}) as Material&{storage_path:string};
    const registered={...m,id:m.id,source_path:file.name,material_type:kind};
    if(mounted.current)setUploads(rows=>[...rows,registered]);props.onImported?.(registered);
    if(asReference){if(mounted.current)setDraft(d=>tab==='image'?{...d,references:[...new Set([...d.references,m.id])].slice(0,16)}:{...d,firstFrame:m.id});}
    else await register(m.id,kind);
   }
   if(mounted.current)setNotice(asReference?'参考图已导入，尚未提交生成。':'素材已加入候选，请预览后手动采用。');
  });}
 async function adopt(c:WorkspaceVisualCandidate){await run(async()=>{
   let w=await fresh();
   if(c.kind==='image'&&props.currentVisualKind==='video'){
    const next=await command('retainWorkspaceImageCandidate',{...base(w),candidateId:c.id}) as ProductionWorkspace;onChanged.current(next);setDraft(d=>({...d,firstFrame:d.firstFrame||c.materialRevisionId||''}));setNotice('图片已选用；当前镜头继续优先使用视频。');return;
   }
   const prepared=await command('prepareWorkspaceVisualCandidate',{...base(w),candidateId:c.id,durationPolicy:policy,acceptTimelineImpact:acceptImpact,motionPolicy:draft.usage==='pan-zoom'?'replace-motion':'preserve-target',...(c.kind==='image'?{imageUsage:draft.usage}:Number(rangeStart)!==0||rangeEnd?{sourceInSeconds:Number(rangeStart),sourceOutSeconds:rangeEnd?Number(rangeEnd):c.durationSeconds}:{})}) as {adoptionId:string};
   w=await fresh();onChanged.current(await command('adoptWorkspaceVisualCandidate',{...base(w),candidateId:c.id,adoptionId:prepared.adoptionId}) as ProductionWorkspace);
   if(c.kind==='image'&&c.materialRevisionId)setDraft(d=>({...d,firstFrame:d.firstFrame||c.materialRevisionId!}));
   setNotice(`已采用${c.kind==='image'?'图片':'视频'}。`);
  });}
 async function generate(){await run(async()=>{
   const w=await fresh();
   if(tab==='video'){
    const after=w.visualTargets?.find(t=>t.targetItemId===targetItemId);
    if(JSON.stringify(after)!==JSON.stringify(target))throw Error('当前口播窗口已变化，请重新确认时长后生成。');
   }
   const amount=Math.round(Number(draft.amount)*100);
   const next=await command(tab==='image'?'requestWorkspaceImageCandidates':'requestWorkspaceVisualCandidate',{
    ...base(w),targetItemId,prompt:tab==='image'?draft.imagePrompt:draft.videoPrompt,reservationCents:amount,
    ...(tab==='image'?{model:workspace.visualConfiguration?.imageModel??'gpt-image-2',settings:draft.settings,referenceMaterialRevisionIds:draft.references}:{firstFrameMaterialRevisionId:draft.firstFrame,durationSeconds:actualDuration,firstFrameFit:draft.firstFrameFit,...(videoProvider==='bailian'?{videoSettings:draft.videoSettings}:{})})
   }) as ProductionWorkspace;
   onChanged.current(next);setNotice('生成任务已提交，完成后请预览并手动采用。');
  });}
 function linkFirstFrame(){if(!candidate?.materialRevisionId)return;setDraft(d=>({...d,firstFrame:candidate.materialRevisionId!,tab:'video',origin:{...d.origin,video:'generate'}}));setNotice('已选定视频首帧，尚未提交生成。');}
 const selectedVideoDuration=candidate?.kind==='video'?(rangeEnd?Number(rangeEnd):candidate.durationSeconds)-Number(rangeStart):null,rangeValid=!candidate||candidate.kind!=='video'||Number(rangeStart)>=0&&Number.isFinite(Number(rangeStart))&&Number.isFinite(selectedVideoDuration)&&selectedVideoDuration!>0&&(rangeEnd?Number(rangeEnd):candidate.durationSeconds)<=candidate.durationSeconds;
 const canAdopt=rangeValid&&!!candidate&&candidate.status==='available'&&(policy==='keep-target'?candidate.kind!=='video'||candidate.currentDurationSeconds===null||(selectedVideoDuration??candidate.durationSeconds)+0.05>=candidate.currentDurationSeconds:acceptImpact);
 const prompt=tab==='image'?draft.imagePrompt:draft.videoPrompt,amountValid=Number.isFinite(Number(draft.amount))&&Number(draft.amount)>0&&Number(draft.amount)<=1000;
 const canGenerate=prompt.trim()&&amountValid&&!pending.some(t=>(t.kind??'video')===tab)&&(tab==='image'?!!workspace.visualConfiguration?.imageModel:!!draft.firstFrame&&!invalidDuration);
 return <section className="workspace-visual-candidates workspace-visual-unified" aria-label="镜头图片与视频">
  <header><div className="workspace-visual-preview-tabs" role="tablist" aria-label="画面类型">{(['image','video'] as const).map(kind=><button key={kind} id={`visual-kind-${targetItemId}-${kind}`} type="button" role="tab" aria-selected={tab===kind} aria-controls={`visual-content-${targetItemId}`} tabIndex={tab===kind?0:-1} onClick={()=>change('tab',kind)} onKeyDown={e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();const next=e.key==='Home'?'image':e.key==='End'?'video':tab==='image'?'video':'image';change('tab',next);document.getElementById(`visual-kind-${targetItemId}-${next}`)?.focus();}}}>{kind==='image'?'图片':'视频'}</button>)}</div><Button size="sm" color="tertiary" isDisabled={disabled} onPress={()=>void run(async()=>{await fresh();})}>刷新</Button></header>
  {options.length>1&&<label>目标片段<NativeSelect size="sm" aria-label="画面候选目标" value={targetItemId} disabled={disabled} onChange={e=>props.onTargetChange?.(e.target.value)}>{options.map((c,i)=><option key={c.itemId} value={c.itemId}>片段 {i+1} · {c.text}</option>)}</NativeSelect></label>}
  <div id={`visual-content-${targetItemId}`} role="tabpanel" aria-labelledby={`visual-kind-${targetItemId}-${tab}`} className="workspace-visual-content">
   <div className="workspace-unified-preview" onKeyDown={e=>{if(e.target!==e.currentTarget||entries.length<2)return;if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();select(entries[(index+(e.key==='ArrowRight'?1:-1)+entries.length)%entries.length].id);}}} tabIndex={entries.length>1?0:undefined} aria-label={`${kindName}预览`}>
    {active?.id==='current'?props.preview:candidate?(tab==='image'?<img src={url(candidate.relativePath,candidate.sha256)} alt={`${kindName}候选 ${index+1}`}/>:<video key={candidate.id} src={url(candidate.relativePath,candidate.sha256)} controls preload="metadata" aria-label="视频候选预览" onLoadedMetadata={e=>{e.currentTarget.currentTime=Number(rangeStart);}} onPlay={e=>{const end=rangeEnd?Number(rangeEnd):candidate.durationSeconds;if(e.currentTarget.currentTime<Number(rangeStart)||e.currentTarget.currentTime>=end)e.currentTarget.currentTime=Number(rangeStart);}} onTimeUpdate={e=>{const end=rangeEnd?Number(rangeEnd):candidate.durationSeconds;if(!e.currentTarget.paused&&e.currentTarget.currentTime>=end){e.currentTarget.pause();e.currentTarget.currentTime=end;}}}/>):<div className="workspace-visual-empty">{tab==='image'?<ImageIcon size={28} aria-hidden="true"/>:<Video size={28} aria-hidden="true"/>}<p>尚未添加{kindName}</p><span>上传素材，或使用 AI 生成</span></div>}
    {entries.length>1&&<div className="workspace-preview-pagination"><button type="button" aria-label={`上一${tab==='image'?'张图片':'个视频'}`} onClick={()=>select(entries[(index-1+entries.length)%entries.length].id)}><ChevronLeft size={16}/></button><span aria-live="polite">第 {index+1} / {entries.length} {tab==='image'?'张':'个'}</span><button type="button" aria-label={`下一${tab==='image'?'张图片':'个视频'}`} onClick={()=>select(entries[(index+1)%entries.length].id)}><ChevronRight size={16}/></button></div>}
    {candidate&&tab==='image'&&<button ref={zoomTrigger} className="workspace-preview-zoom" type="button" aria-label="放大图片" onClick={()=>setZoom(true)}><Maximize2 size={16}/></button>}
   </div>
   {active&&<div className="workspace-preview-caption"><span>{(candidate?allMaterials.find(m=>m.storage_path===candidate.relativePath)?.source_path.split('/').pop()??candidate.relativePath.split('/').pop():'当前画面')}</span><span>{current?'已采用':imageChosen?'已选用 · 视频优先':candidate?.status==='stale'?'输入已变化':'待采用'}</span></div>}
   {candidate&&!current&&<div className="workspace-visual-adoption">
    <div className="workspace-visual-actions"><Button size="sm" color="primary" isDisabled={disabled||!canAdopt||imageChosen} onPress={()=>void adopt(candidate)}>{imageChosen?'图片已选用':`采用此${kindName}`}</Button>{tab==='image'&&candidate.materialRevisionId&&<Button size="sm" color="secondary" isDisabled={disabled||candidate.status==='stale'} onPress={linkFirstFrame}>用作视频首帧</Button>}</div>
    <details><summary>使用设置</summary><div className="workspace-adoption-settings">
    {candidate.kind==='image'&&<label>图片使用方式<NativeSelect size="sm" aria-label="图片使用方式" disabled={disabled} value={draft.usage} onChange={e=>change('usage',e.target.value as Draft['usage'])}><option value="still">静帧</option><option value="pan-zoom">轻微推拉</option></NativeSelect></label>}
    {candidate.kind==='video'&&<div className="workspace-visual-fields"><label>使用起点（秒）<input type="number" aria-label="视频使用起点（秒）" min="0" max={candidate.durationSeconds} step="0.1" disabled={disabled} value={rangeStart} onChange={e=>setRangeStart(e.target.value)}/></label><label>使用终点（秒）<input type="number" aria-label="视频使用终点（秒）" min="0.1" max={candidate.durationSeconds} step="0.1" disabled={disabled} value={rangeEnd||candidate.durationSeconds} onChange={e=>setRangeEnd(e.target.value)}/></label></div>}
    <label>采用时长<NativeSelect size="sm" aria-label="视觉候选时长处理" disabled={disabled} value={policy} onChange={e=>{setPolicy(e.target.value);setAcceptImpact(false);}}><option value="keep-target">保留镜头时长</option><option value="use-candidate">使用素材完整时长</option></NativeSelect></label>
    {policy==='use-candidate'&&<label className="workspace-visual-checkbox"><input type="checkbox" disabled={disabled} checked={acceptImpact} onChange={e=>setAcceptImpact(e.target.checked)}/>保留其他片段位置，接受空隙或覆盖</label>}
    {policy==='keep-target'&&candidate.kind==='video'&&candidate.currentDurationSeconds!==null&&(selectedVideoDuration??candidate.durationSeconds)+0.05<candidate.currentDurationSeconds&&<p role="alert">视频短于镜头，请调整时长后采用。</p>}

    {candidate.kind==='image'&&props.currentVisualKind==='video'&&<small>图片保留为备用画面，当前视频优先。</small>}
    </div></details>
   </div>}
   {candidate&&current&&tab==='image'&&candidate.materialRevisionId&&<Button size="sm" color="secondary" isDisabled={disabled} onPress={linkFirstFrame}>用作视频首帧</Button>}
   <div className="workspace-visual-origin" role="group" aria-label={`${kindName}来源`}>{(['material','generate'] as const).map(value=><button key={value} type="button" aria-pressed={origin===value} onClick={()=>setDraft(d=>({...d,origin:{...d.origin,[tab]:value}}))}>{value==='material'?'上传素材':'AI 生成'}</button>)}</div>
   {origin==='material'?<div className="workspace-visual-import">
    <button type="button" className="workspace-visual-dropzone" disabled={disabled} onClick={()=>fileInput.current?.click()} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();if(!disabled)void upload([...e.dataTransfer.files]);}}><Upload size={18} aria-hidden="true"/><span>选择或拖入{kindName}</span><small>{tab==='image'?'PNG、JPEG、WebP、BMP，可多选':'MP4，最大 100 MB'}</small></button>
    <details><summary>从本期素材选择</summary><label>本期{kindName}<NativeSelect size="sm" aria-label={`选择本期${kindName}`} value="" disabled={disabled} onChange={e=>{if(e.target.value)void run(()=>register(e.target.value,tab));}}><option value="">选择后加入候选</option>{allMaterials.filter(m=>m.material_type===tab).map(m=><option key={m.id} value={m.id}>{m.source_path.split('/').pop()}</option>)}</NativeSelect></label></details>
   </div>:<div className="workspace-visual-generation-form">
    <label>生成模型<NativeSelect size="sm" aria-label={`${kindName}生成模型`} value={tab==='image'?workspace.visualConfiguration?.imageModel??'':videoModel??''} disabled={disabled}><option value={tab==='image'?workspace.visualConfiguration?.imageModel??'':videoModel??''}>{(tab==='image'?workspace.visualConfiguration?.imageModel:videoModel)??'尚未配置模型'}</option></NativeSelect></label>
    {tab==='image'?<div className="workspace-reference-input"><div className="workspace-reference-label"><span>参考图（可选）</span><Button size="sm" color="tertiary" isDisabled={disabled||draft.references.length>=16} onPress={()=>referenceInput.current?.click()}>导入参考图</Button></div>
     <div className="workspace-reference-thumbnails">{draft.references.map((id,i)=>{const m=allMaterials.find(x=>x.id===id);return <div key={id}>{m?.storage_path?<img src={url(m.storage_path)} alt={`参考图 ${i+1}`}/>:<span>参考图 {i+1}</span>}<button type="button" aria-label={`移除参考图 ${i+1}`} disabled={disabled} onClick={()=>change('references',draft.references.filter(x=>x!==id))}><X size={12}/></button></div>;})}</div>
     <NativeSelect size="sm" aria-label="添加本期参考图" value="" disabled={disabled||draft.references.length>=16} onChange={e=>{if(e.target.value)change('references',[...draft.references,e.target.value]);}}><option value="">从本期图片添加</option>{allMaterials.filter(m=>m.material_type==='image'&&!draft.references.includes(m.id)).map(m=><option key={m.id} value={m.id}>{m.source_path.split('/').pop()}</option>)}</NativeSelect>
    </div>:<div className="workspace-first-frame"><label>视频首帧<NativeSelect size="sm" aria-label="画面首帧图片" value={draft.firstFrame} disabled={disabled} onChange={e=>change('firstFrame',e.target.value)}><option value="">选择本镜头图片或本期图片</option>{allMaterials.filter(m=>m.material_type==='image').map(m=><option key={m.id} value={m.id}>{m.source_path.split('/').pop()}</option>)}</NativeSelect></label><div className="workspace-first-frame-row">{reference?.storage_path?<img src={url(reference.storage_path)} alt="已选视频首帧" style={{objectFit:draft.firstFrameFit,aspectRatio:`${target?.width??9}/${target?.height??16}`,width:Math.min(180,112*(target?.width??9)/(target?.height??16))}}/>:<span>尚未选择首帧</span>}<Button size="sm" color="secondary" isDisabled={disabled} onPress={()=>referenceInput.current?.click()}>上传首帧</Button></div><label>首帧构图<NativeSelect size="sm" aria-label="首帧构图" disabled={disabled} value={draft.firstFrameFit} onChange={e=>change('firstFrameFit',e.target.value as Draft['firstFrameFit'])}><option value="contain">完整保留，必要时留边</option><option value="cover">居中裁切，填满画面</option></NativeSelect></label><small>本次生成固定使用这张图片；换图不会改变已有视频。</small></div>}
    <label>{kindName}提示词<textarea aria-label={tab==='image'?'图片提示词':'画面动作'} rows={4} maxLength={tab==='image'?1200:1500} disabled={disabled} value={prompt} onChange={e=>change(tab==='image'?'imagePrompt':'videoPrompt',e.target.value)} placeholder={tab==='video'?'例如：以首帧为起点，镜头缓慢向装饰画推进，保持画框、图案和文字稳定，单镜头，不切换场景。':draft.references.length?'例如：保留参考图中装饰画的图案、文字和边框，将背景改为明亮的现代客厅，产品居中完整展示，竖屏构图。':'例如：竖屏产品摄影，金色山水装饰画挂在现代客厅，清晨侧光，完整展示画框细节，写实质感，不添加额外文字。'}/></label>
    {tab==='image'?<div className="workspace-visual-fields"><label>画面比例<NativeSelect size="sm" aria-label="图片画面比例" value={draft.settings.size} disabled={disabled} onChange={e=>change('settings',{...draft.settings,size:e.target.value as ImageGenerationSettings['size']})}><option value="864x1536">竖屏 9:16</option><option value="1536x864">横屏 16:9</option><option value="1024x1024">方形 1:1</option><option value="1024x1536">竖图 2:3</option><option value="1536x1024">横图 3:2</option></NativeSelect></label><label>数量<NativeSelect size="sm" aria-label="生成图片数量" value={draft.settings.count} disabled={disabled} onChange={e=>change('settings',{...draft.settings,count:Number(e.target.value) as 1|2|4})}>{[1,2,4].map(n=><option key={n} value={n}>{n} 张</option>)}</NativeSelect></label><label>质量<NativeSelect size="sm" aria-label="图片质量" value={draft.settings.quality} disabled={disabled} onChange={e=>change('settings',{...draft.settings,quality:e.target.value as ImageGenerationSettings['quality']})}><option value="auto">自动</option><option value="low">低</option><option value="medium">中</option><option value="high">高</option></NativeSelect></label></div>:<><label>画面时长（秒）<input aria-label="生成时长（秒）" type="number" min={target?.minimumSeconds??2} max={target?.maximumSeconds??15} step="1" value={voiceDriven?target?.durationSeconds??'':draft.duration} readOnly={voiceDriven} disabled={disabled} onChange={e=>change('duration',e.target.value)}/></label>{voiceDriven&&<p>按当前口播使用 {target.durationSeconds??'—'} 秒，服务请求 {target.providerDurationSeconds??'—'} 秒。</p>}{invalidDuration&&<p role="alert">该模型支持 {target?.minimumSeconds??2}～{target?.maximumSeconds??15} 秒；超过上限时需先拆分镜头。</p>}</>}
    {tab==='video'&&videoProvider==='bailian'&&<details className="workspace-video-advanced"><summary>高级生成设置</summary><div className="workspace-video-advanced-fields">
      <label>分辨率<NativeSelect size="sm" aria-label="视频分辨率" disabled={disabled} value={draft.videoSettings.resolution} onChange={e=>change('videoSettings',{...draft.videoSettings,resolution:e.target.value as '720P'|'1080P'})}><option value="720P">720P</option><option value="1080P">1080P</option></NativeSelect></label>
      <label>负面提示词<textarea aria-label="视频负面提示词" rows={2} maxLength={500} disabled={disabled} value={draft.videoSettings.negativePrompt} onChange={e=>change('videoSettings',{...draft.videoSettings,negativePrompt:e.target.value})} placeholder="例如：画框变形、文字变化、画面闪烁、突然切镜。"/></label>
      <label>随机种子（可选）<input type="number" aria-label="视频随机种子" min="0" max="2147483647" step="1" disabled={disabled} value={draft.videoSettings.seed??''} onChange={e=>change('videoSettings',{...draft.videoSettings,seed:e.target.value===''?undefined:Number(e.target.value)})}/></label>
      <label className="workspace-visual-checkbox"><input type="checkbox" checked={draft.videoSettings.promptExtend} disabled={disabled} onChange={e=>change('videoSettings',{...draft.videoSettings,promptExtend:e.target.checked,shotType:e.target.checked?draft.videoSettings.shotType:'single'})}/>智能扩写提示词</label>
      {draft.videoSettings.promptExtend&&<label>镜头结构<NativeSelect size="sm" aria-label="视频镜头结构" disabled={disabled} value={draft.videoSettings.shotType} onChange={e=>change('videoSettings',{...draft.videoSettings,shotType:e.target.value as 'single'|'multi'})}><option value="single">单镜头</option><option value="multi">多镜头</option></NativeSelect></label>}
      <label className="workspace-visual-checkbox"><input type="checkbox" checked={draft.videoSettings.audio} disabled={disabled} onChange={e=>change('videoSettings',{...draft.videoSettings,audio:e.target.checked})}/>生成视频声音</label>
      <label className="workspace-visual-checkbox"><input type="checkbox" checked={draft.videoSettings.watermark} disabled={disabled} onChange={e=>change('videoSettings',{...draft.videoSettings,watermark:e.target.checked})}/>添加模型水印</label>
      <small>分辨率、时长和声音会影响费用；种子相同也不保证结果完全一致。</small>
    </div></details>}
    <label>本次费用预留（元）<input type="number" aria-label="本次费用预留（元）" min="0.01" max="1000" step="0.01" value={draft.amount} disabled={disabled} onChange={e=>change('amount',e.target.value)}/></label>
    <WorkspaceGenerationBudget episodeId={workspace.episodeId} command={command} disabled={disabled} unified/>
    <Button size="sm" color="primary" isDisabled={disabled||!canGenerate} onPress={()=>void generate()}>{pending.some(t=>(t.kind??'video')===tab)?'正在生成…':`生成${kindName}`}</Button>
   </div>}
   {candidate?.generation&&<details><summary>查看生成设置</summary><p>{candidate.generation.prompt}</p>{candidate.kind==='video'&&<p>首帧：{allMaterials.find(m=>m.id===candidate.generation!.firstFrameMaterialRevisionId)?.source_path.split('/').pop()??candidate.generation.firstFrameMaterialRevisionId}</p>}<Button size="sm" color="tertiary" isDisabled={disabled} onPress={()=>setDraft(d=>({...d,origin:{...d.origin,[tab]:'generate'},...(tab==='image'?{imagePrompt:candidate.generation!.prompt,settings:candidate.generation!.imageSettings??d.settings,references:candidate.generation!.referenceMaterialRevisionIds??[]}:{videoPrompt:candidate.generation!.prompt,firstFrame:candidate.generation!.firstFrameMaterialRevisionId,duration:String(candidate.generation!.durationSeconds),videoSettings:candidate.generation!.videoSettings??{...defaultWanSettings},firstFrameFit:candidate.generation!.firstFrameFit??'contain'})}))}>复用生成设置</Button></details>}
  </div>
  {tasks.filter(t=>t.status!=='completed').map(t=><div className="workspace-visual-task" key={t.id}><p role={t.error?'alert':'status'}>{(t.kind??'video')==='image'?'图片':'视频'}{t.status==='running'?'生成中':t.status==='ready'?'等待生成':t.status==='failed'?'生成失败':'生成受阻'}{t.error?` · ${t.error}`:''}</p>{t.canResume&&<Button size="sm" color="secondary" isDisabled={disabled} onPress={()=>void run(async()=>{const w=await fresh();onChanged.current(await command('retryWorkspaceVisualCandidate',{...base(w),candidateId:t.id}) as ProductionWorkspace);})}>恢复画面任务</Button>}</div>)}
  {notice&&<p role="status">{notice}</p>}{error&&<p role="alert">{error}</p>}
  <input ref={fileInput} hidden aria-label={`上传${kindName}素材`} type="file" multiple={tab==='image'} accept={tab==='image'?'image/png,image/jpeg,image/webp,image/bmp':'video/mp4'} disabled={disabled} onChange={e=>{const files=[...e.target.files??[]];e.target.value='';if(files.length)void upload(files);}}/>
  <input ref={referenceInput} hidden aria-label="导入生成参考图" type="file" multiple={tab==='image'} accept="image/png,image/jpeg,image/webp" disabled={disabled} onChange={e=>{const files=[...e.target.files??[]];e.target.value='';if(files.length)void upload(files,true);}}/>
  {zoom&&candidate&&<div className="workspace-image-lightbox" role="dialog" aria-modal="true" aria-label="图片大图预览" onKeyDown={e=>{if(e.key==='Escape')setZoom(false);if(e.key==='Tab'){e.preventDefault();zoomClose.current?.focus();}}}><button ref={zoomClose} type="button" aria-label="关闭大图预览" onClick={()=>setZoom(false)}><X size={20}/></button><img src={url(candidate.relativePath,candidate.sha256)} alt="图片候选大图"/></div>}
 </section>;
}
