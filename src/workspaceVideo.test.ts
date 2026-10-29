import {describe,it,expect} from 'vitest';
import {adjustWorkspaceVideoRange} from './workspaceVideo';
describe('frame adjustment of a native video range',()=>{
 it('moves the whole source window when its duration is locked',()=>{
  expect(adjustWorkspaceVideoRange({sourceInFrame:59,durationInFrames:30,durationLocked:true},'in',1,120)).toEqual({sourceInFrame:60,durationInFrames:30,durationLocked:true});
  expect(adjustWorkspaceVideoRange({sourceInFrame:60,durationInFrames:30,durationLocked:true},'out',1,120)).toEqual({sourceInFrame:60,durationInFrames:30,durationLocked:true});
 });
 it('trims independent endpoints when unlocked and clamps to the original source',()=>{
  expect(adjustWorkspaceVideoRange({sourceInFrame:60,durationInFrames:30,durationLocked:false},'in',1,120)).toEqual({sourceInFrame:61,durationInFrames:29,durationLocked:false});
  expect(adjustWorkspaceVideoRange({sourceInFrame:60,durationInFrames:30,durationLocked:false},'out',-1,120)).toEqual({sourceInFrame:60,durationInFrames:29,durationLocked:false});
  expect(adjustWorkspaceVideoRange({sourceInFrame:90,durationInFrames:30,durationLocked:true},'in',1,120)).toEqual({sourceInFrame:90,durationInFrames:30,durationLocked:true});
  expect(adjustWorkspaceVideoRange({sourceInFrame:0,durationInFrames:30,durationLocked:true},'in',-1,120)).toEqual({sourceInFrame:0,durationInFrames:30,durationLocked:true});
 });
});
