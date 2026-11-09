// @vitest-environment node
import {mkdtemp,mkdir,copyFile,appendFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createServer,transformWithEsbuild} from 'vite';
import {expect,it} from 'vitest';
import {createNativeWorkspaceModules} from './openchatcut-host-modules.mjs';

const sources=[
 'src/shotComposition.ts','src/workspaceVideoSound.ts','src/workspaceCandidates.ts',
 'src/workspaceShots.ts','src/workspaceVideo.ts','src/workspaceAudio.ts',
 'src/workspaceCaptions.ts','src/shotCaptions.ts','scripts/openchatcut-caption-drag.mjs',
 'scripts/openchatcut-caption-layout.mjs','scripts/openchatcut-bridge-retry.mjs',
 'scripts/openchatcut-embed-client.mjs',
];
async function fixture(){
 const root=await mkdtemp(join(tmpdir(),'loop-host-modules-'));
 for(const file of sources){await mkdir(dirname(join(root,file)),{recursive:true});await copyFile(new URL('../'+file,import.meta.url),join(root,file));}
 return {root,sourceRoot:pathToFileURL(root+'/'),close:()=>rm(root,{recursive:true,force:true})};
}

it('serves a new import between registered modules through real Vite without an importer-specific mapping',async()=>{
 const f=await fixture();let server;
 try{
  await appendFile(join(f.root,'src/workspaceAudio.ts'),"\nexport {defaultShotCaptionContract} from './shotCaptions.js';\n");
  const modules=await createNativeWorkspaceModules({sourceRoot:f.sourceRoot,transformWithEsbuild});
  server=await createServer({configFile:false,envFile:false,root:f.root,plugins:[modules],server:{host:'127.0.0.1',port:0}});
  await server.listen();const origin=`http://127.0.0.1:${server.httpServer.address().port}`;
  const response=await fetch(origin+'/@id/__x00__loop-control-audio'),code=await response.text();
  expect(response.status,code).toBe(200);
  const dependency=code.match(/["'](\/@id\/__x00__loop-control-shot-captions)["']/)?.[1];
  expect(dependency).toBeTruthy();
  const caption=await fetch(origin+dependency);expect(caption.status,await caption.clone().text()).toBe(200);
  expect(await caption.text()).toContain('defaultShotCaptionContract');
 }finally{await server?.close();await f.close();}
});

it('rejects an unregistered relative dependency even when the file exists and reports its importing module',async()=>{
 const f=await fixture();let server;
 try{
  await writeFile(join(f.root,'src/unregistered.ts'),"export const unregisteredContent='must-not-be-served';\n");
  await appendFile(join(f.root,'src/workspaceAudio.ts'),"\nexport {unregisteredContent} from './unregistered.js';\n");
  server=await createServer({configFile:false,envFile:false,root:f.root,logLevel:'silent',plugins:[await createNativeWorkspaceModules({sourceRoot:f.sourceRoot,transformWithEsbuild})],server:{host:'127.0.0.1',port:0}});
  await server.listen();
  const response=await fetch(`http://127.0.0.1:${server.httpServer.address().port}/@id/__x00__loop-control-audio`),error=await response.text();
  expect(response.status).toBe(500);
  expect(error).toContain('src/workspaceAudio.ts');expect(error).toContain('./unregistered.js');
  expect(error).not.toContain('must-not-be-served');
 }finally{await server?.close();await f.close();}
});

it('keeps TypeScript and JavaScript startup snapshots until a new plugin is created',async()=>{
 const f=await fixture();
 try{
  const current=await createNativeWorkspaceModules({sourceRoot:f.sourceRoot,transformWithEsbuild});
  for(const [alias,file] of [['audio','src/workspaceAudio.ts'],['caption-layout','scripts/openchatcut-caption-layout.mjs']]){
   const id=current.resolveId('virtual:loop-control-'+alias),before=await current.load(id);
   await appendFile(join(f.root,file),'\nexport const laterSourceRevision=42;\n');
   expect(await current.load(id)).toBe(before);
  }
  const reopened=await createNativeWorkspaceModules({sourceRoot:f.sourceRoot,transformWithEsbuild});
  for(const alias of ['audio','caption-layout'])expect(await reopened.load(reopened.resolveId('virtual:loop-control-'+alias))).toContain('laterSourceRevision');
 }finally{await f.close();}
});

it('leaves React and native project storage with the SDK resolver and removes type-only references',async()=>{
 const plugin=await createNativeWorkspaceModules({transformWithEsbuild}),embed=plugin.resolveId('virtual:loop-control-embed');
 expect(plugin.resolveId('react',embed)).toBeUndefined();
 expect(plugin.resolveId('/src/persist/projectStore.ts',embed)).toBeUndefined();
 expect(plugin.resolveId('/src/persist/projectStoreTransport.ts',embed)).toBeUndefined();
 const code=await plugin.load(plugin.resolveId('virtual:loop-control-candidates'));
 expect(code).not.toContain('worker/openchatcutProject');
 expect(code).toContain('./shotCaptions.js');
});
