// Host-owned runtime adapter: no edits to the installed OpenChatCut checkout.
import {join} from 'node:path';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
const root=process.env.OPENCHATCUT_ROOT,dataDir=process.env.OPENCHATCUT_DATA_DIR,port=Number(process.argv[2]);
if(!root||!dataDir||!Number.isInteger(port)||port<1||port>65535)throw Error('Studio 嵌入运行配置无效。');
const virtual='\0loop-control-embed';
const client=await readFile(new URL('./openchatcut-embed-client.mjs',import.meta.url),'utf8');
const bridge={name:'loop-control-embedded-editor',enforce:'pre',resolveId(id){if(id==='virtual:loop-control-embed')return virtual;},load(id){if(id===virtual)return client;},transform(code,id){
  if(!id.split('?')[0].endsWith('/src/editor/useEditorController.tsx'))return;
  const anchor='  return buildEditorWorkspaceViewProps(props, base, environment, ui);';
  if(!code.includes(anchor))throw Error('当前 Studio 版本缺少已验证的编辑器宿主接入点。');
  return {code:"import {useLoopControlHost} from 'virtual:loop-control-embed';\n"+code.replace(anchor,'  const hostHome=useLoopControlHost(props.project.id, base, environment.agent, ui.panels);\n  if(hostHome)ui.persistence.handleHome=hostHome;\n'+anchor),map:null};
}};
const {createServer}=await import(pathToFileURL(join(root,'node_modules/vite/dist/node/index.js')).href);
const server=await createServer({root,configFile:join(root,'config/vite.config.ts'),cacheDir:join(dataDir,'vite-cache'),plugins:[bridge],server:{host:'127.0.0.1',port,strictPort:true,open:false}});
await server.listen();
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,async()=>{await server.close();process.exit(0);});
