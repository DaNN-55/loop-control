import {patchCaptionDrag} from './openchatcut-caption-drag.mjs';
import {patchCaptionLayout,patchCaptionInspector} from './openchatcut-caption-layout.mjs';
import {patchEditorBridgeRetry} from './openchatcut-bridge-retry.mjs';
import {patchMediaPoolImports} from './openchatcut-media-imports.mjs';
// Host-owned runtime adapter: no edits to the installed OpenChatCut checkout.
import {join} from 'node:path';
import {readFile,realpath} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
const root=process.env.OPENCHATCUT_ROOT,dataDir=process.env.OPENCHATCUT_DATA_DIR,port=Number(process.argv[2]);
if(!root||!dataDir||!Number.isInteger(port)||port<1||port>65535)throw Error('Studio 嵌入运行配置无效。');
const sdkRequire=createRequire(await realpath(join(root,'node_modules/vite/package.json')));
const {init:initializeModuleLexer,parse:parseModuleImports}=await import(pathToFileURL(sdkRequire.resolve('es-module-lexer')).href);await initializeModuleLexer;
const compositionVirtual='\0loop-control-composition';const compositionCode=await readFile(new URL('../src/shotComposition.ts',import.meta.url),'utf8');
const candidateVirtual='\0loop-control-candidates',candidateCode=await readFile(new URL('../src/workspaceCandidates.ts',import.meta.url),'utf8');
const structureVirtual='\0loop-control-structure',rangeVirtual='\0loop-control-ranges';
const structureCode=await readFile(new URL('../src/workspaceShots.ts',import.meta.url),'utf8'),rangeCode=await readFile(new URL('../src/workspaceVideo.ts',import.meta.url),'utf8');
const audioVirtual='\0loop-control-audio';const audioCode=await readFile(new URL('../src/workspaceAudio.ts',import.meta.url),'utf8');
const captionDragVirtual='\0loop-control-caption-drag',captionDragCode=await readFile(new URL('./openchatcut-caption-drag.mjs',import.meta.url),'utf8');
const captionLayoutVirtual='\0loop-control-caption-layout',captionLayoutCode=await readFile(new URL('./openchatcut-caption-layout.mjs',import.meta.url),'utf8');
const bridgeRetryVirtual='\0loop-control-bridge-retry',bridgeRetryCode=await readFile(new URL('./openchatcut-bridge-retry.mjs',import.meta.url),'utf8');
const virtual='\0loop-control-embed',captionVirtual='\0loop-control-captions',shotVirtual='\0loop-control-shot-captions';
const captionCode=await readFile(new URL('../src/workspaceCaptions.ts',import.meta.url),'utf8'),shotCode=await readFile(new URL('../src/shotCaptions.ts',import.meta.url),'utf8');
const client=await readFile(new URL('./openchatcut-embed-client.mjs',import.meta.url),'utf8');
const bridge={name:'loop-control-embedded-editor',enforce:'pre',configureServer(server){
  // Vite emits cache filesystem imports verbatim. Production names may contain
  // literal percent signs (including %20); serialize the original path once so
  // the browser/server do not interpret those names as URL escapes.
  const raw='/@fs'+join(dataDir,'vite-cache').replaceAll('\\','/'),encoded='/@fs'+join(dataDir,'vite-cache').replaceAll('\\','/').split('/').map(encodeURIComponent).join('/');
  const environment=server.environments.client,transform=environment.transformRequest.bind(environment);
  environment.transformRequest=async(...args)=>{
    const result=await transform(...args);if(!result||raw===encoded)return result;
    let code=result.code;const [imports]=parseModuleImports(code);
    for(const entry of [...imports].reverse())if(entry.n?.startsWith(raw+'/')){
      const specifier=encoded+entry.n.slice(raw.length);
      code=code.slice(0,entry.s)+(entry.d<0?specifier:JSON.stringify(specifier))+code.slice(entry.e);
    }
    return {...result,code};
  };
},config(config){config.server??={};config.server.warmup={...config.server.warmup,clientFiles:['src/main.tsx','src/Editor.tsx']};},resolveId(id,importer){if(id==='virtual:loop-control-bridge-retry')return bridgeRetryVirtual;if(id==='virtual:loop-control-caption-layout')return captionLayoutVirtual;if(id==='virtual:loop-control-caption-drag')return captionDragVirtual;if(importer===candidateVirtual&&id==='./workspaceAudio.js')return audioVirtual;if(id==='virtual:loop-control-audio')return audioVirtual;if(id==='virtual:loop-control-candidates')return candidateVirtual;if(importer===structureVirtual&&id==='./shotComposition.js')return compositionVirtual;if(importer===structureVirtual&&id==='./workspaceVideo.js')return rangeVirtual;if(importer===captionVirtual&&id==='./workspaceShots.js')return structureVirtual;if(id==='virtual:loop-control-structure')return structureVirtual;if(importer===captionVirtual&&id==='./shotCaptions.js')return shotVirtual;if(id==='virtual:loop-control-embed')return virtual;if(id==='virtual:loop-control-captions')return captionVirtual;},async load(id){if(id===bridgeRetryVirtual)return bridgeRetryCode;if(id===captionLayoutVirtual)return captionLayoutCode;if(id===captionDragVirtual)return captionDragCode;if(id===audioVirtual)return (await transformWithEsbuild(audioCode,'workspaceAudio.ts',{loader:'ts'})).code;if(id===candidateVirtual)return (await transformWithEsbuild(candidateCode,'workspaceCandidates.ts',{loader:'ts'})).code;if(id===compositionVirtual)return (await transformWithEsbuild(compositionCode,'shotComposition.ts',{loader:'ts'})).code;if(id===structureVirtual)return (await transformWithEsbuild(structureCode,'workspaceShots.ts',{loader:'ts'})).code;if(id===rangeVirtual)return (await transformWithEsbuild(rangeCode,'workspaceVideo.ts',{loader:'ts'})).code;if(id===virtual)return client;if(id===captionVirtual)return (await transformWithEsbuild(captionCode,'workspaceCaptions.ts',{loader:'ts'})).code;if(id===shotVirtual)return (await transformWithEsbuild(shotCode,'shotCaptions.ts',{loader:'ts'})).code;},transform(code,id){
  const path=id.split('?')[0];if(path.endsWith('/src/media/useEditorMediaIngest.ts')||path.endsWith('/src/media/poolImportRun.ts'))return{code:patchMediaPoolImports(code,path),map:null};if(path.endsWith('/src/components/inspector/CaptionInspectorControls.tsx'))return{code:patchCaptionInspector(code),map:null};if(path.endsWith('/src/agent/useExternalAgentBridge.ts'))return{code:patchEditorBridgeRetry(code),map:null};if(path.endsWith('/src/captions/captionPreviewTarget.ts'))return{code:patchCaptionLayout(code),map:null};if(path.endsWith('/src/captions/CaptionPreviewEditor.tsx'))return{code:patchCaptionDrag(code),map:null};let importAnchor,importGuard;
  if(path.endsWith('/src/media/upload.ts')){importAnchor='  const hooks = hooksOf(onProgressOrHooks);';importGuard='  redirectLoopControlImport(file.type);\n';}
  if(path.endsWith('/src/media/mobileImport.ts')){importAnchor='  if (isHeic(record)) {';importGuard='  redirectLoopControlImport(record.mime ?? "visual");\n';}
  if(importAnchor){if(!code.includes(importAnchor))throw Error('当前Studio缺少受控素材导入接点。');return{code:"import {redirectLoopControlImport} from 'virtual:loop-control-embed';\n"+code.replace(importAnchor,importGuard+importAnchor),map:null};}
  if(path.endsWith('/src/media/DirectoryImportActions.tsx')){const anchor='onClick={() => props.run(pickFolder)}';if(!code.includes(anchor))throw Error('当前Studio缺少受控文件夹导入接点。');return{code:"import {redirectLoopControlImport} from 'virtual:loop-control-embed';\n"+code.replace(anchor,"onClick={() => {redirectLoopControlImport('visual');props.run(pickFolder);}}"),map:null};}
  if(!path.endsWith('/src/editor/useEditorController.tsx'))return;
  const anchor='  return buildEditorWorkspaceViewProps(props, base, environment, ui);';
  if(!code.includes(anchor))throw Error('当前 Studio 版本缺少已验证的编辑器宿主接入点。');
  return {code:"import {useLoopControlHost} from 'virtual:loop-control-embed';\n"+code.replace(anchor,'  const hostHome=useLoopControlHost(props.project.id, base, environment.agent, ui.panels);\n  if(hostHome)ui.persistence.handleHome=hostHome;\n'+anchor),map:null};
}};
const {createServer,transformWithEsbuild}=await import(pathToFileURL(join(root,'node_modules/vite/dist/node/index.js')).href);
const server=await createServer({root,configFile:join(root,'config/vite.config.ts'),cacheDir:join(dataDir,'vite-cache'),plugins:[bridge],server:{host:'127.0.0.1',port,strictPort:true,open:false}});
await server.listen();
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,async()=>{await server.close();process.exit(0);});
