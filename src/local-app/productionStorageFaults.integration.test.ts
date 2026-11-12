// @vitest-environment node
import {it,expect} from 'vitest';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {readFile,writeFile,open,unlink,chmod,access,readdir,statfs,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {workspaceAudioVolume} from './workspaceAudioVolume.fixture';
import {embeddedStudioFixture} from './embeddedStudio.fixture';
import {prepareCollectionTargets} from './episodeCollection.fixture';
import {csrfFor} from './sessions';

it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('actual private-volume detach, denied writes and ENOSPC retain original media and resume the same Owner import',async()=>{
 const volume=await workspaceAudioVolume(),f=await embeddedStudioFixture({testRootParent:volume.mountPath,runtime:{mountPath:volume.mountPath,wake(){}}}),evidence:Record<string,unknown>={actualOsFailures:true,dailyVolumeUntouched:true};
 let materials='',filler='';
 try{
  await prepareCollectionTargets(f);await f.c.query("UPDATE public.episodes SET stage='waiting_input' WHERE id=$1",[f.episode]);
  const directory=join(f.assetRoot,(await f.c.query('SELECT directory_relative_path FROM local_identity.episode_storage_location($1)',[f.episode])).rows[0].directory_relative_path);materials=join(directory,'materials');
  const original=await readFile(join(directory,'shot.mp4')),beforeHash=createHash('sha256').update(original).digest('hex');
  const data={episodeId:f.episode,sourceKind:'file',sourcePath:'fault-check.txt',materialType:'reference',materialPurpose:'general_reference',mimeType:'text/plain',isMainScript:false,contentBase64:Buffer.from('recover exactly these original input bytes').toString('base64')};
  const largeInputs=new Set<string>();
  const content=(key:string)=>('recover exactly these original input bytes '+key+'\n').repeat(largeInputs.has(key)?160000:600);
  const submit=async(key:string)=>{const response=await fetch(f.origin+'/api/local/episode-commands',{method:'POST',headers:{Origin:f.origin,'Content-Type':'application/json',Cookie:'loop_owner_session='+f.token,'X-CSRF-Token':csrfFor(f.token)},body:JSON.stringify({command:'importMaterial',idempotencyKey:key,data:{...data,sourcePath:key+'.txt',contentBase64:Buffer.from(content(key)).toString('base64')}})});return{status:response.status,body:await response.json()};};
  const recover=async(key:string)=>{const first=await submit(key);expect(first.status,JSON.stringify(first.body)).toBe(200);expect(await submit(key)).toEqual(first);expect(await readFile(join(f.assetRoot,first.body.storage_path),'utf8')).toBe(content(key));};
  const offlineKey=randomUUID();await volume.unmount();const offline=await submit(offlineKey);expect(offline.status).toBe(409);await expect(access(f.root)).rejects.toMatchObject({code:'ENOENT'});await volume.remount();await recover(offlineKey);evidence.offline={status:offline.status,noHostFallback:true,recoveredSameKey:true};
  const deniedKey=randomUUID();await chmod(materials,0o500);let denied;try{denied=await submit(deniedKey);expect(denied.status,JSON.stringify(denied.body)).toBe(403);}finally{await chmod(materials,0o700);}await recover(deniedKey);evidence.permissions={status:denied!.status,recoveredSameKey:true};
  filler=join(volume.mountPath,'owned-enospc-filler');const handle=await open(filler,'wx',0o600),chunk=randomBytes(1024*1024);let bytes=0,actualCode='';
  try{while(bytes<384*1024*1024){try{await handle.write(chunk);bytes+=chunk.length;}catch(error){actualCode=(error as NodeJS.ErrnoException).code??'';break;}}}finally{await handle.close();}
  // APFS can retain a few MiB for small writes after a large allocation fails.
  // Exercise an actual import larger than that remaining space, not deduplication.
  expect(actualCode).toBe('ENOSPC');const fullKey=randomUUID();largeInputs.add(fullKey);const capacity=await statfs(volume.mountPath),full=await submit(fullKey);evidence.full={actualCode,bytesWrittenBeforeFull:bytes,freeBytes:Number(capacity.bavail)*Number(capacity.bsize),importBytes:Buffer.byteLength(content(fullKey)),status:full.status,error:full.body.error};
  expect([403,409],JSON.stringify(full.body)).toContain(full.status);expect(String(full.body.error)).toMatch(/空间|写入|存储|目录/);await unlink(filler);filler='';await recover(fullKey);
  expect(createHash('sha256').update(await readFile(join(directory,'shot.mp4'))).digest('hex')).toBe(beforeHash);expect((await readdir(materials)).filter(n=>n.startsWith('.input-'))).toEqual([]);evidence.originalMediaUnchanged=true;evidence.fullRecoveredSameKey=true;
 }finally{if(filler)await unlink(filler).catch(()=>{});if(materials)await chmod(materials,0o700).catch(()=>{});if(process.env.LOOP_READINESS_EVIDENCE){await mkdir(process.env.LOOP_READINESS_EVIDENCE,{recursive:true});await writeFile(join(process.env.LOOP_READINESS_EVIDENCE,'04-real-storage-faults.json'),JSON.stringify(evidence,null,2));}await f.close();await volume.close();}
},240000);
