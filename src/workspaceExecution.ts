import type {OpenChatCutProject} from './worker/openchatcutProject.js';

/** Match the native renderer's explicit kind and its fallback for unnamed tracks. */
export function isWorkspaceVideoTrack(timeline:OpenChatCutProject['timelines'][number],track:string){
 const prefix=track.toUpperCase()[0];
 return (timeline.tracks[track]?.kind??(prefix==='A'?'audio':prefix==='C'?'caption':'video'))==='video';
}

/** A reversible native switch removes this node from execution, not from history. */
export function workspaceExecutionProject(project:OpenChatCutProject):OpenChatCutProject {
 const next=structuredClone(project);
 if(project.loopControl?.editorAuthority==='native')return next;
 for(const timeline of next.timelines)timeline.items=timeline.items.filter(item=>{
  if(item.kind!=='audio')return true;
  if(item.loopControlNarrationMute||item.loopControlSoundMute)return false;
  const audio=item.loopControlAudio as {kind?:string;shotId?:string}|undefined;
  if((audio?.kind==='bgm'||audio?.kind==='sfx')&&project.loopControl?.audioEnabled?.[audio.kind]===false)return false;
  const shotId=String(item.id).startsWith('workspace-narration-shot-')?String(item.id).slice('workspace-narration-shot-'.length):undefined;
  return !shotId||!project.timelines.some(t=>t.items.some(visual=>(visual.loopControlShot as {shotId?:string}|undefined)?.shotId===shotId&&visual.loopControlNarrationEnabled===false));
 });
 return next;
}
