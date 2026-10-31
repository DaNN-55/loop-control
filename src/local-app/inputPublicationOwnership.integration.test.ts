// @vitest-environment node
import {it,expect,vi} from 'vitest';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {readFile,lstat,readdir} from 'node:fs/promises';
import {embeddedStudioFixture} from './embeddedStudio.fixture';
import {csrfFor} from './sessions';
const fault=vi.hoisted(()=>({directory:'',mode:'',triggered:false,path:'',retained:'',device:0n,inode:0n,original:'',unknownBytes:''}));
// Only the OS filesystem boundary is faulted; HTTP, PostgreSQL and files remain real.
vi.mock('node:fs/promises',async importOriginal=>{
 const actual=await importOriginal<typeof import('node:fs/promises')>();
 const replace=async(path:string)=>{fault.path=path;fault.retained=path+'.retained';fault.original=await actual.readFile(path,'utf8');await actual.rename(path,fault.retained);fault.unknownBytes=fault.mode.endsWith('-identical')?fault.original:'UNKNOWN REPLACEMENT MUST SURVIVE';await actual.writeFile(path,fault.unknownBytes,{flag:'wx'});const s=await actual.lstat(path,{bigint:true});fault.device=s.dev;fault.inode=s.ino;fault.triggered=true;};
 return{...actual,unlink:async(path:Parameters<typeof actual.unlink>[0])=>{
  if(!fault.triggered&&fault.mode==='interrupt-unlink'&&String(path).startsWith(fault.directory+'/.input-')&&String(path).endsWith('.part')){fault.triggered=true;throw Object.assign(Error('controlled unlink interruption'),{code:'EIO'});}
  return actual.unlink(path);
 },open:async(...args:Parameters<typeof actual.open>)=>{
  const path=String(args[0]),ours=path.startsWith(fault.directory+'/.input-');
  if(!fault.triggered&&ours&&args[1]==='wx'&&((fault.mode==='temporary-open'&&path.endsWith('.part'))||(fault.mode==='receipt-open'&&path.endsWith('.receipt.json')))){
   fault.unknownBytes='UNKNOWN REPLACEMENT MUST SURVIVE';await actual.writeFile(path,fault.unknownBytes,{flag:'wx'});fault.path=path;fault.retained='';fault.original='';const s=await actual.lstat(path,{bigint:true});fault.device=s.dev;fault.inode=s.ino;fault.triggered=true;
  }
  const handle=await actual.open(...args);
  if(!fault.triggered&&ours&&args[1]==='wx'&&((fault.mode.startsWith('temporary-close')&&path.endsWith('.part'))||(fault.mode.startsWith('receipt-close')&&path.endsWith('.receipt.json')))){
   const close=handle.close.bind(handle);handle.close=async()=>{await close();await replace(path);};
  }
  return handle;
 },link:async(source:Parameters<typeof actual.link>[0],destination:Parameters<typeof actual.link>[1])=>{
  if(!fault.triggered&&String(source).startsWith(fault.directory+'/.input-')&&['temporary-link','receipt-link'].includes(fault.mode)){
   await replace(fault.mode==='receipt-link'?String(source).replace(/\.part$/,'.receipt.json'):String(source));throw Object.assign(Error('controlled link failure after replacement'),{code:'EIO'});
  }
  if(!fault.triggered&&fault.mode.startsWith('recovery-receipt-link')&&String(source).startsWith(fault.directory+'/.input-'))await replace(String(source).replace(/\.part$/,'.receipt.json'));
  return actual.link(source,destination);
 }};
});
it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1').each(['temporary-link','receipt-link','temporary-open','receipt-open','temporary-close','receipt-close','temporary-close-identical'])('Owner import preserves unknown replacement and original bytes after %s failure',async mode=>{
 const f=await embeddedStudioFixture();
 try{
  await f.c.query("UPDATE public.episodes SET stage='waiting_input' WHERE id=$1",[f.episode]);
  fault.directory=join(f.assetRoot,'episodes',f.episode,'materials');fault.mode=mode;fault.triggered=false;
  const key=randomUUID(),bytes='EXPECTED MANAGED BYTES';
  const submit=async()=>{const response=await fetch(f.origin+'/api/local/episode-commands',{method:'POST',headers:{Origin:f.origin,'Content-Type':'application/json',Cookie:'loop_owner_session='+f.token,'X-CSRF-Token':csrfFor(f.token)},body:JSON.stringify({command:'importMaterial',idempotencyKey:key,data:{episodeId:f.episode,sourceKind:'file',sourcePath:'ownership.png',materialType:'image',materialPurpose:'visual_reference',mimeType:'image/png',isMainScript:false,contentBase64:Buffer.from(bytes).toString('base64')}})});return{status:response.status,body:await response.json()};};
  const failed=await submit();expect(fault.triggered).toBe(true);expect(failed.status,JSON.stringify(failed.body)).toBe(409);
  expect(await readFile(fault.path,'utf8')).toBe(fault.unknownBytes);const unknown=await lstat(fault.path,{bigint:true});expect([unknown.dev,unknown.ino]).toEqual([fault.device,fault.inode]);
  if(fault.retained){expect(await readFile(fault.retained,'utf8')).toBe(fault.original);if(mode.startsWith('temporary'))expect(fault.original).toBe(bytes);else expect(JSON.parse(fault.original)).toMatchObject({version:1,size:bytes.length});}
  expect((await f.c.query('SELECT id FROM public.production_material_revisions WHERE episode_id=$1',[f.episode])).rows).toEqual([]);
  await f.restart();const retry=await submit();
  if(mode==='temporary-link'||mode.startsWith('temporary-close')){expect(retry.status,JSON.stringify(retry.body)).toBe(409);expect((await readdir(fault.directory)).some(name=>name.endsWith('.receipt.json'))).toBe(true);}
  else{expect(retry.status,JSON.stringify(retry.body)).toBe(200);expect(await readFile(join(f.assetRoot,retry.body.storage_path),'utf8')).toBe(bytes);expect(await submit()).toEqual(retry);}
  expect(await readFile(fault.path,'utf8')).toBe(fault.unknownBytes);const after=await lstat(fault.path,{bigint:true});expect([after.dev,after.ino]).toEqual([fault.device,fault.inode]);
  if(fault.retained)expect(await readFile(fault.retained,'utf8')).toBe(fault.original);
 }finally{fault.mode='';fault.directory='';await f.close();}
},300000);

