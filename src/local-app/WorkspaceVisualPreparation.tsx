import {WorkspaceUploadFeedback,type UploadNotice} from './WorkspaceUploadFeedback';
import {imageQualityLabels} from '../imageGeneration';
import {shotCompositionSlotLabels} from '../shotComposition';
import {hasSeparatedVideoSound} from '../workspaceVideoSound';
import type {OpenChatCutProject} from '../worker/openchatcutProject';
import {videoVisualInputProblem,type VideoVisualInputSelection} from '../videoVisualInputs';
import {useWorkspaceMaterialSelection,WorkspaceMaterialDrop} from './WorkspaceMaterialDrop';
import {ImageFocusDialog} from '../ui/media/ImagePreview';
import {VideoPreview} from '../ui/media/VideoPreview';
import {WorkspaceVisualRecord} from './WorkspaceVisualRecord';
import {needsCandidateImpactDialog,WorkspaceCandidateImpactDetails} from './WorkspaceCandidateImpact';
import {ConfirmationModal} from '../ui/ConfirmationModal';
import {createPortal} from 'react-dom';
import type {WorkspaceCandidatePreparation} from '../workspaceCandidates';
import {WorkspaceImageSettings,WorkspaceImageCount} from './WorkspaceImageSettings';
import {WorkspaceGenerationModel} from './WorkspaceGenerationModel';
import {WorkspaceComposerSetting,WorkspaceGenerationComposer} from './WorkspaceGenerationComposer';
import {WorkspaceVideoInputs,resolveVideoInputs,type VideoInputDraft,type VideoInputMaterial} from './WorkspaceVideoInputs';
import {firstFrameVideoMode} from '../worker/registeredAdapters';
import {WorkspacePromptField} from './WorkspacePromptField';
import {WorkspaceVisualTaskStatus,WorkspaceVisualTaskProgress} from './WorkspaceVisualTaskStatus';
import {reconcileWorkspaceOutput} from './workspaceOutputReconciliationClient';
import {useWorkspaceReading,useWorkspacePolling} from './useWorkspaceReading';
import {useCandidateReviewLifecycle} from './useWorkspaceCandidateReview';
import {wanVideoModel,wanVideoSettingsError,wanProviderDuration,defaultWanModelSettings,wanReferenceModel} from '../wanVideoModels';
import {WorkspaceReferencePicker} from './WorkspaceReferencePicker';
import {productionModelSelection} from './productionModelSelection';
import {WorkspacePexelsSearch} from './WorkspacePexelsSearch';
import {useEffect,useId,useRef,useState,useSyncExternalStore,type ReactNode} from 'react';
import {RefreshCw,Check,ChevronDown,Upload,Image as ImageIcon,Video,Maximize2,Download} from 'lucide-react';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import {NativeSelect} from '../ui/dan-ui/components/base/select/select-native';
import type {ProductionWorkspace} from '../productionWorkspace';
import type {WorkspaceVisualCandidate} from '../workspaceVisualCandidates';
import {useProductionServiceCatalog} from './useProductionServiceCatalog';
import type {ProductionSelection} from '../productionSelection';
import {imageSizePresets,emptyImageBrief,referencePurposeLabels,framingLabels,captionSpaceLabels,type ImageBrief,type ImageGenerationSettings} from '../imageGeneration';
import {defaultWanSettings,wanSettingLabels,type WanGenerationSettings} from '../videoGenerationSettings';
import './workspace-visual-preparation.css';

