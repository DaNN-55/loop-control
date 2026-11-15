import type {Pool,PoolClient} from 'pg';
import {isBusinessQualityTier,type ProductionQuality} from '../productionQuality.js';
import {ConfigurationError} from './configurationCommands.js';
import {ownerTransaction} from './ownerTransaction.js';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** An uninstalled or explicitly disabled metrics schema must preserve old behavior. */
export async function productionMetricsEnabled(c:PoolClient):Promise<boolean>{
 if(!(await c.query("SELECT to_regprocedure('local_identity.production_metrics_enabled()') IS NOT NULL present")).rows[0]?.present)return false;
 return(await c.query('SELECT local_identity.production_metrics_enabled() enabled')).rows[0]?.enabled===true;
}
export async function readProductionQuality(pool:Pool,ownerId:string,episodeId:string):Promise<ProductionQuality>{
 if(!uuid.test(episodeId))throw new ConfigurationError(400,'生产单标识无效。');
 return ownerTransaction(pool,ownerId,true,async c=>{
  if(!(await c.query("SELECT 1 FROM public.episodes e JOIN public.account_memberships m ON m.account_id=e.account_id WHERE e.id=$1 AND m.user_id=$2 AND m.role='owner'",[episodeId,ownerId])).rowCount)throw new ConfigurationError(404,'生产单不可见。');
  if(!await productionMetricsEnabled(c))return{enabled:false,tier:'unspecified',revision:0};
  return{enabled:true,...(await c.query('SELECT local_identity.episode_business_quality($1) quality',[episodeId])).rows[0].quality};
 });
}
export async function setProductionQuality(c:PoolClient,episodeId:unknown,tier:unknown,expectedRevision:unknown){
 if(typeof episodeId!=='string'||!uuid.test(episodeId)||!isBusinessQualityTier(tier)||!Number.isSafeInteger(expectedRevision)||Number(expectedRevision)<0)throw new ConfigurationError(400,'业务质量档或版本无效。');
 if(!await productionMetricsEnabled(c))throw new ConfigurationError(409,'生产统计采集尚未启用。');
 try{return(await c.query('SELECT local_identity.set_episode_business_quality($1,$2,$3) quality',[episodeId,tier,expectedRevision])).rows[0].quality as Omit<ProductionQuality,'enabled'>;}
 catch(error){if((error as {code?:string}).code==='40001')throw new ConfigurationError(409,'业务质量档已变化，请重新打开生产单后核对。');if((error as {code?:string}).code==='55000')throw new ConfigurationError(409,'此生产单当前只读，业务质量档未更改。');throw error;}
}
