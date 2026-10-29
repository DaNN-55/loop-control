/** Frame numbers use the target native timeline fps; end is exclusive. */
export interface WorkspaceVideoRange {sourceInFrame:number;durationInFrames:number;durationLocked:boolean}
/** Shared by preparation and native patch controls. Lock moves a window without changing its length. */
export function adjustWorkspaceVideoRange<T extends WorkspaceVideoRange>(range:T,edge:'in'|'out',deltaFrames:number,sourceDurationInFrames:number):T{
 if(!Number.isSafeInteger(deltaFrames)||!Number.isSafeInteger(sourceDurationInFrames)||sourceDurationInFrames<1)return range;
 const end=range.sourceInFrame+range.durationInFrames;
 if(edge==='out'&&range.durationLocked)return range;
 if(edge==='in'&&range.durationLocked){const start=Math.max(0,Math.min(sourceDurationInFrames-range.durationInFrames,range.sourceInFrame+deltaFrames));return{...range,sourceInFrame:start};}
 if(edge==='in'){const start=Math.max(0,Math.min(end-1,range.sourceInFrame+deltaFrames));return{...range,sourceInFrame:start,durationInFrames:end-start};}
 const nextEnd=Math.max(range.sourceInFrame+1,Math.min(sourceDurationInFrames,end+deltaFrames));return{...range,durationInFrames:nextEnd-range.sourceInFrame};
}
