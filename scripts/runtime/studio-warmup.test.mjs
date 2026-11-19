// @vitest-environment node
import {it,expect} from 'vitest';
import {mkdtemp,mkdir,writeFile,readFile,rm,access} from 'node:fs/promises';
import {join} from 'node:path';
import {scheduleStudioWarmup} from './studio-warmup.mjs';
it('starts program preparation after startup and cancels a pending preparation on close',async()=>{
 const root=await mkdtemp('/private/tmp/loop-warmup-test-');
 try{
  await mkdir(join(root,'scripts'));const marker=join(root,'started');
  await writeFile(join(root,'scripts/openchatcut-prewarm.mjs'),"import{writeFileSync}from'node:fs';writeFileSync(process.env.MARKER,process.env.OPENCHATCUT_ROOT);");
  const options={root:'sdk-program-only',node:process.execPath,projectRoot:root,environment:{MARKER:marker},delayMs:30};
  const cancelled=scheduleStudioWarmup(options);cancelled.close();
  await new Promise(resolve=>setTimeout(resolve,70));await expect(access(marker)).rejects.toThrow();
  const running=scheduleStudioWarmup(options);await expect(access(marker)).rejects.toThrow();
  await expect.poll(()=>readFile(marker,'utf8')).toBe('sdk-program-only');running.close();
 }finally{await rm(root,{recursive:true,force:true});}
});
