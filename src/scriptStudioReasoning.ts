import {supportsLanguageModel} from './languageModels.js';
export const scriptStudioReasoningLabels={none:'关闭',low:'低',medium:'中',high:'高',xhigh:'更高',max:'最高'} as const;
export type ScriptStudioReasoningEffort=keyof typeof scriptStudioReasoningLabels;
/** Native Responses API values, not compatibility aliases between different effort levels. */
export function scriptStudioReasoningOptions(provider:string,model:string):ScriptStudioReasoningEffort[]{
 if(!supportsLanguageModel(provider,model))return [];
 if(provider==='openai')return model==='gpt-6.1-sol'?['low','medium','high','xhigh','max']:['none','low','medium','high','xhigh','max'];
 if(provider==='deepseek')return ['none','low','high','max'];
 return [];
}
export function validateScriptStudioReasoning(provider:string,model:string,value:unknown):asserts value is ScriptStudioReasoningEffort{
 if(typeof value!=='string'||!scriptStudioReasoningOptions(provider,model).includes(value as ScriptStudioReasoningEffort))throw Error('当前模型不支持此推理强度。');
}

export function scriptStudioDefaultReasoning(provider:string,model:string):ScriptStudioReasoningEffort{return scriptStudioReasoningOptions(provider,model)[0]??'none';}
