import{episodeSourceRoot}from'./location-lineage.mjs';
import{join}from'node:path';
import{hasActiveNativeStudio}from'../../dist/local-app/worker/openchatcutStudio.js';
import{mappedAssetPath}from'../../src/local-app/mediaPaths.ts';
const quote=value=>"'"+value.replaceAll("'","''")+"'";
/** Reuse persistent operation states and the existing task/paid/native guards. */
export async function assertStorageUnoccupied(database,mediaRoot,sourceRoots,runtime){
 const query=text=>runtime.sql(text,database);
 for(const[table,predicate]of[['account_creation_intents','result IS NULL'],['container_creation_intents','result IS NULL'],['episode_creation_intents','result IS NULL'],['episode_deletion_intents',"state IN ('prepared','committed')"],['account_directory_migrations',"status IN ('planned','copying','failed')"],['media_root_migrations',"status IN ('copying','failed','committed')"]]){
  if(query(`SELECT to_regclass('local_identity.${table}') IS NOT NULL`)==='t'&&query(`SELECT count(*) FROM local_identity.${table} WHERE ${predicate}`)!=='0')throw Error('Storage occupied by an unfinished '+table);
 }
 if(query("SELECT to_regprocedure('local_identity.account_directory_busy(uuid)') IS NOT NULL")==='t'){
  const accounts=JSON.parse(query("SELECT coalesce(jsonb_agg(jsonb_build_object('id',a.id,'owner',m.user_id)),'[]') FROM public.accounts a JOIN public.account_memberships m ON m.account_id=a.id AND m.role='owner'"));
  for(const account of accounts){const busy=JSON.parse(query(`SET SESSION AUTHORIZATION loop_app;DO $$BEGIN PERFORM set_config('loop.owner_id',${quote(account.owner)},false);END$$;SELECT local_identity.account_directory_busy(${quote(account.id)}::uuid)`));if(busy.length)throw Error('Storage occupied: '+busy.map(row=>row.reason).join(' '));}
 }
 const registered=query("SELECT to_regprocedure('local_identity.episode_storage_location(uuid)') IS NOT NULL")==='t';
 const episodes=JSON.parse(query(`SELECT coalesce(jsonb_agg(jsonb_build_object('id',e.id,'root',local_identity.episode_asset_root(e.id),'prefix',${registered?'l.directory_relative_path':"'episodes/'||e.id::text"})),'[]') FROM public.episodes e ${registered?'CROSS JOIN LATERAL local_identity.episode_storage_location(e.id) l':''}`));
 for(const episode of episodes)if(await hasActiveNativeStudio(episodeSourceRoot(mediaRoot,episode.root,sourceRoots),episode.id,episode.prefix))throw Error('Storage occupied by an active native Studio');
}

/** A backup must not turn replaced source directories into new restore authority. */
export async function assertStorageSourceIdentity(database,mediaRoot,sourceRoots,runtime){
 const query=text=>runtime.sql(text,database),{inspectMediaRoot,verifyMediaRootBinding}=await import('../../dist/local-app/local-app/mediaRootSettings.js');
 if(query("SELECT to_regclass('local_identity.media_root_binding') IS NOT NULL")==='t'){
  const binding=JSON.parse(query("SELECT coalesce(local_identity.media_root_binding(),'null'::jsonb)"));if(binding){if(binding.path!==mediaRoot)throw Error('Source media binding differs from backup root');await verifyMediaRootBinding(binding);}
 }
 const accounts=JSON.parse(query("SELECT coalesce(jsonb_agg(jsonb_build_object('id',account_id,'root',actual_root,'device',device_id,'inode',inode_id)),'[]') FROM local_identity.account_asset_directories")),roots=new Map();
 const verify=async(path,device,inode)=>{const actual=await inspectMediaRoot(path);if(actual.deviceId!==device||actual.inodeId!==inode)throw Error('Source directory identity changed');};
 for(const account of accounts){const path=mappedAssetPath(mediaRoot,account.root,sourceRoots);await verify(path,account.device,account.inode);roots.set(account.id,path);}
 if(query("SELECT to_regclass('local_identity.account_storage_containers') IS NOT NULL")==='t')for(const entry of JSON.parse(query("SELECT coalesce(jsonb_agg(jsonb_build_object('account',account_id,'path',directory_relative_path,'device',device_id,'inode',inode_id)),'[]') FROM local_identity.account_storage_containers"))){const root=roots.get(entry.account);if(!root)throw Error('Container source account identity missing');await verify(join(root,entry.path),entry.device,entry.inode);}
 if(query("SELECT to_regprocedure('local_identity.episode_storage_location(uuid)') IS NOT NULL")==='t')for(const entry of JSON.parse(query("SELECT coalesce(jsonb_agg(jsonb_build_object('root',local_identity.episode_asset_root(episode_id),'path',directory_relative_path,'device',directory_device_id,'inode',directory_inode_id)),'[]') FROM local_identity.episode_asset_locations WHERE directory_device_id IS NOT NULL"))){await verify(join(episodeSourceRoot(mediaRoot,entry.root,sourceRoots),entry.path),entry.device,entry.inode);}
}
