import type {PoolClient} from 'pg';
/** Only isolated pre-108 history seeds bypass the new-write projection. */
export async function insertHistoricalBlueprint(c:PoolClient,id:string,account:string,version:number,policy:Record<string,unknown>){
 await c.query('BEGIN');
 try{
  await c.query('ALTER TABLE public.account_blueprint_versions DISABLE TRIGGER a_blueprint_creative_write');
  await c.query('INSERT INTO public.account_blueprint_versions(id,account_id,version,policy,is_active) VALUES($1,$2,$3,$4,false)',[id,account,version,policy]);
  await c.query('ALTER TABLE public.account_blueprint_versions ENABLE TRIGGER a_blueprint_creative_write');
  await c.query('COMMIT');
 }catch(error){await c.query('ROLLBACK');throw error;}
}
