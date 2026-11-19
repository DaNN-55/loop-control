import {createHash,randomUUID} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import type {PoolClient} from 'pg';
import type {OpenChatCutProject} from '../worker/openchatcutProject.js';
import type {ProductionWorkspaceRecord} from './productionWorkspaceCommands.js';
import {episodeFileIO} from './episodeFiles.js';
import {requireConfirmedWorkspaceExport} from './workspaceExportCommands.js';
import {safeAssetOutputPath} from '../worker/controlledMediaExecutor.js';
import {recordValidatedRequestLogContext} from './runtimeRequestLog.js';

/** Queue only the already confirmed bytes. A second click resumes the same active result. */
export async function queueWorkspaceCoreDelivery(c:PoolClient,root:string,row:ProductionWorkspaceRecord,project:OpenChatCutProject){
 const confirmed=await requireConfirmedWorkspaceExport(c,root,row,project);
 const prior=(await c.query("SELECT d.task_id FROM local_identity.workspace_deliveries d JOIN public.tasks t ON t.id=d.task_id WHERE d.workspace_id=$1 AND d.export_id=$2 AND t.status IN ('ready','running','completed') ORDER BY d.created_at DESC LIMIT 1",[row.id,confirmed.id])).rows[0];
 if(prior){recordValidatedRequestLogContext({taskId:prior.task_id});return;}
 const storage=await episodeFileIO(c,root,row.episode_id,true),id=randomUUID(),prefix=`${storage.relativePath}/workspace-deliveries/${id}`;
 const bytes=Buffer.from(JSON.stringify({passed:true,exportId:confirmed.id,contentSha256:confirmed.contentSha256,checks:confirmed.checks},null,2)+'\n');
 const checks={artifactType:'final_qc_report',relativePath:`${prefix}/checks.json`,sha256:createHash('sha256').update(bytes).digest('hex'),fileSize:bytes.length};
 await writeFile(await safeAssetOutputPath(root,checks.relativePath),bytes,{flag:'wx',mode:0o600});
 const identity={workspaceId:row.id,exportId:confirmed.id,projectContentVersion:confirmed.projectContentVersion,contentSha256:confirmed.contentSha256,video:{artifactType:'final_render',...confirmed.artifact},project:{artifactType:'editable_project',...confirmed.project}};
 const artifacts=[identity.video,identity.project,checks],snapshot={capability:'workspace_delivery',workspace_delivery:{version:'publish-package/v3',identity,artifacts},input_artifacts:artifacts,output:{relative_path:`${prefix}/manifest.json`,required_artifact_types:['publish_package'],content_type:'application/json'}};
 const queued=(await c.query('SELECT local_identity.queue_workspace_delivery($1,$2,$3,$4) task_id',[id,row.id,confirmed.id,snapshot])).rows[0];
 recordValidatedRequestLogContext({taskId:queued?.task_id});
}
