import {expect,it} from 'vitest';
import {completedReviewEvidence} from './completedReviewEvidence';
import type {ProductionWorkspace} from '../productionWorkspace';
it('binds imported review observations to the exact exported file, without changing issue records',()=>{
 const w={episodeId:'09f36e43-c876-4481-be74-7e2a0d2564bd',exports:[{artifact:{sha256:'3888b2d7e67dd2045f1e255c72f92f971154628f1f4d7de4006bb83fec71fb14'}}],exportIssues:[]} as unknown as ProductionWorkspace;
 const before=JSON.stringify(w);expect(completedReviewEvidence(w).some(note=>note.text.includes('三行字幕'))).toBe(true);
 expect(completedReviewEvidence({...w,exports:[{...w.exports![0],artifact:{relativePath:'other.mp4',sha256:'other',fileSize:1}}]})).toEqual([]);
 expect(JSON.stringify(w)).toBe(before);
});
