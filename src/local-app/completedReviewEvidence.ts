import type {ProductionWorkspace} from '../productionWorkspace';
import shiyeFrames from '../../docs/verification/repo-cleanup-production-20261115/production/shiye-six-frames.png';
import qiaoqianFrames from '../../docs/verification/repo-cleanup-production-20261115/production/qiaoqian-corrected-review.png';

// Imported observations, not editable production issues. Source: the 2026-11-16
// production review REPORT.md, lines 24–25. Bind to exact bytes, never just a title.
const observations=[
 {episodeId:'09f36e43-c876-4481-be74-7e2a0d2564bd',exportSha256:'3888b2d7e67dd2045f1e255c72f92f971154628f1f4d7de4006bb83fec71fb14',state:'未解决',shotId:'shot-01',text:'首镜实帧出现三行字幕，与两行模板上限不符。',image:shiyeFrames},
 {episodeId:'09f36e43-c876-4481-be74-7e2a0d2564bd',exportSha256:'3888b2d7e67dd2045f1e255c72f92f971154628f1f4d7de4006bb83fec71fb14',state:'待核对',shotId:null,text:'同批测试另记录局部挂绳／边缘出框，未指明具体成片与镜头；本片严格构图仍待核对。',image:null},
 {episodeId:'96774cd7-1fff-4feb-b03c-c3568bb2e718',exportSha256:'50a5626d676098ff5abe57376eb8a63b30cd7ae987a608b02a1f046fb982d347',state:'已替换',shotId:'shot-01',text:'旧开场曾生成无关题字挂画；本次交付已采用空墙修正版。旧候选和导出仍保留。',image:qiaoqianFrames},
 {episodeId:'96774cd7-1fff-4feb-b03c-c3568bb2e718',exportSha256:'50a5626d676098ff5abe57376eb8a63b30cd7ae987a608b02a1f046fb982d347',state:'待核对',shotId:null,text:'同批测试另记录局部挂绳／边缘出框，未指明具体成片与镜头；本片严格构图仍待核对。',image:null},
];
export function completedReviewEvidence(w:ProductionWorkspace){
 return observations.filter(note=>note.episodeId===w.episodeId&&w.exports?.some(e=>e.artifact?.sha256===note.exportSha256));
}
