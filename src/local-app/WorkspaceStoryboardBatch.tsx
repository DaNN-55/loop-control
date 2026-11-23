import {useRef,useState,type ReactNode} from 'react';
import {ChevronDown} from 'lucide-react';
import {Dialog,DialogTrigger} from 'react-aria-components';
import {WorkspacePopover} from './WorkspacePopover';
import type {ProductionWorkspace} from '../productionWorkspace';
import type {StoryboardBatchFailure,StoryboardBatchKind,StoryboardBatchResult,StoryboardBatchReview,StoryboardSpeechSettings,StoryboardVideoSettings} from '../storyboardBatch';
import {uiText} from '../i18n/ui';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import {WorkspaceNarrationToolbar} from './WorkspaceNarrationToolbar';
import {useProductionServiceCatalog} from './useProductionServiceCatalog';
import {readStoryboardSpeechDraft} from './storyboardSpeechDraft';
import {readStoryboardVideoDraft} from './storyboardVideoDraft';
import type {VideoInputMaterial} from './WorkspaceVideoInputs';
import {episodeVisualDefaults} from './workspaceVisualDefaults';
import {StoryboardVideoBatchSettings} from './StoryboardVideoBatchSettings';
import {StoryboardBatchReviewDialog} from './StoryboardBatchReviewDialog';
import {workspaceStoryboardProgress} from './workspaceStoryboardProgress';
import './storyboard-batch.css';

