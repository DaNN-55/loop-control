// @vitest-environment node
import{it,expect}from'vitest';
import{connectionCatalogFixture}from'./connectionCatalog.fixture';
it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE)('legacy MiniMax region comes from its immutable credential once and unavailable credentials never imply the international site',async()=>{
 const f=await connectionCatalogFixture();try{
  const created=await f.command('create',{name:'Legacy domestic',provider:'minimax',adapter:'minimax_video',secret:JSON.stringify({apiKey:'synthetic-cn-key',region:'cn'})});expect(created.status).toBe(200);const c=created.body.connection;
  await f.admin.query("UPDATE local_identity.connection_intents SET metadata=metadata-'region' WHERE version_id=$1",[c.current_version_id]);
  const before=f.secretReads,first=await f.request();expect(first.body.connections.find((v:{id:string})=>v.id===c.id)).toMatchObject({region:'cn',endpoint:'https://api.minimax.cn'});expect(f.secretReads).toBe(before+1);await f.request();expect(f.secretReads).toBe(before+1);
  const missing=await f.command('create',{name:'Legacy missing binding',provider:'minimax',adapter:'minimax_video',secret:JSON.stringify({apiKey:'synthetic-unavailable-key',region:'cn'})});const version=missing.body.connection.current_version_id;await f.admin.query("UPDATE local_identity.connection_intents SET metadata=metadata-'region' WHERE version_id=$1",[version]);const binding=(await f.admin.query('SELECT secret_ref FROM local_identity.connection_bindings WHERE version_id=$1',[version])).rows[0];f.secrets.delete(binding.secret_ref);
  const result=(await f.request()).body,unknown=result.connections.find((v:{id:string})=>v.id===missing.body.connection.id);expect(unknown.region).toBeUndefined();expect(unknown.endpoint).toBe('');expect(JSON.stringify(result)).not.toContain('synthetic-cn-key');expect((await f.request(undefined,f.otherToken)).body.connections).toEqual([]);
 }finally{await f.close();}
},60000);
