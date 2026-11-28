import {it,expect} from 'vitest';
import {assertStudioCapabilityCompatibility,isolateStudioRuntime} from './openchatcutStudio';
it('refuses paid/local-only session reuse in both directions without changing either session',()=>{
 const paid={},local={capabilityProfile:'harness-local-only' as const};
 expect(()=>assertStudioCapabilityCompatibility(paid,local)).toThrow('请先保存');expect(()=>assertStudioCapabilityCompatibility(local,paid)).toThrow('请先保存');
 try{assertStudioCapabilityCompatibility(paid,local);}catch(error){expect(error).toHaveProperty('status',409);}
 expect(()=>assertStudioCapabilityCompatibility(local,local)).not.toThrow();expect(()=>assertStudioCapabilityCompatibility(undefined,local)).not.toThrow();expect(()=>assertStudioCapabilityCompatibility(paid,paid)).not.toThrow();
});
it('uses an explicit base environment, not paid secrets, proxies, NODE_OPTIONS or ambient agent models',()=>{
 const environment={PATH:'/bin',HOME:'/safe',TMPDIR:'/tmp',LLM_OPENAI_API_KEY:'sentinel',LOOP_STUDIO_AGENT_MODELS:'sentinel',OPENAI_API_KEY:'sentinel',NODE_OPTIONS:'--import secret',HTTPS_PROXY:'http://sentinel'};
 const result=isolateStudioRuntime({capabilityProfile:'harness-local-only',environment});expect(result.environment).toEqual({PATH:'/bin',HOME:'/safe',TMPDIR:'/tmp',LOOP_STUDIO_CAPABILITY_PROFILE:'harness-local-only'});expect(environment.LLM_OPENAI_API_KEY).toBe('sentinel');expect(isolateStudioRuntime({environment}).environment).toBe(environment);
});
