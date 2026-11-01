// @vitest-environment node
import {it,expect} from 'vitest';
import {connectionCatalogFixture} from './connectionCatalog.fixture';
it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE)('rotates MiniMax region through Owner HTTP, freezes the secret, and reads the site without Keychain access',async()=>{
 const f=await connectionCatalogFixture();
 try{
  const created=await f.command('create',{name:'MiniMax region fixture',provider:'minimax',adapter:'minimax_video',secret:'synthetic-cn-key'});
  expect(created.status).toBe(200);const connection=created.body.connection;
  expect((await f.command('verify',{connectionId:connection.id})).body.ready).toBe(false);
  const envelope=JSON.stringify({apiKey:'synthetic-cn-key',region:'cn'});
  const rotated=await f.command('region',{connectionId:connection.id,versionId:connection.current_version_id,region:'cn'});
  expect(rotated.status).toBe(200);expect(rotated.body.connection.current_version_id).not.toBe(connection.current_version_id);
  expect([...f.secrets.values()]).toEqual(['synthetic-cn-key',envelope]);
  expect((await f.command('region',{connectionId:connection.id,versionId:connection.current_version_id,region:'cn'})).status).toBe(409);
  expect((await f.command('region',{connectionId:connection.id,versionId:rotated.body.connection.current_version_id,region:'cn'},f.otherToken)).status).toBe(404);
  expect((await f.command('verify',{connectionId:connection.id})).body).toMatchObject({ready:true,httpStatus:200});
  const reads=f.secretReads,read=await f.request();expect(f.secretReads).toBe(reads);
  expect(read.body.connections[0]).toMatchObject({region:'cn',endpoint:'https://api.minimax.cn',status:'verified'});
  expect(read.body.versions).toHaveLength(2);
  expect(read.body.versions.find((v:{id:string})=>v.id===connection.current_version_id).is_current).toBe(false);
  expect(JSON.stringify(read.body)).not.toContain('synthetic-cn-key');
  expect((await f.request(undefined,f.otherToken)).body.connections).toEqual([]);
  for(const region of ['https://evil.invalid','constructor','']){
   expect((await f.command('rotate',{connectionId:connection.id,provider:'minimax',adapter:'minimax_video',secret:JSON.stringify({apiKey:'synthetic-cn-key',region})})).status).toBe(400);
  }
  expect(f.secrets.size).toBe(2);
 }finally{await f.close();}
},60000);
