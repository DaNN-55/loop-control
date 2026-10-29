import type {OpenChatCutProject} from './worker/openchatcutProject.js';
export interface WorkspaceUsedNarration {shotId:string;itemId:string;audioTrackId:string;sha256:string;taskId:string|null;text:string|null;mainScriptText:string;inputFingerprint:string|null;sourceInFrame:number;durationInFrames:number;fps:number;fullSourceUsed:boolean;provenance:'owner_adoption'|'immutable_task'|'not_recorded'}
export interface WorkspaceCandidate {id:string;kind:'audio'|'video';shotId:string;clipId:string;targetItemId:string;taskId:string;inputFingerprint:string;text:string;mainScriptText:string;audioTrackId:string|null;relativePath:string;sha256:string;fileSize:number;durationSeconds:number;status:'available'|'stale'|'adopted'|'rejected';currentDurationSeconds:number|null;durationImpact?:{deltaSeconds:number;overlapItemIds:string[]}}
/** Only source identity is compared; all editing properties remain native-owned. */
export function workspaceCandidateTarget(item:Record<string,unknown>){return {id:item.id,kind:item.kind,src:item.src??null,sourceAssetId:item.sourceAssetId??null,sourceRevision:item.sourceRevision??null,sourceContentHash:item.sourceContentHash??null,startFrame:item.startFrame,durationInFrames:item.durationInFrames,srcInFrame:item.srcInFrame??0,playbackRate:item.playbackRate??1};}
export interface WorkspaceCandidateEdit {targetItemId:string;expectedTarget:ReturnType<typeof workspaceCandidateTarget>;source:{id:string;kind:'audio'|'video';src:string;sha256:string;inputFingerprint:string;durationSeconds:number};durationPolicy:'keep-target'|'use-candidate'}
export function isWorkspaceCandidateEdit(value:unknown):value is WorkspaceCandidateEdit {if(!value||typeof value!=='object')return false;const e=value as WorkspaceCandidateEdit;return typeof e.targetItemId==='string'&&!!e.expectedTarget&&typeof e.source?.id==='string'&&['audio','video'].includes(e.source.kind)&&typeof e.source.src==='string'&&/^[a-f0-9]{64}$/.test(e.source.sha256)&&typeof e.source.inputFingerprint==='string'&&Number.isFinite(e.source.durationSeconds)&&e.source.durationSeconds>0&&['keep-target','use-candidate'].includes(e.durationPolicy);}
/** Restricted shared audio/video adoption. No pool-wide relink, ripple or project reconstruction. */
export function applyWorkspaceCandidate(project:OpenChatCutProject,edit:WorkspaceCandidateEdit):OpenChatCutProject {
 const next=structuredClone(project),targets=next.timelines.flatMap(t=>t.items.filter(i=>i.id===edit.targetItemId).map(item=>({timeline:t,item})));
 if(targets.length!==1)throw Error('候选目标已删除或不唯一，请重新读取。');const {timeline,item}=targets[0];
 if(Object.entries(workspaceCandidateTarget(item)).some(([key,value])=>value!==(edit.expectedTarget as Record<string,unknown>)[key])||item.kind!==edit.source.kind)throw Error('目标输入或源身份已变化，请重新比较候选。');
 const frames=Math.max(1,Math.ceil(edit.source.durationSeconds*timeline.fps));
 if(Number(item.playbackRate??1)!==1||item.edits)throw Error('目标已变速或分段，请先在原生编辑器明确恢复完整区间。');
 if(edit.durationPolicy==='keep-target'&&Number(item.durationInFrames)>frames)throw Error('候选短于目标窗口，请明确采用候选时长。');
 const asset={id:edit.source.id,name:String(item.name??edit.targetItemId),kind:edit.source.kind,src:edit.source.src,durationInFrames:frames};
 const existing=next.assets.find(a=>a.id===asset.id);if(existing&&existing.src!==asset.src)throw Error('候选素材身份已变化。');if(!existing)next.assets.push(asset);
 Object.assign(item,{src:edit.source.src,sourceAssetId:asset.id,sourceRevision:`source-sha256-${edit.source.sha256}`,sourceContentHash:edit.source.sha256,loopControlCandidate:{inputFingerprint:edit.source.inputFingerprint,sourceId:edit.source.id},srcInFrame:0});
 if(edit.durationPolicy==='use-candidate')item.durationInFrames=frames;
 return next;
}
