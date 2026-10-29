// Host-owned runtime adapter: no edits to the installed OpenChatCut checkout.
import {join} from 'node:path';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
const root=process.env.OPENCHATCUT_ROOT,dataDir=process.env.OPENCHATCUT_DATA_DIR,port=Number(process.argv[2]);
if(!root||!dataDir||!Number.isInteger(port)||port<1||port>65535)throw Error('Studio 嵌入运行配置无效。');
const compositionVirtual='\0loop-control-composition';const compositionCode=await readFile(new URL('../src/shotComposition.ts',import.meta.url),'utf8');
const candidateVirtual='\0loop-control-candidates',candidateCode=await readFile(new URL('../src/workspaceCandidates.ts',import.meta.url),'utf8');
const structureVirtual='\0loop-control-structure',rangeVirtual='\0loop-control-ranges';
const structureCode=await readFile(new URL('../src/workspaceShots.ts',import.meta.url),'utf8'),rangeCode=await readFile(new URL('../src/workspaceVideo.ts',import.meta.url),'utf8');
const virtual='\0loop-control-embed',captionVirtual='\0loop-control-captions',shotVirtual='\0loop-control-shot-captions';
const captionCode=await readFile(new URL('../src/workspaceCaptions.ts',import.meta.url),'utf8'),shotCode=await readFile(new URL('../src/shotCaptions.ts',import.meta.url),'utf8');
const client=await readFile(new URL('./openchatcut-embed-client.mjs',import.meta.url),'utf8');
const bridge={name:'loop-control-embedded-editor',enforce:'pre',resolveId(id,importer){if(id==='virtual:loop-control-candidates')return candidateVirtual;if(importer===structureVirtual&&id==='./shotComposition.js')return compositionVirtual;if(importer===structureVirtual&&id==='./workspaceVideo.js')return rangeVirtual;if(importer===captionVirtual&&id==='./workspaceShots.js')return structureVirtual;if(id==='virtual:loop-control-structure')return structureVirtual;if(importer===captionVirtual&&id==='./shotCaptions.js')return shotVirtual;if(id==='virtual:loop-control-embed')return virtual;if(id==='virtual:loop-control-captions')return captionVirtual;},async load(id){if(id===candidateVirtual)return (await transformWithEsbuild(candidateCode,'workspaceCandidates.ts',{loader:'ts'})).code;if(id===compositionVirtual)return (await transformWithEsbuild(compositionCode,'shotComposition.ts',{loader:'ts'})).code;if(id===structureVirtual)return (await transformWithEsbuild(structureCode,'workspaceShots.ts',{loader:'ts'})).code;if(id===rangeVirtual)return (await transformWithEsbuild(rangeCode,'workspaceVideo.ts',{loader:'ts'})).code;if(id===virtual)return client;if(id===captionVirtual)return (await transformWithEsbuild(captionCode,'workspaceCaptions.ts',{loader:'ts'})).code;if(id===shotVirtual)return (await transformWithEsbuild(shotCode,'shotCaptions.ts',{loader:'ts'})).code;},transform(code,id){
  if(!id.split('?')[0].endsWith('/src/editor/useEditorController.tsx'))return;
  const anchor='  return buildEditorWorkspaceViewProps(props, base, environment, ui);';
  if(!code.includes(anchor))throw Error('当前 Studio 版本缺少已验证的编辑器宿主接入点。');
  return {code:"import {useLoopControlHost} from 'virtual:loop-control-embed';\n"+code.replace(anchor,'  const hostHome=useLoopControlHost(props.project.id, base, environment.agent, ui.panels);\n  if(hostHome)ui.persistence.handleHome=hostHome;\n'+anchor),map:null};
}};
const {createServer,transformWithEsbuild}=await import(pathToFileURL(join(root,'node_modules/vite/dist/node/index.js')).href);
const server=await createServer({root,configFile:join(root,'config/vite.config.ts'),cacheDir:join(dataDir,'vite-cache'),plugins:[bridge],server:{host:'127.0.0.1',port,strictPort:true,open:false}});
await server.listen();
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,async()=>{await server.close();process.exit(0);});
