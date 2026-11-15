// @vitest-environment node
import {readFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {expect,it} from 'vitest';

it('current execution sources cannot import or call retired workflow entries',()=>{
 const retired=/\b(?:configureScriptProduction|pauseScriptProduction|applyScriptSettings|bindScriptVideo|renderScriptReview|prepareScriptPublish|generate_input_shot_tts|plan_input_tasks|apply_episode_configuration_repair_v2|apply_external_connection_repair|queue_workspace_planning|replan_workspace_planning|save_planning_selection|script_production_scopes|record_episode_worker_preflight|input_worker_call|claim_input_task|codexRunner)\b/;
 const violations:string[]=[];
 const scan=(path:string)=>{for(const entry of readdirSync(path,{withFileTypes:true})){const file=join(path,entry.name);if(entry.isDirectory()){if(file!=='src/lib/history'&&file!=='src/worker/history')scan(file);}else if(/\.(?:ts|tsx|mjs)$/.test(file)&&!/(?:\.test\.|\.fixture\.)/.test(file)&&file!=='scripts/e2e/clean-schema.mjs'&&retired.test(readFileSync(file,'utf8')))violations.push(file);}};
 scan('src');scan('scripts');expect(violations).toEqual([]);
});
