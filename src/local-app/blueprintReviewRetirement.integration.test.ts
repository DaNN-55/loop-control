// @vitest-environment node
import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {productionWorkspaceFixture} from './productionWorkspace.fixture';
import {productionScriptTemplate} from '../reviews/productionScript';
import {workspaceTestMedia} from './workspaceTestMedia.fixture';
import {defaultShotCaptionContract} from '../shotCaptions';
import {workspaceAudioVolume} from './workspaceAudioVolume.fixture';
import {csrfFor} from './sessions';

it.skipIf(process.env.LOOP_FORMAL_ACCEPTANCE!=='1')('Owner confirms a script and final file with every retired gate enabled and unused tools unavailable',async()=>{
 const volume=await workspaceAudioVolume(),f=await productionWorkspaceFixture({testRootParent:volume.mountPath,runtime:{mountPath:volume.mountPath,wake(){}}});try{
  const account=(await f.c.query('SELECT account_id FROM public.episodes WHERE id=$1',[f.episode])).rows[0].account_id;
  // Imported policy is historical input, deliberately missing a planner and containing an unused unavailable tool.
  const policy={positioning:'保留创作规则',asset_root:f.assetRoot,approval_gates:['script','visual','storyboard','qc','publish'],a_roll:{execution_path:'local'}};
  await f.c.query('UPDATE public.account_blueprint_versions SET policy=$2 WHERE id=$1',[account,policy]);
  const response=await fetch(f.origin+'/api/local/episode-commands',{method:'POST',headers:{Origin:f.origin,'Content-Type':'application/json',Cookie:'loop_owner_session='+f.token,'X-CSRF-Token':csrfFor(f.token)},body:JSON.stringify({command:'create',idempotencyKey:randomUUID(),data:{accountId:account,title:'退役审核配置的新单'}})});const created={status:response.status,body:await response.json()};expect(created.status,JSON.stringify(created.body)).toBe(200);const episode=created.body.id;
  const send=(command:string,data:Record<string,unknown>={})=>f.request(command,{episodeId:episode,...data});
  expect((await send('start')).status).toBe(409);
  const imported=await send('importMaterial',{sourceKind:'file',sourcePath:'script.md',materialType:'script',materialPurpose:'main_script',mimeType:'text/markdown',isMainScript:true,contentBase64:Buffer.from(productionScriptTemplate).toString('base64')});expect(imported.status).toBe(200);
  expect((await f.request('start',{episodeId:episode},{csrf:false})).status).toBe(403);
  expect((await f.request('start',{episodeId:episode},{token:f.otherToken})).status).toBe(404);
  const started=await send('start');expect(started.status,JSON.stringify(started.body)).toBe(200);expect(started.body.stage).toBe('script_approved');
  const image=await send('importMaterial',{sourceKind:'file',sourcePath:'still.png',materialType:'image',materialPurpose:'visual_reference',mimeType:'image/png',isMainScript:false,contentBase64:(await readFile(workspaceTestMedia('still-striped.png'))).toString('base64')});expect(image.status).toBe(200);
  const prepared=await send('prepareWorkspace',{expectedScriptRevisionId:imported.body.id});expect(prepared.status,JSON.stringify(prepared.body)).toBe(200);let w=prepared.body;
  const edit=async(command:string,data:Record<string,unknown>={})=>{const r=await send(command,{workspaceId:w.id,expectedRevision:w.revision,...data});expect(r.status,JSON.stringify(r.body)).toBe(200);w=r.body;};
  for(const clip of w.clips){await edit('matchWorkspaceImage',{clipId:clip.id,materialRevisionId:image.body.id,usage:'still',durationSeconds:2,fit:'contain',focusX:.5,focusY:.5});await edit('saveWorkspaceCaptions',{clipId:clip.id,captionContract:defaultShotCaptionContract(clip.text,'independent',false)});}
  await edit('exportWorkspace');expect(w.exports[0].status,JSON.stringify(w.exports[0])).toBe('ready');expect(w.exports[0].confirmed).toBe(false);
  expect((await send('prepareWorkspaceDelivery',{workspaceId:w.id,expectedRevision:w.revision,exportId:w.exports[0].id,expectedExportSha256:w.exports[0].artifact.sha256,expectedContentSha256:w.contentSha256,title:'未确认不能交付',description:'',tags:[],coverBase64:''})).status).toBe(409);
  await edit('confirmWorkspaceExport',{exportId:w.exports[0].id,expectedExportSha256:w.exports[0].artifact.sha256,expectedContentSha256:w.contentSha256});expect(w.exports[0].confirmed).toBe(true);
  const result=await fetch(f.origin+`/_local-artifact?episode=${episode}&path=${encodeURIComponent(w.exports[0].artifact.relativePath)}&sha256=${w.exports[0].artifact.sha256}`,{headers:{Cookie:'loop_owner_session='+f.token}});expect(result.status).toBe(200);expect((await result.arrayBuffer()).byteLength).toBeGreaterThan(0);
  expect((await f.c.query('SELECT count(*)::int n FROM public.approvals WHERE episode_id=$1',[episode])).rows[0].n).toBe(0);
  expect((await f.c.query('SELECT policy FROM public.account_blueprint_versions WHERE id=$1',[account])).rows[0].policy).toEqual(policy);
 }finally{await f.close();await volume.close();}
},180000);

