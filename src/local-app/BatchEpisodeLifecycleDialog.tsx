import {useEffect,useId,useRef,useState} from 'react';
import {uiText} from '../i18n/ui';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import {InputBase} from '../ui/dan-ui/components/base/input/input';
import {EpisodeBatchDialog,EpisodeBatchImpact,EpisodeBatchResults,type EpisodeBatchAction,type EpisodeBatchActionContext,type EpisodeBatchItemResult} from '../workspace/EpisodeBatch';
import {localCommand} from './client';
import {episodeBatchLifecycleCommand,type EpisodeBatchLifecycleAction,type EpisodeBatchLifecycleInput} from './episodeBatchLifecycleTypes';
import './episode-batch-lifecycle.css';

const labels={
 rename:{title:'批量改名',confirm:'确认改名'},
 archive:{title:'批量归档',confirm:'确认归档'},
 unarchive:{title:'批量取消归档',confirm:'确认取消归档'},
} as const;
const ruleGroups=[
 {label:'前缀与后缀',fields:[['prefix','添加前缀'],['suffix','添加后缀']]},
 {label:'查找与替换',fields:[['find','查找文本'],['replace','替换为']]},
] as const;
const emptyRules={prefix:'',suffix:'',find:'',replace:''};
type RenameRules=typeof emptyRules;
type Selection=EpisodeBatchActionContext['selection'];
type ItemResult=EpisodeBatchItemResult&{uncertain?:boolean};

function proposeTitle(original:string,{prefix,suffix,find,replace}:RenameRules){
 return (prefix+(find?original.split(find).join(replace):original)+suffix).trim();
}

function RenamePreview({selection,generated,edits,onEdit,locked}:{selection:Selection;generated:ReadonlyMap<string,string>;edits:ReadonlyMap<string,string>;onEdit:(id:string,title:string)=>void;locked:boolean}){
 const rowIds=useId();
 return <ul role="list" className="episode-batch-items episode-batch-title-preview">{selection.map(item=>{
  const id=rowIds+'-'+item.id;
  const value=edits.get(item.id)??generated.get(item.id)??'';
  return <li key={item.id}>
   <div><span>{uiText('原名')}</span><strong>{item.title}</strong></div>
   <label htmlFor={id}><span>{uiText('新标题')}</span>
    <InputBase id={id} name="newTitle" size="sm" aria-label={uiText('新标题 · {title}',{title:item.title})}
     value={value} onChange={event=>onEdit(item.id,event.target.value)} isDisabled={locked}/>
   </label>
  </li>;
 })}</ul>;
}

