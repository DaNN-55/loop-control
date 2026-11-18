import type {ScriptStudioChatMode,ScriptStudioMode,ScriptStudioOptions} from './scriptStudio.js';
/** Historical wire values are read here only; new model requests and manual receipts never use them. */
export const isRetiredScriptStudioMode=(mode:unknown)=>mode==='adapt';
export const legacyScriptStudioChatInitial={instruction:'',mode:'adjust',adapt:''};
export function scriptStudioReceiptMode(mode:unknown):ScriptStudioMode|ScriptStudioChatMode{
 return isRetiredScriptStudioMode(mode)||mode==='revision'?'revision':mode==='discuss'?'discuss':'optimize';
}
export function scriptStudioReceiptOptions(data:{targetDuration:number|null;mode:unknown;instruction?:string}):ScriptStudioOptions{
 return{targetDuration:data.targetDuration,mode:scriptStudioReceiptMode(data.mode)==='revision'?'revision':'optimize',...(data.instruction!==undefined?{instruction:data.instruction}:{})};
}
