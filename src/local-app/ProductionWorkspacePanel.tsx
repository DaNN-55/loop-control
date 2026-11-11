import {uiText} from '../i18n/ui';
import {unassignedWorkspaceAudioPurpose} from './workspaceAudioMaterial';
import {WorkspaceMaterialSelectionProvider} from './WorkspaceMaterialDrop';
import {workflowStepLabels} from '../workspace/episodePresentation';
import {productionSteps,useWorkspaceNavigation} from './catalogNavigation';
import {useWorkspaceDraftLeave,useWorkspaceOwnerId} from './WorkspaceDraft';
import {useWorkspaceCallConfirmation} from './useWorkspaceCallConfirmation';
import {useWorkspaceOperations} from './useWorkspaceOperations';
import {parseStoryboardScript} from '../reviews/productionScript';
import {ConfirmationModal,ConfirmationModalPresence} from '../ui/ConfirmationModal';
import {useWorkspaceCanvas} from './useWorkspaceCanvas';
import {WorkspacePreparationLayout} from './WorkspacePreparationLayout';
import {WorkspaceCompletedShots} from './WorkspaceCompletedShots';
import {WorkspaceShotPreview,workspaceShotSource} from './WorkspaceShotPreview';
import {LegacyPreparation,LegacyEditing,LegacyDelivery,hasLegacyProductionContent,type LegacyWorkspaceSource} from './LegacyProductionSteps';
import type {EpisodeProductionSnapshot} from '../episodes/episodeSnapshot';
import {WorkspaceScriptPanel} from './WorkspaceScriptPanel';
import {WorkspaceSoundIntent} from './WorkspaceSoundIntent';
import {WorkspaceShotTable} from './WorkspaceShotTable';
import type {WorkspaceShotOperation} from '../workspaceShots';
import {WorkspaceMaterialShelf} from './WorkspaceMaterialShelf';
import {workspaceUploadSessions,createWorkspaceUploadSession,readWorkspaceUploadFile,type WorkspaceUploadEntry} from './workspaceUploads';
import {WorkspaceVisualPreparation} from './WorkspaceVisualPreparation';
import {WorkspaceAudioPreparation} from './WorkspaceAudioPanel';
import {WorkspaceExportPanel} from './WorkspaceExportPanel';
import {WorkspaceNarrationPanel} from './WorkspaceNarrationPanel';
import {WorkspaceCaptionsPanel} from './WorkspaceCaptionsPanel';
import {Activity,useEffect,useId,useMemo,useRef,useState,useSyncExternalStore,type ComponentProps,type ReactNode} from 'react';
import {Check} from 'lucide-react';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import {EmbeddedStudioHost} from './EmbeddedStudioHost';
import {localRequest} from './client';
import {useWorkspaceReading,useWorkspacePolling} from './useWorkspaceReading';
import type {OpenChatCutProject} from '../worker/openchatcutProject';
import type {ProductionWorkspace} from '../productionWorkspace';
import './production-workspace.css';
import './production-compact.css';
interface Material {id:string;material_type:string;source_path:string;storage_path:string;is_main_script:boolean;material_purpose?:string}
const materialUploadSession=workspaceUploadSessions<WorkspaceUploadEntry>();
const steps=[workflowStepLabels.script,workflowStepLabels.preparation,workflowStepLabels.editing,workflowStepLabels.delivery] as const;
const operationLabels:Record<string,string>={get prepareWorkspace(){return uiText("准备分镜工程");},get replanWorkspace(){return uiText("更新分镜工程");},get openWorkspaceStudio(){return uiText("打开剪辑工作台");},get saveWorkspaceStudio(){return uiText("保存剪辑工程");},get closeWorkspaceStudio(){return uiText("结束剪辑");},get editWorkspaceStructure(){return uiText("保存镜头调整");},get adoptLegacyWorkspace(){return uiText("接续已有工程");},get resumeWorkspaceEditing(){return uiText("恢复工程编辑");},get exportWorkspace(){return uiText("导出成片");},get confirmWorkspaceExport(){return uiText("确认成片");},get prepareWorkspaceDelivery(){return uiText("生成交付包");},get retryWorkspaceDelivery(){return uiText("继续交付");},get saveWorkspaceCaptions(){return uiText("保存字幕");},get confirmWorkspaceCaptionText(){return uiText("确认字幕");},get requestWorkspaceCaptionAlignment(){return uiText("字幕校时");},get applyWorkspaceCaptionAlignment(){return uiText("采用字幕校时");},get prepareWorkspaceAudio(){return uiText("准备声音");},get adoptWorkspaceAudio(){return uiText("采用声音");},get saveWorkspaceMusicSettings(){return uiText("保存配乐设置");},get saveWorkspaceSoundIntent(){return uiText("保存声音设置");},get setWorkspaceAudioEnabled(){return uiText("切换声音");}};
export function ProductionWorkspacePanel({episodeId,title,titleActions,scriptRevisionId,boardId,materials,command,onStudioActionChange,audioTracks,legacySnapshot,historicalReadOnly=false,stage='storyboard_approved',archivedAt,notice,preparationEntry}:{preparationEntry?:{shotId?:string;targetItemId?:string};episodeId:string;title:string;titleActions?:ReactNode;scriptRevisionId:string|null;boardId?:string;materials:Material[];command:(name:string,data:unknown)=>Promise<unknown>;onLegacy:()=>void;audioTracks?:ComponentProps<typeof WorkspaceNarrationPanel>['tracks'];onStudioActionChange?:(action:(()=>void)|null)=>void;legacySnapshot?:EpisodeProductionSnapshot;historicalReadOnly?:boolean;stage?:string;archivedAt?:string|null;notice?:ReactNode}){
 const stepStatusId=useId();
 const requestDraftLeave=useWorkspaceDraftLeave();
 const navigation=useWorkspaceNavigation(episodeId);
 const navigationRef=useRef(navigation);navigationRef.current=navigation;
 const {root:workspaceRoot,canvas:workspaceCanvas}=useWorkspaceCanvas();
 const legacyContent=legacySnapshot&&hasLegacyProductionContent(legacySnapshot)?legacySnapshot:null;
 const [workspace,setWorkspace]=useState<ProductionWorkspace|null>(null),[loaded,setLoaded]=useState(false),[loadError,setLoadError]=useState(''),[loadAttempt,setLoadAttempt]=useState(0),[step,applyStep]=useState(navigation?.step?productionSteps.indexOf(navigation.step):stage==='waiting_input'?0:preparationEntry?1:legacyContent&&['qc_review','qc_passed','production_completed'].includes(stage)?3:1),[pending,setPending]=useState(false),[error,setError]=useState(''),[script,setScript]=useState(''),[loadedScriptPath,setLoadedScriptPath]=useState('');
 const [legacyPrompt,setLegacyPrompt]=useState(false);
 const [uncertainOperation,setUncertainOperation]=useState<{label:string;checked:boolean}|null>(null),[checkingOperation,setCheckingOperation]=useState(false),[operationReadError,setOperationReadError]=useState('');
 const operationRead=useRef(0),operationReadBusy=useRef(false);
 useEffect(()=>{setUncertainOperation(null);setCheckingOperation(false);setOperationReadError('');return()=>{operationRead.current++;operationReadBusy.current=false;};},[episodeId]);
 const readOnly=historicalReadOnly||!!archivedAt||stage==='production_completed';
 const [deliveryVisited,setDeliveryVisited]=useState(false);
 const studioRequested=useRef(false);
 useEffect(()=>{if(workspace&&step===3)setDeliveryVisited(true);},[workspace?.id,step]);
 const [shotToDelete,setShotToDelete]=useState<{episodeId:string;workspaceId:string;revision:number;shotId:string;text:string}|null>(null);
 const [selectedShotId,setSelectedShotId]=useState(preparationEntry?.shotId??''),[previewItemId,setPreviewItemId]=useState(preparationEntry?.targetItemId??''),[preparationTab,applyPreparationTab]=useState<'visual'|'voice'|'sound'>(navigation?.tab??'visual');
 const revealReturnedShot=useRef(false);

 function setStep(next:number){applyStep(next);navigation?.change({step:productionSteps[next]});}
 function setPreparationTab(next:'visual'|'voice'|'sound'){applyPreparationTab(next);navigation?.change({tab:next});}
 useEffect(()=>{if(navigation){const next=navigation.step?productionSteps.indexOf(navigation.step):stage==='waiting_input'?0:preparationEntry?1:stage==='production_completed'||workspace?.exports?.some(entry=>entry.current)?3:workspace?.nativeEditRevision?2:1;if(next!==step){operations.cancelOpening();applyStep(next);studioRequested.current=false;}}if(navigation)applyPreparationTab(navigation.tab);},[navigation?.step,navigation?.tab]);
 const uploadOwnerId=useWorkspaceOwnerId();
 const materialUploads=useMemo(()=>uploadOwnerId?materialUploadSession(`${uploadOwnerId}:${episodeId}`):createWorkspaceUploadSession<WorkspaceUploadEntry>(),[uploadOwnerId,episodeId]);
 const materialUploadState=useSyncExternalStore(materialUploads.subscribe,materialUploads.read);
 const materialUploadBusy=materialUploadState.running,materialUploadNotice=materialUploadState.notice;
 const [materialUploadStatus,setMaterialUploadStatus]=useState('');
 useEffect(()=>{if(materialUploadNotice&&!materialUploadBusy)setMaterialUploadStatus(materialUploadNotice.message);},[materialUploadNotice,materialUploadBusy]);
 const materialUploadFailures=materialUploadState.rows.filter(row=>row.status==='failed'||!materialUploadBusy&&row.status!=='succeeded').map(row=>`${row.name}：${row.error??'尚未导入，可重试。'}`);
 const materialUploadOwner=useMemo(()=>({active:true}),[uploadOwnerId,episodeId]);
 const activeMaterialUploadOwner=useRef(materialUploadOwner);activeMaterialUploadOwner.current=materialUploadOwner;
 useEffect(()=>{materialUploadOwner.active=true;return()=>{materialUploadOwner.active=false;};},[materialUploadOwner]);
 const [importedMaterials,setImportedMaterials]=useState<Material[]>([]);
 const allMaterials=[...materials,...importedMaterials,...materialUploadState.retainedMaterials.map(material=>({...material,is_main_script:material.is_main_script??false})),...materialUploadState.rows.flatMap(row=>row.material?[{...row.material,is_main_script:row.material.is_main_script??false}]:[])].filter((material,index,all)=>all.findIndex(known=>known.id===material.id)===index);
 useEffect(()=>{
  if(materialUploadBusy)return;
  const known=new Set(materials.map(material=>material.id));
  if(materialUploadState.retainedMaterials.some(material=>known.has(material.id))||materialUploadState.rows.some(row=>row.status==='succeeded'&&known.has(row.material?.id??'')))materialUploads.update(value=>({...value,rows:value.rows.filter(row=>row.status!=='succeeded'||!known.has(row.material?.id??'')),retainedMaterials:value.retainedMaterials.filter(material=>!known.has(material.id))}));
 },[materials,materialUploadState.rows,materialUploadState.retainedMaterials,materialUploadBusy]);
 const callConfirmation=useWorkspaceCallConfirmation(command,episodeId+':'+(workspace?.id??''),allMaterials);
 const narrationRefreshes=useRef(new Set<string>());
 const [nativeProject,setNativeProject]=useState<OpenChatCutProject|null>(null);
 const nativeProjectIdentity=useRef('');
 const current=useRef<ProductionWorkspace|null>(null),openAction=useRef<()=>Promise<void>>(async()=>{});
 const operations=useWorkspaceOperations({episodeId,readOnly,reopen:!!error,current:()=>current.current,command:run,publish:update,error:setError,recover:()=>setLoadAttempt(value=>value+1),prepared:stay=>{setLegacyPrompt(false);if(!stay)setStep(1);},opened:()=>setStep(2),closed:(destination,selection,next)=>{
  if(destination==='preparation'&&selection&&next.clips.some(clip=>clip.shotId===selection.shotId)){setSelectedShotId(selection.shotId);setPreviewItemId(selection.itemId);revealReturnedShot.current=true;}
  studioRequested.current=false;setStep(productionSteps.indexOf(destination));
 },missingSources:()=>{setError('请先为每个镜头采用可用的图片或视频，再进入剪辑工作台。');setStep(1);}});
 const {session,preparing,opening:editorOpening}=operations;
 useEffect(()=>{
  if(step!==1||session||!revealReturnedShot.current)return;
  revealReturnedShot.current=false;
  workspaceRoot.current?.querySelector('.workspace-shot-table tr[aria-selected=true]')?.scrollIntoView?.({block:'nearest',inline:'nearest'});
 },[step,session,selectedShotId]);
 const narrationReading=useWorkspaceReading(workspace,applyWorkspace,!loaded||session||readOnly||workspace?.stale||pending?'paused':'narration','无法读取当前工程版本。');
 function applyWorkspace(w:ProductionWorkspace){current.current=w;setWorkspace(w);setSelectedShotId(id=>w.clips.some(clip=>clip.shotId===id)?id:w.clips[0]?.shotId??'');}
 function update(w:ProductionWorkspace){narrationReading.observe(w);applyWorkspace(w);}
 useEffect(()=>{
  let active=true;
  const source=current.current;
  setLoaded(false);setLoadError('');
  void localRequest(`episodes/${episodeId}/workspace`).then(value=>{
   if(!active)return;
   const next=value.workspace as ProductionWorkspace|null,accepted=current.current;
   // A command may publish while this reload is waiting, including at the same revision.
   const changed=accepted!==source;
   const superseded=accepted&&next&&(next.id===accepted.id
    ? next.revision<accepted.revision||changed&&next.revision===accepted.revision
    : changed);
   if(next&&!superseded){
    if(!accepted&&!manuallySelectedStep.current&&!navigationRef.current?.step){
     const initialStep=stage==='waiting_input'?0:preparationEntry?1:stage==='production_completed'||next.exports?.some(entry=>entry.current)?3:next.nativeEditRevision?2:1;
     studioRequested.current=initialStep===2&&!navigationRef.current;applyStep(initialStep);
    }
    update(next);
   }
   setLoaded(true);
  }).catch(cause=>{if(active)setLoadError(cause instanceof Error?cause.message:'制作流程读取失败。');});
  return()=>{active=false;};
 },[episodeId,scriptRevisionId,boardId,loadAttempt]);
 useEffect(()=>{let active=true;const identity=episodeId+':'+(workspace?.id??'');if(nativeProjectIdentity.current!==identity){nativeProjectIdentity.current=identity;setNativeProject(null);}if(workspace)void localRequest(`episodes/${episodeId}/workspace/project?sha=${workspace.project.sha256}`).then(value=>{if(active){setNativeProject(value.project);}}).catch(()=>{});return()=>{active=false;};},[episodeId,workspace?.id,workspace?.project.sha256]);
 const scriptPath=materials.find(m=>m.id===scriptRevisionId)?.storage_path;
 useEffect(()=>{if(!scriptPath)return;let active=true;void fetch(`/_local-artifact?episode=${encodeURIComponent(episodeId)}&path=${encodeURIComponent(scriptPath)}`).then(async r=>{if(!r.ok)throw Error('主脚本读取失败，请检查原脚本文件。');const text=await r.text();if(active){setScript(text);setLoadedScriptPath(scriptPath);}}).catch(cause=>{if(active)setError(cause instanceof Error?cause.message:'主脚本读取失败。');});return()=>{active=false;};},[episodeId,scriptPath]);
 async function run(name:string,data:unknown,owns:()=>boolean=()=>true){if(readOnly)throw Error('归档或已完成生产单只读。');operationRead.current++;operationReadBusy.current=false;setCheckingOperation(false);setPending(true);setError('');setUncertainOperation(null);setOperationReadError('');try{return await callConfirmation.request(name,data);}catch(cause){if(!owns()||cause instanceof Error&&cause.name==='AbortError')throw cause;const message=cause instanceof Error?cause.message:'操作未完成。';if(name!=='importMaterial'&&name!=='registerWorkspaceVisualCandidate'){setError(message);if(['local_service_unavailable','LOCAL_COMMAND_OUTCOME_UNKNOWN'].includes((cause as {code?:string})?.code??''))setUncertainOperation({label:operationLabels[name]??'本次操作',checked:false});}if(message.includes('旧剪辑工作版本'))setLegacyPrompt(true);throw cause;}finally{setPending(false);}}
 async function checkSavedWorkspace(){
  if(pending||operationReadBusy.current)return;
  const request=++operationRead.current,operation=uncertainOperation;operationReadBusy.current=true;setCheckingOperation(true);setOperationReadError('');
  try{
   if(current.current)await narrationReading.read();
   else{
    const result=await localRequest(`episodes/${episodeId}/workspace`);
    if(request===operationRead.current&&!current.current&&result.workspace?.episodeId===episodeId)update(result.workspace as ProductionWorkspace);
   }
   if(request===operationRead.current)setUncertainOperation(current=>current===operation&&current?{...current,checked:true}:current);
  }catch(cause){if(request===operationRead.current&&!(cause instanceof Error&&cause.name==='AbortError'))setOperationReadError(cause instanceof Error?cause.message:'读取失败，请稍后重试。');}
  finally{if(request===operationRead.current){operationReadBusy.current=false;setCheckingOperation(false);}}
 }
 const openEditor=operations.open;
 async function resumeLegacy(source:LegacyWorkspaceSource,edit=true){const w=await run('adoptLegacyWorkspace',{episodeId,expectedScriptRevisionId:scriptRevisionId,reviewPackageId:boardId,...source}) as ProductionWorkspace;update(w);setStep(edit?2:1);if(edit)await openEditor();}
 openAction.current=openEditor;
 useEffect(()=>{if(step!==2||!loaded||!workspace||session||readOnly||pending||workspace.stale||!studioRequested.current)return;studioRequested.current=false;void openAction.current().catch(()=>{});},[step,loaded,workspace?.id,session,readOnly,pending,workspace?.stale]);
 useEffect(()=>{onStudioActionChange?.(loaded&&workspace&&!readOnly?()=>{void openAction.current().catch(()=>{});}:null);return()=>onStudioActionChange?.(null);},[loaded,workspace?.id,onStudioActionChange,readOnly]);
 const narrationPollingError=useWorkspacePolling(narrationReading,{
  enabled:loaded&&!!workspace&&!session&&!workspace.stale&&!readOnly&&!pending,interval:3000,immediate:true,
  async load(value){
   const eligible=value.narration?.filter(n=>n.enabled!==false&&n.mode!=='none'&&(n.taskId&&['ready','running'].includes(n.status)||n.audioTrackId&&!n.adoptedAudioTrackId&&!narrationRefreshes.current.has(n.inputFingerprint+n.audioTrackId)));
   if(!eligible?.length)throw Object.assign(Error('没有待更新的口播。'),{name:'AbortError'});
   for(const narration of eligible)if(narration.audioTrackId)narrationRefreshes.current.add(narration.inputFingerprint+narration.audioTrackId);
   return command('refreshWorkspaceNarration',{episodeId,workspaceId:value.id,expectedRevision:value.revision}) as Promise<ProductionWorkspace>;
  },
 });
 const displayedError=error||narrationPollingError?.message||'';
 async function prepare(legacyDecision?:'preserve'|'fresh',confirmedScriptId=scriptRevisionId,revisionReason?:string,stayOnCurrentStep=false){
  if(confirmedScriptId)await operations.prepare({scriptRevisionId:confirmedScriptId,boardId,reason:revisionReason,legacyDecision,stayOnCurrentStep});
 }
 const scriptState = useMemo(() => {
  if (!scriptPath || loadedScriptPath !== scriptPath) return {format:'unread'} as const;
  try {
   const parsed=parseStoryboardScript(script);
   return parsed ? {format:'structured',parsed} as const : {format:'plain'} as const;
  } catch { return {format:'invalid'} as const; }
 }, [script, scriptPath, loadedScriptPath]);
 const scriptFormat=scriptState.format;
 const autoPreparedScript = useRef<string | null>(null);
 useEffect(() => {
  if (step !== 1 || !loaded || scriptFormat==='unread' && Boolean(scriptPath) || !scriptRevisionId || stage === 'waiting_input' ||
      workspace || legacyContent || readOnly || pending || autoPreparedScript.current === scriptRevisionId) return;
  autoPreparedScript.current = scriptRevisionId;
  void prepare(undefined,scriptRevisionId,undefined,true).catch(() => {});
 }, [step, loaded, scriptFormat, scriptPath, scriptRevisionId, stage, workspace, legacyContent, readOnly, pending]);
 async function processMaterialUploads(rows:WorkspaceUploadEntry[]){
  if(readOnly||materialUploads.read().running)return;
  const imported:string[]=[];
  setError('');setMaterialUploadStatus('正在导入素材…');
  await materialUploads.run(rows,{
   active:()=>materialUploadOwner.active&&activeMaterialUploadOwner.current===materialUploadOwner,
   async importFile(row){
    const file=row.file!;
    if(!file.size||file.size>100*1024*1024)throw Error('文件为空或超过 100 MB。');
    const extension=file.name.split('.').pop()?.toLowerCase()??'';
    const materialType=['png','jpg','jpeg','webp','bmp'].includes(extension)?'image':['mp4','mov','webm'].includes(extension)?'video':extension==='mp3'?'audio':null;
    if(!materialType)throw Error('请选择图片、视频或 MP3。');
    const purpose=materialType==='audio'?unassignedWorkspaceAudioPurpose:'visual_reference';
    const contentBase64=await readWorkspaceUploadFile(file);
    if(!materialUploadOwner.active||activeMaterialUploadOwner.current!==materialUploadOwner)throw Object.assign(Error('上传已暂停。'),{name:'AbortError'});
    const result=await command('importMaterial',{episodeId,materialType,sourceKind:'file',sourcePath:file.name,mimeType:file.type||'application/octet-stream',contentBase64,isMainScript:false,materialPurpose:purpose}) as {id:string;storage_path:string};
    return {...result,material_type:materialType,source_path:file.name,is_main_script:false,material_purpose:purpose};
   },
   onImported:material=>{imported.push(material.id);setImportedMaterials(values=>[...values,{...material,is_main_script:false}]);},
   paused:()=> '已暂停，重试可继续。',failed:(_row,_imported,message)=>message,
   summary:(completed,unfinished)=>unfinished.length?`已导入 ${completed.length-unfinished.length} 项，${unfinished.length} 项失败`:`已导入 ${completed.length} 项素材`,
  });
  return imported;
 }
 async function uploadMaterials(files:File[]){
  if(readOnly||materialUploads.read().running||!files.length)return;
  const rows=materialUploads.enqueue(files.map(file=>({name:file.name,file})));
  return processMaterialUploads(rows);
 }

 const manuallySelectedStep=useRef(false);
 const uniqueClips=workspace?.clips.filter((clip,index,all)=>all.findIndex(c=>c.shotId===clip.shotId)===index)??[];
 const selectedShot=uniqueClips.find(clip=>clip.shotId===selectedShotId)??uniqueClips[0];
 async function editShots(operation:WorkspaceShotOperation){
  const w=current.current;if(!w||pending||readOnly||w.stale)throw Error('当前工程不可修改。');
  const next=await run('editWorkspaceStructure',{episodeId,workspaceId:w.id,expectedRevision:w.revision,operation}) as ProductionWorkspace;
  update(next);
  if(operation.kind==='insert'){const added=next.clips.find(clip=>!w.clips.some(old=>old.shotId===clip.shotId));if(added)setSelectedShotId(added.shotId);setPreviewItemId('');}
 }
 async function deleteShot(){
  if(!shotToDelete||pending||readOnly)return;
  try{const next=await run('editWorkspaceStructure',{episodeId:shotToDelete.episodeId,workspaceId:shotToDelete.workspaceId,expectedRevision:shotToDelete.revision,operation:{kind:'remove',shotId:shotToDelete.shotId}}) as ProductionWorkspace;
   const index=uniqueClips.findIndex(c=>c.shotId===shotToDelete.shotId),remaining=next.clips.filter((c,i,all)=>all.findIndex(v=>v.shotId===c.shotId)===i);update(next);setSelectedShotId(remaining[Math.min(Math.max(0,index),remaining.length-1)]?.shotId??'');setPreviewItemId('');setShotToDelete(null);
  }catch{/* run presents the failure inside the confirmation dialog. */}
 }
 const visualReady=uniqueClips.filter(shot=>workspace?.clips
  .filter(clip=>clip.shotId===shot.shotId)
  .every(clip=>workspaceShotSource(clip,nativeProject)&&!workspace.readiness.placeholders.includes(clip.itemId))).length;
 const pendingVoices=workspace?.narration?.filter(n=>n.enabled!==false&&n.mode!=='none'&&!n.adoptedAudioTrackId).length??0;
 const scriptConfirmed=!!scriptRevisionId&&stage!=='waiting_input',delivered=!!workspace?.deliveries?.some(d=>d.verified),exportConfirmed=!!workspace?.exports?.[0]?.confirmed;
 const confirmedSteps=[scriptConfirmed,false,false,delivered||exportConfirmed];
 const stepSummaries=[scriptConfirmed?'已确认':'待确认',workspace?`${uniqueClips.length-visualReady+pendingVoices} 项待准备`:'尚未准备',readOnly?'只读':workspace?.captions?.length?workspace.captions.every(c=>!c.contract.enabled||c.timing==='current')?'可剪辑':'字幕待校时':'待剪辑',delivered?'已交付':exportConfirmed?'已确认':'待确认'];
 const selectedSegment=scriptState.format==='structured'&&workspace?.scriptRevisionId===scriptRevisionId?scriptState.parsed.segments.find(segment=>segment.id===selectedShot?.shotId):undefined;
 const selectedClips=workspace?.clips.filter(clip=>clip.shotId===selectedShot?.shotId)??[];
 const selectedPreview=selectedClips.find(clip=>clip.itemId===previewItemId)??selectedClips[0];
 return <>
  <section ref={workspaceRoot} data-compact-workflow className={`production-workspace${session?' is-editing':''}`} aria-label={uiText("四步制作工作流")}>
   <header className="production-workspace-title">{(title?.trim()||readOnly)&&<div className="production-workspace-heading">{title?.trim()&&<h2>{title}</h2>}{readOnly&&<span>{historicalReadOnly?uiText("历史只读"):stage==='production_completed'?uiText("制作已完成"):uiText("已归档")}</span>}</div>}
   <nav aria-label={uiText("四步制作步骤")}>{steps.map((label,index)=><button key={label} aria-label={step===index?uiText("{value0}，当前查看",{value0:uiText(label)}):uiText(label)} aria-describedby={`${stepStatusId}-${index}`} aria-current={step===index?'page':undefined} data-complete={loaded&&confirmedSteps[index]||undefined} disabled={!!session||editorOpening} onClick={()=>{if(index!==step)requestDraftLeave(()=>{manuallySelectedStep.current=true;studioRequested.current=index===2;setStep(index);});}}><span aria-hidden="true">{loaded&&confirmedSteps[index]?<Check size={14} strokeWidth={2.5}/>:index+1}</span>{uiText(label)}<small id={`${stepStatusId}-${index}`}>{loaded?uiText(stepSummaries[index]):loadError?uiText("读取失败"):uiText("读取中")}</small></button>)}</nav>{titleActions&&<div className="production-workspace-title-actions">{titleActions}</div>}</header>
   {notice}{displayedError&&!notice&&!shotToDelete&&(uncertainOperation?<div role="alert" className="workspace-operation-error workspace-uncertain-operation"><div><strong>{uiText(uncertainOperation.label)}{uiText("结果暂未确认")}</strong><p>{uncertainOperation.checked?uiText("已重新读取当前工程，原操作是否完成仍未确认。请核对已有任务和保存结果。"):uiText("可能已提交，暂未取得可确认的回执。请先核对已保存工程和系统状态，不会自动重复提交。")}</p>{operationReadError&&<p>{uiText(operationReadError||'')}</p>}</div><Button size="sm" color="secondary" isDisabled={pending||checkingOperation} aria-busy={checkingOperation} onPress={()=>void checkSavedWorkspace()}>{checkingOperation?uiText("读取中…"):uiText("重新读取已保存工程")}</Button></div>:<p role="alert" className="workspace-operation-error">{uiText(displayedError||'')}</p>)}{legacyPrompt&&!readOnly&&<section className="production-workspace-section workspace-legacy-choice" aria-label={uiText("旧剪辑工作版本处理")}><Button size="sm" color="primary" isDisabled={pending} onPress={()=>void prepare('preserve').catch(()=>{})}>{uiText("保留旧编辑并继续")}</Button><Button size="sm" color="secondary" isDisabled={pending} onPress={()=>void prepare('fresh').catch(()=>{})}>{uiText("封存旧工程并建立初稿")}</Button></section>}
   {!loaded&&!loadError&&<p role="status">{uiText("正在读取制作流程…")}</p>}{loadError&&<div role="alert"><p>{uiText(loadError||'')}</p><Button size="sm" color="secondary" onPress={()=>setLoadAttempt(value=>value+1)}>{uiText("重新读取制作流程")}</Button></div>}
   {workspace?.stale&&!readOnly&&stage==='waiting_input'&&<section className="production-workspace-section workspace-replan-notice" aria-label={uiText("恢复原工程")}><p role="status">{workspace.scriptResume?.reason??uiText("脚本修改待确认，原工程已暂停编辑。请先确认脚本，原工程与素材均已保留。")}</p>{workspace.scriptResume?.canReuse?<Button size="sm" color="primary" isDisabled={pending} onPress={()=>{const w=current.current!;void run('resumeWorkspaceEditing',{episodeId,workspaceId:w.id,expectedRevision:w.revision,expectedScriptRevisionId:scriptRevisionId,expectedProjectSha256:w.project.sha256}).then(v=>{update(v as ProductionWorkspace);setStep(1);}).catch(()=>{});}}>{uiText("确认排版修订，继续原工程")}</Button>:<Button size="sm" color="secondary" onPress={()=>requestDraftLeave(()=>setStep(0))}>{uiText("核对脚本")}</Button>}</section>}
   {workspace?.stale&&!readOnly&&stage!=='waiting_input'&&!preparing&&<section className="production-workspace-section workspace-replan-notice"><p role="status">{uiText("脚本已更新，原工程与媒体已保留。")}</p>{error&&!legacyPrompt&&<Button size="sm" color="secondary" isDisabled={pending} onPress={()=>void prepare(undefined,scriptRevisionId,undefined,true).catch(()=>{})}>{uiText("重试")}</Button>}</section>}
   <fieldset hidden={!loaded} ref={workspaceCanvas} disabled={readOnly&&!workspace&&!legacyContent} className="production-workspace-body"><div hidden={step!==0||!!session}><WorkspaceScriptPanel errorPresented={!!notice||!!error} episodeId={episodeId} scriptRevisionId={scriptRevisionId} script={script} stage={stage} readOnly={readOnly} pending={pending||!loaded||!!scriptPath&&loadedScriptPath!==scriptPath} command={run} onConfirmed={(confirmedScriptId,revisionReason)=>{setStep(1);if(confirmedScriptId&&!legacyContent){autoPreparedScript.current=confirmedScriptId;void prepare(undefined,confirmedScriptId,revisionReason,true).catch(()=>{});}}}/></div>{!loaded||step===0&&!session?null:!workspace&&legacyContent?(step===1?<LegacyPreparation key={episodeId} snapshot={legacyContent} onResume={source=>resumeLegacy(source,false)} pending={pending} readOnly={readOnly}/>:step===2?<LegacyEditing key={episodeId} snapshot={legacyContent} onResume={resumeLegacy} pending={pending} readOnly={readOnly}/>:<LegacyDelivery key={episodeId} snapshot={legacyContent}/>):!workspace&&step!==1?<section className="production-workspace-section"><h3>{uiText(steps[step])}</h3><p>{step===2?uiText("尚未建立剪辑工程。"):uiText("尚无导出或交付文件。")}</p><Button size="sm" color="secondary" onPress={()=>requestDraftLeave(()=>setStep(step===2?1:2))}>{step===2?uiText("前往分镜台"):uiText("前往剪辑工作台")}</Button></section>:step===1&&preparing?<div className="workspace-script-analysis" role="status"><span aria-hidden="true"/>{uiText("正在分析脚本并拆分镜头…")}</div>:!workspace?<section className="production-workspace-section"><h3>{uiText(steps[step])}</h3>{!scriptRevisionId||stage==='waiting_input'?<p>{uiText("请先确认脚本。")}</p>:error&&!readOnly&&!legacyPrompt?<Button size="sm" color="secondary" isDisabled={pending} onPress={()=>void prepare(undefined,scriptRevisionId,undefined,true).catch(()=>{})}>{uiText("重试")}</Button>:null}</section>:
   session?<EmbeddedStudioHost initialShotId={selectedShot?.shotId} initialItemId={selectedPreview?.itemId} key={session.launchId} episodeId={episodeId} title={title} session={session} shots={workspace.clips.filter((clip,index,all)=>all.findIndex(c=>c.shotId===clip.shotId)===index).map(c=>({id:c.shotId,text:c.text,soundIntent:c.soundIntent}))}  captionEditor={workspace.captions?.some(caption=>caption.contract.enabled)
    ?bridge=><WorkspaceCaptionsPanel workspace={workspace} command={run} onChange={update} bridge={bridge} alignmentOnly/>
    :undefined} onSave={file=>operations.save(session,file)} onClose={(destination,selection)=>operations.close(session,destination,selection)}/> :step===1?<section className="production-workspace-section workspace-preparation"><header><div className="workspace-preparation-heading"><h3>{uiText(workflowStepLabels.preparation)}</h3><span>{visualReady} / {uniqueClips.length}{uiText(" 画面就绪")}</span></div><div><Button size="sm" color="primary" isDisabled={pending||readOnly||workspace.stale} onPress={()=>void openEditor().catch(()=>{})}>{uiText("进入剪辑工作台")}</Button></div></header><WorkspaceMaterialSelectionProvider key={episodeId} materials={allMaterials}><WorkspacePreparationLayout><section className="workspace-shot-table-pane" aria-label={uiText("素材镜头列表")}><WorkspaceShotTable readOnly={readOnly} workspace={workspace} project={nativeProject} materials={allMaterials} selectedShotId={selectedShot?.shotId} disabled={pending||readOnly||workspace.stale} onSelect={setSelectedShotId} onDelete={clip=>{setError('');setShotToDelete({episodeId,workspaceId:workspace.id,revision:workspace.revision,shotId:clip.shotId,text:clip.text});}} onEdit={editShots}/><WorkspaceMaterialShelf episodeId={episodeId} scriptRevisionId={scriptRevisionId} shotCount={uniqueClips.length} materials={allMaterials}
    readOnly={readOnly} busy={pending||materialUploadBusy} status={materialUploadStatus} notice={materialUploadNotice} onDismissNotice={id=>materialUploads.update(value=>value.notice?.id===id?{...value,notice:undefined}:value)}
    failures={materialUploadFailures} onAbandon={()=>{if(!readOnly&&!pending)materialUploads.abandon();}} onRetry={()=>void processMaterialUploads(materialUploads.read().rows.filter(row=>row.status!=='succeeded'))} onImport={uploadMaterials}/></section><aside className="workspace-preparation-detail"><div className="workspace-detail-tabs" role="tablist" aria-label={uiText("素材设置")}>{([['visual','画面'],['voice','字幕与口播'],['sound','配乐与声音']] as const).map(([id,label])=><button key={id} id={`preparation-tab-${id}`} type="button" role="tab" aria-selected={preparationTab===id} aria-controls={`preparation-panel-${id}`} tabIndex={preparationTab===id?0:-1} onClick={()=>setPreparationTab(id)} onKeyDown={event=>{const ids=['visual','voice','sound'] as const,index=ids.indexOf(id);const next=event.key==='ArrowRight'?ids[(index+1)%3]:event.key==='ArrowLeft'?ids[(index+2)%3]:event.key==='Home'?ids[0]:event.key==='End'?ids[2]:null;if(next){event.preventDefault();setPreparationTab(next);requestAnimationFrame(()=>document.getElementById(`preparation-tab-${next}`)?.focus());}}}>{uiText(label)}</button>)}</div><div role="tabpanel" id="preparation-panel-visual" aria-labelledby="preparation-tab-visual" hidden={preparationTab!=='visual'}><section className="workspace-visual-replacement" aria-label={uiText("上传与生成画面")}>{selectedSegment?.visual&&<p><strong>{uiText("画面提示")}</strong> {selectedSegment.visual}</p>}<WorkspaceVisualPreparation workspace={workspace} command={run} onChange={update} materials={allMaterials} selectedShotId={selectedShot?.shotId} selectedTargetItemId={selectedPreview?.itemId} onTargetChange={setPreviewItemId} readOnly={readOnly} project={nativeProject} currentVisualPath={selectedPreview?workspaceShotSource(selectedPreview,nativeProject)?.relativePath:undefined} currentVisualSha256={selectedPreview?workspaceShotSource(selectedPreview,nativeProject)?.sha256:undefined} currentMaterialRevisionId={allMaterials.find(m=>m.storage_path===(selectedPreview?workspaceShotSource(selectedPreview,nativeProject)?.relativePath:undefined))?.id??workspace.visualCandidates?.find(c=>c.relativePath===(selectedPreview?workspaceShotSource(selectedPreview,nativeProject)?.relativePath:undefined))?.materialRevisionId} currentVisualKind={selectedPreview?workspaceShotSource(selectedPreview,nativeProject)?.kind:undefined} preview={<WorkspaceShotPreview readOnly={readOnly} workspace={workspace} clips={selectedClips} selectedItemId={selectedPreview?.itemId} onSelect={setPreviewItemId} project={nativeProject} materials={allMaterials}/>} onImported={material=>setImportedMaterials(rows=>[...rows,{...material,is_main_script:false}])}/></section></div><div role="tabpanel" id="preparation-panel-voice" aria-labelledby="preparation-tab-voice" hidden={preparationTab!=='voice'}><fieldset className="workspace-readonly-fields"><WorkspaceNarrationPanel onImportAudio={uploadMaterials} active={preparationTab==='voice'} readOnly={readOnly} narrationConfiguration={(legacySnapshot?.blueprint?.policy&&typeof legacySnapshot.blueprint.policy==='object'&&!Array.isArray(legacySnapshot.blueprint.policy)?legacySnapshot.blueprint.policy.narration:undefined)} episodeId={episodeId} workspace={workspace} pending={pending||materialUploadBusy||readOnly} command={run} onChanged={update} tracks={audioTracks} materials={allMaterials} defaultSettings={{voice:legacySnapshot?.episode.tts_voice??null,speakingRate:legacySnapshot?.episode.tts_speaking_rate??null,languageCode:legacySnapshot?.episode.tts_language_code??null}} selectedShotId={selectedShot?.shotId}/></fieldset></div><div role="tabpanel" id="preparation-panel-sound" aria-labelledby="preparation-tab-sound" hidden={preparationTab!=='sound'}><fieldset className="workspace-readonly-fields"><WorkspaceAudioPreparation readOnly={readOnly} workspace={workspace} selectedShotId={selectedShot?.shotId} command={run} onChange={update} materials={allMaterials} project={nativeProject}/></fieldset>{readOnly&&selectedShot&&<WorkspaceSoundIntent key={selectedShot.shotId} workspace={workspace} shot={selectedShot} pending={pending} readOnly={readOnly} command={run} onChange={update}/>}</div></aside></WorkspacePreparationLayout></WorkspaceMaterialSelectionProvider></section>:step===2&&!readOnly?<section className="production-workspace-section workspace-editing-opening" aria-label={uiText("剪辑工作台连接")}><p role="status">{editorOpening?uiText("正在打开剪辑工作台…"):workspace.stale?uiText("脚本基准已变化，请先核对素材。"):uiText("剪辑工作台尚未连接。")}</p>{!editorOpening&&<Button size="sm" color="primary" isDisabled={pending||workspace.stale} onPress={()=>void openEditor().catch(()=>{})}>{uiText("重试打开剪辑工作台")}</Button>}</section>:step===2?<section className="production-workspace-section workspace-editing-entry is-readonly"><header><div><h3>{stage==='production_completed'?uiText("已完成工程"):uiText("工程查看")}</h3><p>{stage==='production_completed'?uiText("当前工程已交付，按镜头查看成片与已保存配置。"):uiText("当前工程只读，按镜头查看已保存配置。")}</p></div>{workspace.exports?.some(entry=>entry.artifact)&&<Button size="sm" color="secondary" onPress={()=>setStep(3)}>{uiText("查看成片与交付")}</Button>}</header><WorkspaceCompletedShots workspace={workspace} project={nativeProject} materials={allMaterials}/></section>:null}
   {loaded&&workspace&&deliveryVisited&&<Activity mode={step===3&&!session?'visible':'hidden'}><div hidden={step!==3||!!session}><WorkspaceExportPanel workspace={workspace} pending={pending} readOnly={readOnly} command={run} onChange={update}/></div></Activity>}
   </fieldset>
   <ConfirmationModalPresence>{shotToDelete&&<ConfirmationModal title={uiText("删除镜头")} confirmLabel={uiText("确认删除镜头")} pendingLabel={uiText("正在删除…")} tone="danger" isPending={pending} onCancel={()=>{setShotToDelete(null);setError('');}} onConfirm={deleteShot}><p>{uiText("删除 ")}{shotToDelete.shotId}{uiText(" 及其画面、声音和字幕引用，后续镜头会依次前移。原素材文件和历史工程保留。")}</p><p>{shotToDelete.text}</p>{error&&<p role="alert" className="form-error">{uiText(error||'')}</p>}</ConfirmationModal>}</ConfirmationModalPresence>

  {callConfirmation.dialog}</section>
 </>;
}
