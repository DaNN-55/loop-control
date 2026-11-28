import {loadLocalStudioConfig,installLocalStudioNetworkBoundary} from './openchatcut-local-only.mjs';
import {patchAgentModels} from './openchatcut-agent-models.mjs';
import {createNativeWorkspaceModules} from './openchatcut-host-modules.mjs';
import {nativeReadabilityPlugin} from './openchatcut-readability.mjs';
import {nativeAccessibilityPlugin} from './openchatcut-accessibility.mjs';
import {patchBundledSoundSources} from './openchatcut-bundled-sounds.mjs';
import {patchCaptionDrag} from './openchatcut-caption-drag.mjs';
import {patchCaptionLayout,patchCaptionInspector} from './openchatcut-caption-layout.mjs';
import {patchEditorBridgeRetry} from './openchatcut-bridge-retry.mjs';
import {patchCaptionCueIdentity} from './openchatcut-caption-identity.mjs';
import {pruneOpenChatCutCache} from './openchatcut-cache.mjs';
import {nativeTransitionPlacementPlugin} from './openchatcut-transition-placement.mjs';
import {buildTransitionRenderBundle} from './openchatcut-transition-bundle.mjs';
import {prepareStudioProgram,acquireStudioViteCache,pruneStudioProgramCache} from './openchatcut-program-cache.mjs';
// Host-owned runtime adapter: no edits to the installed OpenChatCut checkout.
import {join} from 'node:path';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
const root=process.env.OPENCHATCUT_ROOT,dataDir=process.env.OPENCHATCUT_DATA_DIR,cacheDir=process.env.LOOP_OPENCHATCUT_VITE_CACHE_DIR,port=Number(process.argv[2]);
if(!root||!dataDir||!cacheDir||!Number.isInteger(port)||port<1||port>65535)throw Error('Studio 嵌入运行配置无效。');
if(process.env.LOOP_STUDIO_CAPABILITY_PROFILE==='harness-local-only')installLocalStudioNetworkBoundary();
await pruneOpenChatCutCache(root);
// Native toolbar exports use the SDK's server pipeline as well as the Owner export.
// Reuse one adapted bundle for this session so both paths keep clip appearance.
let program,viteCache;
const programCacheRoot=process.env.LOOP_OPENCHATCUT_PROGRAM_CACHE_DIR;
let cacheRelease;
const releaseCaches=()=>cacheRelease??=(async()=>{await viteCache?.release();await program?.release();if(programCacheRoot)await pruneStudioProgramCache(programCacheRoot).catch(()=>{});})();
if(!process.env.CC_REMOTION_BUNDLE&&programCacheRoot){
 try{
  program=await prepareStudioProgram({sdkRoot:root,cacheRoot:programCacheRoot});
  viteCache=await acquireStudioViteCache(program,cacheDir);
  process.env.CC_REMOTION_BUNDLE=program.bundle;
 }catch(error){await viteCache?.release();await program?.release();program=undefined;viteCache=undefined;console.warn('Studio 程序缓存不可用，使用本次编译：'+error.message);}
}
if(!process.env.CC_REMOTION_BUNDLE)process.env.CC_REMOTION_BUNDLE=await buildTransitionRenderBundle(root,join(dataDir,'loop-render-bundle'));
const bundledSoundManifest=JSON.parse(await readFile(join(dataDir,'loop-bundled-sounds.json'),'utf8'));
const bridge={name:'loop-control-embedded-editor',enforce:'pre',config(config){config.server??={};config.server.warmup={...config.server.warmup,clientFiles:['src/main.tsx','src/Editor.tsx']};},transform(code,id){
  const path=id.split('?')[0];if(path.endsWith('/src/agent/model-selection.ts'))return {code:patchAgentModels(code,JSON.parse(process.env.LOOP_STUDIO_AGENT_MODELS||'{}')),map:null};if(path.endsWith('/src/audio/soundLibrary.ts'))return{code:patchBundledSoundSources(code,bundledSoundManifest),map:null};if(path.endsWith('/src/captions/useCaptionCueGestures.ts')||path.endsWith('/src/captions/CaptionTrackLane.tsx'))return{code:patchCaptionCueIdentity(code,path),map:null};if(path.endsWith('/src/components/inspector/CaptionInspectorControls.tsx'))return{code:patchCaptionInspector(code),map:null};if(path.endsWith('/src/agent/useExternalAgentBridge.ts'))return{code:patchEditorBridgeRetry(code),map:null};if(path.endsWith('/src/captions/captionPreviewTarget.ts'))return{code:patchCaptionLayout(code),map:null};if(path.endsWith('/src/captions/CaptionPreviewEditor.tsx'))return{code:patchCaptionDrag(code),map:null};
  if(!path.endsWith('/src/editor/useEditorController.tsx'))return;
  const anchor='  return buildEditorWorkspaceViewProps(props, base, environment, ui);';
  if(!code.includes(anchor))throw Error('当前 Studio 版本缺少已验证的编辑器宿主接入点。');
  return {code:"import {useLoopControlHost} from 'virtual:loop-control-embed';\n"+code.replace(anchor,'  const hostHome=useLoopControlHost(props.project.id, base, environment.agent, ui.panels);\n  if(hostHome)ui.persistence.handleHome=hostHome;\n'+anchor),map:null};
}};
const vite=await import(pathToFileURL(join(root,'node_modules/vite/dist/node/index.js')).href);
const {createServer,transformWithEsbuild}=vite;
const localConfig=process.env.LOOP_STUDIO_CAPABILITY_PROFILE==='harness-local-only'?await loadLocalStudioConfig(vite,root,cacheDir):null;
const server=await createServer({...localConfig,root,configFile:localConfig?false:join(root,'config/vite.config.ts'),envDir:false,cacheDir:viteCache?.directory??cacheDir,plugins:[...(localConfig?.plugins??[]),{name:'loop-control-program-cache',closeBundle:releaseCaches},nativeTransitionPlacementPlugin(),nativeAccessibilityPlugin(root),nativeReadabilityPlugin(root),await createNativeWorkspaceModules({transformWithEsbuild}),bridge],server:{host:'127.0.0.1',port,strictPort:true,open:false}});
try{await server.listen();}catch(error){await server.close();await releaseCaches();throw error;}
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,async()=>{await server.close();await releaseCaches();await pruneOpenChatCutCache(root);process.exit(0);});
