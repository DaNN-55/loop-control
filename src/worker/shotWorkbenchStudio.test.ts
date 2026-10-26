import {it,expect} from 'vitest';
import {shotWorkbenchReviewRender} from './shotWorkbenchStudio';
import {confirmedTtsRender} from './openchatcutProject.fixture';
import {defaultShotComposition} from '../shotComposition';
it('Studio uses parallel-slot playback duration and retains selected soundtrack inputs',()=>{
 const original=confirmedTtsRender(),shot=original.confirmedShots[0],segments=[{startSeconds:0,endSeconds:4},{startSeconds:4,endSeconds:9}],composition=defaultShotComposition('2up-horizontal',2),contract={...shot.preparationContract,clipSegments:segments,composition};
 const soundtrack={memberKey:'bgm:episode',memberKind:'soundtrack' as const,audioKind:'bgm' as const,relativePath:'episodes/e/bgm.mp3',sha256:'c'.repeat(64),startSeconds:0,durationSeconds:4};
 const result=shotWorkbenchReviewRender('00000000-0000-4000-8000-000000000001','episodes/e/storyboard.json',{allowedFrames:2,frameRate:30,storyboard:{...original.storyboard,shots:[{...original.storyboard.shots[0],durationSeconds:4}]},materials:[{id:'material-1',relativePath:'episodes/e/source.mp4',sha256:'a'.repeat(64)}],audioTracks:[{id:'audio-track-1',cueId:'shot-1',relativePath:'episodes/e/voice.mp3',sha256:'b'.repeat(64),startSeconds:0,durationSeconds:4}],drafts:[{audioMode:'tts',audioTrackId:'audio-track-1',clipSegments:segments,composition,confirmationStatus:'confirmed',inputFingerprint:shot.inputFingerprint,materialRevisionId:'material-1',preparationContract:contract,shotId:'shot-1',subtitleText:shot.subtitleText,subtitlesEnabled:true,ttsText:shot.subtitleText,videoArtifactId:'video-artifact-1',videoTaskId:'video-task-1'}],soundtrackMembers:[soundtrack]});
 expect(result.members[0].durationSeconds).toBe(4);
 expect(result.members[0].clipSegments).toEqual(segments);
 expect(result.members.find(m=>m.memberKind==='narration')).toMatchObject({audioTrackId:'audio-track-1',startSeconds:0,durationSeconds:4});
 expect(result.members.find(m=>m.memberKind==='soundtrack')).toEqual(soundtrack);
 expect(result.confirmedShots[0].preparationContract).toBe(contract);
});
