import{hasActiveNativeStudio}from'../../dist/local-app/worker/openchatcutStudio.js';
import{mappedAssetPath}from'../../src/local-app/mediaPaths.ts';
const quote=value=>"'"+value.replaceAll("'","''")+"'";
/** Reuse persistent operation states and the existing task/paid/native guards. */
export async function assertStorageUnoccupied(database,mediaRoot,sourceRoots,runtime){
 const query=text=>runtime.sql(text,database);
 for(const[table,predicate]of[['account_creation_intents','result IS NULL'],['container_creation_intents','result IS NULL'],['episode_deletion_intents',"state IN ('prepared','committed')"],['account_directory_migrations',"status IN ('planned','copying','failed')"]]){
  if(query(`SELECT to_regclass('local_identity.${table}') IS NOT NULL`)==='t'&&query(`SELECT count(*) FROM local_identity.${table} WHERE ${predicate}`)!=='0')throw Error('Storage occupied by an unfinished '+table);
 }
 if(query("SELECT to_regprocedure('local_identity.account_directory_busy(uuid)') IS NOT NULL")==='t'){
  const accounts=JSON.parse(query("SELECT coalesce(jsonb_agg(jsonb_build_object('id',a.id,'owner',m.user_id)),'[]') FROM public.accounts a JOIN public.account_memberships m ON m.account_id=a.id AND m.role='owner'"));
  for(const account of accounts){const busy=JSON.parse(query(`SET SESSION AUTHORIZATION loop_app;DO $$BEGIN PERFORM set_config('loop.owner_id',${quote(account.owner)},false);END$$;SELECT local_identity.account_directory_busy(${quote(account.id)}::uuid)`));if(busy.length)throw Error('Storage occupied: '+busy.map(row=>row.reason).join(' '));}
 }
 const registered=query("SELECT to_regprocedure('local_identity.episode_storage_location(uuid)') IS NOT NULL")==='t';
 const episodes=JSON.parse(query(`SELECT coalesce(jsonb_agg(jsonb_build_object('id',e.id,'root',local_identity.episode_asset_root(e.id),'prefix',${registered?'l.directory_relative_path':"'episodes/'||e.id::text"})),'[]') FROM public.episodes e ${registered?'CROSS JOIN LATERAL local_identity.episode_storage_location(e.id) l':''}`));
 for(const episode of episodes)if(await hasActiveNativeStudio(mappedAssetPath(mediaRoot,episode.root,sourceRoots),episode.id,episode.prefix))throw Error('Storage occupied by an active native Studio');
}
