// @vitest-environment node
import {it,expect} from 'vitest';
import {connectionCatalogFixture} from './connectionCatalog.fixture';
it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE)('reads only owned current-version usage through Owner HTTP and caches without touching generation or verification',async()=>{
 const f=await connectionCatalogFixture();
 try{
  const created=await f.command('create',{name:'Usage fixture',provider:'freesound',adapter:'freesound_preview',secret:'synthetic-freesound-key'});expect(created.status).toBe(200);const connection=created.body.connection;
  const usage=async(id=connection.id,token=f.token)=>{const r=await fetch(f.origin+'/api/local/connection-usage?connectionId='+id,{headers:{Cookie:'loop_owner_session='+token}});return{status:r.status,body:await r.json()};};
  const before=f.secretReads,read=await usage();expect(read.status).toBe(200);expect(read.body).toMatchObject({connectionId:connection.id,versionId:connection.current_version_id,usage:{remaining:{text:'1,998 次'},recent:{text:'8 次'}}});
  expect(f.secretReads).toBe(before+1);expect((await usage()).body).toEqual(read.body);expect(f.secretReads).toBe(before+1);
  expect((await usage(connection.id,f.otherToken)).status).toBe(404);expect((await usage(connection.id,'')).status).toBe(401);expect((await usage('invalid')).status).toBe(400);expect(f.secretReads).toBe(before+1);
  expect((await f.request()).body.connections[0].status).toBe('unverified');expect(JSON.stringify(read.body)).not.toContain('synthetic-freesound-key');
  const rotated=await f.command('rotate',{connectionId:connection.id,provider:'freesound',adapter:'freesound_preview',secret:'synthetic-freesound-key'});expect(rotated.status).toBe(200);
  const next=await usage();expect(next.body.versionId).toBe(rotated.body.connection.current_version_id);expect(next.body.versionId).not.toBe(read.body.versionId);expect(f.secretReads).toBe(before+2);
 }finally{await f.close();}
},60000);
