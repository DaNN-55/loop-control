import {VideoPreview} from '../ui/media/VideoPreview';
import {WorkspaceVisualRecord} from './WorkspaceVisualRecord';
import {WorkspaceCandidateImpact} from './WorkspaceCandidateImpact';
import type {WorkspaceCandidatePreparation} from '../workspaceCandidates';
import {WorkspaceGenerationModel} from './WorkspaceGenerationModel';
import {WorkspacePromptField} from './WorkspacePromptField';
import {WorkspaceVisualTaskStatus} from './WorkspaceVisualTaskStatus';
import {reconcileWorkspaceOutput} from './workspaceOutputReconciliationClient';
import {useWorkspaceReading,useWorkspacePolling} from './useWorkspaceReading';
import {wanVideoModel,wanVideoSettingsError,wanProviderDuration,defaultWanModelSettings} from '../wanVideoModels';
import {WorkspaceReferencePicker} from './WorkspaceReferencePicker';
import {productionModelSelection} from './productionModelSelection';
import {WorkspacePexelsSearch} from './WorkspacePexelsSearch';
import {useEffect,useRef,useState,useSyncExternalStore,type ReactNode} from 'react';
import {RefreshCw,Check,MoreHorizontal,Upload,Image as ImageIcon,Video,Maximize2,X} from 'lucide-react';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import {NativeSelect} from '../ui/dan-ui/components/base/select/select-native';
import type {ProductionWorkspace} from '../productionWorkspace';
import type {WorkspaceVisualCandidate} from '../workspaceVisualCandidates';
import type {ProductionService,ProductionServiceCatalog} from '../connections/serviceCatalog';
import type {ProductionSelection} from '../productionSelection';
import {imageSizePresets,emptyImageBrief,referencePurposeLabels,framingLabels,captionSpaceLabels,type ImageBrief,type ImageGenerationSettings} from '../imageGeneration';
import {defaultWanSettings,wanSettingLabels,type WanGenerationSettings} from '../videoGenerationSettings';
import './workspace-visual-preparation.css';

