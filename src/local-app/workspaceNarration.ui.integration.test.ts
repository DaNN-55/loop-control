// @vitest-environment node
import {it,expect} from 'vitest';
import {writeFile,access,readFile,rm} from 'node:fs/promises';
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import {narrationFixture} from './workspaceNarration.fixture';
it.skipIf(process.env.LOOP_T05_UI!=='1')('keeps an isolated native UI available for browser acceptance',async()=>{
 await rm('/private/tmp/t05-ui-done',{force:true});
 let handler:Awaited<ReturnType<typeof narrationFixture>>['handler']|undefined;
 let f:Awaited<ReturnType<typeof narrationFixture>>|undefined;
 const ui=await createServer({configFile:false,root:process.cwd(),plugins:[react(),{name:'isolated-t05-api',configureServer(server){server.middlewares.use((q,r,next)=>{if(handler&&(q.url?.startsWith('/api/local/')||q.url?.startsWith('/_local-artifact')))void handler(q,r);else next();});}}],define:{'import.meta.env.VITE_LOOP_BACKEND':JSON.stringify('local')},server:{host:'127.0.0.1',port:0}});
 await ui.listen();const origin=`http://127.0.0.1:${(ui.httpServer!.address() as {port:number}).port}`;
 let timer:ReturnType<typeof setInterval>|undefined;
 try{
  f=await narrationFixture(origin,base=>{handler=base.handler;},true);await f.authorize();
  await f.request('setWanBudget',{trialCents:100,totalCents:200,full:false});
  await f.request('importMaterial',{materialType:'image',sourceKind:'file',sourcePath:'still-striped.png',mimeType:'image/png',contentBase64:(await readFile('/private/tmp/loop-152-orchestration/media/still-striped.png')).toString('base64'),isMainScript:false,materialPurpose:'visual_reference'});
  await writeFile('/private/tmp/t05-ui-fixture.json',JSON.stringify({origin,episode:f.episode,email:f.email,password:f.password,database:f.database,root:f.root}));
  let busy=false;timer=setInterval(()=>{if(busy||!f)return;busy=true;void (async()=>{try{const next=(await f!.c.query("SELECT id FROM public.tasks WHERE episode_id=$1 AND task_type IN ('generate_narration','generate_a_roll','generate_b_roll') AND status='ready' ORDER BY created_at LIMIT 1",[f!.episode])).rows[0];if(next)expect((await f!.execute(next.id))?.status).toBe('completed');}finally{busy=false;}})();},200);
  const deadline=Date.now()+360_000;while(Date.now()<deadline){if(await access('/private/tmp/t05-ui-done').then(()=>true,()=>false))break;await new Promise(resolve=>setTimeout(resolve,250));}
 }finally{if(timer)clearInterval(timer);await f?.close();await ui.close();}
},380_000);
