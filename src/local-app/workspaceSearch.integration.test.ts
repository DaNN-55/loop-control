// @vitest-environment node
import {it,expect} from 'vitest';
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,writeFile,lstat,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {connectionCatalogFixture} from './connectionCatalog.fixture';
import type {WorkspaceSearchResponse} from './workspaceSearchTypes';
it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE)('searches owned production content before records and reaches every result with exact group counts through Owner HTTP',async()=>{
 const f=await connectionCatalogFixture();
 try{
  const episodeIds:string[]=[];let account='',previewPath='',previewSha='';
  for(let n=0;n<10;n++){
   const a=randomUUID(),e=randomUUID();episodeIds.push(e);if(!n)account=a;
   await f.admin.query("INSERT INTO public.accounts(id,slug,name,timezone)VALUES($1,$2,$3,'UTC')",[a,'search-'+a,`Needle account ${n}`]);await f.admin.query("INSERT INTO public.account_memberships(account_id,user_id,role)VALUES($1,$2,'owner')",[a,f.owner]);
   await f.admin.query('INSERT INTO public.account_blueprint_versions(id,account_id,version,policy,is_active)VALUES($1,$1,1,$2,true)',[a,{asset_root:join(f.root,'account-'+a)}]);await f.admin.query('UPDATE public.accounts SET current_blueprint_version_id=$1 WHERE id=$1',[a]);
   await f.admin.query("INSERT INTO public.episodes(id,account_id,blueprint_version_id,title,stage)VALUES($1,$2,$2,$3,'waiting_input')",[e,a,`Needle production ${n}`]);
   const path=`episodes/${e}/script-${n}.md`,bytes=Buffer.from(`Needle script ${n}`),sha=createHash('sha256').update(bytes).digest('hex');
   await f.admin.query("INSERT INTO public.production_material_revisions(episode_id,revision_number,material_type,source_kind,source_path,storage_path,mime_type,sha256,file_size,is_main_script,created_by)VALUES($1,1,'script','paste',$2,$2,'text/plain',$3,$4,true,$5)",[e,path,sha,bytes.length,f.owner]);
   const root=join(f.root,'account-'+a);await mkdir(join(root,'episodes',e),{recursive:true});await writeFile(join(root,path),bytes);const identity=await lstat(root,{bigint:true});await f.admin.query('INSERT INTO local_identity.account_asset_directories(account_id,actual_root,device_id,inode_id) VALUES($1,$2,$3,$4)',[a,root,String(identity.dev),String(identity.ino)]);await f.admin.query('INSERT INTO local_identity.episode_asset_locations(episode_id,account_id,asset_root) VALUES($1,$2,$3) ON CONFLICT(episode_id) DO UPDATE SET asset_root=excluded.asset_root',[e,a,root]);if(!n){previewPath=path;previewSha=sha;}
  }
  const episode=episodeIds[0];
  const assetRoot=join(f.root,'account-'+account),directory=`episodes/${episode}`;
  const mediaPath=directory+'/Needle-final.mp4';execFileSync('ffmpeg',['-nostdin','-v','error','-f','lavfi','-i','testsrc2=size=160x90:rate=15','-t','1','-c:v','libx264','-pix_fmt','yuv420p',join(assetRoot,mediaPath)]);
  const mediaBytes=await readFile(join(assetRoot,mediaPath)),mediaSha=createHash('sha256').update(mediaBytes).digest('hex'),projectPath=directory+'/Needle-project.json',projectBytes=Buffer.from('{}'),projectSha=createHash('sha256').update(projectBytes).digest('hex');await writeFile(join(assetRoot,projectPath),projectBytes);
  const imagePath=directory+'/Needle-cover.png';execFileSync('ffmpeg',['-nostdin','-v','error','-f','lavfi','-i','color=c=blue:s=128x128','-frames:v','1',join(assetRoot,imagePath)]);const imageBytes=await readFile(join(assetRoot,imagePath)),imageSha=createHash('sha256').update(imageBytes).digest('hex');await f.admin.query("INSERT INTO public.artifacts(episode_id,artifact_type,relative_path,sha256,file_size)VALUES($1,'reference',$2,$3,$4)",[episode,imagePath,imageSha,imageBytes.length]);
  const audioPath=directory+'/Needle-voice.mp3';execFileSync('ffmpeg',['-nostdin','-v','error','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','1','-c:a','libmp3lame',join(assetRoot,audioPath)]);const audioBytes=await readFile(join(assetRoot,audioPath)),audioSha=createHash('sha256').update(audioBytes).digest('hex');await f.admin.query("INSERT INTO public.artifacts(episode_id,artifact_type,relative_path,sha256,file_size)VALUES($1,'reference',$2,$3,$4)",[episode,audioPath,audioSha,audioBytes.length]);
  const board=randomUUID(),workspace=randomUUID(),exportId=randomUUID(),script=(await f.admin.query('SELECT id FROM public.production_material_revisions WHERE episode_id=$1',[episode])).rows[0].id;
  await f.admin.query("INSERT INTO public.review_packages(id,episode_id,stage,revision_number,context_snapshot)VALUES($1,$2,'storyboard_review',1,'{}')",[board,episode]);
  await f.admin.query("INSERT INTO local_identity.production_workspaces(id,episode_id,script_revision_id,storyboard_package_id,bindings,project_path,project_sha256,content_sha256,project_size)VALUES($1,$2,$3,$4,'[]',$5,$6,$6,2)",[workspace,episode,script,board,projectPath,projectSha]);
  await f.admin.query("INSERT INTO local_identity.workspace_exports(id,workspace_id,episode_id,project_content_version,content_sha256,project,status,artifact,checks,created_by)VALUES($1,$2,$3,1,$4,$5,'ready',$6,'[]',$7)",[exportId,workspace,episode,projectSha,{relativePath:projectPath,sha256:projectSha,fileSize:2},{relativePath:mediaPath,sha256:mediaSha,fileSize:mediaBytes.length},f.owner]);

  // Newer technical records must never crowd the eight visible content files out.
  for(let n=0;n<10;n++)await f.admin.query("INSERT INTO public.artifacts(episode_id,artifact_type,relative_path,sha256,file_size)VALUES($1,'reference',$2,$3,2)",[episode,`episodes/${episode}/Needle-internal-${n}.json`,'b'.repeat(64)]);
  // Same registered file in both source tables appears only once.
  await f.admin.query("INSERT INTO public.artifacts(episode_id,artifact_type,relative_path,sha256,file_size)VALUES($1,'reference',$2,$3,15)",[episode,previewPath,previewSha]);
  const read=async(params:Record<string,string>,token=f.token)=>{const response=await fetch(f.origin+'/api/local/workspace-search?'+new URLSearchParams(params),{headers:token?{Cookie:'loop_owner_session='+token}:{}});return {status:response.status,body:await response.json() as WorkspaceSearchResponse};};
  const first=await read({q:'Needle'});expect(first.status).toBe(200);expect(first.body.episodes).toHaveLength(8);expect(first.body.accounts).toHaveLength(8);expect(first.body.materials).toHaveLength(8);expect(first.body.materials.every(hit=>hit.fileType==='script')).toBe(true);expect(first.body.pagination?.total).toEqual({episodes:10,accounts:10,materials:24});
  for(const category of ['episodes','accounts','materials'] as const){
   const all=[];for(let page=1;page<=(category==='materials'?3:2);page++){const result=await read({q:'Needle',category,page:String(page)});expect(result.status).toBe(200);expect(result.body.pagination?.page).toBe(page);all.push(...result.body[category]);}
   expect(new Set(all.map(hit=>hit.id)).size).toBe(category==='materials'?24:10);if(category==='materials'){expect(all.find(hit=>hit.path===mediaPath)).toMatchObject({fileType:'video',typeLabel:'视频'});expect(all.find(hit=>hit.path===audioPath)).toMatchObject({fileType:'audio',typeLabel:'音频'});expect(all.find(hit=>hit.path===imagePath)).toMatchObject({fileType:'image',typeLabel:'图片'});}
  }
  expect((await read({q:'Needle',category:'materials',page:'1'},f.otherToken)).body.pagination?.total).toEqual({episodes:0,accounts:0,materials:0});expect((await read({q:'Needle'},'')).status).toBe(401);expect((await read({q:"Needle%_' OR true --"})).body.pagination?.total).toEqual({episodes:0,accounts:0,materials:0});
  const invalidQueries:Record<string,string>[]=[{q:'Needle',category:'secret'},{q:'Needle',page:'0'},{q:'Needle',category:'materials',page:'1.2'},{q:'Needle',ownerId:f.other}];for(const params of invalidQueries)expect((await read(params)).status).toBe(400);
  // Seeded real file bytes still go through existing Owner + path + SHA access.
  const source=f.origin+'/_local-artifact?'+new URLSearchParams({episode,path:previewPath,sha256:previewSha}),headers={Cookie:'loop_owner_session='+f.token};
  const preview=await fetch(source,{headers});expect(preview.status).toBe(200);expect(await preview.text()).toBe('Needle script 0');const download=await fetch(source+'&download=1',{headers});expect(download.status).toBe(200);expect(download.headers.get('Content-Disposition')).toContain('attachment');expect(await download.text()).toBe('Needle script 0');
  expect((await fetch(source,{headers:{Cookie:'loop_owner_session='+f.otherToken}})).status).toBe(404);expect((await fetch(source.replace(previewSha,'c'.repeat(64)),{headers})).status).toBe(409);expect((await fetch(f.origin+'/_local-artifact?'+new URLSearchParams({episode,path:'../escape',sha256:previewSha}),{headers})).status).toBe(404);
  const mediaUrl=f.origin+'/_local-artifact?'+new URLSearchParams({episode,path:mediaPath,sha256:mediaSha}),mediaRead=await fetch(mediaUrl,{headers:{...headers,Range:'bytes=0-31'}});expect(mediaRead.status).toBe(206);expect(Buffer.from(await mediaRead.arrayBuffer())).toEqual(mediaBytes.subarray(0,32));
  const imageRead=await fetch(f.origin+'/_local-artifact?'+new URLSearchParams({episode,path:imagePath,sha256:imageSha}),{headers});expect(imageRead.status).toBe(200);expect(Buffer.from(await imageRead.arrayBuffer())).toEqual(imageBytes);
  if(process.env.LOOP_SEARCH_BROWSER_MODULE){const browser=await import(process.env.LOOP_SEARCH_BROWSER_MODULE);await browser.verify({f,episode,mediaPath,mediaSha});}
  expect(account).toBeTruthy();expect(f.secretReads).toBe(0);
 }finally{await f.close();}
},120000);
