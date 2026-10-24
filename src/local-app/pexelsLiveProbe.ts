import {request} from 'node:https';
import type {ConnectionProbe,ProbeOutcome} from './connectionPorts.js';

export interface PexelsProbeEvent {code:'unsupported'|'network_blocked'|'response'|'transport_error';outcome:ProbeOutcome;status?:number;bytes?:number;videoId?:number}
interface Options {
 // Deployment policy must durably reserve the request BEFORE any network I/O.
 reserveRequest:()=>boolean;
 record?:(event:PexelsProbeEvent)=>void;
}
const url='https://api.pexels.com/v1/videos/search?query=nature&per_page=1';
const maxBytes=256*1024;
function videoId(body:Buffer):number|undefined{
 try{
  const value=JSON.parse(body.toString('utf8'));
  if(!value||value.page!==1||value.per_page!==1||!Array.isArray(value.videos)||value.videos.length!==1)return;
  const v=value.videos[0];
  if(Number.isSafeInteger(v?.id)&&v.id>0&&Number.isFinite(v.duration)&&v.duration>0&&Array.isArray(v.video_files)&&v.video_files.some((f:unknown)=>!!f&&typeof f==='object'&&'file_type'in f&&f.file_type==='video/mp4'))return v.id;
 }catch{/* Provider text is never used as a diagnostic channel. */}
}
export function createPexelsLiveProbe(options:Options):ConnectionProbe{
 return {mode:'live',async verify(input){
  const finish=(event:PexelsProbeEvent)=>{options.record?.(event);return event.outcome;};
  if(input.provider!=='pexels'||input.adapter!=='pexels_video'||input.endpoint!=='https://api.pexels.com'||!input.secret)return finish({code:'unsupported',outcome:'retryable'});
  if(!options.reserveRequest())return finish({code:'network_blocked',outcome:'retryable'});
  return new Promise<ProbeOutcome>(resolve=>{
   let settled=false,bytes=0;
   const done=(event:PexelsProbeEvent)=>{if(settled)return;settled=true;clearTimeout(timer);resolve(finish(event));};
   const timer=setTimeout(()=>{req?.destroy();done({code:'transport_error',outcome:'retryable'});},5000);
   let req:ReturnType<typeof request>|undefined;
   try{
    req=request(url,{method:'GET',agent:false,headers:{Authorization:input.secret,Accept:'application/json'}},response=>{
     const chunks:Buffer[]=[];
     response.on('data',(chunk:Buffer)=>{bytes+=chunk.length;if(bytes>maxBytes){req?.destroy();done({code:'transport_error',outcome:'retryable'});}else chunks.push(chunk);});
     response.once('error',()=>done({code:'transport_error',outcome:'retryable'}));
     response.once('end',()=>{
      const status=response.statusCode??0;
      const id=status===200&&String(response.headers['content-type']).includes('application/json')?videoId(Buffer.concat(chunks)):undefined;
      done({code:'response',status,bytes,outcome:status===401?'invalid':id?'verified':'retryable',...(id?{videoId:id}:{})});
     });
    });
    req.once('error',()=>done({code:'transport_error',outcome:'retryable'}));req.end();
   }catch{done({code:'transport_error',outcome:'retryable'});}
  });
 }};
}
