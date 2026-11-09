import type {MediaFetcher} from './mediaProviders.js';

export interface VideoTaskReservation {new:boolean;provider_task_id?:string|null;}
export type VideoGenerationPhase='queued'|'processing'|'saving';
export interface VideoTaskPorts {
 fetcher:MediaFetcher;
 reserve:()=>Promise<VideoTaskReservation>;
 recordSubmission:(taskId:string)=>Promise<void>;
 sleep?:(milliseconds:number)=>Promise<void>;
 maxPolls?:number;
 onProgress?:(phase:VideoGenerationPhase)=>Promise<void>;
}

interface VideoDownloadPolicy {
 validateUrl:(value:string)=>URL;
 invalidResponse:string;
 tooLarge:string;
 empty:string;
 redirectLimit:string;
}

interface VideoTaskProtocol {
 submit:()=>Promise<unknown>;
 query:(taskId:string)=>Promise<{phase:'queued'|'processing'}|{url:string}>;
 pollDelayMs:(attempt:number)=>number;
 download:VideoDownloadPolicy;
 errors:{unknownSubmission:string;invalidSubmittedId:string;invalidSavedId:string;pollLimit:string};
}
const taskIdPattern=/^[a-zA-Z0-9_-]{1,128}$/;

// Callers validate their frozen input and credentials before entering this flow.
// Durable reservation/registration and network authorization remain in the ports.
export async function executeVideoTask(ports:VideoTaskPorts,protocol:VideoTaskProtocol):Promise<Uint8Array>{
 const reservation=await ports.reserve();
 let id=reservation.provider_task_id??'';
 if(!reservation.new&&!id)throw Error(protocol.errors.unknownSubmission);
 if(!id){
  const submitted=await protocol.submit();
  if(typeof submitted!=='string'||!taskIdPattern.test(submitted))throw Error(protocol.errors.invalidSubmittedId);
  id=submitted;
  await ports.recordSubmission(id);
 }
 if(!taskIdPattern.test(id))throw Error(protocol.errors.invalidSavedId);
 const sleep=ports.sleep??((ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms)));
 for(let attempt=0;attempt<(ports.maxPolls??Infinity);attempt++){
  const result=await protocol.query(id);
  if('url' in result){
   await ports.onProgress?.('saving');
   return downloadVideoResult(ports.fetcher,result.url,protocol.download);
  }
  await ports.onProgress?.(result.phase);
  await sleep(protocol.pollDelayMs(attempt));
 }
 throw Error(protocol.errors.pollLimit);
}

// The supplied fetcher retains its own authorization and stricter response policy.
async function downloadVideoResult(fetcher:MediaFetcher,value:string,policy:VideoDownloadPolicy):Promise<Uint8Array>{
 let url=policy.validateUrl(value);
 for(let request=0;request<4;request++){
  // A result request never inherits submission credentials.
  const response=await fetcher(url,{redirect:'manual',signal:AbortSignal.timeout(60_000)});
  if([301,302,303,307,308].includes(response.status)){url=policy.validateUrl(new URL(response.headers.get('location')??'',url).href);continue;}
  const limit=100*1024*1024;
  if(!response.ok||!response.headers.get('content-type')?.toLowerCase().startsWith('video/mp4')||Number(response.headers.get('content-length'))>limit||!response.body)throw Error(policy.invalidResponse);
  const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
  try{
   while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>limit)throw Error(policy.tooLarge);chunks.push(part.value);}
  }finally{await reader.cancel().catch(()=>{});}
  if(!size)throw Error(policy.empty);
  return Uint8Array.from(Buffer.concat(chunks));
 }
 throw Error(policy.redirectLimit);
}
