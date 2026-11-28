import {createHash,randomBytes,timingSafeEqual} from 'node:crypto';
import {chmod,lstat,open,realpath,unlink} from 'node:fs/promises';
import {createServer,type IncomingMessage,type ServerResponse} from 'node:http';
import {isAbsolute,join,resolve} from 'node:path';
import type {Pool} from 'pg';
import {harnessProductionHost,type HarnessProductionScope} from './harnessProductionPolicy.js';

const uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
export async function startHarnessProductionSocket({directory,ownerId,episodeIds,pool,handler}:{
 directory:string;ownerId:string;episodeIds?:readonly string[];pool:Pool;
 handler:(request:IncomingMessage,response:ServerResponse,scope:HarnessProductionScope)=>Promise<unknown>|unknown;
}){
 if(!uuid.test(ownerId)||episodeIds?.some(id=>!uuid.test(id))||(episodeIds?.length??0)>1000)throw Error('Invalid Harness production Owner or episode scope');
 if(!isAbsolute(directory)||resolve(directory)!==directory||directory==='/'||await realpath(directory)!==directory)throw Error('Harness production requires a dedicated canonical directory');
 const dir=await lstat(directory);
 if(!dir.isDirectory()||dir.uid!==process.getuid?.()||(dir.mode&0o777)!==0o700)throw Error('Harness production directory must be owned by the current user and use permissions 0700');
 const socketPath=join(directory,'production.sock'),tokenPath=join(directory,'production.token');
 if(Buffer.byteLength(socketPath)>103)throw Error('Harness production socket path exceeds the Unix pathname limit');
 const {rows:[owner]}=await pool.query<HarnessProductionScope['owner']>('SELECT id,email FROM local_identity.owners WHERE id=$1',[ownerId]);
 if(!owner)throw Error('Harness production Owner does not exist');
 const scope=Object.freeze({owner:Object.freeze(owner),episodeIds:episodeIds&&Object.freeze([...new Set(episodeIds.map(id=>id.toLowerCase()))])});
 const token=randomBytes(32).toString('hex'),expected=createHash('sha256').update(token).digest();
 const tokenFile=await open(tokenPath,'wx',0o600),created=await tokenFile.stat();
 const removeToken=async()=>{
  const current=await lstat(tokenPath).catch((error:NodeJS.ErrnoException)=>{if(error.code==='ENOENT')return;throw error;});
  if(current?.dev===created.dev&&current.ino===created.ino)await unlink(tokenPath);
 };
 const active=new Set<Promise<unknown>>();
 const send=(response:ServerResponse,status:number,error:string)=>{response.writeHead(status,{'Cache-Control':'no-store','Content-Type':'application/json; charset=utf-8','X-Content-Type-Options':'nosniff','Connection':'close'});response.end(JSON.stringify({error}));};
 const server=createServer({maxHeaderSize:32768,requestTimeout:15000,headersTimeout:10000},(request,response)=>{
  const supplied=/^Bearer ([0-9a-f]{64})$/.exec(request.headers.authorization??'');
  if(!supplied||!timingSafeEqual(createHash('sha256').update(supplied[1]).digest(),expected))return send(response,401,'Harness 本机制作用凭据无效。');
  if(request.headers.host!==harnessProductionHost||request.headers.cookie!==undefined||request.headers.origin!==undefined||request.headers['x-csrf-token']!==undefined||request.headers['sec-fetch-site']!==undefined)return send(response,403,'Harness 本机请求来源不合法。');
  delete request.headers.authorization;
  const task=Promise.resolve().then(()=>handler(request,response,scope));active.add(task);
  void task.catch(()=>{if(!response.headersSent)send(response,503,'Harness 本机制作暂不可用。');else response.destroy();}).finally(()=>active.delete(task));
 });
 server.on('upgrade',(_request,socket)=>socket.destroy());
 server.on('connect',(_request,socket)=>socket.destroy());
 const shutdown=()=>new Promise<void>((done,reject)=>{server.close(error=>error?reject(error):done());});
 try{
  try{await tokenFile.chmod(0o600);await tokenFile.writeFile(token+'\n');await tokenFile.sync();}finally{await tokenFile.close();}
  await new Promise<void>((done,reject)=>{server.once('error',reject);server.listen(socketPath,()=>{server.removeListener('error',reject);done();});});
  await chmod(socketPath,0o600);
 }catch(error){if(server.listening)await shutdown();await removeToken();throw error;}
 let closing:Promise<void>|undefined;
 return{socketPath,tokenPath,close:()=>closing??=(async()=>{
  // Node unlinks the Unix socket it bound on close; it never takes over a stale one.
  const closed=shutdown();server.closeAllConnections();await closed;await Promise.allSettled(active);await removeToken();
 })()};
}
