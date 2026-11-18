// @vitest-environment node
import {it,expect} from 'vitest';
import {formalWorkflowFixture} from './formalWorkflow.fixture';

it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('persists each explicit main-voice route without submitting media and preserves independent captions after reopening',async()=>{
 const f=await formalWorkflowFixture();
 try{
  expect((await f.send('start')).status).toBe(200);
  let workspace=(await f.send('prepareWorkspace',{expectedScriptRevisionId:f.main})).body;
  const clipId=workspace.clips[0].id,originalCaptions=workspace.captions[0].contract;
  const tasksBefore=(await f.c.query('SELECT count(*)::int n FROM public.tasks WHERE episode_id=$1',[f.newEpisode])).rows[0].n;
  for(const [voiceMode,enabled]of [['none',false],['source',false],['tts',true],['manual',true]] as const){
   const result=await f.send('setWorkspaceNarrationEnabled',{workspaceId:workspace.id,expectedRevision:workspace.revision,clipId,enabled,voiceMode});
   expect(result.status,JSON.stringify(result.body)).toBe(200);workspace=result.body;
   expect(workspace.narration.find((n:{clipId:string})=>n.clipId===clipId)).toMatchObject({enabled,requestedMode:voiceMode});
   expect(workspace.captions[0].contract).toEqual(originalCaptions);
  }
  await f.restart();
  const response=await fetch(f.origin+`/api/local/episodes/${f.newEpisode}/workspace`,{headers:{Cookie:'loop_owner_session='+f.token}});
  expect(response.status).toBe(200);workspace=(await response.json()).workspace;
  expect(workspace.narration.find((n:{clipId:string})=>n.clipId===clipId)).toMatchObject({enabled:true,requestedMode:'manual'});
  const invalid=await f.send('setWorkspaceNarrationEnabled',{workspaceId:workspace.id,expectedRevision:workspace.revision,clipId,enabled:true,voiceMode:'source'});
  expect(invalid.status).toBe(400);
  expect((await f.c.query('SELECT count(*)::int n FROM public.tasks WHERE episode_id=$1',[f.newEpisode])).rows[0].n).toBe(tasksBefore);
 }finally{await f.close();}
},120_000);
