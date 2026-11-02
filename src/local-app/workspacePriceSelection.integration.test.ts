// @vitest-environment node
import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {workspaceImageGenerationFixture} from './workspaceImageGeneration.fixture';
import {workspaceTestMedia} from './workspaceTestMedia.fixture';

it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('uses the credential site and exact Kling specification in Owner confirmation and real controlled Worker reservations',async()=>{
 const {f,ref}=await workspaceImageGenerationFixture();try{
 const calls=join(f.root,'price-review-calls.jsonl'),minimaxSecret=randomUUID();
 await writeFile(join(f.root,'controlled-video.mjs'),`import{readFileSync,appendFileSync}from'node:fs';export async function createNarrationPorts(){return{mode:'controlled',store:{mode:'keychain',get:async ref=>ref===${JSON.stringify(minimaxSecret)}?JSON.stringify({region:'cn',apiKey:'synthetic-price-review'}):'synthetic.price.jwt'},fetcher:async(input,init={})=>{const url=new URL(String(input));if(init.method==='POST'){appendFileSync(${JSON.stringify(calls)},JSON.stringify({url:url.href,body:JSON.parse(init.body)})+'\\n');if(url.hostname==='api.minimax.cn')return Response.json({task_id:'controlled-price-review'});return Response.json({code:0,data:{task_id:'controlled-price-review'}});}if(url.hostname==='api.minimax.cn')return Response.json({task:{status:'succeeded',content:{url:'https://result.minimax.io/review.mp4'}}});if(url.hostname==='api-singapore.klingai.com')return Response.json({code:0,data:{task_status:'succeed',task_result:{videos:[{url:'https://result.klingai.com/review.mp4'}]}}});return new Response(readFileSync(${JSON.stringify(workspaceTestMedia('landscape-red-blue.mp4'))}),{headers:{'content-type':'video/mp4'}});}};}`);
 const initial=await f.read();
 for(const [provider,adapter,model,endpoint,expected,region] of [
  ['minimax','minimax_video','MiniMax-H3','https://api.minimax.io',240,'cn'],
  ['kling','kling_video','kling-v3','https://api-singapore.klingai.com',291,null],
 ] as const){
  const connection=randomUUID(),version=randomUUID(),secret=provider==='minimax'?minimaxSecret:randomUUID();await f.c.query('BEGIN');
  await f.c.query('INSERT INTO public.external_connections(id,provider,adapter,name,created_by,current_version_id,endpoint) VALUES($1,$2,$3,$4,$5,$6,$7)',[connection,provider,adapter,'Price review '+provider,f.owner,version,endpoint]);
  await f.c.query('INSERT INTO public.external_connection_versions(id,connection_id,version,provider,adapter,endpoint,vault_secret_id) VALUES($1,$2,1,$3,$4,$5,$6)',[version,connection,provider,adapter,endpoint,secret]);
  await f.c.query("INSERT INTO local_identity.connection_bindings(version_id,owner_id,secret_ref,store_mode) VALUES($1,$2,$3,'keychain')",[version,f.owner,secret]);
  await f.c.query('INSERT INTO local_identity.connection_qualifications(version_id,owner_id,qualified) VALUES($1,$2,true)',[version,f.owner]);
  await f.c.query("INSERT INTO local_identity.connection_probe_evidence(version_id,owner_id,mode,outcome) VALUES($1,$2,'live','verified')",[version,f.owner]);
  if(region)await f.c.query("INSERT INTO local_identity.connection_intents(owner_id,idempotency_key,metadata,connection_id,version_id,secret_ref,store_mode,applied_at) VALUES($1,$2,$3,$4,$5,$6,'keychain',now())",[f.owner,randomUUID(),{command:'create',provider,adapter,region},connection,version,secret]);
  await f.c.query('COMMIT');
  const w=await f.read(),payload={episodeId:f.episode,workspaceId:w.id,expectedRevision:w.revision,targetItemId:w.clips[0].itemId,selection:{capability:'video',provider,adapter,model,connectionVersionId:version},firstFrameMaterialRevisionId:ref.body.id,prompt:'缓慢推进',durationSeconds:4};
  const proposal=await f.rawRequest('prepareWorkspaceCall',{workspaceId:w.id,expectedRevision:w.revision,callCommand:'requestWorkspaceVisualCandidate',callData:payload});expect(proposal.status,JSON.stringify(proposal.body)).toBe(200);
  expect(proposal.body.summary).toMatchObject({provider,model,reservationCents:expected,estimate:{conservative:false,suggestedCents:expected}});
  if(provider==='minimax')expect(proposal.body.summary.estimate.sourceUrl).toContain('platform.minimax.cn');else expect(proposal.body.summary.estimate.basis).toContain('$0.084');
  if(provider==='minimax'){
   await f.c.query("UPDATE local_identity.connection_intents SET metadata=jsonb_set(metadata,'{region}','\"international\"') WHERE version_id=$1",[version]);
   expect((await f.rawRequest('confirmWorkspaceCall',{workspaceId:w.id,expectedRevision:w.revision,confirmationId:proposal.body.confirmationId})).status).toBe(409);
   const international=await f.rawRequest('prepareWorkspaceCall',{workspaceId:w.id,expectedRevision:w.revision,callCommand:'requestWorkspaceVisualCandidate',callData:payload});expect(international.status,JSON.stringify(international.body)).toBe(200);expect(international.body.summary.reservationCents).toBe(277);expect(international.body.summary.estimate.sourceUrl).toContain('platform.minimax.io');
   await f.c.query("UPDATE local_identity.connection_intents SET metadata=jsonb_set(metadata,'{region}','\"cn\"') WHERE version_id=$1",[version]);
  }
  const queued=await f.rawRequest('confirmWorkspaceCall',{workspaceId:w.id,expectedRevision:w.revision,confirmationId:proposal.body.confirmationId,reservationCents:expected});expect(queued.status,JSON.stringify(queued.body)).toBe(200);
  const task=queued.body.visualTasks[0].taskId;expect((await f.c.query('SELECT budget_limit_cents FROM public.tasks WHERE id=$1',[task])).rows[0].budget_limit_cents).toBe(expected);
  await f.execute(task);expect((await f.c.query('SELECT reserved_cents,request_state FROM public.paid_generation_reservations WHERE task_id=$1',[task])).rows[0]).toEqual({reserved_cents:expected,request_state:'succeeded'});
 }
 expect((await f.read()).project.sha256).toBe(initial.project.sha256);
 const submitted=(await readFile(calls,'utf8')).trim().split('\n').map(line=>JSON.parse(line));expect(submitted).toHaveLength(2);expect(submitted[0].url).toBe('https://api.minimax.cn/v2/video_generation');expect(submitted[0].body).toMatchObject({model:'MiniMax-H3',resolution:'768P',duration:4});expect(submitted[1].body).toMatchObject({model_name:'kling-v3',mode:'std',sound:'off',duration:'4'});
 }finally{await f.close();}
},120000);
