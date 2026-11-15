// @vitest-environment node
import {expect,it,vi} from 'vitest';
import type {Pool} from 'pg';
import {observeProductionRequest} from './productionMetricWrites';
import {ProviderOutcomeUnknownError,ProviderRequestNotSentError} from '../worker/providerOutcome';
import {VideoGenerationError} from '../worker/videoGenerationError';
const fence={p_task_id:'00000000-0000-4000-8000-000000000001',p_attempt:0,p_lease_token:'00000000-0000-4000-8000-000000000002'};
function database(enabled=true,failResponse=false){return{query:vi.fn(async(sql:string,args?:unknown[])=>{
 if(sql.includes('to_regprocedure'))return{rows:[{present:true}]};
 if(failResponse&&args?.[3]==='provider_response_observed')throw Error('Disconnected after a paid response');
 return{rows:[{recorded:enabled}]};
})}as unknown as Pool;}
it('preserves disabled transport classifications, including local not-sent and accepted video recovery',async()=>{
 for(const error of [new VideoGenerationError('not sent','not_sent'),new VideoGenerationError('poll original','accepted'),new ProviderRequestNotSentError('input_changed')]){
  const transport=vi.fn().mockRejectedValue(error);await expect(observeProductionRequest(database(false),fence,'create',transport)).rejects.toBe(error);expect(transport).toHaveBeenCalledTimes(1);
 }
});
it('never retries a transport when its response could not be recorded',async()=>{
 const transport=vi.fn().mockResolvedValue(new Response('{}',{status:200}));
 await expect(observeProductionRequest(database(true,true),fence,'create',transport)).rejects.toBeInstanceOf(ProviderOutcomeUnknownError);
 expect(transport).toHaveBeenCalledTimes(1);
});
it('retains definite original errors with collection enabled and keeps request markers separate from responses',async()=>{
 const error=new VideoGenerationError('validation did not send','not_sent'),transport=vi.fn().mockRejectedValue(error),db=database();
 await expect(observeProductionRequest(db,fence,'create',transport)).rejects.toBe(error);expect(transport).toHaveBeenCalledTimes(1);
 const calls=vi.mocked(db.query).mock.calls;expect(calls.filter(c=>c[1]?.[3]==='provider_response_observed')).toHaveLength(0);
});
it('does not call transport when the pre-dispatch minimal record fails',async()=>{
 const db={query:vi.fn().mockRejectedValue(Error('Database down'))}as unknown as Pool,transport=vi.fn();
 await expect(observeProductionRequest(db,fence,'create',transport)).rejects.toBeInstanceOf(ProviderRequestNotSentError);expect(transport).not.toHaveBeenCalled();
});
