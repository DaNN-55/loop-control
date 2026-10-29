// @vitest-environment node
import{it,expect}from'vitest';
import{resolveRuntimeSecretReference,historicalLiteralValue}from'./keychain.mjs';
import{createHash}from'node:crypto';
const old='00000000-0000-4000-8000-000000000001',middle='00000000-0000-4000-8000-000000000002',canonical='00000000-0000-4000-8000-000000000003';
it('keeps current UUIDs and resolves historical aliases to the canonical item',()=>{
 expect(resolveRuntimeSecretReference(canonical)).toBe(canonical);
 expect(resolveRuntimeSecretReference(old,{[old]:middle,[middle]:canonical})).toBe(canonical);
});
it('rejects malformed targets and cycles before calling the native helper',()=>{
 expect(()=>resolveRuntimeSecretReference(old,{[old]:'not-a-uuid'})).toThrow('Invalid runtime secret reference');
 expect(()=>resolveRuntimeSecretReference(old,{[old]:middle,[middle]:old})).toThrow('Cyclic runtime secret aliases');
 expect(()=>resolveRuntimeSecretReference(old,[])).toThrow('Invalid runtime secret aliases');
});
it.each(['template-literals','history-literals'])('restores the exact public literal bytes only from its pinned %s catalog',kind=>{
 const value='MODEL=example-model\r',hash=v=>createHash('sha256').update(v).digest('hex');
 const content=Buffer.from(JSON.stringify({version:1,kind,entries:{[canonical]:{value}}}));
 const descriptor={catalogSha256:hash(content),catalogBytes:content.length,valueSha256:hash(value),valueBytes:Buffer.byteLength(value)};
 expect(historicalLiteralValue(canonical,descriptor,content)).toBe(value);
 expect(()=>historicalLiteralValue(old,descriptor,content)).toThrow('Historical literal value mismatch');
 expect(()=>historicalLiteralValue(canonical,descriptor,Buffer.concat([content,Buffer.from(' ')]))).toThrow('Historical literal catalog mismatch');
 expect(()=>historicalLiteralValue(canonical,{...descriptor,valueSha256:'0'.repeat(64)},content)).toThrow('Historical literal value mismatch');
 const unknown=Buffer.from(JSON.stringify({version:1,kind:'unknown',entries:{[canonical]:{value}}}));
 expect(()=>historicalLiteralValue(canonical,{...descriptor,catalogSha256:hash(unknown),catalogBytes:unknown.length},unknown)).toThrow('Historical literal value mismatch');
});
