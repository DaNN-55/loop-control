import type{Pool,PoolClient}from'pg';
import{nativeAssetRoot}from'./localFiles.js';
import{ConfigurationError}from'./configurationCommands.js';
export async function readMediaDeployment(client:Pick<Pool|PoolClient,'query'>,mediaRoot:string):Promise<string[]>{
 const row=(await client.query("SELECT local_identity.media_deployment() config,coalesce(nullif(current_setting('loop.restore_state',true),''),'ready') state")).rows[0];
 if(row?.state!=='ready')throw new ConfigurationError(503,'恢复尚未完成，请先检查恢复回执。');const r=row.config;
 if(!r||r.targetRoot!==null&&r.targetRoot!==mediaRoot||!Array.isArray(r.sourceRoots)||r.sourceRoots.some((v:unknown)=>typeof v!=='string'))throw new ConfigurationError(503,'服务媒体目录与恢复部署不匹配。');
 return r.sourceRoots;
}
export async function resolveLocalAssetRoot(client:Pick<Pool|PoolClient,'query'>,mediaRoot:string,value:unknown){return nativeAssetRoot(mediaRoot,value,await readMediaDeployment(client,mediaRoot));}
