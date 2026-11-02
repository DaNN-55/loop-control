// @vitest-environment node
import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {connectionCatalogFixture} from './connectionCatalog.fixture';
import {ownerTransaction} from './ownerTransaction';
import {resolveProductionSelection} from './productionSelection';
it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE)('reports exact owned version references through HTTP and revokes without replacing frozen task inputs',async()=>{
 const f=await connectionCatalogFixture();
 try{
  const created=await f.command('create',{name:'Impact fixture',provider:'openai',adapter:'openai_images',secret:'synthetic-openai-key'});expect(created.status).toBe(200);const c=created.body.connection,old=c.current_version_id;
  const rotated=await f.command('rotate',{connectionId:c.id,provider:'openai',adapter:'openai_images',secret:'synthetic-openai-key'});expect(rotated.status).toBe(200);const current=rotated.body.connection.current_version_id;
  const account=(await f.admin.query('SELECT account_id FROM public.account_memberships WHERE user_id=$1',[f.owner])).rows[0].account_id;
  const blueprint=randomUUID(),episode=randomUUID(),task=randomUUID();const frozen={credential_ref:old,production_selection:{connectionVersionId:old},note:'Frozen request'};
  await f.admin.query('INSERT INTO public.account_blueprint_versions(id,account_id,version,policy,is_active)VALUES($1,$2,1,$3,true)',[blueprint,account,{media:{static_visual:{credential_ref:old}},notes:current+'-not-a-reference'}]);
  await f.admin.query('UPDATE public.accounts SET current_blueprint_version_id=$1 WHERE id=$2',[blueprint,account]);
  await f.admin.query("INSERT INTO public.episodes(id,account_id,blueprint_version_id,title,stage)VALUES($1,$2,$3,'Frozen impact','production_ready')",[episode,account,blueprint]);
  await f.admin.query("INSERT INTO public.tasks(id,episode_id,task_type,status,input_snapshot)VALUES($1,$2,'generate_b_roll','ready',$3)",[task,episode,frozen]);
  const initialDetail=await fetch(f.origin+'/api/local/episodes/'+episode,{headers:{Cookie:'loop_owner_session='+f.token}});expect(initialDetail.status).toBe(200);const originalTask=(await initialDetail.json()).patches.tasks.rows.find((row:{id:string})=>row.id===task).input_snapshot;expect(originalTask).toMatchObject(frozen);
  const beforeReads=f.secretReads,before=await f.request();expect(before.status).toBe(200);
  expect(before.body.versions.find((v:{id:string})=>v.id===old).usage).toEqual({currentBlueprints:1,episodes:1,tasks:1,activeTasks:1,requests:0,savedSelections:0});
  expect(before.body.versions.find((v:{id:string})=>v.id===current).usage).toEqual({currentBlueprints:0,episodes:0,tasks:0,activeTasks:0,requests:0,savedSelections:0});
  expect((await f.request(undefined,f.otherToken)).body.versions).toEqual([]);expect((await f.request(undefined,'')).status).toBe(401);expect(f.secretReads).toBe(beforeReads);
  expect((await f.command('revoke',{versionId:old},f.token,false)).status).toBe(403);expect((await f.command('revoke',{versionId:old},f.otherToken)).status).toBe(404);
  expect((await f.command('revoke',{versionId:old})).status).toBe(200);const after=await f.request();expect(after.body.versions.find((v:{id:string})=>v.id===old)).toMatchObject({status:'revoked',usage:{episodes:1,tasks:1,activeTasks:1}});expect(after.body.connections[0].current_version_id).toBe(current);
  const detail=await fetch(f.origin+'/api/local/episodes/'+episode,{headers:{Cookie:'loop_owner_session='+f.token}});expect(detail.status).toBe(200);const production=await detail.json();expect(production.patches.tasks.rows.find((row:{id:string})=>row.id===task).input_snapshot).toEqual(originalTask);
  expect(f.secretReads).toBe(beforeReads);expect(JSON.stringify(after.body)).not.toContain('synthetic-openai-key');
 }finally{await f.close();}
},60000);
it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE)('includes saved music and narration defaults with no queued task and excludes foreign workspace references',async()=>{
 const f=await connectionCatalogFixture();
 try{
  const music=(await f.command('create',{name:'Default music',provider:'freesound',adapter:'freesound_preview',secret:'synthetic-freesound-key'})).body.connection;
  const voice=(await f.command('create',{name:'Default voice',provider:'volcengine_tts',adapter:'volcengine_tts',secret:'synthetic-voice-key'})).body.connection;
  const musicDefaults={selection:{capability:'music_sound',provider:'freesound',adapter:'freesound_preview',model:'freesound-preview-v1',connectionVersionId:music.current_version_id}};
  const narrationDefaults={selection:{capability:'speech',provider:'volcengine_tts',adapter:'volcengine_tts',model:'seed-tts-2.0',connectionVersionId:voice.current_version_id}};
  async function workspace(owner:string){
   const account=randomUUID(),episode=randomUUID(),script=randomUUID(),board=randomUUID(),id=randomUUID();
   await f.admin.query("INSERT INTO public.accounts(id,slug,name,timezone)VALUES($1,$2,'Default-only fixture','UTC')",[account,'default-'+account]);await f.admin.query("INSERT INTO public.account_memberships(account_id,user_id,role)VALUES($1,$2,'owner')",[account,owner]);
   await f.admin.query('INSERT INTO public.account_blueprint_versions(id,account_id,version,policy,is_active)VALUES($1,$1,1,$2,true)',[account,{}]);await f.admin.query('UPDATE public.accounts SET current_blueprint_version_id=$1 WHERE id=$1',[account]);
   await f.admin.query("INSERT INTO public.episodes(id,account_id,blueprint_version_id,title,stage)VALUES($1,$2,$2,'Defaults only','production_ready')",[episode,account]);
   await f.admin.query("INSERT INTO public.production_material_revisions(id,episode_id,revision_number,material_type,source_kind,source_path,storage_path,mime_type,sha256,file_size,created_by)VALUES($1,$2,1,'script','paste','fixture','fixture','text/plain',$3,1,$4)",[script,episode,'a'.repeat(64),owner]);
   await f.admin.query("INSERT INTO public.review_packages(id,episode_id,stage,revision_number,context_snapshot)VALUES($1,$2,'storyboard_review',1,'{}')",[board,episode]);
   await f.admin.query("INSERT INTO local_identity.production_workspaces(id,episode_id,script_revision_id,storyboard_package_id,bindings,project_path,project_sha256,content_sha256,project_size,music_defaults,narration_defaults)VALUES($1,$2,$3,$4,'[]','fixture',$5,$5,1,$6,$7)",[id,episode,script,board,'a'.repeat(64),musicDefaults,narrationDefaults]);
   return{id,episode};
  }
  await workspace(f.owner);await workspace(f.other);const beforeReads=f.secretReads,read=await f.request();expect(read.status).toBe(200);
  for(const c of [music,voice])expect(read.body.versions.find((v:{id:string})=>v.id===c.current_version_id).usage).toMatchObject({episodes:1,tasks:0,requests:0,savedSelections:1});
  expect((await f.command('revoke',{versionId:music.current_version_id})).status).toBe(200);const after=await f.request();expect(after.body.versions.find((v:{id:string})=>v.id===music.current_version_id)).toMatchObject({status:'revoked',usage:{savedSelections:1,episodes:1,tasks:0}});
  // Real production selection resolution refuses the retained, now-revoked default.
  await expect(ownerTransaction(f.pool,f.owner,false,c=>resolveProductionSelection(c,musicDefaults.selection,'music_sound'))).rejects.toThrow();expect(f.secretReads).toBe(beforeReads);
 }finally{await f.close();}
},60000);
