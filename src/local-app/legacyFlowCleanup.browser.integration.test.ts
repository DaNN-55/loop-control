// @vitest-environment node
import {it,expect} from 'vitest';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createServer,type ViteDevServer} from 'vite';
import react from '@vitejs/plugin-react';
import {embeddedStudioFixture} from './embeddedStudio.fixture';
import {csrfFor} from './sessions';
it.skipIf(process.env.LOOP_LEGACY_FLOW_BROWSER!=='1')('current account and series edits survive legacy-form removal in the real browser and Owner API',async()=>{
 const f=await embeddedStudioFixture(),exec=promisify(execFile),session='legacy-flow-'+randomUUID(),output=process.env.LOOP_ACCEPTANCE_OUTPUT!;let vite:ViteDevServer|undefined;
 const browser=async(...args:string[])=>(await exec('agent-browser',['--session',session,...args],{timeout:40000,maxBuffer:2_000_000})).stdout;
 const headers={Origin:f.origin,'Content-Type':'application/json',Cookie:'loop_owner_session='+f.token,'X-CSRF-Token':csrfFor(f.token)};
 const read=async()=>{const r=await fetch(f.origin+'/api/local/catalog?view=accounts',{headers});expect(r.status).toBe(200);return r.json();};
 try{
  await mkdir(output,{recursive:true});const initial=await read(),account=initial.accounts[0];
  const seriesResponse=await fetch(f.origin+'/api/local/configuration',{method:'POST',headers,body:JSON.stringify({command:'createSeries',idempotencyKey:randomUUID(),data:{accountId:account.id,name:'隔离系列',rules:{positioning:'原系列定位',extension:{keep:['series']}}}})});expect(seriesResponse.status,await seriesResponse.clone().text()).toBe(200);
  const created=await seriesResponse.json();
  const proxy={target:f.origin,changeOrigin:true,configure(p:any){p.on('proxyReq',(req:any)=>req.setHeader('origin',f.origin));}};
  vite=await createServer({configFile:false,envFile:false,root:process.cwd(),cacheDir:join(f.root,'vite-cache'),define:{'import.meta.env.VITE_LOOP_BACKEND':JSON.stringify('local')},optimizeDeps:{entries:[]},plugins:[react(),{name:'legacy-flow-verification',configureServer(s){s.middlewares.use('/__legacy-flow',async(_req,res)=>{res.setHeader('Content-Type','text/html');res.end(await s.transformIndexHtml('/__legacy-flow','<!doctype html><html lang="zh-CN" data-interface="impeccable"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="/src/local-app/main.tsx"></script>'));});}}],server:{host:'127.0.0.1',port:0,proxy:{'/api':proxy,'/_local-artifact':proxy}}});await vite.listen();
  await browser('open',`http://127.0.0.1:${(vite.httpServer!.address() as {port:number}).port}/__legacy-flow`);
  await browser('wait','--text','登录控制台');await browser('find','label','邮箱','fill',f.email);await browser('find','label','密码','fill',f.password);await browser('find','role','button','click','--name','使用密码登录','--exact');await browser('wait','--text','内容工作台');
  await browser('find','role','button','click','--name','账号','--exact');await browser('find','role','button','click','--name',account.name,'--exact');await browser('wait','--text','通用规则');
  expect(await browser('eval',"document.body.textContent.includes('修复旧任务配置')")).toContain('false');
  await browser('find','role','button','click','--name','修改','--exact');await browser('find','label','账号定位','fill','清理后保留的账号创作规则');await browser('find','role','button','click','--name','保存通用规则','--exact');await browser('find','role','button','click','--name','确认保存通用规则','--exact');await browser('wait','--fn',"document.querySelector('textarea[aria-label=账号定位]')?.readOnly===true");
  const common=await read(),rule=common.blueprints.find((b:any)=>b.id===common.accounts[0].current_blueprint_version_id);expect(rule.policy.positioning).toBe('清理后保留的账号创作规则');expect(rule.policy).not.toHaveProperty('executors');
  await browser('wait','--fn',"!document.querySelector('[role=dialog]')");await browser('focus','[role=tab][aria-selected=false]');await browser('press','Enter');await browser('wait','--text','隔离系列');await browser('find','role','button','click','--name','修改','--exact');await browser('find','label','系列定位','fill','清理后保留的系列规则');
  await writeFile(join(output,'series-edit-snapshot.txt'),await browser('snapshot'));
  await browser('find','role','button','click','--name','保存系列设置','--exact');await browser('find','role','button','click','--name','确认保存为 v2','--exact');await browser('wait','--fn',"document.querySelector('textarea[aria-label=系列定位]')?.readOnly===true");
  const after=await read(),version=after.seriesVersions.filter((v:any)=>v.series_id===created.series_id).sort((a:any,b:any)=>b.version-a.version)[0];expect(version.rules).toMatchObject({positioning:'清理后保留的系列规则',extension:{keep:['series']}});
  await browser('reload');await browser('wait','--text','隔离系列');expect(await browser('get','value','textarea[aria-label=系列定位]')).toContain('清理后保留的系列规则');
  for(const width of [1440,390]){await browser('set','viewport',String(width),'1000');expect(await browser('eval','document.documentElement.scrollWidth<=innerWidth')).toContain('true');await browser('screenshot',join(output,`current-series-${width}.png`),'--full');}
  await writeFile(join(output,'final-snapshot.txt'),await browser('snapshot'));await writeFile(join(output,'errors.txt'),await browser('errors'));
 }catch(error){await browser('screenshot',join(output,'cleanup-failure.png'),'--full').catch(()=>{});await writeFile(join(output,'cleanup-failure-snapshot.txt'),await browser('snapshot').catch(()=>''));throw error;}finally{await browser('close').catch(()=>{});await vite?.close();await f.close();}
},120000);
