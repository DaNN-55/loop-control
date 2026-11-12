import {expect,it,vi} from 'vitest';
import type {Pool} from 'pg';
import type {WorkerTaskPackage} from '../worker/contracts';
import {executeNativeNarration} from './narrationWorker';
it('rejects a legacy narration before looking up credentials or opening its execution ports',async()=>{
 const query=vi.fn(),task={provider:'volcengine_tts',promptVersion:'narration-v1'} as WorkerTaskPackage;
 await expect(executeNativeNarration({query} as unknown as Pool,undefined,task,{p_task_id:'old',p_attempt:0,p_lease_token:'old'})).rejects.toMatchObject({name:'ProviderRequestNotSentError'});
 expect(query).not.toHaveBeenCalled();
});
