// @vitest-environment node
import {expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {storyE2eFixture} from './storyE2e.fixture';

const enabled=process.env.LOOP_WORKSPACE_ACCEPTANCE==='1'&&!!process.env.LOOP_TEST_CONTEXT_MODULE;
const currentVoice='zh_female_vv_uranus_bigtts';

it.skipIf(!enabled)('queues the reviewed narration as an independently adoptable candidate without saving the batch settings',async()=>{
 const f=await storyE2eFixture({scriptOnly:true,migrations:['db/current/227-storyboard-batch-speech.sql']});
 try{
  const w=await f.read(),clip=w.clips[0],n=w.narration!.find(n=>n.shotId===clip.shotId)!;
  const common={selection:f.selections.speech,voice:currentVoice,languageCode:'zh-CN',speakingRate:1};
  const draftText='这句从草稿生成。';
  const review=await f.ok(f.send('prepareStoryboardBatch',{kind:'speech',shotIds:[clip.shotId],common,drafts:[{shotId:clip.shotId,preparationRevisionId:w.preparationRevisionId,inputFingerprint:n.inputFingerprint,text:draftText}]}));
  expect(review).toMatchObject({status:'review',items:[{shotId:clip.shotId,state:'ready',source:'draft',text:draftText,characters:8,summary:{reservationCents:8,model:'seed-tts-2.0'}}]});
  expect((await f.read()).narration!.find(n=>n.shotId===clip.shotId)?.generationTask).toBeUndefined();
  const receipt=await f.ok(f.post('episode-commands','confirmStoryboardBatch',{episodeId:f.episode,workspaceId:w.id,confirmationId:review.confirmationId,shotIds:[clip.shotId]}));
  expect(receipt).toMatchObject({status:'submitted',items:[{shotId:clip.shotId,reservationCents:8}]});
  const task=receipt.items[0].taskId;
  expect((await f.read()).narration!.find(n=>n.shotId===clip.shotId)?.generationTask).toMatchObject({taskId:task,status:'ready',reservationCents:8});
  expect((await f.execute(task))?.status).toBe('completed');
  const complete=await f.read(),candidate=complete.candidates!.find(c=>c.taskId===task)!;
  expect(candidate).toMatchObject({status:'available',text:draftText});
  expect(complete.usedNarration).toEqual([]);
  expect(complete.narration!.find(n=>n.shotId===clip.shotId)).toMatchObject({text:n.text,defaults:n.defaults,selection:n.selection});
  const submission=JSON.parse((await readFile(f.submissions,'utf8')).trim());
  expect(submission.body.req_params.text).toBe(draftText);
  const adoption=await f.ok(f.send('prepareWorkspaceCandidate',{candidateId:candidate.id,durationPolicy:'use-candidate'}));
  const adopted=await f.ok(f.send('adoptWorkspaceCandidate',{candidateId:candidate.id,adoptionId:adoption.adoptionId}));
  expect(adopted.usedNarration).toEqual([expect.objectContaining({shotId:clip.shotId,text:draftText,taskId:task})]);
 }finally{await f.close();}
},120000);

it.skipIf(!enabled)('rechecks all selected shots before queueing, keeps previously skipped shots excluded, and recovers the original receipt',async()=>{
 const f=await storyE2eFixture({scriptOnly:true,migrations:['db/current/227-storyboard-batch-speech.sql']});
 try{
  const [first,skipped]=(await f.read()).clips;
  const inserted=await f.ok(f.send('editWorkspaceStructure',{operation:{kind:'insert',afterShotId:skipped.shotId,text:'新增镜头文案。'}}));
  const third=inserted.clips.find((clip:typeof first)=>!([first.shotId,skipped.shotId].includes(clip.shotId)));
  const common={selection:f.selections.speech,voice:currentVoice,languageCode:'zh-CN',speakingRate:1};
  const customize=async(rate:number)=>{
   await f.ok(f.send('saveWorkspaceNarration',{clipId:first.id,mode:'tts',text:'第一镜正式口播。',...common,speakingRate:rate}));
   await f.ok(f.send('confirmWorkspaceNarration',{clipId:first.id}));
  };
  await customize(1.15);
  await f.ok(f.send('setWorkspaceNarrationEnabled',{clipId:skipped.id,enabled:false,voiceMode:'none'}));
  await f.ok(f.send('setWorkspaceNarrationEnabled',{clipId:third.id,enabled:true,voiceMode:'tts'}));
  const before=await f.read(),firstNarration=before.narration!.find(n=>n.shotId===first.shotId)!;
  const ids=[first.shotId,skipped.shotId,third.shotId],picked=[first.shotId,third.shotId];
  const oldDraft={shotId:first.shotId,preparationRevisionId:before.preparationRevisionId,inputFingerprint:firstNarration.inputFingerprint,text:'旧草稿内容。'};
  const prepare=async()=>f.ok(f.send('prepareStoryboardBatch',{kind:'speech',shotIds:ids,common,drafts:[oldDraft]}));
  const confirm=(confirmationId:string,shotIds=picked,key?:string)=>f.post('episode-commands','confirmStoryboardBatch',{episodeId:f.episode,workspaceId:before.id,confirmationId,shotIds},key);
  const review=await prepare();
  expect(review.items.map((item:{state:string})=>item.state)).toEqual(['ready','skipped','ready']);
  expect(review.items[0]).toMatchObject({source:'draft',text:'旧草稿内容。',summary:{parameters:expect.arrayContaining(['语速：1.15'])}});
  await customize(1.3);
  await f.ok(f.send('setWorkspaceNarrationEnabled',{clipId:skipped.id,enabled:true,voiceMode:'tts'}));
  expect((await confirm(review.confirmationId,ids)).status).toBe(400);
  const changed=await f.ok(confirm(review.confirmationId));
  expect(changed).toMatchObject({status:'review',changed:true,items:[
   {shotId:first.shotId,source:'confirmed',text:'第一镜正式口播。',state:'ready',change:expect.any(String),summary:{reservationCents:8,parameters:expect.arrayContaining(['语速：1.3'])}},
   {shotId:skipped.shotId,state:'skipped',reason:'已设为无口播'},
   {shotId:third.shotId,state:'ready'},
  ]});
  expect((await f.read()).narration!.some(n=>n.generationTask)).toBe(false);
  const [one,two]=await Promise.all([f.ok(confirm(changed.confirmationId)),f.ok(confirm(changed.confirmationId))]);
  expect(one).toEqual(two);
  expect(one.items.map((item:{shotId:string})=>item.shotId)).toEqual(picked);
  expect(one.items[0]).toMatchObject({reservationCents:8});
  expect((await confirm(changed.confirmationId,[first.shotId])).status).toBe(409);
  expect(await f.ok(confirm(review.confirmationId))).toEqual(changed);
  expect((await f.read()).narration!.map(n=>n.generationTask?.taskId).filter(Boolean)).toEqual(one.items.map((item:{taskId:string})=>item.taskId));
  expect((await f.execute(one.items[0].taskId)).status).toBe('completed');
  const candidate=(await f.read()).candidates!.find(c=>c.taskId===one.items[0].taskId)!;
  const adoption=await f.ok(f.send('prepareWorkspaceCandidate',{candidateId:candidate.id,durationPolicy:'use-candidate'}));
  await f.ok(f.send('adoptWorkspaceCandidate',{candidateId:candidate.id,adoptionId:adoption.adoptionId}));
  expect((await f.execute(one.items[1].taskId)).status).toBe('completed');
  const remaining=await prepare();
  expect(remaining.items.map((item:{state:string})=>item.state)).toEqual(['regenerate','ready','regenerate']);
  const explicitlyRegenerated=await f.ok(f.send('prepareStoryboardBatch',{kind:'speech',shotIds:[first.shotId],common,regenerateShotIds:[first.shotId]}));
  const rebuilt=await f.ok(confirm(explicitlyRegenerated.confirmationId,[first.shotId]));
  expect(rebuilt.items[0].taskId).not.toBe(one.items[0].taskId);
  expect((await f.read()).usedNarration?.[0]?.taskId).toBe(one.items[0].taskId);
 }finally{await f.close();}
},120000);

it.skipIf(!enabled)('excludes another running or unknown request and preserves unrelated voice modes',async()=>{
 const f=await storyE2eFixture({scriptOnly:true,migrations:['db/current/227-storyboard-batch-speech.sql']});
 try{
  const [first,source]=(await f.read()).clips;
  const withUpload=await f.ok(f.send('editWorkspaceStructure',{operation:{kind:'insert',afterShotId:source.shotId,text:'这一镜使用人工口播。'}}));
  const upload=withUpload.clips[2];
  await f.ok(f.send('setWorkspaceNarrationEnabled',{clipId:source.id,enabled:false,voiceMode:'source'}));
  await f.ok(f.send('setWorkspaceNarrationEnabled',{clipId:upload.id,enabled:true,voiceMode:'manual'}));
  const workspace=await f.read(),shotIds=workspace.clips.map(clip=>clip.shotId);
  const common={selection:f.selections.speech,voice:currentVoice,languageCode:'zh-CN',speakingRate:1};
  const prepare=()=>f.ok(f.send('prepareStoryboardBatch',{kind:'speech',shotIds,common,regenerateShotIds:[first.shotId]}));
  const review=await prepare();
  expect(review.items).toMatchObject([{state:'ready'},{state:'skipped',reason:'使用视频原声'},{state:'skipped',reason:'使用上传口播'}]);
  const receipt=await f.ok(f.post('episode-commands','confirmStoryboardBatch',{episodeId:f.episode,workspaceId:workspace.id,confirmationId:review.confirmationId,shotIds:[first.shotId]}));
  expect((await prepare()).items[0]).toMatchObject({state:'skipped',reason:'已有口播任务进行中'});
  await writeFile(f.mode,'unknown');
  await f.execute(receipt.items[0].taskId);
  expect((await prepare()).items[0]).toMatchObject({state:'skipped',reason:'口播回执未知，请先在右侧核对原任务'});
  expect((await f.read()).narration![0].generationTask).toMatchObject({taskId:receipt.items[0].taskId,submissionUnknown:true});
  expect((await readFile(f.submissions,'utf8')).trim().split('\n')).toHaveLength(1);
 }finally{await f.close();}
},120000);

it.skipIf(!enabled)('rolls back the whole batch when a later task cannot be registered and retries the same approval safely',async()=>{
 const f=await storyE2eFixture({scriptOnly:true,migrations:['db/current/227-storyboard-batch-speech.sql']});
 try{
  const workspace=await f.read(),shotIds=workspace.clips.map(clip=>clip.shotId);
  const common={selection:f.selections.speech,voice:currentVoice,languageCode:'zh-CN',speakingRate:1};
  const review=await f.ok(f.send('prepareStoryboardBatch',{kind:'speech',shotIds,common}));
  expect(review.items.map((item:{state:string})=>item.state)).toEqual(['ready','ready']);
  const quotedShot=(await f.c.query('SELECT quote_literal($1::text) shot',[shotIds[1]])).rows[0].shot;
  await f.c.query(`CREATE FUNCTION public.test_reject_second_batch_task() RETURNS trigger LANGUAGE plpgsql AS $$
   BEGIN
    IF NEW.input_snapshot#>>'{workspace_narration,shot_id}'=TG_ARGV[0] THEN RAISE EXCEPTION 'Injected second registration failure' USING ERRCODE='22023'; END IF;
    RETURN NEW;
   END $$;
   CREATE TRIGGER test_reject_batch_task BEFORE INSERT ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.test_reject_second_batch_task(${quotedShot})`);
  const key=randomUUID(),data={episodeId:f.episode,workspaceId:workspace.id,confirmationId:review.confirmationId,shotIds};
  const confirm=()=>f.post('episode-commands','confirmStoryboardBatch',data,key);
  expect((await confirm()).status).toBe(400);
  expect((await f.read()).narration!.some(n=>n.generationTask)).toBe(false);
  await f.c.query('DROP TRIGGER test_reject_batch_task ON public.tasks');
  const ok=await f.ok(confirm());
  expect(ok.items).toHaveLength(2);
  expect(await f.ok(confirm())).toEqual(ok);
 }finally{await f.close();}
},120000);

it.skipIf(!enabled)('returns the submitted receipt after a script revision and invalidates pending confirmation without enqueueing',async()=>{
 const f=await storyE2eFixture({scriptOnly:true,migrations:['db/current/227-storyboard-batch-speech.sql']});
 try{
  const w=await f.read(),[first,second]=w.clips;
  const common={selection:f.selections.speech,voice:currentVoice,languageCode:'zh-CN',speakingRate:1};
  const prepare=(shotId:string)=>f.ok(f.send('prepareStoryboardBatch',{kind:'speech',shotIds:[shotId],common}));
  const confirm=(confirmationId:string,shotId:string)=>f.ok(f.post('episode-commands','confirmStoryboardBatch',{episodeId:f.episode,workspaceId:w.id,confirmationId,shotIds:[shotId]}));
  const initial=await prepare(first.shotId);
  const receipt=await confirm(initial.confirmationId,first.shotId);
  const pending=await prepare(second.shotId),rebasing=await prepare(second.shotId);
  const revised=await f.ok(f.request('reconfirmScript',{expectedScriptRevisionId:f.script,text:f.scriptText.replace('雨停了','雨又开始下了'),reason:'验证批量核对基准变化'}));
  expect(await confirm(initial.confirmationId,first.shotId)).toEqual(receipt);
  const invalidated=await confirm(pending.confirmationId,second.shotId);
  expect(invalidated).toMatchObject({status:'review',changed:true,items:[{shotId:second.shotId,state:'skipped',reason:expect.stringContaining('制作基准已变化')}]});
  expect(await confirm(pending.confirmationId,second.shotId)).toEqual(invalidated);
  await f.ok(f.request('start'));

  await f.ok(f.send('replanWorkspace',{expectedScriptRevisionId:revised.id,reason:'采用新脚本制作基准'}));
  const refreshed=await confirm(rebasing.confirmationId,second.shotId);
  expect(refreshed).toMatchObject({status:'review',changed:true,items:[{shotId:second.shotId,state:'ready',change:'制作基准已变化'}]});
  expect((await f.read()).narration!.find(n=>n.shotId===second.shotId)?.generationTask).toBeUndefined();
  expect(await confirm(refreshed.confirmationId,second.shotId)).toMatchObject({status:'submitted',items:[{shotId:second.shotId}]});
 }finally{await f.close();}
},120000);
