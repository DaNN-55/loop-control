import{expect,it}from'vitest';
import{editorBridgeShouldRetry,patchEditorBridgeRetry}from'./openchatcut-bridge-retry.mjs';
function failure(status){return Object.assign(new Error('bridge request failed'),{name:'EditorBridgeRequestError',status});}
it('stops displaced or unauthorized editors and aborted attempts',()=>{
 const controller=new AbortController();expect(editorBridgeShouldRetry(failure(409),controller.signal)).toBe(false);expect(editorBridgeShouldRetry(failure(401),controller.signal)).toBe(false);controller.abort();expect(editorBridgeShouldRetry(Error('network'),controller.signal)).toBe(false);
});
it('keeps temporary request failures retryable',()=>{
 const signal=new AbortController().signal;expect(editorBridgeShouldRetry(Error('network'),signal)).toBe(true);expect(editorBridgeShouldRetry(failure(503),signal)).toBe(true);
});
it('rejects unsupported Studio source instead of silently skipping the ownership fix',()=>expect(()=>patchEditorBridgeRetry('unknown')).toThrow('编辑连接重试接点'));
