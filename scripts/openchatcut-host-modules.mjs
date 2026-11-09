import {readFile} from 'node:fs/promises';

// One registration per source file. Dependency edges belong to source imports.
const modules=[
 ['composition','src/shotComposition.ts'],
 ['video-sound','src/workspaceVideoSound.ts'],
 ['candidates','src/workspaceCandidates.ts',true],
 ['structure','src/workspaceShots.ts',true],
 ['ranges','src/workspaceVideo.ts'],
 ['audio','src/workspaceAudio.ts',true],
 ['caption-drag','scripts/openchatcut-caption-drag.mjs',true],
 ['caption-layout','scripts/openchatcut-caption-layout.mjs',true],
 ['bridge-retry','scripts/openchatcut-bridge-retry.mjs',true],
 ['embed','scripts/openchatcut-embed-client.mjs',true],
 ['captions','src/workspaceCaptions.ts',true],
 ['shot-captions','src/shotCaptions.ts'],
];

/** Keep the existing virtual identities and snapshot all source bytes at startup. */
export async function createNativeWorkspaceModules({transformWithEsbuild,sourceRoot=new URL('../',import.meta.url)}){
 const entries=await Promise.all(modules.map(async([name,file,publicEntry])=>{
  const source=new URL(file,sourceRoot);
  return {id:'\0loop-control-'+name,alias:publicEntry?'virtual:loop-control-'+name:undefined,file,source,code:await readFile(source,'utf8')};
 }));
 const byId=new Map(entries.map(entry=>[entry.id,entry]));
 const byAlias=new Map(entries.filter(entry=>entry.alias).map(entry=>[entry.alias,entry.id]));
 const bySource=new Map();
 for(const entry of entries){
  bySource.set(entry.source.href,entry.id);
  if(entry.file.endsWith('.ts'))bySource.set(entry.source.href.replace(/\.ts$/,'.js'),entry.id);
 }
 return {
  name:'loop-control-native-workspace-modules',enforce:'pre',
  resolveId(id,importer){
   if(byAlias.has(id))return byAlias.get(id);
   const owner=byId.get(importer);
   if(!owner||!id.startsWith('.'))return;
   const dependency=bySource.get(new URL(id,owner.source).href);
   if(!dependency)throw Error(`原生剪辑宿主模块 ${owner.file} 引用了未登记依赖 ${id}。`);
   return dependency;
  },
  async load(id){
   const entry=byId.get(id);if(!entry)return;
   return entry.file.endsWith('.ts')?(await transformWithEsbuild(entry.code,entry.file,{loader:'ts'})).code:entry.code;
  },
 };
}
