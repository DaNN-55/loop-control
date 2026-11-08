import {useEffect,useState} from 'react';
import {createPortal} from 'react-dom';
import type {Database} from '../lib/database.types';
import type {PlanningSelection,PlanningSelectionDraft} from '../planningSelection';
import {StageConfigurationDialog,PromptVersionManager} from '../platform/ConfigurationForms';
import {NativeSelect} from '../ui/dan-ui/components/base/select/select-native';
import './connection-planning.css';
import {InputBase} from '../ui/dan-ui/components/base/input/input';
import {Checkbox} from '../ui/dan-ui/components/base/checkbox/checkbox';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import {localCommand,localRequest} from './client';
type PromptVersion=Database['public']['Tables']['prompt_versions']['Row'];
export type WorkspacePlanningDraft=PlanningSelectionDraft&{accountId:string;promptVersions:PromptVersion[]};
export function WorkspacePlanningSelection({draft,pending,readOnly,onSave,onReload,compact=false,saved=false}:{compact?:boolean;saved?:boolean;draft:WorkspacePlanningDraft;pending:boolean;readOnly:boolean;onSave:(selection:PlanningSelection,revision:number)=>Promise<void>;onReload:()=>Promise<void>}){
 const [selection,setSelection]=useState<PlanningSelection>(draft.selection??{provider:'codex',adapter:'codex',model:'gpt-5.6-luna',harnessId:'',budgetCents:0,allowedTools:['read','write']});
 const [configuring,setConfiguring]=useState(false),[managing,setManaging]=useState(false),[error,setError]=useState('');
 const harness=draft.promptVersions.find(h=>h.id===selection.harnessId);
 async function save(){try{setError('');await onSave(selection,draft.revision);}catch(cause){setError(cause instanceof Error?cause.message:'规划选择未保存。');}}
 return <section className="workspace-planning-selection" aria-label="分镜规划选择">
  {!compact&&<div className="workspace-planning-summary"><strong>分镜规划</strong><span>Codex</span><span>{draft.selection?`${draft.selection.model} · ${draft.promptVersions.find(h=>h.id===draft.selection?.harnessId)?.name??'Harness'}`:'尚未选择'}</span><Button size="sm" color="secondary" isDisabled={pending||readOnly} onPress={()=>setConfiguring(true)}>选择规划模型</Button></div>}
  {(compact||configuring)?<section className="configuration-form" aria-label="规划配置"><StageConfigurationDialog inline hideFixedIdentity executor={{provider:'codex',adapter:'codex',model:selection.model,harnessId:selection.harnessId,promptVersion:harness?.slug??''}} executorKey="storyboard_planning" onClose={()=>setConfiguring(false)} onManagePromptVersions={()=>setManaging(true)} onSelectPromptVersion={h=>setSelection(s=>({...s,harnessId:h.id}))} onUpdateExecutor={(field,value)=>{if(field==='model')setSelection(s=>({...s,model:value}));}} promptVersions={draft.promptVersions} readOnly={readOnly||pending}/>
  <details className="connection-planning-advanced" open={!compact}><summary>额度与文件工具</summary><div className="workspace-planning-options">
  <label>规划额度（分）<InputBase size="sm" aria-label="规划额度（分）" type="number" min={0} step={1} value={String(selection.budgetCents)} isDisabled={pending||readOnly} onChange={event=>setSelection(s=>({...s,budgetCents:Number(event.target.value)}))}/></label>
  <fieldset><legend>文件工具</legend><div className="workspace-planning-tools">{['read','write'].map(tool=><Checkbox key={tool} label={tool} isSelected={selection.allowedTools.includes(tool)} isDisabled={pending||readOnly} onChange={checked=>setSelection(s=>({...s,allowedTools:checked?[...s.allowedTools,tool]:s.allowedTools.filter(t=>t!==tool)}))}/>)}</div></fieldset>
  </div></details>
  <div className="configuration-actions">{!compact&&<Button size="sm" color="secondary" onPress={()=>setConfiguring(false)}>收起</Button>}<Button size="sm" color="primary" isDisabled={pending||readOnly} onPress={()=>void save().then(()=>{}).catch(()=>{})}>保存规划选择</Button>{saved&&selection===draft.selection&&<span role="status">已保存规划配置</span>}</div>{error?<p role="alert" className="form-error">{error}</p>:null}</section>:null}
  {managing?createPortal(<div className="dan-ui product-ui"><PromptVersionManager fixedCapability="storyboard_planning" isPending={pending} onClose={()=>setManaging(false)} onSelect={h=>setSelection(s=>({...s,harnessId:h.id}))} selectedVersionId={selection.harnessId} promptVersions={draft.promptVersions} onCreate={async input=>{const version=await localCommand<PromptVersion>('createPromptVersion',{accountId:draft.accountId,...input});await onReload();return version;}}/></div>,document.body):null}
 </section>;
}

