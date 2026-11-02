// @vitest-environment node
import {afterEach,expect,it} from 'vitest';
import {createHash,randomUUID} from 'node:crypto';
import {link,lstat,mkdir,mkdtemp,readFile,realpath,rename,rm,symlink,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {identity,storageCopySession,type Root} from './storageInventory';

const roots:string[]=[];
afterEach(async()=>{await Promise.all(roots.splice(0).map(path=>rm(path,{recursive:true,force:true})));});

async function fixture(){
 const base=await realpath(await mkdtemp(join(tmpdir(),'loop-storage-copy-')));roots.push(base);
 const source=join(base,'source'),target=join(base,'target'),ledger=join(base,'receipt.json'),id=randomUUID();
 await mkdir(source);await mkdir(target);
 const bytes=Buffer.alloc(600*1024,0x61),relativePath='media.bin',destination=join(target,relativePath),temporary=destination+'.migration-'+id;
 await writeFile(join(source,relativePath),bytes);
 const file={sourceRoot:source,relativePath,sha256:createHash('sha256').update(bytes).digest('hex'),fileSize:bytes.length},root=await identity(target);
 let pending:Root[]=[];
 const journal={pending:()=>pending,async record(value:Root){pending.push(value);await writeFile(ledger,JSON.stringify(pending));}};
 const errors={identity:'原暂存身份不符。',link:'原暂存链接不符。'},session=()=>storageCopySession(root,id,journal,errors);
 return{base,source,target,ledger,id,bytes,file,destination,temporary,journal,errors,session,reload:async()=>{pending=JSON.parse(await readFile(ledger,'utf8'));}};
}

it('waits for durable temporary identity before writing and reuses verified complete files',async()=>{
 const f=await fixture(),record=f.journal.record;
 let entered!:()=>void,release!:()=>void;
 const recording=new Promise<void>(resolve=>{entered=resolve;}),commit=new Promise<void>(resolve=>{release=resolve;});
 f.journal.record=async value=>{entered();await commit;await record(value);};
 const copying=f.session().copy(f.file);
 try{
  await recording;
  expect((await lstat(f.temporary)).size).toBe(0);
  await expect(lstat(f.destination)).rejects.toMatchObject({code:'ENOENT'});
 }finally{release();await copying;}
 const original=await lstat(f.destination,{bigint:true});
 expect(await readFile(f.destination)).toEqual(f.bytes);
 expect(await readFile(join(f.source,f.file.relativePath))).toEqual(f.bytes);
 const records=f.journal.pending().length;await f.session().recover();await f.session().copy(f.file);
 expect((await lstat(f.destination,{bigint:true})).ino).toBe(original.ino);
 expect(f.journal.pending()).toHaveLength(records);
});

it('preserves the empty temporary file and source when identity persistence fails',async()=>{
 const f=await fixture();f.journal.record=async()=>{throw Error('journal unavailable');};
 await expect(f.session().copy(f.file)).rejects.toThrow('journal unavailable');
 expect((await lstat(f.temporary)).size).toBe(0);
 expect(f.journal.pending()).toEqual([]);
 await expect(lstat(f.destination)).rejects.toMatchObject({code:'ENOENT'});
 expect(await readFile(join(f.source,f.file.relativePath))).toEqual(f.bytes);
});

it('recovers a persisted partial copy after restart and copies the incomplete file again',async()=>{
 const f=await fixture();
 await expect(f.session().copy(f.file,undefined,async()=>{throw Error('interrupted');})).rejects.toThrow('interrupted');
 const partial=await lstat(f.temporary);expect(partial.size).toBeGreaterThan(0);expect(partial.size).toBeLessThan(f.bytes.length);
 await f.reload();await f.session().recover();
 await expect(lstat(f.temporary)).rejects.toMatchObject({code:'ENOENT'});
 await f.session().copy(f.file);
 expect(await readFile(f.destination)).toEqual(f.bytes);
 expect(await readFile(join(f.source,f.file.relativePath))).toEqual(f.bytes);
});

it('removes only its temporary hardlink after publication and keeps the completed inode',async()=>{
 const f=await fixture();await writeFile(f.temporary,f.bytes);await link(f.temporary,f.destination);
 const original=await lstat(f.temporary,{bigint:true});
 await f.journal.record({path:f.temporary,device:String(original.dev),inode:String(original.ino)});
 await f.reload();await f.session().recover();await f.session().copy(f.file);
 await expect(lstat(f.temporary)).rejects.toMatchObject({code:'ENOENT'});
 const published=await lstat(f.destination,{bigint:true});expect(published.ino).toBe(original.ino);expect(published.nlink).toBe(1n);
 expect(await readFile(f.destination)).toEqual(f.bytes);
});

it.each(['inode','symlink','different-link','extra-link','directory','device','aliased-parent'] as const)('preserves unknown files when temporary recovery encounters %s replacement',async change=>{
 const f=await fixture();await writeFile(f.temporary,'original partial');
 const original=await lstat(f.temporary,{bigint:true}),receipt={path:f.temporary,device:String(original.dev),inode:String(original.ino)},kept=join(f.base,'kept-original');
 if(change==='inode'){await rename(f.temporary,kept);await writeFile(f.temporary,'unknown replacement');}
 if(change==='symlink'){await rename(f.temporary,kept);await symlink(kept,f.temporary);}
 if(change==='directory'){await rename(f.temporary,kept);await mkdir(f.temporary);}
 if(change==='device')receipt.device='0';
 if(change==='different-link'){await link(f.temporary,kept);await writeFile(f.destination,'unknown destination');}
 if(change==='extra-link'){await link(f.temporary,f.destination);await link(f.temporary,kept);}
 if(change==='aliased-parent'){const alias=join(f.base,'alias');await symlink(f.target,alias);receipt.path=join(alias,f.temporary.slice(f.target.length+1));}
 await f.journal.record(receipt);
 const before=await lstat(f.temporary,{bigint:true});
 await expect(f.session().recover()).rejects.toMatchObject({status:409,message:['different-link','extra-link'].includes(change)?f.errors.link:f.errors.identity});
 expect((await lstat(f.temporary,{bigint:true})).ino).toBe(before.ino);
 if(change==='inode')expect(await readFile(f.temporary,'utf8')).toBe('unknown replacement');
 if(change==='symlink')expect((await lstat(f.temporary)).isSymbolicLink()).toBe(true);
 if(change==='directory')expect((await lstat(f.temporary)).isDirectory()).toBe(true);
 if(change==='different-link')expect(await readFile(f.destination,'utf8')).toBe('unknown destination');
 expect(await readFile(join(f.source,f.file.relativePath))).toEqual(f.bytes);
});
