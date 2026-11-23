import {extname} from 'node:path';
import type {ServerResponse} from 'node:http';
import type {Pool,PoolClient} from 'pg';
import type {WorkspaceExportArtifact} from '../workspaceExport.js';
import type {PublicationText} from '../workspacePublication.js';
import {openOwnedArtifact} from './artifactRoute.js';
import {findOwnedInputFileInTransaction} from './episodeReads.js';
import {ownerTransaction} from './ownerTransaction.js';
import {ownedPublicationWorkspace,readWorkspacePublication} from './workspacePublicationStore.js';
import {canonicalFingerprint,ConfigurationError} from './configurationCommands.js';
import {deliveryArchiveSize,streamDeliveryArchive,zip32Limit,type DeliveryArchiveMember} from './deliveryArchive.js';
import {batchPublicationDownloadPath,batchPublicationSelectionLimit,type BatchPublicationItem,type BatchPublicationPreview} from './batchPublicationDownloadTypes.js';

interface LatestExport {
 id:string;
 status:string;
 content_sha256:string;
 project_content_version:string;
 confirmed_at:Date|null;
 artifact:WorkspaceExportArtifact|null;
}

function parseSelection(query:URLSearchParams){
 const episodeIds=query.getAll('episode'),fingerprint=query.get('snapshot');
 if([...query.keys()].some(key=>key!=='episode'&&key!=='snapshot')||query.getAll('snapshot').length>1||fingerprint!==null&&!/^[a-f0-9]{64}$/.test(fingerprint)||episodeIds.length===0||episodeIds.length>batchPublicationSelectionLimit||
  episodeIds.some(id=>!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(id))||new Set(episodeIds).size!==episodeIds.length){
  throw new ConfigurationError(400,`请选择 1 至 ${batchPublicationSelectionLimit} 张不同的生产单。`);
 }
 return {episodeIds,fingerprint};
}

function publicationText({title,description,tags}:PublicationText){
 const sections=[
  title.trim()&&'标题\n'+title,
  description.trim()&&'简介\n'+description,
  tags.length&&'标签\n'+tags.join('、'),
 ].filter(Boolean);
 return sections.length?Buffer.from(sections.join('\n\n')+'\n'):null;
}

