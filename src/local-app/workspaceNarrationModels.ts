import {registeredAdapters} from '../worker/registeredAdapters';

/** The catalog describes installed adapters; the Episode keeps its frozen executor. */
export function workspaceNarrationModel(configuration:unknown){
 const config=configuration&&typeof configuration==='object'&&!Array.isArray(configuration)?configuration as Record<string,unknown>:null;
 const executor=config?.executor&&typeof config.executor==='object'&&!Array.isArray(config.executor)?config.executor as Record<string,unknown>:null;
 const provider=typeof executor?.provider==='string'?executor.provider:'',adapter=typeof executor?.adapter==='string'?executor.adapter:'',model=typeof executor?.model==='string'?executor.model:'';
 const resolution=registeredAdapters.resolve({capability:'narration_generation',executionPath:config?.execution_path==='external'?'external':config?.execution_path==='manual'?'manual':undefined,provider,adapter,model});
 const choice=resolution.kind==='registered'?resolution.choice:null;
 return{provider,providerLabel:provider==='volcengine_tts'?'火山语音 V3':provider,model,available:!!choice&&!!model&&choice.modelCatalog.includes(model)&&config?.execution_path==='external',models:choice?.modelCatalog??[],voices:choice?.voiceCatalog??{},manual:resolution.kind==='manual',configured:!!config};
}

export const narrationLanguageLabels:Record<string,string>={'zh-CN':'中文（简体）','en-US':'英语','ja-JP':'日语','es-ES':'西班牙语'};
