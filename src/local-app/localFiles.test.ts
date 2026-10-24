// @vitest-environment node
import {it,expect} from 'vitest';
import {mkdtemp,mkdir,readFile,writeFile,symlink,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {nativeAssetRoot,snapshotInput,verifyNativeFile} from './localFiles';
it('snapshots immutable input bytes, rejects traversal, corruption and symlink escapes',async()=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'t16-files-'))),account=join(root,'account'),id=randomUUID();await mkdir(account);
 try{
  expect(await nativeAssetRoot(root,account)).toBe(account);
  const input={sourceKind:'file',sourcePath:'main.md',contentBase64:Buffer.from('synthetic main script').toString('base64')};
  const snapshot=await snapshotInput(account,id,input);expect(await snapshotInput(account,id,input)).toEqual(snapshot);
  expect((await verifyNativeFile(account,snapshot.storagePath,snapshot.sha256,snapshot.fileSize)).toString()).toBe('synthetic main script');
  await expect(snapshotInput(account,id,{...input,sourcePath:'../outside'})).rejects.toThrow();
  await expect(snapshotInput(account,id,{...input,isMainScript:true})).rejects.toThrow('主脚本');
  await writeFile(join(account,snapshot.storagePath),'corrupted');await expect(snapshotInput(account,id,input)).rejects.toThrow();
  await expect(nativeAssetRoot(root,tmpdir())).rejects.toThrow();
  await writeFile(join(root,'private.md'),'outside');await symlink(join(root,'private.md'),join(account,'episodes',id,'input','linked.md'));
  await expect(snapshotInput(account,id,{sourceKind:'directory',sourcePath:'linked.md'})).rejects.toThrow();
  expect(await readFile(join(root,'private.md'),'utf8')).toBe('outside');
 }finally{await rm(root,{recursive:true,force:true});}
});
