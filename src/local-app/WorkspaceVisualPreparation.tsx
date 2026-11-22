import {restoreVisualDraft,recordVisualDefaultEdits,updatedVisualDefaults,type VisualDefaultOverrides} from './workspaceVisualDefaults';
import {FeedbackNotice} from '../ui/FeedbackNotice';
import {MediaRangeEditor} from '../ui/media/MediaRangeEditor';
import {uiText} from '../i18n/ui';
import {templateReferenceProblem} from '../workspaceTemplateInputs';
import {WorkspaceResolutionChoices,WorkspaceVideoModeChoices,WorkspaceDurationControl,WorkspaceFrameFitChoices} from './WorkspaceGenerationChoices';
import {promptReferenceOptions,type PromptReferenceBinding} from '../promptReferences';
import {minimaxVideoModels} from '../worker/videoProviderCatalog';
import {WorkspaceUploadFeedback} from './WorkspaceUploadFeedback';
import {imageQualityLabels} from '../imageGeneration';
import {shotCompositionSlotLabels} from '../shotComposition';
import {hasSeparatedVideoSound} from '../workspaceVideoSound';
import type {OpenChatCutProject} from '../worker/openchatcutProject';
import {readWorkspaceShotWindow} from '../workspaceShots';
import {videoVisualInputProblem,type VideoVisualInputSelection} from '../videoVisualInputs';
import {useWorkspaceMaterialSelection,WorkspaceMaterialDrop} from './WorkspaceMaterialDrop';
import {ImageFocusDialog} from '../ui/media/ImagePreview';
import {VideoPreview} from '../ui/media/VideoPreview';
import {WorkspaceVisualRecord} from './WorkspaceVisualRecord';
import {workspaceTaskPresentation} from '../workspaceTaskPresentation';
import {needsCandidateImpactDialog,WorkspaceCandidateImpactDetails} from './WorkspaceCandidateImpact';
import {ConfirmationModal,ConfirmationModalPresence} from '../ui/ConfirmationModal';
import {createPortal} from 'react-dom';
import type {WorkspaceCandidatePreparation} from '../workspaceCandidates';
import {WorkspaceImageSettings,WorkspaceImageCount} from './WorkspaceImageSettings';
import {WorkspaceGenerationModel} from './WorkspaceGenerationModel';
import {WorkspaceGenerationActivity} from './WorkspaceGenerationActivity';
import type {WorkspaceVisualTask} from '../workspaceVisualCandidates';
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
import {useEffect,useId,useRef,useState,useSyncExternalStore,type ReactNode,type SetStateAction} from 'react';
import {Check,Upload,Image as ImageIcon,Video,Maximize2,Download,Scissors,AudioLines,Trash2} from 'lucide-react';
import {Tooltip} from '../ui/dan-ui/components/base/tooltip/tooltip';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import {NativeSelect} from '../ui/dan-ui/components/base/select/select-native';
import type {ProductionWorkspace} from '../productionWorkspace';
import type {WorkspaceVisualCandidate} from '../workspaceVisualCandidates';
import {useProductionServiceCatalog} from './useProductionServiceCatalog';
import type {ProductionSelection} from '../productionSelection';
import {imageSizePresets,emptyImageBrief,referencePurposeLabels,framingLabels,captionSpaceLabels,type ImageBrief,type ImageGenerationSettings} from '../imageGeneration';
import {defaultWanSettings,wanSettingLabels,type WanGenerationSettings} from '../videoGenerationSettings';
import {useWorkspaceOwnerId} from './WorkspaceDraft';
import {workspaceUploadSessions,readWorkspaceUploadFile,type WorkspaceUploadEntry} from './workspaceUploads';
import './workspace-visual-preparation.css';
import './workspace-visual-candidates.css';

