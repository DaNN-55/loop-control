import type {EpisodeFileIO} from '../local-app/episodeFiles.js';
import {assetPath} from './publishPackage.js';
import {relative} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import type {ArtifactManifest} from '../worker/contracts.js';
import type {PublishPackage} from './publishPackage.js';
import {verifyNativeFile} from '../local-app/localFiles.js';
import {safeAssetOutputPath} from '../worker/controlledMediaExecutor.js';
import {coverImageExtension} from './coverImage.js';
export const workspacePublishPackageVersion='publish-package/v2' as const;
export interface WorkspaceDeliveryIdentity {workspaceId:string;exportId:string;projectContentVersion:number;contentSha256:string;video:ArtifactManifest;project:ArtifactManifest}
export interface WorkspacePublishManifest {version:typeof workspacePublishPackageVersion;episodeId:string;identity:WorkspaceDeliveryIdentity;artifacts:ArtifactManifest[]}
const types=['final_render','editable_project','cover','metadata','final_qc_report'];
export async function createWorkspacePublishPackage(input:{assetRoot:string;episodeId:string;relativePath:string;identity:WorkspaceDeliveryIdentity;artifacts:ArtifactManifest[];storage?:EpisodeFileIO}):Promise<PublishPackage>{
 const manifest:WorkspacePublishManifest={version:workspacePublishPackageVersion,episodeId:input.episodeId,identity:input.identity,artifacts:input.artifacts};
 await verifyWorkspaceManifest(input.assetRoot,input.episodeId,manifest,input.identity,input.storage);
 const bytes=Buffer.from(JSON.stringify(manifest,null,2)+'\n'),pack={relativePath:input.relativePath,sha256:createHash('sha256').update(bytes).digest('hex'),fileSize:bytes.length};
 await input.storage?.assertValid();const prefix=input.storage?.relativePath??`episodes/${input.episodeId}`;if(!input.storage&&!pack.relativePath.startsWith(prefix+'/'))throw Error('发布包输出归属无效。');const physical=input.storage?relative(input.assetRoot,await input.storage.resolveReference(pack.relativePath)):pack.relativePath,path=await safeAssetOutputPath(input.assetRoot,physical);try{await writeFile(path,bytes,{flag:'wx',mode:0o600});}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;await verifyNativeFile(input.assetRoot,physical,pack.sha256,pack.fileSize);}
 return pack;
}
export async function verifyWorkspaceManifest(root:string,episodeId:string,value:unknown,expected?:WorkspaceDeliveryIdentity,storage?:EpisodeFileIO):Promise<void>{
 const m=value as WorkspacePublishManifest;
 if(!m||m.version!==workspacePublishPackageVersion||m.episodeId!==episodeId||!m.identity||!Array.isArray(m.artifacts)||m.artifacts.length!==types.length||types.some(type=>m.artifacts.filter(a=>a.artifactType===type).length!==1))throw Error('工作空间发布包缺少必需产物。');
 const id=m.identity;
 if(typeof id.workspaceId!=='string'||typeof id.exportId!=='string'||!Number.isSafeInteger(id.projectContentVersion)||!/^[a-f0-9]{64}$/.test(id.contentSha256)||!same(m.artifacts.find(a=>a.artifactType==='final_render'),id.video)||!same(m.artifacts.find(a=>a.artifactType==='editable_project'),id.project)||expected&&JSON.stringify(id)!==JSON.stringify(expected))throw Error('发布包与已确认导出身份不一致。');
 const files=new Map<string,Buffer>();
 for(const a of m.artifacts){if(!a.relativePath||!a.sha256?.match(/^[a-f0-9]{64}$/)||!Number.isSafeInteger(a.fileSize)||a.fileSize<1)throw Error('发布包产物归属或指纹无效。');const bytes=await verifyNativeFile(root,relative(root,await assetPath(root,episodeId,a.relativePath,storage)),a.sha256,a.fileSize);if(a.artifactType!=='final_render')files.set(a.artifactType,bytes);}
 if(!coverImageExtension(files.get('cover')!))throw Error('封面文件无效。');
 await promisify(execFile)('ffmpeg',['-nostdin','-v','error','-i',await assetPath(root,episodeId,m.artifacts.find(a=>a.artifactType==='cover')!.relativePath,storage),'-frames:v','1','-f','null','-'],{timeout:30000,maxBuffer:1024*1024});
 const project=JSON.parse(files.get('editable_project')!.toString());if(project.version!==3||!Array.isArray(project.timelines)||!project.timelines.length||!Array.isArray(project.assets)||!project.timelines.some((t:{id:string})=>t.id===project.activeTimelineId))throw Error('完整可编辑工程无效。');
 const metadata=JSON.parse(files.get('metadata')!.toString());if(typeof metadata.title!=='string'||!metadata.title.trim()||typeof metadata.description!=='string'||!Array.isArray(metadata.tags)||!Array.isArray(metadata.narration)||metadata.exportId!==id.exportId||metadata.contentSha256!==id.contentSha256)throw Error('交付元数据不完整或身份不一致。');
 const report=JSON.parse(files.get('final_qc_report')!.toString());if(report.passed!==true||report.exportId!==id.exportId||report.contentSha256!==id.contentSha256||!Array.isArray(report.checks)||!report.checks.length||report.checks.some((c:{passed:boolean})=>c.passed!==true))throw Error('交付检查证据无效。');
 for(const check of report.checks){for(const source of check.sources??[])await verifyNativeFile(root,relative(root,await assetPath(root,episodeId,source.relativePath,storage)),source.sha256,source.fileSize);if(check.artifact)await verifyNativeFile(root,relative(root,await assetPath(root,episodeId,check.artifact.relativePath,storage)),check.artifact.sha256,check.artifact.fileSize);}
}
function same(a:ArtifactManifest|undefined,b:ArtifactManifest){return !!a&&!!b&&a.relativePath===b.relativePath&&a.sha256===b.sha256&&a.fileSize===b.fileSize&&a.artifactType===b.artifactType;}