function BatchEpisodeLifecycleDialog({selection,onClose,onChanged,action}:EpisodeBatchActionContext&{action:EpisodeBatchLifecycleAction}){
 const headingId=useId(),ruleId=useId();
 const [rules,setRules]=useState(emptyRules);
 const [preview,setPreview]=useState<{rules:RenameRules;titles:Map<string,string>}|null>(null);
 const [edits,setEdits]=useState(new Map<string,string>());
 const [results,setResults]=useState(new Map<string,ItemResult>());
 const [busy,setBusy]=useState(false),[refreshFailed,setRefreshFailed]=useState(false);
 const [progress,setProgress]=useState({processed:0,total:0});
 const running=useRef(false),active=useRef(false);
 useEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);

 const failed=selection.filter(item=>results.get(item.id)?.status==='failed');
 const editableFailures=failed.filter(item=>!results.get(item.id)?.uncertain);
 const targets=results.size?failed:selection;
 const previewCurrent=preview?.rules===rules;
 const rename=action==='rename';
 const alreadyArchived=action==='archive';

 function makePreview(){
  setPreview({rules,titles:new Map(selection.map(item=>[item.id,proposeTitle(item.sourceTitle,rules)]))});
 }

 function edit(id:string,title:string){
  setEdits(current=>new Map(current).set(id,title));
 }

 async function apply(){
  if(running.current||!targets.length||(rename&&!previewCurrent))return;
  running.current=true;
  setBusy(true);
  setRefreshFailed(false);
  setProgress({processed:0,total:targets.length});
  try{
   const nextResults=new Map(results);
   let changed=false;
   for(const [index,item] of targets.entries()){
    if(!active.current)return;
    const input:EpisodeBatchLifecycleInput=action==='rename'
     ? {episodeId:item.id,action,expectedTitle:item.sourceTitle,title:(edits.get(item.id)??preview?.titles.get(item.id)??'').trim()}
     : {episodeId:item.id,action};
    let result:ItemResult;
    try{
     result=await localCommand<EpisodeBatchItemResult>(episodeBatchLifecycleCommand,input,undefined,'episode-lifecycle');
     changed ||= result.status==='success';
    }catch(error){
     const uncertain=(error as {code?:string})?.code==='LOCAL_COMMAND_OUTCOME_UNKNOWN';
     result={episodeId:item.id,status:'failed',uncertain,reason:uncertain
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

 return <EpisodeBatchDialog compact={!rename} title={uiText(labels[action].title)} busy={busy} onClose={onClose} footer={targets.length>0&&
  <Button type="button" color="primary" size="sm" isDisabled={busy||(rename&&!previewCurrent)} onPress={()=>void apply()}>
   {uiText(results.size?'只重试失败项':labels[action].confirm)}
  </Button>
 }>
  {rename&&!results.size&&<>
   <p>{uiText('改名只更新显示标题，生产单目录和文件留在原位置。')}</p>
   <form className="episode-batch-title-rules" aria-labelledby={headingId} onSubmit={event=>{event.preventDefault();makePreview();}}>
    <h3 id={headingId}>{uiText('改名规则')}</h3>
    {ruleGroups.map(({label,fields})=><fieldset key={label}>
     <legend>{uiText(label)}</legend>
     <div>{fields.map(([key,label])=><label htmlFor={ruleId+'-'+key} key={key}><span>{uiText(label)}</span>
      <InputBase id={ruleId+'-'+key} name={key} size="sm" value={rules[key]} isDisabled={busy} onChange={event=>setRules({...rules,[key]:event.target.value})}/>
     </label>)}</div>
    </fieldset>)}
    <Button type="submit" size="sm" color="secondary" isDisabled={busy}>{uiText('预览新标题')}</Button>
   </form>
  </>}
  {rename&&preview&&(!results.size||(!busy&&editableFailures.length>0))&&
   <RenamePreview selection={results.size?editableFailures:selection} generated={preview.titles} edits={edits} onEdit={edit} locked={busy||!previewCurrent}/>
  }
  {!rename&&!results.size&&<>
   <p>{uiText(action==='archive'?'归档后从未归档列表移出，保留数据和文件。':'取消归档后重新出现在未归档列表。')}</p>
   <EpisodeBatchImpact affected={selection.filter(item=>item.archived!==alreadyArchived)}
    excluded={selection.filter(item=>item.archived===alreadyArchived).map(item=>({item,reason:alreadyArchived?'已归档':'未归档'}))}/>
  </>}
  {busy&&<p role="status">{uiText('已处理 {count} / {total} 张',{count:progress.processed,total:progress.total})}</p>}
  {refreshFailed&&<p role="alert">{uiText('操作结果已记录，列表读取失败。')}</p>}
  {!!results.size&&<div className="episode-batch-results" aria-live="polite"><EpisodeBatchResults selection={selection} results={[...results.values()]}/></div>}
 </EpisodeBatchDialog>;
}

export const episodeBatchLifecycleActions:readonly EpisodeBatchAction[]=(['rename','archive','unarchive'] as const).map(action=>({
 id:action,get label(){return uiText(labels[action].title);},
 render:context=><BatchEpisodeLifecycleDialog {...context} action={action}/>,
}));
