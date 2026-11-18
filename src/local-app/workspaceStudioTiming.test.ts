// @vitest-environment node
import {it,expect} from 'vitest';
import {createProductionWorkspaceProject} from './workspaceInitialProject';
it('keeps the approved total duration when fractional shot durations round to native frames',()=>{
 const shots=[4.98,4.98,5.04].map((durationSeconds,i)=>({id:'shot-'+(i+1),scriptSegment:'原文',durationSeconds,targetSpec:'9:16',visualSource:'unassigned' as const,shotType:'b_roll' as const,productionMethod:'image',inputBasis:[]}));
 const {project}=createProductionWorkspaceProject('episode','revision',shots);
 const timeline=project.timelines[0];expect(Math.max(...timeline.items.map(i=>Number(i.startFrame)+Number(i.durationInFrames)))).toBe(450);
});
