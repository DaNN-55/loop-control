import type {PromptReferenceBinding} from '../promptReferences';
import type {ProductionWorkspace} from '../productionWorkspace';
import type {StoryboardImageDraft} from '../storyboardBatch';
import type {VisualDefaultOverrides} from './workspaceVisualDefaults';
import type {ImageBrief,ImageGenerationSettings} from '../imageGeneration';

export function readStoryboardImageDraft(workspace:ProductionWorkspace,shotId:string):StoryboardImageDraft|undefined{
 const targetItemId=workspace.clips.find(clip=>clip.shotId===shotId)?.itemId;
 const preparationRevisionId=workspace.preparationRevisionId;
 if(!targetItemId||!preparationRevisionId)return;
 try{
  const saved=JSON.parse(sessionStorage.getItem(`loop-visual-draft:${workspace.id}:${targetItemId}`)??'null');
  if(saved?.preparationRevisionId!==preparationRevisionId)return;
  const fields=(saved.defaultOverrides as VisualDefaultOverrides|undefined)?.fields??[];
  const patch:StoryboardImageDraft={shotId,targetItemId,preparationRevisionId};
  if(fields.includes('imageSelection')&&saved.imageSelection!==undefined)patch.selection=saved.imageSelection;
  if(typeof saved.imagePrompt==='string')patch.prompt=saved.imagePrompt;
  const settings=saved.settings as ImageGenerationSettings|undefined;
  const brief=saved.imageBrief as ImageBrief|undefined;
  const references=Array.isArray(saved.references)?saved.references.filter((id:unknown):id is string=>typeof id==='string'):[];
  patch.settings={
   ...(fields.includes('settings.size')&&settings?.size?{size:settings.size}:{}),
   ...(fields.includes('settings.quality')&&settings?.quality?{quality:settings.quality}:{}),
   ...(fields.includes('settings.count')&&settings?.count?{count:settings.count}:{}),
  };
  patch.referenceMaterialRevisionIds=references;
  patch.imageBrief={
   references:brief?.references?.filter(r=>references.includes(r.materialRevisionId))??[],
   ...(brief?.framing&&fields.includes('imageBrief.framing')?{framing:brief.framing}:{}),
   ...(brief?.crop&&fields.includes('imageBrief.crop')?{crop:brief.crop}:{}),
   ...(brief?.captionSpace&&fields.includes('imageBrief.captionSpace')?{captionSpace:brief.captionSpace}:{}),
  };
  const tokens=new Set(patch.prompt?.match(/@(图片|视频)[1-9]\d*/g)??[]);
  patch.promptReferences=(Array.isArray(saved.promptReferences)?saved.promptReferences:[]).filter((ref:PromptReferenceBinding)=>tokens.has(ref?.token));
  return patch;
 }catch{return undefined;}
}
