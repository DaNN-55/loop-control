import {useState} from 'react';
import type {Database} from '../lib/database.types';
import type {PlanningSelection,PlanningSelectionDraft} from '../planningSelection';
import {StageConfigurationDialog,PromptVersionManager} from '../platform/ConfigurationForms';
import {InputBase} from '../ui/dan-ui/components/base/input/input';
import {Checkbox} from '../ui/dan-ui/components/base/checkbox/checkbox';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import {localCommand} from './client';
type PromptVersion=Database['public']['Tables']['prompt_versions']['Row'];
export type WorkspacePlanningDraft=PlanningSelectionDraft&{accountId:string;promptVersions:PromptVersion[]};
export function WorkspacePlanningSelection({draft,pending,readOnly,onSave,onReload}:{draft:WorkspacePlanningDraft;pending:boolean;readOnly:boolean;onSave:(selection:PlanningSelection,revision:number)=>Promise<void>;onReload:()=>Promise<void>}){
 const [selection,setSelection]=useState<PlanningSelection>(draft.selection??{provider:'codex',adapter:'codex',model:'gpt-5.6-luna',harnessId:'',budgetCents:0,allowedTools:['read','write']});
 const [configuring,setConfiguring]=useState(false),[managing,setManaging]=useState(false),[error,setError]=useState('');
 const harness=draft.promptVersions.find(h=>h.id===selection.harnessId);
 async function save(){try{setError('');await onSave(selection,draft.revision);}catch(cause){setError(cause instanceof Error?cause.message:'规划选择未保存。');}}
 return <section className="workspace-planning-selection" aria-label="分镜规划选择">
  <div className="workspace-planning-summary"><strong>分镜规划</strong><span>Codex</span><span>{draft.selection?`${draft.selection.model} · ${draft.promptVersions.find(h=>h.id===draft.selection?.harnessId)?.name??'Harness'}`:'尚未选择'}</span><Button size="sm" color="secondary" isDisabled={pending||readOnly} onPress={()=>setConfiguring(true)}>选择规划模型</Button></div>
  {configuring?<section className="configuration-form" aria-label="规划配置"><StageConfigurationDialog inline hideFixedIdentity executor={{provider:'codex',adapter:'codex',model:selection.model,harnessId:selection.harnessId,promptVersion:harness?.slug??''}} executorKey="storyboard_planning" onClose={()=>setConfiguring(false)} onManagePromptVersions={()=>setManaging(true)} onSelectPromptVersion={h=>setSelection(s=>({...s,harnessId:h.id}))} onUpdateExecutor={(field,value)=>{if(field==='model')setSelection(s=>({...s,model:value}));}} promptVersions={draft.promptVersions} readOnly={readOnly||pending}/>
  <label>规划额度（分）<InputBase size="sm" aria-label="规划额度（分）" type="number" min={0} step={1} value={String(selection.budgetCents)} isDisabled={pending||readOnly} onChange={event=>setSelection(s=>({...s,budgetCents:Number(event.target.value)}))}/></label>
  <fieldset><legend>文件工具</legend>{['read','write'].map(tool=><Checkbox key={tool} label={tool} isSelected={selection.allowedTools.includes(tool)} isDisabled={pending||readOnly} onChange={checked=>setSelection(s=>({...s,allowedTools:checked?[...s.allowedTools,tool]:s.allowedTools.filter(t=>t!==tool)}))}/>)}</fieldset>
  <div className="configuration-actions"><Button size="sm" color="secondary" onPress={()=>setConfiguring(false)}>收起</Button><Button size="sm" color="primary" isDisabled={pending||readOnly} onPress={()=>void save().then(()=>{}).catch(()=>{})}>保存规划选择</Button></div>{error?<p role="alert" className="form-error">{error}</p>:null}</section>:null}
  {managing?<PromptVersionManager fixedCapability="storyboard_planning" isPending={pending} onClose={()=>setManaging(false)} onSelect={h=>setSelection(s=>({...s,harnessId:h.id}))} selectedVersionId={selection.harnessId} promptVersions={draft.promptVersions} onCreate={async input=>{const version=await localCommand<PromptVersion>('createPromptVersion',{accountId:draft.accountId,...input});await onReload();return version;}}/>:null}
 </section>;
}
