import {readMediaRootAuthorization,readPendingMediaRootDeployment,recoverMediaRootDeployment,migrationProofQuery,verifyMediaRootMigrationProof} from './media-root.mjs';
import{createDatabaseRuntime,validateNativePostgres}from'./database-runtime.mjs';
import{readFileSync,lstatSync,realpathSync,mkdirSync,writeFileSync,existsSync}from'node:fs';
import{fileURLToPath}from'node:url';import{join,relative,isAbsolute,dirname,resolve}from'node:path';
import{hydrateDeploymentSecrets,keychainState}from'./keychain.mjs';
import{runtimeLogBinding}from'./log-storage.mjs';
export const projectRoot=realpathSync(fileURLToPath(new URL('../../',import.meta.url))),root=join(projectRoot,'.loop-control/local');
export function assertPrivatePath(path){const rel=relative(root,resolve(path));if(rel.startsWith('..')||isAbsolute(rel))throw Error('Runtime path leaves local directory');let p=resolve(path);while(p!==projectRoot){if(existsSync(p)){const s=lstatSync(p);if(s.isSymbolicLink()||s.uid!==process.getuid?.()||p!==dirname(root)&&(s.mode&0o077)!==0)throw Error('Runtime path must be private and owned');}p=dirname(p);}}
export function ensurePrivateDirectory(path){assertPrivatePath(path);mkdirSync(path,{recursive:true,mode:0o700});assertPrivatePath(path);}
export function writePrivateFile(path,value,{exclusive=false}={}){ensurePrivateDirectory(dirname(path));writeFileSync(path,value,{mode:0o600,...(exclusive?{flag:'wx'}:{})});}
export const deploymentFile=()=>join(root,'deployment.json');
export function validateSettings(d){if(d.storageOwnerId!==undefined&&!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(d.storageOwnerId))throw Error('Invalid storage Owner binding');if(d.secretAdministration!==undefined&&(!d.secretAdministration||Object.keys(d.secretAdministration).some(k=>k!=='adminOwnerId')||!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(d.secretAdministration.adminOwnerId??'')))throw Error('Invalid secret administrator configuration');if(d.version!==1||d.purpose!=='local-daily'||d.projectRoot!==projectRoot||d.runtimeRoot!==root)throw Error('Daily runtime identity mismatch');if(d.postgres?.kind==='native')validateNativePostgres(d.postgres,root);else if(![undefined,'container'].includes(d.postgres?.kind)||d.postgres?.profile!=='loop-control'||d.postgres.container!=='loop-control-local-postgres'||d.postgres.volume!=='loop-control-local-data'||d.postgres.image!=='sha256:00bc86618629af00d2937fdc5a5d63db3ff8450acf52f0636ec813c7f4902929')throw Error('Daily runtime identity mismatch');return d;}
export function readSettings(){const path=deploymentFile();assertPrivatePath(path);return validateSettings(JSON.parse(readFileSync(path)));}
export function runtimeContext(settings=readSettings(),{operations}={}){const d=validateSettings(settings),database=createDatabaseRuntime(d,{projectRoot,root,ensurePrivateDirectory,operations});return{dailyRuntime:true,projectRoot,root,...database,ensurePrivateDirectory,database:d.database.database,mediaRoot:d.mediaRoot,deployment:d};}
export function validateDeployment(d){validateSettings(d);if(!Number.isInteger(d.port)||d.port<1024||d.port>65535)throw Error('Invalid app port');
 for(const[key,user]of[['database','loop_app'],['workerDatabase','loop_worker']]){const c=d[key];if(c?.host!=='127.0.0.1'||c.port!==(d.postgres.kind==='native'?d.postgres.port:54329)||c.database!=='loop_control'||c.user!==user||typeof c.password!=='string'||!c.password||Object.keys(c).some(k=>!['host','port','database','user','password'].includes(k)))throw Error('Daily database binding mismatch');}
 if((d.mediaRootBinding?(d.mediaRoot!==d.mediaRootBinding.path||d.worker.mountPath!==d.mediaRootBinding.mountPath):(d.mediaRoot!==join(root,'volume/media')||d.worker.mountPath!==join(root,'volume')))||d.backupRoot!==join(root,'backups/loop_control')||d.openChatCut.root!==join(root,'OpenChatCut')||d.openChatCut.port!==5175||d.connections?.keychain?.runtimeRoot!==root)throw Error('Daily capabilities mismatch');
return d;}
/** The same pre-hydration storage admission is usable by isolated native
 * deployments without invoking the daily reader, container or Keychain. */
export function recoverDeploymentMediaRoot(settings,{sql,readSettings,deploymentFile}){
 const pending=readPendingMediaRootDeployment(settings);
 if(pending){
  const migrationProof=pending.publication?.operation==='migration'?JSON.parse(sql(migrationProofQuery(pending.publication))):undefined;
  const state=JSON.parse(sql("SELECT jsonb_build_object('binding',local_identity.media_root_binding(),'restoreState',coalesce(nullif(current_setting('loop.restore_state',true),''),'ready'))"));
  recoverMediaRootDeployment({...settings,deploymentFile},state.binding,{restoreState:state.restoreState,migrationProof});settings=readSettings();
 }
 const authorization=readMediaRootAuthorization(settings);if(authorization?.operation==='migration')verifyMediaRootMigrationProof(JSON.parse(sql(migrationProofQuery(authorization))),authorization);
 return settings;
}
export function readDeployment(){const settings=recoverDeploymentMediaRoot(readSettings(),{sql:text=>runtimeContext().sql(text),readSettings,deploymentFile:deploymentFile()});const d=validateDeployment(hydrateDeploymentSecrets(settings));
 for(const p of[...(d.mediaRootBinding?[]:[d.mediaRoot]),d.stateDirectory,...(d.automaticBackups===false?[]:[d.backupRoot]),d.openChatCut?.root,...(d.mediaRootBinding?[]:[d.worker?.mountPath]),d.worker?.alignment?.cacheDirectory]){if(typeof p!=='string')throw Error('Missing runtime path');assertPrivatePath(p);if(realpathSync(p)!==p)throw Error('Noncanonical runtime path');}
 const receipt=JSON.parse(readFileSync(d.restoreReceiptPath??join(root,'volume/restore-receipt.json')));if(receipt.passed!==true||receipt.database!==d.database.database||receipt.mediaRoot!==(d.restoreReceiptMediaRoot??(d.restoreReceiptPath?d.mediaRoot:d.mediaRootBinding?join(root,'volume/media'):d.mediaRoot))||receipt.publicationFence!==true)throw Error('Daily database/media restore not verified');
 readMediaRootAuthorization(d);
 return{...d,prepareKeychainAccess:()=>keychainState('unlock'),...(settings.secretAdministration?{secretAdministration:{adminOwnerId:settings.secretAdministration.adminOwnerId,runtimeRoot:root,controlReferences:[['database','应用数据库运行凭据'],['workerDatabase','Worker 数据库运行凭据']].map(([key,purpose])=>({reference:settings[key].passwordRef,purpose}))}}:{}),deploymentFile:deploymentFile(),recordPath:join(root,'app.json'),logPath:runtimeLogBinding(root).file,backupScript:join(projectRoot,'scripts/runtime/backup.mjs'),backupEnvironment:{LOOP_DAILY_RUNTIME:'1'},controlledNotifications:d.notifications!=='desktop'};
}
