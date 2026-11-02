/** This is a local output-publication outcome, distinct from Provider submission. */
export class NativePublicationUnknownError extends Error {
 static readonly code='native_output_publication_unknown';
 constructor(message='产物发布结果待核对，已保留本次尝试；不会自动重发。',options?:ErrorOptions){super(message,options);this.name='NativePublicationUnknownError';}
}
export function isNativePublicationUnknownMessage(output:string,task:{task_id:string;attempt:number}){
 try{const value=JSON.parse(output.trim().split('\n').at(-1)!);return value.code===NativePublicationUnknownError.code&&value.taskId===task.task_id&&value.attempt===task.attempt;}catch{return false;}
}
