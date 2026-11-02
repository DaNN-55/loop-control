// @vitest-environment node
import {expect,it} from 'vitest';
import {randomBytes,randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createServer,type ViteDevServer} from 'vite';
import react from '@vitejs/plugin-react';
import {nativeWorkspaceFixture} from './nativeWorkspace.fixture';
import {productionWorkspaceMigrations} from './productionWorkspace.fixture';
import {LocalConnections} from './connections';
import {failedConnectionUsage} from './providerUsage';

const exec=promisify(execFile);
it.skipIf(process.env.LOOP_METRICS_BROWSER!=='1')('real Owner page renders compact metrics, sorted workbench, connections and embedded storage at desktop and narrow widths',async()=>{
 const f=await nativeWorkspaceFixture({migrations:productionWorkspaceMigrations,connections:pool=>new LocalConnections(pool,{mode:'keychain',async get(){return 'synthetic';},async putImmutable(){}},{mode:'live',networkAvailable:false,async verify(){return 'retryable';}},async({provider})=>failedConnectionUsage(provider,'隔离浏览器验收不连接供应商。'))});
 const evidence=process.env.LOOP_METRICS_EVIDENCE??join(process.cwd(),'docs/verification/episode-metrics-20261102'),session='metrics-'+randomBytes(6).toString('hex');
 await mkdir(evidence,{recursive:true});let vite:ViteDevServer|undefined;
 const cli=async(...args:string[])=>{const {stdout}=await exec('agent-browser',['--session',session,'--json',...args],{timeout:45000,maxBuffer:4*1024*1024});const value=JSON.parse(stdout);if(!value.success)throw Error(value.error);return value.data;};
 const evaluate=async(code:string)=>(await cli('eval','-b',Buffer.from(code).toString('base64'))).result;
 const click=(name:string)=>cli('find','role','button','click','--name',name,'--exact');
 try{
  const account=randomUUID();await f.c.query("INSERT INTO public.accounts(id,slug,name,timezone) VALUES($1,$2,'测试账号','Asia/Shanghai')",[account,'browser-'+account]);
  await f.c.query("INSERT INTO public.account_memberships(account_id,user_id,role) VALUES($1,$2,'owner')",[account,f.owner]);await f.c.query("INSERT INTO public.account_blueprint_versions(id,account_id,version,policy) VALUES($1,$1,1,'{}')",[account]);
  const titles=['末班车前的一把伞 · MiniMax写实版','末班车前的一把伞 · 百炼写实版','视频 API 逐项真实生成 · 1101'];
  for(let n=0;n<3;n++){
   const episode=randomUUID();await f.c.query("INSERT INTO public.episodes(id,account_id,blueprint_version_id,title,stage,created_at,updated_at) VALUES($1,$2,$2,$3,'script_approved','2026-11-01',$4)",[episode,account,titles[n],`2026-11-0${n===2?1:2}T0${3-n}:00:00Z`]);
   await f.c.query("INSERT INTO public.state_transitions(episode_id,from_stage,to_stage,reason,created_at) VALUES($1,'script_review','script_approved','browser','2026-11-02T00:00:00Z')",[episode]);
   await f.c.query("INSERT INTO public.tasks(episode_id,task_type,provider,status,actual_cost_cents,claimed_at,completed_at) VALUES($1,'generate_b_roll','metrics_test','completed',$2,'2026-11-02T00:01:00Z','2026-11-02T00:02:00Z')",[episode,(n+1)*20]);
  }
  await f.start();
  for(const [name,provider,adapter] of [['图片生成连接名称较长时也应完整换行显示','openai','openai_images'],['视频连接','volcengine','seedance_video'],['音效连接','freesound','freesound_preview']])expect((await f.post('connections','create',{name,provider,adapter,secret:'synthetic-browser-only'})).status).toBe(200);
  const proxy={target:f.origin,changeOrigin:true,configure(p:any){p.on('proxyReq',(req:any)=>req.setHeader('origin',f.origin));}};
  vite=await createServer({configFile:false,envFile:false,root:process.cwd(),cacheDir:join(f.root,'vite'),define:{'import.meta.env.VITE_LOOP_BACKEND':JSON.stringify('local')},plugins:[react(),{name:'metrics-review',configureServer(server){
   // Storage rendering uses a controlled read response; no real directory is
   // selected or migrated by this browser test. Command/progress UI has its own test.
   server.middlewares.use('/api/local/media-root',(_req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({path:'/Volumes/示例移动硬盘/Media',canInitialize:false,status:'ready',migration:null}));});
   server.middlewares.use('/__metrics',async(_req,res)=>{res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml('/__metrics','<!doctype html><html lang="zh-CN" data-interface="impeccable"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><div id="root"></div><script type="module" src="/src/local-app/main.tsx"></script>'));});
  }}],server:{host:'127.0.0.1',port:0,proxy:{'/api':proxy}}});await vite.listen();
  const origin=`http://127.0.0.1:${(vite.httpServer!.address() as {port:number}).port}`;
  await cli('open',origin+'/__metrics');await cli('wait','--text','登录控制台');await cli('find','label','邮箱','fill',f.email);await cli('find','label','密码','fill',f.password);await click('使用密码登录');await cli('wait','--text',titles[0]);
  await click('生产单');await cli('wait','--text','阶段用时');await cli('wait','--text','实际 ¥0.20');
  await cli('select','[aria-label="生产单排序"]','cost_desc');await cli('wait','--fn',`document.querySelector('.episode-row .episode-name')?.textContent.includes(${JSON.stringify(titles[2])})`);
  const results:unknown[]=[];
  const capture=async(name:string,selector:string)=>{
   const geometry=await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});return{viewport:innerWidth,document:document.documentElement.scrollWidth,width:e.clientWidth,scroll:e.scrollWidth,columns:[...e.querySelectorAll('.table-header>[role=columnheader],thead th')].map(c=>({label:c.textContent,width:c.getBoundingClientRect().width})),rows:[...e.querySelectorAll('.episode-row')].map(r=>r.textContent)}})()`);
   results.push({name,...geometry});await writeFile(join(evidence,'browser-results.json'),JSON.stringify(results,null,2));
   expect(geometry.scroll).toBeLessThanOrEqual(geometry.width+1);expect(geometry.document).toBeLessThanOrEqual(geometry.viewport+1);await cli('screenshot',join(evidence,name+'.png'));
  };
  for(const width of [1543,1443,1101,1001,1000,901,801,760,390]){await cli('set','viewport',String(width),'953');await capture('episodes-'+width,'.episode-table');}
  await cli('set','viewport','1443','953');await click('工作台');await cli('wait','--text',titles[2]);await cli('select','[aria-label="工作台排序"]','updated');await cli('wait','--fn',`document.querySelector('.lc-work-table tbody tr')?.textContent.includes(${JSON.stringify(titles[0])})||document.querySelector('[aria-label="系列生产单"] [role=row]:nth-child(2)')?.textContent.includes(${JSON.stringify(titles[0])})`);
  await click('连接配置');await cli('wait','--text','图片生成连接名称较长时也应完整换行显示');
  for(const width of [1543,1443,1101,1001,1000,901,801,760,390]){await cli('set','viewport',String(width),'953');await capture('connections-'+width,'.reference-connections-table-wrap');}
  await cli('set','viewport','1443','953');await click('图片生成连接名称较长时也应完整换行显示 连接操作');
  await cli('wait','--fn',"[...document.querySelectorAll('[role=menuitem]')].some(e=>e.textContent.includes('账务设置'))");
  expect(await evaluate("!![...document.querySelectorAll('[role=menuitem]')].find(e=>e.textContent.includes('账务设置'))?.querySelector('svg')")).toBe(true);
  await cli('screenshot',join(evidence,'billing-menu.png'));await cli('press','Escape');
  await click('所有者设置');expect(JSON.stringify(await cli('snapshot','-i'))).not.toContain('menuitem "本机存储"');await cli('find','role','menuitem','click','--name','个人偏好','--exact');await cli('wait','--text','/Volumes/示例移动硬盘/Media');
  for(const width of [1443,390]){await cli('set','viewport',String(width),'953');await capture('preferences-'+width,'.owner-preferences-dialog');}
  expect(await evaluate("document.querySelectorAll('[role=dialog]').length")).toBe(1);expect(await evaluate("!!document.querySelector('[aria-label=复制媒体根路径]')")).toBe(false);
  await writeFile(join(evidence,'browser-results.json'),JSON.stringify(results,null,2));
 }catch(error){await writeFile(join(evidence,'browser-failure.txt'),JSON.stringify(await cli('snapshot').catch(()=>({})),null,2));await cli('screenshot',join(evidence,'browser-failure.png')).catch(()=>{});throw error;}
 finally{await cli('close').catch(()=>{});await vite?.close();await f.close();}
},180000);
