// @vitest-environment node
import {expect,it} from 'vitest';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileSha256} from './fileSha256';

it('hashes real files against standard SHA-256 vectors across multiple stream chunks',async()=>{
 const root=await mkdtemp(join(tmpdir(),'loop-file-sha-'));
 try{
  const file=join(root,'input');
  for(const [bytes,expected] of [
   [Buffer.alloc(0),'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
   [Buffer.from('abc'),'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
   [Buffer.alloc(1_000_000,97),'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0'],
  ] as const){await writeFile(file,bytes);expect(await fileSha256(file)).toBe(expected);}
  await expect(fileSha256(join(root,'missing'))).rejects.toMatchObject({code:'ENOENT'});
 }finally{await rm(root,{recursive:true,force:true});}
});
