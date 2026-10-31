import {openSync,closeSync,fstatSync,readSync,writeSync,fsyncSync,realpathSync,constants,readFileSync,lstatSync} from 'node:fs';
import {createHash} from 'node:crypto';
const chunkBytes=256*1024;
const unchanged=(a,b)=>['dev','ino','size','mtimeNs','ctimeNs'].every(key=>a[key]===b[key]);
function assertFile(path,stat){const actual=lstatSync(path,{bigint:true});if(actual.dev!==stat.dev||actual.ino!==stat.ino||!stat.isFile()||stat.nlink!==1n||realpathSync(path)!==path||stat.size>BigInt(Number.MAX_SAFE_INTEGER))throw Error('Unsafe storage file');}
/** Fixed memory per file, no symlink/hardlink adoption, and changing sources fail closed. */
export function fingerprintFile(path){
 const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{const before=fstatSync(fd,{bigint:true});assertFile(path,before);const hash=createHash('sha256'),chunk=Buffer.allocUnsafe(chunkBytes);let bytes=0,count;while((count=readSync(fd,chunk,0,chunk.length,null))!==0){hash.update(chunk.subarray(0,count));bytes+=count;}const after=fstatSync(fd,{bigint:true});assertFile(path,after);if(!unchanged(before,after)||bytes!==Number(after.size))throw Error('Source changed during fingerprint');return{bytes,sha256:hash.digest('hex')};}finally{closeSync(fd);}
}
export function copyStorageFile(source,target,expected){
 const input=openSync(source,constants.O_RDONLY|constants.O_NOFOLLOW);let output;
 try{const before=fstatSync(input,{bigint:true});assertFile(source,before);output=openSync(target,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);const chunk=Buffer.allocUnsafe(chunkBytes),hash=createHash('sha256');let count,bytes=0;while((count=readSync(input,chunk,0,chunk.length,null))!==0){hash.update(chunk.subarray(0,count));let written=0;while(written<count){const n=writeSync(output,chunk,written,count-written);if(n===0)throw Error('Storage copy made no progress');written+=n;}bytes+=count;}fsyncSync(output);const after=fstatSync(input,{bigint:true});assertFile(source,after);if(!unchanged(before,after)||bytes!==expected.bytes||hash.digest('hex')!==expected.sha256)throw Error('Source changed during storage copy');}finally{closeSync(input);if(output!==undefined)closeSync(output);}
 const actual=fingerprintFile(target);if(actual.bytes!==expected.bytes||actual.sha256!==expected.sha256)throw Error('Storage copy fingerprint differs');
}
/** SQL archive decoding remains explicitly bounded; production media never use this path. */
export function readBoundedArchive(path){if(lstatSync(path).size>64*1024*1024)throw Error('Database archive exceeds the supported 64 MiB decode limit; incomplete evidence retained');return readFileSync(path);}
