import type {IncomingMessage} from 'node:http';
import {ConfigurationError} from './configurationCommands.js';

const uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
export const harnessProductionHost='loop-control.internal';
export interface HarnessProductionScope {owner:{id:string;email:string};episodeIds?:readonly string[]}
const commands=new Set(['create','saveScriptReviewDraft','confirmScriptStudio','start','confirmReviewedScript','prepareWorkspace','matchWorkspaceImage','matchWorkspaceMaterial','registerWorkspaceVisualCandidate','prepareWorkspaceVisualCandidate','adoptWorkspaceVisualCandidate','openWorkspaceStudio','saveWorkspaceStudio','closeWorkspaceStudio','exportWorkspace','confirmWorkspaceExport','completeWorkspaceExport','confirmReviewedExport']);
const routeId=new RegExp(`^/api/local/episodes/(${uuid.source.slice(1,-1)})(?:/(workspace(?:/project)?|batch-script-review|saved-plan|delivery-download))?$`,'i');
const artifactId=new RegExp(`^/api/local/artifacts/(${uuid.source.slice(1,-1)})$`,'i');

const deny=()=>new ConfigurationError(403,'此操作不在 Harness 制作授权范围内。');
export function requireHarnessEpisode(scope:HarnessProductionScope,id:unknown){
 if(typeof id!=='string'||!uuid.test(id)||scope.episodeIds&&!scope.episodeIds.includes(id.toLowerCase()))throw deny();
}
function exactQuery(url:URL,required:string[],optional:string[]=[]){
 if(required.some(k=>url.searchParams.getAll(k).length!==1||!url.searchParams.get(k))||[...url.searchParams.keys()].some(k=>!required.includes(k)&&!optional.includes(k)||url.searchParams.getAll(k).length!==1))throw deny();
}
const isRecord=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
function requireOperation(scope:HarnessProductionScope,body:unknown){
 if(!isRecord(body)||typeof body.command!=='string'||!commands.has(body.command)||typeof body.idempotencyKey!=='string'||!uuid.test(body.idempotencyKey)||!isRecord(body.data)||Object.keys(body).some(k=>!['command','data','idempotencyKey'].includes(k)))throw deny();
 if(body.command==='create'){
  // New orders have no episode identity yet. Keep restricted episode-only
  // deployments closed; the original command still checks Owner/account/series.
  if(scope.episodeIds!==undefined||typeof body.data.accountId!=='string'||!uuid.test(body.data.accountId))throw deny();
  return;
 }
 // Native script editing is local-only. Do not adopt an AI assistant receipt;
 // original command validation still owns all other fields and state checks.
 if(['saveScriptReviewDraft','confirmScriptStudio'].includes(body.command)&&Object.hasOwn(body.data,'requestId'))throw deny();
 if(body.command==='prepareWorkspace'&&(Object.hasOwn(body.data,'legacyDecision')||Object.hasOwn(body.data,'reviewPackageId')))throw deny();
 requireHarnessEpisode(scope,body.data.episodeId);
}

/** Only the authenticated Unix listener can supply this in-process scope. */
export async function authorizeHarnessProduction(scope:HarnessProductionScope,request:IncomingMessage,read:(limit:number)=>Promise<Record<string,unknown>>){
 const target=request.url??'';
 if(request.headers.host!==harnessProductionHost||!/^(?:\/api\/local\/|\/_local-artifact(?:\?|$))/.test(target)||target.length>16384||/[#\\\x00-\x20]/.test(target))throw deny();
 const url=new URL(target,`http://${harnessProductionHost}`),pathname=url.pathname;
 if(target.split('?')[0]!==pathname)throw deny();
 if(request.method==='POST'){
  exactQuery(url,[]);
  if(!['/api/local/episode-commands','/api/local/command-receipt'].includes(pathname))throw deny();
  let body;try{body=await read(128*1024);}catch{throw new ConfigurationError(400,'制作请求格式无效或超过大小上限。');}
  if(pathname.endsWith('/command-receipt')){
   if(body.endpoint!=='episode-commands'||Object.keys(body).some(k=>!['endpoint','operation'].includes(k)))throw deny();
   requireOperation(scope,body.operation);
  }else requireOperation(scope,body);
  return body;
 }
 if(request.method!=='GET')throw deny();
 if(pathname==='/api/local/catalog'){
  // The ordinary catalog parser remains responsible for all pagination, sorting and filters.
  if((url.searchParams.get('view')??'episodes')!=='episodes'||url.searchParams.has('importBatchId')||url.searchParams.has('batchStage')&&url.searchParams.get('batchStage')!=='all')throw deny();
  return;
 }
 if(['/api/local/preferences','/api/local/session','/api/local/connections'].includes(pathname)){exactQuery(url,[]);return;}
 if(pathname==='/api/local/script-studio'){
  exactQuery(url,['episodeId','scriptRevisionId']);requireHarnessEpisode(scope,url.searchParams.get('episodeId'));return;
 }
 if(pathname==='/_local-artifact'){
  exactQuery(url,['episode','path'],['sha256','download']);requireHarnessEpisode(scope,url.searchParams.get('episode'));return;
 }
 if(artifactId.test(pathname)){exactQuery(url,[]);return;}
 const selected=routeId.exec(pathname);
 if(!selected)throw deny();
 requireHarnessEpisode(scope,selected[1]);
 if(!selected[2])exactQuery(url,[],['known']);
 else if(selected[2]==='workspace/project')exactQuery(url,['sha']);
 else if(selected[2]==='delivery-download')exactQuery(url,['delivery']);
 else exactQuery(url,[]);
}
