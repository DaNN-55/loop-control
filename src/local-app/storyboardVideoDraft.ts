import type {ProductionWorkspace} from '../productionWorkspace';
import type {StoryboardVideoDraft} from '../storyboardBatch';

export function readStoryboardVideoDraft(workspace:ProductionWorkspace,shotId:string):StoryboardVideoDraft|undefined{
 const targetItemId=workspace.clips.find(clip=>clip.shotId===shotId)?.itemId;
 if(!targetItemId||!workspace.preparationRevisionId)return;
 try{
  const {batchVideoDraft:draft}=JSON.parse(sessionStorage.getItem(`loop-visual-draft:${workspace.id}:${targetItemId}`)??'{}') as {batchVideoDraft?:StoryboardVideoDraft};
  if(draft?.shotId===shotId&&draft.targetItemId===targetItemId&&draft.preparationRevisionId===workspace.preparationRevisionId)return draft;
 }catch{/* The persisted visual draft is optional. */}
}
