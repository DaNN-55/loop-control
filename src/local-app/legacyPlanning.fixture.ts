import type {Client,PoolClient} from 'pg';

/** Seed a historical model task without sending a new production order through the retired entry point. */
export async function seedLegacyPlanning(f:{c:Client|PoolClient;owner:string},episodeId:string,scriptId:string){
 await f.c.query('BEGIN');
 try{
  await f.c.query("SELECT set_config('loop.owner_id',$1,true)",[f.owner]);
  await f.c.query('SET LOCAL SESSION AUTHORIZATION loop_app');
  const result=await f.c.query('SELECT local_identity.queue_workspace_planning($1,$2) task_id',[episodeId,scriptId]);
  await f.c.query('COMMIT');
  return {taskId:result.rows[0].task_id};
 }catch(error){await f.c.query('ROLLBACK');throw error;}
}
