import {createHash} from 'node:crypto';
import type {PoolClient} from 'pg';
import {ConfigurationError} from './configurationCommands.js';

export async function readGlobalPlanning(c:PoolClient){
 const defaults=(await c.query('SELECT selection,revision FROM local_identity.storyboard_planning_defaults WHERE owner_id=local_identity.owner_id()')).rows[0];
 const {rows:promptVersions}=await c.query(`SELECT *,true AS is_active FROM local_identity.storyboard_planning_harnesses
   WHERE owner_id=local_identity.owner_id() ORDER BY version DESC`);
 return {planningSelection:{selection:defaults?.selection??null,revision:defaults?.revision??0,promptVersions}};
}

export async function updateGlobalPlanning(c:PoolClient,command:unknown,value:unknown){
 if(!value||typeof value!=='object'||Array.isArray(value))throw new ConfigurationError(400,'规划请求格式无效。');
 const data=value as Record<string,unknown>;
 if(command!=='createGlobalPromptVersion'&&command!=='saveGlobalPlanningDefaults')throw new ConfigurationError(400,'不支持的规划操作。');
 await c.query('INSERT INTO local_identity.storyboard_planning_defaults(owner_id) VALUES(local_identity.owner_id()) ON CONFLICT DO NOTHING');
 const current=(await c.query('SELECT revision FROM local_identity.storyboard_planning_defaults WHERE owner_id=local_identity.owner_id() FOR UPDATE')).rows[0];
 if(command==='createGlobalPromptVersion'){
  const {name,summary,instructions}=data;
  if(typeof name!=='string'||!name.trim()||name.length>200||typeof summary!=='string'||!summary.trim()||summary.length>2000||typeof instructions!=='string'||!instructions.trim()||instructions.length>40000)throw new ConfigurationError(400,'请填写有效的版本名称、摘要和 Harness 内容。');
  return (await c.query(`WITH next AS (
    SELECT coalesce(max(version),0)+1 AS version FROM local_identity.storyboard_planning_harnesses WHERE owner_id=local_identity.owner_id()
   ) INSERT INTO local_identity.storyboard_planning_harnesses(owner_id,version,slug,name,summary,instructions,content_hash)
   SELECT local_identity.owner_id(),version,'storyboard-planning-v'||version,$1,$2,$3,$4 FROM next RETURNING id`,
   [name.trim(),summary.trim(),instructions.trim(),createHash('sha256').update(instructions.trim()).digest('hex')])).rows[0];
 }
 if(data.expectedSelectionRevision!==current.revision)throw new ConfigurationError(409,'全局设置已更新，请刷新后保存。');
 const {model,harnessId}=data.selection as Record<string,unknown>??{};
 if(typeof model!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,199}$/.test(model)||typeof harnessId!=='string'||!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(harnessId))throw new ConfigurationError(400,'请选择有效的模型与 Harness 版本。');
 const harness=await c.query('SELECT id FROM local_identity.storyboard_planning_harnesses WHERE owner_id=local_identity.owner_id() AND id=$1',[harnessId]);
 if(!harness.rowCount)throw new ConfigurationError(400,'请选择已登记的 Harness 版本。');
 const selection={provider:'codex',adapter:'codex',model,harnessId,budgetCents:null,allowedTools:['read','write']};
 await c.query('UPDATE local_identity.storyboard_planning_defaults SET selection=$1,revision=revision+1 WHERE owner_id=local_identity.owner_id()',[selection]);
 return readGlobalPlanning(c);
}
