import {lstat,realpath,readFile,mkdir,open,readdir,unlink,rmdir} from 'node:fs/promises';
import {join} from 'node:path';
import {inspectMediaRoot} from './mediaRootSettings.js';
import {ConfigurationError} from './configurationCommands.js';
export async function ownsMarker(path:string,content:string,device:string|null,inode:string|null){if(device===null||inode===null)return false;try{const s=await lstat(path,{bigint:true});return s.isFile()&&!s.isSymbolicLink()&&s.nlink===1n&&String(s.dev)===device&&String(s.ino)===inode&&await realpath(path)===path&&await readFile(path,'utf8')===content;}catch{return false;}}
// Full UUID avoids prefix collisions, including case/normalization-insensitive filesystems.
export function directoryName(name:string,id:string,fallback="账号"){let readable='';for(const c of name.normalize('NFC').replace(/[\x00-\x1f\x7f<>:"/\\|?*]/g,'-').trim().replace(/[. ]+$/g,'')){if(Buffer.byteLength(readable+c)>100)break;readable+=c;}if(/^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(?:\.|$)/iu.test(readable))readable=fallback+'-'+readable;return`${readable||fallback}--${id}`;}

interface CreationIntentIdentity {
 device_id:string|null;inode_id:string|null;marker_device_id:string|null;marker_inode_id:string|null;cleanup_owned:boolean;
}
interface CreationDirectoryIdentity {deviceId:string;inodeId:string;markerDeviceId:string;markerInodeId:string}
const markerName='.loop-control-creation.json';
/** Publish one private intent marker; resuming an empty mkdir never grants cleanup ownership. */
export async function prepareCreationDirectory(path:string,marker:string,intent:CreationIntentIdentity,changedMessage:string){
 const markerPath=join(path,markerName);
 let made=false;try{await mkdir(path,{mode:0o700});made=true;}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}
 let needsMarker=made;
 if(!made&&intent.device_id===null){await inspectMediaRoot(path);if((await readdir(path)).length===0)needsMarker=true;}
 let markerDevice=intent.marker_device_id,markerInode=intent.marker_inode_id;
 if(needsMarker){const file=await open(markerPath,'wx',0o600);try{await file.writeFile(marker);await file.sync();const stat=await file.stat({bigint:true});markerDevice=String(stat.dev);markerInode=String(stat.ino);}finally{await file.close();}}
 const actual=await inspectMediaRoot(path),stat=await lstat(markerPath,{bigint:true});
 if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1n||markerDevice!==null&&(String(stat.dev)!==markerDevice||String(stat.ino)!==markerInode)||await realpath(markerPath)!==markerPath||await readFile(markerPath,'utf8')!==marker||intent.device_id!==null&&(actual.deviceId!==intent.device_id||actual.inodeId!==intent.inode_id))throw new ConfigurationError(409,changedMessage);
 return{deviceId:actual.deviceId,inodeId:actual.inodeId,markerDeviceId:String(stat.dev),markerInodeId:String(stat.ino),made};
}
/** Called again at each business-specific late revalidation point. */
export async function matchesCreationDirectory(path:string,marker:string,identity:CreationDirectoryIdentity){
 const actual=await inspectMediaRoot(path);
 return actual.deviceId===identity.deviceId&&actual.inodeId===identity.inodeId&&await ownsMarker(join(path,markerName),marker,identity.markerDeviceId,identity.markerInodeId);
}
export async function removeCreationMarker(path:string,marker:string,identity:CreationDirectoryIdentity){
 if(await matchesCreationDirectory(path,marker,identity))await unlink(join(path,markerName));
}
/** No recursive removal: only the originally owned, identity-matching marker-only directory. */
export async function removeCreatedDirectory(path:string,marker:string,intent:CreationIntentIdentity){
 if(!intent.device_id||!intent.cleanup_owned)return false;
 const actual=await inspectMediaRoot(path),names=await readdir(path),markerPath=join(path,markerName);
 if(actual.deviceId!==intent.device_id||actual.inodeId!==intent.inode_id||names.length!==1||names[0]!==markerName||!await ownsMarker(markerPath,marker,intent.marker_device_id,intent.marker_inode_id))return false;
 await unlink(markerPath);await rmdir(path);return true;
}
