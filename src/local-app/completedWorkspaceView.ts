import type {ProductionWorkspace} from '../productionWorkspace';
import type {OpenChatCutProject} from '../worker/openchatcutProject';
import {readWorkspaceShots} from '../workspaceShots';

/** A delivery's exact final file wins; an unconfirmed recent render never replaces it. */
export function completedWorkspaceExport(w:ProductionWorkspace){
 const delivery=w.deliveries?.find(d=>d.verified);
 if(delivery)return w.exports?.find(e=>e.id===delivery.exportId&&e.confirmed&&e.artifact&&delivery.artifacts.some(a=>a.artifactType==='final_render'&&a.sha256===e.artifact!.sha256));
 return w.exports?.find(e=>e.current&&e.confirmed&&e.artifact);
}
export function completedWorkspaceShots(w:ProductionWorkspace,project:OpenChatCutProject|null){
 if(project)return readWorkspaceShots(project).filter(s=>s.timelineId===project.activeTimelineId);
 return w.clips.filter((c,i,a)=>a.findIndex(v=>v.shotId===c.shotId)===i).map(c=>({id:c.shotId,text:c.text,timelineId:'',itemIds:w.clips.filter(v=>v.shotId===c.shotId).map(v=>v.itemId),startFrame:0,durationInFrames:0,effective:false}));
}
export function completedArtifactUrl(w:Pick<ProductionWorkspace,'episodeId'>,file:{relativePath:string;sha256?:string|null}){
 return '/_local-artifact?'+new URLSearchParams({episode:w.episodeId,path:file.relativePath,...(file.sha256?{sha256:file.sha256}:{})});
}
