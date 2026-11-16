import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';

/** Seed only recorded preparation rows; never reopen the retired registration API. */
export async function seedRecordedWorkspacePreparation(c:PoolClient,input:{episodeId:string;scriptRevisionId:string;preparationId:string;ownerId:string;file:{relativePath:string;sha256:string;fileSize:number};board:unknown}){
 const {episodeId,scriptRevisionId,preparationId,ownerId,file,board}=input;
 await c.query('BEGIN');
 try{
  const artifact=(await c.query("INSERT INTO public.artifacts(episode_id,artifact_type,relative_path,sha256,file_size) VALUES($1,'storyboard',$2,$3,$4) RETURNING id",[episodeId,file.relativePath,file.sha256,file.fileSize])).rows[0].id;
  await c.query("INSERT INTO public.review_packages(id,episode_id,artifact_id,stage,revision_number,context_snapshot) SELECT $1,$2,$3,'storyboard_review',coalesce(max(revision_number),0)+1,$4 FROM public.review_packages WHERE episode_id=$2 AND stage='storyboard_review'",[preparationId,episodeId,artifact,{worker_result:{storyboard:board},workspace_preparation:{script_revision_id:scriptRevisionId,origin:'script-segment'}}]);
  await c.query("INSERT INTO local_identity.workspace_preparations(package_id,episode_id,script_revision_id,origin,confirmed_by) VALUES($1,$2,$3,'script-segment',$4)",[preparationId,episodeId,scriptRevisionId,ownerId]);
  await c.query('UPDATE local_identity.input_episodes SET enabled=true,storyboard_enabled=true WHERE episode_id=$1',[episodeId]);
  await c.query('COMMIT');
 }catch(error){await c.query('ROLLBACK');throw error;}
}

/** Recorded pre-independent-model rows, with original project, draft, audio and frozen task. */
export function seedHistoricalPreparation(sql:(query:string)=>unknown){
  const owner=randomUUID(),account=randomUUID(),episode=randomUUID(),script=randomUUID(),board=randomUUID(),boardFile=randomUUID(),task=randomUUID(),audioFile=randomUUID(),audio=randomUUID(),workspace=randomUUID();
  sql(`BEGIN;
   INSERT INTO local_identity.owners(id,email) VALUES('${owner}','${owner}@example.invalid');
   INSERT INTO public.accounts(id,slug,name,timezone) VALUES('${account}','preserved-preparation','Historical project','Asia/Shanghai');
   INSERT INTO public.account_memberships(account_id,user_id,role) VALUES('${account}','${owner}','owner');
   INSERT INTO public.account_blueprint_versions(id,account_id,version,policy,is_active) VALUES('${account}','${account}',1,'{}',true);
   INSERT INTO public.episodes(id,account_id,blueprint_version_id,title,stage) VALUES('${episode}','${account}','${account}','Original project','script_approved');
   INSERT INTO public.production_material_revisions(id,episode_id,revision_number,material_type,source_kind,source_path,storage_path,mime_type,sha256,file_size,is_main_script,created_by,material_purpose) VALUES('${script}','${episode}',1,'script','file','original.md','original.md','text/markdown',repeat('a',64),7,true,'${owner}','main_script');
   UPDATE public.episodes SET main_script_revision_id='${script}' WHERE id='${episode}';
   INSERT INTO public.tasks(id,episode_id,task_type,status,input_snapshot) VALUES('${task}','${episode}','generate_narration','completed','{"legacyEvidence":"never resend or rewrite"}');
   INSERT INTO public.artifacts(id,episode_id,producer_task_id,artifact_type,relative_path,sha256,file_size) VALUES('${boardFile}','${episode}',NULL,'storyboard','original-board.json',repeat('b',64),123),('${audioFile}','${episode}','${task}','narration_audio','original-audio.mp3',repeat('c',64),456);
   INSERT INTO public.review_packages(id,episode_id,stage,revision_number,artifact_id,context_snapshot) VALUES('${board}','${episode}','storyboard_review',1,'${boardFile}','{"worker_result":{"storyboard":{"version":"storyboard/v1","shots":[{"id":"shot-01","scriptSegment":"保留原镜头","shotType":"b_roll"}]}}}');
   INSERT INTO local_identity.workspace_preparations(package_id,episode_id,script_revision_id,origin,confirmed_by) VALUES('${board}','${episode}','${script}','legacy-board','${owner}');
   INSERT INTO public.audio_tracks(id,episode_id,source_task_id,source_artifact_id,source_review_package_id,track_kind,cue_id,relative_path,sha256,file_size,duration_seconds) VALUES('${audio}','${episode}','${task}','${audioFile}','${board}','narration','shot-01','original-audio.mp3',repeat('c',64),456,2.4);
   INSERT INTO public.shot_preparation_drafts(episode_id,review_package_id,shot_id,audio_mode,subtitle_text,tts_text,current_audio_track_id) VALUES('${episode}','${board}','shot-01','source','原字幕','原采用口播','${audio}');
   INSERT INTO local_identity.production_workspaces(id,episode_id,script_revision_id,storyboard_package_id,bindings,project_path,project_sha256,project_size,content_sha256,native_edit_revision) VALUES('${workspace}','${episode}','${script}','${board}','[{"id":"manual-clip","itemId":"manually-edited-item","shotId":"shot-01","text":"保留人工编辑","source":null}]','original-project.json',repeat('d',64),789,repeat('e',64),3);
   INSERT INTO local_identity.workspace_shot_inputs(workspace_id,preparation_id,shot_id,origin,baseline_text,shot_type,snapshot) VALUES('${workspace}','${board}','shot-01','legacy-board','保留原镜头','b_roll','{"id":"shot-01","scriptSegment":"保留原镜头","shotType":"b_roll"}');
   INSERT INTO local_identity.production_workspace_versions(workspace_id,episode_id,revision,script_revision_id,storyboard_package_id,project_path,project_sha256,project_size,content_sha256,reason,created_by) VALUES('${workspace}','${episode}',1,'${script}','${board}','original-project.json',repeat('d',64),789,repeat('e',64),'Original manual edit','${owner}');
   COMMIT;`);
 return{owner,account,episode,script,board,boardFile,task,audioFile,audio,workspace};
}