type Kind='image'|'video';
interface Material{id:string;material_type:string;source_path:string;storage_path?:string}
interface UploadEntry {id:number;name:string;file?:File;kind:Kind;asReference:boolean;tab:Kind;usage:Draft['usage'];status:'pending'|'running'|'succeeded'|'failed';material?:Material&{storage_path:string};error?:string}
let uploadEntryId=0;
interface UploadSnapshot {rows:UploadEntry[];running:boolean}
interface UploadSession {read:()=>UploadSnapshot;subscribe:(listener:()=>void)=>()=>void;update:(change:(value:UploadSnapshot)=>UploadSnapshot)=>void}
// Keep unresolved File objects and import receipts while this browser page is open.
// Closing a panel stops the loop at the next completed boundary, rather than losing its result.
const uploadSessions=new Map<string,UploadSession>();
function uploadSession(key:string):UploadSession {
 let session=uploadSessions.get(key);
 if(!session){
  let value:UploadSnapshot={rows:[],running:false};const listeners=new Set<()=>void>();
  session={read:()=>value,subscribe(listener){listeners.add(listener);return()=>{listeners.delete(listener);};},update(change){value=change(value);for(const listener of listeners)listener();}};
  uploadSessions.set(key,session);
 }
 return session;
}
export interface VisualPreparationProps {
 workspace:ProductionWorkspace;command:(name:string,data:unknown)=>Promise<unknown>;onChange:(w:ProductionWorkspace)=>void;
 materials:Material[];selectedShotId?:string;selectedTargetItemId?:string;onTargetChange?:(id:string)=>void;
 currentVisualKind?:string;currentVisualPath?:string;currentVisualSha256?:string;currentMaterialRevisionId?:string;preview?:ReactNode;readOnly?:boolean;
 onImported?:(material:Material&{storage_path:string})=>void;
}
interface Draft {imageBrief:ImageBrief;imageSelection?:ProductionSelection|null;videoSelection?:ProductionSelection|null;videoSettings:WanGenerationSettings;firstFrameFit:'contain'|'cover';tab:Kind;origin:Record<Kind,'material'|'generate'|'search'>;imagePrompt:string;videoPrompt:string;references:string[];firstFrame:string;settings:ImageGenerationSettings;duration:string;usage:'still'|'pan-zoom';selected:Record<Kind,string>}
function initialDraft(props:VisualPreparationProps,targetItemId:string):Draft {
 const sizeTarget=props.workspace.visualTargets?.find(t=>t.targetItemId===targetItemId),ratio=(sizeTarget?.width??9)/(sizeTarget?.height??16),size:ImageGenerationSettings['size']=[...imageSizePresets].sort((a,b)=>Math.abs(Number(a.ratio.split(':')[0])/Number(a.ratio.split(':')[1])-ratio)-Math.abs(Number(b.ratio.split(':')[0])/Number(b.ratio.split(':')[1])-ratio))[0].standard;
 const selected=props.workspace.selectedImages?.find(s=>s.targetItemId===targetItemId)?.materialRevisionId;
 let defaults:Partial<Draft>={};try{defaults={...JSON.parse(sessionStorage.getItem(`loop-image-default:${props.workspace.id}`)??'{}'),...JSON.parse(sessionStorage.getItem(`loop-video-default:${props.workspace.id}`)??'{}')};}catch{/* Empty default. */}
 return {...defaults,imageBrief:{...emptyImageBrief,references:[]},videoSelection:defaults.videoSelection??sizeTarget?.defaultSelection,imageSelection:defaults.imageSelection??props.workspace.visualConfiguration?.imageSelection,videoSettings:defaults.videoSettings??{...defaultWanSettings},firstFrameFit:'contain',tab:props.currentVisualKind==='video'?'video':'image',origin:{image:'material',video:'material'},imagePrompt:'',videoPrompt:'',references:[],firstFrame:selected??(props.currentVisualKind==='image'?props.currentMaterialRevisionId??'':''),settings:defaults.settings??{size,quality:'auto',count:1},duration:String(Math.max(3,sizeTarget?.minimumSeconds??2)),usage:'still',selected:{image:'',video:''}};
}
export function WorkspaceVisualPreparation(props:VisualPreparationProps){
 const options=props.selectedShotId?props.workspace.clips.filter(c=>c.shotId===props.selectedShotId):props.workspace.clips;
 const target=options.find(c=>c.itemId===props.selectedTargetItemId)??options[0];
 if(props.readOnly&&target)return <WorkspaceVisualRecord workspace={props.workspace} targetItemId={target.itemId} options={options} onTargetChange={props.onTargetChange} materials={props.materials} currentVisualPath={props.currentVisualPath} currentVisualSha256={props.currentVisualSha256} preview={props.preview}/>;
 return target?<VisualPreparationTarget key={props.workspace.episodeId+':'+props.workspace.id+':'+target.itemId} {...props} targetItemId={target.itemId} options={options}/>:null;
}
function VisualPreparationTarget(props:VisualPreparationProps&{targetItemId:string;options:ProductionWorkspace['clips']}){
 const {workspace,command,onChange:updated,targetItemId,options}=props,storageKey=`loop-visual-draft:${workspace.id}:${targetItemId}`;
 const [draft,setDraft]=useState<Draft>(()=>{try{const saved=JSON.parse(sessionStorage.getItem(storageKey)??'null');if(saved?.settings&&['image','video'].includes(saved.tab))return {...initialDraft(props,targetItemId),...saved};}catch{/* A missing browser draft is an empty form. */}return initialDraft(props,targetItemId);});
 const [imageServices,setImageServices]=useState<ProductionService[]>([]),[videoServices,setVideoServices]=useState<ProductionService[]>([]),[catalogError,setCatalogError]=useState(''),[catalogReload,setCatalogReload]=useState(0);
 useEffect(()=>{if(draft.origin[draft.tab]!=='generate')return;let active=true;void fetch('/api/local/connections').then(async r=>{if(!r.ok)throw Error();const catalog=(await r.json()).serviceCatalog as ProductionServiceCatalog;if(active){setImageServices(catalog?.groups?.find(g=>g.capability==='image')?.services??[]);setVideoServices(catalog?.groups?.find(g=>g.capability==='video')?.services.filter(s=>s.mode==='generation')??[]);setCatalogError('');}}).catch(()=>{if(active)setCatalogError('无法读取制作连接，请刷新后重试。');});return()=>{active=false;};},[draft.tab,draft.origin.image,draft.origin.video,catalogReload]);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[rangeStart,setRangeStart]=useState('0'),[rangeEnd,setRangeEnd]=useState(''),[policy,setPolicy]=useState('keep-target'),[acceptImpact,setAcceptImpact]=useState(false),[zoom,setZoom]=useState(false);
 const [adoption,setAdoption]=useState<WorkspaceCandidatePreparation|null>(null);
 const [uploadState]=useState(()=>uploadSession(`${workspace.episodeId}:${workspace.id}:${targetItemId}`));
 const {rows:uploadRows,running:uploading}=useSyncExternalStore(uploadState.subscribe,uploadState.read);
 const working=useRef(false),fileInput=useRef<HTMLInputElement>(null),referenceInput=useRef<HTMLInputElement>(null),mounted=useRef(true),zoomClose=useRef<HTMLButtonElement>(null),zoomTrigger=useRef<HTMLButtonElement>(null),resultMore=useRef<HTMLDetailsElement>(null),thumbnailRail=useRef<HTMLDivElement>(null);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 useEffect(()=>{try{sessionStorage.setItem(storageKey,JSON.stringify(draft));}catch{/* Storage is optional. */}},[storageKey,draft]);
 useEffect(()=>{if(!zoom)return;zoomClose.current?.focus();return()=>zoomTrigger.current?.focus();},[zoom]);
 const candidates=(workspace.visualCandidates??[]).filter(c=>c.targetItemId===targetItemId&&c.status!=='rejected');
 const allMaterials=[...props.materials,...uploadRows.flatMap(row=>row.material?[row.material]:[]),...(workspace.visualCandidates??[]).filter(c=>c.kind==='image'&&c.materialRevisionId).map(c=>({id:c.materialRevisionId!,material_type:'image',source_path:c.relativePath.split('/').pop()??'生成图片',storage_path:c.relativePath}))].filter((m,i,a)=>a.findIndex(x=>x.id===m.id)===i);
 const videoService=videoServices.find(s=>s.connectionVersionId===draft.videoSelection?.connectionVersionId&&s.provider===draft.videoSelection.provider&&s.adapter===draft.videoSelection.adapter),videoProvider=draft.videoSelection?.provider,videoModel=draft.videoSelection?.model;
 const wanProfile=videoProvider==='bailian'&&videoModel?wanVideoModel(videoModel):undefined,wanSettingsProblem=videoProvider==='bailian'&&videoModel?wanVideoSettingsError(videoModel,draft.videoSettings):null;
 const incompatibleWan=!!wanSettingsProblem||videoProvider!=='bailian'&&JSON.stringify(draft.videoSettings)!==JSON.stringify(defaultWanSettings),videoCompatible=!!videoService&&videoService.executable&&!!videoModel&&videoService.models.includes(videoModel)&&!incompatibleWan;
 const imageService=imageServices.find(s=>s.connectionVersionId===draft.imageSelection?.connectionVersionId&&s.provider===draft.imageSelection.provider&&s.adapter===draft.imageSelection.adapter),imageCompatible=!!imageService&&imageService.executable&&!!draft.imageSelection?.model&&imageService.models.includes(draft.imageSelection.model)&&!!imageService.constraints.sizes?.includes(draft.settings.size)&&!!imageService.constraints.qualities?.includes(draft.settings.quality)&&!!imageService.constraints.counts?.includes(draft.settings.count)&&draft.references.length<=(imageService.constraints.referenceImages?.max??0);
 const tab=draft.tab,kindName=tab==='image'?'图片':'视频',origin=draft.origin[tab],disabled=busy||uploading||props.readOnly||workspace.stale;
 const visible=candidates.filter(c=>c.kind===tab),currentEntry=props.currentVisualKind===tab&&!!props.currentVisualPath&&!visible.some(c=>c.relativePath===props.currentVisualPath);
 const entries=[...(currentEntry?[{id:'current',candidate:null}]:[]),...visible.map(c=>({id:c.id,candidate:c}))];
 const pendingUpload=uploadRows.find(row=>row.status==='running'&&!row.asReference&&row.tab===tab);
 const applicableImages=entries.filter(e=>e.candidate?.kind==='image'&&e.candidate.status==='available');
 const active=entries.find(e=>e.id===draft.selected[tab])??(tab==='image'&&applicableImages.length===1?applicableImages[0]:undefined)??entries.find(e=>e.id==='current'||e.candidate?.relativePath===props.currentVisualPath),index=entries.findIndex(e=>e.id===active?.id),candidate=active?.candidate;
 useEffect(()=>{setAdoption(null);},[candidate?.id,policy,acceptImpact,draft.usage,rangeStart,rangeEnd,workspace.project?.sha256]);
 useEffect(()=>{const rail=thumbnailRail.current,selected=rail?.querySelector<HTMLElement>('[aria-pressed=true]');if(!rail||!selected)return;const r=rail.getBoundingClientRect(),s=selected.getBoundingClientRect();if(s.top<r.top)rail.scrollTop-=r.top-s.top;else if(s.bottom>r.bottom)rail.scrollTop+=s.bottom-r.bottom;},[tab,active?.id]);
 const reference=allMaterials.find(m=>m.id===draft.firstFrame),selectedImage=workspace.selectedImages?.find(s=>s.targetItemId===targetItemId);
 const current=candidate?.relativePath===props.currentVisualPath||active?.id==='current',imageChosen=!!candidate&&selectedImage?.candidateId===candidate.id;
 const target=workspace.visualTargets?.find(t=>t.targetItemId===targetItemId),voiceDriven=!!target&&target.voiceMode!=='none';
 const minimumSeconds=wanProfile?.durations[0]??videoService?.constraints.durationSeconds?.min??2,maximumSeconds=wanProfile?.durations.at(-1)??videoService?.constraints.durationSeconds?.max??15,actualDuration=voiceDriven?target.durationSeconds:Number(draft.duration),providerDuration=actualDuration===null?null:wanProfile?wanProviderDuration(videoModel!,actualDuration,voiceDriven):voiceDriven?Math.max(minimumSeconds,Math.ceil(actualDuration)):actualDuration,invalidDuration=!actualDuration||actualDuration<(voiceDriven?0.1:minimumSeconds)||actualDuration>maximumSeconds||!voiceDriven&&!Number.isInteger(actualDuration)||!!wanProfile&&providerDuration===undefined;
 const tasks=(workspace.visualTasks??[]).filter(t=>!t.shotId||options.some(c=>c.shotId===t.shotId)),pending=tasks.filter(t=>['ready','running'].includes(t.status)&&t.publicationAttempt==null),taskKey=pending.map(t=>t.taskId).join(':');
 function change<K extends keyof Draft>(key:K,value:Draft[K]){setDraft(d=>({...d,[key]:value}));}
 function select(id:string){setDraft(d=>({...d,selected:{...d.selected,[d.tab]:id}}));setRangeStart('0');setRangeEnd('');setPolicy('keep-target');setAcceptImpact(false);setError('');}
 function url(path:string,sha256=''){return '/_local-artifact?'+new URLSearchParams({episode:workspace.episodeId,path,...(sha256?{sha256}:{})});}
 const reader=useWorkspaceReading(workspace,updated,targetItemId,'无法读取当前工程，请重试。');
 const {read:fresh,publish:onChange}=reader;
 useEffect(()=>{
  if(uploading||!uploadRows.some(row=>row.status==='succeeded'&&!row.asReference&&!workspace.visualCandidates?.some(candidate=>candidate.targetItemId===targetItemId&&candidate.materialRevisionId===row.material?.id&&candidate.status!=='rejected')))return;
  void fresh().catch(cause=>{if(mounted.current&&!(cause instanceof Error&&cause.name==='AbortError'))setError('素材已导入，候选列表暂未更新，请刷新重试。');});
 },[uploading,uploadRows,fresh]);
 useWorkspacePolling(reader,!!taskKey&&!busy&&!uploading,2000,()=>setError('任务状态暂时无法更新，可点击刷新重试。'));
 function base(w:ProductionWorkspace){return {episodeId:w.episodeId,workspaceId:w.id,expectedRevision:w.revision};}
 async function run(action:()=>Promise<void>){if(working.current)return;working.current=true;setBusy(true);setError('');setNotice('');try{await action();}catch(cause){if(mounted.current&&!(cause instanceof Error&&cause.name==='AbortError'))setError(cause instanceof Error?cause.message:'操作未完成，请重试。');}finally{working.current=false;if(mounted.current)setBusy(false);}}

 async function register(materialId:string,kind:Kind,usage=draft.usage){const w=await fresh(),existing=w.visualCandidates?.find(c=>c.targetItemId===targetItemId&&c.materialRevisionId===materialId&&c.status!=='rejected');const next=existing?w:await command('registerWorkspaceVisualCandidate',{...base(w),targetItemId,materialRevisionId:materialId,usage:kind==='video'?'video':usage,durationSeconds:3}) as ProductionWorkspace;onChange(next);const added=next.visualCandidates?.find(c=>c.targetItemId===targetItemId&&c.materialRevisionId===materialId&&c.status!=='rejected');if(mounted.current&&added)setDraft(d=>({...d,tab:kind,selected:{...d.selected,[kind]:added.id}}));}
 function updateUpload(id:number,patch:Partial<UploadEntry>){uploadState.update(value=>({...value,rows:value.rows.map(row=>row.id===id?{...row,...patch}:row)}));}
 async function processUploads(rows:UploadEntry[]){
  if(working.current||uploadState.read().running)return;
  uploadState.update(value=>({...value,running:true}));
  try{await run(async()=>{
  const referenceIds=new Set(draft.references);
  for(const row of rows){
   if(!mounted.current)break;
   updateUpload(row.id,{status:'running',error:undefined});
   let material=row.material;
   try{
    if(!material){
     const file=row.file!;
     if(!file.size||file.size>100*1024*1024)throw Error('素材不能为空或超过 100 MB。');
     if(row.asReference&&!['image/png','image/jpeg','image/webp'].includes(file.type)||!row.asReference&&(row.kind!==row.tab||!['image/png','image/jpeg','image/webp','image/bmp','video/mp4'].includes(file.type)))throw Error(row.asReference?'请选择 PNG、JPEG 或 WebP 参考图。':`请选择有效的${row.tab==='image'?'图片':'视频'}文件。`);
     if(row.asReference&&file.size>20*1024*1024)throw Error('每张参考图不能超过 20 MB。');
     if(row.asReference&&row.tab==='image'&&referenceIds.size>=16)throw Error('最多可添加 16 张参考图。');
     const contentBase64=await new Promise<string>((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result).split(',')[1]);r.onerror=()=>reject(Error('文件读取失败。'));r.readAsDataURL(file);});
     if(!mounted.current){updateUpload(row.id,{status:'pending'});break;}
     const m=await command('importMaterial',{episodeId:workspace.episodeId,sourceKind:'file',sourcePath:file.name,materialType:row.kind,mimeType:file.type,contentBase64,isMainScript:false,materialPurpose:row.kind==='image'?'visual_reference':'b_roll'}) as Material&{storage_path:string};
     material={...m,source_path:file.name,material_type:row.kind};
     updateUpload(row.id,{material,file:undefined});
     if(mounted.current)props.onImported?.(material);
    }
    if(!mounted.current){updateUpload(row.id,{status:'pending',error:row.asReference?'素材已导入，尚未选为参考图。':'素材已导入，尚未加入候选。'});break;}
    if(row.asReference){if(row.tab==='image'&&!referenceIds.has(material.id)&&referenceIds.size>=16)throw Error('最多可添加 16 张参考图。');referenceIds.add(material.id);if(mounted.current)setDraft(d=>row.tab==='image'?{...d,references:[...new Set([...d.references,material!.id])].slice(0,16)}:{...d,firstFrame:material!.id});}
    else await register(material.id,row.kind,row.usage);
    updateUpload(row.id,{status:'succeeded',file:undefined});
   }catch(cause){updateUpload(row.id,{status:cause instanceof Error&&cause.name==='AbortError'?'pending':'failed',error:(material?row.asReference?'素材已导入，参考图未选入：':'素材已导入，候选未完成：':'')+(cause instanceof Error&&cause.name==='AbortError'?'已暂停，重试可继续。':cause instanceof Error?cause.message:'上传未完成，请重试。')});}
  }
 });}finally{uploadState.update(value=>({...value,running:false}));}
 }
 async function upload(files:File[],asReference=false){
  if(working.current||uploadState.read().running)return;
  if(asReference&&tab==='image'&&files.length+draft.references.length>16){setError('最多可添加 16 张参考图。');return;}
  const rows=files.map(file=>({id:++uploadEntryId,name:file.name,file,kind:file.type.startsWith('image/')?'image' as const:'video' as const,asReference,tab,usage:draft.usage,status:'pending' as const}));
  uploadState.update(value=>({...value,rows:[...value.rows,...rows]}));await processUploads(rows);
 }
 async function adopt(c:WorkspaceVisualCandidate){await run(async()=>{
   let w=await fresh();
   if(c.kind==='image'&&props.currentVisualKind==='video'){
    const next=await command('retainWorkspaceImageCandidate',{...base(w),candidateId:c.id}) as ProductionWorkspace;onChange(next);setDraft(d=>({...d,firstFrame:d.firstFrame||c.materialRevisionId||''}));setNotice('图片已选用；当前镜头继续优先使用视频。');return;
   }
   const prepared=await command('prepareWorkspaceVisualCandidate',{...base(w),candidateId:c.id,durationPolicy:policy,acceptTimelineImpact:acceptImpact,motionPolicy:draft.usage==='pan-zoom'?'replace-motion':'preserve-target',...(c.kind==='image'?{imageUsage:draft.usage}:Number(rangeStart)!==0||rangeEnd?{sourceInSeconds:Number(rangeStart),sourceOutSeconds:rangeEnd?Number(rangeEnd):c.durationSeconds}:{})}) as WorkspaceCandidatePreparation;
   if(!prepared.impact)throw Error('无法读取采用影响，请刷新后重新核对。');
   setAdoption(prepared);
  });}
 async function confirmAdoption(){if(!adoption)return;const plan=adoption;await run(async()=>{
   const w=await fresh();setAdoption(null);
   if(w.project?.sha256!==plan.projectSha256)throw Error('工程已变化，请重新核对采用影响。');
   onChange(await command('adoptWorkspaceVisualCandidate',{...base(w),candidateId:plan.candidateId,adoptionId:plan.adoptionId}) as ProductionWorkspace);
   if(candidate?.kind==='image'&&candidate.materialRevisionId)setDraft(d=>({...d,firstFrame:d.firstFrame||candidate.materialRevisionId!}));
   setNotice(`已采用${candidate?.kind==='image'?'图片':'视频'}。`);
  });}
 async function generate(){await run(async()=>{
   const w=await fresh();
   if(tab==='video'){
    const after=w.visualTargets?.find(t=>t.targetItemId===targetItemId);
    if(JSON.stringify(after)!==JSON.stringify(target))throw Error('当前口播窗口已变化，请重新确认时长后生成。');
   }
   const next=await command(tab==='image'?'requestWorkspaceImageCandidates':'requestWorkspaceVisualCandidate',{
    ...base(w),targetItemId,prompt:tab==='image'?draft.imagePrompt:draft.videoPrompt,
    ...(tab==='image'?{selection:draft.imageSelection,settings:draft.settings,imageBrief:{...draft.imageBrief,references:draft.references.map(id=>draft.imageBrief.references.find(r=>r.materialRevisionId===id)??{materialRevisionId:id,purpose:'subject',preserve:'',change:''})},referenceMaterialRevisionIds:draft.references}:{selection:draft.videoSelection,firstFrameMaterialRevisionId:draft.firstFrame,durationSeconds:actualDuration,firstFrameFit:draft.firstFrameFit,...(videoProvider==='bailian'?{videoSettings:draft.videoSettings}:{})})
   }) as ProductionWorkspace;
   onChange(next);setNotice('生成任务已提交，完成后请预览并手动采用。');
  });}
 function referenceBrief(id:string,patch:Partial<ImageBrief['references'][number]>) {setDraft(d=>({...d,imageBrief:{...d.imageBrief,references:[...d.imageBrief.references.filter(r=>r.materialRevisionId!==id),{materialRevisionId:id,purpose:'subject',preserve:'',change:'',...d.imageBrief.references.find(r=>r.materialRevisionId===id),...patch}]}}));}
 const sizePreset=imageSizePresets.find(p=>p.standard===draft.settings.size||p.high===draft.settings.size)??imageSizePresets[0];
 const sizeTier=draft.settings.size===sizePreset.high?'high':'standard';
 function linkFirstFrame(){if(!candidate?.materialRevisionId)return;setDraft(d=>({...d,firstFrame:candidate.materialRevisionId!,tab:'video',origin:{...d.origin,video:'generate'}}));setNotice('已选定视频首帧，尚未提交生成。');}
 const selectedVideoDuration=candidate?.kind==='video'?(rangeEnd?Number(rangeEnd):candidate.durationSeconds)-Number(rangeStart):null,rangeValid=!candidate||candidate.kind!=='video'||Number(rangeStart)>=0&&Number.isFinite(Number(rangeStart))&&Number.isFinite(selectedVideoDuration)&&selectedVideoDuration!>0&&(rangeEnd?Number(rangeEnd):candidate.durationSeconds)<=candidate.durationSeconds;
 const canAdopt=rangeValid&&!!candidate&&candidate.status==='available'&&(policy==='keep-target'?candidate.kind!=='video'||candidate.currentDurationSeconds===null||(selectedVideoDuration??candidate.durationSeconds)+0.05>=candidate.currentDurationSeconds:acceptImpact);
 const selectedService=tab==='image'?imageService:videoService,selectedSelection=tab==='image'?draft.imageSelection:draft.videoSelection;
 const qualityLabels={auto:'自动',low:'低',medium:'中',high:'高'};
 const selectionProblems=selectedSelection?[
  ...(!selectedService?['连接：原连接版本不在当前服务目录中，请重新选择模型。']:!selectedService.executable?[`连接：${selectedService.unavailableReason??'当前不可执行，请检查连接。'}`]:[]),
  ...(selectedService&&!selectedService.models.includes(selectedSelection.model??'')?[`模型：${selectedSelection.model??'未选择'}不在此连接的已启用模型中，请重新选择。`]:[]),
  ...(tab==='image'&&imageService?[
   ...(!imageService.constraints.sizes?.includes(draft.settings.size)?[`实际像素：${draft.settings.size.replace('x',' × ')}；当前模型支持 ${(imageService.constraints.sizes??[]).map(s=>s.replace('x',' × ')).join(' / ')||'未注册'}。`]:[]),
   ...(!imageService.constraints.qualities?.includes(draft.settings.quality)?[`质量：${qualityLabels[draft.settings.quality]}；当前模型支持 ${(imageService.constraints.qualities??[]).map(q=>qualityLabels[q as keyof typeof qualityLabels]??q).join(' / ')||'未注册'}。`]:[]),
   ...(!imageService.constraints.counts?.includes(draft.settings.count)?[`数量：${draft.settings.count} 张；当前模型支持 ${(imageService.constraints.counts??[]).map(n=>`${n} 张`).join(' / ')||'未注册'}。`]:[]),
   ...(draft.references.length>(imageService.constraints.referenceImages?.max??0)?[`参考图：已选 ${draft.references.length} 张；当前模型最多支持 ${imageService.constraints.referenceImages?.max??0} 张。`]:[])
  ]:[])
 ]:[];
 const prompt=tab==='image'?draft.imagePrompt:draft.videoPrompt,promptLimit=Math.min(tab==='image'?1200:1500,(tab==='image'?imageService:videoService)?.constraints.prompt?.maxLength??Infinity);
 const canGenerate=prompt.trim()&&prompt.length<=promptLimit&&!tasks.some(t=>t.targetItemId===targetItemId&&(t.submissionUnknown||t.publicationAttempt!=null))&&!pending.some(t=>(t.kind??'video')===tab)&&(tab==='image'?imageCompatible:videoCompatible&&!!draft.firstFrame&&!invalidDuration&&draft.videoSettings.negativePrompt.length<=500);
 return <section className="workspace-visual-candidates workspace-visual-unified" aria-label="镜头图片与视频">
  <header><div className="workspace-visual-preview-tabs" role="tablist" aria-label="画面类型">{(['image','video'] as const).map(kind=><button key={kind} id={`visual-kind-${targetItemId}-${kind}`} type="button" role="tab" aria-selected={tab===kind} aria-controls={`visual-content-${targetItemId}`} tabIndex={tab===kind?0:-1} onClick={()=>change('tab',kind)} onKeyDown={e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();const next=e.key==='Home'?'image':e.key==='End'?'video':tab==='image'?'video':'image';change('tab',next);document.getElementById(`visual-kind-${targetItemId}-${next}`)?.focus();}}}>{kind==='image'?'图片':'视频'}</button>)}</div><Button size="sm" color="tertiary" iconLeading={RefreshCw} aria-label="刷新" title="刷新画面候选" isDisabled={disabled} onPress={()=>void run(async()=>{await fresh();setCatalogReload(value=>value+1);})}/></header>
  {options.length>1&&<label>目标片段<NativeSelect size="sm" aria-label="画面候选目标" value={targetItemId} disabled={disabled} onChange={e=>props.onTargetChange?.(e.target.value)}>{options.map((c,i)=><option key={c.itemId} value={c.itemId}>片段 {i+1} · {c.text}</option>)}</NativeSelect></label>}
  <div id={`visual-content-${targetItemId}`} role="tabpanel" aria-labelledby={`visual-kind-${targetItemId}-${tab}`} className="workspace-visual-content">
   <section className="workspace-visual-results" aria-label={`${kindName}候选结果`}>
    <div className="workspace-results-heading"><h3>画面候选</h3><span>{entries.length} 个</span>{allMaterials.some(m=>m.material_type===tab)&&<details className="workspace-results-import" onKeyDown={e=>{if(e.key==='Escape'){e.currentTarget.open=false;e.currentTarget.querySelector('summary')?.focus();}}}><summary>从本期素材选取</summary><div className="workspace-results-import-content"><label>本期{kindName}<NativeSelect size="sm" aria-label={`选择本期${kindName}`} value="" disabled={disabled} onChange={e=>{const id=e.target.value,disclosure=e.currentTarget.closest('details');if(id)void run(async()=>{await register(id,tab);disclosure?.removeAttribute('open');});}}><option value="">选择后加入候选</option>{allMaterials.filter(m=>m.material_type===tab).map(m=><option key={m.id} value={m.id}>{m.source_path.split('/').pop()}</option>)}</NativeSelect></label></div></details>}</div>
    <div className={`workspace-results-gallery${entries.length?'':' is-empty'}`}>
     {entries.length>0&&<div ref={thumbnailRail} className="workspace-thumbnail-rail" role="group" aria-label={`${kindName}候选缩略图`}>{entries.map((entry,i)=>{const c=entry.candidate,adopted=entry.id==='current'||c?.relativePath===props.currentVisualPath||!!c&&selectedImage?.candidateId===c.id;return <button key={entry.id} type="button" aria-label={`预览${kindName}候选 ${String(i+1).padStart(2,'0')}${adopted?'，已采用':''}`} aria-pressed={active?.id===entry.id} onClick={()=>select(entry.id)}><span className="workspace-thumbnail-media">{c?(c.kind==='image'?<img src={url(c.relativePath,c.sha256)} alt="" loading="lazy"/>:<video src={url(c.relativePath,c.sha256)} muted preload="metadata" aria-hidden="true"/>):(tab==='image'?<ImageIcon aria-hidden="true"/>:<Video aria-hidden="true"/>)}</span><span className="workspace-thumbnail-number">{String(i+1).padStart(2,'0')}{adopted&&<Check size={12} aria-hidden="true"/>}</span></button>;})}</div>}
     <div className="workspace-result-preview-column">
   <div className="workspace-unified-preview" onKeyDown={e=>{if(e.target!==e.currentTarget||entries.length<2)return;if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();select(entries[(index+(e.key==='ArrowRight'?1:-1)+entries.length)%entries.length].id);}}} tabIndex={entries.length>1?0:undefined} aria-label={`${kindName}预览`}>
    {active?.id==='current'?props.preview:candidate?(tab==='image'?<img src={url(candidate.relativePath,candidate.sha256)} alt={`${kindName}候选 ${index+1}`}/>:<VideoPreview key={candidate.id} title="视频候选预览" aria-label="视频候选预览" src={url(candidate.relativePath,candidate.sha256)} segment={{start:Number(rangeStart),end:rangeEnd?Number(rangeEnd):candidate.durationSeconds}}/>):pendingUpload?<div className="workspace-upload-preview" role="status" aria-label={`${kindName}候选上传中`}><div className="workspace-upload-preview-placeholder" style={{aspectRatio:`${target?.width??9}/${target?.height??16}`}} aria-hidden="true"/><p>正在准备{kindName}候选…</p><small>{pendingUpload.name}</small></div>:<div className="workspace-visual-empty">{tab==='image'?<ImageIcon size={28} aria-hidden="true"/>:<Video size={28} aria-hidden="true"/>}<p>{entries.length?'选择左侧缩略图预览':`尚未添加${kindName}`}</p>{!entries.length&&<span>上传素材，或使用 AI 生成</span>}</div>}
    {candidate&&tab==='image'&&<button ref={zoomTrigger} className="workspace-preview-zoom" type="button" aria-label="放大图片" onClick={()=>setZoom(true)}><Maximize2 size={16}/></button>}
   </div>

      {active&&<div className="workspace-result-footer">
       <p title={candidate?.generation?.selection?.model??candidate?.relativePath}><strong>{candidate?`候选 ${String(index+1).padStart(2,'0')}`:'当前画面'}</strong>{candidate?.generation?.selection?.model&&<span> · {candidate.generation.selection.model}</span>}{candidate?.status==='stale'&&<span> · 输入已变化</span>}</p>
       {candidate&&<div className="workspace-result-actions"><Button size="sm" color="primary" isDisabled={disabled||current||!canAdopt||imageChosen} onPress={()=>void adopt(candidate)}>{current?'已采用':imageChosen?'图片已选用':tab==='image'&&props.currentVisualKind==='video'?'保留为备用图片':`采用此${kindName}`}</Button>
        {tab==='image'&&candidate.materialRevisionId&&<Button size="sm" color="secondary" isDisabled={disabled||candidate.status==='stale'} onPress={linkFirstFrame}>用作视频首帧</Button>}
        <details key={candidate.id} ref={resultMore} className="workspace-result-more" onKeyDown={e=>{if(e.key==='Escape'){e.currentTarget.open=false;e.currentTarget.querySelector('summary')?.focus();}}}><summary aria-label="候选更多操作"><MoreHorizontal size={16}/></summary><div className="workspace-result-more-content">

{!current&&<>    <details><summary>使用设置</summary><div className="workspace-adoption-settings">
    {candidate.kind==='image'&&<label>图片使用方式<NativeSelect size="sm" aria-label="图片使用方式" disabled={disabled} value={draft.usage} onChange={e=>change('usage',e.target.value as Draft['usage'])}><option value="still">静帧</option><option value="pan-zoom">轻微推拉</option></NativeSelect></label>}
    {candidate.kind==='video'&&<div className="workspace-visual-fields"><label>使用起点（秒）<input type="number" aria-label="视频使用起点（秒）" min="0" max={candidate.durationSeconds} step="0.1" disabled={disabled} value={rangeStart} onChange={e=>setRangeStart(e.target.value)}/></label><label>使用终点（秒）<input type="number" aria-label="视频使用终点（秒）" min="0.1" max={candidate.durationSeconds} step="0.1" disabled={disabled} value={rangeEnd||candidate.durationSeconds} onChange={e=>setRangeEnd(e.target.value)}/></label></div>}
    <label>采用时长<NativeSelect size="sm" aria-label="视觉候选时长处理" disabled={disabled} value={policy} onChange={e=>{setPolicy(e.target.value);setAcceptImpact(false);}}><option value="keep-target">保留镜头时长</option><option value="use-candidate">使用素材完整时长</option></NativeSelect></label>
    {policy==='use-candidate'&&<label className="workspace-visual-checkbox"><input type="checkbox" disabled={disabled} checked={acceptImpact} onChange={e=>setAcceptImpact(e.target.checked)}/>保留其他片段位置，接受空隙或覆盖</label>}
    {policy==='keep-target'&&candidate.kind==='video'&&candidate.currentDurationSeconds!==null&&(selectedVideoDuration??candidate.durationSeconds)+0.05<candidate.currentDurationSeconds&&<p role="alert">视频短于镜头，请调整时长后采用。</p>}

    {candidate.kind==='image'&&props.currentVisualKind==='video'&&<small>图片保留为备用画面，当前视频优先。</small>}
    </div></details></>}
{candidate.source&&<p><a href={candidate.source.sourceUrl} target="_blank" rel="noreferrer">Pexels #{candidate.source.id}</a> · <a href={candidate.source.creatorUrl} target="_blank" rel="noreferrer">{candidate.source.creator}</a> · {candidate.source.connectionName} · {candidate.source.query}</p>}
{candidate.generation&&<details><summary>查看生成设置</summary>{candidate.generation.selection&&<p>{candidate.generation.connectionName??candidate.generation.selection.connectionVersionId} · {candidate.generation.selection.provider} · {candidate.generation.selection.model}</p>}<p>{candidate.generation.prompt}</p>{candidate.generation.imageSettings&&<p>{candidate.generation.imageSettings.size.replace('x',' × ')} · {{auto:'自动',low:'低',medium:'中',high:'高'}[candidate.generation.imageSettings.quality]}质量 · {candidate.generation.imageSettings.count} 张</p>}{candidate.generation.imageBrief&&<><p>{framingLabels[candidate.generation.imageBrief.framing]} · {captionSpaceLabels[candidate.generation.imageBrief.captionSpace]} · {candidate.generation.imageBrief.crop==='protect'?'主体完整，边缘留余量':'裁切由提示词决定'}</p>{candidate.generation.imageBrief.references.map(r=><p key={r.materialRevisionId}>参考图 {(candidate.generation!.referenceMaterialRevisionIds??[]).indexOf(r.materialRevisionId)+1} · {referencePurposeLabels[r.purpose]}{r.preserve?` · 保留：${r.preserve}`:''}{r.change?` · 允许改变：${r.change}`:''}</p>)}</>}{candidate.kind==='video'&&<p>首帧：{allMaterials.find(m=>m.id===candidate.generation!.firstFrameMaterialRevisionId)?.source_path.split('/').pop()??candidate.generation.firstFrameMaterialRevisionId}</p>}<Button size="sm" color="tertiary" isDisabled={disabled} onPress={()=>{resultMore.current?.removeAttribute('open');setDraft(d=>({...d,origin:{...d.origin,[tab]:'generate'},...(tab==='image'?{imageSelection:candidate.generation!.selection??d.imageSelection,imagePrompt:candidate.generation!.prompt,settings:candidate.generation!.imageSettings??d.settings,imageBrief:candidate.generation!.imageBrief??{...emptyImageBrief,references:[]},references:candidate.generation!.referenceMaterialRevisionIds??[]}:{videoSelection:candidate.generation!.selection??d.videoSelection,videoPrompt:candidate.generation!.prompt,firstFrame:candidate.generation!.firstFrameMaterialRevisionId,duration:String(candidate.generation!.durationSeconds),videoSettings:candidate.generation!.videoSettings??{...defaultWanSettings},firstFrameFit:candidate.generation!.firstFrameFit??'contain'})}));}}>复用生成设置</Button></details>}
        </div></details>
       </div>}
      </div>}
      {adoption&&candidate?.id===adoption.candidateId&&<WorkspaceCandidateImpact plan={adoption} disabled={!!disabled} onConfirm={()=>void confirmAdoption()} onCancel={()=>setAdoption(null)}/>}
     </div>
    </div>
  {tasks.filter(t=>t.status!=='completed').map(t=><WorkspaceVisualTaskStatus key={t.id} task={t} label={(t.kind??'video')==='image'?'图片':'视频'} disabled={disabled} onRefresh={()=>void run(async()=>{onChange(await fresh());})} onResume={()=>void run(async()=>{const w=await fresh();onChange(await command('retryWorkspaceVisualCandidate',{...base(w),candidateId:t.id}) as ProductionWorkspace);})} onReconcile={()=>void run(async()=>{await reconcileWorkspaceOutput(workspace.episodeId,t);onChange(await fresh());})}/>)}
   </section>
   <div className="workspace-visual-origin" role="group" aria-label={`${kindName}来源`}>{(tab==='video'?['material','generate','search'] as const:['material','generate'] as const).map(value=><button key={value} type="button" aria-pressed={origin===value} onClick={()=>setDraft(d=>({...d,origin:{...d.origin,[tab]:value}}))}>{value==='material'?'上传素材':value==='search'?'素材检索':'AI 生成'}</button>)}</div>
   {origin==='material'?<div className="workspace-visual-import">
    <button type="button" className="workspace-visual-dropzone" disabled={disabled} onClick={()=>fileInput.current?.click()} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();if(!disabled)void upload([...e.dataTransfer.files]);}}><Upload size={18} aria-hidden="true"/><span>选择或拖入{kindName}</span><small>{tab==='image'?'PNG、JPEG、WebP、BMP · 每张不超过 100 MB · 可多选':'MP4 · 不超过 100 MB · 每次 1 个'}</small></button>

   </div>:origin==='search'?<WorkspacePexelsSearch key={targetItemId} workspace={workspace} targetItemId={targetItemId} command={command} onChange={onChange} prepare={fresh} reader={reader} disabled={disabled}/>:<div className="workspace-visual-generation-form">
    <WorkspaceGenerationModel kind={kindName} services={tab==='image'?imageServices:videoServices} selection={tab==='image'?draft.imageSelection:draft.videoSelection} disabled={disabled} onChange={value=>tab==='image'?change('imageSelection',productionModelSelection(imageServices,value,'image')):change('videoSelection',productionModelSelection(videoServices,value,'video'))}/>
    {catalogError&&<p role="alert">{catalogError}</p>}
    {selectionProblems.length>0&&<ul className="workspace-generation-problems" aria-label={`${kindName}设置不兼容`} role="list">{selectionProblems.map(problem=><li key={problem}>{problem}</li>)}</ul>}
    {tab==='video'&&incompatibleWan&&<p role="alert">{wanSettingsProblem??`当前模型不支持万相专用设置：${Object.entries(draft.videoSettings).filter(([key,value])=>value!==defaultWanSettings[key as keyof typeof defaultWanSettings]).map(([key])=>wanSettingLabels[key as keyof WanGenerationSettings]??key).join('、')}。`}<Button size="sm" color="tertiary" onPress={()=>change('videoSettings',videoProvider==='bailian'&&videoModel?defaultWanModelSettings(videoModel):{...defaultWanSettings})}>清除不兼容的万相参数</Button></p>}

    {tab==='image'?<WorkspaceReferencePicker materials={allMaterials} selected={draft.references} disabled={disabled} onChange={ids=>change('references',ids)} onUpload={files=>upload(files,true)} url={url} summary={id=>referencePurposeLabels[draft.imageBrief.references.find(r=>r.materialRevisionId===id)?.purpose??'subject']} renderDetails={(id,i)=>{const r=draft.imageBrief.references.find(r=>r.materialRevisionId===id);return <fieldset key={id} className="workspace-image-reference-brief" disabled={disabled}><legend>参考图 {i+1} · {allMaterials.find(m=>m.id===id)?.source_path.split('/').pop()}</legend><label>参考用途<NativeSelect size="sm" aria-label={`参考图 ${i+1} 用途`} value={r?.purpose??'subject'} onChange={e=>referenceBrief(id,{purpose:e.target.value as keyof typeof referencePurposeLabels})}>{Object.entries(referencePurposeLabels).map(([v,label])=><option key={v} value={v}>{label}</option>)}</NativeSelect></label><label>需要保留<input maxLength={160} aria-label={`参考图 ${i+1} 需要保留`} value={r?.preserve??''} placeholder="例如：产品图案、人物外观" onChange={e=>referenceBrief(id,{preserve:e.target.value})}/></label><label>允许改变<input maxLength={160} aria-label={`参考图 ${i+1} 允许改变`} value={r?.change??''} placeholder="例如：背景、光线" onChange={e=>referenceBrief(id,{change:e.target.value})}/></label></fieldset>;}}/>:<div className="workspace-first-frame"><label>视频首帧<NativeSelect size="sm" aria-label="画面首帧图片" value={draft.firstFrame} disabled={disabled} onChange={e=>change('firstFrame',e.target.value)}><option value="">选择本镜头图片或本期图片</option>{allMaterials.filter(m=>m.material_type==='image').map(m=><option key={m.id} value={m.id}>{m.source_path.split('/').pop()}</option>)}</NativeSelect></label><div className="workspace-first-frame-row">{reference?.storage_path?<img src={url(reference.storage_path)} alt="已选视频首帧" style={{objectFit:draft.firstFrameFit,aspectRatio:`${target?.width??9}/${target?.height??16}`,width:Math.min(180,112*(target?.width??9)/(target?.height??16))}}/>:<span>尚未选择首帧</span>}<Button size="sm" color="secondary" isDisabled={disabled} onPress={()=>referenceInput.current?.click()}>上传首帧</Button></div><label>首帧构图<NativeSelect size="sm" aria-label="首帧构图" disabled={disabled} value={draft.firstFrameFit} onChange={e=>change('firstFrameFit',e.target.value as Draft['firstFrameFit'])}><option value="contain">完整保留，必要时留边</option><option value="cover">居中裁切，填满画面</option></NativeSelect></label><small>PNG、JPEG、WebP · 不超过 20 MB · 每次 1 张</small></div>}
    {tab==='image'&&<>

     <div className="workspace-visual-fields workspace-image-composition"><label>主体构图<NativeSelect size="sm" aria-label="图片主体构图" disabled={disabled} value={draft.imageBrief.framing} onChange={e=>change('imageBrief',{...draft.imageBrief,framing:e.target.value as ImageBrief['framing']})}>{Object.entries(framingLabels).map(([v,label])=><option key={v} value={v}>{label}</option>)}</NativeSelect></label><label>字幕留白<NativeSelect size="sm" aria-label="图片字幕留白" disabled={disabled} value={draft.imageBrief.captionSpace} onChange={e=>change('imageBrief',{...draft.imageBrief,captionSpace:e.target.value as ImageBrief['captionSpace']})}>{Object.entries(captionSpaceLabels).map(([v,label])=><option key={v} value={v}>{label}</option>)}</NativeSelect></label><label>后续裁切<NativeSelect size="sm" aria-label="图片后续裁切" disabled={disabled} value={draft.imageBrief.crop} onChange={e=>change('imageBrief',{...draft.imageBrief,crop:e.target.value as ImageBrief['crop']})}><option value="allow">由提示词决定</option><option value="protect">主体完整，边缘留余量</option></NativeSelect></label></div>
    </>}
    <WorkspacePromptField label={`${kindName}提示词`} ariaLabel={tab==='image'?'图片提示词':'画面动作'} value={prompt} limit={promptLimit} disabled={disabled} onChange={value=>change(tab==='image'?'imagePrompt':'videoPrompt',value)} placeholder={tab==='video'?'例如：以首帧为起点，镜头缓慢向装饰画推进，保持画框、图案和文字稳定，单镜头，不切换场景。':draft.references.length?'例如：保留参考图中装饰画的图案、文字和边框，将背景改为明亮的现代客厅，产品居中完整展示，竖屏构图。':'例如：竖屏产品摄影，金色山水装饰画挂在现代客厅，清晨侧光，完整展示画框细节，写实质感，不添加额外文字。'}/>
    {tab==='image'?<div className="workspace-visual-fields workspace-image-generation-options"><label>画面比例<NativeSelect size="sm" aria-label="图片画面比例" value={sizePreset.ratio} disabled={disabled} onChange={e=>{const p=imageSizePresets.find(p=>p.ratio===e.target.value)!;change('settings',{...draft.settings,size:p[sizeTier]});}}>{imageSizePresets.map(p=><option key={p.ratio} value={p.ratio}>{p.label}</option>)}</NativeSelect></label><label>实际像素<NativeSelect size="sm" aria-label="图片实际像素" value={draft.settings.size} disabled={disabled} onChange={e=>change('settings',{...draft.settings,size:e.target.value as ImageGenerationSettings['size']})}>{(['standard','high'] as const).filter(t=>!imageService||imageService.constraints.sizes?.includes(sizePreset[t])||sizePreset[t]===draft.settings.size).map(t=><option key={t} value={sizePreset[t]}>{t==='standard'?'标准':'高分辨率'} · {sizePreset[t].replace('x',' × ')}</option>)}</NativeSelect></label><label>数量<NativeSelect size="sm" aria-label="生成图片数量" value={draft.settings.count} disabled={disabled} onChange={e=>change('settings',{...draft.settings,count:Number(e.target.value) as 1|2|4})}>{[1,2,4].map(n=><option key={n} value={n}>{n} 张</option>)}</NativeSelect></label><label>质量<NativeSelect size="sm" aria-label="图片质量" value={draft.settings.quality} disabled={disabled} onChange={e=>change('settings',{...draft.settings,quality:e.target.value as ImageGenerationSettings['quality']})}><option value="auto">自动</option><option value="low">低</option><option value="medium">中</option><option value="high">高</option></NativeSelect></label></div>:<><label>画面时长（秒）<input aria-label="生成时长（秒）" type="number" min={minimumSeconds} max={maximumSeconds} step="1" value={voiceDriven?target?.durationSeconds??'':draft.duration} readOnly={voiceDriven} disabled={disabled} onChange={e=>change('duration',e.target.value)}/></label>{voiceDriven&&<p>按当前口播使用 {target.durationSeconds??'—'} 秒，服务请求 {providerDuration??'—'} 秒。</p>}{invalidDuration&&<p role="alert">该模型支持 {wanProfile&&wanProfile.durations.length<4?wanProfile.durations.join(' / '):`${minimumSeconds}～${maximumSeconds}`} 秒；请调整时长或拆分镜头。</p>}</>}
    {tab==='video'&&videoService?.constraints.resolutions&&videoProvider!=='bailian'&&<p>分辨率 {videoService.constraints.resolutions.join(' / ')} · 比例随首帧</p>}
    {tab==='video'&&videoProvider==='bailian'&&<details className="workspace-video-advanced"><summary>高级生成设置</summary><div className="workspace-video-advanced-fields">
      <label>分辨率<NativeSelect size="sm" aria-label="视频分辨率" disabled={disabled} value={draft.videoSettings.resolution} onChange={e=>change('videoSettings',{...draft.videoSettings,resolution:e.target.value as '720P'|'1080P'})}>{wanProfile&&!wanProfile.resolutions.includes(draft.videoSettings.resolution)&&<option value={draft.videoSettings.resolution} disabled>{draft.videoSettings.resolution}（当前模型不支持）</option>}{(wanProfile?.resolutions??['720P','1080P']).map(value=><option key={value} value={value}>{value}</option>)}</NativeSelect></label>
      <WorkspacePromptField label="负面提示词" ariaLabel="视频负面提示词" rows={2} limit={500} disabled={disabled} value={draft.videoSettings.negativePrompt} onChange={value=>change('videoSettings',{...draft.videoSettings,negativePrompt:value})} placeholder="例如：画框变形、文字变化、画面闪烁、突然切镜。"/>

      <label>随机种子（可选）<input type="number" aria-label="视频随机种子" min="0" max="2147483647" step="1" disabled={disabled} value={draft.videoSettings.seed??''} onChange={e=>change('videoSettings',{...draft.videoSettings,seed:e.target.value===''?undefined:Number(e.target.value)})}/></label>
      <label className="workspace-visual-checkbox"><input type="checkbox" checked={draft.videoSettings.promptExtend} disabled={disabled} onChange={e=>change('videoSettings',{...draft.videoSettings,promptExtend:e.target.checked,shotType:e.target.checked?draft.videoSettings.shotType:'single'})}/>智能扩写提示词</label>
      {draft.videoSettings.promptExtend&&(wanProfile?.multiShot??true)&&<label>镜头结构<NativeSelect size="sm" aria-label="视频镜头结构" disabled={disabled} value={draft.videoSettings.shotType} onChange={e=>change('videoSettings',{...draft.videoSettings,shotType:e.target.value as 'single'|'multi'})}><option value="single">单镜头</option><option value="multi">多镜头</option></NativeSelect></label>}
      <label className="workspace-visual-checkbox"><input type="checkbox" checked={draft.videoSettings.audio} disabled={disabled||!!wanProfile&&wanProfile.audio!=='optional'} onChange={e=>change('videoSettings',{...draft.videoSettings,audio:e.target.checked})}/>生成视频声音{wanProfile?.audio==='always'?'（当前模型固定有声）':wanProfile?.audio==='silent'?'（当前模型不支持）':''}</label>
      <label className="workspace-visual-checkbox"><input type="checkbox" checked={draft.videoSettings.watermark} disabled={disabled} onChange={e=>change('videoSettings',{...draft.videoSettings,watermark:e.target.checked})}/>添加模型水印</label>
      <small>分辨率、时长和声音会影响费用；种子相同也不保证结果完全一致。</small>
    </div></details>}

    <Button size="sm" color="primary" isDisabled={disabled||!canGenerate} onPress={()=>void generate()}>{pending.some(t=>(t.kind??'video')===tab)?'正在生成…':`生成${kindName}`}</Button>
   </div>}
  </div>
  {uploadRows.length>0&&<section className="workspace-upload-results" aria-label="上传结果">
   <div className="workspace-upload-heading"><h3>上传结果</h3><span role="status">成功 {uploadRows.filter(row=>row.status==='succeeded').length} / {uploadRows.length}</span>{uploadRows.some(row=>row.status!=='succeeded')&&<Button size="sm" color="secondary" isDisabled={disabled} onPress={()=>void processUploads(uploadRows.filter(row=>row.status==='failed'||row.status==='pending'))}>重试未完成项</Button>}</div>
   <ul>{uploadRows.map(row=><li key={row.id} aria-busy={row.status==='running'}><span className={`workspace-upload-thumbnail${row.status==='running'||uploading&&row.status==='pending'?' is-pending':''}`} aria-hidden="true">{row.status==='succeeded'?<Check size={18}/>:row.kind==='image'?<ImageIcon size={18}/>:<Video size={18}/>}</span><div><strong>{row.name}</strong><span>{row.status==='succeeded'?'成功':row.status==='failed'?'失败':row.status==='running'?'处理中…':'未处理'}</span>{row.error&&<p>{row.error}</p>}</div></li>)}</ul>
  </section>}
  {notice&&<p role="status">{notice}</p>}{error&&<p role="alert">{error}</p>}
  <input ref={fileInput} hidden aria-label={`上传${kindName}素材`} type="file" multiple={tab==='image'} accept={tab==='image'?'image/png,image/jpeg,image/webp,image/bmp':'video/mp4'} disabled={disabled} onChange={e=>{const files=[...e.target.files??[]];e.target.value='';if(files.length)void upload(files);}}/>
  {tab==='video'&&<input ref={referenceInput} hidden aria-label="导入视频首帧" type="file" accept="image/png,image/jpeg,image/webp" disabled={disabled} onChange={e=>{const files=[...e.target.files??[]];e.target.value='';if(files.length)void upload(files,true);}}/>}
  {zoom&&candidate&&<div className="workspace-image-lightbox" role="dialog" aria-modal="true" aria-label="图片大图预览" onKeyDown={e=>{if(e.key==='Escape')setZoom(false);if(e.key==='Tab'){e.preventDefault();zoomClose.current?.focus();}}}><button ref={zoomClose} type="button" aria-label="关闭大图预览" onClick={()=>setZoom(false)}><X size={20}/></button><img src={url(candidate.relativePath,candidate.sha256)} alt="图片候选大图"/></div>}
 </section>;
}
