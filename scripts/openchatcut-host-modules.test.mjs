// @vitest-environment node
import {mkdtemp,mkdir,copyFile,appendFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createServer,transformWithEsbuild} from 'vite';
import {expect,it} from 'vitest';
import {createNativeWorkspaceModules} from './openchatcut-host-modules.mjs';

const sources=[
 'src/shotComposition.ts','src/workspaceDisplayNames.ts','src/workspaceVideoSound.ts','src/workspaceCandidates.ts',
 'src/workspaceShots.ts','src/workspaceVideo.ts','src/workspaceShots.ts','src/workspaceAudioAdoption.ts',
 'src/workspaceCaptions.ts','src/shotCaptions.ts','src/workspaceRenderPreferences.ts','src/shotAudioMix.ts','scripts/openchatcut-caption-drag.mjs',
 'scripts/openchatcut-caption-layout.mjs','scripts/openchatcut-bridge-retry.mjs',
 'scripts/openchatcut-embed-client.mjs',
];
async function fixture(){
 const root=await mkdtemp(join(tmpdir(),'loop-host-modules-'));
 for(const file of sources){await mkdir(dirname(join(root,file)),{recursive:true});await copyFile(new URL('../'+file,import.meta.url),join(root,file));}
 return {root,sourceRoot:pathToFileURL(root+'/'),close:()=>rm(root,{recursive:true,force:true})};
}

it('serves the real structure module and every registered transitive dependency through Vite',async()=>{
 const f=await fixture();let server;
 try{
  server=await createServer({configFile:false,envFile:false,root:f.root,logLevel:'silent',plugins:[await createNativeWorkspaceModules({sourceRoot:f.sourceRoot,transformWithEsbuild})],server:{host:'127.0.0.1',port:0}});
  await server.listen();const origin=`http://127.0.0.1:${server.httpServer.address().port}`;
  const pending=['/@id/__x00__loop-control-structure'],seen=new Set();
  while(pending.length){const path=pending.shift();if(seen.has(path))continue;seen.add(path);const response=await fetch(origin+path),code=await response.text();expect(response.status,`${path}: ${code.slice(0,1600)}`).toBe(200);for(const match of code.matchAll(/["'](\/@id\/__x00__loop-control-[^"']+)["']/g))pending.push(match[1]);}
  expect(seen.has('/@id/__x00__loop-control-ranges')).toBe(true);
  expect(seen.has('/@id/__x00__loop-control-composition')).toBe(true);
 }finally{await server?.close();await f.close();}
});

it('serves a new import between registered modules through real Vite without an importer-specific mapping',async()=>{
 const f=await fixture();let server;
 try{
  await appendFile(join(f.root,'src/workspaceShots.ts'),"\nexport {defaultShotComposition} from './shotComposition.js';\n");
  const modules=await createNativeWorkspaceModules({sourceRoot:f.sourceRoot,transformWithEsbuild});
  server=await createServer({configFile:false,envFile:false,root:f.root,plugins:[modules],server:{host:'127.0.0.1',port:0}});
  await server.listen();const origin=`http://127.0.0.1:${server.httpServer.address().port}`;
  const response=await fetch(origin+'/@id/__x00__loop-control-structure'),code=await response.text();
  expect(response.status,code).toBe(200);
  const dependency=code.match(/["'](\/@id\/__x00__loop-control-composition)["']/)?.[1];
  expect(dependency).toBeTruthy();
  const caption=await fetch(origin+dependency);expect(caption.status,await caption.clone().text()).toBe(200);
  expect(await caption.text()).toContain('defaultShotComposition');
 }finally{await server?.close();await f.close();}
});

it('rejects an unregistered relative dependency even when the file exists and reports its importing module',async()=>{
 const f=await fixture();let server;
 try{
  await writeFile(join(f.root,'src/unregistered.ts'),"export const unregisteredContent='must-not-be-served';\n");
  await appendFile(join(f.root,'src/workspaceShots.ts'),"\nexport {unregisteredContent} from './unregistered.js';\n");
  server=await createServer({configFile:false,envFile:false,root:f.root,logLevel:'silent',plugins:[await createNativeWorkspaceModules({sourceRoot:f.sourceRoot,transformWithEsbuild})],server:{host:'127.0.0.1',port:0}});
  await server.listen();
  const response=await fetch(`http://127.0.0.1:${server.httpServer.address().port}/@id/__x00__loop-control-structure`),error=await response.text();
  expect(response.status).toBe(500);
  expect(error).toContain('src/workspaceShots.ts');expect(error).toContain('./unregistered.js');
  expect(error).not.toContain('must-not-be-served');
 }finally{await server?.close();await f.close();}
});

it('keeps TypeScript and JavaScript startup snapshots until a new plugin is created',async()=>{
 const f=await fixture();
 try{
  const current=await createNativeWorkspaceModules({sourceRoot:f.sourceRoot,transformWithEsbuild});
  for(const [alias,file] of [['structure','src/workspaceShots.ts'],['caption-layout','scripts/openchatcut-caption-layout.mjs']]){
   const id=current.resolveId('virtual:loop-control-'+alias),before=await current.load(id);
   await appendFile(join(f.root,file),'\nexport const laterSourceRevision=42;\n');
   expect(await current.load(id)).toBe(before);
  }
  const reopened=await createNativeWorkspaceModules({sourceRoot:f.sourceRoot,transformWithEsbuild});
  for(const alias of ['structure','caption-layout'])expect(await reopened.load(reopened.resolveId('virtual:loop-control-'+alias))).toContain('laterSourceRevision');
 }finally{await f.close();}
});

it('leaves React and native project storage with the SDK resolver and removes type-only references',async()=>{
 const plugin=await createNativeWorkspaceModules({transformWithEsbuild}),embed=plugin.resolveId('virtual:loop-control-embed');
 expect(plugin.resolveId('react',embed)).toBeUndefined();
 expect(plugin.resolveId('/src/persist/projectStore.ts',embed)).toBeUndefined();
 expect(plugin.resolveId('/src/persist/projectStoreTransport.ts',embed)).toBeUndefined();
 const code=await plugin.load(plugin.resolveId('virtual:loop-control-structure'));
 expect(code).not.toContain('worker/openchatcutProject');
 expect(code).toContain('./workspaceVideo.js');
});
