// @vitest-environment node
import {expect,it} from 'vitest';
import {mkdtemp,realpath,writeFile,symlink,link,unlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {verifyNativeFileIdentity} from './localFiles';
it('verifies actual bytes while refusing tampering, wrong sizes, links and escaping paths',async()=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'loop-file-identity-'))),bytes=Buffer.from('verified source'),sha=createHash('sha256').update(bytes).digest('hex');
 try{
  await writeFile(join(root,'source.mp4'),bytes);await expect(verifyNativeFileIdentity(root,'source.mp4',sha,bytes.length)).resolves.toBeDefined();
  await expect(verifyNativeFileIdentity(root,'source.mp4',sha,bytes.length+1)).rejects.toThrow();
  await expect(verifyNativeFileIdentity(root,'source.mp4','0'.repeat(64),bytes.length)).rejects.toThrow();
  await symlink(join(root,'source.mp4'),join(root,'symbol.mp4'));await expect(verifyNativeFileIdentity(root,'symbol.mp4',sha,bytes.length)).rejects.toThrow();
  await link(join(root,'source.mp4'),join(root,'hard.mp4'));await expect(verifyNativeFileIdentity(root,'source.mp4',sha,bytes.length)).rejects.toThrow();await unlink(join(root,'hard.mp4'));
  await expect(verifyNativeFileIdentity(root,'../source.mp4',sha,bytes.length)).rejects.toThrow();
  await writeFile(join(root,'source.mp4'),Buffer.alloc(bytes.length));await expect(verifyNativeFileIdentity(root,'source.mp4',sha,bytes.length)).rejects.toThrow();
 }finally{await rm(root,{recursive:true,force:true});}
});
