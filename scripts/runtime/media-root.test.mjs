// @vitest-environment node
import {it,expect} from 'vitest';
import {mkdtemp,mkdir,readFile,writeFile,cp,rm,realpath,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {pathToFileURL} from 'node:url';
const exec=promisify(execFile);
it('fresh processes read the shipped deployment reader with initialized external media, preserve private capabilities, and reject replaced roots or receipts',async()=>{
 const temp=await realpath(await mkdtemp(join(tmpdir(),'loop-root-reader-'))),projectRoot=join(temp,'project'),root=join(projectRoot,'.loop-control/local'),scripts=join(projectRoot,'scripts/runtime');
 try{
  await mkdir(scripts,{recursive:true,mode:0o700});await mkdir(root,{recursive:true,mode:0o700});
  for(const name of ['environment.mjs','keychain.mjs','media-root.mjs'])await cp(join(process.cwd(),'scripts/runtime',name),join(scripts,name));
  await mkdir(join(projectRoot,'scripts/storage'),{recursive:true});await cp(join(process.cwd(),'scripts/storage/file-io.mjs'),join(projectRoot,'scripts/storage/file-io.mjs'));
  await exec(process.execPath,[join(process.cwd(),'node_modules/typescript/bin/tsc'),'-p',join(process.cwd(),'tsconfig.local-app.json'),'--outDir',join(projectRoot,'dist/local-app')]);
  const {persistMediaRootDeployment}=await import(pathToFileURL(join(scripts,'media-root.mjs')).href),{inspectMediaRoot}=await import(pathToFileURL(join(projectRoot,'dist/local-app/local-app/mediaRootSettings.js')).href);
  const source=join(root,'volume/media'),target=join(temp,'custom-library');
  for(const p of [source,target,join(root,'state'),join(root,'backups/loop_control'),join(root,'OpenChatCut'),join(source,'whisperx-models')])await mkdir(p,{recursive:true,mode:0o700});
  const database={host:'127.0.0.1',port:54329,database:'loop_control',password:'synthetic-unconnected'};
  const settings={version:1,purpose:'local-daily',projectRoot,runtimeRoot:root,port:5174,postgres:{profile:'loop-control',container:'loop-control-local-postgres',volume:'loop-control-local-data',image:'sha256:00bc86618629af00d2937fdc5a5d63db3ff8450acf52f0636ec813c7f4902929'},database:{...database,user:'loop_app'},workerDatabase:{...database,user:'loop_worker'},mediaRoot:source,stateDirectory:join(root,'state'),backupRoot:join(root,'backups/loop_control'),openChatCut:{root:join(root,'OpenChatCut'),port:5175},connections:{keychain:{runtimeRoot:root}},worker:{mountPath:join(root,'volume'),alignment:{cacheDirectory:join(source,'whisperx-models')}}};
  const deploymentFile=join(root,'deployment.json');await writeFile(deploymentFile,JSON.stringify(settings),{mode:0o600});await writeFile(join(root,'volume/restore-receipt.json'),JSON.stringify({passed:true,database:'loop_control',mediaRoot:source,publicationFence:true}),{mode:0o600});
  const reader=`import {readDeployment} from ${JSON.stringify(join(scripts,'environment.mjs'))};const d=readDeployment();console.log(JSON.stringify({mediaRoot:d.mediaRoot,mountPath:d.worker.mountPath,cacheDirectory:d.worker.alignment.cacheDirectory,backupRoot:d.backupRoot}));`;
  expect(JSON.parse((await exec(process.execPath,['--input-type=module','-e',reader])).stdout).mediaRoot).toBe(source);
  const binding=await inspectMediaRoot(target),undo=await persistMediaRootDeployment({...settings,deploymentFile},binding);
  await undo.commit();
  const readback=JSON.parse((await exec(process.execPath,['--input-type=module','-e',reader])).stdout);expect(readback).toEqual({mediaRoot:target,mountPath:binding.mountPath,cacheDirectory:settings.worker.alignment.cacheDirectory,backupRoot:settings.backupRoot});
  const restoredReceiptPath=join(root,'state/restore-receipt.json'),archiveSha256='b'.repeat(64),restoredReceipt={passed:true,database:'loop_control',mediaRoot:target,binding,archiveSha256,publicationFence:true};
  await writeFile(restoredReceiptPath,JSON.stringify(restoredReceipt),{mode:0o600});
  const restoredSettings=JSON.parse(await readFile(deploymentFile,'utf8'));await writeFile(deploymentFile,JSON.stringify({...restoredSettings,restoreReceiptPath:restoredReceiptPath}),{mode:0o600});
  await writeFile(join(root,'media-root-receipt.json'),JSON.stringify({operation:'restore',database:'loop_control',binding,restoreReceiptPath:restoredReceiptPath,archiveSha256,publicationFence:true}),{mode:0o600});
  expect(JSON.parse((await exec(process.execPath,['--input-type=module','-e',reader])).stdout).mediaRoot).toBe(target);
  await writeFile(restoredReceiptPath,JSON.stringify({...restoredReceipt,archiveSha256:'c'.repeat(64)}));await expect(exec(process.execPath,['--input-type=module','-e',reader])).rejects.toThrow('Restored deployment receipt mismatch');await writeFile(restoredReceiptPath,JSON.stringify(restoredReceipt));
  await rename(target,target+'-old');await mkdir(target,{mode:0o700});await expect(exec(process.execPath,['--input-type=module','-e',reader])).rejects.toThrow('Media root identity changed');await rm(target,{recursive:true});await rename(target+'-old',target);
  const receiptPath=join(root,'media-root-receipt.json'),receipt=JSON.parse(await readFile(receiptPath,'utf8'));await writeFile(receiptPath,JSON.stringify({...receipt,database:'foreign_database'}));await expect(exec(process.execPath,['--input-type=module','-e',reader])).rejects.toThrow('receipt mismatch');
  await undo();expect(JSON.parse((await exec(process.execPath,['--input-type=module','-e',reader])).stdout).mediaRoot).toBe(source);
 }finally{await rm(temp,{recursive:true,force:true});}
},15000);
