// @vitest-environment node
import {readFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {expect,it} from 'vitest';

it('current execution sources cannot import or call retired workflow entries',()=>{
 const retired=/\b(?:configureScriptProduction|pauseScriptProduction|applyScriptSettings|bindScriptVideo|renderScriptReview|prepareScriptPublish|generate_input_shot_tts|plan_input_tasks|apply_episode_configuration_repair_v2|apply_external_connection_repair|queue_workspace_planning|replan_workspace_planning|save_planning_selection|script_production_scopes|record_episode_worker_preflight|input_worker_call|claim_input_task|codexRunner)\b|\b(?:generate_shot_clip|generate_shot_sync_preview|generate_shot_review_video|save_shot_preparation_draft|request_wan_shot_video|request_official_shot_video|save_shot_workbench_composition_draft|save_episode_tts_settings|request_review_render_revision|retry_failed_final_render|record_publish_package_verification)\s*\(|(?:from|import)\s*['"][^'"]*\/(?:wanCommands|studioCommands|deliveryCommands)(?:\.js)?['"]/;
 const violations:string[]=[];
 const cleanupSql=['202-remove-retired-manual-functions.sql','203-remove-unused-legacy-draft-writes.sql','204-remove-unreachable-legacy-residue.sql','205-remove-disconnected-workspace-wrappers.sql'].map(file=>readFileSync('db/current/'+file,'utf8')).join('\n');
 const removedFunctions=[...cleanupSql.matchAll(/^DROP FUNCTION IF EXISTS [^.]+\.([^(]+)\(.+ RESTRICT;$/gm)].map(m=>m[1]);
 expect(removedFunctions).toHaveLength(79);
 const removedCalls=new RegExp('\\b(?:'+removedFunctions.join('|')+')\\s*\\(|\\b(?:rpc|call)\\s*\\(\\s*[\'"](?:'+removedFunctions.join('|')+')[\'"]');
 const removedExports=/\b(?:requestReviewRevision|submitStudioReviewRevision|recoverFinalReviewRender)\b/;
 const scan=(path:string)=>{for(const entry of readdirSync(path,{withFileTypes:true})){const file=join(path,entry.name);if(entry.isDirectory()){if(file!=='src/lib/history'&&file!=='src/worker/history')scan(file);}else if(/\.(?:ts|tsx|mjs)$/.test(file)&&!/(?:\.test\.|\.fixture\.)/.test(file)&&file!=='scripts/e2e/clean-schema.mjs'){const source=readFileSync(file,'utf8');if(retired.test(source)||removedCalls.test(source)||removedExports.test(source))violations.push(file);}}};
 scan('src');scan('scripts');expect(violations).toEqual([]);
});
