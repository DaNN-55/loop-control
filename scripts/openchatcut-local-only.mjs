import {readFile,writeFile,symlink} from 'node:fs/promises';
import {dirname,resolve,join} from 'node:path';
import {Socket} from 'node:net';
import {syncBuiltinESMExports} from 'node:module';

export function installLocalStudioNetworkBoundary(){
 const connect=Socket.prototype.connect,fetch=globalThis.fetch;
 const local=host=>host==='127.0.0.1'||host==='::1'||host==='[::1]'||host==='localhost';
 Socket.prototype.connect=function(...args){let first=args[0];if(Array.isArray(first))first=first[0];const options=typeof first==='object'?first:{port:first,host:args[1]};if(!local(options?.host??'localhost'))throw Error('Harness local Studio does not permit external network requests.');return Reflect.apply(connect,this,args);};
 globalThis.fetch=async(input,options)=>{const url=new URL(typeof input==='string'||input instanceof URL?input:input.url);if(!['http:','https:'].includes(url.protocol)||!local(url.hostname))throw Error('Harness local Studio does not permit external network requests.');return fetch(input,options);};
 syncBuiltinESMExports();
}

export const localStudioPlugins=new Set(['loop-local-editor-ownership','vite:react-babel','vite:react-refresh','openchatcut-request-shape-gate','openchatcut-system-fonts','openchatcut-cross-origin-isolation','openchatcut-storage-lifecycle','openchatcut-project-store','openchatcut-export-stage','openchatcut-export','openchatcut-export-destination','openchatcut-export-media-sources','openchatcut-export-qa','openchatcut-upload-multipart','openchatcut-upload','openchatcut-extract-audio','openchatcut-extract-frames','openchatcut-media-preview','openchatcut-normalize-media','openchatcut-probe-media','openchatcut-subtitle-export','openchatcut-generation-progress','openchatcut-exclude-user-media','openchatcut-serve-ort-wasm-loader']);
const routeRoots=['/api/project-store','/api/system-fonts','/api/probe-media','/api/extract-audio','/api/extract-frames','/api/normalize-media','/api/export-qa','/api/export-destinations','/api/export-media-sources','/api/waveform','/api/filmstrip','/api/media-frame','/api/media-poster','/api/preview-proxy','/api/preview-proxy-file','/export','/render-still','/render-clip','/generate/progress','/upload/multipart','/upload/list'];
export function localStudioRouteAllowed(method,url){
 let path;try{path=new URL(url,'http://localhost').pathname;}catch{return false;}
 if(/%|\\/.test(path))return false;
 if(path.startsWith('/api/external-agent/'))return (method==='POST'&&['/api/external-agent/register','/api/external-agent/unregister'].includes(path))||(method==='GET'&&['/api/external-agent/poll','/api/external-agent/cancellation'].includes(path));
 if(routeRoots.some(root=>path===root||path.startsWith(root+'/'))||path==='/upload')return ['GET','HEAD','POST','PUT','DELETE'].includes(method);
 // Unknown RPCs fail closed; GETs for Vite modules and bundled local media remain readable.
 return ['GET','HEAD'].includes(method)&&!/^\/(?:api|llm|generate|export|upload|agent|auth|skills|stock|resource|render-still|render-clip)(?:\/|$)/.test(path);
}
export function localStudioGuard(){return {name:'loop-local-only-boundary',enforce:'pre',configureServer(server){server.middlewares.use((req,res,next)=>{if(localStudioRouteAllowed(req.method??'GET',req.url??'/'))return next();res.writeHead(403,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({error:'Harness 基础剪辑仅开放本地编辑与导出。'}));});}};}
export function localEditorOwnershipPlugin({trustedEditorRequest,editorCredentialAuthorized,routeExternalAgentBridge,claimBrowserProjectOwnership,broker}){
 const noCall=async()=>{await new Promise(resolve=>setTimeout(resolve,1000));return null;};
 const operations={claimBrowserOwnership:claimBrowserProjectOwnership,editorRegistrationMatches:broker.editorRegistrationMatches,registerEditor:(project,editor,revision,_tools,...rest)=>broker.registerEditor(project,editor,revision,[],...rest),unregisterEditor:broker.unregisterEditor,touchEditor:broker.touchEditor,nextEditorCall:async(project,editor,revision,_signal,capability)=>{await broker.touchEditor(project,editor,revision,capability);return noCall();},nextEditorCancellation:noCall,settleEditorCall:()=>false,editorCallBinding:()=>null,mcpTools:()=>[]};
 return {name:'loop-local-editor-ownership',configureServer(server){server.middlewares.use('/api/external-agent',async(req,res)=>{
  try{const url=new URL(req.url??'/','http://localhost'),write=req.method==='POST';
   const capability=req.headers['x-openchatcut-editor-registration'];
   if((url.pathname!=='/register'||capability!==undefined)&&(typeof capability!=='string'||! /^[A-Za-z0-9_-]{43}$/.test(capability))){res.writeHead(403);res.end();return;}
   if(!localStudioRouteAllowed(req.method??'GET','/api/external-agent'+url.pathname)||!trustedEditorRequest(req,write)||!editorCredentialAuthorized(req,write)||(write&&req.headers['content-type']?.split(';')[0]!=='application/json')){res.writeHead(403);res.end();return;}
   await routeExternalAgentBridge(req,res,url,operations);
  }catch{if(!res.headersSent)res.writeHead(403);res.end();}
 });}};
}
export function localStudioConfigSource(source,file){
 const start=source.indexOf('  const env = profile.mode'),end=source.indexOf('  // Keep the default checkout',start);
 const conditional="if (profile.mode !== 'isolated-dev' && existsSync('.env.local'))";
 if(start<0||end<0||!source.includes(conditional))throw Error('当前 Studio 配置缺少已核实的本地能力隔离接入点。');
 return (source.slice(0,start)+'  const env: Record<string,string> = {};\n'+source.slice(end)).replace(conditional,'if (false)').replace(/from (['"])(\.[^'"]+)\1/g,(_match,_quote,specifier)=>'from '+JSON.stringify(resolve(dirname(file),specifier)));
}
export async function loadLocalStudioConfig(vite,root,cacheDir){
 const original=join(root,'config/vite.config.ts'),file=join(cacheDir,'local-only.config.mts');
 // Do not even evaluate paid/CLI plugin modules: some SDK versions may gain eager setup.
 const safeModules=[['cross-origin-isolation','crossOriginIsolationPlugin'],['storage-lifecycle','storageLifecyclePlugin'],['project-store-plugin','projectStorePlugin'],['export','exportPlugin'],['export-qa','exportQaPlugin'],['export-destination','exportDestinationPlugin'],['export-media-sources','exportMediaSourcesPlugin'],['export-stage','exportStagePlugin'],['upload','uploadPlugin'],['upload-multipart','uploadMultipartPlugin'],['extract-audio','extractAudioPlugin'],['extract-frames','extractFramesPlugin'],['media-preview','mediaPreviewPlugin'],['normalize-media','normalizeMediaPlugin'],['probe-media','probeMediaPlugin'],['generation-jobs','generationProgressPlugin'],['request-shape-gate','requestShapeGatePlugin'],['system-fonts','systemFontsPlugin']];
 const safeFile=join(cacheDir,'local-server-plugins.mts');
 const ownershipImports='import {localEditorOwnershipPlugin} from '+JSON.stringify(import.meta.url)+';\nimport {trustedEditorRequest,editorCredentialAuthorized} from '+JSON.stringify(join(root,'server/editor-auth.ts'))+';\nimport {routeExternalAgentBridge} from '+JSON.stringify(join(root,'server/plugins/external-agent-bridge-routes.ts'))+';\nimport {claimBrowserProjectOwnership} from '+JSON.stringify(join(root,'server/external-agent/project-edit-ownership.ts'))+';\nimport * as broker from '+JSON.stringify(join(root,'server/external-agent/broker.ts'))+';\n';
 await writeFile(safeFile,ownershipImports+safeModules.map(([file,fn])=>'import {'+fn+'} from '+JSON.stringify(join(root,'server/plugins',file+'.ts'))+';').join('\n')+'\nexport function serverPlugins(options={}) { return [localEditorOwnershipPlugin({trustedEditorRequest,editorCredentialAuthorized,routeExternalAgentBridge,claimBrowserProjectOwnership,broker}),'+safeModules.map(([,fn])=>fn+'('+(fn==='projectStorePlugin'?'{http:options.projectStoreHttp}':'')+')').join(',')+']; }\n',{mode:0o600});
 await symlink(join(root,'node_modules'),join(cacheDir,'node_modules'),'dir');
 const sdkAssembly=JSON.stringify(join(root,'server/plugins/index.ts'));
 const configSource=localStudioConfigSource(await readFile(original,'utf8'),original);
 if(!configSource.includes('from '+sdkAssembly))throw Error('Studio 插件汇编接入点已变化。');
 await writeFile(file,configSource.replace('from '+sdkAssembly,'from '+JSON.stringify(safeFile)),{mode:0o600});
 const loaded=await vite.loadConfigFromFile({command:'serve',mode:'development'},file,root,undefined,undefined,'runner');
 if(!loaded)throw Error('本地剪辑配置不可读取。');
 const plugins=(await Promise.all((loaded.config.plugins??[]).flat(Infinity))).filter(Boolean);
 const retained=plugins.filter(plugin=>localStudioPlugins.has(plugin.name));
 if(!retained.some(plugin=>plugin.name==='openchatcut-project-store')||!retained.some(plugin=>plugin.name==='openchatcut-export'))throw Error('本地剪辑能力与当前 SDK 不兼容。');
 return {...loaded.config,plugins:[localStudioGuard(),...retained]};
}
