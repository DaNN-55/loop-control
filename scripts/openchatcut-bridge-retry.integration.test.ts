// @vitest-environment node
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {transform} from 'esbuild';
import {expect,it} from 'vitest';
import {editorBridgeShouldRetry,patchEditorBridgeRetry} from './openchatcut-bridge-retry.mjs';
const root=process.env.OPENCHATCUT_ROOT;
if(!root)throw Error('编辑连接重试集成测试需要 OPENCHATCUT_ROOT。');
const source=await readFile(resolve(root,'src/agent/useExternalAgentBridge.ts'),'utf8');
class EditorBridgeRequestError extends Error{constructor(readonly status:number){super('bridge request failed');this.name='EditorBridgeRequestError';}}
async function realLoop(patched:boolean,scenario:'displaced'|'unauthorized'|'network'|'aborted-registration'|'aborted-poll'){
 const actual=patched?patchEditorBridgeRetry(source):source;
 const functions=actual.slice(actual.indexOf('async function runBridgeAttempt('),actual.indexOf('export async function hydrateExternalBridge('));
 const {code}=await transform(functions,{loader:'ts',format:'esm'});
 const controller=new AbortController(),events:string[]=[];let attempts=0,installed=0,ownership:any;
 const scope={editorBridgeShouldRetry,
 ExternalCallCancellationRegistry:class{abortAll(){}},
 registerEditorBridge:async()=>{attempts++;events.push('register');if(scenario==='aborted-registration')controller.abort();return{projectId:'p',ownerId:'old-owner',epoch:attempts,baseRevision:'v1',registrationCapability:'cap'};},
 browserProjectOwnership:()=>ownership,
 installBrowserProjectOwnership:(value:unknown)=>{ownership=value;installed++;},
 clearBrowserProjectOwnership:(value:any)=>{if(ownership?.ownerId===value.ownerId&&ownership?.epoch===value.epoch)ownership=undefined;},
 pollRegisteredBridge:async()=>{events.push('poll');if(scenario==='aborted-poll'){controller.abort();throw Error('aborted');}if(scenario==='network'&&attempts===1)throw Error('network');if(attempts===3)controller.abort();throw new EditorBridgeRequestError(scenario==='unauthorized'?401:409);},
 handleExternalBridgeAttemptError:()=>false,
 unregisterEditorBridge:async()=>events.push('unregister'),
 retryDelay:()=>Promise.resolve()
 };
 const runBridge=new Function(...Object.keys(scope),code+';return runBridge;')(...Object.values(scope));
 await runBridge('p',{binding:()=>({editorInstanceId:'old-owner',baseRevision:'v1'})},controller.signal,()=>{});
 return{attempts,installed,events};
}
it('stops automatic re-claim after a real SDK poll loses ownership',async()=>{
 // The unmodified SDK is the red control: it re-registers until our safety abort.
 expect((await realLoop(false,'displaced')).attempts).toBe(3);
 expect((await realLoop(true,'displaced')).attempts).toBe(1);
});
it('stops re-registering after authorization is rejected',async()=>expect((await realLoop(true,'unauthorized')).attempts).toBe(1));
it('retries a temporary network failure but stops at the next ownership conflict',async()=>expect((await realLoop(true,'network')).attempts).toBe(2));
it('cleans up a late registration without installing it after unmount',async()=>{
 expect((await realLoop(false,'aborted-registration')).installed).toBe(1);
 const result=await realLoop(true,'aborted-registration');expect(result.installed).toBe(0);expect(result.attempts).toBe(1);expect(result.events).toEqual(['register','unregister']);
});
it('does not restart a bridge cancelled during polling',async()=>expect((await realLoop(true,'aborted-poll')).attempts).toBe(1));
async function twoEditors(patched:boolean){
 const actual=patched?patchEditorBridgeRetry(source):source;
 const functions=actual.slice(actual.indexOf('async function runBridgeAttempt('),actual.indexOf('export async function hydrateExternalBridge('));
 const {code}=await transform(functions,{loader:'ts',format:'esm'});
 const controller=new AbortController(),counts={first:0,second:0};let activeOwner='';
 const tick=()=>new Promise<void>(resolve=>setImmediate(resolve));
 function editor(owner:'first'|'second'){
  let localOwnership:any;
  const scope={editorBridgeShouldRetry,ExternalCallCancellationRegistry:class{abortAll(){}},
   registerEditorBridge:async()=>{counts[owner]++;activeOwner=owner;return{projectId:'p',ownerId:owner,epoch:counts.first+counts.second,baseRevision:'v1',registrationCapability:'cap-'+owner};},
   browserProjectOwnership:()=>localOwnership,installBrowserProjectOwnership:(value:unknown)=>localOwnership=value,
   clearBrowserProjectOwnership:(value:any)=>{if(localOwnership?.ownerId===value.ownerId&&localOwnership?.epoch===value.epoch)localOwnership=undefined;},
   pollRegisteredBridge:async()=>{while(!controller.signal.aborted){await tick();if(activeOwner!==owner)throw new EditorBridgeRequestError(409);}},
   handleExternalBridgeAttemptError:()=>false,
   unregisterEditorBridge:async()=>{if(activeOwner===owner)activeOwner='';},retryDelay:tick
  };
  const runBridge=new Function(...Object.keys(scope),code+';return runBridge;')(...Object.values(scope));
  return runBridge('p',{binding:()=>({editorInstanceId:owner,baseRevision:'v1'})},controller.signal,()=>{});
 }
 const first=editor('first'),second=editor('second');
 for(let turn=0;turn<12;turn++)await tick();
 controller.abort();await Promise.all([first,second]);return counts;
}
it('prevents two real SDK retry loops from repeatedly taking ownership from each other',async()=>{
 const old=await twoEditors(false);expect(old.first+old.second).toBeGreaterThan(2);
 const fixed=await twoEditors(true);expect(fixed).toEqual({first:1,second:1});
});
