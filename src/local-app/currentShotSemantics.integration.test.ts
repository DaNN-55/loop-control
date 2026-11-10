// @vitest-environment node
import {it,expect} from 'vitest';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {resolveWorkspaceVisualLineage} from './workspaceVisualCandidates';
import {formalWorkflowFixture} from './formalWorkflow.fixture';
import {workspaceTestMedia} from './workspaceTestMedia.fixture';
import {productionScriptTemplate} from '../reviews/productionScript';

it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1').each(['new','legacy-script','plain'])('current %s script → neutral workspace → actual video queue and Worker',async kind=>{
 const text=kind==='plain'?'# 新镜头\n\n## 正文\n窗边的灯亮着。\n\n门外传来脚步声。':kind==='legacy-script'?productionScriptTemplate.replace('### 段落 01','### 段落 01\n- 镜头类型：a_roll'):productionScriptTemplate;
 const f=await formalWorkflowFixture({controlled:true,scriptText:text,configurePlanning:false});
 try{
  expect((await f.send('start')).status).toBe(200);
  let r=await f.send('prepareWorkspace',{expectedScriptRevisionId:f.main});expect(r.status,JSON.stringify(r.body)).toBe(200);let w=r.body;
  expect(w.preparation.shots.length).toBeGreaterThan(0);expect(w.preparation.shots.every((s:any)=>!('shotType'in s))).toBe(true);
  const rows=(await f.c.query('SELECT shot_type,snapshot FROM local_identity.workspace_shot_inputs WHERE workspace_id=$1',[w.id])).rows;expect(rows.length).toBe(w.clips.length);expect(rows.every(s=>s.shot_type===null&&!('shotType'in s.snapshot))).toBe(true);
  const obsolete=await f.send('confirmWorkspaceShot',{workspaceId:w.id,expectedRevision:w.revision,clipId:w.clips[0].id,shotType:'a_roll'});expect(obsolete.status).toBe(400);
  if(kind==='new'){
   const old=await f.controlled!.request('prepareWorkspace',{reviewPackageId:f.board,expectedScriptRevisionId:f.script});expect(old.status,JSON.stringify(old.body)).toBe(200);
   const legacy=(await f.c.query('SELECT * FROM local_identity.production_workspaces WHERE id=$1',[old.body.id])).rows[0],shotId=old.body.clips[0].shotId;
   const before=(await f.c.query('SELECT snapshot FROM local_identity.workspace_shot_inputs WHERE workspace_id=$1 AND shot_id=$2',[legacy.id,shotId])).rows[0].snapshot;expect(['a_roll','b_roll']).toContain(before.shotType);
   await f.c.query('UPDATE local_identity.workspace_shot_inputs SET shot_type=NULL WHERE workspace_id=$1 AND shot_id=$2',[legacy.id,shotId]);
   expect((await resolveWorkspaceVisualLineage(f.c,legacy,shotId)).shotType).toBe(before.shotType);
  }
  // Input kinds stay authoritative; a visual_reference video is usable without A/B registration.
  const sourceVideo=join(f.assetRoot,'long-shot.mp4');await promisify(execFile)('ffmpeg',['-nostdin','-v','error','-stream_loop','-1','-i',workspaceTestMedia('landscape-red-blue.mp4'),'-t','8','-c','copy',sourceVideo]);
  const imported=await f.send('importMaterial',{sourceKind:'file',sourcePath:'unified-shot.mp4',materialType:'video',materialPurpose:'visual_reference',mimeType:'video/mp4',isMainScript:false,contentBase64:(await readFile(sourceVideo)).toString('base64')});expect(imported.status,JSON.stringify(imported.body)).toBe(200);
  expect((await f.c.query('SELECT material_purpose FROM public.production_material_revisions WHERE id=$1',[imported.body.id])).rows[0].material_purpose).toBe('visual_reference');
  r=await f.send('matchWorkspaceMaterial',{workspaceId:w.id,expectedRevision:w.revision,clipId:w.clips[0].id,materialRevisionId:imported.body.id});expect(r.status,JSON.stringify(r.body)).toBe(200);w=r.body;expect(w.clips[0].source.kind).toBe('video');
  const image=await f.send('importMaterial',{sourceKind:'file',sourcePath:'first-frame.png',materialType:'image',materialPurpose:'visual_reference',mimeType:'image/png',isMainScript:false,contentBase64:(await readFile(workspaceTestMedia('still-striped.png'))).toString('base64')});expect(image.status).toBe(200);
  r=await f.chosenSend('requestWorkspaceVisualCandidate',{workspaceId:w.id,expectedRevision:w.revision,targetItemId:w.clips[0].itemId,firstFrameMaterialRevisionId:image.body.id,prompt:'灯光缓慢变化。',durationSeconds:4,reservationCents:90});expect(r.status,JSON.stringify(r.body)).toBe(200);w=r.body;
  const task=w.visualTasks[0],frozen=(await f.c.query('SELECT request_snapshot FROM local_identity.workspace_visual_candidates WHERE task_id=$1',[task.taskId])).rows[0].request_snapshot;
  expect(frozen.capability).toBe('video');expect(frozen.selection.capability).toBe('video');expect(frozen).not.toHaveProperty('shotType');
  // Legacy Worker DTO remains replayable, while current authoring and selection are neutral.
  const taskRow=(await f.c.query('SELECT task_type,input_snapshot FROM public.tasks WHERE id=$1',[task.taskId])).rows[0];expect(taskRow.task_type).toBe('generate_shot_video');expect(taskRow.input_snapshot.capability).toBe('shot_video_generation');expect(taskRow.input_snapshot.output.required_artifact_types).toEqual(['shot_video']);expect(taskRow.input_snapshot.media.video).toBeTruthy();expect(taskRow.input_snapshot.media).not.toHaveProperty('wan_video');expect(taskRow.input_snapshot.shot).not.toHaveProperty('shotType');expect(taskRow.input_snapshot.production_selection.capability).toBe('video');
  expect((await f.controlled!.execute(task.taskId))?.status).toBe('completed');
  const read=await fetch(`${f.origin}/api/local/episodes/${f.newEpisode}/workspace`,{headers:{Cookie:'loop_owner_session='+f.token}});expect(read.status).toBe(200);const actual=(await read.json()).workspace;expect(actual.visualTasks[0].status).toBe('completed');expect(actual.visualCandidates[0].kind).toBe('video');expect(actual.project.sha256).toBe(w.project.sha256);
 }finally{await f.close();}
},120000);
