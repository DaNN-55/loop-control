import {readAccountDeletionStatus} from './accountDeletion.js';
import {reconcileOwnerNativeOutput} from './workspaceOutputReconciliation.js';
import{runtimeErrorMessages}from'../orchestration/runtimeBuild.js';
import {LocalMediaRootSettings} from './mediaRootSettings.js';
import {readWorkspacePlanningSelection} from './planningSelectionStore.js';
import {readProductionWorkspace,readWorkspaceVersion} from './productionWorkspaceCommands.js';
import {readLegacyStudioProject} from './legacyStudioProject.js';
import {resolveEpisodeAssetRoot} from './accountAssetRoots.js';
import{ownerTransaction,sessionTransaction}from'./ownerTransaction.js';
import {readGlobalPlanning,updateGlobalPlanning} from './globalPlanningStore.js';
import {readWorkspaceSearch} from './workspaceSearch.js';
import {readOwnerPreferences,saveOwnerPreferences,readOwnerNotificationEvents} from './ownerPreferences.js';
import {ScriptProductionStore} from './scriptProductionStore.js';
import{hashPassword}from'./password.js';
import{tokenHash}from'./sessions.js';
import{readMediaDeployment}from'./mediaDeployment.js';
import {LocalAccountCommands} from './accountCommands.js';
import type{NativeAutomation}from'./nativeAutomation.js';
import{LocalEpisodeLifecycle}from'./episodeLifecycle.js';
import {executeConfiguration,ConfigurationError} from './configurationCommands.js';
import {timingSafeEqual} from 'node:crypto';
import {join} from 'node:path';
import type {IncomingMessage,ServerResponse} from 'node:http';
import type {Pool} from 'pg';
import {readLocalCatalog,parseCatalogQuery} from './catalog.js';
import {lookupSession,readSessionToken,establishSession,revokeSession,cookieHeader,csrfFor} from './sessions.js';
import {readLocalEpisode,findOwnedArtifact,findOwnedInputFile} from './episodeReads.js';
import {serveDeliveryArchive} from './deliveryArchive.js';
import {serveOwnedArtifact} from './artifactRoute.js';
import {LocalConnections} from './connections.js';
import {SecretStoreError} from './connectionPorts.js';
import type {LocalEpisodeCommands} from './episodeCommands.js';
import type {SecretAdministration,SecretOperation} from './secretAdministration.js';
import type {RuntimeStatus} from '../observability/runtimeStatus.js';
import type {RuntimeLogReport,LogStoragePort} from '../observability/logTypes.js';
interface LocalOptions {logs?:{read:()=>Promise<RuntimeLogReport>;storage:LogStoragePort};recoverOutput?:(taskId:string,attempt:number)=>Promise<{status:'completed';registered:boolean}>;mediaRootSettings?:LocalMediaRootSettings;pool:Pool;origin:string;mediaRoot:string;historyRoot?:string;secrets?:SecretAdministration;connections?:LocalConnections;episodes?:LocalEpisodeCommands;automation?:NativeAutomation;accounts?:LocalAccountCommands;runtimeStatus?:(ownerId:string,page:number)=>Promise<RuntimeStatus>}
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
async function readBody(request:IncomingMessage,limit=8192):Promise<Record<string,unknown>>{
 if(request.headers['content-type']?.split(';')[0]!=='application/json')throw Error('JSON required');
 let text='';for await(const chunk of request){text+=chunk;if(Buffer.byteLength(text)>limit)throw Error('Body too large');}
 const parsed:unknown=JSON.parse(text);if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw Error('Object required');return parsed as Record<string,unknown>;
}
export function createLocalHandler(options:LocalOptions&{stateDirectory?:string}){
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
   if(url.pathname==='/api/local/storyboard-planning'){
    if(request.method==='GET'){send(200,await ownerTransaction(options.pool,session.id,true,readGlobalPlanning));return;}
    if(request.method!=='POST')throw new ConfigurationError(405,'分镜规则请求方法无效。');
    let body;try{body=await readBody(request,256*1024);}catch{throw new ConfigurationError(400,'分镜规则请求格式无效。');}
    send(200,await sessionTransaction(options.pool,session,c=>updateGlobalPlanning(c,body.command,body.data)));return;
   }
   if(url.pathname==='/api/local/preferences'){
    if(request.method==='GET'){send(200,await readOwnerPreferences(options.pool,session.id));return;}
    if(request.method!=='POST'){send(405,{error:'偏好请求方法无效。'});return;}
    let body;try{body=await readBody(request,96*1024);if(body.command!=='update'||Object.keys(body).some(key=>!['command','data','idempotencyKey'].includes(key)))throw Error();}catch{send(400,{error:'偏好请求格式无效。'});return;}
    send(200,await saveOwnerPreferences(options.pool,session,body.data));return;
   }
   if(url.pathname==='/api/local/notification-events'&&request.method==='GET'){send(200,await readOwnerNotificationEvents(options.pool,session.id));return;}
   if(url.pathname==='/api/local/logs'||url.pathname==='/api/local/log-storage'){
    if(url.search){send(400,{error:'日志请求不接受文件路径或查询参数。'});return;}
    if(!options.logs){send(503,{error:'日志服务尚未配置。'});return;}
    if(url.pathname==='/api/local/logs'){
     if(request.method!=='GET'){send(405,{error:'日志仅支持读取。'});return;}
     send(200,await options.logs.read());return;
    }
    if(request.method==='GET'){send(200,options.logs.storage.read());return;}
    if(request.method!=='POST'){send(405,{error:'日志位置请求方法无效。'});return;}
    let body;try{body=await readBody(request);if(!['choose','save'].includes(String(body.command))||Object.keys(body).some(key=>!['command','path'].includes(key))||body.command==='choose'&&body.path!==undefined||body.command==='save'&&(typeof body.path!=='string'||body.path.length>4096))throw Error();}catch{send(400,{error:'日志位置请求格式无效。'});return;}
    try{
     if(body.command==='choose'){if(!options.logs.storage.choose){send(503,{error:'本机目录选择不可用，请填写绝对路径。'});return;}send(200,await options.logs.storage.choose());}
     else send(200,options.logs.storage.save(body.path as string));
    }catch{send(400,{error:'日志目录不可用，请选择当前用户拥有且可写的普通目录。'});}return;
   }
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
   // Status observes media failure; business routes below still require the deployment guard.
   if(url.pathname==='/api/local/system-status'){
    if(request.method!=='GET'){send(405,{error:'系统状态仅支持读取。'});return;}
    const raw=url.searchParams.get('queuePage')??'1';
    if(!/^[1-9]\d{0,5}$/.test(raw)||[...url.searchParams.keys()].some(k=>k!=='queuePage')||url.searchParams.getAll('queuePage').length>1){send(400,{error:'任务队列页码无效。'});return;}
    const [maintenance,runtime]=await Promise.all([options.automation?.status().catch(()=>null),options.runtimeStatus?.(session.id,Number(raw))]);
    if(!maintenance&&!runtime){send(503,{error:'系统状态暂不可用，请稍后重试。'});return;}
    send(200,{...maintenance,observedAt:runtime?.observedAt??maintenance?.observedAt,runtime:runtime??null,maintenanceAvailable:!!maintenance});return;
   }
   await readMediaDeployment(options.pool,options.mediaRoot,request.method!=='GET');
   if(url.pathname==='/api/local/account-commands'&&request.method==='POST'){
    let body;try{body=await readBody(request,16384);}catch{send(400,{error:'账号本机操作请求格式无效。'});return;}
    const controller=new AbortController(),closed=()=>{if(!response.writableEnded)controller.abort();};response.once('close',closed);
    try{const result=await accounts.execute(session,body,controller.signal);if(!response.destroyed)send(200,result);}catch(error){if(!response.destroyed)throw error;}finally{response.off('close',closed);}return;
   }
   if(url.pathname==='/api/local/configuration'&&request.method==='POST'){
    let body;try{body=await readBody(request,256*1024);}catch{send(400,{error:'配置请求格式无效。'});return;}
    send(200,await executeConfiguration(options.pool,session,body,options.mediaRoot,connections.configurationReady?(client,refs)=>connections.assertBlueprintReferences(client,refs,{purpose:'save'}):undefined));return;
   }
   if(url.pathname==='/api/local/native-output/reconcile'&&request.method==='POST'){
    let body;try{body=await readBody(request);}catch{send(400,{error:'产物核对请求格式无效。'});return;}
    send(200,await reconcileOwnerNativeOutput(options.pool,session,body,options.recoverOutput));return;
   }
   if(url.pathname==='/api/local/episode-commands'&&request.method==='POST'){
    if(!options.episodes){send(503,{error:'本地Episode执行服务尚未配置。'});return;}
    let body;try{body=await readBody(request,140*1024*1024);}catch{send(400,{error:'Episode请求格式无效。'});return;}
    send(200,await options.episodes.execute(session,body));return;
   }
   if(url.pathname==='/api/local/episode-lifecycle'&&request.method==='POST'){let body;try{body=await readBody(request,16384);}catch{send(400,{error:'生命周期请求格式无效。'});return;}send(200,await lifecycle.execute(session,body));return;}
   if(url.pathname==='/api/local/deletion-cleanups'&&request.method==='GET'){send(200,await lifecycle.pending(session));return;}
   if(url.pathname==='/api/local/account-deletion-status'){
    if(request.method!=='GET'){send(405,{error:'只支持读取账号删除条件。'});return;}
    const accountId=url.searchParams.get('accountId')??'';
    if(!uuid.test(accountId)||[...url.searchParams.keys()].some(key=>key!=='accountId')||url.searchParams.getAll('accountId').length!==1){send(400,{error:'账号标识无效。'});return;}
    const status=await readAccountDeletionStatus(options.pool,session.id,accountId);
    if(!status)throw new ConfigurationError(404,'账号不可见。');send(200,status);return;
   }
   if(url.pathname==='/api/local/connection-usage'){
    if(request.method!=='GET'){send(405,{error:'只支持读取连接用量。'});return;}
    const connectionId=url.searchParams.get('connectionId')??'';if(!uuid.test(connectionId)||[...url.searchParams.keys()].some(key=>key!=='connectionId')){send(400,{error:'连接标识无效。'});return;}
    send(200,await connections.readUsage(session.id,connectionId));return;
   }
   if(url.pathname==='/api/local/connection-billing'){
    if(request.method==='GET'){
     const id=url.searchParams.get('connectionId')??'';
     if(!uuid.test(id)||[...url.searchParams.keys()].some(k=>k!=='connectionId')){send(400,{error:'连接标识无效。'});return;}
     send(200,await connections.billing.read(session.id,id));return;
    }
    if(request.method==='POST'&&!url.search){
     let body;try{body=await readBody(request,8192);}catch{send(400,{error:'账务设置请求格式无效。'});return;}
     send(200,await connections.billing.command(session,body));return;
    }
    send(405,{error:'账务设置请求方法无效。'});return;
   }
   if(url.pathname==='/api/local/connection-models'){
    if(request.method==='GET'){
     const id=url.searchParams.get('connectionId')??'';
     if(!uuid.test(id)||[...url.searchParams.keys()].some(k=>k!=='connectionId')){send(400,{error:'连接标识无效。'});return;}
     send(200,await connections.models.read(session.id,id));return;
    }
    if(request.method==='POST'&&!url.search){
     let body;try{body=await readBody(request,65536);}catch{send(400,{error:'模型设置请求格式无效。'});return;}
     send(200,await connections.models.command(session,body));return;
    }
    send(405,{error:'模型设置请求方法无效。'});return;
   }
   if(url.pathname==='/api/local/speech-sample'){
    if(request.method!=='POST'||url.search){send(405,{error:'样音请求需要 POST。'});return;}
    if(!options.stateDirectory){send(503,{error:'本机样音目录未配置。'});return;}
    let body;try{body=await readBody(request);}catch{send(400,{error:'样音请求格式无效。'});return;}
    send(200,await connections.speechSample(session.id,join(options.stateDirectory,'speech-samples'),body));return;
   }
   if(url.pathname==='/api/local/connections'){
    if(request.method==='GET'){send(200,await connections.read(session.id));return;}
    if(request.method==='POST'){
     let body;try{body=await readBody(request,32768);}catch{send(400,{error:'连接请求格式无效。'});return;}
     send(200,await connections.command(session,body));return;
    }
   }
   if(request.method!=='GET'){send(405,{error:'该本地命令尚未开放。'});return;}
   if(url.pathname==='/api/local/workspace-search'){send(200,await readWorkspaceSearch(options.pool,session.id,url.searchParams));return;}
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
    try{await serveOwnedArtifact(options.mediaRoot,file,response,request.headers.range,url.searchParams.get('download')==='1');}catch{if(response.headersSent)response.destroy();else send(409,{error:'产物路径或指纹校验失败。'});}return;
   }
   const deliveryArchive=url.pathname.match(/^\/api\/local\/episodes\/([^/]+)\/delivery-download$/);
   if(deliveryArchive&&uuid.test(deliveryArchive[1])&&request.method==='GET'){
    const episodeId=deliveryArchive[1],deliveryId=url.searchParams.get('delivery');
    if(!uuid.test(deliveryId??'')||[...url.searchParams.keys()].some(k=>k!=='delivery')||url.searchParams.getAll('delivery').length!==1)throw new ConfigurationError(400,'交付包引用无效。');
    const delivery=await ownerTransaction(options.pool,session.id,true,async c=>{
     const e=(await c.query("SELECT e.id FROM public.episodes e JOIN public.account_memberships m ON m.account_id=e.account_id WHERE e.id=$1 AND m.user_id=$2 AND m.role='owner'",[episodeId,session.id])).rows[0];
     if(!e)throw new ConfigurationError(404,'生产单不可见。');
     const w=await readProductionWorkspace(c,episodeId,await resolveEpisodeAssetRoot(c,options.mediaRoot,episodeId));
     const d=w?.deliveries?.find(d=>d.id===deliveryId);
     if(!d?.verified)throw new ConfigurationError(409,'交付包未验证或文件已变化，请刷新检查。');
     return d;
    });
    const entries=[];
    const names:Record<string,string>={final_render:'final-video.mp4',editable_project:'editable-project.json',metadata:'metadata.json',final_qc_report:'checks.json',publish_package:'manifest.json'};
    for(const a of delivery.artifacts){
     const artifact=await findOwnedInputFile(options.pool,session.id,episodeId,a.relativePath,options.mediaRoot);
     if(!artifact||artifact.sha256!==a.sha256||Number(artifact.file_size)!==a.fileSize)throw new ConfigurationError(409,'交付文件已变化，请刷新检查。');
     const name=names[a.artifactType]??(a.artifactType==='cover'?`cover.${a.relativePath.split('.').pop()}`:null);
     if(!name)throw new ConfigurationError(409,'交付文件类型不可下载。');
     entries.push({name,artifact});
    }
    try{await serveDeliveryArchive(options.mediaRoot,entries,response,episodeId);}catch(error){if(response.headersSent)response.destroy();else throw new ConfigurationError(409,error instanceof Error?error.message:'交付下载失败。');}return;
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
    const value=await ownerTransaction(options.pool,session.id,true,async c=>{const e=(await c.query('SELECT e.id,b.policy FROM public.episodes e JOIN public.account_memberships m ON m.account_id=e.account_id JOIN public.account_blueprint_versions b ON b.id=e.blueprint_version_id WHERE e.id=$1 AND m.user_id=$2 AND m.role=\'owner\'',[workspace[1],session.id])).rows[0];if(!e)throw new ConfigurationError(404,'生产单不可见。');const root=await resolveEpisodeAssetRoot(c,options.mediaRoot,e.id);return url.pathname.endsWith('/project')?readWorkspaceVersion(c,root,e.id,url.searchParams.get('sha')??''):{workspace:await readProductionWorkspace(c,e.id,root),planningSelection:await readWorkspacePlanningSelection(c,e.id),globalPlanningConfigured:Boolean((await readGlobalPlanning(c)).planningSelection.selection)};});send(200,url.pathname.endsWith('/project')?{project:value}:value);return;
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
  }catch(error){const runtimeCode=(error as {code?:string})?.code;if(runtimeCode&&Object.hasOwn(runtimeErrorMessages,runtimeCode)){send(503,{code:runtimeCode,error:runtimeErrorMessages[runtimeCode as keyof typeof runtimeErrorMessages]});return;}if(error instanceof ConfigurationError){send(error.status,{error:error.message,...(error.preflight?{preflight:error.preflight}:{})});return;}
   if(error instanceof SecretStoreError){send(error.code==='conflict'?409:503,{...(error.code==='denied'?{code:'keychain_access_denied'}:{}),error:error.code==='conflict'?'旧密钥引用不能覆盖；请显式创建新版本。':error.code==='denied'?'本机 Keychain 已锁定或拒绝访问；请运行 npm start 解锁，若仍不可用请检查系统授权。此次操作未确认完成。':'密钥存储或验证未就绪；请检查授权、绑定和本机状态。'});return;}
   if((error as {status?:number})?.status===401){send(401,{error:'会话已失效。'});return;}
   if((error as {code?:string})?.code==='P0002'){send(404,{error:'连接或版本不可见。'});return;}
   const code=(error as {code?:string})?.code;if(code==='42501'){send(403,{error:'所有者权限不足。'});return;}if(code==='23505'||code==='23503'){send(409,{error:'配置冲突或仍被引用。'});return;}if(code==='23514'||code?.startsWith('22')){send(400,{error:'配置校验未通过。'});return;}
   if(response.headersSent)response.destroy();else send(503,{code:'local_service_unavailable',error:request.method==='GET'?'本机服务暂不可用，请查看系统状态后重新读取。':'本机操作结果暂未确认，请查看系统状态并核对已有任务或保存结果，再继续操作。'});}
 };
}
