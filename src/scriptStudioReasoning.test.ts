import {it,expect} from 'vitest';
import {scriptStudioReasoningOptions,validateScriptStudioReasoning} from './scriptStudioReasoning';
it('offers only the native effort levels for each registered model',()=>{
 expect(scriptStudioReasoningOptions('openai','gpt-5.6-luna')).toEqual(['none','low','medium','high','xhigh','max']);
 for(const model of ['deepseek-flash','deepseek-v4-pro'])expect(scriptStudioReasoningOptions('deepseek',model)).toEqual(['none','low','high','max']);
 expect(scriptStudioReasoningOptions('other','unknown')).toEqual([]);
});
it('rejects unsupported settings without silently changing the requested strength',()=>{
 expect(()=>validateScriptStudioReasoning('deepseek','deepseek-flash','medium')).toThrow(/推理强度/);
 expect(()=>validateScriptStudioReasoning('openai','gpt-5.6-luna','max')).not.toThrow();
 expect(()=>validateScriptStudioReasoning('openai','gpt-5.6-luna',null)).toThrow(/推理强度/);
});

it('adapts every public GPT-5.6 and GPT-6.1 variant without offering unsupported none',()=>{
 for(const model of ['gpt-5.6','gpt-5.6-sol','gpt-5.6-terra','gpt-5.6-luna','gpt-6.1-terra'])expect(scriptStudioReasoningOptions('openai',model)).toEqual(['none','low','medium','high','xhigh','max']);
 expect(scriptStudioReasoningOptions('openai','gpt-6.1-sol')).toEqual(['low','medium','high','xhigh','max']);
 expect(()=>validateScriptStudioReasoning('openai','gpt-6.1-sol','none')).toThrow();expect(scriptStudioReasoningOptions('openai','gpt-6.1-invented')).toEqual([]);
});
