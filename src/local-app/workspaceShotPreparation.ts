import type {ProductionWorkspace} from '../productionWorkspace';
import type {OpenChatCutProject} from '../worker/openchatcutProject';
import {resolveWorkspaceMainVoice,isWorkspaceItemAudible} from '../workspaceAudio';
import {workspaceShotSource} from './WorkspaceShotPreview';

/** Readiness describes saved content, never a preview, browser draft or human approval. */
export function workspaceShotPreparation(workspace:ProductionWorkspace,shotId:string,project:OpenChatCutProject|null){
 const clips=workspace.clips.filter(clip=>clip.shotId===shotId),narration=workspace.narration?.find(n=>n.shotId===shotId),caption=workspace.captions?.find(c=>c.shotId===shotId);
 const details:string[]=[],steps:Array<'visual'|'voice'|'sound'>=[];
 const missing=(label:string,step:'visual'|'voice'|'sound')=>{details.push(label);steps.push(step);};
 if(!clips.length||clips.some(clip=>!workspaceShotSource(clip,project)||workspace.readiness?.placeholders?.includes(clip.itemId)||workspace.readiness?.missingSources?.some(path=>path===clip.itemId||path===workspaceShotSource(clip,project)?.relativePath)))missing('缺画面','visual');
 const route=project?resolveWorkspaceMainVoice(project,shotId):null;
 const voiceMix=workspace.audio?.mix.voices.find(v=>v.shotId===shotId);
 const actualVoice=route?route.item?String(route.item.id).startsWith('workspace-source-')?'source':'tts':'none':voiceMix?.mode??(narration?.adoptedAudioTrackId?'tts':'none');
 const voicePath=typeof route?.item?.src==='string'?route.item.src:narration?.relativePath;
 const voiceValid=route?.sourceCurrent!==false&&voiceMix?.sourceCurrent!==false&&(!voicePath||!workspace.readiness?.missingSources?.includes(voicePath));
 const usedVoice=voiceValid&&(narration?.requestedMode==='source'?actualVoice==='source':narration?.requestedMode==='tts'||narration?.requestedMode==='manual'?actualVoice==='tts':actualVoice!=='none');
 const needsVoice=narration?.requestedMode!==undefined?narration.requestedMode!=='none':route?.explicitRoute?!!route.item:narration?.enabled??(!!narration&&narration.mode!=='none'||clips.some(clip=>!!clip.voiceInput));
 if(needsVoice&&!usedVoice)missing(actualVoice==='source'||narration?.requestedMode==='source'||clips.some(clip=>clip.voiceInput)&&!narration?.requestedMode?'缺视频原声':'缺口播','voice');
 if(caption?.contract.enabled&&caption.timing!=='current')missing(caption.timing==='failed'?'字幕待修正':caption.timing==='waiting'?'字幕同步中':'字幕待调整','voice');
 const effect=workspace.templateInputs?.shots.find(s=>s.shotId===shotId)?.sfx;
 const needsEffect=workspace.audio?.enabled?.sfx!==false&&(clips.some(c=>!!c.soundIntent?.trim())||!!effect&&effect.status!=='none');
 const usedEffect=workspace.audio?.preparations.some(p=>p.kind==='sfx'&&p.shotId===shotId&&!!p.adoptedItemId&&!workspace.readiness?.missingSources?.includes(p.relativePath??'')&&(project?project.timelines.some(t=>t.items.some(i=>i.id===p.adoptedItemId&&isWorkspaceItemAudible(i,t))):workspace.audio?.mix.sounds.some(s=>s.itemId===p.adoptedItemId)));
 if(needsEffect&&!usedEffect)missing('缺音效','sound');
 const task=workspace.visualTasks?.find(t=>t.shotId===shotId&&['ready','running'].includes(t.status));
 const working=details.length>0&&(!!task||needsVoice&&!usedVoice&&!!narration&&['ready','running'].includes(narration.status)||caption?.contract.enabled&&caption.timing==='waiting');
 const failed=details.length>0&&(needsVoice&&!usedVoice&&narration?.status==='failed'||caption?.contract.enabled&&caption.timing==='failed');
 const next=needsVoice&&!usedVoice&&!clips.some(clip=>clip.voiceInput)?'voice':steps[0]??'visual';
 return {ready:details.length===0,label:working?'制作中':details.length>1?`还缺 ${details.length} 项`:details[0]??'可剪辑',details,next,tone:details.length===0?'ready':failed?'error':working?'working':'pending'} as const;
}
