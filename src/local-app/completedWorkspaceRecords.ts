import type {ProductionWorkspace} from '../productionWorkspace';
import type {OpenChatCutProject} from '../worker/openchatcutProject';
import type {WorkspaceVisualCandidate} from '../workspaceVisualCandidates';
import {workspaceShotSource} from './WorkspaceShotPreview';

export interface CompletedProductionRecord {
 key:string;kind:'image'|'video'|'audio'|'request';label:string;current:boolean;status:string;taskId?:string|null;error?:string|null;
 file?:{relativePath:string;sha256?:string|null};input?:string;submitted?:string;script?:string;parameters:unknown;
 generation?:WorkspaceVisualCandidate['generation'];
}
/** Preserve request identity, including failed originals that later have retries. */
export function completedShotRecords(w:ProductionWorkspace,project:OpenChatCutProject|null,shotId:string):CompletedProductionRecord[]{
 const clips=w.clips.filter(c=>c.shotId===shotId),items=project?.timelines.flatMap(t=>t.items)??[];
 const sources=clips.map(c=>workspaceShotSource(c,project)).filter(s=>s!==null);
 const records:CompletedProductionRecord[]=[];
 const visual=(w.visualCandidates??[]).filter(c=>c.shotId===shotId||clips.some(clip=>clip.itemId===c.targetItemId));
 for(const c of visual)records.push({key:'visual:'+c.id,kind:c.kind,label:c.kind==='image'?'图片':'视频',current:!!project&&sources.some(s=>s.relativePath===c.relativePath&&s.sha256===c.sha256),status:c.status,taskId:c.taskId,file:c,error:null,input:c.generation?.prompt,submitted:c.generation?.actualPrompt,script:c.mainScriptText,parameters:c.generation??c.source??null,generation:c.generation});
 for(const t of w.visualTasks??[]){
  if(t.shotId!==shotId&&!clips.some(c=>c.itemId===t.targetItemId)||visual.some(c=>c.taskId===t.taskId))continue;
  records.push({key:'visual-task:'+t.id,kind:'request',label:t.kind==='image'?'图片请求':'视频请求',current:false,status:t.status,taskId:t.taskId,error:t.error,input:t.generation?.prompt,submitted:t.generation?.actualPrompt,parameters:t.generation??t,generation:t.generation});
 }
 for(const c of (w.candidates??[]).filter(c=>c.kind==='audio'&&c.shotId===shotId)){
  const current=!!w.usedNarration?.some(n=>n.shotId===shotId&&n.sha256===c.sha256&&(n.taskId===c.taskId||n.audioTrackId===c.audioTrackId));
  records.push({key:'audio:'+c.id,kind:'audio',label:'口播',current,status:c.status,taskId:c.taskId,file:c,input:c.text,script:c.mainScriptText,parameters:c.speech??null});
 }
 const voice=w.narration?.find(n=>n.shotId===shotId);
 if(voice?.execution&&!records.some(r=>r.taskId===voice.execution!.taskId))records.push({key:'voice:'+voice.execution.taskId,kind:voice.relativePath?'audio':'request',label:'口播请求',current:voice.execution.taskId===w.usedNarration?.find(n=>n.shotId===shotId)?.taskId,status:voice.status,taskId:voice.execution.taskId,error:voice.error,file:voice.relativePath?{relativePath:voice.relativePath,sha256:voice.sha256}:undefined,input:voice.execution.text,parameters:voice.execution});
 if(voice?.generationTask&&!records.some(r=>r.taskId===voice.generationTask!.taskId)){
  const t=voice.generationTask;records.push({key:'voice-task:'+t.id,kind:'request',label:'口播请求',current:false,status:t.status,taskId:t.taskId,error:t.error,parameters:t});
 }
 for(const p of w.audio?.preparations??[]){
  if(p.shotId!==shotId&&p.kind!=='bgm'&&p.anchor!=='absolute')continue;
  if(p.taskId&&records.some(r=>r.taskId===p.taskId))continue;
  records.push({key:'sound:'+p.id,kind:p.relativePath?'audio':'request',label:p.kind==='bgm'?'整片配乐':p.kind==='source'?'原片声音':'音效',current:!!project&&!!p.adoptedItemId&&items.some(i=>i.id===p.adoptedItemId),status:p.status,taskId:p.taskId,error:p.error,file:p.relativePath?{relativePath:p.relativePath,sha256:p.sha256}:undefined,input:p.description,parameters:{query:p.query,selection:p.selection,connection:p.connection,anchor:p.anchor,offsetSeconds:p.offsetSeconds,durationSeconds:p.durationSeconds,source:p.source}});
 }
 return records;
}
