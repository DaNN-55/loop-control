export interface ManualNarrationEntry {
 materialId:string;text:string;name?:string;status:'pending'|'running'|'failed'|'succeeded';stage:'save'|'confirm';data?:Record<string,unknown>;audioTrackId?:string;error?:string;
}
/** Page-local metadata and frozen commands only; imported File objects stay with the upload owner. */
export function createManualNarrationSession(){
 let version=0;const listeners=new Set<()=>void>();
 return {running:false,rows:[] as ManualNarrationEntry[],readVersion:()=>version,
  subscribe(listener:()=>void){listeners.add(listener);return()=>{listeners.delete(listener);};},
  changed(){version++;for(const listener of listeners)listener();},
 };
}
const sessions=new Map<string,ReturnType<typeof createManualNarrationSession>>();
export function manualNarrationSession(key:string){
 let session=sessions.get(key);
 if(!session){session=createManualNarrationSession();sessions.set(key,session);}
 return session;
}
