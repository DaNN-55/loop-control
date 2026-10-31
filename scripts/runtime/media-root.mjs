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
 if(receipt.operation!=='initialize'||receipt.database!==d.database.database||!sameBinding(receipt.binding,binding)||receipt.publicationFence!==true)throw Error('Media root initialization receipt mismatch');
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
export function recoverMediaRootDeployment(d,currentBinding){
 const pending=readPendingMediaRootDeployment(d);if(!pending)return d;
 const previous=JSON.parse(pending.previousSettings);
 if(sameBinding(currentBinding,pending.target)){unlinkSync(mediaRootPendingPath(d));return d;}
 if(currentBinding?.path!==previous.mediaRoot)throw Error('Media initialization journal conflicts with database binding');
 atomicPrivateFileSync(d.deploymentFile??join(d.runtimeRoot,'deployment.json'),pending.previousSettings);
 if(pending.previousReceipt!==null)atomicPrivateFileSync(mediaRootReceiptPath(d),pending.previousReceipt);else try{unlinkSync(mediaRootReceiptPath(d));}catch(error){if(error.code!=='ENOENT')throw error;}
 unlinkSync(mediaRootPendingPath(d));
 return{...d,mediaRoot:previous.mediaRoot,mediaRootBinding:previous.mediaRootBinding,worker:d.worker?{...d.worker,mountPath:previous.worker.mountPath,alignment:previous.worker.alignment}:undefined};
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
export async function persistMediaRootDeployment(d,binding){
 if(!d.deploymentFile)throw Error('Deployment configuration is not writable');
 for(const path of [d.deploymentFile,d.runtimeRoot]){const stat=await lstat(path);if(stat.isSymbolicLink()||stat.uid!==process.getuid?.()||(stat.mode&0o077)!==0||await realpath(path)!==path)throw Error('Deployment configuration must be private and owned');}
 const configBytes=await readFile(d.deploymentFile),settings=JSON.parse(configBytes.toString());
 if(settings.mediaRoot!==d.mediaRoot)throw Error('Deployment media root changed; reload before retry');
 const receiptPath=mediaRootReceiptPath(d),oldReceipt=await readFile(receiptPath).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
 const pendingPath=mediaRootPendingPath(d);if(readPendingMediaRootDeployment(d))throw Error('Media initialization recovery required');
 const next={...settings,mediaRoot:binding.path,mediaRootBinding:binding,worker:await mediaRootWorkerSettings(settings,binding)};
 const undo=async()=>{await atomicPrivateFile(d.deploymentFile,configBytes);if(oldReceipt)await atomicPrivateFile(receiptPath,oldReceipt);else await unlink(receiptPath).catch(error=>{if(error.code!=='ENOENT')throw error;});await unlink(pendingPath).catch(error=>{if(error.code!=='ENOENT')throw error;});};
 try{await atomicPrivateFile(pendingPath,JSON.stringify({version:1,database:d.database.database,previousSettings:configBytes.toString(),previousReceipt:oldReceipt?.toString()??null,target:binding})+'\n');await atomicPrivateFile(receiptPath,JSON.stringify({version:1,operation:'initialize',database:d.database.database,binding,publicationFence:true})+'\n');await atomicPrivateFile(d.deploymentFile,JSON.stringify(next,null,2)+'\n');}catch(error){await undo();throw error;}
 undo.commit=async()=>{await unlink(pendingPath).catch(error=>{if(error.code!=='ENOENT')throw error;});};
 return undo;
}
