import {readFile,writeFile,rename,unlink,lstat,realpath} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {readFileSync,lstatSync,realpathSync,accessSync,constants,statfsSync,writeFileSync,renameSync,unlinkSync} from 'node:fs';
import {dirname} from 'node:path';
const sameBinding=(a,b)=>['path','deviceId','inodeId','mountPath'].every(key=>a?.[key]===b?.[key]);
export const mediaRootReceiptPath=d=>join(d.runtimeRoot,'media-root-receipt.json');
async function atomicPrivateFile(path,bytes){const temp=path+'.'+randomUUID()+'.tmp';try{await writeFile(temp,bytes,{mode:0o600,flag:'wx'});await rename(temp,path);}finally{await unlink(temp).catch(()=>{});}}
export function readMediaRootAuthorization(d){
 if(!d.mediaRootBinding)return;
 const binding=d.mediaRootBinding;
 if(binding.path!==d.mediaRoot||d.worker&&d.worker.mountPath!==binding.mountPath)throw Error('Media root configuration mismatch');
 const receiptPath=mediaRootReceiptPath(d),receiptStat=lstatSync(receiptPath);if(receiptStat.isSymbolicLink()||receiptStat.uid!==process.getuid?.()||(receiptStat.mode&0o077)!==0||realpathSync(receiptPath)!==receiptPath)throw Error('Media root receipt must be private and owned');
 const receipt=JSON.parse(readFileSync(receiptPath,'utf8'));
 if(!['initialize','restore'].includes(receipt.operation)||receipt.database!==d.database.database||!sameBinding(receipt.binding,binding)||receipt.publicationFence!==true)throw Error('Media root initialization receipt mismatch');
 if(receipt.operation==='restore'){
  if(!d.restoreReceiptPath||receipt.restoreReceiptPath!==d.restoreReceiptPath)throw Error('Restore receipt authorization mismatch');
  const restoreStat=lstatSync(d.restoreReceiptPath);if(!restoreStat.isFile()||restoreStat.isSymbolicLink()||restoreStat.nlink!==1||restoreStat.uid!==process.getuid?.()||(restoreStat.mode&0o077)!==0||realpathSync(d.restoreReceiptPath)!==d.restoreReceiptPath)throw Error('Restore receipt must be private and owned');
  const restored=JSON.parse(readFileSync(d.restoreReceiptPath,'utf8'));
  if(restored.passed!==true||restored.publicationFence!==true||restored.database!==d.database.database||restored.mediaRoot!==d.mediaRoot||restored.archiveSha256!==receipt.archiveSha256||!sameBinding(restored.binding,binding))throw Error('Restored deployment receipt mismatch');
 }
 verifyMediaRootIdentity(d,binding);
}
function verifyMediaRootIdentity(d,binding){
 const stat=lstatSync(binding.path,{bigint:true});
 if(!stat.isDirectory()||stat.isSymbolicLink()||stat.uid!==BigInt(process.getuid?.()??stat.uid)||realpathSync(binding.path)!==binding.path||String(stat.dev)!==binding.deviceId||String(stat.ino)!==binding.inodeId)throw Error('Media root identity changed');
 let mountPath=binding.path;while(dirname(mountPath)!==mountPath&&lstatSync(dirname(mountPath),{bigint:true}).dev===stat.dev)mountPath=dirname(mountPath);
 if(mountPath!==binding.mountPath)throw Error('Media root mount changed');
 accessSync(binding.path,constants.R_OK|constants.W_OK|constants.X_OK);
 const fs=statfsSync(binding.path,{bigint:true});if(fs.bavail*fs.bsize<BigInt(d.worker?.minimumFreeBytes??0))throw Error('Media root free space insufficient');
}
export const mediaRootPendingPath=d=>join(d.runtimeRoot,'media-root-pending.json');
export function readPendingMediaRootDeployment(d){
 const path=mediaRootPendingPath(d);let stat;try{stat=lstatSync(path);}catch(error){if(error.code==='ENOENT')return null;throw error;}
 if(stat.isSymbolicLink()||stat.uid!==process.getuid?.()||(stat.mode&0o077)!==0||realpathSync(path)!==path)throw Error('Media initialization journal must be private and owned');
 const pending=JSON.parse(readFileSync(path,'utf8'));
 if(pending.version!==1||pending.database!==d.database.database||typeof pending.previousSettings!=='string'||!pending.target)throw Error('Invalid media initialization journal');return pending;
}
function atomicPrivateFileSync(path,bytes){const temp=path+'.'+randomUUID()+'.tmp';try{writeFileSync(temp,bytes,{mode:0o600,flag:'wx'});renameSync(temp,path);}finally{try{unlinkSync(temp);}catch(error){if(error.code!=='ENOENT')throw error;}}}
export function recoverMediaRootDeployment(d,currentBinding,options={}){
 const pending=readPendingMediaRootDeployment(d);if(!pending)return d;
 const previous=JSON.parse(pending.previousSettings),configurationPath=d.deploymentFile??join(d.runtimeRoot,'deployment.json'),configuration=readFileSync(configurationPath,'utf8');
 if(pending.targetSettings&&configuration!==pending.previousSettings&&configuration!==pending.targetSettings)throw Error('Deployment configuration changed during publication; retain the journal');

 if(sameBinding(currentBinding,pending.target)){
  const publication=pending.publication??{operation:'initialize'};
  if(publication.operation==='restore'&&options.restoreState!=='ready'&&!options.completeRestore)throw Error('Restore publication is pending; retain the journal and explicitly verify completion');
  if(!pending.targetSettings||!pending.targetReceipt){if(!sameBinding(d.mediaRootBinding,pending.target)||d.mediaRoot!==pending.target.path)throw Error('Media publication recovery requires retained target settings');readMediaRootAuthorization(d);unlinkSync(mediaRootPendingPath(d));return d;}
  const next=JSON.parse(pending.targetSettings),receipt=JSON.parse(pending.targetReceipt);
  if(next.database?.database!==pending.database||next.mediaRoot!==pending.target.path||!sameBinding(next.mediaRootBinding,pending.target)||receipt.database!==pending.database||!sameBinding(receipt.binding,pending.target))throw Error('Media publication journal target mismatch');
  let restoring;
  if(publication.operation==='restore'&&options.restoreState==='ready'){
   verifyMediaRootIdentity(next,pending.target);
   const restoredPath=publication.restoreReceiptPath,stat=lstatSync(restoredPath);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.uid!==process.getuid?.()||(stat.mode&0o077)!==0||realpathSync(restoredPath)!==restoredPath)throw Error('Restore preparation receipt is unsafe');
   const restored=JSON.parse(readFileSync(restoredPath,'utf8'));if(restored.database!==pending.database||restored.archiveSha256!==publication.archiveSha256||!sameBinding(restored.binding,pending.target)||restored.foreignKeysVerified!==true||restored.mediaFingerprintsVerified!==true||restored.frozenBusinessRowsNotRewritten!==true)throw Error('Restore preparation proof mismatch');
   restoring={path:restoredPath,prepared:restored,completed:{...restored,passed:true,state:'complete',deploymentPublished:true,recoveredPublication:true}};
  }
  atomicPrivateFileSync(mediaRootReceiptPath(d),pending.targetReceipt);atomicPrivateFileSync(d.deploymentFile??join(d.runtimeRoot,'deployment.json'),pending.targetSettings);
  const recovered={...d,mediaRoot:next.mediaRoot,mediaRootBinding:next.mediaRootBinding,restoreReceiptPath:next.restoreReceiptPath,restoreReceiptMediaRoot:next.restoreReceiptMediaRoot,worker:d.worker?{...d.worker,mountPath:next.worker.mountPath,alignment:next.worker.alignment}:undefined};
  if(publication.operation!=='restore'||options.restoreState==='ready'){try{if(restoring)atomicPrivateFileSync(restoring.path,JSON.stringify(restoring.completed)+'\n');readMediaRootAuthorization(recovered);}catch(error){if(restoring)atomicPrivateFileSync(restoring.path,JSON.stringify({...restoring.prepared,passed:false})+'\n');throw error;}unlinkSync(mediaRootPendingPath(d));}
  return recovered;
 }
 if(currentBinding?.path!==previous.mediaRoot)throw Error('Media initialization journal conflicts with database binding');
 if(!pending.targetSettings){const unrelated=bytes=>{const config=JSON.parse(bytes);delete config.mediaRoot;delete config.mediaRootBinding;if(config.worker){delete config.worker.mountPath;if(config.worker.alignment)delete config.worker.alignment.cacheBinding;}return JSON.stringify(config);};if(unrelated(configuration)!==unrelated(pending.previousSettings))throw Error('Deployment configuration changed during initialization; retain the journal');}

 atomicPrivateFileSync(d.deploymentFile??join(d.runtimeRoot,'deployment.json'),pending.previousSettings);
 if(pending.previousReceipt!==null)atomicPrivateFileSync(mediaRootReceiptPath(d),pending.previousReceipt);else try{unlinkSync(mediaRootReceiptPath(d));}catch(error){if(error.code!=='ENOENT')throw error;}
 unlinkSync(mediaRootPendingPath(d));
 return{...d,mediaRoot:previous.mediaRoot,mediaRootBinding:previous.mediaRootBinding,restoreReceiptPath:previous.restoreReceiptPath,restoreReceiptMediaRoot:previous.restoreReceiptMediaRoot,worker:d.worker?{...d.worker,mountPath:previous.worker.mountPath,alignment:previous.worker.alignment}:undefined};
}
export async function mediaRootWorkerSettings(d,binding){
 if(!d.worker)return undefined;
 let alignment=d.worker.alignment;
 if(alignment){
  const {inspectMediaRoot,verifyMediaRootBinding}=await import('../../dist/local-app/local-app/mediaRootSettings.js');
  const cacheBinding=alignment.cacheBinding?await verifyMediaRootBinding(alignment.cacheBinding):await inspectMediaRoot(alignment.cacheDirectory);
  if(cacheBinding.path!==alignment.cacheDirectory)throw Error('Alignment cache binding mismatch');
  alignment={...alignment,cacheBinding};
 }
 return{...d.worker,mountPath:binding.mountPath,...(alignment?{alignment}:{})};
}
export async function persistMediaRootDeployment(d,binding,publication={operation:'initialize'}){
 if(!['initialize','restore'].includes(publication.operation)||publication.operation==='restore'&&(!publication.restoreReceiptPath||!/^[a-f0-9]{64}$/.test(publication.archiveSha256??'')))throw Error('Invalid media publication authority');
 if(!d.deploymentFile)throw Error('Deployment configuration is not writable');
 for(const path of [d.deploymentFile,d.runtimeRoot]){const stat=await lstat(path);if(stat.isSymbolicLink()||stat.uid!==process.getuid?.()||(stat.mode&0o077)!==0||await realpath(path)!==path)throw Error('Deployment configuration must be private and owned');}
 const configBytes=await readFile(d.deploymentFile),settings=JSON.parse(configBytes.toString());
 if(publication.operation==='restore'&&(settings.database?.database!==d.database.database||settings.workerDatabase?.database!==d.database.database||settings.storageOwnerId!==publication.storageOwnerId))throw Error('Restored deployment identity changed');
 if(settings.mediaRoot!==d.mediaRoot)throw Error('Deployment media root changed; reload before retry');
 const receiptPath=mediaRootReceiptPath(d),oldReceipt=await readFile(receiptPath).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
 const pendingPath=mediaRootPendingPath(d);if(readPendingMediaRootDeployment(d))throw Error('Media initialization recovery required');
 const next={...settings,mediaRoot:binding.path,mediaRootBinding:binding,...(publication.operation==='restore'?{restoreReceiptPath:publication.restoreReceiptPath,restoreReceiptMediaRoot:binding.path}:{}),worker:await mediaRootWorkerSettings(settings,binding)};
 const undo=async()=>{await atomicPrivateFile(d.deploymentFile,configBytes);if(oldReceipt)await atomicPrivateFile(receiptPath,oldReceipt);else await unlink(receiptPath).catch(error=>{if(error.code!=='ENOENT')throw error;});await unlink(pendingPath).catch(error=>{if(error.code!=='ENOENT')throw error;});};
 const targetSettings=JSON.stringify(next,null,2)+'\n',targetReceipt=JSON.stringify({version:1,...publication,database:d.database.database,binding,publicationFence:true})+'\n';
 try{await atomicPrivateFile(pendingPath,JSON.stringify({version:1,database:d.database.database,previousSettings:configBytes.toString(),previousReceipt:oldReceipt?.toString()??null,target:binding,publication,targetSettings,targetReceipt})+'\n');await atomicPrivateFile(receiptPath,targetReceipt);await atomicPrivateFile(d.deploymentFile,targetSettings);}catch(error){await undo();throw error;}
 undo.commit=async()=>{await unlink(pendingPath).catch(error=>{if(error.code!=='ENOENT')throw error;});};
 return undo;
}
