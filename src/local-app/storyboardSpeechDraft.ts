import type {ProductionWorkspace,WorkspaceNarration} from '../productionWorkspace';
import type {StoryboardSpeechDraft} from '../storyboardBatch';

function key(workspaceId:string,shotId:string){return `loop-speech-draft:${workspaceId}:${shotId}:text`;}
export function readStoryboardSpeechDraft(workspace:ProductionWorkspace,narration:WorkspaceNarration):StoryboardSpeechDraft|undefined{
 if(!workspace.preparationRevisionId)return;
 try{
  const draft=JSON.parse(sessionStorage.getItem(key(workspace.id,narration.shotId))??'null') as StoryboardSpeechDraft|null;
  if(draft?.shotId===narration.shotId&&draft.preparationRevisionId===workspace.preparationRevisionId&&draft.inputFingerprint===narration.inputFingerprint&&typeof draft.text==='string')return draft;
 }catch{/* An unavailable or outdated local draft is optional. */}
}
export function storeStoryboardSpeechDraft(workspace:ProductionWorkspace,narration:WorkspaceNarration,text:string|null){
 if(!workspace.preparationRevisionId)return;
 try{
  if(text===null||text===narration.text){sessionStorage.removeItem(key(workspace.id,narration.shotId));return;}
  const draft:StoryboardSpeechDraft={shotId:narration.shotId,preparationRevisionId:workspace.preparationRevisionId,inputFingerprint:narration.inputFingerprint,text};
  sessionStorage.setItem(key(workspace.id,narration.shotId),JSON.stringify(draft));
 }catch{/* The current editor remains usable without browser storage. */}
}
