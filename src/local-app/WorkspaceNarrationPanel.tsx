import {uiText} from '../i18n/ui';
import './workspace-feature-switch.css';
import {canUseWorkspaceAudioMaterial} from './workspaceAudioMaterial';
import {WorkspaceMaterialDrop} from './WorkspaceMaterialDrop';
import {needsCandidateImpactDialog,WorkspaceCandidateImpactDetails} from './WorkspaceCandidateImpact';
import {createPortal} from 'react-dom';
import {useWorkspaceCandidateReview} from './useWorkspaceCandidateReview';
import {useWorkspaceReading} from './useWorkspaceReading';
import {WorkspaceNarrationRecord} from './WorkspaceSoundRecords';
import {WorkspaceVisualTaskStatus} from './WorkspaceVisualTaskStatus';
import {workspaceTaskPresentation} from '../workspaceTaskPresentation';
import {reconcileWorkspaceOutput} from './workspaceOutputReconciliationClient';
import {restoreWorkspaceSettingsDraft,storeWorkspaceSettingsDraft,workspaceSettingsFingerprint} from './workspaceSettingsDraft';
import {localRequest} from './client';
import {WorkspaceAudioAudition} from './WorkspaceAudioAudition';
import {WorkspaceNarrationToolbar,type WorkspaceNarrationSettings} from './WorkspaceNarrationToolbar';
import {WorkspaceNarrationCaptions} from './WorkspaceNarrationCaptions';
import {Toggle} from '../ui/dan-ui/components/base/toggle/toggle';
import {useEffect,useId,useMemo,useRef,useState,useSyncExternalStore,type ReactNode} from 'react';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import {Badge} from '../ui/dan-ui/components/base/badges/badges';
import type {ProductionWorkspace,WorkspaceNarration} from '../productionWorkspace';
import type {ProductionService} from '../connections/serviceCatalog';
import {useProductionServiceCatalog} from './useProductionServiceCatalog';
import {ConfirmationModal,ConfirmationModalPresence} from '../ui/ConfirmationModal';
import {useWorkspaceOwnerId} from './WorkspaceDraft';
import {createManualNarrationSession,manualNarrationSession,type ManualNarrationEntry} from './workspaceManualNarration';
import './workspace-narration-settings.css';
interface NarrationMaterial {id:string;source_path:string;storage_path?:string;material_type:string;material_purpose?:string|null}
interface Track {id:string;track_kind:string;cue_id:string|null;source_material_revision_id?:string|null;relative_path?:string}
type Settings=WorkspaceNarrationSettings;
function compatible(s:Settings,services:ProductionService[]){const service=services.find(c=>c.connectionVersionId===s.selection?.connectionVersionId&&c.provider===s.selection?.provider&&c.adapter===s.selection?.adapter);return !!service?.executable&&service.models.includes(s.selection?.model??'')&&!!service.voiceCatalog?.[s.languageCode]?.includes(s.voice)&&s.speakingRate>=(service.constraints.speakingRate?.min??.5)&&s.speakingRate<=(service.constraints.speakingRate?.max??2);}
export function WorkspaceNarrationPanel(props:Parameters<typeof EditableWorkspaceNarrationPanel>[0]&{readOnly?:boolean}){
 return props.readOnly?<WorkspaceNarrationRecord workspace={props.workspace} selectedShotId={props.selectedShotId}/>:<EditableWorkspaceNarrationPanel {...props}/>;
}
function EditableWorkspaceNarrationPanel({episodeId,workspace,pending,command,onChanged,tracks=[],materials=[],selectedShotId,active=true,defaultSettings,narrationConfiguration,onImportAudio}:{episodeId:string;workspace:ProductionWorkspace;pending:boolean;command:(name:string,data:unknown)=>Promise<unknown>;onChanged:(w:ProductionWorkspace)=>void;tracks?:Track[];materials?:NarrationMaterial[];selectedShotId?:string;active?:boolean;defaultSettings?:{voice:string|null;speakingRate:number|null;languageCode:string|null};narrationConfiguration?:unknown;onImportAudio?:(files:File[])=>Promise<unknown>}){
 const legacy=narrationConfiguration as {credential_ref?:string;executor?:{provider:string;adapter:string;model:string}}|undefined;
 const persisted=workspace.narration?.find(n=>n.defaults)?.defaults;
 const saved=workspace.narration?.find(n=>(!selectedShotId||n.shotId===selectedShotId)&&n.selection);
 const initial:Settings=persisted??(saved?.selection?{selection:saved.selection,voice:saved.voice??'',languageCode:saved.languageCode??'zh-CN',speakingRate:saved.speakingRate??1}: {selection:legacy?.executor&&legacy.credential_ref?{capability:'speech',provider:legacy.executor.provider,adapter:legacy.executor.adapter,model:legacy.executor.model,connectionVersionId:legacy.credential_ref}:null,voice:defaultSettings?.voice??'',languageCode:defaultSettings?.languageCode??'zh-CN',speakingRate:defaultSettings?.speakingRate??1});
 const key=`loop-speech-default-draft:${workspace.id}`,[defaultDraft,setDefaultDraft]=useState(()=>({baseline:workspaceSettingsFingerprint(initial),value:restoreWorkspaceSettingsDraft(key,initial)})),[busy,setBusy]=useState(false),[error,setError]=useState(''),[tab,setTab]=useState<'voice'|'captions'>(()=>{try{return sessionStorage.getItem(`loop-narration-tab:${workspace.id}`)==='captions'?'captions':'voice';}catch{return 'voice';}});
 const settings=defaultDraft.value,defaultChanged=workspaceSettingsFingerprint(settings)!==workspaceSettingsFingerprint(initial),defaultUpdated=defaultDraft.baseline!==workspaceSettingsFingerprint(initial);
 const setSettings=(value:Settings)=>setDefaultDraft({...defaultDraft,value});
 useEffect(()=>{storeWorkspaceSettingsDraft(key,JSON.parse(defaultDraft.baseline),settings);},[key,settings,defaultDraft.baseline]);
 const catalogReading=useProductionServiceCatalog({scope:JSON.stringify([episodeId,workspace.id]),active});
 const services=catalogReading.catalog?.groups.find(g=>g.capability==='speech')?.services??[],catalogError=catalogReading.error?'无法读取语音连接。':'';
 useEffect(()=>{try{sessionStorage.setItem(`loop-narration-tab:${workspace.id}`,tab);}catch{/* Optional tab preference. */}},[workspace.id,tab]);
 useEffect(()=>{if(defaultUpdated&&workspaceSettingsFingerprint(settings)===defaultDraft.baseline)setDefaultDraft({baseline:workspaceSettingsFingerprint(initial),value:initial});},[defaultUpdated,defaultDraft.baseline,JSON.stringify(initial),JSON.stringify(settings)]);
 async function persistSettings(w=workspace){
  if(persisted&&workspaceSettingsFingerprint(settings)===workspaceSettingsFingerprint(persisted))return w;
  if(!compatible(settings,services))throw Error('请核对连接、模型、音色和语速。');
  const updated=await command('saveWorkspaceNarrationDefaults',{episodeId,workspaceId:w.id,expectedRevision:w.revision,...settings}) as ProductionWorkspace;
  setDefaultDraft({baseline:workspaceSettingsFingerprint(settings),value:settings});return updated;
 }
 async function saveDefaults(){
  setBusy(true);
  setError('');
  try{
   const updated=await persistSettings();onChanged(updated);
  }catch(e){setError(e instanceof Error?e.message:'保存未完成。');}
  finally{setBusy(false);}
 }
 const catalogFailure=catalogError&&<div className="workspace-narration-default-actions"><span role="alert">{uiText(catalogError||'')}</span><Button size="sm" color="tertiary" onPress={catalogReading.refresh}>{uiText("重试")}</Button></div>;
 const settingsFeedback=<>{catalogFailure}
  {defaultUpdated&&workspaceSettingsFingerprint(settings)!==defaultDraft.baseline&&<div className="workspace-narration-default-actions"><span role="status">{uiText("口播设置已在其他窗口更新。")}</span><Button size="sm" color="tertiary" isDisabled={pending||busy} onPress={()=>setDefaultDraft({baseline:workspaceSettingsFingerprint(initial),value:initial})}>{uiText("载入已保存设置")}</Button></div>}
  {error&&<p role="alert">{uiText(error||'')}</p>}</>;
 return <section className="workspace-narration" aria-label={uiText("逐镜口播")}>
  {workspace.narration?.map(n=><div key={n.clipId} hidden={selectedShotId!==undefined&&n.shotId!==selectedShotId}>
   <NarrationRow episodeId={episodeId} workspace={workspace} narration={n} defaults={settings} services={services} onSettings={setSettings} persistSettings={persistSettings} settingsChanged={defaultChanged} saveSettings={()=>void saveDefaults()} settingsFeedback={settingsFeedback} tab={tab} onTab={setTab}
    onImportAudio={onImportAudio} tracks={tracks} materials={materials} expanded={selectedShotId===n.shotId} pending={pending||busy} command={command} onChanged={onChanged}/>
  </div>)}
 </section>;
}