function reserveFolder(title:string,used:Set<string>){
 const normalized=title.normalize('NFKC').replace(/[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}<>:"/\\|?*]/gu,'_').trim().replace(/^\.+|[ .]+$/g,'');
 const windowsStem=normalized.split('.',1)[0].trimEnd();
 const candidate=/^(?:con|prn|aux|nul|conin\$|conout\$|com[0-9]|lpt[0-9])$/i.test(windowsStem)?'_'+normalized:normalized||'生产单';
 let base='',bytes=0;
 // Keep both the folder and the titled MP4 under the 255-byte component limit, including the suffix.
 for(const character of candidate){
  bytes+=Buffer.byteLength(character);
  if(bytes>240)break;
  base+=character;
 }
 base=base.replace(/[ .]+$/g,'')||'生产单';
 let folder=base;
 for(let number=2;used.has(folder.toUpperCase());number++)folder=`${base} (${number})`;
 used.add(folder.toUpperCase());
 return folder;
}

async function openVerifiedReference(c:PoolClient,ownerId:string,mediaRoot:string,episodeId:string,reference:WorkspaceExportArtifact,signal:AbortSignal){
 let artifact;
 try{artifact=await findOwnedInputFileInTransaction(c,ownerId,episodeId,reference.relativePath,mediaRoot);}
 catch(error){if(error instanceof ConfigurationError)return null;throw error;}
 if(!artifact||artifact.sha256!==reference.sha256||Number(artifact.file_size)!==reference.fileSize)return null;
 try{
  return {...await openOwnedArtifact(mediaRoot,artifact,signal),assetRoot:artifact.storage_location.assetRoot,sha256:reference.sha256};
 }catch{signal.throwIfAborted();return null;}
}

export async function serveBatchPublicationDownload(pool:Pool,ownerId:string,mediaRoot:string,query:URLSearchParams,response:ServerResponse):Promise<BatchPublicationPreview|undefined>{
 const {episodeIds,fingerprint}=parseSelection(query);
 const entries:DeliveryArchiveMember[]=[];
 const members:{name:string;size:number}[]=[];
 const usedFolders=new Set<string>();
 const controller=new AbortController();
 const abort=()=>controller.abort();
 response.once('close',abort);
 const keepFile=async(name:string,opened:NonNullable<Awaited<ReturnType<typeof openVerifiedReference>>>)=>{
  const member={name,size:opened.size};
  members.push(member);
  if(fingerprint)entries.push({...member,file:opened.file,sha256:opened.sha256});
  else await opened.file.close();
 };
 try{
  const snapshot=await ownerTransaction(pool,ownerId,true,async c=>{
   const items:BatchPublicationItem[]=[],identities:unknown[]=[];
   for(const episodeId of episodeIds){
    controller.signal.throwIfAborted();
    let workspace;
    try{workspace=await ownedPublicationWorkspace(c,episodeId);}
    catch(error){
     if(!(error instanceof ConfigurationError)||error.status!==404)throw error;
     items.push({episodeId,status:'skipped',reason:'生产单不可见或还没有制作工作区。'});
     continue;
    }
    const title=workspace.title;
    const exported=(await c.query<LatestExport>(`SELECT id,status,content_sha256,project_content_version,confirmed_at,artifact
     FROM local_identity.workspace_exports WHERE workspace_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1`,[workspace.id])).rows[0];
    const video=exported?.artifact;
    if(!exported?.confirmed_at||exported.status!=='ready'||exported.content_sha256!==workspace.content_sha256||Number(exported.project_content_version)!==Number(workspace.revision)||
     !video||extname(video.relativePath).toLowerCase()!=='.mp4'||video.fileSize<=0){
     items.push({episodeId,title,status:'skipped',reason:'当前成片未确认或没有可用的 MP4。'});
     continue;
    }
    const openedVideo=await openVerifiedReference(c,ownerId,mediaRoot,episodeId,video,controller.signal);
    if(!openedVideo){
     items.push({episodeId,title,status:'skipped',reason:'成片缺失或文件指纹已变化。'});
     continue;
    }
    const folder=reserveFolder(title,usedFolders);
    await keepFile(`${folder}/${folder}.mp4`,openedVideo);

    const publication=await readWorkspacePublication(c,openedVideo.assetRoot,workspace);
    const warnings:string[]=[],text=publicationText(publication.content);
    const cover=publication.cover?.file,extension=cover?extname(cover.relativePath).toLowerCase():'';
    const openedCover=cover&&/^\.(?:png|jpe?g|webp)$/.test(extension)?await openVerifiedReference(c,ownerId,mediaRoot,episodeId,cover,controller.signal):null;
    if(openedCover){
     await keepFile(`${folder}/封面${extension}`,openedCover);
    }else warnings.push(cover?'封面缺失或文件指纹已变化。':'没有已保存的封面。');
    if(text){
     const member={name:`${folder}/发布资料.txt`,size:text.length};
     members.push(member);
     if(fingerprint)entries.push({...member,data:text});
    }else warnings.push('没有已保存的发布文案。');
    items.push({episodeId,title,folder,status:'ready',cover:!!openedCover,text:!!text,warnings});
    identities.push({episodeId,exportId:exported.id,confirmedAt:exported.confirmed_at.toISOString(),video,publicationRevision:publication.revision,cover:openedCover?cover:null,text:text?.toString('utf8')??null});
   }
   return {items,identities};
  });
  const bytes=members.length?deliveryArchiveSize(members):0;
  const blockedReason=!members.length?'所选生产单没有可下载的已确认成片。':bytes>=zip32Limit?'超过单个 ZIP 的 4 GiB 下载上限，请减少选择数量。':null;
  const current=canonicalFingerprint({ownerId,items:snapshot.items,identities:snapshot.identities});
  if(fingerprint){
   if(fingerprint!==current)throw new ConfigurationError(409,'成片或发布资料已变化，请重新预览后下载。');
   if(blockedReason)throw new ConfigurationError(409,blockedReason);
   if(!response.destroyed)await streamDeliveryArchive(entries,response,'publication-batch.zip');
   return;
  }
  const downloadQuery=new URLSearchParams(query);
  downloadQuery.set('snapshot',current);
  return {items:snapshot.items,bytes,blockedReason,downloadUrl:blockedReason?null:`/api/local/${batchPublicationDownloadPath}?${downloadQuery}`};
 }catch(error){
  if(!response.destroyed)throw error;
 }finally{
  response.off('close',abort);
  await Promise.allSettled(entries.flatMap(entry=>'file' in entry?[entry.file.close()]:[]));
 }
}
