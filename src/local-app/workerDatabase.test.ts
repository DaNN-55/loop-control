// @vitest-environment node
import {it,expect,vi} from 'vitest';
import type {Pool} from 'pg';
import {createWorkerDatabase,nativeWorkerPort} from './workerDatabase';
it('requires the distinct Worker login and allows only native scoped commands',async()=>{
 expect(()=>createWorkerDatabase({host:'127.0.0.1',port:55472,user:'loop_app',password:'synthetic'})).toThrow();
 const query=vi.fn().mockResolvedValue({rows:[{task_id:'t'}],rowCount:1}),port=nativeWorkerPort({query} as unknown as Pool);
 expect(await port.rpc('claim_next_worker_task',{p_worker_capacity:2})).toEqual([{task_id:'t'}]);
 expect(query).toHaveBeenLastCalledWith('SELECT * FROM local_identity.claim_input_task($1,$2)',[null,2]);
 expect(await port.plan({episodeId:'e'})).toBe(1);expect(query).toHaveBeenLastCalledWith('SELECT id FROM local_identity.plan_input_tasks($1)',['e']);
 await expect(port.rpc('transition_episode',{})).rejects.toThrow();expect(query).toHaveBeenCalledTimes(2);
});
