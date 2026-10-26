// @vitest-environment node
import {it,expect} from 'vitest';
import {createLocalDatabase} from './catalog';
it('rejects driver options that could override the local database boundary',async()=>{
 const local={host:'127.0.0.1',port:55472,user:'loop_app',database:'loop_imported',password:'synthetic'};
 expect(()=>createLocalDatabase({...local,connectionString:'postgresql://postgres@remote.invalid/production'})).toThrow();
 expect(()=>createLocalDatabase({...local,stream:()=>{throw Error('must not be invoked');}})).toThrow();
 const pool=createLocalDatabase(local);await pool.end();
});
