// @vitest-environment node
import {expect,it} from 'vitest';
import {readFile,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {csrfFor} from './sessions';
import {join} from 'node:path';
import {productionWorkspaceFixture} from './productionWorkspace.fixture';
import {defaultShotCaptionContract} from '../shotCaptions';
import {localArtifactUrl} from '../reviews/localArtifactPreview';

it.skipIf(process.env.LOOP_BATCH_EXPORT_ACCEPTANCE!=='1')('only confirms the exact current MP4 reviewed by its Owner and safely replays the receipt',async()=>{
 const f=await productionWorkspaceFixture({runtime:{wake(){}}});
 try{
  let workspace=(await f.request('prepareWorkspace',{reviewPackageId:f.board,expectedScriptRevisionId:f.script})).body;
  const edit=async(command:string,data:Record<string,unknown>={})=>{
   const response=await f.request(command,{workspaceId:workspace.id,expectedRevision:workspace.revision,...data});
   expect(response.status,JSON.stringify(response.body)).toBe(200);
   workspace=response.body;
  };
  const reviewPath='/api/local/episodes/'+f.episode+'/batch-export-review';
  const get=async(path:string,token=f.token,range?:string)=>fetch(f.origin+path,{headers:{Cookie:'loop_owner_session='+token,...(range?{Range:range}:{})}});
  await edit('exportWorkspace');
  expect(workspace.exports[0].status).toBe('failed');
  expect(await (await get(reviewPath)).json()).toMatchObject({status:'unavailable',reason:expect.stringMatching(/已用画面占位/)});

  workspace=await f.fillVisuals(workspace);
  for(const clip of workspace.clips)await edit('saveWorkspaceCaptions',{clipId:clip.id,captionContract:defaultShotCaptionContract(clip.text,'independent',false)});
  await edit('exportWorkspace');
  const original=workspace.exports[0];
  expect(original.status,JSON.stringify(original.checks)).toBe('ready');
  const readReview=async()=>{
   const response=await get(reviewPath);
   expect(response.status).toBe(200);
   const body=await response.json();
   expect(body).toMatchObject({status:'ready',reviewFingerprint:expect.stringMatching(/^[0-9a-f]{64}$/)});
   return body;
  };
  const first=await readReview();
  expect(first.artifact).toEqual(original.artifact);
  expect((await get(reviewPath,f.otherToken)).status).toBe(404);
  const previewPath=localArtifactUrl(f.episode,first.artifact.relativePath,first.artifact.sha256);
  expect(previewPath).toBeTruthy();
  const preview=await get(previewPath!,f.token,'bytes=0-23');
  expect(preview.status).toBe(206);
  expect(preview.headers.get('Content-Type')).toBe('video/mp4');
  expect(Buffer.from(await preview.arrayBuffer()).toString('ascii',4,8)).toBe('ftyp');

  const post=(reviewFingerprint:string,options:Parameters<typeof f.request>[2]={})=>f.request('confirmReviewedExport',{reviewFingerprint},options);
  expect((await post(first.reviewFingerprint,{token:f.otherToken})).status).toBe(404);
  await edit('exportWorkspace');
  expect((await post(first.reviewFingerprint)).body).toMatchObject({status:'failed',requiresReview:true});
  const latest=await readReview();
  expect(latest.reviewFingerprint).not.toBe(first.reviewFingerprint);
  const file=join(f.assetRoot,latest.artifact.relativePath),bytes=await readFile(file);
  await writeFile(file,Buffer.alloc(bytes.length,8));
  const replaced=await post(latest.reviewFingerprint);
  expect(replaced.body).toMatchObject({status:'failed',requiresReview:true});
  await writeFile(file,bytes);
  const restored=await readReview();
  const operation={command:'confirmReviewedExport',idempotencyKey:randomUUID(),data:{episodeId:f.episode,reviewFingerprint:restored.reviewFingerprint}};
  const submit=()=>fetch(f.origin+'/api/local/episode-commands',{method:'POST',headers:{Origin:f.origin,'Content-Type':'application/json',Cookie:'loop_owner_session='+f.token,'X-CSRF-Token':csrfFor(f.token)},body:JSON.stringify(operation)});
  const confirm=await submit();
  expect(confirm.status).toBe(200);
  const receipt=await confirm.json();
  expect(receipt).toMatchObject({episodeId:f.episode,status:'success'});
  expect(await (await submit()).json()).toEqual(receipt);
  expect((await post(restored.reviewFingerprint)).body).toMatchObject({status:'skipped'});
  expect(await (await get(reviewPath)).json()).toMatchObject({status:'skipped'});
  const result=await (await get('/api/local/episodes/'+f.episode+'/workspace')).json();
  expect(result.workspace.exports[0].confirmed).toBe(true);
  expect(result.workspace.deliveries).toHaveLength(1);
 }finally{await f.close();}
},180000);
