import {useEffect,useState} from 'react';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import {NativeSelect} from '../ui/dan-ui/components/base/select/select-native';
import type {ProductionWorkspace} from '../productionWorkspace';
import type {WorkspaceVisualCandidate} from '../workspaceVisualCandidates';
import type {EmbeddedStudioBridge} from './EmbeddedStudioHost';
import './workspace-visual-candidates.css';
interface Material{id:string;material_type:string;source_path:string}
const labels={available:'待比较',stale:'输入已变化',adopted:'已采用',rejected:'已拒绝'};
export function WorkspaceVisualCandidatesPanel({workspace,command,onChange,bridge,materials}:{workspace:ProductionWorkspace;command:(name:string,data:unknown)=>Promise<unknown>;onChange:(workspace:ProductionWorkspace)=>void;bridge?:EmbeddedStudioBridge;materials:Material[]}){
 const [targetItemId,setTarget]=useState(workspace.clips[0]?.itemId??''),[policy,setPolicy]=useState<''|'keep-target'|'use-candidate'>(''),[acceptImpact,setAcceptImpact]=useState(false),[motionPolicy,setMotionPolicy]=useState<'preserve-target'|'replace-motion'>('preserve-target'),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [origin,setOrigin]=useState<'material'|'generate'>('material'),[firstFrameId,setFirstFrame]=useState(''),[prompt,setPrompt]=useState(''),[reservation,setReservation]=useState(''),[generationDuration,setGenerationDuration]=useState('3');
 const [uploaded,setUploaded]=useState<Material[]>([]),[imported,setImported]=useState(false);
 const allMaterials=[...materials,...uploaded.filter(m=>!materials.some(p=>p.id===m.id))];
 const [materialId,setMaterial]=useState(''),[usage,setUsage]=useState<'still'|'pan-zoom'>('still'),[duration,setDuration]=useState('3');
 const material=allMaterials.find(m=>m.id===materialId);
 const target=workspace.visualTargets?.find(target=>target.targetItemId===targetItemId),voiceDriven=target?.voiceMode==='tts'||target?.voiceMode==='source';
 const actualDuration=voiceDriven?Number(target?.durationSeconds):Number(generationDuration),voiceUnavailable=voiceDriven&&(!(Number(target?.durationSeconds)>0)||!(Number(target?.providerDurationSeconds)>0)),overMaximum=voiceDriven&&(Number(target?.durationSeconds)>Number(target?.maximumSeconds)||Number(target?.providerDurationSeconds)>Number(target?.maximumSeconds));
 const pendingTasks=workspace.visualTasks?.filter(task=>['ready','running'].includes(task.status))??[],taskKey=pendingTasks.map(task=>task.taskId+task.status).join(':');
 const disabled=busy||workspace.stale||!!bridge&&!bridge.connected,candidates=workspace.visualCandidates?.filter(c=>c.targetItemId===targetItemId)??[];
 useEffect(()=>{setPolicy('');setAcceptImpact(false);setMotionPolicy('preserve-target');},[workspace.id,targetItemId]);
 useEffect(()=>{if(!taskKey||busy)return;let active=true,reading=false;const timer=setInterval(()=>{if(reading)return;reading=true;void fetch('/api/local/episodes/'+workspace.episodeId+'/workspace').then(async response=>{if(response.ok&&active)onChange((await response.json()).workspace);}).catch(()=>{}).finally(()=>{reading=false;});},2000);return()=>{active=false;clearInterval(timer);};},[workspace.id,taskKey,busy]);
 async function fresh(){const response=await fetch('/api/local/episodes/'+workspace.episodeId+'/workspace');if(!response.ok)throw Error('无法读取当前工程版本。');return(await response.json()).workspace as ProductionWorkspace;}
 async function run(action:()=>Promise<void>){setBusy(true);setError('');try{await action();}catch(cause){setError(cause instanceof Error?cause.message:'画面候选操作未完成。');}finally{setBusy(false);}}
 async function current(){if(bridge)await bridge.save();return fresh();}
 function base(w:ProductionWorkspace){return{episodeId:w.episodeId,workspaceId:w.id,expectedRevision:w.revision};}
 async function addToPool(materialRevisionId:string,w:ProductionWorkspace){const prepared=await command('prepareWorkspaceVisualPool',{...base(w),materialRevisionId}) as {asset:unknown};await bridge!.applyNativeEdit('add-registered-source',{asset:prepared.asset});const next=await fresh();onChange(next);setImported(true);}
 async function upload(file:File){await run(async()=>{
  if(!file.size||file.size>100*1024*1024)throw Error('素材不能为空或超过100MB。');
  if(!['image/png','image/jpeg','image/webp','image/bmp','video/mp4'].includes(file.type))throw Error(file.type.startsWith('audio/')?'请在混音工具添加声音素材。':'请选择 PNG、JPEG、WebP、BMP 图片或 MP4 视频。');
  await current();
  const contentBase64=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>{const value=String(reader.result);resolve(value.slice(value.indexOf(',')+1));};reader.onerror=()=>reject(Error('文件读取失败，请重新选择。'));reader.readAsDataURL(file);});
  const kind=file.type.startsWith('image/')?'image':'video',registered=await command('importMaterial',{episodeId:workspace.episodeId,sourceKind:'file',sourcePath:file.name,materialType:kind,mimeType:file.type,contentBase64,isMainScript:false,materialPurpose:kind==='image'?'visual_reference':'b_roll'}) as {id:string};
  setUploaded(rows=>[...rows,{id:registered.id,material_type:kind,source_path:file.name}]);setMaterial(registered.id);setOrigin('material');if(kind==='image')setFirstFrame(registered.id);
  if(bridge)await addToPool(registered.id,await fresh());else onChange(await fresh());
 });}
 async function adopt(candidate:WorkspaceVisualCandidate){await run(async()=>{let w=await current();const prepared=await command('prepareWorkspaceVisualCandidate',{...base(w),candidateId:candidate.id,durationPolicy:policy,acceptTimelineImpact:acceptImpact,motionPolicy}) as {adoptionId:string;edit:unknown};if(bridge){await bridge.applyNativeEdit('apply-candidate',{edit:prepared.edit});w=await fresh();}onChange(await command('adoptWorkspaceVisualCandidate',{...base(w),candidateId:candidate.id,adoptionId:prepared.adoptionId,...(bridge?{nativeApplied:true}:{})}) as ProductionWorkspace);});}
 async function generate(){await run(async()=>{
  const w=await current(),latest=w.visualTargets?.find(target=>target.targetItemId===targetItemId);
  if((target?.voiceMode??'none')!==(latest?.voiceMode??'none')||(target?.durationSeconds??null)!==(latest?.durationSeconds??null)||(target?.providerDurationSeconds??null)!==(latest?.providerDurationSeconds??null)){
   onChange(w);throw Error('当前主声窗口已变化，请重新确认后生成画面。');
  }
  onChange(await command('requestWorkspaceVisualCandidate',{...base(w),targetItemId,firstFrameMaterialRevisionId:firstFrameId,prompt,durationSeconds:actualDuration,reservationCents:Number(reservation)}) as ProductionWorkspace);
 });}
 function artifact(path:string){return '/_local-artifact?episode='+encodeURIComponent(workspace.episodeId)+'&path='+encodeURIComponent(path);}
 return <section className="workspace-visual-candidates" aria-label="画面候选"><header><h3>画面版本</h3><Button size="sm" color="tertiary" isDisabled={disabled} onPress={()=>void run(async()=>onChange(await fresh()))}>刷新画面</Button></header>
  <label>目标片段<NativeSelect size="sm" aria-label="画面候选目标" value={targetItemId} disabled={disabled} onChange={event=>setTarget(event.target.value)}>{workspace.clips.map(clip=><option key={clip.itemId} value={clip.itemId}>{clip.shotId} · {clip.text} · {clip.itemId.slice(-6)}</option>)}</NativeSelect></label>
  <NativeSelect size="sm" aria-label="画面候选来源" value={origin} disabled={disabled} onChange={event=>setOrigin(event.target.value as typeof origin)}><option value="material">本期素材 / 上传</option><option value="generate">AI 视频</option></NativeSelect>
  {origin==='material'&&<div className="workspace-visual-add"><label className="workspace-visual-upload">上传图片或视频<input aria-label="上传补充画面" type="file" accept="image/png,image/jpeg,image/webp,image/bmp,video/mp4" disabled={disabled} onChange={event=>{const file=event.target.files?.[0];if(file){setImported(false);void upload(file);}event.target.value='';}}/></label><label>本期素材<NativeSelect size="sm" aria-label="本期画面素材" value={materialId} disabled={disabled} onChange={event=>{setMaterial(event.target.value);setImported(false);}}><option value="">选择视频或图片</option>{allMaterials.filter(m=>['image','video'].includes(m.material_type)).map(m=><option key={m.id} value={m.id}>{m.source_path.split('/').pop()}</option>)}</NativeSelect></label>
   <div className="workspace-visual-fields">{material?.material_type==='image'&&<label>使用方式<NativeSelect size="sm" aria-label="图片使用方式" value={usage} disabled={disabled} onChange={event=>setUsage(event.target.value as typeof usage)}><option value="still">静帧</option><option value="pan-zoom">本地推拉</option></NativeSelect></label>}<label>时长（秒）<input aria-label="候选时长（秒）" type="number" min="0.1" max="120" step="0.1" value={duration} disabled={disabled} onChange={event=>setDuration(event.target.value)}/></label></div>
   {bridge&&<Button size="sm" color="tertiary" isDisabled={disabled||!material} onPress={()=>void run(async()=>addToPool(materialId,await current()))}>加入剪辑素材池</Button>}
   {imported&&<p role="status">素材已登记并加入当前工程</p>}
   <Button size="sm" color="secondary" isDisabled={disabled||!targetItemId||!material||!duration||Number(duration)<=0} onPress={()=>void run(async()=>{const w=await current();onChange(await command('registerWorkspaceVisualCandidate',{...base(w),targetItemId,materialRevisionId:materialId,usage:material?.material_type==='image'?usage:'video',durationSeconds:Number(duration)}) as ProductionWorkspace);})}>添加为画面候选</Button>
  </div>}
  {origin==='generate'&&<div className="workspace-visual-add">
   <label>首帧图片<NativeSelect size="sm" aria-label="画面首帧图片" value={firstFrameId} disabled={disabled} onChange={event=>setFirstFrame(event.target.value)}><option value="">选择本期图片</option>{allMaterials.filter(m=>m.material_type==='image').map(m=><option key={m.id} value={m.id}>{m.source_path.split('/').pop()}</option>)}</NativeSelect></label>
   <label>镜头动作<input aria-label="画面动作" type="text" value={prompt} maxLength={1500} disabled={disabled} onChange={event=>setPrompt(event.target.value)}/></label>
   <div className="workspace-visual-fields"><label>画面时长（秒）<input aria-label="生成时长（秒）" type="number" min={voiceDriven?'0.1':'2'} max={target?.maximumSeconds??15} step={voiceDriven?'any':'1'} value={voiceDriven?target?.durationSeconds??'':generationDuration} readOnly={voiceDriven} disabled={disabled} onChange={event=>{if(!voiceDriven)setGenerationDuration(event.target.value);}}/></label><label>费用预留（分）<input aria-label="本次费用预留（分）" type="number" min="1" max="100000" step="1" value={reservation} disabled={disabled} onChange={event=>setReservation(event.target.value)}/></label></div>
   {voiceDriven&&target?.providerDurationSeconds!==null&&target?.providerDurationSeconds!==undefined&&<p role="status">服务请求 {target.providerDurationSeconds} 秒</p>}
   {voiceDriven&&Number(target?.durationSeconds)<Number(target?.minimumSeconds)&&<p role="status">服务最短 {target?.minimumSeconds} 秒，画面按主声 {target?.durationSeconds} 秒使用。</p>}
   {overMaximum?<p role="alert">主声窗口超过服务上限 {target?.maximumSeconds} 秒，请先明确拆分镜头。</p>:voiceUnavailable&&<p role="alert">当前主声窗口不可用，请先检查声音。</p>}
   <Button size="sm" color="secondary" isDisabled={disabled||!targetItemId||!firstFrameId||!prompt.trim()||voiceUnavailable||overMaximum||!voiceDriven&&actualDuration<2||!reservation||Number(reservation)<1} onPress={()=>void generate()}>生成画面候选</Button>
  </div>}
  <label>采用时长<NativeSelect size="sm" aria-label="视觉候选时长处理" value={policy} disabled={disabled} onChange={event=>{setPolicy(event.target.value as typeof policy);setAcceptImpact(false);}}><option value="">选择时长处理</option><option value="keep-target">保留目标窗口，超长裁尾</option><option value="use-candidate">采用候选完整时长，其他片段不移动</option></NativeSelect></label>
  {policy==='use-candidate'&&<label className="workspace-visual-checkbox"><input type="checkbox" checked={acceptImpact} disabled={disabled} onChange={event=>setAcceptImpact(event.target.checked)}/>保留其他片段位置，接受本次空隙或覆盖</label>}
  {candidates.some(candidate=>candidate.usage==='pan-zoom')&&<label>图片运动<NativeSelect size="sm" aria-label="图片运动处理" value={motionPolicy} disabled={disabled} onChange={event=>setMotionPolicy(event.target.value as typeof motionPolicy)}><option value="preserve-target">保留当前构图与手工运动</option><option value="replace-motion">采用此图片推拉，替换相关运动属性</option></NativeSelect></label>}
  {error&&<p role="alert">{error}</p>}
  {workspace.visualTasks?.filter(task=>task.status!=='completed').map(task=><div key={task.id} className="workspace-visual-task"><p role={task.error?'alert':'status'} aria-label={'视觉任务 '+task.taskId}>{task.status==='running'?'画面生成中':task.status==='ready'?'画面等待执行':task.status==='failed'?'画面生成失败':task.status==='blocked'?'画面生成受阻':task.status}{task.error?' · '+task.error:''}</p>{task.canResume&&['failed','blocked'].includes(task.status)&&<Button size="sm" color="secondary" isDisabled={disabled} onPress={()=>void run(async()=>{const w=await current();onChange(await command('retryWorkspaceVisualCandidate',{...base(w),candidateId:task.id}) as ProductionWorkspace);})}>恢复画面任务</Button>}</div>)}
  {candidates.map(candidate=><article key={candidate.id}><div className="workspace-visual-heading"><strong>{candidate.usage==='pan-zoom'?'本地推拉':candidate.kind==='image'?'静帧':'视频'} · {candidate.durationSeconds.toFixed(2)} 秒</strong><span>{candidate.pendingConfirmation?'采用待确认':labels[candidate.status]}</span>{candidate.currentDurationSeconds!==null&&<span>当前 {candidate.currentDurationSeconds.toFixed(2)} 秒</span>}{candidate.durationImpact&&<span>{candidate.durationImpact.deltaSeconds>=0?'+':''}{candidate.durationImpact.deltaSeconds.toFixed(2)} 秒</span>}</div>
   {candidate.kind==='image'?<img className="workspace-visual-preview" loading="lazy" alt={candidate.shotId+' 图片候选'} src={artifact(candidate.relativePath)}/>:<video className="workspace-visual-preview" controls preload="none" aria-label={candidate.shotId+' 视频候选'} src={artifact(candidate.relativePath)}/>}
   {policy==='keep-target'&&candidate.kind==='video'&&candidate.durationSeconds<Number(candidate.currentDurationSeconds)&&<p role="status">候选短于目标窗口，需明确采用候选时长。</p>}{policy==='use-candidate'&&candidate.durationImpact&&candidate.durationImpact.deltaSeconds!==0&&<p role="status">{candidate.durationImpact.deltaSeconds>0?'画面延长 '+candidate.durationImpact.deltaSeconds.toFixed(2)+' 秒，可能覆盖 '+candidate.durationImpact.overlapItemIds.length+' 个后续片段。':'画面缩短 '+Math.abs(candidate.durationImpact.deltaSeconds).toFixed(2)+' 秒，将保留空隙。'}</p>}
   <details><summary>版本来源</summary><dl><dt>输入</dt><dd>{candidate.inputFingerprint}</dd><dt>任务</dt><dd>{candidate.taskId??'Owner 上传材料'}</dd><dt>文件 SHA-256</dt><dd>{candidate.sha256}</dd></dl></details>
   {candidate.pendingConfirmation&&<Button size="sm" color="primary" isDisabled={disabled} onPress={()=>void run(async()=>{const w=await current();onChange(await command('adoptWorkspaceVisualCandidate',{...base(w),candidateId:candidate.id,nativeApplied:true}) as ProductionWorkspace);})}>确认画面采用</Button>}
   {candidate.status==='available'&&!candidate.pendingConfirmation&&<footer><Button size="sm" color="primary" isDisabled={disabled||!policy||policy==='use-candidate'&&!acceptImpact||policy==='keep-target'&&candidate.kind==='video'&&candidate.durationSeconds<Number(candidate.currentDurationSeconds)} onPress={()=>void adopt(candidate)}>采用此画面</Button><Button size="sm" color="secondary" isDisabled={disabled} onPress={()=>void run(async()=>{const w=await current();onChange(await command('rejectWorkspaceVisualCandidate',{...base(w),candidateId:candidate.id}) as ProductionWorkspace);})}>拒绝，保留当前画面</Button></footer>}
  </article>)}
  {!candidates.length&&<p>添加素材或生成后可比较画面版本。</p>}
 </section>;
}
