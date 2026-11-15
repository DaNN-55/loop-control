import {isDeepStrictEqual} from 'node:util';
import type {PoolClient} from 'pg';
import {verifyEpisodeFile} from './episodeFiles.js';
import {ConfigurationError} from './configurationCommands.js';

interface PreparationRegistration {
 episodeId:string;
 scriptRevisionId:string;
 preparationRevisionId:string;
 file:{relativePath:string;sha256:string;fileSize:number};
 manifest:unknown;
}

/** Verify host-owned files before entering the private PostgreSQL persistence boundary. */
export async function registerProductionPreparation(c:PoolClient,root:string,input:PreparationRegistration):Promise<string>{
 await verifyProductionPreparationDocument(c,root,input.episodeId,input.file,input.manifest);
 return(await c.query('SELECT local_identity.register_production_preparation($1,$2,$3,$4,$5) id',[input.episodeId,input.scriptRevisionId,input.preparationRevisionId,input.file,input.manifest])).rows[0].id;
}

export async function verifyProductionPreparationDocument(c:PoolClient,root:string,episodeId:string,file:PreparationRegistration['file'],expected:unknown,label='制作基准'){
 let bytes:Buffer;
 try{bytes=await verifyEpisodeFile(c,root,episodeId,file.relativePath,file.sha256,file.fileSize);}
 catch(error){
  if((error as NodeJS.ErrnoException).code==='ENOENT')throw new ConfigurationError(409,`${label}文件缺失，请恢复原文件后重试。`);
  if(['EACCES','EPERM','EIO','ENOTDIR'].includes((error as NodeJS.ErrnoException).code??''))throw new ConfigurationError(409,`${label}文件无法读取，请恢复权限或挂载后重试。`);
  throw error;
 }
 let document:unknown;
 try{document=JSON.parse(bytes.toString('utf8'));}catch{throw new ConfigurationError(409,`${label}文件格式无效，未登记此版本。`);}
 if(!isDeepStrictEqual(document,expected))throw new ConfigurationError(409,`${label}声明与文件内容不一致，未登记此版本。`);
}

/** Versioned import: retain the source bytes and verify them before adopting old coordinates. */
export async function adoptProductionPreparation(c:PoolClient,root:string,episodeId:string,scriptRevisionId:string,sourceId:string):Promise<string>{
 const source=(await c.query('SELECT p.context_snapshot,a.relative_path,a.sha256,a.file_size FROM public.review_packages p JOIN public.artifacts a ON a.id=p.artifact_id AND a.episode_id=p.episode_id WHERE p.id=$1 AND p.episode_id=$2',[sourceId,episodeId])).rows[0];
 if(!source)throw new ConfigurationError(409,'原制作基准缺少同单文件来源，未接入此版本。');
 const recorded=source.context_snapshot?.worker_result?.storyboard??source.context_snapshot?.storyboard;
 await verifyProductionPreparationDocument(c,root,episodeId,{relativePath:source.relative_path,sha256:source.sha256,fileSize:Number(source.file_size)},recorded,'原制作基准');
 return(await c.query('SELECT local_identity.adopt_production_preparation($1,$2,$3) id',[episodeId,scriptRevisionId,sourceId])).rows[0].id;
}

/** Offline SQL import preserves declarations. Every current use verifies the frozen host source. */
export async function verifyProductionPreparationSource(c:PoolClient,root:string,episodeId:string,preparationId:string){
 const source=(await c.query('SELECT file_reference,source_format,manifest,source_evidence FROM local_identity.production_preparation_revisions WHERE id=$1 AND episode_id=$2',[preparationId,episodeId])).rows[0];
 if(!source?.file_reference)throw new ConfigurationError(409,'制作基准缺少可核对的文件来源。');
 let expected:unknown;
 if(source.source_format==='production-preparation/v1')expected=source.manifest;
 else if(source.source_format==='storyboard/v1')expected=source.source_evidence?.package?.context_snapshot?.worker_result?.storyboard??source.source_evidence?.package?.context_snapshot?.storyboard;
 else throw new ConfigurationError(409,'制作基准格式尚未接入，请核对原版本。');
 if(!expected)throw new ConfigurationError(409,'制作基准缺少可核对的冻结内容。');
 await verifyProductionPreparationDocument(c,root,episodeId,source.file_reference,expected);
}
