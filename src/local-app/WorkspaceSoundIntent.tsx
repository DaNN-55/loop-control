import {uiText} from '../i18n/ui';
import {ChevronDown} from 'lucide-react';
import {useId,useState} from 'react';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import type {ProductionWorkspace,WorkspaceClip} from '../productionWorkspace';
import './workspace-sound-intent.css';
import './workspace-production-records.css';

export function WorkspaceSoundIntent({workspace,shot,pending,readOnly,command,onChange,value,onDraftChange,expanded=false}:{workspace:ProductionWorkspace;shot:WorkspaceClip;pending:boolean;readOnly:boolean;command:(name:string,data:unknown)=>Promise<unknown>;onChange:(workspace:ProductionWorkspace)=>void;value?:string;onDraftChange?:(value:string)=>void;expanded?:boolean}){
 const [localText,setText]=useState(shot.soundIntent??''),[error,setError]=useState(''),[saving,setSaving]=useState(false),id=useId();
 const text=value??localText;
 const changed=text.trim()!==(shot.soundIntent??'');
 async function save(){
  if(saving||pending||readOnly||workspace.stale||!changed)return;
  setSaving(true);setError('');
  try{const next=await command('saveWorkspaceSoundIntent',{episodeId:workspace.episodeId,workspaceId:workspace.id,expectedRevision:workspace.revision,expectedProjectSha256:workspace.project.sha256,shotId:shot.shotId,soundIntent:text.trim()}) as ProductionWorkspace;onChange(next);setText(next.clips.find(c=>c.shotId===shot.shotId)?.soundIntent??'');}
  catch(cause){setError(cause instanceof Error?cause.message:'音效意图未保存，请重试。');}
  finally{setSaving(false);}
 }
 const saveAction=<Button size="sm" color="secondary" title={uiText("保存声音和出现时机；查找候选后需试听并手动采用")} isDisabled={pending||saving||workspace.stale||!changed} onPress={()=>void save()}>{saving?uiText("正在保存…"):uiText("保存音效意图")}</Button>;
 const content=readOnly?<p>{shot.soundIntent||uiText("未填写。音效意图用于记录本镜需要的声音和出现时机。")}</p>:<>
  {expanded?<div className="workspace-sound-intent-heading"><label htmlFor={id}>{uiText("音效意图")}</label>{saveAction}</div>:<label htmlFor={id}>{uiText("音效意图")}</label>}
  <textarea id={id} value={text} maxLength={240} rows={2} placeholder={uiText("例如：开门时一声轻响，落在切镜点。")} disabled={pending||saving||workspace.stale} onChange={event=>{setText(event.target.value);onDraftChange?.(event.target.value);}}/>
  {!expanded&&<div><small>{uiText("记录声音和出现时机，可据此寻找候选，试听后再采用。")}</small>{saveAction}</div>}{error&&<p role="alert">{uiText(error||'')}</p>}</>;
 return expanded?<section className="workspace-sound-intent">{content}</section>:<details className="workspace-sound-intent workspace-record-disclosure" open={!!shot.soundIntent}><summary>{uiText("音效意图（可选）")}<ChevronDown className="workspace-record-chevron" size={16} aria-hidden="true"/></summary>{content}</details>;
}
