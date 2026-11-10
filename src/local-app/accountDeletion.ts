import type {Pool,PoolClient} from 'pg';
import type {AccountDeletionStatus} from '../accounts/accountDeletionStatus.js';
import {ownerTransaction} from './ownerTransaction.js';

// The delete command and its read-only preview share the same pending-operation boundary.
export async function accountDeletionOperations(client:PoolClient,accountId:string){
 const {rows:[row]}=await client.query<{creationCount:number;deletionCount:number;cleanupKey:string|null}>(`
 SELECT count(*) FILTER(WHERE kind='creation')::int "creationCount",
 count(*) FILTER(WHERE kind='deletion')::int "deletionCount",
 min(key) FILTER(WHERE kind='deletion') "cleanupKey" FROM (
 SELECT 'creation' kind,NULL::text key FROM local_identity.episode_creation_intents WHERE account_id=$1 AND result IS NULL
 UNION ALL SELECT 'creation',NULL FROM local_identity.container_creation_intents WHERE account_id=$1 AND result IS NULL
 UNION ALL SELECT 'creation',NULL FROM local_identity.account_creation_intents WHERE account_id=$1 AND result IS NULL
 UNION ALL SELECT 'deletion',idempotency_key::text FROM local_identity.episode_deletion_intents WHERE manifest->>'accountId'=$1::text AND state IN ('prepared','committed')
 ) pending`,[accountId]);return row;
}
export async function readAccountDeletionStatus(pool:Pool,ownerId:string,accountId:string):Promise<AccountDeletionStatus|null>{
 return ownerTransaction(pool,ownerId,true,async client=>{
  const owned=await client.query("SELECT 1 FROM public.accounts a JOIN public.account_memberships m ON m.account_id=a.id WHERE a.id=$1 AND m.user_id=$2 AND m.role='owner'",[accountId,ownerId]);
  if(!owned.rowCount)return null;
  const {rows:[episodes]}=await client.query<{episodeCount:number;archivedEpisodeCount:number}>('SELECT count(*)::int "episodeCount",count(*) FILTER(WHERE archived_at IS NOT NULL)::int "archivedEpisodeCount" FROM public.episodes WHERE account_id=$1',[accountId]);
  return {...episodes,...await accountDeletionOperations(client,accountId)};
 });
}
