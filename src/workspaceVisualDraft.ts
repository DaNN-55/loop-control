import {isValidShotComposition,type ShotComposition} from './shotComposition.js';

/** Unconfirmed visual intent; never an adopted source or execution authority. */
export interface WorkspaceVisualDraft {
 version:'workspace-visual-draft/v1';
 segments:Array<{startSeconds:number;endSeconds:number}>;
 composition:ShotComposition;
}
export interface WorkspaceSourceRange {version:'workspace-source-range/v1';sourceInSeconds:number;sourceOutSeconds:number}

export function validateWorkspaceSourceRange(value:unknown):asserts value is WorkspaceSourceRange{
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('画面源区间无效。');
 const v=value as Record<string,unknown>;
 if(v.version!=='workspace-source-range/v1'||Object.keys(v).some(k=>!['version','sourceInSeconds','sourceOutSeconds'].includes(k))||typeof v.sourceInSeconds!=='number'||!Number.isFinite(v.sourceInSeconds)||v.sourceInSeconds<0||typeof v.sourceOutSeconds!=='number'||!Number.isFinite(v.sourceOutSeconds)||v.sourceOutSeconds<=v.sourceInSeconds)throw Error('画面源区间字段或版本无效。');
}
export function validateWorkspaceVisualDraft(value:unknown):asserts value is WorkspaceVisualDraft{
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('画面草稿格式无效。');
 const v=value as Record<string,unknown>;
 if(v.version!=='workspace-visual-draft/v1'||Object.keys(v).some(k=>!['version','segments','composition'].includes(k))||!Array.isArray(v.segments)||!v.segments.length||v.segments.some(s=>!s||typeof s!=='object'||Array.isArray(s)||Object.keys(s).some(k=>!['startSeconds','endSeconds'].includes(k))||typeof s.startSeconds!=='number'||!Number.isFinite(s.startSeconds)||s.startSeconds<0||typeof s.endSeconds!=='number'||!Number.isFinite(s.endSeconds)||s.endSeconds<=s.startSeconds)||!isValidShotComposition(v.composition,v.segments.length))throw Error('画面草稿区间或构图无效。');
}
/** Match the declared layout's sequential sum or parallel shortest window in frames. */
export function workspaceVisualDraftInstances(draft:WorkspaceVisualDraft,fps:number){
 const {composition,segments}=draft;
 const full=composition.layout==='full';
 const parallelFrames=full?0:Math.max(1,Math.round(Math.min(...composition.slots.map(s=>segments[s.clipSegmentIndex].endSeconds-segments[s.clipSegmentIndex].startSeconds))*fps));
 let frame=0;
 return(full?segments.map((segment,index)=>({slot:composition.slots[0],segment,index})):composition.slots.map((slot,index)=>({slot,segment:segments[slot.clipSegmentIndex],index}))).map(({slot,segment,index})=>{
  const durationInFrames=full?Math.max(1,Math.round((segment.endSeconds-segment.startSeconds)*fps)):parallelFrames,startFrame=full?frame:0;frame+=durationInFrames;
  if(!Number.isSafeInteger(frame)||!Number.isSafeInteger(durationInFrames))throw Error('画面草稿时长无法映射到当前帧率。');
  return{slot,index,startFrame,durationInFrames,sourceRange:{version:'workspace-source-range/v1' as const,sourceInSeconds:segment.startSeconds,sourceOutSeconds:segment.endSeconds}};
 });
}
