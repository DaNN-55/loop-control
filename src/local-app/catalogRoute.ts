import type {IncomingMessage,ServerResponse} from 'node:http';
import type {LocalCatalog} from './catalog.js';
export interface CatalogOptions {
 origin:string;
 authenticate:(request:IncomingMessage)=>Promise<string|null>;
 catalog:(ownerId:string)=>Promise<LocalCatalog>;
}
export function createCatalogHandler(options:CatalogOptions){
 return async(request:IncomingMessage,response:ServerResponse)=>{
  response.setHeader('Cache-Control','no-store');
  response.setHeader('X-Content-Type-Options','nosniff');
  const send=(status:number,payload:unknown)=>{response.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});response.end(JSON.stringify(payload));};
  if(request.headers.origin && request.headers.origin!==options.origin){send(403,{error:'来源不匹配。'});return;}
  if(request.headers['sec-fetch-site']==='cross-site'){send(403,{error:'拒绝跨站请求。'});return;}
  if(request.url!=='/api/local/catalog'){send(404,{error:'本地路径尚未迁移。'});return;}
  if(request.method!=='GET'){send(405,{error:'本地目录只支持读取。'});return;}
  try{
   const owner=await options.authenticate(request);
   if(!owner){send(401,{error:'请先登录所有者。'});return;}
   send(200,await options.catalog(owner));
  }catch{send(503,{error:'本地目录暂不可用，请检查本机服务。'});}
 };
}
