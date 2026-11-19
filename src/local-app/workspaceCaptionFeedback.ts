import type {WorkspaceCaptionState} from '../workspaceCaptions';

const missingAudio={
 status:'缺少声音，尚未自动校时',
 message:'请先在声音页采用口播或视频原声，再自动校时；不使用声音时，也可直接手工调整字幕时间。',
};
const outsideShot={
 status:'声音超出镜头，尚未自动校时',
 message:'请到剪辑台手动调整镜头或声音时长，使声音落在镜头内；也可直接手工调整字幕时间。系统不会自动修改时长。',
};
const editorOpen={
 status:'剪辑器仍打开，字幕暂未写回',
 message:'剪辑器仍打开，字幕结果暂未写回。请先在剪辑台保存并返回分镜台，再采用已有校时结果；无需重新识别。',
};
const pendingWrite={
 status:'字幕校时已完成，等待写回',
 message:'已有校时结果，无需重新识别。若剪辑器仍打开，请先保存并返回分镜台，再采用已有结果。',
};

/** Match proven backend reasons; a generic conflict is not proof of an open editor. */
export function captionFailureIssue(cause:unknown){
 const message=cause instanceof Error?cause.message:typeof cause==='string'?cause:'';
 if(message.includes('请先保存并返回，再采用声学对齐结果'))return editorOpen;
 if(message.includes('声音超出当前镜头范围'))return outsideShot;
 if(message.includes('请先采用当前成功口播或原声音轨')||message.includes('请先使用口播或视频原声'))return missingAudio;
 return null;
}

export function captionPreparationIssue(state:WorkspaceCaptionState|undefined){
 if(!state?.contract.enabled||state.timing==='current')return null;
 const issue=captionFailureIssue(state.detail);
 if(issue)return issue;
 if(!state.audioTrackId)return missingAudio;
 if(state.timing==='waiting'&&state.alignmentStatus==='completed'&&state.alignmentReady!==false)return pendingWrite;
 return null;
}
