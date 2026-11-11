// @vitest-environment node
import {it,expect} from 'vitest';
import {createWorkspaceGenerationFetcher} from '../../../../src/local-app/providerNetwork';
import {ProviderRequestNotSentError} from '../../../../src/worker/providerOutcome';
it('keeps a definite mark-before-send refusal as not sent, with no transport send',async()=>{
 let sends=0;
 const transport=async()=>{throw new ProviderRequestNotSentError('input_changed');sends++;};
 const send=createWorkspaceGenerationFetcher('openai',{reserve:async()=>{}},transport);
 await expect(send('https://api.openai.com/v1/images/generations',{method:'POST',body:JSON.stringify({model:'gpt-image-2',size:'1024x1536',output_format:'png',prompt:'synthetic'})})).rejects.toMatchObject({name:'ProviderRequestNotSentError'});
 expect(sends).toBe(0);
});