function NarrationRow({episodeId,workspace,narration:n,defaults,services,onSettings,persistSettings,settingsChanged,saveSettings,settingsFeedback,tab,onTab,tracks,materials,pending,command,onChanged,expanded,onImportAudio}:{episodeId:string;workspace:ProductionWorkspace;narration:WorkspaceNarration;defaults:Settings|null|undefined;services:ProductionService[];onSettings:(settings:Settings)=>void;persistSettings:(w?:ProductionWorkspace)=>Promise<ProductionWorkspace>;settingsChanged:boolean;saveSettings:()=>void;settingsFeedback:ReactNode;tab:'voice'|'captions';onTab:(tab:'voice'|'captions')=>void;tracks:Track[];materials:NarrationMaterial[];pending:boolean;command:(name:string,data:unknown)=>Promise<unknown>;onChanged:(w:ProductionWorkspace)=>void;expanded:boolean;onImportAudio?:(files:File[])=>Promise<unknown>}){
 const tabId=useId(),textHeadingId=useId(),audioInput=useRef<HTMLInputElement>(null);
 const adoptionTrigger=useRef<Element|null>(null);
 const key=`loop-speech-draft:${workspace.id}:${n.shotId}`;
 const savedCaption=workspace.captions?.find(c=>c.clipId===n.clipId||c.shotId===n.shotId)?.contract;
 const voiceEnabled=n.enabled??n.mode!=='none',captionEnabled=savedCaption?.enabled??true;
 const savedText=n.text;
 const [textDraft,setTextDraft]=useState<string|null>(()=>{
  try{const draft=sessionStorage.getItem(key+':text');return draft===n.text||draft===savedText?null:draft;}catch{return null;}
 });
 const text=textDraft??savedText;
 const followText=n.adoptedAudioTrackId||n.retainedAudioTrackId?(savedCaption?.contentMode==='follow_tts'?savedCaption.text:workspace.usedNarration?.find(v=>v.shotId===n.shotId)?.text??n.text):text;
 const setText=(value:string)=>setTextDraft(value);
 const [mode,setMode]=useState<WorkspaceNarration['mode']>(()=>{try{const value=sessionStorage.getItem(key+':mode');return value&&['tts','manual'].includes(value)?value as WorkspaceNarration['mode']:n.mode==='manual'?'manual':'tts';}catch{return n.mode==='manual'?'manual':'tts';}}),[busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>{try{if(textDraft===null)sessionStorage.removeItem(key+':text');else sessionStorage.setItem(key+':text',textDraft);sessionStorage.setItem(key+':mode',mode);}catch{/* Optional browser draft. */}},[key,textDraft,mode]);
 const ownerId=useWorkspaceOwnerId(),manualKey=JSON.stringify([ownerId,episodeId,workspace.id,n.shotId]);
 const manualSession=useMemo(()=>ownerId?manualNarrationSession(manualKey):createManualNarrationSession(),[manualKey]);
 const manualVisit=useMemo(()=>({active:true}),[manualSession,expanded,mode]),currentManual=useRef({session:manualSession,visit:manualVisit});
 currentManual.current={session:manualSession,visit:manualVisit};
 const manualVersion=useSyncExternalStore(manualSession.subscribe,manualSession.readVersion);
 useEffect(()=>{manualVisit.active=true;return()=>{manualVisit.active=false;};},[manualVisit]);
 const ownsManual=()=>manualVisit.active&&currentManual.current.session===manualSession&&currentManual.current.visit===manualVisit;
 const showManual=()=>manualSession.changed();
 const speechSettings:Settings=defaults??{selection:null,voice:'',languageCode:'zh-CN',speakingRate:1};
 const task=workspaceTaskPresentation(n.generationTask??{status:n.status});
 const canGenerate=compatible(speechSettings,services)&&!!text.trim()&&!task.unknown&&!task.held;
 const reader=useWorkspaceReading(workspace,onChanged,JSON.stringify([manualKey,expanded,mode]),'无法读取当前工程版本。');
 const review=useWorkspaceCandidateReview({workspace,scope:JSON.stringify([n.shotId,expanded,mode]),reader,command});
 const narrationMaterials=materials.filter(m=>m.material_type==='audio'&&canUseWorkspaceAudioMaterial(m.material_purpose,'narration'));
 const narrationTracks=tracks.filter(t=>t.track_kind==='narration');
 const uploadedTracks=narrationTracks.filter(t=>!!t.source_material_revision_id);
 useEffect(()=>{
  if(manualSession.running)return;
  const received=new Set(uploadedTracks.map(track=>track.id));
  if(manualSession.rows.some(row=>row.status==='succeeded'&&received.has(row.audioTrackId??''))){manualSession.rows=manualSession.rows.filter(row=>row.status!=='succeeded'||!received.has(row.audioTrackId??''));manualSession.changed();}
 },[manualSession,tracks,manualVersion]);
 const [manualReview,setManualReview]=useState<{projectSha256:string;audioTrackId:string;inputFingerprint:string;durationSeconds:number|null}|null>(null);
 useEffect(()=>{setManualReview(null);},[expanded,mode,text,workspace.project.sha256]);
 const base=(w=workspace)=>({episodeId,workspaceId:w.id,expectedRevision:w.revision,clipId:n.clipId});
 async function saveCaptions(contentMode:'follow_tts'|'independent',captionText?:string){
  setBusy(true);setError('');
  try{onChanged(await command('saveWorkspaceNarrationCaptions',{...base(),contentMode,...(contentMode==='independent'?{text:captionText}:n.adoptedAudioTrackId||n.retainedAudioTrackId?{}:{text})}) as ProductionWorkspace);}
  catch(e){setError(e instanceof Error?e.message:'字幕未保存。');throw e;}finally{setBusy(false);}
 }
 async function toggleEnabled(enabled:boolean){
  setBusy(true);setError('');review.cancel();
  try{onChanged(await command(tab==='voice'?'setWorkspaceNarrationEnabled':'setWorkspaceCaptionsEnabled',{...base(),enabled}) as ProductionWorkspace);}
  catch(e){setError(e instanceof Error?e.message:'开关未保存。');}finally{setBusy(false);}
 }
 function enqueueManual(ids:string[],names:string[]=[]){
  for(const [index,id]of ids.entries())if(!manualSession.rows.some(row=>row.materialId===id&&row.text===text))manualSession.rows.push({materialId:id,text,name:narrationMaterials.find(material=>material.id===id)?.source_path.split('/').pop()??names[index],stage:'save',status:'pending'});
  showManual();
 }
 async function processManual(){
  if(manualSession.running||pending||workspace.stale||mode!=='manual'||!ownsManual())return;
  manualSession.running=true;setError('');showManual();
  let currentRow:ManualNarrationEntry|undefined;
  try{
   let w=await reader.read();
   for(const row of manualSession.rows.filter(entry=>entry.status!=='succeeded')){
    if(!ownsManual())break;
    currentRow=row;row.status='running';row.error=undefined;showManual();
    if(row.stage==='save'){
     row.data??={...base(w),mode:'manual',text:row.text,materialRevisionId:row.materialId};
     const saved=await command('saveWorkspaceNarration',row.data) as ProductionWorkspace;
     row.audioTrackId=saved.narration?.find(value=>value.shotId===n.shotId)?.audioTrackId??undefined;
     row.stage='confirm';row.data={...base(saved)};
     if(!ownsManual()){row.status='pending';break;}
    }
    const saved=await command('confirmWorkspaceNarration',row.data) as ProductionWorkspace;
    row.status='succeeded';
    if(!ownsManual())break;
    reader.publish(saved);w=await reader.idle()??saved;showManual();
   }
  }catch(cause){
   if(currentRow){currentRow.status=ownsManual()?'failed':'pending';if(ownsManual())currentRow.error=cause instanceof Error?cause.message:'口播候选未完成，请重试。';}
   else if(ownsManual())setError(cause instanceof Error?cause.message:'无法读取当前工程版本。');
  }finally{manualSession.running=false;showManual();}
 }
 async function addManualMaterial(id:string){
  if(manualSession.running||pending||workspace.stale||!ownsManual())return;
  enqueueManual([id]);await processManual();
 }
 async function importAudio(files:File[]){
  if(!onImportAudio||manualSession.running||pending||workspace.stale||!ownsManual())return;
  manualSession.running=true;setError('');showManual();
  try{
   if(files.some(file=>!file.name.toLowerCase().endsWith('.mp3')))throw Error('请选择 MP3 口播文件。');
   const result=await onImportAudio(files);
   const ids=Array.isArray(result)?result.filter((id):id is string=>typeof id==='string'):[];
   enqueueManual(ids,ids.length===files.length?files.map(file=>file.name):[]);
  }catch(cause){if(ownsManual())setError(cause instanceof Error?cause.message:'音频导入未完成。');}
  finally{manualSession.running=false;showManual();}
  if(ownsManual())await processManual();
 }
 async function prepare(retryOfTaskId?:string,current=workspace){
  if(mode!=='tts'||(!canGenerate&&!retryOfTaskId))return;
  setBusy(true);setError('');
  try{
   let w=await persistSettings(current);
   w=await command('saveWorkspaceNarration',{...base(w),mode:'tts',text,...speechSettings}) as ProductionWorkspace;
   w=await command('confirmWorkspaceNarration',base(w)) as ProductionWorkspace;
   w=await command('generateWorkspaceNarration',{...base(w),retry:n.status==='failed',...(retryOfTaskId?{retryOfTaskId}:{})}) as ProductionWorkspace;
   onChanged(w);
  }catch(e){setError(e instanceof Error?e.message:'口播准备未完成。');}finally{setBusy(false);}
 }
 async function confirmManualReview(){
  if(!manualReview)return;
  setBusy(true);setError('');
  try{
   const latest=await reader.read();
   const ready=latest.narration?.find(value=>value.shotId===n.shotId);
   if(latest.project.sha256!==manualReview.projectSha256||ready?.inputFingerprint!==manualReview.inputFingerprint||ready.audioTrackId!==manualReview.audioTrackId){
    setManualReview(null);
    throw Error('工程或口播已变化，请重新核对。');
   }
   onChanged(await command('adoptWorkspaceNarration',{...base(latest),inputFingerprint:ready.inputFingerprint,audioTrackId:ready.audioTrackId}) as ProductionWorkspace);
   setManualReview(null);
  }catch(e){setError(e instanceof Error?e.message:'采用未完成。');}finally{setBusy(false);}
 }
 async function reconcile(recover=false){setBusy(true);setError('');try{if(recover&&n.generationTask)await reconcileWorkspaceOutput(episodeId,n.generationTask);onChanged((await localRequest(`episodes/${encodeURIComponent(episodeId)}/workspace`)).workspace);}catch(e){setError(e instanceof Error?e.message:'口播状态未能核对，请重试。');}finally{setBusy(false);}}
 async function retryUnknown(){
  setError('');
  try{
   const latest=await reader.read(),original=latest.narration?.find(value=>value.shotId===n.shotId)?.generationTask;
   onChanged(latest);
   if(!original?.unknownRetryAllowed)throw Error('原任务已变化，请核对最新结果。');
   await prepare(original.taskId,latest);
  }catch(cause){setError(cause instanceof Error?cause.message:'原任务未能核对。');}
 }
 async function adopt(candidateId:string,restore=false){setError('');try{await review.prepare(candidateId,restore);}catch(e){setError(e instanceof Error?e.message:'采用未完成。');}}
 async function confirmAdoption(){setError('');try{await review.confirm((changed,plan)=>{if(plan.restoration){const restored=changed.narration?.find(v=>v.shotId===n.shotId);if(restored)setText(restored.text);}});}catch(e){setError(e instanceof Error?e.message:'采用未完成。');}}
 async function withdraw(){
  setBusy(true);setError('');review.cancel();
  try{onChanged(await command('withdrawWorkspaceNarration',{...base(),audioTrackId:n.adoptedAudioTrackId}) as ProductionWorkspace);}
  catch(e){setError(e instanceof Error?e.message:'撤销未完成。');}finally{setBusy(false);}
 }
 const candidates=workspace.candidates?.filter(c=>{
  if(mode==='none'||c.kind!=='audio'||c.shotId!==n.shotId||c.status==='rejected')return false;
  const track=narrationTracks.find(t=>t.id===c.audioTrackId);
  // A newly registered upload can reach the workspace before the episode's track list refreshes.
  const uploaded=!c.speech&&(track?!!track.source_material_revision_id:narrationMaterials.some(m=>m.storage_path===c.relativePath)||n.mode==='manual'&&n.audioTrackId===c.audioTrackId||manualSession.rows.some(row=>row.audioTrackId===c.audioTrackId));
  return mode==='manual'?uploaded:!uploaded;
 })??[];
 const disabled=pending||busy||manualSession.running||review.pending||workspace.stale;
 const adoptedTrack=uploadedTracks.find(t=>t.id===n.adoptedAudioTrackId);
 const withdrawAction=<Button className="workspace-narration-withdraw" size="sm" color="tertiary-destructive" aria-label={uiText("撤销")} isDisabled={disabled} onPress={()=>void withdraw()}>{uiText("撤销")}</Button>;
 const plan=review.plan;
 const needsImpactDialog=!!plan?.restoration||needsCandidateImpactDialog(plan?.impact);
 const inlineReview=plan&&!needsImpactDialog?plan:null;
 const inlineCandidate=inlineReview&&candidates.find(c=>c.id===inlineReview.candidateId&&c.status==='available');
 const reviewSummary=inlineReview&&(inlineReview.impact.deltaSeconds===0
  ?`口播时长保持 ${inlineReview.impact.appliedSeconds.toFixed(2)} 秒`
  :`${inlineReview.impact.currentSeconds.toFixed(2)} → ${inlineReview.impact.appliedSeconds.toFixed(2)} 秒`);
 function cancelAdoption(){
  review.cancel();
  const trigger=adoptionTrigger.current;
  if(trigger instanceof HTMLElement)requestAnimationFrame(()=>trigger.focus());
 }
 const inlineActions=inlineReview&&<div className="workspace-result-actions workspace-result-confirmation" role="group" aria-label={uiText("采用前核对")}
  onKeyDown={event=>{if(event.key==='Escape'&&!review.pending&&!busy){event.stopPropagation();cancelAdoption();}}}>
  <Button autoFocus size="sm" color="secondary" isDisabled={disabled} onPress={cancelAdoption}>{uiText("取消")}</Button>
  <Button size="sm" color="primary" isDisabled={disabled} onPress={()=>void confirmAdoption()}>{uiText("确认采用")}</Button>
 </div>;
 const fields=<div className="workspace-narration-fields">
  <header className="workspace-narration-subheader">
   <div className="workspace-visual-preview-tabs" role="tablist" aria-label={uiText("字幕与口播")}>
    {([['voice','口播'],['captions','字幕']] as const).map(([value,label])=><button key={value} id={`${tabId}-${value}`} type="button" role="tab" aria-selected={tab===value} aria-controls={`${tabId}-${value}-panel`} tabIndex={tab===value?0:-1} onClick={()=>onTab(value)} onKeyDown={event=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();const next=event.key==='Home'?'voice':event.key==='End'?'captions':tab==='voice'?'captions':'voice';onTab(next);requestAnimationFrame(()=>document.getElementById(`${tabId}-${next}`)?.focus());}}}>{label}</button>)}
   </div>
   <Toggle className="workspace-feature-switch" label={(tab==='voice'?voiceEnabled:captionEnabled)?uiText("已开启"):uiText("已关闭")} size="sm" aria-label={tab==='voice'?uiText("启用口播"):uiText("启用字幕")} isSelected={tab==='voice'?voiceEnabled:captionEnabled} isDisabled={disabled} onChange={enabled=>void toggleEnabled(enabled)}/>
  </header>
  <div id={`${tabId}-captions-panel`} role="tabpanel" aria-labelledby={`${tabId}-captions`} hidden={tab!=='captions'}>
   <div hidden={!captionEnabled}><WorkspaceNarrationCaptions storageKey={`${key}:caption-text`} contract={savedCaption} followText={followText} disabled={disabled} onSave={saveCaptions}/></div>
  </div>
  <div id={`${tabId}-voice-panel`} role="tabpanel" aria-labelledby={`${tabId}-voice`} hidden={tab!=='voice'}>
  <div className="workspace-narration-voice-content" hidden={!voiceEnabled}>
  {mode==='tts'&&settingsFeedback}
  <section className="workspace-narration-text" aria-labelledby={textHeadingId}>
   <div className="workspace-generation-composer workspace-speech-composer">
    <div className="workspace-narration-editor workspace-narration-input">
    {mode==='manual'?<div className="workspace-narration-file-slot">
     <header className="workspace-caption-editor-heading"><h3 id={textHeadingId}>{uiText("人工口播")}</h3></header>
     <WorkspaceMaterialDrop label={uiText("拖入口播文件")} kind="audio" purpose="narration" surface="preview" persistent disabled={disabled}
      onSelect={id=>void addManualMaterial(id)} onBrowse={onImportAudio?()=>audioInput.current?.click():undefined} onFiles={files=>void importAudio(files)}/>
     <input ref={audioInput} aria-label={uiText("导入人工口播")} hidden type="file" multiple accept=".mp3,audio/mpeg" disabled={disabled} onChange={event=>{const files=Array.from(event.target.files??[]);event.target.value='';if(files.length)void importAudio(files);}}/>
    </div>:<><header className="workspace-caption-editor-heading"><h3 id={textHeadingId}>{uiText("口播文案")}</h3></header><textarea aria-label={uiText("口播文案")} rows={4} maxLength={100000} disabled={disabled} value={text} onChange={e=>setText(e.target.value)}/></>}
    </div>
    <WorkspaceNarrationToolbar mode={mode==='manual'?'manual':'tts'} value={speechSettings} services={services} disabled={disabled} changed={settingsChanged} onMode={setMode} onChange={onSettings} onSave={saveSettings}>
     {inlineReview&&!inlineCandidate&&<><span role="status">{reviewSummary}</span>{inlineActions}</>}
     {mode==='tts'&&<Button className="workspace-narration-primary" hidden={!!inlineReview&&!inlineCandidate} size="sm" color="primary" isDisabled={disabled||!canGenerate} onPress={event=>{adoptionTrigger.current=event.target;void prepare();}}>{busy?uiText("正在处理…"):uiText("生成口播")}</Button>}
     {mode==='manual'&&manualSession.running&&<span role="status">{uiText("正在加入口播候选…")}</span>}
    </WorkspaceNarrationToolbar>
   </div>
  </section>
  {mode==='manual'&&manualSession.rows.some(row=>row.status!=='succeeded')&&<section aria-label={uiText("人工口播登记")} className="workspace-narration-default-actions">
   {manualSession.rows.filter(row=>row.status!=='succeeded').map(row=><div key={row.materialId+row.text}>
    <span>{row.name??uiText("已导入口播")} · {row.status==='running'?uiText("正在加入候选"):row.stage==='confirm'?uiText("口播已保存，等待确认"):uiText("等待加入候选")}</span>
    {row.error&&<p role="alert">{uiText(row.error)}</p>}
   </div>)}
   {!manualSession.running&&<Button size="sm" color="secondary" isDisabled={disabled} onPress={()=>void processManual()}>{uiText("重试加入候选")}</Button>}
  </section>}
  {mode==='tts'&&!canGenerate&&
   <p className="workspace-narration-model-note" role="status">{!compatible(speechSettings,services)?uiText("请在口播设置中检查连接、音色和语速。"):!text.trim()?uiText("请填写口播文案。"):uiText("请先核对上一条口播任务。")}</p>}
  {n.adoptedAudioTrackId&&!!adoptedTrack===(mode==='manual')&&!candidates.some(c=>c.status==='adopted')&&
   <div className="workspace-speech-result-footer"><p>{uiText("已采用口播")}</p>{withdrawAction}</div>}
  {mode==='manual'&&n.mode==='manual'&&n.audioTrackId&&!candidates.some(c=>c.id===n.audioTrackId)&&n.audioTrackId!==n.adoptedAudioTrackId&&<div className="workspace-speech-result-player"><span>{uiText("已登记人工口播")}</span><Button size="sm" color="primary" isDisabled={disabled} onPress={()=>setManualReview({projectSha256:workspace.project.sha256,audioTrackId:n.audioTrackId!,inputFingerprint:n.inputFingerprint,durationSeconds:n.durationSeconds})}>{uiText("采用")}</Button></div>}
  {candidates.length>0&&<section className="workspace-speech-results" aria-label={uiText("口播候选")}>
   <div className="workspace-results-heading"><h3>{uiText("口播候选")}</h3><span>{candidates.length}{uiText(" 个")}</span></div>
   <div className="workspace-speech-results-list">
    {candidates.map(c=>{
     const confirming=inlineCandidate?.id===c.id;
     const sourceName=narrationMaterials.find(material=>material.storage_path===c.relativePath)?.source_path.split('/').pop()??manualSession.rows.find(row=>row.audioTrackId===c.audioTrackId)?.name??c.relativePath.split('/').pop();
     const label=mode==='manual'?sourceName||'人工口播':c.text;
     return <article key={c.id} className="workspace-speech-result">
      <div className="workspace-speech-result-heading" title={mode==='manual'?[label,c.text].filter(Boolean).join('\n'):c.text}>
       <div className="workspace-speech-result-copy"><p>{label}</p>{c.status==='adopted'&&<Badge type="color" color="success" size="sm" className="workspace-speech-adopted">{uiText("已采用")}</Badge>}</div>
      </div>
      <div className="workspace-speech-result-player"><WorkspaceAudioAudition layout="bar" durationSeconds={c.durationSeconds} label={label.slice(0,32)||n.shotId} showControls={false} preload="none" aria-label={uiText("{value0} {value1} 口播试听",{value0:String(n.shotId),value1:String(c.id)})}
       src={`/_local-artifact?episode=${encodeURIComponent(episodeId)}&path=${encodeURIComponent(c.relativePath)}`}/>
      <div className="workspace-speech-result-footer">
       {confirming&&<p role="status">{reviewSummary}</p>}
       {confirming&&inlineActions}
       {c.status==='available'||c.canRestoreNarration?<div hidden={confirming}>
        <Button size="sm" color="primary" aria-label={uiText("采用")} isDisabled={disabled} onPress={event=>{adoptionTrigger.current=event.target;void adopt(c.id,c.canRestoreNarration);}}>{uiText("采用")}</Button>
       </div>
        :c.status==='adopted'?<div className="workspace-result-actions">{withdrawAction}</div>:<span>{uiText("输入已变化")}</span>}
      </div>
      </div>
     </article>;
    })}
   </div>
  </section>}
  <ConfirmationModalPresence>{plan&&needsImpactDialog&&createPortal(<div className="workspace-visual-adoption-overlay">
   <ConfirmationModal title={plan.restoration?uiText("恢复口播前核对"):uiText("采用前核对")} confirmLabel={uiText("确认采用")} isPending={busy||review.pending} confirmDisabled={disabled}
    onConfirm={confirmAdoption} onCancel={cancelAdoption}>
    {plan.restoration&&<div className="workspace-candidate-impact-details">
     <div><strong>{uiText("当前正文")}</strong><p style={{whiteSpace:'pre-wrap'}}>{text||uiText("（空）")}</p></div>
     <div><strong>{uiText("恢复为")}</strong><p style={{whiteSpace:'pre-wrap'}}>{plan.restoration.restoredText||uiText("（空）")}</p></div>
    </div>}
    <div className="workspace-candidate-impact-details"><WorkspaceCandidateImpactDetails plan={plan}/></div>
   </ConfirmationModal>
  </div>,document.querySelector('.app-shell')??document.body)}</ConfirmationModalPresence>
  <ConfirmationModalPresence>{manualReview&&expanded&&createPortal(<div className="workspace-visual-adoption-overlay">
   <ConfirmationModal title={uiText("采用人工口播前核对")} confirmLabel={uiText("确认采用")} isPending={busy} confirmDisabled={disabled}
    onConfirm={confirmManualReview} onCancel={()=>setManualReview(null)}>
    {manualReview.durationSeconds!=null&&<p>{uiText("录音时长 ")}{manualReview.durationSeconds.toFixed(2)}{uiText(" 秒。")}</p>}
    <p>{uiText("采用后请核对镜头时长和字幕时序。")}</p>
    {error&&<p role="alert">{uiText(error||'')}</p>}
   </ConfirmationModal>
  </div>,document.querySelector('.app-shell')??document.body)}</ConfirmationModalPresence>
  {mode==='tts'&&n.generationTask&&<WorkspaceVisualTaskStatus task={n.generationTask} label={uiText("口播")} taskNoun={uiText("口播任务")} resumeLabel={uiText("恢复口播任务")} disabled={disabled} onRefresh={()=>void reconcile()} onReconcile={()=>void reconcile(true)} onResume={()=>{}} onRetryUnknown={(n.generationTask.unknownRetryAllowed??(task.unknown&&!task.held&&!n.generationTask.retryTaskId&&n.generationTask.submissionOutcome!=='received'&&!n.generationTask.invalidated))?()=>void retryUnknown():undefined}/>}

  </div></div>
 {(error||n.error&&!n.generationTask)&&<p role="alert">{error||n.error}</p>}
 </div>;
 return expanded?fields:<details className="workspace-narration-row">
  <summary>{n.shotId}<span>{task.held||task.unknown||task.active||task.stopped||task.state==='not-sent'?task.summary:n.durationSeconds?uiText("{value0} 秒",{value0:String(n.durationSeconds.toFixed(2))}):mode==='none'?uiText("关闭"):uiText("待准备")}</span></summary>
  {fields}
 </details>;
}
