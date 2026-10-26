import{hashPassword}from'./password.js';
import{tokenHash}from'./sessions.js';
import{readMediaDeployment}from'./mediaDeployment.js';
import {LocalAccountCommands} from './accountCommands.js';
import type{NativeAutomation}from'./nativeAutomation.js';
import{LocalEpisodeLifecycle}from'./episodeLifecycle.js';
import {executeConfiguration,ConfigurationError} from './configurationCommands.js';
import {timingSafeEqual} from 'node:crypto';
import type {IncomingMessage,ServerResponse} from 'node:http';
import type {Pool} from 'pg';
import {readLocalCatalog,parseCatalogQuery} from './catalog.js';
import {lookupSession,readSessionToken,establishSession,revokeSession,cookieHeader,csrfFor} from './sessions.js';
import {readLocalEpisode,findOwnedArtifact,findOwnedInputFile} from './episodeReads.js';
import {serveOwnedArtifact} from './artifactRoute.js';
import {LocalConnections} from './connections.js';
import {SecretStoreError} from './connectionPorts.js';
import type {LocalEpisodeCommands} from './episodeCommands.js';
interface LocalOptions {pool:Pool;origin:string;mediaRoot:string;connections?:LocalConnections;episodes?:LocalEpisodeCommands;automation?:NativeAutomation;accounts?:LocalAccountCommands}
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
async function readBody(request:IncomingMessage,limit=8192):Promise<Record<string,unknown>>{
 if(request.headers['content-type']?.split(';')[0]!=='application/json')throw Error('JSON required');
 let text='';for await(const chunk of request){text+=chunk;if(Buffer.byteLength(text)>limit)throw Error('Body too large');}
 const parsed:unknown=JSON.parse(text);if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw Error('Object required');return parsed as Record<string,unknown>;
}
export function createLocalHandler(options:LocalOptions){
 const host=new URL(options.origin).host;
 const lifecycle=new LocalEpisodeLifecycle(options.pool,options.mediaRoot,id=>options.episodes?.closeStudio(id)??Promise.resolve());
 const connections=options.connections??new LocalConnections(options.pool);
 const accounts=options.accounts??new LocalAccountCommands(options.pool,options.mediaRoot,options.episodes);
 return async(request:IncomingMessage,response:ServerResponse)=>{
  response.setHeader('Cache-Control','no-store');response.setHeader('X-Content-Type-Options','nosniff');
  const send=(status:number,value:unknown)=>{response.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});response.end(JSON.stringify(value));};
  if(request.headers.host!==host||request.headers.origin&&request.headers.origin!==options.origin||request.headers['sec-fetch-site']==='cross-site'){send(403,{error:'本机来源不匹配。'});return;}
  if(request.method!=='GET'&&request.headers.origin!==options.origin){send(403,{error:'变更请求需要精确来源。'});return;}
  try{
   const url=new URL(request.url??'/',options.origin),token=readSessionToken(request);
   if(url.pathname==='/api/local/login'){
    if(request.method!=='POST'){send(405,{error:'需要POST。'});return;}
    let body;try{body=await readBody(request);}catch{send(400,{error:'登录请求格式无效。'});return;}
    if(typeof body.email!=='string'||typeof body.password!=='string'||body.email.length>320||body.password.length>1024){send(400,{error:'登录请求格式无效。'});return;}
    const next=await establishSession(options.pool,body.email.trim(),body.password,token);
    if(!next){send(401,{error:'邮箱或密码无效，或登录暂时锁定。'});return;}
    response.setHeader('Set-Cookie',cookieHeader(next));const owner=await lookupSession(options.pool,next);send(200,{owner:owner?{id:owner.id,email:owner.email}:null,csrfToken:csrfFor(next)});return;
   }
   const session=await lookupSession(options.pool,token);
   if(!session){response.setHeader('Set-Cookie',cookieHeader(''));send(401,{error:'请先登录所有者。'});return;}
   if(request.method!=='GET'){
    const csrf=request.headers['x-csrf-token'];const expected=csrfFor(session.token);
    if(typeof csrf!=='string'||!(/^[0-9a-f]{64}$/).test(csrf)||!timingSafeEqual(Buffer.from(csrf),Buffer.from(expected))){send(403,{error:'CSRF校验失败。'});return;}
   }
   if(url.pathname==='/api/local/logout'&&request.method==='POST'){
    await revokeSession(options.pool,session.token);response.setHeader('Set-Cookie',cookieHeader(''));send(200,{loggedOut:true});return;
   }
   if(url.pathname==='/api/local/password'&&request.method==='POST'){
    let body;try{body=await readBody(request,8192);}catch{send(400,{error:'密码请求格式无效。'});return;}
    if(Object.keys(body).some(k=>k!=='password')||typeof body.password!=='string'||body.password.length<12||body.password.length>1024){send(400,{error:'密码须为12至1024字符。'});return;}
    const digest=await hashPassword(body.password);
    const changed=(await options.pool.query('SELECT local_identity.change_owner_password($1,$2,$3) changed',[session.id,tokenHash(session.token),JSON.stringify(digest)])).rows[0]?.changed;
    if(!changed){send(401,{error:'会话已失效，请重新登录。'});return;}send(200,{changed:true});return;
   }
   if(url.pathname==='/api/local/session'&&request.method==='GET'){send(200,{owner:{id:session.id,email:session.email},csrfToken:csrfFor(session.token)});return;}
   await readMediaDeployment(options.pool,options.mediaRoot);
   if(url.pathname==='/api/local/account-commands'&&request.method==='POST'){
    let body;try{body=await readBody(request,16384);}catch{send(400,{error:'账号本机操作请求格式无效。'});return;}
    const controller=new AbortController(),closed=()=>{if(!response.writableEnded)controller.abort();};response.once('close',closed);
    try{const result=await accounts.execute(session,body,controller.signal);if(!response.destroyed)send(200,result);}catch(error){if(!response.destroyed)throw error;}finally{response.off('close',closed);}return;
   }
   if(url.pathname==='/api/local/configuration'&&request.method==='POST'){
    let body;try{body=await readBody(request,256*1024);}catch{send(400,{error:'配置请求格式无效。'});return;}
    send(200,await executeConfiguration(options.pool,session,body,options.mediaRoot,connections.externalReady?(client,refs)=>connections.assertBlueprintReferences(client,refs):undefined));return;
   }
   if(url.pathname==='/api/local/episode-commands'&&request.method==='POST'){
    if(!options.episodes){send(503,{error:'本地Episode执行服务尚未配置。'});return;}
    let body;try{body=await readBody(request,140*1024*1024);}catch{send(400,{error:'Episode请求格式无效。'});return;}
    send(200,await options.episodes.execute(session,body));return;
   }
   if(url.pathname==='/api/local/episode-lifecycle'&&request.method==='POST'){let body;try{body=await readBody(request,16384);}catch{send(400,{error:'生命周期请求格式无效。'});return;}send(200,await lifecycle.execute(session,body));return;}
   if(url.pathname==='/api/local/deletion-cleanups'&&request.method==='GET'){send(200,await lifecycle.pending(session));return;}
   if(url.pathname==='/api/local/connections'){
    if(request.method==='GET'){send(200,await connections.read(session.id));return;}
    if(request.method==='POST'){
     let body;try{body=await readBody(request,32768);}catch{send(400,{error:'连接请求格式无效。'});return;}
     send(200,await connections.command(session,body));return;
    }
   }
   if(request.method!=='GET'){send(405,{error:'该本地命令尚未开放。'});return;}
   if(url.pathname==='/api/local/system-status'){if(!options.automation){send(503,{error:'本地自动化服务尚未配置。'});return;}send(200,await options.automation.status());return;}
   if(url.pathname==='/api/local/catalog'){send(200,await readLocalCatalog(options.pool,session.id,parseCatalogQuery(url.searchParams)));return;}
   if(url.pathname==='/_local-artifact'){
    const id=url.searchParams.get('episode')??'',path=url.searchParams.get('path')??'',hash=url.searchParams.get('sha256');
    if(!uuid.test(id)){send(400,{error:'产物引用无效。'});return;}
    const file=await findOwnedInputFile(options.pool,session.id,id,path);if(!file){send(404,{error:'产物不可见。'});return;}
    if(hash&&hash!==file.sha256){send(409,{error:'产物指纹已变化。'});return;}
    try{await serveOwnedArtifact(options.mediaRoot,file,response,request.headers.range);}catch{if(response.headersSent)response.destroy();else send(409,{error:'产物路径或指纹校验失败。'});}return;
   }
   const episode=url.pathname.match(/^\/api\/local\/episodes\/([^/]+)$/);
   if(episode&&uuid.test(episode[1])){
    let known:Record<string,string>={};try{const value=JSON.parse(url.searchParams.get('known')??'{}');if(!value||Array.isArray(value)||Object.values(value).some(v=>typeof v!=='string'))throw Error();known=value;}catch{send(400,{error:'读取版本无效。'});return;}
    const result=await readLocalEpisode(options.pool,session.id,episode[1],known,options.mediaRoot);send(result?200:404,result??{error:'生产单不可见。'});return;
   }
   const artifact=url.pathname.match(/^\/api\/local\/artifacts\/([^/]+)$/);
   if(artifact&&uuid.test(artifact[1])){
    const record=await findOwnedArtifact(options.pool,session.id,artifact[1]);if(!record){send(404,{error:'产物不可见。'});return;}
    try{await serveOwnedArtifact(options.mediaRoot,record,response,request.headers.range);}catch{if(response.headersSent)response.destroy();else send(409,{error:'产物路径或指纹校验失败。'});}return;
   }
   send(404,{error:'本地路径尚未迁移。'});
  }catch(error){if(error instanceof ConfigurationError){send(error.status,{error:error.message,...(error.preflight?{preflight:error.preflight}:{})});return;}
   if(error instanceof SecretStoreError){send(error.code==='conflict'?409:503,{error:error.code==='conflict'?'旧秘密引用不能覆盖；请显式创建新版本。':'秘密存储或验证未就绪；请检查授权、绑定和本机状态。'});return;}
   if((error as {status?:number})?.status===401){send(401,{error:'会话已失效。'});return;}
   if((error as {code?:string})?.code==='P0002'){send(404,{error:'连接或版本不可见。'});return;}
   const code=(error as {code?:string})?.code;if(code==='42501'){send(403,{error:'所有者权限不足。'});return;}if(code==='23505'||code==='23503'){send(409,{error:'配置冲突或仍被引用。'});return;}if(code==='23514'||code?.startsWith('22')){send(400,{error:'配置校验未通过。'});return;}
   if(response.headersSent)response.destroy();else send(503,{error:'本机服务暂不可用，请检查本机状态。'});}
 };
}
