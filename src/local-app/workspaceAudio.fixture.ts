import {randomUUID} from 'node:crypto';
import {writeFile,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {expect} from 'vitest';
import {productionHash} from './scriptProductionStore';
import {nativeWorkerPort} from './workerDatabase';
import {runWorkspaceDeliveryProcess} from './workspaceDelivery.fixture';
import {narrationFixture} from './workspaceNarration.fixture';
export async function workspaceAudioFixture(){
 const f=await narrationFixture();try{
 const version=randomUUID(),connection=randomUUID(),secret=randomUUID();
 await f.c.query('BEGIN');await f.c.query("SELECT set_config('loop.owner_id',$1,true)",[f.owner]);
 await f.c.query("INSERT INTO public.external_connections(id,provider,adapter,name,created_by,current_version_id,endpoint) VALUES($1,'freesound','freesound_preview','Controlled audio',$2,$3,'https://freesound.org/apiv2')",[connection,f.owner,version]);
 await f.c.query("INSERT INTO public.external_connection_versions(id,connection_id,version,provider,adapter,endpoint,vault_secret_id) VALUES($1,$2,1,'freesound','freesound_preview','https://freesound.org/apiv2',$3)",[version,connection,secret]);
 await f.c.query("INSERT INTO local_identity.connection_bindings(version_id,owner_id,secret_ref,store_mode) VALUES($1,$2,$3,'keychain')",[version,f.owner,secret]);
 await f.c.query('INSERT INTO local_identity.connection_qualifications(version_id,owner_id,qualified) VALUES($1,$2,true)',[version,f.owner]);await f.c.query("INSERT INTO local_identity.connection_probe_evidence(version_id,owner_id,mode,outcome) VALUES($1,$2,'live','verified')",[version,f.owner]);
 const account=(await f.c.query('SELECT account_id FROM public.episodes WHERE id=$1',[f.episode])).rows[0].account_id;
 const prior=(await f.c.query('SELECT policy FROM public.account_blueprint_versions WHERE id=(SELECT blueprint_version_id FROM public.episodes WHERE id=$1)',[f.episode])).rows[0].policy;
 const policy={...prior,soundtrack:{execution_path:'external',credential_ref:version,executor:{provider:'freesound',adapter:'freesound_preview',model:'freesound-preview-v1',prompt_version:'soundtrack-v1'},allowed_tools:['read','write','network'],budget_cents:5,max_attempts:1}};
 await f.c.query('SET SESSION AUTHORIZATION loop_app');await f.c.query('SELECT public.update_current_blueprint($1,$2)',[account,policy]);await f.c.query('SET SESSION AUTHORIZATION DEFAULT');await f.c.query('UPDATE public.episodes SET blueprint_version_id=(SELECT current_blueprint_version_id FROM public.accounts WHERE id=$2) WHERE id=$1',[f.episode,account]);await f.c.query('COMMIT');
 const modulePath=join(f.root,'controlled-soundtrack.mjs'),submissions=join(f.root,'soundtrack-submissions.jsonl'),responseMode=join(f.root,'soundtrack-mode');await writeFile(responseMode,'success');
 await writeFile(modulePath,`import{readFileSync,appendFileSync}from'node:fs';export async function createNarrationPorts(){return{mode:'controlled',store:{mode:'keychain',get:async()=> 'synthetic-t06-secret'},fetcher:async(input)=>{const url=new URL(String(input));appendFileSync(${JSON.stringify(submissions)},url.href+'\\n');if(readFileSync(${JSON.stringify(responseMode)},'utf8')==='reject')return new Response('controlled unavailable',{status:503});if(url.hostname==='freesound.org')return Response.json({results:[{id:1,name:'Controlled tone',username:'fixture',license:'https://creativecommons.org/publicdomain/zero/1.0/',url:'https://freesound.org/people/fixture/sounds/1/',duration:8,previews:{'preview-hq-mp3':'https://cdn.freesound.org/previews/1/1.mp3'}}]});return new Response(readFileSync('/private/tmp/loop-152-orchestration/media/controlled-bgm-110hz.mp3'),{headers:{'content-type':'audio/mpeg'}});}};}`);
 async function authorize(){await f.authorize();await f.c.query('UPDATE local_identity.script_productions SET plan=$2 WHERE episode_id=$1',[f.episode,{executionFingerprint:productionHash(policy)}]);}
 async function execute(taskId:string){const worker=f.workerPool();try{const task=(await nativeWorkerPort(worker).rpc('claim_next_worker_task',{p_task_id:taskId,p_worker_capacity:1}) as any[])[0];expect(task).toBeTruthy();return await runWorkspaceDeliveryProcess(f,task,{media:task.provider==='ffmpeg'?{mode:'local'}:{mode:'controlled',modulePath},visualCommand:[process.execPath,'--version']});}finally{await worker.end();}}
 return{...f,authorize,executeAudio:execute,audioSubmissions:submissions,audioResponseMode:responseMode,policy};
 }catch(error){await f.close();throw error;}
}