it.skipIf(process.env.LOOP_FORMAL_ACCEPTANCE!=='1')('an old storyboard-review order continues without retroactive approval and retains read-only boundaries',async()=>{
 const f=await productionWorkspaceFixture();try{
  const retired=(cookie=true,csrf=true)=>fetch(f.origin+'/api/local/account-commands',{method:'POST',headers:{Origin:f.origin,'Content-Type':'application/json',...(cookie?{Cookie:'loop_owner_session='+f.token}:{}),...(csrf?{'X-CSRF-Token':csrfFor(f.token)}:{})},body:JSON.stringify({command:'checkBlueprint',idempotencyKey:randomUUID(),data:{accountId:f.episode}})});
  expect((await retired()).status).toBe(400);expect((await retired(true,false)).status).toBe(403);expect((await retired(false)).status).toBe(401);
  await f.c.query("UPDATE public.episodes SET stage='storyboard_review' WHERE id=$1",[f.episode]);
  await f.c.query("UPDATE public.account_blueprint_versions SET policy=policy||'{\"approval_gates\":[\"script\",\"visual\",\"storyboard\",\"qc\"]}'::jsonb WHERE id=(SELECT blueprint_version_id FROM public.episodes WHERE id=$1)",[f.episode]);
  const before=(await f.c.query('SELECT id,stage,context_snapshot FROM public.review_packages WHERE episode_id=$1 ORDER BY id',[f.episode])).rows;
  const prepared=await f.request('prepareWorkspace',{reviewPackageId:f.board,expectedScriptRevisionId:f.script});expect(prepared.status,JSON.stringify(prepared.body)).toBe(200);const w=prepared.body;
  expect(w.preparation.origin).toBe('legacy-board');expect(w.clips).toHaveLength(2);
  expect((await f.c.query('SELECT count(*)::int n FROM public.approvals WHERE episode_id=$1',[f.episode])).rows[0].n).toBe(0);
  expect((await f.c.query('SELECT id,stage,context_snapshot FROM public.review_packages WHERE episode_id=$1 ORDER BY id',[f.episode])).rows).toEqual(before);
  for(const mode of ['archived','completed']){
   await f.c.query("UPDATE public.episodes SET archived_at=CASE WHEN $2='archived' THEN now() ELSE NULL END,stage=CASE WHEN $2='completed' THEN 'production_completed'::public.episode_stage ELSE 'storyboard_review'::public.episode_stage END WHERE id=$1",[f.episode,mode]);
   expect((await f.request('editWorkspaceStructure',{workspaceId:w.id,expectedRevision:w.revision,operation:{kind:'insert',afterShotId:w.clips[0].shotId,text:'不得写入历史'}})).status).toBe(409);
  }
 }finally{await f.close();}
},120000);

it.skipIf(process.env.LOOP_T09_BROWSER!=='1')('serves the formal blueprint page against an isolated Owner database',async()=>{
 const {createServer}=await import('vite'),{default:react}=await import('@vitejs/plugin-react'),fs=await import('node:fs/promises');
 let handler:Awaited<ReturnType<typeof productionWorkspaceFixture>>['handler']|undefined;
 const ui=await createServer({configFile:false,root:process.cwd(),cacheDir:'/private/tmp/loop-t09-vite-cache',plugins:[react(),{name:'t09-owner-http',configureServer(server){server.middlewares.use((q,r,next)=>{if(handler&&(q.url?.startsWith('/api/local/')||q.url?.startsWith('/_local-artifact')))void handler(q,r);else next();});}}],server:{host:'127.0.0.1',port:0}});await ui.listen();const origin=`http://127.0.0.1:${(ui.httpServer!.address() as {port:number}).port}`;
 const f=await productionWorkspaceFixture({origin});handler=f.handler;const done='/private/tmp/loop-control-166-20261031/T09-browser-done';
 try{
  const account=(await f.c.query('SELECT account_id FROM public.episodes WHERE id=$1',[f.episode])).rows[0].account_id,harness=randomUUID();
  await f.c.query("INSERT INTO public.prompt_versions(id,account_id,capability,version,slug,name,summary,instructions,content_hash) VALUES($1,$2,'storyboard_planning',100,'t09-browser','分镜规则','隔离浏览器验收','遵循账号规则',$3)",[harness,account,'a'.repeat(64)]);
  await f.c.query('UPDATE public.account_blueprint_versions SET policy=$2 WHERE id=$1',[account,{positioning:'隔离审核退役验收',asset_root:f.assetRoot,approval_gates:['script','visual','storyboard','qc','publish'],allowed_tools:['read','write'],executors:{storyboard_planning:{provider:'codex',adapter:'codex',model:'gpt-5.6-luna',prompt_version:'t09-browser',harness_id:harness}}}]);
  await fs.rm(done,{force:true});await fs.writeFile('/private/tmp/loop-control-166-20261031/T09-browser.json',JSON.stringify({origin,email:f.email,password:f.password,database:f.database}));
  const deadline=Date.now()+600000;while(Date.now()<deadline){if(await fs.access(done).then(()=>true,()=>false))break;await new Promise(resolve=>setTimeout(resolve,250));}
 }finally{await f.close();await ui.close();await fs.rm('/private/tmp/loop-control-166-20261031/T09-browser.json',{force:true});}
},650000);
