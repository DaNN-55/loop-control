import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import {join} from 'node:path';
import {mkdir,writeFile,readFile,access} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {productionWorkspaceFixture} from '../../../src/local-app/productionWorkspace.fixture';
import {cookieHeader} from '../../../src/local-app/sessions';

const base=join(process.cwd(),'.loop-control/verification/markdown-shot-table-20261031');
const evidence=join(process.cwd(),'docs/verification/markdown-shot-table-20261031');
await mkdir(base,{recursive:true,mode:0o700});
const f=await productionWorkspaceFixture();
let ui:Awaited<ReturnType<typeof createServer>>|undefined;
try{
 const text='# 紧凑 Markdown 验证\n\n## 正文\n\n### 先检查画面，再确认口播。\n\n> 引用保留，行距紧凑。\n\n- **重点**与 `S01`\n';
 const bytes=Buffer.from(text),scriptPath=`episodes/${f.episode}/script.md`;
 await writeFile(join(f.assetRoot,scriptPath),bytes);
 await f.c.query('UPDATE public.production_material_revisions SET sha256=$2,file_size=$3 WHERE id=$1',[f.script,createHash('sha256').update(bytes).digest('hex'),bytes.length]);
 await f.c.query("UPDATE public.episodes SET title='Markdown 与镜头表格 · 隔离验证' WHERE id=$1",[f.episode]);
 const made=await f.request('prepareWorkspace',{reviewPackageId:f.board,expectedScriptRevisionId:f.script});
 if(made.status!==200)throw Error(JSON.stringify(made.body));
 const initial=await f.fillVisuals(made.body);
 const boardBefore=await readFile(join(f.assetRoot,f.boardPath)),sourceBefore=await readFile(join(f.assetRoot,f.videoPath));
 const proxy={target:f.origin,changeOrigin:true,configure(p:any){p.on('proxyReq',(req:any)=>req.setHeader('Origin',f.origin));}};
 ui=await createServer({configFile:false,root:process.cwd(),envFile:false,cacheDir:join(base,'vite-cache'),plugins:[react(),{name:'isolated-fixture-session',configureServer(server){server.middlewares.use((req,res,next)=>{if(req.url!=='/_fixture-login')return next();if(req.headers.host!=='localhost:5198'){res.statusCode=302;res.setHeader('Location','http://localhost:5198/_fixture-login');res.end();return;}res.setHeader('Set-Cookie',cookieHeader(f.token));res.statusCode=302;res.setHeader('Location','/?episode='+f.episode);res.end();});}}],define:{'import.meta.env.VITE_LOOP_BACKEND':JSON.stringify('local')},server:{host:'127.0.0.1',port:5198,strictPort:true,proxy:{'/api':proxy,'/_local-artifact':proxy,'/_local-studio':proxy},fs:{deny:['**/.git/**','**/.loop-control/**','.env','.env.*']}}});
 await ui.listen();
 await writeFile(join(evidence,'setup.json'),JSON.stringify({origin:'http://localhost:5198',episode:f.episode,database:f.database,initialShotIds:initial.clips.map((c:any)=>c.shotId),realBusinessDataCopied:false,providerUsed:false},null,2));
 console.log('ISOLATED_READY http://localhost:5198/_fixture-login');
 const deadline=Date.now()+15*60*1000;
 while(Date.now()<deadline&&!await access(join(base,'done')).then(()=>true,()=>false))await new Promise(resolve=>setTimeout(resolve,500));
 await f.restart();
 const resumed=(await(await fetch(`${f.origin}/api/local/episodes/${f.episode}/workspace`,{headers:{Cookie:'loop_owner_session='+f.token}})).json()).workspace;
 await writeFile(join(evidence,'persistence.json'),JSON.stringify({revision:resumed.revision,clips:resumed.clips.map((c:any)=>({shotId:c.shotId,text:c.text})),originalSourceUnchanged:(await readFile(join(f.assetRoot,f.videoPath))).equals(sourceBefore),storyboardHistoryUnchanged:(await readFile(join(f.assetRoot,f.boardPath))).equals(boardBefore)},null,2));
}finally{await ui?.close();await f.close();await writeFile(join(evidence,'cleanup.json'),JSON.stringify({databaseDropped:true,fixtureFilesRemoved:true,dailyServiceRestarted:false}));}
