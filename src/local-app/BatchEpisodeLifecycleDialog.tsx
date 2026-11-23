import {Archive,ArchiveRestore} from 'lucide-react';
import {useEffect,useRef,useState} from 'react';
import {uiText} from '../i18n/ui';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import {EpisodeBatchDialog,EpisodeBatchImpact,EpisodeBatchResults,type EpisodeBatchAction,type EpisodeBatchActionContext,type EpisodeBatchItemResult} from '../workspace/EpisodeBatch';
import {localCommand} from './client';
import {episodeBatchLifecycleCommand,type EpisodeBatchLifecycleAction,type EpisodeBatchLifecycleInput} from './episodeBatchLifecycleTypes';

const labels={
 archive:{title:'批量归档',confirm:'确认归档'},
 unarchive:{title:'批量取消归档',confirm:'确认取消归档'},
} as const;
function BatchEpisodeLifecycleDialog({selection,onClose,onChanged,action}:EpisodeBatchActionContext&{action:EpisodeBatchLifecycleAction}){
 const [results,setResults]=useState(new Map<string,EpisodeBatchItemResult>());
 const [busy,setBusy]=useState(false),[refreshFailed,setRefreshFailed]=useState(false);
 const [progress,setProgress]=useState({processed:0,total:0});
 const running=useRef(false),active=useRef(false);
 useEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);

 const failed=selection.filter(item=>results.get(item.id)?.status==='failed');
 const targets=results.size?failed:selection;
 const alreadyArchived=action==='archive';

 async function apply(){
  if(running.current||!targets.length)return;
  running.current=true;
  setBusy(true);
  setRefreshFailed(false);
  setProgress({processed:0,total:targets.length});
  try{
   const nextResults=new Map(results);
   let changed=false;
   for(const [index,item] of targets.entries()){
    if(!active.current)return;
    const input:EpisodeBatchLifecycleInput={episodeId:item.id,action};
    let result:EpisodeBatchItemResult;
    try{
     result=await localCommand<EpisodeBatchItemResult>(episodeBatchLifecycleCommand,input,undefined,'episode-lifecycle');
     changed ||= result.status==='success';
    }catch(error){
     const uncertain=(error as {code?:string})?.code==='LOCAL_COMMAND_OUTCOME_UNKNOWN';
     result={episodeId:item.id,status:'failed',reason:uncertain
      ? '操作结果暂未确认。重试时会核对同一次操作。'
      : error instanceof Error?error.message:'操作未完成，请重试。'};
    }
    if(!active.current)return;
    nextResults.set(item.id,result);
    setProgress({processed:index+1,total:targets.length});
   }
   setResults(nextResults);
   if(changed&&active.current){
    try{await onChanged();}catch{if(active.current)setRefreshFailed(true);}
   }
  }finally{
   running.current=false;
   if(active.current)setBusy(false);
  }
 }

 return <EpisodeBatchDialog compact title={uiText(labels[action].title)} busy={busy} onClose={onClose} footer={targets.length>0&&
  <Button type="button" color="primary" size="sm" iconLeading={results.size?undefined:alreadyArchived?Archive:ArchiveRestore} isDisabled={busy} onPress={()=>void apply()}>
   {uiText(results.size?'只重试失败项':labels[action].confirm)}
  </Button>
 }>
  {!results.size&&<>
   <p>{uiText(action==='archive'?'归档后从未归档列表移出，保留数据和文件。':'取消归档后重新出现在未归档列表。')}</p>
   <EpisodeBatchImpact affected={selection.filter(item=>item.archived!==alreadyArchived)}
    excluded={selection.filter(item=>item.archived===alreadyArchived).map(item=>({item,reason:alreadyArchived?'已归档':'未归档'}))}/>
  </>}
  {busy&&<p role="status">{uiText('已处理 {count} / {total} 张',{count:progress.processed,total:progress.total})}</p>}
  {refreshFailed&&<p role="alert">{uiText('操作结果已记录，列表读取失败。')}</p>}
  {!!results.size&&<div className="episode-batch-results" aria-live="polite"><EpisodeBatchResults selection={selection} results={[...results.values()]}/></div>}
 </EpisodeBatchDialog>;
}

export const episodeBatchLifecycleActions:readonly EpisodeBatchAction[]=(['archive','unarchive'] as const).map(action=>({
 id:action,get label(){return uiText(labels[action].title);},
 render:context=><BatchEpisodeLifecycleDialog {...context} action={action}/>,
}));