type Kind='image'|'video';
type VisualReviewPlan=WorkspaceCandidatePreparation&{kind:'adoption';candidate:WorkspaceVisualCandidate};
type Material=VideoInputMaterial;
interface UploadEntry extends WorkspaceUploadEntry {kind:Kind;asReference:boolean;tab:Kind;usage:Draft['usage']}
const uploadSession=workspaceUploadSessions<UploadEntry>();
export interface VisualPreparationProps {
 onBusyChange?:(busy:boolean)=>void;
 workspace:ProductionWorkspace;command:(name:string,data:unknown)=>Promise<unknown>;onChange:(w:ProductionWorkspace)=>void;
 materials:Material[];selectedShotId?:string;selectedTargetItemId?:string;onTargetChange?:(id:string)=>void;
 project?:OpenChatCutProject|null;currentVisualKind?:string;currentVisualPath?:string;currentVisualSha256?:string;currentMaterialRevisionId?:string;preview?:ReactNode;readOnly?:boolean;
 onImported?:(material:Material&{storage_path:string})=>void;
}
interface Draft {defaultOverrides?:VisualDefaultOverrides;promptReferences?:PromptReferenceBinding[];pexelsSelection?:ProductionSelection|null;imageBrief:ImageBrief;imageSelection?:ProductionSelection|null;videoSelection?:ProductionSelection|null;videoSettings:WanGenerationSettings;videoResolution?:string;firstFrameFit:'contain'|'cover';tab:Kind;origin:Record<Kind,'material'|'generate'|'search'>;imagePrompt:string;videoPrompt:string;references:string[];firstFrame:string;videoModeId?:string;videoInputs?:VideoInputDraft;videoInputIds?:string[];referenceVideoSources?:Record<string,string>;settings:ImageGenerationSettings;duration:string;usage:'still'|'pan-zoom';selected:Record<Kind,string>}
function videoDraftIds(draft:Draft){
 return draft.videoInputIds??[draft.firstFrame,...draft.videoInputs?.lastFrame??[],...draft.videoInputs?.referenceImages??[],...draft.videoInputs?.referenceVideos??[]].filter(Boolean);
}
function prioritizeVideoInput(draft:Draft,id:string){
 return [id,...videoDraftIds(draft).filter(value=>value!==id)];
}
function initialDraft(props:VisualPreparationProps,targetItemId:string):Draft {
 const shotId=props.workspace.clips.find(clip=>clip.itemId===targetItemId)?.shotId,template=props.workspace.templateInputs?.shots.find(shot=>shot.shotId===shotId);
 const sizeTarget=props.workspace.visualTargets?.find(t=>t.targetItemId===targetItemId),ratio=(sizeTarget?.width??9)/(sizeTarget?.height??16),size:ImageGenerationSettings['size']=[...imageSizePresets].sort((a,b)=>Math.abs(Number(a.ratio.split(':')[0])/Number(a.ratio.split(':')[1])-ratio)-Math.abs(Number(b.ratio.split(':')[0])/Number(b.ratio.split(':')[1])-ratio))[0].standard;
 const selected=props.workspace.selectedImages?.find(s=>s.targetItemId===targetItemId)?.materialRevisionId;
 let pexelsSelection:ProductionSelection|null|undefined;try{pexelsSelection=JSON.parse(sessionStorage.getItem(`loop-pexels-draft:${props.workspace.id}:${targetItemId}`)??'null')?.selection;}catch{/* Keep an empty search selection. */}
 const window=props.project?readWorkspaceShotWindow(props.project,targetItemId):undefined;
 const seconds=sizeTarget?.durationSeconds??(window?window.durationInFrames/window.timeline.fps:Math.max(3,sizeTarget?.minimumSeconds??2));
 return {pexelsSelection,imageBrief:{...emptyImageBrief,references:[]},videoSelection:sizeTarget?.defaultSelection,imageSelection:props.workspace.visualConfiguration?.imageSelection,videoSettings:sizeTarget?.defaultSelection?.provider==='bailian'?defaultWanModelSettings(sizeTarget.defaultSelection.model??''):{...defaultWanSettings},firstFrameFit:'contain',tab:props.currentVisualKind==='video'?'video':'image',origin:{image:'material',video:'material'},imagePrompt:template?.imagePrompt??'',videoPrompt:template?.videoPrompt??'',references:[],firstFrame:selected??(props.currentVisualKind==='image'?props.currentMaterialRevisionId??'':''),settings:{size,quality:'auto',count:1},duration:String(seconds),usage:'still',selected:{image:'',video:''}};
}
function episodeVisualDefaults(workspaceId:string,kind:Kind):unknown{
 try{const value=JSON.parse(localStorage.getItem(`loop-${kind}-default:${workspaceId}`)??sessionStorage.getItem(`loop-${kind}-default:${workspaceId}`)??'{}');return value&&typeof value==='object'&&!Array.isArray(value)?value:{};}catch{return {};}
}
function restoreDraft(props:VisualPreparationProps,targetItemId:string,saved:unknown):Draft{
 const base=initialDraft(props,targetItemId),videoDefaults=episodeVisualDefaults(props.workspace.id,'video') as Partial<Draft>;
 const selected=Object.hasOwn(videoDefaults,'videoSelection')?videoDefaults.videoSelection:base.videoSelection;
 if(selected?.provider==='bailian')base.videoSettings=defaultWanModelSettings(selected.model??'');
 return restoreVisualDraft(base,saved,episodeVisualDefaults(props.workspace.id,'image'),videoDefaults);
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
 const targetShotId=options.find(clip=>clip.itemId===targetItemId)?.shotId;
 const hasMultipleFragments=workspace.clips.filter(clip=>clip.shotId===targetShotId).length>1;
 const template=workspace.templateInputs?.shots.find(shot=>shot.shotId===targetShotId),templateMaterial=template?.visual?.material;
 const canSplitVideo=timeline&&visual?.kind==='video'&&!hasSeparatedVideoSound(timeline,visual);
 const shelf=useWorkspaceMaterialSelection();
 const adoptionDescriptionId=useId();
 const [draft,setDraftState]=useState<Draft>(()=>{let saved:unknown=null;try{const value=JSON.parse(sessionStorage.getItem(storageKey)??'null');if(value?.settings&&['image','video'].includes(value.tab))saved=value;}catch{/* A missing browser draft is an empty form. */}return restoreDraft(props,targetItemId,saved);});
 const draftRef=useRef(draft);draftRef.current=draft;
 function setDraft(action:SetStateAction<Draft>){
  const previous=draftRef.current,next=recordVisualDefaultEdits(previous,typeof action==='function'?action(previous):action);
  draftRef.current=next;setDraftState(next);
  let changed=false;
  try{
   for(const kind of ['image','video'] as const){
    const defaults=updatedVisualDefaults(previous,next,episodeVisualDefaults(workspace.id,kind),kind);
    if(defaults){
     localStorage.setItem(`loop-${kind}-default:${workspace.id}`,JSON.stringify(defaults));
     changed=true;
    }
   }
  }catch{setError('默认设置未能保存，请检查浏览器存储空间。');}
  if(changed)window.dispatchEvent(new CustomEvent('loop-visual-defaults',{detail:workspace.id}));
 }
 useEffect(()=>{
  const refresh=()=>{
   const previous=draftRef.current,next=restoreDraft(props,targetItemId,previous);
   if(JSON.stringify(previous)!==JSON.stringify(next)){draftRef.current=next;setDraftState(next);}
  };
  const local=(event:Event)=>{if((event as CustomEvent<string>).detail===workspace.id)refresh();};
  const stored=(event:StorageEvent)=>{if(event.key===`loop-image-default:${workspace.id}`||event.key===`loop-video-default:${workspace.id}`)refresh();};
  window.addEventListener('loop-visual-defaults',local);window.addEventListener('storage',stored);
  return()=>{window.removeEventListener('loop-visual-defaults',local);window.removeEventListener('storage',stored);};
 },[workspace.id,targetItemId]);
 const [requestedReplacementScope,setReplacementScope]=useState<'fragment'|'shot'>('fragment');
 const replacementScope=hasMultipleFragments?requestedReplacementScope:'fragment';
 const [catalogReload,setCatalogReload]=useState(0);
 const tab=draft.tab,kindName=tab==='image'?'图片':'视频',origin=shelf&&(tab==='image'||draft.origin[tab]==='material')?'generate':draft.origin[tab];
 const tasks=(workspace.visualTasks??[]).filter(t=>!t.shotId||options.some(c=>c.shotId===t.shotId)),pending=tasks.filter(t=>{const p=workspaceTaskPresentation(t);return(p.active||p.held)&&!p.hidden;}),taskKey=pending.map(t=>t.taskId).join(':');
 const catalogReading=useProductionServiceCatalog({scope:JSON.stringify([workspace.episodeId,workspace.id]),active:origin!=='material',refreshKey:JSON.stringify([tab,origin,catalogReload,taskKey])});
 const imageServices=catalogReading.catalog?.groups.find(g=>g.capability==='image')?.services??[];
 const videoServices=catalogReading.catalog?.groups.find(g=>g.capability==='video')?.services.filter(s=>s.mode==='generation'||s.mode==='search'&&s.provider==='pexels'&&s.adapter==='pexels_video')??[];
 const catalogError=catalogReading.error?'无法读取制作连接，请刷新后重试。':'';
 const [composerPanel,setComposerPanel]=useState('');
 const [generationSubmitting,setGenerationSubmitting]=useState<{kind:Kind;targetItemId:string;model?:string;provider?:string}|null>(null);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[rangeStart,setRangeStart]=useState(''),[rangeEnd,setRangeEnd]=useState(''),[policy,setPolicy]=useState('keep-target'),[acceptImpact,setAcceptImpact]=useState(false),[zoom,setZoom]=useState(false);
 const [clearVisual,setClearVisual]=useState<{revision:number;candidateId?:string;sourcePath?:string;sourceSha256?:string}|null>(null);
 const [clearError,setClearError]=useState('');
 const [trimOpen,setTrimOpen]=useState(false),[cropOpen,setCropOpen]=useState(false);
 const cropId=useId();

 const [imagePreviewError,setImagePreviewError]=useState(''),[imagePreviewAttempt,retryImagePreview]=useState(0);
 const [arrivingCandidates,setArrivingCandidates]=useState<string[]>([]),[adoptionFeedback,setAdoptionFeedback]=useState('');
 const observedVisuals=useRef({candidates:new Set((workspace.visualCandidates??[]).map(c=>c.id)),tasks:new Set<string>()});
 useEffect(()=>{
  const observed=observedVisuals.current;
  for(const task of workspace.visualTasks??[])if(task.status==='ready'||task.status==='running')observed.tasks.add(task.taskId);
  const arrivals=(workspace.visualCandidates??[]).filter(c=>!observed.candidates.has(c.id)&&c.targetItemId===targetItemId&&c.kind===draft.tab&&c.status==='available'&&!!c.taskId&&observed.tasks.has(c.taskId));
  for(const candidate of workspace.visualCandidates??[])observed.candidates.add(candidate.id);
  if(arrivals.length)setArrivingCandidates(current=>[...current,...arrivals.map(c=>c.id)]);
 },[workspace.visualCandidates,workspace.visualTasks,targetItemId,draft.tab]);
 useEffect(()=>{if(!arrivingCandidates.length)return;const timer=setTimeout(()=>setArrivingCandidates([]),200);return()=>clearTimeout(timer);},[arrivingCandidates]);
 useEffect(()=>{if(!adoptionFeedback)return;const timer=setTimeout(()=>setAdoptionFeedback(''),300);return()=>clearTimeout(timer);},[adoptionFeedback]);
 const uploadOwnerId=useWorkspaceOwnerId();
 const [uploadState]=useState(()=>uploadSession(`visual:${uploadOwnerId}:${workspace.episodeId}:${workspace.id}:${targetItemId}`));
 const {rows:uploadRows,running:uploading,notice:uploadNotice,retainedMaterials}=useSyncExternalStore(uploadState.subscribe,uploadState.read);
 const formRef=useRef<HTMLDivElement>(null);
 const working=useRef(false),fileInput=useRef<HTMLInputElement>(null),referenceInput=useRef<HTMLInputElement>(null),mounted=useRef(true),zoomTrigger=useRef<HTMLButtonElement>(null),videoPreviewRef=useRef<HTMLVideoElement>(null),adoptTrigger=useRef<HTMLButtonElement>(null),thumbnailRail=useRef<HTMLDivElement>(null);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 useEffect(()=>{try{sessionStorage.setItem(storageKey,JSON.stringify(draft));}catch{/* Storage is optional. */}},[storageKey,draft]);
 useEffect(()=>{if(!zoom)return;return()=>zoomTrigger.current?.focus();},[zoom]);
 const candidates=(workspace.visualCandidates??[]).filter(c=>c.targetItemId===targetItemId&&c.status!=='rejected');
 const allMaterials=[...props.materials,...retainedMaterials,...uploadRows.flatMap(row=>row.material?[row.material]:[]),...(workspace.visualCandidates??[]).filter(c=>c.kind==='image'&&c.materialRevisionId).map(c=>({id:c.materialRevisionId!,material_type:'image',source_path:c.relativePath.split('/').pop()??'生成图片',storage_path:c.relativePath}))].filter((m,i,a)=>a.findIndex(x=>x.id===m.id)===i);
 useEffect(()=>{
  if(uploading)return;
  const known=new Set([...props.materials.map(material=>material.id),...(workspace.visualCandidates??[]).filter(candidate=>candidate.targetItemId===targetItemId).map(candidate=>candidate.materialRevisionId)]);
  if(retainedMaterials.some(material=>known.has(material.id))||uploadRows.some(row=>row.status==='succeeded'&&known.has(row.material?.id)))uploadState.update(value=>({...value,rows:value.rows.filter(row=>row.status!=='succeeded'||!known.has(row.material?.id)),retainedMaterials:value.retainedMaterials.filter(material=>!known.has(material.id))}));
 },[uploading,uploadRows,retainedMaterials,props.materials,workspace.visualCandidates,targetItemId]);
 const chosenVideoService=videoServices.find(s=>s.mode==='generation'&&s.connectionVersionId===draft.videoSelection?.connectionVersionId&&s.provider===draft.videoSelection.provider&&s.adapter===draft.videoSelection.adapter),videoProvider=draft.videoSelection?.provider,videoModel=draft.videoSelection?.model;
 const videoService=chosenVideoService?{...chosenVideoService,constraints:{...chosenVideoService.constraints,...chosenVideoService.modelConstraints?.[videoModel??'']}}:undefined;
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
 useEffect(()=>{setTrimOpen(false);setCropOpen(false);},[targetItemId,tab,candidate?.id]);
 const candidateReview=useCandidateReviewLifecycle({workspace,scope:JSON.stringify([targetItemId,candidate?.id,replacementScope,policy,acceptImpact,draft.usage,rangeStart,rangeEnd,props.currentVisualKind]),reader,
  prepare:async(w,choice:{candidate:WorkspaceVisualCandidate;replaceCurrentVisual:boolean}):Promise<VisualReviewPlan>=>{
   const c=choice.candidate;
   const prepared=await command('prepareWorkspaceVisualCandidate',{
    ...base(w),candidateId:c.id,replacementScope,
    ...(c.kind==='image'
     ?{durationPolicy:'keep-target',acceptTimelineImpact:false,motionPolicy:'preserve-target',...(props.currentVisualKind==='video'?{replaceCurrentVisual:true}:{})}
     :{durationPolicy:policy,acceptTimelineImpact:acceptImpact,motionPolicy:draft.usage==='pan-zoom'?'replace-motion':'preserve-target',
       sourceInSeconds:rangeStartSeconds,sourceOutSeconds:rangeEndSeconds})
   }) as WorkspaceCandidatePreparation;
   if(!prepared.impact)throw Error('无法读取采用影响，请刷新后重新核对。');
   return {...prepared,kind:'adoption',candidate:c};
  },
  autoAdopt:plan=>plan.impact.replacementScope!=='shot'&&plan.impact.videoSound!=='silent'&&!needsCandidateImpactDialog(plan.impact),
  onAdopted:(_changed,plan)=>adoptionFeedbackFor(plan),
  adopt:async(w,plan)=>{
   const latest=w;
   return command('adoptWorkspaceVisualCandidate',{
    ...base(latest),candidateId:plan.candidateId,adoptionId:plan.adoptionId
   }) as Promise<ProductionWorkspace>;
  },
 });
 const busyListener=useRef(props.onBusyChange);busyListener.current=props.onBusyChange;
 useEffect(()=>{busyListener.current?.(busy||candidateReview.pending||uploading);},[busy,candidateReview.pending,uploading]);
 useEffect(()=>()=>{busyListener.current?.(false);},[]);
 const disabled=busy||candidateReview.pending||uploading||props.readOnly||workspace.stale;
 const review=candidateReview.plan;
 const impact=review?.impact;
 const needsImpactDialog=needsCandidateImpactDialog(impact);
 const inlineReview=review&&!needsImpactDialog;
 const reviewSummary=impact?(impact.deltaSeconds===0?`镜头时长保持 ${impact.appliedSeconds.toFixed(2)} 秒`:`${impact.currentSeconds.toFixed(2)} → ${impact.appliedSeconds.toFixed(2)} 秒`):'保留为备用图片';
 useEffect(()=>{const rail=thumbnailRail.current,selected=rail?.querySelector<HTMLElement>('[aria-pressed=true]');if(!rail||!selected)return;const r=rail.getBoundingClientRect(),s=selected.getBoundingClientRect();if(s.top<r.top)rail.scrollTop-=r.top-s.top;else if(s.bottom>r.bottom)rail.scrollTop+=s.bottom-r.bottom;},[tab,active?.id]);
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
 const mentionOptions=promptReferenceOptions(tab==='image'?draft.references.flatMap(id=>{const m=allMaterials.find(m=>m.id===id);return m?[{materialRevisionId:id,kind:'image' as const,name:m.source_path.split('/').pop()??m.source_path}]:[];}):videoInputs.flatMap(entry=>entry.reason||!entry.material||!entry.role?[]:[{materialRevisionId:entry.id,kind:entry.role==='referenceVideos'?'video' as const:'image' as const,name:entry.material.source_path.split('/').pop()??entry.material.source_path,role:entry.role}]),draft.promptReferences);
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
 const current=!!candidate&&candidate===currentCandidate||active?.id==='current';
 const candidateMeta=[current?'当前镜头画面':candidate?.materialRevisionId&&videoDraftIds(draft).includes(candidate.materialRevisionId)?'已选视频参考图':candidate?.generation?.selection?.model,candidate?.status==='stale'?'输入已变化':null].filter(Boolean).join(' · ');
 const target=workspace.visualTargets?.find(t=>t.targetItemId===targetItemId),voiceDriven=!!target&&target.voiceMode!=='none';
 const minimumSeconds=wanProfile?.durations[0]??videoService?.constraints.durationSeconds?.min??2,maximumSeconds=wanProfile?.durations.at(-1)??videoService?.constraints.durationSeconds?.max??15,actualDuration=voiceDriven?target.durationSeconds:Number(draft.duration),providerDuration=actualDuration===null?null:wanProfile?wanProviderDuration(videoModel!,actualDuration,voiceDriven):voiceDriven?Math.max(minimumSeconds,Math.ceil(actualDuration)):actualDuration,invalidDuration=!actualDuration||actualDuration<(voiceDriven?0.1:minimumSeconds)||actualDuration>maximumSeconds||!voiceDriven&&!Number.isInteger(actualDuration)||!!wanProfile&&providerDuration===undefined;
 function change<K extends keyof Draft>(key:K,value:Draft[K]){setDraft(d=>({...d,[key]:value}));}
 function useConfiguredVideo(selection:ProductionSelection){
  if(selection.adapter==='pexels_video')setDraft(d=>({...d,pexelsSelection:selection,origin:{...d.origin,video:'search'}}));
  else setDraft(d=>({...d,videoSelection:selection,...(!d.videoSelection&&selection.provider==='bailian'&&JSON.stringify(d.videoSettings)===JSON.stringify(defaultWanSettings)?{videoSettings:defaultWanModelSettings(selection.model!)}:{}),...(selection.provider==='minimax'&&!minimaxVideoModels[selection.model??'']?.resolutions.includes(d.videoResolution??'768P')?{videoResolution:'768P'}:{}),origin:{...d.origin,video:'generate'}}));
 }
 function chooseVideoSource(value:string){
  const search=videoServices.find(service=>service.mode==='search'&&value===`${service.id}:search`);
  if(search)setDraft(d=>({...d,pexelsSelection:{capability:'video',provider:search.provider,adapter:search.adapter,connectionVersionId:search.connectionVersionId??undefined},origin:{...d.origin,video:'search'}}));
  else if(!value&&origin==='search')change('pexelsSelection',null);
  else setDraft(d=>{const selection=productionModelSelection(videoServices,value,'video');return {...d,videoSelection:selection,...(!d.videoSelection&&selection?.provider==='bailian'&&JSON.stringify(d.videoSettings)===JSON.stringify(defaultWanSettings)?{videoSettings:defaultWanModelSettings(selection.model!)}:{}),...(selection?.provider==='minimax'&&!minimaxVideoModels[selection.model??'']?.resolutions.includes(d.videoResolution??'768P')?{videoResolution:'768P'}:{}),origin:{...d.origin,video:'generate'}};});
  setComposerPanel(value&&!search?'dimensions':'');
 }

 function select(id:string){setDraft(d=>({...d,selected:{...d.selected,[d.tab]:id}}));setRangeStart('');setRangeEnd('');setPolicy('keep-target');setAcceptImpact(false);setError('');}
 function url(path:string,sha256=''){return '/_local-artifact?'+new URLSearchParams({episode:workspace.episodeId,path,...(sha256?{sha256}:{})});}
 useEffect(()=>{
  if(uploading||!uploadRows.some(row=>row.status==='succeeded'&&!row.asReference&&!workspace.visualCandidates?.some(candidate=>candidate.targetItemId===targetItemId&&candidate.materialRevisionId===row.material?.id&&candidate.status!=='rejected')))return;
  void fresh().catch(cause=>{if(mounted.current&&!(cause instanceof Error&&cause.name==='AbortError'))setError('素材已导入，候选列表暂未更新，请刷新重试。');});
 },[uploading,uploadRows,fresh]);
 const pollingError=useWorkspacePolling(reader,{enabled:!!taskKey&&!busy&&!candidateReview.pending&&!uploading,interval:2000});
 function base(w:ProductionWorkspace){return {episodeId:w.episodeId,workspaceId:w.id,expectedRevision:w.revision};}
 async function run(action:()=>Promise<void>){if(working.current)return;working.current=true;setBusy(true);busyListener.current?.(true);setError('');setNotice('');try{await action();}catch(cause){if(mounted.current&&!(cause instanceof Error&&cause.name==='AbortError'))setError(cause instanceof Error?cause.message:'操作未完成，请重试。');}finally{working.current=false;if(mounted.current){setBusy(false);busyListener.current?.(false);}}}

 async function register(materialId:string,kind:Kind,usage=draft.usage){const w=await fresh(),existing=w.visualCandidates?.find(c=>c.targetItemId===targetItemId&&c.materialRevisionId===materialId&&c.status!=='rejected');const next=existing?w:await command('registerWorkspaceVisualCandidate',{...base(w),targetItemId,materialRevisionId:materialId,usage:kind==='video'?'video':usage,durationSeconds:3}) as ProductionWorkspace;if(mounted.current)reader.publish(next);const added=next.visualCandidates?.find(c=>c.targetItemId===targetItemId&&c.materialRevisionId===materialId&&c.status!=='rejected');if(mounted.current&&added)setDraft(d=>({...d,tab:kind,selected:{...d.selected,[kind]:added.id}}));}
 function reportUpload(message:string,failed=true){uploadState.report(message,failed);}
 async function processUploads(rows:UploadEntry[]){
  if(working.current||uploadState.read().running)return;
  await run(async()=>{
   const referenceIds=new Set(draft.references);
   await uploadState.run(rows,{
    active:()=>mounted.current,
    async importFile(row){
     const file=row.file!;
     if(!file.size||file.size>100*1024*1024)throw Error('素材不能为空或超过 100 MB。');
     if(row.asReference&&!(row.tab==='video'?['image/png','image/jpeg','image/webp','image/bmp','video/mp4','video/quicktime','video/webm']:['image/png','image/jpeg','image/webp']).includes(file.type)||!row.asReference&&(row.kind!==row.tab||!['image/png','image/jpeg','image/webp','image/bmp','video/mp4'].includes(file.type)))throw Error(row.asReference?(row.tab==='video'?'请选择有效的图片或视频文件。':'请选择 PNG、JPEG 或 WebP 参考图。'):`请选择有效的${row.tab==='image'?'图片':'视频'}文件。`);
     if(row.asReference&&row.tab==='image'&&file.size>20*1024*1024)throw Error('每张参考图不能超过 20 MB。');
     if(row.asReference&&row.tab==='image'&&referenceIds.size>=16)throw Error('最多可添加 16 张参考图。');
     const contentBase64=await readWorkspaceUploadFile(file);
     if(!mounted.current)throw Object.assign(Error('上传已暂停。'),{name:'AbortError'});
     const material=await command('importMaterial',{episodeId:workspace.episodeId,sourceKind:'file',sourcePath:file.name,materialType:row.kind,mimeType:file.type,contentBase64,isMainScript:false,materialPurpose:'visual_reference'}) as Material&{storage_path:string};
     return {...material,source_path:file.name,material_type:row.kind};
    },
    onImported:props.onImported,
    async complete(row,material){
     if(row.asReference){
      if(row.tab==='image'&&!referenceIds.has(material.id)&&referenceIds.size>=16)throw Error('最多可添加 16 张参考图。');
      referenceIds.add(material.id);
      setDraft(d=>row.tab==='image'?{...d,references:[...new Set([...d.references,material.id])].slice(0,16)}:{...d,videoInputIds:[...new Set([...videoDraftIds(d),material.id])]});
     }else await register(material.id,row.kind,row.usage);
    },
    paused:(row,imported)=>imported?(row.asReference?'素材已导入，尚未选为参考图。':'素材已导入，尚未加入候选。'):'已暂停，重试可继续。',
    failed:(row,imported,message)=>(imported?(row.asReference?'素材已导入，参考图未选入：':'素材已导入，候选未完成：'):'')+message,
   });
  });
 }
 async function upload(files:File[],asReference=false){
  if(working.current||uploadState.read().running)return;
  if(asReference&&tab==='image'&&files.length+draft.references.length>16){reportUpload('最多可添加 16 张参考图。');return;}
  const rows=uploadState.enqueue(files.map(file=>({name:file.name,file,kind:file.type.startsWith('image/')?'image' as const:'video' as const,asReference,tab,usage:draft.usage})));
  await processUploads(rows);
 }
 async function adopt(c:WorkspaceVisualCandidate,replaceCurrentVisual=false){
  if(working.current)return;setError('');setNotice('');busyListener.current?.(true);
  try{await candidateReview.prepare({candidate:c,replaceCurrentVisual});}
  catch(cause){if(mounted.current&&!(cause instanceof Error&&cause.name==='AbortError'))setError(cause instanceof Error?cause.message:'操作未完成，请重试。');}
  finally{if(mounted.current)busyListener.current?.(false);}
 }
 function returnAdoptionFocus(){
  requestAnimationFrame(()=>adoptTrigger.current?.focus());
 }
 function closeAdoption(){candidateReview.cancel();returnAdoptionFocus();}
 function adoptionFeedbackFor(plan:VisualReviewPlan){
  const c=plan.candidate;setAdoptionFeedback(c.id);
  if(c.kind==='image'&&c.materialRevisionId)setDraft(d=>(videoDraftIds(d).some(id=>allMaterials.some(material=>material.id===id&&material.material_type==='image'))?d:{...d,videoInputIds:prioritizeVideoInput(d,c.materialRevisionId!)}));
  setNotice(`已采用${c.kind==='image'?'图片':'视频'}。${plan.impact.videoSound==='silent'?'新视频没有原声，未播放旧视频声音。':''}`);
 }
 async function confirmAdoption(){
  setError('');returnAdoptionFocus();busyListener.current?.(true);
  try{await candidateReview.confirm();}catch(cause){if(mounted.current&&!(cause instanceof Error&&cause.name==='AbortError'))setError(cause instanceof Error?cause.message:'操作未完成，请重试。');}
  finally{if(mounted.current)busyListener.current?.(false);}
 }
 function removeSelected(){
  if(current){
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
   const selection=tab==='image'?draft.imageSelection:draft.videoSelection;
   setGenerationSubmitting({kind:tab,targetItemId,model:selection?.model,provider:selection?.provider});
   try{
   const w=await fresh();
   if(tab==='video'){
    if(!canSubmitVideoMode||videoInputProblem||!advancedVideo&&!submitFirstFrame)throw Error(videoInputProblem||'请先选择当前模式可用的画面。');
    const after=w.visualTargets?.find(t=>t.targetItemId===targetItemId);
    if(JSON.stringify(after)!==JSON.stringify(target))throw Error('当前口播窗口已变化，请重新确认时长后生成。');
   }
   const next=await command(tab==='image'?'requestWorkspaceImageCandidates':'requestWorkspaceVisualCandidate',{
    ...base(w),targetItemId,prompt:tab==='image'?draft.imagePrompt:draft.videoPrompt,...(usedPromptReferences.length?{promptReferences:usedPromptReferences}:{}),
    ...(tab==='image'?{selection:draft.imageSelection,settings:draft.settings,imageBrief:{...draft.imageBrief,references:draft.references.map(id=>draft.imageBrief.references.find(r=>r.materialRevisionId===id)??{materialRevisionId:id,purpose:'subject',preserve:'',change:''})},referenceMaterialRevisionIds:draft.references,...(retryOfTaskId?{retryOfTaskId}:{})}:{selection:draft.videoSelection,...(advancedVideo?{videoMode:videoMode!.id,visualInputs:submittedVideoInputs}:{firstFrameMaterialRevisionId:submitFirstFrame?.id}),durationSeconds:actualDuration,...(submitFirstFrame?{firstFrameFit:draft.firstFrameFit}:{}),...(videoProvider==='bailian'?{videoSettings}:videoProvider==='minimax'?{videoResolution:draft.videoResolution??'768P'}:{})})
   }) as ProductionWorkspace;
   onChange(next);
   }finally{if(mounted.current)setGenerationSubmitting(null);}
  });}
 function referenceBrief(id:string,patch:Partial<ImageBrief['references'][number]>) {setDraft(d=>({...d,imageBrief:{...d.imageBrief,references:[...d.imageBrief.references.filter(r=>r.materialRevisionId!==id),{materialRevisionId:id,purpose:'subject',preserve:'',change:'',...d.imageBrief.references.find(r=>r.materialRevisionId===id),...patch}]}}));}
 const sizePreset=imageSizePresets.find(p=>p.standard===draft.settings.size||p.high===draft.settings.size)??imageSizePresets[0];
 function linkFirstFrame(){const imageId=candidate?.materialRevisionId??props.currentMaterialRevisionId;if(!imageId)return;setDraft(d=>({...d,videoInputIds:prioritizeVideoInput(d,imageId),videoModeId:'first-frame',tab:'video',origin:{...d.origin,video:'generate'}}));setNotice('已选定视频首帧，尚未提交生成。');}
 const existingVideoIn=visual?.kind==='video'&&timeline?Number(visual.srcInFrame??0)/timeline.fps:0;
 const currentVideo=current&&visual?.kind==='video'&&timeline?visual:undefined,previewRate=currentVideo?Number(currentVideo.playbackRate??1):1;
 const initialVideoIn=currentVideo?existingVideoIn:candidate?.initialRange?.sourceInSeconds??existingVideoIn,initialVideoOut=currentVideo?existingVideoIn+Number(currentVideo.durationInFrames)*previewRate/timeline!.fps:candidate?.initialRange?.sourceOutSeconds??candidate?.durationSeconds??0;
 useEffect(()=>{setRangeStart('');setRangeEnd('');setAcceptImpact(false);},[currentVideo?.id,currentVideo?.srcInFrame,currentVideo?.durationInFrames,currentVideo?.playbackRate]);
 const rangeStartSeconds=rangeStart===''?initialVideoIn:Number(rangeStart),rangeEndSeconds=rangeEnd===''?initialVideoOut:Number(rangeEnd);
 const videoAsset=currentVideo?props.project?.assets?.find(asset=>asset.id===currentVideo.sourceAssetId):undefined;
 const rangeDuration=candidate?.kind==='video'?candidate.durationSeconds:currentVideo&&videoAsset?videoAsset.durationInFrames/timeline!.fps:0;
 const videoSource=candidate?.kind==='video'?url(candidate.relativePath,candidate.sha256):currentVideo&&props.currentVisualPath?url(props.currentVisualPath,props.currentVisualSha256):undefined;
 const selectedVideoDuration=tab==='video'&&videoSource?rangeEndSeconds-rangeStartSeconds:null;
 const rangeValid=tab!=='video'||!videoSource||rangeStartSeconds>=0&&Number.isFinite(selectedVideoDuration)&&selectedVideoDuration!>0&&rangeEndSeconds<=rangeDuration;
 const previewSegment=tab==='video'&&rangeValid&&videoSource&&(rangeStartSeconds>0||rangeEndSeconds<rangeDuration||previewRate!==1)?{start:rangeStartSeconds,end:rangeEndSeconds}:undefined;
 const currentRangeChanged=!!currentVideo&&(Math.abs(rangeStartSeconds-initialVideoIn)>.0001||Math.abs(rangeEndSeconds-initialVideoOut)>.0001);
 async function saveCurrentRange(){await run(async()=>{
  if(!currentVideo||!timeline||!rangeValid)return;
  const latest=await fresh();if(latest.project.sha256!==workspace.project.sha256)throw Error('工程已变化，请刷新后重新裁剪。');
  const next=await command('editWorkspaceStructure',{...base(latest),operation:{kind:'trim',itemId:targetItemId,sourceInFrame:Math.round(rangeStartSeconds*timeline.fps),sourceOutFrame:Math.round(rangeEndSeconds*timeline.fps),keepDuration:policy==='keep-target'}}) as ProductionWorkspace;
  onChange(next);setRangeStart('');setRangeEnd('');setNotice('裁剪已保存。');
 });}
 const targetSeconds=replacementScope==='shot'&&props.project?(()=>{const window=readWorkspaceShotWindow(props.project!,targetItemId);return window?window.durationInFrames/window.timeline.fps:candidate?.currentDurationSeconds;})():currentVideo?Number(currentVideo.durationInFrames)/timeline!.fps:candidate?.currentDurationSeconds;
 const currentRangeTooShort=!!currentVideo&&policy==='keep-target'&&selectedVideoDuration!=null&&selectedVideoDuration/previewRate+.00001<Number(currentVideo.durationInFrames)/timeline!.fps;
 const canAdopt=rangeValid&&!!candidate&&candidate.status==='available'&&(candidate.kind==='image'||(policy==='keep-target'?targetSeconds==null||(selectedVideoDuration??candidate.durationSeconds)+0.05>=targetSeconds:acceptImpact));
 const shortCandidate=candidate?.kind==='video'&&!current&&policy==='keep-target'&&targetSeconds!=null&&rangeValid&&(selectedVideoDuration??0)+.05<targetSeconds;
 const adoptionLabel=tab==='image'?'作为镜头画面':props.currentVisualPath?'替换当前画面':'应用镜头';
 const adoptionAction=<Button ref={adoptTrigger} size="sm" color="primary" aria-label={adoptionLabel} aria-describedby={tab==='image'?adoptionDescriptionId:undefined} isDisabled={disabled||current||!canAdopt} onPress={()=>{if(candidate)void adopt(candidate);}}>{uiText(adoptionLabel)}</Button>;
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
 const promptTokens=new Set<string>(prompt.match(/@(图片|视频)[1-9]\d*/g)??[]),usedPromptReferences=(draft.promptReferences??[]).filter(binding=>promptTokens.has(binding.token));
 const missingMention=prompt.match(/@(图片|视频)[1-9]\d*/g)?.find(token=>!draft.promptReferences?.some(binding=>binding.token===token)||!mentionOptions.some(option=>option.token===token));
 const latestImageTask=tab==='image'?tasks.find(t=>t.kind==='image'&&t.targetItemId===targetItemId):undefined;
 const unknownTasks=tasks.filter(t=>t.targetItemId===targetItemId&&t.submissionUnknown&&!t.retryTaskId);
 const unknownImageTask=tab==='image'&&unknownTasks.length===1&&unknownTasks[0].kind==='image'
  &&(unknownTasks[0].unknownRetryAllowed??(unknownTasks[0].submissionOutcome!=='received'&&unknownTasks[0].publicationAttempt==null))?unknownTasks[0]:undefined;
 const retryImage=!!latestImageTask&&workspaceTaskPresentation(latestImageTask).canRetry;
 const showEmptyCandidateDrop=!!shelf&&!entries.length&&!pendingUpload;
 const dropCandidate=<WorkspaceMaterialDrop label={uiText("拖入{value0}加入候选",{value0:uiText(kindName)})} kind={tab} disabled={disabled} surface="preview" persistent={showEmptyCandidateDrop}
  onSelect={id=>void run(async()=>{await register(id,tab);})}/>;
 const activeGenerationTasks=tasks.filter(t=>t.targetItemId===targetItemId&&(t.kind??'video')===tab&&workspaceTaskPresentation(t).active&&!workspaceTaskPresentation(t).hidden);
 const taskStatus=(t:WorkspaceVisualTask)=><WorkspaceVisualTaskStatus key={t.id} task={t} label={(t.kind??'video')==='image'?uiText("图片"):uiText("视频")} disabled={disabled} onRetryUnknown={t===unknownImageTask?()=>{if(origin==='generate'&&canGenerate)void generate(t.taskId);else{setDraft(d=>({...d,origin:{...d.origin,image:'generate'}}));requestAnimationFrame(()=>formRef.current?.scrollIntoView({block:'nearest'}));}}:undefined} onRefresh={()=>void run(async()=>{await fresh();setCatalogReload(value=>value+1);})} onResume={()=>void run(async()=>{const w=await fresh();onChange(await command('retryWorkspaceVisualCandidate',{...base(w),candidateId:t.id}) as ProductionWorkspace);})} onReconcile={()=>void run(async()=>{await reconcileWorkspaceOutput(workspace.episodeId,t);onChange(await fresh());})}/>;
 const generationBlocker=pending.some(t=>(t.kind??'video')===tab)?'正在生成，请等待结果。'
  :tasks.some(t=>t.targetItemId===targetItemId&&(t.publicationAttempt!=null||t.submissionUnknown&&!t.retryTaskId&&t!==unknownImageTask))?'请先核对上一条生成任务。'
  :workspace.stale?'脚本已更新，请先核对当前素材。'
  :tab==='image'&&!imageCompatible?'请选择可用的图片模型和规格。'
  :tab==='video'&&!videoCompatible?'请选择可用的视频模型。'
  :tab==='video'&&(!canSubmitVideoMode||videoInputProblem||!advancedVideo&&!submitFirstFrame)?'请检查生成模式和画面素材。'
  :tab==='video'&&invalidDuration?'请调整到模型支持的时长。'
  :tab==='video'&&draft.videoSettings.negativePrompt.length>500?'负面提示词最多 500 字。'
  :missingMention?`${missingMention} 对应的素材已移除或不适用于当前模式，请重新插入引用。`
  :!prompt.trim()?'请填写提示词。':prompt.length>promptLimit?`提示词最多 ${promptLimit} 字。`:'';
 const canGenerate=!generationBlocker;
 const imagePreviewFailed=candidate?.id===imagePreviewError;
 const thumbnailTasks=pending.filter(t=>(t.kind??'video')===tab&&(!t.targetItemId||t.targetItemId===targetItemId)&&!t.submissionUnknown&&!t.retryTaskId);
 return <section className="workspace-visual-candidates workspace-visual-unified" aria-label={uiText("镜头图片与视频")}>
  <header><div className="workspace-visual-preview-tabs" role="tablist" aria-label={uiText("画面类型")}>{(['image','video'] as const).map(kind=><button key={kind} id={`visual-kind-${targetItemId}-${kind}`} type="button" role="tab" aria-selected={tab===kind} aria-controls={`visual-content-${targetItemId}`} tabIndex={tab===kind?0:-1} onClick={()=>change('tab',kind)} onKeyDown={e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();const next=e.key==='Home'?'image':e.key==='End'?'video':tab==='image'?'video':'image';change('tab',next);document.getElementById(`visual-kind-${targetItemId}-${next}`)?.focus();}}}>{kind==='image'?uiText("图片"):uiText("视频")}</button>)}</div></header>
  <WorkspaceUploadFeedback rows={uploadRows} running={uploading} disabled={disabled} notice={uploadNotice} onDismiss={id=>uploadState.update(value=>value.notice?.id===id?{...value,notice:undefined}:value)} onAbandon={()=>{if(!disabled)uploadState.abandon();}} onRetry={()=>void processUploads(uploadRows.filter(row=>row.status==='failed'||row.status==='pending'))}/>
  {templateReferenceProblem(template?.visual)&&<p role="status">{templateReferenceProblem(template?.visual)}</p>}
  {!props.currentVisualPath&&!draft.selected[tab]&&templateMaterial?.type===tab&&<Button size="sm" color="secondary" isDisabled={disabled} onPress={()=>void run(()=>register(templateMaterial.id,tab))}>{`准备素材：${templateMaterial.name}`}</Button>}
  {options.length>1&&<label>{uiText("目标片段")}<NativeSelect size="sm" aria-label={uiText("画面候选目标")} value={targetItemId} disabled={disabled} onChange={e=>props.onTargetChange?.(e.target.value)}>{options.map((clip,index)=>{
    const item=timeline?.items.find(entry=>entry.id===clip.itemId);
    const slot=(item?.loopControlComposition as {slotId?:string}|undefined)?.slotId;
    return <option key={clip.itemId} value={clip.itemId}>{slot?shotCompositionSlotLabels[slot]??uiText("片段 {value0}",{value0:String(index+1)}):uiText("片段 {value0}",{value0:String(index+1)})} · {clip.text}</option>;
   })}</NativeSelect></label>}
  <div id={`visual-content-${targetItemId}`} role="tabpanel" aria-labelledby={`visual-kind-${targetItemId}-${tab}`} className="workspace-visual-content">
   <section className="workspace-visual-results" aria-label={uiText("{value0}候选结果",{value0:uiText(kindName)})}>
    {!shelf&&allMaterials.some(m=>m.material_type===tab)&&<div className="workspace-results-heading"><details className="workspace-results-import" onKeyDown={e=>{if(e.key==='Escape'){e.currentTarget.open=false;e.currentTarget.querySelector('summary')?.focus();}}}><summary>{uiText("从本期素材选取")}</summary><div className="workspace-results-import-content"><label>{uiText("本期")}{kindName}<NativeSelect size="sm" aria-label={uiText("选择本期{value0}",{value0:uiText(kindName)})} value="" disabled={disabled} onChange={e=>{const id=e.target.value,disclosure=e.currentTarget.closest('details');if(id)void run(async()=>{await register(id,tab);disclosure?.removeAttribute('open');});}}><option value="">{uiText("选择后加入候选")}</option>{allMaterials.filter(m=>m.material_type===tab).map(m=><option key={m.id} value={m.id}>{m.source_path.split('/').pop()}</option>)}</NativeSelect></label></div></details></div>}
    <div className="workspace-results-gallery">
      {(entries.length>0||thumbnailTasks.length>0)&&<div ref={thumbnailRail} className="workspace-thumbnail-rail" role="group" aria-label={uiText("{value0}候选缩略图",{value0:uiText(kindName)})} data-kind={tab} onKeyDown={event=>{
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
        const adopted=!c||c===currentCandidate;
        return <button className="workspace-thumbnail-select" key={entry.id} type="button"
         data-arriving={arrivingCandidates.includes(entry.id)||undefined} data-adoption-feedback={adoptionFeedback===entry.id||undefined}
         aria-label={uiText("预览{value0}候选 {value1}{value2}",{value0:uiText(kindName),value1:String(number),value2:String(adopted?'，已采用':'')})} aria-pressed={active?.id===entry.id} onClick={()=>select(entry.id)}>
         <span className="workspace-thumbnail-media">{c?(c.kind==='image'?<img src={url(c.relativePath,c.sha256)} alt="" loading="lazy"/>:<video src={url(c.relativePath,c.sha256)} muted preload="metadata" aria-hidden="true"/>):(tab==='image'?<ImageIcon aria-hidden="true"/>:<Video aria-hidden="true"/>)}</span>
         <span className="workspace-thumbnail-caption" aria-hidden="true">{number}{adopted&&<Check size={14} className="workspace-thumbnail-adopted"/>}</span>
        </button>;
       })}
       {thumbnailTasks.flatMap(task=>Array.from({length:Math.max(1,Math.min(4,task.kind==='image'?task.generation?.imageSettings?.count??1:1))},(_,i)=><div className="workspace-thumbnail-pending" key={`${task.id}:${i}`}><WorkspaceVisualTaskProgress task={task} label={kindName} thumbnail/></div>))}
      </div>}
   {candidate&&!current&&hasMultipleFragments&&<div className="workspace-visual-range"><label htmlFor={adoptionDescriptionId+'-scope'}>{uiText("画面替换范围")}</label><NativeSelect id={adoptionDescriptionId+'-scope'} name="replacementScope" size="sm" disabled={disabled} value={replacementScope} onChange={event=>setReplacementScope(event.target.value as 'fragment'|'shot')}><option value="fragment">{uiText("选中片段")}</option><option value="shot">{uiText("整条分镜")}</option></NativeSelect>{replacementScope==='shot'&&<p role="status">{uiText("将本分镜全部画面换为一个新素材；保留口播、字幕、独立音效和其他分镜位置。")}</p>}</div>}
   {visual?.kind==='video'&&(visual.loopControlAudio as {sourceAudioStatus?:string}|undefined)?.sourceAudioStatus==='silent'&&<p role="status">{uiText("当前视频没有原声。")}</p>}
   <div className="workspace-unified-preview" onKeyDown={e=>{if(e.target!==e.currentTarget||entries.length<2)return;if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();select(entries[(index+(e.key==='ArrowRight'?1:-1)+entries.length)%entries.length].id);}}} tabIndex={entries.length>1?0:undefined} aria-label={uiText("{value0}预览",{value0:uiText(kindName)})}>
    {active?.id==='current'?(currentVideo&&videoSource?<VideoPreview mediaRef={videoPreviewRef} title={uiText('当前视频')} src={videoSource} segment={previewSegment} playbackRate={previewRate}/>:props.preview):candidate?(tab==='image'?imagePreviewFailed?<div className="workspace-visual-empty"><p role="alert">{uiText("图片未能加载。")}</p><Button size="sm" color="secondary" onPress={()=>{setImagePreviewError('');retryImagePreview(value=>value+1);}}>{uiText("重试预览")}</Button></div>:<img key={`${candidate.id}:${imagePreviewAttempt}`} src={url(candidate.relativePath,candidate.sha256)} alt={uiText("{value0}候选 {value1}",{value0:uiText(kindName),value1:String(index+1)})} onError={()=>setImagePreviewError(candidate.id)}/>:<VideoPreview mediaRef={videoPreviewRef} key={candidate.id} title={uiText("视频候选预览")} aria-label={uiText("视频候选预览")} src={url(candidate.relativePath,candidate.sha256)} segment={previewSegment} playbackRate={previewRate}/>):pendingUpload?<div className="workspace-upload-preview" role="status" aria-label={uiText("{value0}候选上传中",{value0:uiText(kindName)})}><div className="workspace-upload-preview-placeholder" style={{aspectRatio:`${target?.width??9}/${target?.height??16}`}} aria-hidden="true"/><p>{uiText("正在准备")}{kindName}{uiText("候选…")}</p><small>{pendingUpload.name}</small></div>:!showEmptyCandidateDrop&&<div className="workspace-visual-empty">{tab==='image'?<ImageIcon size={28} aria-hidden="true"/>:<Video size={28} aria-hidden="true"/>}<p>{entries.length?uiText("选择左侧缩略图预览"):uiText("尚未添加{value0}",{value0:uiText(kindName)})}</p>{!entries.length&&<span>{shelf?uiText("从左侧本期素材拖入，或使用 AI 生成"):uiText("上传素材，或使用 AI 生成")}</span>}</div>}
    {active&&<div className="workspace-preview-actions workspace-candidate-tools" role="group" aria-label={uiText("候选工具")}>
     {tab==='video'&&videoSource&&rangeDuration>0&&<Tooltip title={uiText('裁剪')}><Button size="xs" color="secondary" className="workspace-preview-zoom" iconLeading={Scissors} aria-label={uiText('裁剪')} aria-expanded={cropOpen} aria-controls={cropId+'-crop'} isDisabled={disabled||!!review} onPress={()=>{setCropOpen(!cropOpen);if(cropOpen)setTrimOpen(false);}}/></Tooltip>}
     {tab==='video'&&current&&canSplitVideo&&<Tooltip title={uiText("拆分视频原声")}><Button size="xs" color="secondary" aria-label={uiText("拆分视频原声")} iconLeading={AudioLines} isDisabled={disabled||!!review} onPress={()=>void run(async()=>{const w=await fresh();onChange(await command('splitWorkspaceVideoSound',{...base(w),targetItemId}) as ProductionWorkspace);setNotice('视频原声已拆分，可在剪辑工作台单独编辑。');})}/></Tooltip>}
     {candidate&&tab==='video'&&<a className="workspace-preview-zoom" href={url(candidate.relativePath,candidate.sha256)+'&download=1'} download aria-label={uiText("下载视频")} title={uiText("下载视频")}><Download size={16} aria-hidden="true"/></a>}
     {candidate&&tab==='image'&&!imagePreviewFailed&&<><a className="workspace-preview-zoom" href={url(candidate.relativePath,candidate.sha256)+'&download=1'} download aria-label={uiText("下载图片")} title={uiText("下载原图")}><Download size={16} aria-hidden="true"/></a><button ref={zoomTrigger} className="workspace-preview-zoom" type="button" aria-label={uiText("放大图片")} title={uiText("放大图片")} onClick={()=>setZoom(true)}><Maximize2 size={16} aria-hidden="true"/></button></>}
     {candidate&&!current&&<Tooltip title={uiText("移除候选")}><Button className="workspace-candidate-tool-remove" size="xs" color="secondary" aria-label={uiText("移除候选")} iconLeading={Trash2} isDisabled={disabled||!!review||!!candidate.pendingConfirmation} onPress={removeSelected}/></Tooltip>}
    </div>}
    {dropCandidate}
   </div>

      {tab==='video'&&videoSource&&rangeDuration>0&&<MediaRangeEditor key={candidate?.id??targetItemId} label="视频" id={cropId} showTrigger={false} isOpen={cropOpen} onOpenChange={setCropOpen} duration={rangeDuration} value={[rangeStartSeconds,rangeEndSeconds]} step={1/(timeline?.fps??30)} disabled={disabled||!!review} onChange={range=>{setRangeStart(String(range[0]));setRangeEnd(String(range[1]));setAcceptImpact(false);}} media={videoPreviewRef} videoSrc={videoSource} preciseOpen={trimOpen} onPreciseOpenChange={setTrimOpen} actions={currentRangeChanged&&<div className="workspace-current-trim-save"><span role={currentRangeTooShort?'alert':undefined}>{uiText(currentRangeTooShort?'所选区间较短，请在精确时间中选择采用所选区间时长。':'裁剪尚未保存')}</span><Button size="sm" color="primary" isDisabled={disabled||!rangeValid||currentRangeTooShort||policy==='use-candidate'&&!acceptImpact} onPress={()=>void saveCurrentRange()}>{uiText('保存裁剪')}</Button></div>}>
       <label>{uiText("采用时长")}<NativeSelect size="sm" aria-label={uiText("视觉候选时长处理")} disabled={disabled} value={policy} onChange={e=>{setPolicy(e.target.value);setAcceptImpact(false);}}><option value="keep-target">{uiText("保留镜头时长")}</option><option value="use-candidate">{uiText(rangeStartSeconds>0||rangeEndSeconds<rangeDuration?"使用所选区间时长":"使用素材完整时长")}</option></NativeSelect></label>
       {policy==='use-candidate'&&<label className="workspace-visual-checkbox"><input type="checkbox" disabled={disabled} checked={acceptImpact} onChange={e=>setAcceptImpact(e.target.checked)}/>{uiText("保留其他片段位置，接受空隙或覆盖")}</label>}
       {policy==='keep-target'&&targetSeconds!=null&&(!rangeValid||(selectedVideoDuration??rangeDuration)/previewRate+.05<targetSeconds)&&<p role="alert">{uiText("所选区间无法保留当前片段时长，请调整起止点或采用素材区间的时长。")}</p>}
      </MediaRangeEditor>}

      {active&&<div className="workspace-result-footer">
       <p title={inlineReview?reviewSummary:candidateMeta||candidate?.relativePath}><strong>{candidate?uiText("候选 {value0} / {value1}",{value0:String(String(index+1).padStart(2,'0')),value1:String(String(entries.length).padStart(2,'0'))}):uiText("当前画面")}</strong>{inlineReview?<span role="status">{uiText(reviewSummary)}</span>:candidateMeta&&<span className={current?'workspace-candidate-used-status':undefined}>{current?uiText("已采用"):candidateMeta}</span>}</p>
       {inlineReview?<div className="workspace-result-actions workspace-result-confirmation" role="group" aria-label={uiText("采用前核对")} onKeyDown={event=>{if(event.key==='Escape'&&!candidateReview.pending&&!busy){event.stopPropagation();closeAdoption();}}}>
        <Button autoFocus size="sm" color="secondary" isDisabled={disabled} onPress={closeAdoption}>{uiText("取消")}</Button>
        <Button size="sm" color="primary" isDisabled={disabled} onPress={()=>void confirmAdoption()}>{uiText("确认采用")}</Button>
       </div>:<div className="workspace-result-actions">
        {current?<Button ref={adoptTrigger} className="workspace-candidate-withdraw" size="sm" color="tertiary" aria-label={current?uiText("撤回{value0}采用",{value0:uiText(kindName)}):uiText("撤回备用图片")} isDisabled={disabled} onPress={removeSelected}>{uiText("撤回")}</Button>:adoptionAction}
        {tab==='image'&&(candidate?.materialRevisionId||current&&props.currentMaterialRevisionId)&&<Button className="workspace-candidate-tool-first-frame" size="sm" color="secondary" aria-label={uiText("生成视频")} isDisabled={disabled||!!review||candidate?.status==='stale'} onPress={linkFirstFrame}>{uiText("生成视频")}</Button>}
       </div>}
       {shortCandidate&&<div className="workspace-adoption-duration-warning" role="status"><p>{uiText("素材可用 ")}{selectedVideoDuration!.toFixed(2)}{uiText(" 秒，短于当前镜头 ")}{targetSeconds!.toFixed(2)}{uiText(" 秒，还差 ")}{(targetSeconds! - selectedVideoDuration!).toFixed(2)}{uiText(" 秒。可换素材，或进入剪辑工作台调整。")}</p><Button size="sm" color="secondary" isDisabled={disabled} onPress={()=>setTrimOpen(true)}>{uiText("选用其他区间")}</Button></div>}
      </div>}
      {candidate?.source&&<p className="workspace-candidate-source"><a href={candidate.source.sourceUrl} target="_blank" rel="noreferrer">Pexels #{candidate.source.id}</a> · <a href={candidate.source.creatorUrl} target="_blank" rel="noreferrer">{candidate.source.creator}</a> · {candidate.source.connectionName} · {candidate.source.query}</p>}
      {tab==='image'&&<span hidden id={adoptionDescriptionId}>{current?uiText("当前镜头正在使用此图"):uiText("用作镜头画面，保持时长不变")}</span>}
      <ConfirmationModalPresence>{needsImpactDialog&&review&&review.kind==='adoption'&&createPortal(<div className="workspace-visual-adoption-overlay">
       <ConfirmationModal title={uiText("采用前核对")} confirmLabel={uiText("确认采用")} isPending={busy||candidateReview.pending} confirmDisabled={!!disabled} onConfirm={confirmAdoption} onCancel={closeAdoption}>
        <div className="workspace-candidate-impact-details"><WorkspaceCandidateImpactDetails plan={review}/></div>
       </ConfirmationModal>
      </div>,document.querySelector('.app-shell')??document.body)}</ConfirmationModalPresence>
    </div>
  {tasks.filter(t=>t.status!=='completed'&&!(origin==='generate'&&activeGenerationTasks.includes(t))&&!thumbnailTasks.includes(t)&&(t.submissionUnknown&&!t.retryTaskId||t.publicationAttempt!=null||!tasks.some(newer=>newer.taskId!==t.taskId&&newer.targetItemId===t.targetItemId&&(newer.kind??'video')===(t.kind??'video')&&!!newer.createdAt&&!!t.createdAt&&Date.parse(newer.createdAt)>Date.parse(t.createdAt)))).map(taskStatus)}
   </section>
   {!shelf&&<div className="workspace-visual-origin" role="group" aria-label={uiText("{value0}来源",{value0:uiText(kindName)})}>{(['material','generate'] as const).filter(value=>!shelf||value!=='material').map(value=><button key={value} type="button" aria-pressed={origin===value||value==='generate'&&origin==='search'} onClick={()=>setDraft(d=>({...d,origin:{...d.origin,[tab]:value}}))}>{value==='material'?uiText("上传素材"):uiText("AI 生成")}</button>)}</div>}
   {origin==='material'?<div className="workspace-visual-import">
    <button type="button" className="workspace-visual-dropzone" disabled={disabled} onClick={()=>fileInput.current?.click()} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();if(!disabled)void upload([...e.dataTransfer.files]);}}><Upload size={18} aria-hidden="true"/><span>{uiText("选择或拖入")}{kindName}</span><small>{tab==='image'?uiText("PNG、JPEG、WebP、BMP · 每张不超过 100 MB · 可多选"):uiText("MP4 · 不超过 100 MB · 每次 1 个")}</small></button>

   </div>:origin==='search'?<WorkspacePexelsSearch key={targetItemId} workspace={workspace} targetItemId={targetItemId} command={command} onChange={onChange} prepare={fresh} reader={reader} disabled={disabled} composer={{services:videoServices,selection:draft.pexelsSelection,onModelChange:chooseVideoSource,onSetupSelection:useConfiguredVideo,catalogError,catalog:catalogReading}}/>:<div className="workspace-visual-generation-form" ref={formRef}>

    {catalogError&&<p role="alert">{uiText(catalogError||'')}</p>}
    {selectionProblems.length>0&&<ul className="workspace-generation-problems" aria-label={uiText("{value0}设置不兼容",{value0:uiText(kindName)})} role="list">{selectionProblems.map(problem=><li key={problem}>{uiText(problem)}</li>)}</ul>}
    {tab==='video'&&incompatibleWan&&<p role="alert">{wanSettingsProblem??uiText("当前模型不支持万相专用设置：{value0}。",{value0:String(Object.entries(draft.videoSettings).filter(([key,value])=>value!==defaultWanSettings[key as keyof typeof defaultWanSettings]).map(([key])=>wanSettingLabels[key as keyof WanGenerationSettings]??key).join('、'))})}<Button size="sm" color="tertiary" onPress={()=>change('videoSettings',videoProvider==='bailian'&&videoModel?defaultWanModelSettings(videoModel):{...defaultWanSettings})}>{uiText("按此模型恢复默认参数")}</Button></p>}

    <WorkspaceGenerationComposer kind={tab} disabled={disabled} activity={<>{activeGenerationTasks.map(task=><WorkspaceGenerationActivity key={task.id} model={task.model} provider={task.provider}>{taskStatus(task)}</WorkspaceGenerationActivity>)}{!activeGenerationTasks.length&&generationSubmitting?.kind===tab&&generationSubmitting.targetItemId===targetItemId&&<WorkspaceGenerationActivity model={generationSubmitting.model} provider={generationSubmitting.provider}/>}</>} reference={tab==='image'?<WorkspaceReferencePicker compact maxCount={imageService?.constraints.referenceImages?.max??16} materials={allMaterials} selected={draft.references} disabled={disabled} onChange={ids=>change('references',ids)} onUpload={files=>upload(files,true)} url={url} summary={id=>referencePurposeLabels[draft.imageBrief.references.find(r=>r.materialRevisionId===id)?.purpose??'subject']} renderDetails={(id,i)=>{const r=draft.imageBrief.references.find(r=>r.materialRevisionId===id);return <fieldset key={id} className="workspace-image-reference-brief" disabled={disabled}><legend>{uiText("参考图 ")}{i+1} · {allMaterials.find(m=>m.id===id)?.source_path.split('/').pop()}</legend><label>{uiText("参考用途")}<NativeSelect size="sm" aria-label={uiText("参考图 {value0} 用途",{value0:String(i+1)})} value={r?.purpose??'subject'} onChange={e=>referenceBrief(id,{purpose:e.target.value as keyof typeof referencePurposeLabels})}>{Object.entries(referencePurposeLabels).map(([v,label])=><option key={v} value={v}>{uiText(label)}</option>)}</NativeSelect></label><label>{uiText("需要保留")}<input maxLength={160} aria-label={uiText("参考图 {value0} 需要保留",{value0:String(i+1)})} value={r?.preserve??''} placeholder={uiText("例如：产品图案、人物外观")} onChange={e=>referenceBrief(id,{preserve:e.target.value})}/></label><label>{uiText("允许改变")}<input maxLength={160} aria-label={uiText("参考图 {value0} 允许改变",{value0:String(i+1)})} value={r?.change??''} placeholder={uiText("例如：背景、光线")} onChange={e=>referenceBrief(id,{change:e.target.value})}/></label></fieldset>;}}/>:<WorkspaceVideoInputs compact modes={videoModes} mode={videoMode} entries={videoInputs} disabled={disabled}
     onMode={id=>change('videoModeId',id)} onAdd={addVideoInput} onMove={moveVideoInput} onRemove={index=>setDraft(previous=>({...previous,videoInputIds:videoDraftIds(previous).filter((_,position)=>position!==index)}))}
     videoSources={videoSources} onVideoSource={(id,source)=>setDraft(previous=>({...previous,referenceVideoSources:{...previous.referenceVideoSources,[id]:source}}))}
     url={url} firstFrameFit={draft.firstFrameFit} ratio={(target?.width??9)/(target?.height??16)}
     onFit={fit=>change('firstFrameFit',fit)} onUpload={()=>referenceInput.current?.click()} onFiles={files=>void upload(files,true)}/>} prompt={<WorkspacePromptField label={uiText("{value0}提示词",{value0:uiText(kindName)})} ariaLabel={tab==='image'?uiText("图片提示词"):uiText("画面动作")} value={prompt} limit={promptLimit} disabled={disabled} mentions={mentionOptions} onChange={value=>setDraft(d=>({...d,[tab==='image'?'imagePrompt':'videoPrompt']:value,promptReferences:[...(d.promptReferences??[]),...mentionOptions.filter(option=>!d.promptReferences?.some(binding=>binding.materialRevisionId===option.materialRevisionId)).map(({token,materialRevisionId})=>({token,materialRevisionId}))]}))} placeholder={tab==='video'?uiText("例如：以首帧为起点，镜头缓慢向装饰画推进，保持画框、图案和文字稳定，单镜头，不切换场景。"):draft.references.length?uiText("例如：保留参考图中装饰画的图案、文字和边框，将背景改为明亮的现代客厅，产品居中完整展示，竖屏构图。"):uiText("例如：竖屏产品摄影，金色山水装饰画挂在现代客厅，清晨侧光，完整展示画框细节，写实质感，不添加额外文字。")}/>} model={<WorkspaceGenerationModel onRefresh={catalogReading.refresh} refreshing={catalogReading.pending} compact kind={kindName} services={tab==='image'?imageServices:videoServices} selection={tab==='image'?draft.imageSelection:draft.videoSelection} disabled={disabled} onSetupSelection={selection=>{if(tab==='image')change('imageSelection',selection);else useConfiguredVideo(selection);}} onChange={value=>{if(tab==='image'){change('imageSelection',productionModelSelection(imageServices,value,'image'));setComposerPanel(value?'dimensions':'');}else chooseVideoSource(value);}}/>}
     onMaterial={id=>{if(tab==='video')addVideoInput(id);else if(!draft.references.includes(id)){const max=imageService?.constraints.referenceImages?.max??16;if(draft.references.length>=max)setError(`当前模型最多使用 ${max} 张参考图，请先移除再添加。`);else change('references',[...draft.references,id]);}}} onFiles={files=>void upload(files,true)}
     settings={<><WorkspaceComposerSetting label={tab==='image'?uiText("图片规格"):uiText("视频规格")} summary={tab==='image'?`${sizePreset.ratio} · ${draft.settings.size.replace('x','×')}`:videoProvider==='bailian'?draft.videoSettings.resolution:videoProvider==='minimax'?draft.videoResolution??'768P':videoService?.constraints.resolutions?.join(' / ')??uiText("规格")} open={composerPanel==='dimensions'} onOpenChange={open=>setComposerPanel(open?'dimensions':'')} disabled={disabled}>
      {tab==='image'?<WorkspaceImageSettings settings={draft.settings} service={imageService} disabled={disabled} onChange={value=>change('settings',value)}/>:<><WorkspaceResolutionChoices values={videoProvider==='bailian'?wanProfile?.resolutions??['720P','1080P']:videoService?.constraints.resolutions??[]} value={videoProvider==='bailian'?draft.videoSettings.resolution:videoProvider==='minimax'?draft.videoResolution??'768P':videoService?.constraints.resolutions?.[0]??''} disabled={disabled} onChange={value=>videoProvider==='bailian'?change('videoSettings',{...draft.videoSettings,resolution:value as '720P'|'1080P'}):videoProvider==='minimax'?change('videoResolution',value):undefined}/>
      <div className="workspace-composer-choice-field"><span>{uiText("画面比例")}</span><span className="workspace-composer-fixed-ratio">{videoMode.id==='references'&&videoProvider==='minimax'&&videoModel==='MiniMax-H3-Lite'?uiText("{value0} × {value1} · 跟随镜头",{value0:String(target?.width??1080),value1:String(target?.height??1920)}):uiText("随输入画面")}</span></div></>}
     </WorkspaceComposerSetting>
     {tab==='image'?<><WorkspaceComposerSetting label={uiText("生成数量")} compact summary={uiText("{value0} 张",{value0:String(draft.settings.count)})} open={composerPanel==='count'} onOpenChange={open=>setComposerPanel(open?'count':'')} disabled={disabled}><WorkspaceImageCount settings={draft.settings} service={imageService} disabled={disabled} onChange={value=>change('settings',value)}/></WorkspaceComposerSetting><WorkspaceComposerSetting label={uiText("构图与字幕留白")} summary={uiText("构图")} open={composerPanel==='composition'} onOpenChange={open=>setComposerPanel(open?'composition':'')} disabled={disabled}>{tab==='image'&&<>

     <div className="workspace-visual-fields workspace-image-composition">
      <label>{uiText("主体构图")}<NativeSelect size="sm" aria-label={uiText("图片主体构图")} disabled={disabled} value={framingOption} onChange={event=>{
        const value=event.target.value;
        change('imageBrief',{
         ...draft.imageBrief,
         framing:value==='full-with-margin'?'full':value==='close-with-margin'?'close':value as ImageBrief['framing'],
         crop:value.endsWith('-with-margin')?'protect':'allow',
        });
       }}>
        <option value="auto">{uiText(framingLabels.auto)}</option>
        <option value="full">{uiText(framingLabels.full)}</option>
        <option value="full-with-margin">{uiText("完整展示，四周留余量")}</option>
        <option value="close">{uiText(framingLabels.close)}</option>
        {hasSavedCloseUpWithMargin&&<option value="close-with-margin">{uiText("主体特写，四周留余量")}</option>}
       </NativeSelect>
      </label>
      <label>{uiText("字幕留白")}<NativeSelect size="sm" aria-label={uiText("图片字幕留白")} disabled={disabled} value={draft.imageBrief.captionSpace}
        onChange={event=>change('imageBrief',{...draft.imageBrief,captionSpace:event.target.value as ImageBrief['captionSpace']})}>
        {Object.entries(captionSpaceLabels).map(([value,label])=><option key={value} value={value}>{uiText(label)}</option>)}
       </NativeSelect>
      </label>
     </div>
    </>}</WorkspaceComposerSetting></>:<><WorkspaceComposerSetting label={uiText("画面输入模式")} summary={uiText(videoMode.label)} open={composerPanel==='mode'} onOpenChange={open=>setComposerPanel(open?'mode':'')} disabled={disabled}><WorkspaceVideoModeChoices modes={videoModes} value={videoMode.id} disabled={disabled} onChange={value=>change('videoModeId',value)}/>{videoMode.inputs.firstFrame&&<WorkspaceFrameFitChoices value={draft.firstFrameFit} disabled={disabled} onChange={value=>change('firstFrameFit',value)}/>}</WorkspaceComposerSetting><WorkspaceComposerSetting label={uiText("生成时长")} hint={voiceDriven?uiText("时长跟随已采用的{value0}",{value0:uiText(target?.voiceMode==='source'?'视频原声':'口播')}):uiText("设置本次视频时长")} summary={uiText("{value0} 秒",{value0:String(actualDuration==null?'—':Number(actualDuration.toFixed(2)))})} open={composerPanel==='duration'} onOpenChange={open=>setComposerPanel(open?'duration':'')} disabled={disabled}>{<><WorkspaceDurationControl value={voiceDriven&&actualDuration!=null?Number(actualDuration.toFixed(2)):voiceDriven?'':draft.duration} min={minimumSeconds} max={maximumSeconds} durations={wanProfile?.durations} locked={voiceDriven} disabled={disabled} describedBy={voiceDriven?adoptionDescriptionId+'-duration':undefined} onChange={value=>change('duration',value)}/>{voiceDriven&&<p>{uiText("按当前")}{target?.voiceMode==='source'?uiText("视频原声"):uiText("口播")}{uiText("使用 ")}{actualDuration==null?'—':Number(actualDuration.toFixed(2))}{uiText(" 秒，服务请求 ")}{providerDuration??'—'}{uiText(" 秒。")}</p>}{voiceDriven&&<p id={adoptionDescriptionId+'-duration'}>{target?.voiceMode==='source'?uiText("本镜使用视频原声，时长跟随原声窗口；请在剪辑台调整原声使用区间。"):uiText("本镜已采用口播，时长随该音频锁定；更换或撤回采用后会重新计算。")}</p>}{invalidDuration&&<p role="alert">{uiText("该模型支持 ")}{wanProfile&&wanProfile.durations.length<4?wanProfile.durations.join(' / '):`${minimumSeconds}～${maximumSeconds}`}{uiText(" 秒；请调整时长或拆分镜头。")}</p>}</>}</WorkspaceComposerSetting>{videoProvider==='bailian'&&<WorkspaceComposerSetting label={uiText("高级视频设置")} summary={uiText("高级")} open={composerPanel==='advanced'} onOpenChange={open=>setComposerPanel(open?'advanced':'')} disabled={disabled}>{tab==='video'&&videoProvider==='bailian'&&<div className="workspace-video-advanced"><div className="workspace-video-advanced-fields">

      <WorkspacePromptField label={uiText("负面提示词")} ariaLabel={uiText("视频负面提示词")} rows={2} limit={500} disabled={disabled} value={draft.videoSettings.negativePrompt} onChange={value=>change('videoSettings',{...draft.videoSettings,negativePrompt:value})} placeholder={uiText("例如：画框变形、文字变化、画面闪烁、突然切镜。")}/>

      <label>{uiText("随机种子（可选）")}<input type="number" aria-label={uiText("视频随机种子")} min="0" max="2147483647" step="1" disabled={disabled} value={draft.videoSettings.seed??''} onChange={e=>change('videoSettings',{...draft.videoSettings,seed:e.target.value===''?undefined:Number(e.target.value)})}/></label>
      {!videoMode.characterOrder&&<label className="workspace-visual-checkbox"><input type="checkbox" checked={draft.videoSettings.promptExtend} disabled={disabled} onChange={e=>change('videoSettings',{...draft.videoSettings,promptExtend:e.target.checked,shotType:e.target.checked?draft.videoSettings.shotType:'single'})}/>{uiText("智能扩写提示词")}</label>}
      {(videoMode.characterOrder||draft.videoSettings.promptExtend)&&(wanProfile?.multiShot??true)&&<label>{uiText("镜头结构")}<NativeSelect size="sm" aria-label={uiText("视频镜头结构")} disabled={disabled} value={draft.videoSettings.shotType} onChange={e=>change('videoSettings',{...draft.videoSettings,shotType:e.target.value as 'single'|'multi'})}><option value="single">{uiText("单镜头")}</option><option value="multi">{uiText("多镜头")}</option></NativeSelect></label>}
      <label className="workspace-visual-checkbox"><input type="checkbox" checked={videoSettings.audio} disabled={disabled||!!wanProfile&&wanProfile.audio!=='optional'} onChange={e=>change('videoSettings',{...draft.videoSettings,audio:e.target.checked})}/>{uiText("生成视频声音")}{wanProfile?.audio==='always'?uiText("（当前模型固定有声）"):wanProfile?.audio==='silent'?uiText("（当前模型不支持）"):''}</label>
      <label className="workspace-visual-checkbox"><input type="checkbox" checked={draft.videoSettings.watermark} disabled={disabled} onChange={e=>change('videoSettings',{...draft.videoSettings,watermark:e.target.checked})}/>{uiText("添加模型水印")}</label>
      <small>{uiText("分辨率、时长和声音会影响费用；种子相同也不保证结果完全一致。")}</small>
    </div></div>}</WorkspaceComposerSetting>}</>}

</>} submit={<Button size="sm" color="primary" isDisabled={disabled||!canGenerate} onPress={()=>void generate(unknownImageTask?.taskId)}>{pending.some(t=>(t.kind??'video')===tab)?uiText("正在生成…"):(retryImage||unknownImageTask)?uiText("重新生成图片"):uiText("生成{value0}",{value0:uiText(kindName)})}</Button>}>
     {generationBlocker&&(generationBlocker!=='正在生成，请等待结果。'||!activeGenerationTasks.length)&&generationBlocker!=='请填写提示词。'&&<p className="workspace-visual-generation-note" role="status">{uiText(generationBlocker)}</p>}
    </WorkspaceGenerationComposer>
   </div>}
  </div>

  <ConfirmationModalPresence>{clearVisual&&<ConfirmationModal title={clearVisual.sourcePath?uiText("取消采用{value0}",{value0:uiText(kindName)}):uiText("取消备用图片")} confirmLabel={uiText("确认取消采用")} isPending={busy} confirmDisabled={!!disabled}
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
   <p>{clearVisual.sourcePath?uiText("当前片段将恢复为待匹配，时长保持原样。素材留在候选区，可重新采用。"):uiText("图片将取消备用，仍留在候选区。")}</p>
   {clearError&&<p role="alert">{uiText(clearError||'')}</p>}
  </ConfirmationModal>}</ConfirmationModalPresence>
  <FeedbackNotice message={notice} onDismiss={()=>setNotice('')}/>{(error||pollingError)&&<p role="alert">{error||uiText("任务状态暂时无法更新，将自动重试。")}</p>}
  {!shelf&&<input ref={fileInput} hidden aria-label={uiText("上传{value0}素材",{value0:uiText(kindName)})} type="file" multiple={tab==='image'} accept={tab==='image'?'image/png,image/jpeg,image/webp,image/bmp':'video/mp4'} disabled={disabled} onChange={e=>{const files=[...e.target.files??[]];e.target.value='';if(files.length)void upload(files);}}/>}
  {tab==='video'&&<input ref={referenceInput} hidden aria-label={uiText("上传画面素材文件")} type="file" multiple accept="image/png,image/jpeg,image/webp,image/bmp,video/mp4,video/quicktime,video/webm" disabled={disabled} onChange={e=>{const files=[...e.target.files??[]];e.target.value='';if(files.length)void upload(files,true);}}/>}
  {zoom&&candidate&&<ImageFocusDialog src={url(candidate.relativePath,candidate.sha256)} title={uiText("图片大图预览")} imageAlt="图片候选大图" closeLabel={uiText("关闭大图预览")} onClose={()=>setZoom(false)}/>}
 </section>;
}
