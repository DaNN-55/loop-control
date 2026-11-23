import {useEffect,useRef,useState,type ReactNode} from 'react';
import type {ProductionWorkspace} from '../productionWorkspace';
import type {StoryboardBatchResult,StoryboardBatchReview,StoryboardSpeechSettings} from '../storyboardBatch';
import {uiText} from '../i18n/ui';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import {WorkspaceNarrationToolbar} from './WorkspaceNarrationToolbar';
import {useProductionServiceCatalog} from './useProductionServiceCatalog';
import {readStoryboardSpeechDraft} from './storyboardSpeechDraft';
import {StoryboardBatchReviewDialog} from './StoryboardBatchReviewDialog';
import './storyboard-batch.css';

type Selection={selected:ReadonlySet<string>;onToggle:(id:string)=>void};
export function WorkspaceStoryboardBatch({workspace,disabled,visibleInWorkspace,command,onSubmitted,children}:{workspace:ProductionWorkspace;disabled:boolean;visibleInWorkspace:boolean;command:(name:string,data:unknown)=>Promise<unknown>;onSubmitted:()=>Promise<unknown>;children:(selection?:Selection)=>ReactNode}){
 const [active,setActive]=useState(false),[selection,setSelection]=useState(new Set<string>()),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [review,setReview]=useState<StoryboardBatchReview|null>(null),[visible,setVisible]=useState(false),[included,setIncluded]=useState(new Set<string>()),[regenerate,setRegenerate]=useState(new Set<string>()),[unknown,setUnknown]=useState(false);
 const [draftCommon,setCommon]=useState<StoryboardSpeechSettings>();
 const working=useRef(false);
 const shotIds=[...new Set(workspace.clips.map(clip=>clip.shotId))],labels=new Map(shotIds.map((id,index)=>[id,`镜头 ${String(index+1).padStart(2,'0')}`]));
 const selected=new Set(shotIds.filter(id=>selection.has(id)));
 const saved=workspace.narration?.find(n=>n.defaults)?.defaults;
 const common=draftCommon??saved??{selection:null,voice:workspace.templateInputs?.narration.voice??'',languageCode:workspace.templateInputs?.narration.languageCode??'zh-CN',speakingRate:workspace.templateInputs?.narration.speakingRate??1};
 const catalog=useProductionServiceCatalog({scope:workspace.id,active:active&&!disabled});
 const services=catalog.catalog?.groups.find(g=>g.capability==='speech')?.services??[];
 const base={episodeId:workspace.episodeId,workspaceId:workspace.id};
 useEffect(()=>{if(!visibleInWorkspace&&visible&&!working.current)setVisible(false);},[visibleInWorkspace,visible]);

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

 async function prepare(ids:string[],overrides:string[],prior?:StoryboardBatchReview){
  if(disabled||working.current||!ids.length)return;
  working.current=true;setBusy(true);setError('');setNotice('');
  try{
   const drafts=(workspace.narration??[]).flatMap(n=>{
    if(!ids.includes(n.shotId))return [];
    const draft=readStoryboardSpeechDraft(workspace,n);
    return draft?.text.trim()?[draft]:[];
   });
   const next=await command('prepareStoryboardBatch',{...base,expectedRevision:workspace.revision,kind:'speech',shotIds:ids,regenerateShotIds:overrides,drafts,...(common.selection?{common}:{})}) as StoryboardBatchReview;
   setRegenerate(new Set(overrides));setUnknown(false);publish(next,prior);
  }catch(cause){setError(cause instanceof Error?cause.message:uiText('未能核对批量口播。'));}
  finally{working.current=false;setBusy(false);}
 }

 function toggleReview(id:string){
  if(working.current||unknown||!review)return;
  const item=review.items.find(item=>item.shotId===id);
  if(item?.state==='regenerate'){
   const ids=shotIds.filter(shotId=>included.has(shotId)||shotId===id);
   void prepare(ids,ids.filter(shotId=>regenerate.has(shotId)||shotId===id),review);
  }else{
   const next=new Set(included);
   if(next.has(id))next.delete(id);else next.add(id);
   setIncluded(next);
  }
 }

 async function confirm(){
  if(disabled||working.current||!review||!included.size)return;
  working.current=true;setBusy(true);setError('');
  try{
   const next=await command('confirmStoryboardBatch',{...base,confirmationId:review.confirmationId,shotIds:[...included]}) as StoryboardBatchResult;
   setUnknown(false);
   if(next.status==='review')publish(next,review);
   else {
    setReview(null);setVisible(false);
    setNotice(uiText('已提交 {count} 个镜头',{count:next.items.length}));
    await onSubmitted().catch(()=>setError(uiText('提交已完成，暂时无法刷新镜头。')));
   }
  }catch(cause){
   setUnknown((cause as {code?:string})?.code==='LOCAL_COMMAND_OUTCOME_UNKNOWN');
   setError(cause instanceof Error?cause.message:uiText('批量口播未能提交。'));
  }finally{working.current=false;setBusy(false);}
 }

 return <>
  {visibleInWorkspace&&<div className="storyboard-batch-toolbar">
   <div className="storyboard-batch-actions">
    <Button size="sm" color="tertiary" isDisabled={disabled||busy||unknown} aria-pressed={active} onPress={()=>{setActive(value=>!value);setSelection(new Set());setCommon(undefined);setReview(null);setError('');setNotice('');}}>{uiText(active?'退出批量操作':'批量操作')}</Button>
    {active&&<>
     <Button size="sm" color="tertiary" isDisabled={disabled||busy||unknown||selected.size===shotIds.length} onPress={()=>setSelection(new Set(shotIds))}>{uiText('全选本单')}</Button>
     <Button size="sm" color="tertiary" isDisabled={disabled||busy||unknown||!selected.size} onPress={()=>setSelection(new Set())}>{uiText('清空选择')}</Button>
     <span role="status">{uiText('已选择 {count} 个镜头',{count:selected.size})}</span>
    </>}
   </div>
   {active&&<>
    <Button size="sm" color="primary" isDisabled={disabled||!selected.size} aria-busy={busy} onPress={()=>unknown&&review?setVisible(true):void prepare([...selected],[])}>{uiText(unknown?'核对原回执':'批量生成口播')}</Button>
    <details>
     <summary>{uiText('本次共用口播设置')}</summary>
     <WorkspaceNarrationToolbar mode="tts" value={common} services={services} disabled={disabled||busy||unknown} changed={false} allowManual={false} showSample={false} onMode={()=>{}} onChange={setCommon} onSave={()=>{}} onRefresh={catalog.refresh} refreshing={catalog.pending}>{null}</WorkspaceNarrationToolbar>
     {catalog.error&&<p role="alert">{uiText('无法读取语音连接。')}</p>}
    </details>
   </>}
   {notice&&<p role="status">{notice}</p>}
   {!visible&&error&&<p role="alert">{error}</p>}
  </div>}
  {children(visibleInWorkspace&&active?{selected,onToggle:id=>{if(!busy&&!unknown)toggle(id);}}:undefined)}
  {visibleInWorkspace&&visible&&review&&<StoryboardBatchReviewDialog review={review} labels={labels} selected={included} busy={busy} error={error} unknown={unknown} onToggle={toggleReview} onClose={()=>{setVisible(false);if(!unknown){setReview(null);setError('');}}} onConfirm={()=>void confirm()}/>}
 </>;
}
