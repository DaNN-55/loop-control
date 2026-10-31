// @vitest-environment node
import {it,expect} from 'vitest';
import {mkdir,access,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {embeddedStudioFixture} from './embeddedStudio.fixture';
import {csrfFor} from './sessions';

it.skipIf(process.env.LOOP_ACCOUNT_DELETION_ACCEPTANCE!=='1')('account deletion cleans only registered empty containers, retaining unknown parents and immutable completed creation history',async()=>{
 const f=await embeddedStudioFixture();
 const post=async(endpoint:string,command:string,data:Record<string,unknown>)=>{const response=await fetch(f.origin+'/api/local/'+endpoint,{method:'POST',headers:{Origin:f.origin,'Content-Type':'application/json',Cookie:'loop_owner_session='+f.token,'X-CSRF-Token':csrfFor(f.token)},body:JSON.stringify({command,idempotencyKey:randomUUID(),data})});return{status:response.status,body:await response.json()};};
 try{
  const created=await post('configuration','createAccount',{name:'空账号 中文 %_[]',slug:'empty-'+randomUUID(),timezone:'UTC',policy:{}});expect(created.status,JSON.stringify(created.body)).toBe(200);const account=created.body.id;
  const series=await post('configuration','createSeries',{accountId:account,name:'系列 %_[]',rules:{}});expect(series.status,JSON.stringify(series.body)).toBe(200);expect((await post('account-commands','createUnassignedDirectory',{accountId:account})).status).toBe(200);
  const root=(await f.c.query('SELECT actual_root FROM local_identity.account_asset_directories WHERE account_id=$1',[account])).rows[0].actual_root,containers=(await f.c.query('SELECT * FROM local_identity.account_storage_containers WHERE account_id=$1',[account])).rows;
  const before=(await f.c.query('SELECT to_jsonb(i) value FROM local_identity.container_creation_intents i WHERE account_id=$1 ORDER BY idempotency_key',[account])).rows;
  const unknown=join(root,'unknown empty manual directory');await mkdir(unknown);
  const foreignBefore=await readFile(join(f.assetRoot,f.videoPath));
  const deleted=await post('configuration','deleteAccount',{accountId:account,confirmation:'空账号 中文 %_[]'});expect(deleted,JSON.stringify(deleted.body)).toEqual({status:200,body:true});
  for(const container of containers)await expect(access(join(root,container.directory_relative_path))).rejects.toMatchObject({code:'ENOENT'});
  await access(unknown);expect(await readFile(join(f.assetRoot,f.videoPath))).toEqual(foreignBefore);expect((await f.c.query('SELECT to_jsonb(i) value FROM local_identity.container_creation_intents i WHERE account_id=$1 ORDER BY idempotency_key',[account])).rows).toEqual(before);
 }finally{await f.close();}
},300000);
