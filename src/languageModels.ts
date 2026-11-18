/** Public text models with Responses / structured-output contracts verified on 2026-11-18. */
export const openAiLanguageModels=['gpt-5.6-luna','gpt-5.6-terra','gpt-5.6-sol','gpt-5.6','gpt-6.1-sol','gpt-6.1-terra'] as const;
export const deepSeekLanguageModels=['deepseek-flash','deepseek-v4-pro'] as const;
export function supportsLanguageModel(provider:string,model:string){return ((provider==='openai'?openAiLanguageModels:provider==='deepseek'?deepSeekLanguageModels:[]) as readonly string[]).includes(model);}

/** Explicit model modality facts from official model/vision pages, checked 2026-11-18. */
const languageModelImageInputs:Readonly<Record<string,readonly string[]>>={
 openai:['gpt-5.6-luna','gpt-5.6-terra','gpt-5.6-sol','gpt-5.6','gpt-6.1-sol','gpt-6.1-terra'],
 deepseek:['deepseek-flash'],
};
export function supportsLanguageModelImages(provider:string,model:string){return languageModelImageInputs[provider]?.includes(model)??false;}

/** PDF inline input_file is enabled only for explicitly verified OpenAI vision models.
 * DeepSeek documents require a separate paid /files parse, which this flow does not invoke.
 * Other documents are bounded extracted text and need only the existing text capability. */
export function supportsLanguageModelAttachment(provider:string,model:string,mime:string){
 if(mime.startsWith('image/'))return supportsLanguageModelImages(provider,model);
 if(mime==='application/pdf')return provider==='openai'&&supportsLanguageModelImages(provider,model);
 return ['text/plain','text/markdown','text/csv','application/json','application/vnd.openxmlformats-officedocument.wordprocessingml.document'].includes(mime)&&supportsLanguageModel(provider,model);
}
