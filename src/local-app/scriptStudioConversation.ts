import type {PoolClient} from 'pg';
import {scriptStudioContractVersion,type ScriptStudioConversation,type ScriptStudioMessage,type ScriptStudioResult,type ScriptStudioMode} from '../scriptStudio.js';
import {ConfigurationError} from './configurationCommands.js';
export interface StudioConversationScope {episodeId:string;expectedScriptRevisionId:string|null;text:string;targetDuration:number|null}
interface ConversationRow {id:string;model?:string;owner_id:string;episode_id:string;script_revision_id:string|null;source_text:string;status:string;result:ScriptStudioResult|null;request_snapshot:{version:string;selection?:{provider?:string};data:{targetDuration:number|null;mode:ScriptStudioMode|'discuss';instruction?:string;turnInstruction?:string;previousRequestId?:string|null};manualEdit?:{index:number};manualDelete?:{index:number}}}
const outcome=(row:ConversationRow):ScriptStudioResult=>row.result??{requestId:row.id,status:row.status==='unknown'?'unknown':'pending',message:'本次请求已提交，核对不会重复调用模型。'};
/** Recover only the server-owned receipt chain for this exact source, never client chat JSON. */
export async function readStudioConversation(c:PoolClient,owner:string,scope:StudioConversationScope,requestId?:string):Promise<ScriptStudioConversation&{conversation:ScriptStudioMessage[]}>{
 const empty={turns:[],result:null,mode:'optimize' as const,conversation:[]};
 if(!requestId){const last=(await c.query("SELECT id FROM local_identity.script_format_requests WHERE owner_id=$1 AND episode_id=$2 AND script_revision_id IS NOT DISTINCT FROM $3::uuid AND source_text=$4 AND request_snapshot->>'version'=$5 AND request_snapshot->'data'->'targetDuration'=$6::jsonb ORDER BY created_at DESC,id DESC LIMIT 1",[owner,scope.episodeId,scope.expectedScriptRevisionId,scope.text,scriptStudioContractVersion,JSON.stringify(scope.targetDuration)])).rows[0];if(!last)return empty;requestId=last.id;}
 const rows=(await c.query("WITH RECURSIVE chain AS (SELECT r.*,0 AS depth FROM local_identity.script_format_requests r WHERE r.owner_id=$1 AND r.episode_id=$2 AND r.id=$3 UNION ALL SELECT p.*,n.depth+1 FROM local_identity.script_format_requests p JOIN chain n ON p.owner_id=n.owner_id AND p.episode_id=n.episode_id AND p.id=(n.request_snapshot->'data'->>'previousRequestId')::uuid WHERE n.depth<255) SELECT * FROM chain ORDER BY depth",[owner,scope.episodeId,requestId])).rows as ConversationRow[];
 if(!rows.length)throw new ConfigurationError(409,'对话上下文已不可用，请重新打开核对。');
 const ids=new Set<string>();for(let index=0;index<rows.length;index++){const r=rows[index],parent=r.request_snapshot?.data?.previousRequestId;if(ids.has(r.id)||r.owner_id!==owner||r.episode_id!==scope.episodeId||r.script_revision_id!==scope.expectedScriptRevisionId||r.source_text!==scope.text||r.request_snapshot?.version!==scriptStudioContractVersion||r.request_snapshot.data.targetDuration!==scope.targetDuration||parent&&rows[index+1]?.id!==parent||!parent&&index!==rows.length-1)throw new ConfigurationError(409,'对话上下文与当前原文、时长或脚本版本不一致。');ids.add(r.id);}
 const derived=new Map<string,ScriptStudioResult>();let modified=new Set<number>();
 for(const row of [...rows].reverse())if(row.status==='completed'&&row.result?.plan){
  if(row.result.modifiedShotIndexes)modified=new Set(row.result.modifiedShotIndexes);
  else if(row.request_snapshot.manualEdit)modified.add(row.request_snapshot.manualEdit.index);
  else modified.clear();
  const count=row.result.plan.shots.length,indexes=[...modified].filter(index=>Number.isInteger(index)&&index>=0&&index<count).sort((a,b)=>a-b);
  derived.set(row.id,indexes.length?{...row.result,modifiedShotIndexes:indexes}:row.result);
 }
 const plan=rows.find(r=>r.status==='completed'&&r.result?.plan),latest=derived.get(rows[0].id)??outcome(rows[0]);
 const turns=[...rows].reverse().map(r=>{const manual=!!(r.request_snapshot.manualEdit||r.request_snapshot.manualDelete);return{requestId:r.id,mode:manual?'edit' as const:r.request_snapshot.data.mode,...(!manual&&r.model?{model:r.model,provider:r.request_snapshot.selection?.provider??(r.model.startsWith('deepseek')?'deepseek':'openai')}:{}),instruction:r.request_snapshot.manualDelete?'手动删除第 '+(r.request_snapshot.manualDelete.index+1)+' 个镜头':r.request_snapshot.manualEdit?'手动修改第 '+(r.request_snapshot.manualEdit.index+1)+' 个镜头':(r.request_snapshot.data.turnInstruction??r.request_snapshot.data.instruction)||'优化拍法',answer:manual?r.result?.message??'镜头修改已保存，仍需采用。':r.result?.plan?.summary??r.result?.message??'本次请求尚未返回。',status:outcome(r).status};});
 const conversation=turns.filter(t=>t.status==='completed').flatMap(t=>[{role:'user' as const,content:t.instruction},{role:'assistant' as const,content:t.answer}]);
 return{turns,result:plan?derived.get(plan.id)??plan.result:null,latest,latestRequestId:rows[0].id,mode:plan?.request_snapshot.data.mode==='adapt'?'adapt':'optimize',conversation};
}
