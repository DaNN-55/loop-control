import {expect,it} from 'vitest';
import {defaultShotCaptionContract} from '../shotCaptions';
import type {WorkspaceCaptionState} from '../workspaceCaptions';
import {captionAlignmentWindow,captionCuesInShot,captionDraftCues,editCaptionTextKeepingTiming,nextAutomaticCaption} from './workspaceCaptionPreparation';

it('corrects one phrase without changing any phrase timing or unrelated text',()=>{
 const contract={...defaultShotCaptionContract('招才纳福。财源广进。','independent'),cues:[{id:'one',text:'招才纳福。',startMs:100,endMs:1300},{id:'two',text:'财源广进。',startMs:1400,endMs:2600}]};
 expect(editCaptionTextKeepingTiming(contract,'招财纳福。财源广进。')?.cues).toEqual([{...contract.cues[0],text:'招财纳福。'},contract.cues[1]]);
 expect(editCaptionTextKeepingTiming(contract,'你好。再见。')).toBeNull();
});
it('seeds a reviewable phrase draft inside the actual shot rather than claiming model timing',()=>{
 expect(captionDraftCues('第一句。第二句！',2000)).toEqual([{id:'manual-1',text:'第一句。',startMs:0,endMs:1000},{id:'manual-2',text:'第二句！',startMs:1000,endMs:2000}]);
 expect(captionDraftCues('字幕',0)).toEqual([]);
});
it('only schedules missing/stale eligible captions and applies a completed outstanding result first',()=>{
 const c={clipId:'one',contract:defaultShotCaptionContract('字幕','independent'),inputFingerprint:'one',timing:'stale',audioTrackId:'audio',alignmentReady:true} as WorkspaceCaptionState;
 expect(nextAutomaticCaption([c])).toEqual({name:'requestWorkspaceCaptionAlignment',caption:c});
 expect(nextAutomaticCaption([{...c,timing:'current',alignmentMethod:'manual'}])).toBeNull();
 expect(nextAutomaticCaption([{...c,timing:'failed'},{...c,contract:{...c.contract,enabled:false}},{...c,alignmentReady:false}])).toBeNull();
 const waiting={...c,timing:'waiting',taskId:'task',alignmentStatus:'completed'} as WorkspaceCaptionState;
 expect(nextAutomaticCaption([c,waiting])).toEqual({name:'applyWorkspaceCaptionAlignment',caption:waiting});
});
it('aligns a complete short adopted voice inside a longer shot and maps its actual offset',()=>{
 const input={audioItem:{kind:'audio',startFrame:45,durationInFrames:96,srcInFrame:0,playbackRate:1},audible:true,assetDurationInFrames:96,registeredDurationSeconds:3.177,fps:30,shotStartFrame:30,shotDurationInFrames:150};
 expect(captionAlignmentWindow(input)).toMatchObject({ready:true,offsetMs:500});
 for(const audioItem of [{...input.audioItem,srcInFrame:1},{...input.audioItem,playbackRate:1.2},{...input.audioItem,durationInFrames:60},{...input.audioItem,startFrame:20},{...input.audioItem,startFrame:100}])expect(captionAlignmentWindow({...input,audioItem}).ready).toBe(false);
 expect(captionAlignmentWindow({...input,audible:false}).ready).toBe(false);
 expect(captionAlignmentWindow({...input,audioItem:undefined}).ready).toBe(false);
});
it('maps source-relative cues into a shot and rejects cues outside the actual source or shot',()=>{
 const cues=[{id:'one',text:'字幕',startMs:100,endMs:900}];
 expect(captionCuesInShot(cues,500,2000,5000)).toEqual([{...cues[0],startMs:600,endMs:1400}]);
 expect(captionCuesInShot(cues,500,500,5000)).toBeNull();
 expect(captionCuesInShot(cues,4500,2000,5000)).toBeNull();
 const c={clipId:'one',contract:defaultShotCaptionContract('字幕','independent'),inputFingerprint:'one',timing:'waiting',audioTrackId:null,alignmentReady:false,taskId:'registered-only-task',alignmentStatus:'completed'} as WorkspaceCaptionState;
 expect(nextAutomaticCaption([c])).toBeNull();
});
