import type {PoolClient} from 'pg';
import {access,lstat,readdir,realpath} from 'node:fs/promises';
import {constants} from 'node:fs';
import {isAbsolute,relative,resolve} from 'node:path';
import {ConfigurationError} from './configurationCommands.js';
import {mappedAssetPath,assetPathWithin} from './mediaPaths.js';
import {readMediaDeployment,resolveLocalAssetRoot} from './mediaDeployment.js';
import {resolveEpisodeStorageLocation} from './episodeStorageLocation.js';
export const accountAssetRootsOverlap=(a:string,b:string)=>a===b||assetPathWithin(a,b)||assetPathWithin(b,a);
export async function validateAccountAssetLocation(c:Pick<PoolClient,'query'>,mediaRoot:string,path:unknown){
 if(typeof path!=='string'||!path.trim()||path.length>4096||!isAbsolute(path)||resolve(path)!==path)throw new ConfigurationError(400,'请填写已授权范围内的实际目录。');
 const rel=relative(mediaRoot,path);
 if(!assetPathWithin(mediaRoot,path)||['openchatcut','.loop-control','.deletion-staging'].includes(rel.split('/')[0]))throw new ConfigurationError(400,'请选择本机媒体授权根内的独立账号目录，不能使用平台目录。');
 const actual=await resolveLocalAssetRoot(c,mediaRoot,path);
 if(actual!==path)throw new ConfigurationError(400,'请选择实际目录，不能使用部署别名。');
 try{await access(path,constants.R_OK|constants.W_OK|constants.X_OK);}catch{throw new ConfigurationError(409,'账号目录不可读写，请恢复挂载或权限。');}
 const stat=await lstat(path,{bigint:true});
 if(path.startsWith('/Volumes/')){const volume=path.split('/').slice(0,3).join('/');if((await lstat(volume)).dev===(await lstat('/Volumes')).dev)throw new ConfigurationError(409,'账号所在外部盘尚未挂载。');}
 return{path,device:String(stat.dev),inode:String(stat.ino)};
}
export async function requireAccountAssetRoot(c:Pick<PoolClient,'query'>,mediaRoot:string,accountId:string){
 const row=(await c.query('SELECT * FROM local_identity.account_asset_directories WHERE account_id=$1',[accountId])).rows[0];
 if(!row)throw new ConfigurationError(409,'请先在账号配置中设置实际专属目录。');
 if((await c.query("SELECT 1 FROM local_identity.account_directory_migrations WHERE account_id=$1 AND status='copying'",[accountId])).rowCount)throw new ConfigurationError(409,'账号目录正在迁移，请完成或恢复迁移后继续制作。');
 const valid=await validateAccountAssetLocation(c,mediaRoot,row.actual_root);
 if(valid.device!==row.device_id||valid.inode!==row.inode_id)throw new ConfigurationError(409,'账号目录所在位置已变化，请检查挂载或通过目录迁移恢复。');
 return valid.path;
}
export async function readAccountAssetDirectory(c:Pick<PoolClient,'query'>,mediaRoot:string,accountId:string){
 const row=(await c.query('SELECT actual_root FROM local_identity.account_asset_directories WHERE account_id=$1',[accountId])).rows[0];
 const sources=await readMediaDeployment(c,mediaRoot),legacy=(await c.query("SELECT DISTINCT policy->>'asset_root' root FROM public.account_blueprint_versions WHERE account_id=$1 AND coalesce(policy->>'asset_root','')<>'' UNION SELECT asset_root root FROM local_identity.episode_asset_locations WHERE account_id=$1",[accountId])).rows;
 const roots=[...new Set(legacy.map(r=>{try{return mappedAssetPath(mediaRoot,r.root,sources);}catch{return r.root;}}))] as string[];
 if(row){try{await requireAccountAssetRoot(c,mediaRoot,accountId);return{assetRoot:row.actual_root,legacyRoots:roots,status:'ready'};}catch(error){return{assetRoot:row.actual_root,legacyRoots:roots,status:'unavailable',reason:error instanceof Error?error.message:'目录不可用。'};}}
 return{assetRoot:null,legacyRoots:roots,status:roots.length>1?'conflict':'unset',reason:roots.length>1?'存在多个历史目录，请先盘点并通过目录迁移接管。':'请设置账号实际专属目录。'};
}
export async function setAccountAssetDirectory(c:Pick<PoolClient,'query'>,mediaRoot:string,accountId:string,path:unknown){
 // Serialize all account claims, including accounts hidden by the current Owner's RLS.
 await c.query("SELECT pg_advisory_xact_lock(hashtextextended('account-asset-root-ownership',0))");
 const valid=await validateAccountAssetLocation(c,mediaRoot,path),state=await readAccountAssetDirectory(c,mediaRoot,accountId);
 const claims=(await c.query('SELECT * FROM local_identity.account_asset_root_claims()')).rows,sources=await readMediaDeployment(c,mediaRoot);
 for(const claim of claims){if(claim.account_id===accountId)continue;let other:string;try{other=mappedAssetPath(mediaRoot,claim.asset_root,sources);}catch{other=claim.asset_root;}other=await realpath(other).catch(()=>other);if(accountAssetRootsOverlap(valid.path,other))throw new ConfigurationError(409,'该目录与其他账号的目录重叠，请选择独立位置。');}
 if(state.assetRoot===valid.path&&state.status==='unavailable')throw new ConfigurationError(409,state.reason??'目录身份已变化，请通过目录迁移恢复。');
 if(state.assetRoot&&state.assetRoot!==valid.path){const old=await resolveLocalAssetRoot(c,mediaRoot,state.assetRoot);if((await readdir(old)).length||state.legacyRoots.some(r=>r!==valid.path))throw new ConfigurationError(409,'已有文件或历史位置的账号必须通过目录迁移更换位置。');}
 if(!state.assetRoot&&state.legacyRoots.length&&(state.legacyRoots.length!==1||state.legacyRoots[0]!==valid.path))throw new ConfigurationError(409,'请接管明确的当前实际目录；其他位置须通过目录迁移。');
 await c.query('INSERT INTO local_identity.account_asset_directories(account_id,actual_root,device_id,inode_id) VALUES($1,$2,$3,$4) ON CONFLICT(account_id) DO UPDATE SET actual_root=excluded.actual_root,device_id=excluded.device_id,inode_id=excluded.inode_id,updated_at=clock_timestamp()',[accountId,valid.path,valid.device,valid.inode]);
 return readAccountAssetDirectory(c,mediaRoot,accountId);
}
export async function resolveEpisodeAssetRoot(c:Pick<PoolClient,'query'>,mediaRoot:string,episodeId:string){
 return(await resolveEpisodeStorageLocation(c,mediaRoot,episodeId)).assetRoot;
}
