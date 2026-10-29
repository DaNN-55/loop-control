// @vitest-environment node
import {expect,it} from 'vitest';
import {observeWorker} from './runtimeStatus';
const at=Date.parse('2026-10-29T12:00:00Z');
const observation={stopped:false,lastHeartbeatAt:new Date(at-4000).toISOString(),lastScanAt:new Date(at-4000).toISOString(),lastError:null,activeWorkers:0,capacity:2};
it('idle online is proven by fresh scheduler heartbeat, never by a completed task',()=>{
 expect(observeWorker(observation,at)).toMatchObject({state:'healthy',active:0,capacity:2});
 expect(observeWorker(undefined,at)).toMatchObject({state:'unknown',active:null});
 expect(observeWorker({...observation,lastHeartbeatAt:new Date(at-16000).toISOString()},at).state).toBe('offline');
 expect(observeWorker({...observation,stopped:true},at).state).toBe('offline');
});
it('fresh heartbeat with a stuck/erroring scan is attention and redacts raw diagnostics',()=>{
 expect(observeWorker({...observation,lastScanAt:new Date(at-31000).toISOString()},at).state).toBe('attention');
 const status=observeWorker({...observation,lastError:'private token and file path'},at);
 expect(status.state).toBe('attention');expect(JSON.stringify(status)).not.toContain('private');
});