type Kind='image'|'video';
type VisualReviewPlan=(WorkspaceCandidatePreparation&{kind:'adoption';candidate:WorkspaceVisualCandidate})|{kind:'image-backup';candidateId:string;projectSha256:string;candidate:WorkspaceVisualCandidate;impact?:undefined};
type Material=VideoInputMaterial;
interface UploadEntry {id:number;name:string;file?:File;kind:Kind;asReference:boolean;tab:Kind;usage:Draft['usage'];status:'pending'|'running'|'succeeded'|'failed';material?:Material&{storage_path:string};error?:string}
let uploadEntryId=0,uploadNoticeId=0;
interface UploadSnapshot {rows:UploadEntry[];running:boolean;notice?:UploadNotice}
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
 project?:OpenChatCutProject|null;currentVisualKind?:string;currentVisualPath?:string;currentVisualSha256?:string;currentMaterialRevisionId?:string;preview?:ReactNode;readOnly?:boolean;
 onImported?:(material:Material&{storage_path:string})=>void;
}
interface Draft {pexelsSelection?:ProductionSelection|null;imageBrief:ImageBrief;imageSelection?:ProductionSelection|null;videoSelection?:ProductionSelection|null;videoSettings:WanGenerationSettings;firstFrameFit:'contain'|'cover';tab:Kind;origin:Record<Kind,'material'|'generate'|'search'>;imagePrompt:string;videoPrompt:string;references:string[];firstFrame:string;videoModeId?:string;videoInputs?:VideoInputDraft;videoInputIds?:string[];referenceVideoSources?:Record<string,string>;settings:ImageGenerationSettings;duration:string;usage:'still'|'pan-zoom';selected:Record<Kind,string>}
function videoDraftIds(draft:Draft){
 return draft.videoInputIds??[draft.firstFrame,...draft.videoInputs?.lastFrame??[],...draft.videoInputs?.referenceImages??[],...draft.videoInputs?.referenceVideos??[]].filter(Boolean);
}
function prioritizeVideoInput(draft:Draft,id:string){
 return [id,...videoDraftIds(draft).filter(value=>value!==id)];
}
function initialDraft(props:VisualPreparationProps,targetItemId:string):Draft {
 const sizeTarget=props.workspace.visualTargets?.find(t=>t.targetItemId===targetItemId),ratio=(sizeTarget?.width??9)/(sizeTarget?.height??16),size:ImageGenerationSettings['size']=[...imageSizePresets].sort((a,b)=>Math.abs(Number(a.ratio.split(':')[0])/Number(a.ratio.split(':')[1])-ratio)-Math.abs(Number(b.ratio.split(':')[0])/Number(b.ratio.split(':')[1])-ratio))[0].standard;
 const selected=props.workspace.selectedImages?.find(s=>s.targetItemId===targetItemId)?.materialRevisionId;
 let pexelsSelection:ProductionSelection|null|undefined;try{pexelsSelection=JSON.parse(sessionStorage.getItem(`loop-pexels-draft:${props.workspace.id}:${targetItemId}`)??'null')?.selection;}catch{/* Keep an empty search selection. */}
 let defaults:Partial<Draft>={};try{defaults={...JSON.parse(sessionStorage.getItem(`loop-image-default:${props.workspace.id}`)??'{}'),...JSON.parse(sessionStorage.getItem(`loop-video-default:${props.workspace.id}`)??'{}')};}catch{/* Empty default. */}
 return {...defaults,pexelsSelection,imageBrief:{...emptyImageBrief,references:[]},videoSelection:defaults.videoSelection??sizeTarget?.defaultSelection,imageSelection:defaults.imageSelection??props.workspace.visualConfiguration?.imageSelection,videoSettings:defaults.videoSettings??{...defaultWanSettings},firstFrameFit:'contain',tab:props.currentVisualKind==='video'?'video':'image',origin:{image:'material',video:'material'},imagePrompt:'',videoPrompt:'',references:[],firstFrame:selected??(props.currentVisualKind==='image'?props.currentMaterialRevisionId??'':''),settings:defaults.settings??{size,quality:'auto',count:1},duration:String(Math.max(3,sizeTarget?.minimumSeconds??2)),usage:'still',selected:{image:'',video:''}};
}
export function WorkspaceVisualPreparation(props:VisualPreparationProps){
 const options=props.selectedShotId?props.workspace.clips.filter(c=>c.shotId===props.selectedShotId):props.workspace.clips;
 const target=options.find(c=>c.itemId===props.selectedTargetItemId)??options[0];
 if(props.readOnly&&target)return <WorkspaceVisualRecord workspace={props.workspace} targetItemId={target.itemId} options={options} onTargetChange={props.onTargetChange} materials={props.materials} currentVisualPath={props.currentVisualPath} currentVisualSha256={props.currentVisualSha256} preview={props.preview}/>;
 return target?<VisualPreparationTarget key={props.workspace.episodeId+':'+props.workspace.id+':'+target.itemId} {...props} targetItemId={target.itemId} options={options}/>:null;
}
function VisualPreparationTarget(props:VisualPreparationProps&{targetItemId:string;options:ProductionWorkspace['clips']}){
 const {workspace,command,onChange:updated,targetItemId,options}=props,storageKey=`loop-visual-draft:${workspace.id}:${targetItemId}`;
 const timeline=props.project?.timelines.find(timeline=>timeline.items.some(item=>item.id===targetItemId));
 const visual=timeline?.items.find(item=>item.id===targetItemId);
 const canSplitVideo=timeline&&visual?.kind==='video'&&!hasSeparatedVideoSound(timeline,visual);
 const shelf=useWorkspaceMaterialSelection();
 const adoptionDescriptionId=useId();
 const [draft,setDraft]=useState<Draft>(()=>{try{const saved=JSON.parse(sessionStorage.getItem(storageKey)??'null');if(saved?.settings&&['image','video'].includes(saved.tab))return {...initialDraft(props,targetItemId),...saved};}catch{/* A missing browser draft is an empty form. */}return initialDraft(props,targetItemId);});
 const [catalogReload,setCatalogReload]=useState(0);
 const tab=draft.tab,kindName=tab==='image'?'图片':'视频',origin=shelf&&(tab==='image'||draft.origin[tab]==='material')?'generate':draft.origin[tab];
 const tasks=(workspace.visualTasks??[]).filter(t=>!t.shotId||options.some(c=>c.shotId===t.shotId)),pending=tasks.filter(t=>['ready','running'].includes(t.status)&&t.publicationAttempt==null),taskKey=pending.map(t=>t.taskId).join(':');
 const catalogReading=useProductionServiceCatalog({scope:JSON.stringify([workspace.episodeId,workspace.id]),active:origin!=='material',refreshKey:JSON.stringify([tab,origin,catalogReload,taskKey])});
 const imageServices=catalogReading.catalog?.groups.find(g=>g.capability==='image')?.services??[];
 const videoServices=catalogReading.catalog?.groups.find(g=>g.capability==='video')?.services.filter(s=>s.mode==='generation'||s.mode==='search'&&s.provider==='pexels'&&s.adapter==='pexels_video')??[];
 const catalogError=catalogReading.error?'无法读取制作连接，请刷新后重试。':'';
 const [composerPanel,setComposerPanel]=useState('');
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[rangeStart,setRangeStart]=useState(''),[rangeEnd,setRangeEnd]=useState(''),[policy,setPolicy]=useState('keep-target'),[acceptImpact,setAcceptImpact]=useState(false),[zoom,setZoom]=useState(false);
 const [clearVisual,setClearVisual]=useState<{revision:number;candidateId?:string;sourcePath?:string;sourceSha256?:string}|null>(null);
 const [clearError,setClearError]=useState('');
 const [imagePreviewError,setImagePreviewError]=useState(''),[imagePreviewAttempt,retryImagePreview]=useState(0);
 const [uploadState]=useState(()=>uploadSession(`${workspace.episodeId}:${workspace.id}:${targetItemId}`));
 const {rows:uploadRows,running:uploading,notice:uploadNotice}=useSyncExternalStore(uploadState.subscribe,uploadState.read);
 const formRef=useRef<HTMLDivElement>(null);
 const working=useRef(false),fileInput=useRef<HTMLInputElement>(null),referenceInput=useRef<HTMLInputElement>(null),mounted=useRef(true),zoomTrigger=useRef<HTMLButtonElement>(null),resultMore=useRef<HTMLDetailsElement>(null),adoptTrigger=useRef<HTMLButtonElement>(null),thumbnailRail=useRef<HTMLDivElement>(null);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 useEffect(()=>{try{sessionStorage.setItem(storageKey,JSON.stringify(draft));}catch{/* Storage is optional. */}},[storageKey,draft]);
 useEffect(()=>{if(!zoom)return;return()=>zoomTrigger.current?.focus();},[zoom]);
 const candidates=(workspace.visualCandidates??[]).filter(c=>c.targetItemId===targetItemId&&c.status!=='rejected');
 const allMaterials=[...props.materials,...uploadRows.flatMap(row=>row.material?[row.material]:[]),...(workspace.visualCandidates??[]).filter(c=>c.kind==='image'&&c.materialRevisionId).map(c=>({id:c.materialRevisionId!,material_type:'image',source_path:c.relativePath.split('/').pop()??'生成图片',storage_path:c.relativePath}))].filter((m,i,a)=>a.findIndex(x=>x.id===m.id)===i);
 const videoService=videoServices.find(s=>s.mode==='generation'&&s.connectionVersionId===draft.videoSelection?.connectionVersionId&&s.provider===draft.videoSelection.provider&&s.adapter===draft.videoSelection.adapter),videoProvider=draft.videoSelection?.provider,videoModel=draft.videoSelection?.model;
 const videoSettings=videoModel===wanReferenceModel?{...draft.videoSettings,audio:true,promptExtend:false}:draft.videoSettings;
 const wanProfile=videoProvider==='bailian'&&videoModel?wanVideoModel(videoModel):undefined,wanSettingsProblem=videoProvider==='bailian'&&videoModel?wanVideoSettingsError(videoModel,videoSettings):null;
 const incompatibleWan=!!wanSettingsProblem||videoProvider!=='bailian'&&JSON.stringify(draft.videoSettings)!==JSON.stringify(defaultWanSettings),videoCompatible=!!videoService&&videoService.executable&&!!videoModel&&videoService.models.includes(videoModel)&&!incompatibleWan;
 const selectedImageService=imageServices.find(s=>s.connectionVersionId===draft.imageSelection?.connectionVersionId&&s.provider===draft.imageSelection.provider&&s.adapter===draft.imageSelection.adapter);
 const imageService=selectedImageService?{...selectedImageService,constraints:{...selectedImageService.constraints,...selectedImageService.modelConstraints?.[draft.imageSelection?.model??'']}}:undefined,imageCompatible=!!imageService&&imageService.executable&&!!draft.imageSelection?.model&&imageService.models.includes(draft.imageSelection.model)&&!!imageService.constraints.sizes?.includes(draft.settings.size)&&!!imageService.constraints.qualities?.includes(draft.settings.quality)&&!!imageService.constraints.counts?.includes(draft.settings.count)&&draft.references.length<=(imageService.constraints.referenceImages?.max??0);
 const {framing,crop}=draft.imageBrief;
 const hasSavedCloseUpWithMargin=framing==='close'&&crop==='protect';
 const framingOption=crop==='allow'?framing:hasSavedCloseUpWithMargin?'close-with-margin':'full-with-margin';
 const visible=candidates.filter(c=>c.kind===tab),currentMatches=props.currentVisualKind===tab?visible.filter(c=>c.relativePath===props.currentVisualPath):[];
 const currentCandidate=currentMatches.find(c=>c.status==='adopted'||c.pendingConfirmation)??currentMatches[0];
 const currentEntry=props.currentVisualKind===tab&&!!props.currentVisualPath&&!currentCandidate;
 const entries=[...(currentEntry?[{id:'current',candidate:null}]:[]),...visible.map(c=>({id:c.id,candidate:c}))];
 const pendingUpload=uploadRows.find(row=>row.status==='running'&&!row.asReference&&row.tab===tab);
 const applicableImages=entries.filter(e=>e.candidate?.kind==='image'&&e.candidate.status==='available');
 const active=entries.find(e=>e.id===draft.selected[tab])??(tab==='image'&&applicableImages.length===1?applicableImages[0]:undefined)??entries.find(e=>e.id==='current'||!!currentCandidate&&e.candidate===currentCandidate),index=entries.findIndex(e=>e.id===active?.id),candidate=active?.candidate;
 const reader=useWorkspaceReading(workspace,updated,targetItemId,'无法读取当前工程，请重试。');
 const {read:fresh,publish:onChange}=reader;
 const candidateReview=useCandidateReviewLifecycle({workspace,scope:JSON.stringify([targetItemId,candidate?.id,policy,acceptImpact,draft.usage,rangeStart,rangeEnd,props.currentVisualKind]),reader,
  prepare:async(w,choice:{candidate:WorkspaceVisualCandidate;replaceCurrentVisual:boolean}):Promise<VisualReviewPlan>=>{
   const c=choice.candidate;
   if(c.kind==='image'&&props.currentVisualKind==='video'&&!choice.replaceCurrentVisual)return {kind:'image-backup',candidateId:c.id,projectSha256:w.project.sha256,candidate:c};
   const prepared=await command('prepareWorkspaceVisualCandidate',{
    ...base(w),candidateId:c.id,
    ...(c.kind==='image'
     ?{durationPolicy:'keep-target',acceptTimelineImpact:false,motionPolicy:'preserve-target',...(choice.replaceCurrentVisual?{replaceCurrentVisual:true}:{})}
     :{durationPolicy:policy,acceptTimelineImpact:acceptImpact,motionPolicy:draft.usage==='pan-zoom'?'replace-motion':'preserve-target',
       ...(rangeStartSeconds!==0||rangeEnd?{sourceInSeconds:rangeStartSeconds,sourceOutSeconds:rangeEndSeconds}:{})})
   }) as WorkspaceCandidatePreparation;
   if(!prepared.impact)throw Error('无法读取采用影响，请刷新后重新核对。');
   return {...prepared,kind:'adoption',candidate:c};
  },
  adopt:async(w,plan)=>command(plan.kind==='image-backup'?'retainWorkspaceImageCandidate':'adoptWorkspaceVisualCandidate',{
   ...base(w),candidateId:plan.candidateId,...(plan.kind==='adoption'?{adoptionId:plan.adoptionId}:{})
  }) as Promise<ProductionWorkspace>,
 });
 const disabled=busy||candidateReview.pending||uploading||props.readOnly||workspace.stale;
 const review=candidateReview.plan;
 const impact=review?.impact;
 const needsImpactDialog=needsCandidateImpactDialog(impact);
 const inlineReview=review&&!needsImpactDialog;
 const reviewSummary=impact?(impact.deltaSeconds===0?`镜头时长保持 ${impact.appliedSeconds.toFixed(2)} 秒`:`${impact.currentSeconds.toFixed(2)} → ${impact.appliedSeconds.toFixed(2)} 秒`):'保留为备用图片';
 useEffect(()=>{const rail=thumbnailRail.current,selected=rail?.querySelector<HTMLElement>('[aria-pressed=true]');if(!rail||!selected)return;const r=rail.getBoundingClientRect(),s=selected.getBoundingClientRect();if(s.top<r.top)rail.scrollTop-=r.top-s.top;else if(s.bottom>r.bottom)rail.scrollTop+=s.bottom-r.bottom;},[tab,active?.id]);
 const selectedImage=workspace.selectedImages?.find(s=>s.targetItemId===targetItemId);
 const firstFrameLimit=videoService?.constraints.firstFrame;
 // Older catalogs advertise first-frame limits without a per-model mode list.
 const registeredVideoModes=videoModel?videoService?.videoGenerationModes?.[videoModel]:undefined;
 const videoModes=registeredVideoModes??[firstFrameVideoMode(firstFrameLimit&&{...firstFrameLimit,maxBytes:wanProfile?.maxBytes??firstFrameLimit.maxBytes})];
 const videoMode=videoModes.find(mode=>mode.id===draft.videoModeId)??videoModes[0];
 const videoInputIds=videoDraftIds(draft);
 const videoInputs=resolveVideoInputs(videoMode,videoInputIds,allMaterials);
 const submitFirstFrame=videoInputs.find(entry=>entry.role==='firstFrame'&&!entry.reason)?.material;
 const videoSources=draft.referenceVideoSources??{};
 const submittedVideoInputs=videoInputs.flatMap(({role,id,reason})=>role&&!reason?[{
  role,materialRevisionId:id,...((role==='referenceVideos'||role==='referenceImages'&&videoMode.referenceImageSource)?{source:videoSources[id]?.trim()||undefined}:{}),
 } satisfies VideoVisualInputSelection]:[]);
 const advancedVideo=videoMode.id!=='first-frame';
 const canSubmitVideoMode=!!videoService&&!!videoModel;
 const videoInputProblem=videoVisualInputProblem(videoMode,submittedVideoInputs)
  ??(videoMode.allowInlineMp4&&videoInputs.some(entry=>entry.role==='referenceVideos'&&!entry.reason&&entry.material?.mime_type!=='video/mp4'&&!videoSources[entry.id]?.trim())?'本地参考视频须为 MP4，其他格式需要 HTTPS 地址。':null);
 function addVideoInput(id:string){
  setDraft(previous=>({...previous,videoInputIds:[...new Set([...videoDraftIds(previous),id])]}));
  setNotice('');
 }
 function moveVideoInput(from:number,to:number){
  setDraft(previous=>{
   const next=[...videoDraftIds(previous)];
   if(!Number.isInteger(from)||!Number.isInteger(to)||from<0||to<0||from>=next.length||to>=next.length||from===to)return previous;
   next.splice(to,0,next.splice(from,1)[0]);
   return {...previous,videoInputIds:next};
  });
 }
 const current=!!candidate&&candidate===currentCandidate||active?.id==='current',imageChosen=!!candidate&&selectedImage?.candidateId===candidate.id;
 const candidateMeta=[current?'当前镜头画面':imageChosen?'备用图片':candidate?.generation?.selection?.model,candidate?.status==='stale'?'输入已变化':null].filter(Boolean).join(' · ');
 const target=workspace.visualTargets?.find(t=>t.targetItemId===targetItemId),voiceDriven=!!target&&target.voiceMode!=='none';
 const minimumSeconds=wanProfile?.durations[0]??videoService?.constraints.durationSeconds?.min??2,maximumSeconds=wanProfile?.durations.at(-1)??videoService?.constraints.durationSeconds?.max??15,actualDuration=voiceDriven?target.durationSeconds:Number(draft.duration),providerDuration=actualDuration===null?null:wanProfile?wanProviderDuration(videoModel!,actualDuration,voiceDriven):voiceDriven?Math.max(minimumSeconds,Math.ceil(actualDuration)):actualDuration,invalidDuration=!actualDuration||actualDuration<(voiceDriven?0.1:minimumSeconds)||actualDuration>maximumSeconds||!voiceDriven&&!Number.isInteger(actualDuration)||!!wanProfile&&providerDuration===undefined;
 function change<K extends keyof Draft>(key:K,value:Draft[K]){setDraft(d=>({...d,[key]:value}));}
 function chooseVideoSource(value:string){
  const search=videoServices.find(service=>service.mode==='search'&&value===`${service.id}:search`);
  if(search)setDraft(d=>({...d,pexelsSelection:{capability:'video',provider:search.provider,adapter:search.adapter,connectionVersionId:search.connectionVersionId??undefined},origin:{...d.origin,video:'search'}}));
  else if(!value&&origin==='search')change('pexelsSelection',null);
  else setDraft(d=>({...d,videoSelection:productionModelSelection(videoServices,value,'video'),origin:{...d.origin,video:'generate'}}));
  setComposerPanel(value&&!search?'dimensions':'');
 }

 function select(id:string){setDraft(d=>({...d,selected:{...d.selected,[d.tab]:id}}));setRangeStart('');setRangeEnd('');setPolicy('keep-target');setAcceptImpact(false);setError('');}
 function url(path:string,sha256=''){return '/_local-artifact?'+new URLSearchParams({episode:workspace.episodeId,path,...(sha256?{sha256}:{})});}
 useEffect(()=>{
  if(uploading||!uploadRows.some(row=>row.status==='succeeded'&&!row.asReference&&!workspace.visualCandidates?.some(candidate=>candidate.targetItemId===targetItemId&&candidate.materialRevisionId===row.material?.id&&candidate.status!=='rejected')))return;
  void fresh().catch(cause=>{if(mounted.current&&!(cause instanceof Error&&cause.name==='AbortError'))setError('素材已导入，候选列表暂未更新，请刷新重试。');});
 },[uploading,uploadRows,fresh]);
 useWorkspacePolling(reader,!!taskKey&&!busy&&!candidateReview.pending&&!uploading,2000,()=>setError('任务状态暂时无法更新，可点击刷新重试。'));
 function base(w:ProductionWorkspace){return {episodeId:w.episodeId,workspaceId:w.id,expectedRevision:w.revision};}
 async function run(action:()=>Promise<void>){if(working.current)return;working.current=true;setBusy(true);setError('');setNotice('');try{await action();}catch(cause){if(mounted.current&&!(cause instanceof Error&&cause.name==='AbortError'))setError(cause instanceof Error?cause.message:'操作未完成，请重试。');}finally{working.current=false;if(mounted.current)setBusy(false);}}

 async function register(materialId:string,kind:Kind,usage=draft.usage){const w=await fresh(),existing=w.visualCandidates?.find(c=>c.targetItemId===targetItemId&&c.materialRevisionId===materialId&&c.status!=='rejected');const next=existing?w:await command('registerWorkspaceVisualCandidate',{...base(w),targetItemId,materialRevisionId:materialId,usage:kind==='video'?'video':usage,durationSeconds:3}) as ProductionWorkspace;onChange(next);const added=next.visualCandidates?.find(c=>c.targetItemId===targetItemId&&c.materialRevisionId===materialId&&c.status!=='rejected');if(mounted.current&&added)setDraft(d=>({...d,tab:kind,selected:{...d.selected,[kind]:added.id}}));}
 function reportUpload(message:string,failed=true){uploadNoticeId=Math.max(uploadNoticeId,uploadState.read().notice?.id??0)+1;uploadState.update(value=>({...value,notice:{id:uploadNoticeId,message,failed,expiresAt:Date.now()+5000}}));}
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
     if(row.asReference&&!(row.tab==='video'?['image/png','image/jpeg','image/webp','image/bmp','video/mp4','video/quicktime','video/webm']:['image/png','image/jpeg','image/webp']).includes(file.type)||!row.asReference&&(row.kind!==row.tab||!['image/png','image/jpeg','image/webp','image/bmp','video/mp4'].includes(file.type)))throw Error(row.asReference?(row.tab==='video'?'请选择有效的图片或视频文件。':'请选择 PNG、JPEG 或 WebP 参考图。'):`请选择有效的${row.tab==='image'?'图片':'视频'}文件。`);
     if(row.asReference&&row.tab==='image'&&file.size>20*1024*1024)throw Error('每张参考图不能超过 20 MB。');
     if(row.asReference&&row.tab==='image'&&referenceIds.size>=16)throw Error('最多可添加 16 张参考图。');
     const contentBase64=await new Promise<string>((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result).split(',')[1]);r.onerror=()=>reject(Error('文件读取失败。'));r.readAsDataURL(file);});
     if(!mounted.current){updateUpload(row.id,{status:'pending'});break;}
     const m=await command('importMaterial',{episodeId:workspace.episodeId,sourceKind:'file',sourcePath:file.name,materialType:row.kind,mimeType:file.type,contentBase64,isMainScript:false,materialPurpose:row.kind==='image'?'visual_reference':'b_roll'}) as Material&{storage_path:string};
     material={...m,source_path:file.name,material_type:row.kind};
     updateUpload(row.id,{material,file:undefined});
     if(mounted.current)props.onImported?.(material);
    }
    if(!mounted.current){updateUpload(row.id,{status:'pending',error:row.asReference?'素材已导入，尚未选为参考图。':'素材已导入，尚未加入候选。'});break;}
    if(row.asReference){if(row.tab==='image'&&!referenceIds.has(material.id)&&referenceIds.size>=16)throw Error('最多可添加 16 张参考图。');referenceIds.add(material.id);if(mounted.current)setDraft(d=>row.tab==='image'?{...d,references:[...new Set([...d.references,material!.id])].slice(0,16)}:{...d,videoInputIds:[...new Set([...videoDraftIds(d),material!.id])]});}
    else await register(material.id,row.kind,row.usage);
    updateUpload(row.id,{status:'succeeded',file:undefined});
   }catch(cause){updateUpload(row.id,{status:cause instanceof Error&&cause.name==='AbortError'?'pending':'failed',error:(material?row.asReference?'素材已导入，参考图未选入：':'素材已导入，候选未完成：':'')+(cause instanceof Error&&cause.name==='AbortError'?'已暂停，重试可继续。':cause instanceof Error?cause.message:'上传未完成，请重试。')});}
  }
 });}finally{
   uploadState.update(value=>({...value,running:false}));
   const completed=uploadState.read().rows.filter(row=>rows.some(attempt=>attempt.id===row.id)),unfinished=completed.filter(row=>row.status!=='succeeded');
   reportUpload(unfinished.length===1?`${unfinished[0].name}：${unfinished[0].error??'上传未完成，请重试。'}`:unfinished.length?`${unfinished.length} 个文件未完成，可在上传记录中查看并重试。`:`已添加 ${completed.length} 个文件。`,unfinished.length>0);
  }
 }
 async function upload(files:File[],asReference=false){
  if(working.current||uploadState.read().running)return;
  if(asReference&&tab==='image'&&files.length+draft.references.length>16){reportUpload('最多可添加 16 张参考图。');return;}
  uploadEntryId=Math.max(uploadEntryId,0,...uploadState.read().rows.map(row=>row.id));
  const rows=files.map(file=>({id:++uploadEntryId,name:file.name,file,kind:file.type.startsWith('image/')?'image' as const:'video' as const,asReference,tab,usage:draft.usage,status:'pending' as const}));
  uploadState.update(value=>({...value,rows:[...value.rows,...rows]}));await processUploads(rows);
 }
 async function adopt(c:WorkspaceVisualCandidate,replaceCurrentVisual=false){
  if(working.current)return;setError('');setNotice('');
  try{await candidateReview.prepare({candidate:c,replaceCurrentVisual});}
  catch(cause){if(mounted.current&&!(cause instanceof Error&&cause.name==='AbortError'))setError(cause instanceof Error?cause.message:'操作未完成，请重试。');}
 }
 function returnAdoptionFocus(){
  if(inlineReview)requestAnimationFrame(()=>{
   const menu=resultMore.current;
   if(tab==='image'&&menu)menu.open=false;
   const summary=menu?.querySelector('summary');
   const trigger=tab==='image'?summary:adoptTrigger.current;
   (trigger&&!trigger.matches(':disabled')?trigger:summary)?.focus();
  });
 }
 function closeAdoption(){candidateReview.cancel();returnAdoptionFocus();}
 async function confirmAdoption(){
  setError('');returnAdoptionFocus();
  try{await candidateReview.confirm((_changed,plan)=>{
   const c=plan.candidate;
   if(c.kind==='image'&&c.materialRevisionId)setDraft(d=>(videoDraftIds(d).some(id=>allMaterials.some(material=>material.id===id&&material.material_type==='image'))?d:{...d,videoInputIds:prioritizeVideoInput(d,c.materialRevisionId!)}));
   setNotice(plan.kind==='image-backup'?'图片已保留为备用。':`已采用${c.kind==='image'?'图片':'视频'}。`);
  });}catch(cause){if(mounted.current&&!(cause instanceof Error&&cause.name==='AbortError'))setError(cause instanceof Error?cause.message:'操作未完成，请重试。');}
 }
 function removeSelected(){
  const menu=resultMore.current;
  if(menu){menu.open=false;menu.querySelector('summary')?.focus();}
  if(current||imageChosen){
   setClearError('');
   setClearVisual({revision:workspace.revision,candidateId:candidate?.id,...(current?{sourcePath:props.currentVisualPath,sourceSha256:props.currentVisualSha256??candidate?.sha256}:{})});
   return;
  }
  if(!candidate)return;
  void run(async()=>{
   const w=await fresh();
   onChange(await command('rejectWorkspaceVisualCandidate',{...base(w),candidateId:candidate.id}) as ProductionWorkspace);
   select((entries[index+1]??entries[index-1])?.id??'');
   requestAnimationFrame(()=>thumbnailRail.current?.querySelector<HTMLElement>('[aria-pressed=true]')?.focus());
  });
 }
 async function generate(retryOfTaskId?:string){await run(async()=>{
   const w=await fresh();
   if(tab==='video'){
    if(!canSubmitVideoMode||videoInputProblem||!advancedVideo&&!submitFirstFrame)throw Error(videoInputProblem||'请先选择当前模式可用的画面。');
    const after=w.visualTargets?.find(t=>t.targetItemId===targetItemId);
    if(JSON.stringify(after)!==JSON.stringify(target))throw Error('当前口播窗口已变化，请重新确认时长后生成。');
   }
   const next=await command(tab==='image'?'requestWorkspaceImageCandidates':'requestWorkspaceVisualCandidate',{
    ...base(w),targetItemId,prompt:tab==='image'?draft.imagePrompt:draft.videoPrompt,
    ...(tab==='image'?{selection:draft.imageSelection,settings:draft.settings,imageBrief:{...draft.imageBrief,references:draft.references.map(id=>draft.imageBrief.references.find(r=>r.materialRevisionId===id)??{materialRevisionId:id,purpose:'subject',preserve:'',change:''})},referenceMaterialRevisionIds:draft.references,...(retryOfTaskId?{retryOfTaskId}:{})}:{selection:draft.videoSelection,...(advancedVideo?{videoMode:videoMode!.id,visualInputs:submittedVideoInputs}:{firstFrameMaterialRevisionId:submitFirstFrame?.id}),durationSeconds:actualDuration,...(submitFirstFrame?{firstFrameFit:draft.firstFrameFit}:{}),...(videoProvider==='bailian'?{videoSettings}:{})})
   }) as ProductionWorkspace;
   onChange(next);setNotice('生成任务已提交，完成后请预览并手动采用。');
  });}
 function referenceBrief(id:string,patch:Partial<ImageBrief['references'][number]>) {setDraft(d=>({...d,imageBrief:{...d.imageBrief,references:[...d.imageBrief.references.filter(r=>r.materialRevisionId!==id),{materialRevisionId:id,purpose:'subject',preserve:'',change:'',...d.imageBrief.references.find(r=>r.materialRevisionId===id),...patch}]}}));}
 const sizePreset=imageSizePresets.find(p=>p.standard===draft.settings.size||p.high===draft.settings.size)??imageSizePresets[0];
 function linkFirstFrame(){if(!candidate?.materialRevisionId)return;setDraft(d=>({...d,videoInputIds:prioritizeVideoInput(d,candidate.materialRevisionId!),videoModeId:'first-frame',tab:'video',origin:{...d.origin,video:'generate'}}));setNotice('已选定视频首帧，尚未提交生成。');}
 const existingVideoIn=visual?.kind==='video'&&timeline?Number(visual.srcInFrame??0)/timeline.fps:0;
 const rangeStartSeconds=rangeStart===''?existingVideoIn:Number(rangeStart),rangeEndSeconds=rangeEnd?Number(rangeEnd):candidate?.durationSeconds??0;
 const selectedVideoDuration=candidate?.kind==='video'?rangeEndSeconds-rangeStartSeconds:null;
 const rangeValid=candidate?.kind!=='video'||rangeStartSeconds>=0&&Number.isFinite(selectedVideoDuration)&&selectedVideoDuration!>0&&rangeEndSeconds<=candidate.durationSeconds;
 const previewSegment=candidate?.kind==='video'&&rangeValid&&(rangeStartSeconds>0||rangeEndSeconds<candidate.durationSeconds)
  ?{start:rangeStartSeconds,end:rangeEndSeconds}:undefined;
 const canAdopt=rangeValid&&!!candidate&&candidate.status==='available'&&(candidate.kind==='image'||(policy==='keep-target'?candidate.currentDurationSeconds===null||(selectedVideoDuration??candidate.durationSeconds)+0.05>=candidate.currentDurationSeconds:acceptImpact));
 const adoptionLabel=current?'已采用':imageChosen?'图片已选用':tab==='image'&&props.currentVisualKind==='video'?'保留为备用图片':'采用到当前镜头';
 const adoptionAction=tab==='image'?<button type="button" aria-label={adoptionLabel} aria-describedby={adoptionDescriptionId} disabled={disabled||current||imageChosen||!canAdopt} onClick={()=>{if(candidate)void adopt(candidate);}}>
  <span>{adoptionLabel}</span><small id={adoptionDescriptionId}>{current?'当前镜头正在使用此图':imageChosen?'此图已保留为备用图片':props.currentVisualKind==='video'?'仅保留备用，当前视频不变':'用作镜头画面，保持时长不变'}</small>
 </button>:<Button ref={adoptTrigger} size="sm" color="primary" isDisabled={disabled||current||imageChosen||!canAdopt} onPress={()=>{if(candidate)void adopt(candidate);}}>{adoptionLabel}</Button>;
 const selectedService=tab==='image'?imageService:videoService,selectedSelection=tab==='image'?draft.imageSelection:draft.videoSelection;
 const qualityLabels=imageQualityLabels;
 const selectionProblems=selectedSelection?[
  ...(!selectedService?['连接：原连接版本不在当前服务目录中，请重新选择模型。']:!selectedService.executable&&(tab==='video'||imageServices.some(service=>service.executable&&service.models.length))?[`连接：${selectedService.unavailableReason??'当前不可执行，请检查连接。'}`]:[]),
  ...(selectedService&&!selectedService.models.includes(selectedSelection.model??'')?[`模型：${selectedSelection.model??'未选择'}不在此连接的已启用模型中，请重新选择。`]:[]),
  ...(tab==='image'&&imageService?[
   ...(!imageService.constraints.sizes?.includes(draft.settings.size)?[`实际像素：${draft.settings.size.replace('x',' × ')}；当前模型支持 ${(imageService.constraints.sizes??[]).map(s=>s.replace('x',' × ')).join(' / ')||'未注册'}。`]:[]),
   ...(!imageService.constraints.qualities?.includes(draft.settings.quality)?[`质量：${qualityLabels[draft.settings.quality]}；当前模型支持 ${(imageService.constraints.qualities??[]).map(q=>qualityLabels[q as keyof typeof qualityLabels]??q).join(' / ')||'未注册'}。`]:[]),
   ...(!imageService.constraints.counts?.includes(draft.settings.count)?[`数量：${draft.settings.count} 张；当前模型支持 ${(imageService.constraints.counts??[]).map(n=>`${n} 张`).join(' / ')||'未注册'}。`]:[]),
   ...(draft.references.length>(imageService.constraints.referenceImages?.max??0)?[`参考图：已选 ${draft.references.length} 张；当前模型最多支持 ${imageService.constraints.referenceImages?.max??0} 张。`]:[])
  ]:[])
 ]:[];
 const prompt=tab==='image'?draft.imagePrompt:draft.videoPrompt,promptLimit=Math.min(tab==='image'?1200:1500,(tab==='image'?imageService:videoService)?.constraints.prompt?.maxLength??Infinity);
 const latestImageTask=tab==='image'?tasks.find(t=>t.kind==='image'&&t.targetItemId===targetItemId):undefined;
 const unknownTasks=tasks.filter(t=>t.targetItemId===targetItemId&&t.submissionUnknown&&!t.retryTaskId);
 const unknownImageTask=tab==='image'&&unknownTasks.length===1&&unknownTasks[0].kind==='image'
  &&unknownTasks[0].submissionOutcome!=='received'&&unknownTasks[0].publicationAttempt==null?unknownTasks[0]:undefined;
 const retryImage=!!latestImageTask&&['failed','blocked'].includes(latestImageTask.status)&&!latestImageTask.submissionUnknown&&latestImageTask.publicationAttempt==null;
 const showEmptyCandidateDrop=!!shelf&&!entries.length&&!pendingUpload;
 const dropCandidate=<WorkspaceMaterialDrop label={`拖入${kindName}加入候选`} kind={tab} disabled={disabled} surface="preview" persistent={showEmptyCandidateDrop}
  onSelect={id=>void run(async()=>{await register(id,tab);})}/>;
 const generationBlocker=pending.some(t=>(t.kind??'video')===tab)?'正在生成，请等待结果。'
  :tasks.some(t=>t.targetItemId===targetItemId&&(t.publicationAttempt!=null||t.submissionUnknown&&!t.retryTaskId&&t!==unknownImageTask))?'请先核对上一条生成任务。'
  :workspace.stale?'脚本已更新，请先核对当前素材。'
  :tab==='image'&&!imageCompatible?'请选择可用的图片模型和规格。'
  :tab==='video'&&!videoCompatible?'请选择可用的视频模型。'
  :tab==='video'&&(!canSubmitVideoMode||videoInputProblem||!advancedVideo&&!submitFirstFrame)?'请检查生成模式和画面素材。'
  :tab==='video'&&invalidDuration?'请调整到模型支持的时长。'
  :tab==='video'&&draft.videoSettings.negativePrompt.length>500?'负面提示词最多 500 字。'
  :!prompt.trim()?'请填写提示词。':prompt.length>promptLimit?`提示词最多 ${promptLimit} 字。`:'';
 const canGenerate=!generationBlocker;
 const imagePreviewFailed=candidate?.id===imagePreviewError;
 const thumbnailTasks=pending.filter(t=>(t.kind??'video')===tab&&(!t.targetItemId||t.targetItemId===targetItemId)&&!t.submissionUnknown&&!t.retryTaskId);
 return <section className="workspace-visual-candidates workspace-visual-unified" aria-label="镜头图片与视频">
  <header><div className="workspace-visual-preview-tabs" role="tablist" aria-label="画面类型">{(['image','video'] as const).map(kind=><button key={kind} id={`visual-kind-${targetItemId}-${kind}`} type="button" role="tab" aria-selected={tab===kind} aria-controls={`visual-content-${targetItemId}`} tabIndex={tab===kind?0:-1} onClick={()=>change('tab',kind)} onKeyDown={e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();const next=e.key==='Home'?'image':e.key==='End'?'video':tab==='image'?'video':'image';change('tab',next);document.getElementById(`visual-kind-${targetItemId}-${next}`)?.focus();}}}>{kind==='image'?'图片':'视频'}</button>)}</div><div className="workspace-visual-header-actions"><WorkspaceUploadFeedback rows={uploadRows} running={uploading} disabled={disabled} notice={uploadNotice} onDismiss={id=>uploadState.update(value=>value.notice?.id===id?{...value,notice:undefined}:value)} onRetry={()=>void processUploads(uploadRows.filter(row=>row.status==='failed'||row.status==='pending'))}/>
  <Button size="sm" color="tertiary" iconLeading={RefreshCw} aria-label="刷新" title="刷新画面候选" isDisabled={disabled} onPress={()=>void run(async()=>{await fresh();setCatalogReload(value=>value+1);})}/></div></header>
  {options.length>1&&<label>目标片段<NativeSelect size="sm" aria-label="画面候选目标" value={targetItemId} disabled={disabled} onChange={e=>props.onTargetChange?.(e.target.value)}>{options.map((clip,index)=>{
    const item=timeline?.items.find(entry=>entry.id===clip.itemId);
    const slot=(item?.loopControlComposition as {slotId?:string}|undefined)?.slotId;
    return <option key={clip.itemId} value={clip.itemId}>{slot?shotCompositionSlotLabels[slot]??`片段 ${index+1}`:`片段 ${index+1}`} · {clip.text}</option>;
   })}</NativeSelect></label>}
  <div id={`visual-content-${targetItemId}`} role="tabpanel" aria-labelledby={`visual-kind-${targetItemId}-${tab}`} className="workspace-visual-content">
   <section className="workspace-visual-results" aria-label={`${kindName}候选结果`}>
    {!shelf&&allMaterials.some(m=>m.material_type===tab)&&<div className="workspace-results-heading"><details className="workspace-results-import" onKeyDown={e=>{if(e.key==='Escape'){e.currentTarget.open=false;e.currentTarget.querySelector('summary')?.focus();}}}><summary>从本期素材选取</summary><div className="workspace-results-import-content"><label>本期{kindName}<NativeSelect size="sm" aria-label={`选择本期${kindName}`} value="" disabled={disabled} onChange={e=>{const id=e.target.value,disclosure=e.currentTarget.closest('details');if(id)void run(async()=>{await register(id,tab);disclosure?.removeAttribute('open');});}}><option value="">选择后加入候选</option>{allMaterials.filter(m=>m.material_type===tab).map(m=><option key={m.id} value={m.id}>{m.source_path.split('/').pop()}</option>)}</NativeSelect></label></div></details></div>}
    <div className="workspace-results-gallery">
      {(entries.length>0||thumbnailTasks.length>0)&&<div ref={thumbnailRail} className="workspace-thumbnail-rail" role="group" aria-label={`${kindName}候选缩略图`} data-kind={tab} onKeyDown={event=>{
       if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(event.key))return;
       const buttons=Array.from(event.currentTarget.querySelectorAll('button'));
       const focused=buttons.indexOf(event.target as HTMLButtonElement);
       if(focused<0)return;
       event.preventDefault();
       const next=event.key==='Home'?0:event.key==='End'?entries.length-1:(focused+(['ArrowRight','ArrowDown'].includes(event.key)?1:-1)+entries.length)%entries.length;
       select(entries[next].id);
       buttons[next].focus();
      }}>
       {entries.map((entry,i)=>{
        const c=entry.candidate,number=String(i+1).padStart(2,'0');
        const adopted=!c||c===currentCandidate||selectedImage?.candidateId===c.id;
        return <button className="workspace-thumbnail-select" key={entry.id} type="button"
         aria-label={`预览${kindName}候选 ${number}${adopted?'，已采用':''}`} aria-pressed={active?.id===entry.id} onClick={()=>select(entry.id)}>
         <span className="workspace-thumbnail-media">{c?(c.kind==='image'?<img src={url(c.relativePath,c.sha256)} alt="" loading="lazy"/>:<video src={url(c.relativePath,c.sha256)} muted preload="metadata" aria-hidden="true"/>):(tab==='image'?<ImageIcon aria-hidden="true"/>:<Video aria-hidden="true"/>)}</span>
         <span className="workspace-thumbnail-caption" aria-hidden="true">{number}{adopted&&<Check size={14} className="workspace-thumbnail-adopted"/>}</span>
        </button>;
       })}
       {thumbnailTasks.flatMap(task=>Array.from({length:Math.max(1,Math.min(4,task.kind==='image'?task.generation?.imageSettings?.count??1:1))},(_,i)=><div className="workspace-thumbnail-pending" key={`${task.id}:${i}`}><WorkspaceVisualTaskProgress task={task} label={kindName} thumbnail/></div>))}
      </div>}
   <div className="workspace-unified-preview" onKeyDown={e=>{if(e.target!==e.currentTarget||entries.length<2)return;if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();select(entries[(index+(e.key==='ArrowRight'?1:-1)+entries.length)%entries.length].id);}}} tabIndex={entries.length>1?0:undefined} aria-label={`${kindName}预览`}>
    {active?.id==='current'?props.preview:candidate?(tab==='image'?imagePreviewFailed?<div className="workspace-visual-empty"><p role="alert">图片未能加载。</p><Button size="sm" color="secondary" onPress={()=>{setImagePreviewError('');retryImagePreview(value=>value+1);}}>重试预览</Button></div>:<img key={`${candidate.id}:${imagePreviewAttempt}`} src={url(candidate.relativePath,candidate.sha256)} alt={`${kindName}候选 ${index+1}`} onError={()=>setImagePreviewError(candidate.id)}/>:<VideoPreview key={candidate.id} title="视频候选预览" aria-label="视频候选预览" src={url(candidate.relativePath,candidate.sha256)} downloadHref={url(candidate.relativePath,candidate.sha256)+'&download=1'} segment={previewSegment}/>):pendingUpload?<div className="workspace-upload-preview" role="status" aria-label={`${kindName}候选上传中`}><div className="workspace-upload-preview-placeholder" style={{aspectRatio:`${target?.width??9}/${target?.height??16}`}} aria-hidden="true"/><p>正在准备{kindName}候选…</p><small>{pendingUpload.name}</small></div>:!showEmptyCandidateDrop&&<div className="workspace-visual-empty">{tab==='image'?<ImageIcon size={28} aria-hidden="true"/>:<Video size={28} aria-hidden="true"/>}<p>{entries.length?'选择左侧缩略图预览':`尚未添加${kindName}`}</p>{!entries.length&&<span>{shelf?'从左侧本期素材拖入，或使用 AI 生成':'上传素材，或使用 AI 生成'}</span>}</div>}
    {candidate&&tab==='image'&&!imagePreviewFailed&&<div className="workspace-preview-actions"><a className="workspace-preview-zoom" href={url(candidate.relativePath,candidate.sha256)+'&download=1'} download aria-label="下载图片" title="下载原图"><Download size={16} aria-hidden="true"/></a><button ref={zoomTrigger} className="workspace-preview-zoom" type="button" aria-label="放大图片" title="放大图片" onClick={()=>setZoom(true)}><Maximize2 size={16} aria-hidden="true"/></button></div>}
    {dropCandidate}
   </div>

      {active&&<div className="workspace-result-footer">
       <p title={inlineReview?reviewSummary:candidateMeta||candidate?.relativePath}><strong>{candidate?`候选 ${String(index+1).padStart(2,'0')} / ${String(entries.length).padStart(2,'0')}`:'当前画面'}</strong>{inlineReview?<span role="status">{reviewSummary}</span>:candidateMeta&&<span>{candidateMeta}</span>}</p>
       {inlineReview?<div className="workspace-result-actions workspace-result-confirmation" role="group" aria-label="采用前核对" onKeyDown={event=>{if(event.key==='Escape'&&!candidateReview.pending&&!busy){event.stopPropagation();closeAdoption();}}}>
        <Button autoFocus size="sm" color="secondary" isDisabled={disabled} onPress={closeAdoption}>取消</Button>
        <Button size="sm" color="primary" isDisabled={disabled} onPress={()=>void confirmAdoption()}>确认采用</Button>
       </div>:<div className="workspace-result-actions">
         <details key={active.id} ref={resultMore} className="workspace-result-more workspace-candidate-actions"
          onBlur={e=>{
           const next=e.relatedTarget;
           if(!e.currentTarget.contains(next)&&!next?.closest('[data-select-popup]'))e.currentTarget.open=false;
          }}
          onKeyDown={e=>{if(e.key==='Escape'&&e.currentTarget.open){e.stopPropagation();e.currentTarget.open=false;e.currentTarget.querySelector('summary')?.focus();}}}>
          <summary>更多操作 <ChevronDown size={14} aria-hidden="true"/></summary>
          <div className="workspace-result-more-content">
            {tab==='image'&&adoptionAction}
           {tab==='image'&&candidate?.status==='available'&&props.currentVisualKind==='video'&&
            <button type="button" disabled={disabled} onClick={()=>{if(resultMore.current)resultMore.current.open=false;void adopt(candidate,true);}}>
             <span>替换当前视频</span><small>保留片段时长和已有画面调整</small>
            </button>}
           {tab==='video'&&current&&canSplitVideo&&<button type="button" disabled={disabled} onClick={()=>{
            if(resultMore.current)resultMore.current.open=false;
            void run(async()=>{
             const w=await fresh();
             onChange(await command('splitWorkspaceVideoSound',{...base(w),targetItemId}) as ProductionWorkspace);
             setNotice('视频原声已拆分，可在剪辑工作台单独编辑。');
            });
           }}>拆分视频原声</button>}
           {tab==='video'&&candidate&&!current&&<details><summary aria-label="裁剪与时长">裁剪与时长<small>选择使用区间，调整采用后的镜头时长</small></summary><div className="workspace-adoption-settings">
    <div className="workspace-visual-fields"><label>使用起点（秒）<input type="number" aria-label="视频使用起点（秒）" min="0" max={candidate.durationSeconds} step="0.1" disabled={disabled} value={rangeStart||String(existingVideoIn)} onChange={e=>setRangeStart(e.target.value)}/></label><label>使用终点（秒）<input type="number" aria-label="视频使用终点（秒）" min="0.1" max={candidate.durationSeconds} step="0.1" disabled={disabled} value={rangeEnd||candidate.durationSeconds} onChange={e=>setRangeEnd(e.target.value)}/></label></div>
    <label>采用时长<NativeSelect size="sm" aria-label="视觉候选时长处理" disabled={disabled} value={policy} onChange={e=>{setPolicy(e.target.value);setAcceptImpact(false);}}><option value="keep-target">保留镜头时长</option><option value="use-candidate">使用素材完整时长</option></NativeSelect></label>
    {policy==='use-candidate'&&<label className="workspace-visual-checkbox"><input type="checkbox" disabled={disabled} checked={acceptImpact} onChange={e=>setAcceptImpact(e.target.checked)}/>保留其他片段位置，接受空隙或覆盖</label>}
    {policy==='keep-target'&&candidate.kind==='video'&&candidate.currentDurationSeconds!==null&&(!rangeValid||(selectedVideoDuration??candidate.durationSeconds)+0.05<candidate.currentDurationSeconds)&&<p role="alert">所选区间无法保留当前片段时长，请调整起止点或采用素材区间的时长。</p>}

    </div></details>}
{candidate?.source&&<p><a href={candidate.source.sourceUrl} target="_blank" rel="noreferrer">Pexels #{candidate.source.id}</a> · <a href={candidate.source.creatorUrl} target="_blank" rel="noreferrer">{candidate.source.creator}</a> · {candidate.source.connectionName} · {candidate.source.query}</p>}
            <button type="button" className="workspace-candidate-remove" disabled={disabled||(!current&&!imageChosen&&!!candidate?.pendingConfirmation)} onClick={removeSelected}>{current?'取消采用':imageChosen?'取消备用图片':'移除候选'}</button>
          </div>
         </details>
         {tab==='image'?candidate?.materialRevisionId&&<Button size="sm" color="primary" isDisabled={disabled||candidate.status==='stale'} onPress={linkFirstFrame}>用作视频首帧</Button>:adoptionAction}
       </div>}
      </div>}
      {needsImpactDialog&&review&&review.kind==='adoption'&&createPortal(<div className="workspace-visual-adoption-overlay">
       <ConfirmationModal title="采用前核对" confirmLabel="确认采用" isPending={busy||candidateReview.pending} confirmDisabled={!!disabled} onConfirm={confirmAdoption} onCancel={closeAdoption}>
        <div className="workspace-candidate-impact-details"><WorkspaceCandidateImpactDetails plan={review}/></div>
       </ConfirmationModal>
      </div>,document.querySelector('.app-shell')??document.body)}
    </div>
  {tasks.filter(t=>t.status!=='completed'&&!thumbnailTasks.includes(t)).map(t=><WorkspaceVisualTaskStatus key={t.id} task={t} label={(t.kind??'video')==='image'?'图片':'视频'} disabled={disabled} onRetryUnknown={t===unknownImageTask?()=>{if(origin==='generate'&&canGenerate)void generate(t.taskId);else{setDraft(d=>({...d,origin:{...d.origin,image:'generate'}}));requestAnimationFrame(()=>formRef.current?.scrollIntoView({block:'nearest'}));}}:undefined} onRefresh={()=>void run(async()=>{await fresh();setCatalogReload(value=>value+1);})} onResume={()=>void run(async()=>{const w=await fresh();onChange(await command('retryWorkspaceVisualCandidate',{...base(w),candidateId:t.id}) as ProductionWorkspace);})} onReconcile={()=>void run(async()=>{await reconcileWorkspaceOutput(workspace.episodeId,t);onChange(await fresh());})}/>)}
   </section>
   {!shelf&&<div className="workspace-visual-origin" role="group" aria-label={`${kindName}来源`}>{(['material','generate'] as const).filter(value=>!shelf||value!=='material').map(value=><button key={value} type="button" aria-pressed={origin===value||value==='generate'&&origin==='search'} onClick={()=>setDraft(d=>({...d,origin:{...d.origin,[tab]:value}}))}>{value==='material'?'上传素材':'AI 生成'}</button>)}</div>}
   {origin==='material'?<div className="workspace-visual-import">
    <button type="button" className="workspace-visual-dropzone" disabled={disabled} onClick={()=>fileInput.current?.click()} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();if(!disabled)void upload([...e.dataTransfer.files]);}}><Upload size={18} aria-hidden="true"/><span>选择或拖入{kindName}</span><small>{tab==='image'?'PNG、JPEG、WebP、BMP · 每张不超过 100 MB · 可多选':'MP4 · 不超过 100 MB · 每次 1 个'}</small></button>

   </div>:origin==='search'?<WorkspacePexelsSearch key={targetItemId} workspace={workspace} targetItemId={targetItemId} command={command} onChange={onChange} prepare={fresh} reader={reader} disabled={disabled} composer={{services:videoServices,selection:draft.pexelsSelection,onModelChange:chooseVideoSource,catalogError,catalog:catalogReading}}/>:<div className="workspace-visual-generation-form" ref={formRef}>

    {catalogError&&<p role="alert">{catalogError}</p>}
    {selectionProblems.length>0&&<ul className="workspace-generation-problems" aria-label={`${kindName}设置不兼容`} role="list">{selectionProblems.map(problem=><li key={problem}>{problem}</li>)}</ul>}
    {tab==='video'&&incompatibleWan&&<p role="alert">{wanSettingsProblem??`当前模型不支持万相专用设置：${Object.entries(draft.videoSettings).filter(([key,value])=>value!==defaultWanSettings[key as keyof typeof defaultWanSettings]).map(([key])=>wanSettingLabels[key as keyof WanGenerationSettings]??key).join('、')}。`}<Button size="sm" color="tertiary" onPress={()=>change('videoSettings',videoProvider==='bailian'&&videoModel?defaultWanModelSettings(videoModel):{...defaultWanSettings})}>清除不兼容的万相参数</Button></p>}

    <WorkspaceGenerationComposer kind={tab} disabled={disabled} reference={tab==='image'?<WorkspaceReferencePicker compact maxCount={imageService?.constraints.referenceImages?.max??16} materials={allMaterials} selected={draft.references} disabled={disabled} onChange={ids=>change('references',ids)} onUpload={files=>upload(files,true)} url={url} summary={id=>referencePurposeLabels[draft.imageBrief.references.find(r=>r.materialRevisionId===id)?.purpose??'subject']} renderDetails={(id,i)=>{const r=draft.imageBrief.references.find(r=>r.materialRevisionId===id);return <fieldset key={id} className="workspace-image-reference-brief" disabled={disabled}><legend>参考图 {i+1} · {allMaterials.find(m=>m.id===id)?.source_path.split('/').pop()}</legend><label>参考用途<NativeSelect size="sm" aria-label={`参考图 ${i+1} 用途`} value={r?.purpose??'subject'} onChange={e=>referenceBrief(id,{purpose:e.target.value as keyof typeof referencePurposeLabels})}>{Object.entries(referencePurposeLabels).map(([v,label])=><option key={v} value={v}>{label}</option>)}</NativeSelect></label><label>需要保留<input maxLength={160} aria-label={`参考图 ${i+1} 需要保留`} value={r?.preserve??''} placeholder="例如：产品图案、人物外观" onChange={e=>referenceBrief(id,{preserve:e.target.value})}/></label><label>允许改变<input maxLength={160} aria-label={`参考图 ${i+1} 允许改变`} value={r?.change??''} placeholder="例如：背景、光线" onChange={e=>referenceBrief(id,{change:e.target.value})}/></label></fieldset>;}}/>:<WorkspaceVideoInputs compact modes={videoModes} mode={videoMode} entries={videoInputs} disabled={disabled}
     onMode={id=>change('videoModeId',id)} onAdd={addVideoInput} onMove={moveVideoInput} onRemove={index=>setDraft(previous=>({...previous,videoInputIds:videoDraftIds(previous).filter((_,position)=>position!==index)}))}
     videoSources={videoSources} onVideoSource={(id,source)=>setDraft(previous=>({...previous,referenceVideoSources:{...previous.referenceVideoSources,[id]:source}}))}
     url={url} firstFrameFit={draft.firstFrameFit} ratio={(target?.width??9)/(target?.height??16)}
     onFit={fit=>change('firstFrameFit',fit)} onUpload={()=>referenceInput.current?.click()} onFiles={files=>void upload(files,true)}/>} prompt={<WorkspacePromptField label={`${kindName}提示词`} ariaLabel={tab==='image'?'图片提示词':'画面动作'} value={prompt} limit={promptLimit} disabled={disabled} onChange={value=>change(tab==='image'?'imagePrompt':'videoPrompt',value)} placeholder={tab==='video'?'例如：以首帧为起点，镜头缓慢向装饰画推进，保持画框、图案和文字稳定，单镜头，不切换场景。':draft.references.length?'例如：保留参考图中装饰画的图案、文字和边框，将背景改为明亮的现代客厅，产品居中完整展示，竖屏构图。':'例如：竖屏产品摄影，金色山水装饰画挂在现代客厅，清晨侧光，完整展示画框细节，写实质感，不添加额外文字。'}/>} model={<WorkspaceGenerationModel compact kind={kindName} services={tab==='image'?imageServices:videoServices} selection={tab==='image'?draft.imageSelection:draft.videoSelection} disabled={disabled} onChange={value=>{if(tab==='image'){change('imageSelection',productionModelSelection(imageServices,value,'image'));setComposerPanel(value?'dimensions':'');}else chooseVideoSource(value);}}/>}
     onMaterial={id=>{if(tab==='video')addVideoInput(id);else if(!draft.references.includes(id)){const max=imageService?.constraints.referenceImages?.max??16;if(draft.references.length>=max)setError(`当前模型最多使用 ${max} 张参考图，请先移除再添加。`);else change('references',[...draft.references,id]);}}} onFiles={files=>void upload(files,true)}
     settings={<><WorkspaceComposerSetting label={tab==='image'?'图片规格':'视频规格'} summary={tab==='image'?`${sizePreset.ratio} · ${draft.settings.size.replace('x','×')}`:videoProvider==='bailian'?draft.videoSettings.resolution:videoService?.constraints.resolutions?.join(' / ')??'规格'} open={composerPanel==='dimensions'} onOpenChange={open=>setComposerPanel(open?'dimensions':'')} disabled={disabled}>
      {tab==='image'?<WorkspaceImageSettings settings={draft.settings} service={imageService} disabled={disabled} onChange={value=>change('settings',value)}/>:<>{videoProvider==='bailian'?<label>分辨率<NativeSelect size="sm" aria-label="视频分辨率" disabled={disabled} value={draft.videoSettings.resolution} onChange={e=>change('videoSettings',{...draft.videoSettings,resolution:e.target.value as '720P'|'1080P'})}>{(wanProfile?.resolutions??['720P','1080P']).map(value=><option key={value} value={value}>{value}</option>)}</NativeSelect></label>:<p>{videoService?.constraints.resolutions?.join(' / ')??'规格由模型确定'}</p>}<p>比例随画面输入和所选模型确定。</p></>}
     </WorkspaceComposerSetting>
     {tab==='image'?<><WorkspaceComposerSetting label="生成数量" compact summary={`${draft.settings.count} 张`} open={composerPanel==='count'} onOpenChange={open=>setComposerPanel(open?'count':'')} disabled={disabled}><WorkspaceImageCount settings={draft.settings} service={imageService} disabled={disabled} onChange={value=>change('settings',value)}/></WorkspaceComposerSetting><WorkspaceComposerSetting label="构图与字幕留白" summary="构图" open={composerPanel==='composition'} onOpenChange={open=>setComposerPanel(open?'composition':'')} disabled={disabled}>{tab==='image'&&<>

     <div className="workspace-visual-fields workspace-image-composition">
      <label>主体构图
       <NativeSelect size="sm" aria-label="图片主体构图" disabled={disabled} value={framingOption} onChange={event=>{
        const value=event.target.value;
        change('imageBrief',{
         ...draft.imageBrief,
         framing:value==='full-with-margin'?'full':value==='close-with-margin'?'close':value as ImageBrief['framing'],
         crop:value.endsWith('-with-margin')?'protect':'allow',
        });
       }}>
        <option value="auto">{framingLabels.auto}</option>
        <option value="full">{framingLabels.full}</option>
        <option value="full-with-margin">完整展示，四周留余量</option>
        <option value="close">{framingLabels.close}</option>
        {hasSavedCloseUpWithMargin&&<option value="close-with-margin">主体特写，四周留余量</option>}
       </NativeSelect>
      </label>
      <label>字幕留白
       <NativeSelect size="sm" aria-label="图片字幕留白" disabled={disabled} value={draft.imageBrief.captionSpace}
        onChange={event=>change('imageBrief',{...draft.imageBrief,captionSpace:event.target.value as ImageBrief['captionSpace']})}>
        {Object.entries(captionSpaceLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}
       </NativeSelect>
      </label>
     </div>
    </>}</WorkspaceComposerSetting></>:<><WorkspaceComposerSetting label="画面输入模式" summary={videoMode.label} open={composerPanel==='mode'} onOpenChange={open=>setComposerPanel(open?'mode':'')} disabled={disabled}><label>生成模式<NativeSelect size="sm" aria-label="生成模式" value={videoMode.id} onChange={event=>change('videoModeId',event.target.value)}>{videoModes.map(mode=><option key={mode.id} value={mode.id}>{mode.label}</option>)}</NativeSelect></label>{videoMode.inputs.firstFrame&&<label>首帧构图<NativeSelect size="sm" aria-label="首帧构图" value={draft.firstFrameFit} disabled={disabled} onChange={event=>change('firstFrameFit',event.target.value as 'contain'|'cover')}><option value="contain">完整保留，必要时留边</option><option value="cover">居中裁切，填满画面</option></NativeSelect></label>}</WorkspaceComposerSetting><WorkspaceComposerSetting label="生成时长" hint={voiceDriven?`时长跟随已采用的${target?.voiceMode==='source'?'视频原声':'口播'}`:'设置本次视频时长'} summary={`${actualDuration==null?'—':Number(actualDuration.toFixed(2))} 秒`} open={composerPanel==='duration'} onOpenChange={open=>setComposerPanel(open?'duration':'')} disabled={disabled}>{<><label>画面时长（秒）{voiceDriven&&<span className="workspace-duration-follow">跟随{target?.voiceMode==='source'?'视频原声':'口播'}</span>}<input aria-label="生成时长（秒）" aria-describedby={voiceDriven?adoptionDescriptionId+'-duration':undefined} className={voiceDriven?'workspace-duration-locked':undefined} type="number" min={minimumSeconds} max={maximumSeconds} step="1" value={voiceDriven&&actualDuration!=null?Number(actualDuration.toFixed(2)):voiceDriven?'':draft.duration} readOnly={voiceDriven} disabled={disabled} onChange={e=>change('duration',e.target.value)}/></label>{voiceDriven&&<p>按当前{target?.voiceMode==='source'?'视频原声':'口播'}使用 {actualDuration==null?'—':Number(actualDuration.toFixed(2))} 秒，服务请求 {providerDuration??'—'} 秒。</p>}{voiceDriven&&<p id={adoptionDescriptionId+'-duration'}>{target?.voiceMode==='source'?'本镜使用视频原声，时长跟随原声窗口；请在剪辑台调整原声使用区间。':'本镜已采用口播，时长随该音频锁定；更换或撤回采用后会重新计算。'}</p>}{invalidDuration&&<p role="alert">该模型支持 {wanProfile&&wanProfile.durations.length<4?wanProfile.durations.join(' / '):`${minimumSeconds}～${maximumSeconds}`} 秒；请调整时长或拆分镜头。</p>}</>}</WorkspaceComposerSetting>{videoProvider==='bailian'&&<WorkspaceComposerSetting label="高级视频设置" summary="高级" open={composerPanel==='advanced'} onOpenChange={open=>setComposerPanel(open?'advanced':'')} disabled={disabled}>{tab==='video'&&videoProvider==='bailian'&&<div className="workspace-video-advanced"><div className="workspace-video-advanced-fields">

      <WorkspacePromptField label="负面提示词" ariaLabel="视频负面提示词" rows={2} limit={500} disabled={disabled} value={draft.videoSettings.negativePrompt} onChange={value=>change('videoSettings',{...draft.videoSettings,negativePrompt:value})} placeholder="例如：画框变形、文字变化、画面闪烁、突然切镜。"/>

      <label>随机种子（可选）<input type="number" aria-label="视频随机种子" min="0" max="2147483647" step="1" disabled={disabled} value={draft.videoSettings.seed??''} onChange={e=>change('videoSettings',{...draft.videoSettings,seed:e.target.value===''?undefined:Number(e.target.value)})}/></label>
      {!videoMode.characterOrder&&<label className="workspace-visual-checkbox"><input type="checkbox" checked={draft.videoSettings.promptExtend} disabled={disabled} onChange={e=>change('videoSettings',{...draft.videoSettings,promptExtend:e.target.checked,shotType:e.target.checked?draft.videoSettings.shotType:'single'})}/>智能扩写提示词</label>}
      {(videoMode.characterOrder||draft.videoSettings.promptExtend)&&(wanProfile?.multiShot??true)&&<label>镜头结构<NativeSelect size="sm" aria-label="视频镜头结构" disabled={disabled} value={draft.videoSettings.shotType} onChange={e=>change('videoSettings',{...draft.videoSettings,shotType:e.target.value as 'single'|'multi'})}><option value="single">单镜头</option><option value="multi">多镜头</option></NativeSelect></label>}
      <label className="workspace-visual-checkbox"><input type="checkbox" checked={videoSettings.audio} disabled={disabled||!!wanProfile&&wanProfile.audio!=='optional'} onChange={e=>change('videoSettings',{...draft.videoSettings,audio:e.target.checked})}/>生成视频声音{wanProfile?.audio==='always'?'（当前模型固定有声）':wanProfile?.audio==='silent'?'（当前模型不支持）':''}</label>
      <label className="workspace-visual-checkbox"><input type="checkbox" checked={draft.videoSettings.watermark} disabled={disabled} onChange={e=>change('videoSettings',{...draft.videoSettings,watermark:e.target.checked})}/>添加模型水印</label>
      <small>分辨率、时长和声音会影响费用；种子相同也不保证结果完全一致。</small>
    </div></div>}</WorkspaceComposerSetting>}</>}
</>} submit={<Button size="sm" color="primary" isDisabled={disabled||!canGenerate} onPress={()=>void generate(unknownImageTask?.taskId)}>{pending.some(t=>(t.kind??'video')===tab)?'正在生成…':(retryImage||unknownImageTask)?'重新生成图片':`生成${kindName}`}</Button>}>
     {generationBlocker&&generationBlocker!=='请填写提示词。'&&<p className="workspace-visual-generation-note" role="status">{generationBlocker}</p>}
    </WorkspaceGenerationComposer>
   </div>}
  </div>

  {clearVisual&&<ConfirmationModal title={clearVisual.sourcePath?`取消采用${kindName}`:'取消备用图片'} confirmLabel="确认取消采用" isPending={busy} confirmDisabled={!!disabled}
   onCancel={()=>setClearVisual(null)} onConfirm={()=>run(async()=>{
    setClearError('');
    try{
     const {revision,candidateId,sourcePath,sourceSha256}=clearVisual;
     const next=await command('clearWorkspaceVisualCandidate',{...base(workspace),expectedRevision:revision,targetItemId,candidateId,sourcePath,sourceSha256}) as ProductionWorkspace;
     onChange(next);
     if(sourcePath)select(next.visualCandidates?.find(c=>c.targetItemId===targetItemId&&c.relativePath===sourcePath&&c.status!=='rejected')?.id??'');
     setClearVisual(null);
    }catch(cause){setClearError(cause instanceof Error?cause.message:'取消采用未完成，请重试。');}
   })}>
   <p>{clearVisual.sourcePath?'当前片段将恢复为待匹配，时长保持原样。素材留在候选区，可重新采用。':'图片将取消备用，仍留在候选区。'}</p>
   {clearError&&<p role="alert">{clearError}</p>}
  </ConfirmationModal>}
  {notice&&<p role="status">{notice}</p>}{error&&<p role="alert">{error}</p>}
  {!shelf&&<input ref={fileInput} hidden aria-label={`上传${kindName}素材`} type="file" multiple={tab==='image'} accept={tab==='image'?'image/png,image/jpeg,image/webp,image/bmp':'video/mp4'} disabled={disabled} onChange={e=>{const files=[...e.target.files??[]];e.target.value='';if(files.length)void upload(files);}}/>}
  {tab==='video'&&<input ref={referenceInput} hidden aria-label="上传画面素材文件" type="file" multiple accept="image/png,image/jpeg,image/webp,image/bmp,video/mp4,video/quicktime,video/webm" disabled={disabled} onChange={e=>{const files=[...e.target.files??[]];e.target.value='';if(files.length)void upload(files,true);}}/>}
  {zoom&&candidate&&<ImageFocusDialog src={url(candidate.relativePath,candidate.sha256)} title="图片大图预览" imageAlt="图片候选大图" closeLabel="关闭大图预览" onClose={()=>setZoom(false)}/>}
 </section>;
}
