// Owner-triggered local reconciliation. It never launches a Worker or Provider.
import{readFileSync,lstatSync,realpathSync}from'node:fs';
import{join,isAbsolute}from'node:path';
import{pathToFileURL}from'node:url';
import{readDeployment}from'./deployment.mjs';
const index=process.argv.indexOf('--staging'),stagingRoot=process.argv[index+1];
if(index<0||!stagingRoot||!isAbsolute(stagingRoot))throw Error('Use --deployment <private deployment> --staging <private attempt directory>');
const d=readDeployment(),receiptPath=join(stagingRoot,'publication-receipt-private.json'),stat=lstatSync(receiptPath);
if(!stat.isFile()||stat.isSymbolicLink()||(stat.mode&0o077)!==0||stat.size>16*1024*1024||realpathSync(stagingRoot)!==stagingRoot)throw Error('A private regular publication receipt and canonical staging directory are required');
const receipt=JSON.parse(readFileSync(receiptPath,'utf8'));
const {nativeAssetRoot}=await import(pathToFileURL(join(d.projectRoot,'dist/worker/local-app/localFiles.js')).href);
const {createWorkerDatabase,assertWorkerDatabaseBinding}=await import(pathToFileURL(join(d.projectRoot,'dist/worker/local-app/workerDatabase.js')).href);
const {recoverNativeAttemptOutput}=await import(pathToFileURL(join(d.projectRoot,'dist/worker/local-app/nativeAttemptOutput.js')).href);
assertWorkerDatabaseBinding(d.workerDatabase,d.database);
const assetRoot=await nativeAssetRoot(d.mediaRoot,receipt.assetRoot),pool=createWorkerDatabase(d.workerDatabase);
try{const result=await recoverNativeAttemptOutput(pool,{assetRoot,stagingRoot});console.log(JSON.stringify(result));}
catch{console.error('产物恢复未完成；保留私有凭据。数据库不可达、尝试已变化或文件指纹冲突时，请先核对再显式重试。');process.exitCode=1;}
finally{await pool.end();}
