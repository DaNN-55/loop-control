import type {ProductionWorkspace} from '../productionWorkspace';
import type {ProductionSelection} from '../productionSelection';
import type {StoryboardVideoDraft,StoryboardVideoSettings} from '../storyboardBatch';
import type {PromptReferenceBinding} from '../promptReferences';
import type {VideoGenerationMode,VideoVisualInputSelection} from '../videoVisualInputs';
import {defaultWanSettings} from '../videoGenerationSettings';
import {defaultWanModelSettings,wanReferenceModel} from '../wanVideoModels';
import {firstFrameVideoMode,registeredAdapters} from '../worker/registeredAdapters';
import {resolveVideoInputs,type VideoInputDraft,type VideoInputMaterial} from './WorkspaceVideoInputs';
import {episodeVisualDefaults,restoreVisualDraft,type VisualDefaultOverrides} from './workspaceVisualDefaults';

interface VideoDraftFields {
 videoPrompt?:string;
 promptReferences?:PromptReferenceBinding[];
 defaultOverrides?:VisualDefaultOverrides;
 videoSelection?:ProductionSelection|null;
 videoSettings?:StoryboardVideoSettings['videoSettings'];
 firstFrameFit?:'contain'|'cover';
 videoResolution?:string;
 duration?:string;
 durationOverride?:boolean;
 firstFrame?:string;
 videoModeId?:string;
 videoInputIds?:string[];
 videoInputs?:VideoInputDraft;
 referenceVideoSources?:Record<string,string>;
}

export function videoDraftIds(draft:VideoDraftFields){
 return draft.videoInputIds??[draft.firstFrame,...draft.videoInputs?.lastFrame??[],...draft.videoInputs?.referenceImages??[],...draft.videoInputs?.referenceVideos??[]].filter((id):id is string=>!!id);
}

export function storyboardVideoDraftInputs(draft:VideoDraftFields,videoMode:VideoGenerationMode,submittedVideoInputs:VideoVisualInputSelection[],baseline:{prompt:string;duration:string;firstFrame:string}):StoryboardVideoDraft['inputs']{
 const overrides=draft.defaultOverrides?.fields??[];
 const advanced=videoMode.id!=='first-frame';
 const ids=videoDraftIds(draft);
 const hasOwnInputs=draft.videoInputIds!==undefined||draft.videoInputs!==undefined||overrides.includes('videoModeId')||!!draft.firstFrame&&draft.firstFrame!==baseline.firstFrame;
 const tokens=new Set(draft.videoPrompt?.match(/@(图片|视频)[1-9]\d*/g)??[]);
 const references=(draft.promptReferences??[]).filter(binding=>tokens.has(binding.token));
 const videoSettings=draft.videoSelection?.model===wanReferenceModel?{...draft.videoSettings,audio:true,promptExtend:false}:draft.videoSettings;
 const settings=Object.fromEntries(Object.entries(videoSettings??{}).filter(([key,value])=>key==='negativePrompt'?!!value:overrides.some(field=>field===`videoSettings.${key}`)));
 const provider=draft.videoSelection?.provider;
 return {
  ...(draft.videoPrompt?.trim()&&draft.videoPrompt!==baseline.prompt?{prompt:draft.videoPrompt}:{}),
  ...(references.length?{promptReferences:references}:{}),
  ...(overrides.includes('videoSelection')?{selection:draft.videoSelection}:{}),
  ...(draft.durationOverride??(!!draft.duration&&draft.duration!==baseline.duration)?{durationSeconds:Number(draft.duration)}:{}),
  ...(hasOwnInputs?(advanced?{videoMode:videoMode.id,visualInputs:submittedVideoInputs}:{firstFrameMaterialRevisionId:submittedVideoInputs.find(entry=>entry.role==='firstFrame')?.materialRevisionId??ids[0]??''}):{}),
  ...(overrides.includes('firstFrameFit')&&(!advanced||submittedVideoInputs.some(entry=>entry.role==='firstFrame'))?{firstFrameFit:draft.firstFrameFit}:{}),
  ...(provider==='bailian'&&Object.keys(settings).length?{videoSettings:settings}:{}),
  ...(provider==='minimax'&&overrides.includes('videoResolution')?{videoResolution:draft.videoResolution}:{}),
 };
}