it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1').each(['recovery-receipt-link','recovery-receipt-link-identical','legacy-receipt'])('Owner recovery preserves a receipt replaced during %s and retries without deleting its unknown bytes',async mode=>{
 const f=await embeddedStudioFixture();
 try{
  await f.c.query("UPDATE public.episodes SET stage='waiting_input' WHERE id=$1",[f.episode]);fault.directory=join(f.assetRoot,'episodes',f.episode,'materials');fault.mode='interrupt-unlink';fault.triggered=false;
  const bytes='RECOVERABLE MANAGED BYTES',key=randomUUID();
  const submit=async()=>{const response=await fetch(f.origin+'/api/local/episode-commands',{method:'POST',headers:{Origin:f.origin,'Content-Type':'application/json',Cookie:'loop_owner_session='+f.token,'X-CSRF-Token':csrfFor(f.token)},body:JSON.stringify({command:'importMaterial',idempotencyKey:key,data:{episodeId:f.episode,sourceKind:'file',sourcePath:'recovery.png',materialType:'image',materialPurpose:'visual_reference',mimeType:'image/png',isMainScript:false,contentBase64:Buffer.from(bytes).toString('base64')}})});return{status:response.status,body:await response.json()};};
  expect((await submit()).status).toBe(409);expect(fault.triggered).toBe(true);
  const receipt=(await readdir(fault.directory)).find(name=>name.endsWith('.receipt.json'))!,record=JSON.parse(await readFile(join(fault.directory,receipt),'utf8')),target=join(fault.directory,record.target),temporary=join(fault.directory,receipt.replace('.receipt.json','.part'));
  expect((await lstat(target)).nlink).toBe(2);
  if(mode==='legacy-receipt'){
   delete record.receiptDevice;delete record.receiptInode;const actual=await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');await actual.writeFile(join(fault.directory,receipt),JSON.stringify(record));await f.restart();
   const recovered=await submit();expect(recovered.status,JSON.stringify(recovered.body)).toBe(200);expect(await readFile(target,'utf8')).toBe(bytes);expect((await lstat(target)).nlink).toBe(1);expect((await readdir(fault.directory)).filter(name=>name.startsWith('.input-'))).toEqual([]);return;
  }
  await import('node:fs/promises').then(fs=>fs.unlink(target));await f.restart();fault.mode=mode;fault.triggered=false;
  const failed=await submit();expect(fault.triggered).toBe(true);expect(failed.status,JSON.stringify(failed.body)).toBe(409);
  expect(await readFile(fault.path,'utf8')).toBe(fault.unknownBytes);expect(await readFile(fault.retained,'utf8')).toBe(fault.original);expect(await readFile(temporary,'utf8')).toBe(bytes);expect(await readFile(target,'utf8')).toBe(bytes);
  expect((await f.c.query('SELECT id FROM public.production_material_revisions WHERE episode_id=$1',[f.episode])).rows).toEqual([]);
  await f.restart();expect((await submit()).status).toBe(409);expect(await readFile(fault.path,'utf8')).toBe(fault.unknownBytes);const unknown=await lstat(fault.path,{bigint:true});expect([unknown.dev,unknown.ino]).toEqual([fault.device,fault.inode]);
  // Owner can restore the held receipt; the same request then finishes the nlink2 publication.
  const actual=await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');await actual.rename(fault.path,fault.path+'.unknown-retained');await actual.rename(fault.retained,fault.path);
  const recovered=await submit();expect(recovered.status,JSON.stringify(recovered.body)).toBe(200);expect((await lstat(target)).nlink).toBe(1);expect(await readFile(target,'utf8')).toBe(bytes);expect(await readFile(fault.path+'.unknown-retained','utf8')).toBe(fault.unknownBytes);
 }finally{fault.mode='';fault.directory='';await f.close();}
},300000);
