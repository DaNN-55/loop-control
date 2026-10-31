// @vitest-environment node
import {it,expect,vi} from 'vitest';
const fault=vi.hoisted(()=>({afterMkdir:false,errno:''}));
vi.mock('node:fs/promises',async original=>{const actual=await original<typeof import('node:fs/promises')>();return{...actual,mkdir:async(path:Parameters<typeof actual.mkdir>[0],options?:Parameters<typeof actual.mkdir>[1])=>{if(fault.errno){const code=fault.errno;fault.errno='';throw Object.assign(Error('controlled creation failure'),{code});}const result=await actual.mkdir(path,options);if(fault.afterMkdir){fault.afterMkdir=false;throw Object.assign(Error('controlled mkdir interruption'),{code:'EIO'});}return result;}};});
import {randomUUID} from 'node:crypto';
import * as fs from 'node:fs/promises';
import {join} from 'node:path';
import {embeddedStudioFixture} from './embeddedStudio.fixture';
import {workspaceAudioVolume} from './workspaceAudioVolume.fixture';
import {csrfFor} from './sessions';
it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('resumes mkdir/publication failures with one UUID and preserves unknown data and replaced identities',async()=>{
 const volume=await workspaceAudioVolume(),f=await embeddedStudioFixture({testRootParent:volume.mountPath,runtime:{mountPath:volume.mountPath}});
 try{
 const account=(await f.c.query('SELECT id FROM public.accounts')).rows[0].id;
 const post=async(route:string,command:string,data:Record<string,unknown>,key:string=randomUUID())=>{const r=await fetch(f.origin+'/api/local/'+route,{method:'POST',headers:{Origin:f.origin,'Content-Type':'application/json',Cookie:'loop_owner_session='+f.token,'X-CSRF-Token':csrfFor(f.token)},body:JSON.stringify({command,data,idempotencyKey:key})});return{status:r.status,body:await r.json()};};
 const series=(await post('configuration','createSeries',{accountId:account,name:'faults',rules:{}})).body;
 const call=(key:string,title='faults')=>post('episode-commands','create',{accountId:account,title,seriesVersionId:series.id},key);
 const saved=async(key:string)=>(await f.c.query('SELECT * FROM local_identity.episode_creation_intents WHERE idempotency_key=$1',[key])).rows[0];
 fault.afterMkdir=true;const gap=randomUUID();expect((await call(gap)).status).toBe(409);const empty=await saved(gap),path=join(empty.account_root,empty.directory_relative_path);expect(empty.device_id).toBeNull();expect(await fs.readdir(path)).toEqual([]);await f.restart();expect((await call(gap)).body.id).toBe(empty.episode_id);expect((await saved(gap)).cleanup_owned).toBe(false);
 for(const code of ['EACCES','ENOSPC']){fault.errno=code;const key=randomUUID();expect((await call(key)).status).toBe(409);const i=await saved(key);await expect(fs.lstat(join(i.account_root,i.directory_relative_path))).rejects.toMatchObject({code:'ENOENT'});expect((await call(key)).body.id).toBe(i.episode_id);}
 await f.c.query("CREATE FUNCTION public.test_episode_identity_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.device_id IS NOT NULL AND NEW.payload->>'title'='publication' THEN RAISE EXCEPTION 'controlled identity save failure';END IF;RETURN NEW;END $$;CREATE TRIGGER test_episode_identity_fail BEFORE UPDATE ON local_identity.episode_creation_intents FOR EACH ROW EXECUTE FUNCTION public.test_episode_identity_fail()");
 const publication=randomUUID();expect((await call(publication,'publication')).status).toBe(409);const i=await saved(publication),p=join(i.account_root,i.directory_relative_path);expect(i.device_id).toBeNull();await fs.writeFile(join(p,'manual.txt'),'unknown bytes retained');await f.c.query('DROP TRIGGER test_episode_identity_fail ON local_identity.episode_creation_intents;DROP FUNCTION public.test_episode_identity_fail()');await f.restart();expect((await call(publication,'publication')).body.id).toBe(i.episode_id);expect(await fs.readFile(join(p,'manual.txt'),'utf8')).toBe('unknown bytes retained');
 await f.c.query("CREATE FUNCTION public.test_episode_location_pause() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.layout_version=2 THEN PERFORM pg_advisory_xact_lock(178191);END IF;RETURN NEW;END $$;CREATE TRIGGER test_episode_location_pause BEFORE UPDATE ON local_identity.episode_asset_locations FOR EACH ROW EXECUTE FUNCTION public.test_episode_location_pause()");
 const paused=async(key:string)=>{for(let n=0;n<150;n++){const i=await saved(key);if(i?.device_id&&(await f.c.query("SELECT 1 FROM pg_locks WHERE locktype='advisory' AND objid=178191 AND NOT granted")).rowCount)return i;await new Promise(r=>setTimeout(r,10));}throw Error('Final location UPDATE did not pause');};
 for(const kind of ['marker','child','container','account']){
  await f.c.query('SELECT pg_advisory_lock(178191)');const key=randomUUID(),pending=call(key,kind),i=await paused(key),path=join(i.account_root,i.directory_relative_path),marker=join(path,'.loop-control-creation.json');
  let retained:string;
  if(kind==='marker'){retained=join(f.root,'original-marker');const bytes=await fs.readFile(marker);await fs.rename(marker,retained);await fs.writeFile(marker,bytes);}
  else if(kind==='child'){retained=path+'-retained';await fs.rename(path,retained);await fs.mkdir(path);await fs.writeFile(marker,await fs.readFile(join(retained,'.loop-control-creation.json')));await fs.writeFile(join(path,'manual.txt'),'replacement child');}
  else {const parent=kind==='account'?i.account_root:join(i.account_root,i.container_relative_path);retained=parent+'-retained';await fs.rename(parent,retained);await fs.mkdir(parent);const oldChild=kind==='account'?join(retained,i.directory_relative_path):join(retained,i.directory_relative_path.split('/').at(-1));if(kind==='account')await fs.mkdir(join(parent,i.container_relative_path));await fs.rename(oldChild,path);await fs.writeFile(join(parent,'manual.txt'),'replacement parent');}
  await f.c.query('SELECT pg_advisory_unlock(178191)');expect((await pending).status).toBe(409);expect((await f.c.query('SELECT count(*)::int n FROM public.episodes WHERE id=$1',[i.episode_id])).rows[0].n).toBe(0);expect((await fs.lstat(marker)).isFile()).toBe(true);
  if(kind==='marker'){await fs.unlink(marker);await fs.rename(retained,marker);}
  else if(kind==='child'){expect(await fs.readFile(join(path,'manual.txt'),'utf8')).toBe('replacement child');await fs.rm(path,{recursive:true});await fs.rename(retained,path);}
  else {const parent=kind==='account'?i.account_root:join(i.account_root,i.container_relative_path),oldChild=kind==='account'?join(retained,i.directory_relative_path):join(retained,i.directory_relative_path.split('/').at(-1));expect(await fs.readFile(join(parent,'manual.txt'),'utf8')).toBe('replacement parent');await fs.rename(path,oldChild);await fs.rm(parent,{recursive:true});await fs.rename(retained,parent);}
  expect((await call(key,kind)).status).toBe(200);
 }
 }finally{fault.afterMkdir=false;fault.errno='';await f.c.query('SELECT pg_advisory_unlock_all()');await f.close();await volume.close();}
},240000);
