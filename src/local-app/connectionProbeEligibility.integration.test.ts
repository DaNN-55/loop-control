// @vitest-environment node
import{it,expect}from'vitest';
import{connectionCatalogFixture}from'./connectionCatalog.fixture';
it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE)('a retained qualification without live probe evidence is unavailable until explicitly verified again',async()=>{
 const f=await connectionCatalogFixture();try{
  const created=await f.command('create',{name:'Probe evidence fixture',provider:'openai',adapter:'openai_images',secret:'synthetic-openai-key'});expect(created.status).toBe(200);const connection=created.body.connection;
  const service=async()=>{const r=await f.request();return r.body.serviceCatalog.groups.find((g:{capability:string})=>g.capability==='image').services.find((s:{connectionId:string})=>s.connectionId===connection.id);};
  expect((await f.command('verify',{connectionId:connection.id})).body.ready).toBe(true);expect(await service()).toMatchObject({status:'verified'});
  await f.admin.query('DELETE FROM local_identity.connection_probe_evidence WHERE version_id=$1',[connection.current_version_id]);
  expect((await f.admin.query('SELECT qualified FROM local_identity.connection_qualifications WHERE version_id=$1',[connection.current_version_id])).rows[0]?.qualified).toBe(true);
  expect(await service()).toMatchObject({executable:false,status:'retryable'});
  expect((await f.command('verify',{connectionId:connection.id})).body.ready).toBe(true);expect(await service()).toMatchObject({status:'verified'});
 }finally{await f.close();}
},60000);
