import type {ProductionWorkspace} from '../productionWorkspace';
import type {OpenChatCutProject} from '../worker/openchatcutProject';
import {resolveWorkspaceMainVoice,isWorkspaceItemAudible} from '../workspaceAudio';
import {workspaceShotSource} from './WorkspaceShotPreview';

export type WorkspacePreparationTarget='visual'|'voice'|'captions'|'sound';
export interface WorkspacePreparationItem {id:WorkspacePreparationTarget;label:string;status:'complete'|'pending'|'disabled';statusLabel:string;detail:string}

/** Readiness describes saved content, never a preview, browser draft or human approval. */
export function workspaceShotPreparation(workspace:ProductionWorkspace,shotId:string,project:OpenChatCutProject|null){
 const clips=workspace.clips.filter(clip=>clip.shotId===shotId),narration=workspace.narration?.find(n=>n.shotId===shotId),caption=workspace.captions?.find(c=>c.shotId===shotId);
 const missingVisual=!clips.length||clips.some(clip=>!workspaceShotSource(clip,project)||workspace.readiness?.placeholders?.includes(clip.itemId)||workspace.readiness?.missingSources?.some(path=>path===clip.itemId||path===workspaceShotSource(clip,project)?.relativePath));
 const route=project?resolveWorkspaceMainVoice(project,shotId):null;
 const voiceMix=workspace.audio?.mix.voices.find(v=>v.shotId===shotId);
 const actualVoice=route?route.item?String(route.item.id).startsWith('workspace-source-')?'source':'tts':'none':voiceMix?.mode??(narration?.adoptedAudioTrackId?'tts':'none');
 const voicePath=typeof route?.item?.src==='string'?route.item.src:narration?.relativePath;
 const sourceChanged=route?.sourceCurrent===false||voiceMix?.sourceCurrent===false;
 const voiceValid=!sourceChanged&&(!voicePath||!workspace.readiness?.missingSources?.includes(voicePath));
 const usedVoice=voiceValid&&(narration?.requestedMode==='source'?actualVoice==='source':narration?.requestedMode==='tts'||narration?.requestedMode==='manual'?actualVoice==='tts':actualVoice!=='none');
 const needsVoice=!!(narration?.requestedMode!==undefined?narration.requestedMode!=='none':route?.explicitRoute?!!route.item:narration?.enabled??(!!narration&&narration.mode!=='none'||clips.some(clip=>!!clip.voiceInput)));
 const voiceMissingLabel=actualVoice==='source'||narration?.requestedMode==='source'||clips.some(clip=>clip.voiceInput)&&!narration?.requestedMode?'缺视频原声':'缺口播';
 const effect=workspace.templateInputs?.shots.find(s=>s.shotId===shotId)?.sfx;
 const needsEffect=workspace.audio?.enabled?.sfx!==false&&(clips.some(c=>!!c.soundIntent?.trim())||!!effect&&effect.status!=='none');
 const usedEffect=workspace.audio?.preparations.some(p=>p.kind==='sfx'&&p.shotId===shotId&&!!p.adoptedItemId&&!workspace.readiness?.missingSources?.includes(p.relativePath??'')&&(project?project.timelines.some(t=>t.items.some(i=>i.id===p.adoptedItemId&&isWorkspaceItemAudible(i,t))):workspace.audio?.mix.sounds.some(s=>s.itemId===p.adoptedItemId)));
 const task=workspace.visualTasks?.find(t=>t.shotId===shotId&&['ready','running'].includes(t.status));
 const voiceWorking=needsVoice&&!usedVoice&&!!narration&&['ready','running'].includes(narration.status);
 const items:WorkspacePreparationItem[]=[
  {id:'visual',label:'画面',status:missingVisual?'pending':'complete',statusLabel:missingVisual?task?'制作中':'待完成':'已完成',detail:missingVisual?'缺画面':'已采用画面'},
  {id:'voice',label:'主声音',status:!needsVoice?'disabled':usedVoice?'complete':'pending',statusLabel:!needsVoice?'已关闭':usedVoice?'已完成':sourceChanged?'需重接':voiceWorking?'制作中':'待完成',detail:!needsVoice?'已关闭':usedVoice?actualVoice==='source'?'已采用视频原声':'已采用口播':voiceMissingLabel},
  {id:'captions',label:'字幕',status:!caption?.contract.enabled?'disabled':caption.timing==='current'?'complete':'pending',statusLabel:!caption?.contract.enabled?'已关闭':caption.timing==='current'?'已完成':caption.timing==='waiting'?'同步中':caption.timing==='stale'||caption.timing==='failed'?'待调整':'待完成',detail:!caption?.contract.enabled?'已关闭':caption.timing==='current'?'字幕已就绪':caption.timing==='failed'?'字幕待修正':caption.timing==='waiting'?'字幕同步中':'字幕待调整'},
 ];
 if(needsEffect)items.push({id:'sound',label:'音效',status:usedEffect?'complete':'pending',statusLabel:usedEffect?'已完成':'待完成',detail:usedEffect?'已采用音效':'缺音效'});
 const pendingItems=items.filter(item=>item.status==='pending'),details=pendingItems.map(item=>item.detail),pendingCount=pendingItems.length;
 const working=pendingCount>0&&(!!task||voiceWorking||caption?.contract.enabled&&caption.timing==='waiting');
 const failed=pendingCount>0&&(needsVoice&&!usedVoice&&narration?.status==='failed'||caption?.contract.enabled&&caption.timing==='failed');
 const first=pendingItems[0]?.id,next=needsVoice&&!usedVoice&&!clips.some(clip=>clip.voiceInput)?'voice':first==='captions'?'voice':first??'visual';
 return {ready:pendingCount===0,label:pendingCount?`待${pendingCount}项`:'可剪辑',pendingCount,items,details,next,tone:pendingCount===0?'ready':failed?'error':working?'working':'pending'} as const;
}
