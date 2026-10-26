import type {Pool,PoolClient} from 'pg';
import {tokenHash,type OwnerSession} from './sessions.js';
export async function ownerTransaction<T>(pool:Pool,ownerId:string,readOnly:boolean,run:(client:PoolClient)=>Promise<T>):Promise<T>{
 const client=await pool.connect();
 try{
  await client.query(readOnly?'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY':'BEGIN');
  await client.query("SELECT set_config('loop.owner_id',$1,true)",[ownerId]);
  const result=await run(client);await client.query('COMMIT');return result;
 }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
export function sessionTransaction<T>(pool:Pool,session:OwnerSession,run:(client:PoolClient)=>Promise<T>):Promise<T>{
 return ownerTransaction(pool,session.id,false,async client=>{
  const valid=await client.query('SELECT token_hash FROM local_identity.sessions WHERE token_hash=$1 AND owner_id=$2 AND revoked_at IS NULL AND expires_at>clock_timestamp() FOR SHARE',[tokenHash(session.token),session.id]);
  if(!valid.rowCount)throw Object.assign(new Error('会话已失效。'),{status:401});
  return run(client);
 });
}
