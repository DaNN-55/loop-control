import {expect,it} from 'vitest';
import {captionPreparationIssue,captionFailureIssue} from './workspaceCaptionFeedback';
import type {WorkspaceCaptionState} from '../workspaceCaptions';
const state={contract:{enabled:true},timing:'stale',audioTrackId:null,alignmentReady:false} as WorkspaceCaptionState;
it('explains missing audio without claiming a recognition failure or overwriting manual completion',()=>{
 expect(captionPreparationIssue(state)?.message).toContain('采用');
 expect(captionPreparationIssue(state)?.status).toContain('缺少声音');
 expect(captionPreparationIssue({...state,timing:'current',alignmentMethod:'manual'})).toBeNull();
 expect(captionPreparationIssue({...state,contract:{...state.contract,enabled:false}})).toBeNull();
});
it('explains the shot boundary issue as an owner adjustment, not a retry or automatic duration change',()=>{
 const issue=captionPreparationIssue({...state,audioTrackId:'audio',detail:'声音超出当前镜头范围，请在剪辑台调整，或手工调整字幕。'});
 expect(issue?.status).toContain('声音超出镜头');expect(issue?.message).toContain('手动调整');
});
it('recognizes explicit backend reasons and does not label every conflict as an open editor',()=>{
 expect(captionFailureIssue(new Error('请先保存并返回，再采用声学对齐结果。'))?.message).toContain('无需重新识别');
 expect(captionFailureIssue('请先采用当前成功口播或原声音轨，再对齐字幕。')?.status).toContain('缺少声音');
 expect(captionFailureIssue('声音超出当前镜头范围，请在剪辑台调整，或手工调整字幕。')?.status).toContain('声音超出镜头');
 expect(captionFailureIssue(new Error('409 对齐结果已过期或尚未完成'))).toBeNull();
});