type Selection={selected:ReadonlySet<string>;eligible:ReadonlySet<string>;disabled:boolean;onToggle:(id:string)=>void;onSelectAll:(checked:boolean)=>void};
export function WorkspaceStoryboardBatch({workspace,materials,disabled,visibleInWorkspace,command,onSubmitted,children}:{workspace:ProductionWorkspace;materials:VideoInputMaterial[];disabled:boolean;visibleInWorkspace:boolean;command:(name:string,data:unknown)=>Promise<unknown>;onSubmitted:()=>Promise<unknown>;children:(selection?:Selection)=>ReactNode}){
 const [retryKind,setRetryKind]=useState<StoryboardBatchKind>();
 const [active,setActive]=useState(false),[selection,setSelection]=useState(new Set<string>()),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [review,setReview]=useState<StoryboardBatchReview|null>(null),[visible,setVisible]=useState(false),[included,setIncluded]=useState(new Set<string>()),[regenerate,setRegenerate]=useState(new Set<string>()),[unknown,setUnknown]=useState(false);
 const [draftCommon,setCommon]=useState<StoryboardSpeechSettings>(),[draftVideo,setVideo]=useState<StoryboardVideoSettings>();
 const [settingsOpen,setSettingsOpen]=useState(false);
 const working=useRef(false);
 const shotIds=[...new Set(workspace.clips.map(clip=>clip.shotId))],labels=new Map(shotIds.map((id,index)=>[id,`镜头 ${String(index+1).padStart(2,'0')}`]));
 const failures:Record<StoryboardBatchKind,Map<string,string>>={speech:new Map(),video:new Map()};
 for(const id of shotIds){
  const progress=workspaceStoryboardProgress(workspace,id);
  for(const kind of ['speech','video'] as const){
   const state=progress[kind];
   if(state&&'failureTaskId' in state&&state.failureTaskId)failures[kind].set(id,state.failureTaskId);
  }
 }
 const eligible=new Set(retryKind?failures[retryKind].keys():shotIds);
 const selected=new Set(shotIds.filter(id=>selection.has(id)&&eligible.has(id)));
 const saved=workspace.narration?.find(n=>n.defaults)?.defaults;
 const common=draftCommon??saved??{selection:null,voice:workspace.templateInputs?.narration.voice??'',languageCode:workspace.templateInputs?.narration.languageCode??'zh-CN',speakingRate:workspace.templateInputs?.narration.speakingRate??1};
 const catalog=useProductionServiceCatalog({scope:workspace.id,active:active&&!disabled});
 const services=catalog.catalog?.groups.find(g=>g.capability==='speech')?.services??[];
 const videoServices=catalog.catalog?.groups.find(g=>g.capability==='video')?.services.filter(service=>service.mode==='generation')??[];
 const savedVideo=episodeVisualDefaults(workspace.id,'video') as {videoSelection?:StoryboardVideoSettings['selection'];videoSettings?:StoryboardVideoSettings['videoSettings'];videoResolution?:string;firstFrameFit?:StoryboardVideoSettings['firstFrameFit'];videoModeId?:string};
 const inheritedSelection=Object.hasOwn(savedVideo,'videoSelection')?savedVideo.videoSelection:workspace.visualTargets?.find(target=>target.defaultSelection)?.defaultSelection;
 const videoCommon=draftVideo??{selection:inheritedSelection,
  ...(inheritedSelection?.provider==='bailian'&&savedVideo.videoSettings?{videoSettings:savedVideo.videoSettings}:{}),
  ...(inheritedSelection?.provider==='minimax'&&savedVideo.videoResolution?{videoResolution:savedVideo.videoResolution}:{}),
  ...(savedVideo.firstFrameFit==='contain'||savedVideo.firstFrameFit==='cover'?{firstFrameFit:savedVideo.firstFrameFit}:{}),
  ...(typeof savedVideo.videoModeId==='string'?{videoMode:savedVideo.videoModeId}:{}),
 };
 const base={episodeId:workspace.episodeId,workspaceId:workspace.id};

 function begin(nextActive:boolean,nextRetryKind?:StoryboardBatchKind){
  setSettingsOpen(false);
  setActive(nextActive);setRetryKind(nextRetryKind);setSelection(new Set());setCommon(undefined);setVideo(undefined);setReview(null);setError('');setNotice('');
 }

 function toggle(id:string){
  setSelection(current=>{
   const next=new Set(current);
   if(next.has(id))next.delete(id);else next.add(id);
   return next;
  });
 }

 function publish(next:StoryboardBatchReview,previous?:StoryboardBatchReview){
  const merged=previous?{...next,items:previous.items.map(item=>next.items.find(result=>result.shotId===item.shotId)??(item.state==='ready'?{...item,state:'skipped' as const,reason:'本次已取消选择'}:item))}:next;
  setReview(merged);
  setIncluded(new Set(next.items.filter(item=>item.state==='ready').map(item=>item.shotId)));
  setVisible(true);
 }

 async function prepare(kind:StoryboardBatchKind,ids:string[],overrides:string[],prior?:StoryboardBatchReview){
  if(disabled||working.current||!ids.length)return;
  working.current=true;setBusy(true);setError('');setNotice('');
  try{
   const drafts=kind==='video'?ids.flatMap(id=>readStoryboardVideoDraft(workspace,id,videoCommon,materials)??[]):(workspace.narration??[]).flatMap(n=>{
    if(!ids.includes(n.shotId))return [];
    const draft=readStoryboardSpeechDraft(workspace,n);
    return draft?.text.trim()?[draft]:[];
   });
   const retryFailures:StoryboardBatchFailure[]|undefined=retryKind?ids.flatMap(id=>{
    const taskId=failures[retryKind].get(id);
    return taskId?[{shotId:id,taskId}]:[];
   }):undefined;
   if(retryFailures&&retryFailures.length!==ids.length)return;
   const next=await command('prepareStoryboardBatch',{...base,expectedRevision:workspace.revision,kind,shotIds:ids,regenerateShotIds:overrides,drafts,...(retryFailures?{retryFailures}:{}),...(kind==='video'?{common:videoCommon}:common.selection?{common}:{})}) as StoryboardBatchReview;
   setRegenerate(new Set(overrides));setUnknown(false);publish(next,prior);
  }catch(cause){setError(cause instanceof Error?cause.message:uiText(kind==='speech'?'未能核对批量口播。':'未能核对批量视频。'));}
  finally{working.current=false;setBusy(false);}
 }

 function toggleReview(id:string){
  if(working.current||unknown||!review)return;
  const item=review.items.find(item=>item.shotId===id);
  if(item?.state==='regenerate'){
   const ids=shotIds.filter(shotId=>included.has(shotId)||shotId===id);
   void prepare(review.kind,ids,ids.filter(shotId=>regenerate.has(shotId)||shotId===id),review);
  }else{
   const next=new Set(included);
   if(next.has(id))next.delete(id);else next.add(id);
   setIncluded(next);
  }
 }

 async function confirm(){
  if((disabled&&!unknown&&!workspace.stale)||working.current||!review||!included.size)return;
  working.current=true;setBusy(true);setError('');
  try{
   const next=await command('confirmStoryboardBatch',{...base,confirmationId:review.confirmationId,shotIds:[...included]}) as StoryboardBatchResult;
   setUnknown(false);
   if(next.status==='review')publish(next,review);
   else {
    setReview(null);setVisible(false);
    if(next.kind==='video')setVideo(undefined);
    if(retryKind){setSelection(new Set());setActive(false);setRetryKind(undefined);}
    setNotice(uiText('已提交 {count} 个镜头',{count:next.items.length}));
    await onSubmitted().catch(()=>setError(uiText('提交已完成，暂时无法刷新镜头。')));
   }
  }catch(cause){
   setUnknown((cause as {code?:string})?.code==='LOCAL_COMMAND_OUTCOME_UNKNOWN');
   setError(cause instanceof Error?cause.message:uiText(review.kind==='speech'?'批量口播未能提交。':'批量视频未能提交。'));
  }finally{working.current=false;setBusy(false);}
 }

 return <>
  {visibleInWorkspace&&<div className="storyboard-batch-toolbar">
   <div className="storyboard-batch-actions storyboard-batch-selection" role="group" aria-label={uiText('镜头选择')}>
    <Button size="sm" color="tertiary" isDisabled={disabled||busy||unknown} aria-pressed={active} onPress={()=>begin(!active)}>{uiText(active?'退出批量操作':'批量操作')}</Button>
    {!active&&(['speech','video'] as const).map(kind=>failures[kind].size>0&&<Button key={kind} size="sm" color="secondary" isDisabled={disabled||busy||unknown} onPress={()=>begin(true,kind)}>{uiText(kind==='speech'?'重试失败口播':'重试失败视频')}</Button>)}
    {active&&<>
     {retryKind&&<span>{uiText(retryKind==='speech'?'重试失败口播':'重试失败视频')}</span>}
     <span className="storyboard-batch-count" role="status">{uiText('已选择 {count} 个镜头',{count:selected.size})}</span>
     {unknown&&review?<Button size="sm" color="primary" onPress={()=>setVisible(true)} isDisabled={busy}>{uiText('核对原回执')}</Button>:
      <DialogTrigger isOpen={settingsOpen} onOpenChange={setSettingsOpen}>
       <Button size="sm" color="tertiary" iconTrailing={ChevronDown} isDisabled={disabled||busy}>{uiText('共用设置')}</Button>
       <WorkspacePopover className="dan-ui product-ui storyboard-batch-settings-popover" placement="bottom end" offset={6} containerPadding={12} shouldFlip>
        <Dialog aria-label={uiText('共用设置')} className="storyboard-batch-settings">
         {retryKind!=='video'&&<div className="storyboard-batch-settings-row" role="group" aria-label={uiText('本次共用口播设置')}>
          <div className="storyboard-batch-settings-fields">
           <h4>{uiText('口播')}</h4>
           <WorkspaceNarrationToolbar mode="tts" value={common} services={services} disabled={disabled||busy||unknown} changed={false} allowManual={false} showSample={false} onMode={()=>{}} onChange={setCommon} onSave={()=>{}} onRefresh={catalog.refresh} refreshing={catalog.pending}>{null}</WorkspaceNarrationToolbar>
           {catalog.error&&<p role="alert">{uiText('无法读取语音连接。')}</p>}
          </div>
          <Button size="sm" color="primary" isDisabled={disabled||busy||!selected.size} onPress={()=>{setSettingsOpen(false);void prepare('speech',[...selected],[]);}}>{uiText(retryKind?'核对重试':'批量生成口播')}</Button>
         </div>}
         {retryKind!=='speech'&&<div className="storyboard-batch-settings-row" role="group" aria-label={uiText('本次共用视频设置')}>
          <div className="storyboard-batch-settings-fields">
           <h4>{uiText('视频')}</h4>
           <StoryboardVideoBatchSettings value={videoCommon} services={videoServices} disabled={disabled||busy||unknown} onChange={setVideo} onRefresh={catalog.refresh} refreshing={catalog.pending}/>
           {catalog.error&&<p role="alert">{uiText('无法读取视频连接。')}</p>}
          </div>
          <Button size="sm" color={retryKind?'primary':'secondary'} isDisabled={disabled||busy||!selected.size} onPress={()=>{setSettingsOpen(false);void prepare('video',[...selected],[]);}}>{uiText(retryKind?'核对重试':'批量生成视频')}</Button>
         </div>}
        </Dialog>
       </WorkspacePopover>
      </DialogTrigger>}
    </>}
   </div>
   {notice&&<p role="status">{notice}</p>}
   {!visible&&error&&<p role="alert">{error}</p>}
  </div>}
  {children(visibleInWorkspace&&active?{selected,eligible,disabled:busy||unknown,onToggle:id=>{if(!busy&&!unknown&&eligible.has(id))toggle(id);},onSelectAll:checked=>{if(!disabled&&!busy&&!unknown)setSelection(new Set(checked?eligible:[]));}}:undefined)}
  {!visibleInWorkspace&&unknown&&review&&!visible&&<Button size="sm" color="primary" isDisabled={busy} onPress={()=>setVisible(true)}>{uiText('核对原回执')}</Button>}
  {visible&&review&&<StoryboardBatchReviewDialog review={review} labels={labels} selected={included} busy={busy} error={error} unknown={unknown} onToggle={toggleReview} onClose={()=>{setVisible(false);if(!unknown){setReview(null);setError('');}}} onConfirm={()=>void confirm()}/>}
 </>;
}
