import type {Pool} from 'pg';
import {canonical} from './configurationCommands.js';
import {verifyNativeFile} from './localFiles.js';
import {workspaceCandidateTarget} from '../workspaceCandidates.js';
import {workspaceVisualVoiceIdentity} from '../workspaceVisualCandidates.js';
import type {OpenChatCutProject} from '../worker/openchatcutProject.js';
/** Read the real committed project, not a second editable state or an old TTS draft. */
export async function assertWorkspaceVisualExecution(pool:Pool,fence:{p_task_id:string;p_attempt:number;p_lease_token:string}){
 const current=(await pool.query('SELECT local_identity.workspace_visual_execution_input($1,$2,$3) input',[fence.p_task_id,fence.p_attempt,fence.p_lease_token])).rows[0]?.input;if(!current)return;
 const project=JSON.parse((await verifyNativeFile(current.root,current.path,current.sha256,Number(current.fileSize))).toString('utf8')) as OpenChatCutProject,item=project.timelines.flatMap(t=>t.items).find(i=>i.id===current.targetItemId),json=(value:unknown)=>JSON.stringify(canonical(value));
 if(!item||json(workspaceCandidateTarget(item))!==json(current.target)||workspaceVisualVoiceIdentity(project,current.shotId)!==current.mainVoice.identity)throw Error('实际主声音窗口或目标画面已变化，旧画面任务尚未提交。');
 const source=current.mainVoice.source;if(source)await verifyNativeFile(current.root,source.relativePath,source.sha256,Number(source.fileSize));
}
