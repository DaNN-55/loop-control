// @vitest-environment node
import {EventEmitter} from 'node:events';
import {expect,it} from 'vitest';
import {createLocalDatabase} from './catalog';
import {createWorkerDatabase} from './workerDatabase';
it.each([
 ['application',createLocalDatabase,'loop_app'],
 ['worker',createWorkerDatabase,'loop_worker'],
] as const)('%s handles a checked-out connection error',async(_name,create,user)=>{
 const pool=create({host:'127.0.0.1',port:54329,database:'fixture_disconnect',user,password:'synthetic'});
 const client=new EventEmitter();
 try{
  pool.emit('connect',client);
  expect(()=>client.emit('error',new Error('Connection terminated unexpectedly'))).not.toThrow();
 }finally{await pool.end();}
});
