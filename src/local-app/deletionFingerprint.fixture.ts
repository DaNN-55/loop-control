import {lstat,readdir,readlink} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {join,relative} from 'node:path';
/** Independent evidence of all retained nodes, with streamed file bytes. */
export async function deletionFixtureFingerprint(root:string){
 const result:Record<string,unknown>[]=[];
 async function visit(path:string){const stat=await lstat(path,{bigint:true}),entry:Record<string,unknown>={path:relative(root,path),device:String(stat.dev),inode:String(stat.ino),mode:String(stat.mode),links:String(stat.nlink),size:String(stat.size),modified:String(stat.mtimeNs)};
  if(stat.isSymbolicLink())entry.target=await readlink(path);
  else if(stat.isFile()){const hash=createHash('sha256');for await(const bytes of createReadStream(path))hash.update(bytes);entry.sha256=hash.digest('hex');}
  result.push(entry);if(stat.isDirectory()&&!stat.isSymbolicLink())for(const name of(await readdir(path)).sort())await visit(join(path,name));
 }
 await visit(root);return result;
}