export function visualDraftMatchesBasis(workspace:ProductionWorkspace,saved:{preparationRevisionId?:string}){
 return saved.preparationRevisionId===undefined?workspace.legacyVideoDraftBasisKnown===true:saved.preparationRevisionId===workspace.preparationRevisionId;
}

export function readStoryboardVideoDraft(workspace:ProductionWorkspace,shotId:string,common:StoryboardVideoSettings,materials:VideoInputMaterial[]):StoryboardVideoDraft|undefined{
 const clip=workspace.clips.find(clip=>clip.shotId===shotId),preparationRevisionId=workspace.preparationRevisionId;
 if(!clip||!preparationRevisionId||workspace.stale)return;
 const {itemId:targetItemId}=clip;
 try{
  const saved=JSON.parse(sessionStorage.getItem(`loop-visual-draft:${workspace.id}:${targetItemId}`)??'null') as (VideoDraftFields&{tab?:string;settings?:unknown;preparationRevisionId?:string;batchVideoDraft?:StoryboardVideoDraft})|null;
  if(!saved)return;
  const {batchVideoDraft}=saved;
  if(batchVideoDraft)return batchVideoDraft.shotId===shotId&&batchVideoDraft.targetItemId===targetItemId&&batchVideoDraft.preparationRevisionId===preparationRevisionId?batchVideoDraft:undefined;
  if(!visualDraftMatchesBasis(workspace,saved)||!saved.settings||!['video','image'].includes(saved.tab??''))return;

  const target=workspace.visualTargets?.find(target=>target.targetItemId===targetItemId);
  const template=workspace.templateInputs?.shots.find(shot=>shot.shotId===shotId);
  const prompt=template?.videoPrompt??'';
  const firstFrame=workspace.selectedImages?.find(image=>image.targetItemId===targetItemId)?.materialRevisionId
    ??(clip.source?.kind==='image'?clip.source.materialRevisionId:clip.image?.materialRevisionId)
    ??(template?.visual?.material?.type==='image'?template.visual.material.id:undefined)??'';
  const duration=String(target?.durationSeconds??Math.max(3,target?.minimumSeconds??2));
  const selection=target?.defaultSelection;
  const form=restoreVisualDraft<VideoDraftFields>({
   videoPrompt:prompt,firstFrame,duration,videoSelection:selection,firstFrameFit:'contain',
   videoSettings:selection?.provider==='bailian'?defaultWanModelSettings(selection.model??''):defaultWanSettings,
  },saved,{},episodeVisualDefaults(workspace.id,'video'));
  const overrides=form.defaultOverrides.fields;
  const selected=overrides.includes('videoSelection')?form.videoSelection:common.selection;
  const choice=registeredAdapters.productionChoices().find(choice=>choice.capability==='video'&&choice.mode==='generation'&&choice.provider===selected?.provider&&choice.adapter===selected.adapter);
  const modes=choice?.videoGenerationModes?.[selected?.model??'']??[firstFrameVideoMode(choice?.constraints.firstFrame)];
  const mode=modes.find(mode=>mode.id===(overrides.includes('videoModeId')?form.videoModeId:common.videoMode))??modes[0];
  const visualInputs=resolveVideoInputs(mode,videoDraftIds(form),materials).flatMap(({id,role,reason})=>role&&!reason?[{
   role,materialRevisionId:id,...((role==='referenceVideos'||role==='referenceImages'&&mode.referenceImageSource)?{source:form.referenceVideoSources?.[id]?.trim()||undefined}:{}),
  }]:[]);
  const inputs=storyboardVideoDraftInputs({...form,videoSelection:selected},mode,visualInputs,{prompt,firstFrame,duration});
  if(Object.keys(inputs).length)return {shotId,targetItemId,preparationRevisionId,inputs};
 }catch{/* Malformed local draft data cannot author a paid request. */}
}
