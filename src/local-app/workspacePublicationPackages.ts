import type {Pool,PoolClient} from 'pg';
import type {OwnerSession} from './sessions.js';
import type {ArtifactManifest} from '../worker/contracts.js';
import {randomUUID} from 'node:crypto';
import {sessionTransaction,ownerTransaction} from './ownerTransaction.js';
import {ownedPublicationWorkspace,readWorkspacePublication} from './workspacePublicationStore.js';
import {resolveEpisodeAssetRoot} from './accountAssetRoots.js';
import {episodeFileIO} from './episodeFiles.js';
import {persistPublicationFile} from './workspacePublicationFiles.js';
import {createWorkspacePublishPackage,type WorkspaceDeliveryIdentity} from '../publishing/workspacePublishPackage.js';
import {verifyPublishPackage} from '../publishing/publishPackage.js';
import {ConfigurationError,canonicalFingerprint} from './configurationCommands.js';
const uuid=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
export interface PublicationPackageReference {id:string;revision:number;downloadUrl:string}
export class LocalPublicationPackages {
 constructor(private pool:Pool,private mediaRoot:string){}
 async command(session:OwnerSession,episodeId:string,body:Record<string,unknown>):Promise<PublicationPackageReference>{
  const data=body.data as Record<string,unknown>;
  if(body.command!=='create'||Object.keys(body).some(key=>!['command','data','idempotencyKey'].includes(key))||typeof body.idempotencyKey!=='string'||!uuid.test(body.idempotencyKey)||!data||typeof data!=='object'||Array.isArray(data)||Object.keys(data).length!==1||!Number.isSafeInteger(data.expectedRevision))throw new ConfigurationError(400,'最新交付包请求无效。');
  const hash=canonicalFingerprint({episodeId,body}),key=body.idempotencyKey;
  return sessionTransaction(this.pool,session,async c=>{
   const w=await ownedPublicationWorkspace(c,episodeId,true),root=await resolveEpisodeAssetRoot(c,this.mediaRoot,episodeId),storage=await episodeFileIO(c,root,episodeId,true);
   const receipt=(await c.query('SELECT payload_hash,result FROM local_identity.command_receipts WHERE owner_id=$1 AND idempotency_key=$2',[session.id,key])).rows[0];if(receipt){if(receipt.payload_hash!==hash)throw new ConfigurationError(409,'交付包操作标识已用于其他资料。');return receipt.result;}
   const publication=await readWorkspacePublication(c,root,w);if(publication.revision!==data.expectedRevision)throw new ConfigurationError(409,'资料已有更新，请等待保存后重新下载。');
   const exported=(await c.query("SELECT x.*,t.last_result FROM local_identity.workspace_exports x JOIN local_identity.workspace_deliveries d ON d.export_id=x.id JOIN public.tasks t ON t.id=d.task_id WHERE x.workspace_id=$1 AND x.content_sha256=$2 AND x.confirmed_at IS NOT NULL AND x.status='ready' AND t.status='completed' ORDER BY x.created_at DESC,d.created_at DESC LIMIT 1",[w.id,w.content_sha256])).rows[0];
   const latest=(await c.query('SELECT w.revision,(SELECT id FROM local_identity.workspace_exports WHERE workspace_id=w.id ORDER BY created_at DESC,id DESC LIMIT 1) export_id FROM local_identity.production_workspaces w WHERE w.id=$1',[w.id])).rows[0];
   if(!exported||exported.id!==latest.export_id||Number(exported.project_content_version)!==Number(latest.revision))throw new ConfigurationError(409,'请先确认并完成当前视频；发布资料可以先保存。');
   const original=exported.last_result?.artifacts?.find((a:ArtifactManifest)=>a.artifactType==='publish_package');if(!original)throw new ConfigurationError(409,'核心交付尚不可用。');
   await verifyPublishPackage({assetRoot:root,episodeId,publishPackage:original,storage});
   const existing=(await c.query('SELECT id FROM local_identity.workspace_publication_packages WHERE workspace_id=$1 AND publication_revision=$2 AND export_id=$3',[w.id,publication.revision,exported.id])).rows[0];
   const id=existing?.id??randomUUID();
   if(!existing){
    const identity=exported.last_result.deliveryIdentity as WorkspaceDeliveryIdentity;
    if(!identity||identity.workspaceId!==w.id||identity.exportId!==exported.id||identity.contentSha256!==w.content_sha256)throw new ConfigurationError(409,'视频交付身份不一致。');
    const checks=exported.last_result.artifacts.find((a:ArtifactManifest)=>a.artifactType==='final_qc_report');if(!checks)throw new ConfigurationError(409,'核心交付缺少检查证据。');
    const prefix=`${storage.relativePath}/publication/packages/${id}`,artifacts:ArtifactManifest[]=[identity.video,identity.project,checks];
    if(publication.cover)artifacts.push({artifactType:'cover',...publication.cover.file});
    if(publication.content.title||publication.content.description||publication.content.tags.length){
     const metadata=await persistPublicationFile(c,root,episodeId,`${prefix}/metadata.json`,Buffer.from(JSON.stringify({version:'workspace-publication/v1',publicationRevision:publication.revision,title:publication.content.title,description:publication.content.description,tags:publication.content.tags,exportId:exported.id,contentSha256:w.content_sha256,coverSource:publication.cover?.source??null},null,2)+'\n'));artifacts.push({artifactType:'metadata',...metadata});
    }
    const manifest=await createWorkspacePublishPackage({assetRoot:root,episodeId,relativePath:`${prefix}/manifest.json`,identity,artifacts,storage});
    await c.query('INSERT INTO local_identity.workspace_publication_files(episode_id,relative_path,sha256,file_size) VALUES($1,$2,$3,$4)',[episodeId,manifest.relativePath,manifest.sha256,manifest.fileSize]);
    artifacts.push({artifactType:'publish_package',...manifest});
    await c.query('INSERT INTO local_identity.workspace_publication_packages(id,workspace_id,episode_id,publication_revision,export_id,artifacts) VALUES($1,$2,$3,$4,$5,$6)',[id,w.id,episodeId,publication.revision,exported.id,JSON.stringify(artifacts)]);
   }
   const result={id,revision:publication.revision,downloadUrl:`/api/local/episodes/${episodeId}/delivery-download?publication=${id}`};
   await c.query('INSERT INTO local_identity.command_receipts(owner_id,idempotency_key,payload_hash,result) VALUES($1,$2,$3,$4)',[session.id,key,hash,result]);return result;
  });
 }
 async read(ownerId:string,episodeId:string,id:string){return ownerTransaction(this.pool,ownerId,true,c=>readPublicationPackage(c,this.mediaRoot,episodeId,id));}
}
async function readPublicationPackage(c:PoolClient,mediaRoot:string,episodeId:string,id:string){
 await ownedPublicationWorkspace(c,episodeId);const p=(await c.query('SELECT artifacts FROM local_identity.workspace_publication_packages WHERE id=$1 AND episode_id=$2',[id,episodeId])).rows[0];if(!p)throw new ConfigurationError(404,'交付包不可见。');
 const root=await resolveEpisodeAssetRoot(c,mediaRoot,episodeId),artifacts=p.artifacts as ArtifactManifest[],manifest=artifacts.find(a=>a.artifactType==='publish_package');if(!manifest)throw new ConfigurationError(409,'交付包清单不可用。');
 await verifyPublishPackage({assetRoot:root,episodeId,publishPackage:manifest,storage:await episodeFileIO(c,root,episodeId)});return{artifacts};
}
