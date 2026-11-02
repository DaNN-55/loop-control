// Read-only listing by default. Recovery is an explicit local operator action.
import {readDeployment} from './environment.mjs';
import {readPreparedRuntimeRelease} from '../../src/orchestration/runtimeBuild.ts';
import{pathToFileURL}from'node:url';
try{
const args=process.argv.slice(2),recover=args.includes('--recover');
let task,attempt;
for(let i=0;i<args.length;i++){
 if(args[i]==='--recover')continue;
 if(args[i]==='--task'&&task===undefined){task=args[++i];continue;}
 if(args[i]==='--attempt'&&attempt===undefined){attempt=Number(args[++i]);continue;}
 throw Error('Usage: node scripts/runtime/recover-native-output.mjs [--recover --task UUID --attempt N]');
}
if(recover? !/^[a-f0-9-]{36}$/.test(task??'')||!Number.isSafeInteger(attempt)||attempt<0 : task!==undefined||attempt!==undefined)throw Error('Recovery requires one exact task and attempt');
const d=readDeployment(),release=await readPreparedRuntimeRelease(d.projectRoot);
const load=name=>import(pathToFileURL(release.root+'/dist/local-app/local-app/'+name+'.js').href);
const{createWorkerDatabase,assertNativeWorkerDatabase}=await load('workerDatabase');
const{recoverPendingNativeAttemptOutput}=await load('nativeAttemptOutput');
const pool=createWorkerDatabase(d.workerDatabase);
try{
 await assertNativeWorkerDatabase(pool,d.workerDatabase.database);
 if(recover)console.log(JSON.stringify({taskId:task,attempt,...await recoverPendingNativeAttemptOutput(pool,d.mediaRoot,task,attempt)}));
 else console.log(JSON.stringify({pending:(await pool.query('SELECT * FROM local_identity.pending_native_output_publications()')).rows.map(({task_id,episode_id,attempt})=>({taskId:task_id,episodeId:episode_id,attempt,status:'pending_reconciliation'}))}));
}finally{await pool.end();}

}catch(error){if(['keychain_locked','keychain_unavailable','runtime_not_prepared','runtime_release_invalid'].includes(error?.code)){console.error(JSON.stringify({code:error.code,error:error.message}));process.exitCode=1;}else throw error;}
