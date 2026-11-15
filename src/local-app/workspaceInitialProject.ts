import {validateWorkspaceVoiceInput,type WorkspaceVoiceInput} from '../workspaceVoiceInput.js';
import {workspaceVisualDraftInstances,type WorkspaceVisualDraft} from '../workspaceVisualDraft.js';
import {validateWorkspaceRenderPreferences,type WorkspaceRenderPreferences} from '../workspaceRenderPreferences.js';
import {randomUUID} from 'node:crypto';
import {ConfigurationError} from './configurationCommands.js';
import {defaultShotComposition,shotCompositionRect,shotCompositionTransform,shotCompositionSlotLabels,shotCompositionLayouts} from '../shotComposition.js';
import type {StoryboardShotManifest} from '../worker/contracts.js';
import type {OpenChatCutProject,OpenChatCutTimeline} from '../worker/openchatcutProject.js';
import type {WorkspaceClip} from '../productionWorkspace.js';

export interface WorkspaceInitialInputs {voices?:ReadonlyMap<string,WorkspaceVoiceInput>;render?:ReadonlyMap<string,WorkspaceRenderPreferences>;visuals?:ReadonlyMap<string,WorkspaceVisualDraft>}

/** Initial placeholders carry no selected media or confirmation. */
export function createProductionWorkspaceProject(episodeId:string,id:string,shots:StoryboardShotManifest[],canvas?:Pick<OpenChatCutTimeline,'fps'|'width'|'height'>,initialInputs?:WorkspaceInitialInputs){
   const [width,height]=canvas?[canvas.width,canvas.height]:shots[0].targetSpec==='16:9'?[1920,1080]:shots[0].targetSpec==='1:1'?[1080,1080]:[1080,1920];
   const fps=canvas?.fps??30;
   const tracks:OpenChatCutProject['timelines'][number]['tracks']={V1:{kind:'video',name:'画面'}};
   let frame=0;
   const clips:WorkspaceClip[]=[];
   const items=shots.flatMap(shot=>{
    if(typeof shot.id!=='string'||typeof shot.scriptSegment!=='string')throw new ConfigurationError(409,'分镜身份无效。');
    const renderPreferences=initialInputs?.render?.get(shot.id)??shot.renderPreferences;
    if(renderPreferences)try{validateWorkspaceRenderPreferences(renderPreferences);}catch(error){throw new ConfigurationError(409,error instanceof Error?error.message:'渲染预填无效。');}
    const voiceInput=initialInputs?.voices?.get(shot.id);if(voiceInput)try{validateWorkspaceVoiceInput(voiceInput);}catch(error){throw new ConfigurationError(409,error instanceof Error?error.message:'原声输入无效。');}
    const visualDraft=initialInputs?.visuals?.get(shot.id);
    const layout=visualDraft?.composition.layout??(shot.layout&&shotCompositionLayouts.includes(shot.layout)?shot.layout:'full');
    const composition=defaultShotComposition(layout);
    const instances=visualDraft?workspaceVisualDraftInstances(visualDraft,fps):composition.slots.map((slot,index)=>({slot,index,startFrame:0,durationInFrames:Math.max(1,Math.round(Number(shot.durationSeconds||3)*fps))}));
    const duration=Math.max(...instances.map(i=>i.startFrame+i.durationInFrames));
    const shotItems=instances.map(({slot,index,startFrame,durationInFrames})=>{
     const clipId=randomUUID(),itemId=`shot-${shot.id}-${clipId}`,track=`V${index+1}`;
     const label=shotCompositionSlotLabels[slot.id];
     tracks[track]??={kind:'video',name:`画面 ${index+1}`};
     clips.push({id:clipId,itemId,shotId:shot.id,text:shot.scriptSegment,source:null,...(voiceInput?{voiceInput}:{}),...(renderPreferences?{renderPreferences}:{})});
     return {id:itemId,track,kind:'text',name:`${shot.id} · ${label}`,startFrame:frame+startFrame,durationInFrames,width,height,
      props:{text:`待匹配画面\n${label}`,fontSize:64,color:'#a3acc2',align:'center'},
      transform:{...shotCompositionTransform(shotCompositionRect(layout,slot.id),slot),rotation:0},
      ...(renderPreferences?.transition==='fade'?{...(layout!=='full'||index===0?{fadeInFrames:Math.round(fps*.35)}:{}),...(layout!=='full'||index===instances.length-1?{fadeOutFrames:Math.round(fps*.35)}:{})}:{}),
      ...(layout!=='full'?{loopControlComposition:{layout,slotId:slot.id}}:{}),
     };
    });
    frame+=duration;
    return shotItems;
   });
   const project:OpenChatCutProject={version:3,loopControl:{version:'four-step-workspace/v1',inputFingerprint:id,transitionMode:'studio'},assets:[],mediaFolders:[],activeTimelineId:`loop-control-${episodeId}`,timelines:[{id:`loop-control-${episodeId}`,name:'整期剪辑',order:0,fps,width,height,fit:'contain',items,trackOrder:Object.keys(tracks),tracks,transitions:[],selectedId:null,captionsHidden:false}]};
   return{project,clips};
}
