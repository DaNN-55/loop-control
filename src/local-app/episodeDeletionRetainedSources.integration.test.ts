// @vitest-environment node
import {it,expect} from 'vitest';
import {mkdir,mkdtemp,copyFile,writeFile,rm,access} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {embeddedStudioFixture} from './embeddedStudio.fixture';
import {deletionFixtureFingerprint} from './deletionFingerprint.fixture';
import {csrfFor} from './sessions';
it.skipIf(process.env.LOOP_EPISODE_DELETION_ACCEPTANCE!=='1').each(['online','offline'] as const)('only current registered files are confirmed; %s deployment sources remain outside deletion authority',async mode=>{
 const f=await embeddedStudioFixture({episodeRelativePath:mode==='online'?()=> '系列 中文 %_[] #?/本单 stable':undefined});let retained:string|undefined;
 const post=async(command:string,data:Record<string,unknown>)=>{const response=await fetch(f.origin+'/api/local/episode-lifecycle',{method:'POST',headers:{Origin:f.origin,'Content-Type':'application/json',Cookie:'loop_owner_session='+f.token,'X-CSRF-Token':csrfFor(f.token)},body:JSON.stringify({command,idempotencyKey:randomUUID(),data})});return{status:response.status,body:await response.json()};};
 try{
  const source=mode==='online'?(retained=await mkdtemp('/private/tmp/loop-t10-retained-source-')):'/Volumes/loop-t10-offline-'+randomUUID();
  if(retained){for(const file of f.files){const path=join(retained,'account',file.relativePath);await mkdir(join(path,'..'),{recursive:true});await copyFile(join(f.assetRoot,file.relativePath),path);}await mkdir(join(retained,'other-account'));await writeFile(join(retained,'other-account','keep.txt'),'retained other account original');await writeFile(join(retained,'manual.txt'),'retained manual original');}
  const before=retained?await deletionFixtureFingerprint(retained):null;await f.c.query('UPDATE local_identity.import_record SET media_source_roots=$1',[ [source] ]);
  expect((await post('archiveEpisode',{episodeId:f.episode,archived:true})).status).toBe(200);const plan=await post('planDeletion',{episodeId:f.episode});expect(plan.status,JSON.stringify(plan.body)).toBe(200);expect(plan.body.paths).toEqual([join(f.assetRoot,f.episodeRelativePath)]);expect(plan.body.files.every((file:{path:string})=>file.path.startsWith(join(f.assetRoot,f.episodeRelativePath)+'/'))).toBe(true);
  const deleted=await post('deleteEpisode',{episodeId:f.episode,confirmation:plan.body.confirmation,expectedPath:plan.body.path,expectedPaths:plan.body.paths,expectedRevision:plan.body.revision});expect(deleted.status,JSON.stringify(deleted.body)).toBe(200);expect(deleted.body.cleanupPending).toBe(false);await expect(access(join(f.assetRoot,f.videoPath))).rejects.toMatchObject({code:'ENOENT'});if(retained){const after=await deletionFixtureFingerprint(retained);expect(after).toEqual(before);if(process.env.LOOP_T10_EVIDENCE){await mkdir(process.env.LOOP_T10_EVIDENCE,{recursive:true});await writeFile(join(process.env.LOOP_T10_EVIDENCE,'retained-source-'+mode+'.json'),JSON.stringify({source,before,after,plan:plan.body,result:deleted.body},null,2));}}else await expect(access(source)).rejects.toMatchObject({code:'ENOENT'});
 }finally{await f.close();if(retained)await rm(retained,{recursive:true});}
},300000);
