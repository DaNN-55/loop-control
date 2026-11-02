import {useId,useState} from 'react';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import type {ProductionWorkspace,WorkspaceClip} from '../productionWorkspace';
import './workspace-sound-intent.css';

export function WorkspaceSoundIntent({workspace,shot,pending,readOnly,command,onChange}:{workspace:ProductionWorkspace;shot:WorkspaceClip;pending:boolean;readOnly:boolean;command:(name:string,data:unknown)=>Promise<unknown>;onChange:(workspace:ProductionWorkspace)=>void}){
 const [text,setText]=useState(shot.soundIntent??''),[error,setError]=useState(''),[saving,setSaving]=useState(false),id=useId();
 const changed=text.trim()!==(shot.soundIntent??'');
 async function save(){
  if(saving||pending||readOnly||workspace.stale||!changed)return;
  setSaving(true);setError('');
  try{const next=await command('saveWorkspaceSoundIntent',{episodeId:workspace.episodeId,workspaceId:workspace.id,expectedRevision:workspace.revision,expectedProjectSha256:workspace.project.sha256,shotId:shot.shotId,soundIntent:text.trim()}) as ProductionWorkspace;onChange(next);setText(next.clips.find(c=>c.shotId===shot.shotId)?.soundIntent??'');}
  catch(cause){setError(cause instanceof Error?cause.message:'音效意图未保存，请重试。');}
  finally{setSaving(false);}
 }
 return <details className="workspace-sound-intent" open={!!shot.soundIntent}>
  <summary>音效意图（可选）</summary>
  {readOnly?<p>{shot.soundIntent||'未填写'}</p>:<><label htmlFor={id}>音效意图</label><textarea id={id} value={text} maxLength={240} rows={2} placeholder="例如：开门时一声轻响，落在切镜点。" disabled={pending||saving||workspace.stale} onChange={event=>setText(event.target.value)}/><div><small>记录声音和出现时机，实际音效在剪辑台选择。</small><Button size="sm" color="secondary" isDisabled={pending||saving||workspace.stale||!changed} onPress={()=>void save()}>{saving?'正在保存…':'保存音效意图'}</Button></div>{error&&<p role="alert">{error}</p>}</>}
 </details>;
}
