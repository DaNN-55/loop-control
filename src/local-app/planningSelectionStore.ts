import type {PoolClient} from 'pg';
import {ConfigurationError} from './configurationCommands.js';
export async function readWorkspacePlanningSelection(c:PoolClient,episodeId:string){
 const draft=(await c.query('SELECT selection,revision FROM local_identity.episode_planning_selections WHERE episode_id=$1',[episodeId])).rows[0]??{selection:null,revision:0};
 const promptVersions=(await c.query("SELECT h.* FROM public.prompt_versions h JOIN public.episodes e ON e.account_id=h.account_id WHERE e.id=$1 AND h.capability='storyboard_planning' ORDER BY h.version DESC",[episodeId])).rows;
 const accountId=(await c.query('SELECT account_id FROM public.episodes WHERE id=$1',[episodeId])).rows[0]?.account_id;
 return{...draft,accountId,promptVersions};
}
export async function saveWorkspacePlanningSelection(c:PoolClient,episodeId:string,data:Record<string,unknown>){
 if(!Number.isSafeInteger(data.expectedSelectionRevision)||Number(data.expectedSelectionRevision)<0)throw new ConfigurationError(400,'缺少当前规划选择版本，请刷新。');
 try{return(await c.query('SELECT local_identity.save_planning_selection($1,$2,$3) result',[episodeId,JSON.stringify(data.selection),data.expectedSelectionRevision])).rows[0].result;}catch(error){const code=(error as {code?:string}).code;if(code==='40001')throw new ConfigurationError(409,'规划选择已变化，请刷新后保存。');if(code==='22023'||code==='22P02')throw new ConfigurationError(400,'请选择当前账号已启用的分镜 Harness、有效 Codex 模型、非负额度和文件工具。');throw error;}
}
