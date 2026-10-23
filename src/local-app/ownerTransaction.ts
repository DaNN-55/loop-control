import type {Pool,PoolClient} from 'pg';
export async function ownerTransaction<T>(pool:Pool,ownerId:string,readOnly:boolean,run:(client:PoolClient)=>Promise<T>):Promise<T>{
 const client=await pool.connect();
 try{
  await client.query(readOnly?'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY':'BEGIN');
  await client.query("SELECT set_config('loop.owner_id',$1,true)",[ownerId]);
  const result=await run(client);await client.query('COMMIT');return result;
 }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
