import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import {join} from 'node:path';
import {mkdir,writeFile,readFile,rename,access} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {productionWorkspaceFixture} from '../../../src/local-app/productionWorkspace.fixture';
import {readLegacyStudioProject} from '../../../src/local-app/legacyStudioProject';
const base=join(process.cwd(),'.loop-control/verification/storage-20261031'),evidence=join(process.cwd(),'docs/verification/storage-layout-sqlite-20261031');
await mkdir(evidence,{recursive:true});
const f=await productionWorkspaceFixture();
let w=(await f.request('prepareWorkspace',{reviewPackageId:f.board,expectedScriptRevisionId:f.script})).body;w=await f.fillVisuals(w);
await f.c.query("UPDATE public.episodes SET title='SQLite 隔离验证 · 不是真实工程' WHERE id=$1",[f.episode]);
const origin='http://127.0.0.1:5197',proxy={target:f.origin,changeOrigin:true,configure(p:any){p.on('proxyReq',(req:any)=>req.setHeader('Origin',f.origin));}};
const ui=await createServer({configFile:false,root:process.cwd(),envFile:false,cacheDir:join(base,'vite-cache'),plugins:[react()],define:{'import.meta.env.VITE_LOOP_BACKEND':JSON.stringify('local')},server:{host:'127.0.0.1',port:5197,strictPort:true,proxy:{'/api':proxy,'/_':proxy},fs:{deny:['**/.git/**','**/.loop-control/**','.env','.env.*']}}});
await ui.listen();
await writeFile(join(base,'private.json'),JSON.stringify({origin,episode:f.episode,database:f.database,assetRoot:f.assetRoot,email:f.email,password:f.password,token:f.token}),{mode:0o600});
await writeFile(join(evidence,'isolated-setup.json'),JSON.stringify({origin,episode:f.episode,database:f.database,assetRoot:f.assetRoot,schemaOnlyCopied:true,businessDataCopied:false,paidProviderUsed:false},null,2));
let busy=false,closing=false;
async function snapshot(label:string){
 const workspace=(await(await fetch(`${f.origin}/api/local/episodes/${f.episode}/workspace`,{headers:{Cookie:'loop_owner_session='+f.token}})).json()).workspace;
 const native=await readLegacyStudioProject(f.assetRoot,f.episode);
 const project=native?.project;
 const doc={label,workspaceId:workspace.id,revision:workspace.revision,projectSha256:workspace.project.sha256,contentSha256:workspace.contentSha256,nativeDocumentSha256:native?.sha256,timelines:project?.timelines.map((t:any)=>({name:t.name,items:t.items.map((i:any)=>({id:i.id,kind:i.kind,startFrame:i.startFrame,durationInFrames:i.durationInFrames,transform:i.transform})),captions:Object.values(t.tracks).flatMap((track:any)=>track.captions?.sourceEntries??[])}))};
 await writeFile(join(evidence,label+'.json'),JSON.stringify(doc,null,2));return doc;
}
async function stop(){if(closing)return;closing=true;clearInterval(timer);await ui.close();await f.close();await writeFile(join(evidence,'cleanup.json'),JSON.stringify({fixtureDatabase:f.database,databaseDropped:true,fixtureRootRemoved:true,dailyServiceStopped:false,at:new Date().toISOString()},null,2));process.exit(0);}
const timer=setInterval(async()=>{if(busy||closing)return;busy=true;try{
 const path=join(base,'request.json');if(!await access(path).then(()=>true,()=>false))return;
 await rename(path,join(base,'active-request.json'));const cmd=JSON.parse(await readFile(join(base,'active-request.json'),'utf8'));let result:any;
 if(cmd.action==='snapshot')result=await snapshot(cmd.label);
 else if(cmd.action==='poison-json'){
  const runtime=join(f.assetRoot,'episodes',f.episode,'openchatcut-work/current/runtime'),path=join(runtime,'project-store-v1.json'),store=JSON.parse(await readFile(path,'utf8'));
  store.entries['project:'+w.project.projectId].timelines[0].name='STALE_JSON_MUST_NOT_WIN';for(const i of store.entries['project:'+w.project.projectId].timelines[0].items)if(i.kind==='video')i.transform.x=-987;
  await writeFile(path,JSON.stringify(store));result={poisonedOnlyFixtureJson:true,marker:'STALE_JSON_MUST_NOT_WIN',x:-987};await writeFile(join(evidence,'stale-json-marker.json'),JSON.stringify(result,null,2));
 }else if(cmd.action==='restart-api'){await f.restart();result={apiRestarted:true,studioClosed:true};}
 else if(cmd.action==='end'){await stop();return;}
 else throw Error('Unknown controlled verification command');
 await writeFile(join(base,'response-'+cmd.id+'.json'),JSON.stringify({ok:true,result},null,2));
 }catch(e){console.error(e);await writeFile(join(base,'error.json'),JSON.stringify({error:String(e)}));}finally{busy=false;}},300);
process.once('SIGTERM',()=>void stop());process.once('SIGINT',()=>void stop());console.log('ISOLATED_READY '+origin+'; private credentials written locally.');
