import {ownerTransaction} from './ownerTransaction.js';
import {Pool, type PoolConfig} from 'pg';
import type {Database} from '../lib/database.types.js';
type Row<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Row'];
export interface LocalCatalog {
 accounts: Row<'accounts'>[];
 blueprints: Row<'account_blueprint_versions'>[];
 episodes: Row<'episodes'>[];
 series: Row<'series'>[];
 seriesVersions: Row<'series_versions'>[];
 promptVersions: Row<'prompt_versions'>[];
 blueprintRevisions:Record<string,string>;
 importedAt: string;
 sourceCreatedAt: string;
}
export function createLocalDatabase(config:PoolConfig){
 if(config.host!=='127.0.0.1' || config.user!=='loop_app')throw Error('Local database requires loopback and least-privilege app role');
 if(Object.keys(config).some(k=>!['host','port','user','database','password'].includes(k)))throw Error('Unsupported local database option');
 if(!Number.isInteger(config.port)||(config.port??0)<1||(config.port??0)>65535||typeof config.password!=='string'||!config.password||typeof config.database!=='string')throw Error('Incomplete local database configuration');
 const pool=new Pool({host:config.host,port:config.port,user:config.user,database:config.database,password:config.password,max:4,connectionTimeoutMillis:3000,idleTimeoutMillis:10000});
 // Idle connection failures are removed by pg; request queries retain their
 // normal error path, without an unhandled event dumping a private pg client.
 pool.on('error',()=>{});
 return pool;
}
export async function readLocalCatalog(pool:Pool,ownerId:string):Promise<LocalCatalog>{
 return ownerTransaction(pool,ownerId,true,async client=>{
  const accounts=(await client.query(`SELECT a.* FROM public.accounts a JOIN public.account_memberships m ON m.account_id=a.id WHERE m.user_id=$1 AND m.role='owner' ORDER BY a.created_at,a.id`,[ownerId])).rows;
  const ids=accounts.map(a=>a.id);
  const blueprints=(await client.query('SELECT * FROM public.account_blueprint_versions WHERE account_id=ANY($1::uuid[]) ORDER BY version DESC,id',[ids])).rows;
  const episodes=(await client.query('SELECT *,tts_speaking_rate::double precision AS tts_speaking_rate FROM public.episodes WHERE account_id=ANY($1::uuid[]) ORDER BY updated_at DESC,id',[ids])).rows;
  const series=(await client.query('SELECT * FROM public.series WHERE account_id=ANY($1::uuid[]) ORDER BY name,id',[ids])).rows;
  const seriesVersions=(await client.query('SELECT * FROM public.series_versions WHERE account_id=ANY($1::uuid[]) ORDER BY version DESC,id',[ids])).rows;
  const promptVersions=(await client.query('SELECT * FROM public.prompt_versions WHERE account_id=ANY($1::uuid[]) ORDER BY capability,version DESC,id',[ids])).rows;
  const revisions=(await client.query('SELECT id,md5(policy::text) revision FROM public.account_blueprint_versions WHERE account_id=ANY($1::uuid[])',[ids])).rows;
  const {rows:[record]}=await client.query('SELECT imported_at,source_created_at FROM local_identity.import_record');
  if(!record)throw Error('Local import is not verified');
  return {accounts,blueprints,episodes,series,seriesVersions,promptVersions,blueprintRevisions:Object.fromEntries(revisions.map(r=>[r.id,r.revision])),importedAt:record.imported_at.toISOString(),sourceCreatedAt:record.source_created_at.toISOString()};
 });
}