function EpisodePlanningConfiguration({episodeId}:{episodeId:string}){
 const [draft,setDraft]=useState<WorkspacePlanningDraft|null>(null);
 const [error,setError]=useState('');
 const [pending,setPending]=useState(false);
 const [attempt,setAttempt]=useState(0);
 const [saved,setSaved]=useState(false);
 const path=`episodes/${encodeURIComponent(episodeId)}/workspace`;
 async function reload(){const value=await localRequest(path);setDraft(value.planningSelection);}
 useEffect(()=>{
  let active=true;
  void localRequest(path).then(value=>{if(active)setDraft(value.planningSelection);})
   .catch(cause=>{if(active)setError(cause instanceof Error?cause.message:'无法读取规划配置。');});
  return()=>{active=false;};
 },[path,attempt]);
 async function save(selection:PlanningSelection,expectedSelectionRevision:number){
  setPending(true);setSaved(false);
  try{
   await localCommand('saveWorkspacePlanningSelection',{episodeId,selection,expectedSelectionRevision},undefined,'episode-commands');
   await reload();setSaved(true);
  }finally{setPending(false);}
 }
 return <section aria-label="本期分镜规划配置">
  {draft?<WorkspacePlanningSelection compact saved={saved} key={draft.revision} draft={draft} pending={pending} readOnly={false} onSave={save} onReload={reload}/>
   :error?<><p role="alert">{error}</p><Button size="sm" color="secondary" onPress={()=>{setError('');setAttempt(value=>value+1);}}>重新读取配置</Button></>
   :<p role="status">正在读取规划配置…</p>}
 </section>;
}

type PlanningEpisode={episodeId:string;title:string};
type PlanningEpisodePage={episodes:Array<{id:string;title:string|null;stage:string}>;page:number;total:number;pageSize:number};

export function ConnectionPlanningTable({initialEpisode}:{initialEpisode:PlanningEpisode|null}){
 const [episode,setEpisode]=useState<PlanningEpisode|null>(initialEpisode);
 const [input,setInput]=useState('');
 const [request,setRequest]=useState({query:'',page:1});
 const [results,setResults]=useState<PlanningEpisodePage|null>(null);
 const [loading,setLoading]=useState(true);
 const [error,setError]=useState('');
 useEffect(()=>{
  let active=true;
  setLoading(true);setError('');
  const query=new URLSearchParams({view:'episodes',visibility:'active',q:request.query,page:String(request.page)});
  void localRequest('catalog?'+query).then(value=>{if(active)setResults(value);})
   .catch(cause=>{if(active)setError(cause instanceof Error?cause.message:'无法读取生产单。');})
   .finally(()=>{if(active)setLoading(false);});
  return()=>{active=false;};
 },[request]);
 const options=(results?.episodes??[]).filter(item=>item.stage!=='production_completed')
  .map(item=>({value:item.id,label:`${item.title||'未命名生产单'} · ${item.id.slice(0,8)}`}));
 if(episode&&!options.some(option=>option.value===episode.episodeId))options.unshift({value:episode.episodeId,label:episode.title});
 return <section className="connection-planning" aria-label="分镜规划">
  <h2>分镜规划</h2>
  <div className="connection-planning-bar" aria-label="分镜规划配置">
    <div className="connection-planning-picker">
     <NativeSelect size="sm" label="生产单" aria-label="选择规划生产单" disabled={loading} value={episode?.episodeId??''} onChange={event=>{
      const item=options.find(option=>option.value===event.target.value);
      setEpisode(item?{episodeId:item.value,title:item.label}:null);
     }} options={[{value:'',label:loading?'正在读取生产单…':options.length?'选择生产单':'没有可选生产单'},...options]}/>
     <details><summary>搜索生产单</summary>
     <form role="search" aria-label="搜索规划生产单" onSubmit={event=>{event.preventDefault();setRequest({query:input.trim(),page:1});}}>
      <InputBase size="sm" aria-label="搜索生产单标题或编号" placeholder="搜索标题或编号" maxLength={200} value={input} onChange={event=>setInput(event.target.value)}/>
      <Button size="sm" color="secondary" type="submit">搜索</Button>
     </form>
     {results&&results.total>results.pageSize&&<div className="connection-planning-pages">
      <Button size="sm" color="tertiary" isDisabled={loading||results.page<=1} onPress={()=>setRequest({...request,page:results.page-1})}>上一页</Button>
      <span>{results.page} / {Math.ceil(results.total/results.pageSize)}</span>
      <Button size="sm" color="tertiary" isDisabled={loading||results.page*results.pageSize>=results.total} onPress={()=>setRequest({...request,page:results.page+1})}>下一页</Button>
     </div>}
     {error&&<p role="alert">{error}</p>}
     </details>
    </div>
    {episode?<EpisodePlanningConfiguration key={episode.episodeId} episodeId={episode.episodeId}/>:<p className="connection-planning-hint">选定生产单后即可配置模型和 Prompt Harness。</p>}
  </div>
 </section>;
}
