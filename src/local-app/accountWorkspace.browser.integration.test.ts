// @vitest-environment node
import {it, expect} from 'vitest';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
import {mkdir,writeFile,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {createServer, type ViteDevServer} from 'vite';
import react from '@vitejs/plugin-react';
import {embeddedStudioFixture} from './embeddedStudio.fixture';
import {csrfFor} from './sessions';
import type {LocalCatalog} from './catalog';
const exec=promisify(execFile);

it.skipIf(process.env.LOOP_ACCOUNT_WORKSPACE_BROWSER!=='1')('edits account and series independently through the formal page and isolated Owner HTTP',async()=>{
 const f=await embeddedStudioFixture({migrations:['db/local/112-series-extension-rules.sql']});let vite:ViteDevServer|undefined;
 const session='account-workspace-'+randomUUID();
 const entryPath='src/local-app/.account-workspace-entry-'+randomUUID()+'.tsx';
 const browser=async(...args:string[])=>(await exec('agent-browser',['--session',session,...args],{timeout:40000,maxBuffer:2_000_000})).stdout;
 const output=process.env.LOOP_ACCEPTANCE_OUTPUT??join(f.root,'browser-evidence');await mkdir(output,{recursive:true});
 const headers={Origin:f.origin,'Content-Type':'application/json',Cookie:'loop_owner_session='+f.token,'X-CSRF-Token':csrfFor(f.token)};
 const read=async()=>{const r=await fetch(f.origin+'/api/local/catalog?view=accounts',{headers});expect(r.status).toBe(200);return await r.json() as LocalCatalog;};
 const command=async(command:string,data:Record<string,unknown>,expectedRevision?:string)=>{const r=await fetch(f.origin+'/api/local/configuration',{method:'POST',headers,body:JSON.stringify({command,data,idempotencyKey:randomUUID(),...(expectedRevision?{expectedRevision}:{})})});const body=await r.json();expect(r.status,JSON.stringify(body)).toBe(200);return body;};
 try{
  const before=await read(),account=before.accounts[0];
  await command('updateBlueprint',{accountId:account.id,policy:{positioning:'初始账号定位',restrictions:'不得虚构事实',extension:{keep:['account']}}},before.blueprintRevisions[account.current_blueprint_version_id!]);
  await command('createSeries',{accountId:account.id,name:'隔离系列',rules:{positioning:'初始系列定位',extension:{keep:['series']}}});
  const denied=async(token:string,csrf:boolean,rules:unknown)=>{const r=await fetch(f.origin+'/api/local/configuration',{method:'POST',headers:{...headers,Cookie:'loop_owner_session='+token,'X-CSRF-Token':csrf?csrfFor(token):''},body:JSON.stringify({command:'createSeries',idempotencyKey:randomUUID(),data:{accountId:account.id,name:'拒绝无效写入',rules}})});return r.status;};
  expect(await denied(f.otherToken,true,{})).toBe(404);expect(await denied(f.token,false,{})).toBe(403);expect(await denied(f.token,true,[])).toBe(400);expect(await denied(f.token,true,{extension:{password:'synthetic-must-not-store'}})).toBe(400);
  const proxy={target:f.origin,changeOrigin:true,configure(p:any){p.on('proxyReq',(req:any)=>req.setHeader('origin',f.origin));}};
  const entry="import {createRoot} from 'react-dom/client';import {LocalCatalogApp} from './LocalCatalogApp';import '/src/styles.css';import '/src/ui/impeccable/foundation.css';import '/src/ui/impeccable/configuration.css';import '/src/ui/impeccable/maintenance.css';import '/src/ui/impeccable/production.css';import '/src/ui/impeccable/scroll-layout.css';createRoot(document.getElementById('root')).render(<LocalCatalogApp/>);";
  await writeFile(entryPath,entry);
  vite=await createServer({configFile:false,envFile:false,root:process.cwd(),cacheDir:join(f.root,'vite-cache'),define:{'import.meta.env.VITE_LOOP_BACKEND':JSON.stringify('local')},plugins:[react(),{name:'account-workspace-fixture',configureServer(s){s.middlewares.use('/__account-workspace',async(_req,res)=>{res.setHeader('Content-Type','text/html');res.end(await s.transformIndexHtml('/__account-workspace',`<!doctype html><html lang="zh-CN" data-interface="impeccable"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>账号工作区隔离验收</title><div id="root"></div><script type="module" src="/${entryPath}"></script>`));});}}],server:{host:'127.0.0.1',port:0,proxy:{'/api':proxy,'/_local-artifact':proxy}}});await vite.listen();
  const address=vite.httpServer!.address() as {port:number};
  await browser('open',`http://127.0.0.1:${address.port}/__account-workspace`);
  await browser('wait','--text','登录控制台');
  await browser('find','label','邮箱','fill',f.email);await browser('find','label','密码','fill',f.password);await browser('find','role','button','click','--name','使用密码登录','--exact');
  await browser('wait','--text','工作台');
  await browser('find','role','button','click','--name','账号','--exact');
  await browser('wait','--text','通用规则');
  await browser('find','label','账号定位','fill','未保存账号创作规则');
  await browser('find','label','账号名称','fill','隔离账号改名');
  const initial=await read();await browser('find','role','button','click','--name','保存账号资料','--exact');
  await browser('wait','--text','账号资料已保存');
  const renamed=await read();expect(renamed.accounts[0].name).toBe('隔离账号改名');expect(renamed.blueprints).toEqual(initial.blueprints);
  expect(await browser('eval','document.querySelector(\'[aria-label="账号定位"]\').value')).toContain('未保存账号创作规则');
  await browser('find','role','button','click','--name','保存通用规则','--exact');await browser('find','role','button','click','--name','确认保存通用规则','--exact');
  await browser('wait','--fn',"document.querySelector('[role=dialog]') === null");
  const saved=await read(),current=saved.blueprints.find(b=>b.id===saved.accounts[0].current_blueprint_version_id)!;
  expect(current.policy).toEqual({positioning:'未保存账号创作规则',restrictions:'不得虚构事实',extension:{keep:['account']}});
  await browser('find','role','button','click','--name','隔离系列','--exact');await browser('find','label','系列定位','fill','更新系列定位');
  await browser('find','role','button','click','--name','保存为 v2','--exact');await browser('find','role','button','click','--name','确认保存为 v2','--exact');await browser('wait','--text','当前 v2');
  const seriesSaved=await read();expect(seriesSaved.seriesVersions.find(v=>v.version===2)?.rules).toEqual({positioning:'更新系列定位',extension:{keep:['series']}});expect(seriesSaved.blueprints).toEqual(saved.blueprints);const original=before.blueprints.find(b=>b.id===before.accounts[0].current_blueprint_version_id)!;expect(seriesSaved.blueprints.find(b=>b.id===original.id)).toMatchObject({id:original.id,version:original.version,policy:original.policy});
  for(const [width,height] of [[1280,900],[390,844]]){await browser('set','viewport',String(width),String(height));await browser('eval','window.scrollTo(0,0)');await browser('screenshot',join(output,`series-${width}.png`),'--full');expect(await browser('eval','document.documentElement.scrollWidth <= innerWidth')).toContain('true');}
  await browser('find','role','button','click','--name','新建系列','--exact');await browser('find','label','系列名称','fill','新系列验收');
  await browser('find','role','button','click','--name','创建系列','--exact');await browser('find','role','button','click','--name','确认创建系列','--exact');
  await browser('wait','--text','新系列验收 · 当前 v1');expect((await read()).series.some(item=>item.name==='新系列验收')).toBe(true);
  await browser('find','role','button','click','--name','通用规则','--exact');
  for(const [width,height] of [[1440,1000],[1100,850],[390,844]]){await browser('set','viewport',String(width),String(height));await browser('eval','window.scrollTo(0,0)');await browser('screenshot',join(output,`account-${width}.png`),'--full');expect(await browser('eval','document.documentElement.scrollWidth <= innerWidth')).toContain('true');}
  await writeFile(join(output,'browser-snapshot.txt'),await browser('snapshot'));
  await writeFile(join(output,'result.json'),JSON.stringify({accountMetadataIndependent:true,ruleReadback:current.policy,seriesReadback:seriesSaved.seriesVersions.find(v=>v.version===2)?.rules,widths:[1440,1100,390]},null,2));
 }catch(error){await writeFile(join(output,'failure-snapshot.txt'),await browser('snapshot').catch(()=>''));await writeFile(join(output,'failure-errors.txt'),await browser('errors').catch(()=>''));throw error;}finally{await browser('close').catch(()=>{});await vite?.close();await unlink(entryPath).catch(()=>{});await f.close();}
},240000);
