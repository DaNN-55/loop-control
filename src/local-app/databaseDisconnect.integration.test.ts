// @vitest-environment node
import {once} from 'node:events';
import {afterAll,beforeAll,expect,it} from 'vitest';
import {createLocalDatabase} from './catalog';
import {createWorkerDatabase} from './workerDatabase';
import {nativeWorkspaceFixture} from './nativeWorkspace.fixture';
import {mediaRootDatabaseTransport} from './mediaRootRuntime.fixture';
const enabled=process.env.LOOP_WORKSPACE_ACCEPTANCE==='1';
let fixture:Awaited<ReturnType<typeof nativeWorkspaceFixture>>;
let transport:Awaited<ReturnType<typeof mediaRootDatabaseTransport>>;
beforeAll(async()=>{
 if(!enabled)return;
 fixture=await nativeWorkspaceFixture();
 transport=await mediaRootDatabaseTransport(fixture);
},60000);
afterAll(async()=>{await transport?.close();await fixture?.close();});
it.skipIf(!enabled).each([
 ['application',createLocalDatabase,'loop_app'],
 ['worker',createWorkerDatabase,'loop_worker'],
] as const)('%s survives checked-out and in-flight PostgreSQL disconnects',async(_name,create,user)=>{
 const pool=create({...transport.database,user});
 try{
  const client=await pool.connect();
  const {rows:[{pid}]}=await client.query('SELECT pg_backend_pid() AS pid');
  const disconnected=once(client,'error');
  await fixture.c.query('SELECT pg_terminate_backend($1)',[pid]);
  await disconnected;
  await expect(client.query('SELECT 1')).rejects.toThrow();
  client.release();
  expect((await pool.query('SELECT 42 AS value')).rows[0].value).toBe(42);
  const busy=await pool.connect();
  const {rows:[{pid:busyPid}]}=await busy.query('SELECT pg_backend_pid() AS pid');
  const ended=new Promise<void>(resolve=>busy.once('end',resolve));
  const rejected=expect(busy.query('SELECT pg_sleep(20)')).rejects.toThrow();
  await fixture.c.query('SELECT pg_terminate_backend($1)',[busyPid]);
  await rejected;
  await ended;
  busy.release();
  expect((await pool.query('SELECT 43 AS value')).rows[0].value).toBe(43);
  await expect(pool.query('SELECT nonexistent_disconnect_column')).rejects.toMatchObject({code:'42703'});
  expect((await pool.query('SELECT 44 AS value')).rows[0].value).toBe(44);
 }finally{await pool.end();}
},30000);
