import {uiText} from '../i18n/ui';
import {AlertCircle,CheckCircle2,Clock3,LoaderCircle,PencilLine} from 'lucide-react';
import type {EpisodeCatalog} from '../episodes/episodeCatalogTypes';
import type {EpisodeStage} from '../platform/types';
import type {Database} from '../lib/database.types';
import type {WorkerBlocker} from '../reviews/workerBlocker';

type Episode=Database['public']['Tables']['episodes']['Row'];
export type EpisodeActionState='draft'|'review'|'running'|'blocked'|'done';
export type EpisodeRowSummary=EpisodeCatalog['operationRows'][number];
const states={draft:{label:'准备中',icon:PencilLine},review:{label:'待审核',icon:Clock3},running:{label:'制作中',icon:LoaderCircle},blocked:{label:'需处理',icon:AlertCircle},done:{label:'已完成',icon:CheckCircle2}};
export function episodeActionState(episode:Episode,summary?:EpisodeRowSummary):EpisodeActionState {
 if(summary?.actionStatus)return summary.actionStatus;
 if(summary?.blockerCount)return 'blocked';
 if(summary?.reviewPending)return 'review';
 if(episode.stage==='production_completed')return 'done';
 return ['waiting_input','brief_draft','script_draft'].includes(episode.stage)?'draft':'running';
}
export function EpisodeStatus({state}:{state:EpisodeActionState}){const {label,icon:Icon}=states[state];return <span className={`episode-state episode-state-${state}`}><Icon aria-hidden="true" size={14}/>{uiText(label)}</span>;}
export const workflowStepLabels={script:'脚本确认',preparation:'分镜台',editing:'剪辑工作台',delivery:'检查与交付'} as const;
export const workspacePhaseGroups=Object.entries(workflowStepLabels).map(([id,label])=>({id:id as keyof typeof workflowStepLabels,label,stages:[] as EpisodeStage[]}));
export function episodeWorkflowLabel(summary?:EpisodeRowSummary){return summary?.workflowStep?uiText(workflowStepLabels[summary.workflowStep]):null;}
export function episodeBlockerLabel(blocker?:WorkerBlocker|null){
 if(!blocker)return null;
 if(blocker.code!=='provider_result_unknown')return uiText(blocker.detail);
 return uiText(blocker.taskType==='generate_narration'?'口播结果待核对':blocker.taskType==='generate_static_visual'?'图片结果待核对':'任务结果待核对');
}
export function episodeNextAction(episode:Episode,state:EpisodeActionState,summary?:EpisodeRowSummary){
 if(state==='blocked'&&summary?.blocker?.code==='provider_result_unknown')return{label:summary.blocker.taskType==='generate_narration'?'核对口播结果':'核对任务结果',detail:summary.blocker.detail};
 if(summary?.workflowStep){
  if(state==='done')return{label:uiText('查看交付包'),detail:uiText('核对成片与已保存的交付文件。')};
  if(state==='blocked')return{label:summary.workflowStep==='delivery'?'处理交付问题':'处理制作问题',detail:summary.blocker?.detail??'查看当前问题，处理后继续。'};
  if(state==='review')return{label:summary.workflowStep==='delivery'?'确认整片':summary.workflowStep==='script'?'确认脚本':'确认素材匹配',detail:summary.workflowStep==='delivery'?'观看实际成片，确认本次交付版本。':'核对当前内容并明确确认。'};
  return{label:summary.workflowStep==='script'?'继续确认脚本':summary.workflowStep==='preparation'?'继续准备素材':summary.workflowStep==='editing'?'继续剪辑':'继续检查与交付',detail:uiText('打开生产单，接着完成当前步骤。')};
 }

 if(state==='blocked')return {label:uiText('处理阻塞'),detail:uiText('查看当前问题，处理后继续制作。')};
 if(state==='review')return {label:uiText('继续审核'),detail:uiText('查看本次证据，决定通过或提出修改。')};
 if(state==='done')return {label:uiText('查看交付包'),detail:uiText('核对成片与已保存的交付文件。')};
 const next:Partial<Record<EpisodeStage,{label:string;detail:string}>>={
  waiting_input:{label:uiText('准备脚本与素材'),detail:uiText('补充本期输入，确认后开始制作。')},
  brief_draft:{label:uiText('继续准备输入'),detail:uiText('检查本期要求与已上传材料。')},
  script_draft:{label:uiText('继续准备脚本'),detail:uiText('核对当前脚本和所需材料。')},
  visual_draft:{label:uiText('继续视觉准备'),detail:uiText('检查视觉方案和当前任务。')},
  storyboard_draft:{label:uiText('继续分镜规划'),detail:uiText('检查分镜方案和当前任务。')},
  render_ready:{label:uiText('查看合成进度'),detail:uiText('查看当前任务与已有预览。')},
  qc_passed:{label:uiText('检查并完成交付'),detail:uiText('核对通过 QC 的成片及交付文件。')},
 };
 return next[episode.stage]??{label:uiText('继续制作'),detail:uiText('打开生产单，接着完成当前阶段。')};
}
export const episodePhaseGroups:Array<{label:string;stages:EpisodeStage[]}>= [
 {label:uiText('脚本'),stages:['waiting_input','brief_draft','script_draft','script_review','script_approved']},
 {label:uiText('视觉'),stages:['visual_draft','visual_review','visual_approved']},
 {label:uiText('分镜'),stages:['storyboard_draft','storyboard_review']},
 {label:uiText('镜头'),stages:['storyboard_approved','production_ready']},
 {label:uiText('合成'),stages:['render_ready']},
 {label:'QC',stages:['qc_review','qc_passed']},
 {label:uiText('交付'),stages:['production_completed']},
];
