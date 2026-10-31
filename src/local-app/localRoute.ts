import {LocalMediaRootSettings} from './mediaRootSettings.js';
import {readWorkspacePlanningSelection} from './planningSelectionStore.js';
import {readProductionWorkspace,readWorkspaceVersion} from './productionWorkspaceCommands.js';
import {readLegacyStudioProject} from './legacyStudioProject.js';
import {resolveEpisodeAssetRoot} from './accountAssetRoots.js';
import{ownerTransaction}from'./ownerTransaction.js';
import {readWorkspaceSearch} from './workspaceSearch.js';
import {readOwnerPreferences,saveOwnerPreferences,readOwnerNotificationEvents} from './ownerPreferences.js';
import {ScriptProductionStore} from './scriptProductionStore.js';
import{readHistory,historyFile,manageHistory}from'./history.js';
import{readHistoryEpisodes,manageHistoryEpisode}from'./historyEpisodes.js';
import{verifyNativeFile}from'./localFiles.js';
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
import type {SecretAdministration,SecretOperation} from './secretAdministration.js';
import type {RuntimeStatus} from '../observability/runtimeStatus.js';
interface LocalOptions {mediaRootSettings?:LocalMediaRootSettings;pool:Pool;origin:string;mediaRoot:string;historyRoot?:string;secrets?:SecretAdministration;connections?:LocalConnections;episodes?:LocalEpisodeCommands;automation?:NativeAutomation;accounts?:LocalAccountCommands;runtimeStatus?:(ownerId:string,page:number)=>Promise<RuntimeStatus>}
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
async function readBody(request:IncomingMessage,limit=8192):Promise<Record<string,unknown>>{
 if(request.headers['content-type']?.split(';')[0]!=='application/json')throw Error('JSON required');
 let text='';for await(const chunk of request){text+=chunk;if(Buffer.byteLength(text)>limit)throw Error('Body too large');}
 const parsed:unknown=JSON.parse(text);if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw Error('Object required');return parsed as Record<string,unknown>;
}
export function createLocalHandler(options:LocalOptions){
 const host=new URL(options.origin).host;
 const mediaRootSettings=options.mediaRootSettings??new LocalMediaRootSettings(options.pool,options.mediaRoot);
 const lifecycle=new LocalEpisodeLifecycle(options.pool,options.mediaRoot,id=>options.episodes?.closeStudio(id)??Promise.resolve(),options.historyRoot);
 const connections=options.connections??new LocalConnections(options.pool);
 const accounts=options.accounts??new LocalAccountCommands(options.pool,options.mediaRoot,options.episodes);
 return async(request:IncomingMessage,response:ServerResponse)=>{
  response.setHeader('Cache-Control','no-store');response.setHeader('X-Content-Type-Options','nosniff');
  const send=(status:number,value:unknown)=>{response.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});response.end(JSON.stringify(value));};
  try{
   const url=new URL(request.url??'/',options.origin),token=readSessionToken(request);
   const secretPath=url.pathname==='/api/local/secrets'||url.pathname.startsWith('/api/local/secrets/');
   const secretOperation:SecretOperation=url.pathname.endsWith('/detail')?'detail':url.pathname.endsWith('/reveal')?'view':'list';
   const reject=async(actor:string|null,reason:string)=>{if(secretPath&&options.secrets)await options.secrets.rejected(actor,secretOperation,reason);};
   if(secretPath){response.setHeader('Cache-Control','no-store, max-age=0');response.setHeader('Pragma','no-cache');response.setHeader('Expires','0');response.setHeader('Referrer-Policy','no-referrer');}
   if(request.headers.host!==host||request.headers.origin&&request.headers.origin!==options.origin||request.headers['sec-fetch-site']==='cross-site'){await reject(null,'invalid_origin');send(403,{error:'本机来源不匹配。'});return;}
   if(request.method!=='GET'&&request.headers.origin!==options.origin){await reject(null,'invalid_origin');send(403,{error:'变更请求需要精确来源。'});return;}
   if(url.pathname==='/api/local/login'){
    if(request.method!=='POST'){send(405,{error:'需要POST。'});return;}
    let body;try{body=await readBody(request);}catch{send(400,{error:'登录请求格式无效。'});return;}
    if(typeof body.email!=='string'||typeof body.password!=='string'||body.email.length>320||body.password.length>1024){send(400,{error:'登录请求格式无效。'});return;}
    const next=await establishSession(options.pool,body.email.trim(),body.password,token);
    if(!next){send(401,{error:'邮箱或密码无效，或登录暂时锁定。'});return;}
    response.setHeader('Set-Cookie',cookieHeader(next));const owner=await lookupSession(options.pool,next);send(200,{owner:owner?{id:owner.id,email:owner.email}:null,secretAdministration:!!owner&&!!options.secrets?.allowed(owner),csrfToken:csrfFor(next)});return;
   }
   const session=await lookupSession(options.pool,token);
   if(!session){await reject(null,'unauthenticated');response.setHeader('Set-Cookie',cookieHeader(''));send(401,{error:'请先登录所有者。'});return;}
   if(request.method!=='GET'){
    const csrf=request.headers['x-csrf-token'];const expected=csrfFor(session.token);
    if(typeof csrf!=='string'||!(/^[0-9a-f]{64}$/).test(csrf)||!timingSafeEqual(Buffer.from(csrf),Buffer.from(expected))){await reject(session.id,'invalid_csrf');send(403,{error:'CSRF校验失败。'});return;}
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
   if(url.pathname==='/api/local/session'&&request.method==='GET'){send(200,{owner:{id:session.id,email:session.email},secretAdministration:!!options.secrets?.allowed(session),csrfToken:csrfFor(session.token)});return;}
   if(url.pathname==='/api/local/preferences'){
    if(request.method==='GET'){send(200,await readOwnerPreferences(options.pool,session.id));return;}
    if(request.method!=='POST'){send(405,{error:'偏好请求方法无效。'});return;}
    let body;try{body=await readBody(request,96*1024);if(body.command!=='update'||Object.keys(body).some(key=>!['command','data','idempotencyKey'].includes(key)))throw Error();}catch{send(400,{error:'偏好请求格式无效。'});return;}
    send(200,await saveOwnerPreferences(options.pool,session,body.data));return;
   }
   if(url.pathname==='/api/local/notification-events'&&request.method==='GET'){send(200,await readOwnerNotificationEvents(options.pool,session.id));return;}
   if(secretPath){
    const service=options.secrets;
    if(!service){send(403,{error:'密钥管理未启用。'});return;}
    if(!service.allowed(session)){await reject(session.id,'not_administrator');send(403,{error:'仅指定管理员可访问密钥管理。'});return;}
    let result;
    if(url.pathname==='/api/local/secrets'&&request.method==='GET')result=await service.list(session,url.searchParams);
    else if(url.pathname==='/api/local/secrets/detail'&&request.method==='GET'&&[...url.searchParams.keys()].every(k=>k==='reference')&&url.searchParams.getAll('reference').length===1)result=await service.detail(session,url.searchParams.get('reference')??'');
    else if(url.pathname==='/api/local/secrets/reveal'&&request.method==='POST'&&!url.search){
     let body;try{body=await readBody(request,8192);}catch{await reject(session.id,'invalid_request');send(400,{error:'密钥请求格式无效。'});return;}
     result=await service.reveal(session,body);
    }else{await reject(session.id,'invalid_request');send(405,{error:'密钥请求路径或方法无效。'});return;}
    send(result.status,result.body);return;
   }
   if(url.pathname==='/api/local/media-root'){
    if(request.method==='GET'){send(200,await mediaRootSettings.read(session));return;}
    if(request.method!=='POST'){send(405,{error:'本机存储请求方法无效。'});return;}
    let body;try{body=await readBody(request);}catch{send(400,{error:'本机存储请求格式无效。'});return;}
    send(200,await mediaRootSettings.execute(session,body));return;
   }
   await readMediaDeployment(options.pool,options.mediaRoot);
   if(url.pathname==='/api/local/account-commands'&&request.method==='POST'){
    let body;try{body=await readBody(request,16384);}catch{send(400,{error:'账号本机操作请求格式无效。'});return;}
    const controller=new AbortController(),closed=()=>{if(!response.writableEnded)controller.abort();};response.once('close',closed);
    try{const result=await accounts.execute(session,body,controller.signal);if(!response.destroyed)send(200,result);}catch(error){if(!response.destroyed)throw error;}finally{response.off('close',closed);}return;
   }
   if(url.pathname==='/api/local/configuration'&&request.method==='POST'){
    let body;try{body=await readBody(request,256*1024);}catch{send(400,{error:'配置请求格式无效。'});return;}
    send(200,await executeConfiguration(options.pool,session,body,options.mediaRoot,connections.configurationReady?(client,refs)=>connections.assertBlueprintReferences(client,refs,{purpose:'save'}):undefined));return;
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
   if(url.pathname==='/api/local/history-management'){
    if(request.method!=='POST'||url.search){send(405,{error:'历史资料操作需要 POST。'});return;}
    let body;try{body=await readBody(request,4096);}catch{send(400,{error:'历史资料操作格式无效。'});return;}
    send(200,await manageHistory(options.pool,session,body));return;
   }
   if(url.pathname==='/api/local/history-episode-management'){
    if(request.method!=='POST'||url.search){send(405,{error:'历史生产单操作需要 POST。'});return;}
    let body;try{body=await readBody(request,4096);}catch{send(400,{error:'历史生产单操作格式无效。'});return;}send(200,await manageHistoryEpisode(options.pool,session,body));return;
   }
   if(request.method!=='GET'){send(405,{error:'该本地命令尚未开放。'});return;}
   if(url.pathname==='/api/local/workspace-search'){send(200,await readWorkspaceSearch(options.pool,session.id,url.searchParams));return;}
   if(url.pathname==='/api/local/history-episodes'){send(200,await readHistoryEpisodes(options.pool,session.id,url.searchParams));return;}
   if(url.pathname==='/api/local/history'){
    if(request.method!=='GET'){send(405,{error:'历史资料查询需要 GET。'});return;}
    send(200,await readHistory(options.pool,session.id,url.searchParams));return;
   }
   if(url.pathname==='/api/local/history-file'){
    if(!options.historyRoot)throw new ConfigurationError(503,'历史文件库尚未配置。');
    const sha=url.searchParams.get('sha')??'',file=await historyFile(options.pool,session.id,sha),bytes=await verifyNativeFile(options.historyRoot,file.sha256,file.sha256,file.bytes);
    response.writeHead(200,{'Content-Type':'application/octet-stream','Content-Length':bytes.length,'Content-Disposition':`attachment; filename="history-${sha}.bin"`});response.end(bytes);return;
   }
   if(url.pathname==='/api/local/wan-budget'){const id=url.searchParams.get('episode')??'';if(!uuid.test(id)){send(400,{error:'生产单标识无效。'});return;}const value=await ownerTransaction(options.pool,session.id,true,async c=>{const e=(await c.query('SELECT account_id FROM public.episodes WHERE id=$1',[id])).rows[0];if(!e)return null;return{budget:(await c.query('SELECT * FROM public.generation_account_budgets WHERE account_id=$1',[e.account_id])).rows[0]??null,usedCents:Number((await c.query('SELECT coalesce(sum(reserved_cents),0) used FROM public.paid_generation_reservations WHERE account_id=$1',[e.account_id])).rows[0].used)};});send(value?200:404,value??{error:'生产单不可见。'});return;}
   if(url.pathname==='/api/local/system-status'){
    const raw=url.searchParams.get('queuePage')??'1';
    if(!/^[1-9]\d{0,5}$/.test(raw)||[...url.searchParams.keys()].some(k=>k!=='queuePage')||url.searchParams.getAll('queuePage').length>1){send(400,{error:'任务队列页码无效。'});return;}
    const [maintenance,runtime]=await Promise.all([options.automation?.status().catch(()=>null),options.runtimeStatus?.(session.id,Number(raw))]);
    if(!maintenance&&!runtime){send(503,{error:'系统状态暂不可用，请稍后重试。'});return;}
    send(200,{...maintenance,observedAt:runtime?.observedAt??maintenance?.observedAt,runtime:runtime??null,maintenanceAvailable:!!maintenance});return;
   }
   if(url.pathname==='/api/local/catalog'){send(200,await readLocalCatalog(options.pool,session.id,parseCatalogQuery(url.searchParams)));return;}
   if(url.pathname==='/api/local/script-production'){
    const id=url.searchParams.get('episode')??'';
    if(!uuid.test(id)||[...url.searchParams.keys()].some(k=>k!=='episode')){send(400,{error:'生产单引用无效。'});return;}
    send(200,await ownerTransaction(options.pool,session.id,true,c=>new ScriptProductionStore(options.mediaRoot).read(c,id)));return;
   }
   if(url.pathname==='/_local-artifact'){
    const id=url.searchParams.get('episode')??'',path=url.searchParams.get('path')??'',hash=url.searchParams.get('sha256');
    if(!uuid.test(id)){send(400,{error:'产物引用无效。'});return;}
    const file=await findOwnedInputFile(options.pool,session.id,id,path,options.mediaRoot);if(!file){send(404,{error:'产物不可见。'});return;}
    if(hash&&hash!==file.sha256){send(409,{error:'产物指纹已变化。'});return;}
    try{await serveOwnedArtifact(options.mediaRoot,file,response,request.headers.range);}catch{if(response.headersSent)response.destroy();else send(409,{error:'产物路径或指纹校验失败。'});}return;
   }
   const legacyProject=url.pathname.match(/^\/api\/local\/episodes\/([^/]+)\/legacy-project$/);
   if(legacyProject&&uuid.test(legacyProject[1])&&request.method==='GET'){
    const download=url.searchParams.get('download');
    if([...url.searchParams.keys()].some(k=>k!=='download')||download!==null&&(!/^[a-f0-9]{64}$/.test(download)||url.searchParams.getAll('download').length!==1))throw new ConfigurationError(400,'工程版本指纹无效。');
    const value=await ownerTransaction(options.pool,session.id,true,async c=>{
     const e=(await c.query("SELECT e.id,b.policy FROM public.episodes e JOIN public.account_memberships m ON m.account_id=e.account_id JOIN public.account_blueprint_versions b ON b.id=e.blueprint_version_id WHERE e.id=$1 AND m.user_id=$2 AND m.role='owner'",[legacyProject[1],session.id])).rows[0];
     if(!e)throw new ConfigurationError(404,'生产单不可见。');
     return readLegacyStudioProject(c,await resolveEpisodeAssetRoot(c,options.mediaRoot,e.id),e.id);
    });
    if(download){if(!value||download!==value.sha256)throw new ConfigurationError(409,'已有工程已变化，请重新读取后下载。');response.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Content-Disposition':`attachment; filename="${legacyProject[1]}-saved-project.json"`});response.end(value.document);}
    else send(200,value?{project:value.project,sha256:value.sha256}:{project:null});
    return;
   }
   const workspace=url.pathname.match(/^\/api\/local\/episodes\/([^/]+)\/workspace(?:\/project)?$/);
   if(workspace&&uuid.test(workspace[1])&&request.method==='GET'){
    if(url.pathname.endsWith('/project')&&(!/^[a-f0-9]{64}$/.test(url.searchParams.get('sha')??'')||url.searchParams.getAll('sha').length!==1))throw new ConfigurationError(400,'工程版本指纹无效。');
    const value=await ownerTransaction(options.pool,session.id,true,async c=>{const e=(await c.query('SELECT e.id,b.policy FROM public.episodes e JOIN public.account_memberships m ON m.account_id=e.account_id JOIN public.account_blueprint_versions b ON b.id=e.blueprint_version_id WHERE e.id=$1 AND m.user_id=$2 AND m.role=\'owner\'',[workspace[1],session.id])).rows[0];if(!e)throw new ConfigurationError(404,'生产单不可见。');const root=await resolveEpisodeAssetRoot(c,options.mediaRoot,e.id);return url.pathname.endsWith('/project')?readWorkspaceVersion(c,root,e.id,url.searchParams.get('sha')??''):{workspace:await readProductionWorkspace(c,e.id,root),planningSelection:await readWorkspacePlanningSelection(c,e.id)};});send(200,url.pathname.endsWith('/project')?{project:value}:value);return;
   }
   const episode=url.pathname.match(/^\/api\/local\/episodes\/([^/]+)$/);
   if(episode&&uuid.test(episode[1])){
    let known:Record<string,string>={};try{const value=JSON.parse(url.searchParams.get('known')??'{}');if(!value||Array.isArray(value)||Object.values(value).some(v=>typeof v!=='string'))throw Error();known=value;}catch{send(400,{error:'读取版本无效。'});return;}
    const result=await readLocalEpisode(options.pool,session.id,episode[1],known,options.mediaRoot);send(result?200:404,result??{error:'生产单不可见。'});return;
   }
   const artifact=url.pathname.match(/^\/api\/local\/artifacts\/([^/]+)$/);
   if(artifact&&uuid.test(artifact[1])){
    const record=await findOwnedArtifact(options.pool,session.id,artifact[1],options.mediaRoot);if(!record){send(404,{error:'产物不可见。'});return;}
    try{await serveOwnedArtifact(options.mediaRoot,record,response,request.headers.range);}catch{if(response.headersSent)response.destroy();else send(409,{error:'产物路径或指纹校验失败。'});}return;
   }
   send(404,{error:'本地路径尚未迁移。'});
  }catch(error){if(error instanceof ConfigurationError){send(error.status,{error:error.message,...(error.preflight?{preflight:error.preflight}:{})});return;}
   if(error instanceof SecretStoreError){send(error.code==='conflict'?409:503,{error:error.code==='conflict'?'旧密钥引用不能覆盖；请显式创建新版本。':error.code==='denied'?'本机 Keychain 已锁定或拒绝访问；请运行 npm start 解锁后重试。此次操作未确认完成。':'密钥存储或验证未就绪；请检查授权、绑定和本机状态。'});return;}
   if((error as {status?:number})?.status===401){send(401,{error:'会话已失效。'});return;}
   if((error as {code?:string})?.code==='P0002'){send(404,{error:'连接或版本不可见。'});return;}
   const code=(error as {code?:string})?.code;if(code==='42501'){send(403,{error:'所有者权限不足。'});return;}if(code==='23505'||code==='23503'){send(409,{error:'配置冲突或仍被引用。'});return;}if(code==='23514'||code?.startsWith('22')){send(400,{error:'配置校验未通过。'});return;}
   if(response.headersSent)response.destroy();else send(503,{error:'本机服务暂不可用，请检查本机状态。'});}
 };
}
