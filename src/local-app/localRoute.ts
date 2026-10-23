import {timingSafeEqual} from 'node:crypto';
import type {IncomingMessage,ServerResponse} from 'node:http';
import type {Pool} from 'pg';
import {readLocalCatalog} from './catalog.js';
import {lookupSession,readSessionToken,establishSession,revokeSession,cookieHeader,csrfFor} from './sessions.js';
import {readLocalEpisode,findOwnedArtifact} from './episodeReads.js';
import {serveOwnedArtifact} from './artifactRoute.js';
interface LocalOptions {pool:Pool;origin:string;mediaRoot:string}
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
async function readBody(request:IncomingMessage):Promise<Record<string,unknown>>{
 if(request.headers['content-type']?.split(';')[0]!=='application/json')throw Error('JSON required');
 let text='';for await(const chunk of request){text+=chunk;if(Buffer.byteLength(text)>8192)throw Error('Body too large');}
 const parsed:unknown=JSON.parse(text);if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw Error('Object required');return parsed as Record<string,unknown>;
}
export function createLocalHandler(options:LocalOptions){
 const host=new URL(options.origin).host;
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
    response.setHeader('Set-Cookie',cookieHeader(next));send(200,{csrfToken:csrfFor(next)});return;
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
   if(request.method!=='GET'){send(405,{error:'该本地命令尚未开放。'});return;}
   if(url.pathname==='/api/local/session'){send(200,{owner:{id:session.id,email:session.email},csrfToken:csrfFor(session.token)});return;}
   if(url.pathname==='/api/local/catalog'){send(200,await readLocalCatalog(options.pool,session.id));return;}
   const episode=url.pathname.match(/^\/api\/local\/episodes\/([^/]+)$/);
   if(episode&&uuid.test(episode[1])){
    const result=await readLocalEpisode(options.pool,session.id,episode[1]);send(result?200:404,result??{error:'生产单不可见。'});return;
   }
   const artifact=url.pathname.match(/^\/api\/local\/artifacts\/([^/]+)$/);
   if(artifact&&uuid.test(artifact[1])){
    const record=await findOwnedArtifact(options.pool,session.id,artifact[1]);if(!record){send(404,{error:'产物不可见。'});return;}
    try{await serveOwnedArtifact(options.mediaRoot,record,response);}catch{if(response.headersSent)response.destroy();else send(409,{error:'产物路径或指纹校验失败。'});}return;
   }
   send(404,{error:'本地路径尚未迁移。'});
  }catch{if(response.headersSent)response.destroy();else send(503,{error:'本机服务暂不可用，请检查本机状态。'});}
 };
}
