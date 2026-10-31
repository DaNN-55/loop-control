// @vitest-environment node
import {it,expect} from 'vitest';
import {mkdir,lstat,writeFile,readFile,rename,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {setTimeout as pause} from 'node:timers/promises';
import {embeddedStudioFixture} from './embeddedStudio.fixture';
import {workspaceAudioVolume} from './workspaceAudioVolume.fixture';
import {productionScriptTemplate} from '../reviews/productionScript';
const legacyLayout=process.env.LOOP_T06_INPUT_LAYOUT==='legacy';
it.skipIf(process.env.LOOP_T06_INPUT_BROWSER!=='1')(`formal page imports, previews and confirms ${legacyLayout?'legacy':'registered-location'} script bytes after original upload moves and server restarts`,async()=>{
 const evidence=process.env.LOOP_T06_INPUT_EVIDENCE;if(!evidence)throw Error('Explicit evidence directory required');await mkdir(evidence,{recursive:true});
 const volume=await workspaceAudioVolume();const f=await embeddedStudioFixture({testRootParent:volume.mountPath,runtime:{mountPath:volume.mountPath,wake(){}},migrations:['db/local/117-input-storage-locations.sql']});let vite:import('vite').ViteDevServer|undefined;
 try{
  const prefix=legacyLayout?`episodes/${f.episode}`:'验收系列 stable/脚本输入 stable',directory=join(f.assetRoot,prefix);await mkdir(directory,{recursive:true});const stat=await lstat(directory,{bigint:true});
  if(!legacyLayout)await f.c.query('UPDATE local_identity.episode_asset_locations SET directory_relative_path=$2,directory_device_id=$3,directory_inode_id=$4,layout_version=2 WHERE episode_id=$1',[f.episode,prefix,String(stat.dev),String(stat.ino)]);await f.c.query("UPDATE public.episodes SET stage='waiting_input',title='T06 正式输入验收' WHERE id=$1",[f.episode]);
  const upload=join(f.root,'owner-script.md');await writeFile(upload,productionScriptTemplate);
  const {createServer}=await import('vite'),{default:react}=await import('@vitejs/plugin-react');const proxy={target:f.origin,changeOrigin:true,configure(p:any){p.on('proxyReq',(req:any)=>req.setHeader('origin',f.origin));}};
  vite=await createServer({configFile:false,envFile:false,root:process.cwd(),cacheDir:join(f.root,'vite-cache'),define:{'import.meta.env.VITE_LOOP_BACKEND':JSON.stringify('local')},plugins:[react(),{name:'t06-fixture',configureServer(s){s.middlewares.use('/__t06',async(_req,res)=>{res.setHeader('Content-Type','text/html');res.end(await s.transformIndexHtml('/__t06','<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>T06 正式脚本输入</title><div id="root"></div><script type="module" src="/src/local-app/main.tsx"></script>'));});}}],server:{host:'127.0.0.1',port:0,proxy:{'/api':proxy,'/_local-artifact':proxy}}});await vite.listen();
  for(const name of ['browser-done.json','browser-imported.json','browser-restarted.json'])await rm(join(evidence,name),{force:true});
  await writeFile(join(evidence,'browser.json'),JSON.stringify({url:`http://127.0.0.1:${(vite.httpServer!.address() as {port:number}).port}/__t06`,email:f.email,password:f.password,upload,episode:f.episode,prefix,legacyLayout}),{mode:0o600});
  let restarted=false,done=false;for(let i=0;i<300;i++){
   if(!restarted){try{await lstat(join(evidence,'browser-imported.json'));const source=(await f.c.query('SELECT * FROM public.production_material_revisions WHERE episode_id=$1 AND is_main_script',[f.episode])).rows[0];expect(source.storage_path).toContain(prefix+'/materials/');expect(await readFile(join(f.assetRoot,source.storage_path),'utf8')).toBe(productionScriptTemplate);await rename(upload,upload+'.moved');await f.restart();restarted=true;await writeFile(join(evidence,'browser-restarted.json'),JSON.stringify({moved:true,restarted:true,path:source.storage_path}));}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}}
   try{done=JSON.parse(await readFile(join(evidence,'browser-done.json'),'utf8')).passed===true;if(done)break;}catch{}await pause(1000);
  }
  expect(restarted).toBe(true);expect(done,'Real browser completes upload/confirmation/preview/reload').toBe(true);expect((await f.c.query('SELECT stage FROM public.episodes WHERE id=$1',[f.episode])).rows[0].stage).toBe('script_approved');
 }finally{await vite?.close();await f.close();await volume.close();await rm(join(evidence,'browser.json'),{force:true});}
},360000);
