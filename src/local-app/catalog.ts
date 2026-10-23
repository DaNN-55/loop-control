import {Pool, type PoolConfig} from 'pg';
import type {Database} from '../lib/database.types.js';
type Row<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Row'];
export interface LocalCatalog {
 accounts: Row<'accounts'>[];
 blueprints: Row<'account_blueprint_versions'>[];
 episodes: Row<'episodes'>[];
 series: Row<'series'>[];
 seriesVersions: Row<'series_versions'>[];
 importedAt: string;
 sourceCreatedAt: string;
}
export function createLocalDatabase(config:PoolConfig){
 if(config.host!=='127.0.0.1' || config.user!=='loop_app')throw Error('Local database requires loopback and least-privilege app role');
 if(Object.keys(config).some(k=>!['host','port','user','database','password'].includes(k)))throw Error('Unsupported local database option');
 if(!Number.isInteger(config.port)||(config.port??0)<1||(config.port??0)>65535||typeof config.password!=='string'||!config.password||typeof config.database!=='string')throw Error('Incomplete local database configuration');
 return new Pool({host:config.host,port:config.port,user:config.user,database:config.database,password:config.password,max:4,connectionTimeoutMillis:3000,idleTimeoutMillis:10000});
}
export async function readLocalCatalog(pool:Pool,ownerId:string):Promise<LocalCatalog>{
 const client=await pool.connect();
 try{
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  await client.query("SELECT set_config('loop.owner_id',$1,true)",[ownerId]);
  const accounts=(await client.query(`SELECT a.* FROM public.accounts a JOIN public.account_memberships m ON m.account_id=a.id WHERE m.user_id=$1 AND m.role='owner' ORDER BY a.created_at,a.id`,[ownerId])).rows;
  const ids=accounts.map(a=>a.id);
  const blueprints=(await client.query('SELECT * FROM public.account_blueprint_versions WHERE account_id=ANY($1::uuid[]) ORDER BY version DESC,id',[ids])).rows;
  const episodes=(await client.query('SELECT *,tts_speaking_rate::double precision AS tts_speaking_rate FROM public.episodes WHERE account_id=ANY($1::uuid[]) ORDER BY updated_at DESC,id',[ids])).rows;
  const series=(await client.query('SELECT * FROM public.series WHERE account_id=ANY($1::uuid[]) ORDER BY name,id',[ids])).rows;
  const seriesVersions=(await client.query('SELECT * FROM public.series_versions WHERE account_id=ANY($1::uuid[]) ORDER BY version DESC,id',[ids])).rows;
  const {rows:[record]}=await client.query('SELECT imported_at,source_created_at FROM local_identity.import_record');
  if(!record)throw Error('Local import is not verified');
  await client.query('COMMIT');
  return {accounts,blueprints,episodes,series,seriesVersions,importedAt:record.imported_at.toISOString(),sourceCreatedAt:record.source_created_at.toISOString()};
 }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
