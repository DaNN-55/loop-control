import {randomUUID} from 'node:crypto';
import type {IncomingMessage,ServerResponse} from 'node:http';

export interface RuntimeRequestLogEvent{
 timestamp:string;level:'INFO'|'WARN'|'ERROR';source:string;message:string;requestId:string;operationId:string;phase:'started'|'responded'|'interrupted';method:string;route:string;episodeId?:string;httpStatus?:number;durationMs:number;errorCode?:string;errorName?:string;stackFrames?:string;
}
const endpoints=new Set(['login','logout','password','session','storyboard-planning','preferences','notification-events','logs','log-storage','media-root','secrets','connections','connection-models','connection-billing','system-status','episodes','artifacts','accounts','configuration','commands','deletion-cleanups','search','preflight','automation']);
const diagnosticCodes=new Set(['ECONNRESET','ECONNREFUSED','ETIMEDOUT','ENOTFOUND','EPIPE','ENOSPC','EACCES','EPERM','ENOENT','EIO','ABORT_ERR','ERR_STREAM_PREMATURE_CLOSE','UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT','UND_ERR_BODY_TIMEOUT','UND_ERR_SOCKET','23505','23503','23514','42501','P0002','08000','08003','08006','08001','08004','08007','08P01','53300','53400','57P01','57P02','57P03','58000','58030','40001','40P01','57014','XX000']);
const actions=new Set(['workspace','project','legacy-project','delivery','download','detail','reveal','cleanup','restore','status','commands','file']);
const uuid=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
function requestContext(request:IncomingMessage){
 const segments=(request.url??'').split('?')[0].split('/').filter(Boolean),endpoint=segments[2];
 const known=segments[0]==='api'&&segments[1]==='local'&&endpoints.has(endpoint);
 const route=known?'/api/local/'+segments.slice(2,8).map((segment,index)=>index===0?segment:uuid.test(segment)?':id':actions.has(segment)?segment:':value').join('/'):'/api/local/:unknown';
 return{route,episodeId:known&&endpoint==='episodes'&&uuid.test(segments[3]??'')?segments[3]:undefined};
}
/** No request/response payload, query, header, credential or arbitrary error message
 * crosses this boundary. A finished HTTP response is not a production receipt. */
export function observeLocalRequest(request:IncomingMessage,response:ServerResponse,write?:((event:RuntimeRequestLogEvent)=>void)){
 const requestId=randomUUID(),started=performance.now(),method=request.method??'UNKNOWN',context=requestContext(request);
 let tracked=false,reported=false,errorFields:Partial<RuntimeRequestLogEvent>={};
 response.setHeader('X-Request-Id',requestId);
 function emit(phase:RuntimeRequestLogEvent['phase'],httpStatus?:number){
  if(!write)return;
  const level=phase==='interrupted'||httpStatus!==undefined&&httpStatus>=500?'ERROR':httpStatus!==undefined&&httpStatus>=400?'WARN':'INFO';
  const status=phase==='started'?'请求开始':phase==='interrupted'?'响应连接提前关闭，客户端是否收到结果未确认':'请求已返回响应';
  const event:RuntimeRequestLogEvent={timestamp:new Date().toISOString(),level,source:'本机接口',message:`${method} ${context.route} · ${status}${httpStatus===undefined?'':`（HTTP ${httpStatus}）`}`,requestId,operationId:requestId,phase,method,...context,durationMs:Math.round(performance.now()-started),...(httpStatus===undefined?{}:{httpStatus}),...errorFields};
  try{write(event);}catch{/* Observability must not turn a committed write into a failed response. */}
 }
 response.once('finish',()=>{if(tracked&&!reported){reported=true;emit('responded',response.statusCode);}});
 response.once('close',()=>{if(tracked&&!reported){reported=true;emit('interrupted',response.headersSent?response.statusCode:undefined);}});
 return{
  start(){if(!tracked){tracked=true;emit('started');}},
  fail(error:unknown){
   tracked=true;
   const value=error as {code?:unknown;name?:unknown;stack?:unknown};
   const code=typeof value?.code==='string'&&diagnosticCodes.has(value.code)?value.code:undefined;
   const name=typeof value?.name==='string'&&/^(?:Error|TypeError|SyntaxError|RangeError|AbortError|TimeoutError|ConfigurationError|SecretStoreError)$/.test(value.name)?value.name:'Error';
   // Keep callable names only. Error text and filesystem locations can contain
   // credentials, user content or private paths and are deliberately excluded.
   const frames=typeof value?.stack==='string'?value.stack.split('\n').slice(1,9).flatMap(line=>{const match=/^\s+at (?:async )?([A-Za-z_$][\w.$<>]*)\s+\(/.exec(line);return match?[`at ${match[1]}`]:[];}).join('\n'):'';
   errorFields={errorName:name,...(code?{errorCode:code}:{}),...(frames?{stackFrames:frames}:{})};
  },
 };
}
