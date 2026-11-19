import {savePublicationCover} from './workspacePublicationCover.js';
import type {ProductionWorkspaceRecord} from './productionWorkspaceCommands.js';
import type {Pool,PoolClient} from 'pg';
import type {OwnerSession} from './sessions.js';
import type {PublicationContent,WorkspacePublication} from '../workspacePublication.js';
import {emptyPublicationContent,parsePublicationContent} from '../workspacePublication.js';
import {ownerTransaction,sessionTransaction} from './ownerTransaction.js';
import {ConfigurationError,canonicalFingerprint} from './configurationCommands.js';
import {resolveEpisodeAssetRoot} from './accountAssetRoots.js';
import {verifyEpisodeFile} from './episodeFiles.js';

export interface PublicationWorkspace {id:string;episode_id:string;content_sha256:string;archived_at:string|null}
interface PublicationRow {workspace_id:string;revision:string;content:PublicationContent;cover:WorkspacePublication['cover'];basis_content_sha256:string;previous_text:WorkspacePublication['previousText'];updated_at:Date}
export async function ownedPublicationWorkspace(c:PoolClient,episodeId:string,write=false):Promise<PublicationWorkspace>{
 const w=(await c.query(`SELECT w.id,w.episode_id,w.content_sha256,e.archived_at FROM local_identity.production_workspaces w JOIN public.episodes e ON e.id=w.episode_id JOIN public.account_memberships m ON m.account_id=e.account_id WHERE e.id=$1 AND m.user_id=local_identity.owner_id() AND m.role='owner' AND NOT EXISTS(SELECT 1 FROM local_identity.episode_recycle_bin r WHERE r.episode_id=e.id) ${write?'FOR UPDATE OF w':''}`,[episodeId])).rows[0];
 if(!w)throw new ConfigurationError(404,'生产单不可见。');
 if(write&&w.archived_at)throw new ConfigurationError(409,'生产单已归档，请先恢复后修改发布资料。');
 return w;
}
function publication(row:PublicationRow):WorkspacePublication{return{workspaceId:row.workspace_id,revision:Number(row.revision),content:row.content,cover:row.cover,basisContentSha256:row.basis_content_sha256,previousText:row.previous_text,updatedAt:new Date(row.updated_at).toISOString()};}
export async function readWorkspacePublication(c:PoolClient,root:string,w:PublicationWorkspace):Promise<WorkspacePublication>{
 const row=(await c.query('SELECT * FROM local_identity.workspace_publications WHERE workspace_id=$1',[w.id])).rows[0];
 if(row)return publication(row);
 const state:WorkspacePublication={workspaceId:w.id,revision:0,content:{...emptyPublicationContent,tags:[]},cover:null,basisContentSha256:w.content_sha256,previousText:null,updatedAt:null};
 // Read old package text as a starting draft; a GET never rewrites its files or completion.
 const old=(await c.query("SELECT t.last_result FROM local_identity.workspace_deliveries d JOIN public.tasks t ON t.id=d.task_id WHERE d.workspace_id=$1 AND t.status='completed' ORDER BY d.created_at DESC LIMIT 1",[w.id])).rows[0]?.last_result;
 const metadata=old?.artifacts?.find((a:{artifactType:string})=>a.artifactType==='metadata'),cover=old?.artifacts?.find((a:{artifactType:string})=>a.artifactType==='cover');
 if(metadata)try{const value=JSON.parse((await verifyEpisodeFile(c,root,w.episode_id,metadata.relativePath,metadata.sha256,metadata.fileSize)).toString('utf8'));state.content=parsePublicationContent({title:value.title,description:value.description,tags:value.tags,instruction:''});}catch{/* Missing historical publication does not block the current video or an empty draft. */}
 if(cover)state.cover={file:{relativePath:cover.relativePath,sha256:cover.sha256,fileSize:cover.fileSize},name:'已有封面',source:{kind:'existing'}};
 return state;
}
export async function writeWorkspacePublication(c:PoolClient,w:PublicationWorkspace,current:WorkspacePublication,expectedRevision:unknown,next:Pick<WorkspacePublication,'content'|'cover'|'previousText'>):Promise<WorkspacePublication>{
 if(!Number.isSafeInteger(expectedRevision)||expectedRevision!==current.revision)throw new ConfigurationError(409,'发布资料已在其他页面更新，请重新读取；当前输入仍保留。');
 const result=await c.query(`INSERT INTO local_identity.workspace_publications(workspace_id,episode_id,content,cover,basis_content_sha256,previous_text) VALUES($1,$2,$3,$4,$5,$6)
 ON CONFLICT(workspace_id) DO UPDATE SET revision=workspace_publications.revision+1,content=excluded.content,cover=excluded.cover,basis_content_sha256=excluded.basis_content_sha256,previous_text=excluded.previous_text,updated_at=clock_timestamp() WHERE workspace_publications.revision=$7 RETURNING *`,[w.id,w.episode_id,next.content,next.cover,w.content_sha256,next.previousText,expectedRevision]);
 if(!result.rows[0])throw new ConfigurationError(409,'发布资料已有更新，请重新读取。');
 return publication(result.rows[0]);
}
export class LocalWorkspacePublications {
 constructor(private pool:Pool,private mediaRoot:string){}
 async read(ownerId:string,episodeId:string){return ownerTransaction(this.pool,ownerId,true,async c=>{const w=await ownedPublicationWorkspace(c,episodeId);return readWorkspacePublication(c,await resolveEpisodeAssetRoot(c,this.mediaRoot,episodeId),w);});}
 async command(session:OwnerSession,episodeId:string,body:Record<string,unknown>){
  if(!['save','cover'].includes(String(body.command))||Object.keys(body).some(key=>!['command','data','idempotencyKey'].includes(key))||typeof body.idempotencyKey!=='string'||!(/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/).test(body.idempotencyKey)||!body.data||typeof body.data!=='object'||Array.isArray(body.data))throw new ConfigurationError(400,'发布资料请求无效。');
  const data=body.data as Record<string,unknown>;if(body.command==='save'&&Object.keys(data).some(key=>!['expectedRevision','content'].includes(key)))throw new ConfigurationError(400,'发布资料字段无效。');
  let content:PublicationContent|undefined;if(body.command==='save')try{content=parsePublicationContent(data.content);}catch(error){throw new ConfigurationError(400,(error as Error).message);}
  const hash=canonicalFingerprint({episodeId,body});
  return sessionTransaction(this.pool,session,async c=>{
   const w=await ownedPublicationWorkspace(c,episodeId,true);
   const receipt=(await c.query('SELECT payload_hash,result FROM local_identity.command_receipts WHERE owner_id=$1 AND idempotency_key=$2',[session.id,body.idempotencyKey])).rows[0];
   if(receipt){if(receipt.payload_hash!==hash)throw new ConfigurationError(409,'同一操作标识不能用于不同资料。');return receipt.result;}
   const current=await readWorkspacePublication(c,await resolveEpisodeAssetRoot(c,this.mediaRoot,episodeId),w);
   if(current.revision!==data.expectedRevision)throw new ConfigurationError(409,'发布资料已有更新，请重新读取；原封面仍保留。');
   const row=body.command==='cover'?(await c.query('SELECT * FROM local_identity.production_workspaces WHERE id=$1',[w.id])).rows[0] as ProductionWorkspaceRecord:null;
   const cover=row?await savePublicationCover(c,await resolveEpisodeAssetRoot(c,this.mediaRoot,episodeId),row,data,body.idempotencyKey as string):current.cover;
   const saved=await writeWorkspacePublication(c,w,current,data.expectedRevision,{content:content??current.content,cover,previousText:current.previousText});
   await c.query('INSERT INTO local_identity.command_receipts(owner_id,idempotency_key,payload_hash,result) VALUES($1,$2,$3,$4)',[session.id,body.idempotencyKey,hash,saved]);return saved;
  });
 }
}
