import {verifyEpisodeFile} from './episodeFiles.js';
import type {PoolClient} from 'pg';
import {basename} from 'node:path';
import {createHash} from 'node:crypto';
import {ConfigurationError} from './configurationCommands.js';
import {snapshotInput} from './localFiles.js';
import {parseStoryboardScript} from '../reviews/productionScript.js';

export async function reconfirmScript(c:PoolClient,root:string,episode:{id:string;main_script_revision_id:string|null;stage:string;archived_at:string|null},data:Record<string,unknown>,directoryRelativePath=`episodes/${episode.id}`){
 if(typeof data.expectedScriptRevisionId!=='string'||data.expectedScriptRevisionId!==episode.main_script_revision_id||episode.archived_at||episode.stage==='production_completed')throw new ConfigurationError(409,'当前脚本版本或生产单状态已变化，请刷新。');
 if(typeof data.text!=='string'||!data.text.trim()||Buffer.byteLength(data.text)>2*1024*1024||typeof data.reason!=='string'||!data.reason.trim()||data.reason.length>4000)throw new ConfigurationError(400,'请填写有效脚本和修订原因。');
 const old=(await c.query("SELECT * FROM public.production_material_revisions WHERE id=$1 AND episode_id=$2 AND is_main_script",[episode.main_script_revision_id,episode.id])).rows[0];
 if(!old)throw new ConfigurationError(409,'当前主脚本不存在。');
 await verifyEpisodeFile(c,root,episode.id,old.storage_path,old.sha256,Number(old.file_size));
 if(createHash('sha256').update(data.text).digest('hex')===old.sha256)throw new ConfigurationError(400,'脚本内容未改变。');
 if((await c.query("SELECT 1 FROM public.tasks WHERE episode_id=$1 AND status='running' LIMIT 1",[episode.id])).rowCount)throw new ConfigurationError(409,'制作任务正在运行，请完成或停止后修订脚本。');
 const snapshot=await snapshotInput(root,episode.id,{sourceKind:'file',sourcePath:basename(old.source_path),contentBase64:Buffer.from(data.text).toString('base64'),isMainScript:true},directoryRelativePath);
 const result=(await c.query('SELECT to_jsonb(local_identity.reconfirm_episode_script($1,$2,$3,$4,$5,$6,$7)) result',[episode.id,old.id,snapshot.sourcePath,snapshot.storagePath,snapshot.sha256,snapshot.fileSize,data.reason.trim()])).rows[0].result;
 await c.query('UPDATE local_identity.input_episodes SET script_template_version=$2 WHERE episode_id=$1',[episode.id,parseStoryboardScript(data.text)?2:null]);
 return result;
}
