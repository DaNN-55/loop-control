/** Public text models with Responses / structured-output contracts verified on 2026-11-18. */
export const openAiLanguageModels=['gpt-5.6-luna','gpt-5.6-terra','gpt-5.6-sol','gpt-5.6','gpt-6.1-sol','gpt-6.1-terra'] as const;
export const deepSeekLanguageModels=['deepseek-flash','deepseek-v4-pro'] as const;
export function supportsLanguageModel(provider:string,model:string){return ((provider==='openai'?openAiLanguageModels:provider==='deepseek'?deepSeekLanguageModels:[]) as readonly string[]).includes(model);}
