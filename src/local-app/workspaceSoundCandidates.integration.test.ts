// @vitest-environment node
import {it,expect} from 'vitest';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {workspaceAudioFixture} from './workspaceAudio.fixture';

it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('freezes distinct sound candidates, requires manual adoption, and keeps music settings on the production order',async()=>{
 const f=await workspaceAudioFixture({migrations:['db/local/151-workspace-sound-candidates.sql']});
 try{
  await f.authorize();let w=f.made;
  const selection={capability:'music_sound',provider:'freesound',adapter:'freesound_preview',connectionVersionId:(await f.c.query("SELECT id FROM public.external_connection_versions WHERE adapter='freesound_preview'")).rows[0].id};
  const initialSha=w.project.sha256,initialClips=structuredClone(w.clips);
  await writeFile(join(f.root,'controlled-soundtrack.mjs'),`import{readFileSync}from'node:fs';export async function createNarrationPorts(){return{mode:'controlled',store:{mode:'keychain',get:async()=> 'synthetic-sound-candidates'},fetcher:async(input)=>new URL(String(input)).hostname==='freesound.org'?Response.json({results:[1,2,3].map(id=>({id,name:'Bell '+id,username:'fixture',license:'https://creativecommons.org/publicdomain/zero/1.0/',url:'https://freesound.org/people/fixture/sounds/'+id+'/',duration:8,previews:{'preview-hq-mp3':'https://cdn.freesound.org/previews/'+id+'/'+id+'.mp3'}}))}):new Response(readFileSync(${JSON.stringify(f.media.bgm)}),{headers:{'content-type':'audio/mpeg'}})};}`);
  const send=async(name:string,data:Record<string,unknown>)=>{const r=await f.request(name,{workspaceId:w.id,expectedRevision:w.revision,...data});expect(r.status,JSON.stringify(r.body)).toBe(200);w=r.body;};
  await send('prepareWorkspaceAudio',{kind:'sfx',intent:'山顶出现第一束阳光时，加入空灵泛音',description:'山顶泛音',candidateCount:3,selection,durationSeconds:.4,anchor:'shot',shotId:w.clips[0].shotId,offsetSeconds:.2});
  expect(w.audio.preparations).toHaveLength(3);
  const tasks=w.audio.preparations.map((p:any)=>p.taskId);
  const frozen=(await f.c.query('SELECT input_snapshot FROM public.tasks WHERE id=ANY($1::uuid[])',[tasks])).rows.map(r=>r.input_snapshot);
  expect(frozen.map(r=>r.media.soundtrack.candidate_index).sort()).toEqual([0,1,2]);
  expect(frozen.every(r=>r.media.soundtrack.query==='ethereal chime')).toBe(true);
  for(const task of tasks)await f.executeAudio(task);
  w=await f.read();expect(w.project.sha256).toBe(initialSha);expect(w.clips).toEqual(initialClips);
  expect(w.audio.preparations.map((p:any)=>p.source.sourceId).sort()).toEqual([1,2,3]);
  expect(w.audio.preparations.every((p:any)=>p.status==='completed'&&!p.adoptedItemId&&p.source.license)).toBe(true);
  for(const p of w.audio.preparations){const r=await fetch(f.origin+`/_local-artifact?episode=${f.episode}&path=${encodeURIComponent(p.relativePath)}&sha256=${p.sha256}`,{headers:{Cookie:'loop_owner_session='+f.token}});expect(r.status).toBe(200);expect((await r.arrayBuffer()).byteLength).toBeGreaterThan(100);}
  await send('adoptWorkspaceAudio',{preparationId:w.audio.preparations[0].id});expect(w.audio.mix.sounds).toHaveLength(1);
  const adopted=structuredClone(w.audio.mix),adoptedSha=w.project.sha256;
  await send('saveWorkspaceMusicSettings',{settings:{description:'整期氛围',query:'calm ambient',materialRevisionId:''}});
  await send('saveWorkspaceAudioDefaults',{selection});await f.restart();w=await f.read();
  expect(w.audio.defaults).toEqual({selection,settings:{description:'整期氛围',query:'calm ambient',materialRevisionId:''}});
  expect(w.audio.mix).toEqual(adopted);expect(w.project.sha256).toBe(adoptedSha);
  expect((await f.request('saveWorkspaceMusicSettings',{workspaceId:w.id,expectedRevision:w.revision,settings:{description:'invalid',query:'',materialRevisionId:'not-a-material'}})).status).toBe(400);
  expect((await f.read()).audio.defaults).toEqual(w.audio.defaults);
  const before=w.audio.preparations.length;
  expect((await f.request('prepareWorkspaceAudio',{workspaceId:w.id,expectedRevision:w.revision,kind:'sfx',query:'bell',description:'invalid',candidateCount:4,selection,durationSeconds:1})).status).toBe(400);
  expect((await f.read()).audio.preparations).toHaveLength(before);
  if(process.env.LOOP_SOUND_EVIDENCE)await writeFile(join(process.env.LOOP_SOUND_EVIDENCE,'sound-candidates.json'),JSON.stringify({taskIds:tasks,sourceIds:w.audio.preparations.map((p:any)=>p.source.sourceId),defaults:w.audio.defaults,mix:w.audio.mix,originalProjectSha:initialSha,adoptedProjectSha:adoptedSha},null,2));
 }finally{await f.close();}
},180000);
