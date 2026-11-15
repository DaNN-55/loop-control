import {it,expect} from 'vitest';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
it.each(['effective-baseline.sql','effective-manifest.json'])('retains a partially created immutable baseline when only %s exists',name=>{
 const root=mkdtempSync(join(tmpdir(),'loop-baseline-pair-'));
 try{
  writeFileSync(join(root,'baseline.sql'),'SELECT 1;');writeFileSync(join(root,'dump.sql'),'CREATE SCHEMA retained;');writeFileSync(join(root,name),'original immutable bytes');
  expect(()=>execFileSync(process.execPath,['scripts/schema/generate-baseline.mjs',join(root,'dump.sql'),root],{stdio:'pipe'})).toThrow(/Incomplete immutable/);
  expect(readFileSync(join(root,name),'utf8')).toBe('original immutable bytes');
 }finally{rmSync(root,{recursive:true,force:true});}
});
