import type {PoolClient} from 'pg';
import type {PublicationCover} from '../workspacePublication.js';
import type {ProductionWorkspaceRecord} from './productionWorkspaceCommands.js';
import {promisify} from 'node:util';
import {execFile} from 'node:child_process';
import {basename} from 'node:path';
import {ConfigurationError} from './configurationCommands.js';
import {episodeFileIO,verifyEpisodeFile} from './episodeFiles.js';
import {episodeStorageLocationAtRoot} from './episodeStorageLocation.js';
import {openOwnedArtifact} from './artifactRoute.js';
import {coverImageExtension} from '../publishing/coverImage.js';
import {validateImportedMaterial} from './materialAcceptance.js';
import {parseWorkspaceCoverSource} from '../workspaceCover.js';
import {readWorkspaceCoverInputs} from './workspaceCover.js';
import {readWorkspaceTemplateInputs} from './workspaceTemplateInputs.js';
import {persistPublicationFile} from './workspacePublicationFiles.js';

export async function savePublicationCover(c:PoolClient,root:string,row:ProductionWorkspaceRecord,data:Record<string,unknown>,intentId:string):Promise<PublicationCover>{
 const kind=data.kind,allowed=['expectedRevision','kind',...(kind==='upload'?['name','base64']:kind==='existing'?['source']:kind==='frame'?['exportId','videoSha256','timeSeconds']:[])];
 if(!['upload','existing','frame'].includes(String(kind))||Object.keys(data).some(key=>!allowed.includes(key)))throw new ConfigurationError(400,'封面来源无效。');
 const storage=await episodeFileIO(c,root,row.episode_id,true);let bytes:Buffer,name='封面',source:PublicationCover['source'];
 if(kind==='upload'){
  if(typeof data.name!=='string'||data.name.length>200||typeof data.base64!=='string'||data.base64.length>28*1024*1024)throw new ConfigurationError(400,'请选择不超过20 MB的 JPG、PNG 或 WebP 图片。');
  bytes=Buffer.from(data.base64,'base64');if(bytes.toString('base64')!==data.base64)throw new ConfigurationError(400,'图片内容无效。');
  name=basename(data.name);source={kind:'upload'};
 }else if(kind==='existing'){
  let selected;try{selected=parseWorkspaceCoverSource(data.source);}catch{throw new ConfigurationError(400,'已有图片身份无效。');}
  const template=await readWorkspaceTemplateInputs(c,root,row),candidate=(await readWorkspaceCoverInputs(c,row,template?.cover?.material)).find(input=>JSON.stringify(input.source)===JSON.stringify(selected));
  if(!candidate?.file||candidate.unavailableReason)throw new ConfigurationError(409,'已有封面不可用，请恢复来源或另选图片。');
  bytes=await verifyEpisodeFile(c,root,row.episode_id,candidate.file.relativePath,candidate.file.sha256,candidate.file.fileSize);name=candidate.name;source={kind:'existing'};
 }else{
  if(typeof data.exportId!=='string'||!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(data.exportId)||typeof data.videoSha256!=='string'||!/^[a-f0-9]{64}$/.test(data.videoSha256))throw new ConfigurationError(400,'成片身份无效。');
  const video=(await c.query('SELECT * FROM local_identity.workspace_exports WHERE workspace_id=$1 AND id=$2',[row.id,data.exportId])).rows[0];
  if(!video?.artifact||video.status!=='ready'||video.artifact.sha256!==data.videoSha256||video.content_sha256!==row.content_sha256||Number(video.project_content_version)!==Number(row.revision)||typeof data.timeSeconds!=='number'||!Number.isFinite(data.timeSeconds)||data.timeSeconds<0)throw new ConfigurationError(409,'成片或选帧位置已变化，请从当前成片重新选择。');
  const location=await episodeStorageLocationAtRoot(c,root,row.episode_id),opened=await openOwnedArtifact(root,{storage_location:location,resolved_file_path:await storage.resolveReference(video.artifact.relativePath),source_asset_root:root,source_media_root:root,relative_path:video.artifact.relativePath,sha256:video.artifact.sha256,file_size:video.artifact.fileSize});
  try{
   const probe=await promisify(execFile)('ffprobe',['-v','error','-show_entries','format=duration','-of','json',opened.path],{timeout:15000,maxBuffer:1024*1024});const duration=Number(JSON.parse(probe.stdout).format?.duration);
   if(!(duration>0)||data.timeSeconds>=duration)throw new ConfigurationError(400,'选帧位置超出实际视频时长。');
   const decoded=await promisify(execFile)('ffmpeg',['-nostdin','-v','error','-ss',String(data.timeSeconds),'-i',opened.path,'-frames:v','1','-f','image2pipe','-c:v','png','pipe:1'],{encoding:'buffer',timeout:30000,maxBuffer:20*1024*1024});bytes=decoded.stdout;
  }finally{await opened.file.close();}
  name='成片选帧.png';source={kind:'frame',exportId:video.id,videoSha256:video.artifact.sha256,timeSeconds:data.timeSeconds};
 }
 const extension=coverImageExtension(bytes);if(!bytes.length||bytes.length>20*1024*1024||!extension)throw new ConfigurationError(400,'请选择有效且不超过20 MB的 JPG、PNG 或 WebP 图片。');
 // Validate declared extension too: a renamed video or wrong picture extension is not accepted.
 await validateImportedMaterial(bytes,{sourcePath:name,materialType:'image',mimeType:'',materialPurpose:'cover',isMainScript:false});
 if(!/\.(png|jpe?g|webp)$/i.test(name))throw new ConfigurationError(400,'封面只支持 JPG、PNG 或 WebP。');
 const file=await persistPublicationFile(c,root,row.episode_id,`${storage.relativePath}/publication/covers/${intentId}.${extension}`,bytes);
 return{file,name,source};
}
