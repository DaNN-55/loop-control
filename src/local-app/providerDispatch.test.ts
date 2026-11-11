// @vitest-environment node
import {it,expect} from 'vitest';
import type{Pool}from'pg';
import {prepareProviderDispatch,markProviderDispatching,recoverProviderPreparation}from'./providerDispatch';
const fence={p_task_id:'task',p_attempt:0,p_lease_token:'lease'};
it('only retries transient preparation when the persisted budget authorizes it',async()=>{
 let tries=0,budget=0;const pool={query:async(sql:string)=>{
  if(sql.includes('allow_provider'))return{rows:[{allowed:++budget<=2}]};
  if(++tries<=2)throw Object.assign(Error('temporary'),{code:'40001'});return{rows:[{decision:{phase:'reserved',route:'confirmed'}}]};
 }} as unknown as Pool;
 expect(await prepareProviderDispatch(pool,fence,'speech')).toBe('confirmed');expect(tries).toBe(3);expect(budget).toBe(2);
});
it('does not retry unknown, permission errors or an unconfirmed counter write',async()=>{
 for(const error of [Object.assign(Error('permission'),{code:'42501'}),Object.assign(Error('temporary'),{code:'ECONNRESET'})]){
  let tries=0;const pool={query:async(sql:string)=>{if(sql.includes('allow_provider'))throw Error('database unavailable');tries++;throw error;}}as unknown as Pool;
  await expect(prepareProviderDispatch(pool,fence,'image')).rejects.toMatchObject({name:'ProviderRequestNotSentError'});expect(tries).toBe(1);
 }
 await expect(prepareProviderDispatch({query:async()=>({rows:[{decision:{phase:'unknown'}}]})}as unknown as Pool,fence,'speech')).rejects.toMatchObject({name:'ProviderOutcomeUnknownError'});
});
it('an ambiguous dispatch marker cannot authorize another preparation or send',async()=>{
 let calls=0;await expect(markProviderDispatching({query:async()=>{calls++;throw Object.assign(Error('lost write receipt'),{code:'ECONNRESET'});}}as unknown as Pool,fence)).rejects.toMatchObject({name:'ProviderOutcomeUnknownError'});expect(calls).toBe(1);
});
it('local transient IO uses the same persisted budget and stops after two recoveries',async()=>{
 let budget=0,tries=0;const pool={query:async()=>({rows:[{allowed:++budget<=2}]})}as unknown as Pool;
 await expect(recoverProviderPreparation(pool,fence,'image',async()=>{tries++;throw Object.assign(Error('busy'),{code:'EBUSY'});})).rejects.toMatchObject({name:'ProviderRequestNotSentError'});expect(tries).toBe(3);
});
